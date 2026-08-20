/**
 * #838 配置服务端缓存
 * 
 * 从 route.ts 迁移出来的原因：Next.js Route Type 检查 (TS2344)
 * 在 route.ts 中导出非标准 HTTP 方法的变量会导致类型冲突。
 * 
 * 供 route.ts 和管理后台路由使用。
 */

const configCache = new Map<string, { data: any; timestamp: number }>();
const CONFIG_CACHE_TTL = 10 * 1000; // #859 缩短到 10 秒（原 60 秒导致管理员更新模型后首页最多 60 秒内仍显示旧数据）

/** 获取缓存数据（未过期返回数据，过期或不存在返回 null） */
export function getConfigFromCache(key: string): any | null {
  const cached = configCache.get(key);
  if (cached && Date.now() - cached.timestamp < CONFIG_CACHE_TTL) {
    return cached.data;
  }
  return null;
}

/** 写入缓存 */
export function setConfigToCache(key: string, data: any): void {
  configCache.set(key, { data, timestamp: Date.now() });
}

/** 清空所有配置缓存（管理后台更新时调用） */
export function clearConfigServerCache(): void {
  configCache.clear();
}

/**
 * 兼容 #837 旧接口：configServerCache 对象
 * route.ts 中可以用 configServerCache.get() / .set()
 */
export const configServerCache = {
  get: getConfigFromCache,
  set: setConfigToCache,
  clear: clearConfigServerCache,
};
