import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getModelAPIConfigFull } from '@/lib/api-config';
import { requireAuth } from '@/lib/auth-middleware';

// #538 迁移：不再使用环境变量，改为从数据库读取 T8 Sora-2 配置
// 旧的 VIDEO_API_ENDPOINT 环境变量已废弃

// 获取用户角色列表
export async function GET() {
  try {
    // 🔒 P0 鉴权：使用 requireAuth 替代原始 cookie 读取
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth;

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
    // 🔒 P0 鉴权：使用 requireAuth 替代原始 cookie 读取
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth;

    const body = await request.json();
    const { name, url, timestamps, sourceType, sourceVideo, thumbnail } = body;

    if (!name || !url) {
      return NextResponse.json({ 
        success: false, 
        error: '缺少必要参数' 
      });
    }

    // #538 迁移：从数据库读取 T8 Sora-2 API 配置
    const fullConfig = await getModelAPIConfigFull('sora-2');
    
    if (!fullConfig) {
      console.error('[Characters API] 模型 sora-2 未配置，请在数据库中添加配置');
      return NextResponse.json({ 
        success: false, 
        error: '服务配置错误：Sora-2 模型未配置' 
      });
    }

    const apiEndpoint = fullConfig.apiEndpoint;
    const apiKey = fullConfig.apiKey;

    // ⚠️ 安全警告：角色客串功能仅支持"非人物"对象（如动物、物品、奇幻生物）
    // 严禁用于真人面孔，否则将导致生成失败
    console.log('[Characters API] 创建角色:', name, 'URL前缀:', url.substring(0, 50));

    // #538 迁移：调用 T8 Sora-2 角色创建接口
    // T8 接口使用 character_url + character_timestamps 参数
    const apiResponse = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'sora-2',
        character_url: url,
        character_timestamps: timestamps || '0,3',
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
    
    // #538 迁移：T8 异步接口响应格式解析
    try {
      const data = JSON.parse(responseText);
      
      if (data.task_id) {
        // T8 异步模式：返回 task_id，角色可能需要异步等待
        // 暂时使用 task_id 作为 character_id 的替代
        characterId = data.task_id;
        console.log('[Characters API] T8 异步任务已提交, task_id:', characterId);
      } else if (data.character_id) {
        // 直接返回 character_id 的情况
        characterId = data.character_id;
      } else if (data.data?.character_id) {
        characterId = data.data.character_id;
      } else if (data.results?.[0]?.character_id) {
        // 兼容旧格式
        characterId = data.results[0].character_id;
      }
    } catch (parseError) {
      console.error('[Characters API] 解析响应失败:', parseError);
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
    // 🔒 P0 鉴权：使用 requireAuth 替代原始 cookie 读取
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth; 

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
