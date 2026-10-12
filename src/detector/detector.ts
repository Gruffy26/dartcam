// Détection automatique des fléchettes par différence d'images (sans IA).
//
// Pour chaque image (≈ 10 par seconde) :
//  1. niveaux de gris + flou ;
//  2. mouvement ? (comparaison avec l'image précédente, dans la zone de la cible) ;
//  3. quand l'image redevient stable pendant `stableMs`, comparaison avec la référence
//     (image de la cible sans la nouvelle fléchette), luminosité égalisée ;
//  4. seuil + ouverture/fermeture, on garde le plus grand changement : trop petit = bruit,
//     trop grand = main ou personne devant ;
//  5. pointe (voir tip.ts) → position sur la cible (homographie) → score ;
//  6. l'image stable devient la nouvelle référence : la fléchette suivante sera isolée seule.
//
// Chaque Mat OpenCV est libérée (`delete`) : les fuites font planter Safari sur iPhone.

import type { RgbaImage } from '../autocalib';
import { boardPoint, RADII, scoreFromBoardCoords, type Score } from '../board';
import { applyH, invertH, type Mat3, type Pt } from '../homography';
import type { CV } from '../opencv';
import { estimateShift, makeAnchor, type Anchor } from './align';
import { cameraFromHomography, defaultFocalFor, outDirection, project, type CameraModel } from './camera-model';
import { DEFAULT_PARAMS, type DetectorParams } from './params';
import { extendTip, findTip, locateDart, mergeAlongAxis, type TipResult } from './tip';

export interface DartEvent {
  kind: 'dart';
  /** Pointe et empennage, en pixels de l'image analysée. */
  tip: Pt;
  tail: Pt;
  /** Position de la pointe sur la cible (mm). */
  board: Pt;
  score: Score;
  area: number;
  confidence: number;
}

export type DetectorEvent =
  | DartEvent
  | { kind: 'reference' }
  /** L'image s'est décalée durablement : trépied bougé, il faut recalibrer. */
  | { kind: 'moved'; shift: Pt }
  | { kind: 'ignored'; reason: 'small' | 'big' | 'no-tip'; area: number };

export type DetectorState = 'warmup' | 'watching' | 'moving';

export interface DetectorDebug {
  state: DetectorState;
  /** Décalage de l'image par rapport à l'ancrage (vibrations du trépied), en pixels. */
  shift: Pt;
  /** Pixels changés entre les deux dernières images. */
  motion: number;
  motionLimit: number;
  /** Dernière analyse. */
  mask?: { data: Uint8Array; width: number; height: number };
  contour?: number[];
  tip?: TipResult | null;
  area?: number;
  minArea: number;
  maxArea: number;
  processMs: number;
  analyseMs?: number;
}

export interface Calib {
  /** Homographie image analysée (pixels) → cible (mm). */
  frameToBoard: Mat3;
  width: number;
  height: number;
  zoom?: number;
}

/** Polygone (x, y alternés) de la zone de la cible + marge, étendue côté caméra pour inclure le corps des fléchettes. */
function zonePolygon(calib: Calib, cam: CameraModel | null, marginMm: number): number[] {
  const B2F = invertH(calib.frameToBoard);
  const r = RADII.doubleOuter + marginMm;
  const pts: Pt[] = [];
  for (let a = 0; a < 360; a += 5) {
    const b = boardPoint(r, a);
    pts.push(applyH(B2F, b));
    // Le corps d'une fléchette (≈ 12 cm) dépasse de la cible vers la caméra.
    const out = cam ? project(cam, b.x, b.y, cam.normalSign * 120) : null;
    if (out) pts.push(out);
  }
  if (!cam) {
    for (let a = 0; a < 360; a += 5) pts.push(applyH(B2F, boardPoint(r + 80, a)));
  }
  return convexHull(pts).flatMap((p) => [Math.round(p.x), Math.round(p.y)]);
}

/** Longueur à l'image (px) d'une fléchette de 12 cm plantée perpendiculairement au point `b` (mm). */
function expectedDartLength(cam: CameraModel, b: Pt): number {
  const a = project(cam, b.x, b.y, 0);
  const c = project(cam, b.x, b.y, cam.normalSign * 120);
  return a && c ? Math.hypot(c.x - a.x, c.y - a.y) : 0;
}

