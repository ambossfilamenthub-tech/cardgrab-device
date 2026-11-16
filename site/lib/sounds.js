// CardGrab Device – Preis-Sounds beim Scannen
// unter 0,10 €  -> nur der "Bonk – wah wah"-Ton (ohne Stimme)
// ab 10,00 €    -> Kassen-"Ka-Ching" + Stimme "Money, money, money!"
// Die Töne werden im Handy erzeugt (Web Audio) – keine fremden Sounddateien, keine Lizenzfragen.
"use strict";
const SND_KEY = "cgd-sounds";
const SND = { low: 0.10, high: 10 };
const soundsOn = () => { try{ return localStorage.getItem(SND_KEY) !== "0"; }catch{ return true; } };
let AC = null;
const ac = () => { if(!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if(AC.state === "suspended") AC.resume(); return AC; };
// Audio muss einmal durch eine Berührung freigeschaltet werden (iPhone/Android)
document.addEventListener("pointerdown", () => { try{ ac(); }catch{} }, { once: true, capture: true });

function tone(t0, f0, f1, dur, type, vol, ctx, filt){
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t0); if(f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = o;
  if(filt){ const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = filt; o.connect(f); node = f; }
  node.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(t0, dur, vol, ctx, hp){
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate), d = b.getChannelData(0);
  for(let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  f.type = "highpass"; f.frequency.value = hp || 2000; s.buffer = b; g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(ctx.destination); s.start(t0);
}
// "Bonk – wah wah": tiefer, absteigender Brummton
function playDirt(){
  const ctx = ac(), t = ctx.currentTime + 0.02;
  tone(t, 180, 150, 0.28, "sawtooth", 0.42, ctx, 900);
  tone(t + 0.3, 150, 120, 0.28, "sawtooth", 0.42, ctx, 800);
  tone(t + 0.6, 120, 55, 0.7, "sawtooth", 0.48, ctx, 600);
}
// Kasse: Schublade + zwei helle Glöckchen
function playCash(){
  const ctx = ac(), t = ctx.currentTime + 0.02;
  noise(t, 0.12, 0.4, ctx, 1500);
  tone(t + 0.1, 2093, 2093, 0.45, "triangle", 0.45, ctx);
  tone(t + 0.1, 4186, 4186, 0.3, "sine", 0.08, ctx);
  tone(t + 0.22, 2637, 2637, 0.9, "triangle", 0.5, ctx);
  tone(t + 0.22, 5274, 5274, 0.5, "sine", 0.08, ctx);
}
function shout(text, lang, rate, pitch){
  if(!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang; u.rate = rate; u.pitch = pitch; u.volume = 1;
  const v = speechSynthesis.getVoices().find(x => x.lang && x.lang.toLowerCase().startsWith(lang.slice(0, 2)));
  if(v) u.voice = v;
  speechSynthesis.speak(u);
}
function priceSound(value){
  if(!soundsOn() || !(value > 0)) return;
  try{
    if(value < SND.low){ playDirt(); }
    else if(value >= SND.high){ playCash(); setTimeout(() => shout("Money, money, money!", "en-US", 1.05, 1.15), 700); }
  }catch(e){ console.warn(e); }
}
function soundToggleLabel(){ return soundsOn() ? "🔔 Sounds an" : "🔕 Sounds aus"; }
document.addEventListener("click", e => {
  const b = e.target.closest("#soundToggle"); if(!b) return;
  try{ localStorage.setItem(SND_KEY, soundsOn() ? "0" : "1"); }catch{}
  b.textContent = soundToggleLabel(); b.classList.toggle("on", soundsOn());
  if(soundsOn()){ playCash(); }
});
document.addEventListener("DOMContentLoaded", () => { const b = document.getElementById("soundToggle"); if(b){ b.textContent = soundToggleLabel(); b.classList.toggle("on", soundsOn()); } });
