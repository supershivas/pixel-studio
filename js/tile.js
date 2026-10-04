import { state } from "./state.js";
import { compositeLayers } from "./helpers.js";

// ---------- Boucle (options de l'outil) ----------
const $=id=>document.getElementById(id);
$("wrapMode").onchange=e=>state.wrap=e.target.value;

// ---------- Aperçu en mosaïque : l'image répétée 3×3, mise à jour en direct ----------
const panel=$("tilePanel"), cv=$("tileCv"), tog=$("tileToggle");
const off=document.createElement("canvas");
let raf=0;
function draw(){
  raf=0; if(panel.hidden) return;
  const W=state.W, H=state.H, g=cv.getContext("2d");
  off.width=W; off.height=H; off.getContext("2d").putImageData(compositeLayers(state.layers),0,0);
  if(cv.width!==W*3 || cv.height!==H*3){ cv.width=W*3; cv.height=H*3; }
  g.imageSmoothingEnabled=false; g.clearRect(0,0,cv.width,cv.height);
  for(let j=0;j<3;j++) for(let i=0;i<3;i++) g.drawImage(off,i*W,j*H);
  g.strokeStyle="rgba(255,204,0,.9)"; g.lineWidth=Math.max(1,W/50); g.strokeRect(W+.5,H+.5,W-1,H-1);   // le vrai motif
}
const schedule=()=>{ if(!raf) raf=requestAnimationFrame(draw); };
function setOpen(on){ panel.hidden=!on; tog.checked=on; state.renderHooks[on?"add":"delete"](schedule); if(on) schedule(); }
tog.onchange=()=>setOpen(tog.checked);
$("tileClose").onclick=()=>setOpen(false);
