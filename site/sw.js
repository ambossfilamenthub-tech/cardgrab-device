// CardGrab Device – Offline-Cache. App-Dateien & Texterkennung: Cache zuerst; Preise & Seite: Netz zuerst.
const V = "cgd-v56";
const CORE = ["./", "index.html", "legal.html", "app.js", "lib/cards.js", "lib/ygo.js", "lib/collection.js", "lib/sounds.js", "lib/cardfind.js", "lib/manage.js", "lib/extras.js", "lib/center.js", "lib/jp.js", "lib/fp.js", "lib/scanfp.js", "lib/ui.js", "ui.css", "lib/tesseract.min.js", "lib/worker.min.js", "carddb.json", "opdb.json",
  "cardgrab-logo-sm.webp", "cardgrab-logo-md.webp", "manifest.webmanifest", "icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if(e.request.method !== "GET" || u.origin !== location.origin) return;
  const netFirst = /prices-|version\.json|index\.html$|\/$|app\.js$|cards\.js$|ygo\.js$|collection\.js$|sounds\.js$|cardfind\.js$|manage\.js$|extras\.js$|center\.js$|jp\.js$|fp\.js$|ui\.js$|ui\.css$|sw\.js$/.test(u.pathname);
  // große Daten, die sich ändern: sofort aus dem Speicher, im Hintergrund aktualisieren
  if(/ygodb\.json|jpdb\.json|fp-[a-z]+\.json|op-de\.json|\/ygotext\/|\/facts\//.test(u.pathname)){
    e.respondWith(caches.open(V).then(async x => {
      const m = await x.match(e.request);
      const f = fetch(e.request).then(r => { if(r.ok) x.put(e.request, r.clone()); return r; }).catch(() => m);
      if(m){ e.waitUntil(f); return m; }
      return f;
    }));
    return;
  }
  if(netFirst){
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => { if(r.ok){ const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); } return r; })));
  }
});
