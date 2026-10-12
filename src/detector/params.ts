// Réglages de la détection (réglables dans « Réglages avancés »).

export interface DetectorParams {
  /** Durée sans mouvement avant d'analyser l'image (ms). */
  stableMs: number;
  /** Écart de luminosité (0–255) à partir duquel un pixel est considéré comme changé. */
  diffThreshold: number;
  /** Part de la cible (‰) qui doit changer entre deux images pour parler de mouvement. */
  motionPermille: number;
  /** Taille minimale d'une fléchette, en ‰ de la surface de la cible (en dessous : bruit). */
  minAreaPermille: number;
  /** Taille maximale, en ‰ de la surface de la cible (au-dessus : main, personne…). */
  maxAreaPermille: number;
  /** Marge autour du double (mm) où l'on accepte des changements. */
  marginMm: number;
}

export const DEFAULT_PARAMS: DetectorParams = {
  stableMs: 400,
  diffThreshold: 26,
  motionPermille: 1.5,
  minAreaPermille: 1.5,
  maxAreaPermille: 60,
  marginMm: 30,
};

/** Bornes et pas des curseurs, avec un libellé en français. */
export const PARAM_SPECS: Record<keyof DetectorParams, { label: string; min: number; max: number; step: number; unit: string }> = {
  stableMs: { label: 'Temps de stabilité', min: 100, max: 1500, step: 50, unit: 'ms' },
  diffThreshold: { label: 'Seuil de différence', min: 8, max: 80, step: 1, unit: '' },
  motionPermille: { label: 'Seuil de mouvement', min: 0.2, max: 10, step: 0.1, unit: '‰' },
  minAreaPermille: { label: 'Taille minimale d’une fléchette', min: 0.2, max: 10, step: 0.1, unit: '‰' },
  maxAreaPermille: { label: 'Taille maximale d’une fléchette', min: 10, max: 200, step: 5, unit: '‰' },
  marginMm: { label: 'Marge autour de la cible', min: 0, max: 100, step: 5, unit: 'mm' },
};
