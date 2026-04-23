import { NextRequest, NextResponse } from 'next/server';
import { LLMClient, Config } from 'coze-coding-dev-sdk';

export async function POST(request: NextRequest) {
  try {
    console.log('========================================');
    console.log('=== 图像反推 API ===');
    console.log('========================================');

    const body = await request.json();
    const { image } = body;

    if (!image) {
      return NextResponse.json({ error: '缺少图片参数' }, { status: 400 });
    }

    console.log('开始分析图片...');

    const config = new Config();
    const client = new LLMClient(config);

    const messages: any[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '请详细分析这张图片中人物的动作姿态和面部表情，输出结构化分析结果。',
          },
          {
            type: 'image_url',
            image_url: { url: image, detail: 'high' },
          },
        ],
      },
    ];

    const response = await client.invoke(messages, {
      model: 'doubao-seed-1-6-vision-250815',
      temperature: 0.7,
    });

    console.log('图像分析完成');
    console.log('========================================');
    console.log('=== 图像反推完成 ===');
    console.log('========================================');

    return NextResponse.json({
      success: true,
      prompt: response.content.trim(),
    });
  } catch (error) {
    console.error('图像反推错误:', error);
    return NextResponse.json({ 
      error: '动作分析失败',
      details: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
}
