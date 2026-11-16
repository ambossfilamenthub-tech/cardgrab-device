// CardGrab Device – japanische Pokémon-Karten (TCGdex data-asia) -> site/jpdb.json
// Aufruf: node scripts/build-jp.mjs <tcgdex/cards-database> <site>
// Ergebnis: { s: [[setId, jaName, enName, offizielleAnzahl, cmExpansion]], c: { setId: [[nr, jaName, enName, deName, cmProdukt, seltenheit]] } }
// Englische/deutsche Namen: über die Pokédex-Nummer aus den internationalen Karten (data/), Zusatz (ex, V, VMAX …) aus dem japanischen Namen.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const [root, siteDir] = process.argv.slice(2);
if(!root || !siteDir){ console.error("Aufruf: node build-jp.mjs <cards-database> <site>"); process.exit(1); }
const CTX = vm.createContext({});
function load(file){
  let src = fs.readFileSync(file, "utf8");
  src = src.replace(/^\s*import .*$/mg, "").replace(/export default \w+\s*;?/g, "")
           .replace(/const\s+\w+\s*:\s*\w+\s*=/, "module.exports =").replace(/\bset\s*:\s*Set\s*,?/, "").replace(/\bserie\s*:\s*serie\s*,?/, "");
  const m = { exports: {} };
  vm.runInContext("(function(module, exports){" + src + "\n})", CTX, { timeout: 1000 })(m, m.exports);
  return m.exports;
}
const walkSets = base => {
  const out = [];
  for(const serie of fs.readdirSync(base)){
    const sdir = path.join(base, serie);
    if(!fs.statSync(sdir).isDirectory() || /Pocket/i.test(serie)) continue;
    for(const f of fs.readdirSync(sdir)) if(f.endsWith(".ts") && fs.existsSync(path.join(sdir, f.slice(0, -3)))) out.push([path.join(sdir, f), path.join(sdir, f.slice(0, -3))]);
  }
  return out;
};

