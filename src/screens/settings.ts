import { DEFAULT_PARAMS, PARAM_SPECS, type DetectorParams } from '../detector/params';
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

  const toggle = (label: string, hint: string, checked: boolean, onchange: (v: boolean) => void) => {
    const input = h('input', { type: 'checkbox', class: 'switch', checked });
    input.addEventListener('change', () => onchange(input.checked));
    return h('label', { class: 'choice' }, input, h('span', {}, h('b', {}, label), h('small', {}, hint)));
  };

  // Curseurs des réglages de détection.
  const sliders = h('div', { class: 'sliders' });
  function renderSliders() {
    const p = getSettings().detector;
    sliders.replaceChildren(
      ...(Object.keys(PARAM_SPECS) as (keyof DetectorParams)[]).map((k) => {
        const spec = PARAM_SPECS[k];
        const value = h('output', {}, fmt(p[k], spec.unit));
        const input = h('input', {
          type: 'range',
          min: String(spec.min),
          max: String(spec.max),
          step: String(spec.step),
          value: String(p[k]),
        });
        input.addEventListener('input', () => {
          const v = Number(input.value);
          value.textContent = fmt(v, spec.unit);
          updateSettings({ detector: { ...getSettings().detector, [k]: v } });
        });
        return h('label', { class: 'slider' }, h('span', {}, spec.label, value), input);
      }),
    );
  }
  renderSliders();

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
      h('h3', {}, 'Détection'),
      toggle('Debug', 'Affiche le masque des changements, la fléchette trouvée, la vue de face et les mesures.', getSettings().debug, (v) =>
        updateSettings({ debug: v }),
      ),
      h('details', { class: 'advanced' }, h('summary', {}, 'Réglages avancés'), sliders,
        h('button', {
          class: 'big',
          onclick: () => {
            updateSettings({ detector: { ...DEFAULT_PARAMS } });
            renderSliders();
          },
        }, 'Valeurs par défaut'),
      ),
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

function fmt(v: number, unit: string): string {
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
  return unit ? `${s} ${unit}` : s;
}
