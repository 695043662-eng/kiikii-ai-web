import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { cookies } from 'next/headers';
import { getSignedUrl, deleteFromCOS, deleteMultipleFromCOS } from '@/lib/cos';

// 类型定义
interface GenerationRecord {
  id: number;
  images: string[];
  image_keys?: string[];
  model: string | null;
  prompt: string | null;
  resolution: string | null;
  aspect_ratio: string | null;
  reference_images?: string[];
  reference_image_keys?: string[];
  reference_image_md5s?: string[];  // #244 新增：参考图 MD5 哈希
  created_at: string;
}

// 从 COS URL 中提取 key
function extractCosKeyFromUrl(url: string): string | null {
  if (!url?.includes('cos.ap-hongkong.myqcloud.com')) return null;
  try {
    const pathname = new URL(url).pathname;
    return pathname?.startsWith('/') ? pathname.substring(1) : null;
  } catch {
    return null;
  }
}

// 获取用户生成记录列表 - 优化版
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ success: false, error: '未登录', records: [], total: 0 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = parseInt(searchParams.get('offset') || '0');
    const hours = parseInt(searchParams.get('hours') || '0');

    const client = getSupabaseClient(undefined, true);

    // #212 修复：先尝试完整查询，失败后回退到基础字段
    let records = null;
    let error = null;
    let count = null;

    // 尝试查询（包含 source 列）
    const fullQuery = await client
      .from('generation_records')
      .select('id, images, image_keys, model, prompt, resolution, aspect_ratio, reference_images, reference_image_keys, reference_image_md5s, task_id, videos, credits_charged, credits_balance, requested_count, success_count, credits_per_image, refund_amount, source, created_at', { count: 'exact' })
      .eq('user_id', userId);

    records = fullQuery.data;
    error = fullQuery.error;
    count = fullQuery.count;

    // #244 修复：如果失败且是因为 reference_image_md5s 列不存在，回退
    if (error && error.message && (
      error.message.includes('reference_image_md5s') ||
      error.message.includes('reference_image_keys')
    )) {
      console.log('[generation-records] reference_image_md5s/keys 列不存在，回退查询');
      const fallbackQuery = await client
        .from('generation_records')
        .select('id, images, image_keys, model, prompt, resolution, aspect_ratio, reference_images, task_id, videos, credits_charged, credits_balance, requested_count, success_count, credits_per_image, refund_amount, created_at', { count: 'exact' })
        .eq('user_id', userId);

      records = fallbackQuery.data;
      error = fallbackQuery.error;
      count = fallbackQuery.count;
    }

    // 如果失败且是因为 source 列不存在，回退到不包含 source 的查询
    if (error && error.message && error.message.includes('source')) {
      console.log('[generation-records] source 列不存在，回退到基础字段查询');
      const fallbackQuery = await client
        .from('generation_records')
        .select('id, images, image_keys, model, prompt, resolution, aspect_ratio, reference_images, reference_image_keys, reference_image_md5s, task_id, videos, credits_charged, credits_balance, requested_count, success_count, credits_per_image, refund_amount, created_at', { count: 'exact' })
        .eq('user_id', userId);

      records = fallbackQuery.data;
      error = fallbackQuery.error;
      count = fallbackQuery.count;
    }

    // 如果指定了 hours 参数，筛选最近几小时的记录
    if (hours > 0) {
      const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      // 需要重新查询带时间筛选
      const timeQuery = await client
        .from('generation_records')
        .select('id, images, image_keys, model, prompt, resolution, aspect_ratio, reference_images, reference_image_keys, reference_image_md5s, task_id, videos, credits_charged, credits_balance, requested_count, success_count, credits_per_image, refund_amount, created_at, source', { count: 'exact' })
        .eq('user_id', userId)
        .gte('created_at', cutoffTime)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      records = timeQuery.data;
      error = timeQuery.error;
      count = timeQuery.count;
    } else {
      // 添加排序和分页
      const sortedQuery = await client
        .from('generation_records')
        .select('id, images, image_keys, model, prompt, resolution, aspect_ratio, reference_images, reference_image_keys, reference_image_md5s, task_id, videos, credits_charged, credits_balance, requested_count, success_count, credits_per_image, refund_amount, created_at, source', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      records = sortedQuery.data;
      error = sortedQuery.error;
      count = sortedQuery.count;
    }

    console.log(`[generation-records] 查询耗时: ${Date.now() - startTime}ms, 记录数: ${records?.length || 0}, count: ${count}, error: ${error?.message || 'none'}`);

    if (error) {
      console.error('获取生成记录失败:', error.message || error);
      return NextResponse.json({ success: false, error: '获取记录失败', records: [], total: 0 });
    }

    // 处理图片URL - 使用签名 URL（直连 COS，不走代理）
    const processedRecords = await Promise.all((records || []).map(async (record: GenerationRecord) => {
      let imageUrls: string[] = [];
      let referenceImageUrls: string[] = [];
      
      if (record.image_keys && record.image_keys.length > 0) {
        // 并行获取所有签名 URL
        const urls = await Promise.all(
          record.image_keys.map(async (key: string) => {
            try {
              return await getSignedUrl(key, 432000); // 5天有效期
            } catch {
              return null;
            }
          })
        );
        imageUrls = urls.filter((url): url is string => url !== null);
      } else if (record.images && record.images.length > 0) {
        const cosKeys = record.images.map(extractCosKeyFromUrl).filter(Boolean) as string[];
        if (cosKeys.length > 0) {
          const urls = await Promise.all(
            cosKeys.map(async (key: string) => {
              try {
                return await getSignedUrl(key, 432000);
              } catch {
                return null;
              }
            })
          );
          imageUrls = urls.filter((url): url is string => url !== null);
        } else {
          imageUrls = record.images;
        }
      }

      // 处理参考图 URL（优先使用 reference_image_keys）
      if (record.reference_image_keys && record.reference_image_keys.length > 0) {
        // 优先使用存储的 COS keys 获取签名 URL
        const urls = await Promise.all(
          record.reference_image_keys.map(async (key: string) => {
            try {
              return await getSignedUrl(key, 432000); // 5天有效期
            } catch {
              return null;
            }
          })
        );
        referenceImageUrls = urls.filter((url): url is string => url !== null);
      } else if (record.reference_images && record.reference_images.length > 0) {
        // 兼容旧数据：从 URL 中提取 COS key
        const refCosKeys = record.reference_images.map(extractCosKeyFromUrl).filter(Boolean) as string[];
        if (refCosKeys.length > 0) {
          const urls = await Promise.all(
            refCosKeys.map(async (key: string) => {
              try {
                return await getSignedUrl(key, 432000);
              } catch {
                return null;
              }
            })
          );
          referenceImageUrls = urls.filter((url): url is string => url !== null);
        } else {
          // 旧数据可能是 base64（太大，不走列表返回），改用代理 URL 按需加载
          const hasBase64 = record.reference_images.some((img: string) => img?.startsWith('data:'));
          if (hasBase64) {
            // 为每张 base64 参考图生成代理 URL
            referenceImageUrls = record.reference_images.map((_: string, idx: number) =>
              `/api/ref-image-proxy?recordId=${record.id}&index=${idx}`
            );
          } else {
            referenceImageUrls = record.reference_images;
          }
        }
      }

      return { 
        ...record, 
        images: imageUrls, 
        reference_images: referenceImageUrls,
        // 🔧 #209 返回 image_keys 供前端缓存使用
        image_keys: record.image_keys,
        reference_image_keys: record.reference_image_keys,
        // #244 返回 reference_image_md5s 供前端去重使用
        reference_image_md5s: record.reference_image_md5s || [],
      };
    }));

    console.log(`[generation-records] 签名 URL 生成耗时: ${Date.now() - startTime}ms`);

    return NextResponse.json({ success: true, records: processedRecords, total: count || 0 });

  } catch (error) {
    console.error('获取生成记录错误:', error);
    return NextResponse.json({ success: false, error: '服务器错误', records: [], total: 0 });
  }
}

