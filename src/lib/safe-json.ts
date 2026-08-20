/**
 * #854 安全 JSON 响应解析工具
 *
 * 问题背景：Nginx 网关 502/504 返回纯文本（如 "upstream failed..."），
 * 前端裸调用 response.json() 会抛出 "Unexpected token 'u'... is not valid JSON"，
 * 这个丑陋的英文报错直接甩给用户，极度不专业。
 *
 * 解决方案：所有涉及文件上传等高风险 fetch 调用的 response.json() 统一替换为本函数，
 * 提供：
 * 1. JSON 解析 try-catch 安全网
 * 2. HTTP 状态码感知的中文友好提示
 * 3. 兜底中文错误信息
 * 4. #887 鉴权终极加固：401 立即截断弹窗登录
 */

import { checkAuthExpired } from './auth-failure';

/**
 * 根据 HTTP 状态码生成中文友好错误提示
 */
function getHttpErrorMessage(status: number): string {
  if (status === 413) {
    return '上传失败：文件体积过大，请压缩后重试';
  }
  if (status === 502 || status === 504) {
    return '上传失败：服务器网络开小差了，请稍后重试';
  }
  if (status === 500) {
    return '上传失败：服务器内部错误，请稍后重试';
  }
  if (status === 429) {
    return '上传失败：请求过于频繁，请稍后重试';
  }
  if (status === 403) {
    return '上传失败：权限不足，请重新登录';
  }
  if (status === 401) {
    return '上传失败：登录已过期，请重新登录';
  }
  if (status >= 500) {
    return '上传失败：服务器网络开小差了，请稍后重试';
  }
  if (status >= 400) {
    return '上传失败：请求被拒绝，请检查文件后重试';
  }
  return '上传失败：网络或服务器异常，请检查文件后重试';
}

/**
 * 安全解析 fetch Response 的 JSON 内容
 *
 * 用法：替换裸露的 `await response.json()`
 *
 * Before:
 *   const data = await response.json();
 *
 * After:
 *   const data = await safeJsonResponse(response);
 *   // data 始终有值，如果解析失败会包含 { success: false, error: '中文友好提示' }
 *
 * @param response - fetch 返回的 Response 对象
 * @param fallbackMessage - 可选的自定义兜底错误消息
 * @returns 解析后的 JSON 对象，如果解析失败返回包含 success:false 和 error 的对象
 */
export async function safeJsonResponse<T = Record<string, unknown>>(
  response: Response,
  fallbackMessage?: string,
): Promise<T & { success: boolean; error: string }> {
  // #887 鉴权终极加固：401 立即截断弹窗登录，绝不重试
  checkAuthExpired(response);

  // 先尝试读取文本（不消耗 response body）
  const text = await response.text();

  // 尝试 JSON 解析
  try {
    const parsed = JSON.parse(text);
    return {
      success: parsed.success ?? true,
      error: parsed.error ?? '',
      ...parsed,
    } as T & { success: boolean; error: string };
  } catch {
    // JSON 解析失败——说明收到了网关纯文本错误（502/504 等）
    console.warn(
      `[safeJsonResponse] HTTP ${response.status}: 响应非 JSON 格式，原始内容: "${text.substring(0, 200)}"`,
    );

    // 根据状态码生成中文友好提示
    const errorMessage = fallbackMessage || getHttpErrorMessage(response.status);

    return {
      success: false,
      error: errorMessage,
    } as T & { success: boolean; error: string };
  }
}

/**
 * 安全执行 fetch + JSON 解析的快捷方法
 *
 * 用法：一步完成 fetch + 安全 JSON 解析
 *
 * Before:
 *   const response = await fetch('/api/upload', { method: 'POST', body: formData });
 *   const data = await response.json();
 *
 * After:
 *   const data = await safeFetchJson('/api/upload', { method: 'POST', body: formData });
 *
 * @param url - 请求 URL
 * @param options - fetch 选项
 * @param fallbackMessage - 可选的自定义兜底错误消息
 */
export async function safeFetchJson<T = Record<string, unknown>>(
  url: string,
  options?: RequestInit,
  fallbackMessage?: string,
): Promise<T & { success?: boolean; error?: string }> {
  const response = await fetch(url, options);
  return safeJsonResponse<T>(response, fallbackMessage);
}
