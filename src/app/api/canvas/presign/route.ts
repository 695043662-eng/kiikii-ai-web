import { NextRequest, NextResponse } from 'next/server';
import { getPresignedUploadUrl, isCOSConfigured, type AssetType } from '@/lib/cos';
import { requireAuth } from '@/lib/auth-middleware';
import { extractClientIp } from '@/lib/ip-rate-limit';

/**
 * 预签名上传 URL 生成 API
 *
 * 🔥 #804 大文件直传架构 + 双桶分离：
 * 后端只发"护照"（签名URL），不碰"行李"（文件实体）
 * 前端拿到签名URL后直接PUT上传到腾讯云COS，彻底绕过服务器请求体大小限制
 *
 * #804 双桶分离：
 * - assetType='temp' → 1号桶（AI临时素材，5天生命周期）
 * - assetType='perm' → 2号桶（VIP资产与系统固定资产，永久存储）
 *
 * 流程：
 * 1. 前端 POST /api/canvas/presign { contentType, extension, assetType }
 * 2. 后端根据 assetType 选择桶，返回 { objectKey, uploadUrl }
 * 3. 前端 PUT uploadUrl (文件二进制) → 直传COS
 * 4. 上传完成后，前端用 /api/canvas/image?key=objectKey 获取代理下载URL
 */

// Content-Type 白名单（安全防线：只允许图片/视频/音频）
const ALLOWED_CONTENT_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4',
];

// Content-Type → 扩展名映射
const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
};

// IP 限流：同一 IP 每分钟最多获取 20 次预签名URL
// 🛡️ #848 防内存泄漏：硬上限 + 周期清理
const MAX_IP_ENTRIES = 5000;
const ipRequestCounts = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = ipRequestCounts.get(ip);

  if (!record || now >= record.resetTime) {
    // 🛡️ 硬上限熔断：超过 MAX_IP_ENTRIES 时，惰性淘汰最旧的一半
    if (ipRequestCounts.size >= MAX_IP_ENTRIES) {
      const entries = [...ipRequestCounts.entries()].sort((a, b) => a[1].resetTime - b[1].resetTime);
      const cut = Math.floor(entries.length / 2);
      for (let i = 0; i < cut; i++) {
        ipRequestCounts.delete(entries[i][0]);
      }
      console.warn(`[Presign] IP限流Map达上限${MAX_IP_ENTRIES}，已淘汰${cut}条最旧记录`);
    }
    ipRequestCounts.set(ip, { count: 1, resetTime: now + 60000 });
    return { allowed: true, remaining: 19 };
  }

  if (record.count < 20) {
    record.count++;
    return { allowed: true, remaining: 20 - record.count };
  }

  return { allowed: false, remaining: 0 };
}

// 定期清理过期记录（🛡️ #848 增强版：含尺寸溢出保护）
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of ipRequestCounts.entries()) {
      if (now >= record.resetTime) {
        ipRequestCounts.delete(ip);
      }
    }
    // 🛡️ 二次防线：清理后仍超上限，强制淘汰最旧的一半
    if (ipRequestCounts.size > MAX_IP_ENTRIES) {
      const entries = [...ipRequestCounts.entries()].sort((a, b) => a[1].resetTime - b[1].resetTime);
      const cut = ipRequestCounts.size - Math.floor(MAX_IP_ENTRIES / 2);
      for (let i = 0; i < cut; i++) {
        ipRequestCounts.delete(entries[i][0]);
      }
      console.warn(`[Presign] IP限流Map周期清理后仍超限，强制淘汰${cut}条`);
    }
  }, 5 * 60 * 1000);
}

export async function POST(request: NextRequest) {
  try {
    // 🛡️ 鉴权：必须登录才能获取预签名 URL，防止匿名滥用
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth;

    // 检查 COS 配置
    if (!isCOSConfigured()) {
      return NextResponse.json(
        { success: false, error: '存储服务未配置' },
        { status: 500 }
      );
    }

    // IP 限流
    // 🔥 #849 修复：使用 extractClientIp 防止 IP 欺骗绕过限流
    const ip = extractClientIp(request);
    const rateLimit = checkRateLimit(ip);
    if (!rateLimit.allowed) {
      console.warn(`[Presign] IP 限流触发: ${ip}`);
      return NextResponse.json(
        { success: false, error: '请求过于频繁，请稍后再试' },
        { status: 429 }
      );
    }

    // 解析请求参数
    const body = await request.json();
    const { contentType, extension, assetType } = body as {
      contentType?: string;
      extension?: string;
      assetType?: AssetType;
    };

    if (!contentType) {
      return NextResponse.json(
        { success: false, error: '缺少 contentType 参数' },
        { status: 400 }
      );
    }

    // 安全检查：Content-Type 白名单
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      console.warn(`[Presign] 拒绝不支持的 Content-Type: ${contentType}, IP: ${ip}`);
      return NextResponse.json(
        { success: false, error: `不支持的文件类型: ${contentType}` },
        { status: 400 }
      );
    }

    // #804 双桶分离：根据 assetType 路由到不同桶
    const resolvedAssetType: AssetType = assetType === 'perm' ? 'perm' : 'temp';

    // 🛡️ #846 路径绑定 userId：防止越权覆盖他人文件
    // 旧路径: canvas/2025-07/1234567890-abc123.jpg  → 任何人可猜路径覆盖
    // 新路径: canvas/users/{userId}/2025-07/1234567890-abc123.jpg  → 用户只能往自己目录写
    const ext = extension || CONTENT_TYPE_TO_EXT[contentType] || contentType.split('/')[1] || 'bin';
    const timestamp = Date.now();
    const uuid = Math.random().toString(36).substring(2, 15);
    const key = `canvas/users/${userId}/${new Date().toISOString().slice(0, 7)}/${timestamp}-${uuid}.${ext}`;

    // 生成预签名上传 URL（传入 assetType 决定桶）
    const { objectKey, uploadUrl } = await getPresignedUploadUrl(key, contentType, 3600, resolvedAssetType);

    console.log('[Presign] 生成成功:', {
      objectKey,
      contentType,
      assetType: resolvedAssetType,
      bucket: resolvedAssetType === 'perm' ? '2号桶(永久)' : '1号桶(临时)',
      ip,
      remaining: rateLimit.remaining,
    });

    return NextResponse.json({
      success: true,
      objectKey,
      uploadUrl,
      assetType: resolvedAssetType,
      // 🛡️ #806 告诉前端是否需要发送 Cache-Control 头（perm 桶需要）
      cacheControl: resolvedAssetType === 'perm' ? 'max-age=31536000, public' : undefined,
    });
  } catch (error: unknown) {
    console.error('[Presign] 生成失败:', error);
    const errorMessage = error instanceof Error ? '生成上传凭证失败' : '生成上传凭证失败';  // 🔒 P0 脱敏
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
