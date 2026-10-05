import { state, PALETTE } from "./state.js";
import { compositeLayers, newLayer, newImageLayer, render, encodeLayers, decodeLayers } from "./helpers.js";
import { snapshot, history, onSnapshot } from "./history.js";
import { bakeShape } from "./drawing.js";
import { setHint, fitZoom } from "./interaction.js";
import { buildLayers, buildSwatches, PRESETS, setProjectName, openColorPicker, commitCanvasText } from "./ui.js";
import { showToast } from "./toast.js";
import { framesSnapshotForSave, loadFramesFromSave } from "./frames.js";
import { crc32, encodeGIF, encodeAPNG } from "./anim.js";
import { medianCutPalette } from "./drawing.js";

// ---------- Export ----------
// bg : couleur de fond (hex) ou null/false pour un rendu transparent
function flattenCanvas(ls,scale,bg){
  const c=document.createElement("canvas"); c.width=state.W*scale; c.height=state.H*scale;
  const cx=c.getContext("2d"); cx.imageSmoothingEnabled=false;
  if(bg){ cx.fillStyle=(bg===true?"#FFFFFF":bg); cx.fillRect(0,0,c.width,c.height); }
  const tmp=document.createElement("canvas"); tmp.width=state.W; tmp.height=state.H;
  tmp.getContext("2d").putImageData(compositeLayers(ls),0,0);
  cx.drawImage(tmp,0,0,c.width,c.height);
  return c;
}
function svgString(ls,scale,bg){
  const img=compositeLayers(ls).data;
  let rects=bg?`<rect x="0" y="0" width="${state.W}" height="${state.H}" fill="${bg}"/>`:"";
  for(let y=0;y<state.H;y++){
    let x=0;
    while(x<state.W){
      const j=(y*state.W+x)*4; const a=img[j+3];
      if(a<2){ x++; continue; }
      const r=img[j],g=img[j+1],b=img[j+2];
      let run=1;
      while(x+run<state.W){ const k=(y*state.W+x+run)*4;
        if(img[k+3]!==a||img[k]!==r||img[k+1]!==g||img[k+2]!==b) break; run++; }
      const hex="#"+[r,g,b].map(v=>v.toString(16).padStart(2,"0")).join("");
      const op = a>=254 ? "" : ` fill-opacity="${(a/255).toFixed(3)}"`;
      rects+=`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${hex}"${op}/>`;
      x+=run;
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n`+
    `<svg xmlns="http://www.w3.org/2000/svg" width="${state.W*scale}" height="${state.H*scale}" `+
    `viewBox="0 0 ${state.W} ${state.H}" shape-rendering="crispEdges">\n${rects}\n</svg>`;
}
// ---------- Enregistrer un fichier (bureau : téléchargement ; iPad / iPhone : feuille de partage) ----------
// Sur iOS / iPadOS, un lien « download » vers une URL data: ouvre l'image dans l'onglet (ou quitte l'app installée) et le
// fichier est perdu. On passe donc par la feuille de partage (« Enregistrer dans Fichiers », « Enregistrer l'image »,
// AirDrop…) ; si le navigateur la refuse (geste utilisateur expiré), un bouton dans la notification la rouvre.
const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
const MIME_BY_EXT={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",svg:"image/svg+xml",gif:"image/gif",txt:"text/plain",json:"application/json",zip:"application/zip",pixel:"application/json",gz:"application/gzip"};
function anchorDownload(blob,name){
  const url=URL.createObjectURL(blob), a=document.createElement("a"); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export async function saveBlob(blob,name){
  const ext=(name.split(".").pop()||"").toLowerCase();
  const file=new File([blob],name,{type:blob.type||MIME_BY_EXT[ext]||"application/octet-stream"});
  if(isIOS && navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
    const share=()=>navigator.share({files:[file],title:name});
    try{ await share(); return true; }
    catch(err){
      if(err && err.name==="AbortError") return false;                       // l'utilisateur a fermé la feuille
      showToast("Le fichier est prêt : touche « Enregistrer » pour l'envoyer vers Fichiers ou Photos.",{ type:"info", duration:60000,
        actionLabel:"Enregistrer", onAction:()=>{ share().catch(()=>{}); } });
      return false;
    }
  }
  anchorDownload(blob,name); return true;
}
// url : Blob, URL blob: ou data:
async function download(src,name){
  const blob = src instanceof Blob ? src : await (await fetch(src)).blob();
  return saveBlob(blob,name);
}
function stamp2(){ return new Date().toISOString().slice(0,10); }
function safeName(s){ return (s||"").trim().replace(/[^\w\-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40)||"carte"; }

// ---------- Modale d'export (Fichier › Exporter…) ----------
// Tous les formats au même endroit ; les réglages (format, échelle, fond…) peuvent être
// enregistrés sous un nom et rappelés plus tard (localStorage, sur cet appareil).
const EXPORT_MAX_SIDE=16384, EXPORT_ANIM_MAX=2048;                  // limite de taille de canevas des navigateurs
const QUICK_SCALES=[1,2,4,8,16];
const EXPORT_PRESETS_KEY="eupix.exportPresets", EXPORT_LAST_KEY="eupix.exportLast";
const FORMATS={
  png:    {label:"PNG",             ext:"png", scale:true,  bg:"opt",   hint:"Image raster, fond transparent possible"},
  jpg:    {label:"JPG",             ext:"jpg", scale:true,  bg:"force", quality:true, hint:"Photo compressée, toujours sur fond plein"},
  svg:    {label:"SVG",             ext:"svg", scale:true,  bg:"opt",   hint:"Vectoriel, net à toutes les tailles (impression)"},
  sprites:{label:"Planche de sprites", ext:"png", scale:true, bg:"opt", cols:true, frames:true, hint:"Toutes les frames de l'animation en grille"},
  gif:    {label:"GIF animé",       ext:"gif", scale:true,  bg:"opt",   frames:true, hint:"Animation, durées par frame respectées (256 couleurs max)"},
  apng:   {label:"APNG animé",      ext:"png", scale:true,  bg:"opt",   frames:true, hint:"Animation PNG sans perte, transparence complète"},
  ascii:  {label:"ASCII art",       ext:"txt", hint:"Niveaux de gris en caractères"},
  grid:   {label:"Grille de couleurs", ext:"txt", hint:"Une valeur hexa par pixel"},
  palette:{label:"Palette",         ext:"json", hint:"Couleurs ajoutées au projet, réimportables"},
};
const DEFAULT_EXPORT={ format:"png", scale:6, bgOn:false, bgHex:"#FFFFFF", quality:95, cols:0 };
const $=id=>document.getElementById(id);
const exportModal=$("exportModal"), exScaleEl=$("exScale"), exBgOn=$("exBgOn"), exBgSw=$("exBgColor");
let exFormat="png", exBgHex="#FFFFFF";

function readJSON(key,fallback){ try{ const v=JSON.parse(localStorage.getItem(key)); return v==null?fallback:v; }catch(_){ return fallback; } }
function writeJSON(key,v){ try{ localStorage.setItem(key,JSON.stringify(v)); return true; }catch(_){ return false; } }
function getExportPresets(){ const l=readJSON(EXPORT_PRESETS_KEY,[]); return Array.isArray(l)?l.filter(x=>x && typeof x.name==="string" && x.settings):[]; }

function exScale(){ return Math.max(1,Math.min(64,+exScaleEl.value||1)); }
function exCols(){ return Math.max(0,Math.min(64,Math.round(+$("exCols").value||0))); }
function exQuality(){ return Math.max(50,Math.min(100,+$("exQuality").value||95)); }
function currentExportSettings(){
  return { format:exFormat, scale:exScale(), bgOn:exBgOn.checked, bgHex:exBgHex, quality:exQuality(), cols:exCols() };
}
function applyExportSettings(st){
  st=Object.assign({},DEFAULT_EXPORT,st||{});
  exFormat=FORMATS[st.format]?st.format:"png";
  exScaleEl.value=Math.max(1,Math.min(64,+st.scale||6));
  exBgOn.checked=!!st.bgOn;
  exBgHex=/^#[0-9a-fA-F]{6}$/.test(st.bgHex)?st.bgHex.toUpperCase():"#FFFFFF";
  $("exQuality").value=Math.max(50,Math.min(100,+st.quality||95));
  $("exCols").value=Math.max(0,Math.min(64,+st.cols||0));
}
function spriteGrid(){
  const n=Math.max(1,state.frames.length), cols=exCols()||Math.ceil(Math.sqrt(n)), c=Math.min(cols,n);
  return {cols:c, rows:Math.ceil(n/c), n};
}
function exportBg(){ const f=FORMATS[exFormat]; return f.bg==="force"||exBgOn.checked ? exBgHex : null; }
function buildExportFormatPicker(){
  const box=$("exFormats"); box.innerHTML="";
  for(const k of Object.keys(FORMATS)){
    const b=document.createElement("button"); b.type="button"; b.className="mini"; b.dataset.fmt=k;
    b.textContent=FORMATS[k].label; b.title=FORMATS[k].hint;
    b.addEventListener("click",()=>{ exFormat=k; refreshExportModal(); });
    box.appendChild(b);
  }
}
function buildExportScalePicker(){
  const box=$("exScalePicker"); box.innerHTML="";
  const reco=+$("expScale").value||0;
  const scales=QUICK_SCALES.slice();
  if(reco && !scales.includes(reco)) scales.push(reco);
  scales.sort((a,b)=>a-b);
  for(const v of scales){
    const b=document.createElement("button"); b.type="button"; b.className="mini"; b.dataset.scale=v;
    b.textContent="×"+v+(v===reco?" ✓":"");
    b.title=v===reco?"Échelle conseillée pour ce format":(state.W*v)+" × "+(state.H*v)+" px";
    b.addEventListener("click",()=>{ exScaleEl.value=v; refreshExportModal(); });
    box.appendChild(b);
  }
}
function buildExportPresetSelect(selected){
  const sel=$("exPresetSel"); sel.innerHTML="";
  const o0=document.createElement("option"); o0.value=""; o0.textContent="— Réglages actuels —"; sel.appendChild(o0);
  getExportPresets().forEach(p=>{ const o=document.createElement("option"); o.value=p.name; o.textContent=p.name; sel.appendChild(o); });
  sel.value=selected||"";
  $("exPresetDel").disabled=!sel.value;
}
function exportDims(){
  const sc=exScale();
  if(exFormat==="sprites"){ const g=spriteGrid(); return {w:g.cols*state.W*sc, h:g.rows*state.H*sc, g}; }
  return {w:state.W*sc, h:state.H*sc};
}
function refreshExportModal(){
  const f=FORMATS[exFormat], sc=exScale();
  [...$("exFormats").children].forEach(b=>b.classList.toggle("active",b.dataset.fmt===exFormat));
  [...$("exScalePicker").children].forEach(b=>b.classList.toggle("active",+b.dataset.scale===sc));
  $("exExt").textContent="."+f.ext;
  $("exFmtHint").textContent=f.hint;
  $("exScaleRow").hidden=!f.scale;
  $("exBgRow").hidden=!f.bg;
  $("exQualityRow").hidden=!f.quality;
  $("exColsRow").hidden=!f.cols;
  $("exQualityV").textContent=exQuality()+" %";
  if(f.bg==="force"){ exBgOn.checked=true; exBgOn.disabled=true; } else exBgOn.disabled=false;
  exBgSw.disabled=!exBgOn.checked;
  exBgSw.style.background=exBgOn.checked?exBgHex:"transparent";
  const sum=$("exSummary"), warn=$("exWarn"); let msg="", err="";
  if(f.scale){
    const d=exportDims();
    msg=d.w+" × "+d.h+" px"+(exportBg()?"":" · transparent");
    if(exFormat==="sprites") msg+=" · "+d.g.n+" frame"+(d.g.n>1?"s":"")+" en "+d.g.cols+"×"+d.g.rows;
    if(exFormat!=="svg" && (d.w>EXPORT_MAX_SIDE||d.h>EXPORT_MAX_SIDE)) err=`Trop grand : les navigateurs ne dépassent pas ${EXPORT_MAX_SIDE} px de côté. Réduis l'échelle.`;
    if(f.frames && state.frames.length<2) err="Il faut au moins 2 frames pour exporter une animation ou une planche.";
    if((exFormat==="gif"||exFormat==="apng") && !err && (d.w>EXPORT_ANIM_MAX||d.h>EXPORT_ANIM_MAX)) err=`Trop grand pour une animation (${EXPORT_ANIM_MAX} px de côté maximum). Réduis l'échelle.`;
  } else if(exFormat==="palette"){
    msg=state.customColors.length+" couleur"+(state.customColors.length>1?"s":"");
    if(!state.customColors.length) err="Aucune couleur personnalisée à exporter.";
  } else msg=state.W+" × "+state.H+" caractères/valeurs";
  sum.textContent=msg; sum.classList.toggle("over",!!err);
  warn.hidden=!err; warn.textContent=err;
  $("exOk").disabled=!!err;
}
function openExportModal(){
  if(state.activeShape) bakeShape();
  if(state.textEditing) commitCanvasText();
  buildExportFormatPicker();
  applyExportSettings(readJSON(EXPORT_LAST_KEY,null) || {scale:+$("expScale").value||6});
  $("exName").value=`${safeName(state.projectName)}_${state.W}x${state.H}`;
  $("exPresetName").value="";
  buildExportScalePicker(); buildExportPresetSelect("");
  refreshExportModal();
  exportModal.classList.add("open");
}
function closeExportModal(){ exportModal.classList.remove("open"); }
function exportFileName(sc){
  const base=safeName($("exName").value)||safeName(state.projectName);
  const f=FORMATS[exFormat];
  const suffix= exFormat==="sprites" ? `_sprites_${state.frames.length}f_x${sc}`
    : (exFormat==="gif"||exFormat==="apng") ? `_anim_${state.frames.length}f_x${sc}`
    : (exFormat==="png"||exFormat==="jpg") ? `_x${sc}`
    : exFormat==="ascii" ? ".ascii" : exFormat==="grid" ? ".grid" : exFormat==="svg" ? `_x${sc}` : "";
  return base+suffix+"."+f.ext;
}
async function doExport(){
  if($("exOk").disabled) return;
  const f=FORMATS[exFormat], sc=exScale(), bg=exportBg(), file=exportFileName(sc);
  const st=currentExportSettings();
  closeExportModal();
  writeJSON(EXPORT_LAST_KEY,st);
  if(f.scale) $("expScale").value=Math.min(30,sc);     // les autres traitements (lot) suivent la même échelle
  if(state.activeShape) bakeShape();
  if(exFormat==="png"){
    download(flattenCanvas(state.layers,sc,bg).toDataURL("image/png"),file);
    showToast(`PNG exporté (${state.W*sc} × ${state.H*sc} px${bg?"":", fond transparent"}).`,{type:"success"});
  } else if(exFormat==="jpg"){
    download(flattenCanvas(state.layers,sc,bg).toDataURL("image/jpeg",st.quality/100),file);
    showToast(`JPG exporté (${state.W*sc} × ${state.H*sc} px, qualité ${st.quality} %).`,{type:"success"});
  } else if(exFormat==="svg"){
    download("data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svgString(state.layers,sc,bg)),file);
    showToast("SVG exporté.",{type:"success"});
  } else if(exFormat==="sprites"){
    const frames=state.frames, g=spriteGrid(), cw=state.W*sc, ch=state.H*sc;
    const sheet=document.createElement("canvas"); sheet.width=cw*g.cols; sheet.height=ch*g.rows;
    const sctx=sheet.getContext("2d"); sctx.imageSmoothingEnabled=false;
    if(bg){ sctx.fillStyle=bg; sctx.fillRect(0,0,sheet.width,sheet.height); }
    frames.forEach((fr,i)=>{
      const layers = i===state.activeFrame ? state.layers : fr.layers;
      sctx.drawImage(flattenCanvas(layers,sc,null), (i%g.cols)*cw, Math.floor(i/g.cols)*ch);
    });
    download(sheet.toDataURL("image/png"),file);
    showToast(`Planche de sprites exportée (${g.cols}×${g.rows}, ${frames.length} frames).`,{type:"success"});
  } else if(exFormat==="gif" || exFormat==="apng"){
    const busy=$("busy"); busy.hidden=false; busy.textContent="Encodage de l'animation…"; document.body.style.cursor="progress";
    try{
      await new Promise(r=>setTimeout(r,30));            // laisse l'indicateur s'afficher
      const list=state.frames.map((fr,i)=>({ layers:i===state.activeFrame?state.layers:fr.layers,
        delay:fr.delay||Math.round(1000/Math.max(1,state.fps)) }));
      let blob;
      if(exFormat==="gif"){
        const bgRgb=bg?[parseInt(bg.slice(1,3),16),parseInt(bg.slice(3,5),16),parseInt(bg.slice(5,7),16)]:null;
        const frames=list.map(fr=>({rgba:compositeLayers(fr.layers).data, delay:fr.delay}));
        const quantize=(cols,n)=>{ const rgb=new Float32Array(cols.length*3); cols.forEach((c,i)=>rgb.set(c,i*3));
          return medianCutPalette({rgb,ok:new Uint8Array(cols.length).fill(1)},n); };
        blob=new Blob([encodeGIF(frames,{w:state.W,h:state.H,scale:sc,bg:bgRgb,quantize})],{type:"image/gif"});
      } else {
        const frames=list.map(fr=>{ const cv=flattenCanvas(fr.layers,sc,bg);
          return {rgba:cv.getContext("2d").getImageData(0,0,cv.width,cv.height).data, delay:fr.delay}; });
        blob=await encodeAPNG(frames,state.W*sc,state.H*sc);
      }
      const url=URL.createObjectURL(blob); download(url,file); setTimeout(()=>URL.revokeObjectURL(url),8000);
      showToast(`${exFormat==="gif"?"GIF":"APNG"} exporté (${state.frames.length} frames, ${state.W*sc} × ${state.H*sc} px).`,{type:"success"});
    }catch(err){ showToast("Export impossible : "+err.message,{type:"error"}); }
    finally{ busy.hidden=true; busy.textContent="Export en cours…"; document.body.style.cursor=""; }
  } else if(exFormat==="ascii"){
    download("data:text/plain;charset=utf-8,"+encodeURIComponent(asciiArt()),file);
    showToast("ASCII art exporté.",{type:"success"});
  } else if(exFormat==="grid"){
    download("data:text/plain;charset=utf-8,"+encodeURIComponent(colorGrid()),file);
    showToast("Grille de couleurs exportée.",{type:"success"});
  } else if(exFormat==="palette"){
    const pal={format:"eu-pix-palette",version:1,colors:state.customColors};
    download("data:application/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(pal)),file);
    showToast("Palette exportée.",{type:"success"});
  }
}
// réglages enregistrés
$("exPresetSel").onchange=e=>{
  const p=getExportPresets().find(x=>x.name===e.target.value);
  $("exPresetDel").disabled=!p;
  if(!p) return;
  applyExportSettings(p.settings); $("exPresetName").value=p.name; refreshExportModal();
};
$("exPresetSave").onclick=()=>{
  const name=$("exPresetName").value.trim().slice(0,40);
  if(!name){ showToast("Donne un nom à ces réglages pour les enregistrer.",{type:"warn"}); $("exPresetName").focus(); return; }
  const list=getExportPresets().filter(x=>x.name!==name);
  list.push({name,settings:currentExportSettings()});
  if(!writeJSON(EXPORT_PRESETS_KEY,list)){ showToast("Enregistrement impossible (stockage du navigateur indisponible).",{type:"error"}); return; }
  buildExportPresetSelect(name);
  showToast(`Réglages « ${name} » enregistrés.`,{type:"success"});
};
$("exPresetDel").onclick=()=>{
  const name=$("exPresetSel").value; if(!name) return;
  writeJSON(EXPORT_PRESETS_KEY,getExportPresets().filter(x=>x.name!==name));
  $("exPresetName").value=""; buildExportPresetSelect("");
  showToast(`Réglages « ${name} » supprimés.`,{type:"info"});
};
$("miExport").onclick=openExportModal;
exScaleEl.oninput=refreshExportModal;
$("exCols").oninput=refreshExportModal;
$("exQuality").oninput=refreshExportModal;
exBgOn.onchange=refreshExportModal;
exBgSw.onclick=()=>openColorPicker(exBgSw, exBgHex, hex=>{ exBgHex=hex; refreshExportModal(); });
$("exCancel").onclick=closeExportModal;
$("exClose").onclick=closeExportModal;
exportModal.addEventListener("click",e=>{ if(e.target.id==="exportModal") closeExportModal(); });
$("exOk").onclick=doExport;
["exName","exScale","exCols","exPresetName"].forEach(id=>$(id).addEventListener("keydown",e=>{ e.stopPropagation();
  if(e.key==="Enter"){ e.preventDefault(); if(id==="exPresetName") $("exPresetSave").click(); else doExport(); }
  else if(e.key==="Escape"){ e.preventDefault(); closeExportModal(); } }));
window.addEventListener("keydown",e=>{
  if(e.key==="Escape" && exportModal.classList.contains("open")){ e.stopPropagation(); closeExportModal(); }
},true);

// ---------- Export texte : ASCII art (niveaux de gris) et grille de couleurs hexa ----------
const ASCII_RAMP=" .:-=+*#%@";
function asciiArt(){
  const img=compositeLayers(state.layers).data; let out="";
  for(let y=0;y<state.H;y++){ let row="";
    for(let x=0;x<state.W;x++){ const j=(y*state.W+x)*4, a=img[j+3];
      if(a<20){ row+=" "; continue; }
      const lum=(0.299*img[j]+0.587*img[j+1]+0.114*img[j+2])/255;
      row+=ASCII_RAMP[Math.min(ASCII_RAMP.length-1,Math.round((1-lum)*(ASCII_RAMP.length-1)))]; }
    out+=row+"\n"; }
  return out;
}
function colorGrid(){
  const img=compositeLayers(state.layers).data; let out="";
  for(let y=0;y<state.H;y++){ const cells=[];
    for(let x=0;x<state.W;x++){ const j=(y*state.W+x)*4, a=img[j+3];
      cells.push(a<20 ? "......" : [img[j],img[j+1],img[j+2]].map(v=>v.toString(16).padStart(2,"0")).join("")); }
    out+=cells.join(" ")+"\n"; }
  return out;
}

// ---------- Export groupé (ZIP store, sans dépendance) ----------
function zipStore(files){
  const enc=new TextEncoder();
  const u16=v=>[v&0xFF,(v>>8)&0xFF];
  const u32=v=>[v&0xFF,(v>>8)&0xFF,(v>>16)&0xFF,(v>>24)&0xFF];
  const parts=[], central=[]; let offset=0;
  for(const f of files){
    const nameB=enc.encode(f.name), crc=crc32(f.data), size=f.data.length;
    const local=new Uint8Array([].concat(u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(size),u32(size),u16(nameB.length),u16(0)));
    parts.push(local,nameB,f.data);
    central.push(new Uint8Array([].concat(u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(size),u32(size),u16(nameB.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset))),nameB);
    offset+=local.length+nameB.length+size;
  }
  let cenSize=0; central.forEach(a=>cenSize+=a.length);
  const end=new Uint8Array([].concat(u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(cenSize),u32(offset),u16(0)));
  return new Blob([...parts,...central,end],{type:"application/zip"});
}
// ---------- Export par lot (fichiers .eu-pix -> .zip) ----------
function normCards(proj){
  if(Array.isArray(proj.cards)) return proj.cards.map((c,i)=>({name:c.name||("carte-"+(i+1)),layers:c.layers||[]}));
  if(Array.isArray(proj.layers)) return [{name:proj.name||"carte-1",layers:proj.layers}];
  return [];
}
function projLayers(rawLayers,w,h){
  return rawLayers.filter(L=>!L.isGroup).map(L=>({ visible:L.visible!==false, opacity:typeof L.opacity==="number"?L.opacity:1,
    img: L.img?{}:null, data:(Array.isArray(L.data)&&L.data.length===w*h)?L.data:null, ox:L.ox||0, oy:L.oy||0 }));
}
let _batchFmt="svg";
document.getElementById("miBatchSVG").onclick=()=>{ _batchFmt="svg"; document.getElementById("batchFiles").click(); };
document.getElementById("miBatchPNG").onclick=()=>{ _batchFmt="png"; document.getElementById("batchFiles").click(); };
document.getElementById("miBatchJPG").onclick=()=>{ _batchFmt="jpg"; document.getElementById("batchFiles").click(); };
document.getElementById("batchFiles").onchange=async e=>{
  const inputFiles=[...e.target.files]; e.target.value="";
  if(!inputFiles.length) return;
  const fmt=_batchFmt, s=+document.getElementById("expScale").value||6;
  const busy=document.getElementById("busy"); busy.hidden=false; busy.textContent="Export du lot…"; document.body.style.cursor="progress";
  const savedW=state.W, savedH=state.H;
  try{
    const readText=f=>new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsText(f); });
    const out=[]; let n=0;
    for(const f of inputFiles){
      let proj; try{ proj=JSON.parse(await readText(f)); }catch(_){ continue; }
      if(!proj || (proj.format!=="pixel" && proj.format!=="eu-pix")) continue;
      const pw=Math.max(8,Math.min(512,proj.w|0)), ph=Math.max(8,Math.min(512,proj.h|0));
      for(const c of normCards(proj)){
        const ls=projLayers(c.layers,pw,ph);
        state.W=pw; state.H=ph;                        // dimensions du fichier, le temps du rendu
        n++; const base=`${String(n).padStart(3,"0")}_${safeName(c.name)}`;
        if(fmt==="svg"){ out.push({name:base+".svg", data:new TextEncoder().encode(svgString(ls,s))}); }
        else { const cv=flattenCanvas(ls,s,fmt==="jpg"?"#FFFFFF":null);
          const blob=await new Promise(r=>cv.toBlob(r, fmt==="jpg"?"image/jpeg":"image/png", 0.95));
          out.push({name:base+"."+(fmt==="jpg"?"jpg":"png"), data:new Uint8Array(await blob.arrayBuffer())}); }
      }
    }
    state.W=savedW; state.H=savedH;
    if(!out.length) showToast("Aucune carte exploitable dans les fichiers .eu-pix sélectionnés.",{type:"error"});
    else { const url=URL.createObjectURL(zipStore(out)); download(url,`lot_${out.length}images_${stamp2()}.zip`); setTimeout(()=>URL.revokeObjectURL(url),6000);
      showToast(`Lot exporté (${out.length} fichier${out.length>1?"s":""}).`,{type:"success"}); }
  }catch(err){ state.W=savedW; state.H=savedH; showToast("Export impossible : "+err.message,{type:"error"}); }
  finally{ busy.hidden=true; busy.textContent="Export en cours…"; document.body.style.cursor=""; render(); }
};

// ---------- Projet .eu-pix ----------
export function buildProjectObject(){
  if(state.activeShape) bakeShape();
  return { format:"pixel", version:8, name:state.projectName, w:state.W, h:state.H, guides:state.guides, rulerGuides:state.rulerGuides, customColors:state.customColors, active:state.active,
    layers:encodeLayers(state.layers), frames:framesSnapshotForSave() };
}
export async function saveProjectFile(){
  const proj=buildProjectObject();
  const blob=new Blob([JSON.stringify(proj)],{type:"application/json"});
  const saved=await saveBlob(blob,`${safeName(state.projectName)}_${state.W}x${state.H}_${stamp2()}.pixel`);
  pushRecent();
  if(saved) showToast(isIOS?"Projet prêt : choisis « Enregistrer dans Fichiers ».":"Projet enregistré.",{type:"success"});
}
document.getElementById("saveProj").onclick=saveProjectFile;
document.getElementById("openProj").onclick=()=>document.getElementById("fileInput").click();
document.getElementById("fileInput").onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{ try{ state.projectId=null; loadProject(JSON.parse(rd.result)); pushRecent(); showToast("Projet chargé.",{type:"success"}); }
    catch(err){ showToast("Fichier .eu-pix illisible : "+err.message,{type:"error"}); } };
  rd.onerror=()=>showToast("Lecture du fichier impossible.",{type:"error"});
  rd.readAsText(f);
  e.target.value="";
};

