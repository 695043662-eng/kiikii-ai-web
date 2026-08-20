import { getSupabaseClient } from '@/storage/database/supabase-client';

// ====== #550 全局多密钥轮询机制（微语法方案）======
// api_key 字段支持多密钥微语法格式：
// 格式：每行一个配置，格式为 "Key | 状态 | 备注"
// 状态：1 或留空表示启用，0 表示停用
// 示例：
//   sk-123456 | 1 | 默认便宜分组
//   sk-789abc | 0 | 备用（已停用）
//   sk-def456 | | 测试分组
// 系统将从已启用的密钥中随机抽取一个使用，实现负载均衡
// 支持故障转移：密钥失败时自动尝试其他密钥

// ====== 细粒度熔断机制（密钥+分辨率级别）======
// 当服务商因分辨率级别原因（繁忙/超时/堵塞）拒绝请求时，
// 只熔断该密钥+该分辨率的组合，不影响该密钥的其他分辨率

/** 熔断记录 */
interface ResolutionBan {
  key: string;           // 完整密钥（禁止截取！防止碰撞）
  resolution: string;    // 分辨率（如 1K, 2K, 4K — 与前端按钮 size 一致）
  bannedAt: number;      // 禁用时间戳
  banDuration: number;   // 禁用时长（毫秒）
  error: string;         // 触发禁用的错误信息
}

/** 连续失败记录 */
interface ConsecutiveFailure {
  count: number;         // 连续失败次数
  lastErrorAt: number;   // 上次失败时间戳
  lastError: string;     // 上次失败信息
}

/** 全局熔断 Map，key 格式：完整密钥_分辨率（禁止截取密钥！） */
const resolutionBans = new Map<string, ResolutionBan>();

/** 全局连续失败 Map，key 格式：完整密钥_分辨率 */
const consecutiveFailures = new Map<string, ConsecutiveFailure>();

/** 🛡️ #848 防内存泄漏：硬上限（密钥数 × 分辨率数 不会超过此值） */
const MAX_BAN_ENTRIES = 500;
const MAX_FAILURE_ENTRIES = 500;

/** 🛡️ #848 防内存泄漏：周期清理过期的熔断/失败记录 + 硬上限熔断 */
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    // 清理过期的 resolutionBans
    for (const [key, ban] of resolutionBans.entries()) {
      if (now - ban.bannedAt > ban.banDuration) {
        resolutionBans.delete(key);
      }
    }
    // 硬上限熔断：超过 MAX_BAN_ENTRIES 时淘汰最旧的 20%
    if (resolutionBans.size > MAX_BAN_ENTRIES) {
      const entries = [...resolutionBans.entries()].sort((a, b) => a[1].bannedAt - b[1].bannedAt);
      const evictCount = Math.ceil(entries.length * 0.2);
      for (let i = 0; i < evictCount; i++) {
        resolutionBans.delete(entries[i][0]);
      }
      console.log(`[CircuitBreaker] 🧹 resolutionBans 硬上限淘汰 ${evictCount} 条，剩余 ${resolutionBans.size}`);
    }
    // 清理超过重置窗口的 consecutiveFailures（不再累加的陈旧记录）
    for (const [key, entry] of consecutiveFailures.entries()) {
      if (now - entry.lastErrorAt > FAILURE_RESET_WINDOW) {
        consecutiveFailures.delete(key);
      }
    }
    // 硬上限熔断：超过 MAX_FAILURE_ENTRIES 时淘汰最旧的 20%
    if (consecutiveFailures.size > MAX_FAILURE_ENTRIES) {
      const entries = [...consecutiveFailures.entries()].sort((a, b) => a[1].lastErrorAt - b[1].lastErrorAt);
      const evictCount = Math.ceil(entries.length * 0.2);
      for (let i = 0; i < evictCount; i++) {
        consecutiveFailures.delete(entries[i][0]);
      }
      console.log(`[CircuitBreaker] 🧹 consecutiveFailures 硬上限淘汰 ${evictCount} 条，剩余 ${consecutiveFailures.size}`);
    }
  }, 30 * 60 * 1000);  // 每 30 分钟清理一次
}

/**
 * 🔧 通道级熔断冷却时长：30 秒（防雪崩，仅用于快速跳过故障通道）
 * 注意：这是通道级别的短暂冷却，不影响用户账号
 * 用户级别的长期封禁由 ban-check.ts 的 failed_attempts 逻辑控制
 */
const DEFAULT_BAN_DURATION = 30 * 1000;  // 30000 ms（30秒）

/** 连续失败触发通道冷却的阈值：5 次连续失败触发短暂冷却 */
const BAN_THRESHOLD = 5;

/** 连续失败重置窗口：10 分钟（超过此时间的前次失败不计入连续） */
const FAILURE_RESET_WINDOW = 10 * 60 * 1000;

