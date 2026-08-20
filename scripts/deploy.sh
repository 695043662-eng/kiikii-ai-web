#!/bin/bash
# 金牌部署脚本 - 零停机时间部署
# 使用方法: sh scripts/deploy.sh

set -e  # 遇到错误立即退出

echo "🚀 开始部署..."

# 1. 进房间拿新图纸
echo "📥 拉取最新代码..."
cd /var/www/kiikii
git pull origin main

# 2. 安装并盖房子（先不拆旧房子，保证网站还能看）
echo "📦 安装依赖..."
pnpm install --frozen-lockfile

echo "🔨 构建项目（这需要几分钟，网站仍可访问）..."
pnpm run build

# 🔧 #294 修复：standalone 模式需要手动复制静态资源
echo "📁 复制静态资源..."
cp -r public .next/standalone/public
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/static

# 3. 房子盖好了，开始"闪电换房"
echo "⚡ 闪电切换服务..."

# 杀掉旧幽灵，清理端口
pm2 kill 2>/dev/null || true
sudo fuser -k 5000/tcp 2>/dev/null || true
sleep 2

# 修复权限
sudo chown -R ubuntu:ubuntu .

# 4. 启动新房子 (standalone 模式)
echo "🏠 启动服务..."
PORT=5000 pm2 start .next/standalone/server.js --name kiikii

# 5. 保存并检查
pm2 save
sleep 3

echo "✅ 部署完成！"
echo ""
pm2 status
echo ""
curl -I -s --max-time 3 http://localhost:5000 | head -3
