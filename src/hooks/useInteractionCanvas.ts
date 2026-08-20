/**
 * Canvas 交互层 Hook（方案 A：微创手术）
 * 
 * 特性：
 * - 高 DPI 支持（devicePixelRatio）
 * - requestAnimationFrame 批量绘制，防止绘制风暴
 * - 贝塞尔曲线绘制（与原 SVG generateBezierPathWithTransform 完全一致）
 * - pointer-events: none 事件穿透
 * 
 * #609 只替换 draftLineRef 拖拽连线，不动静态 SVG 连线
 * 
 * ⚠️ 军师铁律：
 * 1. 永远不要画永久连线！静态连线留在 SVG 里
 * 2. pointer-events: none 始终保持，不做动态切换
 * 3. Canvas 尺寸必须 = rect.width * dpr，否则线会糊
 */

'use client';

import { useRef, useCallback, useEffect } from 'react';

export function useInteractionCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const rafRef = useRef<number | null>(null);

  // ==================== 初始化 ====================
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    
    // ⚠️ 关键：物理像素尺寸 = CSS 尺寸 × DPR
    // 只要比例一错，Canvas 的线就会糊，那是物理常数
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    
    const ctx = canvas.getContext('2d', { 
      alpha: true,           // 透明背景
      desynchronized: true,  // 性能优化：减少与主线程同步
    });
    
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctxRef.current = ctx;
    }

    console.log('[InteractionCanvas] 初始化完成:', {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr,
      physicalWidth: canvas.width,
      physicalHeight: canvas.height,
    });

    // ==================== Resize 监听 ====================
    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      
      const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctxRef.current = ctx;
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // ==================== 清除画布 ====================
  const clear = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx && canvasRef.current) {
      // 使用 CSS 尺寸清除（因为已经 scale 过了）
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }, []);

  // ==================== 核心绘制方法 ====================
  
  /**
   * 绘制贝塞尔拖拽连线
   * 
   * 坐标系：使用屏幕坐标（与原 SVG generateBezierPathWithTransform 输出一致）
   * 
   * 贝塞尔控制点计算与 bezier-path.ts 完全一致：
   * - extendDistance = max(absDiffX * 0.4, 80)
   * - c1x = startX + extendDistance (right) / startX - extendDistance (left)
   * - c2x = endX - extendDistance (left) / endX + extendDistance (right)
   * - c1y = startY, c2y = endY
   * 
   * ⚠️ 注意：传入的坐标已经是屏幕坐标（由 generateBezierPathWithTransform 转换后的）
   * 但那个函数生成的是 SVG path 字符串，这里我们直接在 Canvas 上画贝塞尔
   * 所以需要重新计算控制点
   * 
   * @param startScreenX 起点屏幕 X（= startCanvasX * zoom + pan.x）
   * @param startScreenY 起点屏幕 Y
   * @param endScreenX 终点屏幕 X（= endCanvasX * zoom + pan.x）
   * @param endScreenY 终点屏幕 Y
   * @param startCanvasX 起点画布 X（用于计算控制点延伸距离）
   * @param startCanvasY 起点画布 Y
   * @param endCanvasX 终点画布 X
   * @param endCanvasY 终点画布 Y
   * @param zoom 当前缩放
   */
  const drawDraftLine = useCallback((
    startScreenX: number,
    startScreenY: number,
    endScreenX: number,
    endScreenY: number,
    startCanvasX: number,
    startCanvasY: number,
    endCanvasX: number,
    endCanvasY: number,
    zoom: number,
    panX: number,
    panY: number,
  ) => {
    // #60fps Phase4: 移除内部 rAF，直接绘制
    // 外层 handleMouseMove 已有 rAF 节流，无需双层 rAF 造成 1 帧延迟
    const ctx = ctxRef.current;
    if (!ctx) return;

    // 清除上一帧
    clear();

    // ====== 贝塞尔控制点（与 bezier-path.ts generateBezierPathWithTransform 完全一致）======
    const diffX = endCanvasX - startCanvasX;
    const absDiffX = Math.abs(diffX);
    
    // 👑 控制点延伸距离：使用画布坐标计算（不受 zoom 影响）
    const extendDistance = Math.max(absDiffX * 0.4, 80);
    
    // 👑 起点控制点：向右延伸（输出端口）
    const c1x_canvas = startCanvasX + extendDistance;
    const c1y_canvas = startCanvasY;
    
    // 👑 终点控制点：向左延伸（输入端口）
    const c2x_canvas = endCanvasX - extendDistance;
    const c2y_canvas = endCanvasY;
    
    // 👑 将控制点从画布坐标转换为屏幕坐标
    const c1x = c1x_canvas * zoom + panX;
    const c1y = c1y_canvas * zoom + panY;
    const c2x = c2x_canvas * zoom + panX;
    const c2y = c2y_canvas * zoom + panY;

    // ====== 层1：底层发光（对应 SVG draft-line-glow）======
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(startScreenX, startScreenY);
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, endScreenX, endScreenY);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 4;
    ctx.shadowColor = 'rgba(59, 130, 246, 0.6)';
    ctx.stroke();
    ctx.restore();

    // ====== 层2：主线条（对应 SVG draft-line-main）======
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(startScreenX, startScreenY);
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, endScreenX, endScreenY);
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 2;
    ctx.shadowColor = 'rgba(96, 165, 250, 0.5)';
    ctx.stroke();
    ctx.restore();
  }, [clear]);

  /**
   * 绘制磁吸端口高亮圆圈
   */
  const drawSnapHighlight = useCallback((
    screenX: number,
    screenY: number,
    radius: number = 10
  ) => {
    // 磁吸高亮在下一帧连线绘制时一起画，这里不做单独的 scheduleDraw
    const ctx = ctxRef.current;
    if (!ctx) return;

    ctx.save();
    ctx.beginPath();
    ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.5)';
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#3b82f6';
    ctx.fill();
    ctx.restore();
  }, []);

  return {
    canvasRef,
    clear,
    drawDraftLine,
    drawSnapHighlight,
  };
}

export type InteractionCanvas = ReturnType<typeof useInteractionCanvas>;
