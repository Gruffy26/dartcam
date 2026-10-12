// Loupe affichée au-dessus du doigt pour viser précisément (calibration, corrections).

import type { FrameInfo } from './camera-stage';
import type { Pt } from './homography';
import { fitCanvas } from './overlay-draw';

export const LOUPE_SIZE = 150;
const LOUPE_ZOOM = 3;

/**
 * Dessine la loupe centrée sur `norm` (coordonnées cadre 0–1) et la place au-dessus
 * (ou en dessous, près du haut de l'écran) du point `center` (px écran).
 * `extra` permet de dessiner par-dessus (dessin de la cible…), en coordonnées loupe.
 */
export function showLoupe(
  loupe: HTMLCanvasElement,
  video: HTMLVideoElement,
  f: FrameInfo,
  norm: Pt,
  center: Pt,
  containerWidth: number,
  extra?: (ctx: CanvasRenderingContext2D, toLoupe: (screen: Pt) => Pt) => void,
) {
  const ctx = fitCanvas(loupe, LOUPE_SIZE, LOUPE_SIZE);
  const dispScale = f.screen.w / f.crop.w; // px écran par px vidéo
  const srcSize = LOUPE_SIZE / (dispScale * LOUPE_ZOOM);
  const vx = f.crop.x + norm.x * f.crop.w;
  const vy = f.crop.y + norm.y * f.crop.h;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
  ctx.drawImage(video, vx - srcSize / 2, vy - srcSize / 2, srcSize, srcSize, 0, 0, LOUPE_SIZE, LOUPE_SIZE);
  const toLoupe = (s: Pt) => ({
    x: (s.x - center.x) * LOUPE_ZOOM + LOUPE_SIZE / 2,
    y: (s.y - center.y) * LOUPE_ZOOM + LOUPE_SIZE / 2,
  });
  extra?.(ctx, toLoupe);
  const c = LOUPE_SIZE / 2;
  ctx.strokeStyle = '#2af5ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(c - 20, c);
  ctx.lineTo(c - 4, c);
  ctx.moveTo(c + 4, c);
  ctx.lineTo(c + 20, c);
  ctx.moveTo(c, c - 20);
  ctx.lineTo(c, c - 4);
  ctx.moveTo(c, c + 4);
  ctx.lineTo(c, c + 20);
  ctx.stroke();

  const above = center.y - 50 - LOUPE_SIZE > 70;
  const left = Math.min(Math.max(center.x - LOUPE_SIZE / 2, 8), containerWidth - LOUPE_SIZE - 8);
  const top = above ? center.y - 50 - LOUPE_SIZE : center.y + 50;
  loupe.style.transform = `translate(${left}px, ${top}px)`;
  loupe.classList.remove('hidden');
}
