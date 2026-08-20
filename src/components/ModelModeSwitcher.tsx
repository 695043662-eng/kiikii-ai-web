'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

/** 检测当前是否为暗色模式（DOM 级别） */
function useIsDarkMode() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

/**
 * HappyHorse 视频生成模式类型
 * - t2v: 文生视频（纯文本）
 * - i2v: 图生视频（1张首帧图片动起来）
 * - r2v: 参考生视频（图片作为角色特征重绘）
 * - video-edit: 视频编辑（风格变换/局部替换）
 */
export type HappyHorseMode = 't2v' | 'i2v' | 'r2v' | 'video-edit';

/** @deprecated 使用 VideoModelMode 代替 */
export type VideoMode = VideoModelMode;

/**
 * Seedance 2.0 视频生成模式类型（#642 新增）
 * - t2v: 文生视频（纯文本）
 * - i2v-first-frame: 图生视频-首帧（1张首帧图片）
 * - i2v-first-last-frame: 图生视频-首尾帧（首帧+尾帧2张图片）
 * - r2v: 多模态参考生视频（1~9张参考图 + 可选参考视频/音频）
 */
export type Seedance2Mode = 't2v' | 'i2v-first-frame' | 'i2v-first-last-frame' | 'r2v';

/**
 * #689 TOPAIS Veo3.1-fast 视频生成模式类型
 * - t2v: 文生视频（0张图片）
 * - i2v: 首尾帧生视频（1-2张图片）
 * - r2v: 参考生视频（1-3张图片）
 */
export type TopaisMode = 't2v' | 'i2v' | 'r2v';

/**
 * #691 TOPAIS HappyHorse 1.1 视频生成模式类型
 * - t2v: 文生视频（无素材）
 * - i2v: 图生视频（1张首帧图）
 * - r2v: 参考生视频（1-9张参考图）
 * - video-edit: 视频编辑（1个视频）
 */
export type TopaisHhMode = 't2v' | 'i2v' | 'r2v' | 'video-edit';

/**
 * TOPAIS Gemini Omni Flash 视频生成模式类型（独立性：与 HappyHorse 完全独立）
 * - t2v: 文生视频（0张图片）
 * - i2v: 图生视频（1张参考图）
 * - r2v: 参考图融合生视频（3张参考图）
 * 注意：不支持2张图片，不支持video-edit
 */
export type TopaisGeminiOmniMode = 't2v' | 'i2v' | 'r2v';

/**
 * LingYa Veo3.1 视频生成模式类型（独立性：与 TOPAIS Veo 完全独立）
 * - t2v: 文生视频（0张图片）
 * - i2v: 首帧生视频（1张首帧图片）
 * - r2v: 首尾帧生视频（1-2张首尾帧图片）
 */
export type LingyaVeoMode = 't2v' | 'i2v' | 'r2v';

/**
 * LingYa Sora-2 VIP 视频生成模式类型（独立性：与 T8 Sora-2 完全独立）
 * - t2v: 文生视频（0张图片）
 * - i2v: 图生视频（1张首帧图片）
 * - r2v: 参考生视频（1-2张参考图）
 */
export type LingyaSoraMode = 't2v' | 'i2v' | 'r2v';

/**
 * 视频模式联合类型（所有模型独立）
 */
export type VideoModelMode = HappyHorseMode | Seedance2Mode | TopaisMode | TopaisHhMode | TopaisGeminiOmniMode | LingyaVeoMode | LingyaSoraMode;

/**
 * 模式配置映射
 */
export const HAPPYHORSE_MODE_CONFIG: Record<HappyHorseMode, {
  label: string;
  shortLabel: string;
  description: string;
}> = {
  't2v': {
    label: '文生视频',
    shortLabel: '文生视频',
    description: '纯文本描述生成视频',
  },
  'i2v': {
    label: '图生视频',
    shortLabel: '图生视频',
    description: '上传一张图片作为视频首帧，AI 将让图片动起来',
  },
  'r2v': {
    label: '参考生视频',
    shortLabel: '参考生视频',
    description: '将图片作为角色特征重绘',
  },
  'video-edit': {
    label: '视频编辑',
    shortLabel: '视频编辑',
    description: '风格变换、局部替换等编辑',
  },
};

/**
 * #667 T8 Seedance (sdols-2.0) 模式配置 - 全模态解锁
 * 与 LingYa Seedance 2.0 完全对齐：t2v, i2v, i2v-first-frame, i2v-first-last-frame, r2v
 */
export const T8SEEDANCE_MODE_CONFIG: Record<string, {
  label: string;
  shortLabel: string;
  description: string;
}> = {
  't2v': {
    label: '文生视频',
    shortLabel: '文生视频',
    description: '纯文本描述生成视频',
  },
  'i2v': {
    label: '图生视频',
    shortLabel: '图生视频',
    description: '上传1张图片作为首帧参考，AI生成视频',
  },
  'i2v-first-frame': {
    label: '图生视频-首帧',
    shortLabel: '首帧',
    description: '上传1张图片作为视频首帧，AI让图片动起来',
  },
  'i2v-first-last-frame': {
    label: '图生视频-首尾帧',
    shortLabel: '首尾帧',
    description: '上传首帧和尾帧图片，AI生成过渡动画',
  },
  'r2v': {
    label: '参考生视频',
    shortLabel: '参考生视频',
    description: '上传参考图/视频/音频，AI融合特征生成视频',
  },
};

/**
 * #667 T8 Seedance (sdols-2.0) 模式素材槽位配置 - 全模态解锁
 */
export function getT8SeedanceSlotStatus(mode: string): {
  firstFrame: { enabled: boolean; max: number };
  lastFrame: { enabled: boolean; max: number };
  refImage: { enabled: boolean; max: number };
  refVideo: { enabled: boolean; max: number };
  refAudio: { enabled: boolean; max: number };
} {
  // #655 t2v 不支持音频！音频必须搭配图片或视频（官方文档约束）
  const constraints: Record<string, { firstFrame: number; lastFrame: number; refImage: number; refVideo: number; refAudio: number }> = {
    't2v': { firstFrame: 0, lastFrame: 0, refImage: 0, refVideo: 0, refAudio: 0 },
    'i2v': { firstFrame: 1, lastFrame: 0, refImage: 0, refVideo: 3, refAudio: 3 },
    'i2v-first-frame': { firstFrame: 1, lastFrame: 0, refImage: 0, refVideo: 3, refAudio: 3 },
    'i2v-first-last-frame': { firstFrame: 1, lastFrame: 1, refImage: 0, refVideo: 3, refAudio: 3 },
    'r2v': { firstFrame: 0, lastFrame: 0, refImage: 9, refVideo: 3, refAudio: 3 },
  };
  const c = constraints[mode] || constraints['t2v'];
  return {
    firstFrame: { enabled: c.firstFrame > 0, max: c.firstFrame },
    lastFrame: { enabled: c.lastFrame > 0, max: c.lastFrame },
    refImage: { enabled: c.refImage > 0, max: c.refImage },
    refVideo: { enabled: c.refVideo > 0, max: c.refVideo },
    refAudio: { enabled: c.refAudio > 0, max: c.refAudio },
  };
}

/**
 * #667 T8 Seedance (sdols-2.0) 模式参数显示配置 - 全模态解锁
 */
export function getT8SeedanceModeParams(mode: string) {
  // #668 T8 sdols-2.0 全模态解锁：与 LingYa Seedance 2.0 完全对齐
  return {
    showRatio: true,
    showDuration: true,
    promptRequired: mode === 't2v',
    showImageUpload: mode !== 't2v',
    showFirstFrameUpload: ['i2v', 'i2v-first-frame', 'i2v-first-last-frame'].includes(mode),
    showLastFrameUpload: mode === 'i2v-first-last-frame',
    showRefImageUpload: mode === 'r2v',
    showVideoUpload: mode !== 't2v',  // #668 对齐 Seedance 2.0：除 t2v 外都支持视频
    showAudioUpload: mode !== 't2v',  // #655 t2v 不支持音频！音频必须搭配图片或视频
  };
}

/**
 * #642 Seedance 2.0 模式配置映射
 * 四种互斥场景：文生/首帧/首尾帧/参考生
 */
export const SEEDANCE2_MODE_CONFIG: Record<Seedance2Mode, {
  label: string;
  shortLabel: string;
  description: string;
}> = {
  't2v': {
    label: '文生视频',
    shortLabel: '文生视频',
    description: '纯文本描述生成视频',
  },
  'i2v-first-frame': {
    label: '图生视频-首帧',
    shortLabel: '首帧',
    description: '上传1张图片作为视频首帧，AI让图片动起来',
  },
  'i2v-first-last-frame': {
    label: '图生视频-首尾帧',
    shortLabel: '首尾帧',
    description: '上传首帧和尾帧图片，AI生成过渡动画',
  },
  'r2v': {
    label: '参考生视频',
    shortLabel: '参考生视频',
    description: '1~9张参考图+可选视频/音频，多模态生成',
  },
};

/**
 * #642 根据 Seedance 2.0 模式判断素材槽位可用状态
 * 返回各槽位的 { enabled, max }
 */
export function getSeedance2SlotStatus(mode: Seedance2Mode): {
  firstFrame: { enabled: boolean; max: number };
  lastFrame: { enabled: boolean; max: number };
  refImage: { enabled: boolean; max: number };
  refVideo: { enabled: boolean; max: number };
  refAudio: { enabled: boolean; max: number };
} {
  const constraints: Record<Seedance2Mode, {
    firstFrame: number; lastFrame: number; refImage: number; refVideo: number; refAudio: number;
  }> = {
    't2v': { firstFrame: 0, lastFrame: 0, refImage: 0, refVideo: 0, refAudio: 0 },
    'i2v-first-frame': { firstFrame: 1, lastFrame: 0, refImage: 0, refVideo: 3, refAudio: 3 },
    'i2v-first-last-frame': { firstFrame: 1, lastFrame: 1, refImage: 0, refVideo: 3, refAudio: 3 },
    'r2v': { firstFrame: 0, lastFrame: 0, refImage: 9, refVideo: 3, refAudio: 3 },
  };
  const c = constraints[mode];
  return {
    firstFrame: { enabled: c.firstFrame > 0, max: c.firstFrame },
    lastFrame: { enabled: c.lastFrame > 0, max: c.lastFrame },
    refImage: { enabled: c.refImage > 0, max: c.refImage },
    refVideo: { enabled: c.refVideo > 0, max: c.refVideo },
    refAudio: { enabled: c.refAudio > 0, max: c.refAudio },
  };
}

/**
 * #642 根据 Seedance 2.0 模式判断需要显示哪些参数
 */
export function getSeedance2ModeParams(mode: Seedance2Mode) {
  return {
    showRatio: true,               // Seedance 2.0 所有模式都支持比例选择
    showDuration: true,            // 所有模式都支持时长选择（4~15秒）
    promptRequired: mode !== 't2v' ? false : true,  // t2v 必须有提示词，其他可选
    showImageUpload: mode !== 't2v',
    showFirstFrameUpload: mode === 'i2v-first-frame' || mode === 'i2v-first-last-frame',
    showLastFrameUpload: mode === 'i2v-first-last-frame',
    showRefImageUpload: mode === 'r2v',
    showVideoUpload: mode !== 't2v',
    showAudioUpload: mode !== 't2v',  // #655 t2v 不支持音频！音频必须搭配图片或视频
  };
}

