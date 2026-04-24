/**
 * 熔断器状态机
 * 用于保护服务在高并发下的稳定性
 */

export enum CircuitState {
  CLOSED = 'closed',         // 关闭状态：正常工作
  OPEN = 'open',             // 打开状态：熔断中，拒绝请求
  HALF_OPEN = 'half_open',   // 半开状态：尝试恢复
}

export interface CircuitBreakerConfig {
  failureThreshold?: number;     // 失败阈值：连续失败多少次后熔断
  successThreshold?: number;     // 成功阈值：半开状态下成功多少次后关闭熔断
  resetTimeout?: number;         // 重置超时：熔断后多久尝试恢复（毫秒）
  timeout?: number;              // 请求超时时间（毫秒）
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private nextAttemptTime: number = 0;
  private config: Required<CircuitBreakerConfig>;

  constructor(config: CircuitBreakerConfig = {}) {
    this.config = {
      failureThreshold: config.failureThreshold || 5,    // 默认连续失败 5 次
      successThreshold: config.successThreshold || 3,    // 默认连续成功 3 次
      resetTimeout: config.resetTimeout || 60000,        // 默认 60 秒
      timeout: config.timeout || 40000,                  // 默认 40 秒
    };
  }

  /**
   * 执行请求，带有熔断保护
   */
  async execute<T>(request: () => Promise<T>): Promise<T> {
    // 检查熔断器状态
    if (this.isOpen()) {
      throw new Error('熔断器已打开，服务暂时不可用，请稍后重试');
    }

    try {
      // 执行请求
      const result = await Promise.race([
        request(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('请求超时')), this.config.timeout)
        ),
      ]);

      // 请求成功
      this.onSuccess();
      return result;
    } catch (error) {
      // 请求失败
      this.onFailure();
      throw error;
    }
  }

  /**
   * 检查熔断器是否已打开
   */
  private isOpen(): boolean {
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      if (now >= this.nextAttemptTime) {
        // 尝试半开状态
        console.log('[CircuitBreaker] 进入半开状态，尝试恢复服务...');
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * 请求成功回调
   */
  private onSuccess(): void {
    console.log('[CircuitBreaker] 请求成功');
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      console.log(`[CircuitBreaker] 半开状态成功计数: ${this.successCount}/${this.config.successThreshold}`);

      if (this.successCount >= this.config.successThreshold) {
        // 半开状态下连续成功，关闭熔断器
        console.log('[CircuitBreaker] 半开状态成功，关闭熔断器');
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
      }
    }
  }

  /**
   * 请求失败回调
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    console.log(`[CircuitBreaker] 请求失败，失败计数: ${this.failureCount}/${this.config.failureThreshold}`);

    if (this.state === CircuitState.HALF_OPEN) {
      // 半开状态下失败，重新打开熔断器
      console.log('[CircuitBreaker] 半开状态失败，重新打开熔断器');
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.resetTimeout;
      this.successCount = 0;
    } else if (this.failureCount >= this.config.failureThreshold) {
      // 达到失败阈值，打开熔断器
      console.log(`[CircuitBreaker] 达到失败阈值 (${this.config.failureThreshold})，打开熔断器`);
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.resetTimeout;
      this.failureCount = 0;
    }
  }

  /**
   * 获取当前状态
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * 获取状态信息
   */
  getStatus(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: number;
    nextAttemptTime: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  /**
   * 手动重置熔断器
   */
  reset(): void {
    console.log('[CircuitBreaker] 手动重置熔断器');
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.nextAttemptTime = 0;
  }
}

// 默认熔断器实例（短超时，适用于普通 API）
export const defaultCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 3,
  resetTimeout: 60000,
  timeout: 40000,
});

// SSE 流专用熔断器（长超时，适用于图片生成等长时间任务）
export const sseCircuitBreaker = new CircuitBreaker({
  failureThreshold: 10,      // #281 修复：提高到 10 次，避免频繁熔断
  successThreshold: 3,
  resetTimeout: 120000,  // 2 分钟
  timeout: 360000,       // 6 分钟（支持长时间 SSE 流）
});
