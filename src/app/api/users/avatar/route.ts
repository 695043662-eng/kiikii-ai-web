import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { uploadToCOS } from '@/lib/cos';

/**
 * 上传头像 API
 * POST /api/users/avatar
 * Body: FormData { file: File }
 */
export async function POST(request: NextRequest) {
  try {
    // 1. 验证用户登录状态
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: '请先登录' },
        { status: 401 }
      );
    }

    // 2. 获取上传的文件
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: '请选择要上传的图片' },
        { status: 400 }
      );
    }

    // 3. 验证文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: '仅支持 JPG、PNG、GIF、WebP 格式的图片' },
        { status: 400 }
      );
    }

    // 4. 验证文件大小（最大 5MB）
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: '图片大小不能超过 5MB' },
        { status: 400 }
      );
    }

    // 5. 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 6. 生成文件名
    const ext = file.name.split('.').pop() || 'png';
    const timestamp = Date.now();
    const key = `avatars/${userId}/${timestamp}.${ext}`;

    // 7. 上传到 COS（uploadToCOS 已返回签名 URL）
    const { key: uploadedKey, url: signedUrl } = await uploadToCOS(key, buffer, file.type, 'perm');  // #804 用户头像→2号桶(永久)

    // 8. 更新用户头像 URL
    const client = getSupabaseClient(undefined, true);
    const { error: updateError } = await client
      .from('users')
      .update({ 
        avatar: signedUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateError) {
      console.error('[Avatar] 更新用户头像失败:', updateError);
      return NextResponse.json(
        { success: false, error: '更新头像失败' },
        { status: 500 }
      );
    }

    console.log('[Avatar] 用户头像上传成功:', { userId, key: uploadedKey });

    return NextResponse.json({
      success: true,
      data: {
        avatar: signedUrl,
        key: uploadedKey,
      },
      message: '头像上传成功',
    });
  } catch (error) {
    console.error('[Avatar] 上传异常:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
