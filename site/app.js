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
// Preis an Karte hängen: {low, trend, avg7, avg30, holo:{…}, src}
function attachPrice(c){
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
  await Promise.all([cardDbReady, opDbReady]);
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
  let l = coll.filter(c => !q || [c.name, c.name_en, c.set, c.set_code, c.number, c.op && c.op.id].join(" ").toLowerCase().includes(q));
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
  const code = c.op ? c.op.id : cmCode(c) || c.number || "";
  const holo = p && (p.trendH || p.lowH);
  const v = valueOf(c);
  const vers = c.op && c.versions && c.versions.length > 1
    ? `<div class="vers">${c.versions.map((x, i) => `<button data-ver="${esc(c.id)}" data-i="${i}" class="${i === (c.vi || 0) ? "on" : ""}">V${i + 1}${x.pack && x.pack !== (c.op && c.op.id.split("-")[0]) ? " " + esc(x.pack) : ""} · ${eur(x.low || x.trend)}</button>`).join("")}</div>
       <div class="note">Diese Karte gibt es ${c.versions.length}× (normal, Parallel/Alt Art, Reprints). Wähle die Version mit deinem Motiv – V1 ist meist die normale Karte.${c.versions.some(x => x.guess) ? " Zuordnung der Versionen geschätzt – im Zweifel auf Cardmarket prüfen." : ""}</div>` : "";
  const rh = holo ? `<div class="vers"><button data-rh="${esc(c.id)}" data-v="0" class="${!c.rh ? "on" : ""}">Normal</button><button data-rh="${esc(c.id)}" data-v="1" class="${c.rh ? "on" : ""}">Reverse Holo</button></div>` : "";
  const pr = p ? `<div class="prices">
      <div><span>ab ${c.real > 0 ? "(alle)" : ""}</span><b>${eur(c.rh && p.lowH ? p.lowH : p.low)}</b></div>
      <div><span>Trend</span><b>${eur(c.rh && p.trendH ? p.trendH : p.trend)}</b></div>
      <div><span>30-T-Ø</span><b>${eur(c.rh && p.avg30H ? p.avg30H : p.avg30)}</b></div></div>`
    : `<div class="note">${(c.op ? OPP : PP) ? "Für diese Karte steht kein Preis in der Cardmarket-Liste – tippe auf den Cardmarket-Button." : "Preisliste noch nicht geladen (sie wird jeden Morgen aktualisiert)."}</div>`;
  return `<div class="card ${mode || ""}" data-card="${esc(c.id)}">
    <div class="rowc">
      ${c.thumb ? `<img class="thumb" src="${c.thumb}" alt="">` : `<div class="thumb"></div>`}
      <div class="info">
        <h3>${esc(c.name || c.name_en || "Unbekannt")}${c.name_jp && c.name_jp !== c.name ? ` <span style="font-weight:400;color:var(--muted);font-size:13px">${esc(c.name_jp)}</span>` : ""}</h3>
        <div class="meta"><b>${esc(code)}</b>${c.set ? " · " + esc(c.set) : ""}${c.language ? " · " + esc(c.language) : ""}</div>
      </div>
      <div class="val"><div class="l">${c.real > 0 ? "ab · " + langShort(c) + " ✓" : "ab"}</div><div class="p">${eur(v)}</div></div>
    </div>
    ${pr}${rh}${vers}
    <div class="real"><span>Günstigster Preis in <b>${langLong(c)}</b> (DE-Verkäufer, NM) – vom Cardmarket-Button ablesen:</span>
      <input type="text" inputmode="decimal" data-real="${esc(c.id)}" value="${c.real > 0 ? String(c.real).replace(".", ",") : ""}" placeholder="z. B. 0,12">
      <span class="eur">€</span><button class="btn secondary small" data-realok="${esc(c.id)}">${c.real > 0 ? "Ändern" : "Übernehmen"}</button>
      ${c.real > 0 ? `<small>✓ gilt als Wert · eingetragen ${new Date(c.realAt || Date.now()).toLocaleDateString("de-DE")}</small>` : ""}</div>
    <div class="speak"><button class="btn secondary small" data-say="${esc(c.id)}">${speakingId === c.id ? "⏹️ Stopp" : "🔊 Vorlesen"}</button><span>${c.op ? "Kosten, Stärke, Konter & Effekt" : "KP, Attacken & Schaden"}</span></div>
    <div class="facts" data-facts="${esc(c.id)}" hidden></div>
    ${links(c)}
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
  const ro = e.target.closest("[data-realok]"); if(ro){ setReal(ro.dataset.realok); return; }
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
const sayClean = t => String(t || "").replace(/\{([A-Z])\}(\s*-?\s*Energie)?/g, (m, k) => " " + (SYM[k] || k) + "-Energie ").replace(/\s+/g, " ").trim();
const dmgText = d => { const s = String(d ?? "").trim(); if(!s) return ""; return s.replace(/\+$/, " plus").replace(/[×x]$/, " mal").replace(/-$/, " minus") + " Schaden"; };
async function factsFor(sid){
  if(FACTS.has(sid)) return FACTS.get(sid);
  const p = fetch(`facts/${encodeURIComponent(sid)}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
  FACTS.set(sid, p); return p;
}
// Sprech-Abschnitte: [{t: Text, l: "de-DE" | "en-US"}]
async function speechParts(c){
  if(c.op){
    const o = c.op, de = [];
    de.push(`${c.name}. ${o.cat === "Leader" ? "Leader" : o.cat === "Character" ? "Charakter" : o.cat || ""}${o.color ? ", Farbe " + o.color.replace(/Red/g, "Rot").replace(/Green/g, "Grün").replace(/Blue/g, "Blau").replace(/Purple/g, "Lila").replace(/Black/g, "Schwarz").replace(/Yellow/g, "Gelb").replace("/", " und ") : ""}.`);
    if(o.cost != null) de.push(o.cat === "Leader" ? `${o.cost} Leben.` : `Kosten ${o.cost}.`);
    if(o.power) de.push(`Stärke ${o.power}.`);
    if(o.counter) de.push(`Konter plus ${o.counter}.`);
    const parts = [{ t: de.join(" "), l: "de-DE" }];
    if(o.effect) parts.push({ t: "Effekt:", l: "de-DE" }, { t: o.effect.replace(/\[|\]/g, ""), l: "en-US" });
    if(o.trigger) parts.push({ t: "Trigger:", l: "de-DE" }, { t: o.trigger.replace(/\[|\]/g, ""), l: "en-US" });
    return parts;
  }
  if(!c.db || !c.db.sid) return null;
  const all = await factsFor(c.db.sid); const e = all && (all[c.db.lid] || all[String(c.db.lid).replace(/^0+/, "")]);
  if(!e) return null;
  const out = [`${c.name}.`];
  if(e.c && e.c !== "Pokemon"){
    out.push(e.c === "Trainer" ? `Trainerkarte${e.tt ? " (" + ({ Item: "Item", Supporter: "Unterstützer", Stadium: "Stadion", Tool: "Ausrüstung" }[e.tt] || e.tt) + ")" : ""}.` : "Energiekarte.");
    if(e.e) out.push(sayClean(e.e));
  } else {
    if(e.hp) out.push(`${e.hp} KP.`);
    if(e.t) out.push(`Typ ${e.t.map(t => TYPE_DE[t] || t).join(" und ")}.`);
    if(e.st) out.push(`${STAGE_DE[e.st] || e.st}.`);
    for(const [n, eff] of e.ab || []) out.push(`Fähigkeit ${n}: ${sayClean(eff)}`);
    for(const [n, d, eff] of e.a || []) out.push(`Attacke ${n}${d !== "" ? ", " + dmgText(d) : ""}.${eff ? " " + sayClean(eff) : ""}`);
    if(e.w) out.push(`Schwäche ${e.w.map(t => TYPE_DE[t] || t).join(" und ")}.`);
    if(e.r !== undefined) out.push(`Rückzug ${e.r}.`);
  }
  return [{ t: out.join(" "), l: "de-DE" }];
}
function voiceFor(lang){
  const vs = speechSynthesis.getVoices(); const p = lang.slice(0, 2);
  return vs.find(v => v.lang === lang) || vs.find(v => v.lang && v.lang.toLowerCase().startsWith(p)) || null;
}
function stopSpeaking(){ try{ speechSynthesis.cancel(); }catch{} const id = speakingId; speakingId = null; const c = coll.find(x => x.id === id); if(c) rerender(c); }
async function speakCard(c){
  if(!("speechSynthesis" in window)){ toast("Dein Browser kann nicht vorlesen"); return; }
  if(speakingId === c.id){ stopSpeaking(); return; }
  if(speakingId) stopSpeaking();
  const parts = await speechParts(c);
  if(!parts){ toast("Für diese Karte gibt es keine Vorlese-Daten"); return; }
  speakingId = c.id; rerender(c);
  document.querySelectorAll(`[data-facts="${CSS.escape(c.id)}"]`).forEach(el => { el.hidden = false; el.textContent = parts.map(p => p.t).join(" "); });
  speechSynthesis.cancel();
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p.t); u.lang = p.l; const v = voiceFor(p.l); if(v) u.voice = v; u.rate = 1;
    if(i === parts.length - 1) u.onend = u.onerror = () => { if(speakingId === c.id){ speakingId = null; rerender(c); document.querySelectorAll(`[data-facts="${CSS.escape(c.id)}"]`).forEach(el => { el.hidden = false; el.textContent = parts.map(p => p.t).join(" "); }); } };
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
  // Pokémon: Nummer "040/182", "TG05/TG30", "GG35/GG70", "SV049/SV094", "4/102"
  const nm = raw.replace(/\s*\/\s*/g, "/").match(/\b([A-Z]{0,2}[0-9OIS]{1,3})\/([A-Z]{0,2}[0-9OIS]{2,3})\b/);
  const codes = knownCodes();
  let code = "", lang = "";
  const toks = raw.split(/[^A-Z0-9]+/).filter(Boolean);
  for(let i = 0; i < toks.length; i++){
    const tk = toks[i];
    if(LANG_TOKENS[tk]) lang = LANG_TOKENS[tk];
    const cand = [tk, toLetters(tk.replace(/\d$/, "")) + (tk.match(/\d$/) || [""])[0], tk.replace(/(DE|EN|FR|IT|ES|PT)$/, "")];
    for(const c of cand){ if(c.length >= 2 && c.length <= 5 && codes.has(c) && !/^\d+$/.test(c)){ code = c; const l2 = tk.slice(c.length); if(LANG_TOKENS[l2]) lang = LANG_TOKENS[l2]; break; } }
    if(code) break;
  }
  if(nm){
    // Buchstaben-Präfix nur bei echten Galerie-/Sondernummern (TG05, GG35, SV049, RC12, H01, SH5)
    const fix = t => { const m = t.match(/^(TG|GG|SV|RC|SH|H)(.*)$/); return m && /^[0-9OIS]+$/.test(m[2]) ? m[1] + toDigits(m[2]) : toDigits(t); };
    const left = fix(nm[1]), right = fix(nm[2]);
    return { kind: "pk", code, number: `${left}/${right}`, lang, key: `pk:${code}:${left}/${right}` };
  }
  // Promo ohne Gesamtzahl: "SVP 049", "MEP 012"
  if(code){ const pm = raw.match(new RegExp(`\\b${code}\\b[^0-9]{0,6}([0-9OIS]{2,3})\\b`)); if(pm){ const n = toDigits(pm[1]); return { kind: "pk", code, number: n, lang, key: `pk:${code}:${n}` }; } }
  return null;
}
// Kandidaten in der Datenbank suchen -> [{c, label, sub}]
function candidates(r){
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
    return c.db ? [{ c: finishPk(c, language), label: c.db.en, sub: `${c.db.code} ${c.db.lid} · ${c.db.setDe}` }] : [];
  };
  if(r.code && totalOk(r.code)){ const h = tryCode(r.code); if(h.length) return h; }
  // Kürzel falsch gelesen (z. B. "AR" statt "PAR")? -> ähnliche Kürzel mit passender Kartenzahl
  if(r.code && isFinite(total)){
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
  toast(`✓ ${c.name} · ${c.op ? c.op.id : cmCode(c)} · ${eur(valueOf(c))}`);
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
async function handleRead(r, thumb){
  await Promise.all([cardDbReady, opDbReady]);
  const list = candidates(r);
  if(!list.length){ setStatus(`<b>${esc(r.code ? r.code + " " : "")}${esc(r.number || r.id)}</b> gelesen, aber nicht in der Datenbank gefunden. Karte etwas näher/gerader halten oder manuell eingeben.`); return false; }
  let pick = list[0];
  if(list.length > 1){
    paused = true;
    pick = await chooseFrom(list, thumb, `Die Nummer ${r.number} passt zu ${list.length} Sets (ältere Karten haben kein Set-Kürzel).`);
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
  $("camCover").hidden = true; placeFrame();
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
  await Promise.all([ocrReady, cardDbReady, opDbReady]);
  if(!loop.running){ loop.running = true; loop().finally(() => loop.running = false); }
}
$("startBtn").onclick = () => startCam();
$("camBtn").onclick = e => { e.stopPropagation(); startCam(true); };
$("barScan").onclick = () => $("photoInput").click();
document.addEventListener("visibilitychange", () => { if(document.hidden && stream){ stream.getTracks().forEach(t => t.stop()); stream = null; $("camCover").hidden = false; } });

// Auto-Foto: Schärfe (Laplace-Varianz) + Ruhe im Kartenrahmen messen -> automatisch auslösen
let armed = true, peak = 0, steady = 0, lastShotSharp = 0, lastShotAt = 0;
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
        if(Date.now() - lastShotAt > 1200 && (motion > 18 || !present || sharp < lastShotSharp * 0.45)){ armed = true; steady = 0; }
        $("readOut").textContent = "✓ Foto gemacht – nächste Karte in den Rahmen";
      } else {
        // locker: leichte Handbewegung ist ok, Bild muss nur halbwegs scharf sein
        const good = present && motion < 14 && sharp > 14 && sharp >= peak * 0.6;
        steady = good ? steady + 1 : 0;
        $("frame").classList.toggle("focus", steady > 0);
        $("readOut").textContent = !present ? "Karte in den Rahmen halten" : motion >= 14 ? "Etwas ruhiger halten …" : sharp <= 14 ? "Wird scharf gestellt …" : steady ? "Scharf ✓ – Foto!" : "Fokussiere …";
        if(steady >= 2){ await autoShot(v, X, Y, Wd, Hd, sharp); prev = null; }
      }
    }catch(e){ console.warn(e); }
    await sleep(60);
  }
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
  try{ await analyzePhoto(cv); } finally { busy = false; lastShotAt = Date.now(); }
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
function nameIndex(){
  if(NAMEIDX) return NAMEIDX;
  NAMEIDX = new Map();
  const add = (k, v) => { if(k.length < 4) return; if(!NAMEIDX.has(k)) NAMEIDX.set(k, []); NAMEIDX.get(k).push(v); };
  if(CDB) for(const st of CDB.sets.values()){ const m = CDB.cards.get(st.id); if(m) for(const e of m.values()){ add(nrm(e[2]), { kind: "pk", st, e }); if(e[3] && nrm(e[3]) !== nrm(e[2])) add(nrm(e[3]), { kind: "pk", st, e, de: true }); } }
  if(OPDB) for(const [id, e] of Object.entries(OPDB.cards)) add(nrm(e[0]), { kind: "op", id });
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
  $("results").prepend(el); el.scrollIntoView({ behavior: "smooth", block: "center" });
  return el;
}
async function analyzePhoto(file){
  showTab("scan");
  let bmp;
  if(file instanceof HTMLCanvasElement) bmp = file;
  else { try{ bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }catch{ bmp = await createImageBitmap(file); } }
  // auf max. 2000 px (lange Seite) verkleinern – reicht für die kleine Schrift und bleibt schnell
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  const W = cv.width, H = cv.height;
  // Vorschaubild: Bildmitte im Kartenformat
  const tw = Math.min(W, H * 63 / 88), th = tw * 88 / 63;
  const thumb = cardThumb(cv, (W - tw) / 2, (H - th) / 2, tw, th);
  const box = photoBox(thumb, "Texterkennung startet …");
  const step = t => { const m = box.querySelector("#anaStep"); if(m) m.textContent = t; };
  await Promise.all([ocrReady, cardDbReady, opDbReady]);
  if(!worker){ box.remove(); setStatus("Texterkennung nicht verfügbar – bitte manuell eingeben."); return; }
  const wasPaused = paused; paused = true;
  const texts = [];
  const tryArea = async (src, x, y, w, h, label, opts) => {
    step(label);
    const { r, text } = await ocrRegion(src, x, y, w, h, opts);
    texts.push(text); $("readOut").textContent = text ? text.slice(0, 60) : "–";
    if(r && candidates(r).length) return r;
    return null;
  };
  let hit = null;
  try{
    // 1) ganzes Foto
    hit = await tryArea(cv, 0, 0, W, H, "Suche Kürzel + Nummer im ganzen Foto …", { maxW: 2000, adaptive: true });
    // 2) waagerechte Streifen – wo die Karte unten ihre Nummer hat (wahrscheinlichste Lagen zuerst)
    const bands = [0.74, 0.82, 0.66, 0.58, 0.5, 0.42, 0.34, 0.88];
    for(let i = 0; !hit && i < bands.length; i++){
      const y = Math.max(0, H * bands[i] - H * 0.04), h = Math.min(H - y, H * 0.2);
      hit = await tryArea(cv, 0, y, W, h, `Suche Kürzel + Nummer … ${i + 1}/${bands.length}`, { maxW: 2400, noInvert: true, adaptive: true });
    }
    // 3) Querformat / gedrehte Karte: 90° drehen und noch einmal
    if(!hit){
      for(const dir of [1, -1]){
        const rc = document.createElement("canvas"); rc.width = H; rc.height = W;
        const g = rc.getContext("2d"); g.translate(dir > 0 ? H : 0, dir > 0 ? 0 : W); g.rotate(dir * Math.PI / 2); g.drawImage(cv, 0, 0);
        hit = await tryArea(rc, 0, 0, H, W, `Gedrehte Karte prüfen (${dir > 0 ? "rechts" : "links"}) …`, { maxW: 2000, adaptive: true });
        if(hit) break;
      }
    }
    if(hit){
      box.remove(); paused = wasPaused;
      if(await handleRead(hit, thumb)) setStatus("✓ Karte aus dem Foto übernommen.");
      return;
    }
    // 4) Kein Kürzel/keine Nummer: Kartenname lesen und in der Datenbank suchen
    step("Kein Kürzel gefunden – suche über den Kartennamen …");
    await worker.setParameters({ tessedit_char_whitelist: FREE_WL });
    let free = "";
    try{
      const top = prepStrip(cv, 0, 0, W, H * 0.7, false, 2000, true);
      free = (await worker.recognize(top)).data.text || "";
    } finally { await worker.setParameters({ tessedit_char_whitelist: WL }); }
    const all = texts.join(" ") + " " + free;
    const nums = [...all.toUpperCase().matchAll(/\b([A-Z]{0,2}\d{1,3})\s*\/\s*([A-Z]{0,2}\d{2,3})\b/g)].map(m => m[1].replace(/^0+(?=\d)/, ""));
    const names = namesInText(free);
    const lang = LANG;
    const list = [];
    for(const [, hits] of names.slice(0, 3)){
      for(const h of hits){
        if(list.length > 60) break;
        if(h.kind === "op"){
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
      setStatus("Auf dem Foto wurde keine Karte erkannt. Tipp: Karte gerade, hell und ohne Spiegelung fotografieren – Nummer unten muss lesbar sein. Oder manuell eingeben (z. B. „PAR 040“).");
      toast("Karte nicht erkannt"); return;
    }
    list.sort((a, b) => b.score - a.score);
    paused = true;
    const pick = list.length === 1 ? list[0] : await chooseFrom(list, thumb, `Kartenname erkannt: „${list[0].label}“${nums.length ? "" : " – die Nummer war nicht lesbar"}. Welche Ausgabe ist es?`);
    paused = wasPaused;
    if(pick){ addCard(pick.c, thumb); setStatus("✓ Karte über den Namen gefunden."); }
  }catch(e){
    console.error(e); box.remove(); paused = wasPaused;
    setStatus("Fehler bei der Analyse – bitte noch einmal versuchen.");
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
  await Promise.all([cardDbReady, opDbReady]);
  let r = parseRead(q);
  if(!r){ const m = q.toUpperCase().match(/^([A-Z0-9]{2,5})\s*([A-Z]{0,2}\d{1,3})$/); if(m && knownCodes().has(m[1])) r = { kind: "pk", code: m[1], number: m[2], lang: "", key: "m" }; }
  if(!r){ setStatus("Eingabe nicht erkannt. Beispiele: <b>PAR 040</b>, <b>PAR 040/182</b>, <b>4/102</b>, <b>OP05-119</b>."); return; }
  if(await handleRead(r, "")){ $("manualInput").value = ""; setStatus("✓ Übernommen."); }
};

// ---------------- Start ----------------
Promise.all([collReady, pricesReady]).then(() => {
  const latest = coll.slice(0, 5);
  $("results").innerHTML = latest.map((c, i) => cardHTML(c, i === 0 ? "" : "old")).join("");
});
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ---------------- Update-Knopf ----------------
const APP_FILES = ["./", "index.html", "app.js", "lib/cards.js", "sw.js", "manifest.webmanifest", "version.json"];
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
