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

CV = "2"  # erhöhen, wenn sich die Vorverarbeitung ändert → alles neu übersetzen
cache = json.load(open(CACHE, encoding="utf8")) if os.path.exists(CACHE) else {}
if cache.get("_v") != CV: cache = {"_v": CV}

# One-Piece-Schlüsselwörter (in eckigen Klammern) direkt übersetzen
OP_KW = {
    "On Play": "Beim Ausspielen", "When Attacking": "Beim Angreifen", "Activate: Main": "Aktivieren: Hauptphase",
    "Main": "Hauptphase", "Once Per Turn": "Einmal pro Zug", "Your Turn": "Dein Zug",
    "Opponent's Turn": "Gegnerischer Zug", "On K.O.": "Bei K.O.", "On Block": "Beim Blocken",
    "End of Your Turn": "Ende deines Zuges", "On Your Opponent's Attack": "Beim gegnerischen Angriff",
    "Counter": "Konter", "Trigger": "Trigger", "Blocker": "Blocker", "Rush": "Eile",
    "Double Attack": "Doppelangriff", "Unblockable": "Unblockbar", "Banish": "Verbannen", "Rush: Character": "Eile: Charakter",
}
def kw(k):
    k = k.strip()
    if k in OP_KW: return OP_KW[k]
    m = re.match(r"DON!!\s*[x×]\s*(\d+)$", k)
    if m: return f"DON!! x{m.group(1)}"
    return k

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"}
def load_argos():
    d = "/tmp/argos-ende"
    if not os.path.isdir(d):
        z = "/tmp/ende.argosmodel"
        with urllib.request.urlopen(urllib.request.Request(MODEL_URL, headers=UA), timeout=300) as r, open(z, "wb") as f:
            f.write(r.read())
        zipfile.ZipFile(z).extractall(d)
    mdir = next(os.path.dirname(p) for p in glob.glob(d + "/**/model.bin", recursive=True))
    spm = next(iter(glob.glob(d + "/**/sentencepiece.model", recursive=True)))
    return mdir, spm, spm

def load_marian():
    # Ersatz: OPUS-MT en→de von Hugging Face, einmalig nach CTranslate2 umgewandelt
    import subprocess
    d = "/tmp/opus-ende-ct2"
    if not os.path.isdir(d):
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "torch", "--index-url", "https://download.pytorch.org/whl/cpu"], check=True)
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "transformers", "sacremoses", "huggingface_hub"], check=True)
        subprocess.run(["ct2-transformers-converter", "--model", "Helsinki-NLP/opus-mt-en-de", "--output_dir", d, "--quantization", "int8"], check=True)
        from huggingface_hub import hf_hub_download
        for n in ("source.spm", "target.spm"):
            import shutil; shutil.copy(hf_hub_download("Helsinki-NLP/opus-mt-en-de", n), os.path.join(d, n))
    return d, os.path.join(d, "source.spm"), os.path.join(d, "target.spm")

def load_model():
    import ctranslate2, sentencepiece
    try:
        mdir, s_spm, t_spm = load_argos(); kind = "argos"
    except Exception as ex:
        print("Argos-Modell nicht ladbar (", ex, ") → OPUS-MT", flush=True)
        mdir, s_spm, t_spm = load_marian(); kind = "marian"
    tr = ctranslate2.Translator(mdir, device="cpu", compute_type="int8", inter_threads=2, intra_threads=2)
    return tr, sentencepiece.SentencePieceProcessor(model_file=s_spm), sentencepiece.SentencePieceProcessor(model_file=t_spm), kind

PRE = [(r"\{([^}]+)\} type (card|Character|Event|Stage)s?", r'\2 with the type "\1"'),
       (r"take an extra turn after this one", "take another turn after this turn"),
       (r"\bFlip a coin\b", "Toss a coin"), (r"\bIf heads\b", "If the coin shows heads"), (r"\bIf tails\b", "If the coin shows tails")]
def pre_en(t):
    for a, b in PRE: t = re.sub(a, b, t)
    return t

SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\"'])")
def translate_all(texts):
    todo = sorted({t for t in texts if t and t not in cache})
    if not todo: return
    print(f"Übersetze {len(todo)} neue Texte …", flush=True)
    if STUB:
        for t in todo: cache[t] = "[DE] " + t
        return
    tr, sp, tp, kind = load_model()
    print("Modell:", kind, flush=True)
    # in Sätze zerlegen, Sätze gebündelt übersetzen
    sents = sorted({s for t in todo for s in SENT.split(pre_en(t)) if s.strip()})
    out = {}
    B = 64
    for i in range(0, len(sents), B):
        chunk = sents[i:i + B]
        toks = [sp.encode(s, out_type=str) + (["</s>"] if kind == "marian" else []) for s in chunk]
        res = tr.translate_batch(toks, beam_size=2, max_decoding_length=256)
        for s, r in zip(chunk, res):
            out[s] = tp.decode([x for x in r.hypotheses[0] if x not in ("</s>", "<pad>")]).replace("▁", " ").strip()
        if i % (B * 20) == 0: print(f"  {i}/{len(sents)}", flush=True)
    for t in todo:
        cache[t] = " ".join(out.get(s, s) for s in SENT.split(pre_en(t)) if s.strip())

IMP = {"Geben": "Gib", "Nehmen": "Nimm", "Sehen": "Sieh", "Werfen": "Wirf", "Helfen": "Hilf", "Treffen": "Triff",
       "Vergessen": "Vergiss", "Lesen": "Lies", "Seien": "Sei", "Haben": "Hab", "Werden": "Werde"}
