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

## Workflow git

À partir de maintenant, pousser directement sur `main` (pas de branche de feature ni de PR),
comme convenu avec l'utilisateur.

## Conventions

- Toujours utiliser le color picker custom (HSV, dans `ui.js`, section "Color picker intégré")
  plutôt que le picker natif de l'OS (`<input type="color">`) pour la sélection de la couleur
  de dessin. Le seul `<input type="color">` toléré est `prefStageBg` (fond de la zone de
  travail dans les Préférences), qui n'est pas une couleur de dessin.
- Pas d'attributs d'event handlers inline dans le HTML (`onclick=`, etc.) — tout le binding
  d'événements se fait en JS (`addEventListener` / `.onclick=`), ce qui permet de garder
  `index.html` en pur markup et la logique dans `js/`.
