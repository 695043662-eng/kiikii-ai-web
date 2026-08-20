'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';

// ============================================
// 数据类型定义
// ============================================

/**
 * 轮播项数据模型
 * 
 * 架构原则：
 * - 只存 objectKey（COS 对象路径或本地静态路径），绝不存签名URL
 * - 渲染时通过 getMediaUrl() 实时构造代理URL
 * - 本地静态路径以 / 开头（如 /carousel-defaults/1.jpg）
 * - COS ObjectKey 不以 / 开头（如 dev/canvas/2026-05/xxx.png）
 */
export interface CarouselItem {
  id: string | number;          // 数据库 id 或临时 id
  mediaType?: 'video' | 'image'; // 媒体类型：视频或图片（含GIF）
  objectKey: string;            // COS ObjectKey 或本地静态路径
  title: string;
  subtitle?: string;
  tag?: string;
  sortOrder?: number;           // 排序权重
}

/**
 * 从 objectKey 构造媒体 URL
 * 🔥 #826 perm + CDN域名已配置 → 直连 CDN 静态链接（跳过代理，支持 Range 分段加载）
 * - 本地静态路径（以 / 开头）：直接使用
 * - CDN可用 + COS ObjectKey → 直连 CDN（https://assets.kiikii.me/xxx）
 * - CDN不可用 + COS ObjectKey → 走代理（/api/canvas/image?key=xxx&assetType=perm）
 * #804 双桶分离：轮播图在2号桶(perm)，必须带assetType参数
 */
export function getMediaUrl(objectKey: string): string {
  if (!objectKey) return '';
  // 本地静态资源（如 /carousel-defaults/1.jpg）
  if (objectKey.startsWith('/')) return objectKey;

  // 🔥 #826 perm CDN 直连：跳过代理，Cloudflare 自动接管 Range 分段加载
  const permCdnDomain = process.env.NEXT_PUBLIC_COS_CDN_DOMAIN_PERM || '';
  if (permCdnDomain) {
    return `https://${permCdnDomain}/${objectKey}`;
  }

  // 降级：COS 对象通过代理获取，带perm桶标记
  return `/api/canvas/image?key=${encodeURIComponent(objectKey)}&assetType=perm`;
}

/**
 * 🔥 判断 objectKey 是否为视频文件（MP4/WebM）
 * 视频文件用 <video autoPlay loop muted playsInline> 渲染
 * 硬件加速解码 + loop 属性保证无限循环，性能远优于动态 WebP
 */
function isVideoFile(objectKey: string): boolean {
  if (!objectKey) return false;
  return /\.(mp4|webm)$/i.test(objectKey);
}

interface HeroCarouselProps {
  items: CarouselItem[];
  autoPlayInterval?: number;
  onDoubleClick?: (id: string | number) => void; // 双击编辑回调
  onDelete?: (id: string | number) => void; // 删除回调
  isAdjustMode?: boolean; // 调节模式
}

// ============================================
// 3D 景深视频轮播组件
// ============================================

