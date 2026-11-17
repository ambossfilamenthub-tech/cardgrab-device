// CardGrab Device – neue Oberfläche: Startseite, Leiste unten, Vollbild-Scanner mit Kartenleiste
// (lädt nach app.js und baut die vorhandenen Bereiche nur um – die Logik bleibt dieselbe)
"use strict";
const UI = { page: "home", scanStart: 0, hide: false, game: "", lock: "", def: "NM" };
try{ Object.assign(UI, JSON.parse(localStorage.getItem("cgd-ui") || "{}"), { page: "home", scanStart: 0 }); }catch{}
const uiSave = () => { try{ localStorage.setItem("cgd-ui", JSON.stringify({ hide: UI.hide, game: UI.game, lock: UI.lock, def: UI.def, single: !!window.UI_SINGLE })); }catch{} };
try{ window.UI_SINGLE = !!JSON.parse(localStorage.getItem("cgd-ui") || "{}").single; }catch{}
const GAMES = [["", "Alle Spiele"], ["pokemon", "Pokémon"], ["onepiece", "One Piece"], ["yugioh", "Yu-Gi-Oh!"]];
const gameOf = c => c.game || (c.ygo ? "yugioh" : c.op ? "onepiece" : "pokemon");

// ---------- Grundgerüst einbauen ----------
(function build(){
  document.body.classList.add("ui2");
  const wrap = document.querySelector(".wrap");
  // Startseite
  const home = document.createElement("section"); home.id = "home";
  home.innerHTML = `
    <button class="gamepill" id="gamePill"></button>
    <div class="hv"><span>Aktueller Wert</span><button class="eye" id="eyeBtn" aria-label="Wert verbergen">👁</button></div>
    <div class="hval" id="homeVal">0 €</div>
    <div class="hchg" id="homeChg"></div>
    <div class="rounds">
      <button data-go="scanner"><i>📷</i><span>Scanner</span></button>
      <button data-go="search"><i>🔍</i><span>Suche</span></button>
      <button data-go="wish"><i>♡</i><span>Wunschliste</span></button>
    </div>
    <div class="hcard" id="homeBuild"><b>Bau deine Sammlung auf!</b><button data-go="scanner">Hinzufügen</button></div>
    <div id="homeRecent"></div>
    <div class="htools">
      <label for="photoInput"><i>📸</i>Foto</label>
      <label for="galleryInput"><i>🖼️</i>Galerie</label>
      <button id="homeBinder"><i>📒</i>Ordner&shy;seite</button>
      <button id="homeCenter"><i>📐</i>Zentrie&shy;rung</button>
      <button id="homeGames"><i>🎴</i>Meine Spiele</button>
    </div>`;
  wrap.insertBefore(home, $("scan"));
  // Leiste unten
  const nav = document.createElement("nav"); nav.id = "nav";
  nav.innerHTML = [["home", "⌂", "Start"], ["coll", "🗂", "Sammlung"], ["scanner", "◉", "Scan"], ["search", "🔍", "Suche"], ["wish", "♡", "Wunschliste"]]
    .map(([k, i, l]) => `<button data-go="${k}"><i>${i}</i><span>${l}</span></button>`).join("");
  document.body.appendChild(nav);
  // Bedienelemente im Vollbild-Scanner
  const ov = document.createElement("div"); ov.id = "scanUi"; ov.hidden = true;
  ov.innerHTML = `
    <button class="sclose" id="scClose" aria-label="Scanner schließen">✕</button>
    <div class="sside">
      <button id="scList"><i>📥<b id="scCnt" hidden></b></i><span>Gescannt</span></button>
      <button id="scLock"><i>🔒</i><span id="scLockT">Set fixieren</span></button>
      <button id="scBulk"><i>⚡</i><span id="scBulkT">Serie an</span></button>
      <button id="scSound"><i>🔔</i><span id="scSoundT">Ton an</span></button>
    </div>
    <button class="shutter" id="scShot" aria-label="Foto aufnehmen"></button>
    <div class="sstrip" id="scStrip"></div>
    <button class="sset" id="scSet"></button>`;
  document.body.appendChild(ov);
  // alte Leisten ausblenden
  document.querySelector(".tabs").hidden = true;
  const bar = document.querySelector(".bar"); if(bar) bar.hidden = true;
})();

