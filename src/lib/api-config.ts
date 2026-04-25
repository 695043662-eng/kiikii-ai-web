import { getSupabaseClient } from '@/storage/database/supabase-client';

// ====== 通用 API 配置类型 ======

// 模型配置内存缓存（消除并发时的数据库排队瓶颈）
// 缓存 Promise 而非结果：5个并发请求共享同一个 DB 查询 Promise，只触发1次查询
const configCache = new Map<string, { promise: Promise<ApiConfigFull | null>; timestamp: number }>();
const CONFIG_CACHE_TTL = 60 * 1000; // 缓存1分钟

export interface ApiConfigFull {
  // 接口配置
  configId: number;
  configName: string;
  serviceType: string;
  
  // API 配置
  apiEndpoint: string;           // 最终端点（优先模型自定义 > 接口默认）
  requestMethod: 'POST' | 'GET' | 'PUT';
  requestHeaders: Record<string, string>;   // 请求头模板
  requestBodyTemplate: Record<string, any>; // 请求体模板
  apiKey: string;
  
  // 模型配置
  modelId: string;
  modelName: string;
  modelApiEndpoint: string | null;  // 模型自定义端点
  parameters: Record<string, any>;
  creditsBase: number;
  
  // 响应解析配置
  responseParser?: {
    taskIdPath?: string;         // 从响应中提取任务ID的路径
    statusPath?: string;         // 状态路径
    imageUrlPath?: string;       // 图片URL路径
    errorPath?: string;          // 错误信息路径
  };
}

// 旧版兼容类型
export interface ImageAPIConfig {
  apiEndpoint: string;
  apiKey: string;
  modelName?: string;
}

/**
 * 根据模型 ID 获取完整的 API 配置（通用架构）
 * 从 api_configs 和 api_models 表读取配置
 */
export async function getModelAPIConfigFull(modelId: string): Promise<ApiConfigFull | null> {
  // 1. 先查缓存 Promise（微秒级，并发请求共享同一个 Promise）
  const cached = configCache.get(modelId);
  if (cached && (Date.now() - cached.timestamp) < CONFIG_CACHE_TTL) {
    return cached.promise; // 直接返回同一个 Promise，5个请求只触发1次DB查询
  }

  // 2. 创建查询 Promise 并缓存（后续并发请求会命中缓存，共享这个 Promise）
  const queryPromise = (async () => {
    try {
      // 🔧 修复：使用 Service Role 客户端绕过 RLS 策略
      const supabase = getSupabaseClient(undefined, true);
      
      // 从 api_models 表查找模型
      const { data: model, error: modelError } = await supabase
        .from('api_models')
        .select(`
          id,
          model_id,
          model_name,
          description,
          api_endpoint,
          parameters,
          credits_base,
          config_id,
          is_active
        `)
        .eq('model_id', modelId)
        .eq('is_active', true)
        .single();
      
      if (modelError || !model) {
        console.log(`[API Config] 未找到模型 ${modelId}`);
        return null;
      }
      
      // 从 api_configs 表查找接口配置
      const { data: config, error: configError } = await supabase
        .from('api_configs')
        .select('*')
        .eq('id', model.config_id)
        .eq('is_active', true)
        .single();
      
      if (configError || !config) {
        console.log(`[API Config] 未找到接口配置 config_id=${model.config_id}`);
        return null;
      }
      
      // 构建完整配置
      let finalApiEndpoint = model.api_endpoint || config.api_endpoint;

      // 处理相对路径
      if (finalApiEndpoint && finalApiEndpoint.startsWith('/')) {
        const isGemini = model.model_id.includes('gemini') || model.api_endpoint?.includes('gemini');
        if (isGemini) {
          finalApiEndpoint = `${config.api_endpoint}${finalApiEndpoint}`;
          console.log(`[API Config] 检测到 Gemini 相对路径，自动拼接完整 URL: ${finalApiEndpoint}`);
        } else {
          console.warn(`[API Config] 检测到相对路径但不是 Gemini: ${finalApiEndpoint}`);
        }
      }

      // 🔍 诊断日志：检查 request_body_template 的实际值
      console.log('[API Config] 诊断 request_body_template:', {
        type: typeof config.request_body_template,
        isArray: Array.isArray(config.request_body_template),
        keys: config.request_body_template ? Object.keys(config.request_body_template) : [],
        raw: JSON.stringify(config.request_body_template).substring(0, 500),
      });

      const result: ApiConfigFull = {
        configId: config.id,
        configName: config.name,
        serviceType: config.service_type,

        apiEndpoint: finalApiEndpoint,
        requestMethod: config.request_method || 'POST',
        requestHeaders: config.request_headers || {},
        requestBodyTemplate: config.request_body_template || {},
        apiKey: config.api_key || '',

        modelId: model.model_id,
        modelName: model.model_name,
      modelApiEndpoint: model.api_endpoint,
      parameters: model.parameters || {},
      creditsBase: model.credits_base || 10,

      responseParser: config.response_parser || undefined,
    };

    console.log(`[API Config] 模型 ${modelId} 配置已加载并缓存`);
    return result;
    
  } catch (error) {
    console.error(`[API Config] 获取模型 ${modelId} 配置失败:`, error);
    // 出错时移除缓存，下次重试还能查数据库
    configCache.delete(modelId);
    return null;
  }
  })();

  // 缓存 Promise（所有并发请求共享这个 Promise）
  configCache.set(modelId, { promise: queryPromise, timestamp: Date.now() });
  return queryPromise;
}

