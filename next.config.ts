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
    ],
  },
  // 增加 Server Actions 和 Route Handlers 的请求体大小限制
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  // 增加 API Route 的请求体大小限制
  serverExternalPackages: ['@node-rs/argon2'],
};

export default nextConfig;
