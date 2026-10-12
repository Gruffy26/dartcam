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

/** « pinch » : début d'un pincement (annuler les gestes à un doigt en cours). */
export type ChangeReason = 'source' | 'zoom' | 'pinch';

export interface CameraStage {
  el: HTMLElement;
  /** Zone en bas de l'écran où chaque écran ajoute ses boutons / infos (sous la barre de zoom). */
  dock: HTMLElement;
  /** Pincement à deux doigts en cours (les écrans ignorent alors le toucher à un doigt). */
  readonly pinching: boolean;
  /** Active le zoom en pinçant à deux doigts sur cet élément. */
  enablePinch(target: HTMLElement): void;
  readonly source: FrameSource | null;
  frame(): FrameInfo | null;
  zoomValue(): number;
  /** Appelé quand la source change (nouvelle caméra, nouvelle vidéo) ou que le zoom change. */
  onChange(cb: (reason: ChangeReason) => void): void;
  dispose(): void;
}

export function createCameraStage(nav: Nav): CameraStage {
  let source: FrameSource | null = null;
  let disposed = false;
  const listeners: ((reason: ChangeReason) => void)[] = [];
  const emit = (reason: ChangeReason) => listeners.forEach((cb) => cb(reason));

  const stage = h('div', { class: 'stage' });
  const message = h('div', { class: 'message hidden' });
  const fileInput = h('input', { type: 'file', accept: 'video/*,.mov,.mp4', class: 'hidden' });
  const sourceBtn = h('button', { class: 'pill' });
  // Indicateur de zoom affiché pendant le pincement (comme l'appareil photo).
  const zoomBadge = h('div', { class: 'zoom-badge hidden' });
  const dock = h('div', { class: 'dock' });

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
    zoomBadge,
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

  // --- Zoom (pincement à deux doigts) ---------------------------------------
  function refreshZoom() {
    const z = source?.zoom;
    if (!z || !source) return;
    // Zoom numérique : on agrandit l'affichage autour du centre, exactement comme
    // le recadrage appliqué à l'analyse (cropRect).
    source.video.style.transform = z.digital > 1 ? `scale(${z.digital})` : '';
  }

  let badgeTimer = 0;
  function showBadge() {
    const z = source?.zoom;
    if (!z) return;
    zoomBadge.textContent = formatZoom(z.value);
    zoomBadge.classList.remove('hidden');
    clearTimeout(badgeTimer);
    badgeTimer = window.setTimeout(() => zoomBadge.classList.add('hidden'), 1200);
  }

  let applying = false;
  let pendingZoom: number | null = null;
  /** Applique le zoom (une demande à la fois : la caméra met quelques ms à suivre). */
  async function setZoom(value: number) {
    const z = source?.zoom;
    if (!z) return;
    pendingZoom = value;
    if (applying) return;
    applying = true;
    while (pendingZoom != null) {
      const v = pendingZoom;
      pendingZoom = null;
      await z.set(Math.round(v * 10) / 10);
      refreshZoom();
      showBadge();
    }
    applying = false;
    updateSettings({ zoom: z.value });
    emit('zoom');
  }

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { d0: number; z0: number } | null = null;
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  function enablePinch(target: HTMLElement) {
    target.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && source?.zoom) {
        pinch = { d0: Math.max(10, spread()), z0: source.zoom.value };
        emit('pinch');
        showBadge();
      }
    });
    target.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2 && source?.zoom) {
        const z = source.zoom;
        const v = Math.min(z.max, Math.max(z.min, (pinch.z0 * spread()) / pinch.d0));
        void setZoom(v);
      }
    });
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

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
    get pinching() {
      return pinch != null || pointers.size >= 2;
    },
    enablePinch,
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
