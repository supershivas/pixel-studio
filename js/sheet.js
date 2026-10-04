import { state } from "./state.js";
import { newLayer } from "./helpers.js";
import { importFrames } from "./frames.js";
import { newProject } from "./ui.js";
import { pushRecent } from "./io.js";
import { medianCutPalette } from "./drawing.js";
import { showToast } from "./toast.js";

// ---------- Importer une planche de sprites ----------
// Deux façons de découper : une GRILLE régulière, ou des CADRES LIBRES (tous de même taille) posés à la
// main ou repérés automatiquement sur les sujets d'une planche irrégulière. Chaque cadre est ensuite
// réduit à la taille de sortie, débarrassé de son fond, recalé et limité en couleurs → une frame.
const $=id=>document.getElementById(id);
const modal=$("sheetModal"), cv=$("shPreview"), ok=$("sheetOk");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const num=(id,min,max)=>clamp(Math.round(+$(id).value)||min,min,max);
let raw=null, src=null;                 // image d'origine / après réduction {data,w,h}
let mode="grid", rects=[], selIdx=-1, drag=null;
const excluded=new Set();               // grille : cellules écartées à la main
let bg={transparent:false,rgb:[255,255,255]}, outTouched=false, lastCW=0, lastCH=0, timer=0;

// ---------- Chargement ----------
function readImage(im,name){
  const c=document.createElement("canvas"); c.width=im.naturalWidth; c.height=im.naturalHeight;
  const g=c.getContext("2d",{willReadFrequently:true}); g.drawImage(im,0,0);
  raw={ data:g.getImageData(0,0,c.width,c.height).data, w:c.width, h:c.height, name };
  const k=detectScale(raw); $("shScale").value=k;
  reduce(); detectBg();
  const w0=src.w, h0=src.h;
  // cellule par défaut : taille du canevas si elle découpe la planche (planche exportée par l'app), sinon une bande de carrés
  if(w0%state.W===0 && h0%state.H===0 && (w0>state.W||h0>state.H)){ $("shCW").value=state.W; $("shCH").value=state.H; }
  else { let cell = w0>h0 && w0%h0===0 ? h0 : gcd(w0,h0); if(cell<8) cell=Math.min(w0,h0); $("shCW").value=$("shCH").value=Math.min(4096,cell); }
  $("shMargin").value=0; $("shGap").value=0; excluded.clear(); rects=[]; selIdx=-1; outTouched=false;
  setMode(mode,true);
  $("shSrcName").textContent=`${name} — ${raw.w}×${raw.h} px`+(k>1?` (÷${k})`:"");
}
const gcd=(a,b)=>b?gcd(b,a%b):a;
// planche agrandie : plus grand k tel que l'image soit faite de blocs k×k uniformes
function detectScale({data,w,h}){
  for(let k=Math.min(64,w,h);k>=2;k--){
    if(w%k||h%k) continue;
    let uniform=true;
    for(let by=0;by<h&&uniform;by+=k) for(let bx=0;bx<w&&uniform;bx+=k){
      const i0=(by*w+bx)*4;
      for(let y=by;y<by+k&&uniform;y++) for(let x=bx;x<bx+k;x++){ const i=(y*w+x)*4;
        if(data[i]!==data[i0]||data[i+1]!==data[i0+1]||data[i+2]!==data[i0+2]||data[i+3]!==data[i0+3]){ uniform=false; break; } }
    }
    if(uniform) return k;
  }
  return 1;
}
function reduce(){
  const k=num("shScale",1,64);
  if(k===1){ src={data:raw.data,w:raw.w,h:raw.h}; return; }
  const w=Math.floor(raw.w/k), h=Math.floor(raw.h/k), out=new Uint8ClampedArray(w*h*4), half=k>>1;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const i=((y*k+half)*raw.w+x*k+half)*4; out.set(raw.data.subarray(i,i+4),(y*w+x)*4); }
  src={data:out,w,h};
}
// couleur de fond : la couleur la plus fréquente sur le pourtour de l'image (ou la transparence)
function detectBg(){
  const {data,w,h}=src, bins=new Map(); let transparent=0, total=0;
  const add=(x,y)=>{ const i=(y*w+x)*4; total++;
    if(data[i+3]<128){ transparent++; return; }
    const k=((data[i]>>4)<<8)|((data[i+1]>>4)<<4)|(data[i+2]>>4); let e=bins.get(k);
    if(!e){ e={n:0,r:0,g:0,b:0}; bins.set(k,e); } e.n++; e.r+=data[i]; e.g+=data[i+1]; e.b+=data[i+2]; };
  for(let x=0;x<w;x++){ add(x,0); add(x,h-1); }
  for(let y=1;y<h-1;y++){ add(0,y); add(w-1,y); }
  let best=null; for(const e of bins.values()) if(!best||e.n>best.n) best=e;
  bg = transparent>total/2 || !best ? {transparent:true,rgb:[255,255,255]}
     : {transparent:false,rgb:[Math.round(best.r/best.n),Math.round(best.g/best.n),Math.round(best.b/best.n)]};
  $("shBgInfo").textContent = bg.transparent ? "L'image est déjà transparente sur les bords" : `Couleur de fond détectée : rgb(${bg.rgb.join(", ")})`;
}

