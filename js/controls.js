// ---------- Champs numériques et curseurs : lisibilité et précision (tablettes comprises) ----------
const $$=(sel,root=document)=>[...root.querySelectorAll(sel)];

// 1) champs numériques : assez larges pour le nombre de chiffres attendu (d'après max), avec de la marge
$$("input[type=number]").forEach(el=>{
  const max=el.getAttribute("max"), min=+el.getAttribute("min");
  const digits = max ? String(Math.abs(+max)).length+1 : 5;
  el.style.setProperty("--digits",Math.min(7,Math.max(3,digits+(min<0?1:0))));
  if(!(min<0)) el.setAttribute("inputmode","numeric");        // pavé numérique (sans signe moins) quand les valeurs sont positives
  el.addEventListener("focus",()=>{ try{ el.select(); }catch(_){} });      // un toucher remplace la valeur au lieu de la compléter
});

// 2) curseurs : boutons − / +, et réglage fin façon iOS (plus le doigt s'éloigne verticalement, plus c'est précis)
const tip=document.createElement("div"); tip.className="rng-tip"; tip.hidden=true; document.body.appendChild(tip);
function setVal(r,v,fire=true){
  const min=+r.min||0, max=r.max===""?100:+r.max, step=+r.step||1;
  v=Math.max(min,Math.min(max,Math.round((v-min)/step)*step+min));
  v=+v.toFixed(6);
  if(+r.value===v) return false;
  r.value=v; if(fire) r.dispatchEvent(new Event("input",{bubbles:true}));
  return true;
}
function enhance(r){
  if(r.closest(".rng")) return;
  const wrap=document.createElement("span"); wrap.className="rng";
  const mk=(txt,dir,title)=>{ const b=document.createElement("button"); b.type="button"; b.className="rng-btn"; b.textContent=txt; b.title=title; b.tabIndex=-1;
    const nudge=()=>{ const step=+r.step||1; if(setVal(r,+r.value+dir*step)) r.dispatchEvent(new Event("change",{bubbles:true})); };
    let t=0,iv=0;
    b.addEventListener("pointerdown",e=>{ e.preventDefault(); nudge(); t=setTimeout(()=>{ iv=setInterval(nudge,80); },400); });
    const stop=()=>{ clearTimeout(t); clearInterval(iv); };
    ["pointerup","pointerleave","pointercancel"].forEach(n=>b.addEventListener(n,stop));
    return b; };
  r.replaceWith(wrap); wrap.append(mk("−",-1,"Diminuer d'un cran"),r,mk("+",1,"Augmenter d'un cran"));

  let drag=null;
  const valueAt=x=>{ const b=r.getBoundingClientRect(), th=r.offsetHeight>36?30:22, p=(x-b.left-th/2)/Math.max(1,b.width-th);
    const min=+r.min||0, max=r.max===""?100:+r.max; return min+Math.max(0,Math.min(1,p))*(max-min); };
  const showTip=(e,mode)=>{ const b=r.getBoundingClientRect(); tip.hidden=false;
    tip.innerHTML=r.value+(mode<1?`<small>précision ×${mode}</small>`:""); tip.style.left=Math.max(40,Math.min(innerWidth-40,e.clientX))+"px"; tip.style.top=(b.top-6)+"px"; };
  r.addEventListener("pointerdown",e=>{
    if(e.button!==0 || r.disabled) return;
    e.preventDefault(); r.setPointerCapture(e.pointerId); r.focus({preventScroll:true});
    drag={ y0:e.clientY, x:e.clientX, val:valueAt(e.clientX), changed:false };
    if(setVal(r,drag.val)) drag.changed=true; showTip(e,1);
  });
  r.addEventListener("pointermove",e=>{
    if(!drag) return;
    const dy=Math.abs(e.clientY-drag.y0), f = dy<50 ? 1 : dy<110 ? 0.25 : 0.05;
    if(f===1){ drag.val=valueAt(e.clientX); }
    else { const min=+r.min||0, max=r.max===""?100:+r.max, w=Math.max(1,r.getBoundingClientRect().width);
      drag.val=Math.max(min,Math.min(max,drag.val+(e.clientX-drag.x)/w*(max-min)*f)); }
    drag.x=e.clientX;
    if(setVal(r,drag.val)) drag.changed=true;
    showTip(e,f);
  });
  const end=()=>{ if(!drag) return; if(drag.changed) r.dispatchEvent(new Event("change",{bubbles:true})); drag=null; tip.hidden=true; };
  r.addEventListener("pointerup",end); r.addEventListener("pointercancel",end);
}
$$("input[type=range]").forEach(enhance);
