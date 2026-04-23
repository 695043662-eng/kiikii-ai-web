import { NextRequest } from 'next/server';

// 设置 serverless 函数最长执行时间为 5 分钟（视频生成需要较长时间）
export const maxDuration = 300;

import { uploadToCOS, getSignedUrl } from '@/lib/cos';
import { getVideoAPIConfig } from '@/lib/api-config';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 环境变量兜底（符合军规第3条：数据库优先，环境变量兜底）
const FALLBACK_API_ENDPOINT = process.env.VIDEO_API_ENDPOINT || '';
const FALLBACK_API_KEY = process.env.VIDEO_API_KEY || '';

// 下载视频并上传到 COS
async function downloadAndUploadToCOS(videoUrl: string, index: number): Promise<string> {
  console.log(`下载视频 ${index + 1}: ${videoUrl.substring(0, 80)}...`);
  
  // 下载视频
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`下载视频失败: ${response.status}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  // 上传到 COS
  const key = `videos/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}.mp4`;
  await uploadToCOS(key, buffer, 'video/mp4');
  
  // 生成签名 URL（5天有效期）
  const signedUrl = await getSignedUrl(key, 432000);
  
  console.log(`视频 ${index + 1} 上传成功，URL: ${signedUrl.substring(0, 80)}...`);
  return signedUrl;
}

// 解析错误信息
function getErrorMessage(data: any): string {
  if (data.failure_reason) {
    switch (data.failure_reason) {
      case 'output_moderation':
        return '输出内容违规，积分已返还';
      case 'input_moderation':
        return '输入内容违规';
      case 'error':
        return data.error || '生成失败，请重试';
      default:
        return data.failure_reason;
    }
  }
  
  if (data.error) {
    return data.error;
  }
  
  return '生成失败';
}

export async function POST(request: NextRequest) {
  try {
    console.log('========================================');
    console.log('=== 视频生成 API 路由 (流式) ===');
    console.log('========================================');

    const body = await request.json();
    const { 
      model = 'sora-2',
      prompt,
      images = [],
      isUrls = false, // 标识 images 是 URL 还是 base64
      aspectRatio = '16:9',
      duration = 10,
      size = 'small',
      firstFrameUrl,
      lastFrameUrl,
      userId, // 用户 ID，用于保存到数据库
    } = body;

    console.log('请求参数:', {
      model,
      prompt: prompt?.substring(0, 100),
      aspectRatio,
      duration,
      size,
      imagesCount: images?.length || 0,
      isUrls,
      hasFirstFrame: !!firstFrameUrl,
      hasLastFrame: !!lastFrameUrl,
    });

    if (!prompt) {
      return new Response(JSON.stringify({ error: '缺少必要参数：prompt' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 从数据库获取 API 配置（第一优先级）
    const config = await getVideoAPIConfig();
    // 环境变量兜底（第二优先级）
    const baseEndpoint = config.apiEndpoint || FALLBACK_API_ENDPOINT;
    const apiKey = config.apiKey || FALLBACK_API_KEY;
    
    // 军规校验：如果数据库和环境变量都没有配置，抛出错误
    if (!apiKey) {
      console.error('[Video API] 违章施工：未配置视频 API Key（数据库或环境变量均无）');
      return new Response(JSON.stringify({ error: '服务配置错误：未配置视频 API Key' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    console.log('[Video API] 使用配置:', { endpoint: baseEndpoint, keyPrefix: apiKey.substring(0, 10) + '...' });
    
    // 判断模型类型
    const isVeoModel = model.startsWith('veo');
    const apiPath = `${baseEndpoint}/${isVeoModel ? 'veo' : 'sora-video'}`;

    // 上传图片到对象存储（如果不是URL）
    let uploadedUrls: string[] = [];
    if (images && images.length > 0) {
      if (isUrls) {
        // 前端已经上传过，直接使用 URL
        console.log(`使用前端上传的 ${images.length} 张参考图 URL`);
        uploadedUrls = images;
      } else {
        // 上传 base64 图片到 COS
        console.log(`开始上传 ${images.length} 张参考图到腾讯云 COS...`);

        try {
          const uploadPromises = images.map(async (image: string, i: number) => {
            let base64Data = image.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const key = `video-ref/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}.png`;

            await uploadToCOS(key, buffer, 'image/png');
            const url = await getSignedUrl(key, 432000); // 5天

            console.log(`图片 ${i + 1} 上传成功`);
            return url;
          });

          uploadedUrls = await Promise.all(uploadPromises);
          console.log(`所有参考图上传完成，共 ${uploadedUrls.length} 张`);
        } catch (uploadError) {
          console.error('上传参考图失败:', uploadError);
          return new Response(JSON.stringify({ 
            error: '上传参考图失败',
            details: uploadError instanceof Error ? uploadError.message : '未知错误'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // 构建请求参数
    const requestBody: any = {
      model,
      prompt,
      aspectRatio,
      shutProgress: true, // 关闭进度，直接返回最终结果
    };

    // Sora2 特有参数
    if (!isVeoModel) {
      requestBody.duration = duration;
      requestBody.size = size;
      
      // 参考图
      if (uploadedUrls.length > 0) {
        requestBody.url = uploadedUrls[0];
      }
    } else {
      // Veo3 参数
      if (uploadedUrls.length > 0) {
        requestBody.urls = uploadedUrls.slice(0, 3); // Veo3最多3张参考图
      }
      if (firstFrameUrl) {
        requestBody.firstFrameUrl = firstFrameUrl;
      }
      if (lastFrameUrl) {
        requestBody.lastFrameUrl = lastFrameUrl;
      }
    }

    console.log('请求体:', JSON.stringify(requestBody, null, 2));

    // 创建流式响应
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        // 发送开始事件
        sendEvent({ type: 'start', model });

        try {
          const response = await fetch(apiPath, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
          });

          const responseText = await response.text();
          console.log('API响应:', responseText);
          
          let data: any = null;
          if (responseText.startsWith('data:')) {
            // 流式响应格式
            const lines = responseText.split('\n');
            for (const line of lines) {
              if (line.startsWith('data:')) {
                const jsonStr = line.replace(/^data:\s*/, '');
                try {
                  data = JSON.parse(jsonStr);
                } catch (e) {
                  console.error('解析行失败:', line);
                }
              }
            }
          } else {
            // 普通JSON响应
            data = JSON.parse(responseText);
          }

          if (!data) {
            sendEvent({ type: 'error', error: '无法解析响应' });
            controller.close();
            return;
          }

          // 检查状态
          if (data.status === 'failed') {
            const errorMsg = getErrorMessage(data);
            sendEvent({ type: 'error', error: errorMsg });
            controller.close();
            return;
          }

          // 发送进度事件
          if (data.progress !== undefined) {
            sendEvent({ 
              type: 'progress', 
              progress: data.progress,
              status: data.status 
            });
          }

          // 处理结果
          if (data.status === 'succeeded') {
            sendEvent({ type: 'progress', progress: 95, status: 'uploading' });
            
            if (isVeoModel) {
              // Veo3 返回单个视频
              if (data.url) {
                try {
                  // 下载并上传到 COS
                  const cosUrl = await downloadAndUploadToCOS(data.url, 0);
                  
                  // 保存到数据库
                  if (userId) {
                    try {
                      const client = getSupabaseClient(undefined, true);
                      await client.from('generation_records').insert({
                        user_id: userId,
                        prompt: prompt,
                        model: model,
                        aspect_ratio: aspectRatio,
                        videos: [cosUrl],
                        created_at: new Date().toISOString(),
                      });
                      console.log('[Video] 已保存到数据库');
                    } catch (dbError) {
                      console.error('[Video] 保存到数据库失败:', dbError);
                    }
                  }
                  
                  sendEvent({ 
                    type: 'complete', 
                    videos: [cosUrl],
                    id: data.id 
                  });
                } catch (uploadError) {
                  console.error('上传视频失败，使用原始URL:', uploadError);
                  // 上传失败时使用原始 URL
                  sendEvent({ 
                    type: 'complete', 
                    videos: [data.url],
                    id: data.id 
                  });
                }
              }
            } else {
              // Sora2 返回 results 数组
              if (data.results && data.results.length > 0) {
                try {
                  // 下载并上传所有视频到 COS
                  const cosUrls = await Promise.all(
                    data.results.map((r: any, i: number) => downloadAndUploadToCOS(r.url, i))
                  );
                  const pids = data.results.map((r: any) => r.pid);
                  
                  // 保存到数据库
                  if (userId) {
                    try {
                      const client = getSupabaseClient(undefined, true);
                      await client.from('generation_records').insert({
                        user_id: userId,
                        prompt: prompt,
                        model: model,
                        aspect_ratio: aspectRatio,
                        videos: cosUrls,
                        created_at: new Date().toISOString(),
                      });
                      console.log('[Video] 已保存到数据库');
                    } catch (dbError) {
                      console.error('[Video] 保存到数据库失败:', dbError);
                    }
                  }
                  
                  sendEvent({ 
                    type: 'complete', 
                    videos: cosUrls,
                    pids,
                    id: data.id 
                  });
                } catch (uploadError) {
                  console.error('上传视频失败，使用原始URL:', uploadError);
                  // 上传失败时使用原始 URL
                  const videoUrls = data.results.map((r: any) => r.url);
                  const pids = data.results.map((r: any) => r.pid);
                  sendEvent({ 
                    type: 'complete', 
                    videos: videoUrls,
                    pids,
                    id: data.id 
                  });
                }
              }
            }
          } else if (data.status === 'running') {
            // 任务仍在运行，发送进度
            sendEvent({ 
              type: 'progress', 
              progress: data.progress || 0,
              status: 'running',
              id: data.id 
            });
          }
        } catch (error) {
          console.error('视频生成错误:', error);
          sendEvent({ 
            type: 'error', 
            error: error instanceof Error ? error.message : '生成失败' 
          });
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',  // #213 禁用 Nginx 缓冲
      },
    });

  } catch (error) {
    console.error('视频生成 API 错误:', error);
    return new Response(JSON.stringify({ 
      error: '服务器内部错误',
      details: error instanceof Error ? error.message : '未知错误'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
