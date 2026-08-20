# 画布图片与占位符初始大小分析报告

---

## 📊 概览摘要

| 项目 | 画布初始大小 | 图片/占位符初始大小 | 比例关系 |
|------|-------------|-------------------|---------|
| **高度** | 40000px（固定） | 1000px（最长边固定） | 40:1 |
| **宽度** | 动态计算（约92800px） | 保持宽高比，最长边≤1000px | ~92:1 |
| **镜头缩放** | 0.01~1（动态） | 单图占50%屏幕，多图占80%屏幕 | 动态适配 |

---

## 1. 画布初始大小

### 1.1 核心常量定义

**位置**：`src/hooks/useCanvasCore.ts:40-48`

```typescript
/** 画布高度（像素） - 固定值 */
export const CANVAS_HEIGHT = 40000;

/** 画布宽度 - 根据容器比例动态计算 */
const CANVAS_WIDTH = containerSize.width > 0 && containerSize.height > 0
  ? Math.round((containerSize.width / containerSize.height) * CANVAS_HEIGHT)
  : CANVAS_HEIGHT; // 默认正方形

/** 最小缩放比例 */
export const MIN_ZOOM = 0.01;

/** 空白检测偏移量数组 */
export const IMAGE_OVERLAP_OFFSETS = [50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000];
```

### 1.2 动态计算逻辑

**公式**：
```
CANVAS_WIDTH = (容器宽度 / 容器高度) × CANVAS_HEIGHT
```

**典型值计算**（基于默认容器尺寸 1920×826）：
```
CANVAS_WIDTH = (1920 / 826) × 40000 ≈ 92800px
```

### 1.3 容器尺寸获取

**位置**：`src/app/canvas/page.tsx:1953`

```typescript
const [containerSize, setContainerSize] = useState({ width: 1200, height: 800 });
```

通过 ResizeObserver 监听容器尺寸变化，实时更新 CANVAS_WIDTH。

---

## 2. 图片初始大小规则

### 2.1 核心常量

**位置**：`src/lib/canvas-image-layout.ts:19-64`

```typescript
export const CANVAS_IMAGE_RULES = {
  /** 图片最长边（画布坐标，固定值） */
  FIXED_MAX_SIZE: 1000,
  
  /** 单图占屏幕比例 */
  SINGLE_IMAGE_RATIO: 0.5,
  
  /** 多图占屏幕比例 */
  MULTI_IMAGE_RATIO: 0.8,
  
  /** 网格间距 */
  GRID_GAP: 60,
  
  /** 缩放范围 */
  MIN_ZOOM: 0.1,
  MAX_ZOOM: 1,
};
```

### 2.2 图片尺寸计算逻辑

**位置**：`src/lib/canvas-image-layout.ts:230-243`

```typescript
// 保持宽高比，最长边为 1000px
if (aspectRatio > 1) {
  // 横图：宽度=1000，高度按比例
  width = FIXED_MAX_SIZE;  // 1000px
  height = Math.max(10, FIXED_MAX_SIZE / aspectRatio);
} else {
  // 竖图或正方形：高度=1000，宽度按比例
  height = FIXED_MAX_SIZE;  // 1000px
  width = Math.max(10, FIXED_MAX_SIZE * aspectRatio);
}
```

### 2.3 典型比例对照表

| 用户选择比例 | 图片宽度 | 图片高度 | 实际像素（画布坐标） |
|-------------|---------|---------|-------------------|
| 1:1（正方形） | 1000px | 1000px | 1000×1000 |
| 16:9（横屏） | 1000px | 562px | 1000×562 |
| 9:16（竖屏） | 562px | 1000px | 562×1000 |
| 4:3（传统） | 1000px | 750px | 1000×750 |
| 3:4（竖向） | 750px | 1000px | 750×1000 |
| 3:1（超宽） | 1000px | 333px | 1000×333 |
| 1:3（超窄） | 333px | 1000px | 333×1000 |

---

## 3. 占位符初始大小

### 3.1 创建入口

**位置**：`src/app/canvas/page.tsx:3390-3503`

```typescript
const createPlaceholdersWithClientIds = useCallback((
  clientIds: string[],
  prompt: string,
  taskId: string,
  options?: {
    sourceType?: 'generate' | 'split' | 'video';
    ratio?: string;  // 用户选择的比例
    imageDimensions?: { width: number; height: number }[];  // 实际图片尺寸
  }
): { id: string; index: number; x: number; y: number; width: number; height: number }[]
```

### 3.2 尺寸计算流程

