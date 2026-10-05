import { state } from "./state.js";
import { buildLayers } from "./ui.js";
import { render } from "./helpers.js";

// ---------- History ----------
// Convention : snapshot() est appelé AVANT chaque modification, donc history[histPtr] est
// l'état d'avant la dernière action et le dessin affiché est « un cran en avant » de la pile.
// undo() commence donc par empiler l'état courant (pour pouvoir le rétablir) avant de revenir
// à history[histPtr] — sans quoi une seule annulation en remonterait deux d'un coup.
export const history = [];   // snapshots
const snapshotListeners = [];
export function onSnapshot(fn){ snapshotListeners.push(fn); }

const cloneLayer = L => ({...L, data:L.data?L.data.slice():null,
  fx:L.fx?JSON.parse(JSON.stringify(L.fx)):null, text:L.text?{...L.text}:null});
// Un instantané porte aussi les dimensions du canevas (W×H) et les calques des autres frames
// (par référence, sans copie : transformAllFrames les remplace avant de les modifier). C'est ce
// qui permet d'annuler / rétablir un rognage, y compris sur une animation.
const TOOL_LABELS={ move:"Déplacement", select:"Sélection", lasso:"Lasso", wand:"Baguette magique", crop:"Recadrage", pencil:"Crayon",
  eraser:"Gomme", gradient:"Dégradé", dither:"Tramage", stamp:"Tampon", fill:"Pot de peinture", eyedropper:"Pipette", shape:"Forme", text:"Texte" };
function liveSnap(label){
  const snap={ label:label||TOOL_LABELS[state.tool]||"Modification", active: state.active, W: state.W, H: state.H, guides: state.guides, layers: state.layers.map(cloneLayer) };
  if(state.frames && state.frames.length){
    snap.activeFrame=state.activeFrame;
    snap.frames=state.frames.map((f,i)=>({ id:f.id, name:f.name, active:f.active, delay:f.delay||null, layers:i===state.activeFrame?null:f.layers }));
  }
  return snap;
}
// appelé après qu'une restauration a changé la taille du canevas (zoom, champs de taille…)
const sizeListeners = [];
export function onSizeRestore(fn){ sizeListeners.push(fn); }

// comparaison sans allocation : sert à savoir si une action est en attente d'être empilée
function sameAsLive(snap){
  if(!snap || snap.active!==state.active || snap.layers.length!==state.layers.length) return false;
  if(snap.W!==state.W || snap.H!==state.H) return false;
  for(let i=0;i<snap.layers.length;i++){
    const a=snap.layers[i], b=state.layers[i];
    if(a.id!==b.id || a.name!==b.name || a.visible!==b.visible || a.opacity!==b.opacity
      || (a.blend||"normal")!==(b.blend||"normal") || (a.ox||0)!==(b.ox||0) || (a.oy||0)!==(b.oy||0)
      || !!a.locked!==!!b.locked || !!a.alphaLock!==!!b.alphaLock || !!a.isGroup!==!!b.isGroup
      || (a.groupId||null)!==(b.groupId||null) || a.expanded!==b.expanded) return false;
    if(a.img!==b.img && (!a.img||!b.img||a.img.dataURL!==b.img.dataURL)) return false;      // image remplacée (rognage, effacement…)
    if(JSON.stringify(a.fx||null)!==JSON.stringify(b.fx||null)) return false;
    if(JSON.stringify(a.text||null)!==JSON.stringify(b.text||null)) return false;
    if(!!a.data!==!!b.data) return false;
    if(a.data){ if(a.data.length!==b.data.length) return false;
      for(let j=0;j<a.data.length;j++) if(a.data[j]!==b.data[j]) return false; }
  }
  return true;
}

