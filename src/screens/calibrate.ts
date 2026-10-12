import {
  boardOverlay,
  CALIB_TARGETS,
  calibrationMismatch,
  loadCalibration,
  reprojectionError,
  saveCalibration,
  tryBoardToFrame,
  type Calibration,
} from '../calibration';
import { createCameraStage } from '../camera-stage';
import { miniBoardSvg } from '../board-svg';
import { h } from '../dom';
import { frameToScreen, screenToFrame } from '../frameview';
import type { Pt } from '../homography';
import type { Nav, Screen } from '../main';
import { drawBoardOverlay, fitCanvas } from '../overlay-draw';

/** Taille de référence du cadre pour les calculs d'homographie (seul le rapport compte). */
const REF_W = 1000;

const LOUPE_SIZE = 150;
const LOUPE_ZOOM = 3;
/** Distance (px) en dessous de laquelle un toucher attrape un repère existant. */
const GRAB_RADIUS = 40;
/** Un repère déplacé bouge 2× moins vite que le doigt : réglage fin. */
const FINE_FACTOR = 0.5;

export function calibrateScreen(nav: Nav): Screen {
  const cam = createCameraStage(nav);
  let points: Pt[] = [];
  let drag: { index: number; mode: 'place' | 'move'; finger: Pt; start: Pt } | null = null;
  let raf = 0;

  const overlay = h('canvas', { class: 'overlay interactive' });
  const loupe = h('canvas', { class: 'loupe hidden' });
  const schema = h('div', { class: 'calib-schema' });
  const stepText = h('div', { class: 'calib-step' });
  const hintText = h('div', { class: 'calib-hint' });
  const card = h('div', { class: 'calib-card' }, schema, h('div', {}, stepText, hintText));

  const undoBtn = h('button', { class: 'big', onclick: () => undo() }, 'Annuler le repère');
  const restartBtn = h('button', { class: 'big', onclick: () => restart() }, 'Recommencer');
  const validateBtn = h('button', { class: 'big primary', onclick: () => validate() }, 'Valider');
  const actions = h('div', { class: 'calib-actions' }, undoBtn, restartBtn, validateBtn);

  cam.el.insertBefore(overlay, cam.el.children[1]);
  cam.el.append(card, loupe);
  cam.dock.append(actions);

  const aspect = () => {
    const f = cam.frame();
    return f ? f.crop.w / f.crop.h : null;
  };

  // Reprend la calibration existante si elle correspond toujours (zoom, orientation).
  function loadExisting() {
    const kind = cam.source?.kind;
    const a = aspect();
    if (!kind || a == null) return;
    const cal = loadCalibration(kind);
    points = cal && !calibrationMismatch(cal, { zoom: cam.zoomValue(), aspect: a }) ? cal.points.map((p) => ({ ...p })) : [];
    updateUi();
  }

  cam.onChange((reason) => {
    if (reason === 'source') {
      points = [];
      // La première image peut mettre un instant à arriver.
      const wait = () => (cam.frame() ? loadExisting() : cam.source && setTimeout(wait, 100));
      wait();
    } else {
      points = []; // le zoom a changé : les repères ne correspondent plus
    }
    updateUi();
  });

  function undo() {
    points.pop();
    updateUi();
  }
  function restart() {
    points = [];
    updateUi();
  }

  function validate() {
    const kind = cam.source?.kind;
    const a = aspect();
    if (!kind || a == null || points.length < CALIB_TARGETS.length) return;
    const cal: Calibration = {
      version: 1,
      kind,
      points,
      zoom: cam.zoomValue(),
      aspect: a,
      createdAt: new Date().toISOString(),
    };
    if (!saveCalibration(cal)) {
      hintText.textContent = 'Impossible d’enregistrer la calibration sur ce téléphone (stockage bloqué ?).';
      return;
    }
    nav('home');
  }

  function error(): number | null {
    const a = aspect();
    if (a == null || points.length < CALIB_TARGETS.length) return null;
    try {
      return reprojectionError(points, REF_W, REF_W / a);
    } catch {
      return null;
    }
  }

  function updateUi() {
    const n = points.length;
    const done = n >= CALIB_TARGETS.length;
    const target = CALIB_TARGETS[Math.min(n, CALIB_TARGETS.length - 1)];
    schema.innerHTML = miniBoardSvg(done ? null : target.board);
    if (!done) {
      stepText.textContent = `Repère ${n + 1}/5 : ${target.label}`;
      hintText.textContent =
        n === 0
          ? 'Règle d’abord le zoom. Pose le doigt sur la cible : une loupe t’aide à viser, lâche au bon endroit.'
          : 'Tu peux faire glisser un repère déjà posé pour le corriger.';
    } else {
      stepText.textContent = 'Vérifie que le dessin jaune colle à la cible';
      const e = error();
      const quality = e == null ? '' : e < 2 ? ' — très bien' : e < 5 ? ' — correct' : ' — un repère semble mal placé';
      hintText.textContent =
        `Fais glisser un repère pour ajuster (il bouge moins vite que le doigt, pour plus de précision).` +
        (e == null ? '' : ` Écart moyen : ${e.toFixed(1).replace('.', ',')} mm${quality}.`);
      hintText.classList.toggle('warn', e != null && e >= 5);
    }
    if (done) hintText.classList.toggle('warn', (error() ?? 0) >= 5);
    else hintText.classList.remove('warn');
    cam.zoomBar.classList.toggle('hidden', n > 0);
    undoBtn.classList.toggle('hidden', n === 0 || done);
    restartBtn.classList.toggle('hidden', n === 0);
    validateBtn.classList.toggle('hidden', !done);
  }

  // --- Toucher : poser / déplacer les repères --------------------------------
  const local = (e: PointerEvent): Pt => {
    const r = cam.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  overlay.addEventListener('pointerdown', (e) => {
    const f = cam.frame();
    if (!f || drag) return;
    const sp = local(e);
    let best = -1;
    let bestD = points.length >= CALIB_TARGETS.length ? GRAB_RADIUS * 2 : GRAB_RADIUS;
    points.forEach((p, i) => {
      const s = frameToScreen(f.screen, p);
      const d = Math.hypot(s.x - sp.x, s.y - sp.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) {
      drag = { index: best, mode: 'move', finger: sp, start: frameToScreen(f.screen, points[best]) };
    } else if (points.length < CALIB_TARGETS.length) {
      points.push(screenToFrame(f.screen, sp));
      drag = { index: points.length - 1, mode: 'place', finger: sp, start: sp };
      updateUi();
    } else return;
    try {
      overlay.setPointerCapture(e.pointerId);
    } catch {
      /* sans capture, le glisser marche tant que le doigt reste sur l’écran */
    }
    e.preventDefault();
  });

  overlay.addEventListener('pointermove', (e) => {
    const f = cam.frame();
    if (!drag || !f) return;
    const sp = local(e);
    const s =
      drag.mode === 'place'
        ? sp
        : {
            x: drag.start.x + (sp.x - drag.finger.x) * FINE_FACTOR,
            y: drag.start.y + (sp.y - drag.finger.y) * FINE_FACTOR,
          };
    points[drag.index] = screenToFrame(f.screen, s);
    e.preventDefault();
  });

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    updateUi();
  };
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);

  // --- Dessin -------------------------------------------------------------
  function draw() {
    raf = requestAnimationFrame(draw);
    const W = cam.el.clientWidth;
    const H = cam.el.clientHeight;
    const ctx = fitCanvas(overlay, W, H);
    const f = cam.frame();
    if (!f) return;
    const toScreen = (p: Pt) => frameToScreen(f.screen, p);
    const a = f.crop.w / f.crop.h;
    const refH = REF_W / a;

    const B2F = tryBoardToFrame(points, REF_W, refH);
    const ov = B2F ? boardOverlay(B2F, REF_W, refH) : null;
    if (ov) drawBoardOverlay(ctx, ov, toScreen);

    points.forEach((p, i) => drawMarker(ctx, toScreen(p), i, drag?.index === i));
    drawLoupe(f, toScreen, ov);
  }

  function drawMarker(ctx: CanvasRenderingContext2D, s: Pt, i: number, active: boolean) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = active ? '#2af5ff' : '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 11, 0, Math.PI * 2);
    ctx.moveTo(s.x - 17, s.y);
    ctx.lineTo(s.x - 5, s.y);
    ctx.moveTo(s.x + 5, s.y);
    ctx.lineTo(s.x + 17, s.y);
    ctx.moveTo(s.x, s.y - 17);
    ctx.lineTo(s.x, s.y - 5);
    ctx.moveTo(s.x, s.y + 5);
    ctx.lineTo(s.x, s.y + 17);
    ctx.stroke();
    ctx.font = 'bold 14px -apple-system, sans-serif';
    ctx.fillStyle = active ? '#2af5ff' : '#fff';
    ctx.fillText(String(i + 1), s.x + 13, s.y - 13);
    ctx.restore();
  }

  // Loupe : image agrandie ×3 autour du repère en cours, affichée au-dessus du doigt.
  function drawLoupe(
    f: NonNullable<ReturnType<typeof cam.frame>>,
    toScreen: (p: Pt) => Pt,
    ov: ReturnType<typeof boardOverlay> | null,
  ) {
    const v = cam.source?.video;
    // Pendant qu'on vise, la carte d'instructions s'efface pour ne pas cacher la cible.
    card.classList.toggle('faded', !!drag);
    if (!drag || !v) {
      loupe.classList.add('hidden');
      return;
    }
    const p = points[drag.index];
    const center = toScreen(p);
    const ctx = fitCanvas(loupe, LOUPE_SIZE, LOUPE_SIZE);
    const dispScale = f.screen.w / f.crop.w; // px écran par px vidéo
    const srcSize = LOUPE_SIZE / (dispScale * LOUPE_ZOOM);
    const vx = f.crop.x + p.x * f.crop.w;
    const vy = f.crop.y + p.y * f.crop.h;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.drawImage(v, vx - srcSize / 2, vy - srcSize / 2, srcSize, srcSize, 0, 0, LOUPE_SIZE, LOUPE_SIZE);
    const toLoupe = (q: Pt) => {
      const s = toScreen(q);
      return { x: (s.x - center.x) * LOUPE_ZOOM + LOUPE_SIZE / 2, y: (s.y - center.y) * LOUPE_ZOOM + LOUPE_SIZE / 2 };
    };
    if (ov) drawBoardOverlay(ctx, ov, toLoupe, { alpha: 0.8, lineWidth: 1, numbers: false });
    const c = LOUPE_SIZE / 2;
    ctx.strokeStyle = '#2af5ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c - 20, c);
    ctx.lineTo(c - 4, c);
    ctx.moveTo(c + 4, c);
    ctx.lineTo(c + 20, c);
    ctx.moveTo(c, c - 20);
    ctx.lineTo(c, c - 4);
    ctx.moveTo(c, c + 4);
    ctx.lineTo(c, c + 20);
    ctx.stroke();

    const W = cam.el.clientWidth;
    const above = center.y - 50 - LOUPE_SIZE > 70;
    const left = Math.min(Math.max(center.x - LOUPE_SIZE / 2, 8), W - LOUPE_SIZE - 8);
    const top = above ? center.y - 50 - LOUPE_SIZE : center.y + 50;
    loupe.style.transform = `translate(${left}px, ${top}px)`;
    loupe.classList.remove('hidden');
  }

  updateUi();
  draw();

  return {
    el: cam.el,
    dispose() {
      cancelAnimationFrame(raf);
      cam.dispose();
    },
  };
}
