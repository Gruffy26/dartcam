// Règles du Cricket, sans écran : module pur, testé.
//
// - On ne joue que le 20, 19, 18, 17, 16, 15 et le bull.
// - Chaque fléchette vaut des « marques » : simple 1, double 2, triple 3 ; bull 1, et
//   bull intérieur (50) 2. Trois marques ouvrent le numéro pour le joueur.
// - Numéro déjà ouvert : les marques en trop rapportent sa valeur en points, mais
//   seulement tant qu'un adversaire ne l'a pas fermé lui aussi.
// - Victoire : avoir ouvert les sept numéros et compter au moins autant de points que
//   chacun des adversaires.

import type { Score } from '../board';

/** Numéros joués, dans l'ordre d'affichage (25 = bull). */
export const CRICKET_TARGETS = [20, 19, 18, 17, 16, 15, 25] as const;
export type CricketTarget = (typeof CRICKET_TARGETS)[number];
/** Marques nécessaires pour ouvrir un numéro. */
export const MARKS_TO_OPEN = 3;

export interface CricketConfig {
  players: string[];
}

export interface CricketTurn {
  player: number;
  darts: Score[];
  /** Marques gagnées pendant la volée, par numéro. */
  marks: number;
  /** Points marqués pendant la volée. */
  points: number;
}

export interface CricketState {
  version: 1;
  kind: 'cricket';
  config: CricketConfig;
  turns: CricketTurn[];
  current: number;
  winner: number | null;
  startedAt: string;
}

/** Marques et points de chaque joueur, reconstitués depuis les volées enregistrées. */
export interface CricketBoard {
  /** marks[joueur][numéro] de 0 à 3. */
  marks: number[][];
  points: number[];
}

/** Marques apportées par une fléchette sur un numéro du cricket (0 si hors jeu). */
export function dartMarks(s: Score): { target: CricketTarget; marks: number } | null {
  const t = CRICKET_TARGETS.find((x) => x === s.secteur);
  if (!t || s.points === 0) return null;
  return { target: t, marks: s.multiplicateur };
}

function emptyBoard(n: number): CricketBoard {
  return { marks: Array.from({ length: n }, () => CRICKET_TARGETS.map(() => 0)), points: Array(n).fill(0) };
}

/** Tous les adversaires ont-ils fermé ce numéro (il ne rapporte alors plus rien) ? */
function deadFor(board: CricketBoard, player: number, idx: number): boolean {
  return board.marks.every((m, p) => p === player || m[idx] >= MARKS_TO_OPEN);
}

/** Applique une fléchette au tableau (le modifie) et rend les points marqués. */
function applyDart(board: CricketBoard, player: number, s: Score): { marks: number; points: number } {
  const hit = dartMarks(s);
  if (!hit) return { marks: 0, points: 0 };
  const idx = CRICKET_TARGETS.indexOf(hit.target);
  const have = board.marks[player][idx];
  const opening = Math.min(hit.marks, MARKS_TO_OPEN - have);
  board.marks[player][idx] = have + opening;
  const extra = hit.marks - opening;
  let points = 0;
  if (extra > 0 && !deadFor(board, player, idx)) {
    points = extra * hit.target;
    board.points[player] += points;
  }
  return { marks: opening, points };
}

/** A-t-il ouvert les sept numéros et au moins autant de points que les autres ? */
export function hasWon(board: CricketBoard, player: number): boolean {
  const all = board.marks[player].every((m) => m >= MARKS_TO_OPEN);
  return all && board.points.every((p, i) => i === player || board.points[player] >= p);
}

export function cricketBoard(state: CricketState): CricketBoard {
  const board = emptyBoard(state.config.players.length);
  for (const turn of state.turns) for (const d of turn.darts) applyDart(board, turn.player, d);
  return board;
}

export interface CricketEval {
  marks: number;
  points: number;
  finished: boolean;
  /** Fléchettes comptées (la volée s'arrête sur une victoire). */
  used: number;
  over: boolean;
  /** Tableau tel qu'il serait après la volée. */
  board: CricketBoard;
}

/** Évalue une volée en cours ou finie, sans toucher à l'état. */
export function evaluateCricket(state: CricketState, darts: Score[]): CricketEval {
  const board = cricketBoard(state);
  const player = state.current;
  let marks = 0;
  let points = 0;
  for (let i = 0; i < darts.length && i < 3; i++) {
    const got = applyDart(board, player, darts[i]);
    marks += got.marks;
    points += got.points;
    if (hasWon(board, player)) {
      return { marks, points, finished: true, used: i + 1, over: true, board };
    }
  }
  const used = Math.min(3, darts.length);
  return { marks, points, finished: false, used, over: used >= 3, board };
}

export function newCricket(config: CricketConfig): CricketState {
  const players = config.players.map((p) => p.trim()).filter(Boolean);
  if (players.length < 1 || players.length > 4) throw new Error('De 1 à 4 joueurs');
  return { version: 1, kind: 'cricket', config: { players }, turns: [], current: 0, winner: null, startedAt: new Date().toISOString() };
}

export function commitCricket(state: CricketState, darts: Score[]): CricketState {
  if (state.winner != null) return state;
  const ev = evaluateCricket(state, darts);
  const turn: CricketTurn = { player: state.current, darts: darts.slice(0, ev.used), marks: ev.marks, points: ev.points };
  const n = state.config.players.length;
  return {
    ...state,
    turns: [...state.turns, turn],
    winner: ev.finished ? state.current : null,
    current: ev.finished ? state.current : (state.current + 1) % n,
  };
}

export function undoCricket(state: CricketState): CricketState {
  const last = state.turns[state.turns.length - 1];
  if (!last) return state;
  return { ...state, turns: state.turns.slice(0, -1), current: last.player, winner: null };
}

export interface CricketStats {
  name: string;
  points: number;
  marks: number;
  darts: number;
  /** Marques par volée de 3 fléchettes. */
  rate: number;
}

export function cricketStats(state: CricketState): CricketStats[] {
  const board = cricketBoard(state);
  return state.config.players.map((name, i) => {
    const turns = state.turns.filter((t) => t.player === i);
    const darts = turns.reduce((s, t) => s + t.darts.length, 0);
    const marks = turns.reduce((s, t) => s + t.marks, 0);
    return { name, points: board.points[i], marks, darts, rate: darts ? (marks / darts) * 3 : 0 };
  });
}
