// CardGrab Device – Sammlung verwalten: Filter, Ordner, Mehrfachauswahl, Karte bearbeiten, Rückgängig
"use strict";
const FKEY = "cgd-folders";
const LANGS = ["Deutsch", "Englisch", "Japanisch", "Französisch", "Italienisch", "Spanisch", "Portugiesisch", "Koreanisch"];
let SELMODE = false; const SEL = new Set();

function folderList(){
  let saved = []; try{ saved = JSON.parse(localStorage.getItem(FKEY) || "[]"); }catch{}
  return [...new Set([...saved, ...coll.map(c => c.folder).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "de"));
}
function saveFolders(l){ try{ localStorage.setItem(FKEY, JSON.stringify([...new Set(l)])); }catch{} }
function fillFilters(){
  const f = $("fFolder"); if(!f) return; const cur = f.value;
  const fl = folderList();
  f.innerHTML = `<option value="">📁 Alle Ordner</option><option value="-">Ohne Ordner</option>` + fl.map(n => `<option value="${esc(n)}">📁 ${esc(n)} (${coll.filter(c => c.folder === n).reduce((s, c) => s + qtyOf(c), 0)})</option>`).join("") + `<option value="+">＋ Neuer Ordner …</option>`;
  f.value = [...f.options].some(o => o.value === cur) ? cur : "";
  const l = $("fLang"), lc = l.value, langs = [...new Set(coll.map(c => c.language).filter(Boolean))];
  l.innerHTML = `<option value="">🌍 Alle Sprachen</option>` + langs.map(x => `<option>${esc(x)}</option>`).join("");
  l.value = langs.includes(lc) ? lc : "";
}
// wird von renderColl benutzt
function passFilters(c){
  const g = $("fGame") ? $("fGame").value : "", l = $("fLang") ? $("fLang").value : "", f = $("fFolder") ? $("fFolder").value : "";
  if(g && (c.game || "pokemon") !== g) return false;
  if(l && c.language !== l) return false;
  if(f === "-" && c.folder) return false;
  if(f && f !== "-" && f !== "+" && c.folder !== f) return false;
  return true;
}
async function askText(title, placeholder){
  return new Promise(res => {
    const sh = $("sheet");
    $("sheetIn").innerHTML = `<h4>${esc(title)}</h4><input id="askIn" class="askin" maxlength="40" placeholder="${esc(placeholder || "")}"><div style="display:flex;gap:8px;margin-top:10px"><button class="opt" data-ask="ok" style="justify-content:center">OK</button><button class="opt" data-ask="" style="justify-content:center;color:var(--muted)">Abbrechen</button></div>`;
    sh.hidden = false; setTimeout(() => $("askIn").focus(), 50);
    const done = v => { sh.hidden = true; sh.onclick = null; res(v); };
    $("askIn").onkeydown = e => { if(e.key === "Enter") done($("askIn").value.trim()); };
    sh.onclick = e => { const b = e.target.closest("[data-ask]"); if(b) done(b.dataset.ask ? $("askIn").value.trim() : ""); else if(e.target === sh) done(""); };
  });
}
async function pickFrom(title, items){   // items: [{v, label, sub}]
  return new Promise(res => {
    const sh = $("sheet");
    $("sheetIn").innerHTML = `<h4>${esc(title)}</h4><div class="pickl">` + items.map((it, i) => `<button class="opt" data-pi="${i}"><span>${esc(it.label)}${it.sub ? `<br><small style="color:var(--muted)">${esc(it.sub)}</small>` : ""}</span>${it.right ? `<b>${esc(it.right)}</b>` : ""}</button>`).join("") + `</div><button class="opt" data-pi="-1" style="justify-content:center;color:var(--muted)">Abbrechen</button>`;
    sh.hidden = false;
    sh.onclick = e => { const b = e.target.closest("[data-pi]"); if(!b && e.target !== sh) return; sh.hidden = true; sh.onclick = null; const i = b ? +b.dataset.pi : -1; res(i >= 0 ? items[i].v : undefined); };
  });
}
async function chooseFolder(){
  const fl = folderList();
  const v = await pickFrom("In welchen Ordner?", [...fl.map(n => ({ v: n, label: "📁 " + n })), { v: "+", label: "＋ Neuer Ordner …" }, { v: "-", label: "Aus Ordner entfernen" }]);
  if(v === undefined) return undefined;
  if(v === "+"){ const n = await askText("Name des neuen Ordners", "z. B. Binder 1, Verkaufen, Deck"); if(!n) return undefined; saveFolders([...fl, n]); return n; }
  return v === "-" ? "" : v;
}

// ---------- Filterleiste ----------
document.addEventListener("change", async e => {
  if(e.target.id === "fFolder" && e.target.value === "+"){
    const n = await askText("Name des neuen Ordners", "z. B. Binder 1, Verkaufen, Deck");
    if(n){ saveFolders([...folderList(), n]); fillFilters(); $("fFolder").value = n; toast(`Ordner „${n}“ angelegt – Karten mit „☑️ Auswählen“ hineinlegen`); }
    else e.target.value = "";
    renderColl(); return;
  }
  if(["fGame", "fLang", "fFolder"].includes(e.target.id)) renderColl();
});

// ---------- Mehrfachauswahl ----------
function updSelBar(){
  $("selBar").hidden = !SELMODE; $("selBtn").classList.toggle("on", SELMODE);
  $("selCnt").textContent = `${SEL.size} ausgewählt`;
  $("collList").classList.toggle("selmode", SELMODE);
  document.querySelectorAll("#collList .card").forEach(el => el.classList.toggle("sel", SEL.has(el.dataset.card)));
}
document.addEventListener("click", async e => {
  if(e.target.closest("#selBtn")){ SELMODE = !SELMODE; SEL.clear(); updSelBar(); return; }
  if(SELMODE){
    const card = e.target.closest("#collList .card");
    if(card && !e.target.closest("a")){ e.preventDefault(); e.stopPropagation(); const id = card.dataset.card; SEL.has(id) ? SEL.delete(id) : SEL.add(id); updSelBar(); return; }
  }
  const b = e.target.closest("[data-sel]"); if(!b) return;
  const act = b.dataset.sel, cards = coll.filter(c => SEL.has(c.id));
  if(act === "all"){ const vis = [...document.querySelectorAll("#collList .card")].map(el => el.dataset.card); const all = vis.every(id => SEL.has(id)); vis.forEach(id => all ? SEL.delete(id) : SEL.add(id)); updSelBar(); return; }
  if(act === "done"){ SELMODE = false; SEL.clear(); updSelBar(); return; }
  if(!cards.length){ toast("Erst Karten antippen"); return; }
  if(act === "folder"){
    const f = await chooseFolder(); if(f === undefined) return;
    for(const c of cards){ if(f) c.folder = f; else delete c.folder; await saveCard(c); }
    toast(f ? `${cards.length} Karten → 📁 ${f}` : `${cards.length} Karten aus Ordner entfernt`);
  } else if(act === "cond"){
    const v = await pickFrom("Zustand für alle ausgewählten", CONDS.map(([k, n]) => ({ v: k, label: `${k} · ${n}` }))); if(!v) return;
    for(const c of cards){ c.cond = v; await saveCard(c); } toast(`${cards.length} Karten: Zustand ${v}`);
  } else if(act === "lang"){
    const v = await pickFrom("Sprache für alle ausgewählten", LANGS.map(l => ({ v: l, label: l }))); if(!v) return;
    for(const c of cards){ setLanguage(c, v); await saveCard(c); } toast(`${cards.length} Karten: ${v}`);
  } else if(act === "del"){
    await removeCards(cards.map(c => c.id));
  }
  SEL.clear(); updSelBar(); refreshTotals(); renderColl();
}, true);

// ---------- Löschen mit Rückgängig ----------
let UNDO = null;
async function removeCards(ids){
  const gone = coll.filter(c => ids.includes(c.id));
  for(const id of ids) await removeCard(id, true);
  UNDO = { cards: gone, at: Date.now() };
  toastAction(`${gone.length === 1 ? `„${gone[0].name}“` : gone.length + " Karten"} entfernt`, "↩️ Rückgängig", async () => {
    if(!UNDO) return;
    for(const c of UNDO.cards){ coll.push(c); await saveCard(c); }
    coll.sort((a, b) => b.t - a.t); UNDO = null; refreshTotals(); renderColl(); toast("Wiederhergestellt ✓");
  });
}
function toastAction(text, label, fn){
  const el = $("toast"); el.innerHTML = `${esc(text)} <button class="tbtn">${esc(label)}</button>`; el.classList.add("show", "act");
  el.querySelector(".tbtn").onclick = ev => { ev.stopPropagation(); el.classList.remove("show", "act"); fn(); };
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show", "act"), 6000);
}

// ---------- Karte bearbeiten ----------
function setLanguage(c, lang){
  c.language = lang;
  if(c.game === "pokemon" && c.db){ c.name = lang === "Deutsch" && c.db.de ? c.db.de : (c.db.en || c.name); c.set = lang === "Deutsch" ? (c.db.setDe || c.set) : (c.db.setEn || c.set); }
  if(c.ygo){ const e = ygoCard(c.ygo.pc); if(e) c.name = lang === "Deutsch" && e[1] ? e[1] : e[0]; const lc = YGO_LCODE[lang] || "EN"; c.number = c.number.replace(/-[A-Z]{1,2}(?=[A-Z]?\d)/, "-" + lc); }
  if(c.op) c.op.jp = lang === "Japanisch";
  delete c.real; delete c.img; attachPrice(c);
}
async function alternativesFor(c){
  await Promise.all([cardDbReady, opDbReady]);
  if(c.ygo){ await ygoDbReady; return ygoPrintsLabeled(c.ygo.pc, c.language); }
  const list = [];
  const names = [c.name_en, c.name].filter(Boolean);
  for(const n of names) for(const [, hits] of namesInText(n).slice(0, 1)) for(const h of hits){
    if(list.length > 60) break;
    if(h.kind === "op"){ const x = opApply({ game: "onepiece", number: h.id, language: c.language }); if(x.op) list.push({ c: x, label: x.name, sub: `${x.op.id} · ${x.set}` }); }
    else if(h.kind === "pk"){ const x = applyDb({ set_code: h.st.code || "", set: h.st.en, set_en: h.st.en, name: h.e[2], name_en: h.e[2], number: `${h.e[0]}/${h.st.total || ""}`, language: c.language }); if(x.db) list.push({ c: finishPk(x, c.language), label: c.language === "Deutsch" && h.e[3] ? h.e[3] : h.e[2], sub: `${h.st.code ? h.st.code + " · " : ""}${c.language === "Deutsch" ? h.st.de || h.st.en : h.st.en} · Nr. ${h.e[0]}` }); }
  }
  const seen = new Set(); return list.filter(x => { const k = x.sub; if(seen.has(k)) return false; seen.add(k); return true; });
}
const KEEP = ["id", "t", "thumb", "qty", "cond", "buy", "folder", "language"];
async function editCard(id){
  const c = coll.find(x => x.id === id); if(!c) return;
  const act = await pickFrom(`✏️ ${c.name} bearbeiten`, [
    { v: "alt", label: "🔁 Andere Ausgabe / anderes Set", sub: "falls die Karte falsch erkannt wurde" },
    { v: "lang", label: "🌍 Sprache ändern", sub: c.language || "" },
    { v: "folder", label: "📁 Ordner", sub: c.folder || "kein Ordner" },
    { v: "cond", label: "🏷️ Zustand", sub: c.cond || "NM" },
    { v: "grade", label: "🏅 Grading (PSA, BGS, CGC …)", sub: c.grade || "nicht gegradet" },
    { v: "wish", label: "⭐ Auf die Wunschliste", sub: "z. B. um eine zweite zu kaufen" }
  ]);
  if(!act) return;
  if(act === "lang"){ const v = await pickFrom("Sprache der Karte", LANGS.map(l => ({ v: l, label: l, right: l === c.language ? "✓" : "" }))); if(!v) return; setLanguage(c, v); }
  else if(act === "folder"){ const f = await chooseFolder(); if(f === undefined) return; if(f) c.folder = f; else delete c.folder; }
  else if(act === "cond"){ const v = await pickFrom("Zustand", CONDS.map(([k, n]) => ({ v: k, label: `${k} · ${n}`, right: k === (c.cond || "NM") ? "✓" : "" }))); if(!v) return; c.cond = v; }
  else if(act === "grade"){
    const co = await pickFrom("Grading-Firma", ["Nicht gegradet", "PSA", "BGS (Beckett)", "CGC", "SGC", "TAG", "Andere"].map(x => ({ v: x, label: x, right: c.grade && c.grade.startsWith(x.split(" ")[0]) ? "✓" : "" }))); if(!co) return;
    if(co === "Nicht gegradet") delete c.grade;
    else {
      const g = await pickFrom(`${co} – Note`, ["10", "9.5", "9", "8.5", "8", "7.5", "7", "6", "5", "4", "3", "2", "1", "Authentic"].map(x => ({ v: x, label: x }))); if(!g) return;
      c.grade = `${co.split(" ")[0]} ${g}`;
      if(!(c.real > 0)) toast("Tipp: Gegradete Karten haben eigene Preise – trag unter „Eigener Preis“ deinen Wert ein");
    }
  }
  else if(act === "wish"){ wishAdd(c); return; }
  else if(act === "alt"){
    toast("Suche Ausgaben …");
    const alts = await alternativesFor(c);
    if(!alts.length){ toast("Keine anderen Ausgaben gefunden"); return; }
    const pick = await pickFrom(`Welche Ausgabe ist „${c.name}“?`, alts.map((a, i) => ({ v: i, label: a.label, sub: a.sub }))); if(pick === undefined) return;
    const before = identity(c);
    const n = alts[pick].c, keep = {}; for(const k of KEEP) if(c[k] !== undefined) keep[k] = c[k];
    for(const k of Object.keys(c)) delete c[k];
    Object.assign(c, n, keep); c.vi = 0; delete c.img; delete c.pv; delete c.versions; delete c.price;
    attachPrice(c);
    learnSet(before, c);
  }
  await saveCard(c); rerender(c); refreshTotals(); renderColl(); ensureImg(c);
  toast("Gespeichert ✓");
}
document.addEventListener("click", e => { const b = e.target.closest("[data-edit]"); if(b){ e.stopPropagation(); editCard(b.dataset.edit); } }, true);
