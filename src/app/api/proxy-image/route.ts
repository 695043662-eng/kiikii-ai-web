import { NextRequest, NextResponse } from 'next/server';
import { downloadFromCOS, getSignedUrl } from '@/lib/cos';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const imageUrl = searchParams.get('url');
    const cosKey = searchParams.get('key'); // COS key 参数

    // 如果提供了 COS key，从 COS 获取图片
    if (cosKey) {
      console.log('=== 通过 COS Key 获取图片 ===');
      console.log('COS Key:', cosKey);

      try {
        // 获取签名 URL
        console.log('[proxy-image] 正在获取签名 URL, key:', cosKey);
        const signedUrl = await getSignedUrl(cosKey, 3600); // 1小时有效
        console.log('[proxy-image] 签名 URL:', typeof signedUrl === 'string' ? signedUrl.substring(0, 100) : JSON.stringify(signedUrl));

        // 获取图片
        const response = await fetch(signedUrl as string);
        
        if (!response.ok) {
          console.error('COS 获取图片失败:', response.status);
          return NextResponse.json(
            { error: 'Failed to fetch from COS' },
            { status: response.status }
          );
        }

        const imageBuffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') || 'image/png';

        return new NextResponse(imageBuffer, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600',
            'Content-Length': imageBuffer.byteLength.toString(),
          },
        });
      } catch (cosError) {
        console.error('COS 获取图片失败:', cosError);
        return NextResponse.json(
          { error: 'Failed to fetch from COS', message: cosError instanceof Error ? cosError.message : 'Unknown error' },
          { status: 500 }
        );
      }
    }

    // 原有的 URL 代理逻辑
    if (!imageUrl) {
      return NextResponse.json({ error: 'URL or key parameter is required' }, { status: 400 });
    }

    console.log('=== 代理图片请求 ===');
    console.log('图片 URL:', imageUrl.substring(0, 100));

    // 尝试从多个位置获取 API Key
    // 1. 从 URL query 参数获取
    let apiKey = searchParams.get('apiKey');

    // 2. 从请求头获取（用于直接调用的情况）
    if (!apiKey) {
      apiKey = request.headers.get('x-api-key');
    }

    console.log('API Key:', apiKey ? '已提供' : '未提供');

    const headers: HeadersInit = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };

    // 如果提供了 API Key，添加到请求头
    if (apiKey) {
      headers['Authorization'] = apiKey;
      headers['TenantId'] = '000000';
    }

    console.log('发送请求头:', headers);

    // 代理请求原始图片，添加更多配置
    const response = await fetch(imageUrl, {
      headers,
      // 添加超时设置
      signal: AbortSignal.timeout(30000),
    });

    console.log('图片响应状态:', response.status, response.statusText);

    if (!response.ok) {
      console.error('图片代理请求失败:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('错误响应 (前500字符):', errorText.substring(0, 500));
      return NextResponse.json(
        { error: `Failed to fetch image: ${response.status} ${response.statusText}`, details: errorText.substring(0, 200) },
        { status: response.status }
      );
    }

    // 获取图片数据
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const contentLength = imageBuffer.byteLength;

    console.log('图片数据大小:', contentLength, 'bytes');
    console.log('Content-Type:', contentType);

    if (contentLength === 0) {
      console.error('警告: 图片数据为空');
      return NextResponse.json(
        { error: 'Image data is empty' },
        { status: 500 }
      );
    }

    // 返回图片数据
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': contentLength.toString(),
      },
    });
  } catch (error) {
    console.error('=== 图片代理错误 ===');
    console.error('错误类型:', error?.constructor?.name);
    console.error('错误详情:', error);
    console.error('错误堆栈:', error instanceof Error ? error.stack : '无堆栈信息');

    // 返回更详细的错误信息
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
        type: error?.constructor?.name,
      },
      { status: 500 }
    );
  }
}
