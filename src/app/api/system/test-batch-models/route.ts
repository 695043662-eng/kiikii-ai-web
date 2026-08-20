import { NextRequest, NextResponse } from 'next/server';
import { getModelAPIConfigFull, buildRequest, getAllAvailableApiKeys } from '@/lib/api-config';
import { findModelInRegistry, SYSTEM_MODELS_REGISTRY } from '@/lib/model-registry';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAdmin } from '@/lib/admin-middleware';
import https from 'https';
import http from 'http';

/**
 * 零成本批量模型测试接口
 * 
 * 核心原理：利用参数报错进行 0 成本权限探测
 * - 鉴权拦截 = 死 🔴（密钥无效、分组无权限、渠道欠费）
 * - 业务参数报错 = 活 🟢（密钥有效，通道畅通，只是参数不合法）
 * 
 * 判断机制：
 * 🔴 不可用：HTTP 401/402/403，或报错含 unauthorized/invalid token/not found/insufficient quota 等
 * 🟢 畅通：报错含 invalid parameters/bad request/required/参数校验/at least one frame 等（触发0扣费业务拦截）
 */

// 高并发 Agent
const testHttpsAgent = new https.Agent({ maxSockets: 50, keepAlive: false, timeout: 15000 });
const testHttpAgent = new http.Agent({ maxSockets: 50, keepAlive: false, timeout: 15000 });

/**
 * 使用 Node.js 原生 https/http 发送测试请求（超时更短，避免长时间等待）
 */
function testNodeRequest(url: string, options: {
  method: string;
  headers: Record<string, string>;
  body: string;
}): Promise<{ status: number; statusText: string; body: string }> {
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
      timeout: 15000, // 测试请求15秒超时
      agent: isHttps ? testHttpsAgent : testHttpAgent,
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          statusText: res.statusMessage || '',
          body: data,
        });
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error(`测试请求超时 (15s)`)); });
    req.write(options.body);
    req.end();
  });
}

/**
 * 判断错误指纹：密钥无效 vs 通道畅通
 */