/**
 * 模板变量替换函数
 * 支持字符串中的 ${变量名} 占位符
 * 特殊处理：当整个字符串就是一个占位符且变量是数组/对象时，直接返回原值（保持类型）
 */
export function replaceTemplateVariables(
  template: string,
  variables: Record<string, any>
): any {  // 返回类型改为 any，因为可能返回数组/对象
  // 检查是否整个字符串就是一个占位符 ${xxx}
  const exactMatch = template.match(/^\$\{(\w+)\}$/);
  if (exactMatch) {
    const varName = exactMatch[1];
    if (varName in variables) {
      const value = variables[varName];
      // 如果是数组或对象，直接返回原值（保持类型）
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        return value;
      }
      return String(value);
    }
    return template; // 保留未匹配的占位符
  }

  // 非完全匹配的情况，进行字符串内替换
  return template.replace(/\$\{(\w+)\}/g, (match, varName) => {
    if (varName in variables) {
      const value = variables[varName];
      // 如果是数组，保持 JSON 格式
      if (Array.isArray(value)) {
        return JSON.stringify(value);
      }
      // 如果是对象，保持 JSON 格式
      if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value);
      }
      return String(value);
    }
    return match; // 保留未匹配的占位符
  });
}

/**
 * 深度替换对象中的所有模板变量
 * 支持嵌套对象和数组
 */
export function deepReplaceVariables(
  obj: any,
  variables: Record<string, any>
): any {
  if (typeof obj === 'string') {
    return replaceTemplateVariables(obj, variables);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deepReplaceVariables(item, variables));
  }
  
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepReplaceVariables(value, variables);
    }
    return result;
  }
  
  return obj;
}

/**
 * 构建实际请求
 * 根据配置模板和变量生成最终的请求头和请求体
 */
