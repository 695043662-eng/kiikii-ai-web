/**
 * 图片生成 API - 生产环境防御级实现示例
 * 
 * ⚠️ 核心防御规则：
 * 1. 前端：2048px 压缩 + UUID + 状态锁
 * 2. 数据库：client_request_id 唯一索引 + 事务绑定
 * 3. 后端：50秒超时 + 错误分类 + 受控重试
 * 4. 资源：finally 清理临时文件
 * 
 * 📝 使用方法：
 * 这个文件展示了完整的防御流程，请参考此文件修改现有的 route.ts
 */

import { NextRequest, NextResponse } from 'next/server';

// 导入防御工具
import {
  checkIdempotency,
  deductCreditsAndCreateTask,
  updateTaskStatus,
  type CreateTaskParams,
} from '@/lib/idempotency';
import { fetchWithRetry, cleanupResources } from '@/lib/api-request';
import { classifyError, shouldRetry } from '@/lib/error-handler';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// ⚠️ Next.js 配置：最大执行时间 45 秒（预留 5 秒给清理）
export const maxDuration = 45;

/**
 * POST /api/image-generation
 * 
 * 请求体：
 * {
 *   client_request_id: string;  // 前端生成的 UUID
 *   model: string;              // 模型 ID
 *   prompt: string;             // 提示词
 *   resolution: string;         // 分辨率
 *   aspect_ratio: string;       // 宽高比
 *   generation_count: number;   // 生成数量
 *   reference_images?: string[]; // 参考图 URL
 * }
 */
export async function POST(request: NextRequest) {
  // 临时文件路径（用于清理）
  const tempFiles: string[] = [];

  try {
    console.log('[API] 收到图片生成请求');

    // ========== 1. 解析请求体 ==========
    const body = await request.json();
    const {
      client_request_id,
      model,
      prompt,
      resolution,
      aspect_ratio,
      generation_count = 1,
      reference_images = [],
    } = body;

    // ========== 2. 参数校验 ==========
    if (!client_request_id) {
      return NextResponse.json(
        { error: '缺少 client_request_id' },
        { status: 400 }
      );
    }

    if (!model || !prompt) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    console.log('[API] 请求参数:', {
      client_request_id,
      model,
      resolution,
      generation_count,
    });

    // ========== 3. 用户身份验证 ==========
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: '未授权' },
        { status: 401 }
      );
    }

    // ========== 4. 计算积分 ==========
    const credits = calculateCredits(model, resolution, generation_count);
    console.log('[API] 需要积分:', credits);

    // ========== 5. 幂等性检查 + 扣费 + 创建任务 ==========
    const { task, isNew, deductionSuccess } = await deductCreditsAndCreateTask({
      client_request_id,
      user_id: userId,
      task_type: 'image_generation',
      model,
      prompt,
      resolution,
      aspect_ratio,
      generation_count,
      credits,
      reference_images,
    });

    // 如果任务已存在，返回旧任务
    if (!isNew) {
      console.log('[API] 返回已存在的任务');
      return NextResponse.json({
        taskId: task.id,
        status: task.status,
        message: '任务已存在',
        result: task.result_images,
      });
    }

    console.log('[API] ✅ 新任务创建成功:', task.id);

    // ========== 6. 发送请求到供应商（50秒超时）==========
    const apiConfig = await getApiConfig(model);
    const requestBody = buildRequestBody({
      model,
      prompt,
      resolution,
      aspect_ratio,
      generation_count,
      reference_images,
    });

    // ⚠️ 核心防御：50 秒超时 + 受控重试
    const result = await fetchWithRetry({
      url: apiConfig.endpoint,
      headers: {
        Authorization: `Bearer ${apiConfig.apiKey}`,
      },
      body: requestBody,
      timeout: 50000, // ⚠️ 50 秒超时
    });

    // ========== 7. 处理响应 ==========
    if (!result.success) {
      const error = result.error!;

      // 更新任务状态为失败
      await updateTaskStatus(client_request_id, 'failed', {
        error_message: error.message,
      });

      // 根据错误类型返回不同的状态码
      const statusCode = getStatusCodeFromError(error.type);

      return NextResponse.json(
        {
          error: error.message,
          type: error.type,
          canRetry: error.canRetry,
        },
        { status: statusCode }
      );
    }

    // ========== 8. 处理成功响应 ==========
    const taskId = result.data.task_id || result.data.taskId;
    const imageUrls = result.data.imageUrls || result.data.images || [];

    // 更新任务状态为完成
    await updateTaskStatus(client_request_id, 'completed', {
      result_images: imageUrls,
    });

    console.log('[API] ✅ 任务完成');

    return NextResponse.json({
      success: true,
      taskId: taskId || task.id,
      imageUrls,
    });

  } catch (error: any) {
    console.error('[API] ❌ 请求处理失败:', error);

    // 错误分类
    const errorType = classifyError(error);
    const canRetry = shouldRetry(error);

    return NextResponse.json(
      {
        error: error.message || '服务器错误',
        type: errorType,
        canRetry,
      },
      { status: getStatusCodeFromError(errorType) }
    );
  } finally {
    // ========== 9. 清理临时文件 ==========
    if (tempFiles.length > 0) {
      await cleanupResources(tempFiles);
    }
  }
}

// ========== 辅助函数 ==========

/**
 * 计算积分
 */
function calculateCredits(model: string, resolution: string, count: number): number {
  // TODO: 从数据库获取模型积分配置
  const baseCredits = 10; // 默认积分
  const resolutionMultiplier = getResolutionMultiplier(resolution);
  
  return Math.round(baseCredits * resolutionMultiplier * count);
}

/**
 * 获取分辨率倍率
 */
function getResolutionMultiplier(resolution: string): number {
  const multipliers: Record<string, number> = {
    '1K': 1,
    '2K': 1.2,
    '4K': 1.5,
  };
  return multipliers[resolution] || 1;
}

/**
 * 获取 API 配置
 */
async function getApiConfig(model: string) {
  const supabase = getSupabaseClient();

  // 从数据库获取模型配置
  const { data: modelConfig, error } = await supabase
    .from('api_models')
    .select(`
      *,
      api_configs (*)
    `)
    .eq('model_id', model)
    .eq('is_active', true)
    .single();

  if (error || !modelConfig) {
    throw new Error(`模型配置不存在: ${model}`);
  }

  return {
    endpoint: modelConfig.api_configs.api_endpoint,
    apiKey: modelConfig.api_configs.api_key,
  };
}

/**
 * 构建请求体
 */
function buildRequestBody(params: any) {
  return {
    model: params.model,
    prompt: params.prompt,
    resolution: params.resolution,
    aspectRatio: params.aspect_ratio,
    count: params.generation_count,
    urls: params.reference_images,
  };
}

/**
 * 根据错误类型获取状态码
 */
function getStatusCodeFromError(errorType: string): number {
  const statusCodes: Record<string, number> = {
    'PARAM_ERROR': 400,
    'INSUFFICIENT_CREDITS': 402,
    'AUTH_ERROR': 401,
    'PERMISSION_ERROR': 403,
    'LOGIC_ERROR': 500,
    'NETWORK_ERROR': 502,
    'SUPPLIER_ERROR': 503,
    'TIMEOUT_ERROR': 504,
    'UNKNOWN_ERROR': 500,
  };
  
  return statusCodes[errorType] || 500;
}
