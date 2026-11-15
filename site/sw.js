// CardGrab Device – Offline-Cache. App-Dateien & Texterkennung: Cache zuerst; Preise & Seite: Netz zuerst.
const V = "cgd-v14";
const CORE = ["./", "index.html", "app.js", "lib/cards.js", "lib/tesseract.min.js", "lib/worker.min.js", "carddb.json", "opdb.json",
  "cardgrab-logo-sm.webp", "cardgrab-logo-md.webp", "manifest.webmanifest", "icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if(e.request.method !== "GET" || u.origin !== location.origin) return;
  const netFirst = /prices-|version\.json|index\.html$|\/$|app\.js$|cards\.js$|sw\.js$/.test(u.pathname);
  if(netFirst){
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => { if(r.ok){ const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); } return r; })));
  }
});
