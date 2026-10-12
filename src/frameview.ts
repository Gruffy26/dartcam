// Correspondance entre l'écran et le « cadre » analysé (coordonnées normalisées 0–1).
//
// La vidéo est affichée en `object-fit: contain`. Avec un zoom numérique z, elle est
// agrandie de z autour du centre et l'analyse recadre le centre du même facteur :
// le cadre analysé occupe donc exactement le rectangle « contain » non zoomé.

import type { Pt } from './homography';
import type { Rect } from './zoom';

export function containRect(boxW: number, boxH: number, contentW: number, contentH: number): Rect {
  const s = Math.min(boxW / contentW, boxH / contentH);
  const w = contentW * s;
  const h = contentH * s;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

export function screenToFrame(r: Rect, p: Pt): Pt {
  return { x: (p.x - r.x) / r.w, y: (p.y - r.y) / r.h };
}

export function frameToScreen(r: Rect, p: Pt): Pt {
  return { x: r.x + p.x * r.w, y: r.y + p.y * r.h };
}
