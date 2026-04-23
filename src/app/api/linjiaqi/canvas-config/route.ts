import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET() {
  try {
    const supabase = getSupabaseClient(undefined, true);
    const { data, error } = await supabase
      .from('canvas_config')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('获取画布配置失败:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('获取画布配置异常:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient(undefined, true);
    const body = await request.json();
    const { config_key, config_type, title, content, is_enabled, sort_order, extra_data } = body;

    // 检查是否已存在
    const { data: existing } = await supabase
      .from('canvas_config')
      .select('id')
      .eq('config_key', config_key)
      .single();

    if (existing) {
      // 更新
      const { data, error } = await supabase
        .from('canvas_config')
        .update({
          config_type,
          title,
          content,
          is_enabled,
          sort_order,
          extra_data,
          updated_at: new Date().toISOString()
        })
        .eq('config_key', config_key)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, data });
    } else {
      // 创建
      const { data, error } = await supabase
        .from('canvas_config')
        .insert({
          config_key,
          config_type,
          title,
          content,
          is_enabled,
          sort_order,
          extra_data
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, data });
    }
  } catch (error: any) {
    console.error('创建/更新画布配置异常:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = getSupabaseClient(undefined, true);
    const body = await request.json();
    const { id, config_key, config_type, title, content, is_enabled, sort_order, extra_data } = body;

    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (config_key !== undefined) updateData.config_key = config_key;
    if (config_type !== undefined) updateData.config_type = config_type;
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (is_enabled !== undefined) updateData.is_enabled = is_enabled;
    if (sort_order !== undefined) updateData.sort_order = sort_order;
    if (extra_data !== undefined) updateData.extra_data = extra_data;

    const { data, error } = await supabase
      .from('canvas_config')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('更新画布配置异常:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = getSupabaseClient(undefined, true);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: '缺少ID参数' }, { status: 400 });
    }

    const { error } = await supabase
      .from('canvas_config')
      .delete()
      .eq('id', parseInt(id));

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('删除画布配置异常:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
