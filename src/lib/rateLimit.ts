/**
 * 请求限流和熔断机制
 */

// 限流配置
interface RateLimitConfig {
  maxRequests: number;     // 最大请求数
  windowMs: number;        // 时间窗口（毫秒）
}

// 熔断器状态
type CircuitState = 'closed' | 'open' | 'half-open';

// 熔断器配置
interface CircuitBreakerConfig {
  failureThreshold: number;   // 失败阈值
  successThreshold: number;   // 成功阈值（半开状态）
  timeoutMs: number;          // 熔断超时时间（毫秒）
  monitoringPeriodMs: number; // 监控周期（毫秒）
}

// IP 限流存储（内存）
const ipRateLimitStore = new Map<string, { count: number; resetTime: number }>();

// 用户限流存储（内存）
const userRateLimitStore = new Map<string, { count: number; resetTime: number }>();

// 熔断器状态存储
const circuitBreakers = new Map<string, {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}>();

/**
 * 检查 IP 限流
 * @param ip IP 地址
 * @param config 限流配置
 * @returns 是否允许请求
 */
export function checkRateLimit(
  identifier: string,
  store: Map<string, { count: number; resetTime: number }>,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const record = store.get(identifier);

  // 如果没有记录或已过期，创建新记录
  if (!record || now > record.resetTime) {
    const newRecord = {
      count: 1,
      resetTime: now + config.windowMs,
    };
    store.set(identifier, newRecord);
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetTime: newRecord.resetTime,
    };
  }

  // 检查是否超过限制
  if (record.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: record.resetTime,
    };
  }

  // 增加计数
  record.count++;
  store.set(identifier, record);

  return {
    allowed: true,
    remaining: config.maxRequests - record.count,
    resetTime: record.resetTime,
  };
}

/**
 * 检查用户限流
 * @param userId 用户 ID
 * @param maxRequests 最大请求数（默认60次/分钟，支持连续生成）
 * @param windowMs 时间窗口
 * @returns 是否允许请求
 */
export function checkUserRateLimit(
  userId: string,
  maxRequests: number = 60,  // 提高到60次/分钟，支持高并发场景
  windowMs: number = 60000
): { allowed: boolean; remaining: number; resetTime: number } {
  return checkRateLimit(userId, userRateLimitStore, {
    maxRequests,
    windowMs,
  });
}

/**
 * 检查 IP 限流
 * @param ip IP 地址
 * @param maxRequests 最大请求数（默认200次/分钟，防止DDoS攻击）
 * @param windowMs 时间窗口
 * @returns 是否允许请求
 */
export function checkIPRateLimit(
  ip: string,
  maxRequests: number = 200,  // 提高到200次/分钟，防止恶意攻击
  windowMs: number = 60000
): { allowed: boolean; remaining: number; resetTime: number } {
  return checkRateLimit(ip, ipRateLimitStore, {
    maxRequests,
    windowMs,
  });
}

/**
 * 熔断器
 */
export class CircuitBreaker {
  private name: string;
  private config: CircuitBreakerConfig;

  constructor(name: string, config: CircuitBreakerConfig) {
    this.name = name;
    this.config = config;
  }

  /**
   * 获取熔断器状态
   */
  private getState(): any {
    if (!circuitBreakers.has(this.name)) {
      circuitBreakers.set(this.name, {
        state: 'closed' as CircuitState,
        failureCount: 0,
        successCount: 0,
        lastFailureTime: 0,
        nextAttemptTime: 0,
      });
    }
    return circuitBreakers.get(this.name)!;
  }

  /**
   * 记录成功
   */
  recordSuccess(): void {
    const state = this.getState();

    if (state.state === 'half-open') {
      state.successCount++;
      if (state.successCount >= this.config.successThreshold) {
        // 半开状态下连续成功，切换到关闭
        state.state = 'closed';
        state.failureCount = 0;
        state.successCount = 0;
        console.log(`[CircuitBreaker] ${this.name}: 切换到关闭状态`);
      }
    } else if (state.state === 'closed') {
      // 关闭状态下成功，重置失败计数
      state.failureCount = 0;
    }
  }

  /**
   * 记录失败
   */
  recordFailure(): void {
    const state = this.getState();
    const now = Date.now();

    state.failureCount++;
    state.lastFailureTime = now;

    // 检查是否需要熔断
    if (state.failureCount >= this.config.failureThreshold) {
      state.state = 'open';
      state.nextAttemptTime = now + this.config.timeoutMs;
      console.log(`[CircuitBreaker] ${this.name}: 熔断器打开，将在 ${this.config.timeoutMs}ms 后尝试恢复`);
    }
  }

  /**
   * 检查是否允许执行
   */
  allowRequest(): boolean {
    const state = this.getState();
    const now = Date.now();

    switch (state.state) {
      case 'closed':
        return true;

      case 'open':
        // 检查是否可以尝试恢复
        if (now >= state.nextAttemptTime) {
          state.state = 'half-open';
          state.successCount = 0;
          console.log(`[CircuitBreaker] ${this.name}: 切换到半开状态`);
          return true;
        }
        return false;

      case 'half-open':
        return true;

      default:
        return true;
    }
  }

  /**
   * 获取当前状态
   */
  getCurrentState(): CircuitState {
    return this.getState().state;
  }

  /**
   * 执行函数（带熔断保护）
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.allowRequest()) {
      throw new Error(`服务暂时不可用，请稍后重试`);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
}

// 默认熔断器
export const defaultCircuitBreaker = new CircuitBreaker('default', {
  failureThreshold: 5,
  successThreshold: 2,
  timeoutMs: 60000,
  monitoringPeriodMs: 10000,
});

// 生成任务熔断器
export const generationCircuitBreaker = new CircuitBreaker('generation', {
  failureThreshold: 10,
  successThreshold: 3,
  timeoutMs: 120000,
  monitoringPeriodMs: 30000,
});

/**
 * 清理过期的限流记录
 */
export function cleanupExpiredRateLimits(): void {
  const now = Date.now();

  // 清理 IP 限流记录
  for (const [ip, record] of ipRateLimitStore.entries()) {
    if (now > record.resetTime) {
      ipRateLimitStore.delete(ip);
    }
  }

  // 清理用户限流记录
  for (const [userId, record] of userRateLimitStore.entries()) {
    if (now > record.resetTime) {
      userRateLimitStore.delete(userId);
    }
  }
}

// 每 5 分钟清理一次过期记录
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredRateLimits, 5 * 60 * 1000);
}
