import { state, view, overlay, vctx, octx, composite, cctx, artwork, actx, checkerCv, chctx, blendOp } from "./state.js";
import { snapshot } from "./history.js";
import { FONTS, drawTransform } from "./drawing.js";
import { setTool, buildLayers, refreshThumbs, measureLineW, prefs } from "./ui.js";
import { setHint } from "./interaction.js";

// ---------- Helpers ----------
export const idx = (x,y)=> y*state.W + x;
export const inBounds = (x,y)=> x>=0 && y>=0 && x<state.W && y<state.H;
export function hexToRgb(h){ h=h.replace("#",""); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }

export function newLayer(name){
  return { id: state.layerSeq++, name: name||("Calque "+state.layerSeq), visible:true, opacity:1, locked:false, data:new Array(state.W*state.H).fill(null), img:null, _imgEl:null, ox:0, oy:0, blend:"normal" };
}
// accès au contenu d'un calque en coordonnées canevas (le décalage ox/oy préserve le hors-cadre)
export function layerAt(L,gx,gy){ const dx=gx-(L.ox||0), dy=gy-(L.oy||0); if(dx<0||dy<0||dx>=state.W||dy>=state.H) return null; return L.data[dy*state.W+dx]; }
export function setLayerAt(L,gx,gy,col){ const dx=gx-(L.ox||0), dy=gy-(L.oy||0); if(dx<0||dy<0||dx>=state.W||dy>=state.H) return; L.data[dy*state.W+dx]=col; }
export function bakeOffset(L){ if(L.img || ((L.ox||0)===0 && (L.oy||0)===0)) return;
  const nd=new Array(state.W*state.H).fill(null);
  for(let gy=0;gy<state.H;gy++) for(let gx=0;gx<state.W;gx++){ const c=layerAt(L,gx,gy); if(c!==null) nd[gy*state.W+gx]=c; }
  if(L.text){ L.text.ax+=(L.ox||0); L.text.ay+=(L.oy||0); }
  L.data=nd; L.ox=0; L.oy=0; }
export function newImageLayer(dataURL,name){
  const L={ id: state.layerSeq++, name: name||"Image", visible:true, opacity:0.6, locked:false, data:null, img:{dataURL}, _imgEl:null, ox:0, oy:0, blend:"normal" };
  const im=new Image(); im.onload=()=>{ L._imgEl=im; render(); buildLayers(); }; im.src=dataURL; L._imgEl=im;
  return L;
}

// ---------- Clonage / (dé)sérialisation des calques (aussi utilisé par les frames d'animation) ----------
export function cloneLayers(layers){
  return layers.map(L=> L.isGroup ? {...L} :
    ({...L, data:L.data?L.data.slice():null, fx:L.fx?JSON.parse(JSON.stringify(L.fx)):null, text:L.text?{...L.text}:null}));
}
export function encodeLayers(layers){
  return layers.map(L=>({ name:L.name, visible:L.visible, opacity:L.opacity, locked:!!L.locked,
    data:L.img||L.isGroup?null:L.data, img:L.img?{dataURL:L.img.dataURL}:null, ox:L.ox||0, oy:L.oy||0,
    text:L.text||null, fx:L.fx||null, blend:L.blend||"normal",
    isGroup:!!L.isGroup, expanded:L.isGroup?(L.expanded!==false):undefined,
    group: L.groupId ? layers.findIndex(x=>x.id===L.groupId) : null }));
}
export function decodeLayers(raw){
  const layers=raw.map(L=>{
    if(L.isGroup) return { id:state.layerSeq++, isGroup:true, name:L.name||"Dossier", visible:L.visible!==false, expanded:L.expanded!==false };
    if(L.img && L.img.dataURL){ const IL=newImageLayer(L.img.dataURL, L.name||"Image");
      IL.visible=L.visible!==false; if(typeof L.opacity==="number") IL.opacity=L.opacity; IL.ox=L.ox||0; IL.oy=L.oy||0; IL.blend=L.blend||"normal"; IL.locked=!!L.locked; return IL; }
    return { id:state.layerSeq++, name:L.name||"Calque", visible:L.visible!==false,
      opacity:typeof L.opacity==="number"?L.opacity:1, locked:!!L.locked,
      data:(Array.isArray(L.data)&&L.data.length===state.W*state.H)?L.data.slice():new Array(state.W*state.H).fill(null), img:null,_imgEl:null, ox:L.ox||0, oy:L.oy||0, text:L.text||null, fx:L.fx||null, blend:L.blend||"normal" };
  });
  raw.forEach((L,i)=>{ if(typeof L.group==="number" && raw[L.group] && raw[L.group].isGroup) layers[i].groupId=layers[L.group].id; });
  if(!layers.length) layers.push(newLayer("Calque 1"));
  return layers;
}

