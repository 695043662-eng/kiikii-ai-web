'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Navbar from '@/components/Navbar';
import AuthModal from '@/components/AuthModal';
import LeftNav from '@/components/LeftNav';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Upload, X, Play, Download, Video as VideoIcon, Loader2, ZoomIn, User, Plus, Trash2, ChevronDown, Edit2 } from 'lucide-react';
import { generateStore, VideoTask } from '@/store/generateStore';
import { fetchUserWithCache, updateCachedCredits } from '@/lib/user-cache';
import CharacterModal from '@/components/CharacterModal';
import RoseCurveAnimation from '@/components/canvas/RoseCurve';
import { useTheme } from 'next-themes';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';
import { safeSetItem } from '@/lib/safe-storage';
// 【方案C：静态导入】移除动态 import
import { compressImageForUpload } from '@/lib/frontend-defense';

// 宽高比图标组件
function AspectRatioIcon({ ratio, selected }: { ratio: string; selected?: boolean }) {
  const getDimensions = (ratio: string): { w: number; h: number } => {
    switch (ratio) {
      case '1:1': return { w: 14, h: 14 };
      case '3:4': return { w: 12, h: 16 };
      case '4:3': return { w: 16, h: 12 };
      case '9:16': return { w: 9, h: 16 };
      case '16:9': return { w: 16, h: 9 };
      case '2:3': return { w: 12, h: 18 };
      case '3:2': return { w: 18, h: 12 };
      case '4:5': return { w: 12, h: 15 };
      case '5:4': return { w: 15, h: 12 };
      case '21:9': return { w: 21, h: 9 };
      case '1:4': return { w: 8, h: 16 };
      case '4:1': return { w: 16, h: 8 };
      case '1:8': return { w: 6, h: 16 };
      case '8:1': return { w: 16, h: 6 };
      default: return { w: 14, h: 14 }; // auto
    }
  };

  const { w, h } = getDimensions(ratio);
  const scale = 18 / Math.max(w, h);
  const scaledW = w * scale;
  const scaledH = h * scale;

  return (
    <svg width="20" height="20" viewBox="0 0 20 20" className="shrink-0">
      <rect
        x={(20 - scaledW) / 2}
        y={(20 - scaledH) / 2}
        width={scaledW}
        height={scaledH}
        fill="none"
        stroke={selected ? 'white' : 'currentColor'}
        strokeWidth="1.5"
        rx="1"
        className={selected ? '' : 'text-gray-500'}
      />
    </svg>
  );
}

// 角色类型
interface Character {
  id: string;
  name: string;
  character_id: string;
  source_type: string;
  source_video: string;
  thumbnail: string | null;
  created_at: string;
}

// 模型配置（默认兜底）
const defaultModels = [
  { id: 'grs-sora-2', name: 'Sora 2', desc: '标准模型', credits: 23, type: 'sora', aspectRatios: ['9:16', '16:9', '1:1', 'auto'], maxRefImages: 1, supportsCharacter: true, supportsDuration: true, is_active: false, durations: [{ label: '5秒', value: '5s', credits: 50 }, { label: '10秒', value: '10s', credits: 100 }] },
];

