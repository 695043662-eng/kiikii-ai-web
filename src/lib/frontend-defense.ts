/**
 * 前端防御工具 - 生产环境防御级实现
 * 
 * 核心规则：
 * 1. UUID 生成：每次点击生成，即时生成唯一 client_request_id
 * 2. 状态强锁：按钮点击后立即 disabled，直到 Success 或 Final Error
 * 3. 图片压缩：2048px + JPEG + 质量 0.8 + <3MB
 */

import { compressImage, type CompressionResult } from './image-compression';
import { toast } from 'sonner';

/**
 * 生成 UUID v4
 * 
 * ⚠️ 每次点击生成按钮时，前端必须即时生成一个唯一的 client_request_id
 */
export function generateClientRequestId(): string {
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  
  console.log('[UUID] 生成 client_request_id:', uuid);
  return uuid;
}

/**
 * 计数锁管理器（支持多任务并发）
 *
 * ⚠️ 4G 内存环境：允许最多 5 个并发任务
 * ⚠️ 超过限制的请求会被排队等待
 * ⚠️ 任务完成后自动释放位置给下一个请求
 */
export class RequestLock {
  private activeCount: number = 0;
  private maxConcurrent: number = 5; // 4G 内存支持 5 个并发
  private waitingQueue: Array<() => void> = [];
  private clientRequestIds: Map<number, string> = new Map(); // 活跃请求的 ID

  /**
   * 尝试获取锁
   * @returns Promise<boolean> - 获取成功返回 true
   */
  async acquire(): Promise<boolean> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      const requestId = generateClientRequestId();
      this.clientRequestIds.set(this.activeCount, requestId);
      console.log(`[Lock] ✅ 获取成功 (${this.activeCount}/${this.maxConcurrent}), client_request_id: ${requestId}`);
      return true;
    }

    // 需要等待
    console.log(`[Lock] ⏳ 等待中... (当前 ${this.activeCount}/${this.maxConcurrent})`);
    return new Promise<boolean>((resolve) => {
      this.waitingQueue.push(() => {
        this.activeCount++;
        const requestId = generateClientRequestId();
        this.clientRequestIds.set(this.activeCount, requestId);
        console.log(`[Lock] ✅ 排队获取成功 (${this.activeCount}/${this.maxConcurrent}), client_request_id: ${requestId}`);
        resolve(true);
      });
    });
  }

  /**
   * 同步版本（兼容旧代码）
   * @returns 如果锁已满且不想等待，返回 false
   */
  acquireSync(): boolean {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      const requestId = generateClientRequestId();
      this.clientRequestIds.set(this.activeCount, requestId);
      console.log(`[Lock] ✅ 同步获取成功 (${this.activeCount}/${this.maxConcurrent}), client_request_id: ${requestId}`);
      return true;
    }
    console.log(`[Lock] ⚠️ 锁已满 (${this.activeCount}/${this.maxConcurrent})，请等待`);
    return false;
  }

  /**
   * 释放锁
   */
  release(): void {
    if (this.activeCount > 0) {
      this.activeCount--;
      this.clientRequestIds.delete(this.activeCount + 1);
      console.log(`[Lock] 🔓 释放成功 (${this.activeCount}/${this.maxConcurrent})`);
    }

    // 处理等待队列
    if (this.waitingQueue.length > 0) {
      const next = this.waitingQueue.shift();
      if (next) {
        console.log(`[Lock] 📞 唤醒下一个等待者 (队列剩余 ${this.waitingQueue.length})`);
        next();
      }
    }
  }

  /**
   * 获取当前的 client_request_id（最新一个）
   */
  getClientRequestId(): string | null {
    const keys = Array.from(this.clientRequestIds.values());
    return keys.length > 0 ? keys[keys.length - 1] : null;
  }

  /**
   * 检查是否还有空位
   */
  isAvailable(): boolean {
    return this.activeCount < this.maxConcurrent;
  }

  /**
   * 获取当前活跃数
   */
  getActiveCount(): number {
    return this.activeCount;
  }

  /**
   * 获取最大并发数
   */
  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  /**
   * 获取等待队列长度
   */
  getWaitingCount(): number {
    return this.waitingQueue.length;
  }
}

/**
 * 图片压缩包装器
 * 
 * ⚠️ 强制压缩：长边 2048px、JPEG 格式、质量 0.8、体积 <3MB
 * ⚠️ 若压缩 3 次仍超标，直接抛出 Alert 拦截上传
 * 
 * #492 新增：根据分辨率动态调整压缩参数
 */
export function getCompressionParams(resolution: string = '1K') {
  switch (resolution) {
    case '4K':
      return {
        maxWidthOrHeight: 4096,  // 4K 放宽到 4096px
        quality: 0.95,           // 质量提升到 95%
        maxSizeMB: 10,           // 体积放宽到 10MB
      };
    case '2K':
      return {
        maxWidthOrHeight: 2880,  // 2K 放宽到 2880px
        quality: 0.92,           // 质量提升到 92%
        maxSizeMB: 6,            // 体积放宽到 6MB
      };
    case '1K':
    default:
      return {
        maxWidthOrHeight: 2048,  // 1K 保持 2048px
        quality: 0.88,           // #492 质量从 0.8 提升到 0.88
        maxSizeMB: 3,
      };
  }
}

