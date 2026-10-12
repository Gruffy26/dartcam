import { describe, expect, it } from 'vitest';
import { clampZoom, createZoomControl, cropRect, formatZoom } from './zoom';

describe('zoom', () => {
  it('sans zoom, utilise toute l’image', () => {
    expect(cropRect(1080, 1920, 1)).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
  });

  it('zoom 2× : recadre le centre, moitié de largeur et de hauteur', () => {
    expect(cropRect(1080, 1920, 2)).toEqual({ x: 270, y: 480, w: 540, h: 960 });
  });

  it('un zoom inférieur à 1 est traité comme 1', () => {
    expect(cropRect(100, 100, 0.5)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('borne et formate la valeur', () => {
    expect(clampZoom(5, 1, 3)).toBe(3);
    expect(clampZoom(0.2, 1, 3)).toBe(1);
    expect(formatZoom(1.5)).toBe('1,5×');
  });

  it('sans zoom capteur, bascule en zoom numérique', async () => {
    const z = createZoomControl(null, 1.8);
    expect(z.mode).toBe('numérique');
    expect(z.digital).toBeCloseTo(1.8);
    await z.set(10);
    expect(z.value).toBe(3);
    expect(z.digital).toBe(3);
  });

  it('avec zoom capteur, applique la contrainte et garde le zoom numérique à 1', async () => {
    const applied: unknown[] = [];
    const track = {
      getCapabilities: () => ({ zoom: { min: 1, max: 6, step: 0.01 } }),
      applyConstraints: async (c: unknown) => void applied.push(c),
    } as unknown as MediaStreamTrack;
    const z = createZoomControl(track, 2);
    expect(z.mode).toBe('capteur');
    await z.set(2.5);
    expect(z.value).toBe(2.5);
    expect(z.digital).toBe(1);
    expect(applied).toEqual([{ advanced: [{ zoom: 2.5 }] }]);
  });
});