function classifyTestResult(
  httpStatus: number,
  responseBody: string,
): { status: 'success' | 'error'; message: string } {
  const bodyLower = responseBody.toLowerCase();

  // 🔴 判定为不可用/无权限/欠费/上游故障的关键词
  const deadKeywords = [
    'unauthorized',
    'invalid token',
    'invalid api key',
    'invalid_api_key',
    'authentication failed',
    'auth failed',
    'not found',
    'not_found',
    'insufficient quota',
    'insufficient_quota',
    '额度不足',
    '无效的令牌',
    '无效密钥',
    '密钥无效',
    '无可用渠道',
    'no available channel',
    'account suspended',
    'account_suspended',
    '账户已被封禁',
    'access denied',
    'access_denied',
    'forbidden',
    'permission denied',
    'billing hard limit',
    'billing_hard_limit',
    '已过期',
    'expired',
    '账号已过期',
    'credits exhausted',
    // #560 上游系统错误关键词（T8Star code:1001 system error 等）
    // 这些错误说明密钥有效但上游通道不可用，不应误判为"畅通"
    'system error',
    'system_error',
    'upstream error',
    'upstream_error',
    'service unavailable',
    'service_unavailable',
    'internal server error',
    'server error',
    '服务不可用',
    '上游错误',
    '上游异常',
  ];

  // 🟢 判定为通道畅通的关键词（触发0扣费业务拦截）
  const aliveKeywords = [
    'invalid parameters',
    'invalid_parameter',
    '参数校验',
    '参数错误',
    'bad request',
    'bad_request',
    'required',
    'is required',
    'at least one frame',
    'at_least_one_frame',
    'frame is required',
    'cannot be empty',
    'must be',
    'must provide',
    'missing',
    'invalid size',
    'invalid resolution',
    'invalid aspect',
    'invalid duration',
    'invalid model',
    'model not supported',
    'unsupported model',
    'value too large',
    'value too small',
    'out of range',
    'validation error',
    'validation_failed',
    'invalid_format',
    'format error',
  ];

  // 1. 先检查 HTTP 状态码
  if (httpStatus === 401 || httpStatus === 402 || httpStatus === 403) {
    // 鉴权级别的拦截 = 死
    let reason = `HTTP ${httpStatus}`;
    // 尝试从响应体提取更详细的错误信息
    try {
      const parsed = JSON.parse(responseBody);
      reason = parsed.error?.message || parsed.message || parsed.error || reason;
    } catch {
      // 尝试从 body 提取简短信息
      if (bodyLower.includes('unauthorized')) reason = '密钥无效 (401 Unauthorized)';
      else if (bodyLower.includes('forbidden')) reason = '无访问权限 (403 Forbidden)';
      else if (bodyLower.includes('quota')) reason = '额度不足 (402 Payment Required)';
    }
    return { status: 'error', message: `❌ ${reason}` };
  }

  // 2. 检查不可用关键词
  for (const keyword of deadKeywords) {
    if (bodyLower.includes(keyword)) {
      return { status: 'error', message: `❌ 密钥无效、分组无权限或渠道欠费 (${keyword})` };
    }
  }

  // 3. 检查通道畅通关键词（参数校验拦截 = 密钥有效，但不代表上游通道可用）
  // #560 修复：参数校验拦截只证明密钥有效，不能证明上游模型通道可用
  // T8Star 等服务商对参数校验错误可能返回 HTTP 500 而非 400
  for (const keyword of aliveKeywords) {
    if (bodyLower.includes(keyword)) {
      return { status: 'success', message: `✅ 密钥有效(参数拦截0扣费) ⚠️注意:仅验证密钥,未验证上游通道: ${keyword}` };
    }
  }

  // 4. HTTP 400 - 需要区分"参数校验拦截(畅通)" vs "上游通道错误(不可用)"
  // #560 关键修复：T8Star 返回 400 + upstream_error/system error 时，说明密钥有效但上游通道不可用
  if (httpStatus === 400) {
    let detail = '';
    let rawCode = '';
    try {
      const parsed = JSON.parse(responseBody);
      detail = (parsed.error?.message || parsed.message || parsed.error || '').toLowerCase();
      rawCode = (parsed.code || '').toLowerCase();
      // 检查 upstream_message 中的错误码
      if (parsed.upstream_message) {
        try {
          const upstream = JSON.parse(parsed.upstream_message);
          if (upstream.code) rawCode += ' ' + String(upstream.code);
          if (upstream.msg) detail += ' ' + upstream.msg.toLowerCase();
        } catch { /* ignore */ }
      }
    } catch {
      detail = responseBody.substring(0, 100).toLowerCase();
    }
    // 🔴 上游通道不可用的特征：code 包含 upstream_error / system_error，或 detail 包含 system error
    const upstreamDeadKeywords = ['upstream_error', 'system_error', 'system error', 'upstream error'];
    for (const kw of upstreamDeadKeywords) {
      if (rawCode.includes(kw) || detail.includes(kw)) {
        return { status: 'error', message: `❌ 上游通道不可用 (密钥有效但服务故障): ${detail.substring(0, 80)}` };
      }
    }
    // ✅ 参数校验拦截 = 密钥有效，但不代表上游通道可用
    return { status: 'success', message: `✅ 密钥有效(参数拦截0扣费) ⚠️注意:仅验证密钥,未验证上游通道 - ${detail.substring(0, 80)}` };
  }

  // 5. HTTP 500/502/503 服务端错误 - 但也可能是参数校验错误（T8Star 用 500 返回参数错误）
  // 尝试从响应体提取具体错误信息判断
  if (httpStatus >= 500) {
    let detail = '';
    let rawCode = '';
    try {
      const parsed = JSON.parse(responseBody);
      detail = (parsed.error?.message || parsed.message || parsed.error || '').toLowerCase();
      rawCode = (parsed.code || '').toLowerCase();
    } catch {
      detail = bodyLower.substring(0, 100);
    }
    // 🔴 #560 先检查上游通道不可用的特征
    const upstreamDeadKeywords = ['upstream_error', 'system_error', 'system error', 'upstream error'];
    for (const kw of upstreamDeadKeywords) {
      if (rawCode.includes(kw) || detail.includes(kw) || bodyLower.includes(kw)) {
        return { status: 'error', message: `❌ 上游通道不可用 (密钥有效但服务故障) - HTTP ${httpStatus}: ${detail.substring(0, 80)}` };
      }
    }
    // 检查是否包含参数校验类关键词（有些服务商 500 实际是参数错误）
    const paramErrorKeywords = ['invalid', 'required', 'empty', 'must be', 'parameter', 'param', 'field', 'format', 'size', 'resolution', 'aspect'];
    for (const kw of paramErrorKeywords) {
      if (detail.includes(kw)) {
        // ⚠️ #560 注意：参数校验拦截只说明密钥有效，不代表上游通道可用
        // 对视频模型特别标注：密钥有效 ≠ 上游通道可用
        return { status: 'success', message: `✅ 密钥有效(参数拦截0扣费) ⚠️注意:仅验证密钥,未验证上游通道 - HTTP ${httpStatus}: ${detail.substring(0, 60)}` };
      }
    }
    return { status: 'error', message: `❌ 上游服务异常 (HTTP ${httpStatus}) - ${detail.substring(0, 60)}` };
  }

  // 6. HTTP 200/201/202 也可能表示通道畅通（极少数情况下测试请求意外成功）
  if (httpStatus >= 200 && httpStatus < 300) {
    return { status: 'success', message: `✅ 通道畅通！请求意外成功(0扣费，测试prompt不会产生实际内容)` };
  }

  // 7. HTTP 429 限流 = 通道存在但暂时拥挤
  if (httpStatus === 429) {
    return { status: 'success', message: `⚠️ 通道存在但当前限流拥挤(429)，密钥有效` };
  }
  let detail = '';
  try {
    const parsed = JSON.parse(responseBody);
    detail = parsed.error?.message || parsed.message || '';
  } catch {
    detail = responseBody.substring(0, 80);
  }
  return { status: 'success', message: `✅ 通道可达 (HTTP ${httpStatus}) - ${detail.substring(0, 60)}` };
}