// ---------- Paramètres ----------
function params(){
  const cw=num("shCW",1,Math.min(4096,src.w)), ch=num("shCH",1,Math.min(4096,src.h));
  const ow=num("shOutW",1,512);
  return { cw, ch, m:num("shMargin",0,256), gap:num("shGap",0,256), ow, oh:Math.max(1,Math.round(ow*ch/cw)),
    removeBg:$("shBgOn").checked, tol:num("shTol",1,90)/100*441.7, align:$("shAlign").value,
    colors:$("shColors").value, colorsN:num("shColorsN",2,32) };
}
// opacité 0..1 d'un pixel source : canal alpha, puis proximité avec la couleur de fond (rampe douce)
function alphaOf(i,p){
  let a=src.data[i+3]/255; if(a===0) return 0;
  if(p.removeBg && !bg.transparent){
    const d=Math.hypot(src.data[i]-bg.rgb[0],src.data[i+1]-bg.rgb[1],src.data[i+2]-bg.rgb[2]);
    a*=d<=p.tol?0:d>=p.tol*1.6?1:(d-p.tol)/(p.tol*.6);
  }
  return a;
}
// ---------- Cadres ----------
function gridCells(p){
  const cells=[], cols=Math.max(0,Math.floor((src.w-2*p.m+p.gap)/(p.cw+p.gap))), rows=Math.max(0,Math.floor((src.h-2*p.m+p.gap)/(p.ch+p.gap)));
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    const x=p.m+c*(p.cw+p.gap), y=p.m+r*(p.ch+p.gap); let empty=true;
    for(let j=0;j<p.ch&&empty;j++) for(let i=0;i<p.cw;i++) if(alphaOf(((y+j)*src.w+x+i)*4,p)>=.5){ empty=false; break; }
    cells.push({x,y,empty});
  }
  return {cells,cols,rows};
}
function frameRects(p){
  if(mode==="free") return rects.map(r=>({x:r.x,y:r.y}));
  return gridCells(p).cells.map((c,i)=>({...c,i})).filter(c=>!excluded.has(c.i) && !($("shSkipEmpty").checked && c.empty));
}
// détection automatique : composantes connectées de pixels « non fond », fusionnées à courte distance
function detect(){
  const p={...params(), removeBg:true}, {w,h}=src;
  const f=Math.max(1,Math.round(Math.min(w,h)/300)), gw=Math.ceil(w/f), gh=Math.ceil(h/f);
  const fg=new Uint8Array(w*h); let coarse=new Uint8Array(gw*gh);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(alphaOf((y*w+x)*4,p)>=.5){ fg[y*w+x]=1; coarse[((y/f)|0)*gw+((x/f)|0)]=1; }
  for(let pass=0;pass<2;pass++){                 // dilatation 5×5 (horizontale puis verticale)
    const t=new Uint8Array(gw*gh);
    for(let y=0;y<gh;y++) for(let x=0;x<gw;x++){ let v=0;
      for(let d=-2;d<=2&&!v;d++){ const xx=pass?x:x+d, yy=pass?y+d:y; if(xx>=0&&xx<gw&&yy>=0&&yy<gh&&coarse[yy*gw+xx]) v=1; }
      t[y*gw+x]=v; }
    coarse=t;
  }
  const label=new Int32Array(gw*gh); let nl=0;
  for(let s=0;s<gw*gh;s++){ if(!coarse[s]||label[s]) continue; nl++; const st=[s]; label[s]=nl;
    while(st.length){ const c=st.pop(), cx=c%gw, cy=(c/gw)|0;
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){ const x=cx+dx,y=cy+dy; if(x<0||y<0||x>=gw||y>=gh) continue;
        const k=y*gw+x; if(coarse[k]&&!label[k]){ label[k]=nl; st.push(k); } } } }
  const bb=Array.from({length:nl+1},()=>({x0:1e9,y0:1e9,x1:-1,y1:-1,a:0}));
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(fg[y*w+x]){ const b=bb[label[((y/f)|0)*gw+((x/f)|0)]];
    if(x<b.x0)b.x0=x; if(y<b.y0)b.y0=y; if(x>b.x1)b.x1=x; if(y>b.y1)b.y1=y; b.a++; }
  const comps=bb.slice(1).filter(b=>b.a>0), maxA=Math.max(0,...comps.map(b=>b.a));
  // écarte les résidus (filigrane, texte), puis les bandeaux qui longent le bord de l'image (pied de page…)
  let subs=comps.filter(b=>b.a>=maxA*0.12);
  const edge=b=>b.x0<=1||b.y0<=1||b.x1>=w-2||b.y1>=h-2;
  const noBands=subs.filter(b=>!(edge(b) && (b.x1-b.x0+1>w*0.5||b.y1-b.y0+1>h*0.5)));
  if(noBands.length) subs=noBands;
  const medW=subs.map(b=>b.x1-b.x0+1).sort((a,b)=>a-b)[subs.length>>1], medH=subs.map(b=>b.y1-b.y0+1).sort((a,b)=>a-b)[subs.length>>1];
  const regular=subs.filter(b=>b.x1-b.x0+1<=medW*2 && b.y1-b.y0+1<=medH*2);
  if(regular.length) subs=regular;
  if(!subs.length){ showToast("Aucun sujet détecté : ajuste le retrait du fond.",{type:"warn"}); return; }
  // ordre de lecture : lignes (regroupées par centre vertical), puis de gauche à droite
  const mh=subs.map(b=>b.y1-b.y0+1).sort((a,b)=>a-b)[subs.length>>1];
  subs.sort((a,b)=>(a.y0+a.y1)-(b.y0+b.y1));
  const rows=[]; for(const b of subs){ const cy=(b.y0+b.y1)/2, last=rows[rows.length-1];
    if(last && Math.abs(cy-last.cy)<=mh*0.5){ last.items.push(b); last.cy=(last.cy*(last.items.length-1)+cy)/last.items.length; } else rows.push({cy,items:[b]}); }
  const ordered=rows.flatMap(r=>r.items.sort((a,b)=>(a.x0+a.x1)-(b.x0+b.x1)));
  const cw=Math.min(w,Math.ceil(Math.max(...ordered.map(b=>b.x1-b.x0+1))*1.08)), ch=Math.min(h,Math.ceil(Math.max(...ordered.map(b=>b.y1-b.y0+1))*1.08));
  $("shCW").value=cw; $("shCH").value=ch; lastCW=cw; lastCH=ch;
  rects=ordered.map(b=>({ x:clamp(Math.round((b.x0+b.x1+1)/2-cw/2),0,w-cw), y:clamp(Math.round((b.y0+b.y1+1)/2-ch/2),0,h-ch) }));
  selIdx=-1; $("shBgOn").checked=!bg.transparent; syncOutDefault(true);
  refresh();
  showToast(`${rects.length} sujet${rects.length>1?"s":""} détecté${rects.length>1?"s":""} — ajuste les cadres si besoin.`,{type:"success"});
}

