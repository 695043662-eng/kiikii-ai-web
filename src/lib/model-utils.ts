/**
 * ============================================
 * 统一模型识别中枢 (Model Detector)
 * ============================================
 * 
 * 【核心原则】统一判断，消除三端差异；每个供应商独立family
 * - 所有模型判断统一使用 toLowerCase()
 * - 明确区分 seedance2 (不包含 sdols) 和 t8seedance (sdols)
 * - 单一数据源，避免 includes/startsWith/=== 混用
 * - 【独立性铁律】不同供应商的相同模型必须返回不同 family！
 * 
 * 【模型家族定义】
 * - happyhorse:        LingYa HappyHorse 1.0 系列
 * - topais-happyhorse: TOPAIS HappyHorse 1.1 系列（独立供应商）
 * - seedance2:         LingYa Seedance 2.0 系列（不含 sdols）
 * - t8seedance:        T8 Star Seedance 1.0 系列（sdols-*）
 * - topais:            TOPAIS 供应商 Veo3.1 系列（topais-veo3.1-fast）
 * - lingya-veo:        LingYa 供应商 Veo3.1 系列（veo_3_1-fast）
 * - lingya-sora:       LingYa 供应商 Sora-2 VIP 系列（sora-2-all-vip）
 * - veo:               T8 供应商 Veo3.1 系列（veo3.1-fast）
 * - sora:              T8 供应商 Sora-2 系列（sora-2）
 * - gpt-image:         GPT Image 系列
 * - unknown:           未识别的模型
 */

/**
 * 模型家族类型
 */
export type ModelFamily = 
  | 'happyhorse'
  | 'topais-happyhorse'  // TOPAIS HappyHorse 1.1（独立供应商）
  | 'seedance2'
  | 't8seedance'
  | 'topais'             // TOPAIS Veo3.1 系列
  | 'topais-seedance'    // TOPAIS Seedance 2.0 系列（seedance-2/seedance-2-fast）
  | 'topais-gemini-omni' // TOPAIS Gemini Omni Flash 系列（gemini_omni_flash）
  | 'mega-ai-seedance'  // MEGA AI Seedance 2.0 系列（mega-ai-seedance-v2-720p）
  | 'topais-minimax'    // TOPAIS MiniMax H3 系列（topais-minimax-h3，2K 视频生成）
  | 'topais-kling-omni' // TOPAIS Kling v3 Omni 系列（topais-kling-v3-omni，有声视频+视频参考）
  | 'lingya-veo'         // LingYa Veo3.1（独立供应商，veo_3_1 格式）
  | 'lingya-sora'        // LingYa Sora-2 VIP（独立供应商，sora-2-all-vip）
  | 'veo'
  | 'sora'
  | 'gpt-image'
  | 'unknown';

/**
 * 模型检测器 - 统一模型判断逻辑
 */
