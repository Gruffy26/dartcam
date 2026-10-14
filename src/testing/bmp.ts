// Lecture d'un BMP 24 bits non compressé (ce que produit `sips -s format bmp`).
// Sert seulement aux bancs d'essai : les images exportées par l'app sont en JPEG, que
// Node ne sait pas décoder seul.
import { readFileSync } from 'node:fs';

export interface RawImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function readBmp(path: string): RawImage {
  const b = readFileSync(path);
  if (b[0] !== 0x42 || b[1] !== 0x4d) throw new Error(`${path} : ce n'est pas un BMP`);
  const offset = b.readUInt32LE(10);
  const width = b.readInt32LE(18);
  const h = b.readInt32LE(22);
  const bits = b.readUInt16LE(28);
  if (bits !== 24 && bits !== 32) throw new Error(`${path} : ${bits} bits non gérés`);
  const topDown = h < 0;
  const height = Math.abs(h);
  const bpp = bits / 8;
  const stride = Math.ceil((width * bpp) / 4) * 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = offset + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const s = row + x * bpp;
      const d = (y * width + x) * 4;
      data[d] = b[s + 2];
      data[d + 1] = b[s + 1];
      data[d + 2] = b[s];
      data[d + 3] = 255;
    }
  }
  return { data, width, height };
}
