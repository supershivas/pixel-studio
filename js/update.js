import { showToast } from "./toast.js";

// ---------- Détection de mise à jour ----------
// Le workflow de déploiement écrit le build courant dans <meta name="build"> et dans
// version.json (voir .github/stamp-build.sh). Si les deux divergent, une version plus récente est
// en ligne : on propose de recharger. En dev local le marqueur n'est pas remplacé → inactif.
const CHECK_EVERY=10*60*1000;
const mine=(document.querySelector('meta[name="build"]')||{}).content;
let notified=false;

async function checkForUpdate(){
  if(notified) return;
  try{
    const r=await fetch("version.json?t="+Date.now(),{cache:"no-store"});
    if(!r.ok) return;
    const {build}=await r.json();
    if(!build || build===mine) return;
    notified=true;
    showToast("Une nouvelle version de Pixel Studio est disponible.",{ type:"info", duration:600000,
      actionLabel:"Recharger", onAction:()=>location.reload() });
  }catch(_){}                    // hors ligne ou fichier absent : on réessaiera plus tard
}
if(mine && mine!=="__BUILD__"){
  checkForUpdate();
  setInterval(checkForUpdate,CHECK_EVERY);
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) checkForUpdate(); });
}
