import { describe, expect, it } from 'vitest';
import { makeScore, MISS } from '../board';
import { suggestCheckout } from './checkout';
import { commitTurn, evaluateTurn, newGame, playerStats, remainingScores, undoTurn, legsWon, legsTarget, allTurns, type GameState} from './x01';

const S = (n: number) => makeScore(n, 1);
const D = (n: number) => makeScore(n, 2);
const T = (n: number) => makeScore(n, 3);
const BULL = makeScore(25, 2);

describe('volée X01', () => {
  it('retire le total des 3 fléchettes', () => {
    expect(evaluateTurn(501, [T(20), T(20), T(20)], true)).toMatchObject({ remaining: 321, bust: false, over: true, scored: 180 });
  });

  it('volée en cours : pas encore terminée', () => {
    expect(evaluateTurn(501, [T(20)], true)).toMatchObject({ remaining: 441, over: false, used: 1 });
  });

  it('bust si le score devient négatif : retour au score de départ, volée arrêtée', () => {
    expect(evaluateTurn(40, [T(20), S(5)], true)).toMatchObject({ remaining: 40, bust: true, used: 1, over: true, scored: 0 });
  });

  it('double out : bust à 1, bust à 0 sans double', () => {
    expect(evaluateTurn(21, [S(20)], true)).toMatchObject({ bust: true, remaining: 21 });
    expect(evaluateTurn(20, [S(20)], true)).toMatchObject({ bust: true, remaining: 20 });
    expect(evaluateTurn(20, [S(20)], false)).toMatchObject({ finished: true, remaining: 0 });
    expect(evaluateTurn(21, [S(20)], false)).toMatchObject({ bust: false, remaining: 1 });
  });

  it('victoire sur un double ou le bull, avant la 3e fléchette', () => {
    expect(evaluateTurn(40, [D(20)], true)).toMatchObject({ finished: true, used: 1, over: true });
    expect(evaluateTurn(70, [S(20), BULL], true)).toMatchObject({ finished: true, used: 2 });
    expect(evaluateTurn(25, [makeScore(25, 1)], true)).toMatchObject({ bust: true });
  });

  it('une fléchette ratée compte 0', () => {
    expect(evaluateTurn(100, [MISS, MISS, S(1)], true)).toMatchObject({ remaining: 99, over: true });
  });
});

describe('partie', () => {
  it('alterne les joueurs, applique le bust et désigne le vainqueur', () => {
    let g = newGame({ start: 301, doubleOut: true, players: ['Léo', 'Marie'] });
    g = commitTurn(g, [T(20), T(20), T(20)]); // Léo 121
    expect(g.current).toBe(1);
    g = commitTurn(g, [S(1), S(1), S(1)]); // Marie 298
    g = commitTurn(g, [T(20), T(20), S(1)]); // Léo bust (121 - 120 = 1)
    expect(remainingScores(g)).toEqual([121, 298]);
    g = commitTurn(g, [S(20), S(20), S(20)]); // Marie 238
    g = commitTurn(g, [T(20), S(1), D(20)]); // Léo : 121 → 61 → 60 → 20
    expect(remainingScores(g)[0]).toBe(20);
    g = commitTurn(g, [MISS, MISS, MISS]);
    g = commitTurn(g, [D(10)]);
    expect(g.winner).toBe(0);
    expect(g.turns[g.turns.length - 1].darts).toHaveLength(1);
    // Plus rien n'est compté après la victoire.
    expect(commitTurn(g, [T(20)])).toBe(g);
  });

  it('annuler la dernière volée', () => {
    let g = newGame({ start: 501, doubleOut: true, players: ['A', 'B'] });
    g = commitTurn(g, [T(20), T(20), T(20)]);
    g = undoTurn(g);
    expect(remainingScores(g)).toEqual([501, 501]);
    expect(g.current).toBe(0);
  });

  it('statistiques : moyenne par volée, fléchettes, meilleure volée', () => {
    let g = newGame({ start: 501, doubleOut: true, players: ['A'] });
    g = commitTurn(g, [T(20), T(20), T(20)]);
    g = commitTurn(g, [S(20), S(20), S(20)]);
    const [a] = playerStats(g);
    expect(a.darts).toBe(6);
    expect(a.average).toBe(120);
    expect(a.best).toBe(180);
    expect(a.remaining).toBe(261);
  });

  it('refuse 0 ou plus de 4 joueurs', () => {
    expect(() => newGame({ start: 501, doubleOut: true, players: [' '] })).toThrow();
    expect(() => newGame({ start: 501, doubleOut: true, players: ['a', 'b', 'c', 'd', 'e'] })).toThrow();
  });
});

