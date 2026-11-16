// CardGrab Device – Prüfung vor dem Veröffentlichen. Schlägt etwas fehl, bleibt die alte Version online.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const SITE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "site");
const errors = [];
const json = f => { try{ return JSON.parse(fs.readFileSync(path.join(SITE, f), "utf8")); }catch(e){ errors.push(`${f}: ${e.message}`); return null; } };
const need = (cond, msg) => { if(!cond) errors.push(msg); };

// 1) Programmcode ohne Syntaxfehler
for(const f of ["app.js", "sw.js", "lib/cards.js", "lib/ygo.js", "lib/collection.js", "lib/sounds.js", "lib/cardfind.js", "lib/manage.js", "lib/extras.js", "lib/center.js"]){
  try{ execFileSync(process.execPath, ["--check", path.join(SITE, f)], { stdio: "pipe" }); }catch(e){ errors.push(`${f}: Syntaxfehler ${String(e.stderr || e.message).slice(0, 300)}`); }
}
// 2) Pflichtdateien und Mindestgrößen
const cdb = json("carddb.json"); need(cdb && Object.keys(cdb.c || {}).length > 150, "carddb.json: zu wenige Sets");
const op = json("opdb.json"); need(op && Object.keys(op.c || {}).length > 2000, "opdb.json: zu wenige One-Piece-Karten");
const yg = json("ygodb.json"); need(yg && Object.keys(yg.c || {}).length > 10000, "ygodb.json: zu wenige Yu-Gi-Oh!-Karten");
for(const f of ["prices-pokemon.json", "prices-onepiece.json", "prices-yugioh.json"]){ const p = json(f); need(p && p.date && p.n > 100, `${f}: leer oder ohne Datum`); }
const v = json("version.json"); need(v && v.v, "version.json fehlt");
const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
for(const s of ["lib/cards.js", "lib/ygo.js", "lib/collection.js", "lib/sounds.js", "lib/cardfind.js", "lib/manage.js", "lib/extras.js", "lib/center.js", "app.js"]) need(html.includes(`src="${s}"`), `index.html bindet ${s} nicht ein`);
need(fs.existsSync(path.join(SITE, "legal.html")), "legal.html fehlt");
// 3) Liste der erzeugten Dateien (für die Notfall-Übernahme am nächsten Tag)
const man = {};
for(const d of ["facts", "ygotext"]){ const p = path.join(SITE, d); man[d] = fs.existsSync(p) ? fs.readdirSync(p).filter(x => x.endsWith(".json")) : []; }
need(man.facts.length > 150, `facts: nur ${man.facts.length} Dateien`);
need(man.ygotext.length > 30, `ygotext: nur ${man.ygotext.length} Dateien`);
fs.writeFileSync(path.join(SITE, "data-manifest.json"), JSON.stringify(man));

if(errors.length){ console.error("✖ Prüfung fehlgeschlagen – nichts wird veröffentlicht:\n  " + errors.join("\n  ")); process.exit(1); }
console.log(`✔ Prüfung bestanden: Version ${v.v}, ${man.facts.length} Pokémon-Textdateien, ${Object.keys(yg.c).length} Yu-Gi-Oh!-Karten`);
