#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${AIOJ_ROOT:-/opt/aioj}"
BACKUP_DIR="${AIOJ_BACKUP_DIR:-/opt/aioj_backups}"
KEEP_DAYS="${AIOJ_BACKUP_KEEP_DAYS:-7}"

if [ ! -d "$ROOT_DIR" ]; then
  echo "AIOJ root not found: $ROOT_DIR" >&2
  exit 1
fi

cd "$ROOT_DIR"
mkdir -p "$BACKUP_DIR"

ts="$(date -u +%Y%m%d_%H%M%S)"
work="$BACKUP_DIR/.tmp_aioj_backup_$ts"
out="$BACKUP_DIR/aioj_backup_$ts.tar.gz"

cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT

mkdir -p "$work/files" "$work/db" "$work/blob" "$work/meta"

echo "[1/8] loading env..."
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ROOT_DIR/.env"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-aioj}"
POSTGRES_DB="${POSTGRES_DB:-aioj}"

echo "[2/8] collecting metadata..."
{
  echo "created_utc=$ts"
  echo "root_dir=$ROOT_DIR"
  echo "backup_dir=$BACKUP_DIR"
  echo "hostname=$(hostname)"
  echo "kernel=$(uname -a)"
  echo
  echo "docker compose ps:"
  docker compose ps || true
  echo
  echo "docker ps:"
  docker ps || true
  echo
  echo "disk:"
  df -h || true
  echo
  echo "git status if any:"
  git status --short 2>/dev/null || true
} > "$work/meta/info.txt"

echo "[3/8] backing up postgres..."
docker compose up -d postgres >/dev/null
# Use custom format so restore can be cleaner and smaller.
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$work/db/postgres.dump"
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --schema-only > "$work/db/schema.sql" || true

echo "[4/8] backing up project files..."
mkdir -p "$work/files/opt-aioj"

copy_if_exists() {
  local src="$1"
  local dst="$2"
  if [ -e "$src" ]; then
    mkdir -p "$(dirname "$dst")"
    cp -a "$src" "$dst"
  fi
}

copy_if_exists "$ROOT_DIR/.env" "$work/files/opt-aioj/.env"
copy_if_exists "$ROOT_DIR/compose.yaml" "$work/files/opt-aioj/compose.yaml"
copy_if_exists "$ROOT_DIR/docker-compose.yml" "$work/files/opt-aioj/docker-compose.yml"
copy_if_exists "$ROOT_DIR/caddy" "$work/files/opt-aioj/caddy"
copy_if_exists "$ROOT_DIR/web" "$work/files/opt-aioj/web"
copy_if_exists "$ROOT_DIR/backend" "$work/files/opt-aioj/backend"
copy_if_exists "$ROOT_DIR/worker" "$work/files/opt-aioj/worker"
copy_if_exists "$ROOT_DIR/judge-images" "$work/files/opt-aioj/judge-images"
copy_if_exists "$ROOT_DIR/schema.sql" "$work/files/opt-aioj/schema.sql"
copy_if_exists "$ROOT_DIR/backups" "$work/files/opt-aioj/backups"

if [ -f /etc/systemd/system/aioj-judge-agent.service ]; then
  mkdir -p "$work/files/systemd"
  sudo cp -a /etc/systemd/system/aioj-judge-agent.service "$work/files/systemd/aioj-judge-agent.service" 2>/dev/null || \
    cp -a /etc/systemd/system/aioj-judge-agent.service "$work/files/systemd/aioj-judge-agent.service"
fi

echo "[5/8] backing up MinIO object data..."
minio_src="$(docker inspect aioj-minio --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
if [ -z "$minio_src" ] && [ -d "$ROOT_DIR/data/minio" ]; then
  minio_src="$ROOT_DIR/data/minio"
fi

if [ -n "$minio_src" ] && [ -d "$minio_src" ]; then
  sudo tar -C "$minio_src" -czf "$work/blob/minio-data.tgz" .
  echo "$minio_src" > "$work/blob/minio-source-path.txt"
else
  echo "WARN: MinIO data mount not found; skipped MinIO data backup" | tee "$work/blob/minio-warning.txt"
fi

echo "[6/8] backing up Caddy data if mounted..."
caddy_data_src="$(docker inspect aioj-caddy --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
if [ -n "$caddy_data_src" ] && [ -d "$caddy_data_src" ]; then
  sudo tar -C "$caddy_data_src" -czf "$work/blob/caddy-data.tgz" .
  echo "$caddy_data_src" > "$work/blob/caddy-data-source-path.txt"
else
  echo "Caddy data mount not found or not persisted; skipped" > "$work/blob/caddy-data-warning.txt"
fi

echo "[7/8] writing manifest..."
cat > "$work/RESTORE_README.txt" <<EOF
AIOJ backup created at UTC $ts

Contents:
- db/postgres.dump: PostgreSQL custom-format dump
- db/schema.sql: schema-only dump
- blob/minio-data.tgz: MinIO object files, if mount was found
- blob/caddy-data.tgz: Caddy certificate/account data, if mount was found
- files/opt-aioj: project files
- files/systemd/aioj-judge-agent.service: judge systemd unit, if found
- meta/info.txt: runtime metadata

Restore with:
/opt/aioj/ops/restore.sh $out

This backup may contain secrets from .env. Keep it private.
EOF

echo "[8/8] creating archive..."
tar -C "$work" -czf "$out" .

chmod 600 "$out"

echo "Backup created:"
echo "$out"
du -h "$out" || true

echo "Pruning backups older than $KEEP_DAYS days..."
find "$BACKUP_DIR" -maxdepth 1 -name 'aioj_backup_*.tar.gz' -type f -mtime +"$KEEP_DAYS" -print -delete || true

echo "Done."
