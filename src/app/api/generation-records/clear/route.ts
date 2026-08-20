import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth } from '@/lib/auth-middleware';
import { deleteFromCOS, deleteMultipleFromCOS } from '@/lib/cos';

// 批量删除记录（同时删除 COS 文件）
// 支持三种模式：
// 1. 全清（默认）：删除所有记录
// 2. 保留最近 N 条：keepRecent=N，删除除最近 N 条外的所有记录
// 3. 清除指定日期之前：beforeDate=ISO日期，删除该日期之前的所有记录
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth;

    const body = await request.json().catch(() => ({}));
    const { keepRecent, beforeDate } = body as { keepRecent?: number; beforeDate?: string };

    const client = getSupabaseClient(undefined, true);

    // 构建查询：确定要删除哪些记录
    let query = client
      .from('generation_records')
      .select('id, image_keys, reference_image_keys, created_at', { count: 'exact' })
      .eq('user_id', userId);

    // 模式2：保留最近 N 条
    if (keepRecent && keepRecent > 0) {
      // 先获取最近 N 条的最早时间，删除该时间之前的所有记录
      const { data: recentRecords } = await client
        .from('generation_records')
        .select('created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(0, keepRecent - 1);

      if (!recentRecords || recentRecords.length === 0) {
        return NextResponse.json({ success: true, message: '没有需要清空的记录' });
      }

      // 最早的"保留"记录的时间
      const cutoffTime = recentRecords[recentRecords.length - 1].created_at;
      query = query.lt('created_at', cutoffTime);
    }

    // 模式3：清除指定日期之前的记录
    if (beforeDate) {
      query = query.lt('created_at', beforeDate);
    }

    // 1. 获取要删除的记录
    const { data: records, error: fetchError } = await query;

    if (fetchError) {
      console.error('[CLEAR] 获取记录失败:', fetchError);
      return NextResponse.json({ success: false, error: '获取记录失败' }, { status: 500 });
    }

    if (!records || records.length === 0) {
      return NextResponse.json({ success: true, message: '没有需要清空的记录' });
    }

    console.log(`[CLEAR] 找到 ${records.length} 条记录需要清空 (keepRecent=${keepRecent}, beforeDate=${beforeDate})`);

    // 2. 收集所有需要删除的 COS 文件 keys
    const keysToDelete: string[] = [];

    records.forEach(record => {
      // 添加生成图的 keys
      if (record.image_keys && record.image_keys.length > 0) {
        keysToDelete.push(...record.image_keys.filter((key: string) => key));
      }
      // 添加参考图的 keys
      if (record.reference_image_keys && record.reference_image_keys.length > 0) {
        keysToDelete.push(...record.reference_image_keys.filter((key: string) => key));
      }
    });

    // 3. 批量删除 COS 文件
    if (keysToDelete.length > 0) {
      console.log(`[CLEAR] 准备删除 ${keysToDelete.length} 个 COS 文件`);
      try {
        // 使用批量删除接口
        await deleteMultipleFromCOS(keysToDelete);
        console.log('[CLEAR] COS 文件批量删除成功');
      } catch (cosError) {
        console.error('[CLEAR] COS 文件批量删除失败:', cosError);
        // COS 删除失败不影响数据库删除，继续执行
      }
    }

    // 4. 分批删除数据库记录（避免超时）
    const BATCH_SIZE = 100; // 每批删除 100 条
    let deletedCount = 0;
    let deleteError = null;

    // 收集所有记录 ID
    const recordIds = records.map(r => r.id);
    
    for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
      const batchIds = recordIds.slice(i, i + BATCH_SIZE);
      console.log(`[CLEAR] 删除批次 ${Math.floor(i / BATCH_SIZE) + 1}，共 ${batchIds.length} 条`);
      
      const { error } = await client
        .from('generation_records')
        .delete()
        .in('id', batchIds);

      if (error) {
        console.error(`[CLEAR] 批次删除失败:`, error);
        deleteError = error;
        // 继续尝试删除其他批次
      } else {
        deletedCount += batchIds.length;
      }
    }

    if (deleteError && deletedCount === 0) {
      console.error('[CLEAR] 数据库清空失败:', deleteError);
      return NextResponse.json({ success: false, error: '清空失败: ' + (deleteError.message || '未知错误') }, { status: 500 });
    }

    console.log(`[CLEAR] 成功清空 ${deletedCount}/${records.length} 条记录`);

    return NextResponse.json({
      success: true,
      message: `成功清空 ${deletedCount} 条记录`,
      deletedCount: deletedCount,
      totalCount: records.length,
      deletedCOSFiles: keysToDelete.length
    });

  } catch (error) {
    console.error('[CLEAR] 错误:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