// ---------- Dossiers de calques (groupes) ----------
export function newGroup(name){
  return { id: state.layerSeq++, isGroup:true, name: name||"Dossier", visible:true, expanded:true };
}
export function groupOf(id){ return id ? state.layers.find(L=>L.isGroup && L.id===id) : null; }

// ---------- Isolation (solo) — vue seulement, jamais sauvegardée ----------
let soloId=null;
export function isSolo(id){ return soloId===id; }
export function setSolo(id){ soloId = (soloId===id) ? null : id; }
export function clearStaleSolo(){ if(soloId!=null && !state.layers.some(L=>L.id===soloId)) soloId=null; }

// visibilité effective : un calque dans un dossier masqué est invisible même si sa propre visibilité est active
export function effVisible(L){
  if(soloId!=null) return L.id===soloId;
  if(!L.visible) return false;
  if(L.groupId){ const g=groupOf(L.groupId); if(g && !g.visible) return false; }
  return true; }

// ---------- Compositing ----------
// pixels effectifs d'un calque en coordonnées canevas (décalage + effets couleur/contour/ombre)
export function layerPixels(L){
  const ox=L.ox||0, oy=L.oy||0, fx=L.fx;
  const base=new Map();
  for(let dy=0;dy<state.H;dy++) for(let dx=0;dx<state.W;dx++){ const c=L.data[dy*state.W+dx]; if(c===null) continue;
    const gx=dx+ox, gy=dy+oy; if(gx<0||gy<0||gx>=state.W||gy>=state.H) continue;
    base.set(gx+","+gy, (fx&&fx.color)?fx.color:c); }
  if(!fx || (!(fx.stroke&&fx.stroke.on) && !(fx.shadow&&fx.shadow.on))) return base;
  const out=new Map();
  if(fx.shadow&&fx.shadow.on){ const sdx=fx.shadow.dx|0, sdy=fx.shadow.dy|0, sc=fx.shadow.color;
    for(const k of base.keys()){ const [x,y]=k.split(",").map(Number); const nx=x+sdx, ny=y+sdy;
      if(nx>=0&&ny>=0&&nx<state.W&&ny<state.H) out.set(nx+","+ny, sc); } }
  if(fx.stroke&&fx.stroke.on){ const w=Math.max(1,fx.stroke.width|0), sc=fx.stroke.color;
    for(const k of base.keys()){ const [x,y]=k.split(",").map(Number);
      for(let ry=-w;ry<=w;ry++) for(let rx=-w;rx<=w;rx++){ if(rx===0&&ry===0) continue;
        if(Math.max(Math.abs(rx),Math.abs(ry))>w) continue; const nx=x+rx,ny=y+ry;
        if(nx<0||ny<0||nx>=state.W||ny>=state.H) continue; const kk=nx+","+ny; if(!base.has(kk)) out.set(kk,sc); } } }
  for(const [k,v] of base) out.set(k,v);
  return out;
}
export function blendCh(mode,cb,cs){ switch(mode){
  case "multiply": return cb*cs;
  case "screen": return cb+cs-cb*cs;
  case "overlay": return cb<=0.5 ? 2*cb*cs : 1-2*(1-cb)*(1-cs);
  case "darken": return Math.min(cb,cs);
  case "lighten": return Math.max(cb,cs);
  default: return cs; } }
export function compositeLayers(ls){
  const data = new Uint8ClampedArray(state.W*state.H*4);
  for(const L of ls){
    if(L.isGroup || !effVisible(L) || L.opacity<=0 || L.img) continue;
    const as=L.opacity, mode=L.blend||"normal", px=layerPixels(L);
    for(const [k,hex] of px){ const [gx,gy]=k.split(",").map(Number);
      const [r,g,b]=hexToRgb(hex); const j=(gy*state.W+gx)*4;
      const ab=data[j+3]/255, ao=as+ab*(1-as); if(ao<=0) continue;
      const cs=[r/255,g/255,b/255], cb=[data[j]/255,data[j+1]/255,data[j+2]/255];
      for(let c=0;c<3;c++){ const B=blendCh(mode,cb[c],cs[c]);
        const co=as*(1-ab)*cs[c] + as*ab*B + (1-as)*ab*cb[c];
        data[j+c]=(co/ao)*255; }
      data[j+3]=ao*255;
    }
  }
  return new ImageData(data,state.W,state.H);
}
export function compositeToImageData(){ return compositeLayers(state.layers); }

