// Calibration automatique : trouve la cible dans l'image grâce aux anneaux rouges
// et verts (double et triple), sans que l'utilisateur touche l'écran.
//
// 1. Classe chaque pixel : rouge, vert ou autre (après un flou médian).
// 2. Le plus grand contour rouge+vert = bord extérieur du double → ellipse.
// 3. Le long de l'anneau du double, l'alternance rouge/vert donne les 20 frontières
//    de secteurs ; le 20 est le secteur rouge le plus haut dans l'image
//    (cible accrochée normalement, téléphone à peu près droit).
// 4. Première homographie, puis affinage avec ~150 points précis : frontières de
//    secteurs sur les deux anneaux, bords des anneaux (162/170, 99/107), bord du 25.
// 5. Contrôle : les couleurs attendues (rouge pour les secteurs pairs, vert pour les
//    impairs) doivent se retrouver aux bons endroits.

import { boardPoint, RADII, SECTOR_ANGLE, SECTORS } from './board';
import { CALIB_TARGETS } from './calibration';
import { applyH, computeHomography, invertH, type Mat3, type Pt } from './homography';
import type { CV } from './opencv';
import { rotateCalibration, uprightShift } from './orientation';

export const NONE = 0;
export const RED = 1;
export const GREEN = 2;

export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export type AutoCalibResult =
  | {
      ok: true;
      /** Homographie image (pixels de l'image fournie) → cible (mm). */
      H: Mat3;
      /** Les 5 repères de calibration, en coordonnées normalisées de l'image. */
      points: Pt[];
      /** Écart moyen (mm) des points d'affinage. */
      errorMm: number;
      /** Part des zones colorées de la cible retrouvées avec la bonne couleur (0–1). */
      colorMatch: number;
      correspondences: number;
    }
  | { ok: false; reason: string };

/** Seuils de couleur (HSV : teinte en degrés, saturation et valeur 0–1). Réglables plus tard. */
export const COLOR = {
  redHueMax: 18,
  redHueMin: 335,
  greenHueMin: 75,
  greenHueMax: 175,
  minSat: 0.32,
  minVal: 0.16,
};

/** Classe de couleur de chaque pixel (NONE / RED / GREEN). */
export function classifyPixels(img: RgbaImage): Uint8Array {
  const { data, width, height } = img;
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < out.length; p++, i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (max < COLOR.minVal || d / max < COLOR.minSat) continue;
    let hue: number;
    if (max === r) hue = 60 * (((g - b) / d + 6) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
    if (hue <= COLOR.redHueMax || hue >= COLOR.redHueMin) out[p] = RED;
    else if (hue >= COLOR.greenHueMin && hue <= COLOR.greenHueMax) out[p] = GREEN;
  }
  return out;
}

class ClassMap {
  constructor(
    readonly cls: Uint8Array,
    readonly width: number,
    readonly height: number,
  ) {}
  at(p: Pt): number {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return NONE;
    return this.cls[y * this.width + x];
  }
}

const mod = (a: number, m: number) => ((a % m) + m) % m;
/** Couleur attendue de l'anneau double/triple du secteur d'indice i (20 = rouge). */
const ringColor = (i: number) => (i % 2 === 0 ? RED : GREEN);

export interface Ellipse {
  cx: number;
  cy: number;
  a: number; // demi-axe le long de `angle`
  b: number;
  angle: number; // radians
}

/** Point de l'ellipse : t en degrés, sens horaire à l'écran, k = fraction du rayon. */
export function ellipsePoint(e: Ellipse, tDeg: number, k: number): Pt {
  const t = (tDeg * Math.PI) / 180;
  const c = Math.cos(e.angle);
  const s = Math.sin(e.angle);
  const u = k * e.a * Math.sin(t);
  const v = -k * e.b * Math.cos(t);
  return { x: e.cx + u * c - v * s, y: e.cy + u * s + v * c };
}

