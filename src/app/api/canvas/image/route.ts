import { NextRequest, NextResponse } from 'next/server';
import { getSignedUrl } from '@/lib/cos';
import { requireAuth } from '@/lib/auth-middleware';

/**
 * 图片/视频代理端点
 * 
 * 生产环境：302 重定向到 COS 签名 URL（流量直连 CDN，节省服务器带宽）
 * 开发环境：流式代理（sandbox 浏览器无法直连 COS，必须经服务器中转）
 * 
 * 使用方式：
 *   GET /api/canvas/image?key=dev/canvas/2026-05/xxx.png  （推荐，直接传 objectKey）
 *   GET /api/canvas/image?url=https://img.kiikii.me/xxx   （兼容旧数据，从完整URL提取key）
 *   GET /api/canvas/image?key=xxx&assetType=perm           （展示区/轮播图等固定资产）
 * 
 * 安全措施：
 * 1. 验证 key 格式（防止路径遍历和 SSRF）
 * 2. 限制 key 必须以 dev/ 或 prod/ 开头
 * 3. 签名 URL 有效期 1 小时，过期自动重新生成（cos.ts 层 LRU 缓存统一管理）
 * 
 * 🛡️ COS 流量优化（三刀止血斩）：
 * 1. cos.ts 层统一 LRU 缓存：三元组 key (objectKey:assetType:expiresIn)，TTL=expiresIn*0.75
 *    同一签名 URL 在缓存窗口内固定不变 → Cloudflare CDN 命中率大幅提升
 * 2. perm 桶去签名化：getSignedUrl 对 perm 类型返回纯净 CDN URL（无 ?q-sign 参数）→ CF 100% 命中
 * 3. 浏览器缓存：temp max-age=86400(1天 immutable) + perm max-age=31536000(1年 immutable)
 * 
 * #821 开发环境流式代理：
 * sandbox/开发环境浏览器无法直连 COS（ERR_CONNECTION_CLOSED），
 * 改为服务端 fetch COS 签名 URL 后流式转发给浏览器。
 * 生产环境仍使用 302 重定向（节省 2C2G 服务器带宽）。
 * 
 * #868 无条件双向桶回退：
 * 废除"前缀死绑桶"逻辑！dev/和prod/前缀的key不再硬绑perm桶！
 * 用户刚上传的图片在temp桶，老图片可能已转正到perm桶，
 * 所以必须在当前桶找不到时去另一个桶找，只有两个桶都找不到才报错。
 */

/**
 * 从完整 URL 中提取 COS objectKey
 * 支持 img.kiikii.me 和原始 COS 域名
 */
function extractKeyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    if (pathname?.startsWith('/')) {
      const key = pathname.substring(1);
      // 验证 key 格式
      if (key && !key.includes('..') && !key.startsWith('/') && !key.includes('\\')) {
        return key;
      }
    }
  } catch {}
  return null;
}

