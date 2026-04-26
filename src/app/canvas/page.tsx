'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import Image from 'next/image';
import { useTheme } from 'next-themes';
import { CanvasProvider, useCanvas, type CanvasContextType } from '@/contexts/CanvasContext';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';
import { CanvasElement, Message } from '@/types/canvas';
import { ScrollArea } from '@/components/ui/scroll-area';
import Navbar from '@/components/Navbar';
import FabricTextLayer, { fabricDraggingFlag } from '@/components/FabricTextLayer';
import { fetchUserWithCache, updateCachedCredits } from '@/lib/user-cache';
import HistoryRecordsDialog from '@/components/HistoryRecordsDialog';
import { historyStore, type HistoryRecord } from '@/store/historyStore';  // #232 Sprint 3
import TextToolbar, { TEXT_TOOLBAR_HEIGHT, TEXT_TOOLBAR_GAP, TEXT_TOOLBAR_WIDTH } from '@/components/canvas/toolbars/TextToolbar';
import PenToolbar, { hexToHSB, hsbToHex } from '@/components/canvas/toolbars/PenToolbar';
import { InfoDialog } from '@/components/ui/info-dialog';
import AuthModal from '@/components/AuthModal';
import { useSharedData } from '@/hooks/useSharedData';
import { toast } from 'sonner';
import CanvasRoseCurve from '@/components/canvas/CanvasRoseCurve';
import TopBar from '@/components/temp_TopBar';
import LeftSideBar from '@/components/temp_LeftSideBar';
import RightPanel from '@/components/temp_RightPanel';
import { useCanvasCore, CANVAS_HEIGHT, IMAGE_OVERLAP_OFFSETS } from '@/hooks/useCanvasCore';
import { usePresignedUrl } from '@/hooks/usePresignedUrl';
import { getPresignedUrls } from '@/lib/presigned-url-cache';
import { safeSetItem } from '@/lib/safe-storage';
import { globalPendingUploads } from '@/hooks/useOptimisticUpload';

// #096 修复：LayerPanel 使用 dynamic import + ssr: false，彻底避免 Hydration 撕裂
// 图层数量在 SSR 和 CSR 之间可能不一致，必须禁止 SSR
const LayerPanel = dynamic(() => import('@/components/canvas/panels/LayerPanel'), { ssr: false });

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
  Layers,
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
// 【A 计划】乐观上传 Hook
import { useOptimisticUpload, OptimisticUploadResult, BackgroundUploadResult } from '@/hooks/useOptimisticUpload';

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

// 图像生成器操作面板组件 - 使用共享配置
const ImageGeneratorPanel: React.FC<{ canvasSize: number }> = ({ canvasSize }) => {
  // 使用共享配置
  const { model, setModel, resolution, setResolution, aspectRatio, setAspectRatio, apiEndpoint, apiKey } = useSharedData();
  
  const [prompt, setPrompt] = useState('');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showResMenu, setShowResMenu] = useState(false);
  const [showRatioMenu, setShowRatioMenu] = useState(false);
  
  // 动态模型配置（从数据库获取）
  const [modelConfig, setModelConfig] = useState<Record<string, {
    resolutions: { size: string; credits: number }[];
    aspectRatios: string[];
  }>>({});
  
  // 模型显示名称（从 API 动态获取）
  const [modelDisplayNames, setModelDisplayNames] = useState<Record<string, string>>({});
  
  // 从 API 获取模型配置
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/config?service_type=image_generation');
        const data = await res.json();
        if (data.success && data.data?.models) {
          const newConfig: Record<string, {
            resolutions: { size: string; credits: number }[];
            aspectRatios: string[];
          }> = {};
          data.data.models.forEach((m: { model_id: string; model_name: string; parameters: any; credits_base?: number }) => {
            const dbResolutions = m.parameters?.resolutions || [];
            
            newConfig[m.model_id] = {
              resolutions: dbResolutions.map((r: any) => ({
                size: r.label || r.value,
                credits: r.credits || m.credits_base || 10,
              })),
              aspectRatios: (m.parameters?.aspectRatios || []).map((r: any) => r.value || r.label),
            };
          });
          setModelConfig(newConfig);
          
          // 构建模型显示名称映射
          const newDisplayNames: Record<string, string> = {};
          data.data.models.forEach((m: { model_id: string; model_name: string }) => {
            newDisplayNames[m.model_id] = m.model_name;
          });
          setModelDisplayNames(newDisplayNames);
        }
      } catch (error) {
        console.error('Failed to fetch model config:', error);
      }
    };
    fetchConfig();
  }, []);
  
  // 监听管理后台修改事件，刷新模型配置和名称
  useEffect(() => {
    const handleCreditsUpdated = () => {
      console.log('[ImageGeneratorPanel] 收到管理后台更新通知，刷新模型配置');
      const fetchConfig = async () => {
        try {
          const res = await fetch('/api/config?service_type=image_generation');
          const data = await res.json();
          if (data.success && data.data?.models) {
            const newConfig: Record<string, {
              resolutions: { size: string; credits: number }[];
              aspectRatios: string[];
            }> = {};
            data.data.models.forEach((m: { model_id: string; model_name: string; parameters: any; credits_base?: number }) => {
              const dbResolutions = m.parameters?.resolutions || [];
              
              newConfig[m.model_id] = {
                resolutions: dbResolutions.map((r: any) => ({
                  size: r.label || r.value,
                  credits: r.credits || m.credits_base || 10,
                })),
                aspectRatios: (m.parameters?.aspectRatios || []).map((r: any) => r.value || r.label),
              };
            });
            setModelConfig(newConfig);
            
            // 更新模型显示名称映射
            const newDisplayNames: Record<string, string> = {};
            data.data.models.forEach((m: { model_id: string; model_name: string }) => {
              newDisplayNames[m.model_id] = m.model_name;
            });
            setModelDisplayNames(newDisplayNames);
          }
        } catch (error) {
          console.error('Failed to refresh model config:', error);
        }
      };
      fetchConfig();
    };

    window.addEventListener('modelCreditsUpdated', handleCreditsUpdated);
    window.addEventListener('storage', handleCreditsUpdated);
    
    return () => {
      window.removeEventListener('modelCreditsUpdated', handleCreditsUpdated);
      window.removeEventListener('storage', handleCreditsUpdated);
    };
  }, []);
  
  // 兜底配置
  const fallbackConfig = {
    resolutions: [{ size: '1K', credits: 10 }],
    aspectRatios: baseAspectRatios,
  };
  
  const currentConfig = modelConfig[model] || fallbackConfig;
  const resolutions = currentConfig?.resolutions?.map(r => r.size) || ['1K'];
  const ratios = currentConfig?.aspectRatios || baseAspectRatios;
  
  // 模型显示名称映射
  
  const selectedModelName = modelDisplayNames[model] || model;
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
                  {modelDisplayNames[key] || key}
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
                {resolutions.map((res) => (
                  <div
                    key={res}
                    onClick={() => { setResolution(res); setShowResMenu(false); }}
                    style={{
                      padding: '8px 14px',
                      fontSize: 13,
                      cursor: 'pointer',
                      textAlign: 'center',
                      background: selectedRes === res ? '#F0F7FF' : 'transparent',
                      color: selectedRes === res ? '#40A9FF' : '#333',
                    }}
                    className="hover:bg-gray-50"
                  >
                    {res}
                  </div>
                ))}
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
  { divider: true },
  { id: 'smartSplit', icon: 'split', name: '智能分割' },
];

// 模型配置类型定义
interface ModelConfigItem {
  resolutions?: { size: string; credits: number }[];
  aspectRatios?: string[];
  type: 'image' | 'video' | 'tool';
  supportsDuration?: boolean;
  credits?: number; // 工具模型的积分
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
  // 【isLoggedIn, credits, userId 已由 AIGeneratorContext 统一管理】
  // const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  
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
      <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900 overflow-hidden">
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
  return <CanvasApp canvas={canvas} router={router} />;
}

