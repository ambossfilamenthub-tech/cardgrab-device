// CardGrab Device – täglicher Cardmarket-Preis-Download
// Lädt die öffentlichen Cardmarket-Dateien (Preisliste + Produktkatalog) und baut daraus kleine Preisdateien für die App:
//   site/prices-pokemon.json   { date, p: { idProduct: [low, trend, avg1, avg7, avg30, lowHolo, trendHolo, avg30Holo] } }
//   site/prices-onepiece.json  { date, c: { "OP05-119": [[idProduct, low, trend, avg7, avg30, geschätzt, Set, Erweiterung, Bildpfad "1621/OP16"], ...] } }
// Läuft in GitHub Actions (siehe .github/workflows/prices.yml), ohne Zusatzpakete (Node 20+).
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SITE = path.join(ROOT, "site");
const BASE = process.env.CM_BASE || "https://downloads.s3.cardmarket.com/productCatalog";
const GAME = { pokemon: 6, onepiece: Number(process.env.CM_GAME_ONEPIECE || 18), yugioh: 3 };
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
  // Schutz: liefert die Quelle plötzlich viel weniger Preise (Störung), die alte Liste behalten
  try{
    const old = JSON.parse(fs.readFileSync(f, "utf8"));
    if(old && old.n > 100 && !(obj.n >= old.n * 0.5)){ console.log(`⚠ ${name}: nur ${obj.n} statt ${old.n} Einträge – alte Liste bleibt`); return; }
  }catch{}
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
  // japanische Karten (jpdb.json) haben eigene Cardmarket-Produkte
  try{ const jp = JSON.parse(fs.readFileSync(path.join(SITE, "jpdb.json"), "utf8")); for(const cards of Object.values(jp.c)) for(const e of cards) if(e[4]) wanted.add(Number(e[4])); }catch{ console.log("  (keine jpdb.json – japanische Preise fehlen heute)"); }
  const p = {};
  let hit = 0;
  for(const row of rows){
    const id = Number(row.idProduct ?? row.idproduct ?? row.id);
    if(!id || (wanted.size && !wanted.has(id))) continue;
    p[id] = [num(row, "low"), num(row, "trend"), num(row, "avg1"), num(row, "avg7"), num(row, "avg30"),
             num(row, "low-holo", "lowHolo"), num(row, "trend-holo", "trendHolo"), num(row, "avg30-holo", "avg30Holo")].map(r2);
    hit++;
  }
  // Versionen wie Cardmarket sie nummeriert (…/Pikachu-V1-TEF051): gleiche Erweiterung + gleicher Name,
  // V1, V2 … nach Produkt-ID. Kommen neue Versionen dazu (z. B. Pokémon-Day-Stempel), stimmt der Link trotzdem.
  const v = {};
  try{
    const pl = list(await getJson("list", GAME.pokemon), "products", "productList");
    const grp = new Map();
    for(const x of pl){ const k = x.idExpansion + "|" + x.name; if(!grp.has(k)) grp.set(k, []); grp.get(k).push(Number(x.idProduct)); }
    const dup = new Set();   // Karten, die in carddb mehrfach unter derselben Nummer stehen
    for(const cards of Object.values(cdb.c)){ const seen = new Map(); for(const e of cards){ seen.set(e[0], (seen.get(e[0]) || 0) + 1); } for(const e of cards) if(seen.get(e[0]) > 1 && e[1]) dup.add(Number(e[1])); }
    for(const ids of grp.values()){
      ids.sort((a, b) => a - b);
      ids.forEach((id, i) => { if(wanted.has(id) && (ids.length > 1 || dup.has(id))) v[id] = ids.length > 1 ? [i + 1, ids.length] : [0, 1]; });
    }
  }catch(e){ console.log("  ⚠ Versionen nicht ermittelt:", e.message); }
  writeJson("prices-pokemon.json", { date: (pg.createdAt || today()).slice(0, 10), n: hit, p, v });
  console.log(`  Pokémon: Versionsnummern für ${Object.keys(v).length} Karten`);

  console.log(`  Pokémon: ${rows.length} Preise geladen, ${hit} passen zu Karten der Datenbank (${wanted.size} bekannt)`);
}

