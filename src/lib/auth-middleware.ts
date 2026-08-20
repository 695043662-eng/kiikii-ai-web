/**
 * 后端鉴权中间件（JWT 安全版）
 * 
 * 安全措施：
 * 1. JWT 签名验证：Cookie 中存储签名 JWT，防止伪造 user_id
 * 2. 签名密钥：AUTH_JWT_SECRET 环境变量（必须配置）
 * 3. 向下兼容：未配置密钥时，开发环境仍读取 user_id Cookie 但记录警告
 * 
 * ## 使用方式
 * 
 * ### 简单认证（只验证登录）
 * ```typescript
 * const auth = await requireAuth();
 * if (auth instanceof NextResponse) return auth;
 * const { userId } = auth;
 * ```
 * 
 * ### 完整认证（自动开户）
 * ```typescript
 * const auth = await validateUser(request);
 * if (!auth.success) {
 *   return NextResponse.json({ error: auth.error }, { status: auth.statusCode });
 * }
 * const userId = auth.userId;
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { jwtVerify, SignJWT } from 'jose';

// JWT 配置
const JWT_ALG = 'HS256';
const JWT_ISSUER = 'kiikii-auth';
const JWT_AUDIENCE = 'kiikii-api';
const JWT_EXPIRY = '7d'; // 7 天过期

function getJwtSecret(): Uint8Array | null {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

/**
 * 签发 JWT Token
 * @param userId 用户 ID
 * @param extraPayload 额外数据（如 phone）
 * @returns 签名后的 JWT 字符串
 */
export async function signAuthToken(userId: string, extraPayload?: Record<string, string>): Promise<string> {
  const secret = getJwtSecret();
  if (!secret) {
    // 开发环境回退：返回明文 user_id（无签名）
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Auth] ⚠️ AUTH_JWT_SECRET 未配置，JWT 签名已禁用（仅限开发环境）');
      return userId; // 无签名，直接返回 userId
    }
    throw new Error('[安全] AUTH_JWT_SECRET 环境变量未配置，无法签发 JWT');
  }

  let builder = new SignJWT({ userId, ...extraPayload })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY);

  return builder.sign(secret);
}

/**
 * 验证 JWT Token
 * @param token JWT 字符串
 * @returns 解码后的 payload，包含 userId
 */
export async function verifyAuthToken(token: string): Promise<{ userId: string; [key: string]: any } | null> {
  const secret = getJwtSecret();
  if (!secret) {
    // 开发环境回退：直接当作 userId 使用
    if (process.env.NODE_ENV !== 'production') {
      return { userId: token };
    }
    console.error('[Auth] AUTH_JWT_SECRET 未配置，生产环境拒绝无签名 Token');
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as { userId: string; [key: string]: any };
  } catch (error) {
    console.warn('[Auth] JWT 验证失败:', error instanceof Error ? error.message : '未知错误');
    return null;
  }
}

// 新用户初始积分
const DEFAULT_CREDITS = 0;

/**
 * 简单认证中间件（JWT 验证版）
 * 
 * 用于普通 API 路由，验证 Cookie 中的 JWT 签名
 * 
 * @returns 成功返回 { userId }，失败返回 NextResponse 错误响应
 */
export async function requireAuth(): Promise<{ userId: string } | NextResponse> {
  try {
    // 开发环境白名单兜底逻辑（与 /api/user/info 一致）
    const isProduction = process.env.NODE_ENV === 'production';
    const DEV_SANDBOX_USER_ID = '5bb66162-29de-4839-8726-54d217663506'; // 真实管理员 ID
    
    const cookieStore = await cookies();
    const authToken = cookieStore.get('auth_token')?.value;
    const legacyUserId = cookieStore.get('user_id')?.value;
    
    // 开发环境且无 Cookie 时，返回测试用户 ID
    if (!isProduction && !authToken && !legacyUserId) {
      console.log('[requireAuth] 🔓 开发环境白名单生效，返回测试用户 ID');
      return { userId: DEV_SANDBOX_USER_ID };
    }

    // 优先验证 JWT Token
    if (authToken) {
      const payload = await verifyAuthToken(authToken);
      if (payload?.userId) {
        return { userId: payload.userId };
      }
      // JWT 验证失败（可能被篡改或过期）
      console.warn('[requireAuth] JWT 验证失败，Token 可能已被篡改');
      return NextResponse.json(
        { success: false, error: '登录已过期，请重新登录' },
        { status: 401 }
      );
    }

    // 兼容旧 Cookie（user_id）— 仅开发环境允许
    if (legacyUserId && process.env.NODE_ENV !== 'production') {
      console.warn('[requireAuth] ⚠️ 使用旧版 user_id Cookie（无签名验证），请尽快迁移');
      return { userId: legacyUserId };
    }

    // 生产环境必须使用 JWT
    if (legacyUserId && process.env.NODE_ENV === 'production') {
      console.warn('[requireAuth] 生产环境检测到旧版 Cookie，拒绝无签名认证');
    }

    return NextResponse.json(
      { success: false, error: '未登录' },
      { status: 401 }
    );
  } catch (error) {
    console.error('[requireAuth] 异常:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

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
 * 验证用户身份（无感开户 + JWT 验证）
 * 
 * @param request - Next.js 请求对象（可选，用于获取 header）
 * @returns AuthResult - 鉴权结果
 */
export async function validateUser(request?: NextRequest): Promise<AuthResult> {
  try {
    // 1. 从 Cookie 获取认证信息
    const cookieStore = await cookies();
    const authToken = cookieStore.get('auth_token')?.value;
    const legacyUserId = cookieStore.get('user_id')?.value;
    
    let userId: string | undefined;

    // 2. 优先验证 JWT
    if (authToken) {
      const payload = await verifyAuthToken(authToken);
      if (payload?.userId) {
        userId = payload.userId;
      }
    }

    // 3. 兼容旧 Cookie（仅开发环境）
    if (!userId && legacyUserId && process.env.NODE_ENV !== 'production') {
      userId = legacyUserId;
      console.warn('[Auth] ⚠️ 使用旧版 user_id Cookie');
    }

    // 4. 尝试从请求头获取
    if (!userId && request) {
      const headerUserId = request.headers.get('x-user-id') || request.headers.get('user-id');
      if (headerUserId && process.env.NODE_ENV !== 'production') {
        userId = headerUserId;
        console.warn('[Auth] ⚠️ 从 Header 获取 user_id（无签名验证）');
      }
    }
    
    // 5. 如果还是没有，返回未登录
    if (!userId) {
      console.warn('[Auth] 未登录：无法获取有效的用户身份');
      return {
        success: false,
        error: '未登录，请先登录',
        statusCode: 401,
      };
    }
    
    // 6. 查询用户
    const client = getSupabaseClient(undefined, true);
    const { data: user, error } = await client
      .from('users')
      .select('id, credits')
      .eq('id', userId)
      .single();
    
    // 7. 用户不存在时，自动创建（无感开户）
    if (error || !user) {
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
        return {
          success: true,
          userId,
          credits: 0,
          isNewUser: true,
        };
      }
      
      return {
        success: true,
        userId,
        credits: newUser.credits || 0,
        isNewUser: true,
      };
    }
    
    // 8. 用户存在，返回成功
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
