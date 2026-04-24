'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useGenService, type GenServiceConfig, type GenResult, type ImageEvent, type PlaceholderInfo, type GenError } from '@/hooks/useGenService';
import { waitForPendingUploads } from '@/hooks/useOptimisticUpload';
import { fetchUserWithCache, updateCachedCredits, clearCachedUser } from '@/lib/user-cache';
import { clearAllReferenceImages, deleteReferenceImage } from '@/lib/dialog-data-db';
import { useHistoryStore, type HistoryRecord } from '@/store/historyStore';

// ========== 辅助函数 ==========

// 格式化模型名字：kebab-case -> Title-Case
export function formatModelName(name: string): string {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('-');
}

// ========== 类型定义 ==========

// 模型配置项
export interface ModelConfigItem {
  type: 'image' | 'video' | 'tool';
  resolutions?: { size: string; credits: number }[];
  aspectRatios?: string[];
  enabled?: boolean;
  supportsDuration?: boolean;
  credits?: number;  // 工具模型的积分成本
}

// 收藏项
export interface Favorite {
  id: number;
  content: string;
  sort_order: number;
}

// 消息项
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  timestamp: number;
  // 发送到对话的元素信息
  elementId?: string;
  elementType?: string;
  elementSrc?: string;
  // 生成状态
  isGenerating?: boolean;
  // 用户消息的参考图和规格信息
  referenceImages?: string[]; // 参考图 URL 列表（用于显示）
  referenceImageKeys?: string[]; // 🔧 #040 新增：参考图 COS key（用于持久化）
  // 助手消息的生成图
  imageUrlKey?: string; // 🔧 #041 新增：生成图 COS key（用于持久化）
  specs?: {
    model: string;
    ratio: string;
    resolution: string;
    count: number;
  };
}

// 生成配置选项
export interface GenerationOptions {
  // 生成模式
  mode?: 'image' | 'video';
  
  // 必填
  prompt: string;
  model: string;
  resolution: string;
  aspectRatio: string;
  generationCount: number;
  
  // 任务ID（#047 修复：前端预生成taskId，确保前后端ID一致）
  taskId?: string;
  
  // 可选
  images?: string[];
  isUrls?: boolean;
  md5Hashes?: string[];
  
  // 画布占位符回调（仅图片模式）
  // #093 修复：增加 taskId 参数
  onBeforeGenerate?: (count: number, prompt: string, taskId: string) => PlaceholderInfo[];
  onImageReceived?: (data: ImageEvent) => void;
  onPlaceholderFailed?: (elementId: string, error: string) => void;
  // 【干净替换法】收到 actualTaskId 后替换占位符的 generationTaskId
  // 注意：传入的第一个参数是 elementId（占位符元素ID）
  onActualTaskIdReceived?: (elementId: string, actualTaskId: string) => void;
  
  // 视频模式回调（仅视频模式）
  onVideoProgress?: (progress: { progress: number; status: string }) => void;
  onVideoReceived?: (data: { url: string; key?: string; thumbnailUrl?: string }) => void;
  
  // 通用回调
  onProgress?: (progress: { completed: number; total: number; waiting?: number }) => void;
  onComplete?: (result: GenResult) => void;
  onError?: (error: GenError) => void;
}

// Context 类型
export interface AIGeneratorContextType {
  // ========== 模型配置 ==========
  selectedModel: string;
  setSelectedModel: React.Dispatch<React.SetStateAction<string>>;
  showModelPicker: boolean;
  setShowModelPicker: React.Dispatch<React.SetStateAction<boolean>>;
  modelTab: 'image' | 'video';
  setModelTab: React.Dispatch<React.SetStateAction<'image' | 'video'>>;
  modelStatuses: Record<string, { status: boolean; error: string }>;
  setModelStatuses: React.Dispatch<React.SetStateAction<Record<string, { status: boolean; error: string }>>>;
  modelConfig: Record<string, ModelConfigItem>;
  setModelConfig: React.Dispatch<React.SetStateAction<Record<string, ModelConfigItem>>>;
  modelDisplayNames: Record<string, string>;
  setModelDisplayNames: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  modelActiveStatus: Record<string, boolean>;
  setModelActiveStatus: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  imageModelOptions: string[];
  setImageModelOptions: React.Dispatch<React.SetStateAction<string[]>>;
  videoModelOptions: string[];
  setVideoModelOptions: React.Dispatch<React.SetStateAction<string[]>>;
  presetColors: string[];
  setPresetColors: React.Dispatch<React.SetStateAction<string[]>>;

