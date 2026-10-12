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

/**
 * Vue de face en couleur (ImageData `size`×`size`), ±`halfMm` mm autour du centre,
 * le 20 en haut. Hors de l'image d'origine : noir.
 */
export function rectifyRGBA(img: RgbaImage, frameToBoard: Mat3, size: number, halfMm = 225): ImageData {
  const B2F = invertH(frameToBoard);
  const out = new ImageData(size, size);
  const k = (2 * halfMm) / size;
  const w = img.width;
  const d = img.data;
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      const p = applyH(B2F, { x: -halfMm + (u + 0.5) * k, y: halfMm - (v + 0.5) * k });
      const o = (v * size + u) * 4;
      out.data[o + 3] = 255;
      if (p.x < 0 || p.y < 0 || p.x >= img.width - 1 || p.y >= img.height - 1) continue;
      const xi = Math.floor(p.x);
      const yi = Math.floor(p.y);
      const fx = p.x - xi;
      const fy = p.y - yi;
      const i00 = (yi * w + xi) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + w * 4;
      const i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        out.data[o + c] =
          d[i00 + c] * (1 - fx) * (1 - fy) + d[i10 + c] * fx * (1 - fy) + d[i01 + c] * (1 - fx) * fy + d[i11 + c] * fx * fy;
      }
    }
  }
  return out;
}