/**
 * 测试单个模型
 */
async function testSingleModel(
  modelId: string,
  customKey?: string,
  resolution?: string,
): Promise<{ modelId: string; status: 'success' | 'error' | 'timeout'; message: string; resolution?: string }> {
  try {
    // 1. 从注册表获取测试变量
    const registryItem = findModelInRegistry(modelId);
    
    // 2. 从数据库获取完整 API 配置
    const fullConfig = await getModelAPIConfigFull(modelId);
    if (!fullConfig) {
      return {
        modelId,
        status: 'error',
        message: '❌ 模型未在数据库中找到或已禁用',
        resolution,
      };
    }

    // 3. 确定测试用密钥
    let testKey = customKey;
    if (!testKey) {
      const availableKeys = getAllAvailableApiKeys(fullConfig.rawApiKeyString);
      if (availableKeys.length === 0) {
        return {
          modelId,
          status: 'error',
          message: '❌ 该模型无可用API密钥（请检查api_configs配置）',
          resolution,
        };
      }
      testKey = availableKeys[0];
    }

    // 4. 构建测试变量（使用注册表的 testVariables，补充必要字段）
    // ⚠️ 防扣费铁律：fallback 也必须用畸形参数，绝不能发合法值！
    const testVariables = registryItem?.testVariables || {
      _skipPixelMapping: true,
      prompt: '',
      aspectRatio: 'INVALID_RATIO_XXXXXX',
      size: '-999999x-999999',
      resolution: 'INVALID_RES',
      n: -1,
      duration: -99,
      urls: [],
      referenceImages: [],
      image: [],
      images: ['NOT_VALID_BASE64_!!!@#$%^&*()'],
    };

    // 如果指定了分辨率，添加到测试变量（用于区分不同分辨率的测试）
    if (resolution) {
      testVariables.testResolution = resolution;
    }

    // 添加必要字段
    testVariables.webhookBaseUrl = process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://kiikii.me';

    // 5. 构建请求
    const { headers, body } = buildRequest(fullConfig, testVariables, testKey);

    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    // 6. 发送测试请求
    console.log(`[TestCenter] 测试模型 ${modelId}${resolution ? ` (${resolution})` : ''}，密钥: ${testKey.substring(0, 10)}...`);
    
    const response = await testNodeRequest(fullConfig.apiEndpoint, {
      method: fullConfig.requestMethod || 'POST',
      headers,
      body: JSON.stringify(body),
    });

    // 7. 分类结果
    const result = classifyTestResult(response.status, response.body);
    
    console.log(`[TestCenter] 模型 ${modelId}${resolution ? ` (${resolution})` : ''} 测试完成: HTTP ${response.status} → ${result.status} | ${result.message.substring(0, 100)}`);
    
    return {
      modelId,
      resolution,
      ...result,
    };
  } catch (error: any) {
    console.error(`[TestCenter] 模型 ${modelId}${resolution ? ` (${resolution})` : ''} 测试异常:`, error.message);
    
    if (error.message?.includes('超时')) {
      return {
        modelId,
        resolution,
        status: 'timeout',
        message: `⏱️ 测试请求超时(15s)，上游可能不可达或网络异常`,
      };
    }
    
    return {
      modelId,
      resolution,
      status: 'error',
      message: `❌ 测试异常: ${error.message?.substring(0, 100) || '未知错误'}`,
    };
  }
}

