// Garde l'écran allumé pendant l'utilisation de la caméra. Silencieux si non supporté.

type Sentinel = { release(): Promise<void>; addEventListener(t: 'release', cb: () => void): void };

let sentinel: Sentinel | null = null;
let wanted = false;

async function acquire(): Promise<void> {
  const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<Sentinel> } }).wakeLock;
  if (!wl || sentinel || document.visibilityState !== 'visible') return;
  try {
    sentinel = await wl.request('screen');
    sentinel.addEventListener('release', () => (sentinel = null));
  } catch {
    sentinel = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (wanted) void acquire();
});

export function keepScreenOn(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else {
    void sentinel?.release().catch(() => {});
    sentinel = null;
  }
}

export function isScreenKeptOn(): boolean {
  return sentinel != null;
}
