import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { deductCredits, checkCreditsSufficient } from '@/lib/credits';

// Route Segment Config - 增加请求体大小限制
export const runtime = 'nodejs';
export const maxDuration = 300; // 最长执行时间 5 分钟（图片分割可能需要较长时间）

// 从数据库获取智能分割的积分配置
// #204 统一数据源：从 api_models 表读取
async function getSmartSplitCredits(): Promise<number> {
  try {
    const supabase = getSupabaseClient(undefined, true);
    const { data, error } = await supabase
      .from('api_models')
      .select('credits_base')
      .eq('model_id', 'smart_split')
      .eq('is_active', true)
      .single();
    
    if (error || !data) {
      console.log('[Split] 未找到智能分割积分配置，使用默认值 5');
      return 5;
    }
    
    return data.credits_base || 5;
  } catch (error) {
    console.error('[Split] 获取积分配置失败:', error);
    return 5;
  }
}

// 从 cookie 获取用户 ID
function getUserIdFromCookie(request: NextRequest): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  
  const cookies = cookieHeader.split(';').map(c => c.trim());
  const userCookie = cookies.find(c => c.startsWith('user_id='));
  if (!userCookie) return null;
  
  return userCookie.split('=')[1] || null;
}

// 默认分割方案 - cells 格式（百分比 0-100）
function getDefaultCells(count: number = 9): Array<{ row: number; col: number; left: number; top: number; right: number; bottom: number }> {
  const cells = [];
  let rows = 3, cols = 3;
  
  if (count <= 1) { rows = 1; cols = 1; }
  else if (count <= 2) { rows = 1; cols = 2; }
  else if (count <= 4) { rows = 2; cols = 2; }
  else if (count <= 6) { rows = 2; cols = 3; }
  else { rows = 3; cols = 3; }
  
  const cellWidth = 100 / cols;
  const cellHeight = 100 / rows;
  
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        row: r,
        col: c,
        left: c * cellWidth,
        top: r * cellHeight,
        right: (c + 1) * cellWidth,
        bottom: (r + 1) * cellHeight
      });
    }
  }
  
  return cells;
}

// 从数据库获取智能分割的API配置
async function getSmartSplitConfig(): Promise<{ apiEndpoint: string; modelName: string; apiKey: string } | null> {
  try {
    const supabase = getSupabaseClient(undefined, true);
    
    // 支持中文和英文两种 type
    const { data, error } = await supabase
      .from('api_keys')
      .select('*')
      .or('type.eq.smart_split,type.eq.智能分割')
      .eq('status', 'active')
      .single();
    
    if (error || !data) {
      console.log('[Split] No smart_split config found in database, error:', error);
      return null;
    }
    
    console.log('[Split] Found config:', { id: data.id, name: data.name, type: data.type, keyLength: data.key?.length });
    
    // 尝试解析 key 字段为 JSON（新格式）
    try {
      const config = JSON.parse(data.key);
      if (config.apiEndpoint && config.modelName && config.apiKey) {
        console.log('[Split] Config is in JSON format with all required fields');
        return config;
      }
      // JSON 格式但缺少字段
      if (config.apiKey && !config.apiEndpoint) {
        console.log('[Split] JSON config missing apiEndpoint or modelName');
        return {
          apiEndpoint: config.apiEndpoint || '',
          modelName: config.modelName || '',
          apiKey: config.apiKey
        };
      }
    } catch {
      // key 不是 JSON，是纯 API key（旧格式）
      console.log('[Split] Config is in old format (plain API key), need to update database');
      // 返回空配置，让调用方知道需要更新
      return {
        apiEndpoint: '',
        modelName: '',
        apiKey: data.key
      };
    }
    
    return null;
  } catch (error) {
    console.error('[Split] Error getting config from database:', error);
    return null;
  }
}

