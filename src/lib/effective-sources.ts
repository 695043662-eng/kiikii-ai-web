/**
 * ============================================
 * 素材提纯引擎 (Effective Sources Engine)
 * ============================================
 * 
 * 【核心原则】派生状态（Derived State）
 * - 严禁破坏底层数据（如 sourceIds、chatImageUrls）
 * - 仅在发送请求前或 UI 渲染时计算有效素材
 * - 纯函数，无副作用，可测试
 * 
 * 【用途】
 * 当用户切换模式/模型时，按约束自动过滤/截断素材：
 * - t2v: 不允许任何素材（#655 音频不可单独传入，必须搭配图片/视频）
 * - i2v: 允许1张图片 + 音频
 * - i2v-first-frame: 允许1张首帧图片 + 音频
 * - i2v-first-last-frame: 允许首帧+尾帧2张图片 + 音频
 * - r2v: T8 Seedance 最多1张图片+音频；LingYa Seedance 2.0 最多9张图+3视频+3音频
 * - video-edit: HappyHorse 支持1视频+5参考图；其他模型1视频
 * 
 * 【关键区分】
 * - T8 Seedance (sdols-*): r2v 支持图片+视频+音频（#668 全模态解锁，与 LingYa 对齐）
 * - LingYa Seedance 2.0 (seedance-2): 多模态，r2v 支持图片+视频+音频
 * - HappyHorse: video-edit 支持1视频+0~5张参考图
 * - 所有 Seedance 模型在非 t2v 模式下支持音频上传和音频生成开关
 * - t2v 不支持音频（#655 官方文档约束：音频不可单独传入）
 * 
 * 【#663 重构】统一使用 ModelDetector.getFamily() 判断模型家族，
 * 消除三端 includes/startsWith/=== 判断不一致的问题
 */

import { ModelDetector } from './model-utils';

export type SourceType = 'image' | 'video' | 'audio';

/**
 * 素材条目 - 调用方必须传入确切的 type
 * ⚠️ 不依赖 URL 扩展名判断类型（COS 签名 URL 无扩展名）
 */
export interface SourceItem {
  id: string;
  type: SourceType; // 必须由调用方传入确切类型
  url: string;
  index?: number;
}

/**
 * 提纯结果
 */
export interface EffectiveResult<T extends SourceItem> {
  /** 通过提纯的有效素材 */
  effective: T[];
  /** 被过滤掉的素材 */
  excluded: T[];
}

/**
 * 模式约束定义
 */
interface ModeConstraint {
  /** 允许的素材类型（空数组 = 不允许任何素材） */
  allowedTypes: SourceType[];
  /** 各类型最大数量 */
  maxCounts: Partial<Record<SourceType, number>>;
  /** 总素材最大数量 */
  maxTotal: number;
}

/**
 * 获取模式约束
 * 
 * #663 重构：使用 ModelDetector.getFamily() 统一判断模型家族
 * 保留 switch-case 结构（比二维矩阵更清晰），但统一判断逻辑
 * 
 * @param mode - 当前视频模式
 * @param modelId - 模型ID，用于区分 T8 Seedance 和 LingYa Seedance 2.0
 */
