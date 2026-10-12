import { describe, expect, it } from 'vitest';
import { autoCalibrate } from './autocalib';
import { boardPoint, scoreFromBoardCoords, sectorCenterAngle } from './board';
import { applyH, type Mat3 } from './homography';
import { loadCvForTests } from './testing/cv-node';
import { cameraHomography, renderBoard, type CameraPose } from './testing/synthetic';

const W = 480;
const H = 854; // portrait, comme sur l'iPhone

function pose(p: Partial<CameraPose>): CameraPose {
  return { yawDeg: 40, distance: 900, focal: 1000, width: W, height: H, ...p };
}

/** Erreur (mm) entre la calibration trouvée et la vraie, sur toute la surface de la cible. */
function maxErrorMm(found: Mat3, truthB2I: Mat3): number {
  let worst = 0;
  for (let r = 0; r <= 170; r += 17)
    for (let a = 0; a < 360; a += 15) {
      const b = boardPoint(r, a);
      const q = applyH(found, applyH(truthB2I, b));
      worst = Math.max(worst, Math.hypot(q.x - b.x, q.y - b.y));
    }
  return worst;
}

describe('calibration automatique', () => {
  const cases: [string, Partial<CameraPose>][] = [
    ['de face', { yawDeg: 0 }],
    ['caméra à droite, 40°', { yawDeg: 40 }],
    ['caméra à gauche, 45°, un peu au-dessus', { yawDeg: -45, pitchDeg: 8 }],
    ['50°, téléphone penché de 6°, cible décentrée', { yawDeg: 50, rollDeg: 6, shift: { x: 30, y: -60 } }],
    ['30°, plus loin', { yawDeg: 30, distance: 1300 }],
  ];

  for (const [name, p] of cases) {
    it(name, async () => {
      const cv = await loadCvForTests();
      const truth = cameraHomography(pose(p));
      const img = renderBoard(truth, W, H, { seed: 3 });
      const res = autoCalibrate(cv, img);
      if (!res.ok) throw new Error(res.reason);
      expect(res.colorMatch).toBeGreaterThan(0.9);
      expect(maxErrorMm(res.H, truth)).toBeLessThan(2.5);
      // Le score d'un point précis est bien retrouvé.
      const t20 = applyH(truth, boardPoint(103, sectorCenterAngle(20)));
      const q = applyH(res.H, t20);
      expect(scoreFromBoardCoords(q.x, q.y).libelle).toBe('T20');
    }, 30000);
  }

  it('conditions difficiles : 55°, bruit fort, éclairage très inégal', async () => {
    const cv = await loadCvForTests();
    const truth = cameraHomography(pose({ yawDeg: 55, pitchDeg: -5 }));
    const img = renderBoard(truth, W, H, { seed: 9, noise: 22, gradient: 0.7 });
    const res = autoCalibrate(cv, img);
    if (!res.ok) throw new Error(res.reason);
    expect(maxErrorMm(res.H, truth)).toBeLessThan(3);
  }, 30000);

  it('lumière chaude et sombre (ampoule)', async () => {
    const cv = await loadCvForTests();
    const truth = cameraHomography(pose({ yawDeg: -40 }));
    const img = renderBoard(truth, W, H, { seed: 5, noise: 10 });
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = img.data[i] * 0.75;
      img.data[i + 1] = img.data[i + 1] * 0.6;
      img.data[i + 2] = img.data[i + 2] * 0.4;
    }
    const res = autoCalibrate(cv, img);
    if (!res.ok) throw new Error(res.reason);
    expect(maxErrorMm(res.H, truth)).toBeLessThan(3);
  }, 30000);

  it('échoue proprement sans cible', async () => {
    const cv = await loadCvForTests();
    const data = new Uint8ClampedArray(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : 120 + (i % 7)));
    const res = autoCalibrate(cv, { data, width: W, height: H });
    expect(res.ok).toBe(false);
  }, 30000);
});
