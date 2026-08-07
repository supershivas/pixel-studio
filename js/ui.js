import { state, PALETTE, stage } from "./state.js";
import { render, commitFloat, bakeOffset, idx, inBounds, layerPixels, hexToRgb, compositeLayers, newLayer, newImageLayer } from "./helpers.js";
import { snapshot, history } from "./history.js";
import { bakeShape, cancelShape, shapeToPreview, updateTextGlyph, textPreview, commitText, rasterizeMicro, rasterizeTTF, textLabel } from "./drawing.js";
import { setHint, fitZoom } from "./interaction.js";
import { syncPresetToSize } from "./io.js";

// ---------- Tools UI ----------
const TOOLS=[
  {id:"move",    k:"V", label:"Déplacer le calque", svg:'<path d="M12 3l3 3h-2v5h5V9l3 3-3 3v-2h-5v5h2l-3 3-3-3h2v-5H6v2l-3-3 3-3v2h5V6H9z" fill="currentColor"/>'},
  {id:"select",  k:"M", label:"Sélection rectangulaire", svg:'<rect x="4" y="5" width="16" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/>'},
  {sep:true},
  {id:"pencil",  k:"B", label:"Crayon",   svg:'<path d="M4 20l3-1 11-11-2-2L5 17l-1 3z" fill="none" stroke="currentColor" stroke-width="1.6"/>'},
  {id:"eraser",  k:"E", label:"Gomme",    svg:'<rect x="6" y="11" width="12" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 11l4-4 5 5-3 3" fill="none" stroke="currentColor" stroke-width="1.6"/>'},
  {id:"fill",    k:"G", label:"Pot",      svg:'<path d="M6 12l6-6 6 6-6 6z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M18 15c1 1.5 1 3 0 3s-1-1.5 0-3z" fill="currentColor"/>'},
  {id:"eyedropper",k:"I",label:"Pipette", svg:'<path d="M4 20l2 0 8-8 2 2-8 8 0 2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M14 6l4 4 1-1a2 2 0 00-3-3z" fill="currentColor"/>'},
  {sep:true},
  {id:"line",    k:"L", label:"Ligne",    svg:'<path d="M5 19L19 5" stroke="currentColor" stroke-width="1.8"/>'},
  {id:"rect",    k:"R", label:"Rectangle",svg:'<rect x="5" y="7" width="14" height="10" fill="none" stroke="currentColor" stroke-width="1.6"/>'},
  {id:"ellipse", k:"O", label:"Ellipse",  svg:'<ellipse cx="12" cy="12" rx="7" ry="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/>'},
  {sep:true},
  {id:"star",    k:"S", label:"Étoile",   svg:'<path d="M12 4l2.3 4.8 5.3.7-3.9 3.7 1 5.3-4.7-2.6-4.7 2.6 1-5.3L4.4 9.5l5.3-.7z" fill="currentColor"/>'},
  {id:"heart",   k:"H", label:"Cœur",     svg:'<path d="M12 19S5 14.5 5 9.6C5 7 7 5.5 9 6c1.3.3 2.4 1.4 3 2.4C12.6 7.4 13.7 6.3 15 6c2-.5 4 1 4 3.6 0 4.9-7 9.4-7 9.4z" fill="currentColor"/>'},
  {id:"triangle",k:"U", label:"Triangle", svg:'<path d="M12 5l7 13H5z" fill="none" stroke="currentColor" stroke-width="1.6"/>'},
  {id:"diamond", k:"D", label:"Losange",  svg:'<path d="M12 4l7 8-7 8-7-8z" fill="none" stroke="currentColor" stroke-width="1.6"/>'},
  {sep:true},
  {id:"text",    k:"T", label:"Texte", svg:'<path d="M5 6h14M12 6v13M9 19h6" fill="none" stroke="currentColor" stroke-width="1.8"/>'},
];
const rail=document.getElementById("rail");
TOOLS.forEach(t=>{
  if(t.sep){ const s=document.createElement("div"); s.className="sep"; rail.appendChild(s); return; }
  const b=document.createElement("button");
  b.className="tool"+(t.id===state.tool?" active":""); b.dataset.tool=t.id; b.title=t.label+" ("+t.k+")";
  b.innerHTML='<svg viewBox="0 0 24 24">'+t.svg+'</svg><span class="kbd">'+t.k+'</span>';
  b.addEventListener("click",()=>setTool(t.id));
  rail.appendChild(b);
});
export function setTool(id){
  if(state.activeShape) bakeShape();
  if(typeof state.textEditing!=="undefined" && state.textEditing && id!=="text") commitCanvasText();
  if(state.tool==="select" && id!=="select"){ commitFloat(); state.sel=null; }
  state.tool=id;
  [...rail.querySelectorAll(".tool")].forEach(el=>el.classList.toggle("active",el.dataset.tool===id));
  document.getElementById("textOpts").hidden = id!=="text";
  if(id!=="text" && state.previewCells){ state.previewCells=null; render(); }
  render();
}

// ---------- Palette UI ----------
const swatches=document.getElementById("swatches");
export function buildSwatches(){
  swatches.innerHTML="";
  const all=PALETTE.concat(state.customColors);
  all.forEach((c,i)=>{ const isCustom=i>=PALETTE.length;
    const s=document.createElement("button"); s.className="sw"+(c.toUpperCase()===state.color?" sel":"");
    s.style.background=c; s.dataset.c=c.toUpperCase(); s.title=isCustom?(c+" — clic droit pour retirer"):c;
    s.addEventListener("click",()=>setColor(c));
    if(isCustom) s.addEventListener("contextmenu",e=>{ e.preventDefault(); state.customColors=state.customColors.filter(x=>x.toUpperCase()!==c.toUpperCase()); buildSwatches(); });
    swatches.appendChild(s);
  });
}
function mixHex(hex,target,t){ const [r,g,b]=hexToRgb(hex),[tr,tg,tb]=hexToRgb(target);
  const m=(a,b)=>Math.round(a+(b-a)*t);
  return "#"+[m(r,tr),m(g,tg),m(b,tb)].map(v=>v.toString(16).padStart(2,"0")).join("").toUpperCase(); }
