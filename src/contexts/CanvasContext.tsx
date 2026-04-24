'use client';

import React, { useReducer, useCallback, useRef, useMemo, createContext, useContext, useEffect, useState } from 'react';
import { CanvasElement, ToolType, CanvasAnnotation } from '@/types/canvas';
import { storeImage, getImages } from '@/lib/canvas-image-db';
import { getPresignedUrls } from '@/lib/presigned-url-cache';
import { safeSetItem } from '@/lib/safe-storage';

// 生成唯一ID
const generateId = () => Math.random().toString(36).substr(2, 9);

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

// 从 localStorage 加载状态
const loadStateFromStorage = (): CanvasState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(CANVAS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // 验证数据格式
      if (parsed && Array.isArray(parsed.elements)) {
        return {
          ...initialState,
          ...parsed,
          selectedIds: [], // 不保存选中状态
        };
      }
    }
  } catch (e) {
    console.error('[Canvas] 加载 localStorage 失败:', e);
  }
  return null;
};

// 保存状态到 localStorage
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
    // 对于图片元素，只保存 imageKey/dbId，不保存 imageUrl（签名 URL 会过期，base64 太大，blob URL 会失效）
    const elementsToSave = state.elements.map(el => {
      if (el.type === 'image') {
        // 移除 imageUrl（会过期或失效），保留其他属性（包括 imageKey 和 dbId）
        const { imageUrl, ...rest } = el;
        
        // COS 图片：有 imageKey
        if (el.imageKey) {
          return rest; // rest 包含 dbId 等其他属性
        }
        
        // 本地图片：有 dbId
        if ((el as any).dbId) {
          return rest; // rest 包含 dbId
        }
        
        // 既没有 imageKey 也没有 dbId，无法持久化图片内容
        if (el.imageUrl) {
          console.warn('[Canvas] 图片缺少 imageKey 和 dbId，刷新后可能丢失:', el.id);
        }
        return rest;
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
  | { type: 'SET_VIEWPORT'; payload: { zoom: number; panX: number; panY: number } };

// Reducer
function canvasReducer(state: CanvasState, action: Action): CanvasState {
  switch (action.type) {
    case 'ADD_ELEMENT':
      return {
        ...state,
        elements: [...state.elements, action.payload],
        selectedIds: [action.payload.id],
      };

    case 'UPDATE_ELEMENT':
      return {
        ...state,
        elements: state.elements.map(el =>
          el.id === action.payload.id ? { ...el, ...action.payload.updates } : el
        ),
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
      // 将元素移动到数组末尾并选中它
      const idx = state.elements.findIndex(el => el.id === action.payload);
      if (idx >= 0) {
        const newElements = [...state.elements];
        const [el] = newElements.splice(idx, 1);
        newElements.push(el);
        return { ...state, elements: newElements, selectedIds: [action.payload] };
      }
      return { ...state, selectedIds: [action.payload] };
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

    case 'SET_ACTIVE_ANNOTATION':
      return {
        ...state,
        activeAnnotationId: action.payload,
      };

    default:
      return state;
  }
}

// Context
export interface CanvasContextType {
  state: CanvasState;
  addElement: (element: Omit<CanvasElement, 'id'>) => string;
  updateElement: (id: string, updates: Partial<CanvasElement>) => void;
  deleteElement: (id: string) => void;
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
  // 【强制保存】绕过防抖，立即同步写入 localStorage
  forceSaveToStorage: () => void;
  // 🔧 #221 修复：暴露 stateRef，解决 React 闭包陷阱
  stateRef: React.MutableRefObject<CanvasState>;
}

const CanvasContext = createContext<CanvasContextType | null>(null);

export function CanvasProvider({ children }: { children: React.ReactNode }) {
  // #053 修复：回滚 #045 的修改，恢复原来的 lazy initialization
  // #045 的修改导致 elements 没有被恢复！
  const [state, dispatch] = useReducer(canvasReducer, undefined, () => {
    const savedState = loadStateFromStorage();
    if (savedState) {
      return {
        ...initialState,
        ...savedState,
        selectedIds: [], // 不恢复选中状态
      };
    }
    return initialState;
  });
  
  const historyRef = useRef<{ elements: CanvasElement[]; selectedIds: string[] }[]>([{ elements: [], selectedIds: [] }]);
  const historyIndexRef = useRef(0);
  
  // #079 修复：使用 ref 存储最新状态，解决 forceSaveToStorage 闭包问题
  const stateRef = useRef(state);
  stateRef.current = state;
  
  // #053 修复：回滚 #045 的修改，恢复原来的逻辑
  // #034 修复：isInitialized 一开始就是 true，因为 useReducer 已经同步读取了 localStorage
  const [isInitialized, setIsInitialized] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);

  // 客户端加载 localStorage 数据（用于图片恢复）
  useEffect(() => {
    // 检查是否有图片元素需要恢复
    const imageElements = state.elements.filter(
      (el: CanvasElement) => el.type === 'image' && !el.imageUrl && (el.imageKey || (el as any).dbId)
    );
    
    if (imageElements.length === 0) {
      return;
    }
    
    setIsRestoring(true);
    
    // 异步恢复图片
    const fetchImageUrls = async () => {
      try {
        // ====== 第一步：区分 COS 图片和本地图片 ======
        const cosElements = imageElements.filter(el => el.imageKey && el.sourceType !== 'upload');
        const localElements = imageElements.filter(el => 
          (el as any).dbId || el.sourceType === 'upload'
        );
        
        // ====== 处理本地图片：从 IndexedDB 恢复 ======
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
                  dispatch({
                    type: 'UPDATE_ELEMENT',
                    payload: { id: el.id, updates: { 
                      generationStatus: 'expired',
                      generationError: '本地图片已丢失'
                    } }
                  });
                }
              } catch (idxError) {
                console.error('[Canvas] IndexedDB 恢复失败:', dbId, idxError);
              }
            }
          }
        }
        
        // ====== #150 恢复 COS 图片：IndexedDB 缓存优先 ======
        if (cosElements.length > 0) {
          const { loadImageFromCache, storeImageByKey } = await import('@/lib/canvas-image-db');
          
          // 1. 先尝试从 IndexedDB 缓存加载（并行）
          const cacheResults = await Promise.all(
            cosElements.map(async (el) => {
              const imageKey = el.imageKey!;
              const cachedUrl = await loadImageFromCache(imageKey);
              return { el, imageKey, cachedUrl };
            })
          );
          
          // 2. 分类：缓存命中 vs 未命中
          const cached = cacheResults.filter(r => r.cachedUrl);
          const missed = cacheResults.filter(r => !r.cachedUrl);
          
          // 3. 缓存命中的直接渲染
          for (const { el, imageKey, cachedUrl } of cached) {
            dispatch({
              type: 'UPDATE_ELEMENT',
              payload: { id: el.id, updates: { 
                imageUrl: cachedUrl || undefined,
                generationStatus: 'completed'
              } }
            });
            console.log('[Canvas] #150 缓存命中:', imageKey);
          }
          
          // 4. 缓存未命中的，请求网络并后台缓存
          if (missed.length > 0) {
            const keys = missed.map(r => r.imageKey);
            
            try {
              await new Promise(r => setTimeout(r, 300));
              
              // 🔧 #209 使用签名 URL 缓存机制，触发浏览器 Disk Cache
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
              
              const signedUrls = await getPresignedUrls(keys, fetchNewUrls);
              
              for (const { el, imageKey } of missed) {
                const signedUrl = signedUrls[imageKey];
                
                if (signedUrl) {
                  // 先渲染，让用户看到图
                  dispatch({
                    type: 'UPDATE_ELEMENT',
                    payload: { id: el.id, updates: { 
                      imageUrl: signedUrl,
                      generationStatus: 'completed'
                    } }
                  });
                  
                  // 后台异步缓存（不阻塞渲染）
                  fetch(signedUrl)
                    .then(res => res.blob())
                    .then(blob => {
                      if (blob && blob.size > 0) {
                        storeImageByKey(imageKey, blob).catch(console.error);
                        console.log('[Canvas] #150 后台缓存完成:', imageKey);
                      }
                    })
                    .catch(err => {
                      console.error('[Canvas] #150 后台缓存失败:', imageKey, err);
                    });
                }
              }
            } catch (err) {
              console.error('[Canvas] COS 图片恢复失败:', err);
            }
          }
          
          console.log('[Canvas] #150 恢复统计: 缓存命中', cached.length, '/ 网络请求', missed.length);
        }
        
        // ====== 恢复完成后释放锁定 ======
        setTimeout(() => {
          setIsRestoring(false);
        }, 100);
        
      } catch (error) {
        console.error('[Canvas] 恢复图片失败:', error);
        setIsRestoring(false);
      }
    };
    
    fetchImageUrls();
  }, []);

  // #040 性能优化：分离保存逻辑，减少不必要的 useEffect 触发
  // 1. 元素变化时保存（较少发生）
  useEffect(() => {
    if (isRestoring) return;
    
    const isRecovering = state.elements.some(el => el.generationStatus === 'recovering');
    if (isRecovering) return;
    
    // 检查是否是初始状态
    const hasViewportChange = state.zoom !== 100 || state.panX !== 0 || state.panY !== 0;
    const isInitialState = state.elements.length === 0 && !hasViewportChange;
    if (isInitialState) return;
    
    const timer = setTimeout(() => {
      saveStateToStorage(state, isRestoring);
    }, 1000);
    return () => clearTimeout(timer);
  }, [state.elements, state.annotations, isRestoring]);
  
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
    if (isRestoring) return;
    
    // 检查是否有占位符收到 actualTaskId（从 undefined 变为有值）
    const placeholdersWithTaskId = state.elements.filter(
      (el: CanvasElement) => el.generationStatus === 'generating' && el.generationTaskId
    );
    
    if (placeholdersWithTaskId.length > 0) {
      console.log('[Canvas] 检测到占位符收到 actualTaskId，立即保存:', placeholdersWithTaskId.map(el => ({
        id: el.id,
        generationTaskId: el.generationTaskId,
      })));
      saveStateToStorage(state, false);
    }
  }, [generatingTaskIds, isRestoring]);

  // 保存历史
  const saveHistory = useCallback(() => {
    const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    newHistory.push({ elements: [...state.elements], selectedIds: [...state.selectedIds] });
    historyRef.current = newHistory;
    historyIndexRef.current = newHistory.length - 1;
  }, [state.elements, state.selectedIds]);

  // 添加元素
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

  // 删除单个元素
  // #289 修复：删除后立即保存，防止刷新后恢复
  const deleteElement = useCallback((id: string) => {
    dispatch({ type: 'DELETE_ELEMENTS', payload: [id] });
    saveHistory();
    // 立即保存到 localStorage
    saveStateToStorage(stateRef.current, false);
    console.log('[Canvas] #289 删除元素后立即保存');
  }, [saveHistory]);

  // 删除选中元素
  // #289 修复：删除后立即保存，防止刷新后恢复
  const deleteSelected = useCallback(() => {
    if (state.selectedIds.length > 0) {
      dispatch({ type: 'DELETE_ELEMENTS', payload: state.selectedIds });
      saveHistory();
      // 立即保存到 localStorage
      saveStateToStorage(stateRef.current, false);
      console.log('[Canvas] #289 删除选中元素后立即保存');
    }
  }, [state.selectedIds, saveHistory]);

  // 复制选中元素
  const duplicateSelected = useCallback(() => {
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
        dispatch({ type: 'ADD_ELEMENT', payload: newElement });
      }
    });
    saveHistory();
  }, [state.selectedIds, state.elements, saveHistory]);

  // 选择元素 - 选中时将元素移动到数组末尾（置顶）
  const selectElement = useCallback((id: string, multi = false) => {
    if (multi) {
      const isSelected = state.selectedIds.includes(id);
      dispatch({
        type: 'SELECT_ELEMENTS',
        payload: isSelected
          ? state.selectedIds.filter(sid => sid !== id)
          : [...state.selectedIds, id],
      });
    } else {
      // 单选时：先置顶元素，再选中
      dispatch({ type: 'BRING_TO_FRONT_AND_SELECT', payload: id });
    }
  }, [state.selectedIds]);

  // 批量选择多个元素（替换当前选择）
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

  // 上移图层
  const bringForward = useCallback((id: string) => {
    dispatch({ type: 'BRING_FORWARD', payload: id });
  }, []);

  // 下移图层
  const sendBackward = useCallback((id: string) => {
    dispatch({ type: 'SEND_BACKWARD', payload: id });
  }, []);

  // 置顶图层
  const bringToFront = useCallback((id: string) => {
    dispatch({ type: 'BRING_TO_FRONT', payload: id });
  }, []);

  // 置底图层
  const sendToBack = useCallback((id: string) => {
    dispatch({ type: 'SEND_TO_BACK', payload: id });
  }, []);

  // 对齐功能
  const alignLeft = useCallback(() => {
    if (state.selectedIds.length < 2) return;
    const minX = Math.min(...state.selectedIds.map(id => {
      const el = state.elements.find(e => e.id === id);
      return el ? el.x : Infinity;
    }));
    state.selectedIds.forEach(id => {
      dispatch({ type: 'UPDATE_ELEMENT', payload: { id, updates: { x: minX } } });
    });
  }, [state.selectedIds, state.elements]);

  const alignCenter = useCallback(() => {
    if (state.selectedIds.length < 2) return;
    const elements = state.selectedIds.map(id => state.elements.find(e => e.id === id)).filter(Boolean) as CanvasElement[];
    const center = (Math.min(...elements.map(el => el.x)) + Math.max(...elements.map(el => el.x + el.width))) / 2;
    elements.forEach(el => {
      dispatch({ type: 'UPDATE_ELEMENT', payload: { id: el.id, updates: { x: center - el.width / 2 } } });
    });
  }, [state.selectedIds, state.elements]);

  const alignRight = useCallback(() => {
    if (state.selectedIds.length < 2) return;
    const maxX = Math.max(...state.selectedIds.map(id => {
      const el = state.elements.find(e => e.id === id);
      return el ? el.x + el.width : -Infinity;
    }));
    state.selectedIds.forEach(id => {
      const el = state.elements.find(e => e.id === id);
      if (el) {
        dispatch({ type: 'UPDATE_ELEMENT', payload: { id, updates: { x: maxX - el.width } } });
      }
    });
  }, [state.selectedIds, state.elements]);

  const alignTop = useCallback(() => {
    if (state.selectedIds.length < 2) return;
    const minY = Math.min(...state.selectedIds.map(id => {
      const el = state.elements.find(e => e.id === id);
      return el ? el.y : Infinity;
    }));
    state.selectedIds.forEach(id => {
      dispatch({ type: 'UPDATE_ELEMENT', payload: { id, updates: { y: minY } } });
    });
  }, [state.selectedIds, state.elements]);

  const alignMiddle = useCallback(() => {
    if (state.selectedIds.length < 2) return;
    const elements = state.selectedIds.map(id => state.elements.find(e => e.id === id)).filter(Boolean) as CanvasElement[];
    const middle = (Math.min(...elements.map(el => el.y)) + Math.max(...elements.map(el => el.y + el.height))) / 2;
    elements.forEach(el => {
      dispatch({ type: 'UPDATE_ELEMENT', payload: { id: el.id, updates: { y: middle - el.height / 2 } } });
    });
  }, [state.selectedIds, state.elements]);

  const alignBottom = useCallback(() => {
    if (state.selectedIds.length < 2) return;
    const maxY = Math.max(...state.selectedIds.map(id => {
      const el = state.elements.find(e => e.id === id);
      return el ? el.y + el.height : -Infinity;
    }));
    state.selectedIds.forEach(id => {
      const el = state.elements.find(e => e.id === id);
      if (el) {
        dispatch({ type: 'UPDATE_ELEMENT', payload: { id, updates: { y: maxY - el.height } } });
      }
    });
  }, [state.selectedIds, state.elements]);

  // 撤销
  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      const historyState = historyRef.current[historyIndexRef.current];
      dispatch({
        type: 'RESTORE_HISTORY',
        payload: { elements: historyState.elements, selectedIds: historyState.selectedIds },
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
    if (generatingEls.length > 0) {
      console.log('[Canvas] 强制保存中，占位符元素:', generatingEls.map((el: any) => ({
        id: el.id,
        generationClientId: el.generationClientId,
        generationTaskId: el.generationTaskId,
        generationIndex: el.generationIndex,
      })));
    }
    saveStateToStorage(currentState, false);
    console.log('[Canvas] 强制保存完成');
  }, []);

  // 重做
  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++;
      const historyState = historyRef.current[historyIndexRef.current];
      dispatch({
        type: 'RESTORE_HISTORY',
        payload: { elements: historyState.elements, selectedIds: historyState.selectedIds },
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
    // 创建本地预览 URL
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
          const hasExistingImages = state.elements.some(el => el.type === 'image');
          
          // 画布尺寸
          const CANVAS_WIDTH = 40000;
          const CANVAS_HEIGHT = 27586;
          
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
        
        // 先添加元素，使用本地预览 URL
        const tempElement = addElement({
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
          imageUrl: localPreviewUrl,
          aspectRatio,
          sourceType: 'upload', // 标记为本地上传图片
        });
        
        // 异步存储到 IndexedDB（浏览器本地存储）
        try {
          const dbId = await storeImage(file, file.type);
          
          // 存储成功，更新元素的 dbId（用于本地图片恢复）
          dispatch({
            type: 'UPDATE_ELEMENT',
            payload: {
              id: tempElement,
              updates: {
                dbId, // 使用 dbId 而不是 imageKey，区分本地图片和 COS 图片
              }
            }
          });
        } catch (error) {
          console.error('[Canvas] 图片存储失败:', error);
          // 存储失败，保持使用本地预览 URL（但会在刷新后丢失）
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
  }, [addElement, state.elements]);

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
    // 【强制保存】绕过防抖，立即同步写入
    forceSaveToStorage,
    // 🔧 #221 修复：暴露 stateRef，解决 React 闭包陷阱
    stateRef,
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
