import { DEFAULT_PARAMS, PARAM_SPECS, type DetectorParams } from '../detector/params';
import { h } from '../dom';
import type { Nav } from '../main';
import { getSettings, updateSettings } from '../settings';
import { appBar, group, row, segmented, toggle } from '../ui';

export function settingsScreen(nav: Nav): HTMLElement {
  const s = getSettings();

  // Curseurs des réglages de détection.
  const sliders = h('div', { class: 'stack' });
  function renderSliders() {
    const p = getSettings().detector;
    sliders.replaceChildren(
      ...(Object.keys(PARAM_SPECS) as (keyof DetectorParams)[]).map((k) => {
        const spec = PARAM_SPECS[k];
        const value = h('output', {}, fmt(p[k], spec.unit));
        const input = h('input', { type: 'range', min: String(spec.min), max: String(spec.max), step: String(spec.step), value: String(p[k]) });
        input.addEventListener('input', () => {
          const v = Number(input.value);
          value.textContent = fmt(v, spec.unit);
          updateSettings({ detector: { ...getSettings().detector, [k]: v } });
        });
        return h('label', { class: 'slider' }, h('span', {}, spec.label, value), input);
      }),
      h(
        'button',
        {
          class: 'btn ghost block',
          onclick: () => {
            updateSettings({ detector: { ...DEFAULT_PARAMS } });
            renderSliders();
          },
        },
        'Valeurs par défaut',
      ),
    );
  }
  renderSliders();
  const advanced = h('div', { class: 'hidden' }, group('Réglages avancés de la détection', sliders));
  const advRow = row('Réglages avancés', 'Seuils de la détection', null, () => {
    advanced.classList.toggle('hidden');
  });

  return h(
    'main',
    { class: 'page settings' },
    appBar({ title: 'Réglages', onBack: () => nav('home') }),
    group(
      'Source des images',
      segmented(
        [
          { value: 'camera', label: 'Caméra' },
          { value: 'video', label: 'Vidéo de test' },
        ],
        s.source,
        (v) => updateSettings({ source: v as 'camera' | 'video' }),
      ),
    ),
    group(
      'Partie',
      row('Annonce vocale', 'Score de chaque volée à voix haute', toggle(s.voice, (v) => updateSettings({ voice: v }), 'Annonce vocale')),
    ),
    group(
      'Détection',
      row('Mode debug', 'Masque, fléchette trouvée, vue de face, mesures', toggle(s.debug, (v) => updateSettings({ debug: v }), 'Mode debug')),
      advRow,
    ),
    advanced,
    group('À propos', row('Version', __BUILD_ID__, null), row('Recharger l’app', 'Pour récupérer la dernière version', null, () => location.reload())),
  );
}

function fmt(v: number, unit: string): string {
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
  return unit ? `${s} ${unit}` : s;
}
