// Lance la calibration automatique sur l'image actuelle de la caméra.

import { autoCalibrate, blurForClassification, classifyPixels, colorMatchScore, type AutoCalibResult } from './autocalib';
import { frameToBoard, type Calibration } from './calibration';
import type { CameraStage } from './camera-stage';
import { loadOpenCV } from './opencv';

/** Largeur de l'image utilisée pour la détection de la cible (une seule fois, pas en continu). */
const AUTO_WIDTH = 720;

function grab(cam: CameraStage): ImageData | null {
  const f = cam.frame();
  const v = cam.source?.video;
  if (!f || !v) return null;
  const w = AUTO_WIDTH;
  const h = Math.round((f.crop.h * w) / f.crop.w);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(v, f.crop.x, f.crop.y, f.crop.w, f.crop.h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type AutoRun = (AutoCalibResult & { ms: number }) | { ok: false; reason: string; ms: number };

/**
 * Essaie plusieurs fois (le temps que l'exposition de la caméra se stabilise).
 * `cancelled()` permet d'abandonner si l'écran est quitté ou la source changée.
 */
export async function detectBoard(
  cam: CameraStage,
  cancelled: () => boolean,
  attempts = 6,
): Promise<AutoRun> {
  const cv = await loadOpenCV();
  let last: AutoRun = { ok: false, reason: 'Pas d’image de la caméra.', ms: 0 };
  // Laisse la caméra régler son exposition avant le premier essai.
  await wait(600);
  for (let i = 0; i < attempts && !cancelled(); i++) {
    const img = grab(cam);
    if (img) {
      const t0 = performance.now();
      const res = autoCalibrate(cv, img);
      last = { ...res, ms: performance.now() - t0 };
      if (res.ok) return last;
    }
    await wait(500);
  }
  return last;
}

/** La calibration enregistrée colle-t-elle encore à l'image (trépied pas bougé) ? */
export async function calibrationStillValid(cam: CameraStage, cal: Calibration): Promise<boolean> {
  const cv = await loadOpenCV();
  const img = grab(cam);
  if (!img) return false;
  const cls = classifyPixels(blurForClassification(cv, img));
  const H = frameToBoard(cal.points, img.width, img.height);
  return colorMatchScore(cls, img.width, img.height, H) >= 0.8;
}
