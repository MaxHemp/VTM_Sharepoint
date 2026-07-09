#!/usr/bin/env bash
# Einmal-Setup für das VTM Teamportal auf einem frischen Ubuntu-Server.
#
# Aufruf (Repo öffentlich):
#   curl -fsSL https://raw.githubusercontent.com/MaxHemp/VTM_Sharepoint/main/setup-server.sh | bash
#
# Aufruf (Repo privat, mit GitHub-Token):
#   curl -fsSL -H "Authorization: Bearer <TOKEN>" \
#     https://raw.githubusercontent.com/MaxHemp/VTM_Sharepoint/main/setup-server.sh | bash -s -- <TOKEN>
set -euo pipefail

DOMAIN="sharepoint.versicherungstech-magazin.de"
REPO="github.com/MaxHemp/VTM_Sharepoint.git"
INSTALL_DIR="/opt/vtm-teamportal"
TOKEN="${1:-}"

REPO_URL="https://${REPO}"
if [ -n "$TOKEN" ]; then
  REPO_URL="https://x-access-token:${TOKEN}@${REPO}"
fi

echo ">>> [1/4] Grundpakete und Docker installieren (falls noch nicht vorhanden) ..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y git curl ca-certificates >/dev/null
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo ">>> [2/4] Code aus GitHub holen ..."
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL"
  git -C "$INSTALL_DIR" pull
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

echo ">>> [3/4] Konfiguration schreiben (Domain: $DOMAIN) ..."
printf 'DOMAIN=%s\n' "$DOMAIN" > .env

echo ">>> [4/4] Anwendung bauen und starten — beim ersten Mal dauert das einige Minuten ..."
docker compose up -d --build

echo ""
echo "=============================================================="
echo "  Fertig! Das Teamportal läuft jetzt unter:"
echo ""
echo "      https://${DOMAIN}"
echo ""
echo "  Öffne die Adresse im Browser und lege dein Admin-Konto an."
echo "  (Das HTTPS-Zertifikat wird beim ersten Aufruf automatisch"
echo "  ausgestellt — das kann 1-2 Minuten dauern.)"
echo "=============================================================="
