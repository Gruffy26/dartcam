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
import { extendTip, findTip, locateDart, mergeAlongAxis, scoreFragile, type TipResult } from './tip';

/**
 * Débordement du changement au-delà du vrai bout de la fléchette, en pixels de l'image
 * analysée : flou de l'objectif, réduction de l'image, compression, et ombre portée de
 * la pointe sur la toile. Mesuré sur 61 fléchettes réelles rejouées (exports de l'app,
 * src/testing/export.test.ts) : sans correction 87 % de bons scores, 95 % à 2,75 px.
 * Le réglage est en pixels et non en mm : l'origine est le flou de l'image, pas la
 * géométrie de la cible (vérifié sur deux séquences à 0,70 et 1,16 mm par pixel).
 */
export const TIP = { blurPx: 2.75, doubtMm: 2 };

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
  /** Pointe à moins de 2 mm d'un fil : score à vérifier. */
  uncertain: boolean;
}

export type DetectorEvent =
  | DartEvent
  | { kind: 'reference' }
  /** L'image s'est décalée durablement : trépied bougé, il faut recalibrer. */
  | { kind: 'moved'; shift: Pt }
  /** La cible est redevenue comme au début de la volée : fléchettes retirées. */
  | { kind: 'cleared' }
  | { kind: 'ignored'; reason: 'small' | 'big' | 'no-tip'; area: number };

export type DetectorState = 'warmup' | 'watching' | 'moving' | 'removal';

/** « throwing » : on cherche les fléchettes ; « removal » : volée finie, on attend le retrait. */
export type DetectorMode = 'throwing' | 'removal';

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
  /** Pixels encore différents de l'image de début de volée (retrait des fléchettes). */
  cleanDiff?: number;
  /** Forme de la dernière silhouette examinée (contrôle « est-ce une fléchette ? »). */
  shape?: { straight: number; width: number; lengthRatio: number };
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
function gatherNear(main: number[], others: [number, number[]][], dist: number): { xy: number[]; labels: number[] } {
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
  const xy = [...main];
  const labels: number[] = [];
  for (const [l, o] of others) {
    let near = false;
    for (let i = 0; i < o.length && !near; i += 2) {
      const dx = Math.max(x0 - o[i], 0, o[i] - x1);
      const dy = Math.max(y0 - o[i + 1], 0, o[i + 1] - y1);
      if (dx * dx + dy * dy < dist * dist) near = true;
    }
    if (near) {
      for (let i = 0; i < o.length; i++) xy.push(o[i]);
      labels.push(l);
    }
  }
  return { xy, labels };
}

/**
 * Forme de la silhouette par rapport à l'axe trouvé :
 * - `straight` : part des pixels à moins de 4 px de l'axe (fût bien droit) ;
 * - `width` : largeur typique (px) mesurée perpendiculairement à l'axe.
 */
