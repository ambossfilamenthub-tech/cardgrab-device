// CardGrab Device – japanische Pokémon-Karten (Set-Kürzel wie „SV2a 025/165“)
// Daten: jpdb.json (aus TCGdex, täglich gebaut) mit Cardmarket-Produkt-ID je Karte -> Preis aus der Cardmarket-Preisliste
"use strict";
let JP = null, _jpP = null;
function jpLoad(){
  return _jpP || (_jpP = fetch("jpdb.json").then(r => r.ok ? r.json() : null).then(d => {
    if(!d || !d.s) return null;
    const sets = new Map(), byCode = new Map();
    for(const s of d.s){ const o = { id: s[0], ja: s[1], en: s[2], total: s[3], cmExp: s[4] }; sets.set(s[0], o); byCode.set(s[0].toUpperCase(), o); }
    const cards = new Map(); for(const [sid, l] of Object.entries(d.c)) cards.set(sid, new Map(l.map(e => [e[0], e])));
    JP = { sets, byCode, cards }; return JP;
  }).catch(() => null));
}
const jpReady = { then(res, rej){ return jpLoad().then(res, rej); } };
setTimeout(() => (window.requestIdleCallback || setTimeout)(() => jpLoad()), 4000);

// Kürzel im gelesenen Text finden: „SV2A 025/165“, „S12A 172/172“, „SM12A 001/173“, Promo „SV-P 001“
function jpCode(tok){
  if(!JP) return null;
  const t = tok.replace(/[^A-Z0-9.\-]/g, "");
  for(const x of [t, t.replace(/^5/, "S"), t.replace(/8$/, "A"), t.replace(/^5/, "S").replace(/8$/, "A"), t.replace(/0(?=[A-Z]*$)/, "O")]){ const s = JP.byCode.get(x); if(s) return s; }
  return null;
}
function jpParse(raw){
  if(!JP) return null;
  const T = String(raw || "").toUpperCase().replace(/\s*\/\s*/g, "/");
  const res = [/([A-Z0-9][A-Z0-9.\-]{1,6})\s+([0-9OISB]{3})(?:\/([0-9OISB]{2,3}))?(?![0-9])/g,   // mit Leerzeichen
               /([A-Z][A-Z0-9.\-]{0,5}[A-Z])([0-9OISB]{3})\/([0-9OISB]{2,3})(?![0-9])/g];       // zusammengeschrieben
  for(const re of res){
    let m;
    while((m = re.exec(T))){
      if(!/[A-Z]/.test(m[1])) continue;
      const lid = toDigits(m[2]), tot = m[3] ? parseInt(toDigits(m[3]), 10) : NaN;
      let st = jpCode(m[1]);
      // Kleinbuchstabe am Ende fehlt oft beim Lesen („SV2“ statt „SV2a“) -> Set über die Gesamtzahl bestimmen
      if(!st && isFinite(tot)){
        const tok = m[1].replace(/^5/, "S"), hits = [...JP.sets.values()].filter(x => x.id.length === tok.length + 1 && x.id.toUpperCase().startsWith(tok) && Math.abs((x.total || 0) - tot) <= 1);
        if(hits.length === 1) st = hits[0];
      }
      if(!st) continue;
      if(!m[3] && !/-P$/.test(st.id)) continue;                                   // ohne Gesamtzahl nur Promos
      if(isFinite(tot) && st.total && Math.abs(tot - st.total) > 3) continue;   // Gesamtzahl muss zum Set passen
      const cm = JP.cards.get(st.id); if(!cm || !cm.has(lid)) continue;
      return { kind: "jp", sid: st.id, lid, strong: true, key: `jp:${st.id}:${lid}` };
    }
  }
  return null;
}
function jpMake(sid, lid){
  if(!JP) return null;
  const st = JP.sets.get(sid), e = JP.cards.get(sid) && JP.cards.get(sid).get(lid); if(!st || !e) return null;
  const [, ja, en, de, cm, rar] = e;
  return {
    game: "pokemon", language: "Japanisch",
    name: de || en || ja, name_en: en || "", name_jp: ja,
    set: `${st.ja} (${st.id})`, set_code: st.id, number: `${lid}/${st.total}`, rarity: rar || "",
    jp: { sid, lid, cm: cm || 0 }
  };
}
function jpCandidates(r){ const c = jpMake(r.sid, r.lid); return c ? [{ c, label: c.name, sub: `${c.name_jp} · ${r.sid} ${r.lid} · ${JP.sets.get(r.sid).ja}` }] : []; }
// gleiche Karte in anderen japanischen Sets (für „Bearbeiten → Andere Ausgabe“)
function jpAlternatives(c){
  if(!JP) return [];
  const want = (c.name_en || "").toLowerCase(), wantJa = c.name_jp || "";
  const out = [];
  for(const [sid, m] of JP.cards) for(const e of m.values()){
    if(out.length > 80) break;
    if((want && (e[2].toLowerCase() === want || (e[3] || "").toLowerCase() === want)) || (wantJa && e[1] === wantJa)){ const x = jpMake(sid, e[0]); out.push({ c: x, label: x.name, sub: `${x.name_jp} · ${sid} ${e[0]} · ${JP.sets.get(sid).ja}` }); }
  }
  return out;
}
function jpPrice(c){
  const p = c.jp && c.jp.cm && typeof PP !== "undefined" && PP && PP.p && PP.p[c.jp.cm];
  c.price = p ? { low: p[0], trend: p[1], avg1: p[2], avg7: p[3], avg30: p[4], lowH: p[5], trendH: p[6], avg30H: p[7], id: c.jp.cm } : null;
  return c;
}
// Cardmarket: japanische Karten sind eigene Produkte. Direkte Adressen folgen keinem festen Schema ->
// Suche nach dem englischen Namen, gefiltert auf japanische Angebote; das Set steht dabei.
function jpLinks(c){
  const q = c.name_en || `${c.set_code} ${c.jp.lid}`;
  const url = "https://www.cardmarket.com/de/Pokemon/Products/Search?" + CMQ(c) + "&searchString=" + encodeURIComponent(q);
  const ebay = `<a class="alt" href="https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent([c.name_en || c.name, c.set_code, c.jp.lid, "japanese"].join(" "))}&LH_Sold=1&LH_Complete=1" target="_blank" rel="noopener">eBay verkauft ↗</a>`;
  return `<div class="links">
    <a class="cm" href="${url}" target="_blank" rel="noopener">Auf Cardmarket suchen (${esc(q)}, JP) ↗</a>
    <div style="flex:1 1 100%;font-size:11.5px;color:var(--muted)">In der Liste das Set „${esc(JP && JP.sets.get(c.jp.sid) ? JP.sets.get(c.jp.sid).ja : c.set_code)}“ (${esc(c.set_code)}) wählen.</div>
    ${ebay}<button data-del="${esc(c.id)}">Entfernen</button></div>`;
}
async function jpImg(c){
  try{ const r = await fetch(`https://api.tcgdex.net/v2/ja/cards/${encodeURIComponent(c.jp.sid + "-" + c.jp.lid)}`); if(r.ok){ const d = await r.json(); if(d && d.image) return d.image + "/low.webp"; } }catch{}
  return "";
}
document.addEventListener("click", e => { const b = e.target.closest('#langChips [data-lang="Japanisch"]'); if(b) jpLoad(); });