// ---------------- Cardmarket-Bildpfade (One Piece) ----------------
const CM_IMG = (cat, code, id) => `https://product-images.s3.cardmarket.com/${cat}/${code}/${id}/${id}.jpg`;
async function headOk(u){
  try{ const r = await fetch(u, { method: "HEAD", headers: { "User-Agent": "CardGrab-Device/1.0 (image check)" } }); return r.ok; }catch{ return false; }
}
async function cmExpCodes(products, map, expPack, op){
  const f = path.join(ROOT, "data", "cm-exp-codes.json");
  let known = {}; try{ known = JSON.parse(fs.readFileSync(f, "utf8")); }catch{}
  const allPacks = [...new Set(Object.values(op.c).flatMap(e => [e[11], ...(e[12] || []).map(v => v[1])]).filter(Boolean))].sort();
  const sample = new Map();   // Erweiterung -> [Produkt-IDs (zugeordnet zuerst)]
  for(const p of products){ if(p.exp == null) continue; const l = sample.get(p.exp) || []; if(l.length < 3 && map.has(p.id)) l.push(p); sample.set(p.exp, l); }
  const t0 = Date.now(); let probes = 0, found = 0;
  for(const [exp, ps] of sample){
    if(known[exp] !== undefined && (known[exp] || (known["_t" + exp] || 0) > Date.now() - 7 * 864e5)) continue;   // nicht gefundene nur 1×/Woche neu prüfen
    if(!ps.length || Date.now() - t0 > 4 * 60000) continue;
    const p = ps[0], pk = expPack.get(exp) || (map.get(p.id) || "").split("-")[0];
    const cand = [...new Set([pk, pk + "-JP", ...allPacks.flatMap(x => [x, x + "-JP"]), "P", "P-JP", "Promos", "Promos-JP"].filter(Boolean))];
    let hit = "";
    for(const code of cand){ probes++; if(await headOk(CM_IMG(p.cat || 1621, code, p.id))){ hit = code; break; } }
    known[exp] = hit; if(!hit) known["_t" + exp] = Date.now(); else found++;
  }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(known));
  const cat = products.find(p => p.cat)?.cat || 1621;
  console.log(`  One Piece: Bildpfade – ${found} neue Erweiterungs-Kürzel gefunden (${probes} Prüfungen), Kategorie ${cat}`);
  const out = {}; for(const [k, v] of Object.entries(known)) if(!k.startsWith("_") && v) out[k] = `${cat}/${v}`;
  return out;
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
    id: Number(x.idProduct ?? x.id), name: x.name || x.enName || "", exp: x.idExpansion ?? x.expansionId ?? null, meta: x.idMetacard ?? null, cat: x.idCategory ?? null
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
  const prodExp = new Map(products.map(p => [p.id, p.exp]));
  // Cardmarket-Kürzel je Erweiterung (z. B. „OP16“, „OP16-JP“) – steht im Pfad der Produktbilder.
  // Wird einmal pro Erweiterung über eine HEAD-Anfrage ermittelt und in data/cm-exp-codes.json gemerkt.
  const expCode = await cmExpCodes(products, map, expPack, op);
  const c = {};
  for(const [id, code] of [...map.entries()].sort((a, b) => a[0] - b[0])){
    const pr = prices.get(id) || [0, 0, 0, 0], ex = prodExp.get(id);
    (c[code] = c[code] || []).push([id, ...pr, guessed.has(id) ? 1 : 0, expPack.get(ex) || "", ex ?? "", (ex != null && expCode[ex]) || ""]);
  }
  writeJson("prices-onepiece.json", { date: (pg.createdAt || today()).slice(0, 10), n: map.size, c });
  console.log(`  One Piece: ${products.length} Produkte, ${map.size} einer Karten-ID zugeordnet (${Object.keys(c).length} IDs), ${expPack.size}/${byExp.size} Erweiterungen erkannt`);
}

