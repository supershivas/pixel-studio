import { state, octx } from "./state.js";
import { idx, inBounds, layerAt, setLayerAt, newLayer, hexToRgb, render, commitFloat, bakeOffset } from "./helpers.js";
import { snapshot } from "./history.js";
import { setHint } from "./interaction.js";
import { buildLayers, commitCanvasText } from "./ui.js";
import { showToast } from "./toast.js";
import { BAYER4, BAYER8 } from "./dither.js";

// ---------- Drawing primitives ----------
// ---------- Symétrie ----------
// Points image de (x,y) selon la symétrie active, point d'origine compris.
// Partagée par le crayon, la gomme et l'outil Forme pour que tous se comportent pareil.
export function mirrorPoints(x,y){
  const pts=[[x,y]];
  if(state.mirror==="x"||state.mirror==="xy") pts.push([state.W-1-x,y]);
  if(state.mirror==="y"||state.mirror==="xy") pts.push([x,state.H-1-y]);
  if(state.mirror==="xy") pts.push([state.W-1-x,state.H-1-y]);
  return pts;
}
// Dessin en boucle : une cellule hors du canevas ressort de l'autre côté (null si hors canevas sans boucle)
export function wrapCell(x,y){
  if(state.wrap==="x"||state.wrap==="xy") x=((x%state.W)+state.W)%state.W;
  if(state.wrap==="y"||state.wrap==="xy") y=((y%state.H)+state.H)%state.H;
  return inBounds(x,y) ? [x,y] : null;
}
// ---------- Formes de pinceau ----------
// Décalages [dx,dy] (autour du curseur) des cellules d'un pinceau de taille n et de forme donnée, mis en cache.
const brushCache=new Map();
export function brushOffsets(n,shape){
  if(shape==="spray") shape="round";                     // l'aérographe est un disque dont chaque cellule est tirée au hasard
  const key=shape+n; let v=brushCache.get(key); if(v) return v;
  const half=Math.floor((n-1)/2), c=(n-1)/2, out=[];
  for(let j=0;j<n;j++) for(let i=0;i<n;i++){
    const dx=i-c, dy=j-c; let on=true;
    switch(shape){
      case "round":     on = dx*dx+dy*dy <= ((n-0.5)/2)**2; break;
      case "diamond":   on = Math.abs(dx)+Math.abs(dy) <= (n-1)/2+0.5; break;
      case "hline":     on = j===half; break;
      case "vline":     on = i===half; break;
      case "slash":     on = i+j===n-1; break;
      case "backslash": on = i===j; break;
    }
    if(on) out.push([i-half,j-half]);
  }
  brushCache.set(key,out); return out;
}
// taille effective : celle du curseur, modulée par la pression du stylet si l'option est active
export function brushSize(){
  if(!state.brushPressure) return state.brush;
  return Math.max(1,Math.min(32,Math.round(state.brush*(0.2+1.6*state.pressure))));
}
export function stamp(x,y,col,L){ // pinceau (forme, taille, pression), symétrie et boucle ; L = calque cible (décalage géré)
  const offs=brushOffsets(brushSize(),state.brushShape), spray=state.brushShape==="spray" && state.brush>2;
  for(const [px,py] of mirrorPoints(x,y))
    for(const [dx,dy] of offs){
      if(spray && Math.random()>0.22) continue;
      const c=wrapCell(px+dx,py+dy);
      if(c) setLayerAt(L,c[0],c[1],col); // col null => efface
    }
}
export function line(x0,y0,x1,y1,cb){
  let dx=Math.abs(x1-x0), dy=Math.abs(y1-y0);
  let sx=x0<x1?1:-1, sy=y0<y1?1:-1, err=dx-dy;
  while(true){ cb(x0,y0); if(x0===x1&&y0===y1) break;
    const e2=2*err; if(e2>-dy){err-=dy;x0+=sx;} if(e2<dx){err+=dx;y0+=sy;} }
}
export function rectCells(x0,y0,x1,y1,filled,cb){
  const [ax,bx]=[Math.min(x0,x1),Math.max(x0,x1)];
  const [ay,by]=[Math.min(y0,y1),Math.max(y0,y1)];
  for(let y=ay;y<=by;y++) for(let x=ax;x<=bx;x++){
    if(filled||x===ax||x===bx||y===ay||y===by) cb(x,y);
  }
}
export function ellipseCells(x0,y0,x1,y1,filled,cb){
  const cx=(x0+x1)/2, cy=(y0+y1)/2;
  const rx=Math.max(.5,Math.abs(x1-x0)/2), ry=Math.max(.5,Math.abs(y1-y0)/2);
  const ax=Math.min(x0,x1),bx=Math.max(x0,x1),ay=Math.min(y0,y1),by=Math.max(y0,y1);
  for(let y=ay;y<=by;y++) for(let x=ax;x<=bx;x++){
    const nx=(x+.5-cx)/rx, ny=(y+.5-cy)/ry, d=nx*nx+ny*ny;
    if(filled){ if(d<=1) cb(x,y); }
    else { if(d<=1 && d>Math.pow(1-Math.max(1/rx,1/ry)*1.6,2)) cb(x,y); }
  }
}
export function polyVerts(kind,x0,y0,x1,y1){
  const ax=Math.min(x0,x1),bx=Math.max(x0,x1),ay=Math.min(y0,y1),by=Math.max(y0,y1);
  const w=bx-ax||1,h=by-ay||1, cx=ax+w/2, cy=ay+h/2;
  if(kind==="triangle") return [[cx,ay],[bx,by],[ax,by]];
  if(kind==="diamond")  return [[cx,ay],[bx,cy],[cx,by],[ax,cy]];
  if(kind==="star"){
    const pts=[]; const R=Math.min(w,h)/2, r=R*0.42;
    for(let i=0;i<10;i++){ const ang=-Math.PI/2 + i*Math.PI/5; const rad=i%2?r:R;
      pts.push([cx+Math.cos(ang)*rad, cy+Math.sin(ang)*rad]); }
    return pts;
  }
  if(kind==="heart"){
    const pts=[]; for(let t=0;t<Math.PI*2;t+=Math.PI/24){
      const hx=16*Math.pow(Math.sin(t),3);
      const hy=13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t);
      pts.push([cx+hx/16*(w/2), cy-hy/16*(h/2)]);
    } return pts;
  }
  return [];
}
export function polyFill(verts,filled,cb){
  const xs=verts.map(p=>p[0]), ys=verts.map(p=>p[1]);
  const ax=Math.floor(Math.min(...xs)),bx=Math.ceil(Math.max(...xs));
  const ay=Math.floor(Math.min(...ys)),by=Math.ceil(Math.max(...ys));
  if(filled){
    for(let y=ay;y<=by;y++) for(let x=ax;x<=bx;x++){
      if(pointInPoly(x+.5,y+.5,verts)) cb(x,y);
    }
  } else {
    for(let i=0;i<verts.length;i++){
      const a=verts[i], b=verts[(i+1)%verts.length];
      line(Math.round(a[0]),Math.round(a[1]),Math.round(b[0]),Math.round(b[1]),cb);
    }
  }
}
export function pointInPoly(px,py,vs){
  let inside=false;
  for(let i=0,j=vs.length-1;i<vs.length;j=i++){
    const xi=vs[i][0],yi=vs[i][1],xj=vs[j][0],yj=vs[j][1];
    if(((yi>py)!==(yj>py)) && (px<(xj-xi)*(py-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
// distance entre deux couleurs hexa (0 = identiques, ~441 = noir / blanc) ; null = transparent
const _rgbCache=new Map();
const rgbOf=h=>{ let v=_rgbCache.get(h); if(!v){ v=hexToRgb(h); _rgbCache.set(h,v); } return v; };
export function colorDist(a,b){
  if(a===b) return 0; if(a===null||b===null) return Infinity;
  const p=rgbOf(a),q=rgbOf(b); return Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);
}
// Cellules du calque L proches (tolérance en %) de la couleur de (x,y) : contiguës ou sur tout le calque
export function collectRegion(L,x,y,tolPct,contiguous){
  const targ=layerAt(L,x,y), maxD=(tolPct||0)/100*441.7, cells=[];
  const like=(cx,cy)=>colorDist(layerAt(L,cx,cy),targ)<=maxD;
  if(!contiguous){
    for(let cy=0;cy<state.H;cy++) for(let cx=0;cx<state.W;cx++) if(like(cx,cy)) cells.push([cx,cy]);
    return cells;
  }
  const seen=new Uint8Array(state.W*state.H), st=[[x,y]];
  while(st.length){
    const [cx,cy]=st.pop(); if(cx<0||cy<0||cx>=state.W||cy>=state.H) continue;
    const k=cy*state.W+cx; if(seen[k]) continue;
    seen[k]=1; if(!like(cx,cy)) continue;
    cells.push([cx,cy]); st.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
  }
  return cells;
}
export function floodFill(x,y,col){
  const L=state.layers[state.active]; const targ=layerAt(L,x,y);
  if(targ===col) return;
  if(L.alphaLock && targ===null){ setHint("Transparence verrouillée — clique sur un pixel déjà peint"); return; }
  for(const [cx,cy] of collectRegion(L,x,y,state.fillTol,state.fillContig)) setLayerAt(L,cx,cy,col);
}

// ---------- Baguette magique : sélectionne les pixels de même couleur (contigus ou non) ----------
// La zone trouvée est directement soulevée dans floatSel (comme une sélection classique) ;
// les cellules hors-forme mais dans le rectangle englobant restent à null, donc ignorées
// par tout le système de sélection existant (déplacement, copier/coller…).
export function selectSimilar(x0,y0,contiguous,additive){
  const L=state.layers[state.active];
  if(!additive) commitFloat();
  const target=layerAt(L,x0,y0);
  if(target===null){ setHint("Aucun pixel non vide sous le curseur"); return; }
  const cells=[];
  if(contiguous){
    const seen=new Uint8Array(state.W*state.H); const st=[[x0,y0]];
    while(st.length){
      const [cx,cy]=st.pop(); if(cx<0||cy<0||cx>=state.W||cy>=state.H) continue;
      const k=cy*state.W+cx; if(seen[k]) continue;
      if(layerAt(L,cx,cy)!==target) continue;
      seen[k]=1; cells.push([cx,cy]);
      st.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
    }
  } else {
    for(let y=0;y<state.H;y++) for(let x=0;x<state.W;x++){ if(layerAt(L,x,y)===target) cells.push([x,y]); }
  }
  floatFromCells(L,cells,additive);
}
// Soulève les pixels non vides de `cells` du calque L en sélection flottante (déplaçable) ; avec
// `additive`, ils s'ajoutent à la sélection flottante déjà en cours. Commun à la baguette et au lasso.
function floatFromCells(L,cells,additive){
  const abs=new Map();
  for(const [cx,cy] of cells){ const c=layerAt(L,cx,cy); if(c!==null) abs.set(cx+","+cy,c); }
  if(!abs.size){ setHint("Aucun pixel dans la zone"); return false; }
  snapshot();
  for(const k of abs.keys()){ const [ax,ay]=k.split(",").map(Number); setLayerAt(L,ax,ay,null); }
  // fusion avec la sélection flottante existante si on ajoute (Maj) à une sélection déjà en cours
  const picked=abs.size;
  if(additive && state.floatSel){
    const f=state.floatSel;
    for(let j=0;j<f.h;j++) for(let i=0;i<f.w;i++){ const c=f.data[j*f.w+i]; if(c===null) continue; abs.set((f.x+i)+","+(f.y+j),c); }
  }
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const k of abs.keys()){ const [ax,ay]=k.split(",").map(Number);
    if(ax<minX)minX=ax; if(ay<minY)minY=ay; if(ax>maxX)maxX=ax; if(ay>maxY)maxY=ay; }
  const w=maxX-minX+1, h=maxY-minY+1;
  const data=new Array(w*h).fill(null);
  for(const [k,c] of abs){ const [ax,ay]=k.split(",").map(Number); data[(ay-minY)*w+(ax-minX)]=c; }
  state.floatSel={data,w,h,x:minX,y:minY};
  state.sel={x:minX,y:minY,w,h};
  state.thumbsDirty=true;
  buildLayers();
  setHint(picked+" pixel"+(picked>1?"s":"")+(additive?" ajoutés":" sélectionnés"));
  return true;
}
// Lasso : cellules dont le centre est dans le polygone tracé (règle pair/impair) + cellules du tracé
export function selectLasso(pts,additive){
  const L=state.layers[state.active];
  if(L.img){ setHint("Le lasso ne s'applique pas aux calques image"); return; }
  if(!additive) commitFloat();
  const cells=new Map(); pts.forEach(([x,y])=>cells.set(x+","+y,[x,y]));
  if(pts.length>=3){
    let minX=state.W,minY=state.H,maxX=0,maxY=0;
    for(const [x,y] of pts){ minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y); }
    const inside=(px,py)=>{ let c=false;
      for(let i=0,j=pts.length-1;i<pts.length;j=i++){
        const xi=pts[i][0]+.5, yi=pts[i][1]+.5, xj=pts[j][0]+.5, yj=pts[j][1]+.5;
        if((yi>py)!==(yj>py) && px<(xj-xi)*(py-yi)/(yj-yi)+xi) c=!c; }
      return c; };
    for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++) if(inside(x+.5,y+.5)) cells.set(x+","+y,[x,y]);
  }
  floatFromCells(L,[...cells.values()],additive);
}

// ---------- Texte pixel (polices bitmap) ----------
export const OS=8;                        // suréchantillonnage : 1 pixel de glyphe = OS px
export const FONTS={
  press:  { family:"Press Start 2P", line:8,  ready:false },
  cozette:{ family:"Cozette",        line:13, ready:false }
};
export function rasterizeTTF(str,fontKey,scale){
  const F=FONTS[fontKey];
  if(!F || !F.ready || !str) return {cells:[],w:0,h:0};
  const L=F.line, font=`${L*OS}px '${F.family}'`;
  const lines=str.split("\n");
  const meas=document.createElement("canvas").getContext("2d");
  meas.font=font;
  let maxw=0; for(const ln of lines) maxw=Math.max(maxw, meas.measureText(ln||" ").width);
  const wpx=Math.max(1,Math.ceil(maxw/OS));
  const hpx=lines.length*L + (lines.length-1);
  const rc=document.createElement("canvas");
  rc.width=wpx*OS; rc.height=hpx*OS+OS;
  const rctx=rc.getContext("2d");
  rctx.font=font; rctx.textBaseline="top"; rctx.fillStyle="#fff";
  lines.forEach((ln,li)=> rctx.fillText(ln, 0, li*(L+1)*OS));
  const img=rctx.getImageData(0,0,rc.width,rc.height).data;
  const cw=Math.floor(rc.width/OS), ch=Math.floor(rc.height/OS);
  let cells=[];
  for(let cy=0;cy<ch;cy++) for(let cx=0;cx<cw;cx++){
    const sx=cx*OS+(OS>>1), sy=cy*OS+(OS>>1);
    if(img[(sy*rc.width+sx)*4+3]>128) cells.push([cx,cy]);
  }
  if(cells.length){ const mnX=Math.min(...cells.map(c=>c[0])), mnY=Math.min(...cells.map(c=>c[1]));
    cells=cells.map(([x,y])=>[x-mnX,y-mnY]); }
  cells=scaleCells(cells,scale);
  const w=cells.length?Math.max(...cells.map(c=>c[0]))+1:0;
  const h=cells.length?Math.max(...cells.map(c=>c[1]))+1:0;
  return {cells,w,h};
}
export function scaleCells(cells,f){
  if(!cells.length || f===1) return cells;
  const gw=Math.max(...cells.map(c=>c[0]))+1, gh=Math.max(...cells.map(c=>c[1]))+1;
  const base=new Set(cells.map(c=>c[0]+","+c[1]));
  const outW=Math.max(1,Math.round(gw*f)), outH=Math.max(1,Math.round(gh*f));
  const out=[];
  for(let oy=0;oy<outH;oy++) for(let ox=0;ox<outW;ox++){
    const sx=Math.min(gw-1,Math.floor(ox/f)), sy=Math.min(gh-1,Math.floor(oy/f));
    if(base.has(sx+","+sy)) out.push([ox,oy]);
  }
  return out;
}
export function updateTextGlyph(){
  state.textGlyph = (state.textFont==="micro") ? rasterizeMicro(state.textString,state.textScale) : rasterizeTTF(state.textString,state.textFont,state.textScale);
}

// ---------- Police micro 3×5 (codée en dur, nette au plus petit) ----------
export const MICRO={
  "A":["010","101","111","101","101"],"B":["110","101","110","101","110"],
  "C":["011","100","100","100","011"],"D":["110","101","101","101","110"],
  "E":["111","100","110","100","111"],"F":["111","100","110","100","100"],
  "G":["011","100","101","101","011"],"H":["101","101","111","101","101"],
  "I":["111","010","010","010","111"],"J":["001","001","001","101","010"],
  "K":["101","101","110","101","101"],"L":["100","100","100","100","111"],
  "M":["101","111","111","101","101"],"N":["101","111","111","111","101"],
  "O":["010","101","101","101","010"],"P":["110","101","110","100","100"],
  "Q":["010","101","101","011","001"],"R":["110","101","110","101","101"],
  "S":["011","100","010","001","110"],"T":["111","010","010","010","010"],
  "U":["101","101","101","101","111"],"V":["101","101","101","101","010"],
  "W":["101","101","111","111","101"],"X":["101","101","010","101","101"],
  "Y":["101","101","010","010","010"],"Z":["111","001","010","100","111"],
  "0":["111","101","101","101","111"],"1":["010","110","010","010","111"],
  "2":["110","001","010","100","111"],"3":["111","001","011","001","111"],
  "4":["101","101","111","001","001"],"5":["111","100","110","001","110"],
  "6":["011","100","111","101","111"],"7":["111","001","010","010","010"],
  "8":["111","101","111","101","111"],"9":["111","101","111","001","110"],
  " ":["000","000","000","000","000"],".":["000","000","000","000","010"],
  ",":["000","000","000","010","100"],"!":["010","010","010","000","010"],
  "?":["110","001","010","000","010"],"-":["000","000","111","000","000"],
  ":":["000","010","000","010","000"],"'":["010","010","000","000","000"],
  "/":["001","001","010","100","100"],"(":["001","010","010","010","001"],
  ")":["100","010","010","010","100"],"&":["010","101","010","101","011"],
  "+":["000","010","111","010","000"],"°":["110","110","000","000","000"],
  "\"":["101","101","000","000","000"],"€":["011","110","100","110","011"]
};
// accents -> lettre de base (police uppercase, décorative)
export const DEACC={"À":"A","Â":"A","Ä":"A","Ç":"C","É":"E","È":"E","Ê":"E","Ë":"E",
  "Î":"I","Ï":"I","Ô":"O","Ö":"O","Ù":"U","Û":"U","Ü":"U","Œ":"OE"};
export function microGlyph(ch){ ch=ch.toUpperCase(); if(DEACC[ch]) ch=DEACC[ch][0]; return MICRO[ch]||MICRO["?"]; }
export function rasterizeMicro(str,scale){
  if(!str) return {cells:[],w:0,h:0};
  const lines=str.split("\n"); let cells=[]; const GW=3,GH=5,SP=1,LSP=1;
  lines.forEach((ln,li)=>{
    let cx=0; const y0=li*(GH+LSP);
    for(const rawc of ln){ const g=microGlyph(rawc);
      for(let r=0;r<GH;r++){ const row=g[r]; for(let c=0;c<GW;c++) if(row[c]==="1") cells.push([cx+c,y0+r]); }
      cx+=GW+SP;
    }
  });
  cells=scaleCells(cells,scale);
  const w=cells.length?Math.max(...cells.map(c=>c[0]))+1:0;
  const h=cells.length?Math.max(...cells.map(c=>c[1]))+1:0;
  return {cells,w,h};
}
export function textPreview(ox,oy){
  state.previewCells=new Map();
  for(const [dx,dy] of state.textGlyph.cells){ const x=ox+dx,y=oy+dy; if(inBounds(x,y)) state.previewCells.set(x+","+y,state.color); }
}
export function textLabel(s){ const t=(s||"").split("\n")[0].trim(); return t?t.slice(0,24):"Texte"; }
export function commitText(ox,oy){
  const L=addPixelLayerAbove(textLabel(state.textString));
  const d=L.data;
  for(const [dx,dy] of state.textGlyph.cells){ const x=ox+dx,y=oy+dy; if(inBounds(x,y)) d[idx(x,y)]=state.color; }
  L.text={string:state.textString,font:state.textFont,scale:state.textScale,color:state.color,ax:ox,ay:oy};
  buildLayers();
}

// ---------- Formes vectorielles (transformables) ----------
export const TRANSFORM_TOOLS = new Set(["rect","ellipse","triangle","diamond","star","heart"]);
export const UNIT_POLY = {};
(function(){
  const raw={
    triangle:[[0,-0.5],[0.5,0.5],[-0.5,0.5]],
    diamond:[[0,-0.5],[0.5,0],[0,0.5],[-0.5,0]],
    star:(()=>{const p=[];for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=(i%2)?0.2:0.5;p.push([Math.cos(a)*r,Math.sin(a)*r]);}return p;})(),
    heart:(()=>{const p=[];for(let t=0;t<Math.PI*2;t+=Math.PI/28){const x=16*Math.pow(Math.sin(t),3);const y=13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t);p.push([x,-y]);}return p;})()
  };
  const norm=pts=>{const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
    const mnx=Math.min(...xs),mxx=Math.max(...xs),mny=Math.min(...ys),mxy=Math.max(...ys);
    const w=mxx-mnx||1,h=mxy-mny||1;
    return pts.map(([x,y])=>[(x-mnx)/w-0.5,(y-mny)/h-0.5]);};
  for(const k in raw) UNIT_POLY[k]=norm(raw[k]);
})();
export function insideUnit(type,x,y){
  if(type==="rect") return x>=-0.5&&x<=0.5&&y>=-0.5&&y<=0.5;
  if(type==="ellipse") return (x*x+y*y)<=0.25;
  return pointInPoly(x,y,UNIT_POLY[type]);
}
export function shapeMatrix(s){
  const cos=Math.cos(s.rot),sin=Math.sin(s.rot);
  return { a:s.w*(cos-sin*s.skewY), b:s.h*(cos*s.skewX-sin),
           c:s.w*(sin+cos*s.skewY), d:s.h*(sin*s.skewX+cos) };
}
export function unitToGrid(s,ux,uy){ const{a,b,c,d}=shapeMatrix(s); return [a*ux+b*uy+s.cx, c*ux+d*uy+s.cy]; }
export function gridToUnit(s,gx,gy){ const{a,b,c,d}=shapeMatrix(s); const det=(a*d-b*c)||1e-6;
  const dx=gx-s.cx,dy=gy-s.cy; return [(d*dx-b*dy)/det, (-c*dx+a*dy)/det]; }