// 保存生成记录
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[generation-records] ====== POST 开始 ======');
  
  try {
    const cookieStore = await cookies();
    // #232 修复：服务端安全鉴权 - 优先从 cookie 获取 user_id
    let userId = cookieStore.get('user_id')?.value;
    console.log('[generation-records] Cookie user_id:', userId || '(空)');
    console.log('[generation-records] 所有 cookies:', cookieStore.getAll().map(c => c.name).join(', '));

    const body = await request.json();
    console.log('[generation-records] 请求体 user_id:', body.user_id || body.userId || '(空)');
    
    // 如果 cookie 中没有 user_id，从前端请求体获取（兼容开发环境）
    if (!userId) {
      userId = body.user_id || body.userId;
      console.log('[generation-records] 从请求体获取 user_id:', userId || '(仍为空)');
    }

    if (!userId) {
      console.error('[generation-records] 最终 userId 为空，返回 401');
      return NextResponse.json({ 
        success: false, 
        error: '未登录',
        code: 'AUTH_REQUIRED'
      }, { status: 401 });
    }

    console.log('[generation-records] 最终 userId:', userId);

    const { images, image_keys, model, prompt, resolution, aspect_ratio, reference_images, reference_image_keys, reference_image_md5s, task_id, credits_charged, credits_balance, source } = body;

    if (!images?.length) {
      console.log('[generation-records] 没有图片需要保存');
      return NextResponse.json({ success: false, error: '没有图片需要保存' });
    }

    const client = getSupabaseClient(undefined, true);

    // #212 修复：先尝试完整插入，失败后回退到基础字段（绕过 schema cache 问题）
    const insertData: any = {
      user_id: userId,
      images,
      image_keys: image_keys || [],
      model: model || null,
      prompt: prompt || null,
      resolution: resolution || null,
      aspect_ratio: aspect_ratio || null,
      reference_images: reference_images || [],
      reference_image_keys: reference_image_keys || [],
      reference_image_md5s: reference_image_md5s || [],
      credits_charged: credits_charged || 0,
      credits_balance: credits_balance,
    };

    // 添加 task_id（如果存在）
    if (task_id) {
      insertData.task_id = task_id;
    }

    // 添加 source（如果存在）
    if (source) {
      insertData.source = source;
    }

    // 尝试插入/更新
    let record = null;
    let error = null;

    // #232 修复：Supabase JS upsert onConflict 存在兼容性问题，改用"先查询后决定"策略
    if (task_id) {
      // 1. 先查询记录是否存在
      console.log('[generation-records] 查询 task_id:', task_id);
      const { data: existingRecord, error: queryError } = await client
        .from('generation_records')
        .select('id')
        .eq('task_id', task_id)
        .maybeSingle();

      if (queryError) {
        console.error('[generation-records] 查询失败:', queryError.message);
        error = queryError;
      } else if (existingRecord) {
        // 2. 记录存在，执行更新
        console.log('[generation-records] 记录已存在，执行更新, id:', existingRecord.id);
        const result = await client
          .from('generation_records')
          .update(insertData)
          .eq('id', existingRecord.id)
          .select()
          .single();
        record = result.data;
        error = result.error;
      } else {
        // 3. 记录不存在，执行插入
        console.log('[generation-records] 记录不存在，执行插入');
        const result = await client
          .from('generation_records')
          .insert(insertData)
          .select()
          .single();
        record = result.data;
        error = result.error;
      }
    } else {
      // 没有 task_id，直接插入
      const result = await client
        .from('generation_records')
        .insert(insertData)
        .select()
        .single();
      record = result.data;
      error = result.error;
    }

    // #244 修复：添加 fallback 逻辑处理 reference_image_md5s 字段不存在的情况
    if (error && error.message && (
      error.message.includes('reference_image_md5s') ||
      error.message.includes('reference_image_keys')
    )) {
      console.log('[generation-records] reference_image_md5s/keys 列不存在，回退');
      const fallbackData = { ...insertData };
      delete fallbackData.reference_image_md5s;
      delete fallbackData.reference_image_keys;
      
      if (task_id) {
        const { data: existingRecord } = await client
          .from('generation_records')
          .select('id')
          .eq('task_id', task_id)
          .maybeSingle();

        if (existingRecord) {
          const result = await client
            .from('generation_records')
            .update(fallbackData)
            .eq('id', existingRecord.id)
            .select()
            .single();
          record = result.data;
          error = result.error;
        } else {
          const result = await client
            .from('generation_records')
            .insert(fallbackData)
            .select()
            .single();
          record = result.data;
          error = result.error;
        }
      } else {
        const result = await client
          .from('generation_records')
          .insert(fallbackData)
          .select()
          .single();
        record = result.data;
        error = result.error;
      }
    }

    // 如果失败且是因为 source 列不存在，回退到不包含 source 的插入
    if (error && error.message && error.message.includes('source')) {
      console.log('[generation-records] source 列不存在，回退到基础字段');
      const fallbackData = { ...insertData };
      delete fallbackData.source;
      
      if (task_id) {
        // 回退时同样使用"先查询后决定"策略
        const { data: existingRecord } = await client
          .from('generation_records')
          .select('id')
          .eq('task_id', task_id)
          .maybeSingle();

        if (existingRecord) {
          const result = await client
            .from('generation_records')
            .update(fallbackData)
            .eq('id', existingRecord.id)
            .select()
            .single();
          record = result.data;
          error = result.error;
        } else {
          const result = await client
            .from('generation_records')
            .insert(fallbackData)
            .select()
            .single();
          record = result.data;
          error = result.error;
        }
      } else {
        const result = await client
          .from('generation_records')
          .insert(fallbackData)
          .select()
          .single();
        record = result.data;
        error = result.error;
      }
      console.log('[generation-records] 回退结果:', { record: !!record, error });
    }

    if (error) {
      console.error('[generation-records] ====== 保存失败 ======');
      console.error('[generation-records] 错误消息:', error.message);
      console.error('[generation-records] 错误详情:', error.details);
      console.error('[generation-records] 错误代码:', error.code);
      console.error('[generation-records] 错误提示:', error.hint);
      console.error('[generation-records] 耗时:', Date.now() - startTime, 'ms');
      return NextResponse.json({ 
        success: false, 
        error: '保存失败', 
        detail: error.message,
        code: error.code,
        hint: error.hint
      });
    }

    console.log('[generation-records] ====== 保存成功 ======');
    console.log('[generation-records] 记录 ID:', record?.id, '耗时:', Date.now() - startTime, 'ms');
    return NextResponse.json({ success: true, record });

  } catch (error) {
    console.error('[generation-records] ====== 服务器错误 ======');
    console.error('[generation-records] 错误:', error instanceof Error ? error.message : String(error));
    console.error('[generation-records] 堆栈:', error instanceof Error ? error.stack : '(无)');
    return NextResponse.json({ 
      success: false, 
      error: '服务器错误',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

// 增加 body size limit，支持 base64 参考图数据
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

// 删除生成记录（同时删除 COS 文件）
export async function DELETE(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ success: false, error: '未登录' });
    }

    const { searchParams } = new URL(request.url);
    const recordId = searchParams.get('id');

    if (!recordId) {
      return NextResponse.json({ success: false, error: '缺少记录ID' });
    }

    const client = getSupabaseClient(undefined, true);

    // 1. 先获取记录信息（包含 COS 的 imageKeys）
    const { data: record, error: fetchError } = await client
      .from('generation_records')
      .select('image_keys, reference_image_keys')
      .eq('id', recordId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !record) {
      return NextResponse.json({ success: false, error: '记录不存在' });
    }

    // 2. 收集所有需要删除的 COS 文件 keys
    const keysToDelete: string[] = [];

    // 添加生成图的 keys
    if (record.image_keys && record.image_keys.length > 0) {
      keysToDelete.push(...record.image_keys.filter((key: string) => key));
    }

    // 添加参考图的 keys
    if (record.reference_image_keys && record.reference_image_keys.length > 0) {
      keysToDelete.push(...record.reference_image_keys.filter((key: string) => key));
    }

    // 3. 删除 COS 文件
    if (keysToDelete.length > 0) {
      console.log('[DELETE] 准备删除 COS 文件:', keysToDelete);
      try {
        if (keysToDelete.length === 1) {
          await deleteFromCOS(keysToDelete[0]);
        } else {
          await deleteMultipleFromCOS(keysToDelete);
        }
        console.log('[DELETE] COS 文件删除成功');
      } catch (cosError) {
        console.error('[DELETE] COS 文件删除失败:', cosError);
        // COS 删除失败不影响数据库删除，继续执行
      }
    }

    // 4. 删除数据库记录
    const { error } = await client
      .from('generation_records')
      .delete()
      .eq('id', recordId)
      .eq('user_id', userId);

    if (error) {
      console.error('删除生成记录失败:', error);
      return NextResponse.json({ success: false, error: '删除失败' });
    }

    return NextResponse.json({ success: true, message: '删除成功' });

  } catch (error) {
    console.error('删除生成记录错误:', error);
    return NextResponse.json({ success: false, error: '服务器错误' });
  }
}