export type ModelType = 'happyhorse' | 'seedance2' | 't8seedance' | 'topais' | 'topais-happyhorse' | 'topais-seedance' | 'topais-gemini-omni' | 'mega-ai-seedance' | 'topais-minimax' | 'topais-kling-omni' | 'lingya-veo' | 'lingya-sora';

/**
 * #691 TOPAIS HappyHorse 1.1 模式配置（独立供应商）
 * - t2v: 文生视频（无素材）
 * - i2v: 图生视频（1张首帧图）
 * - r2v: 参考生视频（1-9张参考图）
 * - video-edit: 视频编辑（1个视频）
 */
export const TOPAIS_HH_MODE_CONFIG: Record<string, {
  label: string;
  shortLabel: string;
  description: string;
}> = {
  't2v': {
    label: '文生视频',
    shortLabel: '文生视频',
    description: '纯文本生成视频',
  },
  'i2v': {
    label: '图生视频',
    shortLabel: '图生视频',
    description: '上传1张图片作为视频首帧',
  },
  'r2v': {
    label: '参考生视频',
    shortLabel: '参考生视频',
    description: '上传1-9张参考图生成视频',
  },
  'video-edit': {
    label: '视频编辑',
    shortLabel: '视频编辑',
    description: '上传视频进行编辑',
  },
};

/**
 * #691 TOPAIS HappyHorse 1.1 模式素材槽位配置
 */
export function getTopaisHhSlotStatus(mode: string): {
  image: { enabled: boolean; max: number };
  video: { enabled: boolean; max: number };
} {
  const constraints: Record<string, { image: number; video: number }> = {
    't2v': { image: 0, video: 0 },
    'i2v': { image: 1, video: 0 },   // 1张首帧图
    'r2v': { image: 9, video: 0 },   // 1-9张参考图
    'video-edit': { image: 0, video: 1 },  // 1个视频
  };
  const c = constraints[mode] || constraints['t2v'];
  return {
    image: { enabled: c.image > 0, max: c.image },
    video: { enabled: c.video > 0, max: c.video },
  };
}

/**
 * #691 TOPAIS HappyHorse 1.1 模式参数显示配置
 */
export function getTopaisHhModeParams(mode: string) {
  return {
    showRatio: true,
    showDuration: true,  // 3-15秒可选择
    promptRequired: mode === 't2v',  // t2v必须有提示词，其他可选
    showImageUpload: mode === 'i2v' || mode === 'r2v',
    showVideoUpload: mode === 'video-edit',
  };
}

/**
 * TOPAIS Gemini Omni Flash 模式配置映射（独立性：与 HappyHorse 完全独立）
 * - t2v: 文生视频（0张图片）
 * - i2v: 图生视频（1张参考图）
 * - r2v: 参考图融合生视频（3张参考图）
 * 注意：不支持2张图片，不支持video-edit
 */
export const TOPAIS_GEMINI_OMNI_MODE_CONFIG: Record<string, {
  label: string;
  shortLabel: string;
  description: string;
}> = {
  't2v': {
    label: '文生视频',
    shortLabel: '文生视频',
    description: '纯文本生成视频',
  },
  'i2v': {
    label: '图生视频',
    shortLabel: '图生视频',
    description: '上传1张参考图生成视频',
  },
  'r2v': {
    label: '参考图融合',
    shortLabel: '参考图融合',
    description: '上传3张参考图融合生成视频',
  },
};

/**
 * TOPAIS Gemini Omni Flash 模式素材槽位配置（独立性：与 HappyHorse 完全独立）
 */
export function getTopaisGeminiOmniSlotStatus(mode: string): {
  image: { enabled: boolean; max: number };
  video: { enabled: boolean; max: number };
} {
  const constraints: Record<string, { image: number; video: number }> = {
    't2v': { image: 0, video: 0 },
    'i2v': { image: 1, video: 0 },   // 1张参考图
    'r2v': { image: 3, video: 0 },   // 3张参考图（融合）
  };
  const c = constraints[mode] || constraints['t2v'];
  return {
    image: { enabled: c.image > 0, max: c.image },
    video: { enabled: c.video > 0, max: c.video },
  };
}

/**
 * TOPAIS Gemini Omni Flash 模式参数显示配置（独立性：与 HappyHorse 完全独立）
 */
export function getTopaisGeminiOmniModeParams(mode: string) {
  return {
    showRatio: true,
    showDuration: true,  // 4/6/8/10秒可选择
    promptRequired: true,  // 所有模式都需要提示词
    showImageUpload: mode === 'i2v' || mode === 'r2v',
    showVideoUpload: false,  // 不支持视频输入
  };
}

/**
 * #689 TOPAIS Veo3.1-fast 模式配置
 * - t2v: 文生视频（0张图片）
 * - i2v: 首尾帧生视频（1-2张图片）
 * - r2v: 参考图生视频（1-3张图片）
 */
export const TOPAIS_MODE_CONFIG: Record<string, {
  label: string;
  shortLabel: string;
  description: string;
}> = {
  't2v': {
    label: '文生视频',
    shortLabel: '文生视频',
    description: '纯文本生成视频',
  },
  'i2v': {
    label: '首尾帧生视频',
    shortLabel: '首尾帧',
    description: '上传1-2张图片作为首尾帧',
  },
  'r2v': {
    label: '参考生视频',
    shortLabel: '参考生视频',
    description: '上传1-3张参考图生成视频',
  },
};

/**
 * #689 TOPAIS Veo3.1-fast 模式素材槽位配置
 */
export function getTopaisSlotStatus(mode: string): {
  image: { enabled: boolean; max: number };
} {
  const constraints: Record<string, { image: number }> = {
    't2v': { image: 0 },
    'i2v': { image: 2 },   // 1-2张首尾帧
    'r2v': { image: 3 },   // 1-3张参考图
  };
  const c = constraints[mode] || constraints['t2v'];
  return {
    image: { enabled: c.image > 0, max: c.image },
  };
}

/**
 * #689 TOPAIS Veo3.1-fast 模式参数显示配置
 */
export function getTopaisModeParams(mode: string) {
  return {
    showRatio: true,
    showDuration: true,   // #690 显示时长栏目（固定8秒）
    fixedDuration: 8,     // #690 固定8秒，前端显示不可选择
    durationOptions: [8], // #690 只有一个选项
    promptRequired: mode === 't2v',  // t2v必须有提示词，i2v/r2v可选
    showImageUpload: mode !== 't2v',
  };
}

/**
 * TOPAIS Seedance 2.0 模式配置（独立供应商）
 * - t2v: 文生视频（纯文本）
 * - i2v-first-frame: 图生视频-首帧（1张首帧图片）
 * - i2v-first-last-frame: 图生视频-首尾帧（首帧+尾帧2张图片）
 * - r2v: 多模态参考生视频（1~9张参考图 + 可选参考视频/音频）
 */
export const TOPAIS_SEEDANCE_MODE_CONFIG: Record<string, {
  label: string;
  shortLabel: string;
  description: string;
}> = {
  't2v': {
    label: '文生视频',
    shortLabel: '文生视频',
    description: '纯文本描述生成视频',
  },
  'i2v-first-frame': {
    label: '图生视频-首帧',
    shortLabel: '首帧',
    description: '上传1张图片作为视频首帧，AI让图片动起来',
  },
  'i2v-first-last-frame': {
    label: '图生视频-首尾帧',
    shortLabel: '首尾帧',
    description: '上传首帧和尾帧图片，AI生成过渡动画',
  },
  'r2v': {
    label: '参考生视频',
    shortLabel: '参考生视频',
    description: '1~9张参考图+可选视频/音频，多模态生成',
  },
};

/**
 * TOPAIS Seedance 2.0 模式素材槽位配置
 */
export function getTopaisSeedanceSlotStatus(mode: string): {
  firstFrame: { enabled: boolean; max: number };
  lastFrame: { enabled: boolean; max: number };
  refImage: { enabled: boolean; max: number };
  refVideo: { enabled: boolean; max: number };
  refAudio: { enabled: boolean; max: number };
} {
  const constraints: Record<string, {
    firstFrame: number; lastFrame: number; refImage: number; refVideo: number; refAudio: number;
  }> = {
    't2v': { firstFrame: 0, lastFrame: 0, refImage: 0, refVideo: 0, refAudio: 0 },
    'i2v-first-frame': { firstFrame: 1, lastFrame: 0, refImage: 0, refVideo: 3, refAudio: 3 },
    'i2v-first-last-frame': { firstFrame: 1, lastFrame: 1, refImage: 0, refVideo: 3, refAudio: 3 },
    'r2v': { firstFrame: 0, lastFrame: 0, refImage: 9, refVideo: 3, refAudio: 3 },
  };
  const c = constraints[mode] || constraints['t2v'];
  return {
    firstFrame: { enabled: c.firstFrame > 0, max: c.firstFrame },
    lastFrame: { enabled: c.lastFrame > 0, max: c.lastFrame },
    refImage: { enabled: c.refImage > 0, max: c.refImage },
    refVideo: { enabled: c.refVideo > 0, max: c.refVideo },
    refAudio: { enabled: c.refAudio > 0, max: c.refAudio },
  };
}

/**
 * TOPAIS Seedance 2.0 模式参数显示配置
 */
export function getTopaisSeedanceModeParams(mode: string) {
  return {
    showRatio: true,               // 所有模式都支持比例选择
    showDuration: true,            // 所有模式都支持时长选择
    promptRequired: mode === 't2v',  // t2v 必须有提示词，其他可选
    showImageUpload: mode !== 't2v',
    showFirstFrameUpload: mode === 'i2v-first-frame' || mode === 'i2v-first-last-frame',
    showLastFrameUpload: mode === 'i2v-first-last-frame',
    showRefImageUpload: mode === 'r2v',
    showVideoUpload: mode !== 't2v',
    showAudioUpload: mode !== 't2v',  // t2v 不支持音频！音频必须搭配图片或视频
  };
}

// ============================================================
// MEGA AI Seedance 2.0 独立配置（与所有其他供应商完全独立！）
// 固定720p，不支持分辨率选择
// ============================================================

export const MEGA_AI_SEEDANCE_MODE_CONFIG: Record<string, {
  label: string;
  shortLabel: string;
  description: string;
}> = {
  't2v': {
    label: '文生视频',
    shortLabel: '文生视频',
    description: '纯文本描述生成视频',
  },
  'i2v-first-frame': {
    label: '图生视频-首帧',
    shortLabel: '首帧',
    description: '上传1张图片作为视频首帧，AI让图片动起来',
  },
  'i2v-first-last-frame': {
    label: '图生视频-首尾帧',
    shortLabel: '首尾帧',
    description: '上传首帧和尾帧图片，AI生成过渡动画',
  },
  'r2v': {
    label: '参考生视频',
    shortLabel: '参考生视频',
    description: '1~9张参考图+可选视频/音频，多模态生成',
  },
};

/**
 * MEGA AI Seedance 2.0 模式素材槽位配置
 * 独立配置，与 TOPAIS Seedance 完全隔离
 */
