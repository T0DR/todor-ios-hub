# Kurzbefehle einrichten

Der Hub spricht nicht direkt mit iCloud (Apple bietet dafür keine Web-API). Stattdessen ruft er zwei Kurzbefehle auf deinem iPhone auf. Diese greifen lokal auf Erinnerungen, Kalender, Notizen und Dateien zu. **Es werden keine Passwörter benötigt oder gespeichert.**

| Kurzbefehl | Aufgabe | Eingabe | Ausgabe |
|---|---|---|---|
| **Hub Sync** | Daten lesen | – | JSON |
| **Hub Write** | Änderungen ausführen, danach *Hub Sync* starten | JSON | JSON |

> Aktionsnamen unten auf Deutsch, in Klammern Englisch. Je nach iOS-Version können sie leicht abweichen – über die Suche in der Kurzbefehle-App findest du sie trotzdem.
> Einmalig in **Einstellungen → Kurzbefehle → Erweitert**: „Freigabe großer Datenmengen erlauben“ aktivieren, falls iOS beim ersten Lauf nachfragt.

Lege in **iCloud Drive** einen Ordner `Hub` an (Name in der App unter *Anpassen → iCloud-Ordner* änderbar).

---

## 1 · Hub Sync

Neuer Kurzbefehl, Name exakt **Hub Sync**.

### A) Erinnerungen
1. **Erinnerungen suchen** (Find Reminders) – Filter: *Ist erledigt* ist *nicht* aktiviert (optional, sonst alle) · Sortieren: Fälligkeitsdatum · Limit: 300
2. **Wiederholen mit jedem** (Repeat with Each) – darin:
   1. **Datum formatieren** (Format Date) – Datum: *Wiederholungsobjekt → Fälligkeitsdatum*, Format: **ISO 8601**, Zeit einschließen: an
   2. **Wörterbuch** (Dictionary) mit den Schlüsseln (alle als *Text*):
      - `title` → Wiederholungsobjekt → Titel
      - `list` → Wiederholungsobjekt → Liste
      - `due` → *Formatiertes Datum*
      - `done` → Wiederholungsobjekt → Ist erledigt
      - `notes` → Wiederholungsobjekt → Notizen
      - `priority` → Wiederholungsobjekt → Priorität
   3. **Zu Variable hinzufügen** (Add to Variable) – Variable: `R`
3. Ende Wiederholen
4. **Text kombinieren** (Combine Text) – `R`, Trennzeichen: *Eigenes* `,` → danach **Variable festlegen** `RJ`

### B) Kalender
5. **Kalenderereignisse suchen** (Find Calendar Events) – Filter: *Startdatum* liegt in den nächsten **30 Tagen** (und optional „ist heute“ inkludieren) · Sortieren: Startdatum · Limit: 300
6. **Wiederholen mit jedem** – darin:
   1. **Datum formatieren** – Startdatum, ISO 8601 → umbenennen in `S`
   2. **Datum formatieren** – Enddatum, ISO 8601 → `E`
   3. **Wörterbuch**: `title` → Titel · `start` → S · `end` → E · `allDay` → Ist ganztägig · `calendar` → Kalender · `location` → Ort · `notes` → Notizen
   4. **Zu Variable hinzufügen** `V`
7. Ende · **Text kombinieren** `V` mit `,` → Variable `VJ`

### C) Notizen
8. **Notizen suchen** (Find Notes) – Sortieren: Änderungsdatum, Neueste zuerst · Limit: 50
9. **Wiederholen mit jedem**:
   1. **Datum formatieren** – Änderungsdatum, ISO 8601
   2. **Wörterbuch**: `title` → Name · `body` → Textkörper (Body) · `folder` → Ordner · `modified` → Formatiertes Datum
   3. **Zu Variable hinzufügen** `N`
10. Ende · **Text kombinieren** `N` mit `,` → Variable `NJ`

### D) iCloud Drive
11. **Ordnerinhalt abrufen** (Get Contents of Folder) – Ordner: *iCloud Drive/Hub*
12. **Wiederholen mit jedem**:
    1. **Datum formatieren** – Änderungsdatum, ISO 8601
    2. **Wenn** (If) *Wiederholungsobjekt → Dateierweiterung* **ist** `md` (für `txt` eine zweite Bedingung oder separater Zweig)
       - **Text aus Eingabe abrufen** (Get Text from Input) – Wiederholungsobjekt
       - **Variable festlegen** `T`
    3. **Sonst** → **Text** (leer) → **Variable festlegen** `T`
    4. Ende Wenn
    5. **Wörterbuch**: `name` → Name · `ext` → Dateierweiterung · `size` → Dateigröße · `modified` → Formatiertes Datum · `text` → T
    6. **Zu Variable hinzufügen** `F`
13. Ende · **Text kombinieren** `F` mit `,` → Variable `FJ`

### E) Ausgabe
14. **Datum formatieren** – *Aktuelles Datum*, ISO 8601 → `NOW`
15. **Text** (exakt so, Variablen einsetzen):
    ```
    {"ts":"NOW","reminders":[RJ],"events":[VJ],"notes":[NJ],"files":[FJ]}
    ```
16. **In Zwischenablage kopieren** (Copy to Clipboard) – Text
17. **Ausgabe stoppen** (Stop and Output) – Text

**Test:** Kurzbefehl einmal direkt in der Kurzbefehle-App ausführen und alle Datenschutz-Abfragen erlauben (Erinnerungen, Kalender, Notizen, Dateien). Danach im Hub unter *Anpassen → Manuell einfügen* die Zwischenablage einfügen.

