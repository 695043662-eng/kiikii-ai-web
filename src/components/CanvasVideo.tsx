/**
 * 画布视频组件 - 带状态管理、进度条、秒数显示、音量调节
 * 
 * #615 架构修复：
 * - 播放/暂停状态切换
 * - 进度条拖动
 * - 秒数显示（当前时间 / 总时长）
 * - 音量调节（静音/取消静音 + 滑块）
 * - 错误处理
 * - 加载状态
 * - GPU 合成层隔离
 */

'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTheme } from 'next-themes';
import CanvasRoseCurve from '@/components/canvas/CanvasRoseCurve';
import { translateErrorMessage } from '@/lib/error-handler';

interface CanvasVideoProps {
  elementId: string;
  videoSrc: string;
  posterSrc?: string; // #628 首帧缩略图 URL（用于 poster 属性）
  width: number;
  height: number;
  zoom: number; // 画布缩放比例
  isSelected: boolean;
  zIndex: number;
  isLoading?: boolean; // #619 COS 上传中的虚化加载状态
  generationStatus?: 'generating' | 'completed' | 'failed'; // #7xx 视频生成状态（占位符）
  generationProgress?: number; // #7xx 视频生成进度（0-100）
  generationError?: string; // #7xx 视频生成失败原因
  isInMultiSelect?: boolean; // #621 多选时隐藏加号
  plusButtonSize?: number; // #621 加号按钮尺寸（0=隐藏）
  isBeingSnapped?: boolean; // #621 是否正在被磁吸
  isAlreadyConnected?: boolean; // #621 是否已在连线中
  sourceIds?: string[]; // #60fps Phase1: DOM dimming 用
  onSelect: (e: React.PointerEvent, shiftKey: boolean) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.PointerEvent) => void;
  el?: any; // #622 完整元素对象（含 x/y 坐标），用于连线起点计算
  onPlusPointerDown?: (e: React.PointerEvent, el: any) => void; // #621 加号按钮（与图片加号统一签名）
  onPlusPointerMove?: (e: React.PointerEvent, el: any) => void; // #621 加号拖拽
  onPlusPointerUp?: (e: React.PointerEvent) => void; // #621 加号释放
  onPlusPointerCancel?: (e: React.PointerEvent) => void; // #621 加号取消
  onVideoMouseEnter?: (elementId: string) => void; // #621 鼠标进入视频
  onVideoMouseLeave?: (elementId: string) => void; // #621 鼠标离开视频
  style?: React.CSSProperties;
}

