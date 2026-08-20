// 全局状态存储 - 使用闭包保存状态，避免组件重新挂载时丢失

import { safeSetItem } from '@/lib/safe-storage';

interface GenerationTask {
  id: string;
  status: 'pending' | 'generating' | 'processing' | 'completed' | 'failed';
  images: string[];
  imageKeys?: string[]; // OSS keys 用于持久化存储
  providerUrls?: string[]; // #875 服务商直链 URL（COS 代理失败时的下载回退）
  viewedImages: Set<number>;
  dislikedImages: Set<number>;
  expectedCount: number;
  error?: string;
  itemStatuses: ('pending' | 'generating' | 'completed' | 'failed')[];
  itemErrors: (string | null)[];
  createdAt: Date;
  creditsCharged?: number; // 本次任务扣除的积分
  creditsBalanceAfter?: number; // 扣费后余额（含后续退还）
  params: {
    model: string;
    prompt: string;
    resolution: string;
    aspectRatio: string;
    // #253 修复：支持下划线命名（与数据库一致）
    reference_images?: string[];        // 参考图 URL（下划线命名，与数据库一致）
    reference_image_urls?: string[];    // 参考图代理/签名 URL
    reference_image_md5s?: string[];    // 参考图 MD5 数组
    reference_image_keys?: string[];    // 参考图 COS key
    // 兼容旧数据（驼峰命名）
    referenceImages?: string[];
    referenceImageUrls?: string[];
    referenceImageMd5s?: string[];
    referenceImageKeys?: string[];
  };
}

interface VideoTask {
  id: string;
  status: 'pending' | 'generating' | 'completed' | 'failed' | 'processing';
  videos: string[];
  videoKeys?: string[];  // #624 持久化：视频COS Key，用于刷新后恢复签名URL
  progress: number;
  error?: string;
  createdAt: Date;
  params: {
    model: string;
    prompt: string;
    aspectRatio: string;
    duration?: number;
    size?: string;
    referenceImages: string[];
  };
}

// 最大保存任务数量（避免 localStorage 超出）
const MAX_TASKS_TO_SAVE = 20;

