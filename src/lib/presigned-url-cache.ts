/**
 * 签名 URL 本地缓存机制
 * 
 * 核心问题：COS 每次返回的 Pre-signed URL 签名不同，导致浏览器 Disk Cache 失效
 * 解决方案：本地缓存签名 URL，在有效期内复用相同的 URL
 * 
 * 效果：传入 <img src="..."> 的 URL 字符串保持一致，触发浏览器缓存
 */

// 缓存存储键
const CACHE_KEY = 'presigned_url_cache';
import { safeSetItem } from './safe-storage';

// 缓存条目结构
interface CacheEntry {
  url: string;
  expireAt: number;  // 签名过期时间戳
  cachedAt: number;  // 缓存时间戳
}

// 缓存结构：{ [imageKey]: CacheEntry }
type UrlCache = Record<string, CacheEntry>;

// 缓存配置
const CONFIG = {
  // 安全边界：签名过期前 10 分钟视为"即将过期"
  SAFETY_MARGIN_MS: 10 * 60 * 1000,
  // 签名有效期：5天（432000秒）
  DEFAULT_EXPIRES_IN: 432000,
  // 缓存清理间隔：每小时清理一次过期条目
  CLEANUP_INTERVAL_MS: 60 * 60 * 1000,
  // 最大缓存条目数（防止内存溢出）
  MAX_CACHE_SIZE: 1000,
};

// 上次清理时间
let lastCleanupTime = 0;

/**
 * 获取缓存
 */
function getCache(): UrlCache {
  if (typeof window === 'undefined') return {};
  
  try {
    const cacheStr = localStorage.getItem(CACHE_KEY);
    if (!cacheStr) return {};
    
    const cache = JSON.parse(cacheStr) as UrlCache;
    return cache || {};
  } catch (e) {
    console.warn('[PresignedUrlCache] 读取缓存失败:', e);
    return {};
  }
}

/**
 * 保存缓存
 */
function saveCache(cache: UrlCache): void {
  if (typeof window === 'undefined') return;
  
  try {
    safeSetItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    // localStorage 可能已满，清理旧数据
    console.warn('[PresignedUrlCache] 保存缓存失败，尝试清理:', e);
    cleanupExpiredEntries(cache);
    try {
      safeSetItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      console.error('[PresignedUrlCache] 清理后仍无法保存，跳过');
    }
  }
}

/**
 * 清理过期条目
 */
function cleanupExpiredEntries(cache: UrlCache): void {
  const now = Date.now();
  const keysToDelete: string[] = [];
  
  for (const [key, entry] of Object.entries(cache)) {
    if (entry.expireAt < now) {
      keysToDelete.push(key);
    }
  }
  
  if (keysToDelete.length > 0) {
    keysToDelete.forEach(key => delete cache[key]);
    console.log('[PresignedUrlCache] 清理过期条目:', keysToDelete.length, '个');
  }
}

/**
 * 限制缓存大小（LRU 策略：删除最旧的条目）
 */
function limitCacheSize(cache: UrlCache): void {
  const entries = Object.entries(cache);
  if (entries.length <= CONFIG.MAX_CACHE_SIZE) return;
  
  // 按缓存时间排序，删除最旧的
  entries.sort((a, b) => a[1].cachedAt - b[1].cachedAt);
  
  const deleteCount = entries.length - CONFIG.MAX_CACHE_SIZE;
  for (let i = 0; i < deleteCount; i++) {
    delete cache[entries[i][0]];
  }
  
  console.log('[PresignedUrlCache] 限制缓存大小，删除', deleteCount, '个最旧条目');
}

/**
 * 检查缓存条目是否有效（未过期且距离过期还有安全边界时间）
 */
function isEntryValid(entry: CacheEntry): boolean {
  const now = Date.now();
  // 距离过期还有 10 分钟以上才视为有效
  return entry.expireAt > now + CONFIG.SAFETY_MARGIN_MS;
}

/**
 * 获取单个签名 URL（带缓存）
 * 
 * @param imageKey 图片 Key
 * @param fetchNewUrl 获取新 URL 的函数
 * @returns 签名 URL
 */
