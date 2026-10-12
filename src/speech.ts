// Annonces vocales en français (Web Speech API). Silencieux si non supporté ou désactivé.

import { getSettings } from './settings';

let voice: SpeechSynthesisVoice | null = null;

function pickVoice() {
  const voices = globalThis.speechSynthesis?.getVoices() ?? [];
  voice = voices.find((v) => v.lang === 'fr-FR' && v.localService) ?? voices.find((v) => v.lang.startsWith('fr')) ?? null;
}
try {
  pickVoice();
  globalThis.speechSynthesis?.addEventListener?.('voiceschanged', pickVoice);
} catch {
  /* pas de synthèse vocale */
}

export function speak(text: string): void {
  if (!getSettings().voice) return;
  try {
    const synth = globalThis.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    if (voice) u.voice = voice;
    u.rate = 1;
    synth.speak(u);
  } catch {
    /* ignoré */
  }
}

/**
 * Sur iPhone, la voix ne marche qu'après une première annonce déclenchée par un toucher.
 * À appeler dans le gestionnaire du bouton « Commencer ».
 */
export function unlockSpeech(firstWords: string): void {
  speak(firstWords);
}
