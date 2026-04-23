# API 接口使用说明

## 概述

本项目集成了4个API接口，用于实现图片生成、测试连接、图像反推等功能。

## 1. 图生图接口 `/api/image-to-image`

### 功能
支持文生图和图生图两种模式，通过并行调用API提高生成效率。

### 请求方法
POST

### 请求参数
```typescript
{
  prompt: string;              // 提示词（必填）
  images?: string[];           // 参考图Base64数组（图生图时必填）
  apiEndpoint: string;         // API端点URL（必填）
  apiKey: string;              // API密钥（必填）
  model?: string;              // 模型名称，默认 'nano-banana-fast'
  resolution?: string;         // 分辨率，默认 '1K'，可选 '1K', '2K', '4K'
  aspectRatio?: string;        // 宽高比，默认 'auto'，可选 '1:1', '3:4', '4:3', '16:9', '9:16'
  generationCount?: number;    // 生成数量，默认 4
}
```

### 响应格式
```typescript
{
  success: boolean;
  imageUrls: string[];  // 生成的图片URL数组
  count: number;        // 实际生成的图片数量
}
```

### 示例调用
```javascript
const response = await fetch('/api/image-to-image', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: '一只可爱的猫咪',
    images: [],  // 图生图时传入图片Base64数组
    apiEndpoint: 'https://grsai.dakka.com.cn/v1/draw/nano-banana',
    apiKey: 'sk-e7338c2ee4e642d18925f795a2c286ff',
    model: 'nano-banana-fast',
    resolution: '1K',
    aspectRatio: '1:1',
    generationCount: 4,
  }),
});

const data = await response.json();
console.log(data.imageUrls);  // 生成的图片URL数组
```

---

## 2. 测试连接接口 `/api/test-connection`

### 功能
测试API连接是否正常，验证API密钥和端点是否有效。

### 请求方法
POST

### 请求参数
```typescript
{
  apiEndpoint: string;  // API端点URL（必填）
  apiKey: string;       // API密钥（必填）
}
```

### 响应格式
**成功：**
```typescript
{
  success: true;
  message: '连接成功';
  status: number;  // HTTP状态码
}
```

**失败：**
```typescript
{
  error: string;     // 错误信息
  details?: string;  // 详细错误信息
}
```

### 示例调用
```javascript
const result = await fetch('/api/test-connection', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    apiEndpoint: 'https://grsai.dakka.com.cn/v1/draw/nano-banana',
    apiKey: 'sk-e7338c2ee4e642d18925f795a2c286ff',
  }),
});

const data = await result.json();
if (data.success) {
  console.log('连接成功');
} else {
  console.error('连接失败:', data.error);
}
```

---

## 3. 图像反推接口 `/api/analyze-image`

### 功能
使用视觉模型分析图片中人物的动作姿态和面部表情。

### 请求方法
POST

### 请求参数
```typescript
{
  image: string;  // 图片URL或Base64数据（必填）
}
```

### 响应格式
```typescript
{
  success: boolean;
  prompt: string;  // 生成的描述文本
}
```

### 示例调用
```javascript
const response = await fetch('/api/analyze-image', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    image: 'https://example.com/image.jpg',  // 或 Base64 数据
  }),
});

const data = await response.json();
console.log(data.prompt);  // 分析结果
```

---

## 4. 环境变量配置

### 必需配置

在 `.env.local` 文件中配置以下环境变量：

```bash
# 对象存储配置（图生图功能需要）
S3_ENDPOINT_URL=你的对象存储端点URL
S3_BUCKET_NAME=你的存储桶名称

# 示例：
# S3_ENDPOINT_URL=https://oss-cn-beijing.aliyuncs.com
# S3_BUCKET_NAME=my-bucket-name
```

### 配置说明

**对象存储配置**：
- 用于存储上传的参考图片
- 支持 S3 兼容的对象存储服务
- 使用 `coze-coding-dev-sdk` 的 `S3Storage` 类

---

## 技术架构

### 图生图流程
1. 用户上传参考图片 → 前端压缩为Base64
2. 调用 `/api/image-to-image` 接口
3. 后端将Base64图片上传到对象存储，生成临时URL
4. 并行调用外部API生成图片
5. 解析响应，提取图片URL返回给前端

### 并行生成优化
- 使用 `Promise.all` 并行调用API
- 根据用户设置的 `generationCount` 数量并行生成
- 提高生成效率，减少等待时间

### SSE 格式支持
- 支持解析 Server-Sent Events 格式的响应
- 自动提取 `data:` 前缀后的JSON数据

---

## 错误处理

### 常见错误

1. **缺少参数**
   - 状态码：400
   - 错误信息：`缺少必要参数：prompt` 或 `缺少 API 配置`

2. **上传失败**
   - 状态码：500
   - 错误信息：`上传参考图失败，请检查对象存储配置`

3. **生成失败**
   - 状态码：500
   - 错误信息：`未能生成任何图片`

4. **连接失败**
   - 状态码：500
   - 错误信息：`连接失败` 或 `服务器内部错误`

### 错误响应格式
```typescript
{
  error: string;      // 错误信息
  details?: string;   // 详细错误信息（开发环境）
}
```

---

## 最佳实践

### 1. 图片压缩
前端上传前先压缩图片：
```javascript
const maxWidth = 600;
const quality = 0.6;
// 使用 Canvas API 压缩
```

### 2. 错误重试
对于网络错误，建议实现重试机制：
```javascript
const maxRetries = 3;
for (let i = 0; i < maxRetries; i++) {
  try {
    const result = await fetch(...);
    if (result.ok) break;
  } catch (error) {
    if (i === maxRetries - 1) throw error;
  }
}
```

### 3. 加载状态
生成图片时显示加载状态，提升用户体验：
```javascript
setIsGenerating(true);
try {
  // 调用API
} finally {
  setIsGenerating(false);
}
```

---

## API 测试结果

### ✅ 测试连接接口
```bash
curl -X POST http://localhost:5000/api/test-connection \
  -H 'Content-Type: application/json' \
  -d '{"apiEndpoint":"https://grsai.dakka.com.cn/v1/draw/nano-banana","apiKey":"sk-e7338c2ee4e642d18925f795a2c286ff"}'

# 响应：{"success":true,"message":"连接成功","status":200}
```

---

## 注意事项

1. **对象存储配置**
   - 图生图功能必需配置对象存储
   - 确保 `.env.local` 中的配置正确
   - 测试时可以先使用文生图模式

2. **API 密钥安全**
   - 不要在前端代码中硬编码 API 密钥
   - 建议使用环境变量或后端配置

3. **图片格式**
   - 支持 PNG、JPG、JPEG 格式
   - Base64 格式：`data:image/png;base64,xxx`

4. **生成数量**
   - 建议生成数量控制在 1-10 张
   - 过多可能导致API调用失败

---

## 更新日志

### v1.0.0 (2024-03-20)
- ✅ 创建图生图接口
- ✅ 创建测试连接接口
- ✅ 创建图像反推接口
- ✅ 更新环境变量配置
- ✅ 更新前端代码集成新API
- ✅ 测试验证所有接口
