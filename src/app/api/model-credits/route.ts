import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// #859 斩断所有缓存层
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 根据模型名称判断类型
 */
function inferModelType(modelKey: string): { type: string; configId: number } {
  const key = modelKey.toLowerCase();
  
  // 视频模型
  if (key.includes('sora') || key.includes('veo') || key.includes('video') || key.includes('seedance') || key.includes('sdols') || key.includes('kling') || key.includes('happyhorse')) {
    return { type: 'video_generation', configId: 2 };
  }
  
  // LLM 模型（不区分分辨率）- 归类为工具模型
  if (key.includes('gemini') || key.includes('gpt-5') || key.includes('deepseek') || key.includes('qwen') || key.includes('smart_split') || key.includes('split') || key.includes('upscale') || key.includes('enhance')) {
    return { type: 'tool', configId: 3 };
  }
  
  // 默认图片模型
  return { type: 'image_generation', configId: 1 };
}

/**
 * 根据模型类型推断参数配置
 */
function inferParameters(credits: number, modelType: string, config?: any, modelKey?: string): any {
  // 如果有自定义 resolutions，使用自定义配置
  if (config?.resolutions && Array.isArray(config.resolutions) && config.resolutions.length > 0) {
    if (modelType === 'video_generation') {
      return { durations: config.resolutions };
    }
    return { resolutions: config.resolutions };
  }
  
  if (modelType === 'video_generation') {
    return {
      durations: [
        { label: '5秒', value: '5s', credits: credits },
        { label: '10秒', value: '10s', credits: credits * 2 },
      ],
    };
  }
  
  if (modelType === 'tool') {
    return { credits_base: credits };
  }
  
  // 特定模型的分辨率支持（按特定性从高到低匹配）
  // #680 Banana 模型合并：nano-banana-2-cl 和 nano-banana-pro-vip 现在也支持 4K（后端自动路由到 4K 模型）
  if (modelKey) {
    const key = modelKey.toLowerCase();
    
    // ===== 只支持 1K 的模型 =====
    if (key === 'nano-banana' || key === 'nano-banana-fast') {
      return {
        resolutions: [
          { label: '1K', value: '1K', credits: credits },
        ],
      };
    }
    
    // ===== 支持 1K, 2K, 4K 的模型 =====
    if (key === 'nano-banana-2' || 
        key === 'nano-banana-2-cl' || 
        key === 'nano-banana-pro' || 
        key === 'nano-banana-pro-vip' || 
        key === 'nano-banana-pro-vt' || 
        key === 'nano-banana-pro-cl') {
      return {
        resolutions: [
          { label: '1K', value: '1K', credits: credits },
          { label: '2K', value: '2K', credits: Math.round(credits * 1.2) },
          { label: '4K', value: '4K', credits: Math.round(credits * 1.5) },
        ],
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
  };
}

// GET /api/model-credits - 获取启用的模型积分配置（公开接口）
// #204 统一数据源：完全从 api_models 表读取，不再依赖 model_credits_config
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);

    // 从 api_models 表获取启用的模型
    const { data: apiModels, error: apiModelsError } = await client
      .from('api_models')
      .select('model_id, model_name, description, parameters, credits_base, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (apiModelsError) {
      throw apiModelsError;
    }

    // 转换为对象格式，直接使用 api_models 中的数据
    const configMap: Record<string, { name: string; credits_base: number; description?: string; resolutions?: any[] }> = {};
    apiModels?.forEach((model: any) => {
      const { type } = inferModelType(model.model_id);
      
      let finalResolutions: any[] = [];
      
      // 直接使用 api_models 中的 parameters.resolutions
      const dbResolutions = model.parameters?.resolutions || model.parameters?.durations;
      if (dbResolutions?.length > 0) {
        finalResolutions = dbResolutions;
      } else {
        // 如果没有配置，使用 inferParameters 生成
        const finalParameters = inferParameters(model.credits_base, type, null, model.model_id);
        finalResolutions = finalParameters.resolutions || [];
      }
      
      configMap[model.model_id] = {
        name: model.model_name,
        credits_base: model.credits_base,
        description: model.description,
        resolutions: finalResolutions,
      };
    });

    return NextResponse.json({ success: true, data: configMap });
  } catch (error) {
    console.error('获取模型积分配置失败:', error);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}
