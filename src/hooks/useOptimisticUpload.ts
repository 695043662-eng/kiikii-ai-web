/**
 * 乐观上传 Hook（纯净逻辑层）
 * 
 * 功能：参考图上传的统一处理逻辑
 * 特性：
 * - 并行处理多张图片
 * - 并行读取 base64 和 arrayBuffer
 * - 乐观 UI：立即返回预览数据
 * - 后台静默上传 COS
 * - 后台存储 IndexedDB
 * 
 * 设计原则：
 * - 逻辑与视图分离（无 UI、无 DOM、无样式）
 * - 通过回调函数让调用方决定如何更新 UI
 */

import { useCallback } from 'react';
import { compressImageForUpload } from '@/lib/frontend-defense';
import { calculateMD5FromArrayBuffer } from '@/lib/reference-image-cache';

// ========== 类型定义 ==========

/** 单张图片处理结果 */
export interface OptimisticUploadResult {
  /** 原始文件名 */
  fileName: string;
  /** Base64 数据（用于预览） */
  base64: string;
  /** MD5 哈希（用于去重） */
  md5: string;
  /** 压缩后的 File 对象（用于后台上传） */
  compressedFile: File;
  /** #670 虚拟副本唯一标识（crypto.randomUUID），解决重复图片拖拽 key 冲突 */
  imageId: string;
}

/** 后台上传结果 */
export interface BackgroundUploadResult {
  fileName: string;
  md5: string;
  url: string;
  key: string;
  success: boolean;
  error?: string;
  /** #670 虚拟副本唯一标识（由 processFiles 合并传入，uploadToCOS 内部不生成） */
  imageId?: string;
}

// 🔧 #215 提交层拦截池：全局追踪正在上传的 Promise
// key: md5, value: 上传 Promise（只关心等待完成，不关心返回值）
export const globalPendingUploads = new Map<string, Promise<void>>();

/**
 * 等待所有正在上传的参考图完成
 * @returns 是否有等待的任务（true = 有任务且已完成，false = 无任务）
 */
export async function waitForPendingUploads(): Promise<boolean> {
  const promises = Array.from(globalPendingUploads.values());
  if (promises.length > 0) {
    console.log(`[PendingUploads] 等待 ${promises.length} 个上传任务完成...`);
    await Promise.allSettled(promises);
    console.log(`[PendingUploads] 所有上传任务已完成`);
    return true;  // 有任务且已完成
  }
  return true;  // 无任务也返回 true，表示可以继续
}

/**
 * 获取正在上传的任务数量
 */
export function getPendingUploadsCount(): number {
  return globalPendingUploads.size;
}

/** Hook 配置 */
export interface UseOptimisticUploadConfig {
  /** 日志前缀（用于区分调用来源） */
  logPrefix?: string;
  /** 最大图片数量 */
  maxImages?: number;
  /** 是否启用 IndexedDB 缓存 */
  enableCache?: boolean;
  /** 存储到 IndexedDB 的函数（可选） */
  onCacheStore?: (md5: string, base64: string, url: string, fileName: string) => Promise<void>;
}

/** Hook 返回值 */
export interface UseOptimisticUploadReturn {
  /** 处理文件上传（乐观 UI） */
  processFiles: (
    files: FileList | File[],
    options: {
      /** 当前已有的 MD5 列表（用于去重） */
      existingMd5s: string[];
      /** #669 虚拟副本：已有 MD5 对应的 URL 列表（极速秒传时复用） */
      existingUrls?: string[];
      /** #669 虚拟副本：已有 MD5 对应的 Key 列表（极速秒传时复用） */
      existingKeys?: string[];
      /** 当前已有的图片数量（用于计算剩余槽位） */
      currentCount: number;
      /** #659 动态最大图片数量（覆盖 Hook 配置的 maxImages） */
      maxImages?: number;
      /** #650 动态压缩大小上限 MB（视频模型如 Seedance 官方支持 30MB） */
      compressionMaxSizeMB?: number;
      /** 乐观 UI 回调：立即显示预览 */
      onOptimisticUpdate: (result: OptimisticUploadResult) => void;
      /** 后台上传完成回调 */
      onBackgroundComplete?: (result: BackgroundUploadResult) => void;
      /** 处理失败回调 */
      onError?: (fileName: string, error: string) => void;
      /** 数量不足回调 */
      onSlotsExhausted?: (requested: number, available: number) => void;
    }
  ) => Promise<OptimisticUploadResult[]>;
  /** 处理单张图片（核心逻辑） */
  processSingleFile: (file: File) => Promise<OptimisticUploadResult>;
  /** 后台上传到 COS */
  uploadToCOS: (compressedFile: File, md5: string, fileName: string) => Promise<BackgroundUploadResult>;
}

