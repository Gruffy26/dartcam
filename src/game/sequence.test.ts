import { describe, expect, it } from 'vitest';
import { makeScore, MISS } from '../board';
import { commitSequence, evaluateSequence, hitsTarget, newSequence, progress, sequenceStats, targetAt, undoSequence, type SequenceState } from './sequence';

const S = (n: number) => makeScore(n, 1);
const D = (n: number) => makeScore(n, 2);
const T = (n: number) => makeScore(n, 3);

const horloge = (players = ['A']) => newSequence({ kind: 'horloge', players });
const doubles = (players = ['A']) => newSequence({ kind: 'doubles', players });

describe('horloge', () => {
  it('avance d’une cible par fléchette juste, quel que soit le multiple', () => {
    const s = commitSequence(horloge(), [S(1), T(2), D(3)]);
    expect(progress(s)[0]).toBe(3);
  });

  it('ne bouge pas sur une fléchette à côté', () => {
    const s = commitSequence(horloge(), [S(5), MISS, S(1)]);
    expect(progress(s)[0]).toBe(1);
  });

  it('nomme la cible à toucher', () => {
    expect(targetAt('horloge', 0).libelle).toBe('1');
    expect(targetAt('doubles', 19).libelle).toBe('D20');
  });

  it('gagne en terminant le 20, et la volée s’arrête là', () => {
    let s = horloge();
    for (let n = 1; n <= 19; n++) s = commitSequence(s, [S(n)]);
    expect(s.winner).toBe(null);
    s = commitSequence(s, [S(20), S(20), S(20)]);
    expect(s.winner).toBe(0);
    expect(s.turns[s.turns.length - 1].darts).toHaveLength(1);
  });

  it('passe au joueur suivant à chaque volée', () => {
    let s = horloge(['A', 'B']);
    s = commitSequence(s, [S(1)]);
    expect(s.current).toBe(1);
    s = commitSequence(s, [S(1), S(2)]);
    expect(progress(s)).toEqual([1, 2]);
  });
});

describe('doubles', () => {
  it('n’accepte que le double', () => {
    expect(hitsTarget('doubles', 0, S(1))).toBe(false);
    expect(hitsTarget('doubles', 0, D(1))).toBe(true);
    expect(hitsTarget('doubles', 0, T(1))).toBe(false);
  });

  it('compte les fléchettes par cible franchie', () => {
    let s: SequenceState = doubles();
    s = commitSequence(s, [S(1), S(1), D(1)]);
    s = commitSequence(s, [D(2), MISS, MISS]);
    const st = sequenceStats(s);
    expect(st[0].index).toBe(2);
    expect(st[0].darts).toBe(6);
    expect(st[0].perTarget).toBe(3);
  });
});

describe('série — évaluation et annulation', () => {
  it('évalue une volée en cours sans rien changer', () => {
    const s = commitSequence(horloge(), [S(1)]);
    const ev = evaluateSequence(s, [S(2), MISS]);
    expect(ev).toMatchObject({ hits: 1, index: 2, over: false, finished: false });
    expect(s.turns).toHaveLength(1);
  });

  it('annule la dernière volée', () => {
    const s = commitSequence(commitSequence(horloge(), [S(1)]), [S(2)]);
    expect(progress(undoSequence(s))[0]).toBe(1);
  });
});