// 格式化时间为 mm:ss
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const CanvasVideo = React.memo(function CanvasVideo({
  elementId,
  videoSrc,
  posterSrc, // #628 首帧缩略图
  width,
  height,
  zoom = 1,
  isSelected,
  zIndex,
  isLoading,
  generationStatus, // #7xx 视频生成状态
  generationProgress = 0, // #7xx 视频生成进度
  generationError, // #7xx 视频生成失败原因
  isInMultiSelect = false,
  plusButtonSize,
  isBeingSnapped,
  isAlreadyConnected,
  sourceIds, // #60fps Phase1: DOM dimming 用
  onSelect,
  onContextMenu,
  onDragStart,
  onPlusPointerDown,
  onPlusPointerMove,
  onPlusPointerUp,
  onPlusPointerCancel,
  onVideoMouseEnter,
  onVideoMouseLeave,
  el, // #622 完整元素对象
  style,
}: CanvasVideoProps) {
  // #723 获取主题，用于玫瑰曲线颜色
  const { theme } = useTheme();
  const roseColor = theme === 'dark' ? '#ffffff' : '#e84393';
  // ====== 状态管理 ======
  const [isPlaying, setIsPlaying] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [volume, setVolume] = useState(1); // 0-1
  const [savedVolume, setSavedVolume] = useState(1); // 静音前保存的音量
  const [isMuted, setIsMuted] = useState(true); // 默认静音（视频自动播放需要）
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const hideVolumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ====== 初始化音量 ======
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, []);

  // ====== 进度更新 ======
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (!isDraggingProgress) {
        setCurrentTime(video.currentTime);
      }
    };

    const handleDurationChange = () => {
      setDuration(video.duration);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
    };
  }, [isDraggingProgress]);

  // ====== 播放控制 ======
  const handleTogglePlay = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {
        setIsError(true);
      });
    }
  }, [isPlaying]);

  // ====== 进度条拖动 ======
  const handleProgressPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!videoRef.current || !progressRef.current) return;

    setIsDraggingProgress(true);

    const rect = progressRef.current.getBoundingClientRect();
    const updateProgress = (clientX: number) => {
      const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newTime = percent * duration;
      videoRef.current!.currentTime = newTime;
      setCurrentTime(newTime);
    };

    updateProgress(e.clientX);

    const handlePointerMove = (e: PointerEvent) => {
      updateProgress(e.clientX);
    };

    const handlePointerUp = () => {
      setIsDraggingProgress(false);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, [duration]);

  // ====== 音量控制 ======
  const handleToggleMute = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!videoRef.current) return;

    if (isMuted) {
      // 取消静音：恢复之前的音量
      const restoreVolume = savedVolume > 0 ? savedVolume : 1;
      videoRef.current.muted = false;
      videoRef.current.volume = restoreVolume;
      setVolume(restoreVolume);
      setIsMuted(false);
    } else {
      // 静音：保存当前音量
      setSavedVolume(volume);
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  }, [isMuted, volume, savedVolume]);

  const handleVolumePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!videoRef.current) return;

    // 清除隐藏定时器
    if (hideVolumeTimeoutRef.current) {
      clearTimeout(hideVolumeTimeoutRef.current);
      hideVolumeTimeoutRef.current = null;
    }

    const track = volumeRef.current?.querySelector('.volume-track') as HTMLElement;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    // 竖型：从下往上，所以用 (bottom - clientY) / height
    const percent = Math.max(0, Math.min(1, (rect.bottom - e.clientY) / rect.height));
    
    videoRef.current.volume = percent;
    videoRef.current.muted = false;
    setVolume(percent);
    setIsMuted(false);

    const handlePointerMove = (e: PointerEvent) => {
      const newPercent = Math.max(0, Math.min(1, (rect.bottom - e.clientY) / rect.height));
      videoRef.current!.volume = newPercent;
      videoRef.current!.muted = false;
      setVolume(newPercent);
      setIsMuted(false);
    };

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, []);

  // ====== 音量弹窗显示/隐藏（带延迟） ======
  const handleVolumeEnter = useCallback(() => {
    if (hideVolumeTimeoutRef.current) {
      clearTimeout(hideVolumeTimeoutRef.current);
      hideVolumeTimeoutRef.current = null;
    }
    setShowVolumeSlider(true);
  }, []);

  const handleVolumeLeave = useCallback(() => {
    // 延迟隐藏，给用户时间移动到弹窗
    hideVolumeTimeoutRef.current = setTimeout(() => {
      setShowVolumeSlider(false);
    }, 300);
  }, []);

  const handleSliderEnter = useCallback(() => {
    if (hideVolumeTimeoutRef.current) {
      clearTimeout(hideVolumeTimeoutRef.current);
      hideVolumeTimeoutRef.current = null;
    }
    setShowVolumeSlider(true);
  }, []);

  const handleSliderLeave = useCallback(() => {
    hideVolumeTimeoutRef.current = setTimeout(() => {
      setShowVolumeSlider(false);
    }, 300);
  }, []);

  // ====== 事件处理 ======
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 2) return;
    onSelect(e, e.shiftKey);
    if (!e.shiftKey) {
      onDragStart(e);
    }
  }, [onSelect, onDragStart]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e);
  }, [onContextMenu]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => setIsError(true));
    } else {
      videoRef.current.pause();
    }
  }, []);

  // 计算进度百分比
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  
  // 显示的音量值（静音时显示0）
  const displayVolume = isMuted ? 0 : volume;

  return (
    <div
      data-element-id={elementId}
      data-element-type="video"
      data-source-ids={(sourceIds || []).join(',')}
      style={{
        position: 'absolute',
        width,
        height,
        zIndex,
        cursor: 'default',
        borderRadius: '3%',
        contain: 'layout style', // #622 修复：去掉 size 和 paint，允许加号按钮溢出显示
        overflow: 'visible', // #621 加号按钮需要溢出显示
        userSelect: 'none',
        pointerEvents: 'auto',
        ...style,
      }}
      onPointerDown={handlePointerDown}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => onVideoMouseEnter?.(elementId)}
      onMouseLeave={() => onVideoMouseLeave?.(elementId)}
    >
      {/* #621 内层容器：裁剪视频内容到圆角内，外层 overflow: visible 允许加号按钮溢出 */}
      {/* #628 修复：保持 pointerEvents: 'none' 让点击穿透到外层（拖拽/选中），控制栏单独设 auto */}
      <div style={{
        position: 'absolute',
        inset: 0,
        borderRadius: '3%',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}>
      {/* #619 COS 上传中的虚化加载状态 */}
      {isLoading && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.3)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          pointerEvents: 'none',
          zIndex: 10,
          borderRadius: '3%',
        }}>
          <div style={{
            width: 36, height: 36,
            border: '3px solid rgba(255,255,255,0.3)',
            borderTop: '3px solid white',
            borderRadius: '50%',
            marginBottom: 8,
          }} />
          <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: 500 }}>
            上传中...
          </span>
        </div>
      )}

      {/* #723 视频生成中状态 - 玫瑰曲线动画 + 渐变背景 + 真实进度（与图片占位符统一） */}
      {generationStatus === 'generating' && (
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '3%',
          overflow: 'hidden',
          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(99, 102, 241, 0.25) 50%, rgba(56, 189, 248, 0.25) 100%)',
          pointerEvents: 'none',
          zIndex: 15,
        }}>
          <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%' }}>
            <CanvasRoseCurve color={roseColor} showDetail gradientBg externalProgress={generationProgress || 0} />
          </div>
          {/* 视频标签 */}
          {(() => {
            const baseSize = Math.min(width, height);
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

      {/* #7xx 视频生成失败状态 - 精美错误提示 */}
      {generationStatus === 'failed' && !isLoading && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(185,28,28,0.75)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          pointerEvents: 'none',
          zIndex: 15,
          borderRadius: '3%',
        }}>
          {/* 失败图标 */}
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}>
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          {/* 失败文字 */}
          <span style={{
            color: 'white',
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            marginBottom: 4,
          }}>
            生成失败
          </span>
          {/* 失败原因 */}
          {generationError && (
            <span style={{
              color: 'rgba(255,255,255,0.85)',
              fontSize: 11,
              maxWidth: '85%',
              textAlign: 'center',
              lineHeight: 1.4,
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}>
              {translateErrorMessage(generationError || '')}
            </span>
          )}
        </div>
      )}

      {/* 加载状态 */}
      {!isLoaded && !isError && !isLoading && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.1)',
          pointerEvents: 'none',
        }}>
          <div style={{
            width: 40, height: 40,
            border: '4px solid rgba(255,255,255,0.3)',
            borderTop: '4px solid white',
            borderRadius: '50%',
          }} />
        </div>
      )}

      {/* 错误状态 */}
      {isError && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(139,0,0,0.2)',
          pointerEvents: 'none',
        }}>
          <div style={{ textAlign: 'center' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="#ff6b6b">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            <span style={{ display: 'block', color: '#ff6b6b', fontSize: 12, marginTop: 8 }}>
              加载失败
            </span>
          </div>
        </div>
      )}

      {/* 视频本体 */}
      <video
        ref={videoRef}
        id={`video-${elementId}`}
        src={videoSrc}
        poster={posterSrc || undefined}
        muted={isMuted}
        loop
        playsInline
        preload="metadata"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
        }}
        onLoadedData={() => setIsLoaded(true)}
        onError={() => setIsError(true)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      {/* 视频标签 - 自适应大小（根据视频逻辑尺寸），整体缩小50% */}
      {(() => {
        // 直接使用视频的逻辑尺寸计算标签大小
        // 当视频拉伸时，width/height 会变化，标签大小会跟着变化
        const baseSize = Math.min(width, height);
        const scale = (baseSize / 200) * 0.5; // 以200px逻辑尺寸为基准，整体缩小50%
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
          }}>
            <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="white">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
            <span style={{ color: 'white', fontSize }}>{baseSize >= 80 ? '视频' : ''}</span>
          </div>
        );
      })()}

      {/* 底部控制栏：进度条 + 时间 + 播放按钮 + 音量 - 自适应缩放 */}
      {/* #628 修复：pointerEvents: 'auto' 让控制栏可交互（父层是 none） */}
      {(() => {
        // 以200px逻辑尺寸为基准，计算控制栏缩放比例，整体缩小到30%
        const controlScale = (Math.min(width, height) / 200) * 0.3;
        return (
        <div style={{
          position: 'absolute',
          bottom: -16 * controlScale,
          left: 0,
          right: 0,
          padding: `${32 * controlScale}px 0`,
          display: 'flex',
          alignItems: 'center',
          gap: 12 * controlScale,
          paddingLeft: 0,
          pointerEvents: 'auto',
        }}>
          {/* 播放/暂停按钮 - 四角圆弧 */}
          <div
            onPointerDown={handleTogglePlay}
            style={{
              width: 83 * controlScale,
              height: 83 * controlScale,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
              borderRadius: 20 * controlScale,
              marginLeft: 20 * controlScale,
            }}
          >
            {isPlaying ? (
              <svg width={48 * controlScale} height={48 * controlScale} viewBox="0 0 24 24" fill="white">
                <rect x="6" y="4" width="4" height="16" rx="1"/>
                <rect x="14" y="4" width="4" height="16" rx="1"/>
              </svg>
            ) : (
              <svg width={48 * controlScale} height={48 * controlScale} viewBox="0 0 24 24" fill="white">
                {/* 圆角三角形：上角和下角为圆角，右角为尖角 - 拉长版 */}
                <path d="M 10,5 Q 8,5 8,7 L 8,17 Q 8,19 10,19 L 20,12 Z"/>
              </svg>
            )}
          </div>

          {/* 进度条 - 白色已播放 + 白点 */}
          <div
            ref={progressRef}
            onPointerDown={handleProgressPointerDown}
            style={{
              flex: 1,
              height: 5 * controlScale,
              background: 'rgba(255,255,255,0.3)',
              borderRadius: 2 * controlScale,
              cursor: 'pointer',
              position: 'relative',
              overflow: 'visible',
            }}
          >
            {/* 已播放部分 - 白色 */}
            <div style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: `${progressPercent}%`,
              background: 'white',
              borderRadius: 2 * controlScale,
            }} />
            {/* 白色圆点 */}
            <div style={{
              position: 'absolute',
              left: `${progressPercent}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 16 * controlScale,
              height: 16 * controlScale,
              background: 'white',
              borderRadius: '50%',
              boxShadow: '0 0 6px rgba(255,255,255,0.8)',
              zIndex: 1,
            }} />
          </div>

          {/* 时间显示 */}
          <span style={{
            color: 'white',
            fontSize: 26 * controlScale,
            fontFamily: 'monospace',
            flexShrink: 0,
            minWidth: 130 * controlScale,
            textAlign: 'right',
          }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* 音量按钮 + 竖型滑块 */}
          <div
            ref={volumeRef}
            style={{
              position: 'relative',
              flexShrink: 0,
            }}
            onPointerLeave={handleVolumeLeave}
          >
            {/* 音量图标按钮 - 无圆圈 */}
            <div
              onPointerDown={handleToggleMute}
              onPointerEnter={handleVolumeEnter}
              style={{
                width: 64 * controlScale,
                height: 64 * controlScale,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              {isMuted || volume === 0 ? (
                <svg width={36 * controlScale} height={36 * controlScale} viewBox="0 0 24 24" fill="white">
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.83-.52 2.65l1.51 1.51C20.37 14.96 21 13.55 21 12c0-3.04-1.66-5.7-4.12-7.12l-1.01 1.01C17.7 7.17 19 9.43 19 12zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.58-1.45 1-2.25 1.28v2.14c1.45-.39 2.76-1.14 3.82-2.13L20.73 21 22 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                </svg>
              ) : volume < 0.5 ? (
                <svg width={36 * controlScale} height={36 * controlScale} viewBox="0 0 24 24" fill="white">
                  <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
                </svg>
              ) : (
                <svg width={36 * controlScale} height={36 * controlScale} viewBox="0 0 24 24" fill="white">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.52 7-8.77s-2.99-7.86-7-8.77z"/>
                </svg>
              )}
            </div>

            {/* 竖型音量滑块弹出层 */}
            {showVolumeSlider && (
              <div
                className="volume-slider"
                style={{
                  position: 'absolute',
                  bottom: 68 * controlScale,
                  right: 0,
                  width: 64 * controlScale,
                  height: 240 * controlScale,
                  background: 'rgba(80,80,80,0.6)',
                  borderRadius: 12 * controlScale,
                  padding: `${16 * controlScale}px 0`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8 * controlScale,
                }}
                onPointerEnter={handleSliderEnter}
                onPointerLeave={handleSliderLeave}
              >
                {/* 竖型滑块轨道 - 与进度条一致的白底白点样式 */}
                <div
                  className="volume-track"
                  onPointerDown={handleVolumePointerDown}
                  style={{
                    width: 12 * controlScale,
                    flex: 1,
                    background: 'rgba(255,255,255,0.3)',
                    borderRadius: 6 * controlScale,
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                    cursor: 'pointer',
                  }}
                >
                  {/* 已填充部分 - 白色 */}
                  <div style={{
                    width: '100%',
                    height: `${displayVolume * 100}%`,
                    background: 'white',
                    borderRadius: 6 * controlScale,
                  }} />
                  {/* 白色圆点 */}
                  <div style={{
                    position: 'absolute',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    bottom: `${displayVolume * 100}%`,
                    width: 16 * controlScale,
                    height: 16 * controlScale,
                    background: 'white',
                    borderRadius: '50%',
                    boxShadow: '0 0 6px rgba(255,255,255,0.8)',
                    zIndex: 1,
                  }} />
                </div>
                {/* 音量数值 - 无%符号 */}
                <span style={{ color: 'white', fontSize: 16 * controlScale, fontWeight: 'bold' }}>
                  {Math.round(displayVolume * 100)}
                </span>
              </div>
            )}
          </div>
        </div>
        );
      })()}
      </div>

      {/* 选中边框 - #624 修复：圆角与图片选中框一致（3%而非6px） */}
      {isSelected && (
        <div style={{
          position: 'absolute',
          inset: -2,
          border: '2px solid #3b82f6',
          borderRadius: '3%',
          pointerEvents: 'none',
        }} />
      )}

      {/* #621 磁吸感应区加号按钮 - 与图片加号样式一致 */}
      {!isInMultiSelect && !isLoading && (
        <div
          className="node-connection-port-hitbox"
          data-plus-btn={elementId}
          style={{
            position: 'absolute',
            left: 'calc(100% + 8px)',
            top: '50%',
            transform: 'translateY(-50%)',
            width: `${(() => { const avgSize = Math.min(width, height); const buttonSize = avgSize * 0.05; return buttonSize + 15; })()}px`,
            height: `${(() => { const avgSize = Math.min(width, height); const buttonSize = avgSize * 0.05; return buttonSize + 15; })()}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0,
            pointerEvents: 'none',
            zIndex: 250,
            transition: 'opacity 0.15s ease-out',
          }}
        >
          <div
            id={`magnet-btn-${elementId}`}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {(() => {
              const avgSize = Math.min(width, height);
              const buttonSize = avgSize * 0.05;
              const iconSizePlus = Math.round(buttonSize * 0.6);
              return (
                <div
                  style={{
                    width: buttonSize,
                    height: buttonSize,
                    background: 'linear-gradient(135deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.05) 100%)',
                    border: '2px solid rgba(0,0,0,0.7)',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                    transform: 'scale(1.1)',
                    transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                    pointerEvents: 'auto',
                    cursor: 'crosshair',
                  }}
                  onPointerDown={(e) => onPlusPointerDown?.(e, el || { id: elementId, type: 'video', x: 0, y: 0, width, height })}
                  onPointerMove={(e) => onPlusPointerMove?.(e, el || { id: elementId, type: 'video', x: 0, y: 0, width, height })}
                  onPointerUp={(e) => onPlusPointerUp?.(e)}
                  onPointerCancel={(e) => onPlusPointerCancel?.(e)}
                  onMouseDown={(e) => { e.stopPropagation(); }}
                >
                  <svg style={{ pointerEvents: 'none' }} width={iconSizePlus} height={iconSizePlus} viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.8)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}, function areEqual(prevProps: CanvasVideoProps, nextProps: CanvasVideoProps) {
  // #60fps Phase2: 严格 memo 比较函数，阻止拖拽连线时的无效重渲染
  // 只有核心数据变化才允许重渲染
  if (prevProps.elementId !== nextProps.elementId) return false;
  if (prevProps.videoSrc !== nextProps.videoSrc) return false;
  if (prevProps.posterSrc !== nextProps.posterSrc) return false;
  if (prevProps.width !== nextProps.width) return false;
  if (prevProps.height !== nextProps.height) return false;
  if (prevProps.zoom !== nextProps.zoom) return false;
  if (prevProps.isSelected !== nextProps.isSelected) return false;
  if (prevProps.zIndex !== nextProps.zIndex) return false;
  if (prevProps.isLoading !== nextProps.isLoading) return false;
  if (prevProps.generationStatus !== nextProps.generationStatus) return false;
  if (prevProps.generationProgress !== nextProps.generationProgress) return false;
  if (prevProps.generationError !== nextProps.generationError) return false;
  if (prevProps.isInMultiSelect !== nextProps.isInMultiSelect) return false;
  if (prevProps.plusButtonSize !== nextProps.plusButtonSize) return false;
  if (prevProps.style?.left !== nextProps.style?.left) return false;
  if (prevProps.style?.top !== nextProps.style?.top) return false;
  
  // #60fps Phase2: isBeingSnapped/isAlreadyConnected 变化不触发重渲染
  // 视觉效果由 CSS class (.snap-highlight-active / .is-dimmed) 控制
  // sourceIds 变化不影响视频渲染本身
  
  return true; // 所有核心 props 相等，跳过重渲染
});
