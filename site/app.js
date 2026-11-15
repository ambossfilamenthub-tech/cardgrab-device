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
    c.versions = vs.map(v => ({ id: v[0], low: v[1], trend: v[2], avg7: v[3], avg30: v[4], guess: !!v[5] }));
    const i = Math.min(c.vi || 0, Math.max(0, c.versions.length - 1));
    const v = c.versions[i];
    c.price = v ? { low: v.low, trend: v.trend, avg7: v.avg7, avg30: v.avg30, id: v.id } : null;
  } else if(c.db && c.db.cm && PP && PP.p){
    const p = PP.p[c.db.cm];
    c.price = p ? { low: p[0], trend: p[1], avg1: p[2], avg7: p[3], avg30: p[4], lowH: p[5], trendH: p[6], avg30H: p[7], id: c.db.cm } : null;
  } else c.price = null;
  return c;
}
const valueOf = c => { const p = c.price; if(!p) return 0; if(c.rh && p.trendH) return p.trendH; return p.trend || p.avg30 || p.low || 0; };

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
    ? `<div class="vers">${c.versions.map((x, i) => `<button data-ver="${esc(c.id)}" data-i="${i}" class="${i === (c.vi || 0) ? "on" : ""}">V${i + 1} · ${eur(x.trend || x.low)}</button>`).join("")}</div>
       <div class="note">Diese Karte gibt es ${c.versions.length}× (normal, Parallel/Alt Art, Reprints). Wähle die Version mit deinem Motiv – V1 ist meist die normale Karte.${c.versions.some(x => x.guess) ? " Zuordnung der Versionen geschätzt – im Zweifel auf Cardmarket prüfen." : ""}</div>` : "";
  const rh = holo ? `<div class="vers"><button data-rh="${esc(c.id)}" data-v="0" class="${!c.rh ? "on" : ""}">Normal</button><button data-rh="${esc(c.id)}" data-v="1" class="${c.rh ? "on" : ""}">Reverse Holo</button></div>` : "";
  const pr = p ? `<div class="prices">
      <div><span>ab</span><b>${eur(c.rh && p.lowH ? p.lowH : p.low)}</b></div>
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
      <div class="val"><div class="l">Trend</div><div class="p">${eur(v)}</div></div>
    </div>
    ${pr}${rh}${vers}
    ${links(c)}
  </div>`;
}
document.addEventListener("click", e => {
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
function prepStrip(src, sx, sy, sw, sh, invert){
  const scale = Math.min(3, 1600 / sw);
  const cv = document.createElement("canvas"); cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high"; g.drawImage(src, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  const im = g.getImageData(0, 0, cv.width, cv.height), d = im.data;
  let mn = 255, mx = 0; const L = new Uint8Array(d.length / 4);
  for(let i = 0, j = 0; i < d.length; i += 4, j++){ const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; L[j] = v; if(v < mn) mn = v; if(v > mx) mx = v; }
  const k = 255 / Math.max(1, mx - mn);
  for(let i = 0, j = 0; i < d.length; i += 4, j++){ let v = (L[j] - mn) * k; if(invert) v = 255 - v; d[i] = d[i + 1] = d[i + 2] = v; }
  g.putImageData(im, 0, 0);
  return cv;
}
async function ocrRegion(src, sx, sy, sw, sh){
  let best = null, txt = "";
  for(const inv of [false, true]){
    const cv = prepStrip(src, sx, sy, sw, sh, inv);
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
async function startCam(){
  try{
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  }catch(e){
    setStatus("Kamera nicht verfügbar oder nicht erlaubt. Erlaube den Kamerazugriff in den Browser-Einstellungen – oder nutze „🖼️ Foto“ bzw. die manuelle Eingabe.");
    return;
  }
  const v = $("video"); v.srcObject = stream; await v.play().catch(() => {});
  $("camCover").hidden = true; placeFrame();
  const track = stream.getVideoTracks()[0];
  try{ await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); }catch{}
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  if(caps.torch){ const b = $("torchBtn"); b.hidden = false; b.onclick = async () => { const on = !b.classList.contains("on"); try{ await track.applyConstraints({ advanced: [{ torch: on }] }); b.classList.toggle("on", on); }catch{} }; }
  setStatus("Karte in den Rahmen halten – <b>Kürzel und Nummer</b> unten in den gestrichelten Bereich.");
  await Promise.all([ocrReady, cardDbReady, opDbReady]); loop();
}
$("startBtn").onclick = startCam;
$("barScan").onclick = () => { showTab("scan"); window.scrollTo({ top: 0, behavior: "smooth" }); if(!stream) startCam(); };
document.addEventListener("visibilitychange", () => { if(document.hidden && stream){ stream.getTracks().forEach(t => t.stop()); stream = null; $("camCover").hidden = false; } });

async function loop(){
  const v = $("video");
  while(stream){
    if(paused || busy || !v.videoWidth || $("scan").hidden){ await sleep(250); continue; }
    busy = true;
    try{
      // Rahmen -> Videopixel (object-fit: cover)
      const f = frameRect(), vw = v.videoWidth, vh = v.videoHeight;
      const s = Math.max(f.cw / vw, f.ch / vh), ox = (vw * s - f.cw) / 2, oy = (vh * s - f.ch) / 2;
      const X = (f.x + ox) / s, Y = (f.y + oy) / s, Wd = f.w / s, Hd = f.h / s;
      const grab = document.createElement("canvas"); grab.width = vw; grab.height = vh; grab.getContext("2d").drawImage(v, 0, 0);
      // unterer Kartenstreifen (Pokémon: links, One Piece: rechts) – ganze Breite, leicht über den Rand
      // etwas über den Rahmen hinaus lesen – Karten werden oft größer/kleiner gehalten als der Rahmen
      const sy = Y + Hd * 0.8, sh = Hd * 0.34;
      const { r, text } = await ocrRegion(grab, Math.max(0, X - Wd * 0.03), Math.max(0, sy), Math.min(vw, Wd * 1.06), Math.min(vh - sy, sh));
      $("readOut").textContent = text ? text.slice(0, 60) : "–";
      if(r){
        recent.push(r.key); if(recent.length > 4) recent.shift();
        const stable = recent.filter(k => k === r.key).length >= 2;
        const fresh = r.key !== lastKey || Date.now() - lastAt > 6000;
        if(stable && fresh){
          $("frame").classList.add("hit");
          const thumb = cardThumb(grab, X, Y, Wd, Hd);
          const ok = await handleRead(r, thumb);
          if(ok){ lastKey = r.key; lastAt = Date.now(); recent.length = 0; setStatus("✓ Übernommen – nächste Karte in den Rahmen halten."); }
          setTimeout(() => $("frame").classList.remove("hit"), 700);
          await sleep(900);
        }
      }
    }catch(e){ console.warn(e); }
    busy = false;
    await sleep(120);
  }
}
function cardThumb(src, x, y, w, h){
  const c = document.createElement("canvas"); c.width = 120; c.height = Math.round(120 * 88 / 63);
  c.getContext("2d").drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

// ---------------- Foto statt Live ----------------
$("photoInput").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if(!f) return;
  setStatus("Foto wird gelesen …");
  const img = await createImageBitmap(f);
  await ocrReady; if(!worker){ setStatus("Texterkennung nicht verfügbar – bitte manuell eingeben."); return; }
  const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height; cv.getContext("2d").drawImage(img, 0, 0);
  // ganze Karte formatfüllend angenommen: unteren Bereich in Stufen lesen
  let hit = null;
  for(const [a, b] of [[0.84, 0.16], [0.78, 0.22], [0.6, 0.4]]){
    const { r, text } = await ocrRegion(cv, 0, img.height * a, img.width, img.height * b);
    $("readOut").textContent = text ? text.slice(0, 60) : "–";
    if(r){ hit = r; break; }
  }
  if(!hit){ setStatus("Auf dem Foto wurden Kürzel und Nummer nicht erkannt. Karte formatfüllend fotografieren oder manuell eingeben."); return; }
  const r = await handleRead(hit, cardThumb(cv, 0, 0, img.width, img.height));
  if(r) setStatus("✓ Übernommen.");
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
