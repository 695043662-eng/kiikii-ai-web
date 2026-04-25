/**
 * PM2 守护进程配置 - kiikii 生产环境
 * 
 * 使用方法：
 * 1. 安装 PM2: npm install -g pm2
 * 2. 启动服务: pm2 start ecosystem.config.js
 * 3. 查看状态: pm2 status
 * 4. 查看日志: pm2 logs kiikii-prod
 * 5. 停止服务: pm2 stop kiikii-prod
 * 6. 重启服务: pm2 restart kiikii-prod
 * 7. 开机自启: pm2 startup && pm2 save
 */

module.exports = {
  apps: [
    {
      name: 'kiikii-prod',
      script: 'server.js',
      cwd: '/var/www/kiikii/.next/standalone',  // standalone 构建产物目录
      
      // 实例配置
      instances: 1,                    // 2核2G 服务器，单实例即可
      exec_mode: 'fork',               // 单进程模式
      
      // 环境变量
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
        HOSTNAME: '0.0.0.0',
        TZ: 'Asia/Shanghai',           // 时区设置
        
        // ===== 数据库配置（必填）=====
        SUPABASE_URL: '',              // Supabase URL
        SUPABASE_ANON_KEY: '',         // Supabase 匿名密钥
        SUPABASE_SERVICE_ROLE_KEY: '', // Supabase 服务密钥
        
        // ===== AI API 配置（必填）=====
        GRS_API_ENDPOINT: '',          // GRS AI API 地址
        GRS_API_KEY: '',               // GRS API 密钥
        NEXT_PUBLIC_API_ENDPOINT: '',  // 前端 API 地址
        NEXT_PUBLIC_DEFAULT_API_KEY: '', // 前端默认 API 密钥
        
        // ===== 对象存储配置（必填）=====
        COS_SECRET_ID: '',             // 腾讯云 Secret ID
        COS_SECRET_KEY: '',            // 腾讯云 Secret Key
        COS_BUCKET: '',                // COS 存储桶名称
        COS_REGION: 'ap-hongkong',     // COS 区域
        COS_DOMAIN: '',                // COS 域名
        
        // ===== 邮件服务配置（可选）=====
        TENCENTCLOUD_SECRET_ID: '',    // 腾讯云邮件 Secret ID
        TENCENTCLOUD_SECRET_KEY: '',   // 腾讯云邮件 Secret Key
        TENCENTCLOUD_REGION: 'ap-hongkong',
        SES_SENDER_EMAIL: '',          // 发件人邮箱
        SES_SENDER_NAME: 'Kiikii AI',  // 发件人名称
        
        // ===== IP 频率限制配置（可选）=====
        RATE_LIMIT_HOURLY: 5,          // 单个 IP 1 小时内最多发送次数
        RATE_LIMIT_DAILY: 10,          // 单个 IP 24 小时内最多发送次数
        
        // ===== 生产域名（必填）=====
        NEXT_PUBLIC_SITE_URL: 'https://kiikii.me', // 生产域名
      },
      
      // 日志配置
      error_file: '/var/log/kiikii/error.log',
      out_file: '/var/log/kiikii/out.log',
      log_file: '/var/log/kiikii/combined.log',
      time: true,                      // 日志带时间戳
      merge_logs: true,                // 合并日志
      
      // 进程管理
      watch: false,                    // 生产环境不监听文件变化
      ignore_watch: ['node_modules', 'logs'],
      max_memory_restart: '1500M',     // 内存超过 1.5G(1500M) 自动重启（2G 服务器留余量）
      min_uptime: '10s',               // 最小运行时间，低于此视为启动失败
      max_restarts: 10,                // 最大重启次数
      restart_delay: 1000,             // 重启延迟 1 秒
      autorestart: true,               // 崩溃自动重启
      
      // 优雅关闭
      kill_timeout: 5000,              // 关闭超时 5 秒
      wait_ready: true,                // 等待 ready 信号
      listen_timeout: 10000,           // 启动超时 10 秒
      
      // 健康检查（可选）
      // instance_var: 'INSTANCE_ID',
    },
  ],
};
