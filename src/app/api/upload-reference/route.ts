import { NextRequest, NextResponse } from 'next/server';
import { uploadToCOS, getSignedUrl, checkBucketExists, isCOSConfigured, COS_CONFIG } from '@/lib/cos';
import { validateUploadedFile } from '@/lib/file-validator';

// 缓存 bucket 检查结果
let bucketCheckCache: { exists: boolean; error?: string; timestamp: number } | null = null;
const BUCKET_CHECK_TTL = 60000; // 1分钟缓存

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('=== 开始处理上传请求 ===');
  console.log('请求时间:', new Date().toISOString());
  console.log('Content-Type:', request.headers.get('content-type'));
  console.log('Content-Length:', request.headers.get('content-length'));
  
  try {
    // 检查 COS 配置是否完整
    if (!isCOSConfigured()) {
      console.error('[COS] 腾讯云 COS 未配置，请设置环境变量: COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION');
      return NextResponse.json(
        { success: false, error: '存储服务未配置，请联系管理员' },
        { status: 500 }
      );
    }
    
    // 检查 bucket 是否存在（带缓存）
    const now = Date.now();
    if (!bucketCheckCache || (now - bucketCheckCache.timestamp) > BUCKET_CHECK_TTL) {
      console.log('[COS] 检查 Bucket 是否存在...');
      const bucketCheck = await checkBucketExists();
      bucketCheckCache = { ...bucketCheck, timestamp: now };
      
      if (!bucketCheck.exists) {
        console.error('[COS] Bucket 检查失败:', bucketCheck.error);
        return NextResponse.json(
          { success: false, error: bucketCheck.error || 'COS 配置错误，请联系管理员' },
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

    // 使用 formData() 方法读取数据
    let formData: FormData;
    try {
      console.log('开始解析 FormData...');
      formData = await request.formData();
      console.log('FormData 解析成功, 耗时:', Date.now() - startTime, 'ms');
    } catch (e: any) {
      console.error('解析 FormData 失败:', e);
      return NextResponse.json(
        { success: false, error: '解析上传数据失败，文件可能过大或格式错误' },
        { status: 400 }
      );
    }

    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: '缺少图片文件' },
        { status: 400 }
      );
    }

    console.log('=== 上传参考图到腾讯云 COS ===');
    console.log('文件名:', file.name);
    console.log('文件大小:', (file.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('声明类型:', file.type);

    // 检查文件大小（最大 50MB）
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      console.log('拒绝上传: 文件过大');
      return NextResponse.json(
        { success: false, error: `图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），超过50MB限制` },
        { status: 400 }
      );
    }

    // 🔒 安全增强：使用魔数验证文件真实类型
    const validation = await validateUploadedFile(file);
    if (!validation.valid) {
      console.warn('[Upload Reference] 安全拦截:', validation.error, '| 文件名:', file.name, '| 声明类型:', file.type);
      return NextResponse.json(
        { success: false, error: validation.error || '文件验证失败' },
        { status: 400 }
      );
    }

    // 使用检测到的真实 MIME 类型和扩展名
    const actualMimeType = validation.detectedType!.mime;
    const actualExt = validation.detectedType!.ext;

    // 将文件转换为 Buffer
    console.log('开始读取文件 buffer...');
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log('Buffer 大小:', buffer.length, 'bytes, 真实类型:', actualMimeType, ', 耗时:', Date.now() - startTime, 'ms');

    // 生成存储路径（使用真实的扩展名）
    const key = `reference-images/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${actualExt}`;

    // 上传到腾讯云 COS（使用真实的 MIME 类型）
    try {
      console.log('开始上传到腾讯云 COS...');
      await uploadToCOS(key, buffer, actualMimeType);
      console.log('上传成功，Key:', key, ', 耗时:', Date.now() - startTime, 'ms');
    } catch (e: any) {
      console.error('上传到 COS 失败:', e);
      return NextResponse.json(
        { success: false, error: '上传失败: ' + (e.message || '存储服务异常') },
        { status: 500 }
      );
    }

    // 生成签名 URL（5天有效）
    let signedUrl: string;
    try {
      signedUrl = await getSignedUrl(key, 432000); // 5天
      console.log('签名 URL 生成成功, 总耗时:', Date.now() - startTime, 'ms');
    } catch (e: any) {
      console.error('生成签名URL失败:', e);
      return NextResponse.json(
        { success: false, error: '生成访问链接失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      key,
      url: signedUrl,
    });
  } catch (error: any) {
    console.error('上传参考图失败:', error);
    console.error('错误堆栈:', error.stack);
    return NextResponse.json(
      { success: false, error: error.message || '上传失败，请稍后重试' },
      { status: 500 }
    );
  }
}
