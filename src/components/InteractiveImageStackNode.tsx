'use client';

import React, { useState, useCallback, useRef, useEffect, memo } from 'react';
import { Image as ImageIcon, Trash2, Star, ChevronUp, Download, Expand, Shrink } from 'lucide-react';

// ==================== 类型定义 ====================

export interface ImageStackData {
  imageUrls: string[];         // 图片 URL 数组
  imageKeys?: string[];        // 图片 Key 数组（用于持久化）
  providerUrls?: string[];     // #525 混合架构：服务商原始URL数组（优先渲染，过期后fallback代理URL）
  activeIndex: number;         // 当前首图索引
  isStackExpanded: boolean;    // 是否展开堆叠
  showBottomPanel?: boolean;   // 兼容旧字段（已废弃）
  generationStatus?: 'idle' | 'generating' | 'submitted' | 'recovering' | 'completed' | 'failed' | 'expired';
  generationError?: string | null;
  prompt?: string;             // 提示词
  name?: string;               // 节点名称
  // 画布元素基础属性
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  // 连线相关
  sourceIds?: string[];        // 连接的源节点 ID（用于查找已连接的面板）
}

interface ImageStackProps {
  id: string;
  data: ImageStackData;
  selected?: boolean;
  zoom?: number;
  // 位置/尺寸/数据更新回调
  onUpdatePosition?: (id: string, x: number, y: number) => void;
  onUpdateSize?: (id: string, width: number, height: number) => void;
  onUpdateData?: (id: string, data: Partial<ImageStackData>) => void;
  // 删除元素
  onDelete?: (id: string) => void;
  // 添加元素（用于创建新的连线节点）
  onAddElement?: (element: any) => void;
  // 连线相关 - 与 GeneratePanelNode 保持一致
  onInputPortPointerUp?: (nodeId: string) => void;   // 接收连线（输入端口松开）
  onOutputPortPointerDown?: (nodeId: string, startX: number, startY: number) => void;  // 启动连线（输出端口按下）
  snapHighlightId?: string | null;  // 磁吸高亮
  // #426 变灰逻辑 - 与 GeneratePanelNode 保持一致
  connectionDraftSourceId?: string | null;  // 当前拖拽连线的源ID
  sourceIds?: string[];  // 已连接的源ID列表
  // #426 清除变灰状态
  onCancelConnection?: () => void;
  // #594 多选时隐藏加号（避免遮挡多选框加号）
  isInMultiSelect?: boolean;
}

// ==================== 扑克牌堆叠偏移配置 ====================

const STACK_OFFSETS = [
  { x: 0, y: 0, rotate: 0 },      // 首图（最上层）
  { x: 8, y: 4, rotate: -2 },     // 第2张
  { x: -6, y: 8, rotate: 3 },     // 第3张
  { x: 10, y: 6, rotate: -1.5 },  // 第4张
];

// ==================== 常量配置 ====================

const SINGLE_IMAGE_SIZE = 280;  // 单张图片尺寸（固定）
const GRID_GAP = 8;             // 网格间距
const MAX_COLS = 2;             // 最大列数

// ==================== 主组件 ====================

