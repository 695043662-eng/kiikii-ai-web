# Logo 新增必读文档

**每次新增模型 Logo 时，必须逐条执行以下清单！漏一条即为任务失败！**

---

## 1. 准备 Logo 文件

### 1.1 亮色版 Logo（必需）
- **格式**：PNG，带透明背景（RGBA）
- **尺寸**：150×150px（统一规格）
- **文件名**：`{model-name}-logo.png`（如 `minimax-logo.png`、`kling-logo.png`）
- **存放路径**：`public/{model-name}-logo.png`
- **颜色**：深色 Logo（黑色/深色图标），适用于浅色背景

### 1.2 暗色版 Logo（强制必需）⛔
- **必须同时提供暗色版！** 禁止只添加亮色版
- **格式**：PNG，带透明背景（RGBA）
- **尺寸**：150×150px（与亮色版一致）
- **文件名**：`{model-name}-logo-dark.png`（如 `minimax-logo-dark.png`）
- **存放路径**：`public/{model-name}-logo-dark.png`
- **颜色**：白色/浅色图标，适用于深色背景
- **生成方式**：用 Python PIL 对亮色版 RGB 通道取反
  ```python
  from PIL import Image, ImageOps
  img = Image.open('public/xxx-logo.png').convert('RGBA')
  r, g, b, a = img.split()
  dark = Image.merge('RGBA', (ImageOps.invert(r), ImageOps.invert(g), ImageOps.invert(b), a))
  dark.save('public/xxx-logo-dark.png')
  ```

### 1.3 快速批量生成暗色版
如果一次性添加多个 Logo，可用批量脚本：
```bash
cd /workspace/projects && python3 -c "
from PIL import Image, ImageOps
import os
for f in os.listdir('public'):
  if f.endswith('-logo.png') and not f.endswith('-dark.png'):
    dark = f.replace('-logo.png', '-logo-dark.png')
    if not os.path.exists(f'public/{dark}'):
      img = Image.open(f'public/{f}').convert('RGBA')
      r, g, b, a = img.split()
      Image.merge('RGBA', (ImageOps.invert(r), ImageOps.invert(g), ImageOps.invert(b), a)).save(f'public/{dark}')
      print(f'Created: {dark}')
"
```

---

## 2. 注册到中心化映射（model-utils.ts）⛔

**文件**：`src/lib/model-utils.ts`

### 2.1 getFamily() 方法
确保新模型的 family 能被正确识别（属于 Layer 7.1，通常已完成）

### 2.2 getLogoFilename() 方法
在 `switch (family)` 中添加新模型的 logo 映射：
```typescript
case 'topais-xxx':
  return '/xxx-logo.png';
```

### 2.3 getDarkLogoFilename() 方法
**无需手动修改**，自动从亮色版文件名派生：
```typescript
static getDarkLogoFilename(modelId: string): string {
  const lightLogo = this.getLogoFilename(modelId);
  return lightLogo.replace('-logo.png', '-logo-dark.png');
}
```
⚠️ 但必须确保对应的 `-logo-dark.png` 文件已存在于 `public/` 目录！

### 2.4 isDarkLogo() 方法
如果新 Logo 是浅色的（如 banana），需要在此方法中返回 `false`：
```typescript
static isDarkLogo(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (id.includes('banana')) return false;  // 浅色 logo 不需要反转
  return true;  // 默认所有 logo 都是深色的
}
```

---

## 3. 更新四端 Logo 映射（必须全部修改！）⛔

**漏一个就是 BUG！** 以下 4 个文件各有独立的 logo 映射函数，必须全部更新：

| 序号 | 文件 | 函数名 | 映射方式 |
|------|------|--------|----------|
| 1 | `src/lib/model-utils.ts` | `ModelDetector.getLogoFilename()` | switch/family |
| 2 | `src/app/video/page.tsx` | `getModelLogoForVideoPage()` | if/family |
| 3 | `src/components/GeneratePanelNode.tsx` | `getModelLogo()` | if/family |
| 4 | `src/components/temp_RightPanel.tsx` | `dialogGetModelLogo()` | if/family |

### 额外需要检查的文件

| 文件 | 位置说明 |
|------|----------|
| `src/app/generate/page.tsx` | 内联 logo IIFE（两处），需在三元表达式中添加新模型判断 |
| `src/components/temp_RightPanel.tsx` | 模型选择弹窗内联 logo（第3处），需在三元表达式中添加 |

### 添加规则
每个映射函数中，新模型判断应放在通用判断（如 `includes('veo')`）之前，避免被错误匹配：
```typescript
// ✅ 正确：minimax 在通用 veo 判断之前
if (family === 'topais-minimax') return '/minimax-logo.png';
if (id.includes('veo')) return '/veo-logo.png';

// ❌ 错误：minimax 被通用判断覆盖（如果 minimax modelId 含 veo 的话）
if (id.includes('veo')) return '/veo-logo.png';
if (family === 'topais-minimax') return '/minimax-logo.png';  // 永远不会执行！
```

---

## 4. 暗色模式适配（强制）⛔