export class ModelDetector {
  /**
   * 获取模型家族（统一入口）
   * 
   * 【优先级原则】特殊前缀优先于通用前缀，供应商前缀优先于模型前缀
   * 
   * @param modelId - 模型ID（如 'happyhorse-1.0', 'seedance-2', 'sdols-01-pro', 'veo_3_1-fast'）
   * @returns 模型家族类型
   */
  static getFamily(modelId: string): ModelFamily {
    const id = modelId.toLowerCase();
    
    // 1. TOPAIS HappyHorse 1.1（独立供应商，最高优先级）
    if (id.includes('topais-happyhorse')) {
      return 'topais-happyhorse';
    }
    
    // 1.5 TOPAIS Seedance 2.0（topais-seedance-2 前缀，独立于 LingYa Seedance）
    if (id.startsWith('topais-seedance')) {
      return 'topais-seedance';
    }
    
    // 1.6 TOPAIS Gemini Omni Flash（topais-gemini-omni 前缀，独立家族）
    if (id.startsWith('topais-gemini-omni')) {
      return 'topais-gemini-omni';
    }
    
    // 1.7 MEGA AI Seedance 2.0（mega-ai-seedance 前缀，独立供应商）
    if (id.startsWith('mega-ai-seedance')) {
      return 'mega-ai-seedance';
    }
    
    // 1.8 TOPAIS MiniMax H3（topais-minimax 前缀，独立供应商，2K 视频生成）
    if (id.startsWith('topais-minimax')) {
      return 'topais-minimax';
    }
    
    // 1.9 TOPAIS Kling v3 Omni（topais-kling 前缀，独立供应商，有声视频+视频参考）
    if (id.startsWith('topais-kling')) {
      return 'topais-kling-omni';
    }
    
    // 2. LingYa Veo3.1（veo_3_1 格式，下划线分隔，独立于 T8 Veo）
    if (id.startsWith('veo_3')) {
      return 'lingya-veo';
    }
    
    // 3. T8 Seedance (sdols 系列)
    if (id.includes('sdols')) {
      return 't8seedance';
    }
    
    // 4. LingYa Seedance 2.0 (seedance-2 前缀，不含 sdols)
    if (id.startsWith('seedance-2')) {
      return 'seedance2';
    }
    
    // 5. LingYa HappyHorse (不含 topais)
    if (id.startsWith('happyhorse') && !id.includes('topais')) {
      return 'happyhorse';
    }
    
    // 6. LingYa Sora-2 VIP（独立于 T8 Sora）
    if (id.startsWith('sora-2-all-vip')) {
      return 'lingya-sora';
    }
    
    // 7. TOPAIS 供应商（仅 topais 前缀，不含 topais-happyhorse）
    if (id.startsWith('topais')) {
      return 'topais';
    }
    
    // 8. T8 Veo (veo3.1 格式，点号分隔，独立于 LingYa Veo 和 TOPAIS Veo)
    if (id.startsWith('veo3')) {
      return 'veo';
    }
    
    // 9. T8 Sora (sora-2 格式，独立于 LingYa Sora)
    if (id.startsWith('sora')) {
      return 'sora';
    }
    
    // 10. GPT Image
    if (id.includes('gpt-image') || id.includes('gptimage')) {
      return 'gpt-image';
    }
    
    return 'unknown';
  }
  
  /**
   * 判断是否为 TOPAIS HappyHorse 模型
   */
  static isTopaisHappyHorse(modelId: string): boolean {
    return this.getFamily(modelId) === 'topais-happyhorse';
  }
  
  /**
   * 判断是否为 LingYa Veo3.1 模型（独立于 T8 Veo）
   */
  static isLingyaVeo(modelId: string): boolean {
    return this.getFamily(modelId) === 'lingya-veo';
  }
  
  /**
   * 判断是否为 LingYa Sora-2 VIP 模型（独立于 T8 Sora）
   */
  static isLingyaSora(modelId: string): boolean {
    return this.getFamily(modelId) === 'lingya-sora';
  }
  
  /**
   * 判断是否为 HappyHorse 模型
   */
  static isHappyHorse(modelId: string): boolean {
    return this.getFamily(modelId) === 'happyhorse';
  }
  
  /**
   * 判断是否为 LingYa Seedance 2.0 模型
   */
  static isSeedance2(modelId: string): boolean {
    return this.getFamily(modelId) === 'seedance2';
  }
  
  /**
   * 判断是否为 T8 Star Seedance 1.0 模型
   */
  static isT8Seedance(modelId: string): boolean {
    return this.getFamily(modelId) === 't8seedance';
  }
  
  /**
   * 判断是否为任意 Seedance 模型（T8 或 LingYa 或 TOPAIS）
   */
  static isAnySeedance(modelId: string): boolean {
    const family = this.getFamily(modelId);
    return family === 'seedance2' || family === 't8seedance' || family === 'topais-seedance' || family === 'mega-ai-seedance';
  }
  
