// Petit schéma SVG de la cible, avec un point qui montre où toucher.

import { boardPoint, RADII, SECTORS, SECTOR_ANGLE } from './board';
import type { Pt } from './homography';

function wedge(r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => {
    const q = boardPoint(r, a);
    return `${q.x.toFixed(1)} ${(-q.y).toFixed(1)}`;
  };
  return `M${p(r0, a0)} L${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
}

export function miniBoardSvg(target: Pt | null): string {
  const parts: string[] = ['<circle r="200" fill="#191919"/>'];
  SECTORS.forEach((_, i) => {
    const a0 = i * SECTOR_ANGLE - SECTOR_ANGLE / 2;
    const a1 = a0 + SECTOR_ANGLE;
    const even = i % 2 === 0;
    const single = even ? '#1e1e1e' : '#efe3c4';
    const ring = even ? '#d62828' : '#1e9646';
    parts.push(`<path d="${wedge(RADII.outerBull, RADII.tripleInner, a0, a1)}" fill="${single}"/>`);
    parts.push(`<path d="${wedge(RADII.tripleInner, RADII.tripleOuter, a0, a1)}" fill="${ring}"/>`);
    parts.push(`<path d="${wedge(RADII.tripleOuter, RADII.doubleInner, a0, a1)}" fill="${single}"/>`);
    parts.push(`<path d="${wedge(RADII.doubleInner, RADII.doubleOuter, a0, a1)}" fill="${ring}"/>`);
  });
  parts.push(`<circle r="${RADII.outerBull}" fill="#1e9646"/><circle r="${RADII.bull}" fill="#d62828"/>`);
  SECTORS.forEach((n, i) => {
    const q = boardPoint(186, i * SECTOR_ANGLE);
    parts.push(`<text x="${q.x.toFixed(1)}" y="${(-q.y + 8).toFixed(1)}" font-size="24" font-weight="700" text-anchor="middle" fill="#fff">${n}</text>`);
  });
  if (target) {
    const t = `cx="${target.x.toFixed(1)}" cy="${(-target.y).toFixed(1)}"`;
    parts.push(`<circle ${t} r="26" fill="none" stroke="#2af5ff" stroke-width="8" class="pulse"/>`);
    parts.push(`<circle ${t} r="9" fill="#2af5ff"/>`);
  }
  return `<svg viewBox="-205 -205 410 410" class="miniboard" aria-hidden="true">${parts.join('')}</svg>`;
}
