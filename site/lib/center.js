// CardGrab Device – Zentrierung messen + Grading-Etikett (PSA, BGS, CGC, SGC, TAG) vom Foto lesen
"use strict";

// ================= Zentrierung =================
// 1) Karte im Foto finden (findCardQuad), etwas größer ausschneiden und gerade rücken
// 2) auf vielen Linien quer zu jedem Rand: äußere Kante (Karte/Hintergrund) und innere Kante (Rand/Bildrahmen) suchen
// 3) Median der Randbreiten -> Verhältnis links/rechts und oben/unten
function measureCentering(src){
  const q = findCardQuad(src); if(!q) return { err: "Karte im Foto nicht gefunden – Karte flach auf einen einfarbigen Untergrund legen, ganz im Bild." };
  let P = q.P; if(q.landscape) P = [P[3], P[0], P[1], P[2]];
  const cx = P.reduce((s, p) => s + p[0], 0) / 4, cy = P.reduce((s, p) => s + p[1], 0) / 4;
  const E = 1.07, PE = P.map(([x, y]) => [cx + (x - cx) * E, cy + (y - cy) * E]);
  const W = 900, cv = warpCard(src, PE, W), H = cv.height;
  const d = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  // Kantenstärke entlang einer Linie (Abstand 2 px, leicht geglättet)
  const profile = (get, n) => { const v = []; for(let t = 0; t < n; t++) v.push(get(t)); const g = new Float32Array(n); for(let t = 2; t < n - 2; t++) g[t] = diff(v[t - 2], v[t + 2]); return g; };
  const argmax = (g, a, b) => { let bi = -1, bv = 0; for(let t = Math.max(2, a | 0); t < Math.min(g.length - 2, b | 0); t++) if(g[t] > bv){ bv = g[t]; bi = t; } return [bi, bv]; };
  const firstPeak = (g, a, b) => {
    const a0 = Math.max(3, Math.round(a)), a1 = Math.min(g.length - 3, Math.round(b));
    const [, mx] = argmax(g, a0, a1); if(!(mx > 0)) return -1;
    const thr = Math.max(30, mx * 0.45);
    for(let t = a0; t < a1; t++) if(g[t] >= thr && g[t] >= g[t - 1]){ let p = t; while(p + 1 < a1 && g[p + 1] >= g[p]) p++; return p; }
    return -1;
  };
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
  const sides = {};
  const doSide = (name, len, across, getLine) => {
    const outs = [], ins = [], so = [], si = [];
    for(let k = 0; k < 36; k++){
      const pos = Math.round(across * (0.28 + 0.44 * k / 35));
      const g = profile(t => getLine(pos, t), Math.round(len * 0.24));
      // Kartenkante liegt nach dem Vergrößern um 7 % bei ca. 3,3 % – nur dort suchen (Muster im Untergrund stören sonst)
      // jeweils die erste deutliche Kante von außen nach innen (nicht die stärkste – Motive im Bild sind oft kontrastreicher)
      const ex = len * (E - 1) / (2 * E);
      const o = firstPeak(g, ex - len * 0.025, ex + len * 0.025); if(o < 0) continue; const ov = g[o];
      const i = firstPeak(g, o + len * 0.012, o + len * 0.12); if(i < 0) continue; const iv = g[i];
      outs.push(o); ins.push(i); so.push(ov); si.push(iv);
    }
    if(outs.length < 10) return null;
    const widths = outs.map((o, k) => ins[k] - o), w = med(widths);
    const mad = med(widths.map(x => Math.abs(x - w)));
    sides[name] = { w, out: med(outs), inn: med(ins), mad, so: med(so), si: med(si) };
    return sides[name];
  };
  doSide("l", W, H, (y, t) => px(t, y));
  doSide("r", W, H, (y, t) => px(W - 1 - t, y));
  doSide("t", H, W, (x, t) => px(x, t));
  doSide("b", H, W, (x, t) => px(x, H - 1 - t));
  const S = sides;
  if(!S.l || !S.r || !S.t || !S.b) return { err: "Ränder nicht klar erkennbar – heller, gleichmäßiger Untergrund und kein Spiegeln hilft." };
  const weakInner = ["l", "r", "t", "b"].filter(k => S[k].si < 35 || S[k].si < S[k].so * 0.18).length;
  if(weakInner >= 2) return { err: "Kein klarer Bildrahmen gefunden – bei Vollbild-Karten (Full Art) lässt sich die Zentrierung so nicht messen." };
  const unsure = ["l", "r", "t", "b"].some(k => S[k].mad > Math.max(3, S[k].w * 0.22));
  const lr = Math.round(S.l.w / (S.l.w + S.r.w) * 100), tb = Math.round(S.t.w / (S.t.w + S.b.w) * 100);
  const worst = Math.max(lr, 100 - lr, tb, 100 - tb);
  // Richtwerte der PSA-Zentrierungsgrenzen (Vorderseite)
  const psa = worst <= 55 ? "PSA 10 möglich" : worst <= 60 ? "höchstens PSA 9" : worst <= 65 ? "höchstens PSA 8" : worst <= 70 ? "höchstens PSA 7" : worst <= 80 ? "höchstens PSA 6" : "deutlich verschoben";
  // Bild mit eingezeichneten Kanten
  const view = document.createElement("canvas"), vw = 300, k = vw / W; view.width = vw; view.height = Math.round(H * k);
  const g = view.getContext("2d"); g.drawImage(cv, 0, 0, view.width, view.height);
  g.lineWidth = 2;
  const vline = (x, col) => { g.strokeStyle = col; g.beginPath(); g.moveTo(x * k, 0); g.lineTo(x * k, view.height); g.stroke(); };
  const hline = (y, col) => { g.strokeStyle = col; g.beginPath(); g.moveTo(0, y * k); g.lineTo(view.width, y * k); g.stroke(); };
  vline(S.l.out, "#22d3ee"); vline(S.l.inn, "#ffd166"); vline(W - 1 - S.r.out, "#22d3ee"); vline(W - 1 - S.r.inn, "#ffd166");
  hline(S.t.out, "#22d3ee"); hline(S.t.inn, "#ffd166"); hline(H - 1 - S.b.out, "#22d3ee"); hline(H - 1 - S.b.inn, "#ffd166");
  return { lr: [lr, 100 - lr], tb: [tb, 100 - tb], worst, psa, unsure, img: view.toDataURL("image/jpeg", 0.85) };
}
const centerText = m => `${m.lr[0]}/${m.lr[1]} · ${m.tb[0]}/${m.tb[1]}`;

