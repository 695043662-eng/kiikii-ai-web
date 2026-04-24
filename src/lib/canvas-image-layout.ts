/**
 * 画布图片布局工具
 * 
 * 【统一尺寸规则】
 * - 单图：占屏幕 50% 以内
 * - 多图：占屏幕 80% 以内
 * 
 * 【网格布局规则】
 * - 1-4张：水平排列（1行）
 * - 5-8张：2行
 * - 9+张：3行
 */

// ============================================
// 【常量】
// ============================================

/** 画布图片规则常量 */
export const CANVAS_IMAGE_RULES = {
  /** 单图占屏幕比例 */
  SINGLE_IMAGE_RATIO: 0.5,
  
  /** 多图占屏幕比例 */
  MULTI_IMAGE_RATIO: 0.8,
  
  /** 网格间距 */
  GRID_GAP: 60,
  
  /** 最小缩放 */
  MIN_ZOOM: 0.1,
  
  /** 最大缩放 */
  MAX_ZOOM: 1,
  
  /**
   * 根据图片数量获取列数
   * - 1-4张：水平排列（cols = count）
   * - 5-8张：2行（cols = ceil(count/2)）
   * - 9+张：3行（cols = ceil(count/3)）
   */
  getGridCols: (count: number): number => {
    if (count <= 4) return count;
    if (count <= 8) return Math.ceil(count / 2);
    return Math.ceil(count / 3);
  },
  
  /**
   * 根据图片数量获取行数
   */
  getGridRows: (count: number): number => {
    const cols = CANVAS_IMAGE_RULES.getGridCols(count);
    return Math.ceil(count / cols);
  },
  
  /**
   * 根据图片数量获取屏幕占比
   */
  getScreenRatio: (count: number): number => {
    return count === 1 ? CANVAS_IMAGE_RULES.SINGLE_IMAGE_RATIO : CANVAS_IMAGE_RULES.MULTI_IMAGE_RATIO;
  },
} as const;

// ============================================
// 【类型定义】
// ============================================

/** 图片尺寸 */
export interface ImageDimension {
  width: number;
  height: number;
}

/** 布局计算输入 */
export interface LayoutInput {
  /** 图片数量 */
  imageCount: number;
  /** 图片原始尺寸（可选，用于保持宽高比） */
  imageDimensions?: ImageDimension[];
  /** 容器宽度 */
  containerWidth: number;
  /** 容器高度 */
  containerHeight: number;
  /** 当前缩放级别（用于计算画布坐标） */
  currentZoom?: number;
  /** 指定宽高比（如 '1:1', '16:9'，可选） */
  ratio?: string;
}

/** 单张图片的布局信息 */
export interface ImageLayout {
  /** X 坐标（相对于图片组左上角） */
  x: number;
  /** Y 坐标（相对于图片组左上角） */
  y: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
}

/** 布局计算结果 */
export interface LayoutResult {
  // ====== 网格布局 ======
  /** 列数 */
  cols: number;
  /** 行数 */
  rows: number;
  /** 间距 */
  gap: number;
  
  // ====== 单元格尺寸 ======
  /** 单元格宽度 */
  cellWidth: number;
  /** 单元格高度 */
  cellHeight: number;
  
  // ====== 图片组尺寸 ======
  /** 图片组总宽度 */
  totalWidth: number;
  /** 图片组总高度 */
  totalHeight: number;
  
  // ====== 每张图片的布局 ======
  /** 每张图片的位置和尺寸（保持宽高比） */
  images: ImageLayout[];
  
  // ====== 屏幕占比 ======
  /** 屏幕占比（单图 0.5，多图 0.8） */
  screenRatio: number;
  
  // ====== 镜头参数 ======
  /** 镜头缩放（让图片组占屏幕 screenRatio） */
  zoom: number;
  /** 镜头 X 偏移（居中显示） */
  panX: number;
  /** 镜头 Y 偏移（居中显示） */
  panY: number;
  
  // ====== 居中位置（画布坐标） ======
  /** 图片组居中时的左边界 */
  centerLeft: number;
  /** 图片组居中时的上边界 */
  centerTop: number;
}

// ============================================
// 【核心函数】
// ============================================

/**
 * 计算图片组布局
 * 
 * 统一处理：尺寸规则、网格布局、镜头缩放
 * 
 * @param input 输入参数
 * @returns 布局结果
 */
