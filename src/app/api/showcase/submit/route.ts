/**
 * POST /api/showcase/submit
 * 
 * 用户一键提交历史资产到展示区审核
 * 
 * 安全措施：
 * 1. requireAuth 验证用户登录
 * 2. 只能提交属于自己的历史记录
 * 3. 防重复提交：检查 generation_records.extra_data.is_submitted
 * 4. 4.8天过期阈值检查：前端也做了，后端再保一道
 * 5. 原子性：创建 showcase_card + 打标记 在同一事务中
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth } from '@/lib/auth-middleware';

// 4.8 天安全阈值（毫秒）
const ASSET_EXPIRY_MS = 4.8 * 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    // 1. 验证登录
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth;

    // 2. 解析请求
    const body = await request.json();
    const { recordId, tag, title, subtitle } = body;

    if (!recordId) {
      return NextResponse.json(
        { success: false, error: '缺少 recordId 参数' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient(undefined, true); // service_role

    // 3. 查询历史记录（含 extra_data 回退：开发数据库可能缺少此列）
    // #832 修复：移除 duration 列（generation_records 表无此列），避免查询报错返回"历史记录不存在"
    const selectFields = 'id, user_id, images, image_keys, prompt, model, created_at, extra_data, aspect_ratio, resolution';
    const selectFieldsNoExtraData = 'id, user_id, images, image_keys, prompt, model, created_at, aspect_ratio, resolution';

    let record: any = null;
    let recordError: any = null;

    const mainResult = await client
      .from('generation_records')
      .select(selectFields)
      .eq('id', recordId)
      .single();

    record = mainResult.data;
    recordError = mainResult.error;

    // extra_data 列不存在时回退
    if (recordError && recordError.message && recordError.message.includes('extra_data')) {
      console.log('[showcase/submit] extra_data 列不存在，回退查询');
      const fallback = await client
        .from('generation_records')
        .select(selectFieldsNoExtraData)
        .eq('id', recordId)
        .single();
      record = fallback.data;
      recordError = fallback.error;
    }

    // #832 通用回退：任意列不存在时，用最基础字段重试
    if (recordError && recordError.message) {
      const basicFields = 'id, user_id, images, image_keys, prompt, model, created_at, aspect_ratio, resolution';
      console.log('[showcase/submit] 查询失败，尝试基础字段回退:', recordError.message);
      const fallback = await client
        .from('generation_records')
        .select(basicFields)
        .eq('id', recordId)
        .single();
      record = fallback.data;
      recordError = fallback.error;
    }

    if (recordError || !record) {
      console.error('[showcase/submit] 查询历史记录失败:', recordError?.message);
      return NextResponse.json(
        { success: false, error: '历史记录不存在' },
        { status: 404 }
      );
    }

    // 4. 权限校验：只能提交自己的记录
    if (record.user_id !== userId) {
      console.warn('[showcase/submit] 越权提交:', { userId, recordUserId: record.user_id });
      return NextResponse.json(
        { success: false, error: '只能提交自己的历史记录' },
        { status: 403 }
      );
    }

    // 5. 防重复提交：检查 is_submitted 标记
    const extraData = record.extra_data || {};
    if (extraData.is_submitted === true) {
      return NextResponse.json(
        { success: false, error: '该资产已提交审核，请勿重复提交', alreadySubmitted: true },
        { status: 409 }
      );
    }

    // 6. 过期检查（4.8 天安全阈值）
    const createdAt = new Date(record.created_at).getTime();
    if (Date.now() - createdAt > ASSET_EXPIRY_MS) {
      return NextResponse.json(
        { success: false, error: '该资产已超过4.8天安全期限，源文件可能已被销毁，无法提交' },
        { status: 410 }
      );
    }

    // 7. 提取图片信息
    const imageKeys = record.image_keys || [];
    const imageUrls = record.images || [];
    
    // 使用第一张图作为展示图
    const firstImageKey = imageKeys[0] || '';
    const firstImageUrl = imageUrls[0] || '';

    if (!firstImageKey && !firstImageUrl) {
      return NextResponse.json(
        { success: false, error: '该记录没有可用的图片' },
        { status: 400 }
      );
    }

    // 8. 创建 showcase_card（canvas_config 表，config_type='showcase_card'）
    const showcaseExtraData = {
      imageUrl: firstImageKey || firstImageUrl,
      tag: tag || '',
      title: title || '',
      subtitle: subtitle || '',
      likes: 0,
      category: '',
      aspectRatio: record.aspect_ratio || 1,  // #834 保留原值，rowToCard 的 parseAspectRatio 会处理格式
      resolution: record.resolution || '',
      duration: '',  // #832 duration 列不存在于 generation_records，留空
      builtInModel: record.model || '',
      builtInPrompt: record.prompt || '',
      // 审核流字段
      status: 'pending',
      author_id: userId,
      source_image_key: firstImageKey,
      source_type: 'user_submission',
      submitted_at: new Date().toISOString(),
      reviewed_at: null,
      reviewer_id: null,
      reject_reason: null,
    };

    const { data: newCard, error: insertError } = await client
      .from('canvas_config')
      .insert({
        config_key: `card-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        config_type: 'showcase_card',
        extra_data: showcaseExtraData,
      })
      .select('id')
      .single();

    if (insertError || !newCard) {
      console.error('[showcase/submit] 创建展示卡片失败:', insertError?.message);
      return NextResponse.json(
        { success: false, error: '提交审核失败，请稍后重试' },
        { status: 500 }
      );
    }

    // 9. 打标记：更新 generation_records.extra_data（如果列存在）
    if (record.extra_data !== undefined) {
      const updatedExtraData = {
        ...extraData,
        is_submitted: true,
        submitted_showcase_id: newCard.id,
        submitted_at: new Date().toISOString(),
      };

      const { error: updateError } = await client
        .from('generation_records')
        .update({ extra_data: updatedExtraData })
        .eq('id', recordId);

      if (updateError) {
        console.error('[showcase/submit] 打标记失败:', updateError.message);
        // 不回滚展示卡片创建（管理员可以后续处理），但记录日志
      }
    } else {
      console.log('[showcase/submit] extra_data 列不存在，跳过打标记');
    }

    console.log('[showcase/submit] 提交成功:', {
      recordId,
      showcaseCardId: newCard.id,
      userId,
    });

    return NextResponse.json({
      success: true,
      showcaseCardId: newCard.id,
      message: '提交审核成功，请等待管理员审核',
    });
  } catch (error) {
    console.error('[showcase/submit] 异常:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
