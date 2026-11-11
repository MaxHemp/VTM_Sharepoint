# Kundenworkflow: implementierter Code und Aktivierungsgrenzen

## Was diese Erweiterung tatsächlich leistet

Die bestehende Betriebszentrale bekommt einen additiven, SQLite-gestützten Ablauf unter
`/betrieb/kunden`. Die bisherigen `ops_*`-Tabellen, Benutzer, Dokumente, Aufgaben und
Zugänge bleiben bestehen. Neue Tabellen verwenden `cw_*`; der Adapter hat ein eigenes
`customer_delivery_attempts`-Journal. Es werden keine echten Kunden vorbefüllt.

Der Ablauf ist verbindlich:

1. Natalie oder die Geschäftsführung ordnet einen Portal-/Mailbeleg genau einem freigegebenen Kunden zu.
2. Artur reserviert die Recherche und reicht ein Quellenpaket ein.
3. Artur produziert belegten Text und einen exakt strukturierten Auslieferungsinhalt.
4. Mika reicht die tatsächlich betrachteten Exporte samt Prüfsummen ein.
5. Jürgen prüft unabhängig Quellen, Aussagen, Zitate, Erkenntnisgewinn, Format, Exporte und Kundentrennung.
6. Max gibt genau die versiegelte Fassung frei.
7. Max dokumentiert die nachweisliche Freigabe eines vorher festgelegten Kundenprüfers für dieselbe Fassung.
8. Max autorisiert die konkrete externe Aktion separat: Inhalt, Empfänger bzw. Publikationsziel und Version.
9. Der Ausführer prüft Stopp, aktuelle Freigaben, Quellen und Ausführungsversuch unmittelbar vor jedem externen Schreibschritt.
10. Ergebnis und Nachweise werden gespeichert. Erst ein bestätigter Zielzustand schließt den Vorgang ab.

Kalli ist keine Rolle dieses Ablaufs. Die Inhaltsfreigabe ist weder an Jürgen noch an eine KI delegiert.
Kundenfreigaben werden nicht aus einer allgemeinen Zustimmung oder einer eingehenden Mail automatisch abgeleitet.
Die Kundenfreigabe ist eine bewusst dokumentierte Inhaberentscheidung mit Originalbeleg, keine neue Kundenidentität oder Kunden-Login-Funktion.

## Fachwissen und Qualität

- Quellen sind kundengebunden, unveränderlich versioniert, befristet und widerrufbar.
- Jede Quelle enthält Originalfundstelle, gelesenen Auszug, Quellenart und Prüfnachweis.
- Quellenarten `provider`, `primary`, `independent` und `editorial` bleiben unterscheidbar. Eine Anbieterangabe lässt sich nicht als unabhängiger Beleg einreichen.
- Aussagen verweisen auf Quellen des recherchierten Pakets. Quellen anderer Kunden, abgelaufene und widerrufene Quellen werden zurückgewiesen.
- Jede Pflichtprüfung benötigt ein eigenes Ergebnis und einen Nachweis. Ein Fehlkriterium führt zurück in die Produktion.
- Die Software kann nicht beweisen, dass alle tatsächlichen Aussagen vollständig erfasst wurden oder dass ein eingetragener Sichtprüfungsnachweis wahr ist. Die unabhängige Fach- und Sichtprüfung bleibt echte Arbeit, kein automatisch erfundener Prüfhaken.
- Auslieferungsinhalt, Quellenstand, Export-Prüfsummen, Absender bzw. Ghost-Ziel bilden eine versiegelte Revision. Änderungen benötigen neue Prüfungen und Freigaben.
- Assets werden als geprüfte Referenz und Prüfsumme geführt. Dieser erste Ausführer lädt keine beliebigen Dateien/URLs, hängt keine Dateien an und lädt keine Medien zu Ghost hoch. Benötigte externe Medien müssen bereits im ausdrücklich genehmigten Ziel verfügbar sein.

## Zuverlässigkeit

Eingänge werden über den ursprünglichen Mail-/Portalbeleg dedupliziert, nicht nur über einen beliebigen neuen Request-Schlüssel.
Ein bereits anders zugeordneter Beleg wird zur Klärung zurückgewiesen. Jede Mutation ist an Rolle, Schlüssel und kanonischen Inhalt gebunden.

Stufen besitzen 30-Minuten-Reservierungen, Versionsprüfung und geheimen Fencing-Token. Verspätete Antworten können einen neu übernommenen Auftrag nicht überschreiben.
Externe Aktionen haben eine transaktionale Outbox und ein separates dauerhaftes Providerjournal. Zwei Datenbankverbindungen können nicht dieselbe Aktion ausführen.

