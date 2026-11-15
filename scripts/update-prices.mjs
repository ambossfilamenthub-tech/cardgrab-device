// CardGrab Device – täglicher Cardmarket-Preis-Download
// Lädt die öffentlichen Cardmarket-Dateien (Preisliste + Produktkatalog) und baut daraus kleine Preisdateien für die App:
//   site/prices-pokemon.json   { date, p: { idProduct: [low, trend, avg1, avg7, avg30, lowHolo, trendHolo, avg30Holo] } }
//   site/prices-onepiece.json  { date, c: { "OP05-119": [[idProduct, low, trend, avg7, avg30, geschätzt], ...] } }
// Läuft in GitHub Actions (siehe .github/workflows/prices.yml), ohne Zusatzpakete (Node 20+).
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SITE = path.join(ROOT, "site");
const BASE = process.env.CM_BASE || "https://downloads.s3.cardmarket.com/productCatalog";
const GAME = { pokemon: 6, onepiece: Number(process.env.CM_GAME_ONEPIECE || 18) };
const LOCAL = process.env.CM_LOCAL_DIR || "";   // für Tests: Dateien aus einem Ordner statt aus dem Netz

async function getJson(kind, game){
  const file = kind === "price" ? `price_guide_${game}.json` : `products_singles_${game}.json`;
  if(LOCAL){
    const f = path.join(LOCAL, file);
    if(!fs.existsSync(f)) throw new Error("fehlt: " + f);
    return JSON.parse(fs.readFileSync(f, "utf8"));
  }
  const url = `${BASE}/${kind === "price" ? "priceGuide" : "productList"}/${file}`;
  const r = await fetch(url, { headers: { "User-Agent": "CardGrab-Device/1.0 (price guide sync)" } });
  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
const list = (d, ...keys) => Array.isArray(d) ? d : (keys.map(k => d && d[k]).find(Array.isArray) || []);
const r2 = v => (typeof v === "number" && isFinite(v) && v > 0) ? Math.round(v * 100) / 100 : 0;
const num = (o, ...ks) => { for(const k of ks){ const v = o[k]; if(typeof v === "number") return v; if(typeof v === "string" && v.trim() !== "" && isFinite(+v)) return +v; } return 0; };
const today = () => new Date().toISOString().slice(0, 10);

function writeJson(name, obj){
  const f = path.join(SITE, name);
  fs.writeFileSync(f, JSON.stringify(obj));
  console.log(`✔ ${name}: ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
}

// ---------------- Pokémon ----------------
async function pokemon(){
  const pg = await getJson("price", GAME.pokemon);
  const rows = list(pg, "priceGuides", "priceguides", "prices");
  const cdb = JSON.parse(fs.readFileSync(path.join(SITE, "carddb.json"), "utf8"));
  const wanted = new Set();
  for(const cards of Object.values(cdb.c)) for(const e of cards) if(e[1]) wanted.add(Number(e[1]));
  const p = {};
  let hit = 0;
  for(const row of rows){
    const id = Number(row.idProduct ?? row.idproduct ?? row.id);
    if(!id || (wanted.size && !wanted.has(id))) continue;
    p[id] = [num(row, "low"), num(row, "trend"), num(row, "avg1"), num(row, "avg7"), num(row, "avg30"),
             num(row, "low-holo", "lowHolo"), num(row, "trend-holo", "trendHolo"), num(row, "avg30-holo", "avg30Holo")].map(r2);
    hit++;
  }
  writeJson("prices-pokemon.json", { date: (pg.createdAt || today()).slice(0, 10), n: hit, p });
  console.log(`  Pokémon: ${rows.length} Preise geladen, ${hit} passen zu Karten der Datenbank (${wanted.size} bekannt)`);
}

// ---------------- One Piece ----------------
// Cardmarket führt im Katalog keine Karten-ID (z. B. OP05-119). Zuordnung:
//  1) Karten-ID steht im Produktnamen  -> direkt
//  2) Erweiterung (idExpansion) -> Set (OP05 …) per Namensabgleich, dann Name im Set eindeutig -> ID
//  3) Gleiche idMetacard = gleiche Karte (Reprints/Parallels) -> übernimmt die ID der zugeordneten Version
const OP_RE = /\b(OP|ST|EB|PRB)\s*-?\s*(\d{1,2})\s*[-–]\s*(\d{3})\b|\bP\s*[-–]\s*(\d{3})\b/i;
const opId = t => { const m = String(t || "").toUpperCase().match(OP_RE); return m ? (m[4] ? `P-${m[4]}` : `${m[1]}${m[2].padStart(2, "0")}-${m[3]}`) : ""; };
const nrm = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\(.*?\)|\[.*?\]/g, "").replace(/\bv\.?\s*\d+\b/g, "").replace(/[^a-z0-9]/g, "");

async function onepiece(){
  const [pg, pl] = await Promise.all([getJson("price", GAME.onepiece), getJson("list", GAME.onepiece)]);
  const prices = new Map();
  for(const row of list(pg, "priceGuides", "priceguides", "prices")){
    const id = Number(row.idProduct ?? row.idproduct ?? row.id);
    if(id) prices.set(id, [num(row, "low"), num(row, "trend"), num(row, "avg7"), num(row, "avg30")].map(r2));
  }
  const products = list(pl, "products", "productList").map(x => ({
    id: Number(x.idProduct ?? x.id), name: x.name || x.enName || "", exp: x.idExpansion ?? x.expansionId ?? null, meta: x.idMetacard ?? null
  })).filter(x => x.id);

  const op = JSON.parse(fs.readFileSync(path.join(SITE, "opdb.json"), "utf8"));
  // Set-Label -> Name -> [IDs]
  const packNames = new Map();
  for(const [code, e] of Object.entries(op.c)){
    const name = nrm(e[0]);
    const packs = new Set([e[11], ...(e[12] || []).map(v => v[1])]);
    for(const pk of packs){
      if(!pk) continue;
      if(!packNames.has(pk)) packNames.set(pk, new Map());
      const m = packNames.get(pk); if(!m.has(name)) m.set(name, new Set()); m.get(name).add(code);
    }
  }
  // 1) ID im Namen
  const map = new Map();   // idProduct -> code
  for(const p of products){ const c = opId(p.name); if(c && op.c[c]) map.set(p.id, c); }
  // 2) Erweiterung -> Set (bester Namensabgleich)
  const byExp = new Map();
  for(const p of products){ if(p.exp == null) continue; if(!byExp.has(p.exp)) byExp.set(p.exp, []); byExp.get(p.exp).push(p); }
  const expPack = new Map();
  for(const [exp, ps] of byExp){
    // Vorrang: Set aus bereits erkannten IDs
    const votes = new Map();
    for(const p of ps){ const c = map.get(p.id); if(c){ const pk = c.split("-")[0]; votes.set(pk, (votes.get(pk) || 0) + 3); } }
    const names = new Set(ps.map(p => nrm(p.name)));
    for(const [pk, m] of packNames){ let n = 0; for(const nm of names) if(m.has(nm)) n++; if(n) votes.set(pk, (votes.get(pk) || 0) + n / Math.max(4, m.size) * 10); }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if(best && best[1] >= 2) expPack.set(exp, best[0]);
  }
  for(const p of products){
    if(map.has(p.id)) continue;
    const pk = expPack.get(p.exp); if(!pk) continue;
    const codes = packNames.get(pk)?.get(nrm(p.name));
    if(codes && codes.size === 1) map.set(p.id, [...codes][0]);
  }
  // 2b) Gleicher Name mehrfach im Set (z. B. mehrere Luffy-Karten): nach Metacard gruppieren und in
  //     Kartennummer-Reihenfolge zuordnen, wenn die Anzahl passt (als "geschätzt" markiert)
  const guessed = new Set();
  const amb = new Map();
  for(const p of products){
    if(map.has(p.id)) continue;
    const pk = expPack.get(p.exp); if(!pk) continue;
    const codes = packNames.get(pk)?.get(nrm(p.name));
    if(!codes || codes.size < 2) continue;
    const k = pk + "|" + nrm(p.name); if(!amb.has(k)) amb.set(k, { codes: [...codes].sort(), ps: [] }); amb.get(k).ps.push(p);
  }
  for(const { codes, ps } of amb.values()){
    const groups = new Map();
    for(const p of ps){ const g = p.meta ?? ("p" + p.id); if(!groups.has(g)) groups.set(g, []); groups.get(g).push(p); }
    // bereits zugeordnete Codes dieser Metacards berücksichtigen
    const free = codes;
    const gl = [...groups.values()].sort((a, b) => Math.min(...a.map(x => x.id)) - Math.min(...b.map(x => x.id)));
    if(gl.length !== free.length) continue;
    gl.forEach((g, i) => g.forEach(p => { map.set(p.id, free[i]); guessed.add(p.id); }));
  }
  // 3) Metacard-Gruppen
  const metaCode = new Map();
  for(const p of products){ const c = map.get(p.id); if(c && p.meta != null){ const s = metaCode.get(p.meta) || new Set(); s.add(c); metaCode.set(p.meta, s); } }
  for(const p of products){
    if(map.has(p.id) || p.meta == null) continue;
    const s = metaCode.get(p.meta); if(s && s.size === 1) map.set(p.id, [...s][0]);
  }
  const c = {};
  for(const [id, code] of [...map.entries()].sort((a, b) => a[0] - b[0])){
    const pr = prices.get(id) || [0, 0, 0, 0];
    (c[code] = c[code] || []).push([id, ...pr, guessed.has(id) ? 1 : 0]);
  }
  writeJson("prices-onepiece.json", { date: (pg.createdAt || today()).slice(0, 10), n: map.size, c });
  console.log(`  One Piece: ${products.length} Produkte, ${map.size} einer Karten-ID zugeordnet (${Object.keys(c).length} IDs), ${expPack.size}/${byExp.size} Erweiterungen erkannt`);
}

let failed = 0;
for(const [name, fn] of [["Pokémon", pokemon], ["One Piece", onepiece]]){
  try{ await fn(); } catch(e){ failed++; console.error(`✖ ${name}: ${e.message}`); }
}
if(failed === 2) process.exit(1);