### 4.1 三种暗色模式实现方式

| 页面/组件 | 实现方式 | 代码示例 |
|-----------|----------|----------|
| video/page.tsx | CSS 类 | `className={... + (needWhiteLogo ? 'dark:brightness-0 dark:invert' : '')}` |
| generate/page.tsx | CSS 类 | `className={... + (needWhiteLogo ? 'dark:brightness-0 dark:invert' : '')}` |
| temp_RightPanel.tsx | CSS 类 | `className={... + (needWhiteLogo ? 'dark:brightness-0 dark:invert' : '')}` |
| GeneratePanelNode.tsx | inline style | `style={{..., filter: isDarkLogo(id) ? 'brightness(0) invert(1)' : 'none'}}` |

### 4.2 统一使用 ModelDetector.isDarkLogo()

**所有页面必须使用中心化的 `ModelDetector.isDarkLogo()` 判断**，禁止各自硬编码：
```typescript
// ✅ 正确
const needWhiteLogo = ModelDetector.isDarkLogo(modelId);

// ❌ 错误：硬编码判断逻辑
const needWhiteLogo = !isNanoBananaModel && !isSeedanceModel;
```

### 4.3 工作原理
- `dark:brightness-0 dark:invert`：Tailwind 暗色模式类，将深色 logo 反转为白色
- `filter: brightness(0) invert(1)`：CSS 内联等价写法
- 两者效果一致，只是写法不同

---

## 5. 预加载 Logo（GeneratePanelNode.tsx）

在 `GeneratePanelNode.tsx` 顶部的预加载块中添加新 logo 常量：
```typescript
const XXX_LOGO = '/xxx-logo.png';

// 预加载列表中添加
const preloadImages = [..., XXX_LOGO];
```

同样在 `temp_RightPanel.tsx` 顶部添加常量：
```typescript
const DIALOG_XXX_LOGO = '/xxx-logo.png';
```

---

## 6. 验证清单

每次新增 Logo 后，必须逐项验证：

| 序号 | 验证项 | 验证方法 |
|------|--------|----------|
| 1 | 亮色版文件存在 | `ls public/xxx-logo.png` |
| 2 | 暗色版文件存在 | `ls public/xxx-logo-dark.png` |
| 3 | model-utils.ts 映射正确 | 代码审查 switch 分支 |
| 4 | video/page.tsx 映射正确 | 切换到该模型检查 Logo |
| 5 | GeneratePanelNode.tsx 映射正确 | 画布面板检查 Logo |
| 6 | temp_RightPanel.tsx 映射正确 | 对话框检查 Logo |
| 7 | generate/page.tsx 映射正确 | 生图页面检查 Logo |
| 8 | 暗色模式显示正确 | 切换暗色模式检查 Logo 是否变白 |
| 9 | TypeScript 检查通过 | `pnpm ts-check` |
| 10 | 服务正常 | `curl -I http://localhost:5000` |

---

## 7. 常见错误（血泪教训）

| 错误 | 后果 | 修复 |
|------|------|------|
| 只添加亮色版 Logo | 暗色模式下 Logo 不可见 | 必须同时添加暗色版 |
| MiniMax/Kling 归入 seedance family | 显示错误的 Seedance Logo | 每个模型族必须有独立判断 |
| `needWhiteLogo` 硬编码 `!isBanana` | 新模型暗色模式不生效 | 统一使用 `ModelDetector.isDarkLogo()` |
| video/page.tsx `isSeedanceModelLogo` 包含 `topais-minimax` | MiniMax 显示 Seedance Logo | 每个 family 独立判断 |
| 四端只改了三端 | 某个页面显示默认 Logo | 必须检查全部 4+2 个文件 |
| Logo 文件名不一致 | 映射找不到文件 | 统一使用 `{model-name}-logo.png` 命名 |

---

## 8. 当前 Logo 清单

| Logo 文件名 | 对应模型族 | 暗色版 |
|-------------|-----------|--------|
| `/banana-logo.png` | banana 系列 | ✅ `/banana-logo-dark.png` |
| `/gpt-image-2-logo.png` | GPT-5, GPT Image 2, Sora | ✅ `/gpt-image-2-logo-dark.png` |
| `/seedance-logo.png` | seedance2, t8seedance, topais-seedance, topais-seedance-2-5, mega-ai-seedance | ✅ `/seedance-logo-dark.png` |
| `/veo-logo.png` | veo, topais(Veo), lingya-veo, gemini(LLM) | ✅ `/veo-logo-dark.png` |
| `/gemini-logo.png` | topais-gemini-omni | ✅ `/gemini-logo-dark.png` |
| `/happyhorse-logo.png` | happyhorse, topais-happyhorse | ✅ `/happyhorse-logo-dark.png` |
| `/minimax-logo.png` | topais-minimax | ✅ `/minimax-logo-dark.png` |
| `/kling-logo.png` | topais-kling-omni | ✅ `/kling-logo-dark.png` |
| `/logo-main.png` | 默认兜底 | ✅ `/logo-main-dark.png` |
