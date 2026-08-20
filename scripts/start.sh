#!/bin/bash
set -Eeuo pipefail

WORKSPACE_PATH="$(pwd)"
PORT=5000
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"

cd "${WORKSPACE_PATH}"

# 检查是否存在 standalone 构建产物
STANDALONE_DIR="${WORKSPACE_PATH}/.next/standalone"
if [ -d "${STANDALONE_DIR}" ]; then
    echo "Starting standalone server on port ${DEPLOY_RUN_PORT}..."
    
    # 复制静态文件和 public 目录到 standalone 目录
    if [ -d "${WORKSPACE_PATH}/public" ]; then
        cp -r "${WORKSPACE_PATH}/public" "${STANDALONE_DIR}/public"
    fi
    if [ -d "${WORKSPACE_PATH}/.next/static" ]; then
        mkdir -p "${STANDALONE_DIR}/.next/static"
        cp -r "${WORKSPACE_PATH}/.next/static" "${STANDALONE_DIR}/.next/"
    fi
    
    # 设置环境变量并启动 standalone 服务器
    export PORT=${DEPLOY_RUN_PORT}
    export HOSTNAME="0.0.0.0"
    
    cd "${STANDALONE_DIR}"
    node server.js
else
    echo "Standalone build not found, falling back to next start..."
    echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
    npx next start --port ${DEPLOY_RUN_PORT}
fi
