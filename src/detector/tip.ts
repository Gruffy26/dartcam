// Trouver la pointe d'une fléchette à partir des pixels qui ont changé (sa silhouette).
//
// 1. Axe de la fléchette : analyse en composantes principales des pixels.
// 2. Les deux extrémités : projections extrêmes (en ignorant 1 % de points isolés).
// 3. Quelle extrémité est la pointe ? Trois indices pondérés :
//    - le corps de la fléchette sort de la cible vers la caméra : à l'image, il part
//      dans une direction connue grâce à la calibration (modèle de caméra) ;
//    - la pointe est l'extrémité la plus fine (l'empennage est large) ;
//    - la pointe est sur la cible (ou tout près), l'empennage souvent hors de la cible.
// 4. Position précise : sur l'axe central, au bout côté pointe.

import { scoreFromBoardCoords } from '../board';
import { applyH, type Mat3, type Pt } from '../homography';

export interface TipInput {
  /** Pixels de la silhouette (x, y alternés). */
  xy: ArrayLike<number>;
  /** Direction de sortie attendue à l'image (de la pointe vers l'empennage), si connue. */
  outDir?: Pt | null;
  /** Rayon sur la cible (mm) d'un point de l'image, si la calibration est connue. */
  boardRadius?: (p: Pt) => number;
}

export interface TipResult {
  tip: Pt;
  tail: Pt;
  /** Axe unitaire de la pointe vers l'empennage. */
  axis: Pt;
  length: number;
  widthTip: number;
  widthTail: number;
  /** Confiance dans le choix de l'extrémité (0–1). */
  confidence: number;
  votes: { direction: number; width: number; board: number };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

export function findTip(input: TipInput): TipResult | null {
  const { xy } = input;
  const n = xy.length / 2;
  if (n < 10) return null;

  const ax = principalAxis(xy);
  const mx = ax.mean.x;
  const my = ax.mean.y;
  const v = ax.v;
  const w = { x: -v.y, y: v.x };

  const s = new Float64Array(n);
  const q = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dx = xy[2 * i] - mx;
    const dy = xy[2 * i + 1] - my;
    s[i] = dx * v.x + dy * v.y;
    q[i] = dx * w.x + dy * w.y;
  }
  const sSorted = Array.from(s).sort((a, b) => a - b);
  const sMin = percentile(sSorted, 0.005);
  const sMax = percentile(sSorted, 0.995);
  const length = sMax - sMin;
  if (length < 5) return null;

  // Largeur et ligne centrale près de chaque bout.
  const band = Math.max(4, length * 0.15);
  const endStats = (from: number, dir: 1 | -1) => {
    const qs: number[] = [];
    const near: number[] = [];
    for (let i = 0; i < n; i++) {
      const d = dir > 0 ? s[i] - from : from - s[i];
      if (d >= 0 && d <= band) qs.push(q[i]);
      if (d >= 0 && d <= Math.min(band, 6)) near.push(q[i]);
    }
    qs.sort((a, b) => a - b);
    near.sort((a, b) => a - b);
    return { width: percentile(qs, 0.9) - percentile(qs, 0.1), center: percentile(near, 0.5) };
  };
  const A = endStats(sMin, 1);
  const B = endStats(sMax, -1);
  const pA = { x: mx + v.x * sMin + w.x * A.center, y: my + v.y * sMin + w.y * A.center };
  const pB = { x: mx + v.x * sMax + w.x * B.center, y: my + v.y * sMax + w.y * B.center };

