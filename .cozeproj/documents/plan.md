# 面板扑克牌效果实现计划

## 概述
面板生成多张图片时，在面板内部以扑克牌堆叠效果展示，复用 InteractiveImageStackNode 的视觉设计。

## 技术方案

| 维度 | 选择 | 理由 |
|------|------|------|
| 视觉复用 | 复用 STACK_OFFSETS 配置 | 保持一致性，无需重新设计 |
| 实现方式 | 内联 JSX | 面板内部渲染，不需要独立组件 |
| 交互 | 暂不支持展开/收起 | 简化实现，后续可扩展 |

## 功能模块

### 扑克牌堆叠渲染
- 首图：zIndex 最高，无偏移
- 背景图：后 3 张图片，有偏移和旋转
- 配置：`STACK_OFFSETS = [{ x: 0, y: 0, rotate: 0 }, { x: 8, y: 4, rotate: -2 }, ...]`

### 面板内部 JSX
```tsx
// 扑克牌堆叠效果
<div className="relative" style={{ width: '100%', height: '100%' }}>
  {/* 背景图片（层叠效果） */}
  {imageUrls.length > 1 && imageUrls.slice(1, 4).map((url, i) => (
    <div
      key={i}
      className="absolute rounded-lg overflow-hidden"
      style={{
        width: '90%',
        height: '90%',
        left: STACK_OFFSETS[i + 1]?.x || 0,
        top: STACK_OFFSETS[i + 1]?.y || 0,
        transform: `rotate(${STACK_OFFSETS[i + 1]?.rotate || 0}deg)`,
        zIndex: 10 - i,
        opacity: 0.7,
      }}
    >
      <img src={url} className="w-full h-full object-cover" />
    </div>
  ))}
  
  {/* 首图 */}
  <div className="absolute rounded-lg overflow-hidden" style={{ zIndex: 20 }}>
    <img src={imageUrls[0]} className="w-full h-full object-cover" />
  </div>
</div>
```

## 是否有原型设计
否

## 实施步骤

1. **添加扑克牌偏移配置** - 在 GeneratePanelNode.tsx 顶部添加 STACK_OFFSETS 常量
2. **修改面板内部图片渲染** - 替换单张图片显示为扑克牌堆叠效果

## 涉及文件
- `src/components/GeneratePanelNode.tsx`
