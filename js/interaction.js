import { state, view, hint, stage } from "./state.js";
import { inBounds, insideRect, render, renderSoon, clampSel, liftSelection, commitFloat, copySelection, cutSelection,
  deleteSelection, pasteClipboard, nudgeSelection, compositeToImageData, idx, layerAt, setLayerAt } from "./helpers.js";
import { snapshot, undo, redo, abortStroke } from "./history.js";
import { touchCount, penIsDown } from "./touch.js";
import { stampPlace, stampGhost, stampSpacing } from "./stamps.js";
import { stampPattern, patternFill, gradientPreview, gradientApply } from "./patterns.js";
import { brushOffsets, stamp, line, floodFill, selectSimilar, selectLasso, TRANSFORM_TOOLS, shapeToPreview, hitHandle, unrot, bakeShape, enterLayerTransform, mirrorPoints } from "./drawing.js";
import { setColor, swapColors, setTool, buildLayers, hitTextLayer, startEditTextLayer, openCanvasText, applyCrop, updateCropFields, prefs } from "./ui.js";

// ---------- Pointer interaction ----------
let downPtr=-1;     // position dans l'historique à l'appui : sert à abandonner un trait interrompu (geste à plusieurs doigts)
let drawing=false, startX=0, startY=0, lastX=0, lastY=0, creating=false, moveOrig=null, moveStart=null;
export function setHint(t){ hint.textContent = t||"—"; }
// Un deuxième doigt se pose : le geste (zoom, annuler) prend le relais. Le trait déjà commencé par le premier
// doigt est abandonné, comme dans Procreate, et ses éventuelles modifications annulées.
export function cancelDrawing(){
  if(pendingDown){ clearTimeout(pendingDown.timer); pendingDown=null; }
  state.stroking=false; state.strokeCache=null;
  if(drawing && state.histPtr>downPtr) abortStroke();       // trait en cours : on le retire de l'historique
  drawing=false; creating=false; state.previewCells=null; state.gradDrag=null; state.lasso=null; state.cropDrag=null; state.selDrag=null; state.txOp=null;
  render();
}
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
export function stampPreview(px,py){
  for(const [bx,by] of mirrorPoints(px,py))                       // l'aperçu montre la symétrie, comme le tracé validé
    for(const [dx,dy] of brushOffsets(state.brush,state.brushShape)){
      const nx=bx+dx,ny=by+dy; if(inBounds(nx,ny)) state.previewCells.set(nx+","+ny,state.color); } }

// ---------- Crayon : « pixel perfect » (retire les coins en L) et ligne droite avec Maj ----------
let ppPath=[], ppOrig=new Map(), lastPen=null;   // lastPen = dernier point tracé {x,y,id} pour Maj+clic
function penStep(px,py,L){
  if(!state.pixelPerfect || state.brush!==1 || state.mirror!=="none"){ stamp(px,py,state.color,L); return; }
  const n=ppPath.length, last=ppPath[n-1];
  if(last && last[0]===px && last[1]===py) return;
  if(n>=2){ const a=ppPath[n-2], b=last;
    const diagonal=Math.abs(px-a[0])===1 && Math.abs(py-a[1])===1;
    if(diagonal && ((b[0]===a[0]&&b[1]===py)||(b[1]===a[1]&&b[0]===px))){   // a-b-c forment un L : b est superflu
      setLayerAt(L,b[0],b[1],ppOrig.get(b[0]+","+b[1])); ppPath.pop(); } }
  const k=px+","+py; if(!ppOrig.has(k)) ppOrig.set(k,layerAt(L,px,py));
  ppPath.push([px,py]); stamp(px,py,state.color,L);
}