export function unrot(s,gx,gy){ const cos=Math.cos(-s.rot),sin=Math.sin(-s.rot); const dx=gx-s.cx,dy=gy-s.cy; return [dx*cos-dy*sin,dx*sin+dy*cos]; }
export function rasterizeShape(s){
  const corners=[[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]].map(([u,v])=>unitToGrid(s,u,v));
  let minx=Math.max(0,Math.floor(Math.min(...corners.map(p=>p[0]))));
  let maxx=Math.min(state.W-1,Math.ceil(Math.max(...corners.map(p=>p[0]))));
  let miny=Math.max(0,Math.floor(Math.min(...corners.map(p=>p[1]))));
  let maxy=Math.min(state.H-1,Math.ceil(Math.max(...corners.map(p=>p[1]))));
  const on=new Set();
  for(let y=miny;y<=maxy;y++) for(let x=minx;x<=maxx;x++){
    const [ux,uy]=gridToUnit(s,x+0.5,y+0.5);
    if(insideUnit(s.type,ux,uy)) on.add(x+","+y);
  }
  if(s.filled) return [...on].map(k=>k.split(",").map(Number));
  const w=Math.max(1,s.strokeW||1);
  const out=[];
  for(const k of on){ const [x,y]=k.split(",").map(Number);
    let edge=false;
    for(let ry=-w;ry<=w && !edge;ry++) for(let rx=-w;rx<=w;rx++){
      if(Math.max(Math.abs(rx),Math.abs(ry))>w) continue;
      if(!on.has((x+rx)+","+(y+ry))){ edge=true; break; }
    }
    if(edge) out.push([x,y]);
  }
  return out;
}
export function sampleLayerTx(s){
  const out=[];
  const corners=[[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]].map(([u,v])=>unitToGrid(s,u,v));
  let mnx=Math.max(0,Math.floor(Math.min(...corners.map(p=>p[0]))));
  let mxx=Math.min(state.W-1,Math.ceil(Math.max(...corners.map(p=>p[0]))));
  let mny=Math.max(0,Math.floor(Math.min(...corners.map(p=>p[1]))));
  let mxy=Math.min(state.H-1,Math.ceil(Math.max(...corners.map(p=>p[1]))));
  for(let y=mny;y<=mxy;y++) for(let x=mnx;x<=mxx;x++){
    const [ux,uy]=gridToUnit(s,x+0.5,y+0.5);
    if(ux<-0.5||ux>0.5||uy<-0.5||uy>0.5) continue;
    const sx=Math.floor((ux+0.5)*s.sw), sy=Math.floor((uy+0.5)*s.sh);
    if(sx<0||sy<0||sx>=s.sw||sy>=s.sh) continue;
    const c=s.src[sy*s.sw+sx]; if(c===null) continue;
    out.push([x,y,c]);
  }
  return out;
}
export function shapeToPreview(){ state.previewCells=new Map();
  if(!state.activeShape) return;
  if(state.activeShape.kind==="layer"){ for(const [x,y,c] of sampleLayerTx(state.activeShape)) if(inBounds(x,y)) state.previewCells.set(x+","+y,c); return; }
  for(const [x,y] of rasterizeShape(state.activeShape))
    for(const [mx,my] of mirrorPoints(x,y)) if(inBounds(mx,my)) state.previewCells.set(mx+","+my,state.activeShape.color); }
