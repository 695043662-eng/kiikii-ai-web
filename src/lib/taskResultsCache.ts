// 任务结果缓存模块
// 使用文件存储，避免代码热更新导致缓存丢失

import fs from 'fs';
import path from 'path';
import { writeWithLock, readWithLock } from '@/lib/fileLock';

export interface TaskResult {
  status: 'generating' | 'completed' | 'failed';
  imageUrls: (string | null)[];  // 改为支持 null
  imageKeys?: (string | null)[];  // 改为支持 null
  errors: { index: number; error: string }[];
  imageItems?: {
    index: number;
    url: string | null;
    key: string | null;
    status: 'completed' | 'failed' | 'generating';
    error: string | null;
  }[];
  createdAt: number;
  completedAt?: number;
  // 终端任务ID列表（用于追踪）
  terminalTaskIds?: string[];
  // 请求参数（用于超时后重新请求）
  requestParams?: {
    prompt: string;
    model: string;
    resolution: string;
    aspectRatio: string;
    generationCount: number;
    creditsPerImage?: number;
    urls?: string[];
    // #244 新增：参考图相关字段（用于历史记录恢复）
    referenceImageMd5s?: string[];
    referenceImageUrls?: string[];
    referenceImageKeys?: string[];
  };
  // #155 防止积分重复返还
  creditsRefunded?: boolean;
  // #233 积分信息（用于历史记录显示）
  creditsCharged?: number;
  creditsBalance?: number;
}

// 缓存目录
const CACHE_DIR = '/tmp/task-cache';

// 确保缓存目录存在
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

// 获取缓存文件路径
function getCacheFilePath(taskId: string): string {
  return path.join(CACHE_DIR, `${taskId}.json`);
}

export function getTaskResult(taskId: string): TaskResult | undefined {
  try {
    const filePath = getCacheFilePath(taskId);
    if (fs.existsSync(filePath)) {
      // 使用文件锁读取
      const data = readWithLock(filePath);
      if (data) {
        return JSON.parse(data);
      }
    }
  } catch (error) {
    console.error(`[Cache] 读取缓存失败: ${taskId}`, error);
  }
  return undefined;
}

export function setTaskResult(taskId: string, result: TaskResult): void {
  try {
    ensureCacheDir();
    const filePath = getCacheFilePath(taskId);
    // 使用文件锁写入
    const success = writeWithLock(filePath, JSON.stringify(result, null, 2));
    if (success) {
      console.log(`[Cache] 设置任务缓存: ${taskId}, status=${result.status}, images=${result.imageUrls.length}`);
    } else {
      console.error(`[Cache] 设置任务缓存失败: ${taskId} (无法获取锁)`);
    }
  } catch (error) {
    console.error(`[Cache] 写入缓存失败: ${taskId}`, error);
  }
}

export function deleteTaskResult(taskId: string): boolean {
  try {
    const filePath = getCacheFilePath(taskId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (error) {
    console.error(`[Cache] 删除缓存失败: ${taskId}`, error);
  }
  return false;
}

// 通过终端任务ID查找主任务ID
export function findMainTaskIdByTerminalId(terminalTaskId: string): string | null {
  try {
    ensureCacheDir();
    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(CACHE_DIR, file);
        try {
          const data = fs.readFileSync(filePath, 'utf-8');
          const result: TaskResult = JSON.parse(data);
          if (result.terminalTaskIds && result.terminalTaskIds.includes(terminalTaskId)) {
            // 返回文件名（去掉 .json 后缀）
            return file.replace('.json', '');
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }
  } catch (error) {
    console.error('[Cache] 查找主任务失败:', error);
  }
  return null;
}

// 清理过期缓存（超过4小时的）
export function cleanupExpiredCache(): void {
  try {
    ensureCacheDir();
    const now = Date.now();
    const expireTime = 4 * 60 * 60 * 1000; // 4小时
    let cleaned = 0;
    
    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(CACHE_DIR, file);
        try {
          const data = fs.readFileSync(filePath, 'utf-8');
          const result: TaskResult = JSON.parse(data);
          if (now - result.createdAt > expireTime) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        } catch (e) {
          // 无法解析的文件，直接删除
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }
    }
    
    if (cleaned > 0) {
      console.log(`[Cache] 清理了 ${cleaned} 个过期缓存`);
    }
  } catch (error) {
    console.error('[Cache] 清理缓存失败', error);
  }
}

// 定时清理（每10分钟）
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredCache, 600000);
}
