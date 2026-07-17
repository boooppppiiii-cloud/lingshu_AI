#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
PB_DATA_DIR="${PB_DATA_DIR:-$ROOT_DIR/pb_data}"
APP_DATA_DIR="${APP_DATA_DIR:-$ROOT_DIR/data}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"

if [[ -z "$AGE_RECIPIENT" ]]; then
  echo "AGE_RECIPIENT is required (the Singapore server age public key)." >&2
  exit 1
fi
command -v age >/dev/null || { echo "age is required." >&2; exit 1; }
[[ -d "$PB_DATA_DIR" ]] || { echo "PocketBase data directory not found: $PB_DATA_DIR" >&2; exit 1; }
[[ -d "$APP_DATA_DIR" ]] || { echo "Application data directory not found: $APP_DATA_DIR" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="$BACKUP_DIR/lingshu-production-$timestamp.tar.gz.age"
manifest="$BACKUP_DIR/lingshu-production-$timestamp.manifest.txt"

tar -C "$ROOT_DIR" -czf - "${PB_DATA_DIR#$ROOT_DIR/}" "${APP_DATA_DIR#$ROOT_DIR/}" \
  | age -r "$AGE_RECIPIENT" -o "$output"

shasum -a 256 "$output" > "$manifest"
chmod 600 "$output" "$manifest"
printf 'Encrypted backup: %s\nChecksum: %s\n' "$output" "$manifest"