// ---------- Seiten ----------
function go(page){
  if(page === "scanner"){ openScanner(); return; }
  if(document.body.classList.contains("scanmode")) closeScanner(true);
  UI.page = page;
  $("home").hidden = page !== "home"; document.body.classList.toggle("home-on", page === "home");
  if(page === "coll" || page === "wish"){
    showTab("coll");
    const want = page === "wish" ? "wish" : "cards", b = document.querySelector(`[data-cview="${want}"]`);
    if(b && !b.classList.contains("on")) b.click();
    if(page === "coll" && b && b.classList.contains("on") && $("extraView") && !$("extraView").hidden) b.click();
  } else if(page === "search"){
    showTab("scan"); $("scan").classList.add("searchonly");
    setTimeout(() => $("manualInput").focus(), 50);
  } else { $("scan").hidden = true; $("coll").hidden = true; renderHome(); }
  if(page !== "search") $("scan").classList.remove("searchonly");
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("on", b.dataset.go === page));
  window.scrollTo(0, 0);
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-go]"); if(!b) return;
  e.preventDefault(); go(b.dataset.go);
});
$("homeBinder").onclick = () => $("binderBtn").click();
$("homeCenter").onclick = () => $("centerBtn").click();
$("homeGames").onclick = async () => { await chooseGames(); renderHome(); };

