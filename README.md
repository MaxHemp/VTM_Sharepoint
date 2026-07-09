# VTM Teamportal

Ein privates, selbst gehostetes Teamportal („eigenes SharePoint") für kleine Teams — mit Dokumentenverwaltung, News & Ankündigungen, gemeinsamer Aufgabenliste und Team-Kalender.

## Funktionen

- **Anmeldung mit E-Mail + Passwort** — keine Abhängigkeit von Microsoft 365 oder anderen Diensten. Beim ersten Start wird über `/setup` das Administrator-Konto angelegt; danach legt der Admin die Team-Mitglieder unter **Verwaltung** an.
- **Dokumente** — Dateien hochladen, in verschachtelten Ordnern organisieren, herunterladen und löschen. Die Dateien liegen lokal unter `data/uploads/`.
- **News & Ankündigungen** — Startseite mit Team-Neuigkeiten; jedes Mitglied kann posten, löschen dürfen Autor:in und Admins.
- **Aufgaben** — gemeinsame Aufgabenliste mit Zuweisung, Fälligkeitsdatum und Erledigt-Status (überfällige Aufgaben werden markiert).
- **Kalender** — Monatsansicht mit Team-Terminen (Datum, Uhrzeit, Ort, Beschreibung).
- **Verwaltung** (nur Admins) — Mitglieder anlegen, Passwörter zurücksetzen, Mitglieder entfernen.
- **E-Mail-Benachrichtigungen** (optional, via SMTP) — neue Mitglieder erhalten ihre Zugangsdaten per Willkommens-E-Mail; das Team wird über neue Ankündigungen, Dokumente, Aufgaben und Termine benachrichtigt. Konfiguration über `SMTP_*`-Variablen in der `.env` (siehe `.env.example`); ohne Konfiguration werden einfach keine E-Mails gesendet.

## Technik

- [Next.js](https://nextjs.org) (App Router, Server Actions) mit TypeScript und Tailwind CSS
- SQLite über `better-sqlite3` — die Datenbank liegt in `data/vtm.db`, es ist kein separater Datenbankserver nötig
- Sessions als signierte JWT-Cookies (`jose`), Passwörter mit bcrypt gehasht
- Alle Daten (Datenbank, Uploads, Session-Secret) liegen im Ordner `data/` — dieser Ordner ist dein Backup

## Entwicklung starten

```bash
npm install
npm run dev
```

Dann <http://localhost:3000> öffnen. Beim ersten Aufruf wirst du zur Ersteinrichtung (`/setup`) geleitet und legst das Admin-Konto an.

## Produktivbetrieb

```bash
npm install
npm run build
npm start
```

Empfehlungen für den Betrieb im Team:

- Hinter einen Reverse-Proxy mit **HTTPS** legen (z.B. Caddy oder nginx) — die Session-Cookies sind im Produktionsmodus auf `Secure` gesetzt.
- Optional die Umgebungsvariable `AUTH_SECRET` setzen (beliebiger langer Zufallsstring). Ohne sie wird beim ersten Start automatisch ein Secret erzeugt und in `data/auth-secret` gespeichert.
- Den Ordner `data/` regelmäßig sichern.