// ========== Hook 实现 ==========

export function useOptimisticUpload(config: UseOptimisticUploadConfig = {}): UseOptimisticUploadReturn {
  const {
    logPrefix = '[OptimisticUpload]',
    maxImages = 6,
    enableCache = true,
    onCacheStore,
  } = config;

  /**
   * 处理单张图片（核心逻辑）
   * 1. 压缩图片
   * 2. 并行读取 base64 和 arrayBuffer
   * 3. 计算 MD5
   */
  const processSingleFile = useCallback(async (file: File, compressionMaxSizeMB?: number): Promise<OptimisticUploadResult> => {
    console.log(`${logPrefix} 压缩图片:`, file.name, '原始大小:', (file.size / 1024 / 1024).toFixed(2), 'MB');
    
    // 1. 压缩图片（2048px / 3MB / JPEG），视频模型可传入更大的 maxSizeMB
    const compressedResult = await compressImageForUpload(file, compressionMaxSizeMB ? { maxSizeMB: compressionMaxSizeMB } : undefined);
    const compressedFile = compressedResult.file;
    
    console.log(`${logPrefix} 压缩后大小:`, (compressedFile.size / 1024 / 1024).toFixed(2), 'MB');
    
    // 2. 并行读取 base64 和 arrayBuffer
    const [base64, arrayBuffer] = await Promise.all([
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(compressedFile);
      }),
      compressedFile.arrayBuffer()
    ]);
    
    // 3. 计算 MD5
    const md5 = calculateMD5FromArrayBuffer(arrayBuffer);
    
    return {
      fileName: file.name,
      base64,
      md5,
      compressedFile,
      imageId: crypto.randomUUID(),  // #670 虚拟副本：生成唯一标识
    };
  }, [logPrefix]);

  /**
   * 后台上传到 COS（静默上传，不阻塞 UI）
   */
  const uploadToCOS = useCallback(async (
    compressedFile: File,
    md5: string,
    fileName: string
  ): Promise<BackgroundUploadResult> => {
    try {
      // 服务端中转上传 COS
      const formData = new FormData();
      formData.append('file', compressedFile);
      formData.append('assetType', 'temp');  // #804 画布图片→1号桶(临时)
      const uploadResponse = await fetch('/api/canvas/upload', { method: 'POST', body: formData });
      const uploadData = await uploadResponse.json();
      
      if (uploadData.success) {
        const signedUrl = `/api/canvas/image?key=${encodeURIComponent(uploadData.key)}`;
        // 存储到 IndexedDB（如果配置了）
        if (enableCache && onCacheStore) {
          await onCacheStore(md5, '', signedUrl, fileName);
        }
        
        console.log(`${logPrefix} ✅ 后台存储完成:`, fileName, 'key:', uploadData.key);
        
        return {
          fileName,
          md5,
          url: signedUrl,
          key: uploadData.key,
          success: true,
        };
      } else {
        return {
          fileName,
          md5,
          url: '',
          key: '',
          success: false,
          error: uploadData.error || '上传失败',
        };
      }
    } catch (error: any) {
      console.warn(`${logPrefix} 后台上传失败:`, fileName, error);
      return {
        fileName,
        md5,
        url: '',
        key: '',
        success: false,
        error: error.message || '上传异常',
      };
    }
  }, [logPrefix, enableCache, onCacheStore]);

  /**
   * 处理文件上传（乐观 UI）
   * 1. 计算可用槽位
   * 2. 并行处理所有图片
   * 3. 立即回调显示预览
   * 4. 后台静默上传
   */
  const processFiles = useCallback(async (
    files: FileList | File[],
    options: {
      existingMd5s: string[];
      existingUrls?: string[];
      existingKeys?: string[];
      currentCount: number;
      maxImages?: number;  // #659 动态最大数量
      compressionMaxSizeMB?: number;  // #650 动态压缩大小上限
      onOptimisticUpdate: (result: OptimisticUploadResult) => void;
      onBackgroundComplete?: (result: BackgroundUploadResult) => void;
      onError?: (fileName: string, error: string) => void;
      onSlotsExhausted?: (requested: number, available: number) => void;
    }
  ): Promise<OptimisticUploadResult[]> => {
    const { existingMd5s, existingUrls, existingKeys, currentCount, maxImages: dynamicMaxImages, compressionMaxSizeMB, onOptimisticUpdate, onBackgroundComplete, onError, onSlotsExhausted } = options;
    
    // #659 优先使用动态传入的 maxImages，否则使用 Hook 配置的默认值
    const effectiveMaxImages = dynamicMaxImages ?? maxImages;
    
    const filesArray = Array.from(files) as File[];
    
    // 计算剩余槽位
    const remainingSlots = effectiveMaxImages - currentCount;
    if (remainingSlots <= 0) {
      onSlotsExhausted?.(filesArray.length, 0);
      return [];
    }
    
    // 只处理剩余数量内的文件
    const filesToProcess = filesArray.slice(0, remainingSlots);
    
    if (filesToProcess.length === 0) {
      return [];
    }
    
    // 提示数量限制
    if (filesArray.length > filesToProcess.length) {
      onSlotsExhausted?.(filesArray.length, filesToProcess.length);
    }
    
    console.log(`${logPrefix} 处理 ${filesToProcess.length} 个文件`);
    
    // 并行处理所有图片
    const results: OptimisticUploadResult[] = [];
    
    await Promise.allSettled(filesToProcess.map(async (file) => {
      try {
        // 1. 处理单张图片（压缩、读取、计算 MD5）
        const result = await processSingleFile(file, compressionMaxSizeMB);
        
        // 2. #669 虚拟副本：极速秒传（物理去重 + 逻辑放行）
        // MD5 已存在时，不再拦截，而是作为"极速秒传"处理
        // 仍然调用 onOptimisticUpdate 添加预览，跳过 COS 上传，直接返回成功
        if (existingMd5s.includes(result.md5)) {
          const existingIdx = existingMd5s.indexOf(result.md5);
          const cachedUrl = existingUrls?.[existingIdx] || '';
          const cachedKey = existingKeys?.[existingIdx] || '';
          console.log(`${logPrefix} 极速秒传（虚拟副本）:`, file.name, '复用 URL:', cachedUrl ? '✅' : '⏳');
          
          // 乐观 UI：仍然添加预览（虚拟副本需要独立条目）
          onOptimisticUpdate(result);
          results.push(result);
          
          // 极速秒传：直接返回成功（复用已存在的 URL/Key）
          onBackgroundComplete?.({
            fileName: file.name,
            md5: result.md5,
            url: cachedUrl,
            key: cachedKey,
            success: true,
            imageId: result.imageId,  // #670 传递唯一标识
          });
          return;
        }
        
        // 3. 【乐观 UI】立即回调显示预览
        onOptimisticUpdate(result);
        results.push(result);
        
        console.log(`${logPrefix} ✅ 预览已显示:`, file.name);
        
        // 4. 【后台异步】上传 COS（不阻塞 UI）
        // 🔧 #215 提交层拦截池：追踪上传 Promise
        const uploadPromise: Promise<void> = uploadToCOS(result.compressedFile, result.md5, result.fileName)
          .then(uploadResult => {
            // 上传完成，从追踪器移除
            globalPendingUploads.delete(result.md5);
            
            // #048 修复：无论成功还是失败都调用 onBackgroundComplete
            // 让调用方知道上传已完成（可能成功可能失败）
            // #670 虚拟副本：合并 imageId
            onBackgroundComplete?.({ ...uploadResult, imageId: result.imageId });
          })
          .catch(error => {
            // 上传失败，也要从追踪器移除
            globalPendingUploads.delete(result.md5);
            
            // #048 修复：上传异常时也通知调用方
            // #670 虚拟副本：包含 imageId
            onBackgroundComplete?.({
              fileName: result.fileName,
              md5: result.md5,
              url: '',
              key: '',
              success: false,
              error: error.message || '上传异常',
              imageId: result.imageId,
            });
          });
        
        // 存入全局追踪器
        globalPendingUploads.set(result.md5, uploadPromise);
        
      } catch (error: any) {
        console.error(`${logPrefix} 处理失败:`, file.name, error);
        onError?.(file.name, error.message || '处理失败');
      }
    }));
    
    return results;
  }, [logPrefix, maxImages, processSingleFile, uploadToCOS]);

  return {
    processFiles,
    processSingleFile,
    uploadToCOS,
  };
}
