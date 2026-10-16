// Exercices d'entraînement, sans écran : module pur, testé.
//
// Trois classiques, qui ont tous la même forme : une cible par tour, trois fléchettes,
// des points. Ce qui compte est le score final, comparable d'une séance à l'autre —
// c'est lui qui montre la progression dans l'historique.
//
// - Scoring : dix tours sur le 20. Tout ce qui rentre compte ; la moyenne par volée
//   est la mesure de référence des joueurs de X01.
// - Shanghai : vingt tours, le 1 au premier, le 2 au deuxième… Seul le numéro du tour
//   compte. Simple + double + triple dans le même tour (« Shanghai ») gagne sur-le-champ.
// - Bob 27 : vingt tours sur les doubles, du D1 au D20. On part de 27 points, chaque
//   double touché rapporte deux fois le numéro, un tour sans rien le fait perdre.
//   Score négatif : éliminé.
// - Checkouts : vingt restes tirés au sort, trois fléchettes pour fermer chacun au
//   double. Le score est le nombre de finishes réussis — l'exercice qui fait gagner
//   les parties de X01.

import type { Score } from '../board';
import { suggestCheckout } from './checkout';
import { evaluateTurn } from './x01';

export type DrillKind = 'scoring' | 'shanghai' | 'bob27' | 'checkout';

export interface Drill {
  kind: DrillKind;
  label: string;
  rounds: number;
  /** Points de départ. */
  start: number;
  hint: string;
}

export const DRILLS: Record<DrillKind, Drill> = {
  scoring: { kind: 'scoring', label: 'Scoring 20', rounds: 10, start: 0, hint: 'Dix volées sur le 20 : vise le triple, tout ce qui rentre compte.' },
  shanghai: { kind: 'shanghai', label: 'Shanghai', rounds: 20, start: 0, hint: 'Le 1 au premier tour, le 2 au deuxième… Simple + double + triple dans le même tour et c’est gagné.' },
  bob27: { kind: 'bob27', label: 'Bob 27', rounds: 20, start: 27, hint: 'Les vingt doubles, du D1 au D20. Un tour sans rien coûte deux fois le numéro ; en dessous de zéro, c’est fini.' },
  checkout: { kind: 'checkout', label: 'Checkouts', rounds: 20, start: 0, hint: 'Vingt restes tirés au sort : trois fléchettes pour fermer, en finissant sur un double. Le score est le nombre de finishes réussis.' },
};

/**
 * Restes proposés à l'entraînement : les vrais finishes de trois fléchettes (41 à 170)
 * et les doubles simples (2 à 40). On laisse de côté les petits restes impairs, qui ne
 * se rencontrent presque jamais en partie.
 */
export const CHECKOUT_POOL: number[] = (() => {
  const out: number[] = [];
  for (let n = 2; n <= 40; n += 2) out.push(n);
  for (let n = 41; n <= 170; n++) if (suggestCheckout(n, 3, true)) out.push(n);
  return out;
})();

/** Reste à fermer au tour `round` : tiré au sort, mais toujours le même pour une séance. */
export function checkoutTarget(seed: number, round: number): number {
  // Suite déterministe : la même séance rejoue les mêmes restes (reprise, annulation).
  let x = (seed * 2654435761 + round * 40503 + 12345) >>> 0;
  x ^= x >>> 15;
  x = (x * 2246822507) >>> 0;
  // Le « ou exclusif » rend un entier signé : on repasse en non signé avant le modulo.
  x = (x ^ (x >>> 13)) >>> 0;
  return CHECKOUT_POOL[x % CHECKOUT_POOL.length];
}

export interface TrainingConfig {
  drill: DrillKind;
  players: string[];
  /** Tirage des restes de l'exercice « Checkouts ». */
  seed?: number;
}

export interface TrainingTurn {
  player: number;
  darts: Score[];
  /** Points gagnés (ou perdus) pendant le tour. */
  points: number;
}

export interface TrainingState {
  version: 1;
  kind: 'training';
  config: TrainingConfig;
  turns: TrainingTurn[];
  current: number;
  winner: number | null;
  startedAt: string;
}

/** Numéro visé au tour `round` (0 = premier tour). */
export function drillTarget(kind: DrillKind, round: number, seed = 0): { secteur: number; libelle: string } {
  if (kind === 'scoring') return { secteur: 20, libelle: '20' };
  if (kind === 'checkout') {
    const n = checkoutTarget(seed, round);
    return { secteur: n, libelle: String(n) };
  }
  const n = Math.min(round, 19) + 1;
  return kind === 'bob27' ? { secteur: n, libelle: `D${n}` } : { secteur: n, libelle: String(n) };
}

/** Points rapportés par une volée, selon l'exercice. */
export function roundPoints(kind: DrillKind, round: number, darts: Score[], seed = 0): number {
  const t = drillTarget(kind, round, seed);
  if (kind === 'checkout') return evaluateTurn(t.secteur, darts, true).finished ? 1 : 0;
  if (kind === 'scoring') return darts.reduce((s, d) => s + d.points, 0);
  if (kind === 'shanghai') return darts.filter((d) => d.secteur === t.secteur).reduce((s, d) => s + d.points, 0);
  const hits = darts.filter((d) => d.secteur === t.secteur && d.multiplicateur === 2).length;
  return hits ? hits * 2 * t.secteur : -2 * t.secteur;
}

