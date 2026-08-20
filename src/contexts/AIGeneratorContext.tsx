'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useGenService, type GenServiceConfig, type GenResult, type ImageEvent, type VideoEvent, type PlaceholderInfo, type GenError } from '@/hooks/useGenService';
import { waitForPendingUploads } from '@/hooks/useOptimisticUpload';
import { fetchUserWithCache, updateCachedCredits, clearCachedUser } from '@/lib/user-cache';
import { fetchConfig } from '@/lib/config-fetch';
import { clearAllReferenceImages, deleteReferenceImage } from '@/lib/dialog-data-db';
import { getModelSupportedTypes } from '@/lib/effective-sources';
import { ModelDetector, MODEL_MODE_CONSTRAINTS } from '@/lib/model-utils';
import { toast } from 'sonner';
import { clearSensitiveLocalStorage, setAuthSignal, removeAuthSignal, registerCrossTabAuthSync, getAuthSignalUserId } from '@/lib/local-storage-cleanup';
import { useHistoryStore, type HistoryRecord } from '@/store/historyStore';
import type { VideoModelMode } from '@/components/ModelModeSwitcher';

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
  configId?: number;  // #878 熔断精细化：关联 api_config.id，用于按模型维度隔离熔断
  durations?: number[];  // 视频模型时长选项（从数据库 {label,value} 解析为秒数数组）
  credits?: number;  // 工具模型的积分成本
  maxRefImages?: number;  // 视频模型最大参考图数量
  imageMode?: 'first_last_frame' | 'component_reference';  // 参考图模式
  supportsUpsample?: boolean;  // 是否支持1080P提升（Veo3.1-pro）
  showDuration?: boolean;  // 前端是否显示时长选择（Sora/Veo隐藏）
  showResolution?: boolean;  // 前端是否显示分辨率选择（Sora/Veo隐藏）
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
  // #655 视频占位符进度
  isVideoPlaceholder?: boolean; // 是否为视频占位符消息
  videoProgress?: number;       // 视频生成进度 0-95（假进度锁定95，真实完成后跳100）
  videoUrl?: string;            // 视频完成后的 URL
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
  referenceImageKeys?: string[];  // #840 参考图 COS key 数组（用于历史记录持久化）
  quality?: string;  // #523 T8Star 品质参数（low/medium/high/auto）
  
  // 视频参数（仅视频模式）
  duration?: number;  // 视频时长（秒）
  size?: string;      // 视频尺寸（small/large）
  enhancePrompt?: boolean;  // Veo: 是否增强提示词
  enableUpsample?: boolean; // Veo: 是否启用1080P提升
  
  // HappyHorse 视频参数（#633）
  firstFrameUrl?: string;          // 首帧图片URL（i2v模式）
  referenceImageUrls?: string[];   // 参考图片URL数组（r2v模式）
  inputVideoUrl?: string;          // 输入视频URL（video-edit模式）
  audioSetting?: 'auto' | 'origin'; // 音频设置（video-edit模式）
  hhMode?: VideoModelMode; // 视频子模式（HappyHorse + Seedance 2.0）
  
  // #642 Seedance 2.0 视频参数
  sd2Mode?: 't2v' | 'i2v-first-frame' | 'i2v-first-last-frame' | 'r2v'; // Seedance 2.0子模式
  lastFrameUrl?: string;              // 尾帧图片URL（i2v-first-last-frame模式）
  referenceVideoUrls?: string[];      // 参考视频URL数组（r2v模式）
  referenceAudioUrls?: string[];      // 参考音频URL数组（r2v模式）
  generateAudio?: boolean;            // 是否生成音频（Seedance 2.0）
  
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
  onVideoReceived?: (data: VideoEvent) => void;
  onStillProcessing?: (data: { taskId: string; message: string }) => void;
  
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
  llmModelOptions: string[];
  setLlmModelOptions: React.Dispatch<React.SetStateAction<string[]>>;
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
  selectedQuality: string;  // #523 T8Star 质量选项
  setSelectedQuality: React.Dispatch<React.SetStateAction<string>>;
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
  showQualityPicker: boolean;  // #523 T8Star 品质弹窗
  setShowQualityPicker: React.Dispatch<React.SetStateAction<boolean>>;

  // ========== #633 HappyHorse 模式切换 ==========
  hhOverrideMode: VideoModelMode | null;
  setHhOverrideMode: React.Dispatch<React.SetStateAction<VideoModelMode | null>>;
  hhCurrentMode: VideoModelMode;  // 由 useMemo 推导，只读
  hhAudioSetting: 'auto' | 'origin';
  setHhAudioSetting: React.Dispatch<React.SetStateAction<'auto' | 'origin'>>;
  // #634 新增：视频输入状态（用于 video-edit 模式推导）
  chatVideoUrl: string | null;
  setChatVideoUrl: React.Dispatch<React.SetStateAction<string | null>>;

  // ========== 熔断状态 ==========
  bannedResolutions: Record<string, Record<string, number>>;  // #878 modelId → resolution → expiryTimestamp
  currentModelBannedResolutions: Record<string, number>;  // #878 当前模型被熔断的分辨率→expiryTimestamp 映射（UI 消费用）
  isResolutionBanned: (resolution: string, modelId?: string) => boolean;  // #878 精确查询（modelId 可选，默认当前模型）
  setBannedResolutions: React.Dispatch<React.SetStateAction<Record<string, Record<string, number>>>>;

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
  chatImageIds: string[];  // #670 虚拟副本唯一标识（crypto.randomUUID），解决重复图片拖拽 key 冲突
  setChatImageIds: React.Dispatch<React.SetStateAction<string[]>>;
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
  authChecked: boolean; // #889 鉴权漏洞修复：首次鉴权检查是否完成
  authModalOpen: boolean;
  setAuthModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  authMode: 'login' | 'register';
  setAuthMode: React.Dispatch<React.SetStateAction<'login' | 'register'>>;
  refreshUserInfo: (forceRefresh?: boolean) => Promise<any>;

  // ========== 违规计数状态 ==========
  failedAttempts: number;
  setFailedAttempts: React.Dispatch<React.SetStateAction<number>>;
  FAILED_ATTEMPTS_THRESHOLD: number;
  // #504 禁用状态
  isBanned: boolean;
  setIsBanned: React.Dispatch<React.SetStateAction<boolean>>;
  lockedUntil: string | null;
  setLockedUntil: React.Dispatch<React.SetStateAction<string | null>>;
  showBannedDialog: boolean;
  setShowBannedDialog: React.Dispatch<React.SetStateAction<boolean>>;

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
// #681 Banana 模型合并：
// - nano-banana-2-cl + nano-banana-2-4k-cl → 合并为 nano-banana-2-cl（支持 1K/2K/4K）
// - nano-banana-pro-vip + nano-banana-pro-4k-vip → 合并为 nano-banana-pro-vip（支持 1K/2K/4K）
// 前端只展示合并后的入口，后端根据分辨率自动路由到真实 API 模型
const defaultImageModelOptions = ['nano-banana-2', 'nano-banana-2-cl', 'nano-banana', 'nano-banana-fast', 'nano-banana-pro', 'nano-banana-pro-vip', 'nano-banana-pro-vt', 'nano-banana-pro-cl'];
// #538 迁移：默认视频模型改为 sora-2（T8 服务商）
const defaultVideoModelOptions = ['sora-2'];
// 默认 LLM 模型选项
const defaultLlmModelOptions = ['gemini-3.1-pro'];
const defaultPresetColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9', '#F8B500', '#2ECC71'];

// Context
const AIGeneratorContext = createContext<AIGeneratorContextType | null>(null);

