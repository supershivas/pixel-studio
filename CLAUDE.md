# Pixel Studio

Éditeur de pixel art dans le navigateur, en HTML/CSS/JS pur (pas de build, pas de dépendances).

## Structure

- `index.html` — markup et styles
- `js/` — logique en modules ES, chargés via `<script type="module" src="js/main.js">`
  - `state.js` — état mutable partagé (objet `state`) et références DOM
  - `helpers.js` — calques, compositing, rendu
  - `history.js` — annuler / rétablir
  - `drawing.js` — dessin, texte pixel, formes vectorielles
  - `interaction.js` — pointeur, clavier, zoom, navigation
  - `ui.js` — outils, palette, calques, préférences, modales
  - `io.js` — export et projet `.eu-pix`
  - `main.js` — point d'entrée

## Dev local

```sh
python3 -m http.server 8000
```

## Déploiement

GitHub Pages via `.github/workflows/pages.yml`, à chaque push sur `main`.
