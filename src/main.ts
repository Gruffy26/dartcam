import './style.css';
import { h, mount } from './dom';
import { loadOpenCV } from './opencv';
import { loadCalibration } from './calibration';
import { calibrateScreen } from './screens/calibrate';
import { helpScreen } from './screens/help';
import { homeScreen } from './screens/home';
import { settingsScreen } from './screens/settings';
import { viewerScreen } from './screens/viewer';
import { getSettings } from './settings';

export type ScreenName = 'home' | 'help' | 'settings' | 'calibrate' | 'game';
export type Nav = (name: ScreenName) => void;
export type Screen = HTMLElement | { el: HTMLElement; dispose(): void };

const root = document.getElementById('app')!;
let dispose: (() => void) | null = null;

const nav: Nav = (name) => {
  dispose?.();
  dispose = null;
  const screen = build(name);
  if (screen instanceof HTMLElement) mount(root, screen);
  else {
    mount(root, screen.el);
    dispose = () => screen.dispose();
  }
  window.scrollTo(0, 0);
};

function build(name: ScreenName): Screen {
  switch (name) {
    case 'home':
      return homeScreen(nav);
    case 'help':
      return helpScreen(nav);
    case 'settings':
      return settingsScreen(nav);
    case 'calibrate':
      return calibrateScreen(nav);
    case 'game':
      // Sans calibration, on commence par là.
      return hasCalibration() ? viewerScreen(nav) : calibrateScreen(nav);
  }
}

export function hasCalibration(): boolean {
  return loadCalibration(getSettings().source) != null;
}

// Écran « Chargement… » tant qu'OpenCV n'est pas prêt (long seulement la 1re fois).
function boot() {
  mount(
    root,
    h('main', { class: 'screen loading' }, h('div', { class: 'spinner' }), h('p', {}, 'Chargement…'),
      h('p', { class: 'muted' }, 'La première ouverture télécharge environ 10 Mo.')),
  );
  loadOpenCV().then(
    () => nav(hasCalibration() ? 'home' : 'calibrate'),
    (e: Error) =>
      mount(
        root,
        h('main', { class: 'screen loading' }, h('p', {}, e.message),
          h('button', { class: 'big primary', onclick: boot }, 'Réessayer')),
      ),
  );
}

boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
