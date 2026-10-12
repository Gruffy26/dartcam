// Banc d'essai sur une vraie vidéo, images extraites en RGBA brut par scripts/extract-frames.swift.
// Ne s'exécute que si FRAMES pointe vers un dossier d'images :
//   FRAMES=/chemin npx vitest run video                       → calibration auto sur une image sur 10
//   + OUT_DIR=/dossier DEBUG_FRAMES=0,120                     → masques des couleurs et dessin de la cible
//   + OUT=/fichier.png [SHEET=0,10,20 SCALE=2 COLS=3]         → planche contact
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { autoCalibrate } from '../autocalib';
import { loadCvForTests } from './cv-node';

const dir = process.env.FRAMES;
const run = dir && existsSync(join(dir, 'meta.json')) ? describe : describe.skip;

export function loadFrame(i: number) {
  const meta = JSON.parse(readFileSync(join(dir!, 'meta.json'), 'utf8'));
  const data = new Uint8ClampedArray(readFileSync(join(dir!, `${String(i).padStart(4, '0')}.rgba`)));
  return { data, width: meta.width as number, height: meta.height as number };
}

run('vidéo réelle', () => {
  it('calibration automatique', async () => {
    const cv = await loadCvForTests();
    const meta = JSON.parse(readFileSync(join(dir!, 'meta.json'), 'utf8'));
    const step = Number(process.env.STEP ?? 10);
    for (let i = 0; i < meta.count; i += step) {
      const t0 = performance.now();
      const res = autoCalibrate(cv, loadFrame(i));
      const ms = (performance.now() - t0).toFixed(0);
      console.log(
        i,
        res.ok
          ? `OK err=${res.errorMm.toFixed(2)}mm couleurs=${(res.colorMatch * 100).toFixed(0)}% n=${res.correspondences} ${ms}ms`
          : `ÉCHEC ${res.reason} ${ms}ms`,
      );
    }
  }, 600000);
});

run('vidéo réelle — débogage', () => {
  it.skipIf(!process.env.OUT_DIR)('masque', async () => {
    const { writePng } = await import('./png');
    const { ellipsePoint } = await import('../autocalib');
    const cv = await loadCvForTests();
    for (const i of (process.env.DEBUG_FRAMES ?? '0').split(',').map(Number)) {
      const img = loadFrame(i);
      const dbg: import('../autocalib').AutoCalibDebug = {};
      autoCalibrate(cv, img, dbg);
      const out = new Uint8ClampedArray(img.data);
      for (let p = 0; p < dbg.cls!.length; p++) {
        const c = dbg.cls![p];
        const o = p * 4;
        if (c === 1) { out[o] = 255; out[o + 1] = 0; out[o + 2] = 255; }
        else if (c === 2) { out[o] = 0; out[o + 1] = 255; out[o + 2] = 255; }
        else { out[o] /= 3; out[o + 1] /= 3; out[o + 2] /= 3; }
      }
      if (dbg.ellipse) for (let t = 0; t < 360; t += 0.25) {
        const q = ellipsePoint(dbg.ellipse, t, 1);
        const x = Math.round(q.x), y = Math.round(q.y);
        if (x >= 0 && y >= 0 && x < img.width && y < img.height) { const o = (y * img.width + x) * 4; out[o] = 255; out[o + 1] = 255; out[o + 2] = 0; }
      }
      writePng(join(process.env.OUT_DIR!, `mask-${i}.png`), out, img.width, img.height);
      console.log('ellipse', i, JSON.stringify(dbg.ellipse));
    }
  }, 600000);
});