/**
 * 检查某密钥+某分辨率是否被熔断
 * @param key 完整密钥
 * @param resolution 分辨率（如 1K, 2K, 4K）
 * @returns 是否被熔断
 */
export function isResolutionBanned(key: string, resolution: string): boolean {
  const normalizedResolution = resolution.toUpperCase();
  const banKey = `${key}_${normalizedResolution}`;
  const ban = resolutionBans.get(banKey);
  if (!ban) return false;

  // 检查是否已过期
  if (Date.now() - ban.bannedAt > ban.banDuration) {
    resolutionBans.delete(banKey);
    // 过期时同时清理对应的连续失败记录
    consecutiveFailures.delete(banKey);
    return false;
  }

  return true;
}

/**
 * 记录服务提供商错误（累加连续失败计数）
 * 当连续失败次数达到阈值时，触发熔断
 * @param key 完整密钥（禁止截取！）
 * @param resolution 分辨率（如 1K, 2K, 4K）
 * @param error 错误信息
 * @returns 是否触发了熔断
 */
export function recordServiceProviderError(key: string, resolution: string, error: string): boolean {
  // 标准化分辨率格式：统一转大写（与前端按钮 size 格式一致）
  const normalizedResolution = resolution.toUpperCase();
  const actualBanKey = `${key}_${normalizedResolution}`;
  const now = Date.now();
  const existing = consecutiveFailures.get(actualBanKey);
  
  let count: number;
  if (existing && (now - existing.lastErrorAt) < FAILURE_RESET_WINDOW) {
    // 10 分钟内连续失败，累加
    count = existing.count + 1;
    console.log(`🛑 [DEBUG] 连续报错 (${count}/${BAN_THRESHOLD})，密钥: ${key.substring(0, 10)}...，分辨率: ${normalizedResolution}，错误: ${error}`);
  } else {
    // 超过 10 分钟或首次失败，重置为 1
    count = 1;
    console.log(`🛑 [DEBUG] 首次报错 (1/${BAN_THRESHOLD})，密钥: ${key.substring(0, 10)}...，分辨率: ${normalizedResolution}，错误: ${error}`);
  }
  
  // 更新连续失败记录
  consecutiveFailures.set(actualBanKey, {
    count,
    lastErrorAt: now,
    lastError: error,
  });
  
  // 检查是否达到熔断阈值
  if (count >= BAN_THRESHOLD) {
    // 触发熔断！清空计数器，移入 resolutionBans
    consecutiveFailures.delete(actualBanKey);
    banResolution(key, normalizedResolution, error);
    return true;
  }
  
  return false;
}

/**
 * 请求成功时清零连续失败计数（自愈逻辑）
 * 只要成功一次，之前的连续失败一笔勾销
 * @param key 完整密钥
 * @param resolution 分辨率
 */
export function clearConsecutiveFailures(key: string, resolution: string): void {
  const normalizedResolution = resolution.toUpperCase();
  const banKey = `${key}_${normalizedResolution}`;
  if (consecutiveFailures.has(banKey)) {
    console.log(`[CircuitBreaker] ✅ 请求成功，清零连续失败: ${key.substring(0, 10)}..._${normalizedResolution}`);
    consecutiveFailures.delete(banKey);
  }
}

/**
 * 熔断某密钥+某分辨率的组合
 * @param key 完整密钥（禁止截取！）
 * @param resolution 分辨率
 * @param error 触发熔断的错误信息
 * @param duration 熔断时长（毫秒），默认 30 秒（通道级冷却）
 */
export function banResolution(key: string, resolution: string, error: string, duration: number = DEFAULT_BAN_DURATION): void {
  const normalizedResolution = resolution.toUpperCase();
  const banKey = `${key}_${normalizedResolution}`;
  resolutionBans.set(banKey, {
    key,
    resolution: normalizedResolution,
    bannedAt: Date.now(),
    banDuration: duration,
    error,
  });
  const remainingSec = Math.round(duration / 1000);
  console.log(`🛑 [DEBUG] 触发通道冷却！封禁的分辨率键名为: ${normalizedResolution}，时长 ${remainingSec} 秒，原因: ${error}`);
  console.log(`[CircuitBreaker] ⚡ 通道冷却 ${normalizedResolution}，时长 ${remainingSec} 秒，原因: ${error}`);
}

/**
 * 获取所有当前被熔断的分辨率列表（用于探针 API）
 * 按分辨率聚合，返回所有密钥都被熔断的分辨率
 * @param rawKeyString 原始密钥字符串（用于判断是否"全军覆没"）
 * @returns 全军覆没的分辨率列表
 */