function findOuterEllipse(cv: CV, map: ClassMap): Ellipse | null {
  const { width, height } = map;
  const mask = new cv.Mat(height, width, cv.CV_8UC1);
  // Fermeture assez large pour reboucher l'anneau là où une fléchette le recouvre.
  const k = 5;
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k));
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    const m = mask.data as Uint8Array;
    for (let i = 0; i < m.length; i++) m[i] = map.cls[i] ? 255 : 0;
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
    // Le plus grand ensemble rouge+vert, mesuré par son enveloppe convexe
    // (un anneau entamé par une fléchette garde la même enveloppe).
    let bestPts: number[] | null = null;
    let bestArea = width * height * 0.02;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      if (c.rows >= 5) {
        const hull = new cv.Mat();
        cv.convexHull(c, hull, false, true);
        const area = cv.contourArea(hull);
        if (area > bestArea) {
          bestArea = area;
          // Ajustement sur le contour lui-même (les logos en dépassent, ils seront écartés).
          bestPts = Array.from(c.data32S as Int32Array);
        }
        hull.delete();
      }
      c.delete();
    }
    if (!bestPts) return null;
    const e = robustEllipse(cv, bestPts);
    if (!e) return null;
    if (!(e.a > 10 && e.b > 10) || Math.min(e.a, e.b) / Math.max(e.a, e.b) < 0.25) return null;
    // L'enveloppe doit bien remplir l'ellipse (sinon ce n'est pas un anneau).
    if (bestArea / (Math.PI * e.a * e.b) < 0.75) return null;
    return e;
  } finally {
    mask.delete();
    kernel.delete();
    contours.delete();
    hierarchy.delete();
  }
}

/**
 * Ellipse du bord extérieur du double, trouvée par des rayons lancés depuis un centre
 * approximatif. Sur chaque rayon, on repère les passages colorés (bull, triple, double,
 * éventuellement un logo) et on garde la paire triple/double dont le rapport des
 * distances vaut ≈ 1,6 (103 → 166 mm) : les logos et les fléchettes sont ainsi écartés.
 */
function ringEllipse(cv: CV, map: ClassMap, center: Pt): Ellipse | null {
  const maxR = Math.max(map.width, map.height);
  const edge: number[] = [];
  for (let k = 0; k < 360; k++) {
    const a = (k * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const runs: { start: number; end: number }[] = [];
    let cur: { start: number; end: number } | null = null;
    let gap = 0;
    for (let r = 2; r < maxR; r += 0.75) {
      const x = center.x + dx * r;
      const y = center.y + dy * r;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) break;
      if (map.at({ x, y }) !== NONE) {
        if (cur) cur.end = r;
        else cur = { start: r, end: r };
        gap = 0;
      } else if (cur && ++gap > 3) {
        runs.push(cur);
        cur = null;
      }
    }
    if (cur) runs.push(cur);
    let best: { ratio: number; outer: number } | null = null;
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const ti = runs[i];
        const dj = runs[j];
        const wi = ti.end - ti.start;
        const wj = dj.end - dj.start;
        if (wi < 1.5 || wj < 1.5) continue;
        const ratio = (dj.start + dj.end) / (ti.start + ti.end);
        if (ratio < 1.4 || ratio > 1.95 || wj / wi > 3 || wi / wj > 3) continue;
        if (!best || Math.abs(ratio - 1.61) < Math.abs(best.ratio - 1.61)) best = { ratio, outer: dj.end };
      }
    }
    if (best) edge.push(Math.round(center.x + dx * best.outer), Math.round(center.y + dy * best.outer));
  }
  if (edge.length < 2 * 120) return null;
  return robustEllipse(cv, edge);
}

/** Centre approximatif de la cible : centre de l'ellipse du contour, sinon barycentre des couleurs. */
function roughCenter(cv: CV, map: ClassMap): Pt | null {
  const e = findOuterEllipse(cv, map);
  if (e) return { x: e.cx, y: e.cy };
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < map.height; y += 2)
    for (let x = 0; x < map.width; x += 2)
      if (map.cls[y * map.width + x]) {
        sx += x;
        sy += y;
        n++;
      }
  return n > 200 ? { x: sx / n, y: sy / n } : null;
}

function findDoubleEllipse(cv: CV, map: ClassMap): Ellipse | null {
  let c = roughCenter(cv, map);
  let e: Ellipse | null = null;
  for (let iter = 0; iter < 3 && c; iter++) {
    const next = ringEllipse(cv, map, c);
    if (!next) break;
    e = next;
    c = { x: e.cx, y: e.cy };
  }
  if (!e || !(e.a > 10 && e.b > 10) || Math.min(e.a, e.b) / Math.max(e.a, e.b) < 0.25) return null;
  return e;
}

/**
 * Ellipse ajustée sur le contour en écartant les points qui en dépassent : les logos
 * rouges (« unicorn », « ECLIPSE »…) collés au double déforment sinon l'ellipse.
 */
