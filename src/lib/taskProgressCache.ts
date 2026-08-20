// #722 根因修复：Next.js dev 模式下，不同 API 路由可能被编译到不同 chunk，
// 导致模块级变量（const progressCache = new Map()）不是同一实例！
// 使用 globalThis 确保跨路由共享同一份内存缓存。

interface ProgressInfo {
  progress: number;       // 0-100 的百分比
  status: string;         // 'processing' | 'uploading' | 'completed' | 'failed'
  updatedAt: number;      // 时间戳
}

// #722 强制 globalThis 单例：不同 chunk 中的 require/import 拿到同一个 Map
const GLOBAL_KEY = '__kiikii_task_progress_cache__';
const MAX_CACHE_SIZE = 500;

function getProgressCache(): Map<string, ProgressInfo> {
  if (!(globalThis as any)[GLOBAL_KEY]) {
    (globalThis as any)[GLOBAL_KEY] = new Map<string, ProgressInfo>();
    console.log('[ProgressCache] #722 globalThis 单例已创建, key=' + GLOBAL_KEY);
  }
  return (globalThis as any)[GLOBAL_KEY] as Map<string, ProgressInfo>;
}

// 过期时间：10 分钟
const PROGRESS_EXPIRE_MS = 10 * 60 * 1000;

// 设置任务进度
export function setTaskProgress(taskId: string, progress: number, status: string): void {
  const progressCache = getProgressCache();
  // 容量守卫
  if (!progressCache.has(taskId) && progressCache.size >= MAX_CACHE_SIZE) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, info] of progressCache) {
      if (info.updatedAt < oldestTime) {
        oldestTime = info.updatedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      progressCache.delete(oldestKey);
      console.warn(`[ProgressCache] 容量上限(${MAX_CACHE_SIZE})，淘汰最旧条目: ${oldestKey}`);
    }
  }

  progressCache.set(taskId, {
    progress: Math.min(Math.max(progress, 0), 100),
    status,
    updatedAt: Date.now(),
  });
  // #722 写入确认日志
  console.log(`[ProgressCache] WRITE: taskId=${taskId}, progress=${progress}, status=${status}, cacheSize=${progressCache.size}`);
}

// 获取任务进度（自动判断过期）
export function getTaskProgress(taskId: string): ProgressInfo | undefined {
  const progressCache = getProgressCache();
  const info = progressCache.get(taskId);
  // #722 读取诊断日志
  console.log(`[ProgressCache] READ: taskId=${taskId}, found=${!!info}, progress=${info?.progress}, cacheSize=${progressCache.size}`);
  if (!info) return undefined;
  // 过期自动删除
  if (Date.now() - info.updatedAt > PROGRESS_EXPIRE_MS) {
    progressCache.delete(taskId);
    return undefined;
  }
  return info;
}

// 删除任务进度
export function deleteTaskProgress(taskId: string): void {
  const progressCache = getProgressCache();
  progressCache.delete(taskId);
}

// 清理超过 10 分钟的过期进度
export function cleanupProgressCache(): void {
  const progressCache = getProgressCache();
  const now = Date.now();
  let cleaned = 0;
  for (const [taskId, info] of progressCache) {
    if (now - info.updatedAt > PROGRESS_EXPIRE_MS) {
      progressCache.delete(taskId);
      cleaned++;
    }
  }
  if (cleaned > 0 || progressCache.size > 0) {
    console.log(`[ProgressCache] 清理: 移除${cleaned}条过期, 剩余${progressCache.size}/${MAX_CACHE_SIZE}条`);
  }
}

// 获取当前缓存大小（诊断用）
export function getProgressCacheSize(): number {
  return getProgressCache().size;
}

// 定时清理（每 5 分钟）
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupProgressCache, 300000);
}
