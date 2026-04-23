/**
 * 参考图缓存工具
 * 
 * 功能：
 * 1. 计算图片 MD5（使用 SparkMD5）
 * 2. 本地缓存 base64 数据（使用 IndexedDB）
 * 3. 查询和存储参考图到服务器
 * 
 * #150 容量管理：
 * - 50 张上限
 * - 30 天过期
 * - LRU 清理（删除最老的 20%）
 */

import SparkMD5 from 'spark-md5';

// IndexedDB 配置
const DB_NAME = 'reference-image-cache';
const DB_VERSION = 1;
const STORE_NAME = 'images';

// ====== #150 容量管理配置 ======
const MAX_IMAGES = 50;                    // 最大图片数量
const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;  // 30天过期（毫秒）
const CLEANUP_RATIO = 0.2;                // 触发上限时删除最老的 20%

// 缓存数据结构
export interface CachedReferenceImage {
  md5: string;
  base64: string;
  timestamp: number;
}

// IndexedDB 实例缓存
let dbInstance: IDBDatabase | null = null;

/**
 * 初始化 IndexedDB
 */
function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // 以 MD5 为主键
        db.createObjectStore(STORE_NAME, { keyPath: 'md5' });
      }
    };
  });
}

/**
 * 计算图片文件的 MD5
 * 使用 SparkMD5 分片计算，支持大文件
 */
export async function calculateImageMD5(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunkSize = 2097152; // 2MB per chunk
    const spark = new SparkMD5.ArrayBuffer();
    const reader = new FileReader();
    
    let currentChunk = 0;
    const chunks = Math.ceil(file.size / chunkSize);

    const loadNext = () => {
      const start = currentChunk * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      reader.readAsArrayBuffer(file.slice(start, end));
    };

    reader.onload = (e) => {
      spark.append(e.target?.result as ArrayBuffer);
      currentChunk++;

      if (currentChunk < chunks) {
        loadNext();
      } else {
        resolve(spark.end());
      }
    };

    reader.onerror = () => reject(reader.error);
    loadNext();
  });
}

/**
 * 计算图片文件的 MD5（更快的版本，直接读取整个文件）
 * 对于小于 20MB 的文件，这个版本更快
 */