export function addPixelLayerAbove(name){ const L=newLayer(name); state.layers.splice(state.active+1,0,L); state.active++; return L; }
export function bakeShape(){
  if(!state.activeShape) return;
  if(state.activeShape.kind==="layer"){ const L=state.activeShape.targetLayer; const nd=new Array(state.W*state.H).fill(null);
    for(const [x,y,c] of sampleLayerTx(state.activeShape)) if(inBounds(x,y)) nd[idx(x,y)]=c;
    L.data=nd; state.activeShape=null; state.txOp=null; state.previewCells=null; setHint(""); buildLayers(); render(); return; }
  snapshot();
  const names={rect:"Rectangle",ellipse:"Ellipse",triangle:"Triangle",diamond:"Losange",star:"Étoile",heart:"Cœur"};
  const L=addPixelLayerAbove(names[state.activeShape.type]||"Forme");
  const d=L.data;
  for(const [x,y] of rasterizeShape(state.activeShape))
    for(const [mx,my] of mirrorPoints(x,y)) if(inBounds(mx,my)) d[idx(mx,my)]=state.activeShape.color;
  state.activeShape=null; state.txOp=null; state.previewCells=null; setHint("");
  buildLayers(); render();
}
export function cancelShape(){ if(state.activeShape && state.activeShape.kind==="layer"){ state.activeShape.targetLayer.data=state.activeShape.fullData; }
  state.activeShape=null; state.txOp=null; state.previewCells=null; setHint(""); buildLayers(); render(); }
