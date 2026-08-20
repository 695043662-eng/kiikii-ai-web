/**
 * 全局模型静态配置注册表
 * 集中管理系统支持的所有模型，供前端动态渲染和批量测试使用
 * 
 * ⚠️ 防扣费铁律（CRITICAL）：
 * testPayload 必须在参数校验层被 400 驳回，绝不能被服务商当作合法请求执行！
 * - 图片模型：用物理不可能的分辨率 (size: "1x1", aspectRatio: "0x0")
 * - 视频模型：用无效 base64 + 负数时长 (duration: -99)
 * - LLM 模型：用负数 token + 越界温度 (max_tokens: -100, temperature: 999)
 * 
 * 鉴权通过 → 参数校验报错 = 活🟢 (密钥有效，0扣费)
 * 鉴权失败 → 401/403 = 死🔴 (密钥无效)
 * 鉴权通过 → 参数合法 → 生成图片 = 💸扣费! (绝对禁止!)
 */

export interface ModelConfigItem {
  /** 实际请求底层的 model 标识（对应 api_models.model_id） */
  id: string;
  /** 清晰的显示名称 */
  name: string;
  /** 归属服务商 */
  provider: string;
  /** 归属接口分组（对应 api_configs.service_type） */
  serviceType: 'image_generation' | 'video_generation' | 'llm' | 'tool';
  /** 已有的配置参数描述 */
  parameters: string;
  /** 故意触发官方"参数校验错误(0扣费)"的畸形变量集合 */
  testVariables: Record<string, any>;
}

/**
 * 图片模型通用畸形 testVariables
 * 核心策略：aspectRatio/size 写成非数字字符串 + prompt 留空，
 * 确保服务商在参数校验层立刻 400，绝不走到实际生成流程
 */
const IMAGE_TEST_VARIABLES = {
  _skipPixelMapping: true,
  prompt: '',
  aspectRatio: 'INVALID_RATIO_XXXXXX',
  size: '-999999x-999999',
  resolution: 'INVALID_RES',
  n: -1,
  urls: [],
  referenceImages: [],
  image: [],
  images: [],
};

/**
 * T8Star VIP 图片模型畸形 testVariables（额外含 quality 字段）
 */
const IMAGE_VIP_TEST_VARIABLES = {
  ...IMAGE_TEST_VARIABLES,
  quality: 'INVALID_QUALITY_TRIGGER_ERROR',
};

/**
 * 视频模型通用畸形 testVariables
 * 核心策略：aspect_ratio 写成非数字字符串，duration 写成负数，
 * images 塞入无效 base64 字符串（触发图片解码错误），prompt 留空
 */
const VIDEO_TEST_VARIABLES = {
  _skipPixelMapping: true,
  prompt: '',
  aspect_ratio: 'INVALID_RATIO_XXXXXX',
  duration: -99,
  resolution: 'INVALID_RES',
  images: ['NOT_VALID_BASE64_!!!@#$%^&*()'],
};

/**
 * Veo 视频模型畸形 testVariables（额外含 enable_upsample）
 */
const VEO_TEST_VARIABLES = {
  ...VIDEO_TEST_VARIABLES,
  enable_upsample: false,
};

/**
 * LLM / 工具模型畸形 testVariables
 * 核心策略：max_tokens 为负数，temperature 越界
 */
const LLM_TEST_VARIABLES = {
  _skipPixelMapping: true,
  prompt: '',
  messages: [{ role: 'user', content: '' }],
  max_tokens: -100,
  temperature: 999,
};

/**
 * 系统模型注册表
 * testVariables 中的变量会被传入 buildRequest() 替换模板占位符
 * 
 * ⚠️ 防扣费铁律：所有 testVariables 必须触发 400 Bad Request / Invalid Parameter！
 * 绝不能发送合法参数导致服务商实际执行生成！
 */
