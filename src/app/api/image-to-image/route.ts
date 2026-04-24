import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import https from 'https';
import http from 'http';

// 设置 serverless 函数最长执行时间为 600 秒（10分钟），支持长时间 SSE 流
export const maxDuration = 600;

// 高并发 Agent：同一域名最多 100 个并行连接（默认只有 5 个）
const highConcurrencyHttpsAgent = new https.Agent({ maxSockets: 100, keepAlive: true });
const highConcurrencyHttpAgent = new http.Agent({ maxSockets: 100, keepAlive: true });

/**
 * 使用 Node.js 原生 https/http 模块发送请求
 * 绕过 Next.js 内置 undici 的 10 秒连接超时限制
 */
function nodeRequest(url: string, options: {
  method: string;
  headers: Record<string, string>;
  body: string;
  timeout?: number;
}): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method,
      headers: options.headers,
      timeout: options.timeout || 360000,  // 默认 360 秒（6分钟），支持长时间 SSE 流
      agent: isHttps ? highConcurrencyHttpsAgent : highConcurrencyHttpAgent,
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(res.headers)) {
        if (typeof value === 'string') responseHeaders[key] = value;
        else if (Array.isArray(value)) responseHeaders[key] = value.join(', ');
      }
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          statusText: res.statusMessage || '',
          headers: responseHeaders,
          body: data,
        });
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error(`请求超时 (${reqOptions.timeout}ms)`)); });
    req.write(options.body);
    req.end();
  });
}

import { getTaskResult, setTaskResult, TaskResult } from '@/lib/taskResultsCache';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { storeReferenceImage } from '@/lib/reference-image-store';
import { getImageAPIConfig, getModelAPIConfig, getModelAPIConfigFull, buildRequest } from '@/lib/api-config';
import { calculateCredits, deductCredits, checkCreditsSufficient, refundCredits } from '@/lib/credits';
import { createErrorResponse, safeErrorLog, safeLog } from '@/lib/errorHandler';
import { checkUserRateLimit, generationCircuitBreaker } from '@/lib/rateLimit';
import { saveTaskMapping } from '@/lib/taskMapping';
import { defaultCircuitBreaker, sseCircuitBreaker } from '@/lib/circuit-breaker';
import { classifyError, shouldRetry, formatErrorMessage } from '@/lib/error-handler';

// 任务ID映射缓存（我们的taskId → 终端的taskId）
const TASK_ID_MAPPING_DIR = '/tmp/task-id-mapping';

// 辅助函数：从嵌套对象中根据路径获取值
function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const keys = path.split('.');
  let result = obj;
  for (const key of keys) {
    if (result === null || result === undefined) return undefined;
    result = result[key];
  }
  return result;
}

// 确保映射目录存在
function ensureMappingDir() {
  const fs = require('fs');
  if (!fs.existsSync(TASK_ID_MAPPING_DIR)) {
    fs.mkdirSync(TASK_ID_MAPPING_DIR, { recursive: true });
  }
}

// 保存任务ID映射（包含用户ID和请求参数）
async function saveTaskIdMapping(
  ourTaskId: string,
  terminalTaskId: string,
  userId?: string,
  requestParams?: any,
  index: number = 0
) {
  try {
    // 1. 保存到文件（原有逻辑）
    ensureMappingDir();
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(TASK_ID_MAPPING_DIR, `${ourTaskId}-${index}.json`);
    const content = JSON.stringify({
      terminalTaskId,
      userId,
      index,  // 保存 index 到文件内容中
      requestParams,
      createdAt: Date.now()
    });
    fs.writeFileSync(filePath, content);
    console.log(`[Mapping] 保存映射到文件: ${ourTaskId}-${index} → ${terminalTaskId}, userId: ${userId || '无'}`);

    // 2. 同时保存到COS（新增：解决重启后丢失映射的问题）
    try {
      await saveTaskMapping({
        ourTaskId,
        terminalTaskId,
        userId,
        index,
        requestParams,
        createdAt: Date.now(),
      });
      console.log(`[Mapping] 保存映射到COS成功: ${terminalTaskId}`);
    } catch (cosError) {
      console.error('[Mapping] 保存到COS失败:', cosError);
      // COS保存失败不影响主流程，静默处理
    }

    console.log(`[Mapping] 保存映射成功: ${ourTaskId}-${index} → ${terminalTaskId}, userId: ${userId || '无'}`);
  } catch (error) {
    console.error(`[Mapping] 保存映射失败:`, error);
  }
}

// 获取终端任务ID
function getTerminalTaskId(ourTaskId: string): string | null {
  try {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(TASK_ID_MAPPING_DIR, `${ourTaskId}.json`);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return data.terminalTaskId;
    }
  } catch (error) {
    console.error(`[Mapping] 读取映射失败:`, error);
  }
  return null;
}

// 异步存储参考图到 COS 和数据库
async function storeReferenceImages(
  userId: string,
  images: { md5: string; base64: string }[]
): Promise<void> {
  if (!userId || !images || images.length === 0) return;

  const client = getSupabaseClient(undefined, true);

  // 并行处理所有图片
  await Promise.all(images.map(async ({ md5, base64 }) => {
    try {
      const { data: existing } = await client
        .from('reference_images')
        .select('cos_key')
        .eq('user_id', userId)
        .eq('md5_hash', md5)
        .maybeSingle();

      if (existing) {
        console.log('参考图已存在，跳过存储:', md5);
        return;
      }

      const { uploadToCOS } = await import('@/lib/cos');
      const cosKey = `reference-images/${userId}/${md5}.png`;
      let base64Data = base64;
      if (base64.includes(',')) {
        base64Data = base64.split(',')[1];
      }
      const buffer = Buffer.from(base64Data, 'base64');
      await uploadToCOS(cosKey, buffer, 'image/png');

      const { error: insertError } = await client
        .from('reference_images')
        .insert({
          user_id: userId,
          md5_hash: md5,
          cos_key: cosKey,
        });

      if (insertError) {
        console.error('写入参考图数据库失败:', insertError);
      } else {
        console.log('参考图存储成功:', md5);
      }
    } catch (error) {
      console.error('存储参考图失败:', md5, error);
    }
  }));
}

// 发送请求到终端（SSE流模式）- 通用架构：从数据库读取完整配置
// 返回值：terminalTaskId 用于异步模式，sseResult 用于 SSE 同步模式
async function sendToTerminal(
  requestBody: any,
  model: string = 'nano-banana-fast'
): Promise<{ terminalTaskId: string; sseResult?: { imageUrls: string[], imageKeys: string[] } }> {
  // 使用熔断器保护
  return sseCircuitBreaker.execute(async () => {
    try {
      return await sendToTerminalInternal(requestBody, model);
    } catch (error: any) {
      // 错误分类
      const errorType = classifyError(error);

      // 如果不允许重试，直接抛出
      if (!shouldRetry(error)) {
        console.log(`[Terminal] 错误不允许重试:`, { errorType, message: error.message });
        throw new Error(formatErrorMessage(error));
      }

      // 允许重试，抛出错误让调用方处理
      console.log(`[Terminal] 错误允许重试:`, { errorType, message: error.message });
      throw error;
    }
  });
}