function onViewDown(e){
  state.pressure = e.pointerType==="pen" ? (e.pressure||0.5) : 0.5;
  state.stroking = state.tool==="pencil"||state.tool==="eraser"||state.tool==="dither"||state.tool==="stamp";   // active le cache de rendu des calques sous l'actif
  if(spaceHeld || e.button===1) return;   // laisser le pan (géré par la scène)
  if(e.pointerType==="touch" && (touchCount()>1 || penIsDown())) return;   // geste à plusieurs doigts, ou paume pendant que le stylet dessine
  downPtr=state.histPtr;
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

  if(state.tool==="lasso"){
    if(state.layers[state.active].img){ setHint("Le lasso ne s'applique pas aux calques image"); return; }
    state.lasso=[[x,y]]; drawing=true; render(); return;
  }
  if(state.tool==="select"){
    if(state.floatSel && insideRect(x,y,state.floatSel.x,state.floatSel.y,state.floatSel.w,state.floatSel.h)){ state.selDrag={mode:"floatmove",ox:x-state.floatSel.x,oy:y-state.floatSel.y}; drawing=true; return; }
    if(state.sel && !state.floatSel && insideRect(x,y,state.sel.x,state.sel.y,state.sel.w,state.sel.h) && !state.layers[state.active].img){ liftSelection(); state.selDrag={mode:"floatmove",ox:x-state.floatSel.x,oy:y-state.floatSel.y}; drawing=true; return; }
    commitFloat(); state.selDrag={mode:"new",x0:x,y0:y}; state.sel={x,y,w:1,h:1}; drawing=true; render(); return;
  }
  if(state.tool==="move"){ const L=state.layers[state.active]; snapshot(); drawing=true; moveStart={x,y};
    moveOrig={ox:L.ox||0, oy:L.oy||0}; }
  else if(state.tool==="pencil"){ const L=state.layers[state.active]; snapshot(); drawing=true; ppPath=[]; ppOrig=new Map();
    if(e.shiftKey && lastPen && lastPen.id===L.id) line(lastPen.x,lastPen.y,x,y,(px,py)=>penStep(px,py,L));   // Maj : ligne droite
    else penStep(x,y,L);
    render(); }
  else if(state.tool==="stamp"){ if(state.layers[state.active].img){ setHint("Le tampon ne s'applique pas aux calques image"); return; }
    if(!state.stamps.length){ setHint("Aucun tampon : sélectionne une zone puis Édition › Enregistrer comme tampon"); return; }
    snapshot(); drawing=true; state.previewCells=null; stampPlace(x,y); render(); }
  else if(state.tool==="gradient"){ if(state.layers[state.active].img){ setHint("Le dégradé ne s'applique pas aux calques image"); return; }
    state.gradDrag={x0:x,y0:y,x1:x,y1:y}; drawing=true; gradientPreview(); }
  else if(state.tool==="dither"){ if(state.layers[state.active].img){ setHint("Le tramage ne s'applique pas aux calques image"); return; }
    snapshot();
    if(state.ditherMode==="fill"){ patternFill(x,y); render(); }
    else { drawing=true; stampPattern(x,y,state.layers[state.active]); render(); } }
  else if(state.tool==="eraser"){ snapshot(); drawing=true; stamp(x,y,null,state.layers[state.active]); render(); }
  else if(state.tool==="fill"){ snapshot(); floodFill(x,y,state.color); render(); }
  else if(state.tool==="eyedropper"){
    const img=compositeToImageData(); const j=idx(x,y)*4;
    if(img.data[j+3]>0){ const h="#"+[img.data[j],img.data[j+1],img.data[j+2]].map(v=>v.toString(16).padStart(2,"0")).join("").toUpperCase(); setColor(h); }
  }
  else if(state.tool==="shape" && state.shapeKind==="line"){ snapshot(); drawing=true; state.previewCells=new Map(); line(x,y,x,y,stampPreview); render(); }
  else if(state.tool==="wand"){ selectSimilar(x,y,state.wandContiguous,e.shiftKey); render(); }
  else if(state.tool==="crop"){ state.cropRect={x,y,w:1,h:1}; state.cropDrag={x0:x,y0:y}; drawing=true; updateCropFields(); render(); }
  else if(state.tool==="shape" && TRANSFORM_TOOLS.has(state.shapeKind)){ creating=true; drawing=true; state.activeShape=makeShape(x,y,x,y); shapeToPreview(); render(); }
  else if(state.tool==="text"){ const hitL=hitTextLayer(x,y);
    if(hitL){ state.active=state.layers.indexOf(hitL); buildLayers(); startEditTextLayer(hitL,e.clientX,e.clientY); }
    else openCanvasText(x,y,e.clientX,e.clientY); }
}
// Au toucher, on attend un instant avant de commencer un trait : un deuxième doigt (geste de zoom / annuler) ne doit
// ni dessiner un point, ni effacer la pile « rétablir » en créant un état d'historique.
let pendingDown=null;
function flushDown(){ if(!pendingDown) return; clearTimeout(pendingDown.timer); const e=pendingDown.e; pendingDown=null; onViewDown(e); }
view.addEventListener("pointerdown",e=>{
  if(e.pointerType==="touch" && !spaceHeld && touchCount()<=1 && !penIsDown()){
    e.preventDefault(); pendingDown={e,timer:setTimeout(flushDown,70)}; return; }
  onViewDown(e);
});