/** Simple, double et triple du numéro dans le même tour : victoire immédiate. */
export function isShanghai(round: number, darts: Score[]): boolean {
  const t = drillTarget('shanghai', round);
  const mults = new Set(darts.filter((d) => d.secteur === t.secteur).map((d) => d.multiplicateur));
  return mults.has(1) && mults.has(2) && mults.has(3);
}

/** Tour en cours et score de chaque joueur. */
export function standing(state: TrainingState): { round: number[]; score: number[]; out: boolean[] } {
  const { drill, players } = state.config;
  const d = DRILLS[drill];
  const round = players.map(() => 0);
  const score = players.map(() => d.start);
  const out = players.map(() => false);
  for (const t of state.turns) {
    score[t.player] += t.points;
    round[t.player]++;
    if (drill === 'bob27' && score[t.player] < 0) out[t.player] = true;
  }
  return { round, score, out };
}

/** L'exercice est-il terminé pour tout le monde ? */
export function drillOver(state: TrainingState): boolean {
  const { round, out } = standing(state);
  const total = DRILLS[state.config.drill].rounds;
  return round.every((r, i) => r >= total || out[i]);
}

export interface TrainingEval {
  points: number;
  score: number;
  finished: boolean;
  used: number;
  over: boolean;
  /** Tour joué (0 = premier). */
  round: number;
}

export function evaluateTraining(state: TrainingState, darts: Score[]): TrainingEval {
  const { drill, seed = 0 } = state.config;
  const st = standing(state);
  const p = state.current;
  const round = st.round[p];
  if (drill === 'checkout') {
    const target = drillTarget('checkout', round, seed).secteur;
    const ev = evaluateTurn(target, darts, true);
    return { points: ev.finished ? 1 : 0, score: st.score[p] + (ev.finished ? 1 : 0), finished: false, used: ev.used, over: ev.over, round };
  }
  const used = Math.min(3, darts.length);
  const points = roundPoints(drill, round, darts.slice(0, used), seed);
  // Bob 27 : la pénalité ne tombe qu'une fois les trois fléchettes lancées.
  const live = drill === 'bob27' && used < 3 ? Math.max(0, points) : points;
  const score = st.score[p] + live;
  const shanghai = drill === 'shanghai' && isShanghai(round, darts.slice(0, used));
  return { points: live, score, finished: shanghai, used, over: shanghai || used >= 3, round };
}

export function newTraining(config: TrainingConfig): TrainingState {
  const players = config.players.map((p) => p.trim()).filter(Boolean);
  if (players.length < 1 || players.length > 4) throw new Error('De 1 à 4 joueurs');
  const seed = config.seed ?? Math.floor(Math.random() * 1e9);
  return { version: 1, kind: 'training', config: { ...config, players, seed }, turns: [], current: 0, winner: null, startedAt: new Date().toISOString() };
}

/** Joueur en tête à la fin de l'exercice. */
function leader(state: TrainingState): number {
  const { score } = standing(state);
  return score.reduce((best, s, i) => (s > score[best] ? i : best), 0);
}

/** Prochain joueur pas encore sorti ni arrivé au bout. */
function nextPlayer(state: TrainingState): number {
  const { round, out } = standing(state);
  const total = DRILLS[state.config.drill].rounds;
  const n = state.config.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (state.current + k) % n;
    if (!out[i] && round[i] < total) return i;
  }
  return state.current;
}

export function commitTraining(state: TrainingState, darts: Score[]): TrainingState {
  if (state.winner != null) return state;
  const ev = evaluateTraining(state, darts);
  const used = darts.slice(0, ev.used);
  const points = roundPoints(state.config.drill, ev.round, used, state.config.seed ?? 0);
  const next: TrainingState = {
    ...state,
    turns: [...state.turns, { player: state.current, darts: used, points }],
  };
  if (ev.finished) return { ...next, winner: state.current };
  if (drillOver(next)) return { ...next, winner: leader(next) };
  return { ...next, current: nextPlayer(next) };
}

export function undoTraining(state: TrainingState): TrainingState {
  const last = state.turns[state.turns.length - 1];
  if (!last) return state;
  return { ...state, turns: state.turns.slice(0, -1), current: last.player, winner: null };
}

export interface TrainingStats {
  name: string;
  score: number;
  rounds: number;
  darts: number;
  /** Points par volée de 3 fléchettes. */
  perRound: number;
}

export function trainingStats(state: TrainingState): TrainingStats[] {
  const st = standing(state);
  return state.config.players.map((name, i) => {
    const turns = state.turns.filter((t) => t.player === i);
    const darts = turns.reduce((s, t) => s + t.darts.length, 0);
    const gained = turns.reduce((s, t) => s + t.points, 0);
    return { name, score: st.score[i], rounds: st.round[i], darts, perRound: turns.length ? gained / turns.length : 0 };
  });
}