async function sendToTerminalInternal(
  requestBody: any,
  model: string = 'nano-banana-fast'
): Promise<{ terminalTaskId: string; sseResult?: { imageUrls: string[], imageKeys: string[] } }> {
  // 从数据库读取完整配置（新架构）
  const fullConfig = await getModelAPIConfigFull(model);

  if (!fullConfig) {
    // 回退到旧架构（兼容）
    console.log('[Terminal] 新架构未找到配置，回退到旧架构');
    const legacyConfig = await getModelAPIConfig(model);

    // 🔧 #235 修复：服务商 API 期望 referenceImages 字段，而不是 urls
    // 同时保留 urls 字段以兼容其他场景
    const legacyRequestBody = {
      ...requestBody,
      referenceImages: requestBody.urls || [],  // GRS AI 期望的字段名
    };

    console.log('[Terminal] 旧架构请求体:', {
      ...legacyRequestBody,
      urls: legacyRequestBody.urls?.map?.((u: string) => u?.substring?.(0, 60) + '...') || legacyRequestBody.urls,
      referenceImages: legacyRequestBody.referenceImages?.map?.((u: string) => u?.substring?.(0, 60) + '...') || legacyRequestBody.referenceImages,
    });

    const response = await nodeRequest(legacyConfig.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${legacyConfig.apiKey}`,
      },
      body: JSON.stringify(legacyRequestBody),
      timeout: 360000,  // SSE 流需要 350+ 秒
    });

    return await parseTerminalResponseFromText(response.body, '旧架构');
  }

  // 使用新架构的通用配置
  console.log('[Terminal] 使用新架构配置:', {
    model: fullConfig.modelId,
    endpoint: fullConfig.apiEndpoint,
    method: fullConfig.requestMethod,
    hasApiKey: !!fullConfig.apiKey,
    hasHeaders: Object.keys(fullConfig.requestHeaders).length > 0,
    hasBodyTemplate: Object.keys(fullConfig.requestBodyTemplate).length > 0,
  });

  // 构建请求参数（补全所有变量）
  const variables = {
    prompt: requestBody.prompt,
    aspectRatio: requestBody.aspectRatio,
    resolution: requestBody.imageSize,  // GRS AI 用 ${resolution}
    imageSize: requestBody.imageSize,   // GRS AI 用 ${imageSize}
    referenceImages: requestBody.urls,  // GRS AI 用 ${referenceImages}
    urls: requestBody.urls,             // 通用变量
    model: requestBody.model,           // GRS AI 用 ${model}
    // 🔧 #263 修复：webhook URL 使用环境变量，支持多环境部署
    webhookBaseUrl: process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://kiikii.me',
  };

  // 使用配置模板构建请求头和请求体
  const { headers, body } = buildRequest(fullConfig, variables);

  // 确保 Content-Type 存在
  if (!headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  console.log('[Terminal] 构建的请求:', {
    headers: { ...headers, Authorization: headers.Authorization ? '•••••' : undefined, 'x-goog-api-key': headers['x-goog-api-key'] ? '•••••' : undefined },
    bodyKeys: Object.keys(body),
  });

  let response: { status: number; statusText: string; headers: Record<string, string>; body: string };
  try {
    // 使用 Node.js 原生 https 模块（绕过 undici 10秒连接超时限制）
    // SSE 流可能需要 90+ 秒才能完成，设置 120 秒超时
    response = await nodeRequest(fullConfig.apiEndpoint, {
      method: fullConfig.requestMethod,
      headers,
      body: JSON.stringify(body),
      timeout: 360000,  // SSE 流需要 350+ 秒
    });
  } catch (fetchError: any) {
    console.error('[Terminal] Fetch 失败:', {
      endpoint: fullConfig.apiEndpoint,
      method: fullConfig.requestMethod,
      error: fetchError,
      errorMessage: fetchError.message,
      errorName: fetchError.name,
      errorStack: fetchError.stack?.substring(0, 500)
    });
    throw new Error(`API 请求失败: ${fetchError.message || '网络错误'}`);
  }

  // 检测是否是 Gemini 同步响应
  const responseText = response.body;
  let data: any = null;

  try {
    data = JSON.parse(responseText);
  } catch {
    // 不是 JSON，走异步流程
  }

  if (data && isGeminiResponse(data)) {
    console.log('[Terminal] 检测到 Gemini 同步响应，直接处理图片');
    const sseResult = await handleGeminiResponse(data);
    // 返回一个虚拟任务 ID
    return {
      terminalTaskId: `gemini-${Date.now()}`,
      sseResult
    };
  }

  // 走 SSE 流解析流程（GRS AI）
  const result = await parseTerminalResponseFromText(responseText, '新架构', fullConfig.responseParser);
  
  // 如果 SSE 流已经返回了结果，直接返回
  if (result.sseResult) {
    return {
      terminalTaskId: result.terminalTaskId,
      sseResult: result.sseResult
    };
  }
  
  // #260 说明：只返回任务 ID 的情况，依赖 webhook 回调更新缓存
  // 不在这里轮询，因为：
  // 1. 轮询会阻塞 sendToTerminal 返回，导致 .then() 回调延迟执行
  // 2. 已配置 webhook URL，服务器会在完成后回调
  // 3. Webhook 会更新缓存，前端轮询检测到更新后发送 image 事件
  
  console.log(`[Terminal] 只返回任务 ID: ${result.terminalTaskId}，等待 webhook 回调`);
  
  return result;
}

// 解析终端响应
async function parseTerminalResponse(response: Response, source: string): Promise<{ terminalTaskId: string }> {
  const responseText = await response.text();
  return await parseTerminalResponseFromText(responseText, source);
}

// 从文本解析终端响应
async function parseTerminalResponseFromText(responseText: string, source: string, responseParser?: { taskIdPath?: string; statusPath?: string; imageUrlPath?: string; errorPath?: string }): Promise<{ terminalTaskId: string; sseResult?: { imageUrls: string[], imageKeys: string[] } }> {
  console.log(`[Terminal] ${source}响应长度: ${responseText.length} 字符, 前500字符: ${responseText.substring(0, 500)}`);

  // 解析响应获取任务ID
  let data: any = null;
  let lastSseData: any = null;  // 保存最后一个 SSE 数据
  
  if (responseText.startsWith('data:')) {
    // 流式响应，遍历所有行找到最终结果
    const lines = responseText.split('\n');
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const jsonStr = line.replace(/^data:\s*/, '');
        try {
          const parsed = JSON.parse(jsonStr);
          // 保存最后一个有效的 SSE 数据
          lastSseData = parsed;
          
          // 如果是第一行，用于提取任务ID
          if (!data) {
            data = parsed;
          }
          
          // 检查是否有最终结果（status: succeeded 或 failed）
          if (parsed.status === 'succeeded' || parsed.status === 'failed') {
            data = parsed;  // 用最终结果覆盖
            console.log(`[Terminal] SSE 流完成，状态: ${parsed.status}`);
          }
        } catch (e) {
          // 🔧 #207 诊断日志：JSON 解析失败
          console.warn(`[Terminal] JSON 解析失败，跳过该行:`, { 
            line: line.substring(0, 100), 
            error: e instanceof Error ? e.message : String(e) 
          });
        }
      }
    }
  } else if (responseText.startsWith('{')) {
    // JSON响应
    data = JSON.parse(responseText);
  }

  // 优先检查错误响应（使用配置的错误路径）
  const errorPath = responseParser?.errorPath || 'error';
  const errorValue = getNestedValue(data, errorPath);
  if (errorValue) {
    const errorMessage = typeof errorValue === 'object' ? (errorValue.message || JSON.stringify(errorValue)) : String(errorValue);
    console.error('[Terminal] 终端返回错误:', errorMessage);
    throw new Error(`API 错误: ${errorMessage}`);
  }
  
  // 检查 SSE 流是否已完成（status: succeeded）
  if (data?.status === 'succeeded' && data?.results) {
    console.log('[Terminal] SSE 流返回成功结果，直接提取图片, results:', JSON.stringify(data.results));
    const imageUrls: string[] = [];
    const imageKeys: string[] = [];
    
    for (const result of data.results) {
      if (result.url) {
        imageUrls.push(result.url);
        // 🔧 修复：下载终端图片并上传到 COS，获取持久化的 key
        try {
          const { uploadToCOS } = await import('@/lib/cos');
          const https = await import('https');
          
          // 下载图片
          const imageBuffer = await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            https.get(result.url, (res) => {
              res.on('data', (chunk) => chunks.push(chunk));
              res.on('end', () => resolve(Buffer.concat(chunks)));
              res.on('error', reject);
            }).on('error', reject);
          });
          
          // 上传到 COS
          const extension = result.url.split('.').pop()?.split('?')[0] || 'png';
          const key = `generated-images/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${extension}`;
          const uploadResult = await uploadToCOS(key, imageBuffer, 'image/png');
          
          imageKeys.push(uploadResult.key);  // 带环境前缀的 key
          console.log(`[Terminal] 终端图片已转存到 COS: ${uploadResult.key}`);
        } catch (err) {
          console.error('[Terminal] 终端图片转存失败:', err);
          imageKeys.push('');  // 失败时仍保持空字符串
        }
      }
    }
    
    if (imageUrls.length > 0) {
      return { 
        terminalTaskId: data.id || `sse-${Date.now()}`,
        sseResult: { imageUrls, imageKeys }
      };
    }
  }
  
  // 检查 SSE 流是否失败
  if (data?.status === 'failed') {
    const errorMsg = getErrorMessage(data);
    console.error('[Terminal] SSE 流返回失败:', errorMsg, '| failure_reason:', data.failure_reason);
    throw new Error(errorMsg);
  }

  // 提取任务ID（使用配置的路径）
  let terminalTaskId: string | undefined;

  if (responseParser?.taskIdPath) {
    // 使用配置的路径提取任务ID
    terminalTaskId = getNestedValue(data, responseParser.taskIdPath);
    console.log(`[Terminal] 使用配置路径 ${responseParser.taskIdPath} 提取任务ID: ${terminalTaskId}`);
  }

  // 回退到默认路径
  if (!terminalTaskId) {
    terminalTaskId = data?.data?.id || data?.data?.task_id || data?.id || data?.task_id;
    console.log(`[Terminal] 使用默认路径提取任务ID: ${terminalTaskId}`);
  }

  if (!terminalTaskId) {
    console.error('[Terminal] 无法解析任务ID，完整响应:', responseText);
    throw new Error('终端未返回任务ID');
  }

  console.log(`[Terminal] 获取到任务ID: ${terminalTaskId}`);
  return { terminalTaskId };
}

// 检测并处理 Gemini 同步响应（直接返回 Base64 图片）
function isGeminiResponse(data: any): boolean {
  return data?.candidates?.[0]?.content?.parts?.some((p: any) => p.inlineData?.data);
}

async function handleGeminiResponse(data: any): Promise<{ imageUrls: string[], imageKeys: string[] }> {
  const imageUrls: string[] = [];
  const imageKeys: string[] = [];
  
  const parts = data?.candidates?.[0]?.content?.parts || [];
  
  for (const part of parts) {
    if (part.inlineData?.data) {
      // 上传 Base64 图片到 COS
      const base64Data = part.inlineData.data;
      const mimeType = part.inlineData.mimeType || 'image/png';
      const extension = mimeType.split('/')[1] || 'png';
      
      try {
        const { uploadToCOS } = await import('@/lib/cos');
        const buffer = Buffer.from(base64Data, 'base64');
        const key = `generated-images/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${extension}`;
        
        // 🔧 修复：使用 uploadToCOS 返回的带环境前缀的 key
        const uploadResult = await uploadToCOS(key, buffer, mimeType);
        
        imageUrls.push(uploadResult.url);
        imageKeys.push(uploadResult.key); // 使用带环境前缀的 key
        
        console.log(`[Gemini] 图片上传成功: ${uploadResult.key}`);
      } catch (error) {
        console.error('[Gemini] 图片上传失败:', error);
      }
    }
  }
  
  return { imageUrls, imageKeys };
}

// 模拟 webhook 回调（用于 Gemini 同步响应）
async function simulateWebhookCallback(
  taskId: string,
  index: number,
  geminiResult: { imageUrls: string[], imageKeys: string[] }
): Promise<void> {
  try {
    const currentResult = getTaskResult(taskId);
    if (!currentResult) {
      console.error(`[Webhook] 任务 ${taskId} 不存在，无法模拟回调`);
      return;
    }
    
    // 更新图片 URL 和 Key
    const updatedImageUrls = [...(currentResult.imageUrls || [])];
    const updatedImageKeys = [...(currentResult.imageKeys || [])];
    
    if (index < updatedImageUrls.length) {
      updatedImageUrls[index] = geminiResult.imageUrls[0] || null;
    }
    if (index < updatedImageKeys.length) {
      updatedImageKeys[index] = geminiResult.imageKeys[0] || null;
    }
    
    // 检查是否所有图片都已完成
    const completedCount = updatedImageUrls.filter(url => url !== null).length;
    const totalCount = currentResult.requestParams?.generationCount || 1;
    const isCompleted = completedCount === totalCount;
    
    // 更新缓存
    setTaskResult(taskId, {
      ...currentResult,
      imageUrls: updatedImageUrls,
      imageKeys: updatedImageKeys,
      status: isCompleted ? 'completed' : 'generating',
      completedAt: isCompleted ? Date.now() : currentResult.completedAt,
    });
    
    console.log(`[Webhook] 模拟回调完成: taskId=${taskId}, index=${index}, completed=${completedCount}/${totalCount}`);
  } catch (error) {
    console.error(`[Webhook] 模拟回调失败:`, error);
  }
}

// 辅助函数：过滤有效的图片 URL
function validImageUrls(urls: (string | null)[]): string[] {
  return urls.filter((url): url is string => url !== null);
}

// 辅助函数：过滤有效的图片 Key
function validImageKeys(keys: (string | null)[]): string[] {
  return keys.filter((key): key is string => key !== null);
}

// 解析错误信息
function getErrorMessage(data: any): string {
  if (data.failure_reason) {
    switch (data.failure_reason) {
      case 'output_moderation':
        return '内容违规，积分返回';
      case 'input_moderation':
        return '输入内容违规';
      case 'error':
        return data.error || '生成失败，请重试';
      default:
        return data.failure_reason;
    }
  }
  
  if (data.error) {
    return data.error;
  }
  
  return '生成失败';
}

export async function POST(request: NextRequest) {
  // 声明变量用于外层 catch 和积分补偿
  let actualUserId: string | undefined;
  let totalCredits = 0;
  let creditsPerImage = 0;
  let actualTaskId = '';
  let creditsBalanceAfterDeduct: number | null = null;  // #276 修复：移到外层，catch 块可访问

  try {
    console.log('========================================');
    console.log('=== 图生图 API 路由 (Webhook模式) ===');
    console.log('========================================');

    const body = await request.json();
    const {
      images,
      isUrls = false,
      prompt,
      model: reqModel = 'nano-banana-fast',
      modelId, // 兼容前端使用的 modelId 参数
      resolution = '1K',
      aspectRatio = 'auto',
      generationCount: reqGenerationCount,
      count, // 兼容前端使用的 count 参数
      taskId,
      md5Hashes,
      userId,
    } = body;

    // 统一处理 modelId 和 model 参数
    const model = modelId || reqModel || 'nano-banana-fast';

    // 统一处理 count 和 generationCount 参数
    const generationCount = count || reqGenerationCount || 4;

    // 从 cookie 获取用户ID（如果前端没传）
    actualUserId = userId;
    if (!actualUserId) {
      try {
        const cookieStore = await cookies();
        actualUserId = cookieStore.get('user_id')?.value;
        console.log(`[POST] 从cookie获取用户ID: ${actualUserId || '未登录'}`);
      } catch (e) {
        console.log('[POST] 无法获取cookie');
      }
    }

    // ====== 限流检查 ======
    if (actualUserId) {
      const rateLimitResult = checkUserRateLimit(actualUserId, 10, 60000); // 每分钟 10 次
      if (!rateLimitResult.allowed) {
        console.log(`[限流] 用户 ${actualUserId} 请求过于频繁`);
        return new Response(JSON.stringify({
          error: '请求过于频繁，请稍后再试',
          resetTime: rateLimitResult.resetTime,
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
            'X-RateLimit-Reset': rateLimitResult.resetTime.toString(),
          },
        });
      }
    }

    // IP 限流（防止匿名用户刷接口）
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const ipLimitResult = checkUserRateLimit(`ip:${ip}`, 100, 60000); // 每分钟 100 次
    if (!ipLimitResult.allowed) {
      console.log(`[限流] IP ${ip} 请求过于频繁`);
      return new Response(JSON.stringify({
        error: '请求过于频繁，请稍后再试',
        resetTime: ipLimitResult.resetTime,
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': ipLimitResult.remaining.toString(),
          'X-RateLimit-Reset': ipLimitResult.resetTime.toString(),
        },
      });
    }

    // ====== 🛡️ 维度二：后端鉴权前置（双重校验）======
    // 在核心业务逻辑之前验证用户身份
    // 防止无效用户绕过鉴权直接进入计费逻辑
    if (actualUserId) {
      const { validateUser } = await import('@/lib/auth-middleware');
      const authResult = await validateUser();
      
      if (!authResult.success) {
        console.error(`[鉴权] 用户验证失败: ${authResult.error}`);
        return new Response(JSON.stringify({
          error: authResult.error || '用户不存在，请重新登录',
          code: 'USER_NOT_FOUND',
        }), {
          status: authResult.statusCode || 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // 验证通过，确认用户 ID 有效
      console.log(`[鉴权] 用户验证通过: ${authResult.userId}`);
    }

    console.log('请求参数:', {
      taskId,
      prompt: prompt?.substring(0, 100),
      model,
      resolution,
      aspectRatio,
      generationCount,
      imagesCount: images?.length || 0,
      md5Hashes: md5Hashes?.length || 0,
      userId: userId || '未提供',
    });

    if (!prompt) {
      return new Response(JSON.stringify({ error: '缺少必要参数：prompt' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 🔧 删除 webhook URL 构建：服务商走 SSE 流模式，不需要 webhook 回调
    // 但参考图 URL 仍需要公网域名
    const publicDomain = process.env.NEXT_PUBLIC_SITE_URL || 'https://kiikii.me';
    console.log(`[参考图] publicDomain=${publicDomain}, images数量=${images?.length || 0}, isUrls=${isUrls}`);

    // 生成任务ID（添加用户ID前缀，避免并发冲突）
    const userIdPrefix = actualUserId ? `${actualUserId.slice(0, 8)}-` : 'anon-';
    actualTaskId = taskId || `${userIdPrefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // 构建请求参数
    const requestBody: any = {
      model: model,
      prompt: prompt,
      aspectRatio: aspectRatio,
      imageSize: resolution,
      shutProgress: false, // 开启进度回调
      urls: [], // 默认空数组，避免 undefined
    };

    // 处理参考图
    if (images && images.length > 0) {
      if (isUrls) {
        requestBody.urls = images.filter((url: string) => url && url.length > 0);
        console.log(`[参考图] 使用URL方式, urls=`, requestBody.urls);
      } else {
        // 将 base64 存储到内存并生成本地公网URL
        const localUrls = images.map((img: string) => {
          const imageId = storeReferenceImage(img);
          return `${publicDomain}/api/ref-img/${imageId}`;
        });
        requestBody.urls = localUrls;
        console.log(`[参考图] 转换base64为URL, localUrls=`, localUrls);
      }
    } else {
      console.log(`[参考图] 无参考图`);
    }

    // ====== 积分扣除逻辑（必须在 setTaskResult 之前，因为需要 creditsPerImage）======
    console.log(`[积分扣除] ====== 开始积分扣除流程 ======`);
    console.log(`[积分扣除] actualUserId=${actualUserId}, totalCredits 将计算`);
    totalCredits = await calculateCredits(model, resolution, generationCount);
    creditsPerImage = generationCount > 0 ? totalCredits / generationCount : 0;
    console.log(`[积分扣除] 总共需要 ${totalCredits} 积分 (每张 ${creditsPerImage})`);

    // ====== #105 修复：后端直接扣积分（前端不再扣积分）======
    let creditsDeducted = false;
    // creditsBalanceAfterDeduct 已在函数开头定义（#276 修复：移到外层，catch 块可访问）
    
    console.log(`[积分扣除] 检查条件: actualUserId=${!!actualUserId}, totalCredits=${totalCredits}`);
    
    if (actualUserId && totalCredits > 0) {
      console.log(`[积分扣除] ✅ 条件满足，开始调用 deductCredits`);
      // #271 双式记账：传入 taskId 作为 referenceId
      const deductResult = await deductCredits(actualUserId, totalCredits, actualTaskId);
      console.log(`[积分扣除] deductCredits 返回:`, JSON.stringify(deductResult));
      
      if (!deductResult.success) {
        console.error(`[积分扣除] ❌ 扣除失败: ${deductResult.error}`);
        return new Response(JSON.stringify({ 
          error: deductResult.error || '积分不足',
          currentCredits: deductResult.remaining,
          requiredCredits: totalCredits,
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      creditsDeducted = true;
      creditsBalanceAfterDeduct = deductResult.remaining ?? null;  // 🔥 保存余额
      console.log(`[积分扣除] ✅ 扣除成功，剩余: ${creditsBalanceAfterDeduct}`);
    } else if (!actualUserId) {
      console.warn(`[积分扣除] ⚠️ 未登录用户，跳过扣积分`);
    } else if (totalCredits === 0) {
      console.warn(`[积分扣除] ⚠️ 积分为0，跳过扣积分`);
    }

    // 初始化任务缓存（包括 imageItems 和 creditsPerImage）
    setTaskResult(actualTaskId, {
      status: 'generating',
      imageUrls: new Array(generationCount).fill(null), // 预分配数组，按索引更新
      imageKeys: new Array(generationCount).fill(null),
      errors: [],
      createdAt: Date.now(),
      requestParams: {
        prompt: prompt,
        model: model,
        resolution: resolution,
        aspectRatio: aspectRatio,
        generationCount: generationCount,
        creditsPerImage: creditsPerImage,
        urls: requestBody.urls,
        // #244 新增：存储参考图 MD5，用于历史记录恢复
        referenceImageMd5s: md5Hashes,
        referenceImageUrls: requestBody.images,  // 参考图 URL
        // #267 新增：存储 userId，用于 Webhook 失败返还积分
        userId: actualUserId,
      },
      // 初始化 imageItems（与 webhook 逻辑一致）
      imageItems: Array.from({ length: generationCount }, (_, idx) => ({
        index: idx,
        url: null,
        key: null,
        status: 'generating' as const,
        error: null,
      })),
    });

    // 创建流式响应
    const encoder = new TextEncoder();
    let isControllerClosed = false;
    
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: any) => {
          if (isControllerClosed) return;
          try {
            const eventData = `data: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(eventData));
            console.log(`[SSE] 发送事件: type=${data.type}`);
          } catch (e) {
            console.error('发送事件失败:', e);
            isControllerClosed = true;
          }
        };

        // 发送开始事件
        // #270 新增：携带扣费后的积分信息，让前端立即显示积分变化
        sendEvent({ 
          type: 'start', 
          count: generationCount, 
          taskId: actualTaskId,
          creditsCharged: totalCredits > 0 ? totalCredits : undefined,
          creditsBalance: creditsBalanceAfterDeduct ?? undefined,
        });

        // 串行提交：3秒1个，逐个发给供应商，避免触发流量清洗
        const imageUrls: (string | null)[] = new Array(generationCount).fill(null);
        const imageKeys: (string | null)[] = new Array(generationCount).fill(null);
        const errors: { index: number; error: string }[] = [];
        const terminalTaskIds: string[] = [];
        let submittedCount = 0;
        let failedCount = 0;
        
        // 记录已发送的图片索引，防止重复发送
        const sentImageIndices = new Set<number>();
        const sentFailedIndices = new Set<number>();

        // 🔧 军规第3条：异步间隔发射，3秒发1个，但不等返图
        // 禁止：0毫秒瞬间砸过去100个请求（这叫轰炸）
        // 提倡：每隔3秒点燃一个任务，点火后不等返图直接点下一个
        for (let index = 0; index < generationCount; index++) {
          if (isControllerClosed) break;

          // 非第一个请求，等待1秒再发（避免触发供应商流量清洗）
          if (index > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          // 🔧 #207 诊断日志：提交前记录每个子任务
          console.log(`[SSE] 🚀 开始提交第 ${index + 1}/${generationCount} 张图片任务`, {
            taskId: actualTaskId,
            index,
            model,
            hasPrompt: !!prompt,
            promptLength: prompt?.length || 0,
            hasImages: !!(requestBody.urls && requestBody.urls.length > 0),
            imageCount: requestBody.urls?.length || 0,
          });

          // 🔧 异步发射：不等待 SSE 流返回，直接继续下一个
          sendToTerminal(requestBody, model)
            .then((result) => {
              terminalTaskIds[index] = result.terminalTaskId;

              // 保存映射
              saveTaskIdMapping(
                actualTaskId,
                result.terminalTaskId,
                actualUserId,
                {
                  prompt,
                  model,
                  resolution,
                  aspectRatio,
                  generationCount,
                  creditsPerImage,
                },
                index
              );

              // 每提交成功1个，立刻推送 submitted 事件
              if (!isControllerClosed) {
                sendEvent({ type: 'submitted', index, terminalTaskId: result.terminalTaskId });
              }

              // SSE 流返回了结果，直接处理
              if (result.sseResult && result.sseResult.imageUrls.length > 0) {
                console.log(`[SSE] 第 ${index + 1} 张图片 SSE 完成，URL: ${result.sseResult.imageUrls[0]?.substring(0, 50)}...`);
                
                // 更新缓存
                const currentResult = getTaskResult(actualTaskId);
                if (currentResult) {
                  const existingItems = currentResult.imageItems || [];
                  existingItems[index] = {
                    index,
                    url: result.sseResult.imageUrls[0] || null,
                    key: result.sseResult.imageKeys[0] || null,
                    status: 'completed' as const,
                    error: null,
                  };
                  // #228 诊断：打印更新后的 imageItems 状态
                  const completedItems = existingItems.filter(i => i.status === 'completed').length;
                  console.log(`[SSE] #228 异步回调更新缓存: index=${index}, status=completed, 已完成=${completedItems}/${generationCount}`);
                  setTaskResult(actualTaskId, {
                    ...currentResult,
                    imageItems: existingItems,
                  });
                }
                
                // 推送图片事件给前端
                if (!isControllerClosed) {
                  sendEvent({ 
                    type: 'image', 
                    index,
                    url: result.sseResult.imageUrls[0],
                    imageKey: result.sseResult.imageKeys[0], // 添加 imageKey，防止刷新后丢失
                    taskId: actualTaskId 
                  });
                  sentImageIndices.add(index); // 记录已发送，防止轮询时重复发送
                }
                
                imageUrls[index] = result.sseResult.imageUrls[0] || null;
                imageKeys[index] = result.sseResult.imageKeys[0] || null;
              } else if (result.terminalTaskId) {
                // #260 修复：有 terminalTaskId 但没有 sseResult，说明任务已提交
                // 等待 webhook 回调更新缓存，前端轮询会检测到更新
                console.log(`[SSE] 第 ${index + 1} 张图片任务已提交: ${result.terminalTaskId}，等待 webhook 回调`);
                submittedCount++;
              } else {
                // 🔧 #207 诊断日志：终端返回成功但没有图片，也没有任务 ID
                console.warn(`[SSE] ⚠️ 第 ${index + 1} 张图片终端返回成功但没有图片:`, {
                  terminalTaskId: result.terminalTaskId,
                  hasSseResult: !!result.sseResult,
                  imageUrlsLength: result.sseResult?.imageUrls?.length || 0,
                  imageKeysLength: result.sseResult?.imageKeys?.length || 0,
                });
                
                // 🔧 #207 修复：终端返回成功但没有图片，也没有任务 ID，标记为失败
                failedCount++;
                errors.push({ index, error: '终端返回空结果' });
                
                // 更新缓存为失败状态
                const currentResult = getTaskResult(actualTaskId);
                if (currentResult) {
                  const existingItems = currentResult.imageItems || [];
                  existingItems[index] = {
                    index,
                    url: null,
                    key: null,
                    status: 'failed' as const,
                    error: '终端返回空结果',
                  };
                  setTaskResult(actualTaskId, {
                    ...currentResult,
                    imageItems: existingItems,
                  });
                }
                
                // 推送失败事件给前端
                if (!isControllerClosed) {
                  sendEvent({ type: 'item_failed', index, error: '终端返回空结果' });
                  sentFailedIndices.add(index);
                }
              }

              console.log(`[SSE] 第 ${index + 1} 张图片任务已完成: ${result.terminalTaskId}`);
              submittedCount++;
            })
            .catch((error: any) => {
              console.error(`[SSE] 第 ${index + 1} 次提交失败:`, error.message);
              errors.push({ index, error: error.message || '提交失败' });
              failedCount++;

              // 提交失败时，立刻推送 item_failed + 更新缓存
              if (!isControllerClosed) {
                sendEvent({ type: 'item_failed', index, error: error.message || '提交失败' });
              }

              const currentResult = getTaskResult(actualTaskId);
              if (currentResult) {
                const existingItems = currentResult.imageItems || [];
                existingItems[index] = {
                  index,
                  url: null,
                  key: null,
                  status: 'failed' as const,
                  error: error.message || '提交失败',
                };
                setTaskResult(actualTaskId, {
                  ...currentResult,
                  imageItems: existingItems,
                });
              }
            });
          
          // 🔧 点火后立刻继续下一个，不等待结果
        }

        // 不等待请求完成，立刻进入轮询循环
        // 请求结果通过异步回调处理（上面的 .then/.catch）

        // 统一等待结果：轮询检查缓存状态
        // 🔧 支持 350+ 秒的 SSE 流：7 分钟超时
        const maxWaitTime = 420000;  // 7 分钟
        const checkInterval = 2000;
        const forceCloseTimeout = 120000; // 🔧 2 分钟无任何事件强制断开
        let waited = 0;
        let lastEventTime = Date.now(); // 心跳计时器
        
        while (waited < maxWaitTime && !isControllerClosed) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            waited += checkInterval;

            // 🔧 2 分钟无任何事件强制断开，防止死连接占内存
            if (Date.now() - lastEventTime > forceCloseTimeout) {
              console.log(`[SSE] ⚠️ 2分钟无事件，强制断开: ${actualTaskId}`);
              sendEvent({ type: 'timeout', taskId: actualTaskId, message: '连接超时，请稍后查询结果' });
              controller.close();
              isControllerClosed = true;
              break;
            }

            // 心跳保护：15秒内无业务事件，发送 ping 防止连接被掐
            if (Date.now() - lastEventTime > 15000 && !isControllerClosed) {
              try {
                sendEvent({ type: 'ping' });
                // 注意：ping 不重置 lastEventTime，因为 ping 不代表业务进展
              } catch {
                // SSE 已关闭，退出循环
                break;
              }
            }
            
            // 检查是否所有图片都提交失败（异步填充的 errors 在轮询中被检测到）
            if (failedCount >= generationCount) {
              const errorMsg = errors.map(e => e.error).join('; ');
              
              // ====== #268 修复：所有图片提交失败时，必须返还积分 ======
              let creditsBalanceAfter = creditsBalanceAfterDeduct;
              const currentResult = getTaskResult(actualTaskId);
              
              // #155 防止积分重复返还
              if (creditsDeducted && actualUserId && creditsPerImage > 0 && !currentResult?.creditsRefunded) {
                const refundAmount = generationCount * creditsPerImage;
                console.log(`[积分补偿] 所有图片提交失败，退还 ${refundAmount} 积分`);
                try {
                  const refundResult = await refundCredits(actualUserId, refundAmount, actualTaskId, `所有图片提交失败`);
                  if (refundResult.success) {
                    creditsBalanceAfter = refundResult.remaining ?? null;
                    console.log(`[积分补偿] 全额退还成功，剩余 ${creditsBalanceAfter} 积分`);
                    // #155 标记已返还，防止重复
                    const latestResult = getTaskResult(actualTaskId);
                    if (latestResult) {
                      setTaskResult(actualTaskId, { ...latestResult, creditsRefunded: true });
                    }
                  } else {
                    console.error(`[积分补偿] 全额退还失败: ${refundResult.error}`);
                  }
                } catch (err) {
                  console.error(`[积分补偿] 全额退还异常:`, err);
                }
              }
              
              if (!isControllerClosed) {
                sendEvent({ 
                  type: 'error', 
                  taskId: actualTaskId,
                  error: `所有图片提交失败: ${errorMsg}`,
                  creditsRefunded: generationCount * creditsPerImage,
                  creditsBalance: creditsBalanceAfter,
                });
              }
              console.log(`[SSE] 所有图片提交失败: ${actualTaskId}`);
              if (currentResult) {
                setTaskResult(actualTaskId, {
                  ...currentResult,
                  status: 'failed',
                  errors: errors,
                  completedAt: Date.now(),
                });
              }
              controller.close();
              isControllerClosed = true;
              break;
            }
            
            // 检查缓存是否已更新
            const currentResult = getTaskResult(actualTaskId);
            if (currentResult) {
              const imageItems = currentResult.imageItems || [];
              const urls = currentResult.imageUrls || [];
              const keys = currentResult.imageKeys || [];
              let hasNewEvent = false;
              
              // #228 诊断：打印每个检查周期的 imageItems 状态
              console.log(`[SSE] #228 轮询检查: imageItems=${imageItems.length}, 已发送=${sentImageIndices.size}, 已发送失败=${sentFailedIndices.size}`);
              
              // 检查是否有新完成的图片，立刻发送
              for (const item of imageItems) {
                if (item.status === 'completed' && item.url && !sentImageIndices.has(item.index)) {
                  if (!isControllerClosed) {
                    sendEvent({ type: 'image', index: item.index, url: item.url, imageKey: item.key });
                    sentImageIndices.add(item.index);
                    hasNewEvent = true;
                    console.log(`[SSE] 发送新完成的图片: index=${item.index}, url=${item.url?.substring(0, 50)}`);
                  }
                } else if (item.status === 'failed' && !sentFailedIndices.has(item.index)) {
                  if (!isControllerClosed) {
                    sendEvent({ type: 'item_failed', index: item.index, error: item.error || '生成失败' });
                    sentFailedIndices.add(item.index);
                    hasNewEvent = true;
                    console.log(`[SSE] 发送失败的图片: index=${item.index}, error=${item.error}`);
                  }
                }
              }
              
              if (hasNewEvent) {
                lastEventTime = Date.now();
              }
              
              // ====== 检查是否所有图片都完成了 ======
              const completedCount = imageItems.filter(i => i.status === 'completed').length;
              const failedCount = imageItems.filter(i => i.status === 'failed').length;
              const allDone = completedCount + failedCount >= generationCount;
              
              // #228 诊断：打印每个检查周期的详细状态
              console.log(`[SSE] #228 检查完成状态: completedCount=${completedCount}, failedCount=${failedCount}, generationCount=${generationCount}, allDone=${allDone}, currentStatus=${currentResult.status}`);
              
              // #227 修复：更新状态后直接检查新状态，防止 currentResult 变量是旧值
              if (allDone && currentResult.status !== 'completed' && currentResult.status !== 'failed') {
                const newStatus = completedCount > 0 ? 'completed' : 'failed';
                // 标记任务完成
                setTaskResult(actualTaskId, {
                  ...currentResult,
                  status: newStatus,
                  completedAt: Date.now(),
                });
                console.log(`[SSE] 所有图片已完成: ${completedCount} 成功, ${failedCount} 失败, status=${newStatus}`);
                
                // 立即检查是否需要发送 complete 事件
                // #226: 同时更新 completedAt 用于前端判断
                let finalCreditsBalance = creditsBalanceAfterDeduct;
                
                // 部分失败退还积分
                let finalRefundAmount = 0;
                // #277 修复：必须先获取最新状态，再检查 creditsRefunded，防止双重返还
                const latestResultForRefund = getTaskResult(actualTaskId);
                if (failedCount > 0 && creditsDeducted && actualUserId && creditsPerImage > 0 && !latestResultForRefund?.creditsRefunded) {
                  finalRefundAmount = failedCount * creditsPerImage;
                  try {
                    const refundResult = await refundCredits(actualUserId, finalRefundAmount, actualTaskId, `部分图片失败退还`);
                    if (refundResult.success) {
                      console.log(`[积分补偿] 部分失败退还 ${finalRefundAmount} 积分成功，剩余 ${refundResult.remaining}`);
                      // #276 修复：更新最终余额，确保前端显示正确的积分
                      finalCreditsBalance = refundResult.remaining ?? finalCreditsBalance;
                      // #267 标记已返还，防止重复
                      const currentResultAfterRefund = getTaskResult(actualTaskId);
                      if (currentResultAfterRefund) {
                        setTaskResult(actualTaskId, { ...currentResultAfterRefund, creditsRefunded: true });
                      }
                    }
                  } catch (err) {
                    console.error(`[积分补偿] 部分失败退还异常:`, err);
                  }
                }
                
                // 收集所有成功图片
                const completedUrls = imageItems
                  .filter(i => i.status === 'completed' && i.url)
                  .map(i => i.url as string);
                const completedKeys = imageItems
                  .filter(i => i.status === 'completed' && i.key)
                  .map(i => i.key as string);
                
                // #226 修复：发送 complete 事件
                if (!isControllerClosed) {
                  sendEvent({
                    type: 'complete',
                    taskId: actualTaskId,
                    imageUrls: completedUrls,
                    imageKeys: completedKeys,
                    creditsBalance: finalCreditsBalance,
                    creditsCharged: generationCount * creditsPerImage - finalRefundAmount,
                  });
                  console.log(`[SSE] 发送 complete 事件: ${completedUrls.length} 张图片`);
                }
                
                // #227: 更新缓存状态（确保轮询能获取到 completed）
                setTaskResult(actualTaskId, {
                  ...currentResult,
                  status: 'completed',
                  imageItems: imageItems,
                  completedAt: Date.now(),
                });
                
                break; // 完成后跳出循环
              }
              
              // 检查是否全部完成
              if (currentResult.status === 'completed' || currentResult.status === 'failed') {
                // 任务失败
                if (currentResult.status === 'failed') {
                  const errorMsg = currentResult.errors?.map(e => e.error).join('; ') || '任务失败';
                  
                  // ====== 全部失败，退还全部积分 ======
                  let creditsBalanceAfter = creditsBalanceAfterDeduct;  // 🔥 优先使用扣费后的余额
                  // #277 修复：必须先获取最新状态，再检查 creditsRefunded，防止双重返还
                  const latestResultForFailedRefund = getTaskResult(actualTaskId);
                  // #155 防止积分重复返还
                  if (creditsDeducted && actualUserId && creditsPerImage > 0 && !latestResultForFailedRefund?.creditsRefunded) {
                    const refundAmount = generationCount * creditsPerImage;
                    console.log(`[积分补偿] 任务全部失败，退还 ${refundAmount} 积分`);
                    try {
                      const refundResult = await refundCredits(actualUserId, refundAmount, actualTaskId, `任务全部失败`);
                      if (refundResult.success) {
                        creditsBalanceAfter = refundResult.remaining ?? null;
                        console.log(`[积分补偿] 全额退还成功，剩余 ${creditsBalanceAfter} 积分`);
                        // #155 标记已返还，防止重复
                        const afterRefundResult = getTaskResult(actualTaskId);
                        if (afterRefundResult) {
                          setTaskResult(actualTaskId, { ...afterRefundResult, creditsRefunded: true });
                        }
                      } else {
                        console.error(`[积分补偿] 全额退还失败: ${refundResult.error}`);
                      }
                    } catch (err) {
                      console.error(`[积分补偿] 全额退还异常:`, err);
                    }
                  }
                  
                  if (!isControllerClosed) {
                    sendEvent({ 
                      type: 'error', 
                      taskId: actualTaskId,
                      error: errorMsg,
                      creditsRefunded: generationCount * creditsPerImage,
                      creditsBalance: creditsBalanceAfter,
                    });
                  }
                  console.log(`[SSE] 任务失败: ${actualTaskId}, 错误: ${errorMsg}`);
                  break;
                }
                
                // #206 修复：从 imageItems 中提取图片 URL 和 key（在积分补偿之前计算）
                const completedImageItems = imageItems.filter(i => i.status === 'completed' && i.url);
                const completedImageUrls = completedImageItems.map(i => i.url!);
                const completedImageKeys = completedImageItems.map(i => i.key!).filter(k => k);
                console.log(`[SSE] 提取完成的图片: ${completedImageUrls.length} 个URL, ${completedImageKeys.length} 个key`);
                
                // ====== 积分补偿：部分失败时退还失败部分的积分 ======
                let refundAmount = 0;
                let creditsBalanceAfter = creditsBalanceAfterDeduct;  // 🔥 优先使用扣费后的余额
                
                // #277 修复：必须先获取最新状态，再检查 creditsRefunded，防止双重返还
                const latestResultForSSERefund = getTaskResult(actualTaskId);
                // #155 防止积分重复返还
                if (creditsDeducted && actualUserId && creditsPerImage > 0 && !latestResultForSSERefund?.creditsRefunded) {
                  const failedItems = imageItems.filter(i => i.status === 'failed');
                  if (failedItems.length > 0) {
                    refundAmount = failedItems.length * creditsPerImage;
                    console.log(`[积分补偿] SSE完成：${failedItems.length}/${generationCount} 张失败，退还 ${refundAmount} 积分`);
                    try {
                      const refundResult = await refundCredits(actualUserId, refundAmount, actualTaskId, `SSE完成：${failedItems.length}张图片失败`);
                      if (refundResult.success) {
                        creditsBalanceAfter = refundResult.remaining ?? null;
                        console.log(`[积分补偿] SSE退还成功，剩余 ${creditsBalanceAfter} 积分`);
                        // #155 标记已返还，防止重复
                        const afterRefundResult = getTaskResult(actualTaskId);
                        if (afterRefundResult) {
                          setTaskResult(actualTaskId, { ...afterRefundResult, creditsRefunded: true });
                        }
                      } else {
                        console.error(`[积分补偿] SSE退还失败: ${refundResult.error}`);
                      }
                    } catch (err) {
                      console.error(`[积分补偿] SSE退还异常:`, err);
                    }
                  }
                  // 🔥 全部成功时不再查询，直接使用扣费后的余额
                }
                
                // ====== 不再在此处保存生成记录 ======
                // #225 修复：移除后端保存逻辑，由前端统一保存（带 source 字段区分画布/生图）
                // 前端在 onComplete 回调中会保存记录，并传递 source: 'canvas' 或 'generate'
                
                // #226 修复：更新缓存中的任务状态为 completed，防止轮询无限循环
                setTaskResult(actualTaskId, {
                  ...currentResult,
                  status: 'completed',
                  imageItems: imageItems,
                  completedAt: Date.now(),
                });
                console.log(`[SSE] 已更新任务状态为 completed: ${actualTaskId}`);
                
                // 任务完成，发送complete事件（含积分信息）
                if (!isControllerClosed) {
                  sendEvent({ 
                    type: 'complete', 
                    taskId: actualTaskId,
                    imageUrls: completedImageUrls,
                    imageKeys: completedImageKeys,
                    imageItems: imageItems.map(item => ({
                      ...item,
                      imageKey: item.key,
                    })),
                    errors: currentResult.errors,
                    count: completedImageUrls.length,
                    total: generationCount,
                    creditsCharged: totalCredits - refundAmount,
                    creditsRefunded: refundAmount,
                    creditsBalance: creditsBalanceAfter,
                  });
                }
                
                  console.log(`[SSE] 任务完成: ${actualTaskId}, ${completedImageUrls.length}/${generationCount} 张图片`);
                break;
              }
            }
            
            // 发送等待事件
            if (waited % 10000 === 0 && !isControllerClosed) {
              sendEvent({ type: 'waiting', elapsed: waited });
            }
          }
          
          // 如果超时，告诉前端可以通过 taskId 查询
          if (waited >= maxWaitTime) {
            // 检查缓存中的任务状态，如果还有未完成的图片，标记为失败
            const currentResult = getTaskResult(actualTaskId);
            let timeoutCreditsBalance = creditsBalanceAfterDeduct;  // #276 修复：超时场景的积分余额
            
            if (currentResult && currentResult.status === 'generating') {
              const generationCount = currentResult.requestParams?.generationCount || 0;
              const imageItems = currentResult.imageItems || [];
              
              // 标记所有未完成的图片为失败
              const updatedImageItems = imageItems.map(item => {
                if (item.status === 'generating') {
                  return { ...item, status: 'failed' as const, error: '超时' };
                }
                return item;
              });
              
              // 检查是否全部失败
              const hasSuccessfulImages = updatedImageItems.some(i => i.status === 'completed');
              const failedCount = updatedImageItems.filter(i => i.status === 'failed').length;
              
              setTaskResult(actualTaskId, {
                ...currentResult,
                status: hasSuccessfulImages ? 'completed' : 'failed',
                imageItems: updatedImageItems,
                completedAt: Date.now(),
              });
              
              // #276 修复：积分补偿改为 await，确保返还完成后再发送事件
              // #277 修复：必须先获取最新状态，再检查 creditsRefunded，防止双重返还
              const latestResultForTimeoutRefund = getTaskResult(actualTaskId);
              // #155 防止积分重复返还
              if (failedCount > 0 && creditsDeducted && actualUserId && creditsPerImage > 0 && !latestResultForTimeoutRefund?.creditsRefunded) {
                const refundAmount = failedCount * creditsPerImage;
                console.log(`[积分补偿] 超时场景：${failedCount}/${generationCount} 张失败，退还 ${refundAmount} 积分`);
                try {
                  const refundResult = await refundCredits(actualUserId, refundAmount, actualTaskId, `超时：${failedCount}张图片失败`);
                  if (refundResult.success) {
                    timeoutCreditsBalance = refundResult.remaining ?? timeoutCreditsBalance;  // #276 修复：更新余额
                    console.log(`[积分补偿] 超时退还成功，剩余 ${refundResult.remaining} 积分`);
                    // #155 标记已返还，防止重复
                    const afterRefundResult = getTaskResult(actualTaskId);
                    if (afterRefundResult) {
                      setTaskResult(actualTaskId, { ...afterRefundResult, creditsRefunded: true });
                    }
                  } else {
                    console.error(`[积分补偿] 超时退还失败: ${refundResult.error}`);
                  }
                } catch (err) {
                  console.error(`[积分补偿] 超时退还异常:`, err);
                }
              }
              
              console.log(`[SSE] 超时，标记未完成图片为失败: ${actualTaskId}`);
            }
            
            sendEvent({ 
              type: 'timeout', 
              taskId: actualTaskId,
              message: '请求超时，请稍后查询结果',
              terminalTaskIds: terminalTaskIds,
              creditsBalance: timeoutCreditsBalance,  // #276 修复：携带最新积分余额
            });
          }

        // 结束 SSE 流
        isControllerClosed = true;
        try {
          controller.close();
        } catch (e) {
          // 忽略
        }

        // 异步存储参考图
        if (userId && md5Hashes && md5Hashes.length > 0 && images && images.length > 0 && !isUrls) {
          const referenceImageData = images.map((img: string, i: number) => ({
            md5: md5Hashes[i],
            base64: img,
          }));
          storeReferenceImages(userId, referenceImageData).catch(err => {
            console.error('异步存储参考图失败:', err);
          });
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',  // #213 禁用 Nginx 缓冲，确保 SSE 事件实时传输
      },
    });

  } catch (error) {
    console.error('图生图 API 错误:', error);

    // #276 修复：API 内部错误场景改为 await，确保返还完成后再返回
    let errorCreditsBalance = creditsBalanceAfterDeduct;  // 当前余额
    const currentResult = actualTaskId ? getTaskResult(actualTaskId) : null;
    if (actualUserId && totalCredits && !currentResult?.creditsRefunded) {
      console.log(`[积分补偿] API 错误，尝试退还 ${totalCredits} 积分`);
      try {
        const refundResult = await refundCredits(actualUserId, totalCredits, actualTaskId || 'unknown', 'API 内部错误');
        if (refundResult.success) {
          errorCreditsBalance = refundResult.remaining ?? errorCreditsBalance;
          console.log(`[积分补偿] 退还成功，剩余 ${errorCreditsBalance} 积分`);
          // #155 标记已返还
          if (actualTaskId) {
            const latestResult = getTaskResult(actualTaskId);
            if (latestResult) {
              setTaskResult(actualTaskId, { ...latestResult, creditsRefunded: true });
            }
          }
        } else {
          console.error(`[积分补偿] 退还失败: ${refundResult.error}`);
        }
      } catch (err) {
        console.error(`[积分补偿] 退还异常:`, err);
      }
    }

    return new Response(JSON.stringify({ 
      error: '服务器内部错误',
      details: error instanceof Error ? error.message : '未知错误',
      creditsBalance: errorCreditsBalance,  // #276 修复：携带最新积分余额
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// GET 方法：查询任务结果
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');
  
  if (!taskId) {
    return new Response(JSON.stringify({ error: '缺少 taskId 参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  // 先从缓存查找
  let result = getTaskResult(taskId);
  
  // #210 修复：如果缓存中任务状态是 generating 且已超过 60 秒，也去数据库检查
  // 这是为了处理 SSE 流断开但数据库已有结果的情况
  const shouldCheckDatabase = !result || (
    result.status === 'generating' && 
    Date.now() - result.createdAt > 60 * 1000
  );
  
  if (shouldCheckDatabase) {
    console.log(`[GET] 任务 ${taskId} ${result ? '超时检查' : '缓存不存在'}，查询数据库...`);
    
    try {
      const client = getSupabaseClient(undefined, true);
      const { data, error } = await client
        .from('generation_records')
        .select('*')
        .eq('task_id', taskId)
        .maybeSingle();
      
      if (data && !error) {
        console.log(`[GET] #210 从数据库恢复任务 ${taskId}，${data.images?.length || 0} 张图片，覆盖缓存状态`);
        
        // 生成签名URL
        const { getSignedUrl } = await import('@/lib/cos');
        const imageUrls = await Promise.all(
          (data.image_keys || []).map(async (key: string) => {
            try {
              return await getSignedUrl(key, 432000);
            } catch {
              return null;
            }
          })
        );
        
        const validUrls = imageUrls.filter((url): url is string => url !== null);
        const generationCount = data.images?.length || 4;
        
        result = {
          status: 'completed' as const,
          imageUrls: validUrls,
          imageKeys: data.image_keys || [],
          errors: [],
          createdAt: new Date(data.created_at).getTime(),
          completedAt: new Date(data.created_at).getTime(),
          requestParams: {
            prompt: data.prompt || '',
            model: data.model || 'nano-banana',
            resolution: data.resolution || '1K',
            aspectRatio: data.aspect_ratio || 'auto',
            generationCount,
            // #244 新增：从数据库恢复参考图 MD5，用于历史记录恢复
            referenceImageMd5s: data.reference_image_md5s || [],
            referenceImageUrls: data.reference_images || [],
            referenceImageKeys: data.reference_image_keys || [],
          },
          imageItems: validUrls.map((url, idx) => ({
            index: idx,
            url,
            key: data.image_keys?.[idx] || null,
            status: 'completed' as const,
            error: null,
          })),
          // #233 修复：从数据库恢复积分信息，避免历史记录缺失积分扣除数值
          creditsCharged: data.credits_charged ?? undefined,
          creditsBalance: data.credits_balance ?? undefined,
        };
        
        // 重新保存到缓存
        setTaskResult(taskId, result);
      } else {
        console.log(`[GET] 数据库中也没有任务 ${taskId}`);
      }
    } catch (err) {
      console.error(`[GET] 从数据库恢复失败:`, err);
    }
  }
  
  if (!result) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: '任务不存在或已过期' 
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 如果任务还在生成中且没有 imageItems，补充默认的 imageItems
  if (result.status === 'generating' && !result.imageItems) {
    const generationCount = result.requestParams?.generationCount || result.imageUrls?.length || 4;
    result.imageItems = Array.from({ length: generationCount }, (_, idx) => ({
      index: idx,
      url: null,
      key: null,
      status: 'generating' as const,
      error: null,
    }));
  }

  // #254 修复：如果 imageUrls 包含 null，从 imageItems 中提取实际的 URL
  // 这是因为 SSE 完成事件后缓存更新时没有同步更新 imageUrls
  if (result.imageItems && result.imageItems.length > 0) {
    const actualImageUrls = result.imageItems
      .filter(item => item.status === 'completed' && item.url)
      .map(item => item.url);
    const actualImageKeys = result.imageItems
      .filter(item => item.status === 'completed' && item.key)
      .map(item => item.key);

    // 只有当 imageItems 中的 URL 比原有的多时才更新
    if (actualImageUrls.length > (result.imageUrls?.filter(u => u !== null).length || 0)) {
      console.log(`[GET] #254 从 imageItems 提取 URL: 原有 ${result.imageUrls?.filter(u => u !== null).length || 0} 张, 提取 ${actualImageUrls.length} 张`);
      result.imageUrls = actualImageUrls;
      result.imageKeys = actualImageKeys;
    }
  }

  // 为 imageItems 添加 imageKey 字段映射（前端使用 imageKey）
  if (result.imageItems && result.imageItems.length > 0) {
    result.imageItems = result.imageItems.map((item: { 
      index: number; 
      url: string | null; 
      key: string | null; 
      status: 'completed' | 'generating' | 'failed'; 
      error: string | null; 
    }) => ({
      ...item,
      imageKey: item.key,  // 添加 imageKey 字段
    }));
  }

  // 计算 completedCount（用于前端进度显示）
  const completedCount = result.imageItems?.filter(item => item.status === 'completed').length 
    || result.imageUrls?.filter(url => url !== null).length 
    || 0;
  
  // 计算 failedCount
  const failedCount = result.imageItems?.filter(item => item.status === 'failed').length || 0;
  
  // #230 修复：根据实际完成数量更新状态
  const totalCount = result.requestParams?.generationCount || result.imageItems?.length || result.imageUrls?.length || 1;
  const allDone = completedCount + failedCount >= totalCount;
  
  // 如果所有图片都完成了，但状态还是 generating，更新为 completed 或 failed
  let finalStatus = result.status;
  if (allDone && result.status === 'generating') {
    finalStatus = completedCount > 0 ? 'completed' : 'failed';
    console.log(`[GET] #230 状态修正: ${result.status} → ${finalStatus} (completedCount=${completedCount}, failedCount=${failedCount}, totalCount=${totalCount})`);
  }

  return new Response(JSON.stringify({ 
    success: true, 
    taskId,
    completedCount,
    ...result,
    status: finalStatus,  // #230 使用修正后的状态，覆盖 result 中的 status
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