export function getMegaAiSeedanceSlotStatus(mode: string): {
  firstFrame: { enabled: boolean; max: number };
  lastFrame: { enabled: boolean; max: number };
  refImage: { enabled: boolean; max: number };
  refVideo: { enabled: boolean; max: number };
  refAudio: { enabled: boolean; max: number };
} {
  const constraints: Record<string, {
    firstFrame: number; lastFrame: number; refImage: number; refVideo: number; refAudio: number;
  }> = {
    't2v': { firstFrame: 0, lastFrame: 0, refImage: 0, refVideo: 0, refAudio: 0 },
    'i2v-first-frame': { firstFrame: 1, lastFrame: 0, refImage: 0, refVideo: 3, refAudio: 3 },
    'i2v-first-last-frame': { firstFrame: 1, lastFrame: 1, refImage: 0, refVideo: 3, refAudio: 3 },
    'r2v': { firstFrame: 0, lastFrame: 0, refImage: 9, refVideo: 3, refAudio: 3 },
  };
  const c = constraints[mode] || constraints['t2v'];
  return {
    firstFrame: { enabled: c.firstFrame > 0, max: c.firstFrame },
    lastFrame: { enabled: c.lastFrame > 0, max: c.lastFrame },
    refImage: { enabled: c.refImage > 0, max: c.refImage },
    refVideo: { enabled: c.refVideo > 0, max: c.refVideo },
    refAudio: { enabled: c.refAudio > 0, max: c.refAudio },
  };
}

/**
 * MEGA AI Seedance 2.0 模式参数显示配置
 * 独立配置，与 TOPAIS Seedance 完全隔离
 * 固定720p，不显示分辨率选择
 */
export function getMegaAiSeedanceModeParams(mode: string) {
  return {
    showRatio: true,               // 所有模式都支持比例选择
    showDuration: true,            // 所有模式都支持时长选择
    showResolution: false,         // 固定720p，不显示分辨率选择！
    promptRequired: mode === 't2v',  // t2v 必须有提示词，其他可选
    showImageUpload: mode !== 't2v',
    showFirstFrameUpload: mode === 'i2v-first-frame' || mode === 'i2v-first-last-frame',
    showLastFrameUpload: mode === 'i2v-first-last-frame',
    showRefImageUpload: mode === 'r2v',
    showVideoUpload: mode !== 't2v',
    showAudioUpload: mode !== 't2v',  // t2v 不支持音频！
  };
}

// ============================================================
// TOPAIS MiniMax H3 独立配置（与 MEGA AI Seedance 完全独立！）
// - 模型名: MiniMax-H3 (model_id: topais-minimax-h3)
// - 分辨率: 2K / 768p（可选）
// - 支持 t2v / i2v-first-frame / i2v-first-last-frame / r2v 四模式
// - 支持参考视频(最多3段)和参考音频(最多3段)
// - 比例规则（官方文档）:
//   - t2v: 21:9/16:9/4:3/1:1/3:4/9:16，默认16:9，不能用adaptive
//   - i2v-first-frame / i2v-first-last-frame: 比例被忽略，始终按输入图片自适应
//   - r2v: 默认adaptive，也可指定具体比例
// ============================================================

/**
 * TOPAIS MiniMax H3 模式配置（独立供应商）
 */
export const TOPAIS_MINIMAX_MODE_CONFIG: Record<string, {
  label: string;
  shortLabel: string;
  description: string;
}> = {
  't2v': {
    label: '文生视频',
    shortLabel: '文生视频',
    description: '纯文本描述生成视频',
  },
  'i2v-first-frame': {
    label: '图生视频-首帧',
    shortLabel: '首帧',
    description: '上传1张图片作为视频首帧，AI让图片动起来',
  },
  'i2v-first-last-frame': {
    label: '图生视频-首尾帧',
    shortLabel: '首尾帧',
    description: '上传首帧和尾帧图片，AI生成过渡动画',
  },
  'r2v': {
    label: '参考生视频',
    shortLabel: '参考生视频',
    description: '1~9张参考图+可选视频/音频，多模态生成',
  },
};

/**
 * TOPAIS MiniMax H3 模式素材槽位配置
 * 独立配置，与所有其他供应商完全隔离
 */
export function getTopaisMinimaxSlotStatus(mode: string): {
  firstFrame: { enabled: boolean; max: number };
  lastFrame: { enabled: boolean; max: number };
  refImage: { enabled: boolean; max: number };
  refVideo: { enabled: boolean; max: number };
  refAudio: { enabled: boolean; max: number };
} {
  const constraints: Record<string, {
    firstFrame: number; lastFrame: number; refImage: number; refVideo: number; refAudio: number;
  }> = {
    't2v': { firstFrame: 0, lastFrame: 0, refImage: 0, refVideo: 0, refAudio: 0 },
    'i2v-first-frame': { firstFrame: 1, lastFrame: 0, refImage: 0, refVideo: 3, refAudio: 3 },
    'i2v-first-last-frame': { firstFrame: 1, lastFrame: 1, refImage: 0, refVideo: 3, refAudio: 3 },
    'r2v': { firstFrame: 0, lastFrame: 0, refImage: 9, refVideo: 3, refAudio: 3 },
  };
  const c = constraints[mode] || constraints['t2v'];
  return {
    firstFrame: { enabled: c.firstFrame > 0, max: c.firstFrame },
    lastFrame: { enabled: c.lastFrame > 0, max: c.lastFrame },
    refImage: { enabled: c.refImage > 0, max: c.refImage },
    refVideo: { enabled: c.refVideo > 0, max: c.refVideo },
    refAudio: { enabled: c.refAudio > 0, max: c.refAudio },
  };
}

/**
 * TOPAIS MiniMax H3 模式参数显示配置
 * 独立配置，与所有其他供应商完全隔离
 * 
 * 比例规则（官方文档）:
 * - t2v: 支持比例选择，adaptive 变灰不可选
 * - i2v-first-frame / i2v-first-last-frame: 固定 adaptive（其他比例变灰不可选）
 * - r2v: 支持比例选择（含adaptive，全部可选）
 */
export function getTopaisMinimaxModeParams(mode: string) {
  // 所有模式都显示比例选择器（i2v模式比例被API忽略，但UI上固定adaptive+其他变灰）
  return {
    showRatio: true,               // 所有模式都显示比例选择器
    showDuration: true,            // 所有模式都支持时长选择（4-15秒）
    showResolution: true,          // 支持2K/768p两种分辨率
    promptRequired: mode === 't2v',  // t2v 必须有提示词，其他可选
    showImageUpload: mode !== 't2v',
    showFirstFrameUpload: mode === 'i2v-first-frame' || mode === 'i2v-first-last-frame',
    showLastFrameUpload: mode === 'i2v-first-last-frame',
    showRefImageUpload: mode === 'r2v',
    showVideoUpload: mode !== 't2v',
    showAudioUpload: mode !== 't2v',  // t2v 不支持音频！
  };
}

/**
 * TOPAIS Kling v3 Omni 模式配置（独立供应商）
 * - t2v: 文生视频（无素材，支持有声视频 audio 标志）
 * - i2v-first-frame: 图生视频-首帧（1张图片，image_list type=first_frame）
 * - i2v-first-last-frame: 图生视频-首尾帧（2张图片，first_frame + end_frame）
 * - r2v: 参考生视频（1~9张参考图 + 可选1段参考视频，video_list）
 * 
 * 官方文档: https://docs.toapis.com/llms.txt
 * 特性:
 * - audio=true 生成有声视频，与 video_list 互斥
 * - mode=std 对应 720P，mode=pro 对应 1080P
 * - duration: 3~15秒
 * - aspect_ratio: 16:9, 9:16, 1:1
 * - Omni 引用语法: <<<image_N>>>, <<<video_N>>>, <<<element_N>>>
 */
export const KLING_OMNI_MODE_CONFIG: Record<string, {
  label: string;
  shortLabel: string;
  description: string;
}> = {
  't2v': {
    label: '文生视频',
    shortLabel: '文生视频',
    description: '纯文本描述生成视频，支持有声视频',
  },
  'i2v-first-frame': {
    label: '图生视频-首帧',
    shortLabel: '首帧',
    description: '上传1张图片作为视频首帧，AI让图片动起来',
  },
  'i2v-first-last-frame': {
    label: '图生视频-首尾帧',
    shortLabel: '首尾帧',
    description: '上传首帧和尾帧图片，AI生成过渡动画',
  },
  'r2v': {
    label: '参考生视频',
    shortLabel: '参考生视频',
    description: '1~9张参考图+可选1段参考视频，多模态生成',
  },
};

/**
 * TOPAIS Kling v3 Omni 模式素材槽位配置
 * 独立配置，与所有其他供应商完全隔离
 * 
 * 特殊: 不支持音频上传（audio 是生成标志，不是素材上传）
 * r2v 模式支持最多1段参考视频（video_list max 1）
 */
export function getTopaisKlingOmniSlotStatus(mode: string): {
  firstFrame: { enabled: boolean; max: number };
  lastFrame: { enabled: boolean; max: number };
  refImage: { enabled: boolean; max: number };
  refVideo: { enabled: boolean; max: number };
  refAudio: { enabled: boolean; max: number };
} {
  const constraints: Record<string, {
    firstFrame: number; lastFrame: number; refImage: number; refVideo: number; refAudio: number;
  }> = {
    't2v': { firstFrame: 0, lastFrame: 0, refImage: 0, refVideo: 0, refAudio: 0 },
    'i2v-first-frame': { firstFrame: 1, lastFrame: 0, refImage: 0, refVideo: 0, refAudio: 0 },
    'i2v-first-last-frame': { firstFrame: 1, lastFrame: 1, refImage: 0, refVideo: 0, refAudio: 0 },
    'r2v': { firstFrame: 0, lastFrame: 0, refImage: 9, refVideo: 1, refAudio: 0 },
  };
  const c = constraints[mode] || constraints['t2v'];
  return {
    firstFrame: { enabled: c.firstFrame > 0, max: c.firstFrame },
    lastFrame: { enabled: c.lastFrame > 0, max: c.lastFrame },
    refImage: { enabled: c.refImage > 0, max: c.refImage },
    refVideo: { enabled: c.refVideo > 0, max: c.refVideo },
    refAudio: { enabled: c.refAudio > 0, max: c.refAudio },
  };
}

/**
 * TOPAIS Kling v3 Omni 模式参数显示配置
 * 独立配置，与所有其他供应商完全隔离
 * 
 * 比例规则（官方文档）:
 * - 所有模式支持: 16:9, 9:16, 1:1（无 adaptive）
 * 
 * 分辨率规则:
 * - std = 720P, pro = 1080P
 * 
 * 时长规则:
 * - 3~15秒（整数）
 * 
 * 有声视频:
 * - generateAudio 标志映射到 API audio 参数
 * - audio 与 video_list 互斥（r2v 有视频时禁用 audio）
 */
export function getTopaisKlingOmniModeParams(mode: string) {
  return {
    showRatio: true,               // 所有模式都显示比例选择器（16:9, 9:16, 1:1）
    showDuration: true,            // 所有模式都支持时长选择（3-15秒）
    showResolution: true,          // 支持 720P/1080P 两种分辨率
    promptRequired: mode === 't2v',  // t2v 必须有提示词，其他可选
    showImageUpload: mode !== 't2v',
    showFirstFrameUpload: mode === 'i2v-first-frame' || mode === 'i2v-first-last-frame',
    showLastFrameUpload: mode === 'i2v-first-last-frame',
    showRefImageUpload: mode === 'r2v',
    showVideoUpload: mode === 'r2v',   // 仅 r2v 支持参考视频（video_list max 1）
    showAudioUpload: false,            // 不支持音频上传（audio 是生成标志）
    showGenerateAudio: true,           // 支持有声视频生成标志
  };
}

