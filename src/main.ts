import './style.css';
import { h, mount } from './dom';
import { loadOpenCV } from './opencv';
import { calibrateScreen } from './screens/calibrate';
import { helpScreen } from './screens/help';
import { homeScreen } from './screens/home';
import { settingsScreen } from './screens/settings';
import { setupScreen } from './screens/setup';
import { gameInProgress } from './game/store';
import { gameScreen } from './screens/game';

export type ScreenName = 'home' | 'help' | 'settings' | 'calibrate' | 'setup' | 'game';
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
    case 'setup':
      return setupScreen(nav);
    case 'game':
      // La cible est détectée automatiquement à l'ouverture de la caméra.
      return gameScreen(nav);
  }
}

// Écran « Chargement… » tant qu'OpenCV n'est pas prêt (long seulement la 1re fois).
function boot() {
  mount(
    root,
    h('main', { class: 'loading' }, h('div', { class: 'spinner' }), h('p', {}, 'Chargement…'),
      h('p', { class: 'muted' }, 'La première ouverture télécharge environ 10 Mo.')),
  );
  loadOpenCV().then(
    // Partie en cours (app fermée puis rouverte) : on la reprend directement.
    () => nav(gameInProgress() ? 'game' : 'home'),
    (e: Error) =>
      mount(
        root,
        h('main', { class: 'loading' }, h('p', {}, e.message),
          h('button', { class: 'btn primary lg', onclick: boot }, 'Réessayer')),
      ),
  );
}

boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
