import { describe, expect, it } from 'vitest';
import { makeScore, MISS } from '../board';
import { commitCricket, cricketBoard, cricketStats, evaluateCricket, newCricket, undoCricket, type CricketState } from './cricket';

const T = (n: number) => makeScore(n, 3);
const D = (n: number) => makeScore(n, 2);
const S = (n: number) => makeScore(n, 1);
const BULL = makeScore(25, 2);
const OUTER = makeScore(25, 1);

const start = (players = ['A', 'B']) => newCricket({ players });
const play = (s: CricketState, ...darts: ReturnType<typeof S>[]) => commitCricket(s, darts);

describe('cricket', () => {
  it('trois marques ouvrent un numéro, sans rien rapporter', () => {
    const s = play(start(), T(20));
    const b = cricketBoard(s);
    expect(b.marks[0][0]).toBe(3);
    expect(b.points[0]).toBe(0);
  });

  it('les marques en trop rapportent la valeur du numéro', () => {
    // 3 marques pour ouvrir, puis 3 de plus = 60 points.
    const s = play(start(), T(20), T(20));
    expect(cricketBoard(s).points[0]).toBe(60);
  });

  it('un numéro fermé par l’adversaire ne rapporte plus rien', () => {
    let s = play(start(), T(20)); // A ouvre le 20
    s = play(s, T(20)); // B ouvre le 20 : numéro mort
    s = play(s, T(20)); // A retape dedans
    const b = cricketBoard(s);
    expect(b.points[0]).toBe(0);
    expect(b.points[1]).toBe(0);
  });

  it('compte le bull : 25 simple vaut une marque, 50 en vaut deux', () => {
    let s = play(start(), OUTER, BULL); // 3 marques : ouvert, rien marqué
    expect(cricketBoard(s).marks[0][6]).toBe(3);
    expect(cricketBoard(s).points[0]).toBe(0);
    s = play(s, MISS); // au tour de B, qui rate
    s = play(s, BULL); // A remet 2 marques en trop : 50 points
    expect(cricketBoard(s).points[0]).toBe(50);
  });

  it('ignore les numéros hors jeu', () => {
    const s = play(start(), T(14), D(3), MISS);
    const b = cricketBoard(s);
    expect(b.points[0]).toBe(0);
    expect(b.marks[0].every((m) => m === 0)).toBe(true);
  });

  it('ne gagne pas en fermant tout si l’adversaire mène aux points', () => {
    // B ouvre le 20 et marque 60 points d'avance.
    let s = start();
    s = play(s, MISS); // A
    s = play(s, T(20), T(20)); // B : ouvre 20 puis 60 points
    // A ferme tout sans marquer : il ne gagne pas, B a 60 points.
    for (const n of [20, 19, 18, 17, 16, 15]) {
      s = play(s, T(n));
      s = play(s, MISS);
    }
    s = play(s, OUTER, OUTER, OUTER);
    expect(s.winner).toBe(null);
    const b = cricketBoard(s);
    expect(b.marks[0].every((m) => m === 3)).toBe(true);
    expect(b.points[1]).toBe(60);
  });

  it('gagne dès qu’il a tout ouvert et rattrapé les points', () => {
    let s = start(['A']);
    for (const n of [20, 19, 18, 17, 16, 15]) s = play(s, T(n));
    expect(s.winner).toBe(null);
    s = play(s, OUTER, OUTER, OUTER);
    expect(s.winner).toBe(0);
    // La volée s'arrête sur la fléchette gagnante.
    expect(s.turns[s.turns.length - 1].darts).toHaveLength(3);
  });

  it('la volée s’arrête à la fléchette gagnante', () => {
    let s = start(['A']);
    for (const n of [20, 19, 18, 17, 16, 15]) s = play(s, T(n));
    s = play(s, BULL, OUTER, T(20));
    expect(s.winner).toBe(0);
    expect(s.turns[s.turns.length - 1].darts).toHaveLength(2);
  });

  it('évalue une volée en cours sans rien changer', () => {
    const s = play(start(), T(20));
    const ev = evaluateCricket(s, [T(19)]);
    expect(ev.over).toBe(false);
    expect(ev.marks).toBe(3);
    expect(s.turns).toHaveLength(1);
  });

  it('annule la dernière volée', () => {
    const s = play(play(start(), T(20)), T(19));
    const back = undoCricket(s);
    expect(back.turns).toHaveLength(1);
    expect(back.current).toBe(1);
  });

  it('résume la partie joueur par joueur', () => {
    const s = play(play(start(), T(20), T(20)), S(19));
    const st = cricketStats(s);
    expect(st[0].points).toBe(60);
    expect(st[0].marks).toBe(3);
    expect(st[0].rate).toBeCloseTo(4.5, 1);
    expect(st[1].marks).toBe(1);
  });
});
