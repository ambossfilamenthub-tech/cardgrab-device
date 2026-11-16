// CardGrab Device – Sets-Fortschritt, Wunschliste mit Preisalarm, Lernen aus Korrekturen,
// Verkaufsliste teilen, Ordnerseiten-Zusammenfassung, Sicherungs-Erinnerung
"use strict";
const lsGet = (k, d) => { try{ const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; }catch{ return d; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };
const TRANSIENT = ["id", "t", "thumb", "qty", "cond", "buy", "folder", "grade", "cert", "center", "real", "realAt", "price", "versions", "img", "pv", "learned"];
const stripCard = c => { const o = {}; for(const k of Object.keys(c)) if(!TRANSIENT.includes(k)) o[k] = c[k]; return JSON.parse(JSON.stringify(o)); };
const cmHref = c => { const m = (c.ygo ? ygoLinks(c) : links(c)).match(/class="cm" href="([^"]+)"/); return m ? m[1].replace(/&amp;/g, "&") : ""; };

// ================= Lernen aus Korrekturen =================
// Wurde eine erkannte Karte über „Bearbeiten → Andere Ausgabe“ korrigiert, wird die Korrektur beim nächsten Scan automatisch übernommen.
const LKEY = "cgd-learn";
function learnSet(fromId, c){
  if(!fromId || fromId === identity(c)) return;
  const m = lsGet(LKEY, {}); m[fromId] = stripCard(c);
  const ks = Object.keys(m); if(ks.length > 300) delete m[ks[0]];
  lsSet(LKEY, m);
}
function applyLearned(c){
  const m = lsGet(LKEY, {}), L = m[identity(c)]; if(!L) return false;
  const lang = c.language;
  for(const k of Object.keys(c)) if(!["thumb"].includes(k)) delete c[k];
  Object.assign(c, JSON.parse(JSON.stringify(L)), { learned: true });
  if(lang && !c.language) c.language = lang;
  setTimeout(() => toast(`🧠 Gelernt: als „${c.name}“ (${c.number || c.set || ""}) übernommen`), 2300);
  return true;
}

// ================= Ordnerseite: Zusammenfassung =================
let BATCH = null;
function batchStart(n){ BATCH = { n, ok: 0, fail: 0, at: Date.now() }; }
function batchDone(){
  if(!BATCH) return; const b = BATCH; BATCH = null;
  const open = Math.max(0, b.n - b.ok - b.fail);
  const msg = `📒 Ordnerseite fertig: ${b.ok} von ${b.n} übernommen${open ? ` · ${open} bitte auswählen` : ""}${b.fail ? ` · ${b.fail} nicht erkannt` : ""} (${((Date.now() - b.at) / 1000).toFixed(0)} s)`;
  setStatus(msg); toast(msg);
}

// ================= Sicherungs-Erinnerung =================
let backupNagAt = 0;
function backupCheck(){
  const last = lsGet("cgd-lastbackup", 0) || 0;
  const n = coll.filter(c => c.t > last).length;
  if(n >= 15 && n >= backupNagAt + 15){
    backupNagAt = n;
    setTimeout(() => toastAction(`💾 ${n} neue Karten seit der letzten Sicherung`, "Jetzt sichern", () => $("exportBtn").click()), 2600);
  }
}

// ================= Ansicht-Umschalter in der Sammlung =================
let VIEW = "cards";
document.addEventListener("click", e => {
  const b = e.target.closest("[data-cview]"); if(!b) return;
  VIEW = b.dataset.cview;
  if(VIEW !== "cards" && typeof SELMODE !== "undefined" && SELMODE){ SELMODE = false; SEL.clear(); updSelBar(); }
  document.querySelectorAll("[data-cview]").forEach(x => x.classList.toggle("on", x === b));
  document.querySelectorAll(".cardsonly").forEach(x => x.hidden = VIEW !== "cards");
  $("extraView").hidden = VIEW === "cards";
  if(VIEW === "sets") renderSets(); else if(VIEW === "wish") renderWish();
});

// ================= Sets-Fortschritt =================
async function setGroups(){
  await Promise.all([cardDbReady, opDbReady]);
  if(coll.some(c => c.ygo)) await ygoDbReady;
  const G = new Map();
  const add = (key, mk, own) => { if(!G.has(key)){ const g = mk(); if(!g) return; g.own = new Set(); g.cards = 0; G.set(key, g); } const g = G.get(key); g.own.add(own); g.cards += qtyOf(own.c || {}) || 1; };
  for(const c of coll){
    if(c.ygo && YGO){
      const pre = c.set_code || String(c.number || "").split("-")[0];
      add("ygo:" + pre, () => {
        const keys = Object.keys(YGO.p).filter(k => k.startsWith(pre + "-")).sort();
        return keys.length ? { game: "yugioh", label: `${pre} · ${(YGO.s && YGO.s[pre]) || pre}`, all: keys, total: keys.length } : null;
      }, c.ygo.key);
    } else if(c.op && OPDB){
      const pre = c.op.id.split("-")[0];
      add("op:" + pre, () => {
        const keys = Object.keys(OPDB.cards).filter(k => k.startsWith(pre + "-")).sort();
        const st = [...OPDB.sets.values()].find(s => s.lab === pre);
        return keys.length ? { game: "onepiece", label: `${pre} · ${st ? st.title : opSetTitle(pre)}`, all: keys, total: keys.length } : null;
      }, c.op.id);
    } else if(c.db && c.db.sid && CDB){
      const sid = c.db.sid;
      add("pk:" + sid, () => {
        const st = CDB.sets.get(sid), m = CDB.cards.get(sid); if(!st || !m) return null;
        const de = c.language === "Deutsch";
        return { game: "pokemon", sid, label: `${st.code ? st.code + " · " : ""}${de && st.de ? st.de : st.en}`, all: [...m.keys()].sort((a, b) => a.localeCompare(b, "de", { numeric: true })), total: st.total || m.size, st };
      }, c.db.lid);
    }
  }
  return G;
}
async function renderSets(){
  const box = $("extraView"); box.innerHTML = `<div class="note">Sets werden berechnet …</div>`;
  const G = await setGroups();
  if(!G.size){ box.innerHTML = `<div class="empty">Noch keine Karten mit bekanntem Set in der Sammlung.</div>`; return; }
  const rows = [...G.entries()].map(([k, g]) => {
    const main = g.game === "pokemon" ? g.all.filter(l => /^\d+$/.test(l) && +l <= g.total) : g.all;
    const ownMain = main.filter(l => g.own.has(l)).length;
    return { k, g, ownMain, main: main.length, extra: g.own.size - ownMain, pct: main.length ? ownMain / main.length : 0 };
  }).sort((a, b) => b.pct - a.pct);
  box.innerHTML = `<div class="sub">Deine Sets · tippen für fehlende Karten</div>` + rows.map(r => `
    <button class="setrow" data-set="${esc(r.k)}">
      <span class="sn">${{ pokemon: "⚡", onepiece: "🏴‍☠️", yugioh: "🔺" }[r.g.game] || ""} ${esc(r.g.label)}</span>
      <span class="sc"><b>${r.ownMain}</b> / ${r.main}${r.extra > 0 ? ` <small>+${r.extra} Extra</small>` : ""}</span>
      <span class="bar"><i style="width:${(r.pct * 100).toFixed(1)}%"></i></span>
    </button>`).join("");
  SETS_CACHE = G;
}
let SETS_CACHE = null;
function missingCard(g, key, lang){
  if(g.game === "pokemon"){
    const st = g.st, e = CDB.cards.get(g.sid).get(key);
    const x = applyDb({ set_code: st.code || "", set: st.en, set_en: st.en, name: e[2], name_en: e[2], number: `${e[0]}/${st.total || ""}`, language: lang });
    if(!x.db) return null; return attachPrice(finishPk(x, lang));
  }
  if(g.game === "onepiece") return attachPrice(opApply({ game: "onepiece", number: key, language: lang === "Japanisch" ? "Japanisch" : "Englisch" }));
  if(g.game === "yugioh"){ const pc = (YGO.p[key] || [])[0]; return pc ? attachPrice(ygoMake(key, pc[0], lang)) : null; }
  return null;
}
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-set]"); if(!b || !SETS_CACHE) return;
  const g = SETS_CACHE.get(b.dataset.set); if(!g) return;
  const lang = (coll.find(c => g.own.has(c.ygo ? c.ygo.key : c.op ? c.op.id : c.db && c.db.lid)) || {}).language || LANG;
  const miss = g.all.filter(k => !g.own.has(k)).sort((a, b) => a.localeCompare(b, "de", { numeric: true }));
  const list = miss.slice(0, 400).map(k => missingCard(g, k, lang)).filter(Boolean);
  const sum = list.reduce((s, c) => s + valueOf(c), 0);
  MISS = list;
  const sh = $("sheet");
  $("sheetIn").innerHTML = `<h4>${esc(g.label)}</h4><p>${miss.length ? `Dir fehlen <b>${miss.length}</b> Karten${sum > 0 ? ` · zusammen ab ca. <b>${eur(sum)}</b>` : ""}.` : "🎉 Set komplett!"}</p>
    <div class="pickl">${list.map((c, i) => `<div class="missrow"><span><b>${esc(c.name)}</b><br><small>${esc(c.op ? c.op.id : c.ygo ? c.number : (c.db ? "Nr. " + c.db.lid : c.number))}${c.rarity ? " · " + esc(c.rarity) : ""}</small></span>
      <span class="mp">${valueOf(c) > 0 ? eur(valueOf(c)) : "–"}</span>
      <a class="mbtn" href="${esc(cmHref(c))}" target="_blank" rel="noopener" title="Bei Cardmarket kaufen">🛒</a><button class="mbtn" data-mwish="${i}" title="Auf Wunschliste">⭐</button></div>`).join("")}</div>
    <button class="opt" data-close style="justify-content:center;color:var(--muted)">Schließen</button>`;
  sh.hidden = false;
  sh.onclick = ev => {
    const w = ev.target.closest("[data-mwish]"); if(w){ wishAdd(MISS[+w.dataset.mwish]); w.textContent = "✓"; return; }
    if(ev.target.closest("[data-close]") || ev.target === sh){ sh.hidden = true; sh.onclick = null; }
  };
});
let MISS = [];

