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
  const errorMessage = error.message || error.toString() || '';

  if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ECONNRESET')) {
    return ErrorType.NETWORK_ERROR;
  }

  if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('TIMEOUT')) {
    return ErrorType.TIMEOUT_ERROR;
  }

  if (errorMessage.includes('EACCES') || errorMessage.includes('permission')) {
    return ErrorType.PERMISSION_ERROR;
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

  const errorMessages = {
    [ErrorType.PARAMETER_ERROR]: '参数错误，请检查输入',
    [ErrorType.INSUFFICIENT_CREDITS]: '积分不足，请充值',
    [ErrorType.PERMISSION_ERROR]: '权限不足，请检查账号状态',
    [ErrorType.LOGIC_ERROR]: '服务器内部错误，请联系管理员',
    [ErrorType.NETWORK_ERROR]: '网络错误，请检查网络连接',
    [ErrorType.SUPPLIER_ERROR]: '供应商繁忙，请稍后重试',
    [ErrorType.TIMEOUT_ERROR]: '请求超时，请稍后重试',
    [ErrorType.UNKNOWN_ERROR]: '未知错误，请稍后重试',
  };

  const baseMessage = errorMessages[errorType] || errorMessages[ErrorType.UNKNOWN_ERROR];
  const detailMessage = error.message || '';

  // 🔧 #211 修复：违规错误直接返回简短中文，不拼接冗长的英文原文
  if (detailMessage.toLowerCase().includes('violate') || 
      detailMessage.toLowerCase().includes('policy') || 
      detailMessage.toLowerCase().includes('policies') ||
      detailMessage.includes('违反') || 
      detailMessage.includes('违规') || 
      detailMessage.includes('政策')) {
    return '内容违规，请修改提示词后重试';
  }

  return detailMessage ? `${baseMessage}: ${detailMessage}` : baseMessage;
}
