#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${AIOJ_ROOT:-/opt/aioj}"

usage() {
  echo "Usage: $0 /path/to/aioj_backup_YYYYMMDD_HHMMSS.tar.gz [--yes]" >&2
}

if [ "${1:-}" = "" ]; then
  usage
  exit 1
fi

BACKUP_FILE="$1"
YES="${2:-}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

if [ "$YES" != "--yes" ] && [ "${AIOJ_RESTORE_CONFIRM:-}" != "YES" ]; then
  echo "This will overwrite AIOJ files, database, and MinIO object data under $ROOT_DIR."
  echo "Run again with --yes if you are sure:"
  echo "  $0 '$BACKUP_FILE' --yes"
  exit 2
fi

work="$(mktemp -d /tmp/aioj_restore_XXXXXX)"
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT

echo "[1/9] extracting backup..."
tar -C "$work" -xzf "$BACKUP_FILE"

if [ ! -f "$work/db/postgres.dump" ]; then
  echo "Invalid backup: db/postgres.dump not found" >&2
  exit 1
fi

echo "[2/9] stopping judge agent if present..."
sudo systemctl stop aioj-judge-agent 2>/dev/null || true

echo "[3/9] backing up current project before restore..."
if [ -d "$ROOT_DIR" ]; then
  mkdir -p "$ROOT_DIR/backups"
  safety="$ROOT_DIR/backups/pre_restore_$(date -u +%Y%m%d_%H%M%S).tgz"
  tar -C "$ROOT_DIR" -czf "$safety" .env compose.yaml docker-compose.yml caddy web backend worker judge-images 2>/dev/null || true
  echo "Current files safety backup: $safety"
fi

echo "[4/9] restoring project files..."
mkdir -p "$ROOT_DIR"
if [ -d "$work/files/opt-aioj" ]; then
  rsync -a --delete \
    --exclude 'data/' \
    --exclude 'runs/' \
    --exclude '.venv/' \
    --exclude 'backups/pre_restore_*.tgz' \
    "$work/files/opt-aioj/" "$ROOT_DIR/"
fi

cd "$ROOT_DIR"

if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ROOT_DIR/.env"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-aioj}"
POSTGRES_DB="${POSTGRES_DB:-aioj}"

echo "[5/9] restoring systemd unit if included..."
if [ -f "$work/files/systemd/aioj-judge-agent.service" ]; then
  sudo cp -a "$work/files/systemd/aioj-judge-agent.service" /etc/systemd/system/aioj-judge-agent.service
  sudo systemctl daemon-reload
fi

echo "[6/9] starting postgres/redis/minio..."
docker compose up -d postgres redis minio
sleep 5

echo "[7/9] restoring database..."
# Reset public schema, then restore the custom-format dump.
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<'SQL'
drop schema if exists public cascade;
create schema public;
SQL

cat "$work/db/postgres.dump" | docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB"

echo "[8/9] restoring MinIO object data if included..."
if [ -f "$work/blob/minio-data.tgz" ]; then
  minio_src="$(docker inspect aioj-minio --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
  if [ -z "$minio_src" ] && [ -d "$ROOT_DIR/data/minio" ]; then
    minio_src="$ROOT_DIR/data/minio"
  fi

  if [ -n "$minio_src" ]; then
    docker compose stop minio
    mkdir -p "$minio_src"
    rm -rf "$minio_src"/*
    tar -C "$minio_src" -xzf "$work/blob/minio-data.tgz"
    docker compose up -d minio
  else
    echo "WARN: could not locate MinIO mount; skipped MinIO restore"
  fi
else
  echo "No MinIO object backup included; skipped"
fi

echo "[9/9] restarting services..."
docker compose up -d
sudo systemctl enable --now aioj-judge-agent 2>/dev/null || true

docker compose ps
echo
echo "Restore complete."
echo "Open: https://chat.yxyx.space/"