export async function getPresignedUrl(
  imageKey: string,
  fetchNewUrl: (key: string) => Promise<string>
): Promise<string> {
  // 定期清理过期条目
  const now = Date.now();
  if (now - lastCleanupTime > CONFIG.CLEANUP_INTERVAL_MS) {
    const cache = getCache();
    cleanupExpiredEntries(cache);
    saveCache(cache);
    lastCleanupTime = now;
  }
  
  // 检查缓存
  const cache = getCache();
  const cachedEntry = cache[imageKey];
  
  if (cachedEntry && isEntryValid(cachedEntry)) {
    // 缓存命中且有效，直接返回
    console.log('[PresignedUrlCache] 命中缓存:', imageKey.substring(0, 30), '| 剩余有效时间:', Math.round((cachedEntry.expireAt - now) / 1000 / 60), '分钟');
    return cachedEntry.url;
  }
  
  // 缓存未命中或已过期，获取新 URL
  console.log('[PresignedUrlCache] 缓存未命中，请求新 URL:', imageKey.substring(0, 30));
  
  const newUrl = await fetchNewUrl(imageKey);
  
  // 解析 URL 中的过期时间（如果有）
  let expireAt = now + CONFIG.DEFAULT_EXPIRES_IN * 1000;
  
  // 尝试从 URL 参数解析过期时间
  try {
    const url = new URL(newUrl);
    const expiresParam = url.searchParams.get('Expires');
    if (expiresParam) {
      expireAt = parseInt(expiresParam, 10) * 1000; // 转换为毫秒
    }
  } catch {
    // URL 解析失败，使用默认过期时间
  }
  
  // 更新缓存
  cache[imageKey] = {
    url: newUrl,
    expireAt,
    cachedAt: now,
  };
  
  // 限制缓存大小
  limitCacheSize(cache);
  
  // 保存缓存
  saveCache(cache);
  
  console.log('[PresignedUrlCache] 缓存已更新:', imageKey.substring(0, 30), '| 有效期至:', new Date(expireAt).toLocaleString());
  
  return newUrl;
}

/**
 * 批量获取签名 URL（带缓存）
 * 
 * @param imageKeys 图片 Key 数组
 * @param fetchNewUrls 批量获取新 URL 的函数
 * @returns { [imageKey]: url } 映射
 */
export async function getPresignedUrls(
  imageKeys: string[],
  fetchNewUrls: (keys: string[]) => Promise<Record<string, string>>
): Promise<Record<string, string>> {
  const cache = getCache();
  const results: Record<string, string> = {};
  const keysToFetch: string[] = [];
  
  // 检查缓存
  for (const key of imageKeys) {
    const entry = cache[key];
    if (entry && isEntryValid(entry)) {
      // 缓存命中
      results[key] = entry.url;
    } else {
      // 需要获取新 URL
      keysToFetch.push(key);
    }
  }
  
  console.log('[PresignedUrlCache] 批量获取:', imageKeys.length, '个 | 缓存命中:', Object.keys(results).length, '个 | 需请求:', keysToFetch.length, '个');
  
  // 如果有未命中的 key，批量获取
  if (keysToFetch.length > 0) {
    const newUrls = await fetchNewUrls(keysToFetch);
    const now = Date.now();
    
    // 更新缓存
    for (const key of keysToFetch) {
      const url = newUrls[key];
      if (!url) continue;
      
      results[key] = url;
      
      // 解析过期时间
      let expireAt = now + CONFIG.DEFAULT_EXPIRES_IN * 1000;
      try {
        const urlObj = new URL(url);
        const expiresParam = urlObj.searchParams.get('Expires');
        if (expiresParam) {
          expireAt = parseInt(expiresParam, 10) * 1000;
        }
      } catch {
        // 忽略解析错误
      }
      
      cache[key] = {
        url,
        expireAt,
        cachedAt: now,
      };
    }
    
    // 限制缓存大小并保存
    limitCacheSize(cache);
    saveCache(cache);
  }
  
  return results;
}

/**
 * 使缓存失效（强制刷新）
 */
export function invalidateCache(imageKey?: string): void {
  if (typeof window === 'undefined') return;
  
  if (imageKey) {
    // 使单个 key 失效
    const cache = getCache();
    delete cache[imageKey];
    saveCache(cache);
    console.log('[PresignedUrlCache] 缓存已失效:', imageKey.substring(0, 30));
  } else {
    // 使所有缓存失效
    localStorage.removeItem(CACHE_KEY);
    console.log('[PresignedUrlCache] 所有缓存已清除');
  }
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats(): {
  totalEntries: number;
  validEntries: number;
  expiredEntries: number;
  oldestEntry: string | null;
  newestEntry: string | null;
} {
  const cache = getCache();
  const entries = Object.entries(cache);
  const now = Date.now();
  
  let validCount = 0;
  let expiredCount = 0;
  let oldestTime = Infinity;
  let newestTime = 0;
  let oldestKey = null;
  let newestKey = null;
  
  for (const [key, entry] of entries) {
    if (entry.expireAt > now) {
      validCount++;
    } else {
      expiredCount++;
    }
    
    if (entry.cachedAt < oldestTime) {
      oldestTime = entry.cachedAt;
      oldestKey = key;
    }
    if (entry.cachedAt > newestTime) {
      newestTime = entry.cachedAt;
      newestKey = key;
    }
  }
  
  return {
    totalEntries: entries.length,
    validEntries: validCount,
    expiredEntries: expiredCount,
    oldestEntry: oldestKey ? new Date(oldestTime).toLocaleString() : null,
    newestEntry: newestKey ? new Date(newestTime).toLocaleString() : null,
  };
}
