# Betriebszentrale – isolierter Pilot

## Implementiert

- `/betrieb`: ausschließlich für das bestehende Administrator-Konto, dessen E-Mail in `OPS_OWNER_EMAIL` steht. Ohne diese Konfiguration kein Inhaberzugriff. Andere Teamfunktionen bleiben unverändert.
- Eigene additive `ops_*`-Tabellen in derselben SQLite-Datenbank. Bestehende Aufgaben und Dokumente werden nicht migriert oder verändert. Tabellen werden idempotent beim ersten Zugriff angelegt.
- Aufträge, zuständiger Agent, Abhängigkeiten, Abnahmekriterien, optionale Frist, Zustandsversion und Ergebnis. Atomare Reservierung für 30 Minuten, Verlängerung, Rückmeldung, Korrektur, Abschluss und Abbruch.
- Kaufmännische Vorgänge und neue Initiativen beginnen in `waiting_approval`. Nur der Inhaber kann zustimmen, ablehnen oder abgelehnte Vorgänge wieder freigeben. Spezialisten können keine Inhaberrechte übergeben oder übernehmen.
- Jede Änderung und ihr Protokolleintrag werden gemeinsam in einer SQLite-Transaktion gespeichert. Wiederholungsschlüssel sind an Identität und Inhalt gebunden.
- Stopp für Übernahme und Reservierungsverlängerung externer Aufträge, standardmäßig eingeschaltet. Rückmeldungen können auch nach einem Stopp noch gesichert werden.
- `/api/betrieb/mcp`: authentifizierter, zustandsloser MCP-HTTP-Endpunkt mit JSON-Antworten, Initialisierung, Werkzeugliste und Werkzeugaufrufen. Kein SSE; GET liefert 405. Keine frei übergebene Akteursidentität.
- Agentenzugänge mit zufälligem Token; Datenbank speichert nur SHA-256-Fingerabdruck. Ablaufzeit und Rotation; keine Inhaber-Tokens über diese Schnittstelle.
- Tagesbericht im Portal mit Fälligkeit täglich ab 18:00 Europe/Berlin, auch am Wochenende. Ablage und Lesebestätigung des Inhabers sind getrennt.

## Bewusst noch nicht aktiviert

Es gibt keine Ausführer für SMTP, Ghost, Rechnungsstellung oder Work-Chats. Ein freigegebener Auftrag ist kein Beleg einer ausgeführten externen Aktion. Der Tagesbericht wird noch nicht automatisch erzeugt oder aktiv zugestellt. Ein lokal provisionierter Token beweist keine Verbindung zu einem echten Work-Chat.

Die Auftragsart ist momentan eine explizite Klassifizierung. Ein falsch als „E-Mail“ eingestufter kaufmännischer Inhalt wird nicht semantisch erkannt. Vor externer Aktivierung müssen strukturierte Aktionen, Inhalt/Freigabe-Bindung, Versand-/Publikationsnachweise und Abgleich bei unklarem Ausgang ergänzt und getestet werden. Der Stopp kann bereits laufende externe Prozesse nicht zurückholen; Ausführer müssen direkt vor einem externen Effekt erneut Mandat und Stopp prüfen. Diese Ausführer sind noch nicht vorhanden.

Die ursprünglichen Agenten bleiben unverändert. Rollenprofile im Unterordner sind vorbereitete Anweisungen, keine installierten Skills und keine Änderung vorhandener Automationen.

## Lokal prüfen

Voraussetzung: Node mit Unterstützung für `--experimental-transform-types` (mit Node 22 auf dem Server und Node 24 lokal geprüft), installierte Projektabhängigkeiten und die native `better-sqlite3`-Bibliothek.

```text
npm ci
npm run test:operations
npm run lint
npm run build
```

Den Server für lokale Versuche ausschließlich an `127.0.0.1` binden. `OPS_OWNER_EMAIL` muss zur E-Mail eines lokal vorhandenen Admin-Kontos passen, `APP_URL` zur lokalen URL. Keine produktive Datenbank oder SMTP-Konfiguration in die Pilotkopie übernehmen.

Der HTTP-Probelauf `node tests/operations-http.mjs` ist absichtlich auf localhost begrenzt. Er erwartet einen über die UI angelegten Auftrag mit dem Titel `PILOT · Fiktiven Artikel aufbereiten`, Rolle `artur`, Art `article`, sowie lokal provisionierte Testzugänge für `artur` und `juergen`. Er verarbeitet den Auftrag und legt einen ausdrücklich als Test gekennzeichneten Bericht ab. Er darf nicht gegen echte Postfächer oder Ghost gerichtet werden.

## GitHub und Server

Der geprüfte Hauptzweig enthält keinen GitHub-Actions-Workflow. Die gelesenen GitHub-Metadaten lieferten keine Workflows und keine Deployments. Das Repository dokumentiert einen selbst gehosteten Docker/Caddy-Betrieb mit manuellem `git pull` und Neubau. Ein Push oder PR ist daher kein bestätigtes Live-Deployment; externe Hosting-Webhooks sind damit nicht ausgeschlossen.

Vor Deployment: aktuellen Serverstand bestimmen und eine konsistente Sicherung von `data/` einschließlich SQLite/WAL, Uploads und Session-Secret anlegen. Keine Testdatenbank oder lokalen Secret-Dateien hochladen. Erst auf einer separaten Umgebung prüfen. Rollback des Codes entfernt die zusätzlichen Tabellen nicht; Daten bleiben im Backup bzw. Datenverzeichnis erhalten.

Auf dem Server `OPS_OWNER_EMAIL` auf die tatsächliche E-Mail des Inhabers setzen und über Compose weitergeben. Die Rolle `admin` allein genügt nicht. Keine neuen Benutzer notwendig.

