// Géométrie officielle de la cible et calcul du score. Module pur, sans dépendance.
//
// Repère « cible » en millimètres : origine au centre du bull, x vers la droite,
// y vers le HAUT (le 20). Les angles « depuis le haut » se comptent en degrés
// dans le sens horaire : 0° = 20 (haut), 90° = 6 (droite), 180° = 3, 270° = 11.

/** Secteurs dans le sens horaire en partant du haut. */
export const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5] as const;

export const SECTOR_ANGLE = 18;

/** Rayons officiels (mm) depuis le centre. */
export const RADII = {
  bull: 6.35,
  outerBull: 15.9,
  tripleInner: 99,
  tripleOuter: 107,
  doubleInner: 162,
  doubleOuter: 170,
} as const;

export type Multiplier = 0 | 1 | 2 | 3;

export interface Score {
  /** 1 à 20, 25 pour le bull (simple ou double), 0 si hors cible. */
  secteur: number;
  /** 0 hors cible, 1 simple, 2 double (et bull 50), 3 triple. */
  multiplicateur: Multiplier;
  points: number;
  /** « T20 », « D16 », « 7 », « 25 », « BULL » ou « 0 ». */
  libelle: string;
}

export const MISS: Score = { secteur: 0, multiplicateur: 0, points: 0, libelle: '0' };

/** Angle en degrés depuis le haut, sens horaire, dans [0, 360). */
export function angleFromTop(x: number, y: number): number {
  const deg = (Math.atan2(x, y) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/**
 * Indice (0–19) du secteur contenant un angle donné depuis le haut.
 * Une frontière exacte appartient au secteur suivant dans le sens horaire.
 */
export function sectorIndexAt(angleDeg: number): number {
  const shifted = (((angleDeg + SECTOR_ANGLE / 2) % 360) + 360) % 360;
  return Math.floor(shifted / SECTOR_ANGLE) % SECTORS.length;
}

/** Angle (depuis le haut, sens horaire) du milieu du secteur portant ce numéro. */
export function sectorCenterAngle(sector: number): number {
  const i = SECTORS.indexOf(sector as (typeof SECTORS)[number]);
  if (i < 0) throw new Error(`Secteur inconnu : ${sector}`);
  return i * SECTOR_ANGLE;
}

/** Point du plan de la cible (mm) à un rayon et un angle depuis le haut donnés. */
export function boardPoint(radius: number, angleFromTopDeg: number): { x: number; y: number } {
  const a = (angleFromTopDeg * Math.PI) / 180;
  return { x: radius * Math.sin(a), y: radius * Math.cos(a) };
}

export function makeScore(secteur: number, multiplicateur: Multiplier): Score {
  if (multiplicateur === 0 || secteur === 0) return MISS;
  if (secteur === 25) {
    return multiplicateur === 2
      ? { secteur: 25, multiplicateur: 2, points: 50, libelle: 'BULL' }
      : { secteur: 25, multiplicateur: 1, points: 25, libelle: '25' };
  }
  const prefix = multiplicateur === 3 ? 'T' : multiplicateur === 2 ? 'D' : '';
  return { secteur, multiplicateur, points: secteur * multiplicateur, libelle: `${prefix}${secteur}` };
}

/**
 * Score d'un impact à la position (x, y) en mm dans le repère de la cible.
 * Les limites d'anneau sont incluses dans l'anneau le plus proche du centre
 * pour le bull et le 25 (r ≤ 6,35 → BULL ; r ≤ 15,9 → 25), et dans le triple /
 * double pour leurs deux bords (99 ≤ r ≤ 107, 162 ≤ r ≤ 170). Au-delà de 170 : 0.
 */
export function scoreFromBoardCoords(x_mm: number, y_mm: number): Score {
  if (!Number.isFinite(x_mm) || !Number.isFinite(y_mm)) return MISS;
  const r = Math.hypot(x_mm, y_mm);
  if (r <= RADII.bull) return makeScore(25, 2);
  if (r <= RADII.outerBull) return makeScore(25, 1);
  if (r > RADII.doubleOuter) return MISS;

  const secteur = SECTORS[sectorIndexAt(angleFromTop(x_mm, y_mm))];
  if (r >= RADII.tripleInner && r <= RADII.tripleOuter) return makeScore(secteur, 3);
  if (r >= RADII.doubleInner) return makeScore(secteur, 2);
  return makeScore(secteur, 1);
}
