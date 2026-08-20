'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Upload, Sparkles, Image as ImageIcon, Video } from 'lucide-react';
import { toast } from 'sonner';
import type { CarouselItem } from './HeroCarousel';
import { getMediaUrl } from './HeroCarousel';
import { uploadFile } from '@/lib/upload';

/* ============================================================
   轮播上传弹窗 (AddCarouselModal)
   
   架构原则：
   - 上传文件到 COS 后，只保留 ObjectKey（如 dev/canvas/xxx.png）
   - 提交时调用 /api/carousel API 存入数据库
   - 绝不存储签名URL，绝不使用 localStorage
   ============================================================ */

interface AddCarouselModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;           // 操作成功后通知父组件刷新
  editItem?: CarouselItem | null;  // 编辑模式时传入已有数据
}

export default function AddCarouselModal({ isOpen, onClose, onSuccess, editItem }: AddCarouselModalProps) {
  const isEditMode = !!editItem;
  
  // 媒体文件上传（视频或图片）
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string>('');
  const [mediaType, setMediaType] = useState<'video' | 'image' | null>(null);
  const [objectKey, setObjectKey] = useState<string>(''); // COS ObjectKey
  const mediaInputRef = useRef<HTMLInputElement>(null);
  
  // 基本信息
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [tag, setTag] = useState('');
  
  // 提交状态
  const [submitting, setSubmitting] = useState(false);
  
  // 编辑模式初始化
  useEffect(() => {
    if (isOpen && editItem) {
      setTitle(editItem.title);
      setSubtitle(editItem.subtitle || '');
      setTag(editItem.tag || '');
      const type = editItem.mediaType || 'image';
      setMediaType(type);
      setObjectKey(editItem.objectKey);
      // 编辑模式预览：从 objectKey 构造代理 URL
      setMediaPreview(getMediaUrl(editItem.objectKey));
      setMediaFile(null);
    } else if (isOpen && !editItem) {
      resetForm();
    }
  }, [isOpen, editItem]);
  
  // 媒体上传处理（支持视频和图片）
  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    
    if (!isVideo && !isImage) {
      toast.error('请上传视频或图片文件');
      return;
    }
    
    setMediaFile(file);
    setMediaType(isVideo ? 'video' : 'image');
    // 上传后 objectKey 暂空，提交时再上传
    setObjectKey('');
    const objUrl = URL.createObjectURL(file);
    setMediaPreview(objUrl);
    
    console.log('[AddCarouselModal] 选择媒体:', file.name, '| 类型:', isVideo ? '视频' : '图片');
  };
  
  // 上传文件到 COS（#804 自动选择中转/直传）
  const uploadToCos = async (file: File): Promise<string | null> => {
    try {
      console.log('[AddCarouselModal] 上传文件到COS，文件:', file.name, '大小:', Math.round(file.size / 1024), 'KB');
      const result = await uploadFile(file, 'perm');  // #804 首页轮播→2号桶(永久)
      if (result) {
        console.log('[AddCarouselModal] 上传成功, ObjectKey:', result.key);
        return result.key;
      }
      console.error('[AddCarouselModal] 上传失败');
      toast.error('上传失败，请重试');
      return null;
    } catch (e) {
      console.error('[AddCarouselModal] 上传异常:', e);
      toast.error('网络错误，请重试');
      return null;
    }
  };
  
  // 提交到 API
  const handleSubmit = async () => {
    if (!mediaFile && !objectKey && !editItem?.objectKey) {
      toast.error('请上传媒体文件');
      return;
    }
    if (submitting) return;
    
    setSubmitting(true);
    
    try {
      let finalObjectKey = objectKey;
      
      // 如果有新文件，先上传到 COS
      if (mediaFile) {
        const uploadedKey = await uploadToCos(mediaFile);
        if (!uploadedKey) {
          toast.error('文件上传失败，请重试');
          return;
        }
        finalObjectKey = uploadedKey;
      }
      
      // 编辑模式下没换文件，保留原 objectKey
      if (!finalObjectKey && editItem?.objectKey) {
        finalObjectKey = editItem.objectKey;
      }
      
      if (!finalObjectKey) {
        toast.error('请上传媒体文件');
        return;
      }
      
      // 调用 API
      const apiUrl = '/api/carousel';
      const method = isEditMode ? 'PUT' : 'POST';
      const body: Record<string, any> = {
        mediaType: mediaType || 'image',
        objectKey: finalObjectKey,
        title,
        subtitle: subtitle || '',
        tag: tag || '',
      };
      
      if (isEditMode && editItem) {
        body.id = editItem.id;
      }
      
      console.log('[AddCarouselModal] 准备提交到后端的数据:', JSON.stringify(body, null, 2));
      console.log('[AddCarouselModal] objectKey 确认:', finalObjectKey, '| 媒体类型:', mediaType);
      
      const res = await fetch(apiUrl, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      
      const result = await res.json();
      
      if (result.success) {
        console.log('[AddCarouselModal] 提交成功');
        // 释放 blob URL
        if (mediaPreview.startsWith('blob:')) {
          URL.revokeObjectURL(mediaPreview);
        }
        resetForm();
        onClose();
        onSuccess(); // 通知父组件刷新
      } else {
        console.error('[AddCarouselModal] API 返回错误:', result.error);
        toast.error(result.error || '操作失败');
      }
    } catch (e) {
      console.error('[AddCarouselModal] 提交异常:', e);
      toast.error('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };
  
  const resetForm = () => {
    if (mediaPreview && mediaPreview.startsWith('blob:')) {
      URL.revokeObjectURL(mediaPreview);
    }
    setMediaPreview('');
    setMediaFile(null);
    setMediaType(null);
    setObjectKey('');
    setTitle('');
    setSubtitle('');
    setTag('');
    setSubmitting(false);
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[480px] max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-orange-500" />
            {isEditMode ? '编辑轮播媒体' : '添加轮播媒体'}
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        
        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 媒体上传 */}
          <div>
            <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5 mb-2">
              <Upload className="w-4 h-4 text-blue-500" />
              轮播媒体（视频/图片）
            </label>
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => mediaInputRef.current?.click()}
            >
              {mediaPreview ? (
                <div className="relative h-48 bg-black">
                  {mediaType === 'video' ? (
                    <video
                      src={mediaPreview}
                      className="w-full h-full object-contain"
                      autoPlay
                      muted
                      loop
                      playsInline
                    />
                  ) : (
                    <img
                      src={mediaPreview}
                      alt="预览"
                      className="w-full h-full object-contain"
                    />
                  )}
                  {/* 类型标签 */}
                  <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 text-white text-xs rounded flex items-center gap-1">
                    {mediaType === 'video' ? <Video className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
                    {mediaType === 'video' ? '视频' : '图片'}
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/30">
                    <span className="text-white text-sm">点击更换媒体</span>
                  </div>
                </div>
              ) : (
                <div className="h-48 flex flex-col items-center justify-center text-gray-400">
                  <Upload className="w-10 h-10 mb-2" />
                  <span className="text-sm">点击上传视频或图片</span>
                  <span className="text-xs mt-1 text-gray-300">支持 JPG、PNG、GIF（动态）、MP4、WebM</span>
                </div>
              )}
            </div>
            <input
              ref={mediaInputRef}
              type="file"
              accept="video/*,image/*"
              className="hidden"
              onChange={handleMediaUpload}
            />
          </div>
          
          {/* 标题 */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2">标题</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              placeholder="输入轮播标题"
            />
          </div>
          
          {/* 副标题 */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2">副标题</label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              placeholder="输入副标题"
            />
          </div>
          
          {/* 标签 */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2">标签</label>
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              placeholder="如：AI 视频生成"
            />
          </div>
        </div>
        
        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            disabled={submitting}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!mediaPreview || submitting}
            className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '提交中...' : isEditMode ? '更新' : '添加'}
          </button>
        </div>
      </div>
    </div>
  );
}
