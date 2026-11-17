// CardGrab Device – Karten am Bild erkennen über „Fingerabdrücke“ (keine Bilder auf dem Gerät)
// Je Karte 2 × 64 Bit: Wahrnehmungs-Hash (DCT) der ganzen Karte und des Bildausschnitts.
// Dieselben Funktionen laufen im Browser (Kamera) und in Node (Aufbau der Datenbank im täglichen Lauf).
"use strict";
const FP = (function(){
  // Bildbereich je Spiel (Anteile von Breite/Höhe der geraden Karte)
  const REG = {
    full:     [0.05, 0.04, 0.95, 0.96],
    pokemon:  [0.09, 0.10, 0.91, 0.50],
    onepiece: [0.06, 0.06, 0.94, 0.66],
    yugioh:   [0.12, 0.18, 0.88, 0.69]
  };
  const N = 32, K = 8;
  const COS = new Float64Array(K * N);
  for(let u = 0; u < K; u++) for(let x = 0; x < N; x++) COS[u * N + x] = Math.cos((2 * x + 1) * u * Math.PI / (2 * N));
  // Graustufen-Raster N×N aus einem Ausschnitt (Mittelwert je Feld) – RGBA-Daten, Breite w, Höhe h
  function gridGray(px, w, h, r){
    const x0 = r[0] * w, y0 = r[1] * h, cw = (r[2] - r[0]) * w / N, ch = (r[3] - r[1]) * h / N;
    const g = new Float64Array(N * N);
    for(let j = 0; j < N; j++){
      const ya = Math.floor(y0 + j * ch), yb = Math.max(ya + 1, Math.floor(y0 + (j + 1) * ch));
      for(let i = 0; i < N; i++){
        const xa = Math.floor(x0 + i * cw), xb = Math.max(xa + 1, Math.floor(x0 + (i + 1) * cw));
        let s = 0, n = 0;
        const sy = Math.max(1, (yb - ya) >> 2), sx = Math.max(1, (xb - xa) >> 2);   // Stichprobe reicht
        for(let y = ya; y < yb && y < h; y += sy) for(let x = xa; x < xb && x < w; x += sx){
          const k = (y * w + x) * 4, a = px[k + 3] / 255;
          s += (0.299 * px[k] + 0.587 * px[k + 1] + 0.114 * px[k + 2]) * a + 255 * (1 - a); n++;
        }
        g[j * N + i] = n ? s / n : 255;
      }
    }
    return g;
  }
  // 64-Bit-Hash als 2 × Uint32
  function phash(g){
    const tmp = new Float64Array(K * N), c = new Float64Array(K * K);
    for(let u = 0; u < K; u++) for(let y = 0; y < N; y++){ let s = 0; for(let x = 0; x < N; x++) s += g[y * N + x] * COS[u * N + x]; tmp[u * N + y] = s; }
    for(let v = 0; v < K; v++) for(let u = 0; u < K; u++){ let s = 0; for(let y = 0; y < N; y++) s += tmp[u * N + y] * COS[v * N + y]; c[v * K + u] = s; }
    const vals = Array.from(c).slice(1), med = [...vals].sort((a, b) => a - b)[31];
    let a = 0, b = 0;
    for(let i = 0; i < 64; i++){ const bit = (i === 0 ? 0 : (vals[i - 1] > med ? 1 : 0)); if(i < 32) a |= bit << i; else b |= bit << (i - 32); }
    return [a >>> 0, b >>> 0];
  }
  // 4 × Uint32: [ganze Karte, Bildausschnitt]
  function hash(px, w, h, game, dx, dy){
    const sh = r => [r[0] + (dx || 0), r[1] + (dy || 0), r[2] + (dx || 0), r[3] + (dy || 0)];
    const f = phash(gridGray(px, w, h, sh(REG.full))), a = phash(gridGray(px, w, h, sh(REG[game] || REG.pokemon)));
    return [f[0], f[1], a[0], a[1]];
  }
  const pop = x => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; };
  // Datenbank: { k: [Schlüssel], h: Uint32Array(4·n) }
  function decode(json){
    const bin = typeof atob === "function" ? atob(json.h) : Buffer.from(json.h, "base64").toString("binary");
    const u8 = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { k: json.k, h: new Uint32Array(u8.buffer, 0, json.k.length * 4) };
  }
  function encode(keys, hashes){
    const u32 = new Uint32Array(keys.length * 4); hashes.forEach((h, i) => u32.set(h, i * 4));
    const u8 = new Uint8Array(u32.buffer); let s = ""; for(let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return { v: 1, k: keys, h: typeof btoa === "function" ? btoa(s) : Buffer.from(u8).toString("base64") };
  }
  // beste Treffer: mehrere Abfrage-Hashes (Verschiebungen, 180° gedreht) – je Karte der kleinste Abstand
  function search(db, qs, top){
    const H = db.h, n = db.k.length, best = new Uint8Array(n).fill(255);
    for(const q of qs) for(let i = 0, o = 0; i < n; i++, o += 4){
      const d = pop(H[o] ^ q[0]) + pop(H[o + 1] ^ q[1]) + pop(H[o + 2] ^ q[2]) + pop(H[o + 3] ^ q[3]);
      if(d < best[i]) best[i] = d;
    }
    const idx = []; for(let i = 0; i < n; i++) if(best[i] <= 60) idx.push(i);
    idx.sort((a, b) => best[a] - best[b]);
    return idx.slice(0, top || 12).map(i => ({ key: db.k[i], d: best[i] }));
  }
  return { REG, hash, search, encode, decode, pop };
})();
if(typeof module !== "undefined") module.exports = FP;
