// Vue commune aux trois jeux, pour que l'écran de partie n'ait pas à les connaître.
//
// Chaque jeu garde ses règles dans son module pur (x01, cricket, sequence) ; ce fichier
// les habille d'une même interface : évaluer la volée en cours, l'enregistrer, annuler,
// résumer, et fournir le tableau de fin de partie.

import type { Score } from '../board';
import { commitCricket, cricketStats, evaluateCricket, newCricket, undoCricket, type CricketState } from './cricket';
import type { GameMode, GameRecord } from './history';
import { commitSequence, evaluateSequence, newSequence, progress, sequenceStats, targetAt, undoSequence, type SequenceState } from './sequence';
import {
  commitTraining,
  DRILLS,
  drillTarget,
  evaluateTraining,
  newTraining,
  standing,
  trainingStats,
  undoTraining,
  type DrillKind,
  type TrainingState,
} from './training';
import { allTurns, commitTurn, evaluateTurn, newGame, playerStats, remainingScores, undoTurn, type GameConfig, type GameState } from './x01';

export type AnyState = GameState | CricketState | SequenceState | TrainingState;

export interface VolleyEval {
  /** La volée est terminée (3 fléchettes, bust ou victoire). */
  over: boolean;
  /** Fléchettes réellement comptées. */
  used: number;
  finished: boolean;
  /** Volée annulée par la règle (bust du X01). */
  bust: boolean;
  /** Ce que la volée rapporte, affiché sous les fléchettes. */
  total: string;
}

export interface Engine {
  state: AnyState;
  mode: GameMode;
  /** Format lisible : « 501 · double out », « Cricket », « Horloge ». */
  label: string;
  players: string[];
  current: number;
  winner: number | null;
  turnCount: number;
  evaluate(darts: Score[]): VolleyEval;
  commit(darts: Score[]): void;
  undo(): void;
  /** Résumé de la dernière volée enregistrée (bandeau « corriger »). */
  lastSummary(): string;
  /** Phrase dite à voix haute en passant au joueur suivant. */
  nextSay(): string;
  stats(): { head: string[]; rows: string[][] };
  record(): GameRecord;
}

export function modeOf(state: AnyState): GameMode {
  if ('kind' in state && state.kind === 'training') return 'training';
  if ('kind' in state && state.kind === 'cricket') return 'cricket';
  if ('kind' in state && state.kind === 'sequence') return state.config.kind;
  return 'x01';
}

export function labelOf(state: AnyState): string {
  const mode = modeOf(state);
  if (mode === 'x01') {
    const s = state as GameState;
    const legs = Math.max(1, s.config.legs ?? 1);
    // Titre court : en match, le nombre de manches prime sur le mode de sortie.
    if (legs > 1) return `${s.config.start} · ${legs} manches`;
    return `${s.config.start} · ${s.config.doubleOut ? 'double out' : 'sortie libre'}`;
  }
  if (mode === 'cricket') return 'Cricket';
  if (mode === 'training') return `Entraînement · ${DRILLS[(state as TrainingState).config.drill].label}`;
  return mode === 'doubles' ? 'Doubles' : 'Horloge';
}

const fmt1 = (v: number) => v.toFixed(1).replace('.', ',');

