import { state, view } from "./state.js";
import { floodFill } from "./drawing.js";
import { snapshot } from "./history.js";
import { render } from "./helpers.js";
import { buildLayers } from "./ui.js";
import { setHint } from "./interaction.js";
import { noteColorUsed } from "./palettes.js";

// ---------- ColorDrop : glisser une couleur (pastille, palette, récentes) sur le dessin pour remplir la zone ----------
// La zone touchée est remplie comme avec le pot de peinture (tolérance et contiguïté du pot comprises).
const $=id=>document.getElementById(id);
let press=null, ghost=null, suppressClick=false;
function colorOf(el){
  if(el.closest("#curChip")) return state.color;
  if(el.closest("#curChip2")) return state.color2;
  const sw=el.closest(".sw[data-c]"); return sw ? sw.dataset.c : null;
}
function end(){
  if(!press) return;
  window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up); window.removeEventListener("pointercancel",up);
  if(ghost){ ghost.remove(); ghost=null; } press=null;
}
function move(e){
  if(!press||e.pointerId!==press.pid) return;
  if(!press.dragging){ if(Math.hypot(e.clientX-press.x,e.clientY-press.y)<8) return;
    press.dragging=true; ghost=document.createElement("div"); ghost.className="color-ghost"; ghost.style.background=press.color; document.body.appendChild(ghost); }
  ghost.style.left=e.clientX+"px"; ghost.style.top=e.clientY+"px";
}
function up(e){
  if(!press||e.pointerId!==press.pid) return;
  const was=press.dragging, color=press.color;
  end();
  if(!was||e.type!=="pointerup") return;
  suppressClick=true; setTimeout(()=>suppressClick=false,0);
  const r=view.getBoundingClientRect(), x=Math.floor((e.clientX-r.left)/state.zoom), y=Math.floor((e.clientY-r.top)/state.zoom);
  if(x<0||y<0||x>=state.W||y>=state.H) return;
  const L=state.layers[state.active];
  if(L.img){ setHint("Le remplissage ne s'applique pas aux calques image"); return; }
  if(L.locked){ setHint("Calque verrouillé — déverrouille-le dans ses options (⚙)"); return; }
  snapshot("ColorDrop"); floodFill(x,y,color); state.thumbsDirty=true; buildLayers(); render(); noteColorUsed(color);
  setHint("Zone remplie");
}
function start(e){
  if(e.button!==0) return;
  const color=colorOf(e.target); if(!color) return;
  press={ x:e.clientX, y:e.clientY, pid:e.pointerId, color, dragging:false };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up); window.addEventListener("pointercancel",up);
}
["curChip","curChip2","swatches","recentColors"].forEach(id=>$(id).addEventListener("pointerdown",start));
document.addEventListener("click",e=>{ if(suppressClick){ e.stopImmediatePropagation(); e.preventDefault(); } },true);
