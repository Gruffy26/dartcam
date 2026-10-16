// Tableaux de bord : chaque jeu a sa façon d'afficher où en sont les joueurs.
// L'écran de partie ne connaît que `renderScores`.

import type { Score } from '../board';
import { suggestCheckout } from '../game/checkout';
import { CRICKET_TARGETS, evaluateCricket, MARKS_TO_OPEN, type CricketState } from '../game/cricket';
import type { Engine } from '../game/engine';
import { evaluateSequence, progress, SEQUENCE_LENGTH, targetAt, type SequenceState } from '../game/sequence';
import { evaluateTurn, playerStats, remainingScores, type GameState } from '../game/x01';
import { h } from '../dom';

const fmt1 = (v: number) => v.toFixed(1).replace('.', ',');

/** Dessine le tableau du jeu en cours dans `el`, volée en cours comprise. */
export function renderScores(el: HTMLElement, engine: Engine, pending: Score[]): void {
  if (engine.mode === 'x01') el.replaceChildren(...x01Board(engine.state as GameState, pending));
  else if (engine.mode === 'cricket') el.replaceChildren(cricketBoardEl(engine.state as CricketState, pending));
  else el.replaceChildren(...sequenceBoard(engine.state as SequenceState, pending));
}

/** Ligne compacte affichée sous la caméra agrandie. */
export function stripText(engine: Engine, pending: Score[]): string {
  if (engine.mode === 'x01') {
    const s = engine.state as GameState;
    const before = remainingScores(s)[s.current];
    const ev = evaluateTurn(before, pending, s.config.doubleOut);
    return String(ev.bust ? before : ev.remaining);
  }
  if (engine.mode === 'cricket') {
    const ev = evaluateCricket(engine.state as CricketState, pending);
    return `${ev.board.points[engine.current]} pts`;
  }
  const s = engine.state as SequenceState;
  return `${evaluateSequence(s, pending).index}/${SEQUENCE_LENGTH}`;
}

// --- X01 -------------------------------------------------------------------
function x01Board(s: GameState, pending: Score[]): HTMLElement[] {
  const rem = remainingScores(s);
  const st = playerStats(s);
  const cur = s.current;
  const ev = evaluateTurn(rem[cur], pending, s.config.doubleOut);
  const shown = ev.bust ? rem[cur] : ev.remaining;

  const left = 3 - pending.length;
  let co: HTMLElement | null = null;
  if (s.winner == null && !ev.over && shown <= 170) {
    const route = suggestCheckout(shown, left, s.config.doubleOut);
    co = route
      ? h('div', { class: 'checkout' }, route.map((d) => d.libelle).join('  ·  '))
      : h('div', { class: 'checkout none' }, `Pas de finish en ${left} fléchette${left > 1 ? 's' : ''}`);
  }
  const active = h(
    'div',
    { class: 'active-card' },
    h(
      'div',
      { class: 'active-head' },
      h('span', { class: 'active-name' }, s.config.players[cur]),
      h('span', { class: 'active-avg' }, st[cur].darts ? `moy. ${fmt1(st[cur].average)}` : `${s.config.start}`),
    ),
    h('div', { class: 'active-remaining' + (ev.bust ? ' bust' : '') }, String(shown)),
    co,
  );
  const others =
    s.config.players.length > 1
      ? h(
          'div',
          { class: 'others' },
          ...s.config.players
            .map((name, i) => ({ name, i }))
            .filter(({ i }) => i !== cur)
            .map(({ name, i }) => h('div', { class: 'other' }, h('span', { class: 'other-name' }, name), h('span', { class: 'other-rem' }, String(rem[i])))),
        )
      : null;
  return others ? [active, others] : [active];
}

// --- Cricket ---------------------------------------------------------------
/** Marques : rien, une barre, une croix, puis le numéro fermé. */
const MARK_LABEL = ['', '/', '✕', '⊗'];

function cricketBoardEl(s: CricketState, pending: Score[]): HTMLElement {
  const ev = evaluateCricket(s, pending);
  const board = ev.board;
  const n = s.config.players.length;
  const grid = h('div', { class: 'cricket', style: `--players:${n}` });
  grid.append(h('span', { class: 'cri-corner' }, ''));
  for (let p = 0; p < n; p++) {
    grid.append(h('span', { class: 'cri-name' + (p === s.current ? ' on' : '') }, s.config.players[p]));
  }
  CRICKET_TARGETS.forEach((t, idx) => {
    const dead = board.marks.every((m) => m[idx] >= MARKS_TO_OPEN);
    grid.append(h('span', { class: 'cri-target' + (dead ? ' dead' : '') }, t === 25 ? 'Bull' : String(t)));
    for (let p = 0; p < n; p++) {
      const m = board.marks[p][idx];
      grid.append(h('span', { class: `cri-mark m${m}` + (p === s.current ? ' on' : '') }, MARK_LABEL[m]));
    }
  });
  grid.append(h('span', { class: 'cri-target pts' }, 'Points'));
  for (let p = 0; p < n; p++) {
    grid.append(h('span', { class: 'cri-points' + (p === s.current ? ' on' : '') }, String(board.points[p])));
  }
  return grid;
}

// --- Horloge et doubles ----------------------------------------------------
function sequenceBoard(s: SequenceState, pending: Score[]): HTMLElement[] {
  const idx = progress(s);
  const ev = evaluateSequence(s, pending);
  const cur = s.current;
  const done = Math.min(ev.index, SEQUENCE_LENGTH);
  const active = h(
    'div',
    { class: 'active-card' },
    h(
      'div',
      { class: 'active-head' },
      h('span', { class: 'active-name' }, s.config.players[cur]),
      h('span', { class: 'active-avg' }, `${done}/${SEQUENCE_LENGTH}`),
    ),
    h('div', { class: 'active-remaining' }, done >= SEQUENCE_LENGTH ? '✓' : targetAt(s.config.kind, done).libelle),
    h('div', { class: 'checkout' }, done >= SEQUENCE_LENGTH ? 'Série terminée' : 'Cible à toucher'),
    h(
      'div',
      { class: 'seq-track' },
      ...Array.from({ length: SEQUENCE_LENGTH }, (_, i) =>
        h('i', { class: 'seq-dot' + (i < done ? ' on' : '') + (i === done ? ' next' : '') }),
      ),
    ),
  );
  const others =
    s.config.players.length > 1
      ? h(
          'div',
          { class: 'others' },
          ...s.config.players
            .map((name, i) => ({ name, i }))
            .filter(({ i }) => i !== cur)
            .map(({ name, i }) =>
              h('div', { class: 'other' }, h('span', { class: 'other-name' }, name), h('span', { class: 'other-rem' }, `${idx[i]}/${SEQUENCE_LENGTH}`)),
            ),
        )
      : null;
  return others ? [active, others] : [active];
}