export function makeEngine(initial: AnyState): Engine {
  const e: Engine = {
    state: initial,
    get mode() {
      return modeOf(e.state);
    },
    get label() {
      return labelOf(e.state);
    },
    get players() {
      return e.state.config.players;
    },
    get current() {
      return e.state.current;
    },
    get winner() {
      return e.state.winner;
    },
    get turnCount() {
      return e.state.turns.length;
    },

    evaluate(darts) {
      if (e.mode === 'x01') {
        const s = e.state as GameState;
        const before = remainingScores(s)[s.current];
        const ev = evaluateTurn(before, darts, s.config.doubleOut);
        return { over: ev.over, used: ev.used, finished: ev.finished, bust: ev.bust, total: ev.bust ? 'BUST' : String(ev.scored) };
      }
      if (e.mode === 'cricket') {
        const ev = evaluateCricket(e.state as CricketState, darts);
        const bits = [ev.marks ? `${ev.marks} marque${ev.marks > 1 ? 's' : ''}` : '', ev.points ? `${ev.points} pts` : ''].filter(Boolean);
        return { over: ev.over, used: ev.used, finished: ev.finished, bust: false, total: bits.join(' · ') || '0' };
      }
      if (e.mode === 'training') {
        const s = e.state as TrainingState;
        const ev = evaluateTraining(s, darts);
        const total =
          s.config.drill === 'checkout'
            ? ev.points
              ? 'Fermé !'
              : '—'
            : ev.points > 0
              ? `+${ev.points}`
              : String(ev.points);
        return { over: ev.over, used: ev.used, finished: ev.finished, bust: ev.points < 0, total };
      }
      const ev = evaluateSequence(e.state as SequenceState, darts);
      return { over: ev.over, used: ev.used, finished: ev.finished, bust: false, total: ev.hits ? `+${ev.hits}` : '0' };
    },

    commit(darts) {
      if (e.mode === 'x01') e.state = commitTurn(e.state as GameState, darts);
      else if (e.mode === 'cricket') e.state = commitCricket(e.state as CricketState, darts);
      else if (e.mode === 'training') e.state = commitTraining(e.state as TrainingState, darts);
      else e.state = commitSequence(e.state as SequenceState, darts);
    },

    undo() {
      if (e.mode === 'x01') e.state = undoTurn(e.state as GameState);
      else if (e.mode === 'cricket') e.state = undoCricket(e.state as CricketState);
      else if (e.mode === 'training') e.state = undoTraining(e.state as TrainingState);
      else e.state = undoSequence(e.state as SequenceState);
    },

    lastSummary() {
      const turns = e.state.turns;
      const last = turns[turns.length - 1];
      if (!last) return '';
      if (e.mode === 'x01') {
        const t = last as GameState['turns'][number];
        return t.bust ? 'bust' : String(t.before - t.after);
      }
      if (e.mode === 'cricket') {
        const t = last as CricketState['turns'][number];
        return [t.marks ? `${t.marks} marque${t.marks > 1 ? 's' : ''}` : '', t.points ? `${t.points} pts` : ''].filter(Boolean).join(' · ') || '0';
      }
      if (e.mode === 'training') {
        const t = last as TrainingState['turns'][number];
        if ((e.state as TrainingState).config.drill === 'checkout') return t.points ? 'fermé' : 'raté';
        return t.points > 0 ? `+${t.points}` : String(t.points);
      }
      const t = last as SequenceState['turns'][number];
      return t.hits ? `+${t.hits}` : '0';
    },

    nextSay() {
      const name = e.players[e.current];
      const solo = e.players.length < 2;
      if (e.mode === 'x01') {
        const rem = remainingScores(e.state as GameState)[e.current];
        return solo ? `Il reste ${rem}.` : `À ${name}, il reste ${rem}.`;
      }
      if (e.mode === 'cricket') {
        const pts = cricketStats(e.state as CricketState)[e.current].points;
        return solo ? `${pts} points.` : `À ${name}, ${pts} points.`;
      }
      if (e.mode === 'training') {
        const s = e.state as TrainingState;
        const st = standing(s);
        const cible = drillTarget(s.config.drill, st.round[e.current], s.config.seed ?? 0).libelle;
        const score = st.score[e.current];
        if (s.config.drill === 'checkout') return solo ? `${cible}. Finis en trois fléchettes.` : `À ${name} : ${cible}.`;
        return solo ? `${score} points. Vise le ${cible}.` : `À ${name}, ${score} points, vise le ${cible}.`;
      }
      const s = e.state as SequenceState;
      const cible = targetAt(s.config.kind, progress(s)[e.current]).libelle;
      return solo ? `Vise le ${cible}.` : `À ${name}, vise le ${cible}.`;
    },

    stats() {
      if (e.mode === 'x01') {
        return {
          head: ['Joueur', 'Restant', 'Moyenne', 'Record'],
          rows: playerStats(e.state as GameState).map((p) => [p.name, String(p.remaining), fmt1(p.average), String(p.best)]),
        };
      }
      if (e.mode === 'cricket') {
        return {
          head: ['Joueur', 'Points', 'Marques', 'Par volée'],
          rows: cricketStats(e.state as CricketState).map((p) => [p.name, String(p.points), String(p.marks), fmt1(p.rate)]),
        };
      }
      if (e.mode === 'training') {
        const s = e.state as TrainingState;
        if (s.config.drill === 'checkout') {
          return {
            head: ['Joueur', 'Réussis', 'Tentatives', 'Taux'],
            rows: trainingStats(s).map((p) => [p.name, String(p.score), String(p.rounds), p.rounds ? `${Math.round((100 * p.score) / p.rounds)} %` : '—']),
          };
        }
        return {
          head: ['Joueur', 'Score', 'Volées', 'Par volée'],
          rows: trainingStats(s).map((p) => [p.name, String(p.score), String(p.rounds), fmt1(p.perRound)]),
        };
      }
      return {
        head: ['Joueur', 'Cibles', 'Fléchettes', 'Par cible'],
        rows: sequenceStats(e.state as SequenceState).map((p) => [p.name, `${p.index}/20`, String(p.darts), fmt1(p.perTarget)]),
      };
    },

    record() {
      const at = new Date().toISOString();
      const ms = Date.parse(at) - Date.parse(e.state.startedAt || at);
      const winner = e.winner;
      if (e.mode === 'x01') {
        const st = playerStats(e.state as GameState);
        const s = e.state as GameState;
        return {
          at,
          mode: 'x01',
          label: e.label,
          ms,
          // Détail des volées : il permettra de recalculer n'importe quelle statistique.
          turns: allTurns(s).map((t) => ({
            p: t.player,
            r: t.before,
            s: t.before - t.after,
            d: t.darts.map((d) => d.libelle),
            ...(t.bust ? { b: 1 as const } : {}),
            ...(t.finished ? { f: 1 as const } : {}),
          })),
          players: st.map((p, i) => ({
            name: p.name,
            result: String(p.remaining),
            darts: p.darts,
            won: i === winner,
            scored: allTurns(s).filter((t) => t.player === i).reduce((a, t) => a + (t.before - t.after), 0),
            best: p.best,
          })),
        };
      }
      if (e.mode === 'cricket') {
        return {
          at,
          mode: 'cricket',
          label: 'Cricket',
          ms,
          players: cricketStats(e.state as CricketState).map((p, i) => ({ name: p.name, result: `${p.points} pts`, darts: p.darts, won: i === winner })),
        };
      }
      if (e.mode === 'training') {
        return {
          at,
          mode: 'training',
          label: e.label,
          ms,
          players: trainingStats(e.state as TrainingState).map((p, i) => ({ name: p.name, result: `${p.score}`, darts: p.darts, won: i === winner, scored: p.score })),
        };
      }
      return {
        at,
        mode: e.mode,
        label: e.label,
        ms,
        players: sequenceStats(e.state as SequenceState).map((p, i) => ({ name: p.name, result: `${p.index}/20`, darts: p.darts, won: i === winner })),
      };
    },
  };
  return e;
}

