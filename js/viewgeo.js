import { state, view, wrap } from "./state.js";

// ---------- Géométrie de la vue : le canevas peut être tourné (geste à deux doigts) ----------
// getBoundingClientRect() d'un élément tourné donne sa boîte englobante : on part donc de son centre (la rotation CSS se
// fait autour du centre) et on applique la rotation inverse pour retrouver les coordonnées locales du dessin.
export function viewCenter(){ const r=view.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; }
// point écran → pixels du canevas (0..W*zoom, 0..H*zoom)
export function clientToLocal(x,y){
  const [cx,cy]=viewCenter(), a=state.viewAngle||0, c=Math.cos(a), s=Math.sin(a), dx=x-cx, dy=y-cy;
  return [dx*c+dy*s+state.W*state.zoom/2, -dx*s+dy*c+state.H*state.zoom/2];
}
// point écran → coordonnées (flottantes) en cellules du dessin
export function clientToCell(x,y){ const [lx,ly]=clientToLocal(x,y); return [lx/state.zoom, ly/state.zoom]; }
// cellule du dessin → point écran
export function cellToClient(ax,ay){
  const [cx,cy]=viewCenter(), a=state.viewAngle||0, c=Math.cos(a), s=Math.sin(a), lx=(ax-state.W/2)*state.zoom, ly=(ay-state.H/2)*state.zoom;
  return [cx+lx*c-ly*s, cy+lx*s+ly*c];
}
// applique l'angle de la vue (radians) et affiche / masque le bouton de remise à zéro
export function setViewAngle(a){
  const TAU=Math.PI*2; a=((a%TAU)+TAU)%TAU; if(a>Math.PI) a-=TAU;
  state.viewAngle=a;
  wrap.style.transform = a ? `rotate(${a}rad)` : "";
  const b=document.getElementById("viewReset"); if(b) b.hidden=!a;
}

document.getElementById("viewReset").onclick=()=>setViewAngle(0);
document.getElementById("viewResetMenu").onclick=()=>setViewAngle(0);
