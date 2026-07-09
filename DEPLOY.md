# Teamportal auf einem eigenen Server (VPS) betreiben

Diese Anleitung bringt das Portal unter einer eigenen Adresse wie
**`https://portal.eure-domain.de`** online — mit automatischem HTTPS.
Dauer: ca. 30 Minuten. Kosten: ab ca. 4–5 €/Monat für den Server.

## 1. Server mieten

Bei einem Anbieter wie [Hetzner Cloud](https://www.hetzner.com/cloud) (empfohlen,
Rechenzentren in Deutschland), Netcup, IONOS o.ä. einen kleinen Server bestellen:

- Kleinstes Modell reicht (z.B. Hetzner CX22: 2 vCPU, 4 GB RAM)
- Betriebssystem: **Ubuntu 24.04**
- Beim Anlegen euren SSH-Key hinterlegen (oder Passwort per E-Mail erhalten)

Nach dem Anlegen bekommt ihr eine **IP-Adresse**, z.B. `203.0.113.10`.

## 2. Domain verbinden

Im DNS eurer Domain (beim Domain-Anbieter) einen **A-Record** anlegen:

| Typ | Name     | Wert (IP des Servers) |
|-----|----------|-----------------------|
| A   | `portal` | `203.0.113.10`        |

Damit zeigt `portal.eure-domain.de` auf den Server. (Keine Domain? Eine .de-Domain
kostet ~1 €/Monat, z.B. bei INWX, Netcup oder IONOS.)

## 3. Server einrichten

Per SSH verbinden und Docker installieren:

```bash
ssh root@203.0.113.10

# Docker installieren
curl -fsSL https://get.docker.com | sh

# Projekt holen
git clone https://github.com/MaxHemp/VTM_Sharepoint.git
cd VTM_Sharepoint

# Domain eintragen
cp .env.example .env
nano .env        # DOMAIN=portal.eure-domain.de setzen, speichern mit Strg+O, Enter, Strg+X
```

## 4. Starten

```bash
docker compose up -d --build
```

Der erste Build dauert ein paar Minuten. Danach ist das Portal unter
**`https://portal.eure-domain.de`** erreichbar — Caddy besorgt das
HTTPS-Zertifikat (Let's Encrypt) automatisch.

## 5. Ersteinrichtung

1. `https://portal.eure-domain.de` im Browser öffnen → ihr landet auf der
   **Ersteinrichtung** und legt das Administrator-Konto an.
2. Unter **Verwaltung** die Team-Mitglieder anlegen (Name, E-Mail, Startpasswort)
   und ihnen den Link + Startpasswort persönlich mitteilen.

Fertig — euer Team meldet sich ab jetzt einfach unter dem Link an.

## Betrieb

**Backup** — alle Daten (Datenbank, Uploads, Session-Secret) liegen im Ordner
`data/` neben der `docker-compose.yml`:

```bash
tar czf backup-$(date +%F).tar.gz data/
```

Diesen Befehl z.B. per Cronjob täglich ausführen und die Archive woandershin kopieren.

**Update einspielen** (nach Änderungen am Code):

```bash
cd VTM_Sharepoint
git pull
docker compose up -d --build
```

**Logs ansehen:**

```bash
docker compose logs -f app
```

## Hinweise

- Ohne eigene Domain könnt ihr zum Testen `DOMAIN=localhost` lassen und den
  Dienst unter `https://<server-ip>` mit selbstsigniertem Zertifikat aufrufen —
  für den Team-Betrieb aber bitte eine echte Domain verwenden.
- Optional könnt ihr in der `.env` zusätzlich `AUTH_SECRET=<langer Zufallsstring>`
  setzen und in der `docker-compose.yml` unter `app.environment` durchreichen;
  ohne diese Variable erzeugt die App beim ersten Start automatisch ein Secret
  in `data/auth-secret`.
- Firewall: Nur die Ports 22 (SSH), 80 und 443 müssen offen sein. Bei Hetzner
  lässt sich das direkt in der Cloud-Konsole als Firewall-Regel anlegen.
