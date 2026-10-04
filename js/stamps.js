import { state } from "./state.js";
import { selectionData, transformSelection, setLayerAt, inBounds, render } from "./helpers.js";
import { snapshot } from "./history.js";
import { setTool, buildLayers } from "./ui.js";
import { setHint } from "./interaction.js";
import { wrapCell } from "./drawing.js";
import { showToast } from "./toast.js";

// ---------- Transformer la sélection (menu Édition) ----------
const $=id=>document.getElementById(id);
const MESSAGES={ none:"Fais d'abord une sélection", img:"Impossible sur un calque image", big:"Trop grand (512 px maximum)" };
[["selFlipH","flipH"],["selFlipV","flipV"],["selRotCW","cw"],["selRotCCW","ccw"],["selUp2","up2"],["selDown2","down2"]].forEach(([id,op])=>{
  $(id).onclick=()=>{ const r=transformSelection(op); if(r!=="ok") setHint(MESSAGES[r]||""); };
});

// ---------- Tampons : une sélection enregistrée, posée d'un clic (ou en glissant) ----------
// Persistés sur cet appareil (localStorage). state.stamps = [{data,w,h}], state.stampIdx = tampon actif.
const KEY="eupix.stamps", MAX_STAMPS=12;
state.stamps=[]; state.stampIdx=0;
try{ const raw=JSON.parse(localStorage.getItem(KEY)); if(Array.isArray(raw)) state.stamps=raw.filter(s=>s && s.w>0 && s.h>0 && Array.isArray(s.data) && s.data.length===s.w*s.h); }catch(_){}
const save=()=>{ try{ localStorage.setItem(KEY,JSON.stringify(state.stamps)); }catch(_){ showToast("Tampons non mémorisés (stockage du navigateur indisponible).",{type:"warn"}); } };

const picker=$("stampPicker");
function thumb(st){
  const cv=document.createElement("canvas"), S=22, sc=Math.max(1,Math.floor(S/Math.max(st.w,st.h)));
  cv.width=st.w*sc; cv.height=st.h*sc; const g=cv.getContext("2d");
  for(let y=0;y<st.h;y++) for(let x=0;x<st.w;x++){ const c=st.data[y*st.w+x]; if(c){ g.fillStyle=c; g.fillRect(x*sc,y*sc,sc,sc); } }
  cv.style.cssText="max-width:20px;max-height:20px;image-rendering:pixelated;pointer-events:none";
  return cv;
}
export function buildStampPicker(){
  picker.innerHTML="";
  state.stamps.forEach((st,i)=>{
    const b=document.createElement("button"); b.type="button"; b.className="skind"+(i===state.stampIdx?" active":"");
    b.title=st.w+"×"+st.h+" px"; b.appendChild(thumb(st));
    b.addEventListener("click",()=>{ state.stampIdx=i; buildStampPicker(); });
    picker.appendChild(b);
  });
  $("stampEmpty").hidden=state.stamps.length>0;
  $("stampDelete").hidden=!state.stamps.length;
}
$("stampDelete").onclick=()=>{ if(!state.stamps.length) return; state.stamps.splice(state.stampIdx,1);
  state.stampIdx=Math.max(0,Math.min(state.stampIdx,state.stamps.length-1)); save(); buildStampPicker(); };
$("miSaveStamp").onclick=()=>{
  const d=selectionData();
  if(!d){ setHint(MESSAGES.none); return; }
  // on retire le vide autour pour que le tampon se pose au pixel près
  let x0=d.w,y0=d.h,x1=-1,y1=-1;
  for(let y=0;y<d.h;y++) for(let x=0;x<d.w;x++) if(d.data[y*d.w+x]!==null){ x0=Math.min(x0,x); x1=Math.max(x1,x); y0=Math.min(y0,y); y1=Math.max(y1,y); }
  if(x1<0){ setHint("La sélection est vide"); return; }
  const w=x1-x0+1, h=y1-y0+1, data=new Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) data[y*w+x]=d.data[(y+y0)*d.w+x+x0];
  state.stamps.push({data,w,h}); if(state.stamps.length>MAX_STAMPS) state.stamps.shift();
  state.stampIdx=state.stamps.length-1; save(); buildStampPicker();
  setTool("stamp"); setHint("Tampon enregistré — clique (ou glisse) pour le poser");
};

// pose d'un tampon centré sur (x,y) ; cells=true => renvoie une Map d'aperçu au lieu d'écrire
export function stampCells(x,y){
  const st=state.stamps[state.stampIdx]; if(!st) return null;
  const ox=x-Math.floor(st.w/2), oy=y-Math.floor(st.h/2), out=[];
  for(let j=0;j<st.h;j++) for(let i=0;i<st.w;i++){ const c=st.data[j*st.w+i]; if(c===null) continue;
    const cell=wrapCell(ox+i,oy+j); if(cell) out.push([cell[0],cell[1],c]); }
  return out;
}
export function stampPlace(x,y){
  const L=state.layers[state.active], cells=stampCells(x,y); if(!cells) return false;
  for(const [cx,cy,c] of cells) setLayerAt(L,cx,cy,c);
  state.thumbsDirty=true; return true;
}
export function stampGhost(x,y){
  const cells=stampCells(x,y); if(!cells) return;
  state.previewCells=new Map(cells.map(([cx,cy,c])=>[cx+","+cy,c])); render();
}
export function stampSpacing(){ const st=state.stamps[state.stampIdx]; return st?Math.max(st.w,st.h):1; }
buildStampPicker();
