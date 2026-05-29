#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[deploy] cwd=$(pwd)"
echo "[deploy] git/ref info if available:"
git rev-parse --short HEAD 2>/dev/null || true

if [ ! -f ".env" ]; then
  echo "[deploy] ERROR: .env not found in $(pwd)"
  echo "[deploy] Keep production secrets on the VM; .env is intentionally not synced from GitHub."
  exit 1
fi

echo "[deploy] checking docker compose..."
docker compose version

echo "[deploy] building api..."
docker compose build api

echo "[deploy] starting stateful dependencies..."
docker compose up -d postgres redis minio

echo "[deploy] running database migrations..."
docker compose run --rm api alembic upgrade head

echo "[deploy] starting application services..."
docker compose up -d --remove-orphans api worker caddy

echo "[deploy] waiting for api health..."
for i in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:8000/health >/tmp/aioj_health.out 2>/tmp/aioj_health.err; then
    cat /tmp/aioj_health.out
    echo
    break
  fi
  if [ "$i" = "45" ]; then
    echo "[deploy] ERROR: api health check failed"
    cat /tmp/aioj_health.err || true
    docker compose logs --tail=120 api || true
    exit 1
  fi
  sleep 2
done

echo "[deploy] final status:"
docker compose ps

echo "[deploy] done"
