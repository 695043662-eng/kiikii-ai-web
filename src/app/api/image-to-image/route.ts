import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import https from 'https';
import http from 'http';
import { downloadAndUploadToCOS, uploadBase64ImagesToCOS, preGenerateCosKeys, backgroundUploadImagesToCOS } from '@/lib/cos-upload';
import { translateErrorMessage } from '@/lib/error-handler';

// 设置 serverless 函数最长执行时间为 1900 秒（约31分钟），支持上游排队700秒+余量
export const maxDuration = 1900;

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
      timeout: options.timeout || 1800000,  // 默认 1800 秒（30分钟），支持上游排队700秒+余量
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
    // [ACTUAL_SEND] 发送到服务商的最终请求体
    console.log(`[ACTUAL_SEND] ${reqOptions.hostname}${reqOptions.path} body:`, options.body?.substring(0, 500));
    req.write(options.body);
    req.end();
  });
}

import { getTaskResult, setTaskResult, TaskResult } from '@/lib/taskResultsCache';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { storeReferenceImage } from '@/lib/reference-image-store';
import { getModelAPIConfigFull, buildRequest, shouldSwitchApiKey, isResolutionGloballyBanned, isResolutionBanned, isServiceProviderError, recordServiceProviderError, clearConsecutiveFailures } from '@/lib/api-config';
import { calculateCredits, deductCredits, refundCredits, handlePartialRefund, handleFullRefund, incrementFailedAttempts, resetFailedAttempts } from '@/lib/credits';
import { checkUserBanned, createBannedResponse } from '@/lib/ban-check';
import { checkUserRateLimit } from '@/lib/rateLimit';
import { saveTaskMapping } from '@/lib/taskMapping';
import { sseCircuitBreaker } from '@/lib/circuit-breaker';
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
      await uploadToCOS(cosKey, buffer, 'image/png', 'temp');  // #804 AI参考图→1号桶(临时)

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
): Promise<{ terminalTaskId: string; sseResult?: { imageUrls: string[], imageKeys: string[], providerUrls?: (string | null)[], failedItems?: { index: number; error: string }[] } }> {
  // 使用熔断器保护
  return sseCircuitBreaker.execute(async () => {
    try {
      return await sendToTerminalInternal(requestBody, model);
    } catch (error: any) {
      // ⚠️ #552 关键修复：保留 RESOLUTION_BANNED 错误的特殊属性
      if (error.errorCode === 'RESOLUTION_BANNED') {
        console.log(`[Terminal] 熔断错误，保留特殊属性:`, { errorCode: error.errorCode, resolution: error.resolution, message: error.message });
        throw error; // 直接抛出，不重新包装
      }

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
): Promise<{ terminalTaskId: string; sseResult?: { imageUrls: string[], imageKeys: string[], providerUrls?: (string | null)[], failedItems?: { index: number; error: string }[] } }> {
  // 从数据库读取完整配置（新架构）
  const fullConfig = await getModelAPIConfigFull(model);

  if (!fullConfig) {
    throw new Error(`模型 ${model} 未配置，请在数据库 api_configs + api_models 表中添加配置`);
  }

  // #550 密钥故障转移：获取所有可用密钥
  const availableKeys = fullConfig.apiKeys && fullConfig.apiKeys.length > 0 
    ? fullConfig.apiKeys 
    : (fullConfig.apiKey ? [fullConfig.apiKey] : []);
  
  if (availableKeys.length === 0) {
    throw new Error(`模型 ${model} 未配置 API Key`);
  }

  // 获取当前请求的分辨率，用于熔断检查
  // 使用原始分辨率字符串（如 1K/2K/4K），与前端显示一致
  const rawSize = requestBody.imageSize || requestBody.resolution || '';
  const currentResolution = rawSize.toUpperCase() || 'default';

  // ====== 细粒度熔断前置检查 ======
  // 检查该分辨率是否所有密钥都被熔断（全军覆没）
  if (isResolutionGloballyBanned(fullConfig.apiKey, currentResolution)) {
    const error: any = new Error(`该分辨率通道暂时繁忙，请稍后重试或选择其他分辨率。`);
    error.statusCode = 429;
    error.errorCode = 'RESOLUTION_BANNED';
    error.retryAfterMs = 30000;  // 30 秒通道冷却
    error.resolution = currentResolution;
    throw error;
  }

  console.log(`[Terminal] 可用密钥数量: ${availableKeys.length}，分辨率: ${currentResolution}，将按顺序尝试`);

  // 使用新架构的通用配置
  console.log('[Terminal] 使用新架构配置:', {
    model: fullConfig.modelId,
    endpoint: fullConfig.apiEndpoint,
    method: fullConfig.requestMethod,
    hasHeaders: Object.keys(fullConfig.requestHeaders).length > 0,
    hasBodyTemplate: Object.keys(fullConfig.requestBodyTemplate).length > 0,
  });

  const terminalModel = fullConfig.parameters?.terminalModel || requestBody.model;

  const variables = {
    prompt: requestBody.prompt,
    aspectRatio: requestBody.aspectRatio,
    resolution: rawSize,
    imageSize: rawSize,
    size: rawSize.replace(/×/g, 'x').replace(/\s*\(.*?\)/g, '').toLowerCase(),
    quality: requestBody.quality || 'auto',
    referenceImages: requestBody.urls,
    urls: requestBody.urls,
    image: requestBody.urls,
    images: requestBody.urls,
    model: terminalModel,
    originalModel: requestBody.model,
    webhookBaseUrl: process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.COZE_PROJECT_DOMAIN_DEFAULT || 'https://kiikii.me',
  };

  // #550 密钥故障转移循环：按顺序尝试每个密钥（含细粒度熔断）
  const errors: string[] = [];
  
  for (let keyIndex = 0; keyIndex < availableKeys.length; keyIndex++) {
    const currentKey = availableKeys[keyIndex];
    
    // 细粒度熔断：跳过该密钥+该分辨率已被熔断的组合
    if (isResolutionBanned(currentKey, currentResolution)) {
      console.log(`[CircuitBreaker] 跳过已熔断: ${currentKey.substring(0, 10)}..._${currentResolution}`);
      errors.push(`密钥${keyIndex + 1}: 该分辨率已被熔断`);
      continue;
    }
    
    console.log(`[Terminal] 尝试密钥 ${keyIndex + 1}/${availableKeys.length}: ${currentKey.substring(0, 10)}...`);

    // 使用当前密钥构建请求
    const { headers, body } = buildRequest(fullConfig, variables, currentKey);


    if (body?.aspectRatio === 'undefined' || body?.aspectRatio === undefined) {
      delete body.aspectRatio;
    }

    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }



    console.log('[Terminal] 发往服务商 body:', JSON.stringify(body).substring(0, 500));
    console.log('[Terminal] 🔍 quality 诊断: variables.quality=' + JSON.stringify(variables.quality) + ' body.quality=' + JSON.stringify(body?.quality));

    let response: { status: number; statusText: string; headers: Record<string, string>; body: string };
    try {
      response = await nodeRequest(fullConfig.apiEndpoint, {
        method: fullConfig.requestMethod,
        headers,
        body: JSON.stringify(body),
        timeout: 1800000,  // 30 分钟，支持上游排队700秒+余量
      });
    } catch (fetchError: any) {
      const errorMsg = fetchError.message || '网络错误';
      console.error(`[Terminal] 密钥 ${keyIndex + 1} 请求失败:`, errorMsg);
      errors.push(`密钥${keyIndex + 1}: ${errorMsg}`);
      
      // 服务商级别错误 → 累加连续失败计数（可能触发熔断）
      if (isServiceProviderError(fetchError)) {
        const didBan = recordServiceProviderError(currentKey, currentResolution, errorMsg);
        if (didBan && keyIndex < availableKeys.length - 1) {
          console.log(`[CircuitBreaker] 已触发熔断，尝试下一个密钥`);
          continue;
        }
        if (didBan && isResolutionGloballyBanned(fullConfig.apiKey, currentResolution)) {
          const banError: any = new Error(`该分辨率通道暂时繁忙，请稍后重试或选择其他分辨率。`);
          banError.statusCode = 429;
          banError.errorCode = 'RESOLUTION_BANNED';
          banError.retryAfterMs = 30000;  // 30 秒通道冷却
          banError.resolution = currentResolution;
          throw banError;
        }
        // 未触发熔断但服务商错误，也尝试下一个密钥
        if (keyIndex < availableKeys.length - 1) {
          console.log(`[CircuitBreaker] 服务商错误但未达熔断阈值，尝试下一个密钥`);
          continue;
        }
      } else if (shouldSwitchApiKey(fetchError) && keyIndex < availableKeys.length - 1) {
        console.log(`[Terminal] 错误类型支持切换密钥，尝试下一个密钥`);
        continue;
      }
      
      throw new Error(`API 请求失败: ${errorMsg}`);
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
      // 🔧 成功时清零连续失败计数（自愈逻辑）
      clearConsecutiveFailures(currentKey, currentResolution);
      return {
        terminalTaskId: `gemini-${Date.now()}`,
        sseResult
      };
    }

    // 走 SSE 流解析流程
    try {
      const result = await parseTerminalResponseFromText(responseText, '新架构', fullConfig.responseParser);
      
      if (result.sseResult) {
        console.log(`[Terminal] 密钥 ${keyIndex + 1} 成功，返回结果`);
        // 🔧 成功时清零连续失败计数（自愈逻辑）
        clearConsecutiveFailures(currentKey, currentResolution);
        return {
          terminalTaskId: result.terminalTaskId,
          sseResult: result.sseResult
        };
      }
      
      console.log(`[Terminal] 只返回任务 ID: ${result.terminalTaskId}，等待 webhook 回调`);
      return result;
    } catch (parseError: any) {
      const errorMsg = parseError.message || '解析失败';
      console.error(`[Terminal] 密钥 ${keyIndex + 1} 响应解析失败:`, errorMsg);
      errors.push(`密钥${keyIndex + 1}: ${errorMsg}`);
      
      // 服务商级别错误 → 累加连续失败计数（可能触发熔断）
      if (isServiceProviderError(parseError)) {
        const didBan = recordServiceProviderError(currentKey, currentResolution, errorMsg);
        if (didBan && keyIndex < availableKeys.length - 1) {
          console.log(`[CircuitBreaker] 已触发熔断，尝试下一个密钥`);
          continue;
        }
        if (didBan && isResolutionGloballyBanned(fullConfig.apiKey, currentResolution)) {
          const banError: any = new Error(`当前分辨率暂时不可用，请换一个分辨率或稍后重试`);
          banError.statusCode = 429;
          banError.errorCode = 'RESOLUTION_BANNED';
          banError.retryAfterMs = 21600000;  // 6 小时
          banError.resolution = currentResolution;
          throw banError;
        }
        // 未触发熔断但服务商错误，也尝试下一个密钥
        if (keyIndex < availableKeys.length - 1) {
          console.log(`[CircuitBreaker] 服务商错误但未达熔断阈值，尝试下一个密钥`);
          continue;
        }
      } else if (shouldSwitchApiKey(parseError) && keyIndex < availableKeys.length - 1) {
        console.log(`[Terminal] 错误类型支持切换密钥，尝试下一个密钥`);
        continue;
      }
      
      throw parseError;
    }
  }

  // 所有密钥都失败（可能全部被熔断）
  // 检查是否是全局熔断导致
  if (isResolutionGloballyBanned(fullConfig.apiKey, currentResolution)) {
    const error: any = new Error(`当前分辨率暂时不可用，请换一个分辨率或稍后重试`);
    error.statusCode = 429;
    error.errorCode = 'RESOLUTION_BANNED';
    error.retryAfterMs = 21600000;  // 6 小时
    error.resolution = currentResolution;
    throw error;
  }
  
  throw new Error(`所有密钥都失败: ${errors.join('; ')}`);
}

// 从文本解析终端响应
async function parseTerminalResponseFromText(responseText: string, source: string, responseParser?: { taskIdPath?: string; statusPath?: string; imageUrlPath?: string; errorPath?: string }): Promise<{ terminalTaskId: string; sseResult?: { imageUrls: string[], imageKeys: string[], providerUrls?: (string | null)[], failedItems?: { index: number; error: string }[] } }> {
  console.log(`[Terminal] ${source}响应: ${responseText.substring(0, 200)}${responseText.length > 200 ? '...' : ''}`);

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
  // 🔧 #458 性能优化：SSE 分支并行化重构
  if (data?.status === 'succeeded' && data?.results) {
    console.log('[Terminal] SSE 流返回成功结果，直接提取图片, results:', JSON.stringify(data.results));
    
    const itemErrors: { index: number; error: string }[] = [];  // 🔧 #451 收集单项错误
    const validUrls: string[] = [];  // 有效 URL 列表
    
    // 1. 先过滤出有效结果（违规检测保留）
    for (let i = 0; i < data.results.length; i++) {
      const result = data.results[i];
      
      // 🔧 #451 #475 修复：检测特殊标记（如 PROHIBITED_CONTENT）
      if (result.url && (result.url.includes('PROHIBITED_CONTENT') || result.url.includes('violation'))) {
        console.error(`[Terminal] #451 图片 ${i} 返回违规标记: ${result.url}`);
        console.log(`[积分返还监控] 🚫 检测到违规: index=${i}, url=${result.url}`);
        itemErrors.push({ index: i, error: '内容违规，请修改提示词后重试' });
        continue;
      }
      
      // 检测其他特殊标记（如 (TIMEOUT), (FAILED) 等）
      if (result.url && result.url.startsWith('(') && result.url.endsWith(')')) {
        const errorType = result.url.slice(1, -1);
        console.error(`[Terminal] #451 图片 ${i} 返回特殊标记: ${errorType}`);
        console.log(`[积分返还监控] ⚠️ 检测到特殊标记: index=${i}, errorType=${errorType}`);
        itemErrors.push({ index: i, error: `生成失败: ${errorType}` });
        continue;
      }
      
      // 检测 URL 是否有效（必须以 http 开头）
      if (result.url && result.url.startsWith('http')) {
        validUrls.push(result.url);
      } else if (result.url) {
        console.error(`[Terminal] #475 图片 ${i} URL 无效: ${result.url}`);
        itemErrors.push({ index: i, error: '生成失败：无效的图片地址' });
      }
    }
    
    // ====== #499 积分返还监控 - 违规汇总 ======
    if (itemErrors.length > 0) {
      const violationErrors = itemErrors.filter(e => 
        e.error === '内容违规，请修改提示词后重试' || e.error?.includes('违规')
      );
      console.log(`[积分返还监控] 📊 错误汇总: 总错误=${itemErrors.length}, 违规=${violationErrors.length}`);
    }
    
    // 2. #862 Fire-and-Forget 双链路：预生成 key + 后台静默上传
    let imageUrls: string[] = [];
    let imageKeys: string[] = [];
    let providerUrls: string[] = [];

    if (validUrls.length > 0) {
      imageKeys = preGenerateCosKeys(validUrls, 'sse');
      providerUrls = [...validUrls];
      // 立即返回 proxyUrl（不等待上传完成）
      imageUrls = imageKeys.map(key => `/api/canvas/image?key=${encodeURIComponent(key)}`);
      // #868 修复：同步等待 COS 上传完成，确保 imageKey 在返回前已生效
      await backgroundUploadImagesToCOS(validUrls, imageKeys, 'sse', 'temp');
      console.log(`[COS同步上传] sse 已完成上传 ${validUrls.length} 张图片`);
    }
    
    // 🔧 #451 修复：如果所有图片都是特殊标记（全部违规），返回失败
    if (imageUrls.length === 0 && itemErrors.length > 0) {
      const firstError = itemErrors[0].error;
      console.error(`[Terminal] #451 所有图片都被标记为失败:`, itemErrors);
      throw new Error(firstError);
    }
    
    // 🔧 #451 修复：部分图片失败时，记录日志
    if (itemErrors.length > 0) {
      console.warn(`[Terminal] #451 部分图片失败: ${itemErrors.length}/${data.results.length}`);
    }
    
    if (imageUrls.length > 0) {
      return { 
        terminalTaskId: data.id || `sse-${Date.now()}`,
        sseResult: { imageUrls, imageKeys, providerUrls }  // #525 混合架构
      };
    }
  }
  
  // #474 修复：检查 SSE 流是否失败或违规
  if (data?.status === 'failed') {
    const errorMsg = getErrorMessage(data);
    console.error('[Terminal] SSE 流返回失败:', errorMsg, '| failure_reason:', data.failure_reason);
    console.log(`[积分返还监控] 🚫 SSE流返回失败: ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  // #474 新增：检查违规状态
  if (data?.status === 'violation') {
    console.error('[Terminal] SSE 流返回违规:', data.failure_reason || '内容违规');
    console.log(`[积分返还监控] 🚫 SSE流返回违规: ${data.failure_reason || '内容违规'}`);
    throw new Error(data.failure_reason || '内容违规');
  }

  // #519 新增：检查 OpenAI 格式的 URL 响应（T8Star 等供应商）
  // OpenAI 图像 API 响应格式: { "data": [{ "url": "https://..." }] }
  // 🔧 修复：URL 格式也要上传 COS，确保刷新后能恢复图片（#523）
  if (data?.data && Array.isArray(data.data) && data.data.length > 0 && data.data[0]?.url) {
    console.log('[Terminal] 检测到 OpenAI URL 格式响应，下载并上传 COS');
    
    const rawUrls = data.data.map((item: any) => item.url).filter(Boolean);
    // #862 Fire-and-Forget: 预生成 key + 后台静默上传
    const imageKeys = preGenerateCosKeys(rawUrls, 'url');
    const providerUrls = [...rawUrls];
    const imageUrls = imageKeys.map((key: string) => `/api/canvas/image?key=${encodeURIComponent(key)}`);
    // #868 修复：同步等待 COS 上传完成，确保 imageKey 在返回前已生效
    await backgroundUploadImagesToCOS(rawUrls, imageKeys, 'url', 'temp');
    console.log(`[COS同步上传] url 已完成上传 ${rawUrls.length} 张图片`);
    
    console.log(`[Terminal] URL 格式处理完成: ${imageUrls.length} 张图片, ${imageKeys.filter((k: string) => k).length} 个有效 COS key`);
    
    if (imageUrls.length > 0) {
      return {
        terminalTaskId: `openai-${Date.now()}`,
        sseResult: { imageUrls, imageKeys, providerUrls }  // #525 混合架构
      };
    }
  }

  // #356 新增：检查 OpenAI 格式的 b64_json 响应（同步返回图片）
  // 🔧 #458 性能优化：Base64 分支并行化重构
  // OpenAI 图像 API 响应格式: { "data": [{ "b64_json": "..." }] }
  if (data?.data && Array.isArray(data.data) && data.data.length > 0 && data.data[0]?.b64_json) {
    console.log('[Terminal] 检测到 OpenAI b64_json 格式响应，直接提取图片');
    
    const b64Items = data.data.map((item: any) => item.b64_json).filter(Boolean);
    const uploadedImages = await uploadBase64ImagesToCOS(b64Items, 'b64');
    
    const imageUrls = uploadedImages.map(img => img.url);
    const imageKeys = uploadedImages.map(img => img.key);
    const providerUrls: string[] = [];  // #525 b64格式无服务商URL
    
    if (imageUrls.length > 0) {
      return {
        terminalTaskId: `openai-${Date.now()}`,
        sseResult: { imageUrls, imageKeys, providerUrls }  // #525 混合架构（b64无服务商URL）
      };
    }
  }

  // #474 #476 修复：同步极速模式之前，先检查失败和违规状态
  // GRS 新接口可能直接返回 status: 'failed' 或 'violation'，而不是 status: 'succeeded'
  if (data?.status === 'failed') {
    const errorMsg = data.failure_reason || data.error || '生成失败';
    console.error('[Terminal] 同步接口返回失败:', errorMsg);
    console.log(`[积分返还监控] 🚫 同步接口返回失败: ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  if (data?.status === 'violation') {
    console.error('[Terminal] 同步接口返回违规:', data.failure_reason || data.error || '内容违规');
    console.log(`[积分返还监控] 🚫 同步接口返回违规: ${data.failure_reason || data.error || '内容违规'}`);
    throw new Error(data.failure_reason || data.error || '内容违规');
  }
  
  // #476 新增：检查 running 状态，返回 taskId 继续等待
  if (data?.status === 'running' || data?.status === 'pending') {
    const taskId = data.id || data.task_id;
    console.log(`[Terminal] 同步接口返回 ${data.status}，任务 ID: ${taskId}，继续等待 webhook`);
    return { terminalTaskId: taskId };
  }

  // #445 新增：同步极速模式检测（/v1/api/generate 接口）
  // 对于极速模型，接口会直接返回图片 URL，无需等待 Webhook
  // 响应格式可能是：
  // - { "url": "https://..." }           // 单图
  // - { "images": ["https://..."] }      // 多图
  // - { "image_url": "https://..." }     // 单图（备选字段）
  // - { "status": "succeeded", "results": [{"url": "https://..."}] }  // 新接口格式
  const hasSyncResult = data?.url || data?.images || data?.image_url || 
                        (data?.status === 'succeeded' && Array.isArray(data?.results) && data.results.length > 0);
  
  if (hasSyncResult) {
    console.log('[Terminal] 🟢 检测到同步极速模式，直接提取图片 URL');
    
    let imageUrls: string[] = [];  // let 允许并行处理后重新赋值
    let imageKeys: string[] = [];
    let providerUrls: (string | null)[] = [];  // #525 混合架构：服务商原始URL
    const failedItems: { index: number; error: string }[] = [];  // #461 新增：收集失败项
    
    // 收集所有图片 URL
    if (data.url) imageUrls.push(data.url);
    if (data.image_url) imageUrls.push(data.image_url);
    if (Array.isArray(data.images)) {
      for (const img of data.images) {
        if (typeof img === 'string') imageUrls.push(img);
        else if (img?.url) imageUrls.push(img.url);
      }
    }
    // #447/#461/#475 重构：支持 results 数组格式，分离成功与失败项，检测违规标识
    if (Array.isArray(data.results)) {
      data.results.forEach((result: any, idx: number) => {
        const url = result?.url;
        
        // #475 检测违规标识：服务商可能返回 status=succeeded 但 url 包含违规标识
        if (url && (url.includes('(PROHIBITED_CONTENT)') || url.includes('PROHIBITED_CONTENT') || url.includes('violation'))) {
          failedItems.push({
            index: idx,
            error: '内容违规'
          });
          console.log(`[同步接口] 第 ${idx + 1} 张图片违规: ${url}`);
        } else if (url && url.startsWith('http')) {
          // 有效的图片 URL
          imageUrls.push(url);
        } else if (result?.error) {
          // 服务商返回了错误信息
          failedItems.push({
            index: idx,
            error: result.error
          });
          console.log(`[同步接口] 第 ${idx + 1} 张图片失败: ${result.error}`);
        } else {
          // 无有效 URL 也无错误信息
          failedItems.push({
            index: idx,
            error: '服务商未返回图片'
          });
          console.log(`[同步接口] 第 ${idx + 1} 张图片无返回`);
        }
      });
    }
    
    console.log(`[Terminal] 同步极速模式：提取到 ${imageUrls.length} 张图片`);
    
    // #862 Fire-and-Forget: 预生成 key + 后台静默上传
    if (imageUrls.length > 0) {
      const syncKeys = preGenerateCosKeys(imageUrls, 'sync');
      providerUrls = imageUrls.map(u => u); // 保留服务商原始URL
      imageKeys = syncKeys;
      imageUrls = syncKeys.map((key: string) => `/api/canvas/image?key=${encodeURIComponent(key)}`);
      // #868 修复：同步等待 COS 上传完成，确保 imageKey 在返回前已生效
      const syncProviderUrls = providerUrls.filter((u: string | null): u is string => !!u);
      await backgroundUploadImagesToCOS(syncProviderUrls, syncKeys, 'sync', 'temp');
      console.log(`[COS同步上传] sync 已完成上传 ${syncProviderUrls.length} 张图片`);
    }
    
    // #461 修复：只要有结果载荷（成功或失败）就返回，防止全失败时掉入异步等待
    if (imageUrls.length > 0 || failedItems.length > 0) {
      console.log(`[Terminal] 🟢 同步极速模式完成，成功 ${imageUrls.length} 张，失败 ${failedItems.length} 张`);
      return {
        terminalTaskId: data?.task_id || data?.id || `sync-${Date.now()}`,
        sseResult: { imageUrls, imageKeys, failedItems, providerUrls }  // #525 混合架构
      };
    }
  }

  // #357 新增：检测 Chat Completions 格式的生图响应（Markdown 图片链接）
  // Chat Completions 流式响应中，图片以 ![image](URL) 格式嵌入在 content 字段
  // 需要收集所有 SSE chunk 的 content，然后提取 Markdown 图片链接
  if (lastSseData?.choices?.[0]?.delta?.role || lastSseData?.choices?.[0]?.message?.role || lastSseData?.object === 'chat.completion.chunk' || lastSseData?.object === 'chat.completion') {
    console.log('[Terminal] 检测到 Chat Completions 格式响应，提取 Markdown 图片链接');
    
    // 收集所有 SSE chunk 中的 content
    let fullContent = '';
    const lines = responseText.split('\n');
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const jsonStr = line.replace(/^data:\s*/, '');
        if (jsonStr.trim() === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.message?.content || '';
          fullContent += content;
        } catch {}
      }
    }
    
    console.log(`[Terminal] Chat Completions 内容: ${fullContent.substring(0, 200)}${fullContent.length > 200 ? '...' : ''}`);
    
    // 从 Markdown 中提取图片链接: ![alt](url)
    const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let imageUrls: string[] = [];  // let 允许并行处理后重新赋值
    let imageKeys: string[] = [];
    let providerUrls: (string | null)[] = [];  // #525 混合架构：服务商原始URL
    
    // 1. 先快速收集所有 URL
    const tempImageUrls: string[] = [];
    let match;
    while ((match = markdownImageRegex.exec(fullContent)) !== null) {
      const url = match[2];
      if (url.startsWith('http')) tempImageUrls.push(url);
    }
    
    // 2. #862 Fire-and-Forget: 预生成 key + 后台静默上传
    if (tempImageUrls.length > 0) {
      const ccKeys = preGenerateCosKeys(tempImageUrls, 'cc');
      providerUrls = tempImageUrls.map(u => u);
      imageKeys = ccKeys;
      imageUrls = ccKeys.map((key: string) => `/api/canvas/image?key=${encodeURIComponent(key)}`);
      // #868 修复：同步等待 COS 上传完成，确保 imageKey 在返回前已生效
      const ccProviderUrls = providerUrls.filter((u: string | null): u is string => !!u);
      await backgroundUploadImagesToCOS(ccProviderUrls, ccKeys, 'cc', 'temp');
      console.log(`[COS同步上传] cc 已完成上传 ${ccProviderUrls.length} 张图片`);
    }
    
    if (imageUrls.length > 0) {
      console.log(`[Terminal] Chat Completions 提取到 ${imageUrls.length} 张图片`);
      return {
        terminalTaskId: lastSseData?.id || `chat-${Date.now()}`,
        sseResult: { imageUrls, imageKeys, providerUrls }  // #525 混合架构
      };
    }
    
    // 如果没有提取到图片，检查是否有错误信息
    if (fullContent.includes('failed') || fullContent.includes('error')) {
      console.error('[Terminal] Chat Completions 响应包含错误:', fullContent.substring(0, 500));
      throw new Error(`图片生成失败: ${fullContent.substring(0, 200)}`);
    }
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

async function handleGeminiResponse(data: any): Promise<{ imageUrls: string[], imageKeys: string[], providerUrls?: (string | null)[] }> {
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
        const uploadResult = await uploadToCOS(key, buffer, mimeType, 'temp');  // #804 AI生图→1号桶(临时)
        
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

// 解析错误信息
function getErrorMessage(data: any): string {
  if (data.failure_reason) {
    switch (data.failure_reason) {
      case 'output_moderation':
        return '内容违规';
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

  // #502 修复：安全获取积分余额的辅助函数（定义在try外，catch块也能访问）
  // 当 handlePartialRefund/handleFullRefund 返回 newBalance 为 null 时，
  // 不能用 creditsBalanceAfterDeduct（扣费后旧余额）作为兜底，
  // 必须查DB获取最新余额，否则前端显示的积分永远是"未返还"状态
  const safeGetCreditsBalance = async (
    refundNewBalance: number | null | undefined,
    userId: string,
    fallback: number | null
  ): Promise<number> => {
    if (refundNewBalance !== null && refundNewBalance !== undefined) {
      return refundNewBalance;
    }
    // newBalance 为 null，查DB获取最新余额
    console.log(`[积分返还监控] #502 newBalance为null，查DB获取最新余额，userId=${userId}`);
    try {
      const supabase = getSupabaseClient(undefined, true);
      const { data: qData, error: qError } = await supabase
        .from('users')
        .select('credits')
        .eq('id', userId)
        .limit(1);
      if (!qError && qData && qData.length > 0) {
        const actualBalance = qData[0].credits || 0;
        console.log(`[积分返还监控] #502 DB查询最新余额: ${actualBalance}`);
        return actualBalance;
      }
      if (qError) {
        console.error(`[积分返还监控] #502 DB查询余额失败:`, qError);
      }
    } catch (queryErr) {
      console.error(`[积分返还监控] #502 DB查询余额失败:`, queryErr);
    }
    // DB查询也失败，使用fallback（如果是null则返回0）
    const safeFallback = fallback ?? 0;
    console.warn(`[积分返还监控] #502 DB查询也失败，使用fallback: ${safeFallback}`);
    return safeFallback;
  };

  try {
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
      quality = 'auto', // 🔧 #522 T8Star GPT 品质参数（low/medium/high/auto）
    } = body;

    // 统一处理 modelId 和 model 参数
    const frontendModel = modelId || reqModel || 'nano-banana-fast';

    // 🔧 #680 Banana 模型合并：根据分辨率路由到真实 API 模型
    // 前端只展示 nano-banana-2-cl 和 nano-banana-pro-vip 两个入口
    // 后端根据分辨率自动路由到 4K 模型
    const mapToRealBananaModel = (model: string, resolution: string): string => {
      if (resolution === '4k' || resolution === '4K') {
        if (model === 'nano-banana-2-cl') return 'nano-banana-2-4k-cl';
        if (model === 'nano-banana-pro-vip') return 'nano-banana-pro-4k-vip';
      }
      return model;
    };
    const model = mapToRealBananaModel(frontendModel, resolution || '');

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
    // 🔥 #849 修复：使用 extractClientIp 防止 IP 欺骗绕过限流
    const { extractClientIp } = await import('@/lib/ip-rate-limit');
    const ip = extractClientIp(request);
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
      
      // 前置风控检查：鉴权通过后立即检查禁用状态
      // 在积分计算、SSE 流建立之前拦截，避免资源浪费
      const banResult = await checkUserBanned(actualUserId);
      if (banResult.isBanned) {
        console.log(`[前置风控] 用户 ${actualUserId} 被禁用，类型: ${banResult.banType}`);
        return createBannedResponse(banResult);
      }
    }

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
      imageSize: resolution,
      shutProgress: false, // 开启进度回调
      urls: [], // 默认空数组，避免 undefined
      quality: quality, // 🔧 #522 T8Star GPT 品质参数
    };
    
    // #508 修复：Banana 系列模型支持 'auto' 参数，直接传递给服务商
    // 其他模型如果有 'auto' 或 'undefined' 则不发送
    if (aspectRatio && aspectRatio !== 'undefined') {
      requestBody.aspectRatio = aspectRatio;
    }

    // 处理参考图
    if (images && images.length > 0) {
      if (isUrls) {
        // #810→#872 修复：前端发送的 URL 可能是代理 URL 或 CDN 域名 URL
        // 服务商无法访问代理 URL 或无签名 CDN URL，必须转换为真实的 COS 签名 URL
        const { getSignedUrl } = await import('@/lib/cos');
        // #872 获取 CDN 域名配置，用于检测 CDN 静态 URL
        const cdnDomainPerm = process.env.COS_CDN_DOMAIN_PERM || '';
        const cdnDomainTemp = process.env.COS_CDN_DOMAIN || '';
        const convertedUrls = await Promise.all(
          images.filter((url: string) => url && url.length > 0).map(async (url: string) => {
            // 检测1：代理 URL：/api/canvas/image?key=xxx[&assetType=xxx]
            const proxyMatch = url.match(/^\/api\/canvas\/image\?(?:.*&)?key=([^&]+)/);
            if (proxyMatch) {
              const objectKey = decodeURIComponent(proxyMatch[1]);
              // 检测 assetType 参数，dev/prod 前缀视为 perm 永久资产
              const assetTypeMatch = url.match(/[?&]assetType=(perm|temp)/);
              const inferredAssetType = (objectKey.startsWith('dev/') || objectKey.startsWith('prod/') || objectKey.startsWith('perm/')) ? 'perm' : 'temp';
              const assetType = assetTypeMatch ? assetTypeMatch[1] as 'perm' | 'temp' : inferredAssetType;
              try {
                // #872 forceSigned=true：AI 服务商必须用签名 URL，跳过 CDN 静态化
                const signedUrl = await getSignedUrl(objectKey, 3600, assetType, true);
                console.log(`[参考图] 代理URL→COS签名URL: ${objectKey} (assetType=${assetType})`);
                return signedUrl;
              } catch (err) {
                console.error(`[参考图] ❌ 签名URL生成失败: ${objectKey}`, err);
                return url; // 降级：返回原始URL
              }
            }
            // #872 检测2：CDN 域名 URL（如 https://assets.kiikii.me/prod/canvas/xxx.png）
            // 这些是无签名的 CDN 静态 URL，AI 服务商无法访问，必须转换为签名 URL
            try {
              const urlObj = new URL(url);
              if (urlObj.hostname === cdnDomainPerm || urlObj.hostname === cdnDomainTemp) {
                // 从 URL path 提取 COS key（去掉开头的 /）
                const objectKey = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
                if (objectKey) {
                  const inferredAssetType = (objectKey.startsWith('dev/') || objectKey.startsWith('prod/') || objectKey.startsWith('perm/')) ? 'perm' : 'temp';
                  // forceSigned=true：跳过 CDN 静态化，直接返回签名 URL
                  const signedUrl = await getSignedUrl(objectKey, 3600, inferredAssetType, true);
                  console.log(`[参考图] CDN URL→COS签名URL: ${objectKey} (host=${urlObj.hostname}, assetType=${inferredAssetType})`);
                  return signedUrl;
                }
              }
            } catch {
              // URL 解析失败（非标准 URL），忽略继续
            }
            // 非代理URL、非CDN URL（如外链URL）直接使用
            return url;
          })
        );
        requestBody.urls = convertedUrls;
        console.log(`[参考图] 使用URL方式, urls=`, requestBody.urls.map((u: string) => u?.substring(0, 80)));
      } else {
        // #509 防护：前端不应再发送 base64，如果收到则记录警告并转换
        console.warn(`[参考图] ⚠️ 收到 isUrls=false（可能是 base64），前端应该发送 URL！数量: ${images.length}`);
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
        creditsCharged: totalCredits,  // #288 新增：存储总扣费金额，用于超时返还计算
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
    
    // #P1 SSE 客户端断连防护：监听 abort 信号，防止向已关闭流写入
    // 🛡️ #848 客户端断连→标记任务为 client_disconnected，Cron 5分钟内自动退费
    const abortHandler = () => {
      console.log(`[SSE] 客户端断开连接: ${actualTaskId}，标记流关闭 + 任务状态 client_disconnected`);
      isControllerClosed = true;
      // 异步标记任务状态（不阻塞 abort 回调）
      getSupabaseClient(undefined, true)
        .from('video_generation_tasks')
        .update({ status: 'client_disconnected', updated_at: new Date().toISOString() })
        .eq('task_id', actualTaskId)
        .in('status', ['generating', 'processing', 'pending'])
        .then(({ error }: { error: any }) => {
          if (error) console.error('[SSE] 标记 client_disconnected 失败:', error);
          else console.log(`[SSE] 已标记 ${actualTaskId} 为 client_disconnected，等待 Cron 退费`);
        });
    };
    request.signal.addEventListener('abort', abortHandler, { once: true });
    
    const stream = new ReadableStream({
      start(controller) {
        // #7xx 流初始化死锁修复：移除 async，用自执行异步闭包包裹轮询逻辑
        // 让 start 函数瞬间返回，避免 Node.js 认为流初始化未完成而死锁 HTTP 响应头
        (async () => {
        // #SSE-BUFFER-FIX: sendEvent 必须是 async，await 让出事件循环逼 Node.js Flush！
        const sendEvent = async (data: any) => {
          if (isControllerClosed) return;
          try {
            const eventData = `data: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(eventData));
            // 暴力填缝 V3：32KB padding 强制冲破 Next.js 双层缓冲（TransformStream 16KB + ServerResponse 写缓冲）
            // 8KB 实测不够，所有事件仍被积压到流关闭才一次性投递
            controller.enqueue(encoder.encode(`: ${' '.repeat(32768)}\n\n`));
            // 🔥🔥🔥 #SSE-FLUSH-终极方案：双重 yield + 10ms 延迟，强制 Node.js Flush！
            // setTimeout(0) 不够！必须让 Node.js 进入 I/O polling 阶段才会真正 Flush TCP 缓冲区！
            await new Promise(r => setTimeout(r, 0));  // 第一次 yield
            await new Promise(r => setTimeout(r, 10)); // 第二次 yield + 10ms 延迟
            console.log(`[SSE] 发送事件: type=${data.type}`);
          } catch (e) {
            console.error('发送事件失败:', e);
            isControllerClosed = true;
          }
        };

        // 发送开始事件
        // #270 新增：携带扣费后的积分信息，让前端立即显示积分变化
        await sendEvent({ 
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
            .then(async (result) => {
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
                await sendEvent({ type: 'submitted', index, terminalTaskId: result.terminalTaskId });
              }

              // SSE 流返回了结果，直接处理
              // #461 重构：改为嵌套结构，防止 sseResult 存在但只有 failedItems 时掉入 webhook 分支
              if (result.sseResult) {
                // 1. 处理成功图片
                if (result.sseResult.imageUrls.length > 0) {
                  console.log(`[SSE] 第 ${index + 1} 张图片 SSE 完成，URL: ${result.sseResult.imageUrls[0]?.substring(0, 50)}...`);
                  
                  // 更新缓存
                  const currentResult = getTaskResult(actualTaskId);
                  if (currentResult) {
                    const existingItems = currentResult.imageItems || [];
                    existingItems[index] = {
                      index,
                      url: result.sseResult.imageUrls[0] || null,
                      key: result.sseResult.imageKeys[0] || null,
                      providerUrl: result.sseResult.providerUrls?.[0] || null,  // #525 混合架构：保存服务商URL
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
                    await sendEvent({ 
                      type: 'image', 
                      index,
                      url: result.sseResult.imageUrls[0],
                      imageKey: result.sseResult.imageKeys[0], // 添加 imageKey，防止刷新后丢失
                      providerUrl: result.sseResult.providerUrls?.[0] || null,  // #525 混合架构：服务商原始URL
                      taskId: actualTaskId 
                    });
                    sentImageIndices.add(index); // 记录已发送，防止轮询时重复发送
                  }
                  
                  imageUrls[index] = result.sseResult.imageUrls[0] || null;
                  imageKeys[index] = result.sseResult.imageKeys[0] || null;
                }
                
                // 2. #461 新增：处理失败项并立即推送事件
                if (result.sseResult.failedItems && result.sseResult.failedItems.length > 0) {
                  for (const failed of result.sseResult.failedItems) {
                    const currentResult = getTaskResult(actualTaskId);
                    if (currentResult) {
                      const existingItems = currentResult.imageItems || [];
                      existingItems[failed.index] = {
                        index: failed.index,
                        url: null,
                        key: null,
                        status: 'failed' as const,
                        error: failed.error,
                      };
                      setTaskResult(actualTaskId, { ...currentResult, imageItems: existingItems });
                      console.log(`[SSE] #461 同步失败项已更新缓存: index=${failed.index}, error=${failed.error}`);
                    }
                    
                    // 立即向前端发送明确的 item_failed 事件
                    if (!isControllerClosed) {
                      await sendEvent({ type: 'item_failed', index: failed.index, error: translateErrorMessage(failed.error) });
                      sentFailedIndices.add(failed.index);
                    }
                    
                    failedCount++;
                    errors.push({ index: failed.index, error: failed.error });
                  }
                }
              } else if (result.terminalTaskId) {
                // #260 修复：有 terminalTaskId 但没有 sseResult，说明任务已提交
                // 等待 webhook 回调更新缓存，前端轮询会检测到更新
                console.log(`[SSE] 第 ${index + 1} 张图片任务已提交: ${result.terminalTaskId}，等待 webhook 回调`);
                submittedCount++;
              } else {
                // 🔧 #207 诊断日志：终端返回成功但没有图片，也没有任务 ID
                const sseResultForDebug = result.sseResult as { imageUrls?: string[]; imageKeys?: string[] } | undefined;
                console.warn(`[SSE] ⚠️ 第 ${index + 1} 张图片终端返回成功但没有图片:`, {
                  terminalTaskId: result.terminalTaskId,
                  hasSseResult: !!result.sseResult,
                  imageUrlsLength: sseResultForDebug?.imageUrls?.length || 0,
                  imageKeysLength: sseResultForDebug?.imageKeys?.length || 0,
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
                  await sendEvent({ type: 'item_failed', index, error: translateErrorMessage('终端返回空结果') });
                  sentFailedIndices.add(index);
                }
              }

              console.log(`[SSE] 第 ${index + 1} 张图片任务已完成: ${result.terminalTaskId}`);
              submittedCount++;
            })
            .catch(async (error: any) => {
              console.error(`[SSE] 第 ${index + 1} 次提交失败:`, error.message);
              
              // ====== #551 细粒度熔断：识别熔断错误 ======
              if (error.errorCode === 'RESOLUTION_BANNED') {
                console.log(`[CircuitBreaker] SSE 流中触发全局熔断，分辨率: ${error.resolution}`);
                
                // 发送熔断错误事件给前端
                if (!isControllerClosed) {
                  await sendEvent({
                    type: 'error',
                    taskId: actualTaskId,
                    error: translateErrorMessage(error.message || '该分辨率通道当前拥挤'),
                    errorCode: 'RESOLUTION_BANNED',
                    resolution: error.resolution,
                    retryAfterMs: error.retryAfterMs || 21600000,
                    creditsBalance: creditsBalanceAfterDeduct,  // 携带积分余额
                  });
                }
                
                // 标记所有未完成的项为失败
                for (let i = 0; i < generationCount; i++) {
                  if (!sentImageIndices.has(i) && !sentFailedIndices.has(i)) {
                    const currentResult = getTaskResult(actualTaskId);
                    if (currentResult) {
                      const existingItems = currentResult.imageItems || [];
                      existingItems[i] = {
                        index: i,
                        url: null,
                        key: null,
                        status: 'failed' as const,
                        error: '分辨率通道熔断',
                      };
                      setTaskResult(actualTaskId, {
                        ...currentResult,
                        imageItems: existingItems,
                      });
                    }
                  }
                }
                
                failedCount = generationCount - sentImageIndices.size;
                return;  // 直接返回，不继续处理
              }
              
              errors.push({ index, error: error.message || '提交失败' });
              failedCount++;

              // 提交失败时，立刻推送 item_failed + 更新缓存
              if (!isControllerClosed) {
                await sendEvent({ type: 'item_failed', index, error: translateErrorMessage(error.message || '提交失败') });
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
        const maxWaitTime = 1800000;  // 30 分钟，支持上游排队700秒+余量
        const checkInterval = 2000;
        const forceCloseTimeout = 300000; // 👑 #420 修复：5 分钟无任何事件强制断开，适配 Flux/视频等慢终端
        let waited = 0;
        let lastEventTime = Date.now(); // 心跳计时器
        
        while (waited < maxWaitTime && !isControllerClosed) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            waited += checkInterval;

            // 🔧 2 分钟无任何事件强制断开，防止死连接占内存
            if (Date.now() - lastEventTime > forceCloseTimeout) {
              console.log(`[SSE] ⚠️ 5分钟无事件，强制断开: ${actualTaskId}`);
              await sendEvent({ type: 'timeout', taskId: actualTaskId, message: '连接超时，请稍后查询结果' });
              controller.close();
              isControllerClosed = true;
              break;
            }

            // 心跳保护：15秒内无业务事件，发送 ping 防止连接被掐
            if (Date.now() - lastEventTime > 15000 && !isControllerClosed) {
              try {
                await sendEvent({ type: 'ping' });
                // 注意：ping 不重置 lastEventTime，因为 ping 不代表业务进展
              } catch {
                // SSE 已关闭，退出循环
                break;
              }
            }
            
            // 检查是否所有图片都提交失败（异步填充的 errors 在轮询中被检测到）
            if (failedCount >= generationCount) {
              const errorMsg = errors.map(e => e.error).join('; ');
              
              // 从缓存获取 imageItems
              const failedResult = getTaskResult(actualTaskId);
              const failedImageItems = failedResult?.imageItems || errors.map((e, idx) => ({
                index: idx,
                status: 'failed' as const,
                error: e.error,
                url: null,
                key: null,
              }));
              
              // ====== #499 积分返还监控 - 所有图片提交失败 ======
              console.log(`[积分返还监控] ========== 场景: 所有图片提交失败 ==========`);
              console.log(`[积分返还监控] taskId: ${actualTaskId}`);
              console.log(`[积分返还监控] userId: ${actualUserId}`);
              console.log(`[积分返还监控] 失败图片数: ${failedImageItems.length}`);
              console.log(`[积分返还监控] failedImageItems: ${JSON.stringify(failedImageItems.map(i => ({ index: i.index, status: i.status, error: i.error })))}`);
              
              // ====== #282 统一积分返还 ======
              const refundResult = await handlePartialRefund(
                getTaskResult,
                setTaskResult,
                actualTaskId,
                failedImageItems,
                generationCount,
                creditsPerImage,
                actualUserId || '',
                `所有图片提交失败`
              );
              
              console.log(`[积分返还监控] 返还结果: success=${refundResult.success}, refundAmount=${refundResult.refundAmount}, newBalance=${refundResult.newBalance}`);
              
              // #502 修复：newBalance 为 null 时查DB获取最新余额，不用 creditsBalanceAfterDeduct 兜底
              const creditsBalanceAfter = await safeGetCreditsBalance(refundResult.newBalance, actualUserId || '', creditsBalanceAfterDeduct);
              
              if (!isControllerClosed) {
                await sendEvent({ 
                  type: 'error', 
                  taskId: actualTaskId,
                  error: translateErrorMessage(`所有图片提交失败: ${errorMsg}`),
                  creditsRefunded: refundResult.refundAmount,
                  creditsBalance: creditsBalanceAfter,
                });
              }
              console.log(`[SSE] 所有图片提交失败: ${actualTaskId}`);
              const currentResultForFailed = getTaskResult(actualTaskId);
              if (currentResultForFailed) {
                setTaskResult(actualTaskId, {
                  ...currentResultForFailed,
                  status: 'failed',
                  errors: errors,
                  creditsBalance: creditsBalanceAfter,  // #502 写入缓存，供GET轮询时返回
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
                    // #525 混合架构：同时下发服务商原始URL
                    await sendEvent({ type: 'image', index: item.index, url: item.url, imageKey: item.key, providerUrl: (item as any).providerUrl || null });
                    sentImageIndices.add(item.index);
                    hasNewEvent = true;
                    console.log(`[SSE] 发送新完成的图片: index=${item.index}, url=${item.url?.substring(0, 50)}`);
                  }
                } else if (item.status === 'failed' && !sentFailedIndices.has(item.index)) {
                  if (!isControllerClosed) {
                    await sendEvent({ type: 'item_failed', index: item.index, error: translateErrorMessage(item.error || '生成失败') });
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
              // #301 修复：即使状态已经是 failed，也要执行积分返还和违规计数
              if (allDone && currentResult.status !== 'completed') {
                const newStatus = completedCount > 0 ? 'completed' : 'failed';
                // 标记任务完成（如果状态还没更新）
                if (currentResult.status !== 'failed') {
                  setTaskResult(actualTaskId, {
                    ...currentResult,
                    status: newStatus,
                    completedAt: Date.now(),
                  });
                }
                console.log(`[SSE] 所有图片已完成: ${completedCount} 成功, ${failedCount} 失败, status=${newStatus}`);
                
                // 立即检查是否需要发送 complete 事件
                // #226: 同时更新 completedAt 用于前端判断
                
                // ====== #499 积分返还监控 - 部分图片失败 ======
                console.log(`[积分返还监控] ========== 场景: 部分图片失败退还 ==========`);
                console.log(`[积分返还监控] taskId: ${actualTaskId}`);
                console.log(`[积分返还监控] userId: ${actualUserId}`);
                console.log(`[积分返还监控] 成功图片数: ${completedCount}, 失败图片数: ${failedCount}`);
                console.log(`[积分返还监控] imageItems: ${JSON.stringify(imageItems.map(i => ({ index: i.index, status: i.status, error: i.error })))}`);
                
                // ====== #282 统一积分返还 ======
                const refundResult = await handlePartialRefund(
                  getTaskResult,
                  setTaskResult,
                  actualTaskId,
                  imageItems,
                  generationCount,
                  creditsPerImage,
                  actualUserId || '',
                  `部分图片失败退还`
                );
                
                console.log(`[积分返还监控] 返还结果: success=${refundResult.success}, refundAmount=${refundResult.refundAmount}, newBalance=${refundResult.newBalance}`);
                
                // #502 修复：newBalance 为 null 时查DB获取最新余额
                const finalCreditsBalance = await safeGetCreditsBalance(refundResult.newBalance, actualUserId || '', creditsBalanceAfterDeduct);
                const finalRefundAmount = refundResult.refundAmount;
                
                // ====== #301 违规计数：检查是否有违规失败 ======
                const violationCount = imageItems.filter(i => 
                  i.status === 'failed' && 
                  (i.error === '内容违规' || i.error === '输入内容违规' || 
                   i.error?.includes('moderation') || i.error?.includes('forbidden'))
                ).length;
                if (violationCount > 0 && actualUserId) {
                  console.log(`[SSE] #301 检测到 ${violationCount} 张违规失败，增加违规计数`);
                  const failedResult = await incrementFailedAttempts(actualUserId);
                  console.log(`[违规计数] #504 用户 ${actualUserId} 违规次数: ${failedResult.failedAttempts}, 剩余: ${failedResult.remainingAttempts}, warningLevel: ${failedResult.warningLevel}, isBanned: ${failedResult.isBanned}`);
                  
                  // #504 如果用户被禁用，发送 banned 事件
                  if (failedResult.isBanned && !isControllerClosed) {
                    await sendEvent({
                      type: 'banned',
                      isBanned: true,
                      bannedUntil: failedResult.bannedUntil || undefined,
                      failedAttempts: failedResult.failedAttempts,
                      message: '您的账号因连续异常操作已被锁定 6 小时，请稍后再试',
                    });
                    console.log(`[SSE] #504 发送 banned 事件, bannedUntil: ${failedResult.bannedUntil}`);
                  }
                  // 如果触发警告（第10次失败），发送 warning 事件让前端立即弹窗
                  else if (failedResult.warningLevel === 'warning' && !isControllerClosed) {
                    await sendEvent({
                      type: 'violation_warning',
                      failedAttempts: failedResult.failedAttempts,
                      remainingAttempts: failedResult.remainingAttempts,
                      message: `您已连续异常操作 10 次，再操作 10 次将锁定账号 6 小时`,
                    });
                    console.log(`[SSE] #508 发送 violation_warning 事件, failedAttempts: ${failedResult.failedAttempts}`);
                  }
                }
                
                // 收集所有成功图片
                const completedUrls = imageItems
                  .filter(i => i.status === 'completed' && i.url)
                  .map(i => i.url as string);
                const completedKeys = imageItems
                  .filter(i => i.status === 'completed' && i.key)
                  .map(i => i.key as string);
                const completedProviderUrls = imageItems
                  .filter(i => i.status === 'completed' && i.providerUrl)
                  .map(i => i.providerUrl as string);
                
                // #226 修复：发送 complete 事件
                if (!isControllerClosed) {
                  await sendEvent({
                    type: 'complete',
                    taskId: actualTaskId,
                    imageUrls: completedUrls,
                    imageKeys: completedKeys,
                    providerUrls: completedProviderUrls,  // #862 双链路: 服务商原始URL数组
                    imageItems: imageItems,  // #364 修复：添加 imageItems 供前端查找图片
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
                  creditsBalance: finalCreditsBalance,  // #502 写入缓存
                  completedAt: Date.now(),
                });
                
                break; // 完成后跳出循环
              }
              
              // 检查是否全部完成
              if (currentResult.status === 'completed' || currentResult.status === 'failed') {
                // 任务失败
                if (currentResult.status === 'failed') {
                  // #501 修复：优先从 imageItems 构建错误信息，避免违规信息被"任务失败"覆盖
                  const imageItemErrors = imageItems
                    .filter(i => i.status === 'failed' && i.error)
                    .map(i => i.error!);
                  const errorMsg = imageItemErrors.join('; ') 
                    || currentResult.errors?.map((e: { index: number; error: string }) => e.error).join('; ') 
                    || '任务失败';
                  
                  // ====== #282 统一积分返还 ======
                  const refundResult = await handlePartialRefund(
                    getTaskResult,
                    setTaskResult,
                    actualTaskId,
                    imageItems,
                    generationCount,
                    creditsPerImage,
                    actualUserId || '',
                    `任务全部失败`
                  );
                  const creditsBalanceAfter = await safeGetCreditsBalance(refundResult.newBalance, actualUserId || '', creditsBalanceAfterDeduct);
                  
                  // ====== #301 违规计数：检查是否有违规失败 ======
                  const violationCount = imageItems.filter(i => 
                    i.status === 'failed' && 
                    (i.error === '内容违规' || i.error === '输入内容违规' || 
                     i.error?.includes('moderation') || i.error?.includes('forbidden'))
                  ).length;
                  if (violationCount > 0 && actualUserId) {
                    console.log(`[SSE] #301 任务失败中检测到 ${violationCount} 张违规失败，增加违规计数`);
                    const failedResult = await incrementFailedAttempts(actualUserId);
                    console.log(`[违规计数] #504 用户 ${actualUserId} 违规次数: ${failedResult.failedAttempts}, 剩余: ${failedResult.remainingAttempts}, isBanned: ${failedResult.isBanned}`);
                    
                    // #504 如果用户被禁用，发送 banned 事件
                    if (failedResult.isBanned && !isControllerClosed) {
                      await sendEvent({
                        type: 'banned',
                        isBanned: true,
                        bannedUntil: failedResult.bannedUntil || undefined,
                        failedAttempts: failedResult.failedAttempts,
                        message: '您的账号因连续异常操作已被锁定 6 小时，请稍后再试',
                      });
                    }
                  }
                  
                  if (!isControllerClosed) {
                    await sendEvent({ 
                      type: 'error', 
                      taskId: actualTaskId,
                      error: translateErrorMessage(errorMsg),
                      creditsRefunded: refundResult.refundAmount,
                      creditsBalance: creditsBalanceAfter,
                    });
                  }
                  console.log(`[SSE] 任务失败: ${actualTaskId}, 错误: ${errorMsg}`);
                  // #502 修复：任务全部失败时也要更新缓存，包含 creditsBalance，供GET轮询返回
                  const failedCurrentResult = getTaskResult(actualTaskId);
                  if (failedCurrentResult) {
                    setTaskResult(actualTaskId, {
                      ...failedCurrentResult,
                      status: 'failed',
                      creditsBalance: creditsBalanceAfter,
                      completedAt: Date.now(),
                    });
                  }
                  break;
                }
                
                // #206 修复：从 imageItems 中提取图片 URL 和 key（在积分补偿之前计算）
                const completedImageItems = imageItems.filter(i => i.status === 'completed' && i.url);
                const completedImageUrls = completedImageItems.map(i => i.url!);
                const completedImageKeys = completedImageItems.map(i => i.key!).filter(k => k);
                console.log(`[SSE] 提取完成的图片: ${completedImageUrls.length} 个URL, ${completedImageKeys.length} 个key`);
                
                // ====== #499 积分返还监控 - SSE完成部分图片失败 ======
                console.log(`[积分返还监控] ========== 场景: SSE完成部分图片失败 ==========`);
                console.log(`[积分返还监控] taskId: ${actualTaskId}`);
                console.log(`[积分返还监控] userId: ${actualUserId}`);
                console.log(`[积分返还监控] 成功图片数: ${completedImageUrls.length}, 总图片数: ${generationCount}`);
                console.log(`[积分返还监控] imageItems: ${JSON.stringify(imageItems.map(i => ({ index: i.index, status: i.status, error: i.error })))}`);
                
                // ====== #282 统一积分返还 ======
                const refundResult = await handlePartialRefund(
                  getTaskResult,
                  setTaskResult,
                  actualTaskId,
                  imageItems,
                  generationCount,
                  creditsPerImage,
                  actualUserId || '',
                  `SSE完成：部分图片失败`
                );
                
                console.log(`[积分返还监控] 返还结果: success=${refundResult.success}, refundAmount=${refundResult.refundAmount}, newBalance=${refundResult.newBalance}`);
                
                // #502 修复：newBalance 为 null 时查DB获取最新余额
                const creditsBalanceAfter = await safeGetCreditsBalance(refundResult.newBalance, actualUserId || '', creditsBalanceAfterDeduct);
                
                // ====== 不再在此处保存生成记录 ======
                // #225 修复：移除后端保存逻辑，由前端统一保存（带 source 字段区分画布/生图）
                // 前端在 onComplete 回调中会保存记录，并传递 source: 'canvas' 或 'generate'
                
                // #226 修复：更新缓存中的任务状态为 completed，防止轮询无限循环
                setTaskResult(actualTaskId, {
                  ...currentResult,
                  status: 'completed',
                  imageItems: imageItems,
                  creditsBalance: creditsBalanceAfter,  // #502 写入缓存
                  completedAt: Date.now(),
                });
                console.log(`[SSE] 已更新任务状态为 completed: ${actualTaskId}`);
                
                // 任务完成，发送complete事件（含积分信息）
                if (!isControllerClosed) {
                  await sendEvent({ 
                    type: 'complete', 
                    taskId: actualTaskId,
                    imageUrls: completedImageUrls,
                    imageKeys: completedImageKeys,
                    imageItems: imageItems.map(item => ({
                      ...item,
                      imageKey: item.key,
                      providerUrl: (item as any).providerUrl || null,  // #525 混合架构
                    })),
                    errors: currentResult.errors,
                    count: completedImageUrls.length,
                    total: generationCount,
                    creditsCharged: totalCredits - refundResult.refundAmount,
                    creditsRefunded: refundResult.refundAmount,
                    creditsBalance: creditsBalanceAfter,
                  });
                }
                
                // ====== 成功生成，重置失败计数 ======
                if (actualUserId && completedImageUrls.length > 0) {
                  await resetFailedAttempts(actualUserId);
                }
                
                  console.log(`[SSE] 任务完成: ${actualTaskId}, ${completedImageUrls.length}/${generationCount} 张图片`);
                break;
              }
            }
            
            // 发送等待事件
            if (waited % 10000 === 0 && !isControllerClosed) {
              await sendEvent({ type: 'waiting', elapsed: waited });
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
              
              // ====== #282 统一积分返还 ======
              const refundResult = await handlePartialRefund(
                getTaskResult,
                setTaskResult,
                actualTaskId,
                updatedImageItems,
                generationCount,
                creditsPerImage,
                actualUserId || '',
                `超时：部分图片失败`
              );
              timeoutCreditsBalance = refundResult.newBalance ?? timeoutCreditsBalance;
              
              console.log(`[SSE] 超时，标记未完成图片为失败: ${actualTaskId}`);
            }
            
            // #472 修复：从缓存获取最新的 imageItems（可能已被超时处理更新）
            const latestResult = getTaskResult(actualTaskId);
            const timeoutImageItems = latestResult?.imageItems || [];
            
            await sendEvent({ 
              type: 'timeout', 
              taskId: actualTaskId,
              message: '请求超时，请稍后查询结果',
              terminalTaskIds: terminalTaskIds,
              creditsBalance: timeoutCreditsBalance,  // #276 修复：携带最新积分余额
              imageItems: timeoutImageItems,  // #472 修复：携带 imageItems 供前端处理失败项
            });
          }

        // 结束 SSE 流
        isControllerClosed = true;
        try {
          controller.close();
        } catch (e) {
          // 忽略
        }
        // #P1 清理 abort 监听器
        try { request.signal.removeEventListener('abort', abortHandler); } catch (e) { /* 忽略 */ }

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
        })();  // #7xx 自执行异步闭包结束，start 函数瞬间返回
      },
    }, { highWaterMark: 0 }); // #7xx 流缓冲根治：highWaterMark=0 阻止 ReadableStream 内部缓冲

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

    // ====== 细粒度熔断：RESOLUTION_BANNED 返回 429 ======
    if (error && (error as any).errorCode === 'RESOLUTION_BANNED') {
      console.log(`[CircuitBreaker] 全局熔断触发，分辨率: ${(error as any).resolution}`);
      
      // 积分返还（如果已扣费）
      let errorCreditsBalance = creditsBalanceAfterDeduct;
      if (actualTaskId && actualUserId && totalCredits) {
        const refundResult = await handleFullRefund(
          getTaskResult, setTaskResult, actualTaskId, totalCredits, actualUserId, '分辨率熔断'
        );
        errorCreditsBalance = await safeGetCreditsBalance(refundResult.newBalance, actualUserId, errorCreditsBalance);
      }

      return new Response(JSON.stringify({ 
        success: false,
        errorCode: 'RESOLUTION_BANNED',
        message: error instanceof Error ? error.message : '当前分辨率暂时不可用，请换一个分辨率或稍后重试',
        retryAfterMs: (error as any).retryAfterMs || 30000,
        resolution: (error as any).resolution,
        creditsBalance: errorCreditsBalance,
      }), {
        status: 429,
        headers: { 
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(((error as any).retryAfterMs || 600000) / 1000)),
        },
      });
    }

    // ====== #499 积分返还监控 - API内部错误 ======
    console.log(`[积分返还监控] ========== 场景: API内部错误 - 全额返还 ==========`);
    console.log(`[积分返还监控] taskId: ${actualTaskId}`);
    console.log(`[积分返还监控] userId: ${actualUserId}`);
    console.log(`[积分返还监控] totalCredits: ${totalCredits}`);
    console.log(`[积分返还监控] error: ${error instanceof Error ? error.message : '未知错误'}`);

    // ====== #282 统一全额积分返还 ======
    let errorCreditsBalance2 = creditsBalanceAfterDeduct;
    if (actualTaskId && actualUserId && totalCredits) {
      console.log(`[积分返还监控] 开始调用 handleFullRefund...`);
      const refundResult = await handleFullRefund(
        getTaskResult,
        setTaskResult,
        actualTaskId,
        totalCredits,
        actualUserId,
        'API 内部错误'
      );
      console.log(`[积分返还监控] 返还结果: success=${refundResult.success}, newBalance=${refundResult.newBalance}`);
      // #502 修复：newBalance 为 null 时查DB获取最新余额
      errorCreditsBalance2 = await safeGetCreditsBalance(refundResult.newBalance, actualUserId, errorCreditsBalance2);
    } else {
      console.log(`[积分返还监控] ⚠️ 跳过返还: actualTaskId=${actualTaskId}, actualUserId=${actualUserId}, totalCredits=${totalCredits}`);
    }

    return new Response(JSON.stringify({ 
      error: '服务器内部错误',
      // #P0 脱敏：details 字段已删除，不再向后端外部暴露 error.message
      creditsBalance: errorCreditsBalance2,  // #276 修复：携带最新积分余额
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
  
  // #284 新增：超时积分返还阈值（5 分钟）
  const REFUND_TIMEOUT_MS = 5 * 60 * 1000;
  
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
      // #525 混合架构：同时提取 providerUrls
      const actualProviderUrls = result.imageItems
        .filter((item: any) => item.status === 'completed' && item.url)
        .map((item: any) => item.providerUrl || '');
      result.providerUrls = actualProviderUrls;
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
      providerUrl?: string | null;  // #525 混合架构
    }) => ({
      ...item,
      imageKey: item.key,  // 添加 imageKey 字段
      providerUrl: item.providerUrl || null,  // #525 保留服务商URL
    }));
  }

  // #284/#288 超时积分返还机制（数学结算逻辑）
  // 当任务超过 5 分钟还是 generating 状态时，标记为失败并返还积分
  // #532 修复：移除 hasCompletedItems 阻断条件，改用纯数学结算
  // 原因：#530 的修复过度保护——只要有1张成功就阻止超时结算，导致部分失败的积分永远不退
  // 数学结算本身是安全的：应返还 = 预扣总额 - (成功数 × 单价)，成功全部完成时退还金额为0
  const shouldTriggerTimeout = result.status === 'generating' && 
                                Date.now() - result.createdAt > REFUND_TIMEOUT_MS;
  
  if (shouldTriggerTimeout) {
    console.log(`[GET] #532 任务 ${taskId} 超过 5 分钟未完成，触发数学结算返还`);
    
    const generationCount = result.requestParams?.generationCount || result.imageItems?.length || 4;
    const imageItems = result.imageItems || Array.from({ length: generationCount }, (_, idx) => ({
      index: idx,
      url: null,
      key: null,
      status: 'generating' as const,
      error: null,
    }));
    
    // #288 军师建议：使用数学结算逻辑
    // 1. 获取预扣金额（这是债务总额）
    const creditsCharged = result.requestParams?.creditsCharged || (generationCount * (result.requestParams?.creditsPerImage || 6));
    
    // 2. 统计真正"落袋为安"的成功数（必须是有图且状态为 completed）
    const successCount = imageItems.filter(item => 
      item.status === 'completed' && item.url && item.url.startsWith('http')
    ).length;
    
    // 3. 计算应返还金额（未完成的全部退回）
    const creditsPerImage = result.requestParams?.creditsPerImage || (creditsCharged / generationCount);
    const expectedRefund = creditsCharged - (successCount * creditsPerImage);
    
    // ====== #499 积分返还监控 - GET超时结算 ======
    console.log(`[积分返还监控] ========== 场景: GET超时结算 ==========`);
    console.log(`[积分返还监控] taskId: ${taskId}`);
    console.log(`[积分返还监控] userId: ${result.requestParams?.userId}`);
    console.log(`[积分返还监控] 预扣金额: ${creditsCharged}, 成功数: ${successCount}, 应返还: ${expectedRefund}`);
    console.log(`[积分返还监控] creditsRefunded: ${result.creditsRefunded}`);
    
    console.log(`[GET] #288 数学结算: 预扣=${creditsCharged}, 成功=${successCount}张, 应返还=${expectedRefund}`);
    
    // 4. 标记所有非 completed 的图片为 failed
    const updatedImageItems = imageItems.map(item => {
      if (item.status === 'completed' && item.url) {
        return item;  // 保持成功状态
      }
      return { ...item, status: 'failed' as const, error: '任务超时' };
    });
    
    const failedCount = updatedImageItems.filter(i => i.status === 'failed').length;
    
    // 5. 如果有欠账，调用返还
    const userId = result.requestParams?.userId;
    
    if (userId && expectedRefund > 0 && !result.creditsRefunded) {
      console.log(`[积分返还监控] 开始调用 handlePartialRefund...`);
      try {
        const refundResult = await handlePartialRefund(
          getTaskResult,
          setTaskResult,
          taskId,
          updatedImageItems,
          generationCount,
          creditsPerImage,
          userId,
          `GET超时结算：成功${successCount}张，退还${expectedRefund}分`
        );
        
        console.log(`[积分返还监控] 返还结果: success=${refundResult.success}, refundAmount=${refundResult.refundAmount}, newBalance=${refundResult.newBalance}`);
        
        if (refundResult.success) {
          console.log(`[GET] #288 超时返还成功: 退还 ${refundResult.refundAmount} 积分，剩余 ${refundResult.newBalance}`);
          // #499 修复：将返还后的最新余额写入 result，确保前端能获取到
          if (refundResult.newBalance !== null && refundResult.newBalance !== undefined) {
            result = { ...result, creditsBalance: refundResult.newBalance };
          }
        }
      } catch (err) {
        console.error(`[积分返还监控] 返还异常:`, err);
        console.error(`[GET] #288 超时返还失败:`, err);
      }
    } else {
      console.log(`[积分返还监控] ⚠️ 跳过返还: userId=${userId}, expectedRefund=${expectedRefund}, creditsRefunded=${result.creditsRefunded}`);
    }
    
    // 更新任务状态
    const hasSuccessfulImages = updatedImageItems.some(i => i.status === 'completed');
    setTaskResult(taskId, {
      ...result,
      status: hasSuccessfulImages ? 'completed' : 'failed',
      imageItems: updatedImageItems,
      completedAt: Date.now(),
    });
    
    // 更新 result 变量，以便后续使用
    result = {
      ...result,
      status: hasSuccessfulImages ? 'completed' : 'failed',
      imageItems: updatedImageItems,
      completedAt: Date.now(),
    };
    
    console.log(`[GET] #288 任务 ${taskId} 已标记为 ${result.status}，成功${successCount}张，失败${failedCount}张`);
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

  // #502 修复：对于失败/已完成的任务，如果 result 中没有 creditsBalance，
  // 从数据库查询用户当前余额，确保前端能获取到正确的积分（特别是SSE中断后走轮询的场景）
  if (finalStatus !== 'generating' && (result.creditsBalance === undefined || result.creditsBalance === null)) {
    const userId = result.requestParams?.userId;
    if (userId) {
      try {
        const supabase = getSupabaseClient(undefined, true);
        const { data: qData, error: qError } = await supabase
          .from('users')
          .select('credits')
          .eq('id', userId)
          .limit(1);
        if (!qError && qData && qData.length > 0) {
          result = { ...result, creditsBalance: qData[0].credits || 0 };
          console.log(`[GET] #502 从DB查询用户最新余额: ${result.creditsBalance}`);
        }
        if (qError) {
          console.error(`[GET] #502 查询用户余额失败:`, qError);
        }
      } catch (queryErr) {
        console.error(`[GET] #502 查询用户余额失败:`, queryErr);
      }
    }
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
