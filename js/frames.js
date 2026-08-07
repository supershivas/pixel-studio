import { state } from "./state.js";
import { cloneLayers, encodeLayers, decodeLayers, render, compositeLayers } from "./helpers.js";
import { snapshot, history, onSnapshot } from "./history.js";
import { buildLayers } from "./ui.js";

// ---------- Frames d'animation ----------
const framesEl=document.getElementById("frames");
const playBtn=document.getElementById("playBtn");
const fpsInput=document.getElementById("fps");
const onionChk=document.getElementById("onionSkin");
const frameCountEl=document.getElementById("frameCount");

function syncCurrentFrame(){
  const f=state.frames[state.activeFrame]; if(!f) return;
  f.layers=cloneLayers(state.layers); f.active=state.active;
}
function loadFrame(i){
  const f=state.frames[i];
  state.layers=cloneLayers(f.layers);
  state.active=Math.min(f.active||0,state.layers.length-1);
  state.sel=null; state.floatSel=null; state.activeShape=null; state.previewCells=null;
  history.length=0; state.histPtr=-1; snapshot();
  buildLayers(); buildFrames(); render();
}

let _snapshotHooked=false;
export function initFrames(){
  state.frames=[{id:state.frameSeq++, name:"1", layers:cloneLayers(state.layers), active:state.active}];
  state.activeFrame=0;
  buildFrames();
  // enregistré ici (plutôt qu'au chargement du module) pour éviter un accès à history.js
  // avant son initialisation, à cause du cycle d'imports frames.js ↔ ui.js ↔ history.js
  if(!_snapshotHooked){ _snapshotHooked=true; onSnapshot(()=>{ if(state.frames && state.frames.length) buildFrames(); }); }
}

export function switchFrame(i){
  if(i<0||i>=state.frames.length||i===state.activeFrame) return;
  syncCurrentFrame();
  state.activeFrame=i;
  loadFrame(i);
}

export function duplicateFrame(i){
  if(i<0||i>=state.frames.length) return;
  stopPlayback();
  syncCurrentFrame();
  const src=state.frames[i];
  const f={id:state.frameSeq++, name:String(state.frames.length+1), layers:cloneLayers(src.layers), active:src.active};
  state.frames.splice(i+1,0,f);
  state.activeFrame=i+1;
  loadFrame(state.activeFrame);
}
export function addFrame(){ duplicateFrame(state.activeFrame); }

export function deleteFrame(i){
  if(i<0||i>=state.frames.length||state.frames.length<=1) return;
  stopPlayback();
  const wasActive=i===state.activeFrame;
  state.frames.splice(i,1);
  if(wasActive){ state.activeFrame=Math.min(i,state.frames.length-1); loadFrame(state.activeFrame); }
  else { if(i<state.activeFrame) state.activeFrame--; buildFrames(); }
}

// ---------- Transformer toutes les frames (taille / rotation du canevas) ----------
export function transformAllFrames(applyFn){
  syncCurrentFrame();
  state.frames.forEach(f=>applyFn(f.layers));   // applyFn mute les calques en place
  state.layers=cloneLayers(state.frames[state.activeFrame].layers);
}

// ---------- Lecture ----------
let playTimer=null;
function stopPlayback(){ if(playTimer){ clearInterval(playTimer); playTimer=null; } state.playing=false; if(playBtn) playBtn.textContent="▶"; }
function startPlayback(){
  if(state.frames.length<2) return;
  state.playing=true; if(playBtn) playBtn.textContent="⏸";
  playTimer=setInterval(()=>{
    const ni=(state.activeFrame+1)%state.frames.length;
    switchFrame(ni);
  }, Math.max(30,1000/Math.max(1,state.fps)));
}
function togglePlay(){ state.playing ? stopPlayback() : startPlayback(); }

