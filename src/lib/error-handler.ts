/**
 * 错误分类和重试策略 - 快速失败模式
 * 
 * ⚠️ 商业逻辑：为了确保账目 1:1 对齐，防止 API 供应商重复扣费
 *    所有错误立即返回，不进行任何重试
 */

export enum ErrorType {
  PARAMETER_ERROR = 'parameter_error',      // 参数错误：禁止重试
  INSUFFICIENT_CREDITS = 'insufficient_credits', // 积分不足：禁止重试
  PERMISSION_ERROR = 'permission_error',    // 权限错误：禁止重试
  LOGIC_ERROR = 'logic_error',              // 代码逻辑错误：禁止重试
  NETWORK_ERROR = 'network_error',          // 网络错误：禁止重试
  SUPPLIER_ERROR = 'supplier_error',        // 供应商错误：禁止重试
  TIMEOUT_ERROR = 'timeout_error',          // 超时错误：禁止重试
  UNKNOWN_ERROR = 'unknown_error',          // 未知错误：禁止重试
}

export interface RetryConfig {
  maxRetries?: number;        // 最大重试次数（强制为 0）
  initialDelay?: number;      // 初始延迟（强制为 0）
  maxDelay?: number;          // 最大延迟（强制为 0）
  backoffFactor?: number;     // 退避因子（强制为 0）
}

/**
 * 错误分类
 */
export function classifyError(error: any): ErrorType {
  if (!error) {
    return ErrorType.UNKNOWN_ERROR;
  }

  // HTTP 状态码错误
  if (error.status || error.statusCode) {
    const status = error.status || error.statusCode;

    // 参数错误
    if (status === 400) {
      return ErrorType.PARAMETER_ERROR;
    }

    // 积分不足
    if (status === 402) {
      return ErrorType.INSUFFICIENT_CREDITS;
    }

    // 权限错误
    if (status === 403) {
      return ErrorType.PERMISSION_ERROR;
    }

    // 供应商繁忙
    if (status === 503) {
      return ErrorType.SUPPLIER_ERROR;
    }

    // 代码逻辑错误
    if (status === 500) {
      return ErrorType.LOGIC_ERROR;
    }

    // 网关超时
    if (status === 504) {
      return ErrorType.TIMEOUT_ERROR;
    }
  }

  // 错误消息分类
  const errorMessage = (error.message || error.toString() || '').toLowerCase();

  if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ECONNRESET')) {
    return ErrorType.NETWORK_ERROR;
  }

  if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('TIMEOUT')) {
    return ErrorType.TIMEOUT_ERROR;
  }

  if (errorMessage.includes('EACCES') || errorMessage.includes('permission')) {
    return ErrorType.PERMISSION_ERROR;
  }

  // #554 服务商级别错误关键词（与 api-config.ts isServiceProviderError 保持一致）
  const supplierKeywords = [
    '系统繁忙',       // T8Star 渠道繁忙
    '请稍后再试',     // T8Star 繁忙提示
    '请稍后重试',     // 通用繁忙提示
    'quota',          // 配额用完
    'exceed',         // 超出限制
    'rate limit',     // 限流
    'too many',       // 请求过多
    'throttl',        // 节流
    'capacity',       // 容量不足
    'overload',       // 过载
    'unavailable',    // 服务不可用
    'channel',        // 渠道问题
    '渠道',           // 中文渠道
    '堵塞',           // 中文堵塞
    '余额',           // 余额不足
    'insufficient',   // 不足
    '1001',           // T8Star 错误码
    '1002',           // T8Star 错误码
    'system error',   // 系统错误
    '502',            // Bad Gateway
    '503',            // Service Unavailable
  ];

  for (const keyword of supplierKeywords) {
    if (errorMessage.includes(keyword.toLowerCase())) {
      return ErrorType.SUPPLIER_ERROR;
    }
  }

  // 默认未知错误
  return ErrorType.UNKNOWN_ERROR;
}

