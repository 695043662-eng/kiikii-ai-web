import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { cookies } from 'next/headers';

// 管理员手机号
const ADMIN_PHONE = '13824085362';

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
  if (modelKey) {
    const key = modelKey.toLowerCase();
    
    // ===== 只支持 4K 的模型 =====
    if (key === 'nano-banana-2-4k-cl' || key === 'nano-banana-pro-4k-vip') {
      return {
        resolutions: [
          { label: '4K', value: '4K', credits: credits },
        ],
      };
    }
    
    // ===== 只支持 1K 的模型 =====
    if (key === 'nano-banana' || key === 'nano-banana-fast') {
      return {
        resolutions: [
          { label: '1K', value: '1K', credits: credits },
        ],
      };
    }
    
    // ===== 只支持 1K, 2K 的模型 =====
    if (key === 'nano-banana-2-cl' || key === 'nano-banana-pro-vip') {
      return {
        resolutions: [
          { label: '1K', value: '1K', credits: credits },
          { label: '2K', value: '2K', credits: Math.round(credits * 1.2) },
        ],
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

/**
 * 同步到 api_models 表
 * #208 修复：保留数据库中已有的 resolutions，不覆盖自定义积分
 */
async function syncToApiModels(
  supabase: any,
  modelKey: string,
  modelName: string,
  credits: number,
  description: string,
  isActive: boolean,
  operation: 'insert' | 'update' | 'delete',
  existingId?: number,
  config?: any
) {
  const { type, configId } = inferModelType(modelKey);
  
  try {
    if (operation === 'delete' && existingId) {
      // 删除
      await supabase
        .from('api_models')
        .delete()
        .eq('model_id', modelKey);
      console.log(`[Sync] 删除 api_models: ${modelKey}`);
      return;
    }
    
    // 检查是否已存在，并读取现有的 parameters
    const { data: existing } = await supabase
      .from('api_models')
      .select('id, parameters')
      .eq('model_id', modelKey)
      .single();
    
    // #208 关键修复：如果已有 resolutions，保留它；否则才生成
    let parameters: any;
    if (existing?.parameters?.resolutions && existing.parameters.resolutions.length > 0) {
      // 保留已有的 resolutions，只更新 aspectRatios（如果需要）
      parameters = existing.parameters;
      console.log(`[Sync] 保留已有 resolutions: ${JSON.stringify(existing.parameters.resolutions)}`);
    } else {
      // 没有现有配置，才生成新的
      parameters = inferParameters(credits, type, config, modelKey);
      console.log(`[Sync] 生成新 parameters: ${JSON.stringify(parameters)}`);
    }
    
    if (operation === 'insert' || (operation === 'update' && !existing)) {
      // 新增
      const { error } = await supabase
        .from('api_models')
        .insert({
          config_id: configId,
          model_id: modelKey,
          model_name: modelName,
          description: description || '',
          parameters: parameters,
          credits_base: credits,
          is_active: isActive,
          sort_order: 100, // 默认排序
        });
      
      if (error) {
        console.error(`[Sync] 新增 api_models 失败:`, error);
      } else {
        console.log(`[Sync] 新增 api_models: ${modelKey} (config_id: ${configId})`);
      }
    } else if (operation === 'update' && existing) {
      // 更新 - #208 注意：不更新 parameters，保留自定义积分
      const { error } = await supabase
        .from('api_models')
        .update({
          model_name: modelName,
          description: description || '',
          // #208 不更新 parameters，保留自定义积分
          // parameters: parameters,
          credits_base: credits,
          is_active: isActive,
        })
        .eq('model_id', modelKey);
      
      if (error) {
        console.error(`[Sync] 更新 api_models 失败:`, error);
      } else {
        console.log(`[Sync] 更新 api_models: ${modelKey} (保留原有 parameters)`);
      }
    }
  } catch (error) {
    console.error(`[Sync] 同步到 api_models 异常:`, error);
    // 静默处理，不影响主流程
  }
}

// GET /api/linjiaqi/model-credits - 获取所有模型积分配置
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    
    // 获取当前用户
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    
    // 验证是否为管理员
    const { data: currentUser, error: userError } = await client
      .from('users')
      .select('phone')
      .eq('id', userId)
      .single();
    
    if (!currentUser || currentUser.phone !== ADMIN_PHONE) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    // 获取所有模型积分配置（按 id 排序，前端再按 sort_order 排序）
    const { data: configs, error } = await client
      .from('model_credits_config')
      .select('*')
      .order('id', { ascending: true });

    if (error) {
      console.error('[model-credits] query error:', error);
      throw error;
    }
    
    // 按 sort_order 排序（PostgREST 可能不认新列，用代码排序）
    const sortedConfigs = (configs || []).sort((a: any, b: any) => (a.sort_order ?? 999) - (b.sort_order ?? 999));

    // 获取 api_models 中的参数配置
    const { data: apiModels } = await client
      .from('api_models')
      .select('model_id, parameters');

    // 构建 api_models 的参数映射
    const apiModelsMap = new Map<string, any>();
    (apiModels || []).forEach((m: any) => {
      const params = m.parameters || {};
      let config = null;
      
      if (params.durations && params.durations.length > 0) {
        config = { durations: params.durations };
      } else if (params.resolutions && params.resolutions.length > 0) {
        config = { resolutions: params.resolutions };
      } else if (params.credits_base !== undefined) {
        config = { credits_base: params.credits_base };
      }
      
      if (config) {
        apiModelsMap.set(m.model_id, config);
      }
    });

    // 保留 model_credits_config 中的配置，不用 api_models 覆盖
    const mergedConfigs = (sortedConfigs || []).map((config: any) => {
      const apiConfig = apiModelsMap.get(config.model_key);
      return {
        ...config,
        // 优先使用 model_credits_config 中的 resolutions，如果没有再用 api_models 的
        resolutions: config.resolutions?.length > 0 ? config.resolutions : (apiConfig?.durations || apiConfig?.resolutions || []),
        credits_base: config.credits !== undefined ? config.credits : (apiConfig?.credits_base || config.credits),
      };
    });

    return NextResponse.json({ success: true, data: mergedConfigs });
  } catch (error) {
    console.error('获取模型积分配置失败:', error);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}

// POST /api/linjiaqi/model-credits - 创建新配置
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    
    // 获取当前用户
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    
    // 验证是否为管理员
    const { data: currentUser } = await client
      .from('users')
      .select('phone')
      .eq('id', userId)
      .single();
    
    if (!currentUser || currentUser.phone !== ADMIN_PHONE) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const body = await request.json();
    const { modelKey, modelName, credits, description, resolutions } = body;

    if (!modelKey || !modelName || credits === undefined) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    const insertData: any = {
      model_key: modelKey,
      model_name: modelName,
      credits,
      description,
      is_active: true,
    };
    if (resolutions) insertData.resolutions = resolutions;

    const { data, error } = await client
      .from('model_credits_config')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // 实时同步到 api_models 表
    await syncToApiModels(client, modelKey, modelName, credits, description, true, 'insert', undefined, data);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('创建模型积分配置失败:', error);
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }
}

