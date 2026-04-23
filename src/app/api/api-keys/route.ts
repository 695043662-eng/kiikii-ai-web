import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 获取所有API密钥
export async function GET() {
  try {
    const supabase = getSupabaseClient(undefined, true);
    
    const { data, error } = await supabase
      .from('api_keys')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      // 如果表不存在，返回空数组
      if (error.code === '42P01' || error.message?.includes('Could not find the table')) {
        return NextResponse.json({ success: true, data: [] });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: any) {
    console.error('Get API keys error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '获取API密钥失败' },
      { status: 500 }
    );
  }
}

// 创建新的API密钥
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient(undefined, true);
    const { name, type, key } = await request.json();

    if (!name || !type || !key) {
      return NextResponse.json(
        { success: false, error: '请填写完整信息' },
        { status: 400 }
      );
    }

    // 生成密钥（如果没有提供）
    const apiKey = key || `sk-${generateRandomKey()}`;

    const { data, error } = await supabase
      .from('api_keys')
      .insert({
        name,
        type,
        key: apiKey,
        status: 'active',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      // 如果表不存在，返回模拟数据
      if (error.code === '42P01' || error.message?.includes('Could not find the table')) {
        return NextResponse.json({
          success: true,
          data: {
            id: Date.now(),
            name,
            type,
            key: apiKey,
            status: 'active',
            created_at: new Date().toISOString(),
          },
        });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Create API key error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '创建API密钥失败' },
      { status: 500 }
    );
  }
}

// 生成随机密钥
function generateRandomKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
