'use client';

import { useState, useRef, useCallback, memo, useMemo } from 'react';
import Image from 'next/image';
import { Heart, Download, Plus, Send, Sparkles, X, Image as ImageIcon, GripVertical } from 'lucide-react';

/* ============================================================
   军师 PRD - 卡片组件 (AssetCard)
   - 默认态：图片 + 左上角类型标签
   - 视频卡片：autoPlay muted loop 循环播放
   - Hover 态：底部渐变遮罩 + 操作栏（仅覆盖底部，不阻挡视频）
   - 右上角微交互：点赞/下载/添加图标
   - 🔥 #803 修复：视频提取为 React.memo 子组件，hover 状态变化不会导致视频 DOM 重渲染/重启
   - #813 编辑模式：拖拽把手替代上/下按钮
   ============================================================ */

/**
 * #821 将 COS 签名 URL 或 objectKey 转换为后端代理 URL
 * 
 * 为什么需要：
 * - 展示区 imageUrl 在数据库中存储的是 COS 签名 URL（如 https://xxx.cos.ap-hongkong.myqcloud.com/dev/canvas/...?q-sign-algorithm=...）
 * - sandbox/开发环境浏览器无法直连 COS 域名（ERR_CONNECTION_CLOSED）
 * - 必须通过后端代理 /api/canvas/image 流式获取图片
 * 
 * 转换规则：
 * - 代理 URL（/api/...）→ 直接返回
 * - 本地静态路径（/xxx）→ 直接返回
 * - COS objectKey（dev/xxx 或 prod/xxx）→ 构造代理 URL
 * - COS 签名 URL（https://xxx.cos.ap-hongkong.myqcloud.com/dev/...）→ 提取 objectKey → 构造代理 URL
 * - 其他 URL → 直接返回（如外部 CDN 链接）
 */
/**
 * 🔥 #826 将 URL 转换为代理 URL 或直连 CDN URL
 * - perm + CDN域名已配置 → 直连 CDN 静态链接（https://assets.kiikii.me/xxx，不带签名）
 * - 其他 → 走 /api/canvas/image 代理
 */
export function toProxyUrl(url: string, assetType: 'temp' | 'perm' = 'perm'): string {
  if (!url) return '';
  // 已经是代理 URL
  if (url.startsWith('/api/')) return url;
  // 本地静态路径
  if (url.startsWith('/')) return url;

  // 🔥 #826 perm + CDN域名已配置：直连 CDN 静态链接（跳过代理，减少 1 次 RTT）
  const permCdnDomain = process.env.NEXT_PUBLIC_COS_CDN_DOMAIN_PERM || '';
  if (assetType === 'perm' && permCdnDomain) {
    // COS objectKey（如 dev/canvas/xxx.png 或 prod/showcase/xxx.png）
    if (url.startsWith('dev/') || url.startsWith('prod/')) {
      return `https://${permCdnDomain}/${url}`;
    }
    // #833 兼容旧数据：showcase/xxx.png 或 canvas/xxx.png（缺少 ENV_PREFIX）
    if (url.startsWith('showcase/') || url.startsWith('canvas/')) {
      // 不确定 dev/ 还是 prod/，走代理更安全
      return `/api/canvas/image?key=${encodeURIComponent(url)}&assetType=${assetType}`;
    }
    // COS 签名 URL → 提取 objectKey → 直连 CDN
    try {
      const parsed = new URL(url);
      const objectKey = parsed.pathname.substring(1);
      if (objectKey && (objectKey.startsWith('dev/') || objectKey.startsWith('prod/'))) {
        return `https://${permCdnDomain}/${objectKey}`;
      }
    } catch {
      // 不是有效 URL，忽略
    }
  }

  // temp 桶 或 perm 无 CDN：走代理
  // COS objectKey（如 dev/canvas/2026-07/xxx.png）
  if (url.startsWith('dev/') || url.startsWith('prod/')) {
    return `/api/canvas/image?key=${encodeURIComponent(url)}&assetType=${assetType}`;
  }
  // #833 兼容旧数据：showcase/xxx.png 或 canvas/xxx.png（缺少 ENV_PREFIX 的 COS key）
  // 审核通过后存储的 key 可能缺少 dev/prod 前缀，代理端点会自动补全
  if (url.startsWith('showcase/') || url.startsWith('canvas/')) {
    return `/api/canvas/image?key=${encodeURIComponent(url)}&assetType=${assetType}`;
  }
  // COS 签名 URL - 提取 objectKey
  try {
    const parsed = new URL(url);
    const objectKey = parsed.pathname.substring(1); // 去掉开头的 /
    if (objectKey && (objectKey.startsWith('dev/') || objectKey.startsWith('prod/'))) {
      return `/api/canvas/image?key=${encodeURIComponent(objectKey)}&assetType=${assetType}`;
    }
  } catch {
    // 不是有效 URL，忽略
  }
  // 其他 URL（外部 CDN 等）直接返回
  return url;
}

