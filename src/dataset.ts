// Collecte d'exemples pour améliorer la détection (étape 7).
//
// À chaque volée enregistrée, l'app garde pour chaque fléchette : l'image analysée,
// la pointe trouvée, le score automatique, le score final et la correction éventuelle.
// Tout reste sur le téléphone (IndexedDB) ; le bouton « Exporter » produit un ZIP que
// l'utilisateur envoie s'il le veut. Rien n'est transmis automatiquement.

import type { Calibration } from './calibration';
import type { DetectorParams } from './detector/params';
import type { Mat3, Pt } from './homography';
import type { DartOrigin, DartRecord } from './volley';
import { zipStore, type ZipEntry } from './zip';

/** Au-delà, les plus anciens exemples sont effacés (place sur le téléphone). */
export const MAX_SAMPLES = 300;
const DB_NAME = 'dartcam';
const STORE = 'samples';

export interface SampleMeta {
  at: string;
  build: string;
  /** Identifiant de la volée : les 3 fléchettes d'une même volée le partagent. */
  volley: string;
  index: number;
  frame: { w: number; h: number };
  /** Homographie image (pixels) → cible (mm) au moment de la fléchette. */
  f2b: Mat3 | null;
  calib: { points: Pt[]; zoom: number; aspect: number; method: string; errMm: number } | null;
  /** Pointe en pixels de l'image analysée. */
  tip: Pt | null;
  /** Position détectée sur la cible (mm). */
  board: Pt | null;
  autoScore: string | null;
  score: string;
  points: number;
  origin: DartOrigin;
  /** Score rectifié à la main : la vérité, donc l'exemple le plus utile. */
  corrected: boolean;
  uncertain: boolean;
  /** « supprimee » : fléchette détectée à tort, effacée par l'utilisateur. */
  note: string;
  params: DetectorParams;
  image: string | null;
}

interface StoredSample {
  id?: number;
  meta: SampleMeta;
  jpeg: Blob | null;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const idb = globalThis.indexedDB;
      if (!idb) return resolve(null);
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function done<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/** Encode l'image analysée en JPEG (petit, suffisant pour revoir la pointe). */
async function encode(img: ImageData): Promise<Blob | null> {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(img.width, img.height);
      c.getContext('2d')?.putImageData(img, 0, 0);
      return await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    }
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')?.putImageData(img, 0, 0);
    return await new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/jpeg', 0.92));
  } catch {
    return null;
  }
}

export interface ShotInfo {
  img: ImageData;
  f2b: Mat3;
}

/** Enregistre les fléchettes d'une volée terminée. Ne jette jamais. */
export async function addVolley(
  darts: DartRecord[],
  shots: Map<number, ShotInfo>,
  cal: Calibration | null,
  errMm: number,
  params: DetectorParams,
  build: string,
  note = '',
  /** Image de la cible avant la volée : référence pour rejouer la première fléchette. */
  start: ShotInfo | null = null,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const volley = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    if (start) {
      const jpeg = await encode(start.img);
      const meta: SampleMeta = {
        at: new Date().toISOString(),
        build,
        volley,
        index: 0,
        frame: { w: start.img.width, h: start.img.height },
        f2b: start.f2b,
        calib: cal ? { points: cal.points, zoom: cal.zoom, aspect: cal.aspect, method: cal.method ?? 'auto', errMm } : null,
        tip: null,
        board: null,
        autoScore: null,
        score: '',
        points: 0,
        origin: 'auto',
        corrected: false,
        uncertain: false,
        note: 'debut',
        params,
        image: jpeg ? `${volley}-0.jpg` : null,
      };
      const tx = db.transaction(STORE, 'readwrite');
      await done(tx.objectStore(STORE).add({ meta, jpeg } as StoredSample));
    }
    for (let i = 0; i < darts.length; i++) {
      const d = darts[i];
      const shot = shots.get(d.id) ?? null;
      const jpeg = shot ? await encode(shot.img) : null;
      const meta: SampleMeta = {
        at: new Date().toISOString(),
        build,
        volley,
        index: i + 1,
        frame: shot ? { w: shot.img.width, h: shot.img.height } : { w: 0, h: 0 },
        f2b: shot?.f2b ?? null,
        calib: cal
          ? { points: cal.points, zoom: cal.zoom, aspect: cal.aspect, method: cal.method ?? 'auto', errMm }
          : null,
        tip: d.tip,
        board: d.board,
        autoScore: d.autoScore?.libelle ?? null,
        score: d.score.libelle,
        points: d.score.points,
        origin: d.origin,
        corrected: d.corrected,
        uncertain: !!d.uncertain,
        note,
        params,
        image: jpeg ? `${volley}-${i + 1}.jpg` : null,
      };
      const tx = db.transaction(STORE, 'readwrite');
      await done(tx.objectStore(STORE).add({ meta, jpeg } as StoredSample));
    }
    await trim(db);
  } catch {
    /* la collecte ne doit jamais gêner la partie */
  }
  db.close();
}

