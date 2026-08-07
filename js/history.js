import { state } from "./state.js";
import { buildLayers } from "./ui.js";
import { render } from "./helpers.js";

// ---------- History ----------
export const history = [];   // snapshots

export function snapshot(){
  const snap = { active: state.active, layers: state.layers.map(L=>({...L,data:L.data?L.data.slice():null,fx:L.fx?JSON.parse(JSON.stringify(L.fx)):null,text:L.text?{...L.text}:null})) };
  history.splice(state.histPtr+1);
  history.push(snap);
  if(history.length>state.HIST_MAX) history.shift();
  state.histPtr = history.length-1;
}
export function restore(snap){
  state.active = Math.min(snap.active, snap.layers.length-1);
  state.layers = snap.layers.map(L=>({...L,data:L.data?L.data.slice():null,fx:L.fx?JSON.parse(JSON.stringify(L.fx)):null,text:L.text?{...L.text}:null}));
  buildLayers(); render();
}
export function undo(){ if(state.histPtr>0){ state.floatSel=null; state.sel=null; state.histPtr--; restore(history[state.histPtr]); } }
export function redo(){ if(state.histPtr<history.length-1){ state.floatSel=null; state.sel=null; state.histPtr++; restore(history[state.histPtr]); } }
