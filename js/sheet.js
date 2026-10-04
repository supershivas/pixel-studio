import { state } from "./state.js";
import { newLayer } from "./helpers.js";
import { importFrames } from "./frames.js";
import { newProject, setProjectName } from "./ui.js";
import { pushRecent } from "./io.js";
import { showToast } from "./toast.js";

// ---------- Importer une planche de sprites : découper une image en cellules → frames ----------
const $=id=>document.getElementById(id);
const modal=$("sheetModal"), cv=$("shPreview"), ok=$("sheetOk");
const num=(id,min,max)=>Math.max(min,Math.min(max,Math.round(+$(id).value)||min));
let raw=null;                 // image d'origine {data,w,h,name}
let src=null;                 // image après réduction {data,w,h}
const excluded=new Set();     // cellules écartées à la main

function readImage(im,name){
  const c=document.createElement("canvas"); c.width=im.naturalWidth; c.height=im.naturalHeight;
  const g=c.getContext("2d",{willReadFrequently:true}); g.drawImage(im,0,0);
  raw={ data:g.getImageData(0,0,c.width,c.height).data, w:c.width, h:c.height, name };
  const k=detectScale(raw); $("shScale").value=k;
  // cellule par défaut : bande horizontale de carrés, sinon le plus grand diviseur commun
  const w0=Math.floor(raw.w/k), h0=Math.floor(raw.h/k);
  // la taille du canevas actuel si elle découpe la planche (planche exportée par l'app), sinon une bande de carrés
  if(w0%state.W===0 && h0%state.H===0 && (w0>state.W||h0>state.H)){ $("shCW").value=state.W; $("shCH").value=state.H; }
  else { let cell = w0>h0 && w0%h0===0 ? h0 : gcd(w0,h0);
    if(cell<8) cell=Math.min(w0,h0);
    $("shCW").value=$("shCH").value=Math.min(512,cell); } $("shMargin").value=0; $("shGap").value=0;
  excluded.clear(); $("shSrcName").textContent=`${name} — ${raw.w}×${raw.h} px`+(k>1?` (÷${k})`:"");
  refresh();
}
const gcd=(a,b)=>b?gcd(b,a%b):a;
// planche agrandie à la souris ou exportée à l'échelle ×N : plus grand k tel que l'image soit faite de blocs k×k uniformes
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
// grille de cellules {x,y,empty}
function grid(){
  const cw=num("shCW",1,512), ch=num("shCH",1,512), m=num("shMargin",0,256), gap=num("shGap",0,256), cells=[];
  const cols=Math.max(0,Math.floor((src.w-2*m+gap)/(cw+gap))), rows=Math.max(0,Math.floor((src.h-2*m+gap)/(ch+gap)));
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    const x=m+c*(cw+gap), y=m+r*(ch+gap); let empty=true;
    for(let j=0;j<ch&&empty;j++) for(let i=0;i<cw;i++) if(src.data[((y+j)*src.w+x+i)*4+3]>=128){ empty=false; break; }
    cells.push({x,y,empty});
  }
  return {cells,cw,ch,cols,rows};
}
const chosen=g=>g.cells.map((c,i)=>({...c,i})).filter(c=>!excluded.has(c.i) && !($("shSkipEmpty").checked && c.empty));
function refresh(){
  if(!raw){ ok.disabled=true; return; }
  reduce();
  const g=grid(), s=Math.max(1,Math.floor(480/src.w));
  cv.width=src.w*s; cv.height=src.h*s;
  const t=document.createElement("canvas"); t.width=src.w; t.height=src.h;
  t.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(src.data),src.w,src.h),0,0);
  const x=cv.getContext("2d"); x.imageSmoothingEnabled=false; x.clearRect(0,0,cv.width,cv.height); x.drawImage(t,0,0,cv.width,cv.height);
  const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const keep=new Set(chosen(g).map(c=>c.i));
  const lw=Math.max(2,s); x.font=`${Math.max(14,s*5)}px ui-monospace,monospace`; x.textBaseline="top"; x.lineWidth=lw;
  g.cells.forEach((c,i)=>{
    const px=c.x*s, py=c.y*s, pw=g.cw*s, ph=g.ch*s, on=keep.has(i);
    if(!on){ x.fillStyle="rgba(6,10,20,.65)"; x.fillRect(px,py,pw,ph); }
    x.strokeStyle=on?(css("--accent")||"#ffcc00"):(css("--ink-dim")||"#8fa0c4"); x.strokeRect(px+lw/2,py+lw/2,pw-lw,ph-lw);
    if(on){ x.fillStyle=css("--accent")||"#ffcc00"; x.fillText(String([...keep].indexOf(i)+1),px+lw+3,py+lw+2); }
  });
  const n=keep.size;
  $("shSummary").textContent = g.cells.length ? `${g.cols} × ${g.rows} cellules · ${n} frame${n>1?"s":""} de ${g.cw}×${g.ch} px` : "Aucune cellule : réduis la taille de cellule";
  ok.disabled = n===0;
}
// clic sur l'aperçu : exclure / reprendre une cellule
cv.addEventListener("click",e=>{
  if(!raw) return;
  const r=cv.getBoundingClientRect(), s=cv.width/src.w;
  const fit=Math.min(r.width/cv.width, r.height/cv.height)||1, ox=(r.width-cv.width*fit)/2, oy=(r.height-cv.height*fit)/2;   // object-fit: contain
  const px=((e.clientX-r.left-ox)/fit)/s, py=((e.clientY-r.top-oy)/fit)/s, g=grid();
  const i=g.cells.findIndex(c=>px>=c.x&&px<c.x+g.cw&&py>=c.y&&py<c.y+g.ch);
  if(i<0) return;
  if(excluded.has(i)) excluded.delete(i); else excluded.add(i);
  refresh();
});
["shCW","shCH","shMargin","shGap","shScale"].forEach(id=>$(id).addEventListener("input",()=>{ excluded.clear(); refresh(); }));
$("shSkipEmpty").onchange=refresh;

