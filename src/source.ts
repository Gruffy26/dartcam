// Source d'images : caméra arrière de l'iPhone ou vidéo de test. Le reste de l'app
// ne voit qu'un <video> qui produit des images, quelle que soit la source.

import { createZoomControl, type ZoomControl } from './zoom';

export interface FrameSource {
  kind: 'camera' | 'video';
  video: HTMLVideoElement;
  /** Zoom réglable (caméra uniquement ; une vidéo de test est utilisée telle quelle). */
  zoom: ZoomControl | null;
  stop(): void;
}

export class SourceError extends Error {}

function makeVideo(): HTMLVideoElement {
  const v = document.createElement('video');
  // Indispensables sur iPhone pour lire sans passer en plein écran natif.
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.muted = true;
  v.autoplay = true;
  v.className = 'feed';
  return v;
}

export async function openCamera(initialZoom = 1): Promise<FrameSource> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new SourceError(
      "Ce navigateur ne donne pas accès à la caméra. Ouvre l'app dans Safari à son adresse https.",
    );
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (e) {
    throw new SourceError(cameraErrorMessage(e));
  }
  const video = makeVideo();
  video.srcObject = stream;
  await video.play().catch(() => {});
  const zoom = createZoomControl(stream.getVideoTracks()[0] ?? null, initialZoom);
  await zoom.set(zoom.value);
  return {
    kind: 'camera',
    video,
    zoom,
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}

export function cameraErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return "L'accès à la caméra a été refusé. Sur l'iPhone : Réglages › Apps › Safari › Caméra › « Autoriser », puis rouvre DartCam et accepte la demande.";
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Aucune caméra arrière trouvée sur cet appareil.';
    case 'NotReadableError':
    case 'AbortError':
      return "La caméra est déjà utilisée par une autre app. Ferme-la et réessaie.";
    default:
      return `Impossible d'ouvrir la caméra (${name || 'erreur inconnue'}).`;
  }
}

export async function openVideoFile(file: File): Promise<FrameSource> {
  const url = URL.createObjectURL(file);
  const video = makeVideo();
  video.loop = true;
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new SourceError("Cette vidéo ne peut pas être lue sur cet appareil."));
  });
  await video.play().catch(() => {});
  return {
    kind: 'video',
    video,
    zoom: null,
    stop() {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}
