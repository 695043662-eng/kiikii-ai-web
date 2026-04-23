import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 管理员手机号
const ADMIN_PHONE = '13824085362';

// 供应商接口配置
const SUPPLIER_API_URL = process.env.SUPPLIER_API_URL || 'https://api.mmw.ink';
const SUPPLIER_API_TOKEN = process.env.SUPPLIER_API_TOKEN || 'e27a9d830e4e46cc9a2957ea2c84e1fc';

// 供应商积分缓存（避免超时时显示0）
let supplierCreditsCache: { value: number; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 缓存5分钟

// 从供应商获取管理员原始积分（带超时保护 + 缓存兜底）
async function getSupplierCredits(): Promise<number | null> {
  if (!SUPPLIER_API_TOKEN) {
    return supplierCreditsCache?.value ?? null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒超时

    const response = await fetch(`${SUPPLIER_API_URL}/client/openapi/getCredits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: SUPPLIER_API_TOKEN }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[admin/credits] 供应商API返回非200: ${response.status}`);
      return supplierCreditsCache?.value ?? null;
    }

    const result = await response.json();
    if (result.code === 0 && result.data?.credits !== undefined) {
      // 更新缓存
      supplierCreditsCache = { value: result.data.credits, timestamp: Date.now() };
      return result.data.credits;
    }
    console.warn(`[admin/credits] 供应商API返回异常:`, JSON.stringify(result));
    return supplierCreditsCache?.value ?? null;
  } catch (err) {
    console.warn(`[admin/credits] 供应商API超时或失败:`, err instanceof Error ? err.message : err);
    // 超时/网络错误时，返回缓存值（即使过期）
    return supplierCreditsCache?.value ?? null;
  }
}

// GET /api/linjiaqi/credits - 获取管理员积分信息
export async function GET(request: NextRequest) {
  // 禁用缓存，强制每次查询数据库
  const headers = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  };
  
  try {
    const client = getSupabaseClient(undefined, true);
    
    // 从数据库获取管理员信息
    const { data: adminUser, error } = await client
      .from('users')
      .select('*')
      .eq('phone', ADMIN_PHONE)
      .single();

    console.log('[admin/credits] 查询结果:', { 
      adminUser: adminUser ? { id: adminUser.id, phone: adminUser.phone, credits: adminUser.credits } : null, 
      error 
    });

    if (error || !adminUser) {
      return NextResponse.json(
        { error: 'Admin not found' },
        { status: 404, headers }
      );
    }

    // 从供应商获取原始积分（超时时返回缓存值）
    const supplierCredits = await getSupplierCredits();
    
    // 供应总配额 = 供应商积分÷100（保留显示）
    const totalQuota = supplierCredits !== null ? Math.floor(supplierCredits / 100) : 0;
    
    // 获取所有用户的积分总和
    const { data: allUsers } = await client
      .from('users')
      .select('credits');
    
    const usedCredits = allUsers?.reduce((sum, user) => sum + (user.credits || 0), 0) || 0;
    
    // #111 剩余配额独立存储，不再与供应商关联
    const { data: quotaConfig } = await client
      .from('canvas_config')
      .select('value')
      .eq('key', 'remaining_quota')
      .single();
    
    const remainingQuota = quotaConfig?.value ? parseInt(quotaConfig.value, 10) : 0;

    return NextResponse.json({
      data: {
        id: adminUser.id,
        phone: adminUser.phone,
        nickname: '负责人',
        totalQuota,              // 供应总配额（供应商积分÷100，仅显示）
        remainingQuota,          // 剩余配额（独立可编辑，初始值0）
        usedCredits,             // 已分配积分（所有用户积分总和）
        credits: adminUser.credits || 0,  // 负责人普通积分
        supplierCredits: supplierCredits || 0, // 供应商原始积分（显示用）
        isAdmin: true,
        is_active: adminUser.is_active,
        created_at: adminUser.created_at,
      }
    }, { headers });
  } catch (error) {
    console.error('Error fetching admin credits:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin credits' },
      { status: 500, headers }
    );
  }
}

// PUT /api/linjiaqi/credits - 更新剩余配额
export async function PUT(request: NextRequest) {
  const headers = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  };
  
  try {
    const body = await request.json();
    const { remainingQuota } = body;
    
    if (typeof remainingQuota !== 'number') {
      return NextResponse.json({ error: 'remainingQuota must be a number' }, { status: 400, headers });
    }
    
    const client = getSupabaseClient(undefined, true);
    
    // 更新或插入 canvas_config 表
    const { error } = await client
      .from('canvas_config')
      .upsert({ key: 'remaining_quota', value: String(remainingQuota) }, { onConflict: 'key' });
    
    if (error) {
      console.error('[admin/credits] 更新剩余配额失败:', error);
      return NextResponse.json({ error: 'Failed to update remaining quota' }, { status: 500, headers });
    }
    
    return NextResponse.json({ success: true, remainingQuota }, { headers });
  } catch (error) {
    console.error('Error updating remaining quota:', error);
    return NextResponse.json({ error: 'Failed to update remaining quota' }, { status: 500, headers });
  }
}
