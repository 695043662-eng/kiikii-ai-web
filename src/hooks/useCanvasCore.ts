/**
 * ============================================
 * useCanvasCore Hook
 * ============================================
 * 
 * 【职责】
 * 抽离 Canvas 编辑器的核心底层逻辑：
 * - Canvas 尺寸常量定义
 * - 图片尺寸获取（统一实现，解决4处重复定义）
 * - ResizeObserver 容器监听
 * - 键盘快捷键处理
 * - 积分获取与监听
 * - 模型列表更新监听
 * 
 * 【命名规范】
 * - 严格保持常量原始数值（CANVAS_HEIGHT = 40000）
 * - 函数命名与原 page.tsx 一致
 * 
 * 【内存安全】
 * - cleanup 函数必须正确清理所有监听器
 * - useEffect 返回清理函数，防止内存泄漏
 * 
 * 【来源】page.tsx 中的重复代码块
 * - getImageDimensions: 4处重复（1323, 2457, 3487, 3714行）
 * - updateSize + ResizeObserver: 1645-1663行
 * - CANVAS_HEIGHT 等常量: 1667-1675行
 * - 键盘快捷键: 1702-1768行
 * - 积分获取: 1678-1699行
 * - 模型更新监听: 1796-1818行
 * ============================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ============================================
// 【常量定义 - 严格保持原始数值】
// ============================================

/** 画布高度（像素） */
export const CANVAS_HEIGHT = 40000;

/** 画布宽度 - 根据容器比例动态计算，不再固定 */

/** 最小缩放比例 - 降低到 0.01，允许滚轮缩得更小以查看全貌 */
export const MIN_ZOOM = 0.01;

/** 空白检测偏移量数组（优先级：上→下→左→右） */
export const IMAGE_OVERLAP_OFFSETS = [50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000];

// ============================================
// 【类型定义】
// ============================================

/** 容器尺寸 */
export interface ContainerSize {
  width: number;
  height: number;
}

/** 画布尺寸状态 */
export interface CanvasSizeState {
  containerSize: ContainerSize;
}

/** 画布尺寸常量 */
export interface CanvasDimensions {
  CANVAS_HEIGHT: number;
  CANVAS_WIDTH: number;
  MIN_ZOOM: number;
  IMAGE_OVERLAP_OFFSETS: number[];
}

/** 现有图片边界 */
export interface ImageBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 计算偏移结果 */
export interface OverlapOffsetResult {
  left: number;
  top: number;
}

/** 计算镜头结果 */
export interface CameraResult {
  zoom: number;
  panX: number;
  panY: number;
}

/** 缩放计算参数 */
export interface ZoomCalcParams {
  currentZoom: number;
  currentPan: { x: number; y: number };
  scaleFactor: number;
  mouseX?: number;  // 滚轮缩放时鼠标位置
  mouseY?: number;
  containerWidth: number;
  containerHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}

/** 缩放计算结果 */
export interface ZoomCalcResult {
  zoom: number;
  panX: number;
  panY: number;
}

/** fitToAllImages 参数 */
export interface FitToAllImagesParams {
  elements: Array<{ type: string; visible: boolean; x: number; y: number; width: number; height: number }>;
  containerWidth: number;
  containerHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}

/** fitToAllImages 结果 */
export interface FitToAllImagesResult {
  zoom: number;
  panX: number;
  panY: number;
  imageCount: number;
}

/** Hook 依赖项 */
export interface UseCanvasCoreDeps {
  /** Canvas 实例（来自 CanvasContext） */
  canvas: any;
  
  /** 设置画布容器尺寸的回调 */
  setContainerSize: React.Dispatch<React.SetStateAction<ContainerSize>>;
  
  /** 设置激活工具的回调 */
  setActiveTool: (tool: string) => void;
  
  /** 积分 setter */
  setCredits: React.Dispatch<React.SetStateAction<number>>;
  
  /** 用户 ID setter */
  setUserId: React.Dispatch<React.SetStateAction<string | null>>;
  
  /** 刷新模型列表的函数 */
  refreshModelOptions?: () => Promise<void>;
}

/** Hook 返回值 */
export interface UseCanvasCoreReturn {
  // 尺寸常量
  dimensions: CanvasDimensions;
  
