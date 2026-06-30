#!/usr/bin/env bash
set -euo pipefail

mkdir -p backups

echo "==> Backing up PocketBase data"
docker compose --env-file .env.production stop pocketbase
docker compose --env-file .env.production run --rm --no-deps pocketbase tar czf - -C /pb/pb_data . > "backups/pb_data_$(date +%F_%H%M%S).tar.gz"
docker compose --env-file .env.production start pocketbase

echo "==> Backing up app data folder"
tar czf "backups/app_data_$(date +%F_%H%M%S).tar.gz" data

echo "Backup finished. Files are in ./backups"
