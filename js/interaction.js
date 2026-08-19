import { state, view, hint, stage } from "./state.js";
import { inBounds, insideRect, render, clampSel, liftSelection, commitFloat, copySelection, cutSelection,
  deleteSelection, pasteClipboard, nudgeSelection, compositeToImageData, idx } from "./helpers.js";
import { snapshot, undo, redo } from "./history.js";
import { stamp, line, floodFill, selectSimilar, TRANSFORM_TOOLS, shapeToPreview, hitHandle, unrot, bakeShape, enterLayerTransform } from "./drawing.js";
import { setColor, setTool, buildLayers, hitTextLayer, startEditTextLayer, openCanvasText, applyCrop, prefs } from "./ui.js";

// ---------- Pointer interaction ----------
let drawing=false, startX=0, startY=0, lastX=0, lastY=0, creating=false, moveOrig=null, moveStart=null;
export function setHint(t){ hint.textContent = t||"—"; }
export function cellFromEvent(e){ const r=view.getBoundingClientRect();
  return [Math.floor((e.clientX-r.left)/state.zoom), Math.floor((e.clientY-r.top)/state.zoom)]; }
export function screenFromEvent(e){ const r=view.getBoundingClientRect();
  return [e.clientX-r.left, e.clientY-r.top]; }
export function makeShape(x0,y0,x1,y1,square){
  let w=Math.max(1,Math.abs(x1-x0)+1), h=Math.max(1,Math.abs(y1-y0)+1);
  if(square){ const s=Math.max(w,h); w=h=s; }
  const cx=(x0+x1)/2+0.5, cy=(y0+y1)/2+0.5;
  return { type:state.shapeKind, cx, cy, w, h, rot:0, skewX:0, skewY:0, filled:state.fillShape, strokeW:state.strokeWidth, color:state.color };
}
export function line_immediate_commit(x0,y0,x1,y1){ const d=state.layers[state.active].data;
  line(x0,y0,x1,y1,(px,py)=>stamp(px,py,state.color,state.layers[state.active])); }
export function stampPreview(px,py){ const half=Math.floor((state.brush-1)/2);
  for(let dy=-half;dy<state.brush-half;dy++) for(let dx=-half;dx<state.brush-half;dx++){ const nx=px+dx,ny=py+dy; if(inBounds(nx,ny)) state.previewCells.set(nx+","+ny,state.color); } }

view.addEventListener("pointerdown",e=>{
  if(spaceHeld || e.button===1) return;   // laisser le pan (géré par la scène)
  e.preventDefault(); view.setPointerCapture(e.pointerId);
  const [x,y]=cellFromEvent(e); const [sx,sy]=screenFromEvent(e);

  // 1) interaction avec une forme déjà posée (mode transformation)
  if(state.activeShape){
    const hit=hitHandle(sx,sy);
    if(hit){ state.txOp=hit; drawing=true;
      state.txStart={gx:x+0.5,gy:y+0.5,cx:state.activeShape.cx,cy:state.activeShape.cy}; return; }
    bakeShape(); // clic hors du cadre => on transpose, puis on peut recommencer
  }
  if(state.layers[state.active].locked && state.tool!=="eyedropper" && state.tool!=="crop"){ setHint("Calque verrouillé — déverrouille-le dans ses options (⚙)"); return; }
  if(!inBounds(x,y)) return;
  startX=x;startY=y;lastX=x;lastY=y;

  if(state.tool==="select"){
    if(state.floatSel && insideRect(x,y,state.floatSel.x,state.floatSel.y,state.floatSel.w,state.floatSel.h)){ state.selDrag={mode:"floatmove",ox:x-state.floatSel.x,oy:y-state.floatSel.y}; drawing=true; return; }
    if(state.sel && !state.floatSel && insideRect(x,y,state.sel.x,state.sel.y,state.sel.w,state.sel.h) && !state.layers[state.active].img){ liftSelection(); state.selDrag={mode:"floatmove",ox:x-state.floatSel.x,oy:y-state.floatSel.y}; drawing=true; return; }
    commitFloat(); state.selDrag={mode:"new",x0:x,y0:y}; state.sel={x,y,w:1,h:1}; drawing=true; render(); return;
  }
  if(state.tool==="move"){ const L=state.layers[state.active]; snapshot(); drawing=true; moveStart={x,y};
    moveOrig={ox:L.ox||0, oy:L.oy||0}; }
  else if(state.tool==="pencil"){ snapshot(); drawing=true; stamp(x,y,state.color,state.layers[state.active]); render(); }
  else if(state.tool==="eraser"){ snapshot(); drawing=true; stamp(x,y,null,state.layers[state.active]); render(); }
  else if(state.tool==="fill"){ snapshot(); floodFill(x,y,state.color); render(); }
  else if(state.tool==="eyedropper"){
    const img=compositeToImageData(); const j=idx(x,y)*4;
    if(img.data[j+3]>0){ const h="#"+[img.data[j],img.data[j+1],img.data[j+2]].map(v=>v.toString(16).padStart(2,"0")).join("").toUpperCase(); setColor(h); }
  }
  else if(state.tool==="shape" && state.shapeKind==="line"){ snapshot(); drawing=true; state.previewCells=new Map(); line(x,y,x,y,stampPreview); render(); }
  else if(state.tool==="wand"){ selectSimilar(x,y,state.wandContiguous); setTool("select"); render(); }
  else if(state.tool==="crop"){ state.cropRect={x,y,w:1,h:1}; state.cropDrag={x0:x,y0:y}; drawing=true; render(); }
  else if(state.tool==="shape" && TRANSFORM_TOOLS.has(state.shapeKind)){ creating=true; drawing=true; state.activeShape=makeShape(x,y,x,y); shapeToPreview(); render(); }
  else if(state.tool==="text"){ const hitL=hitTextLayer(x,y);
    if(hitL){ state.active=state.layers.indexOf(hitL); buildLayers(); startEditTextLayer(hitL,e.clientX,e.clientY); }
    else openCanvasText(x,y,e.clientX,e.clientY); }
});

