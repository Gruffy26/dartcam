import { describe, expect, it } from 'vitest';
import { autoCalibrate } from '../autocalib';
import { boardPoint, sectorCenterAngle } from '../board';
import { loadCvForTests } from '../testing/cv-node';
import { cameraHomography, dartsPainter, renderBoard, type CameraPose } from '../testing/synthetic';
import { DartDetector, type DetectorEvent } from './detector';

const W = 480;
const H = 854;
// Comme chez l'utilisateur : téléphone en portrait, en bas à gauche de la cible.
// Positions de caméra testées (degrés) : gauche / droite, dessous / dessus, jusqu'à 55°.
// (Exclue : caméra de face au-dessus, dans l'axe des lancers — la fléchette pointe vers l'objectif.)
const POSES: [number, number][] = [
  [-35, -20], // comme chez l'utilisateur : en bas à gauche
  [35, -20], // en bas à droite
  [35, 20],
  [-35, 20],
  [50, -25],
  [-50, -25],
  [55, 15],
  [0, -15],
];

describe('détecteur sur une vidéo de synthèse', () => {
  it.each(POSES)('caméra à %i° / %i° : 3 fléchettes malgré une vibration, retrait, volée suivante', async (yaw, pitch) => {
    const POSE: CameraPose = { yawDeg: yaw, pitchDeg: pitch, distance: 950, focal: 760, width: W, height: H };
    const cv = await loadCvForTests();
    const tips = [
      boardPoint(103, sectorCenterAngle(20)), // T20
      boardPoint(166, sectorCenterAngle(16)), // D16
      boardPoint(60, sectorCenterAngle(5)), // 5
    ];
    // Images : 0, 1, 2 puis 3 fléchettes ; 3 positions de vibration (±1 px).
    // n = -1 : quelqu'un devant la cible (grand rectangle) ; n = 10 : fléchette suivante seule.
    const cache = new Map<string, ReturnType<typeof renderBoard>>();
    const frame = (n: number, wobble: number) => {
      const key = `${n}:${wobble}`;
      if (!cache.has(key)) {
        const pose = { ...POSE, shift: { x: wobble, y: -wobble * 0.5 } };
        const darts = n === 10 ? [boardPoint(130, sectorCenterAngle(11))] : n < 0 ? tips : tips.slice(0, n);
        const paint = dartsPainter(pose, darts);
        const extra = n < 0 ? (x: number, y: number) => (x > 120 && x < 330 && y > 300 && y < 700 ? [60, 40, 30] : paint(x, y)) : paint;
        cache.set(key, renderBoard(cameraHomography(pose), W, H, { seed: 7 + wobble, noise: 4, extra }));
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
    // `settled` protège l'image de référence enregistrée : dès que la fléchette arrive,
    // et tant qu'elle n'est pas confirmée, la cible ne doit plus être considérée comme
    // « telle qu'elle est ».
    expect(det.settled).toBe(true);
    const settledBeforeDart: boolean[] = [];
    for (let k = 0; k < 10; k++, t += 100) {
      const evs = det.process(frame(1, [0, 1, -1][k % 3]), t);
      events.push(...evs);
      if (!evs.some((e) => e.kind === 'dart')) settledBeforeDart.push(det.settled);
    }
    // Entre l'arrivée de la fléchette et sa confirmation, la cible n'est jamais « posée ».
    expect(settledBeforeDart.slice(0, 3)).toEqual([false, false, false]);
    play(2, 10);
    play(3, 10);
    expect(events.filter((e) => e.kind === 'reference')).toHaveLength(1);
    let darts = events.flatMap((e) => (e.kind === 'dart' ? [e.score.libelle] : []));
    expect(darts).toEqual(['T20', 'D16', '5']);

    // Volée finie : le joueur va retirer ses fléchettes (il passe devant la cible).
    det.setMode('removal');
    events.length = 0;
    play(-1, 8);
    play(0, 12);
    expect(events.filter((e) => e.kind === 'dart')).toHaveLength(0);
    expect(events.filter((e) => e.kind === 'cleared')).toHaveLength(1);

    // Volée suivante : une nouvelle fléchette est trouvée normalement.
    events.length = 0;
    play(10, 10);
    darts = events.flatMap((e) => (e.kind === 'dart' ? [e.score.libelle] : []));
    expect(darts).toEqual(['11']);
    det.dispose();
  }, 120000);
});
