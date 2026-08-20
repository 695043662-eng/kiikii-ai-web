/**
 * 前端配置请求去重 + 短缓存工具
 * 
 * 核心问题：多个 React 组件（AIGeneratorContext、canvas/page.tsx、generate/page.tsx、video/page.tsx）
 * 各自独立 fetch 同一个 /api/config?service_type=xxx 接口，导致：
 * - 画布页面加载时 image_generation 配置被 fetch 3 次
 * - video_generation 配置被 fetch 2 次
 * - React StrictMode 下再翻倍
 * - HMR 热更新每次触发全量重 fetch
 * 
 * 解决方案：
 * 1. In-flight 去重：同一 URL 的并发请求共享一个 Promise
 * 2. 短 TTL 缓存：5 秒内的重复请求直接返回缓存数据
 * 
 * ⚠️ 军规：2C2G 服务器求生法则 —— 前端必须承担防御职责
 */

// In-flight 请求去重：URL → Promise<parsed JSON>
const inflightRequests = new Map<string, Promise<any>>();

// 短 TTL 响应缓存：URL → { data, timestamp }
const responseCache = new Map<string, { data: any; timestamp: number }>();

// 默认缓存 TTL：5 秒（仅用于同一页面加载周期内的去重，不是长期缓存）
const DEFAULT_CACHE_TTL = 5_000;

/**
 * 去重 fetch：同一 URL 的并发请求共享一个 Promise
 * 
 * @param url 请求 URL
 * @param cacheTtlMs 缓存 TTL（毫秒），默认 5 秒
 * @returns Promise<any> 解析后的 JSON 数据
 * 
 * @example
 * // 组件 A 和组件 B 同时调用：
 * const dataA = await fetchConfig('/api/config?service_type=image_generation');
 * const dataB = await fetchConfig('/api/config?service_type=image_generation');
 * // 只会发出 1 次 HTTP 请求，A 和 B 拿到同一份数据
 */
export async function fetchConfig(url: string, cacheTtlMs: number = DEFAULT_CACHE_TTL): Promise<any> {
  const cacheKey = `GET:${url}`;

  // 1. 检查短 TTL 缓存
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < cacheTtlMs) {
    console.log(`[config-fetch] 缓存命中: ${url}`);
    return cached.data;
  }

  // 2. 检查 in-flight 请求（去重核心）
  const inflight = inflightRequests.get(cacheKey);
  if (inflight) {
    console.log(`[config-fetch] 去重合并: ${url}`);
    return inflight;
  }

  // 3. 发起实际请求
  console.log(`[config-fetch] 实际请求: ${url}`);
  const requestPromise = fetch(url, {
    credentials: 'include',
    // #859 斩断浏览器 HTTP 缓存：确保每次请求都拿到最新数据
    cache: 'no-store',
  })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      // 写入短 TTL 缓存
      if (cacheTtlMs > 0) {
        responseCache.set(cacheKey, { data, timestamp: Date.now() });
        // 定时清理
        setTimeout(() => {
          const entry = responseCache.get(cacheKey);
          if (entry && Date.now() - entry.timestamp >= cacheTtlMs) {
            responseCache.delete(cacheKey);
          }
        }, cacheTtlMs + 1000);
      }

      // 请求完成，移除 in-flight 记录
      inflightRequests.delete(cacheKey);
      return data;
    })
    .catch(error => {
      // 请求失败，移除 in-flight 记录
      inflightRequests.delete(cacheKey);
      throw error;
    });

  // 记录 in-flight 请求
  inflightRequests.set(cacheKey, requestPromise);

  return requestPromise;
}

/**
 * 清除所有缓存（用于登出、强制刷新等场景）
 */
export function clearConfigFetchCache(): void {
  inflightRequests.clear();
  responseCache.clear();
}

/**
 * 清除特定 URL 的缓存
 */
export function invalidateConfigCache(url: string): void {
  const cacheKey = `GET:${url}`;
  responseCache.delete(cacheKey);
  inflightRequests.delete(cacheKey);
}

/**
 * 清除 canvas-config 相关缓存（管理后台更新后调用）
 */
export function clearCanvasConfigFetchCache(): void {
  // 清除所有包含 canvas-config 的缓存条目
  for (const key of responseCache.keys()) {
    if (key.includes('canvas-config')) {
      responseCache.delete(key);
    }
  }
  for (const key of inflightRequests.keys()) {
    if (key.includes('canvas-config')) {
      inflightRequests.delete(key);
    }
  }
}