// ================= Wunschliste mit Preisalarm =================
const WKEY = "cgd-wish";
const wishList = () => lsGet(WKEY, []);
function wishAdd(c){
  if(!c) return;
  const l = wishList(), card = stripCard(c), id = identity(c);
  if(l.some(w => w.k === id)){ toast("Ist schon auf der Wunschliste ⭐"); return; }
  l.unshift({ w: "w" + Date.now().toString(36), k: id, card, target: 0, p0: valueOf(c) || 0, t: Date.now() });
  lsSet(WKEY, l.slice(0, 500)); toast(`⭐ „${c.name}“ auf die Wunschliste gesetzt`); updWishBadge();
}
function wishPriced(){ return wishList().map(w => { const c = attachPrice(Object.assign({}, w.card)); return { w, c, v: valueOf(c) }; }); }
function wishHits(){ return wishPriced().filter(x => x.w.target > 0 && x.v > 0 && x.v <= x.w.target); }
function updWishBadge(){ const b = $("wishCnt"); if(!b) return; const n = wishList().length, h = wishHits().length; b.textContent = n ? (h ? `${n} · 🔔${h}` : n) : ""; }
async function renderWish(){
  await Promise.all([cardDbReady, opDbReady, pricesReady]);
  if(wishList().some(w => w.card.ygo)){ await ygoLoad(); await ygoPricesReady; }
  const box = $("extraView"), L = wishPriced();
  box.innerHTML = `<form id="wishForm" class="tools"><input id="wishQ" placeholder="Karte suchen: Name (z. B. Glurak) …" autocomplete="off"><button class="btn small">＋</button></form>` +
    (L.length ? `<div class="sub">Wunschliste · Zielpreis eintragen, die App meldet sich, wenn der Preis darunter fällt</div>` + L.map(({ w, c, v }) => {
      const hit = w.target > 0 && v > 0 && v <= w.target, d = w.p0 > 0 && v > 0 ? v - w.p0 : 0;
      return `<div class="wishrow${hit ? " hit" : ""}">
        <div class="wi"><b>${esc(c.name)}</b><small>${esc([c.op ? c.op.id : c.number, c.set, c.language].filter(Boolean).join(" · "))}</small></div>
        <div class="wp"><b>${v > 0 ? eur(v) : "–"}</b>${d ? `<small class="${d < 0 ? "up" : "down"}">${d < 0 ? "▼" : "▲"} ${eur(Math.abs(d))}</small>` : ""}${hit ? `<small class="up">🔔 unter Ziel</small>` : ""}</div>
        <label class="wt">Ziel € <input type="number" inputmode="decimal" min="0" step="0.01" value="${w.target || ""}" data-wtarget="${esc(w.w)}" placeholder="–"></label>
        <div class="wa"><a class="mbtn" href="${esc(cmHref(c))}" target="_blank" rel="noopener">🛒 Cardmarket</a><button class="mbtn" data-wgot="${esc(w.w)}">✓ Gekauft</button><button class="mbtn" data-wdel="${esc(w.w)}">✕</button></div>
      </div>`; }).join("") : `<div class="empty">Noch nichts auf der Wunschliste.<br><small>Fehlende Karten findest du unter 📚 Sets – oder oben suchen.</small></div>`);
  $("wishForm").onsubmit = async ev => {
    ev.preventDefault(); const q = $("wishQ").value.trim(); if(!q) return;
    const alts = await alternativesFor({ name: q, name_en: q, language: LANG });
    if(!alts.length){ toast("Nichts gefunden – Namen auf Deutsch oder Englisch probieren"); return; }
    const i = await pickFrom(`„${q}“ – welche Karte?`, alts.slice(0, 60).map((a, i) => ({ v: i, label: a.label, sub: a.sub }))); if(i === undefined) return;
    wishAdd(attachPrice(alts[i].c)); renderWish();
  };
  updWishBadge();
}
document.addEventListener("change", e => {
  const t = e.target.closest("[data-wtarget]"); if(!t) return;
  const l = wishList(), w = l.find(x => x.w === t.dataset.wtarget); if(!w) return;
  w.target = Math.max(0, parseFloat(String(t.value).replace(",", ".")) || 0); lsSet(WKEY, l); renderWish();
});
document.addEventListener("click", e => {
  const d = e.target.closest("[data-wdel]"), g = e.target.closest("[data-wgot]"); if(!d && !g) return;
  const id = (d || g).dataset[d ? "wdel" : "wgot"], l = wishList(), w = l.find(x => x.w === id); if(!w) return;
  lsSet(WKEY, l.filter(x => x !== w));
  if(g){ const c = Object.assign({}, w.card); addCard(c, ""); toast(`✓ „${c.name}“ in die Sammlung übernommen`); }
  renderWish();
});
// Preisalarm beim Öffnen (Preise werden täglich aktualisiert)
async function wishAlarm(){
  await Promise.all([cardDbReady, opDbReady, pricesReady]);
  if(!wishList().length) return;
  if(wishList().some(w => w.card.ygo)){ await ygoLoad(); await ygoPricesReady; }
  updWishBadge();
  const hits = wishHits(); if(!hits.length) return;
  const seen = lsGet("cgd-wishseen", {}), fresh = hits.filter(h => seen[h.w.w] !== h.v);
  if(!fresh.length) return;
  fresh.forEach(h => seen[h.w.w] = h.v); lsSet("cgd-wishseen", seen);
  setTimeout(() => toastAction(fresh.length === 1 ? `🔔 „${fresh[0].c.name}“ ist jetzt ${eur(fresh[0].v)} – unter deinem Zielpreis!` : `🔔 ${fresh.length} Karten deiner Wunschliste sind unter dem Zielpreis`, "Ansehen",
    () => { showTab("coll"); document.querySelector('[data-cview="wish"]').click(); }), 1500);
}
setTimeout(wishAlarm, 3000);