  /**
   * 判断是否为 TOPAIS 供应商模型
   */
  static isTopais(modelId: string): boolean {
    return this.getFamily(modelId) === 'topais';
  }
  
  /**
   * 判断是否为 TOPAIS Seedance 2.0 模型（独立于 LingYa Seedance）
   */
  static isTopaisSeedance(modelId: string): boolean {
    return this.getFamily(modelId) === 'topais-seedance';
  }
  
  /**
   * 判断是否为 TOPAIS Gemini Omni Flash 模型
   */
  static isTopaisGeminiOmni(modelId: string): boolean {
    return this.getFamily(modelId) === 'topais-gemini-omni';
  }
  
  /**
   * 判断是否为 MEGA AI Seedance 2.0 模型（独立供应商）
   */
  static isMegaAiSeedance(modelId: string): boolean {
    return this.getFamily(modelId) === 'mega-ai-seedance';
  }
  
  /**
   * 判断是否为 TOPAIS MiniMax H3 模型（独立供应商，2K 视频生成）
   */
  static isTopaisMinimax(modelId: string): boolean {
    return this.getFamily(modelId) === 'topais-minimax';
  }
  
  /**
   * 判断是否为 TOPAIS Kling v3 Omni 模型（独立供应商，有声视频+视频参考）
   */
  static isTopaisKlingOmni(modelId: string): boolean {
    return this.getFamily(modelId) === 'topais-kling-omni';
  }
  
  /**
   * 判断是否为 T8 Veo 模型（独立于 LingYa Veo 和 TOPAIS Veo）
   */
  static isT8Veo(modelId: string): boolean {
    return this.getFamily(modelId) === 'veo';
  }
  
  /**
   * 判断是否为支持模式切换的视频模型
   * （HappyHorse + TOPAIS HappyHorse + Seedance 2.0 + T8 Seedance + TOPAIS Veo + TOPAIS Seedance）
   */
  static isModeSwitchVideoModel(modelId: string): boolean {
    const family = this.getFamily(modelId);
    return family === 'happyhorse' || family === 'topais-happyhorse' || family === 'seedance2' || family === 't8seedance' || family === 'topais' || family === 'topais-seedance' || family === 'topais-gemini-omni' || family === 'mega-ai-seedance' || family === 'topais-minimax';
  }
  
  /**
   * #数据分流 判断模型后端是否在轮询过程中发送真实进度事件（type: 'progress'）
   * 
   * 【核心依据】逐行审查 route.ts 中每个模型处理器的 sendEvent({ type: 'progress' }) 调用：
   * - topais (L1989): 每次轮询发送 ✅
   * - topais-happyhorse (L1183): 每次轮询发送 ✅
   * - lingya-veo (L1556): 每次轮询发送 ✅
   * - veo/T8 Veo (L2685): 每次轮询发送 ✅
   * - happyhorse (L3203): 每次轮询发送 ✅
   * - seedance2 (L3741): 每次轮询发送 ✅
   * - t8seedance (L4209, L4783): 每次轮询发送 ✅
   * - sora/T8 Sora-2 (L5171): 每次轮询发送 ✅
   * - lingya-sora (L2363): 仅在完成时发送 progress:100，轮询中不发送 ❌
   * 
   * 【用途】前端决定是否启动假进度引擎：
   * - true → 不启动假进度，只用后端真实进度事件驱动
   * - false → 启动假进度引擎（VIDEO_CURVE），因为后端不提供中间进度
   */
  static hasBackendRealProgress(modelId: string): boolean {
    const family = this.getFamily(modelId);
    // lingya-sora 是唯一在轮询过程中不发送 progress 事件的视频模型
    // 它只在任务完成时发送一次 progress: 100
    return family !== 'lingya-sora';
  }
  
