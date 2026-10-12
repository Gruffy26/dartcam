// Recalage d'images : le trépied (ou la cible) vibre de quelques pixels après un
// lancer ou quand on touche le téléphone. Sans recalage, tous les fils et bords de
// la cible apparaîtraient comme des « changements ». On estime ici le décalage
// (translation, au dixième de pixel) entre une image et l'image d'ancrage.
//
// Méthode : recherche grossière au pixel près sur peu de points, puis affinage
// Lucas-Kanade (gradient de l'ancrage) sur les points les plus contrastés.
// Les points qui ne correspondent pas (fléchette, main) sont écartés à chaque itération.

export interface Anchor {
  width: number;
  height: number;
  /** Indices (y·width + x) des points utilisés. */
  idx: Int32Array;
  value: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
  /** Matrice normale inverse (2×2) pour Lucas-Kanade. */
  inv: [number, number, number, number];
}

/**
 * Prépare l'image d'ancrage : points à fort gradient dans le masque (zone de la cible).
 * @param img niveaux de gris (0–255)
 */
export function makeAnchor(img: ArrayLike<number>, width: number, height: number, mask?: ArrayLike<number>, maxPoints = 4000): Anchor | null {
  const cand: { i: number; g: number; gx: number; gy: number }[] = [];
  const m = 6; // bord ignoré
  for (let y = m; y < height - m; y += 2) {
    for (let x = m; x < width - m; x += 2) {
      const i = y * width + x;
      if (mask && !mask[i]) continue;
      const gx = (img[i + 1] - img[i - 1]) / 2;
      const gy = (img[i + width] - img[i - width]) / 2;
      const g = gx * gx + gy * gy;
      if (g > 25) cand.push({ i, g, gx, gy });
    }
  }
  if (cand.length < 50) return null;
  cand.sort((a, b) => b.g - a.g);
  // Les plus contrastés, mais pas tous au même endroit : on en prend un sur k.
  const step = Math.max(1, Math.floor(cand.length / maxPoints));
  const pick = cand.filter((_, k) => k % step === 0).slice(0, maxPoints);
  const n = pick.length;
  const idx = new Int32Array(n);
  const value = new Float32Array(n);
  const gxA = new Float32Array(n);
  const gyA = new Float32Array(n);
  let a = 0;
  let b = 0;
  let c = 0;
  pick.forEach((p, k) => {
    idx[k] = p.i;
    value[k] = img[p.i];
    gxA[k] = p.gx;
    gyA[k] = p.gy;
    a += p.gx * p.gx;
    b += p.gx * p.gy;
    c += p.gy * p.gy;
  });
  const det = a * c - b * b;
  if (det <= 1e-9) return null;
  return { width, height, idx, value, gx: gxA, gy: gyA, inv: [c / det, -b / det, -b / det, a / det] };
}

function sample(img: ArrayLike<number>, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return NaN;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const i = yi * w + xi;
  return (
    img[i] * (1 - fx) * (1 - fy) + img[i + 1] * fx * (1 - fy) + img[i + w] * (1 - fx) * fy + img[i + w + 1] * fx * fy
  );
}

/**
 * Décalage s tel que img(x + s) ≈ ancrage(x).
 * @param maxShift amplitude maximale recherchée (pixels)
 */
export function estimateShift(anchor: Anchor, img: ArrayLike<number>, maxShift = 8): { x: number; y: number; error: number } {
  const { width: w, height: h, idx, value } = anchor;
  const n = idx.length;

  // 1. Recherche grossière au pixel près, sur un sous-ensemble de points.
  const sub = Math.max(1, Math.floor(n / 400));
  let best = { x: 0, y: 0, e: Infinity };
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let e = 0;
      let cnt = 0;
      for (let k = 0; k < n; k += sub) {
        const i = idx[k];
        const x = (i % w) + dx;
        const y = ((i / w) | 0) + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const d = img[y * w + x] - value[k];
        e += Math.min(d * d, 1600); // erreur plafonnée : robuste aux fléchettes / mains
        cnt++;
      }
      if (cnt > 0 && e / cnt < best.e) best = { x: dx, y: dy, e: e / cnt };
    }
  }

  // 2. Affinage Lucas-Kanade (compositionnel inverse, translation seule).
  let sx = best.x;
  let sy = best.y;
  const [i00, i01, i10, i11] = anchor.inv;
  let err = best.e;
  for (let iter = 0; iter < 10; iter++) {
    let bx = 0;
    let by = 0;
    let a = 0;
    let b = 0;
    let c = 0;
    let e2 = 0;
    let cnt = 0;
    for (let k = 0; k < n; k++) {
      const i = idx[k];
      const v = sample(img, w, h, (i % w) + sx, ((i / w) | 0) + sy);
      if (Number.isNaN(v)) continue;
      const e = v - value[k];
      if (Math.abs(e) > 40) continue; // point masqué (fléchette, main) : ignoré
      const gx = anchor.gx[k];
      const gy = anchor.gy[k];
      bx += gx * e;
      by += gy * e;
      a += gx * gx;
      b += gx * gy;
      c += gy * gy;
      e2 += e * e;
      cnt++;
    }
    if (cnt < 20) break;
    // Matrice normale des points retenus (plus juste que celle de tous les points).
    const det = a * c - b * b;
    const [j00, j01, j10, j11] = det > 1e-9 ? [c / det, -b / det, -b / det, a / det] : [i00, i01, i10, i11];
    const dx = j00 * bx + j01 * by;
    const dy = j10 * bx + j11 * by;
    sx -= dx;
    sy -= dy;
    err = e2 / cnt;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) break;
    if (Math.abs(sx) > maxShift + 2 || Math.abs(sy) > maxShift + 2) break;
  }
  return { x: sx, y: sy, error: err };
}
