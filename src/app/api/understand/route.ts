import { NextRequest, NextResponse } from 'next/server';
import { LLMClient, Config } from 'coze-coding-dev-sdk';

// 设置 serverless 函数最长执行时间为 5 分钟（图片理解可能需要较长时间）
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    console.log('========================================');
    console.log('=== 图片理解 API（LLM Vision）===');
    console.log('========================================');

    const body = await request.json();
    const { image, prompt } = body;

    if (!image) {
      return NextResponse.json({ error: '缺少图片参数' }, { status: 400 });
    }

    // 默认使用分层识别策略
    const analysisPrompt = prompt || `请使用分层识别策略（宏观→中观→微观）详细分析这张图片：

1. 宏观层：图像类型、整体场景、视觉构图
2. 中观层：对象识别、空间关系、文字信息
3. 微观层：精细特征、UI细节、颜色值

请完整输出所有识别到的信息。`;

    console.log('开始分析图片...');

    const config = new Config();
    const client = new LLMClient(config);

    const messages: Array<{
      role: 'user' | 'system' | 'assistant';
      content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'high' | 'low' } }>;
    }> = [
      {
        role: 'user',
        content: [
          { type: 'text', text: analysisPrompt },
          { type: 'image_url', image_url: { url: image, detail: 'high' } },
        ],
      },
    ];

    const response = await client.invoke(messages, {
      model: 'doubao-seed-1-6-vision-250815',
      temperature: 0.3,
    });

    console.log('图片分析完成');

    return NextResponse.json({
      success: true,
      analysis: response.content.trim(),
    });
  } catch (error) {
    console.error('图片理解错误:', error);
    return NextResponse.json(
      {
        error: '图片理解失败',
        details: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    );
  }
}
