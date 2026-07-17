#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: AGE_IDENTITY=/secure/backup-key.txt $0 <backup.tar.gz.age>" >&2
  exit 1
fi
AGE_IDENTITY="${AGE_IDENTITY:-}"
RESTORE_DIR="${RESTORE_DIR:-$(pwd)/restore}"
RESTORE_APPLY="${RESTORE_APPLY:-false}"
[[ -n "$AGE_IDENTITY" ]] || { echo "AGE_IDENTITY is required." >&2; exit 1; }
[[ -f "$AGE_IDENTITY" ]] || { echo "Age identity not found: $AGE_IDENTITY" >&2; exit 1; }
[[ -f "$1" ]] || { echo "Backup not found: $1" >&2; exit 1; }
command -v age >/dev/null || { echo "age is required." >&2; exit 1; }

mkdir -p "$RESTORE_DIR"
age -d -i "$AGE_IDENTITY" "$1" | tar -xzf - -C "$RESTORE_DIR"
chmod -R go-rwx "$RESTORE_DIR"
[[ -d "$RESTORE_DIR/pb_data" && -d "$RESTORE_DIR/data" ]] || { echo "Backup is missing pb_data or data." >&2; exit 1; }

if [[ "$RESTORE_APPLY" != "true" ]]; then
  printf 'Validated and restored into %s. Set RESTORE_APPLY=true to replace live Docker data.\n' "$RESTORE_DIR"
  exit 0
fi

command -v docker >/dev/null || { echo "docker is required when RESTORE_APPLY=true." >&2; exit 1; }
container="$(docker compose ps -aq pocketbase | head -n 1)"
[[ -n "$container" ]] || { echo "PocketBase container does not exist; run docker compose create first." >&2; exit 1; }

echo "Stopping services and replacing live data..."
services_stopped=1
restart_on_error() {
  if [[ "$services_stopped" == "1" ]]; then
    docker compose start pocketbase app >/dev/null || true
  fi
}
trap restart_on_error EXIT
docker compose stop app pocketbase >/dev/null
docker run --rm --volumes-from "$container" alpine:3.22 sh -c 'rm -rf /pb/pb_data/* /pb/pb_data/.[!.]* /pb/pb_data/..?* 2>/dev/null || true'
docker cp "$RESTORE_DIR/pb_data/." "$container:/pb/pb_data"
rm -rf "$(pwd)/data"
cp -a "$RESTORE_DIR/data" "$(pwd)/data"
docker compose start pocketbase app >/dev/null
services_stopped=0
printf 'Live data restored. Verify application health before deleting %s.\n' "$RESTORE_DIR"
