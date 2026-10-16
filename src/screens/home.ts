import { loadCalibration } from '../calibration';
import { h } from '../dom';
import { gameInProgress, lastConfig } from '../game/store';
import { remainingScores } from '../game/x01';
import { icon } from '../icons';
import type { Nav } from '../main';
import { getSettings } from '../settings';
import { loadJSON, saveJSON } from '../storage';

/** Cible stylisée en fond du bandeau : anneaux et secteurs, très discrets. */
function boardMotif(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'hero-board');
  svg.setAttribute('viewBox', '-110 -110 220 220');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  };
  for (const r of [100, 84, 62, 46, 14, 6]) {
    add('circle', { r: String(r), cx: '0', cy: '0', fill: 'none', stroke: 'currentColor', 'stroke-width': r > 80 ? '2' : '1' });
  }
  for (let k = 0; k < 20; k++) {
    const a = ((k * 18 + 9) * Math.PI) / 180;
    add('line', {
      x1: String(14 * Math.sin(a)),
      y1: String(-14 * Math.cos(a)),
      x2: String(100 * Math.sin(a)),
      y2: String(-100 * Math.cos(a)),
      stroke: 'currentColor',
      'stroke-width': '1',
    });
  }
  return svg;
}

/** L'app tourne-t-elle depuis l'écran d'accueil (plein écran) plutôt que dans Safari ? */
function installed(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

const INSTALL_KEY = 'dartcam.installHidden';

/** Marche à suivre sur iPhone : il n'y a pas de bouton « installer » dans Safari. */
function installCard(): HTMLElement | null {
  if (installed() || loadJSON<boolean>(INSTALL_KEY, false)) return null;
  const card = h(
    'section',
    { class: 'install' },
    h(
      'button',
      {
        class: 'install-close',
        'aria-label': 'Masquer',
        onclick: () => {
          saveJSON(INSTALL_KEY, true);
          card.remove();
        },
      },
      icon('close', 18),
    ),
    h('b', {}, 'Installe DartCam sur ton écran d’accueil'),
    h('p', {}, 'Elle s’ouvre alors en plein écran, sans la barre d’adresse, et fonctionne sans réseau.'),
    h(
      'ol',
      {},
      h('li', {}, 'Touche ', h('span', { class: 'ikey' }, icon('share', 16)), ' en bas de Safari'),
      h('li', {}, 'Choisis ', h('span', { class: 'ikey' }, icon('plus_square', 16), 'Sur l’écran d’accueil')),
      h('li', {}, 'Puis ', h('b', {}, 'Ajouter'), ' en haut à droite'),
    ),
    h('small', {}, 'L’app installée garde ses propres réglages : commence par vérifier la cible.'),
  );
  return card;
}

export function homeScreen(nav: Nav): HTMLElement {
  const g = gameInProgress();
  const source = getSettings().source;
  const cal = loadCalibration(source);
  const cfg = lastConfig();
  const status =
    source === 'video'
      ? 'Mode vidéo de test'
      : cal
        ? 'Cible détectée automatiquement à chaque partie'
        : 'La cible sera détectée à l’ouverture de la caméra';

  const tile = (name: string, title: string, sub: string, go: () => void) =>
    h('button', { class: 'tile', onclick: go }, h('span', { class: 'tile-ic' }, icon(name, 22)), h('b', {}, title), h('small', {}, sub));

  const resume = g
    ? h(
        'button',
        { class: 'resume', onclick: () => nav('game') },
        h('span', { class: 'resume-top' }, h('i', { class: 'live' }), 'Partie en cours'),
        h(
          'span',
          { class: 'resume-scores' },
          ...g.state.config.players.map((p, i) =>
            h('span', { class: 'resume-player' }, h('em', {}, String(remainingScores(g.state)[i])), h('small', {}, p)),
          ),
        ),
        h('span', { class: 'resume-go' }, 'Reprendre', icon('back', 18)),
      )
    : null;

  const players = cfg.players.length > 1 ? `${cfg.players.length} joueurs` : '1 joueur';

  return h(
    'main',
    { class: 'page home' },
    h(
      'header',
      { class: 'hero' },
      h('div', { class: 'hero-glow' }),
      boardMotif(),
      h('span', { class: 'eyebrow' }, 'Fléchettes · X01'),
      h('h1', {}, 'DartCam'),
      h('p', {}, 'Le score de tes fléchettes, compté par la caméra.'),
    ),
    resume,
    h(
      'button',
      { class: `cta${g ? ' second' : ''}`, onclick: () => nav('setup') },
      h('span', { class: 'cta-ic' }, icon('play', 24)),
      h('span', { class: 'cta-text' }, h('b', {}, 'Nouvelle partie'), h('small', {}, `${cfg.start} · ${cfg.doubleOut ? 'double out' : 'sortie libre'} · ${players}`)),
      h('span', { class: 'cta-go' }, icon('back', 20)),
    ),
    h(
      'nav',
      { class: 'bento' },
      tile('target', 'Vérifier la cible', 'Caméra et repères', () => nav('calibrate')),
      tile('help', 'Placer le téléphone', 'Conseils trépied', () => nav('help')),
      Object.assign(tile('settings', 'Réglages', 'Voix, précision, données', () => nav('settings')), { className: 'tile wide' }),
    ),
    installCard(),
    h('p', { class: 'status-pill' }, h('i', {}), status),
  );
}
