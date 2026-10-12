import { h } from '../dom';
import { newGame, type GameConfig } from '../game/x01';
import { clearGame, lastConfig, saveGame, saveLastConfig } from '../game/store';
import type { Nav } from '../main';
import { getSettings, updateSettings } from '../settings';
import { unlockSpeech } from '../speech';

// Préparation d'une partie : 501 / 301, double out, 1 à 4 joueurs.
export function setupScreen(nav: Nav): HTMLElement {
  const cfg: GameConfig = { ...lastConfig(), players: [...lastConfig().players] };

  const modeBtns = ([501, 301] as const).map((v) =>
    h('button', { class: 'seg', onclick: () => ((cfg.start = v), render()) }, String(v)),
  );
  const doBtns = ([true, false] as const).map((v) =>
    h('button', { class: 'seg', onclick: () => ((cfg.doubleOut = v), render()) }, v ? 'Double out' : 'Sortie libre'),
  );
  const playersBox = h('div', { class: 'players' });
  const voice = h('input', { type: 'checkbox', class: 'switch', checked: getSettings().voice });
  voice.addEventListener('change', () => updateSettings({ voice: voice.checked }));

  function render() {
    modeBtns.forEach((b, i) => b.classList.toggle('on', cfg.start === [501, 301][i]));
    doBtns.forEach((b, i) => b.classList.toggle('on', cfg.doubleOut === [true, false][i]));
    const rows: Node[] = cfg.players.map((name, i) => {
        const input = h('input', { type: 'text', value: name, maxlength: '14', autocomplete: 'off', 'aria-label': `Joueur ${i + 1}` });
        input.addEventListener('input', () => (cfg.players[i] = input.value));
        return h(
          'div',
          { class: 'player-row' },
          h('span', { class: 'num' }, String(i + 1)),
          input,
          cfg.players.length > 1
            ? h('button', { class: 'remove', 'aria-label': 'Retirer', onclick: () => (cfg.players.splice(i, 1), render()) }, '✕')
            : null,
        );
      });
    if (cfg.players.length < 4)
      rows.push(h('button', { class: 'big', onclick: () => (cfg.players.push(`Joueur ${cfg.players.length + 1}`), render()) }, '+ Ajouter un joueur'));
    playersBox.replaceChildren(...rows);
  }
  render();

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
    { class: 'screen setup' },
    h('header', {}, h('button', { class: 'back', onclick: () => nav('home') }, '‹ Retour'), h('h2', {}, 'Nouvelle partie')),
    h('section', {}, h('h3', {}, 'Jeu'), h('div', { class: 'segmented' }, ...modeBtns), h('div', { class: 'segmented' }, ...doBtns)),
    h('section', {}, h('h3', {}, 'Joueurs'), playersBox),
    h('label', { class: 'choice' }, voice, h('span', {}, h('b', {}, 'Annonce vocale'), h('small', {}, 'Le score de chaque volée est annoncé à voix haute.'))),
    h('button', { class: 'big primary', onclick: start }, 'Commencer la partie'),
  );
}
