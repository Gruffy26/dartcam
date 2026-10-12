// Copie OpenCV.js depuis node_modules vers public/vendor pour qu'il soit
// servi depuis le même site que l'app (et mis en cache hors ligne).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('@techstark/opencv-js/package.json'));
const src = join(pkgDir, 'dist', 'opencv.js');
const destDir = join(import.meta.dirname, '..', 'public', 'vendor');
mkdirSync(destDir, { recursive: true });
copyFileSync(src, join(destDir, 'opencv.js'));
console.log('OpenCV.js copié dans public/vendor/opencv.js');
