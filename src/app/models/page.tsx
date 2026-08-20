'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Navbar from '@/components/Navbar';
import LeftNav from '@/components/LeftNav';
import AuthModal from '@/components/AuthModal';
import { Loader2, RefreshCw, Video, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';
import { PROVIDER_COLORS } from '@/lib/model-registry';

// 前端使用的模型定义格式
interface ModelDefinition {
  name: string;
  displayName: string;
  description: string;
  resolutions: { size: string; credits: number }[];
  category: 'image' | 'video' | 'tool';
  tier: 'fast' | 'standard' | 'pro' | 'vip';
  isActive: boolean;  // 从数据库获取的启用状态
  provider?: string;  // 服务商（从数据库获取）
  // 视频模型额外字段
  durations?: { label: string; value: string; credits?: number }[];
  videoPricing?: { mode: string; credits?: number };
  showDuration?: boolean;
  showResolution?: boolean;
  modelId?: string;  // 用于判断模型类型
}

interface ModelStatus {
  status: boolean;
  error: string;
}

export default function ModelsPage() {
  // ============================================
  // 【接入 AIGeneratorContext - 统一用户状态】
  // ============================================
  const { isLoggedIn: ctxIsLoggedIn, refreshUserInfo } = useAIGenerator();
  const isLoggedIn = ctxIsLoggedIn;
  
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [modelStatuses, setModelStatuses] = useState<Record<string, ModelStatus>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modelDefinitions, setModelDefinitions] = useState<ModelDefinition[]>([]);

  // 列位置状态 - 固定位置
  const [imageColPositions, setImageColPositions] = useState({
    model: 80,
    k1: 375,
    k2: 475,
    k4: 575,
    tier: 667, // 往右移动30
    desc: 800, // 往右移动30
    status: 1170,
  });
  const [videoColPositions, setVideoColPositions] = useState({
    model: 80,
    res480p: 320,
    res720p: 420,
    res1080p: 520,
    tier: 667,     // 与生图对齐
    desc: 800,     // 与生图对齐
    status: 1170,  // 与生图对齐
  });

  // 获取模型列表数据 - 完全从数据库获取，不使用硬编码
  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      
      if (data.success && data.data?.models) {
        const apiModels: any[] = data.data.models;
        
        // 转换 API 数据为前端格式 - 完全使用数据库数据
        const convertedModels: ModelDefinition[] = apiModels.map(model => {
          // 判断模型分类
          const modelId = model.model_id.toLowerCase();
          const isVideo = modelId.includes('sora') || 
                         modelId.includes('veo') ||
                         modelId.includes('seedance') ||
                         modelId.includes('kling') ||
                         modelId.includes('happyhorse') ||
                         (model.parameters?.durations && model.parameters.durations.length > 0);
          const isTool = modelId.includes('gemini') || 
                        modelId.includes('gpt-5') ||
                        modelId.includes('deepseek') ||
                        modelId.includes('qwen') ||
                        modelId.includes('smart_split') || 
                        modelId.includes('longcat') ||
                        modelId.includes('upscale') ||
                        modelId.includes('split');
          
          let category: 'image' | 'video' | 'tool' = 'image';
          if (isVideo) category = 'video';
          else if (isTool) category = 'tool';
          
          let resolutions: { size: string; credits: number }[] = [];
          
          if (isVideo) {
            // 视频模型：保存完整参数，后续渲染时区分计费模式
            const dbResolutions = model.parameters?.resolutions || [];
            const dbDurations = model.parameters?.durations || [];
            const videoPricing = model.parameters?.videoPricing;
            const showDuration = model.parameters?.showDuration !== false;
            const showResolution = model.parameters?.showResolution !== false;
            
            // 保存原始分辨率和时长数据
            resolutions = dbResolutions.map((r: any) => ({
              size: r.label || r.value || '视频',
              credits: r.credits || model.credits_base || 80,
            }));
            
            // 保存时长数据（Sora 等模型需要）
            const durations = dbDurations.map((d: any) => ({
              label: d.label || (d.value + '秒'),
              value: d.value,
              credits: d.credits || videoPricing?.credits || model.credits_base,
            }));
            
            return {
              name: model.model_id,
              displayName: model.model_name,
              description: model.description || '',
              resolutions,
              durations,
              videoPricing,
              showDuration,
              showResolution,
              category,
              tier: inferTier(model.model_id),
              isActive: model.is_active ?? true,
              modelId: model.model_id,
              provider: model.parameters?.provider || model.provider || '',
            };
          } else if (!isTool) {
            // 图片模型：完全使用数据库 resolutions 数据
            const dbResolutions = model.parameters?.resolutions || [];
            resolutions = dbResolutions.map((r: any) => ({
              size: r.label || r.value,
              credits: r.credits || model.credits_base || 10,
            }));
          } else {
            // 工具模型：从数据库 resolutions 获取积分
            resolutions = model.parameters?.resolutions?.map((r: any) => ({
              size: r.label || r.value,
              credits: r.credits || model.credits_base,
            })) || [];
          }
          
          return {
            name: model.model_id,
            displayName: model.model_name,
            description: model.description || '',
            resolutions,
            category,
            tier: inferTier(model.model_id),
            isActive: model.is_active ?? true,  // 从数据库获取启用状态
            provider: model.provider || '',
          };
        });
        
        setModelDefinitions(convertedModels);
      }
    } catch (error) {
      console.error('获取模型列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始化获取模型列表
  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // 推断等级
  const inferTier = (modelId: string): 'fast' | 'standard' | 'pro' | 'vip' => {
    const id = modelId.toLowerCase();
    if (id.includes('vip')) return 'vip';
    if (id.includes('pro')) return 'pro';
    if (id.includes('fast')) return 'fast';
    return 'standard';
  };

  // 拖动列位置
  const colDragRef = useRef<{
    table: 'image' | 'video';
    col: string;
    startX: number;
    startLeft: number;
  } | null>(null);

  // 所有栏目都固定，不允许拖动
  const handleColDragStart = () => {
    return;
  };

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

  // 监听管理后台修改事件，刷新模型列表
  useEffect(() => {
    const handleCreditsUpdated = () => {
      console.log('[Models] 收到管理后台更新通知，刷新模型列表');
      fetchModels();
    };

    // 监听自定义事件
    window.addEventListener('modelCreditsUpdated', handleCreditsUpdated);
    
    // 同时监听 storage 事件（跨标签页时触发）
    const handleStorageChange = () => {
      console.log('[Models] 收到 storage 事件，刷新模型列表');
      fetchModels();
    };
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('modelCreditsUpdated', handleCreditsUpdated);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [fetchModels]);

  const handleLoginSuccess = (user: any) => {
    // 【isLoggedIn 已由 AIGeneratorContext 统一管理】
    setAuthModalOpen(false);
    refreshUserInfo();
  };

  // 获取模型状态（顶层定义，可被 onClick 调用）
  const fetchModelStatuses = async () => {
    if (modelDefinitions.length === 0) return;
    setRefreshing(true);
    try {
      const response = await fetch('/api/model-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models: modelDefinitions.map(m => m.name) }),
      });
      const data = await response.json();
      if (data.code === 0 && data.data) {
        setModelStatuses(data.data);
      }
    } catch (error) {
      console.error('获取模型状态失败:', error);
    } finally {
      setRefreshing(false);
    }
  };

  // 初始化时获取模型状态，并每30秒刷新
  useEffect(() => {
    if (modelDefinitions.length > 0) {
      fetchModelStatuses();
      const interval = setInterval(fetchModelStatuses, 30000);
      return () => clearInterval(interval);
    }
  }, [modelDefinitions]);

  // 使用数据库的 is_active 字段统计状态（不再调用外部API）
  const onlineCount = modelDefinitions.filter(m => m.isActive).length;
  const offlineCount = modelDefinitions.filter(m => !m.isActive).length;

  // 按类型分组（保持数组定义的顺序）
  const videoModels = modelDefinitions.filter(m => m.category === 'video');
  const imageModels = modelDefinitions.filter(m => m.category === 'image');
  const toolModels = modelDefinitions.filter(m => m.category === 'tool');

  // 获取等级标签文字
  const getTierLabel = (tier: string) => {
    switch (tier) {
      case 'fast': return '快速';
      case 'standard': return '标准';
      case 'pro': return '专业';
      case 'vip': return 'VIP';
      default: return '';
    }
  };

  // 渲染服务商 Badge
  const renderProviderBadge = (provider?: string) => {
    if (!provider) return null;
    const colors = PROVIDER_COLORS[provider];
    if (!colors) return <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-600">{provider}</span>;
    return (
      <span className={`ml-1 px-1.5 py-0.5 text-[10px] rounded ${colors.bg} ${colors.text}`}>
        {provider}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#1E1F2F]">
      {/* 左侧导航 */}
      <LeftNav />

      <div className="pl-20 pr-6 py-8">
        {/* 页面标题 */}
        <div className="flex items-center justify-between mb-8 pl-10 pr-6 mt-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">模型列表</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-1">查看所有可用模型的状态和积分消耗</p>
          </div>
          <Button
            variant="outline"
            onClick={fetchModelStatuses}
            disabled={refreshing}
            className="flex items-center gap-2 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-blue-600/95"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新状态
          </Button>
        </div>

        {/* 状态统计 */}
        <div className="grid grid-cols-3 gap-6 mb-8 px-6">
          <div className="bg-white dark:bg-[#2A2C3F] rounded-xl p-5 border border-gray-200 dark:border-transparent">
            <div className="text-sm text-gray-600 dark:text-gray-300">总模型数</div>
            <div className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{modelDefinitions.length}</div>
          </div>
          <div className="bg-white dark:bg-[#2A2C3F] rounded-xl p-5 border border-gray-200 dark:border-transparent">
            <div className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              在线
            </div>
            <div className="text-3xl font-bold text-green-600 dark:text-green-400 mt-2">{onlineCount}</div>
          </div>
          <div className="bg-white dark:bg-[#2A2C3F] rounded-xl p-5 border border-gray-200 dark:border-transparent">
            <div className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              离线
            </div>
            <div className="text-3xl font-bold text-red-600 dark:text-red-400 mt-2">{offlineCount}</div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-6 px-6">
            {/* 图片模型 */}
            <div className="bg-white dark:bg-[#2A2C3F] rounded-xl border border-gray-200 dark:border-transparent w-4/5 mx-auto">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700/50 flex items-center gap-3">
                <Image className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">图片生成模型</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-300">多种质量等级，满足不同场景需求</p>
                </div>
              </div>
              <div className="relative overflow-x-auto">
                <div className="flex bg-gray-50 dark:bg-gray-800/30 relative" style={{ minWidth: '1270px', height: '48px' }}>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider cursor-default select-none" style={{ position: 'absolute', left: imageColPositions.model, top: '50%', transform: 'translateY(-50%)', width: '180px', paddingLeft: '12px' }}>模型</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider text-center cursor-default select-none" style={{ position: 'absolute', left: imageColPositions.k1, top: '50%', transform: 'translateY(-50%)', width: '60px' }}>1K</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider text-center cursor-default select-none" style={{ position: 'absolute', left: imageColPositions.k2, top: '50%', transform: 'translateY(-50%)', width: '60px' }}>2K</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider text-center cursor-default select-none" style={{ position: 'absolute', left: imageColPositions.k4, top: '50%', transform: 'translateY(-50%)', width: '60px' }}>4K</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider text-center cursor-default select-none" style={{ position: 'absolute', left: imageColPositions.tier, top: '50%', transform: 'translateY(-50%)', width: '80px' }}>定位</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider cursor-default select-none" style={{ position: 'absolute', left: imageColPositions.desc, top: '50%', transform: 'translateY(-50%)', width: '400px', paddingLeft: '12px' }}>说明</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider cursor-default select-none" style={{ position: 'absolute', left: imageColPositions.status, top: '50%', transform: 'translateY(-50%)', width: '80px', paddingLeft: '12px' }}>状态</div>
                </div>
                <div className="relative" style={{ minWidth: '1270px' }}>
                  {imageModels.map((model) => (
                    <div key={model.name} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50" style={{ position: 'relative', height: '48px' }}>
                      <div className="font-mono text-sm text-gray-900 dark:text-white" style={{ position: 'absolute', left: imageColPositions.model, top: '50%', transform: 'translateY(-50%)', width: '480px', paddingLeft: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{model.displayName}{renderProviderBadge(model.provider)}</div>
                      <div className="flex justify-center items-center text-sm font-medium text-blue-600/95" style={{ position: 'absolute', left: imageColPositions.k1, top: '50%', transform: 'translateY(-50%)', width: '60px' }}>{model.resolutions.find(r => r.size === '1K')?.credits || '-'}</div>
                      <div className="flex justify-center items-center text-sm font-medium text-blue-600/95" style={{ position: 'absolute', left: imageColPositions.k2, top: '50%', transform: 'translateY(-50%)', width: '60px' }}>{model.resolutions.find(r => r.size === '2K')?.credits || '-'}</div>
                      <div className="flex justify-center items-center text-sm font-medium text-blue-600/95" style={{ position: 'absolute', left: imageColPositions.k4, top: '50%', transform: 'translateY(-50%)', width: '60px' }}>{model.resolutions.find(r => r.size === '4K')?.credits || '-'}</div>
                      <div className="text-center text-sm text-gray-600 dark:text-gray-300" style={{ position: 'absolute', left: imageColPositions.tier, top: '50%', transform: 'translateY(-50%)', width: '80px' }}>{getTierLabel(model.tier)}</div>
                      <div className="text-sm text-gray-600 dark:text-gray-300 truncate" style={{ position: 'absolute', left: imageColPositions.desc, top: '50%', transform: 'translateY(-50%)', width: '400px', paddingLeft: '12px' }}>{model.description}</div>
                      <div className="flex items-center gap-2" style={{ position: 'absolute', left: imageColPositions.status, top: '50%', transform: 'translateY(-50%)', width: '80px', paddingLeft: '12px' }}>
                        {model.isActive ? (<><span className="w-2 h-2 rounded-full bg-green-500"></span><span className="text-sm text-gray-600 dark:text-gray-400">在线</span></>) : (<><span className="w-2 h-2 rounded-full bg-red-500"></span><span className="text-sm text-gray-600 dark:text-gray-400">离线</span></>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 视频模型 */}
            <div className="bg-white dark:bg-[#2A2C3F] rounded-xl border border-gray-200 dark:border-transparent w-4/5 mx-auto">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700/50 flex items-center gap-3">
                <Video className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">视频生成模型</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-300">支持文本生成视频和图像生成视频</p>
                </div>
              </div>
              <div className="relative overflow-x-auto">
                <div className="flex bg-gray-50 dark:bg-gray-800/30 relative" style={{ minWidth: '1270px', height: '48px' }}>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider cursor-default select-none" style={{ position: 'absolute', left: videoColPositions.model, top: '50%', transform: 'translateY(-50%)', width: '180px', paddingLeft: '12px' }}>模型</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider text-center cursor-default select-none" style={{ position: 'absolute', left: videoColPositions.res480p, top: '50%', transform: 'translateY(-50%)', width: '100px' }}>480p</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider text-center cursor-default select-none" style={{ position: 'absolute', left: videoColPositions.res720p, top: '50%', transform: 'translateY(-50%)', width: '100px' }}>720p</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider text-center cursor-default select-none" style={{ position: 'absolute', left: videoColPositions.res1080p, top: '50%', transform: 'translateY(-50%)', width: '100px' }}>1080p</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider text-center cursor-default select-none" style={{ position: 'absolute', left: videoColPositions.tier, top: '50%', transform: 'translateY(-50%)', width: '80px' }}>定位</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider cursor-default select-none" style={{ position: 'absolute', left: videoColPositions.desc, top: '50%', transform: 'translateY(-50%)', width: '370px', paddingLeft: '12px' }}>说明</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider cursor-default select-none" style={{ position: 'absolute', left: videoColPositions.status, top: '50%', transform: 'translateY(-50%)', width: '80px', paddingLeft: '12px' }}>状态</div>
                </div>
                <div className="relative" style={{ minWidth: '1270px' }}>
                  {videoModels.map((model) => {
                    // 区分模型计费类型
                    const modelId = (model.modelId || model.name || '').toLowerCase();
                    const isSeedance = modelId.startsWith('sdols') || modelId.includes('seedance');
                    const isSora = modelId.includes('sora');
                    const isVeo = modelId.startsWith('veo');
                    
                    // 获取各分辨率的积分
                    const getResCredits = (resLabel: string) => {
                      const found = model.resolutions.find(r => {
                        const s = (r.size || '').toLowerCase();
                        return s === resLabel.toLowerCase() || s === resLabel.toLowerCase().replace('p', '');
                      });
                      return found?.credits;
                    };
                    
                    // Seedance: 按秒计费，显示"XX积分/秒"
                    if (isSeedance && model.showDuration) {
                      return (
                        <div key={model.name} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50" style={{ position: 'relative', height: '48px' }}>
                          <div className="font-mono text-sm text-gray-900 dark:text-white" style={{ position: 'absolute', left: videoColPositions.model, top: '50%', transform: 'translateY(-50%)', width: '180px', paddingLeft: '12px' }}>{model.displayName}{renderProviderBadge(model.provider)}</div>
                          <div className="flex justify-center items-center text-sm font-medium text-blue-600/95" style={{ position: 'absolute', left: videoColPositions.res480p, top: '50%', transform: 'translateY(-50%)', width: '100px' }}>
                            {getResCredits('480p') ? `${getResCredits('480p')}P/秒` : '-'}
                          </div>
                          <div className="flex justify-center items-center text-sm font-medium text-blue-600/95" style={{ position: 'absolute', left: videoColPositions.res720p, top: '50%', transform: 'translateY(-50%)', width: '100px' }}>
                            {getResCredits('720p') ? `${getResCredits('720p')}P/秒` : '-'}
                          </div>
                          <div className="flex justify-center items-center text-sm font-medium text-blue-600/95" style={{ position: 'absolute', left: videoColPositions.res1080p, top: '50%', transform: 'translateY(-50%)', width: '100px' }}>
                            {getResCredits('1080p') ? `${getResCredits('1080p')}P/秒` : '-'}
                          </div>
                          <div className="text-center text-sm text-gray-600 dark:text-gray-300" style={{ position: 'absolute', left: videoColPositions.tier, top: '50%', transform: 'translateY(-50%)', width: '80px' }}>{getTierLabel(model.tier)}</div>
                          <div className="text-sm text-gray-600 dark:text-gray-300 truncate" style={{ position: 'absolute', left: videoColPositions.desc, top: '50%', transform: 'translateY(-50%)', width: '370px', paddingLeft: '12px' }}>{model.description}</div>
                          <div className="flex items-center gap-2" style={{ position: 'absolute', left: videoColPositions.status, top: '50%', transform: 'translateY(-50%)', width: '80px', paddingLeft: '12px' }}>
                            {model.isActive ? (<><span className="w-2 h-2 rounded-full bg-green-500"></span><span className="text-sm text-gray-600 dark:text-gray-400">在线</span></>) : (<><span className="w-2 h-2 rounded-full bg-red-500"></span><span className="text-sm text-gray-600 dark:text-gray-400">离线</span></>)}
                          </div>
                        </div>
                      );
                    }
                    
                    // Sora: 固定计费，显示时长选项，官方标注为 720p
                    if (isSora && model.durations && model.durations.length > 0) {
                      const durationLabels = model.durations.map(d => d.label.replace('秒', 's')).join('/');
                      const fixedCredits = model.videoPricing?.credits || model.resolutions[0]?.credits || 23;
                      return (
                        <div key={model.name} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50" style={{ position: 'relative', height: '48px' }}>
                          <div className="font-mono text-sm text-gray-900 dark:text-white" style={{ position: 'absolute', left: videoColPositions.model, top: '50%', transform: 'translateY(-50%)', width: '180px', paddingLeft: '12px' }}>{model.displayName}{renderProviderBadge(model.provider)}</div>
                          <div className="flex justify-center items-center text-sm text-gray-400" style={{ position: 'absolute', left: videoColPositions.res480p, top: '50%', transform: 'translateY(-50%)', width: '100px' }}>-</div>
                          <div className="flex justify-center items-center text-sm font-medium text-blue-600/95" style={{ position: 'absolute', left: videoColPositions.res720p, top: '50%', transform: 'translateY(-50%)', width: '100px' }}>
                            {fixedCredits}
                          </div>
                          <div className="flex justify-center items-center text-sm text-gray-400" style={{ position: 'absolute', left: videoColPositions.res1080p, top: '50%', transform: 'translateY(-50%)', width: '100px' }}>-</div>
                          <div className="text-center text-sm text-gray-600 dark:text-gray-300" style={{ position: 'absolute', left: videoColPositions.tier, top: '50%', transform: 'translateY(-50%)', width: '80px' }}>{getTierLabel(model.tier)}</div>
                          <div className="text-sm text-gray-600 dark:text-gray-300 truncate" style={{ position: 'absolute', left: videoColPositions.desc, top: '50%', transform: 'translateY(-50%)', width: '370px', paddingLeft: '12px' }}>时长: {durationLabels}</div>
                          <div className="flex items-center gap-2" style={{ position: 'absolute', left: videoColPositions.status, top: '50%', transform: 'translateY(-50%)', width: '80px', paddingLeft: '12px' }}>
                            {model.isActive ? (<><span className="w-2 h-2 rounded-full bg-green-500"></span><span className="text-sm text-gray-600 dark:text-gray-400">在线</span></>) : (<><span className="w-2 h-2 rounded-full bg-red-500"></span><span className="text-sm text-gray-600 dark:text-gray-400">离线</span></>)}
                          </div>
                        </div>
                      );
                    }
                    
                    // Veo/其他: 固定计费，显示分辨率积分
                    return (
                      <div key={model.name} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50" style={{ position: 'relative', height: '48px' }}>
                        <div className="font-mono text-sm text-gray-900 dark:text-white" style={{ position: 'absolute', left: videoColPositions.model, top: '50%', transform: 'translateY(-50%)', width: '180px', paddingLeft: '12px' }}>{model.displayName}{renderProviderBadge(model.provider)}</div>
                        <div className="flex justify-center items-center text-sm font-medium text-blue-600/95" style={{ position: 'absolute', left: videoColPositions.res480p, top: '50%', transform: 'translateY(-50%)', width: '100px' }}>
                          {getResCredits('480p') || '-'}
                        </div>
                        <div className="flex justify-center items-center text-sm font-medium text-blue-600/95" style={{ position: 'absolute', left: videoColPositions.res720p, top: '50%', transform: 'translateY(-50%)', width: '100px' }}>
                          {getResCredits('720p') || '-'}
                        </div>
                        <div className="flex justify-center items-center text-sm font-medium text-blue-600/95" style={{ position: 'absolute', left: videoColPositions.res1080p, top: '50%', transform: 'translateY(-50%)', width: '100px' }}>
                          {getResCredits('1080p') || '-'}
                        </div>
                        <div className="text-center text-sm text-gray-600 dark:text-gray-300" style={{ position: 'absolute', left: videoColPositions.tier, top: '50%', transform: 'translateY(-50%)', width: '80px' }}>{getTierLabel(model.tier)}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-300 truncate" style={{ position: 'absolute', left: videoColPositions.desc, top: '50%', transform: 'translateY(-50%)', width: '370px', paddingLeft: '12px' }}>{model.description}</div>
                        <div className="flex items-center gap-2" style={{ position: 'absolute', left: videoColPositions.status, top: '50%', transform: 'translateY(-50%)', width: '80px', paddingLeft: '12px' }}>
                          {model.isActive ? (<><span className="w-2 h-2 rounded-full bg-green-500"></span><span className="text-sm text-gray-600 dark:text-gray-400">在线</span></>) : (<><span className="w-2 h-2 rounded-full bg-red-500"></span><span className="text-sm text-gray-600 dark:text-gray-400">离线</span></>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 工具模型 */}
            {toolModels.length > 0 && (
              <div className="bg-white dark:bg-[#2A2C3F] rounded-xl border border-gray-200 dark:border-transparent w-4/5 mx-auto">
                <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700/50 flex items-center gap-3">
                  <div className="w-5 h-5 flex items-center justify-center">
                    <span className="text-gray-600 dark:text-gray-300 text-lg">⚡</span>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">工具模型</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">图像处理与增强工具</p>
                  </div>
                </div>
            <div className="relative overflow-x-auto">
              {/* 表头 */}
              <div className="flex bg-gray-50 dark:bg-gray-800/30 relative" style={{ minWidth: '1270px', height: '48px' }}>
                <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider cursor-default select-none" style={{ position: 'absolute', left: 80, top: '50%', transform: 'translateY(-50%)', width: '180px', paddingLeft: '12px' }}>工具</div>
                <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider text-center cursor-default select-none" style={{ position: 'absolute', left: 375, top: '50%', transform: 'translateY(-50%)', width: '80px' }}>积分</div>
                <div className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider cursor-default select-none" style={{ position: 'absolute', left: 667, top: '50%', transform: 'translateY(-50%)', width: '400px', paddingLeft: '12px' }}>说明</div>
              </div>
              {/* 数据行 */}
              <div className="relative" style={{ minWidth: '1270px' }}>
                {toolModels.map((model) => (
                  <div key={model.name} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50" style={{ position: 'relative', height: '48px' }}>
                    <div className="font-mono text-sm text-gray-900 dark:text-white" style={{ position: 'absolute', left: 80, top: '50%', transform: 'translateY(-50%)', width: '180px', paddingLeft: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{model.displayName}{renderProviderBadge(model.provider)}</div>
                    <div className="flex justify-center items-center text-sm font-medium text-blue-600/95" style={{ position: 'absolute', left: 375, top: '50%', transform: 'translateY(-50%)', width: '80px' }}>{model.resolutions[0]?.credits || '-'}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-300 truncate" style={{ position: 'absolute', left: 667, top: '50%', transform: 'translateY(-50%)', width: '400px', paddingLeft: '12px' }}>{model.description}</div>
                  </div>
                ))}
              </div>
            </div>
            </div>
            )}

            {/* 等级说明 */}
            <div className="bg-white dark:bg-[#2A2C3F] rounded-xl p-6 border border-gray-200 dark:border-transparent w-4/5 mx-auto">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">模型等级说明</h3>
              <div className="grid grid-cols-4 gap-x-6 gap-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">快速</span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">速度快，成本低</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">标准</span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">性价比高</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">专业</span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">高质量输出</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">VIP</span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">顶级质量，优先队列</span>
                </div>
              </div>
            </div>
          </div>
          )}

          {/* 刷新提示 */}
          <div className="mt-6 text-center text-sm text-gray-400 dark:text-gray-500">
            状态每30秒自动刷新一次
          </div>
      </div>

      {/* 登录/注册模态框 */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authMode}
        onLoginSuccess={handleLoginSuccess}
      />
    </div>
  );
}
