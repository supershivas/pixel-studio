import { state } from "./state.js";
import { layerAt, setLayerAt, inBounds, hexToRgb, render } from "./helpers.js";
import { snapshot } from "./history.js";
import { buildLayers, openColorPicker, setTool } from "./ui.js";
import { setHint } from "./interaction.js";
import { mirrorPoints, collectRegion, wrapCell, brushOffsets, brushSize } from "./drawing.js";
import { BAYER4, BAYER8 } from "./dither.js";
import { lockColor } from "./palettes.js";

// ---------- Motifs de tramage (outil Tramage) ----------
// Un motif décide, pour chaque cellule du CANEVAS (coordonnées absolues, donc les traits successifs
// se raccordent sans rupture), si elle prend la couleur principale (true) ou le fond (false).
const bayerBelow=n=>(x,y)=>BAYER4[y&3][x&3]<n;
export const PATTERNS=[
  {id:"d12",    label:"12 %",               on:bayerBelow(2)},
  {id:"d25",    label:"25 %",               on:bayerBelow(4)},
  {id:"checker",label:"Damier 50 %",        on:(x,y)=>((x+y)&1)===0},
  {id:"d75",    label:"75 %",               on:bayerBelow(12)},
  {id:"d88",    label:"88 %",               on:bayerBelow(14)},
  {id:"hlines", label:"Lignes horizontales",on:(x,y)=>(y&1)===0},
  {id:"vlines", label:"Lignes verticales",  on:(x,y)=>(x&1)===0},
  {id:"diag",   label:"Diagonales",         on:(x,y)=>(((x-y)%4)+4)%4===0},
  {id:"dots",   label:"Points",             on:(x,y)=>(x&1)===0&&(y&1)===0},
];
const patternOn=()=>(PATTERNS.find(p=>p.id===state.ditherPattern)||PATTERNS[2]).on;
// couleur d'une cellule selon le motif actif ; undefined = ne rien changer (fond transparent)
function patternColor(on,x,y){
  if(on(x,y)) return state.color;
  return state.ditherBg==="color2" ? state.color2 : undefined;
}
// pinceau tramé : même géométrie que stamp() (taille, symétrie)
export function stampPattern(x,y,L){
  const on=patternOn(), offs=brushOffsets(brushSize(),state.brushShape), spray=state.brushShape==="spray" && state.brush>2;
  for(const [px,py] of mirrorPoints(x,y))
    for(const [dx,dy] of offs){
      if(spray && Math.random()>0.22) continue;
      const cell=wrapCell(px+dx,py+dy); if(!cell) continue;
      const c=patternColor(on,cell[0],cell[1]); if(c!==undefined) setLayerAt(L,cell[0],cell[1],c);
    }
}
// remplissage tramé : la zone du pot de peinture (tolérance / contiguïté comprises) reçoit le motif
export function patternFill(x,y){
  const L=state.layers[state.active], on=patternOn();
  if(L.alphaLock && layerAt(L,x,y)===null){ setHint("Transparence verrouillée — clique sur un pixel déjà peint"); return; }
  for(const [cx,cy] of collectRegion(L,x,y,state.fillTol,state.fillContig)){
    const c=patternColor(on,cx,cy); if(c!==undefined) setLayerAt(L,cx,cy,c);
  }
}

// ---------- Dégradé ----------
const hex2=v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,"0");
function mixHex(a,b,t){ const p=hexToRgb(a),q=hexToRgb(b);
  return "#"+[0,1,2].map(i=>hex2(p[i]+(q[i]-p[i])*t)).join("").toUpperCase(); }
const BAYER={bayer4:BAYER4,bayer8:BAYER8};

