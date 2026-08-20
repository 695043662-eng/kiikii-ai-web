import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAdmin } from '@/lib/admin-middleware';
import { clearConfigServerCache } from '@/lib/config-server-cache';
import { clearConfigFetchCache } from '@/lib/config-fetch';

// 获取所有配置（管理员）
export async function GET(request: NextRequest) {
  // 管理员认证
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const supabase = getSupabaseClient(undefined, true);
    
    // 获取所有 API 配置
    const { data: configs, error: configsError } = await supabase
      .from('api_configs')
      .select('*')
      .order('service_type')
      .order('sort_order');
    
    if (configsError) {
      throw configsError;
    }
    
    // 获取所有模型（只按 sort_order 排序，支持管理后台拖拽调整顺序）
    const { data: models, error: modelsError } = await supabase
      .from('api_models')
      .select('*')
      .order('sort_order');
    
    if (modelsError) {
      throw modelsError;
    }
    
    // 为模型添加配置名称
    const modelsWithConfigName = (models || []).map(model => {
      const config = (configs || []).find(c => c.id === model.config_id);
      return {
        ...model,
        config_name: config?.name || '',
        service_type: config?.service_type || '',
      };
    });
    
    return NextResponse.json({
      success: true,
      data: {
        configs: configs || [],
        models: modelsWithConfigName,
      },
    });
    
  } catch (error: any) {
    console.error('获取配置失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// 更新配置
export async function PUT(request: NextRequest) {
  // 管理员认证
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const supabase = getSupabaseClient(undefined, true);
    const body = await request.json();
    const { table, id, data } = body;
    
    if (!table || !id || !data) {
      return NextResponse.json({ success: false, error: '参数不完整' }, { status: 400 });
    }
    
    const validTables = ['api_configs', 'api_models'];
    if (!validTables.includes(table)) {
      return NextResponse.json({ success: false, error: '无效的表名' }, { status: 400 });
    }
    
    const updateData = {
      ...data,
      updated_at: new Date().toISOString(),
    };

    const { error, data: resultData, count } = await supabase
      .from(table)
      .update(updateData)
      .eq('id', id)
      .select();

    console.log(`[api-config] PUT result: table=${table}, id=${id}, error=${error?.message || 'none'}, affected=${resultData?.length || 0}`);

    if (error) {
      throw error;
    }

    if (!resultData || resultData.length === 0) {
      console.error(`[api-config] 更新失败：未找到 id=${id} 的记录`);
      return NextResponse.json({ success: false, error: '记录不存在或未更新' }, { status: 404 });
    }

    // #838 管理后台更新后清空服务端缓存 + 前端 dedup 缓存
    clearConfigServerCache();
    clearConfigFetchCache();

    return NextResponse.json({ success: true, data: resultData[0] });
    
  } catch (error: any) {
    console.error('更新配置失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// 添加配置
export async function POST(request: NextRequest) {
  // 管理员认证
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const supabase = getSupabaseClient(undefined, true);
    const body = await request.json();
    const { table, data } = body;
    
    if (!table || !data) {
      return NextResponse.json({ success: false, error: '参数不完整' }, { status: 400 });
    }
    
    const validTables = ['api_configs', 'api_models'];
    if (!validTables.includes(table)) {
      return NextResponse.json({ success: false, error: '无效的表名' }, { status: 400 });
    }
    
    const { error, data: result } = await supabase
      .from(table)
      .insert(data)
      .select()
      .single();
    
    if (error) {
      throw error;
    }
    
    // #838 管理后台添加后清空缓存
    clearConfigServerCache();
    clearConfigFetchCache();

    return NextResponse.json({ success: true, data: result });
    
  } catch (error: any) {
    console.error('添加配置失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// 删除配置
export async function DELETE(request: NextRequest) {
  // 管理员认证
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const supabase = getSupabaseClient(undefined, true);
    const { searchParams } = new URL(request.url);
    const table = searchParams.get('table');
    const id = searchParams.get('id');
    
    if (!table || !id) {
      return NextResponse.json({ success: false, error: '参数不完整' }, { status: 400 });
    }
    
    const validTables = ['api_configs', 'api_models'];
    if (!validTables.includes(table)) {
      return NextResponse.json({ success: false, error: '无效的表名' }, { status: 400 });
    }
    
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', id);
    
    if (error) {
      throw error;
    }
    
    // #838 管理后台删除后清空缓存
    clearConfigServerCache();
    clearConfigFetchCache();

    return NextResponse.json({ success: true });
    
  } catch (error: any) {
    console.error('删除配置失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