/**
 * 获取所有可测试模型列表（从数据库动态获取，合并注册表信息）
 */
export async function GET() {
  try {
    const supabase = getSupabaseClient(undefined, true);
    
    // 获取所有活跃的模型
    const { data: models, error } = await supabase
      .from('api_models')
      .select('id, model_id, model_name, config_id, is_active, parameters')
      .eq('is_active', true)
      .order('sort_order');
    
    if (error) {
      throw error;
    }

    // 获取所有 API 配置
    const { data: configs } = await supabase
      .from('api_configs')
      .select('id, name, service_type, api_key')
      .eq('is_active', true);

    const configMap = new Map((configs || []).map(c => [c.id, c]));

    // 合并数据库模型 + 注册表信息
    const result = (models || []).map(model => {
      const config = configMap.get(model.config_id);
      const registryItem = findModelInRegistry(model.model_id);
      
      // 检测是否有可用密钥
      const rawApiKey = config?.api_key || '';
      const hasKey = rawApiKey.trim().length > 0;
      const keyCount = hasKey ? rawApiKey.split('\n').filter((l: string) => {
        const trimmed = l.trim();
        if (!trimmed) return false;
        const parts = trimmed.split('|');
        const status = parts.length > 1 ? parts[1].trim() : '1';
        return status === '' || status === '1';
      }).length : 0;

      return {
        id: model.model_id,
        dbId: model.id,
        name: model.model_name || registryItem?.name || model.model_id, // 优先使用数据库中的简洁名称
        provider: registryItem?.provider || config?.name?.split(' ')[0] || '未知',
        serviceType: registryItem?.serviceType || (config?.service_type as any) || 'image_generation',
        parameters: model.parameters || registryItem?.parameters || '', // 返回数据库中的 parameters（包含 resolutions）
        hasApiKey: hasKey && keyCount > 0,
        apiKeyCount: keyCount,
        configName: config?.name || '',
        inRegistry: !!registryItem,
      };
    });

    return NextResponse.json({
      success: true,
      models: result,
    });
  } catch (error: any) {
    console.error('[TestCenter] 获取模型列表失败:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}

/**
 * 批量测试模型连通性
 * 
 * 请求体: Array<{ modelId: string, customKey?: string, resolution?: string }>
 * 若未传 customKey，则后端自动从数据库中捞取该模型当前配置的默认生效 Key
 * resolution 用于区分不同分辨率的测试
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { tests } = body as { tests: Array<{ modelId: string; customKey?: string; resolution?: string }> };

    if (!Array.isArray(tests) || tests.length === 0) {
      return NextResponse.json({
        success: false,
        error: '请提供要测试的模型列表',
      }, { status: 400 });
    }

    // 限制最多同时测试 20 个模型（防止 2C2G 服务器过载）
    const limitedTests = tests.slice(0, 20);

    console.log(`[TestCenter] 开始批量测试 ${limitedTests.length} 个模型`);

    // 并发测试所有模型（限制并发数）
    const concurrencyLimit = 5;
    const results: Array<{ modelId: string; status: 'success' | 'error' | 'timeout'; message: string; resolution?: string }> = [];

    for (let i = 0; i < limitedTests.length; i += concurrencyLimit) {
      const batch = limitedTests.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(
        batch.map(test => testSingleModel(test.modelId, test.customKey, test.resolution))
      );
      results.push(...batchResults);
    }

    // 统计
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const timeoutCount = results.filter(r => r.status === 'timeout').length;

    console.log(`[TestCenter] 批量测试完成: 畅通=${successCount}, 断开=${errorCount}, 超时=${timeoutCount}`);

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: results.length,
        success: successCount,
        error: errorCount,
        timeout: timeoutCount,
      },
    });
  } catch (error: any) {
    console.error('[TestCenter] 批量测试失败:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
