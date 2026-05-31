# AIOJ

AIOJ is a FastAPI-based online judge for AI/ML style problems and contests. It includes a static SPA frontend, PostgreSQL metadata, MinIO object storage, Redis, a Docker-isolated judge worker, contest administration, notifications, direct messages, and deployment/backup scripts.

## Quick Start

1. Copy `.env.example` to `.env` and replace every `change-this-*` value with a strong secret.
2. Build the default judge image:

   ```bash
   docker build -t aioj-python-basic:latest judge-images/python-basic
   ```

3. Start the stack:

   ```bash
   docker compose up -d --build
   ```

4. Open the site through Caddy, or use the API health check:

   ```bash
   curl http://127.0.0.1:8000/health
   ```

## Problem Package Format

Upload a `.zip` containing:

```text
problem.yaml
statement.md
private/test.csv
private/labels.csv
public/sample_submission.csv
scorer.py              # optional
```

`problem.yaml` supports:

```yaml
slug: demo-problem
title: Demo Problem
metric: accuracy
higher_is_better: true
time_limit_sec: 60
memory_limit_mb: 2048
cpu_count: 2
output_limit_mb: 64
runner_image: aioj-python-basic:latest
required_tags: [cpu]
run_command:
  - python
  - /workspace/predict.py
  - --input
  - /input/test.csv
  - --output
  - /output/submission.csv
activate_on_import: false
```

The default scorer expects prediction CSV columns exactly `id,prediction`; labels must include `id,label`, with optional `split=public/private`.

## Operations

- CI: `.github/workflows/ci.yml`
- Deploy to VM: `.github/workflows/deploy.yml` and `scripts/server_deploy.sh`
- Backup: `ops/backup.sh`
- Restore: `ops/restore.sh /path/to/aioj_backup_YYYYMMDD_HHMMSS.tar.gz --yes`

Backups include database dumps, project files, MinIO object data, and Caddy data when mounted. Backup archives may contain secrets and should be stored privately.

## Security Notes

- Keep `AIOJ_ALLOW_LOCAL_JUDGE_RUNNER=false` in production.
- `/api/internal/*` is blocked by Caddy and also requires `INTERNAL_API_TOKEN`.
- Disabled users are rejected even if they still hold an old token.
- Admin actions are written to `/api/admin/audit-logs`.
- Uploaded zip files are checked for path traversal, file count, and uncompressed size limits.
