import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getSignedUrl } from '@/lib/cos';
import { cookies } from 'next/headers';

// 从 COS URL 中提取 key
function extractCosKeyFromUrl(url: string): string | null {
  if (!url?.includes('cos.ap-hongkong.myqcloud.com')) return null;
  try {
    const pathname = new URL(url).pathname;
    return pathname?.startsWith('/') ? pathname.substring(1) : null;
  } catch {
    return null;
  }
}

/**
 * 参考图代理 API - 按需加载单张参考图
 * GET /api/generation-records/ref-image?recordId=123&index=0
 * 
 * 用途：旧记录中参考图以 base64 存储在数据库，直接返回到列表 JSON 会导致响应过大。
 * 此端点从数据库读取单张参考图，以图片形式返回给浏览器。
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const recordId = searchParams.get('recordId');
    const index = parseInt(searchParams.get('index') || '0');

    if (!recordId) {
      return NextResponse.json({ error: '缺少 recordId' }, { status: 400 });
    }

    if (isNaN(index) || index < 0) {
      return NextResponse.json({ error: '无效的 index' }, { status: 400 });
    }

    const client = getSupabaseClient(undefined, true);

    // 只查询需要的字段，避免拉取大体积的 images 数据
    const { data: record, error } = await client
      .from('generation_records')
      .select('reference_images, reference_image_keys')
      .eq('id', recordId)
      .eq('user_id', userId)
      .single();

    if (error || !record) {
      return NextResponse.json({ error: '记录不存在' }, { status: 404 });
    }

    // 优先使用 COS key 获取签名 URL，重定向到签名 URL
    if (record.reference_image_keys && record.reference_image_keys.length > index && record.reference_image_keys[index]) {
      try {
        const signedUrl = await getSignedUrl(record.reference_image_keys[index], 432000);
        if (signedUrl) {
          return NextResponse.redirect(signedUrl);
        }
      } catch {
        // 签名失败，继续尝试其他方式
      }
    }

    // 尝试从 reference_images 获取
    if (!record.reference_images || !record.reference_images[index]) {
      return NextResponse.json({ error: '参考图不存在' }, { status: 404 });
    }

    const imageData = record.reference_images[index];

    // 如果是 COS URL，提取 key 并获取签名 URL
    const cosKey = extractCosKeyFromUrl(imageData);
    if (cosKey) {
      try {
        const signedUrl = await getSignedUrl(cosKey, 432000);
        if (signedUrl) {
          return NextResponse.redirect(signedUrl);
        }
      } catch {
        // 签名失败，继续
      }
    }

    // 如果是 base64 数据，直接以图片形式返回
    if (imageData.startsWith('data:')) {
      // 解析 data URI: data:image/png;base64,xxxx
      const match = imageData.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        const contentType = match[1];
        const base64Data = match[2];
        
        try {
          const buffer = Buffer.from(base64Data, 'base64');
          return new NextResponse(buffer, {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=86400', // 缓存1天
              'Content-Length': buffer.length.toString(),
            },
          });
        } catch {
          return NextResponse.json({ error: '图片解码失败' }, { status: 500 });
        }
      }
    }

    // 如果是普通 URL，重定向
    if (imageData.startsWith('http')) {
      return NextResponse.redirect(imageData);
    }

    return NextResponse.json({ error: '无法解析参考图' }, { status: 500 });

  } catch (error) {
    console.error('[ref-image] 获取参考图失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
