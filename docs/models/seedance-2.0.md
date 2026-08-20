# Seedance 2.0 视频生成模型文档

## 一、模型概览

| 前端标识 | 官方模型 ID | 分辨率 | 特点 |
|----------|-------------|--------|------|
| `seedance-2` | `doubao-seedance-2-0-260128` | 480p/720p/1080p | 标准版 |
| `seedance-2-fast` | `doubao-seedance-2-0-fast-260128` | 480p/720p | 快速版（不支持1080p） |

**服务商**: 灵芽 (LingYa)
**API 端点**: `https://api.lingyaai.cn/v1/videos`
**轮询端点**: `GET https://api.lingyaai.cn/v1/videos/{task_id}`
**轮询间隔**: 15秒（官方建议）

---

## 二、计费规则

### 基准单价（元/秒）

| 模型 | 480P | 720P | 1080P |
|------|------|------|-------|
| seedance-2 | ￥0.581 | ￥1.25 | ￥3.116 |
| seedance-2-fast | ￥0.442 | ￥0.95 | ❌不支持 |

### 含视频素材输入折扣

| 模型 | 折扣系数 | 720P 折后 |
|------|----------|-----------|
| seedance-2 | ×0.609 | ￥0.761/s |
| seedance-2-fast | ×0.595 | ￥0.565/s |

### 积分计算公式

```
积分 = Math.ceil(时长 × 分辨率单价 × (含视频输入 ? 折扣系数 : 1))
```

### ⚠️ 铁律：封杀 duration = -1

前端不提供 -1（自动时长）选项，仅保留 [4, 15] 整数秒。后端拦截 duration < 4 的请求。

---

## 三、四种模式（互斥）

| 模式标识 | 名称 | 图片 | 视频 | 音频 |
|----------|------|------|------|------|
| `t2v` | 文生视频 | 0 | 0 | 0 |
| `i2v-first-frame` | 图生视频-首帧 | 1(首帧) | 0~3 | 0~3 |
| `i2v-first-last-frame` | 图生视频-首尾帧 | 1(首)+1(尾) | 0~3 | 0~3 |
| `r2v` | 参考生视频 | 1~9(参考图) | 0~3 | 0~3 |

**⚠️ 三种图片场景互斥，不可混用**

### 前端模式切换

使用 ModelModeSwitcher 按钮（与 HappyHorse 相同设计），用户选择后：
- 可用的素材槽位正常显示
- 不可用的素材自动暗掉

### 防呆校验

1. `i2v-first-last-frame`：必须同时上传首帧和尾帧图片
2. 音频必须搭配至少 1 个参考视频或图片
3. 参考视频最多 3 段，参考音频最多 3 段

---

## 四、参数约束

| 维度 | 限制 |
|------|------|
| duration | [4, 15] 秒（封杀 -1） |
| resolution | 480p/720p/1080p（fast 不支持 1080p） |
| ratio | 16:9/4:3/1:1/3:4/9:16/21:9/adaptive |
| 首帧图 | 1张 |
| 首尾帧图 | 2张 |
| 参考图 | 1~9张 |
| 图片格式 | jpeg/png/webp/bmp/tiff/gif |
| 图片大小 | ≤30MB |
| 参考视频 | 最多3段，总时长≤15s，单段[2,15]秒 |
| 视频格式 | mp4/mov |
| 视频大小 | ≤50MB |
| 参考音频 | 最多3段，总时长≤15s |
| 音频格式 | wav/mp3 |
| 音频大小 | ≤15MB |
| 任务ID有效期 | 7天 |
| 视频URL有效期 | 24小时 |

---

## 五、后端实现要点

### 模型 ID 映射（必须）

```typescript
const SEEDANCE2_REAL_ID_MAP: Record<string, string> = {
  'seedance-2': 'doubao-seedance-2-0-260128',
  'seedance-2-fast': 'doubao-seedance-2-0-fast-260128',
};
```

### Content 数组拼装

```typescript
function buildSeedance2Content(params: {
  mode: string;
  prompt: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
}): ContentItem[] {
  const content: ContentItem[] = [];

  // 文本
  if (params.prompt) content.push({ type: 'text', text: params.prompt });

  // 根据模式添加图片（role 明确，不推断）
  if (params.mode === 'i2v-first-frame' && params.firstFrameUrl) {
    content.push({ type: 'image_url', image_url: { url: params.firstFrameUrl }, role: 'first_frame' });
  } else if (params.mode === 'i2v-first-last-frame') {
    if (params.firstFrameUrl) content.push({ type: 'image_url', image_url: { url: params.firstFrameUrl }, role: 'first_frame' });
    if (params.lastFrameUrl) content.push({ type: 'image_url', image_url: { url: params.lastFrameUrl }, role: 'last_frame' });
  } else if (params.mode === 'r2v' && params.referenceImageUrls?.length) {
    params.referenceImageUrls.forEach(url => {
      content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
    });
  }

  // 参考视频和音频（非 t2v 模式）
  if (params.mode !== 't2v') {
    params.referenceVideoUrls?.forEach(url => {
      content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' });
    });
    params.referenceAudioUrls?.forEach(url => {
      content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' });
    });
  }

  return content;
}
```

### 积分计算

```typescript
function getSeedance2Credits(model: string, resolution: string, duration: number, hasVideoInput: boolean): number {
  const pricing = {
    'seedance-2': { '480p': 0.581, '720p': 1.25, '1080p': 3.116 },
    'seedance-2-fast': { '480p': 0.442, '720p': 0.95 },
  };
  const discounts = { 'seedance-2': 0.609, 'seedance-2-fast': 0.595 };
  const base = pricing[model]?.[resolution] || 0;
  const discount = hasVideoInput ? discounts[model] : 1;
  return Math.ceil(duration * base * discount);
}
```

---

## 六、前端实现要点

### AudioUploader.tsx

新建组件，支持：
- accept: audio/wav, audio/mp3
- 单文件 ≤15MB
- 最多 3 段
- `<audio controls>` 预览
- COS 直传上传

### 素材槽位状态表

| 模式 | 首帧图 | 尾帧图 | 参考图 | 参考视频 | 参考音频 |
|------|--------|--------|--------|----------|----------|
| t2v | ❌ 暗掉 | ❌ 暗掉 | ❌ 暗掉 | ❌ 暗掉 | ❌ 暗掉 |
| i2v-first-frame | ✅(1) | ❌ 暗掉 | ❌ 暗掉 | ✅(0~3) | ✅(0~3) |
| i2v-first-last-frame | ✅(1) | ✅(1) | ❌ 暗掉 | ✅(0~3) | ✅(0~3) |
| r2v | ❌ 暗掉 | ❌ 暗掉 | ✅(1~9) | ✅(0~3) | ✅(0~3) |

---

## 七、相关文件

| 文件 | 修改内容 |
|------|----------|
| `src/lib/model-registry.ts` | Seedance 2.0 静态配置 |
| `src/components/AudioUploader.tsx` | 新建音频上传组件 |
| `src/components/ModelModeSwitcher.tsx` | 四种模式按钮 |
| `src/app/video/page.tsx` | 素材槽位+参考视频/音频上传 |
| `src/components/temp_RightPanel.tsx` | 对话框素材槽位 |
| `src/app/api/video/generate/route.ts` | 后端处理（ID映射+Content拼装+动态计费） |

---

## 八、官方文档

- 灵芽 API 文档: https://api.lingyaai.cn/doc
- Seedance 2.0 MD 下载: https://api.lingyaai.cn/doc/coding/seedance2.0-video.md
