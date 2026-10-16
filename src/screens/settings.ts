import { DEFAULT_PARAMS, PARAM_SPECS, type DetectorParams } from '../detector/params';
import { h } from '../dom';
import { icon } from '../icons';
import type { Nav } from '../main';
import { getSettings, updateSettings } from '../settings';
import { buildExport, clearSamples, download, sampleCount } from '../dataset';
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

  // Collecte d'exemples : nombre gardé, export en ZIP, effacement.
  const countRow = row('Exemples enregistrés', 'Chargement…', null);
  const sub = () => countRow.querySelector('.row-sub');
  const refresh = () => {
    void sampleCount().then((n) => {
      const el = sub();
      if (el) el.textContent = n ? `${n} fléchette${n > 1 ? 's' : ''} gardée${n > 1 ? 's' : ''} sur le téléphone` : 'Aucun exemple pour le moment';
      exportBtn.disabled = n === 0;
      clearBtn.disabled = n === 0;
    });
  };
  const exportBtn = h('button', { class: 'btn primary block' }, icon('download', 20), 'Exporter en ZIP');
  exportBtn.addEventListener('click', () => {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Préparation…';
    void buildExport().then((res) => {
      exportBtn.replaceChildren(icon('download', 20), document.createTextNode('Exporter en ZIP'));
      exportBtn.disabled = false;
      if (res) download(res.blob, res.name);
    });
  });
  const clearBtn = h('button', { class: 'btn danger block' }, icon('trash', 20), 'Effacer les exemples');
  clearBtn.addEventListener('click', () => {
    if (!confirm('Effacer tous les exemples enregistrés ?')) return;
    void clearSamples().then(refresh);
  });
  refresh();

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
      'Précision de l’analyse',
      segmented(
        [
          { value: '640', label: 'Normale' },
          { value: '960', label: 'Élevée' },
          { value: '1280', label: 'Maximale' },
        ],
        String(s.analysisWidth),
        (v) => updateSettings({ analysisWidth: Number(v) }),
      ),
      row(
        'Plus large, plus juste',
        'C’est le réglage qui pèse le plus sur la justesse des scores, sans jamais dépasser ce que la caméra fournit. Si le téléphone ne suit pas, l’app redescend toute seule pendant la partie.',
        null,
      ),
    ),
    group(
      'Détection',
      row('Mode debug', 'Masque, fléchette trouvée, vue de face, mesures', toggle(s.debug, (v) => updateSettings({ debug: v }), 'Mode debug')),
      advRow,
    ),
    advanced,
    group(
      'Amélioration de la détection',
      row('Garder les images', 'Reste sur le téléphone, rien n’est envoyé', toggle(s.collect, (v) => updateSettings({ collect: v }), 'Garder les images')),
      countRow,
      exportBtn,
      clearBtn,
    ),
    group('À propos', row('Version', __BUILD_ID__, null), row('Recharger l’app', 'Pour récupérer la dernière version', null, () => location.reload())),
  );
}

function fmt(v: number, unit: string): string {
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
  return unit ? `${s} ${unit}` : s;
}
