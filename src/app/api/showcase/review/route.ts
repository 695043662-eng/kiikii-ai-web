/**
 * POST /api/showcase/review
 * 
 * 管理员审核展示卡片
 * 
 * 动作：
 * - approve: COS 跨桶 Copy (Temp→Perm) + 更新状态为 approved
 * - reject: 更新状态为 rejected + 记录拒绝原因
 * 
 * 安全措施：
 * 1. requireAdmin 验证管理员身份
 * 2. CopyObject 严密 try-catch，NoSuchKey 兜底改 status=expired
 * 3. Copy 成功后原子性更新数据库 URL
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAdmin } from '@/lib/admin-middleware';
import { copyObjectBetweenBuckets } from '@/lib/cos';

export async function POST(request: NextRequest) {
  try {
    // 1. 验证管理员
    const admin = await requireAdmin();
    if (admin instanceof NextResponse) return admin;
    const { userId: adminId } = admin;

    // 2. 解析请求
    const body = await request.json();
    const { cardId, action, rejectReason } = body;

    if (!cardId || !action) {
      return NextResponse.json(
        { success: false, error: '缺少 cardId 或 action 参数' },
        { status: 400 }
      );
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'action 必须为 approve 或 reject' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient(undefined, true); // service_role

    // 3. 查询展示卡片
    const { data: card, error: cardError } = await client
      .from('canvas_config')
      .select('id, extra_data')
      .eq('id', cardId)
      .eq('config_type', 'showcase_card')
      .single();

    if (cardError || !card) {
      console.error('[showcase/review] 查询卡片失败:', cardError?.message);
      return NextResponse.json(
        { success: false, error: '展示卡片不存在' },
        { status: 404 }
      );
    }

    const extraData = card.extra_data || {};

    // 4. 校验状态：只有 pending 才能审核
    if (extraData.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: `当前状态为 ${extraData.status}，无法审核` },
        { status: 400 }
      );
    }

    // 5. 执行审核动作
    if (action === 'reject') {
      // === 拒绝 ===
      const updatedExtraData = {
        ...extraData,
        status: 'rejected',
        reviewer_id: adminId,
        reviewed_at: new Date().toISOString(),
        reject_reason: rejectReason || '管理员拒绝',
      };

      const { error: updateError } = await client
        .from('canvas_config')
        .update({ extra_data: updatedExtraData })
        .eq('id', cardId);

      if (updateError) {
        console.error('[showcase/review] 拒绝更新失败:', updateError.message);
        return NextResponse.json(
          { success: false, error: '审核拒绝失败' },
          { status: 500 }
        );
      }

      // 同步更新 generation_records 的 is_submitted 标记（可选：拒绝后允许重新提交）
      if (extraData.author_id && extraData.submitted_showcase_id) {
        // 不清除 is_submitted——防止重复提交同一张图到审核队列
        // 如果将来要允许重新提交，可以清除这个标记
      }

      console.log('[showcase/review] 拒绝成功:', { cardId, adminId });

      return NextResponse.json({
        success: true,
        action: 'rejected',
        message: '已拒绝该展示卡片',
      });
    }

    // === 通过 ===
    const sourceImageKey = extraData.source_image_key || extraData.imageUrl;

    if (!sourceImageKey) {
      return NextResponse.json(
        { success: false, error: '该卡片没有源图片 key，无法通过审核' },
        { status: 400 }
      );
    }

    // 6. COS 跨桶 Copy（Temp → Perm）
    let newPermKey = '';
    let finalPermKey = '';  // #833 包含 ENV_PREFIX 的完整 key（存入数据库，供前端 toProxyUrl 识别）
    try {
      // 构造 Perm 桶的 key：showcase/年月/原文件名
      const datePart = new Date().toISOString().slice(0, 7).replace('-', '/'); // 2026/07
      const originalFileName = sourceImageKey.split('/').pop() || 'unknown.png';
      newPermKey = `showcase/${datePart}/${originalFileName}`;

      console.log('[showcase/review] 开始跨桶 Copy:', {
        sourceKey: sourceImageKey,
        targetKey: newPermKey,
      });

      const copyResult = await copyObjectBetweenBuckets(sourceImageKey, newPermKey);

      if (!copyResult.success) {
        // Copy 失败但不是 404
        console.error('[showcase/review] Copy 失败:', copyResult.error);
        return NextResponse.json(
          { success: false, error: `文件复制失败: ${copyResult.error}` },
          { status: 500 }
        );
      }

      // #833 使用 copyResult.destKey（包含 ENV_PREFIX，如 dev/showcase/xxx.png）
      // 前端 toProxyUrl 只识别 dev/ 或 prod/ 开头的 key
      finalPermKey = copyResult.destKey || newPermKey;
      console.log('[showcase/review] Copy 成功, finalPermKey:', finalPermKey);
    } catch (copyError: unknown) {
      // 🚨 致命兜底：NoSuchKey / 404 → 源文件已物理过期
      const errMsg = copyError instanceof Error ? copyError.message : String(copyError);
      const isNoSuchKey =
        errMsg.includes('NoSuchKey') ||
        errMsg.includes('404') ||
        errMsg.includes('Not Found') ||
        errMsg.includes('does not exist');

      if (isNoSuchKey) {
        console.warn('[showcase/review] 源文件已物理过期:', sourceImageKey);

        // 自动改为 expired 状态
        const expiredExtraData = {
          ...extraData,
          status: 'expired',
          reviewer_id: adminId,
          reviewed_at: new Date().toISOString(),
          reject_reason: '源文件已物理过期销毁，无法通过审核',
        };

        await client
          .from('canvas_config')
          .update({ extra_data: expiredExtraData })
          .eq('id', cardId);

        return NextResponse.json({
          success: false,
          error: '源文件已物理过期销毁，无法通过审核',
          status: 'expired',
        });
      }

      // 其他未知错误
      console.error('[showcase/review] Copy 异常:', errMsg);
      return NextResponse.json(
        { success: false, error: `文件复制异常: ${errMsg}` },
        { status: 500 }
      );
    }

    // 7. Copy 成功，更新数据库
    const approvedExtraData = {
      ...extraData,
      status: 'approved',
      imageUrl: finalPermKey, // #833 更新为包含 ENV_PREFIX 的 Perm 桶 key（如 dev/showcase/xxx.png）
      source_image_key: sourceImageKey, // 保留原始 key 作为记录
      reviewer_id: adminId,
      reviewed_at: new Date().toISOString(),
    };

    const { error: approveError } = await client
      .from('canvas_config')
      .update({ extra_data: approvedExtraData })
      .eq('id', cardId);

    if (approveError) {
      console.error('[showcase/review] 审批更新失败:', approveError.message);
      return NextResponse.json(
        { success: false, error: '审核通过但数据库更新失败' },
        { status: 500 }
      );
    }

    console.log('[showcase/review] 审核通过:', { cardId, adminId, finalPermKey });

    return NextResponse.json({
      success: true,
      action: 'approved',
      newImageUrl: finalPermKey,
      message: '审核通过，文件已转移到永久存储',
    });
  } catch (error) {
    console.error('[showcase/review] 异常:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
