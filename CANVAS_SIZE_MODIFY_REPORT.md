# 画布与图片尺寸修改影响分析报告

---

## 📋 修改概述

| 参数 | 当前值 | 目标值 | 变化幅度 |
|------|--------|--------|---------|
| **画布高度 (CANVAS_HEIGHT)** | 40000px | 60000px | +50% |
| **图片最长边 (FIXED_MAX_SIZE)** | 1000px | 1500px | +50% |

---

## ⚠️ 影响等级分类

| 影响等级 | 说明 | 修复难度 |
|---------|------|---------|
| 🔴 **高风险** | 功能崩溃、数据丢失、布局错乱 | 需要同步修改 |
| 🟠 **中风险** | 用户体验变差、显示不理想 | 建议调整 |
| 🟡 **低风险** | 边缘场景、轻微影响 | 可忽略 |

---

## 1. 必须同步修改的代码（🔴 高风险）

### 1.1 CanvasContext.tsx 中的硬编码值

**位置**：`src/contexts/CanvasContext.tsx:1463-1464`

**当前代码**：
```typescript
const CANVAS_WIDTH = 40000;
const CANVAS_HEIGHT = 27586;
```

**问题**：
- 这里硬编码了画布尺寸，与 `useCanvasCore.ts` 的常量不一致
- 修改后需要同步更新，否则图片上传定位会错乱

**修复方案**：
```typescript
// 方案A：从 useCanvasCore 导入常量
import { CANVAS_HEIGHT } from '@/hooks/useCanvasCore';
const CANVAS_WIDTH = Math.round((containerSize.width / containerSize.height) * CANVAS_HEIGHT);

// 方案B：直接修改硬编码值（需同步）
const CANVAS_WIDTH = 60000;  // 或动态计算
const CANVAS_HEIGHT = 60000 * (containerSize.height / containerSize.width);  // 需精确计算
```

### 1.2 INITIAL_VISIBLE_HEIGHT 参数

**位置**：`src/app/canvas/page.tsx:5501-5504`

**当前代码**：
```typescript
// CANVAS_HEIGHT = 40000 是固定值，INITIAL_VISIBLE_HEIGHT = 10000 表示看到画布高度的 1/4
const INITIAL_VISIBLE_HEIGHT = 10000;
const initialZoom = containerRect.height / INITIAL_VISIBLE_HEIGHT;
```

**问题**：
- `INITIAL_VISIBLE_HEIGHT` 与 `CANVAS_HEIGHT` 有比例关系（1/4）
- 修改 `CANVAS_HEIGHT` 后，初始可见区域比例会变化
- 60000 / 4 = 15000，需要调整

**修复方案**：
```typescript
const INITIAL_VISIBLE_HEIGHT = 15000;  // 保持 1/4 比例
// 或者改为动态计算
const INITIAL_VISIBLE_HEIGHT = CANVAS_HEIGHT / 4;
```

---

## 2. 影响范围详细分析

### 2.1 画布高度修改影响 (40000 → 60000)

#### 2.1.1 居中定位逻辑

**影响文件**：`src/app/canvas/page.tsx`

| 功能 | 位置 | 影响说明 |
|------|------|---------|
| 图片居中定位 | 2370-2371 | `CANVAS_HEIGHT / 2` 变为 30000 |
| 分割图片居中 | 2770-2772 | 同上 |
| 镜头居中 | 2018-2023 | canvasScreenH 变大，pan 值变化 |
| 边界检测 | 2447, 2848 | 图片组底部边界限制变大 |

**结论**：✅ 影响可控，居中定位会自动适应更大的画布

#### 2.1.2 边界检测逻辑

**位置**：`src/app/canvas/page.tsx:2417, 2447, 2810, 2848`

```typescript
if (newTop + layout.totalHeight <= CANVAS_HEIGHT && !isOverlapping(targetLeft, newTop)) {...}
if (finalTop + layout.totalHeight > CANVAS_HEIGHT) finalTop = CANVAS_HEIGHT - layout.totalHeight;
```

**影响**：
- 画布高度变大后，向下偏移的空间更大
- 图片组有更多空间进行空白检测偏移
- 不会触发边界限制，反而改善了用户体验

**结论**：✅ 正面影响，更多空白空间

#### 2.1.3 镜头缩放计算

**位置**：`src/lib/canvas-image-layout.ts:251-260`

```typescript
const fitZoom = Math.min(
  (safeContainerWidth * screenRatio) / totalWidth,
  (safeContainerHeight * screenRatio) / totalHeight,
  MAX_ZOOM
);
```

**影响**：
- 镜头缩放与图片组尺寸相关，与画布尺寸无关
- 图片尺寸变大后，zoom 会变小（图片占屏幕比例不变）
- 计算公式自动适应

