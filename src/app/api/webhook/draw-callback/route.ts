import { NextRequest } from 'next/server';
import { setTaskResult, getTaskResult, TaskResult, findMainTaskIdByTerminalId } from '@/lib/taskResultsCache';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { safeErrorLog, safeLog } from '@/lib/errorHandler';
import { loadTaskMapping, deleteTaskMapping } from '@/lib/taskMapping';
import { handlePartialRefund, incrementFailedAttempts, resetFailedAttempts } from '@/lib/credits';
import { downloadAndUploadToCOS } from '@/lib/cos-upload';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Webhook HMAC 签名验证
 * 防止第三方伪造回调请求
 * 
 * 验证逻辑：
 * 1. 如果配置了 WEBHOOK_HMAC_SECRET，则强制验证签名
 * 2. 签名算法：HMAC-SHA256(secret, rawBody)
 * 3. 请求头 x-webhook-signature 携带签名值
 * 4. 如果未配置密钥，开发环境放行但记录警告，生产环境拒绝
 */
function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): { valid: boolean; error?: string } {
  const secret = process.env.WEBHOOK_HMAC_SECRET;
  
  if (!secret) {
    // 未配置密钥：开发环境放行，生产环境拒绝
    if (process.env.NODE_ENV === 'production') {
      return { valid: false, error: '生产环境必须配置 WEBHOOK_HMAC_SECRET' };
    }
    console.warn('[Webhook] ⚠️ 未配置 WEBHOOK_HMAC_SECRET，开发环境跳过签名验证');
    return { valid: true };
  }
  
  if (!signatureHeader) {
    return { valid: false, error: '缺少签名头 x-webhook-signature' };
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');
  
  // 使用时间安全的比较，防止时序攻击
  if (signatureHeader.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expectedSignature))) {
    return { valid: false, error: '签名验证失败' };
  }
  
  return { valid: true };
}

// 保存到数据库（异步，不阻塞响应）
async function saveToDatabase(
  taskId: string,
  userId: string,
  imageUrls: string[],
  imageKeys: (string | null)[],  // #306 修复：允许 null 值占位
  requestParams?: any
): Promise<void> {
  console.log(`[saveToDatabase] 开始保存任务 ${taskId}, userId=${userId}, images=${imageUrls.length}`);
  
  const maxRetries = 3;
  let lastError: any = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = getSupabaseClient(undefined, true);
    
    // 检查是否已保存
    const { data: existing } = await client
      .from('generation_records')
      .select('id')
      .eq('task_id', taskId)
      .maybeSingle();
    
    if (existing) {
      console.log(`[Webhook] 任务 ${taskId} 已保存到数据库，跳过`);
      return;
    }
    
    // 保存到数据库（使用 ON CONFLICT 防止重复插入）
    const { error } = await client
      .from('generation_records')
      .upsert({
        user_id: userId,
        task_id: taskId,
        images: imageUrls,
        image_keys: imageKeys,
        model: requestParams?.model || 'unknown',
        prompt: requestParams?.prompt || '',
        resolution: requestParams?.resolution || '1K',
        aspect_ratio: requestParams?.aspectRatio || 'auto',
      }, {
        onConflict: 'task_id', // task_id 是唯一键，重复时忽略
        ignoreDuplicates: true,
      });
    
    if (error) {
      lastError = error;
      console.error(`[Webhook] 保存到数据库失败 (尝试 ${attempt}/${maxRetries}):`, JSON.stringify(error));
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // 指数退避
        continue;
      }
    } else {
      console.log(`[Webhook] 任务 ${taskId} 已保存到数据库，${imageUrls.length} 张图片`);
      return;
    }
  } catch (error) {
    lastError = error;
    console.error(`[Webhook] 保存到数据库异常 (尝试 ${attempt}/${maxRetries}):`, error);
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      continue;
    }
  }
  }
  console.error(`[Webhook] 任务 ${taskId} 保存到数据库最终失败，已尝试 ${maxRetries} 次`);
}

