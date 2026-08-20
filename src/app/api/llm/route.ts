import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { deductCredits, checkCreditsSufficient, refundCredits } from '@/lib/credits';
import { checkUserBanned, createBannedResponse } from '@/lib/ban-check';
import { getAvailableApiKey } from '@/lib/api-config';

// Route Segment Config
export const runtime = 'nodejs';
export const maxDuration = 1900; // 约31分钟，支持上游排队长耗时

// 从 cookie 获取用户 ID
function getUserIdFromCookie(request: NextRequest): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  
  const cookies = cookieHeader.split(';').map(c => c.trim());
  const userCookie = cookies.find(c => c.startsWith('user_id='));
  if (!userCookie) return null;
  
  return userCookie.split('=')[1] || null;
}

// 替换模板变量
function replaceTemplateVariables(template: any, variables: Record<string, any>): any {
  if (typeof template === 'string') {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), String(value));
    }
    return result;
  }
  
  if (Array.isArray(template)) {
    return template.map(item => replaceTemplateVariables(item, variables));
  }
  
  if (typeof template === 'object' && template !== null) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(template)) {
      result[key] = replaceTemplateVariables(value, variables);
    }
    return result;
  }
  
  return template;
}

// 从数据库获取 LLM 配置
async function getLLMConfig(modelId: string): Promise<{
  config: any;
  model: any;
} | null> {
  try {
    const supabase = getSupabaseClient(undefined, true);
    
    // 获取模型信息
    const { data: model, error: modelError } = await supabase
      .from('api_models')
      .select('*')
      .eq('model_id', modelId)
      .eq('is_active', true)
      .single();
    
    if (modelError || !model) {
      console.log('[LLM API] 模型未找到:', modelId);
      return null;
    }
    
    // 获取配置
    const { data: config, error: configError } = await supabase
      .from('api_configs')
      .select('*')
      .eq('id', model.config_id)
      .eq('is_active', true)
      .single();
    
    if (configError || !config) {
      console.log('[LLM API] 配置未找到:', model.config_id);
      return null;
    }
    
    return { config, model };
  } catch (error) {
    console.error('[LLM API] 获取配置失败:', error);
    return null;
  }
}

