'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo, startTransition } from 'react';
import { createPortal } from 'react-dom';
import type { CanvasElement } from '@/types/canvas';
import { useAIGenerator, formatModelName, type Favorite } from '@/contexts/AIGeneratorContext';
import { useReferenceImages } from '@/hooks/useReferenceImages';
import { downloadFile, getCOSUrlForElement, downloadViaProxy } from '@/lib/download';
import CanvasRoseCurve from '@/components/canvas/CanvasRoseCurve';
import { ModelModeSwitcher, type VideoMode, type Seedance2Mode, getHappyHorseModeParams, getSeedance2ModeParams, getT8SeedanceModeParams, isTopaisVeoModel, getTopaisModeParams, isTopaisHhModel as isTopaisHhModelFn, getTopaisHhModeParams, isTopaisSeedanceModel as isTopaisSeedanceModelFn, getTopaisSeedanceModeParams, isTopaisGeminiOmniModel as isTopaisGeminiOmniModelFn, getTopaisGeminiOmniModeParams, isMegaAiSeedanceModel as isMegaAiSeedanceModelFn, getMegaAiSeedanceModeParams, isTopaisMinimaxModel as isTopaisMinimaxModelFn, getTopaisMinimaxModeParams, getTopaisMinimaxRatioStates, formatRatioLabel, getLingyaVeoModeParams, getLingyaSoraModeParams, isTopaisKlingOmniModel as isTopaisKlingOmniModelFn, getTopaisKlingOmniModeParams } from '@/components/ModelModeSwitcher';
import { getEffectiveSources, getMaterialTypeLimits, getModelSupportedTypes, getModelMaxLimits, type SourceItem } from '@/lib/effective-sources';
import { ModelDetector, MODEL_MODE_CONSTRAINTS, isModeSupportedByFamily } from '@/lib/model-utils';
import { useFakeProgress } from '@/hooks/useFakeProgress';
import AudioUploader from '@/components/AudioUploader';
import { toast } from 'sonner';
import { translateErrorMessage } from '@/lib/error-handler';
import { safeJsonResponse } from '@/lib/safe-json';

// Banana 系列模型 logo（本地文件）
const BANANA_LOGO = '/banana-logo.png';

// GPT Image 2 系列 logo（预加载）
const GPT_LOGO = '/gpt-image-2-logo.png';
const DEFAULT_LOGO = '/logo-main.png';

// #569 视频模型专属 logo
const SEEDANCE_LOGO = '/seedance-logo.png';
const VEO_LOGO = '/veo-logo.png';

// Gemini LLM 模型 logo（使用 veo 样式）
const GEMINI_LOGO = '/veo-logo.png';
// Gemini Omni Flash 视频模型 logo
const GEMINI_OMNI_LOGO = '/gemini-logo.png';

// #513 预加载 logo 图片，避免首次显示慢
if (typeof window !== 'undefined') {
  const preloadImages = [BANANA_LOGO, GPT_LOGO, DEFAULT_LOGO, SEEDANCE_LOGO, VEO_LOGO, GEMINI_LOGO, GEMINI_OMNI_LOGO];
  preloadImages.forEach(src => {
    const img = new Image();
    img.src = src;
  });
}

// 获取模型 logo
function getModelLogo(modelId: string): string {
  // Gemini Omni Flash 视频模型（使用专属 logo）
  if (ModelDetector.getFamily(modelId) === 'topais-gemini-omni') {
    return GEMINI_OMNI_LOGO;
  }
  // Gemini LLM 模型（使用 veo logo 样式）
  if (modelId.toLowerCase().includes('gemini')) {
    return GEMINI_LOGO;
  }
  // GPT-5 系列（使用 gpt-image-2 logo）
  if (modelId.toLowerCase().includes('gpt-5')) {
    return GPT_LOGO;
  }
  // Seedance 系列视频模型（包括 sdols-2.0 / TOPAIS Seedance 等）
  const _logoFamily = ModelDetector.getFamily(modelId);
  if (['seedance2', 't8seedance', 'topais-seedance', 'mega-ai-seedance'].includes(_logoFamily)) {
    return SEEDANCE_LOGO;
  }
  // Veo 系列视频模型
  if (modelId.toLowerCase().includes('veo')) {
    return VEO_LOGO;
  }
  // Sora-2 使用 GPT logo
  if (modelId.toLowerCase().includes('sora')) {
    return GPT_LOGO;
  }
  // HappyHorse 系列视频模型（包括 TOPAIS HappyHorse）
  if (_logoFamily === 'happyhorse' || _logoFamily === 'topais-happyhorse') {
    return '/happyhorse-logo.png';
  }
  // TOPAIS Gemini Omni Flash 视频模型
  if (_logoFamily === 'topais-gemini-omni') {
    return '/gemini-logo.png';
  }
  // Banana 系列模型
  if (modelId.includes('banana')) {
    return BANANA_LOGO;
  }
  // GPT Image 2 系列（包括 gpt-image-2, gpt-image-2-8T, GPTimage2VIP 等）
  if (modelId.includes('gpt-image-2') || modelId.toLowerCase().includes('gptimage2')) {
    return GPT_LOGO;
  }
  // 默认
  return DEFAULT_LOGO;
}

// #513 判断logo是否需要白色版本（面板是黑色背景，所有深色logo都需要变白）
function isDarkLogo(modelId: string): boolean {
  const id = modelId.toLowerCase();
  // Banana logo 本身是浅色的，不需要变白
  if (id.includes('banana')) {
    return false;
  }
  // 其他所有 logo 都需要变白（包括 seedance、veo、gpt 等）
  return true;
}

// #371 银色流光动画 - 全局注入一次（使用 mask-composite 镂空法）
if (typeof document !== 'undefined' && !document.getElementById('panel-silver-glow-style')) {
  const style = document.createElement('style');
  style.id = 'panel-silver-glow-style';
  style.textContent = `
    /* 边框流光旋转动画 */
    @keyframes panel-magic-spin {
      100% { transform: translate(-50%, -50%) rotate(360deg); }
    }

    /* #604 核弹拆除：银色呼吸发光动画已删除 */
    /* box-shadow 动画是 Web 开发中公认的性能杀手，无法使用 GPU 加速，每动一帧都会触发大面积重绘 */
    /* 原 panel-silver-glow 动画已被移除，使用静态 box-shadow 替代 */

    /* 边框流光容器 - mask-composite 镂空法 */
    .panel-magic-glow {
      position: absolute;
      inset: -2px;
      border-radius: inherit;
      padding: 2px;
      pointer-events: none;
      z-index: 50;  /* 选中边框流光效果 */
      /* 核心魔法：用遮罩挖空中间，只留边框 */
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      mask-composite: exclude;
      overflow: hidden;
    }

    .panel-magic-glow::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 300%;
      height: 300%;
      transform: translate(-50%, -50%) rotate(0deg);
      /* 最纯正的流光尾巴：前面透明，后面亮白 */
      background: conic-gradient(from 0deg, transparent 70%, rgba(255,255,255,0.9) 100%);
      animation: panel-magic-spin 1.5s linear infinite;
    }

    /* #604 核弹拆除：box-shadow 动画已移除，改为静态阴影 */
    .panel-silver-active {
      box-shadow: 0 0 15px rgba(192, 192, 192, 0.4), 0 8px 32px rgba(0,0,0,0.6);
    }

    /* #400 生成进度logo闪烁动画 */
    @keyframes pulse {
      0%, 100% {
        transform: scale(1);
        opacity: 1;
      }
      50% {
        transform: scale(1.1);
        opacity: 0.8;
      }
    }
  `;
  document.head.appendChild(style);
}

// #400 扑克牌堆叠配置 - 整体向右移动
// #410 扩展支持更多图片
// #443 X步长10，Y步长7，rotate步长2.2度，scale递减3%
const STACK_OFFSETS = [
  { x: 0, y: 0, rotate: 0, scale: 1 },           // 首图
  { x: 10, y: 7, rotate: 2.2, scale: 0.97 },    // 第2张
  { x: 20, y: 14, rotate: 4.4, scale: 0.94 },    // 第3张
  { x: 30, y: 21, rotate: 6.6, scale: 0.91 },    // 第4张
  { x: 40, y: 28, rotate: 8.8, scale: 0.88 },    // 第5张
  { x: 50, y: 35, rotate: 11.0, scale: 0.85 },   // 第6张
  { x: 60, y: 42, rotate: 13.2, scale: 0.82 },   // 第7张
  { x: 70, y: 49, rotate: 15.4, scale: 0.79 },   // 第8张
];

// #313 GeneratePanelNode - 完全独立的节点组件
// 遵循节点编辑器的局部性原则：
// 1. 内部状态隔离（弹窗状态不污染全局）
// 2. 参数存储在元素自身数据中
// 3. 核心物理特性完整保留（反向缩放、智能拖拽、端口连接）

interface SourceImageEl {
  id: string;
  imageUrl?: string;
  imageKey?: string;  // #365 新增：优先使用 imageKey 获取签名 URL
  x: number;
  y: number;
  width: number;
  height: number;
  isVideo?: boolean;      // #623 是否为视频元素
  videoUrl?: string;      // #623 视频播放 URL
  videoKey?: string;      // #623 视频 Key（持久化）
  videoUrls?: string[];   // #623 视频 URL 数组（视频面板产出）
  videoKeys?: string[];   // #623 视频 Key 数组（视频面板产出）
  isLoading?: boolean;    // #853 上传中状态（COS 异步上传未完成时为 true）
  providerUrl?: string;   // #876 服务商原始URL，作为 /api/canvas/image 的 fallbackUrl
}

// 模型配置项接口（兼容可能为 undefined 的情况）
interface ModelConfigItem {
  resolutions?: { size: string; credits: number }[];
  type?: 'image' | 'video' | 'tool';
  aspectRatios?: string[];
  supportsDuration?: boolean;
  durations?: number[];  // 视频模型时长选项（从数据库解析为秒数数组）
  maxRefImages?: number;  // 视频模型最大参考图数量
  imageMode?: 'first_last_frame' | 'component_reference';  // 参考图模式
  supportsUpsample?: boolean;  // 是否支持1080P提升（Veo3.1-pro）
  showDuration?: boolean;  // 前端是否显示时长选择（Sora/Veo隐藏）
  showResolution?: boolean;  // 前端是否显示分辨率选择（Sora/Veo隐藏）
}

interface GeneratePanelNodeProps {
  // 元素数据
  el: {
    id: string;
    name?: string;  // #490 面板名称
    x: number;
    y: number;
    width: number;
    height: number;
    sourceIds?: string[];
    // 局部参数（存储在元素自身）
    panelModel?: string;
    panelRatio?: string;
    panelResolution?: string;
    panelQuality?: string;  // #523 T8Star 品质
    panelCount?: number;
    panelPrompt?: string;
    // #327 新增：初始高度（用于比例调整限制）
    originalHeight?: number;
    // #336 新增：初始宽度（用于比例调整取最长边）
    originalWidth?: number;
    // #346 新增：目标类型（文本/图片/视频/音频）
    targetType?: string;
    // #346 新增：是否启用LLM
    llmEnabled?: boolean;
    // #347 新增：面板类型
    // #353 新增：视频面板类型
    panelType?: 'image' | 'text' | 'video';
    // #366 新增：生成状态和错误
    generationStatus?: 'generating' | 'submitted' | 'recovering' | 'completed' | 'failed' | 'expired' | 'idle';
    generationError?: string | null;
    // #文本面板 文本内容（用于刷新后恢复）
    textContent?: string;
  };
  
  // 视图状态
  isSelected: boolean;
  isInputActive: boolean;
  zoom: number;
  pan: { x: number; y: number };  // #493 新增：画布偏移量，用于 Portal 坐标计算
  isBeingSnapped: boolean;  // #性能优化：父组件计算后传入，避免 props 变化导致重渲染
  isAlreadyConnected: boolean;  // #性能优化：父组件计算后传入，避免 props 变化导致重渲染
  
  // #365 性能优化：只传递 sourceIds，在 handleGenerateClick 中懒计算
  sourceIds: string[];
  
  // 模型配置
  modelDisplayNames: Record<string, string>;
  modelConfig: Record<string, ModelConfigItem>;
  imageModelOptions: string[];
  videoModelOptions: string[];
  llmModelOptions: string[];
  
  // 用户状态
  credits: number;
  isGenerating: boolean;
  
  // #367 悬浮元素 ID（用于 Handle 悬浮显示逻辑，完全复刻图片节点）
  hoveredElementId: string | null;
  
  // #367 主题（用于 Handle 样式动态切换，完全复刻图片节点）
  theme: 'dark' | 'light';
  
  // 选中元素列表（用于多选拖动）
  selectedIds: string[];
  // #366 扩展：包含 type 和 sourceIds 用于查找已连接的 image-stack
  allElements: { 
    id: string; 
    x: number; 
    y: number; 
    width: number; 
    height: number;
    type?: string;
    sourceIds?: string[];
    imageUrls?: string[];
    imageKeys?: string[];
    activeIndex?: number;
    panelType?: 'image' | 'text' | 'video';  // #623 面板类型
    videoUrl?: string;       // #623 视频URL
    videoKey?: string;       // #623 视频Key
    videoUrls?: string[];    // #623 视频URL数组
    videoKeys?: string[];    // #623 视频Key数组
  }[];
  
  // #344 双向磁吸拦截：返回吸附后的坐标
  onDragMove: (id: string, x: number, y: number, w: number, h: number) => { snappedX: number; snappedY: number };
  onDragEnd: () => void;
  
  // #317 修复：使用 CanvasElement 类型以支持原地进化
  onUpdateElement: (id: string, data: Partial<CanvasElement>) => void;
  onSelectElement: (id: string, additive: boolean) => void;
  onSetActiveInputNode: (id: string | null) => void;
  getCurrentInputNodeId: () => string | null;  // 新增：获取当前输入节点 ID
  onAddElement: (element: {
    type: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string;
    stroke: string;
    strokeWidth: number;
    opacity: number;
    rotation: number;
    visible: boolean;
    locked: boolean;
    imageUrl: string;
    imageKey?: string;
    sourceType: string;
    sourcePrompt: string;
  }) => void;
  
  // 端口连接回调
  onInputPortPointerUp: (panelId: string) => void;
  onOutputPortPointerDown: (panelId: string, startX: number, startY: number) => void;
  onRemoveSourceImage: (panelId: string, imageId: string) => void;
  // #60fps Phase1: 移除 setSnapHighlightId prop，改用 DOM class 控制
  
  // #318 新增：参考图拖拽排序回调
  onReorderSourceImages?: (panelId: string, fromIndex: number, toIndex: number) => void;
  
  // #330 新增：面板右键菜单功能
  onDuplicatePanel?: (panelId: string) => void;  // 创建副本
  onDeletePanel?: (panelId: string) => void;     // 删除面板

  // #372 新增：取消连线菜单状态（点击面板时调用）
  onCancelConnection?: () => void;
  
  // #480 新增：取消画布选中状态（拖动面板时调用）
  onClearCanvasSelection?: () => void;
  
  // #490 新增：发送到对话
  onSendToChat?: (elementId: string, imageUrl?: string, imageName?: string) => void;
  
  // #382 全局连线状态 ref（解决 React 渲染延迟问题）
  isConnectionActiveGlobalRef?: React.MutableRefObject<boolean>;
  
  // #452 新增：获取最新元素（解决 React 状态更新延迟问题）
  getLatestElement?: (id: string) => { imageKey?: string; imageUrl?: string } | undefined;
  
  // 平移模式检查
  activeTool?: string;
}

