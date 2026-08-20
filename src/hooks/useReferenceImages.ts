/**
 * 参考图提取 Hook（#405 极简严苛模式）
 * 
 * 功能：
 * - 等待所有上传任务完成（带超时机制）
 * - 只提取带有 imageKey 的元素
 * - 换取 COS 签名 URL 发送
 * - 没有 imageKey 时直接阻断
 * 
 * #412 废弃 blob URL 转 base64 兜底：
 * - 原因：本地 /tmp 目录不稳定（重启丢失、热更新丢失、多实例不共享）
 * - 结果：所有画布图片都会后台静默上传 COS，获取 imageKey
 */

import { useCallback } from 'react';
import { globalPendingUploads } from './useOptimisticUpload';

// ========== 类型定义 ==========

/** 最新元素信息（从 stateRef 获取，只包含参考图相关字段） */
interface LatestElementInfo {
  imageKey?: string;
  imageUrl?: string;
}

/** 画布元素（简化版，用于函数参数） */
interface SourceElement {
  id: string;
  imageKey?: string;
  imageUrl?: string;
}

/** 参考图提取结果 */
export interface ReferenceImagesResult {
  /** 签名 URL 数组 */
  images: string[];
  /** 是否为 URL 类型（COS 签名 URL 为 true） */
  isUrls: boolean;
  /** 错误信息（有错误时阻断流程） */
  error?: string;
}

// ========== 常量 ==========

/** 上传等待超时时间（红线2：15秒） */
const UPLOAD_TIMEOUT = 15000;

// ========== Hook ==========

/**
 * 参考图提取 Hook
 */
export function useReferenceImages() {
  /**
   * 等待所有上传任务完成（红线2：超时机制）
   * @returns true=成功等待完成，false=超时
   */
  const waitForPendingUploads = useCallback(async (): Promise<boolean> => {
    const pendingMap = globalPendingUploads;
    
    if (pendingMap.size === 0) {
      return true;
    }

    console.log('[useReferenceImages] 等待上传完成, 数量:', pendingMap.size);

    const pendingPromises = Array.from(pendingMap.values());
    
    // 带超时的等待
    const timeoutPromise = new Promise<false>((resolve) => {
      setTimeout(() => {
        console.warn('[useReferenceImages] 等待上传超时');
        resolve(false);
      }, UPLOAD_TIMEOUT);
    });

    const uploadPromise = Promise.allSettled(pendingPromises).then(() => true);

    const result = await Promise.race([uploadPromise, timeoutPromise]);
    return result;
  }, []);

  /**
   * 从画布元素提取参考图（#405 极简严苛模式 + #452 闭包陷阱修复）
   *
   * 红线3：没有 imageKey 时阻断并报错
   *
   * #452 修复：添加 getLatestElement 参数，解决 React 闭包陷阱
   * - 问题：waitForPendingUploads() 完成后，dispatch 更新了 imageKey
   * - 但 React 状态更新是异步的，sourceEls 仍然是旧值
   * - 解决：传入 getLatestElement 函数，从 stateRef 获取最新值
   *
   * @param sourceEls 源元素数组（包含 ID 和可能的 imageKey）
   * @param getLatestElement 可选函数，用于获取最新的元素状态（解决闭包陷阱）
   * @returns 提取结果
   */
  const extractReferenceImages = useCallback(async (
    sourceEls: SourceElement[],
    getLatestElement?: (id: string) => LatestElementInfo | undefined
  ): Promise<ReferenceImagesResult> => {
    // ====== Step 1: 检查是否有参考图 ======
    if (sourceEls.length === 0) {
      // 没有参考图，直接返回空
      return { images: [], isUrls: false };
    }

    // ====== Step 2: 等待上传完成 ======
    const uploadSuccess = await waitForPendingUploads();
    if (!uploadSuccess) {
      return {
        images: [],
        isUrls: false,
        error: '参考图上传超时，请检查网络后重试',
      };
    }

    // ====== Step 3: 提取 imageKey（优先使用 getLatestElement 获取最新值）======
    // #452 修复：React 状态更新是异步的，sourceEls 可能还是旧值
    // 使用 getLatestElement 从 stateRef 获取最新的 imageKey
    let latestEls: LatestElementInfo[] = sourceEls;
    if (getLatestElement) {
      latestEls = sourceEls
        .map(el => {
          const latest = getLatestElement(el.id);
          if (latest) {
            console.log(`[useReferenceImages] #452 元素 ${el.id} 最新 imageKey: ${latest.imageKey || '(空)'}`);
            return latest;
          }
          return { imageKey: el.imageKey, imageUrl: el.imageUrl };
        })
        .filter((el): el is LatestElementInfo => el !== undefined);
      console.log('[useReferenceImages] #452 使用 getLatestElement 获取最新元素');
    }

    // 🔧 #461 诊断日志：打印每个元素的 imageKey 状态
    console.log('[useReferenceImages] #461 最新元素列表:');
    latestEls.forEach((el, i) => {
      console.log(`  [${i}] imageKey=${el.imageKey ? el.imageKey.substring(0, 20) + '...' : '❌缺失'}`);
    });

    const imageKeys = latestEls
      .map(el => el.imageKey)
      .filter((key): key is string => Boolean(key && key.length > 0));

    console.log('[useReferenceImages] 提取的 imageKeys:', imageKeys.length, '/', sourceEls.length);

    // ====== Step 4: 没有 imageKey 时直接阻断 ======
    if (imageKeys.length === 0) {
      console.error('[useReferenceImages] #461 ❌ 所有图片都缺少 imageKey！');
      console.error('[useReferenceImages] #461 原始 sourceEls:', sourceEls.map(el => ({
        id: el.id,
        imageKey: el.imageKey ? '有' : '空',
      })));
      console.error('[useReferenceImages] #461 latestEls:', latestEls.map(el => ({
        imageKey: el.imageKey ? '有' : '空',
        imageUrl: el.imageUrl ? el.imageUrl.substring(0, 50) + '...' : '空',
      })));
      console.error('  - 图片正在上传中，请稍后重试');
      console.error('  - 上传失败，请重新上传');
      return {
        images: [],
        isUrls: false,
        error: '部分参考图正在上传或数据丢失，请稍后重试',
      };
    }

    // 部分图片缺少 imageKey 时警告
    if (imageKeys.length < sourceEls.length) {
      console.warn(`[useReferenceImages] 部分图片缺少 imageKey: ${imageKeys.length}/${sourceEls.length}`);
    }

    // ====== Step 5: 换取 COS 签名 URL ======
    try {
      const res = await fetch('/api/canvas/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: imageKeys }),
      });

      if (!res.ok) {
        throw new Error(`获取签名URL失败: ${res.status}`);
      }

      const data = await res.json();
      
      if (!data.success || !data.urls) {
        throw new Error(data.error || '获取签名URL失败');
      }

      // 提取有效的签名 URL
      const signedUrls = imageKeys
        .map(key => data.urls[key])
        .filter((url): url is string => Boolean(url && url.length > 0));

      console.log('[useReferenceImages] 获取签名URL成功:', signedUrls.length);

      return {
        images: signedUrls,
        isUrls: true,  // COS 签名 URL
      };

    } catch (err) {
      console.error('[useReferenceImages] 获取签名URL失败:', err);
      return {
        images: [],
        isUrls: false,
        error: '获取参考图签名失败，请重试',
      };
    }
  }, [waitForPendingUploads]);

  return {
    waitForPendingUploads,
    extractReferenceImages,
  };
}
