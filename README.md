# Hub – Erinnerungen, Kalender, Notizen & iCloud Drive

Persönliche Web-App (PWA) für iPhone/iPad im Apple-Stil. Keine Frameworks, kein Build, kein Server.

## Sicherheit – warum das öffentliche Repo unproblematisch ist
- **Keine Zugangsdaten.** Weder Apple-ID noch App-Passwörter. Der Zugriff läuft über Apple Kurzbefehle direkt auf deinem Gerät.
- **Keine Daten im Repo.** GitHub Pages liefert nur den Code aus. Deine Erinnerungen, Termine, Notizen und Seiten liegen ausschließlich im Speicher des Browsers auf deinem Gerät.
- **Kein Netzwerkverkehr mit deinen Daten.** Eine Content-Security-Policy verbietet Verbindungen zu fremden Servern und fremdes JavaScript.
- **Optional verschlüsselt:** *Anpassen → Mit Passphrase sperren* verschlüsselt den lokalen Speicher mit AES-256-GCM (PBKDF2, 310 000 Iterationen) inkl. Auto-Sperre.
- `noindex` verhindert die Aufnahme in Suchmaschinen.

Lege nie Backups (`hub-backup-*.json`) oder eigene Daten in das Repo.

## Veröffentlichen auf GitHub Pages
1. Neues Repository anlegen, z. B. `hub` (öffentlich reicht).
2. Alle Dateien dieses Ordners hochladen (*Add file → Upload files*, den Inhalt hineinziehen) → *Commit*.
3. *Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)`* → *Save*.
4. Nach ~1 Minute erreichbar unter `https://<dein-name>.github.io/hub/`.

## Auf dem iPhone installieren
1. Die URL in **Safari** öffnen → Teilen → **Zum Home-Bildschirm**.
2. Die zwei Kurzbefehle anlegen: **[SHORTCUTS.md](SHORTCUTS.md)**.
3. Im Hub auf **Aktualisieren ↻** tippen.

Zum Ausprobieren ohne Kurzbefehle: *Anpassen → Demo-Daten*.

## Funktionen
- **Heute**: fällige/überfällige Erinnerungen, nächste Termine, angeheftete Seiten
- **Erinnerungen**: Filter (Heute/Geplant/Alle/Erledigt), Listen, Suche, abhaken, bearbeiten, löschen; Schnell-Eingabe auf Deutsch: `Arzt anrufen morgen 9 Uhr #Privat !!`
- **Kalender**: 7-Tage-Leiste, Agenda, Termine anlegen/löschen, Sprung in die Kalender-App
- **Notizen**: durchsuchen, lesen, neue anlegen, Text anhängen, als Seite übernehmen
- **iCloud Drive**: Dateien im Ordner `Hub`, Vorschau für `.md`/`.txt`, in Seiten bearbeiten
- **Seiten** (Notion-ähnlich): Markdown mit Schreib-/Geteilt-/Lesemodus, Werkzeugleiste, Aufgaben zum Abhaken, `[[Wiki-Links]]`, `#tags`, Emoji-Symbol, Anheften, als `.md` in iCloud Drive oder als Apple Notiz sichern
- **Ausstehende Änderungen**: alles wird gesammelt und mit einem Tipp an Apple gesendet (Badge in der Leiste)
- **Anpassen**: Hell/Dunkel/Auto, Akzentfarbe, Eckenradius, Glas-Unschärfe, Schriftgröße, Dichte, Animationen, Cursor, Bereiche sortieren/ausblenden, Name & App-Name, Kurzbefehl-Namen, Backup Export/Import

## Dateien
```
index.html  styles.css  script.js  markdown.js  boot.js
sw.js (Offline)  manifest.webmanifest  assets/ (Icons)
SHORTCUTS.md  README.md
```
Lokal testen: `python3 -m http.server` im Ordner, dann `http://localhost:8000`. (Verschlüsselung und Offline-Modus brauchen HTTPS bzw. localhost.)

## Updates
Nach Änderungen am Code in `sw.js` die Zeile `const CACHE = 'hub-v1'` hochzählen (`hub-v2` …), damit iPhones die neue Version laden.
