'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Navbar from '@/components/Navbar';
import AuthModal from '@/components/AuthModal';
import LeftNav from '@/components/LeftNav';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ModelDetector, MODEL_MODE_CONSTRAINTS, getProviderMediaLimits, isFormatAllowed, getVideoDuration, getAudioDuration } from '@/lib/model-utils';
import RichPromptEditor, { translatePromptWithCapsules } from '@/components/RichPromptEditor';
import { Upload, X, Play, Download, Video as VideoIcon, Loader2, ZoomIn, Plus, Trash2, ChevronDown, Edit2 } from 'lucide-react';
import { generateStore, VideoTask } from '@/store/generateStore';
import { fetchUserWithCache, updateCachedCredits } from '@/lib/user-cache';
import { fetchConfig } from '@/lib/config-fetch';
import RoseCurveAnimation from '@/components/canvas/RoseCurve';
import { useTheme } from 'next-themes';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';
import { safeSetItem } from '@/lib/safe-storage';
import { safeJsonResponse } from '@/lib/safe-json';
import { getEffectiveSources, getMaterialTypeLimits, getModelSupportedTypes, getModelMaxLimits, type SourceItem } from '@/lib/effective-sources';
import { ModelModeSwitcher, type Seedance2Mode, type VideoModelMode, getHappyHorseModeParams, isSeedance2Model as isSeedance2ModelFn, getSeedance2ModeParams, getSeedance2SlotStatus, getT8SeedanceModeParams, isT8SeedanceModel as isT8SeedanceModelFn, isTopaisVeoModel as isTopaisVeoModelFn, getTopaisModeParams, isTopaisHhModel as isTopaisHhModelFn, getTopaisHhModeParams, isTopaisSeedanceModel as isTopaisSeedanceModelFn, getTopaisSeedanceModeParams, isTopaisGeminiOmniModel as isTopaisGeminiOmniModelFn, getTopaisGeminiOmniModeParams, isMegaAiSeedanceModel as isMegaAiSeedanceModelFn, getMegaAiSeedanceModeParams, isTopaisMinimaxModel as isTopaisMinimaxModelFn, getTopaisMinimaxModeParams, getTopaisMinimaxRatioStates, formatRatioLabel, getLingyaVeoModeParams, getLingyaSoraModeParams, isTopaisKlingOmniModel as isTopaisKlingOmniModelFn, getTopaisKlingOmniModeParams } from '@/components/ModelModeSwitcher';
import AudioUploader, { type AudioRef } from '@/components/AudioUploader';
// 【方案C：静态导入】移除动态 import
import { compressImageForUpload } from '@/lib/frontend-defense';
import { useFakeProgress } from '@/hooks/useFakeProgress';
import { translateErrorMessage } from '@/lib/error-handler';

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
  const scale = 14 / Math.max(w, h);
  const scaledW = w * scale;
  const scaledH = h * scale;

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
      <rect
        x={(16 - scaledW) / 2}
        y={(16 - scaledH) / 2}
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

// 模型 logo 映射（与 GeneratePanelNode/temp_RightPanel 一致）
function getModelLogoForVideoPage(modelId: string): string {
  const id = modelId.toLowerCase();
  const family = ModelDetector.getFamily(modelId);
  if (id.includes('gemini')) return '/gemini-logo.png';
  if (id.includes('gpt-5')) return '/gpt-image-2-logo.png';
  if (['seedance2', 't8seedance', 'topais-seedance', 'mega-ai-seedance', 'topais-minimax', 'topais-kling-omni'].includes(family)) return '/seedance-logo.png';
  if (family === 'lingya-veo' || id.includes('veo_3')) return '/veo-logo.png';  // LingYa Veo3.1（veo_3_1 格式）
  if (family === 'veo' || id.includes('veo3')) return '/veo-logo.png';          // T8 Veo（veo3.1 格式）
  if (family === 'lingya-sora' || id.includes('sora-2-all-vip')) return '/gpt-image-2-logo.png';  // LingYa Sora-2 VIP
  if (family === 'sora') return '/gpt-image-2-logo.png';                        // T8 Sora-2
  if (family === 'happyhorse') return '/happyhorse-logo.png';                    // LingYa HappyHorse
  if (family === 'topais') return '/veo-logo.png';                               // TOPAIS Veo
  if (family === 'topais-happyhorse') return '/happyhorse-logo.png';             // TOPAIS HappyHorse
  if (family === 'topais-gemini-omni') return '/gemini-logo.png';              // TOPAIS Gemini Omni Flash
  if (id.includes('banana')) return '/banana-logo.png';
  if (id.includes('gpt-image-2') || id.includes('gptimage2')) return '/gpt-image-2-logo.png';
  return '/logo-main.png';
}
function isDarkLogoForVideoPage(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (id.includes('banana')) return false;
  return true;
}

// 模型配置类型定义
type ImageMode = 'first_frame' | 'first_last_frame' | 'component_reference' | 'flexible';

interface VideoModelConfig {
  id: string;
  name: string;
  desc: string;
  credits: number;
  type: string;
  aspectRatios: string[];
  maxRefImages: number;
  imageMode: ImageMode;
  supportsDuration: boolean;
  supportsUpsample: boolean;
  is_active: boolean;
  durations: { label: string; value: string; credits: number }[];
  resolutions?: { label: string; value: string; credits: number }[];
  showDuration?: boolean;  // 前端是否显示时长选择（Sora/Veo隐藏）
  showResolution?: boolean;  // 前端是否显示分辨率选择（Sora/Veo隐藏）
  videoInputDiscount?: number; // #642 Seedance 2.0 视频输入折扣系数
}

