import { NextRequest, NextResponse } from 'next/server';

/**
 * #806 图片代理路由的动态缓存策略
 *
 * next.config.ts 的 headers() 是静态的，无法按请求参数区分缓存策略。
 * 而 /api/canvas/image 需要：
 *   - perm 资产（展示区/轮播图）：public, max-age=31536000, immutable（纯净CDN URL，1年缓存）
 *   - temp 资产（AI 生成素材）：public, max-age=300, stale-while-revalidate=3600（5分钟缓存+LRU窗口对齐）
 *
 * 注意：canvas/image/route.ts 也会在响应中设置 Cache-Control，
 * route 层的设置会覆盖 middleware 层的值（两者保持一致即可）。
 */
export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // 只处理图片/视频代理路由
  if (pathname !== '/api/canvas/image') {
    return NextResponse.next();
  }

  const assetType = searchParams.get('assetType');

  // perm 资产：1年 immutable（纯净 CDN URL，无签名参数变化，永久缓存）
  // temp 资产：5分钟 + 1小时 stale-while-revalidate（签名 URL 在 LRU 缓存窗口 45 分钟内固定）
  const cacheControl =
    assetType === 'perm'
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=300, stale-while-revalidate=3600';

  const response = NextResponse.next();
  response.headers.set('Cache-Control', cacheControl);
  // 清除 next.config.ts 设置的 Pragma 和 Expires
  response.headers.delete('Pragma');
  response.headers.delete('Expires');
  return response;
}

export const config = {
  // 只匹配 /api/canvas/image 路由
  matcher: '/api/canvas/image',
};
