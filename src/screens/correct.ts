// Fenêtre de correction d'une fléchette (ou d'ajout d'une fléchette oubliée) :
// - image de la cible redressée DE FACE (prise au moment de la fléchette) : on touche
//   la pointe, le score s'affiche sous le doigt ;
// - ou pavé : Simple / Double / Triple puis le numéro, 25, Bull, Raté.

import { boardPoint, makeScore, MISS, RADII, scoreFromBoardCoords, SECTORS, SECTOR_ANGLE, type Score } from '../board';
import { h } from '../dom';
import type { Mat3, Pt } from '../homography';
import { icon } from '../icons';
import { rectifyRGBA } from '../rectify';
import { openSheet } from '../ui';

const HALF_MM = 210; // la vue couvre ±210 mm : toute la cible et les numéros

export interface CorrectionOptions {
  title: string;
  /** Image analysée au moment de la fléchette (ou image actuelle pour un ajout). */
  image: ImageData | null;
  frameToBoard: Mat3 | null;
  /** Position et score actuels (correction) ou null (ajout). */
  current: { score: Score; board: Pt | null } | null;
  /** Autres fléchettes de la volée, affichées en gris. */
  others: Pt[];
  onConfirm(score: Score, board: Pt | null): void;
  onDelete?: () => void;
  /** Fenêtre fermée (quelle que soit la façon). */
  onClose?: () => void;
}

