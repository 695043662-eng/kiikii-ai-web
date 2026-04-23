#!/bin/bash
set -Eeuo pipefail

cd "$(pwd)"

# 🔧 修复权限问题：确保当前用户对 .next 目录有写权限
if [ -d ".next" ]; then
  echo "Fixing permissions for .next directory..."
  sudo chown -R $(whoami):$(whoami) .next 2>/dev/null || true
fi

echo "Installing dependencies..."
pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only

echo "Building the project..."
pnpm next build

# 🔧 修复 standalone 模式静态资源问题：复制 public 目录
if [ -d "public" ] && [ -d ".next/standalone" ]; then
  echo "Copying public directory to standalone..."
  cp -r public .next/standalone/public
fi

echo "Build completed successfully!"
