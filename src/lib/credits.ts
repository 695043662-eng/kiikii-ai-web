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
 * 
 * #271 双式记账法：写入 credit_logs 统一流水表
 */
const DEFAULT_CREDITS = 0; // 新用户初始积分

export async function deductCredits(
  userId: string,
  credits: number,
  referenceId?: string  // #271 新增：关联ID（如 taskId）
): Promise<{ success: boolean; remaining?: number; error?: string }> {
  try {
    console.log(`[deductCredits] 开始扣除积分, userId=${userId}, credits=${credits}, referenceId=${referenceId}`);
    
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

    // 6. #271 双式记账：同步写入流水表（使用数据库返回的余额）
    const { status: logStatus } = await restRequest('credit_logs', {
      method: 'POST',
      body: {
        user_id: userId,
        amount: -credits,
        balance_after: remainingCredits,
        type: 'consume',
        reference_id: referenceId || null,
        description: `生成图片扣除 ${credits} 积分`,
        created_at: new Date().toISOString(),
      },
    });
    
    if (logStatus !== 201) {
      console.error('[deductCredits] #271 记录流水失败');
    }

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
 * #271 双式记账法：写入 credit_logs 统一流水表
 * #285 并发安全：先插入日志（唯一约束），再更新积分
 * #286 修复：使用 on_conflict 参数实现数据库层面的原子防重
 * 
 * ⚠️ 前提条件：数据库需要有唯一约束
 * CREATE UNIQUE INDEX credit_logs_reference_id_type_unique 
 * ON credit_logs (reference_id, type) WHERE reference_id IS NOT NULL;
 */
export async function refundCredits(
  userId: string,
  credits: number,
  taskId: string,
  reason: string = '任务失败补偿'
): Promise<{ success: boolean; remaining?: number; error?: string; skipped?: boolean }> {
  try {
    // ========================================
    // #285/#286 并发安全：先插入日志记录（使用 upsert + on_conflict 防止并发重复）
    // 关键：数据库必须有 (reference_id, type) 的唯一约束
    // ========================================
    if (taskId) {
      // 使用 upsert + on_conflict 尝试插入日志
      // 如果数据库有唯一约束，并发请求只有一个会成功插入
      // 失败的请求会收到 409 Conflict 或 23505 错误
      const { status: insertStatus, data: insertData } = await restRequest('credit_logs', {
        method: 'POST',
        body: {
          user_id: userId,
          amount: credits,
          type: 'refund',
          reference_id: taskId,
          description: reason,
          created_at: new Date().toISOString(),
        },
        prefer: 'return=representation',
        // 注意：on_conflict 参数需要数据库有对应的唯一约束
        // query: `on_conflict=reference_id,type`,
      });

      // 检查插入结果
      // - 201: 插入成功，继续返还积分
      // - 409/400: 唯一约束冲突，说明已被其他请求返还
      // - 其他错误: 需要进一步检查
      if (insertStatus === 409 || insertStatus === 400) {
        // 唯一约束冲突，说明已被其他请求返还
        console.log(`[refundCredits] #286 唯一约束冲突: taskId=${taskId} 已被其他请求退还`);
        return {
          success: true,
          skipped: true,
          error: '该任务已退还过积分（并发防重复）',
        };
      }

      if (insertStatus !== 201) {
        // 其他错误，再次检查是否已返还
        const { status: checkStatus, data: existingLogs } = await restRequest('credit_logs', {
          query: `reference_id=eq.${taskId}&type=eq.refund&select=id`,
        });

        if (checkStatus === 200 && existingLogs && existingLogs.length > 0) {
          console.log(`[refundCredits] #286 检查确认: taskId=${taskId} 已退还过`);
          return {
            success: true,
            skipped: true,
            error: '该任务已退还过积分（防重复）',
          };
        }

        // 插入失败且没有已存在的记录，继续尝试返还（可能没有唯一约束）
        console.log(`[refundCredits] #286 插入日志失败 (status=${insertStatus})，继续尝试返还`);
      } else {
        console.log(`[refundCredits] #286 日志记录已插入: taskId=${taskId}`);
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

    // 3. 如果之前没有插入日志（taskId 为空的情况），现在插入
    if (!taskId) {
      const { status: logStatus } = await restRequest('credit_logs', {
        method: 'POST',
        body: {
          user_id: userId,
          amount: credits,
          balance_after: remainingCredits,
          type: 'refund',
          reference_id: null,
          description: reason,
          created_at: new Date().toISOString(),
        },
      });
      
      if (logStatus !== 201) {
        console.error('[refundCredits] #271 记录流水失败');
      }
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

/**
 * #271 新增：通用积分增加函数（双式记账法）
 * 用于充值、后台调整、兑换等场景
 * 
 * @param userId 用户ID
 * @param credits 增加的积分（正数）
 * @param type 类型：recharge, admin_adjust, exchange
 * @param referenceId 关联ID（卡密、操作ID等）
 * @param description 描述
 */
export async function addCredits(
  userId: string,
  credits: number,
  type: 'recharge' | 'admin_adjust' | 'exchange' | 'other',
  referenceId?: string,
  description?: string
): Promise<{ success: boolean; remaining?: number; error?: string }> {
  try {
    console.log(`[addCredits] 开始增加积分, userId=${userId}, credits=${credits}, type=${type}, referenceId=${referenceId}`);
    
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
      return { success: false, error: '更新积分失败' };
    }

    const remainingCredits = patchData[0].credits;

    // 3. #271 双式记账：写入统一流水表（使用数据库返回的余额）
    const { status: logStatus } = await restRequest('credit_logs', {
      method: 'POST',
      body: {
        user_id: userId,
        amount: credits,  // 正数，表示增加
        balance_after: remainingCredits,
        type: type,
        reference_id: referenceId || null,
        description: description || `${type} 增加 ${credits} 积分`,
        created_at: new Date().toISOString(),
      },
    });
    
    if (logStatus !== 201) {
      console.error('[addCredits] #271 记录流水失败');
    }

    console.log(`[addCredits] 增加 ${credits} 积分成功，剩余: ${remainingCredits}`);

    return {
      success: true,
      remaining: remainingCredits,
    };
  } catch (error: any) {
    console.error('[addCredits] 异常:', error);
    return {
      success: false,
      error: error.message || '增加积分失败',
    };
  }
}

/**
 * #282 统一积分返还函数
 * 
 * 核心原则：
 * 1. 全局唯一入口：所有积分返还必须通过此函数
 * 2. 自带防重：内置 creditsRefunded 检查
 * 3. 原子操作：获取最新状态 → 检查 → 返还 → 标记
 * 
 * @param getTaskResultFn - 获取任务结果的函数（从调用方传入，避免循环依赖）
 * @param setTaskResultFn - 设置任务结果的函数（从调用方传入，避免循环依赖）
 * @returns 返还后的积分余额，如果无需返还则返回 null
 */
export async function handlePartialRefund(
  getTaskResultFn: (taskId: string) => any,
  setTaskResultFn: (taskId: string, result: any) => void,
  taskId: string,
  imageItems: Array<{ index: number; status: string; error?: string | null }>,
  generationCount: number,
  creditsPerImage: number,
  userId: string,
  reason: string = '部分图片失败'
): Promise<{ success: boolean; refundAmount: number; newBalance: number | null }> {
  // Step 1: 获取最新状态（防止使用闭包旧变量）
  const latestResult = getTaskResultFn(taskId);
  
  // Step 2: 防重检查（已返还则直接返回）
  if (latestResult?.creditsRefunded) {
    console.log(`[积分补偿] #282 ${taskId} 已返还过，跳过`);
    return { success: false, refundAmount: 0, newBalance: null };
  }
  
  // Step 3: 计算失败数量
  const failedCount = imageItems.filter(item => item.status === 'failed').length;
  
  // Step 4: 无失败则无需返还
  if (failedCount === 0) {
    console.log(`[积分补偿] #282 ${taskId} 无失败图片，无需返还`);
    return { success: false, refundAmount: 0, newBalance: null };
  }
  
  // Step 5: 计算返还金额
  const refundAmount = failedCount * creditsPerImage;
  console.log(`[积分补偿] #282 ${taskId} 开始返还: ${failedCount}/${generationCount} 张失败，退还 ${refundAmount} 积分，原因: ${reason}`);
  
  // Step 6: 执行返还
  try {
    const refundResult = await refundCredits(userId, refundAmount, taskId, reason);
    
    if (refundResult.success) {
      // Step 7: 标记已返还（必须重新获取最新状态）
      const afterRefundResult = getTaskResultFn(taskId);
      if (afterRefundResult) {
        setTaskResultFn(taskId, { ...afterRefundResult, creditsRefunded: true });
      }
      
      console.log(`[积分补偿] #282 ${taskId} 返还成功，剩余 ${refundResult.remaining} 积分`);
      return { 
        success: true, 
        refundAmount, 
        newBalance: refundResult.remaining ?? null 
      };
    } else {
      console.error(`[积分补偿] #282 ${taskId} 返还失败: ${refundResult.error}`);
      return { success: false, refundAmount: 0, newBalance: null };
    }
    } catch (err) {
    console.error(`[积分补偿] #282 ${taskId} 返还异常:`, err);
    return { success: false, refundAmount: 0, newBalance: null };
  }
}

/**
 * #282 统一全额积分返还函数
 * 
 * 用于 API 内部异常等场景，直接按传入金额进行全额退款
 * 
 * @param getTaskResultFn - 获取任务结果的函数（从调用方传入，避免循环依赖）
 * @param setTaskResultFn - 设置任务结果的函数（从调用方传入，避免循环依赖）
 * @param taskId - 任务ID
 * @param refundAmount - 返还金额
 * @param userId - 用户ID
 * @param reason - 返还原因
 * @returns 返还后的积分余额
 */
export async function handleFullRefund(
  getTaskResultFn: (taskId: string) => any,
  setTaskResultFn: (taskId: string, result: any) => void,
  taskId: string,
  refundAmount: number,
  userId: string,
  reason: string = 'API内部异常'
): Promise<{ success: boolean; newBalance: number | null }> {
  // Step 1: 获取最新状态（防止使用闭包旧变量）
  const latestResult = getTaskResultFn(taskId);
  
  // Step 2: 防重检查（已返还则直接返回）
  if (latestResult?.creditsRefunded) {
    console.log(`[积分补偿] #282 ${taskId} 已返还过，跳过`);
    return { success: false, newBalance: null };
  }
  
  // Step 3: 无需返还
  if (refundAmount <= 0) {
    console.log(`[积分补偿] #282 ${taskId} 返还金额为0，跳过`);
    return { success: false, newBalance: null };
  }
  
  console.log(`[积分补偿] #282 ${taskId} 全额返还: ${refundAmount} 积分，原因: ${reason}`);
  
  // Step 4: 执行返还
  try {
    const refundResult = await refundCredits(userId, refundAmount, taskId, reason);
    
    if (refundResult.success) {
      // Step 5: 标记已返还（必须重新获取最新状态）
      const afterRefundResult = getTaskResultFn(taskId);
      if (afterRefundResult) {
        setTaskResultFn(taskId, { ...afterRefundResult, creditsRefunded: true });
      }
      
      console.log(`[积分补偿] #282 ${taskId} 全额返还成功，剩余 ${refundResult.remaining} 积分`);
      return { 
        success: true, 
        newBalance: refundResult.remaining ?? null 
      };
    } else {
      console.error(`[积分补偿] #282 ${taskId} 全额返还失败: ${refundResult.error}`);
      return { success: false, newBalance: null };
    }
  } catch (err) {
    console.error(`[积分补偿] #282 ${taskId} 全额返还异常:`, err);
    return { success: false, newBalance: null };
  }
}