export function buildRequest(
  config: ApiConfigFull,
  variables: Record<string, any>
): {
  headers: Record<string, string>;
  body: Record<string, any>;
} {
  // 🔧 #296 修复：使用 terminalModel 映射终端 API 支持的模型名
  // 如果 parameters 中有 terminalModel，优先使用它作为发送给终端的模型名
  const terminalModel = config.parameters?.terminalModel || config.modelId;
  
  // 添加 apiKey 到变量
  const allVariables = {
    ...variables,
    apiKey: config.apiKey,
    model: terminalModel,  // 使用映射后的模型名
  };

  // 深度替换请求头中的变量
  let headers = deepReplaceVariables(config.requestHeaders, allVariables) as Record<string, string>;

  // 检测是否是 Gemini 服务商
  const isGemini = config.apiEndpoint.includes('gemini') ||
                    config.apiEndpoint.includes('google') ||
                    config.modelId.includes('gemini');

  // 如果是 Gemini 且使用官方 Google API（googleapis.com），自动使用正确的请求头格式
  if (isGemini && config.apiEndpoint.includes('googleapis.com')) {
    console.log('[buildRequest] 检测到 Gemini 官方 API，自动使用 x-goog-api-key 请求头');
    // 删除 Authorization header（如果存在）
    delete headers['Authorization'];
    // 添加 x-goog-api-key header
    headers['x-goog-api-key'] = config.apiKey;
  } else if (isGemini && !config.apiEndpoint.includes('googleapis.com')) {
    console.log('[buildRequest] 检测到 Gemini 代理服务，使用默认请求头格式');
  }

  // 处理请求体
  let body: any;
  
  if (isGemini && variables.urls && variables.urls.length > 0) {
    // Gemini 有参考图时，特殊处理
    console.log('[buildRequest] 检测到 Gemini 参考图，动态构建 parts 数组');
    
    // 构建 parts 数组
    const parts: any[] = [];
    
    // 添加图片（使用 inlineData 支持 base64 和 HTTP URL）
    for (const url of variables.urls) {
      if (url.startsWith('data:')) {
        // base64 data URL 格式: data:image/png;base64,xxx
        const matches = url.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          parts.push({
            inlineData: {
              mimeType: matches[1],
              data: matches[2]
            }
          });
        }
      } else {
        // HTTP URL - 需要下载并转成 base64（异步处理在调用方完成）
        // 这里暂时跳过，让 GRS AI 处理
        console.warn('[buildRequest] Gemini 不支持 HTTP URL 参考图，需要先转成 base64:', url.substring(0, 50));
      }
    }
    
    // 添加文本提示
    parts.push({
      text: variables.prompt
    });
    
    // 构建完整的 Gemini 请求体
    body = {
      contents: [{
        role: 'user',
        parts: parts
      }],
      generationConfig: {
        temperature: 1,
        maxOutputTokens: 32768,
        responseModalities: ['TEXT', 'IMAGE'],
        topP: 0.95,
        imageConfig: {
          aspectRatio: variables.aspectRatio,
          imageSize: variables.imageSize || variables.resolution,
          imageOutputOptions: {
            mimeType: 'image/png'
          },
          personGeneration: 'ALLOW_ALL'
        }
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' }
      ]
    };
  } else {
    // 默认处理（GRS AI 或 Gemini 无参考图）
    body = deepReplaceVariables(config.requestBodyTemplate, allVariables);
    
    // 🔧 诊断日志：打印模板和替换结果
    console.log('[buildRequest] 模板:', JSON.stringify(config.requestBodyTemplate, null, 2));
    console.log('[buildRequest] 变量:', JSON.stringify(allVariables, null, 2));
    console.log('[buildRequest] 替换后:', JSON.stringify(body, null, 2));
  }

  // 特殊处理：确保 urls 字段始终是数组（修复 JSON unmarshal 错误）
  if ('urls' in body && !Array.isArray(body.urls)) {
    console.log('[buildRequest] 修复 urls 字段类型:', { type: typeof body.urls, value: body.urls });
    body.urls = Array.isArray(variables.urls) ? variables.urls : Array.isArray(variables.referenceImages) ? variables.referenceImages : [];
  }

  // 确保 Content-Type 存在
  if (!headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // 详细日志：输出最终请求体
  console.log('[buildRequest] 最终请求体:', JSON.stringify(body, null, 2));
  console.log('[buildRequest] urls 字段:', body.urls, '类型:', typeof body.urls, 'isArray:', Array.isArray(body.urls));

  return { headers, body };
}

