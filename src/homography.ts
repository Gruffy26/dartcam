// Homographie plane (3×3) : estimation à partir de ≥ 4 correspondances de points,
// application et inversion. Pur TypeScript, sans OpenCV, pour pouvoir le tester
// et le recalculer instantanément pendant qu'on fait glisser un repère.
// Les résultats sont vérifiés contre cv.findHomography dans les tests.

export interface Pt {
  x: number;
  y: number;
}

/** Matrice 3×3 rangée par lignes : [h0 h1 h2; h3 h4 h5; h6 h7 h8]. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function applyH(H: Mat3, p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

export function multiplyH(A: Mat3, B: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return r;
}

export function invertH(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('Homographie non inversible');
  const inv: Mat3 = [
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d,
  ].map((v) => v / det) as Mat3;
  return normalizeH(inv);
}

function normalizeH(H: Mat3): Mat3 {
  const s = H[8];
  return Math.abs(s) > 1e-12 ? (H.map((v) => v / s) as Mat3) : H;
}

/** Translation + mise à l'échelle qui centre les points et ramène leur distance moyenne à √2 (Hartley). */
function normalizer(pts: Pt[]): Mat3 {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const d = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length;
  const k = d > 0 ? Math.SQRT2 / d : 1;
  return [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1];
}

/** Résout le système linéaire carré M·x = b (élimination de Gauss avec pivot partiel). */
function solve(M: number[][], b: number[]): number[] {
  const n = b.length;
  const A = M.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) throw new Error('Points dégénérés (alignés ou confondus)');
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = A[r][n];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = s / A[r][r];
  }
  return x;
}

/**
 * Homographie H telle que H·src ≈ dst, au sens des moindres carrés (DLT normalisée).
 * Exacte avec 4 points, moyenne au mieux avec plus.
 */
export function computeHomography(src: Pt[], dst: Pt[]): Mat3 {
  if (src.length !== dst.length || src.length < 4) throw new Error('Il faut au moins 4 paires de points');
  const Ts = normalizer(src);
  const Td = normalizer(dst);
  const s = src.map((p) => applyH(Ts, p));
  const d = dst.map((p) => applyH(Td, p));

  // Équations normales AᵀA·h = Aᵀb, avec h8 = 1.
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  const addRow = (row: number[], rhs: number) => {
    for (let i = 0; i < 8; i++) {
      Atb[i] += row[i] * rhs;
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j];
    }
  };
  for (let k = 0; k < s.length; k++) {
    const { x, y } = s[k];
    const { x: u, y: v } = d[k];
    addRow([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    addRow([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solve(AtA, Atb);
  const Hn: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  return normalizeH(multiplyH(invertH(Td), multiplyH(Hn, Ts)));
}