  // 尺寸状态
  sizeState: CanvasSizeState;
  
  // 工具函数
  getImageDimensions: (src: string) => Promise<{ width: number; height: number }>;
  
  // 空白检测偏移计算
  calculateOverlapOffset: (
    targetLeft: number,
    targetTop: number,
    totalWidth: number,
    totalHeight: number,
    existingImages: ImageBounds[]
  ) => OverlapOffsetResult;
  
  // 图片组镜头计算
  calculateImageGroupCamera: (
    groupLeft: number,
    groupTop: number,
    totalWidth: number,
    totalHeight: number,
    containerWidth: number,
    containerHeight: number,
    imageCount?: number
  ) => CameraResult;
  
  // 缩放计算
  calculateZoom: (params: ZoomCalcParams) => ZoomCalcResult;
  
  // 显示所有图片
  fitToAllImages: (params: FitToAllImagesParams) => FitToAllImagesResult;
  
  // 清理函数（用于手动清理）
  cleanup: () => void;
}

// ============================================
// 【useCanvasCore Hook 实现】
// ============================================

/**
 * useCanvasCore
 * 
 * 抽离 Canvas 编辑器的核心底层逻辑
 * 
 * @param deps - 依赖项（canvas实例、setter回调等）
 * @param containerRef - 容器 DOM 引用
 * @returns Hook 返回值
 */
