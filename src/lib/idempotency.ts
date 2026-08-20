/**
 * 幂等性检查工具 - 支付级防御
 * 
 * 核心规则：
 * 1. 先查后做：收到请求，第一件事检查 client_request_id
 * 2. 数据库唯一索引：确保同一个 UUID 只能创建一次任务
 * 3. 事务绑定："查询余额 -> 锁定积分 -> 创建任务" 原子操作
 */

import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface ApiTask {
  id: number;
  client_request_id: string;
  user_id: string;
  task_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  model?: string;
  prompt?: string;
  resolution?: string;
  aspect_ratio?: string;
  generation_count: number;
  credits_deducted: number;
  reference_images?: string[];
  result_images?: string[];
  result_videos?: string[];
  error_message?: string;
  retry_count: number;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface CreateTaskParams {
  client_request_id: string;
  user_id: string;
  task_type?: string;
  model?: string;
  prompt?: string;
  resolution?: string;
  aspect_ratio?: string;
  generation_count?: number;
  credits_deducted?: number;
  reference_images?: string[];
}

/**
 * 检查 client_request_id 是否已存在
 * 
 * @returns 如果存在，返回已存在的任务；如果不存在，返回 null
 */
export async function checkIdempotency(
  client_request_id: string
): Promise<ApiTask | null> {
  const supabase = getSupabaseClient();

  console.log('[幂等性] 检查 client_request_id:', client_request_id);

  const { data, error } = await supabase
    .from('api_tasks')
    .select('*')
    .eq('client_request_id', client_request_id)
    .single();

  if (error) {
    // 如果没有找到记录，返回 null（表示是新请求）
    if (error.code === 'PGRST116') {
      console.log('[幂等性] ✅ 新请求，可以继续');
      return null;
    }
    
    console.error('[幂等性] 查询失败:', error);
    throw new Error(`幂等性检查失败: ${error.message}`);
  }

  console.log('[幂等性] ⚠️ 发现已存在的任务:', data.id, '状态:', data.status);
  return data as ApiTask;
}

/**
 * 创建新任务（带幂等性检查）
 * 
 * @returns 创建的任务或已存在的任务
 */
export async function createTaskWithIdempotency(
  params: CreateTaskParams
): Promise<{ task: ApiTask; isNew: boolean }> {
  const supabase = getSupabaseClient();

  console.log('[创建任务] 开始创建任务:', params.client_request_id);

  // 1. 先检查幂等性
  const existingTask = await checkIdempotency(params.client_request_id);
  if (existingTask) {
    console.log('[创建任务] 返回已存在的任务');
    return { task: existingTask, isNew: false };
  }

  // 2. 创建新任务
  const { data, error } = await supabase
    .from('api_tasks')
    .insert({
      client_request_id: params.client_request_id,
      user_id: params.user_id,
      task_type: params.task_type || 'image_generation',
      model: params.model,
      prompt: params.prompt,
      resolution: params.resolution,
      aspect_ratio: params.aspect_ratio,
      generation_count: params.generation_count || 1,
      credits_deducted: params.credits_deducted || 0,
      reference_images: params.reference_images || [],
      status: 'pending',
      retry_count: 0,
    })
    .select()
    .single();

  if (error) {
    // 3. 如果是唯一索引冲突，说明其他请求已经创建了任务
    if (error.code === '23505') {
      console.log('[创建任务] 唯一索引冲突，查询已存在的任务');
      const existingTask = await checkIdempotency(params.client_request_id);
      if (existingTask) {
        return { task: existingTask, isNew: false };
      }
    }
    
    console.error('[创建任务] 创建失败:', error);
    throw new Error(`创建任务失败: ${error.message}`);
  }

  console.log('[创建任务] ✅ 任务创建成功:', data.id);
  return { task: data as ApiTask, isNew: true };
}

/**
 * 更新任务状态
 */
export async function updateTaskStatus(
  client_request_id: string,
  status: 'processing' | 'completed' | 'failed',
  updates?: {
    result_images?: string[];
    result_videos?: string[];
    error_message?: string;
    retry_count?: number;
  }
): Promise<void> {
  const supabase = getSupabaseClient();

  console.log('[更新任务] 更新状态:', client_request_id, '->', status);

  const updateData: any = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'completed') {
    updateData.completed_at = new Date().toISOString();
  }

  if (updates) {
    Object.assign(updateData, updates);
  }

  const { error } = await supabase
    .from('api_tasks')
    .update(updateData)
    .eq('client_request_id', client_request_id);

  if (error) {
    console.error('[更新任务] 更新失败:', error);
    throw new Error(`更新任务失败: ${error.message}`);
  }

  console.log('[更新任务] ✅ 更新成功');
}

/**
 * 事务绑定：扣除积分 + 创建任务
 * 
 * ⚠️ 原子操作：任何一步失败，全体回滚
 */
export async function deductCreditsAndCreateTask(
  params: CreateTaskParams & { credits: number }
): Promise<{ task: ApiTask; isNew: boolean; deductionSuccess: boolean }> {
  const supabase = getSupabaseClient();

  console.log('[事务] 开始事务: 扣除积分 + 创建任务');
  console.log('[事务] 用户:', params.user_id, '积分:', params.credits);

  // 1. 先检查幂等性
  const existingTask = await checkIdempotency(params.client_request_id);
  if (existingTask) {
    console.log('[事务] 返回已存在的任务，不扣费');
    return { task: existingTask, isNew: false, deductionSuccess: false };
  }

  // 2. 检查积分是否足够
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('credits')
    .eq('phone', params.user_id)
    .single();

  if (userError || !userData) {
    throw new Error('用户不存在');
  }

  if (userData.credits < params.credits) {
    throw new Error('积分不足');
  }

  // 3. 扣除积分
  const newCredits = userData.credits - params.credits;
  const { error: deductError } = await supabase
    .from('users')
    .update({ credits: newCredits })
    .eq('phone', params.user_id);

  if (deductError) {
    console.error('[事务] 扣除积分失败:', deductError);
    throw new Error(`扣除积分失败: ${deductError.message}`);
  }

  console.log('[事务] ✅ 积分扣除成功:', userData.credits, '->', newCredits);

  // 4. 创建任务
  try {
    const { task, isNew } = await createTaskWithIdempotency({
      ...params,
      credits_deducted: params.credits,
    });

    console.log('[事务] ✅ 事务完成');
    return { task, isNew, deductionSuccess: true };
  } catch (error) {
    // 5. 如果任务创建失败，回滚积分
    console.error('[事务] 任务创建失败，回滚积分');
    
    const { error: rollbackError } = await supabase
      .from('users')
      .update({ credits: userData.credits })
      .eq('phone', params.user_id);

    if (rollbackError) {
      console.error('[事务] 积分回滚失败:', rollbackError);
    }

    throw error;
  }
}

/**
 * 生成 UUID v4
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