/**
 * 判断是否允许重试
 * 
 * ⚠️ 生产环境防御规则：
 * - 400/401/402/403/405/500：绝对禁止重试
 * - 仅当 503/504（服务商过载）时，允许重试且上限仅为 1 次
 */
export function shouldRetry(error: any): boolean {
  const errorType = classifyError(error);
  
  // 仅允许服务商过载错误重试（503/504）
  const allowedRetryTypes = [ErrorType.SUPPLIER_ERROR, ErrorType.TIMEOUT_ERROR];
  const canRetry = allowedRetryTypes.includes(errorType);
  
  console.log('[Retry] 错误类型:', errorType, '- 允许重试:', canRetry);
  return canRetry;
}

/**
 * 获取最大重试次数
 */
export function getMaxRetries(error: any): number {
  const errorType = classifyError(error);
  
  // 仅服务商过载允许重试 1 次
  const allowedRetryTypes = [ErrorType.SUPPLIER_ERROR, ErrorType.TIMEOUT_ERROR];
  if (allowedRetryTypes.includes(errorType)) {
    return 1;
  }
  
  return 0;
}

/**
 * 指数退避计算延迟 - 永远返回 0
 */
export function calculateBackoff(
  retryCount: number,
  config: RetryConfig = {}
): number {
  // 强制延迟为 0，立即返回
  return 0;
}

/**
 * 带重试的请求执行 - 受控重试模式
 * 
 * ⚠️ 生产环境防御规则：
 * 1. 错误黑名单（禁止重试）：400/401/402/403/405/500
 * 2. 受控重试：仅当 503/504（服务商过载）时，允许重试且上限仅为 1 次
 * 3. 防止 API 供应商重复扣费
 */
export async function executeWithRetry<T>(
  request: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  // 使用配置中的 maxRetries，如果没有则根据错误类型自动判断
  const maxRetries = config.maxRetries ?? 1; // 默认最多 1 次重试
  
  let lastError: any = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await request();
    } catch (error: any) {
      lastError = error;
      const errorType = classifyError(error);
      
      // 检查是否允许重试
      if (!shouldRetry(error)) {
        console.log('[FastFail] 错误类型:', errorType, '- 禁止重试，立即返回');
        throw error;
      }
      
      // 检查是否还有重试机会
      if (attempt >= maxRetries) {
        console.log('[Retry] 已达最大重试次数:', maxRetries, '- 停止重试');
        throw error;
      }
      
      console.log('[Retry] 第', attempt + 1, '次重试，错误类型:', errorType);
      
      // 短暂延迟后重试（500ms）
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  throw lastError;
}

/**
 * 格式化错误消息
 */
