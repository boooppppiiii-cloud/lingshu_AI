#!/usr/bin/env bash
set -euo pipefail

if [ -f .env.production ]; then
  read -r -p ".env.production already exists. Overwrite it? Type yes to continue: " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Canceled."
    exit 0
  fi
fi

read -r -p "Customer app domain, for example app.example.com: " app_domain
read -r -p "PocketBase admin domain, for example pb.example.com: " pb_domain
read -r -p "PocketBase admin email: " pb_email

read -r -s -p "PocketBase admin password. Leave empty to generate one: " pb_password
echo
if [ -z "$pb_password" ]; then
  pb_password="$(openssl rand -base64 24 | tr -d '\n')"
fi

read -r -p "Gemini API key. Leave empty if you will use Qwen/DashScope: " gemini_key
read -r -p "DashScope API key. Leave empty if unused: " dashscope_key
read -r -p "Seedance API key. Leave empty if unused: " seedance_key

render_secret="$(openssl rand -hex 32)"

cat > .env.production <<EOF
APP_DOMAIN=${app_domain}
PB_DOMAIN=${pb_domain}
PUBLIC_BASE_URL=https://${app_domain}

PB_VERSION=0.39.5
PB_ADMIN_EMAIL=${pb_email}
PB_ADMIN_PASSWORD=${pb_password}

PORT=8788
RENDER_TOKEN_SECRET=${render_secret}
SUBSCRIPTION_ENFORCED=false

GEMINI_API_KEY=${gemini_key}

# If using Qwen / DashScope, uncomment OVERSEAS_LLM_BACKEND.
# OVERSEAS_LLM_BACKEND=qwen
DASHSCOPE_API_KEY=${dashscope_key}
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

SEEDANCE_API_KEY=${seedance_key}
SEEDANCE_VIDEO_ENABLED=false
SEEDANCE_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3
SEEDANCE_MODEL=doubao-seedance-2-0-fast-260128

YOUTUBE_API_KEY=
APIFY_TOKEN=
R2_PUBLIC_URL=
EOF

chmod 600 .env.production

echo
echo ".env.production created."
echo "PocketBase admin email: ${pb_email}"
echo "PocketBase admin password: ${pb_password}"
echo "Save this password somewhere safe."
