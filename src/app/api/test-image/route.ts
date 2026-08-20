import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageUrl, apiKey } = body;

    console.log('=== 测试图片加载 ===');
    console.log('图片 URL:', imageUrl);
    console.log('API Key:', apiKey ? '已提供' : '未提供');

    const headers: HeadersInit = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    if (apiKey) {
      headers['Authorization'] = apiKey;
      headers['TenantId'] = '000000';
    }

    // 尝试直接请求图片
    console.log('尝试直接请求图片...');
    const response = await fetch(imageUrl, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    console.log('响应状态:', response.status);
    console.log('响应头:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('请求失败:', errorText.substring(0, 500));
      return NextResponse.json({
        success: false,
        status: response.status,
        statusText: response.statusText,
        error: errorText.substring(0, 200),
      });
    }

    const contentType = response.headers.get('content-type');
    const buffer = await response.arrayBuffer();

    console.log('图片数据大小:', buffer.byteLength, 'bytes');
    console.log('Content-Type:', contentType);

    return NextResponse.json({
      success: true,
      status: response.status,
      contentType,
      size: buffer.byteLength,
    });
  } catch (error) {
    console.error('测试图片加载错误:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