view.addEventListener("pointermove",e=>{
  state.pressure = e.pointerType==="pen" ? (e.pressure||0.5) : 0.5;
  if(pendingDown){ if(Math.hypot(e.clientX-pendingDown.e.clientX,e.clientY-pendingDown.e.clientY)>3) flushDown(); else return; }
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
    shapeToPreview(); renderSoon(); return;
  }
  if(state.tool==="stamp" && !drawing){ if(inBounds(x,y)) stampGhost(x,y); setHint(inBounds(x,y)?(x+" , "+y+"   ·   tampon"):""); return; }
  if(!drawing){ setHint(inBounds(x,y)?(x+" , "+y+"   ·   "+state.tool):""); return; }

  // lasso : on prolonge le tracé d'une cellule à l'autre
  if(state.tool==="lasso" && drawing && state.lasso){
    const cx=Math.max(0,Math.min(state.W-1,x)), cy=Math.max(0,Math.min(state.H-1,y));
    const last=state.lasso[state.lasso.length-1];
    if(cx!==last[0]||cy!==last[1]){ line(last[0],last[1],cx,cy,(px,py)=>state.lasso.push([px,py])); renderSoon(); }
    return;
  }

  // recadrage : glisser pour définir la zone à conserver
  if(state.tool==="crop" && drawing && state.cropDrag){
    const x0=state.cropDrag.x0,y0=state.cropDrag.y0;
    const rx=Math.max(0,Math.min(x0,x)), ry=Math.max(0,Math.min(y0,y));
    const rw=Math.min(Math.abs(x-x0)+1, state.W-rx), rh=Math.min(Math.abs(y-y0)+1, state.H-ry);
    state.cropRect={x:rx,y:ry,w:rw,h:rh};
    updateCropFields();
    setHint("recadrer "+rw+"×"+rh); renderSoon(); return;
  }

  // sélection rectangulaire
  if(state.tool==="select" && drawing && state.selDrag){
    if(state.selDrag.mode==="new"){ const x0=state.selDrag.x0,y0=state.selDrag.y0;
      state.sel={x:Math.min(x0,x),y:Math.min(y0,y),w:Math.abs(x-x0)+1,h:Math.abs(y-y0)+1}; clampSel();
      setHint("sélection "+state.sel.w+"×"+state.sel.h); renderSoon(); return; }
    if(state.selDrag.mode==="floatmove"){ state.floatSel.x=x-state.selDrag.ox; state.floatSel.y=y-state.selDrag.oy;
      state.sel={x:state.floatSel.x,y:state.floatSel.y,w:state.floatSel.w,h:state.floatSel.h}; renderSoon(); return; }
  }

  // déplacement du contenu du calque actif
  if(state.tool==="move"){ const L=state.layers[state.active]; const dx=x-moveStart.x, dy=y-moveStart.y;
    L.ox=moveOrig.ox+dx; L.oy=moveOrig.oy+dy;
    setHint("déplacer "+(dx>=0?"+":"")+dx+", "+(dy>=0?"+":"")+dy); renderSoon(); return; }

  // création d'une forme (glisser pour définir la boîte)
  if(creating){ state.activeShape=makeShape(startX,startY,x,y,e.shiftKey); shapeToPreview(); renderSoon(); setHint(e.shiftKey?"régulier (Maj)":"relâche pour éditer"); return; }

  if(state.tool==="stamp"){
    if(Math.hypot(x-lastX,y-lastY)>=stampSpacing()){ stampPlace(x,y); lastX=x; lastY=y; renderSoon(); }
    return; }
  if(state.tool==="gradient" && state.gradDrag){ state.gradDrag.x1=x; state.gradDrag.y1=y; gradientPreview(); setHint("dégradé "+state.gradDrag.x0+","+state.gradDrag.y0+" → "+x+","+y); return; }
  if(state.tool==="dither"){ line(lastX,lastY,x,y,(px,py)=>stampPattern(px,py,state.layers[state.active])); lastX=x;lastY=y; renderSoon(); }
  else if(state.tool==="pencil"){ const L=state.layers[state.active]; line(lastX,lastY,x,y,(px,py)=>penStep(px,py,L)); lastX=x;lastY=y; renderSoon(); }
  else if(state.tool==="eraser"){ line(lastX,lastY,x,y,(px,py)=>stamp(px,py,null,state.layers[state.active])); lastX=x;lastY=y; renderSoon(); }
  else if(state.tool==="shape" && state.shapeKind==="line"){ state.previewCells=new Map(); line(startX,startY,x,y,stampPreview); renderSoon(); }
  setHint(inBounds(x,y)?(x+" , "+y):"");
});

