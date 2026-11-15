# CardGrab in den Google Play Store bringen

Die App ist eine Web-App (PWA). Für den Play Store wird sie in eine kleine Android-Hülle
(„Trusted Web Activity“) verpackt. Code muss dafür nicht neu geschrieben werden.

## Was du brauchst
1. **Google-Play-Entwicklerkonto** – einmalig 25 US-$, Anmeldung unter play.google.com/console
   (für private Konten verlangt Google eine Identitätsprüfung und einen Test mit 12 Testern über 14 Tage).
2. **Eine eigene Domain ist empfohlen** (z. B. cardgrab.de). Grund: Android prüft über die Datei
   `/.well-known/assetlinks.json` im *Hauptverzeichnis* der Domain, dass App und Webseite zusammengehören.
   Bei `ambossfilamenthub-tech.github.io/cardgrab-device/` liegt das Hauptverzeichnis im Repo
   `ambossfilamenthub-tech.github.io` – das müsste dafür extra angelegt werden. Ohne diese Datei zeigt die
   App oben eine Adressleiste.

## Paket erzeugen (ohne Programmieren)
1. https://www.pwabuilder.com öffnen, die App-Adresse eingeben, „Package for stores“ → **Android**.
2. Package-ID z. B. `de.cardgrab.app`, App-Name „CardGrab“. Signaturschlüssel von PWABuilder erzeugen lassen
   und die heruntergeladene ZIP **gut aufbewahren** (ohne den Schlüssel keine Updates möglich!).
3. In der ZIP liegt `assetlinks.json` → muss unter `https://<deine-domain>/.well-known/assetlinks.json` erreichbar sein.
4. Die `.aab`-Datei in der Play Console hochladen.

## Was für den Store-Eintrag fertig ist
- Icons 192/512 px, Name, Beschreibung, Kategorien und zwei Screenshots stehen im `manifest.webmanifest`.
- Datenschutzerklärung: `legal.html` (Link im Store angeben).
- Datensicherheits-Formular: Die App sammelt **keine** Daten; Kamera wird nur auf dem Gerät genutzt.

## Achtung Rechtliches
- Marken „Pokémon“, „One Piece“, „Yu-Gi-Oh!“ und „Cardmarket“ nicht im App-Namen oder Icon verwenden
  (nur beschreibend im Text, z. B. „für Sammelkarten wie …“). Google lehnt Apps mit fremden Marken im Namen oft ab.
- Am besten erst die Antwort von Cardmarket abwarten.