/**
 * 判断是否为 TOPAIS Kling v3 Omni 模型
 * 纯判断函数，三端共用，不包含任何业务逻辑
 */
export function isTopaisKlingOmniModel(model: string): boolean {
  return model.includes('topais-kling-omni');
}

/**
 * 官方文档规则:
 * - t2v: 所有比例显示，adaptive 变灰不可选
 * - i2v-first-frame / i2v-first-last-frame: adaptive 可选（自动选中），其他全部变灰
 * - r2v: 全部可选（含adaptive）
 */
export function getTopaisMinimaxRatioStates(
  mode: string,
  allRatios: string[]
): Array<{ ratio: string; disabled: boolean }> {
  if (mode === 'i2v-first-frame' || mode === 'i2v-first-last-frame') {
    // i2v: 固定adaptive，其他全部变灰
    return allRatios.map(r => ({ ratio: r, disabled: r !== 'adaptive' }));
  }
  if (mode === 't2v') {
    // t2v: adaptive 变灰不可选，其他正常
    return allRatios.map(r => ({ ratio: r, disabled: r === 'adaptive' }));
  }
  // r2v: 全部正常可选
  return allRatios.map(r => ({ ratio: r, disabled: false }));
}

/**
 * 比例名称显示映射：adaptive → 自动（用户看不懂英文）
 */
export function formatRatioLabel(ratio: string): string {
  return ratio === 'adaptive' ? '自动' : ratio;
}

// ============================================================
// LingYa Veo3.1 独立配置（与 TOPAIS Veo 完全独立！）
// ============================================================

export const LINGYA_VEO_MODE_CONFIG: Record<string, {
  label: string;
  shortLabel: string;
  description: string;
}> = {
  't2v': {
    label: '文生视频',
    shortLabel: '文生视频',
    description: '纯文本生成8秒视频',
  },
  'i2v': {
    label: '首帧生视频',
    shortLabel: '首帧',
    description: '上传1张图片作为首帧',
  },
  'r2v': {
    label: '首尾帧生视频',
    shortLabel: '首尾帧',
    description: '上传1-2张图片作为首尾帧',
  },
};

/**
 * LingYa Veo3.1 模式素材槽位配置
 */
export function getLingyaVeoSlotStatus(mode: string): {
  image: { enabled: boolean; max: number };
} {
  const constraints: Record<string, { image: number }> = {
    't2v': { image: 0 },
    'i2v': { image: 1 },   // 1张首帧
    'r2v': { image: 2 },   // 1-2张首尾帧
  };
  const c = constraints[mode] || constraints['t2v'];
  return {
    image: { enabled: c.image > 0, max: c.image },
  };
}

/**
 * LingYa Veo3.1 模式参数显示配置
 */
export function getLingyaVeoModeParams(mode: string) {
  return {
    showRatio: true,
    showDuration: true,
    fixedDuration: 8,       // LingYa Veo3.1 固定8秒
    durationOptions: [8],
    promptRequired: mode === 't2v',
    showImageUpload: mode !== 't2v',
  };
}

// ============================================================
// LingYa Sora-2 VIP 独立配置（与 T8 Sora-2 完全独立！）
// ============================================================

export const LINGYA_SORA_MODE_CONFIG: Record<string, {
  label: string;
  shortLabel: string;
  description: string;
}> = {
  't2v': {
    label: '文生视频',
    shortLabel: '文生视频',
    description: '纯文本生成视频',
  },
  'i2v': {
    label: '图生视频',
    shortLabel: '图生视频',
    description: '上传1张首帧图片生成视频',
  },
  'r2v': {
    label: '参考生视频',
    shortLabel: '参考生视频',
    description: '上传1-2张参考图生成视频',
  },
};

/**
 * LingYa Sora-2 VIP 模式素材槽位配置
 */
export function getLingyaSoraSlotStatus(mode: string): {
  image: { enabled: boolean; max: number };
} {
  const constraints: Record<string, { image: number }> = {
    't2v': { image: 0 },
    'i2v': { image: 1 },
    'r2v': { image: 2 },
  };
  const c = constraints[mode] || constraints['t2v'];
  return {
    image: { enabled: c.image > 0, max: c.image },
  };
}

/**
 * LingYa Sora-2 VIP 模式参数显示配置
 */
export function getLingyaSoraModeParams(mode: string) {
  return {
    showRatio: true,
    showDuration: true,
    promptRequired: mode === 't2v',
    showImageUpload: mode !== 't2v',
  };
}

/**
 * 判断是否为 LingYa Veo3.1 模型（独立性：只识别 veo_3_1 格式，不与 TOPAIS veo3.1 混淆）
 */
export function isLingyaVeoModel(model: string): boolean {
  return model.startsWith('veo_3_');  // LingYa 格式: veo_3_1-fast, veo_3_1, veo_3_1-fast-4k, veo_3_1-4k
}

/**
 * 判断是否为 LingYa Sora-2 VIP 模型
 */
export function isLingyaSoraModel(model: string): boolean {
  return model.startsWith('sora-2-all-vip');
}

/**
 * 判断模型类型
 */
export function getModelType(model: string): ModelType {
  if (model === 'seedance-2' || model === 'seedance-2-fast') return 'seedance2';
  if (model.startsWith('sdols')) return 't8seedance';
  if (model.startsWith('veo_3_')) return 'lingya-veo';  // LingYa Veo3.1（独立性：veo_3_1 格式，必须先于 TOPAIS 判断）
  if (model.startsWith('sora-2-all-vip')) return 'lingya-sora';  // LingYa Sora-2 VIP（独立性：必须先于默认判断）
  if (model.startsWith('happyhorse') && !model.includes('topais')) return 'happyhorse';  // #691 排除 TOPAIS HappyHorse
  if (model.includes('topais-happyhorse')) return 'topais-happyhorse';  // #691 TOPAIS HappyHorse
  if (model.includes('mega-ai-seedance')) return 'mega-ai-seedance';  // MEGA AI Seedance 2.0
  if (model.includes('topais-minimax')) return 'topais-minimax';  // TOPAIS MiniMax H3
  if (model.includes('veo3') || model.includes('veo-3') || model === 'veo3.1-fast') return 'topais';  // #689 TOPAIS Veo
  return 'happyhorse'; // 默认
}

/**
 * 判断是否为 Seedance 2.0 模型
 */
export function isSeedance2Model(model: string): boolean {
  return model === 'seedance-2' || model === 'seedance-2-fast';
}

/**
 * 判断是否为 T8 Seedance 1.0 模型（sdols 开头）
 */
export function isT8SeedanceModel(model: string): boolean {
  return model.startsWith('sdols');
}

/**
 * #689 判断是否为 TOPAIS Veo 模型
 */
export function isTopaisVeoModel(model: string): boolean {
  return model.includes('veo3') || model.includes('veo-3') || model === 'veo3.1-fast';
}

/**
 * #691 判断是否为 TOPAIS HappyHorse 模型
 */
export function isTopaisHhModel(model: string): boolean {
  return model.includes('topais-happyhorse');
}

/**
 * 判断是否为 TOPAIS Seedance 2.0 模型
 */
export function isTopaisSeedanceModel(model: string): boolean {
  return model.includes('topais-seedance');
}

/**
 * 判断是否为 TOPAIS Gemini Omni Flash 模型
 */
export function isTopaisGeminiOmniModel(model: string): boolean {
  return model.includes('topais-gemini-omni');
}

/**
 * 判断是否为 MEGA AI Seedance 2.0 模型
 * 独立判断，与所有其他供应商完全隔离
 */
export function isMegaAiSeedanceModel(model: string): boolean {
  return model.includes('mega-ai-seedance');
}

/**
 * 判断是否为 TOPAIS MiniMax H3 模型
 * 独立判断，与所有其他供应商完全隔离
 */
export function isTopaisMinimaxModel(model: string): boolean {
  return model.includes('topais-minimax');
}

/**
 * 根据 HappyHorse 模式判断需要显示哪些参数
 * 用于三端统一的参数面板渲染
 */
export function getHappyHorseModeParams(mode: VideoModelMode) {
  return {
    showRatio: mode === 't2v' || mode === 'r2v' || mode === 'i2v-first-frame' || mode === 'i2v-first-last-frame',
    showDuration: mode !== 'video-edit',
    promptRequired: mode !== 'i2v' && mode !== 'i2v-first-frame' && mode !== 'i2v-first-last-frame',
    showAudioSetting: mode === 'video-edit',
    showImageUpload: mode === 'i2v' || mode === 'r2v' || mode === 'i2v-first-frame' || mode === 'i2v-first-last-frame',
    showVideoUpload: mode === 'video-edit',
    autoRatio: mode === 'i2v' || mode === 'video-edit' || mode === 'i2v-first-frame' || mode === 'i2v-first-last-frame',
  };
}

/**
 * #641 获取 HappyHorse 各模式的最大参考图数量
 * - t2v: 0（纯文本）
 * - i2v: 1（首帧图片）
 * - r2v: 9（角色特征参考）
 * - video-edit: 5（编辑参考图）
 */
export function getHappyHorseMaxRefImages(mode: VideoModelMode): number {
  switch (mode) {
    case 't2v': return 0;
    case 'i2v': return 1;
    case 'r2v': return 9;
    case 'video-edit': return 5;
    default: return 0;
  }
}

/**
 * 三端样式变体
 * - video-page: 视频生成页
 * - canvas-panel: 画布节点面板
 * - dialog: 对话框右侧面板
 */
export type ModeSwitcherVariant = 'video-page' | 'canvas-panel' | 'dialog';

interface ModelModeSwitcherProps {
  /** 已连接的图片URL列表 */
  inputImageUrls: string[];
  /** 已连接的视频URL */
  inputVideoUrl: string | null;
  /** 用户手动覆盖的模式 */
  overrideMode: VideoModelMode | null;
  /** 设置用户覆盖模式 */
  setOverrideMode: (mode: VideoModelMode | null) => void;
  /** 最终模式变化回调 */
  onModeChange: (mode: VideoModelMode) => void;
  /** 音频设置回调（video-edit模式） */
  audioSetting?: 'auto' | 'origin';
  onAudioSettingChange?: (setting: 'auto' | 'origin') => void;
  /** #662 生成有声视频开关（Seedance 模型） */
  generateAudio?: boolean;
  onGenerateAudioChange?: (enabled: boolean) => void;
  /** 禁用状态 */
  disabled?: boolean;
  /** 样式变体 */
  variant?: ModeSwitcherVariant;
  /** #642 模型类型：happyhorse / seedance2 / t8seedance */
  modelType?: ModelType;
}