  // ========== 生成参数 ==========
  selectedRatio: string;
  setSelectedRatio: React.Dispatch<React.SetStateAction<string>>;
  selectedResolution: string;
  setSelectedResolution: React.Dispatch<React.SetStateAction<string>>;
  selectedAspectRatio: string;
  setSelectedAspectRatio: React.Dispatch<React.SetStateAction<string>>;
  selectedCount: number;
  setSelectedCount: React.Dispatch<React.SetStateAction<number>>;
  selectedDuration: number;
  setSelectedDuration: React.Dispatch<React.SetStateAction<number>>;
  showRatioPicker: boolean;
  setShowRatioPicker: React.Dispatch<React.SetStateAction<boolean>>;
  showResolutionPicker: boolean;
  setShowResolutionPicker: React.Dispatch<React.SetStateAction<boolean>>;
  showAspectRatioPicker: boolean;
  setShowAspectRatioPicker: React.Dispatch<React.SetStateAction<boolean>>;
  showCountPicker: boolean;
  setShowCountPicker: React.Dispatch<React.SetStateAction<boolean>>;
  showDurationPicker: boolean;
  setShowDurationPicker: React.Dispatch<React.SetStateAction<boolean>>;

  // ========== 参考图 ==========
  chatImageBase64s: string[];
  setChatImageBase64s: React.Dispatch<React.SetStateAction<string[]>>;
  chatImageUrls: string[];
  setChatImageUrls: React.Dispatch<React.SetStateAction<string[]>>;
  chatImageMd5s: string[];
  setChatImageMd5s: React.Dispatch<React.SetStateAction<string[]>>;
  chatImageKeys: string[];
  setChatImageKeys: React.Dispatch<React.SetStateAction<string[]>>;
  chatImageNames: string[];
  setChatImageNames: React.Dispatch<React.SetStateAction<string[]>>;
  chatUploadingMd5s: Set<string>;  // #048 新增：追踪正在上传的参考图
  setChatUploadingMd5s: React.Dispatch<React.SetStateAction<Set<string>>>;
  clearAllImages: () => void;

  // ========== 收藏夹 ==========
  showFavoritesModal: boolean;
  setShowFavoritesModal: React.Dispatch<React.SetStateAction<boolean>>;
  favorites: Favorite[];
  setFavorites: React.Dispatch<React.SetStateAction<Favorite[]>>;
  newFavoriteContent: string;
  setNewFavoriteContent: React.Dispatch<React.SetStateAction<string>>;
  editingId: number | null;
  setEditingId: React.Dispatch<React.SetStateAction<number | null>>;
  editingContent: string;
  setEditingContent: React.Dispatch<React.SetStateAction<string>>;

  // ========== 对话 ==========
  inputValue: string;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;

  // ========== 用户信息 ==========
  credits: number;
  setCredits: React.Dispatch<React.SetStateAction<number>>;
  userId: string | null;
  setUserId: React.Dispatch<React.SetStateAction<string | null>>;
  isLoggedIn: boolean;
  setIsLoggedIn: React.Dispatch<React.SetStateAction<boolean>>;
  authModalOpen: boolean;
  setAuthModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  authMode: 'login' | 'register';
  setAuthMode: React.Dispatch<React.SetStateAction<'login' | 'register'>>;
  refreshUserInfo: () => Promise<any>;

  // ========== 对话框状态 ==========
  showCopyToast: boolean;
  setShowCopyToast: React.Dispatch<React.SetStateAction<boolean>>;
  infoDialog: { open: boolean; title: string; description?: string };
  setInfoDialog: React.Dispatch<React.SetStateAction<{ open: boolean; title: string; description?: string }>>;
  previewImage: string | null;
  setPreviewImage: React.Dispatch<React.SetStateAction<string | null>>;

  // ========== 生成服务 ==========
  handleGenerate: (options: GenerationOptions) => Promise<{ taskId: string; success: boolean; message?: string }>;
  abortGenerate: () => void;
  isGenerating: boolean;
  