// PUT /api/linjiaqi/model-credits - 更新配置
export async function PUT(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    
    // 获取当前用户
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    
    // 验证是否为管理员
    const { data: currentUser } = await client
      .from('users')
      .select('phone')
      .eq('id', userId)
      .single();
    
    if (!currentUser || currentUser.phone !== ADMIN_PHONE) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const body = await request.json();
    console.log('[API] PUT model-credits received:', body);
    // 使用 snake_case，因为前端发送的是 model_name
    const { id, model_key, model_name, credits, description, is_active, is_visible, resolutions, sort_order } = body;

    if (!id) {
      return NextResponse.json({ error: '缺少配置ID' }, { status: 400 });
    }

    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (model_key !== undefined) updateData.model_key = model_key;
    if (model_name !== undefined) updateData.model_name = model_name;
    if (credits !== undefined) updateData.credits = credits;
    if (description !== undefined) updateData.description = description;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (is_visible !== undefined) updateData.is_visible = is_visible;
    if (resolutions !== undefined) updateData.resolutions = resolutions;
    if (sort_order !== undefined) updateData.sort_order = sort_order;
    
    console.log('[API] updateData:', updateData);

    console.log('[API] 执行数据库更新, id:', id);
    const { data, error } = await client
      .from('model_credits_config')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    console.log('[API] 数据库返回 data:', JSON.stringify(data), 'error:', error);
    
    if (error) {
      throw error;
    }

    // 验证更新是否成功
    const { data: verifyData } = await client
      .from('model_credits_config')
      .select('*')
      .eq('id', id)
      .single();
    console.log('[API] 验证查询:', verifyData);

    // 实时同步到 api_models 表
    await syncToApiModels(
      client,
      model_key || data.model_key,
      model_name || data.model_name,
      credits !== undefined ? credits : data.credits,
      description !== undefined ? description : data.description,
      is_active !== undefined ? is_active : data.is_active,
      'update',
      undefined,
      data // 传入完整配置对象
    );

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('更新模型积分配置失败:', error);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}

// DELETE /api/linjiaqi/model-credits - 删除配置
export async function DELETE(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    
    // 获取当前用户
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    
    // 验证是否为管理员
    const { data: currentUser } = await client
      .from('users')
      .select('phone')
      .eq('id', userId)
      .single();
    
    if (!currentUser || currentUser.phone !== ADMIN_PHONE) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少配置ID' }, { status: 400 });
    }

    // 先获取模型信息，用于同步删除
    const { data: existing } = await client
      .from('model_credits_config')
      .select('model_key')
      .eq('id', parseInt(id))
      .single();

    const { error } = await client
      .from('model_credits_config')
      .delete()
      .eq('id', parseInt(id));

    if (error) {
      throw error;
    }

    // 实时同步删除 api_models 表
    if (existing) {
      await syncToApiModels(client, existing.model_key, '', 0, '', false, 'delete');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除模型积分配置失败:', error);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