export function formatErrorMessage(error: any): string {
  const errorType = classifyError(error);
  const detailMessage = (error.message || '').toLowerCase();

  // 🔧 #211 修复：违规错误直接返回简短中文，不拼接冗长的英文原文
  if (detailMessage.includes('violate') || 
      detailMessage.includes('policy') || 
      detailMessage.includes('policies') ||
      detailMessage.includes('违反') || 
      detailMessage.includes('违规') || 
      detailMessage.includes('政策')) {
    return '内容违规，请修改提示词后重试';
  }

  // #554 服务商错误：提取核心错误信息，不要包装
  if (errorType === ErrorType.SUPPLIER_ERROR) {
    // 从错误信息中提取关键部分
    // 格式可能是："未知错误，请稍后重试: API 错误: 系统繁忙，请稍后再试（traceid: xxx）"
    // 提取："系统繁忙，请稍后再试"
    const apiErrorMatch = detailMessage.match(/api\s*错误[：:]\s*(.+?)(?:\s*（|\s*traceid|$)/i);
    if (apiErrorMatch && apiErrorMatch[1]) {
      return apiErrorMatch[1].trim();
    }
    
    // 直接返回原始错误信息（去除前缀）
    const colonIndex = detailMessage.lastIndexOf('：');
    if (colonIndex !== -1) {
      return detailMessage.substring(colonIndex + 1).trim();
    }
    
    // 如果包含"系统繁忙"或"请稍后"，直接返回
    if (detailMessage.includes('系统繁忙') || detailMessage.includes('请稍后')) {
      return '服务商繁忙，请稍后重试';
    }
    
    return '服务商繁忙，请稍后重试';
  }

  const errorMessages = {
    [ErrorType.PARAMETER_ERROR]: '参数错误，请检查输入',
    [ErrorType.INSUFFICIENT_CREDITS]: '积分不足，请充值',
    [ErrorType.PERMISSION_ERROR]: '权限不足，请检查账号状态',
    [ErrorType.LOGIC_ERROR]: '服务器内部错误，请联系管理员',
    [ErrorType.NETWORK_ERROR]: '网络错误，请检查网络连接',
    [ErrorType.SUPPLIER_ERROR]: '服务商繁忙，请稍后重试',
    [ErrorType.TIMEOUT_ERROR]: '请求超时，请稍后重试',
    [ErrorType.UNKNOWN_ERROR]: '未知错误，请稍后重试',
  };

  const baseMessage = errorMessages[errorType] || errorMessages[ErrorType.UNKNOWN_ERROR];

  // 对于未知错误，尝试提取有用信息
  if (errorType === ErrorType.UNKNOWN_ERROR && detailMessage) {
    // 截取前100字符，避免太长
    const shortMessage = detailMessage.length > 100 
      ? detailMessage.substring(0, 100) + '...' 
      : detailMessage;
    return shortMessage;
  }

  return baseMessage;
}

/**
 * #723 英文错误消息中文翻译
 * 将服务商/上游返回的英文错误消息翻译为用户友好的中文
 */
