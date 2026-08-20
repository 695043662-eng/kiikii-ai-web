import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    console.log('========================================');
    console.log('=== 测试连接 API ===');
    console.log('========================================');

    const body = await request.json();
    const { apiEndpoint, apiKey } = body;

    console.log('测试参数:', {
      apiEndpoint,
      apiKey: apiKey ? `${apiKey.substring(0, 10)}...` : '未提供',
    });

    if (!apiEndpoint || !apiKey) {
      return NextResponse.json({ error: '缺少 API 配置' }, { status: 400 });
    }

    const testRequestBody = {
      model: 'nano-banana-fast',
      prompt: 'test',
      aspectRatio: 'auto',
      imageSize: '1K',
      shutProgress: true,
    };

    console.log('发送测试请求到:', apiEndpoint);

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(testRequestBody),
    });

    console.log('响应状态:', response.status, response.statusText);

    if (response.ok) {
      const responseText = await response.text();
      console.log('响应内容:', responseText.substring(0, 500));

      console.log('========================================');
      console.log('=== 连接成功 ===');
      console.log('========================================');

      return NextResponse.json({
        success: true,
        message: '连接成功',
        status: response.status,
      });
    } else {
      const errorText = await response.text();
      console.error('连接失败:', response.status, errorText);

      console.log('========================================');
      console.log('=== 连接失败 ===');
      console.log('========================================');

      return NextResponse.json({
        error: `连接失败 (${response.status})`,
        details: errorText.substring(0, 500),
      }, { status: 500 });
    }
  } catch (error) {
    console.error('测试连接错误:', error);

    console.log('========================================');
    console.log('=== 连接失败 ===');
    console.log('========================================');

    return NextResponse.json({
      error: '连接失败',
      details: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}
