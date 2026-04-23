/**
 * 任务ID映射管理 - 存储到COS
 * 解决重启后用户看不到图片的问题
 */

import { uploadToCOS, downloadFromCOS, checkFileExists, deleteFromCOS } from '@/lib/cos';

const MAPPING_PREFIX = 'task-mappings/';

export interface TaskMapping {
  ourTaskId: string;
  terminalTaskId: string;
  userId?: string;
  index: number;
  requestParams?: any;
  createdAt: number;
}

/**
 * 保存映射到COS
 */
export async function saveTaskMapping(mapping: TaskMapping): Promise<void> {
  try {
    const key = `${MAPPING_PREFIX}${mapping.terminalTaskId}.json`;
    const content = JSON.stringify(mapping, null, 2);
    const buffer = Buffer.from(content, 'utf-8');

    await uploadToCOS(key, buffer, 'application/json');
    console.log(`[TaskMapping] 保存映射到COS: ${key}`);
  } catch (error) {
    console.error('[TaskMapping] 保存失败:', error);
    // 失败不影响主流程，静默处理
  }
}

/**
 * 从COS加载映射
 */
export async function loadTaskMapping(terminalTaskId: string): Promise<TaskMapping | null> {
  try {
    const key = `${MAPPING_PREFIX}${terminalTaskId}.json`;

    if (!await checkFileExists(key)) {
      return null;
    }

    const buffer = await downloadFromCOS(key);
    const content = buffer.toString('utf-8');
    const mapping = JSON.parse(content);

    console.log(`[TaskMapping] 从COS加载映射: ${key}`);
    return mapping;
  } catch (error) {
    console.error('[TaskMapping] 加载失败:', error);
    return null;
  }
}

/**
 * 删除映射
 */
export async function deleteTaskMapping(terminalTaskId: string): Promise<void> {
  try {
    const key = `${MAPPING_PREFIX}${terminalTaskId}.json`;
    await deleteFromCOS(key);
    console.log(`[TaskMapping] 删除映射: ${key}`);
  } catch (error) {
    console.error('[TaskMapping] 删除失败:', error);
    // 删除失败不影响主流程，静默处理
  }
}

/**
 * 批量删除映射（清理过期映射）
 */
export async function cleanupOldMappings(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  try {
    // 注意：这里需要实现COS的listObjects功能
    // 由于当前cos.ts没有实现listObjects，这里暂时跳过
    // 后续可以添加listObjects来批量删除过期映射
    console.log('[TaskMapping] 清理过期映射（暂未实现listObjects）');
  } catch (error) {
    console.error('[TaskMapping] 清理失败:', error);
  }
}