// ---------- Sources ----------
const loadFile=f=>{ const rd=new FileReader(); rd.onload=()=>{ const im=new Image(); im.onload=()=>readImage(im,(f.name||"planche").replace(/\.[^.]+$/,"")); im.src=rd.result; }; rd.readAsDataURL(f); };
$("shPick").onclick=()=>$("shFile").click();
$("shFile").onchange=e=>{ const f=e.target.files[0]; if(f) loadFile(f); e.target.value=""; };
function layerSource(){ const L=state.layers[state.active]; return L && L.img && L._imgEl && L._imgEl.naturalWidth ? L : null; }
$("shUseLayer").onclick=()=>{ const L=layerSource(); if(L) readImage(L._imgEl,L.name||"planche"); };

function open(){
  raw=null; src=null; excluded.clear(); $("shSrcName").textContent="Aucune image"; ok.disabled=true;
  const g=cv.getContext("2d"); cv.width=cv.height=1; g.clearRect(0,0,1,1);
  $("shSummary").textContent="—"; $("shUseLayer").disabled=!layerSource();
  modal.classList.add("open");
  const L=layerSource(); if(L) readImage(L._imgEl,L.name||"planche"); else $("shFile").click();
}
const close=()=>modal.classList.remove("open");
$("miImportSheet").onclick=open;
$("sheetClose").onclick=close; $("sheetCancel").onclick=close;
modal.addEventListener("click",e=>{ if(e.target.id==="sheetModal") close(); });
window.addEventListener("keydown",e=>{ if(e.key==="Escape" && modal.classList.contains("open")){ e.stopPropagation(); close(); } },true);

// ---------- Import ----------
ok.onclick=()=>{
  if(!raw) return;
  const g=grid(), list=chosen(g), dest=$("shDest").value;
  if(!list.length) return;
  const name=raw.name;
  if(dest==="new"){
    if(g.cw<8||g.ch<8){ showToast("Un nouveau projet fait au moins 8×8 px : agrandis la cellule ou ajoute à l'animation courante.",{type:"warn"}); return; }
    pushRecent();                                         // le projet en cours reste disponible dans « Projets récents »
    newProject({name,w:g.cw,h:g.ch});
  }
  const W=state.W, H=state.H, ox=Math.floor((W-g.cw)/2), oy=Math.floor((H-g.ch)/2);
  const hex=v=>v.toString(16).padStart(2,"0");
  const sets=list.map(c=>{
    const bg=newLayer("Fond"), L=newLayer("Dessin");
    for(let y=0;y<g.ch;y++) for(let x=0;x<g.cw;x++){
      const tx=x+ox, ty=y+oy; if(tx<0||ty<0||tx>=W||ty>=H) continue;
      const i=((c.y+y)*src.w+c.x+x)*4; if(src.data[i+3]<128) continue;
      L.data[ty*W+tx]=(hex(src.data[i])+hex(src.data[i+1])+hex(src.data[i+2])).toUpperCase();
    }
    return [bg,L];
  });
  importFrames(sets, dest==="new"?"replace":"append");
  close();
  showToast(`${sets.length} frame${sets.length>1?"s":""} importée${sets.length>1?"s":""} depuis la planche.`+(dest==="append"&&(g.cw!==W||g.ch!==H)?` Cellules centrées dans le canevas ${W}×${H}.`:""),{type:"success"});
};