function getModeConstraint(mode: string, modelId: string): ModeConstraint {
  const family = ModelDetector.getFamily(modelId);
  const isT8Seedance = family === 't8seedance';
  const isSeedance2 = family === 'seedance2';
  const isTopais = family === 'topais';  // #689 TOPAIS Veo3.1-fast
  const isTopaisHappyHorse = family === 'topais-happyhorse';  // #691 TOPAIS HappyHorse
  const isTopaisSeedance = family === 'topais-seedance';  // TOPAIS Seedance 2.0
  const isTopaisGeminiOmni = family === 'topais-gemini-omni';  // TOPAIS Gemini Omni Flash
  const isMegaAiSeedance = family === 'mega-ai-seedance';  // MEGA AI Seedance 2.0
  const isTopaisMinimax = family === 'topais-minimax';  // TOPAIS MiniMax H3
  const isTopaisKlingOmni = family === 'topais-kling-omni';  // TOPAIS Kling v3 Omni
  const isLingyaVeo = family === 'lingya-veo';  // LingYa Veo3.1
  const isLingyaSora = family === 'lingya-sora';  // LingYa Sora-2 VIP
  
  switch (mode) {
    case 't2v':
      // #655 t2v 不支持任何素材！音频必须搭配图片或视频（官方文档约束）
      // T8 Seedance 和 LingYa Seedance 2.0 均不支持 t2v 音频
      // #689 TOPAIS t2v 也不支持任何素材
      // #691 TOPAIS HappyHorse t2v 也不支持任何素材
      return { allowedTypes: [], maxCounts: {}, maxTotal: 0 };
    
    case 'i2v':
      // 图生视频：单张图片作为首帧，图片用途 = first_frame
      // #669 修正：i2v 是"图生视频"，不允许参考视频（视频是 r2v 的专属能力）
      if (isT8Seedance || isSeedance2) {
        return { allowedTypes: ['image', 'audio'], maxCounts: { image: 1, audio: 3 }, maxTotal: 4 };
      }
      // TOPAIS Seedance 2.0 i2v: 1张首帧图 + 最多3段音频
      if (isTopaisSeedance) {
        return { allowedTypes: ['image', 'audio'], maxCounts: { image: 1, audio: 3 }, maxTotal: 4 };
      }
      // MEGA AI Seedance 2.0 i2v: 1张首帧图 + 最多3段音频（与 TOPAIS Seedance 独立，参数相同但独立分支）
      if (isMegaAiSeedance) {
        return { allowedTypes: ['image', 'audio'], maxCounts: { image: 1, audio: 3 }, maxTotal: 4 };
      }
      // TOPAIS MiniMax H3 i2v: 1张首帧图 + 最多3段音频（独立分支，参数与 MegaAI Seedance 相同但独立配置）
      if (isTopaisMinimax) {
        return { allowedTypes: ['image', 'audio'], maxCounts: { image: 1, audio: 3 }, maxTotal: 4 };
      }
      // #689 TOPAIS Veo i2v 支持1-2张图片（首帧/首尾帧）
      if (isTopais) {
        return { allowedTypes: ['image'], maxCounts: { image: 2 }, maxTotal: 2 };
      }
      // LingYa Veo3.1 i2v 支持1-2张图片（首帧/首尾帧，input_reference 可多次传递）
      if (isLingyaVeo) {
        return { allowedTypes: ['image'], maxCounts: { image: 2 }, maxTotal: 2 };
      }
      // LingYa Sora-2 VIP i2v 支持1张图片
      if (isLingyaSora) {
        return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
      }
      // #691 TOPAIS HappyHorse i2v 支持1张首帧图（image_urls）
      if (isTopaisHappyHorse) {
        return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
      }
      // TOPAIS Gemini Omni Flash i2v 支持1张首帧图（image_urls）
      if (isTopaisGeminiOmni) {
        return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
      }
      // HappyHorse 等其他模型
      return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
    
    case 'i2v-first-frame':
      // #669 修正：首帧图生视频，只允许1张首帧图片 + 音频（视频是 r2v 的专属能力）
      if (isT8Seedance || isSeedance2) {
        return { allowedTypes: ['image', 'audio'], maxCounts: { image: 1, audio: 3 }, maxTotal: 4 };
      }
      // TOPAIS Seedance 2.0 首帧模式：1张首帧图 + 最多3段音频
      if (isTopaisSeedance) {
        return { allowedTypes: ['image', 'audio'], maxCounts: { image: 1, audio: 3 }, maxTotal: 4 };
      }
      // MEGA AI Seedance 2.0 首帧模式：1张首帧图 + 最多3段音频（独立分支）
      if (isMegaAiSeedance) {
        return { allowedTypes: ['image', 'audio'], maxCounts: { image: 1, audio: 3 }, maxTotal: 4 };
      }
      // TOPAIS MiniMax H3 首帧模式：1张首帧图 + 最多3段音频（独立分支）
      if (isTopaisMinimax) {
        return { allowedTypes: ['image', 'audio'], maxCounts: { image: 1, audio: 3 }, maxTotal: 4 };
      }
      // TOPAIS Kling v3 Omni 首帧模式：1张首帧图（image_list type=first_frame，不支持音频上传）
      if (isTopaisKlingOmni) {
        return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
      }
      // #689 TOPAIS 首帧模式：只允许1张图片
      if (isTopais) {
        return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
      }
      // LingYa Veo3.1 首帧模式：只允许1张图片
      if (isLingyaVeo) {
        return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
      }
      // LingYa Sora-2 VIP 不支持首帧模式，保守返回1张
      if (isLingyaSora) {
        return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
      }
      // #691 TOPAIS HappyHorse 首帧模式：只允许1张图片
      if (isTopaisHappyHorse) {
        return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
      }
      // TOPAIS Gemini Omni Flash 首帧模式：只允许1张图片
      if (isTopaisGeminiOmni) {
        return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
      }
      // 其他模型不支持此模式，保守返回
      return { allowedTypes: ['image', 'audio'], maxCounts: { image: 1, audio: 1 }, maxTotal: 2 };
    
    case 'i2v-first-last-frame':
      // #669 修正：首尾帧图生视频，只允许2张图片(首帧+尾帧) + 音频（视频是 r2v 的专属能力）
      if (isT8Seedance || isSeedance2) {
        return { allowedTypes: ['image', 'audio'], maxCounts: { image: 2, audio: 3 }, maxTotal: 5 };
      }
      // TOPAIS Seedance 2.0 首尾帧模式：2张图片(first_frame + last_frame) + 最多3段音频
      if (isTopaisSeedance) {
        return { allowedTypes: ['image', 'audio'], maxCounts: { image: 2, audio: 3 }, maxTotal: 5 };
      }
      // MEGA AI Seedance 2.0 首尾帧模式：2张图片(first_frame + last_frame) + 最多3段音频（独立分支）
      if (isMegaAiSeedance) {
        return { allowedTypes: ['image', 'audio'], maxCounts: { image: 2, audio: 3 }, maxTotal: 5 };
      }
      // TOPAIS MiniMax H3 首尾帧模式：2张图片(first_frame + last_frame) + 最多3段音频（独立分支）
      if (isTopaisMinimax) {
        return { allowedTypes: ['image', 'audio'], maxCounts: { image: 2, audio: 3 }, maxTotal: 5 };
      }
      // TOPAIS Kling v3 Omni 首尾帧模式：2张图片(first_frame + end_frame，不支持音频上传)
      if (isTopaisKlingOmni) {
        return { allowedTypes: ['image'], maxCounts: { image: 2 }, maxTotal: 2 };
      }
      // #689 TOPAIS 首尾帧模式：只允许2张图片
      if (isTopais) {
        return { allowedTypes: ['image'], maxCounts: { image: 2 }, maxTotal: 2 };
      }
      // LingYa Veo3.1 首尾帧模式：2张图片（首帧+尾帧，input_reference 可多次传递）
      if (isLingyaVeo) {
        return { allowedTypes: ['image'], maxCounts: { image: 2 }, maxTotal: 2 };
      }
      // LingYa Sora-2 VIP 不支持首尾帧模式，保守返回1张
      if (isLingyaSora) {
        return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
      }
      // TOPAIS HappyHorse 不支持首尾帧模式，保守返回
      if (isTopaisHappyHorse) {
        return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
      }
      // TOPAIS Gemini Omni Flash 不支持首尾帧模式，保守返回
      if (isTopaisGeminiOmni) {
        return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
      }
      // 其他模型不支持此模式
      return { allowedTypes: ['image', 'audio'], maxCounts: { image: 2, audio: 1 }, maxTotal: 3 };
    
    case 'r2v':
      // #667 多模态参考生视频：图片用途 = reference_image
      // T8 sdols-2.0 全模态解锁：与 LingYa Seedance 2.0 完全对齐
      if (isT8Seedance || isSeedance2) {
        // r2v 支持参考图(1~9张) + 参考视频(最多3段) + 音频(最多3段)
        return {
          allowedTypes: ['image', 'video', 'audio'],
          maxCounts: { image: 9, video: 3, audio: 3 },
          maxTotal: 15,
        };
      }
      // TOPAIS Seedance 2.0 r2v: 参考图(1~9张) + 参考视频(最多3段) + 音频(最多3段)
      // 基于 TOPAIS 官方文档：reference_image max 9, reference_video max 3, reference_audio max 3
      if (isTopaisSeedance) {
        return {
          allowedTypes: ['image', 'video', 'audio'],
          maxCounts: { image: 9, video: 3, audio: 3 },
          maxTotal: 15,
        };
      }
      // MEGA AI Seedance 2.0 r2v: 参考图(1~9张) + 参考视频(最多3段) + 音频(最多3段)
      // 基于 MEGA AI 官方文档：images/videos/audios 字段支持，images最多9张，videos最多3段，audios最多3段（独立分支）
      if (isMegaAiSeedance) {
        return {
          allowedTypes: ['image', 'video', 'audio'],
          maxCounts: { image: 9, video: 3, audio: 3 },
          maxTotal: 15,
        };
      }
      // TOPAIS MiniMax H3 r2v: 参考图(1~9张) + 参考视频(最多3段) + 音频(最多3段)
      // 基于 ToAPIs MiniMax-H3 官方文档：image_with_roles(reference_image max 9) + video_with_roles(reference_video max 3) + audio_with_roles(reference_audio max 3)
      if (isTopaisMinimax) {
        return {
          allowedTypes: ['image', 'video', 'audio'],
          maxCounts: { image: 9, video: 3, audio: 3 },
          maxTotal: 15,
        };
      }
      // TOPAIS Kling v3 Omni r2v: 参考图(1~9张) + 参考视频(最多1段，video_list max 1)
      // 基于 ToAPIs Kling v3 Omni 官方文档：metadata.image_list + video_list(max 1) + element_list
      // 不支持音频上传（audio 是生成标志，与 video_list 互斥）
      if (isTopaisKlingOmni) {
        return {
          allowedTypes: ['image', 'video'],
          maxCounts: { image: 9, video: 1 },
          maxTotal: 10,
        };
      }
      // #689 TOPAIS r2v 支持1-3张参考图
      if (isTopais) {
        return { allowedTypes: ['image'], maxCounts: { image: 3 }, maxTotal: 3 };
      }
      // LingYa Veo3.1 r2v 支持1-2张参考图（input_reference 最多2次）
      if (isLingyaVeo) {
        return { allowedTypes: ['image'], maxCounts: { image: 2 }, maxTotal: 2 };
      }
      // LingYa Sora-2 VIP r2v 支持1张参考图
      if (isLingyaSora) {
        return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
      }
      // #691 TOPAIS HappyHorse r2v 支持1-9张参考图（reference_images）
      if (isTopaisHappyHorse) {
        return { allowedTypes: ['image'], maxCounts: { image: 9 }, maxTotal: 9 };
      }
      // TOPAIS Gemini Omni Flash r2v 支持恰好3张参考图（image_urls，不支持1-2张或4+张）
      if (isTopaisGeminiOmni) {
        return { allowedTypes: ['image'], maxCounts: { image: 3 }, maxTotal: 3 };
      }
      // HappyHorse r2v: 参考图(最多9张)
      return { allowedTypes: ['image'], maxCounts: { image: 9 }, maxTotal: 9 };
    
    case 'video-edit':
      // #663 修复：HappyHorse video-edit 支持1视频+0~5张参考图（军师核对官方文档确认）
      if (family === 'happyhorse') {
        return { allowedTypes: ['video', 'image'], maxCounts: { video: 1, image: 5 }, maxTotal: 6 };
      }
      // #691 TOPAIS HappyHorse video-edit 支持1个视频(url) + 最多5张参考图(reference_images)
      if (isTopaisHappyHorse) {
        return { allowedTypes: ['video', 'image'], maxCounts: { video: 1, image: 5 }, maxTotal: 6 };
      }
      // TOPAIS Gemini Omni Flash 不支持 video-edit 模式，保守返回
      if (isTopaisGeminiOmni) {
        return { allowedTypes: ['video'], maxCounts: { video: 1 }, maxTotal: 1 };
      }
      // 其他模型的视频编辑模式：只允许1个视频
      return { allowedTypes: ['video'], maxCounts: { video: 1 }, maxTotal: 1 };
    
    default:
      // 未知模式：保守策略，允许图片最多 1 张
      console.warn(`[effective-sources] 未知模式: ${mode}，使用保守约束`);
      return { allowedTypes: ['image'], maxCounts: { image: 1 }, maxTotal: 1 };
  }
}