  // Votes > 0 : A est la pointe ; < 0 : B est la pointe.
  const votes = { direction: 0, width: 0, board: 0 };
  if (input.outDir) {
    // De la pointe vers l'empennage = direction de sortie.
    const ab = (v.x * input.outDir.x + v.y * input.outDir.y);
    votes.direction = 2 * ab; // |ab| ≈ 1 si l'axe est bien aligné
  }
  const wsum = A.width + B.width;
  if (wsum > 0) votes.width = (B.width - A.width) / wsum; // A plus fin → positif
  if (input.boardRadius) {
    const rA = input.boardRadius(pA);
    const rB = input.boardRadius(pB);
    const inA = rA <= 180;
    const inB = rB <= 180;
    if (inA !== inB) votes.board = inA ? 1.5 : -1.5;
  }
  const total = votes.direction + votes.width + votes.board;
  const aIsTip = total >= 0;
  const confidence = Math.min(1, Math.abs(total) / 2);
  const tip = aIsTip ? pA : pB;
  const tail = aIsTip ? pB : pA;
  const axis = aIsTip ? v : { x: -v.x, y: -v.y };
  return {
    tip,
    tail,
    axis,
    length,
    widthTip: aIsTip ? A.width : B.width,
    widthTail: aIsTip ? B.width : A.width,
    confidence,
    votes,
  };
}

export interface Component {
  /** Pixels (x, y alternés). */
  xy: number[];
}

/** Axe principal d'un ensemble de pixels. */
export function principalAxis(xy: ArrayLike<number>) {
  const n = xy.length / 2;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xy[2 * i];
    my += xy[2 * i + 1];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sMin = Infinity;
  let sMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = xy[2 * i] - mx;
    const dy = xy[2 * i + 1] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const line = refineCenterline(xy, { x: mx, y: my }, { x: Math.cos(theta), y: Math.sin(theta) });
  const v = line.v;
  const m = line.mean;
  for (let i = 0; i < n; i++) {
    const s = (xy[2 * i] - m.x) * v.x + (xy[2 * i + 1] - m.y) * v.y;
    if (s < sMin) sMin = s;
    if (s > sMax) sMax = s;
  }
  return { mean: m, v, sMin, sMax, length: sMax - sMin };
}

/**
 * Ligne centrale de la silhouette : on découpe le long de l'axe en tranches de 4 px,
 * on prend le milieu de chaque tranche, puis on ajuste une droite sur ces milieux.
 * Chaque tranche compte autant : l'empennage, large, ne fausse plus l'axe du fût.
 */
export function refineCenterline(xy: ArrayLike<number>, mean: Pt, v0: Pt): { mean: Pt; v: Pt } {
  let m = mean;
  let v = v0;
  const n = xy.length / 2;
  for (let iter = 0; iter < 3; iter++) {
    const w = { x: -v.y, y: v.x };
    const bins = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const dx = xy[2 * i] - m.x;
      const dy = xy[2 * i + 1] - m.y;
      const b = Math.round((dx * v.x + dy * v.y) / 4);
      const q = dx * w.x + dy * w.y;
      const arr = bins.get(b);
      if (arr) arr.push(q);
      else bins.set(b, [q]);
    }
    const pts: { s: number; q: number }[] = [];
    for (const [b, qs] of bins) {
      if (qs.length < 2) continue;
      qs.sort((a, c) => a - c);
      pts.push({ s: b * 4, q: qs[qs.length >> 1] });
    }
    if (pts.length < 4) break;
    // Droite q = a + k·s (moindres carrés).
    let ss = 0;
    let sq = 0;
    let sss = 0;
    let ssq = 0;
    for (const p of pts) {
      ss += p.s;
      sq += p.q;
      sss += p.s * p.s;
      ssq += p.s * p.q;
    }
    const N = pts.length;
    const den = N * sss - ss * ss;
    if (Math.abs(den) < 1e-9) break;
    const k = (N * ssq - ss * sq) / den;
    const a = (sq - k * ss) / N;
    const nv = { x: v.x + k * w.x, y: v.y + k * w.y };
    const l = Math.hypot(nv.x, nv.y);
    m = { x: m.x + a * w.x, y: m.y + a * w.y };
    v = { x: nv.x / l, y: nv.y / l };
    if (Math.abs(k) < 1e-3 && Math.abs(a) < 0.05) break;
  }
  return { mean: m, v };
}

/**
 * Rassemble les morceaux d'une même fléchette : le fût, peu contrasté sur certaines
 * zones de la cible, apparaît souvent en plusieurs taches alignées avec la principale.
 */