  /**
   * 判断是否为视频模型（包含所有供应商的 Veo、Sora、HappyHorse、Seedance 等）
   */
  static isVideoModel(modelId: string): boolean {
    const family = this.getFamily(modelId);
    return family === 'happyhorse' 
      || family === 'topais-happyhorse'
      || family === 'seedance2' 
      || family === 't8seedance'
      || family === 'topais'
      || family === 'topais-seedance'
      || family === 'topais-gemini-omni'
      || family === 'mega-ai-seedance'
      || family === 'topais-minimax'
      || family === 'lingya-veo'
      || family === 'lingya-sora'
      || family === 'veo'
      || family === 'sora';
  }
  
  /**
   * 获取模型显示名称
   */
  static getDisplayName(modelId: string): string {
    const family = this.getFamily(modelId);
    const id = modelId.toLowerCase();
    
    switch (family) {
      case 'happyhorse':
        return 'HappyHorse 1.0';
      case 'topais-happyhorse':
        return 'TOPAIS HappyHorse 1.1';
      case 'seedance2':
        return id.includes('fast') ? 'Seedance 2.0 Fast' : 'Seedance 2.0';
      case 't8seedance':
        return 'T8 Seedance';
      case 'topais':
        return 'TOPAIS Veo3.1';
      case 'topais-seedance':
      case 'mega-ai-seedance':
        return id.includes('fast') ? 'Seedance 2.0 Fast (TOPAIS)' : 'Seedance 2.0 (TOPAIS)';
      case 'topais-gemini-omni':
        return 'Gemini Omni Flash (TOPAIS)';
      case 'mega-ai-seedance':
        return 'Seedance 2.0 (MEGA AI)';
      case 'topais-minimax':
        return 'MiniMax H3 (ToAPIs)';
      case 'lingya-veo':
        return id.includes('4k') ? '灵芽 Veo3.1 4K' : '灵芽 Veo3.1';
      case 'lingya-sora':
        return 'Sora-2 VIP';
      case 'veo':
        return id.includes('pro') ? 'Veo3.1 Pro' : id.includes('components') ? 'Veo3.1 Components' : 'Veo3.1';
      case 'sora':
        return 'Sora 2';
      case 'gpt-image':
        return 'GPT Image 2';
      default:
        return modelId;
    }
  }
  
  /**
   * 获取模型 Logo 文件名
   */
  static getLogoFilename(modelId: string): string {
    const family = this.getFamily(modelId);
    
    switch (family) {
      case 'happyhorse':
        return '/happyhorse-logo.png';
      case 'topais-happyhorse':
        return '/happyhorse-logo.png';  // TOPAIS HappyHorse 使用相同 Logo（同一模型系列）
      case 'seedance2':
      case 't8seedance':
      case 'topais-seedance':
        return '/seedance-logo.png';
      case 'topais':
        return '/veo-logo.png';
      case 'topais-gemini-omni':
        return '/gemini-logo.png';  // TOPAIS Gemini Omni Flash 使用 Gemini Logo
      case 'topais-minimax':
        return '/minimax-logo.png';  // TOPAIS MiniMax H3 使用 MiniMax Logo
      case 'lingya-veo':
        return '/veo-logo.png';
      case 'lingya-sora':
        return '/gpt-image-2-logo.png';
      case 'veo':
        return '/veo-logo.png';
      case 'sora':
        return '/gpt-image-2-logo.png';
      case 'gpt-image':
        return '/gpt-image-2-logo.png';
      default:
        return '/default-logo.png';
    }
  }
}

/**
 * 导出便捷函数（兼容旧代码）
 */
