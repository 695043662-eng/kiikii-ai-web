import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // 【生产环境】开启 standalone 输出，大幅减小部署体积
  output: 'standalone',

  // outputFileTracingRoot: path.resolve(__dirname, '../../'),
  /* config options here */
  allowedDevOrigins: ['*.dev.coze.site'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lf-coze-web-cdn.coze.cn',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'code.coze.cn',
        pathname: '/**',
      },
      // COS 对象存储（首页展示区/轮播图/用户生成图片）
      {
        protocol: 'https',
        hostname: '**.myqcloud.com',
        pathname: '/**',
      },
      // CDN 域名（首页展示区/轮播图图片直连）
      {
        protocol: 'https',
        hostname: 'assets.kiikii.me',
        pathname: '/**',
      },
      // 本地 API 代理路由（/api/canvas/image 等）
      {
        protocol: 'https',
        hostname: '**.kiikii.me',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '**.coze.site',
        pathname: '/**',
      },
    ],
  },
  // 增加 Server Actions 和 Route Handlers 的请求体大小限制
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  // 增加 API Route 的请求体大小限制
  serverExternalPackages: ['@node-rs/argon2', 'pg'],

  // webpack 配置
  webpack: (config, { isServer }) => {
    // 修复 @supabase/storage-js@2.105+ 引入 iceberg-js 导致构建失败
    // iceberg-js 是 Apache Iceberg 数据湖格式客户端，项目不需要此功能
    config.resolve.alias = {
      ...config.resolve.alias,
      'iceberg-js': false,
    };

    // 修复 pnpm 符号链接结构下 react-remove-scroll 找不到 use-sidecar 的问题
    // pnpm 的 node_modules 隔离结构导致 webpack 无法通过符号链接解析嵌套依赖
    config.resolve.alias['use-sidecar'] = path.resolve(__dirname, 'node_modules/use-sidecar');

    return config;
  },

  // 🛡️ 缓存策略（#806）：区分动态数据API和静态资产代理
  // - 动态数据API（showcase/carousel/user等）：no-store，每次请求最新数据
  // - 静态资产代理（/api/canvas/image）：perm资产缓存50分钟减少刷新重复下载
  // Next.js headers() 按顺序匹配，后面的规则覆盖前面同 key 的值
  async headers() {
    return [
      {
        // 首页 HTML：彻底拒绝缓存，每次打开新标签页都请求服务器最新版本
        source: '/',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
      {
        // 所有 API 路由（默认）：彻底拒绝缓存，防止中间层缓存过时数据
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
    ];
  },
};

export default nextConfig;
