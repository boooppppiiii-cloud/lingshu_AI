#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env.production ]; then
  echo ".env.production is missing."
  exit 1
fi

mkdir -p backups
echo "==> Backing up PocketBase before update"
docker compose --env-file .env.production stop pocketbase
docker compose --env-file .env.production run --rm --no-deps pocketbase tar czf - -C /pb/pb_data . > "backups/pb_data_$(date +%F_%H%M%S).tar.gz"
docker compose --env-file .env.production start pocketbase

echo "==> Pulling latest code"
git pull

echo "==> Rebuilding and restarting"
docker compose --env-file .env.production up -d --build

echo "==> Syncing PocketBase schema and demo accounts"
docker compose --env-file .env.production exec -T app npm run setup:pb
docker compose --env-file .env.production exec -T app npm run demo:sync-accounts

docker compose --env-file .env.production ps
