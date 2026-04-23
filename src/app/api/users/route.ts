import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import crypto from 'crypto';

// 管理员手机号
const ADMIN_PHONE = '13824085362';

// 供应商接口配置
const SUPPLIER_API_URL = process.env.SUPPLIER_API_URL || 'https://api.mmw.ink';
const SUPPLIER_API_TOKEN = process.env.SUPPLIER_API_TOKEN || 'e27a9d830e4e46cc9a2957ea2c84e1fc';

// 从供应商获取管理员积分
async function getAdminCreditsFromSupplier(): Promise<{ supplierCredits: number; localCredits: number } | null> {
  if (!SUPPLIER_API_TOKEN) {
    return null;
  }

  try {
    const response = await fetch(`${SUPPLIER_API_URL}/client/openapi/getCredits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: SUPPLIER_API_TOKEN }),
    });

    if (!response.ok) {
      return null;
    }

    const result = await response.json();
    if (result.code === 0 && result.data?.credits !== undefined) {
      const supplierCredits = result.data.credits;
      // 本地积分 = 供应商积分 / 100，取整数
      const localCredits = Math.floor(supplierCredits / 100);
      return { supplierCredits, localCredits };
    }
    return null;
  } catch {
    return null;
  }
}

// GET /api/users - 获取用户列表
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    const searchParams = request.nextUrl.searchParams;
    const phone = searchParams.get('phone');
    const nickname = searchParams.get('nickname');
    const email = searchParams.get('email');
    
    let query = client
      .from('users')
      .select('id, phone, email, nickname, avatar, credits, created_at, is_active')
      .order('created_at', { ascending: false });
    
    if (phone) {
      query = query.ilike('phone', `%${phone}%`);
    }
    
    if (nickname) {
      query = query.ilike('nickname', `%${nickname}%`);
    }

    if (email) {
      query = query.ilike('email', `%${email}%`);
    }
    
    const { data, error } = await query;
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 如果列表中有管理员，从供应商获取真实积分
    const hasAdmin = data?.some(user => user.phone === ADMIN_PHONE);
    
    if (hasAdmin) {
      const supplierCredits = await getAdminCreditsFromSupplier();
      
      // 更新管理员的积分显示
      const usersWithAdminCredits = data?.map(user => {
        if (user.phone === ADMIN_PHONE && supplierCredits !== null) {
          return {
            ...user,
            nickname: '负责人',  // 固定显示为"负责人"
            supplyQuota: Math.floor(supplierCredits.supplierCredits / 100), // 供应配额
            credits: user.credits || 0,  // 普通积分（数据库中的值）
            supplierCredits: supplierCredits.supplierCredits, // 供应商原始积分（显示用）
            isAdmin: true,
          };
        }
        return user;
      });
      
      return NextResponse.json({ data: usersWithAdminCredits });
    }
    
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}

// POST /api/users - 创建用户
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    const body = await request.json();
    
    const { nickname, phone, credits = 0, password } = body;
    
    if (!phone) {
      return NextResponse.json(
        { error: 'Phone is required' },
        { status: 400 }
      );
    }
    
    // 密码加密（与 login/route.ts 保持一致：SHA-256 + salt）
    const hashedPassword = password 
      ? crypto.createHash('sha256').update(password + 'kiikii-salt-2024').digest('hex') 
      : '';

    const { data, error } = await client
      .from('users')
      .insert({ 
        nickname: nickname || `用户${phone.slice(-4)}`, 
        phone, 
        credits,
        password: hashedPassword
      })
      .select()
      .single();
    
    if (error) {
      if (error.code === '23505') { // 唯一约束冲突
        return NextResponse.json(
          { error: 'Phone number already exists' },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    );
  }
}
