// CardGrab Device – Erkennung auf dem Gerät (Kamera + Texterkennung), Preise aus der täglichen Cardmarket-Liste,
// Sammlung lokal im Browser (IndexedDB). Karten-Logik (Datenbank, Links) kommt aus lib/cards.js.
"use strict";
const $ = id => document.getElementById(id);
const eur = n => (typeof n === "number" && isFinite(n) && n > 0) ? n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: n < 10 ? 2 : 0 }) : "–";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------- Tabs ----------------
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => showTab(b.dataset.tab));
function showTab(t){
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  $("scan").hidden = t !== "scan"; $("coll").hidden = t !== "coll";
  if(t === "coll") renderColl();
}
function toast(t){ const el = $("toast"); el.textContent = t; el.classList.remove("act"); el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2200); }

// ---------------- Preise (tägliche Cardmarket-Liste) ----------------
let PP = null, OPP = null;
const pricesReady = Promise.all([
  fetch("prices-pokemon.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null),
  fetch("prices-onepiece.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null)
]).then(([a, b]) => {
  PP = a; OPP = b;
  const d = (a && a.date) || (b && b.date);
  const pill = $("pricePill");
  if(d){ pill.textContent = "Preise " + new Date(d + "T12:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }); pill.classList.add("ok"); }
  else pill.textContent = "Keine Preisliste";
  coll.forEach(c => attachPrice(c)); refreshTotals();
});
YGO_HOOKS.prices.push(d => { if(!d) return; coll.forEach(c => { if(c.ygo){ attachPrice(c); rerender(c); } }); refreshTotals(); });
// Preis an Karte hängen: {low, trend, avg7, avg30, holo:{…}, src}
function attachPrice(c){
  if(c.ygo) return ygoAttachPrice(c);
  if(c.jp) return jpPrice(c);
  if(c.op){
    const vs = (OPP && OPP.c && OPP.c[c.op.id]) || [];
    c.versions = vs.map(v => ({ id: v[0], low: v[1], trend: v[2], avg7: v[3], avg30: v[4], guess: !!v[5], pack: v[6] || "", exp: v[7] ?? "", cm: v[8] || "" }));
    const i = Math.min(c.vi || 0, Math.max(0, c.versions.length - 1));
    const v = c.versions[i];
    c.price = v ? { low: v.low, trend: v.trend, avg7: v.avg7, avg30: v.avg30, id: v.id } : null;
  } else if(c.db && c.db.cm && PP && PP.p){
    const p = PP.p[c.db.cm];
    c.price = p ? { low: p[0], trend: p[1], avg1: p[2], avg7: p[3], avg30: p[4], lowH: p[5], trendH: p[6], avg30H: p[7], id: c.db.cm } : null;
  } else c.price = null;
  return c;
}
// Wert = "ab"-Preis (günstigstes Angebot); nur wenn keiner da ist: Trend
const valueOf = c => { if(c.real > 0) return c.real; const p = c.price; if(!p) return 0; if(c.rh && (p.lowH || p.trendH)) return p.lowH || p.trendH; return p.low || p.trend || p.avg30 || 0; };

// ---------------- Offizielles Kartenbild (statt Handyfoto in der Vorschau) ----------------
// Pokémon: TCGdex (deutsch, sonst englisch) · One Piece: Limitless-Bildarchiv · Yu-Gi-Oh!: YGOPRODeck
async function findImg(c){
  // eigene, gespeicherte Bilder zuerst (img/…), sonst direkt von der Quelle
  // Bilder werden nur verlinkt (nicht selbst gespeichert) – Rechte liegen bei den Herausgebern
  if(c.jp) return jpImg(c);
  if(c.ygo) return `https://images.ygoprodeck.com/images/cards_small/${ygoVerPc(c, c.vi || 0)}.jpg`;
  if(c.op) return [...cmImgs(c.versions && c.versions[Math.min(c.vi || 0, c.versions.length - 1)]), opImgUrl(c)].join(" ");
  if(c.db && c.db.sid){
    const langs = langShort(c) === "DE" ? ["de", "en"] : ["en", "de"];
    for(const l of langs){
      try{
        const r = await fetch(`https://api.tcgdex.net/v2/${l}/cards/${encodeURIComponent(c.db.sid + "-" + c.db.lid)}`);
        if(r.ok){ const d = await r.json(); if(d && d.image) return d.image + "/low.webp"; }
      }catch{}
    }
  }
  return "";
}
// One Piece: Bildname der gewählten Version (Parallel/Alt Art = _p1, _p2 …)
function opVariants(c){ const e = OPDB && OPDB.cards[c.op.id]; if(!e) return [""]; const l = (c.op.jp ? e[13] : e[12]) || e[12] || []; const s = [...new Set(["", ...l.map(v => v[0] || "")])]; return s; }
// Welches Motiv gehört zu welcher Cardmarket-Version (V1, V2 …)?
// Versionen einer Erweiterung (nach Produkt-ID) ↔ Bilder desselben Sets (normal, Parallel _p1, _p2 …).
// Englische und japanische Erweiterung haben dieselben Motive -> wiederholt (V1 normal, V2 Parallel, V3 normal …).
function opVerSufs(c){
  const vs = c.versions || [], e = OPDB && c.op && OPDB.cards[c.op.id];
  if(!e || !vs.length) return null;
  const raw = (c.op.jp ? e[13] : e[12]) || e[12] || [], byPack = new Map();
  const add = (suf, pk) => { pk = pk || e[11]; if(!byPack.has(pk)) byPack.set(pk, []); const l = byPack.get(pk); if(!l.includes(suf)) l.push(suf); };
  add("", e[11]); for(const v of raw) if(v[0]) add(v[0], v[1]);
  const groups = new Map();
  vs.forEach((v, i) => { const k = v.exp !== "" && v.exp != null ? "e" + v.exp : "p" + v.pack; if(!groups.has(k)) groups.set(k, { pack: v.pack, idx: [] }); groups.get(k).idx.push(i); });
  const verPacks = new Set(vs.map(v => v.pack)), free = [...byPack.keys()].filter(p => !verPacks.has(p));
  const out = new Array(vs.length);
  // Versionen ohne eigenes Bild-Set (z. B. Reprint-Sets wie PRB01, bei Cardmarket anders benannt):
  // passendes übriges Bild-Set mit gleicher Anzahl, zusammenhängende Produkt-IDs zuerst – als „≈“ markiert
  const spread = g => Math.max(...g.idx.map(i => vs[i].id)) - Math.min(...g.idx.map(i => vs[i].id));
  const take = new Map();
  for(const g of [...groups.values()].filter(g => !byPack.has(g.pack)).sort((a, b) => spread(a) - spread(b))){
    const j = free.findIndex(p => byPack.get(p).length === g.idx.length); if(j >= 0){ take.set(g, byPack.get(free[j])); free.splice(j, 1); }
  }
  for(const g of groups.values()){
    let l = byPack.get(g.pack), approx = false;
    if(!l){ l = take.get(g); approx = true; }
    if(!l){ l = [""]; approx = true; }
    const odd = g.idx.length % l.length !== 0;
    g.idx.forEach((i, r) => { out[i] = { suf: l[r % l.length], approx: approx || odd }; });
  }
  return out;
}
function opImgName(c, suf){
  if(suf === undefined){ const m = opVerSufs(c); suf = m ? (m[Math.min(c.vi || 0, m.length - 1)] || {}).suf || "" : ""; }
  return `${c.op.id}${suf ? "_" + suf : ""}_${c.op.jp && !suf ? "JP" : "EN"}`;
}
function opImgUrl(c, suf){ const set = c.op.id.startsWith("P-") ? "P" : c.op.id.split("-")[0]; return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/one-piece/${set}/${opImgName(c, suf)}.webp`; }
// Bild + „ähnlich?“ für jede Version (für die Auswahl-Kacheln)
// Original-Bild der Cardmarket-Version (Pfad „1621/OP16“ aus der Preisliste), sonst Bildarchiv
// Cardmarket-Produktbilder sind gegen Einbinden in fremde Seiten geschützt (laden nur auf cardmarket.com) –
// daher nur, falls die Preisliste einmal einen freigegebenen Bildpfad liefert (v.cm); sonst Bildarchiv.
const cmImgs = (v) => v && v.cm ? [`https://product-images.s3.cardmarket.com/${v.cm}/${v.id}/${v.id}.jpg`] : [];
function verImgs(c){
  if(c.op){ const m = opVerSufs(c); return m ? m.map((x, i) => { const cm = cmImgs(c.versions[i]), arc = opImgUrl(c, x.suf); return cm.length ? { url: cm[0], alt: [...cm.slice(1), arc].join(" "), approx: x.approx, late: true } : { url: arc, approx: x.approx }; }) : null; }
  if(c.ygo && c.versions) return c.versions.map((v, i) => { const pc = ygoVerPc(c, i); return { url: `https://images.ygoprodeck.com/images/cards_small/${pc}.jpg`, approx: false }; });
  return null;
}
const imgSrc = c => { const l = String(c.img || "").split(" ").filter(u => !u.startsWith("img/")); return l[0] || ""; };
const imgFallback = c => [...String(c.img || "").split(" ").filter(u => !u.startsWith("img/")).slice(1), c.thumb || "-"].join(" ");
// Version per Bildvergleich wählen (One Piece: normal / Parallel / Alt Art haben verschiedene Motive)
const loadImg = u => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u; });
function imgVec(im){
  // Bildmitte (Motiv) klein rechnen, Farbe normiert -> Vergleich unabhängig von Helligkeit
  const W = 12, H = 14, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(im, im.width * 0.1, im.height * 0.12, im.width * 0.8, im.height * 0.5, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data, v = [];
  for(let ch = 0; ch < 3; ch++){ const a = []; for(let i = ch; i < d.length; i += 4) a.push(d[i]); const m = a.reduce((s, x) => s + x, 0) / a.length; const sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length) || 1; a.forEach(x => v.push((x - m) / sd)); }
  return v;
}
const cosSim = (a, b) => { let s = 0; for(let i = 0; i < a.length; i++) s += a[i] * b[i]; return s / a.length; };
async function guessOpVariant(c){
  return;   // abgeschaltet: braucht selbst gespeicherte Bilder (aus rechtlichen Gründen entfernt)
  if(!c.op || !c.thumb || !c.versions || c.versions.length < 2) return;
  const vs = opVariants(c); if(vs.length !== c.versions.length) return;
  try{
    const ref = imgVec(await loadImg(c.thumb));
    const sc = [];
    for(const suf of vs){ try{ sc.push(cosSim(ref, imgVec(await loadImg(`img/op/${opImgName(c, suf)}.webp`)))); }catch{ return; } }
    const order = sc.map((x, i) => [x, i]).sort((a, b) => b[0] - a[0]);
    if(order[0][0] < 0.25 || order[0][0] - order[1][0] < 0.08) return;   // nicht eindeutig -> Auswahl bleibt beim Nutzer
    if(order[0][1] !== (c.vi || 0)){
      c.vi = order[0][1]; c.vAuto = 1; delete c.img; attachPrice(c); saveCard(c); rerender(c); refreshTotals(); ensureImg(c);
      toast(`✓ ${c.name}: Version V${c.vi + 1} am Bild erkannt`);
    }
  }catch{}
}
const IMG_BUSY = new Set();
async function ensureImg(c){
  if(c.img !== undefined || IMG_BUSY.has(c.id) || !navigator.onLine) return;
  IMG_BUSY.add(c.id);
  try{
    const u = await findImg(c);
    if(!u) return;   // später nochmal versuchen
    c.img = u; saveCard(c); rerender(c);
  } finally { IMG_BUSY.delete(c.id); }
}
// Tippen aufs Kartenbild: groß anzeigen
const bigImg = u => u.replace(/\/low\.webp$/, "/high.webp").replace("/cards_small/", "/cards/")
  .replace(/^.*\/img\/ygo\/(\d+)\.webp$/, "https://images.ygoprodeck.com/images/cards/$1.jpg")
  .replace(/^.*\/img\/op\/(((?:OP|ST|EB|PRB)\d+|P)-[^_]+(?:_p\d+)?_(?:EN|JP))\.webp$/, (m, n, set) => `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/one-piece/${set}/${n}.webp`);
document.addEventListener("click", e => {
  const im = e.target.closest("img.card-img"); if(!im) return;
  e.stopPropagation();
  const ov = document.createElement("div"); ov.className = "bigimg";
  ov.innerHTML = `<img src="${esc(bigImg(im.src))}" alt="" referrerpolicy="no-referrer"><small>Tippen zum Schließen</small>`;
  ov.onclick = () => ov.remove(); document.body.appendChild(ov);
}, true);
// Versions-Bild fehlt -> Kachel ohne Bild
document.addEventListener("error", e => {
  const im = e.target; if(!(im instanceof HTMLImageElement) || !im.classList.contains("vti")) return;
  const l = (im.dataset.alt || "").split(" ").filter(Boolean);
  if(!l.length){ im.classList.add("gone"); return; }
  im.dataset.alt = l.slice(1).join(" "); im.src = l[0];
  if(!/cardmarket\.com/.test(l[0])){ const q = im.parentNode.querySelector("em.q"); if(q) q.hidden = false; }   // Bildarchiv statt Original
}, true);
// Bild konnte nicht geladen werden -> eigenes Foto zeigen
document.addEventListener("error", e => {
  const im = e.target; if(!(im instanceof HTMLImageElement) || !im.dataset.fallback) return;
  const list = im.dataset.fallback.split(" "), fb = list.shift();
  if(list.length) im.dataset.fallback = list.join(" "); else im.removeAttribute("data-fallback");
  if(!fb || fb === "-") im.replaceWith(Object.assign(document.createElement("div"), { className: "thumb" })); else im.src = fb;
}, true);

// ---------------- Sammlung (IndexedDB, nur auf diesem Gerät) ----------------
let coll = [];
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open("cardgrab-device", 1); r.onupgradeneeded = () => r.result.createObjectStore("cards", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("cards", mode); const s = t.objectStore("cards"); const out = fn(s); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); }); };
  return { all: () => tx("readonly", s => s.getAll()), put: it => tx("readwrite", s => s.put(it)), del: id => tx("readwrite", s => s.delete(id)) };
})();
const persistable = c => { const o = { ...c }; delete o.price; delete o.versions; delete o.node; return o; };
async function saveCard(c){ try{ await idb.put(persistable(c)); }catch(e){ console.warn(e); } }
async function removeCard(id, silent){
  coll = coll.filter(c => c.id !== id);
  try{ await idb.del(id); }catch{}
  document.querySelectorAll(`[data-card="${CSS.escape(id)}"]`).forEach(el => el.remove());
  refreshTotals(); renderColl();
}
const collReady = (async () => {
  try{ coll = (await idb.all()) || []; }catch{ coll = []; }
  coll.sort((a, b) => b.t - a.t);
  // Preise anhängen braucht keine Kartendatenbank -> Sammlung sofort zeigen
  coll.forEach(c => attachPrice(c));
  if(coll.some(c => c.ygo)) ygoLoad();
  refreshTotals();
  // Kartenbilder für ältere Einträge nachladen (nacheinander, im Hintergrund)
  setTimeout(async () => { for(const c of coll.filter(x => x.img === undefined).slice(0, 300)){ await ensureImg(c); await sleep(150); } }, 3000);
})();
function refreshTotals(){
  const sum = coll.reduce((s, c) => s + totalOf(c), 0), n = coll.reduce((s, c) => s + qtyOf(c), 0);
  $("collVal").textContent = eur(sum) === "–" ? "0 €" : eur(sum); $("barVal").textContent = $("collVal").textContent;
  $("collCnt").textContent = n;
  $("barCnt").textContent = `Sammlung: ${n} Karte${n === 1 ? "" : "n"}`;
  $("tabCount").textContent = n ? `(${n})` : "";
}
function renderColl(){
  const q = $("search").value.trim().toLowerCase(), so = $("sort").value;
  fillFilters();
  let l = coll.filter(c => passFilters(c)).filter(c => !q || [c.name, c.name_en, c.set, c.set_code, c.number, c.op && c.op.id, c.ygo && c.ygo.key, { pokemon: "pokemon", onepiece: "one piece", yugioh: "yugioh yu-gi-oh" }[c.game]].join(" ").toLowerCase().includes(q));
  if(so === "val") l.sort((a, b) => totalOf(b) - totalOf(a));
  else if(so === "gain") l.sort((a, b) => ((totalOf(b) - buyTotalOf(b)) * (b.buy > 0)) - ((totalOf(a) - buyTotalOf(a)) * (a.buy > 0)));
  else if(so === "name") l.sort((a, b) => String(a.name).localeCompare(String(b.name), "de"));
  else if(so === "set") l.sort((a, b) => String(a.set).localeCompare(String(b.set), "de") || String(a.number).localeCompare(String(b.number), "de", { numeric: true }));
  else l.sort((a, b) => b.t - a.t);
  renderInsights();
  LAST_LIST = l;
  $("collList").innerHTML = l.length ? l.map(c => cardHTML(c, "old")).join("") : `<div class="empty">${coll.length ? "Keine Treffer für diesen Filter." : "Noch keine Karten. Scanne deine erste Karte!"}</div>`;
  if(typeof updSelBar === "function" && SELMODE) updSelBar();
}
var LAST_LIST = [];
$("search").oninput = renderColl; $("sort").onchange = renderColl;
$("csvBtn").onclick = () => { csvExport(); try{ localStorage.setItem("cgd-lastbackup", Date.now()); }catch{} renderColl(); };
$("exportBtn").onclick = async () => {
  const blob = new Blob([JSON.stringify({ app: "CardGrab Device", v: 1, date: new Date().toISOString(), cards: coll.map(persistable) })], { type: "application/json" });
  const fname = `cardgrab-sammlung-${new Date().toISOString().slice(0, 10)}.json`;
  // Handy: Teilen-Menü (z. B. direkt in Google Drive, Dateien oder per Mail an sich selbst)
  try{
    const f = new File([blob], fname, { type: "application/json" });
    if(navigator.canShare && navigator.canShare({ files: [f] }) && matchMedia("(pointer:coarse)").matches){
      await navigator.share({ files: [f], title: "CardGrab Sicherung", text: "Sicherung meiner CardGrab-Sammlung" });
      try{ localStorage.setItem("cgd-lastbackup", Date.now()); }catch{} setTimeout(renderColl, 300); toast("💾 Sicherung gespeichert"); return;
    }
  }catch(e){ if(e && e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fname; a.click();
  try{ localStorage.setItem("cgd-lastbackup", Date.now()); }catch{} setTimeout(renderColl, 300);
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
// ---- Sicherung einlesen: nur bekannte Felder mit passenden Typen übernehmen (Schutz vor manipulierten Dateien)
const certLinkOf = c => typeof certLink === "function" ? certLink(c) : "";
const safeThumb = t => /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(t || "")) ? t : "";
const IMG_OK = /^https:\/\/(assets\.tcgdex\.net|images\.ygoprodeck\.com|limitlesstcg\.nyc3\.cdn\.digitaloceanspaces\.com)\/[\w\-./%]+$/;
function sanitizeCard(x){
  if(!x || typeof x !== "object" || Array.isArray(x)) return null;
  const str = (v, n = 200) => typeof v === "string" ? v.slice(0, n) : undefined;
  const numv = (v, lo = 0, hi = 1e7) => (typeof v === "number" && isFinite(v) && v >= lo && v <= hi) ? v : undefined;
  const plain = (v, depth = 0) => {   // nur einfache Daten (Zahlen, Texte, Listen, Objekte), keine Funktionen
    if(v === null || typeof v === "number" || typeof v === "boolean") return typeof v === "number" && !isFinite(v) ? undefined : v;
    if(typeof v === "string") return v.slice(0, 2000);
    if(depth > 4) return undefined;
    if(Array.isArray(v)) return v.slice(0, 60).map(y => plain(y, depth + 1));
    if(typeof v === "object"){ const o = {}; for(const [k, y] of Object.entries(v).slice(0, 60)) if(/^[\w-]{1,30}$/.test(k) && k !== "__proto__") o[k] = plain(y, depth + 1); return o; }
    return undefined;
  };
  const id = str(x.id, 40); if(!id || !/^[\w-]+$/.test(id)) return null;
  const c = { id };
  for(const k of ["game", "name", "name_en", "name_jp", "number", "set", "set_en", "set_code", "language", "rarity", "cond", "cm_name", "cm_version", "cm_expansion", "cm_exp_slug", "op_effect_de", "op_trigger_de", "folder", "grade", "center", "cert"]) if(str(x[k], 2000) !== undefined) c[k] = str(x[k], 2000);
  for(const [k, lo, hi] of [["t", 0, 1e14], ["vi", 0, 50], ["qty", 1, 9999], ["buy", 0, 1e6], ["real", 0, 1e6], ["realAt", 0, 1e14]]) if(numv(x[k], lo, hi) !== undefined) c[k] = numv(x[k], lo, hi);
  if(x.rh === true) c.rh = true;
  if(x.vAuto) c.vAuto = 1;
  for(const k of ["db", "op", "ygo", "jp"]) if(x[k] && typeof x[k] === "object") c[k] = plain(x[k]);
  if(Array.isArray(x.pv)) c.pv = x.pv.slice(-35).filter(p => Array.isArray(p) && /^\d{4}-\d\d-\d\d$/.test(p[0]) && numv(p[1]) !== undefined).map(p => [p[0], p[1]]);
  const th = safeThumb(x.thumb); if(th && th.length < 400000) c.thumb = th;
  if(typeof x.img === "string"){ const ok = x.img.split(" ").filter(u => IMG_OK.test(u)); if(ok.length) c.img = ok.join(" "); }
  if(!c.game || !["pokemon", "onepiece", "yugioh"].includes(c.game)) c.game = c.op ? "onepiece" : c.ygo ? "yugioh" : "pokemon";
  if(!c.name) return null;
  if(!c.t) c.t = Date.now();
  return c;
}
$("importInput").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if(!f) return;
  if(f.size > 60e6){ toast("Datei ist zu groß"); return; }
  try{
    const d = JSON.parse(await f.text()); const cards = Array.isArray(d) ? d : (d && Array.isArray(d.cards) ? d.cards : []);
    let n = 0, bad = 0;
    for(const raw of cards.slice(0, 20000)){
      const c = sanitizeCard(raw);
      if(!c){ bad++; continue; }
      if(coll.some(x => x.id === c.id)) continue;
      attachPrice(c); coll.push(c); await saveCard(c); n++;
    }
    coll.sort((a, b) => b.t - a.t); refreshTotals(); renderColl(); toast(`${n} Karten geladen${bad ? ` · ${bad} ungültige übersprungen` : ""}`);
  }catch{ toast("Datei konnte nicht gelesen werden"); }
};

// ---------------- Kartendarstellung ----------------
// Versionen als Bild-Kacheln: so sieht man sofort, welches Motiv zu V1, V2 … gehört
function verTiles(c, label){
  const im = verImgs(c) || [];
  return c.versions.map((x, i) => { const m = im[i];
    return `<button data-ver="${esc(c.id)}" data-i="${i}" class="vt${i === (c.vi || 0) ? " on" : ""}">${m ? `<img class="vti" loading="lazy" referrerpolicy="no-referrer" src="${esc(m.url)}"${m.alt ? ` data-alt="${esc(m.alt)}"` : ""} alt="">${m.approx ? `<em class="q" title="Bild evtl. nicht exakt diese Version"${m.late ? " hidden" : ""}>≈</em>` : ""}` : ""}<span>${label(x, i)}</span><b>${eur(x.low || x.trend)}</b></button>`; }).join("");
}
function cardHTML(c, mode){
  const p = c.price;
  const code = c.op ? c.op.id : c.ygo ? c.number : cmCode(c) || c.number || "";
  const holo = p && (p.trendH || p.lowH);
  const v = valueOf(c);
  const vers = c.ygo && c.versions && c.versions.length > 1
    ? `<div class="vers tiles">${verTiles(c, (x, i) => esc(x.pack || "V" + (i + 1)))}</div>
       <div class="note">Diese Karte gibt es in diesem Set ${c.versions.length}× (verschiedene Seltenheiten) – wähle deine.${c.versions.some(x => x.guess) ? " Zuordnung geschätzt – im Zweifel auf Cardmarket prüfen." : ""}</div>`
    : c.op && c.versions && c.versions.length > 1
    ? `<div class="vers tiles">${verTiles(c, (x, i) => `V${i + 1} ${esc(x.pack || "")}`)}</div>
       <div class="note">${c.vAuto ? "✓ Version am Bild erkannt – bitte kurz prüfen. " : ""}Diese Karte gibt es ${c.versions.length}× (normal, Parallel/Alt Art, Reprints). Tippe auf das Bild, das genau wie deine Karte aussieht – V1 ist meist die normale Karte.${c.versions.some(x => x.guess) ? " Zuordnung der Versionen geschätzt – im Zweifel auf Cardmarket prüfen." : ""}</div>` : "";
  const rh = holo ? `<div class="vers"><button data-rh="${esc(c.id)}" data-v="0" class="${!c.rh ? "on" : ""}">Normal</button><button data-rh="${esc(c.id)}" data-v="1" class="${c.rh ? "on" : ""}">Reverse Holo</button></div>` : "";
  const pr = p ? `<div class="prices">
      <div><span>ab ${c.real > 0 ? "(alle)" : p.est ? "(ca.)" : ""}</span><b>${eur(c.rh && p.lowH ? p.lowH : p.low)}</b></div>
      <div><span>Trend</span><b>${eur(c.rh && p.trendH ? p.trendH : p.trend)}</b></div>
      <div><span>30-T-Ø</span><b>${eur(c.rh && p.avg30H ? p.avg30H : p.avg30)}</b></div>
      <small class="psrc">Preise: <b class="cmtxt">Cardmarket</b><img class="cmlogo" src="brand/cardmarket-blue.png" alt="Cardmarket">${c.real > 0 ? " · ✓ eigener Preis" : ""}</small></div>`
    : `<div class="note">${(c.op ? OPP : c.ygo ? YGOP : PP) ? "Für diese Karte steht kein Preis in der Cardmarket-Liste – tippe auf den Cardmarket-Button." : "Preisliste noch nicht geladen (sie wird jeden Morgen aktualisiert)."}</div>`;
  return `<div class="card ${mode || ""}" data-card="${esc(c.id)}">
    <div class="rowc">
      ${c.img ? `<img class="thumb card-img" src="${esc(imgSrc(c))}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${esc(imgFallback(c))}">` : c.thumb ? `<img class="thumb" src="${esc(safeThumb(c.thumb))}" alt="">` : `<div class="thumb"></div>`}
      <div class="info">
        <h3>${esc(c.name || c.name_en || "Unbekannt")}${c.name_jp && c.name_jp !== c.name ? ` <span style="font-weight:400;color:var(--muted);font-size:13px">${esc(c.name_jp)}</span>` : ""}</h3>
        <div class="meta"><span class="game g-${esc(c.game || "pokemon")}">${{ onepiece: "One Piece", yugioh: "Yu-Gi-Oh!" }[c.game] || "Pokémon"}</span> <b>${esc(code)}</b>${c.set ? " · " + esc(c.set) : ""}${c.rarity && c.ygo ? " · " + esc(c.rarity) : ""}${c.language ? " · " + esc(c.language) : ""}</div>
      </div>
      <div class="val"><div class="l">${c.real > 0 ? "ab · " + langShort(c) + " ✓" : "ab"}</div><div class="p">${eur(v)}</div>${qtyOf(c) > 1 ? `<div class="l">${qtyOf(c)}× = ${eur(totalOf(c))}</div>` : ""}</div>
    </div>
    ${ownHTML(c)}
    ${pr}${rh}${vers}
    <div class="real"><span>Günstigster Preis in <b>${langLong(c)}</b> (DE-Verkäufer, ${esc(c.cond || "NM")}) – vom Cardmarket-Button ablesen:</span>
      <input type="text" inputmode="decimal" data-real="${esc(c.id)}" value="${c.real > 0 ? String(c.real).replace(".", ",") : ""}" placeholder="z. B. 0,12">
      <span class="eur">€</span><button class="btn secondary small" data-realok="${esc(c.id)}">${c.real > 0 ? "Ändern" : "Übernehmen"}</button>
      ${c.real > 0 ? `<small>✓ gilt als Wert · eingetragen ${new Date(c.realAt || Date.now()).toLocaleDateString("de-DE")}</small>` : ""}</div>
    <div class="speak"><button class="btn secondary small" data-say="${esc(c.id)}">${speakingId === c.id ? "⏹️ Stopp" : "🔊 Vorlesen"}</button><button class="btn secondary small" data-view="${esc(c.id)}">📄 Kartentext</button></div>
    <div class="facts" data-facts="${esc(c.id)}" hidden></div>
    <div class="editrow"><button data-edit="${esc(c.id)}">✏️ Bearbeiten</button>${c.grade ? (certLinkOf(c) ? `<a class="fold grade" href="${esc(certLinkOf(c))}" target="_blank" rel="noopener">🏅 ${esc(c.grade)}</a>` : `<span class="fold grade">🏅 ${esc(c.grade)}</span>`) : ""}${c.center ? `<span class="fold" title="Zentrierung links/rechts · oben/unten">📐 ${esc(c.center)}</span>` : ""}${c.folder ? `<span class="fold">📁 ${esc(c.folder)}</span>` : ""}</div>
    ${c.ygo ? ygoLinks(c) : links(c)}
  </div>`;
}
function langShort(c){ const l = String(c.language || "").toLowerCase(); return l.startsWith("deu") ? "DE" : l.startsWith("jap") ? "JP" : l.startsWith("fr") ? "FR" : "EN"; }
function langLong(c){ return { DE: "Deutsch", JP: "Japanisch", FR: "Französisch", EN: "Englisch" }[langShort(c)]; }
function setReal(id, inp){
  const c = coll.find(x => x.id === id); if(!c) return;
  // die Karte kann mehrmals auf der Seite stehen (Scanner-Liste + Sammlung) -> das Feld neben dem Knopf nehmen
  if(!inp) inp = [...document.querySelectorAll(`[data-real="${CSS.escape(id)}"]`)].find(i => i.value.trim()) || null;
  const v = parseFloat(String(inp ? inp.value : "").replace(/[^0-9,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  if(isFinite(v) && v > 0){ c.real = Math.round(v * 100) / 100; c.realAt = Date.now(); toast(`✓ ${c.name}: ${eur(c.real)} (${langLong(c)}) übernommen`); }
  else { delete c.real; delete c.realAt; toast("Eigener Preis entfernt – es gilt wieder der ab-Preis aus der Liste"); }
  saveCard(c); rerender(c); refreshTotals();
}
document.addEventListener("keydown", e => { const i = e.target.closest && e.target.closest("[data-real]"); if(i && e.key === "Enter"){ e.preventDefault(); setReal(i.dataset.real, i); } });
document.addEventListener("click", e => {
  const head = e.target.closest(".card .rowc");
  if(head && !e.target.closest("a,button,input")){
    const card = head.closest(".card");
    if(card.classList.contains("old")) card.classList.remove("old");
    else if(!card.classList.contains("latest") && card.dataset.card) card.classList.add("old");
    return;
  }
  const ro = e.target.closest("[data-realok]"); if(ro){ const box = ro.closest(".real"); setReal(ro.dataset.realok, box && box.querySelector("[data-real]")); return; }
  const kv = e.target.closest("[data-view]");
  if(kv){ const c = coll.find(x => x.id === kv.dataset.view); const box = document.querySelector(`[data-facts="${CSS.escape(kv.dataset.view)}"]`); if(c && box){ if(!box.hidden && box.innerHTML){ box.hidden = true; } else showCardView(c, false); } return; }
  const sb = e.target.closest("[data-say]"); if(sb){ const c = coll.find(x => x.id === sb.dataset.say); if(c) speakCard(c); return; }
  const d = e.target.closest("[data-del]"); if(d){ removeCards([d.dataset.del]); return; }
  const vb = e.target.closest("[data-ver]");
  if(vb){ const c = coll.find(x => x.id === vb.dataset.ver); if(c){ c.vi = +vb.dataset.i; delete c.vAuto; if(c.op || c.ygo) delete c.img; attachPrice(c); saveCard(c); rerender(c); refreshTotals(); if(c.op || c.ygo) ensureImg(c); } return; }
  const rb = e.target.closest("[data-rh]");
  if(rb){ const c = coll.find(x => x.id === rb.dataset.rh); if(c){ c.rh = rb.dataset.v === "1"; saveCard(c); rerender(c); refreshTotals(); } }
});
function rerender(c){
  document.querySelectorAll(`[data-card="${CSS.escape(c.id)}"]`).forEach(el => {
    const keep = ["latest", "old"].filter(k => el.classList.contains(k));
    const t = document.createElement("div"); t.innerHTML = cardHTML(c, keep.join(" ")); el.replaceWith(t.firstElementChild);
  });
}

// ---------------- Vorlesen (Sprachausgabe des Handys, offline) ----------------
let speakingId = null;
const FACTS = new Map();
const TYPE_DE = { Grass: "Pflanze", Fire: "Feuer", Water: "Wasser", Lightning: "Elektro", Psychic: "Psycho", Fighting: "Kampf", Darkness: "Finsternis", Metal: "Metall", Fairy: "Fee", Dragon: "Drache", Colorless: "Farblos" };
const STAGE_DE = { Basic: "Basis-Pokémon", Stage1: "Phase 1", Stage2: "Phase 2", BREAK: "TURBO", MEGA: "Mega", VMAX: "VMAX", VSTAR: "VSTAR", "LEVEL-UP": "Level-Up", Restored: "Wiederbelebt" };
const SYM = { G: "Pflanzen", R: "Feuer", W: "Wasser", L: "Elektro", P: "Psycho", F: "Kampf", D: "Finsternis", M: "Metall", Y: "Feen", N: "Drachen", C: "Farblos" };
const sayClean = t => String(t || "").replace(/\u0001/g, "").replace(/\s*\(([^)]*)\)\s*/g, ", $1, ").replace(/,\s*([.,])/g, "$1").replace(/\{([A-Z])\}(\s*-?\s*Energie)?/g, (m, k) => " " + (SYM[k] || k) + "-Energie ").replace(/\s+/g, " ").trim();
const dmgText = d => { const s = String(d ?? "").trim(); if(!s) return ""; return s.replace(/\+$/, " plus").replace(/[×x]$/, " mal").replace(/-$/, " minus") + " Schaden"; };
let OPDE = null;
function opDe(){ return OPDE || (OPDE = fetch("op-de.json").then(r => r.ok ? r.json() : {}).catch(() => ({}))); }
async function opTexts(o){ const d = (await opDe())[o.id]; return { eff: (d && d[0]) || o.effect || "", trg: (d && d[1]) || o.trigger || "" }; }
// Zahlen als deutsche Wörter, damit jede Stimme z. B. "hundertzwanzig" flüssig spricht
const ZW = ["null","ein","zwei","drei","vier","fünf","sechs","sieben","acht","neun","zehn","elf","zwölf","dreizehn","vierzehn","fünfzehn","sechzehn","siebzehn","achtzehn","neunzehn"];
const ZZ = ["","","zwanzig","dreißig","vierzig","fünfzig","sechzig","siebzig","achtzig","neunzig"];
function zahl(n){
  if(n < 20) return ZW[n];
  if(n < 100){ const e = n % 10; return (e ? ZW[e] + "und" : "") + ZZ[Math.floor(n / 10)]; }
  if(n < 1000){ const r = n % 100; return (Math.floor(n / 100) === 1 ? "" : ZW[Math.floor(n / 100)]) + "hundert" + (r ? zahl(r) : ""); }
  if(n < 1e6){ const r = n % 1000, t = Math.floor(n / 1000); return (t === 1 ? "" : zahl(t)) + "tausend" + (r ? zahl(r) : ""); }
  return String(n);
}
const sayNums = t => String(t).replace(/(\d{1,3}(?:\.\d{3})+|\d+)(?![.,]\d)/g, (m, d) => { const n = +d.replace(/\./g, ""); return n >= 10 && n < 1e6 ? zahl(n) : m; });
async function factsFor(sid){
  if(FACTS.has(sid)) return FACTS.get(sid);
  const p = fetch(`facts/${encodeURIComponent(sid)}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
  FACTS.set(sid, p); return p;
}
// ---------- Kartentext im Aufbau der echten Karte ----------
const EN_ICON = { Grass: ["#3fae49", "🌿"], Fire: ["#e8462e", "🔥"], Water: ["#2f8fd8", "💧"], Lightning: ["#f2c318", "⚡"], Psychic: ["#9b4fb8", "👁"], Fighting: ["#b5652b", "✊"], Darkness: ["#2f3a45", "🌙"], Metal: ["#8a97a3", "⚙"], Fairy: ["#e584b6", "✨"], Dragon: ["#b49b37", "🐉"], Colorless: ["#e9e6dc", "★"] };
const enIcon = t => { const [bg, ch] = EN_ICON[t] || ["#777", "?"]; return `<i class="en" style="background:${bg}" title="${esc(TYPE_DE[t] || t)}">${ch}</i>`; };
const textIcons = t => esc(sayClean(t)).replace(/\b(Pflanzen|Feuer|Wasser|Elektro|Psycho|Kampf|Finsternis|Metall|Feen|Drachen|Farblos)-Energie\b/g, m => m);
const opText = t => esc(t || "").replace(/\[([^\]]+)\]/g, (m, k) => `<span class="kw">${k}</span>`);
async function cardViewHTML(c){
  if(c.ygo) return ygoViewHTML(c);
  if(c.op){
    const o = c.op;
    const tx = await opTexts(o);
    const col = (o.color || "").split("/").map(x => ({ Red: "#d93b3b", Green: "#2f9e57", Blue: "#2f7fd8", Purple: "#8b4fc0", Black: "#333", Yellow: "#e2b829" }[x] || "#777"));
    return `<div class="cv op" style="--c1:${col[0] || "#777"};--c2:${col[1] || col[0] || "#777"}">
      <div class="cv-head"><span class="cv-cost" title="Kosten">${o.cost ?? ""}</span><b class="cv-name">${esc(c.name)}</b><span class="cv-pow">${o.power ? num(o.power) : ""}</span></div>
      <div class="cv-sub">${esc({ Leader: "LEADER", Character: "CHARACTER", Event: "EVENT", Stage: "STAGE" }[o.cat] || o.cat || "")}${o.cat === "Leader" && o.cost != null ? " · " + o.cost + " Leben" : ""}${o.attr ? " · " + esc(o.attr) : ""}</div>
      ${o.counter ? `<div class="cv-counter">Konter +${num(o.counter)}</div>` : ""}
      ${tx.eff ? `<div class="cv-eff">${opText(tx.eff)}</div>` : ""}
      ${tx.trg ? `<div class="cv-eff trig"><span class="kw">Trigger</span> ${opText(tx.trg)}</div>` : ""}
      <div class="cv-foot"><span>${esc(o.types || "")}</span><span>${esc(o.id)}</span></div></div>`;
  }
  if(!c.db || !c.db.sid) return "";
  const all = await factsFor(c.db.sid); const e = all && (all[c.db.lid] || all[String(c.db.lid).replace(/^0+/, "")]);
  if(!e) return "";
  if(e.c && e.c !== "Pokemon"){
    const kind = e.c === "Trainer" ? ({ Item: "ITEM", Supporter: "UNTERSTÜTZER", Stadium: "STADION", Tool: "PKMN-AUSRÜSTUNG" }[e.tt] || "TRAINER") : "ENERGIE";
    return `<div class="cv tr"><div class="cv-sub">${kind}</div><div class="cv-head"><b class="cv-name">${esc(e.n || c.name)}</b></div>
      ${e.e ? `<div class="cv-eff">${esc(sayClean(e.e))}</div>` : ""}<div class="cv-foot"><span></span><span>${esc(cmCode(c))}</span></div></div>`;
  }
  const stage = { Basic: "BASIS", Stage1: "PHASE 1", Stage2: "PHASE 2", VMAX: "VMAX", VSTAR: "VSTAR", MEGA: "MEGA", BREAK: "TURBO" }[e.st] || (e.st || "").toUpperCase();
  const t0 = (e.t || [])[0];
  const atks = (e.a || []).map(([n, d, eff, cost]) => `<div class="cv-atk"><div class="cv-line"><span class="cv-costs">${(cost || []).map(enIcon).join("")}</span><b>${esc(sayClean(n))}</b><span class="cv-dmg">${esc(String(d ?? ""))}</span></div>${eff ? `<div class="cv-txt">${esc(sayClean(eff))}</div>` : ""}</div>`).join("");
  const abs = (e.ab || []).map(([n, eff]) => `<div class="cv-atk ab"><div class="cv-line"><span class="cv-abl">Fähigkeit</span><b>${esc(sayClean(n))}</b></div><div class="cv-txt">${esc(sayClean(eff))}</div></div>`).join("");
  const weak = (e.w || []).map((t, i) => enIcon(t) + esc((e.wv || [])[i] || "")).join(" ") || "–";
  const res = (e.rs || []).map(([t, v]) => enIcon(t) + esc(v)).join(" ") || "–";
  const ret = e.r ? Array.from({ length: e.r }, () => enIcon("Colorless")).join("") : "–";
  const [bg] = EN_ICON[t0] || ["#888"];
  return `<div class="cv pk" style="--tc:${bg}">
    <div class="cv-sub">${stage}${e.ef ? ` · entwickelt sich aus ${esc(e.ef)}` : ""}</div>
    <div class="cv-head"><b class="cv-name">${esc(e.n || c.name)}</b><span class="cv-hp"><small>KP</small>${e.hp || ""} ${(e.t || []).map(enIcon).join("")}</span></div>
    ${abs}${atks}
    <div class="cv-foot"><span>Schwäche ${weak}</span><span>Resistenz ${res}</span><span>Rückzug ${ret}</span></div></div>`;
}
async function showCardView(c, voices){
  const html = await cardViewHTML(c);
  document.querySelectorAll(`[data-facts="${CSS.escape(c.id)}"]`).forEach(el => { el.hidden = false; el.innerHTML = (html ? html + `<div class="note src">Text: ${c.ygo ? "YGOPRODeck" : c.op ? "punk-records" : "TCGdex"}${c.op ? " · maschinell übersetzt" : " · teils maschinell übersetzt"} – inoffiziell, im Zweifel gilt die gedruckte Karte. <a href="legal.html#hinweise">Hinweise</a></div>` : `<div class="note">Für diese Karte gibt es keinen Kartentext.</div>`) + (voices ? voicePicker() : ""); });
  return !!html;
}

// Sprech-Abschnitte: [{t: Text, l: "de-DE" | "en-US"}] – in natürlichen Sätzen
const ORD = ["Erste", "Zweite", "Dritte", "Vierte"];
const num = n => { const x = Number(n); return isFinite(x) ? x.toLocaleString("de-DE") : String(n); };
const TYPE_ADJ = { Grass: "Pflanzen", Fire: "Feuer", Water: "Wasser", Lightning: "Elektro", Psychic: "Psycho", Fighting: "Kampf", Darkness: "Unlicht", Metal: "Stahl", Fairy: "Feen", Dragon: "Drachen", Colorless: "farbloses" };
function sayDamage(d){
  const s = String(d ?? "").trim(); if(!s) return "";
  const m = s.match(/^(\d+)\s*([+×x−-])?$/);
  if(!m) return `${s} Schaden`;
  const n = num(m[1]);
  return m[2] === "+" ? `${n} Schaden oder mehr` : (m[2] === "×" || m[2] === "x") ? `${n} Schaden mal Anzahl` : (m[2] ? `${n} Schaden oder weniger` : `${n} Schaden`);
}
// Erzähl-Stil: wie eine kleine Geschichte über die Karte
const W1 = ["keine", "eine", "zwei", "drei", "vier", "fünf", "sechs"];
const TYPE_COMP = { Grass: "Pflanzen", Fire: "Feuer", Water: "Wasser", Lightning: "Elektro", Psychic: "Psycho", Fighting: "Kampf", Darkness: "Finsternis", Metal: "Metall", Fairy: "Feen", Dragon: "Drachen" };
const pickOne = a => a[Math.floor(Math.random() * a.length)];
function costWords(cost){
  if(!cost || !cost.length) return "ganz ohne Energie";
  const g = []; for(const t of cost){ const x = g.find(y => y[0] === t); if(x) x[1]++; else g.push([t, 1]); }
  const total = cost.length;
  return g.map(([t, n], i) => {
    const last = i === g.length - 1, nw = W1[n] || String(n);
    if(t === "Colorless") return last ? `${nw} farblose ${total > 1 ? "Energien" : "Energie"}` : `${nw} farblose`;
    const tn = TYPE_COMP[t] || TYPE_DE[t] || t;
    return last ? `${nw} ${tn}-${n > 1 || total > 1 ? "Energien" : "Energie"}` : `${nw} ${tn}-`;
  }).join(g.length > 2 ? ", " : " und ").replace(/, ([^,]*)$/, " und $1");
}
function damageStory(d, name){
  const s = String(d ?? "").trim(); if(!s) return "";
  const m = s.match(/^(\d+)\s*([+×x−-])?$/); if(!m) return `richtet ${name} ${s} Schaden an`;
  const n = num(m[1]);
  if(m[2] === "+") return `richtet es mindestens ${n} Schaden an – und manchmal noch mehr`;
  if(m[2] === "×" || m[2] === "x") return `richtet es ${n} Schaden an, und das gleich mehrfach`;
  if(m[2]) return `richtet es bis zu ${n} Schaden an`;
  return `richtet es ${n} Schaden an`;
}
function priceStory(c){
  const v = valueOf(c); if(!(v > 0)) return "";
  const p = v < 1 ? `${Math.round(v * 100)} Cent` : v.toLocaleString("de-DE", { maximumFractionDigits: v < 10 ? 2 : 0 }) + " Euro";
  return pickOne([`Und das Beste: Zu haben ist ${c.name} schon ab ${p}.`, `Auf Cardmarket bekommst du ${c.name} ab ${p}.`, `Wert der Karte: ab ${p}.`]);
}
// Nur vorlesen, was auf der Karte steht – in der Reihenfolge der Karte
const dmgPlain = d => String(d ?? "").trim().replace(/\+$/, " plus").replace(/[×x]$/, " mal").replace(/[−-]$/, " minus");
async function speechParts(c){
  const parts = [], de = t => t && parts.push({ t: sayNums(t), l: "de-DE" }), en = t => t && parts.push({ t, l: "en-US" });
  if(c.ygo){ const t = await ygoSay(c); if(!t) return null; de(t); return parts; }
  if(c.op){
    const o = c.op;
    const nm = c.name.replace(/\.(?=[A-Z]\.)/, " ").replace(/\.(?=\S)/g, ". ");
    const head = [nm + "."];
    if(o.cat === "Leader"){ if(o.cost != null) head.push(`Leben ${o.cost}.`); }
    else if(o.cost != null) head.push(`Kosten ${o.cost}.`);
    if(o.power) head.push(`Stärke ${num(o.power)}.`);
    if(o.counter) head.push(`Konter plus ${num(o.counter)}.`);
    const tx = await opTexts(o);
    const opSay = t => t.replace(/\]\s*:?\s*/g, ". ").replace(/\[/g, " ").replace(/\.\s*\./g, ".").replace(/\s+/g, " ").trim().replace(/DON!!/g, "DON").replace(/➀|①/g, "1").replace(/➁|②/g, "2").replace(/➂|③/g, "3").replace(/[−-](\d)/g, "minus $1").replace(/\+(\d)/g, "plus $1");
    if(tx.eff) head.push(opSay(tx.eff));
    if(tx.trg) head.push("Trigger. " + opSay(tx.trg));
    de(head.join(" "));
    return parts;
  }
  if(!c.db || !c.db.sid) return null;
  const all = await factsFor(c.db.sid); const e = all && (all[c.db.lid] || all[String(c.db.lid).replace(/^0+/, "")]);
  if(!e) return null;
  const out = [];
  if(e.c && e.c !== "Pokemon"){
    if(e.c === "Trainer") out.push(({ Item: "Item.", Supporter: "Unterstützer.", Stadium: "Stadion.", Tool: "Pokémon-Ausrüstung." }[e.tt] || "Trainer."));
    out.push(`${e.n || c.name}.`);
    if(e.e) out.push(sayClean(e.e));
    de(out.join(" "));
    return parts;
  }
  const stage = { Basic: "Basis", Stage1: "Phase 1", Stage2: "Phase 2", VMAX: "VMAX", VSTAR: "VSTAR", MEGA: "Mega", BREAK: "TURBO" }[e.st];
  if(stage) out.push(`${stage}${e.ef ? ", entwickelt sich aus " + e.ef : ""}.`);
  out.push(`${e.n || c.name}.`);
  if(e.hp) out.push(`${e.hp} KP.`);
  for(const [n, eff] of e.ab || []) out.push(`Fähigkeit: ${sayClean(n)}. ${sayClean(eff)}`);
  for(const [n, d, eff] of e.a || []){
    const dm = dmgPlain(d);
    out.push(`${sayClean(n)}${dm ? ", " + dm : ""}.${eff ? " " + sayClean(eff) : ""}`);
  }
  if(e.w && e.w.length) out.push(`Schwäche ${e.w.map((t, i) => (TYPE_DE[t] || t) + " " + String((e.wv || [])[i] || "").replace("×", "mal ").replace("+", "plus ")).join(", ").trim()}.`);
  if(e.rs && e.rs.length) out.push(`Resistenz ${e.rs.map(([t, v]) => (TYPE_DE[t] || t) + " " + String(v).replace("-", "minus ")).join(", ")}.`);
  if(e.r !== undefined) out.push(`Rückzug ${e.r}.`);
  de(out.join(" "));
  return parts;
}
const sentences = t => String(t || "").split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/).map(x => x.trim()).filter(Boolean);
// beste Stimme: gespeicherte Wahl > hochwertige (Google / Natural / Neural / Premium / Online) > Netz-Stimmen > Rest
function voiceList(lang){ const p = lang.slice(0, 2); return speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().replace("_", "-").startsWith(p)); }
function voiceScore(v, lang){
  let s = 0; const n = v.name.toLowerCase();
  if(v.lang.replace("_", "-") === lang) s += 5;
  if(/natural|neural|premium|enhanced|wavenet|online/.test(n)) s += 20;
  if(/google/.test(n)) s += 12;
  if(!v.localService) s += 6;
  if(/compact|espeak/.test(n)) s -= 20;
  return s;
}
function voiceFor(lang){
  const vs = voiceList(lang); if(!vs.length) return null;
  try{ const saved = localStorage.getItem("cgd-voice-" + lang.slice(0, 2)); const v = saved && vs.find(x => x.name === saved); if(v) return v; }catch{}
  return vs.slice().sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang))[0];
}
function voicePicker(){
  const vs = voiceList("de-DE"); if(vs.length < 2) return "";
  const cur = voiceFor("de-DE");
  return `<label class="voice">Stimme: <select data-voice>${vs.map(v => `<option ${cur && v.name === cur.name ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>`;
}
document.addEventListener("change", e => { const s = e.target.closest("[data-voice]"); if(s){ try{ localStorage.setItem("cgd-voice-de", s.value); }catch{} toast("Stimme gespeichert – nächstes Vorlesen klingt so"); } });
function stopSpeaking(){ try{ speechSynthesis.cancel(); }catch{} const id = speakingId; speakingId = null; const c = coll.find(x => x.id === id); if(c) rerender(c); }
async function speakCard(c){
  if(!("speechSynthesis" in window)){ toast("Dein Browser kann nicht vorlesen"); return; }
  if(speakingId === c.id){ stopSpeaking(); return; }
  if(speakingId) stopSpeaking();
  const parts = await speechParts(c);
  if(!parts){ toast("Für diese Karte gibt es keine Vorlese-Daten"); return; }
  speakingId = c.id; rerender(c);
  const show = () => showCardView(c, true);
  show();
  speechSynthesis.cancel();
  // Satz für Satz sprechen: klingt natürlicher und bricht bei langen Texten nicht ab
  const merged = [];
  for(const p of parts){ const last = merged[merged.length - 1]; if(last && last.l === p.l) last.t += " " + p.t; else merged.push({ ...p }); }
  const queue = [];
  for(const p of merged){
    let cur = "";
    for(const t of sentences(p.t)){ if(cur && (cur + " " + t).length > 900){ queue.push({ t: cur, l: p.l }); cur = t; } else cur = cur ? cur + " " + t : t; }
    if(cur) queue.push({ t: cur, l: p.l });
  }
  queue.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p.t); u.lang = p.l; const v = voiceFor(p.l); if(v) u.voice = v;
    u.rate = 1; u.pitch = 1;
    if(i === queue.length - 1) u.onend = u.onerror = () => { if(speakingId === c.id){ speakingId = null; rerender(c); show(); } };
    speechSynthesis.speak(u);
  });
}
if("speechSynthesis" in window){ speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); }

// ---------------- Lesen: Kürzel + Nummer aus dem Text ----------------
let LANG = "Deutsch";
document.querySelectorAll("#langChips .chip").forEach(b => b.onclick = () => {
  LANG = b.dataset.lang; document.querySelectorAll("#langChips .chip").forEach(x => x.classList.toggle("on", x === b));
});
const LANG_TOKENS = { DE: "Deutsch", EN: "Englisch", FR: "Französisch", IT: "Italienisch", ES: "Spanisch", PT: "Portugiesisch", NL: "Niederländisch" };
let KNOWN = null;   // bekannte Pokémon-Set-Kürzel
function knownCodes(){
  if(KNOWN) return KNOWN;
  const k = new Set(); if(!CDB) return k;
  KNOWN = k; if(CDB) for(const k of CDB.byCode.keys()) KNOWN.add(k);
  for(const x of SETS) if(x[0]) KNOWN.add(x[0]);
  for(const k of Object.keys(CODE_ALIAS)) KNOWN.add(k);
  return KNOWN;
}
// typische Lesefehler in Zahlen/Buchstaben korrigieren
const toDigits = s => s.replace(/[OoQD]/g, "0").replace(/[Il|!L]/g, "1").replace(/Z/g, "2").replace(/S/g, "5").replace(/B/g, "8").replace(/G/g, "6");
const toLetters = s => s.replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B");
// Ziffern werden beim Lesen leicht verwechselt (6↔8, 0↔9, 3↔8 …). Steht der Kartenname im gelesenen Text,
// wird die Nummer genommen, deren Name dazu passt (z. B. „OP18-008“ gelesen, „Yamato“ im Bild -> OP16-098).
const DIGIT_CONF = { "0": "98", "1": "7", "2": "7", "3": "85", "4": "9", "5": "63", "6": "850", "7": "12", "8": "6309", "9": "804" };
const lettersOnly = t => String(t || "").toUpperCase().replace(/[^A-Z]/g, "");
function opNameIn(id, raw){ const c = OPDB && OPDB.cards[id], n = c && lettersOnly(c[0]); return !!n && n.length >= 3 && lettersOnly(raw).includes(n); }
function opCheckName(id, raw){
  if(!OPDB) return id;
  const nameOk = x => opNameIn(x, raw);
  if(nameOk(id)) return id;
  const m = id.match(/^([A-Z]+)(\d{2})-(\d{3})$/); if(!m) return id;
  const digits = (m[2] + m[3]).split(""), seen = new Set([id]), hits = [];
  const tryId = d => { const x = `${m[1]}${d.slice(0, 2).join("")}-${d.slice(2).join("")}`; if(!seen.has(x)){ seen.add(x); if(OPDB.cards[x] && nameOk(x)) hits.push(x); } };
  for(let i = 0; i < 5; i++) for(const a of DIGIT_CONF[digits[i]] || ""){
    const d1 = [...digits]; d1[i] = a; tryId(d1);
    for(let j = i + 1; j < 5; j++) for(const b of DIGIT_CONF[digits[j]] || ""){ const d2 = [...d1]; d2[j] = b; tryId(d2); }
  }
  return hits.length === 1 ? hits[0] : id;
}
function parseRead(text){
  const raw = String(text || "").toUpperCase().replace(/[‐-―]/g, "-");
  // One Piece: OP05-119, ST01-012, EB02-010, PRB01-001, P-043
  const t1 = raw.replace(/\s+/g, " ");
  // Bindestrich wird oft nicht/anders gelesen („OP16 098“, „OP16~098“, „OP16098“), O/0 und P/D/Q verwechselt
  const OPX = /(?:^|[^A-Z0-9])(OP|0P|QP|DP|ST|5T|EB|E8|PRB|PR8)\s?([0-9OISLZ]{2})\s?[-–~.:_=]?\s?([0-9OISBLZ]{3})(?![0-9])/g;
  let opm, opHit = null;
  while(!opHit && (opm = OPX.exec(t1))){
    const pre = { "0P": "OP", "QP": "OP", "DP": "OP", "5T": "ST", "E8": "EB", "PR8": "PRB" }[opm[1]] || opm[1];
    const id = `${pre}${toDigits(opm[2])}-${toDigits(opm[3])}`;
    if(OPDB && OPDB.cards[id]) opHit = id;
  }
  if(!opHit){ const pm = t1.match(/\b(P)\s?-\s?([0-9OISB]{3})\b/); if(pm && OPDB && OPDB.cards[`P-${toDigits(pm[2])}`]) opHit = `P-${toDigits(pm[2])}`; }
  if(opHit){ opHit = opCheckName(opHit, raw); return { kind: "op", id: opHit, key: "op:" + opHit }; }
  // Yu-Gi-Oh!: Set-Kürzel "LOB-DE005" (Sprache steht im Kürzel)
  const yg = ygoParse(raw); if(yg && yg.kind === "ygo") return yg;
  // Japanische Pokémon-Karten: eigenes Kürzel („SV2A 025/165“)
  if(typeof jpParse === "function"){ const j = jpParse(raw); if(j) return j; }
  // Pokémon: Nummer "040/182", "TG05/TG30", "GG35/GG70", "SV049/SV094", "4/102"
  // Kürzel zählt nur, wenn es direkt neben der Nummer steht (so ist es gedruckt: "PAL DE 227/193")
  const T = raw.replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
  const codes = knownCodes();
  const fix = t => { const m = t.match(/^(TG|GG|SV|RC|SH|H)(.*)$/); return m && /^[0-9OIS]+$/.test(m[2]) ? m[1] + toDigits(m[2]) : toDigits(t); };
  const codeIn = tk => {
    for(const c of [tk, tk.replace(/(DE|EN|FR|IT|ES|PT)$/, ""), toLetters(tk.replace(/\d$/, "")) + (tk.match(/\d$/) || [""])[0]]){
      if(c.length >= 2 && c.length <= 5 && !/^\d+$/.test(c) && codes.has(c)){
        const l2 = tk.slice(c.length); return { code: c, lang: LANG_TOKENS[l2] || "" };
      }
    }
    return null;
  };
  const near = (str, before) => {
    // Wörter direkt vor (bzw. nach) der Nummer prüfen – höchstens 2 Wörter Abstand (Kürzel + Sprache)
    const ws = str.trim().split(" ").filter(Boolean);
    const list = before ? ws.slice(-3).reverse() : ws.slice(0, 3);
    let lang = "";
    for(const w0 of list){
      const w = w0.replace(/[^A-Z0-9]/g, ""); if(!w) continue;
      if(LANG_TOKENS[w]){ lang = LANG_TOKENS[w]; continue; }
      const hit = codeIn(w); if(hit) return { code: hit.code, lang: hit.lang || lang };
    }
    return { code: "", lang };
  };
  const re = /\b([A-Z]{0,2}[0-9OIS]{1,3})\/([A-Z]{0,2}[0-9OIS]{2,3})\b/g;
  let best = null, m;
  while((m = re.exec(T))){
    const left = fix(m[1]), right = fix(m[2]);
    if(!/\d/.test(left) || !/\d/.test(right)) continue;
    let k = near(T.slice(Math.max(0, m.index - 16), m.index), true);
    if(!k.code) k = near(T.slice(m.index + m[0].length, m.index + m[0].length + 14), false);
    const cand = { kind: "pk", code: k.code, number: `${left}/${right}`, lang: k.lang, strong: !!k.code, key: `pk:${k.code}:${left}/${right}` };
    if(cand.strong){ best = cand; break; }
    if(!best) best = cand;
  }
  if(best) return best;
  if(yg) return yg;   // Yu-Gi-Oh!-Passcode (Karte bekannt, Ausgabe wählen)
  // Promo ohne Gesamtzahl: "SVP 049", "MEP 012" – Kürzel muss direkt davor stehen
  const pm = T.match(/\b([A-Z]{2,4}\d?)(?: (?:DE|EN|FR|IT|ES|PT))? ([0-9OIS]{2,3})\b/g) || [];
  for(const x of pm){
    const mm = x.match(/^([A-Z]{2,4}\d?)(?: (DE|EN|FR|IT|ES|PT))? ([0-9OIS]{2,3})$/);
    if(mm && codes.has(mm[1]) && /P$/.test(mm[1])){ const n = toDigits(mm[3]); return { kind: "pk", code: mm[1], number: n, lang: LANG_TOKENS[mm[2]] || "", strong: true, key: `pk:${mm[1]}:${n}` }; }
  }
  return null;
}
// Kandidaten in der Datenbank suchen -> [{c, label, sub}]
function candidates(r){
  if(r.kind === "ygo" || r.kind === "ygopass") return ygoCandidates(r);
  if(r.kind === "jp") return jpCandidates(r);
  if(r.kind === "op"){
    const c = opApply({ game: "onepiece", number: r.id, language: LANG === "Japanisch" ? "Japanisch" : "Englisch" });
    return c.op ? [{ c, label: c.name, sub: `${c.op.id} · ${c.set}` }] : [];
  }
  const language = r.lang || LANG;
  const [left, right] = r.number.split("/");
  const total = parseInt(String(right || "").replace(/^[A-Z]+/, ""), 10);
  // passt die gedruckte Kartenzahl (/182) zum Set des Kürzels?
  const totalOk = code => {
    if(!isFinite(total) || /^[A-Z]/.test(right || "")) return true;
    const sets = CDB.byCode.get(CODE_ALIAS[code] || code) || [];
    return !sets.length || sets.some(st => !st.total || st.total === total || Math.abs(st.total - total) <= 3);
  };
  const tryCode = code => {
    const c = applyDb({ set_code: code, number: r.number, language });
    return c.db ? [{ c: finishPk(c, language), label: language === "Deutsch" && c.db.de ? c.db.de : c.db.en, sub: `${c.db.code} ${c.db.lid} · ${language === "Deutsch" ? c.db.setDe : c.db.setEn}` }] : [];
  };
  if(r.code && r.strong !== false && totalOk(r.code)){ const h = tryCode(r.code); if(h.length) return h; }
  // Kürzel falsch gelesen (z. B. "AR" statt "PAR")? -> ähnliche Kürzel mit passender Kartenzahl
  if(r.code && r.strong !== false && isFinite(total)){
    const sim = [...knownCodes()].filter(k => k !== r.code && lev(k, r.code) <= 1 && totalOk(k) && (CDB.byCode.get(CODE_ALIAS[k] || k) || []).some(st => st.total === total));
    const hits = sim.flatMap(tryCode);
    if(hits.length) return hits;
  }
  // ohne (passendes) Kürzel, z. B. ältere Karten: alle Sets mit passender Kartenzahl
  if(!CDB || !isFinite(total)) return [];
  const out = [];
  for(const st of CDB.byTotal.get(total) || []){
    const m = CDB.cards.get(st.id); if(!m) continue;
    for(const v of lidVariants(left)){ const e = m.get(v); if(e){
      const c = applyDb({ set_code: st.code || "", set: st.en, set_en: st.en, name: e[2], name_en: e[2], number: r.number, language });
      if(c.db) out.push({ c: finishPk(c, language), label: language === "Deutsch" && e[3] ? e[3] : e[2], sub: `${st.code ? st.code + " · " : ""}${language === "Deutsch" ? st.de || st.en : st.en} · ${r.number}` });
      break; } }
  }
  return out;
}
function lev(a, b){
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for(let j = 1; j <= n; j++) d[0][j] = j;
  for(let i = 1; i <= m; i++) for(let j = 1; j <= n; j++) d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return d[m][n];
}
function finishPk(c, language){
  c.game = "pokemon"; c.language = language;
  if(!c.name) c.name = language === "Deutsch" && c.db.de ? c.db.de : c.db.en;
  if(!c.set) c.set = language === "Deutsch" ? c.db.setDe : c.db.setEn;
  return c;
}

// ---------------- Karte übernehmen ----------------
let seq = 0;
// Browser bitten, die Sammlung nicht automatisch zu löschen (einmalig, ab der ersten Karte)
let persistAsked = false;
async function askPersist(){
  if(persistAsked || !navigator.storage || !navigator.storage.persist) return; persistAsked = true;
  try{ if(!(await navigator.storage.persisted())) await navigator.storage.persist(); }catch{}
}
function addCard(c, thumb){
  askPersist();
  if(typeof applyLearned === "function") applyLearned(c);
  if(typeof BATCH !== "undefined" && BATCH) BATCH.ok++;
  // gleiche Karte (gleiche Sprache) schon in der Sammlung -> Anzahl erhöhen
  const same = coll.find(x => identity(x) === identity(c));
  if(same){
    same.qty = qtyOf(same) + 1; same.t = Date.now(); if(!same.thumb && thumb) same.thumb = thumb;
    coll = [same, ...coll.filter(x => x !== same)]; saveCard(same); refreshTotals();
    document.querySelectorAll(`#results [data-card="${CSS.escape(same.id)}"]`).forEach(el => el.remove());
    document.querySelectorAll("#results .card.latest").forEach(el => { el.classList.remove("latest"); el.classList.add("old"); });
    const t = document.createElement("div"); t.innerHTML = cardHTML(same, "latest"); $("results").prepend(t.firstElementChild);
    if(navigator.vibrate) navigator.vibrate([40, 40, 40]);
    toast(`✓ ${same.name} – jetzt ${same.qty}× in der Sammlung`);
    priceSound(valueOf(same));
    return;
  }
  c.id = "d" + Date.now().toString(36) + (seq++).toString(36);
  c.t = Date.now(); c.thumb = thumb || ""; c.vi = 0;
  attachPrice(c);
  coll.unshift(c); saveCard(c); refreshTotals();
  if(typeof backupCheck === "function") backupCheck();
  if(typeof afterAdd === "function") afterAdd(c);
  document.querySelectorAll("#results .card.latest").forEach(el => { el.classList.remove("latest"); el.classList.add("old"); });
  const t = document.createElement("div"); t.innerHTML = cardHTML(c, "latest");
  $("results").prepend(t.firstElementChild);
  if(navigator.vibrate) navigator.vibrate(60);
  guessOpVariant(c).finally(() => ensureImg(c));
  toast(`✓ ${c.name} · ${c.op ? c.op.id : c.ygo ? c.number : cmCode(c)} · ${eur(valueOf(c))}`);
  priceSound(valueOf(c));
}
function chooseFrom(list, thumb, why){
  return new Promise(res => {
    const sh = $("sheet");
    $("sheetIn").innerHTML = `<h4>Welche Karte ist es?</h4><p>${esc(why)}</p>` +
      list.slice(0, 30).map((x, i) => `<button class="opt" data-pick="${i}"><span>${esc(x.label)}<br><small>${esc(x.sub)}</small></span><b>${eur(valueOf(attachPrice(x.c)))}</b></button>`).join("") +
      `<button class="opt" data-pick="-1" style="justify-content:center;color:var(--muted)">Keine davon – abbrechen</button>`;
    sh.hidden = false;
    sh.onclick = e => { const b = e.target.closest("[data-pick]"); if(!b && e.target !== sh) return; sh.hidden = true; sh.onclick = null; const i = b ? +b.dataset.pick : -1; res(i >= 0 ? list[i] : null); };
  });
}
// Auswahl direkt in der Liste (blockiert die Kamera nicht)
function inlinePick(list, thumb, why){
  const el = document.createElement("div"); el.className = "card pick";
  el.innerHTML = `<div class="rowc">${thumb ? `<img class="thumb" src="${thumb}" alt="">` : ""}<div class="info"><h3>❓ Welche Karte ist es?</h3><div class="meta">${esc(why)}</div></div></div>
    <div class="opts">${list.slice(0, 12).map((x, i) => `<button class="opt" data-i="${i}"><span>${esc(x.label)}<br><small>${esc(x.sub)}</small></span><b>${eur(valueOf(attachPrice(x.c)))}</b></button>`).join("")}
    <button class="opt none" data-i="-1">Keine davon – verwerfen</button></div>`;
  el.addEventListener("click", e => {
    const b = e.target.closest(".opt"); if(!b) return;
    const i = +b.dataset.i; el.remove();
    if(i >= 0) addCard(list[i].c, thumb);
  });
  $("results").prepend(el);
}
// Nicht erkannt: Karte bleibt in der Liste mit "Nochmal" / "Eingeben"
const FAILED = new Map();
function failCard(src, thumb, why){
  if(typeof BATCH !== "undefined" && BATCH) BATCH.fail++;
  const id = "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  FAILED.set(id, src);
  const el = document.createElement("div"); el.className = "card pick fail"; el.dataset.fail = id;
  el.innerHTML = `<div class="rowc">${thumb ? `<img class="thumb" src="${thumb}" alt="">` : ""}<div class="info"><h3>⚠️ Nicht erkannt</h3><div class="meta">${esc(why)}</div></div></div>
    <div class="links"><button class="btn secondary small" data-retry="${id}">🔁 Nochmal analysieren</button><button class="btn secondary small" data-type="${id}">✏️ Eingeben</button><button data-drop="${id}">Verwerfen</button></div>`;
  $("results").prepend(el);
}
document.addEventListener("click", async e => {
  const r = e.target.closest("[data-retry]"), t = e.target.closest("[data-type]"), d = e.target.closest("[data-drop]");
  const id = (r || t || d) && (r || t || d).dataset[r ? "retry" : t ? "type" : "drop"]; if(!id) return;
  const el = document.querySelector(`[data-fail="${id}"]`);
  if(d){ FAILED.delete(id); if(el) el.remove(); return; }
  if(t){ $("manualInput").focus(); $("manualInput").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  const src = FAILED.get(id); FAILED.delete(id); if(el) el.remove();
  if(src) await analyzePhoto(src, { keepCam: !!stream, thorough: true });
});
// höchstens kurz auf Yu-Gi-Oh!-Daten warten (Pokémon/One Piece sollen nicht ausgebremst werden)
const ygoSoon = (ms = 1500) => YGO ? Promise.resolve() : Promise.race([ygoLoad(), sleep(ms)]);
async function handleRead(r, thumb, inline){
  await Promise.all([cardDbReady, opDbReady, (r.kind === "ygo" || r.kind === "ygopass") ? ygoDbReady : Promise.resolve()]);
  const list = candidates(r);
  if(!list.length){ setStatus(`<b>${esc(r.code ? r.code + " " : "")}${esc(r.number || r.id || r.print || r.key)}</b> gelesen, aber nicht in der Datenbank gefunden. Karte etwas näher/gerader halten oder manuell eingeben.`); return false; }
  let pick = list[0];
  const sure = r.kind === "op" || (r.strong && list.length === 1);
  if(!sure && inline){
    inlinePick(list, thumb, r.kind === "ygopass" ? `Yu-Gi-Oh!-Karte „${list[0].label}“ erkannt – welche Ausgabe? (Set-Kürzel nicht lesbar)` : list.length > 1 ? `Nummer ${r.number} passt zu ${list.length} Sets` : `Kein Set-Kürzel sicher gelesen (Nummer ${r.number}) – bitte bestätigen`);
    return true;
  }
  if(!sure){
    paused = true;
    pick = await chooseFrom(list, thumb, r.kind === "ygopass" ? `„${list[0].label}“ erkannt – welche Ausgabe ist es?` : list.length > 1
      ? `Die Nummer ${r.number} passt zu ${list.length} Sets – welche ist es?`
      : `Kein Set-Kürzel sicher gelesen – ist es diese Karte? (Nummer ${r.number})`);
    paused = false;
    if(!pick) return false;
  }
  addCard(pick.c, thumb);
  return true;
}
function setStatus(h){ $("status").innerHTML = h; }

// ---------------- Texterkennung (Tesseract, läuft im Browser) ----------------
let worker = null;
// Mehrere Texterkennungs-Worker: Ausschnitte werden parallel gelesen (Handys haben 4–8 Kerne)
const POOL = [], POOL_WAIT = [];
const POOL_N = Math.max(2, Math.min(3, ((navigator.hardwareConcurrency || 4) >= 6) ? 3 : 2));
async function makeWorker(){
  const w = await Tesseract.createWorker("eng", 1, { workerPath: "lib/worker.min.js", corePath: "lib/core", langPath: "lib/lang", gzip: true, cacheMethod: "write" });
  await w.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/- ", tessedit_pageseg_mode: "11", preserve_interword_spaces: "1" });
  w.busy = false; POOL.push(w); poolNext(); return w;
}
function poolNext(){ while(POOL_WAIT.length){ const w = POOL.find(x => !x.busy); if(!w) return; w.busy = true; POOL_WAIT.shift()(w); } }
const poolGet = () => new Promise(res => { POOL_WAIT.push(res); poolNext(); });
const poolPut = w => { w.busy = false; poolNext(); };
async function ocr(canvas, wl){
  const w = await poolGet();
  try{
    if(wl) await w.setParameters({ tessedit_char_whitelist: wl });
    return ((await w.recognize(canvas)).data.text || "").replace(/\s+/g, " ").trim();
  } finally {
    if(wl) await w.setParameters({ tessedit_char_whitelist: WL }).catch(() => {});
    poolPut(w);
  }
}
// Texterkennung erst starten, wenn sie gebraucht wird (Scan-Knopf, Foto) oder das Handy kurz Ruhe hat
let _ocrP = null;
const ocrStart = () => _ocrP || (_ocrP = (async () => {
  $("ocrState").textContent = "Texterkennung wird geladen …";
  try{
    worker = await makeWorker();
    $("ocrState").textContent = "Texterkennung bereit ✓";
    // weitere Worker im Hintergrund nachladen (Start bleibt schnell)
    setTimeout(() => { for(let i = 1; i < POOL_N; i++) makeWorker().catch(e => console.warn(e)); }, 1500);
    return true;
  }catch(e){ console.error(e); $("ocrState").textContent = "Texterkennung konnte nicht geladen werden – manuelle Eingabe nutzen."; return false; }
})());
const ocrReady = { then(res, rej){ return ocrStart().then(res, rej); } };
// sobald jemand Richtung Scannen tippt, schon vorladen
document.addEventListener("pointerdown", e => { if(e.target.closest("#camCover, .camcover, #photoBtn, [for=photoInput], [for=galleryInput], #startBtn, #binderBtn, #barPhoto, .bottombar")){ ocrStart(); ygoLoad(); } }, true);
const idle = (f, ms) => setTimeout(() => ("requestIdleCallback" in window ? requestIdleCallback(f, { timeout: 4000 }) : f()), ms);
idle(() => ocrStart(), 2500);
idle(() => ygoLoad(), 6000);
// Bildausschnitt vorbereiten: Graustufen, Kontrast strecken, vergrößern
// chan: "min" = kleinster Farbkanal (weiße Schrift hebt sich von farbigem Grund ab),
//       "max" = größter Farbkanal (dunkle Schrift auf farbigem Grund) – für Full-Art-/Vollbildkarten
function prepStrip(src, sx, sy, sw, sh, invert, maxW, adaptive, chan){
  const scale = Math.min(3, (maxW || 1600) / sw);
  const cv = document.createElement("canvas"); cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high"; g.drawImage(src, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  const im = g.getImageData(0, 0, cv.width, cv.height), d = im.data;
  let mn = 1e9, mx = -1e9; const L = chan ? new Float32Array(d.length / 4) : new Uint8Array(d.length / 4);
  for(let i = 0, j = 0; i < d.length; i += 4, j++){
    const r = d[i], gg = d[i + 1], b = d[i + 2], hi = Math.max(r, gg, b), lo = Math.min(r, gg, b);
    // "white": hell UND ungesättigt (weiße/helle Schrift auf buntem Grund), "dark": dunkel UND ungesättigt
    const v = chan === "white" ? lo - 1.5 * (hi - lo) : chan === "dark" ? hi + 1.5 * (hi - lo) : chan === "min" ? lo : chan === "max" ? hi : (r * 299 + gg * 587 + b * 114) / 1000;
    L[j] = v; if(v < mn) mn = v; if(v > mx) mx = v; }
  if(chan){ const k2 = 255 / Math.max(1, mx - mn); for(let j = 0; j < L.length; j++) L[j] = (L[j] - mn) * k2; mn = 0; mx = 255; }
  const k = 255 / Math.max(1, mx - mn);
  if(adaptive){
    // lokale Schwelle: nur feine Kontraste (Schrift) werden schwarz, große Flächen (Bild, Tisch) weiß
    const w = cv.width, h = cv.height, r = Math.max(8, Math.round(w / 130)), W1 = w + 1;
    const ii = new Float64Array(W1 * (h + 1));
    for(let y = 0; y < h; y++){ let row = 0; for(let x = 0; x < w; x++){ row += L[y * w + x]; ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + row; } }
    for(let y = 0; y < h; y++){
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for(let x = 0; x < w; x++){
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const sum = ii[y1 * W1 + x1] - ii[y0 * W1 + x1] - ii[y1 * W1 + x0] + ii[y0 * W1 + x0];
        const mean = sum / ((y1 - y0) * (x1 - x0)), v = L[y * w + x];
        let o = chan ? (invert ? (v > mean + 22 ? 0 : 255) : (v < mean - 22 ? 0 : 255))
                     : invert ? (v > mean * 1.15 + 6 ? 0 : 255) : (v < mean * 0.85 - 6 ? 0 : 255);
        const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = o;
      }
    }
  } else {
    for(let i = 0, j = 0; i < d.length; i += 4, j++){ let v = (L[j] - mn) * k; if(invert) v = 255 - v; d[i] = d[i + 1] = d[i + 2] = v; }
  }
  g.putImageData(im, 0, 0);
  return cv;
}
async function ocrRegion(src, sx, sy, sw, sh, opts){
  const invs = (opts && opts.noInvert) ? [false] : [false, true];
  const res = await Promise.all(invs.map(async inv => {
    const t = await ocr(prepStrip(src, sx, sy, sw, sh, inv, opts && opts.maxW, opts && opts.adaptive));
    return { r: parseRead(t), text: t };
  }));
  return res.find(x => x.r) || { r: null, text: res.map(x => x.text).join(" ") };
}

// ---------------- Kamera ----------------
let stream = null, paused = false, busy = false, lastKey = "", lastAt = 0;
const recent = [];
function frameRect(){
  // Kartenrahmen (63:88) in der Kamera-Ansicht
  const cam = $("cam").getBoundingClientRect();
  if(document.body.classList.contains("scanmode")){
    // Vollbild-Scanner: Rahmen oberhalb der Kartenleiste, schmal genug für die Knöpfe rechts
    const top = 64, bottom = cam.height - 62 - 170, avail = Math.max(120, bottom - top);
    let H = avail * 0.94, W = H * 63 / 88;
    if(W > cam.width * 0.6){ W = cam.width * 0.6; H = W * 88 / 63; }
    return { x: (cam.width - W) / 2, y: top + (avail - H) / 2, w: W, h: H, cw: cam.width, ch: cam.height };
  }
  const h = cam.height * 0.86, w = h * 63 / 88;
  const W = Math.min(w, cam.width * 0.86), H = W * 88 / 63;
  return { x: (cam.width - W) / 2, y: (cam.height - H) / 2, w: W, h: H, cw: cam.width, ch: cam.height };
}
function placeFrame(){ const f = frameRect(), el = $("frame"); Object.assign(el.style, { left: f.x + "px", top: f.y + "px", width: f.w + "px", height: f.h + "px" }); }
window.addEventListener("resize", placeFrame);
// Rückkameras: Hauptkamera bevorzugen (Android: "camera2 0, facing back"), Weitwinkel/Tele/Tiefe meiden
let backCams = [], camIdx = -1;
async function listBackCams(){
  try{
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
    let back = devs.filter(d => /back|rück|rear|environment|hinten/i.test(d.label));
    if(!back.length) back = devs;
    const bad = d => /ultra|wide|weitwinkel|tele|depth|tiefe|macro/i.test(d.label) ? 1 : 0;
    const num = d => { const m = d.label.match(/camera2?\s*(\d+)/i); return m ? +m[1] : 99; };
    backCams = back.sort((a, b) => bad(a) - bad(b) || num(a) - num(b));
  }catch{ backCams = []; }
}
function savedCam(){ try{ return localStorage.getItem("cgd-cam") || ""; }catch{ return ""; } }
// Kamera anfordern – hängt die Freigabe (Abfrage übersehen/blockiert), nach 12 s abbrechen statt schwarzem Bild
function gum(constraints){
  return Promise.race([navigator.mediaDevices.getUserMedia(constraints),
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("Zeitüberschreitung"), { name: "TimeoutError" })), 12000))]);
}
async function openStream(deviceId){
  const base = { width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 30 } };
  const video = deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode: { ideal: "environment" } };
  return gum({ audio: false, video });
}
let CAM_ERR = "";
async function startCam(nextCam){
  CAM_ERR = "";
  if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; await sleep(150); }
  try{
    if(!backCams.length){
      // erst einmal Zugriff holen, sonst liefert enumerateDevices keine Namen
      const tmp = await gum({ video: { facingMode: { ideal: "environment" } } });
      tmp.getTracks().forEach(t => t.stop());
      await listBackCams();
      const sv = savedCam(); camIdx = Math.max(0, backCams.findIndex(d => d.deviceId === sv));
    } else if(nextCam) camIdx = (camIdx + 1) % backCams.length;
    const dev = backCams[camIdx];
    stream = await openStream(dev && dev.deviceId);
    if(dev) try{ localStorage.setItem("cgd-cam", dev.deviceId); }catch{}
  }catch(e){
    try{ stream = await openStream(""); }catch(e2){
      CAM_ERR = (e2 && e2.name) || (e && e.name) || "Error";
      setStatus("Kamera nicht verfügbar oder nicht erlaubt. Erlaube den Kamerazugriff in den Browser-Einstellungen – oder nutze „🖼️ Foto“ bzw. die manuelle Eingabe.");
      return;
    }
  }
  const v = $("video"); v.srcObject = stream; await v.play().catch(() => {});
  $("camCover").hidden = true; $("closeCam").hidden = false; placeFrame();
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  try{ if((caps.focusMode || []).includes("continuous")) await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); }catch{}
  // Kamera wechseln
  $("camBtn").hidden = backCams.length < 2;
  $("camBtn").textContent = `🔄 ${camIdx + 1}/${backCams.length}`;
  // Zoom: Handy weiter weg halten (Fokus!) und heranzoomen
  const zr = $("zoom");
  if(caps.zoom && caps.zoom.max > caps.zoom.min){
    zr.min = caps.zoom.min; zr.max = Math.min(caps.zoom.max, 4); zr.step = caps.zoom.step || 0.1;
    let z0 = 1.5; try{ z0 = +localStorage.getItem("cgd-zoom") || 1.5; }catch{}
    zr.value = Math.min(+zr.max, Math.max(+zr.min, z0));
    try{ await track.applyConstraints({ advanced: [{ zoom: +zr.value }] }); }catch{}
    $("zoomWrap").hidden = false; $("zoomVal").textContent = (+zr.value).toFixed(1) + "×";
    zr.oninput = async () => { $("zoomVal").textContent = (+zr.value).toFixed(1) + "×"; try{ await track.applyConstraints({ advanced: [{ zoom: +zr.value }] }); localStorage.setItem("cgd-zoom", zr.value); }catch{} };
  } else $("zoomWrap").hidden = true;
  // Tippen = neu scharfstellen
  $("cam").onclick = async e => {
    if(e.target.closest("button,input")) return;
    try{
      const r = $("cam").getBoundingClientRect();
      const pt = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
      const adv = {};
      if((caps.focusMode || []).includes("single-shot")) adv.focusMode = "single-shot";
      if(caps.pointsOfInterest !== undefined) adv.pointsOfInterest = [pt];
      await track.applyConstraints({ advanced: [adv] });
      if((caps.focusMode || []).includes("continuous")) setTimeout(() => track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {}), 1500);
      toast("🎯 Scharfstellen …");
    }catch{}
  };
  if(caps.torch){ const b = $("torchBtn"); b.hidden = false; b.onclick = async () => { const on = !b.classList.contains("on"); try{ await track.applyConstraints({ advanced: [{ torch: on }] }); b.classList.toggle("on", on); }catch{} }; }
  setStatus("<b>Auto-Foto:</b> Karte in den Rahmen legen und Handy ruhig halten (ca. 15–20 cm, Zoom-Regler nutzen). Sobald sie scharf ist, macht die App das Foto selbst. Danach einfach die nächste Karte hinlegen.");
  await Promise.all([ocrReady, cardDbReady, opDbReady, ygoSoon(), typeof jpLoad === "function" ? jpLoad() : 0]);
  if(!loop.running){ loop.running = true; loop().finally(() => loop.running = false); }
}
$("startBtn").onclick = () => startCam();
function stopCam(){
  if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
  const v = $("video"); v.srcObject = null;
  $("camCover").hidden = false; $("closeCam").hidden = true; $("torchBtn").hidden = true; $("torchBtn").classList.remove("on"); $("camBtn").hidden = true; $("zoomWrap").hidden = true;
  $("frame").classList.remove("focus", "hit"); $("readOut").textContent = "–"; steady = 0; armed = true; clearLive();
  setStatus("Kamera aus. <b>📸 Foto machen</b> oder <b>🎥 Auto-Foto</b> zum Weiterscannen.");
}
$("closeCam").onclick = e => { e.stopPropagation(); stopCam(); };
$("camBtn").onclick = e => { e.stopPropagation(); startCam(true); };
$("barScan").onclick = () => $("photoInput").click();
document.addEventListener("visibilitychange", () => { if(document.hidden && stream) stopCam(); });

