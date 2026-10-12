// Calibration : 5 repères touchés sur l'image → homographie image → cible (mm).
//
// Les repères sont stockés en coordonnées « cadre » normalisées (0–1) : relatives à
// l'image réellement analysée (après zoom numérique éventuel), donc indépendantes de
// la taille d'affichage et de la résolution d'analyse.

import { boardPoint, RADII, SECTORS, sectorCenterAngle, SECTOR_ANGLE } from './board';
import { applyH, computeHomography, invertH, type Mat3, type Pt } from './homography';
import { loadJSON, removeKey, saveJSON } from './storage';

export interface CalibTarget {
  /** Position du repère sur la cible (mm, y vers le 20). */
  board: Pt;
  /** Consigne affichée. */
  label: string;
  short: string;
}

export const CALIB_TARGETS: CalibTarget[] = [
  { board: boardPoint(RADII.doubleOuter, sectorCenterAngle(20)), short: '20 (haut)', label: 'Bord extérieur du double, au milieu du 20 (en haut)' },
  { board: boardPoint(RADII.doubleOuter, sectorCenterAngle(6)), short: '6 (droite)', label: 'Bord extérieur du double, au milieu du 6 (à droite)' },
  { board: boardPoint(RADII.doubleOuter, sectorCenterAngle(3)), short: '3 (bas)', label: 'Bord extérieur du double, au milieu du 3 (en bas)' },
  { board: boardPoint(RADII.doubleOuter, sectorCenterAngle(11)), short: '11 (gauche)', label: 'Bord extérieur du double, au milieu du 11 (à gauche)' },
  { board: { x: 0, y: 0 }, short: 'centre', label: 'Le centre du bull' },
];

export type SourceKind = 'camera' | 'video';

export interface Calibration {
  version: 1;
  kind: SourceKind;
  /** Les 5 repères, dans l'ordre de CALIB_TARGETS, en coordonnées cadre normalisées. */
  points: Pt[];
  /** Zoom de la caméra au moment de la calibration. */
  zoom: number;
  /** Rapport largeur / hauteur du cadre analysé (détecte un changement d'orientation). */
  aspect: number;
  createdAt: string;
  /** Détectée automatiquement ou placée à la main. */
  method?: 'auto' | 'manual';
}

/** Homographie cadre (pixels d'une image de taille W×H) → cible (mm). */
export function frameToBoard(points: Pt[], W: number, H: number): Mat3 {
  const n = Math.min(points.length, CALIB_TARGETS.length);
  const src = points.slice(0, n).map((p) => ({ x: p.x * W, y: p.y * H }));
  const dst = CALIB_TARGETS.slice(0, n).map((t) => t.board);
  return computeHomography(src, dst);
}

/** Écart moyen (mm) entre les repères projetés et leur position théorique. */
export function reprojectionError(points: Pt[], W: number, H: number): number {
  const Hm = frameToBoard(points, W, H);
  const errs = points.map((p, i) => {
    const q = applyH(Hm, { x: p.x * W, y: p.y * H });
    return Math.hypot(q.x - CALIB_TARGETS[i].board.x, q.y - CALIB_TARGETS[i].board.y);
  });
  return errs.reduce((a, b) => a + b, 0) / errs.length;
}

export interface BoardOverlay {
  /** Cercles des anneaux, chacun en polyligne fermée. */
  rings: Pt[][];
  /** Lignes de séparation des secteurs (du 25 au bord du double). */
  spokes: [Pt, Pt][];
  /** Position des numéros, à l'extérieur du double. */
  numbers: { n: number; p: Pt }[];
}

/**
 * Dessin de la cible projeté dans l'image, en coordonnées cadre normalisées,
 * à partir de l'homographie cadre → cible calculée sur une image W×H.
 */
export function boardOverlay(boardToFrame: Mat3, W: number, H: number, segments = 120): BoardOverlay {
  const toNorm = (p: Pt): Pt => {
    const q = applyH(boardToFrame, p);
    return { x: q.x / W, y: q.y / H };
  };
  const radii = [RADII.bull, RADII.outerBull, RADII.tripleInner, RADII.tripleOuter, RADII.doubleInner, RADII.doubleOuter];
  const rings = radii.map((r) =>
    Array.from({ length: segments + 1 }, (_, k) => toNorm(boardPoint(r, (k * 360) / segments))),
  );
  const spokes = SECTORS.map((_, i): [Pt, Pt] => {
    const a = i * SECTOR_ANGLE + SECTOR_ANGLE / 2;
    return [toNorm(boardPoint(RADII.outerBull, a)), toNorm(boardPoint(RADII.doubleOuter, a))];
  });
  const numbers = SECTORS.map((n, i) => ({ n, p: toNorm(boardPoint(190, i * SECTOR_ANGLE)) }));
  return { rings, spokes, numbers };
}

/** Homographie cible → cadre, ou null si les repères ne permettent pas de la calculer. */
export function tryBoardToFrame(points: Pt[], W: number, H: number): Mat3 | null {
  if (points.length < 4) return null;
  try {
    return invertH(frameToBoard(points, W, H));
  } catch {
    return null;
  }
}

/** Raison pour laquelle une calibration ne correspond plus à la source actuelle, ou null si elle est bonne. */
export function calibrationMismatch(cal: Calibration, current: { zoom: number; aspect: number }): string | null {
  if (Math.abs(cal.aspect - current.aspect) / cal.aspect > 0.02) {
    return 'L’orientation ou le format de l’image a changé depuis la calibration.';
  }
  if (cal.kind === 'camera' && Math.abs(cal.zoom - current.zoom) > 0.05) {
    return 'Le zoom a changé depuis la calibration.';
  }
  return null;
}

// --- Stockage (une calibration pour la caméra, une pour les vidéos de test) ---

const key = (kind: SourceKind) => `dartcam.calibration.${kind}`;

export function loadCalibration(kind: SourceKind): Calibration | null {
  const c = loadJSON<Calibration | null>(key(kind), null);
  return c && c.version === 1 && Array.isArray(c.points) && c.points.length === CALIB_TARGETS.length ? c : null;
}

export function saveCalibration(cal: Calibration): boolean {
  return saveJSON(key(cal.kind), cal);
}

export function clearCalibration(kind: SourceKind): void {
  removeKey(key(kind));
}

/**
 * Calibration médiane de plusieurs détections successives : si le trépied oscille
 * encore un peu, chaque image donne des repères légèrement différents ; la médiane
 * correspond à la position moyenne.
 */
export function medianPoints(sets: Pt[][]): Pt[] {
  const med = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return sets[0].map((_, i) => ({ x: med(sets.map((p) => p[i].x)), y: med(sets.map((p) => p[i].y)) }));
}