// ---------- Interface : bandeau de frames ----------
let dragFrameId=null;
function clearFrameDropMarks(){ framesEl?.querySelectorAll(".frame").forEach(el=>el.classList.remove("drop-before","drop-after")); }
function frameZone(e,el){ const r=el.getBoundingClientRect(); return (e.clientX-r.left)/r.width<0.5 ? "before" : "after"; }
// toId=null => déposer en toute fin du bandeau
function moveFrame(fromId,toId,zone){
  const from=state.frames.findIndex(x=>x.id===fromId); if(from<0) return;
  const activeObj=state.frames[state.activeFrame];
  const [mv]=state.frames.splice(from,1);
  let to = toId==null ? state.frames.length : state.frames.findIndex(x=>x.id===toId);
  if(toId!=null && zone==="after") to++;
  state.frames.splice(to,0,mv);
  state.activeFrame=state.frames.indexOf(activeObj);
  buildFrames();
}
function frameThumb(f,i){
  const el=document.createElement("div");
  el.className="frame"+(i===state.activeFrame?" active":"");
  el.draggable=true; el.dataset.id=f.id; el.title="Frame "+(i+1);
  const cv=document.createElement("canvas"); cv.width=state.W; cv.height=state.H; cv.className="fthumb";
  const ctx=cv.getContext("2d");
  const src=(i===state.activeFrame)?state.layers:f.layers;
  ctx.putImageData(compositeLayers(src),0,0);
  const num=document.createElement("span"); num.className="fnum"; num.textContent=i+1;
  const dup=document.createElement("button"); dup.className="fdup"; dup.textContent="⧉"; dup.title="Dupliquer la frame";
  dup.addEventListener("click",e=>{ e.stopPropagation(); duplicateFrame(i); });
  const del=document.createElement("button"); del.className="fdel"; del.textContent="×"; del.title="Supprimer la frame";
  del.addEventListener("click",e=>{ e.stopPropagation(); deleteFrame(i); });
  el.append(cv,num,dup,del);
  el.addEventListener("click",()=>switchFrame(i));
  el.addEventListener("dragstart",e=>{ dragFrameId=f.id; e.dataTransfer.effectAllowed="move"; el.classList.add("dragging"); });
  el.addEventListener("dragend",()=>{ dragFrameId=null; el.classList.remove("dragging"); clearFrameDropMarks(); });
  el.addEventListener("dragover",e=>{ if(dragFrameId==null||dragFrameId===f.id) return; e.preventDefault();
    const zone=frameZone(e,el); clearFrameDropMarks(); el.classList.add(zone==="before"?"drop-before":"drop-after"); });
  el.addEventListener("dragleave",()=>el.classList.remove("drop-before","drop-after"));
  el.addEventListener("drop",e=>{ e.preventDefault(); clearFrameDropMarks();
    if(dragFrameId==null||dragFrameId===f.id) return;
    moveFrame(dragFrameId,f.id,frameZone(e,el)); dragFrameId=null; });
  return el;
}
export function buildFrames(){
  if(!framesEl) return;
  framesEl.innerHTML="";
  state.frames.forEach((f,i)=>framesEl.appendChild(frameThumb(f,i)));
  if(frameCountEl) frameCountEl.textContent=state.frames.length+" frame"+(state.frames.length>1?"s":"");
}
// dépose dans l'espace vide après la dernière frame => déplacer en toute fin
if(framesEl){
  framesEl.addEventListener("dragover",e=>{ if(dragFrameId==null) return; e.preventDefault(); });
  framesEl.addEventListener("drop",e=>{ if(dragFrameId==null||e.target!==framesEl) return; e.preventDefault();
    clearFrameDropMarks(); moveFrame(dragFrameId,null,null); dragFrameId=null; });
}

if(playBtn) playBtn.addEventListener("click",togglePlay);
if(fpsInput) fpsInput.addEventListener("change",()=>{ state.fps=Math.max(1,Math.min(30,+fpsInput.value||6));
  if(state.playing){ stopPlayback(); startPlayback(); } });
if(onionChk) onionChk.addEventListener("change",()=>{ state.onionSkin=onionChk.checked; render(); });
document.getElementById("addFrameBtn")?.addEventListener("click",addFrame);

// ---------- Sauvegarde / chargement projet ----------
export function framesSnapshotForSave(){
  syncCurrentFrame();
  return { active:state.activeFrame, list: state.frames.map(f=>({ name:f.name, active:f.active, layers:encodeLayers(f.layers) })) };
}
export function loadFramesFromSave(saved){
  if(saved && Array.isArray(saved.list) && saved.list.length){
    state.frames=saved.list.map(f=>({ id:state.frameSeq++, name:f.name||"", active:f.active|0, layers:decodeLayers(f.layers) }));
    state.activeFrame=Math.max(0,Math.min(saved.active|0,state.frames.length-1));
    const f=state.frames[state.activeFrame];
    state.layers=cloneLayers(f.layers); state.active=Math.min(f.active||0,state.layers.length-1);
    buildFrames();
  } else initFrames();
}