view.addEventListener("pointermove",e=>{
  const [x,y]=cellFromEvent(e);
  // aperçu fantôme du texte
  if(state.tool==="text" && !drawing){ setHint(inBounds(x,y)?(x+" , "+y+"   ·   texte"):""); return; }

  // manipulation d'une forme
  if(state.activeShape && drawing && state.txOp){
    const gx=x+0.5, gy=y+0.5, s=state.activeShape;
    if(state.txOp.op==="move"){ s.cx=state.txStart.cx+(gx-state.txStart.gx); s.cy=state.txStart.cy+(gy-state.txStart.gy); setHint("déplacer"); }
    else if(state.txOp.op==="rotate"){ let a=Math.atan2(gy-s.cy,gx-s.cx)+Math.PI/2;
      if(e.shiftKey){ const step=Math.PI/12; a=Math.round(a/step)*step; } s.rot=a;
      setHint("rotation "+Math.round(s.rot*180/Math.PI)+"°"); }
    else if(state.txOp.op==="scale"){ const [ex,ey]=unrot(s,gx,gy);
      if(e.shiftKey){ const m=Math.max(2*Math.abs(ex),2*Math.abs(ey)); s.w=s.h=Math.max(1,m); }
      else { s.w=Math.max(1,2*Math.abs(ex)); s.h=Math.max(1,2*Math.abs(ey)); }
      setHint("échelle "+Math.round(s.w)+"×"+Math.round(s.h)); }
    else if(state.txOp.op==="edge"){ const [ex,ey]=unrot(s,gx,gy); const horiz=(state.txOp.edge==="l"||state.txOp.edge==="r");
      if(e.altKey){ if(horiz){ s.skewY=ey/((state.txOp.edge==="r"?0.5:-0.5)*s.w||1); } else { s.skewX=ex/((state.txOp.edge==="b"?0.5:-0.5)*s.h||1); } setHint("cisaillement"); }
      else if(e.shiftKey){ const v=Math.max(1, horiz?2*Math.abs(ex):2*Math.abs(ey)); s.w=s.h=v; setHint("échelle "+Math.round(v)); }
      else { if(horiz){ s.w=Math.max(1,2*Math.abs(ex)); } else { s.h=Math.max(1,2*Math.abs(ey)); } setHint("déformer"); } }
    shapeToPreview(); render(); return;
  }
  if(!drawing){ setHint(inBounds(x,y)?(x+" , "+y+"   ·   "+state.tool):""); return; }

  // recadrage : glisser pour définir la zone à conserver
  if(state.tool==="crop" && drawing && state.cropDrag){
    const x0=state.cropDrag.x0,y0=state.cropDrag.y0;
    const rx=Math.max(0,Math.min(x0,x)), ry=Math.max(0,Math.min(y0,y));
    const rw=Math.min(Math.abs(x-x0)+1, state.W-rx), rh=Math.min(Math.abs(y-y0)+1, state.H-ry);
    state.cropRect={x:rx,y:ry,w:rw,h:rh};
    setHint("recadrer "+rw+"×"+rh); render(); return;
  }

  // sélection rectangulaire
  if(state.tool==="select" && drawing && state.selDrag){
    if(state.selDrag.mode==="new"){ const x0=state.selDrag.x0,y0=state.selDrag.y0;
      state.sel={x:Math.min(x0,x),y:Math.min(y0,y),w:Math.abs(x-x0)+1,h:Math.abs(y-y0)+1}; clampSel();
      setHint("sélection "+state.sel.w+"×"+state.sel.h); render(); return; }
    if(state.selDrag.mode==="floatmove"){ state.floatSel.x=x-state.selDrag.ox; state.floatSel.y=y-state.selDrag.oy;
      state.sel={x:state.floatSel.x,y:state.floatSel.y,w:state.floatSel.w,h:state.floatSel.h}; render(); return; }
  }

  // déplacement du contenu du calque actif
  if(state.tool==="move"){ const L=state.layers[state.active]; const dx=x-moveStart.x, dy=y-moveStart.y;
    L.ox=moveOrig.ox+dx; L.oy=moveOrig.oy+dy;
    setHint("déplacer "+(dx>=0?"+":"")+dx+", "+(dy>=0?"+":"")+dy); render(); return; }

  // création d'une forme (glisser pour définir la boîte)
  if(creating){ state.activeShape=makeShape(startX,startY,x,y,e.shiftKey); shapeToPreview(); render(); setHint(e.shiftKey?"régulier (Maj)":"relâche pour éditer"); return; }

  if(state.tool==="pencil"){ line(lastX,lastY,x,y,(px,py)=>stamp(px,py,state.color,state.layers[state.active])); lastX=x;lastY=y; render(); }
  else if(state.tool==="eraser"){ line(lastX,lastY,x,y,(px,py)=>stamp(px,py,null,state.layers[state.active])); lastX=x;lastY=y; render(); }
  else if(state.tool==="shape" && state.shapeKind==="line"){ state.previewCells=new Map(); line(startX,startY,x,y,stampPreview); render(); }
  setHint(inBounds(x,y)?(x+" , "+y):"");
});

