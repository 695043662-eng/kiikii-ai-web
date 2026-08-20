'use client';

import React, { memo } from 'react';
import CanvasRoseCurve from '@/components/canvas/CanvasRoseCurve';
import { getImageSrcForElement } from '@/lib/download';

// ==================== 类型定义 ====================

export interface CanvasImageElement {
  id: string;
  type: 'image';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  imageUrl?: string;
  imageKey?: string;
  providerUrl?: string;  // #863 双链路：服务商原始链接（白嫖流量）
  opacity?: number;
  generationStatus?: 'idle' | 'generating' | 'submitted' | 'recovering' | 'completed' | 'failed' | 'expired';
  generationError?: string | null;
  isLoading?: boolean;
  sourceIds?: string[];
  sourceType?: 'generate' | 'split' | 'video' | 'canvas' | 'upload';  // #632 视频占位符支持
  // #680 视频进度管道：占位符生成进度（0-100）
  progress?: number;
  // 视频URL：当 sourceType='video' 时，用于渲染视频播放器
  videoUrl?: string;
  videoKey?: string;
  thumbnailUrl?: string;
  thumbnailKey?: string;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropDragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  rectX: number;
  rectY: number;
  rectW: number;
  rectH: number;
  handle: string;
}

interface MemoizedCanvasImageProps {
  el: CanvasImageElement;
  isSelected: boolean;
  zIndex: number;
  theme?: 'light' | 'dark';
  // 渐变背景控制
  roseGradientBg?: boolean;
  // 裁剪状态
  isCropping?: boolean;
  cropImageId?: string | null;
  cropRect?: CropRect | null;
  onCropHandleMouseDown?: (e: React.MouseEvent, cropRect: CropRect, handle: string) => void;
  // 多选
  isInMultiSelect?: boolean;
  // 鼠标回调（稳定引用，由 useCallback 包裹）
  onMouseEnter?: (elId: string) => void;
  onMouseLeave?: (elId: string) => void;
  onContextMenu?: (e: React.MouseEvent, elId: string) => void;
  onMouseDown?: (e: React.MouseEvent, el: CanvasImageElement) => void;
  onClick?: (e: React.MouseEvent, el: CanvasImageElement) => void;
  onDoubleClick?: (e: React.MouseEvent, el: CanvasImageElement) => void;
  // 图片加载回调（含图片自然尺寸，用于 auto 比例占位符的安全网修复）
  onImageLoad?: (el: CanvasImageElement, dimensions?: { naturalWidth: number; naturalHeight: number }) => void;
  onImageError?: (el: CanvasImageElement) => void;
  // 加号按钮回调
  onPlusPointerDown?: (e: React.PointerEvent, el: CanvasImageElement) => void;
  onPlusPointerMove?: (e: React.PointerEvent, el: CanvasImageElement) => void;
  onPlusPointerUp?: (e: React.PointerEvent) => void;
  onPlusPointerCancel?: (e: React.PointerEvent) => void;
}

// ==================== 主组件 ====================

/**
 * 👑 军师绝对隔离舱：给普通图片穿上 React.memo 防弹衣！
 *
 * 核心原则：
 * 1. 只有位置、大小、URL、选中状态、生成状态变化才重渲染
 * 2. snapHighlightId 变化 → 不重渲染（由父组件 useEffect + DOM 操作处理）
 * 3. 回调函数引用变化 → 不重渲染（由 memo 比较函数拦截）
 * 4. generateMenu 变化 → 不重渲染（与图片无关）
 * 5. draftLine 变化 → 不重渲染（连线由独立 SVG 层处理）
 */
