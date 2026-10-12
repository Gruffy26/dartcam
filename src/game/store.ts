// Sauvegarde de la partie en cours sur le téléphone, pour la reprendre si l'app est
// fermée (y compris la volée en cours).

import type { DartRecord } from '../volley';
import { loadJSON, removeKey, saveJSON } from '../storage';
import type { GameConfig, GameState } from './x01';

const KEY = 'dartcam.game';
const CONFIG_KEY = 'dartcam.lastConfig';

export interface SavedGame {
  state: GameState;
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

export function saveLastConfig(c: GameConfig): void {
  saveJSON(CONFIG_KEY, c);
}

export function lastConfig(): GameConfig {
  return loadJSON<GameConfig>(CONFIG_KEY, { start: 501, doubleOut: true, players: ['Joueur 1'] });
}