// ---------- Startseite ----------
function renderHome(){
  const list = coll.filter(c => !UI.game || gameOf(c) === UI.game);
  const n = list.reduce((s, c) => s + qtyOf(c), 0), v = list.reduce((s, c) => s + totalOf(c), 0);
  const gl = (GAMES.find(g => g[0] === UI.game) || GAMES[0])[1];
  $("gamePill").textContent = `🎴 ${gl} · ${n}`;
  $("homeVal").textContent = UI.hide ? "•••• €" : (v > 0 ? eur(v) : "0,00 €");
  $("eyeBtn").classList.toggle("off", UI.hide);
  // Veränderung: gegenüber dem Einkaufspreis, sonst gegenüber dem ältesten Verlaufswert der letzten 30 Tage
  let chg = "";
  const buy = list.reduce((s, c) => s + buyTotalOf(c), 0);
  if(buy > 0 && !UI.game){ const d = v - buy; chg = `${d >= 0 ? "+" : "−"}${eur(Math.abs(d))} (${d >= 0 ? "+" : "−"}${Math.abs(d / buy * 100).toFixed(0)} %) seit Einkauf`; }
  else if(!UI.game){
    let h = []; try{ h = JSON.parse(localStorage.getItem("cgd-hist") || "[]"); }catch{}
    const old = h.find(x => x.d >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
    if(old && old.v > 0){ const d = v - old.v; chg = `${d >= 0 ? "+" : "−"}${eur(Math.abs(d))} (${d >= 0 ? "+" : "−"}${Math.abs(d / old.v * 100).toFixed(0)} %) seit ${new Date(old.d).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" })}`; }
  }
  $("homeChg").textContent = UI.hide ? "" : chg;
  $("homeChg").className = "hchg " + (/^\+/.test(chg) ? "up" : /^−/.test(chg) ? "down" : "");
  $("homeBuild").hidden = coll.length > 0;
  const recent = [...list].sort((a, b) => b.t - a.t).slice(0, 12);
  $("homeRecent").innerHTML = recent.length ? `<div class="hsub"><b>Zuletzt gescannt</b><button data-go="coll">Alle ›</button></div><div class="hrow">${recent.map(miniCard).join("")}</div>` : "";
}
function miniCard(c){
  const th = safeThumb(c.thumb) || (typeof c.img === "string" && /^https:\/\//.test(c.img) ? c.img : ""), v = valueOf(c);
  const code = c.op ? c.op.id : c.ygo ? c.number : c.jp ? `${c.jp.sid} ${c.jp.lid}` : (typeof cmCode === "function" && cmCode(c)) || c.number || "";
  return `<button class="mini" data-mini="${esc(c.id)}">
    <span class="mi">${th ? `<img src="${th}" alt="">` : `<em>${esc((c.name || "?").slice(0, 1))}</em>`}${qtyOf(c) > 1 ? `<b class="mq">${qtyOf(c)}</b>` : ""}${v > 0 ? `<b class="mp">${eur(v)}</b>` : ""}</span>
    <small>${esc(code)}</small></button>`;
}
$("gamePill").onclick = () => { const i = GAMES.findIndex(g => g[0] === UI.game); UI.game = GAMES[(i + 1) % GAMES.length][0]; uiSave(); renderHome(); };
$("eyeBtn").onclick = () => { UI.hide = !UI.hide; uiSave(); renderHome(); };
// Mini-Karte antippen -> in der Sammlung zeigen
document.addEventListener("click", e => {
  const m = e.target.closest("[data-mini]"); if(!m) return;
  const id = m.dataset.mini, c = coll.find(x => x.id === id); if(!c) return;
  closeScanner(true); go("coll");
  $("search").value = c.name; renderColl();
  setTimeout(() => { const el = document.querySelector(`#collList [data-card="${CSS.escape(id)}"]`); if(el){ el.scrollIntoView({ block: "center" }); const h = el.querySelector("h3"); if(h && el.classList.contains("old")) h.click(); } }, 80);
});

// ---------- Vollbild-Scanner ----------
async function openScanner(){
  UI.scanStart = UI.scanStart || Date.now();
  document.body.classList.add("scanmode");
  $("home").hidden = true; $("coll").hidden = true; showTab("scan");
  $("scanUi").hidden = false;
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("on", b.dataset.go === "scanner"));
  renderScanUi();
  camHelp(false);
  await startCam();
  placeFrame();
  if(!stream) camHelp(true);
}
// Kamera startet nicht: im Scanner deutlich sagen, was zu tun ist (statt schwarzem Bild)
function camHelp(show){
  let el = $("camHelp");
  if(!show){ if(el) el.remove(); return; }
  if(!el){ el = document.createElement("div"); el.id = "camHelp"; $("scanUi").appendChild(el); }
  const denied = CAM_ERR === "NotAllowedError" || CAM_ERR === "SecurityError", wait = CAM_ERR === "TimeoutError", none = CAM_ERR === "NotFoundError" || CAM_ERR === "OverconstrainedError", busy = CAM_ERR === "NotReadableError";
  el.innerHTML = `<b>📷 Kamera startet nicht</b>
    <p>${denied ? "Der Kamerazugriff ist für CardGrab gesperrt. Tippe oben in der Adressleiste auf das Schloss-/Kamera-Symbol (bzw. in der installierten App: Einstellungen → Apps → Browser → Berechtigungen) und erlaube die Kamera."
      : wait ? "Die Kamera-Freigabe wurde nicht bestätigt. Oft erscheint oben ein kleines Fenster oder ein Kamera-Symbol in der Adressleiste – dort „Zulassen“ tippen."
      : none ? "Es wurde keine Kamera gefunden."
      : busy ? "Die Kamera wird gerade von einer anderen App benutzt. Schließe andere Kamera-Apps und versuche es erneut."
      : "Die Kamera konnte nicht gestartet werden."}</p>
    <div><button class="btn primary" id="camRetry">Nochmal versuchen</button><label class="btn secondary" for="photoInput">📸 Foto statt Kamera</label></div>`;
  $("camRetry").onclick = async () => { camHelp(false); await startCam(); placeFrame(); if(!stream) camHelp(true); };
}
function closeScanner(silent){
  if(!document.body.classList.contains("scanmode")) return;
  document.body.classList.remove("scanmode"); $("scanUi").hidden = true;
  if(stream) stopCam();
  if(!silent) go("home");
}
$("scClose").onclick = () => closeScanner();
$("closeCam").addEventListener("click", () => closeScanner(true));
$("scShot").onclick = () => { if(typeof manualShot === "function") manualShot(); };
$("scList").onclick = () => { closeScanner(true); go("coll"); };
$("scBulk").onclick = () => { window.UI_SINGLE = !window.UI_SINGLE; uiSave(); renderScanUi(); toast(window.UI_SINGLE ? "Einzelbild: Foto mit dem Auslöser machen" : "Serie: Karten werden automatisch fotografiert"); };
$("scSound").onclick = () => { const t = $("soundToggle"); if(t) t.click(); renderScanUi(); };
$("scLock").onclick = () => {
  if(UI.lock){ UI.lock = ""; uiSave(); renderScanUi(); toast("Set nicht mehr fixiert"); return; }
  const last = [...coll].sort((a, b) => b.t - a.t)[0];
  const code = last && (last.db && last.db.code || last.set_code || (last.op && last.op.id.split("-")[0]) || (last.ygo && String(last.number || "").split("-")[0]));
  if(!code){ toast("Erst eine Karte scannen – dann wird ihr Set fixiert"); return; }
  UI.lock = code; uiSave(); renderScanUi(); toast(`🔒 Set ${code} fixiert: bei unsicheren Treffern gewinnt dieses Set`);
};
$("scSet").onclick = async () => {
  const v = await pickFrom("Scan-Einstellungen", [
    { v: "games", label: "🎴 Meine Spiele", sub: myGames().map(g => (ALL_GAMES.find(x => x[0] === g) || [, g])[1]).join(", ") },
    { v: "lang", label: "🌍 Sprache der Karten", sub: LANG },
    { v: "cond", label: "🏷️ Zustand für neue Karten", sub: UI.def },
    { v: "zoom", label: "🔍 Zoom", sub: $("zoomWrap").hidden ? "nicht verfügbar" : $("zoomVal").textContent }
  ]);
  if(v === "games") await chooseGames();
  if(v === "lang"){ const l = await pickFrom("Sprache", [["Deutsch", "DE"], ["Englisch", "EN"], ["Japanisch", "JP"]].map(([k, s]) => ({ v: k, label: `${s} · ${k}`, right: k === LANG ? "✓" : "" }))); if(l){ const b = document.querySelector(`#langChips [data-lang="${l}"]`); if(b) b.click(); } }
  if(v === "cond"){ const c = await pickFrom("Zustand für neue Karten", CONDS.map(([k, n]) => ({ v: k, label: `${k} · ${n}`, right: k === UI.def ? "✓" : "" }))); if(c){ UI.def = c; uiSave(); } }
  if(v === "zoom" && !$("zoomWrap").hidden){ $("zoomWrap").classList.toggle("show"); }
  renderScanUi();
};
function renderScanUi(){
  const ses = coll.filter(c => c.t >= UI.scanStart).sort((a, b) => b.t - a.t);
  const n = ses.reduce((s, c) => s + qtyOf(c), 0);
  $("scCnt").hidden = !n; $("scCnt").textContent = n;
  $("scStrip").innerHTML = ses.length ? ses.slice(0, 30).map(miniCard).join("") : `<div class="sempty">Karte in den Rahmen legen – sie erscheint dann hier.</div>`;
  $("scLockT").textContent = UI.lock ? `Set ${UI.lock}` : "Set fixieren"; $("scLock").classList.toggle("on", !!UI.lock);
  $("scBulkT").textContent = window.UI_SINGLE ? "Einzelbild" : "Serie an"; $("scBulk").classList.toggle("on", !window.UI_SINGLE);
  $("scShot").hidden = !window.UI_SINGLE;
  const snd = $("soundToggle"), on = !snd || snd.classList.contains("on");
  $("scSoundT").textContent = on ? "Ton an" : "Ton aus"; $("scSound").classList.toggle("on", on);
  const short = { Deutsch: "DE", Englisch: "EN", Japanisch: "JP" }[LANG] || LANG;
  const gl = myGames(), gtxt = gl.length === ALL_GAMES.length ? "Alle Spiele" : gl.map(g => (ALL_GAMES.find(x => x[0] === g) || [, g])[1]).join(" · ");
  $("scSet").innerHTML = `<i>🎴</i><span><b>${esc(gtxt)}</b><small>${esc(UI.def)} · ${short}${UI.lock ? ` · 🔒 ${esc(UI.lock)}` : ""}</small></span><em>⚙</em>`;
}

// ---------- Eingriffe in die vorhandene Logik ----------
// neue Karten: Standard-Zustand + Kartenleiste/Startseite aktualisieren
const _addCard = addCard;
addCard = function(c, thumb){
  if(c && !c.cond && UI.def && UI.def !== "NM") c.cond = UI.def;
  const r = _addCard.apply(this, arguments);
  setTimeout(() => { if(document.body.classList.contains("scanmode")) renderScanUi(); else if(UI.page === "home") renderHome(); }, 50);
  return r;
};
// fixiertes Set: bei mehreren möglichen Karten gewinnt das fixierte Set
const _candidates = candidates;
candidates = function(r){
  const l = _candidates(r);
  if(UI.lock && l.length > 1){
    const L = UI.lock.toUpperCase();
    const f = l.filter(x => { const c = x.c || {}; return (c.db && String(c.db.code || "").toUpperCase() === L) || String(c.set_code || "").toUpperCase() === L || (c.op && c.op.id.startsWith(L + "-")) || (c.ygo && String(c.number || "").toUpperCase().startsWith(L + "-")); });
    if(f.length) return f;
  }
  return l;
};
// Gesamtwert-Anzeige oben auf der Startseite mitziehen
const _refresh = refreshTotals;
refreshTotals = function(){ const r = _refresh.apply(this, arguments); if(UI.page === "home" && !document.body.classList.contains("scanmode")) renderHome(); return r; };
document.addEventListener("click", e => { if(e.target.closest("#soundToggle") && document.body.classList.contains("scanmode")) setTimeout(renderScanUi, 30); });

// kaputte Bilder in den kleinen Karten ausblenden (ohne Inline-Handler wegen CSP)
document.addEventListener("error", e => { const t = e.target; if(t && t.tagName === "IMG" && t.closest(".mini")) t.classList.add("bad"); }, true);
// beim allerersten Start: Spiele auswählen
setTimeout(() => { try{ if(!navigator.webdriver && !localStorage.getItem("cgd-games") && !localStorage.getItem("cgd-games-asked")){ localStorage.setItem("cgd-games-asked", "1"); chooseGames(); } }catch{} }, 1200);
// Start: Startseite zeigen, sobald die Sammlung geladen ist
go("home");
setTimeout(renderHome, 400); setTimeout(renderHome, 1500);
