import { state, stage, view } from "./state.js";
import { render } from "./helpers.js";
import { clientToCell } from "./viewgeo.js";

// ---------- Règles et repères manuels ----------
// Règles graduées en pixels du dessin, sur les bords de la scène. On glisse depuis la règle de
// gauche pour poser un repère vertical, depuis celle du haut pour un repère horizontal ; on
// reprend un repère par son repère sur la règle, et on le sort du dessin pour le supprimer.
const $=id=>document.getElementById(id);
const wrap=$("stageWrap"), top=$("rulerTop"), left=$("rulerLeft"), tog=$("rulersToggle");
const STEPS=[1,2,5,10,20,50,100,200,500];
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function sizeCanvas(cv){
  const dpr=window.devicePixelRatio||1, w=cv.clientWidth, h=cv.clientHeight;
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){ cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr); }
  const g=cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h); return g;
}
function drawRuler(cv,horizontal){
  const g=sizeCanvas(cv), z=state.zoom, size=horizontal?state.W:state.H;
  const st=stage.getBoundingClientRect(), vr=view.getBoundingClientRect();
  const origin = horizontal ? vr.left-st.left : vr.top-st.top;          // position écran du pixel 0 dans la règle
  const length = horizontal ? cv.clientWidth : cv.clientHeight, thick=18;
  const step=STEPS.find(s=>s*z>=48)||STEPS[STEPS.length-1];
  const minor = step>=5 ? step/5 : (step===2?1:0);
  g.fillStyle=css("--ink-dim")||"#8fa0c4"; g.strokeStyle=css("--line")||"#2a3a63"; g.font="9px ui-monospace,Menlo,monospace"; g.textBaseline="top";
  const first=Math.max(0,Math.floor(-origin/z)), last=Math.min(size,Math.ceil((length-origin)/z));
  // zone du dessin légèrement éclaircie
  g.fillStyle="rgba(255,255,255,.05)"; const a=Math.max(0,origin), b=Math.min(length,origin+size*z);
  if(horizontal) g.fillRect(a,0,b-a,thick); else g.fillRect(0,a,thick,b-a);
  g.fillStyle=css("--ink-dim")||"#8fa0c4";
  g.beginPath();
  for(let i=first;i<=last;i++){
    const p=origin+i*z+.5, major=i%step===0, mn=minor&&i%minor===0&&minor*z>=4;
    if(!major && !mn) continue;
    const len=major?thick:6;
    if(horizontal){ g.moveTo(p,thick-len); g.lineTo(p,thick); } else { g.moveTo(thick-len,p); g.lineTo(thick,p); }
    if(major){ if(horizontal) g.fillText(String(i),p+2,1); else { g.save(); g.translate(1,p+2); g.rotate(-Math.PI/2); g.translate(-g.measureText(String(i)).width-2,0); g.fillText(String(i),0,0); g.restore(); } }
  }
  g.stroke();
  // repères posés : petit marqueur (bleu d'accent) sur la règle
  g.fillStyle=css("--accent-blue")||"#3d6bff";
  for(const gd of state.rulerGuides){
    if(horizontal && gd.axis==="x"){ const p=origin+gd.pos*z; g.fillRect(p-1,thick-6,3,6); }
    if(!horizontal && gd.axis==="y"){ const p=origin+gd.pos*z; g.fillRect(thick-6,p-1,6,3); }
  }
}
export function drawRulers(){ if(!state.rulersOn) return;
  if(state.viewAngle){ [top,left].forEach(cv=>sizeCanvas(cv)); return; }            // règles masquées tant que la vue est tournée
  drawRuler(top,true); drawRuler(left,false); }

function setRulers(on){
  state.rulersOn=on; tog.checked=on; wrap.classList.toggle("rulers",on); top.hidden=!on; left.hidden=!on;
  state.renderHooks[on?"add":"delete"](drawRulers);
  try{ localStorage.setItem("eupix.rulers",on?"1":"0"); }catch(_){}
  requestAnimationFrame(()=>{ drawRulers(); render(); });
}
tog.onchange=()=>setRulers(tog.checked);
$("clearRulerGuides").onclick=()=>{ state.rulerGuides=[]; render(); };
stage.addEventListener("scroll",()=>{ if(state.rulersOn) drawRulers(); });
window.addEventListener("resize",()=>{ if(state.rulersOn) requestAnimationFrame(drawRulers); });

// ---------- Poser / déplacer / supprimer un repère ----------
function cellPos(e,axis){ const [cx,cy]=clientToCell(e.clientX,e.clientY); return Math.round(axis==="x"?cx:cy); }
function pick(e,horizontal){      // repère existant sous le pointeur, sur cette règle ?
  const vr=view.getBoundingClientRect(), z=state.zoom;
  return state.rulerGuides.find(gd=>horizontal ? gd.axis==="x" && Math.abs(vr.left+gd.pos*z-e.clientX)<=5
                                               : gd.axis==="y" && Math.abs(vr.top+gd.pos*z-e.clientY)<=5);
}
function bindRuler(cv,horizontal){
  cv.addEventListener("pointerdown",e=>{
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const axis=horizontal?"y":"x";                        // règle du haut → repère horizontal (axis y), règle de gauche → vertical (axis x)
    let g=pick(e,horizontal);                             // reprise d'un repère existant (se déplace le long de la règle)
    if(g){ const ax=g.axis; const move=ev=>{ g.pos=cellPos(ev,ax); render(); };
      const up=ev=>{ cv.removeEventListener("pointermove",move); cv.removeEventListener("pointerup",up);
        const lim=ax==="x"?state.W:state.H; if(g.pos<0||g.pos>lim) state.rulerGuides=state.rulerGuides.filter(x=>x!==g); render(); };
      cv.addEventListener("pointermove",move); cv.addEventListener("pointerup",up); return; }
    g={axis,pos:cellPos(e,axis)}; state.rulerGuides.push(g);
    const move=ev=>{ g.pos=cellPos(ev,axis); render(); };
    const up=()=>{ cv.removeEventListener("pointermove",move); cv.removeEventListener("pointerup",up);
      const lim=axis==="x"?state.W:state.H; if(g.pos<0||g.pos>lim) state.rulerGuides=state.rulerGuides.filter(x=>x!==g); render(); };
    cv.addEventListener("pointermove",move); cv.addEventListener("pointerup",up);
  });
}
bindRuler(top,true); bindRuler(left,false);

try{ if(localStorage.getItem("eupix.rulers")==="1") setRulers(true); }catch(_){}
