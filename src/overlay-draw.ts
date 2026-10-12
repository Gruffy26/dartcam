// Dessin de la cible projetée (anneaux, secteurs, numéros) sur un canvas.

import type { BoardOverlay } from './calibration';
import type { Pt } from './homography';

export function drawBoardOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: BoardOverlay,
  toScreen: (p: Pt) => Pt,
  opts: { alpha?: number; lineWidth?: number; numbers?: boolean } = {},
): void {
  const { alpha = 1, lineWidth = 1.5, numbers = true } = opts;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';

  const path = () => {
    ctx.beginPath();
    for (const ring of overlay.rings) {
      ring.forEach((p, i) => {
        const s = toScreen(p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
    }
    for (const [a, b] of overlay.spokes) {
      const sa = toScreen(a);
      const sb = toScreen(b);
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
    }
  };
  // Trait sombre dessous + trait clair dessus : visible sur le noir comme sur le blanc.
  path();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = lineWidth + 2;
  ctx.stroke();
  path();
  ctx.strokeStyle = '#ffe14d';
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  if (numbers) {
    ctx.font = 'bold 15px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.fillStyle = '#fff';
    for (const { n, p } of overlay.numbers) {
      const s = toScreen(p);
      ctx.strokeText(String(n), s.x, s.y);
      ctx.fillText(String(n), s.x, s.y);
    }
  }
  ctx.restore();
}

/** Ajuste la taille interne d'un canvas à sa taille affichée (écran Retina). Renvoie le contexte prêt à dessiner en px CSS. */
export function fitCanvas(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = Math.round(w * dpr);
  const H = Math.round(h * dpr);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}
