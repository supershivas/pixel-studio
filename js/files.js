import { state } from "./state.js";
import { importImageFile } from "./ui.js";
import { loadProject, pushRecent } from "./io.js";
import { pasteClipboard } from "./helpers.js";
import { showToast } from "./toast.js";

// ---------- Glisser-déposer et coller depuis le presse-papiers du système ----------
const hint=document.getElementById("dropHint");
const hasFiles=e=>e.dataTransfer && [...(e.dataTransfer.types||[])].includes("Files");
let depth=0;
window.addEventListener("dragenter",e=>{ if(!hasFiles(e)) return; depth++; hint.hidden=false; });
window.addEventListener("dragover",e=>{ if(hasFiles(e)) e.preventDefault(); });
window.addEventListener("dragleave",e=>{ if(!hasFiles(e)) return; depth=Math.max(0,depth-1); if(!depth) hint.hidden=true; });
window.addEventListener("drop",e=>{
  if(!hasFiles(e)) return;
  e.preventDefault(); depth=0; hint.hidden=true;
  const files=[...e.dataTransfer.files];
  const imgs=files.filter(f=>f.type.startsWith("image/"));
  if(imgs.length){ imgs.forEach(f=>importImageFile(f)); showToast(imgs.length>1?imgs.length+" images importées en calques.":"Image importée en calque.",{type:"success"}); return; }
  const proj=files.find(f=>/\.(pixel|eu-pix|json)$/i.test(f.name));
  if(proj){
    const rd=new FileReader();
    rd.onload=()=>{ try{ state.projectId=null; loadProject(JSON.parse(rd.result)); pushRecent(); showToast("Projet chargé.",{type:"success"}); }
      catch(err){ showToast("Fichier illisible : "+err.message,{type:"error"}); } };
    rd.readAsText(proj); return;
  }
  showToast("Type de fichier non pris en charge.",{type:"warn"});
});

// Ctrl/⌘+V : une image du presse-papiers du système devient un calque ; sinon, collage interne (nouveau calque)
window.addEventListener("paste",e=>{
  const t=e.target; if(t && (t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable)) return;
  const img=[...(e.clipboardData?e.clipboardData.files:[])].find(f=>f.type.startsWith("image/"));
  if(img){ e.preventDefault(); importImageFile(img,"Image collée"); showToast("Image collée en calque.",{type:"success"}); return; }
  if(state.clipboard){ e.preventDefault(); pasteClipboard(); }
});
