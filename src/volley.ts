// Volée de 3 fléchettes : fléchettes détectées, ajoutées, corrigées ou annulées.
// Module pur (sans écran), testé.

import { MISS, type Score } from './board';
import type { Pt } from './homography';

export type DartOrigin = 'auto' | 'manual' | 'miss';

export interface DartRecord {
  id: number;
  score: Score;
  /** Pointe à l'image (pixels de l'image analysée), si connue. */
  tip: Pt | null;
  /** Position sur la cible (mm), si connue. */
  board: Pt | null;
  origin: DartOrigin;
  /** Score corrigé à la main après une détection automatique. */
  corrected: boolean;
  /** Score donné par la détection automatique (avant correction éventuelle). */
  autoScore: Score | null;
  /** Pointe très proche d'un fil : score à vérifier. */
  uncertain?: boolean;
}

export const DARTS_PER_VOLLEY = 3;

let nextId = 1;

export class Volley {
  darts: DartRecord[] = [];

  get full(): boolean {
    return this.darts.length >= DARTS_PER_VOLLEY;
  }

  get total(): number {
    return this.darts.reduce((s, d) => s + d.score.points, 0);
  }

  get last(): DartRecord | null {
    return this.darts[this.darts.length - 1] ?? null;
  }

  private push(d: Omit<DartRecord, 'id'>): DartRecord | null {
    if (this.full) return null;
    const rec = { ...d, id: nextId++ };
    this.darts.push(rec);
    return rec;
  }

  /** Fléchette trouvée par la détection automatique. */
  addDetected(score: Score, tip: Pt, board: Pt): DartRecord | null {
    return this.push({ score, tip, board, origin: 'auto', corrected: false, autoScore: score });
  }

  /** Fléchette oubliée par la détection, ajoutée en touchant l'image. */
  addManual(score: Score, tip: Pt | null, board: Pt | null): DartRecord | null {
    return this.push({ score, tip, board, origin: 'manual', corrected: false, autoScore: null });
  }

  /** Fléchette hors cible ou tombée. */
  addMiss(): DartRecord | null {
    return this.push({ score: MISS, tip: null, board: null, origin: 'miss', corrected: false, autoScore: null });
  }

  /** Corrige une fléchette (par défaut la dernière) : nouvelle position et nouveau score. */
  correct(index: number, score: Score, tip: Pt | null, board: Pt | null): DartRecord | null {
    const d = this.darts[index];
    if (!d) return null;
    d.score = score;
    d.tip = tip;
    d.board = board;
    if (d.origin === 'auto') d.corrected = true;
    return d;
  }

  /** Annule la dernière fléchette. */
  undo(): DartRecord | null {
    return this.darts.pop() ?? null;
  }
}
