import { NextRequest, NextResponse } from 'next/server';

const API_ENDPOINT = process.env.NEXT_PUBLIC_API_ENDPOINT || 'http://124.156.230.187:8080/v3/images/compositions';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    console.log('=== 测试API调用 ===');
    console.log('请求体:', JSON.stringify(body, null, 2));

    // 准备请求头
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${body.apiKey}`,
    };

    // 移除 apiKey 从请求体
    const { apiKey, ...requestBody } = body;

    // 调用外部 API
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    console.log('响应状态:', response.status);
    console.log('响应头:', Object.fromEntries(response.headers.entries()));

    const text = await response.text();
    console.log('响应原始文本:', text);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    console.log('解析后的数据:', JSON.stringify(data, null, 2));

    // 尝试提取图片URL
    const possibleImages: string[] = [];

    if (data && typeof data === 'object') {
      if (data.images) possibleImages.push(`images: ${JSON.stringify(data.images)}`);
      if (data.data) possibleImages.push(`data: ${JSON.stringify(data.data)}`);
      if (data.result) possibleImages.push(`result: ${JSON.stringify(data.result)}`);
      if (data.url) possibleImages.push(`url: ${data.url}`);
      if (data.image) possibleImages.push(`image: ${data.image}`);
      if (data.b64_json) possibleImages.push(`b64_json: ${data.b64_json.substring(0, 50)}...`);
      if (data.items) possibleImages.push(`items: ${JSON.stringify(data.items)}`);
    }

    const info = {
      status: response.status,
      statusText: response.statusText,
      dataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
      dataType: typeof data,
      data: data,
      possibleImages,
    };

    return NextResponse.json(info);
  } catch (error) {
    console.error('测试API错误:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