// label : nom de l'action qui va suivre (par défaut : l'outil actif)
export function snapshot(label){
  history.splice(state.histPtr+1);
  const snap=liveSnap(typeof label==="string"?label:undefined);
  if(!history.length) snap.isInitial=true;                       // premier état du projet (sert au panneau d'historique)
  history.push(snap);
  if(history.length>state.HIST_MAX) history.shift();
  state.histPtr = history.length-1;
  for(const fn of snapshotListeners) fn();
}
// abandonne l'action en cours (trait commencé par erreur, p. ex. un deuxième doigt se pose) : retire le dernier
// instantané et revient à l'état qu'il contient, sans laisser de trace dans l'historique
export function abortStroke(){
  if(state.histPtr<1 || history.length-1!==state.histPtr) return false;
  const snap=history.pop(); state.histPtr=history.length-1; restore(snap); return true;
}
// capture et restauration silencieuse de l'état complet (calques, frames, taille, repères) : aperçu en direct
// des modales « Taille de l'image » / « Nouvelle image » (restaurer l'original = annuler l'aperçu)
export const captureState=()=>liveSnap();
export function restoreSilent(snap){ restore(snap,{silent:true,full:true}); }
export function restore(snap,opts){
  const resized = snap.W!==state.W || snap.H!==state.H;
  if(snap.W){ state.W=snap.W; state.H=snap.H; }
  if(snap.guides!==undefined) state.guides=snap.guides;
  state.active = Math.min(snap.active, snap.layers.length-1);
  state.layers = snap.layers.map(cloneLayer);
  if((resized || (opts&&opts.full)) && snap.frames){      // changement de taille : toutes les frames reprennent leur ancienne taille
    state.frames = snap.frames.map((f,i)=>({ id:f.id, name:f.name, active:f.active, delay:f.delay||null,
      layers:i===snap.activeFrame ? state.layers.map(cloneLayer) : f.layers.map(cloneLayer) }));
    state.activeFrame = snap.activeFrame;
  }
  state.cropRect=null; state.activeShape=null; state.previewCells=null;
  if(resized) for(const fn of sizeListeners) fn();
  buildLayers(); render();
  if(!(opts&&opts.silent)) for(const fn of snapshotListeners) fn();       // autosave, vignettes de frames, panneau d'historique
}
export function undo(){
  if(state.histPtr<0) return;
  const target=history[state.histPtr];
  if(!target) return;
  state.floatSel=null; state.sel=null;
  if(!sameAsLive(target)){                 // une action non encore empilée : c'est elle qu'on annule
    history.splice(state.histPtr+1);       // (on est au sommet de la pile)
    history.push(liveSnap());              // …en la gardant rétablissable
    if(history.length>state.HIST_MAX){ history.shift(); state.histPtr--; }
    restore(target);
    return;
  }
  if(state.histPtr>0){ state.histPtr--; restore(history[state.histPtr]); }
}
// États affichables par le panneau d'historique. history[k] est l'état AVANT l'action k, donc l'état
// obtenu après l'action k est history[k+1] (ou l'état courant, s'il n'est pas encore empilé). Le premier
// instantané est dupliqué par celui de la première action : on masque le doublon.
export function historyRows(){
  const pending = state.histPtr>=0 && history[state.histPtr] && !sameAsLive(history[state.histPtr]);
  const start = history.length>1 && history[0] && history[0].isInitial ? 1 : 0;
  const rows=[];
  for(let i=start;i<history.length;i++){
    const label = i===start ? (history[0].isInitial ? "État initial" : "Plus ancien état") : (history[i-1].label||"Modification");
    rows.push({ index:i, n:i-start, label, active:!pending && i===state.histPtr, future:i>state.histPtr });
  }
  if(pending) rows.push({ index:history.length, n:history.length-start, label:history[state.histPtr].label||"Modification", active:true, future:false, live:true });
  return rows;
}
// revient (ou avance) jusqu'à l'état i de historyRows()
export function jumpTo(i){
  if(i>=history.length) return;                    // l'état courant : déjà là
  let guard=history.length+4;
  while(guard-- >0){
    if(state.histPtr===i && sameAsLive(history[i])) return;
    if(state.histPtr<i) redo(); else undo();
  }
}
export function redo(){
  if(state.histPtr<history.length-1){ state.floatSel=null; state.sel=null;
    state.histPtr++; restore(history[state.histPtr]); }
}