export default function HeroCarousel({ items, autoPlayInterval = 5000, onDoubleClick, onDelete, isAdjustMode = false }: HeroCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [mediaErrors, setMediaErrors] = useState<Set<string | number>>(new Set());
  const [dragOffset, setDragOffset] = useState(0); // 连续偏移量（分数索引），用于丝滑拖拽
  const [isDraggingState, setIsDraggingState] = useState(false);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoPlayRef = useRef<NodeJS.Timeout | null>(null);
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeIndexRef = useRef(0);
  // 丝滑拖拽相关 refs
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const lastClientXRef = useRef(0);
  const velocityRef = useRef(0);
  const hasDraggedRef = useRef(false);
  const dragOffsetRef = useRef(0);

  // 同步 activeIndex 到 ref
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  // 同步 dragOffset 到 ref
  useEffect(() => {
    dragOffsetRef.current = dragOffset;
  }, [dragOffset]);

  // 媒体加载失败处理
  const handleMediaError = (itemId: string | number) => {
    console.error('[HeroCarousel] 媒体加载失败, objectKey:', items.find(i => i.id === itemId)?.objectKey);
    setMediaErrors(prev => new Set(prev).add(itemId));
  };

  // items 变化时清除所有错误状态
  useEffect(() => {
    if (mediaErrors.size > 0) {
      setMediaErrors(new Set());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // 切换到指定索引（使用 ref 避免闭包陷阱）
  const isTransitioningRef = useRef(false);
  const goToSlide = useCallback((index: number) => {
    if (isTransitioningRef.current) return;
    isTransitioningRef.current = true;
    setIsTransitioning(true);
    
    // 暂停当前视频（使用 ref 获取最新的 activeIndex）
    const currentActive = activeIndexRef.current;
    const currentVideo = videoRefs.current[currentActive];
    if (currentVideo) {
      currentVideo.pause();
      currentVideo.currentTime = 0;
    }

    setActiveIndex(index);
    
    setTimeout(() => {
      isTransitioningRef.current = false;
      setIsTransitioning(false);
    }, 500);
  }, []);

  // 下一张
  const goNext = useCallback(() => {
    const nextIndex = (activeIndexRef.current + 1) % items.length;
    goToSlide(nextIndex);
  }, [items.length, goToSlide]);

  // 上一张
  const goPrev = useCallback(() => {
    const prevIndex = (activeIndexRef.current - 1 + items.length) % items.length;
    goToSlide(prevIndex);
  }, [items.length, goToSlide]);

  // 自动播放（用户交互后暂停 8 秒再恢复）
  const userInteractedRef = useRef(false);

  useEffect(() => {
    if (items.length <= 1) return;
    
    const startAutoPlay = () => {
      if (autoPlayRef.current) clearInterval(autoPlayRef.current);
      autoPlayRef.current = setInterval(() => {
        goNext();
      }, autoPlayInterval);
    };

    if (userInteractedRef.current) {
      // 用户刚交互过，8 秒后恢复自动播放
      const resumeTimer = setTimeout(() => {
        userInteractedRef.current = false;
        startAutoPlay();
      }, 8000);
      return () => clearTimeout(resumeTimer);
    } else {
      startAutoPlay();
    }

    return () => {
      if (autoPlayRef.current) {
        clearInterval(autoPlayRef.current);
      }
    };
  }, [goNext, autoPlayInterval, items.length]);

  // 用户手动切换时标记交互
  const handleUserNavigate = useCallback((direction: 'prev' | 'next') => {
    userInteractedRef.current = true;
    if (autoPlayRef.current) {
      clearInterval(autoPlayRef.current);
      autoPlayRef.current = null;
    }
    if (direction === 'prev') goPrev();
    else goNext();
  }, [goPrev, goNext]);

  // 播放当前视频
  useEffect(() => {
    const activeVideo = videoRefs.current[activeIndex];
    if (activeVideo) {
      activeVideo.play().catch(() => {
        // 自动播放被阻止，忽略错误
      });
    }
  }, [activeIndex]);

  // 删除后 activeIndex 修正
  useEffect(() => {
    if (items.length === 0) return;
    if (activeIndex >= items.length) {
      setActiveIndex(items.length - 1);
    }
  }, [items.length, activeIndex]);

  // 清理：组件卸载时清除定时器
  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
      }
      videoRefs.current = [];
    };
  }, []);

  // ============ 丝滑拖拽系统 ============

  const handleDragStart = useCallback((clientX: number) => {
    if (items.length <= 1) return;
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    dragStartXRef.current = clientX;
    lastClientXRef.current = clientX;
    velocityRef.current = 0;
    setIsDraggingState(true);
    // 拖拽期间暂停自动播放
    userInteractedRef.current = true;
    if (autoPlayRef.current) {
      clearInterval(autoPlayRef.current);
      autoPlayRef.current = null;
    }
  }, [items.length]);

  const handleDragMove = useCallback((clientX: number) => {
    if (!isDraggingRef.current) return;
    const deltaX = clientX - dragStartXRef.current;
    if (!hasDraggedRef.current && Math.abs(deltaX) > 5) {
      hasDraggedRef.current = true;
    }
    const containerWidth = containerRef.current?.offsetWidth || 800;
    // 拖拽距离 → 分数索引偏移（负deltaX=向左拖=下一张=正偏移）
    const fractionalOffset = -deltaX / (containerWidth * 0.28);
    velocityRef.current = -(clientX - lastClientXRef.current) / (containerWidth * 0.28);
    lastClientXRef.current = clientX;
    setDragOffset(fractionalOffset);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDraggingState(false);
    // 没有实际拖动 → 当作点击，不切换
    if (!hasDraggedRef.current) {
      setDragOffset(0);
      return;
    }
    // 惯性：速度 × 系数
    const momentumOffset = velocityRef.current * 5;
    const totalOffset = dragOffsetRef.current + momentumOffset;
    let newActiveIndex = activeIndexRef.current + Math.round(totalOffset);
    newActiveIndex = ((newActiveIndex % items.length) + items.length) % items.length;
    // 暂停当前视频
    const currentVideo = videoRefs.current[activeIndexRef.current];
    if (currentVideo) {
      currentVideo.pause();
      currentVideo.currentTime = 0;
    }
    setActiveIndex(newActiveIndex);
    setDragOffset(0);
  }, [items.length]);

  // 全局监听：拖拽时鼠标移出容器仍能跟踪
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => { handleDragMove(e.clientX); };
    const onTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      handleDragMove(e.touches[0].clientX);
    };
    const onEnd = () => { handleDragEnd(); };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [handleDragMove, handleDragEnd]);

  // 处理卡片点击（区分单击切换和双击编辑）
  const handleCardClick = (index: number) => {
    // 拖拽后不触发点击
    if (hasDraggedRef.current) return;
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      if (onDoubleClick && items[index]) {
        onDoubleClick(items[index].id);
      }
    } else {
      clickTimeoutRef.current = setTimeout(() => {
        clickTimeoutRef.current = null;
        goToSlide(index);
      }, 250);
    }
  };

  const getCardStyle = (index: number): React.CSSProperties => {
    const effectiveActive = activeIndex + dragOffset;
    const diff = index - effectiveActive;
    const total = items.length;
    
    let normalizedDiff = diff;
    if (diff > total / 2) normalizedDiff = diff - total;
    if (diff < -total / 2) normalizedDiff = diff + total;

    const absDiff = Math.abs(normalizedDiff);
    
    // 隐藏远离中心的卡片（只显示中心±2=最多5张，保证切换动画流畅）
    if (absDiff > 2) {
      return {
        opacity: 0,
        transform: `translateX(${normalizedDiff * 100}%) scale(0.5)`,
        zIndex: 0,
        pointerEvents: 'none',
      };
    }

    // translateX 100% = 零重叠（卡片边缘刚好相切）
    const translateX = normalizedDiff * 100;
    const translateZ = -absDiff * 60;
    const rotateY = normalizedDiff * -6;
    const scale = 1 - absDiff * 0.06;
    // absDiff=0: opacity=1, absDiff=1: opacity=0.85, absDiff=2: opacity=0
    // 切换时 absDiff=2 的卡片短暂可见（动画中间态），静止时几乎透明
    const opacity = absDiff === 2 ? 0 : Math.max(0, 1 - absDiff * 0.15);

    return {
      transform: `translateX(${translateX}%) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
      opacity,
      zIndex: 10 - Math.round(absDiff),
      pointerEvents: absDiff >= 2 ? 'none' : undefined,
      transition: isDraggingRef.current ? 'none' : 'all 0.6s cubic-bezier(0.25, 0.1, 0.25, 1)',
    };
  };

  if (!items || items.length === 0) return null;

  return (
    <div className="w-full relative mt-4">
      {/* 3D 轮播容器 - 适配16:9横屏视频 */}
      <div
        ref={containerRef}
        className="relative w-full h-[145px] md:h-[339px] overflow-hidden select-none"
        style={{ perspective: '1000px', cursor: isDraggingState ? 'grabbing' : 'grab' }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.preventDefault();
          handleDragStart(e.clientX);
        }}
        onTouchStart={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          handleDragStart(e.touches[0].clientX);
        }}
        onDragStart={(e) => e.preventDefault()}
      >
        {/* 卡片列表 */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ transformStyle: 'preserve-3d' }}
        >
          {items.map((item, index) => {
            const mediaUrl = getMediaUrl(item.objectKey);
            return (
              <div
                key={item.id}
                className="absolute w-[55%] md:w-[28%] aspect-video rounded-xl overflow-hidden shadow-xl cursor-pointer"
                style={getCardStyle(index)}
                onClick={() => handleCardClick(index)}
              >
                {/* 视频/图片 - 从 objectKey 实时构造 URL */}
                {mediaErrors.has(item.id) ? (
                  <div className="w-full h-full bg-gray-300 flex items-center justify-center">
                    <div className="text-center text-gray-500">
                      <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span className="text-xs">加载失败</span>
                    </div>
                  </div>
                ) : item.mediaType === 'video' || isVideoFile(item.objectKey) ? (
                  <video
                    ref={(el) => { videoRefs.current[index] = el; }}
                    src={mediaUrl}
                    autoPlay
                    muted
                    playsInline
                    loop
                    preload="auto"
                    className="w-full h-full object-cover"
                    onError={() => handleMediaError(item.id)}
                  />
                ) : (
                  <Image
                    src={mediaUrl}
                    alt={item.title}
                    fill
                    sizes="(max-width: 768px) 55vw, 28vw"
                    className="object-cover"
                    priority
                    onError={() => handleMediaError(item.id)}
                  />
                )}

                {/* 调节模式：删除按钮 */}
                {isAdjustMode && index === activeIndex && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete?.(item.id); }}
                    className="absolute top-3 right-3 w-8 h-8 bg-black/60 hover:bg-red-500 text-white rounded-full flex items-center justify-center transition-all z-30"
                    title="删除此轮播项"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}



                {/* 非激活卡片遮罩 */}
                {index !== activeIndex && (
                  <div className="absolute inset-0 bg-black/40 transition-opacity duration-500" />
                )}

                {/* 底部渐变遮罩 + 文字 */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 md:p-5">
                  {item.tag && (
                    <span className="inline-block px-2 py-0.5 mb-2 text-[10px] font-medium bg-white/20 rounded-full text-white">
                      {item.tag}
                    </span>
                  )}
                  
                  {item.subtitle && (
                    <p className="text-white/80 text-xs mb-1 line-clamp-1">
                      {item.subtitle}
                    </p>
                  )}
                  
                  <h2 className="text-white text-base md:text-lg font-bold line-clamp-1">
                    {item.title}
                  </h2>
                </div>
              </div>
            );
          })}
        </div>

        {/* 左箭头 */}
        <button
          onClick={(e) => { e.stopPropagation(); handleUserNavigate('prev'); }}
          className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 w-10 h-10 md:w-12 md:h-12 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/40 flex items-center justify-center transition-all duration-300 z-20"
          aria-label="上一张"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white">
            <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* 右箭头 */}
        <button
          onClick={(e) => { e.stopPropagation(); handleUserNavigate('next'); }}
          className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 w-10 h-10 md:w-12 md:h-12 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/40 flex items-center justify-center transition-all duration-300 z-20"
          aria-label="下一张"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white">
            <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* 分页指示器 */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-20">
          {items.map((_, index) => (
            <button
              key={index}
              onClick={() => goToSlide(index)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                index === activeIndex
                  ? 'w-8 bg-white'
                  : 'w-2 bg-white/50 hover:bg-white/70'
              }`}
              aria-label={`第 ${index + 1} 张`}
            />
          ))}
        </div>
      </div>

      {/* CTA 按钮组 */}
      <div className="flex items-center justify-center gap-4 py-6">
        <Link
          href="/canvas"
          className="flex items-center gap-2 px-6 py-3 rounded-xl border border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm transition-all duration-300 hover:shadow-lg"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-cyan-500">
            <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">开始创作</span>
        </Link>

        <Link
          href="/video"
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gray-800 dark:bg-gray-700 hover:bg-gray-900 dark:hover:bg-gray-600 transition-all duration-300 hover:shadow-lg"
        >
          <span className="text-sm font-medium text-white">快速体验</span>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-white">
            <path d="M3 8H13M10 5L13 8L10 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>
      </div>
    </div>
  );
}
