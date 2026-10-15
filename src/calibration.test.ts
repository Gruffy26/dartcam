import { describe, expect, it } from 'vitest';
import { boardPoint, scoreFromBoardCoords, sectorCenterAngle } from './board';
import {
  boardOverlay,
  CALIB_TARGETS,
  calibrationMismatch,
  frameToBoard,
  placementAdvice,
  reprojectionError,
  tryBoardToFrame,
  type Calibration,
} from './calibration';
import { applyH, invertH, type Mat3 } from './homography';

// Caméra simulée : cible (mm) → cadre 640×1138 (portrait), vue en biais.
const W = 640;
const H = 1138;
const BOARD_TO_FRAME: Mat3 = [0.95, 0.08, 320, 0.15, -1.6, 560, 0.0009, 0.0001, 1];
const POINTS = CALIB_TARGETS.map((t) => {
  const p = applyH(BOARD_TO_FRAME, t.board);
  return { x: p.x / W, y: p.y / H };
});

describe('calibration', () => {
  it('les repères sont dans l’ordre demandé', () => {
    expect(CALIB_TARGETS.map((t) => t.short)).toEqual(['20 (haut)', '6 (droite)', '3 (bas)', '11 (gauche)', 'centre']);
    expect(CALIB_TARGETS[0].board.y).toBeCloseTo(170);
    expect(CALIB_TARGETS[1].board.x).toBeCloseTo(170);
    expect(CALIB_TARGETS[2].board.y).toBeCloseTo(-170);
    expect(CALIB_TARGETS[3].board.x).toBeCloseTo(-170);
  });

  it('retrouve le score d’un point de l’image', () => {
    const Hm = frameToBoard(POINTS, W, H);
    const t20 = applyH(BOARD_TO_FRAME, { x: 0, y: 103 });
    const p = applyH(Hm, t20);
    expect(scoreFromBoardCoords(p.x, p.y).libelle).toBe('T20');
    const d16 = applyH(BOARD_TO_FRAME, boardPoint(166, sectorCenterAngle(16)));
    const q = applyH(Hm, d16);
    expect(scoreFromBoardCoords(q.x, q.y).libelle).toBe('D16');
  });

  it('marche quelle que soit la résolution d’analyse', () => {
    const Hbig = frameToBoard(POINTS, W * 2, H * 2);
    const t20 = applyH(BOARD_TO_FRAME, { x: 0, y: 103 });
    const p = applyH(Hbig, { x: t20.x * 2, y: t20.y * 2 });
    expect(p.y).toBeCloseTo(103, 6);
  });

  it('écart quasi nul pour des repères parfaits, plus grand pour un repère mal placé', () => {
    expect(reprojectionError(POINTS, W, H)).toBeLessThan(1e-6);
    const bad = POINTS.map((p, i) => (i === 4 ? { x: p.x + 0.03, y: p.y } : p));
    expect(reprojectionError(bad, W, H)).toBeGreaterThan(2);
  });

  it('le dessin projeté passe par les repères', () => {
    const B2F = tryBoardToFrame(POINTS, W, H)!;
    const o = boardOverlay(B2F, W, H);
    expect(o.rings).toHaveLength(6);
    expect(o.spokes).toHaveLength(20);
    expect(o.numbers[0].n).toBe(20);
    // Premier point du cercle extérieur = haut du double (repère 1).
    expect(o.rings[5][0].x).toBeCloseTo(POINTS[0].x, 6);
    expect(o.rings[5][0].y).toBeCloseTo(POINTS[0].y, 6);
  });

  it('pas d’homographie avec moins de 4 repères', () => {
    expect(tryBoardToFrame(POINTS.slice(0, 3), W, H)).toBeNull();
    expect(tryBoardToFrame(POINTS.slice(0, 4), W, H)).not.toBeNull();
    expect(invertH(tryBoardToFrame(POINTS, W, H)!)).toBeTruthy();
  });

  it('détecte un changement de zoom ou d’orientation', () => {
    const cal: Calibration = { version: 1, kind: 'camera', points: POINTS, zoom: 1.5, aspect: W / H, createdAt: '' };
    expect(calibrationMismatch(cal, { zoom: 1.5, aspect: W / H })).toBeNull();
    expect(calibrationMismatch(cal, { zoom: 2, aspect: W / H })).toMatch(/zoom/);
    expect(calibrationMismatch(cal, { zoom: 1.5, aspect: H / W })).toMatch(/orientation/);
    expect(calibrationMismatch({ ...cal, kind: 'video' }, { zoom: 1, aspect: W / H })).toBeNull();
  });
});

describe('position de la caméra', () => {
  const pose = (azimuthDeg: number) => ({ azimuthDeg, elevationDeg: 15, distanceMm: 1200 });

  it('prévient quand la caméra est trop dans l’axe', () => {
    const a = placementAdvice(pose(9));
    expect(a?.warn).toBe(true);
    expect(a?.text).toContain('axe');
  });

  it('indique le côté et la distance quand la position est bonne', () => {
    expect(placementAdvice(pose(-28))).toEqual({ text: 'Caméra à gauche, 28° · ≈ 1,2 m', warn: false });
    expect(placementAdvice(pose(30))?.text).toContain('à droite');
    expect(placementAdvice(null)).toBe(null);
  });
});
