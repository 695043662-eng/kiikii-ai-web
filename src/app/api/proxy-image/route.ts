import { NextRequest, NextResponse } from 'next/server';
import { downloadFromCOS, getSignedUrl } from '@/lib/cos';
import { validateUrl } from '@/lib/url-validator';
import { requireAuth } from '@/lib/auth-middleware';
import type { AssetType } from '@/lib/cos';

/**
 * #868 根据 COS key 前缀推断 assetType
 * ⚠️ 废除 dev/prod 死绑 perm！用户刚上传的图片初始在 temp 桶！
 * dev/ 和 prod/ 前缀：先试 temp（上传默认桶），找不到会由双向回退兜底试 perm
 * perm/ 前缀：确定在 perm 桶
 * showcase/ 前缀：确定在 perm 桶（展示区永久资产）
 * temp/ 前缀：确定在 temp 桶
 */
function inferAssetType(key: string): AssetType {
  if (key.startsWith('perm/') || key.startsWith('showcase/')) return 'perm';
  return 'temp'; // dev/, prod/, temp/ 一律先试 temp
}

export async function GET(request: NextRequest) {
  try {
    // 🛡️ SSRF 防御：代理路由必须鉴权，防止匿名用户当开放代理
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth;

    const searchParams = request.nextUrl.searchParams;
    const imageUrl = searchParams.get('url');
    const cosKey = searchParams.get('key'); // COS key 参数

    // 如果提供了 COS key，从 COS 获取图片
    if (cosKey) {
      console.log('=== 通过 COS Key 获取图片 ===');
      console.log('COS Key:', cosKey);

      // 🔒 安全增强：验证 COS key 格式（防止路径穿越）
      if (cosKey.includes('..') || cosKey.startsWith('/') || cosKey.includes('//')) {
        console.warn('[proxy-image] 安全拦截: 无效的 COS key');
        return NextResponse.json({ error: 'Invalid COS key' }, { status: 400 });
      }

      // #867 根据 key 前缀推断 assetType（dev/prod/perm → perm，其余 → temp）
      const assetType = inferAssetType(cosKey);

      try {
        // 获取签名 URL（使用推断的 assetType，而非默认 temp）
        console.log('[proxy-image] 正在获取签名 URL, key:', cosKey, 'assetType:', assetType);
        const signedUrl = await getSignedUrl(cosKey, 3600, assetType); // 1小时有效
        console.log('[proxy-image] 签名 URL:', typeof signedUrl === 'string' ? signedUrl.substring(0, 100) : JSON.stringify(signedUrl));

        // 获取图片（流式代理，避免 arrayBuffer 打满 2C2G 内存）
        let response = await fetch(signedUrl as string);
        
        // #867 双向桶回退：perm→temp / temp→perm，任何一桶 404 自动回退另一桶
        if (!response.ok && response.status === 404) {
          const fallbackAssetType: AssetType = assetType === 'perm' ? 'temp' : 'perm';
          console.log(`[proxy-image] #867 ${assetType}桶未找到，尝试${fallbackAssetType}桶:`, cosKey);
          try {
            const fallbackUrl = await getSignedUrl(cosKey, 3600, fallbackAssetType);
            response = await fetch(fallbackUrl as string);
          } catch (fallbackErr) {
            console.error(`[proxy-image] #867 ${fallbackAssetType}桶回退失败:`, fallbackErr);
          }
        }
        
        if (!response.ok) {
          console.error('COS 获取图片失败:', response.status);
          return NextResponse.json(
            { error: 'Failed to fetch from COS' },
            { status: response.status }
          );
        }

        const contentType = response.headers.get('content-type') || 'image/png';
        const contentLength = response.headers.get('content-length');

        // #842 COS 计费风暴止血：1天 immutable（服务端转发图片也必须让浏览器缓存）
        const proxyHeaders: Record<string, string> = {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400, immutable',
          'Access-Control-Allow-Origin': '*', // #842 CORS：防止 Tainted Canvas
        };
        if (contentLength) {
          proxyHeaders['Content-Length'] = contentLength;
        }

        return new NextResponse(response.body, {
          headers: proxyHeaders,
        });
      } catch (cosError) {
        console.error('COS 获取图片失败:', cosError);
        return NextResponse.json(
          { error: 'Failed to fetch from COS', message: cosError instanceof Error ? cosError.message : 'Unknown error' },
          { status: 500 }
        );
      }
    }

    // 原有的 URL 代理逻辑
    if (!imageUrl) {
      return NextResponse.json({ error: 'URL or key parameter is required' }, { status: 400 });
    }

    // 🔒 安全增强：SSRF 防护 - 使用异步验证（含 DNS 重绑定检测）
    const urlValidation = await validateUrl(imageUrl, {
      allowPrivateIP: false,   // 禁止访问私有 IP
      allowAnyDomain: false,   // 强制域名白名单
    });
    if (!urlValidation.valid) {
      console.warn('[proxy-image] 安全拦截 - SSRF 防护:', urlValidation.error, '| URL:', imageUrl.substring(0, 100));
      return NextResponse.json(
        { error: 'URL 不在允许的白名单中，禁止访问' },
        { status: 403 }
      );
    }

    console.log('=== 代理图片请求 ===');
    console.log('图片 URL:', imageUrl.substring(0, 100));

    // 尝试从多个位置获取 API Key
    // 1. 从 URL query 参数获取
    let apiKey = searchParams.get('apiKey');

    // 2. 从请求头获取（用于直接调用的情况）
    if (!apiKey) {
      apiKey = request.headers.get('x-api-key');
    }

    console.log('API Key:', apiKey ? '已提供' : '未提供');

    const headers: HeadersInit = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };

    // 如果提供了 API Key，添加到请求头
    if (apiKey) {
      headers['Authorization'] = apiKey;
      headers['TenantId'] = '000000';
    }

    console.log('发送请求头:', headers);

    // 代理请求原始图片，添加更多配置
    const response = await fetch(imageUrl, {
      headers,
      // 添加超时设置
      signal: AbortSignal.timeout(30000),
    });

    console.log('图片响应状态:', response.status, response.statusText);

    if (!response.ok) {
      console.error('图片代理请求失败:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('错误响应 (前500字符):', errorText.substring(0, 500));
      return NextResponse.json(
        { error: `Failed to fetch image: ${response.status} ${response.statusText}`, details: errorText.substring(0, 200) },
        { status: response.status }
      );
    }

    // 流式代理，避免 arrayBuffer 打满 2C2G 内存
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const contentLength = response.headers.get('content-length');

    const proxyHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, immutable', // #842 COS 计费风暴止血
      'Access-Control-Allow-Origin': '*', // #842 CORS：防止 Tainted Canvas
    };
    if (contentLength) {
      proxyHeaders['Content-Length'] = contentLength;
    }

    return new NextResponse(response.body, {
      headers: proxyHeaders,
    });
  } catch (error) {
    console.error('[proxy-image] 代理异常:', error instanceof Error ? error.message : '未知错误');

    // 返回脱敏错误信息（禁止泄露内部堆栈）
    return NextResponse.json(
      { error: '图片代理请求失败' },
      { status: 500 }
    );
  }
}
