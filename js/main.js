import { state } from "./state.js";
import { newLayer, render } from "./helpers.js";
import { snapshot, onSnapshot, onSizeRestore } from "./history.js";
import { FONTS, OS, updateTextGlyph } from "./drawing.js";
import { fitZoom } from "./interaction.js";
import { setColor, setColor2, buildLayers, loadPrefs, applyPrefs, setProjectName, afterSizeRestore } from "./ui.js";
import { restoreAutosaveIfAny, scheduleAutosave } from "./io.js";
import { initFrames } from "./frames.js";
import "./home.js";
import "./modals.js";
import "./update.js";
import "./patterns.js";
import "./stamps.js";
import "./palettes.js";

// ---------- Init ----------
loadPrefs();
state.layerSeq=1;
state.layers=[newLayer("Fond"),newLayer("Dessin")]; state.active=1;
initFrames();
setColor(state.color);
setColor2(state.color2);
setProjectName(state.projectName);
buildLayers();
snapshot();                    // état initial vierge : pas encore suivi par l'autosave
applyPrefs();
fitZoom();
restoreAutosaveIfAny();        // propose de restaurer un dessin précédent, s'il y en a un
onSnapshot(scheduleAutosave);
onSizeRestore(afterSizeRestore);  // annuler / rétablir un rognage : zoom et champs de taille suivent  // à partir de maintenant, chaque snapshot programme une sauvegarde
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
