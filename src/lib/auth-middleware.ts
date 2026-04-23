/**
 * 后端鉴权中间件
 * 
 * 在核心业务逻辑之前验证用户身份
 * 
 * 🔥 核心逻辑：用户不存在时自动创建（无感开户），绝不报错！
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 新用户初始积分
const DEFAULT_CREDITS = 0;

// 鉴权结果
export interface AuthResult {
  success: boolean;
  userId?: string;
  credits?: number;
  isNewUser?: boolean;
  error?: string;
  statusCode?: number;
}

/**
 * 验证用户身份（无感开户）
 * 
 * @param request - Next.js 请求对象（可选，用于获取 header）
 * @returns AuthResult - 鉴权结果
 * 
 * @example
 * const auth = await validateUser(request);
 * if (!auth.success) {
 *   return NextResponse.json({ error: auth.error }, { status: auth.statusCode });
 * }
 * const userId = auth.userId;
 */
export async function validateUser(request?: NextRequest): Promise<AuthResult> {
  try {
    // 1. 从 Cookie 获取用户 ID
    const cookieStore = await cookies();
    let userId = cookieStore.get('user_id')?.value;
    
    // 2. 如果 Cookie 没有，尝试从请求头获取
    if (!userId && request) {
      userId = request.headers.get('x-user-id') || 
               request.headers.get('user-id') ||
               undefined;
    }
    
    // 3. 如果还是没有，返回未登录（这是唯一真正的错误情况）
    if (!userId) {
      console.warn('[Auth] 未登录：Cookie 和 Header 中都没有 user_id');
      return {
        success: false,
        error: '未登录，请先登录',
        statusCode: 401,
      };
    }
    
    console.log(`[Auth] Cookie 中的 userId: ${userId}`);
    
    // 4. 查询用户
    const client = getSupabaseClient(undefined, true);
    const { data: user, error } = await client
      .from('users')
      .select('id, credits')
      .eq('id', userId)
      .single();
    
    // 5. 🔥 用户不存在时，自动创建（无感开户）
    if (error || !user) {
      console.log(`[Auth] 用户不存在，自动开户: ${userId}`);
      
      const { data: newUser, error: insertError } = await client
        .from('users')
        .upsert({
          id: userId,
          credits: DEFAULT_CREDITS,
          created_at: new Date().toISOString(),
        }, {
          onConflict: 'id',
        })
        .select('id, credits')
        .single();
      
      if (insertError || !newUser) {
        console.error(`[Auth] 自动开户失败:`, insertError);
        // 开户失败，但仍然通过鉴权（让后续逻辑处理）
        return {
          success: true,
          userId,
          credits: 0,
          isNewUser: true,
        };
      }
      
      console.log(`[Auth] 自动开户成功: ${userId}, 积分: ${newUser.credits}`);
      return {
        success: true,
        userId,
        credits: newUser.credits || 0,
        isNewUser: true,
      };
    }
    
    // 6. 用户存在，返回成功
    console.log(`[Auth] 鉴权成功：userId=${userId}, credits=${user.credits}`);
    
    return {
      success: true,
      userId,
      credits: user.credits || 0,
    };
    
  } catch (error: any) {
    console.error('[Auth] 鉴权异常:', error);
    return {
      success: false,
      error: '鉴权失败，请稍后重试',
      statusCode: 500,
    };
  }
}

/**
 * 鉴权中间件包装器
 * 
 * 用于包装 API 路由，自动验证用户身份
 * 
 * @example
 * export const POST = withAuth(async (request, { userId }) => {
 *   // 业务逻辑
 *   return NextResponse.json({ success: true });
 * });
 */
export function withAuth(
  handler: (request: NextRequest, context: { userId: string }) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    const auth = await validateUser(request);
    
    if (!auth.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: auth.error,
          code: 'AUTH_FAILED',
        },
        { status: auth.statusCode || 401 }
      );
    }
    
    return handler(request, { userId: auth.userId! });
  };
}
