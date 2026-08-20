import { NextRequest, NextResponse } from 'next/server';
import { uploadToCOS, uploadToCOSFromStream, isCOSConfigured } from '@/lib/cos';
import { requireAuth } from '@/lib/auth-middleware';
import { validateUploadedFile } from '@/lib/file-validator';
import { Readable } from 'stream';

export const maxDuration = 1900; // 约31分钟，支持上游排队长耗时

/**
 * 上传参考图到 COS，返回公网可访问的 URL
 * 
 * 🔧 #235 修复：服务商无法访问本地存储的参考图
 * - 之前：存储到本地 /tmp，生成 https://kiikii.me/api/ref-img/xxx
 * - 问题：服务商访问 kiikii.me，但图片在本地机器，导致 404
 * - 现在：直接上传到 COS，返回 COS 公网 URL
 */
export async function POST(request: NextRequest) {
  // 🔒 P0 鉴权：必须登录才能上传
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    // 检查 COS 配置
    if (!isCOSConfigured()) {
      console.error('[UploadRef] COS 未配置');
      return NextResponse.json({ 
        success: false, 
        error: 'COS 未配置，无法上传参考图' 
      }, { status: 500 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    
    if (!file) {
      return NextResponse.json({ success: false, error: '缺少文件' }, { status: 400 });
    }

    console.log('[UploadRef] 文件:', file.name, (file.size / 1024 / 1024).toFixed(2), 'MB', '声明类型:', file.type);

    // 🔒 P1 安全加固：文件体积拦截（与 file-validator 统一：图片50MB/视频500MB）
    const MAX_IMAGE_SIZE = 50 * 1024 * 1024;
    const MAX_VIDEO_SIZE = 500 * 1024 * 1024;
    const declaredIsVideo = (file.type || '').startsWith('video/');
    const maxSize = declaredIsVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (file.size > maxSize) {
      console.warn('[UploadRef] 拒绝上传: 文件过大', (file.size / 1024 / 1024).toFixed(1), 'MB');
      return NextResponse.json(
        { success: false, error: `文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），超过${declaredIsVideo ? '500MB' : '50MB'}限制` },
        { status: 400 }
      );
    }

    // 🔒 P1 安全加固：魔数验证文件真实类型，防止 MIME 伪造投毒
    const validation = await validateUploadedFile(file);
    if (!validation.valid) {
      console.warn('[UploadRef] 安全拦截:', validation.error, '| 文件名:', file.name, '| 声明类型:', file.type);
      return NextResponse.json(
        { success: false, error: validation.error || '文件验证失败' },
        { status: 400 }
      );
    }

    // 使用验证后的真实 MIME 类型
    const mimeType = validation.detectedType?.mime || file.type || 'image/png';

    // 🛡️ #848 防内存爆炸：大文件(>5MB)走流式直传 COS，小文件走 Buffer
    const STREAM_THRESHOLD = 5 * 1024 * 1024; // 5MB
    const ext = validation.detectedType?.ext || file.name.split('.').pop() || 'png';

    // 🛡️ #846 路径绑定 userId：防止越权覆盖他人文件
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const key = `ref-images/${userId}/${timestamp}-${random}.${ext}`;

    let uploadedKey: string;
    let signedUrl: string;

    if (file.size > STREAM_THRESHOLD) {
      // 🛡️ #848 大文件：流式上传，避免 arrayBuffer() 一次性撑爆内存
      console.log('[UploadRef] 大文件流式上传:', (file.size / 1024 / 1024).toFixed(2), 'MB');
      const webStream = file.stream();
      const nodeStream = Readable.fromWeb(webStream as any);
      const result = await uploadToCOSFromStream(key, nodeStream, file.size, mimeType, 'temp');
      uploadedKey = result.key;
      signedUrl = result.url;
    } else {
      // 小文件：Buffer 上传（低延迟）
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const result = await uploadToCOS(key, buffer, mimeType, 'temp');
      uploadedKey = result.key;
      signedUrl = result.url;
    }

    console.log('[UploadRef] 成功:', uploadedKey, '→', signedUrl.substring(0, 80) + '...');
    
    return NextResponse.json({ 
      success: true, 
      url: signedUrl, 
      key: uploadedKey,
      message: '参考图已上传到 COS，服务商可直接访问'
    });
  } catch (error: any) {
    console.error('[UploadRef] 失败:', error);
    return NextResponse.json({ 
      success: false, 
      error: '上传失败，请稍后重试'  // 🔒 P0 脱敏：不泄露内部错误信息
    }, { status: 500 });
  }
}