const lighter=h=>mixHex(h,"#FFFFFF",0.35), darker=h=>mixHex(h,"#000000",0.35);
export function setColor(c){
  state.color=c.toUpperCase();
  [...swatches.children].forEach(el=>el.classList.toggle("sel",el.dataset.c===state.color));
  document.getElementById("curChip").style.background=state.color;
  document.getElementById("curHex").textContent=state.color;
  document.getElementById("shadeDark").style.background=darker(state.color);
  document.getElementById("shadeLight").style.background=lighter(state.color);
  if(state.activeShape){ state.activeShape.color=state.color; shapeToPreview(); render(); }
}
document.getElementById("shadeDark").onclick=()=>setColor(darker(state.color));
document.getElementById("shadeLight").onclick=()=>setColor(lighter(state.color));

// ---------- Color picker intégré (HSV) ----------
function hsvToRgb(h,s,v){ h=(h%360+360)%360; const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c; let r,g,b;
  if(h<60)[r,g,b]=[c,x,0]; else if(h<120)[r,g,b]=[x,c,0]; else if(h<180)[r,g,b]=[0,c,x];
  else if(h<240)[r,g,b]=[0,x,c]; else if(h<300)[r,g,b]=[x,0,c]; else [r,g,b]=[c,0,x];
  return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)]; }
function rgbToHex(r,g,b){ return "#"+[r,g,b].map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,"0")).join("").toUpperCase(); }
function rgbToHsv(r,g,b){ r/=255;g/=255;b/=255; const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn; let h=0;
  if(d){ if(mx===r)h=((g-b)/d)%6; else if(mx===g)h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; if(h<0)h+=360; }
  return [h, mx?d/mx:0, mx]; }
function hexToHsvSafe(hex){ hex=(hex||"").replace("#",""); if(hex.length===3) hex=hex.split("").map(c=>c+c).join("");
  if(!/^[0-9a-fA-F]{6}$/.test(hex)) return null; const [r,g,b]=hexToRgb("#"+hex); return rgbToHsv(r,g,b); }
const colorPop=document.getElementById("colorPop"), cpSV=document.getElementById("cpSV"), cpHue=document.getElementById("cpHue");
const cpSVThumb=document.getElementById("cpSVThumb"), cpHueThumb=document.getElementById("cpHueThumb");
const cpPreview=document.getElementById("cpPreview"), cpHex=document.getElementById("cpHex");
let cpH=210, cpS=1, cpV=0.6;
function cpHexNow(){ const [r,g,b]=hsvToRgb(cpH,cpS,cpV); return rgbToHex(r,g,b); }
function updatePicker(writeHex=true){
  cpSV.style.setProperty("--huecol", `hsl(${cpH},100%,50%)`);
  cpSVThumb.style.left=(cpS*100)+"%"; cpSVThumb.style.top=((1-cpV)*100)+"%";
  cpHueThumb.style.left=(cpH/360*100)+"%";
  const hex=cpHexNow(); cpPreview.style.background=hex; if(writeHex) cpHex.value=hex;
}
function dragControl(el, handler){
  el.addEventListener("pointerdown",e=>{ e.preventDefault(); el.setPointerCapture(e.pointerId); handler(e);
    const mv=ev=>handler(ev); const up=()=>{ el.removeEventListener("pointermove",mv); el.removeEventListener("pointerup",up); el.removeEventListener("pointercancel",up); };
    el.addEventListener("pointermove",mv); el.addEventListener("pointerup",up); el.addEventListener("pointercancel",up); });
}
dragControl(cpSV, e=>{ const r=cpSV.getBoundingClientRect();
  cpS=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
  cpV=Math.max(0,Math.min(1,1-(e.clientY-r.top)/r.height)); updatePicker(); });
dragControl(cpHue, e=>{ const r=cpHue.getBoundingClientRect();
  cpH=Math.max(0,Math.min(360,(e.clientX-r.left)/r.width*360)); updatePicker(); });
cpHex.addEventListener("input",()=>{ const hs=hexToHsvSafe(cpHex.value); if(hs){ [cpH,cpS,cpV]=hs; updatePicker(false); } });
cpHex.addEventListener("keydown",e=>{ e.stopPropagation(); if(e.key==="Enter"){ e.preventDefault(); cpAddColor(); } });
function cpAddColor(){ const hex=cpHexNow();
  if(_cpCb){ const cb=_cpCb; _cpCb=null; closeColorPop(); cb(hex); return; }
  const known=PALETTE.concat(state.customColors).map(x=>x.toUpperCase());
  if(!known.includes(hex)) state.customColors.push(hex);
  buildSwatches(); setColor(hex); closeColorPop(); }
document.getElementById("cpAdd").onclick=cpAddColor;
let _cpCb=null;
function openColorPicker(anchorEl, initialHex, cb){ _cpCb=cb||null;
  const hs=hexToHsvSafe(initialHex)||[210,1,0.6]; [cpH,cpS,cpV]=hs; updatePicker();
  document.getElementById("cpAdd").textContent=_cpCb?"OK":"Ajouter";
  colorPop.hidden=false; const r=anchorEl.getBoundingClientRect();
  colorPop.style.left=Math.max(8,Math.min(r.left-150, window.innerWidth-200))+"px";
  colorPop.style.top=Math.min(r.bottom+6, window.innerHeight-220)+"px"; }
function closeColorPop(){ colorPop.hidden=true; _cpCb=null; }
document.getElementById("addColorBtn").onclick=e=>{ e.stopPropagation(); closeMenus(); if(colorPop.hidden) openColorPicker(document.getElementById("addColorBtn"), state.color, null); else closeColorPop(); };
document.addEventListener("click",e=>{ if(!colorPop.hidden && !colorPop.contains(e.target) && e.target.id!=="addColorBtn" && !e.target.classList.contains("fxsw")) closeColorPop(); });

