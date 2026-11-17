// CardGrab Device – Yu-Gi-Oh!: Datenbank (YGOPRODeck), Erkennung des Set-Kürzels (z. B. LOB-DE005),
// Preise (Cardmarket, täglich), Links, Kartenansicht und Vorlesen.
"use strict";
let YGO = null, YGOP = null, YGO_BYPC = null;
// Yu-Gi-Oh!-Daten (≈ 6 MB) erst laden, wenn sie gebraucht werden: beim Scannen, bei Yu-Gi-Oh!-Karten in der
// Sammlung oder nach ein paar Sekunden Leerlauf – so öffnet sich die App sofort.
let _ygoDb = null, _ygoPr = null;
const YGO_HOOKS = { db: [], prices: [] };
function ygoLoad(){
  if(!_ygoDb){
    _ygoDb = fetch("ygodb.json").then(r => r.ok ? r.json() : null).then(d => { YGO = d; YGO_HOOKS.db.forEach(f => { try{ f(d); }catch{} }); return d; }).catch(() => null);
    _ygoPr = fetch("prices-yugioh.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null).then(d => { YGOP = d; YGO_HOOKS.prices.forEach(f => { try{ f(d); }catch{} }); return d; }).catch(() => null);
  }
  return _ygoDb;
}
// "await ygoDbReady" startet das Laden bei Bedarf
const ygoDbReady = { then(res, rej){ return ygoLoad().then(res, rej); } };
const ygoPricesReady = { then(res, rej){ ygoLoad(); return _ygoPr.then(res, rej); } };

const YGO_LANG = { EN: "Englisch", E: "Englisch", DE: "Deutsch", G: "Deutsch", FR: "Französisch", F: "Französisch", IT: "Italienisch", I: "Italienisch",
  SP: "Spanisch", S: "Spanisch", PT: "Portugiesisch", P: "Portugiesisch", JP: "Japanisch", JA: "Japanisch", KR: "Koreanisch", AE: "Englisch" };
const YGO_LCODE = { Englisch: "EN", Deutsch: "DE", Französisch: "FR", Italienisch: "IT", Spanisch: "SP", Portugiesisch: "PT", Japanisch: "JP", Koreanisch: "KR" };
const ygoCard = pc => YGO && (YGO.c[pc] || (YGO.a && YGO.a[pc] && YGO.c[YGO.a[pc]]));
const ygoPc = pc => YGO && (YGO.c[pc] ? +pc : (YGO.a && YGO.a[pc]) || 0);

// Lesevarianten eines Kürzels (OCR verwechselt 0/O, 1/I, 5/S, 8/B)
function ygoPrefixVariants(p){
  const out = new Set([p]);
  const sw = [[/O/g, "0"], [/0/g, "O"], [/I/g, "1"], [/1/g, "I"], [/S/g, "5"], [/5/g, "S"], [/B/g, "8"], [/8/g, "B"], [/Z/g, "2"]];
  for(const [a, b] of sw) out.add(p.replace(a, b));
  return [...out];
}
// Text -> { kind: "ygo", key: "LOB-005", print: "LOB-DE005", lang } | { kind: "ygopass", pc }
function ygoParse(raw){
  if(!YGO) return null;
  const T = String(raw || "").toUpperCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ");
  const re = /\b([A-Z0-9]{2,5}) ?- ?(EN|DE|0E|D E|FR|IT|SP|PT|JP|JA|KR|AE|E|G|F|I|S|P)? ?([A-Z]?[0-9OISB]{2,3})\b/g;
  let m;
  while((m = re.exec(T))){
    const lang = (m[2] || "").replace(" ", "").replace("0E", "DE");
    let num = m[3];
    const lead = /^[A-Z][0-9OISB]{2}$/.test(num) && !/^[OISB]/.test(num) ? num[0] : "";
    num = lead + toDigits(num.slice(lead.length));
    for(const pre of ygoPrefixVariants(m[1])){
      if(/^\d+$/.test(pre)) continue;
      for(const n of [num, num.padStart(3, "0")]){
        const key = `${pre}-${n}`;
        if(YGO.p[key]) return { kind: "ygo", key, print: `${pre}-${lang}${n}`, lang: YGO_LANG[lang] || "", strong: true };
      }
    }
  }
  // 8-stelliger Passcode unten links (Karte bekannt, Ausgabe nicht)
  for(const mm of T.matchAll(/\b(\d{8})\b/g)){ const pc = ygoPc(mm[1]); if(pc) return { kind: "ygopass", pc, strong: false, key: "ygopass:" + pc }; }
  return null;
}
function ygoPrintsOf(pc){
  if(!YGO_BYPC){ YGO_BYPC = new Map(); for(const [k, l] of Object.entries(YGO.p)) for(const e of l){ if(!YGO_BYPC.has(e[0])) YGO_BYPC.set(e[0], new Set()); YGO_BYPC.get(e[0]).add(k); } }
  return [...(YGO_BYPC.get(pc) || [])];
}
// Kartenobjekt bauen
function ygoMake(key, pc, language, print){
  const e = ygoCard(pc); if(!e) return null;
  language = language || (typeof LANG !== "undefined" ? LANG : "Deutsch");
  const pre = key.split("-")[0], n = key.split("-")[1];
  const lc = YGO_LCODE[language] || "EN";
  const c = { game: "yugioh", language, name_en: e[0], name: language === "Deutsch" && e[1] ? e[1] : e[0],
    number: print && /-[A-Z]{1,2}[A-Z]?\d/.test(print) ? print : `${pre}-${lc}${n}`, set_code: pre, set: (YGO.s && YGO.s[pre]) || pre,
    ygo: { key, pc: +ygoPc(pc) || +pc } };
  const rs = (YGO.p[key] || []).filter(x => +x[0] === c.ygo.pc).map(x => x[2]).filter(Boolean);
  if(rs.length) c.rarity = rs.join(" / ");
  return c;
}
function ygoCandidates(r){
  if(!YGO) return [];
  const language = r.lang || (typeof LANG !== "undefined" ? LANG : "Deutsch");
  if(r.kind === "ygo"){
    const pcs = [...new Set((YGO.p[r.key] || []).map(x => x[0]))];
    return pcs.map(pc => ygoMake(r.key, pc, language, r.print)).filter(Boolean).map(c => ({ c, label: c.name, sub: `${c.number} · ${c.set}` }));
  }
  if(r.kind === "ygopass") return ygoPrintsLabeled(r.pc, language);
  return [];
}
function ygoPrintsLabeled(pc, language){
  return ygoPrintsOf(+pc).sort().slice(0, 40).map(k => ygoMake(k, pc, language)).filter(Boolean)
    .map(c => ({ c, label: c.name, sub: `${c.number} · ${c.set}${c.rarity ? " · " + c.rarity : ""}` }));
}
function ygoAttachPrice(c){
  const vs = (YGOP && YGOP.c && YGOP.c[c.ygo.key]) || [];
  // sicher zugeordnete Seltenheiten zuerst, geschätzte/unbenannte danach
  c.versions = vs.map(v => ({ id: v[0], low: v[1], trend: v[2], avg7: v[3], avg30: v[4], guess: !!v[5] || !v[6], pack: v[6] || "?" }))
    .sort((a, b) => (a.guess - b.guess) || 0);
  const i = Math.min(c.vi || 0, Math.max(0, c.versions.length - 1));
  const v = c.versions[i];
  if(v) c.price = { low: v.low, trend: v.trend, avg7: v.avg7, avg30: v.avg30, id: v.id };
  else { const e = ygoCard(c.ygo.pc); c.price = e && e[11] ? { low: e[11], est: true } : null; }
  return c;
}
// Bild je Version: gleiche Seltenheit im Set -> deren Passcode (Alt-Art-Motive haben eigene Passcodes)
function ygoVerPc(c, i){
  const v = c.versions && c.versions[Math.min(i || 0, c.versions.length - 1)];
  if(!v || !YGO || !YGO.p) return c.ygo.pc;
  const l = [...new Set((YGO.p[c.ygo.key] || []).filter(x => x[2] && x[2] === v.pack).map(x => +x[0]))];
  if(!l.length) return c.ygo.pc;
  const r = c.versions.slice(0, c.versions.indexOf(v)).filter(x => x.pack === v.pack).length;
  return l[r % l.length];
}
// ---------- Cardmarket ----------
function ygoLinks(c){
  const v = c.versions && c.versions[Math.min(c.vi || 0, c.versions.length - 1)];
  const search = "https://www.cardmarket.com/de/YuGiOh/Products/Search?" + CMQ(c) + "&searchString=" + encodeURIComponent(c.name_en || c.name);
  // Getestet: die Suche nach dem Set-Code (z. B. „LOB-EN001“) springt direkt auf die Kartenseite;
  // selbst gebaute Direktlinks landeten oft nur auf der Set-Übersicht
  const pcode = /^[A-Z0-9]{2,5}-[A-Z]{0,2}\d{2,3}$/i.test(c.number || "") ? String(c.number).toUpperCase() : "";
  const direct = pcode ? "https://www.cardmarket.com/de/YuGiOh/Products/Search?" + CMQ(c) + "&searchString=" + encodeURIComponent(pcode) : "";
  const ebay = `<a class="alt" href="https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent([c.number, c.name_en || c.name, "yugioh"].filter(Boolean).join(" "))}&LH_Sold=1&LH_Complete=1" target="_blank" rel="noopener">eBay verkauft ↗</a>`;
  return `<div class="links">
    <a class="cm" href="${direct || search}" target="_blank" rel="noopener">Karte auf Cardmarket öffnen (DE · ${esc(YGO_LCODE[c.language] || "EN")} · ${esc(c.cond || "NM")}) ↗</a>
    ${direct ? `<div style="flex:1 1 100%;font-size:11.5px;color:var(--muted)">Mehrere Seltenheiten? Oben auf der Kartenseite die Version (V1, V2 …) wechseln.</div><a class="alt" href="${search}" target="_blank" rel="noopener">Falsche Seite? Suche „${esc(c.name_en || c.name)}“ ↗</a>` : ""}
    ${ebay}<button data-del="${esc(c.id)}">Entfernen</button></div>`;
}
// ---------- Text, Ansicht, Vorlesen ----------
const YGO_TEXT = new Map();
async function ygoText(pc){
  const b = pc % 40;
  if(!YGO_TEXT.has(b)) YGO_TEXT.set(b, fetch(`ygotext/${b}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})));
  const d = await YGO_TEXT.get(b);
  return (d[pc] || []).map(t => String(t || "").replace(/\u0001/g, ""));
}
const YGO_ATTR = { DARK: "Finsternis", LIGHT: "Licht", WATER: "Wasser", FIRE: "Feuer", EARTH: "Erde", WIND: "Wind", DIVINE: "Göttlich" };
const YGO_RACE = { Spellcaster: "Hexer", Dragon: "Drache", Warrior: "Krieger", Beast: "Ungeheuer", "Beast-Warrior": "Ungeheuer-Krieger", Fiend: "Unterweltler",
  Fairy: "Fee", Insect: "Insekt", Dinosaur: "Dinosaurier", Reptile: "Reptil", Fish: "Fisch", "Sea Serpent": "Seeschlange", Aqua: "Aqua", Pyro: "Pyro",
  Thunder: "Donner", Rock: "Fels", Plant: "Pflanze", Machine: "Maschine", Psychic: "Psi", "Divine-Beast": "Göttliches Ungeheuer", Zombie: "Zombie",
  "Winged Beast": "Geflügeltes Ungeheuer", Wyrm: "Wyrm", Cyberse: "Cyberse", Illusion: "Illusion", "Creator-God": "Schöpfergott" };
const YGO_KIND = { Effect: "Effekt", Normal: "Normal", Fusion: "Fusion", Synchro: "Synchro", XYZ: "Xyz", Link: "Link", Ritual: "Ritual", Pendulum: "Pendel",
  Tuner: "Empfänger", Flip: "Flipp", Toon: "Toon", Spirit: "Spirit", Union: "Union", Gemini: "Zwilling" };
const YGO_SPELL = { Normal: "Normal", Continuous: "Permanent", "Quick-Play": "Schnell", Field: "Spielfeld", Equip: "Ausrüstung", Ritual: "Ritual", Counter: "Konter" };
const YGO_FRAME = { normal: "#d9b25f", effect: "#d4823f", ritual: "#5d8fd0", fusion: "#8c5bb0", synchro: "#d8d8d8", xyz: "#2c2c2c", link: "#2a5d9a", spell: "#1d9a8a", trap: "#b0457f", token: "#9a9a9a", skill: "#3a7bd5" };
function ygoInfo(c){
  const e = ygoCard(c.ygo.pc); if(!e) return null;
  const [nameEn, nameDe, frame, attr, level, race, atk, def, link, scale, tl] = e;
  const fr = String(frame || "").split("_")[0];
  const isSpell = fr === "spell", isTrap = fr === "trap";
  const parts = String(tl || "").split("/");
  const kinds = parts.slice(1).map(k => YGO_KIND[k] || k);
  return { name: c.language === "Deutsch" && nameDe ? nameDe : (nameDe || nameEn), frame: fr, pend: /pendulum/.test(frame || ""), attr: YGO_ATTR[attr] || attr, level, race: YGO_RACE[race] || race,
    atk, def, link, scale, isSpell, isTrap, spellType: YGO_SPELL[race] || race, kinds, rankWord: fr === "xyz" ? "Rang" : "Stufe" };
}
async function ygoViewHTML(c){
  const i = ygoInfo(c); if(!i) return "";
  const [t1, t2] = await ygoText(c.ygo.pc);
  const col = YGO_FRAME[i.frame] || "#777";
  const stars = !i.isSpell && !i.isTrap && i.frame !== "link" && i.level ? `<div class="cv-stars">${(i.frame === "xyz" ? "✪" : "★").repeat(Math.min(13, i.level))} <small>${i.rankWord} ${i.level}</small></div>` : "";
  const typ = i.isSpell || i.isTrap ? `[${i.isSpell ? "Zauberkarte" : "Fallenkarte"}${i.spellType && i.spellType !== "Normal" ? " · " + esc(i.spellType) : ""}]` : `[${esc(i.race)}${i.kinds.length ? " / " + esc(i.kinds.join(" / ")) : ""}]`;
  const stat = !i.isSpell && !i.isTrap ? `<div class="cv-stat">ANG/${i.atk ?? "?"}${i.frame === "link" ? `&nbsp; LINK-${i.link || "?"}` : ` &nbsp; VER/${i.def ?? "?"}`}</div>` : "";
  return `<div class="cv ygo" style="--yc:${col}">
    <div class="cv-head"><b class="cv-name">${esc(i.name)}</b><span class="cv-attr">${esc(i.isSpell ? "Zauber" : i.isTrap ? "Falle" : i.attr || "")}</span></div>
    ${stars}
    ${i.pend && t2 ? `<div class="cv-eff pend"><b>Pendelbereich ${i.scale ?? ""}</b><br>${esc(t2)}</div>` : ""}
    <div class="cv-eff"><b>${typ}</b><br>${esc(t1 || "").replace(/\n/g, "<br>")}</div>
    ${stat}
    <div class="cv-foot"><span>${esc(c.number)}</span><span>${esc(c.rarity || "")}</span></div></div>`;
}
const ygoSayTxt = t => String(t || "").replace(/\n+/g, ". ").replace(/●/g, "").replace(/\s*\(([^)]*)\)\s*/g, ", $1, ").replace(/,\s*([.,])/g, "$1").replace(/\.\s*\./g, ".").replace(/\s+/g, " ").trim();
async function ygoSay(c){
  const i = ygoInfo(c); if(!i) return null;
  const [t1, t2] = await ygoText(c.ygo.pc);
  const out = [`${i.name}.`];
  if(i.isSpell || i.isTrap) out.push(`${i.isSpell ? "Zauberkarte" : "Fallenkarte"}${i.spellType && i.spellType !== "Normal" ? ", " + i.spellType : ""}.`);
  else {
    if(i.attr) out.push(`${i.attr}.`);
    if(i.frame === "link") out.push(`Link ${i.link}.`); else if(i.level) out.push(`${i.rankWord} ${i.level}.`);
    out.push(`${[i.race, ...i.kinds].join(", ")}.`);
  }
  if(i.pend && t2) out.push(`Pendelbereich ${i.scale}. ${ygoSayTxt(t2)}`);
  if(t1) out.push(ygoSayTxt(t1));
  if(!i.isSpell && !i.isTrap) out.push(i.frame === "link" ? `Angriff ${i.atk}.` : `Angriff ${i.atk}, Verteidigung ${i.def}.`);
  return out.join(" ").replace(/\.\./g, ".");
}
