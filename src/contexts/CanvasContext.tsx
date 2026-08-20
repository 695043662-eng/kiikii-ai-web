'use client';

import React, { useReducer, useCallback, useRef, useMemo, createContext, useContext, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { CanvasElement, ToolType, CanvasAnnotation } from '@/types/canvas';
import { useAutoSave } from '@/hooks/useAutoSave';
import { storeImage, getImages } from '@/lib/canvas-image-db';
import { safeSetItem } from '@/lib/safe-storage';
import { safeJsonResponse } from '@/lib/safe-json';
import { CANVAS_HEIGHT as CANVAS_HEIGHT_CONST, MIN_ZOOM } from '@/hooks/useCanvasCore';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';
// 🔧 #450 修复：导入全局上传追踪器，让面板生成时能等待画布图片上传完成
import { globalPendingUploads } from '@/hooks/useOptimisticUpload';
import { clearSensitiveLocalStorage } from '@/lib/local-storage-cleanup';

// 生成唯一ID - #586 修复：使用 crypto.randomUUID() 根除幽灵重复 ID
const generateId = () => crypto.randomUUID();

// localStorage key
const CANVAS_STORAGE_KEY = 'canvas_data';

// 状态接口
interface CanvasState {
  elements: CanvasElement[];
  selectedIds: string[];
  tool: ToolType;
  zoom: number;
  panX: number;
  panY: number;
  gridVisible: boolean;
  previewMode: boolean;
  historyIndex: number;
  annotations: CanvasAnnotation[]; // ChatCanvas 标注
  activeAnnotationId: string | null; // 当前活动的标注
}

// #861 修复：验证 imageUrl 是否有效（blob:/bare UUID/非http 均视为无效）
const isValidImageUrl = (url: string | undefined | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  // 有效：http://, https://, /api/ (后端代理), data: (base64)
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/api/') || url.startsWith('data:')) {
    return true;
  }
  // 无效：blob:（刷新后失效）、裸 UUID、其他相对路径
  return false;
};

// #861 修复：清洗 elements 中的无效 imageUrl，防止 ERR_FILE_NOT_FOUND 崩溃
// #863 修复：增加僵尸状态清洗（Defense 2），消除刷新后永久卡死的 Loading/Generating UI
const sanitizeElements = (elements: CanvasElement[]): CanvasElement[] => {
  return elements.map(el => {
    if (el.type === 'image') {
      const imageUrl = (el as any).imageUrl;
      const videoUrl = (el as any).videoUrl;
      const status = (el as any).generationStatus;
      const updates: Record<string, any> = {};

      // 清洗无效 imageUrl（blob:/裸 UUID/非http）
      if (imageUrl && !isValidImageUrl(imageUrl)) {
        updates.imageUrl = undefined;
      }
      // 清洗无效 videoUrl
      if (videoUrl && !isValidImageUrl(videoUrl) && !videoUrl.startsWith('blob:')) {
        // videoUrl 允许 blob:（正在生成中），但裸 UUID 清洗掉
        if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://') && !videoUrl.startsWith('/api/') && !videoUrl.startsWith('blob:')) {
          updates.videoUrl = undefined;
        }
      }

      // #863 Defense 2: 僵尸状态清洗 - 刷新后残留的 generating/loading 状态永远卡死
      // 因为后端连接已断开，这些状态不可能自然完成
      if (status === 'generating' || status === 'submitted' || status === 'recovering') {
        // 有持久化 key = 生成实际已完成，只是 imageUrl 被 saveStateToStorage 剥离了
        if ((el as any).imageKey || (el as any).videoKey || (el as any).dbId) {
          updates.generationStatus = 'completed';
        } else {
          // 无 key = 生成被刷新中断，标记为失败
          updates.generationStatus = 'failed';
          updates.generationError = '页面刷新中断了生成任务，请重新生成';
        }
      }
      // 强制重置残留的 isLoading
      if ((el as any).isLoading === true) {
        updates.isLoading = false;
      }

      if (Object.keys(updates).length > 0) {
        return { ...el, ...updates };
      }
      return el;
    }

    // image-stack / generate-panel: 清洗 imageUrls 数组 + 僵尸状态
    if (el.type === 'image-stack' || el.type === 'generate-panel') {
      const imageUrls = (el as any).imageUrls;
      const status = (el as any).generationStatus;
      const updates: Record<string, any> = {};

      if (Array.isArray(imageUrls)) {
        const cleanedUrls = imageUrls.filter((u: string) => isValidImageUrl(u));
        if (cleanedUrls.length !== imageUrls.length) {
          updates.imageUrls = cleanedUrls;
        }
      }

      // #863 Defense 2: 僵尸状态清洗
      if (status === 'generating' || status === 'submitted' || status === 'recovering') {
        const imageKeys = (el as any).imageKeys;
        // 有持久化 key = 生成实际已完成
        if (Array.isArray(imageKeys) && imageKeys.length > 0) {
          updates.generationStatus = 'completed';
        } else {
          updates.generationStatus = 'failed';
          updates.generationError = '页面刷新中断了生成任务，请重新生成';
        }
      }
      if ((el as any).isLoading === true) {
        updates.isLoading = false;
      }

      if (Object.keys(updates).length > 0) {
        return { ...el, ...updates };
      }
      return el;
    }

    return el;
  });
};

// 🔧 #461 诊断日志：从 localStorage 加载状态
// #861 修复：此函数仅在 useEffect 中调用，不在 useReducer 初始化器中调用（避免 Hydration #418）
const loadStateFromStorage = (): CanvasState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(CANVAS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // 验证数据格式
      if (parsed && Array.isArray(parsed.elements)) {
        // #861 修复：清洗无效 imageUrl（blob:/裸 UUID）
        const sanitizedElements = sanitizeElements(parsed.elements);
        // #Bug2 修复：对拥有 imageKey 的 image 元素，剥离 imageUrl/providerUrl
        // 防止已过期的 providerUrl 被误认为有效 URL，导致恢复逻辑不介入
        const strippedElements = sanitizedElements.map((el: CanvasElement) => {
          if (el.type === 'image' && (el as any).imageKey) {
            const { imageUrl, providerUrl, ...cleanRest } = el as any;
            if (imageUrl || providerUrl) {
              return cleanRest;
            }
            return el;
          }
          return el;
        });
        return {
          ...initialState,
          ...parsed,
          elements: strippedElements,
          selectedIds: [], // 不保存选中状态
        };
      }
    }
  } catch (e) {
    console.error('[Canvas] 加载 localStorage 失败:', e);
  }
  return null;
};

// 🔧 #461 诊断日志：保存状态到 localStorage
const saveStateToStorage = (state: CanvasState, isRestoring: boolean = false) => {
  if (typeof window === 'undefined') return;
  
  // #030 修复：【防冲刷】如果是真正的初始状态，严禁保存，防止覆盖存档
  // 初始状态特征：元素为空 + zoom=100 + pan=(0,0)
  // 但是如果 zoom 或 pan 有变化，即使元素为空也要保存！
  const hasViewportChange = state.zoom !== 100 || state.panX !== 0 || state.panY !== 0;
  const isInitialState = state.elements.length === 0 && !hasViewportChange;
  if (isInitialState || isRestoring) {
    return;
  }
  
  try {
    // 只保存元素和标注，不保存选中状态和视图状态
    // 对于图片元素，只保存 imageKey/dbId/imageKeys，不保存 imageUrl（签名 URL 会过期，base64 太大，blob URL 会失效）
    const elementsToSave = state.elements.map(el => {
      if (el.type === 'image') {
        // 移除 imageUrl（会过期或失效），保留其他属性（包括 imageKey 和 dbId）
        const { imageUrl, ...rest } = el;
        
        // 🔧 #616 视频类型图片：同时移除 videoUrl，保留 videoKey
        if ((el as any).sourceType === 'video' && (el as any).videoKey) {
          const { videoUrl, ...restWithoutVideoUrl } = rest as any;
          return restWithoutVideoUrl;
        }
        
        // COS 图片：有 imageKey
        if (el.imageKey) {
          return rest; // rest 包含 dbId 等其他属性
        }
        
        // 本地图片：有 dbId
        if ((el as any).dbId) {
          return rest; // rest 包含 dbId
        }
        
        // 既没有 imageKey 也没有 dbId，无法持久化图片内容
        return rest;
      }
      
      // #385 修复：image-stack 类型也需要移除 imageUrls，保留 imageKeys
      if (el.type === 'image-stack') {
        const elImageKeys = (el as any).imageKeys as (string | null)[] | undefined;
        const hasValidKeys = elImageKeys && elImageKeys.length > 0 && elImageKeys.every(k => k !== null && k !== '');
        
        if (hasValidKeys) {
          const { imageUrls, ...rest } = el as any;
          return rest;
        } else {
          return el;
        }
      }
      
      // #398 新增：generate-panel 类型也需要移除 imageUrls，保留 imageKeys
      if (el.type === 'generate-panel') {
        const elImageKeys = (el as any).imageKeys as (string | null)[] | undefined;
        const hasValidKeys = elImageKeys && elImageKeys.length > 0 && elImageKeys.every(k => k !== null && k !== '');
        
        if (hasValidKeys) {
          const { imageUrls, ...rest } = el as any;
          return rest;
        } else {
          // #523 兜底：imageKeys 为空或含 null/空值，保留 imageUrls 防止图片丢失
          console.warn('[Canvas] #523 generate-panel imageKeys 无效，保留 imageUrls 兜底:', {
            id: el.id,
            imageKeys: elImageKeys,
            imageUrlsCount: (el as any).imageUrls?.length || 0,
          });
          return el;
        }
      }
      
      // #615 新增：视频类型也需要移除 videoUrl，保留 videoKey
      // #619 终极修复：统一处理 type:'video' 和 type:'image'+sourceType:'video' 的视频元素
      // #628 优化：COS 签名 URL（5天有效）不再剥离，实现刷新秒开
      const isVideoNode = el.type === 'video' || ((el as any).sourceType === 'video');
      if (isVideoNode) {
        const videoEl = el as any;
        
        // #625 安检：检测 videoKey 是否包含 blob URL（脏数据）
        // 这是防御性编程的最后一道防线，确保存入 localStorage 的数据绝对干净
        if (videoEl.videoKey && (
          (videoEl.videoKey as string).startsWith('blob:') ||
          (videoEl.videoKey as string).startsWith('proxy:blob:')
        )) {
          console.warn('[Canvas] #625 videoKey 包含 blob URL，剥离脏数据:', el.id, 'videoKey:', videoEl.videoKey?.substring(0, 50));
          const { videoUrl, videoKey, imageUrl, ...rest } = videoEl;
          return { ...rest, generationStatus: 'recovering' };
        }
        
        // 有 videoKey，可以持久化
        if (videoEl.videoKey) {
          const videoUrlStr = videoEl.videoUrl as string | undefined;
          
          // #628 核心优化：判断 videoUrl 类型
          // - COS 签名 URL（以 https://开头，不含 /api/ 代理路径）→ 保留！刷新秒开
          // - 代理 URL（含 /api/canvas/image 或 /api/video/proxy）→ 剥离，用 videoKey 恢复
          // - blob URL → 剥离
          const isCosSignedUrl = videoUrlStr && 
            videoUrlStr.startsWith('https://') && 
            !videoUrlStr.includes('/api/canvas/image') && 
            !videoUrlStr.includes('/api/video/proxy');
          const isBlobUrl = videoUrlStr && videoUrlStr.startsWith('blob:');
          const isProxyUrl = videoUrlStr && (
            videoUrlStr.includes('/api/canvas/image') || 
            videoUrlStr.includes('/api/video/proxy')
          );
          
          if (isCosSignedUrl) {
            // #628 王炸：COS 5天签名 URL 直接持久化，刷新 0 延迟秒开
            // 不剥离 videoUrl 和 thumbnailUrl，直接存！
            // 只剥离 imageUrl（图片缩略图用代理 URL 恢复即可）
            const { imageUrl, ...rest } = videoEl;
            return rest;
          }
          
          // 代理 URL 或 blob URL → 剥离，仅保留 videoKey
          if (isProxyUrl || isBlobUrl) {
            // #629 修复：也剥离 thumbnailUrl（如果是 blob URL）
            const thumbnailUrlStr = videoEl.thumbnailUrl as string | undefined;
            const isThumbnailBlob = thumbnailUrlStr && thumbnailUrlStr.startsWith('blob:');
            
            const { videoUrl, imageUrl, thumbnailUrl, ...rest } = videoEl;
            // 如果 thumbnailUrl 是 COS URL，保留它
            if (videoEl.thumbnailKey && !isThumbnailBlob) {
              rest.thumbnailUrl = thumbnailUrlStr;
            }
            
            return rest;
          }
          
          // 有 videoKey 但无 videoUrl → 直接保存
          return videoEl;
        }
        // #619 终极修复：没有 videoKey 但有 blob URL（COS上传失败的情况）
        // blob URL 刷新后必然失效，需要剥离以触发恢复逻辑的代理兜底
        if (videoEl.videoUrl && (videoEl.videoUrl as string).startsWith('blob:')) {
          console.warn('[Canvas] #619 视频有 blob URL 但无 videoKey，剥离 blob URL 触发代理兜底:', el.id);
          const { videoUrl, imageUrl, ...rest } = videoEl;
          // 标记为需要代理恢复，保留 sourceType 等元信息
          return { ...rest, generationStatus: 'recovering' };
        }
        // 没有 videoKey 也没有 blob URL，记录警告
        if (videoEl.videoUrl) {
          console.warn('[Canvas] 视频缺少 videoKey，刷新后可能丢失:', el.id);
        }
        return el;
      }
      
      return el;
    });
    
    // #054 修复：删除 #041 的错误逻辑！
    // 保存时直接用 state 中的 zoom/pan，不需要去读 localStorage 的旧值！
    const dataToSave = {
      elements: elementsToSave,
      annotations: state.annotations,
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
    };
    safeSetItem(CANVAS_STORAGE_KEY, JSON.stringify(dataToSave));
  } catch (e) {
    console.error('[Canvas] 保存 localStorage 失败:', e);
  }
};