async function trim(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const n = (await done(store.count())) ?? 0;
  let excess = n - MAX_SAMPLES;
  if (excess <= 0) return;
  await new Promise<void>((resolve) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || excess <= 0) return resolve();
      cur.delete();
      excess--;
      cur.continue();
    };
    req.onerror = () => resolve();
  });
}

export async function sampleCount(): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  const n = (await done(db.transaction(STORE, 'readonly').objectStore(STORE).count())) ?? 0;
  db.close();
  return n;
}

export async function clearSamples(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await done(db.transaction(STORE, 'readwrite').objectStore(STORE).clear());
  db.close();
}

async function allSamples(): Promise<StoredSample[]> {
  const db = await openDb();
  if (!db) return [];
  const all = (await done(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as StoredSample[] | null;
  db.close();
  return all ?? [];
}

/** Résumé lisible : une ligne par fléchette, pour ouvrir dans un tableur. */
export function toCsv(metas: SampleMeta[]): string {
  const head = 'date,build,volee,flechette,score_auto,score_final,points,corrige,doute,origine,note,tip_x,tip_y,mm_x,mm_y,calib_err_mm,zoom,image';
  const rows = metas.map((m) =>
    [
      m.at,
      m.build,
      m.volley,
      m.index,
      m.autoScore ?? '',
      m.score,
      m.points,
      m.corrected ? 1 : 0,
      m.uncertain ? 1 : 0,
      m.origin,
      m.note,
      m.tip ? m.tip.x.toFixed(2) : '',
      m.tip ? m.tip.y.toFixed(2) : '',
      m.board ? m.board.x.toFixed(2) : '',
      m.board ? m.board.y.toFixed(2) : '',
      m.calib ? m.calib.errMm.toFixed(2) : '',
      m.calib ? m.calib.zoom : '',
      m.image ?? '',
    ].join(','),
  );
  return [head, ...rows].join('\n');
}

/** Construit l'archive : les images, un fichier JSON complet et un résumé CSV. */
export async function buildExport(): Promise<{ blob: Blob; name: string; count: number } | null> {
  const samples = await allSamples();
  if (!samples.length) return null;
  const metas = samples.map((s) => s.meta);
  const entries: ZipEntry[] = [];
  for (const s of samples) {
    if (s.jpeg && s.meta.image) {
      entries.push({ name: `images/${s.meta.image}`, data: new Uint8Array(await s.jpeg.arrayBuffer()) });
    }
  }
  const enc = new TextEncoder();
  entries.push({ name: 'flechettes.json', data: enc.encode(JSON.stringify(metas, null, 1)) });
  entries.push({ name: 'resume.csv', data: enc.encode(toCsv(metas)) });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return {
    blob: new Blob([zipStore(entries) as unknown as BlobPart], { type: 'application/zip' }),
    name: `dartcam-${stamp}.zip`,
    count: metas.length,
  };
}

/** Propose le fichier au téléchargement (Fichiers / Partager sur iPhone). */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