/**
 * 获取各类型素材的最大数量（用于 UI 显示）
 * 
 * @param mode - 当前视频模式
 * @param modelId - 模型ID
 * @returns 各类型最大数量 { image, video, audio }
 */
export function getMaterialTypeLimits(mode: string, modelId: string): {
  image: number;
  video: number;
  audio: number;
} {
  const constraint = getModeConstraint(mode, modelId);
  return {
    image: constraint.maxCounts.image ?? 0,
    video: constraint.maxCounts.video ?? 0,
    audio: constraint.maxCounts.audio ?? 0,
  };
}

/**
 * 格式化素材限制文案（用于 UI 显示）
 * 
 * @param mode - 当前视频模式
 * @param modelId - 模型ID
 * @param currentCounts - 当前各类型素材数量 { image, video, audio }
 * @returns 格式化的显示文案，如 "3图 1视 2音 | 最多9图/1视/3音"
 */
export function formatMaterialLimits(
  mode: string,
  modelId: string,
  currentCounts: { image: number; video: number; audio: number }
): string {
  const limits = getMaterialTypeLimits(mode, modelId);
  
  const parts: string[] = [];
  const limitParts: string[] = [];
  
  if (limits.image > 0) {
    parts.push(`${currentCounts.image}图`);
    limitParts.push(`${limits.image}图`);
  }
  if (limits.video > 0) {
    parts.push(`${currentCounts.video}视`);
    limitParts.push(`${limits.video}视`);
  }
  if (limits.audio > 0) {
    parts.push(`${currentCounts.audio}音`);
    limitParts.push(`${limits.audio}音`);
  }
  
  if (parts.length === 0) {
    // 该模式不支持任何素材
    return '不支持素材';
  }
  
  return `${parts.join(' ')} | 最多${limitParts.join('/')}`;
}

