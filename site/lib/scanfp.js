// CardGrab Device – Erkennung am Bild (Fingerabdruck) für die ausgewählten Spiele
"use strict";
const MYG_KEY = "cgd-games";
const ALL_GAMES = [["pokemon", "Pokémon", "⚡"], ["onepiece", "One Piece", "🏴‍☠️"], ["yugioh", "Yu-Gi-Oh!", "🔺"]];
function myGames(){ try{ const g = JSON.parse(localStorage.getItem(MYG_KEY) || "null"); if(Array.isArray(g) && g.length) return g; }catch{} return ALL_GAMES.map(g => g[0]); }
function setMyGames(l){ try{ localStorage.setItem(MYG_KEY, JSON.stringify(l)); }catch{} fpLoadAll(); }
const FPDB = {}, _fpP = {};
function fpLoad(game){
  return _fpP[game] || (_fpP[game] = fetch(`fp-${game}.json`).then(r => r.ok ? r.json() : null).then(j => { if(j && j.k && j.k.length) FPDB[game] = FP.decode(j); return FPDB[game] || null; }).catch(() => { delete _fpP[game]; return null; }));
}
function fpLoadAll(){ return Promise.all(myGames().map(fpLoad)); }
setTimeout(() => (window.requestIdleCallback || setTimeout)(fpLoadAll), 1500);
document.addEventListener("pointerdown", () => fpLoadAll(), { once: true, capture: true });

// Grenzwerte (Abstand von 128 Bit), geeicht am Selbsttest des täglichen Laufs:
// richtige Karte meist 14–16 (höchstens ~28), fremde Karten meist 30+ -> nur bei klarem Abstand übernehmen
const FP_SURE = 28, FP_GAP = 8, FP_MAYBE = 34, FP_ASK = 26;
function fpPixels(src){
  // Karte auf feste Größe bringen (schneller und gleichmäßiger), aufrecht und 180° gedreht
  const W = 252, H = 352, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  let sw = src.width, sh = src.height, rot = sw > sh;   // quer -> hochkant drehen
  if(rot){ g.translate(W, 0); g.rotate(Math.PI / 2); g.drawImage(src, 0, 0, H, W); } else g.drawImage(src, 0, 0, W, H);
  const a = g.getImageData(0, 0, W, H).data;
  const b = new Uint8ClampedArray(a.length);   // 180° gedreht
  for(let i = 0, n = W * H; i < n; i++){ const s = i * 4, d = (n - 1 - i) * 4; b[d] = a[s]; b[d + 1] = a[s + 1]; b[d + 2] = a[s + 2]; b[d + 3] = a[s + 3]; }
  return { a, b, W, H };
}
// Schlüssel -> Spielkarte
function fpCard(game, key, lang){
  lang = lang || LANG;
  try{
    if(game === "pokemon"){
      const [sid, lid] = key.split(":"); const st = CDB && CDB.sets.get(sid), e = CDB && CDB.cards.get(sid) && CDB.cards.get(sid).get(String(lid).toUpperCase());
      if(!st || !e) return null;
      const x = applyDb({ set_code: st.code || "", set: st.en, set_en: st.en, name: e[2], name_en: e[2], number: `${lid}/${st.total || ""}`, language: lang });
      if(!x.db) return null; const c = finishPk(x, lang);
      return { c, label: lang === "Deutsch" && e[3] ? e[3] : e[2], sub: `${st.code ? st.code + " · " : ""}${lang === "Deutsch" ? st.de || st.en : st.en} · Nr. ${lid}` };
    }
    if(game === "onepiece"){
      const [id, suf] = key.split("|"); const c = opApply({ game: "onepiece", number: id, language: lang === "Japanisch" ? "Japanisch" : "Englisch" });
      if(!c.op) return null;
      const vs = typeof opVariants === "function" ? opVariants(c) : [""]; c.vi = Math.max(0, vs.indexOf(suf || "")); c.op.suf = suf || "";
      return { c, label: c.name, sub: `${c.op.id}${suf ? " · Parallel/Alt Art" : ""} · ${c.set}` };
    }
    if(game === "yugioh"){
      const pc = (YGO && YGO.a && YGO.a[key]) || key;
      return { ygo: +pc };
    }
  }catch(e){ console.warn(e); }
  return null;
}
// Erkennen: liefert { sure, list:[{c,label,sub}], ygoPc, d, gap, game } oder null
async function fpIdentify(src){
  const games = myGames();
  await Promise.all(games.map(fpLoad));
  if(games.includes("yugioh")) await ygoSoon();
  const P = fpPixels(src), cand = [];
  for(const game of games){
    const db = FPDB[game]; if(!db) continue;
    const q = [];
    for(const px of [P.a, P.b]) for(const [dx, dy] of [[0, 0], [0.012, 0], [-0.012, 0], [0, 0.012], [0, -0.012]]) q.push(FP.hash(px, P.W, P.H, game, dx, dy));
    for(const h of FP.search(db, q, 10)) cand.push({ game, key: h.key, d: h.d });
  }
  if(!cand.length) return null;
  cand.sort((a, b) => a.d - b.d);
  const best = cand[0];
  if(best.d > FP_MAYBE) return null;
  // gleiches Motiv (Nachdrucke) = fast gleicher Abstand; „anderes Motiv“ = deutlich weiter weg
  const group = cand.filter(x => x.d <= best.d + 3), other = cand.find(x => x.d > best.d + 3);
  const gap = other ? other.d - best.d : 99;
  const sure = (best.d <= 24 && gap >= FP_GAP) || (best.d <= FP_SURE && gap >= 12);
  const ok = best.d <= FP_ASK && gap >= 6;   // gut genug, um eine Auswahl anzubieten
  const lang = LANG, list = [], seen = new Set();
  let ygoPc = 0;
  for(const g of group){
    const r = fpCard(g.game, g.key, lang); if(!r) continue;
    if(r.ygo){ if(!ygoPc) ygoPc = r.ygo; continue; }
    const id = identity(r.c); if(seen.has(id)) continue; seen.add(id); list.push(r);
  }
  if(ygoPc && !list.length) for(const x of ygoPrintsLabeled(ygoPc, lang)) list.push(x);
  return { sure, ok, list, ygoPc, d: best.d, gap, game: best.game };
}

