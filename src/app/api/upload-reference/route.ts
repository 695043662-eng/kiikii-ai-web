import { NextRequest, NextResponse } from 'next/server';
import { uploadToCOS, uploadToCOSFromStream, getSignedUrl, checkBucketExists, isCOSConfigured, COS_CONFIG } from '@/lib/cos';
import { validateUploadedFile } from '@/lib/file-validator';
import { requireAuth } from '@/lib/auth-middleware';
import { Readable } from 'stream';

// 缓存 bucket 检查结果
let bucketCheckCache: { exists: boolean; error?: string; timestamp: number } | null = null;
const BUCKET_CHECK_TTL = 60000; // 1分钟缓存

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('=== 开始处理上传请求 ===');
  
  // 🔒 P0 鉴权：必须登录才能上传
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  
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

    // 🛡️ #846 路径绑定 userId：防止越权覆盖他人文件
    const key = `reference-images/${auth.userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${actualExt}`;

    // 上传到腾讯云 COS（使用真实的 MIME 类型）
    // #557 修复：使用 uploadToCOS 返回的带前缀的 key 和签名 URL，避免重复调用 getSignedUrl 导致路径错误
    let uploadedKey: string;
    let signedUrl: string;

    // 🛡️ #848 防内存爆炸：大文件(>5MB)走流式直传 COS，小文件走 Buffer
    const STREAM_THRESHOLD = 5 * 1024 * 1024; // 5MB
    if (file.size > STREAM_THRESHOLD) {
      console.log('[UploadReference] 大文件流式上传:', (file.size / 1024 / 1024).toFixed(2), 'MB');
      const webStream = file.stream();
      const nodeStream = Readable.fromWeb(webStream as any);
      const result = await uploadToCOSFromStream(key, nodeStream, file.size, actualMimeType, 'temp');
      uploadedKey = result.key;
      signedUrl = result.url;
    } else {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const uploadResult = await uploadToCOS(key, buffer, actualMimeType, 'temp');
      uploadedKey = uploadResult.key;
      signedUrl = uploadResult.url;
    }

    console.log('[UploadReference] 上传成功, Key:', uploadedKey);

    return NextResponse.json({
      success: true,
      key: uploadedKey,
      url: signedUrl,
    });
  } catch (e: any) {
    console.error('上传参考图失败:', e);
    return NextResponse.json(
      { success: false, error: '上传失败，请稍后重试' },
      { status: 500 }
    );
  }
}