  // #237 统一保存方法：供外部组件调用（如再次生成功能）
  saveHistoryRecord: (params: {
    taskId: string;
    model: string;
    prompt: string;
    images: string[];
    imageKeys?: string[];
    referenceImages?: string[];
    referenceImageMd5s?: string[];  // #242 新增：参考图 MD5 数组
    resolution?: string;
    aspectRatio?: string;
    creditsCharged?: number;
    source?: 'canvas' | 'generate' | 'smart_split' | 'video' | 'regenerate';
  }) => Promise<boolean>;
}

// 默认模型选项
const defaultImageModelOptions = ['nano-banana-2', 'nano-banana-2-cl', 'nano-banana', 'nano-banana-fast', 'nano-banana-pro', 'nano-banana-pro-vt', 'nano-banana-pro-cl', 'nano-banana-2-4k-cl', 'nano-banana-pro-4k-vip'];
// #277 修复：默认视频模型改为 grs-sora-2（与数据库一致）
const defaultVideoModelOptions = ['grs-sora-2'];
const defaultPresetColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9', '#F8B500', '#2ECC71'];

// Context
const AIGeneratorContext = createContext<AIGeneratorContextType | null>(null);

export function AIGeneratorProvider({ children }: { children: React.ReactNode }) {
  // ========== 模型配置 ==========
  const [selectedModel, setSelectedModel] = useState('gpt-image-2');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelTab, setModelTab] = useState<'image' | 'video'>('image');
  const [modelStatuses, setModelStatuses] = useState<Record<string, { status: boolean; error: string }>>({});
  const [modelConfig, setModelConfig] = useState<Record<string, ModelConfigItem>>({});
  const [modelDisplayNames, setModelDisplayNames] = useState<Record<string, string>>({});
  const [modelActiveStatus, setModelActiveStatus] = useState<Record<string, boolean>>({});
  const [imageModelOptions, setImageModelOptions] = useState<string[]>(defaultImageModelOptions);
  const [videoModelOptions, setVideoModelOptions] = useState<string[]>(defaultVideoModelOptions);
  const [presetColors, setPresetColors] = useState<string[]>(defaultPresetColors);

  // ========== 生成参数 ==========
  const [selectedRatio, setSelectedRatio] = useState('auto');
  const [selectedResolution, setSelectedResolution] = useState('1K');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState('1:1');
  const [selectedCount, setSelectedCount] = useState(1);
  const [selectedDuration, setSelectedDuration] = useState(10);
  const [showRatioPicker, setShowRatioPicker] = useState(false);
  const [showResolutionPicker, setShowResolutionPicker] = useState(false);
  const [showAspectRatioPicker, setShowAspectRatioPicker] = useState(false);
  const [showCountPicker, setShowCountPicker] = useState(false);
  const [showDurationPicker, setShowDurationPicker] = useState(false);

  // ========== 参考图 ==========
  const [chatImageBase64s, setChatImageBase64s] = useState<string[]>([]);
  const [chatImageUrls, setChatImageUrls] = useState<string[]>([]);
  const [chatImageMd5s, setChatImageMd5s] = useState<string[]>([]);
  const [chatImageKeys, setChatImageKeys] = useState<string[]>([]);
  const [chatImageNames, setChatImageNames] = useState<string[]>([]);
  // #048 新增：追踪画布对话框中正在上传的参考图 MD5
  const [chatUploadingMd5s, setChatUploadingMd5s] = useState<Set<string>>(new Set());

  // ========== 收藏夹 ==========
  const [showFavoritesModal, setShowFavoritesModal] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [newFavoriteContent, setNewFavoriteContent] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');

  // ========== 对话 ==========
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);

  // ========== 用户信息 ==========
  const [credits, setCredits] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  // #232 修复：使用 ref 解决闭包陷阱
  const userIdRef = useRef<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  
  // ========== 用户信息刷新函数 ==========
  const refreshUserInfo = useCallback(async () => {
    try {
      // 🔒 军规：fetchUserWithCache 内部已处理首次刷新逻辑
      const userInfo = await fetchUserWithCache();
      if (userInfo) {
        setCredits(userInfo.credits || 0);
        setUserId(userInfo.id || null);
        userIdRef.current = userInfo.id || null;  // #232 修复：同步更新 ref
        setIsLoggedIn(true);
        console.log('[AIGeneratorContext] 用户信息刷新成功, userId:', userInfo.id);
        return userInfo;
      } else {
        setCredits(0);
        setUserId(null);
        userIdRef.current = null;  // #232 修复：同步更新 ref
        setIsLoggedIn(false);
        console.log('[AIGeneratorContext] 用户信息刷新失败, userId 为 null');
        return null;
      }
    } catch (error) {
      console.error('刷新用户信息失败:', error);
      return null;
    }
  }, [setCredits, setUserId, setIsLoggedIn]);
  
  // ========== 初始化和事件监听 ==========
  // 初始化时获取用户信息
  // 🔒 军规：首次调用自动清除缓存并刷新，后续走缓存
  useEffect(() => {
    refreshUserInfo();
  }, [refreshUserInfo]);
  
  // #270 监听全局积分变化事件（本地热更新，减少 API 请求）
  useEffect(() => {
    const handleCreditsChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ userId?: string; newCredits?: number; source?: string }>;
      const { userId, newCredits, source } = customEvent.detail || {};
      
      console.log('[AIGeneratorContext] 收到积分变化事件:', { userId, newCredits, source });
      
      // 检查是否是当前用户的积分变化
      if (userId && newCredits !== undefined && userId === userIdRef.current) {
        // 本地热更新（事件来自同一用户的其他页面）
        console.log(`[AIGeneratorContext] #270 本地热更新积分: ${credits} → ${newCredits}`);
        setCredits(newCredits);
        updateCachedCredits(newCredits);
      } else if (source === 'admin' && userId === userIdRef.current) {
        // 管理后台调整当前用户积分，强制刷新确保数据准确
        console.log('[AIGeneratorContext] 管理后台调整积分，强制刷新');
        clearCachedUser();
        refreshUserInfo();
      }
      // 其他用户的积分变化，忽略（管理后台会单独处理）
    };
    
    window.addEventListener('creditsChanged', handleCreditsChanged as EventListener);
    return () => window.removeEventListener('creditsChanged', handleCreditsChanged as EventListener);
  }, [refreshUserInfo, credits]);

  // 🔧 监听登录成功事件
  useEffect(() => {
    const handleLoginSuccess = () => {
      console.log('[AIGeneratorContext] 收到登录成功事件，清除缓存并刷新');
      clearCachedUser();
      setIsLoggedIn(true);
      refreshUserInfo();
    };
    
    window.addEventListener('user-login-success', handleLoginSuccess);
    return () => window.removeEventListener('user-login-success', handleLoginSuccess);
  }, [refreshUserInfo]);

  // ========== 加载模型配置 ==========
  useEffect(() => {
    const fetchModelConfig = async () => {
      try {
        // 获取图片生成模型
        const imageRes = await fetch('/api/config?service_type=image_generation');
        const imageData = await imageRes.json();
        if (imageData.success && imageData.data?.models) {
          const models = imageData.data.models;
          const allModelIds = models.map((m: { model_id: string }) => m.model_id);
          if (allModelIds.length > 0) {
            setImageModelOptions(allModelIds);
          }
          
          // 保存模型在线/离线状态
          const activeStatusMap: Record<string, boolean> = {};
          const newDisplayNames: Record<string, string> = {};
          const newConfig: Record<string, ModelConfigItem> = {};
          
          models.forEach((m: { model_id: string; model_name: string; is_active: boolean; parameters: any; credits_base?: number }) => {
            activeStatusMap[m.model_id] = m.is_active !== false;
            newDisplayNames[m.model_id] = m.model_name;
            
            const dbResolutions = m.parameters?.resolutions || [];
            const dbAspectRatios = (m.parameters?.aspectRatios || []).map((r: any) => r.value || r.label);
            
            newConfig[m.model_id] = {
              type: 'image',
              resolutions: dbResolutions.map((r: any) => ({
                size: r.label || r.value,
                credits: r.credits || m.credits_base || 10,
              })),
              aspectRatios: dbAspectRatios,
            };
          });
          
          setModelActiveStatus(activeStatusMap);
          setModelDisplayNames(newDisplayNames);
          setModelConfig(prev => ({ ...prev, ...newConfig }));
          console.log('[AIGeneratorContext] 加载图片模型配置:', Object.keys(newConfig).length, '个');
        }
      } catch (error) {
        console.error('[AIGeneratorContext] 加载图片模型配置失败:', error);
      }
      
      try {
        // 获取视频生成模型
        const videoRes = await fetch('/api/config?service_type=video_generation');
        const videoData = await videoRes.json();
        if (videoData.success && videoData.data?.models) {
          const models = videoData.data.models;
          const allModelIds = models.map((m: { model_id: string }) => m.model_id);
          if (allModelIds.length > 0) {
            setVideoModelOptions(allModelIds);
          }
          
          const activeStatusMap: Record<string, boolean> = {};
          const newDisplayNames: Record<string, string> = {};
          
          models.forEach((m: { model_id: string; model_name: string; is_active: boolean }) => {
            activeStatusMap[m.model_id] = m.is_active !== false;
            newDisplayNames[m.model_id] = m.model_name;
          });
          
          setModelActiveStatus(prev => ({ ...prev, ...activeStatusMap }));
          setModelDisplayNames(prev => ({ ...prev, ...newDisplayNames }));
          
          // 构建视频模型配置
          setModelConfig(prev => {
            const newConfig = { ...prev };
            models.forEach((m: { model_id: string; parameters: any }) => {
              if (m.parameters) {
                const dbAspectRatios = (m.parameters.aspectRatios || []).map((r: any) => r.value || r.label);
                const dbResolutions = (m.parameters.resolutions || []).map((r: any) => ({
                  size: r.label || r.value,
                  credits: r.credits || 10,
                }));
                
                if (newConfig[m.model_id]) {
                  newConfig[m.model_id] = {
                    ...newConfig[m.model_id],
                    resolutions: dbResolutions.length > 0 ? dbResolutions : newConfig[m.model_id].resolutions,
                    aspectRatios: dbAspectRatios.length > 0 ? dbAspectRatios : newConfig[m.model_id].aspectRatios,
                    supportsDuration: m.parameters.durations ? true : newConfig[m.model_id].supportsDuration,
                  };
                } else {
                  const defaultAspectRatios = ['auto', '1:1', '3:2', '4:3', '5:4', '16:9', '21:9', '3:4', '4:5', '9:16', '1:2', '2:3', '1:4', '4:1', '1:8', '8:1'];
                  newConfig[m.model_id] = {
                    type: 'video',
                    resolutions: dbResolutions.length > 0 ? dbResolutions : [{ size: '720P', credits: 50 }],
                    aspectRatios: dbAspectRatios.length > 0 ? dbAspectRatios : defaultAspectRatios,
                    supportsDuration: !!m.parameters.durations,
                  };
                }
              }
            });
            return newConfig;
          });
          console.log('[AIGeneratorContext] 加载视频模型配置');
        }
      } catch (error) {
        console.error('[AIGeneratorContext] 加载视频模型配置失败:', error);
      }
    };
    
    fetchModelConfig();
  }, [setImageModelOptions, setVideoModelOptions, setModelActiveStatus, setModelDisplayNames, setModelConfig]);

  // ========== 对话框状态 ==========
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [infoDialog, setInfoDialog] = useState<{ open: boolean; title: string; description?: string }>({
    open: false,
    title: '',
    description: undefined,
  });
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // ========== 生成状态 ==========
  const [isGenerating, setIsGenerating] = useState(false);

  // 清除所有参考图（同时清除数据库）
  const clearAllImages = useCallback(async () => {
    setChatImageBase64s([]);
    setChatImageUrls([]);
    setChatImageMd5s([]);
    setChatImageKeys([]);
    setChatImageNames([]);
    // 清除 IndexedDB 中的参考图
    try {
      await clearAllReferenceImages();
      console.log('[AIGeneratorContext] 已清除所有参考图（含数据库）');
    } catch (error) {
      console.error('[AIGeneratorContext] 清除数据库参考图失败:', error);
    }
  }, []);

  // ========== 使用生成服务 ==========
  const genService = useGenService();

  // 全局生成方法
  const handleGenerate = useCallback(async (options: GenerationOptions) => {
    setIsGenerating(true);
    
    try {
      // 🔧 #215 提交层拦截池：等待后台参考图上传完成
      // 用户随时可以点发送，系统自己在后台排队等 Key
      await waitForPendingUploads();
      
      const result = await genService.generate({
        prompt: options.prompt,
        model: options.model,
        resolution: options.resolution,
        aspectRatio: options.aspectRatio,
        generationCount: options.generationCount,
        taskId: options.taskId,  // #047 修复：透传前端预生成的taskId
        images: options.images,
        isUrls: options.isUrls,
        md5Hashes: options.md5Hashes,
        userId: userId ?? undefined,
        
        // 画布占位符回调
        onBeforeGenerate: options.onBeforeGenerate,
        onImageReceived: options.onImageReceived,
        onPlaceholderFailed: options.onPlaceholderFailed,
        
        // #270 新增：任务开始时扣费后立即更新积分（让用户立即看到变化）
        onCreditsDeducted: (data) => {
          console.log(`[AIGeneratorContext] #270 收到扣费回调: 扣除 ${data.creditsCharged}, 余额 ${data.creditsBalance}`);
          setCredits(data.creditsBalance);
          updateCachedCredits(data.creditsBalance);
          // 触发事件通知 Navbar 等其他组件（携带 userId）
          window.dispatchEvent(new CustomEvent('creditsChanged', {
            detail: {
              userId: userIdRef.current,
              newCredits: data.creditsBalance,
            }
          }));
        },
        
        // 进度回调
        onProgress: options.onProgress,
        
        // 完成回调
        onComplete: (genResult) => {
          // 🔒 军规日志：关键生命周期必须输出诊断日志
          console.log('[AIGeneratorContext] onComplete 收到:', {
            creditsBalance: genResult.creditsBalance,
            creditsCharged: genResult.creditsCharged,
            imageCount: genResult.imageUrls?.length,
          });
          
          // 更新积分（状态 + 缓存）
          if (genResult.creditsBalance !== undefined && genResult.creditsBalance !== null) {
            console.log(`[AIGeneratorContext] 积分更新: ${credits} → ${genResult.creditsBalance}`);
            setCredits(genResult.creditsBalance);
            // 🔥 同步更新缓存，避免刷新后回退
            updateCachedCredits(genResult.creditsBalance);
            // #270 触发事件通知其他组件（携带 userId + newCredits，实现本地热更新）
            window.dispatchEvent(new CustomEvent('creditsChanged', {
              detail: {
                userId: userIdRef.current,
                newCredits: genResult.creditsBalance,
              }
            }));
          } else {
            // ⚠️ 如果 SSE 没返回余额，查询最新余额
            console.warn('[AIGeneratorContext] SSE 未返回余额，触发查询');
            clearCachedUser();
            refreshUserInfo();
          }
          
          // #232 统一 API 枢纽：唯一的历史记录保存入口
          // 只有在任务有 taskId 时才保存（确保主键存在）
          if (genResult.taskId && genResult.imageUrls && genResult.imageUrls.length > 0) {
            // 🔒 强制校验：确保 id 是 string 类型的 taskId
            const taskId = String(genResult.taskId);
            
            // 构建标准记录对象
            const record: HistoryRecord = {
              id: taskId,  // 强制使用 string 类型的 taskId
              model: genResult.model || options.model || '',
              prompt: genResult.prompt || options.prompt || '',
              images: genResult.imageUrls,
              image_keys: genResult.imageKeys,
              reference_images: options.images?.filter((_, i) => !options.isUrls || i < (options.images?.length || 0)) || [],
              resolution: genResult.resolution || options.resolution || '',
              aspect_ratio: genResult.aspectRatio || options.aspectRatio || '',
              created_at: new Date().toISOString(),
              credits_charged: genResult.creditsCharged,
              source: genResult.source || 'generate',
            };
            
            console.log(`[AIGeneratorContext] #232 API 枢纽保存: taskId=${taskId}, source=${record.source}, images=${genResult.imageUrls.length}, userIdRef=${userIdRef.current}`);
            
            // #232 修复：使用 ref 解决闭包陷阱
            const currentUserId = userIdRef.current;
            
            if (!currentUserId) {
              console.error('[AIGeneratorContext] #232 userId 为空，无法保存到数据库');
              return;
            }
            
            // 异步调用 API 保存到数据库（不阻塞主流程）
            (async () => {
              try {
                const response = await fetch('/api/generation-records', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({
                    task_id: taskId,
                    model: record.model,
                    prompt: record.prompt,
                    images: record.images,
                    image_keys: record.image_keys,
                    reference_images: record.reference_images,
                    resolution: record.resolution,
                    aspect_ratio: record.aspect_ratio,
                    credits_charged: record.credits_charged,
                    source: record.source,
                    user_id: currentUserId,  // #232 修复：使用 ref 的值
                  }),
                });
                
                const result = await response.json();
                
                if (result.success) {
                  // ✅ API 保存成功后，更新内存状态
                  useHistoryStore.getState().addRecord(record);
                  console.log(`[AIGeneratorContext] #232 保存成功: taskId=${taskId}`);
                } else {
                  console.error(`[AIGeneratorContext] #232 API 返回失败:`, result.error, result.detail, result);
                }
              } catch (error) {
                // ❌ API 调用失败，打印错误但不阻塞流程
                console.error('[AIGeneratorContext] #232 API 保存异常:', error);
              }
            })();
          }
          
          options.onComplete?.(genResult);
        },
        
        // 错误回调
        onError: options.onError,
      });
      
      return result;
    } finally {
      setIsGenerating(false);
    }
  }, [genService, userId, setCredits]);

  // 中断生成
  const abortGenerate = useCallback(() => {
    genService.abortRequest();
  }, [genService]);

  // #237 统一保存方法：供外部组件调用（如再次生成功能）
  const saveHistoryRecord = useCallback(async (params: {
    taskId: string;
    model: string;
    prompt: string;
    images: string[];
    imageKeys?: string[];
    referenceImages?: string[];
    referenceImageMd5s?: string[];  // #242 新增：参考图 MD5 数组
    resolution?: string;
    aspectRatio?: string;
    creditsCharged?: number;
    source?: 'canvas' | 'generate' | 'smart_split' | 'video' | 'regenerate';
  }) => {
    const { taskId, model, prompt, images, imageKeys, referenceImages, referenceImageMd5s, resolution, aspectRatio, creditsCharged, source } = params;
    
    // #237 调试日志：打印完整参数
    console.log('[saveHistoryRecord] 保存参数:', { taskId, model, prompt: prompt?.substring(0, 30), images: images?.length, referenceImageMd5s: referenceImageMd5s?.length, creditsCharged, source });

    // 🔒 强制校验 + 过滤空字符串
    const filteredImages = images?.filter(url => url && url.length > 0) || [];

    // #254 调试日志：打印过滤前后的图片数量
    console.log('[saveHistoryRecord] #254 图片过滤:', {
      原始数量: images?.length || 0,
      过滤后数量: filteredImages.length,
      原始数组: images?.slice(0, 2).map(u => u?.substring?.(0, 50) + '...'),
    });

    if (filteredImages.length === 0) {
      console.warn('[AIGeneratorContext] #237/#245 无有效图片，跳过保存');
      return false;
    }
    
    // #245 过滤空字符串，确保存入数据库的是干净数据
    const filteredImageKeys = imageKeys?.filter(key => key && key.length > 0) || [];
    const filteredReferenceImages = referenceImages?.filter(url => url && url.length > 0) || [];
    const filteredReferenceImageMd5s = referenceImageMd5s?.filter(md5 => md5 && md5.length > 0) || [];
    
    const currentUserId = userIdRef.current;
    if (!currentUserId) {
      console.error('[AIGeneratorContext] #237 userId 为空，无法保存到数据库');
      return false;
    }
    
    // 构建标准记录对象
    const record: HistoryRecord = {
      id: String(taskId),
      model: model || '',
      prompt: prompt || '',
      images: filteredImages,  // #245 使用过滤后的数组
      image_keys: filteredImageKeys,
      reference_images: filteredReferenceImages,
      reference_image_md5s: filteredReferenceImageMd5s,  // #242 新增：保存参考图 MD5
      resolution: resolution || '',
      aspect_ratio: aspectRatio || '',
      created_at: new Date().toISOString(),
      credits_charged: creditsCharged,
      source: source || 'generate',
    };
    
    console.log(`[AIGeneratorContext] #237 统一保存: taskId=${taskId}, source=${source}, images=${filteredImages.length}`);
    
    // #237 修复：乐观更新先行（让用户立刻看到图）
    useHistoryStore.getState().addRecord(record);
    console.log(`[AIGeneratorContext] #237 前端 UI 已更新: taskId=${taskId}`);
    
    // #237 修复：异步落库（失败不影响用户当下体验）
    try {
      const response = await fetch('/api/generation-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          task_id: taskId,
          model: record.model,
          prompt: record.prompt,
          images: record.images,
          image_keys: record.image_keys,
          reference_images: record.reference_images,
          reference_image_md5s: record.reference_image_md5s,  // #242 新增
          resolution: record.resolution,
          aspect_ratio: record.aspect_ratio,
          credits_charged: record.credits_charged,
          source: record.source,
          user_id: currentUserId,
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        console.log(`[AIGeneratorContext] #237 API 落库成功: taskId=${taskId}`);
      } else {
        console.warn(`[AIGeneratorContext] #237 API 落库失败（前端已更新）:`, result.error);
      }
      return true; // 前端已更新，返回 true
    } catch (error) {
      console.warn('[AIGeneratorContext] #237 API 异常（前端已更新）:', error);
      return true; // 前端已更新，返回 true
    }
  }, []);

  const value = useMemo<AIGeneratorContextType>(() => ({
    // 模型配置
    selectedModel, setSelectedModel,
    showModelPicker, setShowModelPicker,
    modelTab, setModelTab,
    modelStatuses, setModelStatuses,
    modelConfig, setModelConfig,
    modelDisplayNames, setModelDisplayNames,
    modelActiveStatus, setModelActiveStatus,
    imageModelOptions, setImageModelOptions,
    videoModelOptions, setVideoModelOptions,
    presetColors, setPresetColors,

    // 生成参数
    selectedRatio, setSelectedRatio,
    selectedResolution, setSelectedResolution,
    selectedAspectRatio, setSelectedAspectRatio,
    selectedCount, setSelectedCount,
    selectedDuration, setSelectedDuration,
    showRatioPicker, setShowRatioPicker,
    showResolutionPicker, setShowResolutionPicker,
    showAspectRatioPicker, setShowAspectRatioPicker,
    showCountPicker, setShowCountPicker,
    showDurationPicker, setShowDurationPicker,

    // 参考图
    chatImageBase64s, setChatImageBase64s,
    chatImageUrls, setChatImageUrls,
    chatImageMd5s, setChatImageMd5s,
    chatImageKeys, setChatImageKeys,
    chatImageNames, setChatImageNames,
    chatUploadingMd5s, setChatUploadingMd5s,  // #048 新增
    clearAllImages,

    // 收藏夹
    showFavoritesModal, setShowFavoritesModal,
    favorites, setFavorites,
    newFavoriteContent, setNewFavoriteContent,
    editingId, setEditingId,
    editingContent, setEditingContent,

    // 对话
    inputValue, setInputValue,
    messages, setMessages,

    // 用户信息
    credits, setCredits,
    userId, setUserId,
    isLoggedIn, setIsLoggedIn,
    authModalOpen, setAuthModalOpen,
    authMode, setAuthMode,
    refreshUserInfo,

    // 对话框
    showCopyToast, setShowCopyToast,
    infoDialog, setInfoDialog,
    previewImage, setPreviewImage,

    // 生成服务
    handleGenerate,
    abortGenerate,
    isGenerating,
    
    // #237 统一保存方法
    saveHistoryRecord,
  }), [
    selectedModel, showModelPicker, modelTab, modelStatuses, modelConfig,
    modelDisplayNames, modelActiveStatus, imageModelOptions, videoModelOptions, presetColors,
    selectedRatio, selectedResolution, selectedAspectRatio, selectedCount, selectedDuration,
    showRatioPicker, showResolutionPicker, showAspectRatioPicker, showCountPicker, showDurationPicker,
    chatImageBase64s, chatImageUrls, chatImageMd5s, chatImageKeys, chatImageNames,
    showFavoritesModal, favorites, newFavoriteContent, editingId, editingContent,
    inputValue, messages,
    credits, userId, isLoggedIn, authModalOpen, authMode, refreshUserInfo,
    showCopyToast, infoDialog, previewImage,
    clearAllImages, handleGenerate, abortGenerate, isGenerating, saveHistoryRecord,
  ]);

  return (
    <AIGeneratorContext.Provider value={value}>
      {children}
    </AIGeneratorContext.Provider>
  );
}

export function useAIGenerator() {
  const context = useContext(AIGeneratorContext);
  if (!context) {
    throw new Error('useAIGenerator must be used within an AIGeneratorProvider');
  }
  return context;
}
