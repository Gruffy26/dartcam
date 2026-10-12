import { calibrationStillValid, detectBoard } from '../auto-run';
import {
  boardOverlay,
  calibrationMismatch,
  loadCalibration,
  saveCalibration,
  tryBoardToFrame,
  type Calibration,
} from '../calibration';
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

// Écran de partie, provisoire : trouve la cible automatiquement à l'ouverture,
// affiche la calibration et mesure la vitesse d'analyse.
// La détection des fléchettes arrive à l'étape 4.
export function viewerScreen(nav: Nav): Screen {
  const cam = createCameraStage(nav);
  let disposed = false;
  let timer = 0;
  let raf = 0;
  /** Calibration utilisée pour cette session, ou null tant que la cible n'est pas trouvée. */
  let cal: Calibration | null = null;
  let run = 0; // identifiant de la recherche en cours (pour ignorer les anciennes)

  const overlay = h('canvas', { class: 'overlay' });
  const note = h('div', { class: 'note' });
  const stats = h('div', { class: 'stats' }, 'Démarrage…');
  const redetectBtn = h('button', { class: 'big', onclick: () => void findBoard() }, 'Redétecter la cible');
  const manualBtn = h('button', { class: 'big', onclick: () => nav('calibrate') }, 'Ajuster à la main');
  cam.el.insertBefore(overlay, cam.el.children[1]);
  cam.el.append(note);
  // Pas de zoom pendant la partie : le changer rendrait la calibration fausse.
  cam.zoomBar.classList.add('hidden');
  cam.dock.append(h('div', { class: 'calib-actions' }, redetectBtn, manualBtn), stats);

  function setNote(text: string, warn = false) {
    note.textContent = text;
    note.classList.toggle('warn', warn);
  }

  // À chaque ouverture de la caméra : on cherche la cible automatiquement.
  async function findBoard() {
    const id = ++run;
    const kind = cam.source?.kind;
    if (!kind) return;
    cal = null;
    redetectBtn.disabled = true;
    setNote('🔎 Recherche de la cible…');
    const res = await detectBoard(cam, () => disposed || id !== run);
    if (disposed || id !== run) return;
    redetectBtn.disabled = false;
    const f = cam.frame();
    if (res.ok && f) {
      cal = {
        version: 1,
        kind,
        points: res.points,
        zoom: cam.zoomValue(),
        aspect: f.crop.w / f.crop.h,
        createdAt: new Date().toISOString(),
        method: 'auto',
      };
      saveCalibration(cal);
      setNote(`✅ Cible détectée automatiquement (précision ≈ ${res.errorMm.toFixed(1).replace('.', ',')} mm, ${Math.round(res.ms)} ms).`);
      return;
    }
    // Échec : la calibration précédente est-elle toujours bonne (trépied pas bougé) ?
    const saved = loadCalibration(kind);
    if (saved && f && !calibrationMismatch(saved, { zoom: cam.zoomValue(), aspect: f.crop.w / f.crop.h })) {
      if (await calibrationStillValid(cam, saved)) {
        if (disposed || id !== run) return;
        cal = saved;
        setNote('✅ Calibration précédente toujours alignée.');
        return;
      }
    }
    setNote(`⚠️ Cible non trouvée automatiquement : ${res.ok ? "" : res.reason} Vérifie qu’elle est entière et bien éclairée, puis « Redétecter », ou « Ajuster à la main ».`, true);
  }

  cam.onChange((reason) => {
    if (reason === 'source') {
      cal = null;
      run++;
      const start = () => (cam.frame() ? void findBoard() : cam.source && setTimeout(start, 100));
      start();
    }
  });

  function draw() {
    raf = requestAnimationFrame(draw);
    const ctx = fitCanvas(overlay, cam.el.clientWidth, cam.el.clientHeight);
    const f = cam.frame();
    if (!f || !cal) return;
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