export interface CardData {
  id: string;
  imageUrl: string;
  tag?: string;
  title?: string;
  subtitle?: string;
  likes?: number;
  aspectRatio?: number;
  gridSpan?: number;
  sortOrder?: number;
  category?: string;
  builtInModel?: string;
  builtInPrompt?: string;
  builtInReferenceImage?: string;
  referenceImages?: string[];
  displayReferenceImage?: string;
  builtInAspectRatio?: string;
  builtInResolution?: string;
  builtInDuration?: string; // #819 新增时长字段
  builtInVideoUrl?: string;
}

interface AssetCardProps {
  data: CardData;
  onLikeClick?: (id: string) => void;
  onDownloadClick?: (id: string) => void;
  onAddClick?: (id: string) => void;
  onDuplicateClick?: (id: string) => void;
  onSendToAgent?: (id: string) => void;
  onViewInspiration?: (id: string) => void;
  isAdjustMode?: boolean;
  onDeleteClick?: () => void;
  onDoubleClick?: (id: string) => void;
  onPointerDragStart?: (id: string, e: React.PointerEvent) => void;
}

/* 🔥 #803 核心修复：VideoPlayer 独立 React.memo 组件 */
const VideoPlayer = memo(function VideoPlayer({
  src,
  onError,
}: {
  src: string;
  onError: () => void;
}) {
  return (
    <video
      src={src}
      className="absolute inset-0 w-full h-full object-contain"
      muted
      loop
      playsInline
      autoPlay
      preload="auto"
      onError={onError}
    />
  );
});