export function mergeAlongAxis(main: Component, others: Component[]): { xy: number[]; merged: number } {
  const ax = principalAxis(main.xy);
  const w = { x: -ax.v.y, y: ax.v.x };
  const tol = Math.max(6, ax.length * 0.08);
  const reach = Math.max(30, ax.length * 0.8);
  const xy = [...main.xy];
  let merged = 0;
  for (const c of others) {
    const n = c.xy.length / 2;
    if (n === 0) continue;
    let ok = true;
    let along = 0;
    for (let i = 0; i < n && ok; i++) {
      const dx = c.xy[2 * i] - ax.mean.x;
      const dy = c.xy[2 * i + 1] - ax.mean.y;
      const s = dx * ax.v.x + dy * ax.v.y;
      const q = dx * w.x + dy * w.y;
      if (Math.abs(q) > tol) ok = false;
      along += s;
    }
    along /= n;
    if (ok && along > ax.sMin - reach && along < ax.sMax + reach) {
      for (let i = 0; i < c.xy.length; i++) xy.push(c.xy[i]);
      merged++;
    }
  }
  return { xy, merged };
}

/**
 * Prolonge la pointe le long de l'axe tant qu'il reste une trace de changement
 * (seuil plus bas) : le bout du fût est souvent peu contrasté contre la cible.
 * @param diff différence absolue (0–255), non seuillée
 */
export function extendTip(
  tip: Pt,
  axis: Pt,
  diff: ArrayLike<number>,
  width: number,
  height: number,
  low: number,
  maxLen = 60,
  maxGap = 5,
): { tip: Pt; extended: number } {
  const w = { x: -axis.y, y: axis.x };
  let last = 0;
  let gap = 0;
  for (let d = 1; d <= maxLen; d++) {
    let best = 0;
    for (let q = -2; q <= 2; q++) {
      const x = Math.round(tip.x - axis.x * d + w.x * q);
      const y = Math.round(tip.y - axis.y * d + w.y * q);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      best = Math.max(best, diff[y * width + x]);
    }
    if (best >= low) {
      last = d;
      gap = 0;
    } else if (++gap > maxGap) break;
  }
  return { tip: { x: tip.x - axis.x * last, y: tip.y - axis.y * last }, extended: last };
}

/**
 * Localise une fléchette quand on connaît sa direction approximative à l'image
 * (modèle de caméra) : on cherche la droite qui passe par le plus de pixels changés,
 * orientée à ±35° de la direction attendue (tirages aléatoires, RANSAC). C'est le fût,
 * la plus longue partie droite ; un empennage large ou des morceaux séparés ne
 * faussent plus l'axe. La pointe est le bout de cette droite côté cible.
 */