// 👑 军师方案：React.memo 绝对隔离舱
// 只有核心数据真的变了才允许图片重渲染，把 snapHighlightId、全盘 selectedIds 等"垃圾更新"挡在门外！
const InteractiveImageStackNode = memo(function InteractiveImageStackNode({
  id,
  data,
  selected = false,
  zoom = 1,
  onUpdatePosition,
  onUpdateSize,
  onUpdateData,
  onDelete,
  onInputPortPointerUp,
  onOutputPortPointerDown,
  snapHighlightId,
  connectionDraftSourceId,  // #426 变灰逻辑
  sourceIds = [],  // #426 变灰逻辑
  onCancelConnection,  // #426 清除变灰状态
  isInMultiSelect = false,  // #594 多选时隐藏加号
}: ImageStackProps) {
  // ==================== 本地状态 ====================

  const [hoveredImageIndex, setHoveredImageIndex] = useState<number | null>(null);
  const [isHoveringStack, setIsHoveringStack] = useState(false);
  const nodeRef = useRef<HTMLDivElement>(null);

  // 👑 军师方案：snapHighlightId 改为纯 DOM 操作，不触发 React 重渲染
  // memo 比较函数已拦截 snapHighlightId 变化，所以用 useEffect 手动操作 DOM
  useEffect(() => {
    if (!nodeRef.current) return;
    // 查找当前节点内的所有端口
    const ports = nodeRef.current.querySelectorAll('.node-connection-port-hitbox');
    const isHighlighted = snapHighlightId === id;
    
    ports.forEach((port) => {
      const portEl = port as HTMLElement;
      if (isHighlighted) {
        portEl.classList.add('port-snap-active');
        // 磁吸高亮的视觉样式
        portEl.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)';
        portEl.style.border = '2.5px solid rgba(255,255,255,0.9)';
        portEl.style.boxShadow = '0 2px 8px rgba(255,255,255,0.15)';
        portEl.style.transform = 'scale(1.3)';
      } else {
        portEl.classList.remove('port-snap-active');
        portEl.style.background = 'transparent';
        portEl.style.border = '2px solid rgba(255,255,255,0.7)';
        portEl.style.boxShadow = '0 1px 3px rgba(255,255,255,0.1)';
        portEl.style.transform = 'scale(1)';
      }
    });

    // 同步更新外层容器的 transform（包含 snapHighlightId 的 scale 效果）
    const inputPortWrapper = nodeRef.current.querySelector('[data-port-type="input"]')?.parentElement;
    const outputPortWrapper = nodeRef.current.querySelector('[data-port-type="output"]')?.parentElement;
    
    if (inputPortWrapper) {
      inputPortWrapper.style.transform = `translateX(-50%) ${isHighlighted ? 'scale(1.3)' : 'scale(1)'}`;
    }
    if (outputPortWrapper) {
      outputPortWrapper.style.transform = `translateX(-50%) ${isHighlighted ? 'scale(1.3)' : 'scale(1)'}`;
    }
  }, [snapHighlightId, id]);

  // ==================== 派生状态 ====================

  const {
    imageUrls = [],
    imageKeys = [],
    activeIndex = 0,
    isStackExpanded = false,
    generationStatus = 'idle',
    generationError,
    name = '图片栈',
    width = SINGLE_IMAGE_SIZE,
    height = SINGLE_IMAGE_SIZE,
  } = data;

  // ==================== 计算展开后的容器尺寸 ====================

  const getExpandedContainerSize = useCallback((imageCount: number) => {
    if (imageCount <= 0) {
      return { width: SINGLE_IMAGE_SIZE, height: SINGLE_IMAGE_SIZE };
    }
    
    const cols = Math.min(imageCount, MAX_COLS);
    const rows = Math.ceil(imageCount / MAX_COLS);
    
    // 展开时容器变大，但单张图片尺寸不变
    const containerWidth = cols * SINGLE_IMAGE_SIZE + (cols - 1) * GRID_GAP;
    const containerHeight = rows * SINGLE_IMAGE_SIZE + (rows - 1) * GRID_GAP;
    
    return { width: containerWidth, height: containerHeight };
  }, []);

  const expandedSize = getExpandedContainerSize(imageUrls.length);

  // ==================== 事件处理 ====================

  const handleSetAsActive = useCallback((index: number) => {
    if (onUpdateData) {
      // 设为首图后自动收起
      onUpdateData(id, { 
        activeIndex: index, 
        isStackExpanded: false 
      });
    }
  }, [id, onUpdateData]);

  const handleDeleteImage = useCallback((index: number) => {
    if (!onUpdateData) return;
    
    const newUrls = [...imageUrls];
    const newKeys = [...(imageKeys || [])];
    newUrls.splice(index, 1);
    newKeys.splice(index, 1);
    
    let newActiveIndex = activeIndex;
    if (activeIndex >= newUrls.length && newUrls.length > 0) {
      newActiveIndex = Math.max(0, newUrls.length - 1);
    }
    
    onUpdateData(id, {
      imageUrls: newUrls,
      imageKeys: newKeys,
      activeIndex: newActiveIndex,
      // 如果删除后只剩一张，自动收起
      isStackExpanded: newUrls.length > 1 ? isStackExpanded : false,
    });
  }, [id, imageUrls, imageKeys, activeIndex, isStackExpanded, onUpdateData]);

  const handleToggleExpand = useCallback(() => {
    if (onUpdateData) {
      onUpdateData(id, { isStackExpanded: !isStackExpanded });
    }
  }, [id, isStackExpanded, onUpdateData]);

  // 点击空白处收起
  useEffect(() => {
    if (!isStackExpanded) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // 检查是否点击在节点外部
      if (nodeRef.current && !nodeRef.current.contains(target)) {
        onUpdateData?.(id, { isStackExpanded: false });
      }
    };
    
    // 延迟添加监听，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [id, isStackExpanded, onUpdateData]);

  // ==================== 下载功能 ====================

  const handleDownload = useCallback(async (url: string, index: number) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${name}_${index + 1}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('[ImageStack] 下载失败:', error);
    }
  }, [name]);

  // ==================== 渲染 ====================

  const activeImageUrl = imageUrls[activeIndex] || '';
  const hasMultipleImages = imageUrls.length > 1;
  const displayWidth = isStackExpanded ? expandedSize.width : SINGLE_IMAGE_SIZE;
  const displayHeight = isStackExpanded ? expandedSize.height : SINGLE_IMAGE_SIZE;

  return (
    <div
      ref={nodeRef}
      className="absolute"
      data-element-id={id}
      data-source-ids={(sourceIds || []).join(',')}
      style={{
        left: data.x || 0,
        top: data.y || 0,
        width: displayWidth,
        height: displayHeight,
        zIndex: 1,  // #600 物理置顶：zIndex 由外层容器控制，不依赖 selected 状态
        transition: isStackExpanded ? 'width 0.3s ease, height 0.3s ease' : 'none',
      }}
    >
      {/* 顶部连线端口 (Target - 输入端口) - 1:1 复刻图片节点的连线按钮样式 */}
      {/* 样式来源：page.tsx 第 7574-7745 行图片节点的右侧连线按钮 */}
      {/* #426 变灰逻辑 - 与 GeneratePanelNode 保持一致 */}
      {/* 👑 军师方案：snapHighlightId 的视觉效果由 useEffect 纯 DOM 操作接管，此处不依赖它 */}
      {(() => {
        const isAlreadyConnected = connectionDraftSourceId && sourceIds.includes(connectionDraftSourceId);
        
        return (
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: -24, // 悬浮在顶部外面
          transform: 'translateX(-50%) scale(1)',
          width: 24,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          // #426 已连接时显示朦胧感
          opacity: isAlreadyConnected ? 0.3 : 1,
          filter: isAlreadyConnected ? 'blur(1px) grayscale(0.5)' : 'none',
        }}
      >
        {/* 核心视觉实体：圆形 + 渐变背景 + 白色边框 */}
        <div
          className="node-connection-port-hitbox connection-port-input"
          data-port-target={id}
          data-port-type="input"
          style={{
            width: 18,
            height: 18,
            background: 'transparent',
            border: '2px solid rgba(255,255,255,0.7)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(255,255,255,0.1)',
            transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s',
            pointerEvents: 'auto',
            cursor: 'crosshair',
          }}
          title="拖拽连线到此端口"
          onPointerUp={(e) => {
            e.stopPropagation();
            onInputPortPointerUp?.(id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* 加号图标 - 白色 */}
          <svg style={{ pointerEvents: 'none' }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </div>
      </div>
      );  // #426 IIFE 闭合
      })()}

      {/* 图片堆叠区域 */}
      <div
        className="relative"
        style={{ width: displayWidth, height: displayHeight }}
        onMouseEnter={() => setIsHoveringStack(true)}
        onMouseLeave={() => setIsHoveringStack(false)}
      >
        {imageUrls.length === 0 ? (
          // 空状态 / 加载中
          <div
            className="flex items-center justify-center bg-zinc-800 rounded-lg border border-zinc-600"
            style={{ width: SINGLE_IMAGE_SIZE, height: SINGLE_IMAGE_SIZE }}
          >
            {generationStatus === 'generating' ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-zinc-400 text-sm">生成中...</span>
              </div>
            ) : (
              <ImageIcon className="w-12 h-12 text-zinc-500" />
            )}
          </div>
        ) : isStackExpanded ? (
          // ========== 展开状态 - 向上展开的网格 ==========
          <div 
            className="absolute bottom-0 left-0 grid gap-2"
            style={{ 
              gridTemplateColumns: `repeat(${MAX_COLS}, ${SINGLE_IMAGE_SIZE}px)`,
              width: displayWidth,
            }}
          >
            {imageUrls.map((url: string, index: number) => (
              <div
                key={index}
                className="relative group rounded-lg overflow-hidden shadow-lg"
                style={{ 
                  width: SINGLE_IMAGE_SIZE, 
                  height: SINGLE_IMAGE_SIZE,
                }}
                onMouseEnter={() => setHoveredImageIndex(index)}
                onMouseLeave={() => setHoveredImageIndex(null)}
              >
                <img
                  src={url}
                  alt={`${name} #${index + 1}`}
                  className="w-full h-full object-cover"
                  draggable={false}
                  referrerPolicy="no-referrer-when-downgrade"
                />
                
                {/* 悬浮操作按钮 - 右上角 */}
                {hoveredImageIndex === index && (
                  <div className="absolute top-2 right-2 flex gap-1">
                    {/* 非首图显示"设为首图"按钮 */}
                    {index !== activeIndex && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleSetAsActive(index);
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                        }}
                        className="p-1.5 bg-yellow-500/90 rounded-lg hover:bg-yellow-600 transition-colors"
                        title="设为首图"
                      >
                        <Star className="w-4 h-4 text-white" />
                      </button>
                    )}
                    {/* 下载按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handleDownload(url, index);
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                      }}
                      className="p-1.5 bg-zinc-700/90 rounded-lg hover:bg-zinc-600 transition-colors"
                      title="下载"
                    >
                      <Download className="w-4 h-4 text-white" />
                    </button>
                  </div>
                )}
                
                {/* 首图标识 */}
                {index === activeIndex && (
                  <div className="absolute top-2 left-2 px-2 py-1 bg-yellow-500/90 rounded text-xs text-white font-medium">
                    首图
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          // ========== 收起状态 - 扑克牌堆叠 ==========
          <div 
            className="relative" 
            style={{ width: SINGLE_IMAGE_SIZE, height: SINGLE_IMAGE_SIZE }}
          >
            {/* 背景图片（层叠效果） */}
            {hasMultipleImages && imageUrls.filter((_, i) => i !== activeIndex).slice(0, 3).map((url: string, i: number) => (
              <div
                key={i}
                className="absolute rounded-lg overflow-hidden shadow-lg"
                style={{
                  width: SINGLE_IMAGE_SIZE - 20,
                  height: SINGLE_IMAGE_SIZE - 20,
                  left: STACK_OFFSETS[i + 1]?.x || 0,
                  top: STACK_OFFSETS[i + 1]?.y || 0,
                  transform: `rotate(${STACK_OFFSETS[i + 1]?.rotate || 0}deg)`,
                  zIndex: 10 - i,
                  opacity: 0.7,
                }}
              >
                <img
                  src={url}
                  alt=""
                  className="w-full h-full object-cover"
                  draggable={false}
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            ))}
            
            {/* 首图 */}
            <div
              className="absolute rounded-lg overflow-hidden shadow-xl"
              style={{
                width: SINGLE_IMAGE_SIZE,
                height: SINGLE_IMAGE_SIZE,
                zIndex: 20,
              }}
            >
              <img
                src={activeImageUrl}
                alt={name}
                className="w-full h-full object-cover"
                draggable={false}
                referrerPolicy="no-referrer-when-downgrade"
              />
              
              {/* 生成中遮罩 */}
              {generationStatus === 'generating' && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-white text-sm">生成中...</span>
                  </div>
                </div>
              )}
              
              {/* 失败状态 */}
              {generationStatus === 'failed' && (
                <div className="absolute inset-0 bg-red-900/70 flex items-center justify-center">
                  <span className="text-white text-sm px-2 text-center">{generationError || '生成失败'}</span>
                </div>
              )}
            </div>
            
            {/* 悬浮操作按钮 - 右上角 */}
            {isHoveringStack && generationStatus !== 'generating' && (
              <div 
                className="absolute top-2 right-2 flex gap-1"
                style={{ zIndex: 30 }}
              >
                {/* 展开按钮（多图时显示） */}
                {hasMultipleImages && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleToggleExpand();
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                    }}
                    className="p-1.5 bg-zinc-700/90 rounded-lg hover:bg-zinc-600 transition-colors"
                    title="展开"
                  >
                    <Expand className="w-4 h-4 text-white" />
                  </button>
                )}
                {/* 下载按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    handleDownload(activeImageUrl, activeIndex);
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                  }}
                  className="p-1.5 bg-zinc-700/90 rounded-lg hover:bg-zinc-600 transition-colors"
                  title="下载首图"
                >
                  <Download className="w-4 h-4 text-white" />
                </button>
              </div>
            )}
            
            {/* 图片数量指示器 */}
            {hasMultipleImages && (
              <div 
                className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 rounded text-xs text-white"
                style={{ zIndex: 30 }}
              >
                {imageUrls.length} 张
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部连线端口 (Source - 输出端口) - 1:1 复刻图片节点的连线按钮样式 */}
      {/* 只有收起状态且不在多选框时才显示，传递 activeIndex 对应的首图 */}
      {/* #594 多选时隐藏，避免遮挡多选框加号 */}
      {/* 👑 军师方案：snapHighlightId 的视觉效果由 useEffect 纯 DOM 操作接管 */}
      {!isStackExpanded && !isInMultiSelect && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: -24, // 悬浮在底部外面
            transform: 'translateX(-50%) scale(1)',
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          {/* 核心视觉实体：圆形 + 渐变背景 + 白色边框 */}
          <div
            className="node-connection-port-hitbox connection-port-output"
            data-port-target={id}
            data-port-type="output"
            style={{
              width: 18,
              height: 18,
              background: 'transparent',
              border: '2px solid rgba(255,255,255,0.7)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 1px 3px rgba(255,255,255,0.1)',
              transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s',
              pointerEvents: 'auto',
              cursor: 'crosshair',
            }}
            title="拖拽连线（传递首图）"
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.nativeEvent && (e.nativeEvent as any).stopImmediatePropagation) {
                (e.nativeEvent as any).stopImmediatePropagation();
              }
              
              // 计算连线起点：元素底部边缘中心（画布坐标）
              const startX = (data.x || 0) + displayWidth / 2;
              const startY = (data.y || 0) + displayHeight;
              
              onOutputPortPointerDown?.(id, startX, startY);
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              // #426 拉线结束时清除变灰状态
              if (onCancelConnection) onCancelConnection();
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* 加号图标 - 白色 */}
            <svg style={{ pointerEvents: 'none' }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </div>
        </div>
      )}

      {/* 选中边框 */}
      {selected && (
        <div
          className="absolute pointer-events-none border-2 border-blue-500 rounded-lg"
          style={{
            left: -2,
            top: -2,
            width: displayWidth + 4,
            height: displayHeight + 4,
          }}
        />
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // 👑 军师海关把控：只有当下面这几个核心数据真的变了，才允许图片重渲染！
  // 坚决把 snapHighlightId、全盘 selectedIds 等"垃圾更新"挡在门外！
  
  // 1. ID 不一致 → 必须重渲染（理论上不会发生，但保险起见）
  if (prevProps.id !== nextProps.id) return false;
  
  // 2. 自身选中状态变了 → 允许重渲染（边框显示需要）
  if (prevProps.selected !== nextProps.selected) return false;
  
  // 3. 图片源变了 → 必须重渲染
  // #868 修复：逐项比对所有 imageUrls/providerUrls/imageKeys，不能只比 [0]
  const prevUrls = prevProps.data.imageUrls;
  const nextUrls = nextProps.data.imageUrls;
  if (prevUrls?.length !== nextUrls?.length) return false;
  for (let i = 0; i < (prevUrls?.length || 0); i++) {
    if (prevUrls?.[i] !== nextUrls?.[i]) return false;
  }
  const prevProviderUrls = prevProps.data.providerUrls;
  const nextProviderUrls = nextProps.data.providerUrls;
  if (prevProviderUrls?.length !== nextProviderUrls?.length) return false;
  for (let i = 0; i < (prevProviderUrls?.length || 0); i++) {
    if (prevProviderUrls?.[i] !== nextProviderUrls?.[i]) return false;
  }
  const prevKeys = prevProps.data.imageKeys;
  const nextKeys = nextProps.data.imageKeys;
  if (prevKeys?.length !== nextKeys?.length) return false;
  for (let i = 0; i < (prevKeys?.length || 0); i++) {
    if (prevKeys?.[i] !== nextKeys?.[i]) return false;
  }
  
  // 4. 首图索引变了 → 需要重渲染
  if (prevProps.data.activeIndex !== nextProps.data.activeIndex) return false;
  
  // 5. 展开状态变了 → 需要重渲染
  if (prevProps.data.isStackExpanded !== nextProps.data.isStackExpanded) return false;
  
  // 6. 生成状态变了 → 需要重渲染（占位符动画等）
  if (prevProps.data.generationStatus !== nextProps.data.generationStatus) return false;
  if (prevProps.data.generationError !== nextProps.data.generationError) return false;
  
  // 7. 尺寸/位置变了 → 需要重渲染
  if (prevProps.data.width !== nextProps.data.width || prevProps.data.height !== nextProps.data.height) return false;
  if (prevProps.data.x !== nextProps.data.x || prevProps.data.y !== nextProps.data.y) return false;
  
  // 8. 缩放变了 → 需要重渲染
  if (prevProps.zoom !== nextProps.zoom) return false;
  
  // 9. #60fps Phase2: connectionDraftSourceId 变化不触发重渲染
  // 变灰效果由 CSS class (.is-dimmed) 控制，不需要 React 重渲染
  // if (prevProps.connectionDraftSourceId !== nextProps.connectionDraftSourceId) return false;
  if (prevProps.isInMultiSelect !== nextProps.isInMultiSelect) return false;
  
  // 10. sourceIds 长度变了 → 需要重渲染
  const prevSourceIds = prevProps.sourceIds || [];
  const nextSourceIds = nextProps.sourceIds || [];
  if (prevSourceIds.length !== nextSourceIds.length) return false;
  
  // 💡 关键拦截：snapHighlightId 变化 → 不重渲染！
  // 磁吸高亮用纯 DOM 操作处理，不需要 React 重渲染
  // 💡 回调函数引用变化 → 不重渲染！
  // 回调函数由 useCallback 包裹，引用稳定；即使变化也不影响渲染结果
  
  // 以上全部通过 → 拦截重渲染
  return true;
});

export default InteractiveImageStackNode;

// ==================== 工具函数 ====================

/**
 * 创建新的图片栈节点
 */
export function createImageStackNode(params: {
  id: string;
  x: number;
  y: number;
  imageUrl?: string;
  imageKey?: string;
  prompt?: string;
  name?: string;
  sourceId?: string;  // 连接的面板 ID
}): any {
  const { id, x, y, imageUrl, imageKey, prompt, name, sourceId } = params;
  
  return {
    id,
    type: 'image-stack',
    name: name || '图片栈',
    x,
    y,
    width: SINGLE_IMAGE_SIZE,
    height: SINGLE_IMAGE_SIZE,
    rotation: 0,
    fill: 'transparent',
    stroke: '#3f3f46',
    strokeWidth: 1,
    opacity: 1,
    visible: true,
    locked: false,
    // 图片栈数据
    imageUrls: imageUrl ? [imageUrl] : [],
    imageKeys: imageKey ? [imageKey] : [],
    activeIndex: 0,
    isStackExpanded: false,
    generationStatus: imageUrl ? 'completed' : 'generating',
    generationError: null,
    panelPrompt: prompt || '',
    // 连线相关
    sourceIds: sourceId ? [sourceId] : [],
    // 兼容旧字段
    imageUrl: imageUrl || '',
    imageKey: imageKey || '',
    sourceType: 'generate',
    sourcePrompt: prompt || '',
  };
}

/**
 * 清空图片栈（用于覆盖替换）
 */
export function clearImageStackData(): Partial<ImageStackData> {
  return {
    imageUrls: [],
    imageKeys: [],
    activeIndex: 0,
    isStackExpanded: false,
    generationStatus: 'generating',
    generationError: null,
  };
}

/**
 * 向图片栈添加新图片
 */
export function addImageToStackData(
  data: ImageStackData,
  newUrl: string,
  newKey?: string,
  newProviderUrl?: string
): Partial<ImageStackData> {
  return {
    imageUrls: [...(data.imageUrls || []), newUrl],
    imageKeys: [...(data.imageKeys || []), ...(newKey ? [newKey] : [])],
    providerUrls: [...(data.providerUrls || []), ...(newProviderUrl ? [newProviderUrl] : [])],
    generationStatus: 'completed',
    generationError: null,
  };
}

/**
 * 批量设置图片栈的图片（用于流式接收完成后）
 */
export function setImageStackImages(
  urls: string[],
  keys: string[]
): Partial<ImageStackData> {
  return {
    imageUrls: urls,
    imageKeys: keys,
    activeIndex: 0,
    generationStatus: 'completed',
    generationError: null,
  };
}
