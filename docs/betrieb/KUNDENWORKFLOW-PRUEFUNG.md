# Verifizierter Stand am 11. November 2026

## Ergebnis

Implementierung auf `feature/operations-center` für den bestehenden Draft-PR 11.
Kein Merge und kein Deployment. Keine echten Kundenakten, Zugänge, Postfächer oder Veröffentlichungen wurden verändert.

Lokal verifiziert mit Node 24.22.1:

- 15 bestehende Betriebszentrale-Tests bestanden.
- 24 neue Workflow-Tests bestanden, einschließlich vollständiger fiktiver Kette, Kundentrennung, Quellenablauf, exakter Freigaben, Doppelverarbeitung, konkurrierender Datenbankverbindungen, verspäteter Ergebnisse und SQLite-Backup/Restore.
- 30 Adaptertests bestanden, einschließlich SMTP/Ghost, Zielbindung, Journal-Fencing, Widerruf während asynchroner Vorprüfung und lesendem Abgleich.
- HTTP-Integration gegen eine ausschließlich fiktive lokale Datenbank bestanden: Authentifizierung, Origin, Größenbegrenzung, Schema, Agentenrechte, alle Produktionsrollen, Max-/Kundenfreigabe, alte Versionen, tatsächliches serverseitiges Freigabeformular und idempotente Wiederholung.
- ESLint, TypeScript, Produktionsbuild und `git diff --check` bestanden.
- Worker-Tick ohne Auslieferungsaktivierung ausgeführt: Lebenszeichen und Portalbericht gespeichert, keine externe Aktion angefordert.

## Im Review gefundene und behobene Fälle

1. Gleiche Fassung nach kompletter Neuprüfung durfte keine zweite identische Outbox erzeugen. Bereits nachweislich ungesendeter Eintrag wird mit neuen Freigaben wiederverwendet.
2. Ein altes asynchrones Versandresultat durfte keinen späteren Versuch abschließen. Kern und Providerjournal besitzen Versuchs-/Generationsprüfung.
3. Ein ungeklärter SMTP-Beleg durfte späteren Ghost-Abgleich nicht dauerhaft blockieren. Abgleich ist nach letzter Prüfung geordnet.
4. Stopp, Quellenwiderruf oder geänderte Freigaben während Ghost-Vorabfragen durften keine spätere Mutation zulassen. Prüfung erfolgt direkt vor jedem Schreibschritt.
5. SMTP-Absender und Ghost-Ursprung sind an die geprüfte Fassung gebunden, nicht nur der Nachrichteninhalt.
6. Vom Inhaber bestätigte Nichtausführung wird kontrolliert in beide Journale übernommen. Wiederholte alte Belege können keinen neueren Versuch zurücksetzen.
7. SMTP-Annahme bleibt `accepted`; sie wird nicht als Zustellung oder abgeschlossener Kundenauftrag ausgegeben.

## Nicht verifiziert / nicht aktiviert

- Browser-Sichtprüfung und mobiles Layout: Chromium konnte im Ausführungs-Sandbox keine benötigten lokalen Sockets anlegen. Auch der geprüfte zusätzliche Versuch startete den Browser nicht. SSR und echte HTTP-Formularaktionen wurden geprüft, aber das ersetzt keine visuelle Prüfung.
- Windows-/DPAPI-Client auf Windows: hier nicht ausführbar.
- Docker-Image-Build auf dem tatsächlichen Node-22-Host: nicht ausgeführt; lokaler Next-Produktionsbuild bestand.
- Wiederherstellung der echten Datenbank einschließlich Live-Uploads und Session-Secret: ausstehend.
- Neue Kundenzugriffe, echte Agentenweckung, Postfach-Polling, Zeitplaninstallation und aktive Berichtszustellung: nicht eingerichtet.
- Positiver Live-SMTP-/Ghost-Durchlauf: nicht erfolgt. Dafür fehlen verifizierter Serverzugriff, freigegebene konkrete Ziele/Identitäten und eine ausdrücklich genehmigte Testaktion.

Die lokale fiktive Ende-zu-Ende-Prüfung ist **kein Beleg eines laufenden Live-E2E-Betriebs**.
