import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import crypto from 'crypto';

// 密码加密（与 login/route.ts 保持一致：SHA-256 + salt）
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + 'kiikii-salt-2024').digest('hex');
}

// POST /api/linjiaqi/set-password - 设置管理员密码
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    const body = await request.json();
    
    const { phone, password } = body;
    
    if (!phone || !password) {
      return NextResponse.json({ error: '请提供手机号和密码' }, { status: 400 });
    }

    // 使用与登录一致的 SHA-256 哈希
    const hashedPassword = hashPassword(password);
    
    // 更新密码
    const { data, error } = await client
      .from('users')
      .update({ password: hashedPassword })
      .eq('phone', phone)
      .select()
      .single();
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ 
      success: true, 
      message: `密码已更新`,
      user: data 
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