export function AIGeneratorProvider({ children }: { children: React.ReactNode }) {
  // ========== 模型配置 - 带记忆 ==========
  // #860 修复 React #418 Hydration Mismatch：
  // useState 初始化器中禁止使用 typeof window / localStorage，
  // 否则 SSR（window=undefined）与 Client（window 存在）渲染不一致，
  // 导致 React error #418。
  // 正确做法：初始值用默认值，useEffect 挂载后再从 localStorage 恢复。
  const [selectedModel, setSelectedModel] = useState<string>('gpt-image-2');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelTab, setModelTab] = useState<'image' | 'video'>('image');
  const [modelStatuses, setModelStatuses] = useState<Record<string, { status: boolean; error: string }>>({});
  const [modelConfig, setModelConfig] = useState<Record<string, ModelConfigItem>>({});
  const [modelDisplayNames, setModelDisplayNames] = useState<Record<string, string>>({});
  const [modelActiveStatus, setModelActiveStatus] = useState<Record<string, boolean>>({});
  const [imageModelOptions, setImageModelOptions] = useState<string[]>(defaultImageModelOptions);
  const [videoModelOptions, setVideoModelOptions] = useState<string[]>(defaultVideoModelOptions);
  const [llmModelOptions, setLlmModelOptions] = useState<string[]>(defaultLlmModelOptions);
  const [presetColors, setPresetColors] = useState<string[]>(defaultPresetColors);

  // ========== 生成参数 - 带记忆 ==========
  // #860: 初始值用默认值，localStorage 恢复在 useEffect 中完成
  const [selectedRatio, setSelectedRatio] = useState<string>('1:1');  // #493 修复：默认 1:1 而非 auto（auto 被后端映射为 1:1）
  const [selectedResolution, setSelectedResolution] = useState<string>('1K');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<string>('1:1');
  const [selectedCount, setSelectedCount] = useState<number>(1);
  const [selectedDuration, setSelectedDuration] = useState<number>(10);
  const [selectedQuality, setSelectedQuality] = useState('auto');  // #523 T8Star 质量选项：low/medium/high/auto
  const [showRatioPicker, setShowRatioPicker] = useState(false);

  // ========== 熔断状态 ==========
  // #878 熔断精细化：modelId → (resolution → expiryTimestamp)，按模型维度隔离熔断
  const [bannedResolutions, setBannedResolutions] = useState<Record<string, Record<string, number>>>({});
  const [showResolutionPicker, setShowResolutionPicker] = useState(false);
  const [showAspectRatioPicker, setShowAspectRatioPicker] = useState(false);
  const [showCountPicker, setShowCountPicker] = useState(false);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [showQualityPicker, setShowQualityPicker] = useState(false);  // #523 T8Star 品质弹窗

  // ========== #633 HappyHorse 模式切换 - 带记忆 ==========
  // #860: 初始值用默认值，localStorage 恢复在 useEffect 中完成
  const [hhOverrideMode, setHhOverrideMode] = useState<VideoModelMode | null>(null);
  const [hhAudioSetting, setHhAudioSetting] = useState<'auto' | 'origin'>('auto');
  // #634 新增：视频输入状态（用于 video-edit 模式推导）
  const [chatVideoUrl, setChatVideoUrl] = useState<string | null>(null);
  // hhCurrentMode 推导移到 chatImageUrls 定义之后

  // ========== 参考图 ==========
  const [chatImageBase64s, setChatImageBase64s] = useState<string[]>([]);
  const [chatImageUrls, setChatImageUrls] = useState<string[]>([]);
  const [chatImageMd5s, setChatImageMd5s] = useState<string[]>([]);
  const [chatImageKeys, setChatImageKeys] = useState<string[]>([]);
  const [chatImageNames, setChatImageNames] = useState<string[]>([]);
  const [chatImageIds, setChatImageIds] = useState<string[]>([]);  // #670 虚拟副本唯一标识
  // #048 新增：追踪画布对话框中正在上传的参考图 MD5
  const [chatUploadingMd5s, setChatUploadingMd5s] = useState<Set<string>>(new Set());

  // ========== #634 HappyHorse 模式推导 ==========
  // 优化：hhCurrentMode 由 useMemo 推导，单一数据源
  // 消除对子组件 useEffect 触发时序的依赖，避免 UI 变动导致状态丢失
  // #634 修复：补全 video-edit 和 r2v 的自动推断
  // #651 修复：解除 hhCurrentMode 的强制锁死 - 所有模式切换模型都享受同等待遇
  // #655 修复：每个模型有独立的推断逻辑，不再共用！
  const hhCurrentMode = useMemo<VideoModelMode>(() => {
    // #663 统一使用 ModelDetector.getFamily() 判断模型
    const family = ModelDetector.getFamily(selectedModel);
    const isHappyHorse = family === 'happyhorse';
    const isSeedance2 = family === 'seedance2';
    const isT8Seedance = family === 't8seedance';
    const isTopais = family === 'topais';  // #690 TOPAIS Veo
    const isTopaisHh = family === 'topais-happyhorse';  // #7xx TOPAIS HappyHorse
    const isTopaisSeedance = family === 'topais-seedance';  // TOPAIS Seedance 2.0
    const isTopaisGeminiOmni = family === 'topais-gemini-omni';  // TOPAIS Gemini Omni Flash
    const isLingyaVeo = family === 'lingya-veo';  // LingYa Veo3.1
    const isLingyaSora = family === 'lingya-sora';  // LingYa Sora-2
    const isMegaAiSeedance = family === 'mega-ai-seedance';  // MEGA AI Seedance 2.0
    const isTopaisMinimax = family === 'topais-minimax';  // TOPAIS MiniMax H3
    const isTopaisKlingOmni = family === 'topais-kling-omni';  // TOPAIS Kling v3 Omni
    
    // 👑 非模式切换模型，退回 t2v
    if (!isHappyHorse && !isSeedance2 && !isT8Seedance && !isTopais && !isTopaisHh && !isTopaisSeedance && !isTopaisGeminiOmni && !isLingyaVeo && !isLingyaSora && !isMegaAiSeedance && !isTopaisMinimax && !isTopaisKlingOmni) return 't2v';
    
    // 🛡️ 核心防线：跨模型安全校验！
    // 只有当用户的手动选择，真实存在于当前模型的二维矩阵支持列表中，才允许生效！
    if (hhOverrideMode) {
      const supportedModes = MODEL_MODE_CONSTRAINTS[family] || [];
      if (supportedModes.includes(hhOverrideMode)) {
        return hhOverrideMode;
      }
    }
    
    // #655 每个模型有独立的推断逻辑！
    const validImageCount = chatImageBase64s.filter(b => b && b.length > 0).length;
    const hasVideo = chatVideoUrl && chatVideoUrl.length > 0;
    
    // ========== #690 TOPAIS Veo 推断逻辑（独立！不共用任何模型）==========
    if (isTopais) {
      // 1. 3张及以上图片 → r2v（参考生视频）
      if (validImageCount >= 3) return 'r2v';
      // 2. 1-2张图片 → i2v（首帧/首尾帧）
      if (validImageCount >= 1) return 'i2v';
      // 3. 无素材 → t2v（文生视频）
      return 't2v';
    }
    
    // ========== #7xx TOPAIS HappyHorse 推断逻辑（独立！不共用任何模型）==========
    if (isTopaisHh) {
      // 1. 有视频输入 → video-edit（视频编辑）
      if (hasVideo) return 'video-edit';
      // 2. 2张及以上图片 → r2v（参考生视频，最多9张）
      if (validImageCount >= 2) return 'r2v';
      // 3. 1张图片 → i2v（首帧生视频）
      if (validImageCount === 1) return 'i2v';
      // 4. 无素材 → t2v（文生视频）
      return 't2v';
    }
    
    // ========== TOPAIS Seedance 2.0 推断逻辑（独立！不共用任何模型）==========
    if (isTopaisSeedance) {
      // TOPAIS Seedance 2.0 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式
      // 1. 有视频 → r2v（视频属于多模态参考素材）
      if (hasVideo) return 'r2v';
      // 2. 2张及以上图片 → r2v（参考生视频，最多9张）
      if (validImageCount >= 2) return 'r2v';
      // 3. 1张图片 → i2v（首帧生视频）
      if (validImageCount === 1) return 'i2v';
      // 4. 无素材 → t2v（文生视频）
      return 't2v';
    }
    
    // ========== TOPAIS Gemini Omni Flash 推断逻辑（独立！不共用任何模型）==========
    // Gemini Omni Flash 支持 t2v/i2v/r2v 三种模式
    // 关键：不支持2张图片！只有0/1/3张图片三种情况
    if (isTopaisGeminiOmni) {
      // 1. 3张图片 → r2v（参考图融合）
      if (validImageCount >= 3) return 'r2v';
      // 2. 1张图片 → i2v（单图生视频）
      if (validImageCount === 1) return 'i2v';
      // 3. 0或2张图片 → t2v（2张不支持，回退文生视频）
      return 't2v';
    }
    
    // ========== LingYa Veo3.1 推断逻辑（独立！不共用任何模型）==========
    if (isLingyaVeo) {
      // Veo3.1 支持首帧+尾帧，固定8秒
      // 1. 2张图片 → i2v（首帧+尾帧）
      if (validImageCount >= 2) return 'i2v';
      // 2. 1张图片 → i2v（首帧）
      if (validImageCount === 1) return 'i2v';
      // 3. 无素材 → t2v（文生视频）
      return 't2v';
    }
    
    // ========== LingYa Sora-2 推断逻辑（独立！不共用任何模型）==========
    if (isLingyaSora) {
      // 1. 有视频 → r2v
      if (hasVideo) return 'r2v';
      // 2. 1张及以上图片 → i2v
      if (validImageCount >= 1) return 'i2v';
      // 3. 无素材 → t2v
      return 't2v';
    }
    
    // ========== MEGA AI Seedance 2.0 推断逻辑（独立！不共用任何模型）==========
    if (isMegaAiSeedance) {
      // MEGA AI Seedance 2.0 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式
      // 1. 有视频 → r2v（视频属于多模态参考素材）
      if (hasVideo) return 'r2v';
      // 2. 2张及以上图片 → r2v（参考生视频，最多9张）
      if (validImageCount >= 2) return 'r2v';
      // 3. 1张图片 → i2v-first-frame（首帧生视频）
      if (validImageCount === 1) return 'i2v-first-frame';
      // 4. 无素材 → t2v（文生视频）
      return 't2v';
    }
    
    // ========== TOPAIS MiniMax H3 推断逻辑（独立！不共用任何模型）==========
    if (isTopaisMinimax) {
      // MiniMax H3 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式
      // 1. 有视频 → r2v（视频属于多模态参考素材）
      if (hasVideo) return 'r2v';
      // 2. 2张及以上图片 → r2v（参考生视频，最多9张参考图）
      if (validImageCount >= 2) return 'r2v';
      // 3. 1张图片 → i2v-first-frame（首帧生视频）
      if (validImageCount === 1) return 'i2v-first-frame';
      // 4. 无素材 → t2v（文生视频）
      return 't2v';
    }
    
    // ========== TOPAIS Kling v3 Omni 推断逻辑（独立！不共用任何模型）==========
    if (isTopaisKlingOmni) {
      // Kling v3 Omni 支持 t2v/i2v/r2v 三种模式
      // 1. 有视频 → r2v（视频属于参考视频素材）
      if (hasVideo) return 'r2v';
      // 2. 2张及以上图片 → r2v（多图参考生视频）
      if (validImageCount >= 2) return 'r2v';
      // 3. 1张图片 → i2v（图片引用生视频）
      if (validImageCount === 1) return 'i2v';
      // 4. 无素材 → t2v（文生视频）
      return 't2v';
    }
    
    // ========== #680 LingYa Seedance 2.0 推断逻辑（r2v阈值从3降为2）==========
    if (isSeedance2) {
      // 1. 有视频 → r2v（视频属于多模态参考素材）
      if (hasVideo) {
        return 'r2v';
      }
      // 2. 2张及以上图片 → r2v（参考生视频，与HappyHorse对齐）
      if (validImageCount >= 2) {
        return 'r2v';
      }
      // 3. 1张图片 → i2v（首帧，默认；用户可手动切换到 r2v）
      if (validImageCount === 1) {
        return 'i2v';
      }
      // 4. 无素材 → t2v（文生视频，不支持音频）
      return 't2v';
    }
    
    // ========== #680 T8 Seedance 推断逻辑（r2v阈值从3降为2）==========
    if (isT8Seedance) {
      // 1. 有视频 → r2v（视频属于多模态参考素材）
      if (hasVideo) {
        return 'r2v';
      }
      // 2. 2张及以上图片 → r2v（参考生视频）
      if (validImageCount >= 2) {
        return 'r2v';
      }
      // 3. 1张图片 → i2v-first-frame（首帧）
      if (validImageCount === 1) {
        return 'i2v-first-frame';
      }
      // 4. 无素材 → t2v（文生视频）
      return 't2v';
    }
    
    // ========== HappyHorse 推断逻辑 ==========
    if (isHappyHorse) {
      // 1. 有视频输入 → video-edit
      if (hasVideo) return 'video-edit';
      // 2. 两张以上推断为参考生视频
      if (validImageCount >= 2) return 'r2v';
      // 3. 单张推断为图生视频
      if (validImageCount === 1) return 'i2v';
      // 4. 没有素材则为文生视频
      return 't2v';
    }
    
    // 默认退回 t2v
    return 't2v';
  }, [hhOverrideMode, selectedModel, chatImageBase64s, chatVideoUrl]);

  // ========== #663 修复状态死锁：删除素材变化清除 hhOverrideMode 的逻辑 ==========
  // 【根因分析】军师诊断有偏差：真正的问题不是 hhCurrentMode 推导逻辑，
  // 而是这个 useEffect 在素材变化时清除用户手动选择的 hhOverrideMode！
  // 
  // 【修复】删除这个 useEffect，让用户的选择保持不变
  // 用户可以通过 ModelModeSwitcher 手动切换模式，不应该被素材变化覆盖
  //
  // 【注意】hhCurrentMode 推导逻辑（第391-463行）已经正确：
  // if (hhOverrideMode) return hhOverrideMode; 已经在最前面
  //
  // 【删除原因】#652 的修复逻辑（素材变化清除覆盖）导致了状态死锁：
  // 用户手动选择 r2v → 上传图片 → useEffect 清除 hhOverrideMode → 
  // 系统自动推断变成 i2v → 用户的选择被覆盖

  // ========== 记忆功能：参数变化时自动保存到localStorage ==========
  useEffect(() => { localStorage.setItem('dialog-selectedModel', selectedModel); }, [selectedModel]);
  useEffect(() => { localStorage.setItem('dialog-modelTab', modelTab); }, [modelTab]);
  useEffect(() => { localStorage.setItem('dialog-selectedRatio', selectedRatio); }, [selectedRatio]);
  useEffect(() => { localStorage.setItem('dialog-selectedResolution', selectedResolution); }, [selectedResolution]);
  useEffect(() => { localStorage.setItem('dialog-selectedAspectRatio', selectedAspectRatio); }, [selectedAspectRatio]);
  useEffect(() => { localStorage.setItem('dialog-selectedCount', selectedCount.toString()); }, [selectedCount]);
  useEffect(() => { localStorage.setItem('dialog-selectedDuration', selectedDuration.toString()); }, [selectedDuration]);
  useEffect(() => { if (hhOverrideMode) localStorage.setItem('dialog-hhOverrideMode', hhOverrideMode); }, [hhOverrideMode]);

  // ========== #860 修复 React #418：挂载后从 localStorage 恢复用户偏好 ==========
  // 初始渲染使用默认值（SSR 与 Client 一致），挂载后再恢复 localStorage 中的记忆值
  useEffect(() => {
    const savedModel = localStorage.getItem('dialog-selectedModel');
    if (savedModel) setSelectedModel(savedModel);

    const savedTab = localStorage.getItem('dialog-modelTab');
    if (savedTab === 'image' || savedTab === 'video') setModelTab(savedTab);

    const savedRatio = localStorage.getItem('dialog-selectedRatio');
    if (savedRatio) setSelectedRatio(savedRatio);

    const savedResolution = localStorage.getItem('dialog-selectedResolution');
    if (savedResolution) setSelectedResolution(savedResolution);

    const savedAspectRatio = localStorage.getItem('dialog-selectedAspectRatio');
    if (savedAspectRatio) setSelectedAspectRatio(savedAspectRatio);

    const savedCount = localStorage.getItem('dialog-selectedCount');
    if (savedCount) setSelectedCount(parseInt(savedCount, 10) || 1);

    const savedDuration = localStorage.getItem('dialog-selectedDuration');
    if (savedDuration) setSelectedDuration(parseInt(savedDuration, 10) || 10);

    const savedHhMode = localStorage.getItem('dialog-hhOverrideMode');
    if (savedHhMode) setHhOverrideMode(savedHhMode as VideoModelMode);

    const savedInputValue = localStorage.getItem('dialog-inputValue');
    if (savedInputValue) setInputValue(savedInputValue);
  }, []);

  // ========== 切换模型时清除不支持的视频输入 ==========
  // 当模型切换到不支持视频的模型时，清除 chatVideoUrl
  useEffect(() => {
    const supported = getModelSupportedTypes(selectedModel);
    if (!supported.video && chatVideoUrl) {
      setChatVideoUrl(null);
    }
  }, [selectedModel, chatVideoUrl]);

  // ========== Veo模型1080p自动降级 ==========
  // 当Veo模型有参考图时，1080p不可用，自动降级到720p
  useEffect(() => {
    if (chatImageBase64s.length > 0 && selectedResolution === '1080p') {
      const config = modelConfig[selectedModel];
      if (config && (config as any).supportsUpsample) {
        setSelectedResolution('720p');
      }
    }
  }, [chatImageBase64s.length, selectedResolution, selectedModel, modelConfig]);

  // ========== #690 TOPAIS 固定 8 秒 + #735 通用秒数调整：切换模型时自动调整秒数 ==========
  useEffect(() => {
    const family = ModelDetector.getFamily(selectedModel);
    
    // TOPAIS Veo：固定 8 秒
    if (family === 'topais' && selectedDuration !== 8) {
      setSelectedDuration(8);
      return;
    }
    
    // LingYa Veo：固定 8 秒
    if (family === 'lingya-veo' && selectedDuration !== 8) {
      setSelectedDuration(8);
      return;
    }
    
    // #735 通用秒数调整：检查当前秒数是否在模型的可用列表中
    const currentConfig = modelConfig[selectedModel];
    if (currentConfig?.durations && currentConfig.durations.length > 0) {
      const availableDurations = currentConfig.durations
        .map((d: any) => parseInt(d.value || d))
        .filter((v: number) => !isNaN(v) && v > 0);
      
      if (availableDurations.length > 0 && !availableDurations.includes(selectedDuration)) {
        setSelectedDuration(availableDurations[0]);
      }
    }
    
    // Sora-2 VIP：仅支持 10s 和 15s
    if (selectedModel.startsWith('sora-2-all-vip') && ![10, 15].includes(selectedDuration)) {
      setSelectedDuration(10);
    }
    
    // Sora-2：文生视频仅 10s，图生视频 4/8/10/12s（对话框一般无参考图，默认 10s）
    if (selectedModel === 'sora-2' && selectedDuration !== 10) {
      setSelectedDuration(10);
    }
    
    // TOPAIS HappyHorse：3-15 秒
    if (family === 'topais-happyhorse' && (selectedDuration < 3 || selectedDuration > 15)) {
      setSelectedDuration(5);
    }
    
    // Seedance 2.0：4-15 秒
    if (family === 'seedance2' && (selectedDuration < 4 || selectedDuration > 15)) {
      setSelectedDuration(5);
    }
    
    // T8 Seedance：4-15 秒
    if (family === 't8seedance' && (selectedDuration < 4 || selectedDuration > 15)) {
      setSelectedDuration(5);
    }
    
    // HappyHorse：3-15 秒
    if (family === 'happyhorse' && (selectedDuration < 3 || selectedDuration > 15)) {
      setSelectedDuration(5);
      setSelectedDuration(5);
    }
  }, [selectedModel, selectedDuration, modelConfig]);

  // ========== 收藏夹 ==========
  const [showFavoritesModal, setShowFavoritesModal] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [newFavoriteContent, setNewFavoriteContent] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');

  // ========== 对话 ==========
  // #860: 初始值用默认值，localStorage 恢复在 useEffect 中完成
  const [inputValue, setInputValue] = useState<string>('');
  // 记忆：inputValue变化时保存到localStorage
  useEffect(() => { localStorage.setItem('dialog-inputValue', inputValue); }, [inputValue]);
  const [messages, setMessages] = useState<Message[]>([]);

  // ========== 用户信息 ==========
  const [credits, setCredits] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  // #232 修复：使用 ref 解决闭包陷阱
  const userIdRef = useRef<string | null>(null);
  // #878 熔断精细化：同步 ref，供 fetchCircuitBreakers 闭包读取最新 modelConfig
  const modelConfigRef = useRef<Record<string, ModelConfigItem>>({});
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // #889 鉴权漏洞修复：标记首次鉴权检查是否完成
  // 用途：CanvasContext 在 authChecked=true 之前不加载 localStorage 数据
  //      authChecked=true && isLoggedIn=false 时清空旧数据
  const [authChecked, setAuthChecked] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  
  // ========== 违规计数状态 ==========
  const [failedAttempts, setFailedAttempts] = useState(0);
  const FAILED_ATTEMPTS_THRESHOLD = 10;  // 与后端保持一致
  // #505 禁用状态（改用时间戳覆盖法判断，不再依赖 is_active）
  const [isBanned, setIsBanned] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [showBannedDialog, setShowBannedDialog] = useState(false);
  
  // ========== 用户信息刷新函数 ==========
  const refreshUserInfo = useCallback(async (forceRefresh = false) => {
    try {
      // #301 如果是强制刷新（如违规计数更新），先清除缓存
      if (forceRefresh) {
        clearCachedUser();
      }
      
      // 🔒 军规：fetchUserWithCache 内部已处理首次刷新逻辑
      const userInfo = await fetchUserWithCache();
      
      if (userInfo) {
        setCredits(userInfo.credits || 0);
        setUserId(userInfo.id || null);
        userIdRef.current = userInfo.id || null;  // #232 修复：同步更新 ref
        setIsLoggedIn(true);
        setFailedAttempts(userInfo.failed_attempts || 0);  // #301 设置违规计数
        // #890 终极清扫：登录成功后写入 auth_signal（供多标签页同步）
        setAuthSignal(userInfo.id || 'unknown');
        // 🚀 #505 时间戳覆盖法判断禁用：不再依赖 is_active
        // 临时禁用：locked_until 在未来
        // 永久禁用：is_active=false 且 locked_until=null
        const userLockedUntil = userInfo.locked_until || null;
        const userIsActive = userInfo.is_active !== false;
        const isTempBanned = userLockedUntil && new Date(userLockedUntil).getTime() > Date.now();
        const isPermBanned = !userIsActive && !userLockedUntil;
        const userIsBanned = !!isTempBanned || isPermBanned;
        setIsBanned(userIsBanned);
        setLockedUntil(userLockedUntil);
        return userInfo;
      } else {
        setCredits(0);
        setUserId(null);
        userIdRef.current = null;  // #232 修复：同步更新 ref
        setIsLoggedIn(false);
        setFailedAttempts(0);  // #301 重置违规计数
        return null;
      }
    } catch (error) {
      return null;
    } finally {
      // #889 鉴权漏洞修复：无论成功失败，首次鉴权检查完成
      setAuthChecked(true);
    }
  }, [setCredits, setUserId, setIsLoggedIn]);
  
  // ========== 初始化和事件监听 ==========
  // 初始化时获取用户信息
  // 🔒 军规：首次调用自动清除缓存并刷新，后续走缓存
  useEffect(() => {
    refreshUserInfo();
  }, [refreshUserInfo]);

  // #889 鉴权漏洞修复：全局 401 监听 - 任何 API 返回 401 时：
  // 1. 标记未登录
  // 2. 清空对话消息（防止未登录看到历史对话）
  // 3. 清空 localStorage 中的画布/对话数据（防止下次加载泄漏）
  useEffect(() => {
    const handleOpenLogin = () => {
      console.log('[AIGenerator] 收到 openLogin 事件，标记为未登录并清空数据');
      setIsLoggedIn(false);
      setAuthChecked(true);
      // 清空对话消息
      setMessages([]);
      // #890 终极清扫：统一调用集中式清理函数，物理清空所有敏感 localStorage
      clearSensitiveLocalStorage();
      // #890 终极清扫：删除 auth_signal（触发其他标签页 storage 事件）
      removeAuthSignal();
    };
    window.addEventListener('openLogin', handleOpenLogin);
    return () => window.removeEventListener('openLogin', handleOpenLogin);
  }, [setIsLoggedIn, setMessages]);

  // #890 终极清扫：多标签页同步 - 检测其他 Tab 的登出/登录
  useEffect(() => {
    const cleanup = registerCrossTabAuthSync({
      onOtherTabLogout: () => {
        // 其他 Tab 登出 → 当前 Tab 也要清空+弹窗
        setIsLoggedIn(false);
        setAuthChecked(true);
        setMessages([]);
        setUserId(null);
        setCredits(0);
        clearSensitiveLocalStorage();
        // 派发 openLogin 让当前页面打开 LoginModal
        window.dispatchEvent(new CustomEvent('openLogin'));
      },
      onOtherTabLogin: (newUserId: string) => {
        // 其他 Tab 登录了新账号 → 当前 Tab 刷新用户信息（自动同步）
        console.log('[AIGenerator] 其他Tab登录新账号，刷新用户信息');
        refreshUserInfo();
      },
    });
    return cleanup;
  }, [setIsLoggedIn, setMessages, setUserId, setCredits, refreshUserInfo]);

  // #890 终极清扫：账号切换原子性重置
  // 当 isLoggedIn 变为 false 或 userId 变化时，清空所有旧账号残留数据
  // 防止 A 账号退出后 B 账号登录时看到 A 的数据闪现
  const prevUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    // 首次渲染不执行（prevUserIdRef 还是 null）
    if (prevUserIdRef.current === null) {
      prevUserIdRef.current = userId;
      return;
    }

    const prevUserId = prevUserIdRef.current;
    prevUserIdRef.current = userId;

    // 场景1：isLoggedIn 从 true 变为 false（登出）
    if (!isLoggedIn && prevUserId !== null) {
      console.log('[AIGenerator] #890 账号登出，原子性重置所有状态');
      setMessages([]);
      setCredits(0);
      setInputValue('');
      clearSensitiveLocalStorage();
      removeAuthSignal();
      return;
    }

    // 场景2：userId 变化且都非 null（账号切换：A→B）
    if (isLoggedIn && userId && prevUserId && userId !== prevUserId) {
      console.log('[AIGenerator] #890 账号切换 %s → %s，原子性重置', prevUserId, userId);
      setMessages([]);
      setInputValue('');
      clearSensitiveLocalStorage();
      // 写入新账号的 auth_signal
      setAuthSignal(userId);
      return;
    }
  }, [isLoggedIn, userId, setMessages, setCredits, setInputValue]);

  // ====== #878 细粒度熔断：fetchCircuitBreakers 提升为 useCallback，供 useEffect + handleGenerate 共享 ======
  const fetchCircuitBreakers = useCallback(async () => {
    try {
      const res = await fetch('/api/system/circuit-breakers');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          // #878 核心改造：使用 details（bannedResolutionsByConfig）按 configId → modelId 精确映射
          const newBannedMap: Record<string, Record<string, number>> = {};
          
          if (data.details && typeof data.details === 'object') {
            // details 结构: { configId: { name, resolutions: string[] } }
            // 需要将 configId 反查为 modelId
            const configToModels: Record<string, string[]> = {};
            for (const [modelId, cfg] of Object.entries(modelConfigRef.current)) {
              const cid = String(cfg.configId || '');
              if (cid) {
                if (!configToModels[cid]) configToModels[cid] = [];
                configToModels[cid].push(modelId);
              }
            }
            
            for (const [configId, info] of Object.entries(data.details as Record<string, { name?: string; resolutions?: string[] } | string[]>)) {
              // 兼容两种格式：{ name, resolutions } 或直接 string[]
              const resolutions = Array.isArray(info) ? info : (info as any).resolutions || [];
              const modelIds = configToModels[configId] || [];
              
              // 为每个属于该 config 的 model 写入独立的熔断维度
              for (const modelId of modelIds) {
                if (!newBannedMap[modelId]) newBannedMap[modelId] = {};
                for (const res of resolutions) {
                  newBannedMap[modelId][res.toUpperCase()] = Date.now() + 6 * 60 * 60 * 1000; // 6小时后过期兜底
                }
              }
              
              // 没有 configId 映射的模型，降级到全局（按 name 匹配）
              if (modelIds.length === 0 && !Array.isArray(info) && (info as any).name) {
                const banName = (info as any).name;
                for (const [modelId, cfg] of Object.entries(modelConfigRef.current)) {
                  if (cfg.configId && String(cfg.configId) === configId) continue; // 已处理
                  // 降级：根据 API 名匹配
                  if (modelId.toLowerCase().includes(banName.toLowerCase())) {
                    if (!newBannedMap[modelId]) newBannedMap[modelId] = {};
                    for (const res of resolutions) {
                      newBannedMap[modelId][res.toUpperCase()] = Date.now() + 6 * 60 * 60 * 1000;
                    }
                  }
                }
              }
            }
          }
          
          // Fallback：如果 details 不可用，使用旧的扁平数组（降级兼容）
          if (Object.keys(newBannedMap).length === 0 && data.bannedResolutions?.length > 0) {
            const globalBans: Record<string, number> = {};
            for (const r of data.bannedResolutions as string[]) {
              globalBans[r.toUpperCase()] = Date.now() + 6 * 60 * 60 * 1000;
            }
            // 所有模型都写入（降级兼容旧逻辑）
            for (const modelId of Object.keys(modelConfigRef.current)) {
              newBannedMap[modelId] = { ...globalBans };
            }
          }
          
          setBannedResolutions(newBannedMap);
        }
      }
    } catch (err) {
      // 静默失败，不影响正常使用
    }
  }, []);

  // Mount 时 + 每 5 分钟刷新熔断状态
  useEffect(() => {
    fetchCircuitBreakers();
    const interval = setInterval(fetchCircuitBreakers, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchCircuitBreakers]);
  
  // ====== #878 响应式倒计时自动解锁：每秒检查 bannedResolutions 中的过期条目并清除 ======
  useEffect(() => {
    const timer = setInterval(() => {
      setBannedResolutions(prev => {
        const now = Date.now();
        let hasExpired = false;
        const next: Record<string, Record<string, number>> = {};
        
        for (const [modelId, resolutions] of Object.entries(prev)) {
          const filtered: Record<string, number> = {};
          for (const [resolution, expiryTimestamp] of Object.entries(resolutions)) {
            if (now < expiryTimestamp) {
              filtered[resolution] = expiryTimestamp;
            } else {
              hasExpired = true;  // 有过期的条目
            }
          }
          // 只保留仍有未过期条目的模型
          if (Object.keys(filtered).length > 0) {
            next[modelId] = filtered;
          } else {
            hasExpired = true;  // 整个模型维度被清空
          }
        }
        
        // 只有当有过期条目时才更新状态（触发重绘）
        return hasExpired ? next : prev;
      });
    }, 1000);  // 每秒检查一次
    
    return () => clearInterval(timer);
  }, []);
  
  // #505 禁用状态变化时自动显示/隐藏禁用弹窗
  // 🚀 优化：使用时间戳覆盖法判断，locked_until 过期自然解封
  useEffect(() => {
    if (isBanned && lockedUntil) {
      // 检查是否仍在临时禁用期
      const lockedUntilTime = new Date(lockedUntil).getTime();
      if (Date.now() < lockedUntilTime) {
        setShowBannedDialog(true);
      } else {
        // locked_until 已过期，自然解封（零写入）
        setIsBanned(false);
        setShowBannedDialog(false);
      }
    } else if (isBanned && !lockedUntil) {
      // 管理员永久禁用
      setShowBannedDialog(true);
    } else if (!isBanned) {
      // 已解封，关闭弹窗
      setShowBannedDialog(false);
    }
  }, [isBanned, lockedUntil]);
  
  // ====== #878 当前模型被熔断的分辨率列表（自动跟随 selectedModel 变化）======
  const currentModelBannedResolutions = useMemo(() => {
    const modelBans = bannedResolutions[selectedModel];
    if (!modelBans) return {};
    const now = Date.now();
    // 只返回仍未过期的分辨率→expiry 映射
    const active: Record<string, number> = {};
    for (const [resolution, expiry] of Object.entries(modelBans)) {
      if (now < expiry) active[resolution] = expiry;
    }
    return active;
  }, [bannedResolutions, selectedModel]);
  
  // ====== #878 精确查询：指定模型的指定分辨率是否被熔断 ======
  const isResolutionBanned = useCallback((resolution: string, modelId?: string): boolean => {
    const mid = modelId || selectedModel || '';
    const modelBans = bannedResolutions[mid];
    if (!modelBans) return false;
    const expiry = modelBans[resolution.toUpperCase()];
    if (!expiry) return false;
    return Date.now() < expiry;
  }, [bannedResolutions, selectedModel]);

  // #270 监听全局积分变化事件（本地热更新，减少 API 请求）
  // #838 修复：去掉 credits 依赖！credits 变化 → useEffect 重跑 → 重新注册监听器 → 无意义重注册风暴
  useEffect(() => {
    const handleCreditsChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ userId?: string; newCredits?: number; source?: string }>;
      const { userId, newCredits, source } = customEvent.detail || {};
      
      // 检查是否是当前用户的积分变化
      if (userId && newCredits !== undefined && userId === userIdRef.current) {
        // 本地热更新（事件来自同一用户的其他页面）
        setCredits(newCredits);
        updateCachedCredits(newCredits);
      } else if (source === 'admin' && userId === userIdRef.current) {
        // 管理后台调整当前用户积分，强制刷新确保数据准确
        clearCachedUser();
        refreshUserInfo();
      } else if (userId && userId === userIdRef.current && newCredits === undefined) {
        // 🔥 #886 修复：当前用户的事件但缺 newCredits（如支付成功后 API 刷新失败）→ 强制刷新
        console.log('[AIGeneratorContext] creditsChanged 缺 newCredits，强制刷新');
        clearCachedUser();
        refreshUserInfo();
      }
      // 其他用户的积分变化，忽略（管理后台会单独处理）
    };
    
    window.addEventListener('creditsChanged', handleCreditsChanged as EventListener);
    return () => window.removeEventListener('creditsChanged', handleCreditsChanged as EventListener);
  }, [refreshUserInfo]);

  // 🔧 监听登录成功事件
  useEffect(() => {
    const handleLoginSuccess = () => {
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
        // #838 去重：使用 fetchConfig 替代裸 fetch，多组件同时请求同一配置只发一次 HTTP
        const imageData = await fetchConfig('/api/config?service_type=image_generation');
        // #859 Debug 探针：打印服务端时间戳
        console.log('[#859 Debug] 图片模型数据服务端时间戳:', imageData.debug_server_time || 'N/A');
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
          
          models.forEach((m: { model_id: string; model_name: string; is_active: boolean; parameters: any; credits_base?: number; config_id?: number; id?: number }) => {
            activeStatusMap[m.model_id] = m.is_active !== false;
            newDisplayNames[m.model_id] = m.model_name;
            
            const dbResolutions = m.parameters?.resolutions || [];
            const dbAspectRatios = (m.parameters?.aspectRatios || []).map((r: any) => r.value || r.label);
            
            newConfig[m.model_id] = {
              type: 'image',
              configId: m.config_id || m.id,  // #878 熔断精细化：存储 config_id 用于按模型维度隔离熔断
              resolutions: dbResolutions.map((r: any) => ({
                size: r.size || r.label || r.value,
                credits: r.credits || m.credits_base || 10,
              })),
              aspectRatios: dbAspectRatios,
            };
          });
          
          setModelActiveStatus(prev => ({ ...prev, ...activeStatusMap }));
          // #860 修复：merge 而非 replace，避免视频模型覆盖图片模型 displayNames
          setModelDisplayNames(prev => ({ ...prev, ...newDisplayNames }));
          setModelConfig(prev => {
            const merged = { ...prev, ...newConfig };
            modelConfigRef.current = merged;  // #878 同步 ref
            return merged;
          });
        }
      } catch (error) {
        // 静默失败
      }
      
      try {
        // #838 去重：使用 fetchConfig 替代裸 fetch
        const videoData = await fetchConfig('/api/config?service_type=video_generation');
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
          // 三端统一：所有字段从数据库参数解析，不硬编码
          setModelConfig(prev => {
            const newConfig = { ...prev };
            models.forEach((m: { model_id: string; parameters: any; config_id?: number; id?: number }) => {
              if (m.parameters) {
                const isHappyHorse = ModelDetector.getFamily(m.model_id) === 'happyhorse';
                const dbAspectRatios = (m.parameters.aspectRatios || []).map((r: any) => r.value || r.label);
                // #636 HappyHorse 比例强制完整列表，忽略数据库不完整配置
                if (isHappyHorse) {
                  dbAspectRatios.length = 0;
                  dbAspectRatios.push('1:1', '3:2', '4:3', '16:9', '9:16');
                }
                const dbResolutions = (m.parameters.resolutions || []).map((r: any) => ({
                  size: r.size || r.label || r.value,
                  credits: r.credits || 10,
                }));
                // 数据库 durations 格式: [{label: "5秒", value: "5"}, ...] → 解析为 number[]
                const rawDurations: any[] = m.parameters.durations || [];
                let dbDurations: number[] = rawDurations.map((d: any) => {
                  if (typeof d === 'number') return d;
                  return parseInt(d.value || d.label) || 0;
                }).filter((n: number) => n > 0);
                // #636 HappyHorse 时长强制 3-15 每整数秒，忽略数据库配置
                if (isHappyHorse) {
                  dbDurations = Array.from({ length: 13 }, (_, i) => i + 3); // [3, 4, 5, ..., 15]
                }
                // 参考图数量限制
                const maxRefImages = m.parameters.maxImages || 1;
                // 参考图模式
                const imageMode = m.parameters.imageMode || 'first_last_frame';
                // 是否支持1080P提升
                const supportsUpsample = m.parameters.supportsUpsample === true;
                // 前端是否显示时长/分辨率选择（Sora/Veo 隐藏）
                const showDuration = m.parameters.showDuration !== false && dbDurations.length > 0;
                const showResolution = m.parameters.showResolution !== false && dbResolutions.length > 0;
                const isSeedance = ModelDetector.getFamily(m.model_id) === 't8seedance';
                
                if (newConfig[m.model_id]) {
                  newConfig[m.model_id] = {
                    ...newConfig[m.model_id],
                    type: 'video',  // #635 修复：视频模型必须覆盖 type
                    configId: m.config_id || m.id,  // #878 熔断精细化
                    resolutions: dbResolutions.length > 0 ? dbResolutions : newConfig[m.model_id].resolutions,
                    aspectRatios: dbAspectRatios.length > 0 ? dbAspectRatios : newConfig[m.model_id].aspectRatios,
                    supportsDuration: dbDurations.length > 0 ? true : (newConfig[m.model_id].supportsDuration || false),
                    durations: dbDurations.length > 0 ? dbDurations : newConfig[m.model_id].durations,
                    maxRefImages,
                    imageMode,
                    supportsUpsample,
                    showDuration,
                    showResolution,
                  };
                } else {
                  const defaultAspectRatios = ['auto', '1:1', '3:2', '4:3', '5:4', '16:9', '21:9', '3:4', '4:5', '9:16', '1:2', '2:3', '1:4', '4:1', '1:8', '8:1'];
                  newConfig[m.model_id] = {
                    type: 'video',
                    configId: m.config_id || m.id,  // #878 熔断精细化
                    resolutions: dbResolutions.length > 0 ? dbResolutions : [{ size: '720P', credits: 50 }],
                    aspectRatios: dbAspectRatios.length > 0 ? dbAspectRatios : defaultAspectRatios,
                    supportsDuration: dbDurations.length > 0,
                    durations: dbDurations.length > 0 ? dbDurations : undefined,
                    maxRefImages,
                    imageMode,
                    supportsUpsample,
                    showDuration,
                    showResolution,
                  };
                }
              }
            });
            modelConfigRef.current = newConfig;  // #878 同步 ref
            return newConfig;
          });
        }
      } catch (error) {
        // 静默失败
      }
      
      try {
        // #838 去重：使用 fetchConfig 替代裸 fetch
        const llmData = await fetchConfig('/api/config?service_type=llm');
        if (llmData.success && llmData.data?.models) {
          const models = llmData.data.models;
          const allModelIds = models.map((m: { model_id: string }) => m.model_id);
          if (allModelIds.length > 0) {
            setLlmModelOptions(allModelIds);
          }
          
          const activeStatusMap: Record<string, boolean> = {};
          const newDisplayNames: Record<string, string> = {};
          
          models.forEach((m: { model_id: string; model_name: string; is_active: boolean }) => {
            activeStatusMap[m.model_id] = m.is_active !== false;
            newDisplayNames[m.model_id] = m.model_name;
          });
          
          setModelActiveStatus(prev => ({ ...prev, ...activeStatusMap }));
          setModelDisplayNames(prev => ({ ...prev, ...newDisplayNames }));
        }
      } catch (error) {
        // 静默失败
      }
    };
    
    fetchModelConfig();
  }, [setImageModelOptions, setVideoModelOptions, setLlmModelOptions, setModelActiveStatus, setModelDisplayNames, setModelConfig]);

  // 🔧 #493 修复：模型配置加载完成后，检查当前比例是否被当前模型支持
  // 默认选第一个非 auto 比例，避免 auto 被后端映射为 1:1 导致不符合用户预期
  useEffect(() => {
    const config = modelConfig[selectedModel];
    if (!config || !config.aspectRatios || config.aspectRatios.length === 0) return;
    
    const supportedRatios = config.aspectRatios;
    
    // 检查当前比例是否被支持
    if (!supportedRatios.includes(selectedRatio)) {
      // #493 修复：优先选择第一个非 auto 比例，auto 是最后兜底
      const nonAutoRatios = supportedRatios.filter((r: string) => r !== 'auto');
      const newRatio = nonAutoRatios.length > 0 ? nonAutoRatios[0] : supportedRatios[0];
      setSelectedRatio(newRatio);
    }
  }, [modelConfig, selectedModel, selectedRatio]);

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
    setChatImageIds([]);  // #670 虚拟副本：同步清除唯一标识
    // 清除 IndexedDB 中的参考图
    try {
      await clearAllReferenceImages();
    } catch (error) {
      console.error('[AIGeneratorContext] 清除数据库参考图失败:', error);
    }
  }, []);

  // ========== 使用生成服务 ==========
  const genService = useGenService();

  // 全局生成方法
  const handleGenerate = useCallback(async (options: GenerationOptions) => {
    // #505 禁用检查：如果账号被禁用，直接拦截
    if (isBanned) {
      setShowBannedDialog(true);
      setIsGenerating(false);
      return { taskId: '', success: false, message: '账号已被禁用' };
    }
    
    setIsGenerating(true);
    
    // #663 业务强校验：防漏传（UI控上限，拦截控下限）
    const family = ModelDetector.getFamily(options.model);
    if (options.mode === 'video' || family === 'happyhorse' || family === 'seedance2' || family === 't8seedance') {
      // 1. HappyHorse video-edit 必须有视频
      if (family === 'happyhorse' && options.hhMode === 'video-edit') {
        if (!options.inputVideoUrl) {
          toast.error('视频编辑模式必须上传参考视频');
          setIsGenerating(false);
          return { taskId: '', success: false, message: '视频编辑模式必须上传参考视频' };
        }
      }
      // 2. Seedance 2.0 / T8 Seedance i2v-first-last-frame 必须同时有首帧和尾帧
      if ((family === 'seedance2' || family === 't8seedance') && 
          (options.sd2Mode === 'i2v-first-last-frame' || options.hhMode === 'i2v-first-last-frame')) {
        if (!options.firstFrameUrl || !options.lastFrameUrl) {
          toast.error('首尾帧模式必须同时上传首帧和尾帧图片');
          setIsGenerating(false);
          return { taskId: '', success: false, message: '首尾帧模式必须同时上传首帧和尾帧图片' };
        }
      }
      // 3. 音频孤岛拦截：有音频但没有图片/视频
      const hasAudio = (options.referenceAudioUrls && options.referenceAudioUrls.length > 0);
      const hasImage = (options.images && options.images.length > 0) || 
                        (options.referenceImageUrls && options.referenceImageUrls.length > 0) || 
                        !!options.firstFrameUrl || !!options.lastFrameUrl;
      const hasVideo = (options.inputVideoUrl && options.inputVideoUrl.length > 0) || 
                        (options.referenceVideoUrls && options.referenceVideoUrls.length > 0);
      if (hasAudio && !hasImage && !hasVideo) {
        toast.error('音频不可单独使用，需至少包含1张参考图或视频');
        setIsGenerating(false);
        return { taskId: '', success: false, message: '音频不可单独使用，需至少包含1张参考图或视频' };
      }
    }
    
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
        quality: options.quality,  // #522 T8Star GPT 品质参数
        taskId: options.taskId,  // #047 修复：透传前端预生成的taskId
        images: options.images,
        isUrls: options.isUrls,
        md5Hashes: options.md5Hashes,
        userId: userId ?? undefined,
        enhancePrompt: options.enhancePrompt,
        enableUpsample: options.enableUpsample,
        // #540 修复：必须传递 mode，否则视频模型走图片 API 端点
        mode: options.mode,
        // 视频参数
        duration: options.duration,
        size: options.size,
        
        // #633 HappyHorse 视频参数
        firstFrameUrl: options.firstFrameUrl,
        referenceImageUrls: options.referenceImageUrls,
        inputVideoUrl: options.inputVideoUrl,
        audioSetting: options.audioSetting,
        hhMode: options.hhMode,
        
        // #642 Seedance 2.0 视频参数
        sd2Mode: options.sd2Mode,
        lastFrameUrl: options.lastFrameUrl,
        referenceVideoUrls: options.referenceVideoUrls,
        referenceAudioUrls: options.referenceAudioUrls,
        generateAudio: options.generateAudio,
        
        // 画布占位符回调
        onBeforeGenerate: options.onBeforeGenerate,
        onImageReceived: options.onImageReceived,
        onPlaceholderFailed: options.onPlaceholderFailed,
        
        // 视频模式回调（透传给 genService）
        onVideoProgress: options.onVideoProgress,
        onVideoReceived: options.onVideoReceived,
        // #270 新增：任务开始时扣费后立即更新积分（让用户立即看到变化）
        onCreditsDeducted: (data) => {
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
          // 更新积分（状态 + 缓存）
          if (genResult.creditsBalance !== undefined && genResult.creditsBalance !== null) {
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
          }
          
          // #301 刷新用户信息以获取最新的 failedAttempts（违规计数）- 强制刷新跳过缓存
          refreshUserInfo(true);  // true = 强制刷新，跳过缓存
          
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
              reference_image_keys: options.referenceImageKeys || [],  // #840 保存参考图 COS keys
              resolution: genResult.resolution || options.resolution || '',
              aspect_ratio: genResult.aspectRatio || options.aspectRatio || '',
              created_at: new Date().toISOString(),
              credits_charged: genResult.creditsCharged,
              source: genResult.source || 'generate',
            };
            
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
                    reference_image_keys: record.reference_image_keys,  // #840 保存参考图 COS keys
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
                } else {
                  console.error(`[AIGeneratorContext] API 返回失败:`, result.error);
                }
              } catch (error) {
                console.error('[AIGeneratorContext] API 保存异常:', error);
              }
            })();
          }
          
          options.onComplete?.(genResult);
        },

        // Fire-and-Forget：后端轮询超时，任务仍在服务商排队
        onStillProcessing: (data) => {
          console.log('[AIGeneratorContext] 视频任务转入后台异步处理:', data.taskId);
          // 调用外部回调（如果提供了）
          options.onStillProcessing?.(data);
        },

        // 错误回调
        onError: (error) => {
          // #301 强制刷新用户信息以获取最新的 failedAttempts（违规计数）
          refreshUserInfo(true);  // true = 强制刷新，跳过缓存
          
          // ====== 细粒度熔断：resolution_banned 类型错误 → 按模型维度置灰该分辨率 ======
          if ((error as any).type === 'resolution_banned') {
            const bannedResolution = ((error as any).resolution || options.resolution || '').toUpperCase();
            const modelId = options.model || '';
            const banExpiry = Date.now() + 6 * 60 * 60 * 1000; // 默认6小时后过期
            setBannedResolutions(prev => {
              const modelBans = prev[modelId] || {};
              if (modelBans[bannedResolution]) return prev; // 已存在
              return { ...prev, [modelId]: { ...modelBans, [bannedResolution]: banExpiry } };
            });
            // 同时刷新后端熔断数据以获取精确的过期时间
            fetchCircuitBreakers();
          }
          
          // 调用外部错误回调
          options.onError?.(error);
        },
      });
      
      return result;
    } catch (error: any) {
      // ====== 细粒度熔断：RESOLUTION_BANNED 错误 → 按模型维度置灰该分辨率 ======
      if (error?.errorCode === 'RESOLUTION_BANNED') {
        const bannedResolution = (error.resolution || options.resolution || '').toUpperCase();
        const modelId = options.model || '';
        const banExpiry = Date.now() + 6 * 60 * 60 * 1000; // 默认6小时后过期
        setBannedResolutions(prev => {
          const modelBans = prev[modelId] || {};
          if (modelBans[bannedResolution]) return prev; // 已存在
          return { ...prev, [modelId]: { ...modelBans, [bannedResolution]: banExpiry } };
        });
        // 同时刷新后端熔断数据以获取精确的过期时间
        fetchCircuitBreakers();
        // 调用外部错误回调
        options.onError?.({
          type: 'resolution_banned',
          message: error.message || '当前分辨率暂时不可用，请换一个分辨率或稍后重试',
          taskId: options.taskId,
        });
        return { taskId: options.taskId || '', success: false, message: error.message };
      }
      // 其他错误重新抛出
      throw error;
    } finally {
      setIsGenerating(false);
    }
  }, [genService, userId, setCredits, isBanned]);

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
    referenceImageKeys?: string[];  // #840 参考图 COS key 数组
    referenceImageMd5s?: string[];  // #242 新增：参考图 MD5 数组
    resolution?: string;
    aspectRatio?: string;
    creditsCharged?: number;
    source?: 'canvas' | 'generate' | 'smart_split' | 'video' | 'regenerate';
  }) => {
    const { taskId, model, prompt, images, imageKeys, referenceImages, referenceImageKeys, referenceImageMd5s, resolution, aspectRatio, creditsCharged, source } = params;
    
    // 🔒 强制校验 + 过滤空字符串
    const filteredImages = images?.filter(url => url && url.length > 0) || [];

    if (filteredImages.length === 0) {
      return false;
    }
    
    // #245 过滤空字符串，确保存入数据库的是干净数据
    const filteredImageKeys = imageKeys?.filter(key => key && key.length > 0) || [];
    const filteredReferenceImages = referenceImages?.filter(url => url && url.length > 0) || [];
    const filteredReferenceImageKeys = referenceImageKeys?.filter(key => key && key.length > 0) || [];  // #840 参考图 keys 过滤
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
      reference_image_keys: filteredReferenceImageKeys,  // #840 保存参考图 COS keys
      reference_image_md5s: filteredReferenceImageMd5s,  // #242 新增：保存参考图 MD5
      resolution: resolution || '',
      aspect_ratio: aspectRatio || '',
      created_at: new Date().toISOString(),
      credits_charged: creditsCharged,
      source: source || 'generate',
    };
    
    // #237 修复：乐观更新先行（让用户立刻看到图）
    useHistoryStore.getState().addRecord(record);
    
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
          reference_image_keys: record.reference_image_keys,  // #840 保存参考图 COS keys
          reference_image_md5s: record.reference_image_md5s,  // #242 新增
          resolution: record.resolution,
          aspect_ratio: record.aspect_ratio,
          credits_charged: record.credits_charged,
          source: record.source,
          user_id: currentUserId,
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        console.warn(`[AIGeneratorContext] API 落库失败:`, result.error);
      }
      return true; // 前端已更新，返回 true
    } catch (error) {
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
    llmModelOptions, setLlmModelOptions,
    presetColors, setPresetColors,

    // 生成参数
    selectedRatio, setSelectedRatio,
    selectedResolution, setSelectedResolution,
    selectedAspectRatio, setSelectedAspectRatio,
    selectedCount, setSelectedCount,
    selectedDuration, setSelectedDuration,
    selectedQuality, setSelectedQuality,  // #523 T8Star 质量选项
    showRatioPicker, setShowRatioPicker,
    showResolutionPicker, setShowResolutionPicker,
    showAspectRatioPicker, setShowAspectRatioPicker,
    showCountPicker, setShowCountPicker,
    showDurationPicker, setShowDurationPicker,
    showQualityPicker, setShowQualityPicker,  // #523 T8Star 品质弹窗

    // #633 HappyHorse 模式切换
    hhOverrideMode, setHhOverrideMode,
    hhCurrentMode,  // 只读，由 useMemo 推导
    hhAudioSetting, setHhAudioSetting,
    // #634 视频输入状态
    chatVideoUrl, setChatVideoUrl,

    // 熔断状态
    bannedResolutions, setBannedResolutions,
    currentModelBannedResolutions,  // #878 当前模型被熔断的分辨率列表
    isResolutionBanned,  // #878 精确查询

    // 参考图
    chatImageBase64s, setChatImageBase64s,
    chatImageUrls, setChatImageUrls,
    chatImageMd5s, setChatImageMd5s,
    chatImageKeys, setChatImageKeys,
    chatImageNames, setChatImageNames,
    chatImageIds, setChatImageIds,  // #670 虚拟副本唯一标识
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
    authChecked,
    authModalOpen, setAuthModalOpen,
    authMode, setAuthMode,
    refreshUserInfo,

    // 违规计数状态
    failedAttempts, setFailedAttempts,
    FAILED_ATTEMPTS_THRESHOLD,
    // #504 禁用状态
    isBanned, setIsBanned,
    lockedUntil, setLockedUntil,
    showBannedDialog, setShowBannedDialog,

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
    selectedRatio, selectedResolution, selectedAspectRatio, selectedCount, selectedDuration, selectedQuality,
    showRatioPicker, showResolutionPicker, showAspectRatioPicker, showCountPicker, showDurationPicker, showQualityPicker,
    chatImageBase64s, chatImageUrls, chatImageMd5s, chatImageKeys, chatImageNames, chatImageIds,
    chatVideoUrl,
    bannedResolutions, currentModelBannedResolutions, isResolutionBanned,
    showFavoritesModal, favorites, newFavoriteContent, editingId, editingContent,
    inputValue, messages,
    credits, userId, isLoggedIn, authModalOpen, authMode, refreshUserInfo,
    failedAttempts,
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
