import { state, PALETTE } from "./state.js";
import { hexToRgb, compositeLayers } from "./helpers.js";
import { buildSwatches, setColor, setColor2 } from "./ui.js";
import { renderPixelizeSource, pixelizeCells, medianCutPalette, toHex } from "./drawing.js";
import { showToast } from "./toast.js";

const $=id=>document.getElementById(id);

// ---------- Palette courante et verrouillage ----------
export const allColors=()=>PALETTE.concat(state.customColors);
export function nearestPaletteColor(hex){
  const pal=allColors(); if(!pal.length) return hex;
  const [r,g,b]=hexToRgb(hex); let best=pal[0],bd=Infinity;
  for(const c of pal){ const [pr,pg,pb]=hexToRgb(c), d=(r-pr)**2+(g-pg)**2+(b-pb)**2; if(d<bd){ bd=d; best=c; } }
  return best.toUpperCase();
}
// utilisé partout où une couleur est choisie ou calculée : inchangée si la palette n'est pas verrouillée
export const lockColor=hex=>state.paletteLock && hex ? nearestPaletteColor(hex) : hex;

const LOCK_KEY="eupix.paletteLock";
state.paletteLock=false;
try{ state.paletteLock=localStorage.getItem(LOCK_KEY)==="1"; }catch(_){}
function syncLockUI(){ $("palLock").checked=state.paletteLock; $("palLockBadge").hidden=!state.paletteLock; }
$("palLock").onchange=e=>{
  state.paletteLock=e.target.checked;
  try{ localStorage.setItem(LOCK_KEY,state.paletteLock?"1":"0"); }catch(_){}
  if(state.paletteLock){ setColor(state.color); setColor2(state.color2); }
  syncLockUI();
};
syncLockUI();