// 初始状态
const initialState: CanvasState = {
  elements: [],
  selectedIds: [],
  tool: 'select',
  zoom: 100,
  panX: 0,
  panY: 0,
  gridVisible: false,
  previewMode: false,
  historyIndex: 0,
  annotations: [],
  activeAnnotationId: null,
};

// Action 类型
type Action =
  | { type: 'ADD_ELEMENT'; payload: CanvasElement }
  | { type: 'ADD_ELEMENTS'; payload: CanvasElement[] }
  | { type: 'UPDATE_ELEMENT'; payload: { id: string; updates: Partial<CanvasElement> } }
  | { type: 'DELETE_ELEMENTS'; payload: string[] }
  | { type: 'SELECT_ELEMENTS'; payload: string[] }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_TOOL'; payload: ToolType }
  | { type: 'SET_ZOOM'; payload: number }
  | { type: 'SET_PAN'; payload: { x: number; y: number } }
  | { type: 'TOGGLE_GRID' }
  | { type: 'TOGGLE_PREVIEW' }
  | { type: 'MOVE_ELEMENT'; payload: { id: string; dx: number; dy: number } }
  | { type: 'BRING_FORWARD'; payload: string }
  | { type: 'SEND_BACKWARD'; payload: string }
  | { type: 'BRING_TO_FRONT'; payload: string }
  | { type: 'BRING_TO_FRONT_AND_SELECT'; payload: string }
  | { type: 'SEND_TO_BACK'; payload: string }
  | { type: 'RESTORE_HISTORY'; payload: { elements: CanvasElement[]; selectedIds: string[]; zoom?: number; panX?: number; panY?: number } }
  // 标注相关 Actions
  | { type: 'ADD_ANNOTATION'; payload: CanvasAnnotation }
  | { type: 'UPDATE_ANNOTATION'; payload: { id: string; updates: Partial<CanvasAnnotation> } }
  | { type: 'DELETE_ANNOTATION'; payload: string }
  | { type: 'SET_ACTIVE_ANNOTATION'; payload: string | null }
  // #031 修复：添加 SET_VIEWPORT action，用于一次性设置 zoom 和 pan
  | { type: 'SET_VIEWPORT'; payload: { zoom: number; panX: number; panY: number } }
  // #299 新增：批量更新元素（用于选中框缩放，避免循环调用 updateElement 导致性能问题）
  | { type: 'UPDATE_ELEMENTS_BATCH'; payload: Array<{ id: string; updates: Partial<CanvasElement> }> }
  // #846 云画布自动保存：加载云端状态（部分字段合并）/ 批量设置元素（temp→perm 回填）
  | { type: 'LOAD_STATE'; payload: Partial<CanvasState> }
  | { type: 'SET_ELEMENTS'; payload: CanvasElement[] };

// Reducer
function canvasReducer(state: CanvasState, action: Action): CanvasState {
  switch (action.type) {
    case 'ADD_ELEMENT':
      return {
        ...state,
        elements: [...state.elements, action.payload],
        selectedIds: [action.payload.id],
      };

    // #585 修复：批量添加元素，单次 dispatch 避免 React 19 insertBefore 错误
    case 'ADD_ELEMENTS':
      return {
        ...state,
        elements: [...state.elements, ...action.payload],
        selectedIds: action.payload.map(el => el.id),
      };

    case 'UPDATE_ELEMENT':
      return {
        ...state,
        elements: state.elements.map(el =>
          el.id === action.payload.id ? { ...el, ...action.payload.updates } : el
        ),
      };

    // #299 新增：批量更新元素（用于选中框缩放，O(N) 复杂度）
    case 'UPDATE_ELEMENTS_BATCH':
      const updatesMap = new Map(action.payload.map(u => [u.id, u.updates]));
      return {
        ...state,
        elements: state.elements.map(el => {
          const updates = updatesMap.get(el.id);
          return updates ? { ...el, ...updates } : el;
        }),
      };

    case 'DELETE_ELEMENTS':
      return {
        ...state,
        elements: state.elements.filter(el => !action.payload.includes(el.id)),
        selectedIds: state.selectedIds.filter(id => !action.payload.includes(id)),
      };

    case 'SELECT_ELEMENTS':
      return {
        ...state,
        selectedIds: action.payload,
      };

    case 'CLEAR_SELECTION':
      return {
        ...state,
        selectedIds: [],
      };

    case 'SET_TOOL':
      return {
        ...state,
        tool: action.payload,
      };

    case 'SET_ZOOM':
      return {
        ...state,
        // #038 修复：允许更小的 zoom 值（最小 1%），支持超远视视角
        zoom: Math.max(1, Math.min(400, action.payload)),
      };

    case 'SET_PAN':
      return {
        ...state,
        panX: action.payload.x,
        panY: action.payload.y,
      };

    // #031 修复：添加 SET_VIEWPORT action，一次性设置 zoom 和 pan
    case 'SET_VIEWPORT':
      return {
        ...state,
        zoom: Math.max(1, Math.min(400, action.payload.zoom)),
        panX: action.payload.panX,
        panY: action.payload.panY,
      };

    case 'TOGGLE_GRID':
      return {
        ...state,
        gridVisible: !state.gridVisible,
      };

    case 'TOGGLE_PREVIEW':
      return {
        ...state,
        previewMode: !state.previewMode,
      };

    case 'MOVE_ELEMENT':
      return {
        ...state,
        elements: state.elements.map(el =>
          el.id === action.payload.id
            ? { ...el, x: el.x + action.payload.dx, y: el.y + action.payload.dy }
            : el
        ),
      };

    case 'BRING_FORWARD': {
      const idx = state.elements.findIndex(el => el.id === action.payload);
      if (idx < state.elements.length - 1) {
        const newElements = [...state.elements];
        [newElements[idx], newElements[idx + 1]] = [newElements[idx + 1], newElements[idx]];
        return { ...state, elements: newElements };
      }
      return state;
    }

    case 'SEND_BACKWARD': {
      const idx = state.elements.findIndex(el => el.id === action.payload);
      if (idx > 0) {
        const newElements = [...state.elements];
        [newElements[idx], newElements[idx - 1]] = [newElements[idx - 1], newElements[idx]];
        return { ...state, elements: newElements };
      }
      return state;
    }

    case 'BRING_TO_FRONT': {
      const idx = state.elements.findIndex(el => el.id === action.payload);
      if (idx >= 0 && idx < state.elements.length - 1) {
        const newElements = [...state.elements];
        const [el] = newElements.splice(idx, 1);
        newElements.push(el);
        return { ...state, elements: newElements };
      }
      return state;
    }

    case 'BRING_TO_FRONT_AND_SELECT': {
      // #608 终结重排核爆：不再 splice+push 重排数组，只改 zIndex！
      // 数组顺序绝对静止 = DOM 节点不移动 = Chrome 不重栅格化图片
      const maxZ = Math.max(...state.elements.map(e => e.zIndex || 1));
      const newElements = state.elements.map(el => {
        if (el.id === action.payload) {
          return { ...el, zIndex: maxZ + 1 };
        }
        return el;
      });
      return { ...state, elements: newElements, selectedIds: [action.payload] };
    }

    case 'SEND_TO_BACK': {
      const idx = state.elements.findIndex(el => el.id === action.payload);
      if (idx > 0) {
        const newElements = [...state.elements];
        const [el] = newElements.splice(idx, 1);
        newElements.unshift(el);
        return { ...state, elements: newElements };
      }
      return state;
    }

    case 'RESTORE_HISTORY':
      return {
        ...state,
        elements: action.payload.elements,
        selectedIds: action.payload.selectedIds,
        // 恢复画布位置和缩放（如果有）
        zoom: action.payload.zoom ?? state.zoom,
        panX: action.payload.panX ?? state.panX,
        panY: action.payload.panY ?? state.panY,
      };

    // 标注相关处理
    case 'ADD_ANNOTATION':
      return {
        ...state,
        annotations: [...state.annotations, action.payload],
        activeAnnotationId: action.payload.id,
      };

    case 'UPDATE_ANNOTATION':
      return {
        ...state,
        annotations: state.annotations.map(ann =>
          ann.id === action.payload.id ? { ...ann, ...action.payload.updates } : ann
        ),
      };

    case 'DELETE_ANNOTATION':
      return {
        ...state,
        annotations: state.annotations.filter(ann => ann.id !== action.payload),
        activeAnnotationId: state.activeAnnotationId === action.payload ? null : state.activeAnnotationId,
      };

    // #846 云画布自动保存：加载云端状态（合并到现有 state，保留前端运行时状态）
    case 'LOAD_STATE':
      return {
        ...state,
        ...action.payload,
        // 保留前端运行时状态，不覆盖
      };

    // #846 云画布自动保存：批量替换元素（temp→perm 回填）
    case 'SET_ELEMENTS':
      return {
        ...state,
        elements: action.payload,
      };

    default:
      return state;
  }
}