// 1) Pokédex-Nummer -> englischer/deutscher Grundname (kürzester Name ohne Zusatz)
const DEX = new Map(), CAND = new Map();   // dex -> Map(en -> Map(de -> Anzahl))
for(const [, cdir] of walkSets(path.join(root, "data"))){
  for(const cf of fs.readdirSync(cdir)){
    if(!cf.endsWith(".ts")) continue;
    let c; try{ c = load(path.join(cdir, cf)); }catch{ continue; }
    if(c.category !== "Pokemon" || !c.dexId || c.dexId.length !== 1 || !c.name || !c.name.en) continue;
    const en = c.name.en.trim(), de = (c.name.de || "").trim();
    if(/\b(ex|EX|GX|V|VMAX|VSTAR|BREAK|LV\.X|Prime|LEGEND|δ)\b|'s |Radiant|Mega|Dark |Light |Shining|Galarian|Alolan|Hisuian|Paldean|Flying|Surfing|◇|☆|\(/.test(en)) continue;
    if(!CAND.has(c.dexId[0])) CAND.set(c.dexId[0], new Map());
    const m = CAND.get(c.dexId[0]); if(!m.has(en)) m.set(en, new Map());
    if(de && de !== en) m.get(en).set(de, (m.get(en).get(de) || 0) + 1);
    else m.get(en).set("", (m.get(en).get("") || 0) + 1);
  }
}
for(const [dex, m] of CAND){
  // Grundname = häufigster englischer Name (bei Gleichstand der kürzeste), deutsch = häufigster Name dazu
  const tot = en => [...m.get(en).values()].reduce((a, b) => a + b, 0);
  const en = [...m.keys()].sort((a, b) => tot(b) - tot(a) || a.length - b.length)[0];
  const des = [...m.get(en).entries()].filter(([d]) => d).sort((a, b) => b[1] - a[1]);
  DEX.set(dex, { en, de: des.length ? des[0][0] : "" });
}
console.log(`Pokédex-Namen: ${DEX.size}`);

// Zusatz aus dem japanischen Namen übernehmen
const SUFFIX = [[/VMAX$/, " VMAX"], [/VSTAR$/, " VSTAR"], [/V-UNION$/, " V-UNION"], [/(?<![A-Z])V$/, " V"], [/GX$/, "-GX"], [/(?<![A-Za-z])ex$/, " ex"], [/EX$/, "-EX"], [/BREAK$/, " BREAK"], [/LV\.X$/, " LV.X"]];
const PREFIX = [[/^かがやく/, "Radiant ", "Strahlendes "], [/^メガ/, "Mega-", "Mega-"], [/^ヒスイ/, "Hisuian ", "Hisui-"], [/^ガラル/, "Galarian ", "Galar-"], [/^アローラ/, "Alolan ", "Alola-"], [/^パルデア/, "Paldean ", "Paldea-"]];
function intlNames(c){
  const ja = (c.name && c.name.ja) || "";
  if(c.category === "Pokemon" && c.dexId && c.dexId.length === 1 && DEX.has(c.dexId[0])){
    const b = DEX.get(c.dexId[0]); let en = b.en, de = b.de || b.en;
    for(const [re, e, d] of PREFIX) if(re.test(ja)){ en = e + en; de = d + de; break; }
    for(const [re, s] of SUFFIX) if(re.test(ja.trim())){ en += s; de += s.replace(/^-/, "-"); break; }
    return [en, de];
  }
  // Trainer/Energie: indonesischer Name ist oft der englische Kartenname – nur übernehmen, wenn er nur aus lateinischen Zeichen besteht
  const idn = (c.name && (c.name.en || c.name.id)) || "";
  return [/^[\x20-\x7E'’éÉ.-]+$/.test(idn) ? idn : "", ""];
}
const RAR = { "Common": "C", "Uncommon": "U", "Rare": "R", "Double rare": "RR", "Rare Holo": "R", "Ultra Rare": "SR", "Secret Rare": "UR", "Illustration rare": "AR", "Special illustration rare": "SAR", "Hyper rare": "UR", "Shiny rare": "S", "Shiny Ultra Rare": "SSR", "ACE SPEC Rare": "ACE", "Art Rare": "AR", "Super Rare": "SR", "Triple rare": "RRR", "Character Rare": "CHR", "Character Super Rare": "CSR", "Amazing Rare": "A", "Radiant Rare": "K" };

// 2) japanische Sets
const S = [], C = {};
let cards = 0, withCm = 0, withEn = 0;
for(const [sfile, cdir] of walkSets(path.join(root, "data-asia"))){
  let st; try{ st = load(sfile); }catch{ continue; }
  if(!st || !st.id || !st.name || !st.name.ja) continue;
  const list = [];
  for(const cf of fs.readdirSync(cdir)){
    if(!cf.endsWith(".ts")) continue;
    let c; try{ c = load(path.join(cdir, cf)); }catch{ continue; }
    if(!c.name || !c.name.ja) continue;
    const lid = cf.slice(0, -3);
    const v = (c.variants || []).find(x => x.thirdParty && x.thirdParty.cardmarket && (!x.type || x.type === "normal" || x.type === "holo")) || (c.variants || []).find(x => x.thirdParty && x.thirdParty.cardmarket);
    const cm = v ? Number(v.thirdParty.cardmarket) || 0 : (c.thirdParty && Number(c.thirdParty.cardmarket)) || 0;
    const [en, de] = intlNames(c);
    list.push([lid, c.name.ja, en, de, cm, RAR[c.rarity] || ""]);
    cards++; if(cm) withCm++; if(en) withEn++;
  }
  if(!list.length) continue;
  list.sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true }));
  S.push([st.id, st.name.ja, st.name.en || "", (st.cardCount && st.cardCount.official) || list.length, (st.thirdParty && st.thirdParty.cardmarket) || 0]);
  C[st.id] = list;
}
if(cards < 5000){ console.error(`Zu wenige japanische Karten (${cards}) – Abbruch, alte Datei bleibt`); process.exit(1); }
const f = path.join(siteDir, "jpdb.json");
fs.writeFileSync(f, JSON.stringify({ date: new Date().toISOString().slice(0, 10), s: S, c: C }));
console.log(`✔ jpdb.json: ${S.length} Sets, ${cards} Karten (${withCm} mit Cardmarket-ID, ${withEn} mit internationalem Namen), ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
