import { state } from "./state.js";
import { newLayer, newImageLayer, render } from "./helpers.js";
import { snapshot, history } from "./history.js";
import { fitZoom } from "./interaction.js";
import { buildLayers, resetToBlankProject } from "./ui.js";
import { loadProject, syncPresetToSize, getRecents, removeRecent, pushRecent, saveProjectFile } from "./io.js";
import { initFrames } from "./frames.js";
import { showToast } from "./toast.js";

// ---------- Page d'accueil : fermer le projet, rouvrir un récent, démarrer depuis une photo ----------
const homeModal=document.getElementById("homeModal");
const homeRecentsEl=document.getElementById("homeRecents");
const homeEmptyNote=document.getElementById("homeEmptyNote");

function fmtDate(ts){
  const d=new Date(ts);
  return d.toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"})+" "+d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
}

function openRecent(id){
  const r=getRecents().find(x=>x.id===id); if(!r) return;
  try{ loadProject(r.proj); state.projectId=id; closeHome(); showToast("Projet rouvert.",{type:"success"}); }
  catch(err){ showToast("Projet illisible : "+err.message,{type:"error"}); }
}

function buildHomeRecents(){
  const list=getRecents();
  homeRecentsEl.innerHTML="";
  homeEmptyNote.hidden=list.length>0;
  list.forEach(r=>{
    const card=document.createElement("div"); card.className="home-card"; card.title="Ouvrir « "+r.name+" »";
    const thumbWrap=document.createElement("div"); thumbWrap.className="home-thumb-wrap";
    const img=document.createElement("img"); img.className="home-thumb"; img.src=r.thumb; img.alt="";
    thumbWrap.appendChild(img);
    const info=document.createElement("div"); info.className="home-card-info";
    const nm=document.createElement("span"); nm.className="home-card-name"; nm.textContent=r.name;
    const dt=document.createElement("span"); dt.className="home-card-date"; dt.textContent=fmtDate(r.date);
    info.append(nm,dt);
    const del=document.createElement("button"); del.className="home-card-del"; del.textContent="×"; del.title="Retirer de la liste";
    del.addEventListener("click",e=>{ e.stopPropagation(); removeRecent(r.id); buildHomeRecents(); });
    card.append(thumbWrap,info,del);
    card.addEventListener("click",()=>openRecent(r.id));
    homeRecentsEl.appendChild(card);
  });
}

export function openHome(){
  pushRecent();           // capture non destructive du travail en cours avant de quitter l'écran d'édition
  buildHomeRecents();
  homeModal.classList.add("open");
}
function closeHome(){ homeModal.classList.remove("open"); }

document.getElementById("homeClose").onclick=closeHome;
homeModal.addEventListener("click",e=>{ if(e.target===homeModal) closeHome(); });

document.getElementById("homeNew").onclick=()=>{ resetToBlankProject(); closeHome(); };
document.getElementById("homeOpen").onclick=()=>document.getElementById("fileInput").click();

// ---------- Modale « enregistrer avant de quitter le projet » ----------
// Utilisée par Fermer le projet (⌘/Ctrl+W) et Nouvelle image (⌘/Ctrl+N).
const saveAskModal=document.getElementById("saveAskModal");
let _saveAskThen=null;
function askSave({title,msg,onProceed}){
  _saveAskThen=onProceed;
  document.getElementById("saveAskTitle").textContent=title;
  document.getElementById("saveAskMsg").textContent=msg;
  saveAskModal.classList.add("open");
}
export function closeSaveAsk(){ saveAskModal.classList.remove("open"); _saveAskThen=null; }
function saveAskRun(save){
  const then=_saveAskThen; closeSaveAsk();
  if(!then) return;
  if(save) saveProjectFile();
  then();
}
document.getElementById("saveAskCancel").onclick=closeSaveAsk;
document.getElementById("saveAskClose").onclick=closeSaveAsk;
saveAskModal.addEventListener("click",e=>{ if(e.target===saveAskModal) closeSaveAsk(); });
document.getElementById("saveAskSkip").onclick=()=>saveAskRun(false);
document.getElementById("saveAskSave").onclick=()=>saveAskRun(true);

