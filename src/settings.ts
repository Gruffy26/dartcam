import { loadJSON, saveJSON } from './storage';

export interface Settings {
  /** Source d'images : caméra arrière ou vidéo de test chargée depuis le téléphone. */
  source: 'camera' | 'video';
}

const KEY = 'dartcam.settings';
const DEFAULTS: Settings = { source: 'camera' };

export function getSettings(): Settings {
  return { ...DEFAULTS, ...loadJSON<Partial<Settings>>(KEY, {}) };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  saveJSON(KEY, next);
  return next;
}
