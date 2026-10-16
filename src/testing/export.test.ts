// Banc d'essai sur les exports de l'app (Réglages → Exporter en ZIP).
//
// Chaque image enregistrée montre la cible au moment d'une fléchette. Dans une même
// volée, l'image de la fléchette k−1 sert donc de référence à la fléchette k : on
// rejoue la détection sur de vraies images, avec le score validé par l'utilisateur
// comme vérité.
//
//   EXPORT=/dossier npx vitest run export      (dossier : flechettes.json + images/*.bmp)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { scoreFromBoardCoords } from '../board';
import { analysisBounds, DartDetector, TIP, type DartEvent } from '../detector/detector';
import { applyH, multiplyH, type Mat3 } from '../homography';
import { readBmp } from './bmp';
import { loadCvForTests } from './cv-node';

interface Meta {
  volley: string;
  index: number;
  image: string | null;
  f2b: Mat3 | null;
  tip: { x: number; y: number } | null;
  board: { x: number; y: number } | null;
  autoScore: string | null;
  score: string;
  corrected: boolean;
  origin: string;
  calib: { zoom: number } | null;
}

const dir = process.env.EXPORT;
const run = dir && existsSync(join(dir, 'flechettes.json')) ? describe : describe.skip;

/**
 * Réduit l'image d'un facteur `k` (moyenne de blocs k×k) : sert à mesurer ce que la
 * résolution d'analyse apporte vraiment à la précision du score.
 */
function shrink(im: { data: Uint8ClampedArray; width: number; height: number }, k: number) {
  if (k === 1) return im;
  const w = Math.floor(im.width / k);
  const h = Math.floor(im.height / k);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0];
      let n = 0;
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const p = ((y * k + dy) * im.width + x * k + dx) * 4;
          acc[0] += im.data[p];
          acc[1] += im.data[p + 1];
          acc[2] += im.data[p + 2];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = acc[0] / n;
      out[o + 1] = acc[1] / n;
      out[o + 2] = acc[2] / n;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** Découpe un rectangle de l'image. */
function cut(im: { data: Uint8ClampedArray; width: number; height: number }, b: { x: number; y: number; w: number; h: number }) {
  const out = new Uint8ClampedArray(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++) {
    const src = ((b.y + y) * im.width + b.x) * 4;
    out.set(im.data.subarray(src, src + b.w * 4), y * b.w * 4);
  }
  return { data: out, width: b.w, height: b.h };
}

/** Homographie image → cible quand l'image est réduite d'un facteur `k`. */
function scaleH(H: Mat3, k: number): Mat3 {
  if (k === 1) return H;
  return [H[0] * k, H[1] * k, H[2], H[3] * k, H[4] * k, H[5], H[6] * k, H[7] * k, H[8]];
}

function bmpOf(m: Meta): string {
  return join(dir!, 'images', m.image!.replace(/\.jpg$/, '.bmp'));
}

