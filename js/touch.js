import { state, stage, view } from "./state.js";
import { undo, redo } from "./history.js";
import { setZoom, setHint, cancelDrawing } from "./interaction.js";

// ---------- Tablettes (iPad) : désactiver les outils de sélection du système ----------
// Le CSS (user-select / -webkit-touch-callout) fait l'essentiel ; ces écouteurs couvrent les cas où
// Safari sélectionne quand même (appui long, double toucher) et le zoom par pincement de la page.
const editable=t=>t && t.closest && t.closest("input,textarea,select,[contenteditable='true']");
document.addEventListener("contextmenu",e=>{ if(!editable(e.target)) e.preventDefault(); });
document.addEventListener("selectstart",e=>{ if(!editable(e.target)) e.preventDefault(); });
["gesturestart","gesturechange","gestureend"].forEach(n=>document.addEventListener(n,e=>e.preventDefault()));


// ---------- Gestes à plusieurs doigts (comme Procreate) ----------
//  • deux doigts qui s'écartent / se rapprochent : zoom centré entre les doigts, et déplacement si les doigts glissent
//  • tape à deux doigts : annuler · tape à trois doigts : rétablir
//  • le stylet dessine toujours ; ses appuis font ignorer les doigts (paume posée sur l'écran)
const touches=new Map();                  // pointerId -> {x,y}
let pen=false, g=null;                    // g = geste en cours
export const touchCount=()=>touches.size;
export const penIsDown=()=>pen;

function metrics(){
  const [a,b]=[...touches.values()];
  return { dist:Math.hypot(a.x-b.x,a.y-b.y), mx:(a.x+b.x)/2, my:(a.y+b.y)/2 };
}
function startGesture(){
  const m=metrics(), r=view.getBoundingClientRect();
  g={ t0:performance.now(), dist0:m.dist||1, zoom0:state.zoom, mx0:m.mx, my0:m.my, moved:false, max:touches.size,
      anchor:{ x:(m.mx-r.left)/state.zoom, y:(m.my-r.top)/state.zoom } };       // cellule du dessin sous le milieu des doigts
}
stage.addEventListener("pointerdown",e=>{
  if(e.pointerType==="pen"){ pen=true; return; }
  if(e.pointerType!=="touch" || pen) return;
  touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(touches.size===2){ cancelDrawing(); startGesture(); }
  else if(touches.size>2 && g){ g.max=Math.max(g.max,touches.size); }
},true);
stage.addEventListener("pointermove",e=>{
  if(e.pointerType!=="touch" || !touches.has(e.pointerId)) return;
  touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(!g || touches.size<2) return;
  const m=metrics();
  if(!g.moved && (Math.abs(m.dist-g.dist0)>14 || Math.hypot(m.mx-g.mx0,m.my-g.my0)>14)) g.moved=true;
  if(!g.moved) return;
  e.preventDefault();
  const z=Math.max(1,Math.min(40,Math.round(g.zoom0*m.dist/g.dist0)));
  if(z!==state.zoom) setZoom(z);
  const r=view.getBoundingClientRect();         // recale la cellule d'ancrage sous le milieu des doigts : zoom ET déplacement
  stage.scrollLeft += (r.left + g.anchor.x*state.zoom) - m.mx;
  stage.scrollTop  += (r.top  + g.anchor.y*state.zoom) - m.my;
},true);
function release(e){
  if(e.pointerType==="pen"){ pen=false; return; }
  if(e.pointerType!=="touch" || !touches.has(e.pointerId)) return;
  touches.delete(e.pointerId);
  if(touches.size===0 && g){
    const tap = !g.moved && performance.now()-g.t0<350 && e.type==="pointerup";
    if(tap && g.max===2){ undo(); setHint("Annulé"); }
    else if(tap && g.max===3){ redo(); setHint("Rétabli"); }
    g=null;
  }
}
["pointerup","pointercancel"].forEach(n=>stage.addEventListener(n,release,true));
window.addEventListener("blur",()=>{ touches.clear(); g=null; pen=false; });
