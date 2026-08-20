import { NextRequest, NextResponse } from 'next/server';
import { uploadToCOS, uploadToCOSFromStream, isCOSConfigured, type AssetType } from '@/lib/cos';
import { requireAuth } from '@/lib/auth-middleware';
import { sanitizeError } from '@/lib/sanitize-error';
import { Readable } from 'stream';

/**
 * 画布图片上传 API（服务端中转 → COS）
 * 
 * 接收前端 FormData 中的文件，上传到腾讯云 COS 对象存储
 * 返回签名 URL 和 objectKey
 * 
 * 全站统一上传接口：画布/生图/轮播/卡片/音频全部走此接口
 * 
 * 🔥 性能优化：大文件使用流式上传，避免 OOM
 * - 小文件（<5MB）：Buffer 方式（简单可靠）
 * - 大文件（>=5MB）：Stream 方式（边读边传，内存友好）
 * 
 * #804 双桶分离：
 * - assetType='temp' → 1号桶（AI临时素材，5天生命周期）
 * - assetType='perm' → 2号桶（VIP资产与系统固定资产，永久存储）
 */

// Content-Type → 扩展名映射
const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/webm': 'weba',
};

// 🔒 P1 安全加固：允许的文件类型白名单（MIME 声明校验，魔数校验由 validateUploadedFile 完成）
const ALLOWED_MIME_PREFIXES = [
  'image/',   // jpeg/png/gif/webp
  'video/',   // mp4/webm/mov
  'audio/',   // mp3/wav/ogg/m4a
];

// 🔒 P1 安全加固：文件体积上限（与 file-validator.ts 统一标准）
const MAX_IMAGE_SIZE = 50 * 1024 * 1024;   // 50MB
const MAX_VIDEO_SIZE = 500 * 1024 * 1024;  // 500MB
const MAX_AUDIO_SIZE = 50 * 1024 * 1024;   // 50MB

// 流式上传阈值：5MB 以上的文件用流式传输
const STREAM_THRESHOLD = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[Canvas Upload] 收到文件上传请求');

  // 🔒 P0 鉴权：必须登录才能上传
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    // 检查 COS 配置
    if (!isCOSConfigured()) {
      console.error('[Canvas Upload] COS 未配置');
      return NextResponse.json(
        { success: false, error: '存储服务未配置，请联系管理员' },
        { status: 500 }
      );
    }

    // 解析 FormData
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (formError: any) {
      console.error('[Canvas Upload] FormData 解析失败:', formError.message);
      return NextResponse.json(
        { success: false, error: '请求解析失败，文件可能过大' },
        { status: 400 }
      );
    }

    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json(
        { success: false, error: '缺少文件参数' },
        { status: 400 }
      );
    }

    // #804 双桶分离：从 FormData 或 URL query params 中读取 assetType
    const assetTypeRaw = (formData.get('assetType') as string | null) || request.nextUrl.searchParams.get('assetType');
    const assetType: AssetType = assetTypeRaw === 'perm' ? 'perm' : 'temp';

    const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
    console.log('[Canvas Upload] 文件信息:', {
      name: file.name,
      size: `${fileSizeMB}MB`,
      type: file.type,
      assetType,
      bucket: assetType === 'perm' ? '2号桶(永久)' : '1号桶(临时)',
    });

    // 🔒 P1 安全加固：MIME 类型白名单校验（声明类型第一道防线）
    const declaredMime = file.type || '';
    const isAllowedMime = ALLOWED_MIME_PREFIXES.some(prefix => declaredMime.startsWith(prefix));
    if (!isAllowedMime) {
      console.warn('[Canvas Upload] 拒绝上传: MIME类型不在白名单', declaredMime);
      return NextResponse.json(
        { success: false, error: `不支持的文件类型: ${declaredMime || '未知'}` },
        { status: 400 }
      );
    }

    // 🔒 P1 安全加固：文件体积拦截（与 file-validator 统一：图片50MB/视频500MB/音频50MB）
    const isVideo = declaredMime.startsWith('video/');
    const isAudio = declaredMime.startsWith('audio/');
    const maxSize = isVideo ? MAX_VIDEO_SIZE : isAudio ? MAX_AUDIO_SIZE : MAX_IMAGE_SIZE;
    const maxLabel = isVideo ? '500MB' : isAudio ? '50MB' : '50MB';
    if (file.size > maxSize) {
      console.warn('[Canvas Upload] 拒绝上传: 文件过大', fileSizeMB, 'MB');
      return NextResponse.json(
        { success: false, error: `文件过大（${fileSizeMB}MB），超过${maxLabel}限制` },
        { status: 400 }
      );
    }

    const contentType = file.type || 'image/png';
    
    // 🛡️ #846 路径绑定 userId：防止越权覆盖他人文件
    const ext = CONTENT_TYPE_TO_EXT[contentType] || contentType.split('/')[1] || 'bin';
    const timestamp = Date.now();
    const uuid = Math.random().toString(36).substring(2, 15);
    const key = `canvas/users/${userId}/${new Date().toISOString().slice(0, 7)}/${timestamp}-${uuid}.${ext}`;

    let result: { key: string; url: string };

    if (file.size >= STREAM_THRESHOLD) {
      // 🔥 大文件：流式上传，避免 OOM
      console.log(`[Canvas Upload] 大文件(${fileSizeMB}MB)，使用流式上传 → ${assetType === 'perm' ? '2号桶' : '1号桶'}`);
      const webStream = file.stream();
      const nodeStream = Readable.fromWeb(webStream as any);
      result = await uploadToCOSFromStream(key, nodeStream, file.size, contentType, assetType);
    } else {
      // 小文件：Buffer 方式（简单可靠）
      const buffer = Buffer.from(await file.arrayBuffer());
      result = await uploadToCOS(key, buffer, contentType, assetType);
    }
    
    console.log('[Canvas Upload] 上传成功:', {
      key: result.key,
      mode: file.size >= STREAM_THRESHOLD ? 'stream' : 'buffer',
      assetType,
      duration: `${Date.now() - startTime}ms`,
    });

    return NextResponse.json({
      success: true,
      url: result.url,
      key: result.key,
    });

  } catch (error: any) {
    console.error('[Canvas Upload] 全局异常:', sanitizeError(error));
    return NextResponse.json(
      { success: false, error: '上传失败，请稍后重试' },
      { status: 500 }
    );
  }
}