**结论**：✅ 自动适应，无需修改

#### 2.1.4 图片拖拽边界

**位置**：`src/app/canvas/page.tsx:6288`

```typescript
newX = Math.max(0, Math.min(CANVAS_WIDTH - el.width, newX));
```

**影响**：
- 拖拽边界变大，图片可移动范围更大
- 同步修改 `CANVAS_WIDTH` 后自动适应

**结论**：✅ 正面影响，更大操作空间

### 2.2 图片尺寸修改影响 (1000 → 1500)

#### 2.2.1 图片组总尺寸变化

**位置**：`src/lib/canvas-image-layout.ts:207-209`

```typescript
const totalWidth = Math.max(10, cols * cellWidth + (cols - 1) * gap);
const totalHeight = Math.max(10, rows * cellHeight + (rows - 1) * gap);
```

**影响**：

| 图片数量 | 当前尺寸 (1000px) | 修改后尺寸 (1500px) | 变化 |
|---------|------------------|--------------------|------|
| 1张 | 1000×1000 | 1500×1500 | +50% |
| 2张 | 2060×1000 | 3060×1500 | +50% |
| 4张 | 4180×1000 | 6180×1500 | +50% |
| 9张 | 3120×3120 | 4620×4620 | +50% |

**结论**：⚠️ 图片组变大，需要检查屏幕占比是否合理

#### 2.2.2 镜头缩放变化

**计算公式**：
```typescript
zoom = min(containerWidth * screenRatio / totalWidth, containerHeight * screenRatio / totalHeight, 1)
```

**容器假设**：1920×826

| 图片数量 | 当前 zoom | 修改后 zoom | 变化 |
|---------|----------|------------|------|
| 1张 | 0.41 | 0.28 | -32% |
| 2张 | 0.66 | 0.44 | -33% |
| 4张 | 0.38 | 0.25 | -34% |
| 9张 | 0.21 | 0.14 | -33% |

**影响**：
- zoom 变小，图片在屏幕上显示变小
- 但屏幕占比不变（50% 或 80%）
- 用户看到的是缩放后的图片，视觉效果一致

**结论**：✅ 自动适应，屏幕占比不变

#### 2.2.3 图片上传尺寸逻辑

**位置**：`src/contexts/CanvasContext.tsx:1492-1493`

```typescript
minSize = visibleMinSize / 5; // 可视区域的 1/5
maxSize = visibleMinSize / 3; // 可视区域的 1/3
```

**影响**：
- 上传图片的尺寸限制与可视区域相关
- 图片尺寸变大后，可视区域也相应变大
- 两者比例关系自动适应

**结论**：✅ 自动适应

#### 2.2.4 网格间距 (GRID_GAP)

**位置**：`src/lib/canvas-image-layout.ts:30`

```typescript
GRID_GAP: 60,
```

**影响**：
- 间距 60px 与图片尺寸 1000px 的比例是 6%
- 图片变大后，间距相对比例变小 (60/1500 = 4%)
- 图片组看起来更紧凑

**建议**：🟠 可选调整间距到 90px，保持 6% 比例

---

## 3. 潜在风险评估

### 3.1 显存与性能风险 🟠

**问题**：
- 画布尺寸变大，浏览器渲染面积增大
- Chrome 有 40000px 黑洞限制（已注释说明）

**位置**：`src/app/canvas/page.tsx:9816-9817`
```typescript
// #608 解除 40000px 黑洞封印：用 100vw/100vh + overflow:visible
// Chrome 不会为一个根本画不完的 40000px div 浪费显存
```

**评估**：
- 60000px 更大，但当前已用 `overflow:visible` 解决
- 实际渲染区域由 zoom 控制，不会超出可视区域
- **风险可控**

### 3.2 localStorage 存储风险 🟡

**问题**：
- 画布状态保存到 `localStorage`
- 尺寸变大不影响数据结构

**结论**：✅ 无风险

### 3.3 IndexedDB 缓存风险 🟡

**问题**：
- 图片缓存到 IndexedDB
- 图片尺寸变大后，单张图片占用空间增大 2.25 倍 (1500²/1000²)
- 但缓存的是 URL 或压缩后的数据，不是原始像素

**结论**：✅ 无风险

### 3.4 比例关系一致性 🟠

**当前比例关系**：
```
画布高度 / 图片最长边 = 40000 / 1000 = 40
```

**修改后比例**：
```
画布高度 / 图片最长边 = 60000 / 1500 = 40
```

**结论**：✅ 比例关系保持一致，不影响相对布局

---

## 4. 需要修改的文件清单

### 4.1 必须修改（🔴 高风险）

