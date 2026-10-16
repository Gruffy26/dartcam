// Historique des parties terminées, gardé sur le téléphone.
//
// Une partie finie devient une ligne : le mode, la date, le résultat de chaque joueur.
// De quoi suivre sa progression d'une séance à l'autre, ce que le tableau de fin de
// partie ne montrait que sur l'instant.

import { loadJSON, removeKey, saveJSON } from '../storage';

const KEY = 'dartcam.history';
/** Au-delà, les plus anciennes parties sont oubliées. */
export const MAX_GAMES = 200;

export type GameMode = 'x01' | 'cricket' | 'horloge' | 'doubles';

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

export interface GameRecord {
  at: string;
  mode: GameMode;
  /** Format lisible : « 501 · double out », « Cricket », « Horloge ». */
  label: string;
  players: HistoryPlayer[];
  /** Durée de la partie (ms), si connue. */
  ms?: number;
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