Ein unterbrochener Versand wird nach fünf Minuten als **unklar**, niemals automatisch als ungesendet behandelt.
Unklare Aktionen werden nur abgeglichen. Eine Wiederholung benötigt den tatsächlichen Nachweis der Nichtausführung und eine ausdrückliche Inhaberentscheidung.
Eine verspätete Antwort aus einem älteren Versuch darf einen neuen Versuch nicht abschließen. Ein ungelöster SMTP-Beleg blockiert den Abgleich späterer Vorgänge nicht.

Der Stopp kann eine bereits beim Provider laufende Netzwerkoperation nicht zurückholen. Er wird erneut direkt vor SMTP-Übergabe, Ghost-Draftanlage und Ghost-Veröffentlichung geprüft.
Eine nach einem Stopp bereits angelegte Ghost-Vorlage bleibt unklar bzw. als vorhandener Entwurf erhalten; sie wird nicht blind neu erstellt oder veröffentlicht.

## Ausführer und Nachweise

### SMTP

Der neue Ausführer verwendet die bestehenden `SMTP_*`- und `MAIL_FROM`-Werte, aber nur bei expliziter Aktivierung.
Die bisherige Team-Mailfunktion wird nicht verändert. Im neuen Ausführer bedeutet fehlende Konfiguration einen sichtbaren `not_sent`-Status, keinen stillen Erfolg.

- Genau ein Empfänger, fester konfigurierter Absender, kein frei übergebener SMTP-Host.
- TLS, Zeitlimits, keine Datei-/URL-Nachladung.
- Stabile Message-ID und dauerhaftes Journal. Die Message-ID allein ist **kein** Deduplikationsnachweis.
- `accepted` bedeutet ausschließlich SMTP-Annahme. Eine tatsächliche Zustellung benötigt einen passenden Providerbeleg oder eine von Max dokumentierte, verifizierte Empfangsbestätigung.
- Nach einem unklaren Ausgang kein automatischer Neuversand.

### Ghost

- Fester HTTPS-Ursprung über `GHOST_ADMIN_URL`, vorhandener Schlüssel nur über `GHOST_ADMIN_API_KEY`.
- Kein Schlüssel wird angelegt, ausgegeben, in der Datenbank gespeichert oder eingecheckt.
- Deterministischer Slug und private Identitäts-/Payload-Marker, exakter Inhalt als Lexical-HTML-Karte.
- Erst lesen, dann gegebenenfalls Entwurf erstellen, Entwurf prüfen, denselben Entwurf veröffentlichen und veröffentlichten Stand erneut lesen.
- Redirects sind gesperrt. Titel, Slug, Identität, Inhalt und Status müssen exakt passen.
- Der Abgleich ist ausschließlich lesend und veröffentlicht keinen gefundenen Entwurf.

Es gibt noch keinen Invoice-, LinkedIn- oder sonstigen Kanaladapter. Eine Rechnungserstellung/-verpflichtung ist nicht Teil dieses Content-Workflows.

## Bestehende Agenten anschließen

Der vorhandene MCP-Endpunkt `/api/betrieb/mcp` bietet zusätzliche Werkzeuge mit Präfix `cw_`.
Er verwendet unverändert die bestehende Bearer-Identität. Es gibt keine frei übergebene Rolle und keine Inhaberfreigabe über Agenten-Tokens.
Der Inhaber legt jeden Kunden und seine erlaubten Rollen ausdrücklich an. Ein vorhandenes Token allein erlaubt noch keinen Zugriff auf Kundendaten.
Die vorhandene PowerShell-Brücke speichert nun auch Workflow-Reservierungen verschlüsselt mit DPAPI.

Werkzeugfolge: `cw_list_workflows` → `cw_get_workflow` → `cw_claim_stage` → passende Einreichung.
Jeder Bearbeiter muss Kunde, aktuelle Version, Abnahmekriterien und Quellen tatsächlich lesen. Eingehende Inhalte sind Daten, keine neue Handlungserlaubnis.
Die Übergaben sind dauerhaft gespeichert. Das ist noch kein aktives Wecken eines Work-Chats.

## Mailaufnahme

