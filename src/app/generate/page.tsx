'use client';

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import AuthModal from '@/components/AuthModal';
import LeftNav from '@/components/LeftNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Upload, X, Play, Download, Image as ImageIcon, Loader2, Coins, ZoomIn, AlertCircle, ChevronDown, Edit2, Trash2 } from 'lucide-react';
import { useSharedData } from '@/hooks/useSharedData';
import { safeSetItem } from '@/lib/safe-storage';
import { ImagePreviewTrigger } from '@/components/ImagePreview';
import HistoryPromptsDialog, { savePromptToLocal } from '@/components/HistoryPromptsDialog';
import HistoryRecordsDialog from '@/components/HistoryRecordsDialog';
import { generateStore, GenerationTask } from '@/store/generateStore';
import { toast } from 'sonner';
import { fetchUserWithCache, updateCachedCredits, clearCachedUser } from '@/lib/user-cache';
import RoseCurveAnimation from '@/components/canvas/RoseCurve';
import { useTheme } from 'next-themes';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';
// 【方案C：静态导入】移除动态 import
import { compressImageForUpload } from '@/lib/frontend-defense';
import { calculateMD5FromArrayBuffer, saveToLocalStorage as saveRefImageToCache } from '@/lib/reference-image-cache';
// 【A 计划】乐观上传 Hook
import { useOptimisticUpload, OptimisticUploadResult, BackgroundUploadResult, waitForPendingUploads } from '@/hooks/useOptimisticUpload';

// 辅助函数：处理 imageItems 和 imageUrls，返回正确的状态更新
function processImageItemsWithDeletedFilter(
  task: GenerationTask,
  imageUrls: string[],
  imageItems: Array<{
    index: number;
    url: string | null;
    key: string | null;
    status: 'completed' | 'failed' | 'generating';
    error: string | null;
  }> | undefined,
  errors: Array<{ index: number; error: string }> | undefined,
  deletedUrls?: Set<string> // 可选：已删除的图片URL集合
): {
  orderedImages: string[];
  orderedImageKeys: string[];
  newItemStatuses: ('completed' | 'failed' | 'generating')[];
  newItemErrors: (string | null)[];
} {
  let orderedImages: string[];
  let orderedImageKeys: string[];
  let newItemStatuses: ('completed' | 'failed' | 'generating')[];
  let newItemErrors: (string | null)[];
  
  if (imageItems && Array.isArray(imageItems)) {
    // 使用后端提供的精确索引信息
    // 过滤掉已删除的图片
    orderedImages = imageItems
      .filter((item) => item.status === 'completed' && item.url && !(deletedUrls?.has(item.url)))
      .map((item) => item.url!);
    orderedImageKeys = imageItems
      .filter((item) => item.status === 'completed' && item.key && !(deletedUrls?.has(item.url!)))
      .map((item) => item.key!);
    
    // 如果 imageItems 长度与任务数量匹配，直接使用后端状态
    if (imageItems.length === task.itemStatuses.length) {
      newItemStatuses = imageItems.map((item) => {
        if (item?.url && deletedUrls?.has(item.url)) {
          return 'failed';
        }
        return item?.status || 'generating';
      });
    } else {
      // 否则按索引查找
      newItemStatuses = task.itemStatuses.map((_, idx) => {
        const item = imageItems.find((i) => i.index === idx);
        // 如果图片已被删除，标记为 failed
        if (item?.url && deletedUrls?.has(item.url)) {
          return 'failed';
        }
        return item?.status || 'generating'; // 默认保持 generating 而不是 failed
      });
    }
    // 如果 imageItems 长度与任务数量匹配，直接使用后端状态
    if (imageItems.length === task.itemErrors.length) {
      newItemErrors = imageItems.map((item) => {
        // 如果图片已被删除
        if (item?.url && deletedUrls?.has(item.url)) {
          return '已删除';
        }
        if (item?.status === 'failed' && item.error) {
          return item.error;
        }
        return item?.status === 'failed' ? '生成失败' : null;
      });
    } else {
      // 否则按索引查找
      newItemErrors = task.itemErrors.map((e, idx) => {
        const item = imageItems.find((i) => i.index === idx);
        // 如果图片已被删除
        if (item?.url && deletedUrls?.has(item.url)) {
          return '已删除';
        }
        if (item?.status === 'failed' && item.error) {
          return item.error;
        }
        return item?.status === 'failed' ? '生成失败' : null;
      });
    }
  } else {
    // 回退到原来的逻辑（根据图片数量推断）
    // 过滤掉已删除的图片
    orderedImages = imageUrls.filter(url => !(deletedUrls?.has(url)));
    orderedImageKeys = [];
    
    newItemStatuses = task.itemStatuses.map((_, idx) => 
      idx < imageUrls.length ? 'completed' as const : 'failed' as const
    );
    newItemErrors = task.itemErrors.map((e, idx) => {
      // 优先使用 errors 数组中的错误信息
      const errorInfo = errors?.find(e => e.index === idx);
      return errorInfo?.error || (idx >= imageUrls.length ? '生成失败' : e);
    });
  }
  
  return { orderedImages, orderedImageKeys, newItemStatuses, newItemErrors };
}

// 缩略图项类型
interface ThumbnailItem {
  taskId: string;
  itemIndex: number;
  imageIndex: number;
  imageUrl?: string;
  status: 'completed' | 'failed' | 'generating';
  error?: string;
  isNew: boolean;
  isSubmitted: boolean;
}

