import { calibrationStillValid, detectBoard } from '../auto-run';
import { MISS, scoreFromBoardCoords, type Score } from '../board';
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
import { frameToScreen, screenToFrame } from '../frameview';
import { applyH, type Mat3, type Pt } from '../homography';
import { showLoupe } from '../loupe';
import type { Nav, Screen } from '../main';
import { loadOpenCV, type CV } from '../opencv';
import { drawBoardOverlay, fitCanvas } from '../overlay-draw';
import { getSettings } from '../settings';
import { Volley } from '../volley';

/** Largeur des images analysées : assez pour viser, assez léger pour l'iPhone. */
export const ANALYSIS_WIDTH = 640;
const ANALYSIS_INTERVAL_MS = 100; // ≈10 analyses par seconde
const RECT_SIZE = 240; // vue de face (debug)

// Écran de partie : trouve la cible automatiquement, détecte chaque fléchette,
// gère la volée de 3, le retrait des fléchettes et les corrections au doigt.
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
  let volley = new Volley();
  let lastVolleys: number[] = [];
  /** Fléchette sélectionnée pour une correction (par défaut la dernière). */
  let selected = -1;
  /** Visée au doigt en cours (coordonnées écran). */
  let aim: Pt | null = null;
  let lockInfo = '';
  let fps = 0;
  let frames = 0;
  let lastFpsT = performance.now();

  // --- Éléments ---------------------------------------------------------
  const overlay = h('canvas', { class: 'overlay interactive' });
  const loupe = h('canvas', { class: 'loupe hidden' });
  const note = h('div', { class: 'note' });
  const lastScore = h('div', { class: 'last-score' }, '–');
  const chips = h('div', { class: 'volley' });
  const history = h('div', { class: 'history' });
  const scorePanel = h('div', { class: 'score-panel' }, lastScore, h('div', { class: 'volley-col' }, chips, history));
  const stats = h('div', { class: 'stats' });
  const maskCanvas = h('canvas', { class: 'inset' });
  const rectCanvas = h('canvas', { class: 'inset' });
  const insets = h(
    'div',
    { class: 'insets hidden' },
    h('figure', {}, maskCanvas, h('figcaption', {}, 'Masque')),
    h('figure', {}, rectCanvas, h('figcaption', {}, 'Vue de face')),
  );
  const sheet = h('div', { class: 'sheet hidden' });
  const missBtn = h('button', { class: 'big', onclick: () => miss() }, 'Raté / 0');
  const undoBtn = h('button', { class: 'big', onclick: () => undo() }, 'Annuler');
  const clearBtn = h('button', { class: 'big primary', onclick: () => cleared(true) }, 'Fléchettes retirées');
  const boardBtn = h('button', { class: 'pill', onclick: () => boardMenu() }, '🎯 Cible');

  cam.el.insertBefore(overlay, cam.el.children[1]);
  cam.el.append(note, loupe, sheet);
  if (debugMode) cam.el.append(insets);
  cam.el.querySelector('.topbar')!.insertBefore(boardBtn, cam.el.querySelector('.topbar')!.lastChild);
  // Pas de zoom pendant la partie : le changer rendrait la calibration fausse.
  cam.zoomBar.classList.add('hidden');
  cam.dock.append(scorePanel, h('div', { class: 'calib-actions small' }, missBtn, undoBtn, clearBtn));
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
    setNote('🔎 Recherche de la cible…');
    const res = await detectBoard(cam, () => disposed || id !== run);
    if (disposed || id !== run) return;
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
      `⚠️ Cible non trouvée automatiquement : ${res.ok ? '' : res.reason} Vérifie qu’elle est entière et bien éclairée, puis 🎯 › « Redétecter », ou « Ajuster à la main ».`,
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

  cam.onChange((reason) => {
    if (reason === 'source') {
      cal = null;
      dropDetector();
      run++;
      volley = new Volley();
      lastVolleys = [];
      render();
      const start = () => (cam.frame() ? void findBoard() : cam.source && setTimeout(start, 100));
      start();
    }
  });

  // --- Volée ----------------------------------------------------------------
  function afterChange(announce?: Score) {
    selected = volley.darts.length - 1;
    if (announce) {
      lastScore.textContent = announce.libelle;
      lastScore.classList.remove('pop');
      void lastScore.offsetWidth; // relance l'animation
      lastScore.classList.add('pop');
    }
    if (volley.full) {
      detector?.setMode('removal');
      setNote(`Volée terminée : ${volley.total} points. Va retirer tes fléchettes.`);
    } else {
      detector?.setMode('throwing');
    }
    render();
  }

  function onDart(ev: DartEvent, img: ImageData) {
    if (!volley.addDetected(ev.score, ev.tip, ev.board)) return;
    if (!volley.full) setNote(`🎯 ${ev.score.libelle} (${ev.score.points} pts) — touche l’image pour corriger.`);
    afterChange(ev.score);
    if (debugMode) drawRectified(img);
  }

  function miss() {
    if (volley.full) {
      // Volée complète : « Raté » remplace la fléchette sélectionnée.
      volley.correct(selected, MISS, null, null);
      setNote('Fléchette corrigée : 0.');
      afterChange(MISS);
      return;
    }
    volley.addMiss();
    detector?.noteManualDart();
    setNote('Fléchette ratée ajoutée : 0.');
    afterChange(MISS);
  }

  function undo() {
    const d = volley.undo();
    if (!d) return;
    setNote(`Fléchette « ${d.score.libelle} » annulée.`);
    afterChange();
    lastScore.textContent = volley.last?.score.libelle ?? '–';
  }

  /** Volée enregistrée, nouvelle volée (fléchettes retirées, automatiquement ou au bouton). */
  function cleared(manual: boolean) {
    if (volley.darts.length) {
      lastVolleys = [volley.total, ...lastVolleys].slice(0, 3);
      setNote(`✅ Volée enregistrée : ${volley.total} points.${manual ? ' Attends « Prêt »…' : ' À toi !'}`);
    } else if (manual) setNote('Nouvelle image de référence… attends « Prêt ».');
    volley = new Volley();
    if (manual) detector?.resetReference();
    else detector?.setMode('throwing');
    lastScore.textContent = '–';
    afterChange();
  }

  function render() {
    chips.replaceChildren(
      ...[0, 1, 2].map((i) => {
        const d = volley.darts[i];
        const cls = 'chip' + (d ? '' : ' empty') + (d && i === selected ? ' selected' : '') + (d?.corrected || d?.origin === 'manual' ? ' fixed' : '');
        return h('button', { class: cls, onclick: () => select(i) }, d?.score.libelle ?? '·');
      }),
      h('span', { class: 'total' }, `= ${volley.total}`),
    );
    history.textContent = lastVolleys.length ? `Volées précédentes : ${lastVolleys.join(' · ')}` : '';
    undoBtn.disabled = volley.darts.length === 0;
  }

  function select(i: number) {
    if (!volley.darts[i]) return;
    selected = i;
    render();
    setNote(`Fléchette ${i + 1} sélectionnée (${volley.darts[i].score.libelle}) : touche l’image à l’endroit de sa pointe.`);
  }

  // --- Corrections au doigt : viser avec la loupe, puis choisir --------------
  const local = (e: PointerEvent): Pt => {
    const r = cam.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  overlay.addEventListener('pointerdown', (e) => {
    if (!detector || !cam.frame()) return;
    hideSheet();
    aim = local(e);
    try {
      overlay.setPointerCapture(e.pointerId);
    } catch {
      /* pas grave */
    }
    e.preventDefault();
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!aim) return;
    aim = local(e);
    e.preventDefault();
  });
  const endAim = () => {
    if (!aim) return;
    const p = aim;
    aim = null;
    loupe.classList.add('hidden');
    pickAt(p);
  };
  overlay.addEventListener('pointerup', endAim);
  overlay.addEventListener('pointercancel', () => {
    aim = null;
    loupe.classList.add('hidden');
  });

  /** Score à un point de l'écran : écran → cadre → image analysée → cible. */
  function scoreAt(screen: Pt): { score: Score; tip: Pt; board: Pt } | null {
    const f = cam.frame();
    if (!f || !detector) return null;
    const n = screenToFrame(f.screen, screen);
    const tip = { x: n.x * detSize.w, y: n.y * detSize.h };
    const board = applyH(detector.frameToBoard, tip);
    return { score: scoreFromBoardCoords(board.x, board.y), tip, board };
  }

  function pickAt(screen: Pt) {
    const r = scoreAt(screen);
    if (!r) return;
    const sel = volley.darts[selected];
    const buttons: HTMLElement[] = [];
    if (sel) {
      buttons.push(
        h('button', {
          class: 'big primary',
          onclick: () => {
            volley.correct(selected, r.score, r.tip, r.board);
            hideSheet();
            setNote(`Fléchette ${selected + 1} corrigée : ${r.score.libelle}.`);
            afterChange(r.score);
            selected = volley.darts.length - 1;
            render();
          },
        }, `Corriger « ${sel.score.libelle} » → ${r.score.libelle}`),
      );
    }
    if (!volley.full) {
      buttons.push(
        h('button', {
          class: sel ? 'big' : 'big primary',
          onclick: () => {
            volley.addManual(r.score, r.tip, r.board);
            detector?.noteManualDart();
            hideSheet();
            setNote(`Fléchette oubliée ajoutée : ${r.score.libelle}.`);
            afterChange(r.score);
          },
        }, `Ajouter une fléchette : ${r.score.libelle}`),
      );
    }
    buttons.push(h('button', { class: 'big', onclick: () => hideSheet() }, 'Fermer'));
    showSheet(`Pointe touchée : ${r.score.libelle} (${r.score.points} pts)`, buttons);
  }

  function showSheet(title: string, buttons: HTMLElement[]) {
    sheet.replaceChildren(h('p', {}, title), ...buttons);
    sheet.classList.remove('hidden');
  }
  function hideSheet() {
    sheet.classList.add('hidden');
  }

  function boardMenu() {
    showSheet('Cible', [
      h('button', { class: 'big', onclick: () => (hideSheet(), void findBoard()) }, 'Redétecter la cible'),
      h('button', { class: 'big', onclick: () => nav('calibrate') }, 'Ajuster à la main'),
      h('button', { class: 'big', onclick: () => hideSheet() }, 'Fermer'),
    ]);
  }

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
      if (volley.full) detector.setMode('removal');
    }
    const events = detector.process(img, performance.now());
    for (const ev of events) {
      if (ev.kind === 'dart') onDart(ev, img);
      else if (ev.kind === 'cleared') cleared(false);
      else if (ev.kind === 'moved') {
        setNote('Le trépied a bougé : nouvelle détection de la cible…', true);
        void findBoard();
        return;
      } else if (ev.kind === 'ignored' && ev.reason === 'big' && !volley.full) {
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
    const ov = B2F ? boardOverlay(B2F, refW, refH) : null;
    if (ov) drawBoardOverlay(c, ov, (p) => frameToScreen(f.screen, p), { alpha: debugMode ? 0.6 : 0.35, numbers: false });
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
    volley.darts.forEach((d, i) => {
      if (!d.tip) return;
      const s = toScreen(f, d.tip);
      dot(c, s, i === selected ? '#ff2020' : '#ffae00', i === selected ? 8 : 6);
      c.font = 'bold 16px -apple-system, sans-serif';
      c.fillStyle = '#fff';
      c.strokeStyle = 'rgba(0,0,0,0.8)';
      c.lineWidth = 3;
      c.strokeText(d.score.libelle, s.x + 10, s.y - 10);
      c.fillText(d.score.libelle, s.x + 10, s.y - 10);
    });

    // Visée au doigt : loupe + score sous le viseur.
    const v = cam.source?.video;
    if (aim && v) {
      const n = screenToFrame(f.screen, aim);
      showLoupe(loupe, v, f, n, aim, cam.el.clientWidth, (lc, toLoupe) => {
        if (ov) drawBoardOverlay(lc, ov, (q) => toLoupe(frameToScreen(f.screen, q)), { alpha: 0.7, lineWidth: 1, numbers: false });
        const r = scoreAt(aim!);
        if (r) {
          lc.font = 'bold 22px -apple-system, sans-serif';
          lc.textAlign = 'center';
          lc.lineWidth = 4;
          lc.strokeStyle = 'rgba(0,0,0,0.85)';
          lc.fillStyle = '#ffe14d';
          lc.strokeText(r.score.libelle, 75, 140);
          lc.fillText(r.score.libelle, 75, 140);
        }
      });
    }
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
        const val = d.mask.data[i];
        id.data[4 * i] = val;
        id.data[4 * i + 1] = val;
        id.data[4 * i + 2] = val;
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
    const stateFr = { warmup: 'référence…', watching: 'à l’affût', moving: 'mouvement', removal: 'attente du retrait' }[d.state];
    stats.textContent =
      `${stateFr} · ${fps.toFixed(1)} img/s · ${d.processMs.toFixed(0)} ms` +
      (d.analyseMs != null ? ` (analyse ${d.analyseMs.toFixed(0)} ms)` : '') +
      ` · mvt ${d.motion}/${d.motionLimit.toFixed(0)} · décalage ${d.shift.x.toFixed(1)},${d.shift.y.toFixed(1)} px` +
      (d.area != null ? ` · aire ${d.area.toFixed(0)} (min ${d.minArea.toFixed(0)}, max ${d.maxArea.toFixed(0)})` : '') +
      (d.cleanDiff != null ? ` · retrait ${d.cleanDiff}/${d.minArea.toFixed(0)}` : '') +
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
    volley.darts.forEach((d) => {
      if (!d.board) return;
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

  render();
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