// LLM API - 支持流式响应
export async function POST(request: NextRequest) {
  console.log('[LLM API] 请求开始');
  
  const userId = getUserIdFromCookie(request);
  let creditsDeducted = false;
  let requiredCredits = 5;
  
  try {
    const body = await request.json();
    const { prompt, model: requestedModel, imageUrl, videoUrl, temperature = 0.7 } = body;
    
    if (!prompt) {
      return NextResponse.json({ error: '缺少 prompt 参数' }, { status: 400 });
    }
    
    // #507 修复：LLM 生成需要登录
    if (!userId) {
      return NextResponse.json({ 
        error: '请先登录', 
        redirectLogin: true 
      }, { status: 401 });
    }
    
    // 获取配置
    const configResult = await getLLMConfig(requestedModel || 'deepseek-chat');
    if (!configResult) {
      return NextResponse.json({ error: 'LLM 配置未找到' }, { status: 500 });
    }
    
    const { config, model } = configResult;
    requiredCredits = model.credits_base || 5;
    
    // 检查积分（userId 已确认存在）
    // 前置风控：先检查禁用状态
    const banResult = await checkUserBanned(userId);
    if (banResult.isBanned) {
      console.log('[LLM] 用户已禁用:', userId, '类型:', banResult.banType);
      return NextResponse.json({
        error: banResult.error || '您的账号因连续异常操作已被锁定',
        isBanned: true,
        bannedUntil: banResult.bannedUntil,
        banType: banResult.banType,
      }, { status: 403 });
    }
    
    const checkResult = await checkCreditsSufficient(userId, requiredCredits);
    if (!checkResult.sufficient) {
      return NextResponse.json({
        error: `积分不足，当前积分: ${checkResult.currentCredits || 0}，需要: ${requiredCredits}`,
        insufficient: true,
      }, { status: 402 });
    }
    
    // 扣除积分
    const referenceId = `llm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const deductResult = await deductCredits(userId, requiredCredits, referenceId);
    if (!deductResult.success) {
      return NextResponse.json({ error: deductResult.error || '扣除积分失败' }, { status: 500 });
    }
    creditsDeducted = true;
    console.log(`[LLM API] 扣除积分成功，剩余: ${deductResult.remaining}`);
    
    // 构建请求
    let apiEndpoint = config.api_endpoint;
    const apiKey = getAvailableApiKey(config.api_key);
    
    // 构建消息 - 添加中文限制的 system message
    let messages: Array<{ role: string; content: string | Array<any> }>;
    
    // 添加 system message 限制中文输出，不要开头语
    const systemMessage = { role: 'system', content: '请使用中文回答。直接输出内容，不要任何开头语、结束语或解释。' };
    
    if (imageUrl || videoUrl) {
      // 有图片或视频，使用多模态格式
      const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: 'text', text: prompt }
      ];
      if (imageUrl) {
        contentParts.push({ type: 'image_url', image_url: { url: imageUrl } });
      }
      if (videoUrl) {
        contentParts.push({ type: 'image_url', image_url: { url: videoUrl } });
      }
      messages = [
        systemMessage,
        {
          role: 'user',
          content: contentParts
        }
      ];
    } else {
      // 纯文本
      messages = [
        systemMessage,
        { role: 'user', content: prompt }
      ];
    }
    
    // 构建请求体
    const requestBody = {
      model: model.model_id,
      messages,
      stream: true,
      temperature,
    };
    
    console.log('[LLM API] 请求 URL:', apiEndpoint);
    console.log('[LLM API] 模型:', model.model_id);
    console.log('[LLM API] 发送时间:', new Date().toISOString());
    
    // 创建超时控制器（5分钟超时）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800000); // 30 分钟，支持上游排队
    
    // 发送请求
    const fetchStartTime = Date.now();
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
    
    // 记录服务商响应时间（从发送到收到响应头）
    const fetchEndTime = Date.now();
    console.log('[LLM API] 服务商响应时间:', fetchEndTime - fetchStartTime, 'ms');
    console.log('[LLM API] 响应状态:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[LLM API] 请求失败:', response.status, errorText);
      // #506 扣费有误修复：LLM请求失败时退还积分
      if (creditsDeducted && userId) {
        const refundRef = `llm_refund_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const refundResult = await refundCredits(userId, requiredCredits, refundRef, 'LLM请求失败退还');
        console.log('[LLM API] #506 请求失败退还积分:', refundResult.success, '剩余:', refundResult.remaining);
      }
      return NextResponse.json({ error: `LLM 请求失败: ${response.status}` }, { status: 500 });
    }
    
    // 检查是否是流式响应
    const contentType = response.headers.get('content-type') || '';
    const isStream = contentType.includes('text/event-stream') || requestBody.stream;
    
    if (isStream && response.body) {
      // 流式响应 - 转换为前端需要的 SSE 格式
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      
      const stream = new ReadableStream({
        start(controller) {
          // #7xx 流初始化死锁修复：移除 async，用自执行异步闭包包裹流式转发逻辑
          // 让 start 函数瞬间返回，压榨 LLM 首字响应速度（TTFT）
          (async () => {
          let buffer = '';
          let fullContent = '';
          
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') continue;
                  
                  try {
                    const json = JSON.parse(data);
                    const content = json.choices?.[0]?.delta?.content || '';
                    if (content) {
                      fullContent += content;
                      // 转发到前端
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content })}\n\n`));
                      // 暴力填缝 V3：32KB padding 强制冲破 Next.js 双层缓冲
                      controller.enqueue(encoder.encode(`: ${' '.repeat(32768)}\n\n`));
                      // 🔥 关键：await 让出事件循环，逼迫 Node.js ServerResponse Flush！
                      // 没有 await，所有 enqueue 在同一个微任务中，Node.js 不会 Flush！
                      await new Promise(r => setTimeout(r, 0));
                    }
                  } catch {
                    // 忽略解析错误
                  }
                }
              }
            }
            
            // 发送完成信号
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', fullContent })}\n\n`));
            controller.close();
          } catch (error) {
            console.error('[LLM API] 流处理错误:', error);
            // #489 修复：安全地发送错误信息，避免 controller 已关闭时报错
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`));
            } catch {
              // Controller 已关闭，忽略
            }
            try {
              controller.close();
            } catch {
              // Controller 已关闭，忽略
            }
          }
          })();  // #7xx 自执行异步闭包结束，start 函数瞬间返回
        },
      }, { highWaterMark: 0 }); // #7xx 流缓冲根治：highWaterMark=0 阻止 ReadableStream 内部缓冲
      
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } else {
      // 非流式响应
      const responseText = await response.text();
      let jsonResponse;
      try {
        jsonResponse = JSON.parse(responseText);
      } catch {
        // 纯文本响应
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: responseText })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        });
      }
      
      // 提取文本
      const textPath = config.response_parser?.textPath || 'choices[0].message.content';
      const parts = textPath.split('.');
      let text = jsonResponse;
      for (const part of parts) {
        const match = part.match(/(\w+)\[(\d+)\]/);
        if (match) {
          text = text?.[match[1]]?.[parseInt(match[2])];
        } else {
          text = text?.[part];
        }
      }
      
      if (!text) {
        return NextResponse.json({ error: '无法从响应中提取文本' }, { status: 500 });
      }
      
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }
  } catch (error) {
    console.error('[LLM API] 错误:', error);
    // #506 扣费有误修复：异常时退还积分
    if (creditsDeducted && userId) {
      const refundRef = `llm_refund_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      try {
        const refundResult = await refundCredits(userId, requiredCredits, refundRef, 'LLM异常退还');
        console.log('[LLM API] #506 异常退还积分:', refundResult.success, '剩余:', refundResult.remaining);
      } catch (refundErr) {
        console.error('[LLM API] #506 退还积分失败:', refundErr);
      }
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