// #606 军师核级别隔离舱：将面板组件改为 const 定义，准备用 React.memo 包装
const GeneratePanelNodeComponent = ({
  el,
  isSelected,
  isInputActive,
  zoom,
  pan,  // #493 新增：画布偏移量
  isBeingSnapped,  // #性能优化：父组件计算后传入
  isAlreadyConnected,  // #性能优化：父组件计算后传入
  sourceIds,
  modelDisplayNames,
  modelConfig,
  imageModelOptions,
  videoModelOptions,
  llmModelOptions,
  credits,
  isGenerating,
  hoveredElementId,  // #367 悬浮元素 ID（用于 Handle 悬浮显示）
  theme,             // #367 主题（用于 Handle 样式动态变化）
  selectedIds,
  allElements,
  onDragMove,  // #343 面板拖拽对齐磁吸
  onDragEnd,   // #343 面板拖拽结束
  onUpdateElement,
  onSelectElement,
  onSetActiveInputNode,
  getCurrentInputNodeId,
  onAddElement,
  onInputPortPointerUp,
  onOutputPortPointerDown,
  onRemoveSourceImage,
  // #60fps Phase1: 移除 setSnapHighlightId，改用 DOM class 控制
  onReorderSourceImages,  // #318 新增：参考图拖拽排序
  onDuplicatePanel,       // #330 新增：创建副本
  onDeletePanel,          // #330 新增：删除面板
  onCancelConnection,     // #372 新增：取消连线菜单状态
  onClearCanvasSelection, // #480 新增：取消画布选中状态（拖动面板时调用）
  onSendToChat,           // #490 新增：发送到对话
  isConnectionActiveGlobalRef,  // #382 全局连线状态 ref（解决 React 渲染延迟问题）
  getLatestElement,       // #452 新增：获取最新元素（解决 React 状态更新延迟问题）
  activeTool,             // 平移模式检查
}: GeneratePanelNodeProps) => {
  // ====== 从 Context 获取收藏和生成相关数据 (#351 #364) ======
  // #511 修复：解构 isLoggedIn 和 setAuthModalOpen 用于登录检查
  const { favorites, setFavorites, handleGenerate: contextHandleGenerate, setInfoDialog, isLoggedIn, setAuthModalOpen } = useAIGenerator();
  
  // ====== #405 修复：使用统一的参考图提取 Hook ======
  const { extractReferenceImages } = useReferenceImages();
  
  // ====== #370 修复：参考图 URL 过期后重新获取 ======
  const [refreshedImageUrls, setRefreshedImageUrls] = useState<Record<string, string>>({});
  const failedImageIdsRef = useRef<Set<string>>(new Set());
  
  // ====== #426 修复：图片加载失败重试计数器，防止死循环 ======
  const imgRetryCountRef = useRef<Record<string, number>>({});
  
  // ====== #426 修复：图片加载失败自动愈合函数（带熔断保护） ======
  // #525 混合架构：智能降级链 providerUrl → proxyUrl → 熔断
  const handleImageError = useCallback((key: string | null | undefined, indexOrId: string) => {
    if (!key) return;

    // #525 混合架构：检查当前图片是服务商URL还是代理URL
    // #863 修复：currentUrl 也要检查 providerUrls（因为初始 src 现在优先使用 providerUrls）
    const currentUrl = refreshedImageUrls[`${el.id}-main-${indexOrId}`] 
      || ((el as any).providerUrls as string[])?.[Number(indexOrId)]
      || ((el as any).imageUrls as string[])?.[Number(indexOrId)] 
      || '';
    const isProxyUrl = currentUrl.startsWith('/api/canvas/image');
    const providerUrls = (el as any).providerUrls as string[] | undefined;
    const isProviderUrl = !isProxyUrl && providerUrls?.[Number(indexOrId)] && currentUrl === providerUrls[Number(indexOrId)];

    if (isProviderUrl) {
      // 第1级降级：服务商URL失败 → 尝试代理URL
      // #842 移除 _t=${Date.now()}：缓存杀手打穿浏览器缓存 → 每次重绘都刷 COS
      const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(key)}`;
      setRefreshedImageUrls(p => ({ 
        ...p, 
        [`${el.id}-main-${indexOrId}`]: proxyUrl 
      }));
      return;
    }

    // 代理URL也失败了 → 进入重试+熔断逻辑
    const currentRetries = imgRetryCountRef.current[key] || 0;
    if (currentRetries >= 3) {
      console.warn(`[面板图片愈合] 🛑 图片 ${key} 重试超过3次已熔断，停止请求`);
      return;
    }

    imgRetryCountRef.current[key] = currentRetries + 1;

    // #842 移除 _t=${Date.now()}：缓存杀手打穿浏览器缓存 → 每次重绘都刷 COS
    const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(key)}`;
    setRefreshedImageUrls(p => ({ 
      ...p, 
      [`${el.id}-main-${indexOrId}`]: proxyUrl 
    }));
  }, [el.id, el, refreshedImageUrls]);
  
  // ====== #366 增强：支持面板级联查找 image-stack ======
  // ⚠️ #366 修正：严格数据隔离 - 只传递资产（参考图），不传递状态（参数）
  // 当 sourceIds 中是面板 ID 时，需要级联查找该面板上方的 image-stack
  const sourceImageEls = useMemo(() => {
    const imageEls: SourceImageEl[] = [];
    
    for (const id of sourceIds) {
      const sourceEl = allElements.find(e => e.id === id);
      if (!sourceEl) continue;
      
      // ====== 情况1：直接连接的图片元素 ======
      // #868 修复：imageUrl 必须走 COS 双链路，严禁直传 providerUrl 给后端
      if ((sourceEl as any).type === 'image') {
        const imgKey = (sourceEl as any).imageKey;
        // #876 架构重构：providerUrl 作为 fallbackUrl 拼接，COS 找不到时 Node.js 代理
        const providerUrl = (sourceEl as any).providerUrl || ((sourceEl as any).providerUrls as string[])?.[0];
        const fallbackParam = (providerUrl && (providerUrl.startsWith('http://') || providerUrl.startsWith('https://')))
          ? `&fallbackUrl=${encodeURIComponent(providerUrl)}`
          : '';
        const safeUrl = imgKey ? `/api/canvas/image?key=${encodeURIComponent(imgKey)}${fallbackParam}` : (sourceEl as any).imageUrl;
        imageEls.push({
          id: sourceEl.id,
          imageUrl: safeUrl,  // #876 COS 代理 URL + fallbackUrl
          imageKey: imgKey,
          providerUrl,  // #876 保留原始 providerUrl 用于下载等场景
          x: sourceEl.x,
          y: sourceEl.y,
          width: sourceEl.width,
          height: sourceEl.height,
          isLoading: (sourceEl as any).isLoading ?? false,  // #853 上传中状态
        });
      }
      
      // ====== 情况2：直接连接的图片栈元素 ======
      // #868 修复：取 activeIndex 对应的 imageKey 生成 COS 代理 URL
      if ((sourceEl as any).type === 'image-stack') {
        const imageUrls = (sourceEl as any).imageUrls || [];
        const imageKeys = (sourceEl as any).imageKeys || [];
        const activeIndex = (sourceEl as any).activeIndex ?? 0;
        const imageUrl = imageUrls[activeIndex];
        const imageKey = imageKeys[activeIndex];
        // #876 架构重构：providerUrl 作为 fallbackUrl
        const providerUrl = (sourceEl as any).providerUrl || ((sourceEl as any).providerUrls as string[])?.[activeIndex];
        const fallbackParam = (providerUrl && (providerUrl.startsWith('http://') || providerUrl.startsWith('https://')))
          ? `&fallbackUrl=${encodeURIComponent(providerUrl)}`
          : '';
        const safeUrl = imageKey ? `/api/canvas/image?key=${encodeURIComponent(imageKey)}${fallbackParam}` : imageUrl;
        if (safeUrl || imageKey) {
          imageEls.push({
            id: sourceEl.id,
            imageUrl: safeUrl,  // #876 COS 代理 URL + fallbackUrl
            imageKey: imageKey,
            providerUrl,  // #876 保留原始 providerUrl
            x: sourceEl.x,
            y: sourceEl.y,
            width: sourceEl.width,
            height: sourceEl.height,
            isLoading: (sourceEl as any).isLoading ?? false,  // #853 上传中状态
          });
        }
      }
      
      // ====== 情况2.5：直接连接的视频元素 ======
      // #623 视频缩略图：使用视频首帧作为缩略图，同时传递视频URL
      // #868 修复：videoKey 走 COS 代理
      if ((sourceEl as any).type === 'video') {
        const videoUrl = (sourceEl as any).videoUrl || ((sourceEl as any).videoUrls?.length > 0 ? (sourceEl as any).videoUrls[0] : undefined);
        const videoKey = (sourceEl as any).videoKey || ((sourceEl as any).videoKeys?.length > 0 ? (sourceEl as any).videoKeys[0] : undefined);
        // #876 架构重构：providerUrl 作为 fallbackUrl
        const providerUrl = (sourceEl as any).providerUrl || ((sourceEl as any).providerUrls as string[])?.[0];
        const fallbackParam = (providerUrl && (providerUrl.startsWith('http://') || providerUrl.startsWith('https://')))
          ? `&fallbackUrl=${encodeURIComponent(providerUrl)}`
          : '';
        const safeVideoUrl = videoKey ? `/api/canvas/image?key=${encodeURIComponent(videoKey)}${fallbackParam}` : videoUrl;
        // 视频缩略图使用视频URL本身（浏览器会自动取首帧），同时记录视频信息
        imageEls.push({
          id: sourceEl.id,
          imageUrl: safeVideoUrl,  // #876 COS 代理 URL + fallbackUrl
          imageKey: videoKey,  // 视频Key用于持久化
          providerUrl,
          x: sourceEl.x,
          y: sourceEl.y,
          width: sourceEl.width,
          height: sourceEl.height,
          isVideo: true,
          videoUrl: videoUrl,  // 原始视频URL保留用于视频生成参数
          videoKey: videoKey,
          isLoading: (sourceEl as any).isLoading ?? false,  // #853 上传中状态
        });
      }
      
      // ====== 情况3：面板级联查找 ======
      // 当 sourceIds 中是面板 ID 时，查找该面板上方的 image-stack
      // ⚠️ 只查找该面板直接产出的 image-stack（sourceIds 包含面板 ID）
      if ((sourceEl as any).type === 'generate-panel') {
        // 查找连接到该面板的 image-stack（sourceIds 包含面板 ID）
        const connectedStack = allElements.find(e => 
          (e as any).type === 'image-stack' && 
          (e as any).sourceIds?.includes(id)
        );
        
        if (connectedStack) {
          const imageUrls = (connectedStack as any).imageUrls || [];
          const imageKeys = (connectedStack as any).imageKeys || [];
          const activeIndex = (connectedStack as any).activeIndex ?? 0;
          const imageUrl = imageUrls[activeIndex];
          const imageKey = imageKeys[activeIndex];
          // #876 架构重构：providerUrl 作为 fallbackUrl
          const providerUrl = (connectedStack as any).providerUrl || ((connectedStack as any).providerUrls as string[])?.[activeIndex];
          const fallbackParam = (providerUrl && (providerUrl.startsWith('http://') || providerUrl.startsWith('https://')))
            ? `&fallbackUrl=${encodeURIComponent(providerUrl)}`
            : '';
          const safeUrl = imageKey ? `/api/canvas/image?key=${encodeURIComponent(imageKey)}${fallbackParam}` : imageUrl;
          
          if (safeUrl || imageKey) {
            imageEls.push({
              id: connectedStack.id,
              imageUrl: safeUrl,  // #876 COS 代理 URL + fallbackUrl
              imageKey: imageKey,
              providerUrl,
              x: connectedStack.x,
              y: connectedStack.y,
              width: connectedStack.width,
              height: connectedStack.height,
              isLoading: (connectedStack as any).isLoading ?? false,  // #853 上传中状态
            });
          }
        } else {
          // #423 回退：如果没有连接的 image-stack，直接提取面板当前的激活主图
          // 注意：面板切换主图时会重排数组，所以 imageUrls[0] 始终是当前主图
          
          // #623 视频面板回退：提取视频URL而非图片URL
          const isVideoPanel = (sourceEl as any).panelType === 'video';
          
          if (isVideoPanel) {
            // 视频面板：提取视频URL
            const panelVideoUrls = (sourceEl as any).videoUrls || [];
            const panelVideoKeys = (sourceEl as any).videoKeys || [];
            const activeVideoUrl = panelVideoUrls[0];
            const activeVideoKey = panelVideoKeys[0];
            const safeVideoUrl = activeVideoKey ? `/api/canvas/image?key=${encodeURIComponent(activeVideoKey)}` : activeVideoUrl;
            
            if (safeVideoUrl || activeVideoKey) {
              imageEls.push({
                id: sourceEl.id,
                imageUrl: safeVideoUrl,  // #868 COS 代理 URL 优先
                imageKey: activeVideoKey,
                x: sourceEl.x,
                y: sourceEl.y,
                width: sourceEl.width,
                height: sourceEl.height,
                isVideo: true,
                videoUrl: activeVideoUrl,
                videoKey: activeVideoKey,
                videoUrls: panelVideoUrls,
                videoKeys: panelVideoKeys,
                isLoading: false,  // #853 面板产出的视频已完成生成，不上传中
              });
            }
          } else {
            // 图片面板：提取图片URL
            const panelImageUrls = (sourceEl as any).imageUrls || [];
            const panelImageKeys = (sourceEl as any).imageKeys || [];
            const activeImageUrl = panelImageUrls[0];
            const activeImageKey = panelImageKeys[0];
            const safeImgUrl = activeImageKey ? `/api/canvas/image?key=${encodeURIComponent(activeImageKey)}` : activeImageUrl;
            
            if (safeImgUrl || activeImageKey) {
              imageEls.push({
                id: sourceEl.id,
                imageUrl: safeImgUrl,  // #868 COS 代理 URL 优先
                imageKey: activeImageKey,
                x: sourceEl.x,
                y: sourceEl.y,
                width: sourceEl.width,
                height: sourceEl.height,
                isLoading: false,  // #853 面板产出的图片已完成生成，不上传中
              });
            }
          }
        }
      }
      
      // ⚠️ 注意：不提取文本面板的文本内容！
      // 文本面板的文本内容属于"状态"，不是"资产"，严禁继承！
      // 下游面板必须自行输入提示词，不得继承上游面板的提示词。
    }
    
    return imageEls;
  }, [sourceIds, allElements]);
  
  // ====== #370 修复：参考图 URL 过期后重新获取 ======
  // 当 sourceImageEls 变化时，检查并刷新过期的图片 URL
  useEffect(() => {
    const refreshExpiredUrls = async () => {
      for (const img of sourceImageEls) {
        // #623 视频缩略图刷新
        if (img.isVideo) {
          if ((!img.videoUrl && !img.imageUrl) || failedImageIdsRef.current.has(img.id)) {
            if (img.videoKey) {
              // 视频Key -> 使用视频代理URL
              const proxyUrl = `/api/video/proxy?key=${encodeURIComponent(img.videoKey)}`;
              setRefreshedImageUrls(prev => ({ ...prev, [img.id]: proxyUrl }));
            }
          }
          continue;
        }
        // 如果 imageUrl 无效但有 imageKey，使用代理 URL
        if ((!img.imageUrl || failedImageIdsRef.current.has(img.id)) && img.imageKey) {
          // #524 修复：使用代理 URL 替代签名 URL（浏览器直连 COS 超时）
          const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(img.imageKey)}`;
          setRefreshedImageUrls(prev => ({ ...prev, [img.id]: proxyUrl }));
        }
      }
    };
    
    refreshExpiredUrls();
  }, [sourceImageEls]);
  
  // ====== #366 查找已连接的 image-stack ======
  // 遍历所有元素，找到 sourceIds 包含当前面板 ID 的 image-stack
  const findConnectedImageStack = useCallback((): { 
    id: string; 
    imageUrls: string[]; 
    imageKeys: string[];
    x: number; 
    y: number; 
    width: number; 
    height: number;
  } | null => {
    for (const element of allElements) {
      if (element.type === 'image-stack' && element.sourceIds?.includes(el.id)) {
        return {
          id: element.id,
          imageUrls: element.imageUrls || [],
          imageKeys: element.imageKeys || [],
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
        };
      }
    }
    return null;
  }, [allElements, el.id]);
  
  // ====== #366 覆盖确认弹窗状态 ======
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [pendingGenerateParams, setPendingGenerateParams] = useState<{
    prompt: string;
    referenceImages: string[];
    isUrls: boolean;
  } | null>(null);
  
  // ====== #366 计算新 image-stack 的位置（面板正上方，带边界检测）======
  const calculateImageStackPosition = useCallback((
    panelX: number, 
    panelY: number, 
    panelWidth: number, 
    panelHeight: number,
    stackSize: number = 280,
    canvasWidth: number = 10000,
    canvasHeight: number = 10000
  ): { x: number; y: number } => {
    // 默认位置：面板正上方，底部与面板顶部对齐
    const gap = 20; // 与面板的间距
    const defaultX = panelX + (panelWidth - stackSize) / 2; // 水平居中
    const defaultY = panelY - stackSize - gap; // 面板上方
    
    // 边界检测
    let finalX = defaultX;
    let finalY = defaultY;
    
    // 上边界检测：如果上方空间不够，放到面板下方
    if (defaultY < 0) {
      finalY = panelY + panelHeight + gap;
    }
    
    // 左右边界检测
    if (finalX < 0) {
      finalX = 0;
    } else if (finalX + stackSize > canvasWidth) {
      finalX = canvasWidth - stackSize;
    }
    
    // 下边界检测
    if (finalY + stackSize > canvasHeight) {
      finalY = canvasHeight - stackSize;
    }
    
    return { x: finalX, y: finalY };
  }, []);
  
  // ====== 图片 URL 转 base64 辅助函数 ======
  const imageUrlToBase64 = useCallback(async (url: string): Promise<string> => {
    // 如果已经是 base64，直接返回
    if (url.startsWith('data:')) {
      return url;
    }
    
    // 对于 http/https URL 或 blob URL，使用 fetch 获取图片
    if (url.startsWith('http') || url.startsWith('blob:')) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`获取图片失败: ${response.status}`);
        }
        const blob = await response.blob();
        
        // 检查是否是图片类型
        if (!blob.type.startsWith('image/')) {
          throw new Error(`返回的不是图片: ${blob.type}`);
        }
        
        // 转换为 base64
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve(reader.result as string);
          };
          reader.onerror = () => reject(new Error('FileReader 失败'));
          reader.readAsDataURL(blob);
        });
      } catch (error: any) {
        throw error;
      }
    }
    
    throw new Error(`不支持的 URL 格式: ${url.substring(0, 50)}`);
  }, []);

  // #353 根据 panelType 获取对应的收藏 API 路径
  const getFavoritesApiPath = useCallback(() => {
    if (el.panelType === 'text') {
      return '/api/text-panel-favorites';  // 提示词面板独立收藏
    }
    if (el.panelType === 'video') {
      return '/api/video-favorites';  // 视频面板与视频页面共享收藏
    }
    // 图片面板使用 prompt-favorites（与生图页面共享）
    return '/api/prompt-favorites';
  }, [el.panelType]);

  // #351 收藏相关函数
  const fetchFavorites = useCallback(async () => {
    try {
      const apiPath = getFavoritesApiPath();
      const res = await fetch(apiPath, { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setFavorites(data.favorites || []);
      }
    } catch (error) {
      console.error('Failed to fetch favorites:', error);
    }
  }, [setFavorites, getFavoritesApiPath]);

  const handleAddFavorite = useCallback(async (content: string) => {
    try {
      const apiPath = getFavoritesApiPath();
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        await fetchFavorites();
      }
    } catch (error) {
      console.error('Failed to add favorite:', error);
    }
  }, [fetchFavorites, getFavoritesApiPath]);

  const handleDeleteFavorite = useCallback(async (id: number) => {
    try {
      const apiPath = getFavoritesApiPath();
      const res = await fetch(`${apiPath}?id=${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        await fetchFavorites();
      }
    } catch (error) {
      console.error('Failed to delete favorite:', error);
    }
  }, [fetchFavorites, getFavoritesApiPath]);

  const handleUpdateFavorite = useCallback(async (id: number, content: string) => {
    try {
      const apiPath = getFavoritesApiPath();
      const res = await fetch(apiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, content }),
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        await fetchFavorites();
      }
    } catch (error) {
      console.error('Failed to update favorite:', error);
    }
  }, [fetchFavorites, getFavoritesApiPath]);

  // ====== 一、彻底的内部状态隔离 (Local State) ======
  const [localModelPicker, setLocalModelPicker] = useState(false);
  const [localRatioPicker, setLocalRatioPicker] = useState(false);
  const [localResolutionPicker, setLocalResolutionPicker] = useState(false);
  const [localCountPicker, setLocalCountPicker] = useState(false);
  const [localQualityPicker, setLocalQualityPicker] = useState(false);  // #523 T8Star 品质弹窗

  // #视频参数选择器弹窗
  const [localVideoDurationPicker, setLocalVideoDurationPicker] = useState(false);
  const [localVideoAspectRatioPicker, setLocalVideoAspectRatioPicker] = useState(false);
  const [localVideoSizePicker, setLocalVideoSizePicker] = useState(false);
  
  // #弹窗修复：按钮 ref + 弹窗位置状态（用于 createPortal fixed 定位）
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const ratioButtonRef = useRef<HTMLButtonElement>(null);
  const resolutionButtonRef = useRef<HTMLButtonElement>(null);
  const qualityButtonRef = useRef<HTMLButtonElement>(null);  // #523 T8Star 品质
  const countButtonRef = useRef<HTMLButtonElement>(null);
  const videoDurationButtonRef = useRef<HTMLButtonElement>(null);
  const videoAspectRatioButtonRef = useRef<HTMLButtonElement>(null);
  const videoSizeButtonRef = useRef<HTMLButtonElement>(null);
  const [pickerPositions, setPickerPositions] = useState<{
    model: { left: number; bottom: number } | null;
    ratio: { left: number; bottom: number } | null;
    resolution: { left: number; bottom: number } | null;
    quality: { left: number; bottom: number } | null;  // #523 T8Star 品质
    count: { left: number; bottom: number } | null;
    videoDuration: { left: number; bottom: number } | null;
    videoAspectRatio: { left: number; bottom: number } | null;
    videoSize: { left: number; bottom: number } | null;
  }>({ model: null, ratio: null, resolution: null, quality: null, count: null, videoDuration: null, videoAspectRatio: null, videoSize: null });
  
  // #弹窗修复：计算弹窗位置的辅助函数
  const calculatePickerPosition = (buttonRef: React.RefObject<HTMLButtonElement | null>) => {
    if (!buttonRef.current) return null;
    const rect = buttonRef.current.getBoundingClientRect();
    return {
      left: rect.left,
      bottom: window.innerHeight - rect.top + 4, // 弹窗显示在按钮上方，间距 4px
    };
  };
  
  // #353 视频面板默认显示视频模型Tab
  const [localModelTab, setLocalModelTab] = useState<'image' | 'video'>(el.panelType === 'video' ? 'video' : 'image');
  
  // 关闭所有弹窗
  const closeAllPickers = useCallback(() => {
    setLocalModelPicker(false);
    setLocalRatioPicker(false);
    setLocalResolutionPicker(false);
    setLocalQualityPicker(false);  // #523 T8Star 品质
    setLocalCountPicker(false);
    setLocalVideoDurationPicker(false);
    setLocalVideoAspectRatioPicker(false);
    setLocalVideoSizePicker(false);
  }, []);
  
  // #弹窗修复：画布缩放时自动关闭弹窗（护航军规第2条）
  useEffect(() => {
    closeAllPickers();
  }, [zoom, closeAllPickers]);
  
  // #弹窗修复：监听 wheel 事件，画布滚动/缩放时关闭弹窗
  useEffect(() => {
    const handleWheel = () => {
      closeAllPickers();
    };
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, [closeAllPickers]);
  
  // 局部参数（从元素自身数据读取，有默认值）
  // #357 修复：使用模型列表的第一个作为默认值，而非硬编码
  // 文本面板使用 LLM 模型，图片/视频面板使用对应类型模型
  const localModel = el.panelModel || (
    el.panelType === 'text' 
      ? (llmModelOptions[0] || 'gemini-3.1-pro')
      : el.panelType === 'video' 
        ? (videoModelOptions[0] || '') 
        : (imageModelOptions[0] || '')
  );
  // #491 修复：如果模型支持 auto，优先使用 auto；否则使用第一个可用比例
  const getInitialRatio = useCallback(() => {
    const config = modelConfig?.[localModel];
    const supportedRatios = config?.aspectRatios || ['1:1', '3:4', '4:3', '9:16', '16:9', '3:2', '2:3', '4:5', '5:4'];
    
    // #493 修复：优先使用第一个非 auto 比例（auto 被后端映射为 1:1，不符合用户预期）
    const nonAutoRatios = supportedRatios.filter((r: string) => r !== 'auto');
    if (nonAutoRatios.length > 0) {
      return nonAutoRatios[0];
    }
    
    // 兜底：使用第一个可用比例
    return supportedRatios[0] || '1:1';
  }, [modelConfig, localModel]);

  // #496 修复：优先使用用户选择的比例（el.panelRatio），没有才用默认值
  const localRatio = el.panelRatio || getInitialRatio();
  const localResolution = el.panelResolution || '1K';
  const localQuality = el.panelQuality || 'auto';  // #523 T8Star 品质
  const localCount = el.panelCount || 1;
  const totalImages = localCount;  // #401 总图片数
  const hasImages = ((el as any).imageUrls as string[])?.length > 0;  // #401 是否有图片
  
  // #529 修复：统一圆角半径，基于面板最短边计算，避免1:3长竖图垂直半径过大
  // 3% 在 1:3 面板上：水平=9.6px，垂直=28.8px → 视觉上顶部底部"超出"图片
  // 改为始终基于最短边的 3%，保证任何比例的圆角大小一致
  const panelBorderRadius = Math.round(Math.min(el.width, el.height) * 0.03);
  
  // #482 动态获取当前模型支持的比例选项
  const currentModelConfig = modelConfig?.[localModel];
  const _isHHModel = ModelDetector.getFamily(localModel) === 'happyhorse';
  const aspectRatioOptions = (() => {
    // #636 HappyHorse 强制 5 个比例
    if (_isHHModel) return ['16:9', '9:16', '1:1', '4:3', '3:4'];
    const ratios = currentModelConfig?.aspectRatios?.length 
      ? currentModelConfig.aspectRatios 
      : ['1:1', '3:4', '4:3', '9:16', '16:9', '3:2', '2:3', '4:5', '5:4'];  // #493 默认比例列表去掉 auto
    // #865 MiniMax: 确保 adaptive 在列表中（变灰显示，t2v不可选/i2v固定adaptive）
    if (ModelDetector.getFamily(localModel) === 'topais-minimax' && !ratios.includes('adaptive')) {
      return [...ratios, 'adaptive'];
    }
    return ratios;
  })();
  
  // #视频生成参数
  const localVideoDuration = (el as any).videoDuration || 10;  // 视频时长（秒）
  const localVideoAspectRatio = (el as any).videoAspectRatio || '16:9';  // 视频比例
  const localVideoSize = (el as any).videoResolution || (el as any).videoSize || '720p';  // 视频分辨率（兼容旧字段 videoSize）
  const hasVideos = ((el as any).videoUrls as string[])?.length > 0;  // 是否有视频
  
  // 格式化视频分辨率：small→720P, medium→720P, large→1080P, 720p→720P 等
  const formatVideoResolution = (res: string): string => {
    if (!res) return '720P';
    const lower = res.toLowerCase();
    const mapping: Record<string, string> = {
      'small': '720P', 'medium': '720P', 'large': '1080P',
      '720p': '720P', '1080p': '1080P', '480p': '480P',
      '360p': '360P', '2k': '2K', '4k': '4K',
    };
    return mapping[lower] || res.toUpperCase();
  };
  
  // #547 Sora-2 动态时长过滤：文生视频只有10s，图生视频4/8/10/12s
  // #635 HappyHorse 动态时长：3-15秒（每整数秒）
  // #640 灵芽 Sora-2 VIP：#641 前端2合1，统一入口 sora-2-all-vip，内部10s/15s可选
  const isSora2Model = localModel === 'sora-2';
  const isLingyaSoraVip = localModel.startsWith('sora-2-all-vip');
  const isHHModel = _isHHModel;
  const isTopaisModelForDuration = ModelDetector.getFamily(localModel) === 'topais';  // #690 TOPAIS 用于时长判断（提前定义）
  const hasReferenceImages = sourceImageEls.length > 0;
  const availableDurations = useMemo(() => {
    // #641 灵芽 Sora-2 VIP：10s/15s 可选（2合1）
    if (isLingyaSoraVip) {
      return [10, 15];
    }
    // #636 HappyHorse 强制 3-15 秒每整数秒
    if (isHHModel) {
      return Array.from({ length: 13 }, (_, i) => i + 3); // [3, 4, 5, ..., 15]
    }
    // #833 TOPAIS Gemini Omni Flash 支持 4/6/8/10 秒时长
    const isTopaisGeminiOmniForDuration = ModelDetector.getFamily(localModel) === 'topais-gemini-omni';
    if (isTopaisGeminiOmniForDuration) {
      return [4, 6, 8, 10];
    }
    // #690 TOPAIS Veo3.1-fast 固定 8 秒
    if (isTopaisModelForDuration) {
      return [8];
    }
    // durations 可能是 number[] 或 { label, value, credits }[] 格式
    const rawDurations = currentModelConfig?.durations;
    let allDurations: number[];
    
    if (rawDurations && rawDurations.length > 0) {
      // 检查是否为对象数组格式
      if (typeof rawDurations[0] === 'object') {
        // { label, value, credits }[] 格式，提取 value 为数字
        allDurations = (rawDurations as any[]).map((d: any) => {
          const secs = parseInt(d.value || d.label);
          return isNaN(secs) ? 10 : secs;
        });
      } else {
        // number[] 格式
        allDurations = rawDurations as number[];
      }
    } else {
      // 默认兜底
      allDurations = [5, 10];
    }
    
    if (!isSora2Model) return allDurations;
    // Sora-2 文生视频（无参考图）：只有 10s
    if (!hasReferenceImages) return allDurations.filter((d: number) => d === 10);
    // Sora-2 图生视频（有参考图）：4/8/10/12s
    return allDurations;
  }, [currentModelConfig?.durations, isSora2Model, isLingyaSoraVip, isHHModel, hasReferenceImages, localModel]);
  
  // #547 Sora-2 参考图变化时，自动重置时长
  // #641 灵芽 Sora-2 VIP 2合1：默认10s，不需要强制重置（用户可切换10/15）
  // #690 TOPAIS 固定 8 秒：自动重置为 8 秒
  useEffect(() => {
    if (isLingyaSoraVip) {
      // 统一入口 sora-2-all-vip：确保时长在 [10, 15] 范围内
      if (localVideoDuration !== 10 && localVideoDuration !== 15) {
        updateElementData({ videoDuration: 10 } as any);
      }
      return;
    }
    if (isSora2Model && !availableDurations.includes(localVideoDuration)) {
      updateElementData({ videoDuration: 10 } as any);
    }
  }, [isSora2Model, availableDurations, localVideoDuration]);
  
  // #633 HappyHorse 模型模式切换
  // HappyHorse: 从连线源获取图片和视频 URL
  // #641 修复：排除视频元素，只提取真正的图片 URL（视频元素的 imageUrl 是视频URL用于缩略图显示）
  const connectedImageUrls = useMemo(() => {
    return sourceImageEls.filter(el => !el.isVideo).map(el => el.imageUrl).filter(Boolean) as string[];
  }, [sourceImageEls]);
  
  const connectedVideoUrl = useMemo(() => {
    // 检查是否有视频类型的源元素
    for (const id of sourceIds) {
      const sourceEl = allElements.find(e => e.id === id);
      if (sourceEl && (sourceEl as any).type === 'video') {
        return (sourceEl as any).videoUrl || null;
      }
    }
    return null;
  }, [sourceIds, allElements]);
  
  // #663 统一使用 ModelDetector.getFamily() 判断模型
  const _modelFamily = ModelDetector.getFamily(localModel);
  const isHappyHorseModel = _modelFamily === 'happyhorse';
  const isT8SeedanceModel = _modelFamily === 't8seedance';
  const isSeedance2Model = _modelFamily === 'seedance2';
  const isTopaisModel = _modelFamily === 'topais';  // #690 TOPAIS Veo 独立标识
  const isTopaisHhModel = _modelFamily === 'topais-happyhorse';  // #691 TOPAIS HappyHorse 独立标识
  const isTopaisSeedanceModel = _modelFamily === 'topais-seedance';  // TOPAIS Seedance 2.0 独立标识
  const isTopaisGeminiOmniModel = _modelFamily === 'topais-gemini-omni';  // TOPAIS Gemini Omni Flash 独立标识
  const isLingyaVeoModel = _modelFamily === 'lingya-veo';  // LingYa Veo3.1 独立标识
  const isLingyaSoraModel = _modelFamily === 'lingya-sora';  // LingYa Sora-2 VIP 独立标识
  const isMegaAiSeedanceModel = _modelFamily === 'mega-ai-seedance';  // MEGA AI Seedance 2.0 独立标识
  const isTopaisMinimaxModel = _modelFamily === 'topais-minimax';  // TOPAIS MiniMax-H3 独立标识
  const isTopaisKlingOmniModel = _modelFamily === 'topais-kling-omni';  // TOPAIS Kling v3 Omni 独立标识
  const isModeSwitchVideoModel = isHappyHorseModel || isT8SeedanceModel || isSeedance2Model || isTopaisModel || isTopaisHhModel || isTopaisSeedanceModel || isTopaisGeminiOmniModel || isLingyaVeoModel || isLingyaSoraModel || isMegaAiSeedanceModel || isTopaisMinimaxModel || isTopaisKlingOmniModel;
  const [hhOverrideMode, setHhOverrideMode] = useState<VideoMode | null>(null);
  const [hhAudioSetting, setHhAudioSetting] = useState<'auto' | 'origin'>('auto');
  const [generateAudio, setGenerateAudio] = useState(true); // Seedance 音频生成开关
  const [refAudioFiles, setRefAudioFiles] = useState<{ url: string; name: string; size: number }[]>([]); // #644 Seedance 参考音频
  const panelAudioInputRef = useRef<HTMLInputElement>(null); // #646 面板音频文件输入
  
  // #690 TOPAIS 固定 8 秒：自动重置时长
  useEffect(() => {
    if (isTopaisModel && localVideoDuration !== 8) {
      updateElementData({ videoDuration: 8 } as any);
    }
  }, [isTopaisModel, localVideoDuration]);
  
  // 模式切换模型：判断当前实际模式
  // #665 终极防弹版：跨模型安全校验 + 元素持久化读取
  const hhCurrentMode = useMemo((): VideoMode => {
    if (!isModeSwitchVideoModel) return 't2v';
    
    const family = ModelDetector.getFamily(localModel);

    // 🔴 优先级 1 & 2：合并获取用户的手动选择（当前会话 > 元素持久化）
    const manualMode = hhOverrideMode || (el as any)?.hhMode;
    
    // 🛡️ 核心防线：跨模型安全校验！
    // 只有当用户的手动选择，真实存在于当前模型的二维矩阵支持列表中，才允许生效！
    if (manualMode) {
      const supportedModes = MODEL_MODE_CONSTRAINTS[family] || [];
      if (supportedModes.includes(manualMode)) {
        return manualMode as VideoMode;
      }
      // 💡 如果走到这里，说明用户切换了模型，导致旧模式不兼容，直接降级到自动推导！
      console.log('[GeneratePanelNode] 跨模型安全拦截：手动模式', manualMode, '不被', family, '支持，降级为自动推导');
    }
    
    // 🔴 优先级 3：自动推导（按模型家族独立推导）
    if (family === 'seedance2') {
      // Seedance 2.0: 有视频→r2v，2+图→参考生视频，1图→首帧，否则→t2v
      // #680 修正：2+图即推断为 r2v，与 T8 Seedance 后端对齐（后端只要有参考图就走 r2v）
      if (connectedVideoUrl) return 'r2v';
      if (connectedImageUrls.length >= 2) return 'r2v';
      if (connectedImageUrls.length === 1) return 'i2v-first-frame';
      return 't2v';
    }
    
    if (family === 't8seedance') {
      // #667 T8 sdols-2.0 全模态解锁：2+图即 r2v，与后端逻辑对齐
      if (connectedVideoUrl) return 'r2v';
      if (connectedImageUrls.length >= 2) return 'r2v';
      if (connectedImageUrls.length === 1) return 'i2v-first-frame';
      return 't2v';
    }
    
    if (family === 'happyhorse') {
      // HappyHorse: 有视频→video-edit，多图→r2v，单图→i2v，否则→t2v
      if (connectedVideoUrl) return 'video-edit';
      if (connectedImageUrls.length >= 2) return 'r2v';
      if (connectedImageUrls.length === 1) return 'i2v';
      return 't2v';
    }

    // #690 TOPAIS Veo: 有视频/2+图→r2v，1-2图→i2v，0图→t2v
    if (family === 'topais') {
      if (connectedVideoUrl) return 'r2v';
      if (connectedImageUrls.length >= 2) return 'r2v';
      if (connectedImageUrls.length >= 1) return 'i2v';
      return 't2v';
    }
    
    // #691 TOPAIS HappyHorse: 有视频→video-edit，2+图→r2v，1图→i2v，0图→t2v
    if (family === 'topais-happyhorse') {
      if (connectedVideoUrl) return 'video-edit';
      if (connectedImageUrls.length >= 2) return 'r2v';
      if (connectedImageUrls.length === 1) return 'i2v';
      return 't2v';
    }

    // LingYa Veo3.1: 有视频/2+图→r2v(首尾帧)，1图→i2v(首帧)，0图→t2v
    if (family === 'lingya-veo') {
      if (connectedVideoUrl) return 'r2v';
      if (connectedImageUrls.length >= 2) return 'r2v';
      if (connectedImageUrls.length >= 1) return 'i2v';
      return 't2v';
    }

    // LingYa Sora-2 VIP: 有视频/2+图→r2v，1图→i2v，0图→t2v
    if (family === 'lingya-sora') {
      if (connectedVideoUrl) return 'r2v';
      if (connectedImageUrls.length >= 2) return 'r2v';
      if (connectedImageUrls.length >= 1) return 'i2v';
      return 't2v';
    }

    // TOPAIS Gemini Omni Flash: 3图→r2v，1图→i2v，0图→t2v（不支持2图和视频编辑）
    if (family === 'topais-gemini-omni') {
      if (connectedImageUrls.length >= 3) return 'r2v';
      if (connectedImageUrls.length === 1) return 'i2v';
      return 't2v';
    }

    // MEGA AI Seedance 2.0: 有视频→r2v，2+图→r2v，1图→i2v-first-frame，0图→t2v
    if (family === 'mega-ai-seedance') {
      if (connectedVideoUrl) return 'r2v';
      if (connectedImageUrls.length >= 2) return 'r2v';
      if (connectedImageUrls.length === 1) return 'i2v-first-frame';
      return 't2v';
    }

    // TOPAIS MiniMax-H3: 有视频→r2v，2+图→r2v，1图→i2v-first-frame，0图→t2v
    if (family === 'topais-minimax') {
      if (connectedVideoUrl) return 'r2v';
      if (connectedImageUrls.length >= 2) return 'r2v';
      if (connectedImageUrls.length === 1) return 'i2v-first-frame';
      return 't2v';
    }

    // TOPAIS Kling v3 Omni: 有视频→r2v，2+图→r2v，1图→i2v-first-frame，0图→t2v
    if (family === 'topais-kling-omni') {
      if (connectedVideoUrl) return 'r2v';
      if (connectedImageUrls.length >= 2) return 'r2v';
      if (connectedImageUrls.length === 1) return 'i2v-first-frame';
      return 't2v';
    }

    return 't2v';
  }, [isModeSwitchVideoModel, localModel, el, hhOverrideMode, connectedVideoUrl, connectedImageUrls]);
  
  // 统一：使用 getHappyHorseModeParams / getSeedance2ModeParams / getT8SeedanceModeParams / getTopaisModeParams / getTopaisHhModeParams / getTopaisSeedanceModeParams / getTopaisGeminiOmniModeParams / getMegaAiSeedanceModeParams / getTopaisMinimaxModeParams / getTopaisKlingOmniModeParams 判断各模式参数可见性
  const hhParams = isTopaisMinimaxModel
    ? getTopaisMinimaxModeParams(hhCurrentMode)  // TOPAIS MiniMax-H3 独立参数
    : isTopaisKlingOmniModel
      ? getTopaisKlingOmniModeParams(hhCurrentMode)  // TOPAIS Kling v3 Omni 独立参数
    : isMegaAiSeedanceModel
      ? getMegaAiSeedanceModeParams(hhCurrentMode)  // MEGA AI Seedance 2.0 独立参数
    : isTopaisModel
      ? getTopaisModeParams(hhCurrentMode)  // #690 TOPAIS Veo 独立参数
      : isTopaisHhModel
        ? getTopaisHhModeParams(hhCurrentMode)  // #691 TOPAIS HappyHorse 独立参数
        : isTopaisSeedanceModel
          ? getTopaisSeedanceModeParams(hhCurrentMode)  // TOPAIS Seedance 2.0 独立参数
          : isTopaisGeminiOmniModel
            ? getTopaisGeminiOmniModeParams(hhCurrentMode)  // TOPAIS Gemini Omni Flash 独立参数
            : isLingyaVeoModel
              ? getLingyaVeoModeParams(hhCurrentMode)  // LingYa Veo3.1 独立参数
              : isLingyaSoraModel
                ? getLingyaSoraModeParams(hhCurrentMode)  // LingYa Sora-2 VIP 独立参数
                : isSeedance2Model
                  ? getSeedance2ModeParams(hhCurrentMode as Seedance2Mode)
                  : isT8SeedanceModel
                    ? getT8SeedanceModeParams(hhCurrentMode)
                    : isHappyHorseModel
                      ? getHappyHorseModeParams(hhCurrentMode)
                    : null;
  // 保留兼容旧代码的快捷变量
  const hhShowRatio = isModeSwitchVideoModel && (hhParams?.showRatio ?? false);
  const hhShowDuration = isModeSwitchVideoModel && (hhParams?.showDuration ?? false);
  const hhShowAudioSetting = isHappyHorseModel && ((hhParams as any)?.showAudioSetting ?? false);
  const hhPromptOptional = isModeSwitchVideoModel && (hhParams?.promptRequired === false);
  
  // #317 新增：本地生成状态（用于原地进化的 Loading 效果）
  const [isLocalGenerating, setIsLocalGenerating] = useState(false);
  
  // #853 上传中状态：检查是否有参考素材仍在 COS 异步上传中
  const hasUploadingSource = sourceImageEls.some(el => el.isLoading || 
    ((el.isVideo ? el.videoUrl : el.imageUrl) || '').startsWith('blob:'));
  
  // #655 双模态智能假进度引擎：替换旧的 setInterval 假进度
  const [localProgress, setLocalProgress] = useState(0);
  const hasRealProgressRef = useRef(false); // 标记是否收到过真实进度
  
  const fakeProgress = useFakeProgress({
    mediaType: isHappyHorseModel ? 'video' : 'video',
    intervalMs: 500,
    maxProgress: 95,
    onProgress: (p) => {
      // 只有没收到真实进度时，才用假进度驱动
      if (!hasRealProgressRef.current) {
        setLocalProgress(p);
      }
    },
  });
  
  // #634/#655 生成状态变化时，重置/清理进度
  useEffect(() => {
    if (!isLocalGenerating) {
      fakeProgress.stop();
      fakeProgress.reset();
      hasRealProgressRef.current = false;
      setLocalProgress(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocalGenerating]);
  
  // #400 新增：生成进度追踪（当前正在生成第几张，从0开始）
  const [currentGeneratingIndex, setCurrentGeneratingIndex] = useState(0);
  
  // #318 新增：拖拽排序交互状态
  const [dragIndex, setDragIndex] = useState<number | null>(null);       // 正在拖拽的索引
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null); // 悬停目标索引
  const [hoveredRefImageIdx, setHoveredRefImageIdx] = useState<number | null>(null); // #569 参考图缩略图悬浮索引
  
  // #320 新增：右键菜单状态（输入框用）
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  
  // #351 新增：收藏弹窗状态
  const [showFavoritesPopup, setShowFavoritesPopup] = useState(false);
  const [newFavoriteContent, setNewFavoriteContent] = useState('');
  const [editingFavoriteId, setEditingFavoriteId] = useState<number | null>(null);
  // 🛡️ 收藏重命名输入框 ref，配合 preventScroll 防止坐标失步
  const editingFavoriteInputRef = useRef<HTMLInputElement | null>(null);
  const [editingFavoriteContent, setEditingFavoriteContent] = useState('');
  
  // 🛡️ 坐标失步防御：收藏重命名时 focus + preventScroll
  useEffect(() => {
    if (editingFavoriteId !== null && editingFavoriteInputRef.current) {
      editingFavoriteInputRef.current.focus({ preventScroll: true });
    }
  }, [editingFavoriteId]);
  
  // #351 新增：打开收藏弹窗时获取列表
  useEffect(() => {
    if (showFavoritesPopup) {
      fetchFavorites();
    }
  }, [showFavoritesPopup, fetchFavorites]);
  
  // #330 新增：面板右键菜单状态
  const [panelContextMenu, setPanelContextMenu] = useState<{ x: number; y: number } | null>(null);
  
  // #388 新增：面板内部图片悬浮操作
  const [hoveredImageIndex, setHoveredImageIndex] = useState<number | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0); // 当前首图索引
  const [isStackExpanded, setIsStackExpanded] = useState(false); // 是否展开扑克牌
  
  // #视频功能 视频播放器 ref 和 IntersectionObserver 懒加载（补丁三）
  const videoRef = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    const video = videoRef.current;
    if (!video || el.panelType !== 'video') return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // 进入视口，播放视频
            video.play().catch(() => {
              // 自动播放可能被浏览器阻止，忽略错误
            });
          } else {
            // 离开视口，暂停视频
            video.pause();
          }
        });
      },
      { threshold: 0.1 }
    );
    
    observer.observe(video);
    
    return () => {
      observer.disconnect();
    };
  }, [el.panelType, el.id]);
  
  // #389 点击外部收起画廊
  useEffect(() => {
    if (!isStackExpanded) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      // #483 使用 composedPath 检查事件路径，更可靠地排除按钮点击
      // composedPath 包含事件经过的所有元素，包括 Shadow DOM 内的元素
      const path = e.composedPath();
      const targetInPath = (selector: string) => path.some(el => 
        el instanceof HTMLElement && el.matches(selector)
      );
      
      // 排除下载按钮、设为主图按钮等操作按钮的点击
      if (targetInPath('[data-download-button]') || targetInPath('[data-set-main-button]')) {
        return;
      }
      
      const target = e.target as HTMLElement;
      
      // 检查是否点击在面板外部
      const panelElement = document.querySelector(`[data-panel-id="${el.id}"]`);
      if (panelElement && !panelElement.contains(target)) {
        setIsStackExpanded(false);
      }
    };
    
    // 延迟添加监听，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [el.id, isStackExpanded]);
  
  // #876 统一下载代理：后端全能代理（COS双桶+fallbackUrl+Node.js代理），彻底根除CORS和window.open报错鞭尸
  const handleDownloadImage = useCallback(async (url: string, index: number) => {
    try {
      // 获取 imageKey（如果有）
      const imageKeys = (el as any).imageKeys as string[];
      const imageUrls = (el as any).imageUrls as string[];
      const originalIndex = imageUrls ? imageUrls.findIndex((u: string) => u === url) : index;
      const imageKey = imageKeys && imageKeys[originalIndex] ? imageKeys[originalIndex] : null;
      const providerUrls = (el as any).providerUrls as string[];
      const providerUrl = providerUrls && providerUrls[originalIndex] ? providerUrls[originalIndex] : undefined;
      
      const filename = `panel_${el.id.slice(0, 8)}_${originalIndex + 1}.png`;
      
      if (imageKey) {
        // 有key：走后端/api/download代理（COS双桶+fallbackUrl三层回退，Node.js代理无CORS限制）
        const success = await downloadViaProxy(imageKey, filename, providerUrl);
        if (!success) {
          toast.error('抱歉，原图片已过期或损坏');
        }
      } else {
        // 无key：直接下载URL
        const success = await downloadFile(url, filename);
        if (!success) {
          toast.error('抱歉，原图片已过期或损坏');
        }
      }
    } catch (error) {
      console.error('[Download] 下载失败:', error);
      toast.error('抱歉，原图片已过期或损坏');
    }
  }, [el.id, el]);
  
  // #388 设为首图
  const handleSetAsActive = useCallback((index: number) => {
    // #484 修复：重排数组后 activeImageIndex 必须为 0（新主图在 [0] 位置）
    // 先更新 activeImageIndex 为 0，再重排数组
    setActiveImageIndex(0);
    
    // 同时更新元素数据中的 imageUrls 顺序
    const urls = (el as any).imageUrls as string[];
    const keys = (el as any).imageKeys as string[];
    if (urls && urls.length > index) {
      // 重排：选中的图片移到 [0] 位置，其他保持顺序
      const newUrls = [urls[index], ...urls.slice(0, index), ...urls.slice(index + 1)];
      const newKeys = keys ? [keys[index], ...keys.slice(0, index), ...keys.slice(index + 1)] : [];
      onUpdateElement(el.id, { imageUrls: newUrls, imageKeys: newKeys, activeIndex: 0 });
    }
  }, [el, onUpdateElement]);

  // #321.1 修复：提示词局部状态（避免每次输入触发全局重渲染）
  // #353 文本面板默认提示词
  const DEFAULT_TEXT_PROMPT = '根据图片生成详细的风格提示词';
  const [localPrompt, setLocalPrompt] = useState(
    el.panelPrompt || (el.panelType === 'text' ? DEFAULT_TEXT_PROMPT : '')
  );
  
  // 判断提示词是否有效（排除默认提示词）
  const hasValidPrompt = localPrompt && localPrompt.trim() !== '' && localPrompt !== DEFAULT_TEXT_PROMPT;

  // #360 文本面板编辑模式：双击启用编辑，编辑时禁止拖动
  const [isEditing, setIsEditing] = useState(false);

  // 同步全局状态到局部状态（当 el.panelPrompt 外部变化时）
  useEffect(() => {
    // 如果外部清空了 panelPrompt，文本面板恢复默认提示词
    if (el.panelPrompt === undefined || el.panelPrompt === '') {
      setLocalPrompt(el.panelType === 'text' ? '根据图片生成详细的风格提示词' : '');
    } else {
      setLocalPrompt(el.panelPrompt);
    }
  }, [el.panelPrompt, el.panelType]);
  
  // #320 点击其他位置关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    
    const handleClickOutside = () => setContextMenu(null);
    
    // 延迟添加监听器，避免当前点击立即关闭
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [contextMenu]);
  
  // #330 点击其他位置关闭面板右键菜单
  // #886 修复：增加 mousedown/pointerdown/wheel/contextmenu 监听，确保拖拽/滚动/右键等操作也能关闭菜单
  // #886 修复：画布拖拽(Pan)/缩放时也要关闭菜单，因为React Flow可能在捕获阶段阻止冒泡
  useEffect(() => {
    if (!panelContextMenu) return;
    setPanelContextMenu(null);
  }, [pan, zoom]);
  
  useEffect(() => {
    if (!panelContextMenu) return;
    
    const handleClickOutside = (e: Event) => {
      const target = e.target as HTMLElement;
      // 排除菜单内部点击
      if (target.closest('[data-panel-context-menu]')) return;
      setPanelContextMenu(null);
    };
    
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('pointerdown', handleClickOutside);
      document.addEventListener('wheel', handleClickOutside, { passive: true });
      document.addEventListener('contextmenu', handleClickOutside);
    }, 0);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('wheel', handleClickOutside);
      document.removeEventListener('contextmenu', handleClickOutside);
    };
  }, [panelContextMenu]);
  

  // #337 点击其他位置关闭所有选择弹窗
  // #468 使用 mousedown 代替 click，因为 click 会被其他区域的 stopPropagation 阻止
  useEffect(() => {
    // 如果所有弹窗都关闭，不需要监听
    if (!localModelPicker && !localRatioPicker && !localResolutionPicker && !localQualityPicker && !localCountPicker && !localVideoDurationPicker && !localVideoAspectRatioPicker && !localVideoSizePicker) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // 检查是否点击在弹窗内部（弹窗容器有 data-picker-popup 属性）
      if (target.closest('[data-picker-popup="true"]')) return;
      // 检查是否点击在按钮上（按钮会自己处理切换逻辑）
      if (target.closest('[data-picker-button="true"]')) return;
      // 点击其他位置，关闭所有弹窗
      closeAllPickers();
    };
    
    // 使用 mousedown 事件捕获阶段，比 click 更早触发，不被 stopPropagation 阻止
    document.addEventListener('mousedown', handleClickOutside, true);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [localModelPicker, localRatioPicker, localResolutionPicker, localQualityPicker, localCountPicker, localVideoDurationPicker, localVideoAspectRatioPicker, localVideoSizePicker, closeAllPickers]);
  
  // #317 新增：解析比例字符串为数值
  const parseRatio = (ratio: string): number => {
    const parts = ratio.split(':');
    if (parts.length === 2) {
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (!isNaN(w) && !isNaN(h) && h > 0) {
        return w / h;
      }
    }
    return 1; // 默认 1:1
  };
  
  // 提示词输入框 ref
  const promptRef = useRef<HTMLTextAreaElement>(null);
  
  // 文本内容编辑框 ref（用于设置光标位置）
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  // 记录双击时的文本绝对索引位置
  const dblClickOffsetRef = useRef<number | null>(null);
  // #M4 修复：追踪拖拽事件监听器，组件卸载时兜底清理
  const dragCleanupRef = useRef<(() => void) | null>(null);
  
  // 双击进入编辑模式时，光标移到点击位置
  useEffect(() => {
    if (isEditing && textAreaRef.current) {
      const textarea = textAreaRef.current;
      
      // 确保 textarea 已经挂载并在 DOM 中可见
      requestAnimationFrame(() => {
        // 🛡️ preventScroll: 阻止浏览器 scrollIntoView，防止画布坐标失步
        textarea.focus({ preventScroll: true });
        
        if (dblClickOffsetRef.current !== null) {
          const offset = dblClickOffsetRef.current;
          // 瞬间定位光标！
          textarea.setSelectionRange(offset, offset);
          dblClickOffsetRef.current = null;
        }
      });
    }
  }, [isEditing]);
  
  // 编辑模式原生滚轮拦截器（军师方案）
  useEffect(() => {
    const textarea = textAreaRef.current;
    if (!isEditing || !textarea) return;

    const stopCanvasWheel = (e: WheelEvent) => {
      // 物理级拦截：彻底阻止原生滚轮事件冒泡到外层画布！
      e.stopPropagation();
      // 不写 preventDefault，保留浏览器原生平滑滚动
    };

    // 绑定原生事件，抢在画布事件触发前拦截
    textarea.addEventListener('wheel', stopCanvasWheel, { passive: false });

    return () => {
      textarea.removeEventListener('wheel', stopCanvasWheel);
    };
  }, [isEditing]);
  
  // #358 渲染比例形状图标
  const renderRatioShape = (ratio: string, size: number = 12) => {
    const parts = ratio.split(':');
    if (parts.length !== 2) return null;
    const w = parseFloat(parts[0]);
    const h = parseFloat(parts[1]);
    if (isNaN(w) || isNaN(h) || h === 0) return null;
    
    const ratioValue = w / h;
    const maxSize = size;
    let shapeW: number, shapeH: number;
    
    if (ratioValue >= 1) {
      shapeW = maxSize;
      shapeH = maxSize / ratioValue;
    } else {
      shapeH = maxSize;
      shapeW = maxSize * ratioValue;
    }
    
    return (
      <div style={{
        width: maxSize,
        height: maxSize,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          width: shapeW,
          height: shapeH,
          border: '1.5px solid #a1a1aa',
          borderRadius: 1,
          flexShrink: 0,
        }} />
      </div>
    );
  };
  
  // #320 删除：不再需要同步提示词到元素数据的 useEffect
  // 使用受控组件 value={el.panelPrompt || ''} 直接绑定

  // 计算积分消耗（#549 三端统一积分计算）
  const calculateCredits = useCallback(() => {
    const config = modelConfig?.[localModel] || {
      resolutions: [{ size: '1K', credits: 10 }],
    };
    // #641 Sora-2 VIP 2合1：按次计费（固定积分，不按时长变化）
    if (localModel === 'sora-2-all-vip') {
      return (config as any).credits_base || (config as any).credits || 60;
    }
    // 视频模型特殊处理
    if (currentModelConfig?.type === 'video') {
      // 视频模型使用 localVideoSize（如 720P/1080P），而非 localResolution（图片用，默认1K）
      const effectiveVideoRes = localVideoSize || '720p';
      const videoPricing = (config as any).videoPricing;
      // #735 TOPAIS Veo：按次计费（固定积分，根据分辨率），优先判断 videoPricing.mode
      if (isTopaisModel) {
        if (videoPricing?.mode === 'fixed' && videoPricing?.credits) {
          return videoPricing.credits;
        }
        // 兜底：根据分辨率返回固定积分（720p=50, 1080p=80, 4K=150）
        const res = effectiveVideoRes.toLowerCase();
        if (res === '4k') return 150;
        if (res === '1080p') return 80;
        return 50; // 720p 默认
      }
      const isFixedPricing = videoPricing?.mode === 'fixed' || (!currentModelConfig.showDuration && !currentModelConfig.showResolution);
      if (isFixedPricing) {
        // 固定计费模式（Sora/Veo）：按次计费
        return (config as any).credits_base || (config as any).credits || videoPricing?.credits || 80;
      }
      // 按秒计费模式（Seedance等）：分辨率单价 × 时长
      // #866 修复：兼容 value 字段，防空崩溃
      const resolutions = config?.resolutions || [{ size: '720P', credits: 80 }];
      const resConfig = resolutions.find((r: any) => (r.size || r.value || '').toLowerCase() === effectiveVideoRes.toLowerCase());
      const creditsPerSecond = resConfig?.credits || resolutions[0]?.credits || 80;
      return creditsPerSecond * localVideoDuration;
    }
    // #866 修复：兼容 value 字段，防空崩溃
    const resolutions = config?.resolutions || [{ size: '1K', credits: 10 }];
    const resConfig = resolutions.find((r: any) => (r.size || r.value || '').toLowerCase() === (localResolution || '1K').toLowerCase());
    const creditsPerImage = resConfig?.credits || resolutions[0]?.credits || 0;
    return creditsPerImage * localCount;
  }, [modelConfig, localModel, localResolution, localVideoSize, localCount, currentModelConfig, localVideoDuration]);

  // 更新元素参数 - #317 修复：使用 CanvasElement 类型
  const updateElementData = useCallback((data: Partial<CanvasElement>) => {
    onUpdateElement(el.id, data);
  }, [el.id, onUpdateElement]);
  
  // #319 新增：获取可用分辨率列表
  const getAvailableResolutions = useCallback(() => {
    const config = modelConfig?.[localModel];
    const resolutions = config?.resolutions || [{ size: '1K', credits: 10 }];
    return resolutions.map((res: { size: string; credits: number }) => res.size);
  }, [modelConfig, localModel]);
  
  // #317 新增：比例切换时更新面板物理尺寸（必须在 updateElementData 之后定义）
  // #327 修复：缩放面板不能超过初始高度，通过调整宽度实现比例效果
  // #331 优化：始终使用初始高度计算宽度，保持一致性
  // #336 修复：取初始宽高最大值为基准，比例调整不超过最长边
  const updatePanelSizeByRatio = useCallback((ratio: string) => {
    const ratioValue = parseRatio(ratio);
    const originalHeight = el.originalHeight || el.height;
    const originalWidth = el.originalWidth || el.width;
    
    // #336 取初始宽高最大值为基准
    const maxBase = Math.max(originalWidth, originalHeight);
    
    // 根据比例和最长边计算新尺寸
    // 宽度 = 最长边 × 比例
    const newWidth = maxBase * ratioValue;
    // 高度 = 最长边（保持不变）
    const newHeight = maxBase;
    
    // #492 消灭亚像素渲染：所有尺寸取整
    updateElementData({ 
      panelRatio: ratio,
      width: Math.round(newWidth),
      height: Math.round(newHeight)
    });
  }, [el.originalHeight, el.height, el.originalWidth, el.width, updateElementData]);

  // ====== 二、智能拖拽引擎（无损迁移）======
  // #360 编辑模式下禁止拖动
  const handleDragStart = useCallback((e: React.PointerEvent) => {
    // 右键不启动拖动，由 onContextMenu 处理
    if (e.button === 2) return;
    
    // 平移模式下不处理面板拖拽
    if (activeTool === 'hand') return;
    
    // #378 调试日志
    
    // 编辑模式下禁止拖动
    if (isEditing) return;
    
    // #467 拖动面板时关闭所有弹窗
    closeAllPickers();
    
    // #376 检查是否点击了连线端口（端口和面板容器是同级元素，stopPropagation无效）
    const target = e.target as HTMLElement;
    if (target.closest('.node-connection-port-hitbox')) {
      // 点击的是连线端口，跳过面板选中逻辑
      e.stopPropagation();
      return;
    }
    
    e.stopPropagation();
    
    // #406 拖拽起始阶段：先获取 currentElId
    const currentElId = el.id;
    
    // #372 点击面板时取消连线菜单状态
    onCancelConnection?.();
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startElX = el.x;
    const startElY = el.y;
    const elWidth = el.width;  // #339 对齐磁吸需要
    const elHeight = el.height;  // #339 对齐磁吸需要
    
    // 多选拖动支持
    const isSelected = selectedIds.includes(currentElId);
    const selectedElements = isSelected 
      ? allElements.filter(el => selectedIds.includes(el.id))
      : [];
    const isMultiSelectDrag = isSelected && selectedElements.length > 1;
    
    // #481 修复：只有非多选时才清除画布选中状态
    // 多选拖动时保持多选状态，不清除选中
    // 👑 #602 军师方案重构：按下只处理选中+置顶，弹窗切换移到 onPointerUp
    if (!isMultiSelectDrag) {
      onClearCanvasSelection?.();
      
      // 👑 #602 终极同步修复：按下即选中，按下即置顶！
      // 核心：强制调用同步选中，不要等待 onPointerUp（onSelectElement 回调会自动触发 forceBringToFront）
      onSelectElement(currentElId, false);
    }
    
    // 记录所有选中元素的初始位置
    const groupStartPositions = isMultiSelectDrag
      ? selectedElements.map(el => ({ id: el.id, x: el.x, y: el.y }))
      : null;
    
    let isDragging = false; 
    
    // #343 RAF节流
    let rafId: number | null = null;
    
    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      
      if (Math.abs(moveEvent.clientX - startX) > 3 || Math.abs(moveEvent.clientY - startY) > 3) {
        isDragging = true;
      }
      
      if (!isDragging) return;

      // RAF 节流：每帧最多执行一次
      if (rafId) return;
      
      rafId = requestAnimationFrame(() => {
        rafId = null;
        
        const deltaX = (moveEvent.clientX - startX) / (zoom || 1);
        const deltaY = (moveEvent.clientY - startY) / (zoom || 1);
        
        // 计算原始新位置
        const rawX = startElX + deltaX;
        const rawY = startElY + deltaY;
        
        // #344 双向磁吸拦截：向全局申请对齐，获取被磁吸纠正后的坐标
        const { snappedX, snappedY } = onDragMove(currentElId, rawX, rawY, elWidth, elHeight);
        
        if (isMultiSelectDrag && groupStartPositions) {
          // 多选拖动：计算吸附偏移量（使用吸附后的坐标）
          const offsetX = snappedX - startElX;
          const offsetY = snappedY - startElY;
          groupStartPositions.forEach(pos => {
            // #492 消灭亚像素渲染：坐标取整
            onUpdateElement(pos.id, { 
              x: Math.round(pos.x + offsetX), 
              y: Math.round(pos.y + offsetY) 
            });
          });
        } else {
          // #344 单选拖动：使用吸附后的坐标更新面板，实现真正的物理吸附！
          // #492 消灭亚像素渲染：坐标取整
          onUpdateElement(currentElId, { x: Math.round(snappedX), y: Math.round(snappedY) });
        }
      });
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      dragCleanupRef.current = null;  // #M4 清理追踪
      
      // #343 清理 RAF
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      
      // #343 通知全局拖拽结束，清除对齐线
      onDragEnd();

      // #374 如果正在连线，跳过选中逻辑（解决 window pointerup 无法阻止的问题）
      // #382 关键修复：使用全局 ref（同步更新，不依赖 React 渲染）
      const currentIsConnectionActive = isConnectionActiveGlobalRef?.current ?? false;
      if (currentIsConnectionActive) {
        return;
      }

      // #378 绝杀2：死卡校验 - 检查点击目标是否为端口或交互元素
      const targetEl = upEvent.target as Element;
      if (targetEl && targetEl.closest) {
        // 如果点到了连线端口，绝对不许选中面板！
        if (targetEl.closest('.node-connection-port-hitbox')) {
          return;
        }
        // 如果点到了按钮、输入框等交互元素，也不许选中面板！
        if (targetEl.closest('button, input, textarea, .panel-interactive-zone')) {
          return;
        }
      }

      // 右键释放不触发选中逻辑（由 onContextMenu 处理）
      if (upEvent.button === 2) {
        return;
      }

      // 👑 #602 军师方案：弹窗切换逻辑移到 onPointerUp
      // 如果发生了拖拽，不触发弹窗切换
      if (isDragging) return;

      // 非多选模式下，处理弹窗切换
      if (!isMultiSelectDrag) {
        // 使用 getCurrentInputNodeId() 获取当前活跃面板（因为 onSetActiveInputNode 不支持函数式更新）
        const currentActiveId = getCurrentInputNodeId();
        if (currentActiveId === currentElId) {
          // 点击已激活面板 → 关闭弹窗
          onSetActiveInputNode(null);
        } else {
          // 点击其他面板 → 打开弹窗
          onSetActiveInputNode(currentElId);
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    // #M4 修复：存储清理函数，卸载时兜底
    dragCleanupRef.current = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [el.id, el.x, el.y, el.width, el.height, selectedIds, allElements, zoom, onUpdateElement, onSelectElement, onSetActiveInputNode, getCurrentInputNodeId, onDragMove, onDragEnd, isEditing]);

  // #346 LLM 相关状态
  const [llmResponse, setLlmResponse] = useState<string>(el.textContent || '');
  const [isLlmGenerating, setIsLlmGenerating] = useState(false);
  const llmResponseRef = useRef<string>(el.textContent || '');
  // ⚠️ P1.4 修复：LLM 请求 AbortController，用于中断生成
  const llmAbortControllerRef = useRef<AbortController | null>(null);
  
  // #346 LLM 调用函数（流式响应）
  const handleLlmGenerate = async () => {
    // #511 修复：未登录时拦截并弹出登录框
    if (!isLoggedIn) {
      setAuthModalOpen(true);
      return;
    }
    
    // 使用 localPrompt 状态而非 promptRef（受控组件）
    let prompt = localPrompt || promptRef.current?.value || '';
    
    // 🔧 修复：如果没有 prompt 但有参考图，使用默认 prompt
    if (!prompt && sourceImageEls.length === 0) {
      return;
    }
    
    // 后端 LLM API 要求必须有 prompt
    if (!prompt) {
      prompt = '请描述这张图片的内容和风格';
    }
    
    setIsLlmGenerating(true);
    setLlmResponse('');
    llmResponseRef.current = '';
    
    try {
      // 处理图片 URL（blob URL 需要转换为 base64）
      // 优先使用非视频元素（图片），如果没有图片才用视频首帧
      const imageEl = sourceImageEls.find(el => !el.isVideo);
      const videoEl = sourceImageEls.find(el => el.isVideo);
      let referenceImageUrl = imageEl?.imageUrl;
      let isValidImageUrl = false;
      
      if (referenceImageUrl) {
        if (referenceImageUrl.startsWith('blob:')) {
          // blob URL 需要转换为 base64
          try {
            const response = await fetch(referenceImageUrl);
            const blob = await response.blob();
            referenceImageUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
            isValidImageUrl = true;
          } catch (e) {
            // 转换失败，静默处理
          }
        } else if (referenceImageUrl.startsWith('http://') || referenceImageUrl.startsWith('https://') || referenceImageUrl.startsWith('data:')) {
          isValidImageUrl = true;
        }
      }
      
      // 处理视频 URL
      let referenceVideoUrl = videoEl?.videoUrl || (videoEl?.imageUrl) || null;
      let isValidVideoUrl = false;
      
      if (referenceVideoUrl) {
        if (referenceVideoUrl.startsWith('blob:')) {
          try {
            const response = await fetch(referenceVideoUrl);
            const blob = await response.blob();
            referenceVideoUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
            isValidVideoUrl = true;
          } catch (e) {
            // 转换失败，静默处理
          }
        } else if (referenceVideoUrl.startsWith('http://') || referenceVideoUrl.startsWith('https://') || referenceVideoUrl.startsWith('data:')) {
          isValidVideoUrl = true;
        }
      }
      
      const requestBody: any = {
        prompt,
        model: localModel,  // 使用用户选择的模型
        temperature: 0.7,
      };
      
      // 只有有效图片 URL 才添加 imageUrl 参数
      if (isValidImageUrl) {
        requestBody.imageUrl = referenceImageUrl;
      }
      
      // 只有有效视频 URL 才添加 videoUrl 参数
      if (isValidVideoUrl) {
        requestBody.videoUrl = referenceVideoUrl;
      }
      
      // ⚠️ P1.4 修复：创建 AbortController 用于中断 LLM 请求
      llmAbortControllerRef.current = new AbortController();
      
      const response = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: llmAbortControllerRef.current.signal,
      });
      
      if (!response.ok) {
        // #507 修复：处理 401 未登录响应
        if (response.status === 401) {
          throw new Error('REDIRECT_TO_LOGIN');
        }
        throw new Error('LLM 请求失败');
      }
      
      // #507 修复：使用buffer正确处理跨chunk的SSE行，避免JSON解析失败导致"生成失败"
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || ''; // 保留最后一行（可能不完整）
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'text') {
                const newContent = llmResponseRef.current + data.content;
                llmResponseRef.current = newContent;
                setLlmResponse(newContent);
              } else if (data.type === 'error') {
                // #507 修复：不要在内部 try-catch 中 throw，直接设置错误
                console.error('[LLM] 收到错误事件:', data.error || data.message);
                // 如果已有部分内容，追加错误而不是覆盖
                if (llmResponseRef.current && llmResponseRef.current.length > 10) {
                  setLlmResponse(llmResponseRef.current + '\n\n[生成中断，内容可能不完整]');
                } else {
                  // #727 翻译英文错误消息为中文
                  const translatedError = translateErrorMessage(data.error || data.message || '未知错误');
                  setLlmResponse(`生成失败: ${translatedError}`);
                }
                setIsLlmGenerating(false);
                return; // 直接退出函数
              } else if (data.type === 'done') {
                // 生成完成
              }
            } catch (e) {
              // 忽略 JSON 解析错误（可能是不完整的数据行）
            }
          }
        }
      }
    } catch (error: any) {
      // #507 修复：处理登录跳转和具体错误信息
      if (error?.message === 'REDIRECT_TO_LOGIN') {
        setLlmResponse('请先登录后再使用文本生成');
        // #508 修复：派发 openLogin 事件打开画布页面的 AuthModal 弹窗，而不是跳转页面
        window.dispatchEvent(new CustomEvent('openLogin'));
      } else if (error?.name === 'AbortError') {
        // 用户主动中断，不显示"生成失败"
        if (llmResponseRef.current) {
          setLlmResponse(llmResponseRef.current);
        }
      } else {
        console.error('[LLM] 生成失败:', error);
        // #507 修复：如果已有部分内容，保留内容而不是覆盖为"生成失败"
        if (llmResponseRef.current && llmResponseRef.current.length > 10) {
          // 已收到较多内容，追加错误提示而不是覆盖
          setLlmResponse(llmResponseRef.current + '\n\n[生成中断，内容可能不完整]');
        } else {
          setLlmResponse('生成失败，请重试');
        }
      }
    } finally {
      setIsLlmGenerating(false);
      // ⚠️ P1.4 修复：清理 AbortController
      llmAbortControllerRef.current = null;
      // 保存生成的内容到元素中，以便其他面板可以获取
      const errorMessages = ['生成失败，请重试', '请先登录后再使用文本生成', '[生成中断，内容可能不完整]'];
      const isError = errorMessages.some(msg => llmResponseRef.current?.startsWith(msg));
      if (llmResponseRef.current && !isError) {
        onUpdateElement(el.id, { textContent: llmResponseRef.current });
      }
    }
  };

  // ⚠️ P1.4 修复：组件卸载时中断 LLM 请求，防止内存泄漏
  useEffect(() => {
    return () => {
      if (llmAbortControllerRef.current) {
        llmAbortControllerRef.current.abort();
        llmAbortControllerRef.current = null;
      }
    };
  }, []);

  // #M4 修复：组件卸载时兜底清理拖拽事件监听器
  useEffect(() => {
    return () => {
      if (dragCleanupRef.current) {
        dragCleanupRef.current();
        dragCleanupRef.current = null;
      }
    };
  }, []);

  // #364 #366 重构：单线蓄水池模式
  // ====== 占位符映射 Refs ======
  const panelTaskIdRef = useRef<string | null>(null);
  
  // #398: 本地追踪已收到的图片，避免闭包问题
  const receivedImagesRef = useRef<{ urls: string[]; keys: string[]; providerUrls: string[] }>({ urls: [], keys: [], providerUrls: [] });
  
  // #视频生成: 本地追踪已收到的视频
  const receivedVideosRef = useRef<{ urls: string[]; keys: string[] }>({ urls: [], keys: [] });

  // #388: 执行实际的生成逻辑
  const executeGenerate = useCallback(async (
    finalPrompt: string,
    referenceImages: string[],
    isUrls: boolean,
    existingStackId: string | null = null
  ) => {
    const clientTaskId = `panel_${el.id}_${Date.now()}`;
    panelTaskIdRef.current = clientTaskId;
    
    // ====== 区分视频面板和图片面板 ======
    const isVideoPanel = el.panelType === 'video';
    
    if (isVideoPanel) {
      // ====== 视频生成逻辑 ======
      // 清空视频追踪
      receivedVideosRef.current = { urls: [], keys: [] };
      
      // 更新面板状态为 generating
      onUpdateElement(el.id, {
        generationStatus: 'generating',
        generationTaskId: clientTaskId,
        videoUrls: [],
        videoKeys: [],
      } as any);
      
      setIsLocalGenerating(true);
      setLocalProgress(0);  // #634 重置进度
      
      // #数据分流 真假进度严格分离
      // 有后端真进度的模型：绝不启动假进度引擎，只用后端 SSE progress 事件驱动
      //   （防止假进度跑到 95% 真进度才 30% 导致回跳）
      // 无后端真进度的模型（仅 lingya-sora）：启动假进度引擎（VIDEO_CURVE 慢速曲线）
      const panelModelHasRealProgress = ModelDetector.hasBackendRealProgress(localModel);
      hasRealProgressRef.current = panelModelHasRealProgress;
      if (!panelModelHasRealProgress) {
        fakeProgress.reset();
        fakeProgress.start();
      } else {
        fakeProgress.stop();
      }
      
      try {
        // #663 业务强校验：防漏传（UI控上限，拦截控下限）
        if (isHappyHorseModel && hhCurrentMode === 'video-edit' && !connectedVideoUrl) {
          toast.error('视频编辑模式必须上传参考视频');
          setIsLocalGenerating(false);
          return;
        }
        if ((isSeedance2Model || isT8SeedanceModel) && hhCurrentMode === 'i2v-first-last-frame') {
          const hasFirstFrame = connectedImageUrls.length >= 1;
          const hasLastFrame = connectedImageUrls.length >= 2;
          if (!hasFirstFrame || !hasLastFrame) {
            toast.error('首尾帧模式必须同时上传首帧和尾帧图片');
            setIsLocalGenerating(false);
            return;
          }
        }
        // 音频孤岛拦截：有音频但没有图片/视频
        {
          const hasAudio = refAudioFiles.length > 0;
          const hasImage = (referenceImages && referenceImages.length > 0) || connectedImageUrls.length > 0;
          const hasVideo = !!connectedVideoUrl;
          if (hasAudio && !hasImage && !hasVideo) {
            toast.error('音频不可单独使用，需至少包含1张参考图或视频');
            setIsLocalGenerating(false);
            return;
          }
        }
        
        // #641 Sora-2 VIP 2合1：统一入口 sora-2-all-vip，不再拼接模型名
        // 数据库只有 sora-2-all-vip，拼接 -10s/-15s 会导致 DB 查找失败
        await contextHandleGenerate({
          mode: 'video',
          prompt: finalPrompt,
          model: localModel,
          resolution: localVideoSize, // 视频分辨率：480p/720p/1080p
          // 视频参数
          aspectRatio: localVideoAspectRatio,
          duration: localVideoDuration,
          size: localVideoSize,
          // 图生视频：传递参考图（数量由提纯引擎约束）
          // #639 使用 getEffectiveSources 替代硬编码的 slice 逻辑
          images: (() => {
            if (!referenceImages || referenceImages.length === 0) return undefined;
            // 构建素材列表（类型溯源：来自 connectedImageUrls 的都是图片）
            const sources: SourceItem[] = referenceImages.map((url, i) => ({
              id: `panel-src-${i}`,
              type: 'image' as const,
              url: url,
              index: i,
            }));
            const { effective } = getEffectiveSources(
              isModeSwitchVideoModel ? hhCurrentMode : 'i2v',
              localModel,
              sources
            );
            return effective.length > 0 ? effective.map(s => s.url) : undefined;
          })(),
          isUrls: isUrls,
          generationCount: 1, // 视频一次只生成1个
          
          // #633 HappyHorse 特定参数
          ...(isHappyHorseModel ? {
            hhMode: hhCurrentMode,
            firstFrameUrl: hhCurrentMode === 'i2v' ? connectedImageUrls[0] || undefined : undefined,
            referenceImageUrls: hhCurrentMode === 'r2v' ? connectedImageUrls : undefined,
            inputVideoUrl: hhCurrentMode === 'video-edit' ? connectedVideoUrl || undefined : undefined,
            audioSetting: hhCurrentMode === 'video-edit' ? hhAudioSetting : undefined,
          } : {}),
          
          // Seedance 2.0 特定参数
          ...(isSeedance2Model ? {
            hhMode: hhCurrentMode,
            sd2Mode: hhCurrentMode as Seedance2Mode,
            firstFrameUrl: (hhCurrentMode === 'i2v' || hhCurrentMode === 'i2v-first-frame') ? connectedImageUrls[0] || undefined : undefined,
            lastFrameUrl: hhCurrentMode === 'i2v-first-last-frame' ? connectedImageUrls[1] || undefined : undefined,
            referenceImageUrls: hhCurrentMode === 'r2v' ? connectedImageUrls : undefined,
            referenceAudioUrls: refAudioFiles.length > 0 ? refAudioFiles.map(f => f.url) : undefined,
            generateAudio: generateAudio,
          } : {}),
          
          // T8 Seedance 2.0 (sdols) 特定参数 - 全模态解锁，对齐 Seedance 2.0 参数格式
          ...(isT8SeedanceModel ? {
            hhMode: hhCurrentMode,
            t8seedanceMode: hhCurrentMode,
            firstFrameUrl: (hhCurrentMode === 'i2v' || hhCurrentMode === 'i2v-first-frame') ? connectedImageUrls[0] || undefined : undefined,
            lastFrameUrl: hhCurrentMode === 'i2v-first-last-frame' ? connectedImageUrls[1] || undefined : undefined,
            referenceImageUrls: hhCurrentMode === 'r2v' ? connectedImageUrls : undefined,
            referenceVideoUrls: connectedVideoUrl ? [connectedVideoUrl] : undefined,
            referenceAudioUrls: refAudioFiles.length > 0 ? refAudioFiles.map(f => f.url) : undefined,
            generateAudio: generateAudio,
          } : {}),
          
          // #690 TOPAIS Veo3.1-fast 独立参数
          ...(isTopaisModel ? {
            hhMode: hhCurrentMode,  // 前端模式标识，后端用于判断 generation_type
          } : {}),
          
          // #7xx TOPAIS HappyHorse 1.1 独立参数
          ...(isTopaisHhModel ? {
            hhMode: hhCurrentMode,  // 前端模式标识，后端用于判断 action 参数
          } : {}),
          
          // TOPAIS Seedance 2.0 独立参数 - 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式
          ...(isTopaisSeedanceModel ? {
            hhMode: hhCurrentMode,
            sd2Mode: hhCurrentMode as Seedance2Mode,
            firstFrameUrl: (hhCurrentMode === 'i2v' || hhCurrentMode === 'i2v-first-frame' || hhCurrentMode === 'i2v-first-last-frame') ? connectedImageUrls[0] || undefined : undefined,
            lastFrameUrl: hhCurrentMode === 'i2v-first-last-frame' ? connectedImageUrls[1] || undefined : undefined,
            referenceImageUrls: hhCurrentMode === 'r2v' ? connectedImageUrls : undefined,
            referenceVideoUrls: connectedVideoUrl ? [connectedVideoUrl] : undefined,
            referenceAudioUrls: refAudioFiles.length > 0 ? refAudioFiles.map(f => f.url) : undefined,
            generateAudio: generateAudio,
          } : {}),
          
          // TOPAIS Gemini Omni Flash 独立参数 - 支持 t2v/i2v/r2v 三种模式
          ...(isTopaisGeminiOmniModel ? {
            hhMode: hhCurrentMode,  // 前端模式标识，后端用于判断 image_urls 数量
          } : {}),
          
          // #301 LingYa Veo3.1 独立参数（必须传递 hhMode，确保模式确定性映射）
          ...(isLingyaVeoModel ? {
            hhMode: hhCurrentMode,
          } : {}),
          
          // #301 LingYa Sora-2 VIP 独立参数（必须传递 hhMode，确保模式确定性映射）
          ...(isLingyaSoraModel ? {
            hhMode: hhCurrentMode,
          } : {}),
          
          // MEGA AI Seedance 2.0 独立参数 - 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式，固定720p
          ...(isMegaAiSeedanceModel ? {
            hhMode: hhCurrentMode,
            sd2Mode: hhCurrentMode as Seedance2Mode,
            firstFrameUrl: (hhCurrentMode === 'i2v' || hhCurrentMode === 'i2v-first-frame' || hhCurrentMode === 'i2v-first-last-frame') ? connectedImageUrls[0] || undefined : undefined,
            lastFrameUrl: hhCurrentMode === 'i2v-first-last-frame' ? connectedImageUrls[1] || undefined : undefined,
            referenceImageUrls: hhCurrentMode === 'r2v' ? connectedImageUrls : undefined,
            referenceVideoUrls: connectedVideoUrl ? [connectedVideoUrl] : undefined,
            referenceAudioUrls: refAudioFiles.length > 0 ? refAudioFiles.map(f => f.url) : undefined,
            generateAudio: generateAudio,
          } : {}),
          
          // TOPAIS MiniMax-H3 独立参数 - 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式，固定2K
          ...(isTopaisMinimaxModel ? {
            hhMode: hhCurrentMode,
            sd2Mode: hhCurrentMode as Seedance2Mode,
            firstFrameUrl: (hhCurrentMode === 'i2v' || hhCurrentMode === 'i2v-first-frame' || hhCurrentMode === 'i2v-first-last-frame') ? connectedImageUrls[0] || undefined : undefined,
            lastFrameUrl: hhCurrentMode === 'i2v-first-last-frame' ? connectedImageUrls[1] || undefined : undefined,
            referenceImageUrls: hhCurrentMode === 'r2v' ? connectedImageUrls : undefined,
            referenceVideoUrls: connectedVideoUrl ? [connectedVideoUrl] : undefined,
            referenceAudioUrls: refAudioFiles.length > 0 ? refAudioFiles.map(f => f.url) : undefined,
            generateAudio: generateAudio,
          } : {}),
          
          // TOPAIS Kling v3 Omni 独立参数 - 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式
          ...(isTopaisKlingOmniModel ? {
            hhMode: hhCurrentMode,
            sd2Mode: hhCurrentMode as Seedance2Mode,
            firstFrameUrl: (hhCurrentMode === 'i2v' || hhCurrentMode === 'i2v-first-frame' || hhCurrentMode === 'i2v-first-last-frame') ? connectedImageUrls[0] || undefined : undefined,
            lastFrameUrl: hhCurrentMode === 'i2v-first-last-frame' ? connectedImageUrls[1] || undefined : undefined,
            referenceImageUrls: hhCurrentMode === 'r2v' ? connectedImageUrls : undefined,
            referenceVideoUrls: connectedVideoUrl ? [connectedVideoUrl] : undefined,
          } : {}),
          
          // ====== 视频进度回调 ======
          onVideoProgress: (progress) => {
            // #655 智能分流：收到真实进度(>0)，停假进度，切真实
            // #690 关键修复：progress=0 不是真实进度，不杀假进度引擎
            if (typeof progress.progress === 'number' && progress.progress > 0) {
              hasRealProgressRef.current = true;
              // #710 关键修复：同步假进度引擎内部值，防止竞态覆盖
              fakeProgress.setProgress(progress.progress);
              fakeProgress.stop();
              setLocalProgress(progress.progress);
            }
          },
          
          // ====== 视频接收回调 ======
          onVideoReceived: (data: { url: string; key?: string; imageKey?: string; thumbnailUrl?: string; videoKey?: string }) => {
            
            if (data.url) {
              receivedVideosRef.current.urls.push(data.url);
              // 👑 #418 修复：强制对齐双数组长度！
              // #624 修复：严格优先级排序（视频Key > 图片Key > 缩略图Key），确保刷新后能通过视频Key恢复视频
              receivedVideosRef.current.keys.push(data.videoKey || data.imageKey || data.key || '');
              
              // 更新面板
              onUpdateElement(el.id, {
                videoUrls: [...receivedVideosRef.current.urls],
                videoKeys: [...receivedVideosRef.current.keys],
                generationStatus: 'completed',
              } as any);
              
              setIsLocalGenerating(false);
              setLocalProgress(100);  // #634 完成时设满
              fakeProgress.stop();    // #655 停止假进度引擎
            }
          },
          
          // ====== onComplete: 兜底处理 ======
          onComplete: (result) => {
            setIsLocalGenerating(false);
            setLocalProgress(100);  // #634 完成时设满
            fakeProgress.stop();    // #655 停止假进度引擎
            
            const videoUrls = result.videos || [];
            const videoKeys = result.videoKeys || [];
            
            if (videoUrls.length > 0 && receivedVideosRef.current.urls.length === 0) {
              onUpdateElement(el.id, {
                videoUrls: videoUrls,
                videoKeys: videoKeys,
                generationStatus: 'completed',
              } as any);
            }
          },
          
          // ====== onError: 错误处理 ======
          onError: (error) => {
            // 👑 #420 修复：拦截超时事件，任务可能仍在处理中
            if (error.message?.includes('超时') || error.type === 'timeout') {
              return;
            }
            
            setIsLocalGenerating(false);
            setLocalProgress(0);  // #634 重置进度
            fakeProgress.stop();  // #655 停止假进度引擎
            
            // 👑 #420 修复：局部止损机制 - 检查是否已有部分视频
            const hasPartialVideos = receivedVideosRef.current.urls.length > 0;
            if (hasPartialVideos) {
              onUpdateElement(el.id, {
                generationStatus: 'completed',
                videoUrls: [...receivedVideosRef.current.urls],
                videoKeys: [...receivedVideosRef.current.keys],
              } as any);
            } else {
              // #727 翻译英文错误消息为中文
              const translatedError = translateErrorMessage(error.message || '未知错误');
              onUpdateElement(el.id, {
                generationStatus: 'failed',
                generationError: translatedError,
              } as any);
            }
          },
        });
      } catch (error: any) {
        // 👑 #420 修复：视频面板 catch 块也需要局部止损
        setIsLocalGenerating(false);
        setLocalProgress(0);  // #634 重置进度
        fakeProgress.stop();  // #655 停止假进度引擎
        const hasPartialVideos = receivedVideosRef.current.urls.length > 0;
        if (hasPartialVideos) {
          onUpdateElement(el.id, {
            generationStatus: 'completed',
            videoUrls: [...receivedVideosRef.current.urls],
            videoKeys: [...receivedVideosRef.current.keys],
          } as any);
        } else {
          // #727 翻译英文错误消息为中文
          const translatedError = translateErrorMessage(error?.message || '未知错误');
          onUpdateElement(el.id, {
            generationStatus: 'failed',
            generationError: translatedError,
          } as any);
        }
      }
      
      return; // 视频面板到此结束
    }
    
    // ====== 图片生成逻辑（原有逻辑）======
    // #398: 清空本地追踪的图片
    receivedImagesRef.current = { urls: [], keys: [], providerUrls: [] };
    
    // 更新面板状态为 generating，并清空面板自己的旧图片
    onUpdateElement(el.id, {
      generationStatus: 'generating',
      generationTaskId: clientTaskId,
      imageUrls: [],
      imageKeys: [],
      activeIndex: 0,
    } as any);
    
    setIsLocalGenerating(true);
    setCurrentGeneratingIndex(0); // #400 重置生成进度
    
    // 如果是覆盖模式，同时清空已连接的 image-stack
    if (existingStackId) {
      onUpdateElement(existingStackId, {
        imageUrls: [],
        imageKeys: [],
        activeIndex: 0,
        isStackExpanded: false,
        generationStatus: 'generating',
        generationError: null,
      } as any);
    }
    
    try {
      await contextHandleGenerate({
        prompt: finalPrompt,
        model: localModel,
        resolution: localResolution,
        aspectRatio: localRatio,
        generationCount: localCount,
        images: referenceImages,
        isUrls: isUrls,
        quality: localQuality,  // #523 T8Star 品质参数
        
        // 👑 #418 修复：注入缺失的 mode 路由参数
        mode: 'image',
        
        // ====== #388 恢复 #364 原地进化逻辑 ======
        onImageReceived: (data) => {
          // 失败状态不处理，由 onPlaceholderFailed 处理
          if (data.status === 'failed') {
            return;
          }
          
          if (!data.url) {
            return;
          }
          
          // #400: 更新生成进度
          setCurrentGeneratingIndex(data.index + 1); // 已收到图片数量
          
          // #398: 使用本地 ref 追踪已收到的图片，避免闭包问题
          // #525 混合架构：优先使用服务商URL（providerUrl），COS签名URL作为fallback
          const displayUrl = (data as any).providerUrl || data.url;
          receivedImagesRef.current.urls.push(displayUrl);
          // 👑 #418 修复：强制对齐双数组长度！使用空字符串占位，确保 index 绝对一致
          // #492 修复：优先读取 imageKey（后端 SSE 发送的字段名），兼容 key
          receivedImagesRef.current.keys.push(data.imageKey || data.key || '');
          // #525 混合架构：同时存储服务商原始URL（用于onError降级判断）
          receivedImagesRef.current.providerUrls.push((data as any).providerUrl || '');
          
          // 第一张图片：根据实际图片尺寸调整面板
          if (data.index === 0) {
            // #531 修复：砍掉"同步猜测调整"，一切以图片真实加载后的比例为最高准则
            // 只更新图片URL/Keys，面板尺寸由 img.onload 裁决
            
            onUpdateElement(el.id, {
              // #522 修复：保持用户选择的比例
              panelRatio: localRatio,
              imageUrls: [...receivedImagesRef.current.urls],
              imageKeys: [...receivedImagesRef.current.keys],
              providerUrls: [...receivedImagesRef.current.providerUrls],
              generationStatus: 'completed',
            } as any);
            
            // #531 修复：img.onload 成为最终裁决者
            // #军师方案：BORDER_OFFSET 补偿，解决灰色填充和模糊问题
            // 获取最真实的物理图片比例，保持面板最长边不变，根据实际比例重塑面板
            const img = new window.Image();
            img.onload = () => {
              const actualRatio = img.width / img.height;
              
              // 军师方案：边框占用的空间需要补偿
              // 面板有 border: 2px，上下/左右各 2px，总共 4px
              const BORDER_OFFSET = 4;
              
              // 获取当前面板外壳最长边
              const currentMaxEdge = Math.max(el.width, el.height);
              
              // 计算完美的【内部空间】尺寸
              let targetInnerWidth: number, targetInnerHeight: number;
              
              if (actualRatio >= 1) {
                // 宽图或方图：内部宽度 = 最长边 - 边框损耗
                targetInnerWidth = currentMaxEdge - BORDER_OFFSET;
                targetInnerHeight = targetInnerWidth / actualRatio;
              } else {
                // 长图（如1:3）：内部高度 = 最长边 - 边框损耗
                targetInnerHeight = currentMaxEdge - BORDER_OFFSET;
                targetInnerWidth = targetInnerHeight * actualRatio;
              }
              
              // 加上边框厚度，得到最终的【外壳面板】尺寸
              const finalWidth = Math.round(targetInnerWidth + BORDER_OFFSET);
              const finalHeight = Math.round(targetInnerHeight + BORDER_OFFSET);
              
              const centerX = el.x + el.width / 2;
              const centerY = el.y + el.height / 2;
              
              onUpdateElement(el.id, {
                x: Math.round(centerX - finalWidth / 2),
                y: Math.round(centerY - finalHeight / 2),
                width: finalWidth,
                height: finalHeight,
                actualWidth: img.width,
                actualHeight: img.height,
              } as any);
            };
            img.src = displayUrl || data.url;
          }
          
          // 后续图片：追加到面板的 imageUrls 数组
          if (data.index > 0) {
            onUpdateElement(el.id, {
              imageUrls: [...receivedImagesRef.current.urls],
              imageKeys: [...receivedImagesRef.current.keys],
              providerUrls: [...receivedImagesRef.current.providerUrls],
            } as any);
          }
          
          // #400: 所有图片生成完成后，关闭生成状态
          if (data.index + 1 >= localCount) {
            setIsLocalGenerating(false);
          }
        },
        
        // ====== onPlaceholderFailed: 标记失败状态 ======
        onPlaceholderFailed: (elementId, error) => {
          // #727 翻译英文错误消息为中文
          const translatedError = translateErrorMessage(error || '未知错误');
          onUpdateElement(el.id, {
            generationStatus: 'failed',
            generationError: translatedError,
          } as any);
          setIsLocalGenerating(false);
        },
        
        // ====== #388 onComplete: 兜底处理（如果 onImageReceived 未被调用）======
        onComplete: (result) => {
          const receivedCount = receivedImagesRef.current.urls.length;
          const resultImageUrls = result.imageUrls || [];
          const resultImageKeys = result.imageKeys || [];
          const resultProviderUrls = result.providerUrls || [];  // #528 轮询路径的providerUrls
          
          
          if (receivedCount === 0) {
            // #529 修复：SSE超时后轮询返图，onImageReceived从未被调用
            // 需要设置图片URL + 调整面板尺寸（与onImageReceived逻辑一致）
            if (resultImageUrls.length > 0) {
              const updates: any = {
                imageUrls: resultImageUrls,
                imageKeys: resultImageKeys,
                generationStatus: 'completed',
              };
              // #528 混合架构：轮询返图时也设置providerUrls
              if (resultProviderUrls.length > 0) {
                updates.providerUrls = resultProviderUrls;
              }
              onUpdateElement(el.id, updates);
              
              // #531 修复：轮询返图时也使用 img.onload 真实裁决
              // #军师方案：BORDER_OFFSET 补偿，解决灰色填充和模糊问题
              const firstUrl = resultProviderUrls[0] || resultImageUrls[0];  // #528 优先使用服务商URL
              const adjustImg = new window.Image();
              adjustImg.onload = () => {
                // #军师方案：边框占用的空间需要补偿
                const BORDER_OFFSET = 4;
                const actualRatio = adjustImg.width / adjustImg.height;
                const currentMaxEdge = Math.max(el.width, el.height);
                
                // 计算完美的【内部空间】尺寸
                let targetInnerWidth: number, targetInnerHeight: number;
                if (actualRatio >= 1) {
                  targetInnerWidth = currentMaxEdge - BORDER_OFFSET;
                  targetInnerHeight = targetInnerWidth / actualRatio;
                } else {
                  targetInnerHeight = currentMaxEdge - BORDER_OFFSET;
                  targetInnerWidth = targetInnerHeight * actualRatio;
                }
                
                // 加上边框厚度，得到最终的【外壳面板】尺寸
                const finalWidth = Math.round(targetInnerWidth + BORDER_OFFSET);
                const finalHeight = Math.round(targetInnerHeight + BORDER_OFFSET);
                
                const centerX = el.x + el.width / 2;
                const centerY = el.y + el.height / 2;
                onUpdateElement(el.id, {
                  x: Math.round(centerX - finalWidth / 2),
                  y: Math.round(centerY - finalHeight / 2),
                  width: finalWidth,
                  height: finalHeight,
                  actualWidth: adjustImg.width,
                  actualHeight: adjustImg.height,
                } as any);
              };
              adjustImg.onerror = () => {
                // #528 图片加载失败时，尝试降级到代理URL
                console.warn('[GeneratePanel] #528 轮询返图图片加载失败，尝试代理URL:', firstUrl?.substring(0, 80));
                if (resultImageKeys[0]) {
                  const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(resultImageKeys[0])}`;
                  const fallbackImg = new window.Image();
                  fallbackImg.onload = () => {
                    // #军师方案：边框占用的空间需要补偿
                    const BORDER_OFFSET = 4;
                    const actualRatio = fallbackImg.width / fallbackImg.height;
                    const currentMaxEdge = Math.max(el.width, el.height);
                    
                    // 计算完美的【内部空间】尺寸
                    let targetInnerWidth: number, targetInnerHeight: number;
                    if (actualRatio >= 1) {
                      targetInnerWidth = currentMaxEdge - BORDER_OFFSET;
                      targetInnerHeight = targetInnerWidth / actualRatio;
                    } else {
                      targetInnerHeight = currentMaxEdge - BORDER_OFFSET;
                      targetInnerWidth = targetInnerHeight * actualRatio;
                    }
                    
                    // 加上边框厚度，得到最终的【外壳面板】尺寸
                    const finalWidth = Math.round(targetInnerWidth + BORDER_OFFSET);
                    const finalHeight = Math.round(targetInnerHeight + BORDER_OFFSET);
                    
                    const centerX = el.x + el.width / 2;
                    const centerY = el.y + el.height / 2;
                    onUpdateElement(el.id, {
                      x: Math.round(centerX - finalWidth / 2),
                      y: Math.round(centerY - finalHeight / 2),
                      width: finalWidth,
                      height: finalHeight,
                      actualWidth: fallbackImg.width,
                      actualHeight: fallbackImg.height,
                    } as any);
                  };
                  fallbackImg.src = proxyUrl;
                }
              };
              adjustImg.src = firstUrl;
            }
            setIsLocalGenerating(false);
          } else if (receivedCount >= localCount) {
            // 所有图片都已收到，安全关闭
            setIsLocalGenerating(false);
          } else {
            // #529 修复：已收到部分图片但未收齐
            // 检查轮询结果是否有额外的图片需要添加
            if (resultImageUrls.length > receivedCount) {
              // 轮询返回了更多图片，更新元素
              // 合并：保留已收到的 + 添加轮询发现的新图片
              const mergedUrls = [...receivedImagesRef.current.urls];
              const mergedKeys = [...receivedImagesRef.current.keys];
              const mergedProviderUrls = [...(receivedImagesRef.current.providerUrls || [])];  // #528
              // 添加轮询结果中不在已接收列表中的URL
              for (const url of resultImageUrls) {
                if (!mergedUrls.includes(url)) {
                  mergedUrls.push(url);
                  const idx = resultImageUrls.indexOf(url);
                  mergedKeys.push(resultImageKeys[idx] || '');
                  mergedProviderUrls.push(resultProviderUrls[idx] || '');  // #528
                }
              }
              const updates: any = {
                imageUrls: mergedUrls,
                imageKeys: mergedKeys,
                generationStatus: 'completed',
              };
              if (mergedProviderUrls.length > 0) {
                updates.providerUrls = mergedProviderUrls;  // #528
              }
              onUpdateElement(el.id, updates);
            }
            // 立即关闭生成状态，不再等3秒
            // （轮询已经确认最终结果，没必要继续等待）
            setIsLocalGenerating(false);
          }
        },
        
        // ====== onError: 错误处理 ======
        onError: (error) => {
          // 👑 #420 修复：拦截超时事件，任务可能仍在处理中
          if (error.message?.includes('超时') || error.type === 'timeout') {
            // #856 修复：超时也必须解除 isLocalGenerating，否则面板永远卡在 Loading
            setIsLocalGenerating(false);
            onUpdateElement(el.id, { generationStatus: 'timeout' } as any);
            // 超时不等于失败，任务可能仍在后台处理
            toast.info('生成超时，任务可能仍在后台处理，请稍后查看结果');
            return;
          }
          
          setIsLocalGenerating(false);
          
          // 👑 #420 修复：局部止损机制 - 检查是否已有部分图片
          const hasPartialImages = receivedImagesRef.current.urls.length > 0;
          if (hasPartialImages) {
            // 强行按完成处理，保护图片不被遮挡
            onUpdateElement(el.id, {
              generationStatus: 'completed',
              imageUrls: [...receivedImagesRef.current.urls],
              imageKeys: [...receivedImagesRef.current.keys],
              providerUrls: [...receivedImagesRef.current.providerUrls],
            } as any);
          } else {
            // 一张图都没出，才是真正的失败
            // #727 翻译英文错误消息为中文
            const translatedError = translateErrorMessage(error.message || '未知错误');
            onUpdateElement(el.id, {
              generationStatus: 'failed',
              generationError: translatedError,
            } as any);
          }
        },

        // ====== onStillProcessing: 后端轮询超时但任务仍在处理（#852 离线异步） ======
        onStillProcessing: () => {
          console.log('[GeneratePanel] 任务仍在处理中，离线巡检接管，停止前端等待');
          setIsLocalGenerating(false);
          onUpdateElement(el.id, {
            generationStatus: 'processing_async',
            generationError: undefined,
          } as any);
          toast?.('视频任务已提交后台处理，完成后可在历史记录中查看', { duration: 5000 });
        },
      });
    } catch (error: any) {
      // 👑 #420 修复：图片面板 catch 块也需要局部止损
      setIsLocalGenerating(false);
      const hasPartialImages = receivedImagesRef.current.urls.length > 0;
      if (hasPartialImages) {
        onUpdateElement(el.id, {
          generationStatus: 'completed',
          imageUrls: [...receivedImagesRef.current.urls],
          imageKeys: [...receivedImagesRef.current.keys],
          providerUrls: [...receivedImagesRef.current.providerUrls],
        } as any);
      } else {
        // #727 翻译英文错误消息为中文
        const translatedError = translateErrorMessage(error?.message || '未知错误');
        onUpdateElement(el.id, {
          generationStatus: 'failed',
          generationError: translatedError,
        } as any);
      }
    }
  }, [
    el.id, el.panelType, el.x, el.y, el.width, el.height,
    localModel, localResolution, localRatio, localCount,
    localVideoDuration, localVideoAspectRatio, localVideoSize,
    onUpdateElement, contextHandleGenerate,
    // #398: 移除 allElements，使用 ref 追踪图片
  ]);

  const handleGenerateClick = async () => {
    // #511 修复：未登录时拦截并弹出登录框
    if (!isLoggedIn) {
      setAuthModalOpen(true);
      return;
    }
    
    // #366 修正：严格数据隔离 - 只使用本面板输入的提示词
    // 不继承上游面板的提示词（sourceTextContent 已删除）
    let prompt = localPrompt.trim();
    
    // #508 优化：收集所有连接的文本面板的生成内容，与自身提示词合并
    const textPanelPrompts: string[] = [];
    if (sourceIds.length > 0) {
      for (const sourceId of sourceIds) {
        const sourceEl = allElements.find(e => e.id === sourceId);
        if ((sourceEl as any).type === 'generate-panel' && (sourceEl as any).panelType === 'text') {
          const textContent = (sourceEl as any).textContent;
          if (textContent && textContent.trim() && textContent !== '生成失败，请重试') {
            textPanelPrompts.push(textContent.trim());
          }
        }
      }
    }
    
    // 合并提示词逻辑：
    // - 自身有提示词 + 文本面板有内容：自身提示词 + "。" + 文本面板内容合并
    // - 自身无提示词 + 文本面板有内容：直接使用文本面板内容合并
    // - 自身有提示词 + 无文本面板内容：仅使用自身提示词
    if (textPanelPrompts.length > 0) {
      const mergedTextPanelPrompt = textPanelPrompts.join('。');
      if (prompt) {
        // 自身有提示词，追加文本面板内容
        // 如果自身提示词已以句号结尾，不重复添加
        const separator = prompt.endsWith('。') || prompt.endsWith('.') || prompt.endsWith('!') || prompt.endsWith('?') ? '' : '。';
        prompt = prompt + separator + mergedTextPanelPrompt;
      } else {
        // 自身无提示词，直接使用文本面板内容
        prompt = mergedTextPanelPrompt;
      }
    }
    
    // 🔧 #853 修复：异步上传竞态拦截 - 检查素材是否仍在上传中
    // 如果用户手速极快，在图片/视频还在上传 COS 时就点"发送"，会导致 blob: URL 被发给后端
    if (sourceImageEls.length > 0) {
      const uploadingCount = sourceImageEls.filter(el => el.isLoading).length;
      const blobUrlCount = sourceImageEls.filter(el => {
        const url = el.isVideo ? el.videoUrl : el.imageUrl;
        return url && url.startsWith('blob:');
      }).length;
      
      if (uploadingCount > 0 || blobUrlCount > 0) {
        console.warn(`[GeneratePanel] #853 素材上传中: uploading=${uploadingCount}, blobUrl=${blobUrlCount}`);
        setInfoDialog({
          open: true,
          title: '素材正在同步',
          description: '素材正在努力同步至云端，请稍等片刻...',
        });
        return;
      }
    }
    
    // 🔧 #461 修复：静默发送漏洞 - 检查 sourceIds 与 sourceImageEls 一致性
    // 如果面板连接了参考图（sourceIds 有值），但 sourceImageEls 为空或缺少 imageKey，应该阻断
    if (sourceIds.length > 0) {
      // 情况1：参考图元素不存在（被删除或找不到）
      if (sourceImageEls.length === 0) {
        console.error('[GeneratePanel] #461 参考图丢失: sourceIds 有值但 sourceImageEls 为空');
        setInfoDialog({
          open: true,
          title: '参考图丢失',
          description: '连接的参考图已丢失或被删除，请重新连接参考图',
        });
        return;
      }
      
      // 情况2：参考图元素存在但缺少 imageKey（上传未完成或失败）
      const missingKeyCount = sourceImageEls.filter(el => !el.imageKey).length;
      if (missingKeyCount > 0) {
        console.error(`[GeneratePanel] #461 参考图缺少 imageKey: ${missingKeyCount}/${sourceImageEls.length}`);
        setInfoDialog({
          open: true,
          title: '参考图上传中',
          description: '部分参考图正在上传或上传失败，请稍后重试',
        });
        return;
      }
      
      // 情况3：sourceIds 数量与 sourceImageEls 数量不一致
      if (sourceIds.length !== sourceImageEls.length) {
        console.warn(`[GeneratePanel] #461 sourceIds 与 sourceImageEls 数量不一致: ${sourceIds.length} vs ${sourceImageEls.length}`);
        // 不阻断，但记录警告（可能是因为级联查找）
      }
    }
    
    const canGenerate = sourceImageEls.length > 0 || prompt.trim().length > 0;
    
    // #482 修复：移除全局 isGenerating 依赖，只使用本面板的 isLocalGenerating
    // 这样一个面板生成时不会锁定其他面板
    if (!canGenerate || isLocalGenerating) {
      return;
    }
    
    const finalPrompt = prompt.trim() || '生成图片';
    
    // ====== #366: 检查是否有已连接的 image-stack ======
    const existingStack = findConnectedImageStack();
    
    if (existingStack && existingStack.imageUrls.length > 0) {
      // 有已连接且有图片的 image-stack，弹出确认弹窗
      setPendingGenerateParams({
        prompt: finalPrompt,
        referenceImages: [],
        isUrls: false,
      });
      setShowOverwriteConfirm(true);
      return;
    }
    
    // ====== Step 2: 获取参考图（#405 修复：使用统一 Hook）======
    // #636 当模型不支持视频参考时，过滤掉视频类型的参考图
    const filteredSourceEls = (isHappyHorseModel || el.panelType !== 'video')
      ? sourceImageEls
      : sourceImageEls.filter(el => !el.isVideo);
    // #452 修复：传入 getLatestElement 解决 React 状态更新延迟问题
    const refResult = await extractReferenceImages(filteredSourceEls, getLatestElement);
    
    
    // 红线3：错误时阻断并提示
    if (refResult.error) {
      setInfoDialog({
        open: true,
        title: '参考图错误',
        description: refResult.error,
      });
      return;
    }
    
    const referenceImages = refResult.images;
    const isUrls = refResult.isUrls;
    
    // 执行生成
    await executeGenerate(finalPrompt, referenceImages, isUrls, existingStack?.id || null);
  };
  
  // #366: 确认覆盖后执行生成
  const handleConfirmOverwrite = async () => {
    setShowOverwriteConfirm(false);
    
    if (!pendingGenerateParams) return;
    
    // 🔧 #853 修复：异步上传竞态拦截 - 覆盖确认后也需检查上传状态
    if (sourceImageEls.length > 0) {
      const uploadingCount = sourceImageEls.filter(el => el.isLoading).length;
      const blobUrlCount = sourceImageEls.filter(el => {
        const url = el.isVideo ? el.videoUrl : el.imageUrl;
        return url && url.startsWith('blob:');
      }).length;
      
      if (uploadingCount > 0 || blobUrlCount > 0) {
        console.warn(`[GeneratePanel] #853 覆盖确认时素材上传中: uploading=${uploadingCount}, blobUrl=${blobUrlCount}`);
        setInfoDialog({
          open: true,
          title: '素材正在同步',
          description: '素材正在努力同步至云端，请稍等片刻...',
        });
        setPendingGenerateParams(null);
        return;
      }
    }
    
    // 🔧 #461 修复：静默发送漏洞 - 检查 sourceIds 与 sourceImageEls 一致性
    if (sourceIds.length > 0) {
      if (sourceImageEls.length === 0) {
        console.error('[GeneratePanel] #461 参考图丢失: sourceIds 有值但 sourceImageEls 为空');
        setInfoDialog({
          open: true,
          title: '参考图丢失',
          description: '连接的参考图已丢失或被删除，请重新连接参考图',
        });
        setPendingGenerateParams(null);
        return;
      }
      
      const missingKeyCount = sourceImageEls.filter(el => !el.imageKey).length;
      if (missingKeyCount > 0) {
        console.error(`[GeneratePanel] #461 参考图缺少 imageKey: ${missingKeyCount}/${sourceImageEls.length}`);
        setInfoDialog({
          open: true,
          title: '参考图上传中',
          description: '部分参考图正在上传或上传失败，请稍后重试',
        });
        setPendingGenerateParams(null);
        return;
      }
    }
    
    // #405 修复：使用统一 Hook 获取参考图
    // #636 当模型不支持视频参考时，过滤掉视频类型的参考图
    const filteredSourceEls2 = (isHappyHorseModel || el.panelType !== 'video')
      ? sourceImageEls
      : sourceImageEls.filter(el => !el.isVideo);
    // #452 修复：传入 getLatestElement 解决 React 状态更新延迟问题
    const refResult = await extractReferenceImages(filteredSourceEls2, getLatestElement);
    
    
    // 红线3：错误时阻断并提示
    if (refResult.error) {
      setInfoDialog({
        open: true,
        title: '参考图错误',
        description: refResult.error,
      });
      setPendingGenerateParams(null);
      return;
    }
    
    const referenceImages = refResult.images;
    const isUrls = refResult.isUrls;
    
    const existingStack = findConnectedImageStack();
    await executeGenerate(
      pendingGenerateParams.prompt,
      referenceImages,
      isUrls,
      existingStack?.id || null
    );
    setPendingGenerateParams(null);
  };
  
  // #366: 取消覆盖
  const handleCancelOverwrite = () => {
    setShowOverwriteConfirm(false);
    setPendingGenerateParams(null);
  };

  // 弹窗通用样式（相对定位，紧贴按钮上方）- #319 缩小尺寸
  const pickerStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    marginBottom: '4px',
    width: '280px',
    maxHeight: '60vh',
    background: '#27272a',
    border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
    borderRadius: '8px',
    boxShadow: '0 5px 12px rgba(0, 0, 0, 0.25)',
    zIndex: 9999,
    overflow: 'hidden',
  };

  // #性能优化：isBeingSnapped 和 isAlreadyConnected 现在由父组件计算后传入
  // 原问题：snapHighlightId/connectionDraftSourceId 每次拖拽都变，导致所有面板重渲染
  
  // ====== #492 Portal 渲染函数 - 解决按钮模糊问题 ======
  // 计算屏幕坐标：面板在画布上的逻辑坐标 → 屏幕物理坐标
  const screenX = Math.round(el.x * zoom + pan.x);
  const screenY = Math.round(el.y * zoom + pan.y);
  const screenWidth = Math.round(el.width * zoom);
  const screenHeight = Math.round(el.height * zoom);
  
  // 标签渲染（在面板内部，使用反向缩放避免模糊）
  const renderLabel = () => {
    // #416 有图片时隐藏顶部栏
    if (((el as any).imageUrls as string[])?.length) return null;

    return (
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: -28,  // 向上偏移28px，显示在面板上方
          width: 200,  // 固定宽度，避免被面板宽度压缩
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          pointerEvents: 'none', // 不阻挡交互
          zIndex: 100,  // 在面板内部最高
          transform: `scale(${1/zoom})`,  // 反向缩放，抵消第三层的 scale(zoom)
          transformOrigin: 'left bottom',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            overflow: 'hidden',
          }}
        >
          {/* Logo图标 - 灰色背景 */}
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#27272a',
            }}
          >
            {el.panelType === 'text' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            ) : el.panelType === 'video' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            )}
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: theme === 'dark' ? '#fff' : '#333',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flexShrink: 1,
            }}
          >
            {el.panelType === 'text' ? '文本生成' : el.panelType === 'video' ? '视频生成' : '图片生成'}
          </span>
        </div>
      </div>
    );
  };
  
  // 下方控制台 Portal 渲染
  const renderControlsOverlay = () => {
    const overlayRoot = document.getElementById('panel-ui-overlay-root');
    if (!overlayRoot) return null;
    
    if (!isInputActive) return null;
    
    // 控制台位置：面板底部居中
    // #663 副面板宽度降低10%（672→605）
    const controlWidth = 605;
    const controlX = Math.round(screenX + screenWidth / 2 - controlWidth / 2);
    const controlY = Math.round(screenY + screenHeight + 8); // 底部 + 8px 间距
    
    return createPortal(
      <div
        style={{
          position: 'absolute',
          left: controlX,
          top: controlY,
          width: controlWidth,
          pointerEvents: 'auto', // 确保输入框可以点击
          zIndex: 110,  // 高于面板（50-100）和选中框（100）
          // 🌟 无 transform scale！按钮永远 1:1 高清！
        }}
      >
        {/* 控制台内容将在下面补充 */}
        <div style={{ background: '#27272a', borderRadius: '16px', padding: '16px' }}>
          {/* 占位，具体内容在下方 render 中实现 */}
        </div>
      </div>,
      overlayRoot
    );
  };
  
  return (
    <div
      key={el.id}
      className={`generate-panel-container panel-glow-border ${isBeingSnapped ? 'panel-silver-active' : ''}`}
      data-generate-panel="true"
      data-panel-id={el.id}
      style={{
        position: 'absolute',
        left: el.x,
        top: el.y,
        width: el.width,
        height: el.height,
        zIndex: 1,  // #600 物理置顶：zIndex 由外层容器控制，不依赖 selected 状态
        overflow: 'visible',
        pointerEvents: 'auto',
        background: '#27272a', 
        borderRadius: panelBorderRadius,
        // #395 边框转移到首图上，避免被背景图片盖住
        border: 'none',
        boxShadow: isBeingSnapped 
          ? '0 0 20px rgba(192, 192, 192, 0.5), 0 8px 32px rgba(0,0,0,0.6)' 
          : '0 8px 32px rgba(0,0,0,0.6)',
        boxSizing: 'border-box',
        // #384 已连接的面板显示朦胧感（只用 opacity，不用 filter 避免触发 GPU 图层提升）
        opacity: isAlreadyConnected ? 0.5 : 1,
        // #模糊修复 终极手术：全面降维，打造"绝对 2D 扁平世界"！
        // ❌ 彻底删除所有 GPU 硬件加速属性！
        // - 删除 willChange: 'transform'：混合合成陷阱的辐射源
        // - 删除 transform: 'translateZ(0)'：在 scale 容器内会触发 CPU 图片重栅格化
        // - 删除 rotateY(-3deg)：3D Transform 会触发 Chrome 合成层恐慌
        // - 删除 filter: grayscale/blur：filter 也会触发重排和图层提升
        // ✅ 仅保留 CPU 级别的布局隔离
        contain: 'layout style',
        // 现在面板回归纯 2D 渲染，彻底根除跨图层重绘污染！
        transition: 'box-shadow 0.3s ease-out, border-color 0.3s ease-out, opacity 0.2s ease-out',
        // 字体抗锯齿
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
      }}
        onContextMenu={(e) => {
          // #320 修复：阻止右键菜单冒泡到画布 + 阻止浏览器默认菜单
          // #330 新增：显示面板右键菜单
          // #874 修复：白名单放行——输入框/可编辑元素必须弹出原生菜单
          // #886 修复：收紧白名单，移除 isEditing 和 window.getSelection 宽泛判断
          // 只有 INPUT/TEXTAREA 和 contenteditable 元素才放行原生右键菜单
          // #886 修复：用 closest() 向上穿透，兼容 shadcn/ui 等组件外层套 div 的情况

          const target = e.target as HTMLElement;

          // 1. 点击的是 INPUT/TEXTAREA 或其父容器 → 放行原生菜单
          if (target.closest?.('input, textarea')) {
            e.stopPropagation(); // 阻止冒泡到画布，但不杀原生菜单
            return;
          }

          // 2. 点击的是 contenteditable 元素（向上穿透查找）→ 放行原生菜单
          if (target.closest?.('[contenteditable="true"]')) {
            e.stopPropagation();
            return;
          }

          // 以下：非文本交互场景，弹出面板右键菜单
          e.preventDefault();
          // 多选时：不阻止冒泡，让画布级右键菜单处理多选菜单
          if (selectedIds.length > 1 && selectedIds.includes(el.id)) {
            // 让事件冒泡到画布，由画布的 handleContextMenu 显示多选菜单
            return;
          }
          e.stopPropagation();
          setPanelContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
      {/* #371 边框流光效果 - mask-composite 镂空法 */}
      {isBeingSnapped && (
        <div 
          className="panel-magic-glow" 
          style={{ 
            borderRadius: '12px',
            position: 'absolute',
            inset: -2,
          }} 
        />
      )}
      {/* #352 左上角外侧标签 - 使用 Portal 渲染到画布外部，彻底消除 scale 模糊 */}
      {/* #416 有图片时隐藏顶部栏 */}
      {/* #493 Portal 重构：按钮永远 1:1 高清 */}
      {renderLabel()}

      {/* ====== 三、端口连接逻辑（面板专用：悬浮显示 + 磁吸放大） ====== */}
      
      {/* 左侧输入端口 - 用于接收连线 */}
      {/* #367 完全复刻图片节点：hoveredElementId 控制显示/隐藏 */}
      {/* #614 加号大小使用最小边，与单图/多选一致 */}
      {(() => {
        // #614 #569 规范：最小边 * 0.05，与单图/多选一致
        const avgSize = Math.min(el.width, el.height);
        const buttonSize = avgSize * 0.05;
        const containerSize = buttonSize + 15;
        const iconSize = Math.round(buttonSize * 0.6);
        // 👑 #军师方案：删除 isSnapActive 判断，改用 CSS .port-snap-active 控制放大效果
        const isHovered = hoveredElementId === el.id;
        
        // #性能优化：直接使用 props 传入的 isAlreadyConnected，不再局部计算
        
        return (
          <div
            style={{
              position: 'absolute',
              left: -containerSize - 8, // 悬浮在面板左侧外面，保持8px间距与右侧一致
              top: '50%',
              transform: 'translateY(-50%)',
              width: containerSize,
              height: containerSize,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              // #367 完全复刻图片节点：悬浮时显示
              // #380 删除幽灵 pointerEvents，端口必须始终可点击
              // #384 已连接时显示朦胧感（只用 opacity，不用 filter 避免触发 GPU 图层提升）
              opacity: isAlreadyConnected ? 0.3 : (isHovered ? 1 : 0),
              pointerEvents: 'auto',
              zIndex: 100,
              // #模糊修复 终极手术：删除 GPU 辐射源，回归纯 2D 渲染
              // willChange 已删除，避免混合合成陷阱
            }}
          >
            {/* 中间偏移层（用于动画） */}
            <div
              id={`magnet-btn-input-${el.id}`}
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform 0.08s ease-out',
              }}
            >
              {/* 核心视觉实体：圆形 + 渐变背景 + 边框 */}
              <div
                className={`node-connection-port-hitbox connection-port-input`}
                data-port-target={el.id}
                data-port-type="input"
                style={{
                  width: buttonSize,
                  height: buttonSize,
                  // #367 完全复刻图片节点：悬浮时显示渐变背景
                  background: isHovered
                    ? (theme === 'dark'
                        ? 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)'
                        : 'linear-gradient(135deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.05) 100%)')
                    : 'transparent',
                  border: theme === 'dark' ? '2px solid rgba(255,255,255,0.7)' : '2px solid rgba(0,0,0,0.7)',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: isHovered
                    ? (theme === 'dark' ? '0 2px 8px rgba(255,255,255,0.15)' : '0 2px 8px rgba(0,0,0,0.2)')
                    : (theme === 'dark' ? '0 1px 3px rgba(255,255,255,0.1)' : '0 1px 3px rgba(0,0,0,0.15)'),
                  // #军师方案：删除 isSnapActive 判断，CSS .port-snap-active 控制放大
                  transform: isHovered ? 'scale(1.1)' : 'scale(0.5)',
                  transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                  pointerEvents: 'auto',
                  cursor: 'crosshair',
                }}
                title={isAlreadyConnected ? "已连接此源" : "拖拽连线到此端口"}
                onPointerUpCapture={(e) => {
                  e.stopPropagation();
                  if (e.nativeEvent && (e.nativeEvent as any).stopImmediatePropagation) {
                    (e.nativeEvent as any).stopImmediatePropagation();
                  }
                  // #384 已连接的源不触发连接
                  if (isAlreadyConnected) {
                    return;
                  }
                  onInputPortPointerUp(el.id);
                }}
                onPointerDownCapture={(e) => {
                  e.stopPropagation();
                  if (e.nativeEvent && (e.nativeEvent as any).stopImmediatePropagation) {
                    (e.nativeEvent as any).stopImmediatePropagation();
                  }
                }}
                onMouseDownCapture={(e) => e.stopPropagation()}
              >
                {/* 加号图标 */}
                <svg style={{ pointerEvents: 'none' }} width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke={theme === 'dark' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </div>
            </div>
          </div>
        );
      })()}
      
      {/* 右侧输出端口 - 用于拉出连线 */}
      {/* 注意：面板端口不依赖悬浮显示，始终可见 */}
      {/* #594 多选时隐藏面板加号，避免遮挡多选框加号 */}
      {(() => {
        // #594 多选时隐藏面板加号（与 InteractiveImageStackNode 逻辑一致）
        const isInMultiSelect = selectedIds && selectedIds.length > 1 && selectedIds.includes(el.id);
        if (isInMultiSelect) {
          return null;
        }
        
        const connectedStack = findConnectedImageStack();
        const hasOutput = connectedStack && connectedStack.imageUrls.length > 0;
        
        // #614 #569 规范：最小边 * 0.05，与单图/多选一致
        const avgSize = Math.min(el.width, el.height);
        const buttonSize = avgSize * 0.05;
        const containerSize = buttonSize + 15;
        const iconSize = Math.round(buttonSize * 0.6);
        // 👑 #军师方案：删除 isSnapActive 判断，改用 CSS .port-snap-active 控制放大效果
        const isHovered = hoveredElementId === el.id;
        
        return (
          <div
            style={{
              position: 'absolute',
              left: 'calc(100% + 8px)', // 100%是面板右边缘，再往外推8px
              top: '50%',
              transform: 'translateY(-50%)',
              width: containerSize,
              height: containerSize,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              // #367 完全复刻图片节点：悬浮时显示
              // #595 修复：非悬浮时 pointerEvents: 'none'，避免遮挡其他元素
              opacity: isHovered ? 1 : 0,
              pointerEvents: isHovered ? 'auto' : 'none',
              zIndex: 100,
              // #模糊修复 终极手术：删除 GPU 辐射源，回归纯 2D 渲染
              // willChange 已删除，避免混合合成陷阱
            }}
          >
            {/* 中间偏移层（用于动画） */}
            <div
              id={`magnet-btn-output-${el.id}`}
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform 0.08s ease-out',
              }}
            >
              {/* 核心视觉实体：圆形 + 渐变背景 + 边框 */}
              <div
                className={`node-connection-port-hitbox connection-port-output`}
                data-port-target={el.id}
                data-port-type="output"
                style={{
                  width: buttonSize,
                  height: buttonSize,
                  // #367 完全复刻图片节点：悬浮时显示渐变背景
                  background: isHovered
                    ? (theme === 'dark'
                        ? 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)'
                        : 'linear-gradient(135deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.05) 100%)')
                    : 'transparent',
                  border: theme === 'dark' ? '2px solid rgba(255,255,255,0.7)' : '2px solid rgba(0,0,0,0.7)',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: isHovered
                    ? (theme === 'dark' ? '0 2px 8px rgba(255,255,255,0.15)' : '0 2px 8px rgba(0,0,0,0.2)')
                    : (theme === 'dark' ? '0 1px 3px rgba(255,255,255,0.1)' : '0 1px 3px rgba(0,0,0,0.15)'),
                  // #军师方案：删除 isSnapActive 判断，CSS .port-snap-active 控制放大
                  transform: isHovered ? 'scale(1.1)' : 'scale(0.5)',
                  transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                  pointerEvents: 'auto',
                  cursor: 'crosshair',
                }}
                title={hasOutput ? `拖拽连线（传递首图）` : '面板上方暂无图片'}
                onPointerDownCapture={(e) => {
                  e.stopPropagation();
                  if (e.nativeEvent && (e.nativeEvent as any).stopImmediatePropagation) {
                    (e.nativeEvent as any).stopImmediatePropagation();
                  }
                  
                  // 计算连线起点：面板右边缘中心
                  const startX = el.x + el.width;
                  const startY = el.y + el.height / 2;
                  
                  // 直接调用回调启动连线（page.tsx 会设置 draftLineRef）
                  onOutputPortPointerDown(el.id, startX, startY);
                }}
                onPointerUpCapture={(e) => {
                  e.stopPropagation();
                  // #426 拉线结束时清除变灰状态
                  if (onCancelConnection) onCancelConnection();
                }}
                onMouseDownCapture={(e) => e.stopPropagation()}
              >
                {/* 加号图标 */}
                <svg style={{ pointerEvents: 'none' }} width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke={theme === 'dark' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </div>
            </div>
          </div>
        );
      })()}
      
      {/* 上方框：触发相框 - 可拖拽 */}
      {/* #388 展开时需要 overflow: visible 让画廊超出面板边界 */}
      <div
        style={{
          position: 'absolute', inset: 0, 
          display: 'flex', flexDirection: 'column', 
          alignItems: 'center', justifyContent: 'center', 
          cursor: 'move',
          gap: '20px',
          // #392 扑克牌效果也需要超出面板边界，所以始终 visible
          overflow: 'visible'
        }}
        onPointerDown={handleDragStart} 
        onMouseDown={(e) => {
          // 平移模式下不阻止冒泡，让画布处理平移
          if (activeTool === 'hand') return;
          e.stopPropagation();
        }} 
      >
         {/* #364 生成中 shimmer 波动效果 */}
         {/* 👑 #461 修复：zIndex 降为 5，让文字（zIndex: 10）在上层显示清晰 */}
         {(isLocalGenerating || (el.panelType === 'text' && isLlmGenerating)) && (
           <div
             style={{
               position: 'absolute',
               inset: 0,
               overflow: 'hidden',
               borderRadius: panelBorderRadius,
               pointerEvents: 'none',
               zIndex: 5,
             }}
           >
             <div
               style={{
                 position: 'absolute',
                 inset: 0,
                 /* #604 核弹拆除：删除 background-position 动画，改用静态渐变 */
                 background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)',
               }}
             />
           </div>
         )}
         {/* #317 新增：生成中 Loading UI */}
         {/* #634 视频面板进度环已删除 - #886 修复双进度条：改用 CanvasRoseCurve 的线性进度条 + externalProgress 显示真实进度 */}
         {/* #360 文本面板使用 isLlmGenerating，图片/视频面板使用 isLocalGenerating */}
         {/* #360 文本面板流式显示：有响应文本时显示文本+光标，无响应文本时显示加载动画 */}
         {/* 失败状态显示 - #面板面积基准：横向和竖向面板视觉效果一致 */}
         {/* 👑 #420 修复：有图片时不显示错误遮罩，保护部分成功的成果 */}
         {el.generationStatus === 'failed' && (!((el as any).imageUrls?.length) && !((el as any).videoUrls?.length)) ? (
           (() => {
             const areaBasedSize = Math.sqrt(el.width * el.height);
             return (
           <div style={{
             width: '100%',
             height: '100%',
             display: 'flex',
             flexDirection: 'column',
             alignItems: 'center',
             justifyContent: 'center',
             background: 'rgba(239, 68, 68, 0.1)',
             borderRadius: panelBorderRadius,
             padding: `${areaBasedSize * 0.05}px`,
           }}>
             <span style={{ color: '#ef4444', fontSize: `${areaBasedSize * 0.065}px`, fontWeight: '600', marginBottom: `${areaBasedSize * 0.02}px` }}>
               {el.generationError?.includes('违规') || el.generationError?.includes('content_policy') ? '⚠️ 内容违规' : '❌ 生成失败'}
             </span>
             <span style={{ color: '#a1a1aa', fontSize: `${areaBasedSize * 0.06}px`, textAlign: 'center' }}>
               {el.generationError?.includes('违规') || el.generationError?.includes('content_policy') 
                 ? '您的提示词可能包含敏感内容，请修改后重试' 
                 : (el.generationError || '请检查网络或重试')}
             </span>
           </div>
             );
           })()
         ) : el.panelType === 'video' && (el as any).videoUrls && ((el as any).videoUrls as string[]).length > 0 ? (
           // #视频功能 视频面板展示 - #7xx 添加左上角视频标识（与 CanvasVideo 一致）
           <div style={{
             width: '100%',
             height: '100%',
             position: 'relative',
             overflow: 'hidden',
             borderRadius: panelBorderRadius,
             backgroundColor: '#27272a',
           }}>
             <video
               ref={videoRef}
               src={((el as any).videoUrls as string[])[0]}
               autoPlay
               loop
               muted
               playsInline
               controls
               style={{
                 width: '100%',
                 height: '100%',
                 objectFit: 'contain',
               }}
             />
             {/* #7xx 左上角视频标识 - 与 CanvasVideo 一致的自适应缩放 */}
             {(() => {
               const baseSize = Math.min(el.width || 200, el.height || 200);
               const scale = (baseSize / 200) * 0.5; // 以200px逻辑尺寸为基准，整体缩小50%
               const fontSize = Math.round(12 * scale);
               const iconSize = Math.round(14 * scale);
               const padding = Math.round(4 * scale);
               const gap = Math.round(4 * scale);
               const offset = Math.round(8 * scale);
               
               return (
                 <div style={{
                   position: 'absolute',
                   top: offset,
                   left: offset,
                   background: 'rgba(0,0,0,0.6)',
                   borderRadius: `${Math.round(4 * scale)}px`,
                   padding: `${padding}px ${padding * 2}px`,
                   display: 'flex',
                   alignItems: 'center',
                   gap: gap,
                   pointerEvents: 'none',
                   zIndex: 10,
                 }}>
                   <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="white">
                     <polygon points="5,3 19,12 5,21"/>
                   </svg>
                   <span style={{ color: 'white', fontSize }}>{baseSize >= 80 ? '视频' : ''}</span>
                 </div>
               );
             })()}
             {/* 选中边框 */}
             {isSelected && !isBeingSnapped && (
               <div
                 className="absolute pointer-events-none border-2"
                 style={{
                   left: -2,
                   top: -2,
                   width: 'calc(100% + 4px)',
                   height: 'calc(100% + 4px)',
                   borderRadius: panelBorderRadius,
                   zIndex: 30,
                   borderColor: theme === 'dark' ? '#ffffff' : '#000000',
                 }}
               />
             )}
           </div>
         ) : (el as any).imageUrls && (el as any).imageUrls.length > 0 ? (
           // #388 扑克牌堆叠效果 - 支持展开/收起
           // 注意：外层需要 overflow: visible 才能让展开内容超出面板边界
           <div 
             style={{ 
               width: '100%', 
               height: '100%', 
               position: 'relative',
               overflow: 'visible', // 允许展开内容超出面板边界
             }}
             onMouseEnter={() => setHoveredImageIndex(0)}
             onMouseLeave={() => setHoveredImageIndex(null)}
           >
             {isStackExpanded ? (
               // #388 展开状态 - 首图在原面板位置，后续图片向右展开
               // 第2张在首图右方，第3张在第2张右方，第4张在上方新行
               <>
                 {/* 首图 - 保持在原面板位置 */}
                 {/* #395 边框转移到首图上 */}
                 {/* #442 选中时使用首图自身边框，不添加额外选中边框 */}
                 <div style={{
                   position: 'absolute',
                   width: '100%',
                   height: '100%',
                   left: 0,
                   top: 0,
                   zIndex: 20,
                   overflow: 'hidden',
                   borderRadius: panelBorderRadius,
                   border: `2px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
                   boxSizing: 'border-box',
                   backgroundColor: '#27272a',
                   
                   // 👑 军师绝杀 3：画地为牢
                   // 告诉 Chrome：外面加号怎么炸，都不准影响我里面的图片重绘！
                   contain: 'paint layout',
                 }}>
                   {/* #426 修复：主图添加 onError 处理，加载失败时自动刷新签名 URL */}
                   <img
                     src={refreshedImageUrls[`${el.id}-main-${activeImageIndex}`] || ((el as any).providerUrls as string[])?.[activeImageIndex] || ((el as any).imageUrls as string[])[activeImageIndex] || ((el as any).imageUrls as string[])[0]}
                     alt=""
                     style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                     onError={() => handleImageError(((el as any).imageKeys as string[])?.[activeImageIndex], String(activeImageIndex))}
                     referrerPolicy="no-referrer-when-downgrade"
                   />
                 </div>
                 
                 {/* 展开的后续图片 - 向右展开 */}
                 {(() => {
                   const otherUrls = ((el as any).imageUrls as string[]).filter((_: string, i: number) => i !== activeImageIndex);
                   return otherUrls.map((url: string, i: number) => {
                     // 布局：每行最多2张，向右展开，超过2张换到上方新行
                     const rowIndex = Math.floor(i / 2);
                     const colIndex = i % 2;
                     const isTopRow = rowIndex > 0;
                     return (
                       <div
                         key={i}
                         style={{
                           position: 'absolute',
                           width: '100%',
                           height: '100%',
                           // 每行2张，向右展开，超过2张换到上方新行
                           left: `calc(${(colIndex + 1) * 100}% + ${(colIndex + 1) * 8}px)`,
                           top: isTopRow ? `calc(${-rowIndex * 100}% - ${rowIndex * 8}px)` : 0,
                           zIndex: 10 - i,
                           overflow: 'hidden',
                           borderRadius: panelBorderRadius,
                           cursor: 'pointer',
                           // #440 添加边框，与首图保持一致
                           border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
                           boxSizing: 'border-box',
                           backgroundColor: '#27272a',
                           transition: 'transform 0.2s',
                           
                           // 👑 军师绝杀 3：画地为牢
                           // 告诉 Chrome：外面加号怎么炸，都不准影响我里面的图片重绘！
                           contain: 'paint layout',
                         }}
                         onClick={(e) => { 
                           e.stopPropagation(); 
                           // 点击副图不做任何操作，只保留展开状态
                           // 用户需要点击"设为主图"按钮才能切换
                         }}
                         onMouseEnter={(e) => {
                           (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.02)';
                         }}
                         onMouseLeave={(e) => {
                           (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)';
                         }}
                       >
                         {/* #426 修复：次图添加 onError 处理，加载失败时自动刷新签名 URL */}
                         <img
                           src={refreshedImageUrls[`${el.id}-stack-${i}`] || url}
                           alt=""
                           style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                           onError={() => {
                             const imageKeys = (el as any).imageKeys as string[];
                             const imageUrls = (el as any).imageUrls as string[];
                             const originalIndex = imageUrls ? imageUrls.findIndex((u: string) => u === url) : i;
                             handleImageError(imageKeys?.[originalIndex], `stack-${i}`);
                           }}
                           referrerPolicy="no-referrer-when-downgrade"
                         />
                         {/* 右上角按钮组 - 与首图按钮统一样式 */}
                         {(() => {
                           // #441 规则一：fontSize 必须取整（解决主图模糊）
                           // #441 规则二：布局间距绝对禁止取整（解决次图模糊）
                           // #423 vmin 响应式：短边 × 10.8%，确保各比例视觉一致
                           // #490 次图按钮加大 20%：0.09 → 0.108
                           const btnHeight = Math.round(Math.min(el.width, el.height) * 0.108);
                           const btnPadding = btnHeight * 0.15;
                           const fontSize = Math.round(btnHeight * 0.4);  // 规则一：字体取整
                           const gap = btnHeight * 0.2;  // 规则二：布局不取整
                           const topOffset = btnHeight * 0.2;  // 规则二：布局不取整
                           
                           return (
                           <div style={{
                             position: 'absolute',
                             top: `${topOffset}px`,
                             right: `${topOffset}px`,
                             display: 'flex',
                             gap: `${gap}px`,
                             zIndex: 30,
                             // #441 创建独立层叠上下文，隔离模糊层污染
                             isolation: 'isolate',
                           }}>
                             {/* 下载按钮 */}
                             <button
                               onClick={(e) => {
                                 e.stopPropagation();
                                 e.preventDefault();
                                 const originalIndex = ((el as any).imageUrls as string[]).findIndex((u: string) => u === url);
                                 handleDownloadImage(url, originalIndex);
                               }}
                               onPointerDown={(e) => {
                                 e.stopPropagation();
                                 e.preventDefault();
                               }}
                               onMouseDown={(e) => {
                                 e.stopPropagation();
                               }}
                               data-download-button="true"
                               style={{
                                 height: `${btnHeight}px`,
                                 padding: `0 ${btnPadding}px`,
                                 borderRadius: `${btnHeight * 0.1}px`,
                                 background: 'rgba(0,0,0,0.56)',
                                 border: 'none',
                                 cursor: 'pointer',
                                 display: 'flex',
                                 alignItems: 'center',
                                 justifyContent: 'center',
                               }}
                               title="下载"
                             >
                               <svg width={fontSize} height={fontSize} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{ shapeRendering: 'geometricPrecision' }}>
                                 <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" vectorEffect="non-scaling-stroke"/>
                               </svg>
                               <span style={{ marginLeft: '10px', color: 'white', fontSize: `${fontSize}px`, fontWeight: '500', WebkitFontSmoothing: 'antialiased', textRendering: 'geometricPrecision' }}>下载</span>
                             </button>
                             {/* 设为主图按钮 */}
                             <button
                               onClick={(e) => {
                                 e.stopPropagation();
                                 e.preventDefault();
                                 const originalIndex = ((el as any).imageUrls as string[]).findIndex((u: string) => u === url);
                                 // #484 修复：调用 handleSetAsActive 而不是只 setActiveImageIndex
                                 // 这样会同时更新 imageUrls 数组顺序和持久化到 allElements
                                 handleSetAsActive(originalIndex);
                                 setIsStackExpanded(false);
                               }}
                               onPointerDown={(e) => {
                                 e.stopPropagation();
                                 e.preventDefault();
                               }}
                               onMouseDown={(e) => {
                                 e.stopPropagation();
                               }}
                               data-set-main-button="true"
                               style={{
                                 height: `${btnHeight}px`,
                                 padding: `0 ${btnPadding}px`,
                                 borderRadius: `${btnHeight * 0.1}px`,
                                 background: 'rgba(0,0,0,0.56)',
                                 border: 'none',
                                 cursor: 'pointer',
                                 display: 'flex',
                                 alignItems: 'center',
                                 justifyContent: 'center',
                               }}
                               title="设为主图"
                             >
                               <span style={{ color: 'white', fontSize: `${fontSize}px`, fontWeight: '500', WebkitFontSmoothing: 'antialiased', textRendering: 'geometricPrecision' }}>设为主图</span>
                             </button>
                           </div>
                           );
                         })()}
                         {/* 图片编号 */}
                         <div style={{
                           position: 'absolute',
                           bottom: '8px',
                           right: '8px',
                           background: 'rgba(0,0,0,0.56)',
                           color: 'white',
                           fontSize: '12px',
                           fontWeight: 'bold',
                           padding: '4px 8px',
                           borderRadius: '6px',
                           WebkitFontSmoothing: 'antialiased',
                           textRendering: 'geometricPrecision',
                         }}>
                           #{i + 2}
                         </div>
                       </div>
                     );
                   });
                 })()}
                 
                 {/* #400 生成中的占位面板 - 只显示一个，在下一张图片位置 */}
                 {isLocalGenerating && (() => {
                   const currentCount = ((el as any).imageUrls as string[])?.length || 0;
                   // otherCount 是已展开的后续图片数量（不含首图）
                   const otherCount = Math.max(0, currentCount - 1);
                   
                   // 计算下一张图片的位置（与展开图片布局一致）
                   // 布局：每行最多2张，向右展开，超过2张换到上方新行
                   const rowIndex = Math.floor(otherCount / 2);
                   const colIndex = otherCount % 2;
                   const leftPos = `calc(${(colIndex + 1) * 100}% + ${(colIndex + 1) * 8}px)`;
                   const topPos = rowIndex > 0 ? `calc(${-rowIndex * 100}% - ${rowIndex * 8}px)` : '0';
                   
                   return (
                     <div
                       key="placeholder"
                       style={{
                         position: 'absolute',
                         width: '100%',
                         height: '100%',
                         left: leftPos,
                         top: topPos,
                         zIndex: 5,
                         overflow: 'hidden',
                         borderRadius: panelBorderRadius,
                         /* #604 核弹拆除：删除 background-position 动画，改用静态渐变 */
                         background: 'linear-gradient(135deg, #27272a 0%, #3f3f46 50%, #27272a 100%)',
                         display: 'flex',
                         flexDirection: 'column',
                         alignItems: 'center',
                         justifyContent: 'center',
                       }}
                     >
                       {/* 只显示进度文字，不要logo - 基于面积计算字体大小 */}
                       {/* 👑 #461 修复：添加 text-shadow 增强文字清晰度 */}
                       <span style={{ 
                         color: '#d4d4d8', 
                         fontSize: `${Math.sqrt(el.width * el.height) * 0.06}px`, 
                         fontWeight: '600',
                         WebkitFontSmoothing: 'antialiased',
                         textRendering: 'geometricPrecision',
                         textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                       }}>
                         正在生成第{((el as any).imageUrls?.length || 0) + 1}/{localCount}张
                       </span>
                     </div>
                   );
                 })()}
               </>
             ) : (
               <>
                 {/* 收起状态 - 扑克牌效果 - 根据竞品分析结果 */}
                 {((el as any).imageUrls as string[]).length > 1 && (() => {
                   // 排除首图后的其他图片（最多显示8张背景）
                   const otherUrls = ((el as any).imageUrls as string[]).filter((_: string, i: number) => i !== activeImageIndex);
                   
                   return otherUrls.slice(0, 8).map((url: string, i: number) => {
                     const offset = STACK_OFFSETS[i + 1];
                     
                     // #443 动态尺寸缩放比 - 解决面板缩放时扑克牌"飞出"问题
                     // 假设最初调优这套偏移量时，面板的基准宽度是 320px
                     const BASE_WIDTH = 320;
                     // 当前面板真实宽度与基准宽度的比例
                     const sizeRatio = el.width / BASE_WIDTH;
                     // 根据比例动态换算 x 和 y 的物理像素
                     const dynamicX = (offset?.x || 0) * sizeRatio;
                     const dynamicY = (offset?.y || 0) * sizeRatio;
                     
                     return (
                       <div
                         key={i}
                         style={{
                           position: 'absolute',
                           width: '100%',
                           height: '100%',
                           left: 0,
                           top: 0,
                           transformOrigin: 'center center',
                           // #443 核心修复：使用动态计算出来的 dynamicX 和 dynamicY
                           transform: `translate(${dynamicX}px, ${dynamicY}px) rotate(${offset?.rotate || 0}deg) scale(${offset?.scale || 1})`,
                           zIndex: 10 - i,
                           opacity: 1,
                           // ❌ 彻底移除 border、boxShadow、outline
                           // ❌ 彻底移除 overflow: hidden（它是导致旋转边缘出现锯齿的元凶）
                         }}
                       >
                         {/* 第一层：图像本体。把圆角和阴影直接加在 img 标签上 */}
                         <img 
                           src={refreshedImageUrls[`${el.id}-poker-${i}`] || url} 
                           alt="" 
                           style={{ 
                             width: '100%', 
                             height: '100%', 
                             objectFit: 'contain',
                             borderRadius: panelBorderRadius, 
                             boxShadow: '-1px 0px 5px rgba(0,0,0,0.3)',
                             backgroundColor: theme === 'dark' ? '#1e293b' : '#ffffff', // 兜底背景色，防止透明 png 露馅
                           }} 
                           onError={() => {
                             const imageKeys = (el as any).imageKeys as string[];
                             const imageUrls = (el as any).imageUrls as string[];
                             const originalIndex = imageUrls ? imageUrls.findIndex((u: string) => u === url) : i;
                             handleImageError(imageKeys?.[originalIndex], `poker-${i}`);
                           }}
                           referrerPolicy="no-referrer-when-downgrade"
                         />

                         {/* 第二层：👑 SVG 独立矢量边框层。它永远不会因为外层 scale 而变细消失！ */}
                         <svg
                           style={{
                             position: 'absolute',
                             left: 0,
                             top: 0,
                             width: '100%',
                             height: '100%',
                             pointerEvents: 'none', // 绝对不能阻挡图片的拖拽和点击
                             zIndex: 9999, // 确保边框始终在最顶层显示
                           }}
                         >
                           <rect
                             x="0" y="0" width="100%" height="100%" rx={panelBorderRadius}
                             fill="none"
                             stroke={theme === 'dark' ? '#ffffff' : '#000000'}
                             strokeWidth="2"
                             vectorEffect="non-scaling-stroke" /* 核心神技：无视所有层级的缩放，永远保持屏幕物理分辨率 1px！ */
                           />
                         </svg>
                       </div>
                     );
                   });
                 })()}
                 {/* 首图（最上层）- 完全铺满面板 */}
                 {/* #395 边框转移到首图上 */}
                 {/* #442 选中时使用首图自身边框，不添加额外选中边框 */}
                 <div 
                   style={{
                     position: 'absolute',
                     width: '100%',
                     height: '100%',
                     left: 0,
                     top: 0,
                     zIndex: 20,
                     overflow: 'hidden',
                     borderRadius: panelBorderRadius,
                     boxSizing: 'border-box',
                     backgroundColor: '#27272a',
                     border: `2px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
                     
                     // 👑 军师绝杀 3：画地为牢
                     // 告诉 Chrome：外面加号怎么炸，都不准影响我里面的图片重绘！
                     contain: 'paint layout',
                   }}
                 >
                   <img 
                      src={refreshedImageUrls[`${el.id}-main-${activeImageIndex}`] || ((el as any).providerUrls as string[])?.[activeImageIndex] || ((el as any).imageUrls as string[])[activeImageIndex] || ((el as any).imageUrls as string[])[0]} 
                      alt="" 
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                      onError={() => {
                        const imageKeys = (el as any).imageKeys as (string | null)[] | undefined;
                        handleImageError(imageKeys?.[activeImageIndex], String(activeImageIndex));
                      }}
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                 </div>
               </>
             )}
             
             {/* 悬浮操作按钮 - 放在最外层，不受圆角影响 */}
             {/* #401 始终显示按钮和张数，无需选中或悬浮 */}
             {/* #409 按钮尺寸自适应面板大小（无上下限，真正等比例缩放） */}
             {hasImages && (() => {
               // #441 规则一：fontSize 必须取整（解决主图模糊）
               // #441 规则二：布局间距绝对禁止取整（解决次图模糊）
               // #423 vmin 响应式：短边 × 10.8%，确保各比例视觉一致
               // #490 首图按钮加大 20%：0.09 → 0.108
               const btnHeight = Math.round(Math.min(el.width, el.height) * 0.108);
               const btnPadding = btnHeight * 0.15;
               const fontSize = Math.round(btnHeight * 0.4);  // 规则一：字体取整
               const gap = btnHeight * 0.2;  // 规则二：布局不取整
               const topOffset = btnHeight * 0.2;  // 规则二：布局不取整
               
               return (
               <div style={{
                 position: 'absolute',
                 top: `${topOffset}px`,
                 right: `${topOffset}px`,
                 display: 'flex',
                 gap: `${gap}px`,
                 alignItems: 'center',
                 zIndex: 50,
                 // #441 创建独立层叠上下文，隔离模糊层污染
                 isolation: 'isolate',
               }}>
                 {/* 生成中提示 - #421 增大字体 - #508 按已生成数量显示进度 */}
                 {isLocalGenerating && (
                   <span style={{
                     padding: `${btnHeight * 0.1}px ${btnPadding}px`,
                     borderRadius: `${btnHeight * 0.1}px`,
                     background: 'rgba(0,0,0,0.56)',
                     color: 'white',
                     fontSize: `${Math.round(fontSize * 1.25)}px`,
                     fontWeight: '500',
                     WebkitFontSmoothing: 'antialiased',
                     textRendering: 'geometricPrecision',
                   }}>
                     正在生成第{((el as any).imageUrls?.length || 0) + 1}/{localCount}张
                   </span>
                 )}
                 {/* 下载按钮 - 只在展开状态显示，放在展开按钮左边 */}
                 {isStackExpanded && (
                   <button
                     onClick={(e) => { 
                       e.stopPropagation(); 
                       e.preventDefault();
                       const url = ((el as any).imageUrls as string[])[activeImageIndex] || ((el as any).imageUrls as string[])[0];
                       handleDownloadImage(url, activeImageIndex);
                     }}
                     onPointerDown={(e) => e.stopPropagation()}
                     onMouseDown={(e) => e.stopPropagation()}
                     data-download-button="true"
                     style={{
                       height: `${btnHeight}px`,
                       padding: `0 ${btnPadding}px`,
                       borderRadius: `${btnHeight * 0.1}px`,
                       background: 'rgba(0,0,0,0.56)',
                       border: 'none',
                       cursor: 'pointer',
                       display: 'flex',
                       alignItems: 'center',
                       justifyContent: 'center',
                     }}
                     title="下载"
                   >
                     {/* 👑 SVG 优化：开启几何渲染，子节点添加 vectorEffect */}
                     <svg width={fontSize} height={fontSize} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{ shapeRendering: 'geometricPrecision' }}>
                       <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" vectorEffect="non-scaling-stroke" />
                     </svg>
                     <span style={{ 
                       marginLeft: '10px', 
                       color: 'white', 
                       fontSize: `${fontSize}px`, 
                       fontWeight: '500',
                       WebkitFontSmoothing: 'antialiased',
                       textRendering: 'geometricPrecision'
                     }}>下载</span>
                   </button>
                 )}
                 {/* #414 展开/收起按钮 - #421 修复：总任务数 > 1 时就显示（含生成中状态） */}
                 {(localCount > 1 || (el as any).imageUrls?.length > 1) && (
                   <button
                     onClick={(e) => { 
                       e.stopPropagation(); 
                       setIsStackExpanded(!isStackExpanded);
                     }}
                     style={{
                       height: `${btnHeight}px`,
                       padding: `0 ${btnPadding}px`,
                       borderRadius: `${btnHeight * 0.1}px`,
                       background: 'rgba(0,0,0,0.56)',
                       border: 'none',
                       cursor: 'pointer',
                       display: 'flex',
                       alignItems: 'center',
                       gap: `${gap}px`,
                       color: 'white',
                       fontSize: `${fontSize}px`,
                       fontWeight: '500',
                       WebkitFontSmoothing: 'antialiased',
                       textRendering: 'geometricPrecision',
                     }}
                     title={isStackExpanded ? "收起" : "展开画廊"}
                   >
                     {/* 👑 SVG 优化：开启几何渲染，子节点添加 vectorEffect */}
                     <svg width={fontSize} height={fontSize} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{ shapeRendering: 'geometricPrecision' }}>
                       {isStackExpanded ? (
                         <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" vectorEffect="non-scaling-stroke" />
                       ) : (
                         <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" vectorEffect="non-scaling-stroke" />
                       )}
                     </svg>
                     <span style={{
                       WebkitFontSmoothing: 'antialiased',
                       textRendering: 'geometricPrecision'
                     }}>
                       {/* #421 修复：始终显示张数（如 2张），与完成状态样式一致 */}
                       {`${(el as any).imageUrls?.length || 0}张`}
                     </span>
                   </button>
                 )}
               </div>
               );
             })()}
           </div>
         ) : isLocalGenerating ? (
           // #面板生图过程：玫瑰曲线动画 + 右上角进度显示
           // 尺寸逻辑：与画布占位符一致（最小边基准）
           // 日夜都用白色动画，保持原有 shimmer 闪烁动画
           (() => {
             const minDim = Math.min(el.width, el.height);
             const iconSize = Math.max(20, minDim * 0.12);
             const fontSize = Math.max(10, minDim * 0.04);
             
             // 右上角按钮尺寸（与首图出现时一致）
             const btnHeight = Math.round(minDim * 0.108);
             const btnPadding = btnHeight * 0.15;
             const topOffset = btnHeight * 0.2;
             
             return (
               <>
                 {/* 玫瑰曲线动画（日夜都用白色） */}
                 <div style={{ 
                   position: 'absolute', 
                   inset: 0, 
                   display: 'flex', 
                   alignItems: 'center', 
                   justifyContent: 'center',
                   zIndex: 8,  // 在 shimmer(5) 之上，文字(10) 之下
                 }}>
                   {/* #886 传递 externalProgress 使线性进度条显示真实进度（视频面板） */}
                   <CanvasRoseCurve color="#ffffff" showDetail={true} gradientBg={false} externalProgress={el.panelType === 'video' ? localProgress : undefined} />
                 </div>
                 
                 {/* 右上角进度显示（与首图出现时一致） */}
                 <span style={{
                   position: 'absolute',
                   top: `${topOffset}px`,
                   right: `${topOffset}px`,
                   padding: `${btnHeight * 0.1}px ${btnPadding}px`,
                   borderRadius: `${btnHeight * 0.1}px`,
                   background: 'rgba(0,0,0,0.56)',
                   color: 'white',
                   fontSize: `${Math.round(fontSize * 1.25)}px`,
                   fontWeight: '500',
                   zIndex: 10,
                   WebkitFontSmoothing: 'antialiased',
                   textRendering: 'geometricPrecision',
                 }}>
                   {`正在生成第${((el as any).imageUrls?.length || 0) + 1}/${localCount}张`}
                 </span>
               </>
             );
           })()
         ) : el.panelType === 'text' && isLlmGenerating && !llmResponse ? (
           // #624 修复：文本面板生成中也使用玫瑰曲线动画（与图片/视频面板一致）
           (() => {
             const minDim = Math.min(el.width, el.height);
             const fontSize = Math.max(10, minDim * 0.04);
             const btnHeight = Math.round(minDim * 0.108);
             const btnPadding = btnHeight * 0.15;
             const topOffset = btnHeight * 0.2;
             
             return (
               <>
                 {/* 玫瑰曲线动画 */}
                 <div style={{ 
                   position: 'absolute', 
                   inset: 0, 
                   display: 'flex', 
                   alignItems: 'center', 
                   justifyContent: 'center',
                   zIndex: 8,
                 }}>
                   {/* #624 文本面板玫瑰曲线动画 */}
                   <CanvasRoseCurve color="#ffffff" showDetail={true} gradientBg={false} />
                 </div>
                 
                 {/* 右上角"生成中"标签 */}
                 <span style={{
                   position: 'absolute',
                   top: `${topOffset}px`,
                   right: `${topOffset}px`,
                   padding: `${btnHeight * 0.1}px ${btnPadding}px`,
                   borderRadius: `${btnHeight * 0.1}px`,
                   background: 'rgba(0,0,0,0.56)',
                   color: 'white',
                   fontSize: `${Math.round(fontSize * 1.25)}px`,
                   fontWeight: '500',
                   zIndex: 10,
                   WebkitFontSmoothing: 'antialiased',
                   textRendering: 'geometricPrecision',
                 }}>
                   生成中...
                 </span>
               </>
             );
           })()
         ) : el.panelType === 'text' && isLlmGenerating && llmResponse ? (
           // 文本面板流式生成中（有响应文本，显示文本+闪烁光标）
           <div
             style={{
               width: '100%',
               height: '100%',
               padding: `${el.width * 0.03}px`,
               background: 'rgba(39, 39, 42, 0.8)',
               borderRadius: panelBorderRadius,
               display: 'flex',
               flexDirection: 'column',
               alignItems: 'flex-start',
               justifyContent: 'flex-start',
               overflow: 'auto',
               fontSize: '200%',
               color: '#e4e4e7',
               lineHeight: '1.6',
               whiteSpace: 'pre-wrap',
               wordBreak: 'break-word',
             }}
           >
             {llmResponse}<span style={{ 
               display: 'inline-block',
               width: '2px',
               height: '1em',
               background: '#a1a1aa',
               marginLeft: '2px',
               animation: 'blink 1s step-end infinite'
             }}/>
           </div>
         ) : (
           // #321.4 修复模糊：使用 CSS 百分比而非 transform scale
           // #352 文本面板使用文档图标，图片面板使用图片图标
           // #358 文本面板响应内容显示在主面板，可编辑
           // #360 双击启用编辑，非编辑模式只读
           el.panelType === 'text' && llmResponse ? (
             <>
               {/* 军师方案：组件级注入滚动条样式，绕过 Tailwind PostCSS */}
               <style dangerouslySetInnerHTML={{ __html: `.force-scroll-${el.id}::-webkit-scrollbar{width:24px!important;height:24px!important;}.force-scroll-${el.id}::-webkit-scrollbar-track{background:rgba(255,255,255,0.1)!important;border-radius:12px!important;}.force-scroll-${el.id}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.5)!important;border-radius:12px!important;}.force-scroll-${el.id}::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.7)!important;}` }} />
               {isEditing ? (
                 // 编辑模式：可编辑的 textarea
                 // #363 编辑模式下滚轮滚动文本而非缩放画布
                 <textarea
                 ref={textAreaRef}
                 value={llmResponse}
                 onChange={(e) => setLlmResponse(e.target.value)}
                 onBlur={() => setIsEditing(false)}
                 style={{
                   width: '100%',
                   height: '100%',
                   padding: `${el.width * 0.03}px`,
                   background: 'rgba(39, 39, 42, 0.8)',
                   borderRadius: panelBorderRadius,
                   border: 'none',
                   display: 'flex',
                   flexDirection: 'column',
                   alignItems: 'flex-start',
                   justifyContent: 'flex-start',
                   overflow: 'auto',
                   fontSize: '200%',
                   color: '#e4e4e7',
                   lineHeight: '1.6',
                   whiteSpace: 'pre-wrap',
                   wordBreak: 'break-word',
                   resize: 'none',
                   outline: 'none',
                   fontFamily: 'inherit',
                 }}
                 className={`force-scroll-${el.id}`}
                 placeholder="生成的文本将显示在这里..."
               />
             ) : (
               // 非编辑模式：只读文本，双击进入编辑模式
               // #363 非编辑模式下滚轮也滚动文本
               <div
                 onDoubleClick={(e) => {
                    let absoluteOffset = llmResponse.length; // 默认保底放在最后
                    
                    // 获取点击位置相对于当前屏幕的 DOM 范围
                    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
                    
                    if (range) {
                      // 创建一个克隆范围，用来做测量尺
                      const preCaretRange = range.cloneRange();
                      // 把尺子的起点放在当前 div 的最开头
                      preCaretRange.selectNodeContents(e.currentTarget);
                      // 把尺子的终点放在鼠标点击的光标位置
                      preCaretRange.setEnd(range.startContainer, range.startOffset);
                      
                      // 尺子量出来的纯文本长度，就是完美的绝对 Index！
                      absoluteOffset = preCaretRange.toString().length;
                    }

                    // 存下算好的偏移量，准备传给 textarea
                    dblClickOffsetRef.current = absoluteOffset;
                    setIsEditing(true);
                  }}
                 onWheel={(e) => {
                   e.stopPropagation();
                 }}
                 style={{
                   width: '100%',
                   height: '100%',
                   padding: `${el.width * 0.03}px`,
                   background: 'rgba(39, 39, 42, 0.8)',
                   borderRadius: panelBorderRadius,
                   display: 'flex',
                   flexDirection: 'column',
                   alignItems: 'flex-start',
                   justifyContent: 'flex-start',
                   overflow: 'auto',
                   fontSize: '200%',
                   color: '#e4e4e7',
                   lineHeight: '1.6',
                   whiteSpace: 'pre-wrap',
                   wordBreak: 'break-word',
                   cursor: 'text',
                   userSelect: 'text',
                 }}
                 className={`force-scroll-${el.id}`}
               >
                 {llmResponse}
               </div>
             )}
             </>
           ) : (
           // # 面积基准：横向和竖向面板视觉效果一致
           (() => {
             const areaBasedSize = Math.sqrt(el.width * el.height);
             return (
             <div style={{ 
               display: 'flex', 
               flexDirection: 'column', 
               alignItems: 'center', 
               justifyContent: 'center',
               gap: `${areaBasedSize * 0.015}px`
             }}>
             {/* 居中的深色 Icon 盒子 - 宽度基于面板面积 */}
             <div style={{ 
               width: `${areaBasedSize * 0.20}px`,
               height: `${areaBasedSize * 0.20}px`,
               padding: `${areaBasedSize * 0.033}px`, 
               background: '#27272a', 
               borderRadius: `${areaBasedSize * 0.033}px`, 
               display: 'flex', 
               alignItems: 'center', 
               justifyContent: 'center' 
             }}>
               {el.panelType === 'text' ? (
                 // 文本面板：文档图标
                 <svg 
                   width="100%" 
                   height="100%" 
                   viewBox="0 0 24 24" 
                   fill="none" 
                   stroke="#fff" 
                   strokeWidth="1.5"
                   style={{ shapeRendering: 'geometricPrecision' }}
                 >
                   <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" vectorEffect="non-scaling-stroke"/>
                   <polyline points="14 2 14 8 20 8" vectorEffect="non-scaling-stroke"/>
                   <line x1="16" y1="13" x2="8" y2="13" vectorEffect="non-scaling-stroke"/>
                   <line x1="16" y1="17" x2="8" y2="17" vectorEffect="non-scaling-stroke"/>
                 </svg>
               ) : el.panelType === 'video' ? (
                 // 视频面板：视频图标
                 <svg 
                   width="100%" 
                   height="100%" 
                   viewBox="0 0 24 24" 
                   fill="none" 
                   stroke="#fff" 
                   strokeWidth="1.5"
                   style={{ shapeRendering: 'geometricPrecision' }}
                 >
                   <polygon points="23 7 16 12 23 17 23 7" vectorEffect="non-scaling-stroke"/>
                   <rect x="1" y="5" width="15" height="14" rx="2" ry="2" vectorEffect="non-scaling-stroke"/>
                 </svg>
               ) : (
                 // 图片面板：图片图标
                 <svg 
                   width="100%" 
                   height="100%" 
                   viewBox="0 0 24 24" 
                   fill="none" 
                   stroke="#fff" 
                   strokeWidth="1.5"
                   style={{ shapeRendering: 'geometricPrecision' }}
                 >
                   <rect x="3" y="3" width="18" height="18" rx="2" ry="2" vectorEffect="non-scaling-stroke"/>
                   <circle cx="8.5" cy="8.5" r="1.5" vectorEffect="non-scaling-stroke"/>
                   <polyline points="21 15 16 10 5 21" vectorEffect="non-scaling-stroke"/>
                 </svg>
               )}
             </div>
             <span style={{ 
               color: '#a1a1aa', 
               fontSize: `${areaBasedSize * 0.047}px`,
               fontWeight: '500',
               WebkitFontSmoothing: 'antialiased',
               textRendering: 'geometricPrecision'
             }}>
               {el.panelType === 'text' 
                 ? (isInputActive ? '配置中...' : '点击设置') 
                 : el.panelType === 'video'
                   ? (isInputActive ? '配置中...' : sourceImageEls.length > 0 ? (sourceImageEls.some(e => e.isVideo) ? `${sourceImageEls.filter(e => e.isVideo).length} 个参考视频` + (sourceImageEls.some(e => !e.isVideo) ? ` + ${sourceImageEls.filter(e => !e.isVideo).length} 张参考图` : '') : `${sourceImageEls.length} 张参考图`) : '点击设置')
                   : (isInputActive ? '配置中...' : sourceImageEls.length > 0 ? `${sourceImageEls.length} 张参考图` : '点击设置')}
             </span>
           </div>
             );
           })()
         )
       )}
      </div>

      {/* ====== 四、下方框：悬浮控制台（反向缩放特效） ====== */}
      {isInputActive && (
        <div
          data-panel-popup="true"  // #335 标记为面板弹窗，避免 Delete 键误删除
          style={{
            position: 'absolute',
            top: `calc(100% + ${8 / (zoom || 1)}px)`, 
            left: '50%',
            transform: `translateX(-50%) scale(${1 / (zoom || 1)})`, 
            transformOrigin: 'top center',
            width: '605px',  // #663 副面板宽度降低10%（672→605） 
            background: '#27272a', 
            borderRadius: '16px',
            border: '1px solid #27272a',
            boxShadow: '0 6px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
            padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px',
            cursor: 'default',
            overflow: 'visible',
            zIndex: 30,  // 👑 高于选中框的 zIndex: 20
            // #模糊修复 终极手术：删除 GPU 辐射源
            // willChange 和 backfaceVisibility 已删除，避免混合合成陷阱
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()} 
          onMouseDown={(e) => e.stopPropagation()}
          onWheelCapture={(e) => e.stopPropagation()}
        >
          {/* 多图参考图展示区（Grid 布局） */}
          <div 
            className="reference-image-container" 
            style={{ 
              width: '100%', 
              minHeight: '60px',
              maxHeight: '180px',
              backgroundColor: 'transparent', 
              borderRadius: '0', 
              border: 'none', 
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: sourceImageEls.length > 0 ? 'flex-start' : 'center',
              justifyContent: sourceImageEls.length > 0 ? 'flex-start' : 'center',
              overflow: 'auto',
              gap: '8px',
              padding: sourceImageEls.length > 0 ? '4px 0' : '8px 0'
            }}
          >
            {sourceImageEls.length > 0 ? (
              sourceImageEls.map((img, idx) => {
                // #318 计算拖拽位移
                let transform = 'scale(1)';
                let transition = 'transform 0.15s ease';
                
                if (dragIndex !== null && dragOverIndex !== null && dragIndex !== idx) {
                  // 正在拖拽其他元素
                  if (dragOverIndex === idx) {
                    // 当前元素是悬停目标，向拖拽来源方向位移
                    const offset = dragIndex < idx ? -8 : 8; // 向左或向右位移
                    transform = `translateX(${offset}px) scale(1.02)`;
                  } else if (
                    (dragIndex < idx && dragOverIndex > idx) ||
                    (dragIndex > idx && dragOverIndex < idx)
                  ) {
                    // 在拖拽来源和目标之间的元素，反向位移
                    const offset = dragIndex < idx ? 8 : -8;
                    transform = `translateX(${offset}px)`;
                  }
                }
                
                // 被拖拽的元素自身半透明
                if (dragIndex === idx) {
                  transform = 'scale(0.9)';
                  transition = 'transform 0.1s ease, opacity 0.1s ease';
                }
                
                return (
                  <div 
                    key={img.id}
                    data-ref-thumb-idx={idx}
                    style={{ 
                      width: '51px',
                      height: '51px',
                      position: 'relative',
                      borderRadius: '5px',
                      overflow: 'hidden',
                      border: dragOverIndex === idx ? '2px solid #60a5fa' : 'none',
                      flexShrink: 0,
                      cursor: 'grab',
                      transform,
                      transition,
                      opacity: dragIndex === idx ? 0.5 : (() => {
                        // #664 修复：生图模型使用 getModelMaxLimits，视频模型使用 getMaterialTypeLimits
                        const limits = isModeSwitchVideoModel
                          ? getMaterialTypeLimits(hhCurrentMode, localModel)
                          : getModelMaxLimits(localModel);
                        if (img.isVideo) {
                          // 视频元素：计算在视频列表中的索引
                          const videoIdx = sourceImageEls.slice(0, idx).filter(el => el.isVideo).length;
                          return videoIdx < limits.video ? 1 : 0.35;
                        }
                        // 图片元素：计算在图片列表中的索引（排除视频）
                        const imageIdx = sourceImageEls.slice(0, idx).filter(el => !el.isVideo).length;
                        return imageIdx < limits.image ? 1 : 0.35;
                      })(),
                    }}
                    title={(() => {
                      // #664 修复：生图模型使用 getModelMaxLimits，视频模型使用 getMaterialTypeLimits
                      const limits = isModeSwitchVideoModel
                        ? getMaterialTypeLimits(hhCurrentMode, localModel)
                        : getModelMaxLimits(localModel);
                      if (img.isVideo) {
                        const videoIdx = sourceImageEls.slice(0, idx).filter(el => el.isVideo).length;
                        if (videoIdx >= limits.video) return `当前模式最多支持${limits.video}段视频，此视频将被忽略`;
                        return undefined;
                      }
                      // 图片
                      const imageIdx = sourceImageEls.slice(0, idx).filter(el => !el.isVideo).length;
                      if (imageIdx >= limits.image) return `该模型最多支持${limits.image}张参考图，此图片将被忽略`;
                      return undefined;
                    })()}
                    draggable
                    onDragStart={(e) => {
                      // #318 关键修复：设置自定义拖拽图像，确保样式正确显示
                      // #623 视频缩略图查找 video 元素
                      const dragImage = e.currentTarget.querySelector('img') as HTMLElement || e.currentTarget.querySelector('video') as HTMLElement;
                      if (dragImage) {
                        const rect = dragImage.getBoundingClientRect();
                        e.dataTransfer.setDragImage(dragImage, rect.width / 2, rect.height / 2);
                      }
                      e.dataTransfer.setData('text/plain', idx.toString());
                      requestAnimationFrame(() => {
                        setDragIndex(idx);
                      });
                      e.stopPropagation();
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      // #646 修复抖动：使用 e.currentTarget 判断避免频繁 setState
                      if (dragOverIndex !== idx) {
                        setDragOverIndex(idx);
                      }
                      e.stopPropagation();
                    }}
                    onDragLeave={(e) => {
                      // #646 修复抖动：只有离开当前元素时才清除，防止子元素触发
                      const relatedTarget = e.relatedTarget as HTMLElement;
                      if (relatedTarget && e.currentTarget.contains(relatedTarget)) {
                        return; // 仍在当前元素内，不清除
                      }
                      if (dragOverIndex === idx) {
                        setDragOverIndex(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const dragIdx = parseInt(e.dataTransfer.getData('text/plain'));
                      if (dragIdx !== idx && onReorderSourceImages) {
                        onReorderSourceImages(el.id, dragIdx, idx);
                      }
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    onMouseEnter={(e) => {
                      if (dragIndex === null) {
                        (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 2px #60a5fa';
                        setHoveredRefImageIdx(idx);
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                      setHoveredRefImageIdx(null);
                    }}
                  >
                  {/* #623 视频缩略图 vs 图片缩略图 */}
                  {img.isVideo ? (
                    <video 
                      src={refreshedImageUrls[img.id] || img.videoUrl || img.imageUrl}
                      muted
                      playsInline
                      preload="metadata"
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        objectFit: 'contain',
                        transition: 'transform 0.2s',
                      }}
                      onError={() => {
                        // 视频加载失败，尝试代理URL
                        if (img.videoKey) {
                          // #842 移除 _t=${Date.now()}：缓存杀手打穿浏览器缓存
                          const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(img.videoKey)}`;
                          setRefreshedImageUrls(p => ({ ...p, [img.id]: proxyUrl }));
                        } else if (img.videoUrl) {
                          const proxyUrl = `/api/video/proxy?url=${encodeURIComponent(img.videoUrl)}`;
                          setRefreshedImageUrls(p => ({ ...p, [img.id]: proxyUrl }));
                        }
                      }}
                    />
                  ) : (
                    <img 
                      src={refreshedImageUrls[img.id] || img.imageUrl} 
                      alt={`参考图 ${idx + 1}`}
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        objectFit: 'contain',
                        transition: 'transform 0.2s',
                      }}
                      onError={() => {
                        // 图片加载失败，标记该图片需要刷新 URL
                        if (!img.imageKey) {
                          return;
                        }
                        failedImageIdsRef.current.add(img.id);
                        // #524 修复：使用代理 URL 替代签名 URL（浏览器直连 COS 超时）
                        // #842 移除 _t=${Date.now()}：缓存杀手打穿浏览器缓存
                        const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(img.imageKey)}`;
                        setRefreshedImageUrls(p => ({ ...p, [img.id]: proxyUrl }));
                      }}
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                  )}
                  {/* #623 视频播放图标叠加 */}
                  {img.isVideo && !img.isLoading && (
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
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="white">
                        <polygon points="0,0 10,6 0,12" />
                      </svg>
                    </div>
                  )}
                  {/* #853 上传中 Spinner 叠加 */}
                  {img.isLoading && (
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: 'rgba(0,0,0,0.45)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      pointerEvents: 'none',
                      borderRadius: '5px',
                    }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                        <path d="M12 2a10 10 0 0 1 10 10" />
                      </svg>
                    </div>
                  )}
                  {/* #647 使用 getMaterialTypeLimits 判断素材是否可用 */}
                  {/* #680 修复：生图面板应使用 getModelMaxLimits，与 opacity 逻辑一致 */}
                  {(() => {
                    // #664 修复：生图模型使用 getModelMaxLimits，视频模型使用 getMaterialTypeLimits
                    const limits = isModeSwitchVideoModel
                      ? getMaterialTypeLimits(hhCurrentMode, localModel)
                      : getModelMaxLimits(localModel);
                    // #658 按类型分别计算索引，与 title 逻辑一致
                    const isOverLimit = img.isVideo 
                      ? sourceImageEls.slice(0, idx).filter(el => el.isVideo).length >= limits.video
                      : sourceImageEls.slice(0, idx).filter(el => !el.isVideo).length >= limits.image;
                    // 视频检查：limits.video > 0 才可用
                    const isVideoDisabled = img.isVideo && limits.video === 0;
                    // 图片检查：limits.image > 0 才可用
                    const isImageDisabled = !img.isVideo && limits.image === 0;
                    
                    return (isOverLimit || isVideoDisabled || isImageDisabled) ? (
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'rgba(0,0,0,0.45)',
                        borderRadius: '4px',
                        pointerEvents: 'none',
                        zIndex: 2,
                      }} />
                    ) : null;
                  })()}
                  {/* #569 右上角排序数值 */}
                  {hoveredRefImageIdx !== idx && (
                    <div style={{
                      position: 'absolute',
                      top: '1px',
                      right: '1px',
                      width: '13px',
                      height: '13px',
                      borderRadius: '3px',
                      background: 'rgba(0,0,0,0.55)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      color: '#e4e4e7',
                      fontWeight: 600,
                      lineHeight: 1,
                      pointerEvents: 'none',
                    }}>{idx + 1}</div>
                  )}
                  {/* 悬浮时显示删除按钮（透明背景，X居中） */}
                  {hoveredRefImageIdx === idx && (
                    <button
                      style={{
                        position: 'absolute',
                        top: '1px',
                        right: '1px',
                        width: '13px',
                        height: '13px',
                        borderRadius: '3px',
                        background: 'rgba(0,0,0,0.45)',
                        border: 'none',
                        color: '#ffffff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        lineHeight: 1,
                        padding: 0,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveSourceImage(el.id, img.id);
                      }}
                    >✕</button>
                  )}
                  {/* 悬浮大图预览（完整图，尺寸缩小70%）/ #623 视频预览弹窗 - 使用Portal渲染到body避免被overflow裁剪 */}
                  {hoveredRefImageIdx === idx && (() => {
                    // 获取缩略图DOM元素的位置
                    const thumbEl = document.querySelector(`[data-ref-thumb-idx="${idx}"]`);
                    const rect = thumbEl?.getBoundingClientRect();
                    if (!rect) return null;
                    // #623 视频预览弹窗更大
                    const previewW = img.isVideo ? 200 : 128;
                    const previewH = img.isVideo ? 112 : 128; // 16:9 比例
                    // 预览图定位在缩略图正上方，水平居中
                    let previewLeft = rect.left + rect.width / 2 - previewW / 2;
                    let previewTop = rect.top - previewH - 8;
                    // 边界检查：如果上方放不下，则放在下方
                    if (previewTop < 0) {
                      previewTop = rect.bottom + 8;
                    }
                    // 边界检查：防止左右溢出
                    if (previewLeft < 8) previewLeft = 8;
                    if (previewLeft + previewW > window.innerWidth - 8) previewLeft = window.innerWidth - previewW - 8;
                    return createPortal(
                      <div style={{
                        position: 'fixed',
                        left: previewLeft,
                        top: previewTop,
                        width: `${previewW}px`,
                        height: `${previewH}px`,
                        borderRadius: '10px',
                        overflow: 'hidden',
                        border: `2px solid ${img.isVideo ? 'rgba(239, 68, 68, 0.6)' : 'rgba(96, 165, 250, 0.6)'}`,
                        boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
                        zIndex: 99999,
                        pointerEvents: img.isVideo ? 'auto' : 'none', // #623 视频预览允许交互（播放控制）
                        background: '#18181b',
                      }}>
                        {img.isVideo ? (
                          <video 
                            src={refreshedImageUrls[img.id] || img.videoUrl || img.imageUrl}
                            autoPlay
                            loop
                            muted
                            playsInline
                            controls
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                          />
                        ) : (
                          <img 
                            src={refreshedImageUrls[img.id] || img.imageUrl}
                            alt={`预览 ${idx + 1}`}
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            referrerPolicy="no-referrer-when-downgrade"
                          />
                        )}
                      </div>,
                      document.body
                    );
                  })()}
                </div>
                );
              })
            ) : (
              // #369 修复：无参考图时显示简洁提示，不显示面板 logo
              <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center',
                width: '100%', 
                minHeight: '60px',
                color: '#71717a',
                fontSize: '13px',
                textAlign: 'center',
              }}>
                <svg 
                  width="32" 
                  height="32" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="1.5"
                  style={{ marginBottom: '8px', opacity: 0.5 }}
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span>{el.panelType === 'video' ? '等待连接参考视频/图片...' : '等待连接参考图片...'}</span>
              </div>
            )}
          </div>

          {/* 提示词输入 - 无边框样式 + #320 右键菜单 + #351 参考收藏按钮 */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
            <textarea 
              ref={promptRef}
              id={`panel-prompt-${el.id}`}
              placeholder={el.panelType === 'text' 
                ? "在此输入提示词、问题或长文本..." 
                : el.panelType === 'video'
                  ? "输入提示词描述你想要的视频..."
                  : "输入提示词描述你的灵感..."} 
              style={{ 
                flex: 1,
                minHeight: '98px',  // #663 副面板放大，提示词区域提高50%
                maxHeight: '216px',
                height: '98px',
                background: 'transparent',
                border: 'none', 
                borderRadius: '0', 
                padding: '4px 0 2px 0', 
                color: '#f4f4f5', 
                fontSize: '13px', 
                resize: 'none', 
                outline: 'none',
                margin: '0',
                lineHeight: '1.4',
                overflowY: 'auto',
              }}
              value={localPrompt}
              onChange={(e) => {
                setLocalPrompt(e.target.value);
                // 自动调整高度
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 216) + 'px';
              }}
              onBlur={() => {
                // #321.1 失去焦点时同步到全局状态（避免每次输入触发全局重渲染）
                if (localPrompt !== (el.panelPrompt || '')) {
                  updateElementData({ panelPrompt: localPrompt });
                }
              }}
              // 不拦截右键菜单，让浏览器原生右键菜单（全选、复制等）正常显示
            />

            {/* #351 收藏按钮 - 图片/视频面板显示"收藏"，文本面板显示"参考收藏" */}
            <button
              onClick={() => setShowFavoritesPopup(!showFavoritesPopup)}
              style={{
                flexShrink: 0,
                padding: '6px 10px',
                background: showFavoritesPopup ? '#27272a' : '#27272a',
                border: '1px solid #27272a',
                borderRadius: '6px',
                color: '#a1a1aa',
                fontSize: '13px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {el.panelType === 'text' ? '参考收藏' : '收藏'}
            </button>
          </div>

          {/* #351 收藏弹窗 - 居中在面板内部 */}
          {/* #663 副面板放大20% */}
          {showFavoritesPopup && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '320px',
                maxHeight: '50vh',
                background: '#27272a',
                border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
                borderRadius: '12px',
                boxShadow: '0 5px 12px rgba(0, 0, 0, 0.3)',
                zIndex: 30,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* 弹窗头部 */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px',
                borderBottom: '1px solid #27272a',
              }}>
                <span style={{ color: '#f4f4f5', fontSize: '18px', fontWeight: 500 }}>
                  提示词收藏
                </span>
                <button
                  onClick={() => setShowFavoritesPopup(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#71717a',
                    cursor: 'pointer',
                    padding: '4px',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              
              {/* 添加新收藏 */}
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #27272a' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="添加新收藏..."
                    value={newFavoriteContent}
                    onChange={(e) => setNewFavoriteContent(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: '#27272a',
                      border: '1px solid #27272a',
                      borderRadius: '6px',
                      color: '#f4f4f5',
                      fontSize: '12px',
                      outline: 'none',
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newFavoriteContent.trim()) {
                        handleAddFavorite(newFavoriteContent.trim());
                        setNewFavoriteContent('');
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (newFavoriteContent.trim()) {
                        handleAddFavorite(newFavoriteContent.trim());
                        setNewFavoriteContent('');
                      }
                    }}
                    style={{
                      padding: '8px 12px',
                      background: '#6366f1',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    添加
                  </button>
                </div>
              </div>
              
              {/* 收藏列表 */}
              <div style={{ 
                flex: 1, 
                overflowY: 'auto', 
                padding: '8px 0',
              }}>
                {favorites && favorites.length > 0 ? (
                  favorites.map((fav) => (
                    <div
                      key={fav.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        padding: '10px 16px',
                        gap: '8px',
                        borderBottom: '1px solid #27272a',
                      }}
                    >
                      {editingFavoriteId === fav.id ? (
                        /* 编辑模式 */
                        <>
                          <input
                            ref={editingFavoriteInputRef}
                            type="text"
                            value={editingFavoriteContent}
                            onChange={(e) => setEditingFavoriteContent(e.target.value)}
                            style={{
                              flex: 1,
                              padding: '6px 8px',
                              background: '#27272a',
                              border: '1px solid #6366f1',
                              borderRadius: '4px',
                              color: '#f4f4f5',
                              fontSize: '12px',
                              outline: 'none',
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleUpdateFavorite(fav.id, editingFavoriteContent);
                                setEditingFavoriteId(null);
                              } else if (e.key === 'Escape') {
                                setEditingFavoriteId(null);
                              }
                            }}
                          />
                          <button
                            onClick={() => {
                              handleUpdateFavorite(fav.id, editingFavoriteContent);
                              setEditingFavoriteId(null);
                            }}
                            style={{
                              padding: '4px 8px',
                              background: '#22c55e',
                              border: 'none',
                              borderRadius: '4px',
                              color: '#fff',
                              fontSize: '13px',
                              cursor: 'pointer',
                            }}
                          >
                            保存
                          </button>
                          <button
                            onClick={() => setEditingFavoriteId(null)}
                            style={{
                              padding: '4px 8px',
                              background: '#27272a',
                              border: 'none',
                              borderRadius: '4px',
                              color: '#a1a1aa',
                              fontSize: '13px',
                              cursor: 'pointer',
                            }}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        /* 正常模式 */
                        <>
                          <span style={{
                            flex: 1,
                            color: '#d4d4d8',
                            fontSize: '12px',
                            lineHeight: '1.4',
                            wordBreak: 'break-word',
                          }}>
                            {fav.content}
                          </span>
                          <button
                            onClick={() => {
                              // 插入到输入框
                              const newPrompt = localPrompt ? localPrompt + '\n' + fav.content : fav.content;
                              setLocalPrompt(newPrompt);
                              updateElementData({ panelPrompt: newPrompt });
                              setShowFavoritesPopup(false);
                            }}
                            style={{
                              padding: '4px 8px',
                              background: '#27272a',
                              border: 'none',
                              borderRadius: '4px',
                              color: '#a1a1aa',
                              fontSize: '13px',
                              cursor: 'pointer',
                            }}
                          >
                            使用
                          </button>
                          <button
                            onClick={() => {
                              setEditingFavoriteId(fav.id);
                              setEditingFavoriteContent(fav.content);
                            }}
                            style={{
                              padding: '4px 6px',
                              background: 'transparent',
                              border: 'none',
                              color: '#71717a',
                              cursor: 'pointer',
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteFavorite(fav.id)}
                            style={{
                              padding: '4px 6px',
                              background: 'transparent',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  ))
                ) : (
                  <div style={{
                    padding: '40px 16px',
                    textAlign: 'center',
                    color: '#71717a',
                    fontSize: '12px',
                  }}>
                    暂无收藏，添加一条吧
                  </div>
                )}
              </div>
            </div>
          )}

          {/* #320 右键菜单 - 使用 Portal 渲染到 body 避免 transform 影响 */}
          {contextMenu && createPortal(
            <div
              style={{
                position: 'fixed',
                left: contextMenu.x,
                top: contextMenu.y,
                background: '#27272a',
                border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
                borderRadius: '8px',
                boxShadow: '0 5px 12px rgba(0, 0, 0, 0.25)',
                zIndex: 10000,
                padding: '4px',
                minWidth: '120px',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#f4f4f5',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
                onClick={() => {
                  promptRef.current?.select();
                  setContextMenu(null);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                </svg>
                全选
              </button>
              <button
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#f4f4f5',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    const textarea = promptRef.current;
                    if (textarea && text) {
                      const start = textarea.selectionStart;
                      const end = textarea.selectionEnd;
                      // #321.1 修复：使用 localPrompt 而不是 el.panelPrompt
                      const newValue = localPrompt.substring(0, start) + text + localPrompt.substring(end);
                      setLocalPrompt(newValue);
                      setTimeout(() => {
                        textarea.selectionStart = textarea.selectionEnd = start + text.length;
                      }, 0);
                    }
                  } catch (err) {
                    console.error('粘贴失败:', err);
                  }
                  setContextMenu(null);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                </svg>
                粘贴
              </button>
              <button
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#f4f4f5',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
                onClick={() => {
                  const textarea = promptRef.current;
                  if (textarea) {
                    const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
                    if (selectedText) {
                      navigator.clipboard.writeText(selectedText);
                    }
                  }
                  setContextMenu(null);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                复制
              </button>
            </div>,
            document.body
          )}

          {/* 底部参数与生成按钮 - #319 合并为一行 */}
          <div style={{ paddingTop: '4px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', overflow: 'visible' }}>
            {/* 模型选择按钮 */}
            <div style={{ position: 'relative' }}>
              <button 
                ref={modelButtonRef}
                style={{
                  padding: '4px 6px',
                  fontSize: '13px',
                  background: '#27272a',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#f4f4f5',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                }}
                data-picker-button="true"
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = '#3f3f46';
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(156, 163, 175, 0.3)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = '#27272a';
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  const newPos = calculatePickerPosition(modelButtonRef);
                  setPickerPositions(prev => ({ ...prev, model: newPos }));
                  setLocalModelPicker(!localModelPicker);
                  setLocalRatioPicker(false);
                  setLocalResolutionPicker(false);
                  setLocalCountPicker(false);
                  setLocalQualityPicker(false);  // #523 关闭品质弹窗
                  // 关闭视频面板弹窗
                  setLocalVideoDurationPicker(false);
                  setLocalVideoAspectRatioPicker(false);
                  setLocalVideoSizePicker(false);
                }}
              >
                {/* #569 已选模型显示 logo */}
                <img src={getModelLogo(localModel)} alt="" style={{ width: '14px', height: '14px', borderRadius: '2px', flexShrink: 0, filter: isDarkLogo(localModel) ? 'brightness(0) invert(1)' : 'none' }} referrerPolicy="no-referrer-when-downgrade" />
                {/* #347 文本面板显示当前模型名称 */}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{el.panelType === 'text' 
                  ? (modelDisplayNames[localModel] || formatModelName(localModel) || 'Gemini 3.1 Pro')
                  : (modelDisplayNames[localModel] || formatModelName(localModel) || 'Lib')}</span>
                {/* 文本面板也显示展开符号 */}
                <span style={{ fontSize: '14px', opacity: 0.6 }}>
                  {localModelPicker ? '^' : '˅'}
                </span>
              </button>
              
	              {/* 模型选择弹窗 - #弹窗修复：使用 createPortal 渲染到 body */}
              {localModelPicker && pickerPositions.model && createPortal(
                <div 
                  style={{
                    position: 'fixed',
                    left: pickerPositions.model.left,
                    bottom: pickerPositions.model.bottom,
                    minWidth: '336px',
                    maxWidth: '600px',
                    width: 'max-content',
                    maxHeight: '60vh',
                    background: '#27272a',
                    border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
                    borderRadius: '8px',
                    boxShadow: '0 5px 12px rgba(0, 0, 0, 0.25)',
                    zIndex: 9999,
                    overflow: 'hidden',
                  }} 
                  data-picker-popup="true" 
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid #27272a' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#f4f4f5' }}>
                      选择模型
                    </span>
                  </div>
                  {/* 图片面板只显示图像模型，视频面板只显示视频模型 */}
                  {el.panelType === 'image' ? (
                    <div style={{ padding: '6px', maxHeight: '250px', overflowY: 'auto' }}>
                      {imageModelOptions.map((modelId) => {
                      const config = modelConfig?.[modelId];
                      const isSelected = localModel === modelId;
                      const modelLogo = getModelLogo(modelId);
                      
                      if (!config) {
                        return (
                          <div 
                            key={modelId}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              background: 'transparent',
                              borderRadius: '6px',
                              color: '#71717a',
                              marginBottom: '2px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              opacity: 0.5,
                              fontSize: '13px'
                            }}
                          >
                            <img src={modelLogo} alt="" style={{ width: '20px', height: '20px', borderRadius: '4px', filter: isDarkLogo(modelId) ? 'brightness(0) invert(1)' : 'none' }} referrerPolicy="no-referrer-when-downgrade" />
                            <span style={{ whiteSpace: 'nowrap' }}>{modelId}</span>
                          </div>
                        );
                      }
                      
                      return (
                        <button
                          key={modelId}
                          onClick={() => {
                            // #485 模型切换时检查分辨率和比例是否在新模型配置中
                            const newConfig = modelConfig?.[modelId];
                            const updates: Partial<CanvasElement> = { panelModel: modelId };
                            
                            // 检查分辨率是否在新模型的配置中
                            if (newConfig?.resolutions) {
                              const availableResolutions = newConfig.resolutions.map((res: { size: string }) => res.size);
                              if (!availableResolutions.includes(localResolution)) {
                                updates.panelResolution = availableResolutions[0] || '1K';
                              }
                            }
                            
                            // 检查比例是否在新模型的配置中
                            if (newConfig?.aspectRatios) {
                              if (!newConfig.aspectRatios.includes(localRatio)) {
                                updates.panelRatio = newConfig.aspectRatios[0] || '1:1';
                              }
                            }
                            
                            updateElementData(updates);
                            setLocalModelPicker(false);
                            setLocalQualityPicker(false);  // #523 切换模型时关闭品质弹窗
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              (e.currentTarget as HTMLElement).style.background = 'rgba(156, 163, 175, 0.15)';
                              (e.currentTarget as HTMLElement).style.boxShadow = '0 0 10px rgba(156, 163, 175, 0.2)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              (e.currentTarget as HTMLElement).style.background = 'transparent';
                              (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                            }
                          }}
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            background: isSelected ? 'rgba(156, 163, 175, 0.2)' : 'transparent',
                            border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                            borderRadius: '6px',
                            color: '#f4f4f5',
                            cursor: 'pointer',
                            textAlign: 'left',
                            marginBottom: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '13px',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <img src={modelLogo} alt="" style={{ width: '20px', height: '20px', borderRadius: '4px', flexShrink: 0, imageRendering: 'crisp-edges', filter: isDarkLogo(modelId) ? 'brightness(0) invert(1)' : 'none' }} referrerPolicy="no-referrer-when-downgrade" />
                          <span style={{ whiteSpace: 'nowrap' }}>{modelDisplayNames[modelId] || formatModelName(modelId)}</span>
                          {/* #559 视频模型显示分辨率规格 */}
                          {(() => {
                            const resList = config?.resolutions || [];
                            const resLabel = resList.length > 0 
                              ? resList.map((r: any) => r.size || r.value || r.label).join('/')
                              : (config?.showResolution === false ? '720p' : null);
                            return resLabel ? (
                              <span style={{ fontSize: '11px', padding: '1px 4px', background: 'rgba(59, 130, 246, 0.2)', borderRadius: '3px', color: '#93c5fd' }}>
                                {resLabel}
                              </span>
                            ) : null;
                          })()}
                          {isSelected && (
                            <svg style={{ marginLeft: 'auto' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  ) : el.panelType === 'video' ? (
                    <div style={{ padding: '6px', maxHeight: '250px', overflowY: 'auto' }}>
                      {videoModelOptions.map((modelId) => {
                      const config = modelConfig?.[modelId];
                      const isSelected = localModel === modelId;
                      const modelLogo = getModelLogo(modelId);
                      // #668 修复：所有支持视频参考的模型家族（HH/Seedance2/T8）都不应被拦截
                      const modelFamily = ModelDetector.getFamily(modelId);
                      const modelSupportsVideo = ['happyhorse', 'seedance2', 't8seedance'].includes(modelFamily);
                      const videoUnavailable = !!connectedVideoUrl && !modelSupportsVideo;
                      
                      if (!config) {
                        return (
                          <div 
                            key={modelId}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              background: 'transparent',
                              borderRadius: '6px',
                              color: '#71717a',
                              marginBottom: '2px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              opacity: 0.5,
                              fontSize: '13px'
                            }}
                          >
                            <img src={modelLogo} alt="" style={{ width: '20px', height: '20px', borderRadius: '4px', filter: isDarkLogo(modelId) ? 'brightness(0) invert(1)' : 'none' }} referrerPolicy="no-referrer-when-downgrade" />
                            <span>{modelId}</span>
                          </div>
                        );
                      }
                      
                      return (
                        <button
                          key={modelId}
                          onClick={() => {
                            if (videoUnavailable) return; // #636 不支持视频参考的模型不可选
                            // #485 模型切换时检查分辨率和比例是否在新模型配置中
                            const newConfig = modelConfig?.[modelId];
                            const updates: Partial<CanvasElement> = { panelModel: modelId };
                            
                            // 检查分辨率是否在新模型的配置中
                            if (newConfig?.resolutions) {
                              const availableResolutions = newConfig.resolutions.map((res: { size: string }) => res.size);
                              if (!availableResolutions.includes(localResolution)) {
                                updates.panelResolution = availableResolutions[0] || '1K';
                              }
                            }
                            
                            // 检查比例是否在新模型的配置中
                            if (newConfig?.aspectRatios) {
                              if (!newConfig.aspectRatios.includes(localRatio)) {
                                updates.panelRatio = newConfig.aspectRatios[0] || '1:1';
                              }
                            }
                            
                            updateElementData(updates);
                            setLocalModelPicker(false);
                            setLocalQualityPicker(false);  // #523 切换模型时关闭品质弹窗
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected && !videoUnavailable) {
                              (e.currentTarget as HTMLElement).style.background = 'rgba(156, 163, 175, 0.15)';
                              (e.currentTarget as HTMLElement).style.boxShadow = '0 0 10px rgba(156, 163, 175, 0.2)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              (e.currentTarget as HTMLElement).style.background = videoUnavailable ? 'transparent' : 'transparent';
                              (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                            }
                          }}
                          title={videoUnavailable ? '该模型不支持视频参考输入' : undefined}
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            background: isSelected ? 'rgba(156, 163, 175, 0.2)' : 'transparent',
                            border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                            borderRadius: '6px',
                            color: videoUnavailable ? '#71717a' : '#f4f4f5',
                            cursor: videoUnavailable ? 'not-allowed' : 'pointer',
                            textAlign: 'left',
                            marginBottom: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '13px',
                            transition: 'all 0.15s ease',
                            opacity: videoUnavailable ? 0.4 : 1,
                          }}
                        >
                          <img src={modelLogo} alt="" style={{ width: '20px', height: '20px', borderRadius: '4px', flexShrink: 0, imageRendering: 'crisp-edges', filter: isDarkLogo(modelId) ? 'brightness(0) invert(1)' : 'none' }} referrerPolicy="no-referrer-when-downgrade" />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelDisplayNames[modelId] || formatModelName(modelId)}</span>
                          {videoUnavailable && (
                            <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#ef4444', opacity: 0.8 }}>不支持视频</span>
                          )}
                          {isSelected && !videoUnavailable && (
                            <svg style={{ marginLeft: 'auto' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  ) : el.panelType === 'text' ? (
                    // 文本面板显示 LLM 模型
                    <div style={{ padding: '6px', maxHeight: '250px', overflowY: 'auto' }}>
                      {llmModelOptions.map((modelId) => {
                      const isSelected = localModel === modelId;
                      const modelLogo = getModelLogo(modelId);
                      
                      return (
                        <button
                          key={modelId}
                          onClick={() => {
                            updateElementData({ panelModel: modelId });
                            setLocalModelPicker(false);
                            setLocalQualityPicker(false);  // #523 切换模型时关闭品质弹窗
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              (e.currentTarget as HTMLElement).style.background = 'rgba(156, 163, 175, 0.15)';
                              (e.currentTarget as HTMLElement).style.boxShadow = '0 0 10px rgba(156, 163, 175, 0.2)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              (e.currentTarget as HTMLElement).style.background = 'transparent';
                              (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                            }
                          }}
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            background: isSelected ? 'rgba(156, 163, 175, 0.2)' : 'transparent',
                            border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                            borderRadius: '6px',
                            color: '#f4f4f5',
                            cursor: 'pointer',
                            textAlign: 'left',
                            marginBottom: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '13px',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <img src={modelLogo} alt="" style={{ width: '20px', height: '20px', borderRadius: '4px', flexShrink: 0, imageRendering: 'crisp-edges', filter: isDarkLogo(modelId) ? 'brightness(0) invert(1)' : 'none' }} referrerPolicy="no-referrer-when-downgrade" />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelDisplayNames[modelId] || formatModelName(modelId)}</span>
                          {isSelected && (
                            <svg style={{ marginLeft: 'auto' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  ) : null}
                </div>,
                document.body
              )}
            </div>
            
            {/* #347 文本面板隐藏比例/分辨率/数量按钮 */}
            {/* #视频面板显示时长、比例、尺寸 */}
            {el.panelType !== 'text' && (
              <>
            {el.panelType === 'video' ? (
              <>
                {/* #635 视频时长选择按钮 - showDuration的模型显示；HappyHorse 仅非 video-edit 显示；#641 灵芽 Sora-2 VIP 强制显示；#690 TOPAIS 固定 8 秒显示 */}
                {(currentModelConfig?.showDuration || isLingyaSoraVip || isTopaisModel) && (!isHappyHorseModel || hhParams?.showDuration) && (
                <div style={{ position: 'relative' }}>
                  <button 
                    ref={videoDurationButtonRef}
                    style={{
                      padding: '4px 6px',
                      fontSize: '13px',
                      background: '#27272a',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#f4f4f5',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                    }}
                    data-picker-button="true"
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = '#3f3f46';
                      (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(156, 163, 175, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = '#27272a';
                      (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const newPos = calculatePickerPosition(videoDurationButtonRef);
                      setPickerPositions(prev => ({ ...prev, videoDuration: newPos }));
                      setLocalVideoDurationPicker(!localVideoDurationPicker);
                      setLocalVideoAspectRatioPicker(false);
                      setLocalVideoSizePicker(false);
                      setLocalModelPicker(false);
                      setLocalQualityPicker(false);  // #523 关闭品质弹窗
                    }}
                  >
                    <span>{localVideoDuration}s</span>
                    <span style={{ fontSize: '14px', opacity: 0.6 }}>
                      {localVideoDurationPicker ? '^' : '˅'}
                    </span>
                  </button>
                  
                  {/* 时长选择弹窗 - #540 从数据库配置动态读取 */}
                  {localVideoDurationPicker && pickerPositions.videoDuration && createPortal(
                    <div 
                      style={{
                        position: 'fixed',
                        left: pickerPositions.videoDuration.left,
                        bottom: pickerPositions.videoDuration.bottom,
                        width: '100px',
                        background: '#27272a',
                        border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
                        borderRadius: '8px',
                        boxShadow: '0 5px 12px rgba(0, 0, 0, 0.25)',
                        zIndex: 9999,
                        overflow: 'hidden',
                      }} 
                      data-picker-popup="true" 
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ padding: '8px 10px', borderBottom: '1px solid #27272a' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#f4f4f5' }}>时长</span>
                      </div>
                      <div style={{ padding: '6px' }}>
                        {(availableDurations || [5, 10]).map((duration: number) => {
                          const isSelected = localVideoDuration === duration;
                          return (
                            <button
                              key={duration}
                              onClick={() => {
                                startTransition(() => {
                                  updateElementData({ videoDuration: duration } as any);
                                });
                                setLocalVideoDurationPicker(false);
                              }}
                              onMouseEnter={(e) => {
                                if (!isSelected) {
                                  (e.currentTarget as HTMLElement).style.background = 'rgba(156, 163, 175, 0.15)';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!isSelected) {
                                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                                }
                              }}
                              style={{
                                width: '100%',
                                padding: '6px 10px',
                                background: isSelected ? 'rgba(156, 163, 175, 0.2)' : 'transparent',
                                border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                                borderRadius: '6px',
                                color: '#f4f4f5',
                                cursor: 'pointer',
                                marginBottom: '2px',
                                fontSize: '13px',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              {duration}s
                            </button>
                          );
                        })}
                      </div>
                    </div>,
                    document.body
                  )}
                </div>
                )}
                
                {/* #635 视频比例选择按钮 - HappyHorse 仅 t2v/r2v 显示；i2v/video-edit 隐藏 */}
                {(!isHappyHorseModel || hhParams?.showRatio) && (
                <div style={{ position: 'relative' }}>
                  <button 
                    ref={videoAspectRatioButtonRef}
                    style={{
                      padding: '4px 6px',
                      fontSize: '13px',
                      background: '#27272a',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#f4f4f5',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                    }}
                    data-picker-button="true"
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = '#3f3f46';
                      (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(156, 163, 175, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = '#27272a';
                      (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const newPos = calculatePickerPosition(videoAspectRatioButtonRef);
                      setPickerPositions(prev => ({ ...prev, videoAspectRatio: newPos }));
                      setLocalVideoAspectRatioPicker(!localVideoAspectRatioPicker);
                      setLocalVideoDurationPicker(false);
                      setLocalVideoSizePicker(false);
                      setLocalModelPicker(false);
                      setLocalQualityPicker(false);  // #523 关闭品质弹窗
                    }}
                  >
                    {localVideoAspectRatio !== 'auto' && localVideoAspectRatio !== 'adaptive' && renderRatioShape(localVideoAspectRatio, 12)}
                    <span>{formatRatioLabel(localVideoAspectRatio)}</span>
                    <span style={{ fontSize: '14px', opacity: 0.6 }}>
                      {localVideoAspectRatioPicker ? '^' : '˅'}
                    </span>
                  </button>
                  
                  {/* 视频比例选择弹窗 */}
                  {localVideoAspectRatioPicker && pickerPositions.videoAspectRatio && createPortal(
                    <div 
                      style={{
                        position: 'fixed',
                        left: pickerPositions.videoAspectRatio.left,
                        bottom: pickerPositions.videoAspectRatio.bottom,
                        width: '180px',
                        background: '#27272a',
                        border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
                        borderRadius: '8px',
                        boxShadow: '0 5px 12px rgba(0, 0, 0, 0.25)',
                        zIndex: 9999,
                        overflow: 'hidden',
                      }} 
                      data-picker-popup="true" 
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ padding: '8px 10px', borderBottom: '1px solid #27272a' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#f4f4f5' }}>视频比例</span>
                      </div>
                      <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {/* #540 比例从数据库配置动态读取；#865 MiniMax按模式禁用比例 */}
                        {(() => {
                          const allRatios = aspectRatioOptions.length > 0 ? aspectRatioOptions : ['16:9', '9:16', '1:1'];
                          // #865 MiniMax: 按模式计算每个比例的 disabled 状态
                          const ratioStates = isTopaisMinimaxModel
                            ? getTopaisMinimaxRatioStates(hhCurrentMode, allRatios)
                            : allRatios.map((r: string) => ({ ratio: r, disabled: false }));
                          return ratioStates.map(({ ratio, disabled }) => {
                          const isSelected = localVideoAspectRatio === ratio;
                          return (
                            <button
                              key={ratio}
                              onClick={() => {
                                if (disabled) return;  // #865 禁用的比例不可选
                                startTransition(() => {
                                  updateElementData({ videoAspectRatio: ratio } as any);
                                  // 更新面板物理尺寸（类似图片面板）
                                  const hasVideo = ((el as any).videoUrls as string[])?.length > 0;
                                  if (!hasVideo) {
                                    updatePanelSizeByRatio(ratio);
                                  }
                                });
                                setLocalVideoAspectRatioPicker(false);
                              }}
                              onMouseEnter={(e) => {
                                if (!isSelected && !disabled) {
                                  (e.currentTarget as HTMLElement).style.background = 'rgba(156, 163, 175, 0.15)';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!isSelected && !disabled) {
                                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                                }
                              }}
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                background: isSelected ? 'rgba(156, 163, 175, 0.2)' : 'transparent',
                                border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                                borderRadius: '6px',
                                color: disabled ? '#71717a' : '#f4f4f5',
                                cursor: disabled ? 'not-allowed' : 'pointer',
                                opacity: disabled ? 0.4 : 1,
                                fontSize: '13px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              {ratio !== 'auto' && ratio !== 'adaptive' && renderRatioShape(ratio, 14)}
                              <span>{formatRatioLabel(ratio)}</span>
                            </button>
                          );
                          });
                        })()}
                      </div>
                    </div>,
                    document.body
                  )}
                </div>
                )}
                
                {/* 视频分辨率选择按钮 - 仅showResolution的模型显示（Sora/Veo隐藏） */}
                {currentModelConfig?.showResolution && (
                <div style={{ position: 'relative' }}>
                  <button 
                    ref={videoSizeButtonRef}
                    style={{
                      padding: '4px 6px',
                      fontSize: '13px',
                      background: '#27272a',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#f4f4f5',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                    }}
                    data-picker-button="true"
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = '#3f3f46';
                      (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(156, 163, 175, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = '#27272a';
                      (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const newPos = calculatePickerPosition(videoSizeButtonRef);
                      setPickerPositions(prev => ({ ...prev, videoSize: newPos }));
                      setLocalVideoSizePicker(!localVideoSizePicker);
                      setLocalVideoDurationPicker(false);
                      setLocalVideoAspectRatioPicker(false);
                      setLocalModelPicker(false);
                      setLocalQualityPicker(false);
                    }}
                  >
                    <span>{formatVideoResolution(localVideoSize)}</span>
                    <span style={{ fontSize: '14px', opacity: 0.6 }}>
                      {localVideoSizePicker ? '^' : '˅'}
                    </span>
                  </button>
                  
                  {/* 分辨率选择弹窗 */}
                  {localVideoSizePicker && pickerPositions.videoSize && createPortal(
                    <div 
                      style={{
                        position: 'fixed',
                        left: pickerPositions.videoSize.left,
                        bottom: pickerPositions.videoSize.bottom,
                        width: '130px',
                        background: '#27272a',
                        border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
                        borderRadius: '8px',
                        boxShadow: '0 5px 12px rgba(0, 0, 0, 0.25)',
                        zIndex: 9999,
                        overflow: 'hidden',
                      }} 
                      data-picker-popup="true" 
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ padding: '8px 10px', borderBottom: '1px solid #27272a' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#f4f4f5' }}>分辨率</span>
                      </div>
                      <div style={{ padding: '6px' }}>
                        {/* #540 分辨率从数据库配置动态读取 */}
                        {(currentModelConfig?.resolutions || [{ size: '720p', credits: 80 }]).map((res: { size: string; credits: number }) => {
                          const isSelected = localVideoSize === res.size;
                          return (
                            <button
                              key={res.size}
                              onClick={() => {
                                startTransition(() => {
                                  updateElementData({ videoResolution: res.size, videoSize: res.size } as any);
                                });
                                setLocalVideoSizePicker(false);
                              }}
                              onMouseEnter={(e) => {
                                if (!isSelected) {
                                  (e.currentTarget as HTMLElement).style.background = 'rgba(156, 163, 175, 0.15)';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!isSelected) {
                                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                                }
                              }}
                              style={{
                                width: '100%',
                                padding: '6px 10px',
                                background: isSelected ? 'rgba(156, 163, 175, 0.2)' : 'transparent',
                                border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                                borderRadius: '6px',
                                color: '#f4f4f5',
                                cursor: 'pointer',
                                marginBottom: '2px',
                                fontSize: '13px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <span>{formatVideoResolution(res.size)}</span>                              <span style={{ fontSize: '10px', opacity: 0.5 }}>{res.credits}/s</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>,
                    document.body
                  )}
                </div>
                )}
                
                {/* 视频模型模式切换按钮 - HappyHorse/Seedance 2.0/T8 Seedance/TOPAIS Veo/TOPAIS HappyHorse/TOPAIS Seedance/MEGA AI Seedance/TOPAIS MiniMax-H3/TOPAIS Kling v3 Omni */}
                {(isHappyHorseModel || isSeedance2Model || isT8SeedanceModel || isTopaisModel || isTopaisHhModel || isTopaisSeedanceModel || isLingyaVeoModel || isLingyaSoraModel || isMegaAiSeedanceModel || isTopaisMinimaxModel || isTopaisKlingOmniModel) && (
                  <ModelModeSwitcher
                    modelType={isTopaisMinimaxModel ? 'topais-minimax' : isTopaisKlingOmniModel ? 'topais-kling-omni' : isMegaAiSeedanceModel ? 'mega-ai-seedance' : isTopaisModel ? 'topais' : isTopaisHhModel ? 'topais-happyhorse' : isTopaisSeedanceModel ? 'topais-seedance' : isTopaisGeminiOmniModel ? 'topais-gemini-omni' : isLingyaVeoModel ? 'lingya-veo' : isLingyaSoraModel ? 'lingya-sora' : isSeedance2Model ? 'seedance2' : isT8SeedanceModel ? 't8seedance' : 'happyhorse'}
                    inputImageUrls={connectedImageUrls}
                    inputVideoUrl={connectedVideoUrl}
                    overrideMode={hhOverrideMode}
                    setOverrideMode={(mode) => {
                      setHhOverrideMode(mode);
                      startTransition(() => {
                        const updates: Partial<CanvasElement> = { hhMode: mode } as any;
                        // #866 MiniMax: 模式切换时自动切换被禁用的比例
                        if (mode && isTopaisMinimaxModel && aspectRatioOptions.length > 0) {
                          const ratioStates = getTopaisMinimaxRatioStates(mode, aspectRatioOptions);
                          const currentRatioState = ratioStates.find(rs => rs.ratio === localVideoAspectRatio);
                          if (currentRatioState?.disabled) {
                            const firstEnabled = ratioStates.find(rs => !rs.disabled);
                            if (firstEnabled) {
                              console.log('[#866] Canvas panel 模式切换 ->', mode, '比例', localVideoAspectRatio, '->', firstEnabled.ratio);
                              (updates as any).videoAspectRatio = firstEnabled.ratio;
                            }
                          }
                        }
                        updateElementData(updates);
                      });
                    }}
                    onModeChange={() => {
                      // hhCurrentMode is derived from hhOverrideMode via useMemo, no setter needed
                    }}
                    audioSetting={hhAudioSetting}
                    onAudioSettingChange={(setting) => {
                      setHhAudioSetting(setting);
                      startTransition(() => {
                        updateElementData({ audioSetting: setting } as any);
                      });
                    }}
                    generateAudio={generateAudio}
                    onGenerateAudioChange={setGenerateAudio}
                    variant="canvas-panel"
                  />
                )}
                
                {/* #655 Seedance 音频上传按钮 - 模式支持才显示（t2v 不支持音频） */}
                {(isSeedance2Model || isT8SeedanceModel) && getMaterialTypeLimits(hhCurrentMode, localModel).audio > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 4px' }}>
                    {/* #647 参考音频上传 - 正方形按钮 */}
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                      {/* 已上传音频缩略图 */}
                      {refAudioFiles.map((audio, idx) => (
                        <div key={`panel-audio-${idx}`} style={{
                          width: '32px', height: '32px', borderRadius: '6px',
                          background: '#27272a', border: '1px solid #3f3f46',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          position: 'relative', overflow: 'hidden',
                          // #658 按索引判断opacity
                          opacity: (() => {
                            const limits = getMaterialTypeLimits(hhCurrentMode, localModel);
                            return idx < limits.audio ? 1 : 0.35;
                          })(),
                        }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2">
                            <path d="M9 18V5l12-2v13" />
                            <circle cx="6" cy="18" r="3" />
                            <circle cx="18" cy="16" r="3" />
                          </svg>
                          <span style={{ fontSize: '6px', color: '#71717a', maxWidth: '28px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{audio.name}</span>
                          <button
                            onClick={() => setRefAudioFiles(prev => prev.filter((_, i) => i !== idx))}
                            style={{
                              position: 'absolute', top: '-2px', right: '-2px',
                              width: '12px', height: '12px', borderRadius: '50%',
                              background: '#dc2626', color: '#fff', border: 'none',
                              fontSize: '7px', cursor: 'pointer', display: 'flex',
                              alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                            }}
                          >×</button>
                        </div>
                      ))}
                      {/* 音频上传按钮 - 正方形，模型支持就显示 */}
                      {refAudioFiles.length < 10 && (
                        <button
                          onClick={() => {
                            // #894 铁血封杀：未登录绝对不允许上传
                            if (!isLoggedIn) { setAuthModalOpen(true); return; }
                            panelAudioInputRef.current?.click();
                          }}
                          style={{
                            width: '32px', height: '32px', borderRadius: '6px',
                            border: '2px dashed #3f3f46', background: 'transparent',
                            cursor: 'pointer', display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: '1px',
                          }}
                          title="上传参考音频"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2">
                            <path d="M9 18V5l12-2v13" />
                            <circle cx="6" cy="18" r="3" />
                            <circle cx="18" cy="16" r="3" />
                          </svg>
                          <span style={{ fontSize: '7px', color: '#71717a' }}>音频</span>
                        </button>
                      )}
                      {/* 隐藏的音频文件输入 */}
                      <input
                        type="file"
                        accept="audio/wav,audio/mp3,audio/mpeg,.wav,.mp3"
                        multiple
                        ref={panelAudioInputRef}
                        onChange={(e) => {
                          // #894 铁血封杀：未登录绝对不允许上传，一丁点预览都不给
                          if (!isLoggedIn) {
                            setAuthModalOpen(true);
                            if (e?.target) e.target.value = '';
                            return;
                          }
                          const files = Array.from(e.target.files || []);
                          if (files.length === 0) return;
                          const currentLimits = getMaterialTypeLimits(hhCurrentMode, localModel);
                          if (refAudioFiles.length + files.length > currentLimits.audio) {
                            toast.error(`参考音频最多上传${currentLimits.audio}段`);
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
                                  setRefAudioFiles(prev => [...prev, { url: signedUrl, name: file.name, size: file.size }]);
                                  toast.success('音频上传成功');
                                } else {
                                  toast.error(`音频 ${file.name} 上传失败`);
                                }
                              })
                              .catch(() => toast.error('音频上传失败'));
                          });
                          e.target.value = '';
                        }}
                        style={{ display: 'none' }}
                      />
                    </div>
                    {/* #662 生成有声开关已移至模式弹窗底部 */}
                  </div>
                )}

              </>
            ) : (
              <>
                {/* 比例选择按钮 */}
                <div style={{ position: 'relative' }}>
                  <button 
                    ref={ratioButtonRef}
                    style={{
                      padding: '4px 6px',
                      fontSize: '13px',
                      background: '#27272a',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#f4f4f5',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                    data-picker-button="true"
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = '#3f3f46';
                      (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(156, 163, 175, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = '#27272a';
                      (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const newPos = calculatePickerPosition(ratioButtonRef);
                      setPickerPositions(prev => ({ ...prev, ratio: newPos }));
                      setLocalRatioPicker(!localRatioPicker);
                      setLocalModelPicker(false);
                      setLocalResolutionPicker(false);
                      setLocalCountPicker(false);
                      setLocalQualityPicker(false);  // #523 关闭品质弹窗
                    }}
                  >
                    {/* #358 显示比例形状 */}
                    {localRatio !== 'auto' && renderRatioShape(localRatio || '1:1', 12)}
                    {/* #328 显示当前比例，'auto' 显示为"自动" */}
                    <span>{localRatio === 'auto' ? '自动' : (localRatio || '1:1')}</span>
                    {/* #358 展开/收起符号 */}
                    <span style={{ fontSize: '14px', marginLeft: '2px', opacity: 0.6 }}>
                      {localRatioPicker ? '^' : '˅'}
                    </span>
                  </button>
              
              {/* 比例选择弹窗 - #弹窗修复：使用 createPortal 渲染到 body */}
              {localRatioPicker && pickerPositions.ratio && createPortal(
                <div 
                  style={{
                    position: 'fixed',
                    left: pickerPositions.ratio.left,
                    bottom: pickerPositions.ratio.bottom,
                    width: '220px',
                    maxHeight: '60vh',
                    background: '#27272a',
                    border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
                    borderRadius: '8px',
                    boxShadow: '0 5px 12px rgba(0, 0, 0, 0.25)',
                    zIndex: 9999,
                    overflow: 'hidden',
                  }} 
                  data-picker-popup="true" 
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid #27272a' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#f4f4f5' }}>选择比例</span>
                  </div>
                  <div style={{ padding: '8px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                    {/* #482 使用动态比例选项 */}
                    {aspectRatioOptions.map((ratio) => {
                      const isSelected = ratio === 'auto' ? localRatio === 'auto' : localRatio === ratio;
                      return (
                        <button
                          key={ratio}
                          onClick={() => {
                            // #413 永远更新生成参数
                            updateElementData({ panelRatio: ratio });
                            
                            // #413 只有没图时，才作为视觉引导改变物理大小
                            const hasImage = ((el as any).imageUrls as string[])?.length > 0;
                            if (!hasImage) {
                              updatePanelSizeByRatio(ratio);
                            }
                            setLocalRatioPicker(false);
                            setLocalQualityPicker(false);  // #523 选择比例时关闭品质弹窗
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              (e.currentTarget as HTMLElement).style.background = 'rgba(156, 163, 175, 0.15)';
                              (e.currentTarget as HTMLElement).style.boxShadow = '0 0 10px rgba(156, 163, 175, 0.2)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              (e.currentTarget as HTMLElement).style.background = '#27272a';
                              (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                            }
                          }}
                          style={{
                            padding: '6px 4px',
                            // #328 'auto' 时不选中任何选项
                            background: isSelected ? 'rgba(156, 163, 175, 0.2)' : '#27272a',
                            border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                            borderRadius: '6px',
                            color: '#f4f4f5',
                            cursor: 'pointer',
                            fontSize: '13px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {/* #358 显示比例形状，auto 显示"自动" */}
                          {ratio === 'auto' ? <span>自动</span> : (
                            <>
                              {renderRatioShape(ratio, 12)}
                              <span>{ratio}</span>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>,
                document.body
              )}
            </div>
            
            {/* 分辨率选择按钮 */}
            <div style={{ position: 'relative' }}
            >
              <button 
                ref={resolutionButtonRef}
                style={{
                  padding: '4px 6px',
                  fontSize: '13px',
                  background: '#27272a',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#f4f4f5',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                }}
                data-picker-button="true"
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = '#3f3f46';
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(156, 163, 175, 0.3)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = '#27272a';
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  const newPos = calculatePickerPosition(resolutionButtonRef);
                  setPickerPositions(prev => ({ ...prev, resolution: newPos }));
                  setLocalResolutionPicker(!localResolutionPicker);
                  setLocalModelPicker(false);
                  setLocalRatioPicker(false);
                  setLocalCountPicker(false);
                  setLocalQualityPicker(false);  // #523 关闭品质弹窗
                }}
              >
                <span>{localResolution || '1K'}</span>
                {/* #358 展开/收起符号 */}
                <span style={{ fontSize: '14px', opacity: 0.6 }}>
                  {localResolutionPicker ? '^' : '˅'}
                </span>
              </button>
              
              {/* 分辨率选择弹窗 - #弹窗修复：使用 createPortal 渲染到 body */}
              {localResolutionPicker && pickerPositions.resolution && createPortal(
                <div 
                  style={{
                    position: 'fixed',
                    left: pickerPositions.resolution.left,
                    bottom: pickerPositions.resolution.bottom,
                    width: '150px',
                    maxHeight: '60vh',
                    background: '#27272a',
                    border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
                    borderRadius: '8px',
                    boxShadow: '0 5px 12px rgba(0, 0, 0, 0.25)',
                    zIndex: 9999,
                    overflow: 'hidden',
                  }} 
                  data-picker-popup="true" 
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid #27272a' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#f4f4f5' }}>分辨率</span>
                  </div>
                  <div style={{ padding: '6px' }}>
                    {getAvailableResolutions().map((res) => {
                      const resConfig = modelConfig?.[localModel]?.resolutions?.find((r: any) => (r.size || r.value || '').toLowerCase() === (res || '').toLowerCase());
                      const isSelected = localResolution === res;
                      return (
                        <button
                          key={res}
                          onClick={() => {
                            updateElementData({ panelResolution: res });
                            setLocalResolutionPicker(false);
                            setLocalQualityPicker(false);  // #523 选择分辨率时关闭品质弹窗
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              (e.currentTarget as HTMLElement).style.background = 'rgba(156, 163, 175, 0.15)';
                              (e.currentTarget as HTMLElement).style.boxShadow = '0 0 10px rgba(156, 163, 175, 0.2)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              (e.currentTarget as HTMLElement).style.background = 'transparent';
                              (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                            }
                          }}
                          style={{
                            width: '100%',
                            padding: '6px 10px',
                            background: isSelected ? 'rgba(156, 163, 175, 0.2)' : 'transparent',
                            border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                            borderRadius: '6px',
                            color: '#f4f4f5',
                            cursor: 'pointer',
                            marginBottom: '2px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '13px',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <span>{res}</span>
                          <span style={{ color: '#ffffff', fontSize: '12px' }}>{resConfig?.credits || 0}积分</span>
                        </button>
                      );
                    })}
                  </div>
                </div>,
                document.body
              )}
            </div>
            
            {/* #523 T8Star/GRS GPT 模型品质按钮 */}
            {(localModel?.startsWith('t8star.') || localModel === 'gpt-image-2-vip' || localModel === 'gpt-image-2') && (
              <div style={{ position: 'relative' }}>
                <button 
                  ref={qualityButtonRef}
                  style={{
                    padding: '4px 6px',
                    fontSize: '13px',
                    background: '#27272a',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#f4f4f5',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                  data-picker-button="true"
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = '#3f3f46';
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(156, 163, 175, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = '#27272a';
                    (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const newPos = calculatePickerPosition(qualityButtonRef);
                    setPickerPositions(prev => ({ ...prev, quality: newPos }));
                    setLocalQualityPicker(!localQualityPicker);
                    setLocalModelPicker(false);
                    setLocalRatioPicker(false);
                    setLocalResolutionPicker(false);
                    setLocalCountPicker(false);
                  }}
                >
                  <span>品质:{localQuality === 'low' ? '速度' : localQuality === 'medium' ? '中' : localQuality === 'high' ? '高' : '自动'}</span>
                  <span style={{ fontSize: '14px', opacity: 0.6 }}>
                    {localQualityPicker ? '^' : '˅'}
                  </span>
                </button>
                
                {/* 品质选择弹窗 */}
                {localQualityPicker && pickerPositions.quality && createPortal(
                  <div 
                    style={{
                      position: 'fixed',
                      left: pickerPositions.quality.left,
                      bottom: pickerPositions.quality.bottom,
                      width: '160px',
                      background: '#27272a',
                      border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
                      borderRadius: '8px',
                      boxShadow: '0 5px 12px rgba(0, 0, 0, 0.25)',
                      zIndex: 9999,
                      overflow: 'hidden',
                    }} 
                    data-picker-popup="true" 
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ padding: '8px 10px', borderBottom: '1px solid #27272a' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#f4f4f5' }}>品质</span>
                    </div>
                    <div style={{ padding: '6px' }}>
                      {[
                        { value: 'auto', label: '自动', desc: '默认' },
                        { value: 'high', label: '高', desc: '细节多' },
                        { value: 'medium', label: '中', desc: '平衡' },
                        { value: 'low', label: '速度', desc: '最快' },
                      ].map((q) => {
                        const isSelected = localQuality === q.value;
                        return (
                          <button
                            key={q.value}
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateElement(el.id, { panelQuality: q.value });
                              setLocalQualityPicker(false);
                            }}
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              background: isSelected ? '#18181b' : 'transparent',
                              border: 'none',
                              borderRadius: '4px',
                              color: isSelected ? '#ffffff' : '#a1a1aa',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: '13px',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            <span>{q.label}</span>
                            <span style={{ color: isSelected ? '#d4d4d8' : '#a1a1aa', fontSize: '12px', width: '36px', textAlign: 'right', display: 'inline-block' }}>{q.desc}</span>
                            {isSelected && <span style={{ color: '#22c55e', fontSize: '12px', marginLeft: '4px' }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>,
                  document.body
                )}
              </div>
            )}
            
            {/* 数量选择按钮 */}
            <div style={{ position: 'relative' }}>
              <button 
                ref={countButtonRef}
                style={{
                  padding: '4px 6px',
                  fontSize: '13px',
                  background: '#27272a',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#f4f4f5',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                }}
                data-picker-button="true"
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = '#3f3f46';
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(156, 163, 175, 0.3)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = '#27272a';
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  const newPos = calculatePickerPosition(countButtonRef);
                  setPickerPositions(prev => ({ ...prev, count: newPos }));
                  setLocalCountPicker(!localCountPicker);
                  setLocalModelPicker(false);
                  setLocalRatioPicker(false);
                  setLocalResolutionPicker(false);
                  setLocalQualityPicker(false);  // #523 关闭品质弹窗
                }}
              >
                <span>×{localCount || 1}</span>
                {/* #358 展开/收起符号 */}
                <span style={{ fontSize: '14px', opacity: 0.6 }}>
                  {localCountPicker ? '^' : '˅'}
                </span>
              </button>
              
              {/* 数量选择弹窗 - #弹窗修复：使用 createPortal 渲染到 body */}
              {localCountPicker && pickerPositions.count && createPortal(
                <div 
                  style={{
                    position: 'fixed',
                    left: pickerPositions.count.left,
                    bottom: pickerPositions.count.bottom,
                    width: '120px',
                    maxHeight: '60vh',
                    background: '#27272a',
                    border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
                    borderRadius: '8px',
                    boxShadow: '0 5px 12px rgba(0, 0, 0, 0.25)',
                    zIndex: 9999,
                    overflow: 'hidden',
                  }} 
                  data-picker-popup="true" 
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid #27272a' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#f4f4f5' }}>数量</span>
                  </div>
                  <div style={{ padding: '6px' }}>
                    {[1, 2, 4].map((count) => {
                      const isSelected = localCount === count;
                      return (
                        <button
                          key={count}
                          onClick={() => {
                            updateElementData({ panelCount: count });
                            setLocalCountPicker(false);
                            setLocalQualityPicker(false);  // #523 选择数量时关闭品质弹窗
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              (e.currentTarget as HTMLElement).style.background = 'rgba(156, 163, 175, 0.15)';
                              (e.currentTarget as HTMLElement).style.boxShadow = '0 0 10px rgba(156, 163, 175, 0.2)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              (e.currentTarget as HTMLElement).style.background = 'transparent';
                              (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                            }
                          }}
                          style={{
                            width: '100%',
                            padding: '6px 10px',
                            background: isSelected ? 'rgba(156, 163, 175, 0.2)' : 'transparent',
                            border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                            borderRadius: '6px',
                            color: '#f4f4f5',
                            cursor: 'pointer',
                            marginBottom: '2px',
                            fontSize: '13px',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {count} 张
                        </button>
                      );
                    })}
                  </div>
                </div>,
                document.body
              )}
            </div>
            {/* #347 文本面板隐藏比例/分辨率/数量按钮 - 结束 */}
              </>
            )}
            </>
            )}
            
            <div style={{ flex: 1 }} />
            
            {/* 积分信息 */}
            <span style={{ fontSize: '12px', color: '#ffffff', whiteSpace: 'nowrap' }}>
              {calculateCredits()}积分
            </span>
            
            {/* #346 发送按钮 - 根据 targetType 显示不同按钮 */}
            {el.targetType === '文本' ? (
              // 文本类型 - LLM 按钮
              // #489 修复：按钮样式与图片面板一致（白色背景黑色文字）
              <button 
                style={{
                  padding: '5px 12px',
                  fontSize: '13px',
                  background: hasValidPrompt && !isLlmGenerating ? '#ffffff' : '#e5e5e5',
                  border: 'none',
                  borderRadius: '6px',
                  color: hasValidPrompt && !isLlmGenerating ? '#000000' : '#a1a1aa',
                  cursor: hasValidPrompt && !isLlmGenerating ? 'pointer' : 'not-allowed',
                  opacity: hasValidPrompt && !isLlmGenerating ? 1 : 0.7,
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                }}
                disabled={!hasValidPrompt || isLlmGenerating}
                onMouseEnter={(e) => {
                  if (hasValidPrompt && !isLlmGenerating) {
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(0, 0, 0, 0.2)';
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1.02)';
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                }}
                onClick={async (e) => {
                  e.stopPropagation();
                  handleLlmGenerate();
                }}
              >
                {isLlmGenerating ? (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                      <path d="M12 2a10 10 0 0 1 10 10" />
                    </svg>
                    <span>生成中</span>
                  </>
                ) : (
                  <>
                    <span>生成文本</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 2L11 13"/>
                      <path d="M22 2L15 22L11 13L2 9L22 2Z"/>
                    </svg>
                  </>
                )}
              </button>
            ) : (
              // 图片/视频/音频类型 - 原有生成按钮
              // #366 修正：删除 sourceTextContent（数据隔离），只检查 sourceImageEls
              <button 
                style={{
                  padding: '5px 12px',
                  fontSize: '13px',
                  // #853 修复：上传中也禁用生成按钮
                  background: sourceImageEls.length > 0 && !isLocalGenerating && !hasUploadingSource ? '#ffffff' : '#e5e5e5',
                  border: 'none',
                  borderRadius: '6px',
                  color: sourceImageEls.length > 0 && !isLocalGenerating && !hasUploadingSource ? '#000000' : '#a1a1aa',
                  cursor: sourceImageEls.length > 0 && !isLocalGenerating && !hasUploadingSource ? 'pointer' : 'not-allowed',
                  opacity: sourceImageEls.length > 0 && !isLocalGenerating && !hasUploadingSource ? 1 : 0.7,
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                }}
                // #853 修复：上传中也禁用生成按钮
                disabled={sourceImageEls.length === 0 || isLocalGenerating || hasUploadingSource}
                onMouseEnter={(e) => {
                  if (sourceImageEls.length > 0 && !isLocalGenerating && !hasUploadingSource) {
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(0, 0, 0, 0.2)';
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1.02)';
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                }}
                onClick={async (e) => {
                  e.stopPropagation();
                  handleGenerateClick();
                }}
              >
                {isLocalGenerating ? (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                      <path d="M12 2a10 10 0 0 1 10 10" />
                    </svg>
                    <span>生成中</span>
                  </>
                ) : (
                  <>
                    <span>发送</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </>
                )}
              </button>
            )}
            
            {/* #358 响应区域已移到主面板显示 */}
          </div>
        </div>
      )}
      
      {/* #330 面板右键菜单 - 使用 Portal 渲染到 body */}
      {panelContextMenu && createPortal(
        <div
          data-panel-context-menu
          style={{
            position: 'fixed',
            left: panelContextMenu.x,
            top: panelContextMenu.y,
            background: '#27272a',
            border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
            borderRadius: '8px',
            boxShadow: '0 5px 12px rgba(0, 0, 0, 0.25)',
            zIndex: 10000,
            padding: '4px',
            minWidth: '140px',
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* 创建副本 */}
          <button
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '6px',
              color: '#f4f4f5',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
            onClick={() => {
              onDuplicatePanel?.(el.id);
              setPanelContextMenu(null);
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(156, 163, 175, 0.15)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            创建副本
          </button>
          
          {/* 删除 */}
          <button
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '6px',
              color: '#ef4444',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
            onClick={() => {
              onDeletePanel?.(el.id);
              setPanelContextMenu(null);
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#fee2e2'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            删除
          </button>
        </div>,
        document.body
      )}
      
      {/* #366 覆盖确认弹窗 */}
      {showOverwriteConfirm && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10001,
          }}
          onClick={(e) => {
            e.stopPropagation();
            handleCancelOverwrite();
          }}
        >
          <div
            style={{
              background: '#27272a',
              border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '400px',
              boxShadow: '0 5px 12px rgba(0, 0, 0, 0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ 
              fontSize: '18px', 
              fontWeight: 600, 
              color: '#f4f4f5', 
              marginBottom: '12px' 
            }}>
              确认覆盖
            </h3>
            <p style={{ 
              fontSize: '14px', 
              color: '#a1a1aa', 
              marginBottom: '24px',
              lineHeight: 1.5,
            }}>
              已有图片连接到此面板，再次生成将覆盖原有图片。确定要继续吗？
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                style={{
                  padding: '10px 20px',
                  background: '#3f3f46',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#f4f4f5',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
                onClick={handleCancelOverwrite}
              >
                取消
              </button>
              <button
                style={{
                  padding: '10px 20px',
                  background: '#ef4444',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#ffffff',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
                onClick={handleConfirmOverwrite}
              >
                确认覆盖
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      
    </div>
  );
}

// ====== #606 军师核级别隔离舱：死死锁住面板！ ======
// 这个组件有 5815 行代码，是画布上最庞大的组件。
// 如果不加 React.memo，每次任何状态变化都会触发整个 DOM 树重新执行，
// 导致 Chrome 被迫进行大范围重绘，把旁边的图片也拖下水变糊！
export const GeneratePanelNode = React.memo(GeneratePanelNodeComponent, (prevProps, nextProps) => {
  // 🔍 严格比对核心数据，把所有垃圾更新全部挡在门外！
  // 只有以下核心 props 变化时才允许重新渲染：
  
  // 1. 元素 ID 和位置/尺寸（面板移动/缩放时需要重绘）
  if (prevProps.el.id !== nextProps.el.id) return false;
  if (prevProps.el.x !== nextProps.el.x) return false;
  if (prevProps.el.y !== nextProps.el.y) return false;
  if (prevProps.el.width !== nextProps.el.width) return false;
  if (prevProps.el.height !== nextProps.el.height) return false;
  
  // 2. 选中状态（只有自己被选中/取消才重绘）
  if (prevProps.isSelected !== nextProps.isSelected) return false;
  
  // 3. 输入激活状态（弹窗打开/关闭）
  if (prevProps.isInputActive !== nextProps.isInputActive) return false;
  
  // 4. 磁吸和连接状态（影响端口高亮）
  if (prevProps.isBeingSnapped !== nextProps.isBeingSnapped) return false;
  if (prevProps.isAlreadyConnected !== nextProps.isAlreadyConnected) return false;
  
  // 5. 缩放和平移（影响面板渲染位置）
  if (prevProps.zoom !== nextProps.zoom) return false;
  if (prevProps.pan.x !== nextProps.pan.x || prevProps.pan.y !== nextProps.pan.y) return false;
  
  // 6. 源图片 IDs（影响面板上显示的参考图）
  // 使用数组长度和元素比较，避免引用比较误判
  const prevSourceIds = prevProps.sourceIds || [];
  const nextSourceIds = nextProps.sourceIds || [];
  if (prevSourceIds.length !== nextSourceIds.length) return false;
  for (let i = 0; i < prevSourceIds.length; i++) {
    if (prevSourceIds[i] !== nextSourceIds[i]) return false;
  }
  
  // 7. 面板自身参数变化（模型/比例/分辨率/提示词等）
  if (prevProps.el.panelModel !== nextProps.el.panelModel) return false;
  if (prevProps.el.panelRatio !== nextProps.el.panelRatio) return false;
  if (prevProps.el.panelResolution !== nextProps.el.panelResolution) return false;
  if (prevProps.el.panelQuality !== nextProps.el.panelQuality) return false;
  if (prevProps.el.panelCount !== nextProps.el.panelCount) return false;
  if (prevProps.el.panelPrompt !== nextProps.el.panelPrompt) return false;
  if (prevProps.el.targetType !== nextProps.el.targetType) return false;
  if (prevProps.el.panelType !== nextProps.el.panelType) return false;
  if (prevProps.el.generationStatus !== nextProps.el.generationStatus) return false;
  if (prevProps.el.generationError !== nextProps.el.generationError) return false;
  if (prevProps.el.textContent !== nextProps.el.textContent) return false;
  if ((prevProps.el as any).videoDuration !== (nextProps.el as any).videoDuration) return false;
  if ((prevProps.el as any).videoAspectRatio !== (nextProps.el as any).videoAspectRatio) return false;
  if ((prevProps.el as any).videoResolution !== (nextProps.el as any).videoResolution) return false;
  if ((prevProps.el as any).videoSize !== (nextProps.el as any).videoSize) return false;
  if ((prevProps.el as any).hhMode !== (nextProps.el as any).hhMode) return false;
  if ((prevProps.el as any).audioSetting !== (nextProps.el as any).audioSetting) return false;
  
  // 8. 积分和生成状态（影响显示）
  if (prevProps.credits !== nextProps.credits) return false;
  if (prevProps.isGenerating !== nextProps.isGenerating) return false;
  
  // 9. 悬浮状态（Handle 显示/隐藏）
  if (prevProps.hoveredElementId !== nextProps.hoveredElementId) return false;
  if (prevProps.theme !== nextProps.theme) return false;
  
  // 10. 模型配置变化（影响模型选择列表）
  // 使用浅比较，因为 modelConfig 和 modelDisplayNames 是大对象
  if (prevProps.imageModelOptions !== nextProps.imageModelOptions) return false;
  if (prevProps.videoModelOptions !== nextProps.videoModelOptions) return false;
  if (prevProps.llmModelOptions !== nextProps.llmModelOptions) return false;
  
  // ⚠️ 重要：以下 props 不比较，允许通过 DOM 操作处理：
  // - selectedIds：画布选中列表变化，面板不需要重绘
  // - allElements：其他元素变化，面板不需要重绘
  // - 所有回调函数：函数引用变化不应触发重绘
  
  // 所有核心 props 都相同，阻止重新渲染
  return true;
});