/** Où en est chaque joueur, en une valeur courte : pour la carte « partie en cours ». */
export function summaryLines(state: AnyState): { name: string; value: string }[] {
  const mode = modeOf(state);
  if (mode === 'x01') {
    const s = state as GameState;
    return s.config.players.map((name, i) => ({ name, value: String(remainingScores(s)[i]) }));
  }
  if (mode === 'cricket') {
    return cricketStats(state as CricketState).map((p) => ({ name: p.name, value: `${p.points}` }));
  }
  if (mode === 'training') {
    return trainingStats(state as TrainingState).map((p) => ({ name: p.name, value: `${p.score}` }));
  }
  return sequenceStats(state as SequenceState).map((p) => ({ name: p.name, value: `${p.index}/20` }));
}

/** Réglages d'une nouvelle partie, tous modes confondus. */
export interface AnyConfig {
  mode: GameMode;
  players: string[];
  /** X01 seulement. */
  start: 301 | 501;
  doubleOut: boolean;
  /** Entraînement seulement : l'exercice choisi. */
  drill: DrillKind;
  /** X01 seulement : manches à gagner (1 = une seule manche). */
  legs?: number;
}

export function newState(c: AnyConfig): AnyState {
  if (c.mode === 'training') return newTraining({ drill: c.drill, players: c.players });
  if (c.mode === 'cricket') return newCricket({ players: c.players });
  if (c.mode === 'horloge' || c.mode === 'doubles') return newSequence({ kind: c.mode, players: c.players });
  return newGame({ start: c.start, doubleOut: c.doubleOut, legs: c.legs ?? 1, players: c.players } satisfies GameConfig);
}