/** Pixels de la tache principale + ceux des taches dont un pixel est à moins de `dist` px d'elle. */
function gatherNear(main: number[], others: { xy: number[] }[], dist: number): number[] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < main.length; i += 2) {
    x0 = Math.min(x0, main[i]);
    x1 = Math.max(x1, main[i]);
    y0 = Math.min(y0, main[i + 1]);
    y1 = Math.max(y1, main[i + 1]);
  }
  const out = [...main];
  for (const o of others) {
    let near = false;
    for (let i = 0; i < o.xy.length && !near; i += 2) {
      const dx = Math.max(x0 - o.xy[i], 0, o.xy[i] - x1);
      const dy = Math.max(y0 - o.xy[i + 1], 0, o.xy[i + 1] - y1);
      if (dx * dx + dy * dy < dist * dist) near = true;
    }
    if (near) out.push(...o.xy);
  }
  return out;
}

function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: Pt[] = [];
  for (const pt of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Surface (px²) de la cible jusqu'au bord du double, à l'image. */
function boardAreaPx(calib: Calib): number {
  const B2F = invertH(calib.frameToBoard);
  const pts = Array.from({ length: 72 }, (_, k) => applyH(B2F, boardPoint(RADII.doubleOuter, k * 5)));
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export class DartDetector {
  readonly cam: CameraModel | null;
  debug: DetectorDebug;
  params: DetectorParams;

  private cv: CV;
  private calib: Calib;
  private zone: any; // Mat CV_8UC1
  private prev: any = null;
  private ref: any = null;
  private stableSince = 0;
  private sawMotion = false;
  private lastAnalyse = 0;
  private boardArea: number;
  private kOpen: any;
  private kClose: any;
  private anchor: Anchor | null = null;
  private movedSince = 0;

  constructor(cv: CV, calib: Calib, params: Partial<DetectorParams> = {}) {
    this.cv = cv;
    this.calib = calib;
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.cam = cameraFromHomography(
      invertH(calib.frameToBoard),
      calib.width,
      calib.height,
      defaultFocalFor(calib.width, calib.height, calib.zoom ?? 1),
    );
    this.boardArea = boardAreaPx(calib);
    this.zone = cv.Mat.zeros(calib.height, calib.width, cv.CV_8UC1);
    this.buildZone();
    this.kOpen = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    this.kClose = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
    this.debug = { state: 'warmup', shift: { x: 0, y: 0 }, motion: 0, motionLimit: 0, minArea: 0, maxArea: 0, processMs: 0 };
  }

  private buildZone() {
    const cv = this.cv;
    this.zone.setTo(new cv.Scalar(0));
    const poly = zonePolygon(this.calib, this.cam, this.params.marginMm);
    const mat = cv.matFromArray(poly.length / 2, 1, cv.CV_32SC2, poly);
    const vec = new cv.MatVector();
    vec.push_back(mat);
    cv.fillPoly(this.zone, vec, new cv.Scalar(255));
    vec.delete();
    mat.delete();
  }

  setParams(p: Partial<DetectorParams>) {
    const marginChanged = p.marginMm != null && p.marginMm !== this.params.marginMm;
    this.params = { ...this.params, ...p };
    if (marginChanged) this.buildZone();
  }

  /** La prochaine image stable deviendra la référence (ex. après le retrait des fléchettes). */
  resetReference() {
    this.ref?.delete();
    this.ref = null;
    this.debug.state = 'warmup';
  }

  get hasReference() {
    return this.ref != null;
  }

  /** Image de référence actuelle (niveaux de gris floutés), pour la comparer à une autre. */
  private get minArea() {
    return (this.boardArea * this.params.minAreaPermille) / 1000;
  }
  private get maxArea() {
    return (this.boardArea * this.params.maxAreaPermille) / 1000;
  }

  private toGray(img: RgbaImage) {
    const cv = this.cv;
    const rgba = cv.matFromImageData(img as ImageData);
    const gray = new cv.Mat();
    try {
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    } finally {
      rgba.delete();
    }
    return gray;
  }

  /** Nombre de pixels changés entre deux images, dans la zone. */
  private changed(a: any, b: any): number {
    const cv = this.cv;
    const d = new cv.Mat();
    try {
      cv.absdiff(a, b, d);
      cv.threshold(d, d, this.params.diffThreshold, 255, cv.THRESH_BINARY);
      cv.bitwise_and(d, this.zone, d);
      // Les fines lignes le long des fils (vibrations résiduelles) disparaissent ;
      // une fléchette ou une main, plus épaisses, restent.
      cv.morphologyEx(d, d, cv.MORPH_OPEN, this.kOpen);
      return cv.countNonZero(d);
    } finally {
      d.delete();
    }
  }

  /** Recale l'image sur l'ancrage (renvoie une nouvelle Mat, ou la même si inutile). */
  private align(gray: any, t: number, events: DetectorEvent[]): any {
    const cv = this.cv;
    if (!this.anchor) {
      this.anchor = makeAnchor(gray.data, gray.cols, gray.rows, this.zone.data);
      this.debug.shift = { x: 0, y: 0 };
      return gray;
    }
    const s = estimateShift(this.anchor, gray.data, 8);
    this.debug.shift = { x: s.x, y: s.y };
    // Décalage important et durable : le trépied a bougé.
    if (Math.hypot(s.x, s.y) > 6) {
      if (!this.movedSince) this.movedSince = t;
      else if (t - this.movedSince > 1500) {
        events.push({ kind: 'moved', shift: { x: s.x, y: s.y } });
        this.movedSince = t;
      }
    } else this.movedSince = 0;
    if (Math.abs(s.x) < 0.05 && Math.abs(s.y) < 0.05) return gray;
    const M = cv.matFromArray(2, 3, cv.CV_64F, [1, 0, s.x, 0, 1, s.y]);
    const out = new cv.Mat();
    cv.warpAffine(gray, out, M, new cv.Size(gray.cols, gray.rows), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_REPLICATE);
    M.delete();
    gray.delete();
    return out;
  }

  process(img: RgbaImage, t: number): DetectorEvent[] {
    const t0 = performance.now();
    const events: DetectorEvent[] = [];
    const cur = this.align(this.toGray(img), t, events);
    try {
      const motionLimit = Math.max(15, (this.boardArea * this.params.motionPermille) / 1000);
      const motion = this.prev ? this.changed(cur, this.prev) : Infinity;
      const moving = motion > motionLimit;
      this.debug.motion = Number.isFinite(motion) ? motion : 0;
      this.debug.motionLimit = motionLimit;
      this.debug.minArea = this.minArea;
      this.debug.maxArea = this.maxArea;

      if (moving) {
        this.stableSince = t;
        this.sawMotion = true;
      }
      const stableFor = t - this.stableSince;

      if (!this.ref) {
        this.debug.state = 'warmup';
        if (!moving && stableFor >= this.params.stableMs) {
          this.ref = cur.clone();
          // Ancrage reconstruit sur cette image stable (même repère, image plus nette).
          this.anchor = makeAnchor(cur.data, cur.cols, cur.rows, this.zone.data) ?? this.anchor;
          this.sawMotion = false;
          this.lastAnalyse = t;
          events.push({ kind: 'reference' });
        }
      } else {
        this.debug.state = moving ? 'moving' : 'watching';
        // Analyse après un mouvement, ou de temps en temps par sécurité (mouvement manqué).
        const settled = this.sawMotion && stableFor >= this.params.stableMs;
        const periodic = !this.sawMotion && stableFor >= this.params.stableMs && t - this.lastAnalyse > 1500;
        if (settled || periodic) {
          this.sawMotion = false;
          this.lastAnalyse = t;
          const ev = this.analyse(cur);
          if (ev) events.push(ev);
        }
      }
    } finally {
      this.prev?.delete();
      this.prev = cur;
      this.debug.processMs = performance.now() - t0;
    }
    return events;
  }

  private analyse(cur: any): DetectorEvent | null {
    const cv = this.cv;
    const t0 = performance.now();
    const norm = new cv.Mat();
    const absd = new cv.Mat();
    const diff = new cv.Mat();
    const labels = new cv.Mat();
    const stats = new cv.Mat();
    const centroids = new cv.Mat();
    try {
      // Égalise la luminosité (exposition automatique de la caméra).
      const mRef = cv.mean(this.ref, this.zone)[0];
      const mCur = cv.mean(cur, this.zone)[0];
      const gain = mCur > 1 ? mRef / mCur : 1;
      cur.convertTo(norm, -1, gain, 0);

      cv.absdiff(this.ref, norm, absd);
      cv.bitwise_and(absd, this.zone, absd);
      cv.threshold(absd, diff, this.params.diffThreshold, 255, cv.THRESH_BINARY);
      cv.morphologyEx(diff, diff, cv.MORPH_OPEN, this.kOpen);
      cv.morphologyEx(diff, diff, cv.MORPH_CLOSE, this.kClose);
      this.debug.mask = { data: new Uint8Array(diff.data), width: diff.cols, height: diff.rows };
      this.debug.contour = undefined;
      this.debug.tip = undefined;

      // Taches de changement (composantes connexes).
      const n = cv.connectedComponentsWithStats(diff, labels, stats, centroids, 8, cv.CV_32S);
      const areas: number[] = [0];
      let main = 0;
      for (let l = 1; l < n; l++) {
        const a = stats.intAt(l, cv.CC_STAT_AREA);
        areas.push(a);
        if (a > areas[main]) main = l;
      }
      const mainArea = main ? areas[main] : 0;
      this.debug.area = mainArea;

      if (mainArea > this.maxArea) {
        // Main, bras, personne devant : on garde la référence et on attend.
        return { kind: 'ignored', reason: 'big', area: mainArea };
      }
      if (!main || mainArea < this.minArea / 3) {
        // Rien (ou du bruit) : la référence suit les petits changements de lumière.
        this.replaceRef(cur);
        return { kind: 'ignored', reason: 'small', area: mainArea };
      }

      // Pixels de chaque tache assez grande.
      const keep = new Map<number, number[]>();
      for (let l = 1; l < n; l++) if (areas[l] >= 12) keep.set(l, []);
      const lab = labels.data32S as Int32Array;
      const W = diff.cols;
      for (let i = 0; i < lab.length; i++) {
        const l = lab[i];
        if (l) keep.get(l)?.push(i % W, (i / W) | 0);
      }
      const mainXy = keep.get(main)!;
      const others = [...keep.entries()].filter(([l]) => l !== main).map(([, xy]) => ({ xy }));
      // Direction attendue de la fléchette à l'image, au niveau de la tache principale.
      const F2B = this.calib.frameToBoard;
      let mx = 0;
      let my = 0;
      for (let i = 0; i < mainXy.length; i += 2) {
        mx += mainXy[i];
        my += mainXy[i + 1];
      }
      const mainCenter = { x: mx / (mainXy.length / 2), y: my / (mainXy.length / 2) };
      const outDir = this.cam ? outDirection(this.cam, applyH(F2B, mainCenter)) : null;
      // Morceaux voisins : alignés avec la tache principale, ou (si la direction est
      // connue) simplement proches — la recherche de droite fera le tri.
      const xy = outDir ? gatherNear(mainXy, others, 90) : mergeAlongAxis({ xy: mainXy }, others).xy;
      const area = xy.length / 2;
      this.debug.area = area;
      if (area < this.minArea) {
        this.replaceRef(cur);
        return { kind: 'ignored', reason: 'small', area };
      }
      this.debug.contour = xy;

      const radius = (p: Pt) => {
        const b = applyH(F2B, p);
        return Math.hypot(b.x, b.y);
      };
      const tip = (outDir && locateDart(xy, outDir)) || findTip({ xy, outDir, boardRadius: radius });
      this.replaceRef(cur);
      if (!tip) return { kind: 'ignored', reason: 'no-tip', area };
      // Trop court pour une fléchette (reflet, poussière, petit déplacement d'ombre).
      const expected = this.cam ? expectedDartLength(this.cam, applyH(F2B, mainCenter)) : 0;
      if (expected > 0 && tip.length < expected * 0.3) {
        this.debug.tip = tip;
        return { kind: 'ignored', reason: 'no-tip', area };
      }

      // Le bout du fût est souvent peu contrasté : on prolonge avec un seuil plus bas.
      const ext = extendTip(tip.tip, tip.axis, absd.data, absd.cols, absd.rows, Math.max(6, this.params.diffThreshold * 0.45));
      if (radius(ext.tip) <= RADII.doubleOuter + 40) tip.tip = ext.tip;
      this.debug.tip = tip;

      const board = applyH(F2B, tip.tip);
      return {
        kind: 'dart',
        tip: tip.tip,
        tail: tip.tail,
        board,
        score: scoreFromBoardCoords(board.x, board.y),
        area,
        confidence: tip.confidence,
      };
    } finally {
      norm.delete();
      absd.delete();
      diff.delete();
      labels.delete();
      stats.delete();
      centroids.delete();
      this.debug.analyseMs = performance.now() - t0;
    }
  }

  private replaceRef(cur: any) {
    this.ref?.delete();
    this.ref = cur.clone();
  }

  dispose() {
    this.prev?.delete();
    this.ref?.delete();
    this.zone.delete();
    this.kOpen.delete();
    this.kClose.delete();
    this.prev = this.ref = null;
  }
}
