import { NextRequest, NextResponse } from 'next/server';
import { getReferenceImage } from '@/lib/reference-image-store';

/**
 * 参考图代理API
 * GET /api/ref-img/[id]
 * 返回base64图片，供终端API访问
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  console.log(`[RefImg] 请求图片: ${id}`);
  
  const image = getReferenceImage(id);
  
  if (!image) {
    console.log(`[RefImg] 图片不存在: ${id}`);
    return NextResponse.json(
      { error: 'Image not found or expired' },
      { status: 404 }
    );
  }
  
  // 将base64转换为Buffer
  const buffer = Buffer.from(image.base64, 'base64');
  
  console.log(`[RefImg] 返回图片: ${id}, 大小: ${buffer.length} bytes, 类型: ${image.contentType}`);
  
  // 返回图片
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': image.contentType,
      'Cache-Control': 'public, max-age=86400, immutable', // #842 COS 计费风暴止血：1天 immutable
      'Access-Control-Allow-Origin': '*', // 允许跨域访问
    },
  });
}
