/**
 * 积分管理工具
 * 
 * ⚠️ 重要修复（#067）：所有积分操作使用 PostgREST REST API 直接操作，不走 RPC
 * 原因：PostgREST schema cache 不认 RPC 函数，导致 .rpc() 调用失败
 * 
 * ⚠️ 重要修复（#118）：动态读取数据库配置，确保使用正确的数据库
 * 原因：模块加载时 process.env 可能还没被 .env.local 覆盖
 */

import { getSupabaseClient } from '@/storage/database/supabase-client';
import * as fs from 'fs';
import * as path from 'path';

// 🔧 #176 开发环境隔离：优先级根据环境决定
// 开发环境：.env.local 优先（隔离开发数据库）
// 生产环境：系统环境变量优先
let cachedDbConfig: { url: string; serviceRoleKey: string } | null = null;

// 动态读取数据库配置
function getDbConfig(): { url: string; serviceRoleKey: string } {
  // 🔒 缓存命中，直接返回
  if (cachedDbConfig) {
    return cachedDbConfig;
  }
  
  // 读取 .env.local
  let localUrl = '';
  let localServiceRoleKey = '';
  let localAnonKey = '';
  let localNodeEnv = '';
  
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) {
          const key = trimmed.substring(0, eq).trim();
          let value = trimmed.substring(eq + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (key === 'SUPABASE_URL') localUrl = value;
          if (key === 'SUPABASE_SERVICE_ROLE_KEY') localServiceRoleKey = value;
          if (key === 'SUPABASE_ANON_KEY') localAnonKey = value;
          if (key === 'NODE_ENV') localNodeEnv = value;
        }
      }
    }
  } catch {
    // ignore
  }
  
  // 🔧 #176 判断是否开发环境
  const isDevelopment = process.env.NODE_ENV === 'development' || localNodeEnv === 'development';
  
  let url: string;
  let serviceRoleKey: string;
  
  if (isDevelopment) {
    // 开发环境：.env.local 优先
    url = localUrl || process.env.SUPABASE_URL || '';
    serviceRoleKey = localServiceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    console.log('[credits.ts] 🔧 开发模式：使用 .env.local 配置');
  } else {
    // 生产环境：系统环境变量优先
    url = process.env.SUPABASE_URL || localUrl || '';
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || localServiceRoleKey || '';
  }
  
  // 🔧 #175 开发环境回退：如果没有 service_role_key，回退到 anon_key
  if (!serviceRoleKey) {
    serviceRoleKey = isDevelopment 
      ? (localAnonKey || process.env.SUPABASE_ANON_KEY || '')
      : (process.env.SUPABASE_ANON_KEY || localAnonKey || '');
    if (serviceRoleKey) {
      console.log('[credits.ts] ⚠️ 使用 anon_key 代替 service_role_key（开发环境回退）');
    }
  }
  
  // 🔒 缓存结果
  cachedDbConfig = { url, serviceRoleKey };
  console.log('[credits.ts] 数据库配置已缓存:', { url: url ? url.substring(0, 40) + '...' : '未设置', key: serviceRoleKey ? '已设置' : '未设置' });
  return cachedDbConfig;
}

// 通用 REST API 请求函数
async function restRequest(
  table: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    query?: string;
    body?: any;
    prefer?: string;
  }
): Promise<{ status: number; data: any }> {
  const { method = 'GET', query = '', body, prefer } = options;
  
  // 🔧 #118 修复：动态读取数据库配置
  const { url: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY } = getDbConfig();
  
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[credits.ts] 数据库配置缺失:', { 
      hasUrl: !!SUPABASE_URL, 
      hasKey: !!SERVICE_ROLE_KEY 
    });
    return { status: 500, data: null };
  }
  
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
  };
  
  if (prefer) {
    headers['Prefer'] = prefer;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { status: res.status, data };
}

/**
 * 从数据库获取模型配置
 */
async function getModelConfig(modelId: string): Promise<any | null> {
  try {
    const { status, data } = await restRequest('api_models', {
      query: `model_id=eq.${modelId}&is_active=eq.true`,
      prefer: 'return=representation',
    });

    if (status !== 200 || !data || data.length === 0) {
      console.error('[getModelConfig] 查询模型配置失败:', status, data);
      return null;
    }

    return data[0];
  } catch (error) {
    console.error('[getModelConfig] 查询模型配置异常:', error);
    return null;
  }
}

