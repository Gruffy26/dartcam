import { loadCalibration } from '../calibration';
import { h } from '../dom';
import type { Nav } from '../main';
import { gameInProgress } from '../game/store';
import { remainingScores } from '../game/x01';
import { getSettings } from '../settings';

function calibrationStatus(): string {
  const source = getSettings().source;
  const cal = loadCalibration(source);
  const what = source === 'camera' ? 'Caméra' : 'Vidéo de test';
  if (!cal) return `${what} : la cible sera détectée automatiquement à l’ouverture de la caméra`;
  const d = new Date(cal.createdAt);
  const when = Number.isNaN(d.getTime())
    ? ''
    : ` le ${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  const how = cal.method === 'auto' ? 'détectée automatiquement' : 'calibrée à la main';
  return `${what} : cible ${how}${when} ✓ (redétectée à chaque partie)`;
}

export function homeScreen(nav: Nav): HTMLElement {
  return h(
    'main',
    { class: 'screen home' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '' }), h('h1', {}, 'DartCam')),
    h(
      'div',
      { class: 'menu' },
      resumeButton(nav),
      h('button', { class: 'big' + (gameInProgress() ? '' : ' primary'), onclick: () => nav('setup') }, 'Nouvelle partie'),
      h('button', { class: 'big', onclick: () => nav('calibrate') }, 'Calibrer la cible'),
      h('button', { class: 'big', onclick: () => nav('settings') }, 'Réglages'),
      h('button', { class: 'link', onclick: () => nav('help') }, 'Comment placer le téléphone ?'),
    ),
    h('p', { class: 'muted status' }, calibrationStatus()),
  );
}

function resumeButton(nav: Nav): HTMLElement | string {
  const g = gameInProgress();
  if (!g) return '';
  const rem = remainingScores(g.state);
  const summary = g.state.config.players.map((p, i) => `${p} ${rem[i]}`).join(' · ');
  return h('button', { class: 'big primary resume', onclick: () => nav('game') }, 'Reprendre la partie', h('small', {}, summary));
}
