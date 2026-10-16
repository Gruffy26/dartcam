// Petits sons de confirmation, synthétisés (aucun fichier à télécharger).
//
// À 2,50 m de la cible, on ne voit pas l'écran : un « tic » dit que la fléchette a été
// comptée, et deux notes que la volée est finie. Comme la voix, le son doit être
// débloqué par un toucher sur iPhone.

import { getSettings } from './settings';

let ctx: AudioContext | null = null;

/** À appeler depuis un vrai toucher (bouton « Commencer »), sinon iOS reste muet. */
export function unlockSound(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** Une note courte. `freq` en hertz, `ms` en millisecondes. */
function beep(freq: number, ms: number, delay = 0, gain = 0.07): void {
  if (!ctx || ctx.state !== 'running') return;
  try {
    const t0 = ctx.currentTime + delay / 1000;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // Enveloppe douce : un créneau brut « claque » dans le haut-parleur du téléphone.
    vol.gain.setValueAtTime(0.0001, t0);
    vol.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    vol.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(vol).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  } catch {
    /* le son n'est jamais indispensable */
  }
}

/** Fléchette comptée. */
export function tick(): void {
  if (getSettings().sounds) beep(880, 90);
}

/** Fléchette comptée mais à vérifier. */
export function tickDoubt(): void {
  if (!getSettings().sounds) return;
  beep(660, 90);
  beep(520, 110, 110);
}

/** Volée terminée. */
export function endVolley(): void {
  if (!getSettings().sounds) return;
  beep(740, 110);
  beep(988, 160, 120);
}
