import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config } from "coze-coding-dev-sdk";

export async function POST(request: NextRequest) {
  try {
    const { imageUrl, prompt } = await request.json();

    if (!imageUrl) {
      return NextResponse.json({ error: "缺少图片URL" }, { status: 400 });
    }

    const config = new Config();
    const client = new LLMClient(config);

    const messages: Array<{ role: "user" | "system" | "assistant"; content: any }> = [
      {
        role: "user" as const,
        content: [
          {
            type: "text",
            text: prompt || "请详细描述这张图片的所有内容，包括UI元素、布局、文字信息等。",
          },
          {
            type: "image_url",
            image_url: {
              url: imageUrl,
              detail: "high",
            },
          },
        ],
      },
    ];

    const response = await client.invoke(messages, {
      model: "doubao-seed-1-6-vision-250815",
      temperature: 0.7,
    });

    return NextResponse.json({
      success: true,
      description: response.content,
    });
  } catch (error: any) {
    console.error("Image recognition error:", error);
    return NextResponse.json(
      { error: error.message || "图片识别失败" },
      { status: 500 }
    );
  }
}
