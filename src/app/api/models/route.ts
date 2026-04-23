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
  
  // 工具模型
  if (key.includes('smart_split') || key.includes('split') || key.includes('upscale') || key.includes('enhance')) {
    return { type: 'tool', configId: 3 };
  }
  
  // 默认图片模型
  return { type: 'image_generation', configId: 1 };
}

/**
 * 根据模型名称判断支持的分辨率
 * 关键规则：
 * - nano-banana-2-4k-cl / nano-banana-pro-4k-vip: 只支持 4K
 * - nano-banana / nano-banana-fast: 只支持 1K
 * - nano-banana-2-cl / nano-banana-pro-vip: 只支持 1K, 2K
 * - 其他模型: 支持 1K, 2K, 4K
 */
function inferImageResolutions(modelId: string, creditsBase: number): { label: string; value: string; credits: number }[] {
  const key = modelId.toLowerCase();
  
  // ===== 只支持 4K 的模型 =====
  if (key === 'nano-banana-2-4k-cl' || key === 'nano-banana-pro-4k-vip') {
    return [
      { label: '4K', value: '4K', credits: creditsBase || 10 }
    ];
  }
  
  // ===== 只支持 1K 的模型 =====
  if (key === 'nano-banana' || key === 'nano-banana-fast') {
    return [
      { label: '1K', value: '1K', credits: creditsBase || 10 }
    ];
  }
  
  // ===== 只支持 1K, 2K 的模型 =====
  if (key === 'nano-banana-2-cl' || key === 'nano-banana-pro-vip') {
    return [
      { label: '1K', value: '1K', credits: creditsBase || 10 },
      { label: '2K', value: '2K', credits: creditsBase ? Math.round(creditsBase * 1.2) : 12 }
    ];
  }
  
  // ===== 支持 1K, 2K, 4K 的模型（默认） =====
  return [
    { label: '1K', value: '1K', credits: creditsBase || 10 },
    { label: '2K', value: '2K', credits: creditsBase ? Math.round(creditsBase * 1.2) : 12 },
    { label: '4K', value: '4K', credits: creditsBase ? Math.round(creditsBase * 1.5) : 15 }
  ];
}

/**
 * 根据模型类型推断分辨率配置
 */
function inferResolutions(modelId: string, credits: number, modelType: string, config?: any): any {
  if (modelType === 'video_generation') {
    // 视频模型：使用 durations
    const credits5s = config?.credits_5s ?? credits;
    const credits10s = config?.credits_10s ?? credits * 2;
    return {
      durations: [
        { label: '5秒', value: '5s', credits: credits5s },
        { label: '10秒', value: '10s', credits: credits10s },
      ],
    };
  }
  
  if (modelType === 'tool') {
    // 工具模型：不区分分辨率
    return {
      credits_base: credits,
    };
  }
  
  // 图片模型：根据模型名称判断支持的分辨率
  return {
    resolutions: inferImageResolutions(modelId, credits),
  };
}

// 获取模型列表（供前端同步配置使用）
// #204 统一数据源：完全从 api_models 表读取，不再依赖 model_credits_config
// #045 修改：返回所有模型（包括禁用的），前端根据 is_active 显示状态
export async function GET() {
  try {
    const supabase = await getSupabaseClient(undefined, true);
    
    // 从 api_models 表获取所有模型（不再过滤 is_active）
    const { data: apiModels, error: apiModelsError } = await supabase
      .from('api_models')
      .select('model_id, model_name, description, parameters, credits_base, is_active, sort_order, api_endpoint, config_id')
      .order('sort_order', { ascending: true });

    if (apiModelsError) {
      console.error('获取 api_models 失败:', apiModelsError);
    }

    // 直接使用 api_models 的数据
    const mergedModels: any[] = [];

    (apiModels || []).forEach((model: any) => {
      // 判断是否为视频模型
      const isVideo = model.model_id.includes('sora') || 
                     model.model_id.includes('veo') ||
                     model.model_id.includes('video') ||
                     (model.parameters?.durations && model.parameters.durations.length > 0);
      
      // 判断是否为工具模型
      const isTool = model.model_id.includes('smart_split') || 
                     model.model_id.includes('split') ||
                     model.model_id.includes('upscale') ||
                     model.model_id.includes('enhance') ||
                     (model.parameters?.credits_base !== undefined);
      
      const modelType = isVideo ? 'video_generation' : (isTool ? 'tool' : 'image_generation');
      
      // 处理 parameters
      let parameters = model.parameters;
      
      // 视频模型：确保有 durations
      if (isVideo) {
        if (model.parameters?.durations && model.parameters.durations.length > 0) {
          // 已有 durations，直接使用
          parameters = model.parameters;
        } else if (model.parameters?.resolutions && model.parameters.resolutions.length > 0) {
          // 数据库存储在 resolutions 字段，转为 durations
          parameters = { durations: model.parameters.resolutions };
        } else {
          // 没有任何配置，推断默认值
          parameters = inferResolutions(model.model_id, model.credits_base, modelType, null);
        }
      } else if (!model.parameters || Object.keys(model.parameters).length === 0) {
        // 非视频模型且没有 parameters，推断默认值
        parameters = inferResolutions(model.model_id, model.credits_base, modelType, null);
      }
      
      mergedModels.push({
        model_id: model.model_id,
        model_name: model.model_name || model.model_id,
        description: model.description || '',
        parameters: parameters,
        credits_base: model.credits_base || 10,
        is_active: model.is_active,
        sort_order: model.sort_order || 100,
        api_endpoint: model.api_endpoint,
        config_id: model.config_id,
        source: 'api_models',
      });
    });

    console.log(`[Models API] 返回 ${mergedModels.length} 个模型`);

    return NextResponse.json({
      success: true,
      data: {
        models: mergedModels,
        updated_at: new Date().toISOString(),
      }
    });
  } catch (err) {
    console.error('API 错误:', err);
    return NextResponse.json({ 
      success: false, 
      error: '服务器内部错误' 
    }, { status: 500 });
  }
}