// Context

// ============ 云画布自动保存类型 ============
type CloudSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface CanvasContextType {
  state: CanvasState;
  addElement: (element: Omit<CanvasElement, 'id'>) => string;
  updateElement: (id: string, updates: Partial<CanvasElement>) => void;
  // #299 新增：批量更新元素（用于选中框缩放，避免循环调用 updateElement 导致性能问题）
  updateElementsBatch: (updates: Array<{ id: string; updates: Partial<CanvasElement> }>) => void;
  deleteElement: (id: string) => void;
  // #299 暴露 saveHistory 方法（用于选中框缩放结束后保存历史）
  saveHistory: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  selectElement: (id: string, multi?: boolean) => void;
  selectElements: (ids: string[]) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setTool: (tool: ToolType) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  toggleGrid: () => void;
  togglePreview: () => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  alignLeft: () => void;
  alignCenter: () => void;
  alignRight: () => void;
  alignTop: () => void;
  alignMiddle: () => void;
  alignBottom: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  exportAsImage: () => void;
  importImage: (
    file: File,
    position?: { x: number; y: number },
    viewportInfo?: {
      zoom: number;
      panX: number;
      panY: number;
      containerWidth: number;
      containerHeight: number;
    },
    presetDimensions?: { width: number; height: number }
  ) => Promise<void>;
  // ChatCanvas 标注相关
  addAnnotation: (annotation: Omit<CanvasAnnotation, 'id' | 'timestamp'>) => string;
  updateAnnotation: (id: string, updates: Partial<CanvasAnnotation>) => void;
  deleteAnnotation: (id: string) => void;
  setActiveAnnotation: (id: string | null) => void;
  // 图像/视频生成器
  addImageGenerator: () => void;
  addVideoGenerator: () => void;
  // #032 修复：分离 isInitialized（配置读取完成）和 isRestoring（图片恢复中）
  isInitialized: boolean;  // 配置读取完成（瞬间）
  isRestoring: boolean;    // 图片恢复中（耗时）
  isCloudSyncing: boolean; // #887 弊端4：云端同步中状态
  // #887 弊端1终极加固：CAS 冲突弹窗
  casConflictData: { canvas_data: any; server_updated_at: string } | null;
  resolveCasConflict: (acceptCloud: boolean) => void; // 接受云端数据(true) 或 保持本地(false)
  // 【强制保存】绕过防抖，立即同步写入 localStorage
  forceSaveToStorage: () => void;
  // 🔧 #221 修复：暴露 stateRef，解决 React 闭包陷阱
  stateRef: React.MutableRefObject<CanvasState>;
  // 云画布自动保存状态
  cloudSaveStatus: CloudSaveStatus;
  // 从云端加载画布（初始化时调用），返回 canvas_data 或 null
  loadFromCloud: () => Promise<Record<string, unknown> | null>;
  // 强制立即保存到云端（页面离开前调用）
  forceCloudSave: () => Promise<boolean>;
}

const CanvasContext = createContext<CanvasContextType | null>(null);

