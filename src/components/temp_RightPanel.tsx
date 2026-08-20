/**
 * ============================================
 * Canvas/Editor RightPanel 组件
 * ============================================
 * 
 * 【重构最高宪法 - kiikii-me】
 * 1. 代码幂等性：所有 Props 命名必须完全参照原 page.tsx 的变量名
 * 2. 架构原子化：纯函数组件，禁止 useEffect/useState 控制全局 Canvas 状态
 * 3. 零容错合规：Props 命名与原代码严格一致，防止合并断裂
 * 4. 资源保护：禁止引入闭包内存泄漏、重复渲染逻辑
 * 
 * 【来源】page.tsx 右侧面板区域
 * - aside 主体：第5006-5523行
 * - 模型选择弹窗：第5526-5654行
 * - 比例/分辨率/数量/时长弹窗：第5656-5829行
 * - 智能分割弹窗：第5831-6265行
 * - 信息弹窗：第6267-6273行
 * - 图片预览弹窗：第6275-6296行
 * - 收藏弹窗：第6298-6409行
 * ============================================
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { X, Plus, Send, Loader2, Play, Video } from 'lucide-react';  // #048 新增 Loader2, #659 新增 Play, #662 新增 Video
import { InfoDialog } from '@/components/ui/info-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';
import { useViolationGuard } from '@/hooks/useViolationGuard';
import { deleteReferenceImage } from '@/lib/dialog-data-db';
import { toast } from 'sonner';
import { ModelModeSwitcher, type VideoModelMode, type Seedance2Mode, getHappyHorseModeParams, getSeedance2ModeParams, getT8SeedanceModeParams, getHappyHorseMaxRefImages, isTopaisVeoModel, getTopaisModeParams, isTopaisHhModel, getTopaisHhModeParams, isTopaisGeminiOmniModel, getTopaisGeminiOmniModeParams, isMegaAiSeedanceModel as isMegaAiSeedanceModelFn, getMegaAiSeedanceModeParams, isTopaisMinimaxModel as isTopaisMinimaxModelFn, getTopaisMinimaxModeParams, getTopaisMinimaxRatioStates, formatRatioLabel, getLingyaVeoModeParams, getLingyaSoraModeParams, isTopaisKlingOmniModel as isTopaisKlingOmniModelFn, getTopaisKlingOmniModeParams } from '@/components/ModelModeSwitcher';
import AudioUploader, { type AudioRef } from '@/components/AudioUploader';
import { getMaterialTypeLimits, getModelSupportedTypes, getModelMaxLimits } from '@/lib/effective-sources';
import { ModelDetector } from '@/lib/model-utils';
import { safeJsonResponse } from '@/lib/safe-json';

// 模型 logo 映射（与 GeneratePanelNode 一致）
const DIALOG_BANANA_LOGO = '/banana-logo.png';
const DIALOG_GPT_LOGO = '/gpt-image-2-logo.png';
const DIALOG_DEFAULT_LOGO = '/logo-main.png';
const DIALOG_SEEDANCE_LOGO = '/seedance-logo.png';
const DIALOG_VEO_LOGO = '/veo-logo.png';

function dialogGetModelLogo(modelId: string): string {
  const id = modelId.toLowerCase();
  const family = ModelDetector.getFamily(modelId);
  if (family === 'topais-gemini-omni') return '/gemini-logo.png';  // TOPAIS Gemini Omni Flash 专属 Logo
  if (id.includes('gemini')) return DIALOG_VEO_LOGO;
  if (id.includes('gpt-5')) return DIALOG_GPT_LOGO;
  if (['seedance2', 't8seedance', 'topais-seedance'].includes(family)) return DIALOG_SEEDANCE_LOGO;
  if (id.includes('veo')) return DIALOG_VEO_LOGO;
  if (id.includes('sora')) return DIALOG_GPT_LOGO;
  if (family === 'happyhorse') return '/happyhorse-logo.png';
  if (family === 'topais-happyhorse') return '/happyhorse-logo.png';  // #7xx TOPAIS HappyHorse 使用灵芽 Logo
  if (id.includes('banana')) return DIALOG_BANANA_LOGO;
  if (id.includes('gpt-image-2') || id.includes('gptimage2')) return DIALOG_GPT_LOGO;
  return DIALOG_DEFAULT_LOGO;
}

function dialogIsDarkLogo(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (id.includes('banana')) return false;
  return true;
}

// 分辨率 size 值到显示标签的映射
function formatResolutionDisplay(size: string): string {
  const s = size.toLowerCase().trim();
  if (s === 'small' || s === 'sm' || s === '480p') return '480P';
  if (s === 'medium' || s === 'md' || s === '720p') return '720P';
  if (s === 'large' || s === 'lg' || s === '1080p') return '1080P';
  if (s === 'xlarge' || s === 'xl' || s === '2k') return '2K';
  if (s === '4k') return '4K';
  if (s === '1k') return '1K';
  // 已经是 XXXP 格式的直接返回
  if (/^\d+[pPkK]$/.test(size)) return size.toUpperCase();
  return size;
}

// #515 CDN 配置：巨型图片使用外部 CDN 加速
// 用户上传到腾讯云 COS 后替换此环境变量
const GRID_ORIGINAL_URL = process.env.NEXT_PUBLIC_GRID_ORIGINAL_URL || '/grid-original.png';

// ============================================
// 【类型定义 - 与原 page.tsx 完全一致】
// ============================================

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  timestamp: number;  // 兼容 page.tsx 的实际类型（必填）
  // 发送到对话的元素信息
  elementId?: string;
  elementType?: string;
  elementSrc?: string;
  // 生成状态
  isGenerating?: boolean;
  // 用户消息的参考图和规格信息
  referenceImages?: string[]; // 参考图 base64 列表（用于显示）
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

interface ModelConfigItem {
  type: 'image' | 'video' | 'tool';
  resolutions?: Array<{ size: string; credits: number }>;
  aspectRatios?: string[];
  supportsDuration?: boolean;
  durations?: number[];  // 视频模型时长选项（从数据库解析为秒数数组）
  maxRefImages?: number;  // 视频模型最大参考图数量
  imageMode?: 'first_last_frame' | 'component_reference';  // 参考图模式
  supportsUpsample?: boolean;  // 是否支持1080P提升（Veo3.1-pro）
  showDuration?: boolean;  // 前端是否显示时长选择（Sora/Veo隐藏）
  showResolution?: boolean;  // 前端是否显示分辨率选择（Sora/Veo隐藏）
}

interface Favorite {
  id: number;
  content: string;
  sort_order: number;  // 兼容 page.tsx 的实际类型（必填）
  created_at?: string;
}

interface GridImage {
  imageUrl: string;
  imageKey: string;
  base64: string;
}

// 【Props 定义 - 简化版（约40个变量，其余从 Context 获取）】

export interface RightPanelProps {
  // ==================== 面板基础状态 ====================
  isRightPanelCollapsed: boolean;
  setIsRightPanelCollapsed: (v: boolean) => void;
  rightPanelWidth: number;
  setRightPanelWidth: (v: number) => void;
  isResizingPanel: boolean;
  setIsResizingPanel: (v: boolean) => void;
  panelResizeRef: React.MutableRefObject<{ startX: number; startWidth: number }>;
  
  // 功能折叠
  isFeaturesCollapsed: boolean;
  setIsFeaturesCollapsed: (v: boolean) => void;
  
  // ==================== 消息列表 ====================
  messageListRef: React.RefObject<HTMLDivElement | null>;
  clearMessages: () => void;
  
  // ==================== 参考图 ====================
  referenceImageInputRef: React.RefObject<HTMLInputElement | null>;
  chatCompressingCount?: number; // #826 压缩中骨架卡片数量
  
  // ==================== 视频 ====================
  videoInputRef: React.RefObject<HTMLInputElement | null>;
  isVideoUploading: boolean;
  setIsVideoUploading: (v: boolean) => void;
  
  // ==================== 模型相关 ====================
  formatModelName: (name: string) => string;
  
  // ==================== 生成参数配置 ====================
  aspectRatioOptions: string[];
  resolutionOptions: Array<{ size: string; credits: number }>;
  currentConfig: ModelConfigItem;
  selectedModel: string; // 当前选中的模型 ID
  
  // ==================== 收藏相关回调 ====================
  handleAddFavorite: () => void;
  handleUpdateFavorite: (id: number, content: string) => void;
  handleCopyContent: (content: string, id: number) => void;
  handleDeleteFavorite: (id: number) => void;
  
  // ==================== 配置 ====================
  canvasConfig: any[];
  
  // ==================== 核心功能函数 ====================
  handleToggleFeatures: () => void;
  handleSend: () => Promise<void>;
  handleSendToInput: (content: string) => void;
  showInfo: (title: string, description?: string) => void;
  
  // ==================== 智能分割 ====================
  showGridModal: boolean;
  setShowGridModal: (v: boolean) => void;
  gridLeftCollapsed: boolean;
  setGridLeftCollapsed: (v: boolean) => void;
  gridGenerating: boolean;
  setGridGenerating: (v: boolean) => void;
  gridUploading: boolean;
  setGridUploading: (v: boolean) => void;
  gridUploadedImages: GridImage[];
  setGridUploadedImages: (v: GridImage[]) => void;

  // #642 对话框 Seedance 2.0 音频文件同步回调
  onAudioFilesChange?: (files: AudioRef[]) => void;
  // #642 对话框 Seedance 2.0 音频生成开关同步回调
  onGenerateAudioChange?: (v: boolean) => void;
  gridSplitImages: string[];
  setGridSplitImages: (v: string[]) => void;
  gridSplitCount: number;
  setGridSplitCount: (v: number) => void;
  gridRemoveBorders: boolean;
  setGridRemoveBorders: (v: boolean) => void;
  isGridSelectMode: boolean;
  setIsGridSelectMode: (v: boolean) => void;
  gridSelectMousePos: { x: number; y: number };
  setGridSelectMousePos: (v: { x: number; y: number }) => void;
  loadGridTemplate: () => Promise<void>;
  handleAddSplitImagesToCanvas: (splitImages: string[]) => Promise<void>;
  compressBase64IfNeeded: (base64: string) => Promise<string>;
  imageUrlToBase64: (url: string) => Promise<string>;
  cropImageByCells: (base64: string, cells: any[], needCrop: boolean) => Promise<string[]>;
  
  // ==================== 画布上下文 ====================
  canvas: any;
  isCropping: boolean;
}

// ============================================
// 【宽高比图标组件】
// ============================================

function AspectRatioIcon({ ratio, selected }: { ratio: string; selected?: boolean }) {
  const getDimensions = (ratio: string): { w: number; h: number } => {
    switch (ratio) {
      case '1:1': return { w: 12, h: 12 };
      case '3:4': return { w: 9, h: 12 };
      case '4:3': return { w: 12, h: 9 };
      case '9:16': return { w: 7, h: 12 };
      case '16:9': return { w: 12, h: 7 };
      case '2:3': return { w: 8, h: 12 };
      case '3:2': return { w: 12, h: 8 };
      case '4:5': return { w: 10, h: 12 };
      case '5:4': return { w: 12, h: 10 };
      case '21:9': return { w: 14, h: 6 };
      case '9:21': return { w: 6, h: 14 };
      case '1:4': return { w: 4, h: 14 };
      case '4:1': return { w: 14, h: 4 };
      case '1:8': return { w: 3, h: 16 };
      case '8:1': return { w: 16, h: 3 };
      case '3:1': return { w: 14, h: 5 };
      case '1:3': return { w: 5, h: 14 };
      case '2:1': return { w: 14, h: 7 };
      case '1:2': return { w: 7, h: 14 };
      default: return { w: 10, h: 10 };
    }
  };

  const { w, h } = getDimensions(ratio);
  const scale = 14 / Math.max(w, h);
  const scaledW = w * scale;
  const scaledH = h * scale;

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
      <rect
        x={(16 - scaledW) / 2}
        y={(16 - scaledH) / 2}
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

// ============================================
// 【组件实现】
// ============================================

const RightPanel: React.FC<RightPanelProps> = (props) => {
  // 使用 AIGenerator Context 获取状态
  const aiState = useAIGenerator();
  
  // #318 新增：拖拽排序交互状态
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ type: 'image' | 'video'; src: string; rect: DOMRect } | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  
  // #469 复制提示词功能：跟踪哪个消息显示"已复制"提示
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  
  // #469 复制提示词处理函数
  const handleCopyPrompt = useCallback((messageId: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedMessageId(messageId);
      setTimeout(() => {
        setCopiedMessageId(null);
      }, 1500);
    });
  }, []);
  
  // #435 新增：收起面板提示文案状态（初始显示，鼠标移入再移出后隐藏）
  // #441 修改：ref类型改为HTMLButtonElement（文字和按钮合并）
  const [showCollapseTip, setShowCollapseTip] = useState(true);
  const collapseTipRef = useRef<HTMLButtonElement>(null);
  const hasEnteredTipRef = useRef(false);
  
  // 解构违规计数状态（用于警告提示）
  // #505 使用 useViolationGuard Hook 管理弹窗状态
  const { failedAttempts, FAILED_ATTEMPTS_THRESHOLD, isBanned, lockedUntil, showBannedDialog, setShowBannedDialog } = aiState;
  
  // #892 鉴权：从 Context 获取登录状态和弹窗控制
  const isLoggedInRef = aiState.isLoggedIn;
  const setAuthModalOpenRef = aiState.setAuthModalOpen;
  
  const {
    showViolationWarning,
    setShowViolationWarning,
    showBannedDialog: bannedDialogVisible,
    setShowBannedDialog: setBannedDialogVisible,
    bannedRemainingMinutes,
  } = useViolationGuard(failedAttempts, isBanned, lockedUntil);
  
  // 禁用弹窗的显示逻辑由 Hook 管理，但 Context 的 showBannedDialog 也需要同步
  // 优先使用 Hook 的状态
  const effectiveShowBannedDialog = bannedDialogVisible;
  
  // 解构所有 props，确保变量名与原代码 100% 一致
  const {
    // 面板状态
    isRightPanelCollapsed, setIsRightPanelCollapsed,
    rightPanelWidth, setRightPanelWidth,
    isResizingPanel, setIsResizingPanel, panelResizeRef,
    isFeaturesCollapsed, setIsFeaturesCollapsed,
    
    // 消息列表
    messageListRef, clearMessages,
    
    // 参考图
    referenceImageInputRef,
    chatCompressingCount,
    
    // 视频
    videoInputRef,
    isVideoUploading,
    setIsVideoUploading,
    
    // 模型
    formatModelName,
    
    // 生成参数
    aspectRatioOptions, resolutionOptions, currentConfig,
    
    // 收藏回调
    handleAddFavorite, handleUpdateFavorite,
    handleCopyContent, handleDeleteFavorite,
    
    // 配置
    canvasConfig,
    
    // 核心函数
    handleToggleFeatures, handleSend, handleSendToInput, showInfo,
    
    // 智能分割
    showGridModal, setShowGridModal,
    gridLeftCollapsed, setGridLeftCollapsed,
    gridGenerating, setGridGenerating,
    gridUploading, setGridUploading,
    gridUploadedImages, setGridUploadedImages,
    gridSplitImages, setGridSplitImages,
    gridSplitCount, setGridSplitCount,
    gridRemoveBorders, setGridRemoveBorders,
    isGridSelectMode, setIsGridSelectMode,
    gridSelectMousePos, setGridSelectMousePos,
    loadGridTemplate, handleAddSplitImagesToCanvas,
    compressBase64IfNeeded, imageUrlToBase64, cropImageByCells,
    
    // #642 音频同步回调
    onAudioFilesChange,
    onGenerateAudioChange,
    
    // 画布
    canvas, isCropping,
  } = props;
  
  // 分割功能 - 本地上传文件输入框
  const gridFileInputRef = React.useRef<HTMLInputElement>(null);
  
  // ==================== 请求锁：防止并发上传轰炸 ====================
  const gridUploadingRef = React.useRef(false);
  
  // 处理本地上传文件 - 分割功能只需要本地 base64，无需上传 COS
  const handleGridFileUpload = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // ==================== 请求锁检查 ====================
    if (gridUploadingRef.current) {
      console.warn('[智能分割上传] 正在上传中，忽略重复请求');
      return;
    }
    gridUploadingRef.current = true;
    setGridUploading(true); // #127 显示上传加载状态
    
    // 文件大小检查（前端预检，最大 5MB）
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      console.warn('[智能分割上传] 文件过大:', (file.size / 1024 / 1024).toFixed(2) + 'MB');
      // 仍然允许上传，只是警告
    }
    
    const startTime = Date.now();
    
    // 🔧 #139 优化：分割功能只需要本地 base64，无需上传 COS
    // 直接转换为 base64 即可，瞬间完成
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      if (base64) {
        console.log('[智能分割上传] 本地转换完成:', {
          duration: Date.now() - startTime + 'ms',
          base64Length: base64.length,
        });
        
        // 直接使用本地 base64，无需上传 COS
        setGridUploadedImages([{
          imageUrl: '', // 不需要 URL，分割使用 base64
          imageKey: '',
          base64: base64
        }]);
        
        gridUploadingRef.current = false;
        setGridUploading(false);
      } else {
        gridUploadingRef.current = false;
        setGridUploading(false);
      }
    };
    reader.onerror = () => {
      gridUploadingRef.current = false;
      setGridUploading(false);
    };
    reader.readAsDataURL(file);
    
    // 重置 input 以便可以重复选择同一文件
    e.target.value = '';
  }, [setGridUploadedImages, setGridUploading]);
  
  // 从 Context 获取的状态（替代 Props）
  const {
    messages, setMessages,
    inputValue, setInputValue,
    chatImageBase64s, setChatImageBase64s,
    chatImageUrls, setChatImageUrls,
    chatImageMd5s, setChatImageMd5s,
    chatImageKeys, setChatImageKeys,
    chatImageNames, setChatImageNames,
    chatImageIds, setChatImageIds,  // #670 虚拟副本唯一标识
    chatUploadingMd5s,  // #048 新增：追踪正在上传的参考图
    selectedModel, setSelectedModel,
    showModelPicker, setShowModelPicker,
    modelTab, setModelTab,
    modelConfig, setModelConfig,
    modelDisplayNames, setModelDisplayNames,
    modelStatuses, setModelStatuses,
    modelActiveStatus, setModelActiveStatus,
    imageModelOptions, setImageModelOptions,
    videoModelOptions, setVideoModelOptions,
    selectedRatio, setSelectedRatio,
    selectedResolution, setSelectedResolution,
    selectedQuality, setSelectedQuality,
    selectedAspectRatio, setSelectedAspectRatio,
    selectedCount, setSelectedCount,
    selectedDuration, setSelectedDuration,
    showRatioPicker, setShowRatioPicker,
    showResolutionPicker, setShowResolutionPicker,
    showAspectRatioPicker, setShowAspectRatioPicker,
    showCountPicker, setShowCountPicker,
    showDurationPicker, setShowDurationPicker,
    showQualityPicker, setShowQualityPicker,  // #523 T8Star 品质弹窗
    bannedResolutions,  // #878 精细化模型维度熔断
    currentModelBannedResolutions,
    isResolutionBanned,
    credits, setCredits,
    showFavoritesModal, setShowFavoritesModal,
    newFavoriteContent, setNewFavoriteContent,
    editingId, setEditingId,
    editingContent, setEditingContent,
    favorites, setFavorites,
    previewImage, setPreviewImage,
    infoDialog, setInfoDialog,
  } = aiState;

  // #633 HappyHorse 模式切换状态（从 Context 获取，与 page.tsx 共享）
  // hhCurrentMode 由 Context 通过 useMemo 推导，无需 setter
  const {
    hhOverrideMode, setHhOverrideMode,
    hhCurrentMode,
    hhAudioSetting, setHhAudioSetting,
    // #636 视频输入状态
    chatVideoUrl, setChatVideoUrl,
  } = aiState;
  // #663 统一使用 ModelDetector.getFamily() 判断模型
  const _dialogFamily = ModelDetector.getFamily(selectedModel);
  const isHappyHorseModel = _dialogFamily === 'happyhorse';
  const isSeedance2Model = _dialogFamily === 'seedance2';
  const isT8SeedanceModel = _dialogFamily === 't8seedance';
  const isTopaisModel = _dialogFamily === 'topais';  // #689 TOPAIS Veo
  const isTopaisHhModel = _dialogFamily === 'topais-happyhorse';  // #7xx TOPAIS HappyHorse
  const isTopaisSeedanceModel = _dialogFamily === 'topais-seedance';  // TOPAIS Seedance 2.0
  const isTopaisGeminiOmniModel = _dialogFamily === 'topais-gemini-omni';  // TOPAIS Gemini Omni Flash
  const isLingyaVeoModel = _dialogFamily === 'lingya-veo';  // LingYa Veo3.1
  const isLingyaSoraModel = _dialogFamily === 'lingya-sora';  // LingYa Sora-2
  const isMegaAiSeedanceModel = _dialogFamily === 'mega-ai-seedance';  // MEGA AI Seedance 2.0
  const isTopaisMinimaxModel = _dialogFamily === 'topais-minimax';  // TOPAIS MiniMax-H3
  const isTopaisKlingOmniModel = _dialogFamily === 'topais-kling-omni';  // TOPAIS Kling v3 Omni
  const isModeSwitchModel = isHappyHorseModel || isSeedance2Model || isT8SeedanceModel || isTopaisModel || isTopaisHhModel || isTopaisSeedanceModel || isTopaisGeminiOmniModel || isLingyaVeoModel || isLingyaSoraModel || isMegaAiSeedanceModel || isTopaisMinimaxModel || isTopaisKlingOmniModel;
  // #641 Seedance 2.0 参考视频/音频状态
  const [dialogRefVideoUrls, setDialogRefVideoUrls] = useState<string[]>([]);
  const [dialogRefAudioFiles, setDialogRefAudioFiles] = useState<AudioRef[]>([]);
  const dialogRefVideoInputRef = useRef<HTMLInputElement>(null);
  const dialogRefAudioInputRef = useRef<HTMLInputElement>(null); // #646 对话框音频上传
  const [dialogGenerateAudio, setDialogGenerateAudio] = useState(true); // #642 Seedance 2.0 音频生成开关
  // #7xx 视频预览弹窗状态
  const [previewVideo, setPreviewVideo] = useState<string | null>(null);

  // #M7 修复：追踪视频blob URL，组件卸载时释放
  const dialogRefVideoUrlsRef = useRef(dialogRefVideoUrls);
  dialogRefVideoUrlsRef.current = dialogRefVideoUrls;
  const chatVideoUrlRef = useRef(chatVideoUrl);
  chatVideoUrlRef.current = chatVideoUrl;
  useEffect(() => {
    return () => {
      // 组件卸载时释放所有残留的blob URL
      dialogRefVideoUrlsRef.current.forEach(url => {
        if (url.startsWith('blob:')) {
          try { URL.revokeObjectURL(url); } catch {}
        }
      });
      if (chatVideoUrlRef.current?.startsWith('blob:')) {
        try { URL.revokeObjectURL(chatVideoUrlRef.current); } catch {}
      }
    };
  }, []);

  // #M5 修复：面板拖拽resize事件监听器，组件卸载时兜底清理
  const panelDragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      if (panelDragCleanupRef.current) {
        panelDragCleanupRef.current();
        panelDragCleanupRef.current = null;
      }
    };
  }, []);

  // #866 修复：MiniMax 模式切换时，自动切换被禁用的比例
  // 当从 i2v-first-last-frame（adaptive 可选）切换到 t2v（adaptive 禁用）时，
  // 自动将 selectedRatio 切换到第一个可用比例
  const prevMinimaxModeRef = useRef<VideoModelMode | null>(null);
  useEffect(() => {
    if (!isTopaisMinimaxModel || !aspectRatioOptions.length) return;
    const prevMode = prevMinimaxModeRef.current;
    prevMinimaxModeRef.current = hhCurrentMode;
    if (prevMode === null || prevMode === hhCurrentMode) return;
    // 模式发生变化，检查当前比例是否被禁用
    const ratioStates = getTopaisMinimaxRatioStates(hhCurrentMode, aspectRatioOptions);
    const currentRatioState = ratioStates.find(rs => rs.ratio === selectedRatio);
    if (currentRatioState?.disabled) {
      // 当前比例被禁用，自动切换到第一个可用比例
      const firstEnabled = ratioStates.find(rs => !rs.disabled);
      if (firstEnabled) {
        console.log('[#866] MiniMax 模式切换', prevMode, '->', hhCurrentMode, '比例', selectedRatio, '->', firstEnabled.ratio);
        setSelectedRatio(firstEnabled.ratio);
      }
    }
  }, [hhCurrentMode, isTopaisMinimaxModel, aspectRatioOptions, selectedRatio, setSelectedRatio]);

  // #635 统一：使用模式参数函数判断各模式参数可见性
  const hhParams = isModeSwitchModel
    ? isTopaisMinimaxModel
      ? getTopaisMinimaxModeParams(hhCurrentMode)  // TOPAIS MiniMax-H3
      : isTopaisKlingOmniModel
        ? getTopaisKlingOmniModeParams(hhCurrentMode)  // TOPAIS Kling v3 Omni
        : isMegaAiSeedanceModel
      ? getMegaAiSeedanceModeParams(hhCurrentMode)  // MEGA AI Seedance 2.0
      : isLingyaSoraModel
        ? getLingyaSoraModeParams(hhCurrentMode)  // LingYa Sora-2
        : isLingyaVeoModel
          ? getLingyaVeoModeParams(hhCurrentMode)  // LingYa Veo3.1
          : isTopaisHhModel
            ? getTopaisHhModeParams(hhCurrentMode)  // #7xx TOPAIS HappyHorse
            : isTopaisSeedanceModel
              ? getSeedance2ModeParams(hhCurrentMode as Seedance2Mode)  // TOPAIS Seedance 2.0 (复用 Seedance 2.0 参数配置)
              : isTopaisGeminiOmniModel
                ? getTopaisGeminiOmniModeParams(hhCurrentMode)  // TOPAIS Gemini Omni Flash
                : isTopaisModel
                  ? getTopaisModeParams(hhCurrentMode)  // #689 TOPAIS
                  : isSeedance2Model
                    ? getSeedance2ModeParams(hhCurrentMode as Seedance2Mode)
                    : isT8SeedanceModel
                      ? getT8SeedanceModeParams(hhCurrentMode)
                      : getHappyHorseModeParams(hhCurrentMode)
    : null;

  return (
    <>
      {/* 右侧AI面板 - 裁剪模式下禁用 */}
      <aside 
        className={`bg-white dark:bg-gray-800 flex flex-col shrink-0 relative canvas-area-cursor ${isRightPanelCollapsed ? 'w-12' : ''}`}
        style={{ 
          width: isRightPanelCollapsed ? 48 : rightPanelWidth,
          boxShadow: '-2px 0 10px rgba(0,0,0,0.08)',
          borderRadius: '12px',
          margin: '12px 10px 12px 0',
          pointerEvents: isCropping ? 'none' : 'auto',
          transition: 'width 300ms cubic-bezier(0.4, 0, 0.2, 1)'
        }}
        onClick={() => {
          canvas.clearSelection();
        }}
      >
        {/* 左侧拖拽手柄 */}
        {!isRightPanelCollapsed && (
          <div 
            className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-200 transition-colors z-20"
            style={{ marginLeft: -4 }}
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizingPanel(true);
              panelResizeRef.current = { startX: e.clientX, startWidth: rightPanelWidth };
              
              const handleMouseMove = (e: MouseEvent) => {
                const delta = panelResizeRef.current.startX - e.clientX;
                const newWidth = Math.max(250, Math.min(600, panelResizeRef.current.startWidth + delta));
                setRightPanelWidth(newWidth);
              };
              
              const handleMouseUp = () => {
                setIsResizingPanel(false);
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                panelDragCleanupRef.current = null;  // #M5 清理追踪
              };
              
              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);
              // #M5 修复：存储清理函数，卸载时兜底
              panelDragCleanupRef.current = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
              };
            }}
          />
        )}
        {/* 收起按钮 - 右上角 */}
        {/* #441 修改：文字和按钮合并，整体呼吸效果，移出后只保留箭头 */}
        <button
          ref={collapseTipRef}
          onClick={() => setIsRightPanelCollapsed(!isRightPanelCollapsed)}
          className={`absolute top-3 right-3 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-all z-10 text-gray-600 dark:text-gray-300 ${
            showCollapseTip && !isRightPanelCollapsed ? 'px-3 gap-2' : 'w-8'
          }`}
          style={showCollapseTip && !isRightPanelCollapsed ? { animation: 'tip-breathe 2s ease-in-out infinite' } : undefined}
          title={isRightPanelCollapsed ? '展开面板' : '收起面板'}
          onMouseEnter={() => {
            hasEnteredTipRef.current = true;
          }}
          onMouseLeave={() => {
            if (hasEnteredTipRef.current && showCollapseTip && !isRightPanelCollapsed) {
              setShowCollapseTip(false);
            }
          }}
        >
          {showCollapseTip && !isRightPanelCollapsed && (
            <span className="text-xs font-medium">收起面板</span>
          )}
          <svg 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            style={{ transform: isRightPanelCollapsed ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        
        {!isRightPanelCollapsed && (
          <>
            {/* 功能组件折叠按钮 - 左上角 */}
            <button
              onClick={handleToggleFeatures}
              className="absolute top-3 left-3 w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors z-10 text-gray-600 dark:text-gray-300"
              title={isFeaturesCollapsed ? '展开功能面板' : '收起功能面板'}
            >
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2"
                style={{ transform: isFeaturesCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.3s' }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            
            {/* 顶部操作栏 */}
            <div className="flex justify-end items-center gap-4 pt-4 mb-6">
              <span className="w-5 h-5" />
              <span className="w-5 h-5" />
              <span className="w-5 h-5" />
              <span className="w-5 h-5" />
              <span className="w-5 h-5" />
            </div>

            {/* 消息列表 - 支持鼠标滚轮，隐藏滚动条 */}
        <div ref={messageListRef} className="flex-1 overflow-y-auto px-4 min-h-0 hide-scrollbar">
          {/* 功能组件 - 可折叠 */}
          {!isFeaturesCollapsed && (
            <>
              {/* 欢迎区域 - 使用数据库配置 */}
              <div className="mb-4">
                <span className="block w-6 h-2 mb-1" />
                {canvasConfig.filter(c => c.config_type === 'welcome_message').length > 0 ? (
                  canvasConfig
                    .filter(c => c.config_type === 'welcome_message')
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map(config => (
                      <div key={config.id}>
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">{config.title}</h2>
                        {config.content && (
                          <p className="text-base text-gray-500 dark:text-gray-400">{config.content}</p>
                        )}
                      </div>
                    ))
                ) : (
                  <>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">Hi，我是你的AI设计师</h2>
                    <p className="text-base text-gray-500 dark:text-gray-400">让我们开始今天的创作吧！</p>
                  </>
                )}
              </div>

              {/* 推荐模板列表 */}
              <div className="flex flex-col gap-3 mb-6">
          {canvasConfig
            .filter(c => c.config_type === 'tool_component' && c.is_enabled)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map(config => {
              const specialType = config.extra_data?.special_type;
              
              if (specialType === 'smart_grid') {
                return (
                  <div 
                    key={config.id}
                    className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    onClick={loadGridTemplate}
                  >
                    <div className="flex justify-between items-start gap-3 mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{config.title}</div>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{config.content}</div>
                      </div>
                    </div>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1 max-w-[140px] rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700">
                        <Image
                          src={GRID_ORIGINAL_URL}
                          alt="原图"
                          width={140}
                          height={100}
                          className="w-full h-auto"
                          loading="lazy"
                        />
                      </div>
                      <div className="text-gray-400 dark:text-gray-500 text-lg pb-2">→</div>
                      <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700">
                        <Image
                          src="/grid-1.png"
                          alt="分割1"
                          width={80}
                          height={80}
                          className="w-auto h-auto max-h-20"
                          loading="lazy"
                        />
                      </div>
                      <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700">
                        <Image
                          src="/grid-2.png"
                          alt="分割2"
                          width={80}
                          height={80}
                          className="w-auto h-auto max-h-20"
                          loading="lazy"
                        />
                      </div>
                      <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700">
                        <Image
                          src="/分镜_3x3_8.png"
                          alt="分镜8"
                          width={80}
                          height={80}
                          className="w-auto h-auto max-h-20"
                          loading="lazy"
                        />
                      </div>
                    </div>
                  </div>
                );
              }
              
              if (specialType === 'film_storyboard') {
                return (
                  <div
                    key={config.id}
                    className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-xl gap-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    onClick={() => showInfo(config.title || '功能', config.content || '敬请期待')}
                  >
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900 dark:text-white mb-1.5">{config.title}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">{config.content}</div>
                    </div>
                    <div className="w-[100px] h-[70px] shrink-0 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 bg-gradient-to-br from-amber-50 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/30 flex items-center justify-center">
                      <div className="grid grid-cols-3 gap-0.5 p-1.5">
                        {[...Array(9)].map((_, i) => (
                          <div key={i} className="w-4 h-4 bg-white/70 dark:bg-gray-600/70 rounded-sm"></div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }
              
              if (specialType === 'longcat') {
                return (
                  <div 
                    key={config.id}
                    className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-xl gap-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900 dark:text-white mb-1.5">{config.title}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">{config.content}</div>
                    </div>
                    <div className="w-[100px] h-[70px] shrink-0 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 bg-gradient-to-br from-violet-50 to-purple-100 dark:from-violet-900/30 dark:to-purple-900/30 flex items-center justify-center">
                      <div className="flex items-center gap-1.5">
                        <div className="w-6 h-6 bg-white/60 dark:bg-gray-600/60 rounded border border-gray-300 dark:border-gray-500 flex items-center justify-center">
                          <span className="text-[8px] text-gray-400 dark:text-gray-400">SD</span>
                        </div>
                        <svg className="w-4 h-4 text-violet-500 dark:text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                        <div className="w-10 h-10 bg-white/80 dark:bg-gray-500/80 rounded border border-violet-300 dark:border-violet-500 flex items-center justify-center shadow-sm">
                          <span className="text-[10px] font-medium text-violet-600 dark:text-violet-300">HD</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }
              
              return (
                <div 
                  key={config.id}
                  className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-xl gap-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  onClick={() => showInfo(config.title || '功能', config.content)}
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900 dark:text-white mb-1.5">{config.title}</div>
                    {config.content && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">{config.content}</div>
                    )}
                  </div>
                </div>
              );
            })}
              
              {canvasConfig.filter(c => c.config_type === 'feature_toggle' && c.is_enabled).length > 0 && (
                <div className="flex flex-col gap-3 mb-6">
                  {canvasConfig
                    .filter(c => c.config_type === 'feature_toggle' && c.is_enabled)
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map(config => (
                      <div 
                        key={config.id}
                        className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-xl gap-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        onClick={() => showInfo(config.title || '功能', config.content)}
                      >
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-900 dark:text-white mb-1.5">{config.title}</div>
                          {config.content && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">{config.content}</div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}
              
              </div>
            </>
          )}
          
          {messages.length > 0 && (
          <div className="space-y-2 pb-4">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-xl px-3 py-2 ${msg.role === 'user' ? 'bg-gray-900 dark:bg-gray-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'}`}>
                    <div className="flex items-start gap-1.5">
                      {msg.role === 'user' && (
                        <button
                          onClick={() => handleCopyPrompt(msg.id, msg.content)}
                          className="flex-shrink-0 p-0.5 rounded hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors relative mt-0.5"
                          title="Copy prompt"
                        >
                          <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          {copiedMessageId === msg.id && (
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] bg-gray-800 text-white rounded whitespace-nowrap">
                              Copied
                            </span>
                          )}
                        </button>
                      )}
                      <div className="text-xs leading-relaxed">
                        {/* #655 视频占位符：显示进度环 */}
                        {(msg as any).isVideoPlaceholder ? (
                          <div className="flex items-center gap-2 py-1">
                            <div className="relative w-8 h-8 flex-shrink-0">
                              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                                <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-200 dark:text-gray-600" />
                                <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                                  className="text-blue-500 dark:text-blue-400 transition-all duration-300"
                                  strokeDasharray={`${((msg as any).videoProgress || 0) * 0.942} 94.2`}
                                />
                              </svg>
                              <span className="absolute inset-0 flex items-center justify-center text-[8px] font-medium">
                                {(msg as any).videoProgress || 0}%
                              </span>
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400">{msg.content}</span>
                          </div>
                        ) : (msg as any).videoUrl ? (
                          /* #655 视频完成：显示缩略图 + 播放按钮 */
                          /* #728 恢复：直接用 video 标签显示视频第一帧作为缩略图（用户偏好） */
                          <div className="mt-1">
                            <div className="relative group cursor-pointer rounded-lg overflow-hidden" onClick={() => {
                              const v = (msg as any).videoUrl;
                              if (v) setPreviewVideo(v);
                            }}>
                              {/* 直接用 video 标签显示视频第一帧作为缩略图 */}
                              <video
                                src={(msg as any).videoUrl}
                                className="w-full max-w-[240px] rounded-lg object-cover bg-gray-800"
                                muted
                                playsInline
                                preload="metadata"
                              />
                              {/* 播放按钮覆盖层 */}
                              <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
                                <div className="w-8 h-8 rounded-full bg-white/80 flex items-center justify-center">
                                  <svg className="w-4 h-4 text-gray-800 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z" />
                                  </svg>
                                </div>
                              </div>
                            </div>
                            <div className="text-[10px] text-gray-400 mt-1">点击播放视频</div>
                          </div>
                        ) : (
                          msg.content
                        )}
                      </div>
                    </div>
                    
                    {msg.role === 'user' && msg.referenceImages && msg.referenceImages.length > 0 && (
                      <div className="flex gap-1 mt-2 pt-2 border-t border-gray-700 dark:border-gray-600">
                        {msg.referenceImages.map((img, idx) => (
                          <img 
                            key={idx} 
                            src={img} 
                            alt={`参考图${idx + 1}`}
                            className="w-8 h-8 object-cover rounded border border-gray-600 cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => setPreviewImage(img)}
                            referrerPolicy="no-referrer-when-downgrade"
                          />
                        ))}
                      </div>
                    )}
                    
                    {msg.role === 'user' && msg.specs && (
                      <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-700 dark:border-gray-600">
                        <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 dark:bg-gray-600 rounded text-gray-300">{msg.specs.model}</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 dark:bg-gray-600 rounded text-gray-300">{msg.specs.ratio}</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 dark:bg-gray-600 rounded text-gray-300">{msg.specs.resolution}</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 dark:bg-gray-600 rounded text-gray-300">{msg.specs.count}张</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部输入区域 */}
        {/* #893 防御性拦截：阻止浏览器默认的文件拖放行为（防止拖入文件导致页面跳转） */}
        <div className="sticky bottom-0 bg-white dark:bg-gray-800 px-4 pb-4 pt-2 rounded-b-xl relative"
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); }}
        >
          {/* 收藏按钮 + 清除对话按钮（收藏始终显示，清除仅在有消息时显示） */}
          <div className="absolute -top-1 right-4 -translate-y-1/2 flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={() => {
                  setMessages([]);
                  clearMessages();
                  console.log('[Canvas Dialog] 已清除对话内容');
                }}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors bg-white dark:bg-gray-800"
                title="清除对话内容"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                清除对话
              </button>
            )}
            <button
              onClick={() => setShowFavoritesModal(true)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded transition-colors bg-white dark:bg-gray-800"
              title="提示词收藏"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              收藏
            </button>
          </div>
          <div className="border border-gray-200 dark:border-gray-600 rounded-xl p-3 relative">
            <textarea 
              className="w-full text-gray-900 dark:text-white text-sm resize-none outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500 overflow-y-auto bg-transparent [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full dark:[&::-webkit-scrollbar-thumb]:bg-gray-600"
              placeholder="请输入你的设计需求"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
              }}
              style={{ minHeight: '60px', maxHeight: '200px' }}
            />
          </div>
          
          <div className="flex gap-2 px-1 pt-2 flex-wrap">
            {chatImageBase64s.map((base64, index) => {
              // #815 修复：跳过空 base64，避免 img src="" 破图
              if (!base64 || base64.length === 0) return null;
              // #318 计算拖拽位移
              let transform = 'scale(1)';
              let transition = 'transform 0.15s ease';
              let borderStyle = '1px solid #e5e7eb';
              
              if (dragIndex !== null && dragOverIndex !== null && dragIndex !== index) {
                if (dragOverIndex === index) {
                  // 当前元素是悬停目标
                  const offset = dragIndex < index ? -8 : 8;
                  transform = `translateX(${offset}px) scale(1.05)`;
                  borderStyle = '2px solid #60a5fa';
                } else if (
                  (dragIndex < index && dragOverIndex > index) ||
                  (dragIndex > index && dragOverIndex < index)
                ) {
                  const offset = dragIndex < index ? 8 : -8;
                  transform = `translateX(${offset}px)`;
                }
              }
              
              if (dragIndex === index) {
                transform = 'scale(0.9)';
                transition = 'transform 0.1s ease, opacity 0.1s ease';
              }
              
              return (
                <div 
                  key={chatImageIds[index] || index}   // #670 虚拟副本：用唯一 ID 作 key（替代 md5，避免重复图片 key 冲突）
                  className="relative group"
                  style={{
                    cursor: 'grab',
                    transform,
                    transition,
                    // #664 修复：生图模型使用 getModelMaxLimits，视频模型使用 getMaterialTypeLimits
                    opacity: dragIndex === index ? 0.5 : (() => {
                      const limits = isModeSwitchModel
                        ? getMaterialTypeLimits(hhCurrentMode, selectedModel)
                        : getModelMaxLimits(selectedModel);
                      return index >= limits.image ? 0.35 : 1;
                    })(),
                  }}
                  draggable
                  onDragStart={(e) => {
                    // #318 关键修复：设置自定义拖拽图像，确保样式正确显示
                    const dragImage = e.currentTarget.querySelector('img') as HTMLElement;
                    if (dragImage) {
                      // 创建一个半透明的克隆图像作为拖拽预览
                      const rect = dragImage.getBoundingClientRect();
                      e.dataTransfer.setDragImage(dragImage, rect.width / 2, rect.height / 2);
                    }
                    e.dataTransfer.setData('text/plain', index.toString());
                    // 延迟设置状态，让拖拽图像先被捕获
                    requestAnimationFrame(() => {
                      setDragIndex(index);
                    });
                    e.stopPropagation();
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverIndex !== index) {
                      setDragOverIndex(index);
                    }
                    e.stopPropagation();
                  }}
                  onDragLeave={() => {
                    setDragOverIndex(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const dragIdx = parseInt(e.dataTransfer.getData('text/plain'));
                    if (dragIdx !== index) {
                      // 交换所有数组中的对应元素
                      const reorderArray = <T,>(arr: T[], from: number, to: number): T[] => {
                        const newArr = [...arr];
                        const [removed] = newArr.splice(from, 1);
                        newArr.splice(to, 0, removed);
                        return newArr;
                      };
                      
                      setChatImageBase64s(prev => reorderArray(prev, dragIdx, index));
                      setChatImageUrls(prev => reorderArray(prev, dragIdx, index));
                      setChatImageKeys(prev => reorderArray(prev, dragIdx, index));
                      setChatImageMd5s(prev => reorderArray(prev, dragIdx, index));
                      setChatImageNames(prev => reorderArray(prev, dragIdx, index));
                      setChatImageIds(prev => reorderArray(prev, dragIdx, index));  // #670 虚拟副本：同步重排唯一标识
                    }
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                >
                  <img 
                    src={base64} 
                    alt={chatImageNames[index]} 
                    className="w-12 h-12 object-cover rounded-lg cursor-pointer hover:opacity-80"
                    style={{ border: borderStyle }}
                    onClick={() => setPreviewImage(base64)}
                    onMouseEnter={(e) => {
                      if (dragIndex !== null) return;
                      setHoverPreview({ type: 'image', src: base64, rect: e.currentTarget.getBoundingClientRect() });
                    }}
                    onMouseLeave={() => setHoverPreview(null)}
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                  {/* #048 新增：上传中显示加载转圈 */}
                  {chatImageMd5s[index] && chatUploadingMd5s.has(chatImageMd5s[index]) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                    </div>
                  )}
                  <button 
                    className="absolute -top-1 -right-1 w-4 h-4 bg-gray-900 dark:bg-gray-600 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const md5ToDelete = chatImageMd5s[index];
                      try {
                        await deleteReferenceImage(md5ToDelete);
                        console.log('[Canvas Dialog] 已从数据库删除参考图:', md5ToDelete.slice(0, 8));
                      } catch (e) {
                        console.warn('[Canvas Dialog] 从 IndexedDB 删除参考图失败:', e);
                      }
                      
                      setChatImageBase64s(prev => prev.filter((_, i) => i !== index));
                      setChatImageUrls(prev => prev.filter((_, i) => i !== index));
                      setChatImageKeys(prev => prev.filter((_, i) => i !== index));
                      setChatImageMd5s(prev => prev.filter((_, i) => i !== index));
                      setChatImageNames(prev => prev.filter((_, i) => i !== index));
                      setChatImageIds(prev => prev.filter((_, i) => i !== index));  // #670 虚拟副本：同步删除唯一标识
                      // #657 修复：删除素材时同步清除手动覆盖，恢复自动推断
                      setHhOverrideMode(null);
                      localStorage.removeItem('dialog-hhOverrideMode');
                    }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                  {/* #641 模式切换模型下超出限制的图片暗化覆盖层 */}
                  {isModeSwitchModel && currentConfig.type === 'video' && (() => {
                    const limits = getMaterialTypeLimits(hhCurrentMode, selectedModel);
                    return index >= limits.image;
                  })() && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(0,0,0,0.45)',
                      borderRadius: '0.5rem',
                      pointerEvents: 'none',
                      zIndex: 2,
                    }} />
                  )}
                </div>
              );
            })}
            {/* #826 压缩中骨架卡片 - 文件选择后立即显示，压缩完成后被真实缩略图替换 */}
            {chatCompressingCount != null && chatCompressingCount > 0 && Array.from({ length: chatCompressingCount }).map((_, i) => (
              <div key={`compressing-skeleton-${i}`} className="w-12 h-12 rounded-lg overflow-hidden relative">
                <div className="w-full h-full bg-gray-200 dark:bg-gray-700 animate-pulse rounded-lg" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-gray-400 dark:text-gray-500 animate-spin" />
                </div>
              </div>
            ))}
            {/* #656 图片上传按钮 - 使用 getModelMaxLimits 动态数量限制 - 物理层决定入口显示 */}
            {getModelSupportedTypes(selectedModel).image && (() => {
              const maxLimits = getModelMaxLimits(selectedModel);
              const currentCount = chatImageBase64s.length;
              const canUpload = currentCount < maxLimits.image;
              
              if (canUpload) {
                return (
                  <div 
                    title="上传参考图"
                    className="w-12 h-12 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                    onClick={() => {
                      // #892 鉴权：未登录拦截参考图上传
                      if (!isLoggedInRef) { setAuthModalOpenRef(true); return; }
                      referenceImageInputRef.current?.click();
                    }}
                  >
                    <svg width="16" height="16" className="text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="2"/>
                      <polyline points="21 15 16 10 5 21" strokeWidth="2"/>
                    </svg>
                  </div>
                );
              }
              // 超过限制：灰化按钮 + toast提示
              return (
                <div 
                  title={`已达到最大限制（${maxLimits.image}张）`}
                  className="w-12 h-12 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center opacity-50 cursor-not-allowed"
                  onClick={() => toast.error(`该模型最多上传 ${maxLimits.image} 张图片`)}
                >
                  <svg width="16" height="16" className="text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="2"/>
                    <polyline points="21 15 16 10 5 21" strokeWidth="2"/>
                  </svg>
                </div>
              );
            })()}
            {/* #658 对话框视频上传按钮 - 支持多视频，按数量判断是否可继续上传 #660 正方形样式与图片按钮一致 */}
            {getModelSupportedTypes(selectedModel).video && (() => {
              const maxLimits = getModelMaxLimits(selectedModel);
              const currentCount = dialogRefVideoUrls.length;
              const canUpload = currentCount < maxLimits.video;
              
              if (canUpload) {
                return (
                  <div
                    title="上传参考视频"
                    className="w-12 h-12 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                    onClick={() => {
                      // #892 鉴权：未登录拦截视频上传
                      if (!isLoggedInRef) { setAuthModalOpenRef(true); return; }
                      if ((isSeedance2Model || isT8SeedanceModel)) {
                        dialogRefVideoInputRef.current?.click();
                      } else {
                        videoInputRef.current?.click();
                      }
                    }}
                  >
                    <Video className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                </div>
              );
              }
              // 超过限制：灰化按钮 + toast提示
              return (
                <div
                  title={`已达到最大限制（${maxLimits.video}段视频）`}
                  className="w-12 h-12 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center opacity-50 cursor-not-allowed"
                  onClick={() => toast.error(`该模型最多上传 ${maxLimits.video} 段视频`)}
                >
                  <Video className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                </div>
              );
            })()}
            {/* #658 对话框视频缩略图预览 - 正方形与图片缩略图一致，播放logo参照面板风格 */}
            {getModelSupportedTypes(selectedModel).video && dialogRefVideoUrls.length > 0 && dialogRefVideoUrls.map((url, idx) => {
              // #658 检查是否仍在上传中（ObjectURL还未被COS URL替换）
              const isUploading = url.startsWith('blob:');
              // #664 修复：生图模型使用 getModelMaxLimits，视频模型使用 getMaterialTypeLimits
              const limits = isModeSwitchModel
                ? getMaterialTypeLimits(hhCurrentMode, selectedModel)
                : getModelMaxLimits(selectedModel);
              const isDisabled = idx >= limits.video;
              return (
              <div key={`dialog-video-${idx}`} className="relative group" title={isDisabled ? '当前模式下视频输入将被忽略' : `视频${idx + 1}`} style={{ opacity: isDisabled ? 0.35 : 1 }}>
                <video src={url} className="w-12 h-12 object-cover rounded-lg cursor-pointer hover:opacity-80 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700" muted playsInline preload="metadata"
                  onMouseEnter={(e) => {
                    if (!isUploading) {
                      setHoverPreview({ type: 'video', src: url, rect: e.currentTarget.getBoundingClientRect() });
                    }
                  }}
                  onMouseLeave={() => setHoverPreview(null)}
                />
                {/* 播放logo（与面板视频缩略图风格一致：圆形背景+三角形） */}
                {!isUploading && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                  }}>
                    {/* #662 三角形居中：顶点从(0,0)(10,6)(0,12)改为(2,1)(9,6)(2,11) */}
                    <svg width="10" height="12" viewBox="0 0 10 12" fill="white">
                      <polygon points="2,1 9,6 2,11" />
                    </svg>
                  </div>
                )}
                {/* 上传中覆盖层 */}
                {isUploading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg">
                    <Loader2 className="w-5 h-5 text-white animate-spin" />
                  </div>
                )}
                {/* 视频不可用时暗化覆盖层 */}
                {isDisabled && (
                  <div className="absolute inset-0 bg-black/45 rounded-lg pointer-events-none" />
                )}
                {/* 删除按钮（与图片缩略图一致） */}
                <button
                  className="absolute -top-1 -right-1 w-4 h-4 bg-gray-900 dark:bg-gray-600 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => {
                    const removedUrl = dialogRefVideoUrls[idx];
                    const newUrls = dialogRefVideoUrls.filter((_, i) => i !== idx);
                    setDialogRefVideoUrls(newUrls);
                    // 同步 chatVideoUrl：取最后一个或清空
                    if (newUrls.length > 0) {
                      setChatVideoUrl(newUrls[newUrls.length - 1]);
                    } else {
                      setChatVideoUrl('');
                    }
                    // #M7 修复：释放被删除的blob URL
                    if (removedUrl?.startsWith('blob:')) {
                      try { URL.revokeObjectURL(removedUrl); } catch {}
                    }
                  }}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              );
            })}
            {/* #656 对话框音频上传按钮 - 使用 getModelMaxLimits 动态数量限制 - 物理层决定入口显示 */}
            {getModelSupportedTypes(selectedModel).audio && (() => {
              const maxLimits = getModelMaxLimits(selectedModel);
              const currentCount = dialogRefAudioFiles.length;
              const canUpload = currentCount < maxLimits.audio;
              
              if (canUpload) {
                return (
                  <div 
                    title="上传参考音频"
                    className="w-12 h-12 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                    onClick={() => {
                      // #892 鉴权：未登录拦截音频上传
                      if (!isLoggedInRef) { setAuthModalOpenRef(true); return; }
                      dialogRefAudioInputRef.current?.click();
                    }}
                  >
                    <svg width="14" height="14" className="text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                    <span className="text-[8px] text-gray-400 dark:text-gray-500 mt-0.5">音频</span>
                  </div>
                );
              }
              // 超过限制：灰化按钮 + toast提示
              return (
                <div 
                  title={`已达到最大限制（${maxLimits.audio}段）`}
                  className="w-12 h-12 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center opacity-50 cursor-not-allowed"
                  onClick={() => toast.error(`该模型最多上传 ${maxLimits.audio} 段音频`)}
                >
                  <svg width="14" height="14" className="text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                  <span className="text-[8px] text-gray-400 dark:text-gray-500 mt-0.5">音频</span>
                </div>
              );
            })()}
            {/* #658 对话框已上传音频列表 - 正方形缩略图，按索引判断opacity */}
            {getModelSupportedTypes(selectedModel).audio && dialogRefAudioFiles.length > 0 && dialogRefAudioFiles.map((audio, idx) => (
              <div key={`dialog-audio-${idx}`} className="relative w-12 h-12 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 flex flex-col items-center justify-center border border-gray-200 dark:border-gray-700" style={{ opacity: (() => {
                // #664 修复：生图模型使用 getModelMaxLimits，视频模型使用 getMaterialTypeLimits
                const limits = isModeSwitchModel
                  ? getMaterialTypeLimits(hhCurrentMode, selectedModel)
                  : getModelMaxLimits(selectedModel);
                return idx < limits.audio ? 1 : 0.35;
              })() }}>
                <svg width="12" height="12" className="text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
                <span className="text-[7px] text-gray-500 dark:text-gray-400 truncate max-w-[40px]">{audio.name}</span>
                <button
                  className="absolute -top-1 -right-1 w-4 h-4 bg-gray-900 dark:bg-gray-600 rounded-full flex items-center justify-center text-white text-[8px] opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ opacity: 1 }}
                  onClick={() => {
                    const newFiles = dialogRefAudioFiles.filter((_, i) => i !== idx);
                    setDialogRefAudioFiles(newFiles);
                    onAudioFilesChange?.(newFiles);
                  }}
                >×</button>
              </div>
            ))}
            {/* #662 音频生成开关已移至模式弹窗底部 */}
          </div>
          
          <div className="flex items-center gap-2 pt-3">
            <button 
              className="px-2 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-gray-700 dark:text-gray-200 transition-colors flex items-center gap-1"
              onClick={() => { setShowModelPicker(true); setShowQualityPicker(false); }}
            >
              <img src={dialogGetModelLogo(selectedModel)} alt="" className={`w-[14px] h-[14px] rounded-[2px] flex-shrink-0 ${dialogIsDarkLogo(selectedModel) ? 'dark:brightness-0 dark:invert' : ''}`} referrerPolicy="no-referrer-when-downgrade" />
              {modelDisplayNames[selectedModel] || formatModelName(selectedModel)}
              <span style={{ fontSize: '10px', opacity: 0.5 }}>˅</span>
            </button>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">
                剩余 {credits}
              </span>
              <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">
                {(() => {
                  const config = modelConfig[selectedModel] || {
                    resolutions: [{ size: '1K', credits: 10 }],
                    aspectRatios: ['1:1', '3:2', '4:3', '16:9', '9:16'],
                    type: 'image' as const,
                  };
                  // #549 三端统一积分计算
                  if (currentConfig.type === 'video') {
                    // #641 灵芽 Sora-2 VIP 动态积分（10s=60, 15s=90）
                    if (selectedModel.startsWith('sora-2-all-vip')) {
                      return `${selectedDuration === 15 ? 90 : 60} 积分/次`;
                    }
                    const videoPricing = (config as any).videoPricing;
                    // #735 TOPAIS Veo：按次计费（固定积分，根据分辨率）
                    if (isTopaisModel) {
                      if (videoPricing?.mode === 'fixed' && videoPricing?.credits) {
                        return `${videoPricing.credits} 积分/次`;
                      }
                      // 兜底：根据分辨率返回固定积分（720p=50, 1080p=80, 4K=150）
                      const res = (selectedResolution || '720p').toLowerCase();
                      if (res === '4k') return `150 积分/次`;
                      if (res === '1080p') return `80 积分/次`;
                      return `50 积分/次`;
                    }
                    // #736 TOPAIS Seedance 2.0：按分辨率×时长计费
                    if (isTopaisSeedanceModel) {
                      const resolutions = config?.resolutions || [{ size: '720P', credits: 80 }];
                      // #736 修复：大小写不敏感匹配（数据库存储 720P，selectedResolution 可能是 720p）
                      // #866 修复：兼容 value 字段（MiniMax 使用 {label,value,credits} 格式），防空崩溃
                      const resConfig = resolutions.find((r: any) => (r.size || r.value || '').toLowerCase() === (selectedResolution || '720p').toLowerCase());
                      const creditsPerSecond = resConfig?.credits || 80;
                      return `${Math.ceil(selectedDuration * creditsPerSecond)} 积分`;
                    }
                    const isFixedPricing = videoPricing?.mode === 'fixed' || (!currentConfig.showDuration && !currentConfig.showResolution);
                    if (isFixedPricing) {
                      // 固定计费模式（Sora/Veo）：按次计费
                      return `${(config as any).credits_base || (config as any).credits || videoPricing?.credits || 80} 积分/次`;
                    }
                    // 按秒计费模式（Seedance）：分辨率单价 × 时长
                    // #866 修复：兼容 value 字段，防空崩溃
                    const resolutions = config?.resolutions || [{ size: '720P', credits: 80 }];
                    const resConfig = resolutions.find((r: any) => (r.size || r.value || '').toLowerCase() === (selectedResolution || '720p').toLowerCase());
                    const creditsPerSecond = resConfig?.credits || resolutions[0]?.credits || 80;
                    return `${creditsPerSecond * selectedDuration} 积分`;
                  }
                  // #866 修复：兼容 value 字段，防空崩溃
                  const resolutions = config?.resolutions || [{ size: '1K', credits: 10 }];
                  const resConfig = resolutions.find((r: any) => (r.size || r.value || '').toLowerCase() === (selectedResolution || '1K').toLowerCase());
                  const creditsPerImage = resConfig?.credits || resolutions[0]?.credits || 0;
                  return `${creditsPerImage * selectedCount} 积分`;
                })()}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-1 pt-2 min-w-0 flex-wrap">
            {/* #635 比例按钮：非模式切换模型正常显示；模式切换模型仅 t2v/r2v 模式显示 */}
            {(!isModeSwitchModel || hhParams?.showRatio) && (
            <button 
              className="px-2 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-gray-700 dark:text-gray-200 transition-colors whitespace-nowrap flex items-center gap-0.5"
              onClick={() => { setShowRatioPicker(!showRatioPicker); setShowQualityPicker(false); }}
            >
              <AspectRatioIcon ratio={selectedRatio} selected={false} />
              {formatRatioLabel(selectedRatio)}
              <span style={{ fontSize: '10px', opacity: 0.5 }}>˅</span>
            </button>
            )}
            {/* 分辨率按钮 - 视频模型：showResolution 或 supportsUpsample 时显示 */}
            {(currentConfig.type !== 'video' || currentConfig.showResolution || currentConfig.supportsUpsample) && (
            <button 
              className={`px-2 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap flex items-center gap-1 ${
                isResolutionBanned(selectedResolution)
                  ? 'bg-red-50 dark:bg-red-900/30 text-red-400 dark:text-red-400 cursor-not-allowed'
                  : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200'
              }`}
              onClick={() => { if (!isResolutionBanned(selectedResolution)) { setShowResolutionPicker(!showResolutionPicker); setShowQualityPicker(false); } }}
              title={isResolutionBanned(selectedResolution) ? '通道拥挤，请切换分辨率' : undefined}
            >
              {formatResolutionDisplay(selectedResolution)}
              <span style={{ fontSize: '10px', opacity: 0.5 }}>˅</span>
              {isResolutionBanned(selectedResolution) && (() => { const exp = currentModelBannedResolutions[selectedResolution.toUpperCase()]; if (!exp) return ' ⚠️'; const remain = Math.max(0, Math.ceil((exp - Date.now()) / 60000)); return remain > 0 ? ` ⚠️${remain}分钟` : ' ⚠️即将解锁'; })()}
            </button>
            )}
            {/* T8Star/GRS GPT 模型单独显示品质 */}
            {(selectedModel?.startsWith('t8star.') || selectedModel === 'gpt-image-2-vip' || selectedModel === 'gpt-image-2') && (
              <button
                className="px-2 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-gray-700 dark:text-gray-200 transition-colors whitespace-nowrap flex items-center gap-1"
                onClick={() => { setShowQualityPicker(!showQualityPicker); setShowRatioPicker(false); setShowResolutionPicker(false); setShowCountPicker(false); }}
              >
                {selectedQuality === 'low' ? '速度' : selectedQuality === 'medium' ? '中' : selectedQuality === 'high' ? '高' : '自动'}
                <span style={{ fontSize: '10px', opacity: 0.5 }}>˅</span>
              </button>
            )}
            {currentConfig.type !== 'video' && (
              <button
                className="px-2 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-gray-700 dark:text-gray-200 transition-colors whitespace-nowrap flex items-center gap-1"
                onClick={() => { setShowCountPicker(!showCountPicker); setShowQualityPicker(false); }}
              >
                {selectedCount}张
                <span style={{ fontSize: '10px', opacity: 0.5 }}>˅</span>
              </button>
            )}
            {/* #635 时长按钮：视频模型+showDuration；模式切换模型仅非 video-edit 模式显示；#641 灵芽 Sora-2 VIP 强制显示；Seedance 2.0 强制显示；#690 TOPAIS 固定 8 秒显示；#7xx TOPAIS HappyHorse 3-15 秒显示；TOPAIS Gemini Omni 4/6/8/10 秒显示 */}
            {currentConfig.type === 'video' && (currentConfig.showDuration || selectedModel.startsWith('sora-2-all-vip') || isSeedance2Model || isT8SeedanceModel || isTopaisModel || isTopaisHhModel || isTopaisGeminiOmniModel) && (!isModeSwitchModel || hhParams?.showDuration) && (
              <button 
                className="px-2 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-gray-700 dark:text-gray-200 transition-colors whitespace-nowrap flex items-center gap-1"
                onClick={() => { setShowDurationPicker(!showDurationPicker); setShowQualityPicker(false); }}
              >
                {selectedDuration}秒
                <span style={{ fontSize: '10px', opacity: 0.5 }}>˅</span>
              </button>
            )}
            {/* 模式切换按钮（HappyHorse + Seedance 2.0） - 放在秒数后方 */}
            {isModeSwitchModel && (
              <ModelModeSwitcher
                inputImageUrls={chatImageBase64s.filter(b => b && b.length > 0)}  // #657 修复：使用 Base64（上传中就有），不用 URL（上传完成后才有）
                inputVideoUrl={chatVideoUrl}
                overrideMode={hhOverrideMode}
                setOverrideMode={setHhOverrideMode}
                onModeChange={() => {
                  // hhCurrentMode 已由 Context 通过 useMemo 自动推导，无需手动更新
                }}
                audioSetting={hhAudioSetting}
                onAudioSettingChange={setHhAudioSetting}
                generateAudio={dialogGenerateAudio}
                onGenerateAudioChange={(v) => {
                  setDialogGenerateAudio(v);  // 更新本地状态，让 UI 响应
                  onGenerateAudioChange?.(v); // 同步到父组件 ref
                }}
                variant="dialog"
                modelType={isTopaisKlingOmniModel ? 'topais-kling-omni' : isTopaisMinimaxModel ? 'topais-minimax' : isMegaAiSeedanceModel ? 'mega-ai-seedance' : isLingyaSoraModel ? 'lingya-sora' : isLingyaVeoModel ? 'lingya-veo' : isTopaisHhModel ? 'topais-happyhorse' : isTopaisSeedanceModel ? 'topais-seedance' : isTopaisGeminiOmniModel ? 'topais-gemini-omni' : isTopaisModel ? 'topais' : isSeedance2Model ? 'seedance2' : isT8SeedanceModel ? 't8seedance' : 'happyhorse'}
              />
            )}
            <div className="flex-1" />
            
            <button 
              className="px-2 py-1.5 text-xs bg-gray-900 dark:bg-gray-700 hover:bg-gray-700 dark:hover:bg-gray-600 rounded-lg text-white transition-colors flex items-center gap-1 whitespace-nowrap"
              onClick={handleSend}
            >
              <span>发送</span>
              <Send className="w-3 h-3" />
            </button>
          </div>
        </div>
          </>
        )}
      {/* Seedance 2.0 参考视频/音频 隐藏文件输入 */}
      <input
        type="file"
        accept="video/mp4,video/mov,video/*"
        multiple
        className="hidden"
        ref={dialogRefVideoInputRef}
        onChange={async (e) => {
          const files = Array.from(e.target.files || []);
          if (files.length === 0) return;
          // #892 鉴权：未登录拦截视频上传
          if (!isLoggedInRef) { setAuthModalOpenRef(true); e.target.value = ''; return; }
          // #664 修复：生图模型使用 getModelMaxLimits，视频模型使用 getMaterialTypeLimits
          const limits = isModeSwitchModel
            ? getMaterialTypeLimits(hhCurrentMode, selectedModel)
            : getModelMaxLimits(selectedModel);
          const maxVideos = limits.video || 3;
          if (dialogRefVideoUrls.length + files.length > maxVideos) {
            toast.error(`参考视频最多上传${maxVideos}段`);
            return;
          }
          setIsVideoUploading(true);
          try {
            for (const file of files) {
              if (file.size > 50 * 1024 * 1024) {
                toast.error(`视频 ${file.name} 超过50MB限制`);
                continue;
              }
              // #658 乐观UI：先用 ObjectURL 立即显示预览
              const objectUrl = URL.createObjectURL(file);
              setDialogRefVideoUrls(prev => [...prev, objectUrl]);
              setChatVideoUrl(objectUrl);
              
              // 服务端中转上传 COS
              try {
                const formData = new FormData();
                formData.append('file', file);
                const uploadResponse = await fetch('/api/canvas/upload', { method: 'POST', body: formData });
                const uploadData = await safeJsonResponse<{ key?: string; url?: string }>(uploadResponse);
                if (uploadData.success) {
                  const signedUrl = `/api/canvas/image?key=${encodeURIComponent(uploadData.key ?? '')}`;
                  // 替换 ObjectURL 为 COS URL
                  setDialogRefVideoUrls(prev => prev.map(u => u === objectUrl ? signedUrl : u));
                  setChatVideoUrl(signedUrl);
                  URL.revokeObjectURL(objectUrl);
                  console.log('[Dialog视频上传] 成功:', uploadData.key);
                } else {
                  // COS上传失败，ObjectURL仍可预览（刷新后会丢失）
                  console.error('[Dialog视频上传] COS上传失败，保留ObjectURL:', uploadData.error);
                }
              } catch (err) {
                // COS上传异常，ObjectURL仍可预览
                console.error('[Dialog视频上传] COS上传异常，保留ObjectURL:', err);
              }
            }
          } catch (err) {
            console.error('[Dialog视频上传] 异常:', err);
          }
          setIsVideoUploading(false);
          e.target.value = '';
        }}
      />
      {/* #646 对话框音频文件隐藏输入 */}
      <input
        type="file"
        accept="audio/wav,audio/mp3,audio/mpeg,.wav,.mp3"
        multiple
        className="hidden"
        ref={dialogRefAudioInputRef}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length === 0) return;
          // #892 鉴权：未登录拦截音频上传
          if (!isLoggedInRef) { setAuthModalOpenRef(true); e.target.value = ''; return; }
          // #664 修复：生图模型使用 getModelMaxLimits，视频模型使用 getMaterialTypeLimits
          const limits = isModeSwitchModel
            ? getMaterialTypeLimits(hhCurrentMode, selectedModel)
            : getModelMaxLimits(selectedModel);
          if (dialogRefAudioFiles.length + files.length > limits.audio) {
            toast.error(`参考音频最多上传${limits.audio}段`);
            return;
          }
          files.forEach(file => {
            if (file.size > 15 * 1024 * 1024) {
              toast.error(`音频 ${file.name} 超过15MB限制`);
              return;
            }
            // 服务端中转上传 COS
            const formData = new FormData();
            formData.append('file', file);
            fetch('/api/canvas/upload', { method: 'POST', body: formData })
              .then(res => safeJsonResponse<{ key?: string; url?: string }>(res))
              .then(uploadData => {
                if (uploadData.success) {
                  const signedUrl = `/api/canvas/image?key=${encodeURIComponent(uploadData.key ?? '')}`;
                  const newFile = { url: signedUrl, name: file.name, size: file.size };
                  setDialogRefAudioFiles(prev => {
                    const updated = [...prev, newFile];
                    onAudioFilesChange?.(updated);
                    return updated;
                  });
                  toast.success('音频上传成功');
                } else {
                  toast.error(`音频 ${file.name} 上传失败`);
                }
              })
              .catch(() => toast.error('音频上传失败'));
          });
          e.target.value = '';
        }}
      />

      </aside>

      {/* 模型选择弹窗 */}
      {showModelPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4" onClick={() => setShowModelPicker(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[360px] max-h-[80vh] overflow-hidden mb-20 mr-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">模型偏好</h3>
              <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={() => setShowModelPicker(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex p-2 gap-1 border-b border-gray-100 dark:border-gray-700">
              <button 
                onClick={() => setModelTab('image')}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                  modelTab === 'image' ? 'bg-gray-900 dark:bg-gray-700 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                图像
              </button>
              <button 
                onClick={() => setModelTab('video')}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                  modelTab === 'video' ? 'bg-gray-900 dark:bg-gray-700 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                视频
              </button>
            </div>
            
            <div className="p-2 space-y-1 overflow-y-auto max-h-[50vh]">
              {(modelTab === 'image' ? imageModelOptions : videoModelOptions).map((modelId) => {
                const config = modelConfig[modelId];
                const isSelected = selectedModel === modelId;
                const isActive = modelActiveStatus[modelId] !== false;
                // 🔧 #264 根据模型获取对应的 logo
                const mid = modelId.toLowerCase();
                const _midFamily = ModelDetector.getFamily(modelId);
                const isSeedanceModel = ['seedance2', 't8seedance', 'topais-seedance', 'mega-ai-seedance'].includes(_midFamily);
                const isVeoModel = mid.includes('veo');
                const isSoraModel = mid.includes('sora');
                // Nano Banana 系列模型使用新 logo
                const isNanoBananaModel = mid.includes('nana') || mid.includes('banana');
                // GPT Image 2 系列（包括 gpt-image-2, gpt-image-2-8T, GPTimage2VIP 等）
                const isGptImage2Model = modelId.includes('gpt-image-2') || mid.includes('gptimage2');
                // Gemini Omni Flash 视频模型（使用专属 logo）
                const isGeminiOmniModel = _midFamily === 'topais-gemini-omni';
                // Gemini LLM（使用 veo logo 样式）
                const isGeminiModel = mid.includes('gemini') && !isGeminiOmniModel;
                // GPT-5 系列（使用 gpt-image-2 logo）
                const isGpt5Model = mid.includes('gpt-5');
                const isHHModel = _midFamily === 'happyhorse' || _midFamily === 'topais-happyhorse';
                const modelLogo = isGeminiOmniModel ? '/gemini-logo.png'
                  : isGeminiModel ? '/veo-logo.png'
                  : isGpt5Model ? '/gpt-image-2-logo.png'
                  : isSeedanceModel ? '/seedance-logo.png'
                  : isVeoModel ? '/veo-logo.png'
                  : isSoraModel ? '/gpt-image-2-logo.png'
                  : isGptImage2Model ? '/gpt-image-2-logo.png' 
                  : isNanoBananaModel ? '/banana-logo.png'
                  : isHHModel ? '/happyhorse-logo.png'
                  : '/logo-main.png';
                // 深色logo在夜间模式需要白色处理（只有banana是浅色不需要）
                const needWhiteLogo = !isNanoBananaModel;
                // #636 当对话框有视频输入时，不支持视频参考的模型不可选
                const videoRefUnavailable = modelTab === 'video' && !!chatVideoUrl && !getModelSupportedTypes(modelId).video;
                
                if (!config) {
                  return (
                    <div 
                      key={modelId}
                      className="flex items-center gap-3 p-3 rounded-lg cursor-not-allowed opacity-50"
                    >
                      <img src={modelLogo} alt="" className={`w-8 h-8 rounded-lg scale-[0.85] ${needWhiteLogo ? 'dark:brightness-0 dark:invert' : ''}`} referrerPolicy="no-referrer-when-downgrade" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{modelDisplayNames[modelId] || formatModelName(modelId)}</span>
                        </div>
                        <div className="text-xs text-gray-400">加载中...</div>
                      </div>
                    </div>
                  );
                }
                
                if (!isActive) {
                  return (
                    <div 
                      key={modelId}
                      className="flex items-center gap-3 p-3 rounded-lg cursor-not-allowed opacity-60"
                    >
                      <img src={modelLogo} alt="" className={`w-8 h-8 rounded-lg grayscale scale-[0.85] ${needWhiteLogo ? 'dark:brightness-0 dark:invert' : ''}`} referrerPolicy="no-referrer-when-downgrade" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-400 dark:text-gray-500">{modelDisplayNames[modelId] || formatModelName(modelId)}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">离线</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {(config.resolutions || []).map((r: any) => r.size || r.value || r.label).join(' / ')}
                          </span>
                          <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {(() => {
                              if (config.type === 'video') {
                                const isFixedPricing = config.showDuration === false && config.showResolution === false;
                                if (isFixedPricing) {
                                  return `${config.credits || config.resolutions?.[0]?.credits || 80}积分/次`;
                                }
                                const minDuration = (config.durations && config.durations.length > 0)
                                  ? Math.min(...config.durations)
                                  : 8;
                                const minCreditsPerSec = (config.resolutions && config.resolutions.length > 0)
                                  ? Math.min(...config.resolutions.map((r: any) => r.credits || 80))
                                  : 80;
                                return `${minCreditsPerSec * minDuration}积分起`;
                              }
                              return `${config.resolutions?.[0]?.credits || 10} 积分起`;
                            })()}
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
                      if (videoRefUnavailable) return; // #636 不支持视频参考的模型不可选
                      setSelectedModel(modelId);
                      setShowModelPicker(false);
                      setShowQualityPicker(false);  // #523 切换模型时关闭品质弹窗
                    }}
                    title={videoRefUnavailable ? '该模型不支持视频参考输入' : undefined}
                    className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                      videoRefUnavailable ? 'cursor-not-allowed opacity-40' :
                      isSelected ? 'bg-gray-100 dark:bg-gray-700 cursor-pointer' : 'hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer'
                    }`}
                  >
                    <img src={modelLogo} alt="" className={`w-8 h-8 rounded-lg scale-[0.85] ${needWhiteLogo ? 'dark:brightness-0 dark:invert' : ''}`} referrerPolicy="no-referrer-when-downgrade" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${videoRefUnavailable ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>{modelDisplayNames[modelId] || formatModelName(modelId)}</span>
                        {/* 在线=绿色实心圆，离线=红色空心圆 */}
                        {!videoRefUnavailable && (
                          <span className={isActive ? 'text-green-500 text-xs' : 'text-red-500 text-xs'}>
                            {isActive ? '●' : '○'}
                          </span>
                        )}
                        {videoRefUnavailable && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">不支持视频</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {(config.resolutions || []).map((r: any) => r.size || r.value || r.label).join(' / ')}
                        </span>
                        <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {(() => {
                            if (config.type === 'video') {
                              const isFixedPricing = config.showDuration === false && config.showResolution === false;
                              if (isFixedPricing) {
                                return `${config.credits || config.resolutions?.[0]?.credits || 80}积分/次`;
                              }
                              const minDuration = (config.durations && config.durations.length > 0)
                                ? Math.min(...config.durations)
                                : 8;
                              const minCreditsPerSec = (config.resolutions && config.resolutions.length > 0)
                                ? Math.min(...config.resolutions.map((r: any) => r.credits || 80))
                                : 80;
                              return `${minCreditsPerSec * minDuration}积分起`;
                            }
                            return `${config.resolutions?.[0]?.credits || 10} 积分起`;
                          })()}
                        </span>
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      isSelected ? 'border-gray-900 bg-gray-900' : 'border-gray-300'
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
      )}

      {/* 比例选择弹窗 */}
      {showRatioPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4" onClick={() => setShowRatioPicker(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[320px] mb-20 mr-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">选择比例</h3>
              <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={() => setShowRatioPicker(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 grid grid-cols-3 gap-2">
              {(() => {
                // #865 MiniMax: 按模式计算每个比例的 disabled 状态
                const ratioStates = isTopaisMinimaxModel
                  ? getTopaisMinimaxRatioStates(hhCurrentMode, aspectRatioOptions)
                  : aspectRatioOptions.map((r: string) => ({ ratio: r, disabled: false }));
                return ratioStates.map(({ ratio, disabled }) => (
                <button
                  key={ratio}
                  onClick={() => {
                    if (disabled) return;  // #865 禁用的比例不可选
                    setSelectedRatio(ratio);
                    setShowRatioPicker(false);
                  }}
                  className={`py-2 px-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-1 ${
                    disabled
                      ? 'bg-gray-50 dark:bg-gray-900 text-gray-300 dark:text-gray-600 cursor-not-allowed'
                      : selectedRatio === ratio 
                      ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  <AspectRatioIcon ratio={ratio} selected={selectedRatio === ratio} />
                  <span>{formatRatioLabel(ratio)}</span>
                </button>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
      
      {/* 分辨率选择弹窗 */}
      {showResolutionPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4" onClick={() => setShowResolutionPicker(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[280px] mb-20 mr-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">{currentConfig.type === 'video' ? '选择清晰度' : '选择分辨率'}</h3>
              <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={() => setShowResolutionPicker(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 space-y-1">
              {(() => {
                let opts = resolutionOptions;
                // Veo模型(supportsUpsample)：有参考图时过滤掉1080p，只保留720p
                if (currentConfig.supportsUpsample && chatImageBase64s.length > 0) {
                  opts = opts.filter(res => res.size.toLowerCase() !== '1080p');
                  if (opts.length === 0) opts = [{ size: '720P', credits: 80 }];
                }
                return opts;
              })().map((res) => {
                const isBanned = isResolutionBanned(res.size);
                return (
                  <button
                    key={res.size}
                    onClick={() => {
                      if (isBanned) return;
                      setSelectedResolution(res.size);
                      setShowResolutionPicker(false);
                    }}
                    disabled={isBanned}
                    className={`w-full py-2 px-3 rounded-lg text-left transition-colors flex items-center justify-between ${
                      isBanned
                        ? 'bg-gray-50 dark:bg-gray-800 text-gray-300 dark:text-gray-600 cursor-not-allowed'
                        : selectedResolution === res.size 
                          ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                    title={isBanned ? '通道拥挤，暂时不可用' : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium">{formatResolutionDisplay(res.size)}</div>
                      {isBanned && <span className="text-[10px] text-red-400 dark:text-red-500 font-medium">通道拥挤{currentModelBannedResolutions[res.size.toUpperCase()] ? (() => { const remain = Math.max(0, Math.ceil((currentModelBannedResolutions[res.size.toUpperCase()] - Date.now()) / 60000)); return remain > 0 ? ` ${remain}分钟后解锁` : '即将解锁'; })() : ''}</span>}
                    </div>
                    <div className={`text-xs ${isBanned ? 'text-gray-300 dark:text-gray-600' : selectedResolution === res.size ? 'text-gray-300 dark:text-gray-400' : 'text-gray-500 dark:text-gray-400'}`}>
                      {res.credits} 积分
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 品质选择弹窗 - T8Star GPT 模型专用 */}
      {showQualityPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4" onClick={() => setShowQualityPicker(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[240px] mb-20 mr-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">选择品质</h3>
              <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={() => setShowQualityPicker(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 flex flex-col gap-1">
              {[
                { value: 'auto', label: '自动', desc: '默认' },
                { value: 'high', label: '高', desc: '细节多' },
                { value: 'medium', label: '中', desc: '平衡' },
                { value: 'low', label: '速度', desc: '最快' },
              ].map((q) => (
                <button
                  key={q.value}
                  onClick={() => {
                    setSelectedQuality(q.value);
                    setShowQualityPicker(false);
                  }}
                  className={`py-2.5 px-3 rounded-lg text-sm transition-colors flex items-center justify-between ${
                    selectedQuality === q.value
                      ? 'bg-gray-900 dark:bg-gray-700 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  <span className="font-medium">{q.label}</span>
                  <span className={`text-xs w-12 text-right ${selectedQuality === q.value ? 'text-gray-300 dark:text-gray-300' : 'text-gray-700 dark:text-gray-200'}`}>{q.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 宽高比选择弹窗 */}
      {showAspectRatioPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4" onClick={() => setShowAspectRatioPicker(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[320px] mb-20 mr-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">选择宽高比</h3>
              <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={() => setShowAspectRatioPicker(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 grid grid-cols-3 gap-2">
              {/* #540 比例从数据库配置动态读取 */}
              {(currentConfig.aspectRatios || ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']).map((ratio: string) => (
                <button
                  key={ratio}
                  onClick={() => {
                    setSelectedAspectRatio(ratio);
                    setShowAspectRatioPicker(false);
                  }}
                  className={`py-2 px-3 rounded-lg text-sm transition-colors ${
                    selectedAspectRatio === ratio 
                      ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 数量选择弹窗 */}
      {showCountPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4" onClick={() => setShowCountPicker(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[200px] mb-20 mr-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">选择数量</h3>
              <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={() => setShowCountPicker(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className={`p-2 grid ${isModeSwitchModel ? 'grid-cols-4' : 'grid-cols-2'} gap-2`}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((count) => (
                <button
                  key={count}
                  onClick={() => {
                    setSelectedCount(count);
                    setShowCountPicker(false);
                  }}
                  className={`py-2 px-3 rounded-lg text-sm transition-colors ${
                    selectedCount === count 
                      ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 时长选择弹窗 - 仅showDuration的模型显示；#641 灵芽 Sora-2 VIP 强制显示 */}
      {showDurationPicker && (currentConfig.showDuration || selectedModel.startsWith('sora-2-all-vip')) && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4" onClick={() => setShowDurationPicker(false)}>
          <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-2xl ${isModeSwitchModel ? 'w-[280px]' : 'w-[150px]'} mb-20 mr-2`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">选择时长</h3>
              <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={() => setShowDurationPicker(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 grid grid-cols-2 gap-2">
              {/* #540 时长从数据库配置动态读取 + #549 Sora-2动态过滤 + #636 HappyHorse强制3-15秒 */}
              {(() => {
                let durationsList = (currentConfig.durations || [5, 10]) as number[];
                // #636 HappyHorse 强制 3-15 秒，防止数据库配置不完整
                if (isHappyHorseModel) {
                  durationsList = Array.from({ length: 13 }, (_, i) => i + 3); // [3, 4, 5, ..., 15]
                }
                // Seedance 2.0: 4-15 秒（封杀 -1）
                if (isSeedance2Model) {
                  durationsList = Array.from({ length: 12 }, (_, i) => i + 4); // [4, 5, 6, ..., 15]
                }
                // T8 Seedance (sdols): 4-15 秒
                if (isT8SeedanceModel) {
                  durationsList = Array.from({ length: 12 }, (_, i) => i + 4); // [4, 5, 6, ..., 15]
                }
                // Sora-2: 文生视频只有10s，图生视频4/8/10/12s
                if (selectedModel === 'sora-2') {
                  const hasRefImages = chatImageBase64s.length > 0;
                  const sora2Allowed = hasRefImages ? [4, 8, 10, 12] : [10];
                  durationsList = durationsList.filter(d => sora2Allowed.includes(d));
                }
                // 灵芽 Sora-2 VIP: 仅 10s 和 15s
                if (selectedModel.startsWith('sora-2-all-vip')) {
                  durationsList = [10, 15];
                }
                // #833 TOPAIS Gemini Omni Flash: 4/6/8/10 秒
                if (isTopaisGeminiOmniModel) {
                  durationsList = [4, 6, 8, 10];
                }
                // #690 TOPAIS Veo3.1-fast: 固定 8 秒
                else if (isTopaisModel) {
                  durationsList = [8];
                }
                // LingYa Veo3.1: 固定 8 秒
                if (isLingyaVeoModel) {
                  durationsList = [8];
                }
                return durationsList;
              })().map((d: number) => (
                <button
                  key={d}
                  onClick={() => {
                    setSelectedDuration(d);
                    setShowDurationPicker(false);
                  }}
                  className={`py-2 px-3 rounded-lg text-sm transition-colors ${
                    selectedDuration === d 
                      ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {d}秒
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 智能分割弹窗 - 已移至画布图片工具栏的宫格切分按钮 */}

      {/* 信息弹窗 */}
      <InfoDialog
        open={infoDialog.open}
        onOpenChange={(open) => setInfoDialog({ ...infoDialog, open })}
        title={infoDialog.title}
        description={infoDialog.description}
      />
      
      {/* 悬停预览浮层 - 鼠标移到图片/视频缩略图时弹出上方预览 */}
      {hoverPreview && createPortal(
        <div
          style={{
            position: 'fixed',
            left: Math.max(8, Math.min(hoverPreview.rect.left, window.innerWidth - 268)),
            bottom: window.innerHeight - hoverPreview.rect.top + 8,
            zIndex: 9999,
            pointerEvents: 'none',
          }}
          className="w-[250px] rounded-lg overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-700 bg-gray-900"
        >
          {hoverPreview.type === 'image' ? (
            <img src={hoverPreview.src} alt="预览" className="w-full max-h-[200px] object-contain" referrerPolicy="no-referrer-when-downgrade" />
          ) : (
            <video src={hoverPreview.src} className="w-full max-h-[200px] object-contain" autoPlay muted loop />
          )}
        </div>,
        document.body
      )}
      
      {/* 图片预览弹窗 */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80" 
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img 
              src={previewImage} 
              alt="预览图片" 
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
              referrerPolicy="no-referrer-when-downgrade"
            />
            <button 
              className="absolute -top-3 -right-3 w-8 h-8 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center shadow-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              onClick={() => setPreviewImage(null)}
            >
              <X className="w-5 h-5 text-gray-600 dark:text-gray-300" />
            </button>
          </div>
        </div>
      )}

      {/* 视频预览弹窗 */}
      {previewVideo && (
        <div 
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80" 
          onClick={() => setPreviewVideo(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <video 
              src={previewVideo} 
              className="max-w-full max-h-[85vh] rounded-lg"
              controls
              autoPlay
              playsInline
            />
            <button 
              className="absolute -top-3 -right-3 w-8 h-8 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center shadow-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              onClick={() => setPreviewVideo(null)}
            >
              <X className="w-5 h-5 text-gray-600 dark:text-gray-300" />
            </button>
          </div>
        </div>
      )}

      {/* 提示词收藏弹窗 */}
      {showFavoritesModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setShowFavoritesModal(false)}>
          <div 
            className="bg-white rounded-xl shadow-lg w-[95vw] max-w-6xl max-h-[85vh] overflow-hidden" 
            onClick={(e) => e.stopPropagation()}
          >
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
                <Plus className="w-4 h-4" />
                添加收藏
              </button>
            </div>
            
            <div className="px-8 py-5 border-b border-gray-100 bg-gray-50">
              <textarea
                value={newFavoriteContent}
                onChange={(e) => setNewFavoriteContent(e.target.value)}
                placeholder="输入想要收藏的提示词..."
                className="w-full px-5 py-4 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200"
                rows={4}
              />
            </div>
            
            <div className="overflow-y-auto max-h-[55vh]">
              {favorites.length === 0 ? (
                <div className="py-20 text-center">
                  <p className="text-gray-400 text-sm">暂无收藏的提示词</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {favorites.map((item) => (
                    <div key={item.id} className="flex items-center gap-6 px-8 py-4 hover:bg-gray-50 transition-colors group">
                      {editingId === item.id ? (
                        <>
                          <div className="flex-1">
                            <textarea
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:border-gray-400"
                              rows={3}
                            />
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => handleUpdateFavorite(item.id, editingContent)}
                              className="px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => { setEditingId(null); setEditingContent(''); }}
                              className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
                            >
                              取消
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex-1 text-sm text-gray-700 min-w-0">
                            <div className="break-words">{item.content}</div>
                          </div>
                          <div className="flex items-center justify-end gap-2 flex-shrink-0">
                            <button
                              onClick={() => handleCopyContent(item.content, item.id)}
                              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
                            >
                              复制
                            </button>
                            <button
                              onClick={() => handleSendToInput(item.content)}
                              className="px-3 py-1.5 text-xs bg-black text-white rounded hover:bg-gray-800 transition-colors"
                            >
                              使用
                            </button>
                            <button
                              onClick={() => { setEditingId(item.id); setEditingContent(item.content); }}
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

      {/* #504 第5次违规警告弹窗 */}
      <Dialog open={showViolationWarning} onOpenChange={setShowViolationWarning}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-500">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <path d="M12 9v4"/>
                <path d="M12 17h.01"/>
              </svg>
              违规警告
            </DialogTitle>
            <DialogDescription className="text-foreground pt-2">
              您已连续违规 <span className="font-bold text-red-500">5 次</span>，再连续违规 <span className="font-bold text-red-500">5 次</span>将禁用账号 <span className="font-bold">30 分钟</span>。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <Button
              onClick={() => setShowViolationWarning(false)}
              className="w-full"
            >
              我知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* #505 禁用弹窗（由 useViolationGuard Hook 管理） */}
      <Dialog open={effectiveShowBannedDialog} onOpenChange={(open) => {
        // 临时禁用不允许通过点击外部关闭；永久禁用可以关闭
        if (!open && isBanned && lockedUntil) return;
        setBannedDialogVisible(open);
      }}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="m14.5 9.5-5 5"/>
                <path d="m9.5 9.5 5 5"/>
              </svg>
              账号已被禁用
            </DialogTitle>
            <DialogDescription className="text-foreground pt-2">
              {bannedRemainingMinutes > 0 ? (
                <>
                  您的账号因多次违规已被禁用 <span className="font-bold">30 分钟</span>，请稍后再试。<br />
                  剩余解封时间：<span className="font-bold text-red-500">{bannedRemainingMinutes} 分钟</span>
                </>
              ) : (
                <>
                  您的账号已被管理员禁用，请联系客服。
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <Button
              variant="destructive"
              onClick={() => setBannedDialogVisible(false)}
              className="w-full"
            >
              我知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default RightPanel;