// ========== 共享逻辑 Hook ==========
function useModeLogic(
  inputImageUrls: string[],
  inputVideoUrl: string | null,
  overrideMode: VideoModelMode | null,
  setOverrideMode: (mode: VideoModelMode | null) => void,
  onModeChange: (mode: VideoModelMode) => void,
  modelType: ModelType = 'happyhorse',
) {
  const isSeedance2 = modelType === 'seedance2';
  const isT8Seedance = modelType === 't8seedance';
  const isTopais = modelType === 'topais';  // #689 TOPAIS Veo3.1-fast
  const isTopaisHh = modelType === 'topais-happyhorse';  // #691 TOPAIS HappyHorse
  const isTopaisSeedance = modelType === 'topais-seedance';  // TOPAIS Seedance 2.0
  const isMegaAiSeedance = modelType === 'mega-ai-seedance';  // MEGA AI Seedance 2.0
  const isLingyaVeo = modelType === 'lingya-veo';  // LingYa Veo3.1
  const isLingyaSora = modelType === 'lingya-sora';  // LingYa Sora-2 VIP
  const isTopaisGeminiOmni = modelType === 'topais-gemini-omni';  // TOPAIS Gemini Omni Flash
  const isTopaisMinimax = modelType === 'topais-minimax';  // TOPAIS MiniMax-H3
  const isTopaisKlingOmni = modelType === 'topais-kling-omni';  // TOPAIS Kling v3 Omni

  // #680 修复：Seedance r2v 阈值从3降为2，2+图即进入参考生视频模式
  // #689 TOPAIS Veo: 0张→t2v，1-2张→i2v（首尾帧），3张→r2v（参考图）
  // #691 TOPAIS HappyHorse: 0张→t2v，1张→i2v，2+张→r2v，有视频→video-edit
  // TOPAIS Gemini Omni Flash: 0张→t2v，1张→i2v，3张→r2v（不支持2张、不支持video-edit）
  const inferBaseMode = useCallback((): HappyHorseMode | Seedance2Mode | TopaisHhMode | TopaisGeminiOmniMode => {
    if (isTopaisGeminiOmni) {
      // TOPAIS Gemini Omni Flash 模式推断（独立性：与 HappyHorse 完全独立）
      if (inputImageUrls.length >= 3) return 'r2v';  // 3张 → 参考图融合
      if (inputImageUrls.length >= 1) return 'i2v';  // 1张 → 图生视频
      return 't2v';  // 0张 → 文生视频
    } else if (isTopaisHh) {
      // #691 TOPAIS HappyHorse 1.1 模式推断
      if (inputVideoUrl) return 'video-edit';  // 有视频 → 视频编辑
      if (inputImageUrls.length >= 2) return 'r2v';  // 2+张 → 参考图生视频
      if (inputImageUrls.length >= 1) return 'i2v';  // 1张 → 图生视频
      return 't2v';  // 0张 → 文生视频
    } else if (isTopais) {
      // #689 TOPAIS Veo3.1-fast 模式推断
      if (inputImageUrls.length >= 3) return 'r2v';  // 3张 → 参考图生视频
      if (inputImageUrls.length >= 1) return 'i2v';  // 1-2张 → 首尾帧生视频
      return 't2v';  // 0张 → 文生视频
    } else if (isLingyaVeo) {
      // LingYa Veo3.1: 0张→t2v，1张→i2v首帧，2张→r2v首尾帧
      if (inputImageUrls.length >= 2) return 'r2v';
      if (inputImageUrls.length >= 1) return 'i2v';
      return 't2v';
    } else if (isLingyaSora) {
      // LingYa Sora-2 VIP: 0张→t2v，1张→i2v首帧，2张→r2v
      if (inputImageUrls.length >= 2) return 'r2v';
      if (inputImageUrls.length >= 1) return 'i2v';
      return 't2v';
    } else if (isTopaisSeedance) {
      // TOPAIS Seedance 2.0: 与 LingYa Seedance 2.0 对齐
      if (inputVideoUrl) return 'r2v'; // 有视频 → 参考生视频
      if (inputImageUrls.length >= 2) return 'r2v'; // 2+图 → 参考生视频
      if (inputImageUrls.length === 1) return 'i2v-first-frame'; // 1图 → 首帧
      return 't2v';
    } else if (isMegaAiSeedance) {
      // MEGA AI Seedance 2.0: 与 TOPAIS Seedance 对齐（独立分支）
      if (inputVideoUrl) return 'r2v'; // 有视频 → 参考生视频
      if (inputImageUrls.length >= 2) return 'r2v'; // 2+图 → 参考生视频
      if (inputImageUrls.length === 1) return 'i2v-first-frame'; // 1图 → 首帧
      return 't2v';
    } else if (isTopaisMinimax) {
      // TOPAIS MiniMax-H3: 与 MegaAI Seedance 对齐（t2v/i2v-first-frame/r2v）
      if (inputVideoUrl) return 'r2v'; // 有视频 → 参考生视频
      if (inputImageUrls.length >= 2) return 'r2v'; // 2+图 → 参考生视频
      if (inputImageUrls.length === 1) return 'i2v-first-frame'; // 1图 → 首帧
      return 't2v';
    } else if (isTopaisKlingOmni) {
      // TOPAIS Kling v3 Omni: 独立模式推断（独立性：与所有其他供应商完全独立）
      // t2v → i2v-first-frame → i2v-first-last-frame → r2v
      if (inputVideoUrl) return 'r2v'; // 有视频 → 参考生视频（video_list）
      if (inputImageUrls.length >= 3) return 'r2v'; // 3+图 → 参考生视频（多图引用）
      if (inputImageUrls.length === 2) return 'i2v-first-last-frame'; // 2图 → 首尾帧
      if (inputImageUrls.length === 1) return 'i2v-first-frame'; // 1图 → 首帧
      return 't2v';
    } else if (isSeedance2) {
      // Seedance 2.0: 根据素材推断（注意：这是自动推断，用户可以覆盖）
      if (inputVideoUrl) return 'r2v'; // 有视频 → 参考生视频
      if (inputImageUrls.length >= 2) return 'r2v'; // 2+图 → 参考生视频（与 HappyHorse 对齐）
      if (inputImageUrls.length === 1) return 'i2v-first-frame'; // 1图 → 首帧
      return 't2v';
    } else if (isT8Seedance) {
      // #667 T8 sdols-2.0 全模态解锁：与 LingYa Seedance 2.0 对齐
      if (inputVideoUrl) return 'r2v';
      if (inputImageUrls.length >= 2) return 'r2v'; // 2+图 → 参考生视频
      if (inputImageUrls.length === 1) return 'i2v-first-frame'; // 1图 → 首帧
      return 't2v';
    } else {
      // HappyHorse: 原有逻辑
      if (inputVideoUrl) return 'video-edit';
      if (inputImageUrls.length >= 2) return 'r2v';
      if (inputImageUrls.length === 1) return 'i2v';
      return 't2v';
    }
  }, [inputVideoUrl, inputImageUrls, isSeedance2, isT8Seedance, isTopais, isTopaisHh, isTopaisSeedance, isMegaAiSeedance, isTopaisGeminiOmni, isTopaisMinimax, isTopaisKlingOmni, isLingyaVeo, isLingyaSora]);

  const baseMode = inferBaseMode();
  const displayMode = overrideMode || baseMode;

  // 获取对应的配置（独立性：每个模型必须有独立分支）
  // #865 修复：当 displayMode 不匹配当前模型的 config 时（如从其他模型切换过来 overrideMode 残留），使用第一个 config 作为兜底
  const _rawConfig = isTopaisGeminiOmni
    ? TOPAIS_GEMINI_OMNI_MODE_CONFIG[displayMode as string]  // TOPAIS Gemini Omni Flash
    : isTopaisMinimax
      ? TOPAIS_MINIMAX_MODE_CONFIG[displayMode as string]  // TOPAIS MiniMax-H3
      : isTopaisKlingOmni
        ? KLING_OMNI_MODE_CONFIG[displayMode as string]  // TOPAIS Kling v3 Omni
        : isMegaAiSeedance
        ? MEGA_AI_SEEDANCE_MODE_CONFIG[displayMode as string]  // MEGA AI Seedance 2.0
        : isTopaisHh
        ? TOPAIS_HH_MODE_CONFIG[displayMode as string]  // #691 TOPAIS HappyHorse
        : isTopaisSeedance
          ? TOPAIS_SEEDANCE_MODE_CONFIG[displayMode as string]  // TOPAIS Seedance 2.0
          : isTopais
            ? TOPAIS_MODE_CONFIG[displayMode as string]  // #689 TOPAIS Veo
            : isLingyaVeo
              ? LINGYA_VEO_MODE_CONFIG[displayMode as string]  // LingYa Veo3.1
              : isLingyaSora
                ? LINGYA_SORA_MODE_CONFIG[displayMode as string]  // LingYa Sora-2 VIP
                : isSeedance2
                  ? SEEDANCE2_MODE_CONFIG[displayMode as Seedance2Mode]
                  : isT8Seedance
                    ? T8SEEDANCE_MODE_CONFIG[displayMode as string]
                    : HAPPYHORSE_MODE_CONFIG[displayMode as HappyHorseMode];

  // 兜底：如果 config 为 undefined（overrideMode 残留了其他模型的模式），取该模型 config 的第一个值
  const config = _rawConfig ?? (
    isTopaisGeminiOmni ? Object.values(TOPAIS_GEMINI_OMNI_MODE_CONFIG)[0]
    : isTopaisMinimax ? Object.values(TOPAIS_MINIMAX_MODE_CONFIG)[0]
    : isTopaisKlingOmni ? Object.values(KLING_OMNI_MODE_CONFIG)[0]
    : isMegaAiSeedance ? Object.values(MEGA_AI_SEEDANCE_MODE_CONFIG)[0]
    : isTopaisHh ? Object.values(TOPAIS_HH_MODE_CONFIG)[0]
    : isTopaisSeedance ? Object.values(TOPAIS_SEEDANCE_MODE_CONFIG)[0]
    : isTopais ? Object.values(TOPAIS_MODE_CONFIG)[0]
    : isLingyaVeo ? Object.values(LINGYA_VEO_MODE_CONFIG)[0]
    : isLingyaSora ? Object.values(LINGYA_SORA_MODE_CONFIG)[0]
    : isSeedance2 ? Object.values(SEEDANCE2_MODE_CONFIG)[0]
    : isT8Seedance ? Object.values(T8SEEDANCE_MODE_CONFIG)[0]
    : Object.values(HAPPYHORSE_MODE_CONFIG)[0]
  );

  // 是否显示音频设置
  const showAudioSetting = isTopaisHh
    ? displayMode === 'video-edit'  // #691 TOPAIS HappyHorse video-edit 支持音频设置
    : !isSeedance2 && !isT8Seedance && !isTopais && !isTopaisSeedance && !isMegaAiSeedance && !isTopaisGeminiOmni && !isTopaisMinimax && !isTopaisKlingOmni && !isLingyaVeo && !isLingyaSora && displayMode === 'video-edit';

  // 连线变化时重置覆盖模式
  useEffect(() => {
    if (!isSeedance2 && !isT8Seedance && !isTopais && !isTopaisHh && !isTopaisSeedance && !isMegaAiSeedance && !isTopaisGeminiOmni && !isTopaisMinimax && !isTopaisKlingOmni && !inputVideoUrl && overrideMode === 'video-edit') {
      setOverrideMode(null);
    }
  }, [inputVideoUrl, overrideMode, setOverrideMode, isSeedance2, isT8Seedance, isTopais, isTopaisHh, isTopaisSeedance, isMegaAiSeedance, isTopaisGeminiOmni, isTopaisMinimax, isTopaisKlingOmni]);

  // 模式变化通知
  useEffect(() => {
    onModeChange(displayMode);
  }, [displayMode, onModeChange]);

  const handleModeSwitch = (mode: VideoModelMode) => {
    if (isTopaisGeminiOmni) {
      // TOPAIS Gemini Omni Flash: 素材可用性判断（独立性：与 HappyHorse 完全独立）
      const isAvailable =
        (mode === 't2v') ||
        (mode === 'i2v' && inputImageUrls.length >= 1) ||
        (mode === 'r2v' && inputImageUrls.length >= 1);  // r2v需要至少1张（目标3张）
      if (!isAvailable) return;
    } else if (isTopaisHh) {
      // #691 TOPAIS HappyHorse: 素材可用性判断
      const isAvailable =
        (mode === 't2v') ||
        (mode === 'i2v' && inputImageUrls.length >= 1) ||
        (mode === 'r2v' && inputImageUrls.length >= 1) ||
        (mode === 'video-edit' && !!inputVideoUrl);
      if (!isAvailable) return;
    } else if (isTopais) {
      // #689 TOPAIS Veo: 素材可用性判断（i2v需1-2张，r2v需1-3张）
      const isAvailable =
        (mode === 't2v') ||
        (mode === 'i2v' && inputImageUrls.length >= 1 && inputImageUrls.length <= 2) ||
        (mode === 'r2v' && inputImageUrls.length >= 1 && inputImageUrls.length <= 3);
      if (!isAvailable) return;
    } else if (isSeedance2) {
      // Seedance 2.0: 素材可用性判断
      const isAvailable =
        (mode === 't2v') ||
        (mode === 'i2v-first-frame' && inputImageUrls.length >= 1) ||
        (mode === 'i2v-first-last-frame' && inputImageUrls.length >= 2) ||
        (mode === 'r2v' && (inputImageUrls.length >= 1 || !!inputVideoUrl));
      if (!isAvailable) return;
    } else if (isTopaisSeedance) {
      // TOPAIS Seedance 2.0: 与 Seedance 2.0 对齐
      const sMode = mode as Seedance2Mode;
      const isAvailable =
        (sMode === 't2v') ||
        (sMode === 'i2v-first-frame' && inputImageUrls.length >= 1) ||
        (sMode === 'i2v-first-last-frame' && inputImageUrls.length >= 2) ||
        (sMode === 'r2v' && (inputImageUrls.length >= 1 || !!inputVideoUrl));
      if (!isAvailable) return;
    } else if (isMegaAiSeedance) {
      // MEGA AI Seedance 2.0: 与 TOPAIS Seedance 对齐（独立分支）
      const sMode = mode as Seedance2Mode;
      const isAvailable =
        (sMode === 't2v') ||
        (sMode === 'i2v-first-frame' && inputImageUrls.length >= 1) ||
        (sMode === 'i2v-first-last-frame' && inputImageUrls.length >= 2) ||
        (sMode === 'r2v' && (inputImageUrls.length >= 1 || !!inputVideoUrl));
      if (!isAvailable) return;
    } else if (isTopaisMinimax) {
      // TOPAIS MiniMax-H3: 与 MegaAI Seedance 对齐（独立分支）
      const sMode = mode as Seedance2Mode;
      const isAvailable =
        (sMode === 't2v') ||
        (sMode === 'i2v-first-frame' && inputImageUrls.length >= 1) ||
        (sMode === 'i2v-first-last-frame' && inputImageUrls.length >= 2) ||
        (sMode === 'r2v' && (inputImageUrls.length >= 1 || !!inputVideoUrl));
      if (!isAvailable) return;
    } else if (isTopaisKlingOmni) {
      // TOPAIS Kling v3 Omni: 独立分支（独立性铁律）
      const sMode = mode as Seedance2Mode;
      const isAvailable =
        (sMode === 't2v') ||
        (sMode === 'i2v-first-frame' && inputImageUrls.length >= 1) ||
        (sMode === 'i2v-first-last-frame' && inputImageUrls.length >= 2) ||
        (sMode === 'r2v' && (inputImageUrls.length >= 1 || !!inputVideoUrl));
      if (!isAvailable) return;
    } else if (isT8Seedance) {
      // #667 T8 sdols-2.0 全模态解锁：与 LingYa Seedance 2.0 对齐
      const sMode = mode as Seedance2Mode;
      const isAvailable =
        (sMode === 't2v') ||
        (sMode === 'i2v-first-frame' && inputImageUrls.length >= 1) ||
        (sMode === 'i2v-first-last-frame' && inputImageUrls.length >= 2) ||
        (sMode === 'r2v' && (inputImageUrls.length >= 1 || !!inputVideoUrl));
      if (!isAvailable) return;
    } else {
      // HappyHorse: 原有逻辑
      const isAvailable =
        (mode === 't2v') ||
        (mode === 'i2v' && inputImageUrls.length >= 1) ||
        (mode === 'r2v' && inputImageUrls.length >= 1) ||
        (mode === 'video-edit' && !!inputVideoUrl);
      if (!isAvailable) return;
    }

    if (mode === baseMode) {
      setOverrideMode(null);
    } else {
      setOverrideMode(mode);
    }
  };

  // 各输入类型的可用状态
  // #667 T8 sdols-2.0 全模态解锁：与 LingYa Seedance 2.0 对齐
  // #689 TOPAIS Veo: i2v 和 r2v 都使用图片，不使用视频
  // #691 TOPAIS HappyHorse: i2v/r2v 使用图片，video-edit 使用视频
  // TOPAIS Seedance 2.0: 与 LingYa Seedance 2.0 对齐
  // TOPAIS Gemini Omni Flash: i2v/r2v 使用图片，不支持视频输入
  const imageUsedInCurrentMode = isTopaisGeminiOmni
    ? (displayMode === 'i2v' || displayMode === 'r2v')  // TOPAIS Gemini Omni Flash
    : isTopaisHh
      ? (displayMode === 'i2v' || displayMode === 'r2v')  // #691 TOPAIS HappyHorse
      : isTopaisSeedance
        ? (displayMode === 'i2v-first-frame' || displayMode === 'i2v-first-last-frame' || displayMode === 'r2v')
        : isMegaAiSeedance
          ? (displayMode === 'i2v-first-frame' || displayMode === 'i2v-first-last-frame' || displayMode === 'r2v')  // MEGA AI Seedance 2.0
          : isTopaisKlingOmni
            ? (displayMode === 'i2v-first-frame' || displayMode === 'i2v-first-last-frame' || displayMode === 'r2v')  // TOPAIS Kling v3 Omni
            : isTopais
          ? (displayMode === 'i2v' || displayMode === 'r2v')  // #689 TOPAIS Veo
          : isSeedance2
            ? (displayMode === 'i2v-first-frame' || displayMode === 'i2v-first-last-frame' || displayMode === 'r2v')
            : isT8Seedance
              ? (displayMode === 'i2v-first-frame' || displayMode === 'i2v-first-last-frame' || displayMode === 'r2v')
              : (displayMode === 'i2v' || displayMode === 'r2v' || (displayMode === 'video-edit' && inputImageUrls.length > 0));
  const videoUsedInCurrentMode = isTopaisGeminiOmni
    ? false  // TOPAIS Gemini Omni Flash 不支持视频输入
    : isTopaisHh
      ? displayMode === 'video-edit'  // #691 TOPAIS HappyHorse video-edit 使用视频
      : isTopaisSeedance
        ? (displayMode !== 't2v')  // TOPAIS Seedance 2.0: 除 t2v 外都使用视频
        : isMegaAiSeedance
          ? (displayMode !== 't2v')  // MEGA AI Seedance 2.0: 除 t2v 外都使用视频（独立分支）
          : isTopaisKlingOmni
            ? (displayMode === 'r2v')  // TOPAIS Kling v3 Omni: 仅 r2v 使用参考视频
            : isTopais
          ? false  // #689 TOPAIS Veo 不支持视频输入
          : isSeedance2
            ? (displayMode !== 't2v')
            : isT8Seedance
              ? (displayMode !== 't2v')  // #668 T8 对齐 Seedance2：除 t2v 外都使用视频
              : (displayMode === 'video-edit');

  return {
    baseMode,
    displayMode,
    config,
    showAudioSetting,
    handleModeSwitch,
    imageUsedInCurrentMode,
    videoUsedInCurrentMode,
  };
}

