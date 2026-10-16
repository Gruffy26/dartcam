import { describe, expect, it } from 'vitest';
import { analyseX01, hadDartAtDouble } from './analysis';
import type { GameRecord, RecordedTurn } from './history';

const turn = (over: Partial<RecordedTurn>): RecordedTurn => ({ p: 0, r: 501, s: 0, d: [], ...over });

const game = (turns: RecordedTurn[], players = ['Leo', 'Marie']): GameRecord => ({
  at: '2026-10-16T10:00:00.000Z',
  mode: 'x01',
  label: '501 · double out',
  players: players.map((name) => ({ name, result: '0', darts: 0, won: false })),
  turns,
});

describe('fléchette sur un double gagnant', () => {
  it('reconnaît un reste déjà fermable', () => {
    expect(hadDartAtDouble(turn({ r: 32 }))).toBe(true);
    expect(hadDartAtDouble(turn({ r: 50 }))).toBe(true);
    expect(hadDartAtDouble(turn({ r: 41 }))).toBe(false);
  });

  it('reconnaît un double atteint en cours de volée', () => {
    // 85 : T15 laisse 40, soit une fléchette au D20.
    expect(hadDartAtDouble(turn({ r: 85, d: ['T15', '0', '0'] }))).toBe(true);
    // 85 : S20 laisse 65, puis S5 laisse 60 : jamais un double gagnant.
    expect(hadDartAtDouble(turn({ r: 85, d: ['20', '5', '5'] }))).toBe(false);
  });

  it('un bust coupe la volée', () => {
    // 41 n'est pas fermable d'une fléchette, et T20 fait passer en dessous de zéro.
    expect(hadDartAtDouble(turn({ r: 41, d: ['T20', '0', '0'] }))).toBe(false);
    // En revanche, 20 offrait déjà une fléchette au D10 avant le bust.
    expect(hadDartAtDouble(turn({ r: 20, d: ['T20'] }))).toBe(true);
  });

  it('compte la volée qui ferme', () => {
    expect(hadDartAtDouble(turn({ r: 40, d: ['D20'], f: 1 }))).toBe(true);
  });
});

describe('analyse des parties X01', () => {
  it('additionne volées, moyenne et grosses séries', () => {
    const a = analyseX01([
      game([
        turn({ p: 0, r: 501, s: 180, d: ['T20', 'T20', 'T20'] }),
        turn({ p: 1, r: 501, s: 140, d: ['T20', 'T20', '20'] }),
        turn({ p: 0, r: 321, s: 100, d: ['T20', '20', '20'] }),
        turn({ p: 0, r: 221, s: 41, d: ['20', '20', '1'] }),
      ]),
    ]);
    const leo = a.find((x) => x.name === 'Leo')!;
    expect(leo.darts).toBe(9);
    expect(leo.points).toBe(321);
    expect(leo.average).toBeCloseTo(107, 0);
    expect(leo.best).toBe(180);
    expect(leo).toMatchObject({ s180: 1, s140: 1, s100: 2, s60: 2 });
    expect(a.find((x) => x.name === 'Marie')!.s140).toBe(1);
  });

  it('calcule la moyenne des neuf premières fléchettes, manche par manche', () => {
    const a = analyseX01([
      game([
        turn({ p: 0, r: 501, s: 180, d: ['T20', 'T20', 'T20'] }),
        turn({ p: 0, r: 321, s: 180, d: ['T20', 'T20', 'T20'] }),
        turn({ p: 0, r: 141, s: 141, d: ['T20', 'T19', 'D12'], f: 1 }),
        // Manche suivante : les neuf premières fléchettes repartent de zéro.
        turn({ p: 0, r: 501, s: 60, d: ['20', '20', '20'] }),
      ]),
    ]);
    expect(a[0].first9).toBeCloseTo((180 + 180 + 141 + 60) / 12 * 3, 1);
  });

  it('compte le pourcentage de finish et le plus gros', () => {
    const a = analyseX01([
      game([
        turn({ p: 0, r: 40, s: 0, d: ['5', '5', '5'] }), // occasion ratée
        turn({ p: 0, r: 100, s: 100, d: ['T20', 'D20'], f: 1 }), // réussi
        turn({ p: 0, r: 180, s: 60, d: ['20', '20', '20'] }), // aucune occasion
      ]),
    ]);
    expect(a[0].attempts).toBe(2);
    expect(a[0].hits).toBe(1);
    expect(a[0].checkout).toBe(50);
    expect(a[0].bestCheckout).toBe(100);
  });

  it('ignore les parties sans détail ou d’un autre jeu', () => {
    expect(analyseX01([{ ...game([]), turns: undefined }])).toEqual([]);
    expect(analyseX01([{ ...game([turn({})]), mode: 'cricket' }])).toEqual([]);
  });
});
