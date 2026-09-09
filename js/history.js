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
function liveSnap(){ return { active: state.active, layers: state.layers.map(cloneLayer) }; }

// comparaison sans allocation : sert à savoir si une action est en attente d'être empilée
function sameAsLive(snap){
  if(!snap || snap.active!==state.active || snap.layers.length!==state.layers.length) return false;
  for(let i=0;i<snap.layers.length;i++){
    const a=snap.layers[i], b=state.layers[i];
    if(a.id!==b.id || a.name!==b.name || a.visible!==b.visible || a.opacity!==b.opacity
      || (a.blend||"normal")!==(b.blend||"normal") || (a.ox||0)!==(b.ox||0) || (a.oy||0)!==(b.oy||0)
      || !!a.locked!==!!b.locked || !!a.alphaLock!==!!b.alphaLock || !!a.isGroup!==!!b.isGroup
      || (a.groupId||null)!==(b.groupId||null) || a.expanded!==b.expanded) return false;
    if(JSON.stringify(a.fx||null)!==JSON.stringify(b.fx||null)) return false;
    if(JSON.stringify(a.text||null)!==JSON.stringify(b.text||null)) return false;
    if(!!a.data!==!!b.data) return false;
    if(a.data){ if(a.data.length!==b.data.length) return false;
      for(let j=0;j<a.data.length;j++) if(a.data[j]!==b.data[j]) return false; }
  }
  return true;
}

export function snapshot(){
  history.splice(state.histPtr+1);
  history.push(liveSnap());
  if(history.length>state.HIST_MAX) history.shift();
  state.histPtr = history.length-1;
  for(const fn of snapshotListeners) fn();
}
export function restore(snap){
  state.active = Math.min(snap.active, snap.layers.length-1);
  state.layers = snap.layers.map(cloneLayer);
  buildLayers(); render();
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
export function redo(){
  if(state.histPtr<history.length-1){ state.floatSel=null; state.sel=null;
    state.histPtr++; restore(history[state.histPtr]); }
}