function showCentering(m, c){
  const sh = $("sheet");
  $("sheetIn").innerHTML = m.err ? `<h4>📐 Zentrierung</h4><p>${esc(m.err)}</p><button class="opt" data-close style="justify-content:center">OK</button>` :
    `<h4>📐 Zentrierung${c ? " – " + esc(c.name) : ""}</h4>
     <div class="centbox"><img src="${m.img}" alt=""><div>
       <div class="cv"><small>Links / Rechts</small><b>${m.lr[0]} / ${m.lr[1]}</b></div>
       <div class="cv"><small>Oben / Unten</small><b>${m.tb[0]} / ${m.tb[1]}</b></div>
       <div class="cv ${m.worst <= 55 ? "up" : m.worst <= 60 ? "" : "down"}"><b>${esc(m.psa)}</b><small>nach PSA-Zentrierungsgrenzen (Vorderseite)</small></div>
     </div></div>
     <p class="note">${m.unsure ? "⚠️ Messung unsicher (Spiegelung, Schatten oder Schrift im Rand) – lieber noch ein Foto machen. " : ""}Türkis = Kartenkante, gelb = Bildrahmen. Für ein genaues Ergebnis: Karte ohne Hülle, flach, gerade von oben, gleichmäßiges Licht. Ecken, Kanten und Oberfläche bewertet die Messung nicht.</p>
     <button class="opt" data-close style="justify-content:center">OK</button>`;
  sh.hidden = false;
  sh.onclick = e => { if(e.target.closest("[data-close]") || e.target === sh){ sh.hidden = true; sh.onclick = null; } };
}
async function photoToCanvas(file){
  let bmp; try{ bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }catch{ bmp = await createImageBitmap(file); }
  const k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height)), cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k); cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height); return cv;
}
// Foto über einen versteckten Datei-Knopf holen (Kamera auf dem Handy)
function askPhoto(){
  return new Promise(res => {
    const i = document.createElement("input"); i.type = "file"; i.accept = "image/*"; i.capture = "environment";
    i.onchange = () => res(i.files && i.files[0] ? i.files[0] : null); i.click();
  });
}
async function centerFromPhoto(c){
  const f = await askPhoto(); if(!f) return;
  toast("📐 Messe Zentrierung …");
  const cv = await photoToCanvas(f);
  await new Promise(r => setTimeout(r, 30));
  const m = measureCentering(cv);
  if(c && !m.err){ c.center = centerText(m) + (m.unsure ? " ?" : ""); await saveCard(c); rerender(c); }
  showCentering(m, c);
}
document.addEventListener("click", e => { if(e.target.closest("#centerBtn")) centerFromPhoto(null); });