function robustEllipse(cv: CV, xy: number[]): Ellipse | null {
  let pts = xy;
  let e: Ellipse | null = null;
  for (let iter = 0; iter < 5; iter++) {
    if (pts.length < 10) return e;
    const m = cv.matFromArray(pts.length / 2, 1, cv.CV_32SC2, pts);
    const rr = cv.fitEllipse(m);
    m.delete();
    e = { cx: rr.center.x, cy: rr.center.y, a: rr.size.width / 2, b: rr.size.height / 2, angle: (rr.angle * Math.PI) / 180 };
    if (!(e.a > 0 && e.b > 0)) return null;
    // Distance « radiale » normalisée de chaque point (1 = sur l'ellipse).
    const c = Math.cos(e.angle);
    const s = Math.sin(e.angle);
    const d: number[] = [];
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i] - e.cx;
      const y = pts[i + 1] - e.cy;
      const u = (x * c + y * s) / e.a;
      const v = (-x * s + y * c) / e.b;
      d.push(Math.hypot(u, v));
    }
    const sorted = [...d].sort((p, q) => p - q);
    const med = sorted[Math.floor(sorted.length / 2)];
    const mad = [...d.map((x) => Math.abs(x - med))].sort((p, q) => p - q)[Math.floor(d.length / 2)];
    const tol = Math.max(0.012, 2.5 * mad);
    const kept: number[] = [];
    d.forEach((di, k) => {
      if (Math.abs(di - med) <= tol) kept.push(pts[2 * k], pts[2 * k + 1]);
    });
    if (kept.length === pts.length) break;
    pts = kept;
  }
  return e;
}

/** Supprime les petits segments parasites (reflet, logo, fil) : ils créent deux fausses frontières. */
function cleanTransitions(trans: number[], minSpan: number): number[] {
  const t = [...trans];
  while (t.length > 2) {
    let smallest = -1;
    let span = Infinity;
    for (let j = 0; j < t.length; j++) {
      const sp = mod(t[(j + 1) % t.length] - t[j], 360);
      if (sp < span) {
        span = sp;
        smallest = j;
      }
    }
    if (span >= minSpan) break;
    const j2 = (smallest + 1) % t.length;
    t.splice(Math.max(smallest, j2), 1);
    t.splice(Math.min(smallest, j2), 1);
  }
  return t;
}

/** Transitions rouge↔vert le long d'un parcours échantillonné (angles en degrés). */
function transitions(samples: { t: number; c: number }[], maxGap: number): number[] {
  const colored = samples.filter((s) => s.c !== NONE);
  const out: number[] = [];
  for (let i = 0; i < colored.length; i++) {
    const a = colored[i];
    const b = colored[(i + 1) % colored.length];
    const gap = mod(b.t - a.t, 360);
    if (a.c !== b.c && gap <= maxGap) out.push(mod(a.t + gap / 2, 360));
  }
  return out;
}

/**
 * Première estimation à partir de l'ellipse du double et de l'alternance des couleurs.
 * En biais, les frontières ne sont pas régulièrement espacées le long de l'ellipse :
 * on les numérote donc dans l'ordre où on les rencontre (il doit y en avoir 20).
 */
function initialHomography(map: ClassMap, e: Ellipse): Mat3 | null {
  const rMid = (RADII.doubleInner + RADII.doubleOuter) / 2;
  const N = 1440;
  // Plusieurs rayons d'échantillonnage : l'ellipse ajustée n'est qu'approximative.
  for (const k of [rMid / 170, 0.955, 0.985, 0.94, 1]) {
    const samples = Array.from({ length: N }, (_, j) => {
      const t = (j * 360) / N;
      return { t, c: map.at(ellipsePoint(e, t, k)) };
    });
    const trans = cleanTransitions(transitions(samples, 6), 7);
    if (trans.length !== 20) continue;

    // Couleur et position du milieu de chaque segment (entre deux frontières).
    const segs = trans.map((t, j) => {
      const next = trans[(j + 1) % 20];
      const span = mod(next - t, 360);
      let red = 0;
      let green = 0;
      for (const s of samples) {
        if (mod(s.t - t, 360) < span) {
          if (s.c === RED) red++;
          else if (s.c === GREEN) green++;
        }
      }
      const mid = mod(t + span / 2, 360);
      return { color: red > green ? RED : GREEN, y: ellipsePoint(e, mid, 1).y };
    });
    // Les couleurs doivent alterner.
    if (segs.some((sg, j) => sg.color === segs[(j + 1) % 20].color)) continue;

    // Le 20 = segment rouge le plus haut à l'écran.
    let top = -1;
    segs.forEach((sg, j) => {
      if (sg.color === RED && (top < 0 || sg.y < segs[top].y)) top = j;
    });
    if (top < 0) continue;

    // trans[top] est la frontière 5|20 (à −9°), puis on tourne dans le sens horaire.
    const img: Pt[] = [];
    const board: Pt[] = [];
    for (let j = 0; j < 20; j++) {
      const i = mod(j - top - 1, 20); // indice du secteur dont c'est la frontière droite
      img.push(ellipsePoint(e, trans[j], k));
      board.push(boardPoint(rMid, i * SECTOR_ANGLE + SECTOR_ANGLE / 2));
    }
    try {
      return computeHomography(img, board);
    } catch {
      continue;
    }
  }
  return null;
}

