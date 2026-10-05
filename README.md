# Pixel Studio

Éditeur de pixel art dans le navigateur, en HTML/CSS/JS pur (aucune dépendance).

## Structure

- `index.html` — page et interface
- `sw.js`, `manifest.webmanifest`, `icon.svg` — application installable et hors ligne (PWA)
- `js/` — logique de l'application, en modules ES
  - `state.js` — état partagé, palette et références DOM
  - `helpers.js` — utilitaires calques, compositing, rendu
  - `history.js` — annuler / rétablir
  - `drawing.js` — primitives de dessin, texte pixel, formes vectorielles
  - `interaction.js` — pointeur, clavier, zoom, navigation
  - `patterns.js` — outils Dégradé et Tramage, remplacer une couleur
  - `stamps.js` — transformation de la sélection et tampons
  - `palettes.js` — menu Palette : bibliothèque, extraction, verrouillage
  - `anim.js` — encodeurs GIF et APNG
  - `tile.js` — boucle sur les bords, aperçu en mosaïque
  - `rulers.js` — règles et repères manuels
  - `historyPanel.js` — panneau d'historique
  - `files.js` — glisser-déposer et coller une image
  - `update.js` — détection de mise à jour et service worker
  - `sheet.js` — import d'une planche de sprites (découpe en frames)
  - `cloud.js` — sauvegarde des derniers dessins dans un dépôt GitHub privé
  - `colordrop.js` — glisser une couleur sur le dessin pour remplir
  - `touch.js` — tablettes : gestes à plusieurs doigts, pas de menu de sélection du système
  - `controls.js` — champs numériques (largeur selon les chiffres) et curseurs (boutons − / +, réglage fin)
  - `dither.js` — matrices de Bayer partagées
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
| `V M L W C B E G I F T S` | Outils (L = lasso, S = tampon) |
| `D` / `H` | Dégradé / Tramage |
| `X` | Échanger couleur principale et secondaire (Alt+clic sur une couleur = secondaire) |
| `Maj + clic` (crayon) | Ligne droite depuis le dernier point tracé |

`Ctrl/⌘ + N` et `Ctrl/⌘ + W` sont réservés par certains navigateurs (nouvelle fenêtre,
fermeture de l'onglet) : ils ne parviennent à l'application que lorsque le navigateur les
laisse passer — toujours le cas en application installée (PWA).

## Gestes tactiles (iPad)

| Geste | Action |
| --- | --- |
| Deux doigts qui s'écartent / se rapprochent | Zoom (centré entre les doigts) ; les glisser déplace le dessin |
| Tape à deux doigts | Annuler |
| Tape à trois doigts | Rétablir |
| Apple Pencil | Dessine ; les doigts sont ignorés tant que le stylet est posé (paume) |

## Développement local

Servir le dossier avec un serveur statique quelconque, par exemple :

```sh
python3 -m http.server 8000
```

puis ouvrir `http://localhost:8000/`.

## Déploiement

Le site est publié automatiquement sur GitHub Pages via GitHub Actions
(`.github/workflows/pages.yml`) à chaque push sur `main`.