export default function AssetCard({
  data,
  onLikeClick,
  onDownloadClick,
  onAddClick,
  onDuplicateClick,
  onSendToAgent,
  onViewInspiration,
  isAdjustMode = false,
  onDeleteClick,
  onDoubleClick,
  onPointerDragStart,
}: AssetCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(data.likes ?? 0);
  const [mediaError, setMediaError] = useState(false);

  const isVideo = !!data.builtInVideoUrl;

  // 🛡️ #816 移除 Date.now() 缓存破坏：避免每次组件重渲染/筛选切换产生新 COS 请求
  // 根因：Date.now() 使每次渲染生成唯一 URL → 浏览器无法缓存 → 每次 = 1次 getSignedUrl + 1次 COS 读取
  // 代理端点已自带 max-age=300 缓存头，不需要客户端手动破坏缓存
  // #821 COS 签名 URL 转代理 URL（开发环境浏览器无法直连 COS）
  const stableImageUrl = useMemo(() => toProxyUrl(data.imageUrl || ''), [data.imageUrl]);
  const stableVideoUrl = useMemo(() => toProxyUrl(data.builtInVideoUrl || ''), [data.builtInVideoUrl]);
  const stableRefImageUrl = useMemo(() => data.displayReferenceImage ? toProxyUrl(data.displayReferenceImage) : undefined, [data.displayReferenceImage]);

  const handleMediaError = useCallback(() => {
    setMediaError(true);
  }, []);

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLiked(!isLiked);
    setLikeCount((prev) => (isLiked ? prev - 1 : prev + 1));
    onLikeClick?.(data.id);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDownloadClick?.(data.id);
  };

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddClick?.(data.id);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isAdjustMode) {
      onDoubleClick?.(data.id);
    }
  };

  return (
    <div
      className="group relative rounded-xl overflow-hidden cursor-pointer bg-gray-100 w-full h-full"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDoubleClick={handleDoubleClick}
    >
      {/* 媒体内容：图片或视频 */}
      {mediaError ? (
        <div className="absolute inset-0 w-full h-full bg-gray-200 flex items-center justify-center">
          <div className="text-center text-gray-500">
            <ImageIcon className="w-8 h-8 mx-auto mb-1 opacity-50" />
            <span className="text-xs">加载失败</span>
          </div>
        </div>
      ) : isVideo ? (
        <VideoPlayer src={stableVideoUrl} onError={handleMediaError} />
      ) : (
        <Image
          src={stableImageUrl}
          alt={data.title || ''}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          loading="lazy"
          onError={handleMediaError}
        />
      )}

      {/* 左下角参考图 */}
      {data.displayReferenceImage && (
        <div className="absolute bottom-3 left-3" style={{ zIndex: 15 }}>
          <div className="relative w-[96px] h-[96px] bg-white p-[3px] rounded-md shadow-md overflow-hidden">
            <Image
              src={stableRefImageUrl || ''}
              alt="参考图"
              fill
              sizes="96px"
              className="object-cover rounded-sm"
              loading="lazy"
            />
          </div>
        </div>
      )}

      {/* 左上角类型标签 */}
      {data.tag && (
        <div className="absolute top-1.5 left-1.5 z-10">
          <span className="px-1.5 py-0.5 bg-white/90 rounded text-[9px] font-medium text-gray-700">
            {data.tag}
          </span>
        </div>
      )}

      {/* 右上角微交互图标 - hover 时显示（调节模式下隐藏，用删除按钮替代） */}
      {!isAdjustMode && (
        <div
          className={`absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 transition-opacity duration-200 ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <button
            onClick={handleLike}
            className="w-5 h-5 bg-black/50 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
          >
            <Heart className={`w-2.5 h-2.5 ${isLiked ? 'fill-red-500 text-red-500' : 'text-white'}`} />
          </button>
          <button
            onClick={handleDownload}
            className="w-5 h-5 bg-black/50 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
          >
            <Download className="w-2.5 h-2.5 text-white" />
          </button>
          <button
            onClick={handleAdd}
            className="w-5 h-5 bg-black/50 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
          >
            <Plus className="w-2.5 h-2.5 text-white" />
          </button>
        </div>
      )}

      {/* Hover 遮罩层 */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 transition-opacity duration-200 pointer-events-none ${
          isHovered ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="bg-gradient-to-t from-black/80 via-black/50 to-transparent pt-10 pb-2">
          {data.title && (
            <div className="px-2 pb-1.5">
              <h3 className="text-[11px] font-medium text-white truncate">{data.title}</h3>
              {data.subtitle && (
                <p className="text-[9px] text-white/70 truncate mt-0.5">{data.subtitle}</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between px-2 pb-2 pt-0.5 pointer-events-auto">
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleLike}
                className="flex items-center gap-0.5 text-white/80 hover:text-white transition-colors"
              >
                <Heart className={`w-2.5 h-2.5 ${isLiked ? 'fill-red-500 text-red-500' : ''}`} />
                <span className="text-[10px]">{likeCount}</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicateClick?.(data.id);
                }}
                className="flex items-center gap-0.5 px-1.5 py-1 bg-white/20 hover:bg-white/30 rounded-md text-white text-[10px] font-medium transition-colors"
              >
                <Sparkles className="w-2.5 h-2.5" />
                一键同款
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSendToAgent?.(data.id);
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-white text-xs font-medium transition-colors"
              >
                <Send className="w-3 h-3" />
                发送至Agent
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 查看灵感按钮 */}
      {data.category === 'inspiration' && (
        <div
          className={`absolute bottom-3 right-3 z-30 transition-opacity duration-200 ${
            isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewInspiration?.(data.id);
            }}
            className="px-3 py-1.5 bg-white/90 hover:bg-white dark:bg-gray-800/90 dark:hover:bg-gray-800 rounded-full text-xs font-medium text-gray-800 dark:text-gray-200 transition-colors"
          >
            查看灵感
          </button>
        </div>
      )}

      {/* #813 编辑模式：拖拽把手 + 删除按钮（删除上/下按钮） */}
      {isAdjustMode && (
        <>
          {/* 拖拽把手（左上角，整个卡片上部区域可拖拽） */}
          <div
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPointerDragStart?.(data.id, e);
            }}
            className="absolute top-0 left-0 right-0 h-12 z-40 flex items-center px-2 cursor-grab active:cursor-grabbing touch-none"
            title="按住拖动调整位置"
          >
            <div className="w-8 h-8 bg-blue-500 hover:bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-lg transition-colors">
              <GripVertical className="w-5 h-5" />
            </div>
          </div>
          {/* 删除按钮（右上角） */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              console.log('[AssetCard] 删除按钮点击, id:', data.id);
              onDeleteClick?.();
            }}
            className="absolute top-2 right-2 z-40 w-7 h-7 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white shadow-lg transition-colors"
            title="删除此卡片"
          >
            <X className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}
