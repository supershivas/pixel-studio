import { state } from "./state.js";
import { buildProjectObject, loadProject, pushRecent, makeThumb } from "./io.js";
import { onSnapshot } from "./history.js";
import { showToast } from "./toast.js";

// ---------- Sauvegarde cloud : les derniers dessins dans un dépôt GitHub privé ----------
// Contents API de GitHub appelée directement depuis le navigateur (CORS autorisé) avec un jeton d'accès fin saisi par
// l'utilisateur et conservé dans localStorage. Un fichier par dessin : <dossier>/<AAAAMMJJ-HHMMSS>__<nom>__<id>.pixel.gz
// (+ une vignette .png) ; on garde les N dessins les plus récents, un dessin ne laisse qu'une version (l'historique Git
// conserve les précédentes).
const $=id=>document.getElementById(id);
const KEY="eupix.cloud";
const DEF={repo:"",token:"",branch:"main",dir:"saves",keep:5,auto:true};
let cfg={...DEF}; try{ Object.assign(cfg,JSON.parse(localStorage.getItem(KEY))||{}); }catch(_){}
const save=()=>{ try{ localStorage.setItem(KEY,JSON.stringify(cfg)); }catch(_){ showToast("Réglages cloud non mémorisés (stockage indisponible).",{type:"warn"}); } };
const configured=()=>/^[\w.-]+\/[\w.-]+$/.test(cfg.repo||"") && !!cfg.token;
const safeName=s=>(s||"").trim().replace(/[^\w\-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40)||"dessin";

// ---------- API ----------
async function api(path,opts={}){
  const r=await fetch("https://api.github.com"+path,{...opts,headers:{ Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",Authorization:"Bearer "+cfg.token,...(opts.headers||{}) }});
  return r;
}
const contentsUrl=p=>`/repos/${cfg.repo}/contents/${p.split("/").map(encodeURIComponent).join("/")}`;
async function explain(r){
  if(r.status===401) return "jeton refusé ou expiré";
  if(r.status===403) return "accès refusé (permission « Contents » en écriture ? limite de débit ?)";
  if(r.status===404) return "dépôt, branche ou dossier introuvable";
  if(r.status===409||r.status===422) return "conflit — réessaie dans un instant";
  try{ const j=await r.json(); return j.message||("erreur "+r.status); }catch(_){ return "erreur "+r.status; }
}
const b64=u8=>{ let s=""; for(let i=0;i<u8.length;i+=0x8000) s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000)); return btoa(s); };
async function pack(str){
  if(typeof CompressionStream==="undefined") return {data:new TextEncoder().encode(str),ext:"pixel"};
  const buf=await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  return {data:new Uint8Array(buf),ext:"pixel.gz"};
}
async function unpack(buf,gz){
  if(!gz) return new TextDecoder().decode(buf);
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}
const stampNow=()=>new Date().toISOString().replace(/[-:]/g,"").replace("T","-").slice(0,15);
const NAME_RE=/^(\d{8}-\d{6})__(.+)__([0-9a-f]{8})\.(pixel\.gz|pixel|png)$/;
async function listFiles(){
  const r=await api(contentsUrl(cfg.dir)+"?ref="+encodeURIComponent(cfg.branch));
  if(r.status===404) return [];
  if(!r.ok) throw new Error(await explain(r));
  const arr=await r.json();
  return (Array.isArray(arr)?arr:[]).map(f=>{ const m=NAME_RE.exec(f.name); return m?{...f,stamp:m[1],label:m[2],id:m[3],ext:m[4]}:null; }).filter(Boolean);
}
async function putFile(path,contentB64,message,sha){
  const r=await api(contentsUrl(path),{method:"PUT",body:JSON.stringify({message,content:contentB64,branch:cfg.branch,...(sha?{sha}:{})})});
  if(!r.ok) throw new Error(await explain(r));
}
async function delFile(f){
  const r=await api(contentsUrl(f.path),{method:"DELETE",body:JSON.stringify({message:"Suppression de l'ancienne sauvegarde "+f.name,sha:f.sha,branch:cfg.branch})});
  if(!r.ok && r.status!==404) throw new Error(await explain(r));
}

// ---------- Sauvegarde ----------
let busy=false, dirty=false, lastOk=0;
export async function backupNow({silent=false}={}){
  if(!configured()){ if(!silent){ openModal(); showToast("Configure d'abord le dépôt et le jeton.",{type:"warn"}); } return false; }
  if(busy) return false; busy=true; setStatus("Sauvegarde en cours…");
  try{
    if(!state.projectId) state.projectId=(crypto.randomUUID?crypto.randomUUID():"id"+Date.now()+Math.random().toString(16).slice(2));
    const id=state.projectId.replace(/[^0-9a-f]/gi,"").slice(0,8).padEnd(8,"0").toLowerCase();
    const json=JSON.stringify(buildProjectObject()), {data,ext}=await pack(json);
    const base=`${cfg.dir}/${stampNow()}__${safeName(state.projectName)}__${id}`;
    const msg=`Sauvegarde « ${state.projectName} » (${state.W}×${state.H})`;
    await putFile(`${base}.${ext}`,b64(data),msg);
    try{ await putFile(`${base}.png`,makeThumb().split(",")[1],msg+" — vignette"); }catch(_){}
    // nettoyage : une seule version par dessin, puis les N plus récents
    const files=await listFiles();
    const fresh=new Set([`${base}.${ext}`,`${base}.png`]);
    const stale=files.filter(f=>f.id===id && !fresh.has(f.path));
    const byId=new Map(); files.filter(f=>!stale.includes(f)).forEach(f=>{ const e=byId.get(f.id); if(!e||f.stamp>e) byId.set(f.id,f.stamp); });
    const keepIds=new Set([...byId.entries()].sort((a,b)=>b[1].localeCompare(a[1])).slice(0,Math.max(1,cfg.keep)).map(e=>e[0]));
    for(const f of files){ if(stale.includes(f) || !keepIds.has(f.id)) await delFile(f); }
    dirty=false; lastOk=Date.now(); setStatus("Dernière sauvegarde : "+new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}));
    if(!silent) showToast("Dessin sauvegardé sur GitHub.",{type:"success"});
    if($("cloudModal").classList.contains("open")) refreshList();
    return true;
  }catch(err){
    setStatus("Échec : "+err.message);
    if(!silent) showToast("Sauvegarde cloud impossible : "+err.message,{type:"error"});
    return false;
  }finally{ busy=false; }
}

