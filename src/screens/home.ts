import { loadCalibration } from '../calibration';
import { h } from '../dom';
import { gameInProgress } from '../game/store';
import { remainingScores } from '../game/x01';
import type { Nav } from '../main';
import { getSettings } from '../settings';
import { button, group, row } from '../ui';

export function homeScreen(nav: Nav): HTMLElement {
  const g = gameInProgress();
  const source = getSettings().source;
  const cal = loadCalibration(source);
  const status =
    source === 'video'
      ? 'Mode vidéo de test'
      : cal
        ? 'Cible détectée automatiquement à chaque partie'
        : 'La cible sera détectée à l’ouverture de la caméra';

  const resume = g
    ? h(
        'button',
        { class: 'resume-card', onclick: () => nav('game') },
        h('b', {}, 'Reprendre la partie'),
        h(
          'span',
          {},
          g.state.config.players.map((p, i) => `${p} ${remainingScores(g.state)[i]}`).join('  ·  '),
        ),
      )
    : null;

  return h(
    'main',
    { class: 'page home' },
    h(
      'div',
      { class: 'home-hero' },
      h('img', { src: 'icons/icon-192.png', alt: '' }),
      h('h1', {}, 'DartCam'),
      h('p', {}, 'Le score de tes fléchettes, compté par la caméra.'),
    ),
    resume,
    Object.assign(button('Nouvelle partie', () => nav('setup'), g ? 'secondary' : 'primary', 'play'), { className: `btn ${g ? 'secondary' : 'primary'} lg block` }),
    group(
      null,
      row('Vérifier la cible', 'Caméra, zoom et repères', null, () => nav('calibrate'), 'target'),
      row('Réglages', 'Source, voix, détection', null, () => nav('settings'), 'settings'),
      row('Placer le téléphone', 'Conseils pour le trépied', null, () => nav('help'), 'help'),
    ),
    h('p', { class: 'status-line' }, status),
  );
}