export function getGloballyBannedResolutions(rawKeyString: string | null | undefined): string[] {
  const allKeys = getAllAvailableApiKeys(rawKeyString);
  if (allKeys.length === 0) return [];

  // 收集所有被熔断的分辨率
  const bannedResolutions = new Set<string>();
  for (const ban of resolutionBans.values()) {
    // 只统计未过期的熔断
    if (Date.now() - ban.bannedAt <= ban.banDuration) {
      bannedResolutions.add(ban.resolution);
    }
  }

  // 对每个分辨率，检查是否所有密钥都被熔断（全军覆没）
  const globallyBanned: string[] = [];
  for (const resolution of bannedResolutions) {
    const hasAvailableKey = allKeys.some(key => !isResolutionBanned(key, resolution));
    if (!hasAvailableKey) {
      globallyBanned.push(resolution);
    }
  }

  return globallyBanned;
}

/**
 * 全局一键解除所有熔断（急救开关）
 * 清空 resolutionBans 和 consecutiveFailures 两个 Map
 * @returns 清理的熔断记录数和失败计数记录数
 */
export function clearAllCircuitBreakers(): { bansCleared: number; failuresCleared: number } {
  const bansCleared = resolutionBans.size;
  const failuresCleared = consecutiveFailures.size;
  resolutionBans.clear();
  consecutiveFailures.clear();
  console.log(`🚑 [CircuitBreaker] 全局熔断已重置！清除了 ${bansCleared} 条熔断记录和 ${failuresCleared} 条失败计数`);
  return { bansCleared, failuresCleared };
}

/**
 * 获取所有当前活跃的熔断记录（含剩余倒计时）
 * 用于管理后台展示
 * @returns 熔断详情列表
 */
export function getAllActiveBans(): Array<{
  keyPrefix: string;      // 密钥前缀（脱敏，如 sk-1234...）
  resolution: string;     // 分辨率
  bannedAt: number;       // 熔断开始时间戳
  banDuration: number;    // 熔断时长（毫秒）
  remainingMs: number;    // 剩余时间（毫秒）
  error: string;          // 触发原因
}> {
  const now = Date.now();
  const result: Array<{
    keyPrefix: string;
    resolution: string;
    bannedAt: number;
    banDuration: number;
    remainingMs: number;
    error: string;
  }> = [];

  for (const ban of resolutionBans.values()) {
    const elapsed = now - ban.bannedAt;
    const remaining = ban.banDuration - elapsed;
    if (remaining > 0) {
      result.push({
        keyPrefix: ban.key.substring(0, 8) + '...',
        resolution: ban.resolution,
        bannedAt: ban.bannedAt,
        banDuration: ban.banDuration,
        remainingMs: remaining,
        error: ban.error,
      });
    }
  }

  return result;
}

/**
 * 从所有可用密钥中，找到第一个该分辨率未被熔断的密钥
 * @param rawKeyString 原始密钥字符串
 * @param resolution 当前请求的分辨率
 * @returns 可用的密钥，或空字符串
 */
export function getAvailableApiKeyForResolution(rawKeyString: string | null | undefined, resolution: string): string {
  const activeKeys = getAllAvailableApiKeys(rawKeyString);
  if (activeKeys.length === 0) return '';

  // 按顺序找到第一个该分辨率未被熔断的密钥
  for (const key of activeKeys) {
    if (!isResolutionBanned(key, resolution)) {
      return key;
    }
    console.log(`[CircuitBreaker] 跳过已熔断组合: ${key.substring(0, 10)}..._${resolution}`);
  }

  // 所有密钥都被熔断
  return '';
}

/**
 * 检查某分辨率是否对所有密钥都被熔断（全军覆没）
 * @param rawKeyString 原始密钥字符串
 * @param resolution 分辨率
 * @returns 是否全军覆没
 */
export function isResolutionGloballyBanned(rawKeyString: string | null | undefined, resolution: string): boolean {
  const availableKey = getAvailableApiKeyForResolution(rawKeyString, resolution);
  return availableKey === '';
}

/**
 * 解析密钥字符串，返回所有已启用的密钥数组
 * @param rawKeyString 原始密钥字符串（可能包含多行）
 * @returns 所有已启用的密钥数组
 */
export function getAllAvailableApiKeys(rawKeyString: string | null | undefined): string[] {
  if (!rawKeyString) return [];
  
  const lines = rawKeyString.split('\n');
  const activeKeys: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    
    const parts = line.split('|').map(p => p.trim());
    const key = parts[0];
    const status = parts[1];
    
    if (!key) continue;
    if (status === '0' || status === 'false') continue;
    
    activeKeys.push(key);
  }

  return activeKeys;
}

/**
 * 全局多密钥微语法解析与轮询器
 * 格式要求：每一行代表一个配置，格式为 "Key | 状态 | 备注"
 * @param rawKeyString 原始密钥字符串（可能包含多行）
 * @returns 随机选择的一个已启用的密钥
 */
export function getAvailableApiKey(rawKeyString: string | null | undefined): string {
  const activeKeys = getAllAvailableApiKeys(rawKeyString);
  if (activeKeys.length === 0) return '';
  
  // 从已启用的密钥池中随机抽一个
  const randomIndex = Math.floor(Math.random() * activeKeys.length);
  return activeKeys[randomIndex];
}

