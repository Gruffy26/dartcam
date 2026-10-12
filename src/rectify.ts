// Vue « de face » de la cible : échantillonne l'image à travers l'homographie.
// Utilisé pour lire les chiffres du tour de cible (orientation) et pour le débogage.

import type { RgbaImage } from './autocalib';
import { applyH, invertH, type Mat3 } from './homography';

/** Luminosité (0–255) au point (x, y) de l'image, interpolée ; NaN hors image. */
export function grayAt(img: RgbaImage, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= img.width - 1 || y >= img.height - 1) return NaN;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const w = img.width;
  const g = (i: number) => (img.data[4 * i] + img.data[4 * i + 1] + img.data[4 * i + 2]) / 3;
  const i = yi * w + xi;
  return g(i) * (1 - fx) * (1 - fy) + g(i + 1) * fx * (1 - fy) + g(i + w) * (1 - fx) * fy + g(i + w + 1) * fx * fy;
}

/**
 * Image de face en niveaux de gris : `size`×`size` pixels couvrant ±`halfMm` mm autour
 * du centre, y vers le haut (le 20 en haut). NaN hors de l'image d'origine.
 */
export function rectifyGray(img: RgbaImage, frameToBoard: Mat3, size: number, halfMm = 225): Float32Array {
  const B2F = invertH(frameToBoard);
  const out = new Float32Array(size * size);
  const k = (2 * halfMm) / size;
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      const p = applyH(B2F, { x: -halfMm + (u + 0.5) * k, y: halfMm - (v + 0.5) * k });
      out[v * size + u] = grayAt(img, p.x, p.y);
    }
  }
  return out;
}
