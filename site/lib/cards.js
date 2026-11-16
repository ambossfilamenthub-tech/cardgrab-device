// CardGrab – gemeinsame Karten-Logik (Kartendatenbank, Cardmarket-Links). Aus der Claude-Version übernommen.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const samplePromise = Promise.resolve(null);
const upsert = () => {};
const ask = async () => null;
// ---------- Karten-Darstellung ----------
// Kürzel säubern: "PAR DE", "PARDE", "par-en" -> "PAR"
function normCode(raw){
  let t = String(raw || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").trim();
  t = t.replace(/\s+(DE|EN|FR|IT|ES|PT|NL|JP|JA|KO|ZH)$/, "");
  t = t.replace(/\s+/g, "");
  const m = t.match(/^([A-Z0-9]{2,4}?)(DE|EN|FR|IT|ES|PT|NL|JP)$/);
  if(m && typeof SETS !== "undefined" && SETS.some(x => x[0] === m[1])) t = m[1];
  return t;
}
function cmCode(c){
  if(c.op) return c.op.id;
  const code = normCode(c.set_code);
  const nr = String(c.number || "").split("/")[0].replace(/[^0-9A-Z]/gi, "");
  if(!code || !nr) return "";
  const n = /^\d+$/.test(nr) ? nr.padStart(3, "0") : nr.toUpperCase();
  return `${code} ${n}`;
}
const LANG_ID = { englisch:1, english:1, französisch:2, franzoesisch:2, french:2, deutsch:3, german:3, spanisch:4, spanish:4, italienisch:5, italian:5, chinesisch:6, chinese:6, japanisch:7, japanese:7, portugiesisch:8, portuguese:8, russisch:9, koreanisch:10, korean:10 };
function langId(c){
  const l = String(c.language || "").toLowerCase();
  for(const k in LANG_ID) if(l.includes(k)) return LANG_ID[k];
  return 3;
}
const slug = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’.:]/g, "").replace(/&/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function productUrl(c, verOverride){
  if(!c.db && CDB) applyDb(c);
  if(c.db && c.db.code) return dbUrl(c, verOverride !== undefined);
  const code = normCode(c.set_code);
  const nrRaw = String(c.number || "").split("/")[0].replace(/[^0-9A-Z]/gi, "");
  const tab = SETS.find(x => x[0] && x[0] === code);
  const exp = (tab && tab[1]) || c.cm_expansion || c.set_en;
  if(!code || !nrRaw || !exp || !(c.name_en || c.name)) return "";
  const nr = /^\d+$/.test(nrRaw) ? nrRaw.padStart(3, "0") : nrRaw.toUpperCase();
  // Versionsnummer nur, wenn es die Karte im Set wahrscheinlich mehrfach gibt:
  // Secret/Galerie-Nummern (über der Kartenzahl) oder ex/V/VMAX/VSTAR/GX-Karten.
  let v = verOverride !== undefined ? verOverride : String(c.cm_version || "").replace(/\D/g, "");
  if(verOverride === undefined && v){
    const tot = parseInt(String(c.number || "").split("/")[1], 10), n = parseInt(nrRaw, 10);
    const special = /^[A-Z]/i.test(nrRaw) || (isFinite(n) && isFinite(tot) && n > tot);
    const multi = /\b(ex|EX|V|VMAX|VSTAR|GX)\b|-ex$/.test(String(c.name_en || c.name || ""));
    if(!special && !multi) v = "";
  }
  const ver = v ? "-V" + v : "";
  const known = SETS.find(x => x[0] && x[0] === code && x[4]);
  const expSlug = (known && known[4]) || c.cm_exp_slug || slug(exp);
  return `https://www.cardmarket.com/de/Pokemon/Products/Singles/${expSlug}/${slug(c.name_en || c.name)}${ver}-${code}${nr}?${CMQ(c)}`;
}
// Cardmarket-Filter: Sprache der Karte, mind. Near Mint, Verkäufer aus Deutschland
const CMQ = c => `language=${langId(c)}&minCondition=${({ MT: 1, NM: 2, EX: 3, GD: 4, LP: 5, PL: 6, PO: 7 })[c.cond] || 2}&sellerCountry=7`;
function links(c){
  if(c.jp && typeof jpLinks === "function") return jpLinks(c);
  if(isOP(c)) return opLinks(c);
  if(!c.db && CDB) applyDb(c);
  const code = cmCode(c);
  const S0 = "https://www.cardmarket.com/de/Pokemon/Products/Search?" + CMQ(c) + "&searchString=";
  const S = S0;
  const ebay = `<a class="alt" href="https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent([c.name, code || c.number, "pokemon"].filter(Boolean).join(" "))}&LH_Sold=1&LH_Complete=1" target="_blank" rel="noopener">eBay verkauft ↗</a>`;
  const del = `<button data-del="${esc(c.id)}">Entfernen</button>`;
  if(c.db && c.db.code){
    // Versionsnummer aus Cardmarkets täglicher Produktliste (genauer als die gespeicherte Datenbank)
    const vv = typeof PP !== "undefined" && PP && PP.v && PP.v[c.db.cm];
    const h = vv ? { ...c.db, ver: vv[0], nver: vv[1], exact: true } : c.db;
    const lid = /^\d+$/.test(h.lid) && /^(sv|me|swsh|30th|202[1-9])/.test(h.sid || "") ? h.lid.padStart(3, "0") : h.lid;
    const search = S + encodeURIComponent(`${h.code} ${lid}`);
    // Direkte Kartenseite nur dort, wo Cardmarkets Adressschema geprüft ist (Karmesin & Purpur, Mega-Entwicklung,
    // 30 Jahre, McDonald's 2024). Ältere Sets (z. B. Drachenwandel: ".../Evolving-Skies/Nickit" ohne Kürzel)
    // folgen keinem festen Schema -> dort führt die Suche nach "KÜRZEL NNN" zur Karte.
    const verified = /^(sv|me|30th)/.test(h.sid || "") || h.code === "M24";
    if(!verified){
      return `<div class="links">
        <a class="cm" href="${search}" target="_blank" rel="noopener">Karte auf Cardmarket öffnen (${esc(h.code + " " + lid)}) ↗</a>
        <a class="alt" href="${dbUrl(c, false, h.nver > 1 ? h.ver : 0)}" target="_blank" rel="noopener">Direktlink (Versuch) ↗</a>${ebay}${del}</div>`;
    }
    if(h.exact && h.nver > 1){
      const vbtn = Array.from({length: h.nver}, (_, i) => i + 1 === h.ver ? "" : `<a class="alt" style="flex:0 0 auto;min-width:54px" href="${dbUrl(c, false, i + 1)}" target="_blank" rel="noopener">V${i + 1}</a>`).join("");
      return `<div class="links">
        <a class="cm" href="${dbUrl(c, false, h.ver)}" target="_blank" rel="noopener">Karte auf Cardmarket öffnen (V${h.ver} · ${esc(c.cond || "NM")} · DE) ↗</a>
        <div style="flex:1 1 100%;font-size:11.5px;color:var(--muted)">Cardmarket führt diese Karte ${h.nver}× (z. B. mit Stempel/Promo). Andere Versionen:</div>
        ${vbtn}<a class="alt" href="${search}" target="_blank" rel="noopener">Suche ${esc(h.code + " " + lid)} ↗</a>${ebay}${del}</div>`;
    }
    if(!h.nver || h.nver < 2){
      return `<div class="links">
        <a class="cm" href="${dbUrl(c, false, 0)}" target="_blank" rel="noopener">Karte auf Cardmarket öffnen (${esc(c.cond || "NM")} · DE) ↗</a>
        <a class="alt" href="${search}" target="_blank" rel="noopener">Suche ${esc(h.code + " " + lid)} ↗</a>${ebay}${del}</div>`;
    }
    // Die Karte gibt es im Set mehrfach (z. B. normale Karte + Illustration Rare). Cardmarket nummeriert diese
    // Versionen nicht nach einem festen Schema -> Suche nach "KÜRZEL NNN" führt direkt hin, dazu Versions-Knöpfe.
    const vbtn = Array.from({length: h.nver}, (_, i) => `<a class="alt" style="flex:0 0 auto;min-width:54px" href="${dbUrl(c, false, i + 1)}" target="_blank" rel="noopener">V${i + 1}</a>`).join("");
    return `<div class="links">
      <a class="cm" href="${search}" target="_blank" rel="noopener">Karte auf Cardmarket öffnen (${esc(h.code + " " + lid)}) ↗</a>
      <div style="flex:1 1 100%;font-size:11.5px;color:var(--muted)">Diese Karte gibt es im Set ${h.nver}× – falls Cardmarket eine Liste zeigt, die mit „${esc(h.code + " " + lid)}“ antippen, oder direkt:</div>
      ${vbtn}${ebay}${del}</div>`;
  }
  // ohne Datenbank-Treffer: bisheriges Verfahren
  const direct = productUrl(c);
  const v = String(c.cm_version || "").replace(/\D/g, "");
  const alt = direct ? productUrl(c, v ? "" : "1") : "";
  const search = S + encodeURIComponent(code || c.cm_name || c.name_en || c.name || "");
  return `<div class="links">
    <a class="cm" href="${direct || search}" target="_blank" rel="noopener">${direct ? `Karte auf Cardmarket öffnen (${esc(c.cond || "NM")} · DE)` : "Auf Cardmarket suchen"} ↗</a>
    ${alt ? `<a class="alt" href="${alt}" target="_blank" rel="noopener">„Ungültiges Produkt“? Andere Version ↗</a>` : ""}
    <a class="alt" href="${search}" target="_blank" rel="noopener">Suche ↗</a>${ebay}${del}</div>`;
}

const SETS = [
 ["SSH","Sword & Shield","Schwert & Schild",202],["RCL","Rebel Clash","Clash der Rebellen",192],
 ["DAA","Darkness Ablaze","Flammende Finsternis",189],["CPA","Champion's Path","Weg des Champs",73],
 ["VIV","Vivid Voltage","Farbenschock",185],["SHF","Shining Fates","Glänzendes Schicksal",72],
 ["BST","Battle Styles","Kampfstile",163],["CRE","Chilling Reign","Schaurige Herrschaft",198],
 ["EVS","Evolving Skies","Drachenwandel",203],["CEL","Celebrations","Celebrations",25],
 ["FST","Fusion Strike","Fusionsangriff",264],["BRS","Brilliant Stars","Strahlende Sterne",172],
 ["ASR","Astral Radiance","Astralglanz",189],["PGO","Pokémon GO","Pokémon GO",78],
 ["LOR","Lost Origin","Verlorener Ursprung",196],["SIT","Silver Tempest","Silberne Sturmwinde",195],
 ["CRZ","Crown Zenith","Zenit der Könige",159],
 ["SVI","Scarlet & Violet","Karmesin & Purpur",198],["PAL","Paldea Evolved","Entwicklungen in Paldea",193],
 ["OBF","Obsidian Flames","Obsidian Flammen",197],["MEW","151","151",165],["PAR","Paradox Rift","Paradoxrift",182],
 ["PAF","Paldean Fates","Paldeas Schicksale",91],["TEF","Temporal Forces","Gewalten der Zeit",162],
 ["TWM","Twilight Masquerade","Maskerade im Zwielicht",167],["SFA","Shrouded Fable","Nebel der Sagen",64],
 ["SCR","Stellar Crown","Stellarkrone",142],["SSP","Surging Sparks","Stürmische Funken",191],
 ["PRE","Prismatic Evolutions","Prismatische Entwicklungen",131],["JTG","Journey Together","Reisegefährten",159],
 ["DRI","Destined Rivals","Ewige Rivalen",182],["BLK","Black Bolt","Schwarze Blitze",86],["WHT","White Flare","Weiße Flammen",86],
 ["MEG","Mega Evolution","Mega-Entwicklung",132],["PFL","Phantasmal Flames","Fatale Flammen",94],
 ["ASC","Ascended Heroes","Erhabene Helden",217],["POR","Perfect Order","Optimale Ordnung",88],
 ["CRI","Chaos Rising","Wachsendes Chaos",86],["PBL","Pitch Black","Dunkelnacht",84],["DLR","Delta Reign","Delta-Herrschaft",103],["30C","30th Celebration","30 Jahre",128],
 ["SVP","Scarlet & Violet Promos","Karmesin & Purpur Promos",0],["MEP","Mega Evolution Promos","Mega-Entwicklung Promos",0],
 ["M24","McDonald's Dragon Discovery","McDonald's Dragon Discovery",15,"McDonalds-Collection-2024"]
];
const SET_HINT = SETS.filter(x => x[0]).map(x => `${x[0]}=${x[1]} (DE: ${x[2]}${x[3] ? ", /" + String(x[3]).padStart(3,"0") : ""})`).join("; ");
function enrich(c){
  c.set_code = normCode(c.set_code);
  const code = normCode(c.set_code);
  const total = parseInt(String(c.number || "").split("/")[1], 10);
  let hit = SETS.find(x => x[0] && x[0] === code);
  // Kürzel ist in der großen Kartendatenbank bekannt -> nichts raten, applyDb() übernimmt
  if(!hit && code && typeof CDB !== "undefined" && CDB && CDB.byCode.has(CODE_ALIAS[code] || code)) return c;
  if(!hit){
    const nm = t => String(t || "").toLowerCase().replace(/trainer[- ]?gal(l)?erie|galar[- ]?gal(l)?erie|glitzer[- ]?tresor|shiny vault|trainer gallery|galarian gallery/g, "").replace(/[^a-z0-9äöü]/g, "");
    const names = [c.set, c.set_en].map(nm).filter(Boolean);
    hit = SETS.find(x => names.some(n => n === nm(x[1]) || n === nm(x[2])));
  }
  // Kartenzahl nur nutzen, wenn KEIN Kürzel gelesen wurde (sonst Verwechslung, z. B. Dschungel /64 vs. Nebel der Sagen /64)
  // Mit geladener Kartendatenbank übernimmt applyDb() die Zuordnung über Name + Kartenzahl (genauer)
  if(!hit && total && !code && !(typeof CDB !== "undefined" && CDB)){ const m = SETS.filter(x => x[3] === total); if(m.length === 1) hit = m[0]; }
  if(hit){
    if(hit[0]) c.set_code = hit[0];
    c.set_en = hit[1]; c.cm_expansion = hit[1]; if(hit[4]) c.cm_exp_slug = hit[4];
    if(/deutsch|german/i.test(c.language || "") || !c.set) c.set = hit[2];
  }
  return c;
}


// ---------- Kartendatenbank (TCGdex, mit Cardmarket-Produktnummern) ----------
let CDB = null;
const CODE_ALIAS = { M24:"MCD24", M23:"MCD23", M22:"MCD22", M21:"MCD21", M19:"MCD19", M18:"MCD18", M17:"MCD17", M16:"MCD16", M15:"MCD15", M14:"MCD14" };
const CM_CODE = { MCD24:"M24" };   // Kürzel, das Cardmarket in Adressen nutzt (wo abweichend, geprüft)
const nrm = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]/g, "");
const cardDbReady = Promise.resolve().then(() => fetch("carddb.json")).then(r => r.ok ? r.json() : null).then(d => {
  if(!d) return null;
  const sets = new Map(), byCode = new Map(), cards = new Map(), byTotal = new Map();
  for(const [id, code, en, de, total, gal] of d.s){
    const st = { id, code, en, de, total, gal: !!gal };
    sets.set(id, st);
    if(code){ if(!byCode.has(code)) byCode.set(code, []); byCode.get(code).push(st); }
    if(total){ if(!byTotal.has(total)) byTotal.set(total, []); byTotal.get(total).push(st); }
  }
  for(const [id, list] of Object.entries(d.c)){
    const m = new Map(); for(const e of list) m.set(String(e[0]).toUpperCase(), e); cards.set(id, m);
  }
  CDB = { sets, byCode, cards, byTotal };
  return CDB;
}).catch(() => null);