// zone dégradée : la sélection rectangulaire s'il y en a une, sinon tout le canevas
function gradientRegion(){
  const s=state.sel && !state.floatSel ? state.sel : null;
  return s ? {x:s.x,y:s.y,w:s.w,h:s.h} : {x:0,y:0,w:state.W,h:state.H};
}
// couleur (hex, ou null = transparent) de la cellule (x,y) pour un dégradé de A vers B
function gradientColor(g,x,y){ return lockColor(gradientRaw(g,x,y)); }
function gradientRaw(g,x,y){
  const px=x+.5-(g.x0+.5), py=y+.5-(g.y0+.5), dx=g.x1-g.x0, dy=g.y1-g.y0, len2=dx*dx+dy*dy;
  let t=0;
  if(len2>0) t = state.gradShape==="radial" ? Math.hypot(px,py)/Math.sqrt(len2) : (px*dx+py*dy)/len2;
  t=Math.max(0,Math.min(1,t));
  const c1=state.color, c2=state.gradClear ? null : state.color2;
  let style=state.gradStyle;
  if(c2===null && (style==="smooth"||style==="bands")) style="bayer8";   // pas de teinte intermédiaire vers le vide
  if(style==="smooth") return mixHex(c1,c2,t);
  if(style==="bands"){ const n=Math.max(2,state.gradSteps|0), i=Math.min(n-1,Math.floor(t*n)); return mixHex(c1,c2,i/(n-1)); }
  const M=BAYER[style]||BAYER4, n=M.length, th=(M[y%n][x%n]+.5)/(n*n);
  return t>th ? c2 : c1;
}
// aperçu pendant le glissé, puis application au relâchement
export function gradientPreview(){
  const g=state.gradDrag; if(!g) return;
  const L=state.layers[state.active], r=gradientRegion(), map=new Map();
  for(let y=r.y;y<r.y+r.h;y++) for(let x=r.x;x<r.x+r.w;x++){
    if(state.gradPainted && layerAt(L,x,y)===null) continue;
    const c=gradientColor(g,x,y); if(c!==null) map.set(x+","+y,c);
  }
  state.previewCells=map; render();
}
export function gradientApply(){
  const g=state.gradDrag; state.gradDrag=null; state.previewCells=null;
  if(!g || (g.x0===g.x1 && g.y0===g.y1)){ render(); return; }
  const L=state.layers[state.active], r=gradientRegion();
  snapshot("Dégradé");
  for(let y=r.y;y<r.y+r.h;y++) for(let x=r.x;x<r.x+r.w;x++){
    if(state.gradPainted && layerAt(L,x,y)===null) continue;
    setLayerAt(L,x,y,gradientColor(g,x,y));
  }
  state.thumbsDirty=true; buildLayers(); render();
  setHint("Dégradé appliqué");
}

// ---------- Remplacer une couleur ----------
// scope : "layer" (calque actif) | "selection" (rectangle sélectionné) | "all" (tous les calques de pixels)
export function replaceColor(from,to,tolPct,scope){
  const maxD=(tolPct||0)/100*441.7;
  const layers = scope==="all" ? state.layers.filter(L=>!L.isGroup&&!L.img&&!L.locked) : [state.layers[state.active]];
  const sel = scope==="selection" ? state.sel : null;
  const x0=sel?sel.x:0, y0=sel?sel.y:0, x1=sel?sel.x+sel.w:state.W, y1=sel?sel.y+sel.h:state.H;
  let n=0, plan=[];
  for(const L of layers){ if(!L || L.img || L.locked || L.isGroup) continue;
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){
      const c=layerAt(L,x,y); if(c===null||c===to) continue;
      if(hexDist(c,from)<=maxD) plan.push([L,x,y]); } }
  if(!plan.length) return 0;
  snapshot("Remplacer une couleur");
  for(const [L,x,y] of plan){ setLayerAt(L,x,y,to); n++; }
  state.thumbsDirty=true; buildLayers(); render();
  return n;
}
function hexDist(a,b){ if(a===b) return 0; const p=hexToRgb(a),q=hexToRgb(b); return Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]); }

// ---------- Interface : options des outils Dégradé / Tramage / Pot / Crayon ----------
const $=id=>document.getElementById(id);
const ditherPicker=$("ditherPicker");
PATTERNS.forEach(p=>{
  let rects=""; for(let y=0;y<8;y++) for(let x=0;x<8;x++) if(p.on(x,y)) rects+=`<rect x="${x}" y="${y}" width="1" height="1"/>`;
  const b=document.createElement("button"); b.type="button"; b.className="skind"+(p.id===state.ditherPattern?" active":"");
  b.title=p.label; b.dataset.pattern=p.id;
  b.innerHTML=`<svg viewBox="0 0 8 8" shape-rendering="crispEdges" fill="currentColor">${rects}</svg>`;
  b.addEventListener("click",()=>{ state.ditherPattern=p.id; [...ditherPicker.children].forEach(el=>el.classList.toggle("active",el===b)); });
  ditherPicker.appendChild(b);
});
$("pixelPerfect").onchange=e=>state.pixelPerfect=e.target.checked;
$("fillTol").oninput=e=>{ state.fillTol=+e.target.value; $("fillTolV").textContent=state.fillTol+" %"; };
$("fillContig").onchange=e=>state.fillContig=e.target.checked;
$("gradShape").onchange=e=>state.gradShape=e.target.value;
$("gradStyle").onchange=e=>{ state.gradStyle=e.target.value; $("gradStepsWrap").hidden=state.gradStyle!=="bands"; };
$("gradSteps").oninput=e=>state.gradSteps=Math.max(2,Math.min(16,+e.target.value||4));
$("gradClear").onchange=e=>state.gradClear=e.target.checked;
$("gradPainted").onchange=e=>state.gradPainted=e.target.checked;
$("gradStepsWrap").hidden=true;
$("ditherBg").onchange=e=>state.ditherBg=e.target.value;
$("ditherMode").onchange=e=>state.ditherMode=e.target.value;

