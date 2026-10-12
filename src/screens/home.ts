import { h } from '../dom';
import type { Nav } from '../main';

export function homeScreen(nav: Nav): HTMLElement {
  return h(
    'main',
    { class: 'screen home' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '' }), h('h1', {}, 'DartCam')),
    h(
      'div',
      { class: 'menu' },
      h('button', { class: 'big primary', onclick: () => nav('game') }, 'Nouvelle partie'),
      h('button', { class: 'big', onclick: () => nav('calibrate') }, 'Calibrer la cible'),
      h('button', { class: 'big', onclick: () => nav('settings') }, 'Réglages'),
      h('button', { class: 'link', onclick: () => nav('help') }, 'Comment placer le téléphone ?'),
    ),
  );
}
