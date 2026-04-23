'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Canvas as FabricCanvas, IText, FabricObject, ActiveSelection } from 'fabric';
import { CanvasElement } from '@/types/canvas';

// 全局标志：追踪 Fabric.js 是否正在拖动对象
export const fabricDraggingFlag = {
  isDragging: false,
  dragStartTime: 0,
};

interface FabricTextLayerProps {
  elements: CanvasElement[];
  selectedIds: string[];
  zoom: number;
  pan: { x: number; y: number };
  containerRef: React.RefObject<HTMLDivElement | null>;
  onUpdateElement: (id: string, updates: Partial<CanvasElement>) => void;
  onSelectElement: (id: string, multi?: boolean) => void;
  onAddElement: (element: Omit<CanvasElement, 'id'>) => string;
  onClearSelection: () => void;
  activeTool: string;
  onCanvasClick?: (canvasX: number, canvasY: number, isShiftKey: boolean) => void;
  onSwitchToSelect?: () => void; // 创建文字后切换到选择工具
  onContextMenu?: (e: MouseEvent) => void; // 右键菜单回调
  isGridSelectMode?: boolean; // 从画布添加模式（双击选择图片）
  isCropping?: boolean; // 裁剪模式
}

export default function FabricTextLayer({
  elements,
  selectedIds,
  zoom,
  pan,
  containerRef,
  onUpdateElement,
  onSelectElement,
  onAddElement,
  onClearSelection,
  activeTool,
  onCanvasClick,
  onSwitchToSelect,
  onContextMenu,
  isGridSelectMode,
  isCropping,
}: FabricTextLayerProps) {
  const fabricRef = useRef<FabricCanvas | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const textObjectsRef = useRef<Map<string, IText>>(new Map());
  const isUpdatingFromReact = useRef(false);
  const isUpdatingFromFabric = useRef(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  
  // 防止重复创建文字的标志
  const isCreatingTextRef = useRef(false);
  
  // 使用 ref 存储最新的值，避免闭包问题
  const activeToolRef = useRef(activeTool);
  const onAddElementRef = useRef(onAddElement);
  const onContextMenuRef = useRef(onContextMenu);
  activeToolRef.current = activeTool;
  onAddElementRef.current = onAddElement;
  onContextMenuRef.current = onContextMenu;

  // 全局标志，用于父容器判断 Fabric.js 是否正在处理事件
  const isFabricHandlingRef = useRef(false);
  
  // 暴露标志给父容器
  useEffect(() => {
    (window as any).__fabricIsHandling = isFabricHandlingRef;
    
    // 添加全局 mouseup 监听器，确保标志被重置
    const handleGlobalMouseUp = () => {
      isFabricHandlingRef.current = false;
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      delete (window as any).__fabricIsHandling;
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  // 初始化 Fabric Canvas
  useEffect(() => {
    if (!canvasElRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    setCanvasSize({ width: rect.width, height: rect.height });

    const canvas = new FabricCanvas(canvasElRef.current, {
      width: rect.width,
      height: rect.height,
      backgroundColor: 'transparent',
      selection: false, // 禁用 Fabric.js 的选择区域，使用父容器的框选功能
      preserveObjectStacking: true,
      // 设置选择框样式为透明，避免拖动图片时出现蓝色区域
      selectionColor: 'rgba(0, 0, 0, 0)',
      selectionBorderColor: 'rgba(0, 0, 0, 0)',
      selectionLineWidth: 0,
    });
    
    // #044 性能优化：禁用自动重绘，减少渲染开销
    canvas.renderOnAddRemove = false;

    // 设置 Fabric.js 创建的容器包装器样式，确保它始终填充父容器
    // 并添加右键菜单事件监听，让事件能冒泡到父容器的 React 合成事件处理器
    const canvasContainer = canvasElRef.current.parentElement;
    if (canvasContainer) {
      // 确保容器正确填充父容器
      // 🔥 关键：在 isGridSelectMode 或 isCropping 时禁用整个容器的 pointerEvents
      const shouldReceiveEvents = (activeTool === 'select' || activeTool === 'text') && !isGridSelectMode && !isCropping;
      Object.assign((canvasContainer as HTMLDivElement).style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: shouldReceiveEvents ? 'auto' : 'none',
      });
      // #044 性能优化：删除日志
      
      // 给 canvas-container 添加右键菜单事件监听，调用父组件传递的回调
      const handleContainerContextMenu = (e: Event) => {
        e.preventDefault();
        // 调用父组件传递的回调函数（使用 ref 获取最新回调）
        if (onContextMenuRef.current) {
          onContextMenuRef.current(e as MouseEvent);
        }
      };
      canvasContainer.addEventListener('contextmenu', handleContainerContextMenu);
    }

    // 禁用 Fabric.js 自动添加的 draggable 属性
    // Fabric.js 会给 upper-canvas 设置 draggable="true"，导致拖拽问题
    const upperCanvas = canvasElRef.current.parentElement?.querySelector('.upper-canvas');
    if (upperCanvas) {
      upperCanvas.setAttribute('draggable', 'false');
      
      // 🔥 关键：设置 upper-canvas 的 pointerEvents
      // 只有在选择工具和文字工具时才接收事件
      // 从画布添加模式或裁剪模式下禁用事件，让点击穿透到图片元素
      const shouldReceiveEvents = (activeTool === 'select' || activeTool === 'text') && !isGridSelectMode && !isCropping;
      Object.assign((upperCanvas as HTMLCanvasElement).style, {
        userSelect: 'none',
        webkitUserSelect: 'none',
        pointerEvents: shouldReceiveEvents ? 'auto' : 'none',
      });
      
      // 添加事件监听器，阻止点击工具栏时触发 Fabric.js 事件
      const handleMouseDown = (e: Event) => {
        const mouseEvent = e as MouseEvent;
        // #043 性能优化：删除高频日志
        const clickX = mouseEvent.clientX;
        const clickY = mouseEvent.clientY;

        // 检测裁剪框区域 - 如果点击在裁剪框触发区域内，阻止事件传播
        const cropHandles = document.querySelectorAll('[data-crop-handle="true"]');
        for (const handle of cropHandles) {
          const handleRect = handle.getBoundingClientRect();
          if (clickX >= handleRect.left && clickX <= handleRect.right &&
              clickY >= handleRect.top && clickY <= handleRect.bottom) {
            // #043 性能优化：删除高频日志
            e.stopPropagation();
            e.preventDefault();
            return;
          }
        }

        // 检测工具栏区域
        const toolbar = document.querySelector('[data-text-toolbar="true"]');
        if (toolbar) {
          const toolbarRect = toolbar.getBoundingClientRect();
          // 如果点击在工具栏区域内，阻止事件
          if (clickX >= toolbarRect.left && clickX <= toolbarRect.right &&
              clickY >= toolbarRect.top && clickY <= toolbarRect.bottom) {
            // #043 性能优化：删除高频日志
            e.stopPropagation();
            e.preventDefault();
          }
        }
      };
      upperCanvas.addEventListener('mousedown', handleMouseDown, true); // 使用捕获阶段
      
      // 添加右键菜单事件监听，让事件冒泡到父容器
      const handleContextMenu = (e: Event) => {
        // 阻止浏览器默认行为
        e.preventDefault();
        // 手动调用父组件传递的回调函数
        if (onContextMenuRef.current) {
          onContextMenuRef.current(e as MouseEvent);
        }
        // 不调用 stopPropagation，让事件继续冒泡
      };
      upperCanvas.addEventListener('contextmenu', handleContextMenu);
    }

    // 配置默认样式
    canvas.on('selection:created', (e: any) => {
      if (isUpdatingFromReact.current) return;
      const obj = e.selected?.[0];
      if (obj && obj.elementId) {
        // 设置标志，防止 useEffect 中的选中状态更新干扰
        isUpdatingFromFabric.current = true;
        onSelectElement(obj.elementId, false);
        setTimeout(() => {
          isUpdatingFromFabric.current = false;
        }, 50);
      }
    });

    canvas.on('selection:updated', (e: any) => {
      if (isUpdatingFromReact.current) return;
      const obj = e.selected?.[0];
      if (obj && obj.elementId) {
        // 设置标志，防止 useEffect 中的选中状态更新干扰
        isUpdatingFromFabric.current = true;
        onSelectElement(obj.elementId, false);
        setTimeout(() => {
          isUpdatingFromFabric.current = false;
        }, 50);
      }
    });

    canvas.on('selection:cleared', (e: any) => {
      if (isUpdatingFromReact.current) return;
      
      // 检查是否点击了文字工具栏
      // 工具栏是 fixed 定位，点击工具栏时不应清除选中状态
      const mouseEvent = e?.e;
      if (mouseEvent) {
        const toolbar = document.querySelector('[data-text-toolbar="true"]');
        if (toolbar) {
          const toolbarRect = toolbar.getBoundingClientRect();
          const clickX = mouseEvent.clientX;
          const clickY = mouseEvent.clientY;
          
          // 如果点击在工具栏区域内，不清除选中状态
          if (clickX >= toolbarRect.left && clickX <= toolbarRect.right &&
              clickY >= toolbarRect.top && clickY <= toolbarRect.bottom) {
            // 从 elements 中找到当前选中的文字对象
            const selectedTextElement = elements.find(el => 
              selectedIds.includes(el.id) && el.type === 'text'
            );
            if (selectedTextElement) {
              const textObj = textObjectsRef.current.get(selectedTextElement.id);
              if (textObj) {
                canvas.setActiveObject(textObj);
                canvas.renderAll();
              }
            }
            return;
          }
        }
      }
      
      onClearSelection();
    });

    // 对象修改事件（拖动、缩放后保存）
    canvas.on('object:modified', (e: any) => {
      if (isUpdatingFromReact.current) return;
      const obj = e.target;
      if (obj && obj.elementId) {
        // 保持标志为 true，防止 useEffect 中的状态更新干扰
        isUpdatingFromFabric.current = true;
        
        const elementId = obj.elementId;
        const textObj = obj as IText;
        const newFontSize = Math.round((textObj.fontSize ?? 24) * (textObj.scaleX ?? 1));
        
        const updates: Partial<CanvasElement> = {
          x: obj.left ?? 0,
          y: obj.top ?? 0,
          fontSize: newFontSize,
        };
        
        // 计算新的尺寸
        const text = textObj.text ?? '';
        const charWidth = newFontSize * 0.6;
        const lines = text.split('\n');
        const maxLineLength = Math.max(...lines.map((l: string) => l.length), text.length || 1);
        updates.width = Math.max(maxLineLength * charWidth + 16, 50);
        updates.height = Math.max(lines.length * newFontSize * 1.4 + 8, newFontSize * 1.4 + 8);
        
        onUpdateElement(elementId, updates);
        
        // 重置缩放，因为字号已经改变
        obj.set({ scaleX: 1, scaleY: 1 });
        canvas.renderAll();
        
        // 延迟重置，确保所有 React 更新完成
        setTimeout(() => {
          isUpdatingFromFabric.current = false;
        }, 150);
      }
    });

    // 对象移动事件 - 设置标志防止干扰
    canvas.on('object:moving', (e: any) => {
      if (isUpdatingFromReact.current) return;
      const obj = e.target;
      if (obj && obj.elementId) {
        // 彻底阻止事件传播到父容器
        if (e.e && e.e.stopImmediatePropagation) {
          e.e.stopImmediatePropagation();
        } else if (e.e) {
          e.e.stopPropagation();
        }
        // 设置标志，防止 useEffect 中的状态更新干扰
        isUpdatingFromFabric.current = true;
      }
    });

    // 鼠标移动事件 - 阻止冒泡当有对象被选中时
    canvas.on('mouse:move', (e: any) => {
      const activeObject = canvas.getActiveObject();
      if (activeObject && (activeObject as any).elementId) {
        // 有文字元素被选中，彻底阻止事件传播
        if (e.e && e.e.stopImmediatePropagation) {
          e.e.stopImmediatePropagation();
        } else if (e.e) {
          e.e.stopPropagation();
        }
      }
    });

    // 鼠标释放事件 - 重置标志
    canvas.on('mouse:up', (e: any) => {
      // 重置拖动标志
      fabricDraggingFlag.isDragging = false;
      fabricDraggingFlag.dragStartTime = 0;
      
      // 重置 Fabric.js 处理标志
      isFabricHandlingRef.current = false;
      
      if (isUpdatingFromFabric.current) {
        setTimeout(() => {
          isUpdatingFromFabric.current = false;
        }, 50);
      }
    });

    // 文字编辑完成事件
    canvas.on('text:editing:exited', (e: any) => {
      if (isUpdatingFromReact.current) return;
      const obj = e.target as IText;
      if (obj && (obj as any).elementId) {
        isUpdatingFromFabric.current = true;
        
        // 注意：不要在这里重置 isCreatingTextRef
        // 因为 onSwitchToSelect() 是异步的，activeTool 还没更新
        // 应该在 useEffect 中监听 activeTool 变化时重置
        
        const elementId = (obj as any).elementId;
        const text = obj.text ?? '';
        const fontSize = obj.fontSize ?? 24;
        const charWidth = fontSize * 0.6;
        const lines = text.split('\n');
        const maxLineLength = Math.max(...lines.map((l: string) => l.length), text.length || 1);
        
        onUpdateElement(elementId, {
          textContent: text,
          width: Math.max(maxLineLength * charWidth + 16, 50),
          height: Math.max(lines.length * fontSize * 1.4 + 8, fontSize * 1.4 + 8),
        });
        
        // 编辑完成后切换回选择工具
        if (onSwitchToSelect) {
          onSwitchToSelect();
        }
        
        setTimeout(() => {
          isUpdatingFromFabric.current = false;
        }, 50);
      }
    });

    // 双击文字进入编辑模式
    canvas.on('mouse:dblclick', (e: any) => {
      const obj = e.target;
      if (obj && obj.elementId && obj.type === 'i-text') {
        // 双击文字对象进入编辑模式
        canvas.setActiveObject(obj);
        (obj as IText).enterEditing();
        (obj as IText).selectAll();
        canvas.renderAll();
      }
    });

    // 点击空白区域创建新文字（当文字工具激活时）
    canvas.on('mouse:down', (e: any) => {
      // 忽略右键点击
      if (e.e && e.e.button === 2) {
        return;
      }
      
      // 如果正在创建文字，跳过
      if (isCreatingTextRef.current) {
        return;
      }
      
      // 如果点击的是已有对象（文字元素），设置拖动标志
      if (e.target) {
        fabricDraggingFlag.isDragging = true;
        fabricDraggingFlag.dragStartTime = Date.now();
        return;
      }
      
      // 检查是否有文字正在编辑中
      const activeObject = canvas.getActiveObject();
      if (activeObject && (activeObject as any).isEditing) {
        return;
      }
      
      // 文字工具模式：创建新文字
      if (activeToolRef.current === 'text') {
        if (e.e) {
          e.e.stopPropagation();
        }
        
        const viewportPoint = canvas.getViewportPoint(e.e);
        const vpt = canvas.viewportTransform;
        const canvasX = (viewportPoint.x - vpt[4]) / vpt[0];
        const canvasY = (viewportPoint.y - vpt[5]) / vpt[3];
        
        isCreatingTextRef.current = true;
        
        const id = onAddElementRef.current({
          type: 'text',
          name: '文字',
          x: canvasX,
          y: canvasY,
          width: 100,
          height: 42,
          rotation: 0,
          fill: 'transparent',
          stroke: 'transparent',
          strokeWidth: 0,
          opacity: 1,
          visible: true,
          locked: false,
          textContent: '',
          fontSize: 24,
          fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
          color: '#000000',
        });

        setTimeout(() => {
          const textObj = textObjectsRef.current.get(id);
          if (textObj && canvas) {
            canvas.setActiveObject(textObj);
            textObj.enterEditing();
            textObj.selectAll();
            canvas.renderAll();
          }
        }, 100);
        return;
      }
      
      // 选择工具模式：不在这里启动框选
      // 父容器的 handleMouseDown 已经处理了所有情况
      // 点击文字元素 → Fabric.js 处理
      // 点击其他元素 → 父容器设置 isDragging
      // 点击空白区域 → 父容器设置 isSelecting
    });

    fabricRef.current = canvas;
    // 暴露 Fabric.js canvas 到 window，供外部获取文字对象实际坐标
    (window as any).__fabricCanvas = canvas;

    // 监听容器大小变化
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasSize({ width, height });
        // 使用 setDimensions 确保同时更新 lower-canvas 和 upper-canvas 的尺寸
        canvas.setDimensions({ width, height });
        canvas.renderAll();
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      canvas.dispose();
      fabricRef.current = null;
      delete (window as any).__fabricCanvas;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 同步 React 状态到 Fabric（文字元素）
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // 如果正在从 Fabric 更新，跳过同步但确保状态正确
    if (isUpdatingFromFabric.current) {
      // 不做任何操作，让 Fabric 的更新完成
      return;
    }

    // 设置标志，防止 Fabric 事件触发循环更新
    isUpdatingFromReact.current = true;

    // 获取所有文字元素
    const textElements = elements.filter(el => el.type === 'text');
    const currentIds = new Set(textElements.map(el => el.id));

    // 移除不存在的文字对象
    textObjectsRef.current.forEach((obj, id) => {
      if (!currentIds.has(id)) {
        canvas.remove(obj);
        textObjectsRef.current.delete(id);
      }
    });

    // 更新或创建文字对象
    textElements.forEach((el) => {
      let textObj = textObjectsRef.current.get(el.id);
      
      if (!textObj) {
        // 创建新的 IText 对象
        textObj = new IText(el.textContent || '双击编辑', {
          left: el.x,
          top: el.y,
          fontSize: el.fontSize || 24,
          fontFamily: el.fontFamily || 'PingFang SC, Microsoft YaHei, sans-serif',
          fill: el.color || '#000000',
          opacity: el.opacity ?? 1,
          angle: el.rotation || 0,
          // 文字样式
          fontWeight: el.fontWeight || 'normal',
          fontStyle: el.fontStyle || 'normal',
          underline: el.textDecoration === 'underline',
          linethrough: el.textDecoration === 'line-through',
          textAlign: el.textAlign || 'left',
          lineHeight: el.lineHeight || 1.2,
          charSpacing: (el.charSpacing ?? 20) * 10, // Fabric.js 使用 1/1000 em，默认 200 (= 0.2em)
          textBackgroundColor: el.textBackgroundColor || undefined,
          borderColor: '#007AFF',
          cornerColor: '#007AFF',
          cornerSize: 12,
          cornerStyle: 'circle' as const,
          transparentCorners: false,
          borderScaleFactor: 2,
        });
        
        (textObj as any).elementId = el.id;
        canvas.add(textObj);
        textObjectsRef.current.set(el.id, textObj);
      } else {
        // 检查是否正在编辑中
        const isEditing = textObj.isEditing;
        
        // 检查字号是否变化
        const oldFontSize = textObj.fontSize || 24;
        const newFontSize = el.fontSize || 24;
        const fontSizeChanged = oldFontSize !== newFontSize;
        
        // 更新现有对象
        // 如果正在编辑中，不要更新 text 属性，否则会覆盖用户正在输入的内容
        const updates: any = {
          fontSize: newFontSize,
          fontFamily: el.fontFamily || 'PingFang SC, Microsoft YaHei, sans-serif',
          fill: el.color || '#000000',
          opacity: el.opacity ?? 1,
          angle: el.rotation || 0,
          // 文字样式
          fontWeight: el.fontWeight || 'normal',
          fontStyle: el.fontStyle || 'normal',
          underline: el.textDecoration === 'underline',
          linethrough: el.textDecoration === 'line-through',
          textAlign: el.textAlign || 'left',
          lineHeight: el.lineHeight || 1.2,
          charSpacing: (el.charSpacing ?? 20) * 10, // Fabric.js 使用 1/1000 em，默认 200 (= 0.2em)
          textBackgroundColor: el.textBackgroundColor || undefined,
        };
        
        // 只有在不在编辑状态时才更新位置
        if (!isEditing) {
          updates.left = el.x;
          updates.top = el.y;
        }
        
        // 只有在不在编辑状态时才更新文字内容
        if (!isEditing) {
          updates.text = el.textContent || '双击编辑';
        }
        
        textObj.set(updates);
        
        // 如果字号变化了，需要重新计算尺寸并同步回 React 状态
        if (fontSizeChanged && !isUpdatingFromFabric.current) {
          const text = textObj.text ?? '';
          const charWidth = newFontSize * 0.6;
          const lines = text.split('\n');
          const maxLineLength = Math.max(...lines.map((l: string) => l.length), text.length || 1);
          const newWidth = Math.max(maxLineLength * charWidth + 16, 50);
          const newHeight = Math.max(lines.length * newFontSize * 1.4 + 8, newFontSize * 1.4 + 8);
          
          // 延迟更新，避免在渲染循环中更新状态
          setTimeout(() => {
            onUpdateElement(el.id, {
              width: newWidth,
              height: newHeight,
            });
          }, 0);
        }
      }
    });

    canvas.renderAll();
    
    // 重置标志
    setTimeout(() => {
      isUpdatingFromReact.current = false;
    }, 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements]);

  // 🔥 关键：动态更新 Fabric.js 各层的 pointerEvents
  // 当 isGridSelectMode 或 activeTool 或 isCropping 变化时，更新 Fabric.js canvas 层的事件接收状态
  useEffect(() => {
    const shouldReceiveEvents = (activeTool === 'select' || activeTool === 'text') && !isGridSelectMode && !isCropping;
    
    // 更新 canvas-container
    const canvasContainer = canvasElRef.current?.parentElement;
    if (canvasContainer) {
      (canvasContainer as HTMLDivElement).style.pointerEvents = shouldReceiveEvents ? 'auto' : 'none';
    }
    
    // 更新 upper-canvas
    const upperCanvas = canvasElRef.current?.parentElement?.querySelector('.upper-canvas');
    if (upperCanvas) {
      (upperCanvas as HTMLCanvasElement).style.pointerEvents = shouldReceiveEvents ? 'auto' : 'none';
    }
    
    // 更新 lower-canvas
    const lowerCanvas = canvasElRef.current?.parentElement?.querySelector('.lower-canvas');
    if (lowerCanvas) {
      (lowerCanvas as HTMLCanvasElement).style.pointerEvents = 'none'; // lower-canvas 永远不接收事件
    }
    
    // #044 性能优化：删除日志
  }, [activeTool, isGridSelectMode, isCropping]);

  // 更新视图变换（缩放和平移）
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // 设置视口变换
    canvas.setViewportTransform([
      zoom, 0, 0, zoom, pan.x, pan.y
    ]);
    canvas.renderAll();
  }, [zoom, pan]);


  // 工具变化时更新 canvas 的可选状态
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // 当工具从 text 切换到其他工具时，重置创建标志
    if (activeTool !== 'text') {
      isCreatingTextRef.current = false;
    }

    // 手型工具时禁用选择
    if (activeTool === 'hand') {
      canvas.selection = false;
      canvas.forEachObject((obj: FabricObject) => {
        obj.selectable = false;
        obj.evented = false;
      });
    } else {
      canvas.selection = true;
      canvas.forEachObject((obj: FabricObject) => {
        obj.selectable = true;
        obj.evented = true;
      });
    }
    canvas.renderAll();
  }, [activeTool]);

  return (
    <canvas
      ref={canvasElRef}
      data-text-layer="true"
      draggable={false}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: canvasSize.width,
        height: canvasSize.height,
        // 只有在选择工具和文字工具时才接收事件
        // 从画布添加模式下禁用事件，让点击穿透到图片元素
        pointerEvents: (activeTool === 'select' || activeTool === 'text') && !isGridSelectMode ? 'auto' : 'none',
        zIndex: 15,
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      onContextMenu={(e) => {
        // 阻止浏览器默认行为，但让事件继续冒泡到父容器
        e.preventDefault();
        // 事件会自动冒泡到父容器的 onContextMenu
      }}
    />
  );
}
