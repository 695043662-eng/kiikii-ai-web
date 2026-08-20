import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// #859 斩断所有缓存层：force-dynamic + revalidate = 0 + Cache-Control
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 公开 API：获取模型列表
 * 用于 /models 页面展示所有可用模型
 */
export async function GET() {
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
    
    // 获取所有启用的模型
    const { data: models, error: modelsError } = await supabase
      .from('api_models')
      .select('*')
      .eq('is_active', true)  // 只返回启用的模型
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
    
    // #859 斩断浏览器 HTTP 缓存 + Debug 探针
    const response = NextResponse.json({
      success: true,
      data: {
        configs: configs || [],
        models: modelsWithConfigName,
      },
      debug_server_time: new Date().toISOString(),
    });
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    return response;
    
  } catch (error: any) {
    console.error('[API /api/models] 获取模型列表失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
