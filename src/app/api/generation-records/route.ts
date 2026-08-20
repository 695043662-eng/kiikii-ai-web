import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth } from '@/lib/auth-middleware';
import { batchGetSignedUrls, deleteFromCOS, deleteMultipleFromCOS } from '@/lib/cos';

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
  // #全局域名大一统 支持 img.kiikii.me 和原始 COS 域名
  if (!url?.includes('cos.ap-hongkong.myqcloud.com') && !url?.includes('img.kiikii.me')) return null;
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
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth;

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = parseInt(searchParams.get('offset') || '0');
    const hours = parseInt(searchParams.get('hours') || '0');
    const dateFrom = searchParams.get('dateFrom') || '';  // #841 日期范围筛选：起始日期
    const dateTo = searchParams.get('dateTo') || '';      // #841 日期范围筛选：结束日期

    const client = getSupabaseClient(undefined, true);

    // #757 优化：直接查询排序分页数据，移除冗余的首次全量查询
    // #819 新增 extra_data 字段（含 is_submitted 等标记）
    const selectFields = 'id, images, image_keys, model, prompt, resolution, aspect_ratio, reference_images, reference_image_keys, reference_image_md5s, task_id, videos, video_keys, credits_charged, credits_balance, requested_count, success_count, credits_per_image, refund_amount, source, created_at, extra_data';
    const selectFieldsFallback = 'id, images, image_keys, model, prompt, resolution, aspect_ratio, reference_images, task_id, videos, video_keys, credits_charged, credits_balance, requested_count, success_count, credits_per_image, refund_amount, created_at, extra_data';
    // #758 回退：video_keys 列不存在
    const selectFieldsNoVideoKeys = 'id, images, image_keys, model, prompt, resolution, aspect_ratio, reference_images, task_id, videos, credits_charged, credits_balance, requested_count, success_count, credits_per_image, refund_amount, created_at, extra_data';
    // #822 回退：extra_data 列不存在（开发数据库可能缺少此列）
    const selectFieldsNoExtraData = 'id, images, image_keys, model, prompt, resolution, aspect_ratio, reference_images, task_id, videos, credits_charged, credits_balance, requested_count, success_count, credits_per_image, refund_amount, created_at';

    let records = null;
    let error = null;
    let count = null;

    if (hours > 0) {
      // 指定时间范围查询
      const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const timeQuery = await client
        .from('generation_records')
        .select(selectFields, { count: 'exact' })
        .eq('user_id', userId)
        .gte('created_at', cutoffTime)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      records = timeQuery.data;
      error = timeQuery.error;
      count = timeQuery.count;

      // #244 回退：reference_image_md5s/keys 列不存在
      if (error && error.message && (
        error.message.includes('reference_image_md5s') ||
        error.message.includes('reference_image_keys')
      )) {
        console.log('[generation-records] 时间查询回退：reference_image_md5s/keys 列不存在');
        const fallbackQuery = await client
          .from('generation_records')
          .select(selectFieldsFallback, { count: 'exact' })
          .eq('user_id', userId)
          .gte('created_at', cutoffTime)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);
        records = fallbackQuery.data;
        error = fallbackQuery.error;
        count = fallbackQuery.count;
      }

      // source 列不存在回退
      if (error && error.message && error.message.includes('source')) {
        console.log('[generation-records] 时间查询回退：source 列不存在');
        const fallbackQuery = await client
          .from('generation_records')
          .select(selectFieldsFallback, { count: 'exact' })
          .eq('user_id', userId)
          .gte('created_at', cutoffTime)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);
        records = fallbackQuery.data;
        error = fallbackQuery.error;
        count = fallbackQuery.count;
      }

      // #822 回退：extra_data 列不存在
      if (error && error.message && error.message.includes('extra_data')) {
        console.log('[generation-records] 时间查询回退：extra_data 列不存在');
        const fallbackQuery = await client
          .from('generation_records')
          .select(selectFieldsNoExtraData, { count: 'exact' })
          .eq('user_id', userId)
          .gte('created_at', cutoffTime)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);
        records = fallbackQuery.data;
        error = fallbackQuery.error;
        count = fallbackQuery.count;
      }
    } else {
      // 排序分页查询（支持 #841 日期范围筛选）
      // 构建基础查询
      let queryBuilder = client
        .from('generation_records')
        .select(selectFields, { count: 'exact' })
        .eq('user_id', userId);

      // #841 日期范围筛选
      if (dateFrom) {
        queryBuilder = queryBuilder.gte('created_at', dateFrom);
      }
      if (dateTo) {
        // dateTo 是日期，需要包含该天全天，所以加一天作为上限
        const nextDay = new Date(dateTo);
        nextDay.setDate(nextDay.getDate() + 1);
        queryBuilder = queryBuilder.lt('created_at', nextDay.toISOString());
      }

      const sortedQuery = await queryBuilder
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      records = sortedQuery.data;
      error = sortedQuery.error;
      count = sortedQuery.count;

      // #244 回退：reference_image_md5s/keys 列不存在
      if (error && error.message && (
        error.message.includes('reference_image_md5s') ||
        error.message.includes('reference_image_keys')
      )) {
        console.log('[generation-records] 分页查询回退：reference_image_md5s/keys 列不存在');
        let fbQuery = client
          .from('generation_records')
          .select(selectFieldsFallback, { count: 'exact' })
          .eq('user_id', userId);
        if (dateFrom) fbQuery = fbQuery.gte('created_at', dateFrom);
        if (dateTo) {
          const nextDay = new Date(dateTo);
          nextDay.setDate(nextDay.getDate() + 1);
          fbQuery = fbQuery.lt('created_at', nextDay.toISOString());
        }
        const fallbackQuery = await fbQuery.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
        records = fallbackQuery.data;
        error = fallbackQuery.error;
        count = fallbackQuery.count;
      }

      // source 列不存在回退
      if (error && error.message && error.message.includes('source')) {
        console.log('[generation-records] 分页查询回退：source 列不存在');
        let fbQuery = client
          .from('generation_records')
          .select(selectFieldsFallback, { count: 'exact' })
          .eq('user_id', userId);
        if (dateFrom) fbQuery = fbQuery.gte('created_at', dateFrom);
        if (dateTo) {
          const nextDay = new Date(dateTo);
          nextDay.setDate(nextDay.getDate() + 1);
          fbQuery = fbQuery.lt('created_at', nextDay.toISOString());
        }
        const fallbackQuery = await fbQuery.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
        records = fallbackQuery.data;
        error = fallbackQuery.error;
        count = fallbackQuery.count;
      }

      // #758 回退：video_keys 列不存在
      if (error && error.message && error.message.includes('video_keys')) {
        console.log('[generation-records] 分页查询回退：video_keys 列不存在');
        let fbQuery = client
          .from('generation_records')
          .select(selectFieldsNoVideoKeys, { count: 'exact' })
          .eq('user_id', userId);
        if (dateFrom) fbQuery = fbQuery.gte('created_at', dateFrom);
        if (dateTo) {
          const nextDay = new Date(dateTo);
          nextDay.setDate(nextDay.getDate() + 1);
          fbQuery = fbQuery.lt('created_at', nextDay.toISOString());
        }
        const fallbackQuery = await fbQuery.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
        records = fallbackQuery.data;
        error = fallbackQuery.error;
        count = fallbackQuery.count;
      }

      // #822 回退：extra_data 列不存在
      if (error && error.message && error.message.includes('extra_data')) {
        console.log('[generation-records] 分页查询回退：extra_data 列不存在');
        let fbQuery = client
          .from('generation_records')
          .select(selectFieldsNoExtraData, { count: 'exact' })
          .eq('user_id', userId);
        if (dateFrom) fbQuery = fbQuery.gte('created_at', dateFrom);
        if (dateTo) {
          const nextDay = new Date(dateTo);
          nextDay.setDate(nextDay.getDate() + 1);
          fbQuery = fbQuery.lt('created_at', nextDay.toISOString());
        }
        const fallbackQuery = await fbQuery.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
        records = fallbackQuery.data;
        error = fallbackQuery.error;
        count = fallbackQuery.count;
      }
    }

    console.log(`[generation-records] 查询耗时: ${Date.now() - startTime}ms, 记录数: ${records?.length || 0}, count: ${count}, error: ${error?.message || 'none'}`);

    if (error) {
      console.error('获取生成记录失败:', error.message || error);
      return NextResponse.json({ success: false, error: '获取记录失败', records: [], total: 0 });
    }

    // #757 优化：批量收集所有记录的 COS key，一次性生成签名 URL，避免逐条串行调用
    const allImageKeys: string[] = [];
    const allRefKeys: string[] = [];
    const allVideoKeys: string[] = [];

    // 记录每条记录的 key 索引范围，用于后续分配结果
    const recordKeyRanges: { imgStart: number; imgCount: number; refStart: number; refCount: number; vidStart: number; vidCount: number }[] = [];

    for (const record of (records || [])) {
      const rec = record as GenerationRecord;
      // 收集 image keys
      let imgKeys: string[] = [];
      if (rec.image_keys && rec.image_keys.length > 0) {
        imgKeys = rec.image_keys;
      } else if (rec.images && rec.images.length > 0) {
        const cosKeys = rec.images.map(extractCosKeyFromUrl).filter(Boolean) as string[];
        if (cosKeys.length > 0) imgKeys = cosKeys;
      }
      const imgStart = allImageKeys.length;
      allImageKeys.push(...imgKeys);

      // 收集 reference image keys
      let refKeys: string[] = [];
      if (rec.reference_image_keys && rec.reference_image_keys.length > 0) {
        refKeys = rec.reference_image_keys;
      } else if (rec.reference_images && rec.reference_images.length > 0) {
        const cosKeys = rec.reference_images.map(extractCosKeyFromUrl).filter(Boolean) as string[];
        if (cosKeys.length > 0) refKeys = cosKeys;
      }
      const refStart = allRefKeys.length;
      allRefKeys.push(...refKeys);

      // 收集 video keys
      let vidKeys: string[] = [];
      if ((rec as any).video_keys && (rec as any).video_keys.length > 0) {
        vidKeys = (rec as any).video_keys;
      } else if ((rec as any).videos && (rec as any).videos.length > 0) {
        const cosKeys = (rec as any).videos.map(extractCosKeyFromUrl).filter(Boolean) as string[];
        if (cosKeys.length > 0) vidKeys = cosKeys;
      }
      const vidStart = allVideoKeys.length;
      allVideoKeys.push(...vidKeys);

      recordKeyRanges.push({ imgStart, imgCount: imgKeys.length, refStart, refCount: refKeys.length, vidStart, vidCount: vidKeys.length });
    }

    // 一次性批量生成所有签名 URL
    // 🔥 #830 batchGetSignedUrls 返回 (string|null)[]，null 表示该 key 签名失败
    const [allImageUrls, allRefUrls, allVideoUrls] = await Promise.all([
      allImageKeys.length > 0 ? batchGetSignedUrls(allImageKeys) : Promise.resolve([]),
      allRefKeys.length > 0 ? batchGetSignedUrls(allRefKeys) : Promise.resolve([]),
      allVideoKeys.length > 0 ? batchGetSignedUrls(allVideoKeys) : Promise.resolve([]),
    ]);

    // #830 辅助：将 null 映射为空字符串（前端 onError 兜底走代理 URL）
    const safeUrl = (url: string | null) => url || '';

    // 分配结果到每条记录
    const processedRecords = (records || []).map((record: GenerationRecord, i: number) => {
      const ranges = recordKeyRanges[i];

      // 生成图 URL
      let imageUrls: string[];
      if (record.image_keys && record.image_keys.length > 0) {
        imageUrls = allImageUrls.slice(ranges.imgStart, ranges.imgStart + ranges.imgCount).map(safeUrl);
      } else if (record.images && record.images.length > 0) {
        const cosKeys = record.images.map(extractCosKeyFromUrl).filter(Boolean) as string[];
        if (cosKeys.length > 0) {
          imageUrls = allImageUrls.slice(ranges.imgStart, ranges.imgStart + ranges.imgCount).map(safeUrl);
        } else {
          // 非 COS URL（可能是 base64 或外部 URL），使用原始值
          const hasBase64 = record.images.some((img: string) => img?.startsWith('data:'));
          imageUrls = hasBase64 ? [] : record.images; // base64 太大，不在列表返回
        }
      } else {
        imageUrls = [];
      }

      // 参考图 URL
      let referenceImageUrls: string[];
      if (record.reference_image_keys && record.reference_image_keys.length > 0) {
        referenceImageUrls = allRefUrls.slice(ranges.refStart, ranges.refStart + ranges.refCount).map(safeUrl);
      } else if (record.reference_images && record.reference_images.length > 0) {
        const cosKeys = record.reference_images.map(extractCosKeyFromUrl).filter(Boolean) as string[];
        if (cosKeys.length > 0) {
          referenceImageUrls = allRefUrls.slice(ranges.refStart, ranges.refStart + ranges.refCount).map(safeUrl);
        } else {
          const hasBase64 = record.reference_images.some((img: string) => img?.startsWith('data:'));
          if (hasBase64) {
            referenceImageUrls = record.reference_images.map((_: string, idx: number) =>
              `/api/ref-image-proxy?recordId=${record.id}&index=${idx}`
            );
          } else {
            referenceImageUrls = record.reference_images;
          }
        }
      } else {
        referenceImageUrls = [];
      }

      // 视频 URL
      let videoUrls: string[];
      if ((record as any).video_keys && (record as any).video_keys.length > 0) {
        videoUrls = allVideoUrls.slice(ranges.vidStart, ranges.vidStart + ranges.vidCount).map(safeUrl);
      } else if ((record as any).videos && (record as any).videos.length > 0) {
        const cosKeys = (record as any).videos.map(extractCosKeyFromUrl).filter(Boolean) as string[];
        if (cosKeys.length > 0) {
          videoUrls = allVideoUrls.slice(ranges.vidStart, ranges.vidStart + ranges.vidCount).map(safeUrl);
        } else {
          videoUrls = (record as any).videos;
        }
      } else {
        videoUrls = [];
      }

      return {
        ...record,
        images: imageUrls,
        reference_images: referenceImageUrls,
        videos: videoUrls,
        image_keys: record.image_keys,
        reference_image_keys: record.reference_image_keys,
        video_keys: (record as any).video_keys,
        reference_image_md5s: record.reference_image_md5s || [],
      };
    });

    // #562 查询 api_models 获取 model_id → model_name 映射
    const modelNameMap = new Map<string, string>();
    try {
      const { data: modelData } = await client
        .from('api_models')
        .select('model_id, model_name');
      if (modelData) {
        modelData.forEach((m: { model_id: string; model_name: string }) => {
          modelNameMap.set(m.model_id, m.model_name);
        });
      }
    } catch (e) {
      console.error('[generation-records] 获取模型名称映射失败:', e);
    }

    console.log(`[generation-records] 签名 URL 生成耗时: ${Date.now() - startTime}ms`);

    // #819 提取 is_submitted 状态供前端判断
    // #562 为每条记录添加 model_name（用户可见的模型名称）
    const finalRecords = processedRecords.map((r: any) => ({
      ...r,
      model_name: modelNameMap.get(r.model) || r.model || '',
      is_submitted: r.extra_data?.is_submitted || false,
    }));

    return NextResponse.json({ success: true, records: finalRecords, total: count || 0 });

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
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth;

    const body = await request.json();

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
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth;

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
