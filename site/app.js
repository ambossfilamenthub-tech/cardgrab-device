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
function toast(t){ const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2200); }

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
ygoPricesReady.then(d => { if(!d) return; coll.forEach(c => { if(c.ygo){ attachPrice(c); rerender(c); } }); refreshTotals(); });
// Preis an Karte hängen: {low, trend, avg7, avg30, holo:{…}, src}
function attachPrice(c){
  if(c.ygo) return ygoAttachPrice(c);
  if(c.op){
    const vs = (OPP && OPP.c && OPP.c[c.op.id]) || [];
    c.versions = vs.map(v => ({ id: v[0], low: v[1], trend: v[2], avg7: v[3], avg30: v[4], guess: !!v[5], pack: v[6] || "" }));
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
async function removeCard(id){
  coll = coll.filter(c => c.id !== id);
  try{ await idb.del(id); }catch{}
  document.querySelectorAll(`[data-card="${CSS.escape(id)}"]`).forEach(el => el.remove());
  refreshTotals(); renderColl();
}
const collReady = (async () => {
  try{ coll = (await idb.all()) || []; }catch{ coll = []; }
  coll.sort((a, b) => b.t - a.t);
  await Promise.all([cardDbReady, opDbReady, ygoDbReady]);
  coll.forEach(c => attachPrice(c));
  refreshTotals();
})();
function refreshTotals(){
  const sum = coll.reduce((s, c) => s + valueOf(c), 0);
  $("collVal").textContent = eur(sum) === "–" ? "0 €" : eur(sum); $("barVal").textContent = $("collVal").textContent;
  $("collCnt").textContent = coll.length;
  $("barCnt").textContent = `Sammlung: ${coll.length} Karte${coll.length === 1 ? "" : "n"}`;
  $("tabCount").textContent = coll.length ? `(${coll.length})` : "";
}
function renderColl(){
  const q = $("search").value.trim().toLowerCase(), so = $("sort").value;
  let l = coll.filter(c => !q || [c.name, c.name_en, c.set, c.set_code, c.number, c.op && c.op.id, c.ygo && c.ygo.key, { pokemon: "pokemon", onepiece: "one piece", yugioh: "yugioh yu-gi-oh" }[c.game]].join(" ").toLowerCase().includes(q));
  if(so === "val") l.sort((a, b) => valueOf(b) - valueOf(a));
  else if(so === "name") l.sort((a, b) => String(a.name).localeCompare(String(b.name), "de"));
  else if(so === "set") l.sort((a, b) => String(a.set).localeCompare(String(b.set), "de") || String(a.number).localeCompare(String(b.number), "de", { numeric: true }));
  else l.sort((a, b) => b.t - a.t);
  $("collList").innerHTML = l.length ? l.map(c => cardHTML(c, "old")).join("") : `<div class="empty">${coll.length ? "Keine Treffer." : "Noch keine Karten. Scanne deine erste Karte!"}</div>`;
}
$("search").oninput = renderColl; $("sort").onchange = renderColl;
$("exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify({ app: "CardGrab Device", v: 1, date: new Date().toISOString(), cards: coll.map(persistable) })], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `cardgrab-sammlung-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
$("importInput").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if(!f) return;
  try{
    const d = JSON.parse(await f.text()); const cards = Array.isArray(d) ? d : d.cards || [];
    let n = 0;
    for(const c of cards){ if(!c || !c.id || coll.some(x => x.id === c.id)) continue; attachPrice(c); coll.push(c); await saveCard(c); n++; }
    coll.sort((a, b) => b.t - a.t); refreshTotals(); renderColl(); toast(`${n} Karten geladen`);
  }catch{ toast("Datei konnte nicht gelesen werden"); }
};

// ---------------- Kartendarstellung ----------------
function cardHTML(c, mode){
  const p = c.price;
  const code = c.op ? c.op.id : c.ygo ? c.number : cmCode(c) || c.number || "";
  const holo = p && (p.trendH || p.lowH);
  const v = valueOf(c);
  const vers = c.ygo && c.versions && c.versions.length > 1
    ? `<div class="vers">${c.versions.map((x, i) => `<button data-ver="${esc(c.id)}" data-i="${i}" class="${i === (c.vi || 0) ? "on" : ""}">${esc(x.pack || "V" + (i + 1))} · ${eur(x.low || x.trend)}</button>`).join("")}</div>
       <div class="note">Diese Karte gibt es in diesem Set ${c.versions.length}× (verschiedene Seltenheiten) – wähle deine.${c.versions.some(x => x.guess) ? " Zuordnung geschätzt – im Zweifel auf Cardmarket prüfen." : ""}</div>`
    : c.op && c.versions && c.versions.length > 1
    ? `<div class="vers">${c.versions.map((x, i) => `<button data-ver="${esc(c.id)}" data-i="${i}" class="${i === (c.vi || 0) ? "on" : ""}">V${i + 1}${x.pack && x.pack !== (c.op && c.op.id.split("-")[0]) ? " " + esc(x.pack) : ""} · ${eur(x.low || x.trend)}</button>`).join("")}</div>
       <div class="note">Diese Karte gibt es ${c.versions.length}× (normal, Parallel/Alt Art, Reprints). Wähle die Version mit deinem Motiv – V1 ist meist die normale Karte.${c.versions.some(x => x.guess) ? " Zuordnung der Versionen geschätzt – im Zweifel auf Cardmarket prüfen." : ""}</div>` : "";
  const rh = holo ? `<div class="vers"><button data-rh="${esc(c.id)}" data-v="0" class="${!c.rh ? "on" : ""}">Normal</button><button data-rh="${esc(c.id)}" data-v="1" class="${c.rh ? "on" : ""}">Reverse Holo</button></div>` : "";
  const pr = p ? `<div class="prices">
      <div><span>ab ${c.real > 0 ? "(alle)" : p.est ? "(ca.)" : ""}</span><b>${eur(c.rh && p.lowH ? p.lowH : p.low)}</b></div>
      <div><span>Trend</span><b>${eur(c.rh && p.trendH ? p.trendH : p.trend)}</b></div>
      <div><span>30-T-Ø</span><b>${eur(c.rh && p.avg30H ? p.avg30H : p.avg30)}</b></div></div>`
    : `<div class="note">${(c.op ? OPP : c.ygo ? YGOP : PP) ? "Für diese Karte steht kein Preis in der Cardmarket-Liste – tippe auf den Cardmarket-Button." : "Preisliste noch nicht geladen (sie wird jeden Morgen aktualisiert)."}</div>`;
  return `<div class="card ${mode || ""}" data-card="${esc(c.id)}">
    <div class="rowc">
      ${c.thumb ? `<img class="thumb" src="${c.thumb}" alt="">` : `<div class="thumb"></div>`}
      <div class="info">
        <h3>${esc(c.name || c.name_en || "Unbekannt")}${c.name_jp && c.name_jp !== c.name ? ` <span style="font-weight:400;color:var(--muted);font-size:13px">${esc(c.name_jp)}</span>` : ""}</h3>
        <div class="meta"><span class="game g-${esc(c.game || "pokemon")}">${{ onepiece: "One Piece", yugioh: "Yu-Gi-Oh!" }[c.game] || "Pokémon"}</span> <b>${esc(code)}</b>${c.set ? " · " + esc(c.set) : ""}${c.rarity && c.ygo ? " · " + esc(c.rarity) : ""}${c.language ? " · " + esc(c.language) : ""}</div>
      </div>
      <div class="val"><div class="l">${c.real > 0 ? "ab · " + langShort(c) + " ✓" : "ab"}</div><div class="p">${eur(v)}</div></div>
    </div>
    ${pr}${rh}${vers}
    <div class="real"><span>Günstigster Preis in <b>${langLong(c)}</b> (DE-Verkäufer, NM) – vom Cardmarket-Button ablesen:</span>
      <input type="text" inputmode="decimal" data-real="${esc(c.id)}" value="${c.real > 0 ? String(c.real).replace(".", ",") : ""}" placeholder="z. B. 0,12">
      <span class="eur">€</span><button class="btn secondary small" data-realok="${esc(c.id)}">${c.real > 0 ? "Ändern" : "Übernehmen"}</button>
      ${c.real > 0 ? `<small>✓ gilt als Wert · eingetragen ${new Date(c.realAt || Date.now()).toLocaleDateString("de-DE")}</small>` : ""}</div>
    <div class="speak"><button class="btn secondary small" data-say="${esc(c.id)}">${speakingId === c.id ? "⏹️ Stopp" : "🔊 Vorlesen"}</button><button class="btn secondary small" data-view="${esc(c.id)}">📄 Kartentext</button></div>
    <div class="facts" data-facts="${esc(c.id)}" hidden></div>
    ${c.ygo ? ygoLinks(c) : links(c)}
  </div>`;
}
function langShort(c){ const l = String(c.language || "").toLowerCase(); return l.startsWith("deu") ? "DE" : l.startsWith("jap") ? "JP" : l.startsWith("fr") ? "FR" : "EN"; }
function langLong(c){ return { DE: "Deutsch", JP: "Japanisch", FR: "Französisch", EN: "Englisch" }[langShort(c)]; }
function setReal(id){
  const c = coll.find(x => x.id === id); if(!c) return;
  const inp = document.querySelector(`[data-real="${CSS.escape(id)}"]`);
  const v = parseFloat(String(inp ? inp.value : "").replace(/[^0-9,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  if(isFinite(v) && v > 0){ c.real = Math.round(v * 100) / 100; c.realAt = Date.now(); toast(`✓ ${c.name}: ${eur(c.real)} (${langLong(c)}) übernommen`); }
  else { delete c.real; delete c.realAt; toast("Eigener Preis entfernt – es gilt wieder der ab-Preis aus der Liste"); }
  saveCard(c); rerender(c); refreshTotals();
}
document.addEventListener("keydown", e => { const i = e.target.closest && e.target.closest("[data-real]"); if(i && e.key === "Enter"){ e.preventDefault(); setReal(i.dataset.real); } });
document.addEventListener("click", e => {
  const head = e.target.closest(".card .rowc");
  if(head && !e.target.closest("a,button,input")){
    const card = head.closest(".card");
    if(card.classList.contains("old")) card.classList.remove("old");
    else if(!card.classList.contains("latest") && card.dataset.card) card.classList.add("old");
    return;
  }
  const ro = e.target.closest("[data-realok]"); if(ro){ setReal(ro.dataset.realok); return; }
  const kv = e.target.closest("[data-view]");
  if(kv){ const c = coll.find(x => x.id === kv.dataset.view); const box = document.querySelector(`[data-facts="${CSS.escape(kv.dataset.view)}"]`); if(c && box){ if(!box.hidden && box.innerHTML){ box.hidden = true; } else showCardView(c, false); } return; }
  const sb = e.target.closest("[data-say]"); if(sb){ const c = coll.find(x => x.id === sb.dataset.say); if(c) speakCard(c); return; }
  const d = e.target.closest("[data-del]"); if(d){ removeCard(d.dataset.del); return; }
  const vb = e.target.closest("[data-ver]");
  if(vb){ const c = coll.find(x => x.id === vb.dataset.ver); if(c){ c.vi = +vb.dataset.i; attachPrice(c); saveCard(c); rerender(c); refreshTotals(); } return; }
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
  document.querySelectorAll(`[data-facts="${CSS.escape(c.id)}"]`).forEach(el => { el.hidden = false; el.innerHTML = (html || `<div class="note">Für diese Karte gibt es keinen Kartentext.</div>`) + (voices ? voicePicker() : ""); });
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
const toDigits = s => s.replace(/[OoQD]/g, "0").replace(/[Il|!]/g, "1").replace(/Z/g, "2").replace(/S/g, "5").replace(/B/g, "8").replace(/G/g, "6");
const toLetters = s => s.replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B");
function parseRead(text){
  const raw = String(text || "").toUpperCase().replace(/[‐-―]/g, "-");
  // One Piece: OP05-119, ST01-012, EB02-010, PRB01-001, P-043
  const t1 = raw.replace(/\s+/g, " ");
  const opm = t1.match(/\b(OP|0P|ST|5T|EB|E8|PRB|PR8)\s?([0-9OIS]{2})\s?-\s?([0-9OISB]{3})\b/) || t1.match(/\b(P)\s?-\s?([0-9OISB]{3})\b/);
  if(opm){
    const pre = { "0P": "OP", "5T": "ST", "E8": "EB", "PR8": "PRB" }[opm[1]] || opm[1];
    const id = pre === "P" ? `P-${toDigits(opm[2])}` : `${pre}${toDigits(opm[2])}-${toDigits(opm[3])}`;
    if(OPDB && OPDB.cards[id]) return { kind: "op", id, key: "op:" + id };
  }
  // Yu-Gi-Oh!: Set-Kürzel "LOB-DE005" (Sprache steht im Kürzel)
  const yg = ygoParse(raw); if(yg && yg.kind === "ygo") return yg;
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
function addCard(c, thumb){
  c.id = "d" + Date.now().toString(36) + (seq++).toString(36);
  c.t = Date.now(); c.thumb = thumb || ""; c.vi = 0;
  attachPrice(c);
  coll.unshift(c); saveCard(c); refreshTotals();
  document.querySelectorAll("#results .card.latest").forEach(el => { el.classList.remove("latest"); el.classList.add("old"); });
  const t = document.createElement("div"); t.innerHTML = cardHTML(c, "latest");
  $("results").prepend(t.firstElementChild);
  if(navigator.vibrate) navigator.vibrate(60);
  toast(`✓ ${c.name} · ${c.op ? c.op.id : c.ygo ? c.number : cmCode(c)} · ${eur(valueOf(c))}`);
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
async function handleRead(r, thumb, inline){
  await Promise.all([cardDbReady, opDbReady, ygoDbReady]);
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
const ocrReady = (async () => {
  try{
    worker = await Tesseract.createWorker("eng", 1, {
      workerPath: "lib/worker.min.js", corePath: "lib/core", langPath: "lib/lang", gzip: true, cacheMethod: "write"
    });
    await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/- ", tessedit_pageseg_mode: "11", preserve_interword_spaces: "1" });
    $("ocrState").textContent = "Texterkennung bereit ✓";
    return true;
  }catch(e){ console.error(e); $("ocrState").textContent = "Texterkennung konnte nicht geladen werden – manuelle Eingabe nutzen."; return false; }
})();
// Bildausschnitt vorbereiten: Graustufen, Kontrast strecken, vergrößern
function prepStrip(src, sx, sy, sw, sh, invert, maxW, adaptive){
  const scale = Math.min(3, (maxW || 1600) / sw);
  const cv = document.createElement("canvas"); cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high"; g.drawImage(src, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  const im = g.getImageData(0, 0, cv.width, cv.height), d = im.data;
  let mn = 255, mx = 0; const L = new Uint8Array(d.length / 4);
  for(let i = 0, j = 0; i < d.length; i += 4, j++){ const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; L[j] = v; if(v < mn) mn = v; if(v > mx) mx = v; }
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
        let o = invert ? (v > mean * 1.15 + 6 ? 0 : 255) : (v < mean * 0.85 - 6 ? 0 : 255);
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
  let best = null, txt = "";
  for(const inv of (opts && opts.noInvert) ? [false] : [false, true]){
    const cv = prepStrip(src, sx, sy, sw, sh, inv, opts && opts.maxW, opts && opts.adaptive);
    const { data } = await worker.recognize(cv);
    txt = (data.text || "").replace(/\s+/g, " ").trim();
    best = parseRead(txt);
    if(best) break;
  }
  return { r: best, text: txt };
}

// ---------------- Kamera ----------------
let stream = null, paused = false, busy = false, lastKey = "", lastAt = 0;
const recent = [];
function frameRect(){
  // Kartenrahmen (63:88) in der Kamera-Ansicht
  const cam = $("cam").getBoundingClientRect();
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
async function openStream(deviceId){
  const base = { width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 30 } };
  const video = deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode: { ideal: "environment" } };
  return navigator.mediaDevices.getUserMedia({ audio: false, video });
}
async function startCam(nextCam){
  if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; await sleep(150); }
  try{
    if(!backCams.length){
      // erst einmal Zugriff holen, sonst liefert enumerateDevices keine Namen
      const tmp = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      tmp.getTracks().forEach(t => t.stop());
      await listBackCams();
      const sv = savedCam(); camIdx = Math.max(0, backCams.findIndex(d => d.deviceId === sv));
    } else if(nextCam) camIdx = (camIdx + 1) % backCams.length;
    const dev = backCams[camIdx];
    stream = await openStream(dev && dev.deviceId);
    if(dev) try{ localStorage.setItem("cgd-cam", dev.deviceId); }catch{}
  }catch(e){
    try{ stream = await openStream(""); }catch{
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
  await Promise.all([ocrReady, cardDbReady, opDbReady, ygoDbReady]);
  if(!loop.running){ loop.running = true; loop().finally(() => loop.running = false); }
}
$("startBtn").onclick = () => startCam();
function stopCam(){
  if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
  const v = $("video"); v.srcObject = null;
  $("camCover").hidden = false; $("closeCam").hidden = true; $("torchBtn").hidden = true; $("torchBtn").classList.remove("on"); $("camBtn").hidden = true; $("zoomWrap").hidden = true;
  $("frame").classList.remove("focus", "hit"); $("readOut").textContent = "–"; steady = 0; armed = true;
  setStatus("Kamera aus. <b>📸 Foto machen</b> oder <b>🎥 Auto-Foto</b> zum Weiterscannen.");
}
$("closeCam").onclick = e => { e.stopPropagation(); stopCam(); };
$("camBtn").onclick = e => { e.stopPropagation(); startCam(true); };
$("barScan").onclick = () => $("photoInput").click();
document.addEventListener("visibilitychange", () => { if(document.hidden && stream) stopCam(); });

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
      const present = contrast > 18;
      if(!armed){
        // nach einem Foto: erst wieder auslösen, wenn eine andere Karte im Rahmen liegt
        // neue Karte = Bild im Rahmen unterscheidet sich deutlich vom letzten Foto (oder Rahmen leer)
        let diff = 0; if(shotSig){ for(let i = 0; i < g.length; i++) diff += Math.abs(g[i] - shotSig[i]); diff /= g.length; }
        if(Date.now() - lastShotAt > 600 && (!present || diff > 12)){ armed = true; steady = 0; }
        $("readOut").textContent = "✓ Foto gemacht – nächste Karte" + queueInfo();
      } else {
        // locker: leichte Handbewegung ist ok, Bild muss nur halbwegs scharf sein
        const good = present && motion < 14 && sharp > 14 && sharp >= peak * 0.6;
        steady = good ? steady + 1 : 0;
        $("frame").classList.toggle("focus", steady > 0);
        $("readOut").textContent = (!present ? "Karte in den Rahmen halten" : motion >= 14 ? "Etwas ruhiger halten …" : sharp <= 14 ? "Wird scharf gestellt …" : steady ? "Scharf ✓ – Foto!" : "Fokussiere …") + queueInfo();
        if(steady >= 2){ shotSig = g; await autoShot(v, X, Y, Wd, Hd, sharp); }
      }
    }catch(e){ console.warn(e); }
    await sleep(60);
  }
}
// Warteschlange: Kamera fotografiert weiter, Analyse läuft nacheinander im Hintergrund
const shotQ = []; let qRunning = false;
function queueInfo(){ const n = shotQ.length + (qRunning ? 1 : 0); return n ? ` · ${n} in Analyse` : ""; }
async function runQueue(){
  if(qRunning) return; qRunning = true;
  try{ while(shotQ.length){ const cv = shotQ.shift(); try{ await analyzePhoto(cv, { keepCam: true, quick: true }); }catch(e){ console.warn(e); } } }
  finally{ qRunning = false; }
}
async function autoShot(v, X, Y, Wd, Hd, sharp){
  busy = true; armed = false; lastShotSharp = sharp; lastShotAt = Date.now(); steady = 0;
  $("frame").classList.remove("focus"); $("frame").classList.add("hit");
  const cam = $("cam"); cam.classList.add("flash"); setTimeout(() => cam.classList.remove("flash"), 350);
  if(navigator.vibrate) navigator.vibrate(40);
  // Kartenbereich mit etwas Rand in voller Videoauflösung ausschneiden
  const mx = Wd * 0.12, my = Hd * 0.08;
  const x0 = Math.max(0, X - mx), y0 = Math.max(0, Y - my), x1 = Math.min(v.videoWidth, X + Wd + mx), y1 = Math.min(v.videoHeight, Y + Hd + my);
  const cv = document.createElement("canvas"); cv.width = Math.round(x1 - x0); cv.height = Math.round(y1 - y0);
  cv.getContext("2d").drawImage(v, x0, y0, x1 - x0, y1 - y0, 0, 0, cv.width, cv.height);
  setTimeout(() => $("frame").classList.remove("hit"), 600);
  shotQ.push(cv); busy = false; lastShotAt = Date.now();
  runQueue();
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
ygoDbReady.then(() => { NAMEIDX = null; });
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
  const W = cv.width, H = cv.height;
  // Vorschaubild: Bildmitte im Kartenformat
  const tw = Math.min(W, H * 63 / 88), th = tw * 88 / 63;
  const thumb = cardThumb(cv, (W - tw) / 2, (H - th) / 2, tw, th);
  const box = photoBox(thumb, "Texterkennung startet …");
  const step = t => { const m = box.querySelector("#anaStep"); if(m) m.textContent = t; };
  await Promise.all([ocrReady, cardDbReady, opDbReady, ygoDbReady]);
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
  // einzelner Durchgang mit fester Schriftfarbe (normal / hell auf dunkel)
  const tryAreaInv = async (src, x, y, w, h, label, inv) => {
    step(label);
    const pc = prepStrip(src, x, y, w, h, inv, 3000, true);
    const { data } = await worker.recognize(pc);
    const text = (data.text || "").replace(/\s+/g, " ").trim();
    texts.push(text); $("readOut").textContent = text ? text.slice(0, 60) : "–";
    return keep(parseRead(text));
  };
  let hit = null;
  try{
    // 0) Auto-Foto: Karte liegt im Rahmen -> erst nur den unteren Kartenrand lesen (schnell)
    if(opts && opts.quick){
      for(const inv of [false, true]){
        hit = await tryAreaInv(cv, 0, H * 0.74, W, H * 0.26, `Lese Kürzel + Nummer${inv ? " (helle Schrift)" : ""} …`, inv);
        if(hit) break;
      }
      // Yu-Gi-Oh!: Kürzel steht rechts unter dem Bild
      if(!hit && YGO) hit = await tryAreaInv(cv, W * 0.35, H * 0.64, W * 0.65, H * 0.14, "Lese Yu-Gi-Oh!-Kürzel …", false);
    }
    // 1) ganzes Foto
    if(!hit) hit = await tryArea(cv, 0, 0, W, H, "Suche Kürzel + Nummer im ganzen Foto …", { maxW: 2000, adaptive: true });
    // 2) waagerechte Streifen – wo die Karte unten ihre Nummer hat (wahrscheinlichste Lagen zuerst)
    // erst dunkle Schrift, dann helle Schrift (Vollbild-/Illustration-Rare-Karten: weiße Nummer auf dem Bild)
    const bands = [0.74, 0.82, 0.66, 0.58, 0.5, 0.42, 0.34, 0.88];
    for(const inv of [false, true]){
      for(let i = 0; !hit && i < bands.length; i++){
        const y = Math.max(0, H * bands[i] - H * 0.04), h = Math.min(H - y, H * 0.2);
        hit = await tryAreaInv(cv, 0, y, W, h, `Suche Kürzel + Nummer${inv ? " (helle Schrift)" : ""} … ${i + 1}/${bands.length}`, inv);
      }
      if(hit) break;
    }
    // 3) Querformat / gedrehte Karte: 90° drehen und noch einmal (nicht beim Auto-Foto – da liegt die Karte gerade im Rahmen)
    if(!hit && !(opts && opts.quick)){
      for(const dir of [1, -1]){
        const rc = document.createElement("canvas"); rc.width = H; rc.height = W;
        const g = rc.getContext("2d"); g.translate(dir > 0 ? H : 0, dir > 0 ? 0 : W); g.rotate(dir * Math.PI / 2); g.drawImage(cv, 0, 0);
        hit = await tryArea(rc, 0, 0, H, W, `Gedrehte Karte prüfen (${dir > 0 ? "rechts" : "links"}) …`, { maxW: 2000, adaptive: true });
        if(hit) break;
      }
    }
    if(!hit && weak) hit = weak;   // nur Nummer gelesen -> Auswahl/Bestätigung statt automatisch
    if(hit){
      box.remove(); paused = wasPaused;
      if(await handleRead(hit, thumb, keepCam)) setStatus(hit.strong || hit.kind === "op" ? "✓ Karte aus dem Foto übernommen." : "✓ Karte nach deiner Bestätigung übernommen.");
      return;
    }
    // 4) Kein Kürzel/keine Nummer: Kartenname lesen und in der Datenbank suchen
    step("Kein Kürzel gefunden – suche über den Kartennamen …");
    await worker.setParameters({ tessedit_char_whitelist: FREE_WL });
    let free = "";
    try{
      for(const inv of [false, true]){
        const top = prepStrip(cv, 0, 0, W, H * 0.7, inv, 2000, true);
        free += " " + ((await worker.recognize(top)).data.text || "");
        if(namesInText(free).length) break;
      }
    } finally { await worker.setParameters({ tessedit_char_whitelist: WL }); }
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

// ---------------- Manuelle Eingabe ----------------
$("manualForm").onsubmit = async e => {
  e.preventDefault();
  const q = $("manualInput").value.trim(); if(!q) return;
  await Promise.all([cardDbReady, opDbReady, ygoDbReady]);
  let r = parseRead(q);
  if(!r){ const m = q.toUpperCase().match(/^([A-Z0-9]{2,5})\s*([A-Z]{0,2}\d{1,3})$/); if(m && knownCodes().has(m[1])) r = { kind: "pk", code: m[1], number: m[2], lang: "", strong: true, key: "m" }; }
  if(!r){
    // Kartenname eingetippt (alle Spiele)
    const names = namesInText(q);
    const list = [];
    for(const [, hits] of names.slice(0, 2)) for(const h of hits){
      if(list.length > 40) break;
      if(h.kind === "ygo") list.push(...ygoPrintsLabeled(h.pc, LANG));
      else if(h.kind === "op"){ const c = opApply({ game: "onepiece", number: h.id, language: LANG === "Japanisch" ? "Japanisch" : "Englisch" }); if(c.op) list.push({ c, label: c.name, sub: `${c.op.id} · ${c.set}` }); }
      else { const c = applyDb({ set_code: h.st.code || "", set: h.st.en, set_en: h.st.en, name: h.e[2], name_en: h.e[2], number: `${h.e[0]}/${h.st.total || ""}`, language: LANG }); if(c.db) list.push({ c: finishPk(c, LANG), label: LANG === "Deutsch" && h.e[3] ? h.e[3] : h.e[2], sub: `${h.st.code ? h.st.code + " · " : ""}${LANG === "Deutsch" ? h.st.de || h.st.en : h.st.en} · Nr. ${h.e[0]}` }); }
    }
    if(list.length){ inlinePick(list, "", `Name „${list[0].label}“ – welche Ausgabe?`); $("manualInput").value = ""; return; }
    setStatus("Eingabe nicht erkannt. Beispiele: <b>PAR 040</b>, <b>4/102</b>, <b>OP05-119</b>, <b>LOB-DE005</b> oder ein Kartenname."); return;
  }
  if(await handleRead(r, "")){ $("manualInput").value = ""; setStatus("✓ Übernommen."); }
};

// ---------------- Start ----------------
Promise.all([collReady, pricesReady]).then(() => {
  const latest = coll.slice(0, 5);
  $("results").innerHTML = latest.map((c, i) => cardHTML(c, i === 0 ? "" : "old")).join("");
});
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ---------------- Update-Knopf ----------------
const APP_FILES = ["./", "index.html", "app.js", "lib/cards.js", "lib/ygo.js", "sw.js", "manifest.webmanifest", "version.json"];
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
