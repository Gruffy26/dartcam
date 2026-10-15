import { h } from '../dom';
import type { Nav } from '../main';
import { appBar } from '../ui';

// Schéma vu de dessus : la cible au mur, le téléphone sur trépied à 30–50° de l'axe.
const SCHEMA = `
<svg viewBox="0 0 320 230" role="img" aria-label="Vue de dessus : téléphone placé à 30 à 50 degrés de l'axe de la cible">
  <rect x="0" y="0" width="320" height="16" fill="#555"/>
  <text x="160" y="12" text-anchor="middle" font-size="11" fill="#ddd">MUR</text>
  <rect x="110" y="16" width="100" height="10" rx="2" fill="#d62828"/>
  <text x="160" y="42" text-anchor="middle" font-size="12" fill="#eee">cible</text>
  <line x1="160" y1="26" x2="160" y2="225" stroke="#888" stroke-dasharray="5 5"/>
  <text x="166" y="220" font-size="11" fill="#aaa">axe de la cible</text>
  <path d="M160 26 L160 230 A204 204 0 0 1 28 182 Z" fill="#2a9d8f" opacity="0.25"/>
  <path d="M160 26 L58 203" stroke="#2a9d8f" stroke-width="2"/>
  <path d="M160 26 L29 182" stroke="#2a9d8f" stroke-width="2"/>
  <text x="70" y="140" font-size="13" fill="#2a9d8f" font-weight="bold">30–50°</text>
  <rect x="34" y="186" width="30" height="18" rx="4" fill="#eee" transform="rotate(-40 49 195)"/>
  <text x="18" y="224" font-size="12" fill="#eee">iPhone sur trépied</text>
</svg>`;

export function helpScreen(nav: Nav): HTMLElement {
  const schema = h('div', { class: 'schema' });
  schema.innerHTML = SCHEMA;
  return h(
    'main',
    { class: 'page help' },
    appBar({ title: 'Placer le téléphone', onBack: () => nav('home') }),
    schema,
    h(
      'ul',
      { class: 'tips group-body' },
      h('li', {}, h('b', {}, 'Hauteur : '), 'objectif à peu près à la hauteur du centre (bull).'),
      h(
        'li',
        {},
        h('b', {}, 'Angle : '),
        'nettement sur le côté, à gauche ou à droite, entre 25 et 50° de l’axe de la cible. C’est le réglage le plus important : ',
        h('b', {}, 'presque en face, la moitié des fléchettes sont mal comptées'),
        ' (vue dans l’axe, la fléchette pointe vers l’objectif et ne se voit presque plus).',
      ),
      h('li', {}, h('b', {}, 'Distance : '), 'de 80 cm à 1,70 m de la cible ; l’app affiche l’angle et la distance après la détection.'),
      h('li', {}, h('b', {}, 'Droit : '), 'le téléphone bien vertical sur le trépied (pas penché de côté).'),
      h('li', {}, h('b', {}, 'Cadrage : '), 'toute la cible visible, avec un peu de marge autour.'),
      h('li', {}, h('b', {}, 'Lumière : '), 'cible bien éclairée, sans fenêtre ni lampe dans le dos de la cible (pas de contre-jour).'),
      h('li', {}, h('b', {}, 'Stabilité : '), 'ne touche plus au trépied après la calibration.'),
      h('li', {}, h('b', {}, 'Batterie : '), 'branche l’iPhone pendant les parties.'),
    ),
    h('button', { class: 'btn primary lg block', onclick: () => nav('calibrate') }, 'Vérifier la cible'),
  );
}
