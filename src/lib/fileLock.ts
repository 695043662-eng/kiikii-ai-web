/**
 * 简单的文件锁实现
 * 使用锁文件来防止并发写入冲突
 */

import fs from 'fs';
import path from 'path';

const LOCK_DIR = '/tmp/file-locks';

// 确保锁目录存在
function ensureLockDir() {
  if (!fs.existsSync(LOCK_DIR)) {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
  }
}

/**
 * 获取锁文件路径
 */
function getLockFilePath(filePath: string): string {
  // 使用文件路径的哈希作为锁文件名
  const hash = Buffer.from(filePath).toString('base64').replace(/[/+=]/g, '');
  return path.join(LOCK_DIR, `${hash}.lock`);
}

/**
 * 尝试获取锁（非阻塞）
 * @param filePath 要锁定的文件路径
 * @param timeout 超时时间（毫秒）
 * @returns 是否获取成功
 */
export function acquireLock(filePath: string, timeout: number = 5000): boolean {
  ensureLockDir();

  const lockFilePath = getLockFilePath(filePath);
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      // 尝试创建锁文件（独占模式）
      const fd = fs.openSync(lockFilePath, 'wx');
      // 写入当前进程ID和时间戳
      fs.writeFileSync(fd, `${process.pid}:${Date.now()}`);
      fs.closeSync(fd);
      return true;
    } catch (error: any) {
      if (error.code === 'EEXIST') {
        // 锁文件已存在，检查是否过期（防止死锁）
        try {
          const stat = fs.statSync(lockFilePath);
          const lockAge = Date.now() - stat.mtimeMs;
          // 如果锁文件超过 10 秒，认为是死锁，删除
          if (lockAge > 10000) {
            console.warn(`[FileLock] 检测到死锁，删除过期的锁文件: ${lockFilePath}`);
            fs.unlinkSync(lockFilePath);
            continue; // 重试
          }
        } catch {
          // 无法检查锁文件，继续等待
        }

        // 等待 10ms 后重试
        require('child_process').execSync('sleep 0.01');
        continue;
      } else {
        // 其他错误，无法获取锁
        console.error(`[FileLock] 获取锁失败:`, error);
        return false;
      }
    }
  }

  // 超时
  return false;
}

/**
 * 释放锁
 * @param filePath 要解锁的文件路径
 */
export function releaseLock(filePath: string): void {
  try {
    const lockFilePath = getLockFilePath(filePath);
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
    }
  } catch (error) {
    console.error(`[FileLock] 释放锁失败:`, error);
  }
}

/**
 * 带锁的文件写入
 * @param filePath 文件路径
 * @param data 要写入的数据
 * @param timeout 获取锁的超时时间
 * @returns 是否写入成功
 */
export function writeWithLock(
  filePath: string,
  data: string | Buffer,
  timeout: number = 5000
): boolean {
  if (!acquireLock(filePath, timeout)) {
    console.error(`[FileLock] 获取锁失败: ${filePath}`);
    return false;
  }

  try {
    fs.writeFileSync(filePath, data);
    return true;
  } catch (error) {
    console.error(`[FileLock] 写入文件失败: ${filePath}`, error);
    return false;
  } finally {
    releaseLock(filePath);
  }
}

/**
 * 带锁的文件读取
 * @param filePath 文件路径
 * @param timeout 获取锁的超时时间
 * @returns 文件内容或 null
 */
export function readWithLock(
  filePath: string,
  timeout: number = 5000
): string | null {
  if (!acquireLock(filePath, timeout)) {
    console.error(`[FileLock] 获取锁失败: ${filePath}`);
    return null;
  }

  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    console.error(`[FileLock] 读取文件失败: ${filePath}`, error);
    return null;
  } finally {
    releaseLock(filePath);
  }
}
