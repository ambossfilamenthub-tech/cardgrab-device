// CardGrab Device – Fingerabdrücke der Karten berechnen (site/fp-<spiel>.json)
// Die Kartenbilder werden nur kurz geladen, verrechnet und verworfen – gespeichert werden nur die Hash-Zahlen.
// Bereits berechnete Karten bleiben erhalten (Cache), pro Lauf gibt es ein Zeitlimit; der nächste Lauf macht weiter.
// Aufruf: node scripts/build-fp.mjs   (braucht: npm i sharp)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const FP = require("../site/lib/fp.js");
const sharp = (await import("sharp")).default;

const SITE = "site", MIN = Number(process.env.FP_MINUTES || 30), T0 = Date.now(), CONC = 12;
const timeLeft = () => Date.now() - T0 < MIN * 60000;
const UA = { "User-Agent": "CardGrab-Device/1.0 (fingerprint builder; github.com/ambossfilamenthub-tech/cardgrab-device)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, tries = 3){
  for(let i = 0; i < tries; i++){
    try{ const r = await fetch(url, { headers: UA }); if(r.ok) return Buffer.from(await r.arrayBuffer()); if(r.status === 404) return null; }catch{}
    await sleep(800 * (i + 1));
  }
  return null;
}
async function rgba(buf){
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { px: data, w: info.width, h: info.height };
}
function load(game){
  try{ const j = JSON.parse(fs.readFileSync(path.join(SITE, `fp-${game}.json`), "utf8")); const d = FP.decode(j); const m = new Map(); d.k.forEach((k, i) => m.set(k, Array.from(d.h.slice(i * 4, i * 4 + 4)))); return m; }catch{ return new Map(); }
}
function save(game, m){
  const keys = [...m.keys()];
  fs.writeFileSync(path.join(SITE, `fp-${game}.json`), JSON.stringify(FP.encode(keys, keys.map(k => m.get(k)))));
}
const SAMPLES = {};   // je Spiel ein paar Bilder für den Selbsttest
async function run(game, jobs){
  const m = load(game), todo = jobs.filter(j => !m.has(j.key));
  console.log(`${game}: ${jobs.length} Bilder, ${m.size} schon fertig, ${todo.length} offen`);
  let done = 0, fail = 0, i = 0;
  SAMPLES[game] = [];
  async function worker(){
    while(i < todo.length && timeLeft()){
      const j = todo[i++];
      const buf = await get(j.url);
      if(!buf){ fail++; continue; }
      try{
        const { px, w, h } = await rgba(buf);
        m.set(j.key, FP.hash(px, w, h, game)); done++;
        if(SAMPLES[game].length < 150 && Math.random() < 0.05) SAMPLES[game].push({ key: j.key, buf });
      }catch{ fail++; }
      if(game === "yugioh") await sleep(60);   // YGOPRODeck: höchstens ~20 Anfragen pro Sekunde
      if((done + fail) % 500 === 0) save(game, m);
    }
  }
  await Promise.all(Array.from({ length: game === "yugioh" ? 4 : CONC }, worker));
  save(game, m);
  console.log(`✔ ${game}: +${done} neu, ${fail} ohne Bild, gesamt ${m.size}${i < todo.length ? " (Zeitlimit – Rest beim nächsten Lauf)" : ""}`);
  return m;
}

// ---------- Bildlisten ----------
async function pokemonJobs(){
  const db = JSON.parse(fs.readFileSync(path.join(SITE, "carddb.json"), "utf8")), jobs = [];
  for(const s of db.s){
    const sid = s[0];
    let set = null;
    for(const l of ["en", "de"]){ const b = await get(`https://api.tcgdex.net/v2/${l}/sets/${encodeURIComponent(sid)}`, 2); if(b){ try{ set = JSON.parse(b); }catch{} } if(set && set.cards) break; }
    if(!set || !set.cards) continue;
    for(const c of set.cards) if(c.image) jobs.push({ key: `${sid}:${c.localId}`, url: c.image + "/low.webp" });
  }
  return jobs;
}
function onepieceJobs(){
  const db = JSON.parse(fs.readFileSync(path.join(SITE, "opdb.json"), "utf8")), jobs = [];
  for(const [id, e] of Object.entries(db.c)){
    const set = id.startsWith("P-") ? "P" : id.split("-")[0];
    const vs = [...new Set(["", ...((e[12] || []).map(v => v[0] || ""))])];
    for(const suf of vs) jobs.push({ key: `${id}|${suf}`, url: `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/one-piece/${set}/${id}${suf ? "_" + suf : ""}_EN.webp` });
  }
  return jobs;
}
function yugiohJobs(){
  const db = JSON.parse(fs.readFileSync(path.join(SITE, "ygodb.json"), "utf8"));
  const pcs = [...Object.keys(db.c), ...Object.keys(db.a || {})];
  return pcs.map(pc => ({ key: pc, url: `https://images.ygoprodeck.com/images/cards_small/${pc}.jpg` }));
}

// ---------- Selbsttest: Bild verzerren wie ein Handyfoto, dann suchen ----------
async function selftest(game, m){
  const db = FP.decode(FP.encode([...m.keys()], [...m.values()]));
  const res = { n: 0, top1: 0, top5: 0, dTrue: [], dOther: [] };
  for(const s of SAMPLES[game] || []){
    try{
      const meta = await sharp(s.buf).metadata();
      const W = meta.width, H = meta.height, cx = Math.round(W * 0.015), cy = Math.round(H * 0.015);
      const img = await sharp(s.buf).flatten({ background: "#ffffff" })
        .extract({ left: cx, top: cy, width: W - 2 * cx, height: H - 2 * cy }).resize(W, H, { fit: "fill" })
        .rotate(1.5, { background: "#ffffff" }).resize(W, H, { fit: "cover" })
        .modulate({ brightness: 0.8 + Math.random() * 0.45, saturation: 0.85 }).blur(0.9)
        .jpeg({ quality: 55 }).toBuffer();
      const { px, w, h } = await rgba(img);
      const q = [FP.hash(px, w, h, game), FP.hash(px, w, h, game, 0.01, 0), FP.hash(px, w, h, game, 0, 0.01)];
      const hits = FP.search(db, q, 5), same = id => id.split("|")[0] === s.key.split("|")[0];
      res.n++; if(hits[0] && same(hits[0].key)) res.top1++; if(hits.some(x => same(x.key))) res.top5++;
      const t = hits.find(x => same(x.key)), o = hits.find(x => !same(x.key));
      if(t) res.dTrue.push(t.d); if(o) res.dOther.push(o.d);
    }catch{}
  }
  const med = a => a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null;
  return { n: res.n, top1: res.top1, top5: res.top5, dTrueMed: med(res.dTrue), dTrueMax: Math.max(0, ...res.dTrue), dOtherMed: med(res.dOther), dOtherMin: res.dOther.length ? Math.min(...res.dOther) : null };
}

const report = { date: new Date().toISOString().slice(0, 10) };
for(const [game, jobsFn] of [["onepiece", onepieceJobs], ["pokemon", pokemonJobs], ["yugioh", yugiohJobs]]){
  if(!timeLeft()) break;
  let jobs; try{ jobs = await jobsFn(); }catch(e){ console.log(`${game}: Liste nicht ladbar (${e.message})`); continue; }
  const m = await run(game, jobs);
  report[game] = { total: jobs.length, have: m.size, test: await selftest(game, m) };
  console.log(game, JSON.stringify(report[game].test));
}
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/fp-report.json", JSON.stringify(report, null, 1));