// ---------- Effets de calque (double-clic) ----------
let fxLayer=null;
function ensureFx(L){ if(!L.fx) L.fx={color:null,stroke:{on:false,width:1,color:"#141428"},shadow:{on:false,dx:1,dy:1,color:"#141428"}}; return L.fx; }
function reRasterTextLayer(L){ const t=L.text; if(!t) return;
  const g=(t.font==="micro")?rasterizeMicro(t.string,t.scale):rasterizeTTF(t.string,t.font,t.scale);
  const ax=t.ax+(L.ox||0), ay=t.ay+(L.oy||0);
  L.data=new Array(state.W*state.H).fill(null); L.ox=0; L.oy=0; t.ax=ax; t.ay=ay;
  for(const [dx,dy] of g.cells){ const x=ax+dx,y=ay+dy; if(inBounds(x,y)) L.data[idx(x,y)]=t.color; } }
function recolorLayer(L,hex){ if(L.img) return; snapshot();
  if(L.text){ L.text.color=hex; reRasterTextLayer(L); }
  else { for(let i=0;i<L.data.length;i++) if(L.data[i]!==null) L.data[i]=hex; }
  state.thumbsDirty=true; render(); buildLayers(); }
function fxApply(){ state.thumbsDirty=true; render(); buildLayers(); }
function openFxModal(L){
  fxLayer=L; const isImg=!!L.img; const fx=ensureFx(L);
  document.getElementById("fxBlend").value=L.blend||"normal";
  ["fxColor","fxStrokeOn","fxStrokeW","fxStrokeColor","fxShadowOn","fxShadowDX","fxShadowDY","fxShadowColor","fxResetBtn"]
    .forEach(id=>{ document.getElementById(id).disabled=isImg; });
  document.getElementById("fxColor").style.background=(L.text&&L.text.color)||state.color;
  document.getElementById("fxStrokeOn").checked=fx.stroke.on;
  document.getElementById("fxStrokeW").value=fx.stroke.width;
  document.getElementById("fxStrokeColor").style.background=fx.stroke.color;
  document.getElementById("fxShadowOn").checked=fx.shadow.on;
  document.getElementById("fxShadowDX").value=fx.shadow.dx;
  document.getElementById("fxShadowDY").value=fx.shadow.dy;
  document.getElementById("fxShadowColor").style.background=fx.shadow.color;
  document.getElementById("fxModal").classList.add("open");
}
document.getElementById("fxBlend").onchange=e=>{ if(fxLayer){ fxLayer.blend=e.target.value; fxApply(); } };
const _fx=()=>fxLayer?ensureFx(fxLayer):null;
document.getElementById("fxColor").onclick=()=>{ if(!fxLayer) return; openColorPicker(document.getElementById("fxColor"), (fxLayer.text&&fxLayer.text.color)||state.color, hex=>{ recolorLayer(fxLayer,hex); document.getElementById("fxColor").style.background=hex; }); };
document.getElementById("fxStrokeOn").onchange=e=>{ const f=_fx(); if(f){ f.stroke.on=e.target.checked; fxApply(); } };
document.getElementById("fxStrokeW").oninput=e=>{ const f=_fx(); if(f){ f.stroke.width=+e.target.value; if(f.stroke.on) fxApply(); } };
document.getElementById("fxStrokeColor").onclick=()=>{ const f=_fx(); if(!f) return; openColorPicker(document.getElementById("fxStrokeColor"), f.stroke.color, hex=>{ f.stroke.color=hex; document.getElementById("fxStrokeColor").style.background=hex; if(f.stroke.on) fxApply(); }); };
document.getElementById("fxShadowOn").onchange=e=>{ const f=_fx(); if(f){ f.shadow.on=e.target.checked; fxApply(); } };
document.getElementById("fxShadowDX").oninput=e=>{ const f=_fx(); if(f){ f.shadow.dx=+e.target.value||0; if(f.shadow.on) fxApply(); } };
document.getElementById("fxShadowDY").oninput=e=>{ const f=_fx(); if(f){ f.shadow.dy=+e.target.value||0; if(f.shadow.on) fxApply(); } };
document.getElementById("fxShadowColor").onclick=()=>{ const f=_fx(); if(!f) return; openColorPicker(document.getElementById("fxShadowColor"), f.shadow.color, hex=>{ f.shadow.color=hex; document.getElementById("fxShadowColor").style.background=hex; if(f.shadow.on) fxApply(); }); };
document.getElementById("fxResetBtn").onclick=()=>{ if(fxLayer){ fxLayer.fx=null; ensureFx(fxLayer);
  const fx=fxLayer.fx; document.getElementById("fxStrokeOn").checked=false; document.getElementById("fxStrokeW").value=1;
  document.getElementById("fxShadowOn").checked=false; document.getElementById("fxShadowDX").value=1; document.getElementById("fxShadowDY").value=1;
  document.getElementById("fxStrokeColor").style.background=fx.stroke.color; document.getElementById("fxShadowColor").style.background=fx.shadow.color; fxApply(); } };
document.getElementById("fxClose").onclick=()=>document.getElementById("fxModal").classList.remove("open");
document.getElementById("fxOk").onclick=()=>document.getElementById("fxModal").classList.remove("open");
document.getElementById("fxModal").addEventListener("click",e=>{ if(e.target.id==="fxModal") e.currentTarget.classList.remove("open"); });
buildSwatches();