```
┌─────────────────────────────────────────────────────────────┐
│                    占位符尺寸计算流程                          │
├─────────────────────────────────────────────────────────────┤
│  1. 获取容器尺寸 (containerRect)                             │
│     ↓                                                        │
│  2. 调用 calculateImageGroupLayout()                         │
│     ↓                                                        │
│  3. 计算单元格尺寸                                            │
│     - 有 ratio 参数：根据比例计算                              │
│     - 无 ratio 参数：使用 FIXED_MAX_SIZE = 1000px            │
│     ↓                                                        │
│  4. 计算网格布局 (cols, rows, gap)                            │
│     ↓                                                        │
│  5. 计算镜头缩放                                              │
│     - 单图：占屏幕 50%                                        │
│     - 多图：占屏幕 80%                                        │
│     ↓                                                        │
│  6. 创建占位符元素                                            │
│     - width: safeWidth (≥10px)                               │
│     - height: safeHeight (≥10px)                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 布局计算核心函数

**位置**：`src/lib/canvas-image-layout.ts:161-288`

```typescript
export function calculateImageGroupLayout(input: LayoutInput): LayoutResult {
  const { imageCount, imageDimensions, containerWidth, containerHeight, currentZoom, ratio } = input;
  
  // 1. 网格布局
  const cols = getGridCols(imageCount);  // 1-4张=水平，5-8张=2行，9+=3行
  const rows = getGridRows(imageCount);
  const gap = GRID_GAP;  // 60px
  
  // 2. 单元格尺寸（固定最长边 1000px）
  let cellWidth = FIXED_MAX_SIZE;  // 1000px
  let cellHeight = FIXED_MAX_SIZE;  // 1000px
  
  // 3. 根据比例调整（如有指定）
  if (ratio !== 'auto') {
    const parts = ratio.split(':').map(p => parseInt(p) || 1);
    // ...按比例计算
  }
  
  // 4. 图片组总尺寸
  const totalWidth = cols * cellWidth + (cols - 1) * gap;
  const totalHeight = rows * cellHeight + (rows - 1) * gap;
  
  // 5. 镜头缩放
  const screenRatio = getScreenRatio(imageCount);  // 单图0.5，多图0.8
  const zoom = Math.min(
    (containerWidth * screenRatio) / totalWidth,
    (containerHeight * screenRatio) / totalHeight,
    MAX_ZOOM
  );
  
  return { cols, rows, cellWidth, cellHeight, totalWidth, totalHeight, zoom, ... };
}
```

---

## 4. 网格布局规则

### 4.1 列数计算

**位置**：`src/lib/canvas-image-layout.ts:44-48`

```typescript
getGridCols: (count: number): number => {
  if (count <= 4) return count;      // 1-4张：水平排列
  if (count <= 8) return Math.ceil(count / 2);  // 5-8张：2行
  return Math.ceil(count / 3);       // 9+张：3行
}
```

### 4.2 布局对照表

| 图片数量 | 列数 | 行数 | 排列方式 | 间距 | 图片组尺寸示例 |
|---------|-----|-----|---------|-----|---------------|
| 1张 | 1 | 1 | 水平 | 0 | 1000×1000 |
| 2张 | 2 | 1 | 水平 | 60 | 2060×1000 |
| 3张 | 3 | 1 | 水平 | 120 | 3120×1000 |
| 4张 | 4 | 1 | 水平 | 180 | 4180×1000 |
| 5张 | 3 | 2 | 网格 | 60×60 | 2060×2060 |
| 6张 | 3 | 2 | 网格 | 120×60 | 2060×2060 |
| 8张 | 4 | 2 | 网格 | 180×60 | 4180×2060 |
| 9张 | 3 | 3 | 网格 | 120×120 | 3120×3120 |
| 12张 | 4 | 3 | 网格 | 180×120 | 4180×3120 |

---

## 5. 镜头缩放计算

### 5.1 缩放公式

**位置**：`src/lib/canvas-image-layout.ts:251-260`

```typescript
const fitZoom = totalWidth > 0 && totalHeight > 0 
  ? Math.min(
      (safeContainerWidth * screenRatio) / totalWidth,
      (safeContainerHeight * screenRatio) / totalHeight,
      MAX_ZOOM  // 1
    )
  : MIN_ZOOM;  // 0.1
