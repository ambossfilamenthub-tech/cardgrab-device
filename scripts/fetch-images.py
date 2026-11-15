# CardGrab Device – kleine Kartenbilder selbst speichern (One Piece + Yu-Gi-Oh!)
# Lädt fehlende Bilder einmalig, verkleinert sie auf 150 px Breite (WebP) und legt sie in site/img/ ab.
# Bereits vorhandene Bilder werden nicht erneut geladen. Pro Lauf höchstens LIMIT neue Bilder (Rücksicht auf die Quellen).
#   site/img/op/<ID>[_pN]_<EN|JP>.webp   Quelle: Limitless TCG
#   site/img/ygo/<Passcode>.webp         Quelle: YGOPRODeck (bittet ausdrücklich darum, Bilder selbst zu speichern)
import io, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
LIMIT = int(os.environ.get("IMG_LIMIT", "7000"))
UA = {"User-Agent": "CardGrab-Device/1.0 (thumbnail cache; github.com/ambossfilamenthub-tech/cardgrab-device)"}
LIM = "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/one-piece/"
YGO = "https://images.ygoprodeck.com/images/cards_small/"

jobs = []
op_p = os.path.join(SITE, "opdb.json")
if os.path.exists(op_p):
    op = json.load(open(op_p, encoding="utf8"))["c"]
    for code, e in op.items():
        st = code.split("-")[0] if "-" in code else "P"
        if code.startswith("P-"): st = "P"
        sufs = {""} | {v[0] for v in (e[12] or []) if v and v[0]}
        for suf in sorted(sufs):
            name = f"{code}{'_' + suf if suf else ''}_EN"
            jobs.append((os.path.join(SITE, "img", "op", name + ".webp"), f"{LIM}{st}/{name}.webp"))
        if e[13]:
            jobs.append((os.path.join(SITE, "img", "op", f"{code}_JP.webp"), f"{LIM}{st}/{code}_JP.webp"))
y_p = os.path.join(SITE, "ygodb.json")
if os.path.exists(y_p):
    yg = json.load(open(y_p, encoding="utf8"))["c"]
    for pc in yg.keys():
        jobs.append((os.path.join(SITE, "img", "ygo", f"{pc}.webp"), f"{YGO}{pc}.jpg"))

miss_f = os.path.join(ROOT, "data", "img-missing.json")
missing = set(json.load(open(miss_f))) if os.path.exists(miss_f) else set()
todo = [j for j in jobs if not os.path.exists(j[0]) and j[1] not in missing][:LIMIT]
print(f"Bilder: {len(jobs)} bekannt, {len(jobs) - len([j for j in jobs if not os.path.exists(j[0])])} vorhanden, lade jetzt {len(todo)}", flush=True)
for d in ("op", "ygo"): os.makedirs(os.path.join(SITE, "img", d), exist_ok=True)

def get(job):
    path, url = job
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                im = Image.open(io.BytesIO(r.read())).convert("RGB")
            w = 150; h = round(im.height * w / im.width)
            im.resize((w, h), Image.LANCZOS).save(path, "WEBP", quality=72, method=5)
            return "ok"
        except urllib.error.HTTPError as ex:
            if ex.code in (403, 404): return "missing"
            time.sleep(2 + i * 3)
        except Exception:
            time.sleep(2 + i * 3)
    return "error"

ok = miss = err = 0
with ThreadPoolExecutor(max_workers=6) as ex:
    for i, (job, res) in enumerate(zip(todo, ex.map(get, todo))):
        if res == "ok": ok += 1
        elif res == "missing": miss += 1; missing.add(job[1])
        else: err += 1
        if i % 1000 == 999: print(f"  {i + 1}/{len(todo)}", flush=True)
os.makedirs(os.path.dirname(miss_f), exist_ok=True)
json.dump(sorted(missing), open(miss_f, "w"))
print(f"✔ Bilder: {ok} neu, {miss} gibt es nicht, {err} Fehler (nächster Lauf versucht es erneut)")
