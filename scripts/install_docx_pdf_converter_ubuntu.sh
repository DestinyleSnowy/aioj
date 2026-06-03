#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This installer is intended for Ubuntu/Debian hosts with apt-get." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y \
  libreoffice-writer \
  libreoffice-core \
  fontconfig \
  fonts-dejavu \
  fonts-noto \
  fonts-noto-cjk \
  fonts-noto-color-emoji

fc-cache -f || true

if command -v soffice >/dev/null 2>&1; then
  soffice --headless --version
else
  libreoffice --headless --version
fi