// 缩略图组件 - 使用 memo 优化
const ThumbnailItem = memo(function ThumbnailItem({
  item,
  isSelected,
  onSelect,
  onDelete,
  onDeleteFailed,
  onImageError,
  roseSrc,
  roseShowDetail,
}: {
  item: ThumbnailItem;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDeleteFailed: () => void;
  onImageError: () => void;
  roseSrc?: string;
  roseShowDetail?: boolean;
}) {
  if (item.status === 'completed' && item.imageUrl) {
    return (
      <div 
        className={`relative flex-shrink-0 h-full aspect-square rounded border-2 cursor-pointer overflow-hidden transition-all group ${isSelected ? 'border-[rgb(139,158,232)] shadow-md' : 'border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'}`} 
        onClick={onSelect}
      >
        <img 
          src={item.imageUrl} 
          alt={`缩略图${item.imageIndex + 1}`} 
          className="w-full h-full object-cover" 
          loading="lazy"
          onError={onImageError}
        />
        {item.isNew && (
          <span className="absolute top-1 left-1 px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded">NEW</span>
        )}
        <button
          className="absolute top-1 right-1 w-5 h-5 bg-gray-500/80 hover:bg-gray-600 text-white rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="删除图片"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  } else if (item.status === 'failed') {
    // 区分真正的失败和系统异常
    const isSystemError = item.error?.includes('缓存') || item.error?.includes('超时') || item.error?.includes('网络');
    // #246 修复：同时检查原始错误代码和中文错误信息
    const isOutputModeration = item.error === 'output_moderation' || item.error?.includes('内容违规');
    const isInputModeration = item.error === 'input_moderation' || item.error?.includes('输入内容违规');
    const displayError = isOutputModeration ? '内容违规' 
      : isInputModeration ? '输入违规' 
      : isSystemError ? '状态异常'
      : item.error || '生成失败';
    
    return (
      <div 
        className={`relative flex-shrink-0 h-full aspect-square rounded border-2 cursor-pointer overflow-hidden transition-all group ${isSelected ? 'border-[rgb(139,158,232)] shadow-md' : 'border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'}`}
        onClick={onSelect}
      >
        <div className={`w-full h-full flex flex-col items-center justify-center p-1 ${isSystemError ? 'bg-yellow-50 dark:bg-yellow-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
          <AlertCircle className={`w-5 h-5 flex-shrink-0 ${isSystemError ? 'text-yellow-500' : 'text-red-400'}`} />
          <span className={`text-[8px] text-center mt-1 line-clamp-2 leading-tight ${isSystemError ? 'text-yellow-600' : 'text-red-500'}`}>{displayError}</span>
        </div>
        <button
          className="absolute top-1 right-1 w-5 h-5 bg-gray-500/80 hover:bg-gray-600 text-white rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onDeleteFailed(); }}
          title="删除"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  } else {
    // 正在生成 - 使用玫瑰曲线动态图
    return (
      <div 
        className={`relative flex-shrink-0 h-full aspect-square rounded border-2 cursor-pointer overflow-hidden transition-all ${isSelected ? 'border-[rgb(139,158,232)] shadow-md' : 'border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'}`}
        onClick={onSelect}
      >
        <div className="w-full h-full">
          {roseSrc && (
            <RoseCurveAnimation color={roseSrc} mini showDetail />
          )}
          {!roseSrc && (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-800">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              {item.isSubmitted && (
                <span className="text-[8px] text-green-500 mt-1">✓已提交</span>
              )}
            </div>
          )}
          {item.isSubmitted && roseSrc && (
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] text-green-500 bg-white/80 dark:bg-black/60 px-1 rounded">✓已提交</span>
          )}
        </div>
      </div>
    );
  }
});

// 图片上传限制配置
const IMAGE_UPLOAD_CONFIG = {
  maxSize: 50 * 1024 * 1024, // 50MB
  maxSizeMB: 50,
  allowedFormats: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
};

// 格式化模型名字：kebab-case -> Title-Case
function formatModelName(name: string): string {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('-');
}

// 宽高比图标组件
function AspectRatioIcon({ ratio, selected }: { ratio: string; selected?: boolean }) {
  const getDimensions = (ratio: string): { w: number; h: number } => {
    switch (ratio) {
      case '1:1': return { w: 14, h: 14 };
      case '3:4': return { w: 12, h: 16 };
      case '4:3': return { w: 16, h: 12 };
      case '9:16': return { w: 9, h: 16 };
      case '16:9': return { w: 16, h: 9 };
      case '2:3': return { w: 12, h: 18 };
      case '3:2': return { w: 18, h: 12 };
      case '4:5': return { w: 12, h: 15 };
      case '5:4': return { w: 15, h: 12 };
      case '21:9': return { w: 21, h: 9 };
      case '1:4': return { w: 8, h: 16 };
      case '4:1': return { w: 16, h: 8 };
      case '1:8': return { w: 6, h: 16 };
      case '8:1': return { w: 16, h: 6 };
      case '1:2': return { w: 10, h: 20 };
      case '2:1': return { w: 20, h: 10 };
      default: return { w: 14, h: 14 }; // auto
    }
  };

  const { w, h } = getDimensions(ratio);
  const scale = 18 / Math.max(w, h);
  const scaledW = w * scale;
  const scaledH = h * scale;

  return (
    <svg width="20" height="20" viewBox="0 0 20 20" className="shrink-0">
      <rect
        x={(20 - scaledW) / 2}
        y={(20 - scaledH) / 2}
        width={scaledW}
        height={scaledH}
        fill="none"
        stroke={selected ? 'white' : 'currentColor'}
        strokeWidth="1.5"
        rx="1"
        className={selected ? '' : 'text-gray-500'}
      />
    </svg>
  );
}

// 基础比例列表（所有图片模型通用，API获取失败时的兜底）
const baseAspectRatios = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
// nano-banana-2 系列额外支持的比例
const banana2ExtraAspectRatios = ['1:4', '4:1', '1:8', '8:1'];
// nano-banana-2 系列完整比例
const banana2AspectRatios = [...baseAspectRatios, ...banana2ExtraAspectRatios];
// 默认比例列表（兜底，使用基础列表）
const defaultAspectRatios = baseAspectRatios;

// 判断模型是否为 nano-banana-2 系列
function isBanana2Series(modelKey: string): boolean {
  return ['nano-banana-2', 'nano-banana-2-cl', 'nano-banana-2-4k-cl'].includes(modelKey?.toLowerCase() || '');
}

// inferParameters 函数（和管理后台一致）
function inferParameters(credits: number, serviceType: string | null, currentParams: any, modelKey?: string) {
  const isBanana2 = isBanana2Series(modelKey || '');
  const aspectRatiosForModel = isBanana2
    ? banana2AspectRatios.map(r => ({ label: r, value: r }))
    : baseAspectRatios.map(r => ({ label: r, value: r }));
  
  const parameters = currentParams || {
    aspectRatios: aspectRatiosForModel,
    resolutions: []
  };
  
  // 确保当前参数中有正确的 aspectRatios
  if (!parameters.aspectRatios || parameters.aspectRatios.length === 0) {
    parameters.aspectRatios = aspectRatiosForModel;
  }
  
  if (serviceType === 'image_generation') {
    if (modelKey) {
      const key = modelKey.toLowerCase();
      
      // ===== 只支持 4K 的模型 =====
      if (key === 'nano-banana-2-4k-cl' || key === 'nano-banana-pro-4k-vip') {
        parameters.resolutions = [
          { label: '4K', value: '4K', credits: credits || 10 }
        ];
      }
      // ===== 只支持 1K 的模型 =====
      else if (key === 'nano-banana' || key === 'nano-banana-fast') {
        parameters.resolutions = [
          { label: '1K', value: '1K', credits: credits || 10 }
        ];
      }
      // ===== 只支持 1K, 2K 的模型 =====
      else if (key === 'nano-banana-2-cl' || key === 'nano-banana-pro-vip') {
        parameters.resolutions = [
          { label: '1K', value: '1K', credits: credits || 10 },
          { label: '2K', value: '2K', credits: credits ? Math.round(credits * 1.2) : 12 }
        ];
      }
      // ===== 支持 1K, 2K, 4K 的模型 =====
      else if (key === 'nano-banana-2' || 
               key === 'nano-banana-pro' || 
               key === 'nano-banana-pro-vt' || 
               key === 'nano-banana-pro-cl') {
        parameters.resolutions = [
          { label: '1K', value: '1K', credits: credits || 10 },
          { label: '2K', value: '2K', credits: credits ? Math.round(credits * 1.2) : 12 },
          { label: '4K', value: '4K', credits: credits ? Math.round(credits * 1.5) : 15 }
        ];
      }
      // ===== 默认支持所有分辨率 =====
      else {
        parameters.resolutions = [
          { label: '1K', value: '1K', credits: credits || 10 },
          { label: '2K', value: '2K', credits: credits ? Math.round(credits * 1.2) : 12 },
          { label: '4K', value: '4K', credits: credits ? Math.round(credits * 1.5) : 15 }
        ];
      }
    } else {
      // 兼容旧逻辑（无modelKey时）
      parameters.resolutions = [
        { label: '1K', value: '1K', credits: credits || 10 },
        { label: '2K', value: '2K', credits: credits ? Math.round(credits * 1.2) : 12 },
        { label: '4K', value: '4K', credits: credits ? Math.round(credits * 1.5) : 15 }
      ];
    }
  }
  return parameters;
}

export default function SingleGeneratePage() {
  // ============================================
  // 【路由 - SPA 无缝跳转】
  // ============================================
  const router = useRouter();
  
  // ============================================
  // 【AI 生成器 Context - 统一用户状态和生成引擎】
  // 必须在其他 hook 之前调用
  // ============================================
  const {
    handleGenerate,
    clearAllImages: clearContextImages,
    isLoggedIn: ctxIsLoggedIn,
    credits: ctxCredits,
    userId: ctxUserId,
    setCredits: ctxSetCredits,
    setIsLoggedIn: ctxSetIsLoggedIn,
    refreshUserInfo,
    saveHistoryRecord,  // #237 统一保存方法
  } = useAIGenerator();
  
  // 兼容旧的变量名
  const isLoggedIn = ctxIsLoggedIn;
  const credits = ctxCredits;
  const userId = ctxUserId;
  
  // 动态模型列表（从后端 API 获取）
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  // 模型在线/离线状态（从后端 is_active 字段获取）
  const [modelActiveStatus, setModelActiveStatus] = useState<Record<string, boolean>>({});
  
  // 动态模型配置（从数据库加载，完全来自后端）
  const [dynamicModelConfig, setDynamicModelConfig] = useState<Record<string, {
    resolutions: { size: string; credits: number }[];
    aspectRatios: string[];
  }>>({});
  
  // 模型显示名称（从 API 动态获取）
  const [modelDisplayNames, setModelDisplayNames] = useState<Record<string, string>>({});
  
  // 【isLoggedIn 已由 AIGeneratorContext 统一管理，删除本地状态】
  // const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [historyPromptsOpen, setHistoryPromptsOpen] = useState(false);
  const [historyRecordsOpen, setHistoryRecordsOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  
  // 从后端 API 获取模型列表和配置
  useEffect(() => {
    const fetchModelOptions = async () => {
      try {
        console.log('[Generate Page] 开始加载模型配置...');
        const res = await fetch('/api/config?service_type=image_generation');
        const data = await res.json();
        console.log('[Generate Page] API返回:', data.success, '模型数量:', data.data?.models?.length);
        if (data.success && data.data?.models) {
          // 保留所有模型（包括离线），不再过滤 is_active
          const allModelIds = data.data.models.map((m: { model_id: string }) => m.model_id);
          if (allModelIds.length > 0) {
            setModelOptions(allModelIds);
          }
          
          // 保存模型在线/离线状态
          const activeStatusMap: Record<string, boolean> = {};
          data.data.models.forEach((m: { model_id: string; is_active: boolean }) => {
            activeStatusMap[m.model_id] = m.is_active !== false;
          });
          setModelActiveStatus(activeStatusMap);
          
          // 构建模型显示名称映射（从 API 获取，优先使用管理后台配置的名称）
          const newDisplayNames: Record<string, string> = {};
          data.data.models.forEach((m: { model_id: string; model_name: string }) => {
            newDisplayNames[m.model_id] = m.model_name;
          });
          setModelDisplayNames(prev => ({ ...prev, ...newDisplayNames }));
          
          // 动态加载模型配置（完全来自后端，无硬编码兜底）
          const newConfig: Record<string, {
            resolutions: { size: string; credits: number }[];
            aspectRatios: string[];
          }> = {};
          
          // 直接使用数据库中的 resolutions
          data.data.models.forEach((m: { 
            model_id: string; 
            parameters: any; 
            credits_base?: number 
          }) => {
            const dbResolutions = m.parameters?.resolutions || [];
            const dbAspectRatios = (m.parameters?.aspectRatios || []).map((r: any) => r.value || r.label);
              
            newConfig[m.model_id] = {
              resolutions: dbResolutions.map((r: any) => ({
                size: r.label || r.value,
                credits: r.credits || m.credits_base || 10,
              })),
              aspectRatios: dbAspectRatios,
            };
          });
          
          setDynamicModelConfig(newConfig);
          console.log('[Generate Page] 从数据库加载模型配置:', Object.keys(newConfig).length, '个模型');
        }
      } catch (error) {
        console.error('Failed to fetch model options:', error);
      }
    };
    fetchModelOptions();
  }, []);

  // 监听登录/注册事件
  useEffect(() => {
    const handleOpenLogin = () => {
      setAuthMode('login');
      setAuthModalOpen(true);
    };

    const handleOpenRegister = () => {
      setAuthMode('register');
      setAuthModalOpen(true);
    };

    window.addEventListener('openLogin', handleOpenLogin);
    window.addEventListener('openRegister', handleOpenRegister);

    return () => {
      window.removeEventListener('openLogin', handleOpenLogin);
      window.removeEventListener('openRegister', handleOpenRegister);
    };
  }, []);

  const handleLoginSuccess = (user: any) => {
    ctxSetIsLoggedIn(true);
    setAuthModalOpen(false);
    // 🔧 关键修复：清除缓存后再刷新，确保获取最新用户信息
    clearCachedUser();
    refreshUserInfo();
  };

  const {
    prompt,
    setPrompt,
    model,
    setModel,
    aspectRatio,
    setAspectRatio,
    resolution,
    setResolution,
    count,
    setCount,
  } = useSharedData();
  
  // 【credits 已由 AIGeneratorContext 统一管理，删除本地状态】
  // const [credits, setCredits] = useState(0);
  
  // 参数选择弹窗状态
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showResolutionPicker, setShowResolutionPicker] = useState(false);
  const [showRatioPicker, setShowRatioPicker] = useState(false);
  const [showCountPicker, setShowCountPicker] = useState(false);
  const [showFavoritesModal, setShowFavoritesModal] = useState(false);
  const [favorites, setFavorites] = useState<{id: number; content: string}[]>([]);
  const [newFavoriteContent, setNewFavoriteContent] = useState('');
  const [editingFavoriteId, setEditingFavoriteId] = useState<number | null>(null);
  const [editingFavoriteContent, setEditingFavoriteContent] = useState('');
  
  // 按钮位置状态（用于弹窗定位）
  const [ratioButtonLeft, setRatioButtonLeft] = useState(96);
  const [countButtonLeft, setCountButtonLeft] = useState(232);
  
  // 按钮ref
  const ratioButtonRef = useRef<HTMLButtonElement>(null);
  const countButtonRef = useRef<HTMLButtonElement>(null);
  
  // 【更新积分已由 AIGeneratorContext 统一管理】
  // 保留此函数用于兼容旧代码，实际调用 Context 的 setCredits
  const updateCredits = useCallback((newCredits: number) => {
    ctxSetCredits(newCredits);
    // 同步更新用户缓存
    updateCachedCredits(newCredits);
    // 触发全局事件，通知其他组件刷新（Context 会自动处理）
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('creditsChanged'));
    }
  }, [ctxSetCredits]);
  
  // 【积分管理已由 AIGeneratorContext 统一处理，以下逻辑可删除】
  // 页面加载时获取用户积分
  // useEffect(() => {
  //   const initCredits = async () => {
  //     const user = await fetchUserWithCache();
  //     if (user) {
  //       setCredits(user.credits);
  //     }
  //   };
  //   initCredits();
  // }, []);
  
  // 【creditsChanged 事件监听已由 AIGeneratorContext 统一处理】
  // 监听积分变化事件
  // useEffect(() => {
  //   const handleCreditsChanged = async () => {
  //     const user = await fetchUserWithCache();
  //     if (user) {
  //       setCredits(user.credits);
  //     }
  //   };
  //   window.addEventListener('creditsChanged', handleCreditsChanged);
  //   return () => window.removeEventListener('creditsChanged', handleCreditsChanged);
  // }, []);
  
  // 使用全局 store 管理任务状态
  const [tasks, setTasks] = useState<GenerationTask[]>(() => generateStore.getTasks());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => generateStore.getSelectedTaskId());
  const [selectedImageIndex, setSelectedImageIndex] = useState(() => generateStore.getSelectedImageIndex());
  
  // 使用全局 store 管理参考图
  const [referenceImages, setReferenceImages] = useState<string[]>(() => generateStore.getReferenceImages());
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>(() => generateStore.getReferenceImageUrls());
  // 参考图 MD5 数组（用于缓存复用和历史记录）
  const [referenceImageMd5s, setReferenceImageMd5s] = useState<string[]>([]);
  // 参考图 COS key（用于持久化，保存到生成记录）
  const [referenceImageKeys, setReferenceImageKeys] = useState<string[]>([]);
  
  // 🔧 #215 提交层拦截池：使用 ref 追踪最新状态（避免闭包陷阱）
  const referenceImageKeysRef = useRef<string[]>([]);
  const referenceImageUrlsRef = useRef<string[]>([]);
  const referenceImageMd5sRef = useRef<string[]>([]);
  
  // 同步 ref（#044 关键修复：所有参考图相关的 ref 都必须同步）
  // #243 军师方案：全时监听 + 联动清空
  // 核心逻辑：只要 URL 数组被清空，MD5 和 Keys 的 Ref 也必须瞬间清空
  useEffect(() => {
    referenceImageKeysRef.current = referenceImageKeys;
  }, [referenceImageKeys]);
  useEffect(() => {
    referenceImageUrlsRef.current = referenceImageUrls;
    // #243 关键：联动清空 - URL 数组清空时，MD5 Ref 也必须清空
    // 这是防止"幽灵 MD5"的最后一道防线
    if (referenceImageUrls.length === 0) {
      referenceImageMd5sRef.current = [];
      referenceImageKeysRef.current = [];
      console.log('[#243 全时监听] URL 数组清空，联动清空 MD5/Keys Ref');
    }
  }, [referenceImageUrls]);
  useEffect(() => {
    referenceImageMd5sRef.current = referenceImageMd5s;
  }, [referenceImageMd5s]);
  
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [modelStatuses, setModelStatuses] = useState<Record<string, { status: boolean; error: string }>>({});
  const [uploadingCount, setUploadingCount] = useState(0);
  // #048 新增：追踪正在上传的图片 MD5，用于显示加载状态
  const [uploadingMd5s, setUploadingMd5s] = useState<Set<string>>(new Set());
  const [submittedTaskIds, setSubmittedTaskIds] = useState<Set<string>>(() => generateStore.getSubmittedTaskIds());
  
  // 【A 计划】使用乐观上传 Hook
  const { processFiles: processUploadFiles } = useOptimisticUpload({
    logPrefix: '[生图参考图]',
    maxImages: 6,
    enableCache: true,
    onCacheStore: async (md5, base64, url, fileName) => {
      await saveRefImageToCache(md5, base64);
    },
  });
  
  // 包装 processImageItemsWithDeletedFilter，自动过滤已删除的图片
  const processImageItemsWithDeletedFilterWithDeletedFilter = useCallback((
    task: GenerationTask,
    imageUrls: string[],
    imageItems: Array<{
      index: number;
      url: string | null;
      key: string | null;
      status: 'completed' | 'failed' | 'generating';
      error: string | null;
    }> | undefined,
    errors: Array<{ index: number; error: string }> | undefined
  ) => {
    const deletedUrls = generateStore.getDeletedImageUrls();
    return processImageItemsWithDeletedFilter(task, imageUrls, imageItems, errors, deletedUrls);
  }, []);
  
  // 再次生成数量
  const [regenerateCount, setRegenerateCount] = useState(1);
  
  // 玫瑰曲线配色：白天黑色，夜间白色，始终带文字和进度条
  const { resolvedTheme } = useTheme();
  const roseColor = resolvedTheme === 'dark' ? '#ffffff' : '#0a0a0f';
  
  // 【useAIGenerator 已在组件顶部调用，此处删除重复】
  
  // 跟踪加载失败的图片（用于日志记录）
  const [expiredImages, setExpiredImages] = useState<Set<string>>(new Set());
  
  // 图片加载错误处理 - 仅记录日志，不影响过期判断
  const handleImageError = useCallback((imageUrl: string, taskCreatedAt?: Date) => {
    // 如果任务创建时间在4天内，只是临时网络问题，不标记为过期
    if (taskCreatedAt) {
      const taskTime = typeof taskCreatedAt === 'string' ? new Date(taskCreatedAt).getTime() : taskCreatedAt.getTime();
      const fourDaysAgo = Date.now() - 4 * 24 * 60 * 60 * 1000;
      if (taskTime > fourDaysAgo) {
        console.log('图片加载失败，但任务在4天内，可能是临时网络问题:', imageUrl.substring(0, 50));
        return;
      }
    }
    console.log('图片加载失败（可能已过期）:', imageUrl.substring(0, 100));
    setExpiredImages(prev => new Set(prev).add(imageUrl));
  }, []);
  
  // 检查图片是否过期 - 只依赖时间判断
  // 终端URL有效期约2小时，OSS签名URL有效期5天
  const isImageExpired = useCallback((imageUrl: string, taskCreatedAt?: Date) => {
    // 如果有任务创建时间，检查是否在有效期内
    if (taskCreatedAt) {
      const taskTime = typeof taskCreatedAt === 'string' ? new Date(taskCreatedAt).getTime() : taskCreatedAt.getTime();
      // OSS签名URL有效期5天（432000秒），这里用4天作为安全边界
      const fourDaysAgo = Date.now() - 4 * 24 * 60 * 60 * 1000;
      if (taskTime > fourDaysAgo) {
        return false; // 4天内生成的图片，不会过期
      }
    }
    // 没有创建时间或超过4天，检查URL类型
    // OSS签名URL包含签名参数，终端URL不包含
    if (imageUrl.includes('OSSAccessKeyId=') || imageUrl.includes('Signature=')) {
      // 这是OSS签名URL，可能已过期
      return true;
    }
    // 终端URL，超过4天肯定过期
    return true;
  }, []);
  
  // 清除过期状态（保留函数签名，但不再使用）
  const clearExpiredState = useCallback(() => {
    // 不再需要，但保留函数签名
  }, []);

  // 收藏功能（使用与画布相同的API）
  const fetchFavorites = useCallback(async () => {
    try {
      // #109 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/prompt-favorites', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setFavorites(data.favorites || []);
      } else if (data.error === '未登录') {
        setFavorites([]);
      }
    } catch (error) {
      console.error('获取收藏失败:', error);
    }
  }, []);

  const handleAddFavorite = useCallback(async () => {
    if (!newFavoriteContent.trim()) return;
    try {
      // #109 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/prompt-favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: newFavoriteContent.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setNewFavoriteContent('');
        fetchFavorites();
      } else if (data.error === '未登录') {
        toast.error('请先登录后再收藏提示词');
      } else {
        toast.error(data.error || '添加失败');
      }
    } catch (error) {
      console.error('添加收藏失败:', error);
      toast.error('添加失败，请重试');
    }
  }, [newFavoriteContent, fetchFavorites]);

  const handleDeleteFavorite = useCallback(async (id: number) => {
    try {
      // #109 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch(`/api/prompt-favorites?id=${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        fetchFavorites();
      } else {
        toast.error(data.error || '删除失败');
      }
    } catch (error) {
      console.error('删除收藏失败:', error);
      toast.error('删除失败，请重试');
    }
  }, [fetchFavorites]);

  const handleUpdateFavorite = useCallback(async (id: number, content: string) => {
    try {
      // #109 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/prompt-favorites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id, content }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingFavoriteId(null);
        setEditingFavoriteContent('');
        fetchFavorites();
      }
    } catch (error) {
      console.error('更新收藏失败:', error);
    }
  }, [fetchFavorites]);

  // 页面加载时获取收藏
  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  const imageAreaRef = useRef<HTMLDivElement>(null);
  
  // 页面加载时清理 localStorage（移除过大的 referenceImages 数据）
  useEffect(() => {
    try {
      // 清理 generationTasks 中的 referenceImages（兼容驼峰和下划线）
      const savedTasks = localStorage.getItem('generationTasks');
      if (savedTasks) {
        const parsed = JSON.parse(savedTasks);
        let needsSave = false;
        const cleaned = parsed.map((t: any) => {
          // #253 兼容驼峰和下划线两种命名
          const hasRefImages = t.params?.referenceImages?.length > 0 || t.params?.reference_images?.length > 0;
          if (hasRefImages) {
            needsSave = true;
            return { ...t, params: { ...t.params, referenceImages: [], reference_images: [] } };
          }
          return t;
        });
        if (needsSave) {
          console.log('清理任务中的 referenceImages 数据...');
          safeSetItem('generationTasks', JSON.stringify(cleaned));
        }
      }
      
      // 清理 generationRecords 中的 referenceImages（兼容驼峰和下划线）
      const savedRecords = localStorage.getItem('generationRecords');
      if (savedRecords) {
        const parsed = JSON.parse(savedRecords);
        let needsSave = false;
        const cleaned = parsed.map((r: any) => {
          // #253 兼容驼峰和下划线两种命名
          const hasRefImages = r.params?.referenceImages?.length > 0 || r.params?.reference_images?.length > 0;
          if (hasRefImages) {
            needsSave = true;
            return { ...r, params: { ...r.params, referenceImages: [], reference_images: [] } };
          }
          return r;
        });
        if (needsSave) {
          console.log('清理历史记录中的 referenceImages 数据...');
          safeSetItem('generationRecords', JSON.stringify(cleaned));
        }
      }
    } catch (e) {
      console.error('清理 localStorage 失败:', e);
    }
  }, []);
  
  // 使用 ref 跟踪最新的 tasks（用于恢复逻辑）
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // #150 Local-First：页面加载时从 IndexedDB 缓存恢复图片 URL
  // #154 修复：依赖 tasks，解决冷启动时缓存恢复失效问题
  const cacheRestoredRef = useRef(false);
  useEffect(() => {
    // 防止重复执行
    if (cacheRestoredRef.current) return;
    
    // #154 完善判空逻辑：必须有 tasks 且包含有效的 imageKeys
    if (tasks.length === 0) return;
    const hasValidImageKeys = tasks.some(t => t.imageKeys && t.imageKeys.length > 0);
    if (!hasValidImageKeys) return;
    
    // 标记为已恢复（防止重复执行）
    cacheRestoredRef.current = true;

    // 收集所有需要检查的 imageKeys
    const allImageKeys: Array<{ taskId: string; imageIndex: number; imageKey: string }> = [];
    tasks.forEach(task => {
      if (task.imageKeys) {
        task.imageKeys.forEach((key, idx) => {
          if (key) {
            allImageKeys.push({ taskId: task.id, imageIndex: idx, imageKey: key });
          }
        });
      }
    });

    if (allImageKeys.length === 0) return;

    console.log('[生图页面] #154 开始检查缓存，共', allImageKeys.length, '张图片');

    // 异步检查缓存（两层：IndexedDB + 签名 URL 缓存）
    import('@/lib/canvas-image-db').then(({ loadImageFromCache }) => {
      import('@/lib/presigned-url-cache').then(({ getPresignedUrls }) => {
        const checkCache = async () => {
          let hitCount = 0;
          const missedKeys: { taskId: string; imageIndex: number; imageKey: string }[] = [];
          
          // 第一层：IndexedDB 缓存
          for (const item of allImageKeys) {
            const cachedUrl = await loadImageFromCache(item.imageKey);
            if (cachedUrl) {
              // 缓存命中，替换 URL
              setTasks(prev => prev.map(t => {
                if (t.id !== item.taskId) return t;
                const newImages = [...t.images];
                if (item.imageIndex < newImages.length) {
                  newImages[item.imageIndex] = cachedUrl;
                }
                return { ...t, images: newImages };
              }));
              hitCount++;
            } else {
              missedKeys.push(item);
            }
          }
          
          // 第二层：签名 URL 缓存（#209 新增）
          if (missedKeys.length > 0) {
            console.log('[生图页面] IndexedDB 未命中，尝试签名 URL 缓存:', missedKeys.length, '张');
            
            try {
              const fetchNewUrls = async (keysToFetch: string[]): Promise<Record<string, string>> => {
                const response = await fetch('/api/canvas/signed-url', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ keys: keysToFetch })
                });
                const data = await response.json();
                if (!data.success || !data.urls) {
                  throw new Error('获取签名 URL 失败');
                }
                return data.urls;
              };
              
              const keys = missedKeys.map(k => k.imageKey);
              const signedUrls = await getPresignedUrls(keys, fetchNewUrls);
              
              for (const item of missedKeys) {
                const signedUrl = signedUrls[item.imageKey];
                if (signedUrl) {
                  setTasks(prev => prev.map(t => {
                    if (t.id !== item.taskId) return t;
                    const newImages = [...t.images];
                    if (item.imageIndex < newImages.length) {
                      newImages[item.imageIndex] = signedUrl;
                    }
                    return { ...t, images: newImages };
                  }));
                  hitCount++;
                }
              }
              
              console.log('[生图页面] 签名 URL 缓存命中:', Object.keys(signedUrls).length, '张');
            } catch (e) {
              console.warn('[生图页面] 签名 URL 缓存获取失败:', e);
            }
          }
          
          if (hitCount > 0) {
            console.log('[生图页面] 总缓存恢复:', hitCount, '/', allImageKeys.length, '张');
            // #154 强制保存同步：确保恢复的状态立刻固化到 localStorage
            // setTasks 会触发 useEffect 同步到 generateStore，generateStore.setTasks 会自动 saveTasks
          }
        };
        
        checkCache().catch(console.error);
      }).catch(console.error);
    }).catch(console.error);
  }, [tasks]); // #154 修复：依赖 tasks，确保冷启动时能正确恢复

  // 同步 tasks 到 store
  useEffect(() => {
    generateStore.setTasks(tasks);
  }, [tasks]);

  // 同步 selectedTaskId 到 store
  useEffect(() => {
    generateStore.setSelectedTaskId(selectedTaskId);
  }, [selectedTaskId]);

  // 同步 selectedImageIndex 到 store
  useEffect(() => {
    generateStore.setSelectedImageIndex(selectedImageIndex);
  }, [selectedImageIndex]);

  // 同步 submittedTaskIds 到 store
  useEffect(() => {
    generateStore.setSubmittedTaskIds(submittedTaskIds);
  }, [submittedTaskIds]);

  // 同步参考图到 store
  useEffect(() => {
    generateStore.setReferenceImages(referenceImages);
  }, [referenceImages]);

  useEffect(() => {
    generateStore.setReferenceImageUrls(referenceImageUrls);
  }, [referenceImageUrls]);


  // 【使命必达】页面加载时恢复"生成中"任务的状态
  useEffect(() => {
    const recoverGeneratingTasks = async () => {
      // 直接从 store 获取最新任务，避免 ref 同步问题
      const currentTasks = generateStore.getTasks();
      
      // 【修复】检查所有可能有问题的任务：
      // 1. status === 'generating' 的任务
      // 2. itemStatuses 中包含 'generating' 的任务
      const problematicTasks = currentTasks.filter(t => 
        t.status === 'generating' || 
        (t.itemStatuses && t.itemStatuses.some(s => s === 'generating'))
      );
      
      if (problematicTasks.length === 0) return;
      
      console.log(`发现 ${problematicTasks.length} 个需要恢复的任务...`);
      
      for (const task of problematicTasks) {
        try {
          // 等待一小段时间，避免并发请求
          await new Promise(resolve => setTimeout(resolve, 500));
          
          console.log(`[恢复] 检查任务 ${task.id}, 当前状态: ${task.status}`);
          
          const resultResponse = await fetch(`/api/image-to-image?taskId=${task.id}`);
          const resultData = await resultResponse.json();
          
          console.log(`[恢复] 任务 ${task.id} 后端返回:`, {
            success: resultData.success,
            status: resultData.status,
            imageItemsCount: resultData.imageItems?.length || 0
          });
          
          if (resultData.success && resultData.status === 'completed') {
            // 任务完成
            const imageUrls = resultData.imageUrls || [];
            const imageItems = resultData.imageItems || [];
            const errors = resultData.errors || [];
            console.log(`任务 ${task.id} 恢复成功: ${imageUrls.length} 张图片, imageItems: ${imageItems.length}`);
            setTasks(prev => {
              const updatedTasks = prev.map(t => {
                if (t.id === task.id) {
                  // 使用 processImageItemsWithDeletedFilter 处理图片项
                  const { orderedImages, newItemStatuses, newItemErrors } = 
                    processImageItemsWithDeletedFilter(t, imageUrls, imageItems, errors);
                  
                  return {
                    ...t,
                    status: orderedImages.length > 0 ? 'completed' as const : 'failed' as const,
                    images: orderedImages,
                    itemStatuses: newItemStatuses,
                    itemErrors: newItemErrors,
                    error: orderedImages.length > 0 ? undefined : '生成失败',
                  };
                }
                return t;
              });
              
              // #232 Sprint 3：删除 saveRecord 调用，由 AIGeneratorContext 统一保存
              const completedTask = updatedTasks.find(t => t.id === task.id);
              // console.log('[#232] 生图完成，由 AIGeneratorContext 统一保存记录');
              
              return updatedTasks;
            });
          } else if (resultData.status === 'generating') {
            // 任务还在生成中，更新 itemStatuses
            console.log(`[恢复] 任务 ${task.id} 仍在生成中`);
            const imageItems = resultData.imageItems || [];
            console.log(`[恢复] imageItems 数量: ${imageItems.length}`);
            if (imageItems.length > 0) {
              console.log(`任务 ${task.id} 仍在生成中，更新图片状态`);
              setTasks(prev => prev.map(t => {
                if (t.id === task.id) {
                  const { newItemStatuses, newItemErrors } = processImageItemsWithDeletedFilter(t, [], imageItems, []);
                  // 更新成功的图片
                  const newImages = imageItems
                    .filter((item: any) => item.status === 'completed' && item.url)
                    .map((item: any) => item.url);
                  
                  return {
                    ...t,
                    images: newImages.length > t.images.length ? newImages : t.images,
                    itemStatuses: newItemStatuses,
                    itemErrors: newItemErrors,
                  };
                }
                return t;
              }));
            }
            // 不管有没有 imageItems，都保持 generating 状态
          } else if (resultData.status === 'failed') {
            // 任务失败
            const errorMsg = resultData.error || '生成失败';
            console.log(`任务 ${task.id} 已失败: ${errorMsg}`);
            setTasks(prev => prev.map(t => {
              if (t.id === task.id) {
                return {
                  ...t,
                  status: 'failed' as const,
                  error: errorMsg,
                  images: [],  // #245 失败时清空图片数组
                  itemStatuses: t.itemStatuses.map(() => 'failed' as const),
                  itemErrors: t.itemErrors.map(() => errorMsg),
                };
              }
              return t;
            }));
          } else if (!resultResponse.ok || !resultData.success) {
            // 后端没有缓存或返回错误
            const taskAge = Date.now() - new Date(task.createdAt).getTime();
            const fiveMinutes = 5 * 60 * 1000;
            
            // 如果任务超过5分钟，将generating项标记为失败
            if (taskAge > fiveMinutes) {
              console.log(`[恢复] 任务 ${task.id} 已超过5分钟，后端无缓存，更新generating项为失败`);
              setTasks(prev => prev.map(t => {
                if (t.id === task.id) {
                  // 只更新'generating'状态的项，保留已完成/失败的项
                  const newItemStatuses = t.itemStatuses.map(s => 
                    s === 'generating' ? 'failed' as ('completed' | 'failed' | 'generating' | 'pending') : s
                  ) as ('completed' | 'failed' | 'generating' | 'pending')[];
                  const newItemErrors = t.itemErrors.map((e, i) => 
                    t.itemStatuses[i] === 'generating' ? '任务超时或缓存已过期' : e
                  );
                  // 如果所有项都已完成或失败，更新任务状态
                  const allDone = newItemStatuses.every(s => s !== 'generating');
                  const hasCompleted = newItemStatuses.some(s => s === 'completed');
                  return {
                    ...t,
                    status: allDone ? (hasCompleted ? 'completed' as const : 'failed' as const) : t.status,
                    error: allDone && !hasCompleted ? '任务超时或缓存已过期' : t.error,
                    itemStatuses: newItemStatuses,
                    itemErrors: newItemErrors,
                  };
                }
                return t;
              }));
              return;
            }
            
            // 任务刚创建，等待后端缓存
            console.log(`[恢复] 任务 ${task.id} 刚创建 (${Math.floor(taskAge/1000)}秒)，等待后端缓存`);
            return;
          } else {
            // 其他未知状态，标记失败
            console.log(`[恢复] 任务 ${task.id} 未知状态，标记失败:`, resultData);
            setTasks(prev => prev.map(t => {
              if (t.id === task.id) {
                return {
                  ...t,
                  status: 'failed' as const,
                  error: '未知状态',
                  images: [],  // #245 失败时清空图片数组
                  itemStatuses: t.itemStatuses.map(() => 'failed' as const),
                  itemErrors: t.itemErrors.map(() => '未知状态'),
                };
              }
              return t;
            }));
          }
        } catch (err) {
          console.error(`恢复任务 ${task.id} 失败:`, err);
          // 网络错误，检查任务年龄
          const taskAge = Date.now() - new Date(task.createdAt).getTime();
          const fiveMinutes = 5 * 60 * 1000;
          
          if (taskAge > fiveMinutes) {
            // 超过5分钟，将generating项标记为失败
            console.log(`[恢复] 任务 ${task.id} 网络错误且超过5分钟，更新generating项为失败`);
            setTasks(prev => prev.map(t => {
              if (t.id === task.id) {
                // 只更新'generating'状态的项
                const newItemStatuses = t.itemStatuses.map(s => 
                  s === 'generating' ? 'failed' as ('completed' | 'failed' | 'generating' | 'pending') : s
                ) as ('completed' | 'failed' | 'generating' | 'pending')[];
                const newItemErrors = t.itemErrors.map((e, i) => 
                  t.itemStatuses[i] === 'generating' ? '网络错误，无法获取任务状态' : e
                );
                const allDone = newItemStatuses.every(s => s !== 'generating');
                const hasCompleted = newItemStatuses.some(s => s === 'completed');
                return {
                  ...t,
                  status: allDone ? (hasCompleted ? 'completed' as const : 'failed' as const) : t.status,
                  error: allDone && !hasCompleted ? '网络错误，无法获取任务状态' : t.error,
                  itemStatuses: newItemStatuses,
                  itemErrors: newItemErrors,
                };
              }
              return t;
            }));
          }
        }
      }
    };
    
    // 延迟执行，等待组件完全加载
    const timer = setTimeout(recoverGeneratingTasks, 1000);
    return () => clearTimeout(timer);
  }, []); // 只在组件首次加载时执行

  // 读取从画布发送来的图片
  useEffect(() => {
    const data = sessionStorage.getItem('canvasToSend');
    if (data) {
      try {
        const parsed = JSON.parse(data);
        
        // 支持新格式（多图）和旧格式（单图）
        if (parsed.images && Array.isArray(parsed.images)) {
          // 新格式：多张图片
          const imageUrls = parsed.images.map((img: { imageUrl: string; prompt: string }) => img.imageUrl);
          
          // #241 修复：从画布加载图片时，清空其他数组并同步 Ref
          // 画布发送的是临时 URL，不是 COS URL，所以清空 Keys 和 MD5s
          setReferenceImages(imageUrls);
          setReferenceImageUrls([]);  // 清空 COS URL（画布发送的是临时 URL）
          setReferenceImageKeys([]);
          setReferenceImageMd5s([]);
          // 同步更新 Ref
          referenceImageUrlsRef.current = [];
          referenceImageKeysRef.current = [];
          referenceImageMd5sRef.current = [];
          
          // 设置第一张图片的提示词
          if (parsed.images[0]?.prompt) {
            setPrompt(parsed.images[0].prompt);
          }
          toast.success(`已从画布加载 ${imageUrls.length} 张图片`);
          console.log('[从画布加载 #241] 设置参考图并清空 Ref');
        } else if (parsed.imageUrl) {
          // 旧格式：单张图片（兼容）
          // #241 修复：同样清空其他数组并同步 Ref
          setReferenceImages([parsed.imageUrl]);
          setReferenceImageUrls([]);
          setReferenceImageKeys([]);
          setReferenceImageMd5s([]);
          referenceImageUrlsRef.current = [];
          referenceImageKeysRef.current = [];
          referenceImageMd5sRef.current = [];
          
          if (parsed.prompt) {
            setPrompt(parsed.prompt);
          }
          toast.success('已从画布加载图片');
        }
        
        sessionStorage.removeItem('canvasToSend');
      } catch (error) {
        console.error('Failed to load image from canvas:', error);
      }
    }
  }, []); // 只在页面加载时执行一次

  // 【新增】定时检查生成中的任务状态（每5秒）
  useEffect(() => {
    const checkGeneratingTasks = async () => {
      // 直接从 store 获取最新任务，避免 ref 同步问题
      const currentTasks = generateStore.getTasks();
      
      // 【修复】检查所有可能有问题的任务（与恢复逻辑保持一致）
      const generatingTasks = currentTasks.filter(t => 
        t.status === 'generating' || 
        (t.itemStatuses && t.itemStatuses.some(s => s === 'generating'))
      );
      
      if (generatingTasks.length === 0) return;
      
      console.log(`[定时检查] 发现 ${generatingTasks.length} 个生成中的任务`);
      
      // 批量检查所有任务（移除slice限制，检查所有generating任务）
      const checkPromises = generatingTasks.map(async (task) => {
        try {
          const resultResponse = await fetch(`/api/image-to-image?taskId=${task.id}`);
          const resultData = await resultResponse.json();
          
          // 【修复】移除 imageUrls?.length > 0 的条件，因为即使没有图片也应该更新状态
          if (resultData.success && resultData.status === 'completed') {
            console.log(`[定时检查] 任务 ${task.id} 已完成: ${resultData.imageUrls?.length || 0} 张图片`);
            // #254 调试：打印完整的图片数据
            console.log(`[定时检查] #254 API返回详情:`, {
              imageUrls: resultData.imageUrls?.map((u: string) => u?.substring?.(0, 60) + '...'),
              imageItems: resultData.imageItems?.map((item: any) => ({
                status: item?.status,
                url: item?.url?.substring?.(0, 60) + '...',
              })),
            });
            return {
              task,
              status: 'completed',
              imageUrls: resultData.imageUrls || [],
              imageItems: resultData.imageItems,
              errors: resultData.errors
            };
          } else if (resultData.status === 'generating') {
            // 任务还在生成中，检查是否超时
            const taskAge = Date.now() - new Date(task.createdAt).getTime();
            const fiveMinutes = 5 * 60 * 1000;

            if (taskAge > fiveMinutes) {
              console.log(`[定时检查] 任务 ${task.id} 已超过5分钟(${Math.floor(taskAge/1000)}秒)，标记为失败`);
              return { task, status: 'timeout', error: '任务超时，请重新生成' };
            }

            // 任务仍在生成中，返回已完成的图片
            console.log(`[定时检查] 任务 ${task.id} 仍在生成中 (${Math.floor(taskAge/1000)}秒)`);
            return {
              task,
              status: 'generating',
              imageItems: resultData.imageItems
            };
          } else if (resultData.status === 'failed') {
            console.log(`[定时检查] 任务 ${task.id} 已失败`);
            return { task, status: 'failed', error: resultData.error || '生成失败' };
          } else if (!resultResponse.ok || !resultData.success) {
            // 后端无缓存或返回错误（404等）
            const taskAge = Date.now() - new Date(task.createdAt).getTime();
            const fiveMinutes = 5 * 60 * 1000;

            // 如果任务超过5分钟，标记为失败
            if (taskAge > fiveMinutes) {
              console.log(`[定时检查] 任务 ${task.id} 已超过5分钟(${Math.floor(taskAge/1000)}秒)，后端无缓存，标记为失败`);
              return { task, status: 'not_found', error: '任务超时或缓存已过期' };
            }
            // 任务刚创建，等待后端缓存
            console.log(`[定时检查] 任务 ${task.id} 刚创建 (${Math.floor(taskAge/1000)}秒)，等待后端缓存`);
            return { task, status: 'generating' };
          }
        } catch (err) {
          console.error(`[定时检查] 检查任务 ${task.id} 失败:`, err);
          // 网络错误，检查任务年龄
          const taskAge = Date.now() - new Date(task.createdAt).getTime();
          const fiveMinutes = 5 * 60 * 1000;

          if (taskAge > fiveMinutes) {
            // 超过5分钟，将generating项标记为失败
            console.log(`[定时检查] 任务 ${task.id} 网络错误且超过5分钟，更新generating项为失败`);
            return { task, status: 'timeout', error: '网络错误，无法获取任务状态' };
          }
          // 否则保持 generating 状态
          return { task, status: 'generating' };
        }
        return null;
      });
      
      const results = await Promise.all(checkPromises);
      
      // 批量更新任务状态
      for (const result of results) {
        if (!result) continue;
        
        if (result.status === 'completed' && result.imageUrls) {
          console.log(`[定时检查] 更新任务 ${result.task.id} 状态为 completed, 图片数量: ${result.imageUrls.length}`);
          // #254 调试日志：打印图片 URL 详情
          console.log(`[定时检查] #254 图片URL详情:`, result.imageUrls.map((u: string) => u?.substring?.(0, 80) + '...'));
          
          // #238 修复：提取图片 keys（用于历史记录持久化）
          const imageKeys = result.imageItems
            ?.filter((item: any) => item.key)
            .map((item: any) => item.key);
          
          setTasks(prev => {
            const updatedTasks = prev.map(t => {
              if (t.id === result.task.id) {
                const { orderedImages, newItemStatuses, newItemErrors } = 
                  processImageItemsWithDeletedFilter(t, result.imageUrls!, result.imageItems, result.errors);
                console.log(`[定时检查] 任务 ${result.task.id} 处理后: orderedImages=${orderedImages.length}, statuses=${newItemStatuses.join(',')}`);
                return {
                  ...t,
                  status: 'completed' as const,
                  images: orderedImages,
                  itemStatuses: newItemStatuses,
                  itemErrors: newItemErrors,
                };
              }
              return t;
            });
            
            return updatedTasks;
          });
          
          // #238 修复：轮询分支保存历史记录（在 setTasks 外部调用，避免异步陷阱）
          if (result.imageUrls.length > 0 && result.task.params) {
            saveHistoryRecord({
              taskId: result.task.id,
              model: result.task.params.model,
              prompt: result.task.params.prompt,
              images: result.imageUrls,
              imageKeys: imageKeys && imageKeys.length > 0 ? imageKeys : undefined,
              referenceImages: result.task.params.reference_images || [],
              referenceImageMd5s: result.task.params.reference_image_md5s || [],  // #242/#253 新增
              resolution: result.task.params.resolution,
              aspectRatio: result.task.params.aspectRatio,
              creditsCharged: result.task.creditsCharged,
              source: 'regenerate',  // 轮询完成的任务通常是"再次生成"
            });
            console.log(`[定时检查] #238 保存历史记录: taskId=${result.task.id}, images=${result.imageUrls.length}, creditsCharged=${result.task.creditsCharged}`);
          }
        } else if (result.status === 'generating') {
          // 任务还在生成中，更新 itemStatuses
          setTasks(prev => prev.map(t => {
            if (t.id === result.task.id && result.imageItems) {
              const { newItemStatuses, newItemErrors } = 
                processImageItemsWithDeletedFilter(t, [], result.imageItems, []);
              // 更新成功的图片
              const newImages = result.imageItems!
                .filter((item: any) => item.status === 'completed' && item.url)
                .map((item: any) => item.url);
              
              return {
                ...t,
                images: newImages.length > t.images.length ? newImages : t.images,
                itemStatuses: newItemStatuses,
                itemErrors: newItemErrors,
              };
            }
            return t;
          }));
        } else if (result.status === 'failed') {
          // #256 从 imageItems 中提取每个图片的错误信息（支持"内容违规"等特定错误）
          setTasks(prev => prev.map(t => {
            if (t.id === result.task.id) {
              // 从 imageItems 中提取每个图片的错误信息（有兜底）
              const newItemErrors = t.itemErrors.map((_, idx) => {
                // 优先从 imageItems 获取
                const item = result.imageItems?.find((i: { index: number; url: string | null; key: string | null; status: string; error: string | null }) => i.index === idx);
                if (item?.error) return item.error;
                
                // 兜底：从 errors 数组获取
                const err = result.errors?.find((e: { index: number; error: string }) => e.index === idx);
                if (err?.error) return err.error;
                
                // 最终兜底
                return '生成失败';
              });
              
              return {
                ...t,
                status: 'failed' as const,
                error: newItemErrors[0],
                images: [],  // #245 失败时清空图片数组
                itemStatuses: t.itemStatuses.map(() => 'failed' as const),
                itemErrors: newItemErrors,
              };
            }
            return t;
          }));
        } else if (result.status === 'not_found') {
          // 任务不存在，标记为失败
          const errorMsg = result.error || '任务不存在或已过期';
          console.log(`[定时检查] 任务 ${result.task.id} 不存在或已过期: ${errorMsg}`);
          setTasks(prev => prev.map(t => {
            if (t.id === result.task.id) {
              return {
                ...t,
                status: 'failed' as const,
                error: errorMsg,
                images: [],  // #245 失败时清空图片数组
                itemStatuses: t.itemStatuses.map(() => 'failed' as const),
                itemErrors: t.itemErrors.map(() => errorMsg),
              };
            }
            return t;
          }));
        } else if (result.status === 'timeout') {
          // 任务超时，标记为失败
          const errorMsg = result.error || '任务超时，请重新生成';
          console.log(`[定时检查] 任务 ${result.task.id} 超时: ${errorMsg}`);
          setTasks(prev => prev.map(t => {
            if (t.id === result.task.id) {
              return {
                ...t,
                status: 'failed' as const,
                error: errorMsg,
                images: [],  // #245 失败时清空图片数组
                itemStatuses: t.itemStatuses.map(() => 'failed' as const),
                itemErrors: t.itemErrors.map(() => errorMsg),
              };
            }
            return t;
          }));
        }
      }
    };
    
    // 每5秒检查一次（快速响应）
    // 首次立即执行一次
    checkGeneratingTasks();
    const interval = setInterval(checkGeneratingTasks, 5000);
    return () => clearInterval(interval);
  }, []);

  // 根据当前模型动态获取支持的分辨率和宽高比
  const fallbackConfig = {
    resolutions: [{ size: '1K', credits: 10 }],
    aspectRatios: defaultAspectRatios,
  };
  const rawConfig = dynamicModelConfig[model] || fallbackConfig;
  const currentConfig = {
    resolutions: rawConfig.resolutions.length > 0 ? rawConfig.resolutions : fallbackConfig.resolutions,
    aspectRatios: rawConfig.aspectRatios.length > 0 ? rawConfig.aspectRatios : fallbackConfig.aspectRatios,
  };
  const resolutionOptions = currentConfig.resolutions;
  const aspectRatioOptions = currentConfig.aspectRatios;
  const countOptions = Array.from({ length: 10 }, (_, i) => i + 1);
  
  // 获取当前分辨率对应的积分消耗
  const currentCreditCost = resolutionOptions.find(r => r.size === resolution)?.credits || resolutionOptions[0]?.credits || 0;

  // #232 Sprint 3：删除 saveRecord 和 saveToLocalStorage
  // 历史记录保存已由 AIGeneratorContext 统一处理，这里不再重复保存

  // 获取模型状态
  useEffect(() => {
    if (modelOptions.length === 0) return; // 没有模型时不请求
    
    const fetchModelStatuses = async () => {
      try {
        const response = await fetch('/api/model-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ models: modelOptions }),
        });
        const data = await response.json();
        if (data.code === 0 && data.data) {
          setModelStatuses(data.data);
        }
      } catch (error) {
        console.error('获取模型状态失败:', error);
      }
    };

    fetchModelStatuses();
    const interval = setInterval(fetchModelStatuses, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [modelOptions]);

  // 监听管理后台修改事件，刷新模型列表
  useEffect(() => {
    const handleCreditsUpdated = () => {
      console.log('[Generate] 收到管理后台更新通知，刷新模型列表');
      // 重新获取模型列表
      const fetchModelOptions = async () => {
        try {
          const res = await fetch('/api/config?service_type=image_generation');
          const data = await res.json();
          if (data.success && data.data?.models) {
            const allModelIds = data.data.models.map((m: { model_id: string }) => m.model_id);
            if (allModelIds.length > 0) {
              setModelOptions(allModelIds);
            }
            
            // 保存模型在线/离线状态
            const activeStatusMap: Record<string, boolean> = {};
            data.data.models.forEach((m: { model_id: string; is_active: boolean }) => {
              activeStatusMap[m.model_id] = m.is_active !== false;
            });
            setModelActiveStatus(activeStatusMap);
            
            // 更新模型显示名称映射
            const newDisplayNames: Record<string, string> = {};
            data.data.models.forEach((m: { model_id: string; model_name: string }) => {
              newDisplayNames[m.model_id] = m.model_name;
            });
            setModelDisplayNames(prev => ({ ...prev, ...newDisplayNames }));
          }
        } catch (error) {
          console.error('刷新模型列表失败:', error);
        }
      };
      fetchModelOptions();
    };

    window.addEventListener('modelCreditsUpdated', handleCreditsUpdated);
    window.addEventListener('storage', handleCreditsUpdated);
    
    return () => {
      window.removeEventListener('modelCreditsUpdated', handleCreditsUpdated);
      window.removeEventListener('storage', handleCreditsUpdated);
    };
  }, []);

  // 防抖保存任务到 localStorage（减少写入频率）
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const toSave = tasks.map(t => ({
          ...t,
          viewedImages: Array.from(t.viewedImages),
          dislikedImages: Array.from(t.dislikedImages),
          createdAt: t.createdAt.toISOString(),
        }));
        safeSetItem('generationTasks', JSON.stringify(toSave));
      } catch (e) {
        console.error('保存任务记录失败:', e);
      }
    }, 500); // 500ms 防抖

    return () => clearTimeout(timer);
  }, [tasks]);

  // 模型切换时自动调整分辨率和宽高比
  useEffect(() => {
    const config = dynamicModelConfig[model] || {
      resolutions: [{ size: '1K', credits: 10 }],
      aspectRatios: defaultAspectRatios,
    };
    if (config) {
      // 如果当前分辨率不在支持的列表中，切换到默认值
      const supportedResolutions = config.resolutions.map(r => r.size);
      if (!supportedResolutions.includes(resolution)) {
        setResolution(config.resolutions[0].size);
      }
      // 如果当前宽高比不在支持的列表中，切换到 auto
      if (!config.aspectRatios.includes(aspectRatio)) {
        setAspectRatio('auto');
      }
    }
  }, [model, resolution, aspectRatio, setResolution, setAspectRatio]);

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || null;
  const generatingTasks = tasks.filter(t => t.status === 'generating');
  
  // 【A 计划】处理参考图上传（使用乐观上传 Hook）
  // #048 修复：上传完成后才能提交，图片显示加载转圈
  const handleReferenceImageUpload = async (event: any) => {
    const files = event.target.files;
    
    if (!files || files.length === 0) {
      console.log('没有选择文件');
      event.target.value = '';
      return;
    }
    
    // #243 关键修复：先计算实际会处理的文件数，再递增 uploadingCount
    // 原问题：直接用 files.length 递增，但如果槽位不足，实际处理的文件数少于递增数，导致计数器永远不归零
    const remainingSlots = 6 - referenceImages.length;
    const actualProcessCount = Math.min(files.length, Math.max(0, remainingSlots));
    
    if (actualProcessCount === 0) {
      toast.warning('已达到最大上传数量（6张）');
      event.target.value = '';
      return;
    }
    
    console.log('[生图参考图] 选择了', files.length, '个文件，实际处理', actualProcessCount, '个');
    
    // 设置正在上传的数量（只计算实际会处理的）
    setUploadingCount(prev => prev + actualProcessCount);
    
    try {
      // 调用 Hook 处理文件
      await processUploadFiles(files, {
        existingMd5s: referenceImageMd5s,
        currentCount: referenceImages.length,
        // 乐观 UI：立即显示预览（但不减少 uploadingCount）
        onOptimisticUpdate: (result: OptimisticUploadResult) => {
          setReferenceImages(prev => [...prev, result.base64].slice(0, 6));
          setReferenceImageMd5s(prev => [...prev, result.md5].slice(0, 6));
          // #048 新增：将正在上传的图片 MD5 加入追踪
          setUploadingMd5s(prev => new Set(prev).add(result.md5));
          // #048 关键修复：不在乐观更新时减少 uploadingCount
          // 上传还没完成，用户应该看到加载状态
          
          // #242 关键修复：立即同步更新 MD5 Ref，避免幽灵 MD5
          // 原问题：乐观更新只更新 State，Ref 依赖 useEffect 异步同步
          // 如果用户快速点击"再次生成"，Ref 可能还没同步，导致 MD5 残留
          referenceImageMd5sRef.current = [...referenceImageMd5sRef.current, result.md5].slice(0, 6);
          console.log('[onOptimisticUpdate #242] 同步更新 MD5 Ref:', result.md5?.substring(0, 8));
        },
        // 后台上传完成：更新 URL 和 Key，并减少 uploadingCount
        onBackgroundComplete: (result: BackgroundUploadResult) => {
          // #048 修复：上传完成时才减少 uploadingCount（无论成功还是失败）
          setUploadingCount(prev => Math.max(0, prev - 1));
          // #048 新增：从上传追踪中移除
          setUploadingMd5s(prev => {
            const newSet = new Set(prev);
            newSet.delete(result.md5);
            return newSet;
          });
          
          if (result.success && result.md5) {
            // 🔧 #215 修复：直接同步更新所有状态，避免嵌套 setState
            setReferenceImageMd5s(currentMd5s => {
              const md5Index = currentMd5s.indexOf(result.md5);
              if (md5Index < 0) return currentMd5s; // 没找到，不更新
              
              // 更新 URL
              setReferenceImageUrls(prev => {
                const newUrls = [...prev];
                while (newUrls.length <= md5Index) newUrls.push('');
                newUrls[md5Index] = result.url;
                return newUrls;
              });
              
              // 更新 Key
              setReferenceImageKeys(prev => {
                const newKeys = [...prev];
                while (newKeys.length <= md5Index) newKeys.push('');
                newKeys[md5Index] = result.key;
                return newKeys;
              });
              
              // 🔧 #215 关键修复：立即同步更新 ref，避免等待 useEffect
              referenceImageUrlsRef.current = referenceImageUrlsRef.current.map((url, idx) => 
                idx === md5Index ? result.url : url
              );
              referenceImageKeysRef.current = referenceImageKeysRef.current.map((key, idx) => 
                idx === md5Index ? result.key : key
              );
              // 确保 ref 数组长度正确
              while (referenceImageUrlsRef.current.length <= md5Index) referenceImageUrlsRef.current.push('');
              while (referenceImageKeysRef.current.length <= md5Index) referenceImageKeysRef.current.push('');
              referenceImageUrlsRef.current[md5Index] = result.url;
              referenceImageKeysRef.current[md5Index] = result.key;
              
              console.log('[onBackgroundComplete] 更新完成:', { md5Index, url: result.url?.substring(0, 50), key: result.key });
              
              return currentMd5s; // MD5 列表不变
            });
          } else if (!result.success) {
            // #240 修复：MD5 重复时显示友好提示，而不是错误
            if (result.error === '图片已存在，已跳过') {
              toast.info('图片已存在，已跳过重复上传');
            } else {
              toast.error(`图片上传失败: ${result.error || '未知错误'}`);
            }
          }
        },
        // 处理失败
        onError: (fileName: string, error: string) => {
          setUploadingCount(prev => Math.max(0, prev - 1));
          toast.error(`图片处理失败: ${fileName}`);
        },
        // 数量不足提示
        onSlotsExhausted: (requested: number, available: number) => {
          if (available === 0) {
            toast.warning('已达到最大上传数量（6张）');
          } else {
            toast.info(`已选择 ${requested} 张图片，仅处理前 ${available} 张`);
          }
        },
      });
      
      toast.success('参考图已添加');
    } finally {
      // #240 关键修复：无论成功、失败还是拦截，都清空 input
      // 确保可以重复选择同一张图片
      event.target.value = '';
    }
  };

  const handleRemoveReferenceImage = (index: number) => {
    // 1. 更新 State 变量
    setReferenceImages(referenceImages.filter((_, i) => i !== index));
    setReferenceImageUrls(referenceImageUrls.filter((_, i) => i !== index));
    setReferenceImageMd5s(referenceImageMd5s.filter((_, i) => i !== index));
    setReferenceImageKeys(referenceImageKeys.filter((_, i) => i !== index));
    
    // 2. #239 立即同步更新 Ref 变量（避免闭包陷阱）
    // 原问题：Ref 通过 useEffect 异步同步，用户删除后立即点击生成，Ref 里还是旧值
    referenceImageKeysRef.current = referenceImageKeysRef.current.filter((_, i) => i !== index);
    referenceImageUrlsRef.current = referenceImageUrlsRef.current.filter((_, i) => i !== index);
    referenceImageMd5sRef.current = referenceImageMd5sRef.current.filter((_, i) => i !== index);
    
    console.log('[删除参考图 #239] 同步清理 State + Ref, index:', index);
  };

  // ============================================
  // 【重构后的 handleStartGeneration - 使用统一生成引擎】
  // 2025年 - 接入 useGenService，删除 SSE/积分/轮询代码
  // ============================================
  const handleStartGeneration = async () => {
    console.log('=== 开始生成（统一引擎）===');
    console.log('[调试] model:', model);
    console.log('[调试] modelActiveStatus[model]:', modelActiveStatus[model]);
    console.log('[调试] isLoggedIn:', isLoggedIn);
    console.log('[调试] credits:', credits);
    console.log('[调试] prompt:', prompt?.trim()?.substring(0, 50));

    // 验证：模型状态
    if (modelActiveStatus[model] === false) {
      console.log('[调试] 模型离线，返回');
      toast.warning('模型离线', { description: '当前选择的模型暂时不可用' });
      return;
    }

    // 验证：上传中
    if (uploadingCount > 0) {
      console.log('[调试] 上传中，返回');
      toast.warning('请等待图片上传完成');
      return;
    }

    // 验证：登录
    // 【使用 AIGeneratorContext 的 isLoggedIn 和 credits】
    if (!isLoggedIn) {
      console.log('[调试] 未登录，返回');
      toast.error('请先登录');
      window.dispatchEvent(new CustomEvent('openLogin'));
      return;
    }

    // 验证：积分
    const requiredCredits = currentCreditCost * count;
    if (credits < requiredCredits) {
      console.log('[调试] 积分不足，返回');
      toast.error('积分不足', { description: `当前: ${credits}，需要: ${requiredCredits}` });
      return;
    }

    // 验证：输入
    if (!prompt.trim()) {
      console.log('[调试] 提示词为空，返回');
      toast.error('请输入提示词');
      return;
    }
    // 注意：参考图是可选的，支持纯文本生成（文生图）
    
    console.log('[调试] 所有验证通过，开始生成...');

    // 保存提示词历史
    savePromptToLocal(prompt.trim(), referenceImageUrls.length > 0 ? referenceImageUrls : []);

    // 创建任务卡片（用于 UI 展示）
    const newTaskId = Date.now().toString();
    const newTask: GenerationTask = {
      id: newTaskId,
      status: 'generating',
      images: [],
      viewedImages: new Set(),
      dislikedImages: new Set(),
      expectedCount: count,
      itemStatuses: Array(count).fill('generating'),
      itemErrors: Array(count).fill(null),
      createdAt: new Date(),
      creditsCharged: requiredCredits,
      params: {
        model,
        prompt: prompt.trim(),
        resolution,
        aspectRatio,
        // #253 修复：使用下划线命名（与数据库一致）
        reference_images: [...referenceImages],
        reference_image_urls: [...referenceImageUrls],
        reference_image_md5s: [...referenceImageMd5s],
        reference_image_keys: [...referenceImageKeys],
      },
    };

    // #112 修复：立即保存任务到 store，确保页面刷新后能恢复
    // 原问题：setTasks 触发 useEffect 异步保存，用户快速离开页面会导致任务丢失
    const updatedTasks = [newTask, ...tasks];
    setTasks(updatedTasks);
    generateStore.setTasks(updatedTasks); // 立即同步到 store 并保存到 localStorage
    
    if (!selectedTaskId) {
      setSelectedTaskId(newTaskId);
      setSelectedImageIndex(0);
    }

    // 参考图处理
    // #235 修复：彻底禁用 Base64 降级，只使用 COS URL
    const validUrls = referenceImageUrls.filter(url => url && url.length > 0);
    const images = validUrls;  // 不再降级到 Base64
    const isUrls = validUrls.length > 0;

    // 🔧 #215 提交层拦截池：等待后台参考图上传完成
    // 用户随时可以点发送，系统自己在后台排队等 Key
    await waitForPendingUploads();
    
    // 🔧 #215 关键修复：等待一个微任务，确保 React 状态更新完成
    // 因为 onBackgroundComplete 中的 setState 是异步的
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // 🔧 #239 关键修复：强制过滤空值，确保数据干净
    // 原问题：删除参考图后 Ref 可能残留空值，导致历史记录中出现"已删除的旧图"
    const finalReferenceImageKeys = referenceImageKeysRef.current.filter(key => key && key.length > 0);
    const finalReferenceImageUrls = referenceImageUrlsRef.current.filter(url => url && url.length > 0);
    const finalReferenceImageMd5s = referenceImageMd5sRef.current.filter(md5 => md5 && md5.length > 0);
    
    console.log('[handleSend] 发送前状态 #239:', {
      pendingUploads: 0,
      refKeys: finalReferenceImageKeys,
      refUrls: finalReferenceImageUrls?.map((u: string) => u?.substring(0, 50)),
      refMd5s: finalReferenceImageMd5s,
    });
    
    // 🔧 #044 更新任务中的 referenceImageKeys 和 referenceImageUrls
    if (finalReferenceImageKeys.length > 0 || finalReferenceImageUrls.length > 0) {
      setTasks(prev => prev.map(t =>
        t.id === newTaskId ? {
          ...t,
          params: {
            ...t.params,
            referenceImageKeys: finalReferenceImageKeys.length > 0 ? [...finalReferenceImageKeys] : t.params.referenceImageKeys,
            referenceImageUrls: finalReferenceImageUrls.length > 0 ? [...finalReferenceImageUrls] : t.params.referenceImageUrls,
          }
        } : t
      ));
    }
    
    // 使用最新的数据
    // #235 修复：彻底禁用 Base64 降级，只使用 COS URL
    // 如果用户没传图（纯文生图），传空数组；如果传了图，传 URL
    const finalValidUrls = finalReferenceImageUrls.filter((url: string) => url && url.length > 0);
    const finalImages = finalValidUrls;  // 不再降级到 Base64
    const finalIsUrls = finalValidUrls.length > 0;

    // 调用统一生成引擎（useGenService）
    // 【保命三剑客已由 useGenService 承接：300秒轮询 + SSE流式 + 积分双重保险】
    // #047 修复：传递前端预生成的 taskId，确保前后端ID一致
    await handleGenerate({
      prompt: prompt.trim(),
      model,
      resolution,
      aspectRatio,
      generationCount: count,
      taskId: newTaskId,  // #047 关键修复：传递前端创建的任务ID
      images: finalImages,
      isUrls: finalIsUrls,
      md5Hashes: finalReferenceImageMd5s,  // #239 使用过滤后的 MD5

      // 进度回调：更新任务卡片
      onProgress: () => {
        setTasks(prev => prev.map(t =>
          t.id === newTaskId ? { ...t, status: 'generating' } : t
        ));
      },

      // 图片完成回调：更新任务卡片
      // #106 修复：按 index 插入图片，确保与 itemStatuses 顺序一致
      onImageReceived: (data) => {
        setTasks(prev => prev.map(t => {
          if (t.id !== newTaskId) return t;
          
          // #106 修复：按 index 插入图片，而不是追加到末尾
          const newImages = [...t.images];
          const newImageKeys = [...(t.imageKeys || [])];
          if (data.index !== undefined) {
            // 确保 index 位置存在
            while (newImages.length <= data.index) {
              newImages.push('');
            }
            while (newImageKeys.length <= data.index) {
              newImageKeys.push('');
            }
            // 按 index 插入图片
            newImages[data.index] = data.url;
            if (data.key) {
              newImageKeys[data.index] = data.key;
            }
          } else {
            // 兜底：没有 index 时追加到末尾
            newImages.push(data.url);
            if (data.key) {
              newImageKeys.push(data.key);
            }
          }
          
          const newItemStatuses = [...t.itemStatuses];
          if (data.index !== undefined && data.index < newItemStatuses.length) {
            newItemStatuses[data.index] = data.status === 'failed' ? 'failed' : 'completed';
          }
          
          // 更新失败错误信息
          const newItemErrors = [...t.itemErrors];
          if (data.error && data.index !== undefined && data.index < newItemErrors.length) {
            newItemErrors[data.index] = data.error;
          }
          
          if (!selectedTaskId || (selectedTask && selectedTask.images.length === 0)) {
            setSelectedTaskId(newTaskId);
            setSelectedImageIndex(data.index ?? (newImages.length - 1));
          }
          return { ...t, images: newImages, imageKeys: newImageKeys, itemStatuses: newItemStatuses, itemErrors: newItemErrors };
        }));
        
        // #150 Local-First：后台异步缓存（不阻塞渲染）
        if (data.key && data.url) {
          import('@/lib/canvas-image-db').then(({ storeImageByKey }) => {
            fetch(data.url)
              .then(res => res.blob())
              .then(blob => {
                if (blob && blob.size > 0) {
                  storeImageByKey(data.key!, blob, blob.type).then(success => {
                    if (success) {
                      console.log('[生图页面] #150 已缓存到 IndexedDB:', data.key);
                    }
                  }).catch(console.error);
                }
              })
              .catch(err => {
                console.error('[生图页面] #150 后台缓存失败:', data.key, err);
              });
          }).catch(console.error);
        }
      },

      // 失败回调：标记任务失败
      onPlaceholderFailed: (elementId, error) => {
        setTasks(prev => prev.map(t => {
          if (t.id !== newTaskId) return t;
          return {
            ...t,
            status: 'failed',
            error,
            images: [],  // #245 失败时清空图片数组，避免显示坏图图标
            itemStatuses: t.itemStatuses.map(() => 'failed'),
            itemErrors: t.itemErrors.map(() => error),
          };
        }));
      },

      // 完成回调：更新最终状态
      // #106 修复：使用 imageItems 的实际 index 设置状态，避免状态错乱导致缩略图闪烁
      onComplete: (result) => {
        // 🔧 #044 关键修复：使用 ref 获取最新的参考图数据
        // 因为 setTasks 是异步的，之前在 handleSend 开头设置的 referenceImageKeys 可能还没生效
        const latestReferenceImageKeys = referenceImageKeysRef.current;
        const latestReferenceImageUrls = referenceImageUrlsRef.current;
        const latestReferenceImageMd5s = referenceImageMd5sRef.current;
        
        console.log('[onComplete] 保存记录前的参考图数据:', {
          keys: latestReferenceImageKeys,
          urls: latestReferenceImageUrls?.length,
          md5s: latestReferenceImageMd5s?.length
        });
        
        setTasks(prev => {
          const updatedTasks = prev.map(t => {
            if (t.id !== newTaskId) return t;
            
            // 使用 processImageItemsWithDeletedFilter 处理，确保状态正确
            const { orderedImages, newItemStatuses, newItemErrors } = processImageItemsWithDeletedFilter(
              t, // 传入当前任务
              result.imageUrls || [],
              result.imageItems,
              result.errors,
              undefined
            );

            return {
              ...t,
              status: (orderedImages.length > 0 ? 'completed' : 'failed') as 'completed' | 'failed',
              images: orderedImages,
              itemStatuses: newItemStatuses,
              itemErrors: newItemErrors,
              // 🔧 修复：保存扣费信息，用于历史记录显示
              creditsCharged: result.creditsCharged ?? t.creditsCharged,
              creditsBalanceAfter: result.creditsBalance ?? t.creditsBalanceAfter,
              // 🔧 #044 关键修复：使用最新的参考图数据
              params: {
                ...t.params,
                referenceImageKeys: latestReferenceImageKeys.length > 0 ? latestReferenceImageKeys : t.params.referenceImageKeys,
                referenceImageUrls: latestReferenceImageUrls.length > 0 ? latestReferenceImageUrls : t.params.referenceImageUrls,
                referenceImageMd5s: latestReferenceImageMd5s.length > 0 ? latestReferenceImageMd5s : t.params.referenceImageMd5s,
              }
            };
          });
          
          // #232 Sprint 3：删除 saveRecord 调用，由 AIGeneratorContext 统一保存
          const completedTask = updatedTasks.find(t => t.id === newTaskId);
          // console.log('[#232] onComplete 生图完成，由 AIGeneratorContext 统一保存记录');
          
          return updatedTasks;
        });
      },

      // 错误回调
      onError: (error) => {
        setTasks(prev => prev.map(t => {
          if (t.id !== newTaskId) return t;
          return {
            ...t,
            status: 'failed',
            error: error.message,
            images: [],  // #245 失败时清空图片数组，避免显示坏图图标
            itemStatuses: t.itemStatuses.map(() => 'failed'),
            itemErrors: t.itemErrors.map(() => error.message),
          };
        }));
        if (error.message.includes('network') || error.message.includes('fetch')) {
          toast.warning('网络连接中断，图片可能仍在生成中');
        }
      },
    });

    // 🔧 #212 修复：不再清除提示词和参考图，让用户可以继续使用
    // setPrompt('');
    // setReferenceImages([]);
    // setReferenceImageUrls([]);
    // setReferenceImageMd5s([]);
    // setReferenceImageKeys([]);
  };

  const handleDownload = async (imageUrl: string, index: number) => {
    // 立即显示下载中提示
    const toastId = toast.loading('正在下载...');
    
    try {
      // 从 URL 中提取 key 或使用代理
      let downloadUrl = imageUrl;
      
      // 如果是腾讯云 COS URL，使用代理 API 避免 CORS 问题
      if (imageUrl.includes('cos.ap-hongkong.myqcloud.com')) {
        // 尝试从 URL 中提取 key
        // URL 格式: https://kiikii-ai-1412916018.cos.ap-hongkong.myqcloud.com/generated-images/xxx.png?...
        const keyMatch = imageUrl.match(/\.com\/([^?]+)/);
        if (keyMatch) {
          const cosKey = keyMatch[1]; // 例如: generated-images/xxx.png
          downloadUrl = `/api/proxy-image?key=${encodeURIComponent(cosKey)}`;
        } else {
          // 使用 URL 代理
          downloadUrl = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
        }
      } else if (imageUrl.includes('oss-cn-guangzhou.aliyuncs.com')) {
        // 兼容旧的阿里云 OSS URL
        const keyMatch = imageUrl.match(/\/generated-images\/[^?]+/);
        if (keyMatch) {
          const ossKey = keyMatch[0].substring(1); // 移除开头的 /
          downloadUrl = `/api/proxy-image?key=${encodeURIComponent(ossKey)}`;
        } else {
          // 使用 URL 代理
          downloadUrl = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
        }
      } else if (imageUrl.startsWith('/api/proxy-image')) {
        // 已经是代理 URL，直接使用
        downloadUrl = imageUrl;
      }
      
      console.log('下载图片:', downloadUrl.substring(0, 100));
      
      const response = await fetch(downloadUrl);
      
      if (!response.ok) {
        throw new Error(`下载失败: ${response.status}`);
      }
      
      const blob = await response.blob();
      
      if (blob.size === 0) {
        throw new Error('图片数据为空');
      }
      
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `KiikiiAI_${Date.now()}_${index + 1}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      
      toast.success('下载成功', { id: toastId });
    } catch (error: any) {
      console.error('下载失败:', error);
      toast.error('下载失败', { id: toastId, description: error.message || '请重试' });
    }
  };

  const handleSelectTaskImage = (taskId: string, imageIndex: number) => {
    setSelectedTaskId(taskId);
    setSelectedImageIndex(imageIndex);
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const newViewed = new Set(t.viewedImages);
        newViewed.add(imageIndex);
        return { ...t, viewedImages: newViewed };
      }
      return t;
    }));
  };

  // 计算所有任务的图片（扁平化数组，按时间顺序）
  // 注意：这里是扁平化的单一列表，不按任务分组显示
  const allImages = useMemo(() => {
    const images: { taskId: string; imageIndex: number; url: string }[] = [];
    // 按任务创建时间倒序排列（最新的在前）
    const sortedTasks = [...tasks].sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    sortedTasks.forEach(task => {
      task.images.forEach((url, idx) => {
        images.push({ taskId: task.id, imageIndex: idx, url });
      });
    });
    return images;
  }, [tasks]);

  // 当前图片在全局数组中的索引
  const currentGlobalIndex = useMemo(() => {
    if (!selectedTaskId) return allImages.length > 0 ? 0 : -1;
    const idx = allImages.findIndex(
      img => img.taskId === selectedTaskId && img.imageIndex === selectedImageIndex
    );
    return idx >= 0 ? idx : 0;
  }, [allImages, selectedTaskId, selectedImageIndex]);

  // 跨任务切换：上一张
  const handleGlobalPrev = useCallback(() => {
    const currentIdx = currentGlobalIndex;
    if (currentIdx > 0) {
      const prevImg = allImages[currentIdx - 1];
      if (prevImg) {
        setSelectedTaskId(prevImg.taskId);
        setSelectedImageIndex(prevImg.imageIndex);
      }
    }
  }, [currentGlobalIndex, allImages]);

  // 跨任务切换：下一张
  const handleGlobalNext = useCallback(() => {
    const currentIdx = currentGlobalIndex;
    if (currentIdx < allImages.length - 1 && currentIdx >= 0) {
      const nextImg = allImages[currentIdx + 1];
      if (nextImg) {
        setSelectedTaskId(nextImg.taskId);
        setSelectedImageIndex(nextImg.imageIndex);
      }
    }
  }, [currentGlobalIndex, allImages]);

  // 自动选中第一张图片（如果没有选中且有图片）
  useEffect(() => {
    if (!selectedTaskId && allImages.length > 0) {
      const firstImg = allImages[0];
      if (firstImg) {
        setSelectedTaskId(firstImg.taskId);
        setSelectedImageIndex(firstImg.imageIndex);
      }
    }
  }, [selectedTaskId, allImages]);

  // 键盘左右键切换预览图片（支持跨任务切换）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 只有在有图片时才能切换
      if (allImages.length === 0) return;
      
      // 忽略输入框中的按键
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleGlobalPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleGlobalNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [allImages.length, handleGlobalPrev, handleGlobalNext]);

  // 删除单张图片 - 从扁平化列表中删除，永久移除
  const handleDeleteImage = useCallback((taskId: string, imageIndex: number) => {
    // 找到要删除的图片在扁平化列表中的位置
    const deleteIndex = allImages.findIndex(
      img => img.taskId === taskId && img.imageIndex === imageIndex
    );
    
    // 获取要删除的图片URL，记录到已删除集合中
    const task = tasks.find(t => t.id === taskId);
    if (task && task.images[imageIndex]) {
      const deletedUrl = task.images[imageIndex];
      generateStore.addDeletedImageUrl(deletedUrl);
      console.log('[删除图片] 记录已删除图片:', deletedUrl.substring(0, 50));
    }
    
    // 计算新的任务列表
    const newTasks = tasks.map(t => {
      if (t.id === taskId) {
        const newImages = t.images.filter((_, idx) => idx !== imageIndex);
        
        // 同步更新 itemStatuses
        let completedCount = 0;
        let itemStatusIdxToRemove = -1;
        for (let i = 0; i < t.itemStatuses.length; i++) {
          if (t.itemStatuses[i] === 'completed') {
            if (completedCount === imageIndex) {
              itemStatusIdxToRemove = i;
              break;
            }
            completedCount++;
          }
        }
        
        const newItemStatuses = itemStatusIdxToRemove >= 0 
          ? t.itemStatuses.filter((_, idx) => idx !== itemStatusIdxToRemove)
          : t.itemStatuses;
        const newItemErrors = itemStatusIdxToRemove >= 0
          ? t.itemErrors.filter((_, idx) => idx !== itemStatusIdxToRemove)
          : t.itemErrors;
        
        // 如果所有图片都删除了且没有生成中的，删除整个任务
        if (newImages.length === 0 && !newItemStatuses.some(s => s === 'generating' || s === 'pending')) {
          return null as any;
        }
        
        return { 
          ...t, 
          images: newImages, 
          itemStatuses: newItemStatuses,
          itemErrors: newItemErrors,
          expectedCount: Math.max(newImages.length, t.expectedCount - 1),
        };
      }
      return t;
    }).filter(Boolean) as GenerationTask[];
    
    // 更新任务列表
    setTasks(newTasks);
    
    // 计算删除后剩余的图片列表
    const remainingImages: { taskId: string; imageIndex: number }[] = [];
    const sortedNewTasks = [...newTasks].sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    sortedNewTasks.forEach(task => {
      task.images.forEach((_, idx) => {
        remainingImages.push({ taskId: task.id, imageIndex: idx });
      });
    });
    
    // 更新选中状态 - 使用删除位置来确定新的选中
    if (remainingImages.length > 0) {
      // 删除后，选中同一位置的下一张图片
      const newIndex = Math.min(deleteIndex, remainingImages.length - 1);
      const nextImg = remainingImages[newIndex];
      if (nextImg) {
        setSelectedTaskId(nextImg.taskId);
        setSelectedImageIndex(nextImg.imageIndex);
      }
    } else {
      setSelectedTaskId(null);
      setSelectedImageIndex(0);
    }
  }, [tasks, allImages]);

  // 删除失败的图片
  const handleDeleteFailedItem = (taskId: string, itemIndex: number) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const newItemStatuses = t.itemStatuses.filter((_, idx) => idx !== itemIndex);
        const newItemErrors = t.itemErrors.filter((_, idx) => idx !== itemIndex);
        
        // 如果所有项目都删除了，删除整个任务
        if (newItemStatuses.length === 0) {
          return null as any;
        }
        
        return { 
          ...t, 
          itemStatuses: newItemStatuses,
          itemErrors: newItemErrors,
          expectedCount: newItemStatuses.length
        };
      }
      return t;
    }).filter(Boolean));
  };

  // 再次生成 - 使用相同的参数重新提交任务
  const handleRegenerate = async (task: GenerationTask) => {
    // 【使用 AIGeneratorContext 的 isLoggedIn 和 credits】
    if (!isLoggedIn) {
      toast.error('请先登录', { description: '请登录后继续操作' });
      window.dispatchEvent(new CustomEvent('openLogin'));
      return;
    }

    // #255 方案 A：不再替换左侧操作容器，保护用户输入
    // 原任务参数通过局部变量传递，不影响左侧 State/Ref
    // 右侧详情面板通过 selectedTask.params 显示，不受影响

    // 计算需要的积分（使用选择的生成数量）
    const config = dynamicModelConfig[task.params.model] || {
      resolutions: [{ size: '1K', credits: 10 }],
      aspectRatios: defaultAspectRatios,
    };
    const creditCost = config.resolutions.find(r => r.size === task.params.resolution)?.credits || config.resolutions[0].credits;
    const requiredCredits = creditCost * regenerateCount;

    // 【积分扣除已由 useGenService 统一处理，无需手动调用】
    // 检查积分是否足够
    if (credits < requiredCredits) {
      toast.error('积分不足', { description: `当前积分: ${credits}，需要: ${requiredCredits}` });
      return;
    }

    // 创建新任务（使用选择的生成数量）
    const newTaskId = Date.now().toString();
    
    // 【修复】使用原任务的参考图，而不是当前页面状态
    // #252/#253 修复：使用正确的字段名（下划线命名，与数据库一致）
    const originalRefImages = task.params.reference_images || task.params.reference_image_urls || [];
    const originalRefKeys = task.params.reference_image_keys || [];
    const originalRefMd5s = task.params.reference_image_md5s || [];
    const originalRefUrls = originalRefImages;  // 兼容旧代码
    
    const newTask: GenerationTask = {
      id: newTaskId,
      status: 'generating',
      images: [],
      viewedImages: new Set(),
      dislikedImages: new Set(),
      expectedCount: regenerateCount,
      itemStatuses: Array(regenerateCount).fill('generating'),
      itemErrors: Array(regenerateCount).fill(null),
      createdAt: new Date(),
      creditsCharged: requiredCredits,  // #237 修复：添加积分字段
      params: {
        model: task.params.model,
        prompt: task.params.prompt,
        resolution: task.params.resolution,
        aspectRatio: task.params.aspectRatio,
        // #253 修复：使用下划线命名（与数据库一致）
        reference_images: [...originalRefImages],
        reference_image_urls: [...originalRefUrls],
        reference_image_keys: [...originalRefKeys],
        reference_image_md5s: [...originalRefMd5s],
      },
    };

    // #112 修复：立即保存任务到 store，确保页面刷新后能恢复
    const updatedTasks = [newTask, ...tasks];
    setTasks(updatedTasks);
    generateStore.setTasks(updatedTasks);
    
    setSelectedTaskId(newTaskId);
    setSelectedImageIndex(0);

    // 提交任务
    try {
      // 【修复】使用原任务的参考图 URL
      const urls = originalRefUrls.length > 0 ? originalRefUrls : originalRefImages;
      const requestBody = {
        taskId: newTaskId, // 传递前端生成的任务ID
        prompt: task.params.prompt,
        images: urls,
        isUrls: true,
        model: task.params.model,
        resolution: task.params.resolution.toUpperCase(),
        aspectRatio: task.params.aspectRatio,
        generationCount: regenerateCount,
        userId: userId, // 传递用户ID，用于Webhook回调保存到数据库
      };

      const response = await fetch('/api/image-to-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        setSubmittedTaskIds(prev => new Set(prev).add(newTaskId));
      }

      const contentType = response.headers.get('content-type');
      
      if (contentType?.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        // #237 修复：使用局部变量累积图片，避免闭包陷阱
        const collectedImages: string[] = [];
        const collectedKeys: string[] = [];

        const processLine = (line: string) => {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'image' && data.url) {
                // #237: 同时累积到局部变量（用于保存历史记录）
                if (data.index !== undefined) {
                  while (collectedImages.length <= data.index) {
                    collectedImages.push('');
                    collectedKeys.push('');
                  }
                  collectedImages[data.index] = data.url;
                  if (data.key) collectedKeys[data.index] = data.key;
                } else {
                  collectedImages.push(data.url);
                  if (data.key) collectedKeys.push(data.key);
                }
                
                setTasks(prev => prev.map(t => {
                  if (t.id === newTaskId) {
                    // #106 修复：按 index 插入图片，确保与 itemStatuses 顺序一致
                    const newImages = [...t.images];
                    if (data.index !== undefined) {
                      while (newImages.length <= data.index) {
                        newImages.push('');
                      }
                      newImages[data.index] = data.url;
                    } else {
                      newImages.push(data.url);
                    }
                    const newItemStatuses = [...t.itemStatuses];
                    if (data.index !== undefined && data.index < newItemStatuses.length) {
                      newItemStatuses[data.index] = 'completed';
                    }
                    return { ...t, images: newImages, itemStatuses: newItemStatuses };
                  }
                  return t;
                }));
              } else if (data.type === 'error' && data.index !== undefined) {
                setTasks(prev => prev.map(t => {
                  if (t.id === newTaskId) {
                    const newItemStatuses = [...t.itemStatuses];
                    const newItemErrors = [...t.itemErrors];
                    if (data.index < newItemStatuses.length) {
                      newItemStatuses[data.index] = 'failed';
                      newItemErrors[data.index] = data.error || '生成失败';
                    }
                    return { ...t, itemStatuses: newItemStatuses, itemErrors: newItemErrors };
                  }
                  return t;
                }));
              } else if (data.type === 'error' && data.taskId) {
                // 处理全局错误（所有图片都失败）
                console.log('收到全局error事件:', data);
                setTasks(prev => prev.map(t => {
                  if (t.id === newTaskId) {
                    // 标记所有未完成的图片为失败
                    const newItemStatuses = t.itemStatuses.map(status => 
                      status === 'generating' ? 'failed' : status
                    );
                    const newItemErrors = t.itemErrors.map((err, idx) => 
                      t.itemStatuses[idx] === 'generating' ? (data.error || '生成失败') : err
                    );
                    return { 
                      ...t, 
                      itemStatuses: newItemStatuses, 
                      itemErrors: newItemErrors,
                      status: 'completed'
                    };
                  }
                  return t;
                }));
              } else if (data.type === 'done') {
                // #237 修复：先更新状态（纯函数），副作用在 setTasks 外部执行
                setTasks(prev => prev.map(t => {
                  if (t.id === newTaskId) {
                    return { ...t, status: 'completed' as const };
                  }
                  return t;
                }));
                
                // #237 修复：在 setTasks 外部调用保存（副作用），使用局部累积变量
                // 直接使用局部变量，不依赖 tasks 状态（避免异步陷阱）
                if (collectedImages.length > 0) {
                  saveHistoryRecord({
                    taskId: newTaskId,
                    model: newTask.params.model,
                    prompt: newTask.params.prompt,
                    images: collectedImages,
                    imageKeys: collectedKeys,
                    referenceImages: originalRefUrls,
                    referenceImageMd5s: originalRefMd5s,  // #242 新增：保存参考图 MD5
                    resolution: newTask.params.resolution,
                    aspectRatio: newTask.params.aspectRatio,
                    creditsCharged: requiredCredits,  // 使用预计算的积分值
                    source: 'regenerate',
                  });
                  console.log(`[再次生成] #242 保存历史记录: taskId=${newTaskId}, images=${collectedImages.length}, refMd5s=${originalRefMd5s.length}, creditsCharged=${requiredCredits}`);
                }
              }
            } catch (e) {
              console.error('解析数据失败:', e);
            }
          }
        };

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (line.trim()) processLine(line);
          }
        }
      }
    } catch (error) {
      console.error('重新生成失败:', error);
      toast.error('重新生成失败，请重试');
    } finally {
      // #251 强制解锁：确保上传计数器归零
      setUploadingCount(0);
    }
  };

  const isImageNew = (taskId: string, imageIndex: number) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return false;
    return !task.viewedImages.has(imageIndex);
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      {/* 左侧导航 */}
      <LeftNav />
      
      {/* 主内容区域 - 添加左侧padding以避免被导航遮挡 */}
      <div className="flex pl-16 p-3 gap-3" style={{ height: '100vh' }}>
        {/* 左侧面板 */}
        <div className="w-[460px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm px-8 pt-8 pb-[60px] flex flex-col flex-shrink-0" style={{ height: '100%', overflowY: 'auto' }}>
          {/* 模型选择 */}
          <div className="mb-4">
            <Label className="mb-2 block text-sm font-semibold text-gray-900 dark:text-white">模型类型</Label>
            <button 
              className="w-full h-9 px-3 flex items-center justify-between text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              onClick={() => setShowModelPicker(true)}
            >
              <div className="flex items-center gap-2">
                <img src="/model-logo.png" alt="" className="w-5 h-5 rounded" />
                <span className="text-gray-900 dark:text-white font-mono">{modelDisplayNames[model] || formatModelName(model)}</span>
                {/* 使用 modelActiveStatus 显示在线状态（绿色=在线，红色=离线） */}
                <span className={modelActiveStatus[model] !== false ? 'text-green-500' : 'text-red-500'}>
                  {modelActiveStatus[model] !== false ? '●' : '○'}
                </span>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          {/* 参考图 */}
          <div className="mb-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold text-gray-900 dark:text-white">
                上传图片 <span className="text-xs text-gray-500 dark:text-gray-400">({referenceImages.length}{uploadingCount > 0 ? `+${uploadingCount}` : ''}/6)</span>
              </Label>
              {referenceImages.length > 0 && (
                <Button variant="ghost" size="sm" className="text-xs text-gray-500 dark:text-gray-400" onClick={() => {
                  // #241 修复：清空按钮也要同步清空 State + Ref
                  setReferenceImages([]);
                  setReferenceImageUrls([]);
                  setReferenceImageMd5s([]);
                  setReferenceImageKeys([]);
                  // 同步清空 Ref
                  referenceImageUrlsRef.current = [];
                  referenceImageKeysRef.current = [];
                  referenceImageMd5sRef.current = [];
                  console.log('[清空参考图 #241] 同步清空 State + Ref');
                }}>
                  清空
                </Button>
              )}
            </div>

            {/* 图片和上传按钮 - 固定高度，居中显示 */}
            <div 
              className="h-[252px] flex gap-3 flex-wrap justify-center items-start content-start select-none"
              onDoubleClick={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
            >
              {/* #251 已上传的图片 - 兼容 referenceImages（base64）和 referenceImageUrls（URL） */}
              {(() => {
                // #251 核心：合并两个数组，优先显示 base64，没有则显示 URL
                const maxLen = Math.max(referenceImages.length, referenceImageUrls.length);
                const displayImages: { src: string; idx: number; isUrl: boolean }[] = [];
                for (let i = 0; i < maxLen; i++) {
                  const base64 = referenceImages[i];
                  const url = referenceImageUrls[i];
                  if (base64 && base64.length > 0) {
                    displayImages.push({ src: base64, idx: i, isUrl: false });
                  } else if (url && url.length > 0) {
                    displayImages.push({ src: url, idx: i, isUrl: true });
                  }
                }
                return displayImages.map(({ src, idx, isUrl }) => (
                <div 
                  key={idx} 
                  className="relative w-[120px] h-[120px] cursor-pointer group flex-shrink-0 select-none" 
                  onClick={() => setPreviewImage(src)} 
                  draggable 
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', idx.toString())} 
                  onDragOver={(e) => e.preventDefault()} 
                  onDrop={(e) => { 
                    e.preventDefault(); 
                    const dragIdx = parseInt(e.dataTransfer.getData('text/plain')); 
                    if (dragIdx !== idx) { 
                      // 🔧 #043 修复：同步交换所有参考图相关数组
                      const newImages = [...referenceImages]; 
                      const newUrls = [...referenceImageUrls]; 
                      const newKeys = [...referenceImageKeys]; 
                      const newMd5s = [...referenceImageMd5s]; 
                      
                      // 交换位置
                      [newImages[dragIdx], newImages[idx]] = [newImages[idx], newImages[dragIdx]]; 
                      [newUrls[dragIdx], newUrls[idx]] = [newUrls[idx], newUrls[dragIdx]]; 
                      [newKeys[dragIdx], newKeys[idx]] = [newKeys[idx], newKeys[dragIdx]]; 
                      [newMd5s[dragIdx], newMd5s[idx]] = [newMd5s[idx], newMd5s[dragIdx]]; 
                      
                      // 同步更新 State
                      setReferenceImages(newImages); 
                      setReferenceImageUrls(newUrls); 
                      setReferenceImageKeys(newKeys); 
                      setReferenceImageMd5s(newMd5s); 
                      
                      // #241 修复：同步更新 Ref
                      referenceImageUrlsRef.current = [...newUrls];
                      referenceImageKeysRef.current = [...newKeys];
                      referenceImageMd5sRef.current = [...newMd5s];
                      
                      console.log('[参考图排序 #241] 从', dragIdx, '拖到', idx, '同步更新 State + Ref');
                    } 
                  }}
                >
                  <img src={src} alt={`参考图${idx + 1}`} className="w-full h-full object-contain rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 pointer-events-none" draggable={false} />
                  {/* #048 新增：上传中显示加载转圈 */}
                  {referenceImageMd5s[idx] && uploadingMd5s.has(referenceImageMd5s[idx]) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                      <Loader2 className="w-8 h-8 text-white animate-spin" />
                    </div>
                  )}
                  {/* #252 删除"历史"标签，用户不需要这个提示 */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                    <ZoomIn className="w-5 h-5 text-white" />
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleRemoveReferenceImage(idx); }} className="absolute top-1 right-1 w-5 h-5 bg-gray-800/70 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-gray-900/80 transition-opacity">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ));})()}
              
              {/* 上传按钮 - 最多6张，允许上传过程中继续上传，横向扩展 */}
              {Math.max(referenceImages.length, referenceImageUrls.length) < 6 && (
                <button
                  onClick={() => document.getElementById('single-ref-upload')?.click()}
                  className="h-[120px] min-w-[160px] flex-1 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex flex-col items-center justify-center gap-3 flex-shrink-0"
                >
                  <Upload className="w-12 h-12 text-gray-400" />
                  <span className="text-base font-medium text-gray-500">上传图片</span>
                </button>
              )}
            </div>

            <input id="single-ref-upload" type="file" accept="image/*" multiple onChange={handleReferenceImageUpload} className="hidden" disabled={referenceImages.length >= 6} />
          </div>

          {/* 提示词 */}
          <div className="mb-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold text-gray-900 dark:text-white">提示词</Label>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-xs text-gray-600 dark:text-gray-400" 
                onClick={() => setShowFavoritesModal(true)}
              >
                我的收藏
              </Button>
            </div>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="描述你想生成的内容..." className="h-[208px] resize-none bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500" maxLength={1800} />
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-1 text-right">{prompt.length}/1800</div>
          </div>

          {/* 参数设置 - 复刻画布页面样式 */}
          <div className="mt-auto">
            <Label className="mb-2 block text-sm font-semibold text-gray-900 dark:text-white">参数设置</Label>
            <div className="flex items-center gap-3 mb-1">
              <button 
                className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 transition-colors"
                style={{ transform: 'scale(1.1)', transformOrigin: 'bottom left' }}
                onClick={() => setShowResolutionPicker(!showResolutionPicker)}
              >
                分辨率: {resolution}
              </button>
              <button 
                ref={ratioButtonRef}
                className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 transition-colors"
                style={{ transform: 'scale(1.1)', transformOrigin: 'bottom left' }}
                onClick={() => {
                  if (ratioButtonRef.current) {
                    setRatioButtonLeft(ratioButtonRef.current.getBoundingClientRect().left);
                  }
                  setShowRatioPicker(!showRatioPicker);
                }}
              >
                比例: {aspectRatio}
              </button>
              <button 
                ref={countButtonRef}
                className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 transition-colors"
                style={{ transform: 'scale(1.1)', transformOrigin: 'bottom left' }}
                onClick={() => {
                  if (countButtonRef.current) {
                    setCountButtonLeft(countButtonRef.current.getBoundingClientRect().left);
                  }
                  setShowCountPicker(!showCountPicker);
                }}
              >
                数量: {count}
              </button>
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-[11px] text-gray-500 font-medium">
                  剩余 {credits}
                </span>
                <span className="text-[11px] text-gray-400 font-medium">
                  {currentCreditCost * count} 积分
                </span>
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2 mt-3">
            <Button
              className="flex-1 h-9 text-xs bg-gray-900 hover:bg-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 text-white transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleStartGeneration}
              disabled={uploadingCount > 0}
            >
              {uploadingCount > 0 ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  上传中... ({uploadingCount}张)
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" />
                  开始生成
                </>
              )}
            </Button>
          </div>
        </div>

        {/* 右侧预览面板 */}
        <div className="flex-1 flex flex-col min-w-0 gap-3 h-full relative">
          {/* 上方大图区域 */}
          <div className="flex-1 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex min-h-0">
            {/* 大图展示区 */}
            <div 
              ref={imageAreaRef} 
              className="flex-1 bg-gray-50 dark:bg-gray-800 min-w-0 min-h-0 relative overflow-hidden select-none"
              onDoubleClick={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
            >
              {/* #245 强化渲染拦截：必须确保第一个元素是有内容的字符串，避免显示坏图图标 */}
              {selectedTask && selectedTask.images?.[0] && selectedTask.images[0].length > 0 ? (
                (() => {
                  const currentImageUrl = selectedTask.images[selectedImageIndex] || selectedTask.images[0] || '';
                  const isExpired = isImageExpired(currentImageUrl, selectedTask.createdAt);
                  
                  // #245 双重保险：如果 currentImageUrl 为空，显示空白
                  if (!currentImageUrl || currentImageUrl.length === 0) {
                    return (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-20 h-20 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                          <ImageIcon className="w-10 h-10 text-gray-400" />
                        </div>
                      </div>
                    );
                  }
                  
                  return (
                    <>
                      {isExpired ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
                          <div className="w-20 h-20 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center mb-4">
                            <ImageIcon className="w-10 h-10 text-gray-400" />
                          </div>
                          <p className="text-gray-500 dark:text-gray-400 text-lg font-medium">图片已过期</p>
                          <p className="text-gray-400 dark:text-gray-500 text-sm mt-2">该图片链接已超过有效期</p>
                        </div>
                      ) : (
                        <ImagePreviewTrigger 
                          images={allImages.map(img => img.url)} 
                          currentIndex={currentGlobalIndex >= 0 ? currentGlobalIndex : 0} 
                          className="absolute inset-0 flex items-center justify-center p-4"
                          onNavigate={(taskId, imageIndex) => {
                            setSelectedTaskId(taskId);
                            setSelectedImageIndex(imageIndex);
                          }}
                          allImagesData={allImages}
                        >
                          <img
                            src={currentImageUrl}
                            alt="生成的大图"
                            className="block max-w-full max-h-full object-contain cursor-pointer pointer-events-none"
                            style={{ width: 'auto', height: 'auto' }}
                            draggable={false}
                            onError={() => handleImageError(currentImageUrl, selectedTask.createdAt)}
                          />
                        </ImagePreviewTrigger>
                      )}
                      <div className="absolute bottom-3 right-3 flex gap-2">
                        <Button size="sm" className="bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] hover:from-[rgb(120,140,220)] to-[rgb(212,160,170)] text-white brightness-110 saturate-[1.1]" onClick={() => handleDownload(currentImageUrl, selectedImageIndex)} disabled={isExpired}>
                          <Download className="w-4 h-4 mr-1" />
                          下载
                        </Button>
                        <Button size="sm" className="bg-black hover:bg-gray-900 text-white" onClick={() => {
                          // 存储到 sessionStorage，画布页面读取
                          sessionStorage.setItem('generateToSend', JSON.stringify({
                            imageUrl: currentImageUrl,
                            prompt: selectedTask.params?.prompt || '',
                          }));
                          router.push('/canvas');
                        }}>
                          <ImageIcon className="w-4 h-4 mr-1" />
                          发送到画布
                        </Button>
                      </div>
                      {/* 左右切换按钮 - 支持跨任务切换 */}
                  {allImages.length > 1 && (
                    <>
                      {currentGlobalIndex > 0 && (
                        <button
                          onClick={handleGlobalPrev}
                          className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center transition-colors z-10"
                        >
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                      )}
                      {currentGlobalIndex < allImages.length - 1 && (
                        <button
                          onClick={handleGlobalNext}
                          className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center transition-colors z-10"
                        >
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                  {/* 页码指示器 - 显示全局进度 */}
                  {allImages.length > 1 && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
                      <button 
                        onClick={handleGlobalPrev}
                        disabled={currentGlobalIndex <= 0}
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${currentGlobalIndex > 0 ? 'bg-white/30 hover:bg-white/50 text-white' : 'bg-white/10 text-white/30 cursor-not-allowed'}`}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <div className="flex gap-1.5 items-center">
                        {allImages.length <= 10 ? (
                          allImages.map((_, idx) => (
                            <button 
                              key={idx} 
                              onClick={() => {
                                const img = allImages[idx];
                                handleSelectTaskImage(img.taskId, img.imageIndex);
                              }} 
                              className={`w-2 h-2 rounded-full transition-colors ${idx === currentGlobalIndex ? 'bg-[rgb(139,158,232)]' : 'bg-gray-300 dark:bg-gray-600 hover:bg-gray-400'}`} 
                            />
                          ))
                        ) : (
                          // 图片太多时显示简化版
                          <>
                            {currentGlobalIndex > 2 && (
                              <button 
                                onClick={() => {
                                  const img = allImages[0];
                                  handleSelectTaskImage(img.taskId, img.imageIndex);
                                }}
                                className="w-2 h-2 rounded-full bg-gray-300 hover:bg-gray-400"
                              />
                            )}
                            {currentGlobalIndex > 3 && <span className="text-white/60 text-xs">...</span>}
                            {[-2, -1, 0, 1, 2].map(offset => {
                              const idx = currentGlobalIndex + offset;
                              if (idx < 0 || idx >= allImages.length) return null;
                              return (
                                <button 
                                  key={idx} 
                                  onClick={() => {
                                    const img = allImages[idx];
                                    handleSelectTaskImage(img.taskId, img.imageIndex);
                                  }} 
                                  className={`w-2 h-2 rounded-full transition-colors ${offset === 0 ? 'bg-[rgb(139,158,232)]' : 'bg-gray-300 hover:bg-gray-400'}`} 
                                />
                              );
                            })}
                            {currentGlobalIndex < allImages.length - 4 && <span className="text-white/60 text-xs">...</span>}
                            {currentGlobalIndex < allImages.length - 3 && (
                              <button 
                                onClick={() => {
                                  const img = allImages[allImages.length - 1];
                                  handleSelectTaskImage(img.taskId, img.imageIndex);
                                }}
                                className="w-2 h-2 rounded-full bg-gray-300 hover:bg-gray-400"
                              />
                            )}
                          </>
                        )}
                      </div>
                      <button 
                        onClick={handleGlobalNext}
                        disabled={currentGlobalIndex >= allImages.length - 1}
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${currentGlobalIndex < allImages.length - 1 ? 'bg-white/30 hover:bg-white/50 text-white' : 'bg-white/10 text-white/30 cursor-not-allowed'}`}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  )}
                  {/* 图片计数 - 显示全局位置 */}
                  <div className="absolute top-3 left-3 bg-black/50 text-white text-xs px-2 py-1 rounded z-10">
                    {currentGlobalIndex + 1} / {allImages.length}
                  </div>
                  {/* 右上角删除按钮 */}
                  <button
                    onClick={() => selectedTaskId && handleDeleteImage(selectedTaskId, selectedImageIndex)}
                    className="absolute top-3 right-3 w-8 h-8 bg-gray-500/80 hover:bg-gray-600 text-white rounded-full flex items-center justify-center transition-colors z-10"
                    title="删除图片"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
                  );
                })()
              ) : generatingTasks.length > 0 ? (
                <div className="absolute inset-0">
                  <RoseCurveAnimation color={roseColor} showDetail />
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 dark:text-gray-600">
                  <svg className="w-16 h-16 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  <span className="text-sm">输入描述开始创作</span>
                </div>
              )}
            </div>

            {/* 右侧信息面板 - 任务提交时就显示 */}
            {selectedTask && (
              <div className="w-56 border-l border-gray-200 dark:border-gray-800 p-3 bg-gray-50 dark:bg-gray-800 overflow-y-auto flex-shrink-0">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">生成信息</h3>
                
                <div className="mb-3">
                  <Label className="text-xs text-gray-500 dark:text-gray-400">提交时间</Label>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                    {new Date(selectedTask.createdAt).toLocaleString('zh-CN', { 
                      month: '2-digit', 
                      day: '2-digit', 
                      hour: '2-digit', 
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </p>
                </div>

                <div className="mb-3">
                  <Label className="text-xs text-gray-500 dark:text-gray-400">模型</Label>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">{selectedTask.params.model}</p>
                </div>

                <div className="mb-3">
                  <Label className="text-xs text-gray-500 dark:text-gray-400">参考图</Label>
                  <div className="grid grid-cols-5 gap-1 mt-1">
                    {/* #253 修复：使用正确的字段名 reference_images（与数据库一致） */}
                    {selectedTask.params.reference_images?.slice(0, 10).map((img: string, idx: number) => (
                      <div key={idx} className="aspect-square rounded overflow-hidden bg-gray-100 dark:bg-gray-700 cursor-pointer border border-gray-200 dark:border-gray-600" onClick={() => setPreviewImage(img)}>
                        <img src={img} alt={`参考图${idx + 1}`} className="w-full h-full object-contain" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mb-3">
                  <Label className="text-xs text-gray-500 dark:text-gray-400">提示词</Label>
                  <p className="text-xs text-gray-700 dark:text-gray-300 mt-1 whitespace-pre-wrap break-words">{selectedTask.params.prompt}</p>
                </div>

                <div className="mb-3">
                  <Label className="text-xs text-gray-500 dark:text-gray-400">分辨率</Label>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">{selectedTask.params.resolution}</p>
                </div>

                <div className="mb-3">
                  <Label className="text-xs text-gray-500 dark:text-gray-400">宽高比</Label>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">{selectedTask.params.aspectRatio}</p>
                </div>

                <div className="mb-3">
                  <Label className="text-xs text-gray-500 dark:text-gray-400">生成数量</Label>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">
                    {selectedTask.expectedCount} 张
                  </p>
                </div>

                {/* 再次生成数量选择 */}
                <div className="mb-3">
                  <Label className="text-xs text-gray-500 dark:text-gray-400">再次生成数量</Label>
                  <div className="flex gap-1 mt-1">
                    {[1, 2, 3, 4].map(num => (
                      <button
                        key={num}
                        onClick={() => setRegenerateCount(num)}
                        className={`flex-1 h-7 rounded text-xs font-medium transition-colors ${
                          regenerateCount === num 
                            ? 'bg-[rgb(139,158,232)] text-white' 
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 再次生成按钮 */}
                {selectedTask.images.length > 0 && (
                  <Button
                    className="w-full h-9 text-sm bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] hover:from-[rgb(120,140,220)] hover:to-[rgb(212,160,170)] text-white"
                    onClick={() => handleRegenerate(selectedTask)}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    再次生成
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* 下方缩略图区域 */}
          <div className="h-28 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex-shrink-0 flex">
            {/* 缩略图列表 */}
            <div className="flex-1 flex items-center gap-2 h-full overflow-x-auto px-3 py-2">
              {tasks.length === 0 ? null : (
                // 扁平化显示所有图片，不按任务分组
                (() => {
                  // 只显示成功的图片，按时间倒序排列
                  const thumbnails: ThumbnailItem[] = [];
                  const sortedTasks = [...tasks].sort((a, b) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                  );

                  sortedTasks.forEach(task => {
                    // 遍历 itemStatuses，逐个索引处理，避免重复
                    task.itemStatuses.forEach((status, idx) => {
                      if (task.images[idx]) {
                        // 索引 idx 有图片：添加已完成图片
                        thumbnails.push({
                          taskId: task.id,
                          itemIndex: -1,
                          imageIndex: idx,
                          imageUrl: task.images[idx],
                          status: 'completed' as const,
                          isNew: !task.viewedImages.has(idx),
                          isSubmitted: false,
                        });
                      } else if (status === 'generating') {
                        // 索引 idx 没有图片，且状态是 generating：添加生成中状态
                        thumbnails.push({
                          taskId: task.id,
                          itemIndex: idx,
                          imageIndex: -1,
                          status: 'generating' as const,
                          isNew: false,
                          isSubmitted: submittedTaskIds.has(task.id),
                        });
                      } else if (status === 'failed') {
                        // 索引 idx 没有图片，且状态是 failed：添加失败状态
                        thumbnails.push({
                          taskId: task.id,
                          itemIndex: idx,
                          imageIndex: -1,
                          status: 'failed' as const,
                          error: task.itemErrors[idx] || undefined,
                          isNew: false,
                          isSubmitted: false,
                        });
                      }
                    });
                  });

                  // 计算当前选中图片在扁平化列表中的索引
                  const selectedFlatIndex = allImages.findIndex(
                    img => img.taskId === selectedTaskId && img.imageIndex === selectedImageIndex
                  );

                  return thumbnails.map((item, idx) => {
                    // 判断是否选中：只对已完成的图片判断
                    const isThisSelected = item.status === 'completed' &&
                      item.taskId === selectedTaskId &&
                      item.imageIndex === selectedImageIndex;

                    return (
                      <ThumbnailItem
                        key={`thumb-${item.taskId}-${item.imageIndex}-${item.status}-${idx}`}
                        item={item}
                        isSelected={isThisSelected}
                        roseSrc={item.status === 'generating' ? roseColor : undefined}
                        roseShowDetail
                        onSelect={() => {
                          if (item.status === 'completed' && item.imageIndex >= 0) {
                            setSelectedTaskId(item.taskId);
                            setSelectedImageIndex(item.imageIndex);
                            // 标记为已查看
                            setTasks(prev => prev.map(t => {
                              if (t.id === item.taskId) {
                                const newViewed = new Set(t.viewedImages);
                                newViewed.add(item.imageIndex);
                                return { ...t, viewedImages: newViewed };
                              }
                              return t;
                            }));
                          } else {
                            // 点击生成中或失败的项，选中对应的任务
                            setSelectedTaskId(item.taskId);
                          }
                        }}
                        onDelete={() => item.imageIndex >= 0 && handleDeleteImage(item.taskId, item.imageIndex)}
                        onDeleteFailed={() => item.itemIndex >= 0 && handleDeleteFailedItem(item.taskId, item.itemIndex)}
                        onImageError={() => {
                          if (item.imageUrl) {
                            const task = tasks.find(t => t.id === item.taskId);
                            handleImageError(item.imageUrl, task?.createdAt);
                          }
                        }}
                      />
                    );
                  });
                })()
              )}
            </div>
            
            {/* 下载全部按钮 */}
            <div className="flex items-center justify-center gap-1 px-3 border-l border-gray-200 dark:border-gray-700 flex-shrink-0">
              <button
                title="下载当前页面全部图片"
                onClick={async () => {
                  // 收集当前页面所有已完成的图片 URL
                  const completedUrls: string[] = [];
                  tasks.forEach(task => {
                    task.images.forEach((url, idx) => {
                      if (url && task.itemStatuses[idx] === 'completed') {
                        completedUrls.push(url);
                      }
                    });
                  });
                  
                  if (completedUrls.length === 0) {
                    toast.warning('没有可下载的图片');
                    return;
                  }
                  
                  toast.info(`开始下载 ${completedUrls.length} 张图片...`);
                  
                  // 逐个下载
                  let successCount = 0;
                  for (let i = 0; i < completedUrls.length; i++) {
                    try {
                      const response = await fetch(completedUrls[i]);
                      const blob = await response.blob();
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = `image_${i + 1}.png`;
                      link.click();
                      URL.revokeObjectURL(url);
                      successCount++;
                      // 延迟避免浏览器阻止
                      await new Promise(r => setTimeout(r, 300));
                    } catch (e) {
                      console.error('下载失败:', completedUrls[i], e);
                    }
                  }
                  
                  toast.success(`已下载 ${successCount}/${completedUrls.length} 张图片`);
                }}
                className="flex flex-col items-center justify-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <Download className="w-4 h-4" />
                <span className="text-xs whitespace-nowrap">下载全部</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 参考图预览弹窗 */}
      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img src={previewImage} alt="预览图片" className="max-w-full max-h-[90vh] object-contain" />
            <button onClick={() => setPreviewImage(null)} className="absolute -top-2 -right-2 w-8 h-8 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center shadow-lg hover:bg-gray-100 dark:hover:bg-gray-700">
              <X className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            </button>
          </div>
        </div>
      )}

      {/* 历史提示词弹窗 */}
      <HistoryPromptsDialog
        open={historyPromptsOpen}
        onOpenChange={setHistoryPromptsOpen}
        onSelectPrompt={(selectedPrompt, selectedRefImages) => {
          setPrompt(selectedPrompt);
          if (selectedRefImages && selectedRefImages.length > 0) {
            // 历史记录中的参考图是 COS URL，需要下载后转为 base64
            // 由于 URL 可能已过期，这里直接设置 URL，发送请求时终端会尝试访问
            setReferenceImageUrls(selectedRefImages);
            setReferenceImages([]); // 清空 base64，使用 URL 模式
            setReferenceImageKeys([]); // 清空 COS key，历史记录参考图使用 URL 模式
            setReferenceImageMd5s([]); // #241 清空 MD5（历史记录中没有 MD5 信息）
            // #241 关键：同步更新 Ref
            referenceImageUrlsRef.current = [...selectedRefImages];
            referenceImageKeysRef.current = [];
            referenceImageMd5sRef.current = [];
            console.log('从历史记录选择参考图 #241:', selectedRefImages.length, '张');
          } else {
            // #241 没有 referenceImages 时也要清空 Ref
            setReferenceImageUrls([]);
            setReferenceImages([]);
            setReferenceImageKeys([]);
            setReferenceImageMd5s([]);
            referenceImageUrlsRef.current = [];
            referenceImageKeysRef.current = [];
            referenceImageMd5sRef.current = [];
          }
        }}
      />

      {/* 收藏提示词弹窗 - 与画布页面样式一致 */}
      {showFavoritesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowFavoritesModal(false)}>
          <div 
            className="bg-white rounded-xl shadow-lg w-[95vw] max-w-6xl max-h-[85vh] overflow-hidden" 
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">提示词收藏</h3>
              <button 
                className="px-5 py-2.5 bg-black text-white text-sm font-medium rounded-lg flex items-center gap-2 hover:bg-gray-800 transition-colors" 
                onClick={() => {
                  if (newFavoriteContent.trim()) {
                    handleAddFavorite();
                  }
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                添加收藏
              </button>
            </div>
            
            {/* 添加新收藏区域 */}
            <div className="px-8 py-5 border-b border-gray-100 bg-gray-50">
              <textarea
                value={newFavoriteContent}
                onChange={(e) => setNewFavoriteContent(e.target.value)}
                placeholder="输入想要收藏的提示词..."
                className="w-full px-5 py-4 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200"
                rows={4}
              />
            </div>
            
            {/* 收藏列表 */}
            <div className="overflow-y-auto max-h-[55vh]">
              {favorites.length === 0 ? (
                <div className="py-20 text-center">
                  <p className="text-gray-400 text-sm">暂无收藏的提示词</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {favorites.map((item) => (
                    <div key={item.id} className="flex items-center gap-6 px-8 py-4 hover:bg-gray-50 transition-colors group">
                      {editingFavoriteId === item.id ? (
                        // 编辑模式
                        <>
                          <div className="flex-1">
                            <textarea
                              value={editingFavoriteContent}
                              onChange={(e) => setEditingFavoriteContent(e.target.value)}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:border-gray-400"
                              rows={3}
                            />
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => handleUpdateFavorite(item.id, editingFavoriteContent)}
                              className="px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => { setEditingFavoriteId(null); setEditingFavoriteContent(''); }}
                              className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
                            >
                              取消
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div 
                            className="flex-1 text-sm text-gray-700 cursor-pointer hover:text-blue-500"
                            onClick={() => {
                              setPrompt(item.content);
                              setShowFavoritesModal(false);
                            }}
                          >
                            {item.content}
                          </div>
                          <div className="flex items-center justify-end gap-2 flex-shrink-0">
                            <button
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(item.content);
                                } catch (error) {
                                  console.error('复制失败:', error);
                                }
                              }}
                              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
                            >
                              复制
                            </button>
                            <button
                              onClick={() => {
                                setPrompt(item.content);
                                setShowFavoritesModal(false);
                              }}
                              className="px-3 py-1.5 text-xs bg-black text-white rounded hover:bg-gray-800 transition-colors"
                            >
                              使用
                            </button>
                            <button
                              onClick={() => { setEditingFavoriteId(item.id); setEditingFavoriteContent(item.content); }}
                              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => handleDeleteFavorite(item.id)}
                              className="px-3 py-1.5 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            >
                              删除
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 历史记录弹窗 */}
      <HistoryRecordsDialog
        open={historyRecordsOpen}
        onOpenChange={setHistoryRecordsOpen}
        source="generate"
      />

      {/* 模型选择弹窗 - 出现在按钮下方 */}
      {showModelPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowModelPicker(false)} />
          <div className="fixed top-[95px] left-[96px] z-50">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[360px] max-h-[60vh] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">模型偏好</h3>
                <button 
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" 
                  onClick={() => setShowModelPicker(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="p-2 space-y-1 overflow-y-auto max-h-[50vh]">
                {modelOptions.map((modelId) => {
                  const config = dynamicModelConfig[modelId];
                  const isSelected = model === modelId;
                  const isActive = modelActiveStatus[modelId] !== false; // 默认在线
                  // 🔧 #264 根据模型获取对应的 logo
                  const modelLogo = modelId === 'gpt-image-2' ? '/gpt-image-2-logo.png' : '/model-logo.png';
                  
                  // 只有当 config 存在时才渲染，否则显示 loading
                  if (!config) {
                    return (
                      <div 
                        key={modelId}
                        className="flex items-center gap-3 p-3 rounded-lg cursor-not-allowed opacity-50"
                      >
                        <img src={modelLogo} alt="" className="w-8 h-8 rounded-lg" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{modelDisplayNames[modelId] || formatModelName(modelId)}</span>
                          </div>
                          <div className="text-xs text-gray-400">加载中...</div>
                        </div>
                      </div>
                    );
                  }
                  
                  // 离线模型
                  if (!isActive) {
                    return (
                      <div 
                        key={modelId}
                        className="flex items-center gap-3 p-3 rounded-lg cursor-not-allowed opacity-60"
                      >
                        <img src={modelLogo} alt="" className="w-8 h-8 rounded-lg grayscale" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-400 dark:text-gray-500">{modelDisplayNames[modelId] || formatModelName(modelId)}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">离线</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {config.resolutions.map((r: any) => r.size).join(' / ')}
                            </span>
                            <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {config.resolutions[0]?.credits || 10} 积分起
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  
                  return (
                    <div 
                      key={modelId}
                      onClick={() => {
                        setModel(modelId);
                        setShowModelPicker(false);
                      }}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                        isSelected ? 'bg-gray-100 dark:bg-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      }`}
                    >
                      <img src={modelLogo} alt="" className="w-8 h-8 rounded-lg" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{modelDisplayNames[modelId] || formatModelName(modelId)}</span>
                          {/* 在线=绿色实心圆，离线=红色空心圆 */}
                          <span className={isActive ? 'text-green-500 text-xs' : 'text-red-500 text-xs'}>
                            {isActive ? '●' : '○'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {config.resolutions.map((r: any) => r.size).join(' / ')}
                          </span>
                          <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {config.resolutions[0]?.credits || 10} 积分起
                          </span>
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        isSelected ? 'border-gray-900 dark:border-gray-400 bg-gray-900 dark:bg-gray-400' : 'border-gray-300 dark:border-gray-600'
                      }`}>
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M3 6L5 8L9 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 分辨率选择弹窗 - 出现在按钮上方 */}
      {showResolutionPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowResolutionPicker(false)} />
          <div className="fixed bottom-[180px] left-[96px] z-50">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[280px]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">选择分辨率</h3>
                <button 
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" 
                  onClick={() => setShowResolutionPicker(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-2 space-y-1">
                {resolutionOptions.map((res) => (
                  <button
                    key={res.size}
                    onClick={() => {
                      setResolution(res.size);
                      setShowResolutionPicker(false);
                    }}
                    className={`w-full py-2 px-3 rounded-lg text-left transition-colors flex items-center justify-between ${
                      resolution === res.size 
                        ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    <div>
                      <div className="text-sm font-medium">{res.size}</div>
                    </div>
                    <div className={`text-xs ${resolution === res.size ? 'text-gray-300' : 'text-gray-500'}`}>
                      {res.credits} 积分
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 宽高比选择弹窗 - 出现在按钮上方 */}
      {showRatioPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowRatioPicker(false)} />
          <div className="fixed bottom-[180px] z-50" style={{ left: ratioButtonLeft }}>
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[320px]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">选择宽高比</h3>
                <button 
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" 
                  onClick={() => setShowRatioPicker(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-2 grid grid-cols-3 gap-2">
                {aspectRatioOptions.map((ratio) => (
                  <button
                    key={ratio}
                    onClick={() => {
                      setAspectRatio(ratio);
                      setShowRatioPicker(false);
                    }}
                    className={`py-2 px-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-1 ${
                      aspectRatio === ratio 
                        ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    <AspectRatioIcon ratio={ratio} selected={aspectRatio === ratio} />
                    <span>{ratio}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 数量选择弹窗 - 出现在按钮上方 */}
      {showCountPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowCountPicker(false)} />
          <div className="fixed bottom-[180px] z-50" style={{ left: countButtonLeft }}>
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[200px]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">选择数量</h3>
                <button 
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" 
                  onClick={() => setShowCountPicker(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-2 grid grid-cols-2 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                  <button
                    key={num}
                    onClick={() => {
                      setCount(num);
                      setShowCountPicker(false);
                    }}
                    className={`py-2 px-3 rounded-lg text-sm transition-colors ${
                      count === num 
                        ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 登录/注册模态框 */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authMode}
        onLoginSuccess={handleLoginSuccess}
      />
    </div>
  );
}
