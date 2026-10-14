import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from './zip';

const enc = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('donne les valeurs de référence', () => {
    expect(crc32(enc(''))).toBe(0);
    expect(crc32(enc('hello'))).toBe(0x3610a686);
    expect(crc32(enc('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('zipStore', () => {
  it('écrit une archive que unzip relit à l’identique', () => {
    const files = [
      { name: 'meta.json', data: enc('{"a":1}') },
      { name: 'images/01.bin', data: Uint8Array.from({ length: 5000 }, (_, i) => (i * 37) % 256) },
      { name: 'vide.txt', data: new Uint8Array(0) },
    ];
    const zip = zipStore(files);
    const dir = mkdtempSync(join(tmpdir(), 'dartcam-zip-'));
    const path = join(dir, 'a.zip');
    writeFileSync(path, zip);

    expect(execFileSync('unzip', ['-t', path], { encoding: 'utf8' })).toContain('No errors');
    execFileSync('unzip', ['-q', path, '-d', join(dir, 'out')]);
    for (const f of files) {
      expect(new Uint8Array(readFileSync(join(dir, 'out', f.name)))).toEqual(f.data);
    }
  });

  it('commence par la signature ZIP et finit par le répertoire central', () => {
    const zip = zipStore([{ name: 'x', data: enc('y') }]);
    expect(Array.from(zip.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Array.from(zip.subarray(zip.length - 22, zip.length - 18))).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });
});
