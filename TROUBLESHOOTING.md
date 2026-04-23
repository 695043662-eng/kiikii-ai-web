# 图片生成问题排查指南

## 问题描述
任务显示"生成成功，但没有返回图片数据"

## 快速诊断

### 方法1: 使用测试页面
访问 `/test` 页面：
1. 输入你的 API Key
2. 点击"发送测试请求"
3. 查看返回的测试结果

重点查看：
- `status`: 是否为 200（成功）
- `dataKeys`: 响应包含哪些字段
- `possibleImages`: 可能包含图片的字段及其内容
- `data`: 完整的响应数据

### 方法2: 查看浏览器控制台
1. 打开浏览器开发者工具（按 F12）
2. 切换到 Console（控制台）标签
3. 点击"全部开始生成"或单个任务的"开始生成"
4. 查看控制台输出

寻找以下日志：
```
任务X API 响应: {...}
任务X 解析到的图片: [...]
```

### 方法3: 查看服务器日志
在项目根目录运行：
```bash
pm2 logs
```

或查看Next.js开发服务器控制台，寻找：
```
=== 测试API调用 ===
外部 API 响应状态: ...
外部 API 响应原始文本: ...
```

## 常见情况分析

### 情况1: 返回的是 Base64 编码
响应示例：
```json
{
  "b64_json": "iVBORw0KGgoAAAANSUhEUgAA..."
}
```

**解决方法**：系统会自动处理，会将Base64转换为Data URL格式

### 情况2: 返回的是单个URL
响应示例：
```json
{
  "url": "https://example.com/image.png"
}
```

**解决方法**：系统会自动提取并包装为数组

### 情况3: 返回的是URL数组
响应示例：
```json
{
  "images": ["https://example.com/img1.png", "https://example.com/img2.png"]
}
```

或
```json
{
  "data": ["https://example.com/img1.png", "https://example.com/img2.png"]
}
```

**解决方法**：系统会自动识别并提取

### 情况4: 返回的是对象数组
响应示例：
```json
{
  "items": [
    { "url": "https://example.com/img1.png" },
    { "url": "https://example.com/img2.png" }
  ]
}
```

**解决方法**：系统会自动提取url字段

### 情况5: API 返回错误
响应示例：
```json
{
  "error": "Invalid API key"
}
```

或HTTP状态码非200

**解决方法**：
- 检查API Key是否正确
- 检查API Endpoint是否正确
- 检查网络连接
- 联系API提供方

### 情况6: 返回的JSON格式不标准
响应示例：
```json
{
  "result": {
    "images": ["url1", "url2"]
  }
}
```

**解决方法**：需要根据实际格式调整代码。请提供响应格式，我们会适配。

## 如何报告问题

如果问题仍未解决，请提供以下信息：

### 1. 测试页面结果
从 `/test` 页面复制的完整JSON响应

### 2. 浏览器控制台日志
包括：
- 请求参数
- 响应状态
- 响应数据

### 3. 服务器日志
`pm2 logs` 或开发服务器控制台的输出

### 4. 预期行为
你期望API返回什么样的数据？

## 临时解决方案

在修复期间，你可以：

1. **查看原始响应**：使用测试页面获取原始数据
2. **手动下载图片**：从测试结果中复制图片URL，在浏览器中打开并保存
3. **联系API提供方**：确认正确的响应格式

## 常用调试命令

```bash
# 查看日志
pm2 logs

# 重启服务
pm2 restart all

# 查看进程状态
pm2 status

# 测试API
curl -X POST http://localhost:5000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"your-key","prompt":"test"}'
```

## 技术细节

### 当前支持的响应格式

系统会自动识别以下格式的图片数据：

1. `images` - 图片URL数组
2. `data` - 数据字段
3. `result` - 结果字段
4. `url` - 单个URL
5. `image` - 单个图片URL
6. `b64_json` - Base64编码
7. `items[]` - 对象数组，包含url/image字段
8. 直接的URL数组
9. 嵌套的data结构
10. 从原始文本正则提取URL

### 数据流

```
用户点击生成
  → 调用 /api/generate
    → 转发到外部API
      → 返回原始文本
        → 尝试解析为JSON
          → 提取图片URL
            → 返回 { images, extractionMethod, originalData, debug }
              → 前端显示图片
```

## 联系支持

如果需要进一步帮助，请提供上述的诊断信息，我们会根据实际的API响应格式进行调整。
