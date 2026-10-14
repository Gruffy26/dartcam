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
import { DartDetector, TIP, type DartEvent } from '../detector/detector';
import { applyH, type Mat3 } from '../homography';
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

    const sweep = (process.env.SWEEP ?? '').split(',').filter(Boolean).map(Number);
    for (const blur of sweep.length ? sweep : [TIP.blurPx]) {
    TIP.blurPx = blur;
    let tested = 0;
    let found = 0;
    let right = 0;
    const far: string[] = [];
    for (const [, list] of volleys) {
      list.sort((a, b) => a.index - b.index);
      for (let k = 1; k < list.length; k++) {
        const prev = list[k - 1];
        const cur = list[k];
        if (cur.origin !== 'auto') continue; // ajoutée à la main : rien à rejouer
        const ref = readBmp(bmpOf(prev));
        const img = readBmp(bmpOf(cur));
        const det = new DartDetector(cv, {
          frameToBoard: cur.f2b!,
          width: img.width,
          height: img.height,
          zoom: cur.calib?.zoom,
        });
        let t = 0;
        for (let i = 0; i < 6; i++, t += 200) det.process(ref, t);
        const events: DartEvent[] = [];
        for (let i = 0; i < 12; i++, t += 120) {
          for (const e of det.process(img, t)) if (e.kind === 'dart') events.push(e);
        }
        det.dispose();
        tested++;
        const e = events[0];
        const truth = cur.score;
        const expectedTip = cur.tip ? `(${cur.tip.x.toFixed(0)},${cur.tip.y.toFixed(0)})` : '—';
        if (!e) {
          far.push(`${cur.volley.slice(11)}#${cur.index} RIEN (attendu ${truth}, pointe ${expectedTip})`);
          continue;
        }
        found++;
        const got = e.score.libelle;
        if (got === truth) right++;
        else {
          const d = cur.tip ? Math.hypot(e.tip.x - cur.tip.x, e.tip.y - cur.tip.y) : NaN;
          const mm = cur.board ? Math.hypot(e.board.x - cur.board.x, e.board.y - cur.board.y) : NaN;
          far.push(
            `${cur.volley.slice(11)}#${cur.index} ${got} ≠ ${truth} (auto d’origine ${cur.autoScore}` +
              `, écart pointe ${d.toFixed(1)}px, ${mm.toFixed(1)}mm${cur.corrected ? ', corrigée' : ''})`,
          );
        }
      }
    }
    console.log(`\ndécalage pointe ${blur} px — rejouées ${tested}, détectées ${found}, bon score ${right} (${((100 * right) / tested).toFixed(0)}%)`);
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
