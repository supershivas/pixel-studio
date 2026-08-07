export const APP_VERSION = "1.2.0";

// ---------- Palette : 16 teintes flashy, bleu + jaune UE inclus ----------
export const PALETTE = [
  "#003399","#FFCC00","#FF2D95","#FF1744","#FF6B00","#A6FF00",
  "#00E676","#00E5FF","#2979FF","#9D4EDD","#E000FF","#FFE500",
  "#FFFFFF","#141428","#7A8AA8","#F5E6D3"
];

// ---------- État ----------
// Regroupé dans un objet unique car ces valeurs sont réassignées (pas seulement mutées)
// depuis plusieurs modules ; les liaisons d'import ES sont en lecture seule, donc on
// passe par des propriétés d'objet plutôt que par des bindings de niveau module.
export const state = {
  W: 50, H: 70, zoom: 12,
  color: "#003399",
  brush: 1,
  strokeWidth: 1,
  tool: "pencil",
  fillShape: false,
  mirror: "none",
  guides: null,    // {bleed,safety} en pixels natifs, ou null

  layers: [],      // {id,name,visible,opacity,data:(hex|null)[]}
  active: 0,
  layerSeq: 1,

  histPtr: -1,
  HIST_MAX: 60,

  textString: "", textScale: 1, textFont: "press", textGlyph: {cells:[],w:0,h:0},
  activeShape: null, txOp: null, txStart: null, // forme vectorielle en cours d'édition

  checkerKey: "",
  thumbsDirty: true,

  customColors: [],

  previewCells: null, // Map "x,y"->color for in-progress shape
  sel: null, floatSel: null, clipboard: null, selDrag: null,   // sélection rectangulaire / presse-papiers

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
