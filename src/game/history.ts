// Historique des parties terminées, gardé sur le téléphone.
//
// Une partie finie devient une ligne : le mode, la date, le résultat de chaque joueur.
// De quoi suivre sa progression d'une séance à l'autre, ce que le tableau de fin de
// partie ne montrait que sur l'instant.

import { loadJSON, removeKey, saveJSON } from '../storage';

const KEY = 'dartcam.history';
/** Au-delà, les plus anciennes parties sont oubliées. */
export const MAX_GAMES = 150;

export type GameMode = 'x01' | 'cricket' | 'horloge' | 'doubles' | 'training';

export interface HistoryPlayer {
  name: string;
  /** Résultat affiché : « 0 », « 182 pts », « 14/20 »… */
  result: string;
  darts: number;
  won: boolean;
  /** X01 : points marqués et meilleure volée, pour les moyennes. */
  scored?: number;
  best?: number;
}

/**
 * Une volée enregistrée, au format le plus court possible : les parties s'empilent dans
 * le stockage du téléphone. `r` (reste avant la volée) et `d` (étiquettes des fléchettes)
 * suffisent à tout recalculer plus tard — moyennes, séries, pourcentage de finish.
 */
export interface RecordedTurn {
  /** Index du joueur. */
  p: number;
  /** Reste avant la volée (X01). */
  r: number;
  /** Points marqués. */
  s: number;
  /** Étiquettes des fléchettes, « T20 », « D16 »… */
  d: string[];
  /** Volée annulée par la règle. */
  b?: 1;
  /** Volée qui termine la manche. */
  f?: 1;
}

export interface GameRecord {
  at: string;
  mode: GameMode;
  /** Format lisible : « 501 · double out », « Cricket », « Horloge ». */
  label: string;
  players: HistoryPlayer[];
  /** Durée de la partie (ms), si connue. */
  ms?: number;
  /** Détail des volées (X01), pour pouvoir ré-analyser la partie plus tard. */
  turns?: RecordedTurn[];
}

export function history(): GameRecord[] {
  const all = loadJSON<GameRecord[]>(KEY, []);
  return Array.isArray(all) ? all.filter((g) => g && Array.isArray(g.players)) : [];
}

export function addGame(rec: GameRecord): void {
  const all = [rec, ...history()].slice(0, MAX_GAMES);
  saveJSON(KEY, all);
}

export function clearHistory(): void {
  removeKey(KEY);
}

export interface PlayerTotals {
  name: string;
  games: number;
  wins: number;
  darts: number;
  /** Moyenne par 3 fléchettes sur toutes les parties X01. */
  average: number;
  /** Meilleure volée en X01. */
  best: number;
}

export interface DrillProgress {
  label: string;
  count: number;
  /** Meilleur score obtenu, et par qui. */
  bestName: string;
  best: number;
  /** Score de la dernière séance. */
  last: number;
  lastName: string;
}

/**
 * Progression par exercice d'entraînement : le record et la dernière séance.
 * C'est le tableau qu'on regarde pour savoir si l'on progresse vraiment.
 */
export function trainingProgress(games = history()): DrillProgress[] {
  const by = new Map<string, DrillProgress>();
  // `history()` rend les parties de la plus récente à la plus ancienne.
  for (const g of games) {
    if (g.mode !== 'training') continue;
    for (const p of g.players) {
      const score = p.scored ?? Number(p.result);
      if (!Number.isFinite(score)) continue;
      const cur = by.get(g.label);
      if (!cur) {
        by.set(g.label, { label: g.label, count: 1, best: score, bestName: p.name, last: score, lastName: p.name });
      } else {
        cur.count++;
        if (score > cur.best) {
          cur.best = score;
          cur.bestName = p.name;
        }
      }
    }
  }
  return [...by.values()];
}

/** Cumul par joueur, tous modes confondus (la moyenne ne compte que le X01). */
export function totals(games = history()): PlayerTotals[] {
  const by = new Map<string, PlayerTotals & { scored: number; x01Darts: number }>();
  for (const g of games) {
    for (const p of g.players) {
      const t = by.get(p.name) ?? { name: p.name, games: 0, wins: 0, darts: 0, average: 0, best: 0, scored: 0, x01Darts: 0 };
      t.games++;
      if (p.won) t.wins++;
      t.darts += p.darts;
      if (g.mode === 'x01') {
        t.scored += p.scored ?? 0;
        t.x01Darts += p.darts;
        t.best = Math.max(t.best, p.best ?? 0);
      }
      by.set(p.name, t);
    }
  }
  return [...by.values()]
    .map((t) => ({ name: t.name, games: t.games, wins: t.wins, darts: t.darts, best: t.best, average: t.x01Darts ? (t.scored / t.x01Darts) * 3 : 0 }))
    .sort((a, b) => b.games - a.games);
}