export function bakeIfAny(){ if(state.activeShape) bakeShape(); }
export function enterLayerTransform(){
  if(state.activeShape) bakeShape();
  if(state.textEditing) commitCanvasText();
  commitFloat(); state.sel=null;
  const L=state.layers[state.active];
  if(L.img){ showToast("« Transformer » s'applique aux calques de dessin, pas aux calques image.",{type:"warn"}); return; }
  if(L.locked){ showToast("Calque verrouillé — déverrouille-le dans ses options (⚙).",{type:"warn"}); return; }
  if(!L.data.some(v=>v!==null)){ setHint("Calque vide : rien à transformer."); return; }
  snapshot();
  bakeOffset(L);
  // cadre de transformation = boîte englobante des pixels dessinés, pas tout le canevas
  const full=L.data;
  let minx=state.W, miny=state.H, maxx=-1, maxy=-1;
  for(let y=0;y<state.H;y++) for(let x=0;x<state.W;x++){ if(full[y*state.W+x]!==null){
    if(x<minx)minx=x; if(x>maxx)maxx=x; if(y<miny)miny=y; if(y>maxy)maxy=y; } }
  const bw=maxx-minx+1, bh=maxy-miny+1;
  const src=new Array(bw*bh).fill(null);
  for(let y=0;y<bh;y++) for(let x=0;x<bw;x++) src[y*bw+x]=full[(miny+y)*state.W+(minx+x)];
  L.data=new Array(state.W*state.H).fill(null);
  state.activeShape={ kind:"layer", targetLayer:L, src, sw:bw, sh:bh, fullData:full,
    cx:minx+bw/2, cy:miny+bh/2, w:bw, h:bh, rot:0, skewX:0, skewY:0, filled:true, color:"#000" };
  shapeToPreview(); render();
  setHint("Transforme le calque · Entrée valide · Échap annule");
}
document.getElementById("transformLayer").onclick=enterLayerTransform;