/**
 * 素材提纯核心函数
 * 
 * 按模式约束过滤素材：
 * 1. 先按类型过滤（只保留 allowedTypes 中的类型）
 * 2. 再按类型数量截断（不超过 maxCounts）
 * 3. 最后按总数截断（不超过 maxTotal）
 * 
 * @param mode - 当前视频模式 (t2v / i2v / i2v-first-frame / i2v-first-last-frame / r2v / video-edit)
 * @param modelId - 模型ID，用于区分 T8 Seedance 和 LingYa Seedance 2.0
 * @param sources - 原始素材列表（必须包含准确的 type 字段）
 * @returns 提纯后的有效素材和被排除的素材
 */
export function getEffectiveSources<T extends SourceItem>(
  mode: string,
  modelId: string,
  sources: T[]
): EffectiveResult<T> {
  const constraint = getModeConstraint(mode, modelId);
  
  // 如果不允许任何素材，全部排除
  if (constraint.allowedTypes.length === 0) {
    return { effective: [], excluded: [...sources] };
  }
  
  // 按类型分组
  const typeGroups = new Map<SourceType, T[]>();
  for (const source of sources) {
    if (!typeGroups.has(source.type)) {
      typeGroups.set(source.type, []);
    }
    typeGroups.get(source.type)!.push(source);
  }
  
  // 按类型过滤 + 截断
  const effective: T[] = [];
  const excluded: T[] = [];
  
  for (const source of sources) {
    // 不在允许类型中 → 排除
    if (!constraint.allowedTypes.includes(source.type)) {
      excluded.push(source);
      continue;
    }
    
    // 检查该类型的已有数量
    const currentCount = effective.filter(s => s.type === source.type).length;
    const maxCount = constraint.maxCounts[source.type] ?? Infinity;
    
    if (currentCount >= maxCount) {
      excluded.push(source);
      continue;
    }
    
    // 检查总数
    if (effective.length >= constraint.maxTotal) {
      excluded.push(source);
      continue;
    }
    
    effective.push(source);
  }
  
  return { effective, excluded };
}

