// CardGrab Device – Sammlung: Anzahl, Zustand, Einkaufspreis, Gewinn, Preisverlauf, CSV-Export
"use strict";
const CONDS = [["MT", "Mint"], ["NM", "Near Mint"], ["EX", "Excellent"], ["GD", "Good"], ["LP", "Light Played"], ["PL", "Played"], ["PO", "Poor"]];
const COND_ID = { MT: 1, NM: 2, EX: 3, GD: 4, LP: 5, PL: 6, PO: 7 };
const qtyOf = c => Math.max(1, c.qty | 0 || 1);
const totalOf = c => valueOf(c) * qtyOf(c);
const buyTotalOf = c => (c.buy > 0 ? c.buy : 0) * qtyOf(c);
const parseEur = s => { const v = parseFloat(String(s || "").replace(/[^0-9,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")); return isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : NaN; };
const signEur = n => (n > 0 ? "+" : n < 0 ? "−" : "±") + eur(Math.abs(n) || 0).replace("–", "0,00 €");

// gleiche Karte erkennen (für "3×" statt dreimal in der Liste)
function identity(c){
  const k = c.op ? "op:" + c.op.id : c.ygo ? `ygo:${c.ygo.key}:${c.ygo.pc}` : c.db ? `pk:${c.db.sid}-${c.db.lid}` : `x:${c.name}:${c.number}`;
  return `${k}|${langShort(c)}`;
}

// Bedienfeld unter der Karte
function ownHTML(c){
  const q = qtyOf(c), gain = c.buy > 0 ? totalOf(c) - buyTotalOf(c) : null;
  return `<div class="own">
    <div class="qty"><button data-qty="${esc(c.id)}" data-d="-1" aria-label="weniger">−</button><b>${q}×</b><button data-qty="${esc(c.id)}" data-d="1" aria-label="mehr">+</button></div>
    <select data-cond="${esc(c.id)}" aria-label="Zustand">${CONDS.map(([k, n]) => `<option value="${k}"${(c.cond || "NM") === k ? " selected" : ""}>${k} · ${n}</option>`).join("")}</select>
    <label class="buy">Einkauf <input type="text" inputmode="decimal" data-buy="${esc(c.id)}" value="${c.buy > 0 ? String(c.buy).replace(".", ",") : ""}" placeholder="€/Stk."></label>
    ${gain !== null ? `<span class="gain ${gain >= 0 ? "up" : "down"}">${signEur(gain)}</span>` : ""}
  </div>`;
}
function setBuy(id){
  const c = coll.find(x => x.id === id); if(!c) return;
  const inp = document.querySelector(`[data-buy="${CSS.escape(id)}"]`);
  const v = parseEur(inp && inp.value);
  if(isFinite(v) && v > 0) c.buy = v; else delete c.buy;
  saveCard(c); rerender(c); refreshTotals();
}
document.addEventListener("change", e => {
  const s = e.target.closest && e.target.closest("[data-cond]");
  if(s){ const c = coll.find(x => x.id === s.dataset.cond); if(c){ c.cond = s.value; saveCard(c); rerender(c); } return; }
  const b = e.target.closest && e.target.closest("[data-buy]"); if(b) setBuy(b.dataset.buy);
});
document.addEventListener("keydown", e => { const i = e.target.closest && e.target.closest("[data-buy]"); if(i && e.key === "Enter"){ e.preventDefault(); i.blur(); } });
document.addEventListener("click", e => {
  const b = e.target.closest("[data-qty]"); if(!b) return;
  e.stopPropagation();
  const c = coll.find(x => x.id === b.dataset.qty); if(!c) return;
  const n = qtyOf(c) + (+b.dataset.d);
  if(n < 1){ if(confirmRemove(c)) removeCards([c.id]); return; }
  c.qty = n; saveCard(c); rerender(c); refreshTotals();
}, true);
function confirmRemove(c){
  // kein Browser-Dialog: zweimal "−" bei 1× entfernt die Karte
  if(c._rmArm && Date.now() - c._rmArm < 3000) return true;
  c._rmArm = Date.now(); toast("Nochmal „−“ tippen zum Entfernen"); return false;
}

// ---------- Preisverlauf: einmal pro Preisliste (täglich) speichern ----------
const HKEY = "cgd-hist";
const loadHist = () => { try{ return JSON.parse(localStorage.getItem(HKEY) || "[]"); }catch{ return []; } };
function recordHistory(date){
  if(!date || !coll.length) return;
  const h = loadHist().filter(x => x.d !== date);
  const v = Math.round(coll.reduce((s, c) => s + totalOf(c), 0) * 100) / 100;
  const b = Math.round(coll.reduce((s, c) => s + buyTotalOf(c), 0) * 100) / 100;
  h.push({ d: date, v, b, n: coll.reduce((s, c) => s + qtyOf(c), 0) });
  h.sort((a, b2) => a.d.localeCompare(b2.d));
  try{ localStorage.setItem(HKEY, JSON.stringify(h.slice(-400))); }catch{}
  // Einzelpreise je Karte merken (für Gewinner/Verlierer)
  for(const c of coll){
    const u = Math.round(valueOf(c) * 100) / 100; if(!u) continue;
    const pv = (c.pv || []).filter(x => x[0] !== date); pv.push([date, u]);
    c.pv = pv.slice(-35); saveCard(c);
  }
}
function moversOf(days){
  const cut = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const out = [];
  for(const c of coll){
    const pv = c.pv || []; if(pv.length < 2) continue;
    const old = pv.find(x => x[0] >= cut) || pv[0], now = valueOf(c);
    if(!old || old[0] === pv[pv.length - 1][0] && pv.length < 2) continue;
    const d = (now - old[1]) * qtyOf(c);
    if(Math.abs(d) >= 0.01) out.push({ c, d, pct: old[1] ? (now - old[1]) / old[1] * 100 : 0 });
  }
  return out.sort((a, b) => b.d - a.d);
}
function chartSVG(h){
  if(h.length < 2) return `<div class="note">Der Verlauf füllt sich ab morgen – jeden Tag mit neuer Preisliste kommt ein Punkt dazu.</div>`;
  const W = 320, H = 90, P = 4, vs = h.map(x => x.v), mn = Math.min(...vs), mx = Math.max(...vs), r = mx - mn || 1;
  const pts = h.map((x, i) => [P + i * (W - 2 * P) / (h.length - 1), H - P - (x.v - mn) / r * (H - 2 * P)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const up = vs[vs.length - 1] >= vs[0];
  return `<svg viewBox="0 0 ${W} ${H}" class="hist ${up ? "up" : "down"}" preserveAspectRatio="none" role="img" aria-label="Wertverlauf">
    <path d="${line} L ${pts[pts.length - 1][0]} ${H} L ${pts[0][0]} ${H} Z" class="area"/><path d="${line}" class="ln"/></svg>
    <div class="histlab"><span>${new Date(h[0].d + "T12:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} · ${eur(vs[0])}</span><span>heute · ${eur(vs[vs.length - 1])}</span></div>`;
}
function renderInsights(){
  const box = $("insights"); if(!box) return;
  const h = loadHist();
  const buy = coll.reduce((s, c) => s + buyTotalOf(c), 0), val = coll.reduce((s, c) => s + totalOf(c), 0);
  const withBuy = coll.filter(c => c.buy > 0), valB = withBuy.reduce((s, c) => s + totalOf(c), 0);
  const mv = moversOf(7);
  const row = m => `<div class="mv" data-jump="${esc(m.c.id)}"><span>${esc(m.c.name)}${qtyOf(m.c) > 1 ? ` <small>${qtyOf(m.c)}×</small>` : ""}</span><b class="${m.d >= 0 ? "up" : "down"}">${signEur(m.d)}${m.pct ? ` <small>(${m.pct > 0 ? "+" : ""}${m.pct.toFixed(0)} %)</small>` : ""}</b></div>`;
  // Sicherungs-Erinnerung + iPhone-Hinweis (Safari löscht Daten nicht installierter Web-Apps)
  let last = 0; try{ last = +localStorage.getItem("cgd-lastbackup") || 0; }catch{}
  const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent), installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const warn = [];
  if(coll.length >= 5 && (days === null || days >= 14)) warn.push(`💾 ${days === null ? "Noch keine Sicherung gespeichert" : `Letzte Sicherung vor ${days} Tagen`} – deine Sammlung liegt nur auf diesem Handy. <button class="lnk" data-backup>Jetzt sichern</button>`);
  if(ios && !installed && coll.length) warn.push(`📱 Auf dem iPhone löscht Safari die Daten, wenn die Seite ein paar Tage nicht genutzt wird. <b>Teilen □↑ → „Zum Home-Bildschirm“</b> installieren, dann bleibt alles erhalten.`);
  box.innerHTML = `${warn.map(w => `<div class="warn">${w}</div>`).join("")}
    ${buy > 0 ? `<div class="pl"><span>Einkauf ${eur(buy)} → Wert ${eur(valB)}</span><b class="${valB - buy >= 0 ? "up" : "down"}">${signEur(valB - buy)}</b></div>` : ""}
    <div class="sub">Wertverlauf <small style="text-transform:none;letter-spacing:0;font-weight:600">· Cardmarket-Richtwerte ohne Gewähr</small></div>${chartSVG(h)}
    ${mv.length ? `<div class="sub">Diese Woche gestiegen</div>${mv.filter(m => m.d > 0).slice(0, 5).map(row).join("") || `<div class="note">–</div>`}
    <div class="sub">Diese Woche gefallen</div>${mv.filter(m => m.d < 0).slice(-5).reverse().map(row).join("") || `<div class="note">–</div>`}` : ""}`;
}
document.addEventListener("click", e => { if(e.target.closest("[data-backup]")) $("exportBtn").click(); });
document.addEventListener("click", e => {
  const j = e.target.closest("[data-jump]"); if(!j) return;
  $("search").value = ""; renderColl();
  const el = document.querySelector(`#collList [data-card="${CSS.escape(j.dataset.jump)}"]`);
  if(el){ el.classList.remove("old"); el.scrollIntoView({ behavior: "smooth", block: "center" }); }
});

// ---------- CSV-Export (Excel-tauglich, Semikolon, mit Cardmarket-ID) ----------
function csvExport(){
  const q = v => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const num = n => (typeof n === "number" && isFinite(n) && n > 0) ? n.toFixed(2).replace(".", ",") : "";
  const head = ["Cardmarket-ID", "Spiel", "Name", "Name (EN)", "Set", "Kürzel/Nummer", "Version", "Sprache", "Zustand", "Anzahl", "Einkauf €/Stk.", "Wert ab €/Stk.", "Trend €/Stk.", "Wert gesamt €", "Gewinn €", "Cardmarket-Link"];
  const rows = coll.map(c => {
    const p = c.price || {}, v = c.versions && c.versions[Math.min(c.vi || 0, c.versions.length - 1)];
    const link = ((c.ygo ? ygoLinks(c) : links(c)).match(/class="cm" href="([^"]+)"/) || [])[1] || "";
    const code = c.op ? c.op.id : c.ygo ? c.number : cmCode(c) || c.number || "";
    return [p.id || (v && v.id) || (c.db && c.db.cm) || "", { onepiece: "One Piece", yugioh: "Yu-Gi-Oh!" }[c.game] || "Pokémon", c.name, c.name_en || "", c.set || "", code,
      v ? (v.pack || "V" + ((c.vi || 0) + 1)) : c.rh ? "Reverse Holo" : "", c.language || "", c.cond || "NM", qtyOf(c),
      num(c.buy), num(valueOf(c)), num(p.trend), num(totalOf(c)), c.buy > 0 ? (totalOf(c) - buyTotalOf(c)).toFixed(2).replace(".", ",") : "", link.replace(/&amp;/g, "&")].map(q).join(";");
  });
  const blob = new Blob(["﻿" + [head.join(";"), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `cardgrab-verkaufsliste-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`${coll.length} Karten als Tabelle gespeichert`);
}
