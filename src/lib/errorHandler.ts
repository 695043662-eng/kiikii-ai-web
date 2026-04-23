/**
 * 统一错误处理工具
 * 过滤敏感信息，统一错误格式
 */

// 敏感信息关键词
const SENSITIVE_KEYWORDS = [
  'api_key',
  'apikey',
  'apiKey',
  'password',
  'secret',
  'token',
  'authorization',
  'credential',
  'private_key',
  'privateKey',
];

/**
 * 过滤敏感信息
 * @param data 原始数据（对象或字符串）
 * @returns 过滤后的数据
 */
export function filterSensitiveInfo(data: any): any {
  if (typeof data === 'string') {
    return filterSensitiveString(data);
  }

  if (typeof data === 'object' && data !== null) {
    const filtered: any = Array.isArray(data) ? [] : {};

    for (const key in data) {
      const lowerKey = key.toLowerCase();

      // 检查是否是敏感字段
      const isSensitive = SENSITIVE_KEYWORDS.some(keyword =>
        lowerKey.includes(keyword)
      );

      if (isSensitive) {
        filtered[key] = '***FILTERED***';
      } else if (typeof data[key] === 'object') {
        filtered[key] = filterSensitiveInfo(data[key]);
      } else if (typeof data[key] === 'string') {
        filtered[key] = filterSensitiveString(data[key]);
      } else {
        filtered[key] = data[key];
      }
    }

    return filtered;
  }

  return data;
}

/**
 * 过滤字符串中的敏感信息
 * @param str 原始字符串
 * @returns 过滤后的字符串
 */
export function filterSensitiveString(str: string): string {
  let filtered = str;

  // 过滤常见的敏感信息模式
  const patterns = [
    // API Key: sk-xxx
    /(sk-[a-zA-Z0-9]{32,})/g,
    // Bearer Token: Bearer xxx
    /(Bearer\s+[a-zA-Z0-9\-._~+/]+=*)/gi,
    // Authorization header
    /(Authorization:\s*[^\r\n]+)/gi,
    // 可能的密码字段
    /(password["\s:=]+\S{8,})/gi,
  ];

  for (const pattern of patterns) {
    filtered = filtered.replace(pattern, (match) => {
      // 保留前 4 个字符，其余替换为 ***
      if (match.length > 8) {
        return match.substring(0, 4) + '***';
      }
      return '***';
    });
  }

  return filtered;
}

/**
 * 格式化错误信息
 * @param error 错误对象
 * @returns 格式化后的错误对象
 */
export function formatError(error: any): {
  message: string;
  code?: string;
  details?: any;
} {
  let message = '未知错误';
  let code: string | undefined;
  let details: any = undefined;

  if (error instanceof Error) {
    message = error.message;

    // 提取错误代码（如果有）
    if ('code' in error) {
      code = String(error.code);
    }

    // 提取详细信息
    if ('details' in error) {
      details = filterSensitiveInfo(error.details);
    }

    // 处理 Supabase 错误
    if ('hint' in error) {
      details = {
        ...details,
        hint: filterSensitiveInfo(error.hint),
      };
    }
  } else if (typeof error === 'string') {
    message = error;
  } else if (typeof error === 'object') {
    message = JSON.stringify(filterSensitiveInfo(error));
  }

  return {
    message: filterSensitiveString(message),
    code,
    details: details ? filterSensitiveInfo(details) : undefined,
  };
}

/**
 * 创建标准化错误响应
 * @param error 错误对象
 * @param status HTTP 状态码
 * @returns 标准化错误对象
 */
export function createErrorResponse(error: any, status: number = 500): {
  success: false;
  error: string;
  code?: string;
  details?: any;
  statusCode: number;
} {
  const formatted = formatError(error);

  return {
    success: false,
    error: formatted.message,
    code: formatted.code,
    details: formatted.details,
    statusCode: status,
  };
}

/**
 * 安全的日志输出（过滤敏感信息）
 * @param prefix 日志前缀
 * @param data 要记录的数据
 */
export function safeLog(prefix: string, data: any): void {
  const filtered = filterSensitiveInfo(data);
  console.log(prefix, filtered);
}

/**
 * 安全的错误日志输出
 * @param prefix 日志前缀
 * @param error 错误对象
 */
export function safeErrorLog(prefix: string, error: any): void {
  const formatted = formatError(error);
  console.error(prefix, formatted);
}
