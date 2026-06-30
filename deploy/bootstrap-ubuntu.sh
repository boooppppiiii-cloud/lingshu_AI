#!/usr/bin/env bash
set -euo pipefail

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required. Please run this script on Ubuntu as a sudo user."
  exit 1
fi

echo "==> Updating Ubuntu packages"
sudo apt update
sudo apt install -y git ca-certificates curl ufw openssl

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
else
  echo "==> Docker is already installed"
fi

echo "==> Adding current user to docker group"
sudo usermod -aG docker "$USER"

echo "==> Opening firewall ports 22, 80 and 443"
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo
echo "Server bootstrap is done."
echo "Important: close this SSH window and log in again before running docker commands."