// ---------- Interface ----------
const modal=$("cloudModal");
function setStatus(t){ $("clStatus").textContent=t; }
function fillFields(){
  $("clRepo").value=cfg.repo; $("clToken").value=cfg.token; $("clBranch").value=cfg.branch; $("clDir").value=cfg.dir; $("clKeep").value=cfg.keep; $("clAuto").checked=cfg.auto;
  setStatus(configured()?(lastOk?"Connecté":"Prêt"):"Non configuré");
}
function readFields(){
  cfg.repo=$("clRepo").value.trim().replace(/^https?:\/\/github\.com\//,"").replace(/\.git$/,"").replace(/\/$/,"");
  cfg.token=$("clToken").value.trim(); cfg.branch=$("clBranch").value.trim()||"main"; cfg.dir=($("clDir").value.trim()||"saves").replace(/^\/+|\/+$/g,"");
  cfg.keep=Math.max(1,Math.min(20,Math.round(+$("clKeep").value)||5)); cfg.auto=$("clAuto").checked; save();
}
function openModal(){ fillFields(); modal.classList.add("open"); if(configured()) refreshList(); else $("clList").innerHTML=""; }
const closeModal=()=>{ readFields(); modal.classList.remove("open"); };
$("miCloud").onclick=openModal; $("clClose").onclick=closeModal; $("clClose2").onclick=closeModal;
modal.addEventListener("click",e=>{ if(e.target.id==="cloudModal") closeModal(); });
["clRepo","clToken","clBranch","clDir"].forEach(id=>$(id).addEventListener("keydown",e=>{ e.stopPropagation(); }));
["clRepo","clToken","clBranch","clDir","clKeep","clAuto"].forEach(id=>$(id).addEventListener("change",readFields));
$("clNow").onclick=async()=>{ readFields(); await backupNow(); };
$("clTest").onclick=async()=>{
  readFields(); if(!configured()){ setStatus("Renseigne le dépôt et le jeton"); return; }
  setStatus("Test…");
  try{ const r=await api("/repos/"+cfg.repo); if(!r.ok) throw new Error(await explain(r));
    const j=await r.json(); setStatus(`Connecté à ${j.full_name}${j.private?" (privé)":" — ATTENTION : dépôt public"}`); await refreshList(); }
  catch(err){ setStatus("Échec : "+err.message); }
};
$("clCreate").onclick=async()=>{
  readFields(); const name=(cfg.repo.split("/")[1]||"pixel-studio-saves");
  if(!cfg.token){ setStatus("Renseigne d'abord un jeton"); return; }
  try{ const r=await api("/user/repos",{method:"POST",body:JSON.stringify({name,private:true,auto_init:true,description:"Sauvegardes Pixel Studio"})});
    if(!r.ok) throw new Error(r.status===404||r.status===403?"jeton sans le droit de créer des dépôts (crée le dépôt sur github.com)":await explain(r));
    const j=await r.json(); $("clRepo").value=cfg.repo=j.full_name; save(); setStatus("Dépôt privé créé : "+j.full_name); }
  catch(err){ setStatus("Échec : "+err.message); }
};
async function refreshList(){
  const box=$("clList"); box.innerHTML='<p class="note">Chargement…</p>';
  let files; try{ files=await listFiles(); }catch(err){ box.innerHTML=""; setStatus("Échec : "+err.message); return; }
  const docs=files.filter(f=>f.ext!=="png").sort((a,b)=>b.stamp.localeCompare(a.stamp));
  box.innerHTML=docs.length?"":'<p class="note">Aucune sauvegarde pour l\'instant.</p>';
  docs.forEach(f=>{
    const row=document.createElement("div"); row.className="pref";
    const th=document.createElement("img"); th.alt=""; th.className="cl-thumb";
    const lbl=document.createElement("div"); lbl.className="lbl grow";
    const d=f.stamp; const date=`${d.slice(6,8)}/${d.slice(4,6)} ${d.slice(9,11)}:${d.slice(11,13)} UTC`;
    lbl.innerHTML=`<span></span><small>${date} · ${(f.size/1024).toFixed(0)} ko</small>`; lbl.firstChild.textContent=f.label;
    const open=document.createElement("button"); open.textContent="Ouvrir"; const del=document.createElement("button"); del.textContent="Supprimer";
    const bx=document.createElement("div"); bx.className="inline sm"; bx.append(open,del);
    row.append(th,lbl,bx); box.appendChild(row);
    const png=files.find(x=>x.ext==="png" && x.stamp===f.stamp && x.id===f.id);
    if(png) api(contentsUrl(png.path)+"?ref="+encodeURIComponent(cfg.branch),{headers:{Accept:"application/vnd.github.raw+json"}}).then(r=>r.ok?r.blob():null).then(b=>{ if(b) th.src=URL.createObjectURL(b); }).catch(()=>{});
    open.onclick=async()=>{ open.disabled=true; try{
        const r=await api(contentsUrl(f.path)+"?ref="+encodeURIComponent(cfg.branch),{headers:{Accept:"application/vnd.github.raw+json"}});
        if(!r.ok) throw new Error(await explain(r));
        const obj=JSON.parse(await unpack(await r.arrayBuffer(),f.ext==="pixel.gz"));
        pushRecent();                                       // le projet en cours reste disponible dans « Projets récents »
        state.projectId=null; loadProject(obj); pushRecent(); closeModal(); showToast("Sauvegarde « "+f.label+" » ouverte.",{type:"success"});
      }catch(err){ showToast("Ouverture impossible : "+err.message,{type:"error"}); } open.disabled=false; };
    del.onclick=async()=>{ del.disabled=true; try{ for(const x of files.filter(x=>x.id===f.id)) await delFile(x); refreshList(); }catch(err){ showToast("Suppression impossible : "+err.message,{type:"error"}); del.disabled=false; } };
  });
}

// ---------- Sauvegarde automatique ----------
setTimeout(()=>{                                              // après l'initialisation complète des modules (cycle history ↔ ui)
  setTimeout(()=>onSnapshot(()=>{ dirty=true; }),1500);
  setInterval(()=>{ if(cfg.auto && configured() && dirty && !busy) backupNow({silent:true}); },120000);
  document.addEventListener("visibilitychange",()=>{ if(document.hidden && cfg.auto && configured() && dirty && !busy) backupNow({silent:true}); });
},0);
