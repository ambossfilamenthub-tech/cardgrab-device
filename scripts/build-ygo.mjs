// CardGrab Device – Yu-Gi-Oh!-Datenbank aus YGOPRODeck (englisch + deutsch) bauen
// Ergebnis:
//   site/ygodb.json   { s: { "LOB": "Legend of Blue Eyes White Dragon" },
//                       c: { passcode: [nameEn, nameDe, frame, attr, level, race, atk, def, link, scale, typeline, cmPreis] },
//                       a: { alternativerPasscode: passcode },
//                       p: { "LOB-005": [[passcode, rarityCode, rarity], ...] } }
//   site/ygotext/<id % 40>.json  { passcode: [text, pendelText] }  (deutsch; nur englisch vorhanden → mit \u0001 markiert)
// Aufruf: node scripts/build-ygo.mjs   (Netz nötig; läuft in GitHub Actions)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SITE = path.join(ROOT, "site");
const API = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
const LOCAL = process.env.YGO_LOCAL_DIR || "";

async function get(lang){
  if(LOCAL) return JSON.parse(fs.readFileSync(path.join(LOCAL, lang ? `cardinfo_${lang}.json` : "cardinfo.json"), "utf8"));
  const url = API + (lang ? `?language=${lang}` : "");
  for(let i = 0; i < 3; i++){
    const r = await fetch(url, { headers: { "User-Agent": "CardGrab-Device/1.0 (daily sync)" } });
    if(r.ok) return r.json();
    console.log(`⚠ ${r.status} ${url} – neuer Versuch`); await new Promise(res => setTimeout(res, 5000));
  }
  throw new Error("YGOPRODeck nicht erreichbar");
}
// "LOB-EN005" / "LOB-G005" / "BPT-001" -> "LOB-005"
export const ygoKey = code => { const m = String(code || "").toUpperCase().match(/^([A-Z0-9]{2,5})-([A-Z]{0,2})([A-Z]?\d{2,4})$/); return m ? `${m[1]}-${m[3]}` : ""; };

const [en, de] = await Promise.all([get(""), get("de").catch(e => { console.log("⚠ Deutsch fehlt:", e.message); return { data: [] }; })]);
const deById = new Map((de.data || []).map(c => [c.id, c]));
const S = {}, C = {}, A = {}, P = {}, T = {};
let prints = 0, deNames = 0, deTexts = 0;
const clean = t => String(t || "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
for(const c of en.data || []){
  const d = deById.get(c.id);
  const nameDe = d && d.name && d.name !== c.name ? d.name : "";
  if(nameDe) deNames++;
  C[c.id] = [c.name, nameDe, c.frameType || "", c.attribute || "", c.level ?? null, c.race || "", c.atk ?? null, c.def ?? null, c.linkval ?? null, c.scale ?? null, (c.typeline || []).join("/") || c.type || "", +((c.card_prices || [])[0] || {}).cardmarket_price || 0];
  for(const im of c.card_images || []) if(im.id && im.id !== c.id) A[im.id] = c.id;
  // Text: Pendel-Karten haben Pendel- und Monstereffekt getrennt
  const pick = (deT, enT) => { deT = clean(deT); enT = clean(enT); if(deT && deT !== enT){ deTexts++; return deT; } return enT ? "\u0001" + enT : ""; };
  const txt = c.pend_desc ? [pick(d && d.monster_desc, c.monster_desc), pick(d && d.pend_desc, c.pend_desc)] : [pick(d && d.desc, c.desc)];
  const b = c.id % 40; (T[b] ||= {})[c.id] = txt;
  for(const s of c.card_sets || []){
    const k = ygoKey(s.set_code); if(!k) continue;
    const pre = k.split("-")[0];
    if(!S[pre]) S[pre] = s.set_name;
    const rc = String(s.set_rarity_code || "").replace(/[()]/g, "");
    const list = P[k] ||= [];
    if(!list.some(x => x[0] === c.id && x[1] === rc)){ list.push([c.id, rc, s.set_rarity || ""]); prints++; }
  }
}
if(Object.keys(C).length < 10000) throw new Error(`nur ${Object.keys(C).length} Karten von YGOPRODeck – Abbruch, alte Daten bleiben`);
fs.writeFileSync(path.join(SITE, "ygodb.json"), JSON.stringify({ s: S, c: C, a: A, p: P }));
const td = path.join(SITE, "ygotext"); fs.mkdirSync(td, { recursive: true });
for(const [b, o] of Object.entries(T)) fs.writeFileSync(path.join(td, b + ".json"), JSON.stringify(o));
console.log(`✔ Yu-Gi-Oh!: ${Object.keys(C).length} Karten, ${Object.keys(S).length} Sets, ${Object.keys(P).length} Kürzel (${prints} Drucke), ${deNames} deutsche Namen, ${deTexts} deutsche Texte, ygodb.json ${(fs.statSync(path.join(SITE, "ygodb.json")).size / 1024).toFixed(0)} KB`);