> Ein Wörterbuch wird beim Kombinieren automatisch als JSON-Text ausgegeben – Anführungszeichen in Titeln werden dabei korrekt maskiert.

---

## 2 · Hub Write

Neuer Kurzbefehl, Name exakt **Hub Write**. Unter *Details* „Eingabe erhalten von: **Kurzbefehle / Text**“ (bzw. „Kurzbefehleingabe“) zulassen.

Der Hub sendet:
```json
{ "folder": "Hub", "ops": [
  { "type": "reminder.add", "title": "Milch kaufen", "list": "Einkauf", "due": "2026-11-07 18:00", "notes": "", "priority": 1 },
  { "type": "reminder.update", "match": { "title": "Alt", "list": "Privat" }, "title": "Neu", "done": true, "due": "2026-11-08 09:00" },
  { "type": "reminder.delete", "match": { "title": "Weg", "list": "Privat" } },
  { "type": "event.add", "title": "Termin", "start": "2026-11-07 14:00", "end": "2026-11-07 15:00", "allDay": false, "calendar": "Arbeit", "location": "", "notes": "" },
  { "type": "event.delete", "match": { "title": "Termin", "start": "2026-11-07 14:00" } },
  { "type": "note.create", "title": "Idee", "body": "Text" },
  { "type": "note.append", "match": { "title": "Idee" }, "text": "Noch mehr" },
  { "type": "file.save", "name": "Wochenplan.md", "text": "# Wochenplan …" }
]}
```

### Aufbau
1. **Wörterbuch aus Eingabe abrufen** (Get Dictionary from Input) – Kurzbefehleingabe
2. **Wörterbuchwert abrufen** – Schlüssel `ops`
3. **Wiederholen mit jedem** – darin:
   1. **Wörterbuchwert abrufen** `type` aus *Wiederholungsobjekt* → Variable `TYPE`
   2. **Wenn** `TYPE` ist `reminder.add`
      - **Neue Erinnerung hinzufügen** (Add New Reminder): Titel → Wert `title`, Liste → Wert `list` (leer = Standard), Erinnern/Fällig → Wert `due`, Notizen → `notes`, Priorität → `priority`
   3. **Wenn** `TYPE` ist `reminder.update`
      - **Erinnerungen suchen** – Titel *ist* `match.title` (Wert `match` holen, daraus `title`), Limit 1
      - **Erinnerung bearbeiten** / **Details der Erinnerung festlegen** (Edit Reminder): *Ist erledigt* → Wert `done`; analog Titel, Fälligkeitsdatum, Notizen, falls vorhanden
   4. **Wenn** `TYPE` ist `reminder.delete` → **Erinnerungen suchen** (wie oben) → **Erinnerungen entfernen** (Remove Reminders)
   5. **Wenn** `TYPE` ist `event.add` → **Neues Ereignis hinzufügen** (Add New Event): Titel, Start, Ende, Ganztägig, Kalender, Ort, Notizen aus den Werten
   6. **Wenn** `TYPE` ist `event.delete` → **Kalenderereignisse suchen** – Titel ist `match.title`, Startdatum ist `match.start` → **Ereignisse entfernen** (Remove Events)
   7. **Wenn** `TYPE` ist `note.create` → **Text**: `title` + Zeilenumbruch + `body` → **Notiz erstellen** (Create Note)
   8. **Wenn** `TYPE` ist `note.append` → **Notizen suchen** – Name ist `match.title`, Limit 1 → **An Notiz anhängen** (Append to Note) – Text `text`
   9. **Wenn** `TYPE` ist `file.save` → **Text** `text` → **Datei sichern** (Save File): *Fragen, wo gesichert werden soll* **aus**, Pfad `iCloud Drive/Hub/` + Wert `name`, **Überschreiben: an**
4. Ende Wiederholen
5. **Kurzbefehl ausführen** (Run Shortcut) – **Hub Sync**
6. **Ausgabe stoppen** – *Kurzbefehlergebnis*

> Bei „Entfernen“-Aktionen fragt iOS zur Sicherheit nach. Das ist gewollt; in den Aktionsdetails kannst du die Bestätigung abschalten.

---

## Rückweg in den Hub

| Modus (Anpassen → Rückweg) | Ablauf |
|---|---|
| **Link** (in Safari) | Kurzbefehl öffnet nach dem Lauf automatisch den Hub mit den Daten. |
| **Zwischenablage** (Home-Bildschirm-App) | Nach dem Lauf oben links auf „◀ Hub“ tippen → Hinweis „Daten übernehmen“ antippen. iOS fragt einmal „Einfügen erlauben?“. |
| **Auto** | Home-Bildschirm-App → Zwischenablage, Safari → Link. |

Warum zwei Modi: iOS öffnet Rückkehr-Links immer in Safari, nicht in der Home-Bildschirm-App.

## Bekannte Grenzen (Apple-seitig)
- Erinnerungen und Termine werden über **Titel (+ Liste/Start)** wiedergefunden. Zwei Einträge mit gleichem Titel in derselben Liste können verwechselt werden.
- Apple Notizen: Anlegen und Anhängen ja, bestehenden Text ersetzen kann Kurzbefehle nicht. Formatierungen kommen als reiner Text.
- Untergeordnete Erinnerungen, Tags und Anhänge sind in Kurzbefehlen nur teilweise verfügbar.