/**
 * 计算实际消耗的积分
 * 根据模型和分辨率计算总积分
 */
export async function calculateCredits(
  modelId: string,
  resolution: string,
  generationCount: number
): Promise<number> {
  const config = await getModelConfig(modelId);
  
  if (!config) {
    console.warn(`[calculateCredits] 未知模型: ${modelId}，使用默认积分`);
    return 10 * generationCount;
  }

  // 优先从 parameters.resolutions 中查找
  const parameters = config.parameters as any;
  const resolutions = parameters?.resolutions || [];
  const resolutionConfig = resolutions.find((r: any) => r.value === resolution);
  
  const creditsPerImage = resolutionConfig?.credits || config.credits_base || 10;

  console.log(`[calculateCredits] 模型=${modelId}, 分辨率=${resolution}, 每张图=${creditsPerImage}, 数量=${generationCount}`);
  
  return creditsPerImage * generationCount;
}

/**
 * 扣除用户积分（使用 REST API 直接操作，绕过 RPC schema cache 问题）
 * 包含原子性检查和更新，防止并发竞态
 * 
 * 🔥 核心逻辑：用户不存在时自动创建（无感开户），绝不报错！
 */
const DEFAULT_CREDITS = 0; // 新用户初始积分

export async function deductCredits(
  userId: string,
  credits: number
): Promise<{ success: boolean; remaining?: number; error?: string }> {
  try {
    console.log(`[deductCredits] 开始扣除积分, userId=${userId}, credits=${credits}`);
    
    // 1. 查询当前积分
    const { status: getStatus, data: userData } = await restRequest('users', {
      query: `id=eq.${userId}&select=credits`,
    });

    console.log(`[deductCredits] 查询用户结果: status=${getStatus}, data=`, userData);

    // 2. 🔥 用户不存在时，自动创建（无感开户）
    let currentCredits = 0;
    
    if (getStatus !== 200 || !userData || userData.length === 0) {
      console.log(`[deductCredits] 用户不存在，自动开户: ${userId}`);
      
      // 创建新用户
      const { status: insertStatus, data: insertData } = await restRequest('users', {
        method: 'POST',
        body: {
          id: userId,
          credits: DEFAULT_CREDITS,
          created_at: new Date().toISOString(),
        },
        prefer: 'return=representation,resolution=merge-duplicates',
      });
      
      if (insertStatus !== 201 && insertStatus !== 200) {
        console.error(`[deductCredits] 自动开户失败: status=${insertStatus}`);
        // 开户失败，返回错误但不踢人
        return { success: false, error: '创建用户失败，请稍后重试', remaining: 0 };
      }
      
      currentCredits = insertData?.[0]?.credits || DEFAULT_CREDITS;
      console.log(`[deductCredits] 自动开户成功: userId=${userId}, 积分=${currentCredits}`);
    } else {
      currentCredits = userData[0].credits || 0;
    }

    // 3. 检查积分是否足够
    if (currentCredits < credits) {
      return {
        success: false,
        error: '积分不足',
        remaining: currentCredits,
      };
    }

    // 4. 更新积分（带条件：只有当积分足够时才更新，防止并发）
    const newCredits = currentCredits - credits;
    const { status: patchStatus, data: patchData } = await restRequest('users', {
      method: 'PATCH',
      query: `id=eq.${userId}&credits=gte.${credits}`,  // 条件：当前积分 >= 扣除数量
      body: { credits: newCredits, updated_at: new Date().toISOString() },
      prefer: 'return=representation',
    });

    // 5. 检查是否更新成功
    if (patchStatus !== 200 || !patchData || patchData.length === 0) {
      // 可能是并发导致条件不满足，重新查询
      console.warn('[deductCredits] 更新失败，可能并发冲突，重新查询');
      const { data: retryData } = await restRequest('users', {
        query: `id=eq.${userId}&select=credits`,
      });
      const retryCredits = retryData?.[0]?.credits || 0;
      return {
        success: false,
        error: '积分不足或操作冲突',
        remaining: retryCredits,
      };
    }

    const remainingCredits = patchData[0].credits;

    // 6. 异步记录日志
    restRequest('credit_logs', {
      method: 'POST',
      body: {
        user_id: userId,
        amount: -credits,
        type: 'deduct',
        balance_after: remainingCredits,
        created_at: new Date().toISOString(),
      },
    }).then(({ status }) => {
      if (status !== 201) console.error('[deductCredits] 记录日志失败');
    });

    console.log(`[deductCredits] 扣除 ${credits} 积分成功，剩余: ${remainingCredits}`);

    return {
      success: true,
      remaining: remainingCredits,
    };
  } catch (error: any) {
    console.error('[deductCredits] 异常:', error);
    return {
      success: false,
      error: error.message || '扣除积分失败',
    };
  }
}

