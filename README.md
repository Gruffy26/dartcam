# DartCam

Web app (PWA) de comptage automatique des points aux fléchettes avec la caméra de l'iPhone.
Tout le traitement d'image se fait sur le téléphone avec OpenCV.js ; aucune image n'est envoyée.

## Développement

```bash
npm install
npm run dev      # serveur local
npm test         # tests unitaires (Vitest)
npm run build    # build de production dans dist/
```

Chaque push sur `main` lance les tests, build et publie sur GitHub Pages
(`.github/workflows/deploy.yml`).