/**
 * 判断素材是否会被当前模式接受（用于 UI 暗化/禁用判断）
 */
export function isSourceAccepted(
  mode: string,
  modelId: string,
  sourceType: SourceType,
  currentCountOfType: number
): boolean {
  const constraint = getModeConstraint(mode, modelId);
  
  if (!constraint.allowedTypes.includes(sourceType)) {
    return false;
  }
  
  const maxCount = constraint.maxCounts[sourceType] ?? Infinity;
  return currentCountOfType < maxCount;
}

/**
 * 切换模式时自动重排素材
 * 核心策略：将有效类型的素材排到前面，无效类型的排到后面
 * 同类型内保持原始顺序
 * 
 * @param mode - 目标模式
 * @param modelId - 模型ID
 * @param sources - 原始素材列表
 * @returns 重排后的素材列表（有效素材在前，无效素材在后）
 */
export function reorderSourcesByMode<T extends SourceItem>(
  mode: string,
  modelId: string,
  sources: T[]
): T[] {
  const constraint = getModeConstraint(mode, modelId);
  
  // 不需要排序的模式
  if (constraint.allowedTypes.length === 0) {
    return sources;
  }
  
  // 分组：有效素材 + 无效素材
  const effective: T[] = [];
  const excluded: T[] = [];
  
  for (const source of sources) {
    if (constraint.allowedTypes.includes(source.type)) {
      effective.push(source);
    } else {
      excluded.push(source);
    }
  }
  
  // 有效素材按类型优先级排序（allowedTypes 数组顺序即为优先级）
  const typePriority = new Map(constraint.allowedTypes.map((t, i) => [t, i]));
  effective.sort((a, b) => {
    const pa = typePriority.get(a.type) ?? 999;
    const pb = typePriority.get(b.type) ?? 999;
    if (pa !== pb) return pa - pb;
    // 同类型保持原始顺序
    return (a.index ?? 0) - (b.index ?? 0);
  });
  
  return [...effective, ...excluded];
}

