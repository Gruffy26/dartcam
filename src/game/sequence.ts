// Jeux d'entraînement qui suivent une série de cibles, sans écran : module pur, testé.
//
// - « Horloge » : toucher le 1, puis le 2, … jusqu'au 20, par n'importe quel multiple.
// - « Doubles » : la même série, mais il faut le double à chaque fois.
// Le gagnant est le premier à terminer la série ; seul contre soi-même, ce qui compte
// est le nombre de fléchettes utilisées.

import type { Score } from '../board';

export type SequenceKind = 'horloge' | 'doubles';
export const SEQUENCE_LENGTH = 20;

export interface SequenceConfig {
  kind: SequenceKind;
  players: string[];
}

export interface SequenceTurn {
  player: number;
  darts: Score[];
  /** Cibles franchies pendant la volée. */
  hits: number;
}

export interface SequenceState {
  version: 1;
  kind: 'sequence';
  config: SequenceConfig;
  turns: SequenceTurn[];
  current: number;
  winner: number | null;
  startedAt: string;
}

/** Cible à toucher à l'étape `index` (0 → le 1). */
export function targetAt(kind: SequenceKind, index: number): { secteur: number; libelle: string } {
  const n = Math.min(index, SEQUENCE_LENGTH - 1) + 1;
  return { secteur: n, libelle: kind === 'doubles' ? `D${n}` : String(n) };
}

/** La fléchette touche-t-elle la cible de l'étape `index` ? */
export function hitsTarget(kind: SequenceKind, index: number, s: Score): boolean {
  if (index >= SEQUENCE_LENGTH) return false;
  const t = targetAt(kind, index);
  if (s.secteur !== t.secteur || s.points === 0) return false;
  return kind === 'doubles' ? s.multiplicateur === 2 : true;
}

/** Étape atteinte par chaque joueur (0 = doit toucher le 1). */
export function progress(state: SequenceState): number[] {
  const idx = state.config.players.map(() => 0);
  for (const t of state.turns) {
    for (const d of t.darts) if (hitsTarget(state.config.kind, idx[t.player], d)) idx[t.player]++;
  }
  return idx;
}

export interface SequenceEval {
  hits: number;
  /** Étape du joueur courant après la volée. */
  index: number;
  finished: boolean;
  used: number;
  over: boolean;
}

export function evaluateSequence(state: SequenceState, darts: Score[]): SequenceEval {
  const kind = state.config.kind;
  let index = progress(state)[state.current];
  let hits = 0;
  for (let i = 0; i < darts.length && i < 3; i++) {
    if (hitsTarget(kind, index, darts[i])) {
      index++;
      hits++;
      if (index >= SEQUENCE_LENGTH) return { hits, index, finished: true, used: i + 1, over: true };
    }
  }
  const used = Math.min(3, darts.length);
  return { hits, index, finished: false, used, over: used >= 3 };
}

export function newSequence(config: SequenceConfig): SequenceState {
  const players = config.players.map((p) => p.trim()).filter(Boolean);
  if (players.length < 1 || players.length > 4) throw new Error('De 1 à 4 joueurs');
  return { version: 1, kind: 'sequence', config: { ...config, players }, turns: [], current: 0, winner: null, startedAt: new Date().toISOString() };
}

export function commitSequence(state: SequenceState, darts: Score[]): SequenceState {
  if (state.winner != null) return state;
  const ev = evaluateSequence(state, darts);
  const turn: SequenceTurn = { player: state.current, darts: darts.slice(0, ev.used), hits: ev.hits };
  const n = state.config.players.length;
  return {
    ...state,
    turns: [...state.turns, turn],
    winner: ev.finished ? state.current : null,
    current: ev.finished ? state.current : (state.current + 1) % n,
  };
}

export function undoSequence(state: SequenceState): SequenceState {
  const last = state.turns[state.turns.length - 1];
  if (!last) return state;
  return { ...state, turns: state.turns.slice(0, -1), current: last.player, winner: null };
}

export interface SequenceStats {
  name: string;
  index: number;
  darts: number;
  /** Fléchettes utilisées par cible franchie. */
  perTarget: number;
}

export function sequenceStats(state: SequenceState): SequenceStats[] {
  const idx = progress(state);
  return state.config.players.map((name, i) => {
    const turns = state.turns.filter((t) => t.player === i);
    const darts = turns.reduce((s, t) => s + t.darts.length, 0);
    return { name, index: idx[i], darts, perTarget: idx[i] ? darts / idx[i] : 0 };
  });
}
