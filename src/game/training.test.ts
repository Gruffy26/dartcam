import { describe, expect, it } from 'vitest';
import { makeScore, MISS } from '../board';
import {
  commitTraining,
  drillOver,
  drillTarget,
  evaluateTraining,
  isShanghai,
  newTraining,
  roundPoints,
  standing,
  trainingStats,
  undoTraining,
  type DrillKind,
  type TrainingState,
} from './training';

const S = (n: number) => makeScore(n, 1);
const D = (n: number) => makeScore(n, 2);
const T = (n: number) => makeScore(n, 3);
const start = (drill: DrillKind, players = ['A']) => newTraining({ drill, players });
const play = (s: TrainingState, ...darts: ReturnType<typeof S>[]) => commitTraining(s, darts);

describe('entraînement — scoring', () => {
  it('compte tout ce qui rentre', () => {
    const s = play(start('scoring'), T(20), S(20), S(5));
    expect(standing(s).score[0]).toBe(85);
  });

  it('se termine après dix volées, le meilleur gagne', () => {
    let s = start('scoring', ['A', 'B']);
    for (let i = 0; i < 10; i++) {
      s = play(s, T(20));
      s = play(s, S(20));
    }
    expect(drillOver(s)).toBe(true);
    expect(s.winner).toBe(0);
    expect(standing(s).score).toEqual([600, 200]);
  });
});

describe('entraînement — shanghai', () => {
  it('ne compte que le numéro du tour', () => {
    const s = play(start('shanghai'), T(1), S(20), S(1));
    expect(standing(s).score[0]).toBe(4);
    expect(drillTarget('shanghai', 1).libelle).toBe('2');
  });

  it('simple + double + triple du tour gagne tout de suite', () => {
    expect(isShanghai(0, [S(1), D(1), T(1)])).toBe(true);
    expect(isShanghai(0, [S(1), D(1), S(1)])).toBe(false);
    const s = play(start('shanghai'), S(1), D(1), T(1));
    expect(s.winner).toBe(0);
  });
});

describe('entraînement — Bob 27', () => {
  it('part de 27 et ajoute deux fois le numéro par double touché', () => {
    const s = play(start('bob27'), D(1), MISS, MISS);
    expect(standing(s).score[0]).toBe(29);
  });

  it('un tour sans double coûte deux fois le numéro', () => {
    const s = play(start('bob27'), MISS, S(1), T(1));
    expect(standing(s).score[0]).toBe(25);
  });

  it('ne retire rien tant que les trois fléchettes ne sont pas lancées', () => {
    const s = start('bob27');
    expect(evaluateTraining(s, [MISS]).score).toBe(27);
    expect(evaluateTraining(s, [MISS, MISS, MISS]).score).toBe(25);
  });

  it('élimine en dessous de zéro', () => {
    let s = start('bob27');
    // Rien pendant les premiers doubles : 27 − 2 − 4 − 6 − 8 − 10 = −3.
    for (let i = 0; i < 5; i++) s = play(s, MISS, MISS, MISS);
    expect(standing(s).score[0]).toBe(-3);
    expect(standing(s).out[0]).toBe(true);
    expect(drillOver(s)).toBe(true);
  });

  it('vise le double du tour', () => {
    expect(drillTarget('bob27', 0).libelle).toBe('D1');
    expect(roundPoints('bob27', 19, [D(20)])).toBe(40);
  });
});

describe('entraînement — commun', () => {
  it('alterne les joueurs et saute ceux qui ont fini', () => {
    let s = start('scoring', ['A', 'B']);
    s = play(s, T(20));
    expect(s.current).toBe(1);
    s = play(s, T(20));
    expect(s.current).toBe(0);
  });

  it('annule la dernière volée', () => {
    const s = play(play(start('scoring'), T(20)), S(20));
    expect(standing(undoTraining(s)).score[0]).toBe(60);
  });

  it('résume le score et les points par volée', () => {
    const s = play(play(start('scoring'), T(20)), S(20));
    const st = trainingStats(s);
    expect(st[0].score).toBe(80);
    expect(st[0].rounds).toBe(2);
    expect(st[0].darts).toBe(2);
    expect(st[0].perRound).toBe(40);
  });
});
