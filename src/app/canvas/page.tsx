'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo, startTransition, Suspense } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useTheme } from 'next-themes';
import { CanvasProvider, useCanvas, type CanvasContextType } from '@/contexts/CanvasContext';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';
import { useViolationGuard } from '@/hooks/useViolationGuard';
import { useFakeProgress } from '@/hooks/useFakeProgress';
import { CanvasElement, Message } from '@/types/canvas';
import { ScrollArea } from '@/components/ui/scroll-area';
import Navbar from '@/components/Navbar';
import FabricTextLayer, { fabricDraggingFlag } from '@/components/FabricTextLayer';
import { fetchUserWithCache, updateCachedCredits } from '@/lib/user-cache';
import { fetchConfig } from '@/lib/config-fetch';
import HistoryRecordsDialog from '@/components/HistoryRecordsDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { historyStore, type HistoryRecord } from '@/store/historyStore';  // #232 Sprint 3
import TextToolbar, { TEXT_TOOLBAR_HEIGHT, TEXT_TOOLBAR_GAP, TEXT_TOOLBAR_WIDTH } from '@/components/canvas/toolbars/TextToolbar';
import PenToolbar, { hexToHSB, hsbToHex } from '@/components/canvas/toolbars/PenToolbar';
import { InfoDialog } from '@/components/ui/info-dialog';
import AuthModal from '@/components/AuthModal';
import { useSharedData } from '@/hooks/useSharedData';
import { toast } from 'sonner';
import CanvasRoseCurve from '@/components/canvas/CanvasRoseCurve';
import { translateErrorMessage } from '@/lib/error-handler';
import TopBar from '@/components/temp_TopBar';
import LeftSideBar from '@/components/temp_LeftSideBar';
import RightPanel from '@/components/temp_RightPanel';
import { GeneratePanelNode } from '@/components/GeneratePanelNode';
import InteractiveImageStackNode, { createImageStackNode, addImageToStackData } from '@/components/InteractiveImageStackNode';
import MemoizedCanvasImage from '@/components/MemoizedCanvasImage';
import ConnectionPulseCanvas, { type ConnectionPath } from '@/components/ConnectionPulseCanvas';
import { useCanvasCore, CANVAS_HEIGHT, IMAGE_OVERLAP_OFFSETS } from '@/hooks/useCanvasCore';
import { usePresignedUrl } from '@/hooks/usePresignedUrl';
import { getPresignedUrls } from '@/lib/presigned-url-cache';
import { safeSetItem } from '@/lib/safe-storage';
import { safeJsonResponse } from '@/lib/safe-json';
import { uploadFile } from '@/lib/upload';
import { globalPendingUploads } from '@/hooks/useOptimisticUpload';



import {
  Plus,
  Sparkles,
  Send,
  Wand2,
  RefreshCw,
  Share2,
  Save,
  X,
  ChevronRight,
  Edit3,
  ChevronUp,
  LayoutGrid,
  Settings,
  Sun,
  Moon,
  Image as ImageIcon,
  Copy,
  Edit2,
  Trash2,
} from 'lucide-react';
import {
  storeReferenceImage,
  getAllReferenceImages,
  deleteReferenceImage,
  saveMessages,
  loadMessages,
  saveInputContent,
  loadInputContent,
  clearMessages,
} from '@/lib/dialog-data-db';
import {
  saveImageKeyMapping,
  getImageKeyMapping,
  clearAllImageKeyMappings,
} from '@/lib/dialog-image-key-map';
import { calculateMD5FromArrayBuffer } from '@/lib/reference-image-cache';
import { compressImageForUpload } from '@/lib/frontend-defense';
import { downloadFile, fetchBlob, getCOSUrlForElement, downloadViaProxy } from '@/lib/download';
import { generateBezierPath } from '@/lib/bezier-path';
import { getEffectiveSources, type SourceItem, getModelMaxLimits, getModelSupportedTypes } from '@/lib/effective-sources';
import { ModelDetector } from '@/lib/model-utils';
import { useInteractionCanvas } from '@/hooks/useInteractionCanvas';
// 【A 计划】乐观上传 Hook
import { useOptimisticUpload, OptimisticUploadResult, BackgroundUploadResult } from '@/hooks/useOptimisticUpload';
// #615 视频组件 - 带状态管理
import { CanvasVideo } from '@/components/CanvasVideo';

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

// SVG图标
const icons = {
  select: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 3L7 13L8.5 8.5L13 7L3 3Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
    </svg>
  ),
  hand: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2.5C8 2.22386 8.22386 2 8.5 2C8.77614 2 9 2.22386 9 2.5V6.5M9 2.5V1.5C9 1.22386 9.22386 1 9.5 1C9.77614 1 10 1.22386 10 1.5V6.5M10 2.5C10 2.22386 10.2239 2 10.5 2C10.7761 2 11 2.22386 11 2.5V6.5M11 3.5C11 3.22386 11.2239 3 11.5 3C11.7761 3 12 3.22386 12 3.5V9C12 11.2091 10.2091 13 8 13H7.5C5.567 13 4 11.433 4 9.5V7.5C4 7.22386 4.22386 7 4.5 7C4.77614 7 5 7.22386 5 7.5V9M5 6.5V5C5 4.72386 5.22386 4.5 5.5 4.5C5.77614 4.5 6 4.72386 6 5V6.5M6 6V2.5C6 2.22386 6.22386 2 6.5 2C6.77614 2 7 2.22386 7 2.5V6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  marker: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2L8 4M8 12L8 14M2 8L4 8M12 8L14 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  ),
  add: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M8 5.5V10.5M5.5 8H10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  shape: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  ),
  text: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 4H12M8 4V12M5 12H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  pen: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M12 2L14 4L5 13L2 14L3 11L12 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  image: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="5.5" cy="5.5" r="1.2" stroke="currentColor" strokeWidth="1"/>
      <path d="M2.5 11L5.5 8L8 10.5L10.5 7L13.5 10V12.5H2.5V11Z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  export: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M9 2.5H13.5V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M13.5 2.5L8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  video: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M6.5 6L10 8L6.5 10V6Z" fill="currentColor"/>
    </svg>
  ),
  eyedropper: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M12 2L14 4L8 10L6 10L6 8L12 2Z" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M4 12L6 10" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  ),
  bold: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 2H8C9.65685 2 11 3.34315 11 5C11 6.65685 9.65685 8 8 8H3V2Z" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M3 6H9C10.6569 6 12 7.34315 12 9C12 10.6569 10.6569 12 9 12H3V6Z" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
  italic: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5 2H10M4 12H9M8 2L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  underline: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M4 2V7C4 8.65685 5.34315 10 7 10C8.65685 10 10 8.65685 10 7V2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M3 13H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  alignLeft: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 3H12M2 6H9M2 9H11M2 12H6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  alignCenter: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 3H12M4 6H10M3 9H11M5 12H9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  alignRight: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 3H12M5 6H12M3 9H12M8 12H12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  split: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 8H14" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2"/>
      <rect x="3.5" y="3.5" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="8.5" y="8.5" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M6 3.5L10 3.5M6 12.5L10 12.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  ),
  save: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 3H10.5L13 5.5V13H3V3Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5 3V5.5H10V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5 9H11V13H5V9Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
};

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
      
      // ===== 只支持 1K 的模型 =====
      if (key === 'nano-banana' || key === 'nano-banana-fast') {
        parameters.resolutions = [
          { label: '1K', value: '1K', credits: credits || 10 }
        ];
      }
      // ===== 支持 1K, 2K, 4K 的模型 =====
      // #680 Banana 模型合并：nano-banana-2-cl 和 nano-banana-pro-vip 现在也支持 4K（后端自动路由到 4K 模型）
      else if (key === 'nano-banana-2' || 
               key === 'nano-banana-2-cl' || 
               key === 'nano-banana-pro' || 
               key === 'nano-banana-pro-vip' || 
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

// 图像生成器操作面板组件 - 使用共享配置
const ImageGeneratorPanel: React.FC<{ canvasSize: number }> = ({ canvasSize }) => {
  // 使用共享配置
  const { model, setModel, resolution, setResolution, aspectRatio, setAspectRatio, apiEndpoint, apiKey } = useSharedData();
  // #878 熔断：从 Context 获取精细化模型维度分辨率禁用状态
  const { bannedResolutions, currentModelBannedResolutions, isResolutionBanned } = useAIGenerator();
  
  const [prompt, setPrompt] = useState('');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showResMenu, setShowResMenu] = useState(false);
  const [showRatioMenu, setShowRatioMenu] = useState(false);
  
  // 动态模型配置（从数据库获取）
  const [modelConfig, setModelConfig] = useState<Record<string, ModelConfigItem>>({});
  
  // 模型显示名称（从 API 动态获取）
  const [modelDisplayNames, setModelDisplayNames] = useState<Record<string, string>>({});
  
  // #838 删除：第一批重复的 image_generation config fetch 已被第二批（1174-1341行）覆盖
  // #838 删除：modelCreditsUpdated/storage 事件监听也在第二批 fetchModelOptions 中通过 __fetchModelOptions 处理
  // 原来画布页面加载时 image_generation 被请求 3 次（本处 + 1180行 + AIGeneratorContext），现减为 1 次
  
  // 兜底配置
  const fallbackConfig: ModelConfigItem = {
    type: 'image',
    resolutions: [{ size: '1K', credits: 10 }],
    aspectRatios: baseAspectRatios,
  };
  
  const currentConfig = modelConfig[model] || fallbackConfig;
  const resolutions = currentConfig?.resolutions?.map(r => r.size) || ['1K'];
  const ratios = currentConfig?.aspectRatios || baseAspectRatios;
  
  // 模型显示名称映射
  
  const selectedModelName = modelDisplayNames[model] || formatModelName(model);  // #860: 用 formatModelName 兜底，绝不暴露原始 model_id
  const selectedRes = resolution || resolutions[0] || '1K';
  const selectedRatio = aspectRatio || ratios[0] || '1:1';
  
  return (
    <div style={{ 
      marginTop: 12,
      backgroundColor: '#FFFFFF', 
      borderRadius: 10,
      boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      width: canvasSize,
      overflow: 'visible'
    }}>
      {/* 大文本输入框 */}
      <div style={{ padding: '16px 16px 12px 16px' }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你想要生成的图片..."
          style={{
            width: '100%',
            height: 80,
            border: '1px solid #E5E5E5',
            borderRadius: 8,
            padding: '12px 14px',
            fontSize: 14,
            lineHeight: 1.6,
            resize: 'none',
            outline: 'none',
            color: '#333',
            fontFamily: 'inherit',
          }}
          onFocus={(e) => e.target.style.borderColor = '#40A9FF'}
          onBlur={(e) => e.target.style.borderColor = '#E5E5E5'}
        />
      </div>
      
      {/* 底部选项栏 */}
      <div style={{ 
        padding: '12px 16px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        borderTop: '1px solid #F0F0F0'
      }}>
        {/* 模型选择 */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => { setShowModelMenu(!showModelMenu); setShowResMenu(false); setShowRatioMenu(false); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              borderRadius: 6,
              fontSize: 13,
              color: '#333',
            }}
            className="hover:bg-gray-100"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="6" height="6" stroke="#666" strokeWidth="1.2"/>
              <rect x="9" y="1" width="6" height="6" stroke="#666" strokeWidth="1.2"/>
              <rect x="1" y="9" width="6" height="6" stroke="#666" strokeWidth="1.2"/>
              <rect x="9" y="9" width="6" height="6" stroke="#666" strokeWidth="1.2"/>
            </svg>
            {selectedModelName}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 2 }}>
              <path d="M3 4.5L6 7.5L9 4.5" stroke="#999" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
          
          {showModelMenu && (
            <div style={{
              position: 'absolute',
              left: 0,
              top: '100%',
              marginTop: 4,
              background: '#fff',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              minWidth: 180,
              zIndex: 2500,
              padding: '4px 0',
            }}>
              {Object.entries(modelConfig).map(([key, config]) => (
                <div
                  key={key}
                  onClick={() => { setModel(key); setShowModelMenu(false); }}
                  style={{
                    padding: '8px 14px',
                    fontSize: 13,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: model === key ? '#F0F7FF' : 'transparent',
                    color: model === key ? '#40A9FF' : '#333',
                  }}
                  className="hover:bg-gray-50"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect x="1" y="1" width="6" height="6" stroke="currentColor" strokeWidth="1.2"/>
                    <rect x="9" y="1" width="6" height="6" stroke="currentColor" strokeWidth="1.2"/>
                    <rect x="1" y="9" width="6" height="6" stroke="currentColor" strokeWidth="1.2"/>
                    <rect x="9" y="9" width="6" height="6" stroke="currentColor" strokeWidth="1.2"/>
                  </svg>
                  {modelDisplayNames[key] || formatModelName(key)}  {/* #860: 用 formatModelName 兜底 */}
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* 右侧分辨率和比例 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* 分辨率选择 */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowResMenu(!showResMenu); setShowModelMenu(false); setShowRatioMenu(false); }}
              style={{
                padding: '6px 12px',
                border: '1px solid #E5E5E5',
                background: '#FAFAFA',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                color: '#333',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
              className="hover:bg-gray-100"
            >
              {selectedRes}
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M3 4.5L6 7.5L9 4.5" stroke="#999" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            </button>
            
            {showResMenu && (
              <div style={{
                position: 'absolute',
                left: 0,
                top: '100%',
                marginTop: 4,
                background: '#fff',
                borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                minWidth: 80,
                zIndex: 2500,
                padding: '4px 0',
              }}>
                {resolutions.map((res) => {
                  // #878 使用模型维度熔断判断
                  const isBanned = isResolutionBanned(res);
                  const banExpiry = currentModelBannedResolutions?.[res?.toUpperCase()];
                  const banRemaining = banExpiry ? Math.max(0, Math.ceil((banExpiry - Date.now()) / 60000)) : 0;
                  return (
                    <div
                      key={res}
                      onClick={() => {
                        if (isBanned) return; // #552 熔断中不允许选择
                        setResolution(res);
                        setShowResMenu(false);
                      }}
                      style={{
                        padding: '8px 14px',
                        fontSize: 13,
                        cursor: isBanned ? 'not-allowed' : 'pointer',
                        textAlign: 'center',
                        background: selectedRes === res ? '#F0F7FF' : 'transparent',
                        color: isBanned ? '#ccc' : (selectedRes === res ? '#40A9FF' : '#333'),
                        opacity: isBanned ? 0.6 : 1,
                        position: 'relative',
                      }}
                      className={isBanned ? '' : 'hover:bg-gray-50'}
                      title={isBanned ? '通道拥挤，暂时不可用' : undefined}
                    >
                      {res}
                      {isBanned && (
                        <span style={{
                          fontSize: 10,
                          color: '#ff4d4f',
                          marginLeft: 4,
                        }}>拥挤{banRemaining > 0 ? `(${banRemaining}分)` : ''}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          
          {/* 比例选择 */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowRatioMenu(!showRatioMenu); setShowModelMenu(false); setShowResMenu(false); }}
              style={{
                padding: '6px 12px',
                border: '1px solid #E5E5E5',
                background: '#FAFAFA',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                color: '#333',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
              className="hover:bg-gray-100"
            >
              {selectedRatio}
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M3 4.5L6 7.5L9 4.5" stroke="#999" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            </button>
            
            {showRatioMenu && (
              <div style={{
                position: 'absolute',
                left: 0,
                top: '100%',
                marginTop: 4,
                background: '#fff',
                borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                minWidth: 80,
                zIndex: 2500,
                padding: '4px 0',
              }}>
                {ratios.map((ratio) => (
                  <div
                    key={ratio}
                    onClick={() => { setAspectRatio(ratio); setShowRatioMenu(false); }}
                    style={{
                      padding: '8px 14px',
                      fontSize: 13,
                      cursor: 'pointer',
                      textAlign: 'center',
                      background: selectedRatio === ratio ? '#F0F7FF' : 'transparent',
                      color: selectedRatio === ratio ? '#40A9FF' : '#333',
                    }}
                    className="hover:bg-gray-50"
                  >
                    {ratio}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const tools = [
  { id: 'select', icon: 'select', name: '选择' },
  { id: 'hand', icon: 'hand', name: '平移画布' },
  { id: 'add', icon: 'add', name: '添加' },
  { id: 'shape', icon: 'shape', name: '形状' },
  { id: 'text', icon: 'text', name: '文字' },
  { id: 'pen', icon: 'pen', name: '画笔' },
];

// 模型配置类型定义
interface ModelConfigItem {
  resolutions?: { size: string; credits: number }[];
  aspectRatios?: string[];
  type: 'image' | 'video' | 'tool';
  supportsDuration?: boolean;
  durations?: number[];  // 视频模型时长选项（从数据库解析为秒数数组）
  credits?: number; // 工具模型的积分
  maxRefImages?: number;  // 视频模型最大参考图数量
  imageMode?: 'first_last_frame' | 'component_reference';  // 参考图模式
  supportsUpsample?: boolean;  // 是否支持1080P提升（Veo3.1-pro）
  showDuration?: boolean;  // 前端是否显示时长选择（Sora/Veo隐藏）
  showResolution?: boolean;  // 前端是否显示分辨率选择（Sora/Veo隐藏）
}

// 基础比例列表（所有图片模型通用，API获取失败时的兜底）
const baseAspectRatios = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
// nano-banana-2 系列额外支持的比例
const banana2ExtraAspectRatios = ['1:4', '4:1', '1:8', '8:1'];
// nano-banana-2 系列完整比例
const banana2AspectRatios = [...baseAspectRatios, ...banana2ExtraAspectRatios];
// 默认比例列表（兜底，使用基础列表）
const defaultAspectRatios = baseAspectRatios;

// 判断模型是否为 nano-banana-2 系列
// #680 Banana 模型合并：nano-banana-2-4k-cl 已合并到 nano-banana-2-cl
function isBanana2Series(modelKey: string): boolean {
  return ['nano-banana-2', 'nano-banana-2-cl'].includes(modelKey?.toLowerCase() || '');
}

// 默认图片模型列表（API获取失败时的兜底）
const defaultImageModelOptions: string[] = [];

// 默认视频模型列表（API获取失败时的兜底）
const defaultVideoModelOptions: string[] = [];

// 格式化模型名字：kebab-case -> Title-Case
function formatModelName(name: string): string {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('-');
}

// 默认预设颜色（作为兜底）
const defaultPresetColors = [
  '#000000', '#FFFFFF', '#FF0000', '#FF6B00', '#FFDD00', '#00FF00', 
  '#00FFFF', '#0080FF', '#8000FF', '#FF00FF', '#FF0080', '#804000',
  '#404040', '#808080', '#C0C0C0', '#FFB6C1', '#FFA07A', '#90EE90',
];

export default function CanvasPage() {
  // #511 修复：使用 Context 的 authModalOpen 状态
  const {
    authModalOpen, setAuthModalOpen,
    authMode, setAuthMode,
    refreshUserInfo,
  } = useAIGenerator();
  
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

  // 🛡️ 坐标失步防御：挂载时锁死 body/html 原生滚动，卸载时恢复
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyOvX = body.style.overflowX;
    const prevBodyOvY = body.style.overflowY;

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.overflowX = 'hidden';
    body.style.overflowY = 'hidden';

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.overflowX = prevBodyOvX;
      body.style.overflowY = prevBodyOvY;
    };
  }, []);

  const handleLoginSuccess = (user: any) => {
    // 🔧 关键修复：清除缓存后刷新用户信息
    setAuthModalOpen(false);
    // 清除缓存并刷新用户信息（由 Context 处理）
    // 注意：refreshUserInfo 由 AIGeneratorContext 提供，这里需要调用
    if (typeof window !== 'undefined') {
      // 触发全局事件，通知 Context 刷新用户信息
      window.dispatchEvent(new CustomEvent('user-login-success'));
    }
  };
  
  return (
    <CanvasProvider>
      {/* 🔧 #223 修复：移除多余的 AIGeneratorProvider，layout.tsx 已经有了 */}
      {/* 🛡️ 坐标失步防御：fixed inset-0 彻底脱离文档流，物理阉割原生滚动 */}
      <div className="fixed inset-0 w-screen h-screen flex flex-col bg-gray-100 dark:bg-gray-900 overflow-hidden touch-none">
        {/* 【isLoggedIn 已由 AIGeneratorContext 统一管理，无需通过 props 传递】 */}
        <MainApp />
        <AuthModal 
          isOpen={authModalOpen} 
          onClose={() => setAuthModalOpen(false)} 
          initialMode={authMode}
          onLoginSuccess={handleLoginSuccess}
        />
      </div>
    </CanvasProvider>
  );
}

// ====== #103 修复：全局作用域的轮询管理器 ======
// 必须放在组件外部！与 React 生命周期彻底解绑！
// React Strict Mode 会导致 useEffect 执行两次（挂载→卸载→重新挂载）
// 如果这些 Map 定义在 useEffect 内部，定时器会在卸载时被清除，而重新挂载时不会再启动
const globalPollingTimers = new Map<string, ReturnType<typeof setInterval>>();
const globalFailedCountMap = new Map<string, number>();
// #103 修复：轮询请求合并 - 按 actualTaskId 去重
// subscribers: Map<itemIndex, { elementId, clientId }>
const globalTaskSubscribers = new Map<string, Map<number, { elementId: string; clientId: string }>>();

// ⏱️ P0 防御：轮询绝对超时常量（物理斩断，防止服务商静默死亡吃积分）
const IMAGE_POLL_ABSOLUTE_TIMEOUT = 5 * 60 * 1000;  // 图片轮询绝对上限：5 分钟
const VIDEO_POLL_ABSOLUTE_TIMEOUT_CANVAS = 15 * 60 * 1000; // 视频轮询绝对上限：15 分钟
// 轮询开始时间记录（按 taskKey 记录）
const globalPollStartTimes = new Map<string, number>();

// 【MainApp 组件直接从 AIGeneratorContext 获取用户状态，不再通过 props 接收】
function MainApp() {
  const router = useRouter();
  const canvas = useCanvas();
  
  // #032 修复：初始化闸门 - 如果 Context 还没读完存档，不渲染 Canvas
  // 这样可以确保子组件的 useState 初始值是正确的存档值
  if (!canvas.isInitialized) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">正在同步存档...</p>
        </div>
      </div>
    );
  }
  
  // 只有 isInitialized 为 true 时才会渲染到这里
  // 此时 canvas.state 已经包含了正确的存档值
  // 【isLoggedIn 已由 AIGeneratorContext 统一管理，CanvasApp 内部直接从 Context 获取】
  // #811 修复：CanvasApp 使用 useSearchParams，需要 Suspense 包裹
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    }>
      <CanvasApp canvas={canvas} router={router} />
    </Suspense>
  );
}

// #032 修复：将 Canvas 主逻辑分离到独立组件
// 这样 use State 的初始值可以使用 canvas.state 的存档值
// 【isLoggedIn 已由 AIGeneratorContext 统一管理】
function CanvasApp({ canvas, router }: { canvas: CanvasContextType; router: ReturnType<typeof useRouter> }) {
  // ============================================
  // 【签名 URL 缓存 Hook - 触发浏览器 Disk Cache】
  // ============================================
  const { getUrls: getPresignedUrlsFromHook } = usePresignedUrl();
  
  // #811 修复：读取 URL 参数，处理"发送至Agent"传递的数据
  const searchParams = useSearchParams();
  
  // ============================================
  // 【AI 生成器 Context - 统一用户状态（由 CanvasApp 使用）】
  // ============================================
  // 注意：isLoggedIn, credits, userId 已在 CanvasApp 中从 Context 获取
  // MainApp 不需要这些状态，CanvasApp 会通过 props 传递需要的值
  
  // 【状态已迁移到 AIGeneratorContext】
  // 必须在所有使用这些变量的代码之前调用 useAIGenerator()
  const {
    handleGenerate,
    isGenerating,  // #313 新增：生成状态
    clearAllImages,
    isLoggedIn: ctxIsLoggedIn,
    credits: ctxCredits,
    userId: ctxUserId,
    setCredits: ctxSetCredits,
    setUserId: ctxSetUserId,
    refreshUserInfo,
    // 参考图状态（与 RightPanel 共享）
    chatImageBase64s, setChatImageBase64s,
    chatImageUrls, setChatImageUrls,
    chatImageMd5s, setChatImageMd5s,
    chatImageKeys, setChatImageKeys,
    chatImageNames, setChatImageNames,
    chatImageIds, setChatImageIds,  // #670 虚拟副本唯一标识
    chatUploadingMd5s, setChatUploadingMd5s,  // #048 新增：追踪正在上传的参考图
    // 输入框和消息状态（与 RightPanel 共享）
    inputValue, setInputValue,
    messages, setMessages,
    // 模型选择状态（与 RightPanel 共享）
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
    selectedQuality,  // #522 T8Star GPT 品质参数
    // 收藏夹状态（与 RightPanel 共享）
    showFavoritesModal, setShowFavoritesModal,
    favorites, setFavorites,
    newFavoriteContent, setNewFavoriteContent,
    editingId, setEditingId,
    editingContent, setEditingContent,
    // 对话框状态
    showCopyToast, setShowCopyToast,
    infoDialog, setInfoDialog,
    previewImage, setPreviewImage,
    // 违规计数状态（#508 画布页面也需要违规弹窗）
    failedAttempts, setFailedAttempts,
    isBanned, setIsBanned,
    lockedUntil, setLockedUntil,
    // #511 修复：使用 Context 的登录弹窗状态
    authModalOpen, setAuthModalOpen,
    authMode, setAuthMode,
    // #878 熔断：精细化模型维度分辨率禁用状态
    bannedResolutions, currentModelBannedResolutions, isResolutionBanned,
    // #633 HappyHorse 模式切换
    hhCurrentMode, hhAudioSetting,
    hhOverrideMode, setHhOverrideMode,
    // #636 对话框视频上传
    chatVideoUrl, setChatVideoUrl,
  } = useAIGenerator();
  
  // #826 参考图压缩中计数（乐观加载骨架卡片）
  const [chatCompressingCount, setChatCompressingCount] = useState(0);
  
  // #642 对话框 Seedance 2.0 音频文件引用（对话框更新此 ref，handleSend 读取）
  const dialogRefAudioRef = useRef<{ url: string; name: string; size: number }[]>([]);
  // #642 对话框 Seedance 2.0 音频生成开关（对话框更新此 ref，handleSend 读取）
  const dialogGenerateAudioRef = useRef<boolean>(true);
  
  // #655 双模态假进度引擎（视频+图片通用）
  const videoPlaceholderMsgIdRef = useRef<string | null>(null);  // 当前占位符消息 ID
  const mediaPlaceholderElementIdRef = useRef<string | null>(null);  // #680 当前占位符画布元素 ID（同步进度到画布，视频+图片通用）
  const hasRealProgressRef = useRef(false);  // 是否已收到真实进度（收到后停假进度）
  const fakeProgressFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);  // #进度兜底：15秒无真实进度时启动假进度
  const fakeProgress = useFakeProgress({
    enabled: false,  // 初始关闭，生成时开启
    mediaType: 'video',  // 默认视频，start 前会通过 setMediaType 切换
    onProgress: (p) => {
      // #7xx 假进度更新：同时更新画布占位符和对话框进度环
      // 安全性：saveMessages 的 stableSnapshot 已排除 videoProgress 字段（第 1424 行），
      // 所以 setMessages 更新 videoProgress 不会触发 saveMessages → 不会死循环
      if (!hasRealProgressRef.current) {
        // 更新画布占位符元素（轻量级，不触发 React 渲染）
        // #690 关键修复：更新 generationProgress 字段（CanvasVideo 读取的字段），而非 progress
        if (mediaPlaceholderElementIdRef.current) {
          canvas.updateElement(mediaPlaceholderElementIdRef.current, { generationProgress: p });
        }
        // 更新对话框进度环（驱动 SVG 进度环动画）
        if (videoPlaceholderMsgIdRef.current) {
          setMessages(prev => prev.map(msg => 
            msg.id === videoPlaceholderMsgIdRef.current 
              ? { ...msg, videoProgress: p } 
              : msg
          ));
        }
      }
    },
  });
  
  // 兼容旧的变量名
  const isLoggedIn = ctxIsLoggedIn;
  const credits = ctxCredits;
  const userId = ctxUserId;
  const setCredits = ctxSetCredits;
  const setUserId = ctxSetUserId;
  
  // #508 画布页面违规弹窗（与 RightPanel 共用 Hook）
  const {
    showViolationWarning,
    setShowViolationWarning,
    showBannedDialog: canvasBannedDialogVisible,
    setShowBannedDialog: setCanvasBannedDialogVisible,
    bannedRemainingMinutes,
  } = useViolationGuard(failedAttempts, isBanned, lockedUntil);
  
  // 画布工具状态（本地）
  const [activeTool, setActiveTool] = useState<string>('select');
  const activeToolRef = useRef(activeTool);
  
  // 同步 activeTool 到 ref
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  
  // #进度兜底：组件卸载时清理15秒兜底定时器，防止内存泄漏
  useEffect(() => {
    return () => {
      if (fakeProgressFallbackTimerRef.current) {
        clearTimeout(fakeProgressFallbackTimerRef.current);
      }
    };
  }, []);
  
  // 键盘快捷键切换工具
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 排除输入框
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      
      // A 键切换到选择工具
      if (e.key === 'a' || e.key === 'A') {
        if (e.ctrlKey || e.metaKey) return; // 排除 Ctrl+A / Cmd+A
        e.preventDefault();
        setActiveTool('select');
        canvas.setTool('select');
      }
      
      // S 键切换到平移工具
      if (e.key === 's' || e.key === 'S') {
        if (e.ctrlKey || e.metaKey) return; // 排除 Ctrl+S / Cmd+S
        e.preventDefault();
        setActiveTool('hand');
        canvas.setTool('hand');
        canvas.clearSelection(); // 切换到手型工具时取消选择
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  // 获取收藏列表
  const fetchFavorites = useCallback(async () => {
    try {
      // #109 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/prompt-favorites', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setFavorites(data.favorites || []);
      } else if (data.error === '未登录') {
        // 未登录时不显示错误，只是空列表
        setFavorites([]);
      }
    } catch (error) {
      console.error('Failed to fetch favorites:', error);
    }
  }, []);
  
  // 打开收藏弹窗时获取列表
  useEffect(() => {
    if (showFavoritesModal) {
      fetchFavorites();
    }
  }, [showFavoritesModal, fetchFavorites]);
  
  
  // 添加收藏
  const handleAddFavorite = useCallback(async () => {
    if (!newFavoriteContent.trim()) return;
    try {
      // #109 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/prompt-favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: newFavoriteContent }),
      });
      const data = await res.json();
      if (data.success) {
        setNewFavoriteContent('');
        fetchFavorites();
      } else if (data.error === '未登录') {
        // #889 鉴权漏洞修复：未登录时调起 LoginModal，不用 toast
        setAuthModalOpen(true);
      } else {
        toast.error(data.error || '添加失败');
      }
    } catch (error) {
      console.error('Failed to add favorite:', error);
      toast.error('添加失败，请重试');
    }
  }, [newFavoriteContent, fetchFavorites]);
  
  // 删除收藏
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
      console.error('[删除收藏] 错误:', error);
      toast.error('删除失败，请重试');
    }
  }, [fetchFavorites]);
  
  // 更新收藏内容
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
        setEditingId(null);
        setEditingContent('');
        fetchFavorites();
      }
    } catch (error) {
      console.error('Failed to update favorite:', error);
    }
  }, [fetchFavorites]);
  
  // 复制到剪贴板（收藏夹功能）
  const handleCopyContent = useCallback(async (content: string, id: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setShowCopyToast(true);
      setTimeout(() => setShowCopyToast(false), 1500);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, []);
  
  // 发送到输入框
  const handleSendToInput = useCallback((content: string) => {
    setInputValue(content);
    setShowFavoritesModal(false);
  }, []);
  

  // 【状态已迁移到 AIGeneratorContext】
  // 以下状态从 Context 获取，不再本地定义：
  // - imageModelOptions, setImageModelOptions
  // - videoModelOptions, setVideoModelOptions
  // - modelActiveStatus, setModelActiveStatus
  // - modelConfig, setModelConfig
  // - modelDisplayNames, setModelDisplayNames
  
  const [presetColors, setPresetColors] = useState<string[]>(defaultPresetColors);
  
  // 从后端 API 获取模型列表和配置
  useEffect(() => {
    const fetchModelOptions = async () => {
      // 挂载到 window 对象，供 handleCreditsUpdated 调用
      (window as any).__fetchModelOptions = fetchModelOptions;
      try {
        // #838 去重：使用 fetchConfig 替代裸 fetch，多组件同时请求同一配置只发一次 HTTP
        const imageData = await fetchConfig('/api/config?service_type=image_generation');
        if (imageData.success && imageData.data?.models) {
          const models = imageData.data.models;
          // 保留所有模型（包括离线），不再过滤 is_active
          const allModelIds = models.map((m: { model_id: string }) => m.model_id);
          if (allModelIds.length > 0) {
            setImageModelOptions(allModelIds);
          }
          
          // 保存模型在线/离线状态
          const activeStatusMap: Record<string, boolean> = {};
          models.forEach((m: { model_id: string; is_active: boolean }) => {
            activeStatusMap[m.model_id] = m.is_active !== false;
          });
          setModelActiveStatus(prev => ({ ...prev, ...activeStatusMap }));
          
          // 构建模型显示名称映射（从 API 获取，优先使用管理后台配置的名称）
          const newDisplayNames: Record<string, string> = {};
          models.forEach((m: { model_id: string; model_name: string }) => {
            newDisplayNames[m.model_id] = m.model_name;
          });
          setModelDisplayNames(prev => ({ ...prev, ...newDisplayNames }));
          
          // 构建模型配置（通过 inferParameters 函数根据 modelKey 重新生成正确的 resolutions）
          const newConfig: Record<string, ModelConfigItem> = {};
          
          // 直接使用数据库中的 resolutions
          models.forEach((m: { model_id: string; parameters: any; service_type?: string; credits_base?: number }) => {
            const dbResolutions = m.parameters?.resolutions || [];
            const dbAspectRatios = (m.parameters?.aspectRatios || []).map((r: any) => r.value || r.label);
            
            newConfig[m.model_id] = {
              type: 'image',
              resolutions: dbResolutions.map((r: any) => ({
                size: r.size || r.label || r.value,
                credits: r.credits || m.credits_base || 10,
              })),
              aspectRatios: dbAspectRatios,
            };
          });
          setModelConfig(newConfig);
        }
      } catch (error) {
        console.error('Failed to fetch image model options:', error);
      }
      
      try {
        // #838 去重：使用 fetchConfig 替代裸 fetch
        const videoData = await fetchConfig('/api/config?service_type=video_generation');
        if (videoData.success && videoData.data?.models) {
          const models = videoData.data.models;
          // 保留所有模型（包括离线），不再过滤 is_active
          const allModelIds = models.map((m: { model_id: string }) => m.model_id);
          if (allModelIds.length > 0) {
            setVideoModelOptions(allModelIds);
          }
          
          // 保存模型在线/离线状态
          const activeStatusMap: Record<string, boolean> = {};
          models.forEach((m: { model_id: string; is_active: boolean }) => {
            activeStatusMap[m.model_id] = m.is_active !== false;
          });
          setModelActiveStatus(prev => ({ ...prev, ...activeStatusMap }));
          
          // 构建视频模型配置（合并逻辑：数据库有值用数据库，空值用默认）
          setModelConfig(prev => {
            const newConfig = { ...prev };
            models.forEach((m: { model_id: string; parameters: any }) => {
              if (m.parameters) {
                const dbAspectRatios = (m.parameters.aspectRatios || []).map((r: any) => r.value || r.label);
                const dbResolutions = (m.parameters.resolutions || []).map((r: any) => ({
                  size: r.size || r.label || r.value,
                  credits: r.credits || 10,
                }));
                // #540 修复：durations 从数据库 [{label,value}] 解析为 number[]（与 AIGeneratorContext 保持一致）
                const rawDurations: any[] = m.parameters.durations || [];
                const dbDurations: number[] = rawDurations.map((d: any) => {
                  if (typeof d === 'number') return d;
                  return parseInt(d.value || d.label) || 0;
                }).filter((n: number) => n > 0);
                // 参考图数量限制
                const maxRefImages = m.parameters.maxImages || 1;
                // 参考图模式
                const imageMode = m.parameters.imageMode || 'first_last_frame';
                // 是否支持1080P提升
                const supportsUpsample = m.parameters.supportsUpsample === true;
                // 前端是否显示时长/分辨率选择（Sora/Veo 隐藏）
                const showDuration = m.parameters.showDuration !== false && dbDurations.length > 0;
                const _mFamily = ModelDetector.getFamily(m.model_id);
                // #736 TOPAIS Seedance 强制显示分辨率选择器（数据库 showResolution=false 会误隐藏）
                const showResolution = _mFamily === 'topais-seedance' ? true : (m.parameters.showResolution !== false && dbResolutions.length > 0);
                const isSeedance = _mFamily === 't8seedance';
                
                // 如果已有配置，合并；否则新建
                if (newConfig[m.model_id]) {
                  newConfig[m.model_id] = {
                    ...newConfig[m.model_id],
                    type: 'video',  // #7xx 修复：视频模型必须覆盖 type（否则 isVideoModel 判断为 false，导致 mode 传 'image'，进度事件被忽略）
                    resolutions: dbResolutions.length > 0 ? dbResolutions : newConfig[m.model_id].resolutions,
                    aspectRatios: dbAspectRatios.length > 0 ? dbAspectRatios : newConfig[m.model_id].aspectRatios,
                    supportsDuration: dbDurations.length > 0 ? true : newConfig[m.model_id].supportsDuration,
                    durations: dbDurations.length > 0 ? dbDurations : newConfig[m.model_id].durations,
                    maxRefImages,
                    imageMode,
                    supportsUpsample,
                    showDuration,
                    showResolution,
                  };
                } else {
                  // 数据库有但默认没有，新建配置（空值使用默认比例列表）
                  const defaultAspectRatios = ['auto', '1:1', '3:2', '4:3', '5:4', '16:9', '21:9', '3:4', '4:5', '9:16', '1:2', '2:3', '1:4', '4:1', '1:8', '8:1'];
                  newConfig[m.model_id] = {
                    type: 'video',
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
            return newConfig;
          });
        }
      } catch (error) {
        console.error('Failed to fetch video model options:', error);
      }

      try {
        // #838 去重：使用 fetchConfig 替代裸 fetch
        const toolData = await fetchConfig('/api/config?service_type=tool');
        if (toolData.success && toolData.data?.models) {
          const models = toolData.data.models;
          
          // 构建工具模型配置
          setModelConfig(prev => {
            const newConfig = { ...prev };
            models.forEach((m: { model_id: string; credits_base?: number; credits?: number }) => {
              newConfig[m.model_id] = {
                type: 'tool',
                credits: m.credits || m.credits_base || 10,
              };
            });
            return newConfig;
          });
        }
      } catch (error) {
        console.error('Failed to fetch tool model options:', error);
      }

      // 预设颜色已硬编码在 defaultPresetColors 中，不再从数据库读取
    };
    fetchModelOptions();
  }, []);
  
  // 【状态已迁移到 AIGeneratorContext】
  // 以下状态从 Context 获取，不再本地定义：
  // - selectedRatio, setSelectedRatio
  // - selectedResolution, setSelectedResolution
  // - selectedAspectRatio, setSelectedAspectRatio
  // - selectedCount, setSelectedCount
  // - selectedDuration, setSelectedDuration
  
  // 弹窗状态（本地管理）
  const [showRatioPicker, setShowRatioPicker] = useState(false);
  const [showResolutionPicker, setShowResolutionPicker] = useState(false);
  const [showAspectRatioPicker, setShowAspectRatioPicker] = useState(false);
  const [showCountPicker, setShowCountPicker] = useState(false);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  
  // ====== 对话框数据持久化 ======
  // 页面加载时恢复数据
  useEffect(() => {
    const restoreDialogData = async () => {
      try {
        // 1. 恢复消息历史
        const savedMessages = loadMessages();
        
        if (savedMessages.length > 0) {
          // 使用旁路缓存恢复图片 URL（增量方案，不侵入核心类型）
          const messagesWithRefreshedImages = await Promise.all(
            savedMessages.map(async (msg) => {
              // 从旁路缓存获取 imageKey
              const imageKeys = getImageKeyMapping(msg.id);
              
              if (imageKeys && imageKeys.length > 0 && msg.imageUrl) {
                try {
                  // #524 修复：使用代理 URL 替代签名 URL（浏览器直连 COS 超时）
                  const proxyUrls = imageKeys.map((key: string) => `/api/canvas/image?key=${encodeURIComponent(key)}`);
                  if (proxyUrls.length > 0) {
                    return { ...msg, imageUrl: proxyUrls[0] };
                  }
                } catch (e) {
                  console.warn('[Canvas Dialog] 刷新图片 URL 失败:', msg.id, e);
                }
              }
              
              // 🔧 #040 修复：恢复参考图 URL
              if (msg.referenceImageKeys && msg.referenceImageKeys.length > 0) {
                try {
                  // #524 修复：使用代理 URL 替代签名 URL
                  const proxyUrls = msg.referenceImageKeys.map((key: string) => `/api/canvas/image?key=${encodeURIComponent(key)}`);
                  if (proxyUrls.length > 0) {
                    return { ...msg, referenceImages: proxyUrls };
                  }
                } catch (e) {
                  console.warn('[Canvas Dialog] 恢复参考图失败:', msg.id, e);
                }
              }
              
              return msg;
            })
          );
          
          // 🔧 #041 修复：恢复助手消息的生成图
          const messagesWithAllImages = await Promise.all(
            messagesWithRefreshedImages.map(async (msg) => {
              // 处理助手消息的生成图
              if (msg.role === 'assistant' && msg.imageUrlKey && !msg.imageUrl) {
                try {
                  // #524 修复：使用代理 URL 替代签名 URL
                  const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(msg.imageUrlKey)}`;
                  return { ...msg, imageUrl: proxyUrl };
                } catch (e) {
                  console.warn('[Canvas Dialog] 恢复助手消息生成图失败:', msg.id, e);
                }
              }
              return msg;
            })
          );
          
          setMessages(messagesWithAllImages);
        }

        // 2. 恢复输入框内容
        const savedInput = loadInputContent();
        if (savedInput) {
          setInputValue(savedInput);
        }

        // 3. 恢复参考图
        const savedImages = await getAllReferenceImages();
        if (savedImages.length > 0) {
          const base64s = savedImages.map(img => img.base64);
          const urls = savedImages.map(img => img.proxyUrl);
          const md5s = savedImages.map(img => img.key);
          const names = savedImages.map(img => img.name);
          const ids = savedImages.map(() => crypto.randomUUID());  // #670 虚拟副本：恢复时生成唯一标识

          setChatImageBase64s(base64s);
          setChatImageUrls(urls);
          setChatImageMd5s(md5s);
          setChatImageNames(names);
          setChatImageIds(ids);  // #670 虚拟副本：同步恢复唯一标识

          // #670 同步 id→index 映射
          ids.forEach((id, idx) => chatImageIdToIdxRef.current.set(id, idx));
        }

        // 4. 重新进入页面时，展开功能组件（欢迎语等）
        setIsFeaturesCollapsed(false);
      } catch (error) {
        console.error('[Canvas Dialog] 恢复数据失败:', error);
      }
    };

    restoreDialogData();
  }, []);  // 空依赖，只在组件挂载时执行一次
  
  // #811 修复：处理"发送至Agent"传递的参考图和提示词数据
  useEffect(() => {
    const isFromAgent = searchParams.get('agent') === '1' || searchParams.get('from') === 'homepage';
    if (!isFromAgent) return;
    
    try {
      const raw = sessionStorage.getItem('agent_transfer_data');
      if (!raw) {
        console.warn('[AgentTransfer] sessionStorage 无数据');
        return;
      }
      
      const data = JSON.parse(raw);
      // 检查数据时效性（5分钟内有效）
      if (Date.now() - (data.timestamp || 0) > 5 * 60 * 1000) {
        console.warn('[AgentTransfer] 数据已过期');
        sessionStorage.removeItem('agent_transfer_data');
        return;
      }
      
      console.log('[AgentTransfer] 收到数据:', {
        model: data.model,
        prompt: data.prompt?.substring(0, 50),
        refImages: data.referenceImages?.length || 0,
        aspectRatio: data.aspectRatio,
        resolution: data.resolution,
      });
      
      // 1. 设置模型
      if (data.model) {
        setSelectedModel(data.model);
      }
      
      // 2. 设置提示词到输入框
      if (data.prompt) {
        setInputValue(data.prompt);
      }
      
      // 3. 设置比例
      if (data.aspectRatio) {
        setSelectedAspectRatio(data.aspectRatio);
        setSelectedRatio(data.aspectRatio);
      }
      
      // 4. 设置分辨率
      if (data.resolution) {
        setSelectedResolution(data.resolution);
      }
      
      // 5. 设置参考图（将 URL 添加到参考图列表）
      // #815 修复：严格过滤空/无效 URL，避免 img src="" 破图
      const refUrls: string[] = [];
      if (data.referenceImages && Array.isArray(data.referenceImages) && data.referenceImages.length > 0) {
        refUrls.push(...data.referenceImages.filter((u: string) => u && typeof u === 'string' && u.length > 0));
      }
      // 只有当 referenceImages 为空时才检查单张 referenceImage
      if (refUrls.length === 0 && data.referenceImage && typeof data.referenceImage === 'string' && data.referenceImage.length > 0) {
        refUrls.push(data.referenceImage);
      }
      
      if (refUrls.length > 0) {
        // 参考图 URL：直接作为 chatImageUrls 使用
        // 如果是代理 URL (/api/canvas/image?key=xxx) 则直接使用
        // 如果是完整 URL 则作为签名 URL 使用
        const urls = refUrls.map((url: string) => {
          // 如果已经是代理 URL 或完整 URL，直接使用
          if (url.startsWith('/api/') || url.startsWith('http')) return url;
          // 否则构造代理 URL
          return `/api/canvas/image?key=${encodeURIComponent(url)}&assetType=perm`;
        });
        
        setChatImageUrls(urls);
        // #813 修复破图：chatImageBase64s 同时作为 img src 使用，空字符串会导致 src="" 破图
        // 将 URL 同时放入 base64s（img src 可以正常加载 URL）
        setChatImageBase64s(urls);
        setChatImageMd5s(urls.map((_: string, i: number) => `agent-ref-${i}-${Date.now()}`));
        setChatImageNames(urls.map((_: string, i: number) => `参考图 ${i + 1}`));
        setChatImageIds(urls.map(() => crypto.randomUUID()));
        
        console.log('[AgentTransfer] 设置参考图:', urls.length, '张');
      }
      
      // 清理 sessionStorage
      sessionStorage.removeItem('agent_transfer_data');
      
      // 清理 URL 参数（避免刷新页面重复读取）
      if (typeof window !== 'undefined' && window.history.replaceState) {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
      }
    } catch (e) {
      console.error('[AgentTransfer] 解析数据失败:', e);
      sessionStorage.removeItem('agent_transfer_data');
    }
  }, [searchParams]); // 只在 URL 参数变化时执行
  
  // 保存消息历史（防抖 + 深度对比 + 节流，防止假进度/真进度高频更新导致死循环）
  const lastSavedMessagesRef = useRef<string>(''); // JSON 快照用于深度对比
  const lastSaveTimeRef = useRef<number>(0); // 上次存库时间戳
  useEffect(() => {
    const timer = setTimeout(() => {
      // 过滤掉正在生成的消息
      const messagesToSave = messages.filter(msg => !msg.isGenerating);
      if (messagesToSave.length === 0) return;
      
      // #抢救二：深度对比 - 只比较消息的"实质内容"（排除 videoProgress 等高频变化字段）
      const stableSnapshot = JSON.stringify(messagesToSave.map(msg => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        imageUrl: msg.imageUrl,
        imageUrlKey: msg.imageUrlKey,
        videoUrl: msg.videoUrl,
        isVideoPlaceholder: msg.isVideoPlaceholder,
        referenceImageKeys: msg.referenceImageKeys,
        timestamp: msg.timestamp,
      })));
      
      // #7xx 修复节流星 bug：AND → OR
      // 旧逻辑（AND）：内容没变 AND 不足5秒 → 跳过。5秒后条件变 false，无论内容是否变化都保存 → 死循环！
      // 新逻辑（OR）：内容没变 OR 不足5秒 → 跳过。只有内容变了 AND 超过5秒才保存 → 彻底阻断死循环
      const now = Date.now();
      if (stableSnapshot === lastSavedMessagesRef.current || now - lastSaveTimeRef.current < 5000) {
        return;
      }
      
      // 内容变了 AND 超过 5 秒 → 执行存库
      lastSavedMessagesRef.current = stableSnapshot;
      lastSaveTimeRef.current = now;
      saveMessages(messagesToSave);
    }, 500);
    return () => clearTimeout(timer);
  }, [messages]);
  
  // 保存输入框内容（防抖）
  useEffect(() => {
    const timer = setTimeout(() => {
      saveInputContent(inputValue);
    }, 500);
    return () => clearTimeout(timer);
  }, [inputValue]);
  
  
  // 右侧面板收起状态和宽度（初始宽度为窗口的 18%）
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(346); // 默认值
  
  // 客户端挂载后从 localStorage 读取保存的宽度
  useEffect(() => {
    try {
      const savedWidth = localStorage.getItem('rightPanelWidth');
      if (savedWidth) {
        const width = parseInt(savedWidth, 10);
        if (!isNaN(width) && width >= 280 && width <= 400) {
          setRightPanelWidth(width);
          return;
        }
      }
    } catch (e) {
      // ignore
    }
    // 没有保存的值，使用计算值：窗口宽度的 18%，最小 280px，最大 400px
    const width = Math.round(window.innerWidth * 0.18);
    setRightPanelWidth(Math.max(280, Math.min(400, width)));
  }, []); // 只在挂载时执行一次
  
  // 持久化右侧面板宽度
  useEffect(() => {
    localStorage.setItem('rightPanelWidth', String(rightPanelWidth));
  }, [rightPanelWidth]);
  
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const panelResizeRef = useRef<{ startX: number; startWidth: number }>({ startX: 0, startWidth: 346 });
  
  // 功能组件折叠状态（欢迎区域和推荐模板）
  const [isFeaturesCollapsed, setIsFeaturesCollapsed] = useState(false);
  
  // 画布配置（欢迎语、工具组件等）
  const [canvasConfig, setCanvasConfig] = useState<any[]>([]);
  
  // 获取画布配置
  // 🔧 #838 去重：使用 fetchConfig 替代裸 fetch，防止多组件/StrictMode 重复请求
  useEffect(() => {
    const fetchCanvasConfig = async () => {
      try {
        const data = await fetchConfig('/api/canvas-config');
        if (data.success) {
          setCanvasConfig(data.data || []);
        }
      } catch (error) {
        console.error('获取画布配置失败:', error);
      }
    };
    
    fetchCanvasConfig();
  }, []);
  
  
  // 当产生对话时自动折叠功能组件
  useEffect(() => {
    if (messages.length > 0) {
      setIsFeaturesCollapsed(true);
    }
  }, [messages.length]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceImageInputRef = useRef<HTMLInputElement>(null);  // 参考图上传输入框
  const videoInputRef = useRef<HTMLInputElement>(null);  // 视频上传输入框（对话框）
  const [isVideoUploading, setIsVideoUploading] = useState(false);  // 视频上传状态
  // #621 右键上传目标位置（非 null 时表示右键上传模式：不偏移、不居中、放在右击位置）
  const contextMenuUploadTargetRef = useRef<{ canvasX: number; canvasY: number } | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);  // 消息列表容器引用
  const taskIdToElementIdRef = useRef<Map<string, string>>(new Map());  // taskId -> elementId 映射（避免 React 异步状态更新问题）
  const placeholderSizeRef = useRef<Map<string, { width: number; height: number }>>(new Map());  // taskId -> 占位符原始尺寸
  const placeholderPositionsRef = useRef<Map<string, { left: number; top: number; right: number; bottom: number }>>(new Map());  // taskId -> 占位符位置（用于连续任务的空白检测）
  const recentlyAddedImagesRef = useRef<{ left: number; top: number; right: number; bottom: number }[]>([]);  // 最近添加的图片位置（解决状态更新延迟问题）
  const chatImageIdToIdxRef = useRef<Map<string, number>>(new Map());  // #670 虚拟副本：唯一 id -> 索引映射（替代 md5 映射，避免重复图片冲突）
  const chatImageNextIdxRef = useRef<number | null>(null);  // 🔧 #839 修复：并行上传索引追踪，避免闭包陷阱
  // #876 架构重构：MD5 键值对追踪参考图最新状态，彻底根除索引错乱陷阱
  // 无论用户怎么乱删图片，最终组装的参数永远与界面真实显示的图片一一对应
  const chatImageLatestRef = useRef<Record<string, { url: string; key: string; base64: string }>>({});
  
  // 展开/折叠功能组件时的滚动处理
  const handleToggleFeatures = useCallback(() => {
    const newCollapsed = !isFeaturesCollapsed;
    setIsFeaturesCollapsed(newCollapsed);
    
    if (messageListRef.current) {
      // 使用 setTimeout 确保 DOM 更新后再滚动
      setTimeout(() => {
        if (messageListRef.current) {
          if (!newCollapsed) {
            // 展开时，滚动到顶部显示欢迎区域
            messageListRef.current.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            // 收起时，滚动到底部显示最新消息记录
            messageListRef.current.scrollTo({ 
              top: messageListRef.current.scrollHeight, 
              behavior: 'smooth' 
            });
          }
        }
      }, 50);
    }
  }, [isFeaturesCollapsed]);
  
  // #042 性能优化：分离"视觉移动"和"状态更新"
  // 移动过程中：只更新 ref + 直接操作 DOM transform（不触发 React 重渲染）
  // 松开鼠标时：才更新 state（触发一次重渲染）
  // 改为惰性初始化 (Lazy Initialization)，彻底消灭时差
  const [zoom, setZoom] = useState(() => {
    let initialZoom: number;
    if (typeof window !== 'undefined') {
      try {
        const saved = JSON.parse(localStorage.getItem('canvas_data') || '{}');
        if (saved.zoom !== undefined) {
          initialZoom = saved.zoom / 100;
          return initialZoom;
        }
      } catch (e) {}
    }
    // 如果没有 localStorage，使用 canvas.state
    initialZoom = canvas.state.zoom / 100;
    return initialZoom;
  });
  
  const [pan, setPan] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = JSON.parse(localStorage.getItem('canvas_data') || '{}');
        if (saved.panX !== undefined && saved.panY !== undefined) {
          return { x: saved.panX, y: saved.panY };
        }
      } catch (e) {}
    }
    // 如果没有 localStorage，使用 canvas.state
    return { x: canvas.state.panX, y: canvas.state.panY };
  });

  // 🔧 调试：暴露 zoom/pan 到全局，方便在控制台查看
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__canvas_debug__ = { zoom, pan };
    }
  }, [zoom, pan]);

  // 强制握手：将读取到的本地存储状态同步给全局 Context
  useEffect(() => {
    if (pan.x !== 0 || pan.y !== 0 || zoom !== 1) {
      // 使用 canvas.setZoom 和 canvas.setPan 方法来更新 Context
      canvas.setZoom(Math.round(zoom * 100));
      canvas.setPan(pan.x, pan.y);
    }
  }, []); // 仅在挂载时执行一次

  // ====== 挂载自检（初始化巡逻）：刷新后断点重连 ======
  // ⚠️ 三条铁律：
  // 1. 状态白名单：只有后端连续3次明确返回 status:'failed' 才标记失败，其他一律当"正在生成"
  // 2. 网络异常保护：fetch报错、400、404、success:false → 全当"正在生成"，继续轮询
  // 3. 安全提取ID：拆分不出actualTaskId → 跳过，绝不标记失败
  useEffect(() => {
    const POLL_INTERVAL = 5000;     // 轮询间隔 5 秒
    const MAX_POLL_COUNT = 120;     // 最多轮询 120 次（10 分钟）
    const FAILED_CONFIRM_COUNT = 3; // 连续3次 failed 才实锤失败
    
    // #103 修复：使用全局作用域的 Map，与 React 生命周期解绑
    // pollingTimers, failedCountMap, taskSubscribers 已移至文件顶部全局作用域
    const pollingTimers = globalPollingTimers;
    const failedCountMap = globalFailedCountMap;
    const taskSubscribers = globalTaskSubscribers;

    // 【干净数据结构】不再需要 parseTaskId，直接读取独立字段

    // 恢复占位符为已完成图片
    const recoverCompletedPlaceholder = async (elementId: string, clientId: string, imageUrl: string, imageKey?: string) => {
      const placeholderSize = placeholderSizeRef.current.get(clientId);
      if (!placeholderSize) {
        const el = canvas.state.elements.find((e: any) => e.id === elementId);
        if (el) {
          placeholderSizeRef.current.set(clientId, { width: el.width, height: el.height });
        } else {
          console.warn('[Canvas 巡逻] 未找到元素，跳过恢复:', elementId);
          return;
        }
      }

      const size = placeholderSizeRef.current.get(clientId)!;


      let naturalWidth: number, naturalHeight: number;
      try {
        // #760 光速降级机制：直连(1次0秒间隔) → 代理URL → 占位符尺寸
        // 前端直连香港COS遭遇ERR_CONNECTION_CLOSED网络阻断，第一次失败立刻切换代理
        const dim = await getImageDimensionsWithRetryCore(imageUrl, 1, 0);
        naturalWidth = dim.width;
        naturalHeight = dim.height;
      } catch {
        // 直连失败，光速切换代理URL（代理通道运行极其完美且迅速）
        if (imageKey) {
          try {
            const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(imageKey)}`;
            const dim = await getImageDimensionsWithRetryCore(proxyUrl, 1, 0);
            naturalWidth = dim.width;
            naturalHeight = dim.height;
          } catch {
            naturalWidth = size.width;
            naturalHeight = size.height;
          }
        } else {
          naturalWidth = size.width;
          naturalHeight = size.height;
        }
      }

      let newWidth: number, newHeight: number;
      if (naturalWidth > 0 && naturalHeight > 0) {
        const aspectRatio = naturalWidth / naturalHeight;
        if (aspectRatio > size.width / size.height) {
          newWidth = size.width;
          newHeight = newWidth / aspectRatio;
        } else {
          newHeight = size.height;
          newWidth = newHeight * aspectRatio;
        }
      } else {
        newWidth = size.width;
        newHeight = size.height;
      }

      // 中心点锚定更新（只更新 imageUrl/imageKey/generationStatus/尺寸，绝不改变元素类型或文字）
      const currentEl = canvas.state.elements.find((e: any) => e.id === elementId);
      if (currentEl) {
        const centerX = currentEl.x + currentEl.width / 2;
        const centerY = currentEl.y + currentEl.height / 2;
        canvas.updateElement(elementId, {
          imageUrl,
          imageKey: imageKey || undefined,
          generationStatus: 'completed',
          width: newWidth,
          height: newHeight,
          x: centerX - newWidth / 2,
          y: centerY - newHeight / 2,
        });
      } else {
        canvas.updateElement(elementId, {
          imageUrl,
          imageKey: imageKey || undefined,
          generationStatus: 'completed',
          width: newWidth,
          height: newHeight,
        });
      }

      placeholderPositionsRef.current.delete(clientId);
    };

    // 标记占位符失败（只有后端明确返回 failed 才调用）
    // 实锤失败后才调用（连续3次 failed 确认）
    const confirmFailed = (elementId: string, clientId: string, error: string) => {
      canvas.updateElement(elementId, {
        generationStatus: 'failed',
        generationError: error,
      });
      placeholderPositionsRef.current.delete(clientId);
    };

    const clearPollingTimer = (pollingKey: string) => {
      const timer = pollingTimers.get(pollingKey);
      if (timer) {
        clearInterval(timer);
        pollingTimers.delete(pollingKey);
      }
      failedCountMap.delete(pollingKey);
      // #437 修复：清理订阅者列表，防止内存泄漏
      taskSubscribers.delete(pollingKey);
      // ⏱️ P0 防御：清理超时时间记录
      globalPollStartTimes.delete(pollingKey);
    };

    // 启动轮询（#103 修复：按 actualTaskId 合并请求）
    const startPolling = (elementId: string, actualTaskId: string, clientId: string, itemIndex: number | null) => {
      // 订阅列表 key：用 actualTaskId（不带 index）
      const taskKey = actualTaskId;
      
      // 加入订阅列表
      if (!taskSubscribers.has(taskKey)) {
        taskSubscribers.set(taskKey, new Map());
      }
      const subscribers = taskSubscribers.get(taskKey)!;
      const subscriberKey = itemIndex ?? 0;
      subscribers.set(subscriberKey, { elementId, clientId });
      
      // 检查是否已有该任务的轮询
      if (pollingTimers.has(taskKey)) {
        return;
      }

      let pollCount = 0;
      // #102 修复：幽灵任务检测 - 只用于任务确实不存在的情况
      let ghostTaskCount = 0;
      const GHOST_TASK_THRESHOLD = 10;
      // ⏱️ P0 防御：记录轮询开始时间
      globalPollStartTimes.set(taskKey, Date.now());

      const timer = setInterval(async () => {
        pollCount++;
        
        // ⏱️ P0 防御：绝对超时物理斩断（优先于 MAX_POLL_COUNT 检查）
        const pollStartTime = globalPollStartTimes.get(taskKey) || Date.now();
        const elapsed = Date.now() - pollStartTime;
        if (elapsed > IMAGE_POLL_ABSOLUTE_TIMEOUT) {
          console.error(`[Canvas 巡逻] ⏱️ P0 绝对超时触发！taskKey: ${taskKey}, 已轮询 ${Math.round(elapsed / 1000)}s，超过上限 ${IMAGE_POLL_ABSOLUTE_TIMEOUT / 1000}s，物理斩断！`);
          clearPollingTimer(taskKey);
          
          // 🔧 轮询超时标记占位符为失败状态 + 触发超时退费
          const elementId = taskIdToElementIdRef.current.get(taskKey);
          if (elementId) {
            const el = canvas.state.elements.find(e => e.id === elementId);
            if (el && el.generationStatus === 'generating') {
              canvas.updateElement(elementId, { 
                generationStatus: 'failed', 
                generationError: `生成超时（超过${IMAGE_POLL_ABSOLUTE_TIMEOUT / 1000 / 60}分钟），已停止等待并退还积分` 
              });
            }
          }
          
          // 向后端请求超时退费
          try {
            const refundRes = await fetch('/api/generation/timeout-refund', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: taskKey, type: 'image' }),
            });
            const refundData = await refundRes.json();
            if (refundData.creditsBalance !== undefined) {
              setCredits(refundData.creditsBalance);
            }
            console.log('[Canvas 巡逻] ⏱️ 超时退费结果:', refundData.success ? '成功' : '失败', refundData);
          } catch (refundErr) {
            console.error('[Canvas 巡逻] ⏱️ 超时退费请求异常:', refundErr);
          }
          
          // Toast 提示用户
          toast.error('生成超时', {
            description: `服务商响应超时（超过${IMAGE_POLL_ABSOLUTE_TIMEOUT / 1000 / 60}分钟），已停止等待并退还积分`,
          });
          return;
        }
        
        if (pollCount > MAX_POLL_COUNT) {
          clearPollingTimer(taskKey);
          
          // 🔧 #208 修复：轮询超时标记占位符为失败状态
          // taskKey 就是 actualTaskId，直接用它查找 elementId
          const elementId = taskIdToElementIdRef.current.get(taskKey);
          if (elementId) {
            const el = canvas.state.elements.find(e => e.id === elementId);
            // 只有当占位符还在生成中时才标记失败（避免覆盖已完成的图片）
            if (el && el.generationStatus === 'generating') {
              canvas.updateElement(elementId, { 
                generationStatus: 'failed', 
                generationError: '轮询超时：任务长时间未完成' 
              });
            }
          }
          return;
        }

        try {
          const res = await fetch(`/api/image-to-image?taskId=${actualTaskId}`);
          
          // #096 修复：幽灵任务死锁 - 网络截断防范
          if (!res.ok) {
            if (res.status === 404) {
              console.error('[Canvas 巡逻] ❌ 任务不存在(404)，立即熔断, taskKey:', taskKey);
              clearPollingTimer(taskKey);
              // 通知所有订阅者失败
              subscribers.forEach(({ elementId, clientId }) => {
                confirmFailed(elementId, clientId, '任务不存在或已过期');
              });
              return;
            }
            console.warn('[Canvas 巡逻] ⚠️ HTTP错误:', res.status, ', 继续轮询');
            return;
          }
          
          const data = await res.json();
          
          // #102 修复：健康状态检测
          const hasHealthyData = data.success === true && (
            (data.imageItems && data.imageItems.length > 0) ||
            (data.imageUrls && data.imageUrls.length > 0) ||
            data.status === 'generating' ||
            data.status === 'pending' ||
            data.status === 'completed'
          );
          
          if (hasHealthyData) {
            ghostTaskCount = 0;
            
            // #103 修复：遍历所有订阅者，分别处理各自的状态
            const imageItems = data.imageItems || [];
            const completedIndexes: number[] = [];
            
            subscribers.forEach(async ({ elementId, clientId }, subscriberIndex) => {
              const pollingKey = `${actualTaskId}_${subscriberIndex}`;
              
              // 找到对应的 imageItem
              const targetItem = imageItems.find((item: any) => item.index === subscriberIndex) || imageItems[subscriberIndex];
              
              if (targetItem?.status === 'completed' && targetItem.url) {
                // 单张图完成，上墙并从订阅列表移除
                completedIndexes.push(subscriberIndex);
                const imageKey = targetItem.imageKey || targetItem.key;
                await recoverCompletedPlaceholder(elementId, clientId, targetItem.url, imageKey);
              } else if (targetItem?.status === 'failed') {
                // 单张图失败，从订阅列表移除
                completedIndexes.push(subscriberIndex);
                const errorMsg = targetItem.error || '生成失败';
                confirmFailed(elementId, clientId, errorMsg);
              }
              // 其他状态继续等待
            });
            
            // 移除已完成的订阅者
            completedIndexes.forEach(idx => subscribers.delete(idx));
            
            // 所有订阅者都完成了，停止轮询
            if (subscribers.size === 0) {
              clearPollingTimer(taskKey);
              return;
            }

            return;
          }
          
          // #102 修复：幽灵任务检测
          const isGhostTask = data.success === false || (
            (!data.imageItems || data.imageItems.length === 0) &&
            (!data.imageUrls || data.imageUrls.length === 0) &&
            data.status !== 'generating' &&
            data.status !== 'pending' &&
            data.status !== 'completed'
          );
          
          if (isGhostTask) {
            ghostTaskCount++;
            console.warn(`[Canvas 巡逻] 👻 幽灵任务检测 (${ghostTaskCount}/${GHOST_TASK_THRESHOLD}), taskKey:`, taskKey);
            
            if (ghostTaskCount >= GHOST_TASK_THRESHOLD) {
              console.error('[Canvas 巡逻] ❌ 幽灵任务判定，立即熔断, taskKey:', taskKey);
              clearPollingTimer(taskKey);
              subscribers.forEach(({ elementId, clientId }) => {
                confirmFailed(elementId, clientId, '任务创建失败，请重试');
              });
              return;
            }
            return;
          }
          
          ghostTaskCount = 0;
        } catch (err) {
          console.warn('[Canvas 巡逻] ⚠️ 网络异常，继续轮询, taskKey:', taskKey, err);
        }
      }, POLL_INTERVAL);

      pollingTimers.set(taskKey, timer);
    };

    const initPatrol = async () => {
      const generatingEls = canvas.state.elements.filter(
        (el: any) => (el.generationStatus === 'generating' || el.generationStatus === 'recovering' || el.generationStatus === 'submitted') && el.generationClientId
      ) as any[];

      if (generatingEls.length === 0) {
        return;
      }

      // 恢复映射表
      for (const el of generatingEls) {
        // 【干净数据结构】直接读取独立字段
        const clientId = el.generationClientId || '';
        if (!clientId) continue;
        taskIdToElementIdRef.current.set(clientId, el.id);
        placeholderSizeRef.current.set(clientId, { width: el.width, height: el.height });
      }

      // ⚠️ 首查绝不标记失败！直接启动轮询，让轮询逻辑统一处理
      for (const el of generatingEls) {
        // 【干净数据结构】直接读取独立字段
        const clientId = el.generationClientId || '';
        const actualTaskId = el.generationTaskId || '';
        const itemIndex = el.generationIndex ?? null;
        const elementId = el.id;

        if (!actualTaskId) {
          console.warn('[Canvas 巡逻] ⚠️ 占位符无 actualTaskId（尚未收到 start 事件），保持原样, clientId:', clientId);
          continue;
        }

        startPolling(elementId, actualTaskId, clientId, itemIndex);
      }
    };

    const timer = setTimeout(initPatrol, 2000);

    return () => {
      clearTimeout(timer);
      // #103 修复：不清除全局变量！
      // React Strict Mode 会导致 useEffect 执行两次（挂载→卸载→重新挂载）
      // 如果在清理时清除定时器，重新挂载时定时器就丢失了
      // 定时器会在以下情况下自动清理：
      // 1. 任务完成时（clearPollingTimer）
      // 2. 任务失败时（clearPollingTimer）
      // 3. 超时时（clearPollingTimer）
      // 注意：pollingTimers, failedCountMap, taskSubscribers 是全局变量，不需要清除
    };
  }, []);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  
  // #Bug1 打字坐标幽灵偏移：从源头掐断
  // 所有 .focus() 调用已统一替换为 .focus({ preventScroll: true })
  // 从浏览器 API 最底层彻底阻止 scrollIntoView 行为，无需 scrollTo 补救
  
  // 用于移动过程中的实时坐标（不触发重渲染）
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  
  // 页面卸载时直接保存视口到 localStorage（不经过 Context）
  useEffect(() => {
    const handleBeforeUnload = () => {
      const zoomPercent = Math.round(zoomRef.current * 100);
      
      // 直接更新 Context 并保存
      canvas.setZoom(zoomPercent);
      canvas.setPan(panRef.current.x, panRef.current.y);
      
      // 直接保存到 localStorage
      const savedState = localStorage.getItem('canvas_data');
      if (savedState) {
        try {
          const parsed = JSON.parse(savedState);
          parsed.zoom = zoomPercent;
          parsed.panX = panRef.current.x;
          parsed.panY = panRef.current.y;
          safeSetItem('canvas_data', JSON.stringify(parsed));
        } catch (e) {
          // 忽略错误
        }
      }
      
      // 🔥 云画布：页面卸载前立即保存到云端
      if (canvas.forceCloudSave) {
        try { canvas.forceCloudSave(); } catch (e) { /* 静默 */ }
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      handleBeforeUnload();
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // ⚠️ P0.2 修复：组件卸载时清理全局轮询定时器，防止内存泄漏
      globalPollingTimers.forEach((timer) => clearInterval(timer));
      globalPollingTimers.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 视口状态持久化：利用 useEffect 配合防抖处理
  useEffect(() => {
    // 只有当用户停止操作 1 秒后，才写入磁盘
    const timer = setTimeout(() => {
      const zoomPercent = Math.round(zoom * 100);
      
      // 保存到 localStorage
      const savedState = localStorage.getItem('canvas_data');
      if (savedState) {
        try {
          const parsed = JSON.parse(savedState);
          parsed.zoom = zoomPercent;
          parsed.panX = pan.x;
          parsed.panY = pan.y;
          safeSetItem('canvas_data', JSON.stringify(parsed));
        } catch (e) {
          // 忽略错误
        }
      } else {
        // 如果没有 savedState，创建一个新的
        safeSetItem('canvas_data', JSON.stringify({
          zoom: zoomPercent,
          panX: pan.x,
          panY: pan.y,
          elements: []
        }));
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [zoom, pan.x, pan.y]);
  
  // 容器尺寸状态 - 用于动态计算画布尺寸（初始值设为常见比例，ResizeObserver 会更新为真实尺寸）
  const [containerSize, setContainerSize] = useState({ width: 1200, height: 800 });
  
  // 裁剪状态 - isCropping 通过 props 传给 CanvasContent
  const [isCropping, setIsCropping] = useState(false);
  const [showSplitDropdown, setShowSplitDropdown] = useState(false);
  const [showVideoFullscreenUrl, setShowVideoFullscreenUrl] = useState<string | null>(null);  // #619 视频全屏播放

  // 显示信息弹窗的辅助函数
  const showInfo = useCallback((title: string, description?: string) => {
    setInfoDialog({ open: true, title, description });
  }, [setInfoDialog]);
  
  // ============================================
  // 【useCanvasCore Hook - 画布核心逻辑抽离】
  // ============================================
  
  // 【A 计划】使用乐观上传 Hook
  const { processFiles: processUploadFiles } = useOptimisticUpload({
    logPrefix: '[Canvas Dialog]',
    maxImages: 6,
    enableCache: true,
    onCacheStore: async (md5, base64, url, fileName) => {
      // storeReferenceImage 需要 Blob，这里暂时跳过 IndexedDB 存储
      // 后续在 onBackgroundComplete 中处理
    },
  });
  
  // 调用 hook（使用 canvasContainerRef）
  const {
    dimensions,
    getImageDimensions: getImageDimensionsCore,
    getImageDimensionsWithRetry: getImageDimensionsWithRetryCore,
    calculateOverlapOffset,
    calculateZoom,
    fitToAllImages,
  } = useCanvasCore(
    {
      canvas,
      setContainerSize,
      setActiveTool,
      setCredits,
      setUserId,
    },
    canvasContainerRef  // 使用正确的 ref
  );
  
  // 保持原有的常量名称（兼容旧代码）
  const CANVAS_HEIGHT = dimensions.CANVAS_HEIGHT;
  const CANVAS_WIDTH = dimensions.CANVAS_WIDTH;
  const IMAGE_OVERLAP_OFFSETS = dimensions.IMAGE_OVERLAP_OFFSETS;

  // ============================================
  // 【画布初始居中】
  // ============================================
  useEffect(() => {
    // 容器尺寸确定后才居中
    if (containerSize.width === 0 || containerSize.height === 0) return;
    if (CANVAS_WIDTH === 0 || CANVAS_HEIGHT === 0) return;
    
    // 检查是否有保存的状态
    const saved = JSON.parse(localStorage.getItem('canvas_data') || '{}');
    const hasSavedState = saved.panX !== undefined && saved.panY !== undefined;
    
    // 没有保存的状态，需要居中
    if (!hasSavedState) {
      const canvasScreenW = CANVAS_WIDTH * zoom;
      const canvasScreenH = CANVAS_HEIGHT * zoom;
      
      // 居中：pan = (容器尺寸 - 画布屏幕尺寸) / 2
      const centerPanX = (containerSize.width - canvasScreenW) / 2;
      const centerPanY = (containerSize.height - canvasScreenH) / 2;
      
      
      setPan({ x: centerPanX, y: centerPanY });
      canvas.setPan(centerPanX, centerPanY);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerSize.width, containerSize.height, CANVAS_WIDTH, CANVAS_HEIGHT]); // 仅在容器尺寸确定后执行一次

  // ============================================
  // 【以下代码已迁移到 useCanvasCore Hook】
  // - ResizeObserver 容器监听
  // - 键盘快捷键处理
  // - 积分获取与监听
  // - 模型更新监听
  // ============================================

  useEffect(() => {
    const config = modelConfig[selectedModel] || {
      resolutions: [{ size: '1K', credits: 10 }],
      aspectRatios: defaultAspectRatios,
      type: 'image' as const,
    };
    if (config) {
      // 如果当前分辨率不在支持的列表中，切换到默认值
      const supportedResolutions = config.resolutions?.map(r => r.size) || [];
      if (supportedResolutions.length > 0 && !supportedResolutions.includes(selectedResolution)) {
        setSelectedResolution(config.resolutions?.[0]?.size || '1K');
      }
      // 如果当前宽高比不在支持的列表中，切换到默认值
      const supportedAspectRatios = config.aspectRatios || [];
      if (supportedAspectRatios.length > 0 && !supportedAspectRatios.includes(selectedRatio)) {
        // 视频模型没有auto，使用第一个支持的宽高比
        setSelectedRatio(supportedAspectRatios[0]);
      }
    }
  }, [selectedModel, selectedResolution, selectedRatio]);

  // 获取当前模型的配置（带兜底）
  const fallbackConfig2 = {
    resolutions: [{ size: '1K', credits: 10 }],
    aspectRatios: defaultAspectRatios,
    type: 'image' as const,
  };
  const rawConfig = modelConfig[selectedModel] || fallbackConfig2;
  const resolutionOptions: { size: string; credits: number }[] = (rawConfig?.resolutions?.length ?? 0) > 0 ? rawConfig!.resolutions! : [{ size: '1K', credits: 10 }];
  const aspectRatioOptions: string[] = (() => {
    // #636 HappyHorse 强制 5 个比例
    if (ModelDetector.getFamily(selectedModel) === 'happyhorse') return ['16:9', '9:16', '1:1', '4:3', '3:4'];
    const ratios = (rawConfig?.aspectRatios?.length ?? 0) > 0 ? rawConfig!.aspectRatios! as string[] : baseAspectRatios;
    // #865 MiniMax: 确保 adaptive 在列表中（变灰显示，t2v不可选/i2v固定adaptive）
    if (ModelDetector.getFamily(selectedModel) === 'topais-minimax' && !ratios.includes('adaptive')) {
      return [...ratios, 'adaptive'];
    }
    return ratios;
  })();
  // #635 修复：根据视频模型列表智能推断 type，而非默认 'image'
  const isVideoModelById = videoModelOptions.includes(selectedModel);
  const currentConfig = {
    ...rawConfig,
    resolutions: resolutionOptions || [{ size: '1K', credits: 10 }],
    aspectRatios: aspectRatioOptions || baseAspectRatios,
    type: (rawConfig as any)?.type || (isVideoModelById ? 'video' as const : 'image' as const),
  };

  const handleToolClick = useCallback((toolId: string) => {
    setActiveTool(toolId);
    switch (toolId) {
      case 'select':
        canvas.setTool('select');
        break;
      case 'hand':
        canvas.setTool('hand');
        canvas.clearSelection(); // 切换到手型工具时取消选择
        break;
      case 'add':
        fileInputRef.current?.click();
        canvas.clearSelection(); // 操作后取消选择
        // 使用完后自动回到选择功能
        setTimeout(() => {
          setActiveTool('select');
          canvas.setTool('select');
        }, 100);
        break;
      case 'shape':
        canvas.setTool('rectangle');
        canvas.clearSelection(); // 操作后取消选择
        break;
      // 形状工具 - 实心形状
      case 'shape-rectangle':
        setActiveTool('shape-rectangle');
        canvas.setTool('shape-rectangle');
        canvas.clearSelection();
        break;
      case 'shape-circle':
        setActiveTool('shape-circle');
        canvas.setTool('shape-circle');
        canvas.clearSelection();
        break;
      case 'shape-triangle':
        setActiveTool('shape-triangle');
        canvas.setTool('shape-triangle');
        canvas.clearSelection();
        break;
      case 'shape-star':
        setActiveTool('shape-star');
        canvas.setTool('shape-star');
        canvas.clearSelection();
        break;
      // 形状工具 - 标注形状
      case 'shape-bubble':
        setActiveTool('shape-bubble');
        canvas.setTool('shape-bubble');
        canvas.clearSelection();
        break;
      case 'shape-arrow-left':
        setActiveTool('shape-arrow-left');
        canvas.setTool('shape-arrow-left');
        canvas.clearSelection();
        break;
      case 'shape-arrow-right':
        setActiveTool('shape-arrow-right');
        canvas.setTool('shape-arrow-right');
        canvas.clearSelection();
        break;
      case 'text':
        setActiveTool('text');
        canvas.setTool('text');
        canvas.clearSelection();
        break;
      case 'pen':
        canvas.setTool('pen');
        canvas.clearSelection(); // 操作后取消选择
        break;
      case 'image':
        canvas.addImageGenerator();
        canvas.clearSelection(); // 操作后取消选择
        // 使用完后自动回到选择功能
        setTimeout(() => {
          setActiveTool('select');
          canvas.setTool('select');
        }, 100);
        break;
      case 'video':
        canvas.addVideoGenerator();
        canvas.clearSelection(); // 操作后取消选择
        // 使用完后自动回到选择功能
        setTimeout(() => {
          setActiveTool('select');
          canvas.setTool('select');
        }, 100);
        break;
      case 'export':
        canvas.exportAsImage();
        canvas.clearSelection(); // 操作后取消选择
        // 使用完后自动回到选择功能
        setTimeout(() => {
          setActiveTool('select');
          canvas.setTool('select');
        }, 100);
        break;
      case 'crop':
        canvas.clearSelection(); // 操作后取消选择
        break;
    }
  }, [canvas]);

  const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !canvasContainerRef.current) return;
    
    // #887 鉴权终极加固：未登录时前置拦截上传
    if (!isLoggedIn) {
      setAuthModalOpen(true);
      e.target.value = '';
      return;
    }
    
    // #621 右键上传模式：不偏移、不居中，放在右击位置
    const contextMenuTarget = contextMenuUploadTargetRef.current;
    contextMenuUploadTargetRef.current = null; // 立即清除，一次性使用
    
    // 分离图片和视频文件
    const imageFiles: File[] = [];
    const videoFiles: File[] = [];
    for (const file of Array.from(files)) {
      if (file.type.startsWith('video/')) {
        videoFiles.push(file);
      } else {
        imageFiles.push(file);
      }
    }
    
    if (videoFiles.length === 0 && imageFiles.length === 0) {
      e.target.value = '';
      return;
    }
    
    const container = canvasContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    const effectiveContainerWidth = containerRect.width || 1920;
    const effectiveContainerHeight = containerRect.height || 826;
    
    // #666 提取视频首帧缩略图的辅助函数
    const extractVideoThumbnail = (video: HTMLVideoElement): Promise<Blob | null> => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.warn('[首帧提取] 超时');
          cleanup();
          resolve(null);
        }, 5000);
        
        const cleanup = () => {
          clearTimeout(timeout);
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('error', onError);
        };
        
        const onSeeked = () => {
          cleanup();
          try {
            const cvs = document.createElement('canvas');
            const w = video.videoWidth || 320;
            const h = video.videoHeight || 180;
            if (w <= 0 || h <= 0) { resolve(null); return; }
            const maxDim = 320;
            const scale = Math.min(1, maxDim / Math.max(w, h));
            cvs.width = Math.round(w * scale);
            cvs.height = Math.round(h * scale);
            const ctx = cvs.getContext('2d');
            if (!ctx) { resolve(null); return; }
            ctx.drawImage(video, 0, 0, cvs.width, cvs.height);
            cvs.toBlob((blob) => { resolve(blob); }, 'image/jpeg', 0.8);
          } catch (err) {
            console.error('[首帧提取] 失败:', err);
            resolve(null);
          }
        };
        
        const onError = () => {
          cleanup();
          console.error('[首帧提取] 视频加载错误');
          resolve(null);
        };
        
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', onError);
        video.currentTime = 0.1;
      });
    };
    
    // ====== #666 并行读取所有文件尺寸（视频+图片统一编排）======
    interface VideoUploadInfo {
      file: File;
      width: number;
      height: number;
      blobUrl: string;
      thumbnailBlob: Blob | null;
      thumbnailBlobUrl: string | undefined;
      elementId?: string;
    }
    
    interface ImageUploadInfo {
      file: File;
      width: number;
      height: number;
      blobUrl: string;
      elementId?: string;
    }
    
    const [videoInfos, imageInfos] = await Promise.all([
      // 视频尺寸读取（并行）
      Promise.all(videoFiles.map(async (file): Promise<VideoUploadInfo> => {
        const blobUrl = URL.createObjectURL(file);
        const videoEl = document.createElement('video');
        
        return new Promise((resolve) => {
          const onLoadedData = async () => {
            videoEl.removeEventListener('loadeddata', onLoadedData);
            videoEl.removeEventListener('error', onError);
            
            const vw = videoEl.videoWidth || 1920;
            const vh = videoEl.videoHeight || 1080;
            
            let thumbnailBlob: Blob | null = null;
            let thumbnailBlobUrl: string | undefined = undefined;
            try {
              thumbnailBlob = await extractVideoThumbnail(videoEl);
              if (thumbnailBlob) {
                thumbnailBlobUrl = URL.createObjectURL(thumbnailBlob);
              }
            } catch (err) {
              console.error('[视频上传] 首帧提取异常:', err);
            }
            
            resolve({ file, width: vw, height: vh, blobUrl, thumbnailBlob, thumbnailBlobUrl });
          };
          
          const onError = () => {
            videoEl.removeEventListener('loadeddata', onLoadedData);
            videoEl.removeEventListener('error', onError);
            resolve({ file, width: 1920, height: 1080, blobUrl, thumbnailBlob: null, thumbnailBlobUrl: undefined });
          };
          
          videoEl.addEventListener('loadeddata', onLoadedData);
          videoEl.addEventListener('error', onError);
          videoEl.preload = 'auto';
          videoEl.src = blobUrl;
          videoEl.muted = true;
        });
      })),
      
      // 图片尺寸读取（并行）
      Promise.all(imageFiles.map(async (file): Promise<ImageUploadInfo> => {
        const blobUrl = URL.createObjectURL(file);
        const img = new window.Image();
        
        return new Promise((resolve) => {
          img.onload = () => {
            resolve({ file, width: img.naturalWidth, height: img.naturalHeight, blobUrl });
          };
          img.onerror = () => {
            resolve({ file, width: 200, height: 150, blobUrl });
          };
          img.src = blobUrl;
        });
      })),
    ]);
    
    // ====== #666 统一计算布局（视频+图片作为一个组）======
    const { calculateImageGroupLayout } = await import('@/lib/canvas-image-layout');
    
    const allDimensions = [
      ...videoInfos.map(v => ({ width: v.width, height: v.height })),
      ...imageInfos.map(i => ({ width: i.width, height: i.height })),
    ];
    
    const layout = calculateImageGroupLayout({
      imageCount: allDimensions.length,
      imageDimensions: allDimensions,
      containerWidth: effectiveContainerWidth,
      containerHeight: effectiveContainerHeight,
      currentZoom: zoom,
    });
    
    // ====== 空白检测偏移（只检查画布现有元素，不包括当前批次）======
    let targetLeft: number;
    let targetTop: number;
    
    if (contextMenuTarget) {
      // #621 右键上传模式：以右击位置为中心
      targetLeft = contextMenuTarget.canvasX - layout.totalWidth / 2;
      targetTop = contextMenuTarget.canvasY - layout.totalHeight / 2;
    } else {
      // 普通上传：画布中心 + 空白检测偏移
      targetLeft = CANVAS_WIDTH / 2 - layout.totalWidth / 2;
      targetTop = CANVAS_HEIGHT / 2 - layout.totalHeight / 2;
      
      // 空白检测：只检测当前画布上已有的 image/video 元素
      const existingImages: { left: number; top: number; right: number; bottom: number; id: string }[] = [];
      const allElements = canvas.state.elements || [];
      
      allElements.forEach((el: any) => {
        if ((el.type === 'image' || el.type === 'video') && el.width > 0 && el.height > 0) {
          existingImages.push({
            id: el.id,
            left: el.x,
            top: el.y,
            right: el.x + el.width,
            bottom: el.y + el.height,
          });
        }
      });
      
      const recentlyAdded = recentlyAddedImagesRef.current;
      const allExistingImages = [...existingImages, ...recentlyAdded.map((img, idx) => ({
        id: `recent-${idx}`,
        ...img
      }))];
      
      const isOverlapping = (groupLeft: number, groupTop: number): boolean => {
        const groupRight = groupLeft + layout.totalWidth;
        const groupBottom = groupTop + layout.totalHeight;
        return allExistingImages.some(img =>
          !(groupRight <= img.left || groupLeft >= img.right || groupBottom <= img.top || groupTop >= img.bottom)
        );
      };
      
      if (isOverlapping(targetLeft, targetTop)) {
        const offsets = IMAGE_OVERLAP_OFFSETS;
        let foundSpace = false;
        
        // 优先级：上 → 下 → 左 → 右
        for (const offset of offsets) {
          const newTop = targetTop - offset;
          if (newTop >= 0 && !isOverlapping(targetLeft, newTop)) {
            targetTop = newTop; foundSpace = true; break;
          }
        }
        if (!foundSpace) {
          for (const offset of offsets) {
            const newTop = targetTop + offset;
            if (newTop + layout.totalHeight <= CANVAS_HEIGHT && !isOverlapping(targetLeft, newTop)) {
              targetTop = newTop; foundSpace = true; break;
            }
          }
        }
        if (!foundSpace) {
          for (const offset of offsets) {
            const newLeft = targetLeft - offset;
            if (newLeft >= 0 && !isOverlapping(newLeft, targetTop)) {
              targetLeft = newLeft; foundSpace = true; break;
            }
          }
        }
        if (!foundSpace) {
          for (const offset of offsets) {
            const newLeft = targetLeft + offset;
            if (newLeft + layout.totalWidth <= CANVAS_WIDTH && !isOverlapping(newLeft, targetTop)) {
              targetLeft = newLeft; foundSpace = true; break;
            }
          }
        }
      }
    }
    
    // 边界检查
    let finalLeft = targetLeft;
    let finalTop = targetTop;
    if (finalLeft < 0) finalLeft = 0;
    if (finalTop < 0) finalTop = 0;
    if (finalLeft + layout.totalWidth > CANVAS_WIDTH) finalLeft = CANVAS_WIDTH - layout.totalWidth;
    if (finalTop + layout.totalHeight > CANVAS_HEIGHT) finalTop = CANVAS_HEIGHT - layout.totalHeight;
    
    // ====== #666 统一添加到画布（视频+图片一起，乐观 UI）======
    // 记录新元素位置到 ref（用于后续上传的空白检测）
    const newImagePositions: { left: number; top: number; right: number; bottom: number }[] = [];
    
    // 添加视频元素（乐观 UI）
    let layoutIndex = 0;
    for (const info of videoInfos) {
      const imgLayout = layout.images[layoutIndex];
      const videoX = finalLeft + imgLayout.x;
      const videoY = finalTop + imgLayout.y;
      
      const addedId = canvas.addElement({
        type: 'video' as any,
        name: info.file.name.replace(/\.[^/.]+$/, ''),
        x: videoX,
        y: videoY,
        width: imgLayout.width,
        height: imgLayout.height,
        rotation: 0,
        fill: 'transparent',
        stroke: 'transparent',
        strokeWidth: 0,
        opacity: 1,
        visible: true,
        locked: false,
        videoUrl: info.blobUrl,
        videoKey: undefined,
        thumbnailUrl: info.thumbnailBlobUrl,
        thumbnailKey: undefined,
        isLoading: true,  // #666 乐观 UI
        sourceType: 'upload',
        aspectRatio: info.width / info.height,
        naturalWidth: info.width,
        naturalHeight: info.height,
      } as any);
      info.elementId = addedId;
      newImagePositions.push({ left: videoX, top: videoY, right: videoX + imgLayout.width, bottom: videoY + imgLayout.height });
      layoutIndex++;
    }
    
    // 添加图片元素（乐观 UI）
    for (const info of imageInfos) {
      const imgLayout = layout.images[layoutIndex];
      const imgX = finalLeft + imgLayout.x;
      const imgY = finalTop + imgLayout.y;
      
      const addedId = canvas.addElement({
        type: 'image' as any,
        name: info.file.name.replace(/\.[^/.]+$/, ''),
        x: imgX,
        y: imgY,
        width: imgLayout.width,
        height: imgLayout.height,
        rotation: 0,
        fill: 'transparent',
        stroke: 'transparent',
        strokeWidth: 0,
        opacity: 1,
        visible: true,
        locked: false,
        imageUrl: info.blobUrl,  // #666 先用 blob URL 预览
        imageKey: undefined,
        isLoading: true,  // #666 乐观 UI
        sourceType: 'upload',
        aspectRatio: info.width / info.height,
        naturalWidth: info.width,
        naturalHeight: info.height,
      } as any);
      info.elementId = addedId;
      newImagePositions.push({ left: imgX, top: imgY, right: imgX + imgLayout.width, bottom: imgY + imgLayout.height });
      layoutIndex++;
    }
    
    // 更新最近添加位置 ref
    recentlyAddedImagesRef.current = [...recentlyAddedImagesRef.current, ...newImagePositions].slice(-100);
    
    // ====== #666 统一切换镜头一次 ======
    if (!contextMenuTarget) {
      const groupCenterX = finalLeft + layout.totalWidth / 2;
      const groupCenterY = finalTop + layout.totalHeight / 2;
      setZoom(layout.zoom);
      setPan({ 
        x: effectiveContainerWidth / 2 - groupCenterX * layout.zoom, 
        y: effectiveContainerHeight / 2 - groupCenterY * layout.zoom 
      });
    }
    
    // ====== #666 后台并行上传 COS（带内存释放 + 异常回滚）======
    await Promise.all([
      // 视频上传
      ...videoInfos.map(async (info, idx) => {
        try {
          // 服务端中转上传 COS
          const formData = new FormData();
          formData.append('file', info.file);
          const uploadResponse = await fetch('/api/canvas/upload', { method: 'POST', body: formData });
          const uploadData = await safeJsonResponse<{ key?: string; url?: string }>(uploadResponse);
          
          if (uploadData.success && info.elementId) {
            // 上传缩略图
            let thumbnailUrl: string | undefined = undefined;
            let thumbnailKey: string | undefined = undefined;
            if (info.thumbnailBlob) {
              try {
                const thumbFile = new File([info.thumbnailBlob], `thumb_${idx}.jpg`, { type: 'image/jpeg' });
                const thumbFormData = new FormData();
                thumbFormData.append('file', thumbFile);
                const thumbRes = await fetch('/api/canvas/upload', { method: 'POST', body: thumbFormData });
                const thumbData = await safeJsonResponse<{ key?: string; url?: string }>(thumbRes);
                if (thumbData.success) {
                  thumbnailUrl = `/api/canvas/image?key=${encodeURIComponent(thumbData.key ?? '')}`;
                  thumbnailKey = thumbData.key;
                }
              } catch (thumbErr) {
                console.error(`[视频上传] 缩略图 ${idx + 1} 上传失败:`, thumbErr);
              }
            }
            
            // #667 修复 React 闭包陷阱：异步回调中必须使用 stateRef 获取最新元素
            const elementStillExists = canvas.stateRef.current.elements.some((e: any) => e.id === info.elementId);
            if (elementStillExists) {
              canvas.updateElement(info.elementId, {
                videoKey: uploadData.key,
                thumbnailUrl,
                thumbnailKey,
                isLoading: false,
              } as any);
            }
            
            // #669 任务二：缓释内存，延迟 5 秒释放缩略图 blob URL（避免闪烁）
            if (info.thumbnailBlobUrl) {
              const thumbUrl = info.thumbnailBlobUrl;  // 闭包捕获
              setTimeout(() => {
                try { URL.revokeObjectURL(thumbUrl); } catch {}
              }, 5000);
            }
          } else {
            // COS 上传失败：删除临时元素 + 释放内存 + 报错
            console.error(`[视频上传] ${idx + 1} 上传失败:`, uploadData);
            const errorMsg = uploadData?.error || '服务器错误';
            if (info.elementId) {
              canvas.deleteElement(info.elementId);
            }
            // #669 任务二：缓释内存，延迟 5 秒释放 blob URL（避免闪烁）
            const blobUrl = info.blobUrl;
            const thumbUrl = info.thumbnailBlobUrl;
            setTimeout(() => {
              try { URL.revokeObjectURL(blobUrl); } catch {}
              if (thumbUrl) { try { URL.revokeObjectURL(thumbUrl); } catch {} }
            }, 5000);
            toast.error(`${info.file.name} 上传失败: ${errorMsg}`);
          }
        } catch (err) {
          console.error(`[视频上传] ${idx + 1} 异常:`, err);
          // 删除临时元素 + 释放内存 + 报错
          if (info.elementId) {
            canvas.deleteElement(info.elementId);
          }
          // #669 任务二：缓释内存，延迟 5 秒释放 blob URL（避免闪烁）
          const blobUrl = info.blobUrl;
          const thumbUrl = info.thumbnailBlobUrl;
          setTimeout(() => {
            try { URL.revokeObjectURL(blobUrl); } catch {}
            if (thumbUrl) { try { URL.revokeObjectURL(thumbUrl); } catch {} }
          }, 5000);
          const errMsg = err instanceof Error ? err.message : '网络异常';
          toast.error(`${info.file.name} 上传失败: ${errMsg}`);
        }
      }),
      
      // 图片上传
      ...imageInfos.map(async (info) => {
        try {
          // 先存储到 IndexedDB（用于本地快速预览和刷新恢复）
          const { storeImage: storeImageToDb } = await import('@/lib/canvas-image-db');
          const dbId = await storeImageToDb(info.file, info.file.type);
          
          // #667 修复 React 闭包陷阱：异步回调中必须使用 stateRef 获取最新元素
          const elementStillExists1 = canvas.stateRef.current.elements.some((e: any) => e.id === info.elementId);
          if (elementStillExists1 && info.elementId) {
            canvas.updateElement(info.elementId, { dbId } as any);
          }
          
          // 服务端中转上传 COS
          const formData = new FormData();
          formData.append('file', info.file);
          const uploadResponse = await fetch('/api/canvas/upload', { method: 'POST', body: formData });
          const uploadData = await safeJsonResponse<{ key?: string; url?: string }>(uploadResponse);
          
          if (uploadData.success && info.elementId) {
            // #667 修复 React 闭包陷阱：异步回调中必须使用 stateRef 获取最新元素
            const elementStillExists2 = canvas.stateRef.current.elements.some((e: any) => e.id === info.elementId);
            if (elementStillExists2) {
              // #676 静默预加载策略：先在后台加载云端图片，缓存完成后再更新状态，彻底消除 blobUrl→cloudUrl 切换闪烁
              const cloudUrl = `/api/canvas/image?key=${encodeURIComponent(uploadData.key ?? '')}`;
              const elementId = info.elementId;  // 闭包捕获，避免 TS 类型问题
              const imageKey = uploadData.key;
              const preloader = document.createElement('img') as HTMLImageElement;
              preloader.src = cloudUrl;
              preloader.onload = () => {
                // 云端图片已缓存，此时切换 src 浏览器秒读缓存，绝不闪烁
                const elementStillExists3 = canvas.stateRef.current.elements.some((e: any) => e.id === elementId);
                if (elementStillExists3) {
                  canvas.updateElement(elementId, {
                    imageUrl: cloudUrl,  // 替换为 COS 签名 URL
                    imageKey: imageKey,
                    isLoading: false,
                  } as any);
                }
              };
              preloader.onerror = () => {
                // 预加载失败（网络波动），也要兜底更新状态避免卡死
                console.warn('[图片上传] 云端图片预加载失败，兜底更新状态:', cloudUrl);
                const elementStillExists3 = canvas.stateRef.current.elements.some((e: any) => e.id === elementId);
                if (elementStillExists3) {
                  canvas.updateElement(elementId, {
                    imageUrl: cloudUrl,
                    imageKey: imageKey,
                    isLoading: false,
                  } as any);
                }
              };
            }
            
            // #669 任务二：缓释内存，延迟 8 秒释放 blob URL（配合静默预加载，给予更充裕的缓存时间）
            // 预加载完成后浏览器已缓存云端图片，此时销毁 blobUrl 不会造成任何闪烁
            const blobUrl = info.blobUrl;
            setTimeout(() => {
              try { URL.revokeObjectURL(blobUrl); } catch {}
            }, 8000);
          } else {
            // COS 上传失败：删除临时元素 + 释放内存 + 报错
            console.error('[图片上传] 上传失败:', uploadData);
            const errorMsg = uploadData?.error || '服务器错误';
            if (info.elementId) {
              canvas.deleteElement(info.elementId);
            }
            // #669 任务二：缓释内存，延迟 5 秒释放
            const blobUrl = info.blobUrl;
            setTimeout(() => {
              try { URL.revokeObjectURL(blobUrl); } catch {}
            }, 5000);
            toast.error(`${info.file.name} 上传失败: ${errorMsg}`);
          }
        } catch (err) {
          console.error('[图片上传] 异常:', err);
          // 删除临时元素 + 释放内存 + 报错
          if (info.elementId) {
            canvas.deleteElement(info.elementId);
          }
          // #669 任务二：缓释内存，延迟 5 秒释放
          const blobUrl = info.blobUrl;
          setTimeout(() => {
            try { URL.revokeObjectURL(blobUrl); } catch {}
          }, 5000);
          const errMsg = err instanceof Error ? err.message : '网络异常';
          toast.error(`${info.file.name} 上传失败: ${errMsg}`);
        }
      }),
    ]);
    
    e.target.value = '';
  }, [canvas, pan, zoom, CANVAS_WIDTH, CANVAS_HEIGHT, isLoggedIn]);

  // ====== 分割图片自动添加到画布 ======
  const handleAddSplitImagesToCanvas = useCallback(async (splitImages: string[]) => {
    if (!canvasContainerRef.current || splitImages.length === 0) return;
    
    // #M6 修复：追踪blob URL，确保异常路径也能释放内存
    let blobUrlsToCleanup: string[] = [];
    
    try {
      const containerRect = canvasContainerRef.current.getBoundingClientRect();
      
      // 🔧 #129 修复：如果容器尺寸为 0，使用默认值
      const effectiveWidth = containerRect.width || 1920;
      const effectiveHeight = containerRect.height || 826;
      
      // 🔧 #142 优化：先将 base64 转为 blob URL 用于本地预览（瞬间完成）
      const localUrls = splitImages.map(base64 => {
        try {
          const byteString = atob(base64.split(',')[1]);
          const mimeString = base64.split(',')[0].split(':')[1].split(';')[0];
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([ab], { type: mimeString });
          const blobUrl = URL.createObjectURL(blob);
          blobUrlsToCleanup.push(blobUrl);  // #M6 追踪
          return blobUrl;
        } catch {
          return base64; // 如果转换失败，直接使用原数据
        }
      });
      
      // ====== 获取每张图片的实际尺寸 ======
      const imageDimensions = await Promise.all(localUrls.map(src => getImageDimensionsWithRetryCore(src)));
      
      // ====== 使用统一布局计算函数 ======
      const { calculateImageGroupLayout } = await import('@/lib/canvas-image-layout');
      
      const layout = calculateImageGroupLayout({
        imageCount: splitImages.length,
        imageDimensions,
        containerWidth: effectiveWidth,
        containerHeight: effectiveHeight,
        currentZoom: zoom, // 🔧 #145 修复：和 handleFileImport 保持一致
      });
      
      // ====== 获取画布上现有的图片和视频元素 ======
      const existingImages: { left: number; top: number; right: number; bottom: number }[] = [];
      canvas.state.elements
        .filter(el => el.type === 'image' || el.type === 'video')
        .forEach(el => {
          existingImages.push({
            left: el.x,
            top: el.y,
            right: el.x + el.width,
            bottom: el.y + el.height,
          });
        });
      
      // 图片放在画布中心 (CANVAS_WIDTH/2, CANVAS_HEIGHT/2)
      let targetLeft = CANVAS_WIDTH / 2 - layout.totalWidth / 2;
      let targetTop = CANVAS_HEIGHT / 2 - layout.totalHeight / 2;
      
      // ====== 空白检测偏移 ======
      const isOverlapping = (groupLeft: number, groupTop: number): boolean => {
        const groupRight = groupLeft + layout.totalWidth;
        const groupBottom = groupTop + layout.totalHeight;
        
        for (const img of existingImages) {
          const overlaps = !(groupRight <= img.left || 
                           groupLeft >= img.right || 
                           groupBottom <= img.top || 
                           groupTop >= img.bottom);
          if (overlaps) return true;
        }
        return false;
      };
      
      let finalLeft = targetLeft;
      let finalTop = targetTop;
      
      if (isOverlapping(targetLeft, targetTop)) {
        const offsets = IMAGE_OVERLAP_OFFSETS;
        let foundSpace = false;
        
        // 优先级：上 → 下 → 左 → 右
        for (const offset of offsets) {
          const newTop = targetTop - offset;
          if (newTop >= 0 && !isOverlapping(targetLeft, newTop)) {
            finalLeft = targetLeft;
            finalTop = newTop;
            foundSpace = true;
            break;
          }
        }
        
        if (!foundSpace) {
          for (const offset of offsets) {
            const newTop = targetTop + offset;
            if (newTop + layout.totalHeight <= CANVAS_HEIGHT && !isOverlapping(targetLeft, newTop)) {
              finalLeft = targetLeft;
              finalTop = newTop;
              foundSpace = true;
              break;
            }
          }
        }
        
        if (!foundSpace) {
          for (const offset of offsets) {
            const newLeft = targetLeft - offset;
            if (newLeft >= 0 && !isOverlapping(newLeft, targetTop)) {
              finalLeft = newLeft;
              finalTop = targetTop;
              foundSpace = true;
              break;
            }
          }
        }
        
        if (!foundSpace) {
          for (const offset of offsets) {
            const newLeft = targetLeft + offset;
            if (newLeft + layout.totalWidth <= CANVAS_WIDTH && !isOverlapping(newLeft, targetTop)) {
              finalLeft = newLeft;
              finalTop = targetTop;
              foundSpace = true;
              break;
            }
          }
        }
      }
      
      // 边界检查
      if (finalLeft < 0) finalLeft = 0;
      if (finalTop < 0) finalTop = 0;
      if (finalLeft + layout.totalWidth > CANVAS_WIDTH) finalLeft = CANVAS_WIDTH - layout.totalWidth;
      if (finalTop + layout.totalHeight > CANVAS_HEIGHT) finalTop = CANVAS_HEIGHT - layout.totalHeight;
      
      // ====== 添加分割图片（使用本地 blob URL，瞬间显示）======
      const elementIds: string[] = [];
      localUrls.forEach((imgUrl, i) => {
        const imgLayout = layout.images[i];
        const imgX = finalLeft + imgLayout.x;
        const imgY = finalTop + imgLayout.y;
        
        const elementId = canvas.addElement({
          type: 'image',
          name: `分割区域 ${i + 1}`,
          x: imgX,
          y: imgY,
          width: imgLayout.width,
          height: imgLayout.height,
          rotation: 0,
          fill: 'transparent',
          stroke: 'transparent',
          strokeWidth: 0,
          opacity: 1,
          visible: true,
          locked: false,
          imageUrl: imgUrl,
          imageKey: undefined, // 先不设置，等 COS 上传完成后再更新
          sourceType: 'split',
          naturalWidth: imageDimensions[i].width,
          naturalHeight: imageDimensions[i].height,
        });
        elementIds.push(elementId);
      });
      
      // ====== 后台静默上传 COS（不阻塞用户操作）======
      fetch('/api/canvas/upload-base64', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: splitImages }),
      })
        .then(async res => {
          // #887 鉴权终极加固：401 立即截断
          if (res.status === 401) {
            window.dispatchEvent(new CustomEvent('openLogin'));
            throw new Error('登录已过期');
          }
          return res.json();
        })
        .then(uploadData => {
          if (uploadData.success && uploadData.images?.length > 0) {
            const cosUrls = uploadData.images.map((img: { key: string; url: string }) => img.url);
            const imageKeys = uploadData.images.map((img: { key: string; url: string }) => img.key);
            
            // 更新元素的 imageUrl 和 imageKey
            elementIds.forEach((elementId, i) => {
              // #667 修复 React 闭包陷阱：异步回调中必须使用 stateRef 获取最新元素
              const element = (canvas.stateRef.current.elements || canvas.state.elements).find(el => el.id === elementId);
              if (element) {
                canvas.updateElement(elementId, {
                  imageUrl: cosUrls[i],
                  imageKey: imageKeys[i],
                });
              }
            });
            
            // #150 Local-First：将 base64 转 Blob 存入 IndexedDB（后台异步，不阻塞）
            import('@/lib/canvas-image-db').then(({ storeImageByKey }) => {
              splitImages.forEach((base64, i) => {
                const imageKey = imageKeys[i];
                if (!imageKey) return;
                
                try {
                  // base64 转 Blob
                  const byteString = atob(base64.split(',')[1]);
                  const mimeString = base64.split(',')[0].split(':')[1].split(';')[0];
                  const ab = new ArrayBuffer(byteString.length);
                  const ia = new Uint8Array(ab);
                  for (let j = 0; j < byteString.length; j++) {
                    ia[j] = byteString.charCodeAt(j);
                  }
                  const blob = new Blob([ab], { type: mimeString });
                  
                  // 存入 IndexedDB（幂等，已存在会跳过）
                  storeImageByKey(imageKey, blob, mimeString).catch(console.error);
                } catch (err) {
                  console.error('[分割] #150 缓存失败:', imageKey, err);
                }
              });
            }).catch(console.error);
            
            // #149 修复：强制保存到 localStorage，确保刷新后图片不丢失
            canvas.forceSaveToStorage();
            
            // 释放 blob URL 内存
            localUrls.forEach(url => {
              try { URL.revokeObjectURL(url); } catch {}
            });
            blobUrlsToCleanup = [];  // #M6 已释放，清空追踪
            
            // ====== #232 Sprint 3：智能分割保存到数据库 ======
            try {
              const userId = localStorage.getItem('user_id');
              if (userId && imageKeys.length > 0) {
                const uploadedImage = gridUploadedImages[0] || {};
                
                // 🔒 强制使用 taskId（UUID）作为主键，消灭 Date.now()
                const splitTaskId = `split_${crypto.randomUUID()}`;
                
                const record: HistoryRecord = {
                  id: splitTaskId,  // #232: 强制使用 string 类型
                  model: 'gemini-3.1-pro',
                  prompt: `智能分割 - ${imageKeys.length}张图片`,
                  images: cosUrls,
                  image_keys: imageKeys,
                  reference_images: uploadedImage.imageUrl ? [uploadedImage.imageUrl] : [],
                  reference_image_keys: uploadedImage.imageKey ? [uploadedImage.imageKey] : [],
                  resolution: '',
                  aspect_ratio: '',
                  created_at: new Date().toISOString(),
                  source: 'canvas',  // #232: 标记来源
                };
                
                // 调用 API 保存到数据库
                fetch('/api/generation-records', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({
                    task_id: splitTaskId,
                    images: record.images,
                    image_keys: record.image_keys,
                    model: record.model,
                    prompt: record.prompt,
                    reference_images: record.reference_images,
                    reference_image_keys: record.reference_image_keys,
                    source: 'canvas',
                  }),
                })
                  .then(res => res.json())
                  .then(data => {
                    if (data.success) {
                      historyStore.addRecord(record);
                    } else {
                      console.error('[分割] API 返回失败:', data.error);
                    }
                  })
                  .catch(err => console.error('[分割] API 调用失败:', err));
              }
            } catch (recordError) {
              console.error('[分割] 保存记录失败:', recordError);
            }
          }
        })
        .catch(err => {
          console.error('[分割] #142 COS 上传失败:', err);
        });
      
      // ====== 镜头切换 ======
      // 🔧 #145 修复：使用和 handleFileImport 完全一致的镜头切换逻辑
      const groupCenterX = finalLeft + layout.totalWidth / 2;
      const groupCenterY = finalTop + layout.totalHeight / 2;
      const newPanX = effectiveWidth / 2 - groupCenterX * layout.zoom;
      const newPanY = effectiveHeight / 2 - groupCenterY * layout.zoom;
      
      setZoom(layout.zoom);
      setPan({ x: newPanX, y: newPanY });
      
      // 关闭弹窗并重置状态
      setShowGridModal(false);
      setGridLeftCollapsed(false);
      setGridGenerating(false);
      setGridUploadedImages([]);
      setGridSplitImages([]);
      setIsGridSelectMode(false);
    } catch (err) {
      // #M6 修复：异常路径释放未回收的blob URL
      blobUrlsToCleanup.forEach(url => { try { URL.revokeObjectURL(url); } catch {} });
      console.error('[分割] 添加到画布失败:', err);
      showInfo('添加到画布失败', err instanceof Error ? err.message : '未知错误');
      setGridGenerating(false);
    }
  }, [canvas, CANVAS_WIDTH, CANVAS_HEIGHT, showInfo]);

  // 加载九宫格模板到画布中央
  const [showGridModal, setShowGridModal] = useState(false);
  const [gridLeftCollapsed, setGridLeftCollapsed] = useState(false); // 左侧折叠状态
  const [gridGenerating, setGridGenerating] = useState(false); // 生成状态
  const [gridUploading, setGridUploading] = useState(false); // #127 上传加载状态
  const [gridUploadedImages, setGridUploadedImages] = useState<Array<{ imageUrl: string; imageKey: string; base64: string }>>([]); // 上传的图片列表（包含 COS key）
  const [gridSplitImages, setGridSplitImages] = useState<string[]>([]); // 分割后的图片列表
  const [gridSplitCount, setGridSplitCount] = useState(4); // 分割数量
  const [gridRemoveBorders, setGridRemoveBorders] = useState(false); // 是否去除边框
  const [isGridSelectMode, setIsGridSelectMode] = useState(false); // 从画布添加模式（双击选择）
  const [gridSelectMousePos, setGridSelectMousePos] = useState({ x: 0, y: 0 }); // 鼠标位置（用于跟随提示）
  
  // 双击选择模式下的鼠标移动监听
  useEffect(() => {
    if (!isGridSelectMode) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      setGridSelectMousePos({ x: e.clientX, y: e.clientY });
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [isGridSelectMode]);
  
  const loadGridTemplate = useCallback(async () => {
    // 打开智能分割展示弹窗
    setShowGridModal(true);
  }, []);
  
  // 智能压缩图片（只在必要时压缩，尽量保持原图质量）
  const compressBase64IfNeeded = useCallback(async (base64: string): Promise<string> => {
    // 计算 base64 对应的实际大小（base64 比原始数据大约 33%）
    const actualSizeMB = base64.length * 0.75 / 1024 / 1024;
    
    // 沙箱环境请求体限制较严，大于 3MB 就压缩
    if (actualSizeMB <= 3) {
      return base64;
    }
    
    // 大于 3MB 压缩到 2MB 以内
    
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // 保持原分辨率，但限制最大边长（保持清晰度）
        const maxDimension = 2048;
        let width = img.width;
        let height = img.height;
        
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round(height * (maxDimension / width));
            width = maxDimension;
          } else {
            width = Math.round(width * (maxDimension / height));
            height = maxDimension;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);
        
        // 优先使用 WebP 格式（更高效的压缩，质量更好）
        const tryCompress = (format: string, quality: number): Promise<string> => {
          return new Promise((resolve, reject) => {
            canvas.toBlob(
              (blob) => {
                if (!blob) {
                  reject(new Error('图片压缩失败'));
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(new Error('读取压缩图片失败'));
                reader.readAsDataURL(blob!);
              },
              format,
              quality
            );
          });
        };
        
        // 循环压缩直到满足大小要求
        const compressToTarget = async (targetMB: number): Promise<string> => {
          const qualities = [0.9, 0.8, 0.7, 0.6, 0.5];
          
          for (const quality of qualities) {
            const result = await tryCompress('image/webp', quality);
            const resultSizeMB = result.length * 0.75 / 1024 / 1024;
            
            if (resultSizeMB <= targetMB) {
              return result;
            }
          }
          
          // 如果 WebP 都不行，最后尝试 JPEG
          const result = await tryCompress('image/jpeg', 0.7);
          return result;
        };
        
        compressToTarget(2).then(resolve).catch(reject);
      };
      
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = base64;
    });
  }, []);
  
  // 将图片URL转换为base64（解决LLM Vision不支持签名URL的问题）
  // v2: 移除降级方案，直接抛出错误以便调试
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
        
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result);
          };
          reader.onerror = () => reject(new Error('读取图片失败'));
          reader.readAsDataURL(blob);
        });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        console.error('[imageUrlToBase64] fetch 失败:', errorMessage);
        throw error; // 直接抛出错误，不降级
      }
    }
    
    // 其他情况（不应该到达这里）
    console.error('[imageUrlToBase64] 不支持的 URL 格式:', url.substring(0, 50));
    throw new Error('不支持的 URL 格式: ' + url.substring(0, 50));
  }, []);
  
  // 使用 AI 返回的精确坐标切割图片（源码方式）
  // cells 格式: [{ row, col, left, top, right, bottom }] 百分比坐标 (0-100)
  const cropImageByCells = useCallback(async (
    imageSrc: string,
    cells: Array<{ row: number; col: number; left: number; top: number; right: number; bottom: number }>,
    needCrop: boolean
  ): Promise<string[]> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      
      img.onload = () => {
        try {
          const images: string[] = [];
          
          // 按 row, col 排序
          const sortedCells = [...cells].sort((a, b) => {
            if (a.row !== b.row) return a.row - b.row;
            return a.col - b.col;
          });
          
          for (const cell of sortedCells) {
            // 百分比转像素 - 源码方式
            const srcX = (cell.left / 100) * img.width;
            const srcY = (cell.top / 100) * img.height;
            const srcW = ((cell.right - cell.left) / 100) * img.width;
            const srcH = ((cell.bottom - cell.top) / 100) * img.height;
            
            
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(srcW));
            canvas.height = Math.max(1, Math.floor(srcH));
            const ctx = canvas.getContext('2d');
            
            if (ctx) {
              ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
              images.push(canvas.toDataURL('image/png'));
            }
          }
          
          resolve(images);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          reject(new Error('裁剪失败: ' + errorMessage));
        }
      };
      
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = imageSrc;
    });
  }, []);
  
  // ========== 占位符辅助函数（在组件级别定义，供 handleSend 使用）==========

  // 更新单个占位符的函数
  const updatePlaceholder = useCallback(async (taskId: string, imageUrl: string, imageKey?: string, providerUrl?: string) => {
    const elementId = taskIdToElementIdRef.current.get(taskId);
    if (!elementId) {
      console.error('[updatePlaceholder] 未找到 elementId, taskId:', taskId);
      return;
    }
    
    const placeholderSize = placeholderSizeRef.current.get(taskId);
    if (!placeholderSize) {
      console.error('[updatePlaceholder] 未找到 placeholderSize, taskId:', taskId);
      return;
    }

    let naturalWidth: number, naturalHeight: number;
    let usePlaceholderSize = false; // 🔧 #477 标记是否使用占位符尺寸
    
    // 视频URL检测：优先从元素属性判断（sourceType===video），兜底用URL扩展名
    const existingEl = elementId ? canvas.state.elements.find((e: any) => e.id === elementId) : null;
    const isVideoBySourceType = existingEl?.sourceType === 'video' || existingEl?.type === 'video';
    const isVideoByUrl = /\.(mp4|webm|mov|avi)(\?|$)/i.test(imageUrl || '');
    const isVideoUrl = isVideoBySourceType || isVideoByUrl;
    
    try {
      if (isVideoUrl) {
        // 视频 URL 无法用 Image 加载获取尺寸，直接使用占位符尺寸
        naturalWidth = placeholderSize.width;
        naturalHeight = placeholderSize.height;
        usePlaceholderSize = true;
      } else {
        // #760 光速降级机制：直连COS/服务商URL(1次0秒间隔) → 代理URL(1次0秒) → 占位符尺寸
        try {
          // 前端直连香港COS遭遇ERR_CONNECTION_CLOSED网络阻断，第一次失败立刻切换代理
          const dimensions = await getImageDimensionsWithRetryCore(imageUrl, 1, 0);
          naturalWidth = dimensions.width;
          naturalHeight = dimensions.height;
        } catch (directError) {
          // 直连 COS URL 失败（ERR_CONNECTION_CLOSED/CORS），光速切换代理URL
          if (imageKey) {
            const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(imageKey)}`;
            console.warn('[updatePlaceholder] 直连URL失败，光速切换代理URL:', imageKey);
            try {
              const dimensions = await getImageDimensionsWithRetryCore(proxyUrl, 1, 0);
              naturalWidth = dimensions.width;
              naturalHeight = dimensions.height;
            } catch (proxyError) {
              // 代理也失败，抛出给外层 catch
              throw proxyError;
            }
          } else {
            throw directError;
          }
        }
      }
    } catch (error) {
      // 🔧 #477 修复：图片尺寸获取失败时，使用占位符原始尺寸，而不是标记为 failed
      // 这样可以避免返回错误的默认尺寸（200x150）导致图片变形
      console.warn('[updatePlaceholder] 图片尺寸获取失败，使用占位符尺寸:', error);
      naturalWidth = placeholderSize.width;
      naturalHeight = placeholderSize.height;
      usePlaceholderSize = true;
    }

    let newWidth: number, newHeight: number;
    if (naturalWidth > 0 && naturalHeight > 0) {
      const aspectRatio = naturalWidth / naturalHeight;
      if (aspectRatio > placeholderSize.width / placeholderSize.height) {
        newWidth = placeholderSize.width;
        newHeight = newWidth / aspectRatio;
      } else {
        newHeight = placeholderSize.height;
        newWidth = newHeight * aspectRatio;
      }
    } else {
      newWidth = placeholderSize.width;
      newHeight = placeholderSize.height;
    }

    // 🔧 #221 修复：方案 C 双保险策略
    // 第一道防线：使用 stateRef 获取最新元素（支持用户拖动后更新）
    // 第二道防线：使用 placeholderPositionsRef 获取初始坐标（兜底）
    const liveElements = canvas.stateRef?.current?.elements || canvas.state.elements;
    const currentEl = liveElements.find((el: any) => el.id === elementId);
    
    if (currentEl) {
      // 🎯 第一道防线命中：元素存在，使用元素的实时位置计算居中（支持用户拖动）
      const centerX = currentEl.x + currentEl.width / 2;
      const centerY = currentEl.y + currentEl.height / 2;
      const newX = centerX - newWidth / 2;
      const newY = centerY - newHeight / 2;
      
      // 🔧 #477 如果使用了占位符尺寸，保留 naturalWidth/naturalHeight 为占位符尺寸
      // 后续图片加载完成后可以重新更新
      // #725 修复：视频URL时必须同时设置 videoUrl，否则 CanvasVideo 组件读不到视频
      canvas.updateElement(elementId, { 
        imageUrl: providerUrl || imageUrl,  // #525 混合架构：优先服务商URL，极速渲染
        videoUrl: isVideoUrl ? (providerUrl || imageUrl) : undefined,  // #725 视频URL必须设到videoUrl
        imageKey, 
        providerUrl: providerUrl || undefined,  // 存储服务商URL供fallback判断
        generationStatus: 'completed', 
        width: newWidth, 
        height: newHeight, 
        x: newX, 
        y: newY, 
        naturalWidth, 
        naturalHeight 
      });
    } else {
      // 🛡️ 第二道防线：元素不存在，使用 placeholderPositionsRef 初始坐标兜底
      const pos = placeholderPositionsRef.current.get(taskId);
      if (pos) {
        const centerX = (pos.left + pos.right) / 2;
        const centerY = (pos.top + pos.bottom) / 2;
        const newX = centerX - newWidth / 2;
        const newY = centerY - newHeight / 2;
        
        // 🔧 #216 修复：先删除画布上相同 taskId 的旧占位符
        // HMR 后，画布状态可能从 localStorage 恢复了旧占位符，但 taskIdToElementIdRef 映射丢失
        // #218 修复：同时删除 generating 和 failed 状态的占位符
        const oldPlaceholders = liveElements.filter((el: any) => 
          el.generationTaskId === taskId && (el.generationStatus === 'generating' || el.generationStatus === 'failed')
        );
        
        if (oldPlaceholders.length > 0) {
          oldPlaceholders.forEach((el: any) => {
            canvas.deleteElement(el.id);
          });
        }
        
        // 🔧 #208 修复：元素不存在时，尝试重新添加元素到画布
        try {
          const newElementId = canvas.addElement({
            type: 'image',
            name: `生成图片`,
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight,
            rotation: 0,
            fill: 'transparent',
            stroke: '#000000',
            strokeWidth: 1,
            opacity: 1,
            visible: true,
            locked: false,
            imageUrl: providerUrl || imageUrl,  // #525 混合架构：优先服务商URL
            videoUrl: isVideoUrl ? (providerUrl || imageUrl) : undefined,  // #725 视频URL
            imageKey,
            providerUrl: providerUrl || undefined,
            generationStatus: 'completed' as const,
            naturalWidth,
            naturalHeight,
          });
          taskIdToElementIdRef.current.set(taskId, newElementId);
        } catch (addError) {
          console.error('[updatePlaceholder] 重新添加元素失败:', addError);
        }
      } else {
        // 彻底凉了：连初始坐标都找不到
        console.error('[updatePlaceholder] 彻底失败: 元素不存在且无初始坐标, elementId=', elementId, ', taskId=', taskId);
      }
    }
    
    // #150 Local-First：后台异步缓存图片到 IndexedDB
    // 只有有 imageKey 时才缓存（COS 图片）
    // #525 混合架构：直连COS失败时用代理URL降级缓存
    if (imageKey && imageUrl) {
      import('@/lib/canvas-image-db').then(({ storeImageByKey }) => {
        // 查重防刷：storeImageByKey 内部会检查 key 是否已存在
        // #525 降级链：先尝试直连URL，失败后用代理URL
        const tryCache = (url: string, isProxy: boolean = false) => {
          fetch(url, { credentials: 'include' })
            .then(res => res.blob())
            .then(blob => {
              if (blob && blob.size > 0) {
                storeImageByKey(imageKey, blob, blob.type).catch(console.error);
              }
            })
            .catch(err => {
              if (!isProxy && imageKey) {
                // 直连失败，尝试代理URL降级
                const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(imageKey)}`;
                console.warn('[updatePlaceholder] #150 直连缓存失败，尝试代理URL:', imageKey);
                tryCache(proxyUrl, true);
              } else {
                console.error('[updatePlaceholder] #150 后台缓存失败:', imageKey, err);
              }
            });
        };
        tryCache(imageUrl);
      }).catch(console.error);
    }
    
    placeholderPositionsRef.current.delete(taskId);
  }, [canvas]);

  // 标记占位符失败
  const markPlaceholderFailed = useCallback((taskId: string, error: string) => {
    const elementId = taskIdToElementIdRef.current.get(taskId);
    if (!elementId) return;
    canvas.updateElement(elementId, { generationStatus: 'failed', generationError: error });
    placeholderPositionsRef.current.delete(taskId);
    // #508 违规失败时刷新用户信息以更新 failedAttempts，触发违规弹窗
    if (error.includes('违规') || error.includes('违反') || error.includes('政策') || error.includes('PROHIBITED')) {
      refreshUserInfo(true);
    }
  }, [canvas, refreshUserInfo]);

  // 创建占位符并返回 PlaceholderInfo[]
  // #093 修复：增加 taskId 参数，让占位符在创建时就有 generationTaskId
  // #129 修复：增加 options 参数支持 sourceType
  const createPlaceholdersWithClientIds = useCallback((
    clientIds: string[], 
    prompt: string, 
    taskId: string,
    options?: { 
      sourceType?: 'generate' | 'split' | 'video';  // #632 添加 video 类型
      namePrefix?: string;                  // 默认使用 prompt 截断
      imageDimensions?: { width: number; height: number }[];  // 🔧 #135 实际图片尺寸
      ratio?: string;  // 🔧 #458 用户选择的比例
    }
  ): { id: string; index: number; x: number; y: number; width: number; height: number }[] => {
    if (!canvasContainerRef.current) return [];

    const sourceType = options?.sourceType || 'generate';
    const namePrefix = options?.namePrefix || `${prompt.substring(0, 15)}${prompt.length > 15 ? '...' : ''}`;

    // 🔧 #130 修复：确保 zoom 有效
    const safeZoom = Math.max(0.1, zoom || 0.1);
    
    let containerRect = canvasContainerRef.current.getBoundingClientRect();
    
    // 🔧 #129 修复：如果容器尺寸为 0，使用默认值（React 生命周期问题）
    if (containerRect.width === 0 || containerRect.height === 0) {
      console.warn('[占位符] 容器尺寸为 0，使用默认值');
      containerRect = {
        ...containerRect,
        width: 1920,
        height: 826,
      } as DOMRect;
    }

    const imageCount = clientIds.length;

    // ====== 使用统一布局计算函数 ======
    const { calculateImageGroupLayout } = require('@/lib/canvas-image-layout');
    
    // 🔧 #458 修复：优先使用传入的 ratio，否则使用 selectedRatio
    // 🔧 #135 修复：分割时使用实际图片尺寸，不使用 ratio
    const layout = calculateImageGroupLayout({
      imageCount,
      imageDimensions: options?.imageDimensions,  // 传入实际图片尺寸
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
      currentZoom: safeZoom,
      ratio: options?.imageDimensions ? undefined : (options?.ratio || selectedRatio),  // 🔧 #458 优先使用传入的 ratio
    });

    // ====== 空白检测 ======
    const existingImages: { left: number; top: number; right: number; bottom: number }[] = [];
    canvas.state.elements.filter(el => el.type === 'image' || el.type === 'video').forEach(el => existingImages.push({ left: el.x, top: el.y, right: el.x + el.width, bottom: el.y + el.height }));
    placeholderPositionsRef.current.forEach(pos => existingImages.push(pos));

    // 🔧 #130 修复：使用 safeZoom 防止除以 0
    const viewCenterX = (containerRect.width / 2 - pan.x) / safeZoom;
    const viewCenterY = (containerRect.height / 2 - pan.y) / safeZoom;
    let finalLeft = viewCenterX - layout.totalWidth / 2;
    // 始终以视口中心为起点，由 calculateOverlapOffset 处理重叠偏移
    let finalTop = viewCenterY - layout.totalHeight / 2;

    // 空白检测偏移
    const { left: offsetLeft, top: offsetTop } = calculateOverlapOffset(
      finalLeft,
      finalTop,
      layout.totalWidth,
      layout.totalHeight,
      existingImages
    );
    finalLeft = offsetLeft;
    finalTop = offsetTop;

    // ====== 创建占位符 ======
    const placeholders: { id: string; index: number; x: number; y: number; width: number; height: number }[] = [];
    clientIds.forEach((clientId, i) => {
      const imgLayout = layout.images[i];
      
      // 🔧 #130 修复：防御性检查，确保布局数据有效
      const safeWidth = Math.max(10, imgLayout?.width || 100);
      const safeHeight = Math.max(10, imgLayout?.height || 100);
      const safeAspectRatio = safeHeight > 0 ? safeWidth / safeHeight : 1;
      
      const imgX = finalLeft + (imgLayout?.x || 0);
      const imgY = finalTop + (imgLayout?.y || 0);
      
      // #7xx 修复：视频占位符创建 video 类型元素，使用 CanvasVideo 组件渲染
      // 根据 sourceType 决定元素类型：video → type: 'video'，其他 → type: 'image'
      const elementType = sourceType === 'video' ? 'video' : 'image';
      
      const elementId = canvas.addElement({
        type: elementType,  // #7xx 视频模式使用 video 类型，启用 CanvasVideo 组件
        name: sourceType === 'split' ? `分割区域 ${i + 1}` : `${namePrefix} #${i + 1}`,
        x: imgX, y: imgY, width: safeWidth, height: safeHeight, rotation: 0, fill: 'transparent', stroke: 'transparent', strokeWidth: 0, opacity: 1, visible: true, locked: false, aspectRatio: safeAspectRatio,
        sourceType, 
        sourcePrompt: sourceType === 'generate' ? prompt : undefined, // 分割不需要 sourcePrompt
        generationStatus: 'generating',
        generationProgress: 0,  // #7xx 视频生成进度初始化为 0
        // 【干净数据结构】三个独立字段，不使用字符串拼接
        generationClientId: clientId,      // 前端生成的 clientId（不变）
        generationIndex: i,                // 图片索引（不变）
        generationTaskId: taskId,          // #093 修复：直接使用前端预生成的 taskId
        // #7xx 视频占位符预留字段（生成完成后填充）
        ...(sourceType === 'video' ? {
          videoUrl: '',      // 预留，生成完成后填充
          videoKey: '',      // 预留，生成完成后填充
          thumbnailUrl: '',  // 预留，生成完成后填充
        } : {}),
      });
      taskIdToElementIdRef.current.set(clientId, elementId);
      placeholderSizeRef.current.set(clientId, { width: safeWidth, height: safeHeight });
      placeholderPositionsRef.current.set(clientId, { left: imgX, top: imgY, right: imgX + safeWidth, bottom: imgY + safeHeight });
      placeholders.push({ id: elementId, index: i, x: imgX, y: imgY, width: safeWidth, height: safeHeight });
    });

    canvas.clearSelection();
    
    // ====== 镜头切换（使用统一函数返回的参数）======
    const groupCenterX = finalLeft + layout.totalWidth / 2;
    const groupCenterY = finalTop + layout.totalHeight / 2;
    const newPanX = containerRect.width / 2 - groupCenterX * layout.zoom;
    const newPanY = containerRect.height / 2 - groupCenterY * layout.zoom;
    
    setZoom(layout.zoom);
    setPan({ x: newPanX, y: newPanY });

    return placeholders;
  }, [canvas, zoom, pan, selectedRatio, calculateOverlapOffset]);

  // ====== 创建分割占位符（复用现有机制）======
  const createSplitPlaceholders = useCallback((count: number, imageDimensions?: { width: number; height: number }[]): { placeholderInfos: { id: string; index: number }[]; taskId: string } => {
    // 生成 taskId 和 clientIds
    const taskId = `split_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const clientIds = Array.from({ length: count }, (_, i) => `split_part_${i + 1}_${Date.now()}`);
    
    // 复用现有占位符机制
    // 🔧 #135 修复：分割时传入实际图片尺寸，不使用 selectedRatio
    const placeholderInfos = createPlaceholdersWithClientIds(
      clientIds,
      '分割图片',  // prompt（分割不需要，但参数必填）
      taskId,
      { 
        sourceType: 'split',
        imageDimensions: imageDimensions,  // 传入实际图片尺寸
      }
    );
    
    // 更新 taskIdToElementIdRef 映射
    placeholderInfos.forEach((info, i) => {
      taskIdToElementIdRef.current.set(`${taskId}_${i}`, info.id);
    });
    
    return { placeholderInfos, taskId };
  }, [createPlaceholdersWithClientIds]);

  // ====== 更新分割占位符（复用现有机制）======
  const updateSplitPlaceholders = useCallback((
    placeholderInfos: { id: string; index: number }[],
    imageUrls: string[],
    imageKeys: string[]
  ) => {
    // #584 修复：使用 updateElementsBatch 避免循环调用 updateElement 导致 React 19 insertBefore 错误
    const batchUpdates: Array<{ id: string; updates: Partial<CanvasElement> }> = [];
    
    const updateCount = Math.min(placeholderInfos.length, imageUrls.length);
    
    for (let i = 0; i < updateCount; i++) {
      const info = placeholderInfos[i];
      batchUpdates.push({
        id: info.id,
        updates: {
          imageUrl: imageUrls[i],
          imageKey: imageKeys[i] || undefined,
          generationStatus: undefined,
        }
      });
    }
    
    // 处理多余的占位符
    if (placeholderInfos.length > imageUrls.length) {
      for (let i = imageUrls.length; i < placeholderInfos.length; i++) {
        const info = placeholderInfos[i];
        batchUpdates.push({
          id: info.id,
          updates: {
            generationStatus: 'failed',
            generationError: '图片数据缺失',
          }
        });
      }
    }
    
    // 一次性批量更新
    canvas.updateElementsBatch(batchUpdates);
  }, [canvas]);

  // #232 Sprint 3：删除 saveGenerationRecord 函数
  // 历史记录保存已由 AIGeneratorContext 统一处理，此函数未被使用

  // ========== 核心：handleSend 使用 handleGenerate 重写 ==========
  const handleSend = useCallback(async () => {
    const content = inputValue.trim();
    
    if (!content) { 
      setInfoDialog({ open: true, title: '请输入提示词', description: '请输入描述您想要生成的内容' }); 
      return; 
    }
    
    // 验证：Veo 模型 prompt 最小长度 5 个字符
    const isVeoModelForValidation = selectedModel.includes('veo');
    if (isVeoModelForValidation && content.length < 5) {
      setInfoDialog({ open: true, title: '提示词太短', description: 'Veo 模型要求提示词至少 5 个字符' });
      return;
    }
    
    if (modelActiveStatus[selectedModel] === false) { 
      setInfoDialog({ open: true, title: '模型离线', description: '当前选择的模型暂时不可用，请选择其他在线模型' }); 
      return; 
    }
    
    // #878 精细化熔断检查：当前模型+分辨率是否被禁用
    if (isResolutionBanned(selectedResolution)) {
      setInfoDialog({ open: true, title: '分辨率暂不可用', description: `当前选择的分辨率「${selectedResolution}」暂时不可用，请选择其他分辨率或稍后重试` });
      return;
    }
    
    if (!isLoggedIn) { 
      window.dispatchEvent(new CustomEvent('openLogin')); 
      return; 
    }

    // 验证积分
    const user = await fetchUserWithCache();
    if (!user) { 
      window.dispatchEvent(new CustomEvent('openLogin')); 
      return; 
    }
    const config = modelConfig[selectedModel] || { resolutions: [{ size: '1K', credits: 10 }] };
    // #640 灵芽 Sora-2 VIP 2合1：积分根据时长动态计算
    let creditCost = (config.resolutions || []).find((r: any) => r.size.toLowerCase() === (selectedResolution || '1K').toLowerCase())?.credits || 10;
    if (selectedModel.startsWith('sora-2-all-vip') && selectedDuration === 15) {
      creditCost = 90;
    }
    const requiredCredits = creditCost * selectedCount;
    if (user.credits < requiredCredits) { 
      setInfoDialog({ open: true, title: '积分不足', description: `当前积分: ${user.credits}，需要: ${requiredCredits}` }); 
      return; 
    }

    try {
      // 🔧 #298 修复：等待所有参考图上传完成（避免 keys 为空）
      const pendingUploads = Array.from(globalPendingUploads.values());
      if (pendingUploads.length > 0) {
        await Promise.all(pendingUploads);
      }
      
      // #876 架构重构：从 MD5 Record 精确提取参考图数据，彻底根除索引错乱陷阱
      // 无论用户怎么乱删图片，按 md5 精确提取，永远与界面真实显示的图片一一对应
      // 清除已被删除的图片的 ref 条目（chatImageMd5s 不包含的 = 已删除的）
      const currentMd5Set = new Set(chatImageMd5s);
      for (const md5 of Object.keys(chatImageLatestRef.current)) {
        if (!currentMd5Set.has(md5)) {
          delete chatImageLatestRef.current[md5];
        }
      }
      // 按 UI 真实存在的 md5 顺序，从 ref 精确提取 url/key/base64
      const capturedRefImages = chatImageMd5s.map(md5 => {
        const entry = chatImageLatestRef.current[md5];
        if (entry) {
          return { url: entry.url, key: entry.key, base64: entry.base64, md5 };
        }
        // ref 中没有该 md5 的条目（理论上不应发生），从 React state 兜底
        const idx = chatImageMd5s.indexOf(md5);
        return {
          url: chatImageUrls[idx] || '',
          key: chatImageKeys[idx] || '',
          base64: chatImageBase64s[idx] || '',
          md5,
        };
      });

      // 生成 clientTaskIds
      const clientTaskIds = Array.from({ length: selectedCount }, () => `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);

      // 添加用户消息
      const userMsgId = Date.now().toString();
      setMessages(prev => [...prev, { 
        id: userMsgId, 
        role: 'user', 
        content, 
        timestamp: Date.now(), 
        referenceImages: capturedRefImages.length > 0 ? capturedRefImages.map(r => r.base64).filter(b => b) : undefined,
        // 🔧 #040 修复：保存 referenceImageKeys 用于刷新后恢复
        referenceImageKeys: capturedRefImages.length > 0 ? capturedRefImages.map(r => r.key).filter(k => k) : undefined,
        specs: { model: modelDisplayNames[selectedModel] || formatModelName(selectedModel), ratio: selectedRatio, resolution: selectedResolution, count: selectedCount } 
      }]);

      // 添加助手消息
      const assistantMsgId = (Date.now() + 1).toString();
      // #655 视频占位符：在 isVideoModel 声明后处理（见下方）
      // 先添加基础助手消息，视频模型后续会替换为占位符
      setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '正在生成...', timestamp: Date.now(), isGenerating: true }]);
      setIsFeaturesCollapsed(true);
      setTimeout(() => messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: 'smooth' }), 50);

      // #876 架构重构：MD5 Record 精确提取，逐项决策 URL 优先 → base64 兜底
      const hasAnyUrl = capturedRefImages.some(r => r.url && r.url.length > 0);
      
      // 逐项决策：URL 有效则用 URL，否则回退到 base64
      const images = hasAnyUrl
        ? capturedRefImages.map(r => {
            if (r.url && r.url.length > 0) return r.url;
            // URL 为空时回退到对应 base64
            return (r.base64 && r.base64.length > 0) ? r.base64 : '';
          }).filter(img => img.length > 0)
        : capturedRefImages.map(r => r.base64).filter(b => b && b.length > 0);
      const isUrls = hasAnyUrl;  // 有任何 COS URL 时 isUrls = true（服务商处理 base64 也没问题）
      // #540 修复：提前判断是否为视频模型（用于参考图数量限制和后续回调）
      // 【军师第一斩】强制基于模型家族判定，无视 React 状态覆盖！
      // 不再依赖 config.type（异步陷阱），直接检查模型 ID 是否是视频模型
      const isVideoModel = ModelDetector.isVideoModel(selectedModel);
      // #655 双模态占位符：视频/图片模型发送后启动假进度引擎
      if (isVideoModel) {
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMsgId 
            ? { ...msg, content: '视频生成中...', isVideoPlaceholder: true, videoProgress: 0 }
            : msg
        ));
        // #数据分流 真假进度严格分离
        // 有后端真进度的模型：15秒内等真实进度，超时则启动假进度兜底（防止0%卡死）
        // 无后端真进度的模型（仅 lingya-sora）：立即启动假进度引擎（VIDEO_CURVE 慢速曲线）
        videoPlaceholderMsgIdRef.current = assistantMsgId;
        mediaPlaceholderElementIdRef.current = null;  // #680 占位符创建后立即赋值
        fakeProgress.setMediaType('video');
        const videoModelHasRealProgress = ModelDetector.hasBackendRealProgress(selectedModel);
        // #690 核心修复：初始化 hasRealProgressRef
        hasRealProgressRef.current = videoModelHasRealProgress;
        // #7xx 修复：启动/停止假进度引擎
        if (!videoModelHasRealProgress) {
          // 只有 lingya-sora 才启动假进度
          fakeProgress.reset();
          fakeProgress.start();
        } else {
          // 有真实进度的模型：停止假进度
          fakeProgress.stop();
          fakeProgress.reset();
        }
      } else {
        // 图片模型：启动假进度引擎（3段式变速齿轮算法）
        fakeProgress.setMediaType('image');
        hasRealProgressRef.current = false;
        fakeProgress.reset();
        fakeProgress.start();
      }
      // #639 视频模型参考图数量限制（使用提纯引擎）
      // 对话框的 images 数组中的 URL 对应 chatImageUrls，类型需要从附件属性溯源
      const isHHModel = isVideoModel && ModelDetector.getFamily(selectedModel) === 'happyhorse';
      // #642 Seedance 2.0 模型判断
      const isSD2Model = isVideoModel && ModelDetector.getFamily(selectedModel) === 'seedance2';
      const isT8SDModel = isVideoModel && ModelDetector.getFamily(selectedModel) === 't8seedance';
      // #301 TOPAIS Veo / TOPAIS HappyHorse 模型判断（画布对话框必须传递 hhMode）
      const isTopaisModel = isVideoModel && ModelDetector.getFamily(selectedModel) === 'topais';
      const isTopaisHhModel = isVideoModel && ModelDetector.getFamily(selectedModel) === 'topais-happyhorse';
      // #301 LingYa Veo / LingYa Sora 模型判断（需要参与 mode 计算和素材提纯）
      const isLingyaVeoModel = isVideoModel && ModelDetector.getFamily(selectedModel) === 'lingya-veo';
      const isLingyaSoraModel = isVideoModel && ModelDetector.getFamily(selectedModel) === 'lingya-sora';
      // 所有支持模式切换的视频模型（与视频页面 + 画布面板保持一致）
      // #301 补齐 LingYa Veo/Sora：支持 t2v/i2v/r2v 模式切换
      const isModeSwitchVideoModel = isHHModel || isSD2Model || isT8SDModel || isTopaisModel || isTopaisHhModel || isLingyaVeoModel || isLingyaSoraModel;
      // #642 使用提纯引擎计算有效素材（替代硬编码的 slice 逻辑）
      const limitedImages = (() => {
        if (!isVideoModel) return images; // 图片模式不限制
        const sources: SourceItem[] = images.map((url: string, i: number) => ({
          id: `dialog-src-${i}`,
          type: 'image' as const, // 对话框的 URL 都是图片（视频通过 chatVideoUrl 单独传递）
          url,
          index: i,
        }));
        // #301 所有支持模式切换的视频模型都使用 hhCurrentMode（不再硬编码 'i2v'）
        const mode = isModeSwitchVideoModel ? hhCurrentMode : 'i2v';
        const { effective } = getEffectiveSources(mode, selectedModel, sources);
        return effective.map(s => s.url);
      })();


      // #232 Sprint 3：删除 saveRecordWithCapturedRef 函数
      // 历史记录保存已由 AIGeneratorContext 统一处理

      // #641 Sora-2 VIP 2合1：统一模型名，后端根据duration处理
      const effectiveModel = selectedModel;

      // 调用统一生成引擎
      await handleGenerate({
      prompt: content,
      model: effectiveModel,
      resolution: selectedResolution,
      aspectRatio: selectedRatio,
      generationCount: selectedCount,
      quality: selectedQuality,  // #522 T8Star GPT 品质参数
      // 视频参数：仅视频模型时传递
      mode: isVideoModel ? 'video' : 'image',
      duration: isVideoModel ? selectedDuration : undefined,
      // 【军师第二斩】硬塞！后端用不用是后端的事，前端绝不能漏发！
      hhMode: hhCurrentMode,  // 强制传递，废弃条件解构语法
      // Veo模型1080p：文生图选1080p时启用enableUpsample
      enableUpsample: isVideoModel && (currentConfig as any).supportsUpsample && selectedResolution === '1080p' && limitedImages.length === 0,
      images: limitedImages,
      isUrls,
      md5Hashes: chatImageMd5s,
      referenceImageKeys: capturedRefImages.map(r => r.key).filter((k: string) => k && k.length > 0),  // #840 传参考图 keys #876 MD5 Record
      // #633 HappyHorse 视频参数
      ...(isHHModel ? {
        firstFrameUrl: hhCurrentMode === 'i2v' ? (limitedImages.length > 0 ? limitedImages[0] : undefined) : undefined,
        referenceImageUrls: hhCurrentMode === 'r2v' ? limitedImages : (hhCurrentMode === 'video-edit' ? limitedImages : undefined),
        inputVideoUrl: hhCurrentMode === 'video-edit' ? chatVideoUrl || undefined : undefined,  // #636 video-edit模式传递视频输入
        hhMode: hhCurrentMode,
        audioSetting: hhCurrentMode === 'video-edit' ? hhAudioSetting : undefined,
      } : {}),
      // #642 Seedance 2.0 视频参数
      ...(isSD2Model ? {
        sd2Mode: hhCurrentMode === 'i2v-first-frame' || hhCurrentMode === 'i2v-first-last-frame' || hhCurrentMode === 'r2v' || hhCurrentMode === 't2v' ? hhCurrentMode : 't2v',
        firstFrameUrl: (hhCurrentMode === 'i2v-first-frame' || hhCurrentMode === 'i2v-first-last-frame') ? (limitedImages.length > 0 ? limitedImages[0] : undefined) : undefined,
        lastFrameUrl: hhCurrentMode === 'i2v-first-last-frame' ? (limitedImages.length > 1 ? limitedImages[1] : undefined) : undefined,
        referenceImageUrls: hhCurrentMode === 'r2v' ? limitedImages : undefined,  // #7xx 修复：r2v模式应传 referenceImageUrls（图片），而非 referenceVideoUrls（视频）
        referenceAudioUrls: dialogRefAudioRef.current.length > 0 ? dialogRefAudioRef.current.map(f => f.url) : undefined,
        generateAudio: dialogGenerateAudioRef.current,
      } : {}),
      // #644 T8 Seedance (sdols-*) 视频参数
      ...(isT8SDModel ? {
        t8seedanceMode: hhCurrentMode === 'i2v' || hhCurrentMode === 't2v' ? hhCurrentMode : 't2v',
        firstFrameUrl: hhCurrentMode === 'i2v' ? (limitedImages.length > 0 ? limitedImages[0] : undefined) : undefined,
        referenceAudioUrls: dialogRefAudioRef.current.length > 0 ? dialogRefAudioRef.current.map(f => f.url) : undefined,
        generateAudio: dialogGenerateAudioRef.current,
      } : {}),
      // #301 TOPAIS HappyHorse 1.1 视频参数
      ...(isTopaisHhModel ? {
        firstFrameUrl: hhCurrentMode === 'i2v' ? (limitedImages.length > 0 ? limitedImages[0] : undefined) : undefined,
        referenceImageUrls: hhCurrentMode === 'r2v' ? limitedImages : (hhCurrentMode === 'video-edit' ? limitedImages : undefined),
        inputVideoUrl: hhCurrentMode === 'video-edit' ? chatVideoUrl || undefined : undefined,
        hhMode: hhCurrentMode,
        audioSetting: hhCurrentMode === 'video-edit' ? hhAudioSetting : undefined,
      } : {}),
      // #301 LingYa Veo3.1 视频参数（必须传递 hhMode，后端用于判断 generation_type）
      ...(isLingyaVeoModel ? {
        hhMode: hhCurrentMode,
      } : {}),
      // #301 LingYa Sora-2 VIP 视频参数（必须传递 hhMode，后端用于判断 generation_type）
      ...(isLingyaSoraModel ? {
        hhMode: hhCurrentMode,
      } : {}),
      // #093 修复：接收 taskId 参数，传递给 createPlaceholdersWithClientIds
      // #540 修复：视频模式不创建图片占位符（视频结果不是图片，用 onVideoReceived 替换）
      onBeforeGenerate: (count, prompt, taskId) => {
        const placeholders = createPlaceholdersWithClientIds(clientTaskIds, content, taskId, { 
          ratio: selectedRatio,
          sourceType: isVideoModel ? 'video' : 'generate',  // #632 视频模式使用 video 类型
        });
        // #680 视频/图片模型：记录占位符元素 ID，用于同步假进度到画布
        if (placeholders.length > 0) {
          mediaPlaceholderElementIdRef.current = placeholders[0].id;
          // 视频和图片模式：为所有占位符设置初始进度 0
          // #690 修复：初始化 generationProgress（CanvasVideo 读取的字段）
          placeholders.forEach(p => {
            canvas.updateElement(p.id, { generationProgress: 0 });
          });
        }
        return placeholders;
      },
      onImageReceived: (data) => {
        const taskId = clientTaskIds[data.index];
        const elementId = taskIdToElementIdRef.current.get(taskId || '');
        // 🔧 修复：失败状态不调用 updatePlaceholder，由 onPlaceholderFailed 处理
        if (taskId && data.status !== 'failed' && data.url) {
          updatePlaceholder(taskId, data.url, data.imageKey || data.key, data.providerUrl || undefined);
        }
      },
      onPlaceholderFailed: (elementId, error) => {
        // #211 修复：直接用 elementId 更新元素状态，避免反向查找
        canvas.updateElement(elementId, { 
          generationStatus: 'failed', 
          generationError: error 
        });
      },
      // #540 修复：视频模式回调 - 收到视频后替换占位符/添加到画布
      onVideoReceived: isVideoModel ? (data) => {
        if (data.url) {
          // 视频结果：用视频缩略图（如有）或视频URL作为图片添加到画布
          const displayUrl = data.thumbnailUrl || data.url;
          // 找到对应的占位符并替换
          const placeholderTaskId = clientTaskIds[0];
          const elementId = placeholderTaskId ? taskIdToElementIdRef.current.get(placeholderTaskId) : undefined;
          if (elementId) {
            updatePlaceholder(placeholderTaskId, displayUrl, data.imageKey || data.key, undefined);
            // #616 存储 videoUrl 和 videoKey，刷新后可恢复视频
            // #7xx 同时更新 thumbnailUrl（用于 CanvasVideo poster 属性）
            // #7xx 关键修复：同步设置 generationStatus: 'completed'，防止 updatePlaceholder 异步竞态
            //   updatePlaceholder 是 async 函数（await 图片尺寸），不 await 调用时存在竞态窗口：
            //   在此 updateElement 执行后、updatePlaceholder resolve 前，元素 generationStatus 仍为 'generating'
            //   若此时触发重渲染，isVideoFailed 判断可能误判（虽然有 !== 'generating' 守卫，但防御纵深更安全）
            canvas.updateElement(elementId, {
              videoUrl: data.url,
              videoKey: data.videoKey || data.key,
              // #723 修复：thumbnailUrl 只能是图片URL，不能是视频URL
              // 如果后端返回了 thumbnailUrl 则使用，否则不设置（CanvasVideo 会显示默认占位符）
              ...(data.thumbnailUrl ? { thumbnailUrl: data.thumbnailUrl } : {}),
              // #723 同时设置 imageUrl 为缩略图（如果有），用于画布预览
              ...(data.thumbnailUrl ? { imageUrl: data.thumbnailUrl } : {}),
              generationStatus: 'completed',  // 同步标记完成，与 updatePlaceholder 的异步更新形成双保险
            } as any);
          } else {
            // 没有占位符，直接添加到画布（创建 video 类型元素）
            // #723 修复：如果有缩略图则使用缩略图获取尺寸，否则使用默认尺寸
            const thumbnailForSize = data.thumbnailUrl || null;
            if (thumbnailForSize) {
              const img = new window.Image();
              img.src = thumbnailForSize;
              img.onload = () => {
                canvas.addElement({
                  type: 'video',
                  name: `视频 ${content.substring(0, 15)}...`,
                  x: 0, y: 0,
                  width: img.naturalWidth, height: img.naturalHeight,
                  imageUrl: thumbnailForSize,  // 缩略图
                  imageKey: data.imageKey || data.key,
                  sourceType: 'video',
                  videoUrl: data.url,
                  videoKey: data.videoKey || data.key,
                  thumbnailUrl: thumbnailForSize,
                  generationStatus: 'completed' as const,
                } as any);
              };
              img.onerror = () => {
                // 缩略图加载失败，使用默认尺寸
                canvas.addElement({
                  type: 'video',
                  name: `视频 ${content.substring(0, 15)}...`,
                  x: 0, y: 0, width: 400, height: 300,
                  sourceType: 'video',
                  videoUrl: data.url,
                  videoKey: data.videoKey || data.key,
                  generationStatus: 'completed' as const,
                } as any);
              };
            } else {
              // 无缩略图，直接添加视频元素（使用默认尺寸）
              canvas.addElement({
                type: 'video',
                name: `视频 ${content.substring(0, 15)}...`,
                x: 0, y: 0, width: 400, height: 300,
                sourceType: 'video',
                videoUrl: data.url,
                videoKey: data.videoKey || data.key,
                generationStatus: 'completed' as const,
              } as any);
            }
          }
          // 更新聊天消息 - #655 视频占位符替换
          fakeProgress.stop();
          videoPlaceholderMsgIdRef.current = null;
          mediaPlaceholderElementIdRef.current = null;  // #680 清理画布元素引用
          // #723 修复：imageUrl 只能是缩略图（图片URL），不能是视频URL
          const chatThumbnailUrl = data.thumbnailUrl || null;
          setMessages(prev => prev.map(msg => msg.id === assistantMsgId ? { 
            ...msg, 
            content: '视频生成完成', 
            ...(chatThumbnailUrl ? { imageUrl: chatThumbnailUrl, imageUrlKey: data.imageKey || data.key } : {}),
            isGenerating: false,
            isVideoPlaceholder: false,
            videoProgress: 100,
            videoUrl: data.url,
          } : msg));
        }
      } : undefined,
      onVideoProgress: isVideoModel ? (progress) => {
        // #690 关键修复：收到真实进度时，标记 hasRealProgress 并停止假进度引擎
        // 只要后端发送了 progress（包括 0），就是真实进度！
        const realProgress = typeof progress.progress === 'number' ? progress.progress : undefined;
        
        if (realProgress !== undefined) {
          // #690 关键修复：只要 progress 是 number 就是真实进度（包括 0）！
          if (!hasRealProgressRef.current) {
            hasRealProgressRef.current = true;
            fakeProgress.stop();
          }
        }
        
        setMessages(prev => prev.map(msg => msg.id === assistantMsgId ? { 
          ...msg, 
          content: `视频生成中... ${progress.status || ''}`,
          videoProgress: realProgress,
        } : msg));
        // 同步真实进度到画布占位符元素（使用 flushSync 强制立即渲染）
        if (realProgress !== undefined && mediaPlaceholderElementIdRef.current) {
          flushSync(() => {
            canvas.updateElement(mediaPlaceholderElementIdRef.current!, { 
              generationProgress: realProgress,
              generationStatus: 'generating',
            });
          });
        }
      } : undefined,
      // #093 修复：generationTaskId 已在创建占位符时设置
      // 此回调仅用于验证后端返回的 taskId 是否与前端预期一致
      onActualTaskIdReceived: (elementId, actualTaskId) => {
        const el = canvas.state.elements.find(e => e.id === elementId);
        const expectedTaskId = el?.generationTaskId;
        if (expectedTaskId !== actualTaskId) {
          console.warn('[Canvas] ⚠️ taskId 不一致! 预期:', expectedTaskId, '实际:', actualTaskId);
          // 更新为后端返回的 actualTaskId
          canvas.updateElement(elementId, { generationTaskId: actualTaskId });
        } else {
        }
      },
      onProgress: (progress) => {
        setMessages(prev => prev.map(msg => msg.id === assistantMsgId ? { ...msg, content: `已生成 ${progress.completed}/${progress.total} 张图片...` } : msg));
      },
      onComplete: (result) => {
        // #680 视频/图片完成时清理画布元素引用 + 停止假进度
        fakeProgress.stop();
        // #进度兜底：清理15秒兜底定时器
        if (fakeProgressFallbackTimerRef.current) {
          clearTimeout(fakeProgressFallbackTimerRef.current);
          fakeProgressFallbackTimerRef.current = null;
        }
        mediaPlaceholderElementIdRef.current = null;
        const successUrls = result.imageUrls || [];
        const successKeys = result.imageKeys || [];
        // #540 修复：视频模式使用 videos 和 videoKeys
        const videoUrls = result.videos || [];
        const videoKeys = result.videoKeys || [];
        
        // #214 修复：兜底处理占位符替换
        // SSE 流正常时，onImageReceived 会处理占位符
        // SSE 流异常时（事件被缓冲/丢失），这里作为兜底逻辑
        if (result.placeholderReplacements && result.placeholderReplacements.length > 0) {
          result.placeholderReplacements.forEach(p => {
            if (p.imageUrl && p.placeholderId) {
              // #214 关键修复：优先使用 taskIdToElementIdRef 获取最新的 elementId
              // 因为 updatePlaceholder 可能在元素不存在时重新添加了元素（产生新 ID）
              const taskId = clientTaskIds[p.index];
              const latestElementId = taskId ? taskIdToElementIdRef.current.get(taskId) : undefined;
              const elementIdToUse = latestElementId || p.placeholderId;
              
              // 🔧 #221 修复：使用 stateRef 获取最新元素，避免 React 闭包陷阱
              const liveElements = canvas.stateRef?.current?.elements || canvas.state.elements;
              const el = liveElements.find((e: any) => e.id === elementIdToUse);
              if (el && el.generationStatus !== 'completed') {
                // 🔧 #725 修复：updatePlaceholder 第一个参数是 taskId，不是 elementId！
                // 必须传 taskId 才能从 taskIdToElementIdRef 获取 elementId
                const taskIdToUse = taskId || el.generationTaskId;
                if (taskIdToUse) {
                  updatePlaceholder(taskIdToUse, p.imageUrl, p.imageKey, (p as any).providerUrl);
                } else {
                  console.error('[Canvas onComplete] #725 无法获取 taskId，跳过更新:', { elementId: elementIdToUse, index: p.index });
                }
              } else if (!el) {
                // 元素确实不存在，尝试重新添加（需要获取图片实际尺寸）
                console.warn(`[Canvas onComplete] #214 元素不存在，尝试重新添加: elementId=${elementIdToUse}`);
                
                // 🔧 #216 修复：先删除画布上相同 taskId 的旧占位符
                if (taskId) {
                  const oldPlaceholders = liveElements.filter((el: any) => 
                    el.generationTaskId === taskId && (el.generationStatus === 'generating' || el.generationStatus === 'failed')
                  );
                  if (oldPlaceholders.length > 0) {
                    oldPlaceholders.forEach((el: any) => {
                      canvas.deleteElement(el.id);
                    });
                  }
                }
                
                const pos = placeholderPositionsRef.current.get(taskId || '');
                if (pos && p.imageUrl) {
                  // 🔧 升级：获取图片实际尺寸，按比例计算元素尺寸
                  const img = new window.Image();
                  img.src = p.imageUrl;
                  img.onload = () => {
                    const naturalWidth = img.naturalWidth;
                    const naturalHeight = img.naturalHeight;
                    const imgAspect = naturalWidth / naturalHeight;
                    
                    // 占位符原始尺寸
                    const placeholderWidth = pos.right - pos.left;
                    const placeholderHeight = pos.bottom - pos.top;
                    const placeholderAspect = placeholderWidth / placeholderHeight;
                    
                    // 按图片实际比例调整尺寸
                    let newWidth: number, newHeight: number;
                    if (imgAspect > placeholderAspect) {
                      newWidth = placeholderWidth;
                      newHeight = newWidth / imgAspect;
                    } else {
                      newHeight = placeholderHeight;
                      newWidth = newHeight * imgAspect;
                    }
                    
                    // 居中定位
                    const centerX = pos.left + placeholderWidth / 2;
                    const centerY = pos.top + placeholderHeight / 2;
                    const newX = centerX - newWidth / 2;
                    const newY = centerY - newHeight / 2;
                    
                    // 判断是否为视频URL
                    const isVideoFallback = /\.(mp4|webm|mov|avi)(\?|$)/i.test(p.imageUrl || '') || (isVideoModel && p.providerUrl);
                    const newElementId = canvas.addElement({
                      type: isVideoFallback ? 'video' : 'image',
                      name: isVideoFallback ? `生成视频 #${p.index + 1}` : `生成图片 #${p.index + 1}`,
                      x: newX,
                      y: newY,
                      width: newWidth,
                      height: newHeight,
                      rotation: 0,
                      fill: 'transparent',
                      stroke: 'transparent',
                      strokeWidth: 0,
                      opacity: 1,
                      visible: true,
                      locked: false,
                      imageUrl: isVideoFallback ? undefined : p.imageUrl,
                      imageKey: p.imageKey,
                      videoUrl: isVideoFallback ? (p.providerUrl || p.imageUrl) : undefined,
                      sourceType: isVideoFallback ? 'video' : 'generate',
                      generationStatus: 'completed' as const,
                    });
                    if (taskId) {
                      taskIdToElementIdRef.current.set(taskId, newElementId);
                    }
                  };
                  img.onerror = () => {
                    console.error(`[Canvas onComplete] #214 图片加载失败，使用占位符原始尺寸: ${p.imageUrl}`);
                    // 降级：使用占位符原始尺寸
                    const isVideoFallbackErr = /\.(mp4|webm|mov|avi)(\?|$)/i.test(p.imageUrl || '') || (isVideoModel && p.providerUrl);
                    const newElementId = canvas.addElement({
                      type: isVideoFallbackErr ? 'video' : 'image',
                      name: isVideoFallbackErr ? `生成视频 #${p.index + 1}` : `生成图片 #${p.index + 1}`,
                      x: pos.left,
                      y: pos.top,
                      width: pos.right - pos.left,
                      height: pos.bottom - pos.top,
                      rotation: 0,
                      fill: 'transparent',
                      stroke: 'transparent',
                      strokeWidth: 0,
                      opacity: 1,
                      visible: true,
                      locked: false,
                      imageUrl: isVideoFallbackErr ? undefined : p.imageUrl,
                      imageKey: p.imageKey,
                      videoUrl: isVideoFallbackErr ? (p.providerUrl || p.imageUrl) : undefined,
                      sourceType: isVideoFallbackErr ? 'video' : 'generate',
                      generationStatus: 'completed' as const,
                    });
                    if (taskId) {
                      taskIdToElementIdRef.current.set(taskId, newElementId);
                    }
                  };
                }
              }
            }
          });
        }
        
        // 使用旁路缓存保存 imageKey 映射（增量方案，不侵入核心类型）
        if (successKeys.length > 0) {
          saveImageKeyMapping(assistantMsgId, successKeys);
        } else if (videoKeys.length > 0) {
          // #540 修复：视频模式保存 videoKey 映射
          saveImageKeyMapping(assistantMsgId, videoKeys);
        } else {
          console.warn('[Canvas onComplete] 没有 imageKeys/videoKeys，无法持久化');
        }
        
        // #540 修复：区分图片和视频模式的完成消息
        if (isVideoModel && videoUrls.length > 0) {
          // 视频模式：onVideoReceived 已经处理了画布显示，这里只更新消息
          // 如果 onVideoReceived 没触发（兜底），这里也处理
          const liveElements = canvas.stateRef?.current?.elements || canvas.state.elements;
          const hasVideoOnCanvas = liveElements.some((e: any) => 
            (e.sourceType === 'video' || e.type === 'video') && 
            (videoUrls.includes(e.videoUrl) || videoUrls.includes(e.imageUrl))
          );
          if (!hasVideoOnCanvas) {
            // 兜底：直接添加视频缩略图到画布中心
            const thumbnail = result.thumbnails?.[0] || videoUrls[0];
            const cw = typeof window !== 'undefined' ? window.innerWidth : 1920;
            const ch = typeof window !== 'undefined' ? window.innerHeight : 1080;
            const canvasCenterX = (cw / 2 - pan.x) / zoom;
            const canvasCenterY = (ch / 2 - pan.y) / zoom;
            canvas.addElement({
              type: 'image',
              name: `视频 ${content.substring(0, 15)}...`,
              x: canvasCenterX - 200,
              y: canvasCenterY - 150,
              width: 400, height: 300,
              imageUrl: thumbnail,
              imageKey: videoKeys[0],
              sourceType: 'video',
              // #616 同时存储视频 URL 和 key，刷新后可恢复
              videoUrl: videoUrls[0],
              videoKey: videoKeys[0],
              generationStatus: 'completed' as const,
            } as any);
          }
          setMessages(prev => prev.map(msg => msg.id === assistantMsgId ? { 
            ...msg, 
            content: `视频生成完成`, 
            imageUrl: result.thumbnails?.[0] || videoUrls[0],
            imageUrlKey: videoKeys[0],
            isGenerating: false,
            isVideoPlaceholder: false,
            videoProgress: 100,
            videoUrl: videoUrls[0],
          } : msg));
        } else {
          setMessages(prev => prev.map(msg => msg.id === assistantMsgId ? { 
            ...msg, 
            content: `已生成 ${successUrls.length} 张图片`, 
            imageUrl: successUrls[0], 
            // 🔧 #041 修复：保存生成图的 COS key 用于刷新后恢复
            imageUrlKey: successKeys[0],
            isGenerating: false 
          } : msg));
        }
        // 🔧 #208 修复：不再自动清除参考图，让用户可以继续使用
        // clearAllImages();
      },
      onError: (error) => {
        // #进度兜底：清理15秒兜底定时器
        if (fakeProgressFallbackTimerRef.current) {
          clearTimeout(fakeProgressFallbackTimerRef.current);
          fakeProgressFallbackTimerRef.current = null;
        }
        // #505 如果是禁用错误，刷新用户信息让前端弹窗处理
        if (error.type === 'banned') {
          refreshUserInfo(true);
          return;
        }
        // #508 如果是违规警告，立即更新 failedAttempts 触发弹窗
        if (error.type === 'violation_warning') {
          refreshUserInfo(true);
          return;
        }
        // #279 修复：只标记 error.placeholderIds 中的占位符为失败，不"连坐"已成功的图片
        const failedIds = error.placeholderIds || clientTaskIds;
        // #723 翻译英文错误消息为中文
        const translatedError = translateErrorMessage(error.message || '');
        const isViolation = translatedError.includes('违反') || translatedError.includes('违规') || translatedError.includes('政策') || translatedError.includes('安全') || translatedError.includes('审核');
        const displayError = isViolation
          ? '此内容可能违反我们的政策，您可以尝试更改提示词或更换图像'
          : translatedError;
        failedIds.forEach(id => {
          markPlaceholderFailed(id, displayError);
        });
        setMessages(prev => prev.map(msg => msg.id === assistantMsgId ? { 
          ...msg, 
          content: `生成失败: ${displayError}`, 
          isGenerating: false,
          isVideoPlaceholder: false,
        } : msg));
        // #655 停止假进度
        fakeProgress.stop();
        videoPlaceholderMsgIdRef.current = null;
        mediaPlaceholderElementIdRef.current = null;  // #680 清理画布元素引用
      },
      // #856 异步放手：后端返回 still_processing 时，停止前端等待但不标记失败
      onStillProcessing: () => {
        console.log('[Canvas handleSend] 收到 still_processing，停止前端等待，任务将在后台继续');
        // #进度兜底：清理15秒兜底定时器
        if (fakeProgressFallbackTimerRef.current) {
          clearTimeout(fakeProgressFallbackTimerRef.current);
          fakeProgressFallbackTimerRef.current = null;
        }
        // 停止假进度
        fakeProgress.stop();
        // 更新对话框消息：告知用户任务仍在后台处理
        setMessages(prev => prev.map(msg => msg.id === assistantMsgId ? {
          ...msg,
          content: '任务已提交，正在后台处理中，完成后将自动显示在画布上',
          isGenerating: false,
          isVideoPlaceholder: false,
        } : msg));
        videoPlaceholderMsgIdRef.current = null;
        mediaPlaceholderElementIdRef.current = null;
      },
    });
    } catch (error: any) {
      console.error('[Canvas handleSend] 执行出错:', error);
      setInfoDialog({ open: true, title: '生成失败', description: translateErrorMessage(error?.message || '未知错误') });
    }
  }, [inputValue, selectedModel, selectedResolution, selectedRatio, selectedCount, isLoggedIn, modelActiveStatus, modelConfig, modelDisplayNames, chatImageBase64s, chatImageUrls, chatImageMd5s, chatImageKeys, handleGenerate, createPlaceholdersWithClientIds, updatePlaceholder, markPlaceholderFailed, setMessages, setInputValue, setIsFeaturesCollapsed, setInfoDialog]);

  // 发送元素到对话 - 将图片添加到对话框
  // 【A+B+C 综合优化】静态导入 + 合并读取 + 乐观UI
  const sendToChat = useCallback(async (elementId: string, imageUrl?: string, imageName?: string) => {
    // 获取图片 URL
    let url = imageUrl;
    let name = imageName || '未命名图片';
    
    // 如果没有直接提供 URL，从画布元素中查找
    if (!url) {
      const element = canvas.state.elements.find(el => el.id === elementId);
      if (!element) return;

      // 支持普通图片和面板类型
      if (element.type === 'image' && (element.imageUrl || element.imageKey)) {
        // #862 功能隔离：发送到对话/下一节点必须使用COS链接，禁止providerUrl(防CORS)
        url = getCOSUrlForElement(element) || element.imageUrl || '';
        name = element.name || '未命名图片';
      } else if ((element as any).imageUrls && Array.isArray((element as any).imageUrls) && (element as any).imageUrls.length > 0) {
        // 面板类型：从 imageUrls 数组中获取第一张
        url = (element as any).imageUrls[0];
        name = element.name || '未命名图片';
      } else {
        return;
      }
    }

    // 检查是否已达到上限（6张）
    if (chatImageBase64s.length >= 6) {
      return;
    }

    // 确保 url 存在
    if (!url) {
      return;
    }

    
    try {
      // 1. 下载图片
      const response = await fetch(url);
      const blob = await response.blob();
      
      // 2. 压缩图片（2048px / 3MB / JPEG）
      const file = new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
      const compressedResult = await compressImageForUpload(file);
      const compressedBlob = compressedResult.file;
      
      // 【修正读取：Promise.all 同时获取 base64 和 arrayBuffer】
      const [base64, arrayBuffer] = await Promise.all([
        // 读取 base64（用于预览）
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('读取图片失败'));
          reader.readAsDataURL(compressedBlob);
        }),
        // 读取 arrayBuffer（用于 MD5）
        compressedBlob.arrayBuffer()
      ]);
      
      // 计算 MD5
      const md5 = calculateMD5FromArrayBuffer(arrayBuffer);
      
      // #669 虚拟副本：移除 MD5 去重拦截，允许同一图片多次加入对话框
      // （例如：同一张图既作首帧又作尾帧）
      
      // 【方案B：乐观UI】立即显示预览
      const currentIdx = chatImageBase64s.length;  // 🔧 #222 修复：记录当前索引，避免闭包陷阱
      const imageId = crypto.randomUUID();  // #670 虚拟副本：生成唯一标识
      chatImageIdToIdxRef.current.set(imageId, currentIdx);  // #670 用 id 映射索引（替代 md5，避免重复图片冲突）
      setChatImageBase64s(prev => [...prev, base64]);
      setChatImageUrls(prev => [...prev, '']); // 占位
      setChatImageKeys(prev => [...prev, '']);
      setChatImageMd5s(prev => [...prev, md5]);
      setChatImageNames(prev => [...prev, name]);
      setChatImageIds(prev => [...prev, imageId]);  // #670 虚拟副本：添加唯一标识
      
      
      // 【后台异步】上传 COS + 存储 IndexedDB
      // 🔧 #215 提交层拦截池：将上传 Promise 存入全局追踪器
      const uploadPromise = (async () => {
        try {
          // #669 虚拟副本：极速秒传 — 如果 MD5 已存在，复用已有 URL/Key
          const existingIdx = chatImageMd5s.indexOf(md5);
          if (existingIdx >= 0 && chatImageUrls[existingIdx]) {
            // 极速秒传：复用已有 URL/Key
            setChatImageUrls(prev => {
              const newUrls = [...prev];
              if (currentIdx >= 0 && currentIdx < newUrls.length) newUrls[currentIdx] = chatImageUrls[existingIdx];
              return newUrls;
            });
            setChatImageKeys(prev => {
              const newKeys = [...prev];
              if (currentIdx >= 0 && currentIdx < newKeys.length) newKeys[currentIdx] = chatImageKeys[existingIdx];
              return newKeys;
            });
          } else {
            // 服务端中转上传 COS
            const uploadFile = new File([compressedBlob], `${name}.jpg`, { type: 'image/jpeg' });
            const formData = new FormData();
            formData.append('file', uploadFile);
            const uploadResponse = await fetch('/api/canvas/upload', { method: 'POST', body: formData });
            const uploadData = await safeJsonResponse<{ key?: string; url?: string }>(uploadResponse);
            
            if (uploadData.success) {
              const signedUrl = `/api/canvas/image?key=${encodeURIComponent(uploadData.key ?? '')}`;
              // 更新 URL 和 Key
              setChatImageUrls(prev => {
                const newUrls = [...prev];
                if (currentIdx >= 0 && currentIdx < newUrls.length) newUrls[currentIdx] = signedUrl;
                return newUrls;
              });
              setChatImageKeys(prev => {
                const newKeys = [...prev];
                if (currentIdx >= 0 && currentIdx < newKeys.length) newKeys[currentIdx] = uploadData.key ?? '';
                return newKeys;
              });
              
              // 存储 IndexedDB
              await storeReferenceImage(md5, compressedBlob, base64, signedUrl, name);
            }
          }
        } catch (bgError) {
          console.warn('[Canvas Dialog] 后台任务失败:', name, bgError);
        } finally {
          // 无论成功失败，都从追踪器中移除
          globalPendingUploads.delete(md5);
        }
      })();
      
      // 🔧 #215 存入全局追踪器
      globalPendingUploads.set(md5, uploadPromise);
      
    } catch (error) {
      console.error('[Canvas Dialog] 处理参考图失败:', error);
    }
  }, [canvas.state.elements, chatImageBase64s.length, chatImageMd5s, chatImageUrls, chatImageKeys]);

  // 【A 计划】处理参考图上传（使用乐观上传 Hook）
  // #048 修复：上传完成后才能提交，图片显示加载转圈
  const handleReferenceImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    // #892 鉴权：未登录时前置拦截参考图上传
    if (!isLoggedIn) {
      setAuthModalOpen(true);
      e.target.value = '';
      return;
    }
    
    // 🔧 #839 修复：重置索引追踪器，让 onOptimisticUpdate 从当前 chatImageBase64s.length 重新开始计数
    chatImageNextIdxRef.current = null;
    
    // #659 动态获取当前模型的最大图片数量
    const maxImages = getModelMaxLimits(selectedModel).image;
    // #650 视频模型（Seedance等）官方支持单图最高30MB，其他模型保持3MB
    const isVideoModel = getModelSupportedTypes(selectedModel).video;
    const compressionMaxSizeMB = isVideoModel ? 30 : undefined;
    
    // #826 压缩开始：显示骨架卡片
    const fileCount = Array.from(files).length;
    setChatCompressingCount(prev => prev + fileCount);
    
    // 调用 Hook 处理文件
    await processUploadFiles(files, {
      existingMd5s: chatImageMd5s,
      existingUrls: chatImageUrls,  // #669 虚拟副本：传入已有 URL 用于极速秒传
      existingKeys: chatImageKeys,  // #669 虚拟副本：传入已有 Key 用于极速秒传
      currentCount: chatImageBase64s.length,
      maxImages,  // #659 传入动态最大数量
      compressionMaxSizeMB,  // #650 视频模型放宽压缩限制
      // 乐观 UI：立即显示预览
      onOptimisticUpdate: (result: OptimisticUploadResult) => {
        // #826 压缩完成：移除骨架卡片
        setChatCompressingCount(prev => Math.max(0, prev - 1));
        // 🔧 #839 修复：使用 ref 追踪索引，避免并行上传时闭包陷阱
        // 旧代码: const currentIdx = chatImageBase64s.length;
        // 问题: Promise.allSettled 并行处理多个文件时，所有 onOptimisticUpdate
        //       看到同一个 chatImageBase64s.length（React 状态尚未更新），
        //       导致 chatImageIdToIdxRef 映射冲突（多个 imageId 映射到同一索引），
        //       onBackgroundComplete 时找不到正确索引 → URL 永远是空字符串 → 参考图丢失
        if (!chatImageNextIdxRef.current) {
          chatImageNextIdxRef.current = chatImageBase64s.length; // 首次：从当前长度开始
        }
        const currentIdx = chatImageNextIdxRef.current;
        chatImageNextIdxRef.current += 1; // 原子递增，下一个文件拿到正确索引
        const imageId = result.imageId;  // #670 虚拟副本：使用 Hook 生成的唯一标识
        chatImageIdToIdxRef.current.set(imageId, currentIdx);  // #670 用 id 映射索引（替代 md5，避免重复图片冲突）
        // #676 互斥解除：如果当前手动覆盖为 t2v（与图片互斥），清除覆盖，放权给自动推断切入 i2v
        if (hhOverrideMode === 't2v') {
          setHhOverrideMode(null);
        }
        setChatImageBase64s(prev => [...prev, result.base64]);
        setChatImageUrls(prev => [...prev, '']); // 占位，后台填充
        setChatImageKeys(prev => [...prev, '']);
        setChatImageMd5s(prev => [...prev, result.md5]);
        setChatImageNames(prev => [...prev, result.fileName]);
        setChatImageIds(prev => [...prev, imageId]);  // #670 虚拟副本：添加唯一标识
        // #876 架构重构：MD5 Record 同步写入，彻底根除索引错乱
        chatImageLatestRef.current[result.md5] = {
          url: '',   // 占位，onBackgroundComplete 回填
          key: '',   // 占位，onBackgroundComplete 回填
          base64: result.base64,
        };
        // #048 新增：追踪正在上传的图片
        setChatUploadingMd5s(prev => new Set(prev).add(result.md5));
      },
      // 后台上传完成：#670 虚拟副本：用唯一 ID 更新对应位置的 URL 和 Key（替代 MD5 查找）
      onBackgroundComplete: (result: BackgroundUploadResult) => {
        // #048 新增：从上传追踪中移除（无论成功还是失败）
        setChatUploadingMd5s(prev => {
          const newSet = new Set(prev);
          newSet.delete(result.md5);
          return newSet;
        });
        
        if (result.success) {
          // #670 虚拟副本：使用唯一 ID 查找索引（替代 MD5，避免重复图片冲突）
          if (!result.imageId) {
            console.warn('[Canvas Dialog] #670 onBackgroundComplete 缺少 imageId，跳过更新');
          } else {
            const idx = chatImageIdToIdxRef.current.get(result.imageId);
            if (idx !== undefined) {
              setChatImageUrls(prev => {
                const newUrls = [...prev];
                if (idx >= 0 && idx < newUrls.length) newUrls[idx] = result.url;
                return newUrls;
              });
              setChatImageKeys(prev => {
                const newKeys = [...prev];
                if (idx >= 0 && idx < newKeys.length) newKeys[idx] = result.key;
                return newKeys;
              });
              // #876 架构重构：MD5 Record 精确回填，彻底根除索引错乱
              // 通过 imageId 反查 md5（chatImageIds 和 chatImageMd5s 索引对齐）
              const md5ForId = chatImageMd5s[idx];
              if (md5ForId && chatImageLatestRef.current[md5ForId]) {
                chatImageLatestRef.current[md5ForId].url = result.url;
                chatImageLatestRef.current[md5ForId].key = result.key;
              }
            } else {
              console.warn('[Canvas Dialog] #670 找不到 imageId 对应的索引:', result.imageId);
            }
          }
        } else {
          // #048 新增：上传失败提示
          console.warn('[Canvas Dialog] 上传失败:', result.error);
        }
      },
      // 处理失败
      onError: (fileName: string, error: string) => {
        // #826 压缩/处理失败：移除骨架卡片
        setChatCompressingCount(prev => Math.max(0, prev - 1));
        console.error('[Canvas Dialog] 处理参考图失败:', fileName, error);
      },
      // 数量不足提示 #660
      onSlotsExhausted: (requested: number, available: number) => {
        // #826 跳过的文件也要移除骨架卡片
        const skippedCount = requested - Math.max(0, available);
        if (skippedCount > 0) {
          setChatCompressingCount(prev => Math.max(0, prev - skippedCount));
        }
        if (available === 0) {
          toast.error(`已达到最大限制（${maxImages}张）`);
        } else {
          toast.error(`最多还能上传 ${available} 张图片，已自动选取前 ${available} 张`);
        }
      },
    });
    
    // 清空 input，允许重复选择相同文件
    e.target.value = '';
  }, [chatImageBase64s.length, chatImageMd5s, chatImageUrls, chatImageKeys, processUploadFiles, selectedModel, isLoggedIn]);

  // 对话框视频上传处理（HappyHorse video-edit 模式）
  const handleVideoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // #892 鉴权：未登录时前置拦截视频上传
    if (!isLoggedIn) {
      setAuthModalOpen(true);
      e.target.value = '';
      return;
    }
    
    setIsVideoUploading(true);
    try {
      // 服务端中转上传 COS
      const formData = new FormData();
      formData.append('file', file);
      const uploadResponse = await fetch('/api/canvas/upload', { method: 'POST', body: formData });
      const uploadData = await safeJsonResponse<{ key?: string; url?: string }>(uploadResponse);
      if (uploadData.success) {
        setChatVideoUrl(`/api/canvas/image?key=${encodeURIComponent(uploadData.key ?? '')}`);
      } else {
        console.error('[对话视频上传] 失败:', uploadData.error);
      }
    } catch (err) {
      console.error('[对话视频上传] 异常:', err);
    }
    setIsVideoUploading(false);
    e.target.value = '';
  }, [setChatVideoUrl, isLoggedIn]);

  return (
    <div className="flex flex-1 overflow-hidden select-none">
      
      {/* TopBar - 从 temp_TopBar.tsx 迁移 */}
      <TopBar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        handleToolClick={handleToolClick}
        tools={tools}
        icons={icons}
        isCropping={isCropping}
      />
      
      {/* #887 弊端3终极加固：云端加载遮罩 - 锁定画布交互防抢占 */}
      {canvas.isCloudSyncing && (
        <div style={{
          position: 'absolute',
          inset: 0,
          zIndex: 9998,
          background: 'rgba(255,255,255,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(2px)',
          cursor: 'wait',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            padding: '12px 24px',
            borderRadius: 24,
            fontSize: 14,
            fontWeight: 500,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
            云端画布加载中...
          </div>
        </div>
      )}

      {/* #891 鉴权：不做全屏锁！用户可以自由浏览/操作画布，仅在实际执行需要登录的操作时才弹登录窗 */}
      {/* PLG模式：未登录用户可自由操作画布，上传/生成/收藏等操作已有独立登录拦截守卫 */}

      {/* #887 弊端1终极加固：CAS 冲突确认弹窗 - 绝不静默覆盖 */}
      {canvas.casConflictData && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99999,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)',
        }}>
          <div style={{
            background: '#fff',
            borderRadius: 16,
            padding: '28px 32px',
            maxWidth: 420,
            width: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span style={{ fontSize: 17, fontWeight: 600, color: '#1a1a1a' }}>云端版本冲突</span>
            </div>
            <p style={{ fontSize: 14, color: '#555', lineHeight: 1.6, marginBottom: 24 }}>
              检测到云端存在新版本画布数据（可能来自其他设备或标签页）。
              <br />
              <strong style={{ color: '#dc2626' }}>加载云端数据将覆盖当前未保存的修改！</strong>
              <br />
              请确认是否同步云端数据？
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => canvas.resolveCasConflict(false)}
                style={{
                  padding: '8px 20px',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  background: '#fff',
                  color: '#333',
                  fontSize: 14,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                保持本地
              </button>
              <button
                onClick={() => canvas.resolveCasConflict(true)}
                style={{
                  padding: '8px 20px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontSize: 14,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                加载云端数据
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 左侧工具栏 - 从 temp_LeftSideBar.tsx 迁移 */}
      <LeftSideBar
        activeTool={activeTool}
        handleToolClick={handleToolClick}
        tools={tools}
        icons={icons}
        isCropping={isCropping}
      />

      {/* 中间画布区 */}
      <main className="flex-1 flex flex-col relative pl-1 pr-2 py-3 canvas-area-cursor min-h-0 z-0">
        {/* 画布 - 使用 min-h-0 让 flex-1 能正确计算高度 */}
        <div 
          ref={canvasContainerRef} 
          className="flex-1 w-full min-h-0 rounded-xl overflow-hidden canvas-custom-cursor"
          style={{ position: 'relative' }}
        >
          <CanvasContent
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            onSendMessage={sendToChat}
            zoom={zoom}
            setZoom={setZoom}
            pan={pan}
            setPan={setPan}
            isCropping={isCropping}
            setIsCropping={setIsCropping}
            isGridSelectMode={isGridSelectMode}
            setIsGridSelectMode={setIsGridSelectMode}
            gridSelectMousePos={gridSelectMousePos}
            onGridImageSelect={(imageUrl) => {
              // 从画布选择图片时获取 imageKey
              const selectedElement = canvas.state.elements.find(el => el.type === 'image' && el.imageUrl === imageUrl);
              const imageKey = selectedElement?.imageKey || '';
              
              // 清除原图片数据和分割结果
              setGridUploadedImages([{ imageUrl, imageKey, base64: '' }]);
              setGridSplitImages([]);
              setIsGridSelectMode(false);
            }}
            canvasHeight={CANVAS_HEIGHT}
            CANVAS_WIDTH={CANVAS_WIDTH}
            showInfo={showInfo}
            calculateZoom={calculateZoom}
            fitToAllImages={fitToAllImages}
            canvasContainerRef={canvasContainerRef}
            containerSize={containerSize}
            handleAddSplitImagesToCanvas={handleAddSplitImagesToCanvas}
            cropImageByCells={cropImageByCells}
            onTriggerUpload={() => fileInputRef.current?.click()}
            setShowVideoFullscreenUrl={setShowVideoFullscreenUrl}
            contextMenuUploadTargetRef={contextMenuUploadTargetRef}
            fileInputRef={fileInputRef}
          />
        </div>

        <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleFileImport} />
        {/* 参考图上传输入框 */}
        <input ref={referenceImageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleReferenceImageUpload} />
        <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} />
      </main>

      {/* 右侧AI面板 - 已拆分为 RightPanel 组件，使用 Context 获取状态 */}
      <RightPanel
        // 面板基础状态
        isRightPanelCollapsed={isRightPanelCollapsed}
        setIsRightPanelCollapsed={setIsRightPanelCollapsed}
        rightPanelWidth={rightPanelWidth}
        setRightPanelWidth={setRightPanelWidth}
        isResizingPanel={isResizingPanel}
        setIsResizingPanel={setIsResizingPanel}
        panelResizeRef={panelResizeRef}
        isFeaturesCollapsed={isFeaturesCollapsed}
        setIsFeaturesCollapsed={setIsFeaturesCollapsed}
        // 消息列表
        messageListRef={messageListRef}
        clearMessages={clearMessages}
        // 参考图
        referenceImageInputRef={referenceImageInputRef}
        chatCompressingCount={chatCompressingCount}
        // 视频
        videoInputRef={videoInputRef}
        isVideoUploading={isVideoUploading}
        setIsVideoUploading={setIsVideoUploading}
        // 模型相关
        formatModelName={formatModelName}
        // 生成参数
        aspectRatioOptions={aspectRatioOptions}
        resolutionOptions={resolutionOptions}
        currentConfig={currentConfig}
        selectedModel={selectedModel}
        // 收藏回调
        handleAddFavorite={handleAddFavorite}
        handleUpdateFavorite={handleUpdateFavorite}
        handleCopyContent={handleCopyContent}
        handleDeleteFavorite={handleDeleteFavorite}
        // 配置
        canvasConfig={canvasConfig}
        // 核心功能函数
        handleToggleFeatures={handleToggleFeatures}
        handleSend={handleSend}
        handleSendToInput={handleSendToInput}
        showInfo={showInfo}
        // #642 对话框音频文件同步
        onAudioFilesChange={(files) => { dialogRefAudioRef.current = files; }}
        onGenerateAudioChange={(v) => { dialogGenerateAudioRef.current = v; }}
        // 智能分割
        showGridModal={showGridModal}
        setShowGridModal={setShowGridModal}
        gridLeftCollapsed={gridLeftCollapsed}
        setGridLeftCollapsed={setGridLeftCollapsed}
        gridGenerating={gridGenerating}
        setGridGenerating={setGridGenerating}
        gridUploading={gridUploading}
        setGridUploading={setGridUploading}
        gridUploadedImages={gridUploadedImages}
        setGridUploadedImages={setGridUploadedImages}
        gridSplitImages={gridSplitImages}
        setGridSplitImages={setGridSplitImages}
        gridSplitCount={gridSplitCount}
        setGridSplitCount={setGridSplitCount}
        gridRemoveBorders={gridRemoveBorders}
        setGridRemoveBorders={setGridRemoveBorders}
        isGridSelectMode={isGridSelectMode}
        setIsGridSelectMode={setIsGridSelectMode}
        gridSelectMousePos={gridSelectMousePos}
        setGridSelectMousePos={setGridSelectMousePos}
        loadGridTemplate={loadGridTemplate}
        handleAddSplitImagesToCanvas={handleAddSplitImagesToCanvas}
        compressBase64IfNeeded={compressBase64IfNeeded}
        imageUrlToBase64={imageUrlToBase64}
        cropImageByCells={cropImageByCells}
        // 画布上下文
        canvas={canvas}
        isCropping={isCropping}
      />
      
      {/* #508 画布页面违规警告弹窗 */}
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

      {/* #508 画布页面禁用弹窗 */}
      <Dialog open={canvasBannedDialogVisible} onOpenChange={(open) => {
        if (!open && isBanned && lockedUntil) return;
        setCanvasBannedDialogVisible(open);
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
              onClick={() => setCanvasBannedDialogVisible(false)}
              className="w-full"
            >
              我知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* #619 视频全屏播放弹窗 */}
      {showVideoFullscreenUrl && (
        <div
          className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center"
          onClick={() => setShowVideoFullscreenUrl(null)}
        >
          <video
            src={showVideoFullscreenUrl}
            autoPlay
            controls
            className="w-[90%] h-[90%] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white text-3xl hover:text-gray-300 transition-colors"
            onClick={() => setShowVideoFullscreenUrl(null)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// 画布常量 - CANVAS_WIDTH 和 CANVAS_HEIGHT 现在由 MainApp 动态计算传入

// 画布内容
function CanvasContent({
  activeTool,
  setActiveTool,
  onSendMessage,
  zoom,
  setZoom,
  pan,
  setPan,
  isCropping,
  setIsCropping,
  isGridSelectMode,
  setIsGridSelectMode,
  onGridImageSelect,
  gridSelectMousePos,
  canvasHeight,
  CANVAS_WIDTH,
  showInfo,
  calculateZoom,
  fitToAllImages,
  canvasContainerRef,
  containerSize,
  handleAddSplitImagesToCanvas,
  cropImageByCells,
  onTriggerUpload,  // #615 新增：触发文件上传
  setShowVideoFullscreenUrl,  // #619 视频全屏播放
  contextMenuUploadTargetRef,  // #621 右键上传目标位置
  fileInputRef,  // #621 文件上传 input ref
}: {
  activeTool: string;
  setActiveTool: React.Dispatch<React.SetStateAction<string>>;
  onSendMessage: (elementId: string, imageUrl?: string, imageName?: string) => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  pan: { x: number; y: number };
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  isCropping: boolean;
  setIsCropping: React.Dispatch<React.SetStateAction<boolean>>;
  isGridSelectMode?: boolean;
  setIsGridSelectMode?: React.Dispatch<React.SetStateAction<boolean>>;
  onGridImageSelect?: (imageUrl: string) => void;
  gridSelectMousePos?: { x: number; y: number };
  canvasHeight: number;
  CANVAS_WIDTH: number;
  showInfo: (title: string, description?: string) => void;
  calculateZoom: (params: import('@/hooks/useCanvasCore').ZoomCalcParams) => import('@/hooks/useCanvasCore').ZoomCalcResult;
  fitToAllImages: (params: import('@/hooks/useCanvasCore').FitToAllImagesParams) => import('@/hooks/useCanvasCore').FitToAllImagesResult;
  canvasContainerRef: React.RefObject<HTMLDivElement | null>;
  containerSize: { width: number; height: number };
  handleAddSplitImagesToCanvas: (splitImages: string[]) => Promise<void>;
  cropImageByCells: (imageSrc: string, cells: Array<{ row: number; col: number; left: number; top: number; right: number; bottom: number }>, needCrop: boolean) => Promise<string[]>;
  // #615 新增：触发文件上传的回调
  onTriggerUpload?: () => void;
  // #619 视频全屏播放
  setShowVideoFullscreenUrl: React.Dispatch<React.SetStateAction<string | null>>;
  // #621 右键上传目标位置（非 null 时表示右键上传模式：不偏移、不居中、放在右击位置）
  contextMenuUploadTargetRef: React.RefObject<{ canvasX: number; canvasY: number } | null>;
  // #621 文件上传 input ref
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const canvas = useCanvas();
  const { theme, setTheme, resolvedTheme } = useTheme();
  // #578 修复：使用 resolvedTheme 而非 theme，解决 SSR 时 theme 为 undefined 导致背景色错误
  const effectiveTheme = resolvedTheme || theme || 'light';
  // SPA 无缝跳转
  const router = useRouter();
  
  // #313 从 AIGeneratorContext 获取生成相关状态
  // 注意：这些状态用于 RightPanel（右下角按钮），generate-panel 使用自己的局部状态
  const {
    handleGenerate,
    isGenerating,
    credits,
    selectedModel,
    selectedRatio,
    selectedResolution,
    selectedCount,
    modelDisplayNames,
    modelConfig,
    imageModelOptions,
    videoModelOptions,
    llmModelOptions,
  } = useAIGenerator();
  
  // #609 方案A：Canvas 交互层（只画拖拽连线，替代 SVG draft-connection-layer）
  const {
    canvasRef: interactionCanvasRef,
    clear: clearInteractionCanvas,
    drawDraftLine,
    drawSnapHighlight,
  } = useInteractionCanvas();
  
  // #军师方案：右侧 Handle 按钮的 hover 状态（ref + forceUpdate 配合）
  const hoveredElementIdRef = useRef<string | null>(null);
  const [, forceUpdateForHover] = useState(0);
  
  // 空格键平移：记住之前的工具
  const previousToolRef = useRef<string | null>(null);
  
  // 同步 activeTool 到 ref（用于拉线检查）
  const activeToolRef = useRef(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  
  // 🔧 #428 修复：画布图片加载失败自动愈合机制（与面板统一）
  // #524 优化：改用后端代理 URL 愈合（浏览器直连 COS 超时）
  const imgRetryCountRef = useRef<Record<string, number>>({});  // imageKey -> 重试次数
  const failedImageIdsRef = useRef<Set<string>>(new Set());  // 已彻底失败的元素 ID（防止无限重试）
  
  // #525 混合架构：图片加载成功后后台缓存到 IndexedDB（不管哪级URL成功都缓存）
  const cacheImageInBackground = useCallback((elementId: string, imageKey: string, imageUrl: string) => {
    if (!imageKey || !imageUrl) return;
    // 不缓存代理URL（代理URL本身就是从IndexedDB或COS读的，没必要再写回来）
    if (imageUrl.startsWith('/api/canvas/image')) return;
    
    import('@/lib/canvas-image-db').then(({ storeImageByKey, getImage }) => {
      // 先检查IndexedDB是否已有缓存，避免重复写入
      getImage(imageKey).then((existing: string | null) => {
        if (existing) return; // 已缓存，跳过
        fetch(imageUrl)
          .then(res => res.blob())
          .then(blob => {
            if (blob && blob.size > 0) {
              storeImageByKey(imageKey, blob, blob.type).catch(console.error);
            }
          })
          .catch(err => {
            console.warn('[cacheImageInBackground] #525 缓存失败:', imageKey.substring(0, 30), err);
          });
      }).catch(console.error);
    }).catch(console.error);
  }, []);

  // 🔧 #428 修复：画布图片自动愈合函数（带熔断保护）
  const handleCanvasImageError = useCallback((elementId: string, imageKey: string | undefined) => {
    if (!imageKey) {
      console.warn('[画布图片愈合] ⚠️ 图片缺少 imageKey，无法重试:', elementId);
      return;
    }

    // 熔断检查：已彻底失败的元素不再重试
    if (failedImageIdsRef.current.has(elementId)) {
      return;
    }

    // #525 混合架构：智能降级链 providerUrl → proxyUrl → 熔断
    const currentEl = canvas.state.elements.find(el => el.id === elementId);
    const currentImageUrl = currentEl?.imageUrl || '';
    const isProxyUrl = currentImageUrl.startsWith('/api/canvas/image');
    const isProviderUrl = !isProxyUrl && currentEl?.providerUrl && currentImageUrl === currentEl.providerUrl;

    if (isProviderUrl) {
      // 第1级降级：服务商URL失败 → 尝试代理URL
      // #842 移除 _t=${Date.now()}：缓存杀手打穿浏览器缓存
      const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(imageKey)}`;
      canvas.updateElement(elementId, { imageUrl: proxyUrl });
      return;
    }

    // 代理URL也失败了 → 进入重试+熔断逻辑
    const currentRetries = imgRetryCountRef.current[imageKey] || 0;
    if (currentRetries >= 3) {
      console.warn('[画布图片愈合] 🛑 图片重试超过3次已熔断:', imageKey);
      failedImageIdsRef.current.add(elementId);
      // 标记元素为过期状态
      canvas.updateElement(elementId, { generationStatus: 'expired' });
      return;
    }

    imgRetryCountRef.current[imageKey] = currentRetries + 1;

    // #842 移除 _t=${Date.now()}：缓存杀手打穿浏览器缓存
    const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(imageKey)}`;
    canvas.updateElement(elementId, { imageUrl: proxyUrl });
  }, [canvas]);
  
  // #军师方案：流光连线状态（Bypass React - 零渲染）
  // 👑 简化为两种状态：无连线 / 正在画线
  const draftLineRef = useRef<{
    active: boolean;           // 是否正在画线
    startX: number;            // 画布起始 X
    startY: number;            // 画布起始 Y
    sourceId: string | null;   // 源节点 ID
    sourceType: 'image' | 'panel' | 'image-stack' | 'multi-select' | 'video' | null;  // 源节点类型
    sourcePanelType?: 'image' | 'video' | 'text' | null;   // #视频功能 补丁一：源面板类型（用于拦截视频面板输出连线）
    snapTargetId: string | null;  // 磁吸目标面板 ID
    snapPortX: number;         // 磁吸端口屏幕 X
    snapPortY: number;         // 磁吸端口屏幕 Y
  }>({
    active: false,
    startX: 0,
    startY: 0,
    sourceId: null,
    sourceType: null,
    sourcePanelType: null,
    snapTargetId: null,
    snapPortX: 0,
    snapPortY: 0,
  });
  
  // #382 关键修复：全局连线状态（纯 ref，绝不触发 React 渲染）
  // #60fps Phase1: 删除 useState，只保留 useRef，连线操作不再触发 page.tsx 重渲染
  const isConnectionActiveGlobalRef = useRef(false);  // 立即更新，无延迟
  
  // #433 性能优化：handleMouseMove 节流
  const mouseMoveRafRef = useRef<number | null>(null);
  const pendingMouseMoveRef = useRef<React.MouseEvent | null>(null);
  
  // #436 性能优化：端口高亮状态比对 + DOM 缓存
  const lastSnapTargetIdRef = useRef<string | null>(null);
  const magnetDomCacheRef = useRef<Map<string, HTMLElement>>(new Map());
  
  // #384 当前拖拽连线的源ID（用于判断面板是否已连接该源）
  // #60fps Phase1: 删除 useState，改为 useRef，连线操作不再触发 page.tsx 重渲染
  const connectionDraftSourceIdRef = useRef<string | null>(null);
  
  // 👑 #60fps Phase1: 统一 DOM 控制器 —— 连线视觉状态全由纯 DOM 操作管理
  // 绝不通过 React State/渲染传递 opacity/highlight，彻底消除连线期间的渲染风暴
  // ⚠️ 绝对禁止使用 filter: grayscale()！它会触发 Chrome 重栅格化，导致图片变糊！
  // ✅ 只用 opacity + classList，透明度变化在 Chrome 中有完美的 GPU 加速
  const updateCanvasVisualState = useCallback((options: {
    draftSourceId?: string | null;   // 当前拖拽连线的源ID
    snapTargetId?: string | null;    // 当前磁吸目标ID
    isDragging?: boolean;            // 是否正在拖拽连线
  }) => {
    const { draftSourceId, snapTargetId, isDragging } = options;

    // 1. 更新 ref（供逻辑判断使用，不触发渲染）
    if (draftSourceId !== undefined) {
      connectionDraftSourceIdRef.current = draftSourceId;
    }
    if (isDragging !== undefined) {
      isConnectionActiveGlobalRef.current = isDragging;
    }

    // 2. 灰显已连接源的面板（纯 DOM classList 操作）
    // #60fps Phase1: 查询所有带 data-source-ids 的元素（覆盖图片、视频、面板、image-stack）
    const currentSourceId = draftSourceId !== undefined ? draftSourceId : connectionDraftSourceIdRef.current;
    const allWrappers = document.querySelectorAll('[data-source-ids]');
    allWrappers.forEach((wrapper) => {
      const el = wrapper as HTMLElement;
      const sourceIdsStr = el.getAttribute('data-source-ids') || '';
      const sourceIds = sourceIdsStr ? sourceIdsStr.split(',') : [];
      
      if (currentSourceId && sourceIds.includes(currentSourceId)) {
        el.classList.add('is-dimmed');
      } else {
        el.classList.remove('is-dimmed');
      }
    });

    // 3. 磁吸端口高亮（纯 DOM classList 操作）
    const currentSnapId = snapTargetId !== undefined ? snapTargetId : null;
    // 先清除所有高亮
    document.querySelectorAll('.snap-highlight-active').forEach(el => {
      el.classList.remove('snap-highlight-active');
    });
    // 再设置新高亮（使用 data-element-id 匹配所有类型节点）
    if (currentSnapId) {
      const targetEl = document.querySelector(`[data-element-id="${currentSnapId}"]`);
      if (targetEl) {
        targetEl.classList.add('snap-highlight-active');
      }
    }
  }, []);

  // 👑 #60fps Phase1: 连线状态清理（确保所有 edge case 下视觉状态正确恢复）
  // 必须在：成功连线、取消连线、鼠标移出浏览器、Escape 键 等所有出口调用
  const resetConnectionVisualState = useCallback(() => {
    updateCanvasVisualState({
      draftSourceId: null,
      snapTargetId: null,
      isDragging: false,
    });
  }, [updateCanvasVisualState]);

  // 👑 #60fps Phase1: 磁吸高亮状态（纯 ref，绝不触发 React 渲染）
  const snapHighlightIdRef = useRef<string | null>(null);
  
  // #军师方案：引用生成菜单状态
  // #334 新增：canvasX, canvasY 存储画布坐标（用于创建面板）
  const [generateMenu, setGenerateMenu] = useState<{ 
    visible: boolean; 
    x: number;      // 屏幕坐标（用于菜单显示位置）
    y: number; 
    canvasX?: number; // 画布坐标（用于创建面板位置）
    canvasY?: number;
    sourceId: string | null;
    sourceIds?: string[]; // 多选拉线时，所有选中的源元素ID
    sourceType?: string;  // 源类型（'multi-select' 表示多选拉线）
    sourceElementType?: 'image' | 'video' | 'panel';  // #621 源元素的DOM类型（用于决定菜单按钮可见性）
    // #615 新增：保存 selectionBox 尺寸（clearSelection 后 selectionBox 会变成 null）
    selectionBoxWidth?: number;
    selectionBoxHeight?: number;
  }>({
    visible: false, x: 0, y: 0, sourceId: null
  });
  
  // #分离式面板：记录当前哪个生图节点展开了下方输入控制台
  const [activeInputNodeId, setActiveInputNodeId] = useState<string | null>(null);
  
  // #096 修复：SSR Hydration 撕裂 - 使用 isMounted 状态锁
  // 带有 transform 动态坐标的 DOM 节点，只在客户端挂载后才渲染
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  
  // #043 性能优化：拦截无效的跨域 postMessage（阻止控制台报错消耗性能）
  // #046 修复：跨域访问 window.parent 会抛出 SecurityError
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      // 尝试访问 window.parent，如果跨域会抛出 SecurityError
      const parentWindow = window.parent;
      if (!parentWindow || parentWindow === window) {
        // 没有父窗口或自己就是顶层窗口，无需拦截
        return;
      }
      
      // 尝试访问 postMessage，跨域时会抛出错误
      const originalPostMessage = parentWindow.postMessage.bind(parentWindow);
      
      // 替换为安全版本
      parentWindow.postMessage = function(message: any, targetOrigin?: string, transfer?: Transferable[]) {
        // 如果目标域名不匹配当前环境，直接返回不发送
        if (targetOrigin === 'https://code.coze.cn' && !window.location.href.includes('coze.cn')) {
          return; // 静默拦截，不报错
        }
        // 其他情况正常发送
        return originalPostMessage(message as any, targetOrigin as any, transfer as any);
      } as any;
      
      return () => {
        // 恢复原始方法
        parentWindow.postMessage = originalPostMessage;
      };
    } catch (e) {
      // 跨域访问失败，静默忽略
    }
  }, []);
  
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [isDragging, setIsDraggingState] = useState(false);
  const [isPanelDragging, setIsPanelDragging] = useState(false);  // #345 面板拖拽状态
  
  // 【临时】画布玫瑰曲线预览（参考完毕后删除）
  const roseColor = theme === 'dark' ? '#ffffff' : '#e84393';
  const [roseGradientBg, setRoseGradientBg] = useState(true);
  const isDraggingRef = useRef(isDragging);
  
  // 包装函数：同步设置状态和 ref
  const setIsDragging = useCallback((value: boolean) => {
    isDraggingRef.current = value; // 立即更新 ref（同步）
    setIsDraggingState(value); // 更新状态（异步，触发重新渲染）
  }, []);
  
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, elX: 0, elY: 0 }); // 添加元素初始位置
  const [dragElement, setDragElement] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; elementId?: string; isMultiSelect?: boolean; canvasX?: number; canvasY?: number } | null>(null);
  const [shapeStart, setShapeStart] = useState<{ x: number; y: number } | null>(null);
  const [shapePreview, setShapePreview] = useState<{ x: number; y: number; width: number; height: number; type: string } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; corner: string; startX: number; startY: number; startW: number; startH: number; startElX: number; startElY: number; aspectRatio?: number; startFontSize?: number } | null>(null);
  
  // 裁剪相关状态
  const [cropImageId, setCropImageId] = useState<string | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [cropHandle, setCropHandle] = useState<string | null>(null);
  const [cropRatio, setCropRatio] = useState<'free' | '1:1' | '4:3' | '3:4' | '3:2' | '2:3' | '16:9' | '9:16' | '21:9' | '9:21'>('free'); // 裁剪比例
  
  // #491 修复：监听裁剪图片是否被删除，自动清除裁剪状态
  useEffect(() => {
    if (cropImageId && isCropping) {
      const cropElement = canvas.state.elements.find(el => el.id === cropImageId);
      if (!cropElement) {
        // 裁剪图片已被删除，清除裁剪状态
        setIsCropping(false);
        setCropImageId(null);
        setCropRect(null);
        setCropHandle(null);
      }
    }
  }, [canvas.state.elements, cropImageId, isCropping]);
  
  // #299 新增：选中框整体缩放
  // 计算选中元素的边界框
  const selectionBox = useMemo(() => {
    const selectedIds = canvas.state.selectedIds;
    if (selectedIds.length === 0) return null;
    
    const selectedElements = canvas.state.elements.filter(
      el => selectedIds.includes(el.id) && el.visible !== false
    );
    if (selectedElements.length === 0) return null;
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    selectedElements.forEach(el => {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    });
    
    // #299 优化：增加留白间距，确保边框与内容不重叠
    // 注意：这是画布坐标，会被 zoom 缩放显示
    const PADDING = 30;  // 增大间距
    
    return {
      x: minX - PADDING,
      y: minY - PADDING,
      width: (maxX - minX) + PADDING * 2,
      height: (maxY - minY) + PADDING * 2,
    };
  }, [canvas.state.selectedIds, canvas.state.elements]);

  // #60fps Phase3: 静态连线计算 → useMemo 隔离，拖拽期间不重计算
  const staticConnections = useMemo(() => {
    const connections: { sourceId: string; targetId: string; sourceNode: (typeof canvas.state.elements)[0]; targetNode: (typeof canvas.state.elements)[0] }[] = [];
    canvas.state.elements.forEach(targetNode => {
      const sourceIds = targetNode.sourceIds || (targetNode.sourceId ? [targetNode.sourceId] : []);
      sourceIds.forEach(sourceId => {
        const sourceNode = canvas.state.elements.find(e => e.id === sourceId);
        if (sourceNode) {
          connections.push({ sourceId, targetId: targetNode.id, sourceNode, targetNode });
        }
      });
    });
    return connections;
  }, [canvas.state.elements]);

  // #60fps Phase3: 脉冲连线坐标 → useMemo 隔离，只在 selectedIds/elements 变化时重计算
  const activePulseConnections = useMemo(() => {
    const activeConnections: { id: string; startX: number; startY: number; endX: number; endY: number }[] = [];
    canvas.state.elements.forEach(targetNode => {
      const sourceIds = targetNode.sourceIds || (targetNode.sourceId ? [targetNode.sourceId] : []);
      sourceIds.forEach(sourceId => {
        const sourceNode = canvas.state.elements.find(e => e.id === sourceId);
        if (!sourceNode) return;
        const isSourceSelected = canvas.state.selectedIds.includes(sourceNode.id);
        const isTargetSelected = canvas.state.selectedIds.includes(targetNode.id);
        if (!isSourceSelected && !isTargetSelected) return;
        let startX: number, startY: number;
        if (sourceNode.type === 'image') {
          startX = sourceNode.x + sourceNode.width;
          startY = sourceNode.y + sourceNode.height / 2;
        } else if (sourceNode.type === 'image-stack') {
          startX = sourceNode.x + (sourceNode.width || 280) / 2;
          startY = sourceNode.y + (sourceNode.height || 280);
        } else {
          startX = sourceNode.x + sourceNode.width;
          startY = sourceNode.y + sourceNode.height / 2;
        }
        let endX: number, endY: number;
        if (targetNode.type === 'generate-panel') {
          endX = targetNode.x;
          endY = targetNode.y + targetNode.height / 2;
        } else if (targetNode.type === 'image-stack') {
          endX = targetNode.x + (targetNode.width || 280) / 2;
          endY = targetNode.y;
        } else {
          endX = targetNode.x;
          endY = targetNode.y + targetNode.height / 2;
        }
        activeConnections.push({
          id: `pulse-${targetNode.id}-${sourceId}`,
          startX, startY, endX, endY,
        });
      });
    });
    return activeConnections;
  }, [canvas.state.elements, canvas.state.selectedIds]);
  
  // 选中框缩放状态
  const [isSelectionResizing, setIsSelectionResizing] = useState(false);
  
  // 形状工具栏
  const [shapeToolbarPanel, setShapeToolbarPanel] = useState<'fill' | 'stroke' | null>(null); // 默认不展开
  const [shapeToolbarHue, setShapeToolbarHue] = useState(200);
  const [aspectRatioLocked, setAspectRatioLocked] = useState(true); // 宽高比例锁定（默认锁定）
  const aspectRatioRef = useRef<number | null>(null); // 存储锁定时的宽高比（height/width）
  
  // 选中形状变化时，重置面板状态并默认锁定宽高比
  useEffect(() => {
    setShapeToolbarPanel(null);
    // 默认锁定宽高比，并设置当前元素的宽高比
    if (canvas.state.selectedIds.length === 1) {
      const el = canvas.state.elements.find(e => e.id === canvas.state.selectedIds[0]);
      if (el) {
        aspectRatioRef.current = el.width > 0 ? el.height / el.width : null;
        setAspectRatioLocked(true);
      } else {
        setAspectRatioLocked(true);
        aspectRatioRef.current = null;
      }
    } else {
      setAspectRatioLocked(true);
      aspectRatioRef.current = null;
    }
  }, [canvas.state.selectedIds]);
  
  // 智能对齐线 - 拖动时显示
  const [alignLines, setAlignLines] = useState<{
    horizontal: { y: number; x1: number; x2: number }[];
    vertical: { x: number; y1: number; y2: number }[];
  }>({ horizontal: [], vertical: [] });
  
  // #339 使用 useCallback 包裹 setAlignLines，防止不必要的重渲染
  const handleSetAlignLines = useCallback((lines: typeof alignLines) => {
    setAlignLines(lines);
  }, []);
  
  // #343 面板拖拽对齐计算中枢 - 接收面板实时坐标，计算全局对齐线
  // #345 动态吸附阈值：确保任何缩放倍率下视觉吸附范围稳定
  const lastPanelAlignStrRef = useRef<string>('');  // #344 状态防抖

  // #344 双向磁吸拦截：同步计算吸附坐标
  // 将对齐计算提取为同步函数，直接返回吸附后的坐标
  const calculateSnapPosition = useCallback((panelId: string, x: number, y: number, width: number, height: number) => {
    // #345 动态阈值：视觉吸附范围 4px（画布坐标）
    const currentZoom = zoom || 1;
    const SNAP_THRESHOLD = 4 / currentZoom;
    
    // #磁吸距离限制：只检测容器宽度 30% 以内的元素
    const containerWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const MAX_SNAP_DISTANCE = containerWidth * 0.3 / currentZoom; // 画布坐标
    
    let snappedX = x;
    let snappedY = y;
    const newAlignLines: typeof alignLines = {
      horizontal: [],
      vertical: []
    };
    
    // 当前拖动元素的边界
    const dragLeft = x;
    const dragRight = x + width;
    const dragTop = y;
    const dragBottom = y + height;
    const dragCenterX = x + width / 2;
    const dragCenterY = y + height / 2;
    
    // 获取其他元素（排除当前面板，且距离在限制范围内）
    const otherElements = canvas.state.elements.filter(el => {
      if (el.id === panelId) return false;
      // #磁吸距离限制：计算元素中心距离，过滤超过限制的元素
      const elCenterX = el.x + (el.width || 200) / 2;
      const elCenterY = el.y + (el.height || 150) / 2;
      const distance = Math.sqrt((dragCenterX - elCenterX) ** 2 + (dragCenterY - elCenterY) ** 2);
      return distance <= MAX_SNAP_DISTANCE;
    });
    
    // 水平对齐（检测垂直线）→ 影响 snappedX
    for (const other of otherElements) {
      const otherWidth = other.width || 200;
      const otherHeight = other.height || 150;
      const otherLeft = other.x;
      const otherRight = other.x + otherWidth;
      const otherCenterX = other.x + otherWidth / 2;
      
      // 左边对齐左边
      if (Math.abs(dragLeft - otherLeft) < SNAP_THRESHOLD) {
        snappedX = otherLeft;
        newAlignLines.vertical.push({ x: otherLeft, y1: Math.min(dragTop, other.y), y2: Math.max(dragBottom, other.y + otherHeight) });
      }
      // 左边对齐右边
      else if (Math.abs(dragLeft - otherRight) < SNAP_THRESHOLD) {
        snappedX = otherRight;
        newAlignLines.vertical.push({ x: otherRight, y1: Math.min(dragTop, other.y), y2: Math.max(dragBottom, other.y + otherHeight) });
      }
      // 右边对齐右边
      else if (Math.abs(dragRight - otherRight) < SNAP_THRESHOLD) {
        snappedX = otherRight - width;
        newAlignLines.vertical.push({ x: otherRight, y1: Math.min(dragTop, other.y), y2: Math.max(dragBottom, other.y + otherHeight) });
      }
      // 右边对齐左边
      else if (Math.abs(dragRight - otherLeft) < SNAP_THRESHOLD) {
        snappedX = otherLeft - width;
        newAlignLines.vertical.push({ x: otherLeft, y1: Math.min(dragTop, other.y), y2: Math.max(dragBottom, other.y + otherHeight) });
      }
      // 中心对齐
      else if (Math.abs(dragCenterX - otherCenterX) < SNAP_THRESHOLD) {
        snappedX = otherCenterX - width / 2;
        newAlignLines.vertical.push({ x: otherCenterX, y1: Math.min(dragTop, other.y), y2: Math.max(dragBottom, other.y + otherHeight) });
      }
    }
    
    // 垂直对齐（检测水平线）→ 影响 snappedY
    for (const other of otherElements) {
      const otherWidth = other.width || 200;
      const otherHeight = other.height || 150;
      const otherTop = other.y;
      const otherBottom = other.y + otherHeight;
      const otherCenterY = other.y + otherHeight / 2;
      
      // 顶边对齐顶边
      if (Math.abs(dragTop - otherTop) < SNAP_THRESHOLD) {
        snappedY = otherTop;
        newAlignLines.horizontal.push({ y: otherTop, x1: Math.min(dragLeft, other.x), x2: Math.max(dragRight, other.x + otherWidth) });
      }
      // 顶边对齐底边
      else if (Math.abs(dragTop - otherBottom) < SNAP_THRESHOLD) {
        snappedY = otherBottom;
        newAlignLines.horizontal.push({ y: otherBottom, x1: Math.min(dragLeft, other.x), x2: Math.max(dragRight, other.x + otherWidth) });
      }
      // 底边对齐底边
      else if (Math.abs(dragBottom - otherBottom) < SNAP_THRESHOLD) {
        snappedY = otherBottom - height;
        newAlignLines.horizontal.push({ y: otherBottom, x1: Math.min(dragLeft, other.x), x2: Math.max(dragRight, other.x + otherWidth) });
      }
      // 底边对齐顶边
      else if (Math.abs(dragBottom - otherTop) < SNAP_THRESHOLD) {
        snappedY = otherTop - height;
        newAlignLines.horizontal.push({ y: otherTop, x1: Math.min(dragLeft, other.x), x2: Math.max(dragRight, other.x + otherWidth) });
      }
      // 垂直中心对齐
      else if (Math.abs(dragCenterY - otherCenterY) < SNAP_THRESHOLD) {
        snappedY = otherCenterY - height / 2;
        newAlignLines.horizontal.push({ y: otherCenterY, x1: Math.min(dragLeft, other.x), x2: Math.max(dragRight, other.x + otherWidth) });
      }
    }
    
    return { snappedX, snappedY, newAlignLines };
  }, [canvas.state.elements, zoom]);

  // #344 双向磁吸拦截：返回吸附后的坐标给面板使用
  const handlePanelDragMoveForAlignment = useCallback((panelId: string, x: number, y: number, width: number, height: number) => {
    // #345 设置面板拖拽状态（用于显示对齐线）
    setIsPanelDragging(true);
    
    // 同步计算吸附坐标
    const { snappedX, snappedY, newAlignLines } = calculateSnapPosition(panelId, x, y, width, height);
    
    // 状态防抖：只有对齐线真正变化时才更新
    const newAlignLinesStr = JSON.stringify(newAlignLines);
    if (newAlignLinesStr !== lastPanelAlignStrRef.current) {
      lastPanelAlignStrRef.current = newAlignLinesStr;
      setAlignLines(newAlignLines);
    }
    
    // 👑 绝杀：返回吸附后的坐标给面板！
    return { snappedX, snappedY };
  }, [calculateSnapPosition]);
  
  // #344 面板拖拽结束清理（简化版，不再需要 RAF 清理）
  const handlePanelDragEnd = useCallback(() => {
    setIsPanelDragging(false);  // #345 清除面板拖拽状态
    lastPanelAlignStrRef.current = '';
    setAlignLines({ horizontal: [], vertical: [] });
    // #411 延迟恢复脉冲显示
    setIsPulseReady(false);
    if (pulseReadyTimeoutRef.current) clearTimeout(pulseReadyTimeoutRef.current);
    pulseReadyTimeoutRef.current = setTimeout(() => setIsPulseReady(true), 50);
  }, []);
  
  // 使用ref存储最新的zoom和pan值，确保事件处理程序中能获取到最新值
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;
  
  // 剪贴板 - 与全局window对象同步
  const [clipboard, setClipboard] = useState<CanvasElement[]>([]);
  
  // 同步全局剪贴板到本地状态
  useEffect(() => {
    const syncClipboard = () => {
      const globalClipboard = (window as any).__canvasClipboard;
      if (globalClipboard && globalClipboard.length > 0) {
        setClipboard(globalClipboard);
      }
    };
    
    // 初始同步
    syncClipboard();
    
    // 定期同步（用于捕获Ctrl+C事件后的更新）
    const interval = setInterval(syncClipboard, 100);
    return () => clearInterval(interval);
  }, []);
  
  // 对齐与居中快捷键
  useEffect(() => {
    const handleAlignKeydown = (e: KeyboardEvent) => {
      // 仅在多选图片时生效
      const selectedImages = canvas.state.elements.filter(
        el => el.type === 'image' && canvas.state.selectedIds.includes(el.id) && el.visible
      );
      if (selectedImages.length < 2) return;
      
      // Shift + H - 水平间距
      if (e.shiftKey && (e.key === 'H' || e.key === 'h')) {
        e.preventDefault();
        const sorted = [...selectedImages].sort((a, b) => a.x - b.x);
        const leftmost = sorted[0].x;
        const rightmost = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width;
        const totalWidth = sorted.reduce((sum, el) => sum + el.width, 0);
        const gap = (rightmost - leftmost - totalWidth) / (sorted.length - 1);
        // #584 修复：使用 updateElementsBatch 避免循环调用 updateElement 导致 React 19 insertBefore 错误
        const batchUpdates: Array<{ id: string; updates: Partial<CanvasElement> }> = [];
        let currentX = leftmost;
        sorted.forEach((el) => {
          batchUpdates.push({ id: el.id, updates: { x: currentX } });
          currentX += el.width + gap;
        });
        canvas.updateElementsBatch(batchUpdates);
        return;
      }
      
      // Shift + V - 垂直间距
      if (e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        const sorted = [...selectedImages].sort((a, b) => a.y - b.y);
        const topmost = sorted[0].y;
        const bottommost = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height;
        const totalHeight = sorted.reduce((sum, el) => sum + el.height, 0);
        const gap = (bottommost - topmost - totalHeight) / (sorted.length - 1);
        // #584 修复：使用 updateElementsBatch 避免循环调用 updateElement 导致 React 19 insertBefore 错误
        const batchUpdates: Array<{ id: string; updates: Partial<CanvasElement> }> = [];
        let currentY = topmost;
        sorted.forEach((el) => {
          batchUpdates.push({ id: el.id, updates: { y: currentY } });
          currentY += el.height + gap;
        });
        canvas.updateElementsBatch(batchUpdates);
        return;
      }
      
      // Shift + A - 自动排列
      if (e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        const sortedElements = [...selectedImages].sort((a, b) => {
          const areaA = a.width * a.height;
          const areaB = b.width * b.height;
          return areaB - areaA;
        });
        const gap = 8;
        // #584 修复：使用 updateElementsBatch 避免循环调用 updateElement 导致 React 19 insertBefore 错误
        const batchUpdates: Array<{ id: string; updates: Partial<CanvasElement> }> = [];
        let currentX = sortedElements[0].x;
        let currentY = sortedElements[0].y;
        sortedElements.forEach((el) => {
          batchUpdates.push({ id: el.id, updates: { x: currentX, y: currentY } });
          currentX += el.width + gap;
        });
        canvas.updateElementsBatch(batchUpdates);
        return;
      }
    };
    
    window.addEventListener('keydown', handleAlignKeydown);
    return () => window.removeEventListener('keydown', handleAlignKeydown);
  }, [canvas]);

  // 画布初始化状态
  const [initialized, setInitialized] = useState(false);
  
  // 空格键拖拽
  const [spacePressed, setSpacePressed] = useState(false);
  const spacePressedRef = useRef(false); // 用于同步检查
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, panX: 0, panY: 0 });
  
  // 缩放状态（用于禁用脉冲动画）
  const [isZooming, setIsZooming] = useState(false);
  const zoomingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // 脉冲延迟恢复：确保位置数据已更新再显示
  const [isPulseReady, setIsPulseReady] = useState(true);
  const pulseReadyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // 框选相关
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionRect, setSelectionRect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  
  // 画笔相关
  const [penColor, setPenColor] = useState('#000000');
  const [penSize, setPenSize] = useState(3);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [penHue, setPenHue] = useState(0);
  const [penSaturation, setPenSaturation] = useState(0);
  const [penBrightness, setPenBrightness] = useState(0);
  const [penOpacity, setPenOpacity] = useState(100);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPath, setDrawPath] = useState<{ x: number; y: number }[]>([]);
  
  // 形状工具栏的色相纯色
  const shapeToolbarHueColor = hsbToHex(shapeToolbarHue, 100, 100);
  
  // 当前画笔色相对应的纯色
  const penHueColor = hsbToHex(penHue, 100, 100);
  
  // 双击检测：单击定时器ref，用于区分单击和双击
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastClickRef = useRef<{ time: number; id: string | null }>({ time: 0, id: null });
  const DOUBLE_CLICK_DELAY = 250; // 双击间隔（毫秒）
  
  // 组件卸载时清除定时器，防止内存泄漏
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
    };
  }, []);
  
  // 双击选择模式下，清除选中状态
  useEffect(() => {
    if (isGridSelectMode) {
      canvas.clearSelection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGridSelectMode]);
  
  // 点击非画布区域时自动切换回选择工具或取消特殊模式
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const targetTagName = target.tagName;
      const targetClassStr = typeof target.className === 'string' ? target.className : '';

      // 🔥 关键：检查是否点击在画布区域内
      const isCanvasArea = !!target.closest('[data-canvas-area="true"]');
      const isImage = !!target.closest('[data-image-element="true"]');
      const isModal = !!target.closest('[data-modal="true"]');
      const isCropHandle = !!target.closest('[data-crop-handle="true"]'); // 🔥 新增：检查是否点击裁剪框

      // 🔥 如果点击的是裁剪框触发区域，直接返回，不处理
      if (isCropHandle) {
        return;
      }

      // 【从画布添加模式】极简处理
      if (isGridSelectMode && setIsGridSelectMode) {
        // 🔥 只要点击在画布区域内，就保持模式（包括图片、空白区域、canvas层）
        if (isCanvasArea) {
          return;
        }
        
        // 🔥 点到弹窗，不退出模式
        if (isModal) {
          return;
        }
        
        // 🔥 点到其他任何地方：直接退出模式
        setIsGridSelectMode(false);
        return;
      }
      
      // 【普通模式】切换工具逻辑
      // 检查点击是否在画布区域内
      const canvasArea = target.closest('[data-canvas-area="true"]');
      
      // 检查是否点击在UI组件上
      const isToolbar = target.closest('[data-toolbar="true"]');
      const isDropdown = target.closest('[data-dropdown="true"]');
      const isContextMenu = target.closest('[data-context-menu="true"]');
      // isModal 已经在上面定义了
      
      // 如果点击不在画布区域内，且不在任何UI组件上
      if (!canvasArea && !isToolbar && !isModal && !isDropdown && !isContextMenu) {
        // 如果当前不是选择工具，切换回选择工具
        if (activeTool !== 'select') {
          // 切换回选择工具
          setActiveTool('select');
          canvas.setTool('select');
          
          // 清理画笔状态
          if (activeTool === 'pen') {
            setIsDrawing(false);
            setDrawPath([]);
          }
          
          // 清理形状预览
          setShapeStart(null);
          setShapePreview(null);
        }
      }
    };
    
    // 🔥 绑定 click，使用冒泡阶段（让裁剪框的 mousedown 先触发）
    window.addEventListener('click', handleGlobalClick, false);
    return () => {
      window.removeEventListener('click', handleGlobalClick, false);
    };
  }, [activeTool, canvas, setActiveTool, setIsDrawing, setDrawPath, setShapeStart, setShapePreview, isGridSelectMode, setIsGridSelectMode]);
  
  // 裁剪相关的 ref
  const cropLongPressTimerRef = useRef<NodeJS.Timeout | null>(null); // 长按定时器
  const cropDragRef = useRef<{ 
    isDragging: boolean; 
    startX: number; 
    startY: number; 
    rectX: number; 
    rectY: number; 
    rectW: number; 
    rectH: number; 
    handle: string; 
  } | null>(null);
  
  const cropRafRef = useRef<number | null>(null); // requestAnimationFrame ID
  const pendingRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const cropRatioRef = useRef(cropRatio); // 存储最新的裁剪比例
  
  // #583 修复：拉伸和拖拽的 RAF 批量更新，避免 React 19 并发渲染 insertBefore 错误
  const resizeRafRef = useRef<number | null>(null);
  const resizePendingRef = useRef<{ id: string; updates: Partial<CanvasElement> } | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const dragPendingRef = useRef<Array<{ id: string; updates: Partial<CanvasElement> }>>([]);
  
  // #348 连线长按检测 → 改为拖拽阈值检测
  const connectionDragStartRef = useRef<{ x: number; y: number; sourceId: string; sourceType: 'image' | 'panel' | 'multi-select' | 'video'; startX: number; startY: number } | null>(null);
  const connectionDragTriggeredRef = useRef(false);
  
  // 同步 cropRatio 到 ref
  useEffect(() => {
    cropRatioRef.current = cropRatio;
  }, [cropRatio]);

  // 关闭右键菜单
  // #615 修复：排除右键菜单内的点击，防止按钮点击无效
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // 检查点击是否在右键菜单内
      const isContextMenu = target.closest('[data-context-menu="true"]');
      if (!isContextMenu) {
        setContextMenu(null);
      }
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // 初始化画布：设置初始缩放和居中位置
  // #038 修复：简化逻辑，直接检查 localStorage 是否有存档
  useEffect(() => {
    if (initialized || !containerRef.current) return;
    
    // 检查是否有图片元素
    const hasImages = canvas.state.elements.filter(el => el.type === 'image' && el.visible).length > 0;
    
    // 直接检查 localStorage 是否有存档
    const savedState = localStorage.getItem('canvas_data');
    let hasValidSavedPosition = false;
    
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        // 🔧 #126 修复：必须同时满足两个条件才认为有有效存档
        // 1. 存档中有图片元素
        // 2. zoom/pan 有变化（不是默认值）
        const hasSavedImages = parsed.elements && 
          parsed.elements.some((el: any) => el.type === 'image');
        
        const hasNonDefaultPosition = 
          (parsed.zoom !== undefined && parsed.zoom !== 100) ||
          (parsed.panX !== undefined && parsed.panX !== 0) ||
          (parsed.panY !== undefined && parsed.panY !== 0);
        
        // 只有当存档中有图片元素，且 zoom/pan 有变化时，才使用存档位置
        // 如果存档中没有图片元素，则忽略 zoom/pan 存档，使用默认初始化
        hasValidSavedPosition = hasSavedImages && hasNonDefaultPosition;
        
      } catch (e) {
        // 解析失败，继续执行
      }
    }
    
    if (hasImages) {
      // 有图片，自动调用 fitToAllImages 显示所有图片
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      
      const result = fitToAllImages({
        elements: canvas.state.elements,
        containerWidth: containerRect.width,
        containerHeight: containerRect.height,
        canvasWidth: CANVAS_WIDTH,
        canvasHeight: canvasHeight,
      });
      
      
      setZoom(result.zoom);
      setPan({ x: result.panX, y: result.panY });
    } else if (!hasValidSavedPosition) {
      // 无图片且无有效存档，执行默认初始化
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();

      // 🔧 #124 修复：使用固定高度而非固定宽度
      // CANVAS_HEIGHT = 60000 是固定值，INITIAL_VISIBLE_HEIGHT = 15000 表示看到画布高度的 1/4
      // 这样无论容器比例如何，用户看到的画布比例一致
      const INITIAL_VISIBLE_HEIGHT = 15000;
      const initialZoom = containerRect.height / INITIAL_VISIBLE_HEIGHT;

      // 计算画布位置：让画布中心对齐容器中心
      const canvasScreenW = CANVAS_WIDTH * initialZoom;
      const canvasScreenH = CANVAS_HEIGHT * initialZoom;
      const panX = (containerRect.width - canvasScreenW) / 2;
      const panY = (containerRect.height - canvasScreenH) / 2;


      setZoom(initialZoom);
      setPan({ x: panX, y: panY });
    }
    // 如果有有效存档但无图片，使用惰性初始化，不需要操作
    
    setInitialized(true);
  }, [initialized, CANVAS_WIDTH, CANVAS_HEIGHT, canvas.state.elements]);

  // 键盘事件：空格键拖拽、ESC退出裁剪、Ctrl+0缩放至全貌
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果焦点在输入框、文本域或可编辑元素上，不拦截空格键
      const target = e.target as HTMLElement;
      const isInputElement = target.tagName === 'INPUT' || 
                             target.tagName === 'TEXTAREA' || 
                             target.isContentEditable;
      
      if (e.code === 'Space' && !e.repeat && !isInputElement) {
        e.preventDefault();
        spacePressedRef.current = true; // 同步更新 ref
        setSpacePressed(true);
        // 记住当前工具并切换到平移工具
        if (activeTool !== 'hand') {
          previousToolRef.current = activeTool;
          setActiveTool('hand');
          canvas.setTool('hand');
          canvas.clearSelection(); // 切换到手型工具时取消选择
        }
      }
      
      // ESC键退出裁剪模式
      if (e.key === 'Escape' && isCropping) {
        setIsCropping(false);
        setCropImageId(null);
        setCropRect(null);
        setCropHandle(null);
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputElement = target.tagName === 'INPUT' || 
                             target.tagName === 'TEXTAREA' || 
                             target.isContentEditable;
      
      if (e.code === 'Space' && !isInputElement) {
        spacePressedRef.current = false; // 同步更新 ref
        setSpacePressed(false);
        setIsPanning(false);
        // 恢复原来的工具
        if (previousToolRef.current) {
          const prevTool = previousToolRef.current;
          setActiveTool(prevTool);
          // 根据工具类型恢复 canvas 工具状态
          if (prevTool === 'select' || prevTool === 'hand') {
            canvas.setTool(prevTool);
          }
          previousToolRef.current = null;
        }
      }
    };
    
    // 使用 capture 阶段确保在输入框获得焦点时也能捕获空格键
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keyup', handleKeyUp, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [isCropping, setIsCropping, activeTool, setActiveTool]);

  // 滚轮缩放画布
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // #362 滚轮缩放时取消连线（检查菜单是否可见）
      if (generateMenu.visible) {
        // 清除连线状态
        connectionDragStartRef.current = null;
        connectionDragTriggeredRef.current = false;
        draftLineRef.current = { active: false, sourceId: null, sourceType: null, startX: 0, startY: 0, snapTargetId: null, snapPortX: 0, snapPortY: 0 };
        // #60fps Phase1: 纯 ref 更新，不触发 React 渲染
        isConnectionActiveGlobalRef.current = false;  // #382 同步 ref
        resetConnectionVisualState();
        // #610 终结手术：Canvas 清除替代 SVG 隐藏
        clearInteractionCanvas();
        // 关闭生成菜单弹窗
        setGenerateMenu({ visible: false, x: 0, y: 0, sourceId: null });
        // 不要 return，继续执行缩放
      }

      const rect = container.getBoundingClientRect();

      // 缩放时立即禁用脉冲动画（放在最前面确保最快响应）
      setIsZooming(true);
      setIsPulseReady(false);
      if (zoomingTimeoutRef.current) {
        clearTimeout(zoomingTimeoutRef.current);
      }
      if (pulseReadyTimeoutRef.current) {
        clearTimeout(pulseReadyTimeoutRef.current);
      }
      zoomingTimeoutRef.current = setTimeout(() => {
        setIsZooming(false);
        pulseReadyTimeoutRef.current = setTimeout(() => {
          setIsPulseReady(true);
        }, 50);
      }, 500);

      // 滚轮缩放画布（包括裁剪模式）
      e.preventDefault();
      e.stopPropagation();

      const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 使用 useCanvasCore 的缩放计算函数
      const result = calculateZoom({
        currentZoom: zoom,
        currentPan: pan,
        scaleFactor,
        mouseX,
        mouseY,
        containerWidth: rect.width,
        containerHeight: rect.height,
        canvasWidth: CANVAS_WIDTH,
        canvasHeight: canvasHeight,
      });

      if (result.zoom !== zoom) {
        setZoom(result.zoom);
        setPan({ x: result.panX, y: result.panY });
      }
    };

    container.addEventListener('wheel', handleWheel);

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [isCropping, cropImageId, cropRect, canvas, zoom, pan, CANVAS_WIDTH, canvasHeight]);

  // 调整大小处理
  // #军师方案：图片元素拖拽四个角时默认锁定宽高比
  const handleResizeStart = useCallback((e: React.MouseEvent, id: string, corner: string, keepAspectRatio: boolean = false) => {
    e.stopPropagation();
    e.preventDefault();
    const el = canvas.state.elements.find(el => el.id === id);
    if (!el) return;
    
    const isCorner = corner.includes('-');
    
    // 👑 核心修改点：图片锁定，但面板只有在【非文本类型】时才锁定！
    const isLockablePanel = el.type === 'generate-panel' && el.panelType !== 'text';
    const shouldLockRatio = (el.type === 'image' || isLockablePanel) && isCorner;
    
    // 计算宽高比
    let aspectRatio: number | undefined;
    if (keepAspectRatio || shouldLockRatio) {
      if (el.type === 'generate-panel' && el.panelRatio) {
        // #597 面板拉伸：使用用户设置的 panelRatio（如 '1:3', '16:9'）
        const ratioParts = el.panelRatio.split(':');
        if (ratioParts.length === 2) {
          const w = parseFloat(ratioParts[0]);
          const h = parseFloat(ratioParts[1]);
          if (w > 0 && h > 0) {
            aspectRatio = w / h;
          }
        }
      }
      // 如果没有 panelRatio 或解析失败，使用当前尺寸比例
      if (aspectRatio === undefined) {
        aspectRatio = el.width / el.height;
      }
    }
    
    setResizing({ 
      id, 
      corner, 
      startX: e.clientX, 
      startY: e.clientY, 
      startW: el.width, 
      startH: el.height, 
      startElX: el.x, 
      startElY: el.y, 
      aspectRatio 
    });
  }, [canvas.state.elements]);

  // 调整大小中 - 支持角点缩放和磁吸
  // #军师方案：只基于图片边界检测，固定锚点锁定
  useEffect(() => {
    if (!resizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const el = canvas.state.elements.find(el => el.id === resizing.id);
      if (!el) return;
      
      // 1. 计算鼠标移动量（画布坐标）
      const currentZoom = zoom;
      const dx = (e.clientX - resizing.startX) / currentZoom;
      const dy = (e.clientY - resizing.startY) / currentZoom;
      
      // 2. 根据拖动的角点，计算图片的四个边界（画布坐标）
      // 固定锚点：对边的边界不变
      let imgLeft: number, imgRight: number, imgTop: number, imgBottom: number;
      let newW: number, newH: number, newX: number, newY: number;
      
      // 固定边界（对边锚点）
      const fixedLeft = resizing.startElX;
      const fixedRight = resizing.startElX + resizing.startW;
      const fixedTop = resizing.startElY;
      const fixedBottom = resizing.startElY + resizing.startH;
      
      if (resizing.corner.includes('right')) {
        imgLeft = fixedLeft;
        imgRight = fixedLeft + Math.max(500, resizing.startW + dx);
      } else { // left
        imgRight = fixedRight;
        imgLeft = fixedRight - Math.max(500, resizing.startW - dx);
      }
      
      if (resizing.corner.includes('bottom')) {
        imgTop = fixedTop;
        imgBottom = fixedTop + Math.max(500, resizing.startH + dy);
      } else { // top
        imgBottom = fixedBottom;
        imgTop = fixedBottom - Math.max(500, resizing.startH - dy);
      }
      
      // 处理宽高比锁定
      if (resizing.aspectRatio) {
        if (resizing.corner === 'top-left') {
          const ratio = Math.max((imgRight - imgLeft) / resizing.startW, (imgBottom - imgTop) / resizing.startH);
          const newWidth = resizing.startW * ratio;
          const newHeight = newWidth / resizing.aspectRatio;
          imgLeft = fixedRight - newWidth;
          imgTop = fixedBottom - newHeight;
        } else if (resizing.corner === 'top-right') {
          const ratio = Math.max((imgRight - imgLeft) / resizing.startW, (imgBottom - imgTop) / resizing.startH);
          const newWidth = resizing.startW * ratio;
          const newHeight = newWidth / resizing.aspectRatio;
          imgRight = fixedLeft + newWidth;
          imgTop = fixedBottom - newHeight;
        } else if (resizing.corner === 'bottom-left') {
          const ratio = Math.max((imgRight - imgLeft) / resizing.startW, (imgBottom - imgTop) / resizing.startH);
          const newWidth = resizing.startW * ratio;
          const newHeight = newWidth / resizing.aspectRatio;
          imgLeft = fixedRight - newWidth;
          imgBottom = fixedTop + newHeight;
        } else if (resizing.corner === 'bottom-right') {
          const ratio = Math.max((imgRight - imgLeft) / resizing.startW, (imgBottom - imgTop) / resizing.startH);
          const newWidth = resizing.startW * ratio;
          const newHeight = newWidth / resizing.aspectRatio;
          imgRight = fixedLeft + newWidth;
          imgBottom = fixedTop + newHeight;
        }
      }

      // 3. 磁吸检测 - 只基于图片边界，不用鼠标位置
      // 军师方案：废除 20 像素解锁阈值，只要检测到 < 4 像素就吸附，离开就脱离
      const SNAP_THRESHOLD_SCREEN = 4; // 4像素磁吸（与拖动一致）
      const SNAP_THRESHOLD = SNAP_THRESHOLD_SCREEN / currentZoom;
      
      const newAlignLines: { horizontal: { y: number; x1: number; x2: number }[]; vertical: { x: number; y1: number; y2: number }[] } = { horizontal: [], vertical: [] };
      
      const otherElements = canvas.state.elements.filter(e => e.id !== resizing.id && e.visible);
      
      let snapX: number | null = null;
      let snapY: number | null = null;
      let snapXDist = Infinity;
      let snapYDist = Infinity;
      
      // 检测右边磁吸
      if (resizing.corner.includes('right')) {
        for (const other of otherElements) {
          const otherLeft = other.x;
          const otherRight = other.x + other.width;
          
          // 右边对齐到其他元素左边
          const distToLeft = Math.abs(imgRight - otherLeft);
          if (distToLeft < SNAP_THRESHOLD && distToLeft < snapXDist) {
            snapX = otherLeft;
            snapXDist = distToLeft;
            newAlignLines.vertical.push({ x: otherLeft, y1: Math.min(imgTop, other.y), y2: Math.max(imgBottom, other.y + other.height) });
          }
          // 右边对齐到其他元素右边
          const distToRight = Math.abs(imgRight - otherRight);
          if (distToRight < SNAP_THRESHOLD && distToRight < snapXDist) {
            snapX = otherRight;
            snapXDist = distToRight;
            newAlignLines.vertical.push({ x: otherRight, y1: Math.min(imgTop, other.y), y2: Math.max(imgBottom, other.y + other.height) });
          }
        }
      }
      
      // 检测左边磁吸
      if (resizing.corner.includes('left')) {
        for (const other of otherElements) {
          const otherLeft = other.x;
          const otherRight = other.x + other.width;
          
          // 左边对齐到其他元素左边
          const distToLeft = Math.abs(imgLeft - otherLeft);
          if (distToLeft < SNAP_THRESHOLD && distToLeft < snapXDist) {
            snapX = otherLeft;
            snapXDist = distToLeft;
            newAlignLines.vertical.push({ x: otherLeft, y1: Math.min(imgTop, other.y), y2: Math.max(imgBottom, other.y + other.height) });
          }
          // 左边对齐到其他元素右边
          const distToRight = Math.abs(imgLeft - otherRight);
          if (distToRight < SNAP_THRESHOLD && distToRight < snapXDist) {
            snapX = otherRight;
            snapXDist = distToRight;
            newAlignLines.vertical.push({ x: otherRight, y1: Math.min(imgTop, other.y), y2: Math.max(imgBottom, other.y + other.height) });
          }
        }
      }
      
      // 检测底边磁吸
      if (resizing.corner.includes('bottom')) {
        for (const other of otherElements) {
          const otherTop = other.y;
          const otherBottom = other.y + other.height;
          
          // 底边对齐到其他元素顶边
          const distToTop = Math.abs(imgBottom - otherTop);
          if (distToTop < SNAP_THRESHOLD && distToTop < snapYDist) {
            snapY = otherTop;
            snapYDist = distToTop;
            newAlignLines.horizontal.push({ y: otherTop, x1: Math.min(imgLeft, other.x), x2: Math.max(imgRight, other.x + other.width) });
          }
          // 底边对齐到其他元素底边
          const distToBottom = Math.abs(imgBottom - otherBottom);
          if (distToBottom < SNAP_THRESHOLD && distToBottom < snapYDist) {
            snapY = otherBottom;
            snapYDist = distToBottom;
            newAlignLines.horizontal.push({ y: otherBottom, x1: Math.min(imgLeft, other.x), x2: Math.max(imgRight, other.x + other.width) });
          }
        }
      }
      
      // 检测顶边磁吸
      if (resizing.corner.includes('top')) {
        for (const other of otherElements) {
          const otherTop = other.y;
          const otherBottom = other.y + other.height;
          
          // 顶边对齐到其他元素顶边
          const distToTop = Math.abs(imgTop - otherTop);
          if (distToTop < SNAP_THRESHOLD && distToTop < snapYDist) {
            snapY = otherTop;
            snapYDist = distToTop;
            newAlignLines.horizontal.push({ y: otherTop, x1: Math.min(imgLeft, other.x), x2: Math.max(imgRight, other.x + other.width) });
          }
          // 顶边对齐到其他元素底边
          const distToBottom = Math.abs(imgTop - otherBottom);
          if (distToBottom < SNAP_THRESHOLD && distToBottom < snapYDist) {
            snapY = otherBottom;
            snapYDist = distToBottom;
            newAlignLines.horizontal.push({ y: otherBottom, x1: Math.min(imgLeft, other.x), x2: Math.max(imgRight, other.x + other.width) });
          }
        }
      }
      
      // 4. 应用磁吸 - 强制锁定边界到吸附线，固定锚点不动
      if (snapX !== null) {
        if (resizing.corner.includes('left')) {
          // 左边吸附：左边跳到 snapX，右边固定
          imgLeft = snapX;
        } else {
          // 右边吸附：右边跳到 snapX，左边固定
          imgRight = snapX;
        }
      }
      if (snapY !== null) {
        if (resizing.corner.includes('top')) {
          // 顶边吸附：顶边跳到 snapY，底边固定
          imgTop = snapY;
        } else {
          // 底边吸附：底边跳到 snapY，顶边固定
          imgBottom = snapY;
        }
      }
      
      // 5. 从最终边界计算位置和尺寸
      // 注意：不要对 width/height 使用 Math.round，否则会破坏宽高比
      // 只对位置使用 Math.round，避免浮点数导致的视觉分离
      newX = Math.round(imgLeft);
      newY = Math.round(imgTop);
      newW = imgRight - imgLeft;
      newH = imgBottom - imgTop;
      
      // ========== #军师方案：磁吸背刺修复 - 强制等比收尾 ==========
      // 如果当前元素锁定了比例，在磁吸强制修改了某一边后，必须强行修正另一边！
      if (resizing.aspectRatio) {
        // 如果触发了 Y 轴（高度）磁吸，高度被改了，我们要强制修正宽度
        if (snapY !== null) {
          newW = newH * resizing.aspectRatio;
          // 如果拖的是左边，宽度变了，X坐标也要跟着修
          if (resizing.corner.includes('left')) {
            newX = Math.round(resizing.startElX + (resizing.startW - newW));
          }
        } 
        // 如果触发了 X 轴（宽度）磁吸，宽度被改了，我们要强制修正高度
        else if (snapX !== null) {
          newH = newW / resizing.aspectRatio;
          // 如果拖的是顶边，高度变了，Y坐标也要跟着修
          if (resizing.corner.includes('top')) {
            newY = Math.round(resizing.startElY + (resizing.startH - newH));
          }
        }
      }
      
      setAlignLines(newAlignLines);

      // #583 修复：使用 RAF 批量更新，避免 React 19 并发渲染 insertBefore 错误
      // 存储待更新的数据
      let pendingUpdates: Partial<CanvasElement> = {};
      
      // 如果是文字元素，修改fontSize而不是width/height
      const currentEl = canvas.state.elements.find(e => e.id === resizing.id);
      if (currentEl && currentEl.type === 'text') {
        // 文字元素缩放：根据目标尺寸调整fontSize，内容跟随缩放
        // 直接使用用户拖拽到的目标尺寸，不重新计算
        const originalFontSize = resizing.startFontSize || 24;
        const scaleRatio = newW / resizing.startW;
        const newFontSize = Math.max(8, Math.round(originalFontSize * scaleRatio));
        
        // 直接使用拖拽目标尺寸，让文字填充用户调整后的区域
        pendingUpdates = { 
          fontSize: newFontSize,
          width: newW,
          height: newH,
          x: newX, 
          y: newY,
        };
      }
      // 如果是气泡元素，根据拉伸方向更新尾巴方向
      else if (currentEl && currentEl.name === 'Bubble') {
        // 拉伸左边时，尾巴转向左边；拉伸右边时，尾巴转向右边
        const newDirection = resizing.corner.includes('left') ? 'left' : 
                            resizing.corner.includes('right') ? 'right' : 
                            (currentEl as any).bubbleTailDirection || 'right';
        pendingUpdates = { 
          width: newW, 
          height: newH, 
          x: newX, 
          y: newY,
          bubbleTailDirection: newDirection
        };
      } else {
        // #328 面板拉伸时清除比例设置（允许自由调整尺寸）
        const isPanel = currentEl?.type === 'generate-panel';
        
        if (isPanel) {
          // #527 修复：面板拉伸时保持用户选择的比例配置不变
          // 拉伸只是视觉上调整面板大小，不应改变用户选定的比例值
          // 这样再次生成时仍然使用用户原来选定的比例
          pendingUpdates = { 
            width: newW, 
            height: newH, 
            x: newX, 
            y: newY,
          };
        } else {
          pendingUpdates = { width: newW, height: newH, x: newX, y: newY };
        }
      }
      
      // 存储待处理的更新
      resizePendingRef.current = { id: resizing.id, updates: pendingUpdates };
      
      // 使用 RAF 批量更新
      if (!resizeRafRef.current) {
        resizeRafRef.current = requestAnimationFrame(() => {
          if (resizePendingRef.current) {
            canvas.updateElement(resizePendingRef.current.id, resizePendingRef.current.updates);
            resizePendingRef.current = null;
          }
          resizeRafRef.current = null;
        });
      }
    };
    const handleMouseUp = () => {
      // #583 修复：清理未执行的 RAF
      if (resizeRafRef.current) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      // 执行最后一次待处理的更新
      if (resizePendingRef.current) {
        canvas.updateElement(resizePendingRef.current.id, resizePendingRef.current.updates);
        resizePendingRef.current = null;
      }
      setResizing(null);
      setAlignLines({ horizontal: [], vertical: [] });
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { 
      // #583 修复：清理时也要取消 RAF
      if (resizeRafRef.current) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      window.removeEventListener('mousemove', handleMouseMove); 
      window.removeEventListener('mouseup', handleMouseUp); 
    };
  }, [resizing, canvas, zoom]);

  // 拖动元素时的全局事件监听 - 确保鼠标离开容器后仍能继续拖动
  useEffect(() => {
    if (!isDragging || !dragElement) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // 转换为画布坐标
      // #050 修复：使用 zoom/pan state 而不是从未更新的 ref
      const canvasX = (x - pan.x) / zoom;
      const canvasY = (y - pan.y) / zoom;

      const dx = canvasX - dragStart.x;
      const dy = canvasY - dragStart.y;
      const el = canvas.state.elements.find(e => e.id === dragElement);
      if (el && !el.locked) {
        let newX = dragStart.elX + dx;
        let newY = dragStart.elY + dy;
        
        // 检查是否是组元素（多选拖动）
        const groupStartPositions = (window as any).__groupStartPositions;
        const isGroupDrag = groupStartPositions && groupStartPositions.length > 1;
        
        // 智能对齐和磁吸
        // 阈值使用屏幕像素（4px），转换为画布坐标
        const SNAP_THRESHOLD_SCREEN = 4; // 4像素磁吸范围
        const SNAP_THRESHOLD = SNAP_THRESHOLD_SCREEN / zoom; // 画布坐标
        
        // #磁吸距离限制：只检测容器宽度 30% 以内的元素
        const containerWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
        const MAX_SNAP_DISTANCE = containerWidth * 0.3 / zoom; // 画布坐标
        
        const newAlignLines: { horizontal: { y: number; x1: number; x2: number }[]; vertical: { x: number; y1: number; y2: number }[] } = { horizontal: [], vertical: [] };
        
        // 计算拖动元素的边界（用于单选）或组的边界框（用于多选）
        let dragLeft: number, dragRight: number, dragTop: number, dragBottom: number;
        let dragWidth: number, dragHeight: number;
        let groupMinX = Infinity, groupMinY = Infinity;
        let groupMaxX = -Infinity, groupMaxY = -Infinity;
        
        if (isGroupDrag) {
          // 多选拖动：计算整个组的边界框
          groupStartPositions.forEach((pos: { id: string; x: number; y: number }) => {
            const gEl = canvas.state.elements.find(e => e.id === pos.id);
            if (gEl) {
              groupMinX = Math.min(groupMinX, pos.x);
              groupMinY = Math.min(groupMinY, pos.y);
              groupMaxX = Math.max(groupMaxX, pos.x + gEl.width);
              groupMaxY = Math.max(groupMaxY, pos.y + gEl.height);
            }
          });
          
          // 计算组的原始尺寸
          const groupWidth = groupMaxX - groupMinX;
          const groupHeight = groupMaxY - groupMinY;
          
          // 计算组移动后的边界
          const offsetX = newX - dragStart.elX;
          const offsetY = newY - dragStart.elY;
          dragLeft = groupMinX + offsetX;
          dragRight = groupMaxX + offsetX;
          dragTop = groupMinY + offsetY;
          dragBottom = groupMaxY + offsetY;
          dragWidth = groupWidth;
          dragHeight = groupHeight;
        } else {
          // 单选拖动：使用单个元素的边界
          dragLeft = newX;
          dragRight = newX + el.width;
          dragTop = newY;
          dragBottom = newY + el.height;
          dragWidth = el.width;
          dragHeight = el.height;
        }
        
        const dragCenterX = dragLeft + dragWidth / 2;
        const dragCenterY = dragTop + dragHeight / 2;
        
        // 获取其他元素（排除正在拖动的元素组）
        let otherElements = canvas.state.elements.filter(e => e.visible);
        if (isGroupDrag) {
          // 多选时排除所有被选中的元素
          const selectedIds = new Set(groupStartPositions.map((pos: { id: string }) => pos.id));
          otherElements = otherElements.filter(e => !selectedIds.has(e.id));
        } else {
          otherElements = otherElements.filter(e => e.id !== dragElement);
        }
        
        // #磁吸距离限制：过滤超过限制距离的元素
        otherElements = otherElements.filter(e => {
          const elCenterX = e.x + e.width / 2;
          const elCenterY = e.y + e.height / 2;
          const distance = Math.sqrt((dragCenterX - elCenterX) ** 2 + (dragCenterY - elCenterY) ** 2);
          return distance <= MAX_SNAP_DISTANCE;
        });
        
        // 水平对齐（检测垂直线）
        let snapX: number | null = null;
        for (const other of otherElements) {
          const otherLeft = other.x;
          const otherRight = other.x + other.width;
          const otherCenterX = other.x + other.width / 2;
          const otherCenterY = other.y + other.height / 2;
          
          // 左边对齐
          if (Math.abs(dragLeft - otherLeft) < SNAP_THRESHOLD) {
            if (snapX === null || Math.abs(dragLeft - otherLeft) < Math.abs((snapX - dragStart.elX) - dx)) {
              snapX = isGroupDrag ? otherLeft - (groupMinX - dragStart.elX) : otherLeft;
            }
            newAlignLines.vertical.push({ x: otherLeft, y1: Math.min(dragTop, other.y), y2: Math.max(dragBottom, other.y + other.height) });
          }
          // 左边对齐右边
          if (Math.abs(dragLeft - otherRight) < SNAP_THRESHOLD) {
            if (snapX === null || Math.abs(dragLeft - otherRight) < Math.abs((snapX - dragStart.elX) - dx)) {
              snapX = isGroupDrag ? otherRight - (groupMinX - dragStart.elX) : otherRight;
            }
            newAlignLines.vertical.push({ x: otherRight, y1: Math.min(dragTop, other.y), y2: Math.max(dragBottom, other.y + other.height) });
          }
          // 右边对齐
          if (Math.abs(dragRight - otherRight) < SNAP_THRESHOLD) {
            if (snapX === null || Math.abs(dragRight - otherRight) < Math.abs((snapX + dragWidth - dragStart.elX - dragWidth) - dx)) {
              snapX = isGroupDrag ? otherRight - dragWidth - (groupMinX - dragStart.elX) : otherRight - dragWidth;
            }
            newAlignLines.vertical.push({ x: otherRight, y1: Math.min(dragTop, other.y), y2: Math.max(dragBottom, other.y + other.height) });
          }
          // 右边对齐左边
          if (Math.abs(dragRight - otherLeft) < SNAP_THRESHOLD) {
            if (snapX === null || Math.abs(dragRight - otherLeft) < Math.abs((snapX + dragWidth - dragStart.elX - dragWidth) - dx)) {
              snapX = isGroupDrag ? otherLeft - dragWidth - (groupMinX - dragStart.elX) : otherLeft - dragWidth;
            }
            newAlignLines.vertical.push({ x: otherLeft, y1: Math.min(dragTop, other.y), y2: Math.max(dragBottom, other.y + other.height) });
          }
          // 中心对齐
          if (Math.abs(dragCenterX - otherCenterX) < SNAP_THRESHOLD) {
            if (snapX === null) {
              snapX = isGroupDrag ? otherCenterX - dragWidth / 2 - (groupMinX - dragStart.elX) : otherCenterX - dragWidth / 2;
            }
            newAlignLines.vertical.push({ x: otherCenterX, y1: Math.min(dragTop, other.y), y2: Math.max(dragBottom, other.y + other.height) });
          }
        }
        
        // 垂直对齐（检测水平线）
        let snapY: number | null = null;
        for (const other of otherElements) {
          const otherTop = other.y;
          const otherBottom = other.y + other.height;
          const otherCenterY = other.y + other.height / 2;
          const otherCenterX = other.x + other.width / 2;
          
          // 顶边对齐
          if (Math.abs(dragTop - otherTop) < SNAP_THRESHOLD) {
            if (snapY === null || Math.abs(dragTop - otherTop) < Math.abs((snapY - dragStart.elY) - dy)) {
              snapY = isGroupDrag ? otherTop - (groupMinY - dragStart.elY) : otherTop;
            }
            newAlignLines.horizontal.push({ y: otherTop, x1: Math.min(dragLeft, other.x), x2: Math.max(dragRight, other.x + other.width) });
          }
          // 顶边对齐底边
          if (Math.abs(dragTop - otherBottom) < SNAP_THRESHOLD) {
            if (snapY === null || Math.abs(dragTop - otherBottom) < Math.abs((snapY - dragStart.elY) - dy)) {
              snapY = isGroupDrag ? otherBottom - (groupMinY - dragStart.elY) : otherBottom;
            }
            newAlignLines.horizontal.push({ y: otherBottom, x1: Math.min(dragLeft, other.x), x2: Math.max(dragRight, other.x + other.width) });
          }
          // 底边对齐
          if (Math.abs(dragBottom - otherBottom) < SNAP_THRESHOLD) {
            if (snapY === null || Math.abs(dragBottom - otherBottom) < Math.abs((snapY + dragHeight - dragStart.elY - dragHeight) - dy)) {
              snapY = isGroupDrag ? otherBottom - dragHeight - (groupMinY - dragStart.elY) : otherBottom - dragHeight;
            }
            newAlignLines.horizontal.push({ y: otherBottom, x1: Math.min(dragLeft, other.x), x2: Math.max(dragRight, other.x + other.width) });
          }
          // 底边对齐顶边
          if (Math.abs(dragBottom - otherTop) < SNAP_THRESHOLD) {
            if (snapY === null || Math.abs(dragBottom - otherTop) < Math.abs((snapY + dragHeight - dragStart.elY - dragHeight) - dy)) {
              snapY = isGroupDrag ? otherTop - dragHeight - (groupMinY - dragStart.elY) : otherTop - dragHeight;
            }
            newAlignLines.horizontal.push({ y: otherTop, x1: Math.min(dragLeft, other.x), x2: Math.max(dragRight, other.x + other.width) });
          }
          // 中心对齐
          if (Math.abs(dragCenterY - otherCenterY) < SNAP_THRESHOLD) {
            if (snapY === null) {
              snapY = isGroupDrag ? otherCenterY - dragHeight / 2 - (groupMinY - dragStart.elY) : otherCenterY - dragHeight / 2;
            }
            newAlignLines.horizontal.push({ y: otherCenterY, x1: Math.min(dragLeft, other.x), x2: Math.max(dragRight, other.x + other.width) });
          }
        }
        
        // 应用磁吸
        if (snapX !== null) {
          newX = snapX;
        }
        if (snapY !== null) {
          newY = snapY;
        }
        
        // 更新对齐线
        setAlignLines(newAlignLines);
        
        // #583 修复：使用 RAF 批量更新，避免 React 19 并发渲染 insertBefore 错误
        // 收集待更新的元素
        const pendingUpdates: Array<{ id: string; updates: Partial<CanvasElement> }> = [];
        
        if (isGroupDrag) {
          // 多选拖动：计算整个组的边界框，然后统一限制
          // 计算主拖动元素移动后的偏移量
          const offsetX = newX - dragStart.elX;
          const offsetY = newY - dragStart.elY;
          
          // 计算组的新边界框
          const newGroupMinX = groupMinX + offsetX;
          const newGroupMinY = groupMinY + offsetY;
          const newGroupMaxX = groupMaxX + offsetX;
          const newGroupMaxY = groupMaxY + offsetY;
          
          // 计算组边界框需要被限制的偏移量
          let clampOffsetX = 0;
          let clampOffsetY = 0;
          
          if (newGroupMinX < 0) {
            clampOffsetX = -newGroupMinX;
          } else if (newGroupMaxX > CANVAS_WIDTH) {
            clampOffsetX = CANVAS_WIDTH - newGroupMaxX;
          }
          
          if (newGroupMinY < 0) {
            clampOffsetY = -newGroupMinY;
          } else if (newGroupMaxY > canvasHeight) {
            clampOffsetY = canvasHeight - newGroupMaxY;
          }
          
          // 应用修正后的偏移量
          const finalOffsetX = offsetX + clampOffsetX;
          const finalOffsetY = offsetY + clampOffsetY;
          
          // 收集所有组元素的更新，保持相对位置
          groupStartPositions.forEach((pos: { id: string; x: number; y: number }) => {
            pendingUpdates.push({
              id: pos.id,
              updates: { 
                x: Math.round(pos.x + finalOffsetX),
                y: Math.round(pos.y + finalOffsetY)
              }
            });
          });
          
          // 同步更新组元素自身的位置（修复边框固定在原位置的问题）
          const groupEl = canvas.state.elements.find(e => e.id === dragElement);
          if (groupEl) {
            pendingUpdates.push({
              id: dragElement,
              updates: {
                x: Math.round(dragStart.elX + finalOffsetX),
                y: Math.round(dragStart.elY + finalOffsetY)
              }
            });
          }
        } else {
          // 单选拖动：限制元素不能拖出画布边界
          newX = Math.max(0, Math.min(CANVAS_WIDTH - el.width, newX));
          newY = Math.max(0, Math.min(canvasHeight - el.height, newY));
          pendingUpdates.push({
            id: dragElement,
            updates: { x: Math.round(newX), y: Math.round(newY) }
          });
        }
        
        // 存储待处理的更新
        dragPendingRef.current = pendingUpdates;
        
        // 使用 RAF 批量更新
        if (!dragRafRef.current) {
          dragRafRef.current = requestAnimationFrame(() => {
            // #583 完整修复：使用 updateElementsBatch 一次状态更新
            canvas.updateElementsBatch(dragPendingRef.current);
            dragPendingRef.current = [];
            dragRafRef.current = null;
          });
        }
      }
    };

    const handleGlobalMouseUp = () => {
      // #583 修复：清理未执行的 RAF
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
      // #583 完整修复：使用 updateElementsBatch 一次状态更新
      if (dragPendingRef.current.length > 0) {
        canvas.updateElementsBatch(dragPendingRef.current);
        dragPendingRef.current = [];
      }
      
      setIsDragging(false);
      setDragElement(null);
      setAlignLines({ horizontal: [], vertical: [] });
      // #411 延迟恢复脉冲显示
      setIsPulseReady(false);
      if (pulseReadyTimeoutRef.current) clearTimeout(pulseReadyTimeoutRef.current);
      pulseReadyTimeoutRef.current = setTimeout(() => setIsPulseReady(true), 50);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      // #583 修复：清理时也要取消 RAF
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, dragElement, dragStart, canvas, CANVAS_WIDTH, canvasHeight]);



  // 裁剪框拖动的全局事件监听 - 使用ref存储状态，避免依赖项变化导致重新创建
  useEffect(() => {
    if (!isCropping) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      const drag = cropDragRef.current;
      if (!drag || !drag.isDragging) return;
      
      const imageEl = canvas.state.elements.find(el => el.id === cropImageId);
      if (!imageEl) return;
      
      // 将屏幕坐标差值转换为图片坐标差值（考虑zoom缩放）
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      
      let newRect = { x: drag.rectX, y: drag.rectY, width: drag.rectW, height: drag.rectH };
      
      // 获取锁定比例（使用 ref 获取最新值）
      const getLockedRatio = () => {
        const currentRatio = cropRatioRef.current;
        if (currentRatio === '1:1') return 1;
        if (currentRatio === '4:3') return 4 / 3;
        if (currentRatio === '3:4') return 3 / 4;
        if (currentRatio === '3:2') return 3 / 2;
        if (currentRatio === '2:3') return 2 / 3;
        if (currentRatio === '16:9') return 16 / 9;
        if (currentRatio === '9:16') return 9 / 16;
        if (currentRatio === '21:9') return 21 / 9;
        if (currentRatio === '9:21') return 9 / 21;
        return null; // free
      };
      const lockedRatio = getLockedRatio();
      const minSize = 20; // 最小尺寸
      
      if (drag.handle === 'move') {
        newRect.x = Math.max(0, Math.min(imageEl.width - drag.rectW, drag.rectX + dx));
        newRect.y = Math.max(0, Math.min(imageEl.height - drag.rectH, drag.rectY + dy));
      } else if (drag.handle === 'nw') {
        if (lockedRatio) {
          // 锁定比例：从西北角调整，保持比例
          // 向左上扩大：dx<0, dy<0；向右下缩小：dx>0, dy>0
          const maxExpandX = drag.rectX; // 左边可扩展空间
          const maxExpandY = drag.rectY; // 上边可扩展空间
          const maxShrinkX = drag.rectW - minSize; // 宽度可缩小量
          const maxShrinkY = drag.rectH - minSize; // 高度可缩小量
          
          // 计算新位置和尺寸
          let newX: number, newW: number;
          if (dx < 0) {
            // 扩大：向左移动
            newX = Math.max(0, drag.rectX + dx);
            newW = drag.rectX + drag.rectW - newX;
          } else {
            // 缩小：向右移动
            newX = drag.rectX + Math.min(dx, maxShrinkX);
            newW = drag.rectX + drag.rectW - newX;
          }
          
          // 根据比例计算高度
          let newH = newW / lockedRatio;
          let newY = drag.rectY + drag.rectH - newH;
          
          // 检查上边界
          if (newY < 0) {
            newH = drag.rectY + drag.rectH;
            newW = newH * lockedRatio;
            newX = drag.rectX + drag.rectW - newW;
            newY = 0;
          }
          // 检查左边界
          if (newX < 0) {
            newW = drag.rectX + drag.rectW;
            newH = newW / lockedRatio;
            newY = drag.rectY + drag.rectH - newH;
            newX = 0;
          }
          
          newRect.width = Math.max(minSize, newW);
          newRect.height = Math.max(minSize, newH);
          newRect.x = newX;
          newRect.y = newY;
        } else {
          newRect.x = Math.max(0, Math.min(drag.rectX + drag.rectW - 20, drag.rectX + dx));
          newRect.y = Math.max(0, Math.min(drag.rectY + drag.rectH - 20, drag.rectY + dy));
          newRect.width = drag.rectX + drag.rectW - newRect.x;
          newRect.height = drag.rectY + drag.rectH - newRect.y;
        }
      } else if (drag.handle === 'ne') {
        if (lockedRatio) {
          // 锁定比例：从东北角调整，保持比例
          // 向右上扩大：dx>0, dy<0；向左下缩小：dx<0, dy>0
          const maxExpandX = imageEl.width - drag.rectX - drag.rectW; // 右边可扩展
          const maxExpandY = drag.rectY; // 上边可扩展
          const maxShrinkX = drag.rectW - minSize;
          const maxShrinkY = drag.rectH - minSize;
          
          // 计算新宽度
          let newW: number;
          if (dx > 0) {
            newW = Math.min(drag.rectW + dx, drag.rectW + maxExpandX);
          } else {
            newW = Math.max(minSize, drag.rectW + dx);
          }
          
          // 根据比例计算高度
          let newH = newW / lockedRatio;
          let newY = drag.rectY + drag.rectH - newH;
          
          // 检查上边界
          if (newY < 0) {
            newH = drag.rectY + drag.rectH;
            newW = newH * lockedRatio;
            newY = 0;
          }
          // 检查右边界
          if (drag.rectX + newW > imageEl.width) {
            newW = imageEl.width - drag.rectX;
            newH = newW / lockedRatio;
            newY = drag.rectY + drag.rectH - newH;
          }
          
          newRect.width = Math.max(minSize, newW);
          newRect.height = Math.max(minSize, newH);
          newRect.x = drag.rectX;
          newRect.y = newY;
        } else {
          newRect.y = Math.max(0, Math.min(drag.rectY + drag.rectH - 20, drag.rectY + dy));
          newRect.width = Math.max(20, Math.min(imageEl.width - drag.rectX, drag.rectW + dx));
          newRect.height = drag.rectY + drag.rectH - newRect.y;
        }
      } else if (drag.handle === 'sw') {
        if (lockedRatio) {
          // 锁定比例：从西南角调整，保持比例
          // 向左下扩大：dx<0, dy>0；向右上缩小：dx>0, dy<0
          const maxExpandX = drag.rectX; // 左边可扩展
          const maxExpandY = imageEl.height - drag.rectY - drag.rectH; // 下边可扩展
          
          // 计算新位置和宽度
          let newX: number, newW: number;
          if (dx < 0) {
            // 扩大：向左移动
            newX = Math.max(0, drag.rectX + dx);
            newW = drag.rectX + drag.rectW - newX;
          } else {
            // 缩小：向右移动
            newX = drag.rectX + Math.min(dx, drag.rectW - minSize);
            newW = drag.rectX + drag.rectW - newX;
          }
          
          // 根据比例计算高度
          let newH = newW / lockedRatio;
          let newY = drag.rectY;
          
          // 检查下边界
          if (newY + newH > imageEl.height) {
            newH = imageEl.height - newY;
            newW = newH * lockedRatio;
            newX = drag.rectX + drag.rectW - newW;
          }
          // 检查左边界
          if (newX < 0) {
            newW = drag.rectX + drag.rectW;
            newH = newW / lockedRatio;
            newX = 0;
          }
          
          newRect.width = Math.max(minSize, newW);
          newRect.height = Math.max(minSize, newH);
          newRect.x = newX;
          newRect.y = newY;
        } else {
          newRect.x = Math.max(0, Math.min(drag.rectX + drag.rectW - 20, drag.rectX + dx));
          newRect.width = drag.rectX + drag.rectW - newRect.x;
          newRect.height = Math.max(20, Math.min(imageEl.height - drag.rectY, drag.rectH + dy));
        }
      } else if (drag.handle === 'se') {
        if (lockedRatio) {
          // 锁定比例：从东南角调整，保持比例
          // 核心算法：先计算新宽度，再根据比例计算高度，然后检查边界
          const maxW = imageEl.width - drag.rectX;
          const maxH = imageEl.height - drag.rectY;
          
          // 基于宽度的最大尺寸
          const maxWBasedSize = Math.min(drag.rectW + dx, maxW);
          const hFromW = maxWBasedSize / lockedRatio;
          
          // 基于高度的最大尺寸
          const maxHBasedSize = Math.min(drag.rectH + dy, maxH);
          const wFromH = maxHBasedSize * lockedRatio;
          
          // 取较小的有效尺寸
          if (hFromW <= maxH) {
            // 宽度约束更严格
            newRect.width = Math.max(minSize, maxWBasedSize);
            newRect.height = newRect.width / lockedRatio;
          } else {
            // 高度约束更严格
            newRect.height = Math.max(minSize, maxHBasedSize);
            newRect.width = newRect.height * lockedRatio;
          }
          newRect.x = drag.rectX;
          newRect.y = drag.rectY;
        } else {
          newRect.width = Math.max(20, Math.min(imageEl.width - drag.rectX, drag.rectW + dx));
          newRect.height = Math.max(20, Math.min(imageEl.height - drag.rectY, drag.rectH + dy));
        }
      } else if (drag.handle === 'n') {
        if (lockedRatio) {
          // 锁定比例：从北边调整，保持比例
          // 向上扩大：dy<0；向下缩小：dy>0
          
          // 计算新高度
          let newH: number;
          if (dy < 0) {
            // 扩大：向上移动
            newH = Math.min(drag.rectH - dy, drag.rectH + drag.rectY);
          } else {
            // 缩小：向下移动
            newH = Math.max(minSize, drag.rectH - dy);
          }
          
          // 根据比例计算宽度
          let newW = newH * lockedRatio;
          let newX = drag.rectX + (drag.rectW - newW) / 2;
          let newY = drag.rectY + drag.rectH - newH;
          
          // 检查上边界
          if (newY < 0) {
            newH = Math.min(drag.rectY + drag.rectH, newH);
            newW = newH * lockedRatio;
            newX = drag.rectX + (drag.rectW - newW) / 2;
            newY = 0;
          }
          // 检查左边界
          if (newX < 0) {
            newW = Math.min(drag.rectX + drag.rectW / 2 + drag.rectX, newW);
            newH = newW / lockedRatio;
            newX = 0;
            newY = drag.rectY + drag.rectH - newH;
          }
          // 检查右边界
          if (newX + newW > imageEl.width) {
            newW = Math.min(imageEl.width - newX, newW);
            newH = newW / lockedRatio;
            newY = drag.rectY + drag.rectH - newH;
          }
          // 最终安全检查
          if (newY < 0) {
            newY = 0;
            newH = Math.min(drag.rectY + drag.rectH, imageEl.height);
            newW = newH * lockedRatio;
            newX = Math.max(0, Math.min(drag.rectX + (drag.rectW - newW) / 2, imageEl.width - newW));
          }
          
          newRect.width = Math.max(minSize, newW);
          newRect.height = Math.max(minSize, newH);
          newRect.x = newX;
          newRect.y = newY;
        } else {
          // 自由模式：只调整高度
          let newY = drag.rectY + dy;
          let newH = drag.rectH - dy;
          
          // 检查上边界
          if (newY < 0) {
            newY = 0;
            newH = drag.rectY + drag.rectH;
          }
          // 检查下边界
          if (newY + newH > imageEl.height) {
            newH = imageEl.height - newY;
          }
          // 检查最小高度
          if (newH < minSize) {
            newH = minSize;
            newY = Math.max(0, drag.rectY + drag.rectH - minSize);
          }
          
          newRect.y = newY;
          newRect.height = newH;
        }
      } else if (drag.handle === 's') {
        if (lockedRatio) {
          // 锁定比例：从南边调整，保持比例
          // 向下扩大：dy>0；向上缩小：dy<0
          
          // 计算新高度
          let newH: number;
          if (dy > 0) {
            // 扩大：向下移动
            newH = Math.min(drag.rectH + dy, imageEl.height - drag.rectY);
          } else {
            // 缩小：向上移动
            newH = Math.max(minSize, drag.rectH + dy);
          }
          
          // 根据比例计算宽度
          let newW = newH * lockedRatio;
          let newX = drag.rectX + (drag.rectW - newW) / 2;
          
          // 检查左边界
          if (newX < 0) {
            newW = Math.min(drag.rectX + drag.rectW / 2 + drag.rectX, newW);
            newH = newW / lockedRatio;
            newX = 0;
          }
          // 检查右边界
          if (newX + newW > imageEl.width) {
            newW = Math.min(imageEl.width - newX, newW);
            newH = newW / lockedRatio;
          }
          // 最终安全检查
          if (drag.rectY + newH > imageEl.height) {
            newH = Math.min(imageEl.height - drag.rectY, newH);
            newW = newH * lockedRatio;
            newX = Math.max(0, Math.min(drag.rectX + (drag.rectW - newW) / 2, imageEl.width - newW));
          }
          
          newRect.width = Math.max(minSize, newW);
          newRect.height = Math.max(minSize, newH);
          newRect.x = newX;
          newRect.y = drag.rectY;
        } else {
          // 自由模式：只调整高度
          let newH = drag.rectH + dy;
          
          // 检查下边界
          if (drag.rectY + newH > imageEl.height) {
            newH = imageEl.height - drag.rectY;
          }
          // 检查上边界
          if (drag.rectY < 0) {
            newH = Math.min(newH, imageEl.height);
          }
          // 检查最小高度
          if (newH < minSize) {
            newH = minSize;
          }
          
          newRect.height = newH;
        }
      } else if (drag.handle === 'w') {
        if (lockedRatio) {
          // 锁定比例：从西边调整，保持比例
          // 向左扩大：dx<0；向右缩小：dx>0
          
          // 计算新位置和宽度
          let newX: number, newW: number;
          if (dx < 0) {
            // 扩大：向左移动
            newX = Math.max(0, drag.rectX + dx);
            newW = drag.rectX + drag.rectW - newX;
          } else {
            // 缩小：向右移动
            newX = drag.rectX + Math.min(dx, drag.rectW - minSize);
            newW = drag.rectX + drag.rectW - newX;
          }
          
          // 根据比例计算高度
          let newH = newW / lockedRatio;
          let newY = drag.rectY + (drag.rectH - newH) / 2;
          
          // 检查上边界
          if (newY < 0) {
            newH = Math.min(drag.rectY + drag.rectH / 2 + drag.rectY, newH);
            newW = newH * lockedRatio;
            newX = drag.rectX + drag.rectW - newW;
            newY = 0;
          }
          // 检查下边界
          if (newY + newH > imageEl.height) {
            newH = Math.min(imageEl.height - newY, newH);
            newW = newH * lockedRatio;
            newX = drag.rectX + drag.rectW - newW;
          }
          // 最终安全检查
          if (newX < 0) {
            newX = 0;
            newW = Math.min(drag.rectX + drag.rectW, imageEl.width);
            newH = newW / lockedRatio;
            newY = Math.max(0, Math.min(drag.rectY + (drag.rectH - newH) / 2, imageEl.height - newH));
          }
          
          newRect.width = Math.max(minSize, newW);
          newRect.height = Math.max(minSize, newH);
          newRect.x = newX;
          newRect.y = newY;
        } else {
          // 自由模式：只调整宽度
          let newX = Math.max(0, Math.min(drag.rectX + drag.rectW - 20, drag.rectX + dx));
          let newW = drag.rectX + drag.rectW - newX;
          
          // 检查右边界
          if (newX + newW > imageEl.width) {
            newW = imageEl.width - newX;
          }
          // 检查最小宽度
          if (newW < minSize) {
            newW = minSize;
            newX = Math.max(0, drag.rectX + drag.rectW - minSize);
          }
          
          newRect.x = newX;
          newRect.width = newW;
        }
      } else if (drag.handle === 'e') {
        if (lockedRatio) {
          // 锁定比例：从东边调整，保持比例
          // 向右扩大：dx>0；向左缩小：dx<0
          
          // 计算新宽度
          let newW: number;
          if (dx > 0) {
            newW = Math.min(drag.rectW + dx, imageEl.width - drag.rectX);
          } else {
            newW = Math.max(minSize, drag.rectW + dx);
          }
          
          // 根据比例计算高度
          let newH = newW / lockedRatio;
          let newY = drag.rectY + (drag.rectH - newH) / 2;
          
          // 检查上边界
          if (newY < 0) {
            newH = Math.min(drag.rectY + drag.rectH / 2 + drag.rectY, newH);
            newW = newH * lockedRatio;
            newY = 0;
          }
          // 检查下边界
          if (newY + newH > imageEl.height) {
            newH = Math.min(imageEl.height - newY, newH);
            newW = newH * lockedRatio;
          }
          // 最终安全检查
          if (drag.rectX + newW > imageEl.width) {
            newW = Math.min(imageEl.width - drag.rectX, newW);
            newH = newW / lockedRatio;
            newY = Math.max(0, Math.min(drag.rectY + (drag.rectH - newH) / 2, imageEl.height - newH));
          }
          
          newRect.width = Math.max(minSize, newW);
          newRect.height = Math.max(minSize, newH);
          newRect.x = drag.rectX;
          newRect.y = newY;
        } else {
          // 自由模式：只调整宽度
          let newW = drag.rectW + dx;
          
          // 检查右边界
          if (drag.rectX + newW > imageEl.width) {
            newW = imageEl.width - drag.rectX;
          }
          // 检查左边界
          if (drag.rectX < 0) {
            newW = Math.min(newW, imageEl.width);
          }
          // 检查最小宽度
          if (newW < minSize) {
            newW = minSize;
          }
          
          newRect.width = newW;
        }
      }
      
      // 最终边界安全检查 - 确保裁剪框不超出图片范围
      newRect.x = Math.max(0, newRect.x);
      newRect.y = Math.max(0, newRect.y);
      newRect.width = Math.max(20, Math.min(newRect.width, imageEl.width - newRect.x));
      newRect.height = Math.max(20, Math.min(newRect.height, imageEl.height - newRect.y));
      
      // 使用 requestAnimationFrame 节流，确保每帧最多更新一次
      pendingRectRef.current = newRect;
      if (!cropRafRef.current) {
        cropRafRef.current = requestAnimationFrame(() => {
          if (pendingRectRef.current) {
            setCropRect(pendingRectRef.current);
            pendingRectRef.current = null;
          }
          cropRafRef.current = null;
        });
      }
    };

    const handleGlobalMouseUp = () => {
      // 取消未执行的 RAF
      if (cropRafRef.current) {
        cancelAnimationFrame(cropRafRef.current);
        cropRafRef.current = null;
      }
      // 立即应用最后一次位置更新
      if (pendingRectRef.current) {
        setCropRect(pendingRectRef.current);
        pendingRectRef.current = null;
      }
      if (cropDragRef.current) {
        cropDragRef.current.isDragging = false;
      }

      setCropHandle(null);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      if (cropRafRef.current) {
        cancelAnimationFrame(cropRafRef.current);
        cropRafRef.current = null;
      }
    };
  }, [isCropping, cropImageId, canvas, zoom]);

  // 框选的全局事件监听 - 确保鼠标离开容器后仍能继续框选
  useEffect(() => {
    if (!isSelecting) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      // 检查是否正在拖动元素（包括 Fabric.js 文字元素和普通元素）
      if (fabricDraggingFlag.isDragging || isDraggingRef.current) {
        // 正在拖动，取消框选
        setIsSelecting(false);
        setSelectionRect(null);
        return;
      }
      
      if (!selectionRect) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      // 计算相对于容器的位置（允许负值，即超出容器边界）
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // 转换为画布坐标
      const canvasX = (x - panRef.current.x) / zoomRef.current;
      const canvasY = (y - panRef.current.y) / zoomRef.current;
      
      setSelectionRect({ ...selectionRect, endX: canvasX, endY: canvasY });
    };

    const handleGlobalMouseUp = () => {
      if (isSelecting && selectionRect) {
        const minX = Math.min(selectionRect.startX, selectionRect.endX);
        const maxX = Math.max(selectionRect.startX, selectionRect.endX);
        const minY = Math.min(selectionRect.startY, selectionRect.endY);
        const maxY = Math.max(selectionRect.startY, selectionRect.endY);
        
        // 找出框选区域内的所有元素
        const idsToSelect = canvas.state.elements
          .filter(el => 
            el.visible && 
            !el.locked &&
            el.x < maxX &&
            el.x + el.width > minX &&
            el.y < maxY &&
            el.y + el.height > minY
          )
          .map(el => el.id);
        
        // 使用 selectElements 批量选择（替换当前选择）
        if (idsToSelect.length > 0) {
          canvas.selectElements(idsToSelect);
        }
      }
      
      setIsSelecting(false);
      setSelectionRect(null);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isSelecting, selectionRect, canvas]);

  // #299 新增：选中框整体缩放处理
  const handleSelectionResizeStart = useCallback((e: React.MouseEvent, corner: string) => {
    e.stopPropagation();
    e.preventDefault();
    
    if (!selectionBox) return;
    
    setIsSelectionResizing(true);
    
    const startScreenX = e.clientX;
    const startScreenY = e.clientY;
    
    const startBox = { ...selectionBox };
    
    // 获取当前画布的真实缩放倍率
    const currentZoom = zoom;
    
    // 记录所有选中元素的初始状态
    const startElements = canvas.state.elements
      .filter(el => canvas.state.selectedIds.includes(el.id))
      .map(el => ({
        id: el.id,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        // 相对于边界框的位置比例（0~1）
        relX: (el.x - startBox.x) / startBox.width,
        relY: (el.y - startBox.y) / startBox.height,
        // 相对于边界框的尺寸比例
        relW: el.width / startBox.width,
        relH: el.height / startBox.height,
      }));
    
    // 保存历史记录（用于 undo）
    canvas.saveHistory?.();
    
    const onMouseMove = (moveEvent: MouseEvent) => {
      // 1. 使用真实缩放比例转换坐标
      const dx = (moveEvent.clientX - startScreenX) / currentZoom;
      const dy = (moveEvent.clientY - startScreenY) / currentZoom;
      
      let newWidth = startBox.width;
      let newHeight = startBox.height;
      let newX = startBox.x;
      let newY = startBox.y;
      
      if (corner.includes('e')) newWidth = startBox.width + dx;
      if (corner.includes('w')) { newWidth = startBox.width - dx; newX = startBox.x + dx; }
      if (corner.includes('s')) newHeight = startBox.height + dy;
      if (corner.includes('n')) { newHeight = startBox.height - dy; newY = startBox.y + dy; }
      
      if (newWidth <= 0 || newHeight <= 0) return;
      
      const scaleX = newWidth / startBox.width;
      const scaleY = newHeight / startBox.height;
      
      // 2. 完美缩放手感：放大取大，缩小取小
      let finalScale = (scaleX > 1 || scaleY > 1) ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
      
      // #597 多选框拉伸：图片最小尺寸限制
      // 与单图拉伸保持一致（handleResizeStart 中 Math.max(500, ...)）
      const MIN_IMAGE_SIZE = 500;
      
      // 计算允许的最小缩放比例（确保所有图片/面板元素不被缩小到最小值以下）
      let minAllowedScale = 0.01; // 默认最小缩放比例
      startElements.forEach(el => {
        const elementData = canvas.state.elements.find(e => e.id === el.id);
        // #597 多选框拉伸：图片、图片堆栈、面板都需要最小尺寸限制
        if (elementData && (elementData.type === 'image' || elementData.type === 'image-stack' || elementData.type === 'generate-panel')) {
          // 计算当前图片元素的尺寸
          const currentWidth = el.width;
          const currentHeight = el.height;
          const currentMinSize = Math.min(currentWidth, currentHeight);
          
          // 计算该图片元素允许的最小缩放比例
          // 图片缩小后的尺寸 = currentMinSize * (finalScale / 初始缩放比例)
          // 我们需要确保：currentMinSize * (finalScale / 1) >= MIN_IMAGE_SIZE
          // 即：finalScale >= MIN_IMAGE_SIZE / currentMinSize
          const elMinScale = MIN_IMAGE_SIZE / currentMinSize;
          minAllowedScale = Math.max(minAllowedScale, elMinScale);
        }
      });
      
      // 限制缩放比例不能小于允许的最小值
      if (finalScale < minAllowedScale) {
        finalScale = minAllowedScale;
      }
      
      // 多选框本身的最小尺寸限制（兜底）
      const MIN_BOX_SIZE = 20;
      if (startBox.width * finalScale < MIN_BOX_SIZE || startBox.height * finalScale < MIN_BOX_SIZE) {
        finalScale = MIN_BOX_SIZE / Math.min(startBox.width, startBox.height);
      }
      
      const finalWidth = startBox.width * finalScale;
      const finalHeight = startBox.height * finalScale;
      
      if (corner.includes('w')) newX = startBox.x + startBox.width - finalWidth;
      if (corner.includes('n')) newY = startBox.y + startBox.height - finalHeight;
      
      // 3. 收集所有更新，准备批量提交 (避免卡顿)
      const updates = startElements.map(el => {
        const elementData = canvas.state.elements.find(e => e.id === el.id);
        const elUpdates: any = {
          x: newX + el.relX * finalWidth,
          y: newY + el.relY * finalHeight,
          width: el.relW * finalWidth,
          height: el.relH * finalHeight,
        };
        // 文字元素：同步缩放字体大小
        if (elementData && elementData.type === 'text' && elementData.fontSize) {
          elUpdates.fontSize = Math.round(elementData.fontSize * finalScale);
        }
        return { id: el.id, updates: elUpdates };
      });
      
      // 批量更新（不存历史记录）
      canvas.updateElementsBatch(updates);
    };
    
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setIsSelectionResizing(false);
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [selectionBox, zoom, canvas]);

  // 👑 #608 forceBringToFront 已废武功！
  // 以前：遍历所有 DOM 节点查 zIndex，直接操作 DOM style → 又臭又长还触发重排
  // 现在：BRING_TO_FRONT_AND_SELECT Reducer 直接改 state.zIndex，React 自动更新 DOM
  // 此函数保留空壳，所有调用点无需改动
  const forceBringToFront = useCallback((_elementId: string) => {
    // #608 不再需要遍历 DOM！Reducer 已经通过 zIndex 属性管理层叠顺序
  }, []);

  // 鼠标按下
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // #382 全局拦截：如果点击的是连线端口，直接返回，不触发任何选中逻辑
    const target = e.target as HTMLElement;
    // #873 修复：裁剪手柄向上穿透检测——无论点击手柄的哪个子像素，都正确识别
    if (target.closest('[data-crop-handle="true"]')) {
      return;
    }
    if (target.closest('.node-connection-port-hitbox')) {
      return;
    }
    // #841 修复：如果点击的是多选加号按钮，直接返回，不触发拖拽
    if (target.closest('#magnet-btn-multi-select') || target.closest('.multi-select-magnet-wrapper')) {
      return;
    }
    
    // 👑 全局拦截：如果点击的是 generate-panel 及其内部元素，直接返回
    // 但平移模式下不拦截，让画布处理平移
    // #871 修复：裁剪模式下也不拦截！crop handle 可能在 generate-panel 内部，
    // 必须让裁剪检查先执行，否则会误杀裁剪操作
    if (target.closest('[data-generate-panel="true"]') && activeTool !== 'hand' && !isCropping) {
      return;
    }
    
    // 👑 #577 免死金牌：如果当前正处于连线起始阶段，绝对不允许擦除状态！
    // 这是修复多选加号连线被 handleMouseDown 秒杀的关键拦截
    if (!isConnectionActiveGlobalRef.current) {
      // 点击任何地方，先关闭菜单并清理连线
      if (generateMenu.visible) {
        setGenerateMenu({ ...generateMenu, visible: false });
      }
      
      // #368 只有在没有连线进行时，点击画布才清理残留状态
      connectionDragStartRef.current = null;
      connectionDragTriggeredRef.current = false;
      draftLineRef.current = { active: false, sourceId: null, sourceType: null, startX: 0, startY: 0, snapTargetId: null, snapPortX: 0, snapPortY: 0 };
      // #60fps Phase1: 纯 ref 更新，不触发 React 渲染
      isConnectionActiveGlobalRef.current = false;  // #382 同步 ref
      resetConnectionVisualState();
      
      // #610 终结手术：Canvas 清除替代 SVG 清除
      clearInteractionCanvas();
    }
    
    // #分离式面板：点击画布空白处，收起下方输入控制台
    if (activeInputNodeId) {
      setActiveInputNodeId(null);
    }
    
    // 右键处理
    if (e.button === 2) {
      return;
    }
    
    if (e.button !== 0) return;
    
    // 从画布添加图片模式下，禁用所有选中操作
    if (isGridSelectMode) {
      return;
    }
    
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // 转换为画布坐标
    const canvasX = (x - pan.x) / zoom;
    const canvasY = (y - pan.y) / zoom;
    
    // 检查是否点击了文字元素（包括选中状态下的扩展区域）
    const textElements = canvas.state.elements.filter(el => el.type === 'text' && el.visible);
    const clickedText = textElements.some(el => {
      const textWidth = el.width || 50;
      const textHeight = el.height || (el.fontSize || 24) * 1.4 + 8;
      // 扩大检测范围，包括选中框的控制点
      const padding = canvas.state.selectedIds.includes(el.id) ? 30 : 5;
      return canvasX >= el.x - padding && canvasX <= el.x + textWidth + padding && 
             canvasY >= el.y - padding && canvasY <= el.y + textHeight + padding;
    });
    
    // 如果点击了文字元素区域，让 Fabric.js 处理
    if (clickedText) {
      return;
    }
    
    // 裁剪模式下：点击画布其他位置取消裁剪模式
    if (isCropping) {
      // 检查是否点击了裁剪相关元素
      const isCropRelated = target.closest('[data-crop-handle]') ||
                           target.closest('[data-crop-confirm]') ||
                           target.closest('.crop-overlay');

      if (!isCropRelated) {
        // 点击裁剪区域外，取消裁剪模式
        setIsCropping(false);
        setCropImageId(null);
        setCropRect(null);
      }
      return;
    }
    
    // 空格+左键：拖拽画布
    if (spacePressedRef.current) {
      e.preventDefault(); // 阻止浏览器默认行为（文本选择）
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y });
      return;
    }
    
    // 手型工具：拖拽画布
    if (activeTool === 'hand') {
      e.preventDefault(); // 阻止浏览器默认行为（文本选择）
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y });
      return;
    }

    // 画笔工具 - 直接绘制
    if (activeTool === 'pen') {
      e.preventDefault(); // 阻止浏览器默认行为（文本选择）
      setIsDrawing(true);
      setDrawPath([{ x: canvasX, y: canvasY }]);
      return;
    }
    
    // 文字工具 - 点击创建文字元素并进入编辑模式
    // 注意：文字元素由 FabricTextLayer 处理，这里只设置状态
    if (activeTool === 'text') {
      // 文字元素的创建由 FabricTextLayer 处理
      return;
    }
    
    // 矩形工具
    if (activeTool === 'rectangle') {
      e.preventDefault(); // 阻止浏览器默认行为（文本选择）
      setShapeStart({ x: canvasX, y: canvasY });
      return;
    }
    
    // 形状工具 - 所有形状都使用shapeStart
    if (activeTool.startsWith('shape-')) {
      e.preventDefault(); // 阻止浏览器默认行为（文本选择）
      setShapeStart({ x: canvasX, y: canvasY });
      return;
    }
    
    // ============== 👑 军师靶向拦截 (Kill-Switch) ==============
    // 如果鼠标的真实物理落点，是在面板的"加号端口"或"防爆力场"上
    
    if (e.target && e.target instanceof Element) {
      const blockade = e.target.closest('.panel-event-blockade');
      const hitbox = e.target.closest('.node-connection-port-hitbox');
      
      if (blockade || hitbox) {
        // 必须直接 return！绝对不允许执行后续的距离计算和图片连线触发！
        return;
      }
    }
    // =========================================================
    
    // 选择工具 - 查找点击的元素
    // 注意：文字元素由 Fabric.js 处理，这里不检测
    // #442 去中心化重构：连线触发权 100% 回归 DOM 节点
    // 废除全局 Canvas 磁吸触发器，只认真实的节点面积！不准在空气中磁吸！
    const clickedEl = [...canvas.state.elements].reverse().find(el => {
      if (!el.visible || el.locked) return false;
      // 跳过文字元素 - 由 Fabric.js 处理
      if (el.type === 'text') return false;
      // 图片元素：只认真实的节点面积！不准在空气中磁吸！
      if (el.type === 'image') {
        const isInImage = canvasX >= el.x && canvasX <= el.x + el.width &&
                          canvasY >= el.y && canvasY <= el.y + el.height;
        return isInImage; 
      }
      // 面板元素：只认真实的节点面积！不准在空气中磁吸！
      if (el.type === 'generate-panel') {
        const isInPanel = canvasX >= el.x && canvasX <= el.x + el.width &&
                          canvasY >= el.y && canvasY <= el.y + el.height;
        return isInPanel; 
      }
      // 其他元素：检查点击是否在元素边界内
      return canvasX >= el.x && canvasX <= el.x + el.width && 
             canvasY >= el.y && canvasY <= el.y + el.height;
    });
    
    if (clickedEl) {
      // #379 底层引擎拦截：检查是否点击了连线端口
      const targetEl = e.target instanceof Element ? e.target : null;
      
      if (targetEl && targetEl.closest('.node-connection-port-hitbox')) {
        // 不执行任何选中逻辑，让连线流程继续
        return;
      }

      // #军师方案：如果点击的是图片的磁吸范围（不是图片本身），让加号按钮接管
      if (clickedEl.type === 'image') {
        const isInImage = canvasX >= clickedEl.x && canvasX <= clickedEl.x + clickedEl.width &&
                          canvasY >= clickedEl.y && canvasY <= clickedEl.y + clickedEl.height;
        
        if (!isInImage) {
          // 👑 军师方案：数学雷达精准命中磁吸感应区，直接启动连线！
          // 彻底阻止默认行为，暗杀底层多选框
          e.preventDefault();
          e.stopPropagation();
          if (e.nativeEvent && (e.nativeEvent as any).stopImmediatePropagation) {
            (e.nativeEvent as any).stopImmediatePropagation();
          }
          
          // 计算连线起点：图片右边缘中心
          const startX = clickedEl.x + clickedEl.width;
          const startY = clickedEl.y + clickedEl.height / 2;
          
          // 👑 直接启动连线
          draftLineRef.current = {
            active: true,
            startX,
            startY,
            sourceId: clickedEl.id,
            sourceType: 'image',
            snapTargetId: null,
            snapPortX: 0,
            snapPortY: 0,
          };
          // #610 Canvas 层无需 display 切换（fixed 始终存在）
          // #60fps Phase1: 清除磁吸高亮状态，纯 DOM 操作
          updateCanvasVisualState({ snapTargetId: null });
          
          // 绝杀：直接 return，不执行图片选中和拖拽逻辑
          return;
        }
      }
      
      // 双击选择模式下，点击图片元素由图片元素自己处理（拖动和双击）
      if (isGridSelectMode && clickedEl.type === 'image') {
        return;
      }
      
      // #325 点击其他组件时收起面板弹窗
      if (activeInputNodeId && clickedEl.id !== activeInputNodeId) {
        setActiveInputNodeId(null);
      }
      
      // 检查点击的元素是否已经在选中列表中
      const isAlreadySelected = canvas.state.selectedIds.includes(clickedEl.id);
      
      // 如果点击的是已选中的元素（且不是shift+点击），准备多选拖动
      if (isAlreadySelected && !e.shiftKey && canvas.state.selectedIds.length > 1) {
        // 不改变选择，准备拖动所有选中的元素
        e.preventDefault(); // 阻止浏览器默认行为（文本选择）
        setDragElement(clickedEl.id);
        setIsDragging(true);
        setDragStart({ x: canvasX, y: canvasY, elX: clickedEl.x, elY: clickedEl.y });
        
        // 记录所有选中元素的初始位置（用于多选拖动）
        const selectedElements = canvas.state.elements.filter(
          el => canvas.state.selectedIds.includes(el.id)
        );
        (window as any).__groupStartPositions = selectedElements.map(el => ({
          id: el.id,
          x: el.x,
          y: el.y
        }));
      } else {
        // 单选或shift+点击添加选择
        canvas.selectElement(clickedEl.id, e.shiftKey);
        
        // 👑 #601 物理置顶：单选时直接操作 DOM，绕过 React 异步队列
        if (!e.shiftKey) {
          forceBringToFront(clickedEl.id);
        }
        
        if (!e.shiftKey) {
          e.preventDefault(); // 阻止浏览器默认行为（文本选择）
          setDragElement(clickedEl.id);
          setIsDragging(true);
          setDragStart({ x: canvasX, y: canvasY, elX: clickedEl.x, elY: clickedEl.y });
          (window as any).__groupStartPositions = null;
        }
      }
    } else {
      // 点击空白区域 - 检查是否点击了文字元素
      const clickedTextEl = [...canvas.state.elements].reverse().find(el => {
        if (!el.visible || el.locked) return false;
        if (el.type !== 'text') return false;
        // 检查点击是否在文字元素上
        const textWidth = el.width || 50;
        const textHeight = el.height || (el.fontSize || 24) * 1.4 + 8;
        return canvasX >= el.x && canvasX <= el.x + textWidth && 
               canvasY >= el.y && canvasY <= el.y + textHeight;
      });
      
      // 如果点击的是文字元素，不启动框选（由 Fabric.js 处理）
      if (clickedTextEl) {
        return;
      }
      
      // 点击空白区域 - 启动框选（但从画布添加图片模式除外）
      if (!isGridSelectMode) {
        canvas.clearSelection();
        setIsSelecting(true);
        setSelectionRect({ startX: canvasX, startY: canvasY, endX: canvasX, endY: canvasY });
        // 关闭面板弹窗
        setActiveInputNodeId(null);
      }
    }
  }, [canvas, zoom, pan, spacePressed, isCropping, activeTool, isGridSelectMode, generateMenu, activeInputNodeId]);

  // 鼠标移动 - #433 性能优化：requestAnimationFrame 节流
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // 存储 pending event
    pendingMouseMoveRef.current = e;
    
    // 如果已经有 raf 在等待，跳过
    if (mouseMoveRafRef.current) return;
    
    // 使用 raf 节流（每帧最多执行一次）
    mouseMoveRafRef.current = requestAnimationFrame(() => {
      mouseMoveRafRef.current = null;
      const event = pendingMouseMoveRef.current;
      if (!event) return;
      
      // #612 坐标归一化修复：恢复 containerRef rect！
      // ⚠️ containerRef 不是全屏的！它有 left/top 偏移（侧边栏+padding）
      // Canvas 是 position:fixed 认视口坐标，但 pan 是相对 containerRef 的
      // 所以必须先减去 rect.left/top 得到容器内坐标，再转画布坐标
      // 而绘制到 Canvas 时，屏幕坐标 = rect.left + canvasX * zoom + pan.x
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      // 容器内坐标（与 pan 同一坐标系）
      const containerX = event.clientX - rect.left;
      const containerY = event.clientY - rect.top;
      
      // 画布坐标 = (容器内坐标 - pan) / zoom
      const canvasX = (containerX - pan.x) / zoom;
      const canvasY = (containerY - pan.y) / zoom;
      
      // 👑 最高优先级：流光连线绘制 + 磁吸检测
      if (draftLineRef.current.active) {
        const { startX, startY, sourceType, sourceId } = draftLineRef.current;
      
      // 🔧 坐标系：统一使用画布坐标计算贝塞尔曲线（与脉冲线一致）
      // draftLineRef.current 存储的是画布坐标
      const startCanvasX = startX;
      const startCanvasY = startY;
      
      // 👑 磁吸检测：根据源节点类型决定检测目标
      let snapTargetId: string | null = null;
      let snapPortCanvasX = canvasX;
      let snapPortCanvasY = canvasY;
      const minDistance = 20; // 连线磁吸半径 20px
      const minDistanceSq = minDistance * minDistance; // 🚀 #434 性能优化：预计算平方值
      
      // 🚀 #434 性能优化：合并 image 和 image-stack 分支（目标类型相同），用平方比较替代 Math.sqrt
      if (sourceType === 'image' || sourceType === 'image-stack' || sourceType === 'multi-select' || sourceType === 'video') {
        // 图片/图片栈/多选 → 面板/图片栈：检测所有 generate-panel 和 image-stack 的输入端口
        canvas.state.elements.forEach(targetEl => {
          if (targetEl.type !== 'generate-panel' && targetEl.type !== 'image-stack') return;
          
          // 🔒 跳过已连接的目标（防止重复吸附）——多选时跳过已选中的元素
          if (sourceType === 'multi-select') {
            if (canvas.state.selectedIds.includes(targetEl.id)) return;
          } else {
            const currentSourceIds = targetEl.sourceIds || [];
            if (sourceId && currentSourceIds.includes(sourceId)) return;
          }
          
          // 目标输入端口位置（屏幕坐标用于检测，画布坐标用于渲染）
          // - generate-panel：左侧边缘中心
          // - image-stack：顶部边缘中心
          let portScreenX: number, portScreenY: number;
          let portCanvasX: number, portCanvasY: number;
          
          if (targetEl.type === 'generate-panel') {
            portCanvasX = targetEl.x;
            portCanvasY = targetEl.y + targetEl.height / 2;
          } else {
            // image-stack：顶部边缘中心
            portCanvasX = targetEl.x + (targetEl.width || 280) / 2;
            portCanvasY = targetEl.y;
          }
          portScreenX = portCanvasX * zoom + pan.x;
          portScreenY = portCanvasY * zoom + pan.y;
          
          // 🚀 #434 性能优化：用平方比较替代 Math.sqrt
          // #612 坐标归一化修复：containerX/Y 和 portScreenX/Y 都是容器内坐标，对齐！
          const dx = containerX - portScreenX;
          const dy = containerY - portScreenY;
          const distanceSq = dx * dx + dy * dy;
          
          if (distanceSq < minDistanceSq) {
            snapTargetId = targetEl.id;
            snapPortCanvasX = portCanvasX;
            snapPortCanvasY = portCanvasY;
          }
        });
      } else if (sourceType === 'panel') {
        // #424 面板 → 图片栈/面板：检测所有图片栈和面板的输入端口
        // #615 修复：移除对普通图片(image)的支持，面板拉线只能连接到面板或图片栈
        // #视频功能 补丁一：获取源面板类型
        const sourcePanelType = draftLineRef.current.sourcePanelType;
        
        canvas.state.elements.forEach(targetEl => {
          // #615 修复：面板拉线只能连接到 generate-panel 或 image-stack，不能连接普通图片
          if (targetEl.type !== 'image-stack' && targetEl.type !== 'generate-panel') return;
          
          // 🔒 跳过已连接的目标（防止重复吸附）
          const currentSourceIds = targetEl.sourceIds || [];
          if (sourceId && currentSourceIds.includes(sourceId)) return;
          
          // #621 视频面板允许输出连线（仅文本菜单），不再禁止
        // if (sourcePanelType === 'video') return; // 已移除
          
          // #视频功能 补丁一：如果目标是视频面板，只允许图片面板和文本面板连接
          if (targetEl.type === 'generate-panel' && (targetEl as any).panelType === 'video') {
            // 图片面板 → 视频面板：图生视频 ✅
            // 文本面板 → 视频面板：提供 prompt ✅
            // 视频面板 → 视频面板：禁止 ❌（已在上面拦截）
            if (sourcePanelType !== 'image' && sourcePanelType !== 'text') {
              return;
            }
          }
          
          // 目标输入端口位置（屏幕坐标用于检测，画布坐标用于渲染）
          // - generate-panel：左侧边缘中心
          // - image-stack：顶部边缘中心
          let portScreenX: number, portScreenY: number;
          let portCanvasX: number, portCanvasY: number;
          
          if (targetEl.type === 'generate-panel') {
            // #424 面板：左侧边缘中心
            portCanvasX = targetEl.x;
            portCanvasY = targetEl.y + targetEl.height / 2;
          } else {
            // image-stack：顶部边缘中心
            portCanvasX = targetEl.x + (targetEl.width || 280) / 2;
            portCanvasY = targetEl.y;
          }
          portScreenX = portCanvasX * zoom + pan.x;
          portScreenY = portCanvasY * zoom + pan.y;
          
          // 🚀 #434 性能优化：用平方比较替代 Math.sqrt
          // #612 坐标归一化修复：containerX/Y 和 portScreenX/Y 都是容器内坐标，对齐！
          const dx = containerX - portScreenX;
          const dy = containerY - portScreenY;
          const distanceSq = dx * dx + dy * dy;
          
          if (distanceSq < minDistanceSq) {
            snapTargetId = targetEl.id;
            snapPortCanvasX = portCanvasX;
            snapPortCanvasY = portCanvasY;
          }
        });
      }
      
      // 更新磁吸状态 - 只用 ref，不触发 React 重绘
      // 👑 #军师方案：删除 setSnapHighlightId，只用 DOM 操作控制高亮
      draftLineRef.current.snapTargetId = snapTargetId;
      draftLineRef.current.snapPortX = snapPortCanvasX;
      draftLineRef.current.snapPortY = snapPortCanvasY;
      // ❌ 删除：setSnapHighlightId 触发全页面重绘
      // setSnapHighlightId((prevId) => {
      //   if (prevId !== snapTargetId) return snapTargetId;
      //   return prevId;
      // });
      
      // 👑 终点坐标（画布坐标）：如果磁吸且源类型合法，则使用吸附坐标，否则使用鼠标坐标
      // 🔧 #576 修复：显式声明允许使用磁吸坐标的源类型，确保 multi-select 不被遗漏
      const validSnapTypes = ['image', 'image-stack', 'multi-select', 'panel', 'video'];
      const endCanvasX = (snapTargetId && validSnapTypes.includes(sourceType || '')) ? snapPortCanvasX : canvasX;
      const endCanvasY = (snapTargetId && validSnapTypes.includes(sourceType || '')) ? snapPortCanvasY : canvasY;
      
      // #610 终结手术：Canvas 交互层替代 SVG 绘制拖拽连线
      // ❌ 旧代码：generateBezierPathWithTransform + SVG setAttribute，触发 Chrome 混合合成陷阱
      // ✅ 新代码：drawDraftLine 直接在 Canvas 上绘制，零 DOM 操作
      // #612 坐标归一化修复：Canvas 是 position:fixed，需要视口坐标
      // 画布坐标 → 容器内坐标 → 视口坐标（+rect.left/top）
      const startScreenX = startCanvasX * zoom + pan.x + rect.left;
      const startScreenY = startCanvasY * zoom + pan.y + rect.top;
      const endScreenX = endCanvasX * zoom + pan.x + rect.left;
      const endScreenY = endCanvasY * zoom + pan.y + rect.top;
      drawDraftLine(
        startScreenX, startScreenY,
        endScreenX, endScreenY,
        startCanvasX, startCanvasY,
        endCanvasX, endCanvasY,
        zoom, pan.x + rect.left, pan.y + rect.top
      );
      
      // 👑 #576 磁吸时更新端口高亮样式（Vanilla JS 直操作 DOM，绕过 React 渲染延迟）
      // 状态比对阻断：仅在 snapTargetId 变化时执行 DOM 操作，避免每帧遍历
      if (snapTargetId !== lastSnapTargetIdRef.current) {
        // 先清除所有端口的高亮
        document.querySelectorAll('[data-port-type="input"], [data-port-type="output"]').forEach(port => {
          (port as HTMLElement).classList.remove('port-snap-active');
        });
        // 高亮目标端口：优先按 data-port-target 匹配，兜底按 data-element-id 匹配
        if (snapTargetId) {
          const targetPort = document.querySelector(`[data-port-target="${snapTargetId}"]`) 
            || document.querySelector(`[data-element-id="${snapTargetId}"] [data-port-type="input"]`);
          if (targetPort) (targetPort as HTMLElement).classList.add('port-snap-active');
        }
        lastSnapTargetIdRef.current = snapTargetId;
      }
      
      return; // 👑 画完线直接 return
    }
    
    // 查找鼠标所在位置的元素（从上往下找，最上面的元素优先）
    // 支持 image 和 generate-panel 两种类型
    const hoveredEl = [...canvas.state.elements].reverse().find(el => {
      if (!el.visible) return false;
      
      // ====== 图片类型检测 ======
      if (el.type === 'image') {
        // 检查是否在图片边界内
        const isInImage = canvasX >= el.x && canvasX <= el.x + el.width &&
                          canvasY >= el.y && canvasY <= el.y + el.height;
        
        // #358 磁吸范围使用图片相对值
        const imgMinSize = Math.min(el.width, el.height);
        const buttonSize = imgMinSize * 0.16; // 按钮大小 = 图片最小边的 16%
        const buttonOffset = buttonSize + 8; // 按钮中心偏移 = 按钮大小 + 间距
        const magnetRadius = buttonSize * 2; // 磁吸半径 = 按钮大小的 2 倍
        const btnCenterX = el.x + el.width + buttonOffset;
        const btnCenterY = el.y + el.height / 2;
        const distX = canvasX - btnCenterX;
        const distY = canvasY - btnCenterY;
        const distance = Math.sqrt(distX * distX + distY * distY);
        const isInMagnetRange = distance < magnetRadius;
        
        // 图片内 OR 磁吸范围内才触发
        return isInImage || isInMagnetRange;
      }
      
      // ====== 视频类型检测 ======
      if (el.type === 'video') {
        // #622 视频元素 hover 检测：与图片类型逻辑一致
        const isInVideo = canvasX >= el.x && canvasX <= el.x + el.width &&
                          canvasY >= el.y && canvasY <= el.y + el.height;
        
        // 磁吸范围检测（与图片一致）
        const videoMinSize = Math.min(el.width, el.height);
        const buttonSize = videoMinSize * 0.16;
        const buttonOffset = buttonSize + 8;
        const magnetRadius = buttonSize * 2;
        const btnCenterX = el.x + el.width + buttonOffset;
        const btnCenterY = el.y + el.height / 2;
        const distX = canvasX - btnCenterX;
        const distY = canvasY - btnCenterY;
        const distance = Math.sqrt(distX * distX + distY * distY);
        const isInMagnetRange = distance < magnetRadius;
        
        return isInVideo || isInMagnetRange;
      }
      
      // ====== 面板类型检测 ======
      if (el.type === 'generate-panel') {
        // 检查是否在面板边界内
        const isInPanel = canvasX >= el.x && canvasX <= el.x + el.width &&
                          canvasY >= el.y && canvasY <= el.y + el.height;
        
        // 端口磁吸检测
        const panelMinSize = Math.min(el.width, el.height);
        const buttonSize = panelMinSize * 0.10;
        const containerSize = buttonSize + 15;
        const magnetRadius = containerSize * 1.5;
        // #436 性能优化：平方比较替代 Math.sqrt
        const magnetRadiusSq = magnetRadius * magnetRadius;
        
        // 左侧输入端口
        const inputPortX = el.x - containerSize / 2;
        const inputPortY = el.y + el.height / 2;
        const distInputSq = Math.pow(canvasX - inputPortX, 2) + Math.pow(canvasY - inputPortY, 2);
        const isNearInputPort = distInputSq < magnetRadiusSq;
        
        // 右侧输出端口
        const outputPortX = el.x + el.width + containerSize / 2;
        const outputPortY = el.y + el.height / 2;
        const distOutputSq = Math.pow(canvasX - outputPortX, 2) + Math.pow(canvasY - outputPortY, 2);
        const isNearOutputPort = distOutputSq < magnetRadiusSq;
        
        return isInPanel || isNearInputPort || isNearOutputPort;
      }
      
      return false;
    });
    
    // 更新 hover 状态
    let newHoveredId = hoveredEl?.id || null;
    
    // 👑 #595 全局截胡：多选框边缘磁吸检测（解耦架构）
    // 当鼠标在多选框加号位置附近时，强行伪造悬浮状态
    if (!newHoveredId && canvas.state.selectedIds.length > 1 && selectionBox) {
      // 获取多选加号的物理中心点（多选框右边缘垂直居中）
      const plusX = selectionBox.x + selectionBox.width;
      const plusY = selectionBox.y + selectionBox.height / 2;
      
      // 计算鼠标到多选加号的距离
      const distSq = (canvasX - plusX) ** 2 + (canvasY - plusY) ** 2;
      const magnetThreshold = 50 / zoom; // 磁吸阈值（屏幕坐标）
      
      if (distSq < magnetThreshold * magnetThreshold) {
        // 如果进入了多选加号的磁吸范围，强行伪造一个悬浮目标
        // 将第一个被选中的元素 ID 赋值给它，这样 isHoveringSelected 就会变成 true
        newHoveredId = canvas.state.selectedIds[0];
      }
    }
    
    // 👑 军师方案：只更新 ref，不触发 forceUpdateForHover 全局重绘
    // 单图加号由图片元素的 onMouseEnter/onMouseLeave 直接控制 DOM
    // 多选加号由这里直接操作 DOM
    if (hoveredElementIdRef.current !== newHoveredId) {
      hoveredElementIdRef.current = newHoveredId;
      // ❌ 删除：forceUpdateForHover(n => n + 1);  // 这是导致图片模糊的罪魁祸首
      
      // 👑 军师方案：直接操作多选加号 DOM，不触发 React 重绘
      const multiSelectPlusBtn = document.getElementById('magnet-btn-multi-select');
      if (multiSelectPlusBtn) {
        const parentEl = multiSelectPlusBtn.parentElement as HTMLElement;
        if (parentEl) {
          const isHoveringSelected = canvas.state.selectedIds.some(id => newHoveredId === id);
          parentEl.style.opacity = isHoveringSelected ? '1' : '0';
        }
      }
    }
    
    // 👑 零渲染磁吸计算 (Bypass React) - 直接操作 DOM
    // #436 性能优化：平方比较 + DOM 缓存
    if (hoveredElementIdRef.current) {
      const hoveredElement = canvas.state.elements.find(e => e.id === hoveredElementIdRef.current);
      if (hoveredElement) {
        // ====== 图片类型磁吸 ======
        if (hoveredElement.type === 'image') {
          // #393 按总面积计算基准尺寸，与渲染保持一致
          const baseSize = Math.sqrt(hoveredElement.width * hoveredElement.height);
          const buttonSizePercent = 0.05;
          const buttonSize = baseSize * buttonSizePercent;
          const containerSize = buttonSize + 15;
          const buttonOffset = containerSize / 2 + 8;
          const magnetRadius = containerSize * 1.5;
          const magnetRadiusSq = magnetRadius * magnetRadius;
          const btnCenterX = hoveredElement.x + hoveredElement.width + buttonOffset;
          const btnCenterY = hoveredElement.y + hoveredElement.height / 2;

          const distX = canvasX - btnCenterX;
          const distY = canvasY - btnCenterY;
          const distanceSq = distX * distX + distY * distY;

          // #436 DOM 缓存
          let magnetDom: HTMLElement | null = magnetDomCacheRef.current.get(hoveredElement.id) || null;
          if (!magnetDom || !magnetDom.isConnected) {
            magnetDom = document.getElementById(`magnet-btn-${hoveredElement.id}`);
            if (magnetDom) magnetDomCacheRef.current.set(hoveredElement.id, magnetDom);
          }
          if (magnetDom) {
            if (distanceSq < magnetRadiusSq) {
              // 👑 #天坑三修复：Math.round() 强制对齐整数像素，消除亚像素震荡！
              const tx = Math.round(distX * 0.8);
              const ty = Math.round(distY * 0.8);
              // #610 终结手术：translate3d 改为 translate，根除混合合成陷阱
              // ❌ 旧代码 translate3d 强制创建 GPU 图层，在 scale 容器内触发 CPU 图片重栅格化
              magnetDom.style.transform = `translate(${tx}px, ${ty}px)`;
            } else {
              // #610 终结手术：还原时也用 translate，不创建 GPU 图层
              magnetDom.style.transform = `translate(0px, 0px)`;
            }
          }
        }
        
        // ====== 视频类型磁吸 ======
        // #622 视频加号磁吸：与图片类型逻辑完全一致
        if (hoveredElement.type === 'video') {
          const baseSize = Math.sqrt(hoveredElement.width * hoveredElement.height);
          const buttonSizePercent = 0.05;
          const buttonSize = baseSize * buttonSizePercent;
          const containerSize = buttonSize + 15;
          const buttonOffset = containerSize / 2 + 8;
          const magnetRadius = containerSize * 1.5;
          const magnetRadiusSq = magnetRadius * magnetRadius;
          const btnCenterX = hoveredElement.x + hoveredElement.width + buttonOffset;
          const btnCenterY = hoveredElement.y + hoveredElement.height / 2;

          const distX = canvasX - btnCenterX;
          const distY = canvasY - btnCenterY;
          const distanceSq = distX * distX + distY * distY;

          let magnetDom: HTMLElement | null = magnetDomCacheRef.current.get(hoveredElement.id) || null;
          if (!magnetDom || !magnetDom.isConnected) {
            magnetDom = document.getElementById(`magnet-btn-${hoveredElement.id}`);
            if (magnetDom) magnetDomCacheRef.current.set(hoveredElement.id, magnetDom);
          }
          if (magnetDom) {
            if (distanceSq < magnetRadiusSq) {
              const tx = Math.round(distX * 0.8);
              const ty = Math.round(distY * 0.8);
              magnetDom.style.transform = `translate(${tx}px, ${ty}px)`;
            } else {
              magnetDom.style.transform = `translate(0px, 0px)`;
            }
          }
        }
        
        // ====== 面板类型磁吸 ======
        if (hoveredElement.type === 'generate-panel') {
          // #393 按总面积计算基准尺寸，与渲染保持一致
          const baseSize = Math.sqrt(hoveredElement.width * hoveredElement.height);
          const buttonSizePercent = 0.05;
          const buttonSize = baseSize * buttonSizePercent;
          const containerSize = buttonSize + 15;
          const magnetRadius = containerSize * 1.5;
          const magnetRadiusSq = magnetRadius * magnetRadius;

          // 左侧输入端口磁吸
          const inputPortX = hoveredElement.x - containerSize / 2;
          const inputPortY = hoveredElement.y + hoveredElement.height / 2;
          const distInputX = canvasX - inputPortX;
          const distInputY = canvasY - inputPortY;
          const distInputSq = distInputX * distInputX + distInputY * distInputY;

          // #436 DOM 缓存
          const inputCacheKey = `input-${hoveredElement.id}`;
          let inputMagnetDom: HTMLElement | null = magnetDomCacheRef.current.get(inputCacheKey) || null;
          if (!inputMagnetDom || !inputMagnetDom.isConnected) {
            inputMagnetDom = document.getElementById(`magnet-btn-input-${hoveredElement.id}`);
            if (inputMagnetDom) magnetDomCacheRef.current.set(inputCacheKey, inputMagnetDom);
          }
          if (inputMagnetDom) {
            if (distInputSq < magnetRadiusSq) {
              // 👑 #天坑三修复：Math.round() 强制对齐整数像素，消除亚像素震荡！
              const tx = Math.round(distInputX * 0.8);
              const ty = Math.round(distInputY * 0.8);
              inputMagnetDom.style.transform = `translate(${tx}px, ${ty}px)`;
            } else {
              inputMagnetDom.style.transform = `translate(0px, 0px)`;
            }
          }

          // 右侧输出端口磁吸
          const outputPortX = hoveredElement.x + hoveredElement.width + containerSize / 2;
          const outputPortY = hoveredElement.y + hoveredElement.height / 2;
          const distOutputX = canvasX - outputPortX;
          const distOutputY = canvasY - outputPortY;
          const distOutputSq = distOutputX * distOutputX + distOutputY * distOutputY;

          // #436 DOM 缓存
          const outputCacheKey = `output-${hoveredElement.id}`;
          let outputMagnetDom: HTMLElement | null = magnetDomCacheRef.current.get(outputCacheKey) || null;
          if (!outputMagnetDom || !outputMagnetDom.isConnected) {
            outputMagnetDom = document.getElementById(`magnet-btn-output-${hoveredElement.id}`);
            if (outputMagnetDom) magnetDomCacheRef.current.set(outputCacheKey, outputMagnetDom);
          }
          if (outputMagnetDom) {
            if (distOutputSq < magnetRadiusSq) {
              // 👑 #天坑三修复：Math.round() 强制对齐整数像素，消除亚像素震荡！
              const tx = Math.round(distOutputX * 0.8);
              const ty = Math.round(distOutputY * 0.8);
              outputMagnetDom.style.transform = `translate(${tx}px, ${ty}px)`;
            } else {
              outputMagnetDom.style.transform = `translate(0px, 0px)`;
            }
          }
        }
      }
    }
    
    // 👑 #577 多选加号磁吸跟随：让多选框右边缘的加号跟随鼠标 Y 轴移动
    if (selectionBox && canvas.state.selectedIds.length > 1) {
      // 获取多选加号 DOM
      const multiSelectMagnetDom = document.getElementById('magnet-btn-multi-select');
      
      if (multiSelectMagnetDom) {
        // 🔧 #577 修复：直接用 DOM 实际位置，不再用公式计算
        const domRect = multiSelectMagnetDom.getBoundingClientRect();
        
        // #613 修复：getBoundingClientRect 返回视口坐标，必须用 clientX/clientY 匹配
        // ❌ 旧代码用 event.screenX（物理屏幕坐标，含窗口偏移）→ 与 rect 视口坐标不匹配 → 加号不会动
        const btnScreenX = domRect.left + domRect.width / 2;
        const btnScreenY = domRect.top + domRect.height / 2;
        
        // 鼠标的视口坐标（clientX, clientY）
        const distScreenX = event.clientX - btnScreenX;
        const distScreenY = event.clientY - btnScreenY;
        const distanceScreenSq = distScreenX * distScreenX + distScreenY * distScreenY;
        
        // 磁吸半径（屏幕像素）- 与单图一致：containerSize * 1.5
        // 单图在画布坐标空间用 containerSize * 1.5，多选在屏幕空间需等价计算
        const screenBoxWidth = selectionBox ? selectionBox.width * zoom : 200;
        const screenBoxHeight = selectionBox ? selectionBox.height * zoom : 200;
        const baseSize = Math.sqrt(screenBoxWidth * screenBoxHeight);
        const buttonSizePercent = 0.05;
        // #580 对齐单图：移除 32px 上限
        const buttonSize = baseSize * buttonSizePercent;
        const containerSize = buttonSize + 15;
        const magnetRadius = containerSize * 1.5;
        const magnetRadiusSq = magnetRadius * magnetRadius;
        
        if (distanceScreenSq < magnetRadiusSq) {
          // 在磁吸范围内：让加号跟随鼠标移动
          // 👑 #天坑三修复：Math.round() 强制对齐整数像素，消除亚像素震荡！
          const tx = Math.round(distScreenX * 0.8);
          const ty = Math.round(distScreenY * 0.8);
          
          multiSelectMagnetDom.style.transform = `translate(${tx}px, ${ty}px)`;
        } else {
          // 离开磁吸范围：回到原位
          multiSelectMagnetDom.style.transform = `translate(0px, 0px)`;
        }
      }
    }
    
    // 画布拖拽（空格+左键 或 手型工具）
    if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      
      // #048 修复：使用 zoom state 而不是 zoomRef.current（zoomRef 从未更新）
      let newPanX = panStart.panX + dx;
      let newPanY = panStart.panY + dy;
      
      // 限制pan边界，确保画布在容器内（和滚轮缩放逻辑一致）
      const canvasScreenW = CANVAS_WIDTH * zoom;
      const canvasScreenH = canvasHeight * zoom;
      const rect = containerRef.current?.getBoundingClientRect();
      
      if (rect) {
        if (canvasScreenW <= rect.width) {
          newPanX = (rect.width - canvasScreenW) / 2;
        } else {
          newPanX = Math.max(rect.width - canvasScreenW, Math.min(0, newPanX));
        }
        
        if (canvasScreenH <= rect.height) {
          newPanY = (rect.height - canvasScreenH) / 2;
        } else {
          newPanY = Math.max(rect.height - canvasScreenH, Math.min(0, newPanY));
        }
      }
      
      // #042 性能优化：移动过程中只更新 ref 和 DOM，不触发 React 重渲染
      panRef.current = { x: newPanX, y: newPanY };
      
      // 直接更新 DOM transform（不触发 React 重渲染）
      if (containerRef.current) {
        // 同时更新 svg-layer 和 node-layer 两个图层
        const svgLayer = containerRef.current.querySelector('[data-canvas-layer="svg-layer"]') as HTMLElement;
        const nodeLayer = containerRef.current.querySelector('[data-canvas-layer="node-layer"]') as HTMLElement;
        if (svgLayer) {
          svgLayer.style.transform = `translate(${newPanX}px, ${newPanY}px) scale(${zoom})`;
        }
        if (nodeLayer) {
          nodeLayer.style.transform = `translate(${newPanX}px, ${newPanY}px) scale(${zoom})`;
        }
      }
      return;
    }
    
    // 裁剪框拖拽由全局事件监听器处理

    // 画笔绘制
    if (isDrawing && canvas.state.tool === 'pen') {
      setDrawPath(prev => [...prev, { x: canvasX, y: canvasY }]);
      return;
    }

    // 形状预览
    if (shapeStart && (canvas.state.tool === 'rectangle' || canvas.state.tool.startsWith('shape-'))) {
      const width = Math.abs(canvasX - shapeStart.x);
      const height = Math.abs(canvasY - shapeStart.y);
      const startX = Math.min(canvasX, shapeStart.x);
      const startY = Math.min(canvasY, shapeStart.y);
      
      setShapePreview({
        x: startX,
        y: startY,
        width,
        height,
        type: canvas.state.tool
      });
      return;
    }

    // 框选更新 - 由全局事件监听器处理

    // 拖动元素 - 由全局事件监听处理，这里不再处理
    // 避免 mouseleave 后拖动中断的问题
    }); // #433 raf 回调结束
  }, [isDragging, dragStart, canvas, dragElement, isDrawing, zoom, pan, isPanning, panStart, isCropping, cropHandle, cropRect, cropImageId, shapeStart, CANVAS_WIDTH, canvasHeight, spacePressed]);

  // 鼠标松开
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // 👑 流光连线结束 - 磁吸连接 or 空放弹窗
    if (draftLineRef.current.active) {
      const { sourceId, sourceType, snapTargetId } = draftLineRef.current;
      
      // 清除端口高亮
      document.querySelectorAll('[data-port-type="input"]').forEach(port => {
        (port as HTMLElement).classList.remove('port-snap-active');
      });
      // #60fps Phase1: 纯 DOM 操作
      updateCanvasVisualState({ snapTargetId: null });
      
      // 👑 场景1：磁吸成功 - 直接连接并清除线条
      if (snapTargetId) {
        const targetEl = canvas.state.elements.find(el => el.id === snapTargetId);
        
        if (sourceType === 'image' && targetEl?.type === 'generate-panel') {
          // 图片 → 面板：更新面板的 sourceIds
          if (canvas.updateElement && sourceId) {
            const currentSourceIds = targetEl.sourceIds || [];
            if (!currentSourceIds.includes(sourceId)) {
              const newSourceIds = [...currentSourceIds, sourceId];
              canvas.updateElement(snapTargetId, { sourceIds: newSourceIds });
            }
          }
        } else if (sourceType === 'image' && targetEl?.type === 'image-stack') {
          // 图片 → 图片栈：更新图片栈的 sourceIds
          if (canvas.updateElement && sourceId) {
            const currentSourceIds = targetEl.sourceIds || [];
            if (!currentSourceIds.includes(sourceId)) {
              const newSourceIds = [...currentSourceIds, sourceId];
              canvas.updateElement(snapTargetId, { sourceIds: newSourceIds });
            }
          }
        } else if (sourceType === 'video' && targetEl?.type === 'generate-panel') {
          // #621 视频 → 面板：更新面板的 sourceIds
          if (canvas.updateElement && sourceId) {
            const currentSourceIds = targetEl.sourceIds || [];
            if (!currentSourceIds.includes(sourceId)) {
              const newSourceIds = [...currentSourceIds, sourceId];
              canvas.updateElement(snapTargetId, { sourceIds: newSourceIds });
            }
          }
        } else if (sourceType === 'video' && targetEl?.type === 'image-stack') {
          // #621 视频 → 图片栈：更新图片栈的 sourceIds
          if (canvas.updateElement && sourceId) {
            const currentSourceIds = targetEl.sourceIds || [];
            if (!currentSourceIds.includes(sourceId)) {
              const newSourceIds = [...currentSourceIds, sourceId];
              canvas.updateElement(snapTargetId, { sourceIds: newSourceIds });
            }
          }
        } else if (sourceType === 'panel' && targetEl?.type === 'image') {
          // 面板 → 图片：更新图片的 sourceIds（反向连接）
          if (canvas.updateElement && sourceId) {
            const currentSourceIds = targetEl.sourceIds || [];
            if (!currentSourceIds.includes(sourceId)) {
              const newSourceIds = [...currentSourceIds, sourceId];
              canvas.updateElement(snapTargetId, { sourceIds: newSourceIds });
            }
          }
        } else if (sourceType === 'panel' && targetEl?.type === 'image-stack') {
          // 面板 → 图片栈：更新图片栈的 sourceIds
          if (canvas.updateElement && sourceId) {
            const currentSourceIds = targetEl.sourceIds || [];
            if (!currentSourceIds.includes(sourceId)) {
              const newSourceIds = [...currentSourceIds, sourceId];
              canvas.updateElement(snapTargetId, { sourceIds: newSourceIds });
            }
          }
        } else if (sourceType === 'panel' && targetEl?.type === 'generate-panel') {
          // 面板 → 面板：更新目标面板的 sourceIds
          if (canvas.updateElement && sourceId) {
            const currentSourceIds = targetEl.sourceIds || [];
            if (!currentSourceIds.includes(sourceId)) {
              const newSourceIds = [...currentSourceIds, sourceId];
              canvas.updateElement(snapTargetId, { sourceIds: newSourceIds });
            }
          }
        } else if (sourceType === 'image-stack' && targetEl?.type === 'generate-panel') {
          // 图片栈 → 面板：更新面板的 sourceIds（传递 activeIndex 对应的首图）
          if (canvas.updateElement && sourceId) {
            const currentSourceIds = targetEl.sourceIds || [];
            if (!currentSourceIds.includes(sourceId)) {
              const newSourceIds = [...currentSourceIds, sourceId];
              canvas.updateElement(snapTargetId, { sourceIds: newSourceIds });
            }
          }
        } else if (sourceType === 'image-stack' && targetEl?.type === 'image-stack') {
          // 图片栈 → 图片栈：更新目标图片栈的 sourceIds
          if (canvas.updateElement && sourceId) {
            const currentSourceIds = targetEl.sourceIds || [];
            if (!currentSourceIds.includes(sourceId)) {
              const newSourceIds = [...currentSourceIds, sourceId];
              canvas.updateElement(snapTargetId, { sourceIds: newSourceIds });
            }
          }
        } else if (sourceType === 'multi-select') {
          // 👑 #572 多选 → 面板/图片栈：将所有选中的图片ID添加到目标的 sourceIds
          if (canvas.updateElement && (targetEl?.type === 'generate-panel' || targetEl?.type === 'image-stack')) {
            const selectedIds = canvas.state.selectedIds;
            const currentSourceIds = targetEl.sourceIds || [];
            const newSourceIds = [...currentSourceIds];
            selectedIds.forEach(id => {
              // 只添加图片/面板/视频类型的元素
              const el = canvas.state.elements.find(e => e.id === id);
              if (el && (el.type === 'image' || el.type === 'generate-panel' || el.type === 'image-stack' || el.type === 'video')) {
                if (!newSourceIds.includes(id)) {
                  newSourceIds.push(id);
                }
              }
            });
            canvas.updateElement(snapTargetId, { sourceIds: newSourceIds });
            // #613 修复：多选连接成功后才清除选中状态
            canvas.clearSelection?.();
          }
        }
        
        // 清除连线状态
        draftLineRef.current.active = false;
        draftLineRef.current.snapTargetId = null;
        // #60fps Phase1: 纯 ref + DOM 操作，不触发 React 渲染
        isConnectionActiveGlobalRef.current = false;  // #382 同步 ref
        resetConnectionVisualState();
        
        // #610 终结手术：Canvas 清除替代 SVG 隐藏
        clearInteractionCanvas();
      } else {
        // 👑 场景2：空放 - 弹出快捷菜单，保留线条指向菜单
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          // #334 存储屏幕坐标（用于菜单显示）和画布坐标（用于创建面板）
          const screenX = e.clientX - rect.left;
          const screenY = e.clientY - rect.top;
          const canvasX = (e.clientX - rect.left - pan.x) / zoom;
          const canvasY = (e.clientY - rect.top - pan.y) / zoom;
          
          // 👑 多选空放：传递 sourceIds 和 sourceType
          // #613 修复：先保存 selectedIds 再清除，避免 clearSelection 后 selectedIds 为空
          // #615 修复：同时保存 selectionBox 尺寸，用于创建面板
          if (sourceType === 'multi-select') {
            const multiSelectIds = canvas.state.selectedIds.filter(id => {
              const el = canvas.state.elements.find(e2 => e2.id === id);
              return el && (el.type === 'image' || el.type === 'generate-panel' || el.type === 'image-stack' || el.type === 'video');
            });
            // #629 多选时检测是否包含视频节点
            const hasVideoNode = multiSelectIds.some(id => {
              const el = canvas.state.elements.find(e2 => e2.id === id);
              return el?.type === 'video';
            });
            // #615 保存 selectionBox 尺寸（clearSelection 后 selectionBox 会变成 null）
            const savedSelectionBoxWidth = selectionBox?.width;
            const savedSelectionBoxHeight = selectionBox?.height;
            setGenerateMenu({ 
              visible: true, x: screenX, y: screenY, canvasX, canvasY, sourceId, sourceIds: multiSelectIds, sourceType: 'multi-select',
              selectionBoxWidth: savedSelectionBoxWidth,
              selectionBoxHeight: savedSelectionBoxHeight,
              sourceElementType: hasVideoNode ? 'video' : undefined, // #629 包含视频时禁用图片/视频按钮
            });
            // 连接完成后再清除选中状态
            canvas.clearSelection?.();
          } else {
            // #621 根据 sourceType/sourcePanelType 设置 sourceElementType，用于菜单按钮可见性
            const sourcePanelType = (draftLineRef.current as any)?.sourcePanelType;
            let sourceElementType: 'image' | 'video' | 'panel' = 'image';
            if (sourceType === 'video') {
              sourceElementType = 'video';
            } else if (sourceType === 'panel' && sourcePanelType === 'video') {
              sourceElementType = 'video'; // 视频面板空放也只显示文本按钮
            } else if (sourceType === 'panel') {
              sourceElementType = 'panel';
            }
            setGenerateMenu({ visible: true, x: screenX, y: screenY, canvasX, canvasY, sourceId, sourceElementType });
          }
          
          // ⚠️ 保留线条！只停止 active 状态，不清除 SVG
          draftLineRef.current.active = false;
        // #60fps Phase1: 纯 ref + DOM 操作，不触发 React 渲染
        isConnectionActiveGlobalRef.current = false;  // #382 同步 ref
        resetConnectionVisualState();
        }
      }
      
      return; // 👑 直接退出，不执行后续逻辑
    }
    
    // 裁剪框拖拽结束
    if (isCropping && cropHandle) {

      setCropHandle(null);
      return;
    }

    // 空格拖拽结束
    if (isPanning) {
      setIsPanning(false);
      // #042 性能优化：松开鼠标时才更新 state，触发一次重渲染
      setPan(panRef.current);
      return;
    }

    // 画笔绘制结束
    if (isDrawing && drawPath.length > 1) {
      const minX = Math.min(...drawPath.map(p => p.x));
      const minY = Math.min(...drawPath.map(p => p.y));
      const maxX = Math.max(...drawPath.map(p => p.x));
      const maxY = Math.max(...drawPath.map(p => p.y));
      
      const width = maxX - minX || 1;
      const height = maxY - minY || 1;
      
      canvas.addElement({
        type: 'path',
        name: 'Path',
        x: minX,
        y: minY,
        width,
        height,
        originalWidth: width,
        originalHeight: height,
        rotation: 0,
        fill: 'transparent',
        stroke: penColor,
        strokeWidth: penSize,
        opacity: 1,
        visible: true,
        locked: false,
        path: drawPath.map(p => ({ x: p.x - minX, y: p.y - minY })),
      } as any);
      // 画笔绘制后不自动选中，清除选中状态
      canvas.clearSelection();
      setIsDrawing(false);
      setDrawPath([]);
      return;
    }

    // 框选结束 - 由全局事件监听处理

    setIsDragging(false);
    setDragElement(null);
    setAlignLines({ horizontal: [], vertical: [] }); // 拖动结束，清除对齐线（由全局事件监听处理）
    
    // 形状绘制
    if (shapeStart && (canvas.state.tool === 'rectangle' || canvas.state.tool.startsWith('shape-'))) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        // 转换为画布坐标
        const canvasX = (x - pan.x) / zoom;
        const canvasY = (y - pan.y) / zoom;
        const width = Math.abs(canvasX - shapeStart.x);
        const height = Math.abs(canvasY - shapeStart.y);
        const startX = Math.min(canvasX, shapeStart.x);
        const startY = Math.min(canvasY, shapeStart.y);
        
        if (width > 10 || height > 10) {
          const tool = canvas.state.tool;
          const defaultFill = '#9ca3af'; // 灰色
          const defaultStroke = '#6b7280'; // 深灰色边框
          
          // 实心方形
          if (tool === 'rectangle' || tool === 'shape-rectangle') {
            canvas.addElement({ 
              type: 'rectangle', name: 'Rectangle', x: startX, y: startY, width, height, 
              rotation: 0, fill: defaultFill, stroke: 'transparent', strokeWidth: 0, 
              opacity: 1, visible: true, locked: false 
            });
          }
          // 实心圆形
          else if (tool === 'shape-circle') {
            canvas.addElement({ 
              type: 'ellipse', name: 'Circle', x: startX, y: startY, width, height, 
              rotation: 0, fill: defaultFill, stroke: 'transparent', strokeWidth: 0, 
              opacity: 1, visible: true, locked: false 
            } as any);
          }
          // 实心三角形
          else if (tool === 'shape-triangle') {
            const path = `M ${width/2} 0 L ${width} ${height} L 0 ${height} Z`;
            canvas.addElement({ 
              type: 'path', name: 'Triangle', x: startX, y: startY, width, height, 
              rotation: 0, fill: defaultFill, stroke: 'transparent', strokeWidth: 0, 
              opacity: 1, visible: true, locked: false, 
              path: [{ x: width/2, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
              pathD: path
            } as any);
          }
          // 实心五角星
          else if (tool === 'shape-star') {
            const cx = width / 2, cy = height / 2;
            const outerR = Math.min(width, height) / 2;
            const innerR = outerR * 0.38;
            const points: {x: number, y: number}[] = [];
            for (let i = 0; i < 10; i++) {
              const r = i % 2 === 0 ? outerR : innerR;
              const angle = (Math.PI / 2) + (i * Math.PI / 5);
              points.push({ x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) });
            }
            canvas.addElement({ 
              type: 'path', name: 'Star', x: startX, y: startY, width, height, 
              rotation: 0, fill: defaultFill, stroke: 'transparent', strokeWidth: 0, 
              opacity: 1, visible: true, locked: false, 
              path: points
            } as any);
          }
          // 对话气泡 - 圆滑形状，有描边无填充
          else if (tool === 'shape-bubble') {
            // 使用pathD属性存储SVG path命令，实现圆滑气泡
            const bubbleW = width * 0.75;
            const bubbleH = height * 0.7;
            const tailW = width * 0.15;
            const tailH = height * 0.25;
            const radius = Math.min(width, height) * 0.1; // 圆角半径
            
            // 圆滑气泡的SVG path命令（尾巴在右下角）
            const pathD = `
              M ${radius} 0
              L ${bubbleW - radius} 0
              Q ${bubbleW} 0 ${bubbleW} ${radius}
              L ${bubbleW} ${bubbleH - radius}
              Q ${bubbleW} ${bubbleH} ${bubbleW - radius} ${bubbleH}
              L ${bubbleW - tailW * 0.5} ${bubbleH}
              L ${bubbleW + tailW * 0.5} ${height}
              L ${bubbleW - tailW * 1.5} ${bubbleH}
              L ${radius} ${bubbleH}
              Q 0 ${bubbleH} 0 ${bubbleH - radius}
              L 0 ${radius}
              Q 0 0 ${radius} 0
              Z
            `.replace(/\s+/g, ' ').trim();
            
            canvas.addElement({ 
              type: 'path', name: 'Bubble', x: startX, y: startY, width, height, 
              rotation: 0, fill: 'transparent', stroke: defaultStroke, strokeWidth: 2, 
              opacity: 1, visible: true, locked: false, 
              pathD: pathD,
              bubbleTailDirection: 'right' // 默认尾巴在右边
            } as any);
          }
          // 左向箭头 - 有描边无填充
          else if (tool === 'shape-arrow-left') {
            const points = [
              { x: width, y: height * 0.3 },
              { x: width * 0.4, y: height * 0.3 },
              { x: width * 0.4, y: 0 },
              { x: 0, y: height * 0.5 },
              { x: width * 0.4, y: height },
              { x: width * 0.4, y: height * 0.7 },
              { x: width, y: height * 0.7 },
            ];
            canvas.addElement({ 
              type: 'path', name: 'Arrow Left', x: startX, y: startY, width, height, 
              rotation: 0, fill: 'transparent', stroke: defaultStroke, strokeWidth: 2, 
              opacity: 1, visible: true, locked: false, 
              path: points
            } as any);
          }
          // 右向箭头 - 有描边无填充
          else if (tool === 'shape-arrow-right') {
            const points = [
              { x: 0, y: height * 0.3 },
              { x: width * 0.6, y: height * 0.3 },
              { x: width * 0.6, y: 0 },
              { x: width, y: height * 0.5 },
              { x: width * 0.6, y: height },
              { x: width * 0.6, y: height * 0.7 },
              { x: 0, y: height * 0.7 },
            ];
            canvas.addElement({ 
              type: 'path', name: 'Arrow Right', x: startX, y: startY, width, height, 
              rotation: 0, fill: 'transparent', stroke: defaultStroke, strokeWidth: 2, 
              opacity: 1, visible: true, locked: false, 
              path: points
            } as any);
          }
        }
        setShapeStart(null);
        setShapePreview(null);
        canvas.setTool('select');
        setActiveTool('select');
      }
    }
  }, [canvas, shapeStart, isDrawing, drawPath, penColor, penSize, zoom, pan, isPanning, setActiveTool]);

  // 鼠标离开
  const handleMouseLeave = useCallback(() => {
    // 👑 军师方案：只清除 ref，不触发全局重绘
    // 加号按钮由图片元素的 onMouseLeave 自己处理
    if (hoveredElementIdRef.current !== null) {
      hoveredElementIdRef.current = null;
      // ❌ 删除：forceUpdateForHover(n => n + 1);  // 这是导致图片模糊的罪魁祸首
      
      // 👑 军师方案：直接隐藏多选加号
      const multiSelectPlusBtn = document.getElementById('magnet-btn-multi-select');
      if (multiSelectPlusBtn) {
        const parentEl = multiSelectPlusBtn.parentElement as HTMLElement;
        if (parentEl) {
          parentEl.style.opacity = '0';
        }
      }
    }
    
    // 如果正在拖动元素或框选，不要中断操作
    // 因为鼠标可能快速移动导致短暂离开容器边界
    if (isDragging || isSelecting) {
      return;
    }
    setIsSelecting(false);
    setSelectionRect(null);
    if (isDrawing) {
      setIsDragging(false);
      setDragElement(null);
      setIsDrawing(false);
      setDrawPath([]);
    }
  }, [isDrawing, isDragging, isSelecting]);

  // 画笔工具关闭时隐藏调色板
  useEffect(() => {
    if (canvas.state.tool !== 'pen') {
      setShowColorPicker(false);
    }
  }, [canvas.state.tool]);

  // ====== 👑 军师绝对隔离舱：为 MemoizedCanvasImage 提供稳定回调 ======
  // 这些回调虽然用 useCallback 包裹，但 memo 比较函数会忽略回调引用变化
  // 所以即使依赖项变化导致回调重建，图片组件也不会重渲染

  const memoizedOnContextMenu = useCallback((e: React.MouseEvent, elId: string) => {
    handleContextMenu(e, elId);
  }, []); // handleContextMenu 是闭包内的普通函数，依赖不变

  const memoizedOnMouseEnter = useCallback((elId: string) => {
    const plusBtn = document.querySelector(`[data-plus-btn="${elId}"]`) as HTMLElement;
    if (plusBtn) {
      plusBtn.style.opacity = '1';
      plusBtn.style.pointerEvents = 'auto';
    }
  }, []);

  const memoizedOnMouseLeave = useCallback((elId: string) => {
    const plusBtn = document.querySelector(`[data-plus-btn="${elId}"]`) as HTMLElement;
    if (plusBtn) {
      plusBtn.style.opacity = '0';
      plusBtn.style.pointerEvents = 'none';
    }
  }, []);

  const memoizedOnMouseDown = useCallback((e: React.MouseEvent, el: any) => {
    // 复用 page.tsx 中已有的 handleMouseDown 逻辑
    // 这里的 el 是 CanvasImageElement 类型
  }, []);

  const memoizedOnImageLoad = useCallback((el: any, dimensions?: { naturalWidth: number; naturalHeight: number }) => {
    // #755 安全网修复：当 auto 比例占位符出图后，元素尺寸未收缩到实际图片比例
    // 场景：updatePlaceholder 中 getImageDimensionsWithRetryCore 失败（CORS/URL过期等），
    // 导致元素保持 1:1 占位符尺寸，实际 3:4 图片在 1:1 元素中显示灰色填充
    if (!dimensions || !el?.id) return;
    
    const { naturalWidth, naturalHeight } = dimensions;
    if (naturalWidth <= 0 || naturalHeight <= 0) return;
    
    // 计算元素当前宽高比和图片实际宽高比
    const elAspect = el.width / el.height;
    const imgAspect = naturalWidth / naturalHeight;
    
    // 如果宽高比差异超过 1%，说明 updatePlaceholder 未正确调整尺寸
    if (Math.abs(elAspect - imgAspect) > 0.01) {
      // 按图片实际比例调整元素尺寸，保持元素面积不变
      let newWidth: number, newHeight: number;
      if (imgAspect > elAspect) {
        // 图片比元素更宽：以元素宽度为准，高度缩小
        newWidth = el.width;
        newHeight = newWidth / imgAspect;
      } else {
        // 图片比元素更高：以元素高度为准，宽度缩小
        newHeight = el.height;
        newWidth = newHeight * imgAspect;
      }
      
      // 居中偏移：保持元素中心点不变
      const centerX = el.x + el.width / 2;
      const centerY = el.y + el.height / 2;
      const newX = centerX - newWidth / 2;
      const newY = centerY - newHeight / 2;
      
      console.log(`[onImageLoad #755] 自动修复元素尺寸: ${el.width}x${el.height} → ${Math.round(newWidth)}x${Math.round(newHeight)}, 图片自然尺寸: ${naturalWidth}x${naturalHeight}`);
      
      canvas.updateElement(el.id, {
        width: newWidth,
        height: newHeight,
        x: newX,
        y: newY,
      });
    }
  }, [canvas]);

  // #861 修复：图片加载失败时触发愈合逻辑（原为空函数，导致失效图片永远不恢复）
  // #863 修复：适配双链路 displaySrc，当 providerUrl 失败时必须清除 providerUrl 才能降级到 imageUrl
  const memoizedOnImageError = useCallback((el: any) => {
    if (!el) return;
    const elementId = el.id;
    const imageKey = el.imageKey || el.videoKey;

    // 熔断检查：已彻底失败的元素不再重试
    if (failedImageIdsRef.current.has(elementId)) return;

    // #863 修复：检查当前渲染使用的 URL（可能是 providerUrl 而非 imageUrl）
    const currentImageUrl = el.imageUrl || el.providerUrl || '';
    const isInvalidUrl = currentImageUrl &&
      !currentImageUrl.startsWith('http://') &&
      !currentImageUrl.startsWith('https://') &&
      !currentImageUrl.startsWith('/api/') &&
      !currentImageUrl.startsWith('data:') &&
      !currentImageUrl.startsWith('blob:');

    if (imageKey) {
      // 有 imageKey/videoKey：通过代理 URL 恢复
      const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(imageKey)}`;
      // 如果当前已经是代理 URL 且失败了，走熔断逻辑
      if (currentImageUrl.startsWith('/api/canvas/image')) {
        const currentRetries = imgRetryCountRef.current[imageKey] || 0;
        if (currentRetries >= 3) {
          failedImageIdsRef.current.add(elementId);
          canvas.updateElement(elementId, { generationStatus: 'expired', generationError: '图片加载失败' });
          return;
        }
        imgRetryCountRef.current[imageKey] = currentRetries + 1;
        // 重试代理 URL（清除 providerUrl 防止 displaySrc 仍使用 providerUrl）
        canvas.updateElement(elementId, { imageUrl: proxyUrl, providerUrl: undefined });
      } else {
        // 服务商 URL 或失效链接失败 → 降级到代理 URL（清除 providerUrl 确保 displaySrc 使用代理 URL）
        canvas.updateElement(elementId, { imageUrl: proxyUrl, providerUrl: undefined });
      }
    } else if (isInvalidUrl) {
      // 无 imageKey 但 imageUrl 是失效链接 → 标记为过期，静默处理
      canvas.updateElement(elementId, {
        imageUrl: undefined,
        providerUrl: undefined,
        generationStatus: 'expired',
        generationError: '图片链接已失效'
      });
    }
    // 有效 URL 失败：交给 handleCanvasImageError 处理降级链
    else if (currentImageUrl && !isInvalidUrl) {
      handleCanvasImageError(elementId, imageKey);
    }
  }, [canvas]);

  const memoizedOnCropHandleMouseDown = useCallback((e: React.MouseEvent, cropRect: { x: number; y: number; width: number; height: number }, handle: string) => {
    cropDragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      rectX: cropRect.x,
      rectY: cropRect.y,
      rectW: cropRect.width,
      rectH: cropRect.height,
      handle,
    };
    setCropHandle(handle);
  }, []);

  const memoizedOnPlusPointerDown = useCallback((e: React.PointerEvent, el: any) => {
    e.stopPropagation();
    
    // 平移模式下禁止拉线
    if (activeToolRef.current === 'hand') return;
    
    // 纯 Ref 物理清理
    if (draftLineRef.current.active) {
      draftLineRef.current = { active: false, sourceId: null, sourceType: null, startX: 0, startY: 0, snapTargetId: null, snapPortX: 0, snapPortY: 0 };
      // #610 Canvas 清除替代 SVG
      clearInteractionCanvas();
    }
    
    // #613 修复飞线：pointerDown 时必须同步设置 startX/startY！
    // 之前只设 active/sourceId/sourceType 但不设 startX/startY，
    // 导致全局 handleMouseMove 读取旧值画线 → 首帧飞线
    const startX = el.x + el.width;
    const startY = el.y + el.height / 2;
    // #621 动态检测源类型：图片为 'image'，视频为 'video'
    const resolvedSourceType = el.type === 'video' ? 'video' : 'image';
    isConnectionActiveGlobalRef.current = true;
    draftLineRef.current = {
      active: true,
      sourceId: el.id,
      sourceType: resolvedSourceType,
      startX,
      startY,
      snapTargetId: null,
      snapPortX: 0,
      snapPortY: 0,
    };
    
    startTransition(() => {
      if (generateMenu.visible) setGenerateMenu(prev => ({ ...prev, visible: false }));
      if (activeInputNodeId) setActiveInputNodeId(null);
      if (canvas.state.selectedIds.length > 0) canvas.clearSelection?.();
    });
    
    // 👑 #612 坐标归一化修复：使用容器内坐标（与 pan 同一坐标系）
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    connectionDragStartRef.current = { x, y, sourceId: el.id, sourceType: resolvedSourceType, startX, startY };
    connectionDragTriggeredRef.current = false;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const memoizedOnPlusPointerMove = useCallback((e: React.PointerEvent, el: any) => {
    if (!connectionDragStartRef.current) return;
    
    // 👑 #612 坐标归一化修复：使用容器内坐标
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - connectionDragStartRef.current.x;
    const dy = y - connectionDragStartRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > 5 && !connectionDragTriggeredRef.current) {
      connectionDragTriggeredRef.current = true;
      const { sourceId, sourceType, startX, startY } = connectionDragStartRef.current;
      
      setGenerateMenu(prev => prev.visible ? { ...prev, visible: false } : prev);
      // #610 Canvas 清除替代 SVG
      clearInteractionCanvas();
      setActiveInputNodeId(null);
      
      draftLineRef.current = { active: true, startX, startY, sourceId, sourceType, snapTargetId: null, snapPortX: 0, snapPortY: 0 };
      // #60fps Phase1: 纯 ref + DOM 操作，不触发 React 渲染
      updateCanvasVisualState({ isDragging: true, draftSourceId: sourceId });
      
      // #610 Canvas 层无需 display 切换（fixed 始终存在）
    }
    
    if (connectionDragTriggeredRef.current && draftLineRef.current.active) {
      const { startX, startY } = connectionDragStartRef.current;
      // #614 使用 ref 读取最新 pan/zoom，避免 React.memo 阻断更新导致闭包过期
      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;
      // 👑 #612 容器内坐标转画布坐标
      const endCanvasX = (x - currentPan.x) / currentZoom;
      const endCanvasY = (y - currentPan.y) / currentZoom;
      
      // #610 终结手术：Canvas 替代 SVG 绘制
      // #612 Canvas fixed 需要视口坐标 = 容器内坐标 + rect.left/top
      const startScreenX = startX * currentZoom + currentPan.x + rect.left;
      const startScreenY = startY * currentZoom + currentPan.y + rect.top;
      const endScreenX = endCanvasX * currentZoom + currentPan.x + rect.left;
      const endScreenY = endCanvasY * currentZoom + currentPan.y + rect.top;
      drawDraftLine(
        startScreenX, startScreenY,
        endScreenX, endScreenY,
        startX, startY,
        endCanvasX, endCanvasY,
        currentZoom, currentPan.x + rect.left, currentPan.y + rect.top
      );
    }
  }, [pan, zoom]);

  const memoizedOnPlusPointerUp = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    // #841→#850 修复：不再在此处清除 draftLineRef！
    // #841 的原始修复直接清除 draftLineRef，导致 handleMouseUp 中 draftLineRef.current.active 为 false，
    // 空放弹窗逻辑被跳过（画布拉线后无法弹出菜单）。
    // 正确做法：只清除 pointerCapture，让 handleMouseUp 来处理弹窗/磁吸逻辑。
    // 如果确实没有触发拖拽（长按松开），才清除 ref 防止幽灵线条。
    if (!connectionDragTriggeredRef.current && draftLineRef.current.active) {
      draftLineRef.current = { active: false, sourceId: null, sourceType: null, startX: 0, startY: 0, snapTargetId: null, snapPortX: 0, snapPortY: 0 };
      clearInteractionCanvas();
      // #60fps Phase1: 纯 ref + DOM 操作
      isConnectionActiveGlobalRef.current = false;
      resetConnectionVisualState();
    }
    connectionDragStartRef.current = null;
    connectionDragTriggeredRef.current = false;
  }, []);

  const memoizedOnPlusPointerCancel = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    // #841→#850 修复：与 onPlusPointerUp 同理，只在未触发拖拽时清除 ref
    if (!connectionDragTriggeredRef.current && draftLineRef.current.active) {
      draftLineRef.current = { active: false, sourceId: null, sourceType: null, startX: 0, startY: 0, snapTargetId: null, snapPortX: 0, snapPortY: 0 };
      clearInteractionCanvas();
      // #60fps Phase1: 纯 ref + DOM 操作
      isConnectionActiveGlobalRef.current = false;
      resetConnectionVisualState();
    }
    connectionDragStartRef.current = null;
    connectionDragTriggeredRef.current = false;
  }, []);

  const renderElement = (el: CanvasElement, index: number): React.ReactNode => {
    // #591 终极修复：不可见元素返回占位 div，而不是 null
    // 这样可以保持 DOM 结构稳定，避免 insertBefore 找错参照物
    // 占位 div 宽高为 0，不占用空间，但存在于 DOM 树中
    if (!el.visible) {
      return (
        <div
          key={el.id}
          data-element-id={el.id}
          data-invisible-placeholder="true"
          style={{
            position: 'absolute',
            left: el.x,
            top: el.y,
            width: 0,
            height: 0,
            visibility: 'hidden',
            pointerEvents: 'none',
          }}
        />
      );
    }
    const isSelected = canvas.state.selectedIds.includes(el.id);
    const isPanelType = el.type === 'generate-panel' || el.type === 'imageGenerator' || el.type === 'videoGenerator';
    
    // #600/#608 物理置顶：优先使用元素的 zIndex 属性，没有则按数组顺序
    // #608 改造：BRING_TO_FRONT_AND_SELECT 不再重排数组，只改 zIndex
    const zIndex = el.zIndex || (index + 1);
    
    // 画笔模式下不设置光标，继承容器设置的画笔光标；否则使用 grab
    const cursorClass = canvas.state.tool === 'pen' ? '' : 'cursor-grab active:cursor-grabbing';

    // 路径/形状（包括画笔路径和各种形状）
    if (el.type === 'path') {
      // 线宽需要除以缩放比例，保持固定视觉宽度
      const visualStrokeWidth = (el.strokeWidth || 3) / zoom;
      const isFilled = el.fill && el.fill !== 'transparent';
      
      // 获取path数据 - 根据形状类型动态生成
      let pathData = '';
      
      // 三角形 - 动态根据当前尺寸计算
      if (el.name === 'Triangle') {
        pathData = `M ${el.width/2} 0 L ${el.width} ${el.height} L 0 ${el.height} Z`;
      }
      // 五角星 - 动态根据当前尺寸计算
      else if (el.name === 'Star') {
        const cx = el.width / 2, cy = el.height / 2;
        const outerR = Math.min(el.width, el.height) / 2;
        const innerR = outerR * 0.38;
        const points: {x: number, y: number}[] = [];
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? outerR : innerR;
          const angle = (Math.PI / 2) + (i * Math.PI / 5);
          points.push({ x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) });
        }
        pathData = points.reduce((acc, p, i) => acc + (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`), '') + ' Z';
      }
      // 气泡 - 动态生成圆滑path
      else if (el.name === 'Bubble') {
        const bubbleW = el.width * 0.75;
        const bubbleH = el.height * 0.7;
        const tailW = el.width * 0.15;
        const radius = Math.min(el.width, el.height) * 0.1;
        
        if (el.bubbleTailDirection === 'left') {
          // 尾巴在左边
          pathData = `
            M ${el.width - radius} 0
            L ${el.width} 0
            Q ${el.width + radius} 0 ${el.width + radius} ${radius}
            L ${el.width + radius} ${bubbleH - radius}
            Q ${el.width + radius} ${bubbleH} ${el.width} ${bubbleH}
            L ${tailW * 1.5} ${bubbleH}
            L ${tailW * 0.5} ${el.height}
            L 0 ${bubbleH}
            L ${el.width - bubbleW + tailW} ${bubbleH}
            Q ${el.width - bubbleW} ${bubbleH} ${el.width - bubbleW} ${bubbleH - radius}
            L ${el.width - bubbleW} ${radius}
            Q ${el.width - bubbleW} 0 ${el.width - bubbleW + radius} 0
            Z
          `.replace(/\s+/g, ' ').trim();
        } else {
          // 尾巴在右边（默认）
          pathData = `
            M ${radius} 0
            L ${bubbleW - radius} 0
            Q ${bubbleW} 0 ${bubbleW} ${radius}
            L ${bubbleW} ${bubbleH - radius}
            Q ${bubbleW} ${bubbleH} ${bubbleW - radius} ${bubbleH}
            L ${bubbleW - tailW * 0.5} ${bubbleH}
            L ${bubbleW + tailW * 0.5} ${el.height}
            L ${bubbleW - tailW * 1.5} ${bubbleH}
            L ${radius} ${bubbleH}
            Q 0 ${bubbleH} 0 ${bubbleH - radius}
            L 0 ${radius}
            Q 0 0 ${radius} 0
            Z
          `.replace(/\s+/g, ' ').trim();
        }
      }
      // 其他自定义路径 - 使用pathD或path点数组
      else {
        pathData = el.pathD || '';
        if (!pathData && el.path) {
          // 对于画笔路径，需要根据当前元素尺寸进行缩放
          // 路径点是相对于原始尺寸的坐标，需要缩放到当前尺寸
          const originalWidth = el.originalWidth || el.width;
          const originalHeight = el.originalHeight || el.height;
          const scaleX = el.width / originalWidth;
          const scaleY = el.height / originalHeight;
          
          pathData = el.path.reduce((acc, p, i) => {
            const scaledX = p.x * scaleX;
            const scaledY = p.y * scaleY;
            return acc + (i === 0 ? `M${scaledX},${scaledY}` : `L${scaledX},${scaledY}`);
          }, '') || '';
        }
      }
      
      return (
        <div
          key={el.id}
          style={{ position: 'absolute', left: el.x, top: el.y, width: el.width, height: el.height, zIndex, userSelect: 'none' }}
          className={`select-none ${cursorClass}`}
          onContextMenu={(e) => handleContextMenu(e, el.id)}
        >
          <svg
            style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible' }}
          >
            <path
              d={pathData || ''}
              fill={isFilled ? el.fill : 'none'}
              stroke={el.stroke}
              strokeWidth={visualStrokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      );
    }

    // 椭圆/圆形
    if (el.type === 'ellipse') {
      const isFilled = el.fill && el.fill !== 'transparent';
      const visualStrokeWidth = (el.strokeWidth || 2) / zoom;
      
      return (
        <div
          key={el.id}
          style={{ position: 'absolute', left: el.x, top: el.y, width: el.width, height: el.height, zIndex, userSelect: 'none' }}
          className={`select-none ${cursorClass}`}
          onContextMenu={(e) => handleContextMenu(e, el.id)}
        >
          <svg
            style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible' }}
          >
            <ellipse
              cx={el.width / 2}
              cy={el.height / 2}
              rx={el.width / 2 - visualStrokeWidth / 2}
              ry={el.height / 2 - visualStrokeWidth / 2}
              fill={isFilled ? el.fill : 'transparent'}
              stroke={el.stroke}
              strokeWidth={visualStrokeWidth}
            />
          </svg>
        </div>
      );
    }

    // 图像生成器 - 选中时才显示上下内容，从中心点缩放
    if (el.type === 'imageGenerator') {
      const canvasSize = el.width;
      
      return (
        <div 
          key={el.id} 
          style={{ 
            position: 'absolute', 
            left: el.x, 
            top: el.y, 
            width: canvasSize,
            zIndex: zIndex,
            userSelect: 'none'
          }}
          className="group select-none"
        >
          {/* 上方标签 - 仅选中时显示，紧贴画布顶部 */}
          {isSelected && (
            <div style={{ 
              position: 'absolute', 
              top: -28, 
              left: 0, 
              right: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              pointerEvents: 'none'
            }}>
              <div style={{ 
                maxWidth: '66%',
                backgroundColor: '#F0F0F0', 
                borderRadius: 4,
                padding: '2px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                overflow: 'hidden',
                flexShrink: 1
              }}>
                {icons.image}
                <span style={{ 
                  fontSize: 11, 
                  color: '#333',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flexShrink: 1
                }}>图像生成器</span>
              </div>
              <span style={{ 
                fontSize: 11, 
                color: '#666', 
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}>
                {Math.round(canvasSize)} × {Math.round(canvasSize)}
              </span>
            </div>
          )}
          
          {/* 画布区域 */}
          <div 
            style={{ 
              width: canvasSize, 
              height: canvasSize,
              backgroundColor: '#E8F4FD',
              border: isSelected ? '2px solid #40A9FF' : '1px solid #D0E8F8',
              borderRadius: 8,
              position: 'relative'
            }}
            className={cursorClass}
            onContextMenu={(e) => handleContextMenu(e, el.id)}
          >
            {/* 中间占位图标 */}
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
              <svg width={canvasSize / 5} height={canvasSize / 5} viewBox="0 0 64 64" fill="none">
                <rect x="8" y="8" width="48" height="48" rx="4" stroke="#A0D0F0" strokeWidth="2"/>
                <circle cx="20" cy="20" r="4" fill="#A0D0F0"/>
                <path d="M8 44L24 28L36 40L52 24L56 28V52H8V44Z" fill="#A0D0F0"/>
              </svg>
            </div>
          </div>
          
          {/* 下方操作卡片 - 始终显示 */}
          <ImageGeneratorPanel canvasSize={canvasSize} />
        </div>
      );
    }

    // 视频生成器
    if (el.type === 'videoGenerator') {
      return (
        <div 
          key={el.id} 
          style={{ position: 'absolute', left: el.x, top: el.y, width: el.width, zIndex, userSelect: 'none' }}
          className="group select-none"
        >
          <div 
            style={{ 
              width: el.width, 
              height: el.width * 0.5625,
              backgroundColor: '#E8FFF0',
              border: isSelected ? '2px dashed #52C41A' : '2px dashed transparent',
              position: 'relative'
            }}
            className={cursorClass}
            onContextMenu={(e) => handleContextMenu(e, el.id)}
          >
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <rect x="4" y="12" width="56" height="40" rx="4" stroke="#B8FFD4" strokeWidth="2"/>
                <path d="M26 24V40L42 32L26 24Z" fill="#B8FFD4"/>
              </svg>
            </div>
          </div>
        </div>
      );
    }

    // 普通图片 - 👑 军师绝对隔离舱：用 MemoizedCanvasImage 彻底隔离！
    if (el.type === 'image') {
      return (
        <MemoizedCanvasImage
          key={el.id}
          el={{
            id: el.id,
            type: 'image',
            name: el.name,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            imageUrl: el.imageUrl,
            imageKey: el.imageKey,
            opacity: el.opacity,
            generationStatus: el.generationStatus,
            generationError: el.generationError,
            isLoading: el.isLoading,
            sourceIds: (el as any).sourceIds,
            sourceType: el.sourceType,  // #632 视频占位符支持
            videoUrl: (el as any).videoUrl,  // 视频URL
            videoKey: (el as any).videoKey,  // 视频Key
            thumbnailUrl: (el as any).thumbnailUrl,  // 缩略图URL
            thumbnailKey: (el as any).thumbnailKey,  // 缩略图Key
          }}
          isSelected={isSelected}
          zIndex={zIndex}
          theme={theme as 'light' | 'dark'}
          roseGradientBg={true}
          isCropping={isCropping}
          cropImageId={cropImageId}
          cropRect={isCropping && cropImageId === el.id ? cropRect : null}
          onCropHandleMouseDown={memoizedOnCropHandleMouseDown}
          isInMultiSelect={canvas.state.selectedIds.includes(el.id) && canvas.state.selectedIds.length > 1}
          onMouseEnter={memoizedOnMouseEnter}
          onMouseLeave={memoizedOnMouseLeave}
          onContextMenu={memoizedOnContextMenu}
          onPlusPointerDown={memoizedOnPlusPointerDown}
          onPlusPointerMove={memoizedOnPlusPointerMove}
          onPlusPointerUp={memoizedOnPlusPointerUp}
          onPlusPointerCancel={memoizedOnPlusPointerCancel}
          onImageLoad={memoizedOnImageLoad}
          onImageError={memoizedOnImageError}
        />
      );
    }

    // #365 交互式图片栈节点
    if (el.type === 'image-stack') {
      // 连线回调：输入端口接收到连线
      const handleImageStackInputPortPointerUp = (nodeId: string) => {
        if (draftLineRef.current.active && draftLineRef.current.sourceId) {
          const newSourceId = draftLineRef.current.sourceId;
          const targetEl = canvas.state.elements.find(e => e.id === nodeId);
          const currentSourceIds = targetEl?.sourceIds || [];
          
          if (!currentSourceIds.includes(newSourceId)) {
            const newSourceIds = [...currentSourceIds, newSourceId];
            canvas.updateElement?.(nodeId, { sourceIds: newSourceIds });
          }
          
          // 重置连线状态
          draftLineRef.current = {
            active: false,
            startX: 0,
            startY: 0,
            sourceId: null,
            sourceType: null,
            snapTargetId: null,
            snapPortX: 0,
            snapPortY: 0,
          };
          
          // #60fps Phase1: 纯 ref + DOM 操作
          isConnectionActiveGlobalRef.current = false;
          resetConnectionVisualState();
          // #610 Canvas 清除替代 SVG display:none
          clearInteractionCanvas();
        }
      };
      
      // 连线回调：输出端口启动连线
      const handleImageStackOutputPortPointerDown = (nodeId: string, startX: number, startY: number) => {
        // 平移模式下禁止拉线
        if (activeToolRef.current === 'hand') return;
        
        // #368 清理旧状态（修复二次拉线残留）
        setGenerateMenu(prev => prev.visible ? { ...prev, visible: false } : prev);
        // #610 Canvas 清除替代 SVG
        clearInteractionCanvas();
        
        // #372 拉线时取消选中面板状态
        setActiveInputNodeId(null);
        
        // #60fps Phase1: 清除磁吸高亮状态，纯 DOM 操作
        updateCanvasVisualState({ snapTargetId: null });
        
        // #425 补齐：面板加号点击时也清除画布选择（与图片一致）
        if (canvas.state.selectedIds.length > 0) {
          canvas.clearSelection?.();
        }
        
        draftLineRef.current = {
          active: true,
          startX,
          startY,
          sourceId: nodeId,
          sourceType: 'image-stack',  // 标记为图片栈类型
          snapTargetId: null,
          snapPortX: 0,
          snapPortY: 0,
        };
        // #60fps Phase1: 纯 ref + DOM 操作，不触发 React 渲染
        updateCanvasVisualState({ isDragging: true, draftSourceId: nodeId });
        
        // #610 Canvas 层无需 display 切换（fixed 始终存在）
      };
      
      return (
        <div key={el.id} data-element-id={el.id} data-source-ids={(el.sourceIds || []).join(',')} style={{ position: 'absolute', left: 0, top: 0, zIndex }}>
        <InteractiveImageStackNode
          id={el.id}
          data={{
            imageUrls: el.imageUrls || [],
            imageKeys: el.imageKeys || [],
            providerUrls: el.providerUrls || [],  // #868 修复：传递 providerUrls 供双链路渲染
            activeIndex: el.activeIndex ?? 0,  // #868 修复：用 ?? 替代 ||，支持 activeIndex=0
            isStackExpanded: el.isStackExpanded || false,
            showBottomPanel: el.showBottomPanel || false,
            generationStatus: el.generationStatus as 'idle' | 'generating' | 'completed' | 'failed' | 'submitted' | 'recovering' | 'expired' | undefined,
            generationError: el.generationError ?? undefined,
            prompt: el.panelPrompt || el.sourcePrompt || '',
            name: el.name,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
          }}
          selected={canvas.state.selectedIds?.includes(el.id) || false}
          zoom={zoom}
          // #60fps Phase1: snapHighlightId/connectionDraftSourceId 改用 DOM class 控制
          // 不再作为 props 传入，避免连线时触发 memo 比对失败导致重渲染
          snapHighlightId={undefined}
          connectionDraftSourceId={undefined}
          sourceIds={el.sourceIds || []}  // #426 变灰逻辑
          isInMultiSelect={canvas.state.selectedIds?.includes(el.id) && (canvas.state.selectedIds?.length || 0) > 1}  // #594 多选时隐藏加号
          onUpdatePosition={(id: string, x: number, y: number) => {
            canvas.updateElement(id, { x, y });
          }}
          onUpdateSize={(id: string, width: number, height: number) => {
            canvas.updateElement(id, { width, height });
          }}
          onUpdateData={(id: string, data: any) => {
            // #858 修复：只传定义过的字段，防止 undefined 覆盖已有数据
            const updates: Record<string, any> = {};
            if (data.imageUrls !== undefined) updates.imageUrls = data.imageUrls;
            if (data.imageKeys !== undefined) updates.imageKeys = data.imageKeys;
            if (data.activeIndex !== undefined) updates.activeIndex = data.activeIndex;
            if (data.isStackExpanded !== undefined) updates.isStackExpanded = data.isStackExpanded;
            if (data.showBottomPanel !== undefined) updates.showBottomPanel = data.showBottomPanel;
            if (data.generationStatus !== undefined) updates.generationStatus = data.generationStatus;
            if (data.generationError !== undefined) updates.generationError = data.generationError;
            if (data.prompt !== undefined) updates.panelPrompt = data.prompt;
            if (data.name !== undefined) updates.name = data.name;
            // #868 修复：activeIndex 变化时也同步 imageUrl/imageKey（不仅限 imageUrls 变化时）
            // 解决：点击缩略图切换主图后，顶层 imageUrl/imageKey 仍指向旧图的幽灵主图问题
            if (updates.activeIndex !== undefined) {
              const idx = updates.activeIndex;
              // 优先从 updates.imageUrls 取（如果同时传了），否则从元素当前数据取
              const el = canvas.state.elements.find((e: any) => e.id === id);
              const currentImageUrls = updates.imageUrls || (el as any)?.imageUrls || [];
              const currentImageKeys = updates.imageKeys || (el as any)?.imageKeys || [];
              if (currentImageUrls[idx]) updates.imageUrl = currentImageUrls[idx];
              if (currentImageKeys[idx]) updates.imageKey = currentImageKeys[idx];
            } else if (updates.imageUrls !== undefined) {
              const idx = data.activeIndex ?? 0;
              updates.imageUrl = updates.imageUrls[idx];
              if (updates.imageKeys !== undefined) {
                updates.imageKey = updates.imageKeys[idx];
              }
            }
            canvas.updateElement(id, updates);
          }}
          onDelete={(id: string) => {
            canvas.deleteElement(id);
          }}
          onAddElement={(element: any) => {
            canvas.addElement(element);
          }}
          onInputPortPointerUp={handleImageStackInputPortPointerUp}
          onOutputPortPointerDown={handleImageStackOutputPortPointerDown}
          onCancelConnection={() => {
            // #60fps Phase1: 纯 ref + DOM 操作
            // 清理连线状态
            draftLineRef.current = { active: false, sourceId: null, sourceType: null, startX: 0, startY: 0, snapTargetId: null, snapPortX: 0, snapPortY: 0 };
            isConnectionActiveGlobalRef.current = false;
            resetConnectionVisualState();
            // #610 Canvas 清除替代 SVG display:none
            clearInteractionCanvas();
          }}
        />
        </div>
      );
    }

    // 视频元素 - 上传的视频文件
    // #615 架构修复：使用 CanvasVideo 组件，带状态管理
    // #621 视频添加加号按钮，支持画线连接
    if (el.type === 'video') {
      const isVideoSelected = canvas.state.selectedIds?.includes(el.id);
      const videoSrc = el.videoUrl || (el.videoUrls && el.videoUrls[0]) || '';
      // #625 修复：检查视频是否失败（无有效 URL + generationStatus === 'failed'）
      // #690 关键修复：generating 状态不是失败！必须排除 generating，否则占位符被误判为失败
      const isVideoFailed = el.generationStatus === 'failed' || (!videoSrc && !el.isLoading && el.generationStatus !== 'generating');
      // #621 计算视频加号尺寸（与图片加号逻辑一致）
      const videoAvgSize = Math.min(el.width, el.height);
      const videoButtonSize = Math.max(20, Math.min(32, videoAvgSize * 0.05));
      // #60fps Phase1: 使用 ref 读取（不触发 React 渲染）
      const isVideoBeingSnapped = snapHighlightIdRef.current === el.id;
      const isVideoAlreadyConnected = Boolean(connectionDraftSourceIdRef.current && connectionDraftSourceIdRef.current === el.id);
      // #621 多选时隐藏单个视频的加号
      const hideVideoPlus = canvas.state.selectedIds?.length > 1;
      
      // #625 修复：视频失败时显示失败占位符，不渲染空 src 的 video 标签
      if (isVideoFailed) {
        return (
          <div
            key={el.id}
            style={{
              position: 'absolute',
              left: el.x,
              top: el.y,
              width: el.width,
              height: el.height,
              zIndex,
              borderRadius: '3%',
              background: 'rgba(139,0,0,0.3)',
              border: isVideoSelected ? '2px solid #3b82f6' : '1px solid rgba(139,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              canvas.selectElement(el.id, e.shiftKey);
            }}
            onDoubleClick={() => {
              // 双击可重新上传
              if (fileInputRef.current) {
                fileInputRef.current.click();
              }
            }}
          >
            <svg width="150" height="150" viewBox="0 0 24 24" fill="#ff6b6b">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            <span style={{ color: '#ff6b6b', fontSize: 60, marginTop: 8, fontWeight: 500 }}>
              生成失败
            </span>
            {el.generationError && (
              <span style={{ color: '#ff6b6b', fontSize: 60, marginTop: 4 }}>
                {translateErrorMessage(el.generationError)}
              </span>
            )}
          </div>
        );
      }
      
      return (
        <CanvasVideo
          key={el.id}
          elementId={el.id}
          videoSrc={videoSrc}
          // #723 修复：posterSrc 只能是图片URL，不能是视频URL
          // 如果 thumbnailUrl 不存在，imageUrl 是视频URL，则不设置 posterSrc（CanvasVideo 会显示默认占位符）
          posterSrc={el.thumbnailUrl || (el.imageUrl && !/\.(mp4|webm|mov|avi)(\?|$)/i.test(el.imageUrl) ? el.imageUrl : undefined)}
          width={el.width}
          height={el.height}
          zoom={canvas.state.zoom}
          isSelected={isVideoSelected}
          zIndex={zIndex}
          isLoading={el.isLoading}  // #619 COS 上传中虚化加载状态
          generationStatus={el.generationStatus as 'generating' | 'completed' | 'failed' | undefined}  // #7xx 视频生成状态（占位符）
          generationProgress={el.generationProgress || 0}  // #7xx 视频生成进度（0-100）
          generationError={el.generationError}  // #7xx 视频生成失败原因
          isInMultiSelect={canvas.state.selectedIds?.includes(el.id) && (canvas.state.selectedIds?.length || 0) > 1}  // #621 多选时隐藏加号
          plusButtonSize={hideVideoPlus ? 0 : videoButtonSize}
          isBeingSnapped={isVideoBeingSnapped}
          isAlreadyConnected={isVideoAlreadyConnected}
          sourceIds={el.sourceIds || []}
          style={{
            left: el.x,
            top: el.y,
          }}
          onSelect={(e, shiftKey) => {
            e.stopPropagation();
            canvas.selectElement(el.id, shiftKey);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            // #620 修复：使用 stateRef 获取最新 selectedIds，解决闭包陷阱
            const liveSelectedIds = canvas.stateRef?.current?.selectedIds || canvas.state.selectedIds;
            const isMultiSelectActive = liveSelectedIds.length > 1;
            const isElSelected = liveSelectedIds.includes(el.id);
            if (isMultiSelectActive) {
              // 多选激活时，无论该元素是否被选中，都显示多选右键菜单
              setContextMenu({ x: e.clientX, y: e.clientY, elementId: isElSelected ? el.id : undefined, isMultiSelect: true });
            } else {
              canvas.selectElement(el.id, false);
              forceBringToFront(el.id);
              setContextMenu({ x: e.clientX, y: e.clientY, elementId: el.id });
            }
          }}
          onDragStart={(e) => {
            forceBringToFront(el.id);
            setDragElement(el.id);
            setIsDragging(true);
            setDragStart({
              x: (e.clientX - (containerRef.current?.getBoundingClientRect().left || 0) - pan.x) / zoom,
              y: (e.clientY - (containerRef.current?.getBoundingClientRect().top || 0) - pan.y) / zoom,
              elX: el.x,
              elY: el.y,
            });
            (window as any).__groupStartPositions = null;
          }}
          onPlusPointerDown={memoizedOnPlusPointerDown}
          onPlusPointerMove={memoizedOnPlusPointerMove}
          onPlusPointerUp={memoizedOnPlusPointerUp}
          onPlusPointerCancel={() => {
            draftLineRef.current = { active: false, sourceId: null, sourceType: null, startX: 0, startY: 0, snapTargetId: null, snapPortX: 0, snapPortY: 0 };
            clearInteractionCanvas();
          }}
          el={el} // #622 传递完整元素对象（含 x/y 坐标），用于连线起点计算
          onVideoMouseEnter={(id) => {
            const plusBtn = document.querySelector(`[data-plus-btn="${id}"]`) as HTMLElement;
            if (plusBtn) {
              plusBtn.style.opacity = '1';
              plusBtn.style.pointerEvents = 'auto';
            }
          }}
          onVideoMouseLeave={(id) => {
            const plusBtn = document.querySelector(`[data-plus-btn="${id}"]`) as HTMLElement;
            if (plusBtn) {
              plusBtn.style.opacity = '0';
              plusBtn.style.pointerEvents = 'none';
            }
          }}
        />
      );
    }

    // #313 引用生成面板 - 完全组件化，使用 GeneratePanelNode
    // #365 性能优化：移除渲染循环中的图遍历，改为在 handleGenerateClick 时懒计算
    if (el.type === 'generate-panel') {
      const isPanelSelected = canvas.state.selectedIds?.includes(el.id);
      const isInputActive = activeInputNodeId === el.id;
      
      // 只传递 sourceIds，不在此处计算 sourceImageEls（性能优化）
      const sourceIds: string[] = el.sourceIds || [];
      
      // #60fps Phase1: 使用 ref 读取（不触发 React 渲染），计算 boolean 传给子组件
      // 这样拖拽期间子组件不会因为状态变化而重渲染
      const isBeingSnapped = snapHighlightIdRef.current === el.id;
      const isAlreadyConnected = Boolean(connectionDraftSourceIdRef.current && sourceIds.includes(connectionDraftSourceIdRef.current));
      
      // 端口连接回调：输入端口接收到连线
      const handleInputPortPointerUp = (panelId: string) => {
        if (draftLineRef.current.active && draftLineRef.current.sourceId) {
          const newSourceId = draftLineRef.current.sourceId;
          const targetEl = canvas.state.elements.find(e => e.id === panelId);
          const currentSourceIds = targetEl?.sourceIds || [];
          
          // 多选拖线连接时，将所有选中元素ID添加为源
          if (newSourceId === '__multi_select__') {
            const multiSelectIds = canvas.state.selectedIds.filter(id => {
              const el = canvas.state.elements.find(e2 => e2.id === id);
              return el && (el.type === 'image' || el.type === 'generate-panel' || el.type === 'image-stack');
            });
            const newSourceIds = [...currentSourceIds];
            multiSelectIds.forEach(id => {
              if (!newSourceIds.includes(id)) {
                newSourceIds.push(id);
              }
            });
            canvas.updateElement?.(panelId, { sourceIds: newSourceIds });
          } else {
            if (!currentSourceIds.includes(newSourceId)) {
              const newSourceIds = [...currentSourceIds, newSourceId];
              canvas.updateElement?.(panelId, { sourceIds: newSourceIds });
            }
          }
          
          // 重置连线状态
          draftLineRef.current = {
            active: false,
            startX: 0,
            startY: 0,
            sourceId: null,
            sourceType: null,
            snapTargetId: null,
            snapPortX: 0,
            snapPortY: 0,
          };
          
          // #60fps Phase1: 纯 ref + DOM 操作
          isConnectionActiveGlobalRef.current = false;
          resetConnectionVisualState();
          // #610 Canvas 清除替代 SVG display:none
          clearInteractionCanvas();
        }
      };
      
      // 端口连接回调：输出端口启动连线
      const handleOutputPortPointerDown = (panelId: string, startX: number, startY: number) => {
        // 平移模式下禁止拉线
        if (activeToolRef.current === 'hand') return;
        
        // #368 清理旧状态（修复二次拉线残留）
        setGenerateMenu(prev => prev.visible ? { ...prev, visible: false } : prev);
        // #610 Canvas 清除替代 SVG
        clearInteractionCanvas();
        
        // #372 拉线时取消选中面板状态
        setActiveInputNodeId(null);
        
        // #425 补齐：面板加号点击时也清除画布选择（与图片一致）
        if (canvas.state.selectedIds.length > 0) {
          canvas.clearSelection?.();
        }
        
        // #视频功能 补丁一：获取源面板的 panelType
        const sourcePanel = canvas.state.elements.find(e => e.id === panelId);
        const sourcePanelType = (sourcePanel as any)?.panelType || null;
        
        // #621 视频面板允许输出连线（仅文本菜单），不再禁止
        // if (sourcePanelType === 'video') return; // 已移除
        
        // #60fps Phase1: 清除磁吸高亮状态，纯 DOM 操作
        updateCanvasVisualState({ snapTargetId: null });
        
        draftLineRef.current = {
          active: true,
          startX,
          startY,
          sourceId: panelId,
          sourceType: 'panel',
          sourcePanelType,  // #视频功能 补丁一：记录源面板类型
          snapTargetId: null,
          snapPortX: 0,
          snapPortY: 0,
        };
        // #60fps Phase1: 纯 ref + DOM 操作，不触发 React 渲染
        updateCanvasVisualState({ isDragging: true, draftSourceId: panelId });
        
        // #610 Canvas 层无需 display 切换（fixed 始终存在）
      };
      
      // 移除参考图
      const handleRemoveSourceImage = (panelId: string, imageId: string) => {
        const targetEl = canvas.state.elements.find(e => e.id === panelId);
        const currentSourceIds = targetEl?.sourceIds || [];
        const newSourceIds = currentSourceIds.filter(id => id !== imageId);
        canvas.updateElement?.(panelId, { sourceIds: newSourceIds });
      };
      
      // #318 新增：参考图拖拽排序
      const handleReorderSourceImages = (panelId: string, fromIndex: number, toIndex: number) => {
        const targetEl = canvas.state.elements.find(e => e.id === panelId);
        const currentSourceIds = targetEl?.sourceIds || [];
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= currentSourceIds.length || toIndex >= currentSourceIds.length) {
          return;
        }
        
        // 交换位置
        const newSourceIds = [...currentSourceIds];
        const [removed] = newSourceIds.splice(fromIndex, 1);
        newSourceIds.splice(toIndex, 0, removed);
        
        canvas.updateElement?.(panelId, { sourceIds: newSourceIds });
      };
      
      // #600 物理置顶：zIndex 由外层容器控制，不依赖 selected 状态
      // 外层 div 设置 zIndex，GeneratePanelNode 内部 zIndex 固定为 1
      return (
        <div key={el.id} data-element-id={el.id} style={{ position: 'absolute', left: 0, top: 0, zIndex }}>
        <GeneratePanelNode
          el={el}
          isSelected={isPanelSelected}
          isInputActive={isInputActive}
          zoom={zoom || 1}
          pan={pan}  // #493 传递 pan 用于 Portal 坐标计算
          isBeingSnapped={isBeingSnapped}  // #性能优化：传计算后的 boolean
          activeTool={activeTool}
          isAlreadyConnected={isAlreadyConnected}  // #性能优化：传计算后的 boolean
          sourceIds={sourceIds}
          modelDisplayNames={modelDisplayNames || {}}
          modelConfig={modelConfig || {}}
          imageModelOptions={imageModelOptions}
          videoModelOptions={videoModelOptions}
          llmModelOptions={llmModelOptions}
          credits={credits ?? 0}
          isGenerating={isGenerating}
          hoveredElementId={hoveredElementIdRef.current}  // #367 悬浮元素 ID（用于 Handle 悬浮显示）
          theme={(theme ?? 'dark') as 'dark' | 'light'}  // #367 主题（用于 Handle 样式动态变化）
          selectedIds={canvas.state.selectedIds}
          allElements={canvas.state.elements}
          onDragMove={handlePanelDragMoveForAlignment}  // #343 面板拖拽对齐磁吸
          onDragEnd={handlePanelDragEnd}  // #343 面板拖拽结束
          onUpdateElement={(id, data) => canvas.updateElement?.(id, data)}
          onSelectElement={(id, additive) => {
            canvas.selectElement?.(id, additive);
            // 👑 #602 物理置顶：面板选中时也要立即置顶
            if (!additive) {
              forceBringToFront(id);
            }
          }}
          onSetActiveInputNode={setActiveInputNodeId}
          onClearCanvasSelection={() => canvas.clearSelection?.()}  // #480 拖动面板时取消画布选中
          getCurrentInputNodeId={() => activeInputNodeId}
          onAddElement={(element) => canvas.addElement?.(element as any)}
          onInputPortPointerUp={handleInputPortPointerUp}
          onOutputPortPointerDown={handleOutputPortPointerDown}
          onRemoveSourceImage={handleRemoveSourceImage}
          // #60fps Phase1: 移除 setSnapHighlightId prop，改用 DOM class 控制
          onReorderSourceImages={handleReorderSourceImages}
          onSendToChat={onSendMessage}  // #489 发送到对话
          onDuplicatePanel={(panelId) => {
            // #330 创建副本：复制面板，保持与原图的连接
            // #332 优化：新面板排在原面板正下方并对齐
            const panel = canvas.state.elements.find(e => e.id === panelId);
            if (!panel) return;
            
            // 查找同一源图片连接的其他面板，计算最大 Y 坐标
            const sourceIds = panel.sourceIds || [];
            const siblingPanels = canvas.state.elements.filter(
              e => e.type === 'generate-panel' && 
                   e.id !== panelId &&
                   e.sourceIds?.some(id => sourceIds.includes(id))
            );
            
            // 找到最下方的面板
            let bottomY = panel.y + panel.height;
            siblingPanels.forEach(p => {
              const pBottom = p.y + p.height;
              if (pBottom > bottomY) {
                bottomY = pBottom;
              }
            });
            
            // 在最下方面板的下方创建新面板，左对齐原面板
            const gap = 20; // 面板间距
            const newPanelId = canvas.addElement({
              type: 'generate-panel',
              name: `${panel.name} 副本`,
              x: panel.x,  // 左对齐原面板
              y: bottomY + gap,  // 在最下方面板的下方
              width: panel.width,
              height: panel.height,
              originalHeight: panel.originalHeight,
              rotation: 0,
              fill: '#18181b',
              stroke: '#3f3f46',
              strokeWidth: 1,
              opacity: 1,
              visible: true,
              locked: false,
              sourceIds: panel.sourceIds ? [...panel.sourceIds] : [], // 复制源图片连接
              targetType: panel.targetType,
              panelType: panel.panelType, // 👑 #424 修复：复制面板类型，确保模型列表正确显示
              panelModel: panel.panelModel,
              panelRatio: panel.panelRatio,
              panelResolution: panel.panelResolution,
              panelCount: panel.panelCount,
              panelPrompt: panel.panelPrompt,
              // #614 新面板置顶
              zIndex: (canvas.state.elements.length > 0 ? Math.max(...canvas.state.elements.map(e => e.zIndex || 1)) : 0) + 1,
            });
            
          }}
          onDeletePanel={(panelId) => {
            // #330 删除面板
            canvas.deleteElement(panelId);
            canvas.clearSelection();
          }}
          // #372 点击面板时取消连线菜单状态
          onCancelConnection={() => {
            setGenerateMenu(prev => prev.visible ? { ...prev, visible: false } : prev);
            // 清理连线状态
            draftLineRef.current = { active: false, sourceId: null, sourceType: null, startX: 0, startY: 0, snapTargetId: null, snapPortX: 0, snapPortY: 0 };
            // #60fps Phase1: 纯 ref + DOM 操作
            isConnectionActiveGlobalRef.current = false;
            connectionDragStartRef.current = null;
            connectionDragTriggeredRef.current = false;
            resetConnectionVisualState();
            // #610 Canvas 清除替代 SVG display:none
            clearInteractionCanvas();
          }}
          // #382 传递全局连线状态 ref（避免 React 渲染延迟）
          isConnectionActiveGlobalRef={isConnectionActiveGlobalRef}
          // #452 传递获取最新元素的函数（解决 React 状态更新延迟问题）
          // #462 修复：支持面板类型，返回 imageKeys[0] 和 imageUrls[0]
          getLatestElement={(id) => {
            const liveEl = canvas.stateRef?.current?.elements?.find((e: any) => e.id === id);
            if (liveEl) {
              // #483 面板类型：返回当前主图的 imageKey 和 imageUrl
              // 注意：面板切换主图时会重排数组，所以 imageUrls[0] 始终是当前主图
              // #623 优先检查视频面板
              if (liveEl.type === 'generate-panel' && liveEl.panelType === 'video') {
                const panelVideoKeys = liveEl.videoKeys || [];
                const panelVideoUrls = liveEl.videoUrls || [];
                return { 
                  imageKey: panelVideoKeys[0], 
                  imageUrl: panelVideoUrls[0] 
                };
              }
              if (liveEl.type === 'generate-panel') {
                const panelImageKeys = liveEl.imageKeys || [];
                const panelImageUrls = liveEl.imageUrls || [];
                return { 
                  imageKey: panelImageKeys[0], 
                  imageUrl: panelImageUrls[0] 
                };
              }
              // 图片栈类型：返回当前激活图片的 imageKey 和 imageUrl
              if (liveEl.type === 'image-stack') {
                const stackImageKeys = liveEl.imageKeys || [];
                const stackImageUrls = liveEl.imageUrls || [];
                const activeIndex = liveEl.activeIndex || 0;
                return { 
                  imageKey: stackImageKeys[activeIndex], 
                  imageUrl: stackImageUrls[activeIndex] 
                };
              }
              // #623 视频类型：返回 videoKey 和 videoUrl
              if (liveEl.type === 'video') {
                const videoKey = liveEl.videoKey || (liveEl.videoKeys && liveEl.videoKeys.length > 0 ? liveEl.videoKeys[0] : undefined);
                const videoUrl = liveEl.videoUrl || (liveEl.videoUrls && liveEl.videoUrls.length > 0 ? liveEl.videoUrls[0] : undefined);
                return { 
                  imageKey: videoKey, 
                  imageUrl: videoUrl 
                };
              }
              // 普通图片类型
              return { imageKey: liveEl.imageKey, imageUrl: liveEl.imageUrl };
            }
            return undefined;
          }}
        />
        </div>
      );
    }

    // 矩形
    if (el.type === 'rectangle') {
      const visualStrokeWidth = (el.strokeWidth || 0) / zoom;
      return (
        <div 
          key={el.id} 
          style={{ 
            position: 'absolute', 
            left: el.x, 
            top: el.y, 
            width: el.width, 
            height: el.height, 
            backgroundColor: el.fill, 
            border: el.stroke && el.stroke !== 'transparent' ? `${visualStrokeWidth}px solid ${el.stroke}` : 'none',
            borderRadius: 4, 
            zIndex,
            userSelect: 'none'
          }} 
          className={`select-none ${cursorClass}`} 
          onContextMenu={(e) => handleContextMenu(e, el.id)}
        >
        </div>
      );
    }

    // 文字元素 - 由 FabricTextLayer 处理，这里返回占位 div
    if (el.type === 'text') {
      return (
        <div
          key={el.id}
          data-element-id={el.id}
          data-text-placeholder="true"
          style={{
            position: 'absolute',
            left: el.x,
            top: el.y,
            width: el.width,
            height: el.height,
            visibility: 'hidden',
            pointerEvents: 'none',
          }}
        />
      );
    }

    // #591 终极修复：未知类型返回占位 div，而不是 null
    // 保持 DOM 结构稳定，避免 insertBefore 找错参照物
    return (
      <div
        key={el.id}
        data-element-id={el.id}
        data-unknown-placeholder="true"
        style={{
          position: 'absolute',
          left: el.x,
          top: el.y,
          width: 0,
          height: 0,
          visibility: 'hidden',
          pointerEvents: 'none',
        }}
      />
    );
  };

  const handleContextMenu = (e: React.MouseEvent, elementId?: string) => {
    const target = e.target as HTMLElement;

    // #873 修复：画布区域白名单——如果点击不在画布交互区内，立刻放行原生菜单
    if (!target.closest?.('[data-canvas-area="true"]')) {
      return;
    }

    // #873 修复：输入框/文本域/可编辑元素 → 放行浏览器原生菜单
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }
    // 向上穿透查找 contenteditable（点击子元素时 isContentEditable 不可靠）
    if (target.closest?.('[contenteditable="true"]')) {
      return;
    }
    // 用户正在框选文字时，放行原生菜单
    if (window.getSelection?.() && (window.getSelection()?.toString().length ?? 0) > 0) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    
    // #620 修复：使用 stateRef 获取最新 selectedIds，解决 memoizedOnContextMenu 闭包陷阱
    const liveSelectedIds = canvas.stateRef?.current?.selectedIds || canvas.state.selectedIds;
    const liveTool = canvas.stateRef?.current?.tool || canvas.state.tool;
    const _isMultiSelectActive = liveSelectedIds.length > 1;
    
    // 裁剪模式下右键退出裁剪模式
    if (isCropping) {
      setIsCropping(false);
      setCropImageId(null);
      setCropRect(null);
      setCropHandle(null);
      return;
    }
    
    // 双击选择模式下右键取消该模式
    if (isGridSelectMode && setIsGridSelectMode) {
      setIsGridSelectMode(false);
      return;
    }
    
    // 画笔工具时右键取消画笔功能，切换回选择工具
    if (liveTool === 'pen') {
      setActiveTool('select');
      canvas.setTool('select');
      setIsDrawing(false);
      setDrawPath([]);
      return;
    }
    
    // 手型工具时禁止选择操作
    if (liveTool === 'hand') {
      const rect = containerRef.current?.getBoundingClientRect();
      setContextMenu({ 
        x: e.clientX, 
        y: e.clientY, 
        elementId: undefined,
        canvasX: rect ? (e.clientX - rect.left - pan.x) / zoom : 0,
        canvasY: rect ? (e.clientY - rect.top - pan.y) / zoom : 0,
      });
      return;
    }
    
    // 右键点击时选中/取消选中元素
    const isMultiSelectActive = liveSelectedIds.length > 1;
    if (elementId) {
      const isSelected = liveSelectedIds.includes(elementId);
      if (!isSelected) {
        // #620 修复：多选激活时，右键点击未选中元素应显示多选菜单，而不是强制单选
        if (isMultiSelectActive) {
          // 多选激活时，直接显示多选右键菜单
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            elementId: undefined,
            isMultiSelect: true,
          });
          return;
        }
        // 非多选状态：选中此元素
        canvas.selectElement(elementId, false);
        forceBringToFront(elementId);  // 👑 #601 物理置顶
      }
      // 右键点击已选中的元素：保持当前选中状态不变
    } else {
      // 右键点击画布空白区域时
      if (isMultiSelectActive && selectionBox) {
        // 检查右键点击是否在选中框范围内
        const rect2 = containerRef.current?.getBoundingClientRect();
        if (rect2) {
          const clickX = (e.clientX - rect2.left - pan.x) / zoom;
          const clickY = (e.clientY - rect2.top - pan.y) / zoom;
          const isInsideSelectionBox = clickX >= selectionBox.x && clickX <= selectionBox.x + selectionBox.width &&
                                       clickY >= selectionBox.y && clickY <= selectionBox.y + selectionBox.height;
          if (isInsideSelectionBox) {
            // 在选中框内右键：显示多选右键菜单，不清除选中
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              elementId: undefined,
              isMultiSelect: true,
            });
            return;
          }
        }
      }
      // 右键点击选中框外的空白区域：取消选中所有元素
      canvas.clearSelection();
    }
    
    // #569 修复：右键菜单使用 createPortal + fixed 定位，坐标应为视口坐标
    // #621 同时记录画布坐标，用于右键上传功能
    const canvasRect = containerRef.current?.getBoundingClientRect();
    const menuCanvasX = canvasRect ? (e.clientX - canvasRect.left - pan.x) / zoom : 0;
    const menuCanvasY = canvasRect ? (e.clientY - canvasRect.top - pan.y) / zoom : 0;
    const _isMultiSelect = isMultiSelectActive && elementId && liveSelectedIds.includes(elementId) ? true : undefined;
    setContextMenu({ 
      x: e.clientX, 
      y: e.clientY, 
      elementId,
      isMultiSelect: _isMultiSelect,
      canvasX: menuCanvasX,
      canvasY: menuCanvasY,
    });
  };

  return (
    <>
      <div 
        ref={containerRef} 
        data-canvas-area="true"
        className="w-full h-full relative select-none overflow-hidden rounded-xl canvas-custom-cursor"
        style={{
          userSelect: 'none',
          backgroundColor: 'var(--canvas-bg)',
          ...(canvas.state.tool === 'pen' && {
            cursor: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2'%3E%3Cpath d='M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'/%3E%3C/svg%3E") 0 24, crosshair`
          })
        }}
        onMouseDown={handleMouseDown} 
        onMouseMove={handleMouseMove} 
        onMouseUp={handleMouseUp} 
        onMouseLeave={handleMouseLeave}
        onContextMenu={(e) => {
          // 检查点击位置是否有元素
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) {
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const canvasX = (x - pan.x) / zoom;
            const canvasY = (y - pan.y) / zoom;
            
            // 查找点击位置的元素
            const clickedEl = [...canvas.state.elements].reverse().find(el => {
              if (!el.visible || el.locked) return false;
              // 文字元素：使用存储的尺寸
              if (el.type === 'text') {
                const textWidth = el.width || 50;
                const textHeight = el.height || (el.fontSize || 24) * 1.4 + 8;
                return canvasX >= el.x && canvasX <= el.x + textWidth && 
                       canvasY >= el.y && canvasY <= el.y + textHeight;
              }
              return canvasX >= el.x && canvasX <= el.x + el.width && 
                     canvasY >= el.y && canvasY <= el.y + el.height;
            });
            
            handleContextMenu(e, clickedEl?.id);
          } else {
            handleContextMenu(e);
          }
        }}
      >
        {/* 画笔工具栏 - 顶部居中 */}
        {canvas.state.tool === 'pen' && (
          <PenToolbar
            penSize={penSize}
            setPenSize={setPenSize}
            penColor={penColor}
            setPenColor={setPenColor}
            penHue={penHue}
            setPenHue={setPenHue}
            penSaturation={penSaturation}
            setPenSaturation={setPenSaturation}
            penBrightness={penBrightness}
            setPenBrightness={setPenBrightness}
            penOpacity={penOpacity}
            setPenOpacity={setPenOpacity}
            showColorPicker={showColorPicker}
            setShowColorPicker={setShowColorPicker}
          />
        )}
        
        {/* 画布右上角：日夜模式切换 + 缩放按钮 */}
        <div 
          className="absolute top-3 right-3 z-50 flex items-center gap-1 bg-white dark:bg-gray-800 rounded-lg shadow-md px-1 py-1"
          style={{ pointerEvents: 'auto' }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 日夜模式切换按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setTheme(theme === 'dark' ? 'light' : 'dark');
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title={isMounted ? (theme === 'dark' ? '切换到白天模式' : '切换到夜间模式') : '切换主题'}
          >
            {!isMounted ? (
              <div className="w-4 h-4" /> // 占位符，避免 hydration 错误
            ) : theme === 'dark' ? (
              <Sun className="w-4 h-4 text-yellow-400" />
            ) : (
              <Moon className="w-4 h-4 text-gray-600" />
            )}
          </button>
          
          {/* 分隔线 */}
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-600" />
          
          {/* 缩放按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              // 按当前视口中心放大
              const container = containerRef.current;
              if (!container) return;
              const rect = container.getBoundingClientRect();
              
              // 使用 useCanvasCore 的缩放计算函数
              const result = calculateZoom({
                currentZoom: zoom,
                currentPan: pan,
                scaleFactor: 1.2,
                containerWidth: rect.width,
                containerHeight: rect.height,
                canvasWidth: CANVAS_WIDTH,
                canvasHeight: canvasHeight,
              });
              
              setZoom(result.zoom);
              setPan({ x: result.panX, y: result.panY });
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="放大"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
              <path d="M11 8v6M8 11h6"/>
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              // 按当前视口中心缩小
              const container = containerRef.current;
              if (!container) return;
              const rect = container.getBoundingClientRect();
              
              // 使用 useCanvasCore 的缩放计算函数
              const result = calculateZoom({
                currentZoom: zoom,
                currentPan: pan,
                scaleFactor: 1 / 1.2,
                containerWidth: rect.width,
                containerHeight: rect.height,
                canvasWidth: CANVAS_WIDTH,
                canvasHeight: canvasHeight,
              });
              
              setZoom(result.zoom);
              setPan({ x: result.panX, y: result.panY });
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="缩小"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
              <path d="M8 11h6"/>
            </svg>
          </button>
        </div>
        
        {/* ================= 三明治架构 ================= */}
        
        {/* ================= 第一层：底层 SVG 连线层 (z-index: 10) ================= */}
        <div
          data-canvas-layer="svg-layer"
          style={{
            transform: isMounted ? `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` : 'translate(0px, 0px) scale(1)',
            transformOrigin: '0 0',
            position: 'absolute',
            top: 0,
            left: 0,
            // #608 解除 40000px 黑洞封印：用 100vw/100vh + overflow:visible
            // Chrome 不会为一个根本画不完的 40000px div 浪费显存
            // 子元素通过 absolute left/top 自行定位，不受容器尺寸限制
            width: '100vw',
            height: '100vh',
            overflow: 'visible',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {/* 画布背景 - #608 使用实际画布尺寸，不随父容器 100vw/100vh 变化 */}
          <div 
            style={{
              width: CANVAS_WIDTH,
              height: canvasHeight,
              backgroundColor: 'var(--canvas-bg)',
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: 'var(--canvas-border)',
              borderRadius: 4,
              position: 'absolute',
              top: 0,
              left: 0,
              boxShadow: '0 0 20px rgba(0,0,0,0.1)',
              pointerEvents: 'none'


            }}
          />
          
          {/* 灰色静态连线层 */}
          {/* #GPU隔离 绝对必须！这个层包含 SVG filter/gradient，如果不隔离，Chrome 会把它和底层图片合并到同一 GPU 图层，连线变化时导致图片被重栅格化变糊！ */}
          {isMounted && (
            <svg style={{ 
              position: 'absolute', 
              top: 0, 
              left: 0, 
              width: '100%', 
              height: '100%', 
              pointerEvents: 'none', 
              overflow: 'visible',
              zIndex: 26,
              // #模糊修复 终极手术：删除 GPU 辐射源！
              // ❌ 删除 willChange 和 translateZ：在 scale 容器内会触发 CPU 图片重栅格化
              // ✅ SVG 回归纯 2D 渲染，彻底根除混合合成陷阱！
            }}>
              {/* 👑 灵魂滤镜：柔和发光 + 渐变定义 */}
              <defs>
                <filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur1" />
                  <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur2" />
                  <feMerge>
                    <feMergeNode in="blur2" />
                    <feMergeNode in="blur1" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <linearGradient id="edge-gradient" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#22c55e" />
                </linearGradient>
              </defs>
              {/* #60fps Phase3: 使用 useMemo 预计算的 staticConnections，拖拽时不重计算 */}
              {staticConnections.map((conn, idx) => {
                const { sourceNode, targetNode, sourceId, targetId } = conn;
                
                // 👑 连接线贴合图片/面板/图片栈边界中心
                // 图片输出端口：图片右边缘中心
                // 面板输入端口：面板左边缘中心
                // 面板输出端口：面板右边缘中心
                // 图片栈输入端口：图片栈顶部边缘中心
                // 图片栈输出端口：图片栈底部边缘中心
                
                let startX: number, startY: number, endX: number, endY: number;
                
                if (sourceNode.type === 'image') {
                  // 图片→面板/图片栈：起点是图片右边缘中心
                  startX = sourceNode.x + sourceNode.width;
                  startY = sourceNode.y + sourceNode.height / 2;
                } else if (sourceNode.type === 'image-stack') {
                  // 图片栈→面板/图片栈：起点是图片栈底部边缘中心
                  startX = sourceNode.x + (sourceNode.width || 280) / 2;
                  startY = sourceNode.y + (sourceNode.height || 280);
                } else {
                  // 面板→图片/图片栈：起点是面板右边缘中心
                  startX = sourceNode.x + sourceNode.width;
                  startY = sourceNode.y + sourceNode.height / 2;
                }
                
                if (targetNode.type === 'generate-panel') {
                  // 图片/图片栈→面板：终点是面板左边缘中心
                  endX = targetNode.x;
                  endY = targetNode.y + targetNode.height / 2;
                } else if (targetNode.type === 'image-stack') {
                  // 图片/面板/图片栈→图片栈：终点是图片栈顶部边缘中心
                  endX = targetNode.x + (targetNode.width || 280) / 2;
                  endY = targetNode.y;
                } else {
                  // 面板→图片：终点是图片左边缘中心
                  endX = targetNode.x;
                  endY = targetNode.y + targetNode.height / 2;
                }
                
                // 👑 统一算法：使用全局贝塞尔曲线生成器
                const path = generateBezierPath(startX, startY, endX, endY);
                
                // 👑 判断当前这根线的两端是否有任何一端被选中
                const isSourceSelected = canvas.state.selectedIds.includes(sourceNode.id);
                const isTargetSelected = canvas.state.selectedIds.includes(targetNode.id);
                const isActive = isSourceSelected || isTargetSelected;
                
                // 👑 激活状态：只显示灰色轨道，脉冲动画由 Canvas 层负责
                return (
                  <g key={`edge-${targetId}-${sourceId}-${idx}`}>
                    {/* 灰色轨道（始终显示） */}
                    <path 
                      d={path}
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth="6"
                      strokeLinecap="round"
                    />
                  </g>
                );
              })}
            </svg>
          )}
        </div>{/* ================= 第一层结束 ================= */}
        
        {/* ================= 第二层：Canvas 脉冲特效层 (z-index: 20) ================= */}
        {/* #60fps Phase3: 使用 useMemo 预计算的 activePulseConnections，拖拽时不重计算 */}
        {isMounted && (
            <div style={{ 
              zIndex: 20, 
              position: 'absolute', 
              top: 0, 
              left: 0, 
              width: '100%', 
              height: '100%', 
              pointerEvents: 'none' 
            }}>
              <ConnectionPulseCanvas
                connections={activePulseConnections}
                isActive={activePulseConnections.length > 0 && !isDragging && !isPanelDragging && !isZooming && isPulseReady}
                zoom={zoom}
                panX={pan.x}
                panY={pan.y}
              />
            </div>
        )}
        
        {/* ================= 第三层：顶层 DOM 节点层 (z-index: 30) ================= */}
        <div
          data-canvas-layer="node-layer"
          style={{
            transform: isMounted ? `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` : 'translate(0px, 0px) scale(1)',
            transformOrigin: '0 0',
            position: 'absolute',
            top: 0,
            left: 0,
            // #608 解除 40000px 黑洞封印：用 100vw/100vh + overflow:visible
            // Chrome 不会为一个根本画不完的 40000px div 浪费显存
            // 子元素通过 absolute left/top 自行定位，不受容器尺寸限制
            width: '100vw',
            height: '100vh',
            overflow: 'visible',
            pointerEvents: isGridSelectMode ? 'auto' : 'none',
            zIndex: 30,
          }}
        >
          {/* #096 修复：元素层只在客户端渲染，避免 SSR Hydration 撕裂 */}
          {/* 带有动态 left/top/width 的元素绝对不准参与 SSR */}
          {/* #591 DOM 物理隔离层：将动态数组独立封装，新增/删除只触发 appendChild，永不跨界寻找外部兄弟节点！ */}
          {/* #军师方案：只隔离 SVG 污染源，不隔离图片大本营（否则缩放会糊） */}
          <div 
            id="canvas-elements-layer" 
            style={{ 
              position: 'absolute', 
              top: 0, 
              left: 0, 
              width: 0, 
              height: 0, 
              overflow: 'visible'
            }}
          >
          {/* #591 终极防御：在 map 这一层强制锁死 Key！即使 renderElement 返回 null，React 依然能追踪到这个带 Key 的隐形坑位，绝不错乱！ */}
            {isMounted && canvas.state.elements.map((el, index) => (
              <React.Fragment key={el.id}>
                {renderElement(el, index)}
              </React.Fragment>
            ))}
          </div>
          

          {/* #493 面板 UI Portal 容器 - 在第三层内部，与面板同级 */}
          <div 
            id="panel-ui-overlay-root" 
            style={{ 
              position: 'absolute', 
              top: 0, 
              left: 0, 
              width: '100%', 
              height: '100%', 
              pointerEvents: 'none', 
              zIndex: 1  // 在第三层内部，低于面板（51-100）
            }} 
          />
        </div>{/* ================= 第三层结束 ================= */}
        
        {/* #096 修复：Fabric.js 文字层只在客户端渲染 */}
        {isMounted && (
        <FabricTextLayer
          elements={canvas.state.elements}
          selectedIds={canvas.state.selectedIds}
          zoom={zoom}
          pan={pan}
          containerRef={containerRef}
          onUpdateElement={canvas.updateElement}
          onSelectElement={(id, additive) => {
            canvas.selectElement?.(id, additive);
            // 👑 #602 物理置顶：文字选中时也要立即置顶
            if (!additive) {
              forceBringToFront(id);
            }
          }}
          onAddElement={canvas.addElement}
          onClearSelection={canvas.clearSelection}
          activeTool={activeTool}
          isGridSelectMode={isGridSelectMode}
          isCropping={isCropping}
          onCanvasClick={(canvasX: number, canvasY: number) => {
            // 如果正在拖动元素，不启动框选
            if (isDraggingRef.current) {
              return;
            }
            // 点击空白区域时触发框选
            if (activeTool === 'select') {
              canvas.clearSelection();
              setIsSelecting(true);
              setSelectionRect({ startX: canvasX, startY: canvasY, endX: canvasX, endY: canvasY });
              // 关闭面板弹窗
              setActiveInputNodeId(null);
            }
          }}
          onSwitchToSelect={() => {
            setActiveTool('select');
            canvas.setTool('select');
          }}
          onContextMenu={(e: MouseEvent) => {
            // 检查点击位置是否有元素
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) {
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              const canvasX = (x - pan.x) / zoom;
              const canvasY = (y - pan.y) / zoom;
              
              // 查找点击位置的元素
              const clickedEl = [...canvas.state.elements].reverse().find(el => {
                if (!el.visible || el.locked) return false;
                // 文字元素：使用存储的尺寸
                if (el.type === 'text') {
                  const textWidth = el.width || 50;
                  const textHeight = el.height || (el.fontSize || 24) * 1.4 + 8;
                  return canvasX >= el.x && canvasX <= el.x + textWidth && 
                         canvasY >= el.y && canvasY <= el.y + textHeight;
                }
                return canvasX >= el.x && canvasX <= el.x + el.width && 
                       canvasY >= el.y && canvasY <= el.y + el.height;
              });
              
              // #873 修复：合成事件必须携带 target 属性，否则 handleContextMenu 的
              // 画布区域白名单检查 (target.closest('[data-canvas-area]')) 会因 target=undefined 而失败
              const syntheticEvent = {
                preventDefault: () => e.preventDefault(),
                stopPropagation: () => e.stopPropagation(),
                clientX: e.clientX,
                clientY: e.clientY,
                target: e.target,
              } as unknown as React.MouseEvent;
              handleContextMenu(syntheticEvent, clickedEl?.id);
            }
          }}
        />
        )}
        
        {/* 画笔绘制中的路径 - 固定线宽，不受缩放影响 */}
        {isDrawing && drawPath.length > 0 && (
          <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 25 }}>
            <path
              d={drawPath.map((p, i) => {
                // 转换为屏幕坐标
                const screenX = p.x * zoom + pan.x;
                const screenY = p.y * zoom + pan.y;
                return i === 0 ? `M${screenX},${screenY}` : `L${screenX},${screenY}`;
              }).join(' ')}
              stroke={penColor}
              strokeWidth={penSize}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        
        {/* 形状预览 - 拖动时显示 */}
        {shapePreview && (
          <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 25 }}>
            {(() => {
              const screenX = shapePreview.x * zoom + pan.x;
              const screenY = shapePreview.y * zoom + pan.y;
              const screenW = shapePreview.width * zoom;
              const screenH = shapePreview.height * zoom;
              // 使用默认的灰色，与最终形状一致
              // 气泡和箭头使用透明填充
              const isOutline = shapePreview.type === 'shape-bubble' || shapePreview.type === 'shape-arrow-left' || shapePreview.type === 'shape-arrow-right';
              const previewFill = isOutline ? 'transparent' : '#9ca3af';
              const previewStroke = '#6b7280';
              const previewStrokeWidth = 2; // 固定像素宽度
              
              if (shapePreview.type === 'rectangle' || shapePreview.type === 'shape-rectangle') {
                return <rect x={screenX} y={screenY} width={screenW} height={screenH} fill={previewFill} stroke={previewStroke} strokeWidth={previewStrokeWidth} rx={4} />;
              }
              if (shapePreview.type === 'shape-circle') {
                return <ellipse cx={screenX + screenW / 2} cy={screenY + screenH / 2} rx={screenW / 2} ry={screenH / 2} fill={previewFill} stroke={previewStroke} strokeWidth={previewStrokeWidth} />;
              }
              if (shapePreview.type === 'shape-triangle') {
                const points = `${screenX + screenW / 2},${screenY} ${screenX + screenW},${screenY + screenH} ${screenX},${screenY + screenH}`;
                return <polygon points={points} fill={previewFill} stroke={previewStroke} strokeWidth={previewStrokeWidth} />;
              }
              if (shapePreview.type === 'shape-star') {
                const cx = screenX + screenW / 2, cy = screenY + screenH / 2;
                const outerR = Math.min(screenW, screenH) / 2;
                const innerR = outerR * 0.38;
                const points: string[] = [];
                for (let i = 0; i < 10; i++) {
                  const r = i % 2 === 0 ? outerR : innerR;
                  const angle = (Math.PI / 2) + (i * Math.PI / 5);
                  points.push(`${cx + r * Math.cos(angle)},${cy - r * Math.sin(angle)}`);
                }
                return <polygon points={points.join(' ')} fill={previewFill} stroke={previewStroke} strokeWidth={previewStrokeWidth} />;
              }
              if (shapePreview.type === 'shape-bubble') {
                // 圆滑气泡预览
                const bubbleW = screenW * 0.75;
                const bubbleH = screenH * 0.7;
                const tailW = screenW * 0.15;
                const radius = Math.min(screenW, screenH) * 0.1;
                const pathD = `
                  M ${screenX + radius} ${screenY}
                  L ${screenX + bubbleW - radius} ${screenY}
                  Q ${screenX + bubbleW} ${screenY} ${screenX + bubbleW} ${screenY + radius}
                  L ${screenX + bubbleW} ${screenY + bubbleH - radius}
                  Q ${screenX + bubbleW} ${screenY + bubbleH} ${screenX + bubbleW - radius} ${screenY + bubbleH}
                  L ${screenX + bubbleW - tailW * 0.5} ${screenY + bubbleH}
                  L ${screenX + bubbleW + tailW * 0.5} ${screenY + screenH}
                  L ${screenX + bubbleW - tailW * 1.5} ${screenY + bubbleH}
                  L ${screenX + radius} ${screenY + bubbleH}
                  Q ${screenX} ${screenY + bubbleH} ${screenX} ${screenY + bubbleH - radius}
                  L ${screenX} ${screenY + radius}
                  Q ${screenX} ${screenY} ${screenX + radius} ${screenY}
                  Z
                `.replace(/\s+/g, ' ').trim();
                return <path d={pathD} fill="none" stroke={previewStroke} strokeWidth={previewStrokeWidth} />;
              }
              if (shapePreview.type === 'shape-arrow-left') {
                const w = screenW, h = screenH;
                const points = [
                  [screenX + w, screenY + h * 0.3],
                  [screenX + w * 0.4, screenY + h * 0.3],
                  [screenX + w * 0.4, screenY],
                  [screenX, screenY + h * 0.5],
                  [screenX + w * 0.4, screenY + h],
                  [screenX + w * 0.4, screenY + h * 0.7],
                  [screenX + w, screenY + h * 0.7],
                ].map(p => p.join(',')).join(' ');
                return <polygon points={points} fill="none" stroke={previewStroke} strokeWidth={previewStrokeWidth} />;
              }
              if (shapePreview.type === 'shape-arrow-right') {
                const w = screenW, h = screenH;
                const points = [
                  [screenX, screenY + h * 0.3],
                  [screenX + w * 0.6, screenY + h * 0.3],
                  [screenX + w * 0.6, screenY],
                  [screenX + w, screenY + h * 0.5],
                  [screenX + w * 0.6, screenY + h],
                  [screenX + w * 0.6, screenY + h * 0.7],
                  [screenX, screenY + h * 0.7],
                ].map(p => p.join(',')).join(' ');
                return <polygon points={points} fill="none" stroke={previewStroke} strokeWidth={previewStrokeWidth} />;
              }
              return null;
            })()}
          </svg>
        )}
        
        {/* 注入流光动画 CSS */}
        <style>{`
          @keyframes meteorFly {
            to { stroke-dashoffset: -100; }
          }
          .meteor-path {
            animation: meteorFly 1.8s linear infinite;
          }
          @keyframes dashFlow {
            to { stroke-dashoffset: -20; }
          }
          .flow-line {
            animation: dashFlow 0.8s linear infinite;
          }
        `}</style>
        
        {/* 专门用于绘制临时拖拽连线的原生 SVG 层 */}
        {/* #模糊修复 终极手术：删除 GPU 辐射源，回归纯 2D 渲染 */}
        {/* #610 拖拽连线已迁移到 Canvas 交互层，SVG draft-connection-layer 已删除 */}
        
        {/* 引用生成悬浮菜单 */}
        {generateMenu.visible && (
          <div
            className="generate-context-menu"
            style={{
              position: 'absolute',
              left: generateMenu.x,
              top: generateMenu.y,
              zIndex: 300,
              width: '200px',
              background: '#27272a',
              border: '1px solid #3f3f46',
              borderRadius: '12px',
              padding: '8px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              userSelect: 'none'
            }}
            onMouseDown={(e) => e.stopPropagation()}
              onWheel={(e) => {
                // #362 在菜单上滚动也取消连线，然后让事件继续传播触发画布缩放
                connectionDragStartRef.current = null;
                connectionDragTriggeredRef.current = false;
                draftLineRef.current = { active: false, sourceId: null, sourceType: null, startX: 0, startY: 0, snapTargetId: null, snapPortX: 0, snapPortY: 0 };
                // #60fps Phase1: 纯 ref + DOM 操作
        isConnectionActiveGlobalRef.current = false;
                resetConnectionVisualState();
                // #610 Canvas 清除替代 SVG display:none
                clearInteractionCanvas();
                setGenerateMenu({ visible: false, x: 0, y: 0, sourceId: null });
                // 不阻止事件传播，让滚轮事件继续触发画布缩放
              }}
          >
            <div style={{ fontSize: '11px', color: '#71717a', padding: '4px 8px 8px 8px' }}>引用该节点生成</div>
            
            {/* #629 视频节点时禁用图片和视频按钮，变暗不可点 */}
            {/* 图片 */}
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 10px', borderRadius: '8px',
                cursor: generateMenu.sourceElementType === 'video' ? 'not-allowed' : 'pointer',
                color: generateMenu.sourceElementType === 'video' ? '#52525b' : '#e4e4e7',
                fontSize: '13px',
                transition: 'background-color 0.15s',
                opacity: generateMenu.sourceElementType === 'video' ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (generateMenu.sourceElementType !== 'video') {
                  e.currentTarget.style.backgroundColor = '#3f3f46';
                }
              }}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              onClick={() => {
                if (generateMenu.sourceElementType === 'video') return; // #629 视频节点时禁用
                const { sourceId, canvasX, canvasY, sourceIds: menuSourceIds } = generateMenu;
                setGenerateMenu({ ...generateMenu, visible: false });
                // #610 Canvas 清除替代 SVG
                clearInteractionCanvas();
                const panelCanvasX = canvasX ?? 0;
                const panelCanvasY = canvasY ?? 0;
                // 多选拉线时，使用选中元素中最大尺寸的那个元素
                const isMultiSelect = sourceId === '__multi_select__';
                let sourceImage: { width: number; height: number } | undefined;
                if (isMultiSelect && menuSourceIds?.length) {
                  // #664 找出选中元素中面积最大的那个
                  const selectedEls = menuSourceIds
                    .map(id => canvas.state.elements.find(e => e.id === id))
                    .filter(Boolean) as Array<{ width: number; height: number }>;
                  if (selectedEls.length > 0) {
                    // 按面积排序，取最大的
                    selectedEls.sort((a, b) => (b.width * b.height) - (a.width * a.height));
                    sourceImage = { width: selectedEls[0].width, height: selectedEls[0].height };
                  }
                } else if (sourceId && sourceId !== '__multi_select__') {
                  sourceImage = canvas.state.elements.find(e => e.id === sourceId);
                }
                // #492 消灭亚像素渲染：尺寸取整
                const panelWidth = Math.round(sourceImage?.width || 280);
                const panelHeight = Math.round(sourceImage?.height || 160);
                // #492 消灭亚像素渲染：坐标取整
                const panelX = Math.round(panelCanvasX);
                const panelY = Math.round(panelCanvasY - panelHeight / 2);
                
                // 多选时使用所有选中元素的ID，单选时使用单个sourceId
                const finalSourceIds = isMultiSelect && menuSourceIds?.length
                  ? menuSourceIds
                  : (sourceId && sourceId !== '__multi_select__' ? [sourceId] : []);
                
                // 根据面板实际尺寸计算最匹配的标准比例
                const calculateMatchingRatio = (width: number, height: number, availableRatios: string[]): string => {
                  const actualRatio = width / height;
                  let bestMatch = '1:1';
                  let minDiff = Infinity;
                  
                  for (const ratio of availableRatios) {
                    if (ratio === 'auto') continue;
                    const parts = ratio.split(':');
                    if (parts.length === 2) {
                      const w = parseFloat(parts[0]);
                      const h = parseFloat(parts[1]);
                      if (!isNaN(w) && !isNaN(h) && h > 0) {
                        const ratioValue = w / h;
                        const diff = Math.abs(actualRatio - ratioValue);
                        if (diff < minDiff) {
                          minDiff = diff;
                          bestMatch = ratio;
                        }
                      }
                    }
                  }
                  return bestMatch;
                };
                
                // 获取默认模型支持的比例列表
                const defaultModelId = imageModelOptions?.[0] || 'gpt-image-2';
                const defaultModelConfig = modelConfig?.[defaultModelId];
                const availableRatios = defaultModelConfig?.aspectRatios?.length 
                  ? defaultModelConfig.aspectRatios 
                  : ['1:1', '3:4', '4:3', '9:16', '16:9', '3:2', '2:3', '4:5', '5:4'];
                
                // 根据面板尺寸计算匹配的比例
                const matchedRatio = calculateMatchingRatio(panelWidth, panelHeight, availableRatios);
                
                const newPanelId = canvas.addElement({
                  type: 'generate-panel', name: '生成图片',
                  x: panelX, y: panelY, width: panelWidth, height: panelHeight,
                  originalWidth: panelWidth, originalHeight: panelHeight, rotation: 0, fill: '#18181b', stroke: '#3f3f46',
                  strokeWidth: 1, opacity: 1, visible: true, locked: false,
                  sourceIds: finalSourceIds, targetType: '图片',
                  panelType: 'image',
                  panelRatio: matchedRatio,
                  // #614 新面板置顶：确保面板和弹窗不被已有图片覆盖
                  zIndex: (canvas.state.elements.length > 0 ? Math.max(...canvas.state.elements.map(e => e.zIndex || 1)) : 0) + 1,
                });
                setActiveInputNodeId(newPanelId);
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                <span style={{ fontWeight: 500 }}>图片</span>
                <span style={{ fontSize: '11px', color: '#71717a' }}>AI图像生成</span>
              </div>
            </div>
            
            {/* 视频 */}
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 10px', borderRadius: '8px',
                cursor: 'pointer',
                color: '#e4e4e7',
                fontSize: '13px',
                transition: 'background-color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#3f3f46';
              }}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              onClick={() => {
                const { sourceId, canvasX, canvasY, sourceIds: menuSourceIds } = generateMenu;
                setGenerateMenu({ ...generateMenu, visible: false });
                // #610 Canvas 清除替代 SVG
                clearInteractionCanvas();
                const panelCanvasX = canvasX ?? 0;
                const panelCanvasY = canvasY ?? 0;
                const isMultiSelect = sourceId === '__multi_select__';
                // #664 多选拉线时，使用选中元素中最大尺寸的那个元素
                let sourceImage: { width: number; height: number } | undefined;
                if (isMultiSelect && menuSourceIds?.length) {
                  const selectedEls = menuSourceIds
                    .map(id => canvas.state.elements.find(e => e.id === id))
                    .filter(Boolean) as Array<{ width: number; height: number }>;
                  if (selectedEls.length > 0) {
                    selectedEls.sort((a, b) => (b.width * b.height) - (a.width * a.height));
                    sourceImage = { width: selectedEls[0].width, height: selectedEls[0].height };
                  }
                } else if (sourceId && sourceId !== '__multi_select__') {
                  sourceImage = canvas.state.elements.find(e => e.id === sourceId);
                }
                // #492 消灭亚像素渲染：尺寸取整
                const panelWidth = Math.round(sourceImage?.width || 284);
                const panelHeight = Math.round(sourceImage?.height || 160);
                // #492 消灭亚像素渲染：坐标取整
                const panelX = Math.round(panelCanvasX);
                const panelY = Math.round(panelCanvasY - panelHeight / 2);
                
                // 多选时使用所有选中元素的ID
                const finalSourceIds = isMultiSelect && menuSourceIds?.length
                  ? menuSourceIds
                  : (sourceId && sourceId !== '__multi_select__' ? [sourceId] : []);
                
                // 根据面板实际尺寸计算最匹配的标准比例（视频）
                const videoAspectRatios = ['1:1', '3:4', '4:3', '9:16', '16:9'];
                const actualVideoRatio = panelWidth / panelHeight;
                let matchedVideoRatio = '16:9';
                let minVideoDiff = Infinity;
                for (const ratio of videoAspectRatios) {
                  const parts = ratio.split(':');
                  if (parts.length === 2) {
                    const w = parseFloat(parts[0]);
                    const h = parseFloat(parts[1]);
                    if (!isNaN(w) && !isNaN(h) && h > 0) {
                      const ratioValue = w / h;
                      const diff = Math.abs(actualVideoRatio - ratioValue);
                      if (diff < minVideoDiff) {
                        minVideoDiff = diff;
                        matchedVideoRatio = ratio;
                      }
                    }
                  }
                }
                
                const newPanelId = canvas.addElement({
                  type: 'generate-panel', name: '生成视频',
                  x: panelX, y: panelY, width: panelWidth, height: panelHeight,
                  originalWidth: panelWidth, originalHeight: panelHeight, rotation: 0, fill: '#18181b', stroke: '#3f3f46',
                  strokeWidth: 1, opacity: 1, visible: true, locked: false,
                  sourceIds: finalSourceIds, targetType: '视频',
                  panelType: 'video',
                  videoDuration: 10,
                  videoAspectRatio: matchedVideoRatio,
                  videoSize: 'small',
                  // #614 新面板置顶：确保面板和弹窗不被已有图片覆盖
                  zIndex: (canvas.state.elements.length > 0 ? Math.max(...canvas.state.elements.map(e => e.zIndex || 1)) : 0) + 1,
                });
                setActiveInputNodeId(newPanelId);
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={generateMenu.sourceElementType === 'video' ? '#3f3f46' : '#a1a1aa'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                <span style={{ fontWeight: 500 }}>视频</span>
                <span style={{ fontSize: '11px', color: '#71717a' }}>AI视频生成</span>
              </div>
            </div>
            
            {/* #347 文本面板 - LLM */}
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 10px', borderRadius: '8px', cursor: 'pointer',
                color: '#e4e4e7', fontSize: '13px',
                transition: 'background-color 0.15s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#3f3f46'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              onClick={() => {
                const { sourceId, canvasX, canvasY, sourceIds: menuSourceIds } = generateMenu;
                setGenerateMenu({ ...generateMenu, visible: false });
                // #610 Canvas 清除替代 SVG
                clearInteractionCanvas();
                const panelCanvasX = canvasX ?? 0;
                const panelCanvasY = canvasY ?? 0;
                const isMultiSelect = sourceId === '__multi_select__';
                // 多选时使用所有选中元素的ID
                const finalSourceIds = isMultiSelect && menuSourceIds?.length
                  ? menuSourceIds
                  : (sourceId && sourceId !== '__multi_select__' ? [sourceId] : []);
                // #352 文本面板固定 16:9 比例（800x480）
                const panelWidth = 800;
                const panelHeight = 480;
                // #492 消灭亚像素渲染：坐标取整
                const panelX = Math.round(panelCanvasX);
                const panelY = Math.round(panelCanvasY - panelHeight / 2);
                const newPanelId = canvas.addElement({
                  type: 'generate-panel', name: '文本生成',
                  x: panelX, y: panelY, width: panelWidth, height: panelHeight,
                  originalWidth: panelWidth, originalHeight: panelHeight, rotation: 0, fill: '#18181b', stroke: '#3f3f46',
                  strokeWidth: 1, opacity: 1, visible: true, locked: false,
                  sourceIds: finalSourceIds, targetType: '文本',
                  panelType: 'text',
                  panelPrompt: '根据图片生成风格提示词',
                  // #614 新面板置顶：确保面板和弹窗不被已有图片覆盖
                  zIndex: (canvas.state.elements.length > 0 ? Math.max(...canvas.state.elements.map(e => e.zIndex || 1)) : 0) + 1,
                });
                setActiveInputNodeId(newPanelId);
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
              </svg>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                <span style={{ fontWeight: 500 }}>文本</span>
                <span style={{ fontSize: '11px', color: '#71717a' }}>LLM语言模型</span>
              </div>
            </div>
          </div>
        )}
        
        {/* 框选矩形 - 固定边框，不受缩放影响 */}
        {isSelecting && selectionRect && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(selectionRect.startX, selectionRect.endX) * zoom + pan.x,
              top: Math.min(selectionRect.startY, selectionRect.endY) * zoom + pan.y,
              width: Math.abs(selectionRect.endX - selectionRect.startX) * zoom,
              height: Math.abs(selectionRect.endY - selectionRect.startY) * zoom,
              border: '1px dashed #3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              pointerEvents: 'none',
              zIndex: 25
            }}
          />
        )}
        
        {/* 形状工具栏 - 选中的是形状时显示在上方 */}
        {!isDragging && !isCropping && !isGridSelectMode && canvas.state.selectedIds.length === 1 && (() => {
          const el = canvas.state.elements.find(e => e.id === canvas.state.selectedIds[0]);
          if (!el || !el.visible) return null;
          // 只对形状类型显示工具栏
          if (!['rectangle', 'ellipse', 'path'].includes(el.type)) return null;
          
          const containerRect = containerRef.current?.getBoundingClientRect();
          const screenX = el.x * zoom + pan.x + (containerRect?.left || 0);
          const screenY = el.y * zoom + pan.y + (containerRect?.top || 0);
          const screenW = el.width * zoom;
          
          return (
            <div 
              key={`shape-toolbar-${el.id}`}
              data-toolbar="true"
              className="absolute flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 px-3 py-2 z-[100] whitespace-nowrap"
              style={{
                left: screenX,
                top: Math.max(10, screenY - 50),
                pointerEvents: 'auto',
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* 宽高显示 */}
              <div className="flex items-center gap-1">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400">W</span>
                  <input
                    type="number"
                    min="1"
                    value={Math.round(el.width)}
                    onChange={(e) => {
                      const newWidth = Math.max(1, Number(e.target.value));
                      canvas.updateElement(el.id, { width: newWidth });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-14 pl-1 pr-0.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-center"
                  />
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!aspectRatioLocked) {
                      aspectRatioRef.current = el.width > 0 ? el.height / el.width : null;
                    }
                    setAspectRatioLocked(!aspectRatioLocked);
                  }}
                  className={`w-5 h-5 flex items-center justify-center rounded ${aspectRatioLocked ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300' : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400'}`}
                  title={aspectRatioLocked ? '解锁宽高比例' : '锁定宽高比例'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {aspectRatioLocked ? (
                      <>
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                      </>
                    ) : (
                      <>
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                      </>
                    )}
                  </svg>
                </button>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400">H</span>
                  <input
                    type="number"
                    min="1"
                    value={Math.round(el.height)}
                    onChange={(e) => {
                      const newHeight = Math.max(1, Number(e.target.value));
                      canvas.updateElement(el.id, { height: newHeight });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-14 pl-1 pr-0.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-center"
                  />
                </div>
              </div>
              
              {/* 分隔线 */}
              <div className="w-px h-5 bg-gray-200 dark:bg-gray-600" />
              
              {/* 填充颜色 */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">填充</span>
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShapeToolbarPanel(shapeToolbarPanel === 'fill' ? null : 'fill');
                    }}
                    className="w-6 h-6 rounded border-2 border-gray-300 hover:border-blue-400 transition-all"
                    style={{ backgroundColor: el.fill && el.fill !== 'transparent' ? el.fill : '#ffffff' }}
                    title="填充颜色"
                  />
                  {shapeToolbarPanel === 'fill' && (
                    <div 
                      className="absolute top-full left-0 mt-1 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 z-50 w-[200px]"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {/* 渐变色彩预览区 */}
                      <div 
                        className="w-full h-24 rounded-lg cursor-crosshair relative mb-2 overflow-hidden"
                        style={{
                          background: `linear-gradient(to bottom, transparent, #000), 
                                       linear-gradient(to right, #fff, ${shapeToolbarHueColor})`
                        }}
                        onMouseDown={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const handleMove = (moveEvent: MouseEvent) => {
                            const x = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
                            const y = Math.max(0, Math.min(1, (moveEvent.clientY - rect.top) / rect.height));
                            const sat = Math.round(x * 100);
                            const bri = Math.round((1 - y) * 100);
                            const newColor = hsbToHex(shapeToolbarHue, sat, bri);
                            canvas.updateElement(el.id, { fill: newColor });
                          };
                          handleMove(e.nativeEvent as MouseEvent);
                          const handleUp = () => {
                            document.removeEventListener('mousemove', handleMove as any);
                            document.removeEventListener('mouseup', handleUp);
                          };
                          document.addEventListener('mousemove', handleMove as any);
                          document.addEventListener('mouseup', handleUp);
                        }}
                      />
                      {/* 色相条 */}
                      <div 
                        className="w-full h-2 rounded-lg cursor-pointer mb-2"
                        style={{ background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' }}
                        onMouseDown={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const handleMove = (moveEvent: MouseEvent) => {
                            const x = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
                            setShapeToolbarHue(Math.round(x * 360));
                          };
                          handleMove(e.nativeEvent as MouseEvent);
                          const handleUp = () => {
                            document.removeEventListener('mousemove', handleMove as any);
                            document.removeEventListener('mouseup', handleUp);
                          };
                          document.addEventListener('mousemove', handleMove as any);
                          document.addEventListener('mouseup', handleUp);
                        }}
                      />
                      {/* 预设颜色 */}
                      <div className="flex gap-1 flex-wrap">
                        {['#ffffff', '#000000', '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', 'transparent'].map((color) => (
                          <button
                            key={color}
                            onClick={(e) => {
                              e.stopPropagation();
                              canvas.updateElement(el.id, { fill: color });
                            }}
                            className={`w-5 h-5 rounded border-2 ${
                              color === 'transparent' ? 'bg-white relative overflow-hidden' : ''
                            } ${
                              color === '#ffffff' ? 'bg-white' : ''
                            } ${
                              el.fill === color ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-300'
                            }`}
                            style={color !== 'transparent' && color !== '#ffffff' ? { backgroundColor: color } : {}}
                          >
                            {color === 'transparent' && (
                              <>
                                <div className="absolute inset-0 bg-gray-200" style={{ clipPath: 'polygon(0 0, 100% 100%, 0 100%)' }}></div>
                                <div className="absolute inset-0 bg-white" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }}></div>
                                <svg width="100%" height="100%" viewBox="0 0 20 20" className="absolute inset-0">
                                  <line x1="2" y1="18" x2="18" y2="2" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                              </>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* 分隔线 */}
              <div className="w-px h-5 bg-gray-200 dark:bg-gray-600" />
              
              {/* 描边颜色 */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">描边</span>
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShapeToolbarPanel(shapeToolbarPanel === 'stroke' ? null : 'stroke');
                    }}
                    className="w-6 h-6 rounded border-2 border-gray-300 hover:border-blue-400 transition-all flex items-center justify-center"
                    style={{ backgroundColor: el.stroke && el.stroke !== 'transparent' ? el.stroke : '#ffffff' }}
                    title="描边颜色"
                  >
                    {(!el.stroke || el.stroke === 'transparent') && (
                      <svg width="12" height="12" viewBox="0 0 20 20">
                        <line x1="0" y1="20" x2="20" y2="0" stroke="#ef4444" strokeWidth="2"/>
                      </svg>
                    )}
                  </button>
                  {shapeToolbarPanel === 'stroke' && (
                    <div 
                      className="absolute top-full left-0 mt-1 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 z-50 w-[200px]"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {/* 渐变色彩预览区 */}
                      <div 
                        className="w-full h-24 rounded-lg cursor-crosshair relative mb-2 overflow-hidden"
                        style={{
                          background: `linear-gradient(to bottom, transparent, #000), 
                                       linear-gradient(to right, #fff, ${shapeToolbarHueColor})`
                        }}
                        onMouseDown={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const handleMove = (moveEvent: MouseEvent) => {
                            const x = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
                            const y = Math.max(0, Math.min(1, (moveEvent.clientY - rect.top) / rect.height));
                            const sat = Math.round(x * 100);
                            const bri = Math.round((1 - y) * 100);
                            const newColor = hsbToHex(shapeToolbarHue, sat, bri);
                            canvas.updateElement(el.id, { stroke: newColor, strokeWidth: el.strokeWidth || 2 });
                          };
                          handleMove(e.nativeEvent as MouseEvent);
                          const handleUp = () => {
                            document.removeEventListener('mousemove', handleMove as any);
                            document.removeEventListener('mouseup', handleUp);
                          };
                          document.addEventListener('mousemove', handleMove as any);
                          document.addEventListener('mouseup', handleUp);
                        }}
                      />
                      {/* 色相条 */}
                      <div 
                        className="w-full h-2 rounded-lg cursor-pointer mb-2"
                        style={{ background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' }}
                        onMouseDown={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const handleMove = (moveEvent: MouseEvent) => {
                            const x = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
                            setShapeToolbarHue(Math.round(x * 360));
                          };
                          handleMove(e.nativeEvent as MouseEvent);
                          const handleUp = () => {
                            document.removeEventListener('mousemove', handleMove as any);
                            document.removeEventListener('mouseup', handleUp);
                          };
                          document.addEventListener('mousemove', handleMove as any);
                          document.addEventListener('mouseup', handleUp);
                        }}
                      />
                      {/* 预设颜色 */}
                      <div className="flex gap-1 flex-wrap">
                        {['#ffffff', '#000000', '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', 'transparent'].map((color) => (
                          <button
                            key={color}
                            onClick={(e) => {
                              e.stopPropagation();
                              canvas.updateElement(el.id, { 
                                stroke: color, 
                                strokeWidth: color === 'transparent' ? 0 : (el.strokeWidth || 2)
                              });
                            }}
                            className={`w-5 h-5 rounded border-2 ${
                              color === 'transparent' ? 'bg-white relative overflow-hidden' : ''
                            } ${
                              color === '#ffffff' ? 'bg-white' : ''
                            } ${
                              el.stroke === color ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-300'
                            }`}
                            style={color !== 'transparent' && color !== '#ffffff' ? { backgroundColor: color } : {}}
                          >
                            {color === 'transparent' && (
                              <>
                                <div className="absolute inset-0 bg-gray-200" style={{ clipPath: 'polygon(0 0, 100% 100%, 0 100%)' }}></div>
                                <div className="absolute inset-0 bg-white" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }}></div>
                                <svg width="100%" height="100%" viewBox="0 0 20 20" className="absolute inset-0">
                                  <line x1="2" y1="18" x2="18" y2="2" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                              </>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* 描边粗细 */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">粗细</span>
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={el.strokeWidth || 0}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(20, Number(e.target.value)));
                    canvas.updateElement(el.id, { strokeWidth: val });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-12 px-1.5 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
                />
              </div>
              
              {/* 分隔线 */}
              <div className="w-px h-5 bg-gray-200 dark:bg-gray-600" />
              
            </div>
          );
        })()}
        
        
        {/* 选中状态覆盖层 - 固定大小，不受缩放影响。拖动时保持显示。裁剪模式下隐藏。双击选择模式下隐藏 */}
        {/* #591 终极修复：使用 React.Fragment 包裹，为 null 返回值提供稳定 key */}
        {!isCropping && !isGridSelectMode && canvas.state.selectedIds.map(id => {
          const el = canvas.state.elements.find(e => e.id === id);
          
          // #591 终极修复：不返回 null，而是返回空的 React.Fragment，保持 DOM 结构稳定
          // 检查元素是否存在、可见、不是文字元素、不是多选状态
          const shouldRender = el && el.visible && el.type !== 'text' && canvas.state.selectedIds.length <= 1;
          
          if (!shouldRender) {
            return <React.Fragment key={`selection-placeholder-${id}`} />;
          }
          
          // 计算屏幕坐标
          const screenX = el.x * zoom + pan.x;
          const screenY = el.y * zoom + pan.y;
          const screenW = el.width * zoom;
          const screenH = el.height * zoom;
          
          // 根据缩放比例动态调整边框宽度
          const scaledBorderWidth = Math.max(1, Math.round(2 * zoom));
          
          return (
            <div
              key={`selection-${id}`}
              style={{
                position: 'absolute',
                left: screenX,
                top: screenY,
                width: screenW,
                height: screenH,
                pointerEvents: 'none',
              }}
            >
              {/* 选中边框 */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: '100%',
                  border: `${scaledBorderWidth}px solid ${effectiveTheme === 'dark' ? '#ffffff' : '#000000'}`,
                  backgroundColor: 'transparent',
                  borderRadius: '3%',
                  pointerEvents: 'none',
                  zIndex: 250  // #599 选中框层级（低于右键菜单，高于所有元素）
                }}
              />
              
              {/* 四角触发区域 - 独立渲染，不受父元素 pointerEvents 影响 */}
              {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((corner) => {
                // 计算触发区域的相对位置（相对于外层 div）
                const handleLeft = corner.includes('left') ? -10 : corner.includes('right') ? screenW - 10 : 0;
                const handleTop = corner.includes('top') ? -10 : corner.includes('bottom') ? screenH - 10 : 0;
                
                // 与单图四角一致：nw/se 用 nwse-resize，ne/sw 用 nesw-resize
                const cursor = (corner === 'top-left' || corner === 'bottom-right') ? 'nwse-resize' : 'nesw-resize';
                
                // #597 修复：面板比例锁定优先级最高
                // #军师方案：文本面板不锁定宽高比，自由拉伸！
                // 1. 文本面板 → 不锁定（undefined）
                // 2. 面板且有 panelRatio → 使用 panelRatio（最优先）
                // 3. 形状工具栏锁定宽高比 → 使用 aspectRatioRef 或当前比例
                // 4. 裁剪图片 → 使用当前比例
                // 5. 其他 → 使用 el.aspectRatio
                let lockAspectRatio: number | undefined;
                
                // #军师方案：文本面板永远不锁定宽高比！
                const isTextPanel = el.type === 'generate-panel' && el.panelType === 'text';
                
                if (isTextPanel) {
                  // 文本面板：不锁定，保持 undefined
                  lockAspectRatio = undefined;
                }
                // #597 面板优先：如果面板有 panelRatio，始终使用它
                else if (el.type === 'generate-panel' && el.panelRatio) {
                  const ratioParts = el.panelRatio.split(':');
                  if (ratioParts.length === 2) {
                    const w = parseFloat(ratioParts[0]);
                    const h = parseFloat(ratioParts[1]);
                    if (w > 0 && h > 0) {
                      lockAspectRatio = w / h;
                    }
                  }
                }
                // 如果不是面板或没有 panelRatio，再检查其他条件
                else if (aspectRatioLocked) {
                  if (aspectRatioRef.current !== null) {
                    lockAspectRatio = 1 / aspectRatioRef.current;
                  } else {
                    lockAspectRatio = el.width / el.height;
                  }
                } else if (el.isCropped) {
                  lockAspectRatio = el.width / el.height;
                } else {
                  lockAspectRatio = el.aspectRatio;
                }
                
                // #597 诊断日志
                if (el.type === 'generate-panel') {
                }
                
                return (
                  <div
                    key={corner}
                    data-resize-handle={corner}  // 标识为缩放手柄，用于 CSS 光标覆盖
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      
                      let startW = el.width || 50;
                      let startH = el.height || (el.fontSize || 24) * 1.4 + 8;
                      let startFontSize: number | undefined;
                      if (el.type === 'text') {
                        startFontSize = el.fontSize || 24;
                        startW = el.width || 50;
                        startH = el.height || startFontSize * 1.4 + 8;
                      }
                      
                      setResizing({ 
                        id: el.id, 
                        corner, 
                        startX: e.clientX, 
                        startY: e.clientY, 
                        startW: startW, 
                        startH: startH, 
                        startElX: el.x, 
                        startElY: el.y,
                        aspectRatio: el.type === 'text' ? 1 : lockAspectRatio,
                        startFontSize: startFontSize
                      });
                    }}
                    style={{
                      position: 'absolute',
                      left: handleLeft,
                      top: handleTop,
                      width: 20,
                      height: 20,
                      cursor: cursor,
                      pointerEvents: 'auto',
                      zIndex: 30
                    }}
                  />
                );
              })}
            </div>
          );
        })}
        
        {/* #299 新增：选中框整体缩放 - 多选时显示大框架，单选时由元素边框处理 */}
        {isMounted && selectionBox && canvas.state.selectedIds.length > 1 && !isCropping && (
          <div
            style={{
              position: 'absolute',
              left: selectionBox.x * zoom + pan.x,
              top: selectionBox.y * zoom + pan.y,
              width: selectionBox.width * zoom,
              height: selectionBox.height * zoom,
              border: '2px dashed #888',
              borderRadius: '3%',
              pointerEvents: 'none',
              zIndex: 250,
            }}
          >
            {/* 四角拉伸触发区域 - 隐藏圆点，保留拉伸功能，光标与单图一致 */}
            {/* #579 修复：添加 zIndex 确保不被遮挡 */}
            {['nw', 'ne', 'sw', 'se'].map(corner => {
              const isLeft = corner.includes('w');
              const isTop = corner.includes('n');
              // 与单图四角一致：nw/se 用 nwse-resize，ne/sw 用 nesw-resize
              const cursor = (corner === 'nw' || corner === 'se') ? 'nwse-resize' : 'nesw-resize';
              return (
                <div
                  key={corner}
                  style={{
                    position: 'absolute',
                    left: isLeft ? -10 : 'auto',
                    right: isLeft ? 'auto' : -10,
                    top: isTop ? -10 : 'auto',
                    bottom: isTop ? 'auto' : -10,
                    width: 20,
                    height: 20,
                    cursor: cursor,
                    pointerEvents: 'auto',
                    zIndex: 30,
                  }}
                  onMouseDown={(e) => handleSelectionResizeStart(e, corner)}
                />
              );
            })}
            {/* 多选磁吸加号按钮 - 在选中框右边缘中心 */}
            {(() => {
              // #614 #569 规范：最小边 * 0.05，与单图/面板一致
              // 注意：selectionBox 包含 PADDING=30，需要减去得到实际内容尺寸
              const PADDING = 30;
              const contentWidth = Math.max(1, selectionBox.width - PADDING * 2);
              const contentHeight = Math.max(1, selectionBox.height - PADDING * 2);
              const avgSize = Math.min(contentWidth, contentHeight);
              const buttonSize = avgSize * 0.05;
              // 单图加号的 containerSize = buttonSize + 15（画布坐标），然后被父容器 scale(zoom) 缩放
              // 多选加号的父容器 width 已经是 selectionBox.width * zoom（屏幕坐标）
              // 所以多选加号也需要：containerSize = (buttonSize + 15) * zoom（屏幕坐标）
              const containerSize = (buttonSize + 15) * zoom;
              const iconSize = Math.round(buttonSize * 0.6 * zoom);
              // 获取所有选中的图片/面板元素
              const selectedImageIds = canvas.state.selectedIds.filter(id => {
                const el = canvas.state.elements.find(e => e.id === id);
                return el && (el.type === 'image' || el.type === 'generate-panel' || el.type === 'image-stack' || el.type === 'video');
              });
              // 只有当选中元素包含图片/面板/视频时才显示加号
              if (selectedImageIds.length === 0) return null;
              
              // #593 对齐单图加号：用 opacity 控制 hover 显示（与单图加号一致）
              // 单图加号：opacity: hoveredElementIdRef.current === el.id ? 1 : 0
              // 多选加号：opacity: isHoveringSelected ? 1 : 0
              const isHoveringSelected = selectedImageIds.some(id => hoveredElementIdRef.current === id);
              
              // #593 对齐单图加号：检查选中元素的状态，只要有任意一个处于生成中/加载中/失败/过期状态，就不显示加号
              const hasInvalidState = selectedImageIds.some(id => {
                const el = canvas.state.elements.find(e => e.id === id);
                if (!el) return true;
                const isGenerating = el.generationStatus === 'generating' || el.generationStatus === 'recovering' || el.generationStatus === 'submitted';
                const isLoading = el.isLoading === true;
                const isFailed = el.generationStatus === 'failed';
                const isExpired = el.generationStatus === 'expired';
                return isGenerating || isLoading || isFailed || isExpired;
              });
              return (
                <div
                  className="node-connection-port-hitbox multi-select-magnet-wrapper"
                  style={{
                    position: 'absolute',
                    // #593 距离：单图加号的8px被scale(zoom)缩放 → 8*zoom
                    // 选中框border在容器外面(content-box)，calc(100%)从内部边缘开始
                    // 所以需要 +2 补偿右边border，X - 2 = 8*zoom → X = 8*zoom + 2
                    left: `calc(100% + ${Math.max(0, Math.round(8 * zoom + 2))}px)`,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: `${containerSize}px`,
                    height: `${containerSize}px`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    // #593 对齐单图加号：用 opacity 控制 hover 显示
                    opacity: isHoveringSelected && !hasInvalidState ? 1 : 0,
                    // #595 关键修复：多选框加号必须始终 pointerEvents: 'auto'
                    // 否则鼠标离开选中元素后 pointerEvents: 'none' 导致无法点击
                    pointerEvents: 'auto',
                    zIndex: 250,
                    // #模糊修复 终极手术：删除 GPU 辐射源！
                    // ❌ 删除 willChange：在 scale 容器内会触发 CPU 图片重栅格化
                    // ✅ 多选加号回归纯 2D 渲染，彻底根除混合合成陷阱！
                  }}
                >
                  <div
                    id="magnet-btn-multi-select"
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'transform 0.08s ease-out',
                    }}
                  >
                    {/* 👑 3. 核心内层视觉实体：必须是 auto，所有事件绑在这里！ */}
                    {/* #593 完全对齐单图加号样式 */}
                    <div
                      style={{
                        width: buttonSize * zoom,
                        height: buttonSize * zoom,
                        // #593 对齐单图加号：hover 时显示渐变背景，否则透明
                        background: isHoveringSelected
                          ? (theme === 'dark'
                              ? 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)'
                              : 'linear-gradient(135deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.05) 100%)')
                          : 'transparent',
                        // #593 border 宽度随 zoom 缩放，与单图加号被 scale 缩放效果一致
                        border: theme === 'dark' ? `${Math.max(1, 2 * zoom)}px solid rgba(255,255,255,0.7)` : `${Math.max(1, 2 * zoom)}px solid rgba(0,0,0,0.7)`,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        // #593 对齐单图加号：hover 时显示阴影，否则淡阴影
                        boxShadow: isHoveringSelected
                          ? (theme === 'dark' ? `0 ${Math.max(1, 2 * zoom)}px ${Math.max(4, 8 * zoom)}px rgba(255,255,255,0.15)` : `0 ${Math.max(1, 2 * zoom)}px ${Math.max(4, 8 * zoom)}px rgba(0,0,0,0.2)`)
                          : (theme === 'dark' ? `0 ${Math.max(1, 1 * zoom)}px ${Math.max(3, 3 * zoom)}px rgba(255,255,255,0.1)` : `0 ${Math.max(1, 1 * zoom)}px ${Math.max(3, 3 * zoom)}px rgba(0,0,0,0.15)`),
                        // 对齐单图加号：始终 scale(1.1)
                        transform: 'scale(1.1)',
                        transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                        pointerEvents: 'auto',
                        cursor: 'crosshair',
                      }}
                      onMouseDown={(e) => { e.stopPropagation(); }} // #575 阻止 mousedown 冒泡到 handleMouseDown 清理连接状态
                      onPointerDown={(e) => {
                        e.stopPropagation(); // 阻止画布拖拽
                        
                        // 平移模式下不触发拉线
                        if (activeToolRef.current === 'hand') return;
                        
                        // 👑 1. 纯 Ref 物理清理：没有任何重绘开销
                        if (draftLineRef.current.active) {
                          draftLineRef.current = { active: false, sourceId: null, sourceType: null, startX: 0, startY: 0, snapTargetId: null, snapPortX: 0, snapPortY: 0 };
                          // #610 Canvas 清除替代 SVG
                          clearInteractionCanvas();
                        }
                        
                        // 👑 2. 状态夺权：彻底抛弃 React State，用 Ref 接管连线核心逻辑！
                        isConnectionActiveGlobalRef.current = true;
                        
                        // ❌ 删掉：setIsConnectionActive(true);
                        // ❌ 删掉：setConnectionDraftSourceId('__multi_select__');
                        
                        // 👑 3. UI 状态降级：放入 startTransition 低优先级队列
                        startTransition(() => {
                          // 关菜单
                          if (generateMenu.visible) {
                            setGenerateMenu(prev => ({ ...prev, visible: false }));
                          }
                          // 取消面板激活
                          if (activeInputNodeId) {
                            setActiveInputNodeId(null);
                          }
                          // #613 修复：多选拉线时不清除 selectedIds！
                          // mouseUp 时需要 selectedIds 来知道哪些图片要连接到面板
                          // 清空操作移到 handleMouseUp 连接完成后执行
                        });
                        
                        // 记录拖拽起始状态 - 连线起点为选中框右边缘中心
                        const rect = containerRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        
                        // 👑 #579 对齐单图：连线起点 = 选中框右边缘中心（画布坐标）
                        // 不再读取 transform 偏移，直接使用基准位置
                        const startX = selectionBox.x + selectionBox.width;
                        const startY = selectionBox.y + selectionBox.height / 2;
                        
                        // 👑 直接启动连线！和单图加号一样直接设置 draftLineRef.current.active = true
                        // 这样全局 handleMouseMove 就能接管磁吸检测和线条绘制
                        draftLineRef.current = {
                          active: true,
                          sourceId: '__multi_select__',
                          sourceType: 'multi-select',
                          startX,
                          startY,
                          snapTargetId: null,
                          snapPortX: 0,
                          snapPortY: 0,
                        };
                        // #610 Canvas 层无需 display 切换（fixed 始终存在）
                        
                        // 🔧 #575 清除磁吸高亮状态，避免残留（与单图加号行为一致，见 #438）
                        // #60fps Phase1: 纯 DOM 操作
                        updateCanvasVisualState({ snapTargetId: null });
                        
                        connectionDragStartRef.current = {
                          x: e.clientX - rect.left,
                          y: e.clientY - rect.top,
                          sourceId: '__multi_select__',
                          sourceType: 'multi-select',
                          startX,
                          startY,
                        };
                        connectionDragTriggeredRef.current = true; // 直接标记为已触发，因为 draftLineRef 已经 active
                        
                        // 👑 #579 对齐单图：使用 setPointerCapture 确保事件能正确传递
                        (e.target as HTMLElement).setPointerCapture(e.pointerId);
                      }}
                      onPointerMove={(e) => {
                        // #579 对齐单图：如果已经启动连线，更新线条位置
                        if (!connectionDragStartRef.current || !draftLineRef.current.active) return;
                        
                        const rect = containerRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;
                        
                        // 将鼠标屏幕坐标转换为画布坐标
                        const endCanvasX = (x - pan.x) / zoom;
                        const endCanvasY = (y - pan.y) / zoom;
                        
                        // #610 终结手术：Canvas 替代 SVG 绘制
                        // #612 Canvas fixed 需要视口坐标 = 容器内坐标 + rect.left/top
                        const startScreenX = draftLineRef.current.startX * zoom + pan.x + rect.left;
                        const startScreenY = draftLineRef.current.startY * zoom + pan.y + rect.top;
                        const endScreenX = endCanvasX * zoom + pan.x + rect.left;
                        const endScreenY = endCanvasY * zoom + pan.y + rect.top;
                        drawDraftLine(
                          startScreenX, startScreenY,
                          endScreenX, endScreenY,
                          draftLineRef.current.startX, draftLineRef.current.startY,
                          endCanvasX, endCanvasY,
                          zoom, pan.x + rect.left, pan.y + rect.top
                        );
                      }}
                      onPointerUp={(e) => {
                        // 释放指针捕获
                        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
                        
                        // #861 修复：多选拉线弹窗不出现 - 根因与 #841→#850 单图加号相同
                        // #841→#850 修复：与单图加号同理，只在未触发拖拽时清除 ref
                        if (!connectionDragTriggeredRef.current && draftLineRef.current.active) {
                          draftLineRef.current = { active: false, sourceId: null, sourceType: null, startX: 0, startY: 0, snapTargetId: null, snapPortX: 0, snapPortY: 0 };
                          clearInteractionCanvas();
                          // #60fps Phase1: 纯 ref + DOM 操作
                          isConnectionActiveGlobalRef.current = false;
                          resetConnectionVisualState();
                        }
                        
                        // 清理拖拽状态
                        connectionDragStartRef.current = null;
                        connectionDragTriggeredRef.current = false;
                      }}
                      onPointerCancel={(e) => {
                        // 释放指针捕获
                        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
                        
                        // #861 修复：与 onPointerUp 同理，只在未触发拖拽时清除 ref
                        if (!connectionDragTriggeredRef.current && draftLineRef.current.active) {
                          draftLineRef.current = { active: false, sourceId: null, sourceType: null, startX: 0, startY: 0, snapTargetId: null, snapPortX: 0, snapPortY: 0 };
                          clearInteractionCanvas();
                          // #60fps Phase1: 纯 ref + DOM 操作
                          isConnectionActiveGlobalRef.current = false;
                          resetConnectionVisualState();
                        }
                        
                        // 清理拖拽状态
                        connectionDragStartRef.current = null;
                        connectionDragTriggeredRef.current = false;
                        // #60fps Phase1: 纯 ref + DOM 操作
                        isConnectionActiveGlobalRef.current = false;
                        resetConnectionVisualState();
                      }}
                    >
                      {/* SVG 图标保持 none，防止误触导致 event.target 判断错误 */}
                      {/* #579 对齐单图：使用相同的 SVG 样式 */}
                      <svg style={{ pointerEvents: 'none' }} width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke={theme === 'dark' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 5v14M5 12h14"/>
                      </svg>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
        
        {/* 智能对齐线 - 拖动或调整大小时显示 */}
        {(isDragging || resizing || isPanelDragging) && (
          <>
            {/* 垂直对齐线 */}
            {alignLines.vertical.map((line, index) => (
              <div
                key={`v-${index}`}
                style={{
                  position: 'absolute',
                  left: line.x * zoom + pan.x,
                  top: line.y1 * zoom + pan.y,
                  width: 1,
                  height: (line.y2 - line.y1) * zoom,
                  backgroundColor: '#FF4D4F',
                  pointerEvents: 'none',
                  zIndex: 300
                }}
              />
            ))}
            {/* 水平对齐线 */}
            {alignLines.horizontal.map((line, index) => (
              <div
                key={`h-${index}`}
                style={{
                  position: 'absolute',
                  left: line.x1 * zoom + pan.x,
                  top: line.y * zoom + pan.y,
                  width: (line.x2 - line.x1) * zoom,
                  height: 1,
                  backgroundColor: '#FF4D4F',
                  pointerEvents: 'none',
                  zIndex: 300
                }}
              />
            ))}
          </>
        )}
      </div>
      
      {/* 图片工具栏 - 在画布容器外面，使用 fixed 定位 */}
      {/* 双击选择模式下的鼠标跟随提示 */}
      {isGridSelectMode && gridSelectMousePos && (
        <div 
          className="absolute pointer-events-none z-[9999] flex items-center gap-1"
          style={{ 
            left: gridSelectMousePos.x + 16, 
            top: gridSelectMousePos.y + 16,
          }}
        >
          <div className="bg-green-500 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
            双击添加
          </div>
        </div>
      )}
      {(() => {
        // #417 找到所有选中的图片元素（包含有图的面板和堆叠）
        // #572 修复：对于 image 类型，只要有 imageUrl 或 imageKey 就通过；对于面板/堆叠/视频需要有内容
        const selectedImages = canvas.state.elements.filter(
          el => {
            // 基础条件：类型匹配 + 选中 + 可见
            if (!(el.type === 'image' || el.type === 'generate-panel' || el.type === 'image-stack' || el.type === 'video')) return false;
            if (!canvas.state.selectedIds.includes(el.id)) return false;
            if (!el.visible) return false;
            
            // #572 根据类型检查内容
            if (el.type === 'image') {
              // 图片类型：只要有 imageUrl 或 imageKey 就通过
              return (el as any).imageUrl || (el as any).imageKey;
            } else if (el.type === 'video') {
              // 视频类型：需要有 videoUrl
              return (el as any).videoUrl;
            } else {
              // generate-panel 和 image-stack：需要有 imageUrl 或 imageUrls 或 providerUrls
              return (el as any).imageUrl || 
                     ((el as any).imageUrls && (el as any).imageUrls.length > 0) ||
                     ((el as any).providerUrls && (el as any).providerUrls.length > 0);
            }
          }
        );
        
        // 👑 #588 终极架构重构：结构绝对稳定
        // 将会导致"整棵树被物理销毁"的拦截，转化为"只渲染空壳"
        // 保持 Fiber 节点在树中的位置不变，彻底根除 insertBefore 错误
        const isVisible = !isGridSelectMode && 
                          selectedImages.length > 0 && 
                          !!containerRef.current?.getBoundingClientRect();
        
        // 👑 #588 声明变量来挂载所有工具栏内容，确保只有一个 return 出口
        let multiSelectToolbarContent: React.ReactNode = null;
        let toolbarContent: React.ReactNode = null;
        let textInfoContent: React.ReactNode = null;
        
        if (isVisible && canvas.state.selectedIds.length > 1) {
          // 多选图片时显示功能按钮工具栏
          // #588 安全获取容器尺寸
          const containerRect = containerRef.current?.getBoundingClientRect();
          
          // #593 修复：使用 selectionBox 计算工具栏位置，与选中框对齐
          // selectionBox 包含所有选中元素，比 selectedImages 更准确
          const selectionScreenX = selectionBox!.x * zoom + pan.x;
          const selectionScreenY = selectionBox!.y * zoom + pan.y;
          const selectionScreenWidth = selectionBox!.width * zoom;
          const selectionScreenHeight = selectionBox!.height * zoom;
          
          const minX = selectionScreenX;
          const maxX = selectionScreenX + selectionScreenWidth;
          const minY = selectionScreenY;
          const maxY = selectionScreenY + selectionScreenHeight;
          
          const centerX = (minX + maxX) / 2;
          const toolbarY = minY - 16; // 👑 增加间距到 16px
          
          // 水平排列 - 所有元素水平排成一行，顶部对齐
          const handleHorizontalAlign = () => {
            const selectedElements = canvas.state.elements.filter(
              el => canvas.state.selectedIds.includes(el.id) && el.visible
            );
            if (selectedElements.length < 2) return;
            
            // 按x坐标排序
            const sorted = [...selectedElements].sort((a, b) => a.x - b.x);
            
            // 顶部对齐（取最顶部的y坐标）
            const topmost = Math.min(...sorted.map(el => el.y));
            
            // 间距（屏幕坐标转换为画布坐标）
            const gap = 20 / zoom;
            
            // 从当前最左侧开始排列
            const leftmost = sorted[0].x;
            
            const batchUpdates: Array<{ id: string; updates: Partial<CanvasElement> }> = [];
            let currentX = leftmost;
            
            sorted.forEach((el, index) => {
              batchUpdates.push({
                id: el.id,
                updates: {
                  x: currentX,
                  y: topmost  // 顶部对齐
                }
              });
              // 下一个元素位置 = 当前元素位置 + 当前元素宽度 + 间距
              currentX = currentX + el.width + gap;
            });
            canvas.updateElementsBatch(batchUpdates);
          };
          
          // 垂直排列 - 所有元素垂直排成一列，左边对齐
          const handleVerticalAlign = () => {
            const selectedElements = canvas.state.elements.filter(
              el => canvas.state.selectedIds.includes(el.id) && el.visible
            );
            if (selectedElements.length < 2) return;
            
            // 按y坐标排序
            const sorted = [...selectedElements].sort((a, b) => a.y - b.y);
            
            // 左边对齐（取最左侧的x坐标）
            const leftmost = Math.min(...sorted.map(el => el.x));
            
            // 间距（屏幕坐标转换为画布坐标）
            const gap = 20 / zoom;
            
            // 从当前最顶部开始排列
            const topmost = sorted[0].y;
            
            const batchUpdates: Array<{ id: string; updates: Partial<CanvasElement> }> = [];
            let currentY = topmost;
            
            sorted.forEach((el) => {
              batchUpdates.push({
                id: el.id,
                updates: {
                  x: leftmost,  // 左边对齐
                  y: currentY
                }
              });
              currentY = currentY + el.height + gap;
            });
            canvas.updateElementsBatch(batchUpdates);
          };
          
          // 宫格排列 - 按网格排列，自动计算行列数
          const handleGridAlign = () => {
            const selectedElements = canvas.state.elements.filter(
              el => canvas.state.selectedIds.includes(el.id) && el.visible
            );
            if (selectedElements.length < 2) return;
            
            // 计算列数（平方根向上取整）
            const count = selectedElements.length;
            const cols = Math.ceil(Math.sqrt(count));
            const rows = Math.ceil(count / cols);
            
            // 计算每个格子的最大尺寸
            const maxSize = Math.max(...selectedElements.map(el => Math.max(el.width, el.height)));
            const cellSize = maxSize;
            // 间距（屏幕坐标转换为画布坐标）
            const gap = 20 / zoom;
            
            // 计算起始位置（使用元素实际边界，不使用 selectionBox 的 PADDING）
            const minX = Math.min(...selectedElements.map(el => el.x));
            const minY = Math.min(...selectedElements.map(el => el.y));
            const startX = minX;
            const startY = minY;
            
            // 按位置排序：从左到右、从上到下（先按x排序，x相近的按y排序）
            const sorted = [...selectedElements].sort((a, b) => {
              // 先按 x 坐标排序
              if (Math.abs(a.x - b.x) > 50) {
                return a.x - b.x;
              }
              // x 坐标相近时，按 y 坐标排序
              return a.y - b.y;
            });
            
            const batchUpdates: Array<{ id: string; updates: Partial<CanvasElement> }> = [];
            
            sorted.forEach((el, index) => {
              const row = Math.floor(index / cols);
              const col = index % cols;
              
              // 左上角对齐，与水平/垂直排列一致
              const elementX = startX + col * (cellSize + gap);
              const elementY = startY + row * (cellSize + gap);
              
              batchUpdates.push({
                id: el.id,
                updates: {
                  x: elementX,
                  y: elementY
                }
              });
            });
            canvas.updateElementsBatch(batchUpdates);
          };
          
          // 逐个下载所有选中图片
          const handleDownloadSeparately = async () => {
            if (selectedImages.length === 0) return;
            
            for (let i = 0; i < selectedImages.length; i++) {
              const el = selectedImages[i];
              const imageKey = (el as any).imageKey || (el as any).videoKey;
              const providerUrl = (el as any).providerUrl as string | undefined;
              const imgName = el.name || `image_${i + 1}.png`;
              
              if (imageKey) {
                // #876 有key：走后端/api/download代理
                await downloadViaProxy(imageKey, imgName, providerUrl);
              } else {
                // 无key：回退到COS代理URL
                const imgUrl = getCOSUrlForElement(el);
                if (imgUrl) {
                  await downloadFile(imgUrl, imgName);
                }
              }
              // 间隔150ms避免浏览器阻止
              await new Promise(r => setTimeout(r, 150));
            }
          };
          
          // 打包下载所有选中图片（zip）
          const handleDownloadAsZip = async () => {
            if (selectedImages.length === 0) return;
            
            // 动态导入JSZip
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();
            
            // 下载所有图片并添加到zip
            for (let i = 0; i < selectedImages.length; i++) {
              const el = selectedImages[i];
              const imageKey = (el as any).imageKey || (el as any).videoKey;
              const providerUrl = (el as any).providerUrl as string | undefined;
              const imgName = el.name || `image_${i + 1}.png`;
              
              // #876 优先走后端/api/download代理（含fallbackUrl回退）
              if (imageKey) {
                const proxyUrl = `/api/download?key=${encodeURIComponent(imageKey)}${providerUrl ? '&fallbackUrl=' + encodeURIComponent(providerUrl) : ''}`;
                const blob = await fetchBlob(proxyUrl);
                if (blob) {
                  zip.file(imgName, blob);
                }
              } else {
                const imgUrl = getCOSUrlForElement(el);
                if (imgUrl) {
                  const blob = await fetchBlob(imgUrl);
                  if (blob) {
                    zip.file(imgName, blob);
                  }
                }
              }
            }
            
            // 生成并下载zip文件
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `images_${selectedImages.length}_${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          };
          
          // 发送全部图片到对话
          const handleSendAllToChat = () => {
            selectedImages.forEach(el => {
              onSendMessage(el.id);
            });
          };
          
          // #588 改为变量赋值，不直接 return
          multiSelectToolbarContent = (
            <div 
              data-toolbar="true"
              className="absolute z-[300]"
              style={{ 
                left: centerX, 
                top: toolbarY,
                transform: 'translate(-50%, -100%)'
              }}
            >
              <div 
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  padding: '6px 8px',
                  backgroundColor: '#f5f5f5',
                  borderRadius: 8,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  whiteSpace: 'nowrap'
                }}
              >
              {/* 发送到对话 */}
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    selectedImages.forEach(img => {
                      if (img.imageUrl) {
                        onSendMessage(img.id);
                      }
                    });
                    canvas.clearSelection();
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555555', transition: 'background-color 0.2s ease' }}
                  title="发送全部图片到对话"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span>发送到对话</span>
                </button>
                {/* 发送到生图 */}
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    // #509 修复：传递 imageKey 而不是签名 URL（签名 URL 会过期）
                    // #862 功能隔离：发送到生图/视频必须使用 COS 链接，禁止 providerUrl（防 CORS）
                    const imageData = selectedImages.filter(img => img.imageUrl || img.imageKey).map(img => ({
                      imageUrl: getCOSUrlForElement(img),
                      imageKey: img.imageKey || '',
                      prompt: img.sourcePrompt || '',
                    }));
                    if(imageData.length > 0) {
                      sessionStorage.setItem('canvasToSend', JSON.stringify({
                        images: imageData,
                        imageUrl: imageData[0].imageUrl,
                        prompt: imageData[0].prompt,
                      }));
                      router.push('/generate');
                    }
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555555', transition: 'background-color 0.2s ease' }}
                  title="发送全部图片到生图"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                  <span>发送到生图</span>
                </button>
                {/* 发送到视频 */}
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    const imageUrls = selectedImages.filter(img => img.imageKey || img.imageUrl).map(img => ({
                      imageUrl: getCOSUrlForElement(img),
                    }));
                    if(imageUrls.length > 0) {
                      sessionStorage.setItem('canvasToSendVideo', JSON.stringify({
                        images: imageUrls,
                        imageUrl: imageUrls[0].imageUrl,
                      }));
                      router.push('/video');
                    }
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555555', transition: 'background-color 0.2s ease' }}
                  title="发送全部图片到视频"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="23 7 16 12 23 17 23 7"/>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                  </svg>
                  <span>发送到视频</span>
                </button>

                {/* 对齐与居中 - 下拉菜单 */}
                <div 
                  style={{ position: 'relative' }}
                  onMouseEnter={(e) => {
                    const menu = e.currentTarget.querySelector('[data-align-menu]') as HTMLElement;
                    if (menu) menu.style.display = 'block';
                  }}
                  onMouseLeave={(e) => {
                    const menu = e.currentTarget.querySelector('[data-align-menu]') as HTMLElement;
                    if (menu) menu.style.display = 'none';
                  }}
                >
                  <button 
                    onClick={(e) => e.stopPropagation()}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555555', transition: 'background-color 0.2s ease' }}
                    title="对齐与居中"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="3" y1="6" x2="21" y2="6"/>
                      <line x1="3" y1="12" x2="21" y2="12"/>
                      <line x1="3" y1="18" x2="21" y2="18"/>
                      <line x1="8" y1="4" x2="8" y2="8"/>
                      <line x1="16" y1="10" x2="16" y2="14"/>
                      <line x1="12" y1="16" x2="12" y2="20"/>
                    </svg>
                    <span>对齐与居中</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                  {/* 下拉菜单 */}
                  <div 
                    data-align-menu
                    style={{ 
                      display: 'none',
                      position: 'absolute', 
                      left: 0,
                      top: '100%',
                      paddingTop: 4, // 使用 padding 而不是 margin，避免鼠标移动时出现间隙
                      background: 'transparent', // 透明区域作为悬停连接区
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{
                      background: '#fff', 
                      borderRadius: 6, 
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      overflow: 'hidden',
                      minWidth: 160,
                    }}>
                    <button 
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { 
                        e.stopPropagation();
                        handleHorizontalAlign();
                        const menu = e.currentTarget.closest('[data-align-menu]') as HTMLElement;
                        if (menu) menu.style.display = 'none';
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: 'none', background: 'transparent', width: '100%', cursor: 'pointer', fontSize: 13, color: '#333', textAlign: 'left' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="3" y1="12" x2="21" y2="12"/>
                        <line x1="6" y1="8" x2="6" y2="16"/>
                        <line x1="12" y1="8" x2="12" y2="16"/>
                        <line x1="18" y1="8" x2="18" y2="16"/>
                      </svg>
                      水平排列
                      <span style={{ marginLeft: 'auto', color: '#999', fontSize: 11 }}>Shift + H</span>
                    </button>
                    <button 
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { 
                        e.stopPropagation();
                        handleVerticalAlign();
                        const menu = e.currentTarget.closest('[data-align-menu]') as HTMLElement;
                        if (menu) menu.style.display = 'none';
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: 'none', background: 'transparent', width: '100%', cursor: 'pointer', fontSize: 13, color: '#333', textAlign: 'left' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="3" x2="12" y2="21"/>
                        <line x1="8" y1="6" x2="16" y2="6"/>
                        <line x1="8" y1="12" x2="16" y2="12"/>
                        <line x1="8" y1="18" x2="16" y2="18"/>
                      </svg>
                      垂直排列
                      <span style={{ marginLeft: 'auto', color: '#999', fontSize: 11 }}>Shift + V</span>
                    </button>
                    <button 
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { 
                        e.stopPropagation();
                        handleGridAlign();
                        const menu = e.currentTarget.closest('[data-align-menu]') as HTMLElement;
                        if (menu) menu.style.display = 'none';
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: 'none', background: 'transparent', width: '100%', cursor: 'pointer', fontSize: 13, color: '#333', textAlign: 'left' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="5" cy="5" r="2"/>
                        <circle cx="12" cy="5" r="2"/>
                        <circle cx="19" cy="5" r="2"/>
                        <circle cx="5" cy="12" r="2"/>
                        <circle cx="12" cy="12" r="2"/>
                        <circle cx="19" cy="12" r="2"/>
                        <circle cx="5" cy="19" r="2"/>
                        <circle cx="12" cy="19" r="2"/>
                        <circle cx="19" cy="19" r="2"/>
                      </svg>
                      宫格排列
                      <span style={{ marginLeft: 'auto', color: '#999', fontSize: 11 }}>Shift + A</span>
                    </button>
                    </div>
                  </div>
                </div>
                {/* 下载 - 下拉菜单 */}
                <div 
                  style={{ position: 'relative' }}
                  onMouseEnter={(e) => {
                    const menu = e.currentTarget.querySelector('[data-download-menu]') as HTMLElement;
                    if (menu) menu.style.display = 'block';
                  }}
                  onMouseLeave={(e) => {
                    const menu = e.currentTarget.querySelector('[data-download-menu]') as HTMLElement;
                    if (menu) menu.style.display = 'none';
                  }}
                >
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555555', transition: 'background-color 0.2s ease' }}
                    title="下载选中图片"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    <span>下载</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                  {/* 下拉菜单 */}
                  <div 
                    data-download-menu
                    style={{ 
                      display: 'none',
                      position: 'absolute', 
                      left: 0,
                      top: '100%',
                      paddingTop: 4, // 使用 padding 而不是 margin，避免鼠标移动时出现间隙
                      background: 'transparent',
                      zIndex: 210
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{
                      background: '#fff', 
                      borderRadius: 6, 
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      overflow: 'hidden',
                      minWidth: 130,
                    }}>
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation();
                        handleDownloadSeparately();
                        canvas.clearSelection();
                        const menu = e.currentTarget.closest('[data-align-menu]') as HTMLElement;
                        if (menu) menu.style.display = 'none';
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: 'none', background: 'transparent', width: '100%', cursor: 'pointer', fontSize: 13, color: '#333', textAlign: 'left' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      分别下载
                    </button>
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation();
                        handleDownloadAsZip();
                        canvas.clearSelection();
                        const menu = e.currentTarget.closest('[data-align-menu]') as HTMLElement;
                        if (menu) menu.style.display = 'none';
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: 'none', background: 'transparent', width: '100%', cursor: 'pointer', fontSize: 13, color: '#333', textAlign: 'left' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                      </svg>
                      打包下载
                    </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        } else if (isVisible && selectedImages.length === 1) {
          // 单选图片时显示工具栏
          let selectedImageEl = selectedImages[0];
        
        // #491 裁剪模式下，优先使用 cropImageId 查找元素（因为 selectedImages 可能还没更新）
        if (isCropping && cropImageId) {
          const cropElement = canvas.state.elements.find((el: any) => el.id === cropImageId);
          if (cropElement) {
            selectedImageEl = cropElement;
          }
        }
        
        // #490 辅助函数：获取图片URL（支持普通图片和面板类型）
        const getImageUrl = (el: any) => el?.imageUrl || (el?.imageUrls?.[0]);
        const hasImageUrl = (el: any) => !!(el?.imageUrl || el?.imageUrls?.[0]);
        
        // #588 安全计算屏幕位置 - 使用可选链防御，确保 selectedImageEl 存在时才计算
        const screenX = selectedImageEl?.x ?? 0;
        const screenY = selectedImageEl?.y ?? 0;
        const screenW = selectedImageEl?.width ?? 0;
        const screenH = selectedImageEl?.height ?? 0;
        
        // 工具栏位置 - 确保在元素上方，不遮挡内容
        const toolbarHeight = 50;
        const toolbarGap = 16; // 👑 增加间距到 16px
        const toolbarX = screenX * zoom + pan.x + (screenW * zoom) / 2; // 完整坐标计算
        const toolbarY = screenY * zoom + pan.y - toolbarHeight - toolbarGap; // 完整坐标计算
        
        // #588 单选工具栏：使用已声明的变量，不再重复声明
        if (isVisible && selectedImageEl && isCropping && cropRect) {
          // ✂️ 裁剪工具栏
          toolbarContent = (
              /* 裁剪工具栏 */
              <div 
                data-toolbar="true"
                className="absolute z-[300]"
                style={{ 
                  left: toolbarX, 
                  top: toolbarY,
                  transform: 'translate(-50%, 0)'
                }}
              >
                <div 
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    backgroundColor: '#fff',
                    borderRadius: 8,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <span style={{ fontSize: 13, color: '#333' }}>{Math.round(cropRect.width)} × {Math.round(cropRect.height)}</span>
                  <div style={{ width: 1, height: 20, backgroundColor: '#d5d5d5' }} />
                  {/* 比例选择 - 更多选项 */}
                  <div style={{ display: 'flex', gap: 2, backgroundColor: '#f5f5f5', padding: 2, borderRadius: 6 }}>
                    {[
                      { key: 'free', label: '自由' },
                      { key: '1:1', label: '1:1' },
                      { key: '4:3', label: '4:3' },
                      { key: '3:4', label: '3:4' },
                      { key: '3:2', label: '3:2' },
                      { key: '2:3', label: '2:3' },
                      { key: '16:9', label: '16:9' },
                      { key: '9:16', label: '9:16' },
                      { key: '21:9', label: '21:9' },
                      { key: '9:21', label: '9:21' },
                    ].map(({ key, label }) => (
                      <button 
                        key={key}
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setCropRatio(key as any);
                          // 锁定比例时调整裁剪框
                          if (key !== 'free' && cropRect) {
                            const [w, h] = key.split(':').map(Number);
                            const targetRatio = w / h;
                            const currentRatio = cropRect.width / cropRect.height;
                            let newWidth = cropRect.width;
                            let newHeight = cropRect.height;
                            if (currentRatio > targetRatio) {
                              newWidth = cropRect.height * targetRatio;
                            } else {
                              newHeight = cropRect.width / targetRatio;
                            }
                            setCropRect({
                              ...cropRect,
                              width: newWidth,
                              height: newHeight,
                            });
                          }
                        }}
                        style={{ 
                          padding: '4px 8px', 
                          border: 'none', 
                          background: cropRatio === key ? '#fff' : 'transparent', 
                          borderRadius: 4, 
                          cursor: 'pointer',
                          boxShadow: cropRatio === key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                          fontSize: 12,
                          color: '#222',
                          fontWeight: cropRatio === key ? 600 : 400,
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div style={{ width: 1, height: 20, backgroundColor: '#d5d5d5' }} />
                  {/* 旋转按钮 - 旋转图片 */}
                  <button 
                    onClick={async (e) => {
                      e.stopPropagation();
                      // 顺时针旋转图片90度
                      // #490 支持面板类型
                      if (selectedImageEl && hasImageUrl(selectedImageEl)) {
                        try {
                          // 加载图片
                          const img = new window.Image();
                          img.crossOrigin = 'anonymous';

                          // #490 支持面板类型
                          let imageSrc = getImageUrl(selectedImageEl);
                          // 如果是外部URL，先fetch
                          let blobUrlToRevoke: string | null = null;
                          if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
                            const response = await fetch(imageSrc);
                            const blob = await response.blob();
                            imageSrc = URL.createObjectURL(blob);
                            blobUrlToRevoke = imageSrc;
                          }
                          
                          await new Promise<void>((resolve, reject) => {
                            img.onload = () => resolve();
                            img.onerror = reject;
                            img.src = imageSrc;
                          });
                          
                          // ⚠️ P0.3 修复：图片已加载到内存，释放 blob URL
                          if (blobUrlToRevoke) URL.revokeObjectURL(blobUrlToRevoke);
                          
                          // 创建canvas旋转图片
                          const tempCanvas = document.createElement('canvas');
                          tempCanvas.width = img.height;
                          tempCanvas.height = img.width;
                          const ctx = tempCanvas.getContext('2d')!;
                          
                          // 顺时针旋转90度
                          ctx.translate(tempCanvas.width, 0);
                          ctx.rotate(90 * Math.PI / 180);
                          ctx.drawImage(img, 0, 0);
                          
                          // 生成新图片
                          const newImageUrl = tempCanvas.toDataURL('image/png');
                          
                          // 更新元素
                          canvas.updateElement(selectedImageEl.id, {
                            imageUrl: newImageUrl,
                            width: img.height,
                            height: img.width,
                          });
                          
                          // 重置裁剪框到新图片中心
                          const newSize = Math.min(img.height, img.width) * 0.8;
                          setCropRect({
                            x: (img.height - newSize) / 2,
                            y: (img.width - newSize) / 2,
                            width: newSize,
                            height: newSize,
                          });
                          
                        } catch (err) {
                          console.error('旋转图片失败:', err);
                        }
                      }
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#222', fontWeight: 500, transition: 'background-color 0.2s ease' }}
                    title="顺时针旋转图片90°"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                      <path d="M21 3v5h-5"/>
                    </svg>
                    <span>旋转</span>
                  </button>
                  {/* 水平翻转按钮 - 翻转图片 */}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      // 水平翻转图片
                      // #490 支持面板类型
                      if (selectedImageEl && hasImageUrl(selectedImageEl)) {
                        try {
                          // 加载图片
                          const img = new window.Image();
                          img.crossOrigin = 'anonymous';

                          // #490 支持面板类型
                          let imageSrc = getImageUrl(selectedImageEl);
                          // 如果是外部URL，先fetch
                          let blobUrlToRevoke: string | null = null;
                          if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
                            const response = await fetch(imageSrc);
                            const blob = await response.blob();
                            imageSrc = URL.createObjectURL(blob);
                            blobUrlToRevoke = imageSrc;
                          }
                          
                          await new Promise<void>((resolve, reject) => {
                            img.onload = () => resolve();
                            img.onerror = reject;
                            img.src = imageSrc;
                          });
                          
                          // ⚠️ P0.3 修复：图片已加载到内存，释放 blob URL
                          if (blobUrlToRevoke) URL.revokeObjectURL(blobUrlToRevoke);
                          
                          // 创建canvas翻转图片
                          const tempCanvas = document.createElement('canvas');
                          tempCanvas.width = img.width;
                          tempCanvas.height = img.height;
                          const ctx = tempCanvas.getContext('2d')!;
                          
                          // 水平翻转
                          ctx.translate(tempCanvas.width, 0);
                          ctx.scale(-1, 1);
                          ctx.drawImage(img, 0, 0);
                          
                          // 生成新图片
                          const newImageUrl = tempCanvas.toDataURL('image/png');
                          
                          // 更新元素
                          canvas.updateElement(selectedImageEl.id, {
                            imageUrl: newImageUrl,
                          });
                          
                          // 镜像裁剪框位置
                          if (cropRect) {
                            const newX = selectedImageEl.width - cropRect.x - cropRect.width;
                            setCropRect({
                              ...cropRect,
                              x: Math.max(0, newX),
                            });
                          }
                          
                        } catch (err) {
                          console.error('翻转图片失败:', err);
                        }
                      }
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#222', fontWeight: 500, transition: 'background-color 0.2s ease' }}
                    title="水平翻转图片"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/>
                      <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/>
                      <path d="M12 20v2"/>
                      <path d="M12 14v2"/>
                      <path d="M12 8v2"/>
                      <path d="M12 2v2"/>
                    </svg>
                    <span>翻转</span>
                  </button>
                  {/* 垂直翻转按钮 - 上下翻转图片 */}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      // 垂直翻转图片
                      // #490 支持面板类型
                      if (selectedImageEl && hasImageUrl(selectedImageEl)) {
                        try {
                          // 加载图片
                          const img = new window.Image();
                          img.crossOrigin = 'anonymous';

                          // #490 支持面板类型
                          let imageSrc = getImageUrl(selectedImageEl);
                          // 如果是外部URL，先fetch
                          let blobUrlToRevoke: string | null = null;
                          if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
                            const response = await fetch(imageSrc);
                            const blob = await response.blob();
                            imageSrc = URL.createObjectURL(blob);
                            blobUrlToRevoke = imageSrc;
                          }
                          
                          await new Promise<void>((resolve, reject) => {
                            img.onload = () => resolve();
                            img.onerror = reject;
                            img.src = imageSrc;
                          });
                          
                          // ⚠️ P0.3 修复：图片已加载到内存，释放 blob URL
                          if (blobUrlToRevoke) URL.revokeObjectURL(blobUrlToRevoke);
                          
                          // 创建canvas翻转图片
                          const tempCanvas = document.createElement('canvas');
                          tempCanvas.width = img.width;
                          tempCanvas.height = img.height;
                          const ctx = tempCanvas.getContext('2d')!;
                          
                          // 垂直翻转（上下翻转）
                          ctx.translate(0, tempCanvas.height);
                          ctx.scale(1, -1);
                          ctx.drawImage(img, 0, 0);
                          
                          // 生成新图片
                          const newImageUrl = tempCanvas.toDataURL('image/png');
                          
                          // 更新元素
                          canvas.updateElement(selectedImageEl.id, {
                            imageUrl: newImageUrl,
                          });
                          
                          // 镜像裁剪框位置
                          if (cropRect) {
                            const newY = selectedImageEl.height - cropRect.y - cropRect.height;
                            setCropRect({
                              ...cropRect,
                              y: Math.max(0, newY),
                            });
                          }
                          
                        } catch (err) {
                          console.error('垂直翻转图片失败:', err);
                        }
                      }
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#222', fontWeight: 500, transition: 'background-color 0.2s ease' }}
                    title="垂直翻转图片"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 8V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3"/>
                      <path d="M3 16v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/>
                      <path d="M2 12h2"/>
                      <path d="M10 12h2"/>
                      <path d="M18 12h2"/>
                      <path d="M22 12h2"/>
                    </svg>
                    <span>上下翻转</span>
                  </button>
                  <div style={{ width: 1, height: 20, backgroundColor: '#d5d5d5' }} />
                  {/* 取消 */}
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setIsCropping(false);
                      setCropImageId(null);
                      setCropRect(null);
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#222', fontWeight: 500, transition: 'background-color 0.2s ease' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                    <span>取消</span>
                  </button>
                  {/* 确认裁剪 */}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      // 执行裁剪
                      // #490 支持面板类型
                      if (hasImageUrl(selectedImageEl) && cropRect) {
                        const originalImageUrl = getImageUrl(selectedImageEl);
                        
                        
                        // 智能类型判断：区分本地内存图与网络图
                        const processImage = async () => {
                          return new Promise<void>((resolve, reject) => {
                            const img = new window.Image();
                            
                            // 核心修复：兵分两路，区别对待本地内存图与网络图
                            if (originalImageUrl.startsWith('blob:') || originalImageUrl.startsWith('data:')) {
                              // 【情况 A：本地 blob 或 Base64 图片】
                              // 绝对同源，绝对不需要跨域头，绝对不能加时间戳破坏哈希！
                              // 如果加了 crossOrigin='anonymous' 反而会因为没有服务器返回跨域头而被浏览器判定为污染！
                              img.src = originalImageUrl;
                            } else {
                              // 【情况 B：远程网络图片】
                              // 必须声明跨域，并添加时间戳穿透浏览器缓存
                              img.crossOrigin = 'anonymous';
                              const cacheBuster = `?t=${Date.now()}`;
                              const finalSrc = originalImageUrl.includes('?') 
                                ? `${originalImageUrl}&t=${Date.now()}` 
                                : `${originalImageUrl}${cacheBuster}`;
                              img.src = finalSrc;
                            }
                            
                            img.onload = () => {
                              
                              try {
                                // 计算从画布坐标到图片实际像素坐标的缩放比例
                                const scaleX = img.naturalWidth / selectedImageEl.width;
                                const scaleY = img.naturalHeight / selectedImageEl.height;
                                
                                
                                // 转换裁剪区域到图片实际像素坐标
                                const srcX = Math.round(cropRect.x * scaleX);
                                const srcY = Math.round(cropRect.y * scaleY);
                                const srcW = Math.round(cropRect.width * scaleX);
                                const srcH = Math.round(cropRect.height * scaleY);
                                
                                
                                // 验证裁剪区域是否有效
                                if (srcW <= 0 || srcH <= 0) {
                                  reject(new Error('裁剪区域无效: 宽度或高度为0'));
                                  return;
                                }
                                
                                // 确保裁剪区域不超出图片范围
                                const clampedX = Math.max(0, Math.min(srcX, img.naturalWidth - 1));
                                const clampedY = Math.max(0, Math.min(srcY, img.naturalHeight - 1));
                                const clampedW = Math.min(srcW, img.naturalWidth - clampedX);
                                const clampedH = Math.min(srcH, img.naturalHeight - clampedY);
                                
                                if (clampedW <= 0 || clampedH <= 0) {
                                  reject(new Error('裁剪区域超出图片范围'));
                                  return;
                                }
                                
                                const canvasEl = document.createElement('canvas');
                                canvasEl.width = clampedW;
                                canvasEl.height = clampedH;
                                const ctx = canvasEl.getContext('2d');
                                
                                if (!ctx) {
                                  reject(new Error('无法创建 canvas context'));
                                  return;
                                }
                                
                                // 绘制裁剪区域
                                
                                // 矩形裁剪
                                ctx.drawImage(
                                  img, 
                                  clampedX, clampedY, clampedW, clampedH, 
                                  0, 0, clampedW, clampedH
                                );
                                
                                // 获取 data URL
                                const url = canvasEl.toDataURL('image/png');
                                
                                if (!url || url === 'data:,' || url.length < 100) {
                                  reject(new Error('生成的图片为空或数据太小'));
                                  return;
                                }
                                
                                // 计算裁剪后图片在画布上的尺寸
                                const newWidth = cropRect.width;
                                const newHeight = cropRect.height;
                                
                                // 🧹 #839 裁剪后上传COS：避免base64导致刷新丢失
                                // 将base64转Blob→File→COS上传的逻辑放在resolve中，避免onload内用await
                                let finalImageUrl = url;
                                let finalImageKey: string | undefined = undefined;
                                
                                // base64 data URL → Blob → File（同步拆分，异步上传）
                                try {
                                  const byteString = atob(url.split(',')[1]);
                                  const mimeString = url.split(',')[0].split(':')[1].split(';')[0];
                                  const ab = new ArrayBuffer(byteString.length);
                                  const ia = new Uint8Array(ab);
                                  for (let i = 0; i < byteString.length; i++) {
                                    ia[i] = byteString.charCodeAt(i);
                                  }
                                  const blob = new Blob([ab], { type: mimeString });
                                  const file = new File([blob], `crop_${selectedImageEl.id}_${Date.now()}.png`, { type: 'image/png' });
                                  // 异步上传（不阻塞onload，用.then处理结果）
                                  uploadFile(file, 'perm').then(uploadResult => {
                                    if (uploadResult) {
                                      console.log('[裁剪] 上传COS成功, key:', uploadResult.key);
                                      canvas.updateElement(selectedImageEl.id, {
                                        imageUrl: uploadResult.proxyUrl,
                                        imageKey: uploadResult.key,
                                      });
                                    } else {
                                      console.warn('[裁剪] COS上传失败，保留base64（刷新后可能丢失）');
                                    }
                                  }).catch(uploadErr => {
                                    console.warn('[裁剪] COS上传异常，保留base64:', uploadErr);
                                  });
                                } catch (convertErr) {
                                  console.warn('[裁剪] base64转Blob失败，保留base64:', convertErr);
                                }
                                
                                canvas.updateElement(selectedImageEl.id, {
                                  imageUrl: finalImageUrl,
                                  name: `裁剪_${selectedImageEl.name || 'image'}`,
                                  width: newWidth,
                                  height: newHeight,
                                  naturalWidth: clampedW,
                                  naturalHeight: clampedH,
                                  isCropped: true,
                                });
                                
                                setIsCropping(false);
                                setCropImageId(null);
                                setCropRect(null);
                                resolve();
                                
                              } catch (err) {
                                console.error('[裁剪] 绘制过程出错:', err);
                                reject(err);
                              }
                            };
                            
                            img.onerror = (err) => {
                              console.error('[裁剪] 图片加载失败:', err);
                              reject(new Error('图片加载失败'));
                            };
                            
                            // img.src 已在上面根据图片类型设置，这里不需要再设置
                          });
                        };
                        
                        try {
                          await processImage();
                        } catch (err) {
                          console.error('[裁剪] 裁剪失败:', err);
                          showInfo('裁剪失败', `${err instanceof Error ? err.message : '未知错误'}，请重试`);
                        }
                      }
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#40A9FF'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#1890ff'}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', border: 'none', background: '#1890ff', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#fff', transition: 'background-color 0.2s ease' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span>确认裁剪</span>
                  </button>
                </div>
              </div>
            );
            // 裁剪模式下不显示文字信息，避免遮挡裁剪框触发区域
          } else if (isVisible && selectedImageEl && !((selectedImageEl as any).isStackExpanded && (selectedImageEl as any).imageUrls?.length > 1)) {
            // 🛠️ 工具栏
            // #858 扑克牌展开时隐藏顶部工具栏，避免遮挡展开内容
            // #619 判断是否为视频元素
            const isVideoElement = !!(selectedImageEl as any).videoUrl || selectedImageEl.type === 'video';
            toolbarContent = (
              /* 工具栏 */
              <div 
              data-toolbar="true"
              className="absolute z-[300]"
              style={{ 
                left: toolbarX, 
                top: toolbarY,
                transform: 'translate(-50%, 0)'
              }}
            >
              <div 
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                padding: '6px 8px',
                backgroundColor: '#f5f5f5',
                borderRadius: 8,
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                whiteSpace: 'nowrap'
              }}
            >
	              {/* #619 视频工具栏：仅保留全屏播放 */}
              {isVideoElement ? (<>
                {/* 全屏播放 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const vUrl = (selectedImageEl as any).videoUrl || selectedImageEl.imageUrl;
                    if (vUrl) {
                      setShowVideoFullscreenUrl(vUrl);
                    }
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555555', transition: 'background-color 0.2s ease' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                  </svg>
                  <span>全屏播放</span>
                </button>
              </>) : (<>
              {/* 以下为图片专用按钮 */}
              {/* 发送到对话 */}
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  onSendMessage(selectedImageEl.id);
                  canvas.clearSelection();
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555555', transition: 'background-color 0.2s ease' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span>发送到对话</span>
              </button>
              {/* 发送到生图 */}
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  // #417 支持面板类型
                  // #509 修复：传递 imageKey 而不是签名 URL（签名 URL 会过期）
                  const sendUrl = selectedImageEl.imageUrl || ((selectedImageEl as any).imageUrls as string[])?.[0];
                  const sendKey = selectedImageEl.imageKey || '';
                  if(sendUrl || sendKey) {
                    sessionStorage.setItem('canvasToSend', JSON.stringify({
                      imageUrl: sendUrl || '',
                      imageKey: sendKey,
                      prompt: selectedImageEl.sourcePrompt || '',
                    }));
                    router.push('/generate');
                  }
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555555', transition: 'background-color 0.2s ease' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
                <span>发送到生图</span>
              </button>
              {/* 发送到视频 */}
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  // #417 支持面板类型
                  const sendUrl = selectedImageEl.imageUrl || ((selectedImageEl as any).imageUrls as string[])?.[0];
                  if(sendUrl) {
                    sessionStorage.setItem('canvasToSendVideo', JSON.stringify({
                      imageUrl: sendUrl,
                    }));
                    router.push('/video');
                  }
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555555', transition: 'background-color 0.2s ease' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="23 7 16 12 23 17 23 7"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
                <span>发送到视频</span>
              </button>
              {/* 裁剪 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();

                  // #490 支持面板类型：复制为普通图片再裁剪
                  const isPanel = selectedImageEl.type === 'generate-panel' || (selectedImageEl as any).imageUrls;

                  if (isPanel) {
                    // 面板类型：复制首图为普通图片
                    const imageUrl = getImageUrl(selectedImageEl);
                    if (!imageUrl) return;

                    // 先关闭右键菜单
                    setContextMenu(null);
                    
                    // 异步处理：确保新图片被正确选中
                    const img = new window.Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = () => {
                      // 使用首图的实际尺寸，而不是面板尺寸
                      const actualWidth = img.naturalWidth;
                      const actualHeight = img.naturalHeight;
                      
                      // 创建新的普通图片元素（放在面板右方）
                      const newElementId = canvas.addElement({
                        type: 'image',
                        name: selectedImageEl.name || '裁剪图片',
                        x: selectedImageEl.x + selectedImageEl.width + 20,
                        y: selectedImageEl.y,
                        width: actualWidth,
                        height: actualHeight,
                        rotation: 0, // 新图片不继承面板旋转
                        fill: 'transparent',
                        stroke: 'transparent',
                        strokeWidth: 0,
                        opacity: 1,
                        visible: true,
                        locked: false,
                        imageUrl: imageUrl,
                        imageKey: (selectedImageEl as any).imageKeys?.[0] || (selectedImageEl as any).imageKey,
                        flipH: false,
                        flipV: false,
                      });

                      // 先清除之前的选中状态，再选中新图片
                      canvas.clearSelection();
                      
                      // 清除面板的配置面板（activeInputNodeId）
                      setActiveInputNodeId(null);
                      
                      // 使用 setTimeout 确保状态更新
                      setTimeout(() => {
                        canvas.selectElements([newElementId]);
                        setIsCropping(true);
                        setCropImageId(newElementId);
                        setCropRect({
                          x: 0,
                          y: 0,
                          width: actualWidth,
                          height: actualHeight
                        });
                      }, 50);
                    };
                    img.onerror = () => {
                      console.error('[裁剪] 加载图片失败');
                    };
                    img.src = imageUrl;
                    return; // 异步处理，提前返回
                  } else {
                    // 普通图片：直接进入裁剪模式
                    if(hasImageUrl(selectedImageEl)) {
                      setIsCropping(true);
                      setCropImageId(selectedImageEl.id);
                      setContextMenu(null); // 关闭右键菜单
                      // 初始化裁剪框为图片的100%区域（全选）
                      setCropRect({
                        x: 0,
                        y: 0,
                        width: selectedImageEl.width,
                        height: selectedImageEl.height
                      });
                    }
                  }
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555555', transition: 'background-color 0.2s ease' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/>
                  <path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/>
                </svg>
                <span>裁剪</span>
              </button>
              {/* 宫格切分 - 下拉菜单（Portal渲染到body，避免被画布overflow-hidden裁剪） */}
              <div 
                style={{ position: 'relative' }}
                onMouseEnter={(e) => {
                  const menu = document.querySelector('[data-split-menu-portal]') as HTMLElement;
                  if (menu) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    menu.style.display = 'block';
                    menu.style.position = 'fixed';
                    menu.style.left = rect.left + 'px';
                    menu.style.top = (rect.bottom + 4) + 'px';
                  }
                }}
                onMouseLeave={(e) => {
                  // 检查鼠标是否移动到下拉菜单上
                  const menu = document.querySelector('[data-split-menu-portal]') as HTMLElement;
                  if (menu) {
                    // 延迟隐藏，让用户有时间移动到菜单上
                    setTimeout(() => {
                      if (!menu.matches(':hover')) {
                        menu.style.display = 'none';
                      }
                    }, 100);
                  }
                }}
              >
                <button 
                  onClick={(e) => { e.stopPropagation(); }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555555', transition: 'background-color 0.2s ease' }}
                  title="宫格切分"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" rx="1"/>
                    <rect x="14" y="3" width="7" height="7" rx="1"/>
                    <rect x="3" y="14" width="7" height="7" rx="1"/>
                    <rect x="14" y="14" width="7" height="7" rx="1"/>
                  </svg>
                  <span>宫格切分</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
              </div>
              {/* 宫格切分下拉菜单 - Portal渲染到body */}
              {createPortal(
                <div 
                  data-split-menu-portal
                  style={{ 
                    display: 'none',
                    position: 'fixed',
                    zIndex: 99999,
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseEnter={() => {
                    const menu = document.querySelector('[data-split-menu-portal]') as HTMLElement;
                    if (menu) menu.style.display = 'block';
                  }}
                  onMouseLeave={() => {
                    const menu = document.querySelector('[data-split-menu-portal]') as HTMLElement;
                    if (menu) menu.style.display = 'none';
                  }}
                >
                  <div style={{
                    background: '#fff', 
                    borderRadius: 6, 
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    overflow: 'hidden',
                    minWidth: 180,
                  }}>
                    {/* 宫格分割 */}
                    <button 
                      onClick={async (e) => { 
                        e.stopPropagation();
                        const menu = document.querySelector('[data-split-menu-portal]') as HTMLElement;
                        if (menu) menu.style.display = 'none';
                        
                        if (!hasImageUrl(selectedImageEl)) return;
                        
                        try {
                          const img = new window.Image();
                          img.crossOrigin = 'anonymous';
                          
                          let imageSrc = getImageUrl(selectedImageEl);
                          let blobUrlToRevoke: string | null = null;
                          if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
                            const response = await fetch(imageSrc);
                            const blob = await response.blob();
                            imageSrc = URL.createObjectURL(blob);
                            blobUrlToRevoke = imageSrc;
                          }
                          
                          await new Promise<void>((resolve, reject) => {
                            img.onload = () => resolve();
                            img.onerror = reject;
                            img.src = imageSrc;
                          });
                          
                          if (blobUrlToRevoke) URL.revokeObjectURL(blobUrlToRevoke);
                          
                          // 2x2 宫格分割
                          const cols = 2;
                          const rows = 2;
                          const cellW = Math.floor(img.naturalWidth / cols);
                          const cellH = Math.floor(img.naturalHeight / rows);
                          
                          const splitImages: string[] = [];
                          
                          for (let r = 0; r < rows; r++) {
                            for (let c = 0; c < cols; c++) {
                              const tempCanvas = document.createElement('canvas');
                              tempCanvas.width = cellW;
                              tempCanvas.height = cellH;
                              const ctx = tempCanvas.getContext('2d')!;
                              ctx.drawImage(img, c * cellW, r * cellH, cellW, cellH, 0, 0, cellW, cellH);
                              splitImages.push(tempCanvas.toDataURL('image/png'));
                            }
                          }
                          
                          if (splitImages.length > 0) {
                            await handleAddSplitImagesToCanvas(splitImages);
                            canvas.clearSelection();
                          }
                        } catch (err) {
                          console.error('[宫格分割] 失败:', err);
                          showInfo('宫格分割失败', `${err instanceof Error ? err.message : '未知错误'}`);
                        }
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: 'none', background: 'transparent', width: '100%', cursor: 'pointer', fontSize: 13, color: '#333', textAlign: 'left' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="7" height="7" rx="1"/>
                        <rect x="14" y="3" width="7" height="7" rx="1"/>
                        <rect x="3" y="14" width="7" height="7" rx="1"/>
                        <rect x="14" y="14" width="7" height="7" rx="1"/>
                      </svg>
                      宫格分割
                      <span style={{ marginLeft: 'auto', color: '#999', fontSize: 11 }}>免费</span>
                    </button>
                    {/* 智能分割 */}
                    <button 
                      onClick={async (e) => { 
                        e.stopPropagation();
                        const menu = document.querySelector('[data-split-menu-portal]') as HTMLElement;
                        if (menu) menu.style.display = 'none';
                        
                        if (!hasImageUrl(selectedImageEl)) return;
                        
                        try {
                          const img = new window.Image();
                          img.crossOrigin = 'anonymous';
                          
                          let imageSrc = getImageUrl(selectedImageEl);
                          let blobUrlToRevoke: string | null = null;
                          if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
                            const response = await fetch(imageSrc);
                            const blob = await response.blob();
                            imageSrc = URL.createObjectURL(blob);
                            blobUrlToRevoke = imageSrc;
                          }
                          
                          await new Promise<void>((resolve, reject) => {
                            img.onload = () => resolve();
                            img.onerror = reject;
                            img.src = imageSrc;
                          });
                          
                          if (blobUrlToRevoke) URL.revokeObjectURL(blobUrlToRevoke);
                          
                          // 转换为 base64
                          const tempCanvas = document.createElement('canvas');
                          tempCanvas.width = img.naturalWidth;
                          tempCanvas.height = img.naturalHeight;
                          const ctx = tempCanvas.getContext('2d')!;
                          ctx.drawImage(img, 0, 0);
                          const imageBase64 = tempCanvas.toDataURL('image/png');
                          
                          // 调用智能分割 API
                          const response = await fetch('/api/split', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              image: imageBase64,
                              removeBorders: false,
                            })
                          });
                          
                          if (!response.ok) {
                            let errMsg = await response.text();
                            try {
                              const errJson = JSON.parse(errMsg);
                              errMsg = errJson.error || errMsg;
                            } catch {}
                            showInfo('智能分割失败', errMsg);
                            return;
                          }
                          
                          const data = await response.json();
                          
                          if (data.cells && data.cells.length > 0) {
                            // 切割图片
                            const splitImages = await cropImageByCells(imageBase64, data.cells, data.needCrop);
                            
                            if (splitImages.length > 0) {
                              await handleAddSplitImagesToCanvas(splitImages);
                              canvas.clearSelection();
                            } else {
                              showInfo('智能分割失败', '未识别到可分割的区域');
                            }
                          } else {
                            showInfo('智能分割失败', data.error || '未识别到分镜结构');
                          }
                        } catch (err) {
                          console.error('[智能分割] 失败:', err);
                          showInfo('智能分割失败', `${err instanceof Error ? err.message : '未知错误'}`);
                        }
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: 'none', background: 'transparent', width: '100%', cursor: 'pointer', fontSize: 13, color: '#333', textAlign: 'left' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2 8H14M2 16H14" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2"/>
                        <rect x="3.5" y="3.5" width="4" height="4" rx="1"/>
                        <rect x="8.5" y="8.5" width="4" height="4" rx="1"/>
                        <path d="M6 3.5L10 3.5M6 12.5L10 12.5" strokeLinecap="round"/>
                      </svg>
                      智能分割
                      <span style={{ marginLeft: 'auto', color: '#e67e22', fontSize: 11 }}>5 积分</span>
                    </button>
                  </div>
                </div>
              , document.body)}
              </>)}
              {/* 分隔线 - 图片和视频共享 */}
              <div style={{ width: 1, height: 20, backgroundColor: '#d5d5d5', margin: '0 4px' }} />
              {/* 下载 - 图片和视频共享 */}
              <button 
                 onClick={async (e) => {
                   e.stopPropagation();
                   // #876 统一下载代理：后端全能代理（COS双桶+fallbackUrl+Node.js代理），彻底根除CORS和window.open报错鞭尸
                   const imageKey = (selectedImageEl as any).imageKey || (selectedImageEl as any).videoKey;
                   const providerUrl = (selectedImageEl as any).providerUrl as string | undefined;
                   const isVideo = !!(selectedImageEl as any).videoUrl && !selectedImageEl.imageUrl;
                   const filename = selectedImageEl.name || (isVideo ? 'video.mp4' : 'image.png');
                   if (imageKey) {
                     // 有key：走后端/api/download代理（COS双桶+fallbackUrl三层回退）
                     const success = await downloadViaProxy(imageKey, filename, providerUrl);
                     if (!success) {
                       toast.error('抱歉，原图片已过期或损坏');
                     }
                   } else {
                     // 无key：回退到COS代理URL直接下载
                     const cosUrl = getCOSUrlForElement(selectedImageEl);
                     const fallbackUrl = ((selectedImageEl as any).imageUrls as string[])?.[0] || (selectedImageEl as any).videoUrl;
                     const downloadUrl = cosUrl || fallbackUrl;
                     if (downloadUrl) {
                       const success = await downloadFile(downloadUrl, filename);
                       if (!success) {
                         toast.error('抱歉，原图片已过期或损坏');
                       }
                     }
                   }
                   canvas.clearSelection();
                 }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555555', transition: 'background-color 0.2s ease' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>下载</span>
              </button>
              </div>
            </div>
            );

            // 文字信息（非裁剪模式显示）
            textInfoContent = (
            <div 
              className="absolute z-[300]"
              style={{ 
                left: screenX * zoom + pan.x,
                top: screenY * zoom + pan.y - 16, // 文字顶部在图片上方16px，紧贴工具栏底部
                width: screenW * zoom,
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 4px',
                pointerEvents: 'none',
              }}>
                <span style={{ 
                  fontSize: 10, 
                  fontWeight: 500,
                  color: theme === 'dark' ? '#fff' : '#333',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '50%',
                  whiteSpace: 'nowrap',
                  paddingRight: 8,
                }}>{selectedImageEl?.name || '未命名图片'}</span>
                <span style={{ 
                  fontSize: 10, 
                  fontWeight: 500,
                  color: theme === 'dark' ? '#fff' : '#333',
                  whiteSpace: 'nowrap',
                  paddingLeft: 8,
                }}>
                  {/* #417 优先使用真实尺寸：naturalWidth(图片) > actualWidth(面板) > width(物理尺寸) */}
                  {/* #588 添加可选链防御 */}
                  {selectedImageEl?.naturalWidth && selectedImageEl?.naturalHeight 
                    ? `${Math.round(selectedImageEl.naturalWidth)} × ${Math.round(selectedImageEl.naturalHeight)}`
                    : (selectedImageEl as any)?.actualWidth && (selectedImageEl as any)?.actualHeight
                    ? `${Math.round((selectedImageEl as any).actualWidth)} × ${Math.round((selectedImageEl as any).actualHeight)}`
                    : `${Math.round(selectedImageEl?.width ?? 0)} × ${Math.round(selectedImageEl?.height ?? 0)}`
                  }
                </span>
              </div>
            </div>
            );
          }
        }

        // 终极防御：统一返回唯一的 Fragment！(完美解决撕裂问题)
          // #588 使用带稳定 key 的 Fragment，确保 Fiber 节点类型永远稳定
          // 这样在 React 看来，此处的 Fiber 节点类型永远是稳定的 Fragment，唯一改变的只是它的 children
          // 只要根结构不频繁自毁和替换，并发模式下的 DOM 树断裂和 insertBefore 报错将被从物理层面上彻底杜绝！
          return (
            <React.Fragment key="global-stable-toolbar-root">
              {multiSelectToolbarContent}
              {toolbarContent}
              {textInfoContent}
            </React.Fragment>
          );
      })()}
      
      {/* 文字工具栏 - 只选中一个文字元素时显示 */}
      {(() => {
        // 双击选择模式下不显示工具栏
        if (isGridSelectMode) return null;
        
        // 只有在只选中一个元素时才显示文字工具栏
        if (canvas.state.selectedIds.length !== 1) return null;
        
        // 找到选中的文字元素
        const selectedTextElements = canvas.state.elements.filter(
          el => el.type === 'text' && canvas.state.selectedIds.includes(el.id) && el.visible
        );
        
        if (selectedTextElements.length === 0) return null;
        
        const selectedTextEl = selectedTextElements[0];
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return null;
        
        // 从 Fabric.js 获取文字对象的实际位置
        const fabricCanvas = (window as any).__fabricCanvas;
        const fabricTextObj = fabricCanvas?.getObjects().find((obj: any) => obj.elementId === selectedTextEl.id);
        
        // 计算屏幕位置
        let screenX: number;
        let screenY: number;
        let screenW: number;
        let screenH: number;
        
        if (fabricTextObj && fabricCanvas) {
          // 使用 getBoundingRect(true) 获取对象在画布坐标系中的精确边界框
          // absolute=true 确保返回相对于画布的绝对坐标
          const boundingRect = fabricTextObj.getBoundingRect(true);
          
          // 将画布坐标转换为屏幕坐标
          // screenX = canvasX * zoom + pan.x
          screenX = boundingRect.left * zoom + pan.x;
          screenY = boundingRect.top * zoom + pan.y;
          screenW = boundingRect.width * zoom;
          screenH = boundingRect.height * zoom;
        } else {
          // 回退到元素存储的坐标
          screenX = selectedTextEl.x * zoom + pan.x;
          screenY = selectedTextEl.y * zoom + pan.y;
          screenW = selectedTextEl.width * zoom;
          screenH = (selectedTextEl.height || 40) * zoom;
        }
        
        // 检查文字元素是否在可视区域内
        const isVisible = screenX + screenW >= 0 && 
                         screenX <= containerRect.width &&
                         screenY >= 0 && 
                         screenY <= containerRect.height;
        
        if (!isVisible) return null;
        
        // 工具栏位置 - 在文字元素上方居中（相对于 containerRef）
        // 工具栏中心X = 文字屏幕X + 文字宽度的一半
        const toolbarCenterX = screenX + screenW / 2;
        // 工具栏顶部Y = 文字屏幕Y - 工具栏高度 - 间距
        const toolbarTopY = screenY - TEXT_TOOLBAR_HEIGHT - TEXT_TOOLBAR_GAP;
        
        // 检查工具栏是否在屏幕可见区域内
        const isToolbarVisible = 
          toolbarCenterX - TEXT_TOOLBAR_WIDTH / 2 >= 0 &&
          toolbarCenterX + TEXT_TOOLBAR_WIDTH / 2 <= window.innerWidth &&
          toolbarTopY - 50 >= 0;
        
        if (!isToolbarVisible) return null;
        
        return (
          <TextToolbar
            selectedTextEl={selectedTextEl}
            onUpdateElement={canvas.updateElement}
            onDeleteElement={canvas.deleteElement}
            toolbarCenterX={toolbarCenterX}
            toolbarTopY={toolbarTopY}
          />
        );
      })()}
      
      {/* 右键菜单 - 使用 createPortal 渲染到 body，避免被选中框遮挡 */}
      {contextMenu && createPortal(
        <div 
          data-context-menu="true"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: '#27272a',
            border: `1px solid ${theme === 'dark' ? '#ffffff' : '#000000'}`,
            borderRadius: '8px',
            boxShadow: '0 5px 12px rgba(0, 0, 0, 0.25)',
            zIndex: 9999,
            padding: '4px',
            minWidth: '140px',
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* 空白区域右键菜单 */}
          {/* 多选右键菜单 */}
          {contextMenu.isMultiSelect ? (
            <>
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
                  const selectedElements = canvas.state.elements.filter(el => canvas.state.selectedIds.includes(el.id));
                  if (selectedElements.length > 0) {
                    const newIds: string[] = [];
                    selectedElements.forEach(el => {
                      const newEl = {
                        ...el,
                        x: el.x + 20,
                        y: el.y + 20,
                        name: `${el.name} Copy`,
                      };
                      delete (newEl as any).id;
                      const id = canvas.addElement(newEl);
                      newIds.push(id);
                    });
                    canvas.clearSelection();
                    newIds.forEach(id => canvas.selectElement(id, true));
                  }
                  setContextMenu(null);
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
              
              {/* 删除所有选中元素 */}
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
                  canvas.deleteSelected();
                  setContextMenu(null);
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
                删除 ({canvas.state.selectedIds.length})
              </button>
            </>
          ) : !contextMenu.elementId ? (
            <>
              {/* #615/#621 上传按钮 - 右键上传：放在右击位置，不偏移不居中 */}
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
                  // #621 记录右击位置（画布坐标），用于上传时定位
                  contextMenuUploadTargetRef.current = contextMenu.canvasX != null && contextMenu.canvasY != null
                    ? { canvasX: contextMenu.canvasX, canvasY: contextMenu.canvasY }
                    : null;
                  setContextMenu(null);
                  fileInputRef.current?.click();
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(156, 163, 175, 0.15)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                上传图片/视频
              </button>
              
              <div style={{ height: '1px', background: 'rgba(156, 163, 175, 0.15)', margin: '2px 0' }} />
              
              {/* 粘贴按钮 */}
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
                  justifyContent: 'space-between',
                }}
                onClick={() => {
                  // 优先使用本地剪贴板，如果没有则尝试全局剪贴板
                  const clipboardToUse = clipboard.length > 0 ? clipboard : ((window as any).__canvasClipboard || []);
                  if (clipboardToUse.length > 0) {
                    const newIds: string[] = [];
                    clipboardToUse.forEach((el: CanvasElement) => {
                      const newEl = {
                        ...el,
                        x: el.x + 20,
                        y: el.y + 20,
                        name: `${el.name} Copy`,
                      };
                      delete (newEl as any).id;
                      const id = canvas.addElement(newEl);
                      newIds.push(id);
                    });
                    canvas.clearSelection();
                    newIds.forEach(id => canvas.selectElement(id, true));
                  }
                  setContextMenu(null);
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(156, 163, 175, 0.15)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <span>粘贴</span>
                <span style={{ color: '#71717a', fontSize: '11px' }}>Ctrl+V</span>
              </button>
              
              <div style={{ height: '1px', background: 'rgba(156, 163, 175, 0.15)', margin: '2px 0' }} />
              
              {/* 放大按钮 */}
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
                  justifyContent: 'space-between',
                }}
                onClick={() => {
                  const container = containerRef.current;
                  if (!container) return;
                  const rect = container.getBoundingClientRect();
                  
                  const result = calculateZoom({
                    currentZoom: zoom,
                    currentPan: pan,
                    scaleFactor: 1.2,
                    containerWidth: rect.width,
                    containerHeight: rect.height,
                    canvasWidth: CANVAS_WIDTH,
                    canvasHeight: canvasHeight,
                  });
                  
                  setZoom(result.zoom);
                  setPan({ x: result.panX, y: result.panY });
                  setContextMenu(null);
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(156, 163, 175, 0.15)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <span>放大</span>
                <span style={{ color: '#71717a', fontSize: '11px' }}>{Math.round(zoom * 100)}%</span>
              </button>
              
              {/* 缩小按钮 */}
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
                  justifyContent: 'space-between',
                }}
                onClick={() => {
                  const container = containerRef.current;
                  if (!container) return;
                  const rect = container.getBoundingClientRect();
                  
                  const result = calculateZoom({
                    currentZoom: zoom,
                    currentPan: pan,
                    scaleFactor: 1 / 1.2,
                    containerWidth: rect.width,
                    containerHeight: rect.height,
                    canvasWidth: CANVAS_WIDTH,
                    canvasHeight: canvasHeight,
                  });
                  
                  setZoom(result.zoom);
                  setPan({ x: result.panX, y: result.panY });
                  setContextMenu(null);
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(156, 163, 175, 0.15)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <span>缩小</span>
                <span style={{ color: '#71717a', fontSize: '11px' }}>{Math.round(zoom * 100)}%</span>
              </button>
              
              {/* 显示画布所有内容按钮（含图片+视频+面板） */}
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
                }}
                onClick={() => {
                  const container = canvasContainerRef.current;
                  if (!container) return;
                  const rect = container.getBoundingClientRect();
                  
                  const result = fitToAllImages({
                    elements: canvas.state.elements,
                    containerWidth: rect.width,
                    containerHeight: rect.height,
                    canvasWidth: CANVAS_WIDTH,
                    canvasHeight: canvasHeight,
                  });
                  
                  setZoom(result.zoom);
                  setPan({ x: result.panX, y: result.panY });
                  canvas.clearSelection();
                  setContextMenu(null);
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(156, 163, 175, 0.15)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <span>显示画布所有内容</span>
              </button>
            </>
          ) : (
            /* 元素右键菜单 - 复刻面板右键菜单样式（深色风格） */
            <>
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
                  const selectedElements = canvas.state.elements.filter(el => canvas.state.selectedIds.includes(el.id));
                  if (selectedElements.length > 0) {
                    const newIds: string[] = [];
                    selectedElements.forEach(el => {
                      const newEl = {
                        ...el,
                        x: el.x + 20,
                        y: el.y + 20,
                        name: `${el.name} Copy`,
                      };
                      delete (newEl as any).id;
                      const id = canvas.addElement(newEl);
                      newIds.push(id);
                    });
                    canvas.clearSelection();
                    newIds.forEach(id => canvas.selectElement(id, true));
                  }
                  setContextMenu(null);
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
                  canvas.deleteSelected();
                  setContextMenu(null);
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
            </>
          )}
        </div>,
        document.body
      )}

      {/* #610 Canvas 交互层 - 拖拽连线渲染通道 */}
      {/* ⚠️ 绝对不能加 will-change 或 translateZ(0)，否则触发混合合成陷阱 */}
      <canvas
        ref={interactionCanvasRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          pointerEvents: 'none',
          zIndex: 9998,
        }}
      />
    </>
  );
}
