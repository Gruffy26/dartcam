import { h } from '../dom';
import type { Nav, Screen } from '../main';
import { loadOpenCV, type CV } from '../opencv';
import { getSettings, updateSettings } from '../settings';
import { openCamera, openVideoFile, SourceError, type FrameSource } from '../source';
import { isScreenKeptOn, keepScreenOn } from '../wakelock';

/** Largeur des images analysées : assez pour viser, assez léger pour l'iPhone. */
export const ANALYSIS_WIDTH = 640;
const ANALYSIS_INTERVAL_MS = 100; // ≈10 analyses par seconde

const PURPOSE_TEXT = {
  calibrate: 'Calibration — arrive à l’étape 3. Pour l’instant : vérifie que toute la cible est dans l’image.',
  game: 'Partie — arrive aux étapes 4 à 6. Pour l’instant : test de la caméra et de l’analyse.',
};

export function viewerScreen(nav: Nav, purpose: 'calibrate' | 'game'): Screen {
  let source: FrameSource | null = null;
  let disposed = false;
  let timer = 0;

  const stage = h('div', { class: 'stage' });
  const stats = h('div', { class: 'stats' }, 'Démarrage…');
  const message = h('div', { class: 'message hidden' });
  const fileInput = h('input', { type: 'file', accept: 'video/*,.mov,.mp4', class: 'hidden' });
  const sourceBtn = h('button', { class: 'pill' });

  const el = h(
    'main',
    { class: 'viewer' },
    stage,
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'pill', onclick: () => nav('home') }, '‹ Accueil'),
      sourceBtn,
    ),
    h('div', { class: 'note' }, PURPOSE_TEXT[purpose]),
    stats,
    message,
    fileInput,
  );

  function showMessage(text: string, actions: HTMLElement[] = []) {
    message.replaceChildren(h('p', {}, text), ...actions);
    message.classList.remove('hidden');
  }
  function hideMessage() {
    message.classList.add('hidden');
  }

  function stopSource() {
    source?.stop();
    source = null;
    stage.replaceChildren();
  }

  function attach(s: FrameSource) {
    if (disposed) return s.stop();
    source = s;
    stage.replaceChildren(s.video);
    hideMessage();
  }

  async function start() {
    stopSource();
    const mode = getSettings().source;
    sourceBtn.textContent = mode === 'camera' ? '📷 Caméra' : '🎞 Vidéo de test';
    if (mode === 'camera') {
      showMessage('Ouverture de la caméra…');
      try {
        attach(await openCamera());
      } catch (e) {
        const text = e instanceof SourceError ? e.message : String(e);
        showMessage(text, [
          h('button', { class: 'big primary', onclick: () => void start() }, 'Réessayer'),
          h('button', { class: 'big', onclick: () => useVideo() }, 'Utiliser une vidéo de test'),
        ]);
      }
    } else {
      showMessage('Choisis une vidéo filmée depuis le trépied (.mov ou .mp4).', [
        h('button', { class: 'big primary', onclick: () => fileInput.click() }, 'Choisir une vidéo'),
      ]);
    }
  }

  function useVideo() {
    updateSettings({ source: 'video' });
    void start();
  }

  sourceBtn.addEventListener('click', () => {
    updateSettings({ source: getSettings().source === 'camera' ? 'video' : 'camera' });
    void start();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    stopSource();
    showMessage('Chargement de la vidéo…');
    try {
      attach(await openVideoFile(file));
    } catch (e) {
      showMessage(e instanceof SourceError ? e.message : String(e), [
        h('button', { class: 'big primary', onclick: () => fileInput.click() }, 'Choisir une autre vidéo'),
      ]);
    }
  });

  // iOS coupe la caméra quand l'app passe en arrière-plan : on la relance au retour.
  function onVisibility() {
    if (document.visibilityState !== 'visible' || source?.kind !== 'camera') return;
    const stream = source.video.srcObject as MediaStream | null;
    if (!stream || stream.getVideoTracks().every((t) => t.readyState === 'ended')) void start();
    else void source.video.play().catch(() => {});
  }
  document.addEventListener('visibilitychange', onVisibility);

  // Boucle d'analyse de test : image réduite à 640 px → niveaux de gris avec OpenCV.
  // Sert à mesurer la vitesse sur l'iPhone ; la détection viendra s'y brancher.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let frames = 0;
  let fps = 0;
  let lastFpsT = performance.now();

  function analyse(cv: CV) {
    const v = source?.video;
    if (!v || v.readyState < 2 || !v.videoWidth) {
      stats.textContent = 'En attente d’images…';
      return;
    }
    const w = ANALYSIS_WIDTH;
    const hgt = Math.round((v.videoHeight * w) / v.videoWidth);
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w;
      canvas.height = hgt;
    }
    const t0 = performance.now();
    ctx.drawImage(v, 0, 0, w, hgt);
    const img = ctx.getImageData(0, 0, w, hgt);
    const t1 = performance.now();
    const rgba = cv.matFromImageData(img);
    const gray = new cv.Mat();
    let brightness = 0;
    try {
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      brightness = cv.mean(gray)[0];
    } finally {
      rgba.delete();
      gray.delete();
    }
    const t2 = performance.now();

    frames++;
    const now = performance.now();
    if (now - lastFpsT >= 1000) {
      fps = (frames * 1000) / (now - lastFpsT);
      frames = 0;
      lastFpsT = now;
    }
    stats.textContent =
      `Source ${v.videoWidth}×${v.videoHeight} · analyse ${w}×${hgt} · ` +
      `${fps.toFixed(1)} img/s · capture ${(t1 - t0).toFixed(1)} ms + OpenCV ${(t2 - t1).toFixed(1)} ms · luminosité ${brightness.toFixed(0)} · ` +
      `écran maintenu allumé : ${isScreenKeptOn() ? 'oui' : 'non'}`;
  }

  void loadOpenCV().then((cv) => {
    const loop = () => {
      if (disposed) return;
      const start = performance.now();
      try {
        analyse(cv);
      } catch (e) {
        stats.textContent = `Erreur d’analyse : ${String(e)}`;
      }
      // Cadence visée : une analyse toutes les 100 ms, temps de calcul compris.
      const spent = performance.now() - start;
      timer = window.setTimeout(loop, Math.max(10, ANALYSIS_INTERVAL_MS - spent));
    };
    loop();
  });

  keepScreenOn(true);
  void start();

  return {
    el,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      keepScreenOn(false);
      stopSource();
    },
  };
}
