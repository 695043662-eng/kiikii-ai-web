import re

# 读取文件
with open("/www/kiikii_me/client/src/app/api/image-to-image/route.ts", "r") as f:
    content = f.read()

# 1. 添加 axios 导入
old_import = "import { NextRequest } from 'next/server';"
new_import = """import { NextRequest } from 'next/server';
import axios from 'axios';"""
content = content.replace(old_import, new_import)

# 2. 替换第一个 fetch 调用（旧架构）
old_fetch1 = '''    const response = await fetch(legacyConfig.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${legacyConfig.apiKey}`,
      },
      body: JSON.stringify({
        ...requestBody,
        webhook: webhookUrl,
      }),
    });

    return parseTerminalResponse(response, '旧架构');'''

new_fetch1 = '''    const response = await axios.post(legacyConfig.apiEndpoint, {
      ...requestBody,
      webhook: webhookUrl,
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${legacyConfig.apiKey}`,
      },
      timeout: 40000,
    });

    return parseTerminalResponse(response, '旧架构', true);'''

content = content.replace(old_fetch1, new_fetch1)

# 3. 替换第二个 fetch 调用（新架构）
old_fetch2 = '''  try {
    // 添加超时控制（40秒）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 40000);

    try {
      response = await fetch(fullConfig.apiEndpoint, {
        method: fullConfig.requestMethod,
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (fetchError: any) {
    console.error('[Terminal] Fetch 失败:', {
      endpoint: fullConfig.apiEndpoint,
      method: fullConfig.requestMethod,
      error: fetchError,
      errorMessage: fetchError.message,
      errorName: fetchError.name,
      errorStack: fetchError.stack?.substring(0, 500)
    });
    throw new Error(`API 请求失败: ${fetchError.message || '网络错误'}`);
  }'''

new_fetch2 = '''  try {
    // 使用 axios 发送请求
    response = await axios.request({
      method: fullConfig.requestMethod,
      url: fullConfig.apiEndpoint,
      headers,
      data: body,
      timeout: 40000,
    });
  } catch (fetchError: any) {
    console.error('[Terminal] Axios 失败:', {
      endpoint: fullConfig.apiEndpoint,
      method: fullConfig.requestMethod,
      error: fetchError,
      errorMessage: fetchError.message,
      errorName: fetchError.name,
      errorStack: fetchError.stack?.substring(0, 500)
    });
    throw new Error(`API 请求失败: ${fetchError.message || '网络错误'}`);
  }'''

content = content.replace(old_fetch2, new_fetch2)

# 4. 修改 parseTerminalResponse 函数，添加 isAxios 参数
old_parse = '''function parseTerminalResponse(response: Response, source: string): { terminalTaskId: string } {'''
new_parse = '''function parseTerminalResponse(response: any, source: string, isAxios: boolean = false): { terminalTaskId: string } {'''
content = content.replace(old_parse, new_parse)

# 5. 修改 parseTerminalResponse 中的响应处理
old_parse_body = '''  // 解析响应
  const data = await response.json();'''
new_parse_body = '''  // 解析响应（axios 已经解析了 JSON）
  const data = isAxios ? response.data : await response.json();'''
content = content.replace(old_parse_body, new_parse_body)

# 6. 修改响应检查
old_status_check = '''  // 检查响应状态
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    console.error(`[Terminal] ${source} 请求失败:`, response.status, errorText);
    throw new Error(`API 错误: ${errorText}`);'''
new_status_check = '''  // 检查响应状态
  if (!isAxios && !response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    console.error(`[Terminal] ${source} 请求失败:`, response.status, errorText);
    throw new Error(`API 错误: ${errorText}`);'''
content = content.replace(old_status_check, new_status_check)

# 7. 修改新架构的响应处理（axios 返回 response.data）
old_response_text = '''  // 检测是否是 Gemini 同步响应
  const responseText = await response.text();
  let data: any = null;

  try {
    data = JSON.parse(responseText);
  } catch {
    // 不是 JSON，走异步流程
  }'''

new_response_text = '''  // 检测是否是 Gemini 同步响应
  // axios 直接返回 data
  const data = response.data;
  const responseText = typeof data === 'string' ? data : JSON.stringify(data);'''

content = content.replace(old_response_text, new_response_text)

# 写入文件
with open("/www/kiikii_me/client/src/app/api/image-to-image/route.ts", "w") as f:
    f.write(content)

print("修改完成!")
