'use client';

import { useCallback, useRef } from 'react';
// ⚠️ 防御机制：防止并发请求 + 幂等性保护
import { RequestLock, generateClientRequestId } from '@/lib/frontend-defense';
// ⚠️ 认证失效处理
import { handleAuthFailure } from '@/lib/auth-failure';

// ========== 类型定义 ==========

// 生成进度
export interface GenProgress {
  completed: number;
  total: number;
  waiting?: number;
}

// 图片事件
export interface ImageEvent {
  index: number;
  url: string;
  key?: string;
  status?: 'completed' | 'failed';
  error?: string;
  // 占位符信息
  placeholderId?: string;
}

// 单个图片项
export interface ImageItem {
  index: number;
  url: string | null;
  key: string | null;
  status: 'completed' | 'failed' | 'generating';
  error: string | null;
}

// 占位符信息（用于画布页面坐标锁定）
export interface PlaceholderInfo {
  id: string;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// 视频进度
export interface VideoProgress {
  progress: number;  // 0-100 百分比
  status: string;
}

// 视频事件
export interface VideoEvent {
  url: string;
  key?: string;
  thumbnailUrl?: string;
}

// 视频结果
export interface VideoResult {
  videos: string[];
  videoKeys?: string[];
  thumbnails?: string[];
  creditsCharged?: number;
  creditsBalance?: number;
}

// 生成结果
export interface GenResult {
  imageUrls: string[];
  imageKeys: string[];
  imageItems?: ImageItem[];
  creditsCharged?: number;
  creditsBalance?: number;
  errors?: Array<{ index: number; error: string }>;
  // 占位符替换信息
  placeholderReplacements?: Array<{
    placeholderId: string;
    imageUrl: string;
    imageKey?: string;
    index: number;
  }>;
  // 视频相关（用于视频生成）
  videos?: string[];
  videoKeys?: string[];
  thumbnails?: string[];
  videoProgress?: number;
  // #209 新增：任务ID（用于幂等保存）
  taskId?: string;
  // #231 新增：用于生成历史记录
  source?: 'canvas' | 'generate';
  prompt?: string;
  model?: string;
  resolution?: string;
  aspectRatio?: string;
}

// 生成错误
export interface GenError {
  type: 'global' | 'item';
  index?: number;
  message: string;
  taskId?: string;
  // 用于清理占位符
  placeholderIds?: string[];
}

// 生成服务配置
export interface GenServiceConfig {
  // 生成模式
  mode?: 'image' | 'video';
  
  // #231 新增：来源标识（用于历史记录）
  source?: 'canvas' | 'generate';
  
  // API 端点
  apiEndpoint?: '/api/image-to-image' | '/api/text-to-image' | '/api/video/generate';
  
  // 请求参数
  prompt: string;
  model: string;
  resolution: string;
  aspectRatio: string;
  generationCount: number;
  images?: string[];
  isUrls?: boolean;
  md5Hashes?: string[];
  taskId?: string;
  userId?: string | number;
  
  // ========== 画布占位符支持（仅图片模式）==========
  // 如果提供这些回调，生成的图片会替换到对应占位符位置
  // #093 修复：增加 taskId 参数，让占位符在创建时就有 generationTaskId
  onBeforeGenerate?: (count: number, prompt: string, taskId: string) => PlaceholderInfo[];
  onImageReceived?: (data: ImageEvent) => void;
  // 【修正】onPlaceholderFailed：改为更新失败状态，而非删除
  // 调用方应使用 canvas.updateElement(elementId, { generationStatus: 'failed', generationError: error })
  onPlaceholderFailed?: (elementId: string, error: string) => void;
  
  // ========== 任务ID替换（干净替换法）==========
  // SSE 收到 start 事件时触发，将 elementId 对应的占位符的 generationTaskId 替换为 actualTaskId
  // 用于刷新后轮询恢复
  onActualTaskIdReceived?: (elementId: string, actualTaskId: string) => void;
  
  // ========== 视频模式回调（仅视频模式）==========
  onVideoProgress?: (progress: VideoProgress) => void;
  onVideoReceived?: (data: VideoEvent) => void;
  