// ---------- Layers UI ----------
const layersEl=document.getElementById("layers");
let dragId=null;
let _lastLayerClick={id:null,t:0};
function clearDropMarks(){ [...layersEl.children].forEach(el=>el.classList.remove("drop-above","drop-below")); }
function moveLayer(srcId,tgtId,above){
  if(srcId===tgtId) return;
  snapshot();
  const activeId=state.layers[state.active].id;
  let vis=state.layers.slice().reverse();                 // haut de pile -> bas
  const s=vis.findIndex(l=>l.id===srcId); if(s<0) return;
  const [moved]=vis.splice(s,1);
  let t=vis.findIndex(l=>l.id===tgtId); if(t<0) t=vis.length; else t=above?t:t+1;
  vis.splice(t,0,moved);
  state.layers=vis.reverse();
  state.active=state.layers.findIndex(l=>l.id===activeId);
  buildLayers(); render();
}
export function buildLayers(){
  layersEl.innerHTML="";
  for(let i=state.layers.length-1;i>=0;i--){            // haut de la fenêtre = haut de la pile
    const L=state.layers[i];
    const row=document.createElement("div");
    row.className="layer"+(i===state.active?" active":"")+(L.img?" imglayer":"");
    row.draggable=true; row.dataset.id=L.id;
    const grip=document.createElement("span"); grip.className="grip"; grip.textContent="⠿"; grip.title="Glisser pour réordonner";
    const vis=document.createElement("button");
    vis.className="vis"+(L.visible?" on":""); vis.title="Visibilité";
    vis.innerHTML=L.visible?'<svg width="16" height="16" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>':'<svg width="16" height="16" viewBox="0 0 24 24"><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.6"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".5"/></svg>';
    vis.addEventListener("click",e=>{e.stopPropagation();L.visible=!L.visible;buildLayers();render();});
    const thumb=document.createElement("canvas"); thumb.className="thumb"; thumb.width=state.W; thumb.height=state.H;
    thumb._layer=L;
    const col=document.createElement("div"); col.className="lcol";
    const nm=document.createElement("input"); nm.className="nm"; nm.value=L.name;
    nm.addEventListener("input",()=>L.name=nm.value);
    nm.addEventListener("click",e=>e.stopPropagation());
    nm.addEventListener("focus",()=>row.draggable=false);
    nm.addEventListener("blur",()=>row.draggable=true);
    const op=document.createElement("input"); op.type="range"; op.className="op-row"; op.min=0; op.max=100; op.value=Math.round(L.opacity*100); op.title="Opacité";
    op.addEventListener("input",e=>{ L.opacity=e.target.value/100; render(); });
    op.addEventListener("click",e=>e.stopPropagation());
    op.addEventListener("mousedown",()=>row.draggable=false);
    op.addEventListener("mouseup",()=>row.draggable=true);
    col.append(nm,op);
    if(L.img){ const b=document.createElement("span"); b.className="imgbadge"; b.textContent="IMG"; b.title="Calque image (référence, non exporté)"; row.append(grip,vis,thumb,col,b); }
    else row.append(grip,vis,thumb,col);
    row.addEventListener("click",()=>{ if(state.activeShape) bakeShape(); if(state.floatSel) commitFloat(); const ni=state.layers.indexOf(L); if(ni>=0) state.active=ni;
      const now=Date.now();
      if(_lastLayerClick.id===L.id && now-_lastLayerClick.t<350){ _lastLayerClick={id:null,t:0}; buildLayers(); openFxModal(L); return; }
      _lastLayerClick={id:L.id,t:now}; buildLayers(); });
    row.addEventListener("dragstart",e=>{ dragId=L.id; row.classList.add("dragging"); e.dataTransfer.effectAllowed="move"; try{e.dataTransfer.setData("text/plain",String(L.id));}catch(_){} });
    row.addEventListener("dragend",()=>{ row.classList.remove("dragging"); clearDropMarks(); dragId=null; });
    row.addEventListener("dragover",e=>{ if(dragId==null) return; e.preventDefault(); const r=row.getBoundingClientRect(); const above=(e.clientY-r.top)<r.height/2; clearDropMarks(); row.classList.add(above?"drop-above":"drop-below"); });
    row.addEventListener("dragleave",()=>row.classList.remove("drop-above","drop-below"));
    row.addEventListener("drop",e=>{ e.preventDefault(); const r=row.getBoundingClientRect(); const above=(e.clientY-r.top)<r.height/2; clearDropMarks(); if(dragId!=null) moveLayer(dragId,L.id,above); dragId=null; });
    layersEl.appendChild(row);
  }
  refreshThumbs();
}
export function refreshThumbs(){
  [...layersEl.querySelectorAll(".thumb")].forEach(t=>{
    const L=t._layer; const ctx=t.getContext("2d");
    ctx.clearRect(0,0,state.W,state.H);
    if(L.text){ ctx.fillStyle=L.text.color||"#e8edf7";
      const bw=Math.round(state.W*0.62), bx=Math.round((state.W-bw)/2), by=Math.round(state.H*0.18), bh=Math.max(1,Math.round(state.H*0.16));
      ctx.fillRect(bx,by,bw,bh);
      const sw=Math.max(1,Math.round(state.W*0.16)), sx=Math.round((state.W-sw)/2);
      ctx.fillRect(sx,by,sw,Math.round(state.H*0.62)); return; }
    if(L.img){ if(L._imgEl&&L._imgEl.complete&&L._imgEl.naturalWidth){ ctx.imageSmoothingEnabled=true;
        const s=Math.min(state.W/L._imgEl.naturalWidth,state.H/L._imgEl.naturalHeight); const w=L._imgEl.naturalWidth*s,h=L._imgEl.naturalHeight*s;
        ctx.drawImage(L._imgEl,(state.W-w)/2,(state.H-h)/2,w,h); } return; }
    const im=ctx.createImageData(state.W,state.H);
    for(const [k,hex] of layerPixels(L)){ const [gx,gy]=k.split(",").map(Number);
      const j=(gy*state.W+gx)*4; const [r,g,b]=hexToRgb(hex); im.data[j]=r;im.data[j+1]=g;im.data[j+2]=b;im.data[j+3]=255; }
    ctx.putImageData(im,0,0);
  });
}
function addLayerAction(){ snapshot(); state.layers.splice(state.active+1,0,newLayer("Calque "+state.layerSeq)); state.active++; buildLayers(); render(); }
function duplicateLayer(i){ if(i<0||i>=state.layers.length) return; snapshot(); const src=state.layers[i];
  const c=src.img ? newImageLayer(src.img.dataURL, src.name+" copie")
                  : {...src,id:state.layerSeq++,name:src.name+" copie",data:src.data.slice(),text:src.text?{...src.text}:null,fx:src.fx?JSON.parse(JSON.stringify(src.fx)):null};
  if(!src.img) c.opacity=src.opacity;
  state.layers.splice(i+1,0,c); state.active=i+1; buildLayers(); render(); }