run('vidéo réelle — planche', () => {
  it.skipIf(!process.env.OUT)('planche contact', async () => {
    const { writePng } = await import('./png');
    const meta = JSON.parse(readFileSync(join(dir!, 'meta.json'), 'utf8'));
    const ids: number[] = (process.env.SHEET ?? '').split(',').filter(Boolean).map(Number);
    const frames = ids.length ? ids : Array.from({ length: Math.ceil(meta.count / 9) }, (_, k) => k * 9);
    const s = Number(process.env.SCALE ?? 4);
    const tw = Math.floor(meta.width / s), th = Math.floor(meta.height / s);
    const cols = Number(process.env.COLS ?? 6);
    const rows = Math.ceil(frames.length / cols);
    const out = new Uint8ClampedArray(cols * tw * rows * th * 4);
    frames.forEach((f, k) => {
      const img = loadFrame(f);
      const ox = (k % cols) * tw, oy = Math.floor(k / cols) * th;
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const si = ((y * s) * meta.width + x * s) * 4;
        const di = ((oy + y) * cols * tw + ox + x) * 4;
        out[di] = img.data[si]; out[di + 1] = img.data[si + 1]; out[di + 2] = img.data[si + 2];
      }
      // numéro de l'image : petit repère blanc en haut à gauche (k-ième barre)
      for (let y = 0; y < 6; y++) for (let x = 0; x < Math.min(tw, 3 + (f % 50)); x++) { const di = ((oy + y) * cols * tw + ox + x) * 4; out[di] = out[di + 1] = out[di + 2] = 255; }
    });
    writePng(process.env.OUT!, out, cols * tw, rows * th);
    console.log('frames', frames.join(','));
  }, 600000);
});