// ---------- Auswahl „Meine Spiele“ ----------
async function chooseGames(){
  const cur = new Set(myGames());
  return new Promise(res => {
    const sh = $("sheet");
    const draw = () => {
      $("sheetIn").innerHTML = `<h4>Meine Spiele</h4><p style="color:var(--muted);margin:4px 0 12px">Nur diese Spiele werden aufs Handy geladen und beim Scannen durchsucht – das macht die Erkennung schneller und genauer.</p>
        <div class="gtiles">${ALL_GAMES.map(([k, n, i]) => `<button class="gtile g-${k}${cur.has(k) ? " on" : ""}" data-g="${k}"><i>${i}</i><b>${n}</b><small>${cur.has(k) ? "✓ ausgewählt" : "+ hinzufügen"}</small></button>`).join("")}</div>
        <button class="opt" data-gok style="justify-content:center;margin-top:12px">Fertig</button>`;
    };
    draw(); sh.hidden = false;
    sh.onclick = e => {
      const t = e.target.closest("[data-g]");
      if(t){ const k = t.dataset.g; if(cur.has(k)){ if(cur.size > 1) cur.delete(k); else toast("Mindestens ein Spiel auswählen"); } else cur.add(k); draw(); return; }
      if(e.target.closest("[data-gok]") || e.target === sh){ sh.hidden = true; sh.onclick = null; const l = ALL_GAMES.map(g => g[0]).filter(g => cur.has(g)); setMyGames(l); res(l); }
    };
  });
}