export const SYSTEM_MODELS_REGISTRY: ModelConfigItem[] = [
  // ===== 图片模型 - T8Star =====
  {
    id: 't8star.gpt-image-2',
    name: 'T8 GPT-Image-2 VIP',
    provider: 'T8Star',
    serviceType: 'image_generation',
    parameters: '1K / 2K / 4K | 各种比例 | quality: auto/medium/high',
    testVariables: { ...IMAGE_VIP_TEST_VARIABLES },
  },

  // ===== 图片模型 - GRS =====
  {
    id: 'gpt-image-2',
    name: 'GPT-Image-2 (GRS)',
    provider: 'GRS',
    serviceType: 'image_generation',
    parameters: '1K | 各种比例',
    testVariables: { ...IMAGE_VIP_TEST_VARIABLES },
  },
  {
    id: 'gpt-image-2-vip',
    name: 'GPT-Image-2 VIP (GRS)',
    provider: 'GRS',
    serviceType: 'image_generation',
    parameters: '1K / 2K / 4K | 各种比例 | quality: auto/medium/high',
    testVariables: { ...IMAGE_VIP_TEST_VARIABLES },
  },

  // ===== 图片模型 - Banana 系列 =====
  {
    id: 'nano-banana',
    name: 'Banana 经典生图',
    provider: 'GRS',
    serviceType: 'image_generation',
    parameters: '1K | 各种比例',
    testVariables: { ...IMAGE_TEST_VARIABLES },
  },
  {
    id: 'nano-banana-fast',
    name: 'Banana 快速生图',
    provider: 'GRS',
    serviceType: 'image_generation',
    parameters: '1K | 各种比例',
    testVariables: { ...IMAGE_TEST_VARIABLES },
  },
  {
    id: 'nano-banana-2',
    name: 'Banana-2 高级生图',
    provider: 'GRS',
    serviceType: 'image_generation',
    parameters: '1K / 2K / 4K | 含1:4/4:1/1:8/8:1超宽比例',
    testVariables: { ...IMAGE_TEST_VARIABLES },
  },
  // ===== 图片模型 - Banana-2 CL（#681 合并：4K 由分辨率选择器动态驱动，后端 mapToRealBananaModel 路由到真实 API 模型） =====
  {
    id: 'nano-banana-2-cl',
    name: 'Banana-2 CL 生图',
    provider: 'GRS',
    serviceType: 'image_generation',
    parameters: '1K / 2K / 4K | 各种比例',
    testVariables: { ...IMAGE_TEST_VARIABLES },
  },
  {
    id: 'nano-banana-pro',
    name: 'Banana Pro 生图',
    provider: 'GRS',
    serviceType: 'image_generation',
    parameters: '1K / 2K / 4K | 各种比例',
    testVariables: { ...IMAGE_TEST_VARIABLES },
  },
  // ===== 图片模型 - Banana Pro VIP（#681 合并：4K 由分辨率选择器动态驱动，后端 mapToRealBananaModel 路由到真实 API 模型） =====
  {
    id: 'nano-banana-pro-vip',
    name: 'Banana Pro VIP 生图',
    provider: 'GRS',
    serviceType: 'image_generation',
    parameters: '1K / 2K / 4K | 各种比例',
    testVariables: { ...IMAGE_TEST_VARIABLES },
  },
  {
    id: 'nano-banana-pro-vt',
    name: 'Banana Pro VT 生图',
    provider: 'GRS',
    serviceType: 'image_generation',
    parameters: '1K / 2K / 4K | 各种比例',
    testVariables: { ...IMAGE_TEST_VARIABLES },
  },
  {
    id: 'nano-banana-pro-cl',
    name: 'Banana Pro CL 生图',
    provider: 'GRS',
    serviceType: 'image_generation',
    parameters: '1K / 2K / 4K | 各种比例',
    testVariables: { ...IMAGE_TEST_VARIABLES },
  },

  // ===== 视频模型 - T8Star Veo =====
  {
    id: 'veo3.1-fast',
    name: 'Veo 3.1 Fast 帧转视频',
    provider: 'T8Star',
    serviceType: 'video_generation',
    parameters: '720P / 1080P | 16:9 等比例 | 5-8秒 | 支持参考图',
    testVariables: { ...VEO_TEST_VARIABLES },
  },
  {
    id: 'veo3.1-pro',
    name: 'Veo 3.1 Pro 帧转视频',
    provider: 'T8Star',
    serviceType: 'video_generation',
    parameters: '720P / 1080P | 16:9 等比例 | 5-8秒 | 支持参考图',
    testVariables: { ...VEO_TEST_VARIABLES },
  },
  {
    id: 'veo3-components',
    name: 'Veo 3 Components',
    provider: 'T8Star',
    serviceType: 'video_generation',
    parameters: '720P / 1080P | 16:9 等比例 | 5-8秒 | 支持参考图',
    testVariables: { ...VEO_TEST_VARIABLES },
  },
  {
    id: 'veo3.1',
    name: 'Veo 3.1 视频生成',
    provider: 'T8Star',
    serviceType: 'video_generation',
    parameters: '720P / 1080P | 16:9 等比例 | 5-8秒 | 支持参考图',
    testVariables: { ...VEO_TEST_VARIABLES },
  },

  // ===== 视频模型 - Lingya Veo3.1 (OpenAI 兼容格式) =====
  // #638 双模型收口：前端只展示 Fast 和标准版两个入口
  // 4K 由分辨率选择器动态驱动，后端 mapToRealLingyaModel 路由到真实 API 模型
  {
    id: 'veo_3_1-fast',
    name: 'Veo 3.1 Fast',
    provider: 'LingYa',
    serviceType: 'video_generation',
    parameters: '720P / 4K | 固定8秒 | 16:9/9:16 | 支持首尾帧',
    testVariables: { ...VIDEO_TEST_VARIABLES },
  },

  // ===== #689 视频模型 - TOPAIS Veo3.1-fast（独立供应商，POST /v1/videos/generations 异步任务）=====
  {
    id: 'topais-veo3.1-fast',
    name: 'Veo 3.1 Fast (TOPAIS)',
    provider: 'TOPAIS',
    serviceType: 'video_generation',
    parameters: '720P / 1080P / 4K | 固定8秒 | 16:9/9:16 | 文生视频/首尾帧/参考图(1-3张)',
    testVariables: { ...VIDEO_TEST_VARIABLES },
  },
  {
    id: 'veo_3_1',
    name: 'Veo 3.1',
    provider: 'LingYa',
    serviceType: 'video_generation',
    parameters: '720P / 4K | 固定8秒 | 16:9/9:16 | 支持首尾帧',
    testVariables: { ...VIDEO_TEST_VARIABLES },
  },

  // ===== 视频模型 - T8Star Sora =====
  {
    id: 'sora-2',
    name: 'Sora-2 高清视频',
    provider: 'T8Star',
    serviceType: 'video_generation',
    parameters: '720P / 1080P | 16:9/9:16 等比例 | 5秒/10秒 | 固定计费',
    testVariables: { ...VIDEO_TEST_VARIABLES },
  },

  // ===== 视频模型 - 灵芽 Sora-2 VIP（#641 前端2合1：统一入口，内部时长选择） =====
  {
    id: 'sora-2-all-vip',
    name: 'Sora-2 VIP',
    provider: 'LingYa',
    serviceType: 'video_generation',
    parameters: '16:9/9:16 | 10秒/15秒可选 | 支持首帧参考 | 60-90积分/次',
    testVariables: { ...VIDEO_TEST_VARIABLES },
  },

  // ===== 视频模型 - T8Star Seedance 1.0（sdols 通道）=====
  {
    id: 'sdols-01-pro',
    name: 'Seedance 01 Pro 视频生成',
    provider: 'T8Star',
    serviceType: 'video_generation',
    parameters: '480P/720P/1080P | 4-15秒 | 16:9/4:3/1:1/3:4/9:16/21:9/adaptive | 支持参考图/视频/音频',
    testVariables: { ...VIDEO_TEST_VARIABLES },
  },
  {
    id: 'sdols-01-lite',
    name: 'Seedance 01 Lite 视频生成',
    provider: 'T8Star',
    serviceType: 'video_generation',
    parameters: '480P/720P/1080P | 4-15秒 | 16:9/4:3/1:1/3:4/9:16/21:9/adaptive | 支持参考图/视频/音频',
    testVariables: { ...VIDEO_TEST_VARIABLES },
  },

  // ===== 视频模型 - 灵芽 Seedance 2.0（#642 新增：火山方舟 Seedance 2.0 多模态） =====
  {
    id: 'seedance-2',
    name: 'Seedance 2.0 视频生成',
    provider: 'LingYa',
    serviceType: 'video_generation',
    parameters: '480P/720P/1080P | 4-15秒 | 16:9/4:3/1:1 等7种比例 | 文生/首帧/首尾帧/参考生四模式 | 含视频输入自动折扣',
    testVariables: { ...VIDEO_TEST_VARIABLES },
  },
  {
    id: 'seedance-2-fast',
    name: 'Seedance 2.0 Fast 视频生成',
    provider: 'LingYa',
    serviceType: 'video_generation',
    parameters: '480P/720P | 4-15秒 | 16:9/4:3/1:1 等7种比例 | 文生/首帧/首尾帧/参考生四模式 | 含视频输入自动折扣',
    testVariables: { ...VIDEO_TEST_VARIABLES },
  },

  // ===== 视频模型 - 灵芽 HappyHorse =====
  {
    id: 'happyhorse-1.0',
    name: 'HappyHorse 1.0 视频生成',
    provider: 'LingYa',
    serviceType: 'video_generation',
    parameters: '720P / 1080P | 3-15秒 | 16:9 等比例 | 文生/图生/参考/编辑四合一',
    testVariables: { ...VIDEO_TEST_VARIABLES },
  },

  // ===== 视频模型 - ToAPIs MiniMax-H3（#850 新增：ToAPIs MiniMax Hailuo H3 多模态视频） =====
  {
    id: 'topais-minimax',
    name: 'MiniMax-H3 视频生成',
    provider: 'ToAPIs',
    serviceType: 'video_generation',
    parameters: '2K固定 | 4-15秒 | 16:9 等7种比例 | 文生/首帧/首尾帧/参考生四模式 | 支持参考视频/音频',
    testVariables: { ...VIDEO_TEST_VARIABLES },
  },

  // ===== LLM 模型 - GRS =====
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4 (GRS)',
    provider: 'GRS',
    serviceType: 'llm',
    parameters: '流式文本生成 | 用于画布对话',
    testVariables: { ...LLM_TEST_VARIABLES },
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5 (GRS)',
    provider: 'GRS',
    serviceType: 'llm',
    parameters: '流式文本生成 | 用于画布对话',
    testVariables: { ...LLM_TEST_VARIABLES },
  },

  // ===== LLM 模型 - Google =====
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro 文本生成',
    provider: 'Google',
    serviceType: 'llm',
    parameters: '流式文本生成 | 用于智能分割/画布对话',
    testVariables: { ...LLM_TEST_VARIABLES },
  },

  // ===== 工具模型 =====
  {
    id: 'smart_split',
    name: '智能分割',
    provider: 'Google',
    serviceType: 'tool',
    parameters: 'Gemini 3.1 Pro 驱动 | 固定积分',
    testVariables: { ...LLM_TEST_VARIABLES },
  },
];

/**
 * 根据 model_id 查找注册表项
 */
export function findModelInRegistry(modelId: string): ModelConfigItem | undefined {
  return SYSTEM_MODELS_REGISTRY.find(m => m.id === modelId);
}

/**
 * 获取所有服务商标签及颜色映射
 */
export const PROVIDER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  LingYa: { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-300 dark:border-blue-700' },
  T8Star: { bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-300 dark:border-purple-700' },
  GRS: { bg: 'bg-gray-100 dark:bg-gray-900/40', text: 'text-gray-700 dark:text-gray-300', border: 'border-gray-300 dark:border-gray-700' },
  Google: { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-300 dark:border-amber-700' },
  ToAPIs: { bg: 'bg-teal-100 dark:bg-teal-900/40', text: 'text-teal-700 dark:text-teal-300', border: 'border-teal-300 dark:border-teal-700' },
};