interface Corr {
  img: Pt;
  board: Pt;
}

/** Points précis, recherchés autour de la position prédite par l'homographie actuelle. */
function collectCorrespondences(map: ClassMap, F2B: Mat3): Corr[] {
  const B2F = invertH(F2B);
  const toImg = (r: number, a: number) => applyH(B2F, boardPoint(r, a));
  const out: Corr[] = [];

  // a) Frontières de secteurs au milieu des deux anneaux.
  for (const rMid of [(RADII.doubleInner + RADII.doubleOuter) / 2, (RADII.tripleInner + RADII.tripleOuter) / 2]) {
    for (let i = 0; i < 20; i++) {
      const b = i * SECTOR_ANGLE + SECTOR_ANGLE / 2;
      const samples: { t: number; c: number }[] = [];
      for (let t = b - 6; t <= b + 6; t += 0.2) samples.push({ t, c: map.at(toImg(rMid, t)) });
      // Côté gauche = couleur du secteur i, côté droit = celle du secteur i+1.
      const left = ringColor(i);
      const right = ringColor(i + 1);
      let found: number | null = null;
      for (let k = 1; k < samples.length; k++) {
        if (samples[k - 1].c === left && samples[k].c === right) {
          found = (samples[k - 1].t + samples[k].t) / 2;
          break;
        }
      }
      if (found == null) {
        // Fil métallique entre les deux : dernier « gauche » et premier « droit ».
        const lastLeft = samples.filter((s) => s.c === left && s.t < b + 3).pop();
        const firstRight = samples.find((s) => s.c === right && s.t > b - 3);
        if (lastLeft && firstRight && firstRight.t - lastLeft.t < 3 && firstRight.t > lastLeft.t)
          found = (lastLeft.t + firstRight.t) / 2;
      }
      if (found != null) out.push({ img: toImg(rMid, found), board: boardPoint(rMid, b) });
    }
  }

  // b) Bords des anneaux, le long du milieu de chaque secteur (et de part et d'autre).
  const edge = (a: number, color: number, r: number, inward: boolean) => {
    // Cherche le passage couleur → autre en s'éloignant de l'intérieur de l'anneau.
    const step = 0.2;
    const start = inward ? r + 4 : r - 4;
    const end = inward ? r - 4 : r + 4;
    const dir = inward ? -1 : 1;
    let prev = map.at(toImg(start, a));
    for (let rr = start + dir * step; dir > 0 ? rr <= end : rr >= end; rr += dir * step) {
      const c = map.at(toImg(rr, a));
      if (prev === color && c !== color) return rr - (dir * step) / 2;
      prev = c;
    }
    return null;
  };
  for (let i = 0; i < 20; i++) {
    const color = ringColor(i);
    for (const da of [-4, 0, 4]) {
      const a = i * SECTOR_ANGLE + da;
      for (const [r, inward] of [
        [RADII.doubleOuter, false],
        [RADII.doubleInner, true],
        [RADII.tripleOuter, false],
        [RADII.tripleInner, true],
      ] as [number, boolean][]) {
        const found = edge(a, color, r, inward);
        if (found != null) out.push({ img: toImg(found, a), board: boardPoint(r, a) });
      }
    }
  }

  // c) Bord extérieur du 25 (anneau vert autour du bull).
  for (let a = 0; a < 360; a += 15) {
    const found = edge(a, GREEN, RADII.outerBull, false);
    if (found != null) out.push({ img: toImg(found, a), board: boardPoint(RADII.outerBull, a) });
  }
  return out;
}

