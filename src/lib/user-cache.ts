/**
 * 用户信息缓存工具
 * 减少重复的 API 调用，提升性能
 * 
 * ⚠️ 军规约束：2C2G 服务器求生法则
 * - 缓存 30 秒，避免频繁 API 调用
 * - 页面初始化时只刷新一次
 * - 生图完成后使用 updateCachedCredits 更新，不调用 API
 */

import { safeSetItem } from './safe-storage';

export interface CachedUserInfo {
  id: string;
  phone: string;
  email?: string;
  nickname: string;
  avatar?: string;
  credits: number;
  created_at: string;
}

const CACHE_KEY = 'userInfo_cache';
const CACHE_EXPIRY = 30 * 1000; // 30秒缓存过期

// 缓存结构
interface CacheData {
  user: CachedUserInfo;
  timestamp: number;
}

// 内存缓存（比 localStorage 更快）
let memoryCache: CacheData | null = null;

// 🔒 军规防御：页面生命周期内只允许首次强制刷新
let initialRefreshDone = false;

/**
 * 获取缓存的用户信息
 */
export function getCachedUser(): CachedUserInfo | null {
  // 优先使用内存缓存
  if (memoryCache) {
    const now = Date.now();
    if (now - memoryCache.timestamp < CACHE_EXPIRY) {
      return memoryCache.user;
    }
  }

  // 尝试从 localStorage 读取
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(CACHE_KEY);
      if (saved) {
        const cache: CacheData = JSON.parse(saved);
        const now = Date.now();
        if (now - cache.timestamp < CACHE_EXPIRY) {
          // 恢复内存缓存
          memoryCache = cache;
          return cache.user;
        }
      }
    } catch (e) {
      console.error('读取用户缓存失败:', e);
    }
  }

  return null;
}

/**
 * 设置用户信息缓存
 */
export function setCachedUser(user: CachedUserInfo | null): void {
  if (user === null) {
    memoryCache = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(CACHE_KEY);
    }
    return;
  }
  
  const cache: CacheData = {
    user,
    timestamp: Date.now(),
  };

  // 更新内存缓存
  memoryCache = cache;

  // 同步到 localStorage
  if (typeof window !== 'undefined') {
    try {
      safeSetItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      console.error('保存用户缓存失败:', e);
    }
  }
}

/**
 * 清除用户缓存
 */
export function clearCachedUser(): void {
  memoryCache = null;
  initialRefreshDone = false; // 重置刷新标记
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch (e) {
      console.error('清除用户缓存失败:', e);
    }
  }
}

/**
 * 更新缓存的积分（不重新获取完整用户信息）
 * 🔒 军规：生图完成后调用此函数，不触发 API 请求
 */
export function updateCachedCredits(credits: number): void {
  if (memoryCache) {
    memoryCache.user.credits = credits;
    if (typeof window !== 'undefined') {
      try {
        safeSetItem(CACHE_KEY, JSON.stringify(memoryCache));
      } catch (e) {
        // 忽略写入错误
      }
    }
  }
}

/**
 * 获取用户信息（带缓存）
 * 🔒 军规约束：
 * - 首次调用清除缓存并刷新（页面初始化）
 * - 后续调用走缓存，避免 DDoS
 */
export async function fetchUserWithCache(): Promise<CachedUserInfo | null> {
  // 🔒 军规防御：首次调用时清除旧缓存，确保获取最新数据
  if (!initialRefreshDone) {
    initialRefreshDone = true;
    // 清除可能过期的旧缓存
    memoryCache = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(CACHE_KEY);
    }
    console.log('[user-cache] 首次调用，清除旧缓存');
  } else {
    // 后续调用尝试使用缓存
    const cached = getCachedUser();
    if (cached) {
      console.log('[user-cache] 使用缓存');
      return cached;
    }
  }

  // 缓存过期或首次调用，调用 API
  console.log('[user-cache] 调用 API /api/user/info');
  try {
    const response = await fetch('/api/user/info');
    const data = await response.json();
    
    console.log('[user-cache] API 返回:', JSON.stringify(data));
    
    if (data.success && data.user) {
      console.log('[user-cache] 用户积分:', data.user.credits);
      setCachedUser(data.user);
      return data.user;
    }
  } catch (e) {
    console.error('获取用户信息失败:', e);
  }

  return null;
}

/**
 * 重置刷新标记（用于测试或特殊场景）
 */
export function resetInitialRefreshFlag(): void {
  initialRefreshDone = false;
}
