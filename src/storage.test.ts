import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadJSON, removeKey, saveJSON } from './storage';

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('storage', () => {
  it('sauvegarde puis relit une valeur', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(saveJSON('a', { x: 1 })).toBe(true);
    expect(loadJSON('a', null)).toEqual({ x: 1 });
    removeKey('a');
    expect(loadJSON('a', 'défaut')).toBe('défaut');
  });

  it('renvoie la valeur par défaut si le JSON est corrompu', () => {
    const s = fakeStorage();
    s.setItem('a', '{pas du json');
    vi.stubGlobal('localStorage', s);
    expect(loadJSON('a', 42)).toBe(42);
  });

  it('ne plante pas si le stockage est bloqué', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('bloqué'); },
      setItem: () => { throw new Error('plein'); },
      removeItem: () => { throw new Error('bloqué'); },
    });
    expect(loadJSON('a', 7)).toBe(7);
    expect(saveJSON('a', 1)).toBe(false);
    expect(() => removeKey('a')).not.toThrow();
  });

  it('ne plante pas si localStorage est absent', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadJSON('a', 'x')).toBe('x');
    expect(saveJSON('a', 1)).toBe(false);
  });
});