// ---------- Projets récents (localStorage) ----------
// Chaque entrée embarque le projet complet (comme l'autosauvegarde) pour pouvoir le
// rouvrir sans redemander le fichier d'origine. Mis à jour aux points de sauvegarde
// explicites (Enregistrer, Ouvrir, Fermer le projet) — jamais à chaque frappe.
const RECENTS_KEY="eupix.recents", RECENTS_MAX=8;
export function makeThumb(){
  const src=flattenCanvas(state.layers,1,null);
  const maxDim=120, sc=Math.min(1,maxDim/Math.max(state.W,state.H));
  const tw=Math.max(1,Math.round(state.W*sc)), th=Math.max(1,Math.round(state.H*sc));
  const cv=document.createElement("canvas"); cv.width=tw; cv.height=th;
  const cx=cv.getContext("2d"); cx.imageSmoothingEnabled=true;
  cx.drawImage(src,0,0,tw,th);
  return cv.toDataURL("image/png");
}
export function getRecents(){
  try{ const s=localStorage.getItem(RECENTS_KEY); const list=s?JSON.parse(s):[]; return Array.isArray(list)?list:[]; }
  catch(_){ return []; }
}
export function pushRecent(){
  try{
    if(!state.projectId) state.projectId = (crypto.randomUUID ? crypto.randomUUID() : "id"+Date.now()+Math.random().toString(16).slice(2));
    const entry={ id:state.projectId, name:`${state.projectName} · ${state.W}×${state.H}`, date:Date.now(), w:state.W, h:state.H,
      thumb:makeThumb(), proj:buildProjectObject() };
    let list=getRecents().filter(r=>r.id!==state.projectId);
    list.unshift(entry);
    if(list.length>RECENTS_MAX) list=list.slice(0,RECENTS_MAX);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  }catch(_){}
}
export function removeRecent(id){
  try{ localStorage.setItem(RECENTS_KEY, JSON.stringify(getRecents().filter(r=>r.id!==id))); }catch(_){}
}
// ---------- Palette : import (JSON) — l'export se fait dans Fichier › Exporter… ----------
document.getElementById("impPaletteBtn").onclick=()=>document.getElementById("impPaletteFile").click();
document.getElementById("impPaletteFile").onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const p=JSON.parse(rd.result);
      const cols=Array.isArray(p) ? p : Array.isArray(p.colors) ? p.colors : null;
      if(!cols) throw new Error("format inattendu");
      const known=new Set(PALETTE.concat(state.customColors).map(x=>x.toUpperCase()));
      let added=0;
      for(const c of cols){ if(typeof c!=="string") continue; const hex=c.toUpperCase();
        if(/^#[0-9A-F]{6}$/.test(hex) && !known.has(hex)){ state.customColors.push(hex); known.add(hex); added++; } }
      buildSwatches();
      showToast(added ? `Palette importée (${added} couleur${added>1?"s":""}).` : "Aucune nouvelle couleur.",{type:added?"success":"info"});
    }catch(err){ showToast("Palette illisible : "+err.message,{type:"error"}); }
  };
  rd.readAsText(f); e.target.value="";
};