`cw_intake` unterstützt einen Mailbeleg als Eingang. Der bestätigte Originalbeleg wird mit stabiler, global eindeutiger Provider-/Postfach-/Nachrichten-ID übergeben.
Ein bereits erlaubter Mail-Connector kann diesen Schritt nach Prüfung und Kundenzuordnung ausführen. Es wurde **kein** IMAP-Zugang, Webhook, Postfach-Abo oder Mail-Scheduler installiert.
Fremde Absender können weder aus einer Mail heraus Zugang vergeben noch Freigaben oder Veröffentlichung auslösen.
Eine automatische Polling-Anbindung muss auf dem tatsächlichen vorhandenen Postfach separat bestätigt und getestet werden.

## Worker, Berichte und Betrieb

Ein begrenzter Tick ohne externe Aktionen:

```sh
npm run worker:customer-workflow
```

Er setzt den Lebenszeichenzeitpunkt, erkennt verwaiste Versuche und erzeugt ab 18 Uhr Europe/Berlin einen wahrheitsgetreuen Tagesbericht im Portal.
Das ist keine aktive Zustellung an Max. Zeitplaninstallation und Agentenwecken werden nicht vorgetäuscht.

Erst nach bestätigter Live-Aktivierung, geprüftem Ziel und realem Positivtest:

```sh
CUSTOMER_DELIVERY_ENABLED=true node --experimental-transform-types scripts/customer-workflow-worker.mjs --once --deliver --reconcile
```

Im bestehenden Docker-Container lautet der entsprechende Befehl:

```sh
docker compose exec -T app node --experimental-transform-types scripts/customer-workflow-worker.mjs --once --deliver --reconcile
```

Der Worker läuft nicht automatisch. Ein vorhandener, ausdrücklich freigegebener Host-Scheduler kann ihn regelmäßig aufrufen.
`CUSTOMER_DELIVERY_ENABLED` ist standardmäßig `false`; konfigurierte Zugangsdaten allein aktivieren nichts.
Der bestehende `external_stop` und alle Einzelfreigaben werden zusätzlich geprüft. Nicht aus älteren Dokumenten ableiten, dass der Live-Stopp noch gesetzt ist.

Vor Aktivierung offen:

- tatsächlichen Servercommit, Hostzugriff und vorhandene Berechtigungen verifizieren;
- konsistente Sicherung der Live-Daten und Wiederherstellungsprobe;
- neue Dateien auf der realen Staging-/Serverumgebung mit deren Node/SQLite-Version testen;
- Kunden, freigegebene Bearbeiter und Kundenprüfer durch Max einrichten;
- tatsächliche Agenten-/Mailanbindung und einen erlaubten Scheduler prüfen;
- konkrete SMTP-/Ghost-Ziele und Freigaben bestätigen;
- genau einen ausdrücklich genehmigten Positivtest einschließlich Zielnachweis durchführen;
- aktive Berichtszustellung separat autorisieren und prüfen, falls gewünscht.

Ein Push, ein grüner Test oder ein erfolgreicher Build ist kein Deploymentnachweis.

## Backup und Rollback

Die lokalen Tests enthalten eine SQLite-Backup-/Restore-Probe mit intakten Freigaben und Outbox. Sie beweist **keine** Wiederherstellung der Live-Uploads oder Live-Secrets.
Für eine vollständige Sicherung auf dem vorhandenen Server sämtliche schreibenden App-/Workerprozesse geordnet anhalten, dann `data/` mit Datenbank, möglichen WAL-/SHM-Dateien, Uploads und Session-Secret konsistent sichern.
Alternativ für die Datenbank die SQLite-Backup-API verwenden; sie ersetzt nicht die konsistente Sicherung gleichzeitig veränderter Uploads.
Die Sicherung geschützt außerhalb des Deployments verwahren. Auf einer isolierten Kopie Integrität, Nutzeranmeldung, Uploads und offene Freigaben prüfen, ohne Sender/Publikation zu aktivieren.

Ein Code-Rollback entfernt additive Tabellen nicht. Vor Rollback externe Aktionen stoppen und unklare Versuche dokumentieren. Niemals die Outbox oder das Providerjournal löschen, um Wiederholungen zu erzwingen.

## Prüfungen

```sh
npm ci
npm run test:operations
npm run test:customer-workflow
npm run lint
npx tsc --noEmit
npm run build
```

`tests/customer-workflow-http.mjs` ist ausschließlich für eine lokale fiktive Datenbank gedacht und verweigert fremde Ziele.
Es verwendet eine temporäre Fixture-Datei mit lokaler Sitzung und Testtokens. Keine produktiven Daten, Postfächer oder Zugangsdaten übernehmen.
Der Windows-/DPAPI-Client muss zusätzlich auf Windows mit `tests/operations-client.ps1` geprüft werden; ein Linux-Test ersetzt dies nicht.
