import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

/**
 * 根据模型名称判断类型
 */
function inferModelType(modelKey: string): { type: string; configId: number } {
  const key = modelKey.toLowerCase();
  
  // 视频模型
  if (key.includes('sora') || key.includes('veo') || key.includes('video')) {
    return { type: 'video_generation', configId: 2 };
  }
  
  // 工具模型（不区分分辨率）
  if (key.includes('smart_split') || key.includes('split') || key.includes('upscale') || key.includes('enhance')) {
    return { type: 'tool', configId: 3 };
  }
  
  // 默认图片模型
  return { type: 'image_generation', configId: 1 };
}

/**
 * 基础宽高比列表（所有图片模型通用）
 */
const BASE_IMAGE_ASPECT_RATIOS = [
  { label: '自动', value: 'auto' },
  { label: '1:1', value: '1:1' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
  { label: '5:4', value: '5:4' },
  { label: '4:5', value: '4:5' },
  { label: '21:9', value: '21:9' },
];

/**
 * nano-banana-2 系列额外支持的宽高比
 * nano-banana-2, nano-banana-2-cl, nano-banana-2-4k-cl
 */
const BANANA2_EXTRA_ASPECT_RATIOS = [
  { label: '1:4', value: '1:4' },
  { label: '4:1', value: '4:1' },
  { label: '1:8', value: '1:8' },
  { label: '8:1', value: '8:1' },
];

/**
 * nano-banana-2 系列完整宽高比 = 基础 + 额外
 */
const BANANA2_ASPECT_RATIOS = [...BASE_IMAGE_ASPECT_RATIOS, ...BANANA2_EXTRA_ASPECT_RATIOS];

/**
 * 默认宽高比列表（视频模型）
 */
const DEFAULT_VIDEO_ASPECT_RATIOS = [
  { label: '自动', value: 'auto' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '1:1', value: '1:1' },
];

/**
 * 根据模型类型推断参数配置
 */
function inferParameters(credits: number, modelType: string, config?: any, modelKey?: string): any {
  // 判断是否为 nano-banana-2 系列（额外支持 1:4, 4:1, 1:8, 8:1）
  const isBanana2Series = modelKey && ['nano-banana-2', 'nano-banana-2-cl', 'nano-banana-2-4k-cl'].includes(modelKey.toLowerCase());
  const aspectRatios = isBanana2Series ? BANANA2_ASPECT_RATIOS : BASE_IMAGE_ASPECT_RATIOS;
  
  // 如果有自定义 resolutions，使用自定义配置
  if (config?.resolutions && Array.isArray(config.resolutions) && config.resolutions.length > 0) {
    if (modelType === 'video_generation') {
      return { durations: config.resolutions, aspectRatios: DEFAULT_VIDEO_ASPECT_RATIOS };
    }
    return { resolutions: config.resolutions, aspectRatios: aspectRatios };
  }
  
  if (modelType === 'video_generation') {
    return {
      durations: [
        { label: '5秒', value: '5s', credits: credits },
        { label: '10秒', value: '10s', credits: credits * 2 },
      ],
      aspectRatios: DEFAULT_VIDEO_ASPECT_RATIOS,
    };
  }
  
  if (modelType === 'tool') {
    return { credits_base: credits };
  }
  
  // 特定模型的分辨率支持（按特定性从高到低匹配）
  if (modelKey) {
    const key = modelKey.toLowerCase();
    
    // ===== 只支持 4K 的模型 =====
    if (key === 'nano-banana-2-4k-cl' || key === 'nano-banana-pro-4k-vip') {
      return {
        resolutions: [
          { label: '4K', value: '4K', credits: credits },
        ],
        aspectRatios: aspectRatios,
      };
    }
    
    // ===== 只支持 1K 的模型 =====
    if (key === 'nano-banana' || key === 'nano-banana-fast') {
      return {
        resolutions: [
          { label: '1K', value: '1K', credits: credits },
        ],
        aspectRatios: aspectRatios,
      };
    }
    
    // ===== 只支持 1K, 2K 的模型 =====
    if (key === 'nano-banana-2-cl' || key === 'nano-banana-pro-vip') {
      return {
        resolutions: [
          { label: '1K', value: '1K', credits: credits },
          { label: '2K', value: '2K', credits: Math.round(credits * 1.2) },
        ],
        aspectRatios: aspectRatios,
      };
    }
    
    // ===== 支持 1K, 2K, 4K 的模型 =====
    if (key === 'nano-banana-2' || 
        key === 'nano-banana-pro' || 
        key === 'nano-banana-pro-vt' || 
        key === 'nano-banana-pro-cl') {
      return {
        resolutions: [
          { label: '1K', value: '1K', credits: credits },
          { label: '2K', value: '2K', credits: Math.round(credits * 1.2) },
          { label: '4K', value: '4K', credits: Math.round(credits * 1.5) },
        ],
        aspectRatios: aspectRatios,
      };
    }
  }
  
  // 默认支持所有分辨率
  return {
    resolutions: [
      { label: '1K', value: '1K', credits: credits },
      { label: '2K', value: '2K', credits: Math.round(credits * 1.2) },
      { label: '4K', value: '4K', credits: Math.round(credits * 1.5) },
    ],
    aspectRatios: aspectRatios,
  };
}

// 获取前端可用的配置（公开接口）
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const serviceType = searchParams.get('service_type') || 'image_generation';

    console.log(`[config] 开始查询配置, serviceType=${serviceType}`);
    console.log(`[config] DEBUG: NODE_ENV=${process.env.NODE_ENV}`);
    console.log(`[config] DEBUG: DB URL=${(process.env.SUPABASE_URL || '').substring(0, 50)}...`);
    
    // 检查 service role key 是否正确
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    console.log(`[config] DEBUG: Service Role Key prefix=${serviceKey.substring(0, 30)}...`);
    console.log(`[config] DEBUG: Service Role Key length=${serviceKey.length}`);

    const supabase = getSupabaseClient(undefined, true);
    
    // DEBUG: 直接查询 nano-banana-2 的原始数据
    const { data: debugData } = await supabase
      .from('api_models')
      .select('model_id, credits_base, parameters')
      .eq('model_id', 'nano-banana-2')
      .single();
    console.log(`[config] DEBUG direct query: ${JSON.stringify(debugData)}`);

    // 获取该服务类型的所有 API 配置（包括离线的，以便前端显示离线模型）
    const { data: configs, error: configsError } = await supabase
      .from('api_configs')
      .select('*')
      .eq('service_type', serviceType)
      .order('sort_order');

    console.log(`[config] 查询 api_configs 结果: ${configs?.length || 0} 条, error=${configsError?.message || 'none'}`);

    // 获取所有配置下的模型（不过滤 is_active，全部返回，由前端显示在线/离线状态）
    // #202 临时修复：用户 Supabase 数据库可能缺少 is_visible 字段，需要兼容处理
    const configIds = (configs || []).map(c => c.id);
    console.log(`[config] configIds=${JSON.stringify(configIds)}`);

    // 先尝试带 is_visible 的查询
    const modelsResultWithVisible = await supabase
      .from('api_models')
      .select('id, config_id, model_id, model_name, description, api_endpoint, parameters, credits_base, sort_order, is_active, is_visible')
      .in('config_id', configIds.length > 0 ? configIds : [0])
      .order('sort_order');

    let models: any[] | null;
    let modelsError: any;

    // 如果 is_visible 字段不存在，回退到不带该字段的查询
    if (modelsResultWithVisible.error?.message?.includes('is_visible')) {
      console.log('[config] is_visible 字段不存在，回退到基础查询');
      const modelsResultFallback = await supabase
        .from('api_models')
        .select('id, config_id, model_id, model_name, description, api_endpoint, parameters, credits_base, sort_order, is_active')
        .in('config_id', configIds.length > 0 ? configIds : [0])
        .order('sort_order');
      models = modelsResultFallback.data;
      modelsError = modelsResultFallback.error;
    } else {
      models = modelsResultWithVisible.data;
      modelsError = modelsResultWithVisible.error;
    }

    console.log(`[config] 查询 api_models 结果: ${models?.length || 0} 条, error=${modelsError?.message || 'none'}`);

    // #204 统一数据源：完全使用 api_models 表，不再依赖 model_credits_config
    // 管理后台修改的是 api_models 表，前端应该直接使用该表的数据
    const modelsWithEndpoint = (models || []).map(model => {
      const config = (configs || []).find(c => c.id === model.config_id);
      const { type } = inferModelType(model.model_id);
      
      // 直接从 api_models 读取
      const finalCredits = model.credits_base || 10;
      const finalIsActive = model.is_active !== false;
      
      // 构建最终参数
      let finalParameters: any = {};

      // resolutions/durations: 直接使用 api_models.parameters
      const dbResolutions = model.parameters?.resolutions;
      
      // DEBUG: 打印 nano-banana-2 的数据
      if (model.model_id === 'nano-banana-2') {
        console.log(`[config] DEBUG nano-banana-2: credits_base=${model.credits_base}, dbResolutions=${JSON.stringify(dbResolutions)}`);
      }
      
      if (dbResolutions && dbResolutions.length > 0) {
        if (type === 'video_generation') {
          finalParameters.durations = dbResolutions;
        } else {
          finalParameters.resolutions = dbResolutions;
        }
      } else {
        // 没有配置则推断默认值
        const inferred = inferParameters(finalCredits, type, null, model.model_id);
        if (type === 'video_generation') {
          finalParameters.durations = inferred?.durations || [];
        } else {
          finalParameters.resolutions = inferred?.resolutions || [];
        }
      }
      
      // aspectRatios: 从 api_models.parameters 读取
      const dbAspectRatios = model.parameters?.aspectRatios;
      if (dbAspectRatios?.length > 0) {
        finalParameters.aspectRatios = dbAspectRatios;
      } else {
        const inferred = inferParameters(finalCredits, type, null, model.model_id);
        finalParameters.aspectRatios = inferred?.aspectRatios || [];
      }
      
      return {
        ...model,
        parameters: finalParameters,
        model_name: model.model_name,
        description: model.description,
        credits: finalCredits,
        final_api_endpoint: model.api_endpoint || config?.api_endpoint,
        config_name: config?.name,
        is_active: finalIsActive,
      };
    });

    // 合并所有模型，按硬编码排序映射排序
    // 注意：Gemini 已插入 api_models 表，不再需要 additionalModels 补充
    const MODEL_SORT_ORDER: Record<string, number> = {
      // 图片生成模型
      'nano-banana-fast': 1,
      'nano-banana': 2,
      'nano-banana-2': 3,
      'nano-banana-2-cl': 4,
      'nano-banana-2-4k-cl': 5,
      'nano-banana-pro': 6,
      'nano-banana-pro-vt': 7,
      'nano-banana-pro-cl': 8,
      'nano-banana-pro-vip': 9,
      'nano-banana-pro-4k-vip': 10,
      'gemini-3-Flash-image-preview': 11,
      // 视频生成模型
      'grs-sora-2': 1,
      // 工具模型
      'smart_split': 1,
      'longcat_upscale': 2,
    };
    const allModels = [...modelsWithEndpoint].sort((a, b) => {
      return (MODEL_SORT_ORDER[a.model_id] ?? 999) - (MODEL_SORT_ORDER[b.model_id] ?? 999);
    });

    // 🔧 重构：直接使用数据库 is_visible 和 is_active 字段过滤
    // 移除 hidden-models.json 的双头管理模式
    const visibleModels = allModels.filter(m => 
      m.is_active !== false && m.is_visible !== false
    );

    console.log(`[config] 模型过滤: 总数=${allModels.length}, 可见=${visibleModels.length}`);

    // 如果没有任何模型，返回错误
    if (allModels.length === 0) {
      return NextResponse.json({
        success: false,
        error: '没有可用的模型配置',
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        // 所有配置
        configs: configs || [],
        // 所有配置的模型列表
        models: visibleModels,
      },
    });
  } catch (error) {
    console.error('获取配置失败:', error);
    return NextResponse.json({
      success: false,
      error: '获取配置失败',
    }, { status: 500 });
  }
}