// ---------- Traitement d'un cadre : réduction, fond, recalage, couleurs ----------
function processFrames(p){
  const rs=frameRects(p); if(!rs.length) return null;
  const sx=p.cw/p.ow, sy=p.ch/p.oh;
  const frames=rs.map(r=>{
    const out=new Uint8ClampedArray(p.ow*p.oh*4);
    for(let oy=0;oy<p.oh;oy++){ const y0=Math.floor(r.y+oy*sy), y1=Math.max(y0+1,Math.ceil(r.y+(oy+1)*sy));
      for(let ox=0;ox<p.ow;ox++){ const x0=Math.floor(r.x+ox*sx), x1=Math.max(x0+1,Math.ceil(r.x+(ox+1)*sx));
        let sa=0,sr=0,sg=0,sb=0,n=0;
        for(let y=y0;y<y1&&y<src.h;y++) for(let x=x0;x<x1&&x<src.w;x++){
          const i=(y*src.w+x)*4, a=alphaOf(i,p); sa+=a; sr+=src.data[i]*a; sg+=src.data[i+1]*a; sb+=src.data[i+2]*a; n++; }
        if(n && sa/n>=.5){ const o=(oy*p.ow+ox)*4; out[o]=sr/sa; out[o+1]=sg/sa; out[o+2]=sb/sa; out[o+3]=255; } } }
    return p.align==="none" ? out : realign(out,p.ow,p.oh,p.align);
  });
  reduceColors(frames,p);
  return frames;
}
function realign(px,w,h,how){
  let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(px[(y*w+x)*4+3]){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
  if(x1<0) return px;
  const dx=Math.round((w-(x1-x0+1))/2)-x0, dy = how==="bottom" ? (h-1-(h>8?1:0))-y1 : Math.round((h-(y1-y0+1))/2)-y0;
  const out=new Uint8ClampedArray(px.length);
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){ const nx=x+dx, ny=y+dy; if(nx<0||ny<0||nx>=w||ny>=h) continue;
    out.set(px.subarray((y*w+x)*4,(y*w+x)*4+4),(ny*w+nx)*4); }
  return out;
}
function reduceColors(frames,p){
  if(p.colors==="keep") return;
  if(p.colors==="bw"){
    for(const f of frames) for(let i=0;i<f.length;i+=4) if(f[i+3]){ const v=0.299*f[i]+0.587*f[i+1]+0.114*f[i+2]<128?0:255; f[i]=f[i+1]=f[i+2]=v; }
    return;
  }
  const pts=[]; for(const f of frames) for(let i=0;i<f.length;i+=4) if(f[i+3]) pts.push(f[i],f[i+1],f[i+2]);
  if(!pts.length) return;
  const rgb=Float32Array.from(pts), pal=medianCutPalette({rgb,ok:new Uint8Array(pts.length/3).fill(1)},p.colorsN), memo=new Map();
  for(const f of frames) for(let i=0;i<f.length;i+=4) if(f[i+3]){
    const key=(f[i]<<16)|(f[i+1]<<8)|f[i+2]; let c=memo.get(key);
    if(!c){ let bd=1e12; for(const q of pal){ const d=(f[i]-q[0])**2+(f[i+1]-q[1])**2+(f[i+2]-q[2])**2; if(d<bd){bd=d;c=q;} } memo.set(key,c); }
    f[i]=c[0]; f[i+1]=c[1]; f[i+2]=c[2]; }
}