  // 回调
  onProgress?: (progress: GenProgress) => void;
  onComplete?: (result: GenResult) => void;
  onError?: (error: GenError) => void;
}

// 服务结果
export interface GenServiceResult {
  taskId: string;
  success: boolean;
  message?: string;
}

// 任务状态（用于轮询）
interface TaskStatus {
  status: 'pending' | 'generating' | 'completed' | 'failed';
  taskId?: string;  // #231 任务 ID
  imageUrls?: string[];
  imageKeys?: string[];
  imageItems?: ImageItem[];
  error?: string;
  errors?: Array<{ index: number; error: string }>;
  creditsCharged?: number;
  creditsBalance?: number;
  // #231 新增：用于生成历史记录
  source?: string;
  prompt?: string;
  model?: string;
  resolution?: string;
  aspectRatio?: string;
}

// ========== 辅助函数 ==========

// 处理 imageItems 和 deletedUrls，返回正确的状态
export function processImageItemsWithDeletedFilter(
  imageUrls: string[],
  imageItems: ImageItem[] | undefined,
  errors: Array<{ index: number; error: string }> | undefined,
  deletedUrls?: Set<string>
): {
  orderedImages: string[];
  orderedImageKeys: string[];
  newItemStatuses: ('pending' | 'completed' | 'failed' | 'generating')[];
  newItemErrors: (string | null)[];
} {
  let orderedImages: string[];
  let orderedImageKeys: string[];
  let newItemStatuses: ('completed' | 'failed' | 'generating')[];
  let newItemErrors: (string | null)[];

  if (imageItems && Array.isArray(imageItems)) {
    orderedImages = imageItems
      .filter((item) => item.status === 'completed' && item.url && !(deletedUrls?.has(item.url)))
      .map((item) => item.url as string);
    orderedImageKeys = imageItems
      .filter((item) => item.status === 'completed' && item.key && !(deletedUrls?.has(item.url!)))
      .map((item) => item.key as string);
    
    newItemStatuses = imageItems.map((item) => {
      if (item?.url && deletedUrls?.has(item.url)) {
        return 'failed';
      }
      return item?.status || 'generating';
    });
    
    newItemErrors = imageItems.map((item) => {
      if (item?.url && deletedUrls?.has(item.url)) {
        return '已删除';
      }
      if (item?.status === 'failed' && item.error) {
        return item.error;
      }
      return item?.status === 'failed' ? '生成失败' : null;
    });
  } else {
    orderedImages = imageUrls.filter(url => !deletedUrls?.has(url));
    orderedImageKeys = [];
    newItemStatuses = [];
    newItemErrors = [];
  }

  return { orderedImages, orderedImageKeys, newItemStatuses, newItemErrors };
}

// ========== useGenService Hook ==========

// ⚠️ 全局请求锁（单例模式）- 防止用户在生图期间触发并发请求
let globalRequestLock: InstanceType<typeof RequestLock> | null = null;

function getRequestLock(): InstanceType<typeof RequestLock> {
  if (!globalRequestLock) {
    globalRequestLock = new RequestLock();
  }
  return globalRequestLock;
}

export function useGenService() {
  // ⚠️ 防御：获取全局请求锁
  const requestLock = getRequestLock();
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollingTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const currentTaskIdRef = useRef<string | null>(null);
  const placeholdersRef = useRef<Map<number, PlaceholderInfo>>(new Map());

  // 停止轮询
  const stopPolling = useCallback((taskId: string) => {
    const timer = pollingTimersRef.current.get(taskId);
    if (timer) {
      clearTimeout(timer);
      pollingTimersRef.current.delete(taskId);
    }
  }, []);

  // 停止所有轮询
  const stopAllPolling = useCallback(() => {
    pollingTimersRef.current.forEach((timer) => {
      clearTimeout(timer);
    });
    pollingTimersRef.current.clear();
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // 中断请求
  const abortRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // 获取占位符 ID
  const getPlaceholderId = useCallback((index: number): string | undefined => {
    return placeholdersRef.current.get(index)?.id;
  }, []);

  // 轮询获取任务状态
  const pollTaskStatus = useCallback(async (
    taskId: string,
    apiEndpoint: string,
    config: GenServiceConfig,
    generationCount: number,
    deletedUrls?: Set<string>
  ): Promise<TaskStatus | null> => {
    // 【修正】轮询参数：100 次 × 3 秒 = 300 秒，与后端超时逻辑对齐
    const maxPolls = 100;
    const pollInterval = 3000;
    
    // 🔧 #224 诊断：记录轮询开始时间
    const pollStartTime = Date.now();
    console.log('[GenService] #224 pollTaskStatus 开始:', { 
      taskId: taskId?.substring(0, 15), 
      apiEndpoint, 
      generationCount,
      maxPolls,
      pollInterval,
      isAborted: abortControllerRef.current?.signal.aborted
    });
    
    for (let i = 0; i < maxPolls; i++) {
      // 🔧 #224 诊断：检查中断状态
      if (abortControllerRef.current?.signal.aborted) {
        console.log('[GenService] #224 轮询已中断:', { 
          pollIndex: i, 
          elapsed: Date.now() - pollStartTime 
        });
        return null;
      }
      
      try {
        const requestUrl = `${apiEndpoint}?taskId=${taskId}`;
        console.log(`[GenService] #224 轮询请求 #${i}:`, requestUrl);
        
        const response = await fetch(requestUrl, {
          signal: abortControllerRef.current?.signal,
        });
        
        console.log(`[GenService] #224 轮询响应 #${i}:`, { 
          status: response.status, 
          ok: response.ok 
        });
        
        if (!response.ok) {
          console.error('[GenService] #224 查询失败:', response.status);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }
        
        const data = await response.json();
        console.log(`[GenService] #224 轮询数据 #${i}:`, { 
          status: data.status, 
          imageUrls: data.imageUrls?.length,
          imageItems: data.imageItems?.length,
          completedCount: data.completedCount
        });
        
        if (data.status === 'completed') {
          const { orderedImages, orderedImageKeys, newItemStatuses, newItemErrors } = 
            processImageItemsWithDeletedFilter(
              data.imageUrls || [],
              data.imageItems,
              data.errors,
              deletedUrls
            );
          
          return {
            status: 'completed',
            imageUrls: orderedImages,
            imageKeys: orderedImageKeys,
            imageItems: data.imageItems?.map((item: ImageItem, idx: number) => ({
              ...item,
              status: newItemStatuses[idx] || item.status,
              error: newItemErrors[idx] || item.error,
            })),
            creditsCharged: data.creditsCharged,
            creditsBalance: data.creditsBalance,
          };
        } else if (data.status === 'failed') {
          return {
            status: 'failed',
            error: data.error || '生成失败',
            errors: data.errors,
          };
        } else if (data.status === 'generating') {
          // #230 修复：如果 completedCount >= generationCount，认为任务完成
          const actualCompletedCount = data.completedCount || data.imageItems?.filter((item: ImageItem) => item.status === 'completed').length || 0;
          
          if (actualCompletedCount >= generationCount) {
            console.log(`[GenService] #230 后端状态滞后，但 completedCount=${actualCompletedCount} >= generationCount=${generationCount}，认为完成`);
            const { orderedImages, orderedImageKeys, newItemStatuses, newItemErrors } = 
              processImageItemsWithDeletedFilter(
                data.imageUrls || [],
                data.imageItems,
                data.errors,
                deletedUrls
              );
            
            return {
              status: 'completed',
              imageUrls: orderedImages,
              imageKeys: orderedImageKeys,
              imageItems: data.imageItems?.map((item: ImageItem, idx: number) => ({
                ...item,
                status: newItemStatuses[idx] || item.status,
                error: newItemErrors[idx] || item.error,
              })),
              creditsCharged: data.creditsCharged,
              creditsBalance: data.creditsBalance,
              // #231 新增：用于生成历史记录
              source: config.source,
              prompt: config.prompt,
              model: config.model,
              resolution: config.resolution,
              aspectRatio: config.aspectRatio,
            };
          }
          
          config.onProgress?.({
            completed: data.completedCount || 0,
            total: generationCount,
            waiting: generationCount - (data.completedCount || 0),
          });
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        } else {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.log('[GenService] #224 查询已中止 (AbortError):', { 
            errorMessage: error.message,
            elapsed: Date.now() - pollStartTime 
          });
          return null;
        }
        console.error('[GenService] #224 查询异常:', { 
          errorName: error.name, 
          errorMessage: error.message,
          elapsed: Date.now() - pollStartTime 
        });
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    // 轮询超时，最后查询一次
    console.log('[GenService] #224 轮询超时，最后查询一次');
    try {
      const response = await fetch(`${apiEndpoint}?taskId=${taskId}`, {
        signal: abortControllerRef.current?.signal,
      });
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'completed') {
          const { orderedImages, orderedImageKeys } = 
            processImageItemsWithDeletedFilter(
              data.imageUrls || [],
              data.imageItems,
              data.errors,
              deletedUrls
            );
          return {
            status: 'completed',
            imageUrls: orderedImages,
            imageKeys: orderedImageKeys,
            imageItems: data.imageItems,
            creditsCharged: data.creditsCharged,
            creditsBalance: data.creditsBalance,
            // #231 新增：用于生成历史记录
            source: config.source,
            prompt: config.prompt,
            model: config.model,
            resolution: config.resolution,
            aspectRatio: config.aspectRatio,
          };
        }
      }
    } catch (error) {
      console.error('[GenService] 最终查询失败:', error);
    }
    
    return { status: 'failed', error: '轮询超时，图片可能仍在生成中' };
  }, []);

  // 核心生成函数
  const generate = useCallback(async (config: GenServiceConfig): Promise<GenServiceResult> => {
    const {
      mode = 'image',
      apiEndpoint = mode === 'video' ? '/api/video/generate' : '/api/image-to-image',
      prompt,
      model,
      resolution,
      aspectRatio,
      generationCount,
      images,
      isUrls = false,
      md5Hashes,
      taskId: providedTaskId,
      userId,
      onBeforeGenerate,
    } = config;

    // ⚠️ 防御1：尝试获取锁（计数锁，支持 5 个并发）
    // 如果当前有 5 个任务在执行，会自动排队等待
    const acquired = await requestLock.acquire();
    if (!acquired) {
      console.log('[GenService] ⚠️ 获取锁失败');
      config.onError?.({
        type: 'global',
        message: '获取锁失败，请重试',
      });
      return { taskId: '', success: false, message: '获取锁失败' };
    }

    // ⚠️ 防御2：生成 client_request_id，用于幂等性保护
    const clientRequestId = requestLock.getClientRequestId();
    console.log('[GenService] ✅ 锁已获取，client_request_id:', clientRequestId, '当前并发:', requestLock.getActiveCount());

    // #093 修复：先生成 taskId，再创建占位符
    // 这样占位符在创建时就有 generationTaskId，刷新后也能恢复
    // #094 防弹微调：使用 crypto.randomUUID() 替代 Date.now()，避免高并发 ID 碰撞
    const taskId = providedTaskId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    currentTaskIdRef.current = taskId;
    console.log('[GenService] 预生成 taskId:', taskId);

    // 清空占位符映射
    placeholdersRef.current.clear();

    // ========== 画布占位符支持：生成前创建占位符 ==========
    let placeholderReplacements: Array<{ placeholderId: string; index: number }> = [];
    
    if (onBeforeGenerate) {
      console.log('[GenService] 创建占位符（带 taskId）...');
      const placeholders = onBeforeGenerate(generationCount, prompt, taskId);
      
      // 存储占位符映射
      placeholders.forEach((p, idx) => {
        placeholdersRef.current.set(idx, p);
        placeholderReplacements.push({ placeholderId: p.id, index: idx });
      });
      
      console.log('[GenService] 已创建占位符:', placeholderReplacements);
    }

    // 创建 AbortController
    abortControllerRef.current = new AbortController();
    
    // 构建请求体（⚠️ 防御3：添加 client_request_id）
    const requestBody: Record<string, any> = {
      taskId,
      prompt: prompt.trim(),
      model,
      resolution: resolution.toUpperCase(),
      aspectRatio,
      generationCount,
      md5Hashes: md5Hashes || [],
      // 视频模式标识
      mode,
      // ⚠️ 幂等性保护：携带 client_request_id
      client_request_id: clientRequestId,
    };

    if (images && images.length > 0) {
      requestBody.images = images;
      requestBody.isUrls = isUrls;
    }

    if (userId) {
      requestBody.userId = userId;
    }

    console.log('[GenService] 发送请求:', {
      taskId,
      model,
      resolution,
      aspectRatio,
      generationCount,
      imageCount: images?.length || 0,
      isUrls,
      placeholderCount: placeholderReplacements.length,
      userId: userId || '未传递',  // 🔒 军规日志
    });

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        // 🛡️ 维度一：认证失效自动处理
        let errorMsg = `请求失败: ${response.status}`;
        let isAuthFailed = false;
        
        try {
          const errData = await response.json();
          if (errData.error) {
            errorMsg = errData.error;
            
            // 🔥 认证失效检测：401 或 "用户不存在" 等
            if (response.status === 401 || 
                errorMsg.includes('用户不存在') || 
                errorMsg.includes('未登录') ||
                errorMsg.includes('TOKEN_EXPIRED')) {
              isAuthFailed = true;
              handleAuthFailure(errorMsg, response.status);
              throw new Error('REDIRECT_TO_LOGIN');
            }
            
            if (errData.currentCredits !== undefined) {
              errorMsg = `积分不足（当前: ${errData.currentCredits}, 需要: ${errData.requiredCredits}）`;
            }
          }
        } catch (jsonError: any) {
          // 如果是我们主动跳转的错误，继续抛出
          if (jsonError.message === 'REDIRECT_TO_LOGIN') {
            throw jsonError;
          }
          // 其他 JSON 解析错误，忽略
        }
        
        // 请求失败，清理占位符（非认证失效情况）
        if (!isAuthFailed && placeholderReplacements.length > 0) {
          placeholderReplacements.forEach(({ placeholderId }) => {
            config.onPlaceholderFailed?.(placeholderId, errorMsg);
          });
        }
        
        throw new Error(errorMsg);
      }

      const contentType = response.headers.get('content-type');

      if (contentType?.includes('text/event-stream')) {
        return await handleSSEStream(
          response, 
          taskId, 
          apiEndpoint, 
          config, 
          generationCount,
          placeholderReplacements,
          requestLock  // ⚠️ 防御：传递锁实例
        );
      } else {
        const data = await response.json();
        
        if (data.success === false) {
          // 清理占位符
          if (placeholderReplacements.length > 0) {
            placeholderReplacements.forEach(({ placeholderId }) => {
              config.onPlaceholderFailed?.(placeholderId, data.error || '生成失败');
            });
          }
          throw new Error(data.error || '生成失败');
        }

        // 直接返回结果
        const result: GenResult = {
          imageUrls: data.imageUrls || [],
          imageKeys: data.imageKeys || [],
          imageItems: data.imageItems,
          creditsCharged: data.creditsCharged,
          creditsBalance: data.creditsBalance,
          taskId,  // #209 新增：传递 taskId
          placeholderReplacements: placeholderReplacements.map((p, idx) => ({
            ...p,
            imageUrl: data.imageUrls?.[idx] || '',
            imageKey: data.imageKeys?.[idx] || undefined,
          })),
        };
        
        config.onComplete?.(result);
        // ⚠️ 防御4：成功完成，释放锁
        requestLock.release();
        return { taskId, success: true };
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('[GenService] 请求已中止');
        // 清理占位符
        if (placeholderReplacements.length > 0) {
          placeholderReplacements.forEach(({ placeholderId }) => {
            config.onPlaceholderFailed?.(placeholderId, '用户取消');
          });
        }
        // ⚠️ 防御5：用户取消，释放锁
        requestLock.release();
        return { taskId, success: false, message: '用户取消' };
      }
      
      console.error('[GenService] 请求失败:', error);
      
      // 清理占位符
      if (placeholderReplacements.length > 0) {
        placeholderReplacements.forEach(({ placeholderId }) => {
          config.onPlaceholderFailed?.(placeholderId, error.message || '网络错误');
        });
      }
      
      config.onError?.({
        type: 'global',
        message: error.message || '网络错误',
        taskId,
        placeholderIds: placeholderReplacements.map(p => p.placeholderId),
      });
      // ⚠️ 防御6：请求失败，释放锁
      requestLock.release();
      return { taskId, success: false, message: error.message };
    } finally {
      // 清空占位符引用
      placeholdersRef.current.clear();
    }
  }, [abortRequest, requestLock]);

  // SSE 流处理
  const handleSSEStream = useCallback(async (
    response: Response,
    taskId: string,
    apiEndpoint: string,
    config: GenServiceConfig,
    generationCount: number,
    placeholderReplacements: Array<{ placeholderId: string; index: number }>,
    requestLock: InstanceType<typeof RequestLock>  // ⚠️ 防御：传递锁实例
  ): Promise<GenServiceResult> => {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let receivedCount = 0;
    let completedIndices = new Set<number>();
    let failedIndices = new Set<number>();
    let pendingPlaceholders = new Set(placeholderReplacements.map(p => p.placeholderId));

    // 构建 index -> placeholderId 映射
    const indexToPlaceholderId = new Map<number, string>();
    placeholderReplacements.forEach(p => {
      indexToPlaceholderId.set(p.index, p.placeholderId);
    });

    // 处理单行数据
    const processLine = (line: string) => {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          
          switch (data.type) {
            case 'ping':
              break;
              
            case 'start':
              // 收到后端返回的 actualTaskId，触发干净替换
              console.log('[GenService] 收到 start 事件:', { taskId: data.taskId, count: data.count, placeholderCount: placeholderReplacements.length });
              if (data.taskId && config.onActualTaskIdReceived) {
                const actualTaskId = data.taskId;
                placeholderReplacements.forEach(({ placeholderId }) => {
                  console.log('[GenService] 触发 onActualTaskIdReceived:', { placeholderId, actualTaskId });
                  config.onActualTaskIdReceived!(placeholderId, actualTaskId);
                });
              }
              break;
              
            case 'image':
              if (data.url) {
                receivedCount++;
                if (data.index !== undefined) {
                  completedIndices.add(data.index);
                }
                
                const placeholderId = data.index !== undefined 
                  ? indexToPlaceholderId.get(data.index) 
                  : undefined;
                
                config.onImageReceived?.({
                  index: data.index ?? receivedCount - 1,
                  url: data.url,
                  key: data.imageKey,  // 后端发送的是 imageKey，不是 key
                  status: 'completed',
                  placeholderId,
                });
                
                config.onProgress?.({
                  completed: receivedCount,
                  total: generationCount,
                });
              }
              break;
              
            case 'item_failed':
              if (data.index !== undefined) {
                failedIndices.add(data.index);
                const placeholderId = indexToPlaceholderId.get(data.index);
                
                config.onImageReceived?.({
                  index: data.index,
                  url: '',
                  error: data.error || '提交失败',
                  status: 'failed',
                  placeholderId,
                });
                
                if (placeholderId) {
                  pendingPlaceholders.delete(placeholderId);
                  config.onPlaceholderFailed?.(placeholderId, data.error || '提交失败');
                }
              }
              break;

            // ========== 视频进度事件 ==========
            case 'progress':
              // 视频生成进度（0-100）
              if (config.mode === 'video' && data.progress !== undefined) {
                config.onVideoProgress?.({
                  progress: data.progress,
                  status: data.status || 'processing',
                });
                
                // 同时触发 onProgress 用于进度条
                config.onProgress?.({
                  completed: data.progress,
                  total: 100,
                });
              }
              break;
              
            case 'video':
              // 视频生成完成（单个）
              if (config.mode === 'video' && data.url) {
                config.onVideoReceived?.({
                  url: data.url,
                  key: data.key,
                  thumbnailUrl: data.thumbnailUrl,
                });
              }
              break;
              
            case 'videos':
              // 视频组完成（兼容某些 API 返回格式）
              if (config.mode === 'video' && data.videos) {
                data.videos.forEach((v: string, idx: number) => {
                  config.onVideoReceived?.({
                    url: v,
                    key: data.videoKeys?.[idx],
                    thumbnailUrl: data.thumbnails?.[idx],
                  });
                });
              }
              break;
              
            case 'error':
              if (data.index !== undefined) {
                failedIndices.add(data.index);
                const placeholderId = indexToPlaceholderId.get(data.index);
                
                config.onImageReceived?.({
                  index: data.index,
                  url: '',
                  error: data.error || '生成失败',
                  status: 'failed',
                  placeholderId,
                });
                
                if (placeholderId) {
                  pendingPlaceholders.delete(placeholderId);
                  config.onPlaceholderFailed?.(placeholderId, data.error || '生成失败');
                }
              } else if (data.taskId) {
                config.onError?.({
                  type: 'global',
                  message: data.error || '生成失败',
                  taskId: data.taskId,
                  placeholderIds: Array.from(pendingPlaceholders),
                });
              }
              break;
              
            case 'complete':
              console.log('[GenService] 收到 complete 事件, mode:', config.mode);
              
              // 处理所有占位符替换（仅图片模式）
              let result: GenResult;
              
              if (config.mode === 'video') {
                // 视频模式：返回视频结果
                result = {
                  imageUrls: [],
                  imageKeys: [],
                  videos: data.videos || [],
                  videoKeys: data.videoKeys || [],
                  thumbnails: data.thumbnails || [],
                  creditsCharged: data.creditsCharged,
                  creditsBalance: data.creditsBalance,
                  taskId,  // #209 新增：传递 taskId
                  // #231 新增：用于生成历史记录
                  source: config.source,
                  prompt: config.prompt,
                  model: config.model,
                };
              } else {
                // 图片模式：处理占位符替换
                // #229 修复：修复竞态条件 - 不要在 complete 中误杀正在异步处理的图片
                const replacements: Array<{
                  placeholderId: string;
                  index: number;
                  imageUrl: string;
                  imageKey?: string;
                }> = [];
                
                placeholderReplacements.forEach(p => {
                  const item = data.imageItems?.find((img: ImageItem) => img.index === p.index);
                  const imageUrl = item?.url || '';
                  const imageKey = item?.key;
                  const itemStatus = item?.status;
                  
                  // #229 关键修复：检查是否在 SSE 流中已经收到了这张图片
                  // 如果 completedIndices 包含该索引，说明 onImageReceived 已经被调用，正在异步处理中
                  // 此时不要做任何操作，让异步操作自然完成
                  if (completedIndices.has(p.index)) {
                    console.log(`[GenService] #229 占位符 ${p.placeholderId} (index ${p.index}) 已在 SSE 流中收到，跳过 complete 处理，等待异步完成`);
                    return; // 跳过，不做任何处理
                  }
                  
                  // 检查后端返回的状态
                  const isCompleted = itemStatus === 'completed';
                  const isFailed = itemStatus === 'failed';
                  
                  if (isCompleted && imageUrl) {
                    // 后端确认成功，且有 URL（可能是轮询恢复的情况）
                    replacements.push({
                      placeholderId: p.placeholderId,
                      index: p.index,
                      imageUrl,
                      imageKey,
                    });
                    console.log(`[GenService] #229 占位符 ${p.placeholderId} (index ${p.index}) 后端确认成功，加入替换列表`);
                  } else if (isFailed) {
                    // 后端明确说失败了
                    console.log(`[GenService] #229 占位符 ${p.placeholderId} (index ${p.index}) 后端确认失败`);
                    const errorMsg = item?.error || 
                                    data.errors?.find((e: { index: number; error: string }) => e.index === p.index)?.error || 
                                    '生成失败';
                    config.onPlaceholderFailed?.(p.placeholderId, errorMsg);
                    pendingPlaceholders.delete(p.placeholderId);
                  } else if (imageUrl) {
                    // 有 URL 但状态不明确，当作成功处理
                    replacements.push({
                      placeholderId: p.placeholderId,
                      index: p.index,
                      imageUrl,
                      imageKey,
                    });
                    console.log(`[GenService] #229 占位符 ${p.placeholderId} (index ${p.index}) 有 URL，加入替换列表`);
                  } else {
                    // 没有任何信息，可能是还在处理中
                    console.log(`[GenService] #229 占位符 ${p.placeholderId} (index ${p.index}) 状态不明确，暂不处理`);
                  }
                });
                
                result = {
                  imageUrls: data.imageUrls || [],
                  imageKeys: data.imageKeys || [],
                  imageItems: data.imageItems,
                  creditsCharged: data.creditsCharged,
                  creditsBalance: data.creditsBalance,
                  errors: data.errors,
                  placeholderReplacements: replacements,
                  taskId,  // #209 新增：传递 taskId
                  // #231 新增：用于生成历史记录
                  source: config.source,
                  prompt: config.prompt,
                  model: config.model,
                  resolution: config.resolution,
                  aspectRatio: config.aspectRatio,
                };
              }
              
              config.onComplete?.(result);
              stopPolling(taskId);
              // ⚠️ 防御7：SSE 完成，释放锁
              requestLock.release();
              return true;
          }
        } catch (e) {
          console.error('[GenService] 解析事件失败:', e, line);
        }
      }
      return false;
    };

    // 读取流
    while (reader) {
      const { done, value } = await reader.read();
      
      if (done) {
        if (buffer.trim()) {
          const isComplete = processLine(buffer.trim());
          if (isComplete) {
            // ⚠️ 已在 processLine 的 complete 事件中释放锁
            return { taskId, success: true };
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const isComplete = processLine(line);
        if (isComplete) {
          // ⚠️ 已在 processLine 的 complete 事件中释放锁
          return { taskId, success: true };
        }
      }
    }

    // SSE 流结束，检查任务状态
    console.log('[GenService] SSE 流结束，检查任务状态...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 🔧 #224 诊断：打印轮询参数
    console.log('[GenService] #224 开始轮询:', { taskId, apiEndpoint, generationCount });
    
    const taskStatus = await pollTaskStatus(
      taskId,
      apiEndpoint,
      config,
      generationCount
    );

    // 🔧 #224 诊断：打印轮询结果
    console.log('[GenService] #224 轮询结果:', taskStatus ? { status: taskStatus.status, imageUrls: taskStatus.imageUrls?.length } : null);

    if (taskStatus) {
      if (taskStatus.status === 'completed') {
        // 构建占位符替换信息
        const replacements = placeholderReplacements.map(p => {
          const item = taskStatus.imageItems?.find(img => img.index === p.index);
          return {
            placeholderId: p.placeholderId,
            index: p.index,
            imageUrl: item?.url || '',
            imageKey: item?.key || undefined,
          };
        }).filter(r => r.imageUrl);
        
        config.onComplete?.({
          imageUrls: taskStatus.imageUrls || [],
          imageKeys: taskStatus.imageKeys || [],
          imageItems: taskStatus.imageItems,
          creditsCharged: taskStatus.creditsCharged,
          creditsBalance: taskStatus.creditsBalance,
          placeholderReplacements: replacements,
          taskId,  // #231 修复：轮询路径缺少 taskId 导致历史记录不保存
        });
        // ⚠️ 防御8：轮询完成，释放锁
        requestLock.release();
        return { taskId, success: true };
      } else if (taskStatus.status === 'failed') {
        // 清理所有未完成的占位符
        pendingPlaceholders.forEach(placeholderId => {
          config.onPlaceholderFailed?.(placeholderId, taskStatus.error || '生成失败');
        });
        
        config.onError?.({
          type: 'global',
          message: taskStatus.error || '生成失败',
          taskId,
          placeholderIds: Array.from(pendingPlaceholders),
        });
        // ⚠️ 防御9：轮询失败，释放锁
        requestLock.release();
        return { taskId, success: false, message: taskStatus.error };
      }
    }

    // ⚠️ 防御10：未收到结果，释放锁
    requestLock.release();
    return { taskId, success: receivedCount > 0, message: receivedCount > 0 ? undefined : '未收到图片' };
  }, [stopPolling, pollTaskStatus, requestLock]);

  // 返回 Hook API
  return {
    generate,
    abortRequest,
    stopPolling,
    stopAllPolling,
    getPlaceholderId,
    currentTaskId: currentTaskIdRef.current,
  };
}

// ========== 导出辅助函数 ==========
// 注意：processImageItemsWithDeletedFilter 在文件末尾导出
