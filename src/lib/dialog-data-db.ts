/**
 * 对话框数据 IndexedDB 存储
 * 用于持久化对话框中的参考图和消息历史
 */

import { clearAllImageKeyMappings } from './dialog-image-key-map';
import { safeSetItem } from './safe-storage';

const DB_NAME = 'dialog-data';
const STORE_NAME = 'reference-images';
const DB_VERSION = 1;

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
      console.error('[DialogDataDB] 打开数据库失败:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('[DialogDataDB] 数据库已打开');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      
      // 创建对象存储
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        console.log('[DialogDataDB] 创建对象存储');
      }
    };
  });
}

interface ReferenceImageRecord {
  key: string;        // MD5 作为 key
  blob: Blob;         // 图片 Blob 数据
  base64: string;     // base64 数据（用于快速显示）
  proxyUrl: string;   // 代理 URL
  name: string;       // 文件名
  createdAt: number;
}

// localStorage keys
const DIALOG_MESSAGES_KEY = 'dialog_messages';
const DIALOG_INPUT_KEY = 'dialog_input';

/**
 * 存储参考图
 */
export async function storeReferenceImage(
  md5: string,
  blob: Blob,
  base64: string,
  proxyUrl: string,
  name: string
): Promise<string> {
  const database = await initDB();
  
  const record: ReferenceImageRecord = {
    key: md5,
    blob,
    base64,
    proxyUrl,
    name,
    createdAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);  // 使用 put 覆盖已存在的记录

    request.onsuccess = () => {
      console.log('[DialogDataDB] 存储参考图成功:', md5);
      resolve(md5);
    };

    request.onerror = () => {
      console.error('[DialogDataDB] 存储参考图失败:', request.error);
      reject(request.error);
    };
  });
}

/**
 * 获取所有参考图
 */
export async function getAllReferenceImages(): Promise<ReferenceImageRecord[]> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const records = request.result as ReferenceImageRecord[];
      console.log('[DialogDataDB] 获取所有参考图:', records.length, '张');
      resolve(records);
    };

    request.onerror = () => {
      console.error('[DialogDataDB] 获取参考图失败:', request.error);
      reject(request.error);
    };
  });
}

/**
 * 删除参考图
 */
export async function deleteReferenceImage(md5: string): Promise<void> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(md5);

    request.onsuccess = () => {
      console.log('[DialogDataDB] 删除参考图成功:', md5);
      resolve();
    };

    request.onerror = () => {
      console.error('[DialogDataDB] 删除参考图失败:', request.error);
      reject(request.error);
    };
  });
}

/**
 * 清空所有参考图
 */
export async function clearAllReferenceImages(): Promise<void> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      console.log('[DialogDataDB] 清空所有参考图');
      resolve();
    };

    request.onerror = () => {
      console.error('[DialogDataDB] 清空参考图失败:', request.error);
      reject(request.error);
    };
  });
}

// ==================== 消息历史存储 ====================

import { Message } from '@/types/canvas';

/**
 * 保存消息历史到 localStorage
 */
export function saveMessages(messages: Message[]): void {
  if (typeof window === 'undefined') return;
  
  try {
    // 过滤掉正在生成的消息，只保存完成的消息
    const messagesToSave = messages.filter(msg => !msg.isGenerating);
    
    // 🔧 #040 #041 #042 修复：检查 referenceImageKeys 而不是 referenceImages
    const processedMessages = messagesToSave.map(msg => {
      // 处理用户消息的参考图（检查 keys 而不是 images）
      if (msg.referenceImageKeys && msg.referenceImageKeys.length > 0) {
        const { referenceImages, ...rest } = msg;
        return {
          ...rest,
          // 保留 referenceImageKeys 用于恢复
          referenceImageKeys: msg.referenceImageKeys,
          hasReferenceImages: true,
        };
      }
      // 处理助手消息的生成图
      if (msg.role === 'assistant' && msg.imageUrlKey) {
        const { imageUrl, ...rest } = msg;
        return {
          ...rest,
          imageUrlKey: msg.imageUrlKey,
          hasImageUrl: true,
        };
      }
      return msg;
    });
    
    safeSetItem(DIALOG_MESSAGES_KEY, JSON.stringify(processedMessages));
    console.log('[DialogDataDB] 保存消息历史:', processedMessages.length, '条');
  } catch (e) {
    console.error('[DialogDataDB] 保存消息历史失败:', e);
  }
}

/**
 * 加载消息历史
 */
export function loadMessages(): Message[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const data = localStorage.getItem(DIALOG_MESSAGES_KEY);
    if (data) {
      const messages = JSON.parse(data) as Message[];
      console.log('[DialogDataDB] 加载消息历史:', messages.length, '条');
      return messages;
    }
  } catch (e) {
    console.error('[DialogDataDB] 加载消息历史失败:', e);
  }
  return [];
}

/**
 * 清空消息历史
 */
export function clearMessages(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(DIALOG_MESSAGES_KEY);
  // 同时清空图片 Key 映射表（旁路缓存）
  clearAllImageKeyMappings();
  console.log('[DialogDataDB] 清空消息历史');
}

// ==================== 输入框内容存储 ====================

/**
 * 保存输入框内容
 */
export function saveInputContent(content: string): void {
  if (typeof window === 'undefined') return;
  try {
    safeSetItem(DIALOG_INPUT_KEY, content);
  } catch (e) {
    console.error('[DialogDataDB] 保存输入内容失败:', e);
  }
}

/**
 * 加载输入框内容
 */
export function loadInputContent(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(DIALOG_INPUT_KEY) || '';
  } catch (e) {
    return '';
  }
}

/**
 * 清空输入框内容
 */
export function clearInputContent(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(DIALOG_INPUT_KEY);
}
