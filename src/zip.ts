// Écriture d'un fichier ZIP, sans compression (les images sont déjà compressées).
// Module pur et testé : pas de dépendance, pas de bibliothèque externe.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** Date de modification enregistrée dans l'archive. */
  date?: Date;
}

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Date et heure au format MS-DOS utilisé par le format ZIP. */
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

class Writer {
  bytes: Uint8Array;
  len = 0;
  constructor(cap: number) {
    this.bytes = new Uint8Array(cap);
  }
  u16(v: number): void {
    this.bytes[this.len++] = v & 0xff;
    this.bytes[this.len++] = (v >>> 8) & 0xff;
  }
  u32(v: number): void {
    this.u16(v & 0xffff);
    this.u16((v >>> 16) & 0xffff);
  }
  raw(d: Uint8Array): void {
    this.bytes.set(d, this.len);
    this.len += d.length;
  }
}

/** Construit l'archive. Les noms peuvent contenir des dossiers (« a/b.png »). */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const names = entries.map((e) => new TextEncoder().encode(e.name));
  const total =
    entries.reduce((s, e, i) => s + 30 + names[i].length + e.data.length + 46 + names[i].length, 0) + 22;
  const w = new Writer(total);
  const offsets: number[] = [];
  const crcs: number[] = [];
  const stamps = entries.map((e) => dosTime(e.date ?? new Date()));

  entries.forEach((e, i) => {
    offsets.push(w.len);
    crcs.push(crc32(e.data));
    w.u32(0x04034b50);
    w.u16(20);
    w.u16(0);
    w.u16(0); // stocké, sans compression
    w.u16(stamps[i].time);
    w.u16(stamps[i].date);
    w.u32(crcs[i]);
    w.u32(e.data.length);
    w.u32(e.data.length);
    w.u16(names[i].length);
    w.u16(0);
    w.raw(names[i]);
    w.raw(e.data);
  });

  const cdStart = w.len;
  entries.forEach((e, i) => {
    w.u32(0x02014b50);
    w.u16(20);
    w.u16(20);
    w.u16(0);
    w.u16(0);
    w.u16(stamps[i].time);
    w.u16(stamps[i].date);
    w.u32(crcs[i]);
    w.u32(e.data.length);
    w.u32(e.data.length);
    w.u16(names[i].length);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    w.u32(0);
    w.u32(offsets[i]);
    w.raw(names[i]);
  });
  const cdSize = w.len - cdStart;

  w.u32(0x06054b50);
  w.u16(0);
  w.u16(0);
  w.u16(entries.length);
  w.u16(entries.length);
  w.u32(cdSize);
  w.u32(cdStart);
  w.u16(0);

  return w.bytes.subarray(0, w.len);
}