view.addEventListener("pointerup",e=>{
  if(!drawing) return;
  const [x,y]=cellFromEvent(e);
  if(state.tool==="crop" && state.cropDrag){ state.cropDrag=null; drawing=false;
    if(state.cropRect && state.cropRect.w<=1 && state.cropRect.h<=1){ state.cropRect=null; render(); setHint(""); return; }
    render(); setHint("Entrée pour rogner · Échap pour annuler"); return; }
  if(state.tool==="select" && state.selDrag){ if(state.selDrag.mode==="new" && state.sel && state.sel.w<=1 && state.sel.h<=1) state.sel=null;
    state.selDrag=null; drawing=false; render(); return; }
  if(creating){ creating=false; drawing=false; state.txOp=null;
    if(state.activeShape && state.activeShape.w<=1 && state.activeShape.h<=1){ state.activeShape=null; state.previewCells=null; render(); setHint(""); return; }
    shapeToPreview(); render(); setHint("Entrée pour valider · Échap pour annuler"); return; }
  if(state.txOp){ drawing=false; state.txOp=null; return; }
  if(state.tool==="shape" && state.shapeKind==="line"){ line_immediate_commit(startX,startY,x,y); state.previewCells=null; }
  drawing=false; state.thumbsDirty=true; render();
});
view.addEventListener("pointerleave",()=>{ if(state.tool==="text" && state.previewCells && !state.activeShape && !state.textEditing){ state.previewCells=null; render(); } });

// ---------- Zoom ----------
export function setZoom(z){ state.zoom=Math.max(1,Math.min(40,z)); render(); }
document.getElementById("zoomIn").onclick=()=>setZoom(state.zoom+1);
document.getElementById("zoomOut").onclick=()=>setZoom(state.zoom-1);
document.getElementById("zoomFit").onclick=fitZoom;
export function fitZoom(){
  const pad=48; const zw=(stage.clientWidth-pad)/state.W, zh=(stage.clientHeight-pad)/state.H;
  setZoom(Math.max(1,Math.floor(Math.min(zw,zh))));
}
// ---------- Navigation : pan + zoom centré curseur ----------
let spaceHeld=false, panning=false, panStart=null;
window.addEventListener("keydown",e=>{ if(e.code==="Space" && e.target.tagName!=="INPUT" && e.target.tagName!=="TEXTAREA"){ if(!spaceHeld){ spaceHeld=true; stage.classList.add("grabready"); } e.preventDefault(); } });
window.addEventListener("keyup",e=>{ if(e.code==="Space"){ spaceHeld=false; stage.classList.remove("grabready"); } });
function startPan(e){ panning=true; stage.classList.add("panning");
  panStart={x:e.clientX,y:e.clientY,sl:stage.scrollLeft,st:stage.scrollTop};
  try{ stage.setPointerCapture(e.pointerId); }catch(_){}}
