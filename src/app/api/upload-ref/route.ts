import { NextRequest, NextResponse } from 'next/server';
import { uploadToCOS, isCOSConfigured } from '@/lib/cos';

export const maxDuration = 300; // 最长执行时间 5 分钟（上传可能需要较长时间）

/**
 * 上传参考图到 COS，返回公网可访问的 URL
 * 
 * 🔧 #235 修复：服务商无法访问本地存储的参考图
 * - 之前：存储到本地 /tmp，生成 https://kiikii.me/api/ref-img/xxx
 * - 问题：服务商访问 kiikii.me，但图片在本地机器，导致 404
 * - 现在：直接上传到 COS，返回 COS 公网 URL
 */
export async function POST(request: NextRequest) {
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

    console.log('[UploadRef] 文件:', file.name, (file.size / 1024 / 1024).toFixed(2), 'MB');

    // 读取文件为 Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = file.type || 'image/png';

    // 生成唯一 key
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const ext = file.name.split('.').pop() || 'png';
    const key = `ref-images/${timestamp}-${random}.${ext}`;

    // 上传到 COS
    console.log('[UploadRef] 上传到 COS:', key);
    const { url } = await uploadToCOS(key, buffer, mimeType);

    console.log('[UploadRef] 成功:', key, '→', url.substring(0, 80) + '...');
    
    return NextResponse.json({ 
      success: true, 
      url, 
      key,
      message: '参考图已上传到 COS，服务商可直接访问'
    });
  } catch (error: any) {
    console.error('[UploadRef] 失败:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || '上传失败' 
    }, { status: 500 });
  }
}
