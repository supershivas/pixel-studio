// ---------- Encodeurs d'animation : GIF89a et APNG (sans dépendance) ----------
// Module feuille : aucun import, utilisable depuis n'importe où.

const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return t;})();
export function crc32(u8,start=0,end=u8.length){ let c=0xFFFFFFFF; for(let i=start;i<end;i++) c=CRC_TABLE[(c^u8[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }

// ---------- GIF ----------
// frames : [{rgba:Uint8ClampedArray (w×h×4, taille d'origine), delay:ms}]
// opts : {w,h,scale,bg:[r,g,b]|null, quantize:(colors:[r,g,b][], n)=>[r,g,b][]}
export function encodeGIF(frames,{w,h,scale,bg,quantize}){
  // 1) couleurs distinctes (alpha < 128 = transparent, sauf si un fond est demandé)
  const counts=new Map(); let hasAlpha=false;
  const keyOf=(r,g,b)=>(r<<16)|(g<<8)|b;
  const pixelKey=(d,i)=>{ const a=d[i+3];
    if(a<128){ if(!bg){ hasAlpha=true; return -1; } return keyOf(bg[0],bg[1],bg[2]); }
    if(a<255 && bg){ const t=a/255; return keyOf(Math.round(d[i]*t+bg[0]*(1-t)),Math.round(d[i+1]*t+bg[1]*(1-t)),Math.round(d[i+2]*t+bg[2]*(1-t))); }
    return keyOf(d[i],d[i+1],d[i+2]); };
  const keysPerFrame=frames.map(f=>{ const d=f.rgba, keys=new Int32Array(w*h);
    for(let p=0;p<w*h;p++){ const k=pixelKey(d,p*4); keys[p]=k; if(k>=0) counts.set(k,(counts.get(k)||0)+1); }
    return keys; });
  const maxColors=hasAlpha?255:256;
  let colors=[...counts.keys()].map(k=>[(k>>16)&255,(k>>8)&255,k&255]);
  const keyList=[...counts.keys()];
  const indexOfKey=new Map();
  if(colors.length>maxColors){
    colors=quantize(colors,maxColors);
    keyList.forEach(k=>{ const r=(k>>16)&255,g=(k>>8)&255,b=k&255; let best=0,bd=1e12;
      colors.forEach((c,i)=>{ const d=(r-c[0])**2+(g-c[1])**2+(b-c[2])**2; if(d<bd){bd=d;best=i;} }); indexOfKey.set(k,best); });
  } else keyList.forEach((k,i)=>indexOfKey.set(k,i));
  const off=hasAlpha?1:0;                                    // l'indice 0 est réservé à la transparence
  const table=[]; if(hasAlpha) table.push([0,0,0]); colors.forEach(c=>table.push(c));
  if(!table.length) table.push([0,0,0]);
  let bits=1; while((1<<bits)<table.length) bits++;
  while(table.length<(1<<bits)) table.push([0,0,0]);
  const minCode=Math.max(2,bits);

  // 2) flux
  const out=[]; const u16=v=>out.push(v&255,(v>>8)&255); const str=s=>{ for(const ch of s) out.push(ch.charCodeAt(0)); };
  const W=w*scale, H=h*scale;
  str("GIF89a"); u16(W); u16(H); out.push(0x80|(7<<4)|(bits-1),0,0);
  table.forEach(c=>out.push(c[0],c[1],c[2]));
  out.push(0x21,0xFF,11); str("NETSCAPE2.0"); out.push(3,1,0,0,0);        // boucle infinie
  frames.forEach((f,fi)=>{
    const keys=keysPerFrame[fi];
    const delay=Math.max(2,Math.round(f.delay/10));
    out.push(0x21,0xF9,4,(hasAlpha?2<<2:1<<2)|(hasAlpha?1:0)); u16(delay); out.push(hasAlpha?0:0,0);
    out.push(0x2C); u16(0);u16(0);u16(W);u16(H); out.push(0);
    const idx=new Uint8Array(W*H);
    for(let y=0;y<h;y++){
      const row=y*scale*W;
      for(let x=0;x<w;x++){ const k=keys[y*w+x], v=k<0?0:indexOfKey.get(k)+off;
        for(let s=0;s<scale;s++) idx[row+x*scale+s]=v; }
      for(let s=1;s<scale;s++) idx.copyWithin(row+s*W,row,row+W);
    }
    out.push(minCode);
    const data=lzw(idx,minCode);
    for(let p=0;p<data.length;p+=255){ const n=Math.min(255,data.length-p); out.push(n); for(let q=0;q<n;q++) out.push(data[p+q]); }
    out.push(0);
  });
  out.push(0x3B);
  return new Uint8Array(out);
}
function lzw(idx,minCode){
  const clear=1<<minCode, eoi=clear+1; let size=minCode+1, next=eoi+1, dict=new Map();
  const bytes=[]; let cur=0,nb=0;
  const emit=c=>{ cur|=c<<nb; nb+=size; while(nb>=8){ bytes.push(cur&255); cur>>>=8; nb-=8; } };
  emit(clear);
  let prefix=idx[0];
  for(let i=1;i<idx.length;i++){
    const k=idx[i], key=(prefix<<8)|k, hit=dict.get(key);
    if(hit!==undefined){ prefix=hit; continue; }
    emit(prefix);
    if(next<4096){ dict.set(key,next); if(next===(1<<size)) size++; next++; }
    else { emit(clear); dict=new Map(); size=minCode+1; next=eoi+1; }
    prefix=k;
  }
  emit(prefix); emit(eoi);
  if(nb>0) bytes.push(cur&255);
  return bytes;
}

// ---------- APNG ----------
// frames : [{rgba:Uint8ClampedArray (W×H×4), delay:ms}] ; W,H = taille finale en pixels
async function zlib(u8){
  if(typeof CompressionStream==="undefined") throw new Error("compression indisponible dans ce navigateur");
  const buf=await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer();
  return new Uint8Array(buf);
}
export async function encodeAPNG(frames,W,H){
  const parts=[new Uint8Array([137,80,78,71,13,10,26,10])];
  const chunk=(type,data)=>{ const b=new Uint8Array(12+data.length), dv=new DataView(b.buffer);
    dv.setUint32(0,data.length); for(let i=0;i<4;i++) b[4+i]=type.charCodeAt(i); b.set(data,8);
    dv.setUint32(8+data.length,crc32(b,4,8+data.length)); parts.push(b); };
  const u32=(...v)=>{ const b=new Uint8Array(v.length*4), dv=new DataView(b.buffer); v.forEach((x,i)=>dv.setUint32(i*4,x)); return b; };
  const ihdr=new Uint8Array(13); new DataView(ihdr.buffer).setUint32(0,W); new DataView(ihdr.buffer).setUint32(4,H); ihdr.set([8,6,0,0,0],8);
  chunk("IHDR",ihdr); chunk("acTL",u32(frames.length,0));
  let seq=0;
  for(let i=0;i<frames.length;i++){
    const f=frames[i];
    const fc=new Uint8Array(26), dv=new DataView(fc.buffer);
    dv.setUint32(0,seq++); dv.setUint32(4,W); dv.setUint32(8,H); dv.setUint32(12,0); dv.setUint32(16,0);
    dv.setUint16(20,Math.max(1,Math.round(f.delay))); dv.setUint16(22,1000); fc[24]=0; fc[25]=0;   // dispose none, blend source
    chunk("fcTL",fc);
    const raw=new Uint8Array((W*4+1)*H);
    for(let y=0;y<H;y++){ raw[y*(W*4+1)]=0; raw.set(f.rgba.subarray(y*W*4,(y+1)*W*4),y*(W*4+1)+1); }
    const z=await zlib(raw);
    if(i===0) chunk("IDAT",z);
    else { const d=new Uint8Array(4+z.length); new DataView(d.buffer).setUint32(0,seq++); d.set(z,4); chunk("fdAT",d); }
  }
  chunk("IEND",new Uint8Array(0));
  return new Blob(parts,{type:"image/png"});
}