// ---------- Affichage ----------
function drawPreview(){
  const p=params(), s=Math.max(1,Math.floor(480/src.w));
  cv.width=src.w*s; cv.height=src.h*s;
  const t=document.createElement("canvas"); t.width=src.w; t.height=src.h;
  t.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(src.data),src.w,src.h),0,0);
  const x=cv.getContext("2d"); x.imageSmoothingEnabled=false; x.clearRect(0,0,cv.width,cv.height); x.drawImage(t,0,0,cv.width,cv.height);
  const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const accent=css("--accent")||"#ffcc00", dim=css("--ink-dim")||"#8fa0c4";
  const lw=Math.max(2,s,Math.round(Math.max(src.w,src.h)*s/220));
  x.font=`${lw*6}px ui-monospace,monospace`; x.textBaseline="top"; x.lineWidth=lw;
  if(mode==="grid"){
    const keep=new Set(frameRects(p).map(c=>c.i));
    gridCells(p).cells.forEach((c,i)=>{
      const px=c.x*s, py=c.y*s, pw=p.cw*s, ph=p.ch*s, on=keep.has(i);
      if(!on){ x.fillStyle="rgba(6,10,20,.65)"; x.fillRect(px,py,pw,ph); }
      x.strokeStyle=on?accent:dim; x.strokeRect(px+lw/2,py+lw/2,pw-lw,ph-lw);
      if(on){ x.fillStyle=accent; x.fillText(String([...keep].indexOf(i)+1),px+lw+3,py+lw+2); }
    });
  } else rects.forEach((r,i)=>{
    const px=r.x*s, py=r.y*s, pw=p.cw*s, ph=p.ch*s, sel=i===selIdx;
    x.strokeStyle=sel?"#fff":accent; x.lineWidth=sel?lw*1.6:lw; x.strokeRect(px+lw/2,py+lw/2,pw-lw,ph-lw);
    x.fillStyle=accent; x.fillText(String(i+1),px+lw*2,py+lw*2);
  });
}
function drawResult(){
  timer=0; if(!raw) return;
  const p=params(), frames=processFrames(p), out=$("shResult"), g=out.getContext("2d");
  if(!frames){ out.width=out.height=1; g.clearRect(0,0,1,1); ok.disabled=true;
    $("shSummary").textContent = mode==="free" ? "Aucun cadre : clique sur l'aperçu ou détecte les sujets" : "Aucune cellule : réduis la taille de cellule"; return; }
  const sc=Math.max(1,Math.floor(72/p.oh)), gap=2;
  out.width=frames.length*(p.ow*sc+gap)-gap; out.height=p.oh*sc;
  g.imageSmoothingEnabled=false;
  frames.forEach((f,i)=>{ const t=document.createElement("canvas"); t.width=p.ow; t.height=p.oh;
    t.getContext("2d").putImageData(new ImageData(f,p.ow,p.oh),0,0); g.drawImage(t,i*(p.ow*sc+gap),0,p.ow*sc,p.oh*sc); });
  const n=frames.length;
  $("shSummary").textContent=`${n} frame${n>1?"s":""} de ${p.ow}×${p.oh} px`;
  ok.disabled=false;
}
function refresh(){
  if(!raw) { ok.disabled=true; return; }
  reduce(); drawPreview();
  const p=params(); $("shOutInfo").textContent=`${p.ow} × ${p.oh} px par frame`;
  clearTimeout(timer); timer=setTimeout(drawResult,mode==="free"&&drag?250:60);
}
function syncOutDefault(force){
  if(!src || (outTouched && !force)) return;
  const p=params(); $("shOutW").value = mode==="free" ? Math.min(p.cw,64) : Math.min(p.cw,512);
  if(force) outTouched=false;
}
function setMode(m,init){
  mode=m; $("shMode").value=m;
  const free=m==="free";
  $("shFreeRow").hidden=!free; $("shGridRow").hidden=free; $("shEmptyRow").hidden=free;
  $("shSizeLbl").firstChild.textContent = free ? "Taille d'un cadre" : "Taille d'une cellule";
  $("shModeHint").textContent = free ? "Cadres de même taille posés où tu veux sur la planche" : "Cellules alignées sur une grille";
  $("shNote").textContent = free ? "Clique sur l'image pour poser un cadre, glisse-le pour l'ajuster. L'ordre des numéros est celui de l'animation."
                                  : "Clique une cellule de l'aperçu pour l'exclure de l'animation (ou la reprendre).";
  if(init!==undefined){        // réglages par défaut du mode (changement de mode ou nouvelle image)
    $("shBgOn").checked = free && !bg.transparent;
    $("shColors").value = free ? "n" : "keep";
    $("shAlign").value = free ? "bottom" : "none";
    outTouched=false;
  }
  lastCW=num("shCW",1,4096); lastCH=num("shCH",1,4096); syncOutDefault(true);
  if(raw) refresh();
}