def du_form(t):
    # Übersetzer siezt oft → Kartensprache duzt
    t = t.replace("DON!!", "DON§")
    t = re.sub(r"\b([A-ZÄÖÜ][a-zäöüß]+)en Sie sich\b", lambda m: m.group(1) + "e dir", t)
    t = re.sub(r"\b([A-ZÄÖÜ][a-zäöüß]+)en Sie\b", lambda m: IMP.get(m.group(1) + "en", m.group(1) + "e"), t)
    t = re.sub(r"\b([a-zäöüß]+)en Sie\b(?! sich)", lambda m: IMP.get(m.group(1).capitalize() + "en", m.group(1) + "e").lower() if m.group(1) not in ("können", "dürfen", "müssen") else m.group(0), t)
    rep = [(r"\bSie können\b", "du kannst"), (r"\bkönnen Sie\b", "kannst du"), (r"\bSie dürfen\b", "du darfst"), (r"\bdürfen Sie\b", "darfst du"),
           (r"\bSie müssen\b", "du musst"), (r"\bmüssen Sie\b", "musst du"), (r"\bSie haben\b", "du hast"), (r"\bhaben Sie\b", "hast du"),
           (r"\bSie sind\b", "du bist"), (r"\bIhnen\b", "dir"), (r"\bIhrem\b", "deinem"), (r"\bIhren\b", "deinen"), (r"\bIhrer\b", "deiner"),
           (r"\bIhres\b", "deines"), (r"\bIhre\b", "deine"), (r"\bIhr\b", "dein"), (r"\bSie sich\b", "dich"), (r"\bsich selbst\b", "dich selbst")]
    for a, b in rep: t = re.sub(a, b, t)
    t = re.sub(r"(^|[.!?:]\s+)([a-zäöü])", lambda m: m.group(1) + m.group(2).upper(), t)
    return t.replace("DON§", "DON!!")

def fix_de(t):
    # kleine Korrekturen typischer Übersetzungsfehler
    t = du_form(t)
    t = re.sub(r"\bHP\b", "KP", t)
    for a, b in [("Pokemon", "Pokémon"), ("Pokémons", "Pokémon"), ("KO'd", "K.O."), ("Knocked Out", "kampfunfähig"),
                 ("am Boden deines Decks", "unter dein Deck"), ("auf den Boden deines Decks", "unter dein Deck"), ("am Boden des Decks", "unter das Deck"),
                 ("von der Oberseite deines Decks", "oben von deinem Deck"), ("ausgeruhte", "ruhende"), ("ausgeruht", "ruhend"),
                 ("DON!! Karte", "DON!!-Karte"), ("Flip eine Münze", "Wirf eine Münze"), ("Wenn Köpfe", "Bei Kopf"), ("Wenn Schwänze", "Bei Zahl"),
                 ("Köpfe", "Kopf"), ("Schwänze", "Zahl"), ("ausklopfst", "kampfunfähig machst"), ("ausgeklopft", "kampfunfähig"),
                 ("Schadenszähler", "Schadensmarken"), ("angehängt", "angelegt"), ("anhängen", "anlegen"), ("anbringen", "anlegen"),
                 ("Wasserenergie", "Wasser-Energie"), ("Feuerenergie", "Feuer-Energie"), ("Grasenergie", "Pflanzen-Energie"),
                 ("Blitzenergie", "Elektro-Energie"), ("Psychische Energie", "Psycho-Energie"), ("Kampfenergie", "Kampf-Energie"),
                 ("Dunkelenergie", "Finsternis-Energie"), ("Metallenergie", "Metall-Energie"), ("Farblose Energie", "Farblos-Energie"),
                 ("Schadenszählern", "Schadensmarken"), ("Bank Pokémon", "Bank-Pokémon"), ("Preiskarte nehmen", "Preiskarte ziehen")]:
        t = t.replace(a, b)
    return t

# ---------- One Piece: Text in Schlüsselwörter und Fließtext zerlegen ----------
def op_pieces(t):
    t = t.replace("DON!!", "DON‼")  # schützen
    # [Name] einer Karte bleibt im Satz (in Anführungszeichen), damit der Satz am Stück übersetzt wird
    t = re.sub(r"\[([^\]]+)\]", lambda m: m.group(0) if (m.group(1).strip() in OP_KW or re.match(r"DON‼\s*[x×]", m.group(1)) or ":" in m.group(1)) else '"' + m.group(1) + '"', t)
    return [p for p in re.split(r"(\[[^\]]+\]|DON‼\s*[−-]\s*\d+|[➀-➉①-⑩])", t) if p]

def is_lit(p):
    return p.startswith("[") or re.match(r"^(DON‼\s*[−-]\s*\d+|[➀-➉①-⑩])$", p)

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
            if not is_lit(p):
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
            out.append(("" if not out or out[-1].endswith(("]", " ")) else " ") + "[" + kw(p[1:-1].replace("DON‼", "DON!!")) + "]")
        elif is_lit(p):
            out.append(" " + p.replace("DON‼", "DON!!"))
        else:
            q = op_plain(p)
            if not q: continue
            lead = ": " if p.lstrip().startswith(":") else (" " if not p[:1].isspace() and out and out[-1].endswith("]") else " ")
            out.append(lead + fix_de(cache.get(q, q)) if re.search(r"[A-Za-z]{2}", q) else lead + q)
    return re.sub(r"\s+", " ", "".join(out)).replace("] :", "]:").strip()

opde = {code: [op_de(v[8]), op_de(v[9])] for code, v in opdb.items() if v[8] or v[9]}
json.dump(opde, open(os.path.join(SITE, "op-de.json"), "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
print(f"✔ Deutsch: {len(cache)} Übersetzungen im Cache, {len(opde)} One-Piece-Karten, {miss} Pokémon-Texte noch englisch")
