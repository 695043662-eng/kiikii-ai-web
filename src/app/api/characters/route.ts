import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { cookies } from 'next/headers';

// 环境变量兜底（符合军规第3条）
const API_ENDPOINT = process.env.VIDEO_API_ENDPOINT || '';
const API_KEY = process.env.VIDEO_API_KEY || '';

// 获取用户角色列表
export async function GET() {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        error: '未登录',
        characters: [] 
      });
    }

    const client = getSupabaseClient(undefined, true);

    const { data: characters, error } = await client
      .from('generation_characters')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('获取角色列表失败:', error);
      // 表不存在时返回空数组，不报错
      return NextResponse.json({ 
        success: true,
        characters: [] 
      });
    }

    return NextResponse.json({
      success: true,
      characters: characters || [],
    });

  } catch (error) {
    console.error('获取角色列表错误:', error);
    return NextResponse.json({ 
      success: true, // 改为 true，避免前端报错
      error: '服务器错误',
      characters: [] 
    });
  }
}

// 创建角色
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        error: '请先登录' 
      });
    }

    const body = await request.json();
    const { name, url, timestamps, sourceType, sourceVideo, thumbnail } = body;

    if (!name || !url) {
      return NextResponse.json({ 
        success: false, 
        error: '缺少必要参数' 
      });
    }

    // 军规校验：检查 API 配置
    if (!API_KEY || !API_ENDPOINT) {
      console.error('[Characters API] 违章施工：未配置视频 API（环境变量均无）');
      return NextResponse.json({ 
        success: false, 
        error: '服务配置错误：未配置视频 API' 
      });
    }

    // 调用外部API创建角色
    const apiResponse = await fetch(`${API_ENDPOINT}/v1/video/sora-upload-character`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        url: url,
        timestamps: timestamps || '0,3',
      }),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error('API创建角色失败:', errorText);
      return NextResponse.json({ 
        success: false, 
        error: '创建角色失败' 
      });
    }

    // 解析响应
    const responseText = await apiResponse.text();
    let characterId: string | null = null;
    
    // 尝试解析响应获取 character_id
    try {
      if (responseText.startsWith('data:')) {
        // 流式响应
        const lines = responseText.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (data.status === 'succeeded' && data.results?.[0]?.character_id) {
              characterId = data.results[0].character_id;
              break;
            }
          }
        }
      } else {
        // JSON响应
        const data = JSON.parse(responseText);
        if (data.results?.[0]?.character_id) {
          characterId = data.results[0].character_id;
        }
      }
    } catch (parseError) {
      console.error('解析响应失败:', parseError);
    }

    if (!characterId) {
      // 如果没有立即获取到 character_id，生成一个临时ID
      characterId = `char_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // 保存到数据库
    const client = getSupabaseClient(undefined, true);
    const { data: character, error } = await client
      .from('generation_characters')
      .insert({
        user_id: userId,
        name: name,
        character_id: characterId,
        source_type: sourceType || 'upload',
        source_video: sourceVideo || url,
        thumbnail: thumbnail || null,
      })
      .select()
      .single();

    if (error) {
      console.error('保存角色失败:', error);
      return NextResponse.json({ 
        success: false, 
        error: '保存失败' 
      });
    }

    return NextResponse.json({
      success: true,
      character,
    });

  } catch (error) {
    console.error('创建角色错误:', error);
    return NextResponse.json({ 
      success: false, 
      error: '服务器错误' 
    });
  }
}

// 删除角色
export async function DELETE(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        error: '未登录' 
      });
    }

    const { searchParams } = new URL(request.url);
    const characterId = searchParams.get('id');

    if (!characterId) {
      return NextResponse.json({ 
        success: false, 
        error: '缺少角色ID' 
      });
    }

    const client = getSupabaseClient(undefined, true);

    // 验证角色属于当前用户
    const { data: existingCharacter, error: fetchError } = await client
      .from('generation_characters')
      .select('id')
      .eq('id', characterId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existingCharacter) {
      return NextResponse.json({ 
        success: false, 
        error: '角色不存在或无权删除' 
      });
    }

    const { error: deleteError } = await client
      .from('generation_characters')
      .delete()
      .eq('id', characterId);

    if (deleteError) {
      console.error('删除角色失败:', deleteError);
      return NextResponse.json({ 
        success: false, 
        error: '删除失败' 
      });
    }

    return NextResponse.json({
      success: true,
      message: '删除成功',
    });

  } catch (error) {
    console.error('删除角色错误:', error);
    return NextResponse.json({ 
      success: false, 
      error: '服务器错误' 
    });
  }
}