/**
 * 判断错误是否为服务商级别错误（应触发熔断）
 * 服务商错误：繁忙、超时、堵塞、限流等 — 换密钥或降分辨率可能有用
 * @param error 错误对象或错误信息
 * @returns 是否为服务商级别错误
 */
export function isServiceProviderError(error: any): boolean {
  if (!error) return false;
  
  const errorStr = typeof error === 'string' 
    ? error.toLowerCase() 
    : (error.message || error.error || JSON.stringify(error)).toLowerCase();
  
  // 服务商级别错误关键词
  const providerKeywords = [
    'quota',           // 配额用完
    'exceed',          // 超出限制
    'rate limit',      // 限流
    'too many',        // 请求过多
    'throttl',         // 节流
    'capacity',        // 容量不足
    'overload',        // 过载
    'unavailable',     // 服务不可用
    'invalid api key', // 密钥无效
    'unauthorized',    // 未授权
    'authentication',  // 认证失败
    'channel',         // 渠道问题
    '渠道',            // 中文渠道
    '堵塞',            // 中文堵塞
    '余额',            // 余额不足
    'insufficient',    // 不足
    '1001',            // T8Star 错误码
    '1002',            // T8Star 错误码
    'system error',    // 系统错误（可能是渠道问题）
    '系统繁忙',         // T8Star 渠道繁忙
    '请稍后再试',       // T8Star 繁忙提示
    '502',             // Bad Gateway
    '503',             // Service Unavailable
    '504',             // Gateway Timeout
    'bad response',    // 响应异常
    'currently busy',  // 模型繁忙（Veo/Sora）
    'model is busy',   // 模型繁忙
    'busy',            // 繁忙
    '负载',            // 中文负载
    'timeout',         // 超时
    '超时',            // 中文超时
    'the operation was timeout', // T8Star 超时完整信息
  ];
  
  // 排除内容级别错误（换密钥/降分辨率也没用）
  const contentKeywords = [
    'moderation',      // 内容审核
    '违规',            // 中文违规
    'inappropriate',   // 不适当内容
    'content policy',  // 内容政策
    'safety',          // 安全过滤
    'blocked',         // 被阻止
    'filtered',        // 被过滤
    'nsfw',            // 成人内容
  ];
  
  // 先检查是否是内容级别错误
  for (const keyword of contentKeywords) {
    if (errorStr.includes(keyword)) {
      return false;
    }
  }
  
  // 再检查是否是服务商级别错误
  for (const keyword of providerKeywords) {
    if (errorStr.includes(keyword)) {
      return true;
    }
  }
  
  return false;
}

/**
 * 判断错误是否应该触发密钥切换（故障转移）
 * 保持向后兼容，内部复用 isServiceProviderError
 * @param error 错误对象或错误信息
 * @returns 是否应该切换密钥重试
 */
export function shouldSwitchApiKey(error: any): boolean {
  return isServiceProviderError(error);
}

/**
 * 解析密钥字符串，返回所有密钥的信息（用于前端显示）
 * @param rawKeyString 原始密钥字符串
 * @returns 密钥信息数组
 */
export function parseApiKeys(rawKeyString: string | null | undefined): Array<{ key: string; status: boolean; note: string }> {
  if (!rawKeyString) return [];
  
  const lines = rawKeyString.split('\n');
  const result: Array<{ key: string; status: boolean; note: string }> = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    
    const parts = line.split('|').map(p => p.trim());
    const key = parts[0];
    const statusStr = parts[1];
    const note = parts[2] || '';
    
    if (!key) continue;

    // 状态判断：默认启用，只有明确为 '0' 或 'false' 才停用
    const isActive = !(statusStr === '0' || statusStr === 'false');
    
    result.push({ key, status: isActive, note });
  }

  return result;
}

// ====== #455 GPT-Image-2 像素映射字典 ======
// #492 修正分辨率映射，使用行业标准像素值

// 普通版仅支持 1K
// #524 修复：所有像素值必须符合 GPT 官方限制（16倍数、总像素 655360~8294400、比例≤3:1）
const GPT_IMAGE_2_1K_MAP: Record<string, string> = {
  '1:1': '1024x1024', '4:3': '1024x768', '3:4': '768x1024',
  '5:4': '1120x896', '4:5': '896x1120',   // 修复：819不是16的倍数
  '16:9': '1280x720', '9:16': '720x1280', '3:2': '1536x1024', '2:3': '1024x1536',
  '21:9': '1520x656', '9:21': '656x1536', // 修复：440不是16的倍数，总像素不足
  '3:1': '1440x480', '1:3': '480x1440',   // 修复：344不是16的倍数，总像素不足（与VIP版一致）
  '2:1': '1408x704', '1:2': '704x1408'    // 修复：总像素不足
};