export function CanvasProvider({ children }: { children: React.ReactNode }) {
  // #889 修复：从 AIGeneratorContext 获取真实登录状态和鉴权检查状态
  const { userId: realUserId, isLoggedIn: realIsLoggedIn, authChecked: realAuthChecked } = useAIGenerator();
  
  // #861 修复：Hydration #418 根因修复
  // 原因：useReducer 的 lazy initializer 在 SSR 返回 initialState，在客户端 hydration 返回 localStorage 数据
  //       两者不一致 → React #418 Hydration Mismatch 崩溃
  // 修复：useReducer 始终返回 initialState（SSR/CSR 一致），localStorage 恢复移至 useEffect
  const [state, dispatch] = useReducer(canvasReducer, initialState);
  
  const historyRef = useRef<{ elements: CanvasElement[]; selectedIds: string[] }[]>([{ elements: [], selectedIds: [] }]);
  const historyIndexRef = useRef(0);
  
  // #079 修复：使用 ref 存储最新状态，解决 forceSaveToStorage 闭包问题
  const stateRef = useRef(state);
  stateRef.current = state;

  // #861 修复：isInitialized 初始为 false，等待 useEffect 恢复 localStorage 后设为 true
  // 这样 SSR 和客户端初始渲染都显示 loading spinner（一致），消除 Hydration #418
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  // #887 弊端4：云端同步中状态指示器
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  // #887 弊端1终极加固：CAS 冲突弹窗状态
  const [casConflictData, setCasConflictData] = useState<{
    canvas_data: any;
    server_updated_at: string;
  } | null>(null);

  // #891 修复：PLG模式 - 无论登录状态都允许从 localStorage 恢复画布
  // 未登录用户也可以操作画布（先玩再登录），画布数据持久化到 localStorage
  // - authChecked=true && isLoggedIn=true → 加载 localStorage 数据（登录用户，后续会被云端数据覆盖/合并）
  // - authChecked=true && isLoggedIn=false → 也加载 localStorage 数据（未登录用户，纯前端模式）
  // - authChecked=false → 等待（不加载也不标记初始化，画布显示 loading）
  const localStorageLoadedRef = useRef(false);
  useEffect(() => {
    if (localStorageLoadedRef.current) return;
    // #889 鉴权漏洞修复：等待鉴权检查完成
    if (!realAuthChecked) return;
    localStorageLoadedRef.current = true;

    // #891 修复：无论登录状态都从 localStorage 恢复画布（PLG模式）
    // 未登录用户可以自由操作画布，数据保存在 localStorage 中
    const savedState = loadStateFromStorage();
    if (savedState && savedState.elements && savedState.elements.length > 0) {
      console.log('[AutoSave] 从 localStorage 恢复画布（PLG模式），元素数:', savedState.elements.length, '登录状态:', realIsLoggedIn);
      dispatch({ type: 'LOAD_STATE', payload: {
        elements: savedState.elements,
        zoom: savedState.zoom,
        panX: savedState.panX,
        panY: savedState.panY,
      }});
    }
    // 无论是否有 localStorage 数据，都标记为已初始化
    setIsInitialized(true);
  }, [realAuthChecked, realIsLoggedIn]);

  // #890 终极清扫：账号切换原子性重置（userId 变化但仍然登录）
  const canvasPrevUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (canvasPrevUserIdRef.current === null) {
      canvasPrevUserIdRef.current = realUserId;
      return;
    }
    const prevId = canvasPrevUserIdRef.current;
    canvasPrevUserIdRef.current = realUserId;
    // 账号切换：A→B，清空 A 的画布数据，让 B 的云端数据加载进来
    if (realIsLoggedIn && realUserId && prevId && realUserId !== prevId) {
      console.log('[AutoSave] #890 账号切换 %s → %s，清空画布等待新账号云端数据', prevId, realUserId);
      dispatch({ type: 'SET_ELEMENTS', payload: [] });
      clearSensitiveLocalStorage();
    }
  }, [realIsLoggedIn, realUserId]);

  // #891 修复：登出时不再清空画布！
  // 用户未登录时也可以操作画布（PLG模式），登出后保留画布数据让用户继续把玩
  // 只有真正的账号切换（A→B）才会清空画布
  // 注意：登出时 clearSensitiveLocalStorage 仍然需要清理敏感数据（对话记录等），
  // 但画布数据（canvas_data）不属于敏感数据，无需清理
  useEffect(() => {
    // 仅在 authChecked 后、且从登录变为未登录时触发
    if (!realAuthChecked) return;
    if (realIsLoggedIn) return; // 仍然登录，不需要处理
    
    // #891 修复：登出时不再清空画布元素！
    // PLG模式：未登录用户也可以自由操作画布，登出后保留画布数据
    // 只清理敏感数据（对话记录等），不清画布
    console.log('[AutoSave] 检测到登出，保留画布数据，清理敏感 localStorage');
    clearSensitiveLocalStorage();
    // 注意：不再 dispatch SET_ELEMENTS [] 清空画布
  }, [realAuthChecked, realIsLoggedIn]);

  // 客户端加载 localStorage 数据（用于图片恢复）
  // 🔧 P1.7 修复：保存 timer ID 用于清理
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ====== 云端自动保存 (Auto-Save) ======
  // 静默回填：当后端将 temp/ 资产转正为 perm/ 后，更新 elements 中的 imageKey
  const silentUpdateImageKeys = useCallback((updatedCanvasData: any) => {
    if (!updatedCanvasData?.elements) return;
    const updatedElements = updatedCanvasData.elements;
    // 仅在有 temp→perm 替换时才更新，避免无谓的 dispatch
    let hasChanges = false;
    const newElements = stateRef.current.elements.map((el: CanvasElement) => {
      const match = updatedElements.find((ue: any) => ue.id === el.id);
      if (!match) return el;
      
      // 单图元素：imageKey 回填
      if (match.imageKey && el.imageKey && el.imageKey !== match.imageKey) {
        hasChanges = true;
        return { ...el, imageKey: match.imageKey };
      }
      // #871 修复：多图元素（扑克牌/生成面板）imageKeys 数组回填
      if ((el.type === 'image-stack' || el.type === 'generate-panel') && 
          Array.isArray((match as any).imageKeys) && Array.isArray((el as any).imageKeys)) {
        const matchKeys = (match as any).imageKeys;
        const elKeys = (el as any).imageKeys;
        // 检查是否有任何 key 不同（temp→perm 替换）
        if (matchKeys.length === elKeys.length && matchKeys.some((k: string, i: number) => k !== elKeys[i])) {
          hasChanges = true;
          return { ...el, imageKeys: matchKeys };
        }
      }
      return el;
    });
    if (hasChanges) {
      dispatch({ type: 'SET_ELEMENTS', payload: newElements });
      console.log('[AutoSave] 静默回填：temp→perm imageKey/imageKeys 更新完成');
    }
  }, [dispatch]);

  // 云端自动保存 Hook（防抖 5 秒）
  const {
    saveStatus: cloudSaveStatus,
    loadWorkspace: loadFromCloud,
    forceSave: forceCloudSave,
    onCanvasChanged,
  } = useAutoSave({
    userId: realUserId, // #889 修复：使用真实用户ID，实现云端账号绑定
    isLoggedIn: realIsLoggedIn, // #889 修复：使用真实登录状态
    getCanvasSnapshot: () => {
      const currentState = stateRef.current;
      // #Bug2-fix: 云端快照剥离 imageUrl/providerUrl，只保留 imageKey
      // 原因：providerUrl 是外部短期 URL（几小时过期），存储到云端后再加载会导致图片丢失
      // 恢复时应通过 imageKey 走 /api/canvas/image 代理路径获取签名 URL
      const cleanElements = currentState.elements.map((el: CanvasElement) => {
        // #Bug2-fix: 云端快照剥离 imageUrl/providerUrl，只保留 imageKey
        // 原因：providerUrl 是外部短期 URL（几小时过期），存储到云端后再加载会导致图片丢失
        // 恢复时应通过 imageKey 走 /api/canvas/image 代理路径获取签名 URL
        if (el.type === 'image' && 'imageKey' in el && (el as unknown as Record<string, unknown>).imageKey) {
          const clean = { ...el } as unknown as Record<string, unknown>;
          delete clean.imageUrl;
          delete clean.providerUrl;
          return clean as unknown as CanvasElement;
        }
        // #871 修复：扑克牌/生成面板的 imageUrls 数组也必须剥离！
        // 根因：imageUrls 中可能包含过期的服务商 URL（https:// 开头但几小时后失效），
        // 云端加载时 isValidImageUrl 认为它们有效，导致恢复逻辑跳过 → 刷新后图片丢失
        if ((el.type === 'image-stack' || el.type === 'generate-panel') && (el as any).imageKeys && (el as any).imageKeys.length > 0) {
          const clean = { ...el } as any;
          delete clean.imageUrls;
          delete clean.providerUrls;
          return clean as unknown as CanvasElement;
        }
        return el;
      });
      return {
        elements: cleanElements,
        zoom: currentState.zoom,
        panX: currentState.panX,
        panY: currentState.panY,
      };
    },
    applyServerData: silentUpdateImageKeys,
    debounceMs: 5000,
    // #887 弊端1终极加固：CAS 冲突时弹窗让用户决定，绝不静默覆盖
    onCasConflict: (conflictData) => {
      console.warn('[CanvasContext] CAS冲突，等待用户决定是否加载云端数据');
      setCasConflictData(conflictData);
    },
  });

  // #887 弊端1终极加固：CAS 冲突解决处理器
  const resolveCasConflict = useCallback((acceptCloud: boolean) => {
    if (!casConflictData) return;

    if (acceptCloud) {
      console.log('[CanvasContext] 用户选择接受云端数据，覆盖本地画布');
      // 用户确认：用云端数据覆盖本地
      try {
        const parsed = typeof casConflictData.canvas_data === 'string'
          ? JSON.parse(casConflictData.canvas_data)
          : casConflictData.canvas_data;
        if (parsed.elements && Array.isArray(parsed.elements)) {
          const sanitized = sanitizeElements(parsed.elements);
          dispatch({ type: 'LOAD_STATE', payload: {
            elements: sanitized,
            zoom: parsed.zoom ?? stateRef.current.zoom,
            panX: parsed.panX ?? stateRef.current.panX,
            panY: parsed.panY ?? stateRef.current.panY,
          }});
        }
      } catch (e) {
        console.error('[CanvasContext] 加载CAS冲突云端数据失败:', e);
      }
    } else {
      console.log('[CanvasContext] 用户选择保持本地数据，放弃云端版本');
      // 用户取消：保持本地状态，更新 CAS 时间戳避免下次仍冲突
      // 不做任何画布数据变更
    }
    // 关闭弹窗
    setCasConflictData(null);
  }, [casConflictData, dispatch]);
  
  // 云画布初始化加载：登录后从云端拉取，覆盖 localStorage 数据
  const cloudLoadedRef = useRef(false);
  useEffect(() => {
    // #889 修复：未登录时不尝试云端加载，避免无效请求
    if (!realIsLoggedIn || !realUserId) return;
    if (cloudLoadedRef.current) return;
    // #889 修复：先标记为 true 防止重复触发，但失败时回退
    cloudLoadedRef.current = true;
    
    console.log('[AutoSave] 用户已登录，从云端加载画布数据，userId:', realUserId);
    setIsCloudSyncing(true); // #887 弊端4：标记云端同步中
    
    // #891 修复：登录后从云端加载时，保留未登录时的草稿（PLG模式）
    // 先快照当前画布上的未登录草稿元素，云端加载后合并
    const draftElements = stateRef.current.elements.filter(
      (el: CanvasElement) => el.type !== undefined && el.type !== null
    );
    const draftZoom = stateRef.current.zoom;
    const draftPanX = stateRef.current.panX;
    const draftPanY = stateRef.current.panY;
    const hasDraft = draftElements.length > 0;
    if (hasDraft) {
      console.log('[AutoSave] 检测到未登录草稿', draftElements.length, '个元素，登录后将合并');
    }
    
    loadFromCloud().then(cloudData => {
      if (!cloudData) {
        console.log('[AutoSave] 云端无画布数据');
        if (hasDraft) {
          // 云端无数据，草稿直接保留在画布上，并上传到云端
          console.log('[AutoSave] 保留未登录草稿', draftElements.length, '个元素，并上传到云端');
          onCanvasChanged();
        } else {
          // #889 修复：云端无数据时，如果 localStorage 有数据，主动上传到云端
          // 这确保换设备登录后，本地资产能同步到云端
          const currentElements = stateRef.current.elements;
          if (currentElements.length > 0) {
            console.log('[AutoSave] localStorage 有', currentElements.length, '个元素，主动上传到云端');
            onCanvasChanged();
          }
        }
        return;
      }
      console.log('[AutoSave] 云端画布数据加载成功，元素数:', cloudData.elements?.length || 0);
      
      // 用云端数据替换当前状态
      try {
        const parsed = typeof cloudData === 'string' ? JSON.parse(cloudData) : cloudData;
        if (parsed.elements && Array.isArray(parsed.elements)) {
          // #861 修复：清洗云端数据中的无效 imageUrl（blob:/裸 UUID），防止 ERR_FILE_NOT_FOUND
          let sanitizedCloudElements = sanitizeElements(parsed.elements);
          // #Bug2 修复：云端数据中的 image 元素可能携带已过期的 providerUrl 作为 imageUrl
          // isValidImageUrl 会认为 https:// 开头的 URL 有效，导致恢复逻辑不介入
          // 对拥有 imageKey 的 image 元素，强制剥离 imageUrl/providerUrl，让恢复逻辑走 imageKey 代理路径
          sanitizedCloudElements = sanitizedCloudElements.map((el: CanvasElement) => {
            // 单图元素：剥离 imageUrl/providerUrl，保留 imageKey
            if (el.type === 'image' && (el as any).imageKey) {
              const { imageUrl, providerUrl, ...cleanRest } = el as any;
              if (imageUrl || providerUrl) {
                return cleanRest;
              }
              return el;
            }
            // #871 修复：扑克牌/生成面板也必须剥离！
            // 根因：云端数据中 imageUrls 可能包含过期的服务商 URL，
            // isValidImageUrl 误判为有效 → 恢复逻辑跳过 → 刷新后图片丢失
            if ((el.type === 'image-stack' || el.type === 'generate-panel') && (el as any).imageKeys && (el as any).imageKeys.length > 0) {
              const { imageUrls, providerUrls, ...cleanRest } = el as any;
              if (imageUrls || providerUrls) {
                return cleanRest;
              }
              return el;
            }
            return el;
          });
          console.log('[AutoSave] 云端数据清洗完成，原始:', parsed.elements.length, '清洗后:', sanitizedCloudElements.length);
          
          // #891 修复：合并云端数据与未登录草稿
          // 策略：云端数据为基础 + 草稿元素追加到右侧偏移位置
          let finalElements = sanitizedCloudElements;
          if (hasDraft) {
            // 计算云端元素的最右边界
            const cloudMaxRight = sanitizedCloudElements.reduce((max: number, el: CanvasElement) => {
              const elRight = (el.x || 0) + (el.width || 200);
              return Math.max(max, elRight);
            }, 0);
            const offsetX = cloudMaxRight > 0 ? cloudMaxRight + 200 : 0; // 200px 间距
            
            // 偏移草稿元素位置，避免与云端元素重叠
            const offsetDraftElements = draftElements.map((el: CanvasElement) => ({
              ...el,
              x: (el.x || 0) + offsetX,
              y: el.y || 0,
            }));
            
            finalElements = [...sanitizedCloudElements, ...offsetDraftElements];
            console.log('[AutoSave] 合并云端', sanitizedCloudElements.length, '个 + 草稿', draftElements.length, '个 = 最终', finalElements.length, '个元素');
          }
          
          // 批量更新：先清空再加载
          dispatch({ type: 'LOAD_STATE', payload: {
            elements: finalElements,
            zoom: parsed.zoom ?? (hasDraft ? draftZoom : state.zoom),
            panX: parsed.panX ?? (hasDraft ? draftPanX : state.panX),
            panY: parsed.panY ?? (hasDraft ? draftPanY : state.panY),
          }});
          
          // 合并后触发一次云端保存，将草稿持久化
          if (hasDraft) {
            setTimeout(() => onCanvasChanged(), 1000);
          }
        }
      } catch (e) {
        console.error('[AutoSave] 云端数据解析失败:', e);
      }
    }).catch(err => {
      console.warn('[AutoSave] 云端加载失败，使用 localStorage 缓存:', err.message);
      // #889 修复：加载失败时回退 ref，允许下次重试
      cloudLoadedRef.current = false;
    }).finally(() => {
      setIsCloudSyncing(false); // #887 弊端4：云端同步完成
    });
  }, [realIsLoggedIn, realUserId, loadFromCloud, onCanvasChanged]); // #889 修复：监听登录状态变化，登录后自动加载云端数据
  
  useEffect(() => {
    // #385 修复：检查是否有图片元素或 image-stack 元素需要恢复
    // #861 修复：使用 isValidImageUrl 替代 !el.imageUrl，捕获 blob:/裸 UUID 等失效链接
    const imageElements = state.elements.filter(
      (el: CanvasElement) => el.type === 'image' && !isValidImageUrl(el.imageUrl) && (el.imageKey || (el as any).dbId)
    );
    
    // #385 新增：也检查 image-stack 类型
    // #861 修复：同时检查 imageUrls 中是否有失效链接
    const imageStackElements = state.elements.filter(
      (el: CanvasElement) => el.type === 'image-stack' && 
        (!(el as any).imageUrls || (el as any).imageUrls.length === 0 || (el as any).imageUrls.some((u: string) => !isValidImageUrl(u))) && 
        (el as any).imageKeys && (el as any).imageKeys.length > 0
    );
    
    // #398 新增：也检查 generate-panel 类型
    // #861 修复：同时检查 imageUrls 中是否有失效链接
    const generatePanelElements = state.elements.filter(
      (el: CanvasElement) => el.type === 'generate-panel' && 
        (!(el as any).imageUrls || (el as any).imageUrls.length === 0 || (el as any).imageUrls.some((u: string) => !isValidImageUrl(u))) && 
        (el as any).imageKeys && (el as any).imageKeys.length > 0
    );
    
    // #619 终极修复：统一视频恢复过滤网
    // 同时捕获 type:'video' 和 type:'image'+sourceType:'video'，兼容两种数据格式
    // 条件：无有效 videoUrl（或 videoUrl 为空/失效） + 有 videoKey 可恢复
    // #861 修复：videoUrl 为 blob:/裸 UUID 也视为失效，需恢复
    const allVideoElements = state.elements.filter((el: CanvasElement) => {
      const isTypeVideo = el.type === 'video';
      const isSourceTypeVideo = el.type === 'image' && (el as any).sourceType === 'video';
      if (!isTypeVideo && !isSourceTypeVideo) return false;
      
      const videoKey = (el as any).videoKey;
      const videoUrl = (el as any).videoUrl;
      // 有 videoKey 才能恢复（通过代理 URL）
      // videoUrl 缺失、为空、或为失效链接时才需要恢复
      return videoKey && (!videoUrl || videoUrl === '' || (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://') && !videoUrl.startsWith('/api/') && !videoUrl.startsWith('blob:')));
    });
    
    // #619 兜底：videoKey 缺失但 generationStatus='recovering' 的视频元素
    // （COS 上传失败，blob URL 被剥离后触发代理兜底）
    const recoveringVideoElements = state.elements.filter((el: CanvasElement) => {
      const isTypeVideo = el.type === 'video';
      const isSourceTypeVideo = el.type === 'image' && (el as any).sourceType === 'video';
      if (!isTypeVideo && !isSourceTypeVideo) return false;
      
      const videoKey = (el as any).videoKey;
      const videoUrl = (el as any).videoUrl;
      const status = (el as any).generationStatus;
      // 无 videoKey，无 videoUrl，但标记为 recovering → 尝试用 imageUrl 代理恢复
      return !videoKey && (!videoUrl || videoUrl === '') && status === 'recovering';
    });
    
    if (imageElements.length === 0 && imageStackElements.length === 0 && generatePanelElements.length === 0 && allVideoElements.length === 0 && recoveringVideoElements.length === 0) {
      return;
    }
    
    setIsRestoring(true);
    
    // 异步恢复图片
    const fetchImageUrls = async () => {
      try {
        // ====== #412 修复：上传图片也能从 COS 恢复（IndexedDB 失败时的备用方案）======
        const cosElements = imageElements.filter(el => el.imageKey);
        const localElements = imageElements.filter(el => 
          (el as any).dbId || el.sourceType === 'upload'
        );
        
        // ====== 处理本地图片：从 IndexedDB 恢复 ======
        // #412 修复：记录 IndexedDB 恢复失败的元素，后续从 COS 恢复
        const localRestoreFailed: typeof imageElements = [];
        
        if (localElements.length > 0) {
          const { getImage } = await import('@/lib/canvas-image-db');
          
          for (const el of localElements) {
            const dbId = (el as any).dbId;
            
            if (dbId) {
              try {
                const localUrl = await getImage(dbId);
                
                if (localUrl) {
                  dispatch({
                    type: 'UPDATE_ELEMENT',
                    payload: { id: el.id, updates: { imageUrl: localUrl } }
                  });
                } else {
                  // #412 IndexedDB 没有缓存，后续从 COS 恢复
                  if (el.imageKey) {
                    localRestoreFailed.push(el);
                  } else {
                    dispatch({
                      type: 'UPDATE_ELEMENT',
                      payload: { id: el.id, updates: { 
                        generationStatus: 'expired',
                        generationError: '本地图片已丢失'
                      } }
                    });
                  }
                }
              } catch (idxError) {
                console.error('[Canvas] IndexedDB 恢复失败:', dbId, idxError);
                // #412 IndexedDB 恢复失败，如果有 imageKey，后续从 COS 恢复
                if (el.imageKey) {
                  localRestoreFailed.push(el);
                }
              }
            } else if (el.imageKey) {
              // #412 没有 dbId 但有 imageKey，从 COS 恢复
              localRestoreFailed.push(el);
            }
          }
        }
        
        // ====== #150 恢复 COS 图片：IndexedDB 缓存优先 ======
        // #412 合并：原有的 cosElements + IndexedDB 恢复失败的上传图片
        const allCosElements = [...cosElements, ...localRestoreFailed];
        
        if (allCosElements.length > 0) {
          const { loadImageFromCache, storeImageByKey } = await import('@/lib/canvas-image-db');
          
          // 1. 先尝试从 IndexedDB 缓存加载（并行）
          const cacheResults = await Promise.all(
            allCosElements.map(async (el) => {
              const imageKey = el.imageKey!;
              const cachedUrl = await loadImageFromCache(imageKey);
              return { el, imageKey, cachedUrl };
            })
          );
          
          // 2. 分类：缓存命中 vs 未命中
          const cached = cacheResults.filter(r => r.cachedUrl);
          const missed = cacheResults.filter(r => !r.cachedUrl);
          
          // 3. 缓存命中的直接渲染
          for (const { el, cachedUrl } of cached) {
            dispatch({
              type: 'UPDATE_ELEMENT',
              payload: { id: el.id, updates: { 
                imageUrl: cachedUrl || undefined,
                generationStatus: 'completed'
              } }
            });
          }
          
          // 4. 缓存未命中的，使用后端代理 URL 恢复图片
          // #524 修复：浏览器直连 COS 超时，改用后端代理（后端→COS 可靠）
          // 🛡️ #816 移除 self-healing 额外 fetch：避免每张图双重 COS 读取
          // 根因：img 标签走 302 重定向 = 1次 COS 读取 + fetch(proxyUrl) 下载 blob = 又 1次 COS 读取
          // 现在：img 标签走 302 重定向就够了，代理端点已带 max-age=300 缓存头
          // IndexedDB 缓存改为：在 img.onload 时从 canvas 截取或靠下次刷新时自然缓存
          if (missed.length > 0) {
            for (const { el, imageKey } of missed) {
              // #524 使用后端代理 URL（/api/canvas/image?key=xxx）
              // 优势：浏览器→后端（同源可靠），后端→COS（服务端可靠）
              const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(imageKey)}`;
              
              // 直接设置代理 URL，让浏览器通过后端加载图片（302 重定向，只走 1 次 COS）
              dispatch({
                type: 'UPDATE_ELEMENT',
                payload: { id: el.id, updates: { 
                  imageUrl: proxyUrl,
                  generationStatus: 'completed'
                } }
              });
            }
          }
        }
        
        // ====== #385 新增：恢复 image-stack 类型 ======
        if (imageStackElements.length > 0) {
          for (const el of imageStackElements) {
            const rawImageKeys = (el as any).imageKeys || [];
            // #523 修复：过滤掉 null/空字符串的 key
            const imageKeys = rawImageKeys.filter((k: string | null) => k !== null && k !== '');
            if (imageKeys.length === 0) continue;
            
            // #524 修复：使用代理 URL 替代签名 URL（浏览器直连 COS 超时）
            const proxyUrls = imageKeys.map((key: string) => `/api/canvas/image?key=${encodeURIComponent(key)}`);
            
            dispatch({
              type: 'UPDATE_ELEMENT',
              payload: { 
                id: el.id, 
                updates: { 
                  imageUrls: proxyUrls,
                  activeIndex: 0
                } 
              }
            });
          }
        }
        
        // ====== #398 新增：恢复 generate-panel 类型 ======
        if (generatePanelElements.length > 0) {
          for (const el of generatePanelElements) {
            const rawImageKeys = (el as any).imageKeys || [];
            // #523 修复：过滤掉 null/空字符串的 key，只保留有效的 COS key
            const imageKeys = rawImageKeys.filter((k: string | null) => k !== null && k !== '');
            if (imageKeys.length === 0) {
              console.warn('[Canvas] #523 generate-panel 无有效 imageKeys，跳过恢复:', el.id);
              continue;
            }
            
            // #524 修复：使用代理 URL 替代签名 URL（浏览器直连 COS 超时）
            const proxyUrls = imageKeys.map((key: string) => `/api/canvas/image?key=${encodeURIComponent(key)}`);
            
            updateElement(el.id, {
              imageUrls: proxyUrls,
              generationStatus: 'completed',
            } as any);
          }
        }
        
        // ====== #619 终极修复：统一视频恢复逻辑 ======
        // 合并所有视频元素（有 videoKey + recovering 兜底）
        const allVideoToRestore = [...allVideoElements, ...recoveringVideoElements];
        
        if (allVideoToRestore.length > 0) {
          for (const el of allVideoToRestore) {
            const videoKey = (el as any).videoKey;
            const isTypeVideo = el.type === 'video';
            const isSourceTypeVideo = el.type === 'image' && (el as any).sourceType === 'video';
            
            if (videoKey) {
              // #625 排雷：检测 videoKey 是否包含 blob URL
              // 如果包含，说明是脏数据，无法恢复，直接标记失败
              if (videoKey.startsWith('blob:') || videoKey.startsWith('proxy:blob:')) {
                console.error('[Canvas] #625 videoKey 包含 blob URL，无法恢复:', el.id, 'videoKey:', videoKey.substring(0, 50));
                updateElement(el.id, {
                  isLoading: false,  // #625 清除上传中状态
                  generationStatus: 'failed',
                  generationError: '视频数据丢失（blob URL 无法持久化）',
                } as any);
                continue;  // 跳过此元素
              }
              
              // #618 智能路由：根据 Key 类型分配正确的代理端点
              let proxyUrl: string;
              if (videoKey.startsWith('proxy:')) {
                // 降级路径：剥离 'proxy:' 前缀，走专用视频流代理端点
                const originUrl = videoKey.substring(6);
                proxyUrl = `/api/video/proxy?url=${encodeURIComponent(originUrl)}`;
              } else {
                // 正常 COS 路径：走画布图片代理端点
                proxyUrl = `/api/canvas/image?key=${encodeURIComponent(videoKey)}`;
              }
              
              const updates: any = { videoUrl: proxyUrl, generationStatus: 'completed' };
              // sourceType='video' 的 image 元素还需要更新 imageUrl（缩略图展示）
              if (isSourceTypeVideo) {
                updates.imageUrl = proxyUrl;
              }
              updateElement(el.id, updates);
            } else {
              // #619 兜底：无 videoKey，尝试用 imageKey 代理恢复
              const imageKey = el.imageKey;
              if (imageKey) {
                const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(imageKey)}`;
                const updates: any = { videoUrl: proxyUrl, imageUrl: proxyUrl, generationStatus: 'completed' };
                updateElement(el.id, updates);
              } else {
                updateElement(el.id, {
                  isLoading: false,
                  generationStatus: 'failed',
                  generationError: '视频数据丢失，无法恢复',
                } as any);
              }
            }
          }
        }
        
        // ====== 恢复完成后释放锁定 ======
        // 🔧 P1.7 修复：保存 timer ID 以便清理
        restoreTimerRef.current = setTimeout(() => {
          setIsRestoring(false);
        }, 100);
        
      } catch (error) {
        console.error('[Canvas] 恢复图片失败:', error);
        setIsRestoring(false);
      }
    };
    
    fetchImageUrls();
    
    // 🔧 P1.7 修复：组件卸载时清理 timer
    return () => {
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
    };
  }, []);

  // #040 性能优化：分离保存逻辑，减少不必要的 useEffect 触发
  // 1. 元素变化时保存（较少发生）
  useEffect(() => {
    // #863 Defense 1: 草稿恢复完成前绝对禁止保存，防止空画布覆盖 localStorage
    if (!isInitialized || isRestoring) return;
    
    // #626 修复：移除 isRecovering 阻断保存的逻辑
    // 之前 recovering 元素会阻止全部保存，导致上传成功的 videoKey 无法持久化
    // recovering 状态本身也需要保存到 localStorage，否则刷新后无法恢复
    
    // 检查是否是初始状态
    const hasViewportChange = state.zoom !== 100 || state.panX !== 0 || state.panY !== 0;
    const isInitialState = state.elements.length === 0 && !hasViewportChange;
    if (isInitialState) return;
    
    const timer = setTimeout(() => {
      saveStateToStorage(state, isRestoring);
    }, 1000);
    // 云画布自动保存：与 localStorage 并行
    onCanvasChanged();
    return () => clearTimeout(timer);
  }, [state.elements, state.annotations, isRestoring, onCanvasChanged, isInitialized]);
  
  // #041 性能优化：删除 zoom/pan 的保存 useEffect
  // 现在 zoom/pan 只在页面卸载时保存（通过 page.tsx 的 beforeunload 事件）
  // 这样可以彻底避免移动过程中的高频保存

  // #079 修复：监听占位符的 generationTaskId 变化，立即保存
  // 这确保刷新后能正确恢复占位符状态
  // #095 修复：使用 join(',') 将动态数组转为单一字符串，避免 React 报错
  const generatingTaskIds = state.elements
    .filter((el: CanvasElement) => el.generationStatus === 'generating' && el.generationTaskId)
    .map((el: CanvasElement) => el.generationTaskId)
    .join(',');
  
  useEffect(() => {
    // #863 Defense 1: 草稿恢复完成前绝对禁止保存
    if (!isInitialized || isRestoring) return;
    const placeholdersWithTaskId = state.elements.filter(
      (el: CanvasElement) => el.generationStatus === 'generating' && el.generationTaskId
    );
    
    if (placeholdersWithTaskId.length > 0) {
      saveStateToStorage(state, false);
    }
  }, [generatingTaskIds, isRestoring, isInitialized]);

  // 保存历史
  const saveHistory = useCallback(() => {
    const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    newHistory.push({ elements: [...state.elements], selectedIds: [...state.selectedIds] });
    historyRef.current = newHistory;
    historyIndexRef.current = newHistory.length - 1;
  }, [state.elements, state.selectedIds]);

  // 添加元素
  // #585 修复：移除 startTransition（它使更新可中断，反而导致 insertBefore 错误）
  // 追加到数组末尾不需要 insertBefore，使用普通 dispatch 即可
  const addElement = useCallback((element: Omit<CanvasElement, 'id'>): string => {
    const id = generateId();
    const newElement = { ...element, id };
    dispatch({ type: 'ADD_ELEMENT', payload: newElement });
    saveHistory();
    return id;
  }, [saveHistory]);

  // 更新元素
  const updateElement = useCallback((id: string, updates: Partial<CanvasElement>) => {
    dispatch({ type: 'UPDATE_ELEMENT', payload: { id, updates } });
  }, []);

  // #299 新增：批量更新元素（用于选中框缩放，避免循环调用 updateElement 导致性能问题）
  // #585 修复：移除 startTransition。属性更新不改变数组结构，安全
  const updateElementsBatch = useCallback(
    (updates: Array<{ id: string; updates: Partial<CanvasElement> }>) => {
      dispatch({ type: 'UPDATE_ELEMENTS_BATCH', payload: updates });
    },
    []
  );

  // 删除单个元素
  // #289 修复：删除后立即保存，防止刷新后恢复
  // #438 修复：删除元素时释放 blob URL，防止内存泄漏
  const deleteElement = useCallback((id: string) => {
    // 释放 blob URL
    const element = stateRef.current.elements.find(el => el.id === id);
    if (element?.imageUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(element.imageUrl);
    }
    // #586 修复：用 flushSync 包裹删除操作，确保 DOM 同步更新，防止并发渲染 insertBefore 崩溃
    flushSync(() => {
      dispatch({ type: 'DELETE_ELEMENTS', payload: [id] });
    });
    saveHistory();
    // 立即保存到 localStorage
    saveStateToStorage(stateRef.current, false);
  }, [saveHistory]);

  // 删除选中元素
  // #289 修复：删除后立即保存，防止刷新后恢复
  // #438 修复：删除元素时释放 blob URL，防止内存泄漏
  const deleteSelected = useCallback(() => {
    if (state.selectedIds.length > 0) {
      // 释放所有选中元素的 blob URL
      state.selectedIds.forEach(id => {
        const element = stateRef.current.elements.find(el => el.id === id);
        if (element?.imageUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(element.imageUrl);
        }
      });
      // #586 修复：用 flushSync 包裹删除操作，确保 DOM 同步更新，防止并发渲染 insertBefore 崩溃
      flushSync(() => {
        dispatch({ type: 'DELETE_ELEMENTS', payload: state.selectedIds });
      });
      saveHistory();
      // 立即保存到 localStorage
      saveStateToStorage(stateRef.current, false);
    }
  }, [state.selectedIds, saveHistory]);

  // 复制选中元素
  const duplicateSelected = useCallback(() => {
    // #585 修复：收集所有新元素后一次性 dispatch，使用 ADD_ELEMENTS_BATCH
    const newElements: CanvasElement[] = [];
    state.selectedIds.forEach(id => {
      const element = state.elements.find(el => el.id === id);
      if (element) {
        const newElement: CanvasElement = {
          ...element,
          id: generateId(),
          x: element.x + 20,
          y: element.y + 20,
          name: `${element.name} Copy`,
        };
        newElements.push(newElement);
      }
    });
    if (newElements.length > 0) {
      // #586 修复：用 flushSync 包裹添加操作，防止并发渲染 insertBefore 崩溃
      flushSync(() => {
        dispatch({ type: 'ADD_ELEMENTS', payload: newElements });
      });
    }
    saveHistory();
  }, [state.selectedIds, state.elements, saveHistory]);

  // 选择元素
  // #608 不再需要 flushSync！BRING_TO_FRONT_AND_SELECT 只改 zIndex，不重排数组
  // 没有数组重排 = 没有 DOM 移动 = 不需要强制同步渲染
  const selectElement = useCallback((id: string, multi = false) => {
    if (multi) {
      // 多选模式：切换选中状态（多选时不自动置顶，避免频繁重排）
      const isSelected = state.selectedIds.includes(id);
      dispatch({
        type: 'SELECT_ELEMENTS',
        payload: isSelected
          ? state.selectedIds.filter(sid => sid !== id)
          : [...state.selectedIds, id],
      });
    } else {
      // 单选模式：只改 zIndex，不需要 flushSync
      dispatch({ type: 'BRING_TO_FRONT_AND_SELECT', payload: id });
    }
  }, [state.selectedIds]);

  // 批量选择多个元素（替换当前选择）
  // #585 修复：移除 startTransition。选择不涉及数组重排，安全
  const selectElements = useCallback((ids: string[]) => {
    dispatch({ type: 'SELECT_ELEMENTS', payload: ids });
  }, []);

  // 全选
  const selectAll = useCallback(() => {
    dispatch({ type: 'SELECT_ELEMENTS', payload: state.elements.map(el => el.id) });
  }, [state.elements]);

  // 清除选择
  const clearSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' });
  }, []);

  // 设置工具
  const setTool = useCallback((tool: ToolType) => {
    dispatch({ type: 'SET_TOOL', payload: tool });
  }, []);

  // 设置缩放
  const setZoom = useCallback((zoom: number) => {
    dispatch({ type: 'SET_ZOOM', payload: zoom });
  }, []);

  // 设置平移
  const setPan = useCallback((x: number, y: number) => {
    dispatch({ type: 'SET_PAN', payload: { x, y } });
  }, []);

  // 切换网格
  const toggleGrid = useCallback(() => {
    dispatch({ type: 'TOGGLE_GRID' });
  }, []);

  // 切换预览
  const togglePreview = useCallback(() => {
    dispatch({ type: 'TOGGLE_PREVIEW' });
  }, []);

  // #585 修复：图层操作改变元素数组顺序，使用 flushSync 确保同步渲染
  // 这样 React 不会在数组重排过程中中断，避免 insertBefore 错误
  // 上移图层
  const bringForward = useCallback((id: string) => {
    flushSync(() => {
      dispatch({ type: 'BRING_FORWARD', payload: id });
    });
  }, []);

  // 下移图层
  const sendBackward = useCallback((id: string) => {
    flushSync(() => {
      dispatch({ type: 'SEND_BACKWARD', payload: id });
    });
  }, []);

  // 置顶图层
  const bringToFront = useCallback((id: string) => {
    flushSync(() => {
      dispatch({ type: 'BRING_TO_FRONT', payload: id });
    });
  }, []);

  // 置底图层
  const sendToBack = useCallback((id: string) => {
    flushSync(() => {
      dispatch({ type: 'SEND_TO_BACK', payload: id });
    });
  }, []);

  // 对齐功能
  // #585 修复：使用 updateElementsBatch 替代循环 dispatch，避免多次渲染
  const alignLeft = useCallback(() => {
    if (state.selectedIds.length < 2) return;
    const minX = Math.min(...state.selectedIds.map(id => {
      const el = state.elements.find(e => e.id === id);
      return el ? el.x : Infinity;
    }));
    dispatch({ type: 'UPDATE_ELEMENTS_BATCH', payload: state.selectedIds.map(id => ({ id, updates: { x: minX } })) });
  }, [state.selectedIds, state.elements]);

  const alignCenter = useCallback(() => {
    if (state.selectedIds.length < 2) return;
    const elements = state.selectedIds.map(id => state.elements.find(e => e.id === id)).filter(Boolean) as CanvasElement[];
    const center = (Math.min(...elements.map(el => el.x)) + Math.max(...elements.map(el => el.x + el.width))) / 2;
    dispatch({ type: 'UPDATE_ELEMENTS_BATCH', payload: elements.map(el => ({ id: el.id, updates: { x: center - el.width / 2 } })) });
  }, [state.selectedIds, state.elements]);

  const alignRight = useCallback(() => {
    if (state.selectedIds.length < 2) return;
    const maxX = Math.max(...state.selectedIds.map(id => {
      const el = state.elements.find(e => e.id === id);
      return el ? el.x + el.width : -Infinity;
    }));
    dispatch({
      type: 'UPDATE_ELEMENTS_BATCH',
      payload: state.selectedIds.map(id => {
        const el = state.elements.find(e => e.id === id);
        return { id, updates: { x: el ? maxX - el.width : 0 } };
      }),
    });
  }, [state.selectedIds, state.elements]);

  const alignTop = useCallback(() => {
    if (state.selectedIds.length < 2) return;
    const minY = Math.min(...state.selectedIds.map(id => {
      const el = state.elements.find(e => e.id === id);
      return el ? el.y : Infinity;
    }));
    dispatch({ type: 'UPDATE_ELEMENTS_BATCH', payload: state.selectedIds.map(id => ({ id, updates: { y: minY } })) });
  }, [state.selectedIds, state.elements]);

  const alignMiddle = useCallback(() => {
    if (state.selectedIds.length < 2) return;
    const elements = state.selectedIds.map(id => state.elements.find(e => e.id === id)).filter(Boolean) as CanvasElement[];
    const middle = (Math.min(...elements.map(el => el.y)) + Math.max(...elements.map(el => el.y + el.height))) / 2;
    dispatch({ type: 'UPDATE_ELEMENTS_BATCH', payload: elements.map(el => ({ id: el.id, updates: { y: middle - el.height / 2 } })) });
  }, [state.selectedIds, state.elements]);

  const alignBottom = useCallback(() => {
    if (state.selectedIds.length < 2) return;
    const maxY = Math.max(...state.selectedIds.map(id => {
      const el = state.elements.find(e => e.id === id);
      return el ? el.y + el.height : -Infinity;
    }));
    dispatch({
      type: 'UPDATE_ELEMENTS_BATCH',
      payload: state.selectedIds.map(id => {
        const el = state.elements.find(e => e.id === id);
        return { id, updates: { y: el ? maxY - el.height : 0 } };
      }),
    });
  }, [state.selectedIds, state.elements]);

  // 撤销
  // #585 修复：撤销恢复历史，使用 flushSync 保证同步渲染
  // 恢复历史可能完全改变元素数组顺序，必须同步完成
  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      const historyState = historyRef.current[historyIndexRef.current];
      flushSync(() => {
        dispatch({
          type: 'RESTORE_HISTORY',
          payload: { elements: historyState.elements, selectedIds: historyState.selectedIds },
        });
      });
    }
  }, []);

  // 【强制保存】绕过防抖，立即同步写入 localStorage
  // 用于关键时刻（如收到 actualTaskId）确保数据不丢失
  // #079 修复：使用 stateRef.current 获取最新状态，解决闭包问题
  const forceSaveToStorage = useCallback(() => {
    const currentState = stateRef.current;
    // 输出正在保存的占位符元素
    const generatingEls = currentState.elements.filter((el: any) => el.generationStatus === 'generating');
    saveStateToStorage(currentState, false);
  }, []);

  // 重做
  // #585 修复：使用 flushSync 保证同步渲染
  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++;
      const historyState = historyRef.current[historyIndexRef.current];
      flushSync(() => {
        dispatch({
          type: 'RESTORE_HISTORY',
          payload: { elements: historyState.elements, selectedIds: historyState.selectedIds },
        });
      });
    }
  }, []);

  // 导出图片
  const exportAsImage = useCallback(async () => {
    const canvasEl = document.createElement('canvas');
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    // 计算画布边界
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.elements.forEach(el => {
      if (el.visible) {
        minX = Math.min(minX, el.x);
        minY = Math.min(minY, el.y);
        maxX = Math.max(maxX, el.x + el.width);
        maxY = Math.max(maxY, el.y + el.height);
      }
    });

    const padding = 50;
    const width = Math.max(maxX - minX + padding * 2, 800);
    const height = Math.max(maxY - minY + padding * 2, 600);
    
    canvasEl.width = width;
    canvasEl.height = height;

    // 绘制背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 绘制元素
    for (const el of state.elements) {
      if (!el.visible) continue;
      ctx.save();
      ctx.globalAlpha = el.opacity;

      const drawX = el.x - minX + padding;
      const drawY = el.y - minY + padding;

      switch (el.type) {
        case 'rectangle':
          ctx.fillStyle = el.fill;
          ctx.fillRect(drawX, drawY, el.width, el.height);
          if (el.strokeWidth > 0) {
            ctx.strokeStyle = el.stroke;
            ctx.lineWidth = el.strokeWidth;
            ctx.strokeRect(drawX, drawY, el.width, el.height);
          }
          break;
        case 'circle':
          ctx.fillStyle = el.fill;
          ctx.beginPath();
          ctx.ellipse(drawX + el.width / 2, drawY + el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          if (el.strokeWidth > 0) {
            ctx.strokeStyle = el.stroke;
            ctx.lineWidth = el.strokeWidth;
            ctx.stroke();
          }
          break;
        case 'image':
          if (el.imageUrl) {
            try {
              const img = new window.Image();
              img.src = el.imageUrl;
              await new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              });
              ctx.drawImage(img, drawX, drawY, el.width, el.height);
            } catch (err) {
              console.error('Failed to draw image:', err);
            }
          }
          break;
        case 'line':
          ctx.strokeStyle = el.stroke;
          ctx.lineWidth = el.strokeWidth || 2;
          ctx.beginPath();
          ctx.moveTo(drawX, drawY);
          ctx.lineTo(drawX + el.width, drawY + el.height);
          ctx.stroke();
          break;
      }
      ctx.restore();
    }

    // 下载
    const link = document.createElement('a');
    link.download = 'design.png';
    link.href = canvasEl.toDataURL('image/png');
    link.click();
  }, [state.elements]);

  // 导入图片 - 存储到 IndexedDB（浏览器本地存储）
  // viewportInfo: 可选的视图信息，用于计算居中位置
  const importImage = useCallback(async (
    file: File,
    position?: { x: number; y: number },
    viewportInfo?: {
      zoom: number;
      panX: number;
      panY: number;
      containerWidth: number;
      containerHeight: number;
    },
    // 可选：预设尺寸（如果传入，则直接使用，不重新计算）
    presetDimensions?: { width: number; height: number }
  ) => {
    // #387 修复：存储到 IndexedDB，面板连线时转 base64（避免 COS 被刷爆）
    // 1. 创建 blob URL 做本地预览（瞬间完成）
    const localPreviewUrl = URL.createObjectURL(file);
    
    // 返回一个 Promise，等待图片加载和处理完成
    return new Promise<void>((resolve) => {
      // 创建 Image 对象获取实际尺寸
      const img = new window.Image();
      img.onload = async () => {
        // 如果传入了预设尺寸，直接使用（保持原有布局逻辑）
        let width: number;
        let height: number;
        let aspectRatio: number;
        
        if (presetDimensions) {
          // 使用预设尺寸，不重新计算
          width = presetDimensions.width;
          height = presetDimensions.height;
          aspectRatio = width / height;
        } else {
          // 没有预设尺寸，使用原始图片尺寸并计算
          width = img.naturalWidth;
          height = img.naturalHeight;
          aspectRatio = width / height;
        }
        
        // 使用传入的位置，否则默认为 (100, 100)
        let posX = position?.x ?? 100;
        let posY = position?.y ?? 100;
        
        // 如果没有预设尺寸，执行原有的尺寸计算逻辑
        if (!presetDimensions) {
          // 检查画布中是否有图片元素
          // #386 修复：使用 stateRef.current 解决 React 闭包陷阱
          const hasExistingImages = stateRef.current.elements.some(el => el.type === 'image');
          
          // 画布尺寸（从常量动态计算，不再硬编码）
          // CANVAS_WIDTH 按典型 16:9 容器比例估算，实际有 viewportInfo 时不使用此值
          const CANVAS_WIDTH = CANVAS_HEIGHT_CONST * (16 / 9);  // 约 106667
          const CANVAS_HEIGHT = CANVAS_HEIGHT_CONST;             // 60000
          
          // 保存原始宽高用于位置调整
          const originalWidth = width;
          const originalHeight = height;
          
          if (!hasExistingImages && !position) {
            // 画布没有图片时：按照图片原始像素上传，不做缩放
            // 计算居中位置：图片居中在当前视图中心
            if (viewportInfo) {
              const viewCenterX = (viewportInfo.containerWidth / 2 - viewportInfo.panX) / viewportInfo.zoom;
              const viewCenterY = (viewportInfo.containerHeight / 2 - viewportInfo.panY) / viewportInfo.zoom;
              posX = viewCenterX - width / 2;
              posY = viewCenterY - height / 2;
            } else {
              posX = (CANVAS_WIDTH - width) / 2;
              posY = (CANVAS_HEIGHT - height) / 2;
            }
          } else if (hasExistingImages || position) {
            // 画布有图片时 或 指定了位置时：限制大小在可视区域的1/5到1/3之间
            // 计算可视区域大小（画布坐标）
            let minSize: number;
            let maxSize: number;
            
            if (viewportInfo) {
              const visibleWidth = viewportInfo.containerWidth / viewportInfo.zoom;
              const visibleHeight = viewportInfo.containerHeight / viewportInfo.zoom;
              const visibleMinSize = Math.min(visibleWidth, visibleHeight);
              minSize = visibleMinSize / 5; // 可视区域的 1/5
              maxSize = visibleMinSize / 3; // 可视区域的 1/3
            } else {
              // 没有视图信息时使用默认值
              minSize = 2000;
              maxSize = 3000;
            }
            
            // 计算当前图片的最小边
            const currentMinSize = Math.min(width, height);
            
            // 如果图片太小或太大，进行缩放
            if (currentMinSize < minSize || currentMinSize > maxSize) {
              const targetSize = Math.min(Math.max(currentMinSize, minSize), maxSize);
              const scale = targetSize / currentMinSize;
              width = Math.round(width * scale);
              height = Math.round(height * scale);
              
              // 调整位置：保持中心点不变
              if (position) {
                posX = position.x - (width - originalWidth) / 2;
                posY = position.y - (height - originalHeight) / 2;
              }
            }
          }
        }
        
        // #365 方案B：先添加元素，使用本地预览 URL（瞬间显示）
        const tempElementId = addElement({
          type: 'image',
          name: file.name,
          x: posX,
          y: posY,
          width: Math.round(width),
          height: Math.round(height),
          rotation: 0,
          fill: 'transparent',
          stroke: 'transparent',
          strokeWidth: 0,
          opacity: 1,
          visible: true,
          locked: false,
          imageUrl: localPreviewUrl,  // 先用 blob URL 预览
          aspectRatio,
          sourceType: 'upload',
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        });
        
        // #412 修复：IndexedDB + COS 双轨存储
        // 1. IndexedDB：用于本地快速预览和刷新恢复
        // 2. COS：用于面板发送生图时获取签名 URL
        
        // 存储到 IndexedDB（浏览器本地存储，快速预览）
        try {
          const dbId = await storeImage(file, file.type);
          
          // 更新元素：设置 dbId（用于刷新后恢复）
          const elementStillExists = stateRef.current.elements.some(e => e.id === tempElementId);
          if (elementStillExists) {
            dispatch({
              type: 'UPDATE_ELEMENT',
              payload: {
                id: tempElementId,
                updates: { dbId }
              }
            });
          }
          
          // #412 后台静默上传 COS（不阻塞 UI）
          const uploadPromise = fetch('/api/canvas/upload', {
            method: 'POST',
            body: (() => { const fd = new FormData(); fd.append('file', file); return fd; })(),
          })
            .then(res => safeJsonResponse<{ key?: string; url?: string }>(res))
            .then(uploadData => {
              if (uploadData.success) {
                // 检查元素是否仍然存在
                const elementExists = stateRef.current.elements.some(e => e.id === tempElementId);
                if (elementExists) {
                  // #M3 修复：COS上传成功后，同时替换imageUrl为代理URL，并释放blob内存
                  const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(uploadData.key ?? '')}`;
                  dispatch({
                    type: 'UPDATE_ELEMENT',
                    payload: {
                      id: tempElementId,
                      updates: { imageKey: uploadData.key ?? '', imageUrl: proxyUrl }
                    }
                  });
                  // 释放blob URL内存（imageUrl已替换为代理URL，不再需要blob）
                  try { URL.revokeObjectURL(localPreviewUrl); } catch {}
                }
              } else {
                console.error('[Canvas] COS 上传失败:', uploadData.error);
              }
            })
            .catch(err => {
              console.error('[Canvas] COS 上传异常:', err);
            })
            .finally(() => {
              // 上传完成后从追踪器中移除
              globalPendingUploads.delete(tempElementId);
            });
          
          // 注册到全局追踪器
          globalPendingUploads.set(tempElementId, uploadPromise);
            
        } catch (dbError) {
          console.error('[Canvas] IndexedDB 存储失败:', dbError);
          // 存储失败，图片会在刷新后丢失，但 blob URL 仍可用于当前会话
        }
        
        // 处理完成，resolve Promise
        resolve();
      };
      
      img.onerror = () => {
        console.error('[Canvas] 图片加载失败:', file.name);
        resolve(); // 即使失败也 resolve，避免阻塞
      };
      
      img.src = localPreviewUrl;
    });
  }, [addElement]);

  // 添加标注
  const addAnnotation = useCallback((annotation: Omit<CanvasAnnotation, 'id' | 'timestamp'>): string => {
    const id = generateId();
    const newAnnotation: CanvasAnnotation = {
      ...annotation,
      id,
      timestamp: Date.now(),
    };
    dispatch({ type: 'ADD_ANNOTATION', payload: newAnnotation });
    return id;
  }, []);

  // 更新标注
  const updateAnnotation = useCallback((id: string, updates: Partial<CanvasAnnotation>) => {
    dispatch({ type: 'UPDATE_ANNOTATION', payload: { id, updates } });
  }, []);

  // 删除标注
  const deleteAnnotation = useCallback((id: string) => {
    dispatch({ type: 'DELETE_ANNOTATION', payload: id });
  }, []);

  // 设置活动标注
  const setActiveAnnotation = useCallback((id: string | null) => {
    dispatch({ type: 'SET_ACTIVE_ANNOTATION', payload: id });
  }, []);

  // 添加图像生成器
  const addImageGenerator = useCallback(() => {
    addElement({
      type: 'imageGenerator',
      name: '图像生成器',
      x: 150,
      y: 80,
      width: 280,
      height: 400,
      rotation: 0,
      fill: '#E0F0FF',
      stroke: '#40A9FF',
      strokeWidth: 2,
      opacity: 1,
      visible: true,
      locked: false,
    });
  }, [addElement]);

  // 添加视频生成器
  const addVideoGenerator = useCallback(() => {
    addElement({
      type: 'videoGenerator',
      name: '视频生成器',
      x: 150,
      y: 80,
      width: 320,
      height: 290,
      rotation: 0,
      fill: '#E8FFF0',
      stroke: '#52C41A',
      strokeWidth: 2,
      opacity: 1,
      visible: true,
      locked: false,
    });
  }, [addElement]);

  const value = useMemo<CanvasContextType>(() => ({
    state,
    addElement,
    updateElement,
    updateElementsBatch,  // #299 新增
    deleteElement,
    deleteSelected,
    duplicateSelected,
    selectElement,
    selectElements,
    selectAll,
    clearSelection,
    setTool,
    setZoom,
    setPan,
    toggleGrid,
    togglePreview,
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    alignLeft,
    alignCenter,
    alignRight,
    alignTop,
    alignMiddle,
    alignBottom,
    undo,
    redo,
    canUndo: historyIndexRef.current > 0,
    canRedo: historyIndexRef.current < historyRef.current.length - 1,
    exportAsImage,
    importImage,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    setActiveAnnotation,
    addImageGenerator,
    addVideoGenerator,
    // #032 修复：暴露 isInitialized 和 isRestoring
    isInitialized,
    isRestoring,
    // #887 弊端4：云端同步中状态
    isCloudSyncing,
    // #887 弊端1终极加固：CAS 冲突弹窗
    casConflictData,
    resolveCasConflict,
    // 【强制保存】绕过防抖，立即同步写入
    forceSaveToStorage,
    // 🔧 #221 修复：暴露 stateRef，解决 React 闭包陷阱
    stateRef,
    // #299 暴露 saveHistory 方法
    saveHistory,
    // 🆕 云画布自动保存状态
    cloudSaveStatus,
    loadFromCloud,
    forceCloudSave,
  }), [
    state,
    addElement,
    updateElement,
    deleteElement,
    deleteSelected,
    duplicateSelected,
    selectElement,
    selectElements,
    selectAll,
    clearSelection,
    setTool,
    setZoom,
    setPan,
    toggleGrid,
    togglePreview,
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    alignLeft,
    alignCenter,
    alignRight,
    alignTop,
    alignMiddle,
    alignBottom,
    undo,
    redo,
    exportAsImage,
    importImage,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    setActiveAnnotation,
    addImageGenerator,
    addVideoGenerator,
    isInitialized,
    isRestoring,
    forceSaveToStorage,
    saveHistory,  // #299 暴露 saveHistory 方法
    cloudSaveStatus,
    loadFromCloud,
    forceCloudSave,
  ]);

  return (
    <CanvasContext.Provider value={value}>
      {children}
    </CanvasContext.Provider>
  );
}

export function useCanvas() {
  const context = useContext(CanvasContext);
  if (!context) {
    throw new Error('useCanvas must be used within a CanvasProvider');
  }
  return context;
}