/**
 * ============================================
 * 模型素材支持能力（物理层 - 与模式无关）
 * ============================================
 * 
 * 【核心原则】模型支持能力决定上传入口是否显示
 * - 与模式无关！模型支持什么素材类型，就显示对应的上传按钮
 * - 模式只决定素材是否"生效"（通过 getMaterialTypeLimits 判断）
 * 
 * 【用途】
 * UI 层通过此函数判断是否显示上传按钮：
 * - supported.image = true → 显示图片上传按钮
 * - supported.video = true → 显示视频上传按钮
 * - supported.audio = true → 显示音频上传按钮
 */

export interface ModelSupportedTypes {
  image: boolean;
  video: boolean;
  audio: boolean;
}

/**
 * 获取模型支持的素材类型（与模式无关）
 * 
 * @param modelId - 模型ID
 * @returns 模型支持的素材类型 { image, video, audio }
 */
export function getModelSupportedTypes(modelId: string): ModelSupportedTypes {
  const family = ModelDetector.getFamily(modelId);
  
  switch (family) {
    case 't8seedance':
      // T8 Seedance 系列：支持图片、视频、音频
      return { image: true, video: true, audio: true };
    
    case 'seedance2':
      // LingYa Seedance 2.0 系列：支持图片、视频、音频
      return { image: true, video: true, audio: true };
    
    case 'happyhorse':
      // HappyHorse 系列：支持图片、视频（不支持音频）
      return { image: true, video: true, audio: false };
    
    case 'veo':
      // T8 Veo3.1（仅首尾帧）：只支持图片
      return { image: true, video: false, audio: false };
    
    case 'lingya-veo':
      // LingYa Veo3.1（首帧/首尾帧）：只支持图片
      return { image: true, video: false, audio: false };
    
    case 'lingya-sora':
      // LingYa Sora-2 VIP：只支持图片
      return { image: true, video: false, audio: false };
    
    case 'topais-happyhorse':
      // #691 TOPAIS HappyHorse 1.1：支持图片、视频（不支持音频）
      return { image: true, video: true, audio: false };
    
    case 'topais':
      // #689 TOPAIS Veo3.1-fast：只支持图片（1首帧/2首尾帧/3参考图）
      return { image: true, video: false, audio: false };
    
    case 'topais-seedance':
      // TOPAIS Seedance 2.0：支持图片、视频、音频（多模态参考）
      return { image: true, video: true, audio: true };
    
    case 'topais-gemini-omni':
      // TOPAIS Gemini Omni Flash：只支持图片（0/1/3张 image_urls，不支持视频和音频）
      return { image: true, video: false, audio: false };
    
    case 'mega-ai-seedance':
      // MEGA AI Seedance 2.0：支持图片、视频、音频（多模态参考）
      return { image: true, video: true, audio: true };
    
    case 'topais-minimax':
      // TOPAIS MiniMax H3：支持图片、视频、音频（多模态参考，image_with_roles/video_with_roles/audio_with_roles）
      return { image: true, video: true, audio: true };
    
    case 'topais-kling-omni':
      // TOPAIS Kling v3 Omni：支持图片、视频（image_list + video_list max 1，不支持音频上传）
      return { image: true, video: true, audio: false };
    
    case 'sora':
      // Sora 系列：只支持图片
      return { image: true, video: false, audio: false };
    
    case 'gpt-image':
      // GPT Image 系列：只支持图片
      return { image: true, video: false, audio: false };
    
    default:
      // 兼容未在 ModelDetector 中注册的模型
      const id = modelId.toLowerCase();
      if (id.includes('banana')) return { image: true, video: false, audio: false };
      if (id.includes('gemini')) return { image: true, video: true, audio: false };
      if (id.includes('gpt-5')) return { image: true, video: true, audio: false };
      // 未知模型：保守策略
      console.warn(`[effective-sources] 未知模型: ${modelId}，使用保守支持策略（仅图片）`);
      return { image: true, video: false, audio: false };
  }
}

