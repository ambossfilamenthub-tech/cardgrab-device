// CardGrab Device – Vorlese-Daten (KP, Attacken, Schaden, Effekte) aus TCGdex bauen
// Aufruf: node scripts/build-facts.mjs <pfad-zu-tcgdex/cards-database/data> <ausgabe-ordner>
// Ergebnis: <ausgabe>/<setId>.json = { "<Nr>": { hp, t, st, a:[[name, schaden, effekt, kosten[]]], ab:[[name, effekt]], w, wv, rs, r, e, ef } }
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const [root, out] = process.argv.slice(2);
if(!root || !out){ console.error("Aufruf: node build-facts.mjs <data> <out>"); process.exit(1); }
fs.mkdirSync(out, { recursive: true });

// Deutsch bevorzugt; nur englisch vorhanden → mit \u0001 markieren, translate-de.py übersetzt das später
const pick = o => (o && typeof o === "object") ? (o.de || (o.en ? "\u0001" + o.en : "")) : (o || "");
const pickName = o => (o && typeof o === "object") ? (o.de || "") : "";
function load(file){
  let src = fs.readFileSync(file, "utf8");
  src = src.replace(/^\s*import .*$/mg, "").replace(/export default \w+\s*;?/g, "")
           .replace(/const\s+\w+\s*:\s*\w+\s*=/, "module.exports =").replace(/\bset\s*:\s*Set\s*,?/, "");
  const m = { exports: {} };
  vm.runInNewContext(src, { module: m, exports: m.exports }, { timeout: 1000 });
  return m.exports;
}
const idOf = file => { const s = fs.readFileSync(file, "utf8"); const m = s.match(/\bid\s*:\s*["'`]([^"'`]+)["'`]/); return m ? m[1] : ""; };

let sets = 0, cards = 0, fail = 0;
for(const serie of fs.readdirSync(root)){
  const sdir = path.join(root, serie);
  if(!fs.statSync(sdir).isDirectory() || /Pocket/i.test(serie)) continue;
  for(const f of fs.readdirSync(sdir)){
    if(!f.endsWith(".ts")) continue;
    const cdir = path.join(sdir, f.slice(0, -3));
    if(!fs.existsSync(cdir)) continue;
    const sid = idOf(path.join(sdir, f)); if(!sid) continue;
    const res = {};
    for(const cf of fs.readdirSync(cdir)){
      if(!cf.endsWith(".ts")) continue;
      try{
        const c = load(path.join(cdir, cf));
        const e = {};
        const nm = pickName(c.name); if(nm) e.n = nm;
        if(c.hp) e.hp = c.hp;
        if(c.types && c.types.length) e.t = c.types;
        if(c.stage) e.st = c.stage;
        if(c.attacks && c.attacks.length) e.a = c.attacks.map(a => [pick(a.name), a.damage ?? "", pick(a.effect), a.cost || []]);
        if(c.abilities && c.abilities.length) e.ab = c.abilities.map(a => [pick(a.name), pick(a.effect)]);
        if(c.weaknesses && c.weaknesses.length){ e.w = c.weaknesses.map(w => w.type); e.wv = c.weaknesses.map(w => w.value || ""); }
        if(c.resistances && c.resistances.length) e.rs = c.resistances.map(r => [r.type, r.value || ""]);
        if(c.evolveFrom) e.ef = pickName(c.evolveFrom) || (c.evolveFrom.en || "");
        if(c.suffix) e.sx = c.suffix;
        if(c.retreat !== undefined) e.r = c.retreat;
        if(c.effect) e.e = pick(c.effect);
        if(c.trainerType) e.tt = c.trainerType;
        if(c.category && c.category !== "Pokemon") e.c = c.category;
        res[cf.slice(0, -3)] = e; cards++;
      }catch{ fail++; }
    }
    if(Object.keys(res).length){ fs.writeFileSync(path.join(out, sid + ".json"), JSON.stringify(res)); sets++; }
  }
}
console.log(`✔ Vorlese-Daten: ${sets} Sets, ${cards} Karten (${fail} nicht lesbar)`);
