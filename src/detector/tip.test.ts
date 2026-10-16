import { describe, expect, it } from 'vitest';
import type { Mat3 } from '../homography';
import { findTip, scoreFragile} from './tip';

/** Silhouette d'une fléchette : fût fin de la pointe (tip) sur `len` px, puis empennage large. */
function dartBlob(tip: { x: number; y: number }, angleDeg: number, len = 120, flight = 26) {
  const a = (angleDeg * Math.PI) / 180;
  const v = { x: Math.cos(a), y: Math.sin(a) };
  const w = { x: -v.y, y: v.x };
  const xy: number[] = [];
  for (let s = 0; s <= len; s += 0.5) {
    const half = s < len * 0.7 ? 2.5 : (flight / 2) * ((s - len * 0.7) / (len * 0.3));
    for (let q = -half; q <= half; q += 0.5) xy.push(tip.x + v.x * s + w.x * q, tip.y + v.y * s + w.y * q);
  }
  return { xy, v };
}

describe('pointe de la fléchette', () => {
  it('direction de sortie connue : pointe au bon bout', () => {
    const { xy, v } = dartBlob({ x: 300, y: 500 }, -50);
    const r = findTip({ xy, outDir: v })!;
    expect(Math.hypot(r.tip.x - 300, r.tip.y - 500)).toBeLessThan(2);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('sans direction : la largeur suffit (bout fin = pointe)', () => {
    const { xy } = dartBlob({ x: 200, y: 200 }, 30);
    const r = findTip({ xy })!;
    expect(Math.hypot(r.tip.x - 200, r.tip.y - 200)).toBeLessThan(2);
  });

  it('la direction l’emporte sur une largeur trompeuse', () => {
    // Fléchette « à l'envers » (empennage caché) : seule la direction sait.
    const { xy, v } = dartBlob({ x: 100, y: 100 }, 0, 100, 4);
    const r = findTip({ xy, outDir: v })!;
    expect(r.tip.x).toBeLessThan(105);
  });

  it('la pointe est sur la cible', () => {
    const { xy } = dartBlob({ x: 100, y: 100 }, 0, 100, 4);
    const r = findTip({ xy, boardRadius: (p) => (p.x < 150 ? 100 : 250) })!;
    expect(r.tip.x).toBeLessThan(105);
  });

  it('trop peu de pixels → rien', () => {
    expect(findTip({ xy: [1, 2, 3, 4] })).toBeNull();
  });
});

describe('morceaux et prolongement', () => {
  it('rassemble les morceaux alignés, ignore les autres', async () => {
    const { mergeAlongAxis } = await import('./tip');
    const line = (x0: number, x1: number, y: number) => {
      const xy: number[] = [];
      for (let x = x0; x <= x1; x++) for (let k = -2; k <= 2; k++) xy.push(x, y + k);
      return { xy };
    };
    const main = line(100, 200, 50);
    const aligned = line(70, 90, 51);
    const away = line(100, 120, 90);
    const r = mergeAlongAxis(main, [aligned, away]);
    expect(r.merged).toBe(1);
  });

  it('prolonge la pointe sur une trace faible', async () => {
    const { extendTip } = await import('./tip');
    const W = 200;
    const diff = new Uint8Array(W * 100);
    for (let x = 60; x <= 100; x++) diff[50 * W + x] = 15; // trace faible de 60 à 100
    const r = extendTip({ x: 100, y: 50 }, { x: 1, y: 0 }, diff, W, 100, 10);
    expect(r.tip.x).toBe(60);
  });
});

describe('score fragile', () => {
  // Cadre fictif : 1 px = 1 mm, y de l'image vers le bas.
  const F2B: Mat3 = [1, 0, -320, 0, -1, 320, 0, 0, 1];
  const up = { x: 0, y: -1 };

  it('marque une pointe juste au bord du triple', () => {
    // RADII.tripleOuter = 107 mm : à 106 mm, +2 mm fait sortir du triple.
    const tip = { x: 320, y: 320 - 106 };
    expect(scoreFragile(F2B, tip, up, 'T20', 2)).toBe(true);
  });

  it('ne marque pas une pointe bien au milieu de sa case', () => {
    const tip = { x: 320, y: 320 - 130 };
    expect(scoreFragile(F2B, tip, up, '20', 2)).toBe(false);
  });

  it('marque aussi une pointe au bord d’un secteur voisin', () => {
    // Juste à côté du fil entre le 20 et le 1 : à 130 mm du centre, 2 mm de côté suffisent.
    const a = ((9 - 0.3) * Math.PI) / 180;
    const tip = { x: 320 + 130 * Math.sin(a), y: 320 - 130 * Math.cos(a) };
    expect(scoreFragile(F2B, tip, { x: Math.sin(a), y: -Math.cos(a) }, '20', 2)).toBe(true);
  });

  it('le même écart angulaire compte près du centre, pas au bord', () => {
    // 1,5° avant le fil : 1,6 mm à 60 mm du bull (douteux), 3,7 mm à 140 mm (sûr).
    const a = ((9 - 1.5) * Math.PI) / 180;
    const at = (r: number) => ({ x: 320 + r * Math.sin(a), y: 320 - r * Math.cos(a) });
    const dir = { x: Math.sin(a), y: -Math.cos(a) };
    expect(scoreFragile(F2B, at(60), dir, '20', 2)).toBe(true);
    expect(scoreFragile(F2B, at(140), dir, '20', 2)).toBe(false);
  });
});
