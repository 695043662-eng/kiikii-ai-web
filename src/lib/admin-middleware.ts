/**
 * 管理员认证中间件
 * 
 * 验证用户是否为管理员（通过手机号匹配）
 * 用于保护管理后台 API 路由
 */

import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth } from './auth-middleware';

// 管理员手机号（从环境变量读取，默认值）
const ADMIN_PHONE = process.env.ADMIN_PHONE;

/**
 * 验证管理员身份
 * 
 * @returns 成功返回 { userId }，失败返回 NextResponse 错误响应
 * 
 * @example
 * export async function GET(request: NextRequest) {
 *   const auth = await requireAdmin();
 *   if (auth instanceof NextResponse) return auth;
 *   const { userId } = auth;
 *   // ... 管理员逻辑
 * }
 */
export async function requireAdmin(): Promise<{ userId: string; adminPhone: string } | NextResponse> {
  // 🔓 开发环境白名单兜底逻辑（上帝模式）
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    // 检查是否是沙箱测试用户
    const cookieUserId = require('next/headers').cookies().get('user_id')?.value;
    if (cookieUserId === '5bb66162-29de-4839-8726-54d217663506') {
      console.log('[requireAdmin] 🔓 开发环境白名单生效，放行沙箱测试管理员');
      return { userId: '5bb66162-29de-4839-8726-54d217663506', adminPhone: 'dev-sandbox-admin' };
    }
  }

  // 1. 验证用户登录状态
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  // 2. 验证管理员身份
  try {
    const client = getSupabaseClient(undefined, true);
    const { data: user, error } = await client
      .from('users')
      .select('phone')
      .eq('id', userId)
      .single();

    if (error || !user) {
      console.log('[requireAdmin] 用户不存在:', userId);
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      );
    }

    if (user.phone !== ADMIN_PHONE) {
      console.log('[requireAdmin] 非管理员访问:', userId, 'phone:', user.phone);
      return NextResponse.json(
        { error: '无权限' },
        { status: 403 }
      );
    }

    return { userId, adminPhone: ADMIN_PHONE! };
  } catch (error) {
    console.error('[requireAdmin] 验证异常:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}

// 导出 ADMIN_PHONE 供需要直接引用的路由使用
export { ADMIN_PHONE };
