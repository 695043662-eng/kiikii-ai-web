/**
 * 画布图片 IndexedDB 存储
 * 使用浏览器本地存储，容量大（50MB-500MB+），不产生服务器费用
 * 
 * #150 Local-First 缓存策略：
 * - 支持任意 string key（dbId 或 imageKey）
 * - 7天过期 + 容量上限双保险
 * - LRU 策略清理
 * - 静默降级：缓存异常时无缝切换网络请求
 */

const DB_NAME = 'canvas-images';
const STORE_NAME = 'images';
const DB_VERSION = 1;

// ====== 容量管理配置 ======
const MAX_IMAGES = 100;                              // 最大图片数量
const MAX_SIZE_BYTES = 300 * 1024 * 1024;            // 最大 300MB
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;           // 7天过期（毫秒）
const CLEANUP_RATIO = 0.2;                           // 触发上限时删除最老的 20%

let db: IDBDatabase | null = null;

/**
 * 初始化数据库
 */
function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[CanvasImageDB] 打开数据库失败:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('[CanvasImageDB] 数据库已打开');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      
      // 创建对象存储，以 key 为主键
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        console.log('[CanvasImageDB] 创建对象存储');
      }
    };
  });
}

interface ImageRecord {
  key: string;
  blob: Blob;
  contentType: string;
  createdAt: number;
}

/**
 * 存储图片（旧接口，生成自增 key）
 * @param blob 图片 Blob 数据
 * @param contentType 图片类型
 * @returns 图片 key
 */
export async function storeImage(blob: Blob, contentType?: string): Promise<string> {
  const database = await initDB();
  
  // 生成唯一 key
  const key = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  const record: ImageRecord = {
    key,
    blob,
    contentType: contentType || blob.type || 'image/png',
    createdAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(record);

    request.onsuccess = () => {
      console.log('[CanvasImageDB] 存储图片成功:', key, (blob.size / 1024).toFixed(2), 'KB');
      // 存储成功后，异步检查容量
      checkAndCleanup().catch(console.error);
      resolve(key);
    };

    request.onerror = () => {
      console.error('[CanvasImageDB] 存储图片失败:', request.error);
      reject(request.error);
    };
  });
}

// ====== #150 Local-First 缓存核心函数 ======

/**
 * #150 按指定 key 存储图片（幂等）
 * - 写入前先检查 key 是否存在（查重防刷）
 * - 自动触发容量管理（超过上限时清理）
 * 
 * @param key 存储 key（可以是 imageKey 或 dbId）
 * @param blob 图片 Blob 数据
 * @param contentType MIME 类型（可选）
 * @returns 是否成功写入（已存在时返回 false）
 */
export async function storeImageByKey(
  key: string,
  blob: Blob,
  contentType?: string
): Promise<boolean> {
  try {
    // 1. 查重防刷：先检查 key 是否已存在
    const existing = await peekRecord(key);
    if (existing) {
      console.log('[CanvasImageDB] #150 key 已存在，跳过写入:', key);
      return false;
    }

    const database = await initDB();

    // 2. 写入数据
    const record: ImageRecord = {
      key,
      blob,
      contentType: contentType || blob.type || 'image/png',
      createdAt: Date.now(),
    };

    return new Promise((resolve) => {
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(record); // 用 put 而非 add，支持覆盖

      request.onsuccess = () => {
        console.log('[CanvasImageDB] #150 存储成功:', key, (blob.size / 1024).toFixed(2), 'KB');
        resolve(true);
      };

      request.onerror = () => {
        console.error('[CanvasImageDB] #150 存储失败:', key, request.error);
        resolve(false);
      };
    });
  } catch (err) {
    console.error('[CanvasImageDB] #150 存储异常:', key, err);
    return false;
  }
}

/**
 * #150 加载图片（带静默降级）
 * - 先查 IndexedDB 缓存
 * - 缓存未命中或损坏时返回 null，由调用方决定降级策略
 * 
 * @param key 存储 key
 * @returns Blob URL（需手动释放）或 null
 */
export async function loadImageFromCache(key: string): Promise<string | null> {
  try {
    const database = await initDB();

    return new Promise((resolve) => {
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as ImageRecord | undefined;
        
        // 异常判定：查不到、blob 为空、blob.size === 0
        if (!record || !record.blob || record.blob.size === 0) {
          console.log('[CanvasImageDB] #150 缓存未命中或损坏:', key);
          resolve(null);
          return;
        }

        // 创建 Blob URL
        const url = URL.createObjectURL(record.blob);
        console.log('[CanvasImageDB] #150 缓存命中:', key, (record.blob.size / 1024).toFixed(2), 'KB');
        resolve(url);
      };

      request.onerror = () => {
        console.error('[CanvasImageDB] #150 读取异常:', key, request.error);
        resolve(null); // 静默降级，不抛异常
      };
    });
  } catch (err) {
    console.error('[CanvasImageDB] #150 加载异常:', key, err);
    return null; // 静默降级
  }
}