// 任务ID映射目录
const TASK_ID_MAPPING_DIR = '/tmp/task-id-mapping';

// 反向查找：通过终端任务ID找到我们的任务ID和用户ID
function findOurTaskId(terminalTaskId: string): { 
  mainTaskId: string; 
  index: number; 
  fullTaskId: string;
  userId?: string;
  requestParams?: any;
} | null {
  try {
    if (!fs.existsSync(TASK_ID_MAPPING_DIR)) {
      return null;
    }
    
    const files = fs.readdirSync(TASK_ID_MAPPING_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(TASK_ID_MAPPING_DIR, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (data.terminalTaskId === terminalTaskId) {
            // 从文件内容中读取 index（优先使用）
            const index = data.index ?? 0;
            // 文件名格式：{ourTaskId}-{index}.json
            const ourTaskIdWithIndex = file.replace('.json', '');
            // 提取主任务ID（去掉最后的 -index 后缀）
            const lastDashIndex = ourTaskIdWithIndex.lastIndexOf('-');
            let mainTaskId = ourTaskIdWithIndex;
            if (lastDashIndex > 0) {
              mainTaskId = ourTaskIdWithIndex.substring(0, lastDashIndex);
            }
            return { 
              mainTaskId, 
              index, 
              fullTaskId: ourTaskIdWithIndex,
              userId: data.userId,
              requestParams: data.requestParams,
            };
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }
  } catch (error) {
    console.error('[Webhook] 查找映射失败:', error);
  }
  return null;
}

// 从响应中提取图片 URL（每个回调只取一张图片）
// #475 修复：检测违规标识
function extractSingleImageFromResponse(data: any): { url: string | null; isViolation: boolean; error?: string } {
  let rawUrl: string | null = null;
  
  // 情况1：直接返回单个图片URL
  if (data.url && typeof data.url === 'string') {
    rawUrl = data.url;
  }
  
  // 情况2：data.image_url
  if (data.image_url && typeof data.image_url === 'string') {
    rawUrl = data.image_url;
  }
  
  // 情况3：data.results 数组（取第一张）
  if (data.results && Array.isArray(data.results) && data.results.length > 0) {
    const first = data.results[0];
    if (first?.url && typeof first.url === 'string') {
      console.log(`[Webhook] 从 results 数组中取第一张图片（共${data.results.length}张）`);
      rawUrl = first.url;
    }
  }
  
  // 情况4：data.data 数组（取第一张）
  if (data.data && Array.isArray(data.data) && data.data.length > 0) {
    const first = data.data[0];
    if (first?.url && typeof first.url === 'string') {
      console.log(`[Webhook] 从 data 数组中取第一张图片（共${data.data.length}张）`);
      rawUrl = first.url;
    }
    if (first?.image_url && typeof first.image_url === 'string') {
      console.log(`[Webhook] 从 data 数组中取第一张图片（共${data.data.length}张）`);
      rawUrl = first.image_url;
    }
  }
  
  // #475 修复：检测违规标识
  if (rawUrl && (rawUrl.includes('PROHIBITED_CONTENT') || rawUrl.includes('violation'))) {
    console.error(`[Webhook] #475 检测到违规标识: ${rawUrl}`);
    return { url: null, isViolation: true, error: '内容违规，请修改提示词后重试' };
  }
  
  // 检测其他特殊标记（如 (TIMEOUT), (FAILED) 等）
  if (rawUrl && rawUrl.startsWith('(') && rawUrl.endsWith(')')) {
    const errorType = rawUrl.slice(1, -1);
    console.error(`[Webhook] #475 检测到特殊标记: ${errorType}`);
    return { url: null, isViolation: false, error: `生成失败: ${errorType}` };
  }
  
  // 检测 URL 是否有效（必须以 http 开头）
  if (rawUrl && !rawUrl.startsWith('http')) {
    console.error(`[Webhook] #475 URL 无效: ${rawUrl}`);
    return { url: null, isViolation: false, error: '生成失败：无效的图片地址' };
  }
  
  return { url: rawUrl, isViolation: false };
}

// Webhook 回调接口
export async function POST(request: NextRequest) {
  try {
    // ====== HMAC 签名验证 ======
    const rawBody = await request.text();
    const signature = request.headers.get('x-webhook-signature');
    const signatureResult = verifyWebhookSignature(rawBody, signature);
    if (!signatureResult.valid) {
      console.warn('[Webhook] 签名验证失败:', signatureResult.error);
      return new Response(JSON.stringify({ error: signatureResult.error }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: '无效的 JSON 请求体' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    console.log('[Webhook] 收到回调:', JSON.stringify(body, null, 2).substring(0, 1000));
    
    const terminalTaskId = body.id || body.task_id || body.taskId;
    
    if (!terminalTaskId) {
      console.error('[Webhook] 缺少任务ID');
      return new Response(JSON.stringify({ error: '缺少任务ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    console.log(`[Webhook] 处理终端任务: ${terminalTaskId}`);
    
    // 查找对应的任务
    let mappingResult = findOurTaskId(terminalTaskId) as any;

    // 如果映射找不到，尝试从缓存中查找主任务
    if (!mappingResult) {
      console.log(`[Webhook] 映射文件未找到，尝试从缓存中查找...`);
      const mainTaskId = findMainTaskIdByTerminalId(terminalTaskId);
      if (mainTaskId) {
        // 从 terminalTaskId 中提取 index（格式如 "6-xxx" 或 "12-xxx"）
        const indexMatch = terminalTaskId.match(/^(\d+)-/);
        const index = indexMatch ? parseInt(indexMatch[1]) : 0;

        // #267 从缓存获取 userId 和 requestParams
        const cachedResult = getTaskResult(mainTaskId);
        
        mappingResult = {
          mainTaskId,
          index,
          fullTaskId: `${mainTaskId}-${index}`,
          userId: cachedResult?.requestParams?.userId,  // #267 从缓存获取
          requestParams: cachedResult?.requestParams,   // #267 从缓存获取
        };
        console.log(`[Webhook] 从缓存找到主任务: ${mainTaskId}, index: ${index}, userId: ${cachedResult?.requestParams?.userId || '无'}`);
      }
    }

    // 如果还是找不到，尝试从COS查找（新增：解决重启后丢失映射的问题）
    if (!mappingResult) {
      console.log(`[Webhook] 缓存中也未找到，尝试从COS查找...`);
      try {
        const cosMapping = await loadTaskMapping(terminalTaskId);
        if (cosMapping) {
          mappingResult = {
            mainTaskId: cosMapping.ourTaskId,
            index: cosMapping.index,
            fullTaskId: `${cosMapping.ourTaskId}-${cosMapping.index}`,
            userId: cosMapping.userId,
            requestParams: cosMapping.requestParams,
          };
          console.log(`[Webhook] 从COS找到映射: ${cosMapping.ourTaskId}, userId: ${cosMapping.userId || '无'}`);
        } else {
          console.log(`[Webhook] COS中也未找到映射`);
        }
      } catch (error) {
        console.error('[Webhook] 从COS加载映射失败:', error);
      }
    }
    
    const status = body.status;
    console.log('[Webhook] 状态字段:', { status, failure_reason: body.failure_reason, error: body.error, reason: body.reason });
    
    // 检查是否完成
    if (status === 'completed' || body.results) {
      // 【修复】每个回调只处理一张图片
      const extractResult = extractSingleImageFromResponse(body);
      
      // #475 修复：检测违规标识
      if (extractResult.isViolation) {
        console.log(`[Webhook] #475 检测到违规，返回违规错误: ${extractResult.error}`);
        // 将此任务标记为违规失败
        const failureReason = 'output_moderation';
        const errorMsg = extractResult.error || '内容违规';
        
        if (mappingResult && mappingResult.mainTaskId) {
          const mainTaskId = mappingResult.mainTaskId;
          const itemIndex = mappingResult.index;
          const existingResult = getTaskResult(mainTaskId);
          
          if (existingResult) {
            // 更新 imageItems 中对应的状态
            const generationCount = existingResult.requestParams?.generationCount || 4;
            const imageItems = existingResult.imageItems || Array.from({ length: generationCount }, (_, idx) => ({
              index: idx,
              url: null,
              key: null,
              status: 'generating' as const,
              error: null,
            }));
            
            // 标记当前项为失败
            if (imageItems[itemIndex]) {
              imageItems[itemIndex] = {
                ...imageItems[itemIndex],
                status: 'failed' as const,
                error: errorMsg,
              };
            }
            
            // 检查是否全部完成
            const completedCount = imageItems.filter(i => i.status === 'completed' || i.status === 'failed').length;
            const isAllCompleted = completedCount >= generationCount;
            const hasSuccessfulImages = imageItems.some(i => i.status === 'completed');
            
            setTaskResult(mainTaskId, {
              ...existingResult,
              status: isAllCompleted ? (hasSuccessfulImages ? 'completed' : 'failed') : 'generating',
              imageItems,
              completedAt: isAllCompleted ? Date.now() : undefined,
            });
            
            console.log(`[Webhook] #475 更新违规状态: ${mainTaskId}, index: ${itemIndex}`);
            
            // 积分返还和违规计数
            if (isAllCompleted && mappingResult.userId) {
              const creditsPerImage = mappingResult.requestParams?.creditsPerImage || 0;
              try {
                await handlePartialRefund(
                  getTaskResult,
                  setTaskResult,
                  mainTaskId,
                  imageItems,
                  generationCount,
                  creditsPerImage,
                  mappingResult.userId,
                  `Webhook回调：部分图片失败`
                );
              } catch (err) {
                console.error(`[Webhook] #475 积分返还异常:`, err);
              }
              
              // 违规计数
              try {
                await incrementFailedAttempts(mappingResult.userId);
              } catch (err) {
                console.error(`[Webhook] #475 违规计数异常:`, err);
              }
            }
          }
        }
        
        return new Response(JSON.stringify({ success: true, message: '已记录违规状态' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // #475 修复：检测其他错误
      if (extractResult.error && !extractResult.url) {
        console.log(`[Webhook] #475 检测到错误: ${extractResult.error}`);
        // 类似违规处理，但不增加违规计数
        const errorMsg = extractResult.error;
        
        if (mappingResult && mappingResult.mainTaskId) {
          const mainTaskId = mappingResult.mainTaskId;
          const itemIndex = mappingResult.index;
          const existingResult = getTaskResult(mainTaskId);
          
          if (existingResult) {
            const generationCount = existingResult.requestParams?.generationCount || 4;
            const imageItems = existingResult.imageItems || Array.from({ length: generationCount }, (_, idx) => ({
              index: idx,
              url: null,
              key: null,
              status: 'generating' as const,
              error: null,
            }));
            
            if (imageItems[itemIndex]) {
              imageItems[itemIndex] = {
                ...imageItems[itemIndex],
                status: 'failed' as const,
                error: errorMsg,
              };
            }
            
            const completedCount = imageItems.filter(i => i.status === 'completed' || i.status === 'failed').length;
            const isAllCompleted = completedCount >= generationCount;
            const hasSuccessfulImages = imageItems.some(i => i.status === 'completed');
            
            setTaskResult(mainTaskId, {
              ...existingResult,
              status: isAllCompleted ? (hasSuccessfulImages ? 'completed' : 'failed') : 'generating',
              imageItems,
              completedAt: isAllCompleted ? Date.now() : undefined,
            });
            
            console.log(`[Webhook] #475 更新失败状态: ${mainTaskId}, index: ${itemIndex}`);
            
            // 积分返还
            if (isAllCompleted && mappingResult.userId) {
              const creditsPerImage = mappingResult.requestParams?.creditsPerImage || 0;
              try {
                await handlePartialRefund(
                  getTaskResult,
                  setTaskResult,
                  mainTaskId,
                  imageItems,
                  generationCount,
                  creditsPerImage,
                  mappingResult.userId,
                  `Webhook回调：部分图片失败`
                );
              } catch (err) {
                console.error(`[Webhook] #475 积分返还异常:`, err);
              }
            }
          }
        }
        
        return new Response(JSON.stringify({ success: true, message: '已记录失败状态' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      if (!extractResult.url) {
        console.log('[Webhook] 没有提取到图片，可能还在处理中');
        return new Response(JSON.stringify({ success: true, message: '等待图片' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      const imageUrl = extractResult.url;
      console.log(`[Webhook] 终端任务 ${terminalTaskId} 提取到图片: ${imageUrl.substring(0, 80)}...`);
      
      // 上传到 COS（单张图片）- 使用公共武器库
      let finalImageUrl: string;
      let finalImageKey: string | null = null;
      
      try {
        // 公共武器库接受 URL 数组，返回结果数组
        const uploadResults = await downloadAndUploadToCOS([imageUrl], 'generated-images');
        if (uploadResults.length > 0) {
          finalImageUrl = uploadResults[0].url;
          finalImageKey = uploadResults[0].key;
          console.log(`[Webhook] 图片上传成功，key: ${finalImageKey}`);
        } else {
          throw new Error('上传结果为空');
        }
      } catch (error: any) {
        console.error(`[Webhook] 图片上传失败:`, error.message);
        finalImageUrl = imageUrl; // 使用原始URL
      }
      
      // 更新缓存
      if (mappingResult && mappingResult.mainTaskId) {
        // 有映射，更新主任务
        const mainTaskId = mappingResult.mainTaskId;
        const itemIndex = mappingResult.index;
        
        console.log(`[Webhook] 更新主任务 ${mainTaskId} 的第 ${itemIndex} 张图片`);
        
        const existingResult = getTaskResult(mainTaskId) || {
          status: 'generating',
          imageUrls: [],
          imageKeys: [],
          errors: [],
          createdAt: Date.now(),
        };
        
        // 获取生成数量
        const generationCount = existingResult.requestParams?.generationCount || 4;
        const existingImageItems = existingResult.imageItems || [];
        
        // 检查这个位置是否已经有图片了（防止重复覆盖）
        const existingItemAt = existingImageItems.find(item => item.index === itemIndex);
        if (existingItemAt && existingItemAt.status === 'completed' && existingItemAt.url) {
          console.log(`[Webhook] 位置 ${itemIndex} 已有图片，跳过重复回调`);
          return new Response(JSON.stringify({ success: true, message: '已处理' }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        
        // 更新 imageItems
        const imageItems = Array.from({ length: generationCount }, (_, idx) => {
          const existing = existingImageItems.find(item => item.index === idx);
          if (idx === itemIndex) {
            // 更新当前位置
            return {
              index: idx,
              url: finalImageUrl,
              key: finalImageKey,
              status: 'completed' as const,
              error: null,
            };
          }
          if (existing) {
            return existing; // 保留其他位置的项
          }
          // 其他项保持 generating
          return {
            index: idx,
            url: null,
            key: null,
            status: 'generating' as const,
            error: null,
          };
        });
        
        // 计算完成数量
        const completedCount = imageItems.filter(i => i.status === 'completed' || i.status === 'failed').length;
        const isAllCompleted = completedCount >= generationCount;
        const hasSuccessfulImages = imageItems.some(i => i.status === 'completed');
        
        // 收集所有图片URL（按索引排列，保持索引一致性）
        const allUrls = new Array(generationCount).fill(null);
        const allKeys = new Array(generationCount).fill(null);
        imageItems.forEach(item => {
          allUrls[item.index] = item.url;
          allKeys[item.index] = item.key;
        });
        
        setTaskResult(mainTaskId, {
          ...existingResult,
          status: isAllCompleted ? (hasSuccessfulImages ? 'completed' : 'failed') : 'generating',
          imageUrls: allUrls,  // 按索引排列的数组（包含 null）
          imageKeys: allKeys,  // 按索引排列的数组（包含 null）
          imageItems: imageItems,
          completedAt: isAllCompleted ? Date.now() : undefined,
        });
        
        console.log(`[Webhook] 更新主任务: ${mainTaskId}, 进度: ${completedCount}/${generationCount}`);
        
        // #306 修复：数组错位 Bug - 确保 images 和 image_keys 长度一致
        // 1. 先提取所有成功的 URL，保证顺序和数量
        const validUrls = imageItems
          .filter(i => i.status === 'completed' && i.url)
          .map(i => i.url!);

        // 2. 👑 核心修复：严格按照 validUrls 的索引和数量，去映射 key。
        // 如果这张图没有 key，必须返回 null 占位，绝对不能破坏数组长度和索引对应关系！
        const validKeys: (string | null)[] = validUrls.map(url => {
          const matchedItem = imageItems.find(i => i.url === url);
          return matchedItem?.key || null;
        });
        
        console.log(`[Webhook] 检查保存条件: isAllCompleted=${isAllCompleted}, userId=${mappingResult.userId || '无'}, validUrls=${validUrls.length}`);
        if (isAllCompleted && mappingResult.userId && validUrls.length > 0) {
          console.log(`[Webhook] 开始保存到数据库...`);
          
          // ====== 成功生成，重置失败计数 ======
          if (validUrls.length > 0) {
            await resetFailedAttempts(mappingResult.userId);
          }
          
          saveToDatabase(
            mainTaskId,
            mappingResult.userId,
            validUrls,
            validKeys,
            mappingResult.requestParams
          ).then(async () => {
            // 保存成功后，删除COS映射（清理临时数据）
            console.log(`[Webhook] 保存成功，删除COS映射: ${terminalTaskId}`);
            await deleteTaskMapping(terminalTaskId);
          }).catch(err => console.error('[Webhook] 保存到数据库失败:', err));
        }
      } else {
        // 没有映射，直接用终端任务ID
        setTaskResult(terminalTaskId, {
          status: 'completed',
          imageUrls: [finalImageUrl],
          imageKeys: finalImageKey ? [finalImageKey] : [],
          errors: [],
          imageItems: [{
            index: 0,
            url: finalImageUrl,
            key: finalImageKey,
            status: 'completed',
            error: null,
          }],
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
        
        console.log(`[Webhook] 任务完成: ${terminalTaskId}, 1 张图片`);
      }
      
      return new Response(JSON.stringify({ 
        success: true, 
        taskId: terminalTaskId,
        images: 1 
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
      
    } else if (status === 'failed' || status === 'forbidden' || status === 'violation' || status === 'rejected') {
      // 处理失败和违规状态
      const failureReason = body.failure_reason || body.error?.reason || body.reason || '';
      const errorMsg = failureReason || body.error || body.message || '生成失败';
      
      // 判断是否违规
      const isViolation = failureReason === 'output_moderation' || failureReason === 'input_moderation' 
        || status === 'forbidden' || status === 'violation';
      const finalErrorMsg = isViolation ? failureReason : errorMsg;
      
      console.log(`[Webhook] 任务${isViolation ? '违规' : '失败'}: ${errorMsg}, status: ${status}`);
      
      if (mappingResult && mappingResult.mainTaskId) {
        const mainTaskId = mappingResult.mainTaskId;
        const itemIndex = mappingResult.index;
        const existingResult = getTaskResult(mainTaskId);
        
        // ====== 调试日志：检查 userId ======
        console.log(`[Webhook] 失败处理 - mainTaskId: ${mainTaskId}, itemIndex: ${itemIndex}`);
        console.log(`[Webhook] mappingResult.userId: ${mappingResult.userId || '空'}`);
        console.log(`[Webhook] mappingResult.requestParams?.userId: ${mappingResult.requestParams?.userId || '空'}`);
        
        if (existingResult) {
          // 更新错误列表
          const errors = [...(existingResult.errors || []), { index: itemIndex, error: finalErrorMsg }];
          
          // 更新 imageItems 中对应的状态
          const generationCount = existingResult.requestParams?.generationCount || 4;
          const imageItems = existingResult.imageItems || Array.from({ length: generationCount }, (_, idx) => ({
            index: idx,
            url: null,
            key: null,
            status: 'generating' as const,
            error: null,
          }));
          
          // 标记当前项为失败
          if (imageItems[itemIndex]) {
            imageItems[itemIndex] = {
              ...imageItems[itemIndex],
              status: 'failed' as const,
              error: finalErrorMsg,
            };
          }
          
          // 检查是否全部完成（成功或失败）
          const completedCount = imageItems.filter(i => i.status === 'completed' || i.status === 'failed').length;
          const isAllCompleted = completedCount >= generationCount;
          const hasSuccessfulImages = imageItems.some(i => i.status === 'completed');
          
          setTaskResult(mainTaskId, {
            ...existingResult,
            status: isAllCompleted ? (hasSuccessfulImages ? 'completed' : 'failed') : 'generating',
            errors,
            imageItems,
            completedAt: isAllCompleted ? Date.now() : undefined,
          });
          
          console.log(`[Webhook] 更新失败状态: ${mainTaskId}, index: ${itemIndex}, 进度: ${completedCount}/${generationCount}`);
          
          // ====== #282 统一积分返还 ======
          if (isAllCompleted && mappingResult.userId) {
            console.log(`[Webhook] 任务全部完成, isViolation=${isViolation}, userId=${mappingResult.userId}`);
            
            const creditsPerImage = mappingResult.requestParams?.creditsPerImage || 0;
            const generationCount = mappingResult.requestParams?.generationCount || imageItems.length;
            
            console.log(`[Webhook] #301 准备执行积分返还: creditsPerImage=${creditsPerImage}, generationCount=${generationCount}`);
            
            // #283 修复：必须使用 await 等待返还完成
            try {
              console.log(`[Webhook] #301 开始调用 handlePartialRefund...`);
              const refundResult = await handlePartialRefund(
                getTaskResult,
                setTaskResult,
                mainTaskId,
                imageItems,
                generationCount,
                creditsPerImage,
                mappingResult.userId,
                `Webhook回调：部分图片失败`
              );
              console.log(`[Webhook] #301 handlePartialRefund 返回: success=${refundResult.success}, refundAmount=${refundResult.refundAmount}`);
              if (refundResult.success) {
                console.log(`[积分补偿] #282 Webhook退还成功，剩余 ${refundResult.newBalance} 积分`);
              }
            } catch (err) {
              console.error(`[积分补偿] #282 Webhook退还异常:`, err);
            }
            
            // ====== 违规失败时增加失败计数 ======
            console.log(`[Webhook] #301 准备检查违规: isViolation=${isViolation}`);
            if (isViolation && mappingResult.userId) {
              console.log(`[Webhook] #301 开始调用 incrementFailedAttempts...`);
              try {
                const failedResult = await incrementFailedAttempts(mappingResult.userId);
                console.log(`[违规计数] 用户 ${mappingResult.userId} 违规次数: ${failedResult.failedAttempts}/${failedResult.failedAttempts + failedResult.remainingAttempts}`);
              } catch (err) {
                console.error(`[Webhook] #301 incrementFailedAttempts 异常:`, err);
              }
            }
          }
        }
      } else {
        setTaskResult(terminalTaskId, {
          status: 'failed',
          imageUrls: [],
          errors: [{ index: 0, error: errorMsg }],
          imageItems: [{ index: 0, url: null, key: null, status: 'failed', error: errorMsg }],
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
      }
      
      return new Response(JSON.stringify({ success: true, message: '已记录失败状态' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // 其他状态（如 running），忽略
    return new Response(JSON.stringify({ success: true, message: '状态更新' }), {
      headers: { 'Content-Type': 'application/json' },
    });
    
  } catch (error: any) {
    console.error('[Webhook] 处理回调失败:', error);
    return new Response(JSON.stringify({ 
      error: '处理失败', 
      details: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// GET 用于测试
export async function GET(request: NextRequest) {
  return new Response(JSON.stringify({ 
    message: 'Webhook 回调接口正常',
    timestamp: Date.now()
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
