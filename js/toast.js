// ---------- Toasts (feedback non bloquant) ----------
const host=document.getElementById("toastHost");
export function showToast(msg,opts){
  opts=opts||{};
  const type=opts.type||"info";
  const duration=opts.duration||4000;
  const el=document.createElement("div");
  el.className="toast toast-"+type;
  const txt=document.createElement("span"); txt.className="toast-msg"; txt.textContent=msg;
  el.appendChild(txt);
  let timer=null;
  const close=()=>{ clearTimeout(timer); el.classList.add("out"); setTimeout(()=>el.remove(),180); };
  if(opts.actionLabel && typeof opts.onAction==="function"){
    const btn=document.createElement("button"); btn.className="toast-action"; btn.textContent=opts.actionLabel;
    btn.addEventListener("click",()=>{ close(); opts.onAction(); });
    el.appendChild(btn);
  }
  const x=document.createElement("button"); x.className="toast-x"; x.textContent="×"; x.title="Fermer";
  x.addEventListener("click",close);
  el.appendChild(x);
  host.appendChild(el);
  timer=setTimeout(close,duration);
  return close;
}
