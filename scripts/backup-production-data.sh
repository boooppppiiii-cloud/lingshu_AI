#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
APP_DATA_DIR="${APP_DATA_DIR:-$ROOT_DIR/data}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"

if [[ -z "$AGE_RECIPIENT" ]]; then
  echo "AGE_RECIPIENT is required (the Singapore server age public key)." >&2
  exit 1
fi
command -v age >/dev/null || { echo "age is required." >&2; exit 1; }
[[ -d "$APP_DATA_DIR" ]] || { echo "Application data directory not found: $APP_DATA_DIR" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="$BACKUP_DIR/lingshu-production-$timestamp.tar.gz.age"
manifest="$BACKUP_DIR/lingshu-production-$timestamp.manifest.txt"
staging="$(mktemp -d)"
was_stopped=0

cleanup() {
  rm -rf "$staging"
  if [[ "$was_stopped" == "1" ]]; then
    docker compose start pocketbase app >/dev/null
  fi
}
trap cleanup EXIT

if command -v docker >/dev/null 2>&1 && docker compose ps -aq pocketbase | grep -q .; then
  container="$(docker compose ps -aq pocketbase | head -n 1)"
  echo "Stopping app and PocketBase for a consistent database snapshot..."
  docker compose stop app pocketbase >/dev/null
  was_stopped=1
  docker cp "$container:/pb/pb_data/." "$staging/pb_data"
else
  PB_DATA_DIR="${PB_DATA_DIR:-$ROOT_DIR/pb_data}"
  [[ -d "$PB_DATA_DIR" ]] || { echo "PocketBase Docker container or data directory not found." >&2; exit 1; }
  cp -a "$PB_DATA_DIR" "$staging/pb_data"
fi
cp -a "$APP_DATA_DIR" "$staging/data"

tar -C "$staging" -czf - pb_data data \
  | age -r "$AGE_RECIPIENT" -o "$output"

shasum -a 256 "$output" > "$manifest"
chmod 600 "$output" "$manifest"
printf 'Encrypted backup: %s\nChecksum: %s\n' "$output" "$manifest"
