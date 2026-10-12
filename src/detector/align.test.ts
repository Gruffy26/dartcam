import { describe, expect, it } from 'vitest';
import { estimateShift, makeAnchor } from './align';

const W = 200;
const H = 160;

/** Image texturée (motif lisse) décalée de (dx, dy). */
function texture(dx: number, dy: number): Float32Array {
  const img = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const X = x - dx;
      const Y = y - dy;
      img[y * W + x] = 128 + 60 * Math.sin(X / 7) * Math.cos(Y / 9) + 40 * Math.sin((X + Y) / 13);
    }
  return img;
}

describe('recalage', () => {
  it('retrouve un décalage sous-pixel', () => {
    const anchor = makeAnchor(texture(0, 0), W, H)!;
    for (const [dx, dy] of [[0, 0], [1.3, -0.7], [-2.6, 2.2], [4.4, 3.1]]) {
      const s = estimateShift(anchor, texture(dx, dy));
      // img(x + s) = ancrage(x)  ⇒  s = (dx, dy)
      expect(s.x).toBeCloseTo(dx, 1);
      expect(s.y).toBeCloseTo(dy, 1);
    }
  });

  it('résiste à un objet nouveau (fléchette) dans l’image', () => {
    const anchor = makeAnchor(texture(0, 0), W, H)!;
    const img = texture(1.5, -1);
    for (let y = 40; y < 120; y++) for (let x = 90; x < 98; x++) img[y * W + x] = 10;
    const s = estimateShift(anchor, img);
    expect(s.x).toBeCloseTo(1.5, 1);
    expect(s.y).toBeCloseTo(-1, 1);
  });

  it('image uniforme : pas d’ancrage possible', () => {
    expect(makeAnchor(new Float32Array(W * H).fill(100), W, H)).toBeNull();
  });
});
