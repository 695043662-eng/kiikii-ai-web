'use client';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

// 图片数据类型（包含任务ID和图片索引）
export interface ImageData {
  taskId: string;
  imageIndex: number;
  url: string;
}

interface ImagePreviewProps {
  images: string[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  // 跨任务切换支持
  allImagesData?: ImageData[];
  onNavigate?: (taskId: string, imageIndex: number) => void;
  // 当图片被删除导致索引无效时的回调
  onInvalidIndex?: () => void;
}

export default function ImagePreview({ 
  images, 
  currentIndex, 
  isOpen, 
  onClose,
  allImagesData,
  onNavigate,
  onInvalidIndex,
}: ImagePreviewProps) {
  // 使用外部传入的 currentIndex，不再维护内部状态
  // 这样可以保证删除图片后索引同步更新

  // 键盘事件处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        // 只在不是第一张时切换到上一张
        if (currentIndex > 0) {
          // 通知父组件更新选中状态
          if (allImagesData && onNavigate) {
            const img = allImagesData[currentIndex - 1];
            if (img) onNavigate(img.taskId, img.imageIndex);
          }
        }
      } else if (e.key === 'ArrowRight') {
        // 只在不是最后一张时切换到下一张
        if (currentIndex < images.length - 1) {
          // 通知父组件更新选中状态
          if (allImagesData && onNavigate) {
            const img = allImagesData[currentIndex + 1];
            if (img) onNavigate(img.taskId, img.imageIndex);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, images.length, onClose, currentIndex, allImagesData, onNavigate]);

  // 禁用背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // 当图片数组或索引变化时，检查并自动调整
  useEffect(() => {
    if (isOpen) {
      if (images.length === 0) {
        // 图片数组为空，关闭预览
        onInvalidIndex?.();
        onClose();
      } else if (currentIndex >= images.length || currentIndex < 0) {
        // 当前索引超出范围，调整到有效范围
        const validIndex = Math.max(0, Math.min(currentIndex, images.length - 1));
        if (allImagesData && onNavigate && allImagesData[validIndex]) {
          const img = allImagesData[validIndex];
          if (img) onNavigate(img.taskId, img.imageIndex);
        }
      }
    }
  }, [images, currentIndex, isOpen, allImagesData, onNavigate, onClose, onInvalidIndex]);

  if (!isOpen || images.length === 0 || currentIndex < 0 || currentIndex >= images.length) return null;

  const currentImage = images[currentIndex];

  const handleDownload = async () => {
    try {
      const response = await fetch(currentImage);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `generated-image-${currentIndex + 1}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('下载失败:', error);
      toast.error('下载失败，请重试');
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      // 通知父组件更新选中状态
      if (allImagesData && onNavigate) {
        const img = allImagesData[currentIndex - 1];
        if (img) onNavigate(img.taskId, img.imageIndex);
      }
    }
  };

  const handleNext = () => {
    if (currentIndex < images.length - 1) {
      // 通知父组件更新选中状态
      if (allImagesData && onNavigate) {
        const img = allImagesData[currentIndex + 1];
        if (img) onNavigate(img.taskId, img.imageIndex);
      }
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center select-none"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.9)', userSelect: 'none', WebkitUserSelect: 'none' }}
      onClick={onClose}
      onDoubleClick={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="relative w-full h-full flex flex-col">
        {/* 顶部工具栏 */}
        <div className="absolute top-0 left-0 right-0 z-10 flex justify-between items-center p-4">
          <div className="text-white text-sm">
            {currentIndex + 1} / {images.length}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="bg-white hover:bg-gray-100 text-black border-0"
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
            >
              <Download className="w-4 h-4 mr-1" />
              下载
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-white hover:bg-gray-100 text-black border-0"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* 左右切换按钮 */}
        {images.length > 1 && (
          <>
            {currentIndex > 0 && (
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrevious();
                }}
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
            )}
            {currentIndex < images.length - 1 && (
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNext();
                }}
              >
                <ChevronRight className="w-8 h-8" />
              </button>
            )}
          </>
        )}

        {/* 图片区域 */}
        <div
          className="flex-1 flex items-center justify-center min-h-0 select-none"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
        >
          <img
            src={currentImage}
            alt={`预览图 ${currentIndex + 1}`}
            className="max-w-[calc(100vw-2rem)] max-h-[calc(100vh-6rem)] object-contain pointer-events-none"
            draggable={false}
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>

        {/* 底部提示 */}
        <div className="absolute bottom-4 left-0 right-0 text-center text-white/60 text-xs">
          使用键盘 ← → 切换图片，ESC 关闭预览
        </div>
      </div>
    </div>,
    document.body
  );
}

// 图片预览触发器组件 - 只有点击图片本身才能打开预览
interface ImagePreviewTriggerProps {
  images: string[];
  currentIndex?: number;
  className?: string;
  children: React.ReactNode;
  // 跨任务切换支持
  allImagesData?: ImageData[];
  onNavigate?: (taskId: string, imageIndex: number) => void;
}

export function ImagePreviewTrigger({
  images,
  currentIndex = 0,
  className = '',
  children,
  allImagesData,
  onNavigate,
}: ImagePreviewTriggerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHoveringImage, setIsHoveringImage] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 当图片数组变化时，如果正在预览且图片数量为0，关闭预览
  useEffect(() => {
    if (isOpen && images.length === 0) {
      setIsOpen(false);
    }
  }, [images.length, isOpen]);

  // 处理鼠标移动，判断是否在图片实际区域内
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) {
      setIsHoveringImage(false);
      return;
    }
    
    const img = container.querySelector('img');
    
    if (!img) {
      setIsHoveringImage(false);
      return;
    }
    
    const rect = img.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    // 计算鼠标相对于容器的位置
    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;
    
    // 计算图片在容器内的位置
    const imgLeft = rect.left - containerRect.left;
    const imgRight = rect.right - containerRect.left;
    const imgTop = rect.top - containerRect.top;
    const imgBottom = rect.bottom - containerRect.top;
    
    // 判断鼠标是否在图片实际区域内
    const isInImage = mouseX >= imgLeft && mouseX <= imgRight && 
                      mouseY >= imgTop && mouseY <= imgBottom;
    
    setIsHoveringImage(isInImage);
  };

  const handleMouseLeave = () => {
    setIsHoveringImage(false);
  };

  // 只有点击图片才能打开预览
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 由于图片设置了 pointer-events-none，点击事件发生在容器上
    // 通过坐标判断是否点击了图片区域
    const img = containerRef.current?.querySelector('img');
    if (!img || !containerRef.current) return;
    
    const rect = img.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    
    // 计算点击位置相对于容器的坐标
    const clickX = e.clientX - containerRect.left;
    const clickY = e.clientY - containerRect.top;
    
    // 计算图片在容器内的位置
    const imgLeft = rect.left - containerRect.left;
    const imgRight = rect.right - containerRect.left;
    const imgTop = rect.top - containerRect.top;
    const imgBottom = rect.bottom - containerRect.top;
    
    // 判断点击是否在图片区域内
    const isInImage = clickX >= imgLeft && clickX <= imgRight && 
                      clickY >= imgTop && clickY <= imgBottom;
    
    if (isInImage) {
      setIsOpen(true);
    }
  };

  return (
    <>
      <div
        ref={containerRef}
        className={`relative w-full h-full flex items-center justify-center select-none ${className}`}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        style={{ cursor: isHoveringImage ? 'pointer' : 'default', userSelect: 'none', WebkitUserSelect: 'none' }}
      >
        {children}
        {/* 小眼睛图标 - 只在鼠标悬停在图片实际位置时显示 */}
        {isHoveringImage && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
              <Eye className="w-5 h-5 text-white" />
            </div>
          </div>
        )}
      </div>
      <ImagePreview
        images={images}
        currentIndex={currentIndex}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        allImagesData={allImagesData}
        onNavigate={onNavigate}
      />
    </>
  );
}
