#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${1:-$HOME/Projects/overseas-workbench}"
REPO="git@github.com:julia20030910-alt/overseas-workbench.git"

echo "→ 目标目录: $TARGET_DIR"

if [ -d "$TARGET_DIR/.git" ]; then
  echo "→ 目录已存在，拉取最新代码..."
  git -C "$TARGET_DIR" pull origin master
else
  mkdir -p "$(dirname "$TARGET_DIR")"
  echo "→ 克隆仓库..."
  git clone "$REPO" "$TARGET_DIR"
fi

cd "$TARGET_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "→ 已创建 .env，请编辑并填入 GEMINI_API_KEY 等密钥"
fi

echo "→ 安装依赖..."
npm install

echo ""
echo "✓ 完成！项目路径: $TARGET_DIR"
echo ""
echo "启动方式（开两个终端）："
echo "  终端1: cd $TARGET_DIR && npm run dev:server"
echo "  终端2: cd $TARGET_DIR && npm run dev"
echo "  浏览器: http://localhost:5173"
