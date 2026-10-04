// Service worker de Pixel Studio : l'app s'ouvre aussi hors ligne.
// Stratégie « réseau d'abord » (revalidé, jamais le cache HTTP de 10 min de GitHub Pages) avec repli sur
// la copie locale. Le build figure dans l'URL d'enregistrement (?b=…) : un nouveau build = nouveau cache,
// l'ancien est supprimé à l'activation.
const BUILD=new URL(self.location).searchParams.get("b")||"dev";
const CACHE="pixel-studio-"+BUILD;
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("pixel-studio-")&&k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  const req=e.request;
  if(req.method!=="GET" || new URL(req.url).origin!==location.origin) return;
  e.respondWith(
    fetch(req,{cache:"no-cache"}).then(res=>{
      if(res.ok){ const copy=res.clone(); caches.open(CACHE).then(c=>c.put(req,copy)); }
      return res;
    }).catch(()=>caches.match(req).then(m=>m||caches.match("./")||caches.match("index.html")))
  );
});
