import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 🛡️ #856 打破生产环境死缓存：模型配置必须实时获取
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/config - 获取模型配置
 * 支持按 service_type 过滤
 * 
 * 注意：使用两步查询而非外键关联，避免生产环境缺少外键约束导致查询失败
 * 
 * #837 读风暴修复：添加服务端内存缓存，1分钟 TTL
 * 根因：此路由被 6+ 处前端代码高频调用，每次都穿透到 Supabase 查 2 次
 * 加上 HMR 每次重挂载组件都重新拉取 → 读请求暴增
 * 修复：内存缓存 60 秒，同一 service_type 只打一次 DB
 * 
 * #838 缓存逻辑已迁移到 src/lib/config-server-cache.ts（避免 TS2344 Route Type 检查）
 */

import { configServerCache, clearConfigServerCache } from '@/lib/config-server-cache';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serviceType = searchParams.get('service_type');

    // #837 读风暴修复：检查缓存（#838 迁移到 configServerCache）
    const cacheKey = serviceType || '_all';
    const cached = configServerCache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const client = getSupabaseClient(undefined, true);

    // 第一步：获取所有 api_configs
    const { data: configs, error: configError } = await client
      .from('api_configs')
      .select('id, name, service_type, api_endpoint');

    if (configError) {
      console.error('[api/config] 获取配置失败:', configError);
      return NextResponse.json({ success: false, error: '获取配置失败' }, { status: 500 });
    }

    // 构建 config_id -> config 的映射
    const configMap = new Map<number, { name: string; service_type: string }>();
    const configIdsByType: number[] = [];
    
    (configs || []).forEach(config => {
      configMap.set(config.id, {
        name: config.name,
        service_type: config.service_type,
      });
      
      // 如果指定了 service_type，收集匹配的 config_id
      if (serviceType && config.service_type === serviceType) {
        configIdsByType.push(config.id);
      }
    });

    // 第二步：查询 api_models
    let query = client
      .from('api_models')
      .select(`
        model_id,
        model_name,
        description,
        parameters,
        credits_base,
        is_active,
        is_visible,
        sort_order,
        config_id
      `)
      .eq('is_visible', true)
      .order('sort_order', { ascending: true });

    // 按 service_type 过滤
    if (serviceType) {
      if (configIdsByType.length === 0) {
        return NextResponse.json({ 
          success: true, 
          data: { models: [] } 
        });
      }
      query = query.in('config_id', configIdsByType);
    }

    const { data: models, error } = await query;

    if (error) {
      console.error('[api/config] 查询失败:', error);
      return NextResponse.json({ success: false, error: '查询失败' }, { status: 500 });
    }

    // 第三步：在代码中关联 config 信息
    const formattedModels = (models || []).map(m => {
      const config = configMap.get(m.config_id);
      return {
        model_id: m.model_id,
        model_name: m.model_name,
        description: m.description,
        parameters: m.parameters,
        credits_base: m.credits_base,
        is_active: m.is_active,
        is_visible: m.is_visible,
        sort_order: m.sort_order,
        config_id: m.config_id,
        config_name: config?.name,
        service_type: config?.service_type,
      };
    });

    const responseData = {
      success: true,
      data: {
        models: formattedModels,
      },
      // #859 Debug 探针：前端可据此判断是否拿到了最新数据
      debug_server_time: new Date().toISOString(),
    };

    // #837 读风暴修复：写入缓存（#838 迁移到 configServerCache）
    configServerCache.set(cacheKey, responseData);

    // #859 斩断浏览器 HTTP 缓存：必须显式设置 Cache-Control
    const response = NextResponse.json(responseData);
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    return response;
  } catch (error) {
    console.error('[api/config] 异常:', error);
    return NextResponse.json({ success: false, error: '服务器异常' }, { status: 500 });
  }
}