function doDeleteLayer(i){ if(i<0||i>=state.layers.length||state.layers.length<=1) return;
  snapshot(); state.layers.splice(i,1);
  state.active = state.active>i ? state.active-1 : (state.active===i ? Math.max(0,i-1) : state.active);
  state.active=Math.min(state.active,state.layers.length-1); buildLayers(); render(); }
function deleteLayer(i){ if(i<0||i>=state.layers.length||state.layers.length<=1) return;
  const L=state.layers[i]; askConfirm("Supprimer ce calque ?", ()=>{ const j=state.layers.indexOf(L); if(j>=0) doDeleteLayer(j); }); }
// ---------- Modale de confirmation ----------
let _confirmYes=null;
function askConfirm(msg, onYes){
  if(!prefs.confirm){ onYes(); return; }
  _confirmYes=onYes;
  document.getElementById("confirmMsg").textContent=msg;
  document.getElementById("confirmDontAsk").checked=false;
  document.getElementById("confirmModal").classList.add("open");
}
function closeConfirm(){ document.getElementById("confirmModal").classList.remove("open"); _confirmYes=null; }
document.getElementById("confirmCancel").onclick=closeConfirm;
document.getElementById("confirmModal").addEventListener("click",e=>{ if(e.target.id==="confirmModal") closeConfirm(); });
document.getElementById("confirmOk").onclick=()=>{
  if(document.getElementById("confirmDontAsk").checked){ prefs.confirm=false; savePrefs(); applyPrefs(); }
  const yes=_confirmYes; closeConfirm(); if(yes) yes();
};
document.getElementById("addLayer").onclick=addLayerAction;
document.getElementById("addLayerBtn").onclick=addLayerAction;
document.getElementById("dupLayer").onclick=()=>{ if(state.activeShape) bakeShape(); duplicateLayer(state.active); };
document.getElementById("delLayer").onclick=()=>{ if(state.activeShape) bakeShape(); deleteLayer(state.active); };
document.getElementById("delLayerBtn").onclick=()=>{ if(state.activeShape) bakeShape(); deleteLayer(state.active); };
// cibles de dépôt : glisser un calque sur + = dupliquer, sur poubelle = supprimer
function makeLayerDrop(btn, action){
  btn.addEventListener("dragover",e=>{ if(dragId==null) return; e.preventDefault(); btn.classList.add("drop-hot"); });
  btn.addEventListener("dragleave",()=>btn.classList.remove("drop-hot"));
  btn.addEventListener("drop",e=>{ e.preventDefault(); btn.classList.remove("drop-hot");
    const id=dragId; dragId=null; const i=state.layers.findIndex(L=>L.id===id); if(i>=0) action(i); });
}
makeLayerDrop(document.getElementById("addLayerBtn"), duplicateLayer);
makeLayerDrop(document.getElementById("delLayerBtn"), deleteLayer);
document.getElementById("clearLayer").onclick=()=>{ if(state.layers[state.active].img) return; snapshot(); state.layers[state.active].data.fill(null); state.layers[state.active].ox=0; state.layers[state.active].oy=0; render(); buildLayers(); };
document.getElementById("mergeLayer").onclick=()=>{ if(state.activeShape) bakeShape();
  if(state.active<=0){ setHint("Aucun calque en dessous où fusionner."); return; }
  const A=state.layers[state.active], B=state.layers[state.active-1];
  if(A.img||B.img){ alert("La fusion ne concerne que les calques de dessin (pas les calques image)."); return; }
  snapshot();
  for(let i=0;i<B.data.length;i++){ if(A.data[i]!==null) B.data[i]=A.data[i]; } // A par-dessus B
  state.layers.splice(state.active,1); state.active=state.active-1; buildLayers(); render(); };
document.getElementById("flattenLayers").onclick=()=>{ if(state.activeShape) bakeShape();
  if(state.layers.filter(L=>!L.img).length<2){ setHint("Rien à aplatir."); return; }
  if(prefs.confirm && !confirm("Aplatir tous les calques de dessin visibles en un seul ? (opacités fusionnées ; calques image conservés)")) return;
  snapshot();
  const img=compositeLayers(state.layers).data;      // compositing correct : opacité + mélange des couleurs
  const merged=new Array(state.W*state.H).fill(null);
  for(let i=0;i<state.W*state.H;i++){ const a=img[i*4+3]; if(a<128) continue;
    merged[i]="#"+[img[i*4],img[i*4+1],img[i*4+2]].map(v=>v.toString(16).padStart(2,"0")).join("").toUpperCase(); }
  const flat=newLayer("Aplati"); flat.data=merged;
  const firstPx=state.layers.findIndex(L=>!L.img);
  const rebuilt=[];
  state.layers.forEach((L,i)=>{ if(L.img) rebuilt.push(L); else if(i===firstPx) rebuilt.push(flat); });
  state.layers=rebuilt; state.active=state.layers.indexOf(flat); buildLayers(); render(); };
