import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAdmin } from '@/lib/admin-middleware';

// 🔥 强制动态渲染 + 禁用数据缓存
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CONFIG_KEY = 'showcase_adjust_mode';

/**
 * 展示区调节模式 API
 * 
 * GET: 获取调节模式状态（公开）
 * POST: 设置调节模式状态（管理员）
 * 
 * 遵循 app_config 表模式（与 payment_maintenance 一致）
 */

// 获取调节模式状态
export async function GET() {
  try {
    // 第一道防线：环境变量硬门控
    // 生产环境不设置 NEXT_PUBLIC_ENABLE_ADJUST_MODE，此接口永远返回 false
    if (process.env.NEXT_PUBLIC_ENABLE_ADJUST_MODE !== 'true') {
      return NextResponse.json({ success: true, enabled: false, envGate: false });
    }

    const supabase = getSupabaseClient(undefined, true);
    const { data, error } = await supabase
      .from('app_config')
      .select('config_value')
      .eq('config_key', CONFIG_KEY)
      .single();

    if (error || !data) {
      // 没有记录时默认关闭
      return NextResponse.json({ success: true, enabled: false, envGate: true });
    }

    const enabled = data.config_value === 'true' || data.config_value === true;
    return NextResponse.json({ success: true, enabled, envGate: true });
  } catch (error) {
    console.error('[调节模式] 查询异常:', error);
    return NextResponse.json({ success: true, enabled: false, envGate: true });
  }
}

// 设置调节模式状态（管理员）
export async function POST(request: NextRequest) {
  try {
    // 第一道防线：环境变量硬门控
    if (process.env.NEXT_PUBLIC_ENABLE_ADJUST_MODE !== 'true') {
      return NextResponse.json({ success: false, error: '生产环境不支持调节模式' }, { status: 403 });
    }

    // 验证管理员权限
    const adminCheck = await requireAdmin();
    if (adminCheck instanceof NextResponse) return adminCheck;

    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ success: false, error: '参数错误' }, { status: 400 });
    }

    const supabase = getSupabaseClient(undefined, true);
    const { error } = await supabase
      .from('app_config')
      .upsert({
        config_key: CONFIG_KEY,
        config_value: enabled ? 'true' : 'false',
        description: '展示区调节模式开关：true=开启，false=关闭（仅开发环境有效）',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'config_key',
      });

    if (error) {
      console.error('[调节模式] 更新失败:', error);
      return NextResponse.json({ success: false, error: '更新失败' }, { status: 500 });
    }

    console.log(`[调节模式] 状态已更新: ${enabled ? '开启' : '关闭'}`);
    return NextResponse.json({ success: true, enabled });
  } catch (error) {
    console.error('[调节模式] 更新异常:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
