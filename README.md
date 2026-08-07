# Pixel Studio

Éditeur de pixel art dans le navigateur, en HTML/CSS/JS pur (aucune dépendance).

## Structure

- `index.html` — page et interface
- `js/` — logique de l'application, en modules ES
  - `state.js` — état partagé, palette et références DOM
  - `helpers.js` — utilitaires calques, compositing, rendu
  - `history.js` — annuler / rétablir
  - `drawing.js` — primitives de dessin, texte pixel, formes vectorielles
  - `interaction.js` — pointeur, clavier, zoom, navigation
  - `ui.js` — outils, palette, sélecteur de couleur, calques, modales
  - `io.js` — export (PNG, ZIP, lot) et projet `.eu-pix`
  - `main.js` — point d'entrée, initialisation

## Développement local

Servir le dossier avec un serveur statique quelconque, par exemple :

```sh
python3 -m http.server 8000
```

puis ouvrir `http://localhost:8000/`.

## Déploiement

Le site est publié automatiquement sur GitHub Pages via GitHub Actions
(`.github/workflows/pages.yml`) à chaque push sur `main`.