// échelle d'export conseillée du format courant (le format et les dimensions sont choisis dans les modales)
export function syncPresetToSize(){
  const key=Object.keys(PRESETS).find(k=>PRESETS[k].w===state.W && PRESETS[k].h===state.H && (!!PRESETS[k].g)===(!!state.guides));
  if(key) document.getElementById("expScale").value=PRESETS[key].scale;
}
export function loadProject(p){
  if(!p || (p.format!=="pixel" && p.format!=="eu-pix")) throw new Error("format inattendu");
  state.sel=null; state.floatSel=null; state.clipboard=null; state.cropRect=null;
  state.activeShape=null; state.txOp=null; state.previewCells=null;
  state.W=Math.max(8,Math.min(512,p.w|0)); state.H=Math.max(8,Math.min(512,p.h|0));
  state.guides=p.guides||null; state.layerSeq=1;
  state.rulerGuides=Array.isArray(p.rulerGuides)?p.rulerGuides.filter(g=>g&&(g.axis==="x"||g.axis==="y")&&isFinite(g.pos)).map(g=>({axis:g.axis,pos:g.pos|0})):[];
  setProjectName(p.name);            // fichiers v5 et antérieurs : pas de nom, on retombe sur « Sans titre »
  if(Array.isArray(p.customColors)){ state.customColors=p.customColors.slice(); buildSwatches(); }
  let raw, act=0;
  if(Array.isArray(p.cards)){ raw=(p.cards[0]&&p.cards[0].layers)||[]; }   // fichier multi-cartes : on ouvre la 1re carte
  else if(Array.isArray(p.layers)){ raw=p.layers; act=p.active|0; }
  else throw new Error("aucun calque");
  state.layers=decodeLayers(raw);
  state.active=Math.min(Math.max(0,act),state.layers.length-1);
  while(state.active<state.layers.length-1 && state.layers[state.active].isGroup) state.active++;
  while(state.active>0 && state.layers[state.active].isGroup) state.active--;
  loadFramesFromSave(p.frames);
  syncPresetToSize();
  history.length=0; state.histPtr=-1; snapshot();
  buildLayers(); fitZoom();
  if(Array.isArray(p.cards) && p.cards.length>1) setHint("Fichier multi-cartes : 1re carte ouverte (l'export par lot les traite toutes).");
}

// ---------- Sauvegarde automatique (localStorage) ----------
const AUTOSAVE_KEY="eupix.autosave";
let autosaveTimer=null;
export function scheduleAutosave(){
  clearTimeout(autosaveTimer);
  autosaveTimer=setTimeout(()=>{
    try{ localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(buildProjectObject())); }catch(_){}
  }, 800);
}
export function restoreAutosaveIfAny(){
  let raw; try{ raw=localStorage.getItem(AUTOSAVE_KEY); }catch(_){ return; }
  if(!raw) return;
  let proj; try{ proj=JSON.parse(raw); }catch(_){ return; }
  if(!proj || !Array.isArray(proj.layers) || !proj.layers.length) return;
  showToast("Un dessin précédent a été trouvé sur cet appareil.",{ type:"info", duration:12000,
    actionLabel:"Restaurer", onAction:()=>{
      try{ loadProject(proj); showToast("Dessin restauré.",{type:"success"}); }
      catch(err){ showToast("Restauration impossible : "+err.message,{type:"error"}); }
    } });
}
