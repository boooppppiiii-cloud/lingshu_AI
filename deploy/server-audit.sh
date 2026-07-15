#!/usr/bin/env bash
set -euo pipefail

echo "== Disk usage =="
df -h

echo
echo "== Biggest top-level paths =="
sudo du -h --max-depth=2 / 2>/dev/null | sort -rh | head -20

echo
echo "== Project directory usage =="
if [ -d /opt/lingshu ]; then
  sudo du -h --max-depth=2 /opt/lingshu 2>/dev/null | sort -rh | head -30
else
  echo "/opt/lingshu not found; adjust this path if the app is deployed elsewhere."
fi

echo
echo "== Large media/log files =="
sudo find /opt/lingshu /var/log -type f \( -size +100M \) -printf '%s %p\n' 2>/dev/null | sort -nr | head -30 | awk '{ size=$1; $1=""; printf "%.1f MB%s\n", size/1024/1024, $0 }'

echo
echo "== Docker usage =="
if command -v docker >/dev/null 2>&1; then
  docker system df || true
  docker images --format '{{.Size}}\t{{.Repository}}:{{.Tag}}' | sort -rh | head -20 || true
else
  echo "docker not installed"
fi

echo
echo "== PM2 status/logrotate =="
if command -v pm2 >/dev/null 2>&1; then
  pm2 list || true
  pm2 conf pm2-logrotate || true
else
  echo "pm2 not installed"
fi

echo
echo "== Memory and swap =="
free -h
swapon --show || true