export async function compressImageForUpload(
  file: File,
  options: {
    maxWidthOrHeight?: number;
    maxSizeMB?: number;
    quality?: number;
    maxAttempts?: number;
  } = {}
): Promise<CompressionResult> {
  const {
    maxWidthOrHeight = 2048,  // ⚠️ 长边 2048px
    maxSizeMB = 3,            // ⚠️ 体积 <3MB
    quality = 0.8,            // ⚠️ 质量 0.8
    maxAttempts = 3,          // ⚠️ 最多压缩 3 次
  } = options;

  console.log('[压缩] 开始压缩图片');
  console.log('[压缩] 配置:', { maxWidthOrHeight, maxSizeMB, quality, maxAttempts });

  try {
    const result = await compressImage(file, {
      maxWidthOrHeight,
      maxSizeMB,
      quality,
      maxAttempts,
    });

    console.log('[压缩] ✅ 压缩成功');
    console.log('[压缩] 原始大小:', (result.originalSize / 1024 / 1024).toFixed(2), 'MB');
    console.log('[压缩] 压缩后:', (result.compressedSize / 1024 / 1024).toFixed(2), 'MB');
    console.log('[压缩] 压缩比:', result.compressionRatio.toFixed(2), 'x');

    return result;
  } catch (error) {
    console.error('[压缩] ❌ 压缩失败:', error);

    // ⚠️ 压缩 3 次仍超标，直接抛出 Alert 拦截上传
    toast.error(error instanceof Error ? error.message : '图片压缩失败，请选择更小的图片');

    throw error;
  }
}

/**
 * 批量压缩图片
 */
export async function compressImagesForUpload(
  files: File[],
  options: {
    maxWidthOrHeight?: number;
    maxSizeMB?: number;
    quality?: number;
    maxAttempts?: number;
  } = {}
): Promise<CompressionResult[]> {
  console.log('[压缩] 开始批量压缩', files.length, '张图片');

  const results: CompressionResult[] = [];

  for (const file of files) {
    const result = await compressImageForUpload(file, options);
    results.push(result);
  }

  console.log('[压缩] ✅ 批量压缩完成');
  return results;
}

/**
 * 检查错误是否为最终错误（不可重试）
 */
export function isFinalError(error: any): boolean {
  const errorType = error?.type || error?.errorType;
  
  // 这些错误类型禁止重试
  const finalErrorTypes = [
    'PARAM_ERROR',
    'INSUFFICIENT_CREDITS',
    'AUTH_ERROR',
    'PERMISSION_ERROR',
    'LOGIC_ERROR',
  ];

  const isFinal = finalErrorTypes.includes(errorType);
  console.log('[错误检查] 错误类型:', errorType, '- 是否最终错误:', isFinal);
  
  return isFinal;
}

/**
 * 格式化错误消息
 */
export function formatErrorMessage(error: any): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error?.message) {
    return error.message;
  }

  if (error?.error) {
    return error.error;
  }

  return '未知错误';
}

/**
 * 前端请求发送器（带状态锁）
 */
export async function sendRequestWithLock<T = any>(
  lock: RequestLock,
  request: () => Promise<T>,
  onSuccess: (result: T) => void,
  onError: (error: any) => void,
  onComplete: () => void
): Promise<void> {
  // 1. 尝试获取锁
  if (!lock.acquire()) {
    console.log('[请求] ⚠️ 请求被锁阻止');
    toast.error('请等待当前请求完成');
    return;
  }

  const clientRequestId = lock.getClientRequestId();
  console.log('[请求] 开始发送请求，client_request_id:', clientRequestId);

  try {
    // 2. 发送请求
    const result = await request();
    
    // 3. 成功处理
    console.log('[请求] ✅ 请求成功');
    onSuccess(result);
    
  } catch (error: any) {
    // 4. 错误处理
    console.error('[请求] ❌ 请求失败:', error);
    
    // 检查是否为最终错误
    if (isFinalError(error)) {
      console.log('[请求] 最终错误，释放锁');
      lock.release();
    }
    
    onError(error);
    
  } finally {
    // 5. 完成处理
    onComplete();
  }
}

/**
 * SSE 请求发送器（带状态锁和超时）
 */
export async function sendSSERequestWithLock(
  lock: RequestLock,
  url: string,
  body: any,
  onEvent: (event: { type: string; data: any }) => void,
  onError: (error: any) => void,
  onComplete: () => void
): Promise<void> {
  // 1. 尝试获取锁
  if (!lock.acquire()) {
    console.log('[SSE] ⚠️ 请求被锁阻止');
    toast.error('请等待当前请求完成');
    return;
  }

  const clientRequestId = lock.getClientRequestId();
  console.log('[SSE] 开始发送请求，client_request_id:', clientRequestId);

  // ⚠️ 添加 client_request_id 到请求体
  const requestBody = {
    ...body,
    client_request_id: clientRequestId,
  };

  try {
    // 2. 发送 SSE 请求
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    // 3. 处理 SSE 流
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法获取响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let isCompleted = false;

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        console.log('[SSE] 流结束');
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            onEvent({ type: data.type, data });

            // 检查是否完成
            if (data.type === 'complete' || data.type === 'error') {
              isCompleted = true;
            }
          } catch (e) {
            console.error('[SSE] 解析事件失败:', line);
          }
        }
      }
    }

    // 4. 成功完成
    if (isCompleted) {
      console.log('[SSE] ✅ 请求完成');
    }

  } catch (error: any) {
    console.error('[SSE] ❌ 请求失败:', error);
    onError(error);
    
  } finally {
    // 5. 释放锁并完成
    lock.release();
    onComplete();
  }
}
