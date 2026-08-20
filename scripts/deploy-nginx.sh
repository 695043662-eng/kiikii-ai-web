#!/bin/bash
# ============================================================
# Kiikii AI - Nginx 部署脚本
# 目标服务器：香港 VPS (2核2G)
# ============================================================

set -e

echo "=========================================="
echo "Kiikii AI - Nginx 部署"
echo "=========================================="

# 检查是否 root
if [ "$EUID" -ne 0 ]; then
    echo "请使用 root 用户或 sudo 执行"
    exit 1
fi

# 域名配置
DOMAIN="kiikii.me"
EMAIL="your-email@example.com"  # ⚠️ 替换为你的邮箱（用于 Let's Encrypt）

# 1. 安装 Nginx（如果未安装）
if ! command -v nginx &> /dev/null; then
    echo "[1/5] 安装 Nginx..."
    apt update
    apt install -y nginx
else
    echo "[1/5] Nginx 已安装，跳过"
fi

# 2. 创建必要目录
echo "[2/5] 创建目录..."
mkdir -p /var/www/certbot
mkdir -p /etc/nginx/ssl

# 3. 安装 Certbot（Let's Encrypt 证书工具）
if ! command -v certbot &> /dev/null; then
    echo "[3/5] 安装 Certbot..."
    apt install -y certbot python3-certbot-nginx
else
    echo "[3/5] Certbot 已安装，跳过"
fi

# 4. 部署 Nginx 配置
echo "[4/5] 部署 Nginx 配置..."
cp nginx/kiikii.me.conf /etc/nginx/sites-available/kiikii.me
ln -sf /etc/nginx/sites-available/kiikii.me /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# 测试配置
nginx -t

# 5. 申请 SSL 证书
echo "[5/5] 申请 SSL 证书..."
echo "请确保域名 $DOMAIN 已解析到本服务器 IP"
read -p "是否继续申请证书？(y/n): " confirm

if [ "$confirm" = "y" ]; then
    # 先启动 Nginx（用于验证域名）
    systemctl reload nginx
    
    # 申请证书
    certbot certonly --webroot \
        -w /var/www/certbot \
        -d $DOMAIN \
        -d www.$DOMAIN \
        --email $EMAIL \
        --agree-tos \
        --no-eff-email
    
    # 设置自动续期
    certbot renew --dry-run
    
    echo "SSL 证书申请完成！"
fi

# 重启 Nginx
systemctl reload nginx
systemctl enable nginx

echo "=========================================="
echo "✅ Nginx 部署完成！"
echo ""
echo "配置文件: /etc/nginx/sites-available/kiikii.me"
echo "日志目录: /var/log/nginx/"
echo ""
echo "后续步骤："
echo "1. 确保 Next.js 服务运行在 127.0.0.1:5000"
echo "2. 访问 https://$DOMAIN 测试"
echo "=========================================="
