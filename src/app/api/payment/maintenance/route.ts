import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 兼容开发环境和生产环境的环境变量命名
const getSupabaseUrl = () => 
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

// 获取支付维护状态
export async function GET() {
  try {
    const supabaseUrl = getSupabaseUrl();
    if (!supabaseUrl) {
      console.error('[支付维护] 缺少 SUPABASE_URL 环境变量');
      return NextResponse.json({ 
        success: true, 
        maintenance: false 
      });
    }

    // 🔥 #849 修复：使用连接池单例，防止连接池雪崩
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('app_config')
      .select('config_value')
      .eq('config_key', 'payment_maintenance')
      .single();

    if (error) {
      console.error('[支付维护] 查询失败:', error);
      // 如果没有记录，返回 false（正常状态）
      return NextResponse.json({ 
        success: true, 
        maintenance: false 
      });
    }

    return NextResponse.json({ 
      success: true, 
      maintenance: data?.config_value === 'true' || data?.config_value === true
    });
  } catch (error) {
    console.error('[支付维护] 查询异常:', error);
    return NextResponse.json({ 
      success: false, 
      error: '服务器错误' 
    }, { status: 500 });
  }
}

// 设置支付维护状态（管理员）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { maintenance } = body;

    if (typeof maintenance !== 'boolean') {
      return NextResponse.json({ 
        success: false, 
        error: '参数错误' 
      }, { status: 400 });
    }

    // 🔥 #849 修复：使用连接池单例，防止连接池雪崩
    const supabase = getSupabaseClient();

    // 验证管理员权限
    const authHeader = request.headers.get('cookie') || '';
    const isAdmin = authHeader.includes('admin_logged_in=true');
    
    if (!isAdmin) {
      // 通过数据库验证管理员
      const adminToken = request.headers.get('x-admin-token');
      if (!adminToken) {
        return NextResponse.json({ 
          success: false, 
          error: '无权限' 
        }, { status: 403 });
      }
    }

    const { error } = await supabase
      .from('app_config')
      .upsert({
        config_key: 'payment_maintenance',
        config_value: maintenance ? '"true"' : '"false"',
        description: '支付通道维护开关：true=维护中，false=正常',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'config_key',
      });

    if (error) {
      console.error('[支付维护] 更新失败:', error);
      return NextResponse.json({ 
        success: false, 
        error: '更新失败' 
      }, { status: 500 });
    }

    console.log(`[支付维护] 状态已更新: ${maintenance ? '维护中' : '正常'}`);
    
    return NextResponse.json({ 
      success: true, 
      maintenance 
    });
  } catch (error) {
    console.error('[支付维护] 更新异常:', error);
    return NextResponse.json({ 
      success: false, 
      error: '服务器错误' 
    }, { status: 500 });
  }
}
