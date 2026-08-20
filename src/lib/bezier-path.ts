/**
 * 全局贝塞尔曲线生成器
 * 所有连线（拖拽中的临时线、永久连线）都必须使用此函数，确保视觉一致性
 * 
 * @param startX 起点X坐标
 * @param startY 起点Y坐标
 * @param endX 终点X坐标
 * @param endY 终点Y坐标
 * @param startDirection 起点初始方向（'right'=输出端口向右, 'left'=输入端口向左），默认 'right'
 * @param endDirection 终点方向（'left'=输入端口向左, 'right'=输出端口向右），默认 'left'
 * @returns 贝塞尔曲线路径字符串
 */
export function generateBezierPath(
  startX: number, 
  startY: number, 
  endX: number, 
  endY: number,
  startDirection: 'right' | 'left' = 'right',
  endDirection: 'left' | 'right' = 'left'
): string {
  const diffX = endX - startX;
  const absDiffX = Math.abs(diffX);
  
  // 👑 控制点延伸距离：基于距离动态计算
  const extendDistance = Math.max(absDiffX * 0.4, 80);
  
  let c1x: number, c1y: number, c2x: number, c2y: number;
  
  // 👑 起点控制点：向固定方向延伸（不跟随终点位置）
  if (startDirection === 'right') {
    c1x = startX + extendDistance;
  } else {
    c1x = startX - extendDistance;
  }
  c1y = startY;
  
  // 👑 终点控制点：向固定方向延伸（不跟随起点位置）
  // 输入端口（左侧）向左延伸，输出端口（右侧）向右延伸
  if (endDirection === 'left') {
    c2x = endX - extendDistance;
  } else {
    c2x = endX + extendDistance;
  }
  c2y = endY;
  
  return `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`;
}

/**
 * 带坐标转换的贝塞尔曲线生成器（用于拉线场景）
 * 
 * @param startCanvasX 起点画布X坐标
 * @param startCanvasY 起点画布Y坐标
 * @param endCanvasX 终点画布X坐标
 * @param endCanvasY 终点画布Y坐标
 * @param zoom 缩放比例
 * @param panX X轴偏移
 * @param panY Y轴偏移
 * @param startDirection 起点初始方向，默认 'right'
 * @param endDirection 终点方向，默认 'left'
 * @returns 屏幕坐标的贝塞尔曲线路径字符串
 */
export function generateBezierPathWithTransform(
  startCanvasX: number, 
  startCanvasY: number, 
  endCanvasX: number, 
  endCanvasY: number,
  zoom: number,
  panX: number,
  panY: number,
  startDirection: 'right' | 'left' = 'right',
  endDirection: 'left' | 'right' = 'left'
): string {
  const diffX = endCanvasX - startCanvasX;
  const absDiffX = Math.abs(diffX);
  
  // 👑 控制点延伸距离：使用画布坐标计算（不受 zoom 影响）
  const extendDistance = Math.max(absDiffX * 0.4, 80);
  
  // 👑 计算画布坐标下的控制点
  let c1x: number, c1y: number, c2x: number, c2y: number;
  
  if (startDirection === 'right') {
    c1x = startCanvasX + extendDistance;
  } else {
    c1x = startCanvasX - extendDistance;
  }
  c1y = startCanvasY;
  
  if (endDirection === 'left') {
    c2x = endCanvasX - extendDistance;
  } else {
    c2x = endCanvasX + extendDistance;
  }
  c2y = endCanvasY;
  
  // 👑 将所有坐标转换为屏幕坐标
  const screenStartX = startCanvasX * zoom + panX;
  const screenStartY = startCanvasY * zoom + panY;
  const screenC1x = c1x * zoom + panX;
  const screenC1y = c1y * zoom + panY;
  const screenC2x = c2x * zoom + panX;
  const screenC2y = c2y * zoom + panY;
  const screenEndX = endCanvasX * zoom + panX;
  const screenEndY = endCanvasY * zoom + panY;
  
  return `M ${screenStartX} ${screenStartY} C ${screenC1x} ${screenC1y}, ${screenC2x} ${screenC2y}, ${screenEndX} ${screenEndY}`;
}

/**
 * 获取贝塞尔曲线的控制点（用于脉冲动画）
 * 
 * @param startX 起点X坐标
 * @param startY 起点Y坐标
 * @param endX 终点X坐标
 * @param endY 终点Y坐标
 * @param startDirection 起点初始方向（'right'=输出端口向右, 'left'=输入端口向左），默认 'right'
 * @param endDirection 终点方向（'left'=输入端口向左, 'right'=输出端口向右），默认 'left'
 * @returns 四个控制点的坐标
 */
export function getBezierControlPoints(
  startX: number, 
  startY: number, 
  endX: number, 
  endY: number,
  startDirection: 'right' | 'left' = 'right',
  endDirection: 'left' | 'right' = 'left'
): { p0: { x: number; y: number }; p1: { x: number; y: number }; p2: { x: number; y: number }; p3: { x: number; y: number } } {
  const diffX = endX - startX;
  const absDiffX = Math.abs(diffX);
  
  // 👑 控制点延伸距离
  const extendDistance = Math.max(absDiffX * 0.4, 80);
  
  let c1x: number, c1y: number, c2x: number, c2y: number;
  
  // 👑 起点控制点：向固定方向延伸
  if (startDirection === 'right') {
    c1x = startX + extendDistance;
  } else {
    c1x = startX - extendDistance;
  }
  c1y = startY;
  
  // 👑 终点控制点：向固定方向延伸
  if (endDirection === 'left') {
    c2x = endX - extendDistance;
  } else {
    c2x = endX + extendDistance;
  }
  c2y = endY;
  
  return {
    p0: { x: startX, y: startY },
    p1: { x: c1x, y: c1y },
    p2: { x: c2x, y: c2y },
    p3: { x: endX, y: endY },
  };
}
