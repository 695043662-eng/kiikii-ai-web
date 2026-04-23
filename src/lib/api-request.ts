/**
 * API 请求发送器 - 生产环境防御级实现
 * 
 * 核心规则：
 * 1. 50秒强制超时（50000ms）
 * 2. 错误黑名单（禁止重试）：400/401/402/403/405/500
 * 3. 受控重试：仅 503/504 允许重试 1 次
 * 4. 流式响应处理
 * 5. 资源自清理（finally 清理 /tmp）
 */

import { classifyError, shouldRetry, getMaxRetries } from './error-handler';

export interface RequestConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number; // 默认 50000ms
}

export interface ResponseResult<T = any> {
  success: boolean;
  data?: T;
  error?: {
    type: string;
    message: string;
    statusCode?: number;
    canRetry: boolean;
  };
}

/**
 * 带超时的 fetch 请求
 */
export async function fetchWithTimeout<T = any>(
  config: RequestConfig
): Promise<ResponseResult<T>> {
  const {
    url,
    method = 'POST',
    headers = {},
    body,
    timeout = 50000, // ⚠️ 默认 50 秒超时
  } = config;

  console.log('[API] 发送请求:', url);
  console.log('[API] 超时设置:', timeout, 'ms');

  // 创建 AbortController 用于超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log('[API] ⏱️ 超时触发，中止请求');
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log('[API] 响应状态:', response.status);

    // 检查 HTTP 状态码
    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage = errorBody;
      
      try {
        const errorJson = JSON.parse(errorBody);
        errorMessage = errorJson.message || errorJson.error || errorBody;
      } catch {
        // 不是 JSON，使用原始文本
      }

      const error = new Error(errorMessage) as any;
      error.statusCode = response.status;

      const errorType = classifyError(error);
      const canRetry = shouldRetry(error);

      console.log('[API] ❌ 请求失败:', {
        status: response.status,
        type: errorType,
        canRetry,
        message: errorMessage,
      });

      return {
        success: false,
        error: {
          type: errorType,
          message: errorMessage,
          statusCode: response.status,
          canRetry,
        },
      };
    }

    // 解析响应
    const data = await response.json();
    console.log('[API] ✅ 请求成功');

    return {
      success: true,
      data,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);

    // 超时错误
    if (error.name === 'AbortError') {
      console.log('[API] ⏱️ 请求超时');
      return {
        success: false,
        error: {
          type: 'TIMEOUT_ERROR',
          message: '请求超时',
          canRetry: true, // 超时允许重试
        },
      };
    }

    // 其他错误
    const errorType = classifyError(error);
    const canRetry = shouldRetry(error);

    console.log('[API] ❌ 请求异常:', {
      type: errorType,
      canRetry,
      message: error.message,
    });

    return {
      success: false,
      error: {
        type: errorType,
        message: error.message,
        canRetry,
      },
    };
  }
}

/**
 * 带重试的 API 请求
 * 
 * ⚠️ 受控重试：仅 503/504 允许重试 1 次
 */
export async function fetchWithRetry<T = any>(
  config: RequestConfig
): Promise<ResponseResult<T>> {
  const maxRetries = 1; // 最多重试 1 次
  let attempt = 0;
  let lastResult: ResponseResult<T>;

  while (attempt <= maxRetries) {
    attempt++;
    console.log(`[API] 第 ${attempt} 次尝试`);

    lastResult = await fetchWithTimeout<T>(config);

    if (lastResult.success) {
      return lastResult;
    }

    // 检查是否允许重试
    if (!lastResult.error?.canRetry) {
      console.log('[API] 禁止重试，立即返回');
      return lastResult;
    }

    // 检查是否还有重试机会
    if (attempt > maxRetries) {
      console.log('[API] 已达最大重试次数');
      return lastResult;
    }

    console.log('[API] 准备重试...');
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return lastResult!;
}

/**
 * SSE 流式请求发送器
 * 
 * ⚠️ 50秒超时 + 流式处理
 */
export async function fetchSSEWithTimeout(
  config: RequestConfig,
  onEvent: (event: { type: string; data: any }) => void,
  onError: (error: Error) => void,
  onComplete: () => void
): Promise<void> {
  const {
    url,
    method = 'POST',
    headers = {},
    body,
    timeout = 50000, // ⚠️ 默认 50 秒超时
  } = config;

  console.log('[SSE] 发送请求:', url);
  console.log('[SSE] 超时设置:', timeout, 'ms');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log('[SSE] ⏱️ 超时触发，中止请求');
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log('[SSE] 响应状态:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      onError(new Error(`HTTP ${response.status}: ${errorText}`));
      return;
    }

    // 处理 SSE 流
    const reader = response.body?.getReader();
    if (!reader) {
      onError(new Error('无法获取响应流'));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        console.log('[SSE] 流结束');
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            onEvent({ type: data.type, data });
          } catch (e) {
            console.error('[SSE] 解析事件失败:', line);
          }
        }
      }
    }

    onComplete();
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      onError(new Error('请求超时'));
    } else {
      onError(error);
    }
  }
}

/**
 * 资源清理工具
 * 
 * ⚠️ 在 finally 块中调用，确保清理所有临时文件
 */
export async function cleanupResources(filePaths: string[]): Promise<void> {
  console.log('[清理] 开始清理资源:', filePaths);

  for (const path of filePaths) {
    try {
      const fs = await import('fs/promises');
      await fs.unlink(path);
      console.log('[清理] ✅ 已删除:', path);
    } catch (error: any) {
      // 文件不存在，忽略
      if (error.code === 'ENOENT') {
        console.log('[清理] 文件不存在:', path);
      } else {
        console.error('[清理] ❌ 删除失败:', path, error);
      }
    }
  }
}
