import { loadJSON, saveJSON } from './storage';

export interface Settings {
  /** Source d'images : caméra arrière ou vidéo de test chargée depuis le téléphone. */
  source: 'camera' | 'video';
  /** Zoom de la caméra (1 = pas de zoom). Toute modification impose de recalibrer. */
  zoom: number;
}

const KEY = 'dartcam.settings';
const DEFAULTS: Settings = { source: 'camera', zoom: 1 };

export function getSettings(): Settings {
  return { ...DEFAULTS, ...loadJSON<Partial<Settings>>(KEY, {}) };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  saveJSON(KEY, next);
  return next;
}