export const isHappyHorseModel = (modelId: string) => ModelDetector.isHappyHorse(modelId);
export const isSeedance2Model = (modelId: string) => ModelDetector.isSeedance2(modelId);
export const isT8SeedanceModel = (modelId: string) => ModelDetector.isT8Seedance(modelId);
export const isAnySeedanceModel = (modelId: string) => ModelDetector.isAnySeedance(modelId);
export const isTopaisModel = (modelId: string) => ModelDetector.isTopais(modelId);
export const isTopaisSeedanceModel = (modelId: string) => ModelDetector.isTopaisSeedance(modelId);
export const isTopaisGeminiOmniModel = (modelId: string) => ModelDetector.isTopaisGeminiOmni(modelId);
export const isMegaAiSeedanceModel = (modelId: string) => ModelDetector.isMegaAiSeedance(modelId);
export const isTopaisMinimaxModel = (modelId: string) => ModelDetector.isTopaisMinimax(modelId);
export const isTopaisHappyHorseModel = (modelId: string) => ModelDetector.isTopaisHappyHorse(modelId);
export const isLingyaVeoModel = (modelId: string) => ModelDetector.isLingyaVeo(modelId);
export const isLingyaSoraModel = (modelId: string) => ModelDetector.isLingyaSora(modelId);
export const isT8VeoModel = (modelId: string) => ModelDetector.isT8Veo(modelId);
export const isModeSwitchVideoModel = (modelId: string) => ModelDetector.isModeSwitchVideoModel(modelId);
export const getModelFamily = (modelId: string) => ModelDetector.getFamily(modelId);

/**
 * ============================================
 * 二维矩阵：模型家族 × 支持的视频模式
 * ============================================
 * 
 * 【核心用途】跨模型安全校验
 * - 当用户切换模型时，旧模型的手动选择模式可能不被新模型支持
 * - 通过此矩阵校验，不兼容的模式会被降级到自动推导
 * 
 * 【矩阵定义】
 * - happyhorse: t2v, i2v, r2v, video-edit
 * - seedance2:  t2v, i2v, i2v-first-frame, i2v-first-last-frame, r2v
 * - t8seedance: t2v, i2v, i2v-first-frame, i2v-first-last-frame, r2v  (#667 T8 sdols-2.0 全模态解锁)
 * - 其他模型:   t2v (默认兜底)
 */
export const MODEL_MODE_CONSTRAINTS: Record<string, string[]> = {
  happyhorse: ['t2v', 'i2v', 'r2v', 'video-edit'],
  'topais-happyhorse': ['t2v', 'i2v', 'r2v', 'video-edit'],  // TOPAIS HappyHorse 独立模式矩阵
  seedance2: ['t2v', 'i2v', 'i2v-first-frame', 'i2v-first-last-frame', 'r2v'],
  t8seedance: ['t2v', 'i2v', 'i2v-first-frame', 'i2v-first-last-frame', 'r2v'],
  topais: ['t2v', 'i2v', 'r2v'],  // TOPAIS Veo 独立模式矩阵
  'topais-seedance': ['t2v', 'i2v', 'i2v-first-frame', 'i2v-first-last-frame', 'r2v'],  // TOPAIS Seedance 2.0 独立模式矩阵
  'topais-gemini-omni': ['t2v', 'i2v', 'r2v'],  // TOPAIS Gemini Omni Flash 独立模式矩阵（0/1/3 参考图，不支持 video-edit）
  'mega-ai-seedance': ['t2v', 'i2v-first-frame', 'i2v-first-last-frame', 'r2v'],  // MEGA AI Seedance 2.0 独立模式矩阵
  'topais-minimax': ['t2v', 'i2v-first-frame', 'i2v-first-last-frame', 'r2v'],  // TOPAIS MiniMax H3 独立模式矩阵
  'topais-kling-omni': ['t2v', 'i2v-first-frame', 'i2v-first-last-frame', 'r2v'],  // TOPAIS Kling v3 Omni 独立模式矩阵
  'lingya-veo': ['t2v'],          // LingYa Veo3.1 独立模式矩阵（不支持模式切换）
  'lingya-sora': ['t2v'],         // LingYa Sora-2 VIP 独立模式矩阵（不支持模式切换）
  // 'veo' 和 'sora'（T8 供应商）不支持模式切换，只有 t2v
  veo: ['t2v'],
  sora: ['t2v'],
  'gpt-image': ['t2v'],
  unknown: ['t2v'],
};