// ---------- Interactions ----------
const toSrc=e=>{
  const r=cv.getBoundingClientRect(), s=cv.width/src.w;
  const fit=Math.min(r.width/cv.width, r.height/cv.height)||1, ox=(r.width-cv.width*fit)/2, oy=(r.height-cv.height*fit)/2;
  return { x:((e.clientX-r.left-ox)/fit)/s, y:((e.clientY-r.top-oy)/fit)/s };
};
const hit=(p,pt)=>{ for(let i=rects.length-1;i>=0;i--){ const r=rects[i]; if(pt.x>=r.x&&pt.x<r.x+p.cw&&pt.y>=r.y&&pt.y<r.y+p.ch) return i; } return -1; };
cv.addEventListener("pointerdown",e=>{
  if(!raw || e.button!==0) return;
  const pt=toSrc(e), p=params();
  if(mode==="grid"){
    const g=gridCells(p).cells, i=g.findIndex(c=>pt.x>=c.x&&pt.x<c.x+p.cw&&pt.y>=c.y&&pt.y<c.y+p.ch);
    if(i>=0){ if(excluded.has(i)) excluded.delete(i); else excluded.add(i); refresh(); }
    return;
  }
  let i=hit(p,pt);
  if(i<0){ rects.push({ x:clamp(Math.round(pt.x-p.cw/2),0,src.w-p.cw), y:clamp(Math.round(pt.y-p.ch/2),0,src.h-p.ch) }); i=rects.length-1; }
  selIdx=i; drag={dx:pt.x-rects[i].x, dy:pt.y-rects[i].y};
  cv.setPointerCapture(e.pointerId); refresh();
});
cv.addEventListener("pointermove",e=>{
  if(!drag||selIdx<0) return;
  const pt=toSrc(e), p=params();
  rects[selIdx].x=clamp(Math.round(pt.x-drag.dx),0,src.w-p.cw); rects[selIdx].y=clamp(Math.round(pt.y-drag.dy),0,src.h-p.ch);
  refresh();
});
const endDrag=()=>{ if(drag){ drag=null; refresh(); } };
cv.addEventListener("pointerup",endDrag); cv.addEventListener("pointercancel",endDrag);
cv.addEventListener("contextmenu",e=>{ if(mode!=="free"||!raw) return; e.preventDefault();
  const i=hit(params(),toSrc(e)); if(i>=0){ rects.splice(i,1); selIdx=-1; refresh(); } });
