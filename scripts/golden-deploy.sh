#!/bin/bash
# 🥇 黄金一键部署脚本
# 使用: sh scripts/deploy.sh
# 说明: 拉代码 + 装依赖 + 构建 + 杀进程 + 启动服务 + 验证

set -e
echo "🚀 黄金一键部署开始..."

# 1. 拉取最新代码
echo "📥 拉取最新代码..."
git pull origin main

# 2. 安装依赖
echo "📦 安装依赖..."
pnpm install --frozen-lockfile

# 3. 构建
echo "🔨 构建项目..."
pnpm run build

# 4. 杀掉旧进程
echo "💀 清理旧进程..."
pm2 kill 2>/dev/null || true
sudo killall -9 node 2>/dev/null || true
sudo fuser -k 5000/tcp 2>/dev/null || true
sleep 2

# 5. 修复权限
echo "🔧 修复权限..."
sudo chown -R ubuntu:ubuntu .

# 6. 启动新服务
echo "🏠 启动服务..."
PORT=5000 pm2 start .next/standalone/server.js --name kiikii
pm2 save

# 7. 验证
sleep 3
echo ""
echo "📊 服务状态:"
pm2 status
echo ""
echo "🔍 健康检查:"
curl -I -s --max-time 3 http://localhost:5000 | head -3
echo ""
echo "✅ 部署完成！"
