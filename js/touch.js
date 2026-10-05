import { state, stage, view } from "./state.js";
import { undo, redo } from "./history.js";
import { setZoom, setHint, cancelDrawing } from "./interaction.js";
import { clientToCell, cellToClient, setViewAngle } from "./viewgeo.js";

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
  return { dist:Math.hypot(a.x-b.x,a.y-b.y), mx:(a.x+b.x)/2, my:(a.y+b.y)/2, ang:Math.atan2(b.y-a.y,b.x-a.x) };
}
function startGesture(){
  const m=metrics(), [ax,ay]=clientToCell(m.mx,m.my);
  g={ t0:performance.now(), dist0:m.dist||1, zoom0:state.zoom, mx0:m.mx, my0:m.my, ang0:m.ang, view0:state.viewAngle, moved:false, max:touches.size,
      anchor:{ x:ax, y:ay } };                                                     // cellule du dessin sous le milieu des doigts
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
  const dAng=Math.atan2(Math.sin(m.ang-g.ang0),Math.cos(m.ang-g.ang0));
  if(!g.moved && (Math.abs(m.dist-g.dist0)>14 || Math.hypot(m.mx-g.mx0,m.my-g.my0)>14 || Math.abs(dAng)>0.12)) g.moved=true;
  if(!g.moved) return;
  e.preventDefault();
  const z=Math.max(1,Math.min(40,Math.round(g.zoom0*m.dist/g.dist0)));
  // rotation : on suit l'angle entre les doigts, avec un aimant sur les multiples de 90° (retour facile à l'horizontale)
  let ang=g.view0+dAng; const q=Math.PI/2, near=Math.round(ang/q)*q;
  if(Math.abs(ang-near)<0.1) ang=near;
  if(z!==state.zoom) setZoom(z);
  setViewAngle(ang);
  const [px,py]=cellToClient(g.anchor.x,g.anchor.y);   // recale la cellule d'ancrage sous le milieu des doigts : zoom, rotation ET déplacement
  stage.scrollLeft += px - m.mx;
  stage.scrollTop  += py - m.my;
  if(state.viewAngle) setHint("Rotation "+Math.round(state.viewAngle*180/Math.PI)+"°");
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