const ERROR_TRANSLATIONS: Array<{ pattern: RegExp; zh: string }> = [
  // 内容违规类
  { pattern: /content_policy/i, zh: '内容不符合安全政策，请修改提示词后重试' },
  { pattern: /content policy/i, zh: '内容不符合安全政策，请修改提示词后重试' },
  { pattern: /safety/i, zh: '内容安全审核未通过，请修改提示词后重试' },
  { pattern: /inappropriate/i, zh: '内容不适合生成，请修改提示词后重试' },
  { pattern: /violation/i, zh: '内容违反使用政策，请修改提示词后重试' },
  { pattern: /moderation/i, zh: '内容审核未通过，请修改提示词后重试' },
  { pattern: /nsfw/i, zh: '内容包含不当信息，请修改提示词后重试' },
  { pattern: /sensitive/i, zh: '内容涉及敏感信息，请修改提示词后重试' },
  // #833 Gemini Omni Flash 人物滤镜错误（服务商返回 public_error_prominent_people_filter_failed）
  { pattern: /prominent_people_filter/i, zh: '内容包含知名人物，无法生成，请修改提示词后重试' },
  { pattern: /people_filter/i, zh: '内容包含人物限制，请修改提示词后重试' },

  // 服务商/系统类
  { pattern: /upstream/i, zh: '上游服务异常' },
  { pattern: /rate.?limit/i, zh: '请求过于频繁，请稍后重试' },
  { pattern: /quota/i, zh: '服务商配额不足，请稍后重试' },
  { pattern: /overload/i, zh: '服务过载，请稍后重试' },
  { pattern: /no.?available.?channel/i, zh: '无可用渠道，请联系管理员或稍后重试' },
  { pattern: /channel.*unavailable|unavailable.*channel/i, zh: '渠道不可用，请稍后重试' },
  { pattern: /channel/i, zh: '服务渠道异常，请稍后重试' },
  { pattern: /unavailable/i, zh: '服务暂不可用，请稍后重试' },
  { pattern: /internal.?error/i, zh: '服务器内部错误，请稍后重试' },
  { pattern: /system.?error/i, zh: '系统错误，请稍后重试' },
  { pattern: /server.?error/i, zh: '服务器错误，请稍后重试' },
  { pattern: /bad.?gateway/i, zh: '网关错误，请稍后重试' },
  { pattern: /gateway.?timeout/i, zh: '网关超时，请稍后重试' },
  { pattern: /service.?unavailable/i, zh: '服务暂不可用，请稍后重试' },

  // 网络类
  { pattern: /network/i, zh: '网络错误，请检查网络连接' },
  { pattern: /fetch/i, zh: '网络请求失败，请检查网络连接' },
  { pattern: /timeout/i, zh: '请求超时，请稍后重试' },
  { pattern: /connection/i, zh: '连接失败，请检查网络' },
  { pattern: /ECONNREFUSED/i, zh: '服务器拒绝连接，请稍后重试' },
  { pattern: /ECONNRESET/i, zh: '连接被重置，请稍后重试' },

  // 参数类
  { pattern: /invalid.?parameter/i, zh: '参数错误，请检查输入' },
  { pattern: /invalid.?request/i, zh: '请求格式错误' },
  { pattern: /bad.?request/i, zh: '请求参数错误' },
  { pattern: /unsupported/i, zh: '不支持的操作' },
  { pattern: /not.?found/i, zh: '请求的资源不存在' },
  { pattern: /unauthorized/i, zh: '未授权，请重新登录' },
  { pattern: /forbidden/i, zh: '权限不足' },

  // 生成类
  { pattern: /generation.?fail/i, zh: '生成失败，请稍后重试' },
  { pattern: /generation.?error/i, zh: '生成出错，请稍后重试' },
  { pattern: /failed.?to.?generate/i, zh: '生成失败，请稍后重试' },
  { pattern: /no.?video/i, zh: '未生成视频，请稍后重试' },

  // HTTP 状态码
  { pattern: /\b503\b/, zh: '服务商繁忙，请稍后重试' },
  { pattern: /\b502\b/, zh: '网关错误，请稍后重试' },
  { pattern: /\b504\b/, zh: '网关超时，请稍后重试' },
  { pattern: /\b500\b/, zh: '服务器内部错误，请稍后重试' },
  { pattern: /\b401\b/, zh: '认证失败，请重新登录' },
  { pattern: /\b403\b/, zh: '权限不足' },
  { pattern: /\b404\b/, zh: '请求的资源不存在' },

  // T8Star 特有
  { pattern: /1001/i, zh: '服务商系统错误，请稍后重试' },
  { pattern: /1002/i, zh: '服务商参数错误，请检查设置' },

  // API 错误格式（匹配 "API 错误: xxx" 格式的消息）
  { pattern: /api\s*错误[：:]\s*no\s+available\s+channel/i, zh: '无可用渠道，请联系管理员或稍后重试' },
  { pattern: /no\s+available\s+channel/i, zh: '无可用渠道，请联系管理员或稍后重试' },
  { pattern: /api\s*错误[：:]/i, zh: '服务接口异常，请稍后重试' },

  // 通用兜底
  { pattern: /unknown.?error/i, zh: '未知错误，请稍后重试' },
];

/**
 * 翻译英文错误消息为中文
 * 如果消息已是中文或不含英文关键词，原样返回
 */
export function translateErrorMessage(message: string): string {
  if (!message) return '未知错误';

  // #731 修复：即使消息含有中文，也要检查是否包含需要翻译的英文关键词（如 503、502 等）
  // 先尝试匹配翻译规则（优先级高的规则在前）
  for (const { pattern, zh } of ERROR_TRANSLATIONS) {
    if (pattern.test(message)) {
      return zh;
    }
  }

  // 如果消息全是中文（含少量标点/数字），直接返回
  const chineseRatio = (message.match(/[\u4e00-\u9fff]/g) || []).length / message.length;
  if (chineseRatio > 0.3) return message;

  // #732 兜底：如果消息主要是英文且长度较短，返回通用错误提示
  // 避免用户看到原始英文错误消息
  if (message.length < 100) {
    return '操作失败，请稍后重试';
  }

  // 较长的英文消息，截取前50字符并添加提示
  return message.substring(0, 50) + '...（请稍后重试）';
}
