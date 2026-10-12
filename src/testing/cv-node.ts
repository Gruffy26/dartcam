// Charge OpenCV.js dans Node pour les tests (même fichier que dans l'app).
import { createRequire } from 'node:module';
import type { CV } from '../opencv';

let cached: Promise<CV> | null = null;

export function loadCvForTests(): Promise<CV> {
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cv: any = require('@techstark/opencv-js');
  cached = new Promise((resolve) => {
    if (cv.Mat) resolve(cv);
    else if (typeof cv.then === 'function')
      cv.then((m: CV) => {
        delete m.then;
        resolve(m);
      });
    else cv.onRuntimeInitialized = () => resolve(cv);
  });
  return cached;
}