export function calculateImageGroupLayout(input: LayoutInput): LayoutResult {
  const {
    imageCount,
    imageDimensions,
    containerWidth,
    containerHeight,
    currentZoom = 1,
    ratio = 'auto',
  } = input;
  
  const { GRID_GAP, MIN_ZOOM, MAX_ZOOM, getGridCols, getGridRows, getScreenRatio } = CANVAS_IMAGE_RULES;
  
  // 🔧 #130 修复：防御性检查，防止除以 0
  const safeZoom = Math.max(MIN_ZOOM, currentZoom || MIN_ZOOM);
  const safeContainerWidth = Math.max(100, containerWidth || 100);
  const safeContainerHeight = Math.max(100, containerHeight || 100);
  
  // 1. 计算网格布局
  const cols = Math.max(1, getGridCols(imageCount));
  const rows = Math.max(1, getGridRows(imageCount));
  const gap = GRID_GAP;
  
  // 2. 计算可视区域大小（画布坐标）
  const visibleWidth = safeContainerWidth / safeZoom;
  const visibleHeight = safeContainerHeight / safeZoom;
  
  // 3. 计算屏幕占比
  const screenRatio = getScreenRatio(imageCount);
  
  // 4. 计算初始单元格尺寸
  // 🔧 #219 修复：占位符大小不依赖 zoom，使用容器尺寸固定比例
  // 🔧 #290 优化：占位符画布尺寸翻倍，像素密度提高，视觉大小不变
  const placeholderBaseSize = Math.min(safeContainerWidth, safeContainerHeight) / 2;
  
  // 如果有图片尺寸，取最大边作为基准
  let baseCellSize: number;
  if (imageDimensions && imageDimensions.length > 0) {
    baseCellSize = Math.max(...imageDimensions.map(d => Math.max(d.width || 1, d.height || 1)));
  } else {
    // 使用固定基准，不依赖 zoom，彻底斩断循环链路
    baseCellSize = Math.max(50, placeholderBaseSize);
  }
  
  // 🔧 #130 修复：确保 baseCellSize 有效
  baseCellSize = Math.max(50, baseCellSize || 50);
  
  // 5. 根据宽高比调整单元格形状
  let cellWidth = baseCellSize;
  let cellHeight = baseCellSize;
  if (ratio !== 'auto') {
    const parts = ratio.split(':').map(p => parseInt(p) || 1);
    const rw = Math.max(1, parts[0] || 1);
    const rh = Math.max(1, parts[1] || 1);
    if (rw >= rh) {
      cellHeight = cellWidth * (rh / rw);
    } else {
      cellWidth = cellHeight * (rw / rh);
    }
  }
  
  // 🔧 #130 修复：确保单元格尺寸有效
  cellWidth = Math.max(10, cellWidth || 50);
  cellHeight = Math.max(10, cellHeight || 50);
  
  // 6. 计算图片组总尺寸
  let totalWidth = Math.max(10, cols * cellWidth + (cols - 1) * gap);
  let totalHeight = Math.max(10, rows * cellHeight + (rows - 1) * gap);
  
  // 7. 按屏幕占比缩放
  const maxWidth = visibleWidth * screenRatio;
  const maxHeight = visibleHeight * screenRatio;
  
  if (totalWidth > maxWidth || totalHeight > maxHeight) {
    // 🔧 #130 修复：防止除以 0
    const scaleX = totalWidth > 0 ? maxWidth / totalWidth : 1;
    const scaleY = totalHeight > 0 ? maxHeight / totalHeight : 1;
    const scale = Math.min(scaleX, scaleY, 1); // 限制最大缩放为 1
    cellWidth = Math.max(10, cellWidth * scale);
    cellHeight = Math.max(10, cellHeight * scale);
    totalWidth = Math.max(10, cols * cellWidth + (cols - 1) * gap);
    totalHeight = Math.max(10, rows * cellHeight + (rows - 1) * gap);
  }
  
  // 8. 计算每张图片的布局（保持宽高比）
  const images: ImageLayout[] = [];
  for (let i = 0; i < imageCount; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    
    // 计算图片在单元格内的位置（居中）
    let width: number, height: number;
    
    if (imageDimensions && imageDimensions[i]) {
      const dim = imageDimensions[i];
      // 🔧 #130 修复：防止除以 0
      const safeDimWidth = Math.max(1, dim.width || 1);
      const safeDimHeight = Math.max(1, dim.height || 1);
      const aspectRatio = safeDimWidth / safeDimHeight;
      if (aspectRatio > 1) {
        width = cellWidth;
        height = Math.max(10, cellWidth / aspectRatio);
      } else {
        height = cellHeight;
        width = Math.max(10, cellHeight * aspectRatio);
      }
    } else {
      width = cellWidth;
      height = cellHeight;
    }
    
    const x = col * (cellWidth + gap) + (cellWidth - width) / 2;
    const y = row * (cellHeight + gap) + (cellHeight - height) / 2;
    
    images.push({ x, y, width, height });
  }
  
  // 9. 计算镜头参数
  // 目标：让图片组在屏幕上占 screenRatio
  // 🔧 #130 修复：防止除以 0
  const fitZoom = totalWidth > 0 && totalHeight > 0 
    ? Math.min(
        (safeContainerWidth * screenRatio) / totalWidth,
        (safeContainerHeight * screenRatio) / totalHeight,
        MAX_ZOOM
      )
    : MIN_ZOOM;
  const zoom = Math.max(MIN_ZOOM, Math.min(fitZoom, MAX_ZOOM));
  
  // 10. 计算居中位置（画布坐标）
  const centerLeft = (visibleWidth - totalWidth) / 2;
  const centerTop = (visibleHeight - totalHeight) / 2;
  
  // 11. 计算镜头偏移（让图片组居中显示）
  const groupCenterX = centerLeft + totalWidth / 2;
  const groupCenterY = centerTop + totalHeight / 2;
  const panX = safeContainerWidth / 2 - groupCenterX * zoom;
  const panY = safeContainerHeight / 2 - groupCenterY * zoom;
  
  return {
    cols,
    rows,
    gap,
    cellWidth,
    cellHeight,
    totalWidth,
    totalHeight,
    images,
    screenRatio,
    zoom,
    panX,
    panY,
    centerLeft,
    centerTop,
  };
}

/**
 * 计算单张图片的布局（简化版）
 */
export function calculateSingleImageLayout(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
  currentZoom: number = 1
): LayoutResult {
  return calculateImageGroupLayout({
    imageCount: 1,
    imageDimensions: [{ width: imageWidth, height: imageHeight }],
    containerWidth,
    containerHeight,
    currentZoom,
  });
}
