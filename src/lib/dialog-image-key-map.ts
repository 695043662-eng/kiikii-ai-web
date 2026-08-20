/**
 * 对话图片 Key 映射表（增量模块，不侵入核心类型）
 * 
 * 功能：管理消息 ID 和图片 COS Key 的关联关系
 * 用途：刷新页面后，通过 imageKey 换取最新的预签名 URL
 * 
 * 数据结构：{ [messageId]: imageKey[] }
 */

const STORAGE_KEY = 'canvas_dialog_image_keys';
import { safeSetItem } from './safe-storage';

/**
 * 保存消息对应的图片 Key 列表
 */
export function saveImageKeyMapping(messageId: string, imageKeys: string[]): void {
  try {
    const map = getAllMappings();
    map[messageId] = imageKeys;
    safeSetItem(STORAGE_KEY, JSON.stringify(map));
    console.log('[ImageKeyMap] 保存映射:', messageId, '→', imageKeys.length, '个 key');
  } catch (error) {
    console.error('[ImageKeyMap] 保存失败:', error);
  }
}

/**
 * 获取消息对应的图片 Key 列表
 */
export function getImageKeyMapping(messageId: string): string[] | null {
  try {
    const map = getAllMappings();
    return map[messageId] || null;
  } catch (error) {
    console.error('[ImageKeyMap] 获取失败:', error);
    return null;
  }
}

/**
 * 获取所有映射关系
 */
export function getAllMappings(): Record<string, string[]> {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error('[ImageKeyMap] 解析失败:', error);
    return {};
  }
}

/**
 * 删除单条消息的映射
 */
export function removeImageKeyMapping(messageId: string): void {
  try {
    const map = getAllMappings();
    if (map[messageId]) {
      delete map[messageId];
      safeSetItem(STORAGE_KEY, JSON.stringify(map));
      console.log('[ImageKeyMap] 删除映射:', messageId);
    }
  } catch (error) {
    console.error('[ImageKeyMap] 删除失败:', error);
  }
}

/**
 * 清空所有映射（对话清空时调用）
 */
export function clearAllImageKeyMappings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    console.log('[ImageKeyMap] 已清空所有映射');
  } catch (error) {
    console.error('[ImageKeyMap] 清空失败:', error);
  }
}
