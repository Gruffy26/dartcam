import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

// Ajoute au service worker la liste de tous les fichiers du build, pour qu'ils
// soient mis en cache dès la première ouverture (hors ligne immédiatement).
function precacheList(): Plugin {
  return {
    name: 'dartcam-precache',
    apply: 'build',
    closeBundle() {
      const dist = join(import.meta.dirname, 'dist');
      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
        );
      const files = walk(dist)
        .map((f) => relative(dist, f).split('\\').join('/'))
        .filter((f) => f !== 'sw.js' && !f.endsWith('.DS_Store'))
        .map((f) => './' + f);
      const swPath = join(dist, 'sw.js');
      const sw = readFileSync(swPath, 'utf8');
      const version = (process.env.GITHUB_SHA ?? String(Date.now())).slice(0, 12);
      writeFileSync(
        swPath,
        sw
          .replace(/const CACHE = '[^']*';/, `const CACHE = 'dartcam-${version}';`)
          .replace(/const CORE = \[[^\]]*\];/, `const CORE = ${JSON.stringify(['./', ...files])};`),
      );
    },
  };
}

// `base: './'` : chemins relatifs, l'app marche quel que soit le nom du dépôt
// GitHub Pages (https://<utilisateur>.github.io/<dépôt>/).
export default defineConfig({
  base: './',
  plugins: [precacheList()],
  define: {
    __BUILD_ID__: JSON.stringify(
      (process.env.GITHUB_SHA ?? 'local').slice(0, 7) + ' · ' + new Date().toISOString().slice(0, 16).replace('T', ' '),
    ),
  },
  test: {
    environment: 'node',
  },
});
