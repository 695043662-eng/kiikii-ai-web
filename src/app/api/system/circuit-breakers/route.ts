import { NextResponse } from 'next/server';
import { getGloballyBannedResolutions, clearAllCircuitBreakers, getAllActiveBans } from '@/lib/api-config';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAdmin } from '@/lib/admin-middleware';

/**
 * 熔断探针 API
 * 返回当前所有被全局熔断的分辨率列表（所有 Key 的该分辨率均被 ban）
 * 前端在 Mount 时静默请求此 API，将对应分辨率按钮置灰
 * 
 * 同时返回详细熔断记录（含接口名、密钥前缀、剩余倒计时），供管理后台展示
 * 
 * #837 读风暴修复：添加服务端内存缓存，1分钟 TTL
 * 熔断状态变化时（ban/clear）自动失效缓存
 */

let cbCache: { data: any; timestamp: number } | null = null;
const CB_CACHE_TTL = 60 * 1000; // 1 分钟

/** 熔断状态变化时强制失效缓存（#838: 改为非导出，避免 TS2344 Route Type 检查冲突） */
function invalidateCircuitBreakerCache() {
  cbCache = null;
}

export async function GET() {
  try {
    // #837 读风暴修复：先检查缓存（熔断信息是内存态，api_configs 仅用于名称映射，变化极少）
    if (cbCache && Date.now() - cbCache.timestamp < CB_CACHE_TTL) {
      // 但 activeBans 是实时内存数据，需要从缓存数据中重建
      // 所以：只用缓存跳过 Supabase 查询，activeBans 仍实时计算
      const cachedConfigs = cbCache.data._configs;
      if (cachedConfigs) {
        const result = buildCircuitBreakerResponse(cachedConfigs);
        return NextResponse.json(result);
      }
      return NextResponse.json(cbCache.data);
    }

    const supabase = getSupabaseClient(undefined, true);
    
    // 获取所有 API 配置
    const { data: configs, error } = await supabase
      .from('api_configs')
      .select('id, name, api_key');
    
    if (error) {
      console.error('[CircuitBreaker API] 查询配置失败:', error);
      return NextResponse.json({ 
        success: false, 
        error: '查询配置失败' 
      }, { status: 500 });
    }

    // #837 缓存 configs 数据（含 api_key 用于实时计算熔断）
    cbCache = { data: { _configs: configs }, timestamp: Date.now() };

    const result = buildCircuitBreakerResponse(configs);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[CircuitBreaker API] 错误:', error);
    return NextResponse.json({ 
      success: false, 
      error: '服务器内部错误' 
    }, { status: 500 });
  }
}

/** 从 configs 构建熔断响应（纯计算，无 DB 查询） */
function buildCircuitBreakerResponse(configs: any[]) {
    // 构建密钥前缀 → 接口名的映射
    const keyPrefixToConfig: Record<string, { configId: number; configName: string }> = {};
    for (const config of configs || []) {
      if (!config.api_key) continue;
      const lines = config.api_key.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split('|');
        const key = parts[0].trim();
        const status = parts.length > 1 ? parts[1].trim() : '1';
        if (key && (status === '' || status === '1')) {
          const prefix = key.substring(0, 8) + '...';
          if (!keyPrefixToConfig[prefix]) {
            keyPrefixToConfig[prefix] = {
              configId: config.id,
              configName: config.name || `配置${config.id}`,
            };
          }
        }
      }
    }

    // 按配置聚合，找出所有被全局熔断的分辨率
    const bannedResolutionsByConfig: Record<string, { name: string; resolutions: string[] }> = {};
    const allBannedResolutions = new Set<string>();

    for (const config of configs || []) {
      if (!config.api_key) continue;
      const bannedResolutions = getGloballyBannedResolutions(config.api_key);
      if (bannedResolutions.length > 0) {
        bannedResolutionsByConfig[config.id] = {
          name: config.name || `配置${config.id}`,
          resolutions: bannedResolutions,
        };
        bannedResolutions.forEach(r => allBannedResolutions.add(r));
      }
    }

    // 获取所有活跃熔断的详细信息（管理后台展示用）
    const activeBans = getAllActiveBans().map(ban => ({
      ...ban,
      configId: keyPrefixToConfig[ban.keyPrefix]?.configId || null,
      configName: keyPrefixToConfig[ban.keyPrefix]?.configName || '未知接口',
    }));

    return {
      success: true,
      bannedResolutions: Array.from(allBannedResolutions),
      details: bannedResolutionsByConfig,
      activeBans,
      timestamp: Date.now(),
    };
}

/**
 * 全局一键解除熔断 API（急救开关）
 * POST 请求清空所有熔断记录和连续失败计数
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    const result = clearAllCircuitBreakers();
    
    // #837 清除熔断后立即失效缓存，下次 GET 会重新查询
    cbCache = null;
    
    console.log(`🚑 [CircuitBreaker] 管理员触发全局解封，清除了 ${result.bansCleared} 条熔断和 ${result.failuresCleared} 条失败计数`);
    
    return NextResponse.json({
      success: true,
      message: '所有通道的熔断状态及错误计数已重置',
      bansCleared: result.bansCleared,
      failuresCleared: result.failuresCleared,
    });
  } catch (error) {
    console.error('[CircuitBreaker API] 解封失败:', error);
    return NextResponse.json({ 
      success: false, 
      error: '解封操作失败' 
    }, { status: 500 });
  }
}