function lidVariants(raw){
  const r = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const out = new Set([r]);
  const m = r.match(/^([A-Z]*)0*(\d+)([A-Z]?)$/);
  if(m){
    const [, pre, num, suf] = m;
    out.add(pre + num + suf); out.add(pre + num.padStart(2, "0") + suf); out.add(pre + num.padStart(3, "0") + suf);
  }
  return [...out].filter(Boolean);
}
function nameScore(e, c){
  const a = [e[2], e[3]].map(nrm).filter(Boolean), b = [c.name, c.name_en].map(nrm).filter(Boolean);
  let best = 0;
  for(const x of a) for(const y of b){ if(x === y) best = Math.max(best, 1); else if(x.includes(y) || y.includes(x)) best = Math.max(best, 0.8); }
  return best;
}
function dbLookup(c){
  if(!CDB) return null;
  const code0 = normCode(c.set_code), code = CODE_ALIAS[code0] || code0;
  const [left, right] = String(c.number || "").toUpperCase().replace(/\s/g, "").split("/");
  const total = parseInt(String(right || "").replace(/^[A-Z]+/, ""), 10);
  const variants = lidVariants(left);
  const hitsIn = sets => { const h = []; for(const st of sets){ const m = CDB.cards.get(st.id); if(!m) continue; for(const v of variants){ const e = m.get(v); if(e){ h.push({ st, e }); break; } } } return h; };
  let hits = code ? hitsIn(CDB.byCode.get(code) || []) : [];
  if(!hits.length){
    const strip = t => nrm(String(t || "").replace(/trainer[- ]?gal(l)?er(ie|y)|galar(ian)?[- ]?gal(l)?er(ie|y)|glitzer[- ]?tresor|shiny vault/ig, ""));
    const names = [c.set, c.set_en, c.cm_expansion].map(strip).filter(Boolean);
    const byName = [...CDB.sets.values()].filter(st => names.some(n => n === nrm(st.en) || n === nrm(st.de)));
    hits = hitsIn(byName);
  }
  if(!hits.length && isFinite(total)) hits = hitsIn(CDB.byTotal.get(total) || []);
  if(!hits.length) return null;
  hits.forEach(h => h.score = nameScore(h.e, c) + (isFinite(total) && h.st.total === total ? 0.3 : 0) + (code && h.st.code === code ? 0.5 : 0));
  hits.sort((a, b) => b.score - a.score);
  const best = hits[0];
  if(best.score < 0.8 && !(code && best.st.code === code)) return null;
  // Hauptset (Cardmarket führt Galerie-Karten im Hauptset)
  const grp = best.st.code ? (CDB.byCode.get(best.st.code) || [best.st]) : [best.st];
  const main = grp.filter(st => !st.gal).sort((a, b) => b.total - a.total)[0] || best.st;
  // Versionsnummer: gleicher englischer Name mehrfach in der Cardmarket-Erweiterung -> V1, V2 … nach Nummer
  const same = [];
  for(const st of grp){ const m = CDB.cards.get(st.id); if(m) for(const e of m.values()) if(e[2] === best.e[2]) same.push(e[0]); }
  const key = l => { const m = String(l).match(/^([A-Z]*)(\d+)/i) || ["", "", "0"]; return [m[1] ? 1 : 0, m[1] || "", parseInt(m[2], 10)]; };
  same.sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1].localeCompare(y[1]) || x[2] - y[2]; });
  const ver = same.length > 1 ? same.indexOf(best.e[0]) + 1 : 0;   // nur Schätzung – Cardmarket nummeriert nicht immer so
  return { lid: best.e[0], cm: best.e[1], en: best.e[2], de: best.e[3] || best.e[2], setEn: main.en, setDe: main.de || main.en,
           code: CM_CODE[best.st.code] || best.st.code, total: best.st.total, ver, nver: same.length, sid: best.st.id };
}
function applyDb(c){
  const h = dbLookup(c);
  if(!h) return c;
  c.db = h;
  c.name_en = h.en; c.cm_expansion = h.setEn; c.cm_version = h.ver ? String(h.ver) : "";
  if(h.code) c.set_code = h.code;
  if(/deutsch|german/i.test(c.language || "")){ c.set = h.setDe; if(h.de) c.name = h.de; } else c.set = c.set || h.setEn;
  return c;
}
function dbUrl(c, flipVersion, fixedVer){
  const h = c.db; if(!h || !h.code) return "";
  let ver = fixedVer !== undefined ? fixedVer : h.ver; if(flipVersion) ver = ver ? 0 : 1;
  // Cardmarket schreibt Nummern ab Schwert & Schild dreistellig (PAR040, M24003)
  const lid = /^\d+$/.test(h.lid) && /^(sv|me|swsh|30th|202[1-9])/.test(h.sid || "") ? h.lid.padStart(3, "0") : h.lid;
  return `https://www.cardmarket.com/de/Pokemon/Products/Singles/${slug(h.setEn)}/${slug(h.en)}${ver ? "-V" + ver : ""}-${h.code}${lid}?${CMQ(c)}`;
}