export function requestCloseProject(){
  if(homeModal.classList.contains("open")) return;
  askSave({ title:"Fermer le projet", msg:"Enregistrer le projet avant de le fermer ?", onProceed:openHome });
}
export function requestNewProject(){
  askSave({ title:"Nouvelle image", msg:"Enregistrer le projet avant de repartir d'une image vierge ?",
    onProceed:()=>{ resetToBlankProject(); closeHome(); showToast("Nouvelle image.",{type:"success"}); } });
}
document.getElementById("miClose").onclick=requestCloseProject;
document.getElementById("miNew").onclick=requestNewProject;

// ---------- Raccourcis projet ----------
// ⌘/Ctrl+W et ⌘/Ctrl+N sont réservés par certains navigateurs (fermer l'onglet / nouvelle fenêtre) :
// on les intercepte quand c'est possible — c'est toujours le cas en application installée (PWA).
window.addEventListener("keydown",e=>{
  if(!(e.ctrlKey||e.metaKey) || e.altKey || e.shiftKey) return;
  const k=e.key.toLowerCase();
  if(k==="w"){ e.preventDefault(); requestCloseProject(); }
  else if(k==="n"){ e.preventDefault(); requestNewProject(); }
});
window.addEventListener("keydown",e=>{
  if(e.key==="Escape" && saveAskModal.classList.contains("open")){ e.stopPropagation(); closeSaveAsk(); }
},true);

// ---------- Nouveau projet à partir d'une image (Fond + calque image importé) ----------
function newProjectFromImage(file){
  const rd=new FileReader();
  rd.onload=()=>{
    const dataURL=rd.result;
    const probe=new Image();
    probe.onload=()=>{
      const nw=probe.naturalWidth||64, nh=probe.naturalHeight||64;
      // même facteur d'échelle sur les deux axes pour ne pas déformer l'image (un simple
      // clamp indépendant par axe écraserait l'aspect ratio des photos, presque toujours
      // plus larges que 512px)
      const scale=Math.min(1, 512/nw, 512/nh);
      const w=Math.max(8,Math.min(512,Math.round(nw*scale)));
      const h=Math.max(8,Math.min(512,Math.round(nh*scale)));
      state.projectId=null;
      state.activeShape=null; state.txOp=null; state.previewCells=null; state.sel=null; state.floatSel=null; state.cropRect=null;
      state.guides=null; state.W=w; state.H=h; state.layerSeq=1;
      const bg=newLayer("Fond");
      const imgLayer=newImageLayer(dataURL, (file.name||"Image").replace(/\.[^.]+$/,"").slice(0,20)||"Image");
      state.layers=[bg,imgLayer]; state.active=1;
      initFrames();
      syncPresetToSize();
      history.length=0; state.histPtr=-1; snapshot();
      buildLayers(); fitZoom(); render();
      closeHome();
      showToast("Nouveau projet créé à partir de l'image ("+w+"×"+h+").",{type:"success"});
    };
    probe.onerror=()=>showToast("Image illisible.",{type:"error"});
    probe.src=dataURL;
  };
  rd.onerror=()=>showToast("Lecture du fichier impossible.",{type:"error"});
  rd.readAsDataURL(file);
}
document.getElementById("miNewFromImage").onclick=()=>document.getElementById("newFromImageFile").click();
document.getElementById("newFromImageFile").onchange=e=>{ const f=e.target.files[0]; if(f) newProjectFromImage(f); e.target.value=""; };
document.getElementById("homeNewFromImage").onclick=()=>document.getElementById("homeNewFromImageFile").click();
document.getElementById("homeNewFromImageFile").onchange=e=>{ const f=e.target.files[0]; if(f) newProjectFromImage(f); e.target.value=""; };
