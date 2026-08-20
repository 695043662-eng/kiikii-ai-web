/**
 * 坐标转换工具
 * 用于屏幕坐标和画布坐标之间的转换
 * 
 * #609 Canvas 交互层方案 A：只替换拖拽连线（draftLine）
 */

interface Point {
  x: number;
  y: number;
}

// 安全的 zoom 值（防止除以 0）
const SAFE_ZOOM_MIN = 0.01;

/**
 * 画布坐标 → 屏幕坐标（用于 Canvas 绘制）
 * 
 * 公式推导：
 * - 原变换：screenX = pan.x + canvasX * zoom
 * - 直接使用：screenX = panX + canvasX * zoom
 */
export function canvasToScreen(
  canvasX: number,
  canvasY: number,
  panX: number,
  panY: number,
  zoom: number
): Point {
  return {
    x: panX + canvasX * zoom,
    y: panY + canvasY * zoom,
  };
}

/**
 * 屏幕坐标 → 画布坐标（用于判断点击位置）
 * 
 * 公式推导：
 * - 原变换：screenX = pan.x + canvasX * zoom
 * - 反推：  canvasX = (screenX - pan.x) / zoom
 */
export function screenToCanvas(
  screenX: number,
  screenY: number,
  panX: number,
  panY: number,
  zoom: number
): Point {
  const safeZoom = Math.max(SAFE_ZOOM_MIN, zoom);
  return {
    x: (screenX - panX) / safeZoom,
    y: (screenY - panY) / safeZoom,
  };
}

/**
 * 屏幕距离 → 画布距离（不受 pan 影响）
 */
export function screenToCanvasDistance(
  screenDistance: number,
  zoom: number
): number {
  return screenDistance / Math.max(SAFE_ZOOM_MIN, zoom);
}

/**
 * 画布距离 → 屏幕距离
 */
export function canvasToScreenDistance(
  canvasDistance: number,
  zoom: number
): number {
  return canvasDistance * zoom;
}