/**
 * 检查某个模式是否被当前模型家族支持
 * 
 * @param family - 模型家族（如 'happyhorse', 'seedance2'）
 * @param mode - 视频模式（如 'r2v', 'i2v-first-last-frame'）
 * @returns 该模式是否被当前模型支持
 */
export function isModeSupportedByFamily(family: string, mode: string): boolean {
  const supportedModes = MODEL_MODE_CONSTRAINTS[family] || MODEL_MODE_CONSTRAINTS.unknown;
  return supportedModes.includes(mode);
}

/**
 * ============================================
 * 服务商媒体物理极限字典 (PROVIDER_MEDIA_LIMITS)
 * ============================================
 * 
 * 【最高宪法】严禁在校验函数中硬编码魔法数字！
 * 即使今天 LingYa 和 T8 参数一致，也必须在物理上完全隔离。
 * 
 * 【核心原则】
 * - 每个服务商一份独立配置，绝不内存复用
 * - 格式拦截、大小拦截、时长拦截全部由此字典驱动
 * - 修改限制只需改这里，全链路自动生效
 */

/** 单媒体类型限制配置 */
export interface MediaTypeLimit {
  /** 最大文件数量 */
  maxCount: number;
  /** 总时长上限（秒）- 所有文件合计 */
  maxTotalDuration: number;
  /** 单段最短时长（秒） */
  minDuration: number;
  /** 单段最长时长（秒） */
  maxDuration: number;
  /** 单文件最大体积（MB） */
  maxSizeMB: number;
  /** 允许的 MIME 格式 */
  formats: string[];
}

/** 服务商媒体限制配置 */
export interface ProviderMediaLimit {
  video: MediaTypeLimit;
  audio: MediaTypeLimit;
}

/**
 * 服务商媒体物理极限字典
 * 
 * ⚠️ 每个服务商必须独立写一份，绝不允许复用！
 */