export function openCorrection(o: CorrectionOptions) {
  let candidate: { score: Score; board: Pt | null } | null = o.current ? { ...o.current } : null;
  let mult: 1 | 2 | 3 = o.current && o.current.score.multiplicateur >= 1 && o.current.score.secteur !== 25 ? (o.current.score.multiplicateur as 1 | 2 | 3) : 1;

  // --- Vue de face -----------------------------------------------------------
  const base = h('canvas');
  const marks = h('canvas');
  const mag = h('canvas', { class: 'front-mag hidden' });
  const front = h('div', { class: 'front-wrap' }, base, marks, mag);
  const hint = h('p', { class: 'front-hint' }, 'Touche la pointe de la fléchette sur l’image');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let px = 0; // taille du canvas en pixels physiques

  function drawBase() {
    const cssSize = front.clientWidth || 340;
    px = Math.round(cssSize * dpr);
    base.width = marks.width = px;
    base.height = marks.height = px;
    const ctx = base.getContext('2d')!;
    if (o.image && o.frameToBoard) {
      // Rendu à résolution réduite puis agrandi : rapide, et assez net pour viser.
      const n = Math.min(px, 520);
      const rect = rectifyRGBA(o.image, o.frameToBoard, n, HALF_MM);
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = n;
      tmp.getContext('2d')!.putImageData(rect, 0, 0);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tmp, 0, 0, px, px);
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, px, px);
    }
    drawGuides(ctx);
    drawMarks();
  }

  const toPx = (b: Pt) => ({ x: ((b.x + HALF_MM) / (2 * HALF_MM)) * px, y: ((HALF_MM - b.y) / (2 * HALF_MM)) * px });
  const toBoard = (x: number, y: number): Pt => ({ x: (x / px) * 2 * HALF_MM - HALF_MM, y: HALF_MM - (y / px) * 2 * HALF_MM });

  // Fins repères des anneaux et secteurs (aident à viser sans masquer l'image).
  function drawGuides(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 225, 77, 0.35)';
    ctx.lineWidth = Math.max(1, dpr * 0.75);
    const c = toPx({ x: 0, y: 0 });
    const k = px / (2 * HALF_MM);
    for (const r of [RADII.outerBull, RADII.tripleInner, RADII.tripleOuter, RADII.doubleInner, RADII.doubleOuter]) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    SECTORS.forEach((_, i) => {
      const a = toPx(boardPoint(RADII.outerBull, i * SECTOR_ANGLE + 9));
      const b = toPx(boardPoint(RADII.doubleOuter, i * SECTOR_ANGLE + 9));
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function dot(ctx: CanvasRenderingContext2D, b: Pt, fill: string, r: number) {
    const p = toPx(b);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * dpr, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }

  function drawMarks() {
    const ctx = marks.getContext('2d')!;
    ctx.clearRect(0, 0, px, px);
    for (const b of o.others) dot(ctx, b, 'rgba(150,150,150,0.9)', 5);
    if (candidate?.board) {
      dot(ctx, candidate.board, '#ff2020', 6);
      const p = toPx(candidate.board);
      ctx.font = `800 ${16 * dpr}px -apple-system, sans-serif`;
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.fillStyle = '#ffe14d';
      ctx.strokeText(candidate.score.libelle, p.x + 10 * dpr, p.y - 10 * dpr);
      ctx.fillText(candidate.score.libelle, p.x + 10 * dpr, p.y - 10 * dpr);
    }
  }

  // Loupe au-dessus du doigt (×2,5) pendant qu'on vise.
  function showMag(cx: number, cy: number) {
    const size = 120;
    mag.width = mag.height = size * dpr;
    const ctx = mag.getContext('2d')!;
    const src = (size / 2.5) * dpr;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, mag.width, mag.height);
    ctx.drawImage(base, cx * dpr - src / 2, cy * dpr - src / 2, src, src, 0, 0, mag.width, mag.height);
    ctx.drawImage(marks, cx * dpr - src / 2, cy * dpr - src / 2, src, src, 0, 0, mag.width, mag.height);
    ctx.strokeStyle = '#2af5ff';
    ctx.lineWidth = 2;
    const m = mag.width / 2;
    ctx.beginPath();
    ctx.moveTo(m - 14, m);
    ctx.lineTo(m + 14, m);
    ctx.moveTo(m, m - 14);
    ctx.lineTo(m, m + 14);
    ctx.stroke();
    const w = front.clientWidth;
    mag.style.left = `${Math.min(Math.max(cx - size / 2, 4), w - size - 4)}px`;
    mag.style.top = `${cy - size - 36 > 4 ? cy - size - 36 : cy + 36}px`;
    mag.classList.remove('hidden');
  }

  let aiming = false;
  const pick = (e: PointerEvent) => {
    if (!px || base.width !== Math.round(front.clientWidth * dpr)) drawBase();
    const r = front.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const b = toBoard(cx * dpr, cy * dpr);
    candidate = { score: scoreFromBoardCoords(b.x, b.y), board: b };
    syncKeypad();
    drawMarks();
    showMag(cx, cy);
    updateConfirm();
  };
  front.addEventListener('pointerdown', (e) => {
    aiming = true;
    try {
      front.setPointerCapture(e.pointerId);
    } catch {
      /* pas grave */
    }
    pick(e);
    e.preventDefault();
  });
  front.addEventListener('pointermove', (e) => aiming && pick(e));
  const stop = () => {
    aiming = false;
    mag.classList.add('hidden');
  };
  front.addEventListener('pointerup', stop);
  front.addEventListener('pointercancel', stop);

  // --- Pavé ------------------------------------------------------------------
  const multBtns = ([1, 2, 3] as const).map((m) =>
    h('button', { class: 'seg', onclick: () => setMult(m) }, m === 1 ? 'Simple' : m === 2 ? 'Double' : 'Triple'),
  );
  const numBtns = Array.from({ length: 20 }, (_, i) => h('button', { class: 'key', onclick: () => setNumber(i + 1) }, String(i + 1)));
  const k25 = h('button', { class: 'key', onclick: () => setScore(makeScore(25, 1)) }, '25');
  const kBull = h('button', { class: 'key', onclick: () => setScore(makeScore(25, 2)) }, 'Bull');
  const kMiss = h('button', { class: 'key', onclick: () => setScore(MISS) }, 'Raté');
  const keypad = h(
    'div',
    { class: 'keypad' },
    h('div', { class: 'segmented' }, ...multBtns),
    h('div', { class: 'nums' }, ...numBtns),
    h('div', { class: 'extras' }, k25, kBull, kMiss),
  );

  function setMult(m: 1 | 2 | 3) {
    mult = m;
    if (candidate && candidate.score.secteur >= 1 && candidate.score.secteur <= 20) setScore(makeScore(candidate.score.secteur, m));
    syncKeypad();
  }
  function setNumber(n: number) {
    setScore(makeScore(n, mult));
  }
  function setScore(s: Score) {
    // Choisi au pavé : on ne connaît pas la position exacte.
    candidate = { score: s, board: null };
    syncKeypad();
    drawMarks();
    updateConfirm();
  }
  function syncKeypad() {
    const s = candidate?.score;
    if (s && s.secteur >= 1 && s.secteur <= 20) mult = s.multiplicateur as 1 | 2 | 3;
    multBtns.forEach((b, i) => b.classList.toggle('on', mult === i + 1));
    numBtns.forEach((b, i) => b.classList.toggle('on', s?.secteur === i + 1));
    k25.classList.toggle('on', s?.libelle === '25');
    kBull.classList.toggle('on', s?.libelle === 'BULL');
    kMiss.classList.toggle('on', !!s && s.points === 0);
  }

  // --- Actions ---------------------------------------------------------------
  const confirm = h('button', { class: 'btn primary lg', onclick: () => done() });
  function updateConfirm() {
    confirm.disabled = !candidate;
    confirm.replaceChildren(icon('check', 20), candidate ? `Valider ${candidate.score.libelle}` : 'Choisis le score');
  }
  const del = o.onDelete
    ? h('button', { class: 'btn danger lg', onclick: () => (o.onDelete!(), sheet.close()) }, icon('trash', 20), 'Supprimer')
    : h('button', { class: 'btn lg', onclick: () => sheet.close() }, 'Annuler');
  function done() {
    if (!candidate) return;
    o.onConfirm(candidate.score, candidate.board);
    sheet.close();
  }

  const sheet = openSheet([front, hint, keypad, h('div', { class: 'correct-actions' }, del, confirm)], {
    title: o.title,
    tall: true,
    onClose: o.onClose,
  });
  syncKeypad();
  updateConfirm();
  // Dessin dès que la fenêtre est en place (et de nouveau si sa taille change).
  requestAnimationFrame(drawBase);
  setTimeout(() => base.width !== Math.round(front.clientWidth * dpr) && drawBase(), 300);
  return sheet;
}
