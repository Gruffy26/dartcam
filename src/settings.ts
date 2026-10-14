import { DEFAULT_PARAMS, type DetectorParams } from './detector/params';
import { loadJSON, saveJSON } from './storage';

export interface Settings {
  /** Source d'images : caméra arrière ou vidéo de test chargée depuis le téléphone. */
  source: 'camera' | 'video';
  /** Zoom de la caméra (1 = pas de zoom). Toute modification impose de recalibrer. */
  zoom: number;
  /** Affiche le masque, la droite ajustée, la vue redressée et les mesures. */
  debug: boolean;
  /** Réglages fins de la détection. */
  detector: DetectorParams;
  /** Annonce vocale du score de chaque volée. */
  voice: boolean;
  /** Garde les images des fléchettes sur le téléphone, pour améliorer la détection. */
  collect: boolean;
}

const KEY = 'dartcam.settings';
const DEFAULTS: Settings = { source: 'camera', zoom: 1, debug: false, detector: DEFAULT_PARAMS, voice: true, collect: true };

export function getSettings(): Settings {
  const saved = loadJSON<Partial<Settings>>(KEY, {});
  return { ...DEFAULTS, ...saved, detector: { ...DEFAULT_PARAMS, ...(saved.detector ?? {}) } };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  saveJSON(KEY, next);
  return next;
}
