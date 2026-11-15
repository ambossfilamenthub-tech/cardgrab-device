# CardGrab Device – so geht die App online (kostenlos)

Die App erkennt Karten direkt auf dem Handy (Kamera + Texterkennung), holt jeden Morgen automatisch
die offizielle Cardmarket-Preisliste und speichert deine Sammlung nur auf deinem Gerät.
Hosting und täglicher Download laufen kostenlos über GitHub.

## Variante A – Claude macht es für dich (am einfachsten)
1. Kostenloses Konto auf https://github.com anlegen.
2. In Claude: Einstellungen → Connectors → **GitHub verbinden**.
3. Claude Bescheid sagen – Claude legt das Projekt an, lädt alles hoch und schaltet die Seite frei.

## Variante B – selbst hochladen (am Computer, ca. 10 Minuten)
1. Auf github.com oben rechts **+ → New repository**, Name z. B. `cardgrab-device`, **Public**, „Create repository“.
2. „uploading an existing file“ anklicken und den **Inhalt** dieses ZIP-Ordners hineinziehen
   (Ordner `site`, `scripts`, `.github` und die Dateien) → „Commit changes“.
   Tipp: Der Ordner `.github` ist versteckt – am Mac mit Cmd+Shift+Punkt einblenden.
3. Im Projekt **Settings → Pages → Source: „GitHub Actions“** wählen.
4. **Actions → „Preise aktualisieren & App veröffentlichen“ → Run workflow**.
   Nach ca. 2 Minuten steht unter Settings → Pages die Adresse, z. B. `https://DEINNAME.github.io/cardgrab-device/`.
5. Ab jetzt läuft der Preis-Download jeden Morgen automatisch (~7:20 Uhr).

## Auf dem Handy installieren
Adresse in Chrome öffnen → Menü ⋮ → **„Zum Startbildschirm hinzufügen“ / „App installieren“**.
Beim ersten Start „Kamera starten“ antippen und die Kamera erlauben.

## Gut zu wissen
- **Preise:** Trend, „ab“ (günstigstes Angebot insgesamt) und 30-Tage-Durchschnitt aus der Cardmarket-Preisliste.
  Diese Liste filtert nicht nach Zustand, Land oder Sprache – der türkise Button öffnet Cardmarket mit
  Near Mint + Verkäufer aus Deutschland + deiner Sprache.
- **One Piece:** Cardmarket führt keine Karten-IDs im Katalog; die App ordnet die Versionen selbst zu.
  Wo das nicht eindeutig ist, steht „Zuordnung geschätzt“.
- **Erkennung:** Karte gerade und hell in den Rahmen halten, Kürzel + Nummer unten im gestrichelten Bereich.
  Ältere Karten ohne Set-Kürzel zeigen eine Auswahl. Klappt es nicht: „🖼️ Foto“ oder manuelle Eingabe.
- **Sammlung:** liegt nur auf diesem Handy. Unter „Sammlung“ regelmäßig „Sicherung speichern“.
- **Cardmarket-Daten:** Die Preisliste stellt Cardmarket öffentlich bereit. Bevor du die App öffentlich
  oder geschäftlich (z. B. im Shop) anbietest, prüfe bitte Cardmarkets Nutzungsbedingungen.
- Falls der tägliche Download einmal fehlschlägt, steht der Grund unter **Actions** im Protokoll.