// ---------- Rendering ----------
export const insideRect=(px,py,rx,ry,rw,rh)=>px>=rx&&py>=ry&&px<rx+rw&&py<ry+rh;
export function clampSel(){ if(!state.sel) return; state.sel.x=Math.max(0,Math.min(state.sel.x,state.W-1)); state.sel.y=Math.max(0,Math.min(state.sel.y,state.H-1));
  state.sel.w=Math.max(1,Math.min(state.sel.w,state.W-state.sel.x)); state.sel.h=Math.max(1,Math.min(state.sel.h,state.H-state.sel.y)); }
export function liftSelection(){ if(!state.sel||state.layers[state.active].img) return; snapshot(); const L=state.layers[state.active]; const {x,y,w,h}=state.sel;
  const data=new Array(w*h).fill(null);
  for(let j=0;j<h;j++) for(let i=0;i<w;i++){ const c=layerAt(L,x+i,y+j); if(c!==null){ data[j*w+i]=c; setLayerAt(L,x+i,y+j,null); } }
  state.floatSel={data,w,h,x,y}; state.thumbsDirty=true; }
export function commitFloat(){ if(!state.floatSel) return; const L=state.layers[state.active];
  if(!L.img){ snapshot(); const {data,w,h,x,y}=state.floatSel;
    for(let j=0;j<h;j++) for(let i=0;i<w;i++){ const c=data[j*w+i]; if(c!==null) setLayerAt(L,x+i,y+j,c); }
    state.sel={x,y,w,h}; state.thumbsDirty=true; }
  state.floatSel=null; buildLayers(); }
export function copySelection(){ if(state.floatSel){ state.clipboard={data:state.floatSel.data.slice(),w:state.floatSel.w,h:state.floatSel.h}; return; }
  if(state.sel && !state.layers[state.active].img){ const L=state.layers[state.active]; const {x,y,w,h}=state.sel; const data=new Array(w*h).fill(null);
    for(let j=0;j<h;j++) for(let i=0;i<w;i++) data[j*w+i]=layerAt(L,x+i,y+j); state.clipboard={data,w,h}; } }
export function cutSelection(){ if(state.floatSel){ state.clipboard={data:state.floatSel.data.slice(),w:state.floatSel.w,h:state.floatSel.h}; state.floatSel=null; state.thumbsDirty=true; render(); return; }
  if(state.sel && !state.layers[state.active].img){ copySelection(); snapshot(); const L=state.layers[state.active]; const {x,y,w,h}=state.sel;
    for(let j=0;j<h;j++) for(let i=0;i<w;i++) setLayerAt(L,x+i,y+j,null); state.thumbsDirty=true; buildLayers(); render(); } }
export function deleteSelection(){ if(state.floatSel){ state.floatSel=null; state.thumbsDirty=true; render(); return; }
  if(state.sel && !state.layers[state.active].img){ snapshot(); const L=state.layers[state.active]; const {x,y,w,h}=state.sel;
    for(let j=0;j<h;j++) for(let i=0;i<w;i++) setLayerAt(L,x+i,y+j,null); state.thumbsDirty=true; buildLayers(); render(); } }
export function pasteClipboard(){ if(!state.clipboard) return; commitFloat();
  const cx=state.sel?state.sel.x:Math.max(0,Math.floor((state.W-state.clipboard.w)/2)), cy=state.sel?state.sel.y:Math.max(0,Math.floor((state.H-state.clipboard.h)/2));
  state.floatSel={data:state.clipboard.data.slice(),w:state.clipboard.w,h:state.clipboard.h,x:cx,y:cy}; state.sel={x:cx,y:cy,w:state.clipboard.w,h:state.clipboard.h};
  setTool("select"); render(); setHint("Collé — déplace au curseur ou aux flèches, Entrée pour valider"); }
export function nudgeSelection(dx,dy){ if(state.floatSel){ state.floatSel.x+=dx; state.floatSel.y+=dy; state.sel={x:state.floatSel.x,y:state.floatSel.y,w:state.floatSel.w,h:state.floatSel.h}; render(); }
  else if(state.sel){ state.sel.x+=dx; state.sel.y+=dy; clampSel(); render(); } }

