import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addGame, clearHistory, history, MAX_GAMES, totals, type GameRecord } from './history';

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const game = (over: Partial<GameRecord> = {}): GameRecord => ({
  at: '2026-10-16T10:00:00.000Z',
  mode: 'x01',
  label: '501 · double out',
  players: [
    { name: 'Leo', result: '0', darts: 24, won: true, scored: 501, best: 100 },
    { name: 'Marie', result: '120', darts: 24, won: false, scored: 381, best: 85 },
  ],
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('historique', () => {
  beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()));

  it('garde les parties, la plus récente en tête', () => {
    addGame(game({ at: 'A' }));
    addGame(game({ at: 'B' }));
    expect(history().map((g) => g.at)).toEqual(['B', 'A']);
  });

  it('oublie au-delà de la limite', () => {
    for (let i = 0; i < MAX_GAMES + 5; i++) addGame(game({ at: String(i) }));
    expect(history()).toHaveLength(MAX_GAMES);
    expect(history()[0].at).toBe(String(MAX_GAMES + 4));
  });

  it('cumule par joueur : parties, victoires et moyenne', () => {
    addGame(game());
    addGame(game({ players: [{ name: 'Leo', result: '0', darts: 21, won: true, scored: 501, best: 140 }] }));
    const t = totals();
    expect(t[0].name).toBe('Leo');
    expect(t[0].games).toBe(2);
    expect(t[0].wins).toBe(2);
    expect(t[0].best).toBe(140);
    expect(t[0].average).toBeCloseTo(((501 + 501) / 45) * 3, 2);
  });

  it('ne compte pas les autres modes dans la moyenne', () => {
    addGame(game({ mode: 'cricket', label: 'Cricket', players: [{ name: 'Leo', result: '60 pts', darts: 30, won: true }] }));
    const t = totals();
    expect(t[0].games).toBe(1);
    expect(t[0].average).toBe(0);
    expect(t[0].darts).toBe(30);
  });

  it('s’efface', () => {
    addGame(game());
    clearHistory();
    expect(history()).toEqual([]);
  });

  it('ignore un contenu abîmé', () => {
    localStorage.setItem('dartcam.history', '{"pas":"un tableau"}');
    expect(history()).toEqual([]);
  });
});
