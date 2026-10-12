// Règles du jeu X01 (501 / 301), sans écran : module pur, testé.
//
// - Chaque joueur part de 501 (ou 301) et retire le total de chaque volée de 3 fléchettes.
// - Bust : score négatif, ou (double out) score de 1, ou 0 atteint sans finir sur un
//   double (ou le bull) → la volée s'arrête et le score revient à celui du début de la volée.
// - Victoire : atteindre exactement 0 (sur un double si « double out »).

import type { Score } from '../board';

export interface GameConfig {
  start: 301 | 501;
  doubleOut: boolean;
  players: string[];
}

export interface Turn {
  player: number;
  darts: Score[];
  /** Score restant au début de la volée. */
  before: number;
  /** Score restant après la volée (= before en cas de bust). */
  after: number;
  bust: boolean;
  finished: boolean;
}

export interface GameState {
  version: 1;
  config: GameConfig;
  turns: Turn[];
  /** Joueur dont c'est le tour. */
  current: number;
  winner: number | null;
  startedAt: string;
}

export interface TurnEval {
  /** Score restant après les fléchettes comptées. */
  remaining: number;
  bust: boolean;
  finished: boolean;
  /** Fléchettes réellement comptées (la volée s'arrête au bust ou à la victoire). */
  used: number;
  /** Points retirés (0 en cas de bust). */
  scored: number;
  /** La volée est terminée (3 fléchettes, bust ou victoire). */
  over: boolean;
}

/** Une fléchette termine-t-elle valablement la partie ? */
export function isFinishingDart(s: Score, doubleOut: boolean): boolean {
  return !doubleOut || s.multiplicateur === 2; // double ou bull (25 × 2)
}

/** Évalue une volée (en cours ou finie) à partir du score restant au début. */
export function evaluateTurn(before: number, darts: Score[], doubleOut: boolean): TurnEval {
  let remaining = before;
  for (let i = 0; i < darts.length && i < 3; i++) {
    const d = darts[i];
    const next = remaining - d.points;
    if (next < 0 || (doubleOut && next === 1) || (next === 0 && !isFinishingDart(d, doubleOut))) {
      return { remaining: before, bust: true, finished: false, used: i + 1, scored: 0, over: true };
    }
    remaining = next;
    if (remaining === 0) return { remaining: 0, bust: false, finished: true, used: i + 1, scored: before, over: true };
  }
  const used = Math.min(3, darts.length);
  return { remaining, bust: false, finished: false, used, scored: before - remaining, over: used >= 3 };
}

export function newGame(config: GameConfig): GameState {
  const players = config.players.map((p) => p.trim()).filter(Boolean);
  if (players.length < 1 || players.length > 4) throw new Error('De 1 à 4 joueurs');
  return {
    version: 1,
    config: { ...config, players },
    turns: [],
    current: 0,
    winner: null,
    startedAt: new Date().toISOString(),
  };
}

/** Score restant de chaque joueur (volées enregistrées seulement). */
export function remainingScores(state: GameState): number[] {
  const r = state.config.players.map(() => state.config.start as number);
  for (const t of state.turns) r[t.player] = t.after;
  return r;
}

/** Enregistre la volée du joueur courant et passe au suivant (sauf victoire). */
export function commitTurn(state: GameState, darts: Score[]): GameState {
  if (state.winner != null) return state;
  const before = remainingScores(state)[state.current];
  const ev = evaluateTurn(before, darts, state.config.doubleOut);
  const turn: Turn = {
    player: state.current,
    darts: darts.slice(0, ev.used),
    before,
    after: ev.remaining,
    bust: ev.bust,
    finished: ev.finished,
  };
  const n = state.config.players.length;
  return {
    ...state,
    turns: [...state.turns, turn],
    winner: ev.finished ? state.current : null,
    current: ev.finished ? state.current : (state.current + 1) % n,
  };
}

/** Annule la dernière volée enregistrée (erreur de comptage). */
export function undoTurn(state: GameState): GameState {
  const last = state.turns[state.turns.length - 1];
  if (!last) return state;
  return { ...state, turns: state.turns.slice(0, -1), current: last.player, winner: null };
}

export interface PlayerStats {
  name: string;
  remaining: number;
  darts: number;
  /** Moyenne par volée de 3 fléchettes. */
  average: number;
  best: number;
}

export function playerStats(state: GameState): PlayerStats[] {
  const rem = remainingScores(state);
  return state.config.players.map((name, i) => {
    const turns = state.turns.filter((t) => t.player === i);
    // Les fléchettes d'une volée « bust » comptent (règle usuelle des moyennes).
    const darts = turns.reduce((s, t) => s + (t.bust || t.finished ? t.darts.length : 3), 0);
    const scored = turns.reduce((s, t) => s + (t.before - t.after), 0);
    const best = turns.reduce((m, t) => Math.max(m, t.before - t.after), 0);
    return { name, remaining: rem[i], darts, average: darts ? (scored / darts) * 3 : 0, best };
  });
}
