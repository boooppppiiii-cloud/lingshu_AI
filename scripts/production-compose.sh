#!/bin/sh
set -eu

APP_DIR=${LINGSHU_APP_DIR:-/opt/lingshu_AI}
ENV_FILE=${LINGSHU_ENV_FILE:-/etc/lingshu-ai/env}

if [ ! -r "$ENV_FILE" ]; then
  echo "Production environment file is not readable: $ENV_FILE" >&2
  exit 1
fi

cd "$APP_DIR"
exec docker compose --env-file "$ENV_FILE" "$@"
