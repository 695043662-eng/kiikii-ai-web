'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Upload, Image, Settings, FileText, Sparkles, Check, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CardData } from './AssetCard';
import { uploadFile } from '@/lib/upload';

// #819 模型规格动态数据类型
interface ModelSpecItem {
  spec_type: string;
  spec_value: string;
  spec_label: string;
}

interface ModelSpecsMap {
  [modelId: string]: {
    aspect_ratios: { value: string; label: string }[];
    resolutions: { value: string; label: string }[];
    durations: { value: string; label: string }[];
  };
}

/* ============================================================
   调节模式 - 添加/编辑卡片弹窗 (AddCardModal)
   - 展示封面图上传
   - 视频URL输入（支持本地上传和URL）
   - 内置配置：模型、比例、清晰度、多张参考图、提示词
   - 参考图勾选：选择一张作为展示参考图（显示在卡片左下角）
   - 编辑模式：支持双击编辑现有卡片
   ============================================================ */

interface AddCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddCard: (card: CardData) => void;
  // 编辑模式支持
  editCard?: CardData | null;      // 编辑的卡片数据
  onUpdateCard?: (card: CardData) => void; // 更新卡片回调
}

// #819 模型名称映射（模型ID → 显示名称）
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'gpt-image-2': 'GPT Image 2',
  'seedance-2.0': 'Seedance 2.0',
  'seedance-2.0-fast': 'Seedance 2.0 Fast',
  'happyhorse-1.0': 'Happy Horse 1.0',
  'veo3': 'Veo 3',
  'veo3-fast': 'Veo 3 Fast',
  'sora-2': 'Sora 2',
  'flux-1.1-pro': 'Flux 1.1 Pro',
  'flux-kontext': 'Flux Kontext',
  'nano-banana': 'Nano Banana',
  'nano-banana-fast': 'Nano Banana Fast',
  'nano-banana-2': 'Nano Banana 2',
};

const TAG_OPTIONS = [
  '玩法合集', '商业海报', '电商营销', '时令节气', '视频特效',
  '创意人物', 'IP&3D立体', 'IP设计', '手绘插画', '创意建筑',
  '非遗剪纸', '文旅宣传', '像素风格', '产品摄影',
];

// #813 一级大类目（与 Header MAIN_CATEGORIES 保持一致）
const CATEGORY_OPTIONS = [
  { value: 'marketing', label: '营销专辑' },
  { value: 'poster', label: '商业海报' },
  { value: 'video', label: '视频特效' },
  { value: 'contest', label: '大赛活动' },
  { value: 'creative', label: '创意设计' },
];

// 参考图项结构
interface RefImageItem {
  id: string;            // 本地唯一ID
  previewUrl: string;    // 本地预览URL（blob或base64）
  file?: File;           // 文件对象（新上传）
  cosUrl?: string;       // COS URL（已上传或编辑模式传入）
  cosKey?: string;       // COS key（存储用）
}