// ================= Grading-Etikett lesen =================
const GCO = [["PSA", /\bP\s?S\s?A\b/], ["BGS", /\bBGS\b|BECKETT/], ["CGC", /\bCGC\b/], ["SGC", /\bSGC\b/], ["TAG", /\bTAG\b(?=.*\b(10|[1-9])\b)/]];
const GWORDS = /(GEM\s*-?\s*MT|GEM\s*MINT|PRISTINE|BLACK\s*LABEL|MINT|NM\s*-?\s*MT|NEAR\s*MINT|EX\s*-?\s*MT|VG\s*-?\s*EX|EXCELLENT|VERY\s*GOOD|GOOD|FAIR|POOR|PR\b|AUTHENTIC)/;
function parseGrade(text){
  const T = String(text || "").toUpperCase().replace(/[|]/g, "I").replace(/\s+/g, " ");
  const co = (GCO.find(([, re]) => re.test(T)) || [])[0]; if(!co) return null;
  let g = "";
  if(/AUTHENTIC/.test(T) && !/\b(10|[1-9](\.5)?)\b/.test(T.split("AUTHENTIC")[1] || "")) g = "Authentic";
  const wm = T.match(new RegExp(GWORDS.source + "\\s*:?\\s*(10|[1-9](?:[.,]5)?)\\b"));
  if(wm) g = wm[wm.length - 1].replace(",", ".");
  if(!g){ // Note als einzelne Zahl (BGS/CGC schreiben z. B. "9.5" groß)
    const nums = (T.match(/\b(10|[1-9][.,]5|[1-9])\b(?![\d/])/g) || []).map(x => x.replace(",", "."));
    const half = nums.find(x => /\.5$/.test(x)); g = half || nums.find(x => x === "10") || "";
  }
  if(!g) return null;
  const cert = (T.replace(/\s/g, " ").match(co === "PSA" ? /\b(\d{8,9})\b/ : /\b(\d{7,10})\b/) || [])[1] || "";
  return { co, g, cert };
}
async function readGradeLabel(cv, manual){
  await ocrReady;
  const W = cv.width, H = cv.height, bandH = Math.round(H * 0.32);
  const t1 = await ocr(prepStrip(cv, 0, 0, W, bandH, false, 1800, true));
  let r = parseGrade(t1);
  const coSeen = GCO.some(([, re]) => re.test(String(t1).toUpperCase()));
  if((!r || !r.cert) && (manual || coSeen)){ const t2 = await ocr(prepStrip(cv, 0, 0, W, bandH, true, 1800, true)); const r2 = parseGrade(t1 + " " + t2); if(r2 && (!r || r2.cert)) r = r2; }
  return r;
}
const certLink = c => c && c.cert && /^PSA /.test(c.grade || "") ? `https://www.psacard.com/cert/${encodeURIComponent(c.cert)}` : "";
function applyGrade(c, r){
  c.grade = `${r.co} ${r.g}`; if(r.cert) c.cert = r.cert;
}
async function gradeFromPhoto(c){
  const f = await askPhoto(); if(!f) return;
  toast("🏅 Lese Etikett …");
  const r = await readGradeLabel(await photoToCanvas(f), true);
  if(!r){ toast("Kein Grading-Etikett erkannt – Etikett gerade und ohne Spiegelung fotografieren"); return; }
  applyGrade(c, r); await saveCard(c); rerender(c); toast(`🏅 ${c.grade}${c.cert ? " · Zert. " + c.cert : ""} übernommen`);
}

// ================= im Hintergrund nach jedem Foto =================
// Zentrierung (nur Bildrechnung) und Grading-Etikett (nur wenn „PSA/BGS/CGC…“ oben im Bild steht)
let LAST_PHOTO = null;
const BG_Q = [];
function photoTaken(cv){ LAST_PHOTO = { cv, at: Date.now() }; }
function afterAdd(c){
  if(!LAST_PHOTO || Date.now() - LAST_PHOTO.at > 30000 || c.grade) return;
  const cv = LAST_PHOTO.cv; LAST_PHOTO = null;
  BG_Q.push({ id: c.id, cv }); if(BG_Q.length === 1) setTimeout(bgRun, 1200);
}
async function bgRun(){
  while(BG_Q.length){
    const { id, cv } = BG_Q[0];
    try{
      if(typeof qRunning !== "undefined" && qRunning){ await new Promise(r => setTimeout(r, 1500)); continue; }   // Scans gehen vor
      const c = coll.find(x => x.id === id);
      if(c){
        let ch = false;
        const r = await readGradeLabel(cv);
        if(r && !c.grade){ applyGrade(c, r); ch = true; toast(`🏅 Grading erkannt: ${c.grade}${c.cert ? " · Zert. " + c.cert : ""}`); }
        if(!r && !c.center){ const m = measureCentering(cv); if(!m.err && !m.unsure){ c.center = centerText(m); ch = true; } }
        if(ch){ await saveCard(c); rerender(c); }
      }
    }catch(e){ console.warn(e); }
    BG_Q.shift();
  }
}