export function locateDart(xy: ArrayLike<number>, outDir: Pt, maxAngleDeg = 35): TipResult | null {
  const n = xy.length / 2;
  if (n < 15) return null;
  const stride = Math.max(1, Math.floor(n / 2000));
  const sx: number[] = [];
  const sy: number[] = [];
  for (let i = 0; i < n; i += stride) {
    sx.push(xy[2 * i]);
    sy.push(xy[2 * i + 1]);
  }
  const m = sx.length;
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let best = { count: -1, px: 0, py: 0, dx: 0, dy: 0 };
  const bins = new Set<number>();
  for (let it = 0; it < 500; it++) {
    const i = Math.floor(rand() * m);
    const j = Math.floor(rand() * m);
    const dx = sx[j] - sx[i];
    const dy = sy[j] - sy[i];
    const len = Math.hypot(dx, dy);
    if (len < 12) continue;
    const ux = dx / len;
    const uy = dy / len;
    if (Math.abs(ux * outDir.x + uy * outDir.y) < cosMax) continue;
    // Score = longueur couverte (tranches de 3 px occupées le long de la droite) :
    // le fût, long et fin, l'emporte sur l'empennage, court et épais.
    bins.clear();
    for (let k = 0; k < m; k++) {
      const ex = sx[k] - sx[i];
      const ey = sy[k] - sy[i];
      if (Math.abs(ex * uy - ey * ux) < 2) bins.add(Math.round((ex * ux + ey * uy) / 3));
    }
    const count = bins.size;
    if (count > best.count) best = { count, px: sx[i], py: sy[i], dx: ux, dy: uy };
  }
  if (best.count < 5) return null;

  // Affinage : axe principal des pixels proches de la droite trouvée.
  const inl: number[] = [];
  for (let k = 0; k < n; k++) {
    const x = xy[2 * k];
    const y = xy[2 * k + 1];
    if (Math.abs((x - best.px) * best.dy - (y - best.py) * best.dx) < 3) inl.push(x, y);
  }
  const ax = principalAxis(inl);
  let v = ax.v;
  if (v.x * outDir.x + v.y * outDir.y < 0) v = { x: -v.x, y: -v.y }; // de la pointe vers l'empennage
  const s = [];
  for (let k = 0; k < inl.length; k += 2) s.push((inl[k] - ax.mean.x) * v.x + (inl[k + 1] - ax.mean.y) * v.y);
  s.sort((a, b) => a - b);
  // Depuis le milieu, on descend vers la pointe tant que les trous restent petits
  // (≤ 20 px : seuls les pixels alignés sur la droite comptent, rien d’autre ne peut s’y rattacher).
  const mid = s.length >> 1;
  let lo = mid;
  while (lo > 0 && s[lo] - s[lo - 1] < 20) lo--;
  let hi = mid;
  while (hi < s.length - 1 && s[hi + 1] - s[hi] < 25) hi++;
  // Recentrage : un fût brillant ne « change » souvent que sur ses bords ; la droite
  // trouvée peut longer un bord. On prend le milieu de tous les pixels proches de la
  // droite (±7 px) sur les 15 derniers pixels côté pointe.
  const w = { x: -v.y, y: v.x };
  const qs: number[] = [];
  for (let k = 0; k < n; k++) {
    const dx = xy[2 * k] - ax.mean.x;
    const dy = xy[2 * k + 1] - ax.mean.y;
    const sk = dx * v.x + dy * v.y;
    const qk = dx * w.x + dy * w.y;
    if (Math.abs(qk) <= 7 && sk >= s[lo] - 2 && sk <= s[lo] + 15) qs.push(qk);
  }
  qs.sort((a, b) => a - b);
  const qMid = qs.length >= 5 ? (qs[Math.floor(qs.length * 0.1)] + qs[Math.floor(qs.length * 0.9)]) / 2 : 0;
  const tip = { x: ax.mean.x + v.x * s[lo] + w.x * qMid, y: ax.mean.y + v.y * s[lo] + w.y * qMid };
  const tail = { x: ax.mean.x + v.x * s[hi], y: ax.mean.y + v.y * s[hi] };
  const align = Math.abs(v.x * outDir.x + v.y * outDir.y);
  return {
    tip,
    tail,
    axis: v,
    length: s[hi] - s[lo],
    widthTip: 0,
    widthTail: 0,
    confidence: Math.min(1, (inl.length / 2 / n) * 2) * align,
    votes: { direction: 2 * align, width: 0, board: 0 },
  };
}

/**
 * Le score tient-il à un cheveu ? On glisse la pointe de ±`mm` le long de l'axe de la
 * fléchette — la direction dans laquelle l'imprécision se joue — et on regarde si le
 * score change. Mesuré sur 261 fléchettes réelles : la distance au fil le plus proche
 * ne prévoyait aucune des erreurs, parce qu'une pointe mal placée paraît justement
 * bien au milieu d'une case.
 */
export function scoreFragile(F2B: Mat3, tip: Pt, axis: Pt, libelle: string, mm: number): boolean {
  const scale = Math.sqrt(Math.abs(F2B[0] * F2B[4] - F2B[1] * F2B[3])) || 1;
  const d = mm / scale;
  // Le long de l'axe (où se joue la précision du bout) et en travers (où se jouent les
  // secteurs voisins, surtout près du centre : à 6 cm du bull, une case ne fait que 2 cm).
  const perp = { x: -axis.y, y: axis.x };
  for (const dir of [axis, perp]) {
    for (const k of [-d, d]) {
      const p = applyH(F2B, { x: tip.x + dir.x * k, y: tip.y + dir.y * k });
      if (scoreFromBoardCoords(p.x, p.y).libelle !== libelle) return true;
    }
  }
  return false;
}
