// Zoom de la caméra.
// - « capteur » : zoom natif de l'iPhone via applyConstraints, quand Safari le permet
//   (meilleure qualité : l'image reçue est déjà zoomée).
// - « numérique » : sinon, on recadre le centre de l'image nous-mêmes, à l'affichage
//   comme à l'analyse, pour que les deux correspondent toujours.

export const DIGITAL_ZOOM_MAX = 3;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Partie de l'image source réellement utilisée pour un zoom numérique donné (recadrage centré). */
export function cropRect(width: number, height: number, digitalZoom: number): Rect {
  const z = Math.max(1, digitalZoom);
  const w = width / z;
  const h = height / z;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

export function clampZoom(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatZoom(value: number): string {
  return `${value.toFixed(1).replace('.', ',')}×`;
}

export interface ZoomControl {
  mode: 'capteur' | 'numérique';
  min: number;
  max: number;
  step: number;
  value: number;
  /** Zoom numérique à appliquer à l'affichage et à l'analyse (1 en mode capteur). */
  digital: number;
  set(value: number): Promise<void>;
}

type ZoomCaps = { min: number; max: number; step?: number };

export function createZoomControl(track: MediaStreamTrack | null, initial: number): ZoomControl {
  const caps = (track?.getCapabilities?.() as { zoom?: ZoomCaps } | undefined)?.zoom;
  if (track && caps && caps.max > caps.min) {
    const ctl: ZoomControl = {
      mode: 'capteur',
      min: caps.min,
      max: Math.min(caps.max, 10),
      step: caps.step && caps.step > 0 ? Math.max(caps.step, 0.1) : 0.1,
      value: clampZoom(initial, caps.min, Math.min(caps.max, 10)),
      digital: 1,
      async set(v) {
        const next = clampZoom(v, ctl.min, ctl.max);
        try {
          await track.applyConstraints({ advanced: [{ zoom: next } as MediaTrackConstraintSet] });
          ctl.value = next;
        } catch {
          /* le zoom reste à sa valeur précédente */
        }
      },
    };
    return ctl;
  }
  const ctl: ZoomControl = {
    mode: 'numérique',
    min: 1,
    max: DIGITAL_ZOOM_MAX,
    step: 0.1,
    value: clampZoom(initial, 1, DIGITAL_ZOOM_MAX),
    digital: 1,
    async set(v) {
      ctl.value = clampZoom(v, 1, DIGITAL_ZOOM_MAX);
      ctl.digital = ctl.value;
    },
  };
  ctl.digital = ctl.value;
  return ctl;
}