// ---------- Import d'image (nouveau calque de référence) ----------
document.getElementById("miImportImg").onclick=()=>document.getElementById("imgFile").click();
document.getElementById("imgFile").onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{ if(state.activeShape) bakeShape(); snapshot();
    const L=newImageLayer(rd.result, f.name.replace(/\.[^.]+$/,"").slice(0,20)||"Image");
    state.layers.splice(state.active+1,0,L); state.active++; buildLayers(); render(); };
  rd.readAsDataURL(f); e.target.value="";
};


// ---------- Options ----------
// ---------- Saisie de texte sur le canevas ----------
const canvasText=document.getElementById("canvasText");
function autoSizeText(){ /* champ invisible : rien à dimensionner */ }
export function measureLineW(str){ if(!str) return 0; const g=(state.textFont==="micro")?rasterizeMicro(str,state.textScale):rasterizeTTF(str,state.textFont,state.textScale); return g.w; }
let editingLayer=null, editingOrig=null;
function textLayerGlyph(t){ return (t.font==="micro")?rasterizeMicro(t.string,t.scale):rasterizeTTF(t.string,t.font,t.scale); }
export function hitTextLayer(gx,gy){
  for(let i=state.layers.length-1;i>=0;i--){ const L=state.layers[i]; if(!L.text||L.img||!L.visible) continue;
    const g=textLayerGlyph(L.text); if(!g.w) continue;
    const x0=L.text.ax+(L.ox||0), y0=L.text.ay+(L.oy||0);
    if(gx>=x0-1 && gy>=y0-1 && gx<=x0+g.w && gy<=y0+g.h) return L;
  }
  return null;
}
export function openCanvasText(cx,cy,clientX,clientY){
  if(state.activeShape) bakeShape();
  if(state.textEditing){ if(state.textString.trim()) commitCanvasText(); else closeCanvasText(); }
  editingLayer=null; editingOrig=null;
  state.textAnchor={x:cx,y:cy}; state.textEditing=true; state.textString=""; state.caretOn=true;
  canvasText.value=""; canvasText.classList.add("on");
  canvasText.style.left=Math.min(clientX,window.innerWidth-120)+"px";
  canvasText.style.top=Math.min(clientY,window.innerHeight-60)+"px";
  autoSizeText(); updateTextGlyph(); state.previewCells=null; render();
  setTimeout(()=>canvasText.focus(),0);
  setHint("Tape ton texte · Entrée valide · Échap annule");
}
export function startEditTextLayer(L,clientX,clientY){
  if(state.activeShape) bakeShape();
  if(state.textEditing){ if(state.textString.trim()) commitCanvasText(); else closeCanvasText(); }
  snapshot();
  editingLayer=L; editingOrig={data:L.data.slice(), ox:L.ox||0, oy:L.oy||0, text:L.text?{...L.text}:null};
  state.textFont=L.text.font; state.textScale=L.text.scale; setColor(L.text.color);
  document.getElementById("textFont").value=state.textFont;
  document.getElementById("textScale").value=state.textScale; document.getElementById("textScaleV").textContent=state.textScale+"×";
  state.textAnchor={x:L.text.ax+(L.ox||0), y:L.text.ay+(L.oy||0)}; state.textString=L.text.string; state.textEditing=true; state.caretOn=true;
  L.data=new Array(state.W*state.H).fill(null); L.ox=0; L.oy=0;
  canvasText.value=state.textString; canvasText.classList.add("on");
  canvasText.style.left=Math.min(clientX,window.innerWidth-120)+"px";
  canvasText.style.top=Math.min(clientY,window.innerHeight-60)+"px";
  updateTextGlyph(); textPreview(state.textAnchor.x,state.textAnchor.y); render();
  setTimeout(()=>{ canvasText.focus(); try{canvasText.select();}catch(_){} },0);
  setHint("Édite le texte · Entrée valide · Échap annule");
}
function closeCanvasText(){ state.textEditing=false; editingLayer=null; editingOrig=null; canvasText.classList.remove("on"); state.textString=""; state.previewCells=null; updateTextGlyph(); render(); }
export function commitCanvasText(){ if(!state.textEditing) return; const anchor=state.textAnchor;
  if(editingLayer){ const L=editingLayer;
    L.data=new Array(state.W*state.H).fill(null); L.ox=0; L.oy=0;
    if(state.textGlyph.cells.length){
      for(const [dx,dy] of state.textGlyph.cells){ const x=anchor.x+dx,y=anchor.y+dy; if(inBounds(x,y)) L.data[idx(x,y)]=state.color; }
      L.text={string:state.textString,font:state.textFont,scale:state.textScale,color:state.color,ax:anchor.x,ay:anchor.y};
      L.name=textLabel(state.textString);
    }
    closeCanvasText(); buildLayers(); render(); return;
  }
  if(state.textGlyph.cells.length){ snapshot(); commitText(anchor.x,anchor.y); }
  closeCanvasText();
}
function cancelCanvasText(){ if(editingLayer && editingOrig){ editingLayer.data=editingOrig.data; editingLayer.ox=editingOrig.ox; editingLayer.oy=editingOrig.oy; editingLayer.text=editingOrig.text; }
  closeCanvasText(); buildLayers(); render(); }
canvasText.addEventListener("input",()=>{ state.textString=canvasText.value; state.caretOn=true; updateTextGlyph(); autoSizeText();
  if(state.textGlyph.cells.length) textPreview(state.textAnchor.x,state.textAnchor.y); else state.previewCells=null; render(); });
canvasText.addEventListener("keydown",e=>{
  e.stopPropagation();                              // ne pas déclencher les raccourcis d'outils
  if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); commitCanvasText(); }
  else if(e.key==="Escape"){ e.preventDefault(); cancelCanvasText(); }
});
canvasText.addEventListener("blur",()=>{ if(state.textEditing){ if(state.textString.trim()) commitCanvasText(); else cancelCanvasText(); } });