stage.addEventListener("pointerdown",e=>{ if(e.button===1 || (spaceHeld && e.button===0)){ e.preventDefault(); startPan(e); } });
stage.addEventListener("pointermove",e=>{ if(!panning) return; stage.scrollLeft=panStart.sl-(e.clientX-panStart.x); stage.scrollTop=panStart.st-(e.clientY-panStart.y); });
stage.addEventListener("pointerup",()=>{ if(panning){ panning=false; stage.classList.remove("panning"); } });
stage.addEventListener("pointercancel",()=>{ panning=false; stage.classList.remove("panning"); });
stage.addEventListener("wheel",e=>{ if(!prefs.wheelZoom && !e.ctrlKey && !e.metaKey) return; e.preventDefault();
  const rect=view.getBoundingClientRect();
  const cx=(e.clientX-rect.left)/state.zoom, cy=(e.clientY-rect.top)/state.zoom;   // cellule sous le curseur
  const old=state.zoom; setZoom(state.zoom+(e.deltaY<0?1:-1));
  if(state.zoom!==old){ const nr=view.getBoundingClientRect();
    stage.scrollLeft += (nr.left + cx*state.zoom) - e.clientX;
    stage.scrollTop  += (nr.top  + cy*state.zoom) - e.clientY; }
},{passive:false});

// ---------- Keyboard ----------
window.addEventListener("keydown",e=>{
  if(e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA") return;
  if(e.key==="Enter" && state.cropRect){ e.preventDefault();
    applyCrop(state.cropRect.x,state.cropRect.y,state.cropRect.w,state.cropRect.h); state.cropRect=null; setTool("move"); return; }
  if(e.key==="Enter" && state.activeShape){ e.preventDefault(); bakeShape(); return; }
  if(e.key==="Enter" && state.floatSel){ e.preventDefault(); commitFloat(); render(); return; }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){ e.preventDefault(); e.shiftKey?redo():undo(); return; }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){ e.preventDefault(); redo(); return; }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="c"){ if(state.sel||state.floatSel){ e.preventDefault(); copySelection(); setHint("Copié"); } return; }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="x"){ if(state.sel||state.floatSel){ e.preventDefault(); cutSelection(); setHint("Coupé"); } return; }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="v"){ if(state.clipboard){ e.preventDefault(); pasteClipboard(); } return; }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="t"){ e.preventDefault(); enterLayerTransform(); return; }
  if(e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase()==="t"){ e.preventDefault(); enterLayerTransform(); return; }
  if((e.key==="Delete"||e.key==="Backspace") && (state.sel||state.floatSel)){ e.preventDefault(); deleteSelection(); return; }
  if((e.key.startsWith("Arrow")) && (state.sel||state.floatSel)){ e.preventDefault(); const n=e.shiftKey?10:1;
    if(e.key==="ArrowLeft") nudgeSelection(-n,0); else if(e.key==="ArrowRight") nudgeSelection(n,0);
    else if(e.key==="ArrowUp") nudgeSelection(0,-n); else if(e.key==="ArrowDown") nudgeSelection(0,n); return; }
  const map={v:"move",m:"select",w:"wand",c:"crop",b:"pencil",e:"eraser",g:"fill",i:"eyedropper",f:"shape",t:"text"};
  const k=e.key.toLowerCase();
  if(e.ctrlKey||e.metaKey||e.altKey) return;   // laisser les raccourcis navigateur
  if(map[k]){ e.preventDefault(); setTool(map[k]); return; }
  if(e.key==="+"||e.key==="="){ e.preventDefault(); setZoom(state.zoom+1); return; }
  if(e.key==="-"){ e.preventDefault(); setZoom(state.zoom-1); return; }
});

// ---------- Menu Édition ----------
document.getElementById("miUndo").onclick=()=>undo();
document.getElementById("miRedo").onclick=()=>redo();
document.getElementById("miCopy").onclick=()=>{ copySelection(); setHint("Copié"); };
document.getElementById("miCut").onclick=()=>{ cutSelection(); setHint("Coupé"); };
document.getElementById("miPaste").onclick=()=>pasteClipboard();
document.getElementById("miDeleteSel").onclick=()=>deleteSelection();
