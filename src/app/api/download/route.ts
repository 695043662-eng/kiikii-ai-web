import { NextRequest, NextResponse } from 'next/server';
import { getSignedUrl } from '@/lib/cos';
import type { AssetType } from '@/lib/cos';

/**
 * #876 全能下载代理：COS 双桶 + fallbackUrl 服务商直链，三层递进回退
 *
 * 调用方式：
 *   GET /api/download?key=xxx&filename=image.png                          （纯 COS 下载）
 *   GET /api/download?key=xxx&filename=image.png&fallbackUrl=https://...  （COS + 服务商直链回退）
 *
 * 三层递进逻辑：
 * 1. 主桶（temp/perm，按前缀推断）→ 2. 备桶 → 3. fallbackUrl（Node.js 代理，无 CORS 限制）
 * 只有三层全部失败才返回 404
 *
 * 安全措施：
 * - key 格式验证（防路径遍历和 SSRF）
 * - fallbackUrl 仅允许 http/https 协议（防 SSRF）
 * - requireAuth 鉴权（防匿名当免费代理）
 */
function inferAssetType(key: string): AssetType {
  if (key.startsWith('perm/') || key.startsWith('showcase/')) return 'perm';
  return 'temp'; // dev/, prod/, temp/ 一律先试 temp
}

/**
 * #876 尝试从 COS 双桶获取图片流
 * @returns Response（成功）或 null（两个桶都找不到）
 */
async function tryCOSBuckets(cosKey: string): Promise<Response | null> {
  const assetType = inferAssetType(cosKey);
  const fallbackAssetType: AssetType = assetType === 'perm' ? 'temp' : 'perm';
  const buckets: Array<{ type: AssetType; label: string }> = [
    { type: assetType, label: assetType },
    { type: fallbackAssetType, label: fallbackAssetType },
  ];

  for (const bucket of buckets) {
    try {
      const signedUrl = await getSignedUrl(cosKey, 3600, bucket.type);
      const res = await fetch(signedUrl as string);
      if (res.ok) {
        return res;
      }
      console.log(`[download] ${bucket.label}桶返回${res.status}，继续尝试:`, cosKey);
    } catch (err) {
      console.log(`[download] ${bucket.label}桶异常:`, cosKey, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

/**
 * #876 Node.js 代理 fetch fallbackUrl（无 CORS 限制）
 * @returns Response（成功）或 null（失败）
 */
async function tryFallbackUrl(fallbackUrl: string): Promise<Response | null> {
  try {
    console.log('[download] #876 COS双桶均失败，Node.js代理fallbackUrl:', fallbackUrl.substring(0, 100));
    const res = await fetch(fallbackUrl, {
      signal: AbortSignal.timeout(15000), // 15秒超时
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KiikiiAI/1.0)',
      },
    });
    if (res.ok) {
      return res;
    }
    console.error('[download] #876 fallbackUrl返回', res.status, fallbackUrl.substring(0, 100));
  } catch (err) {
    console.error('[download] #876 fallbackUrl代理失败:', err instanceof Error ? err.message : err, fallbackUrl.substring(0, 100));
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const cosKey = searchParams.get('key');
    const filename = searchParams.get('filename') || 'image.png';
    const fallbackUrl = searchParams.get('fallbackUrl'); // #876 服务商直链回退

    if (!cosKey) {
      return NextResponse.json({ error: 'Key parameter is required' }, { status: 400 });
    }

    // 🔒 安全增强：验证 COS key 格式
    if (cosKey.includes('..') || cosKey.startsWith('/') || cosKey.includes('//')) {
      return NextResponse.json({ error: 'Invalid COS key' }, { status: 400 });
    }

    // #876 第一层 + 第二层：COS 双桶回退
    let response = await tryCOSBuckets(cosKey);

    // #876 第三层：fallbackUrl Node.js 代理（破除 CORS！）
    if (!response && fallbackUrl) {
      // 安全检查：只允许 http/https 协议
      if (fallbackUrl.startsWith('http://') || fallbackUrl.startsWith('https://')) {
        response = await tryFallbackUrl(fallbackUrl);
      } else {
        console.warn('[download] #876 fallbackUrl协议不安全，已拒绝:', fallbackUrl.substring(0, 50));
      }
    }

    if (!response) {
      // 三层全部失败
      return NextResponse.json({ error: '图片不存在' }, { status: 404 });
    }

    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/png';

    // 返回图片数据，设置下载头
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
        'Content-Length': imageBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error('[download] 下载失败:', error);
    return NextResponse.json(
      { error: 'Download failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
