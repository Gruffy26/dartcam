import { h } from '../dom';
import type { Nav } from '../main';
import { getSettings, updateSettings, type Settings } from '../settings';

export function settingsScreen(nav: Nav): HTMLElement {
  const choice = (value: Settings['source'], label: string, hint: string) =>
    h(
      'label',
      { class: 'choice' },
      h('input', {
        type: 'radio',
        name: 'source',
        value,
        checked: getSettings().source === value,
        onchange: () => updateSettings({ source: value }),
      }),
      h('span', {}, h('b', {}, label), h('small', {}, hint)),
    );

  return h(
    'main',
    { class: 'screen settings' },
    h('header', {}, h('button', { class: 'back', onclick: () => nav('home') }, '‹ Retour'), h('h2', {}, 'Réglages')),
    h(
      'section',
      {},
      h('h3', {}, 'Source des images'),
      choice('camera', 'Caméra arrière', 'Pour jouer.'),
      choice('video', 'Vidéo de test', 'Une vidéo .mov / .mp4 filmée depuis le trépied, pour tester sans lancer de fléchettes.'),
    ),
    h(
      'section',
      {},
      h('h3', {}, 'À propos'),
      h('p', { class: 'muted' }, `Version : ${__BUILD_ID__}`),
      h('button', { class: 'big', onclick: () => location.reload() }, 'Recharger l’app'),
    ),
  );
}