function dartShape(xy: number[], tip: TipResult): { straight: number; width: number } {
  const n = xy.length / 2;
  const v = tip.axis;
  let near = 0;
  const qs: number[] = [];
  for (let i = 0; i < n; i++) {
    const dx = xy[2 * i] - tip.tip.x;
    const dy = xy[2 * i + 1] - tip.tip.y;
    const q = Math.abs(dx * -v.y + dy * v.x);
    if (q < 4) near++;
    qs.push(q);
  }
  qs.sort((a, b) => a - b);
  return { straight: near / n, width: 2 * (qs[Math.floor(n * 0.8)] ?? 0) };
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
  cam: CameraModel | null;
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
  private shifts: { t: number; x: number; y: number }[] = [];
  /** Image nettement décalée par rapport à l'ancrage : on n'analyse pas (trépied bougé ?). */
  private shifted = false;
  private mode: DetectorMode = 'throwing';
  /** Image de la cible au début de la volée (sans fléchette de cette volée). */
  private volleyStart: any = null;
  /** Canal couleur (rouge − vert) de la référence et du début de volée : un fût gris sur
   * un anneau rouge ou vert a presque la même luminosité, mais pas la même couleur. */
  private refC: any = null;
  private volleyStartC: any = null;
  /** Fléchettes comptées depuis le début de la volée (détectées ou ajoutées à la main). */
  private dartsSinceStart = 0;

  constructor(cv: CV, calib: Calib, params: Partial<DetectorParams> = {}) {
    this.cv = cv;
    this.calib = calib;
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.cam = null;
    this.boardArea = 0;
    this.zone = cv.Mat.zeros(calib.height, calib.width, cv.CV_8UC1);
    this.setFrameToBoard(calib.frameToBoard);
    this.kOpen = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    this.kClose = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
    this.debug = { state: 'warmup', shift: { x: 0, y: 0 }, motion: 0, motionLimit: 0, minArea: 0, maxArea: 0, processMs: 0 };
  }

  /** (Re)définit la calibration utilisée : modèle de caméra, surface et zone de la cible. */
  private setFrameToBoard(F2B: Mat3) {
    this.calib = { ...this.calib, frameToBoard: F2B };
    this.cam = cameraFromHomography(
      invertH(F2B),
      this.calib.width,
      this.calib.height,
      defaultFocalFor(this.calib.width, this.calib.height, this.calib.zoom ?? 1),
    );
    this.boardArea = boardAreaPx(this.calib);
    this.buildZone();
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

  /** Calibration utilisée, image analysée → cible. */
  get frameToBoard(): Mat3 {
    return this.calib.frameToBoard;
  }

  /** La prochaine image stable deviendra la référence (ex. après le retrait des fléchettes). */
  resetReference() {
    this.ref?.delete();
    this.refC?.delete();
    this.ref = this.refC = null;
    this.mode = 'throwing';
    this.debug.state = 'warmup';
  }

  /**
   * Volée finie (3 fléchettes) : on arrête de chercher des fléchettes — le joueur va
   * passer devant la cible — et on attend que la cible redevienne vide.
   */
  setMode(mode: DetectorMode) {
    this.mode = mode;
  }

  /** Une fléchette a été ajoutée à la main (la détection l'avait ratée). */
  noteManualDart() {
    this.dartsSinceStart++;
  }

  private startVolley(cur: any, curC: any) {
    this.volleyStart?.delete();
    this.volleyStartC?.delete();
    this.volleyStart = cur.clone();
    this.volleyStartC = curC.clone();
    this.dartsSinceStart = 0;
    this.mode = 'throwing';
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

  /** Niveaux de gris et canal couleur (rouge − vert, centré sur 128), tous deux floutés. */
  private toPlanes(img: RgbaImage): { g: any; c: any } {
    const cv = this.cv;
    const rgba = cv.matFromImageData(img as ImageData);
    const gray = new cv.Mat();
    const chroma = new cv.Mat();
    const ch = new cv.MatVector();
    try {
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      cv.split(rgba, ch);
      const r = ch.get(0);
      const g = ch.get(1);
      cv.addWeighted(r, 0.5, g, -0.5, 128, chroma);
      r.delete();
      g.delete();
      cv.GaussianBlur(chroma, chroma, new cv.Size(5, 5), 0);
    } finally {
      rgba.delete();
      ch.delete();
    }
    return { g: gray, c: chroma };
  }

  /**
   * Différences avec une image de référence (Mat 8 bits à libérer) :
   *  - `g` : écart de luminosité (après égalisation) — seul à pouvoir déclencher une
   *    détection (les bords rouges très contrastés en couleur réagiraient à la moindre
   *    vibration résiduelle) ;
   *  - `m` : maximum de `g` et de l'écart de couleur (×1,5) — pour compléter la
   *    silhouette d'une fléchette déjà trouvée (fût gris sur un anneau rouge ou vert).
   */
  private diffTo(refG: any, refC: any, g: any, c: any): { g: any; m: any } {
    const cv = this.cv;
    const norm = new cv.Mat();
    const dg = new cv.Mat();
    const dc = new cv.Mat();
    try {
      const mRef = cv.mean(refG, this.zone)[0];
      const mCur = cv.mean(g, this.zone)[0];
      g.convertTo(norm, -1, mCur > 1 ? mRef / mCur : 1, 0);
      cv.absdiff(refG, norm, dg);
      cv.bitwise_and(dg, this.zone, dg);
      // Balance des blancs automatique : on égalise aussi la couleur moyenne.
      const cRef = cv.mean(refC, this.zone)[0];
      const cCur = cv.mean(c, this.zone)[0];
      c.convertTo(dc, -1, 1, cRef - cCur);
      cv.absdiff(refC, dc, dc);
      dc.convertTo(dc, -1, 1.5, 0);
      cv.max(dg, dc, dc);
      cv.bitwise_and(dc, this.zone, dc);
      return { g: dg, m: dc };
    } catch (e) {
      dg.delete();
      dc.delete();
      throw e;
    } finally {
      norm.delete();
    }
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
  private align(planes: { g: any; c: any }, t: number, events: DetectorEvent[]): { g: any; c: any } {
    const cv = this.cv;
    const gray = planes.g;
    if (!this.anchor) {
      this.anchor = makeAnchor(gray.data, gray.cols, gray.rows, this.zone.data);
      this.debug.shift = { x: 0, y: 0 };
      return planes;
    }
    const s = estimateShift(this.anchor, gray.data, 16);
    this.debug.shift = { x: s.x, y: s.y };
    // Vibrations (le décalage va et vient) : compensées par le recalage.
    // Déplacement (le décalage reste stable à plus de 4 px pendant 1 s) : le téléphone
    // a bougé, la perspective a changé aussi → on suspend et on demande de redétecter la cible.
    this.shifts.push({ t, x: s.x, y: s.y });
    while (this.shifts.length && t - this.shifts[0].t > 1000) this.shifts.shift();
    const k = this.shifts.length;
    const mxs = this.shifts.reduce((a, p) => a + p.x, 0) / k;
    const mys = this.shifts.reduce((a, p) => a + p.y, 0) / k;
    const sd = Math.sqrt(this.shifts.reduce((a, p) => a + (p.x - mxs) ** 2 + (p.y - mys) ** 2, 0) / k);
    const spanned = t - this.shifts[0].t >= 800;
    const offset = Math.hypot(mxs, mys);
    this.shifted = offset > 4 && sd < Math.max(1.5, offset * 0.4);
    if (this.shifted && spanned) {
      events.push({ kind: 'moved', shift: { x: mxs, y: mys } });
      this.shifts = [];
    }
    if (Math.abs(s.x) < 0.05 && Math.abs(s.y) < 0.05) return planes;
    const M = cv.matFromArray(2, 3, cv.CV_64F, [1, 0, s.x, 0, 1, s.y]);
    const warp = (m: any) => {
      const out = new cv.Mat();
      cv.warpAffine(m, out, M, new cv.Size(m.cols, m.rows), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_REPLICATE);
      m.delete();
      return out;
    };
    const res = { g: warp(planes.g), c: warp(planes.c) };
    M.delete();
    return res;
  }

  /**
   * Référence posée et aucun mouvement en attente d'analyse : l'image en cours montre
   * la cible telle qu'elle est vraiment (et non une fléchette qui vient d'arriver mais
   * n'est pas encore confirmée).
   */
  get settled(): boolean {
    return this.ref != null && !this.sawMotion && !this.shifted;
  }

  process(img: RgbaImage, t: number): DetectorEvent[] {
    const t0 = performance.now();
    const events: DetectorEvent[] = [];
    const planes = this.align(this.toPlanes(img), t, events);
    const cur = planes.g;
    const curC = planes.c;
    try {
      const motionLimit = Math.max(15, (this.boardArea * this.params.motionPermille) / 1000);
      const motion = this.prev ? this.changed(cur, this.prev) : Infinity;
      const moving = motion > motionLimit;
      this.debug.motion = Number.isFinite(motion) ? motion : 0;
      this.debug.motionLimit = motionLimit;
      this.debug.minArea = this.minArea;
      this.debug.maxArea = this.maxArea;

      if (moving || this.shifted) {
        this.stableSince = t;
        this.sawMotion = true;
      }
      const stableFor = t - this.stableSince;

      if (!this.ref) {
        this.debug.state = 'warmup';
        // Première référence : on attend un peu plus longtemps que tout soit bien immobile.
        if (!moving && !this.shifted && stableFor >= Math.max(this.params.stableMs, 1000)) {
          this.ref = cur.clone();
          this.refC = curC.clone();
          this.startVolley(cur, curC);
          this.sawMotion = false;
          this.lastAnalyse = t;
          events.push({ kind: 'reference' });
        }
      } else {
        this.debug.state = moving ? 'moving' : this.mode === 'removal' ? 'removal' : 'watching';
        // Analyse après un mouvement, ou de temps en temps par sécurité (mouvement manqué).
        const settled = this.sawMotion && stableFor >= this.params.stableMs;
        const periodic = !this.sawMotion && stableFor >= this.params.stableMs && t - this.lastAnalyse > 1500;
        if ((settled || periodic) && !this.shifted) {
          this.sawMotion = false;
          this.lastAnalyse = t;
          if ((this.dartsSinceStart > 0 || this.mode === 'removal') && this.isClean(cur, curC)) {
            // Cible vide comme au début de la volée : les fléchettes ont été retirées.
            this.replaceRef(cur, curC);
            this.startVolley(cur, curC);
            events.push({ kind: 'cleared' });
          } else if (this.mode === 'throwing') {
            for (const ev of this.analyse(cur, curC, settled ? 'settled' : 'periodic')) {
              if (ev.kind === 'dart') this.dartsSinceStart++;
              events.push(ev);
            }
          }
        }
      }
    } finally {
      this.prev?.delete();
      this.prev = cur;
      curC.delete();
      this.debug.processMs = performance.now() - t0;
    }
    return events;
  }

  /** L'image ressemble-t-elle à celle du début de la volée (aucune fléchette plantée) ? */
  private isClean(cur: any, curC: any): boolean {
    if (!this.volleyStart) return false;
    const cv = this.cv;
    const dd = this.diffTo(this.volleyStart, this.volleyStartC, cur, curC);
    dd.m.delete();
    const d = dd.g;
    try {
      cv.threshold(d, d, this.params.diffThreshold, 255, cv.THRESH_BINARY);
      cv.morphologyEx(d, d, cv.MORPH_OPEN, this.kOpen);
      const changed = cv.countNonZero(d);
      this.debug.cleanDiff = changed;
      return changed < this.minArea;
    } finally {
      d.delete();
    }
  }

  /**
   * Analyse d'une image stable.
   * - après un mouvement (`settled`) : cherche les nouvelles fléchettes (jusqu'à 3 si
   *   plusieurs sont arrivées ensemble) ;
   * - sans mouvement (`periodic`) : ne fait que remettre la référence à jour (lents
   *   changements de lumière ou d'ombre) — une fléchette qui se plante crée toujours un
   *   mouvement, donc on ne cherche jamais de fléchette ici (évite les « 0 » fantômes).
   */
  private analyse(cur: any, curC: any, mode: 'settled' | 'periodic'): DetectorEvent[] {
    const cv = this.cv;
    const t0 = performance.now();
    const dd = this.diffTo(this.ref, this.refC, cur, curC);
    const absd = dd.g;
    const absdM = dd.m;
    const diff = new cv.Mat();
    const labels = new cv.Mat();
    const stats = new cv.Mat();
    const centroids = new cv.Mat();
    try {
      cv.threshold(absd, diff, this.params.diffThreshold, 255, cv.THRESH_BINARY);
      cv.morphologyEx(diff, diff, cv.MORPH_OPEN, this.kOpen);
      cv.morphologyEx(diff, diff, cv.MORPH_CLOSE, this.kClose);
      this.debug.mask = { data: new Uint8Array(diff.data), width: diff.cols, height: diff.rows };
      this.debug.contour = undefined;
      this.debug.tip = undefined;

      // Taches de changement (composantes connexes).
      const n = cv.connectedComponentsWithStats(diff, labels, stats, centroids, 8, cv.CV_32S);
      const areas: number[] = [0];
      let largest = 0;
      for (let l = 1; l < n; l++) {
        areas.push(stats.intAt(l, cv.CC_STAT_AREA));
        if (areas[l] > areas[largest]) largest = l;
      }
      const largestArea = largest ? areas[largest] : 0;
      this.debug.area = largestArea;

      if (mode === 'periodic') {
        // Pas de mouvement : ce n'est pas une fléchette. On absorbe le changement, sauf
        // une personne immobile devant la cible (on attendra qu'elle parte).
        if (largestArea <= this.maxArea) this.replaceRef(cur, curC);
        return [];
      }
      if (largestArea > this.maxArea) {
        // Main, bras, personne devant : on garde la référence et on attend.
        return [{ kind: 'ignored', reason: 'big', area: largestArea }];
      }
      if (!largest || largestArea < this.minArea / 3) {
        // Rien (ou du bruit) : la référence suit les petits changements de lumière.
        this.replaceRef(cur, curC);
        return [{ kind: 'ignored', reason: 'small', area: largestArea }];
      }

      // Pixels de chaque tache assez grande.
      const comps = new Map<number, number[]>();
      for (let l = 1; l < n; l++) if (areas[l] >= 12) comps.set(l, []);
      const lab = labels.data32S as Int32Array;
      const W = diff.cols;
      for (let i = 0; i < lab.length; i++) {
        const l = lab[i];
        if (l) comps.get(l)?.push(i % W, (i / W) | 0);
      }

      const events: DetectorEvent[] = [];
      // Plusieurs fléchettes peuvent être arrivées pendant le même mouvement.
      for (let k = 0; k < 3 && comps.size; k++) {
        let main = -1;
        for (const [l] of comps) if (main < 0 || areas[l] > areas[main]) main = l;
        if (areas[main] < this.minArea / 3) break;
        const res = this.findDart(main, comps, absdM);
        if (k === 0) this.debug.area = res.area;
        for (const l of res.used) comps.delete(l);
        comps.delete(main);
        if (res.event) events.push(res.event);
        else if (k === 0) events.push({ kind: 'ignored', reason: res.reason ?? 'no-tip', area: res.area });
      }
      this.replaceRef(cur, curC);
      return events;
    } finally {
      absd.delete();
      absdM.delete();
      diff.delete();
      labels.delete();
      stats.delete();
      centroids.delete();
      this.debug.analyseMs = performance.now() - t0;
    }
  }

  /** Cherche une fléchette à partir de la tache `main` (et des morceaux voisins). */
  private findDart(
    main: number,
    comps: Map<number, number[]>,
    absdM: any,
  ): { event?: DartEvent; used: number[]; area: number; reason?: 'small' | 'no-tip' } {
    const mainXy = comps.get(main)!;
    const F2B = this.calib.frameToBoard;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < mainXy.length; i += 2) {
      mx += mainXy[i];
      my += mainXy[i + 1];
    }
    const mainCenter = { x: mx / (mainXy.length / 2), y: my / (mainXy.length / 2) };
    const outDir = this.cam ? outDirection(this.cam, applyH(F2B, mainCenter)) : null;
    const others = [...comps.entries()].filter(([l]) => l !== main);
    // Morceaux voisins : alignés avec la tache principale, ou (si la direction est
    // connue) simplement proches — la recherche de droite fera le tri.
    let xy: number[];
    let used: number[];
    if (outDir) {
      const g = gatherNear(mainXy, others, 90);
      xy = g.xy;
      used = g.labels;
    } else {
      xy = mergeAlongAxis({ xy: mainXy }, others.map(([, p]) => ({ xy: p }))).xy;
      used = [];
    }
    const area = xy.length / 2;
    if (area < this.minArea) return { used: [], area, reason: 'small' };

    const radius = (p: Pt) => {
      const b = applyH(F2B, p);
      return Math.hypot(b.x, b.y);
    };
    const tip = (outDir && locateDart(xy, outDir)) || findTip({ xy, outDir, boardRadius: radius });
    if (!tip) return { used, area, reason: 'no-tip' };

    // Contrôle de forme : une fléchette est longue, droite et fine.
    const expected = this.cam ? expectedDartLength(this.cam, applyH(F2B, mainCenter)) : 0;
    const shape = dartShape(xy, tip);
    this.debug.shape = { ...shape, lengthRatio: expected ? tip.length / expected : 0 };
    if (expected > 0 && (tip.length < expected * 0.3 || tip.length > expected * 2.2)) return { used, area, reason: 'no-tip' };
    if (shape.straight < 0.15 || shape.width > Math.max(14, tip.length * 0.6)) return { used, area, reason: "no-tip" };

    // Le bout du fût est souvent peu contrasté : on prolonge avec un seuil plus bas.
    // Couleur incluse : un fût gris reste visible quand il traverse un anneau rouge ou vert.
    const ext = extendTip(tip.tip, tip.axis, absdM.data, absdM.cols, absdM.rows, Math.max(6, this.params.diffThreshold * 0.45), 60, 8);
    if (radius(ext.tip) <= RADII.doubleOuter + 40) tip.tip = ext.tip;
    // Le flou (5×5) étale le changement ≈ 1,5 px au-delà du vrai bout : on le retire.
    tip.tip = { x: tip.tip.x + tip.axis.x * TIP.blurPx, y: tip.tip.y + tip.axis.y * TIP.blurPx };
    this.debug.contour = xy;
    this.debug.tip = tip;

    const board = applyH(F2B, tip.tip);
    // Pointe hors de la cible (au-delà du tour de chiffres) : pas une fléchette plantée.
    if (Math.hypot(board.x, board.y) > 228) return { used, area, reason: 'no-tip' };
    const score = scoreFromBoardCoords(board.x, board.y);
    return {
      used,
      area,
      event: {
        kind: 'dart',
        tip: tip.tip,
        tail: tip.tail,
        board,
        score,
        area,
        confidence: tip.confidence,
        uncertain: scoreFragile(F2B, tip.tip, tip.axis, score.libelle, TIP.doubtMm),
      },
    };
  }

  private replaceRef(cur: any, curC: any) {
    this.ref?.delete();
    this.refC?.delete();
    this.ref = cur.clone();
    this.refC = curC.clone();
  }

  dispose() {
    this.prev?.delete();
    this.ref?.delete();
    this.refC?.delete();
    this.volleyStart?.delete();
    this.volleyStartC?.delete();
    this.volleyStart = this.volleyStartC = this.refC = null;
    this.zone.delete();
    this.kOpen.delete();
    this.kClose.delete();
    this.prev = this.ref = null;
  }
}