// ---------------- Yu-Gi-Oh! ----------------
// Cardmarket kennt keine Set-Kürzel (LOB-005). Zuordnung: Erweiterung -> Set (Namensabgleich mit YGOPRODeck),
// dann Name im Set -> Kürzel; mehrere Seltenheiten = mehrere Versionen (Seltenheit aus "(V.1 - Ultra Rare)").
const RAR_RANK = ["common", "shortprint", "rare", "superrare", "ultrarare", "ultimaterare", "secretrare", "prismaticsecretrare", "platinumsecretrare", "quartercenturysecretrare", "starlightrare", "ghostrare", "collectorsrare", "goldrare", "goldsecretrare"];
const rnk = r => { const i = RAR_RANK.indexOf(r); return i < 0 ? 99 : i; };
const rn = t => String(t || "").toLowerCase().replace(/[^a-z]/g, "");
async function yugioh(){
  const dbf = path.join(SITE, "ygodb.json");
  if(!fs.existsSync(dbf)) throw new Error("ygodb.json fehlt");
  const db = JSON.parse(fs.readFileSync(dbf, "utf8"));
  const [pg, pl] = await Promise.all([getJson("price", GAME.yugioh), getJson("list", GAME.yugioh)]);
  const prices = new Map();
  for(const row of list(pg, "priceGuides", "priceguides", "prices")){
    const id = Number(row.idProduct ?? row.idproduct ?? row.id);
    if(id) prices.set(id, [num(row, "low"), num(row, "trend"), num(row, "avg7"), num(row, "avg30")].map(r2));
  }
  const products = list(pl, "products", "productList").map(x => {
    const name = String(x.name || x.enName || "");
    const m = name.match(/\s*\(([^)]*)\)\s*$/);
    let rar = "";
    if(m){ const mm = m[1].match(/^V\.?\s*\d+\s*[-–]\s*(.+)$/i); rar = rn(mm ? mm[1] : m[1]); }
    return { id: Number(x.idProduct ?? x.id), base: nrm(name.replace(/\s*\([^)]*\)\s*$/, "")), raw: name, rar, exp: x.idExpansion ?? null };
  }).filter(x => x.id);
  console.log("  Yu-Gi-Oh! Beispiele:", products.slice(0, 5).map(p => p.raw).join(" | "));
  // Set-Name -> Kartenname -> [[Kürzel, Seltenheit]]
  const sets = new Map();
  for(const [key, ent] of Object.entries(db.p)){
    const sn = db.s[key.split("-")[0]]; if(!sn) continue;
    if(!sets.has(sn)) sets.set(sn, new Map());
    const m = sets.get(sn);
    for(const [pc, rc, rar] of ent){
      const c = db.c[pc]; if(!c) continue;
      const n = nrm(c[0]); if(!m.has(n)) m.set(n, []);
      m.get(n).push([key, rn(rar), rar]);
    }
  }
  // Wörter-Index: Kartenname -> Sets
  const nameSets = new Map();
  for(const [sn, m] of sets) for(const n of m.keys()){ if(!nameSets.has(n)) nameSets.set(n, new Set()); nameSets.get(n).add(sn); }
  const byExp = new Map();
  for(const p of products){ if(p.exp == null) continue; if(!byExp.has(p.exp)) byExp.set(p.exp, []); byExp.get(p.exp).push(p); }
  const expSet = new Map();
  for(const [exp, ps] of byExp){
    const names = new Set(ps.map(p => p.base));
    const votes = new Map();
    for(const n of names) for(const sn of nameSets.get(n) || []) votes.set(sn, (votes.get(sn) || 0) + 1);
    let best = null, bs = 0;
    for(const [sn, v] of votes){ const sc = v / Math.max(names.size, sets.get(sn).size); if(sc > bs){ bs = sc; best = sn; } }
    const v = best ? votes.get(best) : 0;
    if(best && (bs >= 0.5 || (v >= 3 && bs >= 0.3))) expSet.set(exp, best);
  }
  const c = {}; let mapped = 0, guess = 0;
  const put = (key, p, g, rarLabel) => { const pr = prices.get(p.id) || [0, 0, 0, 0]; const l = c[key] ||= []; if(!l.some(x => x[0] === p.id)){ l.push([p.id, ...pr, g ? 1 : 0, rarLabel || ""]); mapped++; if(g) guess++; } };
  for(const [exp, ps] of byExp){
    const sn = expSet.get(exp); if(!sn) continue;
    const m = sets.get(sn);
    const byName = new Map();
    for(const p of ps){ if(!byName.has(p.base)) byName.set(p.base, []); byName.get(p.base).push(p); }
    for(const [n, pl] of byName){
      const E = m.get(n); if(!E) continue;
      pl.sort((a, b) => a.id - b.id);
      const keys = [...new Set(E.map(e => e[0]))];
      if(pl.some(p => p.rar)){
        const used = new Set();
        for(const p of pl){
          const hit = E.filter(e => e[1] && e[1] === p.rar);
          if(hit.length){ hit.forEach(e => put(e[0], p, false, e[2])); used.add(p.id); }
        }
        const rest = pl.filter(p => !used.has(p.id));
        for(const p of rest) keys.forEach(k => put(k, p, true));
      } else if(pl.length === 1){
        keys.forEach(k => put(k, pl[0], E.length > 1, E.length === 1 ? E[0][2] : ""));
      } else {
        const Es = [...E].sort((a, b) => rnk(a[1]) - rnk(b[1]));
        if(Es.length === pl.length) pl.forEach((p, i) => put(Es[i][0], p, true, Es[i][2]));
        else for(const p of pl) keys.forEach(k => put(k, p, true));
      }
    }
  }
  writeJson("prices-yugioh.json", { date: (pg.createdAt || today()).slice(0, 10), n: mapped, c });
  console.log(`  Yu-Gi-Oh!: ${products.length} Produkte, ${expSet.size}/${byExp.size} Erweiterungen erkannt, ${mapped} Versionen für ${Object.keys(c).length} Kürzel (${guess} geschätzt)`);
}

let failed = 0;
for(const [name, fn] of [["Pokémon", pokemon], ["One Piece", onepiece], ["Yu-Gi-Oh!", yugioh]]){
  try{ await fn(); } catch(e){ failed++; console.error(`✖ ${name}: ${e.message}`); }
}
if(failed === 3) process.exit(1);
