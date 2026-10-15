// Modèle de caméra déduit de la calibration : à partir de l'homographie cible → image,
// on estime la focale et la position de la caméra. On peut alors savoir dans quelle
// direction, à l'image, « sort » un objet planté perpendiculairement dans la cible :
// c'est ce qui permet de distinguer la pointe (sur la cible) de l'empennage.

import { applyH, invertH, type Mat3, type Pt } from '../homography';

type V3 = [number, number, number];

export interface CameraModel {
  focal: number;
  cx: number;
  cy: number;
  /** Rotation (colonnes r1, r2, r3) et translation : X_caméra = R·X_cible + t. */
  r1: V3;
  r2: V3;
  r3: V3;
  t: V3;
  /** Normale à la cible, côté caméra / lanceur (repère cible, ±z). */
  normalSign: 1 | -1;
  /** true si la focale a été estimée à partir de la vue en biais (sinon valeur par défaut). */
  focalEstimated: boolean;
}

const norm = (v: V3) => Math.hypot(v[0], v[1], v[2]);
const scale = (v: V3, k: number): V3 => [v[0] * k, v[1] * k, v[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * @param boardToImage homographie cible (mm) → image (pixels)
 * @param width, height taille de l'image (le point principal est supposé au centre)
 * @param defaultFocal focale à utiliser si elle ne peut pas être estimée (vue trop de face)
 */
export function cameraFromHomography(boardToImage: Mat3, width: number, height: number, defaultFocal: number): CameraModel | null {
  const cx = width / 2;
  const cy = height / 2;
  // Recentre l'image sur le point principal.
  const H = boardToImage;
  const h = (r: number, c: number) => {
    const v = H[r * 3 + c];
    if (r === 0) return v - cx * H[6 + c];
    if (r === 1) return v - cy * H[6 + c];
    return v;
  };
  const [h11, h12, h13] = [h(0, 0), h(0, 1), h(0, 2)];
  const [h21, h22, h23] = [h(1, 0), h(1, 1), h(1, 2)];
  const [h31, h32, h33] = [h(2, 0), h(2, 1), h(2, 2)];

  // Contraintes de Zhang avec K = diag(f, f, 1) : u = 1/f².
  const a1 = h11 * h12 + h21 * h22;
  const b1 = h31 * h32;
  const a2 = h11 * h11 + h21 * h21 - h12 * h12 - h22 * h22;
  const b2 = h31 * h31 - h32 * h32;
  const u = -(a1 * b1 + a2 * b2) / (a1 * a1 + a2 * a2);
  let focal = defaultFocal;
  let focalEstimated = false;
  if (u > 0 && Number.isFinite(u)) {
    const f = 1 / Math.sqrt(u);
    // Garde-fou : focale plausible pour un téléphone (champ de 15° à 120°).
    if (f > width * 0.3 && f < width * 4) {
      focal = f;
      focalEstimated = true;
    }
  }

  const k1: V3 = [h11 / focal, h21 / focal, h31];
  const k2: V3 = [h12 / focal, h22 / focal, h32];
  const k3: V3 = [h13 / focal, h23 / focal, h33];
  const lambda = 2 / (norm(k1) + norm(k2));
  if (!Number.isFinite(lambda) || lambda === 0) return null;
  let r1 = scale(k1, lambda);
  let r2 = scale(k2, lambda);
  let t = scale(k3, lambda);
  if (t[2] < 0) {
    r1 = scale(r1, -1);
    r2 = scale(r2, -1);
    t = scale(t, -1);
  }
  const r3 = cross(r1, r2);
  // Centre de la caméra dans le repère de la cible : C = −Rᵀt ; sa coordonnée z donne le côté.
  const cz = -dot(r3, t);
  return { focal, cx, cy, r1, r2, r3, t, normalSign: cz >= 0 ? 1 : -1, focalEstimated };
}

/** Projection d'un point 3D du repère cible (mm, z vers la caméra si normalSign = 1). */
export function project(cam: CameraModel, x: number, y: number, z: number): Pt | null {
  const X: V3 = [
    cam.r1[0] * x + cam.r2[0] * y + cam.r3[0] * z + cam.t[0],
    cam.r1[1] * x + cam.r2[1] * y + cam.r3[1] * z + cam.t[1],
    cam.r1[2] * x + cam.r2[2] * y + cam.r3[2] * z + cam.t[2],
  ];
  if (X[2] <= 1e-6) return null;
  return { x: cam.cx + (cam.focal * X[0]) / X[2], y: cam.cy + (cam.focal * X[1]) / X[2] };
}

/**
 * Direction (vecteur unitaire, à l'image) d'un objet qui sort de la cible au point
 * `boardPt` (mm) vers le lanceur : de la pointe vers l'empennage pour une fléchette droite.
 */
export function outDirection(cam: CameraModel, boardPt: Pt, length = 60): Pt | null {
  const a = project(cam, boardPt.x, boardPt.y, 0);
  const b = project(cam, boardPt.x, boardPt.y, cam.normalSign * length);
  if (!a || !b) return null;
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  return d > 1e-6 ? { x: (b.x - a.x) / d, y: (b.y - a.y) / d } : null;
}

/** Même chose, à partir d'un point de l'image (sur le plan de la cible). */
export function outDirectionAtImage(cam: CameraModel, frameToBoard: Mat3, imgPt: Pt, length = 60): Pt | null {
  return outDirection(cam, applyH(frameToBoard, imgPt), length);
}

/** Où se trouve la caméra par rapport à la cible, déduit de la calibration. */
export interface CameraPose {
  /** Angle horizontal par rapport à l'axe de la cible : négatif à gauche, positif à droite. */
  azimuthDeg: number;
  /** Angle vertical : positif au-dessus du centre de la cible. */
  elevationDeg: number;
  /** Distance de la caméra au centre de la cible (mm). */
  distanceMm: number;
}

/**
 * Position de la caméra dans le repère de la cible : centre optique C = −Rᵀ·t.
 *
 * Mesuré sur de vraies parties : de côté (25–30°) la détection est bonne, presque de
 * face (moins de 10°) une fléchette sur deux est fausse ou manquée — vue dans l'axe,
 * la fléchette pointe vers l'objectif et sa longueur à l'image se réduit à presque rien.
 */
export function cameraPose(cam: CameraModel): CameraPose {
  const R = [cam.r1, cam.r2, cam.r3];
  const C = [0, 1, 2].map((i) => -(R[0][i] * cam.t[0] + R[1][i] * cam.t[1] + R[2][i] * cam.t[2]));
  const distanceMm = Math.hypot(C[0], C[1], C[2]) || 1;
  return {
    azimuthDeg: (Math.atan2(C[0], Math.abs(C[2])) * 180) / Math.PI,
    elevationDeg: (Math.asin(C[1] / distanceMm) * 180) / Math.PI,
    distanceMm,
  };
}

/** En dessous de cet angle, la caméra est trop dans l'axe de la cible. */
export const MIN_AZIMUTH_DEG = 18;

/** Focale par défaut d'un iPhone (caméra principale, champ horizontal ≈ 70° en 16:9 paysage) pour une largeur donnée. */
export function defaultFocalFor(width: number, height: number, zoom = 1): number {
  const longSide = Math.max(width, height);
  return ((longSide / 2) / Math.tan((35 * Math.PI) / 180)) * zoom;
}

export { invertH };
