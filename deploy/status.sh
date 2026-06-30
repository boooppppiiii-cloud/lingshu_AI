#!/usr/bin/env bash
set -euo pipefail

docker compose --env-file .env.production ps
echo
echo "Recent app logs:"
docker compose --env-file .env.production logs --tail=80 app
