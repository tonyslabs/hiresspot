#!/usr/bin/env bash
# Despliega la landing en el homelab: nginx sin privilegios en la red `core`, detrás de cloudflared.
# Uso: bash deploy/landing/deploy.sh      (requiere ssh al alias `hl`, rsync y docker en el homelab)
# Idempotente: sincroniza el sitio, la configuración y reinicia solo lo necesario. No toca nada fuera de ~/docker/apps/hiresspot-landing.
set -euo pipefail
cd "$(dirname "$0")/../.."

HOST=${HOST:-hl}
DIR=docker/apps/hiresspot-landing   # relativo al $HOME del homelab

node --test apps/landing/test/ >/dev/null || { echo "✖ Las pruebas de la landing fallan: no se despliega." >&2; exit 1; }

ssh "$HOST" "mkdir -p \$HOME/$DIR/site"
# El sitio: solo lo que se sirve (sin servidor de desarrollo, pruebas ni documentos)
rsync -a --delete --chmod=D755,F644 \
  --exclude '*.md' --exclude 'dev-server.mjs' --exclude 'test/' --exclude '.*' \
  apps/landing/ "$HOST:$DIR/site/"
rsync -a --chmod=F644 deploy/landing/docker-compose.yml deploy/landing/nginx.conf deploy/landing/security.conf "$HOST:$DIR/"

ssh "$HOST" bash -s -- "$DIR" <<'REMOTE'
set -euo pipefail
cd "$HOME/$1"
# BIND_ADDR (IP de tailnet para probar el puerto 8100) vive en .env, fuera del repo
[ -f .env ] || echo "BIND_ADDR=$(tailscale ip -4 | head -1)" > .env
docker compose up -d --remove-orphans
docker compose exec -T hiresspot-landing nginx -s reload   # recarga nginx.conf/security.conf sin cortar
sleep 2
docker compose ps --format '{{.Name}}: {{.Status}}'
REMOTE

IP=$(ssh "$HOST" "tailscale ip -4 | head -1")
echo "--- comprobación por tailnet (http://$IP:8100)"
curl -fsS -o /dev/null -w 'index.html → HTTP %{http_code}\n' "http://$IP:8100/"
curl -fsS -o /dev/null -w 'healthz    → HTTP %{http_code}\n' "http://$IP:8100/healthz"
curl -fsSI "http://$IP:8100/" | grep -iE '^(content-security-policy|x-content-type-options|cache-control)' | cut -c1-120