const zoom = Math.max(MIN_ZOOM, Math.min(fitZoom, MAX_ZOOM));
```

### 5.2 缩放对照表（容器1920×826）

| 图片数量 | 图片组尺寸 | screenRatio | 计算zoom | 实际显示尺寸 |
|---------|-----------|-------------|---------|-------------|
| 1张（1000×1000） | 1000×1000 | 0.5 | ~0.41 | 410×410（占屏幕50%） |
| 2张（2060×1000） | 2060×1000 | 0.8 | ~0.66 | 1360×660（占屏幕80%） |
| 4张（4180×1000） | 4180×1000 | 0.8 | ~0.38 | 1587×380（占屏幕80%） |
| 9张（3120×3120） | 3120×3120 | 0.8 | ~0.21 | 655×655（占屏幕80%） |

---

## 6. 画布坐标与屏幕坐标转换

### 6.1 转换公式

```
屏幕坐标 = 画布坐标 × zoom + pan偏移
画布坐标 = (屏幕坐标 - pan偏移) / zoom
```

### 6.2 示例计算

**假设**：
- zoom = 0.4
- pan = { x: -100, y: -200 }
- 图片画布坐标：(2000, 2000)

**屏幕坐标计算**：
```
screenX = 2000 × 0.4 + (-100) = 700px
screenY = 2000 × 0.4 + (-200) = 600px
```

---

## 7. 大小比例关系总览

### 7.1 画布与图片比例

```
画布高度 (40000px) / 图片最长边 (1000px) = 40倍
画布宽度 (~92800px) / 图片最长边 (1000px) ≈ 92倍
```

### 7.2 可视区域与图片比例

| zoom值 | 可视区域尺寸（画布坐标） | 图片显示比例 |
|-------|----------------------|-------------|
| 1.0 | 1920×826 | 图片占画布 0.5%~1% |
| 0.5 | 3840×1652 | 图片占可视区域 25%~50% |
| 0.2 | 9600×4130 | 图片占可视区域 10%~20% |
| 0.1 | 19200×8260 | 图片占可视区域 5%~10% |
| 0.01 | 192000×82600 | 图片占可视区域 0.5%~1% |

---

## 8. 关键设计原则

### 8.1 尺寸固定原则

> **图片最长边固定 1000px（画布坐标）**，不随 zoom 变化

- 这是核心设计原则，确保所有图片在画布上有统一的基础尺寸
- zoom 仅控制显示比例，不影响图片实际画布尺寸

### 8.2 屏幕适配原则

> **镜头动态缩放，让图片组占屏幕合理比例**

- 单图：占屏幕 50%（`SINGLE_IMAGE_RATIO = 0.5`）
- 多图：占屏幕 80%（`MULTI_IMAGE_RATIO = 0.8`）

### 8.3 网格布局原则

> **图片数量决定网格布局，保持视觉美观**

- 1-4张：水平排列，方便对比
- 5-8张：2行网格，紧凑展示
- 9+张：3行网格，批量呈现

---

## 9. 代码位置索引

| 功能 | 文件路径 | 行号 |
|------|---------|-----|
| 画布高度常量 | `src/hooks/useCanvasCore.ts` | 40 |
| 画布宽度计算 | `src/hooks/useCanvasCore.ts` | 244-246 |
| 图片尺寸常量 | `src/lib/canvas-image-layout.ts` | 21 |
| 图片尺寸计算 | `src/lib/canvas-image-layout.ts` | 230-243 |
| 占位符创建 | `src/app/canvas/page.tsx` | 3390-3503 |
| 网格布局计算 | `src/lib/canvas-image-layout.ts` | 161-288 |
| 镜头缩放计算 | `src/lib/canvas-image-layout.ts` | 251-260 |

---

## 10. 结论

### 核心结论

1. **画布初始大小**：高度固定 40000px，宽度动态计算约 92800px
2. **图片初始大小**：最长边固定 1000px，保持宽高比
3. **占位符初始大小**：与图片规则一致，最长边 1000px
4. **比例关系**：画布是图片的 40~92 倍，确保有足够空间容纳多张图片
5. **镜头适配**：动态缩放确保图片组占屏幕 50%（单图）或 80%（多图）

### 设计优势

- ✅ 统一尺寸规则，避免图片大小混乱
- ✅ 固定最长边，保持宽高比，不变形
- ✅ 动态镜头缩放，自动适配不同图片数量
- ✅ 网格布局美观，间距固定 60px
- ✅ 画布超大空间，支持海量图片同时展示

---

*报告生成时间：2025年*
*分析依据：`src/hooks/useCanvasCore.ts`, `src/lib/canvas-image-layout.ts`, `src/app/canvas/page.tsx`*