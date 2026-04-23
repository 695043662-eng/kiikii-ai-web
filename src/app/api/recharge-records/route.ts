import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  try {
    // 获取用户凭证
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 调用后端API获取充值记录
    const backendUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://api.coze.cn';
    const response = await fetch(`${backendUrl}/v1/recharge_records?user_id=${userId}`, {
      headers: {
        'Authorization': `Bearer ${process.env.BACKEND_API_TOKEN || ''}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      // 如果后端没有数据，返回空记录
      return NextResponse.json({ records: [] });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('获取充值记录失败:', error);
    // 返回空记录，不影响页面显示
    return NextResponse.json({ records: [] });
  }
}
