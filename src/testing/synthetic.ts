// Images de synthèse d'une cible vue par une caméra placée sur le côté,
// pour tester la calibration automatique et la détection sans vraie cible.

import { angleFromTop, RADII, sectorIndexAt } from '../board';
import { applyH, invertH, type Mat3, type Pt } from '../homography';

export interface CameraPose {
  /** Angle horizontal entre l'axe de la cible et la caméra (degrés, + = caméra à droite). */
  yawDeg: number;
  /** Angle vertical (degrés, + = caméra au-dessus). */
  pitchDeg?: number;
  /** Inclinaison du téléphone (degrés). */
  rollDeg?: number;
  /** Distance caméra – centre de la cible (mm). */
  distance: number;
  /** Focale en pixels. */
  focal: number;
  width: number;
  height: number;
  /** Décalage du centre de la cible dans l'image (pixels). */
  shift?: Pt;
}

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Homographie cible (mm, y vers le haut) → image (pixels) pour une pose de caméra. */
export function cameraHomography(p: CameraPose): Mat3 {
  const yaw = (p.yawDeg * Math.PI) / 180;
  const pitch = ((p.pitchDeg ?? 0) * Math.PI) / 180;
  const roll = ((p.rollDeg ?? 0) * Math.PI) / 180;
  // Cible dans le plan z = 0, face vers +z, y vers le haut.
  const C: V3 = [
    p.distance * Math.sin(yaw) * Math.cos(pitch),
    p.distance * Math.sin(pitch),
    p.distance * Math.cos(yaw) * Math.cos(pitch),
  ];
  const f = norm(sub([0, 0, 0], C));
  let r = norm(cross(f, [0, 1, 0]));
  let d = cross(f, r);
  // Roulis autour de l'axe de visée.
  const rr: V3 = [
    r[0] * Math.cos(roll) + d[0] * Math.sin(roll),
    r[1] * Math.cos(roll) + d[1] * Math.sin(roll),
    r[2] * Math.cos(roll) + d[2] * Math.sin(roll),
  ];
  d = cross(f, rr);
  r = rr;
  const cx = p.width / 2 + (p.shift?.x ?? 0);
  const cy = p.height / 2 + (p.shift?.y ?? 0);
  // x_img ∝ K·R·(X − C), avec X = (x, y, 0).
  const col = (v: V3): V3 => [p.focal * dot(r, v) + cx * dot(f, v), p.focal * dot(d, v) + cy * dot(f, v), dot(f, v)];
  const c1 = col([1, 0, 0]);
  const c2 = col([0, 1, 0]);
  const mC: V3 = [-C[0], -C[1], -C[2]];
  const c3 = col(mC);
  const H: Mat3 = [c1[0], c2[0], c3[0], c1[1], c2[1], c3[1], c1[2], c2[2], c3[2]];
  return H.map((v) => v / H[8]) as Mat3;
}

const COLORS = {
  red: [200, 35, 40],
  green: [25, 135, 65],
  black: [28, 28, 30],
  cream: [232, 218, 186],
  surround: [20, 20, 22],
  wall: [176, 168, 150],
};

/** Couleur de la cible au point (x, y) en mm, ou null hors de la cible. */
export function boardColor(x: number, y: number): number[] | null {
  const r = Math.hypot(x, y);
  if (r > 225) return null;
  if (r > RADII.doubleOuter) return COLORS.surround;
  if (r <= RADII.bull) return COLORS.red;
  if (r <= RADII.outerBull) return COLORS.green;
  const i = sectorIndexAt(angleFromTop(x, y));
  const even = i % 2 === 0;
  // Fils métalliques : fines lignes grises aux frontières.
  const a = angleFromTop(x, y);
  const toBoundary = Math.abs((((a + 9) % 18) + 18) % 18 - 0) < 0.25 || Math.abs(((a + 9) % 18) - 18) < 0.25;
  if (toBoundary && r > RADII.outerBull) return [150, 150, 150];
  if ((r >= RADII.tripleInner && r <= RADII.tripleOuter) || r >= RADII.doubleInner) return even ? COLORS.red : COLORS.green;
  return even ? COLORS.black : COLORS.cream;
}

export interface RenderOptions {
  noise?: number;
  /** Variation d'éclairage gauche → droite (0 = uniforme). */
  gradient?: number;
  seed?: number;
  /** Fléchettes dessinées par-dessus (en coordonnées image). */
  extra?: (x: number, y: number) => number[] | null;
}

export function renderBoard(boardToImage: Mat3, width: number, height: number, opts: RenderOptions = {}) {
  const { noise = 8, gradient = 0.25 } = opts;
  let seed = opts.seed ?? 1;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const inv = invertH(boardToImage);
  const data = new Uint8ClampedArray(width * height * 4);
  // Sur-échantillonnage 2×2 pour des bords réalistes.
  const offs = [0.25, 0.75];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const oy of offs)
        for (const ox of offs) {
          const extra = opts.extra?.(x + ox, y + oy);
          let c = extra;
          if (!c) {
            const q = applyH(inv, { x: x + ox, y: y + oy });
            c = boardColor(q.x, q.y) ?? COLORS.wall;
          }
          r += c[0];
          g += c[1];
          b += c[2];
        }
      const light = 1 - gradient / 2 + (gradient * x) / width;
      const i = (y * width + x) * 4;
      data[i] = (r / 4) * light + (rand() - 0.5) * 2 * noise;
      data[i + 1] = (g / 4) * light + (rand() - 0.5) * 2 * noise;
      data[i + 2] = (b / 4) * light + (rand() - 0.5) * 2 * noise;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}