// VIP版支持全量画质
// #521 GPT 官方限制：
// - 最长边 ≤ 3840px
// - 宽高都必须是16的倍数
// - 长短边比例不超过 3:1
// - 总像素在 655,360 到 8,294,400 之间
const GPT_IMAGE_2_VIP_MAP: Record<string, Record<string, string>> = {
  '1:1':  { '1K': '1024x1024', '2K': '2048x2048', '4K': '2880x2880' },   // 1.0M / 4.2M / 8.3M
  '4:3':  { '1K': '1024x768',  '2K': '2048x1536', '4K': '2880x2160' },   // 786K / 3.1M / 6.2M
  '3:4':  { '1K': '768x1024',  '2K': '1536x2048', '4K': '2160x2880' },   // 786K / 3.1M / 6.2M
  '5:4':  { '1K': '1024x816',  '2K': '2048x1632', '4K': '2880x2304' },  // 836K / 3.3M / 6.6M
  '4:5':  { '1K': '816x1024',  '2K': '1632x2048', '4K': '2304x2880' },  // 836K / 3.3M / 6.6M
  '16:9': { '1K': '1280x720',  '2K': '2560x1440', '4K': '3840x2160' },  // 922K / 3.7M / 8.3M ✅
  '9:16': { '1K': '720x1280',  '2K': '1440x2560', '4K': '2160x3840' },  // 922K / 3.7M / 8.3M ✅
  '3:2':  { '1K': '1536x1024', '2K': '2048x1360', '4K': '2880x1920' },  // 1.6M / 2.8M / 5.5M
  '2:3':  { '1K': '1024x1536', '2K': '1360x2048', '4K': '1920x2880' },  // 1.6M / 2.8M / 5.5M
  '21:9': { '1K': '1344x576',  '2K': '2048x864',  '4K': '3840x1616' }, // 774K / 1.8M / 6.2M (修复1K像素不足)
  '9:21': { '1K': '576x1344',  '2K': '864x2048',  '4K': '1616x3840' }, // 774K / 1.8M / 6.2M (修复1K像素不足)
  '2:1':  { '1K': '1152x576',  '2K': '2048x1024', '4K': '3840x1920' }, // 663K / 2.1M / 7.4M (修复1K像素下限)
  '1:2':  { '1K': '576x1152',  '2K': '1024x2048', '4K': '1920x3840' },  // 663K / 2.1M / 7.4M
  '3:1':  { '1K': '1440x480',  '2K': '2880x960',  '4K': '3840x1280' }, // 691K / 2.8M / 4.9M (正好等于3:1限制)
  '1:3':  { '1K': '480x1440',  '2K': '960x2880',  '4K': '1280x3840' }  // 691K / 2.8M / 4.9M
};

// ====== 通用 API 配置类型 ======

// 模型配置内存缓存（消除并发时的数据库排队瓶颈）
// 缓存 Promise 而非结果：5个并发请求共享同一个 DB 查询 Promise，只触发1次查询
const configCache = new Map<string, { promise: Promise<ApiConfigFull | null>; timestamp: number }>();
const CONFIG_CACHE_TTL = 60 * 1000; // 缓存1分钟

export interface ApiConfigFull {
  // 接口配置
  configId: number;
  configName: string;
  serviceType: string;
  
  // API 配置
  apiEndpoint: string;           // 最终端点（优先模型自定义 > 接口默认）
  requestMethod: 'POST' | 'GET' | 'PUT';
  requestHeaders: Record<string, string>;   // 请求头模板
  requestBodyTemplate: Record<string, any>; // 请求体模板
  apiKey: string;                // 当前使用的密钥（随机选择）
  apiKeys: string[];             // 所有可用密钥数组（用于故障转移）
  rawApiKeyString: string;       // 原始密钥字符串（用于重新解析）
  
  // 模型配置
  modelId: string;
  modelName: string;
  modelApiEndpoint: string | null;  // 模型自定义端点
  parameters: Record<string, any>;
  creditsBase: number;
  
  // 响应解析配置
  responseParser?: {
    taskIdPath?: string;         // 从响应中提取任务ID的路径
    statusPath?: string;         // 状态路径
    imageUrlPath?: string;       // 图片URL路径
    errorPath?: string;          // 错误信息路径
    textPath?: string;           // 文本内容路径（LLM 模型）
  };
}

/**
 * 根据模型 ID 获取完整的 API 配置（通用架构）
 * 从 api_configs 和 api_models 表读取配置
 */