/**
 * ============================================
 * 模型素材数量上限（物理层 - 与模式无关）
 * ============================================
 * 
 * 【核心原则】模型物理上限决定上传组件的 maxCount
 * - 与模式无关！每个模型有自己的最大素材数量限制
 * - 模式只决定素材是否"生效"（通过 getMaterialTypeLimits 判断）
 * 
 * 【用途】
 * UI 层通过此函数获取上传组件的 maxCount：
 * - limits.image = 9 → 图片上传最多9张
 * - limits.video = 3 → 视频上传最多3段
 * - limits.audio = 3 → 音频上传最多3段
 */

export interface ModelMaxLimits {
  image: number;   // 最大图片数量
  video: number;   // 最大视频数量
  audio: number;   // 最大音频数量
}

/**
 * 获取模型素材数量上限（与模式无关）
 * 
 * @param modelId - 模型ID
 * @returns 模型素材数量上限 { image, video, audio }
 */
export function getModelMaxLimits(modelId: string): ModelMaxLimits {
  const family = ModelDetector.getFamily(modelId);
  
  // #663 重构：统一使用 ModelDetector.getFamily() 判断模型
  // #656 模型上限管理器：每个模型独立的数量限制
  
  switch (family) {
    case 'seedance2':
      // LingYa Seedance 2.0 (全模态巨兽)
      // 图片最多9张，视频最多3段，音频最多3段
      return { image: 9, video: 3, audio: 3 };
    
    case 't8seedance':
      // #668 T8 Seedance (sdols-2.0) 全模态解锁：与 LingYa Seedance 2.0 完全对齐
      // 图片最多9张，视频最多3段，音频最多3段
      return { image: 9, video: 3, audio: 3 };
    
    case 'happyhorse':
      // HappyHorse 1.0
      // #663 修正：HH video-edit 支持0~5张参考图（军师核对官方文档确认）
      // HH 支持多图(最多9张)和单视频编辑(1段)，不支持音频
      return { image: 9, video: 1, audio: 0 };
    
    case 'veo':
      // T8 Veo3.1（仅首尾帧）
      // T8 Veo 支持首帧或首尾帧，最多2张图片
      return { image: 2, video: 0, audio: 0 };
    
    case 'lingya-veo':
      // LingYa Veo3.1（首帧/首尾帧）
      // LingYa Veo 支持首帧或首尾帧，最多2张图片
      return { image: 2, video: 0, audio: 0 };
    
    case 'lingya-sora':
      // LingYa Sora-2 VIP（单图参考）
      return { image: 1, video: 0, audio: 0 };
    
    case 'topais':
      // #689 TOPAIS Veo3.1-fast：1首帧/2首尾帧/3参考图
      return { image: 3, video: 0, audio: 0 };
    
    case 'topais-seedance':
      // TOPAIS Seedance 2.0 (多模态参考)
      // 图片最多9张(reference_image)，视频最多3段(reference_video)，音频最多3段(reference_audio)
      return { image: 9, video: 3, audio: 3 };
    
    case 'mega-ai-seedance':
      // MEGA AI Seedance 2.0 (多模态参考)
      // 图片最多9张(images)，视频最多3段(videos)，音频最多3段(audios)
      return { image: 9, video: 3, audio: 3 };
    
    case 'topais-minimax':
      // TOPAIS MiniMax H3 (多模态参考)
      // 图片最多9张(reference_image)，视频最多3段(reference_video)，音频最多3段(reference_audio)
      return { image: 9, video: 3, audio: 3 };
    
    case 'sora':
      // Sora (单图)
      // Sora 只支持单张参考图
      return { image: 1, video: 0, audio: 0 };
    
    case 'gpt-image':
      // GPT-Image-2 (多图参考)
      return { image: 9, video: 0, audio: 0 };
    
    default: {
      // 兼容未在 ModelDetector 中注册的模型
      const id = modelId.toLowerCase();
      if (id.includes('banana')) return { image: 9, video: 0, audio: 0 };
      if (id.includes('gemini')) return { image: 9, video: 1, audio: 0 };
      if (id.includes('gpt-5')) return { image: 9, video: 1, audio: 0 };
      // 未知模型：保守策略
      console.warn(`[effective-sources] 未知模型: ${modelId}，使用保守上限策略（1张图片）`);
      return { image: 1, video: 0, audio: 0 };
    }
  }
}
