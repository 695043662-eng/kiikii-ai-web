'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';

/**
 * ====== 非受控视口与世界坐标系模型 (Uncontrolled Viewport & World Space Model)
 * 
 * 这是 Figma、Miro 等顶级网页端画布的标准架构
 * 
 * 核心原则：
 * 1. 物理层与逻辑层彻底分离 - 高频事件不调用 setState
 * 2. 视口归一化 - 所有元素在一个统一容器
 * 3. 世界坐标系 - 内部元素坐标是绝对世界坐标
 * 4. 性能与渲染防抖 - 交互期间优化性能
 */

interface CanvasViewportProps {
  children: React.ReactNode;
  width?: number;
  height?: number;
  onPanChange?: (pan: { x: number; y: number }) => void;
  onZoomChange?: (zoom: number) => void;
}

export function CanvasViewport({ 
  children, 
  width = 8000, 
  height = 8000,
  onPanChange,
  onZoomChange
}: CanvasViewportProps) {
  // ====== Ref 状态管理 (Imperative State) ======
  // 所有实时状态都存在 Ref 中，不触发 React 重渲染
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const isDraggingRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const isSpacePressedRef = useRef(false);
  
  // 防抖定时器
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // React 状态（仅用于持久化和展示）
  const [panState, setPanState] = useState({ x: 0, y: 0 });
  const [zoomState, setZoomState] = useState(1);

  // ====== 坐标转换函数 (Coordinate Transformations) ======
  
  /**
   * 屏幕坐标转世界坐标
   * Screen -> World
   */
  const screenToWorld = useCallback((screenX: number, screenY: number) => {
    const worldX = (screenX - panRef.current.x) / zoomRef.current;
    const worldY = (screenY - panRef.current.y) / zoomRef.current;
    return { x: worldX, y: worldY };
  }, []);

  /**
   * 世界坐标转屏幕坐标
   * World -> Screen
   */
  const worldToScreen = useCallback((worldX: number, worldY: number) => {
    const screenX = worldX * zoomRef.current + panRef.current.x;
    const screenY = worldY * zoomRef.current + panRef.current.y;
    return { x: screenX, y: screenY };
  }, []);

  // ====== 视口更新函数 (Imperative Viewport Update) ======
  
  /**
   * 直接更新视口的 DOM transform，不触发 React 重渲染
   */
  const updateViewportTransform = useCallback(() => {
    if (!viewportRef.current) return;
    
    viewportRef.current.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoomRef.current})`;
  }, []);

  /**
   * 防抖更新 React 状态（仅用于持久化）
   */
  const debounceUpdateReactState = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      const newPan = { ...panRef.current };
      const newZoom = zoomRef.current;
      
      setPanState(newPan);
      setZoomState(newZoom);
      
      onPanChange?.(newPan);
      onZoomChange?.(newZoom);
    }, 2000); // 2秒后才更新 React 状态
  }, [onPanChange, onZoomChange]);

  // ====== 滚轮缩放 (Wheel Zoom) ======
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    
    if (!viewportRef.current) return;
    
    // 计算缩放中心（以鼠标位置为中心）
    const rect = viewportRef.current.parentElement?.getBoundingClientRect();
    if (!rect) return;
    
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // 鼠标位置在世界坐标系中的位置
    const worldMouse = screenToWorld(mouseX, mouseY);
    
    // 计算缩放因子
    const delta = -e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.01, Math.min(10, zoomRef.current * delta));
    
    // 调整 pan 以保持鼠标指向同一点在世界坐标系中的位置不变
    const newPanX = mouseX - worldMouse.x * newZoom;
    const newPanY = mouseY - worldMouse.y * newZoom;
    
    // 更新 Ref 状态
    zoomRef.current = newZoom;
    panRef.current = { x: newPanX, y: newPanY };
    
    // 立即更新 DOM
    updateViewportTransform();
    
    // 防抖更新 React 状态
    debounceUpdateReactState();
  }, [screenToWorld, updateViewportTransform, debounceUpdateReactState]);

  // ====== 空格拖拽 (Space + Drag) ======
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 只有按下空格或点击空白区域才开始拖拽画布
    if (!isSpacePressedRef.current) return;
    
    isDraggingRef.current = true;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    
    // 交互期间：禁用子元素 pointer-events，防止浏览器多余的 Layout 和 Paint
    if (viewportRef.current) {
      viewportRef.current.classList.add('pointer-events-none');
      viewportRef.current.classList.add('transition-none');
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    
    const dx = e.clientX - lastMousePosRef.current.x;
    const dy = e.clientY - lastMousePosRef.current.y;
    
    // 更新 Ref 状态
    panRef.current.x += dx;
    panRef.current.y += dy;
    
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    
    // 立即更新 DOM
    updateViewportTransform();
    
    // 防抖更新 React 状态
    debounceUpdateReactState();
  }, [updateViewportTransform, debounceUpdateReactState]);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    
    // 恢复子元素 pointer-events
    if (viewportRef.current) {
      viewportRef.current.classList.remove('pointer-events-none');
      viewportRef.current.classList.remove('transition-none');
    }
    
    // 拖拽结束后立即更新 React 状态
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    const newPan = { ...panRef.current };
    const newZoom = zoomRef.current;
    
    setPanState(newPan);
    setZoomState(newZoom);
    
    onPanChange?.(newPan);
    onZoomChange?.(newZoom);
  }, [onPanChange, onZoomChange]);

  // ====== 键盘事件监听 (Keydown/Keyup) ======
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        isSpacePressedRef.current = true;
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // ====== 清理定时器清理 ======
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <div 
      className="relative w-full h-full overflow-hidden bg-gray-100"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* ====== 统一的视口容器 ======
      {/* 所有子元素、网格、选框、图片等都放在这里 */}
      <div
        ref={viewportRef}
        className="absolute origin-top-left will-change-transform"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${panState.x}px, ${panState.y}px) scale(${zoomState})`,
        }}
      >
        {/* 背景网格 */}
        <div 
          className="absolute inset-0 bg-grid-pattern opacity-30" />
        
        {/* 子元素（图片、选框等） */}
        {children}
      </div>
      
      {/* ====== 浮动信息显示 ====== */}
      {/*
      <div className="absolute bottom-4 left-4 bg-black/50 text-white px-3 py-1 rounded text-sm pointer-events-none">
        Zoom: {Math.round(zoomState * 100)}% | Pan: ({Math.round(panState.x)}, {Math.round(panState.y)})
      </div>
      */}
      
      {/* ====== 空格拖拽提示 ====== */}
      {/*
      <div className="absolute top-4 left-4 bg-black/50 text-white px-3 py-1 rounded text-sm pointer-events-none">
        按住空格键 + 拖拽移动画布 | 滚轮缩放
      </div>
      */}
    </div>
  );
}

export default CanvasViewport;
