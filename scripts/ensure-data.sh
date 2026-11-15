#!/usr/bin/env bash
# Fehlende/kaputte erzeugte Daten von der Live-Seite übernehmen (falls eine Quelle heute ausgefallen ist)
set -u
LIVE="https://ambossfilamenthub-tech.github.io/cardgrab-device"
cd site
ok_json(){ [ -s "$1" ] && node -e "JSON.parse(require('fs').readFileSync('$1','utf8'))" 2>/dev/null; }
for f in ygodb.json op-de.json; do
  if ! ok_json "$f"; then echo "↺ $f fehlt – nehme Live-Version"; curl -fsSL "$LIVE/$f" -o "$f" || echo "⚠ $f auch live nicht verfügbar"; fi
done
need_dir(){ # Ordner, Mindestanzahl
  local d="$1" min="$2" n=0
  [ -d "$d" ] && n=$(ls "$d"/*.json 2>/dev/null | wc -l)
  if [ "$n" -lt "$min" ]; then
    echo "↺ $d hat nur $n Dateien – hole Live-Version"
    mkdir -p "$d"
    curl -fsSL "$LIVE/data-manifest.json" -o /tmp/manifest.json || { echo "⚠ keine Live-Liste"; return; }
    node -e "const m=require('/tmp/manifest.json'); for(const f of (m['$d']||[])) console.log(f)" | while read -r f; do curl -fsSL "$LIVE/$d/$f" -o "$d/$f" || true; done
  fi
}
need_dir facts 150
need_dir ygotext 30
exit 0