/**
 * 检查 key 是否存在（内部函数）
 */
async function peekRecord(key: string): Promise<ImageRecord | null> {
  try {
    const database = await initDB();

    return new Promise((resolve) => {
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result as ImageRecord | null);
      };

      request.onerror = () => {
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

/**
 * #150 容量管理：检查并清理
 * - 超过 MAX_IMAGES 或 MAX_SIZE_BYTES 时触发清理
 * - 按 createdAt 排序，删除最老的 CLEANUP_RATIO 比例
 */
export async function checkAndCleanup(): Promise<void> {
  try {
    const stats = await getStorageStats();
    
    if (stats.count < MAX_IMAGES && stats.size < MAX_SIZE_BYTES) {
      return; // 未达上限，无需清理
    }

    console.log('[CanvasImageDB] #150 触发容量清理:', {
      当前数量: stats.count,
      当前大小: `${(stats.size / 1024 / 1024).toFixed(2)}MB`,
      上限数量: MAX_IMAGES,
      上限大小: `${MAX_SIZE_BYTES / 1024 / 1024}MB`,
    });

    const database = await initDB();

    // 按时间排序获取所有记录
    const allRecords: ImageRecord[] = await new Promise((resolve) => {
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('createdAt');
      const request = index.openCursor();
      const records: ImageRecord[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          records.push(cursor.value);
          cursor.continue();
        } else {
          resolve(records);
        }
      };

      request.onerror = () => resolve([]);
    });

    // 计算要删除的数量（最老的 20%）
    const deleteCount = Math.ceil(allRecords.length * CLEANUP_RATIO);
    const toDelete = allRecords.slice(0, deleteCount);

    if (toDelete.length === 0) return;

    // 执行删除
    const deleteTransaction = database.transaction([STORE_NAME], 'readwrite');
    const deleteStore = deleteTransaction.objectStore(STORE_NAME);

    for (const record of toDelete) {
      deleteStore.delete(record.key);
    }

    console.log('[CanvasImageDB] #150 已清理:', deleteCount, '张图片');
  } catch (err) {
    console.error('[CanvasImageDB] #150 清理异常:', err);
  }
}

/**
 * 获取图片（兼容旧接口）
 * @param key 图片 key
 * @returns 图片 Blob URL（需手动释放）
 */
export async function getImage(key: string): Promise<string | null> {
  // 复用新的加载逻辑（带静默降级）
  return loadImageFromCache(key);
}

/**
 * 批量获取图片
 * @param keys 图片 key 数组
 * @returns key -> Blob URL 的映射
 */
export async function getImages(keys: string[]): Promise<{ [key: string]: string }> {
  const database = await initDB();
  const urls: { [key: string]: string } = {};

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    let completed = 0;
    const total = keys.length;

    if (total === 0) {
      resolve(urls);
      return;
    }

    for (const key of keys) {
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as ImageRecord | undefined;
        if (record) {
          urls[key] = URL.createObjectURL(record.blob);
        }
        completed++;
        if (completed === total) {
          console.log('[CanvasImageDB] 批量获取图片完成:', Object.keys(urls).length, '/', total);
          resolve(urls);
        }
      };

      request.onerror = () => {
        completed++;
        if (completed === total) {
          resolve(urls);
        }
      };
    }
  });
}

/**
 * 删除图片
 * @param key 图片 key
 */
export async function deleteImage(key: string): Promise<void> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);

    request.onsuccess = () => {
      console.log('[CanvasImageDB] 删除图片成功:', key);
      resolve();
    };

    request.onerror = () => {
      console.error('[CanvasImageDB] 删除图片失败:', request.error);
      reject(request.error);
    };
  });
}

/**
 * #150 清理过期图片（超过 7 天）+ 容量上限检查
 */
export async function cleanupOldImages(): Promise<number> {
  const database = await initDB();
  const cutoffTime = Date.now() - EXPIRY_MS;

  return new Promise((resolve) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('createdAt');
    const range = IDBKeyRange.upperBound(cutoffTime);
    const request = index.openCursor(range);
    let deleted = 0;

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        deleted++;
        cursor.continue();
      } else {
        if (deleted > 0) {
          console.log('[CanvasImageDB] #150 清理过期图片:', deleted, '张');
        }
        // 清理过期后，再检查容量上限
        checkAndCleanup().catch(console.error);
        resolve(deleted);
      }
    };

    request.onerror = () => {
      console.error('[CanvasImageDB] #150 清理过期图片失败:', request.error);
      resolve(0); // 静默降级
    };
  });
}

/**
 * 获取存储统计
 */
export async function getStorageStats(): Promise<{ count: number; size: number }> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();
    
    let count = 0;
    let size = 0;

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const record = cursor.value as ImageRecord;
        count++;
        size += record.blob.size;
        cursor.continue();
      } else {
        resolve({ count, size });
      }
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

// 启动时清理过期图片
if (typeof window !== 'undefined') {
  cleanupOldImages().catch(console.error);
}
