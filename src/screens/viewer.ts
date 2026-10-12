import { boardOverlay, calibrationMismatch, loadCalibration, tryBoardToFrame } from '../calibration';
import { createCameraStage } from '../camera-stage';
import { h } from '../dom';
import { frameToScreen } from '../frameview';
import type { Nav, Screen } from '../main';
import { loadOpenCV, type CV } from '../opencv';
import { drawBoardOverlay, fitCanvas } from '../overlay-draw';
import { isScreenKeptOn } from '../wakelock';
import { formatZoom } from '../zoom';

/** Largeur des images analysées : assez pour viser, assez léger pour l'iPhone. */
export const ANALYSIS_WIDTH = 640;
const ANALYSIS_INTERVAL_MS = 100; // ≈10 analyses par seconde

// Écran de partie, provisoire : vérifie que la calibration est toujours alignée
// et mesure la vitesse d'analyse. La détection des fléchettes arrive à l'étape 4.
export function viewerScreen(nav: Nav): Screen {
  const cam = createCameraStage(nav);
  let disposed = false;
  let timer = 0;
  let raf = 0;

  const overlay = h('canvas', { class: 'overlay' });
  const note = h('div', { class: 'note' });
  const stats = h('div', { class: 'stats' }, 'Démarrage…');
  cam.el.insertBefore(overlay, cam.el.children[1]);
  cam.el.append(note);
  // Pas de zoom pendant la partie : le changer rendrait la calibration fausse.
  cam.zoomBar.classList.add('hidden');
  cam.dock.append(
    h('button', { class: 'big', onclick: () => nav('calibrate') }, 'Recalibrer'),
    stats,
  );

  function calibrationState() {
    const f = cam.frame();
    const kind = cam.source?.kind;
    if (!f || !kind) return { cal: null, problem: null };
    const cal = loadCalibration(kind);
    if (!cal) return { cal: null, problem: 'Pas encore de calibration pour cette source.' };
    const problem = calibrationMismatch(cal, { zoom: cam.zoomValue(), aspect: f.crop.w / f.crop.h });
    return { cal, problem };
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    const ctx = fitCanvas(overlay, cam.el.clientWidth, cam.el.clientHeight);
    const f = cam.frame();
    const { cal, problem } = calibrationState();
    note.textContent = problem
      ? `⚠️ ${problem} Touche « Recalibrer ».`
      : 'Partie — la détection arrive à l’étape 4. Vérifie que le dessin jaune reste aligné sur la cible.';
    note.classList.toggle('warn', !!problem);
    if (!f || !cal || problem) return;
    const refW = 1000;
    const refH = refW / (f.crop.w / f.crop.h);
    const B2F = tryBoardToFrame(cal.points, refW, refH);
    if (B2F) drawBoardOverlay(ctx, boardOverlay(B2F, refW, refH), (p) => frameToScreen(f.screen, p), { alpha: 0.6 });
  }

  // Boucle d'analyse de test : image réduite à 640 px → niveaux de gris avec OpenCV.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let frames = 0;
  let fps = 0;
  let lastFpsT = performance.now();

  function analyse(cv: CV) {
    const f = cam.frame();
    const v = cam.source?.video;
    if (!f || !v) {
      stats.textContent = 'En attente d’images…';
      return;
    }
    const { crop } = f;
    const w = ANALYSIS_WIDTH;
    const hgt = Math.round((crop.h * w) / crop.w);
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w;
      canvas.height = hgt;
    }
    const t0 = performance.now();
    ctx.drawImage(v, crop.x, crop.y, crop.w, crop.h, 0, 0, w, hgt);
    const img = ctx.getImageData(0, 0, w, hgt);
    const t1 = performance.now();
    const rgba = cv.matFromImageData(img);
    const gray = new cv.Mat();
    try {
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    } finally {
      rgba.delete();
      gray.delete();
    }
    const t2 = performance.now();

    frames++;
    const now = performance.now();
    if (now - lastFpsT >= 1000) {
      fps = (frames * 1000) / (now - lastFpsT);
      frames = 0;
      lastFpsT = now;
    }
    stats.textContent =
      `Source ${f.vw}×${f.vh} · zoom ${formatZoom(cam.zoomValue())} · analyse ${w}×${hgt} · ` +
      `${fps.toFixed(1)} img/s · capture ${(t1 - t0).toFixed(1)} ms + OpenCV ${(t2 - t1).toFixed(1)} ms · ` +
      `écran maintenu allumé : ${isScreenKeptOn() ? 'oui' : 'non'}`;
  }

  void loadOpenCV().then((cv) => {
    const loop = () => {
      if (disposed) return;
      const start = performance.now();
      try {
        analyse(cv);
      } catch (e) {
        stats.textContent = `Erreur d’analyse : ${String(e)}`;
      }
      // Cadence visée : une analyse toutes les 100 ms, temps de calcul compris.
      const spent = performance.now() - start;
      timer = window.setTimeout(loop, Math.max(10, ANALYSIS_INTERVAL_MS - spent));
    };
    loop();
  });

  draw();

  return {
    el: cam.el,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      cam.dispose();
    },
  };
}