// ====== 旧版兼容函数（保持向后兼容）======

// 🔧 优先级：数据库配置 > 环境变量
// 根据模型名称获取API配置（从数据库 api_keys 表读取）
export async function getModelAPIConfig(modelId: string): Promise<ImageAPIConfig> {
  // 环境变量作为回退（fallback）
  const envEndpoint = process.env.GRS_API_ENDPOINT || process.env.NEXT_PUBLIC_API_ENDPOINT;
  const envApiKey = process.env.GRS_API_KEY || process.env.NEXT_PUBLIC_DEFAULT_API_KEY;
  
  // 1️⃣ 优先尝试新架构（api_models + api_configs 表）
  const fullConfig = await getModelAPIConfigFull(modelId);
  if (fullConfig) {
    console.log(`[API Config] 从数据库(api_models)获取配置成功: ${modelId}`);
    return {
      apiEndpoint: fullConfig.apiEndpoint,
      apiKey: fullConfig.apiKey,
      modelName: fullConfig.modelName,
    };
  }
  
  // 2️⃣ 回退到旧架构（api_keys 表）
  try {
    const supabase = getSupabaseClient();
    
    const { data, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('type', modelId)
      .eq('status', 'active')
      .single();
    
    if (!error && data) {
      console.log(`[API Config] 从数据库(api_keys)获取配置成功: ${modelId}`);
      
      try {
        const config = JSON.parse(data.key);
        if (config.apiEndpoint && config.apiKey) {
          return {
            apiEndpoint: config.apiEndpoint,
            apiKey: config.apiKey,
            modelName: config.modelName || modelId,
          };
        }
      } catch {
        // 不是 JSON 格式，使用纯 API Key
      }
      
      // 数据库有记录，使用数据库配置
      return {
        apiEndpoint: envEndpoint ? `${envEndpoint}/v1/draw/nano-banana` : '',
        apiKey: data.key,
        modelName: modelId,
      };
    }
  } catch (error) {
    console.error(`[API Config] 数据库查询失败:`, error);
  }
  
  // 3️⃣ 最后回退到环境变量
  console.log(`[API Config] 数据库无配置，使用环境变量回退: ${modelId}`);
  return getDefaultImageAPIConfig(modelId);
}

// 🔧 优先级：数据库配置 > 环境变量
// 获取图片生成API配置（从数据库 api_keys 表读取）
export async function getImageAPIConfig(): Promise<ImageAPIConfig> {
  // 环境变量作为回退（fallback）
  const envEndpoint = process.env.GRS_API_ENDPOINT || process.env.NEXT_PUBLIC_API_ENDPOINT;
  const envApiKey = process.env.GRS_API_KEY || process.env.NEXT_PUBLIC_DEFAULT_API_KEY;
  
  // 1️⃣ 优先从数据库读取
  try {
    const supabase = getSupabaseClient();
    
    const { data, error } = await (supabase as any)
      .from('api_keys')
      .or('type.eq.image,type.eq.图片生成,type.eq.image_generation')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (!error && data) {
      console.log('[API Config] 从数据库获取图片生成配置成功:', { name: data.name, type: data.type });
      
      try {
        const config = JSON.parse(data.key);
        if (config.apiEndpoint && config.apiKey) {
          return {
            apiEndpoint: config.apiEndpoint,
            apiKey: config.apiKey,
            modelName: config.modelName || undefined,
          };
        }
      } catch {
        console.log('[API Config] 使用旧格式（纯 API Key）');
      }
      
      // 数据库有记录，使用数据库配置
      return {
        apiEndpoint: envEndpoint ? `${envEndpoint}/v1/draw/nano-banana` : '',
        apiKey: data.key,
        modelName: data.name || undefined,
      };
    }
  } catch (error) {
    console.error('[API Config] 数据库查询失败:', error);
  }
  
  // 2️⃣ 回退到环境变量
  console.log('[API Config] 数据库无配置，使用环境变量回退');
  return getDefaultImageAPIConfig('nano-banana-fast');
}

// 🔧 优先级：数据库配置 > 环境变量
// 获取视频生成API配置（从数据库 api_keys 表读取）
export async function getVideoAPIConfig(): Promise<ImageAPIConfig> {
  // 环境变量作为回退（fallback）
  const envEndpoint = process.env.GRS_API_ENDPOINT || process.env.NEXT_PUBLIC_API_ENDPOINT;
  const envApiKey = process.env.GRS_API_KEY || process.env.NEXT_PUBLIC_DEFAULT_API_KEY;
  
  // 1️⃣ 优先从数据库读取
  try {
    const supabase = getSupabaseClient();
    
    const { data, error } = await (supabase as any)
      .from('api_keys')
      .or('type.eq.video,type.eq.视频生成,type.eq.video_generation,type.eq.grs-sora-2')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (!error && data) {
      console.log('[API Config] 从数据库获取视频生成配置成功:', { name: data.name, type: data.type });
      
      try {
        const config = JSON.parse(data.key);
        if (config.apiEndpoint && config.apiKey) {
          return {
            apiEndpoint: config.apiEndpoint,
            apiKey: config.apiKey,
            modelName: config.modelName || undefined,
          };
        }
      } catch {
        // 不是 JSON 格式
      }
      
      // 数据库有记录，使用数据库配置
      return {
        apiEndpoint: envEndpoint ? `${envEndpoint}/v1/video/generate` : '',
        apiKey: data.key,
        modelName: data.name || undefined,
      };
    }
  } catch (error) {
    console.error('[API Config] 数据库查询失败:', error);
  }
  
  // 2️⃣ 回退到环境变量
  console.log('[API Config] 数据库无配置，使用环境变量回退');
  return getDefaultVideoAPIConfig();
}

// 🔧 默认配置：仅从环境变量读取（作为数据库配置的回退）
// 当数据库中没有任何配置时，才会使用此默认配置
function getDefaultImageAPIConfig(modelId?: string): ImageAPIConfig {
  const envEndpoint = process.env.GRS_API_ENDPOINT || process.env.NEXT_PUBLIC_API_ENDPOINT;
  const envApiKey = process.env.GRS_API_KEY || process.env.NEXT_PUBLIC_DEFAULT_API_KEY;
  
  if (!envEndpoint || !envApiKey) {
    console.warn('[API Config] ⚠️ 数据库无配置且环境变量未设置，生图功能将不可用');
  }
  
  console.log('[API Config] 使用环境变量默认配置:', {
    endpoint: envEndpoint ? `${envEndpoint}/v1/draw/nano-banana` : '未配置',
    hasApiKey: !!envApiKey,
  });
  
  return {
    apiEndpoint: envEndpoint ? `${envEndpoint}/v1/draw/nano-banana` : '',
    apiKey: envApiKey || '',
    modelName: modelId || 'nano-banana-fast',
  };
}

// 🔧 默认配置：仅从环境变量读取（作为数据库配置的回退）
function getDefaultVideoAPIConfig(): ImageAPIConfig {
  const envEndpoint = process.env.GRS_API_ENDPOINT || process.env.NEXT_PUBLIC_API_ENDPOINT;
  const envApiKey = process.env.GRS_API_KEY || process.env.NEXT_PUBLIC_DEFAULT_API_KEY;
  
  if (!envEndpoint || !envApiKey) {
    console.warn('[API Config] ⚠️ 数据库无配置且环境变量未设置，视频功能将不可用');
  }
  
  return {
    apiEndpoint: envEndpoint ? `${envEndpoint}/v1/video/generate` : '',
    apiKey: envApiKey || '',
    modelName: 'grs-sora-2',
  };
}
