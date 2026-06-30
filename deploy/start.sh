#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env.production ]; then
  echo ".env.production is missing. Run ./deploy/make-production-env.sh first."
  exit 1
fi

docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
