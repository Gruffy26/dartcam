import { describe, expect, it } from 'vitest';
import { makeScore } from '../board';
import { labelOf, makeEngine, modeOf, newState, summaryLines, type AnyConfig } from './engine';

const T = (n: number) => makeScore(n, 3);
const S = (n: number) => makeScore(n, 1);
const D = (n: number) => makeScore(n, 2);
const cfg = (over: Partial<AnyConfig>): AnyConfig => ({ mode: 'x01', players: ['A', 'B'], start: 501, doubleOut: true, ...over });

describe('moteur commun', () => {
  it('reconnaît chaque jeu et le nomme', () => {
    expect(modeOf(newState(cfg({})))).toBe('x01');
    expect(labelOf(newState(cfg({})))).toBe('501 · double out');
    expect(labelOf(newState(cfg({ mode: 'x01', start: 301, doubleOut: false })))).toBe('301 · sortie libre');
    expect(labelOf(newState(cfg({ mode: 'cricket' })))).toBe('Cricket');
    expect(labelOf(newState(cfg({ mode: 'horloge' })))).toBe('Horloge');
    expect(labelOf(newState(cfg({ mode: 'doubles' })))).toBe('Doubles');
  });

  it('X01 : évalue, enregistre, annonce et résume', () => {
    const e = makeEngine(newState(cfg({})));
    expect(e.evaluate([T(20), T(20), T(20)])).toMatchObject({ over: true, bust: false, total: '180' });
    e.commit([T(20), T(20), T(20)]);
    expect(e.lastSummary()).toBe('180');
    expect(e.current).toBe(1);
    expect(e.nextSay()).toBe('À B, il reste 501.');
    expect(summaryLines(e.state)[0]).toEqual({ name: 'A', value: '321' });
  });

  it('X01 : un bust ne retire rien', () => {
    const e = makeEngine(newState(cfg({ start: 301, players: ['A'] })));
    e.commit([T(20), T(20), T(20)]); // 301 → 121
    e.commit([T(20), T(20)]); // 121 → 1 : bust
    expect(e.lastSummary()).toBe('bust');
    expect(summaryLines(e.state)[0].value).toBe('121');
  });

  it('Cricket : résume en marques et points', () => {
    const e = makeEngine(newState(cfg({ mode: 'cricket' })));
    expect(e.evaluate([T(20), T(20)]).total).toBe('3 marques · 60 pts');
    e.commit([T(20), T(20)]);
    expect(e.lastSummary()).toBe('3 marques · 60 pts');
    expect(e.nextSay()).toBe('À B, 0 points.');
    expect(summaryLines(e.state)[0].value).toBe('60');
  });

  it('Doubles : compte les cibles franchies et dit la suivante', () => {
    const e = makeEngine(newState(cfg({ mode: 'doubles', players: ['A'] })));
    expect(e.evaluate([S(1)]).total).toBe('0');
    e.commit([D(1), D(2), S(3)]);
    expect(e.lastSummary()).toBe('+2');
    expect(e.nextSay()).toBe('Vise le D3.');
    expect(summaryLines(e.state)[0].value).toBe('2/20');
  });

  it('annule la dernière volée dans chaque jeu', () => {
    for (const mode of ['x01', 'cricket', 'horloge'] as const) {
      const e = makeEngine(newState(cfg({ mode })));
      e.commit([T(20)]);
      expect(e.turnCount).toBe(1);
      e.undo();
      expect(e.turnCount).toBe(0);
      expect(e.current).toBe(0);
    }
  });

  it('prépare la ligne d’historique de la partie gagnée', () => {
    const e = makeEngine(newState(cfg({ mode: 'x01', start: 301, players: ['A'] })));
    e.commit([T(20), T(20), T(20)]); // 301 → 121
    e.commit([T(17), D(20)]); // 121 → 70 → 30
    const rec = e.record();
    expect(rec.mode).toBe('x01');
    expect(rec.label).toBe('301 · double out');
    expect(rec.players[0].name).toBe('A');
    expect(rec.players[0].darts).toBeGreaterThan(0);
  });

  it('le tableau de fin a autant de colonnes que d’entêtes', () => {
    for (const mode of ['x01', 'cricket', 'doubles'] as const) {
      const e = makeEngine(newState(cfg({ mode })));
      e.commit([T(20)]);
      const { head, rows } = e.stats();
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r).toHaveLength(head.length);
    }
  });
});
