export const APP_VERSION = "1.19.0";

// ---------- Palette de base ----------
// Ordre d'affichage (grille de 6 colonnes) : neutres (blanc, noir, [transparent ajouté par l'UI],
// puis gris, crème, nuit), puis une colonne par teinte — bleu, vert, jaune, orange, rouge, violet —
// en trois lignes clair / franc / foncé. Bleu #003399 et jaune #FFCC00 : couleurs UE.
export const PALETTE = [
  "#FFFFFF","#000000","#7A8AA8","#F5E6D3","#141428",
  "#7FB2FF","#69F0AE","#FFF176","#FFA94D","#FF6B81","#C084FC",
  "#2979FF","#00E676","#FFCC00","#FF6B00","#FF1744","#9D4EDD",
  "#003399","#00A152","#C79A00","#B84A00","#A30D2D","#5B21B6"
];

// ---------- État ----------
// Regroupé dans un objet unique car ces valeurs sont réassignées (pas seulement mutées)
// depuis plusieurs modules ; les liaisons d'import ES sont en lecture seule, donc on
// passe par des propriétés d'objet plutôt que par des bindings de niveau module.
export const state = {
  W: 50, H: 70, zoom: 12,
  color: "#003399",
  color2: "#FFFFFF",   // couleur secondaire (dégradé, fond du tramage) — X échange les deux
  brush: 1,
  strokeWidth: 1,
  tool: "pencil",
  shapeKind: "rect",   // forme active de l'outil Forme : line, rect, ellipse, star, heart, triangle, diamond
  fillShape: false,
  mirror: "none",
  guides: null,    // {bleed,safety} en pixels natifs, ou null

  layers: [],      // {id,name,visible,opacity,data:(hex|null)[]}
  active: 0,
  layerSeq: 1,

  frames: [],      // {id,name,layers,active} — images de l'animation
  activeFrame: 0,
  frameSeq: 1,
  fps: 6,
  playing: false,
  onionSkin: false,

  histPtr: -1,
  HIST_MAX: 60,

  textString: "", textScale: 1, textFont: "press", textGlyph: {cells:[],w:0,h:0},
  activeShape: null, txOp: null, txStart: null, // forme vectorielle en cours d'édition

  checkerKey: "",
  thumbsDirty: true,

  customColors: [],
  projectName: "Sans titre",   // nom du projet : en-tête, fichier .pixel, projets récents et noms d'export
  projectId: null,   // identifiant transitoire du projet courant, pour mettre à jour (plutôt que dupliquer) son entrée dans les projets récents

  previewCells: null, // Map "x,y"->color for in-progress shape
  sel: null, floatSel: null, clipboard: null, selDrag: null,   // sélection rectangulaire / presse-papiers
  renderHooks: new Set(),   // fonctions appelées après chaque rendu (aperçu mosaïque, règles…)
  rulersOn: false, rulerGuides: [],   // règles et repères manuels {axis:"x"|"y", pos}
  lasso: null,         // points [x,y] du tracé en cours de l'outil Lasso
  cropRect: null,      // {x,y,w,h} en cours de définition avec l'outil Recadrer
  wandContiguous: true,
  fillTol: 0, fillContig: true,                 // pot de peinture : tolérance (%) et contiguïté
  pixelPerfect: false,                          // crayon : supprime les coins en L
  gradShape: "linear", gradStyle: "bayer4", gradSteps: 4, gradClear: false, gradPainted: false, gradDrag: null,
  wrap: "none",                                 // dessin en boucle sur les bords : none | x | y | xy
  ditherPattern: "checker", ditherBg: "clear", ditherMode: "brush",

  textAnchor: {x:0,y:0}, textEditing: false, caretOn: true,
};

// ---------- DOM ----------
export const view = document.getElementById("view");
export const overlay = document.getElementById("overlay");
export const wrap = document.getElementById("wrap");
export const stage = document.getElementById("stage");
export const vctx = view.getContext("2d");
export const octx = overlay.getContext("2d");
export const hint = document.getElementById("hint");
export const composite = document.createElement("canvas");
export const cctx = composite.getContext("2d");
export const artwork = document.createElement("canvas");        // composition des calques (fond transparent, modes de fusion)
export const actx = artwork.getContext("2d");
export const checkerCv = document.createElement("canvas");      // damier pré-rendu (mis en cache)
export const chctx = checkerCv.getContext("2d");
export const blendOp = m => ({multiply:"multiply",screen:"screen",overlay:"overlay",darken:"darken",lighten:"lighten"}[m]||"source-over");