/**
 * 检查用户积分是否足够（使用 REST API 直接操作）
 */
export async function checkCreditsSufficient(
  userId: string,
  credits: number
): Promise<{ sufficient: boolean; currentCredits?: number; error?: string }> {
  try {
    const { status, data } = await restRequest('users', {
      query: `id=eq.${userId}&select=credits`,
    });

    if (status !== 200 || !data || data.length === 0) {
      return {
        sufficient: false,
        error: '用户不存在',
      };
    }

    const currentCredits = data[0].credits || 0;
    const sufficient = currentCredits >= credits;

    return {
      sufficient,
      currentCredits,
    };
  } catch (error: any) {
    console.error('[checkCreditsSufficient] 异常:', error);
    return {
      sufficient: false,
      error: error.message || '查询积分失败',
    };
  }
}

/**
 * 退还用户积分（使用 REST API 直接操作）
 * 用于任务失败时的积分补偿
 * 
 * #156 防重复机制：检查 taskId 是否已退还过
 */
export async function refundCredits(
  userId: string,
  credits: number,
  taskId: string,
  reason: string = '任务失败补偿'
): Promise<{ success: boolean; remaining?: number; error?: string }> {
  try {
    // ========================================
    // #156 防重复机制：检查 taskId 是否已退还过
    // ========================================
    if (taskId) {
      const { status: checkStatus, data: existingLogs } = await restRequest('credit_refund_logs', {
        query: `task_id=eq.${taskId}&select=id`,
      });

      if (checkStatus === 200 && existingLogs && existingLogs.length > 0) {
        console.log(`[refundCredits] #156 防重复: taskId=${taskId} 已退还过，跳过`);
        return {
          success: true,
          remaining: undefined,
          error: '该任务已退还过积分（防重复）',
        };
      }
    }

    // 1. 查询当前积分
    const { status: getStatus, data: userData } = await restRequest('users', {
      query: `id=eq.${userId}&select=credits`,
    });

    if (getStatus !== 200 || !userData || userData.length === 0) {
      return { success: false, error: '用户不存在' };
    }

    const currentCredits = userData[0].credits || 0;
    const newCredits = currentCredits + credits;

    // 2. 更新积分
    const { status: patchStatus, data: patchData } = await restRequest('users', {
      method: 'PATCH',
      query: `id=eq.${userId}`,
      body: { credits: newCredits, updated_at: new Date().toISOString() },
      prefer: 'return=representation',
    });

    if (patchStatus !== 200 || !patchData || patchData.length === 0) {
      return { success: false, error: '退还积分失败' };
    }

    const remainingCredits = patchData[0].credits;

    // 3. 记录退款日志（同步执行，确保记录成功）
    const { status: logStatus } = await restRequest('credit_refund_logs', {
      method: 'POST',
      body: {
        user_id: userId,
        task_id: taskId || null,
        amount: credits,
        reason: reason,
        created_at: new Date().toISOString(),
      },
    });
    
    if (logStatus !== 201) {
      console.error('[refundCredits] 记录退款日志失败');
    }

    console.log(`[refundCredits] 退还 ${credits} 积分成功，剩余: ${remainingCredits}, taskId: ${taskId}`);

    return {
      success: true,
      remaining: remainingCredits,
    };
  } catch (error: any) {
    console.error('[refundCredits] 异常:', error);
    return {
      success: false,
      error: error.message || '退还积分失败',
    };
  }
}
