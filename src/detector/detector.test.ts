import { describe, expect, it } from 'vitest';
import { autoCalibrate } from '../autocalib';
import { boardPoint, sectorCenterAngle } from '../board';
import { loadCvForTests } from '../testing/cv-node';
import { cameraHomography, dartsPainter, renderBoard, type CameraPose } from '../testing/synthetic';
import { DartDetector, type DetectorEvent } from './detector';

const W = 480;
const H = 854;
// Comme chez l'utilisateur : téléphone en portrait, en bas à gauche de la cible.
const POSE: CameraPose = { yawDeg: -35, pitchDeg: -20, distance: 950, focal: 760, width: W, height: H };

describe('détecteur sur une vidéo de synthèse', () => {
  it('trouve 3 fléchettes successives, malgré une légère vibration', async () => {
    const cv = await loadCvForTests();
    const tips = [
      boardPoint(103, sectorCenterAngle(20)), // T20
      boardPoint(166, sectorCenterAngle(16)), // D16
      boardPoint(60, sectorCenterAngle(5)), // 5
    ];
    // Images : 0, 1, 2 puis 3 fléchettes ; 3 positions de vibration (±1 px).
    const cache = new Map<string, ReturnType<typeof renderBoard>>();
    const frame = (n: number, wobble: number) => {
      const key = `${n}:${wobble}`;
      if (!cache.has(key)) {
        const pose = { ...POSE, shift: { x: wobble, y: -wobble * 0.5 } };
        cache.set(key, renderBoard(cameraHomography(pose), W, H, { seed: 7 + wobble, noise: 4, extra: dartsPainter(pose, tips.slice(0, n)) }));
      }
      return cache.get(key)!;
    };

    const cal = autoCalibrate(cv, frame(0, 0));
    if (!cal.ok) throw new Error(cal.reason);
    const det = new DartDetector(cv, { frameToBoard: cal.H, width: W, height: H });
    const events: DetectorEvent[] = [];
    let t = 0;
    const play = (n: number, count: number) => {
      for (let k = 0; k < count; k++, t += 100) events.push(...det.process(frame(n, [0, 1, -1][k % 3]), t));
    };
    play(0, 16);
    play(1, 10);
    play(2, 10);
    play(3, 10);
    det.dispose();

    expect(events.filter((e) => e.kind === 'reference')).toHaveLength(1);
    const darts = events.flatMap((e) => (e.kind === 'dart' ? [e.score.libelle] : []));
    expect(darts).toEqual(['T20', 'D16', '5']);
  }, 120000);
});