run('exports de l’app', () => {
  it('rejoue la détection, fléchette après fléchette', async () => {
    const cv = await loadCvForTests();
    const metas: Meta[] = JSON.parse(readFileSync(join(dir!, 'flechettes.json'), 'utf8'));
    const volleys = new Map<string, Meta[]>();
    for (const m of metas) {
      if (!m.image || !m.f2b || !existsSync(bmpOf(m))) continue;
      const list = volleys.get(m.volley) ?? [];
      list.push(m);
      volleys.set(m.volley, list);
    }

    const reduce = Number(process.env.SCALE ?? 1);
    const inMm = !!process.env.SWEEP_MM;
    const sweep = ((inMm ? process.env.SWEEP_MM : process.env.SWEEP) ?? '').split(',').filter(Boolean).map(Number);
    /** mm par pixel de l'image analysée, au centre de la cible. */
    const scaleOf = (H: Mat3) => Math.sqrt(Math.abs(H[0] * H[4] - H[1] * H[3]));
    for (const blur of sweep.length ? sweep : [TIP.blurPx]) {
    TIP.blurPx = blur;
    if (process.env.DOUBT) TIP.doubtMm = Number(process.env.DOUBT);
    let tested = 0;
    let found = 0;
    let right = 0;
    let cropped = 0;
    let cropCount = 0;
    let flagged = 0;
    let flaggedWrong = 0;
    let missedWrong = 0;
    const far: string[] = [];
    for (const [, list] of volleys) {
      list.sort((a, b) => a.index - b.index);
      for (let k = 1; k < list.length; k++) {
        const prev = list[k - 1];
        const cur = list[k];
        if (cur.index === 0) continue; // image de référence d'avant la volée
        if (cur.origin !== 'auto' && !process.env.MANUAL) continue; // ajoutée à la main
        if (cur.origin === 'miss') continue;
        let ref = shrink(readBmp(bmpOf(prev)), reduce);
        let img = shrink(readBmp(bmpOf(cur)), reduce);
        let F2B = scaleH(cur.f2b!, reduce);
        if (process.env.CROP) {
          const b = analysisBounds(
            { frameToBoard: F2B, width: img.width, height: img.height, zoom: cur.calib?.zoom },
            30,
            Number(process.env.PAD ?? 8),
          );
          cropped += (b.w * b.h) / (img.width * img.height);
          cropCount++;
          ref = cut(ref, b);
          img = cut(img, b);
          F2B = multiplyH(F2B, [1, 0, b.x, 0, 1, b.y, 0, 0, 1]);
        }
        if (inMm) TIP.blurPx = blur / scaleOf(cur.f2b!);
        const det = new DartDetector(cv, {
          frameToBoard: F2B,
          width: img.width,
          height: img.height,
          zoom: cur.calib?.zoom,
        });
        let t = 0;
        for (let i = 0; i < 6; i++, t += 200) det.process(ref, t);
        const events: DartEvent[] = [];
        const ignored: string[] = [];
        for (let i = 0; i < 12; i++, t += 120) {
          for (const e of det.process(img, t)) {
            if (e.kind === 'dart') events.push(e);
            else if (e.kind === 'ignored') ignored.push(`${e.reason}/${e.area}${JSON.stringify(det.debug.shape ?? {})}`);
          }
        }
        if (process.env.AREAS) {
          console.log(
            `aire zoom=${cur.calib?.zoom ?? '?'} min=${det.debug.minArea.toFixed(0)} max=${det.debug.maxArea.toFixed(0)}` +
              ` aire=${events[0]?.area ?? -1} ${events[0] ? '' : 'RIEN'}`,
          );
        }
        det.dispose();
        tested++;
        const e = events[0];
        const truth = cur.score;
        if (cur.origin !== 'auto') {
          console.log(`  MANUELLE ${cur.volley.slice(11)}#${cur.index} attendu ${truth} → ${e ? e.score.libelle : 'RIEN'} ${ignored.slice(0, 2).join(' ')}`);
        }
        const expectedTip = cur.tip ? `(${cur.tip.x.toFixed(0)},${cur.tip.y.toFixed(0)})` : '—';
        if (!e) {
          far.push(`${cur.volley.slice(11)}#${cur.index} RIEN (attendu ${truth}, pointe ${expectedTip})`);
          continue;
        }
        found++;
        const got = e.score.libelle;
        if (e.uncertain) flagged++;
        if (got === truth) right++;
        else {
          if (e.uncertain) flaggedWrong++;
          else missedWrong++;
          const d = cur.tip ? Math.hypot(e.tip.x - cur.tip.x, e.tip.y - cur.tip.y) : NaN;
          const mm = cur.board ? Math.hypot(e.board.x - cur.board.x, e.board.y - cur.board.y) : NaN;
          far.push(
            `${cur.volley.slice(11)}#${cur.index} ${got} ≠ ${truth} (auto d’origine ${cur.autoScore}` +
              `, écart pointe ${d.toFixed(1)}px, ${mm.toFixed(1)}mm${cur.corrected ? ', corrigée' : ''})`,
          );
        }
      }
    }
    console.log(`\ndécalage pointe ${blur} ${inMm ? 'mm' : 'px'} — rejouées ${tested}, détectées ${found}, bon score ${right} (${((100 * right) / tested).toFixed(0)}%)`);
    if (cropCount) console.log(`  zone analysée : ${((100 * cropped) / cropCount).toFixed(0)} % de l'image`);
    console.log(`  marquées « ? » : ${flagged} (${flaggedWrong} vraiment fausses, ${missedWrong} fausses non marquées)`);
    if (!process.env.QUIET) for (const line of far) console.log('  ' + line);
    }
    void applyH;
    void scoreFromBoardCoords;
  }, 900000);
});