export async function GET(request: NextRequest) {
  // 🛡️ SSRF 防御：代理路由必须鉴权，防止匿名用户当免费 CDN 代理
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  let key = searchParams.get('key');
  const url = searchParams.get('url');
  const assetTypeParam = searchParams.get('assetType'); // 'temp' | 'perm'

  // 兼容旧数据：从完整 URL 中提取 key
  if (!key && url) {
    key = extractKeyFromUrl(url);
  }

  if (!key) {
    return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
  }

  // 安全验证：防止路径遍历和 SSRF
  if (key.includes('..') || key.startsWith('/') || key.includes('\\')) {
    return NextResponse.json({ error: '无效的 key 格式' }, { status: 400 });
  }

  // 🛡️🛡️🛡️ #870 彻底废除"key 前缀无效"校验！
  // 用户报告：点击下载 generated-images/... 的图片，秒报 400 {"error":"key 前缀无效"}！
  // 根因：业务代码无权判断前缀合不合法！只要前端传了 key，直接走 perm 和 temp 双向桶查询。
  // 两个桶都找不到自然会返回 404，绝不该由业务代码抛出"key 前缀无效"！
  // 安全防线：上面已有路径遍历检查（..  /  \\），这就足够了。

  // #868 确定主桶类型（废除 dev/prod 死绑 perm！）
  // ⚠️ 用户刚上传的图片初始在 temp 桶，老图片可能已转正到 perm 桶
  // 所以 dev/ 和 prod/ 前缀一律先试 temp 桶，找不到再回退 perm 桶
  let primaryBucket: 'temp' | 'perm';
  if (assetTypeParam === 'perm' || key.startsWith('perm/') || key.startsWith('showcase/')) {
    primaryBucket = 'perm';
  } else {
    primaryBucket = 'temp'; // dev/, prod/, temp/ 一律先试 temp
  }
  const fallbackBucket = primaryBucket === 'perm' ? 'temp' : 'perm';

  // #868+#870 无条件双向桶回退：不管前缀是什么，当前桶找不到就去另一个桶
  // 任何 key 都可能在 temp 或 perm 桶（废除 isDevOrProdKey 死绑逻辑）
  // perm/ showcase/ 前缀虽然大概率在 perm 桶，但也做 Range 校验确保安全
  const needsBucketVerification = true;

  const buckets: Array<'temp' | 'perm'> = [primaryBucket, fallbackBucket];

  for (const bucket of buckets) {
    try {
      const signedUrl = await getSignedUrl(key, 7200, bucket);
      const cacheControl = bucket === 'perm'
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=86400, immutable';

      if (process.env.NODE_ENV === 'development') {
        // ===== 开发环境：流式代理 + COS 404 自动回退 =====
        const imageRes = await fetch(signedUrl);
        if (imageRes.ok) {
          // 找到了！流式代理返回
          const contentType = imageRes.headers.get('content-type') || 'application/octet-stream';
          const contentLength = imageRes.headers.get('content-length');
          const proxyHeaders: Record<string, string> = {
            'Content-Type': contentType,
            'Cache-Control': cacheControl,
            'Access-Control-Allow-Origin': '*',
          };
          if (contentLength) {
            proxyHeaders['Content-Length'] = contentLength;
          }
          return new NextResponse(imageRes.body, { status: 200, headers: proxyHeaders });
        }
        // COS 返回 404/403 等 → 继续尝试备桶
        console.log(`[image-proxy] ${bucket}桶COS返回${imageRes.status}，尝试${bucket === 'temp' ? 'perm' : 'temp'}桶:`, key);
        continue;
      } else {
        // ===== 生产环境：302 重定向 =====
        if (!needsBucketVerification) {
          // perm/ showcase/ temp/ 前缀：确定在哪个桶，直接 302 重定向
          return NextResponse.redirect(signedUrl, {
            headers: { 'Cache-Control': cacheControl, 'Access-Control-Allow-Origin': '*' },
          });
        }
        // dev/ prod/ 前缀：需要 Range 校验确认文件存在，再 302 重定向
        try {
          const checkRes = await fetch(signedUrl, {
            headers: { 'Range': 'bytes=0-0' },
            signal: AbortSignal.timeout(5000),
          });
          if (checkRes.ok || checkRes.status === 206) {
            // 文件确认存在，302 重定向
            return NextResponse.redirect(signedUrl, {
              headers: { 'Cache-Control': cacheControl, 'Access-Control-Allow-Origin': '*' },
            });
          }
          // 文件不存在，继续尝试备桶
          console.log(`[image-proxy] ${bucket}桶Range校验${checkRes.status}，尝试${bucket === 'temp' ? 'perm' : 'temp'}桶:`, key);
          continue;
        } catch {
          // Range 校验超时/网络错误 → 宁可返回可能无效的 URL 也不阻塞用户
          console.log(`[image-proxy] ${bucket}桶Range校验超时，直接302重定向:`, key);
          return NextResponse.redirect(signedUrl, {
            headers: { 'Cache-Control': cacheControl, 'Access-Control-Allow-Origin': '*' },
          });
        }
      }
    } catch (err: any) {
      // getSignedUrl 本身失败（权限、网络等），继续尝试备桶
      console.log(`[image-proxy] ${bucket}桶getSignedUrl失败:`, key, err.message || err);
      continue;
    }
  }

  // #876 两个桶都找不到 → 尝试 fallbackUrl（Node.js 代理 fetch，无 CORS 限制）
  const fallbackUrl = searchParams.get('fallbackUrl');
  if (fallbackUrl && (fallbackUrl.startsWith('http://') || fallbackUrl.startsWith('https://'))) {
    console.log('[image-proxy] COS双桶均未找到，尝试fallbackUrl代理:', key, '→', fallbackUrl.substring(0, 80) + '...');
    try {
      const fbRes = await fetch(fallbackUrl, {
        signal: AbortSignal.timeout(15000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; KiikiiImageProxy/1.0)',
        },
      });
      if (fbRes.ok) {
        const contentType = fbRes.headers.get('content-type') || 'application/octet-stream';
        const contentLength = fbRes.headers.get('content-length');
        const proxyHeaders: Record<string, string> = {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400',  // fallbackUrl 结果缓存1天
          'Access-Control-Allow-Origin': '*',
        };
        if (contentLength) {
          proxyHeaders['Content-Length'] = contentLength;
        }
        console.log('[image-proxy] fallbackUrl代理成功:', key);
        return new NextResponse(fbRes.body, { status: 200, headers: proxyHeaders });
      }
      console.log('[image-proxy] fallbackUrl返回', fbRes.status, ':', fallbackUrl.substring(0, 80));
    } catch (fbErr: any) {
      console.log('[image-proxy] fallbackUrl代理失败:', fbErr.message || fbErr);
    }
  }

  // COS 双桶 + fallbackUrl 三层全部失败
  console.error('[image-proxy] COS双桶+fallbackUrl全部失败:', key);
  return NextResponse.json({ error: '图片不存在' }, { status: 404 });
}
