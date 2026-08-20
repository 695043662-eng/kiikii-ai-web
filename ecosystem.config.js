/**
 * PM2 生态系统配置文件
 * 
 * ⚠️ 此文件在 .gitignore 中，不会被提交到仓库
 * 
 * 核心功能：动态读取服务器上的 .env.local 文件，将所有环境变量注入 PM2 进程
 * 解决问题：#296 生产环境 PM2 未加载环境变量
 * #756 军规：只使用 .env.local，不使用 .env.production
 * 
 * 部署后首次使用：
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save
 */

const fs = require('fs');
const path = require('path');

/**
 * 解析 .env 文件为 key-value 对象
 * 支持注释行（#开头）、空行、引号包裹的值
 */
function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) {
    console.error(`[ecosystem.config.js] ⚠️ 环境文件不存在: ${filePath}`);
    console.error('[ecosystem.config.js] 请确保 .env.local 文件存在于项目根目录');
    return env;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // 去除引号包裹
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  console.log(`[ecosystem.config.js] ✅ 已加载 ${Object.keys(env).length} 个环境变量`);
  return env;
}

// 读取 .env.local（服务器上的生产环境配置）
// ⚠️ 军规：只使用 .env.local，不使用 .env.production
const envLocalPath = path.resolve(__dirname, '.env.local');
const envVars = parseEnvFile(envLocalPath);

module.exports = {
  apps: [
    {
      name: 'kiikii',
      script: './.next/standalone/server.js',
      cwd: __dirname,
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
        HOSTNAME: '0.0.0.0',
        ...envVars,
      },
      // 进程管理
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      max_memory_restart: '450M', // 2C2G 服务器保护：内存超 450M 自动重启
      
      // 日志配置（生产服务器使用项目目录下的 logs）
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // 优雅关闭
      kill_timeout: 10000,
      listen_timeout: 30000,
    },
  ],
};
