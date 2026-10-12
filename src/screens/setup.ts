import { h } from '../dom';
import { clearGame, lastConfig, saveGame, saveLastConfig } from '../game/store';
import { newGame, type GameConfig } from '../game/x01';
import { icon } from '../icons';
import type { Nav } from '../main';
import { getSettings, updateSettings } from '../settings';
import { unlockSpeech } from '../speech';
import { appBar, group, row, segmented, toggle } from '../ui';

// Préparation d'une partie : 501 / 301, double out, 1 à 4 joueurs.
export function setupScreen(nav: Nav): HTMLElement {
  const base = lastConfig();
  const cfg: GameConfig = { ...base, players: [...base.players] };
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
  const focusLast = () => (playersBody.querySelectorAll('input')[cfg.players.length - 1] as HTMLInputElement | undefined)?.focus();
  renderPlayers();

  function start() {
    const players = cfg.players.map((p, i) => p.trim() || `Joueur ${i + 1}`);
    const config = { ...cfg, players };
    saveLastConfig(config);
    clearGame();
    saveGame({ state: newGame(config), pending: [] });
    // Sur iPhone, la voix doit être « débloquée » par un toucher : on annonce le début.
    unlockSpeech(`${config.start}, c'est parti ! À ${players[0]}.`);
    nav('game');
  }

  return h(
    'main',
    { class: 'page setup' },
    appBar({ title: 'Nouvelle partie', onBack: () => nav('home') }),
    group(
      'Jeu',
      segmented([{ value: 501, label: '501' }, { value: 301, label: '301' }], cfg.start, (v) => (cfg.start = v as 301 | 501)),
      segmented([{ value: true, label: 'Double out' }, { value: false, label: 'Sortie libre' }], cfg.doubleOut, (v) => (cfg.doubleOut = v as boolean)),
    ),
    h('section', { class: 'group' }, h('h2', { class: 'group-title' }, 'Joueurs'), playersBody),
    group(null, row('Annonce vocale', 'Score de chaque volée à voix haute', toggle(getSettings().voice, (v) => updateSettings({ voice: v }), 'Annonce vocale'))),
    h('div', { class: 'page-footer' }, h('button', { class: 'btn primary lg block', onclick: start }, icon('play', 20), 'Commencer la partie')),
  );
}
