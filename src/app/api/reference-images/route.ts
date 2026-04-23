import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { uploadToCOS, getSignedUrl } from '@/lib/cos';
import { cookies } from 'next/headers';

// 参考图接口返回类型
interface ReferenceImageResponse {
  success: boolean;
  exists: boolean;
  signedUrl?: string;
  cosKey?: string;
  error?: string;
}

// GET: 根据 MD5 查询参考图缓存
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const md5Hash = searchParams.get('md5');
    const userId = searchParams.get('userId');

    if (!md5Hash || !userId) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少必要参数：md5 或 userId' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = getSupabaseClient(undefined, true);

    // 查询数据库
    const { data, error } = await client
      .from('reference_images')
      .select('cos_key, created_at')
      .eq('user_id', userId)
      .eq('md5_hash', md5Hash)
      .maybeSingle();

    if (error) {
      console.error('查询参考图缓存失败:', error);
      return new Response(JSON.stringify({ 
        success: false, 
        error: '数据库查询失败' 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 未找到缓存
    if (!data) {
      return new Response(JSON.stringify({ 
        success: true, 
        exists: false 
      } as ReferenceImageResponse), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 找到缓存，生成签名 URL
    const signedUrl = await getSignedUrl(data.cos_key, 432000); // 5天有效期

    return new Response(JSON.stringify({ 
      success: true, 
      exists: true,
      signedUrl,
      cosKey: data.cos_key,
    } as ReferenceImageResponse), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('查询参考图缓存异常:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '服务器内部错误' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// POST: 异步存储参考图到 COS 和数据库
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, md5Hash, base64 } = body;

    if (!userId || !md5Hash || !base64) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少必要参数' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = getSupabaseClient(undefined, true);

    // 先检查是否已存在（防止重复上传）
    const { data: existing } = await client
      .from('reference_images')
      .select('cos_key')
      .eq('user_id', userId)
      .eq('md5_hash', md5Hash)
      .maybeSingle();

    if (existing) {
      console.log('参考图已存在，跳过上传:', md5Hash);
      const signedUrl = await getSignedUrl(existing.cos_key, 432000);
      return new Response(JSON.stringify({ 
        success: true, 
        exists: true,
        signedUrl,
        cosKey: existing.cos_key,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 上传到 COS
    console.log('上传参考图到 COS:', md5Hash);
    const cosKey = `reference-images/${userId}/${md5Hash}.png`;
    
    // 解析 base64
    let base64Data = base64;
    if (base64.includes(',')) {
      base64Data = base64.split(',')[1];
    }
    const buffer = Buffer.from(base64Data, 'base64');

    await uploadToCOS(cosKey, buffer, 'image/png');

    // 写入数据库
    const { error: insertError } = await client
      .from('reference_images')
      .insert({
        user_id: userId,
        md5_hash: md5Hash,
        cos_key: cosKey,
      });

    if (insertError) {
      console.error('写入参考图数据库失败:', insertError);
      // 数据库写入失败但 COS 已上传，返回成功（后续可通过 MD5 重建映射）
    }

    // 生成签名 URL
    const signedUrl = await getSignedUrl(cosKey, 432000);

    console.log('参考图存储成功:', md5Hash);

    return new Response(JSON.stringify({ 
      success: true, 
      exists: false,
      signedUrl,
      cosKey: cosKey,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('存储参考图异常:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '服务器内部错误' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// 批量查询参考图
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, md5Hashes } = body;

    if (!userId || !Array.isArray(md5Hashes)) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少必要参数' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (md5Hashes.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        images: [] 
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = getSupabaseClient(undefined, true);

    // 批量查询
    const { data, error } = await client
      .from('reference_images')
      .select('md5_hash, cos_key')
      .eq('user_id', userId)
      .in('md5_hash', md5Hashes);

    if (error) {
      console.error('批量查询参考图失败:', error);
      return new Response(JSON.stringify({ 
        success: false, 
        error: '数据库查询失败' 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 生成签名 URL
    const images = await Promise.all(
      (data || []).map(async (item) => ({
        md5Hash: item.md5_hash,
        signedUrl: await getSignedUrl(item.cos_key, 432000),
        cosKey: item.cos_key,
      }))
    );

    return new Response(JSON.stringify({ 
      success: true, 
      images 
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('批量查询参考图异常:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '服务器内部错误' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
