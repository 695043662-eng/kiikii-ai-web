/**
 * 积分管理工具
 * 
 * ⚠️ 重要修复（#067）：所有积分操作使用 PostgREST REST API 直接操作，不走 RPC
 * 原因：PostgREST schema cache 不认 RPC 函数，导致 .rpc() 调用失败
 * 
 * ⚠️ 重要修复（#118）：动态读取数据库配置，确保使用正确的数据库
 * 原因：模块加载时 process.env 可能还没被 .env.local 覆盖
 * 
 * ⚠️ 重要修复（#298）：与 supabase-client.ts 保持一致，先加载 .env.production 再加载 .env.local
 * 原因：生产环境没有 .env.local，只有 .env.production
 */

import { getSupabaseClient } from '@/storage/database/supabase-client';
import * as fs from 'fs';
import * as path from 'path';

// 🔧 #176 开发环境隔离：优先级根据环境决定
// 开发环境：.env.local 优先（隔离开发数据库）
// 生产环境：系统环境变量优先
let cachedDbConfig: { url: string; serviceRoleKey: string } | null = null;

// #298 解析环境变量文件内容（与 supabase-client.ts 保持一致）
function parseEnvContent(content: string, result: Record<string, string>): void {
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
      // 不覆盖已存在的值（.env.production 优先）
      if (!result[key]) {
        result[key] = value;
      }
    }
  }
}

// 动态读取数据库配置
function getDbConfig(): { url: string; serviceRoleKey: string } {
  // 🔒 缓存命中，直接返回
  if (cachedDbConfig) {
    return cachedDbConfig;
  }
  
  // #298 修复：先加载 .env.production，再加载 .env.local（与 supabase-client.ts 一致）
  const localEnvValues: Record<string, string> = {};
  
  // 1. 先尝试加载 .env.production（生产环境优先）
  try {
    const prodPath = path.join(process.cwd(), '.env.production');
    if (fs.existsSync(prodPath)) {
      const content = fs.readFileSync(prodPath, 'utf-8');
      parseEnvContent(content, localEnvValues);
      console.log('[credits.ts] 📦 已加载 .env.production');
    }
  } catch {
    // ignore
  }
  
  // 2. 再尝试加载 .env.local（开发环境，不覆盖 .env.production 的值）
  try {
    const localPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(localPath)) {
      const content = fs.readFileSync(localPath, 'utf-8');
      parseEnvContent(content, localEnvValues);
      console.log('[credits.ts] 📦 已加载 .env.local');
    }
  } catch {
    // ignore
  }
  
  // 🔧 #176 判断是否开发环境
  const isDevelopment = process.env.NODE_ENV === 'development' || localEnvValues.NODE_ENV === 'development';
  
  // 优先级：系统环境变量 > 本地文件
  let url: string;
  let serviceRoleKey: string;
  
  if (isDevelopment) {
    // 开发环境：.env.local 优先（但 localEnvValues 已经合并了两个文件）
    url = localEnvValues.SUPABASE_URL || process.env.SUPABASE_URL || '';
    serviceRoleKey = localEnvValues.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    console.log('[credits.ts] 🔧 开发模式：使用本地环境文件');
  } else {
    // 生产环境：系统环境变量优先，回退到本地文件
    url = process.env.SUPABASE_URL || localEnvValues.SUPABASE_URL || '';
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || localEnvValues.SUPABASE_SERVICE_ROLE_KEY || '';
    console.log('[credits.ts] 🚀 生产模式：数据库配置已加载');
  }
  
  // 🔧 #175 开发环境回退：如果没有 service_role_key，回退到 anon_key
  if (!serviceRoleKey) {
    serviceRoleKey = isDevelopment 
      ? (localEnvValues.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '')
      : (process.env.SUPABASE_ANON_KEY || localEnvValues.SUPABASE_ANON_KEY || '');
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
  // #532 修复：多字段匹配，兼容前端传 size/value/label
  const resolutionConfig = resolutions.find((r: any) => 
    r.value === resolution || r.size === resolution || r.label === resolution
  );
  
  const creditsPerImage = resolutionConfig?.credits || config.credits_base || 10;

  console.log(`[calculateCredits] 模型=${modelId}, 分辨率=${resolution}, 匹配方式=${resolutionConfig ? (resolutionConfig.value === resolution ? 'value' : resolutionConfig.size === resolution ? 'size' : 'label') : 'fallback'}, 每张图=${creditsPerImage}, 数量=${generationCount}`);
  
  return creditsPerImage * generationCount;
}

