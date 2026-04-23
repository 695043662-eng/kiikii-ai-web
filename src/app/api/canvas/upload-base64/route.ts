import { NextRequest, NextResponse } from 'next/server';
import { uploadToCOS, isCOSConfigured } from '@/lib/cos';

/**
 * 上传 base64 图片到 COS
 * 用于分割图片等场景
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[Upload Base64] 开始处理上传请求');

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

      // 提取 base64 数据（去掉 data:image/xxx;base64, 前缀）
      let base64Content = base64Data;
      let mimeType = 'image/png';

      if (base64Data.includes(',')) {
        const [prefix, content] = base64Data.split(',');
        base64Content = content;

        // 从前缀中提取 MIME 类型
        const mimeMatch = prefix.match(/data:(image\/[^;]+);/);
        if (mimeMatch) {
          mimeType = mimeMatch[1];
        }
      }

      // 验证 MIME 类型
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedMimeTypes.includes(mimeType)) {
        mimeType = 'image/png'; // 默认使用 PNG
      }

      // 计算 base64 大小（大约）
      const sizeInBytes = Math.ceil(base64Content.length * 0.75);
      const maxSize = 20 * 1024 * 1024; // 20MB

      if (sizeInBytes > maxSize) {
        console.warn(`[Upload Base64] 图片 ${i} 过大: ${(sizeInBytes / 1024 / 1024).toFixed(2)}MB，跳过`);
        continue;
      }

      // 转换 base64 为 Buffer
      const buffer = Buffer.from(base64Content, 'base64');

      // 生成存储路径
      const timestamp = Date.now();
      const uuid = Math.random().toString(36).substring(2, 15);
      const ext = mimeType.split('/')[1] || 'png';
      const key = `canvas/split/${new Date().toISOString().slice(0, 7)}/${timestamp}-${uuid}-${i}.${ext}`;

      // 上传到 COS
      try {
        const result = await uploadToCOS(key, buffer, mimeType);
        results.push({
          key: result.key,
          url: result.url,
        });
        console.log(`[Upload Base64] 图片 ${i} 上传成功: ${result.key}`);
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
    console.error('[Upload Base64] 上传失败:', error);
    return NextResponse.json(
      { success: false, error: error.message || '上传失败，请稍后重试' },
      { status: 500 }
    );
  }
}
