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
  - `frames.js` — frames de l'animation
  - `home.js` — page d'accueil, fermeture / création de projet
  - `modals.js` — modales déplaçables
  - `toast.js` — notifications
  - `io.js` — export (PNG, ZIP, lot) et projet `.pixel`
  - `main.js` — point d'entrée, initialisation

## Raccourcis

| Raccourci | Action |
| --- | --- |
| `Ctrl/⌘ + Z` | Annuler |
| `Ctrl/⌘ + ⇧ + Z` | Rétablir |
| `Ctrl/⌘ + N` | Nouveau projet (avec proposition d'enregistrement) |
| `Ctrl/⌘ + W` | Fermer le projet (avec proposition d'enregistrement) |
| `Ctrl/⌘ + T` | Transformer le calque |
| `V M W C B E G I F T` | Outils |

`Ctrl/⌘ + N` et `Ctrl/⌘ + W` sont réservés par certains navigateurs (nouvelle fenêtre,
fermeture de l'onglet) : ils ne parviennent à l'application que lorsque le navigateur les
laisse passer — toujours le cas en application installée (PWA).

## Développement local

Servir le dossier avec un serveur statique quelconque, par exemple :

```sh
python3 -m http.server 8000
```

puis ouvrir `http://localhost:8000/`.

## Déploiement

Le site est publié automatiquement sur GitHub Pages via GitHub Actions
(`.github/workflows/pages.yml`) à chaque push sur `main`.
