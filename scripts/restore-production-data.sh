#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: AGE_IDENTITY=/secure/backup-key.txt $0 <backup.tar.gz.age>" >&2
  exit 1
fi
AGE_IDENTITY="${AGE_IDENTITY:-}"
RESTORE_DIR="${RESTORE_DIR:-$(pwd)/restore}"
[[ -n "$AGE_IDENTITY" ]] || { echo "AGE_IDENTITY is required." >&2; exit 1; }
[[ -f "$AGE_IDENTITY" ]] || { echo "Age identity not found: $AGE_IDENTITY" >&2; exit 1; }
[[ -f "$1" ]] || { echo "Backup not found: $1" >&2; exit 1; }
command -v age >/dev/null || { echo "age is required." >&2; exit 1; }

mkdir -p "$RESTORE_DIR"
age -d -i "$AGE_IDENTITY" "$1" | tar -xzf - -C "$RESTORE_DIR"
chmod -R go-rwx "$RESTORE_DIR"
printf 'Restored into %s. Validate before replacing live volumes.\n' "$RESTORE_DIR"
