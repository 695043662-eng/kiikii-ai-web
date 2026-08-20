import { NextRequest, NextResponse } from 'next/server';
import { getTaskResult } from '@/lib/taskResultsCache';
import { getTaskProgress } from '@/lib/taskProgressCache';
import { requireAuth } from '@/lib/auth-middleware';

/**
 * GET /api/video/status?taskId=xxx
 * 
 * 纯内存缓存读取 - 零延迟轮询端点
 * 严禁在此接口中进行任何耗时计算或数据库查询
 * 
 * #890 终极清扫：必须鉴权，防止匿名用户轮询他人任务状态
 * 
 * 返回结构：
 * {
 *   status: 'generating' | 'completed' | 'failed',
 *   progress: number (0-100),
 *   progressStatus: string,
 *   videos: string[] (completed 时),
 *   error: string (failed 时),
 *   creditsBalance: number
 * }
 */
export async function GET(request: NextRequest) {
  // #890 终极清扫：任务状态轮询必须鉴权
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');

  // 🔥🔥🔥 #722 调试日志：追踪轮询请求和缓存读取
  console.log('DEBUG_POLLING_REQUEST: taskId=', taskId, 'Time:', new Date().toISOString());

  if (!taskId) {
    return NextResponse.json(
      { error: '缺少 taskId 参数' },
      { status: 400 }
    );
  }

  // 🔥🔥🔥 #722 调试日志：打印缓存内容
  const cachedProgress = getTaskProgress(taskId);
  const cachedResult = getTaskResult(taskId);
  console.log('DEBUG_CACHE_READ: taskId=', taskId, 'progress=', JSON.stringify(cachedProgress), 'result.status=', cachedResult?.status);

  if (cachedResult) {
    const response: Record<string, unknown> = {
      status: cachedResult.status,
      progress: cachedProgress?.progress ?? (cachedResult.status === 'completed' ? 100 : undefined),
      progressStatus: cachedProgress?.status ?? cachedResult.status,
    };

    if (cachedResult.status === 'completed') {
      response.videos = cachedResult.imageUrls; // 视频URL存储在 imageUrls 字段
      // #721+1 补全字段：前端轮询需要 videoKeys 和 providerUrls
      response.videoKeys = cachedResult.videoKeys || cachedResult.imageKeys;
      response.providerUrls = cachedResult.providerUrls;
      response.imageItems = cachedResult.imageItems;
      response.creditsCharged = cachedResult.creditsCharged;
      response.creditsBalance = cachedResult.creditsBalance;
    }

    if (cachedResult.status === 'failed') {
      response.error = cachedResult.errors?.[0]?.error || '生成失败';
      response.creditsBalance = cachedResult.creditsBalance;
    }

    return NextResponse.json(response);
  }

  // 缓存未命中 - 任务可能仍在初始化中
  return NextResponse.json({
    status: 'generating',
    progress: cachedProgress?.progress ?? 0,
    progressStatus: cachedProgress?.status ?? 'initializing',
  });
}
