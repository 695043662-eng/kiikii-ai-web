#!/bin/bash
# ============================================================
# Kiikii AI - 一键生产部署脚本
# 
# 使用方式（在生产服务器执行）:
#   cd /var/www/kiikii-ai-web && ./deploy.sh
#
# 前置条件:
#   - 服务器已安装 Node.js 24+, pnpm, PM2, Nginx
#   - .env.local 已配置生产环境变量（数据库/COS/支付等）
#   - .env.isolated 已配置生产数据库直连信息（种子脚本用）
#   - ecosystem.config.js 已存在
# ============================================================

set -Eeuo pipefail

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "${BLUE}  STEP: $1${NC}"; echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

# 错误处理
trap 'log_error "部署失败！行号: $LINENO"; exit 1' ERR

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${PROJECT_DIR}"

log_info "项目目录: ${PROJECT_DIR}"

# ============================================================
# Step 1: 拉取最新代码
# ============================================================
log_step "1/7 拉取最新代码"

log_info "git fetch origin main..."
git fetch origin main

log_info "git reset --hard origin/main..."
git reset --hard origin/main

log_info "当前 commit: $(git log --oneline -1)"

# ============================================================
# Step 2: 安装依赖
# ============================================================
log_step "2/7 安装依赖"

log_info "pnpm install..."
pnpm install --prefer-frozen-lockfile

log_info "依赖安装完成"

# ============================================================
# Step 3: 生产构建
# ============================================================
log_step "3/7 生产构建 (Next.js standalone)"

log_info "pnpm build..."
pnpm build

# 确认 standalone 产物存在
if [ ! -d ".next/standalone" ]; then
    log_error "构建失败：.next/standalone 目录不存在"
    exit 1
fi

log_info "构建成功，standalone 产物就绪"

# ============================================================
# Step 4: 复制静态资源到 standalone
# ============================================================
log_step "4/7 复制静态资源"

# 复制 public 目录（用户上传的静态文件、logo 等）
if [ -d "public" ]; then
    log_info "复制 public -> .next/standalone/public"
    cp -r public .next/standalone/public
fi

# 复制 .next/static 目录（JS/CSS 等编译产物，standalone 模式必需）
if [ -d ".next/static" ]; then
    log_info "复制 .next/static -> .next/standalone/.next/static"
    mkdir -p .next/standalone/.next
    cp -r .next/static .next/standalone/.next/static
fi

log_info "静态资源复制完成"

# ============================================================
# Step 5: 数据库种子同步
# ============================================================
log_step "5/7 数据库种子同步 (topais-minimax-h3)"

# 检查 .env.isolated 是否存在（种子脚本需要生产数据库直连信息）
if [ -f ".env.isolated" ]; then
    log_info "执行生产库种子脚本: topais-minimax-h3..."
    node scripts/seed-prod-minimax-h3.mjs || log_warn "种子脚本执行失败（可能模型已存在），继续部署..."
else
    log_warn ".env.isolated 不存在，跳过数据库种子同步"
    log_warn "如需添加 topais-minimax-h3，请手动执行: node scripts/seed-prod-minimax-h3.mjs"
fi

# ============================================================
# Step 6: 重启 PM2 服务（零停机）
# ============================================================
log_step "6/7 重启 PM2 服务"

# 检查 PM2 是否已运行 kiikii 进程
PM2_RUNNING=$(pm2 list 2>/dev/null | grep -c "kiikii" || true)

if [ "${PM2_RUNNING}" -gt 0 ]; then
    log_info "PM2 kiikii 进程已存在，执行 reload（零停机重启）..."
    pm2 reload kiikii
else
    log_info "PM2 kiikii 进程不存在，执行 start..."
    pm2 start ecosystem.config.js --env production
fi

pm2 save
log_info "PM2 服务已就绪"

# ============================================================
# Step 7: Nginx 配置检查与重载
# ============================================================
log_step "7/7 Nginx 配置检查与重载"

# 如果项目中有 Nginx 配置文件，复制到服务器配置目录
NGINX_CONF_SRC="${PROJECT_DIR}/nginx/kiikii.me.conf"
NGINX_CONF_DEST="/etc/nginx/sites-available/kiikii.me"

if [ -f "${NGINX_CONF_SRC}" ] && [ -d "/etc/nginx/sites-available" ]; then
    log_info "更新 Nginx 配置: ${NGINX_CONF_SRC} -> ${NGINX_CONF_DEST}"
    sudo cp "${NGINX_CONF_SRC}" "${NGINX_CONF_DEST}"

    # 确保 sites-enabled 有软链接
    if [ ! -L "/etc/nginx/sites-enabled/kiikii.me" ]; then
        sudo ln -s "${NGINX_CONF_DEST}" /etc/nginx/sites-enabled/kiikii.me
    fi
fi

log_info "nginx -t (测试配置)..."
if sudo nginx -t 2>&1; then
    log_info "nginx 配置测试通过，执行 reload..."
    sudo systemctl reload nginx
    log_info "Nginx 已重载"
else
    log_error "Nginx 配置测试失败！请检查配置文件"
    exit 1
fi

# ============================================================
# 部署完成
# ============================================================
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✅ 部署完成！${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  服务地址: ${BLUE}https://kiikii.me${NC}"
echo -e "  PM2 状态: ${BLUE}pm2 status${NC}"
echo -e "  日志查看: ${BLUE}pm2 logs kiikii --lines 50${NC}"
echo ""
echo -e "${YELLOW}  📡 建议执行战后雷达探测:${NC}"
echo -e "  1. 极限上传测试: 拖入 15MB WebP/视频到画布"
echo -e "  2. 扣费脏读测试: 快速连点三下生成按钮"
echo -e "  3. 离线异步测试: 发起长视频生成后关闭浏览器，10分钟后查看历史记录"
echo ""
