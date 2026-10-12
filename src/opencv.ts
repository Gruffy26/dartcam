// Chargement asynchrone d'OpenCV.js (≈10 Mo, servi depuis /vendor et mis en cache
// par le service worker). Une seule promesse partagée par toute l'app.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any;

let loading: Promise<CV> | null = null;

export function loadOpenCV(): Promise<CV> {
  if (loading) return loading;
  loading = new Promise<CV>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${import.meta.env.BASE_URL}vendor/opencv.js`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error("Impossible de charger OpenCV.js (vérifie la connexion pour la première ouverture)."));
    };
    script.onload = () => {
      const w = window as unknown as { cv: CV };
      waitReady(w.cv).then((cv) => {
        w.cv = cv;
        resolve(cv);
      }, reject);
    };
    document.head.appendChild(script);
  });
  return loading;
}

// Selon la version, `cv` est déjà prêt, est une Promise, ou un module Emscripten
// avec un `then` (qu'il faut retirer sinon `await` boucle à l'infini).
function waitReady(cv: CV): Promise<CV> {
  return new Promise((resolve) => {
    if (cv?.Mat) return resolve(cv);
    if (cv instanceof Promise) return void cv.then(resolve);
    if (typeof cv?.then === 'function') {
      return void cv.then((m: CV) => {
        delete m.then;
        resolve(m);
      });
    }
    cv.onRuntimeInitialized = () => resolve(cv);
  });
}
