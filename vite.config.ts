import { defineConfig } from 'vitest/config';

// `base: './'` : chemins relatifs, l'app marche quel que soit le nom du dépôt
// GitHub Pages (https://<utilisateur>.github.io/<dépôt>/).
export default defineConfig({
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(
      (process.env.GITHUB_SHA ?? 'local').slice(0, 7) + ' · ' + new Date().toISOString().slice(0, 16).replace('T', ' '),
    ),
  },
  test: {
    environment: 'node',
  },
});