export default function AddCardModal({ isOpen, onClose, onAddCard, editCard, onUpdateCard }: AddCardModalProps) {
  const isEditMode = !!editCard;
  
  // 基础信息
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [tag, setTag] = useState('');
  const [customTag, setCustomTag] = useState('');
  const [category, setCategory] = useState('creative');
  
  // 封面图/视频上传（统一支持图片和视频）
  const [coverImagePreview, setCoverImagePreview] = useState<string>('');
  const [coverImageFile, setCoverImageFile] = useState<File | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // 判断当前上传的是图片还是视频
  const isVideoFile = coverImageFile?.type.startsWith('video/');

  // 🔥 检测是否是 webp 文件（动画 webp 无法用 <video> 播放，需要提示用户）
  const isWebpFile = coverImageFile?.type === 'image/webp' || 
    (!coverImageFile && editCard?.imageUrl?.includes('.webp'));

  // 🔥 编辑模式下，是否已有视频URL
  const hasExistingVideo = isEditMode && !!editCard?.builtInVideoUrl;

  // 内置配置
  const [builtInModel, setBuiltInModel] = useState('');
  const [builtInAspectRatio, setBuiltInAspectRatio] = useState('');
  const [builtInResolution, setBuiltInResolution] = useState('');
  const [builtInDuration, setBuiltInDuration] = useState(''); // #819 新增时长
  const [builtInPrompt, setBuiltInPrompt] = useState('');
  // 🔥 网格宽度 span（1=单列，2=双列横向长图）
  const [gridSpan, setGridSpan] = useState(1);

  // #819 动态模型规格
  const [modelSpecs, setModelSpecs] = useState<ModelSpecsMap>({});
  const [modelSpecsLoaded, setModelSpecsLoaded] = useState(false);

  // #819 从 API 加载模型规格字典
  useEffect(() => {
    if (!isOpen) return;
    if (modelSpecsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/model-specs');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.success) return;
        const specsMap: ModelSpecsMap = {};
        for (const [modelId, specs] of Object.entries(data.specs as Record<string, ModelSpecItem[]>)) {
          const ar = specs.filter(s => s.spec_type === 'aspect_ratio').map(s => ({ value: s.spec_value, label: s.spec_label }));
          const res = specs.filter(s => s.spec_type === 'resolution').map(s => ({ value: s.spec_value, label: s.spec_label }));
          const dur = specs.filter(s => s.spec_type === 'duration').map(s => ({ value: s.spec_value, label: s.spec_label }));
          specsMap[modelId] = { aspect_ratios: ar, resolutions: res, durations: dur };
        }
        setModelSpecs(specsMap);
        setModelSpecsLoaded(true);
        console.log('[AddCardModal] 模型规格加载完成，模型数:', Object.keys(specsMap).length);
      } catch (e) {
        console.error('[AddCardModal] 模型规格加载失败:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, modelSpecsLoaded]);

  // #819 当前模型可用的动态规格
  const currentModelSpecs = builtInModel ? modelSpecs[builtInModel] : null;
  const availableAspectRatios = currentModelSpecs?.aspect_ratios ?? [];
  const availableResolutions = currentModelSpecs?.resolutions ?? [];
  const availableDurations = currentModelSpecs?.durations ?? [];

  // #819 级联清洗：切换模型时，清空依赖参数
  const handleModelChange = useCallback((newModel: string) => {
    setBuiltInModel(newModel);
    setBuiltInAspectRatio('');
    setBuiltInResolution('');
    setBuiltInDuration('');
    console.log('[AddCardModal] 模型切换:', newModel, '→ 已清空比例/分辨率/时长');
  }, []);

  // #819 动态模型选项（从加载的数据生成，兜底用硬编码映射）
  const modelOptions = Object.keys(modelSpecs).length > 0
    ? Object.keys(modelSpecs).map(id => ({ value: id, label: MODEL_DISPLAY_NAMES[id] || id }))
    : Object.entries(MODEL_DISPLAY_NAMES).map(([value, label]) => ({ value, label }));

  // 多张参考图
  const [refImages, setRefImages] = useState<RefImageItem[]>([]);
  const [selectedDisplayIndex, setSelectedDisplayIndex] = useState<number>(-1); // -1表示不展示
  const [submitting, setSubmitting] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);

  // 编辑模式初始化
  useEffect(() => {
    if (isOpen && editCard) {
      // 填充编辑数据
      setTitle(editCard.title || '');
      setSubtitle(editCard.subtitle || '');
      setTag(editCard.tag || '');
      setCustomTag('');
      setCategory(editCard.category || 'creative');
      
      // 素材初始化：有视频URL则显示视频，否则显示图片
      if (editCard.builtInVideoUrl) {
        setCoverImagePreview(editCard.builtInVideoUrl);
        setCoverImageFile(null);
      } else {
        setCoverImagePreview(editCard.imageUrl || '');
        setCoverImageFile(null);
      }
      
      // 内置配置
      setBuiltInModel(editCard.builtInModel || '');
      setBuiltInAspectRatio(editCard.builtInAspectRatio || '');
      setBuiltInResolution(editCard.builtInResolution || '');
      setBuiltInDuration(editCard.builtInDuration || '');
      setBuiltInPrompt(editCard.builtInPrompt || '');
      // 🔥 gridSpan 初始化
      setGridSpan(editCard.gridSpan || 1);
      
      // 参考图数据
      if (editCard.referenceImages && editCard.referenceImages.length > 0) {
        const refItems: RefImageItem[] = editCard.referenceImages.map((url, idx) => ({
          id: `ref-${idx}-${Date.now()}`,
          previewUrl: url,
          cosUrl: url,
          cosKey: url, // 用URL作为key
        }));
        setRefImages(refItems);
        
        // 找到展示参考图的索引
        if (editCard.displayReferenceImage) {
          const displayIdx = editCard.referenceImages.findIndex(url => url === editCard.displayReferenceImage);
          setSelectedDisplayIndex(displayIdx >= 0 ? displayIdx : -1);
        } else {
          setSelectedDisplayIndex(-1);
        }
      } else if (editCard.builtInReferenceImage) {
        // 兼容旧数据单张参考图
        setRefImages([
          {
            id: `ref-0-${Date.now()}`,
            previewUrl: editCard.builtInReferenceImage,
            cosUrl: editCard.builtInReferenceImage,
            cosKey: editCard.builtInReferenceImage,
          },
        ]);
        setSelectedDisplayIndex(-1);
      } else {
        setRefImages([]);
        setSelectedDisplayIndex(-1);
      }
      
      console.log('[AddCardModal] 编辑模式初始化，卡片ID:', editCard.id);
    } else if (isOpen && !editCard) {
      // 新增模式：清空所有状态
      resetForm();
    }
  }, [isOpen, editCard]);

  // 封面图/视频上传处理（同时支持图片和视频，释放旧 blob URL 防内存泄漏）
  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 释放旧的 blob URL（如果有）
    setCoverImagePreview(prev => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return prev;
    });
    setCoverImageFile(file);
    const objUrl = URL.createObjectURL(file);
    setCoverImagePreview(objUrl);
  };

  // 多张参考图上传处理
  const handleRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems: RefImageItem[] = [];
    Array.from(files).forEach((file, idx) => {
      const previewUrl = URL.createObjectURL(file);
      newItems.push({
        id: `ref-new-${Date.now()}-${idx}`,
        previewUrl,
        file,
      });
    });

    setRefImages(prev => [...prev, ...newItems]);
    // 清空 input 以便再次上传
    if (refInputRef.current) refInputRef.current.value = '';
  };

  // 删除单张参考图
  const handleRemoveRefImage = (id: string) => {
    setRefImages(prev => {
      const idx = prev.findIndex(item => item.id === id);
      // 释放 blob URL
      if (idx >= 0 && prev[idx].previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prev[idx].previewUrl);
      }
      const newItems = prev.filter(item => item.id !== id);
      
      // 调整选中索引
      if (selectedDisplayIndex >= 0) {
        if (idx === selectedDisplayIndex) {
          setSelectedDisplayIndex(-1);
        } else if (idx < selectedDisplayIndex) {
          setSelectedDisplayIndex(selectedDisplayIndex - 1);
        }
      }
      
      return newItems;
    });
  };

  // 勾选作为展示参考图
  const handleSelectDisplay = (idx: number) => {
    setSelectedDisplayIndex(idx === selectedDisplayIndex ? -1 : idx);
  };

  // 获取视频实际宽高比（创建的 video 元素必须释放，避免内存泄漏）
  const getVideoAspectRatio = async (videoSrc: string): Promise<number | null> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      const cleanup = () => {
        video.removeAttribute('src');
        video.load(); // 强制释放网络资源
      };
      video.onloadedmetadata = () => {
        const ratio = video.videoWidth / video.videoHeight;
        console.log('[AddCardModal] 获取视频宽高比:', video.videoWidth, 'x', video.videoHeight, '=', ratio.toFixed(2));
        cleanup();
        resolve(ratio);
      };
      video.onerror = () => {
        console.error('[AddCardModal] 获取视频宽高比失败');
        cleanup();
        resolve(null);
      };
      video.src = videoSrc;
    });
  };

  // 上传文件到 COS（#804 自动选择中转/直传）
  const uploadToCos = async (file: File): Promise<{ url: string; key: string } | null> => {
    try {
      console.log('[AddCardModal] 上传文件到COS，文件:', file.name, '大小:', Math.round(file.size / 1024), 'KB', '类型:', file.type);
      const result = await uploadFile(file, 'perm');  // #804 首页卡片→2号桶(永久)
      if (result) {
        console.log('[AddCardModal] 上传成功, objectKey:', result.key);
        return { url: result.signedUrl || result.proxyUrl, key: result.key };
      }
      console.error('[AddCardModal] 上传失败');
      return null;
    } catch (e) {
      console.error('[AddCardModal] 上传异常:', e);
      return null;
    }
  };

  // 提交
  const handleSubmit = async () => {
    // 检查必填项：需要有封面图/视频或标题
    if (!coverImagePreview && !title) return;
    if (submitting) return;
    setSubmitting(true);

    console.log('[AddCardModal] 开始提交，文件类型:', coverImageFile?.type, '预览:', coverImagePreview?.substring(0, 50));

    // 上传封面图/视频到服务器
    let imageUrl = coverImagePreview;
    let imageKey = '';
    let videoUrl = '';
    let uploadSuccess = false;
    
    if (coverImageFile) {
      console.log('[AddCardModal] 开始上传文件到 COS...');
      const result = await uploadToCos(coverImageFile);
      if (result) {
        // 存代理URL而非签名URL — 跟 HeroCarousel 同架构，走 /api/canvas/image 后端代理
        // 签名URL浏览器直连COS会被网络拦截(ERR_CONNECTION_CLOSED)，代理URL永不过期
        // #804 双桶分离：展示卡片上传到2号桶(perm)，代理URL必须带assetType参数
        imageKey = result.key;
        imageUrl = `/api/canvas/image?key=${encodeURIComponent(result.key)}&assetType=perm`;
        uploadSuccess = true;
        console.log('[AddCardModal] COS 上传成功，objectKey:', result.key, '→ 代理URL:', imageUrl);
        // 如果是视频文件，同时设置 videoUrl（也走代理，支持Range请求）
        if (coverImageFile.type.startsWith('video/')) {
          videoUrl = `/api/canvas/image?key=${encodeURIComponent(result.key)}&assetType=perm`;
          console.log('[AddCardModal] 设置 builtInVideoUrl(代理):', videoUrl);
        }
      } else {
        // ⚠️ 上传失败必须阻断！严禁把 blob: 假链接存进数据库！
        console.error('[AddCardModal] COS 上传失败！文件可能过大或服务不可用');
        toast.error('文件上传失败，请重试');
        setSubmitting(false);
        return;
      }
    } else if (editCard) {
      // 编辑模式保持原URL
      imageKey = editCard.imageUrl || '';
      imageUrl = editCard.imageUrl || '';
      if (editCard.builtInVideoUrl) {
        videoUrl = editCard.builtInVideoUrl;
        imageUrl = editCard.builtInVideoUrl; // 视频模式，imageUrl 也用视频URL
      }
      uploadSuccess = true; // 编辑模式不需要重新上传
    }

    // 解析宽高比（在释放 blob URL 之前）
    let aspectRatio = 1.2;
    
    // 如果是视频，获取实际宽高比（必须在上传成功后、释放 blob URL 之前）
    if (videoUrl && coverImagePreview) {
      const videoRatio = await getVideoAspectRatio(coverImagePreview);
      if (videoRatio) {
        aspectRatio = videoRatio;
        console.log('[AddCardModal] 使用视频实际宽高比:', aspectRatio.toFixed(2));
      } else {
        aspectRatio = 16/9; // 获取失败时使用默认值
      }
    } else if (builtInAspectRatio) {
      const parts = builtInAspectRatio.split(':').map(Number);
      if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
        aspectRatio = parts[0] / parts[1];
      }
    } else if (editCard?.aspectRatio) {
      aspectRatio = editCard.aspectRatio;
    }

    // 只有上传成功后才释放 blob URL
    if (uploadSuccess && coverImagePreview && coverImagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(coverImagePreview);
    }

    // 上传所有新上传的参考图到 COS
    const uploadedRefUrls: string[] = [];
    let displayRefUrl = '';
    
    for (let i = 0; i < refImages.length; i++) {
      const item = refImages[i];
      if (item.file) {
        // 新上传的文件，需要上传到 COS
        const result = await uploadToCos(item.file);
        if (result) {
          // 参考图也走代理URL，跟封面图/视频同架构
          // #804 双桶分离：展示卡片上传到2号桶(perm)，代理URL必须带assetType参数
          const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(result.key)}&assetType=perm`;
          uploadedRefUrls.push(proxyUrl);
          if (i === selectedDisplayIndex) {
            displayRefUrl = proxyUrl;
          }
        } else {
          // ⚠️ 参考图上传失败必须阻断！严禁把 blob: 假链接存进数据库！
          console.error('[AddCardModal] 参考图上传失败！index:', i);
        toast.error('参考图上传失败，请重试');
          setSubmitting(false);
          return;
        }
      } else if (item.cosUrl) {
        // 已存在的 URL（编辑模式）
        uploadedRefUrls.push(item.cosUrl);
        if (i === selectedDisplayIndex) {
          displayRefUrl = item.cosUrl;
        }
      }
      // 释放 blob URL
      if (item.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }

    const cardData: CardData = {
      id: editCard?.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      imageUrl: videoUrl || imageUrl, // 如果有视频，imageUrl 也用视频URL（作为fallback）
      tag: customTag || tag,
      title,
      subtitle,
      likes: editCard?.likes || 0,
      aspectRatio,
      gridSpan, // 🔥 网格宽度 span
      category,
      builtInModel: builtInModel || undefined,
      builtInPrompt: builtInPrompt || undefined,
      referenceImages: uploadedRefUrls.length > 0 ? uploadedRefUrls : undefined,
      displayReferenceImage: displayRefUrl || undefined,
      builtInAspectRatio: builtInAspectRatio || undefined,
      builtInResolution: builtInResolution || undefined,
      builtInDuration: builtInDuration || undefined,
      builtInVideoUrl: videoUrl || undefined,
    };

    console.log('[AddCardModal] 提交卡片数据:', {
      id: cardData.id,
      imageUrl: cardData.imageUrl?.substring(0, 50),
      builtInVideoUrl: cardData.builtInVideoUrl?.substring(0, 50),
      isVideo: !!cardData.builtInVideoUrl,
    });

    if (isEditMode && onUpdateCard) {
      onUpdateCard(cardData);
      console.log('[AddCardModal] 编辑完成，卡片ID:', cardData.id);
    } else {
      onAddCard(cardData);
      console.log('[AddCardModal] 新增卡片，ID:', cardData.id);
    }

    resetForm();
    setSubmitting(false);
    onClose();
  };

  const resetForm = () => {
    setTitle('');
    setSubtitle('');
    setTag('');
    setCustomTag('');
    setCategory('creative');
    if (coverImagePreview && coverImagePreview.startsWith('blob:')) URL.revokeObjectURL(coverImagePreview);
    setCoverImagePreview('');
    setCoverImageFile(null);
    setBuiltInModel('');
    setBuiltInAspectRatio('');
    setBuiltInResolution('');
    setBuiltInDuration('');
    setBuiltInPrompt('');
    setGridSpan(1); // 🔥 重置 gridSpan
    // 释放所有 blob URL
    refImages.forEach(item => {
      if (item.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
    setRefImages([]);
    setSelectedDisplayIndex(-1);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[560px] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-orange-500" />
            {isEditMode ? '编辑展示素材' : '添加展示素材'}
            {/* 🔥 编辑模式下显示卡片ID */}
            {isEditMode && editCard && (
              <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded ml-2">
                ID: {editCard.id}
              </span>
            )}
          </h2>
          <button onClick={onClose} disabled={submitting} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5 relative">
          {/* 上传中遮罩 */}
          {submitting && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-3">
              <svg className="animate-spin h-8 w-8 text-blue-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-sm font-medium text-gray-600">正在上传文件，请稍候...</span>
            </div>
          )}
          {/* 封面图/视频上传（统一支持图片和视频） */}
          <div>
            <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5 mb-2">
              <Upload className="w-4 h-4 text-blue-500" />
              展示素材（图片或视频）
            </label>
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => coverInputRef.current?.click()}
            >
              {coverImagePreview ? (
                <div className="relative h-48 bg-black">
                  {isVideoFile ? (
                    <video
                      src={coverImagePreview}
                      className="w-full h-full object-contain"
                      controls
                      muted
                      playsInline
                    />
                  ) : (
                    <img src={coverImagePreview} alt="封面预览" className="w-full h-full object-cover" referrerPolicy="no-referrer-when-downgrade" />
                  )}
                  <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-colors flex items-center justify-center">
                    <span className="text-white text-sm opacity-0 hover:opacity-100 transition-opacity">点击更换</span>
                  </div>
                </div>
              ) : (
                <div className="h-48 flex flex-col items-center justify-center text-gray-400">
                  <Upload className="w-8 h-8 mb-2" />
                  <span className="text-sm">点击上传图片或视频</span>
                  <span className="text-xs text-gray-300 mt-1">支持图片（JPG/PNG/GIF）和视频（MP4/WebM/MOV）</span>
                </div>
              )}
            </div>
            <input 
              ref={coverInputRef} 
              type="file" 
              accept="image/*,video/mp4,video/webm,video/quicktime,video/*" 
              className="hidden" 
              onChange={handleCoverUpload} 
            />
            {/* 🔥 WebP 文件提示：webp 是图片格式，无法用视频播放器播放 */}
            {isWebpFile && !hasExistingVideo && (
              <div className="mt-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                <span className="text-amber-500 text-sm mt-0.5">⚠️</span>
                <div className="text-xs text-amber-700">
                  <p className="font-medium">WebP 是图片格式，不支持视频播放</p>
                  <p className="mt-0.5 text-amber-600">如需视频播放效果，请点击上方重新上传 MP4/WebM 格式的视频文件</p>
                </div>
              </div>
            )}
          </div>

          {/* 基础信息 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">标题</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="卡片标题"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">副标题</label>
              <input
                type="text"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="卡片副标题"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              />
            </div>
          </div>

          {/* #813 一级大类目选择（与首页筛选栏对应） */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">大类目</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    category === c.value
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* 标签 */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">标签分类</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {TAG_OPTIONS.map((t) => (
                <button
                  key={t}
                  onClick={() => { setTag(t); setCustomTag(''); }}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    tag === t ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={customTag}
              onChange={(e) => { setCustomTag(e.target.value); setTag(''); }}
              placeholder="自定义标签（可选）"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            />
          </div>

          {/* 分隔线 */}
          {/* 内置生图配置 */}
          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5 mb-3">
              <Settings className="w-4 h-4 text-orange-500" />
              内置生图配置
            </h3>

            <div className="space-y-3 bg-gray-50 rounded-xl p-4">
              {/* 模型选择 #819 动态级联 */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">模型</label>
                <select
                  value={builtInModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                >
                  <option value="">选择模型</option>
                  {modelOptions.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              {/* 比例 + 清晰度 + 时长 + 网格宽度 #819 动态规格 */}
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">比例</label>
                  <select
                    value={builtInAspectRatio}
                    onChange={(e) => setBuiltInAspectRatio(e.target.value)}
                    disabled={!builtInModel}
                    className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    <option value="">{builtInModel ? '选择比例' : '先选模型'}</option>
                    {(availableAspectRatios.length > 0 ? availableAspectRatios : []).map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">清晰度</label>
                  <select
                    value={builtInResolution}
                    onChange={(e) => setBuiltInResolution(e.target.value)}
                    disabled={!builtInModel}
                    className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    <option value="">{builtInModel ? '选择清晰度' : '先选模型'}</option>
                    {(availableResolutions.length > 0 ? availableResolutions : []).map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                {/* #819 时长（仅视频模型显示） */}
                {availableDurations.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">时长</label>
                    <select
                      value={builtInDuration}
                      onChange={(e) => setBuiltInDuration(e.target.value)}
                      className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                    >
                      <option value="">选择时长</option>
                      {availableDurations.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                {/* 🔥 网格宽度 span */}
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block flex items-center gap-1">
                    网格
                  </label>
                  <select
                    value={gridSpan}
                    onChange={(e) => setGridSpan(Number(e.target.value))}
                    className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                  >
                    <option value={1}>单列</option>
                    <option value={2}>双列</option>
                  </select>
                </div>
              </div>

              {/* 多张参考图上传 */}
              <div>
                <label className="text-xs font-medium text-gray-600 flex items-center gap-1 mb-1">
                  <Image className="w-3 h-3" />
                  参考图（可上传多张，勾选一张作为展示参考图）
                </label>
                
                {/* 已上传的参考图列表 */}
                {refImages.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {refImages.map((item, idx) => (
                      <div
                        key={item.id}
                        className={`relative w-20 h-20 rounded-lg overflow-hidden border-2 transition-all ${
                          selectedDisplayIndex === idx 
                            ? 'border-orange-500 ring-2 ring-orange-300' 
                            : 'border-gray-200'
                        }`}
                      >
                        <img 
                          src={item.previewUrl} 
                          alt={`参考图${idx + 1}`} 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer-when-downgrade"
                        />
                        
                        {/* 勾选标记 */}
                        {selectedDisplayIndex === idx && (
                          <div className="absolute top-0 right-0 w-5 h-5 bg-orange-500 rounded-bl-lg flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                        
                        {/* 删除按钮 */}
                        <button
                          type="button"
                          onClick={() => handleRemoveRefImage(item.id)}
                          className="absolute bottom-0 right-0 w-5 h-5 bg-red-500 rounded-tl-lg flex items-center justify-center hover:bg-red-600 transition-colors"
                        >
                          <X className="w-3 h-3 text-white" />
                        </button>
                        
                        {/* 点击勾选作为展示参考图 */}
                        <button
                          type="button"
                          onClick={() => handleSelectDisplay(idx)}
                          className="absolute inset-0 z-10 hover:bg-black/10 transition-colors flex items-center justify-center"
                          title={selectedDisplayIndex === idx ? '取消展示' : '勾选为展示参考图'}
                        >
                          {selectedDisplayIndex !== idx && (
                            <div className="w-5 h-5 bg-white/80 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                              <Check className="w-3 h-3 text-gray-600" />
                            </div>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* 上传按钮 */}
                <div
                  className="border-2 border-dashed border-gray-200 rounded-lg overflow-hidden cursor-pointer hover:border-orange-400 transition-colors"
                  onClick={() => refInputRef.current?.click()}
                >
                  <div className="h-24 flex flex-col items-center justify-center text-gray-400">
                    <Upload className="w-5 h-5 mb-1" />
                    <span className="text-xs">点击上传参考图（支持多选）</span>
                  </div>
                </div>
                <input 
                  ref={refInputRef} 
                  type="file" 
                  accept="image/*" 
                  multiple 
                  className="hidden" 
                  onChange={handleRefUpload} 
                />
                
                {/* 说明 */}
                <p className="text-xs text-gray-400 mt-1.5">
                  勾选的参考图将显示在卡片左下角，让用户看到展示图是用哪个参考图生成的
                </p>
              </div>

              {/* 提示词 */}
              <div>
                <label className="text-xs font-medium text-gray-600 flex items-center gap-1 mb-1">
                  <FileText className="w-3 h-3" />
                  提示词
                </label>
                <textarea
                  value={builtInPrompt}
                  onChange={(e) => setBuiltInPrompt(e.target.value)}
                  placeholder="输入生图提示词..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || (!coverImagePreview && !title)}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
          >
            {submitting && (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            {submitting ? '上传中...' : (isEditMode ? '保存修改' : '添加卡片')}
          </button>
        </div>
      </div>
    </div>
  );
}