// filet de sécurité : quoi qu'il arrive au pointeur, le cache de rendu du trait ne survit pas au geste
["pointerup","pointercancel"].forEach(n=>window.addEventListener(n,()=>{ state.stroking=false; state.strokeCache=null; },true));
view.addEventListener("pointerup",e=>{
  flushDown();
  state.stroking=false; state.strokeCache=null;
  if(!drawing) return;
  const [x,y]=cellFromEvent(e);
  if(state.tool==="gradient"){ drawing=false; gradientApply(); return; }
  if(state.tool==="pencil") lastPen={x:lastX,y:lastY,id:state.layers[state.active].id};
  if(state.tool==="lasso" && state.lasso){ const pts=state.lasso; state.lasso=null; drawing=false;
    selectLasso(pts,e.shiftKey); render(); return; }
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
view.addEventListener("pointerleave",()=>{ if(state.tool==="stamp" && state.previewCells){ state.previewCells=null; render(); }
  if(state.tool==="text" && state.previewCells && !state.activeShape && !state.textEditing){ state.previewCells=null; render(); } });

// ---------- Zoom ----------
export function setZoom(z){ state.zoom=Math.max(1,Math.min(40,z)); render(); }
document.getElementById("zoomIn").onclick=()=>setZoom(state.zoom+1);
document.getElementById("zoomOut").onclick=()=>setZoom(state.zoom-1);
document.getElementById("zoomFit").onclick=fitZoom;
export function fitZoom(){
  const pad=80; const zw=(stage.clientWidth-pad)/state.W, zh=(stage.clientHeight-pad)/state.H;
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
// Molette / pavé tactile : le défilement natif déplace le canevas (Maj = horizontal). Ctrl/⌘ + molette,
// pincement du pavé tactile, ou la préférence « molette = zoom » zooment autour du curseur ; les
// petits deltas d'un pavé tactile sont cumulés pour qu'un pincement ne saute pas de niveau à chaque événement.
let wheelAcc=0;
stage.addEventListener("wheel",e=>{ if(!prefs.wheelZoom && !e.ctrlKey && !e.metaKey) return; e.preventDefault();
  wheelAcc+=e.deltaMode===1 ? e.deltaY*33 : e.deltaY;
  const steps=Math.trunc(Math.abs(wheelAcc)/(Math.abs(e.deltaY)>=50?50:40));
  if(!steps) return;
  const dir=wheelAcc<0?1:-1; wheelAcc=0;
  const rect=view.getBoundingClientRect();
  const cx=(e.clientX-rect.left)/state.zoom, cy=(e.clientY-rect.top)/state.zoom;   // cellule sous le curseur
  const old=state.zoom; setZoom(state.zoom+dir*Math.min(steps,3));
  if(state.zoom!==old){ const nr=view.getBoundingClientRect();
    stage.scrollLeft += (nr.left + cx*state.zoom) - e.clientX;
    stage.scrollTop  += (nr.top  + cy*state.zoom) - e.clientY; }
},{passive:false});

// ---------- Empêcher les raccourcis de recherche du navigateur ----------
// L'éditeur utilise énormément de lettres seules comme raccourcis (b, e, g, i, f, c…) ;
// les raccourcis de recherche de Firefox (même ceux qu'on n'utilise pas ici) doivent être
// neutralisés pour ne jamais interrompre le dessin ou détourner le focus du clavier.
window.addEventListener("keydown",e=>{
  const k=e.key.toLowerCase();
  const isBrowserFind=
    ((e.ctrlKey||e.metaKey) && !e.altKey && (k==="f"||k==="g")) ||   // Rechercher / Suivant
    e.key==="F3" ||                                                  // Suivant / (Maj) Précédent
    (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key==="/"||e.key==="'")   // Recherche rapide Firefox
      && e.target.tagName!=="INPUT" && e.target.tagName!=="TEXTAREA" && !state.textEditing);
  if(isBrowserFind) e.preventDefault();
});

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
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="v") return;   // géré par l'événement « paste » (files.js) : image du système ou presse-papiers interne
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="t"){ e.preventDefault(); enterLayerTransform(); return; }
  if(e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase()==="t"){ e.preventDefault(); enterLayerTransform(); return; }
  if((e.key==="Delete"||e.key==="Backspace") && (state.sel||state.floatSel)){ e.preventDefault(); deleteSelection(); return; }
  if((e.key.startsWith("Arrow")) && (state.sel||state.floatSel)){ e.preventDefault(); const n=e.shiftKey?10:1;
    if(e.key==="ArrowLeft") nudgeSelection(-n,0); else if(e.key==="ArrowRight") nudgeSelection(n,0);
    else if(e.key==="ArrowUp") nudgeSelection(0,-n); else if(e.key==="ArrowDown") nudgeSelection(0,n); return; }
  const map={s:"stamp",v:"move",m:"select",l:"lasso",d:"gradient",h:"dither",w:"wand",c:"crop",b:"pencil",e:"eraser",g:"fill",i:"eyedropper",f:"shape",t:"text"};
  const k=e.key.toLowerCase();
  if(e.ctrlKey||e.metaKey||e.altKey) return;   // laisser les raccourcis navigateur
  if(k==="x"){ e.preventDefault(); swapColors(); return; }
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