// ========== 共享下拉面板内容 ==========
function ModeDropdownContent({
  displayMode,
  inputImageUrls,
  inputVideoUrl,
  audioSetting,
  onAudioSettingChange,
  generateAudio,
  onGenerateAudioChange,
  handleModeSwitch,
  baseMode,
  showAudioSetting,
  onClose,
  variant,
  isDark,
  modelType = 'happyhorse',
}: {
  displayMode: HappyHorseMode | Seedance2Mode;
  inputImageUrls: string[];
  inputVideoUrl: string | null;
  audioSetting?: 'auto' | 'origin';
  onAudioSettingChange?: (setting: 'auto' | 'origin') => void;
  generateAudio?: boolean;
  onGenerateAudioChange?: (enabled: boolean) => void;
  handleModeSwitch: (mode: VideoModelMode) => void;
  baseMode: VideoModelMode;
  showAudioSetting: boolean;
  onClose: () => void;
  variant: ModeSwitcherVariant;
  isDark?: boolean;
  modelType?: ModelType;
}) {
  // 优先使用传入的 isDark；canvas-panel 始终暗色；其余跟随系统
  const dark = isDark ?? (variant === 'canvas-panel');
  const isSeedance2 = modelType === 'seedance2';
  const isT8Seedance = modelType === 't8seedance';
  const isTopais = modelType === 'topais';  // #689 TOPAIS Veo
  const isTopaisHh = modelType === 'topais-happyhorse';  // #691 TOPAIS HappyHorse
  const isTopaisSeedance = modelType === 'topais-seedance';  // TOPAIS Seedance 2.0
  const isMegaAiSeedance = modelType === 'mega-ai-seedance';  // MEGA AI Seedance 2.0
  const isTopaisGeminiOmni = modelType === 'topais-gemini-omni';  // TOPAIS Gemini Omni Flash
  const isTopaisMinimax = modelType === 'topais-minimax';  // TOPAIS MiniMax-H3
  const isTopaisKlingOmni = modelType === 'topais-kling-omni';  // TOPAIS Kling v3 Omni
  const isLingyaVeo = modelType === 'lingya-veo';  // LingYa Veo3.1
  const isLingyaSora = modelType === 'lingya-sora';  // LingYa Sora-2 VIP

  // 根据模型类型选择模式和配置
  // #667 T8 sdols-2.0 全模态解锁：与 LingYa Seedance 2.0 对齐
  // #689 TOPAIS Veo: t2v, i2v, r2v 三种模式
  // #691 TOPAIS HappyHorse: t2v, i2v, r2v, video-edit 四种模式
  // TOPAIS Gemini Omni Flash: t2v, i2v, r2v（无 video-edit）
  // TOPAIS MiniMax-H3: t2v, i2v-first-frame, i2v-first-last-frame, r2v
  // TOPAIS Kling v3 Omni: t2v, i2v-first-frame, i2v-first-last-frame, r2v
  // LingYa Veo3.1: t2v, i2v (首帧/首尾帧), r2v
  // LingYa Sora-2 VIP: t2v, i2v
  const modes = isTopaisGeminiOmni
    ? (['t2v', 'i2v', 'r2v'] as VideoModelMode[])  // TOPAIS Gemini Omni Flash
    : isTopaisMinimax
      ? (['t2v', 'i2v-first-frame', 'i2v-first-last-frame', 'r2v'] as VideoModelMode[])  // TOPAIS MiniMax-H3
      : isTopaisKlingOmni
        ? (['t2v', 'i2v-first-frame', 'i2v-first-last-frame', 'r2v'] as VideoModelMode[])  // TOPAIS Kling v3 Omni
        : isMegaAiSeedance
      ? (['t2v', 'i2v-first-frame', 'i2v-first-last-frame', 'r2v'] as VideoModelMode[])  // MEGA AI Seedance 2.0
      : isTopaisHh
      ? (['t2v', 'i2v', 'r2v', 'video-edit'] as VideoModelMode[])  // #691 TOPAIS HappyHorse
      : isTopaisSeedance
      ? (['t2v', 'i2v-first-frame', 'i2v-first-last-frame', 'r2v'] as VideoModelMode[])  // TOPAIS Seedance 2.0
      : isTopais
        ? (['t2v', 'i2v', 'r2v'] as VideoModelMode[])  // #689 TOPAIS Veo
        : isLingyaVeo
          ? (['t2v', 'i2v', 'r2v'] as VideoModelMode[])  // LingYa Veo3.1
          : isLingyaSora
            ? (['t2v', 'i2v'] as VideoModelMode[])  // LingYa Sora-2 VIP
            : isSeedance2
              ? (['t2v', 'i2v-first-frame', 'i2v-first-last-frame', 'r2v'] as VideoModelMode[])
              : isT8Seedance
                ? (['t2v', 'i2v-first-frame', 'i2v-first-last-frame', 'r2v'] as VideoModelMode[])
                : (['t2v', 'i2v', 'r2v', 'video-edit'] as VideoModelMode[]);

  return (
    <>
      {/* 模式列表 - 始终展示所有模式，无素材的禁用不可点击 */}
      <div style={{ padding: '4px 0' }}>
        {modes.map((mode) => {
          // #689 TOPAIS Veo 配置获取
          // #691 TOPAIS HappyHorse 配置获取
          // TOPAIS Gemini Omni Flash 配置获取
          const mConfig = isTopaisGeminiOmni
            ? TOPAIS_GEMINI_OMNI_MODE_CONFIG[mode as string]  // TOPAIS Gemini Omni Flash
            : isTopaisMinimax
              ? TOPAIS_MINIMAX_MODE_CONFIG[mode as string]  // TOPAIS MiniMax-H3
              : isTopaisKlingOmni
                ? KLING_OMNI_MODE_CONFIG[mode as string]  // TOPAIS Kling v3 Omni
                : isMegaAiSeedance
              ? MEGA_AI_SEEDANCE_MODE_CONFIG[mode as string]  // MEGA AI Seedance 2.0
              : isTopaisHh
              ? TOPAIS_HH_MODE_CONFIG[mode as string]  // #691 TOPAIS HappyHorse
              : isTopaisSeedance
              ? TOPAIS_SEEDANCE_MODE_CONFIG[mode as string]  // TOPAIS Seedance 2.0
              : isTopais
                ? TOPAIS_MODE_CONFIG[mode as string]  // #689 TOPAIS Veo
                : isLingyaVeo
                  ? LINGYA_VEO_MODE_CONFIG[mode as string]  // LingYa Veo3.1
                  : isLingyaSora
                    ? LINGYA_SORA_MODE_CONFIG[mode as string]  // LingYa Sora-2 VIP
                    : isSeedance2
                      ? SEEDANCE2_MODE_CONFIG[mode as Seedance2Mode]
                      : isT8Seedance
                        ? T8SEEDANCE_MODE_CONFIG[mode as string]
                        : HAPPYHORSE_MODE_CONFIG[mode as HappyHorseMode];
          const isActive = displayMode === mode;

          // 素材可用性判断
          let hasAssets = false;
          if (isTopaisGeminiOmni) {
            // TOPAIS Gemini Omni Flash: t2v无图，i2v需1张，r2v需1+张（目标3张）
            const tMode = mode as string;
            hasAssets =
              (tMode === 't2v') ||
              (tMode === 'i2v' && inputImageUrls.length >= 1) ||
              (tMode === 'r2v' && inputImageUrls.length >= 1);
          } else if (isTopaisHh) {
            // #691 TOPAIS HappyHorse: t2v无图，i2v需1张，r2v需1张，video-edit需视频
            const tMode = mode as string;
            hasAssets =
              (tMode === 't2v') ||
              (tMode === 'i2v' && inputImageUrls.length >= 1) ||
              (tMode === 'r2v' && inputImageUrls.length >= 1) ||
              (tMode === 'video-edit' && !!inputVideoUrl);
          } else if (isTopais) {
            // #689 TOPAIS Veo: t2v无图，i2v需1-2张，r2v需1-3张
            const tMode = mode as string;
            hasAssets =
              (tMode === 't2v') ||
              (tMode === 'i2v' && inputImageUrls.length >= 1 && inputImageUrls.length <= 2) ||
              (tMode === 'r2v' && inputImageUrls.length >= 1 && inputImageUrls.length <= 3);
          } else if (isLingyaVeo) {
            // LingYa Veo3.1: t2v无图，i2v需1张首帧，r2v需1-2张首尾帧
            const tMode = mode as string;
            hasAssets =
              (tMode === 't2v') ||
              (tMode === 'i2v' && inputImageUrls.length >= 1) ||
              (tMode === 'r2v' && inputImageUrls.length >= 1);
          } else if (isLingyaSora) {
            // LingYa Sora-2 VIP: t2v无图，i2v需1张首帧，r2v需1-2张
            const tMode = mode as string;
            hasAssets =
              (tMode === 't2v') ||
              (tMode === 'i2v' && inputImageUrls.length >= 1) ||
              (tMode === 'r2v' && inputImageUrls.length >= 1);
          } else if (isMegaAiSeedance) {
            // MEGA AI Seedance 2.0: 与 TOPAIS Seedance 对齐（独立分支）
            const sMode = mode as Seedance2Mode;
            hasAssets =
              (sMode === 't2v') ||
              (sMode === 'i2v-first-frame' && inputImageUrls.length >= 1) ||
              (sMode === 'i2v-first-last-frame' && inputImageUrls.length >= 2) ||
              (sMode === 'r2v' && (inputImageUrls.length >= 1 || !!inputVideoUrl));
          } else if (isTopaisMinimax) {
            // TOPAIS MiniMax-H3: 与 MegaAI Seedance 对齐（独立分支）
            const sMode = mode as Seedance2Mode;
            hasAssets =
              (sMode === 't2v') ||
              (sMode === 'i2v-first-frame' && inputImageUrls.length >= 1) ||
              (sMode === 'i2v-first-last-frame' && inputImageUrls.length >= 2) ||
              (sMode === 'r2v' && (inputImageUrls.length >= 1 || !!inputVideoUrl));
          } else if (isTopaisKlingOmni) {
            // TOPAIS Kling v3 Omni: 独立分支（独立性铁律）
            const sMode = mode as Seedance2Mode;
            hasAssets =
              (sMode === 't2v') ||
              (sMode === 'i2v-first-frame' && inputImageUrls.length >= 1) ||
              (sMode === 'i2v-first-last-frame' && inputImageUrls.length >= 2) ||
              (sMode === 'r2v' && (inputImageUrls.length >= 1 || !!inputVideoUrl));
          } else if (isTopaisSeedance) {
            // TOPAIS Seedance 2.0: 与 LingYa Seedance 2.0 对齐
            const sMode = mode as Seedance2Mode;
            hasAssets =
              (sMode === 't2v') ||
              (sMode === 'i2v-first-frame' && inputImageUrls.length >= 1) ||
              (sMode === 'i2v-first-last-frame' && inputImageUrls.length >= 2) ||
              (sMode === 'r2v' && (inputImageUrls.length >= 1 || !!inputVideoUrl));
          } else if (isSeedance2) {
            const sMode = mode as Seedance2Mode;
            hasAssets =
              (sMode === 't2v') ||
              (sMode === 'i2v-first-frame' && inputImageUrls.length >= 1) ||
              (sMode === 'i2v-first-last-frame' && inputImageUrls.length >= 2) ||
              (sMode === 'r2v' && (inputImageUrls.length >= 1 || !!inputVideoUrl));
          } else if (isT8Seedance) {
            // #667 T8 sdols-2.0 全模态解锁：与 LingYa Seedance 2.0 对齐
            const sMode = mode as Seedance2Mode;
            hasAssets =
              (sMode === 't2v') ||
              (sMode === 'i2v-first-frame' && inputImageUrls.length >= 1) ||
              (sMode === 'i2v-first-last-frame' && inputImageUrls.length >= 2) ||
              (sMode === 'r2v' && (inputImageUrls.length >= 1 || !!inputVideoUrl));
          } else {
            const hMode = mode as HappyHorseMode;
            hasAssets =
              (hMode === 't2v') ||
              (hMode === 'i2v' && inputImageUrls.length >= 1) ||
              (hMode === 'r2v' && inputImageUrls.length >= 1) ||
              (hMode === 'video-edit' && !!inputVideoUrl);
          }

          return (
            <button
              key={mode}
              onClick={() => { if (!hasAssets) return; handleModeSwitch(mode); onClose(); }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: isActive
                  ? (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)')
                  : 'transparent',
                border: 'none',
                cursor: hasAssets ? 'pointer' : 'not-allowed',
                opacity: hasAssets ? 1 : 0.45,
                textAlign: 'left',
                transition: 'background 0.15s',
                padding: '7px 12px',
                fontSize: dark ? '12px' : '13px',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: isActive ? 600 : 400,
                  color: isActive
                    ? (dark ? '#fff' : '#111')
                    : (dark ? 'rgba(255,255,255,0.7)' : '#555'),
                }}>
                  {mConfig.label}
                </div>
                <div style={{
                  fontSize: '11px',
                  color: dark ? 'rgba(255,255,255,0.45)' : '#888',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginTop: 1,
                }}>
                  {mConfig.description}
                </div>
              </div>
              {isActive && (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7L6 10L11 4" stroke={dark ? '#fff' : '#111'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              {!hasAssets && (
                <span style={{
                  fontSize: '11px',
                  fontWeight: 500,
                  color: dark ? 'rgba(255,255,255,0.45)' : '#999',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}>需素材</span>
              )}
            </button>
          );
        })}
      </div>

      {/* 音频设置（HappyHorse video-edit 模式） */}
      {showAudioSetting && !isSeedance2 && !isT8Seedance && !isTopaisSeedance && !isMegaAiSeedance && onAudioSettingChange && (
        <div style={{
          padding: '6px 12px',
          borderTop: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid #f0f0f0',
        }}>
          <div style={{ fontSize: '10px', fontWeight: 500, color: dark ? 'rgba(255,255,255,0.4)' : '#999', marginBottom: 4 }}>
            音频
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['auto', 'origin'] as const).map((s) => (
              <button
                key={s}
                onClick={() => onAudioSettingChange(s)}
                style={{
                  flex: 1,
                  padding: '3px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  background: audioSetting === s
                    ? (dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)')
                    : (dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'),
                  color: audioSetting === s
                    ? (dark ? '#fff' : '#111')
                    : (dark ? 'rgba(255,255,255,0.4)' : '#999'),
                  border: audioSetting === s
                    ? (dark ? '1px solid rgba(255,255,255,0.2)' : '1px solid #ddd')
                    : '1px solid transparent',
                  cursor: 'pointer',
                }}
              >
                {s === 'auto' ? '自动' : '保留原声'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* r2v 提示（HappyHorse） */}
      {!isSeedance2 && !isT8Seedance && !isTopaisSeedance && !isMegaAiSeedance && displayMode === 'r2v' && (
        <div style={{
          padding: '4px 12px',
          borderTop: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid #f0f0f0',
          fontSize: '11px',
          color: dark ? 'rgba(255,255,255,0.35)' : '#999',
        }}>
          提示词中使用 [Image 1] 引用图片
        </div>
      )}

      {/* Seedance 2.0 r2v 提示 */}
      {(isSeedance2 || isT8Seedance || isTopaisSeedance || isMegaAiSeedance) && displayMode === 'r2v' && (
        <div style={{
          padding: '4px 12px',
          borderTop: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid #f0f0f0',
          fontSize: '11px',
          color: dark ? 'rgba(255,255,255,0.35)' : '#999',
        }}>
          提示词中使用 [图1]、[图2] 引用参考图
        </div>
      )}

      {/* Seedance 2.0 首尾帧提示 */}
      {(isSeedance2 || isT8Seedance || isTopaisSeedance || isMegaAiSeedance) && displayMode === 'i2v-first-last-frame' && (
        <div style={{
          padding: '4px 12px',
          borderTop: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid #f0f0f0',
          fontSize: '11px',
          color: dark ? 'rgba(255,255,255,0.35)' : '#999',
        }}>
          需同时上传首帧和尾帧图片
        </div>
      )}

      {/* #662 生成音频开关 - Seedance 2.0 和 T8 Seedance 和 TOPAIS Seedance 模型显示 */}
      {(isSeedance2 || isT8Seedance || isTopaisSeedance || isMegaAiSeedance) && onGenerateAudioChange && (
        <div style={{
          padding: '6px 12px',
          borderTop: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid #f0f0f0',
        }}>
          <div style={{ fontSize: '10px', fontWeight: 500, color: dark ? 'rgba(255,255,255,0.4)' : '#999', marginBottom: 4 }}>
            生成音频
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => onGenerateAudioChange(true)}
              style={{
                flex: 1,
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                background: generateAudio
                  ? (dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)')
                  : (dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'),
                color: generateAudio
                  ? (dark ? '#fff' : '#111')
                  : (dark ? 'rgba(255,255,255,0.4)' : '#999'),
                border: generateAudio
                  ? (dark ? '1px solid rgba(255,255,255,0.2)' : '1px solid #ddd')
                  : '1px solid transparent',
                cursor: 'pointer',
              }}
            >
              开启
            </button>
            <button
              onClick={() => onGenerateAudioChange(false)}
              style={{
                flex: 1,
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                background: !generateAudio
                  ? (dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)')
                  : (dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'),
                color: !generateAudio
                  ? (dark ? '#fff' : '#111')
                  : (dark ? 'rgba(255,255,255,0.4)' : '#999'),
                border: !generateAudio
                  ? (dark ? '1px solid rgba(255,255,255,0.2)' : '1px solid #ddd')
                  : '1px solid transparent',
                cursor: 'pointer',
              }}
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ========== 向上弹出的统一计算（含边界溢出保护） ==========
function getPopupPositionUp(btnRef: React.RefObject<HTMLButtonElement | null>, offset: number = 6, panelWidth: number = 220, preferRight: boolean = false) {
  if (!btnRef.current) return { left: 0, bottom: 0 };
  const rect = btnRef.current.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  let left: number | undefined;
  let right: number | undefined;
  // preferRight: 对话框变体按钮靠右，优先右对齐防止溢出
  if (preferRight || rect.left + panelWidth > viewportWidth - 8) {
    // 右对齐：弹窗右边缘 = 按钮右边缘
    right = viewportWidth - rect.right;
    left = undefined;
  } else {
    left = rect.left;
    right = undefined;
  }
  return {
    left,
    right,
    bottom: window.innerHeight - rect.top + offset, // 弹窗显示在按钮上方
  };
}

// ========== 视频页面变体 ==========
function VideoPageModeSwitcher(props: ModelModeSwitcherProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const systemDark = useIsDarkMode();
  const {
    displayMode, config, showAudioSetting,
    handleModeSwitch, baseMode,
  } = useModeLogic(
    props.inputImageUrls, props.inputVideoUrl,
    props.overrideMode, props.setOverrideMode, props.onModeChange,
    props.modelType,
  );

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-mode-switcher-panel]') && !target.closest('[data-mode-switcher-btn]')) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const popupPos = open ? getPopupPositionUp(btnRef, 6) : null;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        data-mode-switcher-btn
        disabled={props.disabled}
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 transition-colors whitespace-nowrap flex items-center gap-1"
      >
        {config?.shortLabel ?? '模式'}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.6 }}>
          <path d={open ? "M3 8L6 4L9 8" : "M3 4L6 8L9 4"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && popupPos && createPortal(
        <div
          data-mode-switcher-panel
          style={{
            position: 'fixed',
            ...(popupPos.left !== undefined ? { left: popupPos.left } : { right: popupPos.right }),
            bottom: popupPos.bottom,
            zIndex: 9999,
            minWidth: 220,
            background: systemDark ? '#1c1c1e' : '#fff',
            borderRadius: '10px',
            border: systemDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid #e5e7eb',
            boxShadow: systemDark ? '0 -4px 32px rgba(0,0,0,0.5)' : '0 -4px 24px rgba(0,0,0,0.12)',
            overflow: 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <ModeDropdownContent
            displayMode={displayMode}
            inputImageUrls={props.inputImageUrls}
            inputVideoUrl={props.inputVideoUrl}
            audioSetting={props.audioSetting}
            onAudioSettingChange={props.onAudioSettingChange}
            generateAudio={props.generateAudio}
            onGenerateAudioChange={props.onGenerateAudioChange}
            handleModeSwitch={handleModeSwitch}
            baseMode={baseMode}
            showAudioSetting={showAudioSetting}
            onClose={() => setOpen(false)}
            variant="video-page"
            isDark={systemDark}
            modelType={props.modelType}
          />
        </div>,
        document.body
      )}
    </div>
  );
}

// ========== 画布面板变体 ==========
function CanvasPanelModeSwitcher(props: ModelModeSwitcherProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const {
    displayMode, config, showAudioSetting,
    handleModeSwitch, baseMode,
  } = useModeLogic(
    props.inputImageUrls, props.inputVideoUrl,
    props.overrideMode, props.setOverrideMode, props.onModeChange,
    props.modelType,
  );

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-canvas-mode-panel]') && !target.closest('[data-canvas-mode-btn]')) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const popupPos = open ? getPopupPositionUp(btnRef, 4) : null;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={btnRef}
        data-canvas-mode-btn
        disabled={props.disabled}
        onClick={() => setOpen(!open)}
        style={{
          padding: '4px 6px',
          fontSize: '13px',
          background: '#27272a',
          border: 'none',
          borderRadius: '6px',
          color: '#f4f4f5',
          cursor: props.disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = '#3f3f46';
          (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(156, 163, 175, 0.3)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = '#27272a';
          (e.currentTarget as HTMLElement).style.boxShadow = 'none';
        }}
      >
        <span>{config?.shortLabel ?? '模式'}</span>
        <span style={{ fontSize: '14px', opacity: 0.6 }}>{open ? '^' : '˅'}</span>
      </button>

      {open && popupPos && createPortal(
        <div
          data-canvas-mode-panel
          style={{
            position: 'fixed',
            ...(popupPos.left !== undefined ? { left: popupPos.left } : { right: popupPos.right }),
            bottom: popupPos.bottom,
            zIndex: 9999,
            minWidth: 200,
            background: '#1c1c1e',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 -4px 32px rgba(0,0,0,0.5)',
            overflow: 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <ModeDropdownContent
            displayMode={displayMode}
            inputImageUrls={props.inputImageUrls}
            inputVideoUrl={props.inputVideoUrl}
            audioSetting={props.audioSetting}
            onAudioSettingChange={props.onAudioSettingChange}
            generateAudio={props.generateAudio}
            onGenerateAudioChange={props.onGenerateAudioChange}
            handleModeSwitch={handleModeSwitch}
            baseMode={baseMode}
            showAudioSetting={showAudioSetting}
            onClose={() => setOpen(false)}
            variant="canvas-panel"
            modelType={props.modelType}
          />
        </div>,
        document.body
      )}
    </div>
  );
}

// ========== 对话框变体 ==========
function DialogModeSwitcher(props: ModelModeSwitcherProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const systemDark = useIsDarkMode();
  const {
    displayMode, config, showAudioSetting,
    handleModeSwitch, baseMode,
  } = useModeLogic(
    props.inputImageUrls, props.inputVideoUrl,
    props.overrideMode, props.setOverrideMode, props.onModeChange,
    props.modelType,
  );

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-dialog-mode-panel]') && !target.closest('[data-dialog-mode-btn]')) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const popupPos = open ? getPopupPositionUp(btnRef, 6, 220, true) : null;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        data-dialog-mode-btn
        disabled={props.disabled}
        onClick={() => setOpen(!open)}
        className="px-2 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-gray-700 dark:text-gray-200 transition-colors whitespace-nowrap flex items-center gap-1"
      >
        {config.shortLabel}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.6 }}>
          <path d={open ? "M3 8L6 4L9 8" : "M3 4L6 8L9 4"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && popupPos && createPortal(
        <div
          data-dialog-mode-panel
          style={{
            position: 'fixed',
            ...(popupPos.left !== undefined ? { left: popupPos.left } : { right: popupPos.right }),
            bottom: popupPos.bottom,
            zIndex: 9999,
            minWidth: 220,
            maxWidth: 'calc(100vw - 16px)',
            background: systemDark ? '#1c1c1e' : '#fff',
            borderRadius: '10px',
            border: systemDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid #e5e7eb',
            boxShadow: systemDark ? '0 -4px 32px rgba(0,0,0,0.5)' : '0 -4px 24px rgba(0,0,0,0.12)',
            overflow: 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <ModeDropdownContent
            displayMode={displayMode}
            inputImageUrls={props.inputImageUrls}
            inputVideoUrl={props.inputVideoUrl}
            audioSetting={props.audioSetting}
            onAudioSettingChange={props.onAudioSettingChange}
            generateAudio={props.generateAudio}
            onGenerateAudioChange={props.onGenerateAudioChange}
            handleModeSwitch={handleModeSwitch}
            baseMode={baseMode}
            showAudioSetting={showAudioSetting}
            onClose={() => setOpen(false)}
            variant="dialog"
            isDark={systemDark}
            modelType={props.modelType}
          />
        </div>,
        document.body
      )}
    </div>
  );
}

/**
 * HappyHorse 模式切换组件
 * 
 * 三端适配，按钮风格统一：
 * - variant="video-page": 视频生成页（Tailwind 按钮样式）
 * - variant="canvas-panel": 画布面板（inline style 按钮）
 * - variant="dialog": 对话框（Tailwind 按钮样式）
 */
export function ModelModeSwitcher(props: ModelModeSwitcherProps) {
  const variant = props.variant || 'video-page';
  
  switch (variant) {
    case 'canvas-panel':
      return <CanvasPanelModeSwitcher {...props} />;
    case 'dialog':
      return <DialogModeSwitcher {...props} />;
    case 'video-page':
    default:
      return <VideoPageModeSwitcher {...props} />;
  }
}
