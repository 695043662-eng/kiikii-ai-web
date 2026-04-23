/**
 * 安全存储工具类
 * 
 * 功能：
 * 1. 静默容灾：捕获 QuotaExceededError，不阻塞主业务流程
 * 2. 统一日志：所有存储错误统一输出警告日志
 * 3. 返回值：成功返回 true，失败返回 false（调用方可据此决定是否降级）
 */

/**
 * 安全写入 localStorage
 * @param key 存储键名
 * @param value 存储值（字符串）
 * @returns 是否写入成功
 */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if (error instanceof DOMException) {
      // QuotaExceededError - 存储空间已满
      if (error.name === 'QuotaExceededError' || error.code === 22) {
        console.warn(`[SafeStorage] localStorage 已满，跳过缓存: ${key}`);
        return false;
      }
    }
    // 其他错误也静默处理，但打印警告
    console.warn(`[SafeStorage] localStorage 写入失败: ${key}`, error);
    return false;
  }
}

/**
 * 安全读取 localStorage
 * @param key 存储键名
 * @param defaultValue 默认值（读取失败时返回）
 * @returns 存储值或默认值
 */
export function safeGetItem<T = string>(key: string, defaultValue?: T): T | null {
  try {
    const value = localStorage.getItem(key);
    if (value === null) {
      return defaultValue ?? null;
    }
    // 如果默认值是对象，尝试 JSON 解析
    if (typeof defaultValue === 'object' && defaultValue !== null) {
      try {
        return JSON.parse(value) as T;
      } catch {
        return defaultValue;
      }
    }
    return value as unknown as T;
  } catch (error) {
    console.warn(`[SafeStorage] localStorage 读取失败: ${key}`, error);
    return defaultValue ?? null;
  }
}

/**
 * 安全删除 localStorage
 * @param key 存储键名
 * @returns 是否删除成功
 */
export function safeRemoveItem(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`[SafeStorage] localStorage 删除失败: ${key}`, error);
    return false;
  }
}

/**
 * 安全清空 localStorage（保留白名单中的 key）
 * @param keepKeys 保留的 key 白名单
 * @returns 是否清空成功
 */
export function safeClear(keepKeys: string[] = []): boolean {
  try {
    const allKeys = Object.keys(localStorage);
    for (const key of allKeys) {
      if (!keepKeys.includes(key)) {
        localStorage.removeItem(key);
      }
    }
    return true;
  } catch (error) {
    console.warn('[SafeStorage] localStorage 清空失败', error);
    return false;
  }
}

/**
 * 获取 localStorage 使用情况
 * @returns { used: 已使用字节数, quota: 总配额字节数, percentage: 使用百分比 }
 */
export function getStorageUsage(): { used: number; quota: number; percentage: number } {
  try {
    let used = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key) || '';
        used += key.length + value.length;
      }
    }
    // localStorage 通常限制 5MB
    const quota = 5 * 1024 * 1024; // 5MB in bytes
    const percentage = Math.round((used / quota) * 100);
    return { used, quota, percentage };
  } catch {
    return { used: 0, quota: 5 * 1024 * 1024, percentage: 0 };
  }
}

/**
 * 检查 localStorage 是否即将满（超过 80%）
 * @returns 是否即将满
 */
export function isStorageNearFull(): boolean {
  const { percentage } = getStorageUsage();
  return percentage > 80;
}

/**
 * 清理旧的历史记录（当存储快满时调用）
 * @param maxRecords 最大保留记录数
 */
export function cleanupOldRecords(maxRecords: number = 50): void {
  try {
    const key = 'generationRecords_v2';
    const raw = localStorage.getItem(key);
    if (!raw) return;
    
    const records = JSON.parse(raw);
    if (Array.isArray(records) && records.length > maxRecords) {
      const trimmedRecords = records.slice(0, maxRecords);
      safeSetItem(key, JSON.stringify(trimmedRecords));
      console.log(`[SafeStorage] 已清理旧记录，保留最近 ${maxRecords} 条`);
    }
  } catch (error) {
    console.warn('[SafeStorage] 清理旧记录失败', error);
  }
}
