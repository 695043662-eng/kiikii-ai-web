/**
 * 签名 URL 缓存 Hook
 * 
 * 提供带本地缓存的签名 URL 获取能力
 * 
 * 核心功能：
 * 1. 本地缓存签名 URL，避免每次都请求后端
 * 2. 复用相同 URL 字符串，触发浏览器 Disk Cache
 * 3. 支持单个和批量获取
 */

'use client';

import { useCallback, useState, useEffect } from 'react';
import {
  getPresignedUrl,
  getPresignedUrls,
  invalidateCache,
  getCacheStats,
} from '@/lib/presigned-url-cache';

// 后端 API 端点
const SIGNED_URL_API = '/api/canvas/signed-url';

/**
 * 从后端获取新的签名 URL（单个）
 */
async function fetchNewUrlFromApi(key: string): Promise<string> {
  const response = await fetch(SIGNED_URL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: [key] }),
  });
  
  const data = await response.json();
  if (!data.success || !data.urls || !data.urls[key]) {
    throw new Error(`获取签名 URL 失败: ${key}`);
  }
  
  return data.urls[key];
}

/**
 * 从后端批量获取新的签名 URL
 */
async function fetchNewUrlsFromApi(keys: string[]): Promise<Record<string, string>> {
  const response = await fetch(SIGNED_URL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  });
  
  const data = await response.json();
  if (!data.success || !data.urls) {
    throw new Error('批量获取签名 URL 失败');
  }
  
  return data.urls;
}

/**
 * 签名 URL 缓存 Hook
 */
export function usePresignedUrl() {
  const [stats, setStats] = useState<ReturnType<typeof getCacheStats> | null>(null);
  
  // 刷新统计信息
  const refreshStats = useCallback(() => {
    setStats(getCacheStats());
  }, []);
  
  // 初始化时获取统计信息
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);
  
  /**
   * 获取单个签名 URL（带缓存）
   * 
   * @param imageKey 图片 Key
   * @returns 签名 URL
   */
  const getUrl = useCallback(async (imageKey: string): Promise<string> => {
    return getPresignedUrl(imageKey, fetchNewUrlFromApi);
  }, []);
  
  /**
   * 批量获取签名 URL（带缓存）
   * 
   * @param imageKeys 图片 Key 数组
   * @returns { [imageKey]: url } 映射
   */
  const getUrls = useCallback(async (imageKeys: string[]): Promise<Record<string, string>> => {
    if (imageKeys.length === 0) return {};
    return getPresignedUrls(imageKeys, fetchNewUrlsFromApi);
  }, []);
  
  /**
   * 使缓存失效
   */
  const invalidate = useCallback((imageKey?: string) => {
    invalidateCache(imageKey);
    refreshStats();
  }, [refreshStats]);
  
  /**
   * 获取图片 URL（自动判断是否需要签名）
   * 
   * @param src 原始 URL 或 imageKey
   * @returns 可用的 URL
   */
  const resolveUrl = useCallback(async (src: string | undefined | null): Promise<string | null> => {
    if (!src) return null;
    
    // 如果已经是完整 URL，直接返回
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
      return src;
    }
    
    // 否则视为 imageKey，获取签名 URL
    return getUrl(src);
  }, [getUrl]);
  
  return {
    getUrl,
    getUrls,
    invalidate,
    resolveUrl,
    stats,
    refreshStats,
  };
}

/**
 * 简化版 Hook：获取单个图片 URL
 * 
 * @param imageKey 图片 Key
 * @returns { url, loading, error }
 */
export function useImageUrl(imageKey: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const { getUrl } = usePresignedUrl();
  
  useEffect(() => {
    if (!imageKey) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return;
    }
    
    // 如果已经是完整 URL，直接使用
    if (imageKey.startsWith('http://') || imageKey.startsWith('https://') || imageKey.startsWith('data:')) {
      setUrl(imageKey);
      setLoading(false);
      setError(null);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    getUrl(imageKey)
      .then(setUrl)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [imageKey, getUrl]);
  
  return { url, loading, error };
}

/**
 * 批量获取图片 URL
 * 
 * @param imageKeys 图片 Key 数组
 * @returns { urls, loading, error }
 */
export function useImageUrls(imageKeys: string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const { getUrls } = usePresignedUrl();
  
  useEffect(() => {
    if (imageKeys.length === 0) {
      setUrls({});
      setLoading(false);
      setError(null);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    // 过滤掉已经是完整 URL 的 key
    const keysNeedingSignature = imageKeys.filter(
      key => !key.startsWith('http://') && !key.startsWith('https://') && !key.startsWith('data:')
    );
    
    // 已经是完整 URL 的直接使用
    const result: Record<string, string> = {};
    imageKeys.forEach(key => {
      if (key.startsWith('http://') || key.startsWith('https://') || key.startsWith('data:')) {
        result[key] = key;
      }
    });
    
    if (keysNeedingSignature.length === 0) {
      setUrls(result);
      setLoading(false);
      return;
    }
    
    getUrls(keysNeedingSignature)
      .then(newUrls => {
        setUrls({ ...result, ...newUrls });
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [imageKeys.join(','), getUrls]); // 依赖数组使用 join 结果
  
  return { urls, loading, error };
}

// 默认导出
export default usePresignedUrl;