// ---------- One Piece Card Game (offizielle Bandai-Kartenliste, OP01 … OP18, EB, PRB, ST, Promos) ----------
let OPDB = null;
const opDbReady = new Promise(r => setTimeout(r, 0)).then(() => fetch("opdb.json")).then(r => r.ok ? r.json() : null).then(d => {
  if(!d) return null;
  const sets = new Map(d.s.map(([lab, title, prefix]) => [lab, { lab, title, prefix }]));
  OPDB = { sets, cards: d.c };
  return OPDB;
}).catch(() => null);
const OP_RE = /\b(OP|ST|EB|PRB)\s*-?\s*(\d{1,2})\s*[-–]\s*(\d{3})\b|\bP\s*[-–]\s*(\d{3})\b/i;
function opId(t){
  const m = String(t || "").toUpperCase().match(OP_RE);
  if(!m) return "";
  return m[4] ? `P-${m[4]}` : `${m[1]}${m[2].padStart(2, "0")}-${m[3]}`;
}
function isOP(c){
  if(!c) return false;
  if(c.op || c.game === "onepiece") return true;
  return !!opId(c.number) && /^(OP|ST|EB|PRB|P)\b/i.test(String(c.number || "").trim());
}
const OP_RAR = { Common:"C", Uncommon:"UC", Rare:"R", SuperRare:"SR", SecretRare:"SEC", Leader:"L", Special:"SP", TreasureRare:"TR", Promo:"P" };
const OP_SETNAME = { OP14_EB04:"The Azure Sea's Seven", OP15_EB04:"Adventure on Kami's Island" };
function opSetTitle(lab){
  const st = OPDB && OPDB.sets.get(lab);
  if(!st) return lab === "Promo" ? "Promo-Karten" : lab;
  let t = st.title || OP_SETNAME[lab.replace("-", "_")] || "";
  if(t && t === t.toUpperCase()) t = t.toLowerCase().replace(/(^|[\s(\-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Of|The|In|On|His|Nur)\b/g, w => w.toLowerCase()).replace(/^./, x => x.toUpperCase()).replace(/'S\b/g, "'s");
  return `${lab} ${t}`.trim();
}
function opApply(c){
  c.game = "onepiece";
  const id = opId(c.number) || opId(`${c.set_code || ""}-${c.number || ""}`) || opId(c.set_code);
  if(id) c.number = id;
  if(!OPDB || !id || !OPDB.cards[id]) return c;
  const e = OPDB.cards[id];
  const jp = /japan|日本/i.test(c.language || "");
  const vars = (jp ? e[13] : e[12]) || e[12] || e[13] || [];
  c.op = { id, name: e[0], cat: e[1], color: e[2], cost: e[3], power: e[4], counter: e[5], attr: e[6], types: e[7],
           effect: e[8], trigger: e[9], rarity: e[10], pack: e[11], nver: vars.length,
           packs: [...new Set(vars.map(v => v[1]))], jp, name_jp: e[14] || "" };
  c.set_code = id.split("-")[0];
  const pack = (jp && e[13] && e[13][0] && e[13][0][1]) || e[11];
  c.op.pack = pack;
  c.set = opSetTitle(pack);
  // Anzeige: englischer Name (lesbar), japanischer Name zusätzlich
  if(jp){ c.name_jp = e[14] || c.name || ""; c.name = /[\u3040-\u30ff\u4e00-\u9fff]/.test(e[0]) ? (c.name_en || c.name || e[0]) : e[0]; }
  else if(!c.name || (/[\u3040-\u30ff\u4e00-\u9fff]/.test(c.name) && !/[\u3040-\u30ff\u4e00-\u9fff]/.test(e[0]))){ if(c.name && c.name !== e[0]) c.name_jp = c.name; c.name = e[0]; }
  c.name_en = /[\u3040-\u30ff\u4e00-\u9fff]/.test(e[0]) ? (c.name_en || "") : e[0];
  if(!c.rarity) c.rarity = OP_RAR[e[10]] || e[10];
  return c;
}
function opTitle(lab){
  const st = OPDB && OPDB.sets.get(lab); let t = st ? st.title : "";
  if(t && t === t.toUpperCase()) t = t.toLowerCase().replace(/(^|[\s(\-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Of|The|In|On|His)\b/g, w => w.toLowerCase()).replace(/^./, x => x.toUpperCase()).replace(/'S\b/g, "'s");
  return t.replace(/\s*\(nur Japan\)/, "");
}
// Direkte Kartenseite: /OnePiece/Products/Singles/<Erweiterung>/<Name>-<ID>[-V<n>]
function opDirect(c){
  if(!c.op || !c.versions || !c.versions.length) return "";
  const v = c.versions[Math.min(c.vi || 0, c.versions.length - 1)];
  if(!v || !v.pack || !/^(OP|EB|PRB)\d/.test(v.pack)) return "";
  const exp = opTitle(v.pack); if(!exp) return "";
  const same = c.versions.filter(x => x.pack === v.pack).sort((a, b) => a.id - b.id);
  const k = same.length > 1 ? "-V" + (same.indexOf(v) + 1) : "";
  // Versionsnummer steht wie bei Pokémon vor der Nummer: …/Yamato-V2-OP16-098
  return `https://www.cardmarket.com/de/OnePiece/Products/Singles/${slug(exp)}/${slug(c.op.name)}${k}-${c.op.id}?${CMQ(c)}`;
}
function opLinks(c){
  if(!c.op && OPDB) opApply(c);
  const id = c.op ? c.op.id : opId(c.number) || c.number || c.name;
  const search = "https://www.cardmarket.com/de/OnePiece/Products/Search?" + CMQ(c) + "&searchString=" + encodeURIComponent(id);
  const direct = opDirect(c);
  const lang = c.op && c.op.jp ? "JP" : "EN";
  // Name-Suche findet die Karte immer (Nummern stehen bei Cardmarket nicht zuverlässig im Produktnamen)
  const nm = c.name_en || (c.op && c.op.name) || c.name;
  const byName = "https://www.cardmarket.com/de/OnePiece/Products/Search?" + CMQ(c) + "&searchString=" + encodeURIComponent(nm);
  const setT = c.op && c.op.pack ? opTitle(c.op.pack) : (c.set || "");
  const ebay = `<a class="alt" href="https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent([id, c.name_en || c.name, "one piece"].filter(Boolean).join(" "))}&LH_Sold=1&LH_Complete=1" target="_blank" rel="noopener">eBay verkauft ↗</a>`;
  const del = `<button data-del="${esc(c.id)}">Entfernen</button>`;
  return `<div class="links">
    <a class="cm" href="${byName}" target="_blank" rel="noopener">Auf Cardmarket suchen: ${esc(nm)} (DE · ${lang} · ${esc(c.cond || "NM")}) ↗</a>
    ${setT ? `<div style="flex:1 1 100%;font-size:11.5px;color:var(--muted)">In der Liste die Karte aus „${esc(setT)}“ mit Nr. ${esc(id)} wählen.</div>` : ""}
    ${direct ? `<a class="alt" href="${direct}" target="_blank" rel="noopener">Direktlink (Versuch) ↗</a>` : ""}
    <a class="alt" href="${search}" target="_blank" rel="noopener">Suche ${esc(id)} ↗</a>
    ${ebay}${del}</div>`;
}
function opFacts(c){
  const o = c.op; if(!o) return "";
  const out = [`${c.name}${o.cat ? ", " + ({Leader:"Leader", Character:"Charakter", Event:"Event", Stage:"Ort", "DON!!":"DON!!"}[o.cat] || o.cat) : ""}${o.color ? ", Farbe " + o.color.replace(/Red/g,"Rot").replace(/Green/g,"Grün").replace(/Blue/g,"Blau").replace(/Purple/g,"Lila").replace(/Black/g,"Schwarz").replace(/Yellow/g,"Gelb").replace("/", " und ") : ""}.`];
  if(o.cost != null) out.push(o.cat === "Leader" ? `${o.cost} Leben.` : `Kosten ${o.cost}.`);
  if(o.power) out.push(`Stärke ${o.power}.`);
  if(o.counter) out.push(`Konter plus ${o.counter}.`);
  if(o.attr) out.push(`Attribut: ${o.attr}.`);
  if(o.types) out.push(`Typ: ${o.types.replace(/\//g, ", ")}.`);
  const eff = c.op_effect_de || o.effect;
  if(eff) out.push(`Effekt: ${eff}`);
  const trg = c.op_trigger_de || o.trigger;
  if(trg) out.push(`Trigger: ${trg}`);
  return out.join("\n");
}
async function opEnsureFacts(c){
  if(!c.op && OPDB) opApply(c);
  if(!c.op) return false;
  if(c.op_effect_de !== undefined || (!c.op.effect && !c.op.trigger)) return true;
  const sample = await samplePromise; if(!sample) return true;
  try{
    const r = await ask(sample, `Übersetze diese Effekttexte einer One-Piece-Sammelkarte (${c.op.id} ${c.op.name}) ins Deutsche, gut vorlesbar. Begriffe wie DON!!, Leader, KO, Konter, Trigger beibehalten; [On Play] = [Beim Ausspielen], [When Attacking] = [Beim Angreifen], [Activate: Main] = [Aktivieren: Hauptphase], [Once Per Turn] = [Einmal pro Zug], [Your Turn] = [Dein Zug], [Opponent's Turn] = [Gegnerischer Zug], [Blocker], [Rush], [Double Attack], [Banish] beibehalten. Antworte NUR mit JSON: {"effect":"","trigger":""}
Effekt: ${c.op.effect || "-"}
Trigger: ${c.op.trigger || "-"}`, {modelTier:"default"});
    c.op_effect_de = (r && r.effect && r.effect !== "-") ? r.effect : (c.op.effect || "");
    c.op_trigger_de = (r && r.trigger && r.trigger !== "-") ? r.trigger : (c.op.trigger || "");
    upsert(c);
  }catch{}
  return true;
}
