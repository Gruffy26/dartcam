import { describe, expect, it } from 'vitest';
import { boardPoint } from '../board';
import { applyH } from '../homography';
import { cameraHomography, type CameraPose } from '../testing/synthetic';
import { cameraFromHomography, defaultFocalFor, outDirection, project } from './camera-model';

const W = 640;
const H = 1138;
const pose = (p: Partial<CameraPose>): CameraPose => ({ yawDeg: 40, distance: 900, focal: 900, width: W, height: H, ...p });

describe('modèle de caméra', () => {
  it('retrouve la focale d’une vue en biais', () => {
    for (const p of [{ yawDeg: 40 }, { yawDeg: -35, pitchDeg: -15 }, { yawDeg: 25, pitchDeg: 20, rollDeg: 5 }]) {
      const cam = cameraFromHomography(cameraHomography(pose(p)), W, H, 1234)!;
      expect(cam.focalEstimated).toBe(true);
      expect(cam.focal).toBeCloseTo(900, -1);
    }
  });

  it('reprojette les points de la cible comme l’homographie', () => {
    const B2I = cameraHomography(pose({ yawDeg: -45, pitchDeg: -10 }));
    const cam = cameraFromHomography(B2I, W, H, 1000)!;
    for (const a of [0, 90, 200]) {
      const b = boardPoint(150, a);
      const p = project(cam, b.x, b.y, 0)!;
      const q = applyH(B2I, b);
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(0.01);
    }
  });

  it('direction de sortie cohérente avec la vraie projection 3D (caméra en bas à gauche)', () => {
    // Caméra à gauche (yaw < 0) et en dessous (pitch < 0).
    const p = pose({ yawDeg: -40, pitchDeg: -20 });
    const B2I = cameraHomography(p);
    const cam = cameraFromHomography(B2I, W, H, 1000)!;
    const d = outDirection(cam, { x: 0, y: 0 })!;
    // Vérité terrain : projection exacte du point (0, 0, 60 mm) côté caméra.
    const yaw = (p.yawDeg * Math.PI) / 180;
    const pitch = (p.pitchDeg! * Math.PI) / 180;
    expect(Math.sign(Math.sin(yaw))).toBe(-1);
    expect(Math.sign(Math.sin(pitch))).toBe(-1);
    // Vérité terrain : point (0, 0, 60 mm) projeté avec le vrai modèle de caméra.
    const tip = applyH(B2I, { x: 0, y: 0 });
    const truth = projectTruth(p, 0, 0, 60);
    const ref = { x: truth.x - tip.x, y: truth.y - tip.y };
    const len = Math.hypot(ref.x, ref.y);
    expect(d.x * (ref.x / len) + d.y * (ref.y / len)).toBeGreaterThan(0.99);
  });

  it('vue de face : focale par défaut, sans planter', () => {
    const cam = cameraFromHomography(cameraHomography(pose({ yawDeg: 0 })), W, H, defaultFocalFor(W, H));
    expect(cam).not.toBeNull();
  });
});

/** Projection 3D exacte avec le même modèle que cameraHomography (test uniquement). */
function projectTruth(p: CameraPose, x: number, y: number, z: number) {
  const yaw = (p.yawDeg * Math.PI) / 180;
  const pitch = ((p.pitchDeg ?? 0) * Math.PI) / 180;
  const C = [p.distance * Math.sin(yaw) * Math.cos(pitch), p.distance * Math.sin(pitch), p.distance * Math.cos(yaw) * Math.cos(pitch)];
  const n = (v: number[]) => { const l = Math.hypot(...v); return v.map((a) => a / l); };
  const cr = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const f = n(C.map((c) => -c));
  const r = n(cr(f, [0, 1, 0]));
  const d = cr(f, r);
  const v = [x - C[0], y - C[1], z - C[2]];
  const dt = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return { x: p.width / 2 + (p.focal * dt(r, v)) / dt(f, v), y: p.height / 2 + (p.focal * dt(d, v)) / dt(f, v) };
}