function solveRobust(corr: Corr[]): { H: Mat3; errorMm: number; used: number } | null {
  let set = corr;
  for (let iter = 0; iter < 3; iter++) {
    if (set.length < 12) return null;
    let H: Mat3;
    try {
      H = computeHomography(
        set.map((c) => c.img),
        set.map((c) => c.board),
      );
    } catch {
      return null;
    }
    const res = set.map((c) => {
      const q = applyH(H, c.img);
      return Math.hypot(q.x - c.board.x, q.y - c.board.y);
    });
    const sorted = [...res].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const limit = Math.max(1.5, median * 3);
    const kept = set.filter((_, i) => res[i] <= limit);
    const errorMm = res.reduce((a, b) => a + b, 0) / res.length;
    if (kept.length === set.length || iter === 2) return { H, errorMm, used: set.length };
    set = kept;
  }
  return null;
}

/** Part des zones double/triple et du bull dont la couleur attendue est bien retrouvée. */
export function colorMatchScore(cls: Uint8Array, width: number, height: number, F2B: Mat3): number {
  const map = new ClassMap(cls, width, height);
  let B2F: Mat3;
  try {
    B2F = invertH(F2B);
  } catch {
    return 0;
  }
  let ok = 0;
  let total = 0;
  for (let i = 0; i < SECTORS.length; i++) {
    for (const r of [(RADII.doubleInner + RADII.doubleOuter) / 2, (RADII.tripleInner + RADII.tripleOuter) / 2]) {
      for (const da of [-4, 0, 4]) {
        total++;
        if (map.at(applyH(B2F, boardPoint(r, i * SECTOR_ANGLE + da))) === ringColor(i)) ok++;
      }
    }
  }
  return ok / total;
}

export function blurForClassification(cv: CV, img: RgbaImage): RgbaImage {
  const src = cv.matFromImageData(img as ImageData);
  const rgb = new cv.Mat();
  try {
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    cv.medianBlur(rgb, rgb, 5);
    cv.cvtColor(rgb, src, cv.COLOR_RGB2RGBA);
    return { data: new Uint8ClampedArray(src.data), width: img.width, height: img.height };
  } finally {
    src.delete();
    rgb.delete();
  }
}

/** Informations intermédiaires, pour le débogage et les tests. */
export interface AutoCalibDebug {
  cls?: Uint8Array;
  ellipse?: Ellipse | null;
}

export function autoCalibrate(cv: CV, img: RgbaImage, debug?: AutoCalibDebug): AutoCalibResult {
  const cls = classifyPixels(blurForClassification(cv, img));
  const map = new ClassMap(cls, img.width, img.height);

  const ellipse = findDoubleEllipse(cv, map);
  if (debug) {
    debug.cls = cls;
    debug.ellipse = ellipse;
  }
  if (!ellipse) return { ok: false, reason: 'Je ne trouve pas les anneaux rouges et verts de la cible.' };

  let H = initialHomography(map, ellipse);
  if (!H) return { ok: false, reason: 'Je ne distingue pas les secteurs de la cible.' };

  let result: { H: Mat3; errorMm: number; used: number } | null = null;
  for (let iter = 0; iter < 3; iter++) {
    const corr = collectCorrespondences(map, H);
    const solved = solveRobust(corr);
    if (!solved) break;
    result = solved;
    H = solved.H;
  }
  if (!result) return { ok: false, reason: 'La cible est trop floue ou trop de biais pour être mesurée.' };

  // Orientation : le 20 doit être vraiment en haut (position 3D de la caméra), et non
  // seulement « le plus haut à l'image », faux en forte perspective.
  const up = uprightShift(result.H, img.width, img.height);
  if (up.shift) result.H = rotateCalibration(result.H, up.shift);

  const colorMatch = colorMatchScore(cls, img.width, img.height, result.H);
  if (colorMatch < 0.8 || result.errorMm > 3) {
    return { ok: false, reason: 'Cible trouvée mais résultat peu fiable (éclairage, reflets, ou cible en partie cachée ?).' };
  }

  const B2F = invertH(result.H);
  const points = CALIB_TARGETS.map((t) => {
    const p = applyH(B2F, t.board);
    return { x: p.x / img.width, y: p.y / img.height };
  });
  return { ok: true, H: result.H, points, errorMm: result.errorMm, colorMatch, correspondences: result.used };
}