export const PROVIDER_MEDIA_LIMITS: Record<string, ProviderMediaLimit> = {
  // ========== LingYa Seedance 2.0 ==========
  // 官方文档约束（#655）：
  // - 音频不可单独传入：必须搭配至少1个图片或视频
  // - t2v 不支持音频
  // - 3段视频合计最多15秒，3段音频合计最多15秒
  'seedance2': {
    video: {
      maxCount: 3,
      maxTotalDuration: 15,
      minDuration: 2,
      maxDuration: 15,
      maxSizeMB: 50,
      formats: ['video/mp4', 'video/quicktime'],
    },
    audio: {
      maxCount: 3,
      maxTotalDuration: 15,
      minDuration: 0,     // 音频无最短时长限制
      maxDuration: 15,
      maxSizeMB: 15,
      formats: ['audio/wav', 'audio/mpeg'],
    },
  },

  // ========== T8 Star Seedance (sdols-*) ==========
  // 必须独立写一份，绝不允许与 seedance2 内存复用
  't8seedance': {
    video: {
      maxCount: 3,
      maxTotalDuration: 15,
      minDuration: 2,
      maxDuration: 15,
      maxSizeMB: 50,
      formats: ['video/mp4', 'video/quicktime'],
    },
    audio: {
      maxCount: 3,
      maxTotalDuration: 15,
      minDuration: 0,
      maxDuration: 15,
      maxSizeMB: 15,
      formats: ['audio/wav', 'audio/mpeg'],
    },
  },

  // ========== TOPAIS Seedance 2.0 (topais-seedance-2*) ==========
  // 必须独立写一份，绝不允许与 seedance2/t8seedance 内存复用
  // 基于 TOPAIS 官方文档：reference_image max 9, reference_video max 3, reference_audio max 3
  'topais-seedance': {
    video: {
      maxCount: 3,
      maxTotalDuration: 15,
      minDuration: 2,
      maxDuration: 15,
      maxSizeMB: 50,
      formats: ['video/mp4', 'video/quicktime'],
    },
    audio: {
      maxCount: 3,
      maxTotalDuration: 15,
      minDuration: 0,
      maxDuration: 15,
      maxSizeMB: 15,
      formats: ['audio/wav', 'audio/mpeg'],
    },
  },

  // ========== MEGA AI Seedance 2.0 (mega-ai-seedance-v2-720p) ==========
  // 必须独立写一份，绝不允许与 seedance2/t8seedance/topais-seedance 内存复用
  // MEGA AI 官方文档：images/videos/audios 字段支持，images最多9张，videos最多3段，audios最多3段
  'mega-ai-seedance': {
    video: {
      maxCount: 3,
      maxTotalDuration: 15,
      minDuration: 2,
      maxDuration: 15,
      maxSizeMB: 50,
      formats: ['video/mp4', 'video/quicktime'],
    },
    audio: {
      maxCount: 3,
      maxTotalDuration: 15,
      minDuration: 0,
      maxDuration: 15,
      maxSizeMB: 15,
      formats: ['audio/wav', 'audio/mpeg'],
    },
  },

  // ========== TOPAIS Kling v3 Omni (topais-kling-v3-omni) ==========
  // 必须独立写一份，绝不允许与其他服务商内存复用
  // 基于 ToAPIs Kling v3 Omni 官方文档：video_list 最多1段视频，不支持音频上传（audio 是生成标志）
  'topais-kling-omni': {
    video: {
      maxCount: 1,
      maxTotalDuration: 15,
      minDuration: 2,
      maxDuration: 15,
      maxSizeMB: 50,
      formats: ['video/mp4', 'video/quicktime'],
    },
    audio: {
      maxCount: 0,        // Kling v3 Omni 不支持音频上传（audio 是生成标志，不是素材上传）
      maxTotalDuration: 0,
      minDuration: 0,
      maxDuration: 0,
      maxSizeMB: 0,
      formats: [],
    },
  },
};

/**
 * 获取指定服务商的媒体限制配置
 * 
 * @param family - 模型家族（如 'seedance2', 't8seedance'）
 * @returns 媒体限制配置，未注册的家族返回 null
 */
export function getProviderMediaLimits(family: string): ProviderMediaLimit | null {
  return PROVIDER_MEDIA_LIMITS[family] ?? null;
}

/**
 * 校验文件格式是否允许
 * 
 * @param fileMimeType - 文件的 MIME 类型
 * @param allowedFormats - 允许的格式列表
 * @returns 是否通过格式校验
 */
export function isFormatAllowed(fileMimeType: string, allowedFormats: string[]): boolean {
  return allowedFormats.some(fmt => {
    if (fmt === 'audio/mpeg') {
      // audio/mpeg 兼容 audio/mp3
      return fileMimeType === 'audio/mpeg' || fileMimeType === 'audio/mp3';
    }
    if (fmt === 'video/quicktime') {
      // video/quicktime 兼容 .mov 文件
      return fileMimeType === 'video/quicktime' || fileMimeType === 'video/mp4';
    }
    return fileMimeType === fmt;
  });
}

/**
 * #655 读取视频文件的时长（秒）
 * 通过创建临时 <video> 元素加载视频并读取 duration
 * @param file - 视频文件
 * @returns Promise<number> 视频时长（秒）
 */
export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('无法读取视频时长'));
    };
    video.src = URL.createObjectURL(file);
  });
}

/**
 * #655 读取音频文件的时长（秒）
 * 通过创建临时 <audio> 元素加载音频并读取 duration
 * @param file - 音频文件
 * @returns Promise<number> 音频时长（秒）
 */
export function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(audio.src);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(audio.src);
      reject(new Error('无法读取音频时长'));
    };
    audio.src = URL.createObjectURL(file);
  });
}