// Statistiques d'un joueur sur ses parties de X01 enregistrées.
//
// L'historique garde le détail des volées : on peut donc recalculer après coup ce qui
// intéresse un joueur qui progresse — la moyenne, les grosses volées, les neuf premières
// fléchettes et surtout le pourcentage de finish.

import { parseScore } from '../board';
import type { GameRecord, RecordedTurn } from './history';
import { history } from './history';

export interface X01Analysis {
  name: string;
  /** Parties de X01 prises en compte. */
  games: number;
  darts: number;
  points: number;
  /** Moyenne par volée de 3 fléchettes. */
  average: number;
  /** Moyenne des neuf premières fléchettes de chaque manche. */
  first9: number;
  best: number;
  s180: number;
  s140: number;
  s100: number;
  s60: number;
  /** Volées où une fléchette au moins visait un double gagnant. */
  attempts: number;
  /** Manches effectivement terminées. */
  hits: number;
  /** Pourcentage de finish (manches terminées / occasions). */
  checkout: number;
  /** Plus gros finish réussi. */
  bestCheckout: number;
}

/** Un reste se ferme-t-il d'une seule fléchette (double ou bull) ? */
function oneDartOut(remaining: number): boolean {
  return remaining === 50 || (remaining <= 40 && remaining > 0 && remaining % 2 === 0);
}

/** La volée offrait-elle au moins une fléchette sur un double gagnant ? */
export function hadDartAtDouble(turn: RecordedTurn): boolean {
  let left = turn.r;
  if (oneDartOut(left)) return true;
  for (const label of turn.d) {
    const s = parseScore(label);
    if (!s) continue;
    const next = left - s.points;
    if (next < 0 || next === 1) return false; // bust : plus de fléchette utile
    left = next;
    if (left === 0) return true;
    if (oneDartOut(left)) return true;
  }
  return false;
}

function empty(name: string): X01Analysis {
  return {
    name,
    games: 0,
    darts: 0,
    points: 0,
    average: 0,
    first9: 0,
    best: 0,
    s180: 0,
    s140: 0,
    s100: 0,
    s60: 0,
    attempts: 0,
    hits: 0,
    checkout: 0,
    bestCheckout: 0,
  };
}

/** Analyse les parties de X01 qui ont gardé le détail de leurs volées. */
export function analyseX01(games: GameRecord[] = history()): X01Analysis[] {
  const by = new Map<string, X01Analysis & { f9points: number; f9darts: number }>();
  for (const g of games) {
    if (g.mode !== 'x01' || !g.turns?.length) continue;
    const seen = new Set<number>();
    // Numéro de volée dans la manche, par joueur : les neuf premières fléchettes.
    const inLeg = new Map<number, number>();
    for (const t of g.turns) {
      const name = g.players[t.p]?.name;
      if (!name) continue;
      const a = by.get(name) ?? { ...empty(name), f9points: 0, f9darts: 0 };
      if (!seen.has(t.p)) {
        a.games++;
        seen.add(t.p);
      }
      const darts = t.d.length;
      a.darts += darts;
      a.points += t.s;
      a.best = Math.max(a.best, t.s);
      if (t.s === 180) a.s180++;
      if (t.s >= 140) a.s140++;
      if (t.s >= 100) a.s100++;
      if (t.s >= 60) a.s60++;
      const rank = inLeg.get(t.p) ?? 0;
      if (rank < 3) {
        a.f9points += t.s;
        a.f9darts += darts;
      }
      inLeg.set(t.p, t.f ? 0 : rank + 1);
      if (hadDartAtDouble(t)) a.attempts++;
      if (t.f) {
        a.hits++;
        a.bestCheckout = Math.max(a.bestCheckout, t.r);
      }
      by.set(name, a);
    }
  }
  return [...by.values()]
    .map((a) => ({
      ...a,
      average: a.darts ? (a.points / a.darts) * 3 : 0,
      first9: a.f9darts ? (a.f9points / a.f9darts) * 3 : 0,
      checkout: a.attempts ? (100 * a.hits) / a.attempts : 0,
    }))
    .sort((x, y) => y.darts - x.darts);
}