// ================= Verkaufsliste als Bild teilen =================
async function shareList(){
  const l = (LAST_LIST && LAST_LIST.length ? LAST_LIST : coll).slice(0, 60);
  if(!l.length){ toast("Keine Karten in der Liste"); return; }
  const folder = $("fFolder") && $("fFolder").value && !["-", "+"].includes($("fFolder").value) ? $("fFolder").value : "";
  const title = folder ? `📁 ${folder}` : "Meine Karten";
  const W = 1080, RH = 150, HD = 170, H = HD + l.length * RH + 90;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, "#15122b"); grd.addColorStop(1, "#0a0916"); g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.fillStyle = "#22d3ee"; g.font = "800 54px system-ui,sans-serif"; g.fillText(title, 48, 86);
  const tot = l.reduce((s, c) => s + totalOf(c), 0), cnt = l.reduce((s, c) => s + qtyOf(c), 0);
  g.fillStyle = "#b9b4d6"; g.font = "600 30px system-ui,sans-serif"; g.fillText(`${cnt} Karten${tot > 0 ? ` · Cardmarket-Wert ab ${eur(tot)}` : ""} · Stand ${new Date().toLocaleDateString("de-DE")}`, 48, 136);
  const load = src => new Promise(r => { if(!src) return r(null); const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = src; });
  for(let i = 0; i < l.length; i++){
    const c = l[i], y = HD + i * RH;
    g.fillStyle = i % 2 ? "rgba(255,255,255,.035)" : "rgba(255,255,255,.07)"; g.fillRect(32, y, W - 64, RH - 12);
    const im = await load(safeThumb(c.thumb)); if(im) g.drawImage(im, 44, y + 8, 92, 128);
    const x0 = im ? 156 : 56;
    g.fillStyle = "#fff"; g.font = "700 36px system-ui,sans-serif"; g.fillText(fit(g, c.name + (qtyOf(c) > 1 ? `  ×${qtyOf(c)}` : ""), 600), x0, y + 56);
    g.fillStyle = "#b9b4d6"; g.font = "500 27px system-ui,sans-serif";
    g.fillText(fit(g, [c.op ? c.op.id : c.ygo ? c.number : (cmCode(c) || c.number), c.set, c.language, c.cond || "NM", c.grade].filter(Boolean).join(" · "), 640), x0, y + 102);
    const v = valueOf(c); g.textAlign = "right"; g.fillStyle = "#3ddc97"; g.font = "800 40px system-ui,sans-serif"; g.fillText(v > 0 ? eur(v) : "–", W - 56, y + 80); g.textAlign = "left";
  }
  g.fillStyle = "#7d7799"; g.font = "500 24px system-ui,sans-serif"; g.fillText("Preise: Cardmarket-Richtwerte ohne Gewähr · erstellt mit CardGrab", 48, H - 36);
  const text = `${title.replace("📁 ", "")} – ${cnt} Karten\n` + l.map(c => `• ${c.name}${qtyOf(c) > 1 ? ` ×${qtyOf(c)}` : ""} (${[c.op ? c.op.id : c.ygo ? c.number : (cmCode(c) || c.number), c.language, c.cond || "NM", c.grade].filter(Boolean).join(", ")})${valueOf(c) > 0 ? " – " + eur(valueOf(c)) : ""}`).join("\n");
  const blob = await new Promise(r => cv.toBlob(r, "image/png"));
  const file = new File([blob], `cardgrab-liste-${new Date().toISOString().slice(0, 10)}.png`, { type: "image/png" });
  try{
    if(navigator.canShare && navigator.canShare({ files: [file] })){ await navigator.share({ files: [file], text, title }); return; }
  }catch(e){ if(e && e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  try{ await navigator.clipboard.writeText(text); toast("Bild gespeichert · Liste als Text kopiert"); }catch{ toast("Bild gespeichert"); }
}
function fit(g, t, w){ t = String(t || ""); if(g.measureText(t).width <= w) return t; while(t.length > 3 && g.measureText(t + "…").width > w) t = t.slice(0, -1); return t + "…"; }
document.addEventListener("click", e => { if(e.target.closest("#shareBtn")) shareList(); });