/**
 * 扣除用户积分（CAS 乐观锁原子递减，根除脏读漏洞）
 * 
 * 🔥🔥🔥 P0 修复：将"先读-再算-后写"改为 CAS（Compare-And-Swap）乐观锁循环
 * 旧漏洞：N 个并发请求同时读到 C，都算 newCredits = C - N，都 PATCH 成功 → 只扣 1 次
 * CAS 方案：PATCH WHERE credits = C（精确匹配），只有 1 个请求命中 → 其余重试 → 全部正确扣减
 * 等价于 SQL: UPDATE users SET credits = credits - N WHERE id = X AND credits >= N RETURNING credits
 * 
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
  referenceId?: string,  // #271 新增：关联ID（如 taskId）
  description?: string,  // #851 新增：扣费描述（区分图片/视频）
): Promise<{ success: boolean; remaining?: number; error?: string }> {
  try {
    console.log(`[deductCredits] 开始扣除积分, userId=${userId}, credits=${credits}, referenceId=${referenceId}`);
    
    // ====== 开发环境白名单兜底逻辑（上帝模式）======
    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction) {
      console.log('[deductCredits] 🔓 开发环境上帝模式生效，模拟扣费成功');
      return { success: true, remaining: 99999 };
    }
    
    // 1. 查询当前积分 + #504 禁用状态
    const { status: getStatus, data: userData } = await restRequest('users', {
      query: `id=eq.${userId}&select=credits,is_active,locked_until`,
    });

    console.log(`[deductCredits] 查询用户结果: status=${getStatus}, data=`, userData);

    // #504 检查用户是否被禁用
    // 🚀 #505 优化：零写入自动解封 — 不再修改 is_active，用时间戳覆盖法判断
    // 永久禁用优先：is_active=false → 管理员手动禁用（无论 locked_until 状态）
    // 临时禁用：is_active=true 但 locked_until 在未来 → 违规自动禁用
    // 自动解封：locked_until 已过期 → 自然解封，无需 DB 写入
    if (getStatus === 200 && userData && userData.length > 0) {
      const user = userData[0];
      
      // 1. 永久禁用优先：is_active=false（管理员禁用）
      if (user.is_active === false) {
        console.log(`[deductCredits] #505 用户 ${userId} 被管理员手动禁用（永久）`);
        return { success: false, error: '账号已被禁用，请联系客服' };
      }
      
      // 2. 临时禁用：locked_until 在未来
      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
        const lockedUntilTime = new Date(user.locked_until).getTime();
        const remainingMinutes = Math.ceil((lockedUntilTime - Date.now()) / 60000);
        console.log(`[deductCredits] 用户 ${userId} 临时禁用中，还剩 ${remainingMinutes} 分钟（零写入，不更新DB）`);
        return { success: false, error: `您的账号因连续异常操作已被锁定，还剩 ${remainingMinutes} 分钟解封` };
      }
      // locked_until 已过期 → 自然解封，不做任何 DB 写入！
      // 成功生成时会通过 resetFailedAttempts 顺手清除 locked_until
    }

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

    // 3. 🔥🔥🔥 CAS（Compare-And-Swap）乐观锁原子递减
    // 根除"先读-再算-后写"脏读漏洞：N 个并发请求同时读到 C，
    // 旧逻辑都算出 newCredits = C - N，都 PATCH 成功 → 只扣 1 次！
    // CAS 逻辑：PATCH WHERE credits = C（精确匹配），只有 1 个请求能命中，
    // 其余请求影响 0 行 → 重试读新余额 → 重新 CAS → 最终全部正确扣减。
    const MAX_CAS_RETRIES = 5;
    let remainingCredits: number | undefined;
    let casSuccess = false;

    for (let attempt = 1; attempt <= MAX_CAS_RETRIES; attempt++) {
      // 3a. 检查积分是否足够
      if (currentCredits < credits) {
        console.log(`[deductCredits] CAS attempt=${attempt}: 积分不足 currentCredits=${currentCredits} < deductCredits=${credits}`);
        return {
          success: false,
          error: '积分不足',
          remaining: currentCredits,
        };
      }

      // 3b. 计算新余额
      const newCredits = currentCredits - credits;

      // 3c. CAS 写入：PATCH WHERE id=X AND credits=C（精确匹配 = 乐观锁）
      const { status: patchStatus, data: patchData } = await restRequest('users', {
        method: 'PATCH',
        query: `id=eq.${userId}&credits=eq.${currentCredits}`,  // CAS 精确匹配！
        body: { credits: newCredits, updated_at: new Date().toISOString() },
        prefer: 'return=representation',
      });

      if (patchStatus === 200 && patchData && patchData.length > 0) {
        // CAS 成功！只有读到同一 currentCredits 的请求能命中
        remainingCredits = patchData[0].credits;
        casSuccess = true;
        console.log(`[deductCredits] CAS 成功: attempt=${attempt}, oldCredits=${currentCredits}, deduct=${credits}, remaining=${remainingCredits}`);
        break;
      }

      // CAS 失败（并发冲突），重新读取最新余额
      console.warn(`[deductCredits] CAS 冲突: attempt=${attempt}, expected=${currentCredits}, 重试...`);
      const { data: retryData } = await restRequest('users', {
        query: `id=eq.${userId}&select=credits`,
      });

      if (!retryData || retryData.length === 0) {
        return { success: false, error: '用户不存在', remaining: 0 };
      }

      currentCredits = retryData[0].credits || 0;
    }

    // 4. CAS 全部失败（极端并发场景）
    if (!casSuccess) {
      console.error(`[deductCredits] CAS ${MAX_CAS_RETRIES} 轮全部冲突，返回最新余额`);
      return {
        success: false,
        error: '积分操作冲突，请重试',
        remaining: currentCredits,
      };
    }

    // 6. #271 双式记账：同步写入流水表（使用数据库返回的余额）
    const { status: logStatus } = await restRequest('credit_logs', {
      method: 'POST',
      body: {
        user_id: userId,
        amount: -credits,
        balance_after: remainingCredits,
        type: 'consume',
        reference_id: referenceId || null,
        description: description || `生成图片扣除 ${credits} 积分`,
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
/**
 * 检查用户积分是否足够（同时检查禁用状态）
 * 零写入自动解封 — 不再修改 is_active，用时间戳覆盖法判断
 * - 管理员永久禁用：is_active=false 且 locked_until=null → 永久禁用
 * - 系统临时禁用：locked_until 在未来（连续20次失败封禁6小时）→ 临时禁用
 * - 自动解封：locked_until 已过期 → 自然解封，零 DB 写入
 * - 成功生成时通过 resetFailedAttempts 顺手清除 locked_until
 */
