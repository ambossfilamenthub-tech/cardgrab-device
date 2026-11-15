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
// TCGdex hat bei alten Sets oft den englischen Text im Feld "de" → dann auch als englisch behandeln
const NAMES = new Map(); // englischer → deutscher Pokémon-Name
let NAME_RE = null;
const deName = t => NAME_RE ? t.replace(NAME_RE, m => NAMES.get(m) || m) : t;
const pick = o => (o && typeof o === "object") ? ((o.de && o.de !== o.en) ? o.de : (o.en ? "\u0001" + o.en : (o.de || ""))) : (o || "");
const pickName = o => (o && typeof o === "object") ? (o.de || "") : "";
const CTX = vm.createContext({});
function load(file){
  let src = fs.readFileSync(file, "utf8");
  src = src.replace(/^\s*import .*$/mg, "").replace(/export default \w+\s*;?/g, "")
           .replace(/const\s+\w+\s*:\s*\w+\s*=/, "module.exports =").replace(/\bset\s*:\s*Set\s*,?/, "");
  // ein gemeinsamer Kontext statt einem neuen pro Karte (sonst läuft der Speicher voll)
  const m = { exports: {} };
  const fn = vm.runInContext("(function(module, exports){" + src + "\n})", CTX, { timeout: 1000 });
  fn(m, m.exports);
  return m.exports;
}
const idOf = file => { const s = fs.readFileSync(file, "utf8"); const m = s.match(/\bid\s*:\s*["'`]([^"'`]+)["'`]/); return m ? m[1] : ""; };

let sets = 0, cards = 0, fail = 0;
const pending = [];
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
        const nm = pickName(c.name); if(nm) e.n = nm; else if(c.name && c.name.en) e.n = "\u0002" + c.name.en;
        if(c.name && c.name.en && c.name.de && c.name.en !== c.name.de && c.category === "Pokemon"){
          for(const v of [c.name.en, c.name.en.replace(/ ex$/, "")]) if(v.length > 3 && !NAMES.has(v)) NAMES.set(v, v === c.name.en ? c.name.de : c.name.de.replace(/-ex$| ex$/, ""));
        }
        if(c.hp) e.hp = c.hp;
        if(c.types && c.types.length) e.t = c.types;
        if(c.stage) e.st = c.stage;
        if(c.attacks && c.attacks.length) e.a = c.attacks.map(a => [pick(a.name), a.damage ?? "", pick(a.effect), a.cost || []]);
        if(c.abilities && c.abilities.length) e.ab = c.abilities.map(a => [pick(a.name), pick(a.effect)]);
        if(c.weaknesses && c.weaknesses.length){ e.w = c.weaknesses.map(w => w.type); e.wv = c.weaknesses.map(w => w.value || ""); }
        if(c.resistances && c.resistances.length) e.rs = c.resistances.map(r => [r.type, r.value || ""]);
        if(c.evolveFrom) e.ef = (c.evolveFrom.de && c.evolveFrom.de !== c.evolveFrom.en) ? c.evolveFrom.de : "\u0002" + (c.evolveFrom.en || "");
        if(c.suffix) e.sx = c.suffix;
        if(c.retreat !== undefined) e.r = c.retreat;
        if(c.effect) e.e = pick(c.effect);
        if(c.trainerType) e.tt = c.trainerType;
        if(c.category && c.category !== "Pokemon") e.c = c.category;
        res[cf.slice(0, -3)] = e; cards++;
      }catch{ fail++; }
    }
    if(Object.keys(res).length){ pending.push([sid, res]); sets++; }
  }
}
// englische Pokémon-Namen in englischen Texten durch deutsche ersetzen (längste zuerst)
const sorted = [...NAMES].sort((a, b) => b[0].length - a[0].length); NAMES.clear(); for(const [a, b] of sorted) if(a !== b) NAMES.set(a, b);
NAME_RE = new RegExp("(?<![\\w'’-])(" + [...NAMES.keys()].map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?![\\w-])", "g");
const fix = x => typeof x === "string" ? (x.startsWith("\u0001") ? "\u0001" + deName(x.slice(1)) : x.startsWith("\u0002") ? deName(x.slice(1)) : x) : Array.isArray(x) ? x.map(fix) : (x && typeof x === "object") ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fix(v)])) : x;
for(const [sid, res] of pending) fs.writeFileSync(path.join(out, sid + ".json"), JSON.stringify(fix(res)));
console.log(`✔ Vorlese-Daten: ${sets} Sets, ${cards} Karten (${fail} nicht lesbar)`);
