'use client';

import React, { useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { generateBezierPath } from '@/lib/bezier-path';

// ========== 配置参数 ==========
const CONFIG = {
  taperLength: 500,      // 锥形长度（像素）
  taperWidth: 10,        // 粗细（像素）
  flowSpeed: 1000,       // 绝对速度：每秒移动 1000 像素（配合更短的锥形）
  pulseGap: 500,         // 脉冲间距（像素）- 初始12个脉冲
  brightness: 3.0,       // 亮度 300%
  color: '#60a5fa',      // C1 蓝色
  minSampleCount: 200,   // 最小采样点数
  maxSampleCount: 2000,  // 最大采样点数
};

// ========== 精灵贴图基准半径 ==========
const SPRITE_BASE_R = 10; // 精灵贴图的基准半径

// ========== 三层独立精灵贴图（懒加载，SSR兼容）==========
let outerSpriteCache: HTMLCanvasElement | null = null;  // 外层精灵（比例1.2）
let middleSpriteCache: HTMLCanvasElement | null = null; // 中层精灵（比例0.6）
let coreSpriteCache: HTMLCanvasElement | null = null;   // 主体精灵（比例1）

function getOuterSprite(): HTMLCanvasElement {
  if (outerSpriteCache) return outerSpriteCache;
  const canvas = document.createElement('canvas');
  const size = Math.ceil(SPRITE_BASE_R * 1.2 * 2) + 4; // 外层半径1.2倍
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return canvas;
  const center = size / 2;
  ctx.beginPath();
  ctx.arc(center, center, SPRITE_BASE_R * 1.2, 0, Math.PI * 2);
  ctx.fillStyle = CONFIG.color;
  ctx.globalAlpha = 1.0; // 透明度在绘制时设置
  ctx.fill();
  outerSpriteCache = canvas;
  return canvas;
}

function getMiddleSprite(): HTMLCanvasElement {
  if (middleSpriteCache) return middleSpriteCache;
  const canvas = document.createElement('canvas');
  const size = Math.ceil(SPRITE_BASE_R * 0.6 * 2) + 4; // 中层半径0.6倍
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return canvas;
  const center = size / 2;
  ctx.beginPath();
  ctx.arc(center, center, SPRITE_BASE_R * 0.6, 0, Math.PI * 2);
  ctx.fillStyle = CONFIG.color;
  ctx.globalAlpha = 1.0; // 透明度在绘制时设置
  ctx.fill();
  middleSpriteCache = canvas;
  return canvas;
}

function getCoreSprite(): HTMLCanvasElement {
  if (coreSpriteCache) return coreSpriteCache;
  const canvas = document.createElement('canvas');
  const size = Math.ceil(SPRITE_BASE_R * 1 * 2) + 4; // 主体半径1倍
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return canvas;
  const center = size / 2;
  ctx.beginPath();
  ctx.arc(center, center, SPRITE_BASE_R * 1, 0, Math.PI * 2);
  ctx.fillStyle = CONFIG.color;
  ctx.globalAlpha = 1.0; // 透明度在绘制时设置
  ctx.fill();
  coreSpriteCache = canvas;
  return canvas;
}

// ========== 头部光晕精灵贴图（7层，懒加载）==========
let headSpriteCache: HTMLCanvasElement | null = null;

function getHeadSprite(): HTMLCanvasElement {
  if (headSpriteCache) return headSpriteCache;
  const canvas = document.createElement('canvas');
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return canvas;
  const center = size / 2;
  const baseR = 10;

  const layers = [
    { r: baseR * 4, a: 0.06 },
    { r: baseR * 3, a: 0.1 },
    { r: baseR * 2.2, a: 0.18 },
    { r: baseR * 1.6, a: 0.28 },
    { r: baseR * 1, a: 0.4 },
    { r: baseR * 0.6, a: 0.55 },
    { r: baseR * 0.3, a: 0.7 },
  ];

  layers.forEach(l => {
    ctx.beginPath();
    ctx.arc(center, center, l.r, 0, Math.PI * 2);
    ctx.fillStyle = CONFIG.color;
    ctx.globalAlpha = l.a; // 头部光晕透明度固定
    ctx.fill();
  });

  headSpriteCache = canvas;
  return canvas;
}

// ========== 类型定义 ==========
export interface ConnectionPath {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface ConnectionPulseCanvasProps {
  connections: ConnectionPath[];
  isActive: boolean;
  zoom: number;
  panX: number;
  panY: number;
}

// ========== 贝塞尔曲线点计算（调用全局统一函数）==========
function getBezierPoints(startX: number, startY: number, endX: number, endY: number) {
  // 调用全局唯一的贝塞尔路径生成器，解析返回的控制点
  const pathD = generateBezierPath(startX, startY, endX, endY);
  // 解析 "M x y C c1x c1y, c2x c2y, endX endY"
  const match = pathD.match(/M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+)/);
  if (!match) {
    return {
      p0: { x: startX, y: startY },
      p1: { x: startX, y: startY },
      p2: { x: endX, y: endY },
      p3: { x: endX, y: endY },
    };
  }
  return {
    p0: { x: parseFloat(match[1]), y: parseFloat(match[2]) },
    p1: { x: parseFloat(match[3]), y: parseFloat(match[4]) },
    p2: { x: parseFloat(match[5]), y: parseFloat(match[6]) },
    p3: { x: parseFloat(match[7]), y: parseFloat(match[8]) },
  };
}

// ========== 预计算路径点（画布坐标）==========
function precomputePath(p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, sampleCount: number) {
  const path: { x: number; y: number }[] = [];
  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const mt = 1 - t;
    path.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return path;
}

// ========== 计算路径长度 ==========
function calculatePathLength(path: { x: number; y: number }[]) {
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

// ========== 画布坐标转视口坐标 ==========
function canvasToViewport(canvasX: number, canvasY: number, zoom: number, panX: number, panY: number) {
  return {
    x: canvasX * zoom + panX,
    y: canvasY * zoom + panY,
  };
}

// ========== 绘制能量脉冲（视口坐标）==========
function drawEnergyPulse(
  ctx: CanvasRenderingContext2D,
  path: { x: number; y: number }[],
  headIdx: number,
  pathLength: number,
  zoom: number,
  panX: number,
  panY: number,
  trailLength: number,
  viewportWidth: number,
  viewportHeight: number
) {
  const trailRatio = trailLength / pathLength;
  const tailIdx = Math.max(0, headIdx - Math.floor(trailRatio * path.length));
  
  const endIdx = path.length - 1;
  const actualTailIdx = tailIdx;
  const actualHeadIdx = Math.min(headIdx, endIdx);
  
  if (actualHeadIdx <= actualTailIdx) return;
  
  const trailAlpha = CONFIG.brightness;
  const actualTrailCount = actualHeadIdx - actualTailIdx;
  const scaledTaperWidth = CONFIG.taperWidth * zoom;

  // ====== 军师死命令：step = 1，绝不跳步 ======
  const step = 1;

  // ====== 精灵缩放比例：实际半径 / 精灵基准半径 ======
  const spriteScale = (actualRadius: number) => actualRadius / SPRITE_BASE_R;

  // 1. 外层大圆（发光扩散）- 使用精灵贴图
  if (actualTrailCount > 5) {
    for (let i = 0; i < actualTrailCount; i += step) {
      const idx = actualTailIdx + i;
      
      if (idx >= path.length) break;
      const pt = path[idx];
      if (!pt) continue;
      
      const vp = canvasToViewport(pt.x, pt.y, zoom, panX, panY);
      
      if (vp.x < -100 || vp.x > viewportWidth + 100 || vp.y < -100 || vp.y > viewportHeight + 100) {
        continue;
      }
      
      const prog = i / Math.max(1, actualTrailCount - 1);
      const radius = (0.5 + prog * scaledTaperWidth * 0.5) * 1.2;
      const alpha = Math.min(1, (0.04 + prog * 0.04) * trailAlpha);
      
      // 使用精灵贴图替代 arc
      const drawSize = radius * 2;
      ctx.globalAlpha = alpha;
      ctx.drawImage(getOuterSprite(), vp.x - drawSize / 2, vp.y - drawSize / 2, drawSize, drawSize);
    }
    
    // 2. 中层圆 - 使用精灵贴图
    for (let i = 0; i < actualTrailCount; i += step) {
      const idx = actualTailIdx + i;
      
      if (idx >= path.length) break;
      const pt = path[idx];
      if (!pt) continue;
      
      const vp = canvasToViewport(pt.x, pt.y, zoom, panX, panY);
      
      if (vp.x < -100 || vp.x > viewportWidth + 100 || vp.y < -100 || vp.y > viewportHeight + 100) {
        continue;
      }
      
      const prog = i / Math.max(1, actualTrailCount - 1);
      const radius = (0.5 + prog * scaledTaperWidth * 0.5) * 0.6;
      const alpha = Math.min(1, (0.08 + prog * 0.08) * trailAlpha);
      
      // 使用精灵贴图替代 arc
      const drawSize = radius * 2;
      ctx.globalAlpha = alpha;
      ctx.drawImage(getMiddleSprite(), vp.x - drawSize / 2, vp.y - drawSize / 2, drawSize, drawSize);
    }
  }

  // 3. 圆点序列（主体，头粗尾细）- 使用精灵贴图
  for (let i = 0; i < actualTrailCount; i += step) {
    const idx = actualTailIdx + i;
    
    if (idx >= path.length) break;
    const pt = path[idx];
    if (!pt) continue;
    
    const vp = canvasToViewport(pt.x, pt.y, zoom, panX, panY);
    
    if (vp.x < -100 || vp.x > viewportWidth + 100 || vp.y < -100 || vp.y > viewportHeight + 100) {
      continue;
    }
    
    const prog = i / Math.max(1, actualTrailCount - 1);
    const radius = 0.5 + prog * scaledTaperWidth * 0.5;
    const alpha = Math.min(1, (0.5 + prog * 0.5) * trailAlpha);
    
    // 使用精灵贴图替代 arc
    const drawSize = radius * 2;
    ctx.globalAlpha = alpha;
    ctx.drawImage(getCoreSprite(), vp.x - drawSize / 2, vp.y - drawSize / 2, drawSize, drawSize);
  }

  // 4. 头部光晕 - 使用精灵贴图
  if (headIdx <= endIdx && headIdx < path.length) {
    const headPt = path[headIdx];
    if (headPt) {
      const hp = canvasToViewport(headPt.x, headPt.y, zoom, panX, panY);
      
      if (hp.x >= -100 && hp.x <= viewportWidth + 100 && hp.y >= -100 && hp.y <= viewportHeight + 100) {
        const baseR = scaledTaperWidth * 0.12;
        
        // 头部光晕绘制尺寸：最大层是 baseR * 4
        const headDrawSize = baseR * 2 * 4.5; // 略大于最大层，确保完全覆盖
        
        ctx.globalAlpha = trailAlpha;
        ctx.drawImage(getHeadSprite(), hp.x - headDrawSize / 2, hp.y - headDrawSize / 2, headDrawSize, headDrawSize);
      }
    }
  }

  ctx.globalAlpha = 1;
}

// ========== 主组件 ==========
export default function ConnectionPulseCanvas({
  connections,
  isActive,
  zoom,
  panX,
  panY,
}: ConnectionPulseCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pathsDataRef = useRef<{
    path: { x: number; y: number }[];
    pathLength: number;
  }[]>([]);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const viewportSizeRef = useRef({ width: 1200, height: 800 });

  // ====== 修复一：使用 useRef 隔离变换参数 ======
  const transformRef = useRef({ zoom, panX, panY });

  // 只要参数变了，只更新 Ref，不触发任何组件重渲染和 useEffect 重新执行
  useEffect(() => {
    transformRef.current = { zoom, panX, panY };
  }, [zoom, panX, panY]);

  // 更新视口尺寸
  useEffect(() => {
    const updateViewportSize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        viewportSizeRef.current = { width, height };
      }
    };

    updateViewportSize();
    window.addEventListener('resize', updateViewportSize);
    return () => window.removeEventListener('resize', updateViewportSize);
  }, []);

  // 👑 军师优化 1：生成坐标指纹，避免无意义的重计算
  const connectionsHash = connections
    .map(c => `${c.id}-${Math.round(c.startX)}-${Math.round(c.startY)}-${Math.round(c.endX)}-${Math.round(c.endY)}`)
    .join('|');

  // 👑 军师优化 2：改用 useLayoutEffect，确保在动画开跑前，数据绝对是最新的！
  useLayoutEffect(() => {
    // 如果没有连线，直接清空旧数据，防止诈尸
    if (connections.length === 0) {
      pathsDataRef.current = [];
      return;
    }

    pathsDataRef.current = connections.map(conn => {
      const { p0, p1, p2, p3 } = getBezierPoints(conn.startX, conn.startY, conn.endX, conn.endY);
      
      // 先用最小采样数粗略计算路径长度
      const tempPath = precomputePath(p0, p1, p2, p3, CONFIG.minSampleCount);
      const tempPathLength = calculatePathLength(tempPath);
      
      // 根据路径长度动态计算采样数：每像素约 1 个点
      const dynamicSampleCount = Math.min(
        CONFIG.maxSampleCount,
        Math.max(CONFIG.minSampleCount, Math.floor(tempPathLength))
      );
      
      // 用动态采样数重新采样
      const path = precomputePath(p0, p1, p2, p3, dynamicSampleCount);
      const pathLength = calculatePathLength(path);
      
      return { path, pathLength };
    });
  }, [connectionsHash]); // 👈 仅当真实物理坐标改变时才重新算

  // ====== 修复一：animate 依赖数组只保留 [isActive] ======
  const animate = useCallback((currentTime: number) => {
    if (!isActive || pathsDataRef.current.length === 0) {
      animationRef.current = null;
      startTimeRef.current = null;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) return;

    // 从 Ref 中动态读取最新的缩放和平移值
    const { zoom, panX, panY } = transformRef.current;

    if (startTimeRef.current === null) {
      startTimeRef.current = currentTime;
    }
    const elapsed = (currentTime - startTimeRef.current) / 1000;

    ctx.clearRect(0, 0, viewportSizeRef.current.width, viewportSizeRef.current.height);

    pathsDataRef.current.forEach((pathData) => {
      const { path, pathLength } = pathData;
      const speed = CONFIG.flowSpeed;
      const interval = CONFIG.taperLength + CONFIG.pulseGap;
      const currentPos = (elapsed * speed) % interval;
      
      for (let pos = currentPos; pos < pathLength + CONFIG.taperLength; pos += interval) {
        const progress = pos / pathLength;
        const headIdx = Math.floor(progress * path.length);
        drawEnergyPulse(
          ctx, 
          path, 
          headIdx, 
          pathLength, 
          zoom, 
          panX, 
          panY, 
          CONFIG.taperLength,
          viewportSizeRef.current.width,
          viewportSizeRef.current.height
        );
      }
    });

    animationRef.current = requestAnimationFrame(animate);
  }, [isActive]); // 只依赖 isActive，zoom/panX/panY 通过 ref 读取

  // 启动/停止动画
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: true, desynchronized: true });

    if (isActive && connections.length > 0) {
      // 唤醒：重置时间，开跑！
      startTimeRef.current = null;
      animationRef.current = requestAnimationFrame(animate);
    } else {
      // 休眠：停止动画，并且【立刻擦除旧画布】，绝不留旧帧！
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
        startTimeRef.current = null;
      }
      
      // 👑 军师优化 3：无论是否有动画运行，都要清空画布，防止旧帧残留
      if (ctx && viewportSizeRef.current) {
        ctx.clearRect(0, 0, viewportSizeRef.current.width, viewportSizeRef.current.height);
      }
    }

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isActive, connections.length, animate]);

  const isVisible = isActive && connections.length > 0;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 1000,
        visibility: isVisible ? 'visible' : 'hidden',
        // #610 终结手术：删除 willChange 和 translateZ(0)
        // ❌ 在 scale 容器内会触发 CPU 图片重栅格化（混合合成陷阱）
        // ✅ Canvas 回归纯 2D 渲染
      }}
    />
  );
}