// 模型配置（默认兜底）
const defaultModels: VideoModelConfig[] = [
  { id: 'sora-2', name: 'Sora 2', desc: '标准模型', credits: 23, type: 'sora', aspectRatios: ['9:16', '16:9'], maxRefImages: 1, imageMode: 'first_last_frame', supportsDuration: true, supportsUpsample: false, is_active: false, showDuration: true, showResolution: false, durations: [{ label: '10秒', value: '10', credits: 23 }] },
  { id: 'sora-2-all-vip', name: 'Sora-2 VIP', desc: '灵芽通道，10秒/15秒可选', credits: 60, type: 'lingya-sora', aspectRatios: ['16:9', '9:16'], maxRefImages: 1, imageMode: 'first_frame', supportsDuration: true, supportsUpsample: false, is_active: false, showDuration: true, showResolution: false, durations: [{ label: '10秒', value: '10', credits: 60 }, { label: '15秒', value: '15', credits: 90 }] },
  { id: 'happyhorse-1.0', name: 'HappyHorse 1.0', desc: '高质量视频生成，支持图片/视频输入', credits: 0, type: 'happyhorse', aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'], maxRefImages: 9, imageMode: 'flexible', supportsDuration: true, supportsUpsample: false, is_active: false, showDuration: true, showResolution: true, durations: Array.from({length: 13}, (_, i) => ({ label: `${i+3}秒`, value: String(i+3), credits: 0 })), resolutions: [{ label: '720P', value: '720p', credits: 0 }, { label: '1080P', value: '1080p', credits: 0 }] },
  { id: 'seedance-2', name: 'Seedance 2.0', desc: '火山方舟视频生成，支持文生/图生/多模态参考', credits: 0, type: 'seedance2', aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'], maxRefImages: 9, imageMode: 'flexible', supportsDuration: true, supportsUpsample: false, is_active: false, showDuration: true, showResolution: true, durations: Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 })), resolutions: [{ label: '480P', value: '480p', credits: 0 }, { label: '720P', value: '720p', credits: 0 }, { label: '1080P', value: '1080p', credits: 0 }], videoInputDiscount: 0.5 },
  { id: 'seedance-2-fast', name: 'Seedance 2.0 Fast', desc: '火山方舟快速版，不支持1080p', credits: 0, type: 'seedance2', aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'], maxRefImages: 9, imageMode: 'flexible', supportsDuration: true, supportsUpsample: false, is_active: false, showDuration: true, showResolution: true, durations: Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 })), resolutions: [{ label: '480P', value: '480p', credits: 0 }, { label: '720P', value: '720p', credits: 0 }], videoInputDiscount: 0.5 },
  // #671 T8 Seedance 默认兜底配置（Pro满血版支持1080P，Lite极速版不支持）
  // #672 模型 ID 正骨：sdols-01-pro → sdols-2.0, sdols-01-lite → sdols-2.0-fast
  { id: 'sdols-2.0', name: 'Seedance 2.0 Pro', desc: 'T8通道视频生成，支持文生/图生/多模态参考', credits: 0, type: 'seedance', aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'], maxRefImages: 9, imageMode: 'flexible', supportsDuration: true, supportsUpsample: false, is_active: false, showDuration: true, showResolution: true, durations: Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 })), resolutions: [{ label: '480P', value: '480p', credits: 40 }, { label: '720P', value: '720p', credits: 60 }, { label: '1080P', value: '1080p', credits: 100 }], videoInputDiscount: 0.5 },
  { id: 'sdols-2.0-fast', name: 'Seedance 2.0 Lite', desc: 'T8通道快速版视频生成，不支持1080p', credits: 0, type: 'seedance', aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'], maxRefImages: 9, imageMode: 'flexible', supportsDuration: true, supportsUpsample: false, is_active: false, showDuration: true, showResolution: true, durations: Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 })), resolutions: [{ label: '480P', value: '480p', credits: 40 }, { label: '720P', value: '720p', credits: 60 }], videoInputDiscount: 0.5 },
  // #850 TOPAIS MiniMax-H3 默认兜底配置（2K/768p可选/4-15秒/t2v不支持adaptive/i2v比例被忽略）
  { id: 'topais-minimax-h3', name: 'MiniMax H3', desc: 'ToAPIs通道视频生成，支持2K/768p，文生/首帧/首尾帧/参考生四模式', credits: 100, type: 'topais-minimax', aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'], maxRefImages: 9, imageMode: 'flexible', supportsDuration: true, supportsUpsample: false, is_active: false, showDuration: true, showResolution: true, durations: Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 })), resolutions: [{ label: '2K', value: '2K', credits: 100 }, { label: '768P', value: '768p', credits: 50 }] },
  // Kling v3 Omni: 支持文生/图生/有声视频/参考视频, 720P(std)/1080P(pro), 3-15秒, 16:9/9:16/1:1
  { id: 'topais-kling-omni', name: 'Kling v3 Omni', desc: 'ToAPIs通道视频生成，支持图片引用/有声视频/参考视频', credits: 60, type: 'topais-kling-omni', aspectRatios: ['16:9', '9:16', '1:1'], maxRefImages: 9, imageMode: 'flexible', supportsDuration: true, supportsUpsample: false, is_active: false, showDuration: true, showResolution: true, durations: Array.from({length: 13}, (_, i) => ({ label: `${i+3}秒`, value: String(i+3), credits: 0 })), resolutions: [{ label: '720P', value: 'std', credits: 60 }, { label: '1080P', value: 'pro', credits: 100 }] },
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
        // #838 去重：使用 fetchConfig 替代裸 fetch
        const data = await fetchConfig('/api/config?service_type=video_generation');
        if (data.success && data.data?.models) {
          const models = data.data.models
            .map((m: { model_id: string; model_name: string; credits: number; description?: string; is_active: boolean; parameters?: any; credits_base?: number }) => {
              const durations = m.parameters?.durations || [];
              const aspectRatios = (m.parameters?.aspectRatios || []).map((r: any) => r.value || r.label);
              const maxRefImages = m.parameters?.maxImages || 1;
              const imageMode = m.parameters?.imageMode || 'first_last_frame';
              const supportsDuration = m.parameters?.supportsDuration !== false;
              const supportsUpsample = m.parameters?.supportsUpsample === true;
              const showDuration = m.parameters?.showDuration !== false && durations.length > 0;
              const showResolution = m.parameters?.showResolution !== false;
              // === 独立性标识：每个模型家族使用 ModelDetector 统一判断 ===
              const _mFamily = ModelDetector.getFamily(m.model_id);
              const isLingyaVeoModel = _mFamily === 'lingya-veo';       // LingYa Veo3.1（veo_3_1 格式）
              const isT8VeoModel = _mFamily === 'veo';                  // T8 Veo3.1（veo3.1 格式）
              const isLingyaSoraModel = _mFamily === 'lingya-sora';     // LingYa Sora-2 VIP
              const isT8SoraModel = _mFamily === 'sora';                // T8 Sora-2
              const isSeedanceModel = _mFamily === 't8seedance';        // T8 Seedance (sdols)
              const isHappyHorseModel = _mFamily === 'happyhorse';      // LingYa HappyHorse
              const isSeedance2Model = _mFamily === 'seedance2';        // LingYa Seedance 2.0
              const isTopaisModel = _mFamily === 'topais';              // TOPAIS Veo
              const isTopaisHhModel = _mFamily === 'topais-happyhorse'; // TOPAIS HappyHorse
              const isTopaisSeedanceModel = _mFamily === 'topais-seedance'; // TOPAIS Seedance 2.0
              const isMegaAiSeedanceModel = _mFamily === 'mega-ai-seedance'; // MEGA AI Seedance 2.0
              const isTopaisMinimaxModel = _mFamily === 'topais-minimax'; // TOPAIS MiniMax-H3
              const isTopaisGeminiOmniModel = _mFamily === 'topais-gemini-omni'; // TOPAIS Gemini Omni Flash
              const isTopaisKlingOmniModel = _mFamily === 'topais-kling-omni'; // TOPAIS Kling v3 Omni
              const resolutions = (m.parameters?.resolutions || []).map((r: any) => ({
                label: r.label || r.value,
                value: r.value || r.label,
                credits: r.credits || 80,
              }));
              // === 各模型独立硬编码默认值 ===
              // LingYa HappyHorse：3-15秒，5个比例
              const HH_DEFAULT_DURATIONS = Array.from({length: 13}, (_, i) => ({ label: `${i+3}秒`, value: String(i+3), credits: 0 }));
              const HH_DEFAULT_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
              const HH_RESOLUTIONS = [
                { label: '720P', value: '720p', credits: 0 },
                { label: '1080P', value: '1080p', credits: 0 },
              ];
              // TOPAIS HappyHorse：同 HappyHorse 比例和时长（独立定义，不共用变量）
              const TOPAIS_HH_DEFAULT_DURATIONS = Array.from({length: 13}, (_, i) => ({ label: `${i+3}秒`, value: String(i+3), credits: 0 }));
              const TOPAIS_HH_DEFAULT_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
              const TOPAIS_HH_RESOLUTIONS = [
                { label: '720P', value: '720p', credits: 50 },
                { label: '1080P', value: '1080p', credits: 80 },
              ];
              // TOPAIS Gemini Omni Flash：4/6/8/10秒，16:9/9:16，720P/1080p（1080p仅16:9）
              const TOPAIS_GO_DEFAULT_DURATIONS = [{ label: '4秒', value: '4', credits: 0 }, { label: '6秒', value: '6', credits: 0 }, { label: '8秒', value: '8', credits: 0 }, { label: '10秒', value: '10', credits: 0 }];
              const TOPAIS_GO_DEFAULT_ASPECT_RATIOS = ['16:9', '9:16'];
              const TOPAIS_GO_RESOLUTIONS = [
                { label: '720P', value: '720P', credits: 50 },
                { label: '1080P', value: '1080p', credits: 80 },
              ];
              // LingYa Sora-2 VIP：10s/15s
              const LINGYA_SORA_DURATIONS = [{ label: '10秒', value: '10', credits: 60 }, { label: '15秒', value: '15', credits: 90 }];
              const LINGYA_SORA_DEFAULT_RATIOS = ['16:9', '9:16'];
              // LingYa Seedance 2.0：4-15秒，7个比例
              const SEEDANCE2_DEFAULT_DURATIONS = Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 }));
              const SEEDANCE2_DEFAULT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'];
              const SEEDANCE_PRO_RESOLUTIONS = [
                { label: '480P', value: '480p', credits: 40 },
                { label: '720P', value: '720p', credits: 60 },
                { label: '1080P', value: '1080p', credits: 100 },
              ];
              const SEEDANCE_LITE_RESOLUTIONS = [
                { label: '480P', value: '480p', credits: 40 },
                { label: '720P', value: '720p', credits: 60 },
              ];
              // TOPAIS Seedance 2.0：4-15秒（标准）/4-12秒（Fast），6个比例（独立定义）
              const TOPAIS_SEEDANCE_DEFAULT_DURATIONS = Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 }));
              const TOPAIS_SEEDANCE_FAST_DURATIONS = Array.from({length: 9}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 }));
              const TOPAIS_SEEDANCE_DEFAULT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
              const TOPAIS_SEEDANCE_RESOLUTIONS = [
                { label: '480P', value: '480p', credits: 40 },
                { label: '720P', value: '720p', credits: 80 },
                { label: '1080P', value: '1080p', credits: 120 },
              ];
              const TOPAIS_SEEDANCE_FAST_RESOLUTIONS = [
                { label: '480P', value: '480p', credits: 40 },
                { label: '720P', value: '720p', credits: 60 },
              ];
              // MEGA AI Seedance 2.0：4-15秒，6个比例，固定720p（独立定义）
              const MEGA_AI_SEEDANCE_DEFAULT_DURATIONS = Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 }));
              const MEGA_AI_SEEDANCE_DEFAULT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
              const MEGA_AI_SEEDANCE_RESOLUTIONS = [
                { label: '720P', value: '720p', credits: 80 },  // 固定720p，只有这一个分辨率
              ];
              // TOPAIS MiniMax-H3：4-15秒，比例按模式过滤（t2v不含adaptive），2K/768p可选
              const TOPAIS_MINIMAX_DEFAULT_DURATIONS = Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 }));
              const TOPAIS_MINIMAX_DEFAULT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'];  // 视频页无模式切换(默认t2v)，adaptive变灰不可选
              const TOPAIS_MINIMAX_RESOLUTIONS = [
                { label: '2K', value: '2K', credits: 100 },
                { label: '768P', value: '768p', credits: 50 },
              ];
              // TOPAIS Kling v3 Omni：3-15秒，16:9/9:16/1:1，720P/1080P（mode=std/pro）
              const TOPAIS_KLING_OMNI_DEFAULT_DURATIONS = Array.from({length: 13}, (_, i) => ({ label: `${i+3}秒`, value: String(i+3), credits: 0 }));
              const TOPAIS_KLING_OMNI_DEFAULT_RATIOS = ['16:9', '9:16', '1:1'];
              const TOPAIS_KLING_OMNI_RESOLUTIONS = [
                { label: '720P', value: '720P', credits: 50 },
                { label: '1080P', value: '1080P', credits: 80 },
              ];
              // T8 Seedance (sdols)：4-15秒，7个比例（独立定义）
              const T8SEEDANCE_DEFAULT_DURATIONS = Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 }));
              const T8SEEDANCE_DEFAULT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'];
              // TOPAIS Veo3.1-fast：固定8秒，16:9/9:16，720p/1080p/4k
              const TOPAIS_VEO_DEFAULT_DURATIONS = [{ label: '8秒', value: '8', credits: 0 }];
              const TOPAIS_VEO_DEFAULT_RATIOS = ['16:9', '9:16'];
              const TOPAIS_VEO_RESOLUTIONS = [
                { label: '720P', value: '720p', credits: 50 },
                { label: '1080P', value: '1080p', credits: 80 },
                { label: '4K', value: '4k', credits: 150 },
              ];
              // LingYa Veo3.1：固定8秒，16:9/9:16，720p/4K（独立于 TOPAIS Veo 和 T8 Veo）
              const LINGYA_VEO_DEFAULT_DURATIONS = [{ label: '8秒', value: '8', credits: 0 }];
              const LINGYA_VEO_DEFAULT_RATIOS = ['16:9', '9:16'];
              const LINGYA_VEO_RESOLUTIONS = [
                { label: '720P', value: '720p', credits: 50 },
                { label: '4K', value: '4K', credits: 150 },
              ];
              // T8 Veo：16:9/9:16，720p/1080p（独立于 LingYa Veo 和 TOPAIS Veo）
              const T8_VEO_DEFAULT_RATIOS = ['16:9', '9:16'];
              const T8_VEO_RESOLUTIONS = [
                { label: '720P', value: '720p', credits: 80 },
                { label: '1080P', value: '1080p', credits: 100 },
              ];
              // T8 Sora-2：16:9/9:16，720p（独立于 LingYa Sora）
              const T8_SORA_DEFAULT_RATIOS = ['16:9', '9:16'];
              const T8_SORA_RESOLUTIONS = [
                { label: '720P', value: '720p', credits: 23 },
              ];
              // Pro/Lite 精准分流：判断是否为极速版
              const isLiteModel = m.model_id.includes('lite') || m.model_id.includes('fast');
              return {
                id: m.model_id,
                name: m.model_name,
                desc: m.description || m.model_name,
                credits: m.credits_base || m.credits || 23,
                // === 独立性：每个模型家族自己的 type 标识 ===
                type: _mFamily,
                // === 独立性：每个模型家族自己的硬编码默认值 ===
                aspectRatios: isHappyHorseModel ? HH_DEFAULT_ASPECT_RATIOS
                  : isTopaisHhModel ? TOPAIS_HH_DEFAULT_ASPECT_RATIOS
                  : isTopaisGeminiOmniModel ? TOPAIS_GO_DEFAULT_ASPECT_RATIOS
                  : isTopaisMinimaxModel ? TOPAIS_MINIMAX_DEFAULT_RATIOS
                  : isTopaisKlingOmniModel ? TOPAIS_KLING_OMNI_DEFAULT_RATIOS
                  : isMegaAiSeedanceModel ? MEGA_AI_SEEDANCE_DEFAULT_RATIOS
                  : isSeedance2Model ? SEEDANCE2_DEFAULT_RATIOS
                  : isTopaisSeedanceModel ? TOPAIS_SEEDANCE_DEFAULT_RATIOS
                  : isSeedanceModel ? T8SEEDANCE_DEFAULT_RATIOS
                  : isTopaisModel ? TOPAIS_VEO_DEFAULT_RATIOS
                  : isLingyaVeoModel ? LINGYA_VEO_DEFAULT_RATIOS
                  : isT8VeoModel ? T8_VEO_DEFAULT_RATIOS
                  : isLingyaSoraModel ? LINGYA_SORA_DEFAULT_RATIOS
                  : isT8SoraModel ? T8_SORA_DEFAULT_RATIOS
                  : (aspectRatios.length > 0 ? aspectRatios : ['9:16', '16:9']),
                maxRefImages,
                imageMode,
                supportsDuration,
                supportsUpsample,
                is_active: m.is_active !== false,
                durations: isHappyHorseModel ? HH_DEFAULT_DURATIONS
                  : isTopaisHhModel ? TOPAIS_HH_DEFAULT_DURATIONS
                  : isTopaisGeminiOmniModel ? TOPAIS_GO_DEFAULT_DURATIONS
                  : isLingyaSoraModel ? LINGYA_SORA_DURATIONS
                  : isTopaisMinimaxModel ? TOPAIS_MINIMAX_DEFAULT_DURATIONS
                  : isTopaisKlingOmniModel ? TOPAIS_KLING_OMNI_DEFAULT_DURATIONS
                  : isMegaAiSeedanceModel ? MEGA_AI_SEEDANCE_DEFAULT_DURATIONS
                  : isSeedance2Model ? SEEDANCE2_DEFAULT_DURATIONS
                  : isTopaisSeedanceModel ? (isLiteModel ? TOPAIS_SEEDANCE_FAST_DURATIONS : TOPAIS_SEEDANCE_DEFAULT_DURATIONS)
                  : isSeedanceModel ? T8SEEDANCE_DEFAULT_DURATIONS
                  : isTopaisModel ? TOPAIS_VEO_DEFAULT_DURATIONS
                  : isLingyaVeoModel ? LINGYA_VEO_DEFAULT_DURATIONS
                  : (durations.length > 0 ? durations : durations),
                // === 独立性：每个模型家族自己的分辨率列表 ===
                resolutions: isHappyHorseModel ? HH_RESOLUTIONS
                  : isTopaisHhModel ? TOPAIS_HH_RESOLUTIONS
                  : isTopaisGeminiOmniModel ? TOPAIS_GO_RESOLUTIONS
                  : isTopaisMinimaxModel ? TOPAIS_MINIMAX_RESOLUTIONS
                  : isTopaisKlingOmniModel ? TOPAIS_KLING_OMNI_RESOLUTIONS
                  : isMegaAiSeedanceModel ? MEGA_AI_SEEDANCE_RESOLUTIONS
                  : isTopaisSeedanceModel ? (isLiteModel ? TOPAIS_SEEDANCE_FAST_RESOLUTIONS : TOPAIS_SEEDANCE_RESOLUTIONS)
                  : (isSeedanceModel || isSeedance2Model)
                    ? (isLiteModel ? SEEDANCE_LITE_RESOLUTIONS : SEEDANCE_PRO_RESOLUTIONS)
                  : isTopaisModel ? TOPAIS_VEO_RESOLUTIONS
                  : isLingyaVeoModel ? LINGYA_VEO_RESOLUTIONS
                  : isT8VeoModel ? T8_VEO_RESOLUTIONS
                  : isT8SoraModel ? T8_SORA_RESOLUTIONS
                  : (resolutions.length > 0 ? resolutions : undefined),
                showDuration: isLingyaSoraModel ? true
                  : isSeedanceModel ? true
                  : isMegaAiSeedanceModel ? true
                  : isTopaisMinimaxModel ? true
                  : isTopaisKlingOmniModel ? true
                  : isSeedance2Model ? true
                  : isTopaisSeedanceModel ? true
                  : isTopaisModel ? true
                  : isTopaisGeminiOmniModel ? true
                  : isLingyaVeoModel ? true
                  : isHappyHorseModel ? true
                  : isTopaisHhModel ? true
                  : showDuration,
                showResolution: isMegaAiSeedanceModel ? false : isTopaisSeedanceModel ? true : isTopaisKlingOmniModel ? true : showResolution,  // MEGA AI 固定720p不显示，Kling Omni 支持720P/1080P显示
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
      const fetchModels = async () => {
        try {
          // #838 去重：使用 fetchConfig 替代裸 fetch
          const data = await fetchConfig('/api/config?service_type=video_generation');
          if (data.success && data.data?.models) {
            const models = data.data.models
              .map((m: { model_id: string; model_name: string; credits: number; description?: string; is_active: boolean; parameters?: any; credits_base?: number }) => {
                const durations = m.parameters?.durations || [];
                const aspectRatios = (m.parameters?.aspectRatios || []).map((r: any) => r.value || r.label);
                const maxRefImages = m.parameters?.maxImages || 1;
                const imageMode = m.parameters?.imageMode || 'first_last_frame';
                const supportsDuration = m.parameters?.supportsDuration !== false;
                const supportsUpsample = m.parameters?.supportsUpsample === true;
                const showDuration = m.parameters?.showDuration !== false && durations.length > 0;
                const showResolution = m.parameters?.showResolution !== false;
                // === 独立性标识：每个模型家族使用 ModelDetector 统一判断 ===
                const _mFamily = ModelDetector.getFamily(m.model_id);
                const isLingyaVeoModel = _mFamily === 'lingya-veo';
                const isT8VeoModel = _mFamily === 'veo';
                const isLingyaSoraModel = _mFamily === 'lingya-sora';
                const isT8SoraModel = _mFamily === 'sora';
                const isSeedanceModel = _mFamily === 't8seedance';
                const isHappyHorseModel = _mFamily === 'happyhorse';
                const isSeedance2Model = _mFamily === 'seedance2';
                const isTopaisModel = _mFamily === 'topais';
                const isTopaisHhModel = _mFamily === 'topais-happyhorse';
                const isTopaisSeedanceModel = _mFamily === 'topais-seedance'; // TOPAIS Seedance 2.0
                const isMegaAiSeedanceModel = _mFamily === 'mega-ai-seedance'; // MEGA AI Seedance 2.0
                const isTopaisMinimaxModel = _mFamily === 'topais-minimax'; // TOPAIS MiniMax-H3
                const isTopaisKlingOmniModel = _mFamily === 'topais-kling-omni'; // TOPAIS Kling v3 Omni
                const resolutions = (m.parameters?.resolutions || []).map((r: any) => ({
                  label: r.label || r.value,
                  value: r.value || r.label,
                  credits: r.credits || 80,
                }));
                // === 各模型独立硬编码默认值（与第一处配置完全一致）===
                const HH_DEFAULT_DURATIONS = Array.from({length: 13}, (_, i) => ({ label: `${i+3}秒`, value: String(i+3), credits: 0 }));
                const HH_DEFAULT_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
                const HH_RESOLUTIONS = [{ label: '720P', value: '720p', credits: 0 }, { label: '1080P', value: '1080p', credits: 0 }];
                const TOPAIS_HH_DEFAULT_DURATIONS = Array.from({length: 13}, (_, i) => ({ label: `${i+3}秒`, value: String(i+3), credits: 0 }));
                const TOPAIS_HH_DEFAULT_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
                const TOPAIS_HH_RESOLUTIONS = [{ label: '720P', value: '720p', credits: 50 }, { label: '1080P', value: '1080p', credits: 80 }];
                const TOPAIS_GO_DEFAULT_DURATIONS = [{ label: '4秒', value: '4', credits: 0 }, { label: '6秒', value: '6', credits: 0 }, { label: '8秒', value: '8', credits: 0 }, { label: '10秒', value: '10', credits: 0 }];
                const TOPAIS_GO_DEFAULT_ASPECT_RATIOS = ['16:9', '9:16'];
                const TOPAIS_GO_RESOLUTIONS = [{ label: '720P', value: '720P', credits: 50 }, { label: '1080P', value: '1080p', credits: 80 }];
                const LINGYA_SORA_DURATIONS = [{ label: '10秒', value: '10', credits: 60 }, { label: '15秒', value: '15', credits: 90 }];
                const LINGYA_SORA_DEFAULT_RATIOS = ['16:9', '9:16'];
                const SEEDANCE2_DEFAULT_DURATIONS = Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 }));
                const SEEDANCE2_DEFAULT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'];
                const SEEDANCE_PRO_RESOLUTIONS = [{ label: '480P', value: '480p', credits: 40 }, { label: '720P', value: '720p', credits: 60 }, { label: '1080P', value: '1080p', credits: 100 }];
                const SEEDANCE_LITE_RESOLUTIONS = [{ label: '480P', value: '480p', credits: 40 }, { label: '720P', value: '720p', credits: 60 }];
                // TOPAIS Seedance 2.0（独立定义）
                const TOPAIS_SEEDANCE_DEFAULT_DURATIONS = Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 }));
                const TOPAIS_SEEDANCE_FAST_DURATIONS = Array.from({length: 9}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 }));
                const TOPAIS_SEEDANCE_DEFAULT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
                const TOPAIS_SEEDANCE_RESOLUTIONS = [{ label: '480P', value: '480p', credits: 40 }, { label: '720P', value: '720p', credits: 80 }, { label: '1080P', value: '1080p', credits: 120 }];
                const TOPAIS_SEEDANCE_FAST_RESOLUTIONS = [{ label: '480P', value: '480p', credits: 40 }, { label: '720P', value: '720p', credits: 60 }];
                const T8SEEDANCE_DEFAULT_DURATIONS = Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 }));
                const T8SEEDANCE_DEFAULT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'];
                const TOPAIS_VEO_DEFAULT_DURATIONS = [{ label: '8秒', value: '8', credits: 0 }];
                const TOPAIS_VEO_DEFAULT_RATIOS = ['16:9', '9:16'];
                const TOPAIS_VEO_RESOLUTIONS = [{ label: '720P', value: '720p', credits: 50 }, { label: '1080P', value: '1080p', credits: 80 }, { label: '4K', value: '4k', credits: 150 }];
                const LINGYA_VEO_DEFAULT_DURATIONS = [{ label: '8秒', value: '8', credits: 0 }];
                const LINGYA_VEO_DEFAULT_RATIOS = ['16:9', '9:16'];
                const LINGYA_VEO_RESOLUTIONS = [{ label: '720P', value: '720p', credits: 50 }, { label: '4K', value: '4K', credits: 150 }];
                const T8_VEO_DEFAULT_RATIOS = ['16:9', '9:16'];
                const T8_VEO_RESOLUTIONS = [{ label: '720P', value: '720p', credits: 80 }, { label: '1080P', value: '1080p', credits: 100 }];
                const T8_SORA_DEFAULT_RATIOS = ['16:9', '9:16'];
                const T8_SORA_RESOLUTIONS = [{ label: '720P', value: '720p', credits: 23 }];
                // MEGA AI Seedance 2.0（独立定义，固定720p）
                const MEGA_AI_SEEDANCE_DEFAULT_DURATIONS = Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 }));
                const MEGA_AI_SEEDANCE_DEFAULT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
                const MEGA_AI_SEEDANCE_RESOLUTIONS = [
                  { label: '720P', value: '720p', credits: 0 },
                ];
                // === TOPAIS MiniMax-H3 独立默认值 ===
                const TOPAIS_MINIMAX_DEFAULT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'];  // 视频页无模式切换(默认t2v)，adaptive变灰不可选
                const TOPAIS_MINIMAX_DEFAULT_DURATIONS = Array.from({length: 12}, (_, i) => ({ label: `${i+4}秒`, value: String(i+4), credits: 0 }));
                const TOPAIS_MINIMAX_RESOLUTIONS = [
                  { label: '2K', value: '2K', credits: 0 },
                  { label: '768P', value: '768p', credits: 0 },
                ];
                // === TOPAIS Kling v3 Omni 独立默认值 ===
                const TOPAIS_KLING_OMNI_DEFAULT_DURATIONS = Array.from({length: 13}, (_, i) => ({ label: `${i+3}秒`, value: String(i+3), credits: 0 }));
                const TOPAIS_KLING_OMNI_DEFAULT_RATIOS = ['16:9', '9:16', '1:1'];
                const TOPAIS_KLING_OMNI_RESOLUTIONS = [
                  { label: '720P', value: '720P', credits: 0 },
                  { label: '1080P', value: '1080P', credits: 0 },
                ];
                const isLiteModel = m.model_id.includes('lite') || m.model_id.includes('fast');
                return {
                  id: m.model_id,
                  name: m.model_name,
                  desc: m.description || m.model_name,
                  credits: m.credits_base || m.credits || 23,
                  type: _mFamily,
                  aspectRatios: isHappyHorseModel ? HH_DEFAULT_ASPECT_RATIOS
                    : isTopaisHhModel ? TOPAIS_HH_DEFAULT_ASPECT_RATIOS
                    : isTopaisGeminiOmniModel ? TOPAIS_GO_DEFAULT_ASPECT_RATIOS
                    : isMegaAiSeedanceModel ? MEGA_AI_SEEDANCE_DEFAULT_RATIOS
                    : isTopaisMinimaxModel ? TOPAIS_MINIMAX_DEFAULT_RATIOS
                    : isTopaisKlingOmniModel ? TOPAIS_KLING_OMNI_DEFAULT_RATIOS
                    : isSeedance2Model ? SEEDANCE2_DEFAULT_RATIOS
                    : isTopaisSeedanceModel ? TOPAIS_SEEDANCE_DEFAULT_RATIOS
                    : isSeedanceModel ? T8SEEDANCE_DEFAULT_RATIOS
                    : isTopaisModel ? TOPAIS_VEO_DEFAULT_RATIOS
                    : isLingyaVeoModel ? LINGYA_VEO_DEFAULT_RATIOS
                    : isT8VeoModel ? T8_VEO_DEFAULT_RATIOS
                    : isLingyaSoraModel ? LINGYA_SORA_DEFAULT_RATIOS
                    : isT8SoraModel ? T8_SORA_DEFAULT_RATIOS
                    : (aspectRatios.length > 0 ? aspectRatios : ['9:16', '16:9']),
                  maxRefImages,
                  imageMode,
                  supportsDuration,
                  supportsUpsample,
                  is_active: m.is_active !== false,
                  durations: isHappyHorseModel ? HH_DEFAULT_DURATIONS
                    : isTopaisHhModel ? TOPAIS_HH_DEFAULT_DURATIONS
                    : isTopaisGeminiOmniModel ? TOPAIS_GO_DEFAULT_DURATIONS
                    : isLingyaSoraModel ? LINGYA_SORA_DURATIONS
                    : isMegaAiSeedanceModel ? MEGA_AI_SEEDANCE_DEFAULT_DURATIONS
                    : isTopaisMinimaxModel ? TOPAIS_MINIMAX_DEFAULT_DURATIONS
                    : isTopaisKlingOmniModel ? TOPAIS_KLING_OMNI_DEFAULT_DURATIONS
                    : isSeedance2Model ? SEEDANCE2_DEFAULT_DURATIONS
                    : isTopaisSeedanceModel ? (isLiteModel ? TOPAIS_SEEDANCE_FAST_DURATIONS : TOPAIS_SEEDANCE_DEFAULT_DURATIONS)
                    : isSeedanceModel ? T8SEEDANCE_DEFAULT_DURATIONS
                    : isTopaisModel ? TOPAIS_VEO_DEFAULT_DURATIONS
                    : isLingyaVeoModel ? LINGYA_VEO_DEFAULT_DURATIONS
                    : (durations.length > 0 ? durations : durations),
                  resolutions: isHappyHorseModel ? HH_RESOLUTIONS
                    : isTopaisHhModel ? TOPAIS_HH_RESOLUTIONS
                    : isTopaisGeminiOmniModel ? TOPAIS_GO_RESOLUTIONS
                    : isMegaAiSeedanceModel ? MEGA_AI_SEEDANCE_RESOLUTIONS
                    : isTopaisMinimaxModel ? TOPAIS_MINIMAX_RESOLUTIONS
                    : isTopaisKlingOmniModel ? TOPAIS_KLING_OMNI_RESOLUTIONS
                    : isTopaisSeedanceModel ? (isLiteModel ? TOPAIS_SEEDANCE_FAST_RESOLUTIONS : TOPAIS_SEEDANCE_RESOLUTIONS)
                    : (isSeedanceModel || isSeedance2Model)
                      ? (isLiteModel ? SEEDANCE_LITE_RESOLUTIONS : SEEDANCE_PRO_RESOLUTIONS)
                    : isTopaisModel ? TOPAIS_VEO_RESOLUTIONS
                    : isLingyaVeoModel ? LINGYA_VEO_RESOLUTIONS
                    : isT8VeoModel ? T8_VEO_RESOLUTIONS
                    : isT8SoraModel ? T8_SORA_RESOLUTIONS
                    : (resolutions.length > 0 ? resolutions : undefined),
                  showDuration: isLingyaSoraModel ? true
                    : isSeedanceModel ? true
                    : isMegaAiSeedanceModel ? true
                    : isTopaisMinimaxModel ? true
                    : isTopaisKlingOmniModel ? true
                    : isSeedance2Model ? true
                    : isTopaisSeedanceModel ? true
                    : isTopaisModel ? true
                    : isTopaisGeminiOmniModel ? true
                    : isLingyaVeoModel ? true
                    : isHappyHorseModel ? true
                    : isTopaisHhModel ? true
                    : showDuration,
                  showResolution: isMegaAiSeedanceModel ? false : isTopaisSeedanceModel ? true : isTopaisKlingOmniModel ? true : showResolution,  // MEGA AI 固定720p不显示，Kling Omni 支持720P/1080P显示
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
  
  // 参数状态 - 带localStorage记忆功能
  const [model, setModel] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('video-page-model') || 'sora-2';
    }
    return 'sora-2';
  });
  const [prompt, setPrompt] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('video-page-prompt') || '';
    }
    return '';
  });
  const [aspectRatio, setAspectRatio] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('video-page-aspectRatio') || '16:9';
    }
    return '16:9';
  });
  const [duration, setDuration] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return parseInt(localStorage.getItem('video-page-duration') || '10', 10);
    }
    return 10;
  });
  const [resolution, setResolution] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('video-page-resolution');
      // #680 修复：强制小写，兼容旧缓存中的大写值（如 480P → 480p）
      const normalized = stored ? stored.toLowerCase() : '720p';
      if (stored && stored !== normalized) {
        localStorage.setItem('video-page-resolution', normalized);
      }
      return normalized;
    }
    return '720p';
  });
  
  // HappyHorse/Seedance 2.0 模式切换状态 - 带记忆（统一类型）
  const [hhOverrideMode, setHhOverrideMode] = useState<VideoModelMode | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('video-page-hhOverrideMode');
      return saved as VideoModelMode | null || null;
    }
    return null;
  });
  const [audioSetting, setAudioSetting] = useState<'auto' | 'origin'>('auto');
  const [inputVideoUrl, setInputVideoUrl] = useState<string | null>(null);
  const [referenceAudioUrls, setReferenceAudioUrls] = useState<string[]>([]);
  const [referenceVideoUrls, setReferenceVideoUrls] = useState<string[]>([]);
  // Seedance 2.0 参考视频/音频
  const [refVideoUrls, setRefVideoUrls] = useState<string[]>([]);
  const [refAudioFiles, setRefAudioFiles] = useState<AudioRef[]>([]);
  const [generateAudio, setGenerateAudio] = useState(true); // #642 Seedance 2.0 音频生成开关
  const refVideoInputRef = useRef<HTMLInputElement>(null);
  const refAudioInputRef = useRef<HTMLInputElement>(null); // #646 音频文件输入
  const isT8SeedanceModel = ModelDetector.getFamily(model) === 't8seedance'; // T8Star Seedance 1.0 (sdols-01-pro/lite)
  const isHappyHorseModel = ModelDetector.getFamily(model) === 'happyhorse';
  const isSeedance2Model = ModelDetector.getFamily(model) === 'seedance2';
  const isTopaisModel = ModelDetector.getFamily(model) === 'topais';  // #689 TOPAIS Veo 供应商
  const isTopaisHhModel = ModelDetector.getFamily(model) === 'topais-happyhorse';  // #691 TOPAIS HappyHorse 供应商
  const isTopaisSeedanceModel = ModelDetector.getFamily(model) === 'topais-seedance';  // TOPAIS Seedance 2.0 供应商
  const isTopaisGeminiOmniModel = ModelDetector.getFamily(model) === 'topais-gemini-omni';  // TOPAIS Gemini Omni Flash 供应商
  const isLingyaVeoModel = ModelDetector.getFamily(model) === 'lingya-veo';  // LingYa Veo3.1 供应商
  const isT8VeoModel = ModelDetector.getFamily(model) === 'veo';  // T8 Veo3.1 供应商
  const isLingyaSoraModel = ModelDetector.getFamily(model) === 'lingya-sora';  // LingYa Sora-2 VIP 供应商
  const isT8SoraModel = ModelDetector.getFamily(model) === 'sora';  // T8 Sora-2 供应商
  const isMegaAiSeedanceModel = ModelDetector.getFamily(model) === 'mega-ai-seedance';  // MEGA AI Seedance 2.0 供应商
  const isTopaisMinimaxModel = ModelDetector.getFamily(model) === 'topais-minimax';  // TOPAIS MiniMax-H3 供应商
  const isTopaisKlingOmniModel = ModelDetector.getFamily(model) === 'topais-kling-omni';  // TOPAIS Kling v3 Omni 供应商
  // 所有支持模式切换的视频模型
  // #301 补齐 LingYa Veo/Sora：支持 t2v/i2v/r2v 模式切换
  const isModeSwitchModel = isHappyHorseModel || isSeedance2Model || isT8SeedanceModel || isTopaisModel || isTopaisHhModel || isTopaisSeedanceModel || isTopaisGeminiOmniModel || isLingyaVeoModel || isLingyaSoraModel || isMegaAiSeedanceModel || isTopaisMinimaxModel || isTopaisKlingOmniModel;
  
  // 使用全局 store 管理参考图（必须在 useEffect 使用前定义）
  const [referenceImages, setReferenceImages] = useState<string[]>(() => generateStore.getVideoReferenceImages());
  // 参考图 URL 列表（用于发送给后端，必须在 useEffect 使用前定义 #660）
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [referenceImageKeys, setReferenceImageKeys] = useState<string[]>([]);  // #840 参考图 COS keys
  
  // #701 修复：hhCurrentMode 从 useState+useEffect 改为 useMemo
  // #702 修复：hhCurrentMode 改为 useState，由 ModelModeSwitcher 的 onModeChange 回调直接驱动
  // 根因：之前的 useMemo 推断逻辑与 ModelModeSwitcher 内部的 inferBaseMode 不一致，
  // 导致用户手动选择 r2v 后，推断逻辑仍返回 i2v（1张图→i2v），hhMode 发送错误值
  // 修复原则：模式映射是硬编码的确定性映射，不应自动推断
  // ModelModeSwitcher 是模式的唯一决策者，视频页面只接收结果
  const [hhCurrentMode, setHhCurrentMode] = useState<VideoModelMode>('t2v');

  // onModeChange 回调：直接设置 hhCurrentMode，不再写入 hhOverrideMode
  // 之前错误地将 onModeChange 的 displayMode（含推断值）写入 hhOverrideMode，
  // 导致 hhOverrideMode 被推断值覆盖，useMemo 误把推断值当作用户选择
  // #866 修复：MiniMax 模式切换时，自动切换被禁用的比例

  // 记忆功能：参数变化时自动保存到localStorage
  useEffect(() => { safeSetItem('video-page-model', model); }, [model]);
  useEffect(() => { safeSetItem('video-page-prompt', prompt); }, [prompt]);
  useEffect(() => { safeSetItem('video-page-aspectRatio', aspectRatio); }, [aspectRatio]);
  useEffect(() => { safeSetItem('video-page-duration', duration.toString()); }, [duration]);
  useEffect(() => { safeSetItem('video-page-resolution', resolution); }, [resolution]);
  useEffect(() => { if (hhOverrideMode) safeSetItem('video-page-hhOverrideMode', hhOverrideMode); }, [hhOverrideMode]);
  // #642 统一：根据模型类型获取模式参数
  // #667 T8 Seedance (sdols-2.0): 全模态解锁 t2v/i2v-first-frame/i2v-first-last-frame/r2v
  // #691 TOPAIS HappyHorse: t2v/i2v/r2v/video-edit 四种模式
  // #301 LingYa Veo/Sora: t2v/i2v/r2v 三种模式
  const hhParams = isModeSwitchModel
    ? (isMegaAiSeedanceModel
        ? getMegaAiSeedanceModeParams(hhCurrentMode)
        : isTopaisMinimaxModel
          ? getTopaisMinimaxModeParams(hhCurrentMode)
          : isTopaisKlingOmniModel
            ? getTopaisKlingOmniModeParams(hhCurrentMode)
            : isSeedance2Model
            ? getSeedance2ModeParams(hhCurrentMode as Seedance2Mode)
          : isT8SeedanceModel
            ? getT8SeedanceModeParams(hhCurrentMode)
            : isTopaisModel
              ? getTopaisModeParams(hhCurrentMode)
              : isTopaisHhModel
                ? getTopaisHhModeParams(hhCurrentMode)
                : isTopaisSeedanceModel
                  ? getTopaisSeedanceModeParams(hhCurrentMode)
                  : isTopaisGeminiOmniModel
                    ? getTopaisGeminiOmniModeParams(hhCurrentMode)
                    : isLingyaVeoModel
                      ? getLingyaVeoModeParams(hhCurrentMode)
                      : isLingyaSoraModel
                        ? getLingyaSoraModeParams(hhCurrentMode)
                        : getHappyHorseModeParams(hhCurrentMode))
    : null;
  
  // 格式化视频分辨率为大写显示（small→720P, medium→720P, large→1080P, 720p→720P, 1080p→1080P）
  const formatVideoResolution = (res: string): string => {
    if (!res) return '720P';
    const lower = res.toLowerCase();
    const mapping: Record<string, string> = {
      'small': '720P', 'medium': '720P', 'large': '1080P',
      '720p': '720P', '1080p': '1080P', '480p': '480P',
      '360p': '360P', '2k': '2K', '4k': '4K',
    };
    return mapping[lower] || res.toUpperCase();
  };
  
  // 当前模型配置
  const currentModelConfig = getModelConfig(model);

  // #542 当模型配置从DB加载后，同步时长/分辨率为该模型的默认值
  useEffect(() => {
    if (currentModelConfig.durations && currentModelConfig.durations.length > 0) {
      // 仅在当前 duration 不在该模型的可选列表中时重置
      const availableDurations = currentModelConfig.durations.map((d: any) => parseInt(d.value)).filter((v: number) => !isNaN(v));
      if (availableDurations.length > 0 && !availableDurations.includes(duration)) {
        setDuration(availableDurations[0]);
      }
    }
    if (currentModelConfig.resolutions && currentModelConfig.resolutions.length > 0) {
      // #680 修复：统一取 value（小写），value 为空才 fallback 到 label
      const availableResolutions = currentModelConfig.resolutions.map((r: any) => r.value || r.label);
      // #680 修复：大小写不敏感匹配，避免 480p vs 480P 不匹配
      const matchedRes = availableResolutions.find((r: string) => r.toLowerCase() === resolution.toLowerCase());
      if (matchedRes && matchedRes !== resolution) {
        // 值相同但大小写不同，修正为模型配置的值
        setResolution(matchedRes);
      } else if (!matchedRes) {
        setResolution(availableResolutions[0]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentModelConfig]);
  
  // #548 Sora-2 动态时长过滤：文生视频只有10s，图生视频4/8/10/12s
  useEffect(() => {
    if (model === 'sora-2') {
      const sora2Durations = referenceImages.length === 0
        ? [{ label: '10秒', value: '10' }]  // 文生视频：只有10s
        : [                                   // 图生视频：4/8/10/12s
            { label: '4秒', value: '4' },
            { label: '8秒', value: '8' },
            { label: '10秒', value: '10' },
            { label: '12秒', value: '12' },
          ];
      const availableSecs = sora2Durations.map(d => parseInt(d.value));
      if (!availableSecs.includes(duration)) {
        setDuration(10); // 当前时长不可用，重置为10s（两个模式都支持）
      }
    }
  }, [model, referenceImages.length, duration]);

  // #866 MiniMax: 模式切换时自动切换比例（三端一致策略）
  const handleModeChangeFromSwitcher = useCallback((mode: VideoModelMode) => {
    setHhCurrentMode(mode);
    if (isTopaisMinimaxModel && currentModelConfig?.aspectRatios?.length) {
      const ratioStates = getTopaisMinimaxRatioStates(mode, currentModelConfig.aspectRatios);
      const currentRatioState = ratioStates.find(rs => rs.ratio === aspectRatio);
      if (currentRatioState?.disabled) {
        const firstEnabled = ratioStates.find(rs => !rs.disabled);
        if (firstEnabled) {
          console.log('[#866] Video page 模式切换 ->', mode, '比例', aspectRatio, '->', firstEnabled.ratio);
          setAspectRatio(firstEnabled.ratio);
        }
      }
    }
  }, [isTopaisMinimaxModel, currentModelConfig, aspectRatio]);

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
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  
  // 上传状态
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [isVideoUploading, setIsVideoUploading] = useState(false);
  
  // #548 高清模式（enable_upsample）- 已移至分辨率按钮，1080p=启用

  // Veo模型：有参考图时自动降级1080p→720p
  useEffect(() => {
    if (currentModelConfig.supportsUpsample && referenceImages.length > 0 && resolution === '1080p') {
      setResolution('720p');
    }
  }, [referenceImages.length, currentModelConfig.supportsUpsample, resolution]);

  // ============================================
  // 【视频生成状态 - 统一生成引擎使用】
  // ============================================
  const [isGenerating, setIsGenerating] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [generatedVideo, setGeneratedVideo] = useState<{ url: string; key?: string; thumbnailUrl?: string } | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoKey, setVideoKey] = useState('');
  
  // #655 假进度引擎：视频模型无真实进度时启动假进度
  const hasRealVideoProgressRef = useRef(false);
  const fakeVideoProgress = useFakeProgress({
    enabled: false,
    mediaType: 'video',
    onProgress: (p) => {
      // 只在未收到真实进度时更新
      if (!hasRealVideoProgressRef.current) {
        setVideoProgress(p);
        setTasks(prev => prev.map(t =>
          t.status === 'generating' ? { ...t, progress: p } : t
        ));
      }
    },
  });

  // #548 计算视频积分消耗：固定计费模型用 credits_base，按秒计费模型用分辨率×时长
  const getVideoCreditCost = () => {
    // HappyHorse video-edit 模式：输入时长 + 输出时长（最长15秒）
    if (isHappyHorseModel && hhCurrentMode === 'video-edit') {
      const resolutions = currentModelConfig.resolutions || [];
      const resConfig = resolutions.find((r: { label: string; value: string; credits: number }) => (r.value || r.label) === resolution);
      const creditsPerSecond = resConfig?.credits || 67.5;
      // video-edit：输入时长 + 输出时长（最长15秒），暂时按15秒×2估算
      return creditsPerSecond * 15 * 2;
    }
    // Veo模型(supportsUpsample)：文生图按分辨率计费，图生图固定
    if (currentModelConfig.supportsUpsample) {
      if (referenceImages.length > 0) {
        // 图生图固定积分
        return (currentModelConfig as any).credits_base || currentModelConfig.credits || 80;
      }
      // 文生图按分辨率：1080p有额外费用
      const upsampleExtra = (currentModelConfig as any).upsampleCredits || 0;
      const baseCredits = (currentModelConfig as any).credits_base || currentModelConfig.credits || 80;
      return resolution === '1080p' ? baseCredits + upsampleExtra : baseCredits;
    }
    // 固定计费模式（Sora）：无时长无分辨率
    if (!currentModelConfig.showDuration && !currentModelConfig.showResolution) {
      return (currentModelConfig as any).credits_base || currentModelConfig.credits || 80;
    }
    // #641 Sora-2 VIP 2合1：按次计费（固定积分，不按时长变化）
    if (currentModelConfig.type === 'lingya-sora') {
      return (currentModelConfig as any).credits_base || currentModelConfig.credits || 60;
    }
    // #735 TOPAIS Veo：按次计费（固定积分，根据分辨率）
    if (isTopaisModel) {
      const videoPricing = (currentModelConfig as any).videoPricing;
      if (videoPricing?.mode === 'fixed' && videoPricing?.credits) {
        return videoPricing.credits;
      }
      // 兜底：根据分辨率返回固定积分（720p=50, 1080p=80, 4K=150）
      const res = (resolution || '720p').toLowerCase();
      if (res === '4k') return 150;
      if (res === '1080p') return 80;
      return 50; // 720p 默认
    }
    // #736 TOPAIS Seedance 2.0：按分辨率×时长计费（720p=80/秒, 1080p=120/秒; Fast版 720p=60/秒）
    if (isTopaisSeedanceModel) {
      const resolutions = currentModelConfig.resolutions || [];
      // #736 修复：大小写不敏感匹配
      const resConfig = resolutions.find((r: { label: string; value: string; credits: number }) => (r.value || r.label).toLowerCase() === (resolution || '720p').toLowerCase());
      const creditsPerSecond = resConfig?.credits || 80;
      const hasVideoInput = refVideoUrls.length > 0;
      const discount = hasVideoInput ? (currentModelConfig.videoInputDiscount || 1) : 1;
      return Math.ceil(duration * creditsPerSecond * discount);
    }
    // Seedance 2.0：按时长×分辨率单价计费，含视频输入自动折扣
    if (isSeedance2Model) {
      const resolutions = currentModelConfig.resolutions || [];
      const resConfig = resolutions.find((r: { label: string; value: string; credits: number }) => (r.value || r.label).toLowerCase() === (resolution || '720p').toLowerCase());
      const creditsPerSecond = resConfig?.credits || 80;
      const hasVideoInput = refVideoUrls.length > 0;
      const discount = hasVideoInput ? (currentModelConfig.videoInputDiscount || 1) : 1;
      return Math.ceil(duration * creditsPerSecond * discount);
    }
    // 按秒计费模式（Seedance 1.0）：分辨率单价 × 时长
    const resolutions = currentModelConfig.resolutions || [];
    const resConfig = resolutions.find((r: { label: string; value: string; credits: number }) => (r.value || r.label).toLowerCase() === (resolution || '720p').toLowerCase());
    const creditsPerSecond = resConfig?.credits || 80;
    return creditsPerSecond * duration;
  };
  const videoCreditCost = getVideoCreditCost();
  
  // 文件输入引用
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // 视频上传处理（HappyHorse video-edit 模式）
  const handleVideoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      toast.error('请上传视频文件');
      return;
    }
    if (!isModeSwitchModel) {
      toast.error('当前模型不支持视频参考');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    // #655 字典驱动校验：格式 + 大小 + 时长
    const family = ModelDetector.getFamily(model);
    const mediaLimits = getProviderMediaLimits(family);
    const videoLimit = mediaLimits?.video;
    if (videoLimit) {
      // 格式拦截
      if (!isFormatAllowed(file.type, videoLimit.formats)) {
        toast.error(`视频格式不支持，仅支持 ${videoLimit.formats.join('/')}`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      // 大小拦截
      if (file.size > videoLimit.maxSizeMB * 1024 * 1024) {
        toast.error(`视频超过${videoLimit.maxSizeMB}MB限制`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      // 时长拦截
      try {
        const duration = await getVideoDuration(file);
        if (duration < videoLimit.minDuration) {
          toast.error(`视频太短，最短${videoLimit.minDuration}秒`);
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }
        if (duration > videoLimit.maxDuration) {
          toast.error(`视频太长，最长${videoLimit.maxDuration}秒`);
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }
      } catch {
        console.warn('[Video] 无法读取视频时长，跳过前端时长校验');
      }
    }
    setIsVideoUploading(true);
    try {
      // 服务端中转上传 COS
      const formData = new FormData();
      formData.append('file', file);
      const uploadResponse = await fetch('/api/canvas/upload', { method: 'POST', body: formData });
      const uploadData = await safeJsonResponse<{ key?: string; url?: string }>(uploadResponse);
      if (uploadData.success) {
        const signedUrl = `/api/canvas/image?key=${encodeURIComponent(uploadData.key ?? '')}`;
        setInputVideoUrl(signedUrl);
        // #678 模式死锁解构：如果当前手动覆盖为 t2v（文生视频不允许有视频，产生互斥），
        // 则立即解除覆盖，放权给自动推断切入对应视频模式！
        if (hhOverrideMode === 't2v') {
          setHhOverrideMode(null);
        }
        toast.success('视频上传成功');
      } else {
        toast.error(uploadData.error || '视频上传失败');
      }
    } catch (err) {
      console.error('[Video] 视频上传失败:', err);
      toast.error('视频上传失败');
    }
    setIsVideoUploading(false);
    // 重置 input 以便重复选择同一文件（注意：现在使用合并的 fileInputRef）
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [isModeSwitchModel, model]);

  // Seedance 2.0 参考视频上传（多段，不同于主视频 inputVideoUrl）
  const handleRefVideoUpload = useCallback(async (file: File) => {
    // #655 字典驱动校验：格式 + 大小 + 时长
    const family = ModelDetector.getFamily(model);
    const mediaLimits = getProviderMediaLimits(family);
    const videoLimit = mediaLimits?.video;
    if (videoLimit) {
      // 格式拦截
      if (!isFormatAllowed(file.type, videoLimit.formats)) {
        toast.error(`视频 ${file.name} 格式不支持，仅支持 ${videoLimit.formats.join('/')}`);
        return;
      }
      // 大小拦截
      if (file.size > videoLimit.maxSizeMB * 1024 * 1024) {
        toast.error(`视频 ${file.name} 超过${videoLimit.maxSizeMB}MB限制`);
        return;
      }
      // 时长拦截：读取视频 duration
      try {
        const duration = await getVideoDuration(file);
        if (duration < videoLimit.minDuration) {
          toast.error(`视频 ${file.name} 太短，最短${videoLimit.minDuration}秒`);
          return;
        }
        if (duration > videoLimit.maxDuration) {
          toast.error(`视频 ${file.name} 太长，最长${videoLimit.maxDuration}秒`);
          return;
        }
      } catch {
        // 无法读取时长则放行，后端兜底
        console.warn('[Video] 无法读取视频时长，跳过前端时长校验');
      }
    }
    try {
      // 服务端中转上传 COS
      const formData = new FormData();
      formData.append('file', file);
      const uploadResponse = await fetch('/api/canvas/upload', { method: 'POST', body: formData });
      const uploadData = await safeJsonResponse<{ key?: string; url?: string }>(uploadResponse);
      if (uploadData.success) {
        const signedUrl = `/api/canvas/image?key=${encodeURIComponent(uploadData.key ?? '')}`;
        setRefVideoUrls(prev => [...prev, signedUrl]);
      } else {
        toast.error(uploadData.error || '参考视频上传失败');
      }
    } catch (err) {
      console.error('[Video] 参考视频上传失败:', err);
      toast.error('参考视频上传失败');
    }
  }, [model]);

  const removeRefVideo = useCallback((idx: number) => {
    setRefVideoUrls(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // RichPromptEditor 胶囊引用
  const mediaCapsulesRef = useRef<{ mediaIndex: number; label: string; type: 'image' | 'video' }[]>([]);

  // 参数选择弹窗状态
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showRatioPicker, setShowRatioPicker] = useState(false);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  
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

  // #624 持久化恢复：刷新后用 videoKeys 重新获取签名 URL
  useEffect(() => {
    const restoreVideoUrls = async () => {
      const completedTasks = tasks.filter(t => t.status === 'completed' && t.videoKeys && t.videoKeys.length > 0);
      if (completedTasks.length === 0) return;

      // 收集所有需要恢复的 key
      const allKeys: string[] = [];
      const taskKeyMap: { taskId: string; keyIndex: number; key: string }[] = [];
      for (const task of completedTasks) {
        for (let i = 0; i < (task.videoKeys?.length || 0); i++) {
          const key = task.videoKeys![i];
          if (key) {
            allKeys.push(key);
            taskKeyMap.push({ taskId: task.id, keyIndex: i, key });
          }
        }
      }

      if (allKeys.length === 0) return;

      try {
        const response = await fetch('/api/canvas/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: allKeys }),
        });

        if (!response.ok) return;

        const data = await response.json();
        if (!data.success || !data.urls) return;

        // 构建更新映射：taskId → 新的 videos 数组
        const updates: Record<string, string[]> = {};
        for (const entry of taskKeyMap) {
          const newUrl = data.urls[entry.key];
          if (newUrl) {
            if (!updates[entry.taskId]) {
              // 保留原有的 videos 数组长度
              const task = tasks.find(t => t.id === entry.taskId);
              updates[entry.taskId] = task ? [...task.videos] : [];
            }
            if (entry.keyIndex < updates[entry.taskId].length) {
              updates[entry.taskId][entry.keyIndex] = newUrl;
            } else {
              updates[entry.taskId].push(newUrl);
            }
          }
        }

        // 更新任务
        if (Object.keys(updates).length > 0) {
          setTasks(prev => prev.map(t => {
            const newVideos = updates[t.id];
            if (newVideos) {
              return { ...t, videos: newVideos };
            }
            return t;
          }));
        }
      } catch (e) {
        console.error('[视频持久化] 恢复签名URL失败:', e);
      }
    };

    restoreVideoUrls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在组件挂载时执行一次

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
        // 收集需要释放的 blob URL
        const blobUrlsToRevoke: string[] = [];
        
        if (data.imageUrl) {
          // 设置参考图
          if (data.imageUrl.startsWith('blob:')) blobUrlsToRevoke.push(data.imageUrl);
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
          if (firstImage.startsWith('blob:')) blobUrlsToRevoke.push(firstImage);
          setReferenceImages(prev => {
            if (prev.includes(firstImage)) return prev;
            return [...prev, firstImage];
          });
          sessionStorage.removeItem('canvasToSendVideo');
        }
        
        // ⚠️ P0.3 修复：延迟释放 blob URL（等图片加载完成）
        if (blobUrlsToRevoke.length > 0) {
          setTimeout(() => {
            blobUrlsToRevoke.forEach(url => {
              try { URL.revokeObjectURL(url); } catch {}
            });
          }, 5000);
        }
      } catch (e) {
        console.error('解析画布数据失败:', e);
      }
    }
  }, []);

  // 切换模型时重置相关参数
  const handleModelChange = (newModel: string) => {
    const newConfig = getModelConfig(newModel);
    setModel(newModel);
    // 如果当前比例不在新模型的支持列表中，重置为默认
    // #865 MiniMax t2v: adaptive 变灰不可选，切换到 MiniMax 时不能默认 adaptive
    const minimaxRatios = newConfig.aspectRatios;
    const isAdaptiveDisabled = ModelDetector.getFamily(newModel) === 'topais-minimax' && aspectRatio === 'adaptive';
    if (!minimaxRatios.includes(aspectRatio) || isAdaptiveDisabled) {
      const firstValid = minimaxRatios.find((r: string) => !(ModelDetector.getFamily(newModel) === 'topais-minimax' && r === 'adaptive'));
      setAspectRatio(firstValid || minimaxRatios[0]);
    }
    // #542 切换模型时重置时长和分辨率为该模型的默认值
    if (newConfig.durations && newConfig.durations.length > 0) {
      const defaultDuration = parseInt(newConfig.durations[0].value) || 8;
      setDuration(defaultDuration);
    }
    if (newConfig.resolutions && newConfig.resolutions.length > 0) {
      setResolution(newConfig.resolutions[0].value || newConfig.resolutions[0].label);
    }
    // #642 切换模型时用提纯引擎裁剪超限的参考图
    const _newFamily = ModelDetector.getFamily(newModel);
    const newIsModeSwitch = _newFamily === 'happyhorse' || _newFamily === 'seedance2' || _newFamily === 't8seedance' || _newFamily === 'topais';
    const effectiveMax = (() => {
      if (!newIsModeSwitch) return newConfig.maxRefImages;
      // 使用提纯引擎计算新模式下允许的最大参考图数
      const testSources = referenceImages.map((_, i) => ({ id: `test-${i}`, type: 'image' as const, url: '', index: i }));
      const { effective } = getEffectiveSources(hhCurrentMode, newModel, testSources);
      return effective.length;
    })();
    if (referenceImages.length > effectiveMax) {
      setReferenceImages(prev => prev.slice(0, effectiveMax));
      setReferenceImageUrls(prev => prev.slice(0, effectiveMax));
      if (effectiveMax === 0) {
        toast.info('新模型不支持参考图，已清除所有参考图');
      } else {
        toast.info(`新模型最多支持${effectiveMax}张参考图，已保留前${effectiveMax}张`);
      }
    }
    // 切换到不支持视频参考的模型时，清除已上传的视频
    if (!newIsModeSwitch && inputVideoUrl) {
      setInputVideoUrl(null);
      toast.info('新模型不支持视频参考，已清除视频');
    }
  };

  // ====== 提示词收藏功能 ======
  // 获取收藏列表
  const fetchFavorites = useCallback(async () => {
    try {
      // #353 使用 video-favorites API（视频页面专属收藏）
      const res = await fetch('/api/video-favorites', { credentials: 'include' });
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
      // #353 使用 video-favorites API
      const res = await fetch('/api/video-favorites', {
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
        // #889 鉴权漏洞修复：未登录时调起 LoginModal，不用 toast
        setAuthModalOpen(true);
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
      // #353 使用 video-favorites API
      const res = await fetch(`/api/video-favorites?id=${id}`, {
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
      // #353 使用 video-favorites API
      const res = await fetch('/api/video-favorites', {
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

  // 上传参考图到 OSS，返回 { base64, url }
  // 【A+B+C 综合优化】静态导入 + 合并读取
  const uploadOriginalImage = async (file: File): Promise<{ base64: string; url: string; key: string }> => {
    // 【方案C：静态导入已在顶部完成】

    // 1. 压缩图片
    // Seedance 官方文档支持单图最高 30MB，其他模型保持 3MB 限制
    const isSeedanceModel = ['seedance2', 't8seedance'].includes(ModelDetector.getFamily(model));
    const compressionOpts = isSeedanceModel
      ? { maxWidthOrHeight: 4096, maxSizeMB: 30, quality: 0.92, maxAttempts: 3 }
      : undefined; // 使用默认值 (2048px / 3MB / 0.8)
    const compressedResult = await compressImageForUpload(file, compressionOpts);
    const compressedFile = compressedResult.file;

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

    const uploadResponse = await fetch('/api/upload-reference', {
      method: 'POST',
      body: formData,
    });
    
    if (!uploadResponse.ok) {
      throw new Error(`上传失败: ${uploadResponse.status}`);
    }

    const uploadData = await safeJsonResponse<{ key?: string; url?: string }>(uploadResponse);

    if (uploadData.success && uploadData.url) {
      return { base64, url: uploadData.url, key: uploadData.key || '' };  // #840 返回 COS key
    } else {
      throw new Error(uploadData.error || '上传失败');
    }
  };

  const handleReferenceImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const inputElement = event.target;
    const files = inputElement.files;
    
    if (!files || files.length === 0) {
      // 清除 input 值，允许重复选择同一文件
      inputElement.value = '';
      return;
    }
    
    // 先保存文件列表，再清空 input
    const filesArray = Array.from(files);
    
    // 清除 input 值，允许重复选择同一文件
    inputElement.value = '';
    
    try {
      const newImages: string[] = [];
      const newUrls: string[] = [];
      const newKeys: string[] = [];  // #840 收集 COS keys
      // #656 使用 getModelMaxLimits 获取模型的物理上限（与模式无关）
      const maxLimits = getModelMaxLimits(model);
      const maxImages = maxLimits.image;
      
      const availableSlots = maxImages - referenceImages.length;
      const filesToProcess = filesArray.slice(0, availableSlots);

      if (filesToProcess.length === 0) {
        toast.error(`已达到参考图上限（${maxImages}张）`);
        return;
      }

      for (let i = 0; i < filesToProcess.length; i++) {
        // 设置当前上传的图片索引
        setUploadingIndex(referenceImages.length + i);
        
        const result = await uploadOriginalImage(filesToProcess[i] as File);
        newImages.push(result.base64);
        newUrls.push(result.url);
        if (result.key) newKeys.push(result.key);  // #840 收集 COS key
      }

      const updatedImages = [...referenceImages, ...newImages].slice(0, maxImages);
      const updatedUrls = [...referenceImageUrls, ...newUrls].slice(0, maxImages);
      const updatedKeys = [...referenceImageKeys, ...newKeys].slice(0, maxImages);  // #840
      
      setReferenceImages(updatedImages);
      setReferenceImageUrls(updatedUrls);
      setReferenceImageKeys(updatedKeys);  // #840
      setUploadingIndex(null);
      
      // #678 模式死锁解构：如果当前手动覆盖为 t2v（文生视频不允许有图，产生互斥），
      // 则立即解除覆盖，放权给自动推断切入 i2v！
      // r2v 允许有图，不互斥，保留用户的手动选择。
      if (hhOverrideMode === 't2v') {
        setHhOverrideMode(null);
      }
      
    } catch (error) {
      console.error('图片处理失败:', error);
      setUploadingIndex(null);
      toast.error('图片上传失败：' + (error instanceof Error ? error.message : '请重试'));
    }
  };

  const handleRemoveReferenceImage = (index: number) => {
    setReferenceImages(referenceImages.filter((_, i) => i !== index));
    setReferenceImageUrls(referenceImageUrls.filter((_, i) => i !== index));
    setReferenceImageKeys(referenceImageKeys.filter((_, i) => i !== index));  // #840
  };

  // 开始生成
  // ============================================
  // 【重构后的 handleStartGeneration - 使用统一生成引擎】
  // 2025年 - 接入 useGenService，删除 SSE/积分/轮询代码
  // #542 修复：创建 VideoTask 让进度可见 + 完成后更新任务
  // ============================================
  const handleStartGeneration = async () => {

    // 验证：登录
    // 【使用 AIGeneratorContext 的 isLoggedIn 和 credits】
    if (!isLoggedIn) {
      // #889 鉴权漏洞修复：未登录时调起 LoginModal，不用 toast
      setAuthModalOpen(true);
      window.dispatchEvent(new CustomEvent('openLogin'));
      return;
    }

    // 验证：积分
    if (credits < videoCreditCost) {
      toast.error('积分不足', { description: `当前: ${credits}，需要: ${videoCreditCost}` });
      return;
    }

    // 验证：输入
    const translatedPrompt = translatePromptWithCapsules(prompt.trim(), mediaCapsulesRef.current);
    if (!translatedPrompt) {
      toast.error('请输入提示词');
      return;
    }
    
    // 验证：Veo 模型 prompt 最小长度 5 个字符
    if (model.includes('veo') && translatedPrompt.length < 5) {
      toast.error('提示词太短', { description: 'Veo 模型要求提示词至少 5 个字符' });
      return;
    }

    // #667 验证：首尾帧模式必须同时上传首帧和尾帧（Seedance 2.0 + T8 sdols-2.0）
    if ((isSeedance2Model || isT8SeedanceModel) && hhCurrentMode === 'i2v-first-last-frame') {
      const hasFirstFrame = referenceImageUrls.length > 0 || referenceImages.length > 0;
      const hasLastFrame = referenceImageUrls.length > 1 || referenceImages.length > 1;
      if (!hasFirstFrame || !hasLastFrame) {
        toast.error('首尾帧模式必须同时上传首帧和尾帧图片');
        return;
      }
    }

    // #663 验证：HappyHorse video-edit 必须上传参考视频
    if (isHappyHorseModel && hhCurrentMode === 'video-edit' && !inputVideoUrl) {
      toast.error('视频编辑模式必须上传参考视频');
      return;
    }

    // #655 验证：音频必须搭配图片或视频（Seedance 2.0 + T8 sdols-2.0）
    // t2v 模式完全不支持音频（官方文档约束），任何模式下音频都不能孤立存在
    if ((isSeedance2Model || isT8SeedanceModel) && refAudioFiles.length > 0) {
      if (hhCurrentMode === 't2v') {
        // t2v 不允许音频，直接拦截
        toast.error('文生视频模式不支持参考音频');
        return;
      }
      const hasImage = (referenceImageUrls.length > 0 || referenceImages.length > 0);
      const hasVideo = refVideoUrls.length > 0;
      if (!hasImage && !hasVideo) {
        toast.error('参考音频必须搭配至少一张参考图或参考视频');
        return;
      }
    }

    // #663 验证：HappyHorse 音频孤岛拦截
    if (isHappyHorseModel && refAudioFiles.length > 0) {
      const hasImage = (referenceImageUrls.length > 0 || referenceImages.length > 0);
      const hasVideo = !!inputVideoUrl;
      if (!hasImage && !hasVideo) {
        toast.error('参考音频必须搭配至少一张参考图或参考视频');
        return;
      }
    }

    // #655 汇总结算防线：视频/音频总时长校验
    const family = ModelDetector.getFamily(model);
    const mediaLimits = getProviderMediaLimits(family);
    if (mediaLimits) {
      // 视频总时长结算（Seedance 参考视频多段）
      if (refVideoUrls.length > 0 && mediaLimits.video) {
        try {
          const videoDurations = await Promise.all(
            refVideoUrls.map(async (url) => {
              return new Promise<number>((resolve) => {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.onloadedmetadata = () => {
                  URL.revokeObjectURL(video.src);
                  resolve(video.duration);
                };
                video.onerror = () => {
                  URL.revokeObjectURL(video.src);
                  resolve(0); // 无法读取则按0秒算
                };
                video.src = url;
              });
            })
          );
          const totalVideoDuration = videoDurations.reduce((sum, d) => sum + d, 0);
          if (totalVideoDuration > mediaLimits.video.maxTotalDuration) {
            toast.error(`参考视频总时长${totalVideoDuration.toFixed(1)}秒，超过${mediaLimits.video.maxTotalDuration}秒限制`);
            return;
          }
        } catch {
          console.warn('[Video] 无法结算视频总时长，跳过校验');
        }
      }
      // 音频总时长结算
      if (refAudioFiles.length > 0 && mediaLimits.audio) {
        try {
          // 音频文件已上传到 COS，需从 URL 读取时长
          const audioDurations = await Promise.all(
            refAudioFiles.map(async (audio) => {
              return new Promise<number>((resolve) => {
                const audioEl = document.createElement('audio');
                audioEl.preload = 'metadata';
                audioEl.onloadedmetadata = () => {
                  URL.revokeObjectURL(audioEl.src);
                  resolve(audioEl.duration);
                };
                audioEl.onerror = () => {
                  URL.revokeObjectURL(audioEl.src);
                  resolve(0);
                };
                audioEl.src = audio.url;
              });
            })
          );
          const totalAudioDuration = audioDurations.reduce((sum, d) => sum + d, 0);
          if (totalAudioDuration > mediaLimits.audio.maxTotalDuration) {
            toast.error(`参考音频总时长${totalAudioDuration.toFixed(1)}秒，超过${mediaLimits.audio.maxTotalDuration}秒限制`);
            return;
          }
        } catch {
          console.warn('[Video] 无法结算音频总时长，跳过校验');
        }
      }
    }

    // 设置生成状态
    setIsGenerating(true);
    setVideoProgress(0);
    setGeneratedVideo(null);
    setVideoError(null);
    setVideoUrl('');
    setVideoKey('');
    // #数据分流 真假进度严格分离
    // 有后端真进度的模型：绝不启动假进度引擎，只用后端 SSE progress 事件驱动
    //   （防止假进度跑到 95% 真进度才 30% 导致回跳）
    // 无后端真进度的模型（仅 lingya-sora）：启动假进度引擎（VIDEO_CURVE 慢速曲线）
    const modelHasRealProgress = ModelDetector.hasBackendRealProgress(model);
    hasRealVideoProgressRef.current = modelHasRealProgress;
    if (!modelHasRealProgress) {
      fakeVideoProgress.reset();
      fakeVideoProgress.start();
    } else {
      fakeVideoProgress.stop();
    }

    // #542 修复：创建 VideoTask，让进度可见
    const taskId = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newTask: VideoTask = {
      id: taskId,
      status: 'generating',
      videos: [],
      progress: 0,
      createdAt: new Date(),
      params: {
        model,
        prompt: translatedPrompt,
        aspectRatio,
        duration: currentModelConfig.showDuration ? duration : undefined,
        size: (currentModelConfig.showResolution || currentModelConfig.supportsUpsample) ? resolution : undefined,
        referenceImages: referenceImageUrls.length > 0 ? referenceImageUrls : referenceImages,
      },
    };
    setTasks(prev => [newTask, ...prev]);
    setSelectedTaskId(taskId);

    // 保存提示词历史
    savePromptToLocal(prompt.trim());

    // 调用统一生成引擎（视频模式）
    // 【保命三剑客已由 useGenService 承接：300秒轮询 + SSE流式 + 积分双重保险】
    // #641 Sora-2 VIP 2合1：统一入口 sora-2-all-vip，不再拼接模型名，后端根据 duration 判断积分
    // 数据库只有 sora-2-all-vip，拼接 -10s/-15s 会导致 DB 查找失败

    await handleGenerate({
      mode: 'video',
      prompt: translatedPrompt,
      model: model,
      resolution: resolution,
      aspectRatio: aspectRatio,
      generationCount: 1,
      // #642 视频模型参考图提纯（使用提纯引擎替代硬编码 slice 逻辑）
      images: (() => {
        const rawImages = referenceImageUrls.length > 0 ? referenceImageUrls : referenceImages;
        if (!isModeSwitchModel) return rawImages.slice(0, currentModelConfig.maxRefImages);
        const sources = rawImages.map((url: string, i: number) => ({
          id: `video-ref-${i}`,
          type: 'image' as const,
          url,
          index: i,
        }));
        const { effective } = getEffectiveSources(hhCurrentMode, model, sources);
        return effective.map(s => s.url);
      })(),
      isUrls: referenceImageUrls.length > 0,
      md5Hashes: [],
      referenceImageKeys: referenceImageKeys.filter((k: string) => k && k.length > 0),  // #840 传参考图 keys
      enhancePrompt: false,
      enableUpsample: currentModelConfig.supportsUpsample && resolution === '1080p' && referenceImages.length === 0,
      // #538 T8 Sora-2 视频参数
      duration: duration,
      size: resolution,

      // HappyHorse 视频参数
      ...(isHappyHorseModel ? {
        firstFrameUrl: hhCurrentMode === 'i2v' ? (referenceImageUrls.length > 0 ? referenceImageUrls[0] : (referenceImages.length > 0 ? referenceImages[0] : undefined)) : undefined,
        referenceImageUrls: hhCurrentMode === 'r2v' ? referenceImageUrls : (hhCurrentMode === 'video-edit' ? referenceImageUrls : undefined),
        inputVideoUrl: hhCurrentMode === 'video-edit' ? (inputVideoUrl || undefined) : undefined,
        hhMode: hhCurrentMode,
        audioSetting: hhCurrentMode === 'video-edit' ? audioSetting : undefined,
      } : {}),

      // Seedance 2.0 视频参数
      ...(isSeedance2Model ? {
        firstFrameUrl: (hhCurrentMode === 'i2v' || hhCurrentMode === 'i2v-first-frame') ? (referenceImageUrls.length > 0 ? referenceImageUrls[0] : (referenceImages.length > 0 ? referenceImages[0] : undefined)) : undefined,
        lastFrameUrl: hhCurrentMode === 'i2v-first-last-frame' ? (referenceImageUrls.length > 1 ? referenceImageUrls[1] : (referenceImages.length > 1 ? referenceImages[1] : undefined)) : undefined,
        referenceImageUrls: hhCurrentMode === 'r2v' ? referenceImageUrls : undefined,
        referenceVideoUrls: refVideoUrls.length > 0 ? refVideoUrls : undefined,
        referenceAudioUrls: refAudioFiles.length > 0 ? refAudioFiles.map(a => a.url) : undefined,
        sd2Mode: hhCurrentMode as Seedance2Mode,
        hhMode: hhCurrentMode,
        audioSetting: audioSetting,
        generateAudio: generateAudio,
      } : {}),

      // #667 T8 Seedance (sdols-2.0) 视频参数 - 全模态解锁，与 LingYa Seedance 2.0 对齐
      ...(isT8SeedanceModel ? {
        firstFrameUrl: (hhCurrentMode === 'i2v' || hhCurrentMode === 'i2v-first-frame' || hhCurrentMode === 'i2v-first-last-frame') ? (referenceImageUrls.length > 0 ? referenceImageUrls[0] : (referenceImages.length > 0 ? referenceImages[0] : undefined)) : undefined,
        lastFrameUrl: hhCurrentMode === 'i2v-first-last-frame' ? (referenceImageUrls.length > 1 ? referenceImageUrls[1] : (referenceImages.length > 1 ? referenceImages[1] : undefined)) : undefined,
        referenceImageUrls: hhCurrentMode === 'r2v' ? referenceImageUrls : undefined,
        referenceVideoUrls: refVideoUrls.length > 0 ? refVideoUrls : undefined,
        referenceAudioUrls: refAudioFiles.length > 0 ? refAudioFiles.map(a => a.url) : undefined,
        sd2Mode: hhCurrentMode as Seedance2Mode,
        hhMode: hhCurrentMode,
        audioSetting: audioSetting,
        generateAudio: generateAudio,
      } : {}),

      // #689 TOPAIS Veo3.1-fast 视频参数
      ...(isTopaisModel ? {
        hhMode: hhCurrentMode,  // 前端模式标识，后端用于判断 generation_type
      } : {}),
      
      // #691 TOPAIS HappyHorse 1.1 视频参数
      ...(isTopaisHhModel ? {
        firstFrameUrl: hhCurrentMode === 'i2v' ? (referenceImageUrls.length > 0 ? referenceImageUrls[0] : (referenceImages.length > 0 ? referenceImages[0] : undefined)) : undefined,
        referenceImageUrls: hhCurrentMode === 'r2v' ? referenceImageUrls : undefined,
        inputVideoUrl: hhCurrentMode === 'video-edit' ? (inputVideoUrl || undefined) : undefined,
        hhMode: hhCurrentMode,
        audioSetting: hhCurrentMode === 'video-edit' ? audioSetting : undefined,
      } : {}),

      // TOPAIS Seedance 2.0 视频参数 - 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式
      ...(isTopaisSeedanceModel ? {
        firstFrameUrl: (hhCurrentMode === 'i2v' || hhCurrentMode === 'i2v-first-frame' || hhCurrentMode === 'i2v-first-last-frame') ? (referenceImageUrls.length > 0 ? referenceImageUrls[0] : (referenceImages.length > 0 ? referenceImages[0] : undefined)) : undefined,
        lastFrameUrl: hhCurrentMode === 'i2v-first-last-frame' ? (referenceImageUrls.length > 1 ? referenceImageUrls[1] : (referenceImages.length > 1 ? referenceImages[1] : undefined)) : undefined,
        referenceImageUrls: hhCurrentMode === 'r2v' ? referenceImageUrls : undefined,
        referenceVideoUrls: refVideoUrls.length > 0 ? refVideoUrls : undefined,
        referenceAudioUrls: refAudioFiles.length > 0 ? refAudioFiles.map(a => a.url) : undefined,
        sd2Mode: hhCurrentMode as Seedance2Mode,
        hhMode: hhCurrentMode,
        audioSetting: audioSetting,
        generateAudio: generateAudio,
      } : {}),

      // TOPAIS Gemini Omni Flash 视频参数 - 支持 t2v/i2v/r2v 三种模式（无 video-edit）
      ...(isTopaisGeminiOmniModel ? {
        firstFrameUrl: hhCurrentMode === 'i2v' ? (referenceImageUrls.length > 0 ? referenceImageUrls[0] : (referenceImages.length > 0 ? referenceImages[0] : undefined)) : undefined,
        referenceImageUrls: hhCurrentMode === 'r2v' ? referenceImageUrls : undefined,
        hhMode: hhCurrentMode,
      } : {}),

      // MEGA AI Seedance 2.0 视频参数 - 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式，固定720p
      ...(isMegaAiSeedanceModel ? {
        firstFrameUrl: (hhCurrentMode === 'i2v' || hhCurrentMode === 'i2v-first-frame' || hhCurrentMode === 'i2v-first-last-frame') ? (referenceImageUrls.length > 0 ? referenceImageUrls[0] : (referenceImages.length > 0 ? referenceImages[0] : undefined)) : undefined,
        lastFrameUrl: hhCurrentMode === 'i2v-first-last-frame' ? (referenceImageUrls.length > 1 ? referenceImageUrls[1] : (referenceImages.length > 1 ? referenceImages[1] : undefined)) : undefined,
        referenceImageUrls: hhCurrentMode === 'r2v' ? referenceImageUrls : undefined,
        referenceVideoUrls: refVideoUrls.length > 0 ? refVideoUrls : undefined,
        referenceAudioUrls: refAudioFiles.length > 0 ? refAudioFiles.map(a => a.url) : undefined,
        sd2Mode: hhCurrentMode as Seedance2Mode,
        hhMode: hhCurrentMode,
        audioSetting: audioSetting,
        generateAudio: generateAudio,
      } : {}),

      // TOPAIS MiniMax-H3 视频参数 - 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式，固定2K，支持参考视频和音频
      ...(isTopaisMinimaxModel ? {
        firstFrameUrl: (hhCurrentMode === 'i2v' || hhCurrentMode === 'i2v-first-frame' || hhCurrentMode === 'i2v-first-last-frame') ? (referenceImageUrls.length > 0 ? referenceImageUrls[0] : (referenceImages.length > 0 ? referenceImages[0] : undefined)) : undefined,
        lastFrameUrl: hhCurrentMode === 'i2v-first-last-frame' ? (referenceImageUrls.length > 1 ? referenceImageUrls[1] : (referenceImages.length > 1 ? referenceImages[1] : undefined)) : undefined,
        referenceImageUrls: hhCurrentMode === 'r2v' ? referenceImageUrls : undefined,
        referenceVideoUrls: refVideoUrls.length > 0 ? refVideoUrls : undefined,
        referenceAudioUrls: refAudioFiles.length > 0 ? refAudioFiles.map(a => a.url) : undefined,
        hhMode: hhCurrentMode,
        audioSetting: audioSetting,
        generateAudio: generateAudio,
      } : {}),

      // TOPAIS Kling v3 Omni 视频参数 - 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式
      ...(isTopaisKlingOmniModel ? {
        firstFrameUrl: (hhCurrentMode === 'i2v' || hhCurrentMode === 'i2v-first-frame' || hhCurrentMode === 'i2v-first-last-frame') ? (referenceImageUrls.length > 0 ? referenceImageUrls[0] : (referenceImages.length > 0 ? referenceImages[0] : undefined)) : undefined,
        lastFrameUrl: hhCurrentMode === 'i2v-first-last-frame' ? (referenceImageUrls.length > 1 ? referenceImageUrls[1] : (referenceImages.length > 1 ? referenceImages[1] : undefined)) : undefined,
        referenceImageUrls: hhCurrentMode === 'r2v' ? referenceImageUrls : undefined,
        referenceVideoUrls: refVideoUrls.length > 0 ? refVideoUrls : undefined,
        hhMode: hhCurrentMode,
        audioSetting: audioSetting,
        generateAudio: generateAudio,
      } : {}),

      // #301 LingYa Veo3.1 视频参数（必须传递 hhMode，确保模式确定性映射）
      ...(isLingyaVeoModel ? {
        hhMode: hhCurrentMode,
      } : {}),

      // #301 LingYa Sora-2 VIP 视频参数（必须传递 hhMode，确保模式确定性映射）
      ...(isLingyaSoraModel ? {
        hhMode: hhCurrentMode,
      } : {}),

      // #542 视频进度回调：更新 VideoTask 进度
      onVideoProgress: (progress) => {
        // #655 真假进度智能分流
        // #690 关键修复：progress=0 不是"真实进度"，是服务商没返回进度字段！
        const realProgress = (typeof progress.progress === 'number' && progress.progress > 0) 
          ? progress.progress : undefined;
        if (realProgress !== undefined && !hasRealVideoProgressRef.current) {
          hasRealVideoProgressRef.current = true;
          // #710 关键修复：同步假进度引擎内部值，防止竞态覆盖
          fakeVideoProgress.setProgress(realProgress);
          fakeVideoProgress.stop();
        }
        const progressValue = realProgress !== undefined ? realProgress : videoProgress;
        setVideoProgress(progressValue);
        setTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, progress: progressValue } : t
        ));
      },

      // #542 完成回调：更新 VideoTask 状态
      onComplete: (result) => {
        setIsGenerating(false);
        fakeVideoProgress.stop();
        hasRealVideoProgressRef.current = false;
        
        if (result.videos && result.videos.length > 0) {
          setVideoUrl(result.videos[0]);
          setVideoKey(result.videoKeys?.[0] || '');
          setGeneratedVideo({
            url: result.videos[0],
            key: result.videoKeys?.[0] || '',
            thumbnailUrl: result.thumbnails?.[0] || '',
          });
          // #542 更新任务为完成状态
          // #624 持久化：保存 videoKeys，刷新后可用 Key 恢复签名 URL
          setTasks(prev => prev.map(t =>
            t.id === taskId ? { ...t, status: 'completed' as const, videos: result.videos || [], videoKeys: result.videoKeys || [], progress: 100 } : t
          ));
          toast.success('视频生成成功！');
        } else {
          // #542 更新任务为失败状态
          setTasks(prev => prev.map(t =>
            t.id === taskId ? { ...t, status: 'failed' as const, error: '生成失败' } : t
          ));
          toast.error('视频生成失败');
          setVideoError('生成失败');
        }
        
        // 更新积分显示
        // 【使用 Context 的 setCredits】
        if (result.creditsBalance !== undefined) {
          ctxSetCredits(result.creditsBalance);
        }
      },

      // Fire-and-Forget：后端轮询超时，任务仍在服务商排队
      onStillProcessing: (data) => {
        setIsGenerating(false);
        fakeVideoProgress.stop();
        hasRealVideoProgressRef.current = false;
        // 任务转入后台异步处理，不标记为失败
        setTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, status: 'processing' as const, error: undefined } : t
        ));
        toast.info('视频仍在生成中', {
          description: '任务已转入后台处理，请稍后在任务列表或历史记录中查看结果',
          duration: 8000,
        });
      },

      // #542 错误回调：更新 VideoTask 为失败状态
      onError: (error) => {
        setIsGenerating(false);
        fakeVideoProgress.stop();
        hasRealVideoProgressRef.current = false;
        // #723 翻译英文错误消息为中文
        const translatedError = translateErrorMessage(error.message || '');
        toast.error('生成失败', { description: translatedError });
        setVideoError(translatedError);
        // #542 更新任务为失败状态
        setTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, status: 'failed' as const, error: translatedError } : t
        ));
        if (translatedError.includes('网络')) {
          toast.warning('网络连接中断，视频可能仍在生成中');
        }
      },
    });

    setPrompt('');
  };


  // 下载视频 — #862 功能隔离：禁止使用 providerUrl，强制使用 COS 链接
  const handleDownload = async (videoUrl: string, videoKey?: string) => {
    try {
      // 强制使用 COS 代理 URL，避免跨域 Tainted Canvas
      const cosUrl = videoKey
        ? `/api/canvas/image?key=${encodeURIComponent(videoKey)}`
        : videoUrl;
      const response = await fetch(cosUrl);
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
      <div className="flex pl-16 px-3 pb-3 gap-3" style={{ height: '100vh', paddingTop: '30px' }}>
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
                <img src={getModelLogoForVideoPage(model)} alt="" className={`w-[18px] h-[18px] rounded-[3px] flex-shrink-0 ${isDarkLogoForVideoPage(model) ? 'dark:brightness-0 dark:invert' : ''}`} referrerPolicy="no-referrer-when-downgrade" />
                <span className="text-gray-900 dark:text-white font-mono">{currentModelConfig.name}</span>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          {/* 参考图 / 编辑视频 */}
          <div className="mb-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold text-gray-900 dark:text-white">
                {isModeSwitchModel ? '参考素材' : '参考图'}{(() => {
                  // #645 按类型显示素材计数和限制
                  if (!isModeSwitchModel) return <span className="text-xs text-gray-500 dark:text-gray-400">({referenceImages.length}{uploadingIndex !== null ? '+1' : ''}/{currentModelConfig.maxRefImages})</span>;
                  
                  // #678 幽灵状态斩断：非模式模型（Sora/Veo）不受 hhCurrentMode 污染
                  const limits = isModeSwitchModel
                    ? getMaterialTypeLimits(hhCurrentMode, model)
                    : getModelMaxLimits(model);
                  const imgCount = referenceImages.length;
                  const vidCount = (inputVideoUrl ? 1 : 0) + refVideoUrls.length;
                  const audCount = refAudioFiles.length;
                  
                  const parts: string[] = [];
                  const limitParts: string[] = [];
                  
                  if (limits.image > 0) {
                    parts.push(`${imgCount}图`);
                    limitParts.push(`${limits.image}图`);
                  }
                  if (limits.video > 0) {
                    parts.push(`${vidCount}视`);
                    limitParts.push(`${limits.video}视`);
                  }
                  if (limits.audio > 0) {
                    parts.push(`${audCount}音`);
                    limitParts.push(`${limits.audio}音`);
                  }
                  
                  // #676 文生视频模式时彻底隐藏括号文案，只保留"参考素材"四字
                  if (parts.length === 0) return null;
                  return <span className="text-xs text-gray-500 dark:text-gray-400">({parts.join(' ')} | 最多{limitParts.join('/')})</span>;
                })()}
              </Label>
              <div className="flex items-center gap-2">
                {referenceImages.length > 0 && (
                  <Button variant="ghost" size="sm" className="text-xs text-gray-500 dark:text-gray-400" onClick={() => setReferenceImages([])}>
                    清空图片
                  </Button>
                )}
                {isModeSwitchModel && inputVideoUrl && (
                  <Button variant="ghost" size="sm" className="text-xs text-gray-500 dark:text-gray-400" onClick={() => setInputVideoUrl(null)}>
                    清空视频
                  </Button>
                )}
              </div>
            </div>

            {/* #676 统一素材网格 - 1行4个，图片/视频/音频统一展示 + 3个独立上传按钮 */}
            <div className="grid grid-cols-4 gap-2">
              {/* 1. 已上传的图片 */}
              {referenceImages.map((img, idx) => {
                // #678 幽灵状态斩断：非模式模型（Sora/Veo）不受 hhCurrentMode 污染
                const limits = isModeSwitchModel
                  ? getMaterialTypeLimits(hhCurrentMode, model)
                  : getModelMaxLimits(model);
                const isOverLimit = limits.image > 0 ? idx >= limits.image : true;
                return (
                <div key={`img-${idx}`} className="relative w-full aspect-square cursor-pointer group" onClick={() => setPreviewImage(img)} style={{ opacity: isOverLimit ? 0.35 : 1 }}>
                  {/* 图片序号角标：HappyHorse i2v 显示"首帧" */}
                  <span className="absolute top-0.5 left-0.5 px-1 py-0.5 text-[8px] font-bold rounded-br bg-blue-500/80 text-white z-10 select-none">
                    {isSeedance2Model && (hhCurrentMode === 'i2v' || hhCurrentMode === 'i2v-first-frame')
                      ? '首帧'
                      : isSeedance2Model && hhCurrentMode === 'i2v-first-last-frame'
                        ? (idx === 0 ? '首帧' : '尾帧')
                      : isHappyHorseModel && hhCurrentMode === 'i2v'
                      ? '首帧'
                      : (isHappyHorseModel || isSeedance2Model) && hhCurrentMode === 'r2v'
                        ? `${idx + 1}`
                        : `${idx + 1}`}
                  </span>
                  <img src={img} alt={`参考图${idx + 1}`} className="w-full h-full object-cover rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800" referrerPolicy="no-referrer-when-downgrade" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                    <ZoomIn className="w-4 h-4 text-white" />
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleRemoveReferenceImage(idx); }} className="absolute -top-1 -right-1 w-4 h-4 bg-gray-900 dark:bg-gray-600 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="w-3 h-3" />
                  </button>
                  {/* #676 超出模式限制的参考图灰色覆盖层 + 右下角"禁用"提示 + title悬浮 */}
                  {isOverLimit && (
                    <div className="absolute inset-0 bg-black/45 rounded-lg z-2 flex items-end justify-end p-1 cursor-not-allowed" title="当前模式不支持素材">
                      <span className="text-[8px] text-white/90 bg-black/50 px-1 rounded leading-tight">禁用</span>
                    </div>
                  )}
                </div>
                );
              })}

              {/* 2. 已上传的主视频（HappyHorse inputVideoUrl） - 只要模型支持视频就显示 */}
              {getModelSupportedTypes(model).video && inputVideoUrl && (() => {
                // #678 幽灵状态斩断：非模式模型（Sora/Veo）不受 hhCurrentMode 污染
                const limits = isModeSwitchModel
                  ? getMaterialTypeLimits(hhCurrentMode, model)
                  : getModelMaxLimits(model);
                const isDisabled = limits.video === 0;
                return (
                <div className="relative w-full aspect-square cursor-pointer group" style={{ opacity: isDisabled ? 0.35 : 1 }} onClick={() => setPreviewVideoUrl(inputVideoUrl)}>
                  <span className="absolute top-0.5 left-0.5 px-1 py-0.5 text-[8px] font-bold rounded-br bg-emerald-500/80 text-white z-10 select-none">V</span>
                  <video src={inputVideoUrl} className="w-full h-full object-cover rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800" />
                  {/* 播放按钮覆盖 */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-6 h-6 rounded-full bg-black/50 flex items-center justify-center">
                      <svg width="8" height="10" viewBox="0 0 8 10" fill="white"><polygon points="0,0 8,5 0,10" /></svg>
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setInputVideoUrl(null); }} className="absolute -top-1 -right-1 w-4 h-4 bg-gray-900 dark:bg-gray-600 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <X className="w-3 h-3" />
                  </button>
                  {/* #676 非视频可用模式下视频不可用覆盖层 + 右下角"禁用"提示 + title悬浮 */}
                  {isDisabled && (
                    <div className="absolute inset-0 bg-black/45 rounded-lg z-2 flex items-end justify-end p-1 cursor-not-allowed" title="当前模式不支持素材">
                      <span className="text-[8px] text-white/90 bg-black/50 px-1 rounded leading-tight">禁用</span>
                    </div>
                  )}
                </div>
                );
              })()}
              
              {/* 图片上传中状态 */}
              {uploadingIndex !== null && (
                <div className="w-full aspect-square rounded-lg border-2 border-dashed border-gray-400 bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
                </div>
              )}
              
              {/* 视频上传中状态 */}
              {isVideoUploading && (
                <div className="w-full aspect-square rounded-lg border-2 border-dashed border-blue-400 bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                </div>
              )}
              
              {/* 3. 已上传的参考视频（Seedance refVideoUrls） - 只要模型支持视频就显示 */}
              {getModelSupportedTypes(model).video && refVideoUrls.map((url, idx) => {
                // #678 幽灵状态斩断：非模式模型（Sora/Veo）不受 hhCurrentMode 污染
                const limits = isModeSwitchModel
                  ? getMaterialTypeLimits(hhCurrentMode, model)
                  : getModelMaxLimits(model);
                const isDisabled = limits.video === 0;
                return (
                <div key={`refvideo-${idx}`} className="relative w-full aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800" style={{ opacity: isDisabled ? 0.35 : 1 }}>
                  <span className="absolute top-0.5 left-0.5 px-1 py-0.5 text-[8px] font-bold rounded-br bg-emerald-500/80 text-white z-10 select-none">V{idx + 1}</span>
                  <video src={url} className="w-full h-full object-cover rounded-lg border border-gray-200 dark:border-gray-700" muted />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-5 h-5 rounded-full bg-black/50 flex items-center justify-center">
                      <svg width="6" height="8" viewBox="0 0 8 10" fill="white"><polygon points="0,0 8,5 0,10" /></svg>
                    </div>
                  </div>
                  <button onClick={() => removeRefVideo(idx)} className="absolute -top-1 -right-1 w-4 h-4 bg-gray-900 dark:bg-gray-600 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <X className="w-3 h-3" />
                  </button>
                  {isDisabled && (
                    <div className="absolute inset-0 bg-black/45 rounded-lg z-2 flex items-end justify-end p-1 cursor-not-allowed" title="当前模式不支持素材">
                      <span className="text-[8px] text-white/90 bg-black/50 px-1 rounded leading-tight">禁用</span>
                    </div>
                  )}
                </div>
                );
              })}

              {/* 4. 已上传的参考音频（Seedance refAudioFiles） - 只要模型支持音频就显示 */}
              {getModelSupportedTypes(model).audio && refAudioFiles.map((audio, idx) => {
                // #678 幽灵状态斩断：非模式模型（Sora/Veo）不受 hhCurrentMode 污染
                const limits = isModeSwitchModel
                  ? getMaterialTypeLimits(hhCurrentMode, model)
                  : getModelMaxLimits(model);
                const isDisabled = limits.audio === 0;
                return (
                <div key={`audio-${idx}`} className="relative w-full aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 flex flex-col items-center justify-center border border-gray-200 dark:border-gray-700" style={{ opacity: isDisabled ? 0.35 : 1 }}>
                  <span className="absolute top-0.5 left-0.5 px-1 py-0.5 text-[8px] font-bold rounded-br bg-purple-500/80 text-white z-10 select-none">A{idx + 1}</span>
                  <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                  <span className="text-[8px] text-gray-500 dark:text-gray-400 truncate max-w-[90%] px-1">{audio.name}</span>
                  <button onClick={() => setRefAudioFiles(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-1 -right-1 w-4 h-4 bg-gray-900 dark:bg-gray-600 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <X className="w-3 h-3" />
                  </button>
                  {isDisabled && (
                    <div className="absolute inset-0 bg-black/45 rounded-lg z-2 flex items-end justify-end p-1 cursor-not-allowed" title="当前模式不支持素材">
                      <span className="text-[8px] text-white/90 bg-black/50 px-1 rounded leading-tight">禁用</span>
                    </div>
                  )}
                </div>
                );
              })}

              {/* #678 已删除重复的 Loading 状态渲染（原 5.图片上传中 + 6.视频上传中，与前面重复） */}

              {/* 7. 图片上传按钮 - 只要模型支持图片就显示 */}
              {getModelSupportedTypes(model).image && (() => {
                const maxLimits = getModelMaxLimits(model);
                const canUpload = referenceImages.length < maxLimits.image;
                if (canUpload) {
                  return (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full aspect-square rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                      title="上传参考图"
                    >
                      <svg width="16" height="16" className="text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="2"/>
                        <polyline points="21 15 16 10 5 21" strokeWidth="2"/>
                      </svg>
                    </button>
                  );
                }
                return (
                  <button
                    onClick={() => toast.error(`该模型最多上传 ${maxLimits.image} 张参考图`)}
                    className="w-full aspect-square rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center opacity-50 cursor-not-allowed"
                    title={`已达上限（${maxLimits.image}张）`}
                  >
                    <svg width="16" height="16" className="text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="2"/>
                      <polyline points="21 15 16 10 5 21" strokeWidth="2"/>
                    </svg>
                  </button>
                );
              })()}

              {/* 8. 视频上传按钮 - 只要模型支持视频就显示 */}
              {getModelSupportedTypes(model).video && (() => {
                const maxLimits = getModelMaxLimits(model);
                const currentVideoCount = (inputVideoUrl ? 1 : 0) + refVideoUrls.length;
                const canUpload = currentVideoCount < maxLimits.video;
                if (canUpload) {
                  return (
                    <button
                      onClick={() => refVideoInputRef.current?.click()}
                      className="w-full aspect-square rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                      title="上传参考视频"
                    >
                      <VideoIcon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                    </button>
                  );
                }
                return (
                  <button
                    onClick={() => toast.error(`该模型最多上传 ${maxLimits.video} 段视频`)}
                    className="w-full aspect-square rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center opacity-50 cursor-not-allowed"
                    title={`已达上限（${maxLimits.video}段）`}
                  >
                    <VideoIcon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                  </button>
                );
              })()}

              {/* 9. 音频上传按钮 - 只要模型支持音频就显示 */}
              {getModelSupportedTypes(model).audio && (() => {
                const maxLimits = getModelMaxLimits(model);
                const canUpload = refAudioFiles.length < maxLimits.audio;
                if (canUpload) {
                  return (
                    <button
                      onClick={() => refAudioInputRef.current?.click()}
                      className="w-full aspect-square rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                      title="上传参考音频"
                    >
                      <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    </button>
                  );
                }
                return (
                  <button
                    onClick={() => toast.error(`该模型最多上传 ${maxLimits.audio} 段音频`)}
                    className="w-full aspect-square rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center opacity-50 cursor-not-allowed"
                    title={`已达上限（${maxLimits.audio}段）`}
                  >
                    <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                  </button>
                );
              })()}
            </div>

            {/* 隐藏的文件输入 - 统一放在主区域外，保证 ref 引用不断 */}
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleReferenceImageUpload} className="hidden" />
            <input
              type="file"
              accept="video/mp4,video/quicktime,.mp4,.mov"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const family = ModelDetector.getFamily(model);
                const mediaLimits = getProviderMediaLimits(family);
                const videoLimit = mediaLimits?.video;
                if (videoLimit) {
                  if (!isFormatAllowed(file.type, videoLimit.formats)) {
                    toast.error(`视频格式不支持，仅支持 ${videoLimit.formats.join('/')}`);
                    e.target.value = '';
                    return;
                  }
                  if (file.size > videoLimit.maxSizeMB * 1024 * 1024) {
                    toast.error(`视频超过${videoLimit.maxSizeMB}MB限制`);
                    e.target.value = '';
                    return;
                  }
                }
                // HappyHorse 走 inputVideoUrl，Seedance 走 refVideoUrls
                if (isHappyHorseModel) {
                  handleVideoUpload(e);
                } else {
                  handleRefVideoUpload(file);
                }
                e.target.value = '';
              }}
              className="hidden"
              ref={refVideoInputRef}
            />
            <input
              type="file"
              accept="audio/wav,audio/mp3,audio/mpeg,.wav,.mp3"
              multiple={false}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const maxLimits = getModelMaxLimits(model);
                if (refAudioFiles.length >= maxLimits.audio) {
                  toast.error(`参考音频最多上传${maxLimits.audio}段`);
                  e.target.value = '';
                  return;
                }
                const family = ModelDetector.getFamily(model);
                const mediaLimits = getProviderMediaLimits(family);
                const audioLimit = mediaLimits?.audio;
                if (audioLimit && !isFormatAllowed(file.type, audioLimit.formats)) {
                  toast.error(`音频 ${file.name} 格式不支持，仅支持 ${audioLimit.formats.join('/')}`);
                  e.target.value = '';
                  return;
                }
                const maxSizeMB = audioLimit?.maxSizeMB ?? 15;
                if (file.size > maxSizeMB * 1024 * 1024) {
                  toast.error(`音频 ${file.name} 超过${maxSizeMB}MB限制`);
                  e.target.value = '';
                  return;
                }
                if (audioLimit) {
                  try {
                    const duration = await getAudioDuration(file);
                    if (duration > audioLimit.maxTotalDuration) {
                      toast.error(`音频 ${file.name} 时长${duration.toFixed(1)}秒，超过${audioLimit.maxTotalDuration}秒限制`);
                      e.target.value = '';
                      return;
                    }
                  } catch {
                    console.warn('[Video] 无法读取音频时长，跳过前端时长校验');
                  }
                }
                // 服务端中转上传 COS
                try {
                  const formData = new FormData();
                  formData.append('file', file);
                  const uploadResponse = await fetch('/api/canvas/upload', { method: 'POST', body: formData });
                  const uploadData = await safeJsonResponse<{ key?: string; url?: string }>(uploadResponse);
                  if (uploadData.success) {
                    const signedUrl = `/api/canvas/image?key=${encodeURIComponent(uploadData.key ?? '')}`;
                    setRefAudioFiles(prev => [...prev, { url: signedUrl, name: file.name, size: file.size }]);
                    toast.success('音频上传成功');
                  } else {
                    toast.error(`音频 ${file.name} 上传失败`);
                  }
                } catch {
                  toast.error('音频上传失败');
                }
                e.target.value = '';
              }}
              className="hidden"
              ref={refAudioInputRef}
            />
          </div>

          {/* 提示词容器 - 流式布局，不再fixed定位避免遮盖上传图片 */}
          <div className="mb-4 flex-shrink-0">
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
            <RichPromptEditor
              value={prompt}
              onChange={setPrompt}
              placeholder={`请输入画面描述`}
              textareaClassName="h-[170px]"
              maxLength={1800}
              images={[]}
              hideMentionHint={true}
              onGetFullPrompt={(_rawText, capsules) => {
                mediaCapsulesRef.current = capsules;
                return _rawText;
              }}
            />
          </div>

          {/* 参数设置 - 按钮形式 */}
          <div className="mt-auto">
            <Label className="mb-2 block text-sm font-semibold text-gray-900 dark:text-white">参数设置</Label>
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              {/* #635 比例按钮：非 HappyHorse 正常显示；HappyHorse 仅 t2v/r2v 模式显示 */}
              {(!isHappyHorseModel || hhParams?.showRatio) && (
              <button 
                ref={ratioButtonRef}
                className="flex items-center gap-0.5 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 transition-colors"
                onClick={() => {
                  if (ratioButtonRef.current) {
                    setRatioButtonLeft(ratioButtonRef.current.getBoundingClientRect().left);
                  }
                  setShowRatioPicker(!showRatioPicker);
                }}
              >
                <AspectRatioIcon ratio={aspectRatio} selected={false} />
                {formatRatioLabel(aspectRatio)} <span style={{ fontSize: '10px', opacity: 0.5 }}>˅</span>
              </button>
              )}
              {/* #635 时长按钮：showDuration 的模型显示；HappyHorse 仅非 video-edit 模式显示 */}
              {currentModelConfig.showDuration && (!isHappyHorseModel || hhParams?.showDuration) && (
                  <button 
                    ref={durationButtonRef}
                    className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 transition-colors"
                    onClick={() => {
                      if (durationButtonRef.current) {
                        setDurationButtonLeft(durationButtonRef.current.getBoundingClientRect().left);
                      }
                      setShowDurationPicker(!showDurationPicker);
                    }}
                  >
                    {duration}秒 <span style={{ fontSize: '10px', opacity: 0.5 }}>˅</span>
                  </button>
              )}
              {(currentModelConfig.showResolution || currentModelConfig.supportsUpsample) && (
                  <button 
                    ref={sizeButtonRef}
                    className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 transition-colors"
                    onClick={() => {
                      if (sizeButtonRef.current) {
                        setSizeButtonLeft(sizeButtonRef.current.getBoundingClientRect().left);
                      }
                      setShowSizePicker(!showSizePicker);
                    }}
                  >
                    {formatVideoResolution(resolution)} <span style={{ fontSize: '10px', opacity: 0.5 }}>˅</span>
                  </button>
              )}
              {/* HappyHorse/Seedance 2.0 模式切换按钮 */}
              {isModeSwitchModel && (
                <ModelModeSwitcher
                  inputImageUrls={referenceImageUrls}
                  inputVideoUrl={inputVideoUrl}
                  overrideMode={hhOverrideMode}
                  setOverrideMode={setHhOverrideMode}
                  onModeChange={handleModeChangeFromSwitcher}
                  audioSetting={audioSetting}
                  onAudioSettingChange={setAudioSetting}
                  generateAudio={generateAudio}
                  onGenerateAudioChange={setGenerateAudio}
                  variant="video-page"
                  modelType={isMegaAiSeedanceModel ? 'mega-ai-seedance' : isTopaisMinimaxModel ? 'topais-minimax' : isTopaisKlingOmniModel ? 'topais-kling-omni' : isSeedance2Model ? 'seedance2' : isT8SeedanceModel ? 't8seedance' : isTopaisModel ? 'topais' : isTopaisHhModel ? 'topais-happyhorse' : isTopaisSeedanceModel ? 'topais-seedance' : isTopaisGeminiOmniModel ? 'topais-gemini-omni' : isLingyaVeoModel ? 'lingya-veo' : isLingyaSoraModel ? 'lingya-sora' : 'happyhorse'}
                />
              )}
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-[11px] text-gray-500 font-medium">
                  剩余 {credits}
                </span>
                <span className="text-[11px] text-gray-400 font-medium">
                  {videoCreditCost} 积分
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
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <Button size="sm" className="absolute bottom-3 right-3 bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] hover:from-[rgb(120,140,220)] to-[rgb(212,160,170)] text-white brightness-110 saturate-[1.1]" onClick={() => handleDownload(selectedTask.videos[0], selectedTask.videoKeys?.[0])}>
                    <Download className="w-4 h-4 mr-1" />
                    下载
                  </Button>
                </>
              ) : selectedTask && selectedTask.status === 'generating' ? (
                <div className="absolute inset-0">
                  <RoseCurveAnimation color={roseColor} showDetail externalProgress={videoProgress} />
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
                    <Label className="text-xs text-gray-500 dark:text-gray-400">分辨率</Label>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">{selectedTask.params.size}</p>
                  </div>
                )}

                {selectedTask.params.referenceImages && selectedTask.params.referenceImages.length > 0 && (
                  <div className="mb-3">
                    <Label className="text-xs text-gray-500 dark:text-gray-400">参考图 ({selectedTask.params.referenceImages.length}张)</Label>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {selectedTask.params.referenceImages.map((img: string, idx: number) => {
                        // #全局域名大一统 支持 img.kiikii.me 和原始 COS 域名 → 通过302重定向获取CDN签名URL
                        const displayUrl = (img.includes('myqcloud.com') || img.includes('img.kiikii.me'))
                          ? `/api/canvas/image?url=${encodeURIComponent(img)}`
                          : img;
                        return (
                          <div key={idx} className="w-12 h-12 rounded-md overflow-hidden border border-gray-200 dark:border-gray-600 cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all" onClick={() => setPreviewImage(displayUrl)}>
                            <img src={displayUrl} alt={`参考图${idx + 1}`} className="w-full h-full object-cover" referrerPolicy="no-referrer-when-downgrade" />
                          </div>
                        );
                      })}
                    </div>
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
                      <RoseCurveAnimation color={roseColor} mini showDetail externalProgress={task.progress || 0} />
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
            <img src={previewImage} alt="预览图片" className="max-w-full max-h-[90vh] object-contain" referrerPolicy="no-referrer-when-downgrade" />
            <button onClick={() => setPreviewImage(null)} className="absolute -top-2 -right-2 w-8 h-8 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center shadow-lg hover:bg-gray-100 dark:hover:bg-gray-700">
              <X className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            </button>
          </div>
        </div>
      )}

      {/* 视频预览弹窗 - 点击放大播放 */}
      {previewVideoUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setPreviewVideoUrl(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <video src={previewVideoUrl} className="max-w-full max-h-[85vh] rounded-lg" autoPlay controls />
            <button onClick={() => setPreviewVideoUrl(null)} className="absolute -top-2 -right-2 w-8 h-8 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center shadow-lg hover:bg-gray-100 dark:hover:bg-gray-700">
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
                {(() => {
                  // #866 修复：MiniMax 按模式计算比例 disabled 状态（三端一致）
                  const ratioStates = isTopaisMinimaxModel
                    ? getTopaisMinimaxRatioStates(hhCurrentMode, currentModelConfig.aspectRatios)
                    : currentModelConfig.aspectRatios.map((r: string) => ({ ratio: r, disabled: false }));
                  return ratioStates.map(({ ratio, disabled: isRatioDisabled }) => {
                  return (
                  <button
                    key={ratio}
                    onClick={() => {
                      if (isRatioDisabled) return;  // 禁用的比例不可选
                      setAspectRatio(ratio);
                      setShowRatioPicker(false);
                    }}
                    className={`py-2 px-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-1 ${
                      isRatioDisabled
                        ? 'bg-gray-50 dark:bg-gray-900 text-gray-300 dark:text-gray-600 cursor-not-allowed'
                        : aspectRatio === ratio 
                        ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    <AspectRatioIcon ratio={ratio} selected={aspectRatio === ratio} />
                    <span>{formatRatioLabel(ratio)}</span>
                  </button>
                  );
                  });
                })()}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 时长选择弹窗 - 所有视频模型 */}
      {showDurationPicker && currentModelConfig.showDuration && (
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
                {(() => {
                  // #548 Sora-2 动态时长过滤：文生视频只有10s，图生视频4/8/10/12s
                  let durationsList = currentModelConfig.durations && currentModelConfig.durations.length > 0
                    ? currentModelConfig.durations.map((d: any) => {
                        const secs = parseInt(d.value || d.label);
                        return { label: d.label || `${secs}秒`, value: secs };
                      })
                    : [{ label: '4秒', value: 4 }, { label: '8秒', value: 8 }, { label: '12秒', value: 12 }];
                  
                  if (model === 'sora-2') {
                    const sora2Allowed = referenceImages.length === 0
                      ? [10]           // 文生视频：只有10s
                      : [4, 8, 10, 12]; // 图生视频：4/8/10/12s
                    durationsList = durationsList.filter(d => sora2Allowed.includes(d.value));
                  }
                  return durationsList;
                })().map((d) => (
                  <button
                    key={d.value}
                    onClick={() => {
                      setDuration(d.value);
                      setShowDurationPicker(false);
                    }}
                    className={`py-2 px-3 rounded-lg text-sm transition-colors ${
                      duration === d.value 
                        ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 分辨率选择弹窗 - 所有视频模型统一 */}
      {showSizePicker && (currentModelConfig.showResolution || currentModelConfig.supportsUpsample) && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowSizePicker(false)} />
          <div className="fixed bottom-[180px] z-50" style={{ left: sizeButtonLeft }}>
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[150px]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">选择分辨率</h3>
                <button 
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" 
                  onClick={() => setShowSizePicker(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-2 space-y-1">
                {/* #540 分辨率从数据库配置动态读取 + Veo: 图生图只显示720p */}
                {(() => {
                  let resList = currentModelConfig.resolutions || [{ label: '720p', value: '720p', credits: 80 }];
                  // Veo模型(supportsUpsample)：有参考图时过滤掉1080p，只保留720p
                  if (currentModelConfig.supportsUpsample && referenceImages.length > 0) {
                    resList = resList.filter((r: { label: string; value: string; credits: number }) => {
                      const val = (r.value || r.label).toLowerCase();
                      return val === '720p';
                    });
                    // 如果过滤后为空，添加720p
                    if (resList.length === 0) {
                      resList = [{ label: '720p', value: '720p', credits: 80 }];
                    }
                  }
                  // Veo模型文生图时如果列表为空，添加720p+1080p
                  if (currentModelConfig.supportsUpsample && referenceImages.length === 0 && resList.length === 0) {
                    resList = [{ label: '720p', value: '720p', credits: 80 }, { label: '1080p', value: '1080p', credits: 100 }];
                  }
                  return resList;
                })().map((res: { label: string; value: string; credits: number }) => {
                  return (
                    <button
                      key={res.value}
                      onClick={() => {
                        setResolution(res.value);
                        setShowSizePicker(false);
                      }}
                      className={`w-full py-2 px-3 rounded-lg text-sm transition-colors flex items-center justify-between ${
                        resolution === res.value 
                          ? 'bg-gray-900 dark:bg-gray-700 text-white' 
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span>{res.label || res.value}</span>
                      <span className={`text-[10px] ${resolution === res.value ? 'text-gray-300' : 'text-gray-400'}`}>{res.credits}积分/秒</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 模型选择弹窗 - 样式与对话框一致 */}
      {showModelPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowModelPicker(false)} />
          <div className="fixed top-[95px] left-[84px] z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[360px] max-h-[80vh] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">模型偏好</h3>
                <button 
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" 
                  onClick={() => setShowModelPicker(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-2 space-y-1 overflow-y-auto max-h-[50vh]">
                {allModels.map((m) => {
                  const isActive = m.is_active !== false;
                  // #548 固定计费判断：使用数据库 videoPricing.mode，或回退到 showDuration+showResolution
                  const videoPricing = (m as any).videoPricing;
                  const isFixedPricing = videoPricing?.mode === 'fixed' || (!!(m as any).showDuration === false && !!(m as any).showResolution === false);
                  // 视频模型选择弹窗：只显示模型名称 + 积分信息，不显示秒数
                  const durations = (m as any).durations || [];
                  const minCredits = isFixedPricing
                    ? ((m as any).credits_base || m.credits || videoPricing?.credits || 80)
                    : (() => {
                        const minDuration = durations.length > 0
                          ? Math.min(...durations.map((d: any) => parseInt(d.value || d.label) || 8))
                          : 8;
                        const modelResolutions = (m as any).resolutions || [];
                        const minCreditsPerSec = modelResolutions.length > 0
                          ? Math.min(...modelResolutions.map((r: any) => r.credits || 80))
                          : 80;
                        return minCreditsPerSec * minDuration;
                      })();
                  // #559 获取模型分辨率规格（用于显示）
                  const modelResList = (m as any).resolutions || [];
                  const resolutionLabel = modelResList.length > 0 
                    ? modelResList.map((r: any) => r.label || r.value).join(' / ')
                    : (isFixedPricing && !m.showResolution ? '720p' : null);
                  // #636 当用户上传了视频参考时，不支持视频参考的模型不可选
                  const modelSupportsVideoRef = getModelSupportedTypes(m.id).video;
                  const videoRefUnavailable = !!inputVideoUrl && !modelSupportsVideoRef;
                  // 模型 Logo 映射（独立性：按 family 判断）
                  const mid = m.id.toLowerCase();
                  const _midFamily = ModelDetector.getFamily(m.id);
                  const isSeedanceModelLogo = ['seedance2', 't8seedance', 'topais-seedance', 'mega-ai-seedance', 'topais-minimax'].includes(_midFamily);
                  const isLingyaVeoLogo = _midFamily === 'lingya-veo';
                  const isT8VeoLogo = _midFamily === 'veo';
                  const isTopaisVeoLogo = _midFamily === 'topais';
                  const isLingyaSoraLogo = _midFamily === 'lingya-sora';
                  const isT8SoraLogo = _midFamily === 'sora';
                  const isHHModelLogo = _midFamily === 'happyhorse' || _midFamily === 'topais-happyhorse';
                  const isNanoBananaModel = mid.includes('nana') || mid.includes('banana');
                  const isGptImage2Model = m.id.includes('gpt-image-2') || mid.includes('gptimage2');
                  const isGeminiModel = mid.includes('gemini');
                  const isGpt5Model = mid.includes('gpt-5');
                  const modelLogo = isGeminiModel ? '/gemini-logo.png'
                    : isGpt5Model ? '/gpt-image-2-logo.png'
                    : isSeedanceModelLogo ? '/seedance-logo.png'
                    : (isLingyaVeoLogo || isT8VeoLogo || isTopaisVeoLogo) ? '/veo-logo.png'
                    : (isLingyaSoraLogo || isT8SoraLogo) ? '/gpt-image-2-logo.png'
                    : isGptImage2Model ? '/gpt-image-2-logo.png' 
                    : isNanoBananaModel ? '/banana-logo.png'
                    : isHHModelLogo ? '/happyhorse-logo.png'
                    : '/logo-main.png';
                  const needWhiteLogo = !isNanoBananaModel;
                  const isSelected = model === m.id;

                  if (!isActive) {
                    return (
                      <div 
                        key={m.id}
                        className="flex items-center gap-3 p-3 rounded-lg cursor-not-allowed opacity-60"
                      >
                        <img src={modelLogo} alt="" className={`w-8 h-8 rounded-lg scale-[0.85] ${needWhiteLogo ? 'dark:brightness-0 dark:invert' : ''}`} referrerPolicy="no-referrer-when-downgrade" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-400 dark:text-gray-500">{m.name}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">离线</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {resolutionLabel && (
                              <span className="text-xs text-gray-400 dark:text-gray-500">{resolutionLabel}</span>
                            )}
                            {resolutionLabel && <span className="text-xs text-gray-300 dark:text-gray-600">|</span>}
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {isFixedPricing ? `${minCredits}积分/次` : `${minCredits}积分起`}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div 
                      key={m.id}
                      onClick={() => {
                        if (videoRefUnavailable) return;
                        handleModelChange(m.id);
                        setShowModelPicker(false);
                      }}
                      title={videoRefUnavailable ? '该模型不支持视频参考输入' : undefined}
                      className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                        videoRefUnavailable ? 'cursor-not-allowed opacity-40' :
                        isSelected ? 'bg-gray-100 dark:bg-gray-700 cursor-pointer' : 'hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer'
                      }`}
                    >
                      <img src={modelLogo} alt="" className={`w-8 h-8 rounded-lg scale-[0.85] ${needWhiteLogo ? 'dark:brightness-0 dark:invert' : ''}`} referrerPolicy="no-referrer-when-downgrade" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${videoRefUnavailable ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>{m.name}</span>
                          {!videoRefUnavailable && (
                            <span className={isActive ? 'text-green-500 text-xs' : 'text-red-500 text-xs'}>
                              {isActive ? '●' : '○'}
                            </span>
                          )}
                          {videoRefUnavailable && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">不支持视频</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {resolutionLabel && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">{resolutionLabel}</span>
                          )}
                          {resolutionLabel && <span className="text-xs text-gray-300 dark:text-gray-600">|</span>}
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {isFixedPricing ? `${minCredits}积分/次` : `${minCredits}积分起`}
                          </span>
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'border-gray-900 dark:border-gray-100 bg-gray-900 dark:bg-gray-100' : 'border-gray-300 dark:border-gray-600'
                      }`}>
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M3 6L5 8L9 4" stroke={document.documentElement.classList.contains('dark') ? '#1f2937' : 'white'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    </div>
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