run('exports de l’app — profil des pixels', () => {
  it.skipIf(!process.env.PROFILE)('compare l’objet et son ombre', async () => {
    const metas: Meta[] = JSON.parse(readFileSync(join(dir!, 'flechettes.json'), 'utf8'));
    const byVolley = new Map<string, Meta[]>();
    for (const m of metas) {
      if (!m.image || !existsSync(bmpOf(m))) continue;
      byVolley.set(m.volley, [...(byVolley.get(m.volley) ?? []), m].sort((a, b) => a.index - b.index));
    }
    const B2F = (H: Mat3): Mat3 => {
      const [a, b, c, d, e, f, g, h, i] = H;
      const A = [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
      const det = a * A[0] + b * A[3] + c * A[6];
      return A.map((v) => v / det) as Mat3;
    };
    for (const id of (process.env.PROFILE ?? '').split(',').filter(Boolean)) {
      const list = byVolley.get(id);
      if (!list) continue;
      for (let k = 1; k < list.length; k++) {
        const cur = list[k];
        if (!cur.corrected || !cur.tip || !cur.board || !cur.f2b) continue;
        const ref = readBmp(bmpOf(list[k - 1]));
        const img = readBmp(bmpOf(cur));
        const truth = applyH(B2F(cur.f2b), cur.board);
        const dx = cur.tip.x - truth.x;
        const dy = cur.tip.y - truth.y;
        const len = Math.hypot(dx, dy);
        console.log(`\n${cur.volley.slice(11)}#${cur.index} ${cur.autoScore}→${cur.score} : de la vraie pointe (${truth.x.toFixed(0)},${truth.y.toFixed(0)}) à la pointe trouvée (${cur.tip.x.toFixed(0)},${cur.tip.y.toFixed(0)}), ${len.toFixed(0)} px`);
        const at = (im: typeof img, x: number, y: number) => {
          const o = (Math.round(y) * im.width + Math.round(x)) * 4;
          return { g: 0.299 * im.data[o] + 0.587 * im.data[o + 1] + 0.114 * im.data[o + 2], c: im.data[o] - im.data[o + 1] };
        };
        const n = Math.min(24, Math.round(len));
        const rows: string[] = [];
        for (let s = -4; s <= n + 6; s++) {
          const u = s / n;
          const x = truth.x + dx * u;
          const y = truth.y + dy * u;
          if (x < 1 || y < 1 || x > img.width - 2 || y > img.height - 2) continue;
          const r = at(ref, x, y);
          const c = at(img, x, y);
          rows.push(`  s=${String(s).padStart(3)} ref=${r.g.toFixed(0).padStart(3)} cur=${c.g.toFixed(0).padStart(3)} ratio=${(c.g / Math.max(1, r.g)).toFixed(2)} dchroma=${(c.c - r.c).toFixed(0).padStart(4)}`);
        }
        console.log(rows.join('\n'));
      }
    }
  }, 900000);
});

run('exports de l’app — fléchettes manquées', () => {
  it.skipIf(!process.env.MISSED)('regarde si le corps de la fléchette sort du cadre', async () => {
    const { cameraFromHomography, defaultFocalFor, project } = await import('../detector/camera-model');
    const { invertH } = await import('../homography');
    const metas: Meta[] = JSON.parse(readFileSync(join(dir!, 'flechettes.json'), 'utf8'));
    const groups = new Map<string, { n: number; out: number }>();
    for (const m of metas) {
      if (!m.f2b || !m.board) continue;
      const cam = cameraFromHomography(invertH(m.f2b), 640, 1138, defaultFocalFor(640, 1138));
      if (!cam) continue;
      const end = project(cam, m.board.x, m.board.y, cam.normalSign * 120);
      const inFrame = !!end && end.x >= 0 && end.y >= 0 && end.x < 640 && end.y < 1138;
      const key = `${m.origin === 'auto' ? 'détectée' : 'manquée '} zoom=${m.calib?.zoom ?? '?'}`;
      const g = groups.get(key) ?? { n: 0, out: 0 };
      g.n++;
      if (!inFrame) g.out++;
      groups.set(key, g);
    }
    for (const [k, g] of [...groups].sort()) {
      console.log(`${k} : ${g.n} fléchettes, corps hors cadre ${g.out} (${((100 * g.out) / g.n).toFixed(0)}%)`);
    }
  }, 300000);
});

run('exports de l’app — stabilité', () => {
  it.skipIf(!process.env.SHIFT)('mesure le décalage entre deux images d’une même volée', async () => {
    const { makeAnchor, estimateShift } = await import('../detector/align');
    const metas: Meta[] = JSON.parse(readFileSync(join(dir!, 'flechettes.json'), 'utf8'));
    const byVolley = new Map<string, Meta[]>();
    for (const m of metas) {
      if (!m.image || !existsSync(bmpOf(m))) continue;
      byVolley.set(m.volley, [...(byVolley.get(m.volley) ?? []), m].sort((a, b) => a.index - b.index));
    }
    const byZoom = new Map<string, number[]>();
    const gray = (im: { data: Uint8ClampedArray; width: number; height: number }) => {
      const out = new Uint8ClampedArray(im.width * im.height);
      for (let i = 0, p = 0; i < out.length; i++, p += 4) {
        out[i] = 0.299 * im.data[p] + 0.587 * im.data[p + 1] + 0.114 * im.data[p + 2];
      }
      return { data: out, width: im.width, height: im.height };
    };
    for (const [, list] of byVolley) {
      for (let k = 1; k < list.length; k++) {
        const a = gray(readBmp(bmpOf(list[k - 1])));
        const b = gray(readBmp(bmpOf(list[k])));
        const anchor = makeAnchor(a.data, a.width, a.height);
        const s = anchor ? estimateShift(anchor, b.data, 16) : null;
        if (s) {
          const key = String(list[k].calib?.zoom ?? '?');
          byZoom.set(key, [...(byZoom.get(key) ?? []), Math.hypot(s.x, s.y)]);
        }
      }
    }
    for (const [z, v] of [...byZoom].sort()) {
      v.sort((x, y) => x - y);
      console.log(`zoom ${z} : ${v.length} paires, décalage médian ${v[v.length >> 1].toFixed(2)} px, pire ${v[v.length - 1].toFixed(2)} px`);
    }
  }, 600000);
});

run('exports de l’app — position de la caméra', () => {
  it.skipIf(!process.env.CAMPOS)('déduit où était la caméra', async () => {
    const { cameraFromHomography, defaultFocalFor } = await import('../detector/camera-model');
    const { invertH } = await import('../homography');
    const metas: Meta[] = JSON.parse(readFileSync(join(dir!, 'flechettes.json'), 'utf8'));
    const seen = new Map<string, { az: number; el: number; d: number; err: number; miss: number; n: number }>();
    const byVolley = new Map<string, Meta[]>();
    for (const m of metas) byVolley.set(m.volley, [...(byVolley.get(m.volley) ?? []), m]);
    for (const [v, list] of byVolley) {
      const m = list.find((x) => x.f2b);
      if (!m) continue;
      const cam = cameraFromHomography(invertH(m.f2b!), 640, 1138, defaultFocalFor(640, 1138));
      if (!cam) continue;
      // Centre de la caméra dans le repère de la cible : C = −Rᵀ·t
      const R = [cam.r1, cam.r2, cam.r3];
      const C = [0, 1, 2].map((i) => -(R[0][i] * cam.t[0] + R[1][i] * cam.t[1] + R[2][i] * cam.t[2]));
      const d = Math.hypot(C[0], C[1], C[2]);
      const az = (Math.atan2(C[0], Math.abs(C[2])) * 180) / Math.PI; // + = à droite de la cible
      const el = (Math.asin(C[1] / d) * 180) / Math.PI; // + = au-dessus du centre
      const auto = list.filter((x) => x.origin === 'auto' && x.index > 0);
      const wrong = auto.filter((x) => x.corrected && x.autoScore !== x.score).length;
      const miss = list.filter((x) => x.origin === 'manual').length;
      seen.set(v, { az, el, d, err: wrong, miss, n: list.filter((x) => x.index > 0).length });
    }
    const buckets = new Map<string, { n: number; err: number; miss: number }>();
    for (const [v, s] of [...seen].sort()) {
      console.log(
        `${v.slice(11, 19)} caméra : ${s.az > 0 ? 'droite' : 'gauche'} ${Math.abs(s.az).toFixed(0)}°,` +
          ` hauteur ${s.el.toFixed(0)}°, distance ${(s.d / 10).toFixed(0)} cm` +
          `${s.err || s.miss ? `   ← ${s.err} faux, ${s.miss} ratées` : ''}`,
      );
      const key = `${Math.abs(s.az) < 12 ? 'de face (<12°)' : Math.abs(s.az) < 25 ? 'un peu de côté' : 'bien de côté'}`;
      const b = buckets.get(key) ?? { n: 0, err: 0, miss: 0 };
      b.n += s.n;
      b.err += s.err;
      b.miss += s.miss;
      buckets.set(key, b);
    }
    console.log('');
    for (const [k, b] of [...buckets].sort()) {
      console.log(`${k} : ${b.n} fléchettes, ${b.err} faux, ${b.miss} ratées (${((100 * (b.err + b.miss)) / b.n).toFixed(0)}% de problèmes)`);
    }
  }, 300000);
});

run('exports de l’app — coût de l’analyse', () => {
  it.skipIf(!process.env.COST)('mesure le temps passé image par image', async () => {
    const cv = await loadCvForTests();
    const metas: Meta[] = JSON.parse(readFileSync(join(dir!, 'flechettes.json'), 'utf8'));
    const first = metas.find((m) => m.index === 1 && m.f2b && existsSync(bmpOf(m)))!;
    const prev = metas.find((m) => m.volley === first.volley && m.index === 0)!;
    const scale = Number(process.env.SCALE2 ?? 1);
    const grow = (im: { data: Uint8ClampedArray; width: number; height: number }) => {
      if (scale === 1) return im;
      const w = Math.round(im.width * scale);
      const h = Math.round(im.height * scale);
      const out = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const s = (Math.min(im.height - 1, Math.floor(y / scale)) * im.width + Math.min(im.width - 1, Math.floor(x / scale))) * 4;
          const o = (y * w + x) * 4;
          out[o] = im.data[s];
          out[o + 1] = im.data[s + 1];
          out[o + 2] = im.data[s + 2];
          out[o + 3] = 255;
        }
      }
      return { data: out, width: w, height: h };
    };
    const ref = grow(readBmp(bmpOf(prev)));
    const img = grow(readBmp(bmpOf(first)));
    const H = first.f2b!;
    const F2B: Mat3 = [H[0] / scale, H[1] / scale, H[2], H[3] / scale, H[4] / scale, H[5], H[6] / scale, H[7] / scale, H[8]];
    const det = new DartDetector(cv, { frameToBoard: F2B, width: ref.width, height: ref.height });
    let t = 0;
    for (let i = 0; i < 10; i++, t += 100) det.process(ref, t);
    const idle: number[] = [];
    for (let i = 0; i < 20; i++, t += 100) {
      det.process(ref, t);
      idle.push(det.debug.processMs);
    }
    const busy: number[] = [];
    for (let i = 0; i < 10; i++, t += 100) {
      det.process(img, t);
      busy.push(det.debug.processMs);
    }
    const med = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];
    console.log(`${ref.width}×${ref.height} : repos ${med(idle).toFixed(1)} ms, avec fléchette ${med(busy).toFixed(1)} ms (pire ${Math.max(...busy).toFixed(0)} ms)`);
    det.dispose();
  }, 300000);
});

