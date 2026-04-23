/**
 * 应用初始化模块
 * 在服务启动时执行一次性初始化操作
 */

import { cleanupExpiredCache } from '@/lib/taskResultsCache';
import { cleanupExpiredCache as cleanupRefCache } from '@/lib/reference-image-cache';
import { cleanupExpiredRateLimits } from '@/lib/rateLimit';

/**
 * 应用启动初始化
 * 执行清理、预热等操作
 */
export async function initializeApp(): Promise<void> {
  console.log('[Init] 开始应用初始化...');

  try {
    // 1. 清理过期的任务缓存
    console.log('[Init] 清理过期任务缓存...');
    cleanupExpiredCache();

    // 2. 清理过期的参考图缓存
    console.log('[Init] 清理过期参考图缓存...');
    await cleanupRefCache();

    // 3. 清理过期的限流记录
    console.log('[Init] 清理过期限流记录...');
    cleanupExpiredRateLimits();

    console.log('[Init] 应用初始化完成');
  } catch (error) {
    console.error('[Init] 应用初始化失败:', error);
    // 不抛出错误，允许应用继续启动
  }
}

// 在模块加载时自动执行（仅一次）
let initialized = false;

if (!initialized && typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
  // 仅在生产环境自动初始化
  initialized = true;
  initializeApp().catch(console.error);
}
