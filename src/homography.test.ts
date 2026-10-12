import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { applyH, computeHomography, invertH, multiplyH, type Mat3, type Pt } from './homography';

// Une vue en biais typique : image (pixels) → cible (mm).
const TRUE_H: Mat3 = [0.9, 0.12, -310, -0.05, -1.1, 520, 0.0006, -0.0002, 1];

const BOARD: Pt[] = [
  { x: 0, y: 170 },
  { x: 170, y: 0 },
  { x: 0, y: -170 },
  { x: -170, y: 0 },
  { x: 0, y: 0 },
];
const IMAGE = BOARD.map((p) => applyH(invertH(TRUE_H), p));

function expectClose(a: Pt, b: Pt, tol = 1e-6) {
  expect(Math.abs(a.x - b.x)).toBeLessThan(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThan(tol);
}

describe('homographie', () => {
  it('H · H⁻¹ = identité', () => {
    const I = multiplyH(TRUE_H, invertH(TRUE_H));
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(I[i] / I[8]).toBeCloseTo(v, 9));
  });

  it('retrouve exactement H avec 4 points', () => {
    const H = computeHomography(IMAGE.slice(0, 4), BOARD.slice(0, 4));
    H.forEach((v, i) => expect(v).toBeCloseTo(TRUE_H[i], 6));
  });

  it('retrouve H avec les 5 repères et projette correctement', () => {
    const H = computeHomography(IMAGE, BOARD);
    IMAGE.forEach((p, i) => expectClose(applyH(H, p), BOARD[i], 1e-6));
    const q = applyH(invertH(TRUE_H), { x: 40, y: -103 });
    expectClose(applyH(H, q), { x: 40, y: -103 }, 1e-6);
  });

  it('avec un repère imprécis, reste proche (moindres carrés)', () => {
    const noisy = IMAGE.map((p, i) => (i === 4 ? { x: p.x + 1.5, y: p.y - 1 } : p));
    const H = computeHomography(noisy, BOARD);
    const err = Math.hypot(applyH(H, IMAGE[4]).x, applyH(H, IMAGE[4]).y);
    expect(err).toBeLessThan(5);
  });

  it('refuse les points dégénérés', () => {
    const line = [0, 1, 2, 3].map((k) => ({ x: k, y: 2 * k }));
    expect(() => computeHomography(line, BOARD.slice(0, 4))).toThrow();
    expect(() => computeHomography(IMAGE.slice(0, 3), BOARD.slice(0, 3))).toThrow();
  });

  it('donne le même résultat que cv.findHomography (OpenCV.js)', async () => {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cv: any = require('@techstark/opencv-js');
    if (!cv.Mat) {
      cv = await new Promise((resolve) => {
        if (typeof cv.then === 'function') cv.then((m: unknown) => { delete (m as { then?: unknown }).then; resolve(m); });
        else cv.onRuntimeInitialized = () => resolve(cv);
      });
    }
    const noisy = IMAGE.map((p, i) => ({ x: p.x + (i % 2 ? 0.8 : -0.6), y: p.y + (i % 3 ? 0.5 : -0.7) }));
    const src = cv.matFromArray(5, 1, cv.CV_32FC2, noisy.flatMap((p) => [p.x, p.y]));
    const dst = cv.matFromArray(5, 1, cv.CV_32FC2, BOARD.flatMap((p) => [p.x, p.y]));
    const Hcv = cv.findHomography(src, dst);
    const ref = Array.from(Hcv.data64F as Float64Array) as Mat3;
    src.delete(); dst.delete(); Hcv.delete();

    const H = computeHomography(noisy, BOARD);
    // Même projection à 0,5 mm près partout sur la cible.
    for (const p of [...noisy, { x: 300, y: 300 }, { x: 200, y: 400 }]) {
      const a = applyH(H, p);
      const b = applyH(ref, p);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.5);
    }
  }, 30000);
});