export async function getModelAPIConfigFull(modelId: string): Promise<ApiConfigFull | null> {
  // 1. 先查缓存 Promise（微秒级，并发请求共享同一个 Promise）
  const cached = configCache.get(modelId);
  if (cached && (Date.now() - cached.timestamp) < CONFIG_CACHE_TTL) {
    return cached.promise; // 直接返回同一个 Promise，5个请求只触发1次DB查询
  }

  // 2. 创建查询 Promise 并缓存（后续并发请求会命中缓存，共享这个 Promise）
  const queryPromise = (async () => {
    try {
      // 🔧 修复：使用 Service Role 客户端绕过 RLS 策略
      const supabase = getSupabaseClient(undefined, true);
      
      // 从 api_models 表查找模型
      const { data: model, error: modelError } = await supabase
        .from('api_models')
        .select(`
          id,
          model_id,
          model_name,
          description,
          api_endpoint,
          parameters,
          credits_base,
          config_id,
          is_active
        `)
        .eq('model_id', modelId)
        .eq('is_active', true)
        .single();
      
      if (modelError || !model) {
        console.log(`[API Config] 未找到模型 ${modelId}`);
        return null;
      }
      
      // 从 api_configs 表查找接口配置
      const { data: config, error: configError } = await supabase
        .from('api_configs')
        .select('*')
        .eq('id', model.config_id)
        .eq('is_active', true)
        .single();
      
      if (configError || !config) {
        console.log(`[API Config] 未找到接口配置 config_id=${model.config_id}`);
        return null;
      }
      
      // 构建完整配置
      let finalApiEndpoint = model.api_endpoint || config.api_endpoint;

      // 处理相对路径
      if (finalApiEndpoint && finalApiEndpoint.startsWith('/')) {
        const isGemini = model.model_id.includes('gemini') || model.api_endpoint?.includes('gemini');
        if (isGemini) {
          finalApiEndpoint = `${config.api_endpoint}${finalApiEndpoint}`;
          console.log(`[API Config] 检测到 Gemini 相对路径，自动拼接完整 URL: ${finalApiEndpoint}`);
        } else {
          console.warn(`[API Config] 检测到相对路径但不是 Gemini: ${finalApiEndpoint}`);
        }
      }

      // 🔍 诊断日志：检查 request_body_template 的实际值
      console.log('[API Config] 诊断 request_body_template:', {
        type: typeof config.request_body_template,
        isArray: Array.isArray(config.request_body_template),
        keys: config.request_body_template ? Object.keys(config.request_body_template) : [],
        raw: JSON.stringify(config.request_body_template).substring(0, 500),
      });

      // 解析所有可用密钥
      const rawApiKeyString = config.api_key || '';
      const apiKeys = getAllAvailableApiKeys(rawApiKeyString);
      // 按顺序使用第一个密钥（故障转移时按顺序尝试其他密钥）
      const apiKey = apiKeys.length > 0 ? apiKeys[0] : '';

      const result: ApiConfigFull = {
        configId: config.id,
        configName: config.name,
        serviceType: config.service_type,

        apiEndpoint: finalApiEndpoint,
        requestMethod: config.request_method || 'POST',
        requestHeaders: config.request_headers || {},
        requestBodyTemplate: config.request_body_template || {},
        apiKey,
        apiKeys,
        rawApiKeyString,

        modelId: model.model_id,
        modelName: model.model_name,
      modelApiEndpoint: model.api_endpoint,
      parameters: model.parameters || {},
      creditsBase: model.credits_base || 10,

      responseParser: config.response_parser || undefined,
    };

    console.log(`[API Config] 模型 ${modelId} 配置已加载，可用密钥数量: ${apiKeys.length}，当前使用第1个密钥`);
    return result;
    
  } catch (error) {
    console.error(`[API Config] 获取模型 ${modelId} 配置失败:`, error);
    // 出错时移除缓存，下次重试还能查数据库
    configCache.delete(modelId);
    return null;
  }
  })();

  // 缓存 Promise（所有并发请求共享这个 Promise）
  configCache.set(modelId, { promise: queryPromise, timestamp: Date.now() });
  return queryPromise;
}

/**
 * 模板变量替换函数
 * 支持字符串中的 ${变量名} 占位符
 * 特殊处理：当整个字符串就是一个占位符且变量是数组/对象时，直接返回原值（保持类型）
 */
export function replaceTemplateVariables(
  template: string,
  variables: Record<string, any>
): any {  // 返回类型改为 any，因为可能返回数组/对象
  // 检查是否整个字符串就是一个占位符 ${xxx}
  const exactMatch = template.match(/^\$\{(\w+)\}$/);
  if (exactMatch) {
    const varName = exactMatch[1];
    if (varName in variables) {
      const value = variables[varName];
      // #449 修复：undefined/null 应该返回 undefined，让调用方删除该字段
      if (value === undefined || value === null) {
        return undefined;
      }
      // 如果是数组或对象，直接返回原值（保持类型）
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        return value;
      }
      return String(value);
    }
    return template; // 保留未匹配的占位符
  }

  // 非完全匹配的情况，进行字符串内替换
  return template.replace(/\$\{(\w+)\}/g, (match, varName) => {
    if (varName in variables) {
      const value = variables[varName];
      // #449 修复：undefined/null 不应该变成字符串 "undefined"/"null"
      if (value === undefined || value === null) {
        return ''; // 返回空字符串，避免 "undefined" 污染
      }
      // 如果是数组，保持 JSON 格式
      if (Array.isArray(value)) {
        return JSON.stringify(value);
      }
      // 如果是对象，保持 JSON 格式
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    }
    return match; // 保留未匹配的占位符
  });
}

