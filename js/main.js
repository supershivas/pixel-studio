import { state } from "./state.js";
import { newLayer, render } from "./helpers.js";
import { snapshot } from "./history.js";
import { FONTS, OS, updateTextGlyph } from "./drawing.js";
import { fitZoom } from "./interaction.js";
import { setColor, buildLayers, loadPrefs, applyPrefs } from "./ui.js";
import "./io.js";

// ---------- Init ----------
loadPrefs();
state.layerSeq=1;
state.layers=[newLayer("Fond"),newLayer("Dessin")]; state.active=1;
setColor(state.color);
buildLayers();
snapshot();
applyPrefs();
fitZoom();
window.addEventListener("resize",()=>{ /* laisser le zoom manuel */ });

// Polices pixel : prêtes dès chargement (data-URI => quasi instantané)
function loadPixelFont(key){
  const F=FONTS[key];
  if(document.fonts && document.fonts.load){
    document.fonts.load(`${F.line*OS}px '${F.family}'`).then(()=>{ F.ready=true; updateTextGlyph(); })
      .catch(()=>{ F.ready=true; });
  } else { F.ready=true; }
}
loadPixelFont("press");
loadPixelFont("cozette");
setInterval(()=>{ if(state.textEditing){ state.caretOn=!state.caretOn; render(); } }, 530);