window.addEventListener("keydown",e=>{
  if(!modal.classList.contains("open")) return;
  if(e.key==="Escape"){ e.stopPropagation(); close(); return; }
  if((e.key==="Delete"||e.key==="Backspace") && mode==="free" && selIdx>=0 && e.target.tagName!=="INPUT" && e.target.tagName!=="SELECT"){
    e.preventDefault(); e.stopPropagation(); rects.splice(selIdx,1); selIdx=-1; refresh(); }
},true);
$("shMode").onchange=e=>setMode(e.target.value,true);
$("shDetect").onclick=()=>{ if(raw) detect(); };
$("shClear").onclick=()=>{ rects=[]; selIdx=-1; refresh(); };
["shCW","shCH"].forEach(id=>$(id).addEventListener("input",()=>{
  if(!raw) return;
  const p=params();
  if(mode==="free"){            // les cadres gardent leur centre quand leur taille change
    rects.forEach(r=>{ r.x=clamp(Math.round(r.x+lastCW/2-p.cw/2),0,src.w-p.cw); r.y=clamp(Math.round(r.y+lastCH/2-p.ch/2),0,src.h-p.ch); });
  } else excluded.clear();
  lastCW=p.cw; lastCH=p.ch; syncOutDefault(false); refresh();
}));
["shMargin","shGap"].forEach(id=>$(id).addEventListener("input",()=>{ excluded.clear(); refresh(); }));
$("shScale").addEventListener("input",()=>{ if(!raw) return; reduce(); detectBg(); rects=[]; excluded.clear(); refresh(); });
$("shOutW").addEventListener("input",()=>{ outTouched=true; refresh(); });
$("shTol").addEventListener("input",()=>{ $("shTolV").textContent=$("shTol").value+" %"; refresh(); });
["shBgOn","shSkipEmpty","shAlign","shColors","shColorsN"].forEach(id=>$(id).addEventListener("change",refresh));
$("shColorsN").addEventListener("input",refresh);

