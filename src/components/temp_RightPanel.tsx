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

import React from 'react';
import Image from 'next/image';
import { X, Plus, Send, Loader2 } from 'lucide-react';  // #048 新增 Loader2
import { InfoDialog } from '@/components/ui/info-dialog';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';
import { deleteReferenceImage } from '@/lib/dialog-data-db';

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
  
  // ==================== 模型相关 ====================
  formatModelName: (name: string) => string;
  
  // ==================== 生成参数配置 ====================
  aspectRatioOptions: string[];
  resolutionOptions: Array<{ size: string; credits: number }>;
  currentConfig: ModelConfigItem;
  
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
      default: return { w: 14, h: 14 };
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

// ============================================
// 【组件实现】
// ============================================

const RightPanel: React.FC<RightPanelProps> = (props) => {
  // 使用 AIGenerator Context 获取状态
  const aiState = useAIGenerator();
  
  // 解构违规计数状态（用于警告提示）
  const { failedAttempts, FAILED_ATTEMPTS_THRESHOLD } = aiState;
  
  // 第5次违规弹窗状态
  const [showViolationWarning, setShowViolationWarning] = React.useState(false);
  
  console.log('[RightPanel] #301 当前 failedAttempts:', failedAttempts);
  
  // #301 违规警告弹窗：只在 failedAttempts >= 5 时触发一次
  const hasShownWarningRef = React.useRef(false);
  
  React.useEffect(() => {
    // 已弹过或未达标，跳过
    if (hasShownWarningRef.current || failedAttempts < 5) return;
    
    console.log(`[RightPanel] #301 违规检测触发弹窗，当前次数: ${failedAttempts}`);
    hasShownWarningRef.current = true;  // 一次性锁死，防止重复弹窗
    setShowViolationWarning(true);
  }, [failedAttempts]);  // 只监听 failedAttempts，与弹窗状态解绑
  
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
    selectedAspectRatio, setSelectedAspectRatio,
    selectedCount, setSelectedCount,
    selectedDuration, setSelectedDuration,
    showRatioPicker, setShowRatioPicker,
    showResolutionPicker, setShowResolutionPicker,
    showAspectRatioPicker, setShowAspectRatioPicker,
    showCountPicker, setShowCountPicker,
    showDurationPicker, setShowDurationPicker,
    credits, setCredits,
    showFavoritesModal, setShowFavoritesModal,
    newFavoriteContent, setNewFavoriteContent,
    editingId, setEditingId,
    editingContent, setEditingContent,
    favorites, setFavorites,
    previewImage, setPreviewImage,
    infoDialog, setInfoDialog,
  } = aiState;

  return (
    <>
      {/* 右侧AI面板 - 裁剪模式下禁用 */}
      <aside 
        className={`bg-white dark:bg-gray-800 flex flex-col shrink-0 relative canvas-area-cursor ${isRightPanelCollapsed ? 'w-12' : ''}`}
        style={{ 
          width: isRightPanelCollapsed ? 48 : rightPanelWidth,
          boxShadow: '-2px 0 10px rgba(0,0,0,0.08)',
          borderRadius: '12px',
          margin: '12px',
          marginLeft: '0',
          pointerEvents: isCropping ? 'none' : 'auto'
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
              };
              
              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);
            }}
          />
        )}
        {/* 收起按钮 - 右上角 */}
        <button
          onClick={() => setIsRightPanelCollapsed(!isRightPanelCollapsed)}
          className="absolute top-3 right-3 w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors z-10 text-gray-600 dark:text-gray-300"
          title={isRightPanelCollapsed ? '展开面板' : '收起面板'}
        >
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

            {/* 消息列表 - 支持鼠标滚轮和滚动条 */}
        <div ref={messageListRef} className="flex-1 overflow-y-auto px-4 min-h-0">
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
                          src="/grid-original.png"
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
                    <div className="flex items-start gap-2">
                      <button 
                        className={`shrink-0 mt-0.5 p-1 rounded transition-colors ${msg.role === 'user' ? 'hover:bg-gray-800 dark:hover:bg-gray-600 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'}`}
                        onClick={() => {
                          // 🔧 #210 修复：复制到对话框而非剪贴板
                          handleSendToInput(msg.content);
                        }}
                        title="复制到输入框"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth="2"/>
                          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2"/>
                        </svg>
                      </button>
                      <div className="text-xs leading-relaxed">{msg.content}</div>
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
        <div className="sticky bottom-0 bg-white dark:bg-gray-800 px-4 pb-4 pt-2 rounded-b-xl relative">
          {messages.length > 0 && (
            <button
              onClick={() => {
                setMessages([]);
                clearMessages();
                console.log('[Canvas Dialog] 已清除对话内容');
              }}
              className="absolute -top-1 right-4 -translate-y-1/2 flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors bg-white dark:bg-gray-800"
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
          <div className="border border-gray-200 dark:border-gray-600 rounded-xl p-3 relative">
            <textarea 
              className="w-full text-gray-900 dark:text-white text-sm resize-none outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500 overflow-hidden bg-transparent"
              placeholder="请输入你的设计需求"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
              }}
              style={{ minHeight: '60px', maxHeight: '200px' }}
            />
            <button
              onClick={() => setShowFavoritesModal(true)}
              className="absolute right-1.5 bottom-1.5 flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded transition-colors"
              title="提示词收藏"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              收藏
            </button>
          </div>
          
          <div className="flex gap-2 px-1 pt-2 flex-wrap">
            {chatImageBase64s.map((base64, index) => (
              <div key={chatImageMd5s[index] || index} className="relative group">
                <img 
                  src={base64} 
                  alt={chatImageNames[index]} 
                  className="w-12 h-12 object-cover rounded-lg border border-gray-200 dark:border-gray-600 cursor-pointer hover:opacity-80 transition-opacity" 
                  onClick={() => setPreviewImage(base64)}
                />
                {/* #048 新增：上传中显示加载转圈 */}
                {chatImageMd5s[index] && chatUploadingMd5s.has(chatImageMd5s[index]) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                    <Loader2 className="w-5 h-5 text-white animate-spin" />
                  </div>
                )}
                <button 
                  className="absolute -top-1 -right-1 w-4 h-4 bg-gray-900 dark:bg-gray-600 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={async () => {
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
                  }}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {chatImageBase64s.length < 6 && (
              <div 
                title="上传参考图"
                className="w-12 h-12 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                onClick={() => referenceImageInputRef.current?.click()}
              >
                <svg width="16" height="16" className="text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="2"/>
                  <polyline points="21 15 16 10 5 21" strokeWidth="2"/>
                </svg>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2 pt-3">
            <button 
              className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-gray-700 dark:text-gray-200 transition-colors"
              onClick={() => setShowModelPicker(true)}
            >
              模型: {modelDisplayNames[selectedModel] || formatModelName(selectedModel)}
            </button>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">
                剩余 {credits}
              </span>
              <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">
                {(() => {
                  const config = modelConfig[selectedModel] || {
                    resolutions: [{ size: '1K', credits: 10 }],
                    aspectRatios: ['auto', '1:1', '3:2', '4:3', '16:9', '9:16'],
                    type: 'image' as const,
                  };
                  const resolutions = config?.resolutions || [{ size: '1K', credits: 10 }];
                  const resConfig = resolutions.find((r: { size: string; credits: number }) => r.size === selectedResolution);
                  const creditsPerImage = resConfig?.credits || resolutions[0]?.credits || 0;
                  const totalCredits = currentConfig.type === 'video' ? creditsPerImage : creditsPerImage * selectedCount;
                  return `${totalCredits} 积分`;
                })()}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 pt-2">
            <button 
              className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-gray-700 dark:text-gray-200 transition-colors whitespace-nowrap flex-shrink-0"
              onClick={() => setShowRatioPicker(!showRatioPicker)}
            >
              比例: {selectedRatio}
            </button>
            <button 
              className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-gray-700 dark:text-gray-200 transition-colors whitespace-nowrap flex-shrink-0"
              onClick={() => setShowResolutionPicker(!showResolutionPicker)}
            >
              {currentConfig.type === 'video' ? '清晰度' : '分辨率'}: {selectedResolution}
            </button>
            {currentConfig.type !== 'video' && (
              <button 
                className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-gray-700 dark:text-gray-200 transition-colors whitespace-nowrap flex-shrink-0"
                onClick={() => setShowCountPicker(!showCountPicker)}
              >
                数量: {selectedCount}
              </button>
            )}
            {currentConfig.type === 'video' && currentConfig.supportsDuration && (
              <button 
                className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-gray-700 dark:text-gray-200 transition-colors whitespace-nowrap flex-shrink-0"
                onClick={() => setShowDurationPicker(!showDurationPicker)}
              >
                时长: {selectedDuration}秒
              </button>
            )}
            <div className="flex-1" />
            
            <button 
              className="px-4 py-1.5 text-xs bg-gray-900 dark:bg-gray-700 hover:bg-gray-700 dark:hover:bg-gray-600 rounded-lg text-white transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              onClick={handleSend}
            >
              <span>发送</span>
              <Send className="w-3 h-3" />
            </button>
          </div>
        </div>
          </>
        )}
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
                const modelLogo = modelId === 'gpt-image-2' ? '/gpt-image-2-logo.png' : '/model-logo.png';
                
                if (!config) {
                  return (
                    <div 
                      key={modelId}
                      className="flex items-center gap-3 p-3 rounded-lg cursor-not-allowed opacity-50"
                    >
                      <img src={modelLogo} alt="" className="w-8 h-8 rounded-lg" />
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
                      <img src={modelLogo} alt="" className="w-8 h-8 rounded-lg grayscale" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-400 dark:text-gray-500">{modelDisplayNames[modelId] || formatModelName(modelId)}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">离线</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {(config.resolutions || []).map((r: any) => r.size).join(' / ')}
                          </span>
                          <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {config.resolutions?.[0]?.credits || 10} 积分起
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
                      setSelectedModel(modelId);
                      setShowModelPicker(false);
                    }}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      isSelected ? 'bg-gray-100 dark:bg-gray-700' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    <img src={modelLogo} alt="" className="w-8 h-8 rounded-lg" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{modelDisplayNames[modelId] || formatModelName(modelId)}</span>
                        {/* 在线=绿色实心圆，离线=红色空心圆 */}
                        <span className={isActive ? 'text-green-500 text-xs' : 'text-red-500 text-xs'}>
                          {isActive ? '●' : '○'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {(config.resolutions || []).map((r: any) => r.size).join(' / ')}
                        </span>
                        <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {config.resolutions?.[0]?.credits || 10} 积分起
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
              {aspectRatioOptions.map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => {
                    setSelectedRatio(ratio);
                    setShowRatioPicker(false);
                  }}
                  className={`py-2 px-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-1 ${
                    selectedRatio === ratio 
                      ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  <AspectRatioIcon ratio={ratio} selected={selectedRatio === ratio} />
                  <span>{ratio}</span>
                </button>
              ))}
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
              {resolutionOptions.map((res) => (
                <button
                  key={res.size}
                  onClick={() => {
                    setSelectedResolution(res.size);
                    setShowResolutionPicker(false);
                  }}
                  className={`w-full py-2 px-3 rounded-lg text-left transition-colors flex items-center justify-between ${
                    selectedResolution === res.size 
                      ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium">{res.size}</div>
                  </div>
                  <div className={`text-xs ${selectedResolution === res.size ? 'text-gray-300 dark:text-gray-400' : 'text-gray-500 dark:text-gray-400'}`}>
                    {res.credits} 积分
                  </div>
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
              {['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'].map((ratio) => (
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
            <div className="p-2 grid grid-cols-2 gap-2">
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

      {/* 时长选择弹窗 */}
      {showDurationPicker && currentConfig.supportsDuration && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4" onClick={() => setShowDurationPicker(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[150px] mb-20 mr-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">选择时长</h3>
              <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={() => setShowDurationPicker(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 grid grid-cols-2 gap-2">
              {[10, 15].map((d) => (
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

      {/* 智能分割弹窗 */}
      {showGridModal && (
        <div 
          data-modal="true"
          className="fixed inset-0 z-[1000] pointer-events-none"
        >
          {!isGridSelectMode && (
            <div 
              className="fixed inset-0 z-[1001] pointer-events-auto"
              onClick={() => {
                setShowGridModal(false);
                setGridLeftCollapsed(false);
                setGridGenerating(false);
                setGridUploadedImages([]);
                setGridSplitImages([]);
              }}
            />
          )}
          
          <div 
            className="fixed top-1/2 -translate-y-1/2 z-[1002] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl flex flex-col gap-4 p-6 pointer-events-auto"
            style={{ right: '20px', width: '340px', height: '88vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={() => {
                setShowGridModal(false);
                setGridLeftCollapsed(false);
                setGridGenerating(false);
                setGridUploadedImages([]);
                setGridSplitImages([]);
                setIsGridSelectMode(false);
              }}
              className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            
            <div className="py-3 bg-gray-50 dark:bg-gray-800 rounded-xl text-center">
              <div className="flex items-center justify-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">智能分割</h3>
              </div>
            </div>
            
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">待分割图</p>
                {gridUploadedImages.length > 0 && !gridGenerating && !gridUploading && (
                  <button 
                    onClick={() => setGridUploadedImages([])}
                    className="text-xs text-red-500 hover:text-red-600"
                  >
                    移除
                  </button>
                )}
              </div>
              <div className="w-full aspect-square bg-white dark:bg-gray-700 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-600 flex items-center justify-center overflow-hidden relative">
                {/* #127 上传加载状态 */}
                {gridUploading ? (
                  <div className="absolute inset-0 bg-white/90 dark:bg-gray-800/90 flex flex-col items-center justify-center">
                    <div className="w-10 h-10 mb-3 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm text-gray-600 dark:text-gray-300">Uploading...</p>
                  </div>
                ) : gridUploadedImages.length > 0 ? (
                  <>
                    <img 
                      src={gridUploadedImages[0].base64 || gridUploadedImages[0].imageUrl} 
                      alt="待分割图" 
                      className="max-w-full max-h-full object-contain"
                    />
                    {gridGenerating && (
                      <div className="absolute inset-0 bg-white/70 dark:bg-gray-900/70 flex flex-col items-center justify-center backdrop-blur-sm">
                        <div className="w-10 h-10 mb-2 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-sm text-gray-700 dark:text-gray-200">正在分割...</p>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-gray-400 dark:text-gray-500">暂无图片</p>
                )}
              </div>
            </div>
            
            <div className="flex gap-2">
              <button 
                onClick={() => {
                  if (isGridSelectMode) {
                    setIsGridSelectMode(false);
                  } else {
                    setIsGridSelectMode(true);
                    setGridLeftCollapsed(true);
                  }
                }}
                disabled={gridUploading}
                className={`flex-1 py-2.5 px-2 rounded-lg border transition-colors flex flex-col items-center justify-center gap-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed ${
                  isGridSelectMode 
                    ? 'border-red-400 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50' 
                    : 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400'
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                {isGridSelectMode ? '取消添加' : '从画布添加'}
              </button>
              <label className={`flex-1 py-2.5 px-2 rounded-lg border transition-colors flex flex-col items-center justify-center gap-1 text-xs cursor-pointer ${
                gridUploading 
                  ? 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed' 
                  : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 text-gray-600 dark:text-gray-300'
              }`}>
                <input 
                  ref={gridFileInputRef}
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleGridFileUpload}
                  disabled={gridUploading}
                />
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                {gridUploading ? 'Uploading...' : '从本地上传'}
              </label>
            </div>
            
            <div className="py-2 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <label className="flex items-center justify-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-500" 
                  checked={gridRemoveBorders}
                  onChange={(e) => setGridRemoveBorders(e.target.checked)}
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">去除边框</span>
              </label>
            </div>
            
            <button
              onClick={async () => {
                if (gridUploadedImages.length === 0) {
                  showInfo('提示', '请先添加图片');
                  return;
                }
                canvas.clearSelection();
                
                // 🔧 #134 修复：开始分割时折叠左侧面板
                setGridLeftCollapsed(true);
                
                setGridGenerating(true);
                setGridSplitImages([]);
                
                console.log('[分割] ========== 开始分割流程 ==========');
                console.log('[分割] #141 移除占位符，直接添加到画布');
                
                try {
                  const uploadedImage = gridUploadedImages[0];
                  console.log('[分割] uploadedImage:', { 
                    hasBase64: !!uploadedImage.base64, 
                    hasImageUrl: !!uploadedImage.imageUrl,
                    base64Length: uploadedImage.base64?.length || 0 
                  });
                  
                  let imageBase64 = uploadedImage.base64;
                  
                  if (!imageBase64 && uploadedImage.imageUrl) {
                    console.log('[分割] 从 imageUrl 转换为 base64...');
                    imageBase64 = await imageUrlToBase64(uploadedImage.imageUrl);
                  }
                  
                  if (!imageBase64) {
                    console.error('[分割] 无法获取图片数据');
                    showInfo('分割失败', '无法获取图片数据');
                    setGridGenerating(false);
                    return;
                  }
                  
                  console.log('[分割] 原始 base64 长度:', imageBase64.length);
                  imageBase64 = await compressBase64IfNeeded(imageBase64);
                  console.log('[分割] 压缩后 base64 长度:', imageBase64.length);
                  
                  console.log('[分割] 调用 /api/split API...');
                  const response = await fetch('/api/split', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      image: imageBase64,
                      removeBorders: gridRemoveBorders,
                      // 🔧 #210 修复：不传递 splitCount，让后端 AI 自动识别分割数量
                      // splitCount: gridSplitCount
                    })
                  });
                  
                  console.log('[分割] API 响应状态:', response.status, response.statusText);
                  const responseText = await response.text();
                  console.log('[分割] API 响应长度:', responseText.length);
                  
                  if (!response.ok) {
                    let errMsg = responseText;
                    try {
                      const errJson = JSON.parse(responseText);
                      errMsg = errJson.error || responseText;
                    } catch {}
                    console.error('[分割] API 失败:', errMsg);
                    showInfo('分割失败', errMsg);
                    setGridGenerating(false);
                    return;
                  }
                  
                  let data;
                  try {
                    data = JSON.parse(responseText);
                    console.log('[分割] API 返回数据:', { 
                      hasCells: !!data.cells, 
                      cellsLength: data.cells?.length || 0,
                      needCrop: data.needCrop,
                      error: data.error
                    });
                  } catch {
                    console.error('[分割] JSON 解析失败:', responseText.substring(0, 500));
                    showInfo('API返回格式错误', responseText.substring(0, 500));
                    setGridGenerating(false);
                    return;
                  }
                  
                  if (data.cells && data.cells.length > 0) {
                    const actualCount = data.cells.length;
                    console.log('[分割] 开始切割图片，cells 数量:', actualCount);
                    
                    // 切割图片
                    const splitImages = await cropImageByCells(
                      imageBase64,
                      data.cells,
                      data.needCrop
                    );
                    console.log('[分割] 切割完成，splitImages 数量:', splitImages.length);
                    setGridSplitImages(splitImages);
                    
                    // 🔧 #141 修复：移除占位符，直接调用 handleAddSplitImagesToCanvas
                    // handleAddSplitImagesToCanvas 已包含：居中 + 躲避 + COS上传
                    console.log('[分割] #141 直接添加到画布（居中+躲避）');
                    await handleAddSplitImagesToCanvas(splitImages);
                    console.log('[分割] #141 图片已添加到画布');
                    
                    console.log('[分割] ========== 分割流程结束 ==========');
                  } else {
                    console.error('[分割] 未识别到分镜结构, data:', data);
                    showInfo('分割失败', data.error || '未识别到分镜结构');
                  }
                } catch (err: any) {
                  console.error('[分割] 异常:', err);
                  showInfo('分割请求失败', err.message || '请重试');
                } finally {
                  setGridGenerating(false);
                  console.log('[分割] ========== 分割流程结束 ==========');
                }
              }}
              disabled={gridUploadedImages.length === 0 || gridGenerating || gridUploading}
              className={`w-full py-3 rounded-xl font-medium transition-colors ${
                gridUploadedImages.length === 0 || gridGenerating || gridUploading
                  ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                  : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              {gridGenerating ? '正在分割...' : gridUploading ? 'Uploading...' : `开始分割（5 积分）`}
            </button>
          </div>
          
          {!gridLeftCollapsed && (
            <div 
              className="fixed top-1/2 -translate-y-1/2 z-[1001] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300"
              style={{ 
                left: '80px',
                right: '380px',
                height: '88vh',
                maxHeight: '1000px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="h-full p-6">
                <div className="h-full flex gap-4">
                  <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-700 rounded-xl overflow-hidden p-4">
                    <Image
                      src="/grid-original.png"
                      alt="主图"
                      width={800}
                      height={600}
                      className="max-w-full max-h-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <div className="w-[45%] flex flex-col gap-4">
                    <div className="flex-1 flex gap-4 min-h-0">
                      <div className="flex-1 bg-gray-50 dark:bg-gray-700 rounded-xl overflow-hidden flex items-center justify-center p-2">
                        <Image src="/grid-1.png" alt="分割1" width={200} height={200} className="w-full h-full object-contain" loading="lazy" />
                      </div>
                      <div className="flex-1 bg-gray-50 dark:bg-gray-700 rounded-xl overflow-hidden flex items-center justify-center p-2">
                        <Image src="/grid-2.png" alt="分割2" width={200} height={200} className="w-full h-full object-contain" loading="lazy" />
                      </div>
                    </div>
                    <div className="flex-1 flex gap-4 min-h-0">
                      <div className="flex-1 bg-gray-50 dark:bg-gray-700 rounded-xl overflow-hidden flex items-center justify-center p-2">
                        <Image src="/分镜_3x3_8.png" alt="分割3" width={200} height={200} className="w-full h-full object-contain" loading="lazy" />
                      </div>
                      <div className="flex-1 bg-gray-50 dark:bg-gray-700 rounded-xl overflow-hidden flex items-center justify-center p-2">
                        <Image src="/分镜_3x3_9.png" alt="分割4" width={200} height={200} className="w-full h-full object-contain" loading="lazy" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {gridLeftCollapsed ? (
            <div className="fixed top-1/2 -translate-y-1/2 z-[1003] pointer-events-auto" style={{ right: '360px' }}>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setGridLeftCollapsed(false);
                }}
                className="w-6 h-12 bg-white dark:bg-gray-800 rounded-lg shadow-md flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border border-gray-200 dark:border-gray-600"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="fixed top-1/2 -translate-y-1/2 z-[1003] pointer-events-auto" style={{ right: '360px' }}>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setGridLeftCollapsed(true);
                }}
                className="w-6 h-12 bg-white dark:bg-gray-800 rounded-lg shadow-md flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border border-gray-200 dark:border-gray-600"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="rotate-180">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      {/* 信息弹窗 */}
      <InfoDialog
        open={infoDialog.open}
        onOpenChange={(open) => setInfoDialog({ ...infoDialog, open })}
        title={infoDialog.title}
        description={infoDialog.description}
      />
      
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

      {/* 第5次违规警告弹窗 */}
      {showViolationWarning && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-orange-500 mb-3">⚠️ 违规警告</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              您已累计提交 5 次违规任务。<br />
              恶意提交违规任务 10 次，恶意提交积分返还一半。
            </p>
            <button
              onClick={() => setShowViolationWarning(false)}
              className="w-full py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors"
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default RightPanel;
