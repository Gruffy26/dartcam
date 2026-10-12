import { calibrationStillValid, detectBoard } from '../auto-run';
import {
  boardOverlay,
  calibrationMismatch,
  frameToBoard,
  loadCalibration,
  saveCalibration,
  tryBoardToFrame,
  type Calibration,
} from '../calibration';
import { createCameraStage, type FrameInfo } from '../camera-stage';
import { DartDetector, type DartEvent } from '../detector/detector';
import { h } from '../dom';
import { frameToScreen } from '../frameview';
import type { Mat3, Pt } from '../homography';
import type { Nav, Screen } from '../main';
import { loadOpenCV, type CV } from '../opencv';
import { drawBoardOverlay, fitCanvas } from '../overlay-draw';
import { getSettings } from '../settings';

/** Largeur des images analysées : assez pour viser, assez léger pour l'iPhone. */
export const ANALYSIS_WIDTH = 640;
const ANALYSIS_INTERVAL_MS = 100; // ≈10 analyses par seconde
const RECT_SIZE = 240; // vue de face (debug)

// Écran de partie : trouve la cible automatiquement, puis détecte chaque fléchette.
// (Les règles du jeu — 501, double out… — arrivent à l'étape 6.)
export function gameScreen(nav: Nav): Screen {
  const cam = createCameraStage(nav);
  const debugMode = getSettings().debug;
  let disposed = false;
  let timer = 0;
  let raf = 0;
  let cv: CV | null = null;
  /** Calibration utilisée pour cette session, ou null tant que la cible n'est pas trouvée. */
  let cal: Calibration | null = null;
  let detector: DartDetector | null = null;
  let detSize = { w: 0, h: 0 };
  let run = 0; // identifiant de la recherche de cible en cours
  let darts: DartEvent[] = [];
  let lockInfo = '';
  let fps = 0;
  let frames = 0;
  let lastFpsT = performance.now();

  // --- Éléments ---------------------------------------------------------
  const overlay = h('canvas', { class: 'overlay' });
  const note = h('div', { class: 'note' });
  const lastScore = h('div', { class: 'last-score' }, '–');
  const volley = h('div', { class: 'volley' });
  const scorePanel = h('div', { class: 'score-panel' }, lastScore, volley);
  const stats = h('div', { class: 'stats' });
  const maskCanvas = h('canvas', { class: 'inset' });
  const rectCanvas = h('canvas', { class: 'inset' });
  const insets = h('div', { class: 'insets hidden' }, h('figure', {}, maskCanvas, h('figcaption', {}, 'Masque')), h('figure', {}, rectCanvas, h('figcaption', {}, 'Vue de face')));
  const redetectBtn = h('button', { class: 'big', onclick: () => void findBoard() }, 'Redétecter la cible');
  const resetBtn = h('button', { class: 'big', onclick: () => resetVolley() }, 'Fléchettes retirées');
  const manualBtn = h('button', { class: 'big', onclick: () => nav('calibrate') }, 'Ajuster à la main');

  cam.el.insertBefore(overlay, cam.el.children[1]);
  cam.el.append(note);
  if (debugMode) cam.el.append(insets);
  // Pas de zoom pendant la partie : le changer rendrait la calibration fausse.
  cam.zoomBar.classList.add('hidden');
  cam.dock.append(scorePanel, h('div', { class: 'calib-actions small' }, resetBtn, redetectBtn, manualBtn));
  if (debugMode) cam.dock.append(stats);

  function setNote(text: string, warn = false) {
    note.textContent = text;
    note.classList.toggle('warn', warn);
  }

  // --- Cible : détection automatique à l'ouverture de la caméra ------------
  async function findBoard() {
    const id = ++run;
    const kind = cam.source?.kind;
    if (!kind) return;
    cal = null;
    dropDetector();
    redetectBtn.disabled = true;
    setNote('🔎 Recherche de la cible…');
    const res = await detectBoard(cam, () => disposed || id !== run);
    if (disposed || id !== run) return;
    redetectBtn.disabled = false;
    const f = cam.frame();
    if (res.ok && f) {
      useCalibration({
        version: 1,
        kind,
        points: res.points,
        zoom: cam.zoomValue(),
        aspect: f.crop.w / f.crop.h,
        createdAt: new Date().toISOString(),
        method: 'auto',
      });
      saveCalibration(cal!);
      setNote(`✅ Cible détectée (≈ ${res.errorMm.toFixed(1).replace('.', ',')} mm). Ne touche plus le téléphone et attends « Prêt »…`);
      return;
    }
    // Échec : la calibration précédente est-elle toujours bonne (trépied pas bougé) ?
    const saved = loadCalibration(kind);
    if (saved && f && !calibrationMismatch(saved, { zoom: cam.zoomValue(), aspect: f.crop.w / f.crop.h })) {
      if (await calibrationStillValid(cam, saved)) {
        if (disposed || id !== run) return;
        useCalibration(saved);
        setNote('✅ Calibration précédente toujours alignée. Attends « Prêt »…');
        return;
      }
    }
    setNote(
      `⚠️ Cible non trouvée automatiquement : ${res.ok ? '' : res.reason} Vérifie qu’elle est entière et bien éclairée, puis « Redétecter », ou « Ajuster à la main ».`,
      true,
    );
  }

  function useCalibration(c: Calibration) {
    cal = c;
    dropDetector();
    // Exposition / balance des blancs bloquées si possible (luminosité stable).
    void cam.source?.lock().then((info) => (lockInfo = info));
  }

  function dropDetector() {
    detector?.dispose();
    detector = null;
  }

  function resetVolley() {
    darts = [];
    detector?.resetReference();
    renderVolley();
    setNote('Nouvelle image de référence… attends « Prêt ».');
  }

  cam.onChange((reason) => {
    if (reason === 'source') {
      cal = null;
      dropDetector();
      run++;
      darts = [];
      renderVolley();
      const start = () => (cam.frame() ? void findBoard() : cam.source && setTimeout(start, 100));
      start();
    }
  });

  // --- Analyse des images -------------------------------------------------
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  function grab(f: FrameInfo): ImageData | null {
    const v = cam.source?.video;
    if (!v) return null;
    const w = ANALYSIS_WIDTH;
    const hh = Math.round((f.crop.h * w) / f.crop.w);
    if (canvas.width !== w || canvas.height !== hh) {
      canvas.width = w;
      canvas.height = hh;
    }
    ctx.drawImage(v, f.crop.x, f.crop.y, f.crop.w, f.crop.h, 0, 0, w, hh);
    return ctx.getImageData(0, 0, w, hh);
  }

  function analyse() {
    const f = cam.frame();
    if (!f || !cal || !cv) return;
    const img = grab(f);
    if (!img) return;
    if (!detector || detSize.w !== img.width || detSize.h !== img.height) {
      dropDetector();
      detector = new DartDetector(
        cv,
        { frameToBoard: frameToBoard(cal.points, img.width, img.height), width: img.width, height: img.height, zoom: cal.zoom },
        getSettings().detector,
      );
      detSize = { w: img.width, h: img.height };
    }
    const events = detector.process(img, performance.now());
    for (const ev of events) {
      if (ev.kind === 'dart') onDart(ev, img);
      else if (ev.kind === 'moved') {
        setNote('Le trépied a bougé : nouvelle détection de la cible…', true);
        void findBoard();
        return;
      } else if (ev.kind === 'ignored' && ev.reason === 'big') {
        setNote('Quelque chose est devant la cible… J’attends que la vue se libère.');
      } else if (ev.kind === 'reference') {
        setNote('🟢 Prêt ! Lance tes fléchettes.');
      }
    }
    if (debugMode) updateDebug();

    frames++;
    const now = performance.now();
    if (now - lastFpsT >= 1000) {
      fps = (frames * 1000) / (now - lastFpsT);
      frames = 0;
      lastFpsT = now;
    }
  }

  function onDart(ev: DartEvent, img: ImageData) {
    if (darts.length >= 3) darts = []; // provisoire : une volée = 3 fléchettes (étape 5 : retrait)
    darts.push(ev);
    lastScore.textContent = ev.score.libelle;
    lastScore.classList.remove('pop');
    void lastScore.offsetWidth; // relance l'animation
    lastScore.classList.add('pop');
    renderVolley();
    setNote(`🎯 ${ev.score.libelle} (${ev.score.points} pts)`);
    if (debugMode) drawRectified(img);
  }

  function renderVolley() {
    const total = darts.reduce((s, d) => s + d.score.points, 0);
    volley.replaceChildren(
      ...[0, 1, 2].map((i) => h('span', { class: 'chip' + (darts[i] ? '' : ' empty') }, darts[i]?.score.libelle ?? '·')),
      h('span', { class: 'total' }, `= ${total}`),
    );
    if (!darts.length) lastScore.textContent = '–';
  }

  // --- Dessin -------------------------------------------------------------
  function toScreen(f: FrameInfo, p: Pt): Pt {
    return frameToScreen(f.screen, { x: p.x / detSize.w, y: p.y / detSize.h });
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    const c = fitCanvas(overlay, cam.el.clientWidth, cam.el.clientHeight);
    const f = cam.frame();
    if (!f || !cal) return;
    const refW = 1000;
    const refH = refW / (f.crop.w / f.crop.h);
    const B2F = tryBoardToFrame(cal.points, refW, refH);
    if (B2F) drawBoardOverlay(c, boardOverlay(B2F, refW, refH), (p) => frameToScreen(f.screen, p), { alpha: debugMode ? 0.6 : 0.35, numbers: false });
    if (!detSize.w) return;

    if (debugMode && detector?.debug.contour) {
      const xy = detector.debug.contour;
      c.fillStyle = 'rgba(255, 0, 255, 0.6)';
      const step = Math.max(2, Math.floor(xy.length / 3000) * 2);
      for (let i = 0; i < xy.length; i += step) {
        const s = toScreen(f, { x: xy[i], y: xy[i + 1] });
        c.fillRect(s.x - 1, s.y - 1, 2, 2);
      }
      const t = detector.debug.tip;
      if (t) {
        const a = toScreen(f, t.tip);
        const b = toScreen(f, t.tail);
        c.strokeStyle = '#2af5ff';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
        dot(c, b, '#3b82f6', 6);
        dot(c, a, '#ff2020', 6);
      }
    }
    // Impacts de la volée en cours.
    darts.forEach((d, i) => {
      const s = toScreen(f, d.tip);
      dot(c, s, i === darts.length - 1 ? '#ff2020' : '#ffae00', 7);
      c.font = 'bold 16px -apple-system, sans-serif';
      c.fillStyle = '#fff';
      c.strokeStyle = 'rgba(0,0,0,0.8)';
      c.lineWidth = 3;
      c.strokeText(d.score.libelle, s.x + 10, s.y - 10);
      c.fillText(d.score.libelle, s.x + 10, s.y - 10);
    });
  }

  function dot(c: CanvasRenderingContext2D, p: Pt, color: string, r: number) {
    c.beginPath();
    c.arc(p.x, p.y, r, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = '#fff';
    c.stroke();
  }

  // --- Debug ----------------------------------------------------------------
  let lastMask: unknown = null;
  const maskTmp = document.createElement('canvas');

  function updateDebug() {
    const d = detector?.debug;
    if (!d) return;
    if (d.mask && d.mask !== lastMask) {
      lastMask = d.mask;
      insets.classList.remove('hidden');
      maskTmp.width = d.mask.width;
      maskTmp.height = d.mask.height;
      const id = new ImageData(d.mask.width, d.mask.height);
      for (let i = 0; i < d.mask.data.length; i++) {
        const v = d.mask.data[i];
        id.data[4 * i] = v;
        id.data[4 * i + 1] = v;
        id.data[4 * i + 2] = v;
        id.data[4 * i + 3] = 255;
      }
      maskTmp.getContext('2d')!.putImageData(id, 0, 0);
      const w = 120;
      const hh = Math.round((d.mask.height * w) / d.mask.width);
      const c = fitCanvas(maskCanvas, w, hh);
      maskCanvas.style.width = `${w}px`;
      maskCanvas.style.height = `${hh}px`;
      c.drawImage(maskTmp, 0, 0, w, hh);
    }
    const stateFr = { warmup: 'référence…', watching: 'à l’affût', moving: 'mouvement' }[d.state];
    stats.textContent =
      `${stateFr} · ${fps.toFixed(1)} img/s · ${d.processMs.toFixed(0)} ms` +
      (d.analyseMs != null ? ` (analyse ${d.analyseMs.toFixed(0)} ms)` : '') +
      ` · mvt ${d.motion}/${d.motionLimit.toFixed(0)} · décalage ${d.shift.x.toFixed(1)},${d.shift.y.toFixed(1)} px` +
      (d.area != null ? ` · aire ${d.area.toFixed(0)} (min ${d.minArea.toFixed(0)}, max ${d.maxArea.toFixed(0)})` : '') +
      (d.tip ? ` · confiance ${(d.tip.confidence * 100).toFixed(0)} %` : '') +
      ` · focale ${detector?.cam ? `${detector.cam.focal.toFixed(0)}${detector.cam.focalEstimated ? '' : ' (défaut)'}` : '?'}` +
      ` · ${lockInfo || 'exposition auto'}`;
  }

  /** Vue « de face » : l'image redressée par l'homographie, avec les impacts. */
  function drawRectified(img: ImageData) {
    if (!cv || !cal) return;
    const F2B: Mat3 = detector?.frameToBoard ?? frameToBoard(cal.points, img.width, img.height);
    const k = RECT_SIZE / 2 / 225;
    const c = RECT_SIZE / 2;
    // cadre (px) → cible (mm) → vue de face (px), y vers le bas.
    const S = [k, 0, c, 0, -k, c, 0, 0, 1];
    const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let l = 0; l < 3; l++) M[i * 3 + j] += S[i * 3 + l] * F2B[l * 3 + j];
    const src = cv.matFromImageData(img);
    const dst = new cv.Mat();
    const Mm = cv.matFromArray(3, 3, cv.CV_64F, M);
    try {
      cv.warpPerspective(src, dst, Mm, new cv.Size(RECT_SIZE, RECT_SIZE));
      rectCanvas.width = RECT_SIZE;
      rectCanvas.height = RECT_SIZE;
      cv.imshow(rectCanvas, dst);
    } finally {
      src.delete();
      dst.delete();
      Mm.delete();
    }
    const g = rectCanvas.getContext('2d')!;
    darts.forEach((d) => {
      g.beginPath();
      g.arc(c + k * d.board.x, c - k * d.board.y, 4, 0, Math.PI * 2);
      g.fillStyle = '#ff2020';
      g.fill();
      g.strokeStyle = '#fff';
      g.stroke();
    });
    rectCanvas.style.width = '120px';
    rectCanvas.style.height = '120px';
  }

  // --- Démarrage ------------------------------------------------------------
  void loadOpenCV().then((m) => {
    cv = m;
    const loop = () => {
      if (disposed) return;
      const start = performance.now();
      try {
        analyse();
      } catch (e) {
        setNote(`Erreur d’analyse : ${String(e)}`, true);
      }
      // Cadence visée : une analyse toutes les 100 ms, temps de calcul compris.
      const spent = performance.now() - start;
      timer = window.setTimeout(loop, Math.max(10, ANALYSIS_INTERVAL_MS - spent));
    };
    loop();
  });

  renderVolley();
  draw();

  return {
    el: cam.el,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      dropDetector();
      cam.dispose();
    },
  };
}