/**
 * 深度替换对象中的所有模板变量
 * 支持嵌套对象和数组
 * #449 修复：当值为 undefined 时删除该字段，避免 "undefined" 字符串污染
 */
export function deepReplaceVariables(
  obj: any,
  variables: Record<string, any>
): any {
  if (typeof obj === 'string') {
    return replaceTemplateVariables(obj, variables);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deepReplaceVariables(item, variables));
  }
  
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      const replacedValue = deepReplaceVariables(value, variables);
      // #449 修复：如果值为 undefined，删除该字段
      if (replacedValue !== undefined) {
        result[key] = replacedValue;
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * 构建实际请求
 * 根据配置模板和变量生成最终的请求头和请求体
 */
export function buildRequest(
  config: ApiConfigFull,
  variables: Record<string, any>,
  overrideApiKey?: string  // 可选：覆盖 config.apiKey
): {
  headers: Record<string, string>;
  body: Record<string, any>;
} {
  // 🔧 #296 修复：使用 terminalModel 映射终端 API 支持的模型名
  // 如果 parameters 中有 terminalModel，优先使用它作为发送给终端的模型名
  const terminalModel = config.parameters?.terminalModel || config.modelId;
  
  // 使用覆盖密钥或配置密钥
  const effectiveApiKey = overrideApiKey || config.apiKey;
  
  // 添加 apiKey 到变量
  const allVariables: Record<string, any> = {
    ...variables,
    apiKey: effectiveApiKey,
    model: terminalModel,  // 使用映射后的模型名
  };

  // 🔧 #455 GPT-Image-2 像素映射：将 aspectRatio 转换为具体像素
  // 🔧 #519 T8Star GPT 模型使用 VIP 映射：用原始 modelId 判断，而非 terminalModel
  const originalModelId = config.modelId;  // 原始模型 ID（如 t8star.gpt-image-2）
  const reqRatio = allVariables.aspectRatio || '1:1';
  const reqQuality = allVariables.resolution || '1K';

  // ⚠️ 防扣费铁律：测试模式跳过像素映射，直接使用畸形参数触发 400
  // 如果 variables 中包含 _skipPixelMapping 标志，直接使用原始值不做映射
  const isTestMode = !!variables._skipPixelMapping;
  let finalApiPixels = '1024x1024'; // 终极保底默认值

  if (isTestMode) {
    // 测试模式：直接使用畸形参数，不做任何映射
    finalApiPixels = reqRatio;
    console.log('[buildRequest] ⚠️ 测试模式：跳过像素映射，使用原始参数:', reqRatio);
  } else if (reqRatio === 'auto') {
    // 🔧 #auto GRS 新接口支持 aspectRatio=auto，直接透传
    // T8Star API 使用 size 参数（像素值），auto 需映射到 1024x1024
    const isGRSModel = originalModelId === 'gpt-image-2' || originalModelId === 'gpt-image-2-vip';
    if (isGRSModel) {
      finalApiPixels = 'auto'; // GRS 直接传 auto
      console.log('[buildRequest]', originalModelId, 'auto比例直接透传');
    } else {
      finalApiPixels = '1024x1024'; // T8Star auto 映射到默认像素
      console.log('[buildRequest]', originalModelId, 'auto比例映射到默认像素:', finalApiPixels);
    }
  } else if (originalModelId === 'gpt-image-2') {
    // 🔴 GRS 普通款：强制无视前端画质，全部降维到 1K
    finalApiPixels = GPT_IMAGE_2_1K_MAP[reqRatio] || '1024x1024';
    console.log('[buildRequest] gpt-image-2 (GRS普通版) 像素映射:', reqRatio, '→', finalApiPixels);
  } else if (originalModelId === 'gpt-image-2-vip' || originalModelId === 't8star.gpt-image-2') {
    // 🟢 VIP款 / T8Star：支持全量画质，精准查表
    const ratioMap = GPT_IMAGE_2_VIP_MAP[reqRatio];
    if (ratioMap) {
      finalApiPixels = ratioMap[reqQuality] || ratioMap['1K'];
    }
    console.log('[buildRequest]', originalModelId, '像素映射:', reqRatio, reqQuality, '→', finalApiPixels);
  } else {
    // 其他模型：保持原样
    finalApiPixels = reqRatio;
  }

  // 🔧 #519 将转换后的值同时赋给 size 和 aspectRatio
  // 不同 API 使用不同的字段名：GRS 用 aspectRatio（比例/auto），T8Star 用 size（像素值）
  allVariables.aspectRatio = finalApiPixels;
  allVariables.size = finalApiPixels;

  // 🔧 #522 T8Star GPT 模型支持 quality 参数
  // 如果 variables 中有 quality，确保传递给模板
  // 默认值在 route.ts 中设置为 'auto'
  // ⚠️ 测试模式：不覆盖 quality，保持畸形参数
  if (!isTestMode && allVariables.quality === undefined) {
    allVariables.quality = 'auto';
  }

  // 🔧 #528 T8Star GPT-image-2 在 quality=auto/medium 时不支持 3:1/1:3 比例
  // API 会静默降级为 2:1，因此当比例是 3:1 或 1:3 时强制使用 'high'
  const isExtremeRatio = reqRatio === '3:1' || reqRatio === '1:3';
  const isT8StarGptImage2 = config.modelId === 't8star.gpt-image-2';
  if (isT8StarGptImage2 && isExtremeRatio && (allVariables.quality === 'auto' || allVariables.quality === 'medium')) {
    console.log(`[buildRequest] #528 3:1/1:3比例强制quality=high (原值: ${allVariables.quality})`);
    allVariables.quality = 'high';
  }

  // 深度替换请求头中的变量
  let headers = deepReplaceVariables(config.requestHeaders, allVariables) as Record<string, string>;

  // 检测是否是 Gemini 服务商
  const isGemini = config.apiEndpoint.includes('gemini') ||
                    config.apiEndpoint.includes('google') ||
                    config.modelId.includes('gemini');

  // 如果是 Gemini 且使用官方 Google API（googleapis.com），自动使用正确的请求头格式
  if (isGemini && config.apiEndpoint.includes('googleapis.com')) {
    console.log('[buildRequest] 检测到 Gemini 官方 API，自动使用 x-goog-api-key 请求头');
    // 删除 Authorization header（如果存在）
    delete headers['Authorization'];
    // 添加 x-goog-api-key header
    headers['x-goog-api-key'] = effectiveApiKey;
  } else if (isGemini && !config.apiEndpoint.includes('googleapis.com')) {
    console.log('[buildRequest] 检测到 Gemini 代理服务，使用默认请求头格式');
  }

  // 处理请求体
  let body: any;
  
  if (isGemini && variables.urls && variables.urls.length > 0) {
    // Gemini 有参考图时，特殊处理
    console.log('[buildRequest] 检测到 Gemini 参考图，动态构建 parts 数组');
    
    // 构建 parts 数组
    const parts: any[] = [];
    
    // 添加图片（使用 inlineData 支持 base64 和 HTTP URL）
    for (const url of variables.urls) {
      if (url.startsWith('data:')) {
        // base64 data URL 格式: data:image/png;base64,xxx
        const matches = url.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          parts.push({
            inlineData: {
              mimeType: matches[1],
              data: matches[2]
            }
          });
        }
      } else {
        // HTTP URL - 需要下载并转成 base64（异步处理在调用方完成）
        // 这里暂时跳过，让 GRS AI 处理
        console.warn('[buildRequest] Gemini 不支持 HTTP URL 参考图，需要先转成 base64:', url.substring(0, 50));
      }
    }
    
    // 添加文本提示
    parts.push({
      text: variables.prompt
    });
    
    // 构建完整的 Gemini 请求体
    body = {
      contents: [{
        role: 'user',
        parts: parts
      }],
      generationConfig: {
        temperature: 1,
        maxOutputTokens: 32768,
        responseModalities: ['TEXT', 'IMAGE'],
        topP: 0.95,
        imageConfig: {
          aspectRatio: variables.aspectRatio,
          imageSize: variables.imageSize || variables.resolution,
          imageOutputOptions: {
            mimeType: 'image/png'
          },
          personGeneration: 'ALLOW_ALL'
        }
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' }
      ]
    };
  } else {
    // 默认处理（GRS AI 或 Gemini 无参考图）
    console.log('[buildRequest] deepReplaceVariables 诊断 - allVariables.quality:', allVariables.quality, '| template keys:', Object.keys(config.requestBodyTemplate));
    body = deepReplaceVariables(config.requestBodyTemplate, allVariables);
    console.log('[buildRequest] deepReplaceVariables 结果 - body.quality:', body?.quality, '| body keys:', Object.keys(body || {}));
  }

  // 特殊处理：确保 urls 字段始终是数组（修复 JSON unmarshal 错误）
  if ('urls' in body && !Array.isArray(body.urls)) {
    console.log('[buildRequest] 修复 urls 字段类型:', { type: typeof body.urls, value: body.urls });
    body.urls = Array.isArray(variables.urls) ? variables.urls : Array.isArray(variables.referenceImages) ? variables.referenceImages : [];
  }


  // 确保 Content-Type 存在
  if (!headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return { headers, body };
}