| 文件 | 位置 | 当前值 | 目标值 |
|------|------|--------|--------|
| `src/hooks/useCanvasCore.ts` | 40 | `CANVAS_HEIGHT = 40000` | `CANVAS_HEIGHT = 60000` |
| `src/lib/canvas-image-layout.ts` | 21 | `FIXED_MAX_SIZE: 1000` | `FIXED_MAX_SIZE: 1500` |
| `src/contexts/CanvasContext.tsx` | 1463-1464 | `CANVAS_WIDTH = 40000, CANVAS_HEIGHT = 27586` | 动态计算或同步修改 |
| `src/app/canvas/page.tsx` | 5503 | `INITIAL_VISIBLE_HEIGHT = 10000` | `INITIAL_VISIBLE_HEIGHT = 15000` |

### 4.2 建议修改（🟠 中风险）

| 文件 | 位置 | 说明 |
|------|------|------|
| `src/lib/canvas-image-layout.ts` | 30 | 可考虑 `GRID_GAP: 60 → 90`，保持间距比例 |

### 4.3 不需要修改（✅ 自动适应）

| 文件 | 说明 |
|------|------|
| 镜头缩放计算 | 自动适应图片尺寸变化 |
| 居中定位逻辑 | 自动适应画布尺寸变化 |
| 边界检测逻辑 | 自动适应，反而更宽松 |
| 网格布局逻辑 | 列数/行数计算不变 |
| 空白检测偏移 | 自动适应 |

---

## 5. 测试验证清单

修改后需要验证以下功能：

### 5.1 核心功能测试

| 测试项 | 验证方法 | 预期结果 |
|--------|---------|---------|
| 图片上传 | 上传1张图片 | 图片尺寸约1500px，居中显示 |
| 多图上传 | 上传4张图片 | 水平排列，间距合理 |
| 图片拖拽 | 拖拽图片到边界 | 能拖到画布边界 |
| 镜头缩放 | 滚轮缩放 | 缩放范围0.01~1正常 |
| 占位符生成 | 生成图片 | 尺寸1500px，进度显示正常 |

### 5.2 边缘场景测试

| 测试项 | 验证方法 | 预期结果 |
|--------|---------|---------|
| 空白检测偏移 | 多次上传图片组 | 不重叠，自动偏移 |
| 分割图片 | 分割图片添加到画布 | 网格布局正常 |
| 历史恢复 | 刷新页面恢复图片 | 尺寸恢复正确 |

### 5.3 性能测试

| 测试项 | 验证方法 | 预期结果 |
|--------|---------|---------|
| 100张图片 | 上传大量图片 | 渲染流畅，无卡顿 |
| 缩放到最小 | zoom=0.01 | 能看到整个画布 |
| 缩放到最大 | zoom=1 | 图片清晰，无变形 |

---

## 6. 修改建议总结

### 6.1 推荐修改方案

```typescript
// 1. useCanvasCore.ts
export const CANVAS_HEIGHT = 60000;  // 画布高度

// 2. canvas-image-layout.ts
export const CANVAS_IMAGE_RULES = {
  FIXED_MAX_SIZE: 1500,  // 图片最长边
  GRID_GAP: 90,          // 建议调整，保持 6% 比例
  // 其他不变
};

// 3. CanvasContext.tsx
// 建议改为动态计算或导入常量
const CANVAS_HEIGHT = 60000;  // 同步修改

// 4. page.tsx
const INITIAL_VISIBLE_HEIGHT = 15000;  // 保持 1/4 比例
```

### 6.2 修改顺序建议

1. **第一步**：修改 `useCanvasCore.ts` 的 `CANVAS_HEIGHT`
2. **第二步**：修改 `canvas-image-layout.ts` 的 `FIXED_MAX_SIZE`
3. **第三步**：同步修改 `CanvasContext.tsx` 的硬编码值
4. **第四步**：调整 `page.tsx` 的 `INITIAL_VISIBLE_HEIGHT`
5. **第五步**：可选调整 `GRID_GAP`
6. **第六步**：运行测试验证

---

## 7. 结论

### 7.1 总体评估

| 维度 | 评估 |
|------|------|
| **功能兼容性** | ✅ 良好，大部分自动适应 |
| **数据兼容性** | ✅ 良好，不影响存储结构 |
| **性能影响** | 🟠 中等，需测试验证 |
| **修改难度** | 🟠 中等，需同步修改4处代码 |

### 7.2 最终建议

**✅ 可以修改**，但需：
1. 同步修改4处核心代码
2. 可选调整网格间距
3. 完成测试验证清单

**比例关系保持一致**：
- 画布/图片比例 40:1 保持不变
- 屏幕占比 50%/80% 自动适应
- 用户体验基本不变

---

*报告生成时间：2025年*
*分析依据：`src/hooks/useCanvasCore.ts`, `src/lib/canvas-image-layout.ts`, `src/contexts/CanvasContext.tsx`, `src/app/canvas/page.tsx`*