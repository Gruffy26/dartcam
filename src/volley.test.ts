import { describe, expect, it } from 'vitest';
import { makeScore } from './board';
import { Volley } from './volley';

const p = { x: 1, y: 2 };

describe('volée', () => {
  it('3 fléchettes au maximum, total des points', () => {
    const v = new Volley();
    v.addDetected(makeScore(20, 3), p, p);
    v.addMiss();
    v.addManual(makeScore(5, 1), p, p);
    expect(v.full).toBe(true);
    expect(v.total).toBe(65);
    expect(v.addDetected(makeScore(1, 1), p, p)).toBeNull();
    expect(v.darts.map((d) => d.origin)).toEqual(['auto', 'miss', 'manual']);
  });

  it('correction : garde le score automatique d’origine et marque « corrigé »', () => {
    const v = new Volley();
    v.addDetected(makeScore(12, 1), p, p);
    v.correct(0, makeScore(5, 1), { x: 3, y: 4 }, p);
    expect(v.last!.score.libelle).toBe('5');
    expect(v.last!.autoScore!.libelle).toBe('12');
    expect(v.last!.corrected).toBe(true);
    expect(v.last!.tip).toEqual({ x: 3, y: 4 });
  });

  it('une fléchette ajoutée à la main n’est pas « corrigée » si on la déplace', () => {
    const v = new Volley();
    v.addManual(makeScore(5, 1), p, p);
    v.correct(0, makeScore(1, 1), p, p);
    expect(v.last!.corrected).toBe(false);
  });

  it('annuler retire la dernière ; corriger un indice absent ne fait rien', () => {
    const v = new Volley();
    v.addDetected(makeScore(20, 1), p, p);
    v.addDetected(makeScore(1, 1), p, p);
    expect(v.undo()!.score.libelle).toBe('1');
    expect(v.darts).toHaveLength(1);
    expect(v.correct(5, makeScore(3, 1), p, p)).toBeNull();
  });
});