export async function calculateImageMD5Fast(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const spark = new SparkMD5.ArrayBuffer();
      spark.append(e.target?.result as ArrayBuffer);
      resolve(spark.end());
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 从 base64 字符串计算 MD5
 */
export function calculateMD5FromBase64(base64: string): string {
  // 移除 data:image/xxx;base64, 前缀
  const data = base64.includes(',') ? base64.split(',')[1] : base64;
  const spark = new SparkMD5();
  spark.append(data);
  return spark.end();
}

/**
 * 从 ArrayBuffer 计算 MD5
 */
export function calculateMD5FromArrayBuffer(buffer: ArrayBuffer): string {
  const spark = new SparkMD5.ArrayBuffer();
  spark.append(buffer);
  return spark.end();
}

/**
 * 保存参考图到本地缓存
 * #150 存储后检查容量，超过上限时触发 LRU 清理
 */
export async function saveToLocalStorage(md5: string, base64: string): Promise<void> {
  try {
    const db = await initDB();
    
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const data: CachedReferenceImage = {
        md5,
        base64,
        timestamp: Date.now(),
      };
      
      const request = store.put(data);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    // #150 存储成功后，异步检查容量（不阻塞）
    checkAndCleanup().catch(err => {
      console.error('[参考图缓存] 容量检查失败:', err);
    });
  } catch (error) {
    console.error('保存到本地缓存失败:', error);
    // 不抛出错误，允许继续执行
  }
}

/**
 * 从本地缓存获取参考图
 */
export async function getFromLocalStorage(md5: string): Promise<string | null> {
  try {
    const db = await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(md5);
      
      request.onsuccess = () => {
        const result = request.result as CachedReferenceImage | undefined;
        resolve(result?.base64 || null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('从本地缓存获取失败:', error);
    return null;
  }
}

/**
 * 批量从本地缓存获取参考图
 */
export async function batchGetFromLocalStorage(md5s: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  
  try {
    const db = await initDB();
    
    const promises = md5s.map(md5 => 
      new Promise<void>((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(md5);
        
        request.onsuccess = () => {
          const data = request.result as CachedReferenceImage | undefined;
          if (data?.base64) {
            result.set(md5, data.base64);
          }
          resolve();
        };
        request.onerror = () => resolve();
      })
    );
    
    await Promise.all(promises);
  } catch (error) {
    console.error('批量获取本地缓存失败:', error);
  }
  
  return result;
}

/**
 * 检查本地缓存是否存在
 */
export async function existsInLocalStorage(md5: string): Promise<boolean> {
  try {
    const db = await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(md5);
      
      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('检查本地缓存失败:', error);
    return false;
  }
}

/**
 * 从服务器获取参考图（用于历史记录）
 */
export async function getFromServer(md5: string, userId: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/reference-images?md5=${md5}&userId=${userId}`);
    const data = await response.json();
    
    if (data.success && data.exists && data.signedUrl) {
      return data.signedUrl;
    }
    
    return null;
  } catch (error) {
    console.error('从服务器获取参考图失败:', error);
    return null;
  }
}

/**
 * 批量从服务器获取参考图
 */
export async function batchGetFromServer(
  md5s: string[], 
  userId: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  
  if (md5s.length === 0) return result;
  
  try {
    const response = await fetch('/api/reference-images', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, md5Hashes: md5s }),
    });
    
    const data = await response.json();
    
    if (data.success && data.images) {
      for (const img of data.images) {
        result.set(img.md5Hash, img.signedUrl);
      }
    }
  } catch (error) {
    console.error('批量从服务器获取参考图失败:', error);
  }
  
  return result;
}

/**
 * 获取参考图（优先本地缓存，其次服务器）
 */
export async function getReferenceImage(
  md5: string, 
  userId: string
): Promise<string | null> {
  // 先查本地缓存
  const localBase64 = await getFromLocalStorage(md5);
  if (localBase64) {
    return localBase64;
  }
  
  // 再查服务器
  return getFromServer(md5, userId);
}

/**
 * 清理过期的本地缓存（超过 30 天）
 * #150 增加：数量上限检查 + LRU 清理
 */
export async function cleanupExpiredCache(): Promise<number> {
  try {
    const db = await initDB();
    const cutoffTime = Date.now() - EXPIRY_MS;
    let deletedCount = 0;
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const data = cursor.value as CachedReferenceImage;
          if (data.timestamp < cutoffTime) {
            cursor.delete();
            deletedCount++;
          }
          cursor.continue();
        } else {
          if (deletedCount > 0) {
            console.log('[参考图缓存] #150 清理过期图片:', deletedCount, '张');
          }
          // 清理过期后，再检查容量上限
          checkAndCleanup().catch(console.error);
          resolve(deletedCount);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('清理过期缓存失败:', error);
    return 0;
  }
}

/**
 * #150 容量管理：检查并清理
 * - 超过 MAX_IMAGES 时触发 LRU 清理
 * - 按 timestamp 排序，删除最老的 CLEANUP_RATIO 比例
 */
async function checkAndCleanup(): Promise<void> {
  try {
    const db = await initDB();
    
    // 1. 获取当前数量
    const count = await new Promise<number>((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    });
    
    if (count < MAX_IMAGES) {
      return; // 未达上限，无需清理
    }
    
    console.log('[参考图缓存] #150 触发容量清理:', {
      当前数量: count,
      上限: MAX_IMAGES,
    });
    
    // 2. 获取所有记录（按时间排序）
    const allRecords: CachedReferenceImage[] = await new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const records = request.result as CachedReferenceImage[];
        // 按时间升序排序（最老的在前）
        records.sort((a, b) => a.timestamp - b.timestamp);
        resolve(records);
      };
      request.onerror = () => resolve([]);
    });
    
    // 3. 计算要删除的数量（最老的 20%）
    const deleteCount = Math.ceil(allRecords.length * CLEANUP_RATIO);
    const toDelete = allRecords.slice(0, deleteCount);
    
    if (toDelete.length === 0) return;
    
    // 4. 执行删除
    const deleteTransaction = db.transaction([STORE_NAME], 'readwrite');
    const deleteStore = deleteTransaction.objectStore(STORE_NAME);
    
    for (const record of toDelete) {
      deleteStore.delete(record.md5);
    }
    
    console.log('[参考图缓存] #150 已清理:', deleteCount, '张图片');
  } catch (err) {
    console.error('[参考图缓存] #150 清理异常:', err);
  }
}