export function useCanvasCore(
  deps: UseCanvasCoreDeps,
  containerRef: React.RefObject<HTMLDivElement | null>
): UseCanvasCoreReturn {
  
  const { canvas, setContainerSize, setActiveTool, setCredits, setUserId, refreshModelOptions } = deps;
  
  // ========================================
  // 【状态】
  // ========================================
  
  const [containerSize, setContainerSizeState] = useState<ContainerSize>({
    width: 0,
    height: 0
  });
  
  // ========================================
  // 【Refs - 用于清理】
  // ========================================
  
  /** ResizeObserver 实例 */
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  
  /** 键盘事件监听 refs */
  const keyboardHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  const creditsHandlerRef = useRef<((e: MessageEvent) => void) | null>(null);
  const modelHandlerRef = useRef<((e: MessageEvent) => void) | null>(null);
  
  // ========================================
  // 【常量定义】
  // ========================================
  
  // 动态计算画布宽度：根据容器比例
  const CANVAS_WIDTH = containerSize.width > 0 && containerSize.height > 0
    ? Math.round((containerSize.width / containerSize.height) * CANVAS_HEIGHT)
    : CANVAS_HEIGHT; // 默认正方形
  
  const dimensions: CanvasDimensions = {
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    MIN_ZOOM,
    IMAGE_OVERLAP_OFFSETS,
  };
  
  // ========================================
  // 【核心工具函数】
  // ========================================
  
  /**
   * 获取图片尺寸（统一实现，解决4处重复定义）
   * 
   * 【设计原则】
   * - 不设置 crossOrigin='Anonymous'，避免 COS 签名 URL CORS 问题
   * - 仅获取尺寸，不需要读取像素数据
   * - 失败时返回默认尺寸（200x150）
   */
  const getImageDimensions = useCallback(
    (src: string): Promise<{ width: number; height: number }> => {
      return new Promise((resolve, reject) => {
        console.log(`[getImageDimensions] 开始加载图片: ${src?.substring(0, 60)}...`);
        const img = new window.Image();
        
        // 方案A：onload 成功获取尺寸
        const handleLoad = () => {
          cleanup();
          clearTimeout(timeoutId);
          // 使用 naturalWidth/naturalHeight 获取实际像素尺寸
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            console.log(`[getImageDimensions] 成功: ${img.naturalWidth}×${img.naturalHeight}`);
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
          } else {
            // fallback：使用 width/height 属性
            console.log(`[getImageDimensions] 使用 fallback: ${img.width}×${img.height}`);
            resolve({ width: img.width || 200, height: img.height || 150 });
          }
        };
        
        // 方案B：onerror 时尝试使用 width/height
        const handleError = () => {
          cleanup();
          clearTimeout(timeoutId);
          console.error(`[getImageDimensions] 加载失败: ${src?.substring(0, 60)}...`);
          // 如果能获取到 width/height，使用它
          if (img.width > 0 && img.height > 0) {
            resolve({ width: img.width, height: img.height });
          } else {
            // 真的失败了，返回默认尺寸
            resolve({ width: 200, height: 150 });
          }
        };
        
        const cleanup = () => {
          img.removeEventListener('load', handleLoad);
          img.removeEventListener('error', handleError);
        };
        
        img.addEventListener('load', handleLoad);
        img.addEventListener('error', handleError);
        
        img.src = src;
        
        // 防止内存泄漏：20秒超时
        const timeoutId = setTimeout(() => {
          cleanup();
          console.error(`[getImageDimensions] 超时(20s): ${src?.substring(0, 60)}...`);
          // 超时返回默认尺寸，保持原有行为
          resolve({ width: 200, height: 150 });
        }, 20000);
      });
    },
    []
  );
  
  /**
   * 计算空白检测偏移位置
   * 
   * 【优先级】上 → 下 → 左 → 右 → 兜底（原位置）
   * 
   * @param targetLeft - 目标X坐标
   * @param targetTop - 目标Y坐标
   * @param totalWidth - 图片组总宽度
   * @param totalHeight - 图片组总高度
   * @param existingImages - 画布上现有图片边界
   */
  const calculateOverlapOffset = useCallback(
    (
      targetLeft: number,
      targetTop: number,
      totalWidth: number,
      totalHeight: number,
      existingImages: ImageBounds[]
    ): OverlapOffsetResult => {
      
      // 检测图片组是否与现有图片重叠
      const isOverlapping = (groupLeft: number, groupTop: number): boolean => {
        const groupRight = groupLeft + totalWidth;
        const groupBottom = groupTop + totalHeight;
        
        for (const img of existingImages) {
          const overlaps = !(
            groupRight <= img.left ||
            groupLeft >= img.right ||
            groupBottom <= img.top ||
            groupTop >= img.bottom
          );
          if (overlaps) {
            return true;
          }
        }
        return false;
      };
      
      let finalLeft = targetLeft;
      let finalTop = targetTop;
      
      // 第1优先级：向上偏移
      if (isOverlapping(targetLeft, targetTop)) {
        for (const offset of IMAGE_OVERLAP_OFFSETS) {
          const newTop = targetTop - offset;
          if (newTop >= 0 && !isOverlapping(targetLeft, newTop)) {
            finalLeft = targetLeft;
            finalTop = newTop;
            return { left: finalLeft, top: finalTop };
          }
        }
      }
      
      // 第2优先级：向下偏移
      if (isOverlapping(finalLeft, finalTop)) {
        for (const offset of IMAGE_OVERLAP_OFFSETS) {
          const newTop = targetTop + offset;
          const groupBottom = newTop + totalHeight;
          if (groupBottom <= CANVAS_HEIGHT && !isOverlapping(finalLeft, newTop)) {
            finalLeft = targetLeft;
            finalTop = newTop;
            return { left: finalLeft, top: finalTop };
          }
        }
      }
      
      // 第3优先级：向左偏移
      if (isOverlapping(finalLeft, finalTop)) {
        for (const offset of IMAGE_OVERLAP_OFFSETS) {
          const newLeft = targetLeft - offset;
          if (newLeft >= 0 && !isOverlapping(newLeft, finalTop)) {
            finalLeft = newLeft;
            finalTop = finalTop;
            return { left: finalLeft, top: finalTop };
          }
        }
      }
      
      // 第4优先级：向右偏移
      if (isOverlapping(finalLeft, finalTop)) {
        for (const offset of IMAGE_OVERLAP_OFFSETS) {
          const newLeft = targetLeft + offset;
          const groupRight = newLeft + totalWidth;
          if (groupRight <= CANVAS_WIDTH && !isOverlapping(newLeft, finalTop)) {
            finalLeft = newLeft;
            finalTop = finalTop;
            return { left: finalLeft, top: finalTop };
          }
        }
      }
      
      // 兜底：原位置
      return { left: finalLeft, top: finalTop };
    },
    []
  );
  
  /**
   * 计算图片组镜头位置
   * 
   * 【统一尺寸规则】
   * - 单图：占屏幕 50% 以内
   * - 多图：占屏幕 80% 以内
   * 
   * @param groupLeft - 图片组X坐标
   * @param groupTop - 图片组Y坐标
   * @param totalWidth - 图片组总宽度
   * @param totalHeight - 图片组总高度
   * @param containerWidth - 容器宽度
   * @param containerHeight - 容器高度
   * @param imageCount - 图片数量（用于决定 maxGroupRatio）
   */
  const calculateImageGroupCamera = useCallback(
    (
      groupLeft: number,
      groupTop: number,
      totalWidth: number,
      totalHeight: number,
      containerWidth: number,
      containerHeight: number,
      imageCount: number = 1
    ): CameraResult => {
      
      // 【统一尺寸规则】单图 50%，多图 80%
      const maxGroupRatio = imageCount === 1 ? 0.5 : 0.8;
      
      // 计算图片组中心点
      const groupCenterX = groupLeft + totalWidth / 2;
      const groupCenterY = groupTop + totalHeight / 2;
      
      // 计算合适的缩放级别（使图片组占屏幕 maxGroupRatio）
      const groupMaxSize = Math.max(totalWidth, totalHeight);
      const fitZoom = Math.min(
        containerWidth * maxGroupRatio / groupMaxSize,
        containerHeight * maxGroupRatio / groupMaxSize,
        1 // 最大缩放不超过1
      );
      const finalZoom = Math.max(MIN_ZOOM, Math.min(fitZoom, 1));
      
      // 计算新的 pan 值，使图片组中心对准屏幕中心
      const targetScreenX = containerWidth / 2;
      const targetScreenY = containerHeight / 2;
      const newPanX = targetScreenX - groupCenterX * finalZoom;
      const newPanY = targetScreenY - groupCenterY * finalZoom;
      
      return {
        zoom: finalZoom,
        panX: newPanX,
        panY: newPanY,
      };
    },
    []
  );
  
  /**
   * 计算缩放结果
   * 
   * 【缩放范围】
   * - 缩小：最小 = 画布高度填满容器高度（完整显示）
   * - 放大：最大 = 屏幕上画布区域高度 = 800px
   * 
   * @param params - 缩放参数
   */
  const calculateZoom = useCallback(
    (params: ZoomCalcParams): ZoomCalcResult => {
      const {
        currentZoom,
        currentPan,
        scaleFactor,
        mouseX,
        mouseY,
        containerWidth,
        containerHeight,
        canvasWidth,
        canvasHeight,
      } = params;
      
      // 缩放范围限制
      const minZoom = containerHeight / canvasHeight;  // 画布完整显示
      const maxZoom = containerHeight / 800;  // 屏幕上画布区域高度 = 800px
      
      // 计算新缩放值
      const newZoom = Math.max(minZoom, Math.min(currentZoom * scaleFactor, maxZoom));
      
      if (newZoom === currentZoom) {
        return {
          zoom: currentZoom,
          panX: currentPan.x,
          panY: currentPan.y,
        };
      }
      
      const scale = newZoom / currentZoom;
      
      // 计算新 pan 值
      let newPanX: number;
      let newPanY: number;
      
      if (mouseX !== undefined && mouseY !== undefined) {
        // 滚轮缩放：以鼠标位置为中心
        newPanX = mouseX - (mouseX - currentPan.x) * scale;
        newPanY = mouseY - (mouseY - currentPan.y) * scale;
      } else {
        // 按钮缩放：以屏幕中心为中心
        const centerX = containerWidth / 2;
        const centerY = containerHeight / 2;
        newPanX = centerX - (centerX - currentPan.x) * scale;
        newPanY = centerY - (centerY - currentPan.y) * scale;
      }
      
      // 边界限制
      const canvasScreenW = canvasWidth * newZoom;
      const canvasScreenH = canvasHeight * newZoom;
      
      if (canvasScreenW <= containerWidth) {
        newPanX = (containerWidth - canvasScreenW) / 2;
      } else {
        newPanX = Math.max(containerWidth - canvasScreenW, Math.min(0, newPanX));
      }
      
      if (canvasScreenH <= containerHeight) {
        newPanY = (containerHeight - canvasScreenH) / 2;
      } else {
        newPanY = Math.max(containerHeight - canvasScreenH, Math.min(0, newPanY));
      }
      
      return {
        zoom: newZoom,
        panX: newPanX,
        panY: newPanY,
      };
    },
    []
  );
  
  /**
   * 计算显示所有图片的镜头位置
   * 
   * 功能：让所有图片内容占容器的 80% 并居中显示
   * 
   * 包含 pan 边界约束，确保画布不会移出容器边界
   * 
   * @param params - 参数
   */
  const fitToAllImages = useCallback(
    (params: FitToAllImagesParams): FitToAllImagesResult => {
      const { elements, containerWidth, containerHeight, canvasWidth, canvasHeight } = params;
      
      // 获取所有图片元素（过滤掉宽高为0的无效元素）
      const imageElements = elements.filter(el => 
        el.type === 'image' && el.visible && el.width > 0 && el.height > 0
      );
      
      if (imageElements.length === 0) {
        // 没有图片，返回默认值
        return {
          zoom: 1,
          panX: 0,
          panY: 0,
          imageCount: 0,
        };
      }
      
      // 计算所有图片的边界框
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      imageElements.forEach(el => {
        minX = Math.min(minX, el.x);
        minY = Math.min(minY, el.y);
        maxX = Math.max(maxX, el.x + el.width);
        maxY = Math.max(maxY, el.y + el.height);
      });
      
      const contentWidth = maxX - minX;
      const contentHeight = maxY - minY;
      
      // 计算缩放比例，让内容刚好填满容器（留10%边距）
      const scaleX = (containerWidth * 0.9) / contentWidth;
      const scaleY = (containerHeight * 0.9) / contentHeight;
      const newZoom = Math.min(scaleX, scaleY, 1);
      
      // 计算平移，让内容居中
      const contentCenterX = minX + contentWidth / 2;
      const contentCenterY = minY + contentHeight / 2;
      let newPanX = containerWidth / 2 - contentCenterX * newZoom;
      let newPanY = containerHeight / 2 - contentCenterY * newZoom;
      
      // 【关键】限制 pan 边界，确保画布不会移出容器
      // 和拖拽/缩放时的边界约束逻辑一致
      const canvasScreenW = canvasWidth * newZoom;
      const canvasScreenH = canvasHeight * newZoom;
      
      if (canvasScreenW <= containerWidth) {
        // 画布宽度 <= 容器宽度，居中显示
        newPanX = (containerWidth - canvasScreenW) / 2;
      } else {
        // 画布宽度 > 容器宽度，限制 pan 范围
        newPanX = Math.max(containerWidth - canvasScreenW, Math.min(0, newPanX));
      }
      
      if (canvasScreenH <= containerHeight) {
        // 画布高度 <= 容器高度，居中显示
        newPanY = (containerHeight - canvasScreenH) / 2;
      } else {
        // 画布高度 > 容器高度，限制 pan 范围
        newPanY = Math.max(containerHeight - canvasScreenH, Math.min(0, newPanY));
      }
      
      return {
        zoom: newZoom,
        panX: newPanX,
        panY: newPanY,
        imageCount: imageElements.length,
      };
    },
    []
  );
  
  // ========================================
  // 【useEffect - ResizeObserver 容器监听】
  // ========================================
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    const updateSize = (entries: ResizeObserverEntry[]) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width, height });
        setContainerSizeState({ width, height });
      }
    };
    
    resizeObserverRef.current = new ResizeObserver(updateSize);
    resizeObserverRef.current.observe(containerRef.current);
    
    // 初始化尺寸
    const rect = containerRef.current.getBoundingClientRect();
    setContainerSize({ width: rect.width, height: rect.height });
    setContainerSizeState({ width: rect.width, height: rect.height });
    
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [containerRef, setContainerSize]);
  
  // ========================================
  // 【useEffect - 键盘快捷键监听】
  // ========================================
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框中的按键
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      
      // Ctrl/Cmd + Z: 撤销
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canvas && typeof canvas.undo === 'function') {
          canvas.undo();
        }
      }
      
      // Ctrl/Cmd + Y: 重做
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (canvas && typeof canvas.redo === 'function') {
          canvas.redo();
        }
      }
      
      // Ctrl/Cmd + A: 全选
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        if (canvas) {
          canvas.selectAll();
        }
      }
      
      // Delete/Backspace: 删除选中元素
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // 检查是否在文本输入状态
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return; // 在输入框中，不删除
        }
        
        // 检查是否有选中文本
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
          return; // 有选中文本，不删除
        }
        
        if (canvas && canvas.state.selectedIds.length > 0) {
          e.preventDefault();
          canvas.deleteSelected();
        }
      }
      
      // V: 选择工具
      if (e.key === 'v' && !e.ctrlKey && !e.metaKey) {
        setActiveTool('selection');
      }
      
      // R: 矩形工具
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
        setActiveTool('rectangle');
      }
      
      // 数字1-9: 快速切换工具（如果需要）
      // ...
    };
    
    keyboardHandlerRef.current = handleKeyDown;
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      if (keyboardHandlerRef.current) {
        window.removeEventListener('keydown', keyboardHandlerRef.current);
        keyboardHandlerRef.current = null;
      }
    };
  }, [canvas, setActiveTool]);
  
  // ========================================
  // 【useEffect - 积分获取与监听】
  // ========================================
  
  useEffect(() => {
    let creditsInterval: NodeJS.Timeout | null = null;
    
    const fetchCredits = async () => {
      try {
        const res = await fetch('/api/user/credits');
        if (res.ok) {
          const data = await res.json();
          if (data.credits !== undefined) {
            setCredits(data.credits);
          }
          if (data.user_id !== undefined) {
            setUserId(String(data.user_id));
          }
        }
      } catch (error) {
        console.error('[Canvas Core] 获取积分失败:', error);
      }
    };
    
    // 立即获取一次
    fetchCredits();
    
    // 每30秒刷新一次积分
    creditsInterval = setInterval(fetchCredits, 30000);
    
    // 监听 SSE 积分变化
    const handleCreditsChange = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'credits' && typeof data.creditsBalance === 'number') {
          setCredits(data.creditsBalance);
        }
      } catch {
        // Ignore parse errors
      }
    };
    
    creditsHandlerRef.current = handleCreditsChange;
    window.addEventListener('message', handleCreditsChange);
    
    return () => {
      if (creditsInterval) {
        clearInterval(creditsInterval);
      }
      if (creditsHandlerRef.current) {
        window.removeEventListener('message', creditsHandlerRef.current);
        creditsHandlerRef.current = null;
      }
    };
  }, [setCredits, setUserId]);
  
  // ========================================
  // 【useEffect - 模型列表更新监听】
  // ========================================
  
  useEffect(() => {
    if (!refreshModelOptions) return;
    
    const handleModelUpdate = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        // 监听模型配置更新事件
        if (data.type === 'model_update' || data.type === 'models_refresh') {
          refreshModelOptions();
        }
      } catch {
        // Ignore parse errors
      }
    };
    
    modelHandlerRef.current = handleModelUpdate;
    window.addEventListener('message', handleModelUpdate);
    
    return () => {
      if (modelHandlerRef.current) {
        window.removeEventListener('message', modelHandlerRef.current);
        modelHandlerRef.current = null;
      }
    };
  }, [refreshModelOptions]);
  
  // ========================================
  // 【cleanup 函数 - 手动清理】
  // ========================================
  
  const cleanup = useCallback(() => {
    // 清理 ResizeObserver
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    
    // 清理键盘监听
    if (keyboardHandlerRef.current) {
      window.removeEventListener('keydown', keyboardHandlerRef.current);
      keyboardHandlerRef.current = null;
    }
    
    // 清理积分监听
    if (creditsHandlerRef.current) {
      window.removeEventListener('message', creditsHandlerRef.current);
      creditsHandlerRef.current = null;
    }
    
    // 清理模型监听
    if (modelHandlerRef.current) {
      window.removeEventListener('message', modelHandlerRef.current);
      modelHandlerRef.current = null;
    }
    
    console.log('[useCanvasCore] 已清理所有监听器');
  }, []);
  
  // ========================================
  // 【返回值】
  // ========================================
  
  return {
    // 尺寸常量
    dimensions,
    
    // 尺寸状态
    sizeState: {
      containerSize,
    },
    
    // 工具函数
    getImageDimensions,
    calculateOverlapOffset,
    calculateImageGroupCamera,
    calculateZoom,
    fitToAllImages,
    
    // 清理函数
    cleanup,
  };
}

// ============================================
// 【导出类型（方便外部使用）】
// ============================================
// 类型已在 interface 定义时导出，无需重复导出