// ---------- Sources ----------
const loadFile=f=>{ const rd=new FileReader(); rd.onload=()=>{ const im=new Image(); im.onload=()=>readImage(im,(f.name||"planche").replace(/\.[^.]+$/,"")); im.src=rd.result; }; rd.readAsDataURL(f); };
$("shPick").onclick=()=>$("shFile").click();
$("shFile").onchange=e=>{ const f=e.target.files[0]; if(f) loadFile(f); e.target.value=""; };
function layerSource(){ const L=state.layers[state.active]; return L && L.img && L._imgEl && L._imgEl.naturalWidth ? L : null; }
$("shUseLayer").onclick=()=>{ const L=layerSource(); if(L) readImage(L._imgEl,L.name||"planche"); };
function open(){
  raw=null; src=null; rects=[]; selIdx=-1; excluded.clear(); $("shSrcName").textContent="Aucune image"; ok.disabled=true;
  cv.width=cv.height=1; $("shResult").width=$("shResult").height=1; $("shSummary").textContent="—"; $("shUseLayer").disabled=!layerSource();
  setMode("grid",true); modal.classList.add("open");
  const L=layerSource(); if(L) readImage(L._imgEl,L.name||"planche"); else $("shFile").click();
}
function close(){ modal.classList.remove("open"); }
$("miImportSheet").onclick=open;
$("sheetClose").onclick=close; $("sheetCancel").onclick=close;
modal.addEventListener("click",e=>{ if(e.target.id==="sheetModal") close(); });

// ---------- Import ----------
ok.onclick=()=>{
  if(!raw) return;
  const p=params(), frames=processFrames(p), dest=$("shDest").value;
  if(!frames||!frames.length) return;
  if(dest==="new"){
    if(p.ow<8||p.oh<8){ showToast("Un nouveau projet fait au moins 8×8 px : augmente la largeur de sortie ou ajoute à l'animation courante.",{type:"warn"}); return; }
    pushRecent();                                         // le projet en cours reste disponible dans « Projets récents »
    newProject({name:raw.name,w:p.ow,h:p.oh});
  }
  const W=state.W, H=state.H, ox=Math.floor((W-p.ow)/2), oy=Math.floor((H-p.oh)/2);
  const hex=v=>v.toString(16).padStart(2,"0");
  const sets=frames.map(f=>{
    const bgL=newLayer("Fond"), L=newLayer("Dessin");
    for(let y=0;y<p.oh;y++) for(let x=0;x<p.ow;x++){
      const tx=x+ox, ty=y+oy, i=(y*p.ow+x)*4; if(tx<0||ty<0||tx>=W||ty>=H||!f[i+3]) continue;
      L.data[ty*W+tx]=("#"+hex(f[i])+hex(f[i+1])+hex(f[i+2])).toUpperCase();
    }
    return [bgL,L];
  });
  importFrames(sets, dest==="new"?"replace":"append");
  close();
  showToast(`${sets.length} frame${sets.length>1?"s":""} importée${sets.length>1?"s":""} depuis la planche.`+(dest==="append"&&(p.ow!==W||p.oh!==H)?` Frames centrées dans le canevas ${W}×${H}.`:""),{type:"success"});
};
