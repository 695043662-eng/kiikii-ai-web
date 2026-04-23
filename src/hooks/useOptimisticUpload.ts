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
}

/** 后台上传结果 */
export interface BackgroundUploadResult {
  fileName: string;
  md5: string;
  url: string;
  key: string;
  success: boolean;
  error?: string;
}

// 🔧 #215 提交层拦截池：全局追踪正在上传的 Promise
// key: md5, value: 上传 Promise（只关心等待完成，不关心返回值）
export const globalPendingUploads = new Map<string, Promise<void>>();

/**
 * 等待所有正在上传的参考图完成
 * @returns 等待完成的 Promise
 */
export async function waitForPendingUploads(): Promise<void> {
  const promises = Array.from(globalPendingUploads.values());
  if (promises.length > 0) {
    console.log(`[PendingUploads] 等待 ${promises.length} 个上传任务完成...`);
    await Promise.allSettled(promises);
    console.log(`[PendingUploads] 所有上传任务已完成`);
  }
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
      /** 当前已有的图片数量（用于计算剩余槽位） */
      currentCount: number;
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
  const processSingleFile = useCallback(async (file: File): Promise<OptimisticUploadResult> => {
    console.log(`${logPrefix} 压缩图片:`, file.name, '原始大小:', (file.size / 1024 / 1024).toFixed(2), 'MB');
    
    // 1. 压缩图片（2048px / 3MB / JPEG）
    const compressedResult = await compressImageForUpload(file);
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
      const formData = new FormData();
      formData.append('file', compressedFile);
      
      const uploadRes = await fetch('/api/canvas/upload', { method: 'POST', body: formData });
      const uploadData = await uploadRes.json();
      
      if (uploadData.success && uploadData.url) {
        // 存储到 IndexedDB（如果配置了）
        if (enableCache && onCacheStore) {
          await onCacheStore(md5, '', uploadData.url, fileName);
        }
        
        console.log(`${logPrefix} ✅ 后台存储完成:`, fileName, 'key:', uploadData.key);
        
        return {
          fileName,
          md5,
          url: uploadData.url,
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
      currentCount: number;
      onOptimisticUpdate: (result: OptimisticUploadResult) => void;
      onBackgroundComplete?: (result: BackgroundUploadResult) => void;
      onError?: (fileName: string, error: string) => void;
      onSlotsExhausted?: (requested: number, available: number) => void;
    }
  ): Promise<OptimisticUploadResult[]> => {
    const { existingMd5s, currentCount, onOptimisticUpdate, onBackgroundComplete, onError, onSlotsExhausted } = options;
    
    const filesArray = Array.from(files) as File[];
    
    // 计算剩余槽位
    const remainingSlots = maxImages - currentCount;
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
        const result = await processSingleFile(file);
        
        // 2. 去重检查
        // #240 修复：MD5 重复时也要通知调用方，让 uploadingCount 能正确递减
        if (existingMd5s.includes(result.md5)) {
          console.log(`${logPrefix} 图片已存在，跳过:`, file.name);
          // 通知调用方：这张图被拦截了（MD5 重复），但处理已完成
          onBackgroundComplete?.({
            fileName: file.name,
            md5: result.md5,
            url: '',
            key: '',
            success: false,
            error: '图片已存在，已跳过',
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
            onBackgroundComplete?.(uploadResult);
          })
          .catch(error => {
            // 上传失败，也要从追踪器移除
            globalPendingUploads.delete(result.md5);
            
            // #048 修复：上传异常时也通知调用方
            onBackgroundComplete?.({
              fileName: result.fileName,
              md5: result.md5,
              url: '',
              key: '',
              success: false,
              error: error.message || '上传异常',
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