const MemoizedCanvasImage = memo(function MemoizedCanvasImage({
  el,
  isSelected,
  zIndex,
  theme = 'light',
  roseGradientBg = true,
  isCropping = false,
  cropImageId = null,
  cropRect = null,
  onCropHandleMouseDown,
  isInMultiSelect = false,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
  onMouseDown,
  onClick,
  onDoubleClick,
  onImageLoad,
  onImageError,
  onPlusPointerDown,
  onPlusPointerMove,
  onPlusPointerUp,
  onPlusPointerCancel,
}: MemoizedCanvasImageProps) {
  // 占位符状态
  const isThisCropping = isCropping && cropImageId === el.id;
  const isGenerating = el.generationStatus === 'generating' || el.generationStatus === 'recovering' || el.generationStatus === 'submitted';
  const isLoading = el.isLoading === true;
  const isFailed = el.generationStatus === 'failed';
  const isExpired = el.generationStatus === 'expired';

  // #863 修复：双链路 Fallback 渲染公式
  // 优先级：providerUrl → imageUrl(含blob:) → videoUrl → COS代理URL → null
  // 核心防线：当 imageUrl 为空（刷新后 saveStateToStorage 剥离了 imageUrl），
  // 但 imageKey 存在时，直接使用 COS 代理 URL 渲染，不依赖 onError 触发！
  const displaySrc = getImageSrcForElement(el);

  // 玫瑰曲线颜色（日间模式：玫红色，夜间模式：白色）
  const roseColor = theme === 'dark' ? '#ffffff' : '#e84393';

  // 根据占位符尺寸动态计算文字大小
  const minDim = Math.min(el.width, el.height);
  const iconSize = Math.max(20, minDim * 0.12);
  const fontSize = Math.max(10, minDim * 0.04);

  // 加号按钮大小计算（#614 #569 规范：最小边 * 0.05，与多选/面板一致）
  const avgSize = Math.min(el.width, el.height);
  const buttonSize = avgSize * 0.05;
  const containerSize = buttonSize + 15;
  const iconSizePlus = Math.round(buttonSize * 0.6);

  return (
    <div
      data-element-id={el.id}
      data-image-element="true"
      data-source-ids={el.sourceIds?.join(',') || ''}
      style={{
        position: 'absolute',
        left: el.x,
        top: el.y,
        width: el.width,
        height: el.height,
        zIndex,
        overflow: 'visible',
        userSelect: 'none',
        pointerEvents: 'auto',
        // 👑 画质还原归零：彻底删除所有画质干预
        // 不再有 contain, transform, will-change, image-rendering
        // 让 Chrome 自己决定最优渲染策略
      }}
      className={`canvas-image-wrapper group select-none cursor-grab active:cursor-grabbing`}
      onContextMenu={(e) => onContextMenu?.(e, el.id)}
      onMouseEnter={() => onMouseEnter?.(el.id)}
      onMouseLeave={() => onMouseLeave?.(el.id)}
      onMouseDown={(e) => onMouseDown?.(e, el)}
      onClick={(e) => onClick?.(e, el)}
      onDoubleClick={(e) => onDoubleClick?.(e, el)}
    >
      {/* 生成中占位符 - 玫瑰曲线动画 + 渐变背景 */}
      {isGenerating && (
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '3%',
            boxShadow: isSelected ? '0 0 0 2px #40A9FF' : '0 0 0 2px rgba(59, 130, 246, 0.6)',
            position: 'relative',
            overflow: 'hidden',
            background: roseGradientBg
              ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(99, 102, 241, 0.25) 50%, rgba(56, 189, 248, 0.25) 100%)'
              : (theme === 'dark' ? '#1f2937' : '#ffffff'),
          }}
        >
          <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%' }}>
            <CanvasRoseCurve color={roseColor} showDetail gradientBg={roseGradientBg} externalProgress={el.progress ?? 0} />
          </div>
          {/* #632 视频占位符标签 - 与 CanvasVideo 完全一致 */}
          {el.sourceType === 'video' && (() => {
            const baseSize = Math.min(el.width, el.height);
            const scale = (baseSize / 200) * 0.5;
            const fontSize = Math.round(12 * scale);
            const iconSize = Math.round(14 * scale);
            const padding = Math.round(4 * scale);
            const gap = Math.round(4 * scale);
            const offset = Math.round(8 * scale);
            
            return (
              <div style={{
                position: 'absolute',
                top: offset,
                left: offset,
                background: 'rgba(0,0,0,0.6)',
                borderRadius: `${Math.round(4 * scale)}px`,
                padding: `${padding}px ${padding * 2}px`,
                display: 'flex',
                alignItems: 'center',
                gap: gap,
                pointerEvents: 'none',
                zIndex: 2,
              }}>
                <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="white">
                  <polygon points="5,3 19,12 5,21"/>
                </svg>
                <span style={{ color: 'white', fontSize }}>{baseSize >= 80 ? '视频' : ''}</span>
              </div>
            );
          })()}
        </div>
      )}

      {/* #668 任务二：乐观UI图片100%原生清晰度展现，仅右上角细微Loading Spinner */}
      {isLoading && displaySrc && (
        <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', borderRadius: '3%' }}>
          {/* 图片以100%原生清晰度展现（无模糊、无透明度降低） */}
          <img
            src={displaySrc}
            alt={el.name}
            decoding="async"
            referrerPolicy="no-referrer-when-downgrade"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              pointerEvents: 'none',
              display: 'block',
              borderRadius: '3%',
              opacity: el.opacity ?? 1,
            }}
            draggable={false}
            onError={() => onImageError?.(el)}
          />
          {/* 仅右上角极细微Loading Spinner，不遮挡主体 */}
          <div style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 12,
            height: 12,
            pointerEvents: 'none',
          }}>
            <div style={{ width: 12, height: 12, borderWidth: 2 }} className="border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        </div>
      )}

      {/* 图片加载中占位符 - 没有 displaySrc 时的兜底（纯加载圈） */}
      {isLoading && !displaySrc && (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255, 255, 255, 0.3)',
            borderRadius: '3%',
            border: isSelected ? '2px solid #40A9FF' : '2px dashed rgba(59, 130, 246, 0.5)',
            opacity: el.opacity,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div className="relative z-10 flex flex-col items-center gap-3">
            <div style={{ width: iconSize, height: iconSize, borderWidth: 3 }} className="border-3 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
            <div className="text-blue-500 font-medium" style={{ fontSize }}>加载中...</div>
          </div>
        </div>
      )}

      {/* 生成失败占位符 */}
      {isFailed && (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.15) 100%)',
            borderRadius: 12,
            border: '2px solid rgba(239, 68, 68, 0.5)',
            opacity: el.opacity,
            padding: '8px',
          }}
        >
          <div className="flex flex-col items-center gap-2 max-w-full">
            <div style={{ width: iconSize, height: iconSize }} className="rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <svg style={{ width: iconSize * 0.5, height: iconSize * 0.5 }} className="text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div className="text-red-500 font-medium text-center break-words leading-tight" style={{ fontSize, maxWidth: '100%', wordBreak: 'break-word' }}>
              {el.generationError?.includes('违反') || el.generationError?.includes('违规') || el.generationError?.includes('政策') ||
               el.generationError?.toLowerCase().includes('violate') || el.generationError?.toLowerCase().includes('policy')
                ? '内容违规，请修改提示词后重试'
                : el.generationError === 'output_moderation' ? '内容违规' :
                  el.generationError === 'input_moderation' ? '输入违规' :
                  el.generationError || '失败'}
            </div>
          </div>
        </div>
      )}

      {/* 图片丢失占位符 */}
      {isExpired && (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(156, 163, 175, 0.15) 0%, rgba(107, 114, 128, 0.2) 100%)',
            borderRadius: 12,
            border: '2px dashed rgba(156, 163, 175, 0.5)',
            opacity: el.opacity,
            padding: '12px',
          }}
        >
          <div className="flex flex-col items-center gap-2 max-w-full">
            <div style={{ width: iconSize, height: iconSize }} className="rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
              <svg style={{ width: iconSize * 0.5, height: iconSize * 0.5 }} className="text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-gray-500 font-medium text-center break-words leading-tight" style={{ fontSize, maxWidth: '100%', wordBreak: 'break-word' }}>
              {el.generationError || '图片已丢失'}
            </div>
            <div className="text-gray-400 text-center" style={{ fontSize: fontSize * 0.85 }}>
              请重新上传
            </div>
          </div>
        </div>
      )}

      {/* 正常图片 */}
      {!isGenerating && !isLoading && !isFailed && !isExpired && displaySrc && el.sourceType !== 'video' && (
        <>
          {/* 👑 1. 绝对静止底图：不加任何隔离，让 Chrome 原生保持最高清状态 */}
          <img
            key={`img-${el.id}`}
            src={displaySrc}
            alt={el.name}
            // 👑 异步解码，保证图片解析不卡死渲染主线程
            decoding="async"
            referrerPolicy="no-referrer-when-downgrade"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              pointerEvents: 'none',
              display: 'block',
              backgroundColor: '#f5f5f5',
              borderRadius: '3%',
              opacity: el.opacity,
              // 👑 军师最终定稿：只改这一处，永不乱动
              // imageRendering: auto - 让 Chrome 自己决定最佳插值算法
              // WebkitFontSmoothing: antialiased - 给 Chromium 内核的"高保真锁"，强制开启抗锯齿而不降级图层
              imageRendering: 'auto',
              WebkitFontSmoothing: 'antialiased',
            }}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                onImageLoad?.(el, { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
              } else {
                onImageLoad?.(el);
              }
            }}
            onError={() => onImageError?.(el)}
          />

          {/* 👑 2. 终极视觉结界（Overlay）：所有的边框、选中状态、变灰效果全在这里画！ */}
          {/* 这层玻璃怎么重绘发光，底下的图片都稳如泰山！ */}
          <div
            data-overlay={el.id}
            style={{
              position: 'absolute',
              inset: 0, // 完全覆盖图片
              pointerEvents: 'none', // 不阻挡鼠标事件
              borderRadius: '3%',
              
              // #模糊修复 终极手术：删除 GPU 辐射源！
              // ❌ 删除 willChange 和 translateZ：在 scale 容器内会触发 CPU 图片重栅格化
              // ✅ 覆盖层回归纯 2D 渲染，彻底根除混合合成陷阱！
              
              // 选中边框（原本在父级上的样式移到这里！）
              boxShadow: isSelected ? '0 0 0 2px #40A9FF' : 'none',
            }}
          />
        </>
      )}

      {/* 视频：sourceType='video' 且非生成中/加载中/失败/过期时渲染视频播放器 */}
      {!isGenerating && !isLoading && !isFailed && !isExpired && el.sourceType === 'video' && displaySrc && (
        <>
          <video
            key={`video-${el.id}`}
            src={displaySrc}
            muted
            loop
            autoPlay
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              pointerEvents: 'none',
              display: 'block',
              borderRadius: '3%',
              backgroundColor: '#000',
            }}
            onError={(e) => {
              const video = (e.currentTarget as HTMLVideoElement);
              const currentSrc = video.src;
              // 如果当前是 providerUrl/previewUrl 失败，尝试回退到 COS 代理 URL
              const proxyKey = el.imageKey || el.videoKey;
              const proxyUrl = proxyKey ? `/api/canvas/image?key=${encodeURIComponent(proxyKey)}` : null;
              if (proxyUrl && !currentSrc.includes('/api/canvas/image')) {
                console.log('[Video Fallback] providerUrl 失败，回退到 COS 代理:', el.id);
                video.src = proxyUrl;
                video.load();
              } else {
                onImageError?.(el);
              }
            }}
          />
          {/* 视频标签角标 */}
          <div style={{
            position: 'absolute',
            top: 6,
            left: 6,
            backgroundColor: 'rgba(0,0,0,0.6)',
            color: 'white',
            fontSize: 10,
            padding: '1px 5px',
            borderRadius: 3,
            pointerEvents: 'none',
            zIndex: 2,
          }}>
            视频
          </div>
          {/* 视觉结界 Overlay */}
          <div
            data-overlay={el.id}
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              borderRadius: '3%',
              boxShadow: isSelected ? '0 0 0 2px #40A9FF' : 'none',
            }}
          />
        </>
      )}

      {/* #863 修复：displaySrc 为 null 时的兜底占位符（所有 URL 字段均为空） */}
      {!isGenerating && !isLoading && !isFailed && !isExpired && !displaySrc && (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(156, 163, 175, 0.15) 0%, rgba(107, 114, 128, 0.2) 100%)',
            borderRadius: '3%',
            border: '2px dashed rgba(156, 163, 175, 0.5)',
            opacity: el.opacity,
            padding: '12px',
          }}
        >
          <div className="flex flex-col items-center gap-2 max-w-full">
            <div style={{ width: iconSize, height: iconSize }} className="rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
              <svg style={{ width: iconSize * 0.5, height: iconSize * 0.5 }} className="text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-gray-500 font-medium text-center" style={{ fontSize }}>
              图片链接已失效
            </div>
          </div>
        </div>
      )}

      {/* ====== 裁剪覆盖层 ====== */}
      {isThisCropping && cropRect && (
        <>
          {/* 上边遮罩 */}
          <div style={{ position: 'absolute', left: 0, top: 0, width: el.width, height: cropRect.y, backgroundColor: 'rgba(0,0,0,0.5)', pointerEvents: 'none' }} />
          {/* 下边遮罩 */}
          <div style={{ position: 'absolute', left: 0, top: cropRect.y + cropRect.height, width: el.width, height: el.height - cropRect.y - cropRect.height, backgroundColor: 'rgba(0,0,0,0.5)', pointerEvents: 'none' }} />
          {/* 左边遮罩 */}
          <div style={{ position: 'absolute', left: 0, top: cropRect.y, width: cropRect.x, height: cropRect.height, backgroundColor: 'rgba(0,0,0,0.5)', pointerEvents: 'none' }} />
          {/* 右边遮罩 */}
          <div style={{ position: 'absolute', left: cropRect.x + cropRect.width, top: cropRect.y, width: el.width - cropRect.x - cropRect.width, height: cropRect.height, backgroundColor: 'rgba(0,0,0,0.5)', pointerEvents: 'none' }} />

          {/* 裁剪框 */}
          <div
            style={{
              position: 'absolute',
              left: cropRect.x,
              top: cropRect.y,
              width: cropRect.width,
              height: cropRect.height,
              border: '2.5px solid #000',
              pointerEvents: 'none',
              backgroundColor: 'transparent',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.3)',
            }}
          >
            <div style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: 1.5, backgroundColor: 'rgba(0,0,0,0.7)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: 1.5, backgroundColor: 'rgba(0,0,0,0.7)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: 1.5, backgroundColor: 'rgba(0,0,0,0.7)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: 1.5, backgroundColor: 'rgba(0,0,0,0.7)', pointerEvents: 'none' }} />
          </div>

          {/* 北边 - 上边缘调整 */}
          <div
            data-crop-handle="true"
            style={{ position: 'absolute', left: cropRect.x - 10, top: cropRect.y - 25, width: cropRect.width + 20, height: 50, cursor: 'ns-resize', pointerEvents: 'auto', zIndex: 250, backgroundColor: 'transparent' }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onCropHandleMouseDown?.(e, cropRect, 'n'); }}
          >
            <div style={{ position: 'absolute', left: '50%', bottom: 10, transform: 'translateX(-50%)', width: 30, height: 5, backgroundColor: '#000', borderRadius: 2, pointerEvents: 'none', boxShadow: '0 0 0 1px rgba(255,255,255,0.3)' }} />
          </div>

          {/* 南边 - 下边缘调整 */}
          <div
            data-crop-handle="true"
            style={{ position: 'absolute', left: cropRect.x - 10, top: cropRect.y + cropRect.height - 25, width: cropRect.width + 20, height: 50, cursor: 'ns-resize', pointerEvents: 'auto', zIndex: 250, backgroundColor: 'transparent' }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onCropHandleMouseDown?.(e, cropRect, 's'); }}
          >
            <div style={{ position: 'absolute', left: '50%', top: 10, transform: 'translateX(-50%)', width: 30, height: 5, backgroundColor: '#000', borderRadius: 2, pointerEvents: 'none', boxShadow: '0 0 0 1px rgba(255,255,255,0.3)' }} />
          </div>

          {/* 西边 - 左边缘调整 */}
          <div
            data-crop-handle="true"
            style={{ position: 'absolute', left: cropRect.x - 25, top: cropRect.y - 10, width: 50, height: cropRect.height + 20, cursor: 'ew-resize', pointerEvents: 'auto', zIndex: 250, backgroundColor: 'transparent' }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onCropHandleMouseDown?.(e, cropRect, 'w'); }}
          >
            <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 5, height: 30, backgroundColor: '#000', borderRadius: 2, pointerEvents: 'none', boxShadow: '0 0 0 1px rgba(255,255,255,0.3)' }} />
          </div>

          {/* 东边 - 右边缘调整 */}
          <div
            data-crop-handle="true"
            style={{ position: 'absolute', left: cropRect.x + cropRect.width - 25, top: cropRect.y - 10, width: 50, height: cropRect.height + 20, cursor: 'ew-resize', pointerEvents: 'auto', zIndex: 250, backgroundColor: 'transparent' }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onCropHandleMouseDown?.(e, cropRect, 'e'); }}
          >
            <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 5, height: 30, backgroundColor: '#000', borderRadius: 2, pointerEvents: 'none', boxShadow: '0 0 0 1px rgba(255,255,255,0.3)' }} />
          </div>

          {/* 四个角 */}
          {([
            { corner: 'nw', cursor: 'nwse-resize' },
            { corner: 'ne', cursor: 'nesw-resize' },
            { corner: 'sw', cursor: 'nesw-resize' },
            { corner: 'se', cursor: 'nwse-resize' },
          ] as const).map(({ corner, cursor }) => {
            const isLeft = corner.includes('w');
            const isTop = corner.includes('n');
            return (
              <div
                key={corner}
                data-crop-handle="true"
                style={{
                  position: 'absolute',
                  left: isLeft ? cropRect.x - 30 : cropRect.x + cropRect.width - 20,
                  top: isTop ? cropRect.y - 30 : cropRect.y + cropRect.height - 20,
                  width: 50,
                  height: 50,
                  cursor,
                  pointerEvents: 'auto',
                  zIndex: 260,
                  backgroundColor: 'transparent',
                }}
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onCropHandleMouseDown?.(e, cropRect, corner); }}
              >
                <div style={{
                  position: 'absolute',
                  left: isLeft ? 5 : 'auto',
                  right: isLeft ? 'auto' : 5,
                  top: isTop ? 5 : 'auto',
                  bottom: isTop ? 'auto' : 5,
                  width: 20,
                  height: 20,
                  border: '2.5px solid #000',
                  borderRadius: 2,
                  pointerEvents: 'none',
                  boxShadow: '0 0 0 1px rgba(255,255,255,0.3)',
                }} />
              </div>
            );
          })}

          {/* 中间移动区域 */}
          <div
            data-crop-handle="true"
            style={{
              position: 'absolute',
              left: cropRect.x + 30,
              top: cropRect.y + 30,
              width: Math.max(0, cropRect.width - 60),
              height: Math.max(0, cropRect.height - 60),
              cursor: 'move',
              pointerEvents: 'auto',
              zIndex: 240,
            }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onCropHandleMouseDown?.(e, cropRect, 'move'); }}
          />
        </>
      )}

      {/* ====== 磁吸感应区加号按钮 ====== */}
      {!isThisCropping && !isGenerating && !isFailed && !isExpired && !isInMultiSelect && (
        <div
          className="node-connection-port-hitbox"
          data-plus-btn={el.id}
          style={{
            position: 'absolute',
            left: 'calc(100% + 8px)',
            top: '50%',
            transform: 'translateY(-50%)',
            width: `${containerSize}px`,
            height: `${containerSize}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0,
            pointerEvents: 'none',
            zIndex: 250,
            transition: 'opacity 0.15s ease-out',
            // #模糊修复 终极手术：删除 GPU 辐射源！
            // ❌ 删除 willChange：在 scale 容器内会触发 CPU 图片重栅格化
            // ✅ 加号回归纯 2D 渲染，彻底根除混合合成陷阱！
          }}
        >
          <div
            id={`magnet-btn-${el.id}`}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: buttonSize,
                height: buttonSize,
                background: theme === 'dark'
                  ? 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)'
                  : 'linear-gradient(135deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.05) 100%)',
                border: theme === 'dark' ? '2px solid rgba(255,255,255,0.7)' : '2px solid rgba(0,0,0,0.7)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: theme === 'dark' ? '0 2px 8px rgba(255,255,255,0.15)' : '0 2px 8px rgba(0,0,0,0.2)',
                transform: 'scale(1.1)',
                transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                pointerEvents: 'auto',
                cursor: 'crosshair',
              }}
              onPointerDown={(e) => onPlusPointerDown?.(e, el)}
              onPointerMove={(e) => onPlusPointerMove?.(e, el)}
              onPointerUp={(e) => onPlusPointerUp?.(e)}
              onPointerCancel={(e) => onPlusPointerCancel?.(e)}
              onMouseDown={(e) => { e.stopPropagation(); }}
            >
              <svg style={{ pointerEvents: 'none' }} width={iconSizePlus} height={iconSizePlus} viewBox="0 0 24 24" fill="none" stroke={theme === 'dark' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // 👑 军师测谎仪：精确抓捕导致重渲染的真凶！

  const prevEl = prevProps.el;
  const nextEl = nextProps.el;

  // 1. 逐个检查核心属性
  // 核心属性比较：只允许真正影响渲染的属性变化触发重渲染
  const isAllEqual = 
    prevEl.id === nextEl.id &&
    prevEl.x === nextEl.x &&
    prevEl.y === nextEl.y &&
    prevEl.width === nextEl.width &&
    prevEl.height === nextEl.height &&
    prevEl.imageUrl === nextEl.imageUrl &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isInMultiSelect === nextProps.isInMultiSelect &&
    prevProps.zIndex === nextProps.zIndex &&
    prevProps.theme === nextProps.theme &&
    prevEl.opacity === nextEl.opacity &&
    prevEl.generationStatus === nextEl.generationStatus &&
    prevEl.isLoading === nextEl.isLoading &&
    prevEl.generationError === nextEl.generationError &&
    prevEl.progress === nextEl.progress &&  // #680 进度变化触发重渲染
    prevEl.sourceType === nextEl.sourceType &&  // 视频占位符类型变化触发重渲染
    prevEl.videoUrl === nextEl.videoUrl &&  // 视频 URL 变化触发重渲染
    prevEl.imageKey === nextEl.imageKey &&  // imageKey 变化触发重渲染
    prevEl.providerUrl === nextEl.providerUrl &&  // #863 providerUrl 变化触发重渲染
    // #874 修复：裁剪状态变化必须触发重绘
    prevProps.isCropping === nextProps.isCropping &&
    prevProps.cropImageId === nextProps.cropImageId &&
    // cropRect 坐标深层比较——拖拽时坐标变化必须重绘
    (prevProps.cropRect === nextProps.cropRect ||
      (prevProps.cropRect && nextProps.cropRect &&
        prevProps.cropRect.x === nextProps.cropRect.x &&
        prevProps.cropRect.y === nextProps.cropRect.y &&
        prevProps.cropRect.width === nextProps.cropRect.width &&
        prevProps.cropRect.height === nextProps.cropRect.height) ||
      (!prevProps.cropRect && !nextProps.cropRect));

  return isAllEqual;
});

export default MemoizedCanvasImage;