export default function VideoGeneratePage() {
  // 玫瑰曲线配色：白天黑色，夜间白色
  const { resolvedTheme } = useTheme();
  const roseColor = resolvedTheme === 'dark' ? '#ffffff' : '#0a0a0f';
  
  // ============================================
  // 【AI 生成器 Context - 统一用户状态和生成引擎】
  // ============================================
  const { 
    handleGenerate,
    isLoggedIn: ctxIsLoggedIn,
    credits: ctxCredits,
    userId: ctxUserId,
    setCredits: ctxSetCredits,
    refreshUserInfo,
  } = useAIGenerator();
  
  // 兼容旧的变量名
  const isLoggedIn = ctxIsLoggedIn;
  const credits = ctxCredits;
  const userId = ctxUserId;
  
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [allModels, setAllModels] = useState(defaultModels);
  
  // 获取模型配置
  const getModelConfig = (modelId: string) => allModels.find((m: any) => m.id === modelId) || allModels[0];

  // 监听登录/注册事件
  useEffect(() => {
    const handleOpenLogin = () => {
      setAuthMode('login');
      setAuthModalOpen(true);
    };

    const handleOpenRegister = () => {
      setAuthMode('register');
      setAuthModalOpen(true);
    };

    window.addEventListener('openLogin', handleOpenLogin);
    window.addEventListener('openRegister', handleOpenRegister);

    return () => {
      window.removeEventListener('openLogin', handleOpenLogin);
      window.removeEventListener('openRegister', handleOpenRegister);
    };
  }, []);

  // 从后端 API 获取模型列表
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch('/api/config?service_type=video_generation');
        const data = await res.json();
        if (data.success && data.data?.models) {
          const models = data.data.models
            .map((m: { model_id: string; model_name: string; credits: number; description?: string; is_active: boolean; parameters?: any }) => {
              const durations = m.parameters?.durations || [];
              const aspectRatios = (m.parameters?.aspectRatios || []).map((r: any) => r.value || r.label);
              return {
                id: m.model_id,
                name: m.model_name,
                desc: m.description || m.model_name,
                credits: m.credits || 23,
                type: 'sora',
                aspectRatios: aspectRatios.length > 0 ? aspectRatios : ['9:16', '16:9', '1:1', 'auto'],
                maxRefImages: 1,
                supportsCharacter: true,
                supportsDuration: true,
                is_active: m.is_active !== false,
                durations: durations,
              };
            });
          if (models.length > 0) {
            setAllModels(models);
          }
        }
      } catch (error) {
        console.error('获取视频模型列表失败:', error);
      }
    };
    fetchModels();
  }, []);

  // 监听管理后台修改事件，刷新模型列表
  useEffect(() => {
    const handleCreditsUpdated = () => {
      console.log('[Video] 收到管理后台更新通知，刷新模型列表');
      const fetchModels = async () => {
        try {
          const res = await fetch('/api/config?service_type=video_generation');
          const data = await res.json();
          if (data.success && data.data?.models) {
            const models = data.data.models
              .map((m: { model_id: string; model_name: string; credits: number; description?: string; is_active: boolean; parameters?: any }) => {
                const durations = m.parameters?.durations || [];
                const aspectRatios = (m.parameters?.aspectRatios || []).map((r: any) => r.value || r.label);
                return {
                  id: m.model_id,
                  name: m.model_name,
                  desc: m.description || m.model_name,
                  credits: m.credits || 23,
                  type: 'sora',
                  aspectRatios: aspectRatios.length > 0 ? aspectRatios : ['9:16', '16:9', '1:1', 'auto'],
                  maxRefImages: 1,
                  supportsCharacter: true,
                  supportsDuration: true,
                  is_active: m.is_active !== false,
                  durations: durations,
                };
              });
            if (models.length > 0) {
              setAllModels(models);
            }
          }
        } catch (error) {
          console.error('刷新视频模型列表失败:', error);
        }
      };
      fetchModels();
    };

    window.addEventListener('modelCreditsUpdated', handleCreditsUpdated);
    window.addEventListener('storage', handleCreditsUpdated);
    
    return () => {
      window.removeEventListener('modelCreditsUpdated', handleCreditsUpdated);
      window.removeEventListener('storage', handleCreditsUpdated);
    };
  }, []);

  const handleLoginSuccess = (user: any) => {
    // 【isLoggedIn 已由 AIGeneratorContext 统一管理，无需手动设置】
    setAuthModalOpen(false);
    // Context 会自动监听登录状态变化
  };
  
  // 参数状态
  const [model, setModel] = useState('grs-sora-2');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [duration, setDuration] = useState(10);
  const [size, setSize] = useState('small');
  
  // 当前模型配置
  const currentModelConfig = getModelConfig(model);
  
  // 使用全局 store 管理参考图
  const [referenceImages, setReferenceImages] = useState<string[]>(() => generateStore.getVideoReferenceImages());
  
  // 角色状态
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  
  // 保存提示词到历史记录
  const savePromptToLocal = (content: string) => {
    try {
      const history = JSON.parse(localStorage.getItem('videoPromptHistory') || '[]');
      const newHistory = [{ content, time: Date.now() }, ...history.filter((h: any) => h.content !== content)].slice(0, 50);
      safeSetItem('videoPromptHistory', JSON.stringify(newHistory));
    } catch (e) {
      console.error('保存提示词历史失败', e);
    }
  };
  
  // 使用全局 store 管理任务状态
  const [tasks, setTasks] = useState<VideoTask[]>(() => generateStore.getVideoTasks());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => generateStore.getSelectedVideoTaskId());
  
  // 预览状态
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  
  // 上传状态
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  // ============================================
  // 【视频生成状态 - 统一生成引擎使用】
  // ============================================
  const [isGenerating, setIsGenerating] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [generatedVideo, setGeneratedVideo] = useState<{ url: string; key?: string; thumbnailUrl?: string } | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoKey, setVideoKey] = useState('');

  // 计算视频积分消耗
  const getVideoCreditCost = () => {
    // 根据模型和时长计算积分
    if (model === 'grs-sora-2') {
      return duration === 5 ? 50 : 100; // 5秒50积分，10秒100积分
    }
    return 100; // 默认100积分
  };
  const videoCreditCost = getVideoCreditCost();
  
  // 文件输入引用
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 参数选择弹窗状态
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showRatioPicker, setShowRatioPicker] = useState(false);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showCharacterModal, setShowCharacterModal] = useState(false);
  
  // 提示词收藏相关状态
  const [showFavoritesModal, setShowFavoritesModal] = useState(false);
  const [favorites, setFavorites] = useState<{ id: number; content: string; sort_order: number }[]>([]);
  const [newFavoriteContent, setNewFavoriteContent] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  
  // 按钮位置状态（用于弹窗定位）
  const [ratioButtonLeft, setRatioButtonLeft] = useState(84);
  const [durationButtonLeft, setDurationButtonLeft] = useState(190);
  const [sizeButtonLeft, setSizeButtonLeft] = useState(291);
  
  // 按钮ref
  const ratioButtonRef = useRef<HTMLButtonElement>(null);
  const durationButtonRef = useRef<HTMLButtonElement>(null);
  const sizeButtonRef = useRef<HTMLButtonElement>(null);

  // 同步任务到 store
  useEffect(() => {
    generateStore.setVideoTasks(tasks);
  }, [tasks]);

  // 同步 selectedTaskId 到 store
  useEffect(() => {
    generateStore.setSelectedVideoTaskId(selectedTaskId);
  }, [selectedTaskId]);

  // 同步参考图到 store
  useEffect(() => {
    generateStore.setVideoReferenceImages(referenceImages);
  }, [referenceImages]);

  // 【用户信息和积分变化已由 AIGeneratorContext 统一管理】
  // 获取用户信息和积分
  // useEffect(() => {
  //   const fetchUserInfo = async () => {
  //     try {
  //       const user = await fetchUserWithCache();
  //       if (user) {
  //         setIsLoggedIn(true);
  //         setCredits(user.credits);
  //         setUserId(user.id);
  //       } else {
  //         setIsLoggedIn(false);
  //       }
  //     } catch (error) {
  //       console.error('获取用户信息失败:', error);
  //       setIsLoggedIn(false);
  //     }
  //   };
  //   
  //   fetchUserInfo();
  //   
  //   // 监听积分变化事件
  //   const handleCreditsChanged = () => {
  //     fetchUserInfo();
  //   };
  //   window.addEventListener('creditsChanged', handleCreditsChanged);
  //   return () => window.removeEventListener('creditsChanged', handleCreditsChanged);
  // }, []);

  // 【积分更新已由 AIGeneratorContext 统一管理】
  // 更新积分显示
  // const updateCredits = useCallback((newCredits: number) => {
  //   setCredits(newCredits);
  //   updateCachedCredits(newCredits);
  //   window.dispatchEvent(new CustomEvent('creditsChanged'));
  // }, []);

  // 从画布接收图片
  useEffect(() => {
    const canvasData = sessionStorage.getItem('canvasToSendVideo');
    if (canvasData) {
      try {
        const data = JSON.parse(canvasData);
        if (data.imageUrl) {
          // 设置参考图
          setReferenceImages(prev => {
            // 避免重复添加
            if (prev.includes(data.imageUrl)) return prev;
            return [...prev, data.imageUrl];
          });
          // 清除 sessionStorage
          sessionStorage.removeItem('canvasToSendVideo');
        } else if (data.images && data.images.length > 0) {
          // 多图情况，取第一张
          const firstImage = data.images[0].imageUrl;
          setReferenceImages(prev => {
            if (prev.includes(firstImage)) return prev;
            return [...prev, firstImage];
          });
          sessionStorage.removeItem('canvasToSendVideo');
        }
      } catch (e) {
        console.error('解析画布数据失败:', e);
      }
    }
  }, []);

  // 加载角色列表
  useEffect(() => {
    const fetchCharacters = async () => {
      try {
        const response = await fetch('/api/characters');
        const data = await response.json();
        if (data.success) {
          setCharacters(data.characters || []);
        }
      } catch (error) {
        console.error('加载角色失败:', error);
      }
    };

    fetchCharacters();
  }, []);

  // 切换模型时重置相关参数
  const handleModelChange = (newModel: string) => {
    const newConfig = getModelConfig(newModel);
    setModel(newModel);
    // 如果当前比例不在新模型的支持列表中，重置为默认
    if (!newConfig.aspectRatios.includes(aspectRatio)) {
      setAspectRatio(newConfig.aspectRatios[0]);
    }
    // 如果新模型不支持角色，清空角色选择
    if (!newConfig.supportsCharacter) {
      setSelectedCharacter(null);
    }
    // 清空参考图（不同模型支持的参考图数量不同）
    setReferenceImages([]);
    setReferenceImageUrls([]);
  };

  // 选择角色
  const handleSelectCharacter = (character: Character | null) => {
    setSelectedCharacter(character);
  };

  // ====== 提示词收藏功能 ======
  // 获取收藏列表
  const fetchFavorites = useCallback(async () => {
    try {
      // #109 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/prompt-favorites', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setFavorites(data.favorites || []);
      } else if (data.error === '未登录') {
        setFavorites([]);
      }
    } catch (error) {
      console.error('获取收藏失败:', error);
    }
  }, []);

  // 打开收藏弹窗时获取列表
  useEffect(() => {
    if (showFavoritesModal) {
      fetchFavorites();
    }
  }, [showFavoritesModal, fetchFavorites]);

  // 添加收藏
  const handleAddFavorite = useCallback(async () => {
    if (!newFavoriteContent.trim()) return;
    try {
      // #109 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/prompt-favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: newFavoriteContent.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setNewFavoriteContent('');
        fetchFavorites();
      } else if (data.error === '未登录') {
        toast.error('请先登录后再收藏提示词');
      } else {
        toast.error(data.error || '添加失败');
      }
    } catch (error) {
      console.error('添加收藏失败:', error);
      toast.error('添加失败，请重试');
    }
  }, [newFavoriteContent, fetchFavorites]);

  // 删除收藏
  const handleDeleteFavorite = useCallback(async (id: number) => {
    try {
      // #109 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch(`/api/prompt-favorites?id=${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        fetchFavorites();
      } else {
        toast.error(data.error || '删除失败');
      }
    } catch (error) {
      console.error('删除收藏失败:', error);
      toast.error('删除失败，请重试');
    }
  }, [fetchFavorites]);

  // 更新收藏内容
  const handleUpdateFavorite = useCallback(async (id: number, content: string) => {
    try {
      // #109 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/prompt-favorites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id, content }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingId(null);
        setEditingContent('');
        fetchFavorites();
      }
    } catch (error) {
      console.error('更新收藏失败:', error);
    }
  }, [fetchFavorites]);

  // 复制到剪贴板
  const handleCopyContent = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (error) {
      console.error('复制失败:', error);
    }
  }, []);

  // 发送到输入框
  const handleSendToInput = useCallback((content: string) => {
    setPrompt(content);
    setShowFavoritesModal(false);
  }, []);

  // 获取完整提示词（包含角色）
  const getFullPrompt = () => {
    if (selectedCharacter) {
      return `${prompt} @${selectedCharacter.character_id}`;
    }
    return prompt;
  };

  // 上传参考图到 OSS，返回 { base64, url }
  // 【A+B+C 综合优化】静态导入 + 合并读取
  const uploadOriginalImage = async (file: File): Promise<{ base64: string; url: string }> => {
    console.log('开始上传图片:', file.name, '原始大小:', (file.size / 1024 / 1024).toFixed(2), 'MB');
    
    // 【方案C：静态导入已在顶部完成】

    // 1. 压缩图片（2048px / 3MB / JPEG）
    const compressedResult = await compressImageForUpload(file);
    const compressedFile = compressedResult.file;
    console.log('[视频参考图] 压缩后大小:', (compressedFile.size / 1024 / 1024).toFixed(2), 'MB');

    // 【修正读取：Promise.all 同时获取 base64 和 arrayBuffer】
    // 视频页只需要 base64，不需要 MD5
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(compressedFile);
      reader.onload = (event) => resolve(event.target?.result as string);
      reader.onerror = () => reject(new Error('文件读取失败'));
    });

    // 2. 上传压缩后的文件到 OSS
    const formData = new FormData();
    formData.append('file', compressedFile);

    console.log('开始上传到服务器...');
    const uploadResponse = await fetch('/api/upload-reference', {
      method: 'POST',
      body: formData,
    });

    console.log('服务器响应状态:', uploadResponse.status);
    
    if (!uploadResponse.ok) {
      throw new Error(`上传失败: ${uploadResponse.status}`);
    }

    const uploadData = await uploadResponse.json();
    console.log('服务器响应:', uploadData.success ? '成功' : uploadData.error);
    
    if (uploadData.success && uploadData.url) {
      console.log('视频参考图上传成功:', uploadData.url.substring(0, 50));
      return { base64, url: uploadData.url };
    } else {
      throw new Error(uploadData.error || '上传失败');
    }
  };
  
  // 参考图 URL 列表（用于发送给后端）
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);

  const handleReferenceImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log('=== 视频参考图上传开始 ===');
    const inputElement = event.target;
    const files = inputElement.files;
    
    console.log('选择的文件数量:', files?.length || 0);
    
    if (!files || files.length === 0) {
      console.log('没有选择文件');
      // 清除 input 值，允许重复选择同一文件
      inputElement.value = '';
      return;
    }
    
    // 先保存文件列表，再清空 input
    const filesArray = Array.from(files);
    console.log('保存的文件列表:', filesArray.map(f => f.name));
    
    // 清除 input 值，允许重复选择同一文件
    inputElement.value = '';
    
    try {
      const newImages: string[] = [];
      const newUrls: string[] = [];
      const maxImages = currentModelConfig.maxRefImages;
      const availableSlots = maxImages - referenceImages.length;
      const filesToProcess = filesArray.slice(0, availableSlots);
      
      console.log('可处理文件数:', filesToProcess.length, '剩余槽位:', availableSlots);

      if (filesToProcess.length === 0) {
        toast.error(`已达到参考图上限（${maxImages}张）`);
        return;
      }

      for (let i = 0; i < filesToProcess.length; i++) {
        // 设置当前上传的图片索引
        setUploadingIndex(referenceImages.length + i);
        
        console.log(`处理第 ${i + 1} 张图片:`, filesToProcess[i].name);
        const result = await uploadOriginalImage(filesToProcess[i] as File);
        newImages.push(result.base64);
        newUrls.push(result.url);
        console.log(`第 ${i + 1} 张图片上传成功`);
      }

      const updatedImages = [...referenceImages, ...newImages].slice(0, maxImages);
      const updatedUrls = [...referenceImageUrls, ...newUrls].slice(0, maxImages);
      
      console.log('更新参考图，总数:', updatedImages.length);
      setReferenceImages(updatedImages);
      setReferenceImageUrls(updatedUrls);
      setUploadingIndex(null);
      
      console.log('=== 视频参考图上传完成 ===');
    } catch (error) {
      console.error('图片处理失败:', error);
      setUploadingIndex(null);
      toast.error('图片上传失败：' + (error instanceof Error ? error.message : '请重试'));
    }
  };

  const handleRemoveReferenceImage = (index: number) => {
    setReferenceImages(referenceImages.filter((_, i) => i !== index));
    setReferenceImageUrls(referenceImageUrls.filter((_, i) => i !== index));
  };

  // 开始生成
  // ============================================
  // 【重构后的 handleStartGeneration - 使用统一生成引擎】
  // 2025年 - 接入 useGenService，删除 SSE/积分/轮询代码
  // ============================================
  const handleStartGeneration = async () => {
    console.log('=== 开始视频生成（统一引擎）===');

    // 验证：登录
    // 【使用 AIGeneratorContext 的 isLoggedIn 和 credits】
    if (!isLoggedIn) {
      toast.error('请先登录');
      window.dispatchEvent(new CustomEvent('openLogin'));
      return;
    }

    // 验证：积分
    if (credits < videoCreditCost) {
      toast.error('积分不足', { description: `当前: ${credits}，需要: ${videoCreditCost}` });
      return;
    }

    // 验证：输入
    if (!prompt.trim()) {
      toast.error('请输入提示词');
      return;
    }

    // 设置生成状态
    setIsGenerating(true);
    setVideoProgress(0);
    setGeneratedVideo(null);
    setVideoError(null);
    setVideoUrl('');
    setVideoKey('');

    // 保存提示词历史
    savePromptToLocal(prompt.trim());

    // 调用统一生成引擎（视频模式）
    // 【保命三剑客已由 useGenService 承接：300秒轮询 + SSE流式 + 积分双重保险】
    await handleGenerate({
      mode: 'video',
      prompt: prompt.trim(),
      model: model,
      resolution: '1080P',
      aspectRatio: '16:9',
      generationCount: 1,
      images: [],
      isUrls: false,
      md5Hashes: [],

      // 视频进度回调：更新进度条
      onVideoProgress: (progress) => {
        setVideoProgress(progress.progress);
      },

      // 完成回调：显示视频
      onComplete: (result) => {
        setIsGenerating(false);
        
        if (result.videos && result.videos.length > 0) {
          setVideoUrl(result.videos[0]);
          setVideoKey(result.videoKeys?.[0] || '');
          setGeneratedVideo({
            url: result.videos[0],
            key: result.videoKeys?.[0] || '',
            thumbnailUrl: result.thumbnails?.[0] || '',
          });
          toast.success('视频生成成功！');
        } else {
          toast.error('视频生成失败');
          setVideoError('生成失败');
        }
        
        // 更新积分显示
        // 【使用 Context 的 setCredits】
        if (result.creditsBalance !== undefined) {
          ctxSetCredits(result.creditsBalance);
        }
      },

      // 错误回调
      onError: (error) => {
        setIsGenerating(false);
        toast.error('生成失败', { description: error.message });
        setVideoError(error.message);
        if (error.message.includes('network') || error.message.includes('fetch')) {
          toast.warning('网络连接中断，视频可能仍在生成中');
        }
      },
    });

    setPrompt('');
  };


  // 下载视频
  const handleDownload = async (videoUrl: string) => {
    try {
      const response = await fetch(videoUrl);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `KiikiiAI_视频_${Date.now()}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('下载失败:', error);
      toast.error('下载失败，请重试');
    }
  };

  const handleClear = () => {
    setPrompt('');
    setReferenceImages([]);
    setReferenceImageUrls([]);
  };

  // 删除任务
  const handleDeleteTask = (taskId: string) => {
    const newTasks = tasks.filter(t => t.id !== taskId);
    setTasks(newTasks);
    
    // 如果删除的是当前选中的任务，切换到其他任务
    if (selectedTaskId === taskId) {
      setSelectedTaskId(newTasks.length > 0 ? newTasks[0].id : null);
    }
  };

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || null;

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      {/* 左侧导航 */}
      <LeftNav />
      
      {/* 主内容区域 - 添加左侧padding以避免被导航遮挡 */}
      <div className="flex pl-16 p-3 gap-3" style={{ height: '100vh' }}>
        {/* 左侧面板 */}
        <div className="relative w-[460px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm px-8 pt-8 pb-[60px] flex flex-col flex-shrink-0" style={{ height: '100%', overflowY: 'auto' }}>
          {/* 模型选择 */}
          <div className="mb-4">
            <Label className="mb-2 block text-sm font-semibold text-gray-900 dark:text-white">模型类型</Label>
            <button 
              className="w-full h-9 px-3 flex items-center justify-between text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              onClick={() => setShowModelPicker(true)}
            >
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${currentModelConfig.is_active !== false ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-gray-900 dark:text-white font-mono">{currentModelConfig.name}</span>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          {/* 参考图 */}
          <div className="mb-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold text-gray-900 dark:text-white">
                参考图 <span className="text-xs text-gray-500 dark:text-gray-400">({referenceImages.length}{uploadingIndex !== null ? '+1' : ''}/{currentModelConfig.maxRefImages})</span>
              </Label>
              {referenceImages.length > 0 && (
                <Button variant="ghost" size="sm" className="text-xs text-gray-500 dark:text-gray-400" onClick={() => setReferenceImages([])}>
                  清空
                </Button>
              )}
            </div>

            {/* 图片和上传按钮 - 固定高度，居中显示 */}
            <div className="h-[252px] flex gap-3 flex-wrap justify-center items-start content-start">
              {/* 已上传的图片 */}
              {referenceImages.map((img, idx) => (
                <div key={idx} className="relative w-[120px] h-[120px] cursor-pointer group flex-shrink-0" onClick={() => setPreviewImage(img)}>
                  <img src={img} alt={`参考图${idx + 1}`} className="w-full h-full object-contain rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                    <ZoomIn className="w-5 h-5 text-white" />
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleRemoveReferenceImage(idx); }} className="absolute top-1 right-1 w-5 h-5 bg-gray-800/70 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-gray-900/80 transition-opacity">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              
              {/* 上传中状态 */}
              {uploadingIndex !== null && (
                <div className="w-[120px] h-[120px] rounded-lg border-2 border-dashed border-gray-400 bg-gray-100 dark:bg-gray-800 flex flex-col items-center justify-center gap-2 flex-shrink-0">
                  <Loader2 className="w-10 h-10 text-gray-500 animate-spin" />
                  <span className="text-sm text-gray-500">上传中...</span>
                </div>
              )}
              
              {/* 上传按钮 */}
              {referenceImages.length < currentModelConfig.maxRefImages && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="h-[120px] min-w-[160px] flex-1 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex flex-col items-center justify-center gap-3 flex-shrink-0"
                  disabled={uploadingIndex !== null}
                >
                  <Upload className="w-12 h-12 text-gray-400" />
                  <span className="text-base font-medium text-gray-500">上传参考图</span>
                </button>
              )}
            </div>

            <input ref={fileInputRef} type="file" accept="image/*" multiple={false} onChange={handleReferenceImageUpload} className="hidden" />
          </div>

          {/* 提示词容器 - 固定定位 + 固定高度 */}
          <div className="fixed left-[96px] w-[396px] h-[350px]" style={{ top: '412px' }}>
            {/* 角色选择 - 仅 Sora 模型支持 */}
            {currentModelConfig.supportsCharacter && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold text-gray-900 dark:text-white">选择角色（可选）</Label>
                  <button 
                    onClick={() => setShowCharacterModal(true)}
                    className="text-xs text-[rgb(139,158,232)] hover:underline"
                  >
                    管理角色
                  </button>
                </div>
                
                {characters.length === 0 ? (
                  <button 
                    onClick={() => setShowCharacterModal(true)}
                    className="w-full border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-3 flex items-center justify-center gap-2 cursor-pointer hover:border-[rgb(139,158,232)] transition-colors"
                  >
                    <Plus className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-500 dark:text-gray-400">创建角色以保持视频一致性</span>
                  </button>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {characters.map((char) => (
                      <button
                        key={char.id}
                        onClick={() => handleSelectCharacter(selectedCharacter?.id === char.id ? null : char)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all ${
                          selectedCharacter?.id === char.id
                            ? 'border-[rgb(139,158,232)] bg-[rgb(139,158,232,0.1)]'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        {char.thumbnail ? (
                          <img src={char.thumbnail} alt={char.name} className="w-6 h-6 rounded object-cover" />
                        ) : (
                          <div className="w-6 h-6 rounded bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                            <User className="w-3 h-3 text-gray-400" />
                          </div>
                        )}
                        <span className="text-sm text-gray-700 dark:text-gray-300">{char.name}</span>
                      </button>
                    ))}
                    {/* 添加更多角色按钮 */}
                    <button
                      onClick={() => setShowCharacterModal(true)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-[rgb(139,158,232)] transition-colors"
                    >
                      <Plus className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-500 dark:text-gray-400">更多</span>
                    </button>
                  </div>
                )}
                
                {selectedCharacter && (
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    已选择角色 <span className="text-[rgb(139,158,232)] font-mono">@{selectedCharacter.character_id}</span>
                  </div>
                )}
              </div>
            )}
            
            {/* 提示词输入框 */}
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold text-gray-900 dark:text-white">提示词</Label>
              <button
                onClick={() => setShowFavoritesModal(true)}
                className="text-xs text-gray-600 dark:text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 px-2 py-1 rounded transition-colors"
              >
                我的收藏
              </button>
            </div>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="描述你想生成的视频内容..." className="h-[208px] resize-none bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500" maxLength={1800} />
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-1 text-right">
              {selectedCharacter && <span className="text-[rgb(139,158,232)] mr-2">将自动添加 @{selectedCharacter.character_id}</span>}
              {prompt.length}/1800
            </div>
          </div>

          {/* 占位 - 保持原有布局空间 */}
          <div className="mb-4 flex-shrink-0" style={{ height: '250px' }}></div>

          {/* 参数设置 - 按钮形式 */}
          <div className="mt-auto">
            <Label className="mb-2 block text-sm font-semibold text-gray-900 dark:text-white">参数设置</Label>
            <div className="flex items-center gap-3 mb-1">
              <button 
                ref={ratioButtonRef}
                className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 transition-colors"
                style={{ transform: 'scale(1.1)', transformOrigin: 'bottom left' }}
                onClick={() => {
                  if (ratioButtonRef.current) {
                    setRatioButtonLeft(ratioButtonRef.current.getBoundingClientRect().left);
                  }
                  setShowRatioPicker(!showRatioPicker);
                }}
              >
                比例: {aspectRatio}
              </button>
              {currentModelConfig.supportsDuration && (
                <>
                  <button 
                    ref={durationButtonRef}
                    className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 transition-colors"
                    style={{ transform: 'scale(1.1)', transformOrigin: 'bottom left' }}
                    onClick={() => {
                      if (durationButtonRef.current) {
                        setDurationButtonLeft(durationButtonRef.current.getBoundingClientRect().left);
                      }
                      setShowDurationPicker(!showDurationPicker);
                    }}
                  >
                    时长: {duration}秒
                  </button>
                  <button 
                    ref={sizeButtonRef}
                    className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 transition-colors"
                    style={{ transform: 'scale(1.1)', transformOrigin: 'bottom left' }}
                    onClick={() => {
                      if (sizeButtonRef.current) {
                        setSizeButtonLeft(sizeButtonRef.current.getBoundingClientRect().left);
                      }
                      setShowSizePicker(!showSizePicker);
                    }}
                  >
                    清晰度: {size === 'large' ? '高清' : '标准'}
                  </button>
                </>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-[11px] text-gray-500 font-medium">
                  剩余 {credits}
                </span>
                <span className="text-[11px] text-gray-400 font-medium">
                  {currentModelConfig.credits} 积分
                </span>
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2 mt-3">
            <Button variant="outline" className="flex-[3] h-9 text-xs font-medium bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300" onClick={() => setShowClearConfirm(true)}>清空</Button>
            <Button 
              className="flex-[7] h-9 text-xs bg-gray-900 hover:bg-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 text-white transition-colors flex items-center gap-1.5" 
              onClick={handleStartGeneration}
            >
              <Play className="w-3 h-3" />
              开始生成
            </Button>
          </div>
        </div>

        {/* 右侧预览面板 */}
        <div className="flex-1 flex flex-col min-w-0 gap-3 h-full">
          {/* 视频预览区域 */}
          <div className="flex-1 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex min-h-0">
            <div className="flex-1 relative bg-gray-100 dark:bg-gray-800 overflow-hidden">
              {selectedTask && selectedTask.videos.length > 0 ? (
                <>
                  <div className="absolute inset-0 flex items-center justify-center p-4">
                    <video
                      src={selectedTask.videos[0]}
                      controls
                      className="max-w-full max-h-full"
                    />
                  </div>
                  <Button size="sm" className="absolute bottom-3 right-3 bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] hover:from-[rgb(120,140,220)] to-[rgb(212,160,170)] text-white brightness-110 saturate-[1.1]" onClick={() => handleDownload(selectedTask.videos[0])}>
                    <Download className="w-4 h-4 mr-1" />
                    下载
                  </Button>
                </>
              ) : selectedTask && selectedTask.status === 'generating' ? (
                <div className="absolute inset-0">
                  <RoseCurveAnimation color={roseColor} showDetail />
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 dark:text-gray-600">
                  <svg className="w-16 h-16 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  <span className="text-sm">输入描述开始创作</span>
                </div>
              )}
            </div>

            {/* 右侧信息面板 */}
            {selectedTask && selectedTask.videos.length > 0 && (
              <div className="w-56 border-l border-gray-200 dark:border-gray-800 p-3 bg-gray-50 dark:bg-gray-800 overflow-y-auto flex-shrink-0">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">生成信息</h3>
                
                <div className="mb-3">
                  <Label className="text-xs text-gray-500 dark:text-gray-400">模型</Label>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">{selectedTask.params.model}</p>
                </div>

                <div className="mb-3">
                  <Label className="text-xs text-gray-500 dark:text-gray-400">提示词</Label>
                  <p className="text-xs text-gray-700 dark:text-gray-300 mt-1 line-clamp-4">{selectedTask.params.prompt}</p>
                </div>

                <div className="mb-3">
                  <Label className="text-xs text-gray-500 dark:text-gray-400">宽高比</Label>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">{selectedTask.params.aspectRatio}</p>
                </div>

                {selectedTask.params.duration && (
                  <div className="mb-3">
                    <Label className="text-xs text-gray-500 dark:text-gray-400">时长</Label>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">{selectedTask.params.duration}秒</p>
                  </div>
                )}

                {selectedTask.params.size && (
                  <div className="mb-3">
                    <Label className="text-xs text-gray-500 dark:text-gray-400">清晰度</Label>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">{selectedTask.params.size === 'large' ? '高清' : '标准'}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 下方缩略图区域 */}
          <div className="h-28 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-3 overflow-hidden flex-shrink-0">
            <div className="flex items-center gap-2 h-full overflow-x-auto">
              {tasks.length === 0 ? null : (
                tasks.map((task) => 
                  task.status === 'generating' ? (
                    <div key={task.id} className={`relative flex-shrink-0 h-full aspect-video rounded border-2 cursor-pointer overflow-hidden transition-all ${selectedTaskId === task.id ? 'border-[rgb(139,158,232)] shadow-md' : 'border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'}`} onClick={() => setSelectedTaskId(task.id)}>
                      <RoseCurveAnimation color={roseColor} mini showDetail />
                    </div>
                  ) : task.status === 'completed' ? (
                    <div key={task.id} className={`relative flex-shrink-0 h-full aspect-video rounded border-2 cursor-pointer overflow-hidden transition-all group ${selectedTaskId === task.id ? 'border-[rgb(139,158,232)] shadow-md' : 'border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'}`} onClick={() => setSelectedTaskId(task.id)}>
                      <video src={task.videos[0]} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <Play className="w-6 h-6 text-white" />
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                        className="absolute top-1 right-1 w-5 h-5 bg-red-500/80 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                        title="删除"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : task.status === 'failed' ? (
                    <div key={task.id} className={`relative flex-shrink-0 h-full aspect-video rounded border-2 cursor-pointer overflow-hidden transition-all group ${selectedTaskId === task.id ? 'border-[rgb(139,158,232)] shadow-md' : 'border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'}`} onClick={() => setSelectedTaskId(task.id)}>
                      <div className="w-full h-full flex items-center justify-center bg-red-50 dark:bg-red-900/20">
                        <X className="w-6 h-6 text-red-400" />
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                        className="absolute top-1 right-1 w-5 h-5 bg-red-500/80 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                        title="删除"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : null
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 参考图预览弹窗 */}
      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img src={previewImage} alt="预览图片" className="max-w-full max-h-[90vh] object-contain" />
            <button onClick={() => setPreviewImage(null)} className="absolute -top-2 -right-2 w-8 h-8 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center shadow-lg hover:bg-gray-100 dark:hover:bg-gray-700">
              <X className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            </button>
          </div>
        </div>
      )}

      {/* 宽高比选择弹窗 */}
      {showRatioPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowRatioPicker(false)} />
          <div className="fixed bottom-[180px] z-50" style={{ left: ratioButtonLeft }}>
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[200px]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">选择比例</h3>
                <button 
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" 
                  onClick={() => setShowRatioPicker(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-2 grid grid-cols-2 gap-2">
                {currentModelConfig.aspectRatios.map((ratio: string) => (
                  <button
                    key={ratio}
                    onClick={() => {
                      setAspectRatio(ratio);
                      setShowRatioPicker(false);
                    }}
                    className={`py-2 px-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-1 ${
                      aspectRatio === ratio 
                        ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    <AspectRatioIcon ratio={ratio} selected={aspectRatio === ratio} />
                    <span>{ratio}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 时长选择弹窗 - 仅Sora模型 */}
      {showDurationPicker && currentModelConfig.supportsDuration && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowDurationPicker(false)} />
          <div className="fixed bottom-[180px] z-50" style={{ left: durationButtonLeft }}>
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[150px]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">选择时长</h3>
                <button 
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" 
                  onClick={() => setShowDurationPicker(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-2 grid grid-cols-2 gap-2">
                {[10, 15].map((d) => (
                  <button
                    key={d}
                    onClick={() => {
                      setDuration(d);
                      setShowDurationPicker(false);
                    }}
                    className={`py-2 px-3 rounded-lg text-sm transition-colors ${
                      duration === d 
                        ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {d}秒
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 清晰度选择弹窗 - 仅Sora模型 */}
      {showSizePicker && currentModelConfig.supportsDuration && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowSizePicker(false)} />
          <div className="fixed bottom-[180px] z-50" style={{ left: sizeButtonLeft }}>
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[150px]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">选择清晰度</h3>
                <button 
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" 
                  onClick={() => setShowSizePicker(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-2 space-y-1">
                <button
                  onClick={() => {
                    setSize('small');
                    setShowSizePicker(false);
                  }}
                  className={`w-full py-2 px-3 rounded-lg text-sm transition-colors ${
                    size === 'small' 
                      ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  标准
                </button>
                <button
                  onClick={() => {
                    setSize('large');
                    setShowSizePicker(false);
                  }}
                  className={`w-full py-2 px-3 rounded-lg text-sm transition-colors ${
                    size === 'large' 
                      ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  高清
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 模型选择弹窗 */}
      {showModelPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowModelPicker(false)} />
          <div className="fixed top-[95px] left-[84px] z-50">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[360px] max-h-[60vh] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">模型类型</h3>
                <button 
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" 
                  onClick={() => setShowModelPicker(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-2 overflow-y-auto max-h-[calc(60vh-48px)]">
                {allModels.map((m) => {
                  const isActive = m.is_active !== false;
                  const durations = (m as any).durations || [];
                  const durationText = durations.length > 0
                    ? durations.map((d: any) => d.label).join(' / ')
                    : '5秒 / 10秒';
                  const minCredits = durations.length > 0
                    ? Math.min(...durations.map((d: any) => d.credits))
                    : m.credits;

                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        if (isActive) {
                          handleModelChange(m.id);
                          setShowModelPicker(false);
                        }
                      }}
                      className={`w-full px-3 py-2.5 rounded-lg text-left transition-colors flex items-center justify-between ${
                        model === m.id
                          ? 'bg-gray-100 dark:bg-gray-800'
                          : isActive
                          ? 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                          : 'opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className={`text-sm font-medium ${isActive ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'} font-mono`}>{m.name}</span>
                        {!isActive && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400">离线</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500 dark:text-gray-400">{durationText}</span>
                        <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{minCredits}积分起</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 清空确认弹窗 */}
      {showClearConfirm && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowClearConfirm(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[320px]">
              <div className="px-6 py-5 text-center">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">确认清空</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">确定要清空所有内容吗？此操作不可撤销。</p>
                <div className="flex gap-3">
                  <Button 
                    variant="outline" 
                    className="flex-1 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                    onClick={() => setShowClearConfirm(false)}
                  >
                    取消
                  </Button>
                  <Button 
                    className="flex-1 bg-gray-900 hover:bg-gray-700 text-white"
                    onClick={() => {
                      handleClear();
                      setShowClearConfirm(false);
                    }}
                  >
                    确认清空
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 登录/注册模态框 */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authMode}
        onLoginSuccess={handleLoginSuccess}
      />

      {/* 角色选择大弹窗 */}
      <CharacterModal
        isOpen={showCharacterModal}
        onClose={() => setShowCharacterModal(false)}
        onSelect={handleSelectCharacter}
      />

      {/* 提示词收藏弹窗 - 与画布页面样式一致 */}
      {showFavoritesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowFavoritesModal(false)}>
          <div 
            className="bg-white rounded-xl shadow-lg w-[95vw] max-w-6xl max-h-[85vh] overflow-hidden" 
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">提示词收藏</h3>
              <button 
                className="px-5 py-2.5 bg-black text-white text-sm font-medium rounded-lg flex items-center gap-2 hover:bg-gray-800 transition-colors" 
                onClick={() => {
                  if (newFavoriteContent.trim()) {
                    handleAddFavorite();
                  }
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                添加收藏
              </button>
            </div>
            
            {/* 添加新收藏区域 */}
            <div className="px-8 py-5 border-b border-gray-100 bg-gray-50">
              <textarea
                value={newFavoriteContent}
                onChange={(e) => setNewFavoriteContent(e.target.value)}
                placeholder="输入想要收藏的提示词..."
                className="w-full px-5 py-4 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200"
                rows={4}
              />
            </div>
            
            {/* 收藏列表 */}
            <div className="overflow-y-auto max-h-[55vh]">
              {favorites.length === 0 ? (
                <div className="py-20 text-center">
                  <p className="text-gray-400 text-sm">暂无收藏的提示词</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {favorites.map((item) => (
                    <div key={item.id} className="flex items-center gap-6 px-8 py-4 hover:bg-gray-50 transition-colors group">
                      {editingId === item.id ? (
                        // 编辑模式
                        <>
                          <div className="flex-1">
                            <textarea
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              className="w-full px-4 py-3 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:border-gray-400"
                              rows={3}
                            />
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => handleUpdateFavorite(item.id, editingContent)}
                              className="px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => { setEditingId(null); setEditingContent(''); }}
                              className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
                            >
                              取消
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div 
                            className="flex-1 text-sm text-gray-700 cursor-pointer hover:text-blue-500"
                            onClick={() => handleSendToInput(item.content)}
                          >
                            {item.content}
                          </div>
                          <div className="flex items-center justify-end gap-2 flex-shrink-0">
                            <button
                              onClick={() => handleCopyContent(item.content)}
                              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
                            >
                              复制
                            </button>
                            <button
                              onClick={() => handleSendToInput(item.content)}
                              className="px-3 py-1.5 text-xs bg-black text-white rounded hover:bg-gray-800 transition-colors"
                            >
                              使用
                            </button>
                            <button
                              onClick={() => { setEditingId(item.id); setEditingContent(item.content); }}
                              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => handleDeleteFavorite(item.id)}
                              className="px-3 py-1.5 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            >
                              删除
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