describe('suggestion de finish', () => {
  const lib = (s: ReturnType<typeof suggestCheckout>) => s?.map((d) => d.libelle).join(' ');

  it('les grands classiques', () => {
    expect(lib(suggestCheckout(170))).toBe('T20 T20 BULL');
    expect(lib(suggestCheckout(40))).toBe('D20');
    expect(lib(suggestCheckout(32))).toBe('D16');
    expect(lib(suggestCheckout(100))).toBe('T20 D20');
    expect(lib(suggestCheckout(50))).toBe('BULL');
  });

  it('chaque suggestion est valide jusqu’à 170', () => {
    for (let r = 2; r <= 170; r++) {
      const s = suggestCheckout(r);
      if (!s) continue;
      expect(s.reduce((a, d) => a + d.points, 0)).toBe(r);
      expect(s[s.length - 1].multiplicateur).toBe(2);
      expect(s.length).toBeLessThanOrEqual(3);
    }
  });

  it('scores impossibles à finir en 3 fléchettes', () => {
    for (const r of [169, 168, 166, 165, 163, 162, 159, 1]) expect(suggestCheckout(r)).toBeNull();
  });

  it('avec moins de fléchettes restantes', () => {
    expect(suggestCheckout(100, 1)).toBeNull();
    expect(lib(suggestCheckout(100, 2))).toBe('T20 D20');
  });

  it('sans double out, on peut finir sur n’importe quoi', () => {
    expect(lib(suggestCheckout(60, 3, false))).toBe('T20');
  });
});

describe('match en plusieurs manches', () => {
  // 501 en trois volées : 180, 180, puis le finish classique 141 (T20 T19 D12).
  // Les autres joueurs ratent tout, pour que le joueur courant reste le même.
  const finish = (s: GameState) => {
    const big = [makeScore(20, 3), makeScore(20, 3), makeScore(20, 3)];
    let g = s;
    const others = () => {
      for (let k = 1; k < s.config.players.length; k++) g = commitTurn(g, [MISS, MISS, MISS]);
    };
    g = commitTurn(g, big);
    others();
    g = commitTurn(g, big);
    others();
    return commitTurn(g, [makeScore(20, 3), makeScore(19, 3), makeScore(12, 2)]);
  };

  it('une manche gagnée ne termine pas un match au meilleur des trois', () => {
    let g = newGame({ start: 501, doubleOut: true, players: ['A', 'B'], legs: 2 });
    g = finish(g);
    expect(g.winner).toBe(null);
    expect(legsWon(g)).toEqual([1, 0]);
    // Nouvelle manche : tout le monde repart du départ, et c'est B qui commence.
    expect(remainingScores(g)).toEqual([501, 501]);
    expect(g.current).toBe(1);
  });

  it('le match s’arrête quand un joueur atteint le nombre de manches', () => {
    let g = newGame({ start: 501, doubleOut: true, players: ['A'], legs: 2 });
    g = finish(g);
    expect(g.winner).toBe(null);
    g = finish(g);
    expect(g.winner).toBe(0);
    expect(legsWon(g)).toEqual([2]);
  });

  it('les statistiques couvrent tout le match', () => {
    let g = newGame({ start: 501, doubleOut: true, players: ['A'], legs: 2 });
    g = finish(g);
    const afterOne = playerStats(g)[0].darts;
    g = finish(g);
    expect(playerStats(g)[0].darts).toBe(afterOne * 2);
    expect(playerStats(g)[0].legs).toBe(2);
  });

  it('annuler ramène dans la manche précédente', () => {
    let g = newGame({ start: 501, doubleOut: true, players: ['A', 'B'], legs: 2 });
    g = finish(g);
    expect(g.turns).toHaveLength(0);
    g = undoTurn(g);
    expect(legsWon(g)).toEqual([0, 0]);
    expect(g.current).toBe(0);
    expect(remainingScores(g)[0]).toBe(141);
  });

  it('une partie d’avant cette option reste une manche unique', () => {
    const old = { version: 1, config: { start: 501, doubleOut: true, players: ['A'] }, turns: [], current: 0, winner: null, startedAt: '' } as GameState;
    expect(legsTarget(old)).toBe(1);
    expect(legsWon(old)).toEqual([0]);
    expect(allTurns(old)).toEqual([]);
  });
});