// 智能分割API - 使用管理后台配置的API
export async function POST(request: NextRequest) {
  console.log('[Split] API called, content-length:', request.headers.get('content-length'));
  
  // 积分相关变量 - 提前声明以便在 catch 块中使用
  const userId = getUserIdFromCookie(request);
  let requiredCredits = 5;
  let creditsDeducted = false;
  
  try {
    const body = await request.text();
    console.log('[Split] Body received, length:', body.length);
    
    let parsedBody;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: "无效的JSON数据" }, { status: 400 });
    }
    
    const { image, removeBorders = false, splitCount = 9 } = parsedBody;
    // 🔧 #210 修复：默认值改为 9，但 AI 分析成功时会使用实际识别的数量
    
    if (!image) {
      return NextResponse.json({ error: "缺少图片参数" }, { status: 400 });
    }
    
    // ====== 积分扣除逻辑 ======
    requiredCredits = await getSmartSplitCredits();
    
    if (userId) {
      console.log(`[Split] 用户 ${userId} 使用智能分割，需要 ${requiredCredits} 积分`);
      
      // 检查积分是否足够
      const checkResult = await checkCreditsSufficient(userId, requiredCredits);
      if (!checkResult.sufficient) {
        console.log(`[Split] 积分不足: 当前=${checkResult.currentCredits}, 需要=${requiredCredits}`);
        return NextResponse.json({
          error: `积分不足，当前积分: ${checkResult.currentCredits || 0}，需要: ${requiredCredits}`,
          insufficient: true,
        }, { status: 402 });
      }
      
      // 扣除积分
      // #271 双式记账：生成唯一的 referenceId
      const splitReferenceId = `split_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const deductResult = await deductCredits(userId, requiredCredits, splitReferenceId);
      if (!deductResult.success) {
        console.error(`[Split] 扣除积分失败: ${deductResult.error}`);
        return NextResponse.json({
          error: deductResult.error || '扣除积分失败',
        }, { status: 500 });
      }
      
      creditsDeducted = true;
      console.log(`[Split] 扣除成功，剩余 ${deductResult.remaining} 积分`);
    } else {
      console.warn('[Split] 未登录用户，跳过积分扣除');
    }
    
    // 从数据库获取API配置
    const config = await getSmartSplitConfig();
    
    if (!config) {
      console.log("[Split] No config found, using default split");
      return NextResponse.json({
        success: true,
        analysis: "未配置智能分割API，使用默认分割",
        cells: getDefaultCells(splitCount),
        hasPanels: true,
        needCrop: false,
      });
    }
    
    const { apiEndpoint, modelName, apiKey } = config;
    
    // 检查必要字段
    if (!apiEndpoint || !modelName) {
      console.log("[Split] Config incomplete, using default split");
      return NextResponse.json({
        success: true,
        analysis: "智能分割API配置不完整。请在管理后台更新配置。",
        cells: getDefaultCells(splitCount),
        hasPanels: true,
        needCrop: false,
      });
    }
    
    if (!apiKey) {
      console.log("[Split] Config missing apiKey");
      return NextResponse.json({
        success: true,
        analysis: "智能分割API配置缺少 API Key。请在管理后台更新配置。",
        cells: getDefaultCells(splitCount),
        hasPanels: true,
        needCrop: false,
      });
    }
    
    console.log('[Split] Config complete, calling external API...');
    
    let analysisResult;
    
    try {
      // 使用管理后台配置的API调用视觉模型
      // 根据 removeBorders 参数决定是否去除边框
      const removeBordersText = removeBorders 
        ? `（精确排除黑边/分割线后的实际画面区域）

cells数组说明：
- 每个格子一个对象，按从左到右、从上到下顺序
- left/top/right/bottom 是百分比（相对于整张图）
- 精确到小数点后1位

【关键任务】精确识别黑边/分割线的边界：

1. **识别黑边**：如果图片有明显的黑色边框或分割线（通常5-20像素宽），坐标应该从黑边内侧开始
   - 例如：如果左边有5%宽度的黑边，left应该从5.0开始，不是0
   - 例如：如果格子之间有黑边分割线，right应该停在分割线左侧

2. **识别白边/分割线**：如果是白色分割线，同样要从分割线内侧开始计算

3. **精确边界**：
   - 左边界(left)：从内容实际开始的位置，跳过左侧黑边
   - 右边界(right)：到内容实际结束的位置，跳过右侧黑边
   - 上边界(top)：从内容实际开始的位置，跳过顶部黑边
   - 下边界(bottom)：到内容实际结束的位置，跳过底部黑边

4. **示例**：一个3x3九宫格，每个格子周围有2%的黑边
   - 第一个格子：left=2.0, top=2.0, right=31.3, bottom=31.3
   - 第二个格子：left=35.3, top=2.0, right=64.6, bottom=31.3
   - 注意：格子之间的黑边（约2%宽度）被排除在坐标之外`
        : `（包含完整格子区域，保留分割线和边框）

cells数组说明：
- 每个格子一个对象，按从左到右、从上到下顺序
- left/top/right/bottom 是百分比（相对于整张图）
- 精确到小数点后1位
- 这些坐标应该框住格子的**完整区域**，包含分割线和边框

注意：
- 直接按网格分割，每个格子占满它的区域
- 不需要排除分割线或边框
- 确保格子之间没有重叠和遗漏`;

      const messages = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `你是图像处理专家。分析这张分镜图的结构和内容区域。

【任务】
1. 判断是否有分镜结构，返回行列数
2. 分析每个格子的**内容区域**${removeBordersText}

返回JSON格式（不要markdown标记）：
{
  "hasPanels": true,
  "totalPanels": 9,
  "rows": 3,
  "cols": 3,
  "needCrop": ${removeBorders ? 'true' : 'false'},
  "cells": [
    {
      "row": 0,
      "col": 0,
      "left": 3.5,
      "top": 8.2,
      "right": 29.8,
      "bottom": 31.5
    }
  ],
  "description": "简短描述"
}

只返回JSON。`,
            },
            {
              type: "image_url",
              image_url: {
                url: image,
              },
            },
          ],
        },
      ];

      console.log('[Split] Calling API:', apiEndpoint, 'Model:', modelName);

      // 构建请求URL
      const apiUrl = apiEndpoint.endsWith('/chat/completions') 
        ? apiEndpoint 
        : `${apiEndpoint}/chat/completions`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: messages,
          temperature: 0.3,
        }),
      });

      // 先获取文本响应
      const responseText = await response.text();
      console.log('[Split] API raw response:', responseText.substring(0, 500));

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${responseText}`);
      }

      // 尝试解析 JSON
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error(`API returned non-JSON response: ${responseText.substring(0, 200)}`);
      }

      const content = data.choices?.[0]?.message?.content || '';
      
      console.log('[Split] Model response content:', content.substring(0, 500));

      // 解析返回的JSON - 改进提取逻辑
      let jsonStr = '';
      
      // 1. 先尝试提取 markdown 代码块中的 JSON
      const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      } else {
        // 2. 尝试匹配完整的 JSON 对象（从第一个 { 到最后一个 }）
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }
      }
      
      if (jsonStr) {
        try {
          analysisResult = JSON.parse(jsonStr);
          console.log('[Split] 解析结果:', JSON.stringify(analysisResult, null, 2));
        } catch (parseError: any) {
          console.error('[Split] JSON parse error:', parseError.message);
          console.error('[Split] Attempted to parse:', jsonStr.substring(0, 500));
          throw new Error("JSON 解析失败: " + parseError.message);
        }
      } else {
        throw new Error("Cannot parse analysis result from model response");
      }
    } catch (apiError: any) {
      console.error("[Split] AI analysis failed:", apiError.message);
      // AI分析失败时使用默认分割
      const defaultCells = getDefaultCells(splitCount);
      analysisResult = {
        hasPanels: true,
        totalPanels: splitCount,
        rows: Math.ceil(Math.sqrt(splitCount)),
        cols: Math.ceil(Math.sqrt(splitCount)),
        needCrop: false,
        cells: defaultCells,
        description: "AI分析失败，使用默认分割: " + apiError.message
      };
    }

    // 返回 cells 格式（精确坐标）
    return NextResponse.json({
      success: true,
      hasPanels: analysisResult.hasPanels ?? true,
      totalPanels: analysisResult.totalPanels || splitCount,
      rows: analysisResult.rows || 3,
      cols: analysisResult.cols || 3,
      needCrop: analysisResult.needCrop ?? false,
      cells: analysisResult.cells || getDefaultCells(splitCount),
      description: analysisResult.description || "分割分析完成",
    });

  } catch (error: any) {
    console.error("Smart split error:", error);
    
    // 如果已扣除积分，退还积分
    if (creditsDeducted && userId) {
      console.log(`[Split] 分割失败，退还 ${requiredCredits} 积分给用户 ${userId}`);
      try {
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://kiikii.me';
        await fetch(`${baseUrl}/api/credits/refund`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            credits: requiredCredits,
            taskId: `split_${Date.now()}`,
            reason: '智能分割失败补偿'
          }),
        });
      } catch (refundError) {
        console.error('[Split] 退还积分失败:', refundError);
      }
    }
    
    return NextResponse.json(
      { error: error.message || "智能分割失败" },
      { status: 500 }
    );
  }
}