document.getElementById("brush").oninput=e=>{ state.brush=+e.target.value; document.getElementById("brushV").textContent=state.brush; };
document.getElementById("fillShape").onchange=e=>{ state.fillShape=e.target.checked; if(state.activeShape){ state.activeShape.filled=state.fillShape; shapeToPreview(); render(); } };
document.getElementById("strokeW").oninput=e=>{ state.strokeWidth=+e.target.value; document.getElementById("strokeWV").textContent=state.strokeWidth;
  if(state.activeShape && state.activeShape.kind!=="layer"){ state.activeShape.strokeW=state.strokeWidth; shapeToPreview(); render(); } };
document.getElementById("mirror").onchange=e=>state.mirror=e.target.value;
document.getElementById("gridToggle").onchange=render;

document.getElementById("textScale").oninput=e=>{ state.textScale=+e.target.value; document.getElementById("textScaleV").textContent=state.textScale+"×"; updateTextGlyph(); if(state.textEditing&&state.textGlyph.cells.length){ textPreview(state.textAnchor.x,state.textAnchor.y); render(); } };
document.getElementById("textFont").onchange=e=>{ state.textFont=e.target.value; updateTextGlyph(); if(state.textEditing&&state.textGlyph.cells.length){ textPreview(state.textAnchor.x,state.textAnchor.y); render(); } };

// ---------- Format ----------
export const presetSel=document.getElementById("preset");
export const PRESETS={
  "96x96":  {w:96, h:96,  g:null,          scale:6},
  "64x64":  {w:64, h:64,  g:null,          scale:8},
  "48x48":  {w:48, h:48,  g:null,          scale:12},
  "125x175":{w:125,h:175, g:null,          scale:6},
  "75x105": {w:75, h:105, g:null,          scale:10},
  "50x70":  {w:50, h:70,  g:null,          scale:15},
  "30x42":  {w:30, h:42,  g:null,          scale:25},
  "137x187b":{w:137,h:187,g:{bleed:6,safety:6}, scale:6},
  "54x74b": {w:54, h:74,  g:{bleed:2,safety:2}, scale:15},
};
presetSel.onchange=()=>{
  const v=presetSel.value;
  document.getElementById("customWH").hidden = v!=="custom";
  if(v==="custom"){ state.guides=null; render(); return; }
  const p=PRESETS[v]; if(!p) return;
  state.guides=p.g;
  document.getElementById("expScale").value=p.scale;
  resize(p.w,p.h);
};
document.getElementById("guideToggle").onchange=render;
document.getElementById("applyWH").onclick=()=>{ resize(+document.getElementById("cw").value,+document.getElementById("ch").value); };
function remapData(d,w,h){ const nd=new Array(w*h).fill(null);
  for(let y=0;y<Math.min(h,state.H);y++) for(let x=0;x<Math.min(w,state.W);x++) nd[y*w+x]=d[y*state.W+x];
  return nd; }

// ---------- Rotation / miroir du canevas ----------
function transformImageLayer(L,op){
  const src=L._imgEl; if(!src||!src.complete||!src.naturalWidth) return;
  const sw=src.naturalWidth, sh=src.naturalHeight;
  const rot=(op==="cw"||op==="ccw");
  const c=document.createElement("canvas"); c.width=rot?sh:sw; c.height=rot?sw:sh;
  const cx=c.getContext("2d");
  if(op==="cw"){ cx.translate(c.width,0); cx.rotate(Math.PI/2); }
  else if(op==="ccw"){ cx.translate(0,c.height); cx.rotate(-Math.PI/2); }
  else if(op==="180"){ cx.translate(c.width,c.height); cx.rotate(Math.PI); }
  else if(op==="flipH"){ cx.translate(c.width,0); cx.scale(-1,1); }
  else if(op==="flipV"){ cx.translate(0,c.height); cx.scale(1,-1); }
  cx.drawImage(src,0,0);
  const url=c.toDataURL("image/png");
  L.img.dataURL=url; const im=new Image(); im.onload=()=>{ L._imgEl=im; render(); buildLayers(); }; im.src=url; L._imgEl=im;
}
function transformCanvas(op){
  if(state.activeShape) bakeShape();
  if(state.textEditing) commitCanvasText();
  commitFloat(); state.sel=null;
  snapshot();
  const swap=(op==="cw"||op==="ccw");
  const nW=swap?state.H:state.W, nH=swap?state.W:state.H;
  const mapIdx=(x,y)=>{
    if(op==="cw")   return x*nW + (state.H-1-y);
    if(op==="ccw")  return (state.W-1-x)*nW + y;
    if(op==="180")  return (state.H-1-y)*nW + (state.W-1-x);
    if(op==="flipH")return y*nW + (state.W-1-x);
    if(op==="flipV")return (state.H-1-y)*nW + x;
    return y*nW+x;
  };
  state.layers.forEach(L=>{
    if(L.img){ transformImageLayer(L,op); L.ox=0; L.oy=0; }
    else { bakeOffset(L); const nd=new Array(nW*nH).fill(null);
      for(let y=0;y<state.H;y++) for(let x=0;x<state.W;x++){ const v=L.data[y*state.W+x]; if(v===null) continue; nd[mapIdx(x,y)]=v; }
      L.data=nd; }
  });
  state.W=nW; state.H=nH;
  syncPresetToSize();
  buildLayers(); fitZoom();
}
document.getElementById("rotCW").onclick=()=>transformCanvas("cw");
document.getElementById("rotCCW").onclick=()=>transformCanvas("ccw");
document.getElementById("rot180").onclick=()=>transformCanvas("180");
document.getElementById("flipH").onclick=()=>transformCanvas("flipH");
document.getElementById("flipV").onclick=()=>transformCanvas("flipV");