// ---- Live-Kartenerkennung im Kamerabild ----
const LIVE = { at: 0, seen: 0, ok: false, stable: false, quad: null, prev: null };
function clearLive(){ LIVE.ok = LIVE.stable = false; LIVE.quad = LIVE.prev = null; drawLive(null); }
function liveDetect(v, X, Y, Wd, Hd){
  // Bereich etwas größer als der Rahmen, klein gerechnet
  const mx = Wd * 0.25, my = Hd * 0.15;
  const x0 = Math.max(0, X - mx), y0 = Math.max(0, Y - my), x1 = Math.min(v.videoWidth, X + Wd + mx), y1 = Math.min(v.videoHeight, Y + Hd + my);
  const k = 420 / Math.max(x1 - x0, y1 - y0);
  const c = LIVE.cv || (LIVE.cv = document.createElement("canvas"));
  c.width = Math.round((x1 - x0) * k); c.height = Math.round((y1 - y0) * k);
  c.getContext("2d").drawImage(v, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  let q = null; try{ q = findCardQuad(c); }catch{}
  if(!q || q.landscape){ LIVE.ok = LIVE.stable = false; LIVE.prev = null; drawLive(null); return; }
  const P = q.P.map(([x, y]) => [x0 + x / k, y0 + y / k]);
  // ruhig? Ecken bewegen sich kaum gegenüber der letzten Messung
  const size = Math.hypot(P[2][0] - P[0][0], P[2][1] - P[0][1]);
  LIVE.stable = !!LIVE.prev && P.every((p, i) => Math.hypot(p[0] - LIVE.prev[i][0], p[1] - LIVE.prev[i][1]) < size * 0.035);
  LIVE.prev = P; LIVE.quad = P; LIVE.ok = true; LIVE.seen = Date.now();
  drawLive(P);
}
function drawLive(P){
  const ov = $("quadOv"); if(!ov) return;
  const cam = $("cam").getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if(ov.width !== Math.round(cam.width * dpr)){ ov.width = Math.round(cam.width * dpr); ov.height = Math.round(cam.height * dpr); }
  const g = ov.getContext("2d"); g.clearRect(0, 0, ov.width, ov.height);
  const v = $("video"); if(!P || !v.videoWidth) return;
  const s = Math.max(cam.width / v.videoWidth, cam.height / v.videoHeight), ox = (v.videoWidth * s - cam.width) / 2, oy = (v.videoHeight * s - cam.height) / 2;
  g.save(); g.scale(dpr, dpr);
  g.beginPath(); P.forEach(([x, y], i) => { const px = x * s - ox, py = y * s - oy; i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath();
  g.lineWidth = 3; g.strokeStyle = LIVE.stable ? "#3ddc97" : "#22d3ee"; g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 6; g.stroke();
  g.fillStyle = LIVE.stable ? "rgba(61,220,151,.10)" : "rgba(34,211,238,.07)"; g.fill();
  g.restore();
}

// Auto-Foto: Schärfe (Laplace-Varianz) + Ruhe im Kartenrahmen messen -> automatisch auslösen
let armed = true, peak = 0, steady = 0, lastShotSharp = 0, lastShotAt = 0, shotSig = null;
async function loop(){
  const v = $("video");
  const SW = 96, SH = 134, sc = document.createElement("canvas"); sc.width = SW; sc.height = SH;
  const sg = sc.getContext("2d", { willReadFrequently: true });
  let prev = null;
  while(stream){
    if(paused || busy || !v.videoWidth || $("scan").hidden){ await sleep(200); prev = null; steady = 0; continue; }
    try{
      const f = frameRect(), vw = v.videoWidth, vh = v.videoHeight;
      const s = Math.max(f.cw / vw, f.ch / vh), ox = (vw * s - f.cw) / 2, oy = (vh * s - f.ch) / 2;
      const X = (f.x + ox) / s, Y = (f.y + oy) / s, Wd = f.w / s, Hd = f.h / s;
      sg.drawImage(v, X, Y, Wd, Hd, 0, 0, SW, SH);
      const d = sg.getImageData(0, 0, SW, SH).data, g = new Float32Array(SW * SH);
      let sum = 0;
      for(let i = 0, j = 0; i < d.length; i += 4, j++){ g[j] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; sum += g[j]; }
      const mean = sum / g.length; let vs = 0; for(const x of g) vs += (x - mean) * (x - mean);
      const contrast = Math.sqrt(vs / g.length);
      // Schärfe: Varianz des Laplace-Filters
      let ls = 0, ls2 = 0, n = 0;
      for(let y = 1; y < SH - 1; y++) for(let x = 1; x < SW - 1; x++){
        const i = y * SW + x, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - SW] - g[i + SW];
        ls += l; ls2 += l * l; n++;
      }
      const sharp = ls2 / n - (ls / n) * (ls / n);
      // Bewegung: Unterschied zum letzten Bild
      let motion = 99;
      if(prev){ let m = 0; for(let i = 0; i < g.length; i++) m += Math.abs(g[i] - prev[i]); motion = m / g.length; }
      prev = g;
      peak = Math.max(sharp, peak * 0.92);
      // Live-Kartenerkennung (alle ~350 ms): Rahmen um die echte Karte zeichnen
      if(typeof findCardQuad === "function" && Date.now() - LIVE.at > 350){ LIVE.at = Date.now(); liveDetect(v, X, Y, Wd, Hd); }
      // Foto NUR, wenn wirklich eine Karte (Kartenumriss) im Bild ist – nicht bei Tisch/Hintergrund
      const card = LIVE.ok, cardRecent = LIVE.seen && Date.now() - LIVE.seen < 700;
      if(!cardRecent && contrast > 18) NOCARD.t = NOCARD.t || Date.now(); else NOCARD.t = 0;
      if(!armed){
        // nach einem Foto: erst wieder auslösen, wenn die Karte weg ist oder eine deutlich andere Karte daliegt
        let diff = 0; if(shotSig){ for(let i = 0; i < g.length; i++) diff += Math.abs(g[i] - shotSig[i]); diff /= g.length; }
        if(Date.now() - lastShotAt > 700 && (!cardRecent || (card && diff > 22))){ armed = true; steady = 0; }
        $("readOut").textContent = "✓ Erfasst – nächste Karte hinlegen" + queueInfo();
      } else {
        const good = card && LIVE.stable && motion < 18 && sharp > 10 && sharp >= peak * 0.6;
        steady = good ? steady + 1 : 0;
        $("frame").classList.toggle("focus", steady > 0);
        $("readOut").textContent = (!card ? (NOCARD.t && Date.now() - NOCARD.t > 4000 ? "Keine Karte erkannt – Auslöser antippen" : "Karte in den Rahmen halten")
          : !LIVE.stable ? "Karte erkannt – ruhig halten …" : sharp <= 10 ? "Wird scharf gestellt …" : steady ? "Scharf ✓ – Foto!" : "Fokussiere …") + queueInfo();
        if(steady >= 2 && !window.UI_SINGLE){ shotSig = g; await autoShot(v, X, Y, Wd, Hd, sharp); }
      }
    }catch(e){ console.warn(e); }
    await sleep(60);
  }
}
// Auslöser von Hand (Einzelbild-Modus): aktuelles Kamerabild im Rahmen fotografieren
function manualShot(){
  const v = $("video"); if(!v.videoWidth || busy) return;
  const f = frameRect(), vw = v.videoWidth, vh = v.videoHeight;
  const s = Math.max(f.cw / vw, f.ch / vh), ox = (vw * s - f.cw) / 2, oy = (vh * s - f.ch) / 2;
  return autoShot(v, (f.x + ox) / s, (f.y + oy) / s, f.w / s, f.h / s, 99);
}
// Warteschlange: Kamera fotografiert weiter, Analyse läuft nacheinander im Hintergrund
const shotQ = []; let qRunning = false; const NOCARD = { t: 0 };
let SHOT_N = 0;
const smallThumb = cv => { try{ const c = document.createElement("canvas"), k = 150 / Math.max(cv.width, cv.height); c.width = Math.round(cv.width * k); c.height = Math.round(cv.height * k); c.getContext("2d").drawImage(cv, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.7); }catch{ return ""; } };
// sofort zeigen, dass ein Foto gemacht wurde (Kachel „erkenne …“), danach Ergebnis
function queueShot(cv, opts){
  const pid = ++SHOT_N;
  shotQ.push({ cv, opts, pid });
  if(typeof scanPending === "function") scanPending(pid, smallThumb(cv));
  runQueue();
}
function queueInfo(){ const n = shotQ.length + (qRunning ? 1 : 0); return n ? ` · ${n} in Analyse` : ""; }
async function runQueue(){
  if(qRunning) return; qRunning = true;
  try{ while(shotQ.length){
    const it = shotQ.shift(), cv = it.cv || it;
    const before = coll.reduce((s, c) => s + qtyOf(c), 0), t0 = Date.now();
    try{ await analyzePhoto(cv, it.opts || { keepCam: true, quick: true }); }catch(e){ console.warn(e); }
    if(it.pid && typeof scanDone === "function"){
      const added = coll.reduce((s, c) => s + qtyOf(c), 0) > before;
      scanDone(it.pid, added ? [...coll].filter(c => c.t >= t0).sort((a, b) => b.t - a.t)[0] || [...coll].sort((a, b) => b.t - a.t)[0] : null);
    }
  } }
  finally{ qRunning = false; if(typeof batchDone === "function") batchDone(); }
}
async function autoShot(v, X, Y, Wd, Hd, sharp){
  busy = true; armed = false; lastShotSharp = sharp; lastShotAt = Date.now(); steady = 0;
  $("frame").classList.remove("focus"); $("frame").classList.add("hit");
  const cam = $("cam"); cam.classList.add("flash"); setTimeout(() => cam.classList.remove("flash"), 350);
  if(navigator.vibrate) navigator.vibrate(40);
  // Karte live gefunden -> direkt gerade ausgeschnitten aus dem vollen Videobild verwenden
  if(LIVE.ok && LIVE.quad && Date.now() - LIVE.seen < 700){
    try{
      const full = document.createElement("canvas"); full.width = v.videoWidth; full.height = v.videoHeight;
      full.getContext("2d").drawImage(v, 0, 0);
      const card = warpCard(full, LIVE.quad, 1000);
      setTimeout(() => $("frame").classList.remove("hit"), 600);
      busy = false; lastShotAt = Date.now(); clearLive();
      queueShot(card); return;
    }catch(e){ console.warn(e); }
  }
  // Kartenbereich mit etwas Rand in voller Videoauflösung ausschneiden
  const mx = Wd * 0.12, my = Hd * 0.08;
  const x0 = Math.max(0, X - mx), y0 = Math.max(0, Y - my), x1 = Math.min(v.videoWidth, X + Wd + mx), y1 = Math.min(v.videoHeight, Y + Hd + my);
  const cv = document.createElement("canvas"); cv.width = Math.round(x1 - x0); cv.height = Math.round(y1 - y0);
  cv.getContext("2d").drawImage(v, x0, y0, x1 - x0, y1 - y0, 0, 0, cv.width, cv.height);
  setTimeout(() => $("frame").classList.remove("hit"), 600);
  busy = false; lastShotAt = Date.now();
  queueShot(cv);
}
function cardThumb(src, x, y, w, h){
  const c = document.createElement("canvas"); c.width = 120; c.height = Math.round(120 * 88 / 63);
  c.getContext("2d").drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

// ---------------- Foto-Analyse: Foto machen -> Karte im ganzen Bild suchen ----------------
const WL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/- ";
const FREE_WL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÄÖÜäöüßéÉèàç0123456789/-.'’:& ";
let NAMEIDX = null;   // normierter Kartenname -> Fundstellen
YGO_HOOKS.db.push(() => { NAMEIDX = null; });
function nameIndex(){
  if(NAMEIDX) return NAMEIDX;
  NAMEIDX = new Map();
  const add = (k, v) => { if(k.length < 4) return; if(!NAMEIDX.has(k)) NAMEIDX.set(k, []); NAMEIDX.get(k).push(v); };
  if(CDB) for(const st of CDB.sets.values()){ const m = CDB.cards.get(st.id); if(m) for(const e of m.values()){ add(nrm(e[2]), { kind: "pk", st, e }); if(e[3] && nrm(e[3]) !== nrm(e[2])) add(nrm(e[3]), { kind: "pk", st, e, de: true }); } }
  if(OPDB) for(const [id, e] of Object.entries(OPDB.cards)) add(nrm(e[0]), { kind: "op", id });
  if(YGO) for(const [pc, e] of Object.entries(YGO.c)){ add(nrm(e[0]), { kind: "ygo", pc: +pc }); if(e[1] && nrm(e[1]) !== nrm(e[0])) add(nrm(e[1]), { kind: "ygo", pc: +pc }); }
  return NAMEIDX;
}
// Kartennamen im Freitext finden (1–3 Wörter am Stück)
function namesInText(text){
  const idx = nameIndex(), words = String(text || "").split(/[^A-Za-zÀ-ÿ0-9.'’-]+/).filter(w => w.length >= 2);
  const found = new Map();
  for(let i = 0; i < words.length; i++) for(let n = 3; n >= 1; n--){
    const k = nrm(words.slice(i, i + n).join("")); if(k.length < 4) continue;
    if(idx.has(k) && !found.has(k)) found.set(k, idx.get(k));
  }
  return [...found.entries()].sort((a, b) => b[0].length - a[0].length);
}
function photoBox(thumb, text){
  document.querySelectorAll("#results .card.latest").forEach(el => { el.classList.remove("latest"); el.classList.add("old"); });
  const el = document.createElement("div"); el.className = "card latest";
  el.innerHTML = `<div class="rowc">${thumb ? `<img class="thumb" src="${thumb}" alt="">` : ""}<div class="info"><h3>📸 Foto wird analysiert …</h3><div class="meta" id="anaStep">${esc(text || "")}</div></div></div>`;
  $("results").prepend(el);
  if(!stream) el.scrollIntoView({ behavior: "smooth", block: "center" });   // bei offener Kamera bleibt die Ansicht oben
  return el;
}
async function analyzePhoto(file, opts){
  const keepCam = !!(opts && opts.keepCam);
  if(!keepCam) showTab("scan");
  let bmp;
  if(file instanceof HTMLCanvasElement) bmp = file;
  else { try{ bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }catch{ bmp = await createImageBitmap(file); } }
  // auf max. 2000 px (lange Seite) verkleinern – reicht für die kleine Schrift und bleibt schnell
  const k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  if(typeof photoTaken === "function" && !(opts && opts.quick)) photoTaken(cv);   // für Zentrierung/Grading-Etikett im Hintergrund
  const W = cv.width, H = cv.height;
  // Vorschaubild: Bildmitte im Kartenformat
  // Karte im Foto suchen und gerade ausschneiden (nicht beim Auto-Foto: da liegt sie schon im Rahmen)
  let st = (!opts || !opts.quick) && typeof straightenCard === "function" ? straightenCard(cv) : null;
  const tw = Math.min(W, H * 63 / 88), th = tw * 88 / 63;
  const thumb = st ? cardThumb(st.canvas, 0, 0, st.canvas.width, st.canvas.height) : cardThumb(cv, (W - tw) / 2, (H - th) / 2, tw, th);
  const box = photoBox(thumb, "Texterkennung startet …");
  const step = t => { const m = box.querySelector("#anaStep"); if(m) m.textContent = t; };
  // 0) Erkennung am Bild (Fingerabdruck) – schnell, braucht keine Texterkennung
  let fpRes = null;
  // mehrere Ausschnitte probieren: gefundene Karte, andere passende Vierecke, Bildmitte in drei Größen
  // (z. B. Karte vom Bildschirm abfotografiert oder gelber Rand auf hellem Grund)
  const quickShot = !!(opts && opts.quick), fpCands = [];
  if(st) fpCands.push(() => st.canvas);
  if(quickShot) fpCands.push(() => cv);
  else {
    if(st) for(const P of st.alts || []) fpCands.push(() => warpCard(cv, P));
    if(typeof cardCrop === "function") for(const f of [0.92, 0.8, 0.68]) fpCands.push(() => cardCrop(cv, f));
  }
  if(fpCands.length && typeof fpIdentify === "function"){
    step("Erkenne die Karte am Bild …");
    let fpBest = null;
    try{
      await Promise.all([cardDbReady, opDbReady]);
      for(const mk of fpCands){
        const src = mk(), r = await fpIdentify(src);
        if(r && (!fpRes || r.d < fpRes.d)){ fpRes = r; fpBest = src; }
        if(fpRes && fpRes.sure) break;
      }
    }catch(e){ console.warn(e); }
    // besserer Ausschnitt gefunden -> auch für die Texterkennung verwenden
    if(fpRes && fpRes.ok && fpBest && fpBest !== cv && (!st || fpBest !== st.canvas)) st = { canvas: fpBest, alts: [] };
    if(fpRes && fpRes.sure && fpRes.list.length === 1){
      box.remove(); addCard(fpRes.list[0].c, thumb); setStatus("✓ Karte am Bild erkannt."); return;
    }
  }
  await Promise.all([ocrReady, cardDbReady, opDbReady, ygoSoon(), typeof jpLoad === "function" ? jpLoad() : 0]);
  if(!worker){ box.remove(); setStatus("Texterkennung nicht verfügbar – bitte manuell eingeben."); return; }
  const wasPaused = paused; if(!keepCam) paused = true;
  const texts = [];
  const tryArea = async (src, x, y, w, h, label, opts) => {
    step(label);
    const { r, text } = await ocrRegion(src, x, y, w, h, opts);
    texts.push(text); $("readOut").textContent = text ? text.slice(0, 60) : "–";
    return keep(r);
  };
  // sichere Treffer (Kürzel direkt an der Nummer / One Piece) sofort nehmen, unsichere nur merken
  let weak = null;
  const keep = r => {
    if(!r || !candidates(r).length) return null;
    if(r.kind === "op" || r.strong) return r;
    if(!weak) weak = r;
    return null;
  };
  // ein Ausschnitt mit fester Schriftfarbe (normal / hell auf dunkel)
  const readArea = async (src, x, y, w, h, inv, maxW, chan) => {
    const text = await ocr(prepStrip(src, x, y, w, h, inv, maxW || 1700, true, chan));
    texts.push(text); $("readOut").textContent = text ? text.slice(0, 60) : "–";
    return keep(parseRead(text));
  };
  // mehrere Ausschnitte gleichzeitig lesen; erster sicherer Treffer gewinnt
  const race = async (label, jobs) => {
    step(label);
    let found = null;
    await new Promise(res => {
      let left = jobs.length; if(!left) return res();
      for(const j of jobs) j().then(r => { if(r && !found){ found = r; res(); } }).catch(() => {}).finally(() => { if(--left === 0) res(); });
    });
    return found;
  };
  let hit = null;
  try{
    // 1) wahrscheinlichste Stellen zuerst, parallel: unterer Kartenrand (Pokémon/One Piece, dunkle + helle Schrift)
    //    und die Zeile unter dem Bild (Yu-Gi-Oh!-Kürzel)
    const quick = opts && opts.quick;
    // 0) Karte wurde gefunden und gerade gerückt: dort sitzen Nummer/Kürzel an festen Stellen
    if(st){
      const C = st.canvas, CW = C.width, CH = C.height;
      hit = await race("Karte erkannt – lese Nummer …", [
        () => readArea(C, 0, CH * 0.85, CW, CH * 0.15, false, 1600),
        () => readArea(C, 0, CH * 0.85, CW, CH * 0.15, true, 1600),
        () => readArea(C, 0, CH * 0.85, CW, CH * 0.15, true, 1800, "min"),
        ...(YGO ? [() => readArea(C, CW * 0.45, CH * 0.69, CW * 0.55, CH * 0.08, false, 1300)] : [])
      ]);
    }
    if(!hit) hit = await race("Lese Kürzel + Nummer …", [
      () => readArea(cv, 0, H * 0.78, W, H * 0.22, false, 1500),
      () => readArea(cv, 0, H * 0.78, W, H * 0.22, true, 1500),
      ...(YGO ? [() => readArea(cv, W * 0.3, H * 0.62, W * 0.7, H * 0.17, false, 1300)] : [])
    ]);
    // 2) ganzes Foto (kleiner gerechnet = schneller), dunkle + helle Schrift – dazu für Full-Art-/farbige Karten
    //    der untere Rand mit getrennten Farbkanälen (weiße bzw. dunkle Schrift direkt auf dem Bild)
    if(!hit) hit = await race("Suche im ganzen Foto …", [
      () => readArea(cv, 0, 0, W, H, false, 1600),
      () => readArea(cv, 0, 0, W, H, true, 1600),
      () => readArea(cv, 0, H * 0.78, W, H * 0.22, true, 2100, "min"),
      () => readArea(cv, 0, H * 0.78, W, H * 0.22, true, 2100, "white")
    ]);
    // 3) waagerechte Streifen – je 2 Lagen × 2 Schriftfarben parallel
    const bands = quick ? [0.66, 0.58, 0.86] : [0.66, 0.58, 0.5, 0.42, 0.34, 0.86];
    for(let i = 0; !hit && i < bands.length; i += 2){
      const jobs = [];
      for(const b of bands.slice(i, i + 2)){
        const y = Math.max(0, H * b - H * 0.04), h = Math.min(H - y, H * 0.2);
        jobs.push(() => readArea(cv, 0, y, W, h, false, 1700), () => readArea(cv, 0, y, W, h, true, 1700));
      }
      hit = await race(`Suche Kürzel + Nummer … ${Math.min(i + 2, bands.length)}/${bands.length}`, jobs);
    }
    // 4) Querformat / gedrehte Karte (nicht beim Auto-Foto – da liegt die Karte gerade im Rahmen)
    if(!hit && !quick){
      const rot = dir => { const rc = document.createElement("canvas"); rc.width = H; rc.height = W; const g = rc.getContext("2d"); g.translate(dir > 0 ? H : 0, dir > 0 ? 0 : W); g.rotate(dir * Math.PI / 2); g.drawImage(cv, 0, 0); return rc; };
      const r1 = rot(1), r2 = rot(-1);
      hit = await race("Gedrehte Karte prüfen …", [() => readArea(r1, 0, 0, H, W, false, 1600), () => readArea(r2, 0, 0, H, W, false, 1600)]);
    }
    if(!hit && weak) hit = weak;   // nur Nummer gelesen -> Auswahl/Bestätigung statt automatisch
    // One Piece: Nummer mit dem Kartennamen gegenprüfen (verlesene Ziffern, z. B. OP16-098 -> OP18-008)
    if(hit && hit.kind === "op" && OPDB && !opNameIn(hit.id, texts.join(" "))){
      let all = texts.join(" ");
      if(st){ const C = st.canvas; try{ all += " " + await ocr(prepStrip(C, 0, C.height * 0.8, C.width, C.height * 0.14, false, 1600, true), FREE_WL); }catch{} }
      const id2 = opCheckName(hit.id, all);
      if(id2 !== hit.id) hit = { ...hit, id: id2, key: "op:" + id2 };
    }
    // Bild + Nummer: bei Nachdrucken (gleiches Motiv in mehreren Sets) entscheidet die gelesene Nummer
    if(hit && fpRes && fpRes.d <= FP_SURE && fpRes.list.length > 1){
      const ids = new Set(fpRes.list.map(x => identity(x.c))), m = candidates(hit).find(x => ids.has(identity(x.c)));
      if(m){ box.remove(); paused = wasPaused; addCard(m.c, thumb); setStatus("✓ Karte am Bild und an der Nummer erkannt."); return; }
    }
    if(hit){
      box.remove(); paused = wasPaused;
      if(await handleRead(hit, thumb, keepCam)) setStatus(hit.strong || hit.kind === "op" ? "✓ Karte aus dem Foto übernommen." : "✓ Karte nach deiner Bestätigung übernommen.");
      return;
    }
    // 3b) Nummer nicht lesbar, aber am Bild erkannt -> Ausgabe auswählen
    if(fpRes && fpRes.ok && fpRes.list.length){
      box.remove(); paused = wasPaused;
      const msg = fpRes.list.length > 1 ? `Am Bild erkannt: „${fpRes.list[0].label}“ – welche Ausgabe?` : `Ist es „${fpRes.list[0].label}“? (am Bild erkannt)`;
      if(keepCam){ inlinePick(fpRes.list, thumb, msg); return; }
      paused = true; const pick = await chooseFrom(fpRes.list, thumb, msg); paused = wasPaused;
      if(pick){ addCard(pick.c, thumb); setStatus("✓ Karte am Bild erkannt."); }
      return;
    }
    // 4) Kein Kürzel/keine Nummer: Kartenname lesen und in der Datenbank suchen
    step("Kein Kürzel gefunden – suche über den Kartennamen …");
    const frees = await Promise.all([false, true].map(inv => ocr(prepStrip(cv, 0, 0, W, H * 0.7, inv, 1600, true), FREE_WL).catch(() => "")));
    const free = frees.join(" ");
    const all = texts.join(" ") + " " + free;
    const nums = [...all.toUpperCase().matchAll(/\b([A-Z]{0,2}\d{1,3})\s*\/\s*([A-Z]{0,2}\d{2,3})\b/g)].map(m => m[1].replace(/^0+(?=\d)/, ""));
    const names = namesInText(free);
    const lang = LANG;
    const list = [];
    for(const [, hits] of names.slice(0, 3)){
      for(const h of hits){
        if(list.length > 60) break;
        if(h.kind === "ygo"){
          for(const x of ygoPrintsLabeled(h.pc, lang)) if(list.length <= 60) list.push({ ...x, score: 1 });
        } else if(h.kind === "op"){
          const c = opApply({ game: "onepiece", number: h.id, language: lang === "Japanisch" ? "Japanisch" : "Englisch" });
          if(c.op) list.push({ c, label: c.name, sub: `${c.op.id} · ${c.set}`, score: 1 });
        } else {
          const lid = String(h.e[0]);
          const numOk = nums.some(n => lidVariants(n).includes(lid.toUpperCase()));
          if(nums.length && !numOk) continue;
          const c = applyDb({ set_code: h.st.code || "", set: h.st.en, set_en: h.st.en, name: h.e[2], name_en: h.e[2], number: `${lid}/${h.st.total || ""}`, language: lang });
          if(c.db) list.push({ c: finishPk(c, lang), label: lang === "Deutsch" && h.e[3] ? h.e[3] : h.e[2], sub: `${h.st.code ? h.st.code + " · " : ""}${lang === "Deutsch" ? h.st.de || h.st.en : h.st.en} · Nr. ${lid}`, score: numOk ? 2 : 1 });
        }
      }
    }
    box.remove(); paused = wasPaused;
    if(!list.length){
      failCard(cv, thumb, "Kürzel, Nummer und Name nicht lesbar – Spiegelung/Licht? Nochmal versuchen oder eingeben.");
      setStatus("Eine Karte wurde nicht erkannt – sie steht mit „Nochmal analysieren“ in der Liste.");
      return;
    }
    list.sort((a, b) => b.score - a.score);
    if(keepCam){ inlinePick(list, thumb, `Name „${list[0].label}“ erkannt – welche Ausgabe?`); return; }
    paused = true;
    const pick = await chooseFrom(list, thumb, `Kartenname erkannt: „${list[0].label}“${nums.length ? "" : " – die Nummer war nicht lesbar"}. Welche Ausgabe ist es?`);
    paused = wasPaused;
    if(pick){ addCard(pick.c, thumb); setStatus("✓ Karte über den Namen gefunden."); }
  }catch(e){
    console.error(e); box.remove(); paused = wasPaused;
    failCard(cv, thumb, "Fehler bei der Analyse");
  }
}
$("photoInput").onchange = async e => {
  const files = [...e.target.files]; e.target.value = "";
  for(const f of files) await analyzePhoto(f);
};
$("galleryInput").onchange = async e => {
  const files = [...e.target.files]; e.target.value = "";
  for(const f of files) await analyzePhoto(f);
};

// ---------------- Ordnerseite: mehrere Karten auf einem Foto ----------------
let BINDER = { r: 3, c: 3 };
$("binderBtn").onclick = () => {
  const sh = $("sheet");
  $("sheetIn").innerHTML = `<h4>📒 Ordnerseite fotografieren</h4><p>Wie sind die Karten angeordnet? Fotografiere die Seite gerade von oben, sodass sie das Bild füllt. Leere Fächer werden übersprungen.</p>` +
    [[3, 3, "3 × 3 (9er-Seite)"], [2, 2, "2 × 2 (4er-Seite)"], [3, 4, "3 × 4 (12er-Seite)"], [2, 3, "2 × 3 – 6 Karten nebeneinander gelegt"], [1, 2, "2 Karten nebeneinander"]]
      .map(([r, c, t]) => `<button class="opt" data-grid="${r}x${c}"><span>${t}</span><b>${r * c}</b></button>`).join("") +
    `<button class="opt" data-grid="" style="justify-content:center;color:var(--muted)">Abbrechen</button>`;
  sh.hidden = false;
  sh.onclick = e => {
    const b = e.target.closest("[data-grid]"); if(!b && e.target !== sh) return;
    sh.hidden = true; sh.onclick = null;
    if(!b || !b.dataset.grid) return;
    const [r, c] = b.dataset.grid.split("x").map(Number); BINDER = { r, c };
    $("binderInput").click();
  };
};
$("binderInput").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if(!f) return;
  showTab("scan");
  let bmp; try{ bmp = await createImageBitmap(f, { imageOrientation: "from-image" }); }catch{ bmp = await createImageBitmap(f); }
  const k = Math.min(1, 4200 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  const { r: R, c: C } = BINDER, cw = cv.width / C, ch = cv.height / R;
  const cells = [];
  for(let y = 0; y < R; y++) for(let x = 0; x < C; x++){
    const p = 0.03;   // etwas Rand dazu – Karten sitzen nie exakt im Raster
    const sx = Math.max(0, (x - p) * cw), sy = Math.max(0, (y - p) * ch), sw = Math.min(cv.width - sx, cw * (1 + 2 * p)), sh = Math.min(cv.height - sy, ch * (1 + 2 * p));
    const c = document.createElement("canvas"); c.width = Math.round(sw); c.height = Math.round(sh);
    c.getContext("2d").drawImage(cv, sx, sy, sw, sh, 0, 0, c.width, c.height);
    if(!isEmptyCell(c)) cells.push(c);
  }
  setStatus(`📒 ${cells.length} Karte${cells.length === 1 ? "" : "n"} auf der Seite gefunden – werden nacheinander erkannt …`);
  if(typeof batchStart === "function") batchStart(cells.length);
  for(const c of cells) shotQ.push({ cv: c, opts: { keepCam: true } });   // jedes Fach wird zusätzlich gerade ausgeschnitten
  runQueue();
};
// leeres Fach: kaum Struktur im Bild
function isEmptyCell(c){
  const t = document.createElement("canvas"); t.width = 40; t.height = 56;
  const g = t.getContext("2d", { willReadFrequently: true }); g.drawImage(c, c.width * 0.15, c.height * 0.15, c.width * 0.7, c.height * 0.7, 0, 0, 40, 56);
  const d = g.getImageData(0, 0, 40, 56).data; let s = 0, s2 = 0, n = 0;
  for(let i = 0; i < d.length; i += 4){ const v = (d[i] + d[i + 1] + d[i + 2]) / 3; s += v; s2 += v * v; n++; }
  const m = s / n; return Math.sqrt(Math.max(0, s2 / n - m * m)) < 12;
}

// ---------------- Manuelle Eingabe ----------------
// Rückmeldung direkt unter dem Suchfeld (die Statuszeile oben ist auf dem Handy oft nicht im Bild)
function manualMsg(html, ok){
  let el = $("manualMsg");
  if(!el){ el = document.createElement("div"); el.id = "manualMsg"; $("manualForm").after(el); }
  el.className = "mmsg " + (ok ? "ok" : "bad"); el.innerHTML = html; el.hidden = !html;
}
function showNewest(){ const el = document.querySelector("#results > .card"); if(el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }
$("manualForm").onsubmit = async e => {
  e.preventDefault();
  const q = $("manualInput").value.trim(); if(!q){ $("manualInput").focus(); return; }
  $("manualInput").blur();
  manualMsg("🔍 Suche …", true);
  try{
    await Promise.all([cardDbReady, opDbReady, ygoDbReady, typeof jpLoad === "function" ? jpLoad() : 0]);
    let r = parseRead(q);
    if(!r && typeof jpCode === "function"){   // japanisch ohne Gesamtzahl: „SV2a 25“
      const m = q.toUpperCase().match(/^([A-Z0-9.\-]{2,7})\s+(\d{1,3})$/), st = m && jpCode(m[1]);
      const lid = st && m[2].padStart(3, "0");
      if(st && JP.cards.get(st.id) && JP.cards.get(st.id).has(lid)) r = { kind: "jp", sid: st.id, lid, strong: true, key: "m" };
    }
    if(!r){ const m = q.toUpperCase().match(/^([A-Z0-9]{2,5})\s*([A-Z]{0,2}\d{1,3})$/); if(m && knownCodes().has(m[1])) r = { kind: "pk", code: m[1], number: m[2], lang: "", strong: true, key: "m" }; }
    const byName = () => {
      const list = [];
      if(LANG === "Japanisch" && typeof jpAlternatives === "function") list.push(...jpAlternatives({ name_en: q, name_jp: q }).slice(0, 30));
      for(const [, hits] of namesInText(q).slice(0, 2)) for(const h of hits){
        if(list.length > 40) break;
        if(h.kind === "ygo") list.push(...ygoPrintsLabeled(h.pc, LANG));
        else if(h.kind === "op"){ const c = opApply({ game: "onepiece", number: h.id, language: LANG === "Japanisch" ? "Japanisch" : "Englisch" }); if(c.op) list.push({ c, label: c.name, sub: `${c.op.id} · ${c.set}` }); }
        else { const c = applyDb({ set_code: h.st.code || "", set: h.st.en, set_en: h.st.en, name: h.e[2], name_en: h.e[2], number: `${h.e[0]}/${h.st.total || ""}`, language: LANG }); if(c.db) list.push({ c: finishPk(c, LANG), label: LANG === "Deutsch" && h.e[3] ? h.e[3] : h.e[2], sub: `${h.st.code ? h.st.code + " · " : ""}${LANG === "Deutsch" ? h.st.de || h.st.en : h.st.en} · Nr. ${h.e[0]}` }); }
      }
      return list;
    };
    if(r && await handleRead(r, "")){ $("manualInput").value = ""; manualMsg(`✓ ${esc(coll[0] ? coll[0].name : "Karte")} übernommen`, true); setStatus("✓ Übernommen."); showNewest(); return; }
    const list = byName();
    if(list.length){ inlinePick(list, "", `„${list[0].label}“ – welche Ausgabe? (${list.length} gefunden)`); $("manualInput").value = ""; manualMsg(`${list.length} Treffer – tippe unten die richtige Ausgabe an`, true); showNewest(); return; }
    const cm = "https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=" + encodeURIComponent(q);
    const sets = r && r.code && CDB ? (CDB.byCode.get(CODE_ALIAS[r.code] || r.code) || []) : [];
    const maxNr = sets.length ? Math.max(...sets.map(x => x.total || 0)) : 0;
    const jpHint = r && r.code && /P$/.test(r.code) ? " Japanische Promos (z. B. SV-P mit Nummer über 225) sind nicht in der Datenbank." : "";
    manualMsg(r
      ? `❌ <b>${esc(q)}</b> gibt es in der Datenbank nicht.${maxNr ? ` Das Set ${esc(r.code)} hat Nummern bis ${maxNr}.` : ""}${jpHint} Versuch den Kartennamen oder <a href="${cm}" target="_blank" rel="noopener">auf Cardmarket suchen ↗</a>`
      : `❌ Nicht erkannt. Beispiele: <b>PAR 040</b>, <b>4/102</b>, <b>OP05-119</b>, <b>LOB-DE005</b> oder ein Kartenname wie <b>Glurak</b>.`, false);
  }catch(err){ console.error(err); manualMsg("❌ Fehler bei der Suche – bitte nochmal versuchen.", false); }
};


// ---------------- Start ----------------
Promise.all([collReady, pricesReady]).then(async () => {
  if(coll.some(c => c.ygo)) await ygoPricesReady;
  const ds = [PP && PP.date, OPP && OPP.date, YGOP && YGOP.date].filter(Boolean).sort();
  recordHistory(ds[ds.length - 1]);
  const latest = coll.slice(0, 5);
  $("results").innerHTML = latest.map((c, i) => cardHTML(c, i === 0 ? "" : "old")).join("");
});
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ---------------- Update-Knopf ----------------
const APP_FILES = ["./", "index.html", "app.js", "lib/cards.js", "lib/ygo.js", "lib/collection.js", "lib/sounds.js", "lib/cardfind.js", "lib/manage.js", "lib/extras.js", "sw.js", "manifest.webmanifest", "version.json"];
const getVer = () => { try{ return localStorage.getItem("cgd-ver") || ""; }catch{ return ""; } };
const setVer = v => { try{ localStorage.setItem("cgd-ver", v); }catch{} };
async function latestVersion(){
  try{ const d = await fetch("version.json?t=" + Date.now(), { cache: "no-store" }).then(r => r.json()); return d && d.v ? d : null; }catch{ return null; }
}
async function checkUpdate(silent){
  const btn = $("updBtn"), d = await latestVersion();
  if(!d){ $("verTxt").textContent = `Version ${getVer() || "?"} · offline`; return null; }
  let cur = getVer(); if(!cur){ setVer(d.v); cur = d.v; }
  if(d.v !== cur){
    btn.className = "btn primary"; btn.textContent = `⬆️ Neue Version ${d.v} installieren`;
    $("verTxt").textContent = `Installiert: ${cur} · Neu: ${d.v}${d.info ? " – " + d.info : ""}`;
    if(!silent) toast("Neue Version verfügbar – ganz unten auf „Update“ tippen");
  } else {
    btn.className = "btn secondary"; btn.textContent = "🔄 Nach Updates suchen";
    $("verTxt").textContent = `Version ${cur} · aktuell`;
  }
  return d;
}
async function doUpdate(){
  const btn = $("updBtn"); btn.disabled = true; btn.textContent = "Wird aktualisiert …";
  const d = await latestVersion();
  // neueste Dateien am Zwischenspeicher vorbei laden und alte Kopien entfernen (Texterkennung bleibt gespeichert)
  await Promise.all(APP_FILES.map(f => fetch(f, { cache: "reload" }).catch(() => {})));
  try{
    for(const k of await caches.keys()){ const c = await caches.open(k); for(const f of APP_FILES) await c.delete(new URL(f, location.href).href); }
  }catch{}
  try{ const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.update())); }catch{}
  if(d) setVer(d.v);
  location.replace("./?u=" + Date.now());
}
$("updBtn").onclick = async () => {
  const d = await latestVersion();
  if(d && d.v === getVer() && !$("updBtn").classList.contains("primary")){
    // schon aktuell – trotzdem frisch laden, falls etwas hängt
    toast("Du hast die neueste Version ✓"); $("verTxt").textContent = `Version ${d.v} · aktuell`;
    return;
  }
  doUpdate();
};
$("forceUpd").onclick = e => { e.preventDefault(); doUpdate(); };
checkUpdate(false);
document.addEventListener("visibilitychange", () => { if(!document.hidden) checkUpdate(true); });