// ---------- Pixelliser l'image (palette tirée de l'image ou noir & blanc, tramage au choix) ----------
// Le résultat est calculé et inséré comme calque d'aperçu dès l'ouverture de la modale, puis
// recalculé à chaque changement de réglage ; il n'est versé dans l'historique qu'à la validation.
// Étapes : rendu de l'image sur le canevas → moyenne par blocs → palette (médiane coupée sur les
// couleurs de l'image, ou noir & blanc) → association des blocs à la palette, avec tramage.
// diffusion d'erreur : [dx, dy, poids], diviseur
const DIFFUSION={
  floyd:  { div:16, k:[[1,0,7],[-1,1,3],[0,1,5],[1,1,1]] },
  atkinson:{ div:8,  k:[[1,0,1],[2,0,1],[-1,1,1],[0,1,1],[1,1,1],[0,2,1]] },
};
const pixelizeModal=document.getElementById("pixelizeModal");
let pixelizeTarget=null, pixelizePreview=null, pixelizePrevActive=0, pixelizeRaf=0;
let pixelizeCache=null;       // {px: pixels de l'image rendue, cells: {key,...}, pal: {key,...}}

function pixelizeParams(){
  return { block:Math.max(1,+document.getElementById("pxBlock").value||1),
           alphaThresh:+document.getElementById("pxAlpha").value||0,
           mode:document.getElementById("pxPalette").value,                 // "image" | "bw"
           colors:Math.max(2,Math.min(32,+document.getElementById("pxColors").value||8)),
           dither:document.getElementById("pxDither").value,                // none | bayer4 | bayer8 | floyd | atkinson
           strength:(+document.getElementById("pxStrength").value||0)/100 };
}
export function renderPixelizeSource(L){
  const off=document.createElement("canvas"); off.width=state.W; off.height=state.H; const g=off.getContext("2d");
  g.imageSmoothingEnabled=true;
  const im=L._imgEl, s=Math.min(state.W/im.naturalWidth,state.H/im.naturalHeight), w=im.naturalWidth*s, h=im.naturalHeight*s;
  g.drawImage(im,(state.W-w)/2+(L.ox||0),(state.H-h)/2+(L.oy||0),w,h);
  return g.getImageData(0,0,state.W,state.H).data;
}
// moyenne par bloc, pondérée par l'opacité ; les blocs trop transparents sont ignorés (a=0)
export function pixelizeCells(px,block,alphaThresh){
  const gw=Math.ceil(state.W/block), gh=Math.ceil(state.H/block);
  const rgb=new Float32Array(gw*gh*3), ok=new Uint8Array(gw*gh);
  for(let cy=0;cy<gh;cy++) for(let cx=0;cx<gw;cx++){
    const ey=Math.min(state.H,(cy+1)*block), ex=Math.min(state.W,(cx+1)*block);
    let sr=0,sg=0,sb=0,sa=0,n=0;
    for(let y=cy*block;y<ey;y++) for(let x=cx*block;x<ex;x++){ const i=(y*state.W+x)*4, a=px[i+3];
      sr+=px[i]*a; sg+=px[i+1]*a; sb+=px[i+2]*a; sa+=a; n++; }
    if(!sa || sa/n<alphaThresh) continue;
    const c=cy*gw+cx; ok[c]=1; rgb[c*3]=sr/sa; rgb[c*3+1]=sg/sa; rgb[c*3+2]=sb/sa;
  }
  return {gw,gh,rgb,ok};
}
// médiane coupée : N couleurs représentatives des blocs opaques de l'image
export function medianCutPalette(cells,n){
  const pts=[]; for(let c=0;c<cells.ok.length;c++) if(cells.ok[c]) pts.push(c);
  if(!pts.length) return [[0,0,0]];
  const rgb=cells.rgb;
  const range=idxs=>{ let mn=[255,255,255], mx=[0,0,0];
    for(const c of idxs) for(let k=0;k<3;k++){ const v=rgb[c*3+k]; if(v<mn[k])mn[k]=v; if(v>mx[k])mx[k]=v; }
    let best=0,bs=-1; for(let k=0;k<3;k++){ const r=mx[k]-mn[k]; if(r>bs){bs=r;best=k;} }
    return {ch:best, span:bs}; };
  let boxes=[{idxs:pts, ...range(pts)}];
  while(boxes.length<n){
    let bi=-1,bsc=0; boxes.forEach((b,i)=>{ const sc=b.span*Math.sqrt(b.idxs.length); if(b.idxs.length>1 && b.span>0 && sc>bsc){bsc=sc;bi=i;} });
    if(bi<0) break;                                  // plus rien à séparer : moins de couleurs que demandé
    const b=boxes[bi], ch=b.ch;
    b.idxs.sort((p,q)=>rgb[p*3+ch]-rgb[q*3+ch]);
    const mid=b.idxs.length>>1, A=b.idxs.slice(0,mid), B=b.idxs.slice(mid);
    boxes.splice(bi,1,{idxs:A,...range(A)},{idxs:B,...range(B)});
  }
  return boxes.map(b=>{ let r=0,g=0,bl=0; for(const c of b.idxs){ r+=rgb[c*3]; g+=rgb[c*3+1]; bl+=rgb[c*3+2]; }
    const m=b.idxs.length; return [Math.round(r/m),Math.round(g/m),Math.round(bl/m)]; });
}
export const toHex=([r,g,b])=>"#"+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,"0")).join("").toUpperCase();
function pixelizeData(L,p){
  if(!pixelizeCache || pixelizeCache.layer!==L) pixelizeCache={layer:L, px:renderPixelizeSource(L), cells:null, pal:null};
  const C=pixelizeCache;
  const ckey=p.block+"|"+p.alphaThresh;
  if(!C.cells || C.cells.key!==ckey){ C.cells={key:ckey, ...pixelizeCells(C.px,p.block,p.alphaThresh)}; C.pal=null; }
  const {gw,gh,ok}=C.cells; let rgb=C.cells.rgb;
  const bw=p.mode==="bw";
  if(bw){ rgb=Float32Array.from(rgb); for(let c=0;c<ok.length;c++) if(ok[c]){   // niveaux de gris (luminance)
      const l=0.299*rgb[c*3]+0.587*rgb[c*3+1]+0.114*rgb[c*3+2]; rgb[c*3]=rgb[c*3+1]=rgb[c*3+2]=l; } }
  const pkey=bw?"bw":("img|"+p.colors);
  if(!C.pal || C.pal.key!==pkey) C.pal={key:pkey, list: bw ? [[0,0,0],[255,255,255]] : medianCutPalette(C.cells,p.colors)};
  const pal=C.pal.list, np=pal.length;
  const nearest=(r,g,b)=>{ let best=0,bd=1e12;
    for(let q=0;q<np;q++){ const dr=r-pal[q][0],dg=g-pal[q][1],db=b-pal[q][2], dd=dr*dr+dg*dg+db*db; if(dd<bd){bd=dd;best=q;} }
    return best; };
  const out=new Int16Array(gw*gh).fill(-1);
  const spread = bw ? 255 : 255/Math.max(1,Math.cbrt(np));      // amplitude du seuil du tramage ordonné
  if(p.dither==="floyd" || p.dither==="atkinson"){
    const D=DIFFUSION[p.dither], w=new Float32Array(rgb);       // copie de travail qui reçoit l'erreur
    for(let cy=0;cy<gh;cy++) for(let cx=0;cx<gw;cx++){ const c=cy*gw+cx; if(!ok[c]) continue;
      const r=w[c*3],g=w[c*3+1],b=w[c*3+2], q=nearest(Math.max(0,Math.min(255,r)),Math.max(0,Math.min(255,g)),Math.max(0,Math.min(255,b)));
      out[c]=q;
      const er=(r-pal[q][0])*p.strength, eg=(g-pal[q][1])*p.strength, eb=(b-pal[q][2])*p.strength;
      for(const [dx,dy,wt] of D.k){ const nx=cx+dx, ny=cy+dy; if(nx<0||nx>=gw||ny>=gh) continue; const t=ny*gw+nx; if(!ok[t]) continue;
        const f=wt/D.div; w[t*3]+=er*f; w[t*3+1]+=eg*f; w[t*3+2]+=eb*f; }
    }
  } else {
    const M = p.dither==="bayer8" ? BAYER8 : p.dither==="bayer4" ? BAYER4 : null, n=M?M.length:0;
    for(let cy=0;cy<gh;cy++) for(let cx=0;cx<gw;cx++){ const c=cy*gw+cx; if(!ok[c]) continue;
      let r=rgb[c*3],g=rgb[c*3+1],b=rgb[c*3+2];
      if(M){ const d=((M[cy%n][cx%n]+0.5)/(n*n)-0.5)*spread*p.strength; r+=d; g+=d; b+=d; }
      out[c]=nearest(Math.max(0,Math.min(255,r)),Math.max(0,Math.min(255,g)),Math.max(0,Math.min(255,b)));
    }
  }
  const hexes=pal.map(toHex), nd=new Array(state.W*state.H).fill(null), block=p.block;
  for(let y=0;y<state.H;y++){ const row=((y/block)|0)*gw;
    for(let x=0;x<state.W;x++){ const q=out[row+((x/block)|0)]; if(q>=0) nd[y*state.W+x]=hexes[q]; } }
  return { data:nd, colors:np };
}
// recalcul groupé sur une frame : le curseur reste fluide même sur un grand canevas
function refreshPixelizePreview(){
  if(!pixelizeTarget || !pixelizePreview) return;
  if(pixelizeRaf) return;
  pixelizeRaf=requestAnimationFrame(()=>{ pixelizeRaf=0;
    if(!pixelizeTarget || !pixelizePreview) return;
    pixelizePreview.data=pixelizeData(pixelizeTarget,pixelizeParams()).data;
    state.thumbsDirty=true; buildLayers(); render();
  });
}
function removePixelizePreview(){
  if(!pixelizePreview) return;
  const i=state.layers.indexOf(pixelizePreview);
  if(i>=0) state.layers.splice(i,1);
  state.active=Math.min(pixelizePrevActive,state.layers.length-1);
  pixelizePreview=null;
}
function closePixelize(){
  if(pixelizeRaf){ cancelAnimationFrame(pixelizeRaf); pixelizeRaf=0; }
  removePixelizePreview();
  pixelizeTarget=null; pixelizeCache=null;
  pixelizeModal.classList.remove("open");
  state.thumbsDirty=true; buildLayers(); render();
}
function openPixelizeModal(){
  const L=state.layers[state.active];
  if(!L.img || !L._imgEl || !L._imgEl.complete || !L._imgEl.naturalWidth){ showToast("Sélectionne un calque image à pixelliser.",{type:"warn"}); return; }
  pixelizeTarget=L; pixelizePrevActive=state.active; pixelizeCache=null; syncPixelizeControls();
  pixelizePreview=newLayer("Pixellisé");
  pixelizePreview.groupId=L.groupId||null;
  state.layers.splice(state.active+1,0,pixelizePreview); state.active++;
  pixelizeModal.classList.add("open");
  pixelizePreview.data=pixelizeData(L,pixelizeParams()).data;
  state.thumbsDirty=true; buildLayers(); render();
}
document.getElementById("pixelizeLayer").onclick=openPixelizeModal;
document.getElementById("pixelizeClose").onclick=closePixelize;
document.getElementById("pixelizeCancel").onclick=closePixelize;
pixelizeModal.addEventListener("click",e=>{ if(e.target.id==="pixelizeModal") closePixelize(); });
// Échap = annuler (capture : on court-circuite le gestionnaire général des modales)
window.addEventListener("keydown",e=>{
  if(e.key==="Escape" && pixelizeModal.classList.contains("open")){ e.stopPropagation(); closePixelize(); }
},true);
document.getElementById("pxBlock").oninput=e=>{ document.getElementById("pxBlockV").textContent=e.target.value+" px"; refreshPixelizePreview(); };
function syncPixelizeControls(){
  const p=pixelizeParams();
  document.getElementById("pxColorsRow").hidden=p.mode!=="image";
  document.getElementById("pxStrengthRow").hidden=p.dither==="none";
  document.getElementById("pxColorsV").textContent=p.colors;
  document.getElementById("pxStrengthV").textContent=Math.round(p.strength*100)+" %";
}
["pxAlpha","pxColors","pxStrength"].forEach(id=>document.getElementById(id).oninput=()=>{ syncPixelizeControls(); refreshPixelizePreview(); });
["pxPalette","pxDither"].forEach(id=>document.getElementById(id).onchange=()=>{ syncPixelizeControls(); refreshPixelizePreview(); });
document.getElementById("pixelizeOk").onclick=()=>{
  if(!pixelizeTarget || !pixelizePreview){ closePixelize(); return; }
  if(pixelizeRaf){ cancelAnimationFrame(pixelizeRaf); pixelizeRaf=0; }
  const p=pixelizeParams();
  const res=pixelizeData(pixelizeTarget,p);          // état final, calculé sur les réglages courants
  const L=pixelizeTarget, layer=pixelizePreview;
  removePixelizePreview();                            // on retire l'aperçu…
  snapshot("Pixellisation");                          // …pour que l'annulation revienne à l'avant-modale
  const li=state.layers.indexOf(L);
  layer.data=res.data;
  state.layers.splice(li+1,0,layer); state.active=li+1;
  pixelizePreview=null; pixelizeTarget=null;
  pixelizeModal.classList.remove("open");
  state.thumbsDirty=true; buildLayers(); render();
  pixelizeCache=null;
  showToast("Image pixellisée ("+(p.mode==="bw"?"noir et blanc":res.colors+" couleurs")+", bloc "+p.block+" px"+(p.dither!=="none"?", tramage":"")+").",{type:"success"});
};