run('vidéo réelle — superposition', () => {
  it.skipIf(!process.env.OUT_DIR)('dessin de la calibration', async () => {
    const { writePng } = await import('./png');
    const { boardOverlay } = await import('../calibration');
    const { invertH } = await import('../homography');
    const cv = await loadCvForTests();
    for (const i of (process.env.DEBUG_FRAMES ?? '0').split(',').map(Number)) {
      const img = loadFrame(i);
      const res = autoCalibrate(cv, img);
      if (!res.ok) { console.log(i, res.reason); continue; }
      const out = new Uint8ClampedArray(img.data);
      const ov = boardOverlay(invertH(res.H), img.width, img.height, 400);
      const plot = (x: number, y: number) => {
        const X = Math.round(x * img.width), Y = Math.round(y * img.height);
        if (X >= 0 && Y >= 0 && X < img.width && Y < img.height) { const o = (Y * img.width + X) * 4; out[o] = 255; out[o + 1] = 255; out[o + 2] = 0; }
      };
      for (const ring of ov.rings) for (const p of ring) plot(p.x, p.y);
      for (const [a, b] of ov.spokes) for (let t = 0; t <= 1; t += 0.002) plot(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      writePng(join(process.env.OUT_DIR!, `overlay-${i}.png`), out, img.width, img.height);
    }
  }, 600000);
});

run('vidéo réelle — détection des fléchettes', () => {
  it.skipIf(!process.env.DETECT)('rejoue la vidéo', async () => {
    const { DartDetector } = await import('../detector/detector');
    const cv = await loadCvForTests();
    const meta = JSON.parse(readFileSync(join(dir!, 'meta.json'), 'utf8'));
    const calFrame = Number(process.env.CALIB_FRAME ?? 30);
    const cal = autoCalibrate(cv, loadFrame(calFrame));
    if (!cal.ok) throw new Error(cal.reason);
    const det = new DartDetector(cv, { frameToBoard: cal.H, width: meta.width, height: meta.height });
    console.log('caméra', JSON.stringify({ f: det.cam?.focal.toFixed(0), estimée: det.cam?.focalEstimated, normal: det.cam?.normalSign }));
    const dt = 1000 / meta.fps;
    const darts: string[] = [];
    let total = 0;
    let worst = 0;
    for (let i = calFrame; i < meta.count; i++) {
      const frame = loadFrame(i);
      const t0 = performance.now();
      const evs = det.process(frame, i * dt);
      const ms = performance.now() - t0;
      total += ms;
      worst = Math.max(worst, ms);
      if (process.env.MOTION) console.log(i, 'mvt', det.debug.motion, '/', det.debug.motionLimit.toFixed(0), det.debug.state, det.debug.shift.x.toFixed(2), det.debug.shift.y.toFixed(2));
      for (const ev of evs) {
        if (ev.kind === 'dart') {
          darts.push(ev.score.libelle);
          if (process.env.TIPDBG && Number(process.env.TIPDBG) === i) {
            const xy = det.debug.contour!;
            const t = det.debug.tip!;
            const pts: [number, number, number][] = [];
            for (let k = 0; k < xy.length; k += 2) pts.push([xy[k], xy[k + 1], (xy[k] - t.tip.x) * t.axis.x + (xy[k + 1] - t.tip.y) * t.axis.y]);
            pts.sort((a, b) => a[2] - b[2]);
            console.log('axe', t.axis, 'pointe', t.tip, 'n', pts.length);
            console.log('extrêmes côté pointe', JSON.stringify(pts.slice(0, 15)));
          }
          if (process.env.OUT_DIR) {
            const { writePng } = await import('./png');
            const img = loadFrame(i);
            const out = new Uint8ClampedArray(img.data);
            const m = det.debug.mask!;
            for (let p = 0; p < m.data.length; p++) if (m.data[p]) { out[4 * p] = 255; out[4 * p + 1] = out[4 * p + 1] / 2; out[4 * p + 2] = 255; }
            const dot = (q: { x: number; y: number }, c: number[]) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const o = ((Math.round(q.y) + dy) * img.width + Math.round(q.x) + dx) * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; } };
            dot(ev.tip, [255, 0, 0]);
            dot(ev.tail, [0, 0, 255]);
            // recadrage autour de la fléchette
            const x0 = Math.max(0, Math.round(Math.min(ev.tip.x, ev.tail.x) - 80)), y0 = Math.max(0, Math.round(Math.min(ev.tip.y, ev.tail.y) - 80));
            const x1 = Math.min(img.width, Math.round(Math.max(ev.tip.x, ev.tail.x) + 80)), y1 = Math.min(img.height, Math.round(Math.max(ev.tip.y, ev.tail.y) + 80));
            const cw = x1 - x0, ch = y1 - y0, crop = new Uint8ClampedArray(cw * 2 * ch * 4);
            for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
              const so = ((y0 + y) * img.width + x0 + x) * 4;
              const a = (y * cw * 2 + x) * 4, b = (y * cw * 2 + cw + x) * 4;
              for (let k = 0; k < 4; k++) { crop[a + k] = img.data[so + k]; crop[b + k] = out[so + k]; }
            }
            writePng(join(process.env.OUT_DIR, `dart-${i}.png`), crop, cw * 2, ch);
          }
          console.log(i, 'FLÉCHETTE', ev.score.libelle, `pointe=(${ev.tip.x.toFixed(0)},${ev.tip.y.toFixed(0)})`, `empennage=(${ev.tail.x.toFixed(0)},${ev.tail.y.toFixed(0)})`, `r=${Math.hypot(ev.board.x, ev.board.y).toFixed(0)}mm`, `aire=${ev.area.toFixed(0)}`, `conf=${ev.confidence.toFixed(2)}`, JSON.stringify(det.debug.tip?.votes));
        } else if (ev.kind === 'ignored' && ev.reason !== 'small') console.log(i, 'ignoré', ev.reason, ev.area.toFixed(0));
        else if (ev.kind === 'reference') console.log(i, 'référence');
      }
    }
    console.log('TEMPS', `moyenne ${(total / (meta.count - calFrame)).toFixed(1)} ms, pire ${worst.toFixed(1)} ms par image`);
    console.log('RÉSULTAT', darts.join(', '), `(min ${det.debug.minArea.toFixed(0)} max ${det.debug.maxArea.toFixed(0)} px²)`);
    det.dispose();
  }, 600000);
});
