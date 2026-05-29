#!/usr/bin/env bash
set -euo pipefail

REMOTE_URL="${1:-}"

cd "$(dirname "$0")/.."

if [ -z "${REMOTE_URL}" ]; then
  echo "Usage:"
  echo "  bash scripts/init_repo_on_vm.sh git@github.com:<YOUR_USERNAME>/aioj.git"
  echo
  echo "Create an empty private GitHub repo first, then pass its SSH URL."
  exit 1
fi

if [ ! -f ".gitignore" ]; then
  touch .gitignore
fi

append_ignore() {
  local item="$1"
  grep -qxF "$item" .gitignore || echo "$item" >> .gitignore
}

append_ignore ".env"
append_ignore ".env.*"
append_ignore "!.env.example"
append_ignore "backups/"
append_ignore "runs/"
append_ignore "data/"
append_ignore "postgres-data/"
append_ignore "minio-data/"
append_ignore "storage/"
append_ignore "uploads/"
append_ignore "__pycache__/"
append_ignore "*.pyc"
append_ignore "*.log"
append_ignore ".DS_Store"
append_ignore "node_modules/"
append_ignore ".venv/"
append_ignore "*.pem"
append_ignore "*.key"

if [ ! -d ".git" ]; then
  git init
fi

git branch -M main

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "${REMOTE_URL}"
else
  git remote add origin "${REMOTE_URL}"
fi

echo "[git] checking ignored secret files..."
if git check-ignore .env >/dev/null 2>&1; then
  echo "[git] .env is ignored"
else
  echo "[git] ERROR: .env is not ignored"
  exit 1
fi

echo "[git] staging files..."
git add .gitignore .github scripts backend web caddy docker-compose.yml Dockerfile* 2>/dev/null || true
git add . 2>/dev/null || true

echo "[git] status:"
git status --short

if git diff --cached --quiet; then
  echo "[git] nothing to commit"
else
  git commit -m "Initial AIOJ project"
fi

echo
echo "Next push:"
echo "  git push -u origin main"
echo
echo "If GitHub SSH is not set on this VM, generate/add a GitHub SSH key first."