// handles (coordonnées écran = grille × zoom)
export function handlePoints(s){
  const g=(u,v)=>{const[x,y]=unitToGrid(s,u,v);return[x*state.zoom,y*state.zoom];};
  const t=g(0,-0.5),ce=g(0,0); const dx=t[0]-ce[0],dy=t[1]-ce[1],L=Math.hypot(dx,dy)||1;
  return { corners:{tl:g(-0.5,-0.5),tr:g(0.5,-0.5),br:g(0.5,0.5),bl:g(-0.5,0.5)},
           edges:{t:g(0,-0.5),r:g(0.5,0),b:g(0,0.5),l:g(-0.5,0)},
           rot:[t[0]+dx/L*24,t[1]+dy/L*24] };
}
export function drawTransform(){
  if(!state.activeShape) return;
  const P=handlePoints(state.activeShape); const c=P.corners;
  octx.save();
  octx.strokeStyle="#3d6bff"; octx.lineWidth=1.5; octx.setLineDash([5,4]);
  octx.beginPath(); octx.moveTo(c.tl[0],c.tl[1]); octx.lineTo(c.tr[0],c.tr[1]);
  octx.lineTo(c.br[0],c.br[1]); octx.lineTo(c.bl[0],c.bl[1]); octx.closePath(); octx.stroke();
  octx.setLineDash([]);
  octx.beginPath(); octx.moveTo(P.edges.t[0],P.edges.t[1]); octx.lineTo(P.rot[0],P.rot[1]); octx.stroke();
  const dot=(p,col)=>{ octx.beginPath(); octx.arc(p[0],p[1],4.5,0,7); octx.fillStyle=col; octx.fill();
    octx.lineWidth=1.5; octx.strokeStyle="#fff"; octx.stroke(); };
  Object.values(c).forEach(p=>dot(p,"#ffcc00"));
  Object.values(P.edges).forEach(p=>dot(p,"#3d6bff"));
  dot(P.rot,"#00E676");
  octx.restore();
}
export function hitHandle(sx,sy){
  const P=handlePoints(state.activeShape),R=10;
  const near=p=>Math.hypot(sx-p[0],sy-p[1])<=R;
  if(near(P.rot)) return {op:"rotate"};
  for(const k in P.corners) if(near(P.corners[k])) return {op:"scale"};
  for(const k in P.edges) if(near(P.edges[k])) return {op:"edge",edge:k};
  const u=gridToUnit(state.activeShape,sx/state.zoom,sy/state.zoom);
  if(Math.abs(u[0])<=0.5&&Math.abs(u[1])<=0.5) return {op:"move"};
  return null;
}

