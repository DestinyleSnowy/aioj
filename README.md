# AIOJ

AIOJ is a FastAPI-based online judge for AI/ML style problems and contests. It includes a static SPA frontend, PostgreSQL metadata, MinIO object storage, Redis, a Docker-isolated judge worker, contest administration, notifications, direct messages, and deployment/backup scripts.

## Quick Start

1. Copy `.env.example` to `.env` and replace every `change-this-*` value with a strong secret.
2. Build the default judge images:

   ```bash
   docker build -t aioj-python-basic:latest judge-images/python-basic
   docker build -t aioj-python-ioai-cpu:latest judge-images/python-ioai-cpu
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

Upload a `.zip` containing either the legacy CSV layout or the richer artifact layout.

Legacy CSV layout:

```text
problem.yaml
statement.md
private/test.csv
private/labels.csv
public/sample_submission.csv
scorer.py              # optional
```

Artifact layout:

```text
problem.yaml
statements/en.md       # optional, any number of *.md
statements/zh.md       # optional
statements/en.pdf      # optional, any number of *.pdf
public/sample_submission.zip
public/figs/...        # optional statement/resource files
private/input/...      # hidden runtime inputs mounted at /input
private/scoring/...    # hidden scorer assets mounted for scorer.py
scorer.py
```

`problem.yaml` supports:

```yaml
slug: demo-problem
title: Demo Problem
metric: accuracy
higher_is_better: true
statement_language: en
default_statement_language: en
statement_languages:
  en: English
  zh: 中文
time_limit_sec: 60
memory_limit_mb: 2048
cpu_count: 2
output_limit_mb: 64
runner_image: aioj-python-basic:latest
required_tags: [cpu]
sample_submission: sample_submission.zip
output_files:
  - submission.zip
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

Notes:

- `statement.md` still works as a shorthand for a single default-language Markdown statement.
- Markdown statements can reference relative assets under `public/`, for example `![diagram](figs/overview.png)`.
- `statements/*.pdf` are exposed as downloadable statement PDFs in the problem page.
- `public/sample_submission.*` can be a file or a directory bundle; the UI serves it as a download artifact.
- Artifact-mode packages must include both `private/input/` and `private/scoring/`.
- Custom scorers can read artifact outputs listed in `output_files` and should return public/private scores plus optional metrics.

Optional scorer/runtime environment variables:

```text
AIOJ_SCORER_TIMEOUT_SEC=900
HF_HOME=/data/huggingface
HF_TOKEN=...
HUGGINGFACE_HUB_TOKEN=...
OPENAI_API_KEY=...
OPENAI_BASE_URL=...
OPENROUTER_API_KEY=...
OPENROUTER_BASE_URL=...
```

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
