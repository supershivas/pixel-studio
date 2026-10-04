// ---------- Tablettes (iPad) : désactiver les outils de sélection du système ----------
// Le CSS (user-select / -webkit-touch-callout) fait l'essentiel ; ces écouteurs couvrent les cas où
// Safari sélectionne quand même (appui long, double toucher) et le zoom par pincement de la page.
const editable=t=>t && t.closest && t.closest("input,textarea,select,[contenteditable='true']");
document.addEventListener("contextmenu",e=>{ if(!editable(e.target)) e.preventDefault(); });
document.addEventListener("selectstart",e=>{ if(!editable(e.target)) e.preventDefault(); });
["gesturestart","gesturechange","gestureend"].forEach(n=>document.addEventListener(n,e=>e.preventDefault()));
