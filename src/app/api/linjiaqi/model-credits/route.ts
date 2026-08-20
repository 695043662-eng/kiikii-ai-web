import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAdmin } from '@/lib/admin-middleware';

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
function inferParameters(credits: number, modelType: string, modelKey?: string): any {
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
  
  // 特定模型的分辨率支持
  // #680 Banana 模型合并：nano-banana-2-cl 和 nano-banana-pro-vip 现在也支持 4K（后端自动路由到 4K 模型）
  if (modelKey) {
    const key = modelKey.toLowerCase();
    
    if (key === 'nano-banana' || key === 'nano-banana-fast') {
      return { resolutions: [{ label: '1K', value: '1K', credits: credits }] };
    }
    
    if (key === 'nano-banana-2' || key === 'nano-banana-2-cl' || key === 'nano-banana-pro' || key === 'nano-banana-pro-vip' || key === 'nano-banana-pro-vt' || key === 'nano-banana-pro-cl') {
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

// GET /api/linjiaqi/model-credits - 获取所有模型配置
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    const client = getSupabaseClient(undefined, true);

    // #511 直接从 api_models 获取配置
    const { data: models, error } = await client
      .from('api_models')
      .select('id, model_id, model_name, description, parameters, credits_base, is_active, is_visible, sort_order, config_id')
      .order('sort_order', { ascending: true });

    if (error) {
      throw error;
    }

    // 转换为前端期望的格式
    const configs = (models || []).map((m: any) => ({
      id: m.id,
      model_key: m.model_id,
      model_name: m.model_name,
      credits: m.credits_base,
      description: m.description,
      is_active: m.is_active,
      is_visible: m.is_visible ?? true,
      sort_order: m.sort_order ?? 100,
      config_id: m.config_id,
      resolutions: m.parameters?.resolutions || m.parameters?.durations || [],
    }));

    return NextResponse.json({ success: true, data: configs });
  } catch (error) {
    console.error('获取模型配置失败:', error);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}

// POST /api/linjiaqi/model-credits - 创建新模型
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    const client = getSupabaseClient(undefined, true);

    const body = await request.json();
    const { modelKey, modelName, credits, description, resolutions, sortOrder, configId } = body;

    if (!modelKey || !modelName || credits === undefined) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    const { type, configId: inferredConfigId } = inferModelType(modelKey);
    const parameters = inferParameters(credits, type, modelKey);
    if (resolutions?.length > 0) {
      if (type === 'video_generation') {
        parameters.durations = resolutions;
      } else {
        parameters.resolutions = resolutions;
      }
    }

    const { data, error } = await client
      .from('api_models')
      .insert({
        model_id: modelKey,
        model_name: modelName,
        config_id: configId || inferredConfigId,
        description: description || '',
        parameters,
        credits_base: credits,
        is_active: true,
        is_visible: true,
        sort_order: sortOrder ?? 100,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('创建模型配置失败:', error);
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }
}

// PUT /api/linjiaqi/model-credits - 更新模型配置
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    const client = getSupabaseClient(undefined, true);

    const body = await request.json();
    const { id, model_key, model_name, credits, description, is_active, is_visible, resolutions, sort_order, config_id } = body;

    if (!id) {
      return NextResponse.json({ error: '缺少模型ID' }, { status: 400 });
    }

    // 先获取现有数据
    const { data: existing } = await client
      .from('api_models')
      .select('*')
      .eq('id', id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: '模型不存在' }, { status: 404 });
    }

    const updateData: Record<string, any> = {};
    if (model_key !== undefined) updateData.model_id = model_key;
    if (model_name !== undefined) updateData.model_name = model_name;
    if (credits !== undefined) updateData.credits_base = credits;
    if (description !== undefined) updateData.description = description;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (is_visible !== undefined) updateData.is_visible = is_visible;
    if (sort_order !== undefined) updateData.sort_order = sort_order;
    if (config_id !== undefined) updateData.config_id = config_id;

    // 处理 resolutions
    if (resolutions !== undefined) {
      const params = existing.parameters || {};
      if (resolutions.length > 0) {
        const { type } = inferModelType(model_key || existing.model_id);
        if (type === 'video_generation') {
          params.durations = resolutions;
        } else {
          params.resolutions = resolutions;
        }
      }
      updateData.parameters = params;
    }

    const { data, error } = await client
      .from('api_models')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('更新模型配置失败:', error);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}

// DELETE /api/linjiaqi/model-credits - 删除模型
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    const client = getSupabaseClient(undefined, true);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少模型ID' }, { status: 400 });
    }

    const { error } = await client
      .from('api_models')
      .delete()
      .eq('id', parseInt(id));

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除模型配置失败:', error);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
