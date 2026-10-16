import { h } from '../dom';
import { clearGame, lastConfig, saveGame, saveLastConfig } from '../game/store';
import { labelOf, newState, type AnyConfig } from '../game/engine';
import { DRILLS, type DrillKind } from '../game/training';
import type { GameMode } from '../game/history';
import { icon } from '../icons';
import type { Nav } from '../main';
import { getSettings, updateSettings } from '../settings';
import { unlockSpeech } from '../speech';
import { appBar, group, row, segmented, toggle } from '../ui';

/** Une phrase pour dire à quoi on joue. */
const MODE_HINTS: Record<GameMode, string> = {
  x01: 'Descendre de 501 (ou 301) à zéro, pile, en finissant sur un double.',
  cricket: 'Ouvrir le 20, 19, 18, 17, 16, 15 et le bull en trois marques, puis marquer dessus tant que l’adversaire ne les a pas fermés.',
  horloge: 'Toucher le 1, puis le 2, et ainsi de suite jusqu’au 20.',
  doubles: 'La même série, mais il faut le double à chaque fois : l’entraînement qui fait gagner les parties.',
  training: '',
};

// Préparation d'une partie : jeu, options, 1 à 4 joueurs.
export function setupScreen(nav: Nav): HTMLElement {
  const base = lastConfig();
  const cfg: AnyConfig = { ...base, players: [...base.players] };
  // Options propres au X01 : masquées pour les autres jeux.
  const x01Only = h(
    'div',
    { class: 'stack' },
    segmented([{ value: 501, label: '501' }, { value: 301, label: '301' }], cfg.start, (v) => (cfg.start = v as 301 | 501)),
    segmented([{ value: true, label: 'Double out' }, { value: false, label: 'Sortie libre' }], cfg.doubleOut, (v) => (cfg.doubleOut = v as boolean)),
  );
  // Exercices d'entraînement : chacun donne un score comparable d'une séance à l'autre.
  const drillOnly = h(
    'div',
    { class: 'stack' },
    segmented(
      Object.values(DRILLS).map((d) => ({ value: d.kind, label: d.label })),
      cfg.drill,
      (v) => {
        cfg.drill = v as DrillKind;
        showMode();
      },
    ),
  );
  const showMode = () => {
    x01Only.classList.toggle('hidden', cfg.mode !== 'x01');
    drillOnly.classList.toggle('hidden', cfg.mode !== 'training');
    hint.textContent = cfg.mode === 'training' ? DRILLS[cfg.drill].hint : MODE_HINTS[cfg.mode];
  };
  const playersBody = h('div', { class: 'group-body players' });

  function renderPlayers() {
    const rows: Node[] = cfg.players.map((name, i) => {
      const input = h('input', {
        type: 'text',
        value: name,
        maxlength: '14',
        autocomplete: 'off',
        autocapitalize: 'words',
        enterkeyhint: 'done',
        placeholder: `Joueur ${i + 1}`,
        'aria-label': `Prénom du joueur ${i + 1}`,
      });
      input.addEventListener('input', () => (cfg.players[i] = input.value));
      return h(
        'div',
        { class: 'player-row' },
        h('span', { class: 'num' }, String(i + 1)),
        input,
        cfg.players.length > 1
          ? h('button', { class: 'iconbtn', 'aria-label': `Retirer le joueur ${i + 1}`, onclick: () => (cfg.players.splice(i, 1), renderPlayers()) }, icon('close', 20))
          : null,
      );
    });
    if (cfg.players.length < 4)
      rows.push(
        h(
          'button',
          { class: 'row clickable add-player', onclick: () => (cfg.players.push(''), renderPlayers(), focusLast()) },
          icon('plus', 20),
          h('span', { class: 'row-text' }, 'Ajouter un joueur'),
        ),
      );
    playersBody.replaceChildren(...rows);
  }
  const hint = h('p', { class: 'mode-hint' });
  showMode();
  const focusLast = () => (playersBody.querySelectorAll('input')[cfg.players.length - 1] as HTMLInputElement | undefined)?.focus();
  renderPlayers();

  function start() {
    const players = cfg.players.map((p, i) => p.trim() || `Joueur ${i + 1}`);
    const config = { ...cfg, players };
    saveLastConfig(config);
    clearGame();
    const state = newState(config);
    saveGame({ state, pending: [] });
    // Sur iPhone, la voix doit être « débloquée » par un toucher : on annonce le début.
    unlockSpeech(`${labelOf(state)}, c'est parti ! À ${players[0]}.`);
    nav('game');
  }

  return h(
    'main',
    { class: 'page setup' },
    appBar({ title: 'Nouvelle partie', onBack: () => nav('home') }),
    group(
      'Jeu',
      segmented(
        [
          { value: 'x01', label: 'X01' },
          { value: 'cricket', label: 'Cricket' },
          { value: 'horloge', label: 'Horloge' },
          { value: 'doubles', label: 'Doubles' },
          { value: 'training', label: 'Entraînement' },
        ],
        cfg.mode,
        (v) => {
          cfg.mode = v as GameMode;
          showMode();
        },
      ),
      hint,
      x01Only,
      drillOnly,
    ),
    h('section', { class: 'group' }, h('h2', { class: 'group-title' }, 'Joueurs'), playersBody),
    group(null, row('Annonce vocale', 'Score de chaque volée à voix haute', toggle(getSettings().voice, (v) => updateSettings({ voice: v }), 'Annonce vocale'))),
    h('div', { class: 'page-footer' }, h('button', { class: 'btn primary lg block', onclick: start }, icon('play', 20), 'Commencer la partie')),
  );
}