// ---------- Fenêtre « Remplacer une couleur » ----------
const repModal=$("replaceModal"), repFrom=$("repFrom"), repTo=$("repTo");
let repFromHex="#000000", repToHex="#FFFFFF";
function paintRepChips(){ repFrom.style.background=repFromHex; repTo.style.background=repToHex; }
function openReplace(){
  repFromHex=state.color; repToHex=state.color2; paintRepChips();
  $("repScope").value = state.sel && !state.floatSel ? "selection" : "layer";
  repModal.classList.add("open");
}
function closeReplace(){ repModal.classList.remove("open"); }
$("fxReplace").onclick=openReplace;
repFrom.onclick=()=>openColorPicker(repFrom, repFromHex, hex=>{ repFromHex=hex; paintRepChips(); });
repTo.onclick=()=>openColorPicker(repTo, repToHex, hex=>{ repToHex=hex; paintRepChips(); });
$("repTol").oninput=e=>$("repTolV").textContent=e.target.value+" %";
$("replaceClose").onclick=closeReplace; $("replaceCancel").onclick=closeReplace;
repModal.addEventListener("click",e=>{ if(e.target.id==="replaceModal") closeReplace(); });
$("replaceOk").onclick=()=>{
  const scope=$("repScope").value;
  if(scope==="selection" && !(state.sel && !state.floatSel)){ setHint("Aucune sélection : fais d'abord une sélection rectangulaire"); return; }
  const n=replaceColor(repFromHex,repToHex,+$("repTol").value,scope);
  closeReplace();
  setHint(n ? n+" pixel"+(n>1?"s":"")+" remplacé"+(n>1?"s":"") : "Aucun pixel de cette couleur");
};

// ---------- Formes de pinceau (sélecteur de la barre d'options) ----------
const BRUSH_SHAPES=[
  {id:"square",label:"Carré",svg:'<rect x="6" y="6" width="12" height="12" fill="currentColor"/>'},
  {id:"round",label:"Rond",svg:'<circle cx="12" cy="12" r="6.5" fill="currentColor"/>'},
  {id:"diamond",label:"Losange",svg:'<path d="M12 4l8 8-8 8-8-8z" fill="currentColor"/>'},
  {id:"hline",label:"Trait horizontal",svg:'<rect x="4" y="10.5" width="16" height="3" fill="currentColor"/>'},
  {id:"vline",label:"Trait vertical",svg:'<rect x="10.5" y="4" width="3" height="16" fill="currentColor"/>'},
  {id:"slash",label:"Diagonale /",svg:'<path d="M5 19L19 5" stroke="currentColor" stroke-width="3" fill="none"/>'},
  {id:"backslash",label:"Diagonale \\",svg:'<path d="M5 5l14 14" stroke="currentColor" stroke-width="3" fill="none"/>'},
  {id:"spray",label:"Aérographe (disque aléatoire)",svg:'<g fill="currentColor"><circle cx="8" cy="9" r="1.4"/><circle cx="13" cy="7" r="1.4"/><circle cx="16.5" cy="11" r="1.4"/><circle cx="11" cy="12" r="1.4"/><circle cx="7.5" cy="15.5" r="1.4"/><circle cx="14" cy="16.5" r="1.4"/><circle cx="17" cy="16" r="1"/></g>'},
];
const brushPicker=$("brushShapePicker");
BRUSH_SHAPES.forEach(b=>{
  const el=document.createElement("button"); el.type="button"; el.className="skind"+(b.id===state.brushShape?" active":""); el.title=b.label; el.dataset.shape=b.id;
  el.innerHTML='<svg viewBox="0 0 24 24">'+b.svg+'</svg>';
  el.addEventListener("click",()=>{ state.brushShape=b.id; [...brushPicker.children].forEach(c=>c.classList.toggle("active",c===el)); });
  brushPicker.appendChild(el);
});
$("brushPressure").onchange=e=>state.brushPressure=e.target.checked;
$("stabilize").oninput=e=>state.stabilize=+e.target.value;