// ---------- Ajouter des couleurs à la palette du fichier ----------
function addColors(list,replace){
  if(replace) state.customColors=[];
  const known=new Set(allColors().map(c=>c.toUpperCase())); let added=0;
  for(const c of list){ const h=c.toUpperCase(); if(/^#[0-9A-F]{6}$/.test(h) && !known.has(h)){ state.customColors.push(h); known.add(h); added++; } }
  buildSwatches(); return added;
}
const strip=(el,colors)=>{ el.innerHTML=""; colors.forEach(c=>{ const i=document.createElement("i"); i.style.background=c; i.title=c; el.appendChild(i); }); };

$("palClearCustom").onclick=()=>{
  if(!state.customColors.length){ showToast("Aucune couleur ajoutée à retirer.",{type:"info"}); return; }
  const prev=state.customColors.slice(); state.customColors=[]; buildSwatches();
  showToast(prev.length+" couleur"+(prev.length>1?"s":"")+" retirée"+(prev.length>1?"s":"")+".",{type:"info",duration:8000,
    actionLabel:"Annuler", onAction:()=>{ state.customColors=prev; buildSwatches(); }});
};

// ---------- Bibliothèque de palettes célèbres ----------
export const LIBRARY=[
  {name:"PICO-8", colors:"000000 1D2B53 7E2553 008751 AB5236 5F574F C2C3C7 FFF1E8 FF004D FFA300 FFEC27 00E436 29ADFF 83769C FF77A8 FFCCAA"},
  {name:"Game Boy", colors:"0F380F 306230 8BAC0F 9BBC0F"},
  {name:"Commodore 64", colors:"000000 FFFFFF 68372B 70A4B2 6F3D86 588D43 352879 B8C76F 6F4F25 433900 9A6759 444444 6C6C6C 9AD284 6C5EB5 959595"},
  {name:"ZX Spectrum", colors:"000000 0000D7 D70000 D700D7 00D700 00D7D7 D7D700 D7D7D7 0000FF FF0000 FF00FF 00FF00 00FFFF FFFF00 FFFFFF"},
  {name:"CGA (palette 1)", colors:"000000 55FFFF FF55FF FFFFFF"},
  {name:"Sweetie 16", colors:"1A1C2C 5D275D B13E53 EF7D57 FFCD75 A7F070 38B764 257179 29366F 3B5DC9 41A6F6 73EFF7 F4F4F4 94B0C2 566C86 333C57"},
  {name:"ARNE 16", colors:"000000 9D9D9D FFFFFF BE2633 E06F8B 493C2B A46422 EB8931 F7E26B 2F484E 44891A A3CE27 1B2632 005784 31A2F2 B2DCEF"},
  {name:"Endesga 32", colors:"BE4A2F D77643 EAD4AA E4A672 B86F50 733E39 3E2731 A22633 E43B44 F77622 FEAE34 FEE761 63C74D 3E8948 265C42 193C3E 124E89 0099DB 2CE8F5 FFFFFF C0CBDC 8B9BB4 5A6988 3A4466 262B44 181425 FF0044 68386C B55088 F6757A E8B796 C28569"},
  {name:"Noir et blanc (1 bit)", colors:"000000 FFFFFF"},
].map(p=>({name:p.name, colors:p.colors.split(" ").map(c=>"#"+c)}));

function buildLibrary(){
  const box=$("palLibList"); box.innerHTML="";
  LIBRARY.forEach(p=>{
    const row=document.createElement("div"); row.className="pref";
    const lbl=document.createElement("div"); lbl.className="lbl"; lbl.innerHTML=`${p.name}<small>${p.colors.length} couleurs</small>`;
    const mid=document.createElement("div"); mid.className="pal-strip"; strip(mid,p.colors);
    const btns=document.createElement("div"); btns.className="inline sm";
    const add=document.createElement("button"); add.textContent="Ajouter"; add.title="Ajoute ces couleurs à la palette du fichier";
    const rep=document.createElement("button"); rep.textContent="Remplacer"; rep.title="Remplace les couleurs ajoutées par celles-ci";
    add.onclick=()=>{ const n=addColors(p.colors,false); showToast(n?`${p.name} : ${n} couleur${n>1?"s":""} ajoutée${n>1?"s":""}.`:`${p.name} : déjà dans la palette.`,{type:n?"success":"info"}); };
    rep.onclick=()=>{ const n=addColors(p.colors,true); showToast(`Palette « ${p.name} » chargée (${n} couleurs).`,{type:"success"}); };
    btns.append(add,rep);
    row.append(lbl,mid,btns); box.appendChild(row);
  });
}
const libModal=$("paletteLibModal");
$("palLibraryOpen").onclick=()=>{ buildLibrary(); libModal.classList.add("open"); };
const closeLib=()=>libModal.classList.remove("open");
$("palLibClose").onclick=closeLib; $("palLibDone").onclick=closeLib;
libModal.addEventListener("click",e=>{ if(e.target.id==="paletteLibModal") closeLib(); });

// ---------- Extraire la palette de l'image (ou du dessin) ----------
const exModal=$("paletteExtractModal");
let exColors=[];
function extractPalette(n){
  const L=state.layers[state.active];
  let px, label;
  if(L && L.img && L._imgEl && L._imgEl.naturalWidth){ px=renderPixelizeSource(L); label="Le calque image « "+(L.name||"image")+" »"; }
  else { px=compositeLayers(state.layers).data; label="Le dessin complet (tous les calques visibles)"; }
  const cells=pixelizeCells(px,1,128);
  return {label, colors:medianCutPalette(cells,n).map(toHex)};
}
function refreshExtract(){
  const n=+$("palExN").value, r=extractPalette(n);
  exColors=r.colors; $("palExNV").textContent=n; $("palExSource").textContent=r.label;
  strip($("palExStrip"),exColors); $("palExOk").disabled=!exColors.length;
}
$("palExtractOpen").onclick=()=>{ refreshExtract(); exModal.classList.add("open"); };
const closeEx=()=>exModal.classList.remove("open");
$("palExN").oninput=refreshExtract;
$("palExClose").onclick=closeEx; $("palExCancel").onclick=closeEx;
exModal.addEventListener("click",e=>{ if(e.target.id==="paletteExtractModal") closeEx(); });
$("palExOk").onclick=()=>{
  const n=addColors(exColors,$("palExReplace").checked); closeEx();
  showToast(n?`${n} couleur${n>1?"s":""} ajoutée${n>1?"s":""} à la palette.`:"Ces couleurs sont déjà dans la palette.",{type:n?"success":"info"});
};
