import { NextRequest, NextResponse } from 'next/server';
import { validateUrl } from '@/lib/url-validator';
import { requireAuth } from '@/lib/auth-middleware';

/**
 * 视频流代理路由（安全加固版）
 * 
 * 安全措施：
 * 1. SSRF 防护：强制 URL 白名单 + DNS 重绑定检测 + 私有 IP 拦截
 * 2. #890 终极清扫：requireAuth 硬鉴权，杜绝匿名代理
 * 3. CORS 限制：仅允许 kiikii.me 域名跨域访问
 * 
 * 使用方式：
 * GET /api/video/proxy?url=https://service-provider.com/video.mp4
 */
export async function GET(request: NextRequest) {
  // ====== CORS 预检 ======
  const origin = request.headers.get('origin') || '';
  const allowedOrigins = ['https://kiikii.me', 'http://localhost:3000', 'http://localhost:5000'];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : 'https://kiikii.me';

  // #890 终极清扫：使用 requireAuth 替代手动 cookie 检查
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const videoUrl = searchParams.get('url');

  if (!videoUrl) {
    return NextResponse.json(
      { error: '缺少必要参数：url' },
      { status: 400, headers: { 'Access-Control-Allow-Origin': corsOrigin } }
    );
  }

  // ====== SSRF 防护：URL 白名单 + 私有 IP 拦截 ======
  const urlValidation = await validateUrl(videoUrl, {
    allowPrivateIP: false,   // 禁止访问私有 IP
    allowAnyDomain: false,   // 强制域名白名单
  });

  if (!urlValidation.valid) {
    console.warn('[视频代理] URL 安全验证失败:', videoUrl.substring(0, 100), urlValidation.error);
    return NextResponse.json(
      { error: '视频源地址不在允许的域名白名单中' },
      { status: 403, headers: { 'Access-Control-Allow-Origin': corsOrigin } }
    );
  }

  try {
    // 在后端请求原始视频
    const response = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `视频源请求失败: ${response.status}` },
        { status: response.status, headers: { 'Access-Control-Allow-Origin': corsOrigin } }
      );
    }

    const videoStream = response.body;
    if (!videoStream) {
      return NextResponse.json(
        { error: '视频源返回空内容' },
        { status: 500, headers: { 'Access-Control-Allow-Origin': corsOrigin } }
      );
    }

    // 返回视频流
    return new Response(videoStream, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Access-Control-Allow-Origin': corsOrigin,
        'Cache-Control': 'public, max-age=604800, immutable', // #842 COS 计费风暴止血：7天 immutable
        'X-Accel-Buffering': 'no',
      },
    });

  } catch (error) {
    console.error('[视频代理] 代理异常:', error);
    return NextResponse.json(
      { error: '视频代理失败', details: error instanceof Error ? error.message : '未知错误' },
      { status: 500, headers: { 'Access-Control-Allow-Origin': corsOrigin } }
    );
  }
}

// OPTIONS 预检请求处理
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin') || '';
  const allowedOrigins = ['https://kiikii.me', 'http://localhost:3000', 'http://localhost:5000'];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : 'https://kiikii.me';

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-session',
      'Access-Control-Max-Age': '86400',
    },
  });
}