// 使用立即执行函数创建闭包
const createStore = () => {
  // 内部状态
  let tasks: GenerationTask[] = [];
  let selectedTaskId: string | null = null;
  let selectedImageIndex = 0;
  let submittedTaskIds: Set<string> = new Set();
  
  // 已删除的图片 URL 集合（防止后端恢复时重新出现）
  let deletedImageUrls: Set<string> = new Set();
  
  let videoTasks: VideoTask[] = [];
  let selectedVideoTaskId: string | null = null;
  
  let referenceImages: string[] = [];
  let referenceImageUrls: string[] = [];
  let videoReferenceImages: string[] = [];
  
  // 初始化标志
  let initialized = false;
  
  // 从 localStorage 初始化
  const init = () => {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;
    
    try {
      const savedTasks = localStorage.getItem('generationTasks');
      if (savedTasks) {
        const parsed = JSON.parse(savedTasks);
        // 过滤掉超过4小时的过期任务
        const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
        
        tasks = parsed
          .filter((t: any) => {
            const taskTime = new Date(t.createdAt).getTime();
            return taskTime > fourHoursAgo;
          })
          .map((t: any) => ({
            ...t,
            viewedImages: new Set(t.viewedImages || []),
            dislikedImages: new Set(t.dislikedImages || []),
            createdAt: new Date(t.createdAt),
          }));
        
        console.log(`[Store] 清理了 ${parsed.length - tasks.length} 个过期任务`);
        setTimeout(() => saveTasks(), 0);
      }
      
      // 加载已删除图片集合
      const savedDeletedImages = localStorage.getItem('deletedImageUrls');
      if (savedDeletedImages) {
        const parsed = JSON.parse(savedDeletedImages);
        // 只保留4小时内的删除记录
        const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
        deletedImageUrls = new Set(parsed.filter((item: any) => {
          if (typeof item === 'string') {
            return true; // 兼容旧格式
          }
          return item.deletedAt > fourHoursAgo;
        }).map((item: any) => typeof item === 'string' ? item : item.url));
        // 清理过期的删除记录
        saveDeletedImages();
      }
      
      const savedSubmitted = localStorage.getItem('submittedTaskIds');
      if (savedSubmitted) {
        submittedTaskIds = new Set(JSON.parse(savedSubmitted));
      }
      
      const savedVideoTasks = localStorage.getItem('videoTasks');
      if (savedVideoTasks) {
        const parsed = JSON.parse(savedVideoTasks);
        // 过滤掉超过4小时的过期视频任务
        const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
        videoTasks = parsed
          .filter((t: any) => {
            const taskTime = new Date(t.createdAt).getTime();
            return taskTime > fourHoursAgo;
          })
          .map((t: any) => ({
            ...t,
            createdAt: new Date(t.createdAt),
          }));
        
        if (videoTasks.length !== parsed.length) {
          console.log(`[Store] 清理了 ${parsed.length - videoTasks.length} 个过期视频任务`);
        }
      }
      
      // 从 sessionStorage 加载参考图（会话期间保留）
      const savedRefImages = sessionStorage.getItem('referenceImages');
      if (savedRefImages) {
        referenceImages = JSON.parse(savedRefImages);
      }
      
      const savedRefUrls = sessionStorage.getItem('referenceImageUrls');
      if (savedRefUrls) {
        referenceImageUrls = JSON.parse(savedRefUrls);
      }
      
      const savedVideoRefImages = sessionStorage.getItem('videoReferenceImages');
      if (savedVideoRefImages) {
        videoReferenceImages = JSON.parse(savedVideoRefImages);
      }
    } catch (e) {
      console.error('加载状态失败:', e);
    }
  };
  
  // 保存已删除图片集合
  const saveDeletedImages = () => {
    if (typeof window === 'undefined') return;
    try {
      const deletedArray = Array.from(deletedImageUrls).map(url => ({
        url,
        deletedAt: Date.now()
      }));
      safeSetItem('deletedImageUrls', JSON.stringify(deletedArray));
    } catch (e) {
      console.error('保存已删除图片失败:', e);
    }
  };
  
  // 保存到 localStorage（带容量保护）
  const saveTasks = () => {
    if (typeof window === 'undefined') return;
    try {
      // 只保存最近的 N 个任务，且不保存 referenceImages（base64 太大）
      let tasksToSave = tasks.slice(0, MAX_TASKS_TO_SAVE).map(t => ({
        id: t.id,
        status: t.status,
        images: t.images,
        imageKeys: t.imageKeys,
        viewedImages: Array.from(t.viewedImages),
        dislikedImages: Array.from(t.dislikedImages),
        expectedCount: t.expectedCount,
        error: t.error,
        itemStatuses: t.itemStatuses,
        itemErrors: t.itemErrors,
        createdAt: t.createdAt.toISOString(),
        params: {
          model: t.params.model,
          prompt: t.params.prompt,
          resolution: t.params.resolution,
          aspectRatio: t.params.aspectRatio,
          // 不保存 referenceImages（base64 太大，会超出 localStorage 限制）
          referenceImages: [],
          // 保存 COS key 和 MD5（体积小，用于持久化恢复参考图）
          referenceImageKeys: t.params.referenceImageKeys || [],
          referenceImageMd5s: t.params.referenceImageMd5s || [],
        },
      }));
      
      let dataStr = JSON.stringify(tasksToSave);
      
      // 检查数据大小（localStorage 限制约 5MB）
      let dataSize = new Blob([dataStr]).size;
      if (dataSize > 4 * 1024 * 1024) {
        console.warn('任务数据过大:', (dataSize / 1024 / 1024).toFixed(2), 'MB，尝试减少保存数量');
        
        // 尝试减少保存的任务数量
        while (tasksToSave.length > 1 && dataSize > 4 * 1024 * 1024) {
          tasksToSave = tasksToSave.slice(0, Math.floor(tasksToSave.length / 2));
          dataStr = JSON.stringify(tasksToSave);
          dataSize = new Blob([dataStr]).size;
        }
        
        if (dataSize > 4 * 1024 * 1024) {
          console.error('即使只保存 1 个任务也超出限制，跳过保存');
          return;
        }
        
        console.log('减少保存数量后，保存', tasksToSave.length, '个任务');
      }
      
      safeSetItem('generationTasks', dataStr);
      console.log('[Store] 保存了', tasksToSave.length, '个任务到 localStorage');
    } catch (e) {
      console.error('保存任务失败:', e);
    }
  };
  
  const saveSubmittedIds = () => {
    if (typeof window === 'undefined') return;
    try {
      safeSetItem('submittedTaskIds', JSON.stringify(Array.from(submittedTaskIds)));
    } catch (e) {
      console.error('保存已提交任务ID失败:', e);
    }
  };
  
  const saveVideoTasks = () => {
    if (typeof window === 'undefined') return;
    try {
      const tasksToSave = videoTasks.slice(0, MAX_TASKS_TO_SAVE).map(t => ({
        id: t.id,
        status: t.status,
        videos: t.videos,
        videoKeys: t.videoKeys,  // #624 持久化：保存视频Key
        progress: t.progress,
        error: t.error,
        createdAt: t.createdAt.toISOString(),
        params: {
          model: t.params.model,
          prompt: t.params.prompt,
          aspectRatio: t.params.aspectRatio,
          duration: t.params.duration,
          size: t.params.size,
          // 不保存 referenceImages
          referenceImages: [],
        },
      }));
      
      const dataStr = JSON.stringify(tasksToSave);
      const dataSize = new Blob([dataStr]).size;
      if (dataSize > 4 * 1024 * 1024) {
        console.warn('视频任务数据过大，跳过保存');
        return;
      }
      
      safeSetItem('videoTasks', dataStr);
    } catch (e) {
      console.error('保存视频任务失败:', e);
    }
  };
  
  const saveReferenceImages = () => {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.setItem('referenceImages', JSON.stringify(referenceImages));
      sessionStorage.setItem('referenceImageUrls', JSON.stringify(referenceImageUrls));
    } catch (e) {
      console.error('保存参考图失败:', e);
    }
  };
  
  const saveVideoReferenceImages = () => {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.setItem('videoReferenceImages', JSON.stringify(videoReferenceImages));
    } catch (e) {
      console.error('保存视频参考图失败:', e);
    }
  };
  
  return {
    init,
    
    // 图片生成任务
    getTasks: () => {
      init();
      return tasks;
    },
    setTasks: (newTasks: GenerationTask[]) => {
      tasks = newTasks;
      saveTasks();
    },
    
    getSelectedTaskId: () => selectedTaskId,
    setSelectedTaskId: (id: string | null) => {
      selectedTaskId = id;
    },
    
    getSelectedImageIndex: () => selectedImageIndex,
    setSelectedImageIndex: (index: number) => {
      selectedImageIndex = index;
    },
    
    getSubmittedTaskIds: () => {
      init();
      return submittedTaskIds;
    },
    setSubmittedTaskIds: (ids: Set<string>) => {
      submittedTaskIds = ids;
      saveSubmittedIds();
    },
    
    // 参考图
    getReferenceImages: () => {
      init();
      return referenceImages;
    },
    setReferenceImages: (images: string[]) => {
      referenceImages = images;
      saveReferenceImages();
    },
    
    getReferenceImageUrls: () => {
      init();
      return referenceImageUrls;
    },
    setReferenceImageUrls: (urls: string[]) => {
      referenceImageUrls = urls;
      saveReferenceImages();
    },
    
    // 清空参考图
    clearReferenceImages: () => {
      referenceImages = [];
      referenceImageUrls = [];
      saveReferenceImages();
    },
    
    // 清理旧任务（释放 localStorage 空间）
    cleanupOldTasks: () => {
      if (tasks.length > MAX_TASKS_TO_SAVE) {
        tasks = tasks.slice(0, MAX_TASKS_TO_SAVE);
        saveTasks();
      }
    },
    
    // 视频任务
    getVideoTasks: () => {
      init();
      return videoTasks;
    },
    setVideoTasks: (newTasks: VideoTask[]) => {
      videoTasks = newTasks;
      saveVideoTasks();
    },
    
    getSelectedVideoTaskId: () => selectedVideoTaskId,
    setSelectedVideoTaskId: (id: string | null) => {
      selectedVideoTaskId = id;
    },
    
    getVideoReferenceImages: () => {
      init();
      return videoReferenceImages;
    },
    setVideoReferenceImages: (images: string[]) => {
      videoReferenceImages = images;
      saveVideoReferenceImages();
    },
    
    clearVideoReferenceImages: () => {
      videoReferenceImages = [];
      saveVideoReferenceImages();
    },
    
    // 已删除图片管理（防止后端恢复时重新出现）
    getDeletedImageUrls: () => {
      init();
      return deletedImageUrls;
    },
    addDeletedImageUrl: (url: string) => {
      deletedImageUrls.add(url);
      saveDeletedImages();
    },
    isImageDeleted: (url: string) => {
      return deletedImageUrls.has(url);
    },
    // 过滤掉已删除的图片
    filterDeletedImages: (urls: string[]) => {
      return urls.filter(url => !deletedImageUrls.has(url));
    },

    // 清除所有任务（用于清理卡死或不需要的任务）
    clearAllTasks: () => {
      tasks = [];
      selectedTaskId = null;
      selectedImageIndex = 0;
      submittedTaskIds.clear();
      deletedImageUrls.clear();
      saveTasks();
      saveSubmittedIds();
      saveDeletedImages();
      localStorage.removeItem('generationTasks');
      localStorage.removeItem('submittedTaskIds');
      localStorage.removeItem('deletedImageUrls');
      console.log('[Store] 已清除所有任务');
    },
  };
};

// 导出单例
export const generateStore = createStore();

export type { GenerationTask, VideoTask };