export async function checkCreditsSufficient(
  userId: string,
  credits: number
): Promise<{ sufficient: boolean; currentCredits?: number; error?: string; isBanned?: boolean; bannedUntil?: string }> {
  try {
    // ====== 开发环境白名单兜底逻辑（上帝模式）======
    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction) {
      console.log('[checkCreditsSufficient] 🔓 开发环境上帝模式生效，返回充足积分');
      return {
        sufficient: true,
        currentCredits: 99999,
      };
    }

    const { status, data } = await restRequest('users', {
      query: `id=eq.${userId}&select=credits,is_active,locked_until`,
    });

    if (status !== 200 || !data || data.length === 0) {
      return {
        sufficient: false,
        error: '用户不存在',
      };
    }

    const user = data[0];

    // ====== #505 零写入自动解封判断 ======
    // 永久禁用优先：is_active=false → 管理员手动禁用（无论 locked_until 状态）
    if (user.is_active === false) {
      console.log(`[禁用检查] 用户 ${userId} 被管理员手动禁用（永久）`);
      return {
        sufficient: false,
        isBanned: true,
        error: '您的账号因连续异常操作已被锁定，请联系客服',
      };
    }

    // 临时禁用：locked_until 在未来
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const lockedUntilTime = new Date(user.locked_until).getTime();
      const remainingMinutes = Math.ceil((lockedUntilTime - Date.now()) / (60 * 1000));
      console.log(`[禁用检查] 用户 ${userId} 临时禁用中，还剩 ${remainingMinutes} 分钟（零写入）`);
      return {
        sufficient: false,
        isBanned: true,
        bannedUntil: user.locked_until,
        error: `您的账号因连续异常操作已被锁定，还剩 ${remainingMinutes} 分钟解封`,
      };
    }
    // locked_until 已过期 → 自然解封，零 DB 写入！
    // 留给 resetFailedAttempts（成功生成时）去顺手清理

    // ====== 检查积分 ======
    const currentCredits = user.credits || 0;
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
    // #502 修复：PostgREST on_conflict=reference_id,type 始终返回 400
    // 根因：PostgREST 无法正确识别复合唯一约束 (reference_id, type)
    // 导致所有 refund 被误判为"已退还"而跳过，积分永远不返还！
    // 修复：改用"先查后插"模式，避免 on_conflict 参数
    // ========================================
    if (taskId) {
      // #502: 先查询是否已存在同一 reference_id + type='refund' 的记录
      const { status: checkStatus, data: existingLogs } = await restRequest('credit_logs', {
        query: `reference_id=eq.${taskId}&type=eq.refund&select=id,amount`,
      });

      if (checkStatus === 200 && existingLogs && existingLogs.length > 0) {
        // 已存在退款记录，说明已被其他请求返还
        console.log(`[积分返还] #502 唯一约束防重: taskId=${taskId} 已被其他请求退还`);
        // #500 修复：即使 skipped，也必须查询数据库返回最新余额
        try {
          const { status: qStatus, data: qData } = await restRequest('users', {
            query: `id=eq.${userId}&select=credits`,
          });
          if (qStatus === 200 && qData && qData.length > 0) {
            const actualBalance = qData[0].credits || 0;
            console.log(`[积分返还] #502 skipped时查询最新余额: ${actualBalance}`);
            return {
              success: true,
              skipped: true,
              remaining: actualBalance,
              error: '该任务已退还过积分（并发防重复）',
            };
          }
        } catch (queryErr) {
          console.error(`[积分返还] #502 skipped时查询余额失败:`, queryErr);
        }
        return {
          success: true,
          skipped: true,
          error: '该任务已退还过积分（并发防重复）',
        };
      }

      // 不存在退款记录，插入新的日志记录
      const { status: insertStatus } = await restRequest('credit_logs', {
        method: 'POST',
        body: {
          user_id: userId,
          amount: credits,
          balance_after: 0,  // 先占位，后面更新积分后会补上
          type: 'refund',
          reference_id: taskId,
          description: reason,
          created_at: new Date().toISOString(),
        },
        prefer: 'return=representation',
        // #502: 不再使用 on_conflict 参数！
      });

      if (insertStatus === 409) {
        // 409 是真正的唯一约束冲突（极少数并发竞争场景）
        console.log(`[积分返还] #502 插入时唯一约束冲突: taskId=${taskId}，已被其他请求退还`);
        try {
          const { status: qStatus, data: qData } = await restRequest('users', {
            query: `id=eq.${userId}&select=credits`,
          });
          if (qStatus === 200 && qData && qData.length > 0) {
            return { success: true, skipped: true, remaining: qData[0].credits || 0, error: '并发冲突，已退还' };
          }
        } catch (e) { /* ignore */ }
        return { success: true, skipped: true, error: '并发冲突，已退还' };
      }

      if (insertStatus !== 201) {
        // 插入失败，再次检查是否被并发插入
        const { status: reCheckStatus, data: reCheckData } = await restRequest('credit_logs', {
          query: `reference_id=eq.${taskId}&type=eq.refund&select=id`,
        });
        if (reCheckStatus === 200 && reCheckData && reCheckData.length > 0) {
          console.log(`[积分返还] #502 重新检查确认: taskId=${taskId} 已退还过`);
          try {
            const { status: qStatus, data: qData } = await restRequest('users', {
              query: `id=eq.${userId}&select=credits`,
            });
            if (qStatus === 200 && qData && qData.length > 0) {
              return { success: true, skipped: true, remaining: qData[0].credits || 0, error: '已退还' };
            }
          } catch (e) { /* ignore */ }
          return { success: true, skipped: true, error: '已退还' };
        }
        // 插入失败且没有已存在的记录，继续尝试返还（可能没有唯一约束）
        console.log(`[积分返还] #502 插入日志失败 (status=${insertStatus})，继续尝试返还`);
      } else {
        console.log(`[积分返还] #502 日志记录已插入: taskId=${taskId}`);
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

    // 3. 如果之前有 taskId，回填 balance_after 到之前插入的日志
    if (taskId) {
      await restRequest('credit_logs', {
        method: 'PATCH',
        query: `reference_id=eq.${taskId}&type=eq.refund`,
        body: { balance_after: remainingCredits },
      });
    } else {
      // 如果之前没有插入日志（taskId 为空的情况），现在插入
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
        console.error('[积分返还] #502 记录流水失败');
      }
    }

    console.log(`[积分返还] #502 退还 ${credits} 积分成功，剩余: ${remainingCredits}, taskId: ${taskId}`);

    return {
      success: true,
      remaining: remainingCredits,
    };
  } catch (error: any) {
    console.error('[积分返还] #502 异常:', error);
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
  // ====== #499 积分返还监控日志 - 入口 ======
  console.log(`[积分返还监控] ========== handlePartialRefund 入口 ==========`);
  console.log(`[积分返还监控] taskId: ${taskId}`);
  console.log(`[积分返还监控] userId: ${userId}`);
  console.log(`[积分返还监控] generationCount: ${generationCount}`);
  console.log(`[积分返还监控] creditsPerImage: ${creditsPerImage}`);
  console.log(`[积分返还监控] reason: ${reason}`);
  console.log(`[积分返还监控] imageItems 详情:`);
  imageItems.forEach((item, idx) => {
    console.log(`[积分返还监控]   [${idx}] status=${item.status}, error=${item.error || '无'}`);
  });
  
  // Step 1: 获取最新状态（防止使用闭包旧变量）
  const latestResult = getTaskResultFn(taskId);
  console.log(`[积分返还监控] Step 1: 获取最新状态完成, creditsRefunded=${latestResult?.creditsRefunded}`);
  
  // Step 2: 防重检查（已返还则直接返回）
  if (latestResult?.creditsRefunded) {
    console.log(`[积分返还监控] ⚠️ 已返还过，尝试查询最新余额`);
    console.log(`[积分补偿] #282 ${taskId} 已返还过`);
    // #500 修复：即使已返还过，也查询数据库获取最新余额返回给前端
    try {
      const { status: qStatus, data: qData } = await restRequest('users', {
        query: `id=eq.${userId}&select=credits`,
      });
      if (qStatus === 200 && qData && qData.length > 0) {
        const actualBalance = qData[0].credits || 0;
        console.log(`[积分返还监控] Step 2: 已返还过，查询最新余额: ${actualBalance}`);
        return { success: false, refundAmount: 0, newBalance: actualBalance };
      }
    } catch (queryErr) {
      console.error(`[积分返还监控] Step 2: 查询余额失败:`, queryErr);
    }
    return { success: false, refundAmount: 0, newBalance: null };
  }
  
  // Step 3: 计算失败数量
  const failedCount = imageItems.filter(item => item.status === 'failed').length;
  const violationCount = imageItems.filter(item => 
    item.status === 'failed' && 
    (item.error === '内容违规' || item.error === '输入内容违规' || 
     item.error?.includes('moderation') || item.error?.includes('forbidden') ||
     item.error?.includes('PROHIBITED') || item.error?.includes('violation'))
  ).length;
  
  console.log(`[积分返还监控] Step 3: 失败数量=${failedCount}, 违规数量=${violationCount}`);
  
  // Step 4: 无失败则无需返还
  if (failedCount === 0) {
    console.log(`[积分返还监控] ⚠️ 无失败图片，无需返还，尝试查询最新余额`);
    console.log(`[积分补偿] #282 ${taskId} 无失败图片，无需返还`);
    // #502 修复：即使无需返还，也查询DB返回最新余额，避免前端使用旧的扣费后余额
    try {
      const { status: qStatus, data: qData } = await restRequest('users', {
        query: `id=eq.${userId}&select=credits`,
      });
      if (qStatus === 200 && qData && qData.length > 0) {
        const actualBalance = qData[0].credits || 0;
        console.log(`[积分返还监控] Step 4: 无失败图片，查询最新余额: ${actualBalance}`);
        return { success: false, refundAmount: 0, newBalance: actualBalance };
      }
    } catch (queryErr) {
      console.error(`[积分返还监控] Step 4: 查询余额失败:`, queryErr);
    }
    return { success: false, refundAmount: 0, newBalance: null };
  }
  
  // Step 5: 计算返还金额
  const refundAmount = failedCount * creditsPerImage;
  console.log(`[积分返还监控] Step 5: 返还金额=${refundAmount} (${failedCount} × ${creditsPerImage})`);
  console.log(`[积分返还监控] 📊 返还汇总: 总失败${failedCount}张, 违规${violationCount}张, 退还${refundAmount}积分`);
  console.log(`[积分补偿] #282 ${taskId} 开始返还: ${failedCount}/${generationCount} 张失败，退还 ${refundAmount} 积分，原因: ${reason}`);
  
  // Step 6: 【防并发】立即标记已返还（先标记再执行）
  const currentResult = getTaskResultFn(taskId);
  if (currentResult?.creditsRefunded) {
    console.log(`[积分返还监控] Step 6: 并发检测 - 已被其他进程返还，尝试查询最新余额`);
    console.log(`[积分补偿] #282 ${taskId} 并发检测：已被其他进程返还`);
    // #500 修复：并发跳过时也查询最新余额
    try {
      const { status: qStatus, data: qData } = await restRequest('users', {
        query: `id=eq.${userId}&select=credits`,
      });
      if (qStatus === 200 && qData && qData.length > 0) {
        const actualBalance = qData[0].credits || 0;
        console.log(`[积分返还监控] Step 6: 并发跳过，查询最新余额: ${actualBalance}`);
        return { success: false, refundAmount: 0, newBalance: actualBalance };
      }
    } catch (queryErr) {
      console.error(`[积分返还监控] Step 6: 查询余额失败:`, queryErr);
    }
    return { success: false, refundAmount: 0, newBalance: null };
  }
  setTaskResultFn(taskId, { ...currentResult, creditsRefunded: true });
  console.log(`[积分返还监控] Step 6: 已标记 creditsRefunded=true`);
  
  // Step 7: 执行返还
  console.log(`[积分返还监控] Step 7: 开始调用 refundCredits...`);
  try {
    const refundResult = await refundCredits(userId, refundAmount, taskId, reason);
    console.log(`[积分返还监控] refundCredits 结果: success=${refundResult.success}, remaining=${refundResult.remaining}, skipped=${refundResult.skipped}, error=${refundResult.error || '无'}`);
    
    if (refundResult.success) {
      // #299 检查是否是被数据库防重跳过的（skipped = true 表示没有实际返还）
      if (refundResult.skipped) {
        console.log(`[积分返还监控] ⚠️ 数据库防重跳过，已被其他进程返还，remaining=${refundResult.remaining}`);
        console.log(`[积分补偿] #299 ${taskId} 数据库防重跳过，已被其他进程返还`);
        // #500 修复：skipped 时如果有 remaining，仍需返回正确的 newBalance，否则前端积分不同步
        return { 
          success: false,  // 返回 false 表示本次没有实际返还
          refundAmount: 0, 
          newBalance: refundResult.remaining ?? null  // #500 返回数据库最新余额
        };
      }
      
      // #488 更新 generation_records 表的 refund_amount 字段
      console.log(`[积分返还监控] 开始更新 generation_records.refund_amount...`);
      try {
        const { status: updateStatus } = await restRequest('generation_records', {
          method: 'PATCH',
          body: { refund_amount: refundAmount },
          query: `task_id=eq.${taskId}`,
        });
        if (updateStatus === 200) {
          console.log(`[积分返还监控] ✅ generation_records.refund_amount 更新成功`);
          console.log(`[积分补偿] #488 ${taskId} 已更新 generation_records.refund_amount = ${refundAmount}`);
        } else {
          console.warn(`[积分返还监控] ⚠️ generation_records.refund_amount 更新失败: status=${updateStatus}`);
          console.warn(`[积分补偿] #488 ${taskId} 更新 generation_records.refund_amount 失败: status=${updateStatus}`);
        }
      } catch (updateErr) {
        console.error(`[积分返还监控] ❌ generation_records.refund_amount 更新异常:`, updateErr);
        console.error(`[积分补偿] #488 ${taskId} 更新 generation_records.refund_amount 异常:`, updateErr);
      }
      
      console.log(`[积分返还监控] ========== handlePartialRefund 成功 ==========`);
      console.log(`[积分返还监控] ✅ 返还成功: 退还${refundAmount}积分, 剩余${refundResult.remaining}积分`);
      console.log(`[积分补偿] #282 ${taskId} 返还成功，剩余 ${refundResult.remaining} 积分`);
      return { 
        success: true, 
        refundAmount, 
        newBalance: refundResult.remaining ?? null 
      };
    } else {
      // 返还失败，清除标记以便重试
      const failedResult = getTaskResultFn(taskId);
      setTaskResultFn(taskId, { ...failedResult, creditsRefunded: false });
      console.error(`[积分返还监控] ========== handlePartialRefund 失败 ==========`);
      console.error(`[积分返还监控] ❌ 返还失败: ${refundResult.error}`);
      console.error(`[积分补偿] #282 ${taskId} 返还失败: ${refundResult.error}`);
      // #502 修复：返还失败时仍查询DB返回最新余额，避免前端使用扣费后的旧余额
      try {
        const { status: qStatus, data: qData } = await restRequest('users', {
          query: `id=eq.${userId}&select=credits`,
        });
        if (qStatus === 200 && qData && qData.length > 0) {
          const actualBalance = qData[0].credits || 0;
          console.log(`[积分返还监控] Step 7 返还失败，查询最新余额: ${actualBalance}`);
          return { success: false, refundAmount: 0, newBalance: actualBalance };
        }
      } catch (queryErr) {
        console.error(`[积分返还监控] Step 7 返还失败后查询余额也失败:`, queryErr);
      }
      return { success: false, refundAmount: 0, newBalance: null };
    }
    } catch (err) {
    // 异常时清除标记以便重试
    const errResult = getTaskResultFn(taskId);
    setTaskResultFn(taskId, { ...errResult, creditsRefunded: false });
    console.error(`[积分返还监控] ========== handlePartialRefund 异常 ==========`);
    console.error(`[积分返还监控] ❌ 返还异常:`, err);
    console.error(`[积分补偿] #282 ${taskId} 返还异常:`, err);
    // #502 修复：异常时仍查询DB返回最新余额
    try {
      const { status: qStatus, data: qData } = await restRequest('users', {
        query: `id=eq.${userId}&select=credits`,
      });
      if (qStatus === 200 && qData && qData.length > 0) {
        const actualBalance = qData[0].credits || 0;
        console.log(`[积分返还监控] Step 7 异常，查询最新余额: ${actualBalance}`);
        return { success: false, refundAmount: 0, newBalance: actualBalance };
      }
    } catch (queryErr) {
      console.error(`[积分返还监控] Step 7 异常后查询余额也失败:`, queryErr);
    }
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
  // ====== #499 积分返还监控日志 - 入口 ======
  console.log(`[积分返还监控] ========== handleFullRefund 入口 ==========`);
  console.log(`[积分返还监控] taskId: ${taskId}`);
  console.log(`[积分返还监控] userId: ${userId}`);
  console.log(`[积分返还监控] refundAmount: ${refundAmount}`);
  console.log(`[积分返还监控] reason: ${reason}`);
  
  // Step 1: 获取最新状态（防止使用闭包旧变量）
  const latestResult = getTaskResultFn(taskId);
  console.log(`[积分返还监控] Step 1: 获取最新状态完成, creditsRefunded=${latestResult?.creditsRefunded}`);
  
  // Step 2: 防重检查（已返还则直接返回）
  if (latestResult?.creditsRefunded) {
    console.log(`[积分返还监控] ⚠️ 已返还过，跳过，尝试查询最新余额`);
    console.log(`[积分补偿] #282 ${taskId} 已返还过，跳过`);
    // #502 修复：与 handlePartialRefund Step2 保持一致，查询DB返回最新余额
    try {
      const { status: qStatus, data: qData } = await restRequest('users', {
        query: `id=eq.${userId}&select=credits`,
      });
      if (qStatus === 200 && qData && qData.length > 0) {
        const actualBalance = qData[0].credits || 0;
        console.log(`[积分返还监控] Step 2: 已返还过，查询最新余额: ${actualBalance}`);
        return { success: false, newBalance: actualBalance };
      }
    } catch (queryErr) {
      console.error(`[积分返还监控] Step 2: 查询余额失败:`, queryErr);
    }
    return { success: false, newBalance: null };
  }
  
  // Step 3: 无需返还
  if (refundAmount <= 0) {
    console.log(`[积分返还监控] ⚠️ 返还金额为0，跳过，尝试查询最新余额`);
    console.log(`[积分补偿] #282 ${taskId} 返还金额为0，跳过`);
    // #502 修复：即使无需返还，也查询DB返回最新余额，避免前端使用旧的扣费后余额
    try {
      const { status: qStatus, data: qData } = await restRequest('users', {
        query: `id=eq.${userId}&select=credits`,
      });
      if (qStatus === 200 && qData && qData.length > 0) {
        const actualBalance = qData[0].credits || 0;
        console.log(`[积分返还监控] Step 3: 无需返还，查询最新余额: ${actualBalance}`);
        return { success: false, newBalance: actualBalance };
      }
    } catch (queryErr) {
      console.error(`[积分返还监控] Step 3: 查询余额失败:`, queryErr);
    }
    return { success: false, newBalance: null };
  }
  
  console.log(`[积分返还监控] 📊 全额返还: ${refundAmount} 积分`);
  console.log(`[积分补偿] #282 ${taskId} 全额返还: ${refundAmount} 积分，原因: ${reason}`);
  
  // Step 4: 【防并发】立即标记已返还（先标记再执行）
  const currentResult = getTaskResultFn(taskId);
  if (currentResult?.creditsRefunded) {
    console.log(`[积分返还监控] Step 4: 并发检测 - 已被其他进程返还，尝试查询最新余额`);
    console.log(`[积分补偿] #282 ${taskId} 并发检测：已被其他进程返还`);
    // #500 修复：即使并发跳过，也查询数据库获取最新余额
    try {
      const { status: qStatus, data: qData } = await restRequest('users', {
        query: `id=eq.${userId}&select=credits`,
      });
      if (qStatus === 200 && qData && qData.length > 0) {
        const actualBalance = qData[0].credits || 0;
        console.log(`[积分返还监控] Step 4: 并发跳过，查询最新余额: ${actualBalance}`);
        return { success: false, newBalance: actualBalance };
      }
    } catch (queryErr) {
      console.error(`[积分返还监控] Step 4: 查询余额失败:`, queryErr);
    }
    return { success: false, newBalance: null };
  }
  setTaskResultFn(taskId, { ...currentResult, creditsRefunded: true });
  console.log(`[积分返还监控] Step 4: 已标记 creditsRefunded=true`);
  
  // Step 5: 执行返还
  console.log(`[积分返还监控] Step 5: 开始调用 refundCredits...`);
  try {
    const refundResult = await refundCredits(userId, refundAmount, taskId, reason);
    console.log(`[积分返还监控] refundCredits 结果: success=${refundResult.success}, remaining=${refundResult.remaining}, skipped=${refundResult.skipped}, error=${refundResult.error || '无'}`);
    
    if (refundResult.success) {
      // #500 修复：skipped 时也返回最新余额
      if (refundResult.skipped) {
        console.log(`[积分返还监控] ⚠️ handleFullRefund 数据库防重跳过，remaining=${refundResult.remaining}`);
        return { 
          success: false,
          newBalance: refundResult.remaining ?? null  // #500 返回数据库最新余额
        };
      }
      
      // #488 更新 generation_records 表的 refund_amount 字段
      console.log(`[积分返还监控] 开始更新 generation_records.refund_amount...`);
      try {
        const { status: updateStatus } = await restRequest('generation_records', {
          method: 'PATCH',
          body: { refund_amount: refundAmount },
          query: `task_id=eq.${taskId}`,
        });
        if (updateStatus === 200) {
          console.log(`[积分返还监控] ✅ generation_records.refund_amount 更新成功`);
          console.log(`[积分补偿] #488 ${taskId} 已更新 generation_records.refund_amount = ${refundAmount}`);
        } else {
          console.warn(`[积分返还监控] ⚠️ generation_records.refund_amount 更新失败: status=${updateStatus}`);
          console.warn(`[积分补偿] #488 ${taskId} 更新 generation_records.refund_amount 失败: status=${updateStatus}`);
        }
      } catch (updateErr) {
        console.error(`[积分返还监控] ❌ generation_records.refund_amount 更新异常:`, updateErr);
        console.error(`[积分补偿] #488 ${taskId} 更新 generation_records.refund_amount 异常:`, updateErr);
      }
      
      console.log(`[积分返还监控] ========== handleFullRefund 成功 ==========`);
      console.log(`[积分返还监控] ✅ 全额返还成功: 退还${refundAmount}积分, 剩余${refundResult.remaining}积分`);
      console.log(`[积分补偿] #282 ${taskId} 全额返还成功，剩余 ${refundResult.remaining} 积分`);
      return { 
        success: true, 
        newBalance: refundResult.remaining ?? null 
      };
    } else {
      // 返还失败，清除标记以便重试
      const failedResult = getTaskResultFn(taskId);
      setTaskResultFn(taskId, { ...failedResult, creditsRefunded: false });
      console.error(`[积分返还监控] ========== handleFullRefund 失败 ==========`);
      console.error(`[积分返还监控] ❌ 全额返还失败: ${refundResult.error}`);
      console.error(`[积分补偿] #282 ${taskId} 全额返还失败: ${refundResult.error}`);
      // #502 修复：返还失败时仍查询DB返回最新余额
      try {
        const { status: qStatus, data: qData } = await restRequest('users', {
          query: `id=eq.${userId}&select=credits`,
        });
        if (qStatus === 200 && qData && qData.length > 0) {
          const actualBalance = qData[0].credits || 0;
          console.log(`[积分返还监控] Step 5 返还失败，查询最新余额: ${actualBalance}`);
          return { success: false, newBalance: actualBalance };
        }
      } catch (queryErr) {
        console.error(`[积分返还监控] Step 5 返还失败后查询余额也失败:`, queryErr);
      }
      return { success: false, newBalance: null };
    }
  } catch (err) {
    // 异常时清除标记以便重试
    const errResult = getTaskResultFn(taskId);
    setTaskResultFn(taskId, { ...errResult, creditsRefunded: false });
    console.error(`[积分返还监控] ========== handleFullRefund 异常 ==========`);
    console.error(`[积分返还监控] ❌ 全额返还异常:`, err);
    console.error(`[积分补偿] #282 ${taskId} 全额返还异常:`, err);
    // #502 修复：异常时仍查询DB返回最新余额
    try {
      const { status: qStatus, data: qData } = await restRequest('users', {
        query: `id=eq.${userId}&select=credits`,
      });
      if (qStatus === 200 && qData && qData.length > 0) {
        const actualBalance = qData[0].credits || 0;
        console.log(`[积分返还监控] Step 5 异常，查询最新余额: ${actualBalance}`);
        return { success: false, newBalance: actualBalance };
      }
    } catch (queryErr) {
      console.error(`[积分返还监控] Step 5 异常后查询余额也失败:`, queryErr);
    }
    return { success: false, newBalance: null };
  }
}

// ========================================
// 账户锁定机制（连续违规禁用）
// ========================================
// #504 完整违规禁用机制：
// - 第5次违规：警告弹窗
// - 第10次违规：禁用账号30分钟（🚀 #505 只设置 locked_until，不修改 is_active）
// - 成功生成1次：重置计数 + 清除 locked_until
// - 禁用期满：零写入自动解封（locked_until 过期自然失效）
// - 管理后台：手动禁用/解封联动
// ========================================

const FAILED_ATTEMPTS_THRESHOLD = 20;  // 连续失败/违规 20 次才封禁账号
const BAN_DURATION_MINUTES = 360;      // 封禁时长 6 小时（360 分钟）

/**
 * 获取违规计数
 */
export async function getFailedAttempts(userId: string): Promise<number> {
  try {
    const { status, data } = await restRequest('users', {
      query: `id=eq.${userId}&select=failed_attempts`,
    });

    if (status !== 200 || !data || data.length === 0) {
      return 0;
    }

    return data[0].failed_attempts || 0;
  } catch (error) {
    console.error('[getFailedAttempts] 获取违规计数失败:', error);
    return 0;
  }
}

/**
 * 增加连续失败/违规计数（400内容违规 或 其他严重异常）
 * 🚀 重构逻辑：连续20次触发封禁6小时，成功1次清零
 * - 第10次：返回 warningLevel='warning'，前端弹警告弹窗
 * - 第20次：设置 locked_until=now+6h（不改 is_active），返回 warningLevel='banned'
 * - 封禁后 failed_attempts 重置为 0（解封后从 0 重新计算）
 * - 成功生成时调用 resetFailedAttempts 无条件清零
 */
export async function incrementFailedAttempts(userId: string): Promise<{
  failedAttempts: number;
  remainingAttempts: number;
  warningLevel: 'none' | 'warning' | 'banned';
  isBanned?: boolean;
  bannedUntil?: string;
}> {
  try {
    // 先获取当前计数
    const { status: getStatus, data: userData } = await restRequest('users', {
      query: `id=eq.${userId}&select=failed_attempts`,
    });

    if (getStatus !== 200 || !userData || userData.length === 0) {
      return { failedAttempts: 0, remainingAttempts: FAILED_ATTEMPTS_THRESHOLD, warningLevel: 'none' };
    }

    const currentAttempts = userData[0].failed_attempts || 0;
    const newAttempts = currentAttempts + 1;

    let warningLevel: 'none' | 'warning' | 'banned' = 'none';
    let isBanned = false;
    let bannedUntil: string | undefined;

    if (newAttempts >= FAILED_ATTEMPTS_THRESHOLD) {
      // ====== 连续第20次失败/违规：封禁账号 6 小时 ======
      // 只设置 locked_until，不修改 is_active（零写入解封）
      // 解封时零 DB 写入，locked_until 过期自然失效
      warningLevel = 'banned';
      isBanned = true;
      bannedUntil = new Date(Date.now() + BAN_DURATION_MINUTES * 60 * 1000).toISOString();

      await restRequest('users', {
        method: 'PATCH',
        query: `id=eq.${userId}`,
        body: {
          failed_attempts: 0,  // 重置计数，解封后从 0 开始
          locked_until: bannedUntil,  // 只设这个，不改 is_active！
        },
      });
      console.log(`[风控] 用户 ${userId} 连续失败达 ${FAILED_ATTEMPTS_THRESHOLD} 次，封禁 ${BAN_DURATION_MINUTES} 分钟（6小时），解封时间: ${bannedUntil}`);
    } else if (newAttempts >= 10) {
      // ====== 第10次失败/违规：警告 ======
      warningLevel = 'warning';

      await restRequest('users', {
        method: 'PATCH',
        query: `id=eq.${userId}`,
        body: { failed_attempts: newAttempts },
      });
      console.log(`[风控警告] 用户 ${userId} 连续失败次数: ${newAttempts}/${FAILED_ATTEMPTS_THRESHOLD}，触发警告弹窗`);
    } else {
      // ====== 第1-9次失败/违规：仅计数 ======
      await restRequest('users', {
        method: 'PATCH',
        query: `id=eq.${userId}`,
        body: { failed_attempts: newAttempts },
      });
      console.log(`[风控计数] 用户 ${userId} 连续失败次数: ${newAttempts}/${FAILED_ATTEMPTS_THRESHOLD}`);
    }

    return {
      failedAttempts: newAttempts >= FAILED_ATTEMPTS_THRESHOLD ? 0 : newAttempts,
      remainingAttempts: newAttempts >= FAILED_ATTEMPTS_THRESHOLD ? FAILED_ATTEMPTS_THRESHOLD : FAILED_ATTEMPTS_THRESHOLD - newAttempts,
      warningLevel,
      isBanned,
      bannedUntil,
    };
  } catch (error) {
    console.error('[incrementFailedAttempts] 增加失败计数失败:', error);
    return { failedAttempts: 0, remainingAttempts: FAILED_ATTEMPTS_THRESHOLD, warningLevel: 'none' };
  }
}

/**
 * 重置失败计数（成功生成后调用）
 * 核心规则：只要成功生成一张图片，无条件将 failed_attempts 重置为 0
 * 同时清除已过期的 locked_until（零写入解封的配合清理）
 */
export async function resetFailedAttempts(userId: string): Promise<void> {
  try {
    await restRequest('users', {
      method: 'PATCH',
      query: `id=eq.${userId}`,
      body: { failed_attempts: 0, locked_until: null },
    });
    console.log(`[风控] 用户 ${userId} 成功生成，连续失败计数清零`);
  } catch (error) {
    console.error('[resetFailedAttempts] 重置失败计数失败:', error);
  }
}

/**
 * 计算视频模型积分（按秒 × 分辨率单价）
 * 规则：480p=60积分/秒, 720p=80积分/秒, 1080p=100积分/秒
 * 优先从数据库模型配置的 parameters.videoPricing 读取，无则用默认值
 */
export async function calculateVideoCredits(
  modelId: string,
  resolution: string,
  durationSeconds: number
): Promise<number> {
  const config = await getModelConfig(modelId);

  if (!config) {
    console.warn(`[calculateVideoCredits] 未知模型: ${modelId}，使用默认积分`);
    return 80 * durationSeconds; // 默认720p
  }

  const parameters = config.parameters as any;

  // #548 固定计费模式：videoPricing.mode === 'fixed' 或无时长无分辨率的模型
  const showDuration = parameters?.showDuration !== false;
  const showResolution = parameters?.showResolution !== false;
  const videoPricing = parameters?.videoPricing;
  
  if (videoPricing?.mode === 'fixed' || (!showDuration && !showResolution)) {
    const fixedCredits = videoPricing?.credits || config.credits_base || 80;
    console.log(`[calculateVideoCredits] 固定计费: 模型=${modelId}, credits=${fixedCredits}`);
    return fixedCredits;
  }

  // 优先从数据库 parameters.videoPricing 读取计费规则
  if (videoPricing && typeof videoPricing === 'object') {
    // 数据库配置格式：{ "480p": 60, "720p": 80, "1080p": 100 }
    const ratePerSecond = videoPricing[resolution] || videoPricing['720p'] || 80;
    const total = ratePerSecond * durationSeconds;
    console.log(`[calculateVideoCredits] DB计费: 模型=${modelId}, 分辨率=${resolution}, 时长=${durationSeconds}s, 单价=${ratePerSecond}/秒, 总计=${total}`);
    return total;
  }

  // 默认计费规则
  const DEFAULT_VIDEO_RATES: Record<string, number> = {
    '480p': 60,
    '720p': 80,
    '1080p': 100,
  };

  const ratePerSecond = DEFAULT_VIDEO_RATES[resolution] || DEFAULT_VIDEO_RATES['720p'];
  const total = ratePerSecond * durationSeconds;
  console.log(`[calculateVideoCredits] 默认计费: 模型=${modelId}, 分辨率=${resolution}, 时长=${durationSeconds}s, 单价=${ratePerSecond}/秒, 总计=${total}`);
  return total;
}