## Agentenzugänge provisionieren

Nach freigegebener technischer Einrichtung im richtigen Datenverzeichnis:

```text
node --experimental-transform-types scripts/operations-token.mjs juergen
```

Der Befehl rotiert den Zugang dieser Rolle, speichert das Geheimnis nur in `data/agent-juergen.secret` und gibt es nicht im Terminal aus. 30 Tage Gültigkeit. Die Datei ist wie ein Passwort zu behandeln, nicht in Chat, Git oder PR kopieren. Der aktuelle Stand speichert sie lokal im Datenvolume; vor Produktivbetrieb sind die Dateirechte entsprechend der tatsächlichen Serverumgebung zu kontrollieren.

Im vorgesehenen autorisierten Client wird der Token als `Authorization: Bearer …` für den MCP-Endpunkt hinterlegt. Die konkrete Client-Anbindung muss separat abgenommen werden; Kompatibilität mit Cloud-Chat-Verbindungen oder OAuth ist nicht getestet. Vorliegend sind nur lokale HTTP-Tests belegt.

## Noch erforderliche Abnahmen

1. Hosting-/Deployment-Verbindung und Inhaberidentität verifizieren.
2. Mandatsprofil für Jürgen installieren und tatsächliche Werkzeuge im vorgesehenen Chat prüfen.
3. Registrierung und sichere Zuordnung weiterer Agenten ergänzen; aktuell vier feste Rollen.
4. Bedarfswecken und Ergebnissicherung mit den echten bestehenden Chats prüfen, ohne externe Aktionen auszulösen.
5. Automatische tägliche Berichterstellung und aktive Zustellung samt Ausfallanzeige einrichten.
6. Strukturierte externe Aktionen mit bindender Freigabe, Nachweisen, Wiederholungsabgleich und Widerruf implementieren.
7. Erst danach Mailaufnahme und ausdrücklich genehmigten Produktivbetrieb aktivieren.

## Verbindung lokaler Work-Chats (vorbereitet)

Der Client `scripts/invoke-vtm-agent.ps1` verwendet die bestehende Windows-/PowerShell-Umgebung der lokalen Work-Chats. Es wird keine OpenAI-Inferenz-API, kein API-Key und kein zusätzlicher Workflow-Dienst benötigt. Der Client ist ein explizites Shell-Werkzeug; er wird durch diese Datei nicht automatisch als native MCP-Werkzeugliste in einen Chat geladen.

Der Inhaber kann im Portal für jede feste Agentenrolle einen 30-Tage-Zugang herunterladen. Der POST-Endpunkt `/api/betrieb/zugang` verlangt eine gültige Inhabersitzung, gleiche Origin und ausdrückliche 30-Tage-Bestätigung. Er rotiert bestehende Rollenzugänge. Der Download enthält einen vertraulichen Token und wird mit no-store ausgeliefert. Keine Agentenrolle darf ihn aufrufen.

Vor dem tatsächlichen Anlegen und Anschließen der Zugänge muss die erforderliche Bestätigung neuer sicherheitsrelevanter Zugriffsrechte vorliegen. Die bereitgestellte Schaltfläche erzeugt allein noch keine Zugänge.

Import: `connect-vtm-agent.ps1 -CredentialFile <Download> -Role <Rolle> -Destination <Agentenarbeitsordner>/work/vtm-agent-access/access.json`. Der Import prüft Rolle, fest vorgegebene HTTPS-Adresse und Ablaufdatum, verschlüsselt den Token mit Windows DPAPI und entfernt ausschließlich den erfolgreich importierten Klartextdownload. Keine Token im Chat oder in Befehlsargumenten verwenden.

Aufruf: `invoke-vtm-agent.ps1 -CredentialPath <Datei> -Action list_jobs`. Änderungen erhalten `-ArgumentsFile <JSON-Datei>` mit den Feldern aus `lib/operations-tools.ts`, einschließlich stabiler request_key. Reservierungsschlüssel werden lokal verschlüsselt gespeichert, nicht ausgegeben und bei Rückmeldungen automatisch ergänzt. Keine automatischen Wiederholungen; bei unklarem Ausgang Auftrag lesen und denselben request_key verwenden. Netzwerk- und Betriebssystemfreigaben bleiben wirksam.

Windows DPAPI schützt die Dateien unter dem Windows-Benutzerkonto. Da die lokalen Chats denselben Betriebssystembenutzer verwenden, ist dies keine harte Isolation gegenüber böswilligen lokalen Prozessen oder anderen Chats mit beliebigem Dateizugriff unter diesem Konto. Die Portal-Schnittstelle erzwingt jeweils die Rolle des verwendeten Tokens. Dateien und Profile müssen dem vorgesehenen Agenten zugeordnet bleiben; für stärkere Isolation sind getrennte OS-Identitäten oder eine laufzeitgebundene Credential-Vermittlung erforderlich.

Die tägliche Berichtsautomatik und das Anpassen bestehender Stundenläufe sind weiterhin gesonderte Einrichtungsschritte. Ein erfolgreicher Ping ist kein vollständiger Delegationsnachweis: nötig ist ein echter Chat-Auftrag mit zentraler Reservierung, tatsächlichem Artefakt, Rückmeldung und Abnahme.

Prüfung: `tests/operations-client.ps1` testet DPAPI-Import, Geheimnisschutz, Zielbindung und Reservierungswiederverwendung ohne Netzwerk mit fiktiven Daten. `tests/operations-enrollment.mjs` prüft ausschließlich gegen localhost mit der lokalen fiktiven Pilotdatenbank die Inhaberanmeldung, Origin, Rollen, vertraulichen Download und Widerruf durch Rotation. Beide sind keine Nachweise einer aktiven Produktivverbindung.