run('exports de l’app — volée entière', () => {
  it.skipIf(!process.env.CHAIN)('rejoue chaque volée image par image', async () => {
    const cv = await loadCvForTests();
    const metas: Meta[] = JSON.parse(readFileSync(join(dir!, 'flechettes.json'), 'utf8'));
    const byVolley = new Map<string, Meta[]>();
    for (const m of metas) {
      if (!m.image || !existsSync(bmpOf(m))) continue;
      byVolley.set(m.volley, [...(byVolley.get(m.volley) ?? []), m].sort((a, b) => a.index - b.index));
    }
    let volleys = 0;
    let perfect = 0;
    let darts = 0;
    let found = 0;
    let right = 0;
    for (const [id, list] of [...byVolley].sort()) {
      // Il faut l'image d'avant la volée, sinon la première fléchette n'est pas rejouable.
      if (list[0].index !== 0 || list.length < 2) continue;
      const base = list[0];
      if (!base.f2b) continue;
      const first = readBmp(bmpOf(base));
      const det = new DartDetector(cv, {
        frameToBoard: base.f2b,
        width: first.width,
        height: first.height,
        zoom: base.calib?.zoom,
      });
      let t = 0;
      for (let i = 0; i < 12; i++, t += 100) det.process(first, t);
      const got: string[] = [];
      const ignored: string[] = [];
      for (const m of list.slice(1)) {
        const img = readBmp(bmpOf(m));
        for (let i = 0; i < 14; i++, t += 100) {
          for (const e of det.process(img, t)) {
            if (e.kind === 'dart') got.push(e.score.libelle);
            else if (e.kind === 'ignored') {
              const sh = det.debug.shape;
              ignored.push(
                e.reason === 'no-tip' && sh
                  ? `no-tip(aire ${e.area}, droit ${sh.straight.toFixed(2)}, larg ${sh.width.toFixed(0)}, long ${sh.lengthRatio.toFixed(2)})`
                  : `${e.reason}(${e.area})`,
              );
            }
          }
        }
      }
      det.dispose();
      const truth = list.slice(1).filter((m) => m.origin !== 'miss').map((m) => m.score);
      volleys++;
      darts += truth.length;
      const rest = [...truth];
      let ok = 0;
      for (const g of got) {
        const k = rest.indexOf(g);
        if (k >= 0) {
          rest.splice(k, 1);
          ok++;
        }
      }
      found += Math.min(got.length, truth.length);
      right += ok;
      if (ok === truth.length && got.length === truth.length) perfect++;
      else {
        console.log(`  ${id.slice(11, 19)} attendu [${truth.join(', ')}] → [${got.join(', ')}]  rejets: ${[...new Set(ignored)].join(',') || '—'}`);
      }
    }
    console.log(`\n${volleys} volées rejouées, ${darts} fléchettes : ${right} comptées juste (${((100 * right) / darts).toFixed(0)}%), ${perfect} volées parfaites (${((100 * perfect) / volleys).toFixed(0)}%)`);
  }, 900000);
});
