// CardGrab Device – Karte im Foto finden und gerade ausschneiden (ohne Zusatzbibliothek)
// 1) Bild klein rechnen, Kanten suchen (Sobel)  2) Hough-Transformation -> stärkste Geraden
// 3) je zwei ungefähr waagerechte + senkrechte Geraden zu einem Viereck mit Kartenformat (63 × 88 mm) kombinieren
// 4) Viereck perspektivisch entzerren -> gerade Karte (für die Texterkennung)
"use strict";
const CARD_RATIO = 63 / 88;

function findCardQuad(src){
  const S = 360, k = S / Math.max(src.width, src.height);
  const w = Math.max(40, Math.round(src.width * k)), h = Math.max(40, Math.round(src.height * k));
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.filter = "blur(1.2px)"; g.drawImage(src, 0, 0, w, h); g.filter = "none";
  const d = g.getImageData(0, 0, w, h).data;
  // Sobel je Farbkanal (R, G, B) und die stärkste Kante nehmen: ein gelber Kartenrand auf weißem Grund ist
  // in der Helligkeit kaum zu sehen, im Blau-Kanal aber deutlich
  const M = new Float32Array(w * h); let mx = 0;
  const C = [0, 1, 2].map(c => { const L = new Float32Array(w * h); for(let i = c, j = 0; i < d.length; i += 4, j++) L[j] = d[i]; return L; });
  for(let y = 1; y < h - 1; y++) for(let x = 1; x < w - 1; x++){
    const i = y * w + x; let m = 0;
    for(const L of C){
      const gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
      const gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
      const v = gx * gx + gy * gy; if(v > m) m = v;
    }
    m = Math.sqrt(m); M[i] = m; if(m > mx) mx = m;
  }
  // Schwelle: obere 9 % der Kantenstärken
  const hist = new Uint32Array(256); for(let i = 0; i < M.length; i++) hist[Math.min(255, (M[i] / mx * 255) | 0)]++;
  let acc = 0, th = 255; const target = M.length * 0.09; for(let b = 255; b > 0; b--){ acc += hist[b]; if(acc >= target){ th = b; break; } }
  const thr = Math.max(th, 20) / 255 * mx;
  // Hough
  const NT = 180, diag = Math.ceil(Math.hypot(w, h)), NR = diag * 2 + 1;
  const cs = new Float32Array(NT), sn = new Float32Array(NT); for(let t = 0; t < NT; t++){ cs[t] = Math.cos(t * Math.PI / NT); sn[t] = Math.sin(t * Math.PI / NT); }
  const H = new Uint32Array(NT * NR);
  for(let y = 1; y < h - 1; y++) for(let x = 1; x < w - 1; x++){
    if(M[y * w + x] < thr) continue;
    for(let t = 0; t < NT; t++){ const r = Math.round(x * cs[t] + y * sn[t]) + diag; H[t * NR + r]++; }
  }
  // Spitzen mit Unterdrückung der Nachbarn
  const lines = [];
  const used = new Uint8Array(NT * NR);
  for(let n = 0; n < 24; n++){
    let best = 0, bi = -1;
    for(let i = 0; i < H.length; i++) if(!used[i] && H[i] > best){ best = H[i]; bi = i; }
    if(bi < 0 || best < Math.min(w, h) * 0.18) break;
    const t = Math.floor(bi / NR), r = bi % NR - diag;
    lines.push({ t, r, v: best });
    for(let dt = -6; dt <= 6; dt++) for(let dr = -10; dr <= 10; dr++){
      const tt = (t + dt + NT) % NT, rr = (dt + t < 0 || dt + t >= NT) ? -(r + dr) + diag : r + dr + diag;
      if(rr >= 0 && rr < NR) used[tt * NR + rr] = 1;
    }
  }
  const ang = l => l.t;   // 0 = senkrechte Linie, 90 = waagerechte Linie
  const vert = lines.filter(l => ang(l) < 25 || ang(l) > 155), hor = lines.filter(l => Math.abs(ang(l) - 90) < 25);
  const inter = (a, b) => {
    const ta = a.t * Math.PI / NT, tb = b.t * Math.PI / NT;
    const det = Math.cos(ta) * Math.sin(tb) - Math.sin(ta) * Math.cos(tb); if(Math.abs(det) < 1e-6) return null;
    return [(a.r * Math.sin(tb) - b.r * Math.sin(ta)) / det, (b.r * Math.cos(ta) - a.r * Math.cos(tb)) / det];
  };
  let best = null; const all = [];
  for(let i = 0; i < hor.length; i++) for(let j = i + 1; j < hor.length; j++)
  for(let a = 0; a < vert.length; a++) for(let b = a + 1; b < vert.length; b++){
    const h1 = hor[i], h2 = hor[j], v1 = vert[a], v2 = vert[b];
    const P = [inter(h1, v1), inter(h1, v2), inter(h2, v2), inter(h2, v1)];
    if(P.some(p => !p || p[0] < -w * 0.05 || p[0] > w * 1.05 || p[1] < -h * 0.05 || p[1] > h * 1.05)) continue;
    // Reihenfolge: oben-links, oben-rechts, unten-rechts, unten-links
    const cx = P.reduce((s, p) => s + p[0], 0) / 4, cy = P.reduce((s, p) => s + p[1], 0) / 4;
    P.sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
    const tl = P.reduce((m, p) => (p[0] + p[1] < m[0] + m[1] ? p : m)); while(P[0] !== tl) P.push(P.shift());
    let area = 0; for(let q = 0; q < 4; q++){ const p1 = P[q], p2 = P[(q + 1) % 4]; area += p1[0] * p2[1] - p2[0] * p1[1]; } area = Math.abs(area) / 2;
    const fr = area / (w * h); if(fr < 0.12 || fr > 0.98) continue;
    // Ecken müssen ungefähr rechtwinklig sein, gegenüberliegende Seiten ähnlich lang
    let okAng = true;
    for(let q = 0; q < 4; q++){
      const p0 = P[(q + 3) % 4], p1 = P[q], p2 = P[(q + 1) % 4];
      const ax = p0[0] - p1[0], ay = p0[1] - p1[1], bx = p2[0] - p1[0], by = p2[1] - p1[1];
      const cosA = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
      if(Math.abs(cosA) > 0.34){ okAng = false; break; }   // 70°–110°
    }
    if(!okAng) continue;
    const top = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]), bot = Math.hypot(P[2][0] - P[3][0], P[2][1] - P[3][1]);
    const lef = Math.hypot(P[3][0] - P[0][0], P[3][1] - P[0][1]), rig = Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]);
    if(top / bot > 1.5 || bot / top > 1.5 || lef / rig > 1.5 || rig / lef > 1.5) continue;
    const ratio = ((top + bot) / 2) / ((lef + rig) / 2);
    const rr = Math.min(Math.abs(ratio - CARD_RATIO), Math.abs(1 / ratio - CARD_RATIO));
    if(rr > 0.12) continue;
    const support = (h1.v + h2.v + v1.v + v2.v) / ((top + bot + lef + rig) || 1);
    const score = support * (1 - rr * 4) * Math.sqrt(fr);
    const cand = { score, P: P.map(p => [p[0] / k, p[1] / k]), landscape: ratio > 1 };
    all.push(cand); if(!best || score > best.score) best = cand;
  }
  if(!best || best.score <= 0.25) return null;
  // weitere deutlich andere Vierecke merken – falls das beste nur der Bildrand innerhalb der Karte war
  const far = (a, b) => a.P.some((p, n) => Math.hypot(p[0] - b.P[n][0], p[1] - b.P[n][1]) > 0.04 * Math.max(src.width, src.height));
  const orient = c => c.landscape ? [c.P[3], c.P[0], c.P[1], c.P[2]] : c.P;
  best.alts = [];
  for(const c of all.sort((a, b) => b.score - a.score)){
    if(best.alts.length >= 3) break;
    if(c.score > best.score * 0.3 && far(c, best) && best.alts.every(x => far(c, { P: x.raw }))) best.alts.push({ P: orient(c), raw: c.P });
  }
  best.alts = best.alts.map(x => x.P);
  return best;
}

