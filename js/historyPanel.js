import { state } from "./state.js";
import { historyRows, jumpTo, onSnapshot } from "./history.js";

// ---------- Panneau d'historique : liste des états, clic pour y revenir ----------
const $=id=>document.getElementById(id);
const panel=$("historyPanel"), list=$("historyList"), tog=$("historyToggle");
let hooked=false;
function refresh(){
  if(panel.hidden) return;
  list.innerHTML="";
  const rows=historyRows().slice().reverse();                       // le plus récent en haut
  rows.forEach(r=>{
    const b=document.createElement("button"); b.type="button";
    b.className="hrow"+(r.active?" active":"")+(r.future?" future":"");
    b.innerHTML='<span class="hn"></span><span class="hl"></span>';
    b.querySelector(".hn").textContent=r.n;
    b.querySelector(".hl").textContent=r.label;
    b.title=r.future ? "État annulé — clic pour le rétablir" : r.active ? "État actuel" : "Revenir à cet état";
    b.addEventListener("click",()=>{ jumpTo(r.index); });
    list.appendChild(b);
  });
  const act=list.querySelector(".active"); if(act) act.scrollIntoView({block:"nearest"});
}
// l'état « courant » (action faite mais pas encore empilée) n'émet pas d'événement : on suit aussi les rendus
let timer=0;
const refreshSoon=()=>{ if(timer) return; timer=setTimeout(()=>{ timer=0; refresh(); },120); };
function setOpen(on){
  panel.hidden=!on; tog.checked=on; state.renderHooks[on?"add":"delete"](refreshSoon);
  if(on && !hooked){ hooked=true; onSnapshot(refresh); }   // abonné à la première ouverture (cycle d'imports history ↔ ui)
  refresh();
}
tog.onchange=()=>setOpen(tog.checked);
$("historyClose").onclick=()=>setOpen(false);
