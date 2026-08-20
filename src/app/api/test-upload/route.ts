import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  console.log('=== 测试上传端点 ===');
  console.log('请求时间:', new Date().toISOString());
  console.log('Content-Type:', request.headers.get('content-type'));
  console.log('Content-Length:', request.headers.get('content-length'));
  
  try {
    const contentType = request.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      
      if (file) {
        console.log('文件名:', file.name);
        console.log('文件大小:', (file.size / 1024 / 1024).toFixed(2), 'MB');
        console.log('文件类型:', file.type);
        
        return NextResponse.json({
          success: true,
          message: '文件上传测试成功',
          file: {
            name: file.name,
            size: file.size,
            type: file.type,
          }
        });
      }
    }
    
    // 尝试读取请求体
    const text = await request.text();
    console.log('请求体大小:', text.length, 'bytes');
    
    return NextResponse.json({
      success: true,
      message: '请求测试成功',
      bodyLength: text.length,
      contentType,
    });
  } catch (error: any) {
    console.error('测试上传错误:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    success: true,
    message: '测试端点可用，请使用 POST 方法上传文件',
  });
}
