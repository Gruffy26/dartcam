import { describe, expect, it } from 'vitest';
import { containRect, frameToScreen, screenToFrame } from './frameview';

describe('frameview', () => {
  it('vidéo portrait dans un écran portrait plus allongé : bandes en haut et en bas', () => {
    expect(containRect(390, 844, 1080, 1920)).toEqual({ x: 0, y: (844 - 693.3333333333334) / 2, w: 390, h: 693.3333333333334 });
  });

  it('vidéo paysage dans un écran portrait', () => {
    const r = containRect(400, 800, 1920, 1080);
    expect(r.w).toBe(400);
    expect(r.h).toBeCloseTo(225);
  });

  it('aller-retour écran ↔ cadre', () => {
    const r = containRect(390, 844, 1080, 1920);
    const f = screenToFrame(r, { x: 195, y: 422 });
    expect(f.x).toBeCloseTo(0.5);
    expect(f.y).toBeCloseTo(0.5);
    const s = frameToScreen(r, { x: 0.25, y: 0.75 });
    expect(screenToFrame(r, s).x).toBeCloseTo(0.25);
    expect(screenToFrame(r, s).y).toBeCloseTo(0.75);
  });
});