// Homographie (4 Punkte -> Rechteck) und Entzerrung mit bilinearer Abtastung
function homography(src, dst){
  const A = [], B = [];
  for(let i = 0; i < 4; i++){
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  for(let c = 0; c < 8; c++){   // Gauß-Elimination
    let p = c; for(let r = c + 1; r < 8; r++) if(Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]];
    for(let r = 0; r < 8; r++){ if(r === c) continue; const f = A[r][c] / A[c][c]; for(let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; B[r] -= f * B[c]; }
  }
  return B.map((b, i) => b / A[i][i]).concat(1);
}
function warpCard(src, P, outW){
  const W = outW || 1100, Hh = Math.round(W / CARD_RATIO);
  // Abbildung Ziel -> Quelle (für jede Zielposition das Quellpixel suchen)
  const Hm = homography([[0, 0], [W, 0], [W, Hh], [0, Hh]], P);
  const sc = document.createElement("canvas"); sc.width = src.width; sc.height = src.height;
  const sg = sc.getContext("2d", { willReadFrequently: true }); sg.drawImage(src, 0, 0);
  const sd = sg.getImageData(0, 0, src.width, src.height).data, SW = src.width, SH = src.height;
  const out = document.createElement("canvas"); out.width = W; out.height = Hh;
  const og = out.getContext("2d"); const od = og.createImageData(W, Hh), o = od.data;
  for(let y = 0; y < Hh; y++) for(let x = 0; x < W; x++){
    const z = Hm[6] * x + Hm[7] * y + 1, sx = (Hm[0] * x + Hm[1] * y + Hm[2]) / z, sy = (Hm[3] * x + Hm[4] * y + Hm[5]) / z;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, j = (y * W + x) * 4;
    if(x0 < 0 || y0 < 0 || x0 >= SW - 1 || y0 >= SH - 1){ o[j] = o[j + 1] = o[j + 2] = 255; o[j + 3] = 255; continue; }
    const i00 = (y0 * SW + x0) * 4, i10 = i00 + 4, i01 = i00 + SW * 4, i11 = i01 + 4;
    for(let c = 0; c < 3; c++) o[j + c] = (sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx) * (1 - fy) + (sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx) * fy;
    o[j + 3] = 255;
  }
  og.putImageData(od, 0, 0);
  return out;
}
// Karte finden + gerade ausschneiden; Querformat-Fund wird hochkant gedreht (Karte liegt quer)
function straightenCard(src){
  try{
    const q = findCardQuad(src); if(!q) return null;
    let P = q.P;
    if(q.landscape) P = [P[3], P[0], P[1], P[2]];   // um 90° drehen
    return { canvas: warpCard(src, P), quad: q, alts: q.alts || [] };
  }catch(e){ console.warn(e); return null; }
}

// Ausschnitt im Kartenformat aus der Bildmitte (Anteil f der möglichen Größe) – Ersatz, wenn die Kanten nicht passen
function cardCrop(src, f){
  const W = src.width, H = src.height;
  let ch = Math.min(H, W / CARD_RATIO) * f, cw = ch * CARD_RATIO;
  const out = document.createElement("canvas"); out.width = 630; out.height = 880;
  out.getContext("2d").drawImage(src, (W - cw) / 2, (H - ch) / 2, cw, ch, 0, 0, 630, 880);
  return out;
}
