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

export AIOJ_HOST_RUN_ROOT="$(pwd)/runs"
mkdir -p runs

echo "[deploy] building application images..."
docker compose build api worker

if [ -f "judge-images/python-basic/Dockerfile" ]; then
  echo "[deploy] building default judge image..."
  docker build -t aioj-python-basic:latest judge-images/python-basic
fi

echo "[deploy] starting stateful dependencies..."
docker compose up -d postgres redis minio

echo "[deploy] running database migrations..."
docker compose run --rm api alembic upgrade head

echo "[deploy] starting application services..."
docker compose up -d --remove-orphans api worker caddy

echo "[deploy] checking legacy systemd judge agent..."
if sudo -n systemctl cat aioj-judge-agent >/dev/null 2>&1; then
  if [ "${AIOJ_ENABLE_LEGACY_JUDGE_AGENT:-false}" = "true" ]; then
    sudo -n systemctl restart aioj-judge-agent
    echo "[deploy] legacy judge agent restarted (AIOJ_ENABLE_LEGACY_JUDGE_AGENT=true)"
  else
    if sudo -n systemctl is-active --quiet aioj-judge-agent; then
      sudo -n systemctl stop aioj-judge-agent || true
      echo "[deploy] legacy judge agent stopped to avoid duplicate worker registration"
    else
      echo "[deploy] legacy judge agent installed but inactive; compose worker remains primary"
    fi
  fi
else
  echo "[deploy] legacy judge agent service not available or requires interactive sudo; skipped"
fi

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

echo "[deploy] waiting for judge worker heartbeat..."
worker_ready=0
for i in $(seq 1 30); do
  if docker compose exec -T api python - <<'PY'
import json
import os
import sys
import urllib.request

token = os.environ.get("INTERNAL_API_TOKEN", "")
req = urllib.request.Request(
    "http://127.0.0.1:8000/api/internal/status",
    headers={"X-Internal-Token": token},
)
try:
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.load(resp)
except Exception as exc:
    print(f"judge_status_error={exc}")
    sys.exit(1)

summary = {
    "pending_jobs": data.get("pending_jobs"),
    "running_jobs": data.get("running_jobs"),
    "online_nodes": data.get("online_nodes"),
    "offline_nodes": data.get("offline_nodes"),
    "maintenance": data.get("maintenance"),
}
print(json.dumps(summary, ensure_ascii=False))
sys.exit(0 if int(data.get("online_nodes") or 0) > 0 else 1)
PY
  then
    worker_ready=1
    break
  fi

  if [ "$i" = "1" ] || [ $((i % 5)) -eq 0 ]; then
    echo "[deploy] judge worker not ready yet; current worker status/logs:"
    docker compose ps worker || true
    docker compose logs --tail=80 worker || true
  fi
  sleep 2
done

if [ "$worker_ready" != "1" ]; then
  echo "[deploy] ERROR: judge worker did not register an ONLINE heartbeat"
  docker compose ps || true
  docker compose logs --tail=200 worker || true
  exit 1
fi

echo "[deploy] final status:"
docker compose ps

echo "[deploy] done"