export function ensureChecker(){
  const key=state.W+"x"+state.H+"@"+state.zoom+(prefs.checker?"c":"p");
  if(key===state.checkerKey && checkerCv.width===state.W*state.zoom) return;
  state.checkerKey=key; checkerCv.width=state.W*state.zoom; checkerCv.height=state.H*state.zoom;
  if(prefs.checker){ const a="#243154", b="#1b2743", c=state.zoom;
    for(let y=0;y<state.H;y++) for(let x=0;x<state.W;x++){ chctx.fillStyle=((x+y)&1)?a:b; chctx.fillRect(x*c,y*c,c,c); } }
  else { chctx.fillStyle="#1e2b45"; chctx.fillRect(0,0,state.W*state.zoom,state.H*state.zoom); }
}
// ---------- Pelure d'oignon (frames voisines, teintées et semi-transparentes) ----------
function drawOnionFrame(layers,tint){
  const img=compositeLayers(layers);
  for(let i=0;i<img.data.length;i+=4){ const a=img.data[i+3]; if(!a) continue;
    img.data[i]=(img.data[i]+tint[0])/2; img.data[i+1]=(img.data[i+1]+tint[1])/2; img.data[i+2]=(img.data[i+2]+tint[2])/2;
    img.data[i+3]=a*0.35; }
  composite.width=state.W; composite.height=state.H; cctx.putImageData(img,0,0);
  actx.save(); actx.globalAlpha=1; actx.globalCompositeOperation="source-over";
  actx.drawImage(composite,0,0,state.W*state.zoom,state.H*state.zoom); actx.restore();
}
function drawOnionSkin(){
  const prev=state.frames[state.activeFrame-1], next=state.frames[state.activeFrame+1];
  if(prev) drawOnionFrame(prev.layers,[255,90,90]);
  if(next) drawOnionFrame(next.layers,[90,160,255]);
}
export function render(){
  clearStaleSolo();
  view.width = state.W*state.zoom; view.height = state.H*state.zoom;
  vctx.imageSmoothingEnabled=false;
  ensureChecker(); vctx.drawImage(checkerCv,0,0);

  // composition des calques sur un canevas transparent (modes de fusion vs calques inférieurs)
  artwork.width=state.W*state.zoom; artwork.height=state.H*state.zoom; actx.imageSmoothingEnabled=false;
  const tmp=composite; tmp.width=state.W; tmp.height=state.H; const tctx=cctx;
  if(state.onionSkin && state.frames && state.frames.length>1 && !state.playing) drawOnionSkin();
  for(const L of state.layers){
    if(L.isGroup || !effVisible(L) || L.opacity<=0) continue;
    actx.save(); actx.globalAlpha=L.opacity; actx.globalCompositeOperation=blendOp(L.blend);
    if(L.img){
      if(L._imgEl && L._imgEl.complete && L._imgEl.naturalWidth){ actx.imageSmoothingEnabled=true;
        const s=Math.min((state.W*state.zoom)/L._imgEl.naturalWidth,(state.H*state.zoom)/L._imgEl.naturalHeight);
        const w=L._imgEl.naturalWidth*s, h=L._imgEl.naturalHeight*s;
        actx.drawImage(L._imgEl,(state.W*state.zoom-w)/2+(L.ox||0)*state.zoom,(state.H*state.zoom-h)/2+(L.oy||0)*state.zoom,w,h);
        actx.imageSmoothingEnabled=false; }
    } else {
      const im=tctx.createImageData(state.W,state.H);
      for(const [k,hex] of layerPixels(L)){ const [gx,gy]=k.split(",").map(Number);
        const j=(gy*state.W+gx)*4; const [r,g,b]=hexToRgb(hex); im.data[j]=r;im.data[j+1]=g;im.data[j+2]=b;im.data[j+3]=255; }
      tctx.putImageData(im,0,0);
      actx.drawImage(tmp,0,0,state.W*state.zoom,state.H*state.zoom);
    }
    actx.restore();
  }
  vctx.drawImage(artwork,0,0);

  // aperçu de forme/texte en cours
  if(state.previewCells){
    for(const [k,col] of state.previewCells){ const [x,y]=k.split(",").map(Number);
      vctx.fillStyle=col; vctx.fillRect(x*state.zoom,y*state.zoom,state.zoom,state.zoom); }
  }
  // sélection flottante (pixels en cours de déplacement)
  if(state.floatSel){ for(let j=0;j<state.floatSel.h;j++) for(let i=0;i<state.floatSel.w;i++){ const c=state.floatSel.data[j*state.floatSel.w+i]; if(c===null) continue;
    vctx.fillStyle=c; vctx.fillRect((state.floatSel.x+i)*state.zoom,(state.floatSel.y+j)*state.zoom,state.zoom,state.zoom); } }
  // curseur de saisie texte
  if(state.textEditing && state.caretOn){
    const lines=state.textString.split("\n");
    const base=(state.textFont==="micro")?5:((FONTS[state.textFont]&&FONTS[state.textFont].line)||8);
    const adv=(base+1)*state.textScale;
    const cxc=state.textAnchor.x + measureLineW(lines[lines.length-1]||"");
    const cyc=state.textAnchor.y + (lines.length-1)*adv;
    vctx.fillStyle=state.color;
    vctx.fillRect(cxc*state.zoom, cyc*state.zoom, Math.max(1,state.textScale)*state.zoom, base*state.textScale*state.zoom);
  }
  drawGrid();
  drawTransform();
  document.getElementById("zoomLabel").textContent=Math.round(state.zoom*100)+"%";
  if(state.thumbsDirty){ refreshThumbs(); state.thumbsDirty=false; }
}