// #032 修复：将 Canvas 主逻辑分离到独立组件
// 这样 use State 的初始值可以使用 canvas.state 的存档值
// 【isLoggedIn 已由 AIGeneratorContext 统一管理】
function CanvasApp({ canvas, router }: { canvas: CanvasContextType; router: ReturnType<typeof useRouter> }) {
  // ============================================
  // 【签名 URL 缓存 Hook - 触发浏览器 Disk Cache】
  // ============================================
  const { getUrls: getPresignedUrlsFromHook } = usePresignedUrl();
  
  // ============================================
  // 【AI 生成器 Context - 统一用户状态（由 CanvasApp 使用）】
  // ============================================
  // 注意：isLoggedIn, credits, userId 已在 CanvasApp 中从 Context 获取
  // MainApp 不需要这些状态，CanvasApp 会通过 props 传递需要的值
  
  // 【状态已迁移到 AIGeneratorContext】
  // 必须在所有使用这些变量的代码之前调用 useAIGenerator()
  const {
    handleGenerate,
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
  } = useAIGenerator();
  
  // 兼容旧的变量名
  const isLoggedIn = ctxIsLoggedIn;
  const credits = ctxCredits;
  const userId = ctxUserId;
  const setCredits = ctxSetCredits;
  const setUserId = ctxSetUserId;
  
  // 画布工具状态（本地）
  const [activeTool, setActiveTool] = useState<string>('select');
  const activeToolRef = useRef<string>('select'); // 用于在事件处理中获取最新值
  
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
        toast.error('请先登录后再收藏提示词');
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
    console.log('[删除收藏] 开始删除, id:', id);
    try {
      // #109 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch(`/api/prompt-favorites?id=${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      console.log('[删除收藏] API返回:', data);
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
        // 获取图片生成模型
        const imageRes = await fetch('/api/config?service_type=image_generation');
        const imageData = await imageRes.json();
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
                size: r.label || r.value,
                credits: r.credits || m.credits_base || 10,
              })),
              aspectRatios: dbAspectRatios,
            };
          });
          setModelConfig(newConfig);
          console.log('[Model Config] 从数据库加载模型配置:', Object.keys(newConfig).length, '个模型');
        }
      } catch (error) {
        console.error('Failed to fetch image model options:', error);
      }
      
      try {
        // 获取视频生成模型
        const videoRes = await fetch('/api/config?service_type=video_generation');
        const videoData = await videoRes.json();
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
                  size: r.label || r.value,
                  credits: r.credits || 10,
                }));
                
                // 如果已有配置，合并；否则新建
                if (newConfig[m.model_id]) {
                  newConfig[m.model_id] = {
                    ...newConfig[m.model_id],
                    resolutions: dbResolutions.length > 0 ? dbResolutions : newConfig[m.model_id].resolutions,
                    aspectRatios: dbAspectRatios.length > 0 ? dbAspectRatios : newConfig[m.model_id].aspectRatios,
                    supportsDuration: m.parameters.durations ? true : newConfig[m.model_id].supportsDuration,
                  };
                } else {
                  // 数据库有但默认没有，新建配置（空值使用默认比例列表）
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
        }
      } catch (error) {
        console.error('Failed to fetch video model options:', error);
      }

      // 获取工具模型配置（智能分割、超分等）
      try {
        const toolRes = await fetch('/api/config?service_type=tool');
        const toolData = await toolRes.json();
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
          console.log('[Model Config] 从数据库加载工具模型配置:', models.length, '个模型');
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
  
  // 【credits 和 userId 已由 AIGeneratorContext 统一管理】
  // const [credits, setCredits] = useState(0);
  // const [userId, setUserId] = useState<string | null>(null);

  // 【积分更新已由 AIGeneratorContext 统一管理】
  // const updateCredits = useCallback((newCredits: number) => {
  //   setCredits(newCredits);
  //   // 同步更新用户缓存
  //   updateCachedCredits(newCredits);
  //   // 触发全局事件，通知 Navbar 刷新
  //   if (typeof window !== 'undefined') {
  //     window.dispatchEvent(new CustomEvent('creditsChanged'));
  //   }
  // }, []);

  // 【用户信息和积分变化已由 AIGeneratorContext 统一管理】
  // 获取用户信息和积分
  // useEffect(() => {
  //   const fetchUserInfo = async () => {
  //     try {
  //       const user = await fetchUserWithCache();
  //       if (user) {
  //         setIsLoggedIn(true);
  //         setCredits(user.credits);
  //         setUserId(user.id);
  //       } else {
  //         setIsLoggedIn(false);
  //       }
  //     } catch (error) {
  //       console.error('获取用户信息失败:', error);
  //       setIsLoggedIn(false);
  //     }
  //   };
  //   
  //   fetchUserInfo();
  //   
  //   // 监听积分变化事件
  //   const handleCreditsChanged = () => {
  //     fetchUserInfo();
  //   };
  //   window.addEventListener('creditsChanged', handleCreditsChanged);
  //   return () => window.removeEventListener('creditsChanged', handleCreditsChanged);
  // }, [setIsLoggedIn, setCredits, setUserId]);
  
  // 对话框中的图片列表 - 从 Context 获取（与 RightPanel 共享状态）
  // 四套数据：base64、签名URL、MD5、COS key
  // 注意：这些状态已迁移到 AIGeneratorContext，不再本地定义
  
  // ====== 对话框数据持久化 ======
  // 页面加载时恢复数据
  useEffect(() => {
    const restoreDialogData = async () => {
      try {
        // 1. 恢复消息历史
        const savedMessages = loadMessages();
        console.log('[Canvas Dialog] 加载消息历史:', savedMessages.length, '条');
        
        if (savedMessages.length > 0) {
          // 使用旁路缓存恢复图片 URL（增量方案，不侵入核心类型）
          const messagesWithRefreshedImages = await Promise.all(
            savedMessages.map(async (msg) => {
              console.log('[Canvas Dialog] 检查消息:', msg.id, 'imageUrl:', msg.imageUrl?.substring(0, 50));
              
              // 从旁路缓存获取 imageKey
              const imageKeys = getImageKeyMapping(msg.id);
              console.log('[Canvas Dialog] imageKey 映射:', msg.id, '→', imageKeys);
              
              if (imageKeys && imageKeys.length > 0 && msg.imageUrl) {
                try {
                  console.log('[Canvas Dialog] 尝试刷新 URL（带缓存）, keys:', imageKeys);
                  // 🔧 #209 使用签名 URL 缓存机制，触发浏览器 Disk Cache
                  // 🔧 #214 修复：提供 fetchNewUrls 函数
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
                  const newUrls = await getPresignedUrls(imageKeys, fetchNewUrls);
                  console.log('[Canvas Dialog] 刷新 URL 响应:', Object.keys(newUrls).length, '个');
                  const validUrls = Object.values(newUrls).filter(Boolean);
                  if (validUrls.length > 0) {
                    console.log('[Canvas Dialog] 刷新 URL 成功（缓存已更新）:', validUrls[0]?.substring(0, 50));
                    return { ...msg, imageUrl: validUrls[0] };
                  }
                } catch (e) {
                  console.warn('[Canvas Dialog] 刷新图片 URL 失败:', msg.id, e);
                }
              }
              
              // 🔧 #040 修复：恢复参考图 URL
              if (msg.referenceImageKeys && msg.referenceImageKeys.length > 0) {
                try {
                  console.log('[Canvas Dialog] 恢复参考图, keys:', msg.referenceImageKeys);
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
                  const refUrls = await getPresignedUrls(msg.referenceImageKeys, fetchNewUrls);
                  const validRefUrls = Object.values(refUrls).filter(Boolean);
                  if (validRefUrls.length > 0) {
                    console.log('[Canvas Dialog] 恢复参考图成功:', validRefUrls.length, '张');
                    return { ...msg, referenceImages: validRefUrls };
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
                  console.log('[Canvas Dialog] 恢复助手消息生成图, key:', msg.imageUrlKey);
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
                  const urls = await getPresignedUrls([msg.imageUrlKey], fetchNewUrls);
                  const validUrls = Object.values(urls).filter(Boolean);
                  if (validUrls.length > 0) {
                    console.log('[Canvas Dialog] 恢复助手消息生成图成功');
                    return { ...msg, imageUrl: validUrls[0] };
                  }
                } catch (e) {
                  console.warn('[Canvas Dialog] 恢复助手消息生成图失败:', msg.id, e);
                }
              }
              return msg;
            })
          );
          
          setMessages(messagesWithAllImages);
          console.log('[Canvas Dialog] 恢复消息历史完成:', messagesWithAllImages.length, '条');
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

          setChatImageBase64s(base64s);
          setChatImageUrls(urls);
          setChatImageMd5s(md5s);
          setChatImageNames(names);

          console.log('[Canvas Dialog] 恢复参考图:', savedImages.length, '张');
        }

        // 4. 重新进入页面时，展开功能组件（欢迎语等）
        setIsFeaturesCollapsed(false);
        console.log('[Canvas Dialog] 功能组件已展开');
      } catch (error) {
        console.error('[Canvas Dialog] 恢复数据失败:', error);
      }
    };

    restoreDialogData();
  }, []);  // 空依赖，只在组件挂载时执行一次
  
  // 保存消息历史（防抖）
  useEffect(() => {
    const timer = setTimeout(() => {
      // 过滤掉正在生成的消息
      const messagesToSave = messages.filter(msg => !msg.isGenerating);
      if (messagesToSave.length > 0) {
        saveMessages(messagesToSave);
      }
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
  
  
  // 右侧面板收起状态和宽度
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const panelResizeRef = useRef<{ startX: number; startWidth: number }>({ startX: 0, startWidth: 380 });
  
  // 功能组件折叠状态（欢迎区域和推荐模板）
  const [isFeaturesCollapsed, setIsFeaturesCollapsed] = useState(false);
  
  // 画布配置（欢迎语、工具组件等）
  const [canvasConfig, setCanvasConfig] = useState<any[]>([]);
  
  // 获取画布配置
  useEffect(() => {
    const fetchCanvasConfig = async () => {
      try {
        const res = await fetch('/api/canvas-config');
        const data = await res.json();
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
  const messageListRef = useRef<HTMLDivElement>(null);  // 消息列表容器引用
  const taskIdToElementIdRef = useRef<Map<string, string>>(new Map());  // taskId -> elementId 映射（避免 React 异步状态更新问题）
  const placeholderSizeRef = useRef<Map<string, { width: number; height: number }>>(new Map());  // taskId -> 占位符原始尺寸
  const placeholderPositionsRef = useRef<Map<string, { left: number; top: number; right: number; bottom: number }>>(new Map());  // taskId -> 占位符位置（用于连续任务的空白检测）
  const recentlyAddedImagesRef = useRef<{ left: number; top: number; right: number; bottom: number }[]>([]);  // 最近添加的图片位置（解决状态更新延迟问题）
  const chatImageMd5ToIdxRef = useRef<Map<string, number>>(new Map());  // 🔧 #222 修复：md5 -> 索引映射（避免闭包陷阱）
  
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
    if (typeof window !== 'undefined') {
      try {
        const saved = JSON.parse(localStorage.getItem('canvas_data') || '{}');
        if (saved.zoom !== undefined) {
          console.log('[useState zoom] 从 localStorage 读取:', saved.zoom / 100);
          return saved.zoom / 100;
        }
      } catch (e) {}
    }
    // 如果没有 localStorage，使用 canvas.state
    console.log('[useState zoom] 使用默认值:', canvas.state.zoom / 100);
    return canvas.state.zoom / 100;
  });
  
  const [pan, setPan] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = JSON.parse(localStorage.getItem('canvas_data') || '{}');
        if (saved.panX !== undefined && saved.panY !== undefined) {
          console.log('[useState pan] 从 localStorage 读取:', { x: saved.panX, y: saved.panY });
          return { x: saved.panX, y: saved.panY };
        }
      } catch (e) {}
    }
    // 如果没有 localStorage，使用 canvas.state
    console.log('[useState pan] 使用默认值:', { x: canvas.state.panX, y: canvas.state.panY });
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
        const dim = await getImageDimensionsCore(imageUrl);
        naturalWidth = dim.width;
        naturalHeight = dim.height;
      } catch {
        naturalWidth = size.width;
        naturalHeight = size.height;
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
      console.log('[Canvas 巡逻] ✅ 已恢复占位符 → 实际图片, clientId:', clientId);
    };

    // 标记占位符失败（只有后端明确返回 failed 才调用）
    // 实锤失败后才调用（连续3次 failed 确认）
    const confirmFailed = (elementId: string, clientId: string, error: string) => {
      canvas.updateElement(elementId, {
        generationStatus: 'failed',
        generationError: error,
      });
      placeholderPositionsRef.current.delete(clientId);
      console.log('[Canvas 巡逻] ❌ 实锤失败（连续3次确认）, clientId:', clientId, 'error:', error);
    };

    const clearPollingTimer = (pollingKey: string) => {
      const timer = pollingTimers.get(pollingKey);
      if (timer) {
        clearInterval(timer);
        pollingTimers.delete(pollingKey);
      }
      failedCountMap.delete(pollingKey);
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
      console.log(`[Canvas 巡逻] 📝 订阅任务 ${taskKey}, index=${subscriberKey}, 当前订阅数: ${subscribers.size}`);
      
      // 检查是否已有该任务的轮询
      if (pollingTimers.has(taskKey)) {
        console.log(`[Canvas 巡逻] ⏭️ 任务 ${taskKey} 已有轮询，直接加入订阅`);
        return;
      }

      let pollCount = 0;
      // #102 修复：幽灵任务检测 - 只用于任务确实不存在的情况
      let ghostTaskCount = 0;
      const GHOST_TASK_THRESHOLD = 10;

      const timer = setInterval(async () => {
        pollCount++;
        if (pollCount > MAX_POLL_COUNT) {
          clearPollingTimer(taskKey);
          console.log('[Canvas 巡逻] ⏰ 轮询超时（10分钟），停止轮询, taskKey:', taskKey);
          
          // 🔧 #208 修复：轮询超时标记占位符为失败状态
          // taskKey 就是 actualTaskId，直接用它查找 elementId
          const elementId = taskIdToElementIdRef.current.get(taskKey);
          if (elementId) {
            const el = canvas.state.elements.find(e => e.id === elementId);
            // 只有当占位符还在生成中时才标记失败（避免覆盖已完成的图片）
            if (el && el.generationStatus === 'generating') {
              console.log('[Canvas 巡逻] 🔴 标记占位符为轮询超时: elementId=', elementId);
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
          
          // #102 修复：打印后端返回数据，便于调试
          console.log(`[Canvas 巡逻] 📦 后端返回数据 (pollCount: ${pollCount}):`, JSON.stringify({
            success: data.success,
            status: data.status,
            imageUrls: data.imageUrls?.length || 0,
            imageItems: data.imageItems?.map((item: any) => ({ index: item.index, status: item.status, url: item.url ? '有' : '无' })) || [],
          }));
          
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
              
              console.log(`[Canvas 巡逻] 📦 处理订阅者 index=${subscriberIndex}:`, JSON.stringify({
                status: targetItem?.status,
                url: targetItem?.url ? '有' : '无',
              }));
              
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
              console.log(`[Canvas 巡逻] ✅ 所有订阅者已完成，停止轮询, taskKey:`, taskKey);
              clearPollingTimer(taskKey);
              return;
            }

            console.log(`[Canvas 巡逻] 🔄 轮询中 (${pollCount}/${MAX_POLL_COUNT}), taskKey:`, taskKey, `, 剩余订阅: ${subscribers.size}`);
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
          console.log(`[Canvas 巡逻] 🔄 轮询中 (${pollCount}/${MAX_POLL_COUNT}), taskKey:`, taskKey);
        } catch (err) {
          console.warn('[Canvas 巡逻] ⚠️ 网络异常，继续轮询, taskKey:', taskKey, err);
        }
      }, POLL_INTERVAL);

      pollingTimers.set(taskKey, timer);
    };

    const initPatrol = async () => {
      console.log('[Canvas 巡逻] 🔍 开始巡逻检查...');
      console.log('[Canvas 巡逻] canvas.state.elements 数量:', canvas.state.elements.length);
      
      // 输出所有元素的状态
      canvas.state.elements.forEach((el: any, index: number) => {
        if (el.generationStatus || el.generationClientId) {
          console.log(`[Canvas 巡逻] 元素[${index}]:`, {
            id: el.id,
            type: el.type,
            generationStatus: el.generationStatus,
            generationClientId: el.generationClientId,
            generationTaskId: el.generationTaskId,
            generationIndex: el.generationIndex,
          });
        }
      });

      const generatingEls = canvas.state.elements.filter(
        (el: any) => (el.generationStatus === 'generating' || el.generationStatus === 'recovering' || el.generationStatus === 'submitted') && el.generationClientId
      ) as any[];

      if (generatingEls.length === 0) {
        console.log('[Canvas 巡逻] 无需恢复，所有元素状态正常');
        return;
      }

      console.log('[Canvas 巡逻] 🔍 发现', generatingEls.length, '个 generating 元素，开始恢复...');

      // 恢复映射表
      for (const el of generatingEls) {
        // 【干净数据结构】直接读取独立字段
        const clientId = el.generationClientId || '';
        if (!clientId) continue;
        taskIdToElementIdRef.current.set(clientId, el.id);
        placeholderSizeRef.current.set(clientId, { width: el.width, height: el.height });
        console.log('[Canvas 巡逻] 恢复映射:', clientId, '→', el.id, `(${el.width}x${el.height})`);
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

        console.log('[Canvas 巡逻] 🚀 启动轮询恢复, actualTaskId:', actualTaskId, 'clientId:', clientId);
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
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      handleBeforeUnload();
      window.removeEventListener('beforeunload', handleBeforeUnload);
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
      
      console.log('[画布初始化] 居中计算:', {
        containerSize: `${containerSize.width} x ${containerSize.height}`,
        canvasSize: `${CANVAS_WIDTH} x ${CANVAS_HEIGHT}`,
        zoom: zoom.toFixed(4),
        centerPan: `${Math.round(centerPanX)}, ${Math.round(centerPanY)}`
      });
      
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
  const aspectRatioOptions: string[] = (rawConfig?.aspectRatios?.length ?? 0) > 0 ? rawConfig!.aspectRatios! as string[] : baseAspectRatios;
  const currentConfig = {
    ...rawConfig,
    resolutions: resolutionOptions || [{ size: '1K', credits: 10 }],
    aspectRatios: aspectRatioOptions || baseAspectRatios,
    type: (rawConfig as any)?.type || 'image' as const,
  };

  const handleToolClick = useCallback((toolId: string) => {
    setActiveTool(toolId);
    activeToolRef.current = toolId; // 同步更新 ref
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
      case 'smartSplit':
        setShowGridModal(true);
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
    
    // 检查画布中是否有图片
    const hasExistingImages = canvas.state.elements.some(el => el.type === 'image');
    
    const container = canvasContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    
    // 读取所有图片的尺寸信息
    const imageInfos: { file: File; width: number; height: number; url: string }[] = [];
    
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      
      await new Promise<void>((resolve) => {
        img.onload = () => {
          imageInfos.push({
            file,
            width: img.naturalWidth,
            height: img.naturalHeight,
            url
          });
          resolve();
        };
        img.onerror = () => resolve();
        img.src = url;
      });
    }
    
    if (imageInfos.length === 0) {
      e.target.value = '';
      return;
    }
    
    // 🔧 #146 修复：容器尺寸防御性检查
    const effectiveContainerWidth = containerRect.width || 1920;
    const effectiveContainerHeight = containerRect.height || 826;
    
    console.log('[上传] 容器尺寸:', containerRect.width, 'x', containerRect.height, '| 有效尺寸:', effectiveContainerWidth, 'x', effectiveContainerHeight);
    console.log('[上传] 当前 zoom:', zoom, '| pan:', pan.x, pan.y);
    
    // ====== 使用统一布局计算函数 ======
    const { calculateImageGroupLayout, CANVAS_IMAGE_RULES } = await import('@/lib/canvas-image-layout');
    
    const layout = calculateImageGroupLayout({
      imageCount: imageInfos.length,
      imageDimensions: imageInfos.map(info => ({ width: info.width, height: info.height })),
      containerWidth: effectiveContainerWidth,
      containerHeight: effectiveContainerHeight,
      currentZoom: zoom,
    });
    
    console.log('[上传布局]', {
      图片数量: imageInfos.length,
      屏幕占比: `${layout.screenRatio * 100}%`,
      网格: `${layout.cols}x${layout.rows}`,
      总尺寸: `${Math.round(layout.totalWidth)}x${Math.round(layout.totalHeight)}`,
      画布尺寸: `${CANVAS_WIDTH}x${CANVAS_HEIGHT}`,
    });
    
    // ====== 计算居中位置 ======
    // 图片放在画布中心 (CANVAS_WIDTH/2, CANVAS_HEIGHT/2)
    let targetLeft = CANVAS_WIDTH / 2 - layout.totalWidth / 2;
    let targetTop = CANVAS_HEIGHT / 2 - layout.totalHeight / 2;
    
    console.log('[上传] 画布中心居中:', {
      画布中心: `${CANVAS_WIDTH / 2}, ${CANVAS_HEIGHT / 2}`,
      目标位置: `${Math.round(targetLeft)}, ${Math.round(targetTop)}`,
    });
    
    // ====== 空白检测偏移（仅当画布有现有图片时）======
    if (hasExistingImages) {
      const existingImages: { left: number; top: number; right: number; bottom: number; id: string }[] = [];
      const allElements = canvas.state.elements || [];
      
      allElements.forEach((el: any) => {
        if (el.type === 'image' && el.width > 0 && el.height > 0) {
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
        
        for (const img of allExistingImages) {
          const overlaps = !(groupRight <= img.left || 
                           groupLeft >= img.right || 
                           groupBottom <= img.top || 
                           groupTop >= img.bottom);
          if (overlaps) return true;
        }
        return false;
      };
      
      if (isOverlapping(targetLeft, targetTop)) {
        const offsets = IMAGE_OVERLAP_OFFSETS;
        let foundSpace = false;
        
        // 优先级：上 → 下 → 左 → 右
        for (const offset of offsets) {
          const newTop = targetTop - offset;
          if (newTop >= 0 && !isOverlapping(targetLeft, newTop)) {
            targetTop = newTop;
            foundSpace = true;
            break;
          }
        }
        
        if (!foundSpace) {
          for (const offset of offsets) {
            const newTop = targetTop + offset;
            if (newTop + layout.totalHeight <= CANVAS_HEIGHT && !isOverlapping(targetLeft, newTop)) {
              targetTop = newTop;
              foundSpace = true;
              break;
            }
          }
        }
        
        if (!foundSpace) {
          for (const offset of offsets) {
            const newLeft = targetLeft - offset;
            if (newLeft >= 0 && !isOverlapping(newLeft, targetTop)) {
              targetLeft = newLeft;
              foundSpace = true;
              break;
            }
          }
        }
        
        if (!foundSpace) {
          for (const offset of offsets) {
            const newLeft = targetLeft + offset;
            if (newLeft + layout.totalWidth <= CANVAS_WIDTH && !isOverlapping(newLeft, targetTop)) {
              targetLeft = newLeft;
              foundSpace = true;
              break;
            }
          }
        }
      }
    }
    
    // 确定最终位置（边界检查）
    let finalLeft = targetLeft;
    let finalTop = targetTop;
    if (finalLeft < 0) finalLeft = 0;
    if (finalTop < 0) finalTop = 0;
    if (finalLeft + layout.totalWidth > CANVAS_WIDTH) finalLeft = CANVAS_WIDTH - layout.totalWidth;
    if (finalTop + layout.totalHeight > CANVAS_HEIGHT) finalTop = CANVAS_HEIGHT - layout.totalHeight;
    
    // ====== 记录新图片位置到 ref ======
    const newImagePositions: { left: number; top: number; right: number; bottom: number }[] = [];
    for (let i = 0; i < layout.images.length; i++) {
      const imgLayout = layout.images[i];
      const imgX = finalLeft + imgLayout.x;
      const imgY = finalTop + imgLayout.y;
      newImagePositions.push({
        left: imgX,
        top: imgY,
        right: imgX + imgLayout.width,
        bottom: imgY + imgLayout.height,
      });
    }
    recentlyAddedImagesRef.current = [...recentlyAddedImagesRef.current, ...newImagePositions].slice(-100);
    
    // ====== 添加图片 ======
    const importViewportInfo = {
      zoom,
      panX: pan.x,
      panY: pan.y,
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
    };
    
    // 🔧 #136 修复：并行处理图片上传，而非串行
    console.log('[上传] 开始并行处理', imageInfos.length, '张图片');
    const startTime = Date.now();
    
    await Promise.all(imageInfos.map(async (info, i) => {
      const imgLayout = layout.images[i];
      const imgX = finalLeft + imgLayout.x;
      const imgY = finalTop + imgLayout.y;
      
      await canvas.importImage(
        info.file,
        { x: imgX, y: imgY },
        importViewportInfo,
        { width: imgLayout.width, height: imgLayout.height }
      );
    }));
    
    console.log('[上传] 并行处理完成，耗时:', Date.now() - startTime, 'ms');
    
    // ====== 镜头切换 ======
    const groupCenterX = finalLeft + layout.totalWidth / 2;
    const groupCenterY = finalTop + layout.totalHeight / 2;
    const newPanX = effectiveContainerWidth / 2 - groupCenterX * layout.zoom;
    const newPanY = effectiveContainerHeight / 2 - groupCenterY * layout.zoom;
    
    console.log('[上传] 切换镜头:', {
      图片组中心: `${Math.round(groupCenterX)},${Math.round(groupCenterY)}`,
      zoom: layout.zoom.toFixed(2),
      pan: `${Math.round(newPanX)},${Math.round(newPanY)}`,
    });
    
    setZoom(layout.zoom);
    setPan({ x: newPanX, y: newPanY });
    
    e.target.value = '';
  }, [canvas, pan, zoom, CANVAS_WIDTH, CANVAS_HEIGHT]);

  // ====== 分割图片自动添加到画布 ======
  const handleAddSplitImagesToCanvas = useCallback(async (splitImages: string[]) => {
    if (!canvasContainerRef.current || splitImages.length === 0) return;
    
    try {
      console.log('[分割] 自动添加到画布，图片数:', splitImages.length);
      console.log('[分割] 第一张图片 URL 类型:', splitImages[0]?.substring(0, 50));
      
      const containerRect = canvasContainerRef.current.getBoundingClientRect();
      console.log('[分割] 容器尺寸:', containerRect.width, 'x', containerRect.height);
      
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
          return URL.createObjectURL(blob);
        } catch {
          return base64; // 如果转换失败，直接使用原数据
        }
      });
      console.log('[分割] #142 本地 blob URL 已生成，瞬间预览');
      
      // ====== 获取每张图片的实际尺寸 ======
      const imageDimensions = await Promise.all(localUrls.map(src => getImageDimensionsCore(src)));
      
      // ====== 使用统一布局计算函数 ======
      const { calculateImageGroupLayout } = await import('@/lib/canvas-image-layout');
      
      const layout = calculateImageGroupLayout({
        imageCount: splitImages.length,
        imageDimensions,
        containerWidth: effectiveWidth,
        containerHeight: effectiveHeight,
        currentZoom: zoom, // 🔧 #145 修复：和 handleFileImport 保持一致
      });
      
      console.log('[分割布局]', {
        图片数量: splitImages.length,
        图片尺寸: imageDimensions.map(d => `${d.width}x${d.height}`),
        屏幕占比: `${layout.screenRatio * 100}%`,
        网格: `${layout.cols}x${layout.rows}`,
        总尺寸: `${Math.round(layout.totalWidth)}x${Math.round(layout.totalHeight)}`,
        镜头缩放: layout.zoom.toFixed(2),
        当前zoom: zoom.toFixed(2),
        当前pan: `(${Math.round(pan.x)}, ${Math.round(pan.y)})`,
      });
      
      // ====== 获取画布上现有的图片元素 ======
      const existingImages: { left: number; top: number; right: number; bottom: number }[] = [];
      canvas.state.elements
        .filter(el => el.type === 'image')
        .forEach(el => {
          existingImages.push({
            left: el.x,
            top: el.y,
            right: el.x + el.width,
            bottom: el.y + el.height,
          });
        });
      
      console.log('[分割] 现有图片数量:', existingImages.length);
      
      // 图片放在画布中心 (CANVAS_WIDTH/2, CANVAS_HEIGHT/2)
      let targetLeft = CANVAS_WIDTH / 2 - layout.totalWidth / 2;
      let targetTop = CANVAS_HEIGHT / 2 - layout.totalHeight / 2;
      
      console.log('[分割] 画布中心居中:', {
        画布中心: `${CANVAS_WIDTH / 2}, ${CANVAS_HEIGHT / 2}`,
        目标位置: `${Math.round(targetLeft)}, ${Math.round(targetTop)}`,
      });
      
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
      
      console.log('[分割] 最终位置:', Math.round(finalLeft), Math.round(finalTop));
      
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
        });
        elementIds.push(elementId);
        
        console.log(`[分割] 添加元素 #${i + 1}:`, {
          id: elementId,
          imageUrl: imgUrl?.substring(0, 60),
        });
      });
      
      console.log('[分割] #142 本地预览已完成，用户可立即看到图片');
      
      // ====== 后台静默上传 COS（不阻塞用户操作）======
      console.log('[分割] #142 后台静默上传 COS...');
      fetch('/api/canvas/upload-base64', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: splitImages }),
      })
        .then(res => res.json())
        .then(uploadData => {
          console.log('[分割] #142 COS 上传完成:', uploadData.success ? '成功' : '失败');
          
          if (uploadData.success && uploadData.images?.length > 0) {
            const cosUrls = uploadData.images.map((img: { key: string; url: string }) => img.url);
            const imageKeys = uploadData.images.map((img: { key: string; url: string }) => img.key);
            
            // 更新元素的 imageUrl 和 imageKey
            elementIds.forEach((elementId, i) => {
              const element = canvas.state.elements.find(el => el.id === elementId);
              if (element) {
                canvas.updateElement(elementId, {
                  imageUrl: cosUrls[i],
                  imageKey: imageKeys[i],
                });
              }
            });
            
            console.log('[分割] #142 COS URL 已静默替换本地 URL');
            
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
                  storeImageByKey(imageKey, blob, mimeString).then(success => {
                    if (success) {
                      console.log('[分割] #150 已缓存到 IndexedDB:', imageKey);
                    }
                  }).catch(console.error);
                } catch (err) {
                  console.error('[分割] #150 缓存失败:', imageKey, err);
                }
              });
            }).catch(console.error);
            
            // #149 修复：强制保存到 localStorage，确保刷新后图片不丢失
            canvas.forceSaveToStorage();
            console.log('[分割] #149 已强制保存 imageKey 到 localStorage');
            
            // 释放 blob URL 内存
            localUrls.forEach(url => {
              try { URL.revokeObjectURL(url); } catch {}
            });
            
            // ====== #232 Sprint 3：智能分割保存到数据库 ======
            try {
              const userId = localStorage.getItem('user_id');
              if (userId && imageKeys.length > 0) {
                const uploadedImage = gridUploadedImages[0] || {};
                
                // 🔒 强制使用 taskId（UUID）作为主键，消灭 Date.now()
                const splitTaskId = `split_${crypto.randomUUID()}`;
                
                const record: HistoryRecord = {
                  id: splitTaskId,  // #232: 强制使用 string 类型
                  model: 'smart_split',
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
                      // ✅ API 成功后更新内存状态
                      historyStore.addRecord(record);
                      console.log('[分割] #232 已保存到数据库和内存:', splitTaskId);
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
      
      console.log('[分割] #145 切换镜头:', { center: `${Math.round(groupCenterX)},${Math.round(groupCenterY)}`, zoom: layout.zoom.toFixed(2), pan: `${Math.round(newPanX)},${Math.round(newPanY)}` });
      
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
    console.log('[压缩检查] 图片大小:', actualSizeMB.toFixed(2), 'MB');
    
    // 沙箱环境请求体限制较严，大于 3MB 就压缩
    if (actualSizeMB <= 3) {
      console.log('[压缩检查] 图片大小正常，不压缩');
      return base64;
    }
    
    // 大于 3MB 压缩到 2MB 以内
    console.log('[压缩检查] 图片过大，开始压缩...');
    
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
            console.log(`[压缩检查] WebP 质量 ${quality} 压缩结果: ${resultSizeMB.toFixed(2)} MB`);
            
            if (resultSizeMB <= targetMB) {
              console.log('[压缩检查] 压缩成功');
              return result;
            }
          }
          
          // 如果 WebP 都不行，最后尝试 JPEG
          const result = await tryCompress('image/jpeg', 0.7);
          console.log('[压缩检查] JPEG 压缩结果:', (result.length * 0.75 / 1024 / 1024).toFixed(2), 'MB');
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
    console.log('[imageUrlToBase64 v2] 开始处理 URL:', url.substring(0, 100));
    console.log('[imageUrlToBase64 v2] URL 类型:', typeof url, '长度:', url.length);
    
    // 如果已经是 base64，直接返回
    if (url.startsWith('data:')) {
      console.log('[imageUrlToBase64 v2] 已经是 base64，直接返回');
      return url;
    }
    
    // 对于 http/https URL 或 blob URL，使用 fetch 获取图片
    if (url.startsWith('http') || url.startsWith('blob:')) {
      console.log('[imageUrlToBase64 v2] 使用 fetch 获取图片');
      try {
        const response = await fetch(url);
        console.log('[imageUrlToBase64 v2] fetch 响应状态:', response.status);
        if (!response.ok) {
          throw new Error(`获取图片失败: ${response.status}`);
        }
        const blob = await response.blob();
        console.log('[imageUrlToBase64 v2] blob 大小:', blob.size, 'type:', blob.type);
        
        // 检查是否是图片类型
        if (!blob.type.startsWith('image/')) {
          throw new Error(`返回的不是图片: ${blob.type}`);
        }
        
        console.log('[imageUrlToBase64 v2] fetch 成功, blob 大小:', (blob.size / 1024).toFixed(2), 'KB');
        
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            console.log('[imageUrlToBase64 v2] 转换成功, base64 长度:', result.length);
            resolve(result);
          };
          reader.onerror = () => reject(new Error('读取图片失败'));
          reader.readAsDataURL(blob);
        });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        console.error('[imageUrlToBase64 v2] fetch 方式失败:', errorMessage);
        throw error; // 直接抛出错误，不降级
      }
    }
    
    // 其他情况（不应该到达这里）
    console.error('[imageUrlToBase64 v2] 不支持的 URL 格式:', url.substring(0, 50));
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
            
            console.log(`[切割] 格子(row=${cell.row},col=${cell.col}): (${cell.left}%,${cell.top}%)-(${cell.right}%,${cell.bottom}%) -> 像素(${Math.round(srcX)},${Math.round(srcY)}) ${Math.round(srcW)}x${Math.round(srcH)}`);
            
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
  const updatePlaceholder = useCallback(async (taskId: string, imageUrl: string, imageKey?: string) => {
    const callTime = Date.now();
    console.log(`[updatePlaceholder #${callTime}] 开始执行, taskId=${taskId?.substring(0, 15)}`);
    
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
    
    console.log(`[updatePlaceholder #${callTime}] 映射正确: taskId=${taskId?.substring(0, 15)} → elementId=${elementId}`);

    let naturalWidth: number, naturalHeight: number;
    try {
      console.log(`[updatePlaceholder #${callTime}] 开始获取图片尺寸...`);
      const dimensions = await getImageDimensionsCore(imageUrl);
      naturalWidth = dimensions.width;
      naturalHeight = dimensions.height;
      console.log(`[updatePlaceholder #${callTime}] 获取尺寸完成: ${naturalWidth}×${naturalHeight}, taskId=${taskId?.substring(0, 15)}`);
    } catch {
      canvas.updateElement(elementId, { generationStatus: 'failed', generationError: '图片加载失败' });
      return;
    }

    let newWidth: number, newHeight: number;
    if (naturalWidth > 0 && naturalHeight > 0) {
      const aspectRatio = naturalWidth / naturalHeight;
      const placeholderRatio = placeholderSize.width / placeholderSize.height;
      console.log(`[updatePlaceholder #${callTime}] 比例计算:`, { 
        taskId: taskId?.substring(0, 15),
        aspectRatio: aspectRatio.toFixed(4), 
        placeholderRatio: placeholderRatio.toFixed(4), 
        '图片比例': `${naturalWidth}:${naturalHeight}`,
        '占位符尺寸': `${placeholderSize.width.toFixed(0)}×${placeholderSize.height.toFixed(0)}`,
        'aspectRatio > placeholderRatio': aspectRatio > placeholderRatio 
      });
      
      if (aspectRatio > placeholderSize.width / placeholderSize.height) {
        newWidth = placeholderSize.width;
        newHeight = newWidth / aspectRatio;
      } else {
        newHeight = placeholderSize.height;
        newWidth = newHeight * aspectRatio;
      }
      console.log(`[updatePlaceholder #${callTime}] 计算结果: ${newWidth.toFixed(0)}×${newHeight.toFixed(0)}, taskId=${taskId?.substring(0, 15)}`);
    } else {
      newWidth = placeholderSize.width;
      newHeight = placeholderSize.height;
    }

    // 🔧 #221 修复：方案 C 双保险策略
    // 第一道防线：使用 stateRef 获取最新元素（支持用户拖动后更新）
    // 第二道防线：使用 placeholderPositionsRef 获取初始坐标（兜底）
    const liveElements = canvas.stateRef?.current?.elements || canvas.state.elements;
    const currentEl = liveElements.find((el: any) => el.id === elementId);
    console.log(`[updatePlaceholder #${callTime}] 查找元素: elementId=${elementId}, 找到=${!!currentEl}`, currentEl ? { x: currentEl.x, y: currentEl.y, width: currentEl.width, height: currentEl.height } : null);
    
    if (currentEl) {
      // 🎯 第一道防线命中：元素存在，使用元素的实时位置计算居中（支持用户拖动）
      const centerX = currentEl.x + currentEl.width / 2;
      const centerY = currentEl.y + currentEl.height / 2;
      const newX = centerX - newWidth / 2;
      const newY = centerY - newHeight / 2;
      console.log(`[updatePlaceholder #${callTime}] 🎯 第一道防线命中: 使用实时位置, center=(${centerX.toFixed(0)}, ${centerY.toFixed(0)}), newSize=(${newWidth.toFixed(0)}, ${newHeight.toFixed(0)})`);
      canvas.updateElement(elementId, { imageUrl, imageKey, generationStatus: 'completed', width: newWidth, height: newHeight, x: newX, y: newY });
    } else {
      // 🛡️ 第二道防线：元素不存在，使用 placeholderPositionsRef 初始坐标兜底
      const pos = placeholderPositionsRef.current.get(taskId);
      if (pos) {
        const centerX = (pos.left + pos.right) / 2;
        const centerY = (pos.top + pos.bottom) / 2;
        const newX = centerX - newWidth / 2;
        const newY = centerY - newHeight / 2;
        console.log(`[updatePlaceholder #${callTime}] 🛡️ 第二道防线: 使用初始坐标兜底, center=(${centerX.toFixed(0)}, ${centerY.toFixed(0)})`);
        
        // 🔧 #216 修复：先删除画布上相同 taskId 的旧占位符
        // HMR 后，画布状态可能从 localStorage 恢复了旧占位符，但 taskIdToElementIdRef 映射丢失
        // #218 修复：同时删除 generating 和 failed 状态的占位符
        const oldPlaceholders = liveElements.filter((el: any) => 
          el.generationTaskId === taskId && (el.generationStatus === 'generating' || el.generationStatus === 'failed')
        );
        
        if (oldPlaceholders.length > 0) {
          console.log(`[updatePlaceholder #${callTime}] #218 删除旧占位符: ${oldPlaceholders.length} 个`);
          oldPlaceholders.forEach((el: any) => {
            console.log(`[updatePlaceholder #${callTime}] #218 删除元素: ${el.id}, status=${el.generationStatus}`);
            canvas.deleteElement(el.id);
          });
        }
        
        // 🔧 #208 修复：元素不存在时，尝试重新添加元素到画布
        console.warn(`[updatePlaceholder #${callTime}] ⚠️ 元素不存在，尝试重新添加到画布: elementId=${elementId}`);
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
            imageUrl,
            imageKey,
            generationStatus: 'completed' as const,
          });
          taskIdToElementIdRef.current.set(taskId, newElementId);
          console.log(`[updatePlaceholder #${callTime}] ✅ 成功重新添加元素: oldId=${elementId} → newId=${newElementId}`);
        } catch (addError) {
          console.error(`[updatePlaceholder #${callTime}] ❌ 重新添加元素失败:`, addError);
        }
      } else {
        // 彻底凉了：连初始坐标都找不到
        console.error(`[updatePlaceholder #${callTime}] ❌ 彻底失败: 元素不存在且无初始坐标, elementId=${elementId}, taskId=${taskId}`);
      }
    }
    
    // #150 Local-First：后台异步缓存图片到 IndexedDB
    // 只有有 imageKey 时才缓存（COS 图片）
    if (imageKey && imageUrl) {
      import('@/lib/canvas-image-db').then(({ storeImageByKey }) => {
        // 查重防刷：storeImageByKey 内部会检查 key 是否已存在
        fetch(imageUrl)
          .then(res => res.blob())
          .then(blob => {
            if (blob && blob.size > 0) {
              storeImageByKey(imageKey, blob, blob.type).then(success => {
                if (success) {
                  console.log('[updatePlaceholder] #150 已缓存到 IndexedDB:', imageKey);
                }
              }).catch(console.error);
            }
          })
          .catch(err => {
            console.error('[updatePlaceholder] #150 后台缓存失败:', imageKey, err);
          });
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
  }, [canvas]);

  // 创建占位符并返回 PlaceholderInfo[]
  // #093 修复：增加 taskId 参数，让占位符在创建时就有 generationTaskId
  // #129 修复：增加 options 参数支持 sourceType
  const createPlaceholdersWithClientIds = useCallback((
    clientIds: string[], 
    prompt: string, 
    taskId: string,
    options?: { 
      sourceType?: 'generate' | 'split';  // 默认 'generate'
      namePrefix?: string;                  // 默认使用 prompt 截断
      imageDimensions?: { width: number; height: number }[];  // 🔧 #135 实际图片尺寸
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
    
    // 🔧 #135 修复：分割时使用实际图片尺寸，不使用 selectedRatio
    const layout = calculateImageGroupLayout({
      imageCount,
      imageDimensions: options?.imageDimensions,  // 传入实际图片尺寸
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
      currentZoom: safeZoom,
      ratio: options?.imageDimensions ? undefined : selectedRatio,  // 有实际尺寸时不使用 selectedRatio
    });

    // ====== 空白检测 ======
    const existingImages: { left: number; top: number; right: number; bottom: number }[] = [];
    canvas.state.elements.filter(el => el.type === 'image').forEach(el => existingImages.push({ left: el.x, top: el.y, right: el.x + el.width, bottom: el.y + el.height }));
    placeholderPositionsRef.current.forEach(pos => existingImages.push(pos));

    // 🔧 #130 修复：使用 safeZoom 防止除以 0
    const viewCenterX = (containerRect.width / 2 - pan.x) / safeZoom;
    const viewCenterY = (containerRect.height / 2 - pan.y) / safeZoom;
    const existingCount = canvas.state.elements.length;
    let finalLeft = viewCenterX - layout.totalWidth / 2;
    let finalTop = existingCount === 0 ? viewCenterY - layout.totalHeight / 2 : (Math.max(...canvas.state.elements.map(el => el.y + el.height), 0) + 100);

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
      
      const elementId = canvas.addElement({
        type: 'image', 
        name: sourceType === 'split' ? `分割区域 ${i + 1}` : `${namePrefix} #${i + 1}`,
        x: imgX, y: imgY, width: safeWidth, height: safeHeight, rotation: 0, fill: 'transparent', stroke: 'transparent', strokeWidth: 0, opacity: 1, visible: true, locked: false, aspectRatio: safeAspectRatio,
        sourceType, 
        sourcePrompt: sourceType === 'generate' ? prompt : undefined, // 分割不需要 sourcePrompt
        generationStatus: 'generating',
        // 【干净数据结构】三个独立字段，不使用字符串拼接
        generationClientId: clientId,      // 前端生成的 clientId（不变）
        generationIndex: i,                // 图片索引（不变）
        generationTaskId: taskId,          // #093 修复：直接使用前端预生成的 taskId
      });
      taskIdToElementIdRef.current.set(clientId, elementId);
      placeholderSizeRef.current.set(clientId, { width: safeWidth, height: safeHeight });
      placeholderPositionsRef.current.set(clientId, { left: imgX, top: imgY, right: imgX + safeWidth, bottom: imgY + safeHeight });
      console.log('[createPlaceholders] 创建占位符:', { 
        index: i, 
        clientId, 
        elementId, 
        width: safeWidth, 
        height: safeHeight,
        x: imgX,
        y: imgY
      });
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

    console.log('[占位符布局]', {
      图片数量: imageCount,
      屏幕占比: `${layout.screenRatio * 100}%`,
      网格: `${layout.cols}x${layout.rows}`,
      总尺寸: `${Math.round(layout.totalWidth)}x${Math.round(layout.totalHeight)}`,
      镜头缩放: layout.zoom.toFixed(2),
    });

    return placeholders;
  }, [canvas, zoom, pan, selectedRatio, calculateOverlapOffset]);

  // ====== 创建分割占位符（复用现有机制）======
  const createSplitPlaceholders = useCallback((count: number, imageDimensions?: { width: number; height: number }[]): { placeholderInfos: { id: string; index: number }[]; taskId: string } => {
    // 生成 taskId 和 clientIds
    const taskId = `split_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const clientIds = Array.from({ length: count }, (_, i) => `split_part_${i + 1}_${Date.now()}`);
    
    console.log('[分割占位符] 创建', count, '个占位符，taskId:', taskId);
    console.log('[分割占位符] clientIds:', clientIds);
    console.log('[分割占位符] imageDimensions:', imageDimensions);
    
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
    
    console.log('[分割占位符] 创建完成，placeholderInfos:', placeholderInfos.map(p => ({ id: p.id, index: p.index })));
    
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
    const startTime = Date.now();
    console.log('[分割占位符] 批量更新开始, 占位符数量:', placeholderInfos.length, '图片数量:', imageUrls.length);
    
    // 🔧 #137 极速交互重构：直接批量更新，不使用 requestAnimationFrame
    // React 18 自动批处理会合并多次 setState 为一次渲染
    
    const updateCount = Math.min(placeholderInfos.length, imageUrls.length);
    
    for (let i = 0; i < updateCount; i++) {
      const info = placeholderInfos[i];
      canvas.updateElement(info.id, {
        imageUrl: imageUrls[i],
        imageKey: imageKeys[i] || undefined,
        generationStatus: undefined,
      });
    }
    
    // 处理多余的占位符
    if (placeholderInfos.length > imageUrls.length) {
      for (let i = imageUrls.length; i < placeholderInfos.length; i++) {
        const info = placeholderInfos[i];
        canvas.updateElement(info.id, {
          generationStatus: 'failed',
          generationError: '图片数据缺失',
        });
      }
    }
    
    console.log('[分割占位符] 批量更新完成, 成功:', updateCount, '/', placeholderInfos.length, '耗时:', Date.now() - startTime, 'ms');
  }, [canvas]);

  // #232 Sprint 3：删除 saveGenerationRecord 函数
  // 历史记录保存已由 AIGeneratorContext 统一处理，此函数未被使用

  // ========== 核心：handleSend 使用 handleGenerate 重写 ==========
  const handleSend = useCallback(async () => {
    console.log('[Canvas handleSend] 开始执行');
    const content = inputValue.trim();
    console.log('[Canvas handleSend] inputValue:', content?.substring(0, 50));
    console.log('[Canvas handleSend] selectedModel:', selectedModel);
    console.log('[Canvas handleSend] modelActiveStatus[selectedModel]:', modelActiveStatus[selectedModel]);
    console.log('[Canvas handleSend] isLoggedIn:', isLoggedIn);
    
    if (!content) { 
      console.log('[Canvas handleSend] 提示词为空，返回');
      setInfoDialog({ open: true, title: '请输入提示词', description: '请输入描述您想要生成的内容' }); 
      return; 
    }
    if (modelActiveStatus[selectedModel] === false) { 
      console.log('[Canvas handleSend] 模型离线，返回');
      setInfoDialog({ open: true, title: '模型离线', description: '当前选择的模型暂时不可用，请选择其他在线模型' }); 
      return; 
    }
    if (!isLoggedIn) { 
      console.log('[Canvas handleSend] 未登录，返回');
      window.dispatchEvent(new CustomEvent('openLogin')); 
      return; 
    }

    console.log('[Canvas handleSend] 验证积分...');
    // 验证积分
    const user = await fetchUserWithCache();
    console.log('[Canvas handleSend] user:', user ? { id: user.id, credits: user.credits } : null);
    if (!user) { 
      console.log('[Canvas handleSend] 获取用户信息失败，返回');
      window.dispatchEvent(new CustomEvent('openLogin')); 
      return; 
    }
    const config = modelConfig[selectedModel] || { resolutions: [{ size: '1K', credits: 10 }] };
    const creditCost = (config.resolutions || []).find((r: any) => r.size === selectedResolution)?.credits || 10;
    const requiredCredits = creditCost * selectedCount;
    console.log('[Canvas handleSend] creditCost:', creditCost, 'requiredCredits:', requiredCredits, 'user.credits:', user.credits);
    if (user.credits < requiredCredits) { 
      console.log('[Canvas handleSend] 积分不足，返回');
      setInfoDialog({ open: true, title: '积分不足', description: `当前积分: ${user.credits}，需要: ${requiredCredits}` }); 
      return; 
    }

    console.log('[Canvas handleSend] 所有验证通过，开始生成...');

    try {
      // 🔧 #298 修复：等待所有参考图上传完成（避免 keys 为空）
      const pendingUploads = Array.from(globalPendingUploads.values());
      if (pendingUploads.length > 0) {
        console.log('[Canvas handleSend] 等待', pendingUploads.length, '个上传完成...');
        await Promise.all(pendingUploads);
        console.log('[Canvas handleSend] 所有上传完成');
      }
      
      // 🔧 修复：在开始时就捕获参考图状态（避免 onComplete 回调时状态已变化）
      const capturedRefImages = {
        base64s: [...chatImageBase64s],
        urls: [...chatImageUrls],
        keys: [...chatImageKeys],
        md5s: [...chatImageMd5s],
      };
      console.log('[Canvas handleSend] 捕获参考图状态:', {
        base64sCount: capturedRefImages.base64s.length,
        urlsCount: capturedRefImages.urls.length,
        keysCount: capturedRefImages.keys.length,
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
        referenceImages: capturedRefImages.base64s.length > 0 ? [...capturedRefImages.base64s] : undefined, 
        // 🔧 #040 修复：保存 referenceImageKeys 用于刷新后恢复
        referenceImageKeys: capturedRefImages.keys.length > 0 ? [...capturedRefImages.keys] : undefined,
        specs: { model: modelDisplayNames[selectedModel] || formatModelName(selectedModel), ratio: selectedRatio, resolution: selectedResolution, count: selectedCount } 
      }]);

      // 添加助手消息
      const assistantMsgId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '正在生成图片...', timestamp: Date.now(), isGenerating: true }]);
      setIsFeaturesCollapsed(true);
      setTimeout(() => messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: 'smooth' }), 50);

      // 🔧 #235 修复：优先使用 COS URL，而不是 base64
      // 之前：优先 base64 → 后端存本地 → 服务商访问 kiikii.me → 404
      // 现在：优先 COS URL → 服务商直接访问 COS → 成功
      const validUrls = capturedRefImages.urls.filter(url => url && url.length > 0);
      const hasValidUrls = validUrls.length > 0;
      const hasValidBase64 = capturedRefImages.base64s.length > 0 && capturedRefImages.base64s.every(b => b && b.length > 0);
      
      // 优先级：COS URL > base64
      const images = hasValidUrls ? validUrls : (hasValidBase64 ? capturedRefImages.base64s : []);
      const isUrls = hasValidUrls;  // 使用 COS URL 时 isUrls = true

      console.log('[Canvas handleSend] 参考图:', { hasValidUrls, validUrlsCount: validUrls.length, hasValidBase64, imagesCount: images.length, isUrls });

      // #232 Sprint 3：删除 saveRecordWithCapturedRef 函数
      // 历史记录保存已由 AIGeneratorContext 统一处理

      // 调用统一生成引擎
      await handleGenerate({
      prompt: content,
      model: selectedModel,
      resolution: selectedResolution,
      aspectRatio: selectedRatio,
      generationCount: selectedCount,
      images,
      isUrls,
      md5Hashes: chatImageMd5s,
      // #093 修复：接收 taskId 参数，传递给 createPlaceholdersWithClientIds
      onBeforeGenerate: (count, prompt, taskId) => createPlaceholdersWithClientIds(clientTaskIds, content, taskId),
      onImageReceived: (data) => {
        const taskId = clientTaskIds[data.index];
        const elementId = taskIdToElementIdRef.current.get(taskId || '');
        console.log('[onImageReceived] 收到图片:', { 
          index: data.index, 
          taskId, 
          elementId,
          url: data.url?.substring(0, 50),
          status: data.status,
          clientTaskIds,
          '所有映射': Array.from(taskIdToElementIdRef.current.entries()).map(([k, v]) => `${k.substring(0, 15)}→${v}`),
        });
        // 🔧 修复：失败状态不调用 updatePlaceholder，由 onPlaceholderFailed 处理
        if (taskId && data.status !== 'failed' && data.url) {
          console.log(`[onImageReceived] 即将调用 updatePlaceholder, taskId=${taskId?.substring(0, 15)}`);
          updatePlaceholder(taskId, data.url, data.key);
        }
      },
      onPlaceholderFailed: (elementId, error) => {
        // #211 修复：直接用 elementId 更新元素状态，避免反向查找
        console.log('[onPlaceholderFailed] 标记失败:', { elementId, error });
        canvas.updateElement(elementId, { 
          generationStatus: 'failed', 
          generationError: error 
        });
      },
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
          console.log('[Canvas] ✅ taskId 一致:', actualTaskId);
        }
      },
      onProgress: (progress) => {
        setMessages(prev => prev.map(msg => msg.id === assistantMsgId ? { ...msg, content: `已生成 ${progress.completed}/${progress.total} 张图片...` } : msg));
      },
      onComplete: (result) => {
        const successUrls = result.imageUrls || [];
        const successKeys = result.imageKeys || [];
        console.log('[Canvas onComplete] result:', {
          imageUrls: successUrls.length,
          imageKeys: successKeys.length,
          keys: successKeys,
          creditsCharged: result.creditsCharged,
          creditsBalance: result.creditsBalance,
          taskId: result.taskId,  // #209 新增：日志
          placeholderReplacements: result.placeholderReplacements?.length || 0,
        });
        
        // #214 修复：兜底处理占位符替换
        // SSE 流正常时，onImageReceived 会处理占位符
        // SSE 流异常时（事件被缓冲/丢失），这里作为兜底逻辑
        if (result.placeholderReplacements && result.placeholderReplacements.length > 0) {
          console.log('[Canvas onComplete] #214 兜底处理占位符替换:', result.placeholderReplacements.length);
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
                console.log(`[Canvas onComplete] #214 调用 updatePlaceholder 确保尺寸正确: elementId=${elementIdToUse}, index=${p.index}`);
                // 🔧 升级：复用 updatePlaceholder 的尺寸计算逻辑，解决比例不一致问题
                updatePlaceholder(elementIdToUse, p.imageUrl, p.imageKey);
              } else if (!el) {
                // 元素确实不存在，尝试重新添加（需要获取图片实际尺寸）
                console.warn(`[Canvas onComplete] #214 元素不存在，尝试重新添加: elementId=${elementIdToUse}`);
                
                // 🔧 #216 修复：先删除画布上相同 taskId 的旧占位符
                if (taskId) {
                  const oldPlaceholders = liveElements.filter((el: any) => 
                    el.generationTaskId === taskId && (el.generationStatus === 'generating' || el.generationStatus === 'failed')
                  );
                  if (oldPlaceholders.length > 0) {
                    console.log(`[Canvas onComplete] #218 删除旧占位符: ${oldPlaceholders.length} 个`);
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
                    
                    const newElementId = canvas.addElement({
                      type: 'image',
                      name: `生成图片 #${p.index + 1}`,
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
                      imageUrl: p.imageUrl,
                      imageKey: p.imageKey,
                      generationStatus: 'completed' as const,
                    });
                    if (taskId) {
                      taskIdToElementIdRef.current.set(taskId, newElementId);
                    }
                    console.log(`[Canvas onComplete] #214 重新添加成功（尺寸已调整）: newId=${newElementId}, size=${newWidth}x${newHeight}`);
                  };
                  img.onerror = () => {
                    console.error(`[Canvas onComplete] #214 图片加载失败，使用占位符原始尺寸: ${p.imageUrl}`);
                    // 降级：使用占位符原始尺寸
                    const newElementId = canvas.addElement({
                      type: 'image',
                      name: `生成图片 #${p.index + 1}`,
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
                      imageUrl: p.imageUrl,
                      imageKey: p.imageKey,
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
        
        // #232 Sprint 3：删除 saveRecordWithCapturedRef 调用
        // 历史记录保存已由 AIGeneratorContext 统一处理
        // if (successUrls.length > 0) { saveRecordWithCapturedRef(...); }
        
        // 使用旁路缓存保存 imageKey 映射（增量方案，不侵入核心类型）
        if (successKeys.length > 0) {
          console.log('[Canvas onComplete] 保存 imageKey 映射:', assistantMsgId, successKeys);
          saveImageKeyMapping(assistantMsgId, successKeys);
        } else {
          console.warn('[Canvas onComplete] 没有 imageKeys，无法持久化图片');
        }
        
        setMessages(prev => prev.map(msg => msg.id === assistantMsgId ? { 
          ...msg, 
          content: `已生成 ${successUrls.length} 张图片`, 
          imageUrl: successUrls[0], 
          // 🔧 #041 修复：保存生成图的 COS key 用于刷新后恢复
          imageUrlKey: successKeys[0],
          isGenerating: false 
        } : msg));
        // 🔧 #208 修复：不再自动清除参考图，让用户可以继续使用
        // clearAllImages();
      },
      onError: (error) => {
        // #279 修复：只标记 error.placeholderIds 中的占位符为失败，不"连坐"已成功的图片
        const failedIds = error.placeholderIds || clientTaskIds;
        console.log('[Canvas onError] 待标记失败的占位符:', failedIds, '原始 clientTaskIds:', clientTaskIds);
        failedIds.forEach(id => {
          // 简化错误信息
          const displayError = error.message?.includes('违反') || error.message?.includes('违规') || error.message?.includes('政策')
            ? '此内容可能违反我们的政策。您可以尝试更改提示词或更换图像'
            : error.message;
          markPlaceholderFailed(id, displayError);
        });
        setMessages(prev => prev.map(msg => msg.id === assistantMsgId ? { 
          ...msg, 
          content: `生成失败: ${error.message?.includes('违反') || error.message?.includes('违规') || error.message?.includes('政策') 
            ? '此内容可能违反我们的政策。您可以尝试更改提示词或更换图像' 
            : error.message}`, 
          isGenerating: false 
        } : msg));
      },
    });
    } catch (error: any) {
      console.error('[Canvas handleSend] 执行出错:', error);
      setInfoDialog({ open: true, title: '生成失败', description: error?.message || '未知错误' });
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
      if (!element || element.type !== 'image' || !element.imageUrl) return;
      url = element.imageUrl;
      name = element.name || '未命名图片';
    }
    
    // 检查是否已达到上限（6张）
    if (chatImageBase64s.length >= 6) {
      console.log('[Canvas Dialog] 已达到参考图上限（6张）');
      return;
    }
    
    console.log('[Canvas Dialog] 开始处理参考图:', name);
    
    try {
      // 1. 下载图片
      const response = await fetch(url);
      const blob = await response.blob();
      console.log('[Canvas Dialog] 原始大小:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
      
      // 2. 压缩图片（2048px / 3MB / JPEG）
      const file = new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
      const compressedResult = await compressImageForUpload(file);
      const compressedBlob = compressedResult.file;
      console.log('[Canvas Dialog] 压缩后大小:', (compressedBlob.size / 1024 / 1024).toFixed(2), 'MB');
      
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
      console.log('[Canvas Dialog] MD5:', md5);
      
      // 检查是否已存在（通过 MD5 去重）
      if (chatImageMd5s.includes(md5)) {
        console.log('[Canvas Dialog] 图片已存在，跳过');
        return;
      }
      
      // 【方案B：乐观UI】立即显示预览
      const currentIdx = chatImageBase64s.length;  // 🔧 #222 修复：记录当前索引，避免闭包陷阱
      setChatImageBase64s(prev => [...prev, base64]);
      setChatImageUrls(prev => [...prev, '']); // 占位
      setChatImageKeys(prev => [...prev, '']);
      setChatImageMd5s(prev => [...prev, md5]);
      setChatImageNames(prev => [...prev, name]);
      
      console.log('[Canvas Dialog] ✅ 预览已显示，当前数量:', currentIdx + 1);
      
      // 【后台异步】上传 COS + 存储 IndexedDB
      // 🔧 #215 提交层拦截池：将上传 Promise 存入全局追踪器
      const uploadPromise = (async () => {
        try {
          const formData = new FormData();
          formData.append('file', compressedBlob, `${name}.jpg`);
          
          const uploadRes = await fetch('/api/canvas/upload', { method: 'POST', body: formData });
          const uploadData = await uploadRes.json();
          
          if (uploadData.success && uploadData.url) {
            // 🔧 #222 修复：使用记录的索引，避免闭包陷阱
            // 更新 URL 和 Key
            setChatImageUrls(prev => {
              const newUrls = [...prev];
              if (currentIdx >= 0 && currentIdx < newUrls.length) newUrls[currentIdx] = uploadData.url;
              return newUrls;
            });
            setChatImageKeys(prev => {
              const newKeys = [...prev];
              if (currentIdx >= 0 && currentIdx < newKeys.length) newKeys[currentIdx] = uploadData.key;
              console.log(`[Canvas Dialog] #222 更新 key: idx=${currentIdx}, key=${uploadData.key}`);
              return newKeys;
            });
            
            // 存储 IndexedDB
            await storeReferenceImage(md5, compressedBlob, base64, uploadData.url, name);
            console.log('[Canvas Dialog] ✅ 后台存储完成:', name);
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
  }, [canvas.state.elements, chatImageBase64s.length, chatImageMd5s]);

  // 【A 计划】处理参考图上传（使用乐观上传 Hook）
  // #048 修复：上传完成后才能提交，图片显示加载转圈
  const handleReferenceImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    console.log('[Canvas Dialog] 上传参考图，数量:', files.length);
    
    // 调用 Hook 处理文件
    await processUploadFiles(files, {
      existingMd5s: chatImageMd5s,
      currentCount: chatImageBase64s.length,
      // 乐观 UI：立即显示预览
      onOptimisticUpdate: (result: OptimisticUploadResult) => {
        const currentIdx = chatImageBase64s.length;  // 🔧 #222 修复：记录当前索引
        chatImageMd5ToIdxRef.current.set(result.md5, currentIdx);  // 存储 md5 -> 索引映射
        setChatImageBase64s(prev => [...prev, result.base64]);
        setChatImageUrls(prev => [...prev, '']); // 占位，后台填充
        setChatImageKeys(prev => [...prev, '']);
        setChatImageMd5s(prev => [...prev, result.md5]);
        setChatImageNames(prev => [...prev, result.fileName]);
        // #048 新增：追踪正在上传的图片
        setChatUploadingMd5s(prev => new Set(prev).add(result.md5));
        console.log('[Canvas Dialog] ✅ 预览已显示:', result.fileName, 'idx=', currentIdx);
      },
      // 后台上传完成：根据 MD5 更新对应位置的 URL 和 Key
      onBackgroundComplete: (result: BackgroundUploadResult) => {
        // #048 新增：从上传追踪中移除（无论成功还是失败）
        setChatUploadingMd5s(prev => {
          const newSet = new Set(prev);
          newSet.delete(result.md5);
          return newSet;
        });
        
        if (result.success) {
          // 🔧 #222 修复：使用 ref 获取索引，避免闭包陷阱
          const idx = chatImageMd5ToIdxRef.current.get(result.md5);
          if (idx !== undefined) {
            setChatImageUrls(prev => {
              const newUrls = [...prev];
              if (idx >= 0 && idx < newUrls.length) newUrls[idx] = result.url;
              return newUrls;
            });
            setChatImageKeys(prev => {
              const newKeys = [...prev];
              if (idx >= 0 && idx < newKeys.length) newKeys[idx] = result.key;
              console.log(`[Canvas Dialog] #222 更新 key: md5=${result.md5}, idx=${idx}, key=${result.key}`);
              return newKeys;
            });
          } else {
            console.warn('[Canvas Dialog] #222 找不到 md5 对应的索引:', result.md5);
          }
          console.log('[Canvas Dialog] ✅ 后台存储完成:', result.fileName);
        } else {
          // #048 新增：上传失败提示
          console.error('[Canvas Dialog] ❌ 上传失败:', result.error);
        }
      },
      // 处理失败
      onError: (fileName: string, error: string) => {
        console.error('[Canvas Dialog] 处理参考图失败:', fileName, error);
      },
      // 数量不足提示
      onSlotsExhausted: (requested: number, available: number) => {
        if (available === 0) {
          console.log('[Canvas Dialog] 已达到参考图上限（6张）');
        }
      },
    });
    
    // 清空 input，允许重复选择相同文件
    e.target.value = '';
  }, [chatImageBase64s.length, chatImageMd5s, processUploadFiles]);

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
      
      {/* 左侧工具栏 - 从 temp_LeftSideBar.tsx 迁移 */}
      <LeftSideBar
        activeTool={activeTool}
        handleToolClick={handleToolClick}
        tools={tools}
        icons={icons}
        isCropping={isCropping}
      />

      {/* 中间画布区 */}
      <main className="flex-1 flex flex-col relative pl-16 pr-4 py-4 canvas-area-cursor min-h-0">
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
          />
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileImport} />
        {/* 参考图上传输入框 */}
        <input ref={referenceImageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleReferenceImageUpload} />
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
        // 模型相关
        formatModelName={formatModelName}
        // 生成参数
        aspectRatioOptions={aspectRatioOptions}
        resolutionOptions={resolutionOptions}
        currentConfig={currentConfig}
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
}) {
  const canvas = useCanvas();
  const { theme, setTheme } = useTheme();
  // SPA 无缝跳转
  const router = useRouter();
  
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
      // console.log('[Canvas] 无法访问 window.parent（跨域限制）');
    }
  }, []);
  
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [isDragging, setIsDraggingState] = useState(false);
  
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; elementId?: string } | null>(null);
  const [shapeStart, setShapeStart] = useState<{ x: number; y: number } | null>(null);
  const [shapePreview, setShapePreview] = useState<{ x: number; y: number; width: number; height: number; type: string } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; corner: string; startX: number; startY: number; startW: number; startH: number; startElX: number; startElY: number; aspectRatio?: number; startFontSize?: number } | null>(null);
  
  // 裁剪相关状态
  const [cropImageId, setCropImageId] = useState<string | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [cropHandle, setCropHandle] = useState<string | null>(null);
  const [cropRatio, setCropRatio] = useState<'free' | '1:1' | '4:3' | '3:4' | '3:2' | '2:3' | '16:9' | '9:16' | '21:9' | '9:21'>('free'); // 裁剪比例
  
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
        let currentX = leftmost;
        sorted.forEach((el) => {
          canvas.updateElement(el.id, { x: currentX });
          currentX += el.width + gap;
        });
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
        let currentY = topmost;
        sorted.forEach((el) => {
          canvas.updateElement(el.id, { y: currentY });
          currentY += el.height + gap;
        });
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
        let currentX = sortedElements[0].x;
        let currentY = sortedElements[0].y;
        sortedElements.forEach((el) => {
          canvas.updateElement(el.id, { x: currentX, y: currentY });
          currentX += el.width + gap;
        });
        return;
      }
    };
    
    window.addEventListener('keydown', handleAlignKeydown);
    return () => window.removeEventListener('keydown', handleAlignKeydown);
  }, [canvas]);
  
  // 图层面板
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  
  // 画布初始化状态
  const [initialized, setInitialized] = useState(false);
  
  // 空格键拖拽
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, panX: 0, panY: 0 });
  
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
  } | null>(null); // 拖动状态ref
  const cropRafRef = useRef<number | null>(null); // requestAnimationFrame ID
  const pendingRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const cropRatioRef = useRef(cropRatio); // 存储最新的裁剪比例
  
  // 同步 cropRatio 到 ref
  useEffect(() => {
    cropRatioRef.current = cropRatio;
  }, [cropRatio]);

  // 关闭右键菜单
  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null);
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
        
        console.log('[画布初始化] 存档检查:', {
          hasSavedImages,
          hasNonDefaultPosition,
          hasValidSavedPosition,
          savedZoom: parsed.zoom,
          savedPanX: parsed.panX,
          savedPanY: parsed.panY,
          savedElementsCount: parsed.elements?.length || 0
        });
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
      
      console.log('[画布初始化] 有图片，自动 fitToAllImages:', {
        zoom: result.zoom,
        panX: result.panX,
        panY: result.panY,
        imageCount: canvas.state.elements.filter(el => el.type === 'image').length,
      });
      
      setZoom(result.zoom);
      setPan({ x: result.panX, y: result.panY });
    } else if (!hasValidSavedPosition) {
      // 无图片且无有效存档，执行默认初始化
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();

      // 🔧 #124 修复：使用固定高度而非固定宽度
      // CANVAS_HEIGHT = 40000 是固定值，INITIAL_VISIBLE_HEIGHT = 10000 表示看到画布高度的 1/4
      // 这样无论容器比例如何，用户看到的画布比例一致
      const INITIAL_VISIBLE_HEIGHT = 10000;
      const initialZoom = containerRect.height / INITIAL_VISIBLE_HEIGHT;

      // 计算画布位置：让画布中心对齐容器中心
      const canvasScreenW = CANVAS_WIDTH * initialZoom;
      const canvasScreenH = CANVAS_HEIGHT * initialZoom;
      const panX = (containerRect.width - canvasScreenW) / 2;
      const panY = (containerRect.height - canvasScreenH) / 2;

      console.log('[画布初始化] 默认初始化:', {
        containerSize: `${containerRect.width} × ${containerRect.height}`,
        canvasSize: `${CANVAS_WIDTH} × ${CANVAS_HEIGHT}`,
        initialZoom: initialZoom.toFixed(4),
        visibleRange: `${Math.round(containerRect.width / initialZoom)} × ${Math.round(containerRect.height / initialZoom)}`,
        pan: `${Math.round(panX)}, ${Math.round(panY)}`
      });

      setZoom(initialZoom);
      setPan({ x: panX, y: panY });
    }
    // 如果有有效存档但无图片，使用惰性初始化，不需要操作
    
    setInitialized(true);
  }, [initialized, CANVAS_WIDTH, CANVAS_HEIGHT, canvas.state.elements]);

  // 键盘事件：空格键拖拽、ESC退出裁剪、Ctrl+0缩放至全貌
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setSpacePressed(true);
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
      if (e.code === 'Space') {
        setSpacePressed(false);
        setIsPanning(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isCropping, setIsCropping]);

  // 滚轮缩放画布
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      const rect = container.getBoundingClientRect();

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

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [isCropping, cropImageId, cropRect, canvas, zoom, pan, CANVAS_WIDTH, canvasHeight]);

  // 调整大小处理
  const handleResizeStart = useCallback((e: React.MouseEvent, id: string, corner: string, keepAspectRatio: boolean = false) => {
    e.stopPropagation();
    e.preventDefault();
    const el = canvas.state.elements.find(el => el.id === id);
    if (!el) return;
    const aspectRatio = keepAspectRatio ? el.width / el.height : undefined;
    setResizing({ id, corner, startX: e.clientX, startY: e.clientY, startW: el.width, startH: el.height, startElX: el.x, startElY: el.y, aspectRatio });
  }, [canvas.state.elements]);

  // 调整大小中 - 支持角点缩放和磁吸
  useEffect(() => {
    if (!resizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const el = canvas.state.elements.find(el => el.id === resizing.id);
      if (!el) return;
      
      // 考虑缩放因子，将屏幕坐标差值转换为画布坐标差值
      // #048 修复：使用 zoom state 而不是从未更新的 ref
      const currentZoom = zoom;
      const dx = (e.clientX - resizing.startX) / currentZoom;
      const dy = (e.clientY - resizing.startY) / currentZoom;
      let newW = resizing.startW;
      let newH = resizing.startH;
      let newX = resizing.startElX;
      let newY = resizing.startElY;

      // 根据角点计算新尺寸
      if (resizing.corner.includes('right')) {
        newW = Math.max(50, resizing.startW + dx);
      }
      if (resizing.corner.includes('left')) {
        newW = Math.max(50, resizing.startW - dx);
        newX = resizing.startElX + dx;
      }
      if (resizing.corner.includes('bottom')) {
        newH = Math.max(50, resizing.startH + dy);
      }
      if (resizing.corner.includes('top')) {
        newH = Math.max(50, resizing.startH - dy);
        newY = resizing.startElY + dy;
      }

      // 保持宽高比
      if (resizing.aspectRatio) {
        if (resizing.corner === 'top-left') {
          const ratio = Math.max(newW / resizing.startW, newH / resizing.startH);
          newW = resizing.startW * ratio;
          newH = newW / resizing.aspectRatio;
          newX = resizing.startElX + resizing.startW - newW;
          newY = resizing.startElY + resizing.startH - newH;
        } else if (resizing.corner === 'top-right') {
          const ratio = Math.max(newW / resizing.startW, newH / resizing.startH);
          newW = resizing.startW * ratio;
          newH = newW / resizing.aspectRatio;
          newY = resizing.startElY + resizing.startH - newH;
        } else if (resizing.corner === 'bottom-left') {
          const ratio = Math.max(newW / resizing.startW, newH / resizing.startH);
          newW = resizing.startW * ratio;
          newH = newW / resizing.aspectRatio;
          newX = resizing.startElX + resizing.startW - newW;
        } else if (resizing.corner === 'bottom-right') {
          const ratio = Math.max(newW / resizing.startW, newH / resizing.startH);
          newW = resizing.startW * ratio;
          newH = newW / resizing.aspectRatio;
        }
      }

      // 调整大小时的磁吸逻辑
      const SNAP_THRESHOLD_SCREEN = 5; // 5像素磁吸
      const SNAP_THRESHOLD = SNAP_THRESHOLD_SCREEN / zoomRef.current;
      const newAlignLines: { horizontal: { y: number; x1: number; x2: number }[]; vertical: { x: number; y1: number; y2: number }[] } = { horizontal: [], vertical: [] };
      
      const otherElements = canvas.state.elements.filter(e => e.id !== resizing.id && e.visible);
      
      const elRight = newX + newW;
      const elBottom = newY + newH;
      const elCenterX = newX + newW / 2;
      const elCenterY = newY + newH / 2;
      
      let snapX: number | null = null;
      let snapY: number | null = null;
      
      // 右边磁吸
      if (resizing.corner.includes('right')) {
        for (const other of otherElements) {
          const otherLeft = other.x;
          const otherRight = other.x + other.width;
          const otherCenterX = other.x + other.width / 2;
          
          if (Math.abs(elRight - otherLeft) < SNAP_THRESHOLD) {
            snapX = otherLeft; // 右边界对齐到otherLeft
            newAlignLines.vertical.push({ x: otherLeft, y1: Math.min(newY, other.y), y2: Math.max(elBottom, other.y + other.height) });
          }
          if (Math.abs(elRight - otherRight) < SNAP_THRESHOLD) {
            snapX = otherRight; // 右边界对齐到otherRight
            newAlignLines.vertical.push({ x: otherRight, y1: Math.min(newY, other.y), y2: Math.max(elBottom, other.y + other.height) });
          }
          if (Math.abs(elCenterX - otherCenterX) < SNAP_THRESHOLD) {
            snapX = otherCenterX + newW / 2; // 中心对齐，计算对应的右边界位置
            newAlignLines.vertical.push({ x: otherCenterX, y1: Math.min(newY, other.y), y2: Math.max(elBottom, other.y + other.height) });
          }
        }
      }
      
      // 左边磁吸
      if (resizing.corner.includes('left')) {
        for (const other of otherElements) {
          const otherLeft = other.x;
          const otherRight = other.x + other.width;
          const otherCenterX = other.x + other.width / 2;
          
          if (Math.abs(newX - otherLeft) < SNAP_THRESHOLD) {
            snapX = otherLeft;
            newAlignLines.vertical.push({ x: otherLeft, y1: Math.min(newY, other.y), y2: Math.max(elBottom, other.y + other.height) });
          }
          if (Math.abs(newX - otherRight) < SNAP_THRESHOLD) {
            snapX = otherRight;
            newAlignLines.vertical.push({ x: otherRight, y1: Math.min(newY, other.y), y2: Math.max(elBottom, other.y + other.height) });
          }
          if (Math.abs(newX + newW/2 - otherCenterX) < SNAP_THRESHOLD) {
            snapX = otherCenterX - newW / 2;
            newAlignLines.vertical.push({ x: otherCenterX, y1: Math.min(newY, other.y), y2: Math.max(elBottom, other.y + other.height) });
          }
        }
      }
      
      // 底边磁吸
      if (resizing.corner.includes('bottom')) {
        for (const other of otherElements) {
          const otherTop = other.y;
          const otherBottom = other.y + other.height;
          const otherCenterY = other.y + other.height / 2;
          
          if (Math.abs(elBottom - otherTop) < SNAP_THRESHOLD) {
            snapY = otherTop; // 底边界对齐到otherTop
            newAlignLines.horizontal.push({ y: otherTop, x1: Math.min(newX, other.x), x2: Math.max(elRight, other.x + other.width) });
          }
          if (Math.abs(elBottom - otherBottom) < SNAP_THRESHOLD) {
            snapY = otherBottom; // 底边界对齐到otherBottom
            newAlignLines.horizontal.push({ y: otherBottom, x1: Math.min(newX, other.x), x2: Math.max(elRight, other.x + other.width) });
          }
          if (Math.abs(elCenterY - otherCenterY) < SNAP_THRESHOLD) {
            snapY = otherCenterY + newH / 2; // 中心对齐，计算对应的底边界位置
            newAlignLines.horizontal.push({ y: otherCenterY, x1: Math.min(newX, other.x), x2: Math.max(elRight, other.x + other.width) });
          }
        }
      }
      
      // 顶边磁吸
      if (resizing.corner.includes('top')) {
        for (const other of otherElements) {
          const otherTop = other.y;
          const otherBottom = other.y + other.height;
          const otherCenterY = other.y + other.height / 2;
          
          if (Math.abs(newY - otherTop) < SNAP_THRESHOLD) {
            snapY = otherTop;
            newAlignLines.horizontal.push({ y: otherTop, x1: Math.min(newX, other.x), x2: Math.max(elRight, other.x + other.width) });
          }
          if (Math.abs(newY - otherBottom) < SNAP_THRESHOLD) {
            snapY = otherBottom;
            newAlignLines.horizontal.push({ y: otherBottom, x1: Math.min(newX, other.x), x2: Math.max(elRight, other.x + other.width) });
          }
          if (Math.abs(newY + newH/2 - otherCenterY) < SNAP_THRESHOLD) {
            snapY = otherCenterY - newH / 2;
            newAlignLines.horizontal.push({ y: otherCenterY, x1: Math.min(newX, other.x), x2: Math.max(elRight, other.x + other.width) });
          }
        }
      }
      
      // 应用磁吸
      if (snapX !== null) {
        if (resizing.corner.includes('left')) {
          // 左边对齐，snapX是新的x坐标
          const oldRight = newX + newW;
          newX = snapX;
          newW = Math.max(50, oldRight - snapX);
        } else {
          // 右边对齐，snapX是新的右边界位置
          newW = Math.max(50, snapX - newX);
        }
      }
      if (snapY !== null) {
        if (resizing.corner.includes('top')) {
          // 顶边对齐，snapY是新的y坐标
          const oldBottom = newY + newH;
          newY = snapY;
          newH = Math.max(50, oldBottom - snapY);
        } else {
          // 底边对齐，snapY是新的底边界位置
          newH = Math.max(50, snapY - newY);
        }
      }
      
      setAlignLines(newAlignLines);

      // 如果是文字元素，修改fontSize而不是width/height
      const currentEl = canvas.state.elements.find(e => e.id === resizing.id);
      if (currentEl && currentEl.type === 'text') {
        // 文字元素缩放：根据缩放比例调整fontSize
        // startW/startH 存储的是文字的实际像素尺寸
        // startFontSize 存储的是开始缩放时的字号
        const originalFontSize = resizing.startFontSize || 24;
        const scaleRatio = newW / resizing.startW;
        const newFontSize = Math.max(8, Math.round(originalFontSize * scaleRatio));
        
        // 计算新的内容尺寸
        const textContent = currentEl.textContent || '';
        const charWidth = newFontSize * 0.6;
        const lines = textContent.split('\n');
        const maxLineLength = Math.max(...lines.map(l => l.length), textContent.length || 1);
        const newContentWidth = Math.max(maxLineLength * charWidth + 16, 50);
        const newContentHeight = Math.max(lines.length * newFontSize * 1.4 + 8, newFontSize * 1.4 + 8);
        
        canvas.updateElement(resizing.id, { 
          fontSize: newFontSize,
          width: newContentWidth,
          height: newContentHeight,
          x: newX, 
          y: newY,
        });
      }
      // 如果是气泡元素，根据拉伸方向更新尾巴方向
      else if (currentEl && currentEl.name === 'Bubble') {
        // 拉伸左边时，尾巴转向左边；拉伸右边时，尾巴转向右边
        const newDirection = resizing.corner.includes('left') ? 'left' : 
                            resizing.corner.includes('right') ? 'right' : 
                            (currentEl as any).bubbleTailDirection || 'right';
        canvas.updateElement(resizing.id, { 
          width: newW, 
          height: newH, 
          x: newX, 
          y: newY,
          bubbleTailDirection: newDirection
        });
      } else {
        canvas.updateElement(resizing.id, { width: newW, height: newH, x: newX, y: newY });
      }
      
    };
    const handleMouseUp = () => {
      setResizing(null);
      setAlignLines({ horizontal: [], vertical: [] });
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
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
        // 阈值使用屏幕像素（5px），转换为画布坐标
        const SNAP_THRESHOLD_SCREEN = 5; // 5像素磁吸范围
        const SNAP_THRESHOLD = SNAP_THRESHOLD_SCREEN / zoom; // 画布坐标
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
        
        // 水平对齐（检测垂直线）
        let snapX: number | null = null;
        for (const other of otherElements) {
          const otherLeft = other.x;
          const otherRight = other.x + other.width;
          const otherCenterX = other.x + other.width / 2;
          
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
          
          // 更新所有组元素，保持相对位置
          groupStartPositions.forEach((pos: { id: string; x: number; y: number }) => {
            canvas.updateElement(pos.id, { 
              x: pos.x + finalOffsetX,
              y: pos.y + finalOffsetY
            });
          });
        } else {
          // 单选拖动：限制元素不能拖出画布边界
          newX = Math.max(0, Math.min(CANVAS_WIDTH - el.width, newX));
          newY = Math.max(0, Math.min(canvasHeight - el.height, newY));
          canvas.updateElement(dragElement, { x: newX, y: newY });
        }
      }
    };

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      setDragElement(null);
      setAlignLines({ horizontal: [], vertical: [] });
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, dragElement, dragStart, canvas, CANVAS_WIDTH, canvasHeight]);

  // 缩放手柄拖动的全局事件监听
  useEffect(() => {
    if (!resizing) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      const el = canvas.state.elements.find(el => el.id === resizing.id);
      if (!el) return;

      // 计算鼠标移动的画布坐标差值
      const dx = (e.clientX - resizing.startX) / zoom;
      const dy = (e.clientY - resizing.startY) / zoom;

      let newW = resizing.startW;
      let newH = resizing.startH;
      let newX = resizing.startElX;
      let newY = resizing.startElY;

      // 根据拖动的角计算新的尺寸和位置
      if (resizing.corner.includes('right')) {
        newW = Math.max(20, resizing.startW + dx);
      }
      if (resizing.corner.includes('left')) {
        newW = Math.max(20, resizing.startW - dx);
        newX = resizing.startElX + (resizing.startW - newW);
      }
      if (resizing.corner.includes('bottom')) {
        newH = Math.max(20, resizing.startH + dy);
      }
      if (resizing.corner.includes('top')) {
        newH = Math.max(20, resizing.startH - dy);
        newY = resizing.startElY + (resizing.startH - newH);
      }

      // 固定比例
      if (resizing.aspectRatio) {
        // aspectRatio 是 width/height
        if (resizing.corner.includes('left') || resizing.corner.includes('right')) {
          newH = newW / resizing.aspectRatio;  // height = width / (width/height)
        } else {
          newW = newH * resizing.aspectRatio;  // width = height * (width/height)
        }
        // 调整位置以保持对角点固定
        if (resizing.corner.includes('left')) {
          newX = resizing.startElX + resizing.startW - newW;
        }
        if (resizing.corner.includes('top')) {
          newY = resizing.startElY + resizing.startH - newH;
        }
      }

      // 更新元素
      canvas.updateElement(resizing.id, {
        x: newX,
        y: newY,
        width: newW,
        height: newH,
      });
    };

    const handleGlobalMouseUp = () => {
      setResizing(null);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [resizing, canvas, zoom]);

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
      
      // 增加最小尺寸限制
      const MIN_SIZE = 20;
      if (startBox.width * finalScale < MIN_SIZE || startBox.height * finalScale < MIN_SIZE) {
        finalScale = MIN_SIZE / Math.min(startBox.width, startBox.height);
      }
      
      const finalWidth = startBox.width * finalScale;
      const finalHeight = startBox.height * finalScale;
      
      if (corner.includes('w')) newX = startBox.x + startBox.width - finalWidth;
      if (corner.includes('n')) newY = startBox.y + startBox.height - finalHeight;
      
      // 3. 收集所有更新，准备批量提交 (避免卡顿)
      const updates = startElements.map(el => ({
        id: el.id,
        updates: {
          x: newX + el.relX * finalWidth,
          y: newY + el.relY * finalHeight,
          width: el.relW * finalWidth,
          height: el.relH * finalHeight,
        }
      }));
      
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

  // 鼠标按下
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
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
    
    // 裁剪模式下禁用所有画布操作
    if (isCropping) {
      return;
    }
    
    // 空格+左键：拖拽画布
    if (spacePressed) {
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
    
    // 选择工具 - 查找点击的元素
    // 已编组的子元素不能单独被点击，点击时直接选中组元素
    // 注意：文字元素由 Fabric.js 处理，这里不检测
    const clickedEl = [...canvas.state.elements].reverse().find(el => {
      if (!el.visible || el.locked) return false;
      // 跳过已被编组的子元素 - 它们应该作为组元素的一部分被点击
      if ((el as any).groupId) return false;
      // 跳过文字元素 - 由 Fabric.js 处理
      if (el.type === 'text') return false;
      // 组元素：检查点击是否在组边界内
      if (el.type === 'group' && el.groupChildIds && el.groupChildIds.length > 0) {
        return canvasX >= el.x && canvasX <= el.x + el.width && 
               canvasY >= el.y && canvasY <= el.y + el.height;
      }
      // 普通元素：检查点击是否在元素边界内
      return canvasX >= el.x && canvasX <= el.x + el.width && 
             canvasY >= el.y && canvasY <= el.y + el.height;
    });
    
    if (clickedEl) {
      // 双击选择模式下，点击图片元素由图片元素自己处理（拖动和双击）
      if (isGridSelectMode && clickedEl.type === 'image') {
        return;
      }
      
      // 如果点击的是组元素
      if (clickedEl.type === 'group' && clickedEl.groupChildIds) {
        canvas.selectElement(clickedEl.id, e.shiftKey);
        
        if (!e.shiftKey) {
          e.preventDefault(); // 阻止浏览器默认行为（文本选择）
          setDragElement(clickedEl.id);
          setIsDragging(true);
          setDragStart({ x: canvasX, y: canvasY, elX: clickedEl.x, elY: clickedEl.y });
          
          // 记录所有子元素的初始位置
          const childElements = canvas.state.elements.filter(
            el => clickedEl.groupChildIds?.includes(el.id)
          );
          (window as any).__groupStartPositions = childElements.map(el => ({
            id: el.id,
            x: el.x,
            y: el.y
          }));
        }
      }
      // 普通元素
      else {
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
          
          if (!e.shiftKey) {
            e.preventDefault(); // 阻止浏览器默认行为（文本选择）
            setDragElement(clickedEl.id);
            setIsDragging(true);
            setDragStart({ x: canvasX, y: canvasY, elX: clickedEl.x, elY: clickedEl.y });
            (window as any).__groupStartPositions = null;
          }
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
      }
    }
  }, [canvas, zoom, pan, spacePressed, isCropping, activeTool, isGridSelectMode]);

  // 鼠标移动
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
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
        const canvasEl = containerRef.current.querySelector('[data-canvas-layer]') as HTMLElement;
        if (canvasEl) {
          canvasEl.style.transform = `translate(${newPanX}px, ${newPanY}px) scale(${zoom})`;
        }
      }
      return;
    }
    
    // 转换为画布坐标
    const canvasX = (x - pan.x) / zoom;
    const canvasY = (y - pan.y) / zoom;

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
  }, [isDragging, dragStart, canvas, dragElement, isDrawing, zoom, pan, isPanning, panStart, isCropping, cropHandle, cropRect, cropImageId, shapeStart, CANVAS_WIDTH, canvasHeight, spacePressed]);

  // 鼠标松开
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
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

  const renderElement = (el: CanvasElement, index: number) => {
    if (!el.visible) return null;
    const isSelected = canvas.state.selectedIds.includes(el.id);
    // zIndex: 始终基于数组索引，选中时在原有基础上加一个较大的值确保在最上层
    const baseZIndex = index + 1;
    const zIndex = isSelected ? baseZIndex + 500 : baseZIndex;
    
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

    // 普通图片 - 从中心点缩放
    if (el.type === 'image') {
      const isThisCropping = isCropping && cropImageId === el.id;
      // recovering/generating/submitted 状态都显示生成中动画
      const isGenerating = el.generationStatus === 'generating' || el.generationStatus === 'recovering' || el.generationStatus === 'submitted';
      const isLoading = el.isLoading === true; // 图片加载中（从 COS 恢复）
      const isFailed = el.generationStatus === 'failed';
      const isExpired = el.generationStatus === 'expired';
      
      // 根据占位符尺寸动态计算文字大小（占占位符最小边的比例）
      const minDim = Math.min(el.width, el.height);
      const iconSize = Math.max(20, minDim * 0.12); // 图标占最小边 12%
      const fontSize = Math.max(10, minDim * 0.04); // 文字占最小边 4%
      
      return (
        <div
          key={el.id}
          data-image-element="true"
          style={{
            position: 'absolute',
            left: el.x,
            top: el.y,
            width: el.width,
            height: el.height,
            zIndex,
            overflow: 'visible',
            userSelect: 'none',
            pointerEvents: 'auto',
          }}
          className={`group select-none ${isGridSelectMode ? 'cursor-pointer' : cursorClass}`}
          onContextMenu={(e) => handleContextMenu(e, el.id)}
          onMouseDown={(e) => {
            console.log('[图片容器] onMouseDown 触发:', el.id, e.clientX, e.clientY, '裁剪模式:', isThisCropping);
            // 裁剪模式下，只让裁剪框触发区域处理事件
            if (isThisCropping) {
              console.log('[图片容器] 裁剪模式下鼠标按下 - 事件应该由裁剪框处理');
              return;
            }
            // 双击选择模式下，在图片元素上启动拖动
            if (isGridSelectMode) {
              e.stopPropagation();
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect) {
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const canvasX = (x - pan.x) / zoom;
                const canvasY = (y - pan.y) / zoom;
                setDragElement(el.id);
                setIsDragging(true);
                setDragStart({ x: canvasX, y: canvasY, elX: el.x, elY: el.y });
                (window as any).__groupStartPositions = null;
              }
            }
          }}
          onClick={(e) => {
            // 双击选择模式下，阻止事件冒泡到 window
            if (isGridSelectMode) {
              e.stopPropagation();
            }
          }}
          onDoubleClick={(e) => {
            if (isGridSelectMode && el.imageUrl && onGridImageSelect) {
              e.stopPropagation();
              onGridImageSelect(el.imageUrl);
            }
          }}
        >
          {/* 生成中占位符 - 玫瑰曲线动画 + 渐变背景 */}
          {isGenerating && (
            <div 
              style={{
                width: '100%',
                height: '100%',
                borderRadius: 20,
                boxShadow: isSelected ? '0 0 0 2px #40A9FF' : '0 0 0 2px rgba(59, 130, 246, 0.6)',
                position: 'relative',
                overflow: 'hidden',
                background: roseGradientBg
                  ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(99, 102, 241, 0.25) 50%, rgba(56, 189, 248, 0.25) 100%)'
                  : (theme === 'dark' ? '#1f2937' : '#ffffff'),
              }}
            >
              <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%' }}>
                <CanvasRoseCurve color={roseColor} showDetail gradientBg={roseGradientBg} />
              </div>
            </div>
          )}
          
          {/* 图片加载中占位符（从 COS 恢复时） */}
          {isLoading && (
            <div 
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255, 255, 255, 0.3)',
                borderRadius: 12,
                border: isSelected ? '2px solid #40A9FF' : '2px dashed rgba(59, 130, 246, 0.5)',
                opacity: el.opacity,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* 透明波动动画背景 */}
              <div 
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.1), transparent)',
                  animation: 'shimmer 1.5s infinite',
                }}
              />
              {/* 脉冲动画背景 */}
              <div 
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'radial-gradient(circle at center, rgba(59, 130, 246, 0.15) 0%, transparent 70%)',
                  animation: 'pulse 2s infinite',
                }}
              />
              {/* 加载图标 */}
              <div className="relative z-10 flex flex-col items-center gap-3">
                <div style={{ width: iconSize, height: iconSize, borderWidth: 3 }} className="border-3 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
                <div className="text-blue-500 font-medium" style={{ fontSize: fontSize }}>加载中...</div>
              </div>
            </div>
          )}
          
          {/* 生成失败占位符 */}
          {isFailed && (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.15) 100%)',
                borderRadius: 12,
                border: '2px solid rgba(239, 68, 68, 0.5)',
                opacity: el.opacity,
                padding: '8px',
              }}
            >
              {/* 失败图标 */}
              <div className="flex flex-col items-center gap-2 max-w-full">
                <div style={{ width: iconSize, height: iconSize }} className="rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <svg style={{ width: iconSize * 0.5, height: iconSize * 0.5 }} className="text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div className="text-red-500 font-medium text-center break-words leading-tight" style={{ fontSize: fontSize, maxWidth: '100%', wordBreak: 'break-word' }}>
                  {/* 🔧 #211 修复：同时检查中英文关键词 */}
                  {el.generationError?.includes('违反') || el.generationError?.includes('违规') || el.generationError?.includes('政策') || 
                   el.generationError?.toLowerCase().includes('violate') || el.generationError?.toLowerCase().includes('policy') || el.generationError?.toLowerCase().includes('policies')
                    ? '内容违规，请修改提示词后重试'
                    : el.generationError === 'output_moderation' ? '内容违规' : 
                      el.generationError === 'input_moderation' ? '输入违规' : 
                      el.generationError || '失败'}
                </div>
              </div>
            </div>
          )}
          
          {/* 图片已删除占位符 */}
          {isExpired && (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, rgba(156, 163, 175, 0.15) 0%, rgba(107, 114, 128, 0.2) 100%)',
                borderRadius: 12,
                border: '2px solid rgba(156, 163, 175, 0.5)',
                opacity: el.opacity,
                padding: '8px',
              }}
            >
              {/* 删除图标 */}
              <div className="flex flex-col items-center gap-2 max-w-full">
                <div style={{ width: iconSize, height: iconSize }} className="rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <svg style={{ width: iconSize * 0.5, height: iconSize * 0.5 }} className="text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <div className="text-gray-500 font-medium text-center break-words leading-tight" style={{ fontSize: fontSize, maxWidth: '100%', wordBreak: 'break-word' }}>
                  图片已删除
                </div>
              </div>
            </div>
          )}
          
          {/* 正常图片 */}
          {!isGenerating && !isLoading && !isFailed && !isExpired && el.imageUrl && (
          <img
            key={`img-${el.id}-${el.imageUrl?.substring(0, 50)}`}
            src={el.imageUrl}
            alt={el.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain', // 保持图片比例，不拉伸
              pointerEvents: isThisCropping ? 'none' : 'none',
              display: 'block',
              backgroundColor: '#f5f5f5',
              borderRadius: 4,
              // 使用 box-shadow 替代 border，避免选中时尺寸变化
              boxShadow: 'none',
              opacity: el.opacity,
            }}
            draggable={false}
            onLoad={() => {
              console.log('[图片] 加载完成:', el.id, el.imageUrl?.substring(0, 50));
            }}
            onError={(e) => {
              console.error('[图片] 加载失败:', el.id, el.imageUrl?.substring(0, 50));
            }}
          />
          )}
          
          {/* 裁剪覆盖层 */}
          {isThisCropping && cropRect && (
            <>
              {console.log('[裁剪框] 正在渲染裁剪框:', cropRect, '触发区域数量: 9, 比例:', cropRatio)}
              
              {/* 框外暗色遮罩 - 四个区域 */}
              {/* 上边遮罩 */}
              <div 
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: el.width,
                  height: cropRect.y,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  pointerEvents: 'none',
                }}
              />
              {/* 下边遮罩 */}
              <div 
                style={{
                  position: 'absolute',
                  left: 0,
                  top: cropRect.y + cropRect.height,
                  width: el.width,
                  height: el.height - cropRect.y - cropRect.height,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  pointerEvents: 'none',
                }}
              />
              {/* 左边遮罩 */}
              <div 
                style={{
                  position: 'absolute',
                  left: 0,
                  top: cropRect.y,
                  width: cropRect.x,
                  height: cropRect.height,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  pointerEvents: 'none',
                }}
              />
              {/* 右边遮罩 */}
              <div 
                style={{
                  position: 'absolute',
                  left: cropRect.x + cropRect.width,
                  top: cropRect.y,
                  width: el.width - cropRect.x - cropRect.width,
                  height: cropRect.height,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  pointerEvents: 'none',
                }}
              />
              
              {/* 裁剪框 - 深黑色加粗边框 */}
              <div 
                style={{
                  position: 'absolute',
                  left: cropRect.x,
                  top: cropRect.y,
                  width: cropRect.width,
                  height: cropRect.height,
                  border: '2.5px solid #000',
                  pointerEvents: 'none',
                  backgroundColor: 'transparent',
                  boxShadow: '0 0 0 1px rgba(255,255,255,0.3)',
                }}
              >
                {/* 九宫格辅助线 */}
                <div style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: 1.5, backgroundColor: 'rgba(0,0,0,0.7)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: 1.5, backgroundColor: 'rgba(0,0,0,0.7)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: 1.5, backgroundColor: 'rgba(0,0,0,0.7)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: 1.5, backgroundColor: 'rgba(0,0,0,0.7)', pointerEvents: 'none' }} />
              </div>
              
              {/* 裁剪框交互层 - 所有触发区域统一高z-index，确保在工具栏之上 */}
              {/* 北边 - 上边缘调整，延伸到图片外部 */}
              <div
                data-crop-handle="true"
                style={{
                  position: 'absolute',
                  left: cropRect.x - 10,
                  top: cropRect.y - 25,
                  width: cropRect.width + 20,
                  height: 50,
                  cursor: 'ns-resize',
                  pointerEvents: 'auto',
                  zIndex: 250,
                  backgroundColor: 'transparent',
                }}
                onMouseDown={(e) => {
                  console.log('[裁剪框] 鼠标按下:', 'n', e.clientX, e.clientY);
                  e.stopPropagation();
                  e.preventDefault();
                  cropDragRef.current = {
                    isDragging: true,
                    startX: e.clientX,
                    startY: e.clientY,
                    rectX: cropRect.x,
                    rectY: cropRect.y,
                    rectW: cropRect.width,
                    rectH: cropRect.height,
                    handle: 'n'
                  };
                  setCropHandle('n');
                }}
              >
                <div style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: 10,
                  transform: 'translateX(-50%)',
                  width: 30,
                  height: 5,
                  backgroundColor: '#000',
                  borderRadius: 2,
                  pointerEvents: 'none',
                  boxShadow: '0 0 0 1px rgba(255,255,255,0.3)',
                }} />
              </div>
              
              {/* 南边 - 下边缘调整 */}
              <div
                style={{
                  position: 'absolute',
                  left: cropRect.x - 10,
                  top: cropRect.y + cropRect.height - 25,
                  width: cropRect.width + 20,
                  height: 50,
                  cursor: 'ns-resize',
                  pointerEvents: 'auto',
                  zIndex: 250,
                  backgroundColor: 'transparent',
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  cropDragRef.current = {
                    isDragging: true,
                    startX: e.clientX,
                    startY: e.clientY,
                    rectX: cropRect.x,
                    rectY: cropRect.y,
                    rectW: cropRect.width,
                    rectH: cropRect.height,
                    handle: 's'
                  };
                  setCropHandle('s');
                }}
              >
                <div style={{
                  position: 'absolute',
                  left: '50%',
                  top: 10,
                  transform: 'translateX(-50%)',
                  width: 30,
                  height: 5,
                  backgroundColor: '#000',
                  borderRadius: 2,
                  pointerEvents: 'none',
                  boxShadow: '0 0 0 1px rgba(255,255,255,0.3)',
                }} />
              </div>
              
              {/* 西边 - 左边缘调整 */}
              <div
                style={{
                  position: 'absolute',
                  left: cropRect.x - 25,
                  top: cropRect.y - 10,
                  width: 50,
                  height: cropRect.height + 20,
                  cursor: 'ew-resize',
                  pointerEvents: 'auto',
                  zIndex: 250,
                  backgroundColor: 'transparent',
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  cropDragRef.current = {
                    isDragging: true,
                    startX: e.clientX,
                    startY: e.clientY,
                    rectX: cropRect.x,
                    rectY: cropRect.y,
                    rectW: cropRect.width,
                    rectH: cropRect.height,
                    handle: 'w'
                  };
                  setCropHandle('w');
                }}
              >
                <div style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 5,
                  height: 30,
                  backgroundColor: '#000',
                  borderRadius: 2,
                  pointerEvents: 'none',
                  boxShadow: '0 0 0 1px rgba(255,255,255,0.3)',
                }} />
              </div>
              
              {/* 东边 - 右边缘调整 */}
              <div
                style={{
                  position: 'absolute',
                  left: cropRect.x + cropRect.width - 25,
                  top: cropRect.y - 10,
                  width: 50,
                  height: cropRect.height + 20,
                  cursor: 'ew-resize',
                  pointerEvents: 'auto',
                  zIndex: 250,
                  backgroundColor: 'transparent',
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  cropDragRef.current = {
                    isDragging: true,
                    startX: e.clientX,
                    startY: e.clientY,
                    rectX: cropRect.x,
                    rectY: cropRect.y,
                    rectW: cropRect.width,
                    rectH: cropRect.height,
                    handle: 'e'
                  };
                  setCropHandle('e');
                }}
              >
                <div style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 5,
                  height: 30,
                  backgroundColor: '#000',
                  borderRadius: 2,
                  pointerEvents: 'none',
                  boxShadow: '0 0 0 1px rgba(255,255,255,0.3)',
                }} />
              </div>
              
              {/* 四个角 */}
              {[
                { corner: 'nw', cursor: 'nwse-resize' },
                { corner: 'ne', cursor: 'nesw-resize' },
                { corner: 'sw', cursor: 'nesw-resize' },
                { corner: 'se', cursor: 'nwse-resize' },
              ].map(({ corner, cursor }) => {
                const isLeft = corner.includes('w');
                const isTop = corner.includes('n');
                
                return (
                  <div
                    key={corner}
                    style={{
                      position: 'absolute',
                      left: isLeft ? cropRect.x - 30 : cropRect.x + cropRect.width - 20,
                      top: isTop ? cropRect.y - 30 : cropRect.y + cropRect.height - 20,
                      width: 50,
                      height: 50,
                      cursor: cursor,
                      pointerEvents: 'auto',
                      zIndex: 260,
                      backgroundColor: 'transparent',
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      cropDragRef.current = {
                        isDragging: true,
                        startX: e.clientX,
                        startY: e.clientY,
                        rectX: cropRect.x,
                        rectY: cropRect.y,
                        rectW: cropRect.width,
                        rectH: cropRect.height,
                        handle: corner
                      };
                      setCropHandle(corner);
                    }}
                  >
                    <div style={{
                      position: 'absolute',
                      left: isLeft ? 5 : 'auto',
                      right: isLeft ? 'auto' : 5,
                      top: isTop ? 5 : 'auto',
                      bottom: isTop ? 'auto' : 5,
                      width: 20,
                      height: 20,
                      border: '2.5px solid #000',
                      borderRadius: 2,
                      pointerEvents: 'none',
                      boxShadow: '0 0 0 1px rgba(255,255,255,0.3)',
                    }} />
                  </div>
                );
              })}
              
              {/* 中间移动区域 */}
              <div
                data-crop-handle="true"
                style={{
                  position: 'absolute',
                  left: cropRect.x + 30,
                  top: cropRect.y + 30,
                  width: Math.max(0, cropRect.width - 60),
                  height: Math.max(0, cropRect.height - 60),
                  cursor: 'move',
                  pointerEvents: 'auto',
                  zIndex: 240,
                }}
                onMouseDown={(e) => {
                  console.log('[裁剪框] 鼠标按下:', 'move', e.clientX, e.clientY);
                  e.stopPropagation();
                  e.preventDefault();
                  cropDragRef.current = {
                    isDragging: true,
                    startX: e.clientX,
                    startY: e.clientY,
                    rectX: cropRect.x,
                    rectY: cropRect.y,
                    rectW: cropRect.width,
                    rectH: cropRect.height,
                    handle: 'move'
                  };
                  setCropHandle('move');
                }}
              />
            </>
          )}
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

    // 文字元素 - 由 FabricTextLayer 处理，这里不渲染
    if (el.type === 'text') {
      return null;
    }

    return null;
  };

  const handleContextMenu = (e: React.MouseEvent, elementId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    
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
    if (canvas.state.tool === 'pen') {
      setActiveTool('select');
      canvas.setTool('select');
      setIsDrawing(false);
      setDrawPath([]);
      return;
    }
    
    // 手型工具时禁止选择操作
    if (canvas.state.tool === 'hand') {
      setContextMenu({ x: e.clientX, y: e.clientY, elementId: undefined });
      return;
    }
    
    // 右键点击时选中元素
    if (elementId) {
      const isSelected = canvas.state.selectedIds.includes(elementId);
      if (!isSelected) {
        canvas.selectElement(elementId, false);
      }
    }
    
    setContextMenu({ x: e.clientX, y: e.clientY, elementId });
  };

  return (
    <>
      <div 
        ref={containerRef} 
        data-canvas-area="true"
        className="w-full h-full relative select-none overflow-hidden bg-gray-50 dark:bg-gray-800 rounded-xl canvas-custom-cursor" 
        style={{ 
          userSelect: 'none',
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
            title={theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'}
          >
            {theme === 'dark' ? (
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
        
        {/* 缩放和平移容器 */}
        <div 
          data-canvas-layer="true"
          style={{ 
            // #096 修复：SSR Hydration 撕裂 - 未挂载时使用默认 transform 值
            transform: isMounted ? `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` : 'translate(0px, 0px) scale(1)',
            transformOrigin: '0 0',
            position: 'absolute',
            top: 0,
            left: 0,
            width: CANVAS_WIDTH,
            height: canvasHeight,
            // 从画布添加模式下启用事件，让图片可以被点击
            pointerEvents: isGridSelectMode ? 'auto' : 'none'
          }}
        >
          {/* 画布背景 */}
          <div 
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: CANVAS_WIDTH,
              height: canvasHeight,
              backgroundColor: theme === 'dark' ? '#1f2937' : '#ffffff',
              border: `1px solid ${theme === 'dark' ? '#374151' : '#e5e7eb'}`,
              borderRadius: 4,
              // 增加阴影，让用户看清哪里是画板边缘
              boxShadow: '0 0 20px rgba(0,0,0,0.1)',
              pointerEvents: 'none'
            }}
          />
          {/* #096 修复：元素层只在客户端渲染，避免 SSR Hydration 撕裂 */}
          {/* 带有动态 left/top/width 的元素绝对不准参与 SSR */}
          {isMounted && canvas.state.elements.map((el, index) => renderElement(el, index))}
          
        </div>{/* 缩放容器结束 */}
        
        {/* #096 修复：Fabric.js 文字层只在客户端渲染 */}
        {isMounted && (
        <FabricTextLayer
          elements={canvas.state.elements}
          selectedIds={canvas.state.selectedIds}
          zoom={zoom}
          pan={pan}
          containerRef={containerRef}
          onUpdateElement={canvas.updateElement}
          onSelectElement={canvas.selectElement}
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
              
              // 调用 handleContextMenu，需要将原生事件转换为 React 事件格式
              // 直接使用 setContextMenu 来显示菜单
              const syntheticEvent = {
                preventDefault: () => e.preventDefault(),
                stopPropagation: () => e.stopPropagation(),
                clientX: e.clientX,
                clientY: e.clientY,
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
          if ((el as any).groupId) return null;
          
          const containerRect = containerRef.current?.getBoundingClientRect();
          const screenX = el.x * zoom + pan.x + (containerRect?.left || 0);
          const screenY = el.y * zoom + pan.y + (containerRect?.top || 0);
          const screenW = el.width * zoom;
          
          return (
            <div 
              key={`shape-toolbar-${el.id}`}
              data-toolbar="true"
              className="fixed flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 px-3 py-2 z-[100] whitespace-nowrap"
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
        
        
        {/* 选中状态覆盖层 - 固定大小，不受缩放影响。拖动时隐藏。裁剪模式下隐藏。双击选择模式下隐藏 */}
        {!isDragging && !isCropping && !isGridSelectMode && canvas.state.selectedIds.map(id => {
          const el = canvas.state.elements.find(e => e.id === id);
          if (!el || !el.visible) return null;
          
          // 如果元素是组内子元素，不显示单独的边框
          if ((el as any).groupId) return null;
          
          // 文字元素由 Fabric.js 处理，这里不显示选中边框
          if (el.type === 'text') return null;
          
          // #299 优化：多选时隐藏单个元素的边框和控制点（由大框架统一显示）
          const isMultiSelect = canvas.state.selectedIds.length > 1;
          if (isMultiSelect) return null;
          
          // 计算屏幕坐标
          const screenX = el.x * zoom + pan.x;
          const screenY = el.y * zoom + pan.y;
          const screenW = el.width * zoom;
          const screenH = el.height * zoom;
          
          // 组元素显示特殊样式
          const isGroup = el.type === 'group' && el.groupChildIds && el.groupChildIds.length > 0;
          
          return (
            <div key={`selection-${id}`}>
              {/* 选中边框 */}
              <div
                style={{
                  position: 'absolute',
                  left: screenX,
                  top: screenY,
                  width: screenW,
                  height: screenH,
                  border: isGroup ? '2px dashed #8b5cf6' : '2px solid #40A9FF',
                  borderRadius: 8,
                  pointerEvents: 'none',
                  zIndex: 20
                }}
              />
              
              {/* 四角触发区域 - 独立渲染，不受父元素 pointerEvents 影响 */}
              {!isGroup && ['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((corner) => {
                // 计算触发区域的绝对位置
                const handleLeft = corner.includes('left') ? screenX - 10 : corner.includes('right') ? screenX + screenW - 10 : 0;
                const handleTop = corner.includes('top') ? screenY - 10 : corner.includes('bottom') ? screenY + screenH - 10 : 0;
                
                // 形状工具栏锁定宽高比优先
                let lockAspectRatio: number | undefined;
                if (aspectRatioLocked) {
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
                      cursor: corner.includes('left') && corner.includes('top') || corner.includes('right') && corner.includes('bottom') ? 'nwse-resize' : 'nesw-resize',
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
              border: '2px dashed #888',  // 浅灰色虚线
              borderRadius: 16 * zoom,  // 四角圆角，跟随缩放，更大更明显
              pointerEvents: 'none',
              zIndex: 25,
            }}
          >
            {/* 四角控制点 - 圆形 */}
            {['nw', 'ne', 'sw', 'se'].map(corner => {
              const isLeft = corner.includes('w');
              const isTop = corner.includes('n');
              return (
                <div
                  key={corner}
                  style={{
                    position: 'absolute',
                    left: isLeft ? -6 : 'auto',
                    right: isLeft ? 'auto' : -6,
                    top: isTop ? -6 : 'auto',
                    bottom: isTop ? 'auto' : -6,
                    width: 12,
                    height: 12,
                    background: '#fff',
                    border: '2px solid #888',
                    borderRadius: '50%',  // 圆形
                    cursor: `${corner}-resize`,
                    pointerEvents: 'auto',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',  // 轻微阴影
                  }}
                  onMouseDown={(e) => handleSelectionResizeStart(e, corner)}
                />
              );
            })}
          </div>
        )}
        
        {/* 智能对齐线 - 拖动或调整大小时显示 */}
        {(isDragging || resizing) && (
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
                  zIndex: 30
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
                  zIndex: 30
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
          className="fixed pointer-events-none z-[9999] flex items-center gap-1"
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
        // 检查是否选中了组元素
        const selectedGroupElement = canvas.state.elements.find(
          el => el.type === 'group' && canvas.state.selectedIds.includes(el.id) && el.visible
        );
        
        // 找到所有选中的图片元素
        const selectedImages = canvas.state.elements.filter(
          el => el.type === 'image' && canvas.state.selectedIds.includes(el.id) && el.visible
        );
        
        // 如果选中了组元素，获取组内所有图片
        let groupImages: CanvasElement[] = [];
        if (selectedGroupElement && selectedGroupElement.groupChildIds) {
          groupImages = canvas.state.elements.filter(
            el => selectedGroupElement.groupChildIds?.includes(el.id) && el.type === 'image' && el.visible
          );
        }
        
        // 双击选择模式下不显示工具栏
        if (isGridSelectMode) return null;
        
        // 没有选中任何图片或组元素
        if (selectedImages.length === 0 && groupImages.length === 0) return null;
        
        // 获取容器位置
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return null;
        
        // 如果选中了组元素，显示与单图相同的工具栏，只是下载改为解除图层
        if (selectedGroupElement && groupImages.length > 0) {
          const groupEl = selectedGroupElement;
          const screenX = groupEl.x * zoom + pan.x;
          const screenY = groupEl.y * zoom + pan.y;
          const screenW = groupEl.width * zoom;
          const screenH = groupEl.height * zoom;
          
          // 工具栏位置 - 确保在元素上方，不遮挡内容
          const toolbarHeight = 50;
          const toolbarGap = 12;
          const toolbarX = containerRect.left + screenX + screenW / 2;
          const toolbarY = containerRect.top + screenY - toolbarHeight - toolbarGap;
          
          // 合并组内图片为一张透明背景图片
          const getMergedImage = async (): Promise<Blob | null> => {
            if (groupImages.length === 0) return null;
            
            const canvasEl = document.createElement('canvas');
            canvasEl.width = groupEl.width;
            canvasEl.height = groupEl.height;
            const ctx = canvasEl.getContext('2d');
            if (!ctx) return null;
            
            const sortedImages = [...groupImages].sort((a, b) => {
              const indexA = canvas.state.elements.findIndex(e => e.id === a.id);
              const indexB = canvas.state.elements.findIndex(e => e.id === b.id);
              return indexA - indexB;
            });
            
            for (const imgEl of sortedImages) {
              const imgUrl = imgEl.imageUrl;
              if (imgUrl) {
                const img = new window.Image();
                img.crossOrigin = 'anonymous';
                await new Promise<void>(resolve => {
                  img.onload = () => {
                    ctx.drawImage(img, imgEl.x - groupEl.x, imgEl.y - groupEl.y, imgEl.width, imgEl.height);
                    resolve();
                  };
                  img.onerror = () => resolve();
                  img.src = imgUrl;
                });
              }
            }
            
            return new Promise((resolve) => {
              canvasEl.toBlob(resolve, 'image/png');
            });
          };
          
          return (
            <>
              {/* 工具栏 - 与单图完全一致 */}
              <div 
                data-toolbar="true"
                className="fixed z-[200]"
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
                  {/* 发送到对话 */}
                  <button 
                    onClick={async (e) => { 
                      e.stopPropagation();
                      // 发送合并后的单张图片到对话
                      const blob = await getMergedImage();
                      if (blob) {
                        const url = URL.createObjectURL(blob);
                        const mergedId = 'merged_' + Date.now();
                        onSendMessage(mergedId, url, `合并图片(${groupImages.length}张)`);
                        canvas.clearSelection();
                      }
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
                    onClick={async (e) => { 
                      e.stopPropagation();
                      const blob = await getMergedImage();
                      if (blob) {
                        const url = URL.createObjectURL(blob);
                        sessionStorage.setItem('canvasToSend', JSON.stringify({
                          imageUrl: url,
                          prompt: '',
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
                    onClick={async (e) => { 
                      e.stopPropagation();
                      const blob = await getMergedImage();
                      if (blob) {
                        const url = URL.createObjectURL(blob);
                        sessionStorage.setItem('canvasToSendVideo', JSON.stringify({
                          imageUrl: url,
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
                  {/* 下载 */}
                  <button 
                    onClick={async (e) => { 
                      e.stopPropagation();
                      const blob = await getMergedImage();
                      if (blob) {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `merged_${groupImages.length}_images.png`;
                        a.click();
                        URL.revokeObjectURL(url);
                        canvas.clearSelection();
                      }
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
                  {/* 分隔线 */}
                  <div style={{ width: 1, height: 20, backgroundColor: '#d5d5d5', margin: '0 4px' }} />
                  {/* 解除图层 */}
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation();
                      // 解除编组：移除子元素的groupId，删除组元素
                      if (groupEl.groupChildIds) {
                        groupEl.groupChildIds.forEach(childId => {
                          canvas.updateElement(childId, { groupId: undefined } as any);
                        });
                      }
                      canvas.deleteElement(groupEl.id);
                      canvas.clearSelection();
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#fee2e2'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#ef4444', transition: 'background-color 0.2s ease' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <line x1="9" y1="9" x2="15" y2="15"/>
                      <line x1="15" y1="9" x2="9" y2="15"/>
                    </svg>
                    <span>解除图层</span>
                  </button>
                </div>
              </div>
            </>
          );
        }
        
        // 多选图片时显示功能按钮工具栏
        if (selectedImages.length > 1) {
          // 计算所有选中图片的边界
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          selectedImages.forEach(img => {
            const screenX = img.x * zoom + pan.x;
            const screenY = img.y * zoom + pan.y;
            minX = Math.min(minX, screenX);
            minY = Math.min(minY, screenY);
            maxX = Math.max(maxX, screenX + img.width * zoom);
            maxY = Math.max(maxY, screenY + img.height * zoom);
          });
          
          const centerX = (minX + maxX) / 2;
          const toolbarY = minY - 12;
          
          // 水平间距 - 水平均匀分布
          const handleHorizontalDistribute = () => {
            if (selectedImages.length < 2) return;
            
            // 按x坐标排序
            const sorted = [...selectedImages].sort((a, b) => a.x - b.x);
            
            // 计算总宽度和间距
            const leftmost = sorted[0].x;
            const rightmost = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width;
            const totalWidth = sorted.reduce((sum, el) => sum + el.width, 0);
            const gap = (rightmost - leftmost - totalWidth) / (sorted.length - 1);
            
            // 重新分布
            let currentX = leftmost;
            sorted.forEach((el) => {
              canvas.updateElement(el.id, { x: currentX });
              currentX += el.width + gap;
            });
          };
          
          // 垂直间距 - 垂直均匀分布
          const handleVerticalDistribute = () => {
            if (selectedImages.length < 2) return;
            
            // 按y坐标排序
            const sorted = [...selectedImages].sort((a, b) => a.y - b.y);
            
            // 计算总高度和间距
            const topmost = sorted[0].y;
            const bottommost = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height;
            const totalHeight = sorted.reduce((sum, el) => sum + el.height, 0);
            const gap = (bottommost - topmost - totalHeight) / (sorted.length - 1);
            
            // 重新分布
            let currentY = topmost;
            sorted.forEach((el) => {
              canvas.updateElement(el.id, { y: currentY });
              currentY += el.height + gap;
            });
          };
          
          // 自动布局 - 向右排序，布局后显示在当前可视区域内
          const handleAutoLayout = () => {
            const elements = selectedImages;
            if (elements.length === 0) return;
            
            // 按图片面积从大到小排序
            const sortedElements = [...elements].sort((a, b) => {
              const areaA = a.width * a.height;
              const areaB = b.width * b.height;
              return areaB - areaA; // 从大到小
            });
            
            const gap = 8; // 小空隙
            
            // 计算可视区域（画布坐标）
            const visibleLeft = -pan.x / zoom;
            const visibleTop = -pan.y / zoom;
            const visibleWidth = containerRect.width / zoom;
            const visibleHeight = containerRect.height / zoom;
            
            // 计算布局后的总宽度和最大高度
            let totalWidth = 0;
            let maxHeight = 0;
            sortedElements.forEach(el => {
              totalWidth += el.width + gap;
              maxHeight = Math.max(maxHeight, el.height);
            });
            totalWidth -= gap; // 减去最后一个多余的 gap
            
            // 计算起始位置：让布局居中在可视区域内
            const startX = visibleLeft + (visibleWidth - totalWidth) / 2;
            const startY = visibleTop + (visibleHeight - maxHeight) / 2;
            
            // 横向排列
            let currentX = startX;
            let currentY = startY;
            
            sortedElements.forEach((el) => {
              // 更新位置（不改变大小）
              canvas.updateElement(el.id, {
                x: currentX,
                y: currentY
              });
              
              // 更新下一个位置（向右排列）
              currentX += el.width + gap;
            });
          };
          
          // 合并图层 - 将选中的图片合并为一个组，点击组才能看到内容
          const handleMergeLayers = () => {
            if (selectedImages.length < 2) return;
            
            // 计算边界
            const bounds = selectedImages.reduce((acc, el) => ({
              minX: Math.min(acc.minX, el.x),
              minY: Math.min(acc.minY, el.y),
              maxX: Math.max(acc.maxX, el.x + el.width),
              maxY: Math.max(acc.maxY, el.y + el.height)
            }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
            
            // 按z-index排序（保持遮挡关系）
            const sortedByZIndex = [...selectedImages].sort((a, b) => {
              const indexA = canvas.state.elements.findIndex(e => e.id === a.id);
              const indexB = canvas.state.elements.findIndex(e => e.id === b.id);
              return indexA - indexB;
            });
            
            // 生成组ID
            const groupId = 'group_' + Date.now();
            const childIds = sortedByZIndex.map(el => el.id);
            
            // 标记子元素所属的组
            sortedByZIndex.forEach(el => {
              canvas.updateElement(el.id, { 
                groupId,
              } as any);
            });
            
            // 创建组元素
            canvas.addElement({
              type: 'group',
              name: `组 (${sortedByZIndex.length}个元素)`,
              x: bounds.minX,
              y: bounds.minY,
              width: bounds.maxX - bounds.minX,
              height: bounds.maxY - bounds.minY,
              rotation: 0,
              fill: 'transparent',
              stroke: 'transparent',
              strokeWidth: 0,
              opacity: 1,
              visible: true,
              locked: false,
              groupChildIds: childIds,
            } as any);
            
            // 找到刚创建的组元素并选中
            const groupElement = canvas.state.elements[canvas.state.elements.length - 1];
            
            // 清除选择，然后选中组元素
            canvas.clearSelection();
            if (groupElement) {
              canvas.selectElement(groupElement.id, false);
            }
          };
          
          // 逐个下载所有选中图片
          const handleDownloadSeparately = async () => {
            if (selectedImages.length === 0) return;
            
            for (let i = 0; i < selectedImages.length; i++) {
              const el = selectedImages[i];
              const imgUrl = el.imageUrl;
              const imgName = el.name || `image_${i + 1}.png`;
              
              if (imgUrl) {
                try {
                  const response = await fetch(imgUrl);
                  const blob = await response.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = imgName;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  // 间隔150ms避免浏览器阻止
                  await new Promise(r => setTimeout(r, 100));
                } catch (e) {
                  console.error('下载图片失败:', imgName, e);
                }
              }
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
              const imgUrl = el.imageUrl;
              const imgName = el.name || `image_${i + 1}.png`;
              
              if (imgUrl) {
                try {
                  // 获取图片数据
                  const response = await fetch(imgUrl);
                  const blob = await response.blob();
                  zip.file(imgName, blob);
                } catch (e) {
                  console.error('下载图片失败:', imgName, e);
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
          
          return (
            <div 
              data-toolbar="true"
              className="fixed z-[200]"
              style={{ 
                left: containerRect.left + centerX, 
                top: containerRect.top + toolbarY,
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
                    const imageUrls = selectedImages.filter(img => img.imageUrl).map(img => ({
                      imageUrl: img.imageUrl,
                      prompt: img.sourcePrompt || '',
                    }));
                    if(imageUrls.length > 0) {
                      sessionStorage.setItem('canvasToSend', JSON.stringify({
                        images: imageUrls,
                        imageUrl: imageUrls[0].imageUrl,
                        prompt: imageUrls[0].prompt,
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
                    const imageUrls = selectedImages.filter(img => img.imageUrl).map(img => ({
                      imageUrl: img.imageUrl,
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
                {/* 创建编组 */}
                <button 
                  onClick={() => {
                    const bounds = {
                      minX: Math.min(...selectedImages.map(el => el.x)),
                      minY: Math.min(...selectedImages.map(el => el.y)),
                      maxX: Math.max(...selectedImages.map(el => el.x + el.width)),
                      maxY: Math.max(...selectedImages.map(el => el.y + el.height)),
                    };
                    const groupId = 'group_' + Date.now();
                    const childIds = selectedImages.map(el => el.id);
                    selectedImages.forEach(el => {
                      canvas.updateElement(el.id, { groupId } as any);
                    });
                    const groupElementId = canvas.addElement({
                      type: 'group',
                      name: `组 (${selectedImages.length}个元素)`,
                      x: bounds.minX,
                      y: bounds.minY,
                      width: bounds.maxX - bounds.minX,
                      height: bounds.maxY - bounds.minY,
                      rotation: 0,
                      fill: 'transparent',
                      stroke: '#8b5cf6',
                      strokeWidth: 2,
                      opacity: 1,
                      visible: true,
                      locked: false,
                      groupChildIds: childIds,
                    } as any);
                    canvas.clearSelection();
                    canvas.selectElement(groupElementId, false);
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555555', transition: 'background-color 0.2s ease' }}
                  title="将选中元素编组"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                  </svg>
                  <span>创建编组</span>
                </button>
                {/* 合并图层 */}
                <button 
                  onClick={handleMergeLayers}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555555', transition: 'background-color 0.2s ease' }}
                  title="将选中元素合并为组"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="4" y="4" width="12" height="12" rx="1"/>
                    <rect x="8" y="8" width="12" height="12" rx="1"/>
                  </svg>
                  <span>合并图层</span>
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
                      onClick={(e) => { 
                        e.stopPropagation();
                        handleHorizontalDistribute();
                        const menu = e.currentTarget.parentElement as HTMLElement;
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
                      水平间距
                      <span style={{ marginLeft: 'auto', color: '#999', fontSize: 11 }}>Shift + H</span>
                    </button>
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation();
                        handleVerticalDistribute();
                        const menu = e.currentTarget.parentElement as HTMLElement;
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
                      垂直间距
                      <span style={{ marginLeft: 'auto', color: '#999', fontSize: 11 }}>Shift + V</span>
                    </button>
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation();
                        handleAutoLayout();
                        const menu = e.currentTarget.parentElement as HTMLElement;
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
                      自动排列
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
                        const menu = e.currentTarget.parentElement as HTMLElement;
                        if (menu) menu.style.display = 'none';
                      }}
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
                        const menu = e.currentTarget.parentElement as HTMLElement;
                        if (menu) menu.style.display = 'none';
                      }}
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
        }
        
        // 单选图片时显示工具栏
        const selectedImageEl = selectedImages[0];
        
        // 计算屏幕位置
        const screenX = selectedImageEl.x * zoom + pan.x;
        const screenY = selectedImageEl.y * zoom + pan.y;
        const screenW = selectedImageEl.width * zoom;
        const screenH = selectedImageEl.height * zoom;
        
        // 工具栏位置 - 确保在元素上方，不遮挡内容
        const toolbarHeight = 50;
        const toolbarGap = 12;
        const toolbarX = containerRect.left + screenX + screenW / 2;
        const toolbarY = containerRect.top + screenY - toolbarHeight - toolbarGap;
        
        // 裁剪模式下的工具栏
        if (isCropping && cropImageId === selectedImageEl.id && cropRect) {
          return (
            <>
              {/* 裁剪工具栏 */}
              <div 
                data-toolbar="true"
                className="fixed z-[200]"
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
                      if (selectedImageEl && selectedImageEl.imageUrl) {
                        try {
                          // 加载图片
                          const img = new window.Image();
                          img.crossOrigin = 'anonymous';
                          
                          let imageSrc = selectedImageEl.imageUrl;
                          // 如果是外部URL，先fetch
                          if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
                            const response = await fetch(imageSrc);
                            const blob = await response.blob();
                            imageSrc = URL.createObjectURL(blob);
                          }
                          
                          await new Promise<void>((resolve, reject) => {
                            img.onload = () => resolve();
                            img.onerror = reject;
                            img.src = imageSrc;
                          });
                          
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
                      if (selectedImageEl && selectedImageEl.imageUrl) {
                        try {
                          // 加载图片
                          const img = new window.Image();
                          img.crossOrigin = 'anonymous';
                          
                          let imageSrc = selectedImageEl.imageUrl;
                          // 如果是外部URL，先fetch
                          if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
                            const response = await fetch(imageSrc);
                            const blob = await response.blob();
                            imageSrc = URL.createObjectURL(blob);
                          }
                          
                          await new Promise<void>((resolve, reject) => {
                            img.onload = () => resolve();
                            img.onerror = reject;
                            img.src = imageSrc;
                          });
                          
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
                      if (selectedImageEl && selectedImageEl.imageUrl) {
                        try {
                          // 加载图片
                          const img = new window.Image();
                          img.crossOrigin = 'anonymous';
                          
                          let imageSrc = selectedImageEl.imageUrl;
                          // 如果是外部URL，先fetch
                          if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
                            const response = await fetch(imageSrc);
                            const blob = await response.blob();
                            imageSrc = URL.createObjectURL(blob);
                          }
                          
                          await new Promise<void>((resolve, reject) => {
                            img.onload = () => resolve();
                            img.onerror = reject;
                            img.src = imageSrc;
                          });
                          
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
                      if (selectedImageEl.imageUrl && cropRect) {
                        const originalImageUrl = selectedImageEl.imageUrl;
                        
                        console.log('[裁剪] 开始裁剪:', { 
                          cropRect,
                          elementSize: { w: selectedImageEl.width, h: selectedImageEl.height }
                        });
                        
                        // 先尝试通过 fetch 获取图片，避免跨域问题
                        const processImage = async () => {
                          // 尝试 fetch 图片数据
                          let imageSrc: string = originalImageUrl;
                          
                          // 如果是外部 URL，先下载到本地
                          if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
                            try {
                              console.log('[裁剪] 尝试 fetch 外部图片...');
                              const response = await fetch(imageSrc);
                              const blob = await response.blob();
                              imageSrc = URL.createObjectURL(blob);
                              console.log('[裁剪] fetch 成功，blob size:', blob.size);
                            } catch (fetchErr) {
                              console.warn('[裁剪] 无法fetch图片，尝试直接使用:', fetchErr);
                            }
                          }
                          
                          return new Promise<void>((resolve, reject) => {
                            const img = new window.Image();
                            
                            img.onload = () => {
                              console.log('[裁剪] 图片加载成功, 实际尺寸:', img.naturalWidth, 'x', img.naturalHeight);
                              
                              try {
                                // 计算从画布坐标到图片实际像素坐标的缩放比例
                                const scaleX = img.naturalWidth / selectedImageEl.width;
                                const scaleY = img.naturalHeight / selectedImageEl.height;
                                
                                console.log('[裁剪] 缩放比例:', { scaleX, scaleY });
                                
                                // 转换裁剪区域到图片实际像素坐标
                                const srcX = Math.round(cropRect.x * scaleX);
                                const srcY = Math.round(cropRect.y * scaleY);
                                const srcW = Math.round(cropRect.width * scaleX);
                                const srcH = Math.round(cropRect.height * scaleY);
                                
                                console.log('[裁剪] 实际像素裁剪区域:', { srcX, srcY, srcW, srcH });
                                
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
                                console.log('[裁剪] 开始绘制 canvas...');
                                
                                // 矩形裁剪
                                ctx.drawImage(
                                  img, 
                                  clampedX, clampedY, clampedW, clampedH, 
                                  0, 0, clampedW, clampedH
                                );
                                
                                // 获取 data URL
                                const url = canvasEl.toDataURL('image/png');
                                console.log('[裁剪] 生成 data URL 长度:', url.length);
                                
                                if (!url || url === 'data:,' || url.length < 100) {
                                  reject(new Error('生成的图片为空或数据太小'));
                                  return;
                                }
                                
                                // 计算裁剪后图片在画布上的尺寸
                                const newWidth = cropRect.width;
                                const newHeight = cropRect.height;
                                
                                console.log('[裁剪] 更新元素, 新尺寸:', newWidth, 'x', newHeight, ', 比例:', cropRatio);
                                canvas.updateElement(selectedImageEl.id, {
                                  imageUrl: url,
                                  name: `裁剪_${selectedImageEl.name || 'image'}`,
                                  width: newWidth,
                                  height: newHeight,
                                  isCropped: true,
                                });
                                
                                setIsCropping(false);
                                setCropImageId(null);
                                setCropRect(null);
                                console.log('[裁剪] 裁剪完成!');
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
                            
                            console.log('[裁剪] 开始加载图片...');
                            img.src = imageSrc;
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
              {/* 裁剪模式下不显示文字信息，避免遮挡裁剪框触发区域 */}
            </>
          );
        }
        
        return (
          <>
            {/* 工具栏 */}
            <div 
              data-toolbar="true"
              className="fixed z-[200]"
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
                  if(selectedImageEl.imageUrl) {
                    sessionStorage.setItem('canvasToSend', JSON.stringify({
                      imageUrl: selectedImageEl.imageUrl,
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
                  if(selectedImageEl.imageUrl) {
                    sessionStorage.setItem('canvasToSendVideo', JSON.stringify({
                      imageUrl: selectedImageEl.imageUrl,
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
                  // 进入裁剪模式
                  if(selectedImageEl.imageUrl) {
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
              {/* 分隔线 */}
              <div style={{ width: 1, height: 20, backgroundColor: '#d5d5d5', margin: '0 4px' }} />
              {/* 下载 */}
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  if(selectedImageEl.imageUrl) {
                    const a = document.createElement('a');
                    a.href = selectedImageEl.imageUrl;
                    a.download = selectedImageEl.name || 'image.png';
                    a.click();
                    canvas.clearSelection();
                  }
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
            {/* 文字信息 - 在工具栏下方，文字顶部紧贴工具栏底部 */}
            <div 
              className="fixed z-[200]"
              style={{ 
                left: containerRect.left + screenX,
                top: containerRect.top + screenY - 16, // 文字顶部在图片上方16px，紧贴工具栏底部
                width: screenW,
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
                  fontSize: 12, 
                  fontWeight: 500,
                  color: '#333',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '50%',
                  whiteSpace: 'nowrap',
                  paddingRight: 8,
                }}>{selectedImageEl.name || '未命名图片'}</span>
                <span style={{ 
                  fontSize: 12, 
                  fontWeight: 500,
                  color: '#333',
                  whiteSpace: 'nowrap',
                  paddingLeft: 8,
                }}>
                  {Math.round(selectedImageEl.width)} × {Math.round(selectedImageEl.height)}
                </span>
              </div>
            </div>
          </>
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
        
        // 工具栏位置 - 在文字元素上方居中
        // 工具栏中心X = 容器左边 + 文字屏幕X + 文字宽度的一半
        const toolbarCenterX = containerRect.left + screenX + screenW / 2;
        // 工具栏顶部Y = 容器顶部 + 文字屏幕Y - 工具栏高度 - 间距
        const toolbarTopY = containerRect.top + screenY - TEXT_TOOLBAR_HEIGHT - TEXT_TOOLBAR_GAP;
        
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
      
      {/* 图层面板 */}
      <LayerPanel
        elements={canvas.state.elements}
        selectedIds={canvas.state.selectedIds}
        showPanel={showLayerPanel}
        onTogglePanel={() => setShowLayerPanel(!showLayerPanel)}
        onSelectElement={canvas.selectElement}
      />
      
      {/* 右键菜单 */}
      {contextMenu && (
        <div 
          data-context-menu="true"
          className="fixed bg-gray-50 dark:bg-gray-800 rounded-xl shadow-lg z-50 overflow-hidden border border-gray-200 dark:border-gray-700"
          style={{ left: contextMenu.x, top: contextMenu.y, minWidth: '220px' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 空白区域右键菜单 */}
          {!contextMenu.elementId ? (
            <>
              {/* 粘贴按钮 */}
              <button
                className="w-full px-4 py-2.5 flex items-center justify-between text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
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
              >
                <span>粘贴</span>
                <span className="text-gray-400 dark:text-gray-500 text-xs">Ctrl + V</span>
              </button>
              
              <div className="h-px bg-gray-100 dark:bg-gray-700 my-1" />
              
              {/* 放大按钮 */}
              <button
                className="w-full px-4 py-2.5 flex items-center justify-between text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                onClick={() => {
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
                  setContextMenu(null);
                }}
              >
                <span>放大</span>
                <span className="text-gray-400 dark:text-gray-500 text-xs">{Math.round(zoom * 100)}%</span>
              </button>
              
              {/* 缩小按钮 */}
              <button
                className="w-full px-4 py-2.5 flex items-center justify-between text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                onClick={() => {
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
                  setContextMenu(null);
                }}
              >
                <span>缩小</span>
                <span className="text-gray-400 dark:text-gray-500 text-xs">{Math.round(zoom * 100)}%</span>
              </button>
              
              {/* 显示画布所有图片按钮 */}
              <button
                className="w-full px-4 py-2.5 flex items-center justify-between text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                onClick={() => {
                  const container = canvasContainerRef.current;
                  if (!container) return;
                  const rect = container.getBoundingClientRect();
                  
                  // 使用 useCanvasCore 的 fitToAllImages 函数
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
              >
                <span>显示画布所有图片</span>
              </button>
            </>
          ) : (
            /* 元素右键菜单 - 原有样式 */
            <>
              {/* 复制按钮 - 排在第一位 */}
              <button
                className="w-full px-4 py-2 flex items-center justify-between text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                onClick={() => {
                  const selectedElements = canvas.state.elements.filter(el => canvas.state.selectedIds.includes(el.id));
                  if (selectedElements.length > 0) {
                    const copiedElements = selectedElements.map(el => ({ ...el }));
                    setClipboard(copiedElements);
                    // 同步到全局剪贴板，确保主组件的Ctrl+V也能使用
                    (window as any).__canvasClipboard = copiedElements;
                  }
                  setContextMenu(null);
                }}
              >
                <span>复制</span>
                <span className="text-gray-400 dark:text-gray-500 text-xs">Ctrl+C</span>
              </button>
              {[
                { label: '粘贴', shortcut: 'Ctrl+V', action: () => {
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
                }},
                { divider: true },
                { label: '上移一层', shortcut: 'Ctrl+]', action: () => {
                  if (contextMenu.elementId) {
                    canvas.bringForward(contextMenu.elementId);
                  }
                }},
                { label: '下移一层', shortcut: 'Ctrl+[', action: () => {
                  if (contextMenu.elementId) {
                    canvas.sendBackward(contextMenu.elementId);
                  }
                }},
                { label: '移动至顶层', action: () => {
                  if (contextMenu.elementId) {
                    canvas.bringToFront(contextMenu.elementId);
                  }
                }},
                { label: '移动至底层', action: () => {
                  if (contextMenu.elementId) {
                    canvas.sendToBack(contextMenu.elementId);
                  }
                }},
                { divider: true },
                { label: '删除', shortcut: 'Delete', action: () => canvas.deleteSelected() },
              ].map((item, i) => {
                if (item.divider) return <div key={i} className="h-px bg-gray-100 my-1" />;
                return (
                  <button
                    key={i}
                    className="w-full px-4 py-2 flex items-center justify-between text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                    onClick={() => {
                      item.action?.();
                      setContextMenu(null);
                    }}
                  >
                    <span>{item.label}</span>
                    <span className="text-gray-400 text-xs ml-6">{item.shortcut || ''}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </>
  );
}
