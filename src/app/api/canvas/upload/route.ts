import { NextRequest, NextResponse } from 'next/server';
import { uploadToCOS, isCOSConfigured, checkBucketExists } from '@/lib/cos';

// 缓存 bucket 检查结果
let bucketCheckCache: { exists: boolean; error?: string; timestamp: number } | null = null;
const BUCKET_CHECK_TTL = 60000; // 1分钟缓存

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[Canvas Upload] 开始处理上传请求');
  
  try {
    // 检查 COS 配置是否完整
    if (!isCOSConfigured()) {
      console.error('[Canvas Upload] 腾讯云 COS 未配置');
      return NextResponse.json(
        { success: false, error: '存储服务未配置，请联系管理员' },
        { status: 500 }
      );
    }
    
    // 检查 bucket 是否存在（带缓存）
    const now = Date.now();
    if (!bucketCheckCache || (now - bucketCheckCache.timestamp) > BUCKET_CHECK_TTL) {
      const bucketCheck = await checkBucketExists();
      bucketCheckCache = { ...bucketCheck, timestamp: now };
      
      if (!bucketCheck.exists) {
        return NextResponse.json(
          { success: false, error: bucketCheck.error || 'COS 配置错误' },
          { status: 500 }
        );
      }
    }

    // 获取 Content-Type 检查是否是 multipart/form-data
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { success: false, error: '请求必须是 multipart/form-data 格式' },
        { status: 400 }
      );
    }

    // 解析 FormData
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (e) {
      return NextResponse.json(
        { success: false, error: '解析上传数据失败' },
        { status: 400 }
      );
    }

    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: '缺少文件' },
        { status: 400 }
      );
    }

    // 检查文件大小（最大 50MB）
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: `文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），超过50MB限制` },
        { status: 400 }
      );
    }

    // 验证文件类型
    const allowedFormats = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedFormats.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: '不支持的文件格式，仅支持 JPG、PNG、WebP、GIF' },
        { status: 400 }
      );
    }

    console.log('[Canvas Upload] 开始上传到 COS:', {
      name: file.name,
      size: (file.size / 1024 / 1024).toFixed(2) + 'MB',
      type: file.type,
    });

    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 生成存储路径：canvas/年月/UUID-原文件名
    const timestamp = Date.now();
    const uuid = Math.random().toString(36).substring(2, 15);
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `canvas/${new Date().toISOString().slice(0, 7)}/${timestamp}-${uuid}-${safeName}`;

    // 上传到 COS
    const result = await uploadToCOS(key, buffer, file.type);

    console.log('[Canvas Upload] 上传成功:', {
      key: result.key,
      url: result.url,
      duration: Date.now() - startTime + 'ms',
    });

    return NextResponse.json({
      success: true,
      key: result.key,
      url: result.url,
    });

  } catch (error: any) {
    console.error('[Canvas Upload] 上传失败:', error);
    return NextResponse.json(
      { success: false, error: error.message || '上传失败，请稍后重试' },
      { status: 500 }
    );
  }
}