// Modale Taille de l'image
document.getElementById("sizeOpen").onclick=()=>document.getElementById("sizeModal").classList.add("open");
document.getElementById("sizeClose").onclick=()=>document.getElementById("sizeModal").classList.remove("open");
document.getElementById("sizeOk").onclick=()=>document.getElementById("sizeModal").classList.remove("open");
document.getElementById("sizeModal").addEventListener("click",e=>{ if(e.target.id==="sizeModal") e.currentTarget.classList.remove("open"); });
export function resize(w,h){
  w=Math.max(8,Math.min(512,w|0)); h=Math.max(8,Math.min(512,h|0));
  if(state.activeShape) bakeShape();
  commitFloat(); state.sel=null;
  state.layers.forEach(L=>bakeOffset(L));
  state.layers=state.layers.map(L=> L.img ? L : ({...L,data:remapData(L.data,w,h)}) );
  state.W=w;state.H=h;
  state.active=Math.min(state.active,state.layers.length-1);
  history.length=0; state.histPtr=-1; snapshot();
  buildLayers(); fitZoom();
}

// ---------- Barre de menus ----------
function closeMenus(){ document.querySelectorAll(".menu").forEach(m=>m.classList.remove("open"));
  document.querySelectorAll(".menu-btn").forEach(b=>b.classList.remove("active")); }
document.querySelectorAll(".menu-btn").forEach(btn=>{
  btn.addEventListener("click",e=>{ e.stopPropagation();
    const m=document.getElementById("menu-"+btn.dataset.menu); if(!m) return;
    const isOpen=m.classList.contains("open");
    closeMenus(); if(!isOpen){ m.classList.add("open"); btn.classList.add("active"); } });
});
document.querySelectorAll(".menu").forEach(menu=>{
  menu.addEventListener("click",e=>{ e.stopPropagation(); if(e.target.closest("[data-close]")) closeMenus(); });
});
document.addEventListener("click",closeMenus);
window.addEventListener("keydown",e=>{ if(e.key==="Escape"){ if(!colorPop.hidden){ closeColorPop(); return; } if(state.activeShape){ cancelShape(); return; } if(state.floatSel){ commitFloat(); state.sel=null; render(); return; } if(state.sel){ state.sel=null; render(); return; } if(document.getElementById("confirmModal").classList.contains("open")){ closeConfirm(); return; } closeMenus(); document.getElementById("prefsModal").classList.remove("open"); document.getElementById("sizeModal").classList.remove("open"); document.getElementById("fxModal").classList.remove("open"); } });

document.getElementById("miNew").onclick=()=>{
  if(prefs.confirm && !confirm("Nouvelle image ? Le travail non enregistré sera perdu.")) return;
  state.activeShape=null; state.txOp=null; state.previewCells=null; state.sel=null; state.floatSel=null;
  state.layerSeq=1; state.layers=[newLayer("Fond"),newLayer("Dessin")]; state.active=1;
  history.length=0; state.histPtr=-1; snapshot();
  buildLayers(); fitZoom();
};

// ---------- Préférences ----------
export const prefs={ stageBg:"#0d1424", checker:true, gridAlpha:0.08, wheelZoom:false,
  kbd:true, confirm:true, filled:false, hist:60 };
export function savePrefs(){ try{ localStorage.setItem("eupix.prefs",JSON.stringify(prefs)); }catch(_){}}
export function loadPrefs(){ try{ const s=localStorage.getItem("eupix.prefs"); if(s) Object.assign(prefs,JSON.parse(s)); }catch(_){}}
export function applyPrefs(){
  stage.style.background = prefs.stageBg;
  document.body.classList.toggle("no-kbd", !prefs.kbd);
  state.HIST_MAX = prefs.hist;
  state.fillShape = prefs.filled;
  const fs=document.getElementById("fillShape"); if(fs) fs.checked=prefs.filled;
  // refléter dans la modale
  const set=(id,v,prop)=>{ const el=document.getElementById(id); if(el) el[prop]=v; };
  set("prefStageBg",prefs.stageBg,"value");
  set("prefChecker",prefs.checker,"checked");
  set("prefGridAlpha",Math.round(prefs.gridAlpha*100),"value");
  set("prefWheelZoom",prefs.wheelZoom,"checked");
  set("prefKbd",prefs.kbd,"checked");
  set("prefConfirm",prefs.confirm,"checked");
  set("prefFilled",prefs.filled,"checked");
  set("prefHist",prefs.hist,"value");
  render();
}
document.getElementById("prefsBtn").onclick=e=>{ e.stopPropagation(); closeMenus(); document.getElementById("prefsModal").classList.add("open"); };
document.getElementById("prefsClose").onclick=()=>document.getElementById("prefsModal").classList.remove("open");
document.getElementById("prefsOk").onclick=()=>document.getElementById("prefsModal").classList.remove("open");
document.getElementById("prefsModal").addEventListener("click",e=>{ if(e.target.id==="prefsModal") e.currentTarget.classList.remove("open"); });
const bindPref=(id,key,ev,fn)=>{ const el=document.getElementById(id); el.addEventListener(ev,()=>{ prefs[key]=fn(el); savePrefs(); applyPrefs(); }); };
bindPref("prefStageBg","stageBg","input",el=>el.value);
bindPref("prefChecker","checker","change",el=>el.checked);
bindPref("prefGridAlpha","gridAlpha","input",el=>(+el.value)/100);
bindPref("prefWheelZoom","wheelZoom","change",el=>el.checked);
bindPref("prefKbd","kbd","change",el=>el.checked);
bindPref("prefConfirm","confirm","change",el=>el.checked);
bindPref("prefFilled","filled","change",el=>el.checked);
bindPref("prefHist","hist","change",el=>Math.max(10,Math.min(200,+el.value||60)));
document.getElementById("prefsReset").onclick=()=>{ Object.assign(prefs,{stageBg:"#0d1424",checker:true,gridAlpha:0.08,wheelZoom:false,kbd:true,confirm:true,filled:false,hist:60}); savePrefs(); applyPrefs(); };
