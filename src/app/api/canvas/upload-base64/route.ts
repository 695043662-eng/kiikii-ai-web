import { NextRequest, NextResponse } from 'next/server';
import { uploadToCOS, isCOSConfigured } from '@/lib/cos';
import { validateBase64Image } from '@/lib/file-validator';
import { requireAuth } from '@/lib/auth-middleware';
import { sanitizeError } from '@/lib/sanitize-error';

/**
 * 上传 base64 图片到 COS
 * 用于分割图片等场景
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[Upload Base64] 开始处理上传请求');

  // 🔒 P0 鉴权：必须登录才能上传
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    // 检查 COS 配置是否完整
    if (!isCOSConfigured()) {
      console.error('[Upload Base64] 腾讯云 COS 未配置');
      return NextResponse.json(
        { success: false, error: '存储服务未配置，请联系管理员' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { images } = body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { success: false, error: '缺少图片数据' },
        { status: 400 }
      );
    }

    // 限制一次最多上传 20 张图片
    if (images.length > 20) {
      return NextResponse.json(
        { success: false, error: '一次最多上传 20 张图片' },
        { status: 400 }
      );
    }

    const results: Array<{ key: string; url: string }> = [];

    for (let i = 0; i < images.length; i++) {
      const base64Data = images[i];

      // 🔒 安全增强：使用魔数验证文件真实类型
      const validation = validateBase64Image(base64Data);

      if (!validation.valid) {
        console.warn(`[Upload Base64] 图片 ${i} 安全拦截:`, validation.error);
        continue;
      }

      if (!validation.buffer) {
        console.warn(`[Upload Base64] 图片 ${i} Buffer 为空`);
        continue;
      }

      // 使用验证后的真实 MIME 类型和扩展名
      const actualMimeType = validation.detectedType!.mime;
      const actualExt = validation.detectedType!.ext;
      const buffer = validation.buffer;

      // 检查文件大小
      const sizeInBytes = buffer.length;
      const maxSize = 20 * 1024 * 1024; // 20MB

      if (sizeInBytes > maxSize) {
        console.warn(`[Upload Base64] 图片 ${i} 过大: ${(sizeInBytes / 1024 / 1024).toFixed(2)}MB，跳过`);
        continue;
      }

      // 🛡️ #846 路径绑定 userId：防止越权覆盖他人文件
      const timestamp = Date.now();
      const uuid = Math.random().toString(36).substring(2, 15);
      const key = `canvas/split/${auth.userId}/${new Date().toISOString().slice(0, 7)}/${timestamp}-${uuid}-${i}.${actualExt}`;

      // 上传到 COS（使用真实的 MIME 类型）
      try {
        const result = await uploadToCOS(key, buffer, actualMimeType, 'temp');  // #804 画布上传→1号桶(临时)
        // #764 返回代理 URL 而非 COS 直连签名 URL
        results.push({
          key: result.key,
          url: `/api/canvas/image?key=${encodeURIComponent(result.key)}`,
        });
        console.log(`[Upload Base64] 图片 ${i} 上传成功: ${result.key}, 类型: ${actualMimeType}`);
      } catch (uploadError) {
        console.error(`[Upload Base64] 图片 ${i} 上传失败:`, uploadError);
      }
    }

    if (results.length === 0) {
      return NextResponse.json(
        { success: false, error: '所有图片上传失败' },
        { status: 500 }
      );
    }

    console.log(`[Upload Base64] 完成: ${results.length}/${images.length} 张图片，耗时 ${Date.now() - startTime}ms`);

    return NextResponse.json({
      success: true,
      images: results,
    });

  } catch (error: any) {
    console.error('[Upload Base64] 上传失败:', sanitizeError(error));
    return NextResponse.json(
      { success: false, error: '上传失败，请稍后重试' },
      { status: 500 }
    );
  }
}