export function drawGrid(){
  overlay.width=state.W*state.zoom; overlay.height=state.H*state.zoom;
  octx.clearRect(0,0,overlay.width,overlay.height);
  if(document.getElementById("gridToggle").checked && state.zoom>=5){
    octx.strokeStyle="rgba(255,255,255,"+(prefs.gridAlpha||0.08)+")"; octx.lineWidth=1;
    octx.beginPath();
    for(let x=0;x<=state.W;x++){ octx.moveTo(x*state.zoom+.5,0); octx.lineTo(x*state.zoom+.5,state.H*state.zoom); }
    for(let y=0;y<=state.H;y++){ octx.moveTo(0,y*state.zoom+.5); octx.lineTo(state.W*state.zoom,y*state.zoom+.5); }
    octx.stroke();
  }
  drawGuides();
  // contour de sélection
  const sr = state.floatSel || (state.tool==="select" ? state.sel : null);
  if(sr){ octx.save(); octx.setLineDash([4,3]); octx.lineWidth=1;
    octx.strokeStyle="#000"; octx.strokeRect(sr.x*state.zoom+.5, sr.y*state.zoom+.5, sr.w*state.zoom-1, sr.h*state.zoom-1);
    octx.strokeStyle="#fff"; octx.lineDashOffset=4; octx.strokeRect(sr.x*state.zoom+.5, sr.y*state.zoom+.5, sr.w*state.zoom-1, sr.h*state.zoom-1);
    octx.restore(); }
  drawCropOverlay();
}

// ---------- Aperçu de l'outil Recadrer (assombrit l'extérieur de la zone gardée) ----------
function drawCropOverlay(){
  const r=state.cropRect; if(!r) return;
  const z=state.zoom, W=overlay.width, H=overlay.height;
  const rx=r.x*z, ry=r.y*z, rw=r.w*z, rh=r.h*z;
  octx.save(); octx.fillStyle="rgba(6,10,20,.6)";
  octx.fillRect(0,0,W,ry);
  octx.fillRect(0,ry+rh,W,H-(ry+rh));
  octx.fillRect(0,ry,rx,rh);
  octx.fillRect(rx+rw,ry,W-(rx+rw),rh);
  octx.restore();
  octx.save(); octx.setLineDash([4,3]); octx.lineWidth=1;
  octx.strokeStyle="#000"; octx.strokeRect(rx+.5,ry+.5,rw-1,rh-1);
  octx.strokeStyle="#fff"; octx.lineDashOffset=4; octx.strokeRect(rx+.5,ry+.5,rw-1,rh-1);
  octx.restore();
}

export function drawGuides(){
  if(!state.guides || !document.getElementById("guideToggle").checked) return;
  const b=state.guides.bleed, s=state.guides.safety;
  const rect=(x,y,w,h,col,dash)=>{
    octx.strokeStyle=col; octx.lineWidth=2; octx.setLineDash(dash||[]);
    octx.strokeRect(x*state.zoom+1,y*state.zoom+1,w*state.zoom-2,h*state.zoom-2);
  };
  // trait de coupe (bord rogné) : jaune UE plein
  rect(b, b, state.W-2*b, state.H-2*b, "rgba(255,204,0,.95)");
  // zone de sécurité : bleu tireté à l'intérieur
  rect(b+s, b+s, state.W-2*(b+s), state.H-2*(b+s), "rgba(61,107,255,.9)", [6,5]);
  octx.setLineDash([]);
  // légende
  octx.font="600 11px ui-monospace,monospace"; octx.textBaseline="top";
  octx.fillStyle="rgba(255,204,0,.95)"; octx.fillText("coupe", b*state.zoom+4, b*state.zoom+4);
  octx.fillStyle="rgba(61,107,255,.95)"; octx.fillText("sécurité", (b+s)*state.zoom+4, (b+s)*state.zoom+16);
}

