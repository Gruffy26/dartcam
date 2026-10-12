// Génère les icônes PNG de l'app (une petite cible de fléchettes) sans dépendance.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', 'public', 'icons');

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgb) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [18, 20, 24], BLACK = [25, 25, 25], CREAM = [240, 228, 200];
const RED = [214, 40, 40], GREEN = [30, 150, 70], WIRE = [190, 190, 190];

// Couleur d'un point (u, v) en coordonnées normalisées : rayon 1 = bord du double.
function colorAt(u, v) {
  const r = Math.hypot(u, v);
  if (r > 1.18) return BG;
  if (r > 1) return BLACK; // anneau des numéros
  const ang = (Math.atan2(u, -v) * 180) / Math.PI; // 0° en haut, sens horaire
  const sector = Math.floor((((ang + 9) % 360) + 360) % 360 / 18);
  const even = sector % 2 === 0;
  const rm = r * 170;
  if (rm <= 6.35) return RED;
  if (rm <= 15.9) return GREEN;
  if (rm >= 99 && rm <= 107) return even ? RED : GREEN;
  if (rm >= 162) return even ? RED : GREEN;
  return even ? BLACK : CREAM;
}

function render(size, boardFrac) {
  const rgb = Buffer.alloc(size * size * 3);
  const SS = 4;
  const R = (size / 2) * boardFrac;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS - size / 2;
        const py = y + (sy + 0.5) / SS - size / 2;
        const c = colorAt(px / R, py / R);
        acc = acc.map((a, i) => a + c[i]);
      }
      const i = (y * size + x) * 3;
      rgb[i] = acc[0] / (SS * SS); rgb[i + 1] = acc[1] / (SS * SS); rgb[i + 2] = acc[2] / (SS * SS);
    }
  }
  return png(size, rgb);
}

for (const [name, size, frac] of [
  ['apple-touch-icon.png', 180, 0.72],
  ['icon-192.png', 192, 0.72],
  ['icon-512.png', 512, 0.72],
  ['icon-maskable-512.png', 512, 0.62],
]) {
  writeFileSync(join(OUT, name), render(size, frac));
  console.log('icône', name);
}
