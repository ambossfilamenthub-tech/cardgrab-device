# CardGrab Device – alle Kartentexte ins Deutsche
# 1) Pokémon: in site/facts/*.json sind nur-englische Texte mit \u0001 markiert → übersetzen
# 2) One Piece: Effekt/Trigger aus site/opdb.json → site/op-de.json { code: [effekt, trigger] }
# Übersetzung offline mit Argos (OPUS-MT en→de, CTranslate2). Fertige Übersetzungen
# landen im Cache data/tr-de.json, damit täglich nur neue Texte übersetzt werden.
import glob, json, os, re, sys, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
CACHE = os.path.join(ROOT, "data", "tr-de.json")
MODEL_URL = "https://argos-net.com/v1/translate-en_de-1_3.argosmodel"
STUB = "--stub" in sys.argv

cache = json.load(open(CACHE, encoding="utf8")) if os.path.exists(CACHE) else {}

# One-Piece-Schlüsselwörter (in eckigen Klammern) direkt übersetzen
OP_KW = {
    "On Play": "Beim Ausspielen", "When Attacking": "Beim Angreifen", "Activate: Main": "Aktivieren: Hauptphase",
    "Main": "Hauptphase", "Once Per Turn": "Einmal pro Zug", "Your Turn": "Dein Zug",
    "Opponent's Turn": "Gegnerischer Zug", "On K.O.": "Bei K.O.", "On Block": "Beim Blocken",
    "End of Your Turn": "Ende deines Zuges", "On Your Opponent's Attack": "Beim gegnerischen Angriff",
    "Counter": "Konter", "Trigger": "Trigger", "Blocker": "Blocker", "Rush": "Eile",
    "Double Attack": "Doppelangriff", "Banish": "Verbannen", "Rush: Character": "Eile: Charakter",
}
def kw(k):
    k = k.strip()
    if k in OP_KW: return OP_KW[k]
    m = re.match(r"DON!!\s*[x×]\s*(\d+)$", k)
    if m: return f"DON!! x{m.group(1)}"
    return k

def load_model():
    import ctranslate2, sentencepiece
    d = "/tmp/argos-ende"
    if not os.path.isdir(d):
        z = "/tmp/ende.argosmodel"
        urllib.request.urlretrieve(MODEL_URL, z)
        zipfile.ZipFile(z).extractall(d)
    mdir = next(os.path.dirname(p) for p in glob.glob(d + "/**/model.bin", recursive=True))
    spm = next(iter(glob.glob(d + "/**/sentencepiece.model", recursive=True)))
    tr = ctranslate2.Translator(mdir, device="cpu", compute_type="int8", inter_threads=2, intra_threads=2)
    sp = sentencepiece.SentencePieceProcessor(model_file=spm)
    return tr, sp

SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\"'])")
def translate_all(texts):
    todo = sorted({t for t in texts if t and t not in cache})
    if not todo: return
    print(f"Übersetze {len(todo)} neue Texte …", flush=True)
    if STUB:
        for t in todo: cache[t] = "[DE] " + t
        return
    tr, sp = load_model()
    # in Sätze zerlegen, Sätze gebündelt übersetzen
    sents = sorted({s for t in todo for s in SENT.split(t) if s.strip()})
    out = {}
    B = 64
    for i in range(0, len(sents), B):
        chunk = sents[i:i + B]
        toks = [sp.encode(s, out_type=str) for s in chunk]
        res = tr.translate_batch(toks, beam_size=2, max_decoding_length=256)
        for s, r in zip(chunk, res):
            out[s] = sp.decode(r.hypotheses[0]).replace("▁", " ").strip()
        if i % (B * 20) == 0: print(f"  {i}/{len(sents)}", flush=True)
    for t in todo:
        cache[t] = " ".join(out.get(s, s) for s in SENT.split(t) if s.strip())

def fix_de(t):
    # kleine Korrekturen typischer Übersetzungsfehler
    return (t.replace("Pokemon", "Pokémon").replace("Pokémons", "Pokémon")
             .replace("KO'd", "K.O.").replace("Knocked Out", "kampfunfähig"))

# ---------- One Piece: Text in Schlüsselwörter und Fließtext zerlegen ----------
def op_pieces(t):
    t = t.replace("DON!!", "DON‼")  # schützen
    return [p for p in re.split(r"(\[[^\]]+\])", t) if p]

def op_plain(p):
    return p.replace("DON‼", "DON!!").strip(" :")

# ---------- Sammeln ----------
facts_files = sorted(glob.glob(os.path.join(SITE, "facts", "*.json")))
facts = {f: json.load(open(f, encoding="utf8")) for f in facts_files}
need = set()
def walk(x, fn):
    if isinstance(x, str): return fn(x)
    if isinstance(x, list): return [walk(y, fn) for y in x]
    if isinstance(x, dict): return {k: walk(v, fn) for k, v in x.items()}
    return x
for d in facts.values():
    walk(d, lambda s: (need.add(s[1:]) if s.startswith("\u0001") else None, s)[1])

opdb_p = os.path.join(SITE, "opdb.json")
opdb = json.load(open(opdb_p, encoding="utf8"))["c"] if os.path.exists(opdb_p) else {}
for v in opdb.values():
    for t in (v[8], v[9]):
        if not t: continue
        for p in op_pieces(t):
            if not p.startswith("["):
                q = op_plain(p)
                if re.search(r"[A-Za-z]{2}", q): need.add(q)

try:
    translate_all(need)
except Exception as ex:
    print("⚠ Übersetzung nicht möglich:", ex)

os.makedirs(os.path.dirname(CACHE), exist_ok=True)
json.dump(cache, open(CACHE, "w", encoding="utf8"), ensure_ascii=False, indent=0, sort_keys=True)

# ---------- Schreiben ----------
miss = 0
def rep(s):
    global miss
    if not s.startswith("\u0001"): return s
    en = s[1:]
    if en in cache: return fix_de(cache[en])
    miss += 1; return s
for f, d in facts.items():
    json.dump(walk(d, rep), open(f, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))

def op_de(t):
    if not t: return ""
    out = []
    for p in op_pieces(t):
        if p.startswith("["):
            out.append("[" + kw(p[1:-1].replace("DON‼", "DON!!")) + "]")
        else:
            q = op_plain(p)
            if not q: continue
            lead = ": " if p.lstrip().startswith(":") else " "
            out.append(lead + fix_de(cache.get(q, q)) if re.search(r"[A-Za-z]{2}", q) else lead + q)
    return re.sub(r"\s+", " ", "".join(out)).replace("] :", "]:").strip()

opde = {code: [op_de(v[8]), op_de(v[9])] for code, v in opdb.items() if v[8] or v[9]}
json.dump(opde, open(os.path.join(SITE, "op-de.json"), "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
print(f"✔ Deutsch: {len(cache)} Übersetzungen im Cache, {len(opde)} One-Piece-Karten, {miss} Pokémon-Texte noch englisch")
