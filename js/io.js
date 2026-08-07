import { state } from "./state.js";
import { compositeLayers, newLayer, newImageLayer, render } from "./helpers.js";
import { snapshot, history } from "./history.js";
import { bakeShape } from "./drawing.js";
import { setHint, fitZoom } from "./interaction.js";
import { buildLayers, buildSwatches, presetSel, PRESETS } from "./ui.js";

// ---------- Export ----------
function flattenCanvas(ls,scale,opaque){
  const c=document.createElement("canvas"); c.width=state.W*scale; c.height=state.H*scale;
  const cx=c.getContext("2d"); cx.imageSmoothingEnabled=false;
  if(opaque){ cx.fillStyle="#FFFFFF"; cx.fillRect(0,0,c.width,c.height); }
  const tmp=document.createElement("canvas"); tmp.width=state.W; tmp.height=state.H;
  tmp.getContext("2d").putImageData(compositeLayers(ls),0,0);
  cx.drawImage(tmp,0,0,c.width,c.height);
  return c;
}
function svgString(ls,scale){
  const img=compositeLayers(ls).data;
  let rects="";
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
function download(url,name){ const a=document.createElement("a"); a.href=url; a.download=name; a.click(); }
function stamp2(){ return new Date().toISOString().slice(0,10); }
function safeName(s){ return (s||"").trim().replace(/[^\w\-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40)||"carte"; }

document.getElementById("expPNG").onclick=()=>{ if(state.activeShape) bakeShape(); const s=+document.getElementById("expScale").value||6;
  download(flattenCanvas(state.layers,s,false).toDataURL("image/png"),`pixel_${state.W}x${state.H}_x${s}.png`); };
document.getElementById("expJPG").onclick=()=>{ if(state.activeShape) bakeShape(); const s=+document.getElementById("expScale").value||6;
  download(flattenCanvas(state.layers,s,true).toDataURL("image/jpeg",0.95),`pixel_${state.W}x${state.H}_x${s}.jpg`); };
document.getElementById("expSVG").onclick=()=>{ if(state.activeShape) bakeShape(); const s=+document.getElementById("expScale").value||6;
  download("data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svgString(state.layers,s)),`pixel_${state.W}x${state.H}.svg`); };

// ---------- Export groupé (ZIP store, sans dépendance) ----------
const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return t;})();
function crc32(u8){ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c=CRC_TABLE[(c^u8[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
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
  return rawLayers.map(L=>({ visible:L.visible!==false, opacity:typeof L.opacity==="number"?L.opacity:1,
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
        else { const cv=flattenCanvas(ls,s,fmt==="jpg");
          const blob=await new Promise(r=>cv.toBlob(r, fmt==="jpg"?"image/jpeg":"image/png", 0.95));
          out.push({name:base+"."+(fmt==="jpg"?"jpg":"png"), data:new Uint8Array(await blob.arrayBuffer())}); }
      }
    }
    state.W=savedW; state.H=savedH;
    if(!out.length) alert("Aucune carte exploitable dans les fichiers .eu-pix sélectionnés.");
    else { const url=URL.createObjectURL(zipStore(out)); download(url,`lot_${out.length}images_${stamp2()}.zip`); setTimeout(()=>URL.revokeObjectURL(url),6000); }
  }catch(err){ state.W=savedW; state.H=savedH; alert("Export impossible : "+err.message); }
  finally{ busy.hidden=true; busy.textContent="Export en cours…"; document.body.style.cursor=""; render(); }
};

// ---------- Projet .eu-pix ----------
document.getElementById("saveProj").onclick=()=>{
  if(state.activeShape) bakeShape();
  const proj={ format:"pixel", version:3, w:state.W, h:state.H, guides:state.guides, customColors:state.customColors,
    layers:state.layers.map(L=>({ name:L.name, visible:L.visible, opacity:L.opacity,
      data:L.img?null:L.data, img:L.img?{dataURL:L.img.dataURL}:null, ox:L.ox||0, oy:L.oy||0, text:L.text||null, fx:L.fx||null, blend:L.blend||"normal" })) };
  const blob=new Blob([JSON.stringify(proj)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  download(url,`pixel_${state.W}x${state.H}_${stamp2()}.pixel`);
  setTimeout(()=>URL.revokeObjectURL(url),3000);
};
document.getElementById("openProj").onclick=()=>document.getElementById("fileInput").click();
document.getElementById("fileInput").onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{ try{ loadProject(JSON.parse(rd.result)); }
    catch(err){ alert("Fichier .eu-pix illisible : "+err.message); } };
  rd.onerror=()=>alert("Lecture du fichier impossible.");
  rd.readAsText(f);
  e.target.value="";
};
export function syncPresetToSize(){
  const key=Object.keys(PRESETS).find(k=>PRESETS[k].w===state.W && PRESETS[k].h===state.H && (!!PRESETS[k].g)===(!!state.guides));
  if(key){ presetSel.value=key; document.getElementById("customWH").hidden=true; document.getElementById("expScale").value=PRESETS[key].scale; }
  else { presetSel.value="custom"; document.getElementById("customWH").hidden=false;
    document.getElementById("cw").value=state.W; document.getElementById("ch").value=state.H; }
}
export function loadProject(p){
  if(!p || (p.format!=="pixel" && p.format!=="eu-pix")) throw new Error("format inattendu");
  state.sel=null; state.floatSel=null; state.clipboard=null;
  state.activeShape=null; state.txOp=null; state.previewCells=null;
  state.W=Math.max(8,Math.min(512,p.w|0)); state.H=Math.max(8,Math.min(512,p.h|0));
  state.guides=p.guides||null; state.layerSeq=1;
  if(Array.isArray(p.customColors)){ state.customColors=p.customColors.slice(); buildSwatches(); }
  let raw, act=0;
  if(Array.isArray(p.cards)){ raw=(p.cards[0]&&p.cards[0].layers)||[]; }   // fichier multi-cartes : on ouvre la 1re carte
  else if(Array.isArray(p.layers)){ raw=p.layers; act=p.active|0; }
  else throw new Error("aucun calque");
  state.layers=raw.map(L=>{
    if(L.img && L.img.dataURL){ const IL=newImageLayer(L.img.dataURL, L.name||"Image");
      IL.visible=L.visible!==false; if(typeof L.opacity==="number") IL.opacity=L.opacity; IL.ox=L.ox||0; IL.oy=L.oy||0; IL.blend=L.blend||"normal"; return IL; }
    return { id:state.layerSeq++, name:L.name||"Calque", visible:L.visible!==false,
      opacity:typeof L.opacity==="number"?L.opacity:1,
      data:(Array.isArray(L.data)&&L.data.length===state.W*state.H)?L.data.slice():new Array(state.W*state.H).fill(null), img:null,_imgEl:null, ox:L.ox||0, oy:L.oy||0, text:L.text||null, fx:L.fx||null, blend:L.blend||"normal" };
  });
  if(!state.layers.length) state.layers=[newLayer("Calque 1")];
  state.active=Math.min(Math.max(0,act),state.layers.length-1);
  syncPresetToSize();
  history.length=0; state.histPtr=-1; snapshot();
  buildLayers(); fitZoom();
  if(Array.isArray(p.cards) && p.cards.length>1) setHint("Fichier multi-cartes : 1re carte ouverte (l'export par lot les traite toutes).");
}
