// Sauvegarde de la partie en cours sur le téléphone, pour la reprendre si l'app est
// fermée (y compris la volée en cours).

import type { AnyConfig, AnyState } from './engine';
import type { DartRecord } from '../volley';
import { loadJSON, removeKey, saveJSON } from '../storage';

const KEY = 'dartcam.game';
const CONFIG_KEY = 'dartcam.lastConfig';

export interface SavedGame {
  state: AnyState;
  /** Fléchettes de la volée en cours (pas encore enregistrée). */
  pending: DartRecord[];
}

export function saveGame(g: SavedGame): void {
  saveJSON(KEY, g);
}

export function loadGame(): SavedGame | null {
  const g = loadJSON<SavedGame | null>(KEY, null);
  return g && g.state?.version === 1 && Array.isArray(g.state.turns) ? g : null;
}

/** Partie commencée et pas encore gagnée. */
export function gameInProgress(): SavedGame | null {
  const g = loadGame();
  return g && g.state.winner == null ? g : null;
}

export function clearGame(): void {
  removeKey(KEY);
}

export function saveLastConfig(c: AnyConfig): void {
  saveJSON(CONFIG_KEY, c);
}

const DEFAULT_CONFIG: AnyConfig = { mode: 'x01', start: 501, doubleOut: true, players: ['Joueur 1'] };

export function lastConfig(): AnyConfig {
  const c = loadJSON<Partial<AnyConfig>>(CONFIG_KEY, {});
  return { ...DEFAULT_CONFIG, ...c, players: c.players?.length ? c.players : [...DEFAULT_CONFIG.players] };
}
