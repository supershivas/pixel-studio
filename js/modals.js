// ---------- Modales déplaçables ----------
// glisser depuis l'en-tête (hors boutons) ; repositionnées au centre à chaque ouverture
document.querySelectorAll(".modal-backdrop").forEach(backdrop=>{
  const modal=backdrop.querySelector(".modal");
  const header=modal && modal.querySelector("header");
  if(!modal||!header) return;
  let dx=0, dy=0, dragging=false, startX=0, startY=0, baseX=0, baseY=0;
  header.addEventListener("pointerdown",e=>{
    if(e.target.closest("button")) return;
    dragging=true; header.setPointerCapture(e.pointerId); header.style.cursor="grabbing";
    startX=e.clientX; startY=e.clientY; baseX=dx; baseY=dy;
  });
  header.addEventListener("pointermove",e=>{
    if(!dragging) return;
    dx=baseX+(e.clientX-startX); dy=baseY+(e.clientY-startY);
    modal.style.transform=`translate(${dx}px,${dy}px)`;
  });
  const stop=()=>{ dragging=false; header.style.cursor="grab"; };
  header.addEventListener("pointerup",stop);
  header.addEventListener("pointercancel",stop);
  new MutationObserver(muts=>{
    for(const m of muts) if(m.attributeName==="class" && backdrop.classList.contains("open")){
      dx=0; dy=0; modal.style.transform="";
    }
  }).observe(backdrop,{attributes:true});
});
