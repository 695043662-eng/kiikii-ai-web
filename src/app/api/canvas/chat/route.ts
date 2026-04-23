import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config } from "coze-coding-dev-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 系统提示词
const SYSTEM_PROMPT = `你是一个专业的AI设计师助手，帮助用户完成各种设计任务。你可以：
1. 帮助用户生成图片描述和提示词
2. 提供设计建议和创意灵感
3. 解答关于设计、配色、布局等方面的问题
4. 协助用户优化他们的设计作品

请用友好、专业的语气回复用户，并提供实用的建议。`;

export async function POST(request: NextRequest) {
  try {
    const { messages, model = "doubao-seed-1-6-lite-251015" } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "消息格式无效" }, { status: 400 });
    }

    const config = new Config();
    const client = new LLMClient(config);

    // 添加系统提示词
    const allMessages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      ...messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
    ];

    // 使用流式响应
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const llmStream = client.stream(allMessages, {
            model,
            temperature: 0.7,
          });

          let fullContent = "";
          for await (const chunk of llmStream) {
            if (chunk.content) {
              const text = chunk.content.toString();
              fullContent += text;
              // 发送 SSE 格式的数据
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`)
              );
            }
          }
          // 发送结束标记
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (error) {
          console.error("Streaming error:", error);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: "生成回复时出错" })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",  // #213 禁用 Nginx 缓冲
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "处理请求时出错" }, { status: 500 });
  }
}
