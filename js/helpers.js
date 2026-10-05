import { state, view, overlay, vctx, octx, composite, cctx, artwork, actx, checkerCv, chctx, blendOp } from "./state.js";
import { snapshot } from "./history.js";
import { FONTS, drawTransform } from "./drawing.js";
import { setTool, buildLayers, refreshThumbs, measureLineW, prefs, eraseImageRect } from "./ui.js";
import { setHint } from "./interaction.js";

// ---------- Helpers ----------
export const idx = (x,y)=> y*state.W + x;
export const inBounds = (x,y)=> x>=0 && y>=0 && x<state.W && y<state.H;
export function hexToRgb(h){ h=h.replace("#",""); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }

export function newLayer(name){
  return { id: state.layerSeq++, name: name||("Calque "+state.layerSeq), visible:true, opacity:1, locked:false, alphaLock:false, data:new Array(state.W*state.H).fill(null), img:null, _imgEl:null, ox:0, oy:0, blend:"normal" };
}
// accès au contenu d'un calque en coordonnées canevas (le décalage ox/oy préserve le hors-cadre)
export function layerAt(L,gx,gy){ const dx=gx-(L.ox||0), dy=gy-(L.oy||0); if(dx<0||dy<0||dx>=state.W||dy>=state.H) return null; return L.data[dy*state.W+dx]; }
// avec la transparence verrouillée, on peut recolorer un pixel déjà peint mais pas en ajouter
// ni en effacer — point de passage unique, donc respecté par le crayon, la gomme, le pot,
// les formes, le texte et la symétrie de dessin
export function setLayerAt(L,gx,gy,col){ const dx=gx-(L.ox||0), dy=gy-(L.oy||0); if(dx<0||dy<0||dx>=state.W||dy>=state.H) return;
  const i=dy*state.W+dx;
  if(L.alphaLock && (col===null || L.data[i]===null)) return;
  L.data[i]=col; }
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
  return layers.map(L=>({ name:L.name, visible:L.visible, opacity:L.opacity, locked:!!L.locked, alphaLock:!!L.alphaLock,
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
      opacity:typeof L.opacity==="number"?L.opacity:1, locked:!!L.locked, alphaLock:!!L.alphaLock,
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
// Couleurs hexa -> entier RGBA empaqueté (0xAABBGGRR en mémoire little-endian : octets r,g,b,a), mis en cache.
const packCache=new Map();
export function packHex(hex){
  let v=packCache.get(hex);
  if(v===undefined){ const [r,g,b]=hexToRgb(hex); v=((255<<24)|(b<<16)|(g<<8)|r)>>>0; packCache.set(hex,v); }
  return v;
}
// Pixels effectifs d'un calque, en coordonnées canevas, sous forme de tableau typé W×H (0 = vide) :
// décalage + effets couleur / ombre / contour. Remplace l'ancienne Map "x,y" → hex, bien trop lente
// (des milliers de chaînes allouées à chaque rendu) pour dessiner au stylet.
export function rasterizeLayer(L){
  const W=state.W, H=state.H, N=W*H, base=new Uint32Array(N), d=L.data;
  if(!d) return base;
  const ox=L.ox||0, oy=L.oy||0, fx=L.fx, tint=fx&&fx.color?packHex(fx.color):0;
  if(!ox&&!oy){ for(let i=0;i<N;i++){ const c=d[i]; if(c!==null) base[i]=tint||packHex(c); } }
  else for(let y=0;y<H;y++){ const gy=y+oy; if(gy<0||gy>=H) continue;
    for(let x=0;x<W;x++){ const c=d[y*W+x]; if(c===null) continue; const gx=x+ox; if(gx<0||gx>=W) continue; base[gy*W+gx]=tint||packHex(c); } }
  const shadow=fx&&fx.shadow&&fx.shadow.on, stroke=fx&&fx.stroke&&fx.stroke.on;
  if(!shadow && !stroke) return base;
  const out=new Uint32Array(N);
  if(shadow){ const sdx=fx.shadow.dx|0, sdy=fx.shadow.dy|0, sc=packHex(fx.shadow.color);
    for(let y=0;y<H;y++) for(let x=0;x<W;x++) if(base[y*W+x]){ const nx=x+sdx, ny=y+sdy; if(nx>=0&&ny>=0&&nx<W&&ny<H) out[ny*W+nx]=sc; } }
  if(stroke){ const w=Math.max(1,fx.stroke.width|0), sc=packHex(fx.stroke.color);
    for(let y=0;y<H;y++) for(let x=0;x<W;x++) if(base[y*W+x]){
      for(let ry=-w;ry<=w;ry++) for(let rx=-w;rx<=w;rx++){ if(!rx&&!ry) continue; const nx=x+rx, ny=y+ry;
        if(nx<0||ny<0||nx>=W||ny>=H) continue; const k=ny*W+nx; if(!base[k]) out[k]=sc; } } }
  for(let i=0;i<N;i++) if(base[i]) out[i]=base[i];
  return out;
}
// ancienne interface (Map "x,y" → hex), conservée pour d'éventuels appels externes
export function layerPixels(L){
  const px=rasterizeLayer(L), m=new Map(), W=state.W;
  for(let i=0;i<px.length;i++){ const c=px[i]; if(c) m.set((i%W)+","+((i/W)|0),"#"+[c&255,(c>>8)&255,(c>>16)&255].map(v=>v.toString(16).padStart(2,"0")).join("").toUpperCase()); }
  return m;
}
export function blendCh(mode,cb,cs){ switch(mode){
  case "multiply": return cb*cs;
  case "screen": return cb+cs-cb*cs;
  case "overlay": return cb<=0.5 ? 2*cb*cs : 1-2*(1-cb)*(1-cs);
  case "darken": return Math.min(cb,cs);
  case "lighten": return Math.max(cb,cs);
  default: return cs; } }
export function compositeLayers(ls){
  const N=state.W*state.H, data=new Uint8ClampedArray(N*4);
  for(const L of ls){
    if(L.isGroup || !effVisible(L) || L.opacity<=0 || L.img) continue;
    const as=L.opacity, mode=L.blend||"normal", px=rasterizeLayer(L);
    for(let i=0;i<N;i++){ const c=px[i]; if(!c) continue;
      const j=i*4, r=c&255, g=(c>>8)&255, b=(c>>16)&255, ab=data[j+3]/255;
      if(mode==="normal"){
        if(as>=1||ab===0){ data[j]=r; data[j+1]=g; data[j+2]=b; data[j+3]=as*255; continue; }
        const ao=as+ab*(1-as);
        data[j]=(as*r+(1-as)*ab*data[j])/ao; data[j+1]=(as*g+(1-as)*ab*data[j+1])/ao; data[j+2]=(as*b+(1-as)*ab*data[j+2])/ao;
        data[j+3]=ao*255; continue;
      }
      const ao=as+ab*(1-as); if(ao<=0) continue;
      const cs=[r/255,g/255,b/255], cb=[data[j]/255,data[j+1]/255,data[j+2]/255];
      for(let k=0;k<3;k++){ const B=blendCh(mode,cb[k],cs[k]);
        data[j+k]=((as*(1-ab)*cs[k] + as*ab*B + (1-as)*ab*cb[k])/ao)*255; }
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
// contenu de la sélection (flottante, ou rectangle du calque actif) sous forme {data,w,h}, ou null
export function selectionData(){
  if(state.floatSel) return {data:state.floatSel.data.slice(),w:state.floatSel.w,h:state.floatSel.h};
  if(state.sel && !state.layers[state.active].img){ const L=state.layers[state.active]; const {x,y,w,h}=state.sel; const data=new Array(w*h).fill(null);
    for(let j=0;j<h;j++) for(let i=0;i<w;i++) data[j*w+i]=layerAt(L,x+i,y+j); return {data,w,h}; }
  return null;
}
export function copySelection(){ const d=selectionData(); if(d) state.clipboard=d; }
// Transforme la sélection (soulevée si besoin) : flipH, flipV, cw, ccw, up2 (×2), down2 (÷2)
export function transformSelection(op){
  if(!state.floatSel){
    if(!state.sel) return "none";
    if(state.layers[state.active].img) return "img";
    liftSelection();
  }
  const f=state.floatSel, {w,h,data}=f; let nw=w, nh=h, nd;
  const at=(x,y)=>data[y*w+x];
  if(op==="flipH"||op==="flipV"){ nd=new Array(w*h);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) nd[y*w+x]= op==="flipH" ? at(w-1-x,y) : at(x,h-1-y); }
  else if(op==="cw"||op==="ccw"){ nw=h; nh=w; nd=new Array(w*h);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const nx= op==="cw" ? h-1-y : y, ny= op==="cw" ? x : w-1-x; nd[ny*nw+nx]=at(x,y); } }
  else if(op==="up2"){ nw=w*2; nh=h*2;
    if(nw>512||nh>512) return "big";
    nd=new Array(nw*nh);
    for(let y=0;y<nh;y++) for(let x=0;x<nw;x++) nd[y*nw+x]=at(x>>1,y>>1); }
  else if(op==="down2"){ nw=Math.max(1,Math.ceil(w/2)); nh=Math.max(1,Math.ceil(h/2)); nd=new Array(nw*nh).fill(null);
    for(let y=0;y<nh;y++) for(let x=0;x<nw;x++){        // premier pixel non vide du bloc 2×2 : les traits fins survivent
      for(const [dx,dy] of [[0,0],[1,0],[0,1],[1,1]]){ const sx=x*2+dx, sy=y*2+dy;
        if(sx<w && sy<h && at(sx,sy)!==null){ nd[y*nw+x]=at(sx,sy); break; } } } }
  else return "none";
  // on garde le centre de la sélection (sans sortir du canevas)
  f.x=Math.max(0,Math.min(state.W-nw,f.x+Math.round((w-nw)/2))); f.y=Math.max(0,Math.min(state.H-nh,f.y+Math.round((h-nh)/2)));
  f.data=nd; f.w=nw; f.h=nh; state.sel={x:f.x,y:f.y,w:nw,h:nh};
  state.thumbsDirty=true; render();
  return "ok";
}
export function cutSelection(){ if(state.floatSel){ state.clipboard={data:state.floatSel.data.slice(),w:state.floatSel.w,h:state.floatSel.h}; state.floatSel=null; state.thumbsDirty=true; render(); return; }
  if(state.sel && !state.layers[state.active].img){ copySelection(); snapshot(); const L=state.layers[state.active]; const {x,y,w,h}=state.sel;
    for(let j=0;j<h;j++) for(let i=0;i<w;i++) setLayerAt(L,x+i,y+j,null); state.thumbsDirty=true; buildLayers(); render(); } }
export function deleteSelection(){ if(state.floatSel){ state.floatSel=null; state.thumbsDirty=true; render(); return; }
  if(state.sel && state.layers[state.active].img){      // calque image : les pixels sélectionnés deviennent transparents dans l'image
    const L=state.layers[state.active];
    if(L.locked){ setHint("Calque verrouillé — déverrouille-le dans ses options (⚙)"); return; }
    eraseImageRect(L,state.sel); return; }
  if(state.sel && !state.layers[state.active].img){ snapshot(); const L=state.layers[state.active]; const {x,y,w,h}=state.sel;
    for(let j=0;j<h;j++) for(let i=0;i<w;i++) setLayerAt(L,x+i,y+j,null); state.thumbsDirty=true; buildLayers(); render(); } }
export function pasteClipboard(){ if(!state.clipboard) return; commitFloat();
  // la copie arrive dans un nouveau calque, juste au-dessus du calque actif
  snapshot("Collage");
  const cur=state.layers[state.active], nl=newLayer("Collage");
  if(cur) nl.groupId=cur.groupId||null;
  state.layers.splice(state.active+1,0,nl); state.active++;
  state.thumbsDirty=true; buildLayers();
  const cx=state.sel?state.sel.x:Math.max(0,Math.floor((state.W-state.clipboard.w)/2)), cy=state.sel?state.sel.y:Math.max(0,Math.floor((state.H-state.clipboard.h)/2));
  state.floatSel={data:state.clipboard.data.slice(),w:state.clipboard.w,h:state.clipboard.h,x:cx,y:cy}; state.sel={x:cx,y:cy,w:state.clipboard.w,h:state.clipboard.h};
  setTool("select"); render(); setHint("Collé — déplace au curseur ou aux flèches, Entrée pour valider"); }
export function nudgeSelection(dx,dy){ if(state.floatSel){ state.floatSel.x+=dx; state.floatSel.y+=dy; state.sel={x:state.floatSel.x,y:state.floatSel.y,w:state.floatSel.w,h:state.floatSel.h}; render(); }
  else if(state.sel){ state.sel.x+=dx; state.sel.y+=dy; clampSel(); render(); } }

// deux teintes bleu/bleu-gris autour d'une même lightness médiane ; l'écart entre les deux
// (et donc le contraste du damier) est réglable dans les Préférences
export function checkerColors(){
  const mid=58, spread=Math.max(4,Math.min(42,(prefs.checkerContrast??50)/100*42));
  const hue=215, sat=30;
  return [`hsl(${hue} ${sat}% ${Math.round(mid-spread)}%)`, `hsl(${hue} ${sat}% ${Math.round(mid+spread)}%)`];
}
export function ensureChecker(){
  const key=state.W+"x"+state.H+"@"+state.zoom+(prefs.checker?"c"+prefs.checkerContrast:"p");
  if(key===state.checkerKey && checkerCv.width===state.W*state.zoom) return;
  state.checkerKey=key; checkerCv.width=state.W*state.zoom; checkerCv.height=state.H*state.zoom;
  if(prefs.checker){ const [a,b]=checkerColors(); const c=state.zoom;
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
// Rendu regroupé : au plus un par image affichée (stylet à 240 Hz → on ne redessine pas à chaque événement)
let renderRaf=0;
export function renderSoon(){ if(renderRaf) return; renderRaf=requestAnimationFrame(()=>{ renderRaf=0; render(); }); }
export function render(){
  if(renderRaf){ cancelAnimationFrame(renderRaf); renderRaf=0; }
  clearStaleSolo();
  // (réassigner width/height réalloue et efface le canevas : on ne le fait que si la taille change)
  const VW=state.W*state.zoom, VH=state.H*state.zoom;
  if(view.width!==VW||view.height!==VH){ view.width=VW; view.height=VH; }
  vctx.imageSmoothingEnabled=false;
  ensureChecker(); vctx.drawImage(checkerCv,0,0);

  // composition des calques sur un canevas transparent (modes de fusion vs calques inférieurs)
  if(artwork.width!==VW||artwork.height!==VH){ artwork.width=VW; artwork.height=VH; } else actx.clearRect(0,0,VW,VH);
  actx.imageSmoothingEnabled=false;
  const tmp=composite; if(tmp.width!==state.W||tmp.height!==state.H){ tmp.width=state.W; tmp.height=state.H; } const tctx=cctx;
  // Pendant un trait, seul le calque actif change : les calques situés SOUS lui sont composés une fois
  // (cache de trait, jeté au relâchement) et simplement recopiés à chaque image.
  const sig=VW+"x"+VH+"|"+state.active+"|"+state.layers.length+"|"+state.activeFrame;
  let from=0, sc=state.strokeCache;
  if(!state.stroking){ state.strokeCache=null; sc=null; }
  if(sc && sc.sig===sig){ actx.drawImage(sc.cv,0,0); from=sc.upto; }
  else {
    sc=null; state.strokeCache=null;
    if(state.onionSkin && state.frames && state.frames.length>1 && !state.playing) drawOnionSkin();
  }
  for(let li=from; li<state.layers.length; li++){
    if(state.stroking && !sc && li===state.active){        // les calques sous l'actif sont prêts : on les met en cache
      const cv=document.createElement("canvas"); cv.width=VW; cv.height=VH; cv.getContext("2d").drawImage(artwork,0,0);
      sc=state.strokeCache={ cv, sig, upto:li };
    }
    const L=state.layers[li];
    if(L.isGroup || !effVisible(L) || L.opacity<=0) continue;
    actx.save(); actx.globalAlpha=L.opacity; actx.globalCompositeOperation=blendOp(L.blend);
    if(L.img){
      if(L._imgEl && L._imgEl.complete && L._imgEl.naturalWidth){ actx.imageSmoothingEnabled=true;
        const s=Math.min((state.W*state.zoom)/L._imgEl.naturalWidth,(state.H*state.zoom)/L._imgEl.naturalHeight);
        const w=L._imgEl.naturalWidth*s, h=L._imgEl.naturalHeight*s;
        actx.drawImage(L._imgEl,(state.W*state.zoom-w)/2+(L.ox||0)*state.zoom,(state.H*state.zoom-h)/2+(L.oy||0)*state.zoom,w,h);
        actx.imageSmoothingEnabled=false; }
    } else {
      const px=rasterizeLayer(L);
      tctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer),state.W,state.H),0,0);
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
  for(const fn of state.renderHooks) fn();
  if(state.thumbsDirty){ refreshThumbs(); state.thumbsDirty=false; }
}

// la grille est dessinée une fois (par taille / zoom / opacité) puis simplement recopiée à chaque rendu
const gridCv=document.createElement("canvas"); let gridKey="";
function gridCanvas(){
  const alpha=prefs.gridAlpha||0.08, key=state.W+"x"+state.H+"@"+state.zoom+"/"+alpha;
  if(key!==gridKey){ gridKey=key; gridCv.width=state.W*state.zoom; gridCv.height=state.H*state.zoom;
    const g=gridCv.getContext("2d"); g.strokeStyle="rgba(255,255,255,"+alpha+")"; g.lineWidth=1; g.beginPath();
    for(let x=0;x<=state.W;x++){ g.moveTo(x*state.zoom+.5,0); g.lineTo(x*state.zoom+.5,state.H*state.zoom); }
    for(let y=0;y<=state.H;y++){ g.moveTo(0,y*state.zoom+.5); g.lineTo(state.W*state.zoom,y*state.zoom+.5); }
    g.stroke(); }
  return gridCv;
}
export function drawGrid(){
  const OW=state.W*state.zoom, OH=state.H*state.zoom;
  if(overlay.width!==OW||overlay.height!==OH){ overlay.width=OW; overlay.height=OH; } else octx.clearRect(0,0,OW,OH);
  if(document.getElementById("gridToggle").checked && state.zoom>=5) octx.drawImage(gridCanvas(),0,0);
  drawGuides();
  // contour de sélection
  const sr = state.floatSel || (state.tool==="select" ? state.sel : null);
  if(sr){ octx.save(); octx.setLineDash([4,3]); octx.lineWidth=1;
    octx.strokeStyle="#000"; octx.strokeRect(sr.x*state.zoom+.5, sr.y*state.zoom+.5, sr.w*state.zoom-1, sr.h*state.zoom-1);
    octx.strokeStyle="#fff"; octx.lineDashOffset=4; octx.strokeRect(sr.x*state.zoom+.5, sr.y*state.zoom+.5, sr.w*state.zoom-1, sr.h*state.zoom-1);
    octx.restore(); }
  drawCropOverlay();
  drawRulerGuides();
  drawLassoPath();
}

// repères manuels posés depuis les règles (traits fins couleur d'accent bleu, sur les bords de cellules)
function drawRulerGuides(){
  if(!state.rulersOn || !state.rulerGuides.length) return;
  const z=state.zoom; octx.save(); octx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue("--accent-blue").trim()||"#3d6bff"; octx.lineWidth=1; octx.beginPath();
  for(const g of state.rulerGuides){
    if(g.axis==="x"){ octx.moveTo(g.pos*z+.5,0); octx.lineTo(g.pos*z+.5,overlay.height); }
    else { octx.moveTo(0,g.pos*z+.5); octx.lineTo(overlay.width,g.pos*z+.5); } }
  octx.stroke(); octx.restore();
}

// tracé du lasso en cours (le contour se ferme tout seul au relâchement)
function drawLassoPath(){
  const pts=state.lasso; if(!pts || pts.length<2) return;
  const z=state.zoom, path=()=>{ octx.beginPath();
    pts.forEach(([x,y],i)=>{ const px=(x+.5)*z, py=(y+.5)*z; i?octx.lineTo(px,py):octx.moveTo(px,py); }); octx.closePath(); };
  octx.save(); octx.lineWidth=1; octx.setLineDash([4,3]);
  octx.strokeStyle="#000"; path(); octx.stroke();
  octx.strokeStyle="#fff"; octx.lineDashOffset=4; path(); octx.stroke();
  octx.restore();
}

// ---------- Aperçu de l'outil Recadrer (assombrit l'extérieur de la zone gardée) ----------
function drawCropOverlay(){
  const r=state.cropRect; if(!r) return;
  // rien à montrer tant que la zone couvre encore tout le canevas (pas de recadrage en cours) :
  // sinon le contour en pointillés colle exactement au bord de l'image et ressemble à des
  // poignées parasites
  if(r.x===0 && r.y===0 && r.w===state.W && r.h===state.H) return;
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

