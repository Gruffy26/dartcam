// Bloc « caméra plein écran » réutilisé par la calibration et la partie :
// ouverture de la source (caméra / vidéo de test), zoom, messages d'erreur,
// écran maintenu allumé, reprise après passage en arrière-plan.

import { h } from './dom';
import { containRect } from './frameview';
import type { Nav } from './main';
import { getSettings, updateSettings } from './settings';
import { openCamera, openVideoFile, SourceError, type FrameSource } from './source';
import { keepScreenOn } from './wakelock';
import { cropRect, formatZoom, type Rect } from './zoom';

export interface FrameInfo {
  /** Taille de la vidéo source (pixels). */
  vw: number;
  vh: number;
  /** Partie de la vidéo réellement analysée (zoom numérique). */
  crop: Rect;
  /** Rectangle du cadre analysé à l'écran, relatif au bloc. */
  screen: Rect;
}

export interface CameraStage {
  el: HTMLElement;
  /** Zone en bas de l'écran où chaque écran ajoute ses boutons / infos (sous la barre de zoom). */
  dock: HTMLElement;
  zoomBar: HTMLElement;
  readonly source: FrameSource | null;
  frame(): FrameInfo | null;
  zoomValue(): number;
  /** Appelé quand la source change (nouvelle caméra, nouvelle vidéo) ou que le zoom change. */
  onChange(cb: (reason: 'source' | 'zoom') => void): void;
  dispose(): void;
}

export function createCameraStage(nav: Nav): CameraStage {
  let source: FrameSource | null = null;
  let disposed = false;
  const listeners: ((reason: 'source' | 'zoom') => void)[] = [];
  const emit = (reason: 'source' | 'zoom') => listeners.forEach((cb) => cb(reason));

  const stage = h('div', { class: 'stage' });
  const message = h('div', { class: 'message hidden' });
  const fileInput = h('input', { type: 'file', accept: 'video/*,.mov,.mp4', class: 'hidden' });
  const sourceBtn = h('button', { class: 'pill' });
  const zoomSlider = h('input', { type: 'range', class: 'zoom-slider', 'aria-label': 'Zoom' });
  const zoomLabel = h('span', { class: 'zoom-value' });
  const zoomMode = h('small', { class: 'zoom-mode' });
  const zoomBar = h(
    'div',
    { class: 'zoombar no-zoom' },
    h('button', { class: 'zoom-btn', 'aria-label': 'Dézoomer', onclick: () => void stepZoom(-1) }, '−'),
    zoomSlider,
    h('button', { class: 'zoom-btn', 'aria-label': 'Zoomer', onclick: () => void stepZoom(1) }, '+'),
    h('div', { class: 'zoom-info' }, zoomLabel, zoomMode),
  );
  const dock = h('div', { class: 'dock' }, zoomBar);

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
    dock,
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
    refreshZoom();
    emit('source');
    if (s.kind === 'video') {
      s.video.onended = () =>
        showMessage('Fin de la vidéo.', [
          h('button', {
            class: 'big primary',
            onclick: () => {
              hideMessage();
              s.video.currentTime = 0;
              void s.video.play();
              emit('source'); // on repart de zéro : cible, référence, volée
            },
          }, 'Rejouer'),
          h('button', { class: 'big', onclick: () => fileInput.click() }, 'Choisir une autre vidéo'),
        ]);
    }
  }

  // --- Zoom ---------------------------------------------------------------
  function refreshZoom() {
    const z = source?.zoom;
    zoomBar.classList.toggle('no-zoom', !z);
    if (!z || !source) return;
    zoomSlider.min = String(z.min);
    zoomSlider.max = String(z.max);
    zoomSlider.step = String(z.step);
    zoomSlider.value = String(z.value);
    zoomLabel.textContent = formatZoom(z.value);
    zoomMode.textContent = z.mode === 'capteur' ? 'zoom caméra' : 'zoom numérique';
    // Zoom numérique : on agrandit l'affichage autour du centre, exactement comme
    // le recadrage appliqué à l'analyse (cropRect).
    source.video.style.transform = z.digital > 1 ? `scale(${z.digital})` : '';
  }

  async function setZoom(value: number) {
    const z = source?.zoom;
    if (!z) return;
    await z.set(value);
    updateSettings({ zoom: z.value });
    refreshZoom();
    emit('zoom');
  }

  function stepZoom(dir: 1 | -1) {
    const z = source?.zoom;
    if (z) return setZoom(Math.round((z.value + dir * 0.5) * 10) / 10);
  }

  zoomSlider.addEventListener('input', () => void setZoom(Number(zoomSlider.value)));

  // --- Source ---------------------------------------------------------------
  async function start() {
    stopSource();
    emit('source');
    const mode = getSettings().source;
    sourceBtn.textContent = mode === 'camera' ? '📷 Caméra' : '🎞 Vidéo de test';
    if (mode === 'camera') {
      showMessage('Ouverture de la caméra…');
      try {
        attach(await openCamera(getSettings().zoom));
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

  keepScreenOn(true);
  void start();

  return {
    el,
    dock,
    zoomBar,
    get source() {
      return source;
    },
    frame() {
      const v = source?.video;
      if (!v || v.readyState < 2 || !v.videoWidth) return null;
      const crop = cropRect(v.videoWidth, v.videoHeight, source?.zoom?.digital ?? 1);
      return {
        vw: v.videoWidth,
        vh: v.videoHeight,
        crop,
        screen: containRect(el.clientWidth, el.clientHeight, v.videoWidth, v.videoHeight),
      };
    },
    zoomValue: () => source?.zoom?.value ?? 1,
    onChange: (cb) => void listeners.push(cb),
    dispose() {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      keepScreenOn(false);
      stopSource();
    },
  };
}
