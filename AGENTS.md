# Canvas 画布编辑器

---

## 🛡️🛡️🛡️ 最高架构军规（第一位 - 必须遵守）🛡️🛡️🛡️

**无论执行任何开发任务，必须严格遵守以下五大原则。违背任何一条即视为任务失败！**

### 1. 架构封层原则（Architecture Frozen）

- **现状即真理**：当前项目的核心结构（如 9600 行的 page.tsx、现有的 Context 状态树）是**【已封层的战时底座】**。
- **禁止自作主张**：严禁以"代码整洁"、"解耦"或"文件过大"为由，私自重构、拆分或移动核心逻辑块。所有的开发必须顺着现有的 Ref 链条和 State 体系向下延伸，而不是另起炉灶。

### 2. 视觉刚性原则（Rigid UI & DOM Hierarchy）

- **层级不可逆**：严格遵守 **外层绝对定位 (爷爷) -> 内层填满 (爸爸) -> 核心交互 (孙子)** 的 DOM 嵌套模型。
- **响应式红线**：所有针对画布、侧边栏的修改，必须保留类似 `right: isChatCollapsed ? '0px' : '350px'` 的动态呼吸逻辑。严禁私自引入导致画布缩水、出现白边或溢出的无用 Padding/Margin。

### 3. 2C2G 服务器求生法则（Extreme Performance & Defense）

- **绝对防御**：目标服务器为脆弱的 **2核2G** 环境。前端必须承担防御职责。
- **禁止并发轰炸**：任何向后端发起的请求，必须包裹在请求锁（如 `RequestLock`）中，坚决杜绝因用户连击导致后端 OOM。
- **本地榨干**：所有的图片压缩、Base64 转换、MD5 计算必须在前端完成，且必须使用 `Promise.all` 并行处理，严禁串行阻塞和重复读取。

### 4. 状态纯洁原则（State Purity）

- **单一数据源**：以 React Context 或顶层 State 为准，坚决抵制搞两套账本（如混用 sessionStorage 和内存状态）。
- **结构化数据**：严禁使用"字符串拼接"（如 `id|uuid|index`）来传递复合状态。状态必须是干净的 Object，通过精准的 map 遍历进行原地替换更新。

### 5. 施工验证原则（Step-by-Step Verification）

- **拒绝"脑补"**：禁止一次性吐出几百行未经验证的代码。必须按 Phase（阶段）施工。
- **日志先行**：关键的生命周期、网络请求和状态流转，必须伴随 `console.log` 诊断日志输出。
- **先做壳再接电**：UI 任务必须先用占位符验证 CSS 布局（严丝合缝），再接入真实数据和网络通信。

### 6. 沙盒隔离原则（Sandbox Isolation）⚠️ #235 血泪教训

- **禁止使用 exec_sql 工具**：`exec_sql` 工具默认连接**沙盒数据库**，返回的数据**不是用户真实数据**。
- **查询真实数据库**：必须使用 Node.js 脚本，通过 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 直接连接用户真实数据库。
- **禁止沙盒配置**：项目中不允许存在任何沙盒数据库的 URL、Key 或连接字符串。
- **诊断方法**：
  ```bash
  # ✅ 正确：使用 Node.js 脚本查询真实数据库
  node -e "
  const { getSupabaseClient } = await import('./src/storage/database/supabase-client.ts');
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('users').select('*');
  console.log(JSON.stringify(data, null, 2));
  "
  
  # ❌ 错误：使用 exec_sql 工具（连接沙盒数据库）
  exec_sql({ sql: "SELECT * FROM users" })
  ```

---

## ⛔⛔⛔ 最高准则 - 维修记录手册（第二位 CRITICAL）⛔⛔⛔

**每次维修任务开始前，必须完整阅读维修记录手册！**

### 手册位置
- 文件路径: `MAINTENANCE_HANDBOOK.md`

### 核心原则

| 序号 | 原则 | 说明 |
|------|------|------|
| 1 | **先读手册，再动手** | 每次维修任务开始前，必须完整阅读手册 |
| 2 | **记录每次维修** | 所有重要维修必须记录到手册 |
| 3 | **不重复踩坑** | 遇到类似问题，先查手册是否有解决方案 |

### 重要维修记录摘要

| 编号 | 问题类型 | 关键词 | 位置 |
|------|----------|--------|------|
| #001 | 多任务占位符不更新 | imageItems 初始化 | ✅ 已修复 |
| #002 | 任务失败占位符不更新 | SSE failed 状态 | ✅ 已修复 |
| #003 | 占位符超出画布边界 | 边界检查 | ✅ 已修复 |
| #004 | 占位符样式问题 | 彩色渐变 | ✅ 已修复 |
| #005 | 连续任务占位符重叠 | placeholderPositionsRef | ✅ 已修复 |
| #006 | 页面刷新图片丢失 | imageKey 字段映射 | ✅ 已修复 |
| #007 | 首次生成占位符溢出 | 边界检查 Math.max | ✅ 已修复 |
| #008 | 画布位置不恢复 | zoom/pan 持久化 | ✅ 已修复 |
| #009 | 图片恢复慢 | 并行恢复 COS 图片 | ✅ 已修复 |
| #010 | 图片不居中显示 | 居中偏移计算 | ✅ 已修复 |
| #011 | 图片恢复失败无重试 | isLoading 重试机制 | ✅ 已修复 |
| #012 | 图片加载无样式 | 透明波动效果 | ✅ 已修复 |
| #062 | F5刷新占位符变"失败" | 超防御巡逻3次确认 | ✅ 已修复 |
| #063 | undici Agent导致fetch炸裂 | 删undici Agent，用原生https | ✅ 已修复 |
| #064 | 生产环境不返图 | undici超时+webhook localhost+https模块替代 | ✅ 已修复 |
| #065 | 多任务刷新只返一张图 | pollingTimers键覆盖 actualTaskId→actualTaskId_index | ✅ 已修复 |
| #066 | 积分扣费逻辑问题 | fetch→直接DB+部分失败退还 | ✅ 已修复 |
| #069 | 管理后台操作刷新整页 | useEffect([])+initialLoaded+乐观更新 | ✅ 已修复 |
| #070 | 积分双重扣费 | 去掉后端deductCredits，只保留checkCreditsSufficient | ✅ 已修复 |
| #071 | 占位符超出可视区域 | 居中定位改用viewCenterX而非actualCanvasWidth | ✅ 已修复 |
| #072 | 占位符zoom偏差 | 屏幕像素→画布坐标转换 | ✅ 已修复 |
| #073 | 智能分割展示硬编码 | 改用gridSplitImages动态渲染 | ✅ 已修复 |
| #078 | 画布页面积分返还规则不一致 | SSE事件读取creditsBalance+updateCredits辅助函数 | ✅ 已修复 |
| #093 | 刷新后占位符无generationTaskId | 前端预生成taskId+创建时设置 | ✅ 已修复 |
| #094 | taskId高并发碰撞风险 | Date.now()→crypto.randomUUID() | ✅ 已修复 |
| #095 | 轮询遇failed不熔断+useEffect依赖崩溃 | 立即停止轮询+join(',')转字符串 | ✅ 已修复 |
| #096 | SSR撕裂+幽灵任务死锁 | dynamic import ssr:false | ✅ 已修复 |
| #101 | 轮询误杀正常任务+LayerPanel SSR撕裂 | 删除死胎检测+isMounted状态锁 | ✅ 已修复 |
| #102 | 幽灵任务检测误杀健康任务 | 健康状态检测+收紧幽灵判定条件 | ✅ 已修复 |
| #103 | 轮询无法返图+DDoS攻击服务器+React生命周期陷阱 | 子任务判断+请求合并+全局作用域Map | ✅ 已修复 |
| #206 | 画布生成记录缺失+imageKeys为空 | 后端complete事件从imageItems提取URL/key | ✅ 已修复 |
| #207 | 终端返回成功但没有图片导致静默丢失 | 添加诊断日志+空结果触发item_failed事件 | ✅ 已修复 |
| #219 | 占位符大小循环放大 | 常数锚点法，不依赖zoom | ✅ 已修复 |
| #221 | React闭包陷阱导致占位符不消失+图片重复 | 方案C双保险: stateRef + placeholderPositionsRef兜底 | ✅ 已修复 |
| #222 | 参考图刷新后缩略图消失 | chatImageMd5ToIdxRef记录索引避免闭包陷阱 | ✅ 已修复 |
| #223 | 同一历史记录生成两次 | 移除画布页面多余的AIGeneratorProvider | ✅ 已修复 |
| #233 | 参考图发送失败（数组变字符串） | replaceTemplateVariables修复 | ✅ 已修复 |
| #234 | 历史记录缺失积分扣除数值 | GET方法添加积分字段 | ✅ 已修复 |
| #235 | 参考图发送失败（旧架构） | 旧架构添加referenceImages字段 | ✅ 已修复 |
| #253 | 字段名不一致导致参考图不显示 | referenceImages→reference_images（与数据库一致） | ✅ 已修复 |
| #254 | 轮询返回空 imageUrls 导致历史记录不保存 | GET API 从 imageItems 提取实际 URL | ✅ 已修复 |
| #255 | 再次生成覆盖左侧操作容器 | 方案A：删除替换左侧State的逻辑，保护用户输入 | ✅ 已修复 |
| #256 | 违规显示"生成失败"而非"内容违规" | 定时检查从imageItems提取错误信息，支持特定错误类型 | ✅ 已修复 |
| #257 | 发送到画布无图片 | addSingleImageToCanvas 添加 img.src = imgUrl | ✅ 已修复 |
| #258 | 占位符比例不一致（1:1变3:4填灰） | onComplete 调用 updatePlaceholder 复用尺寸计算 | ✅ 已修复 |
| #259 | 展示/启用按钮失效 | 废除 hidden-models.json，全线回归数据库管理 | ✅ 已修复 |
| #297 | 数据库配置被错误覆盖 | 全量恢复api_configs和api_models，新增gpt-image-2 | ✅ 已修复 |

### #001 关键案例（必读）

**问题**：终端生成了多张图片，画布只显示一组

**根因**：后端初始化任务缓存时未初始化 `imageItems` 数组

**修复**：
```typescript
// 必须初始化 imageItems（与 webhook 逻辑一致）
imageItems: Array.from({ length: generationCount }, (_, idx) => ({
  index: idx,
  url: null,
  key: null,
  status: 'generating' as const,
  error: null,
})),
```

**⚠️ 重要**：任何涉及任务缓存的修改，都必须确保 `imageItems` 同步初始化！

---

## 项目概览---

## ⛔⛔⛔ 最高准则 - 维修记录手册（第一位 CRITICAL）⛔⛔⛔

**每次维修任务开始前，必须完整阅读维修记录手册！**

### 手册位置
- 文件路径: `MAINTENANCE_HANDBOOK.md`（项目根目录）

### 核心原则

| 序号 | 原则 | 说明 |
|------|------|------|
| 1 | **先读手册，再动手** | 每次维修任务开始前，必须完整阅读手册 |
| 2 | **记录每次维修** | 所有重要维修必须记录到手册 |
| 3 | **不重复踩坑** | 遇到类似问题，先查手册是否有解决方案 |

### 重要维修记录摘要

| 编号 | 问题类型 | 关键词 | 位置 |
|------|----------|--------|------|
| #001 | 多任务占位符不更新 | **imageItems 初始化** | `route.ts:543` |
| #002 | 任务失败占位符不更新 | SSE failed 状态 | `route.ts` SSE循环 |
| #003 | 占位符超出画布边界 | 边界检查 | `page.tsx` createPlaceholders |
| #004 | 占位符样式问题 | 彩色渐变 | `page.tsx:8045` |

### #001 关键案例（必读）

**问题**：终端生成了多张图片，画布只显示一组

**根因**：`setTaskResult` 初始化时缺少 `imageItems` 数组

**修复**：
```typescript
// 必须初始化 imageItems（与 webhook 逻辑一致）
imageItems: Array.from({ length: generationCount }, (_, idx) => ({
  index: idx,
  url: null,
  key: null,
  status: 'generating' as const,
  error: null,
})),
```

**⚠️ 重要**：任何涉及任务缓存的修改，都必须确保 `imageItems` 同步初始化！

---

## 项目概览
- **技术栈**: Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui
- **功能**: AI图像/视频生成平台，包含画布编辑、图片生成、视频生成、管理后台功能
- **代码规模**: page.tsx ~10764行（已拆分 ~1509行到 RightPanel，~397行到 AIGeneratorContext）

## 文件结构
```
src/
├── app/
│   ├── canvas/page.tsx              # 主画布组件（核心逻辑）
│   ├── admin/packages/page.tsx      # 管理后台-充值套餐管理
│   ├── records/page.tsx             # 个人中心-充值页面
│   └── api/
│       ├── admin/packages/route.ts  # 充值套餐管理API（管理员）
│       └── packages/route.ts        # 充值套餐获取API（公开）
├── components/
│   ├── temp_RightPanel.tsx          # 右侧面板（1509行，已使用 Context）
│   ├── temp_TopBar.tsx              # 顶部栏（183行）
│   └── temp_LeftSideBar.tsx         # 左侧工具栏（189行）
├── contexts/
│   ├── CanvasContext.tsx            # 画布状态管理（元素、工具、视图）
│   └── AIGeneratorContext.tsx       # AI生成器状态（397行，含 handleGenerate）
├── hooks/
│   ├── useCanvasCore.ts             # 画布核心 Hook（669行）
│   └── useGenService.ts              # 统一生成服务（740行，含占位符支持）
├── lib/
│   ├── canvas-image-layout.ts       # 图片布局工具（统一尺寸规则、网格布局）
│   ├── canvas-image-db.ts           # 画布图片 IndexedDB 存储
│   ├── cos.ts                       # 对象存储工具
│   ├── credits.ts                   # 积分工具
│   └── ...                          # 其他工具文件
└── types/canvas.ts                  # 类型定义
```

## 统一生成引擎 (useGenService)

### 核心特性
- **SSE 流式处理**：实时接收生成进度和图片
- **智能轮询**：100次 × 3秒 = 300秒兜底
- **占位符支持**：坐标锁定、原位替换、失败展示态

### API
```typescript
const { generate, abortRequest, stopPolling } = useGenService();

await generate({
  prompt,
  model,
  resolution,
  aspectRatio,
  generationCount,
  images,
  isUrls,
  onBeforeGenerate: (count, prompt) => PlaceholderInfo[],
  onImageReceived: (data) => { placeholderId, url, ... },
  onPlaceholderFailed: (elementId, error) => { /* 更新失败状态 */ },
  onComplete: (result) => { imageUrls, creditsBalance, ... },
  onError: (error) => { /* 处理错误 */ },
});
```

## AIGeneratorContext

### 提供的 API
```typescript
const {
  // 状态
  selectedModel, selectedRatio, selectedResolution, ...,
  credits, userId, isLoggedIn,
  
  // 生成服务
  handleGenerate,      // 统一生成入口
  abortGenerate,       // 中断生成
  isGenerating,        // 生成状态
  
  // 参考图
  chatImageBase64s, chatImageUrls, chatImageMd5s,
  clearAllImages,
  
  // 收藏夹
  favorites, setFavorites,
  
  // 对话
  messages, setMessages,
  inputValue, setInputValue,
  
  // 对话框
  infoDialog, setInfoDialog,
  showCopyToast, setShowCopyToast,
  previewImage, setPreviewImage,
} = useAIGenerator();
```

### 使用示例
```typescript
// 通用生图
await handleGenerate({
  prompt: '一只可爱的猫',
  model: selectedModel,
  resolution: selectedResolution,
  aspectRatio: selectedAspectRatio,
  generationCount: selectedCount,
});

// 画布生图（带占位符）
await handleGenerate({
  prompt,
  model,
  resolution,
  aspectRatio,
  generationCount,
  onBeforeGenerate: createPlaceholdersWithClientIds,
  onImageReceived: updatePlaceholder,
  onPlaceholderFailed: markPlaceholderFailed,
});
```

---

## 管理后台

### 访问地址
- 管理后台: `/linjiaqi`
- 管理员手机号: `13824085362`

### 充值套餐管理功能
- 位置: 管理后台 → "充值套餐" Tab
- 查看所有套餐列表
- 添加新套餐
- 编辑现有套餐（名称、价格、积分、标签、节省金额、排序、状态）
- 删除套餐
- 实时预览前端效果
- 数据实时同步到前端充值页面

### 充值套餐数据结构
```typescript
interface RechargePackage {
  id: number;
  name: string;          // 套餐名称
  price: number;         // 价格（分）
  credits: number;       // 积分数量
  tag: string | null;    // 标签（如"推荐"）
  savings: number | null; // 节省金额（分）
  sort_order: number;    // 排序顺序
  is_active: boolean;    // 是否启用
  created_at: string;
  updated_at: string | null;
}
```

### API 接口
| 接口 | 方法 | 说明 | 权限 |
|------|------|------|------|
| `/api/packages` | GET | 获取启用的套餐列表 | 公开 |
| `/api/admin/packages` | GET | 获取所有套餐 | 管理员 |
| `/api/admin/packages` | POST | 创建新套餐 | 管理员 |
| `/api/admin/packages` | PUT | 更新套餐 | 管理员 |
| `/api/admin/packages` | DELETE | 删除套餐 | 管理员 |

---

## ⛔⛔⛔ 最高准则 - 维修记录手册（第一位 CRITICAL）⛔⛔⛔

**每次维修任务开始前，必须完整阅读维修记录手册！**

### 手册位置
- 文件路径: `/workspace/projects/MAINTENANCE_HANDBOOK.md`

### 核心原则

| 序号 | 原则 | 说明 |
|------|------|------|
| 1 | **先读手册，再动手** | 每次维修任务开始前，必须完整阅读手册 |
| 2 | **记录每次维修** | 所有重要维修必须记录到手册 |
| 3 | **不重复踩坑** | 遇到类似问题，先查手册是否有解决方案 |

### 重要维修记录摘要

| 编号 | 问题类型 | 关键词 | 位置 |
|------|----------|--------|------|
| #001 | 多任务占位符不更新 | **imageItems 初始化** | `route.ts:543` |
| #002 | 任务失败占位符不更新 | SSE failed 状态 | `route.ts` SSE循环 |
| #003 | 占位符超出画布边界 | 边界检查 | `page.tsx` createPlaceholders |
| #004 | 占位符样式问题 | 彩色渐变 | `page.tsx:8045` |

### #001 关键案例（必读）

**问题**：终端生成了多张图片，画布只显示一组

**根因**：`setTaskResult` 初始化时缺少 `imageItems` 数组

**修复**：
```typescript
// 必须初始化 imageItems（与 webhook 逻辑一致）
imageItems: Array.from({ length: generationCount }, (_, idx) => ({
  index: idx,
  url: null,
  key: null,
  status: 'generating' as const,
  error: null,
})),
```

**⚠️ 重要**：任何涉及任务缓存的修改，都必须确保 `imageItems` 同步初始化！

---

## ⛔⛔⛔ 最高准则 - 画布开发铁律（CRITICAL）⛔⛔⛔

**AI生图网站 + Lovart 同款画布组件开发，硬性铁规，违反一次都不行！**

### 七条铁律

| 序号 | 铁律 | 说明 |
|------|------|------|
| 1 | **画布核心壳子严禁改写** | Canvas 初始化、宽高、坐标体系、图层容器，永久不动 |
| 2 | **选区框/蒙版必须用固定坐标** | 必须用固定 rect 坐标 (x1,y1,x2,y2)，不许瞎写相对位置 |
| 3 | **拖拽/缩放/圈选用原生监听** | 只写原生标准监听，不许自创奇葩 DOM 结构 |
| 4 | **新增功能只能外挂扩展** | 不能动原有画布底层渲染逻辑 |
| 5 | **看不懂必须问用户** | 不确定坐标/图层关系，直接问，禁止脑补瞎编代码 |
| 6 | **代码必须分四块** | 底层画布 + 选区组件 + 图层管理 + 局部重绘，不乱揉 |
| 7 | **严禁自作主张** | 禁止简化代码、删关键监听、改宽高默认值、乱改像素比例 |

### 三个固定壳子（只能填空，不能动壳）

| 壳子 | 内容 | 锁定项 |
|------|------|--------|
| **底层画布壳** | 固定宽高、分辨率、渲染层级 | 永久不动 |
| **选区框壳** | 固定 rect 四坐标，拖拽逻辑锁死 | 只改样式颜色 |
| **生图蒙版壳** | 局部重绘、扩图、inpaint 逻辑固定 | 只加按钮，不改底层 |

### 正确指令模板

```plaintext
只在原有固定画布框架上新增功能：
需求：xxx（比如：加右侧图层面板/加自由圈选/加局部重绘蒙版）
约束：不许改 Canvas 初始化、不许改整体宽高、不许动原有选区核心代码，只新增外挂模块。
```

### ⛔ 禁止说的话（一说必崩）

| 禁止指令 | 后果 |
|----------|------|
| 「你帮我整体优化一下画布」 | 必把能用的结构全拆烂 |
| 「你重新写一版更好的画布」 | 必把能用的结构全拆烂 |
| 「简化一下画布代码」 | 必把能用的结构全拆烂 |

### 违规后果
- 代码回滚
- 重新执行任务
- 画布功能崩溃
- 用户极度不满

---

## ⛔⛔⛔ 最高准则 - 禁用 read_image 工具（CRITICAL）⛔⛔⛔

**禁止使用 `read_image` 工具！统一使用后端 API 调用 LLM Vision 模型！**

### 规则
1. **⛔ 禁止使用 read_image**：这个工具识别质量差，禁止使用
2. **✅ 使用 LLM Vision 模型**：通过后端 API 调用 `doubao-seed-1-6-vision-250815` 模型
3. **✅ 使用 advanced-image-recognition Skill 方法论**：按照 Skill 的分层识别策略分析图片

### 正确流程
1. 加载 `/skills/user/advanced-image-recognition` Skill（获取方法论）
2. 加载 `/skills/public/prod/llm` Skill（获取 API 调用方式）
3. 通过后端 API 调用 LLM Vision 模型识别图片
4. 按照 Skill 的分层识别策略（宏观→中观→微观）输出结果

### 示例
- ❌ 错误：使用 `read_image` 工具
- ✅ 正确：加载 Skill，调用后端 API，使用 LLM Vision 模型识别

### 违规后果
- 识别质量差
- 用户极度不满

---

## ⛔⛔⛔ 最高准则 - 严格限制修改范围（CRITICAL）⛔⛔⛔

**绝对禁止擅自修改用户未指定的代码！**

### 规则
1. **只修改用户明确指定的内容**：用户说什么就改什么，不多改一行代码
2. **禁止连带修改**：即使用户指定的修改"看起来"与其他代码相似，也绝对不能一并修改
3. **禁止优化、重构、清理**：除非用户明确要求，否则不做任何额外修改
4. **禁止"顺便"修改**：看到类似问题不报告、不修改，只处理用户指定的

### 示例
- ❌ 错误：用户说"修复文字工具栏"，我却同时修改了图片工具栏、组工具栏
- ✅ 正确：用户说"修复文字工具栏"，我只修改文字工具栏相关代码

### 违规后果
- 代码回滚
- 重新执行任务
- 浪费时间

---

## ⚠️ 核心规则 - 真人模拟验证（CRITICAL）

**每次任务完成前必须进行真人模拟验证！必须真人模拟验证！**

### 验证清单（每项都必须执行）

| 序号 | 验证项 | 命令/方法 |
|------|--------|-----------|
| 1 | 类型检查 | `npx tsc --noEmit` |
| 2 | 服务存活 | `curl -I http://localhost:5000` |
| 3 | 页面加载 | `curl -s http://localhost:5000/页面路径` |
| 4 | 日志检查 | `tail -n 50 /app/work/logs/bypass/app.log` |
| 5 | 控制台检查 | `tail -n 50 /app/work/logs/bypass/console.log` |
| 6 | 代码逻辑审查 | 读取修改的文件，逐行检查逻辑 |
| 7 | 事件流程验证 | 梳理用户操作流程，确认每个步骤 |
| 8 | 边界条件检查 | 检查异常情况处理 |
| 9 | API接口测试 | 如有API，使用curl测试 |
| 10 | 最终确认 | 输出验证结果表格 |

### 验证报告格式

每次验证必须输出：
```
## 真人模拟验证结果

| 验证项 | 结果 | 说明 |
|--------|------|------|
| 类型检查 | ✅/❌ | 具体说明 |
| 服务运行 | ✅/❌ | 具体说明 |
| 页面加载 | ✅/❌ | 具体说明 |
| 代码逻辑 | ✅/❌ | 具体说明 |
| ... | ... | ... |
```

### 重要提醒
- **禁止跳过任何验证项**
- **禁止在验证完成前调用 done 工具**
- **验证失败必须修复后重新验证**
- **每次修复后重新执行完整验证流程**

---

## 图片上传空白检测偏移（已锁定 - 禁止修改）

**状态**：✅ 已验证可用，2025年修复并确认
**位置**：src/app/canvas/page.tsx `handleFileImport` 函数

### 核心逻辑（100%保留，禁止改动）

```javascript
// ====== 计算水平排列布局（原有逻辑，100%保留）======
const GAP = 100;
const imgPositions: number[] = [];
let posX = 0;
for (let i = 0; i < scaledInfos.length; i++) {
  imgPositions.push(posX);
  posX += scaledInfos[i].scaledWidth + GAP;
}
const totalWidth = posX - GAP;
const groupHeight = Math.max(...scaledInfos.map(i => i.scaledHeight));

// ====== 计算水平居中的目标坐标（原有逻辑）======
const screenCenterX = viewportInfo.containerWidth / 2;
const screenCenterY = viewportInfo.containerHeight / 2;
const canvasCenterX = (screenCenterX - viewportInfo.panX) / viewportInfo.zoom;
const canvasCenterY = (screenCenterY - viewportInfo.panY) / viewportInfo.zoom;

// 原居中位置
const targetLeft = canvasCenterX - totalWidth / 2;
const targetTop = canvasCenterY - groupHeight / 2;

// ====== 新增逻辑：空白检测偏移（已锁定）======
// 获取画布上现有的图片元素（统一转换为画布坐标）
const existingImages: { left: number; top: number; right: number; bottom: number }[] = [];
canvas.state.elements
  .filter(el => el.type === 'image')
  .forEach(el => {
    existingImages.push({
      left: el.x,
      top: el.y,
      right: el.x + el.width,
      bottom: el.y + el.height,
    });
  });

// 检测图片组是否与现有图片重叠
const isOverlapping = (groupLeft: number, groupTop: number): boolean => {
  const groupRight = groupLeft + totalWidth;
  const groupBottom = groupTop + groupHeight;
  
  for (const img of existingImages) {
    const overlaps = !(groupRight <= img.left || 
                     groupLeft >= img.right || 
                     groupBottom <= img.top || 
                     groupTop >= img.bottom);
    if (overlaps) {
      return true;
    }
  }
  return false;
};

// 确定最终位置
let finalLeft = targetLeft;
let finalTop = targetTop;

// 检测原居中位置是否被占用
if (isOverlapping(targetLeft, targetTop)) {
  // 更大的偏移量范围
  const offsets = [50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000];
  
  let foundSpace = false;
  
  // 第1优先级：向上偏移（保持水平居中）
  for (const offset of offsets) {
    const newTop = targetTop - offset;
    if (newTop >= 0 && !isOverlapping(targetLeft, newTop)) {
      finalLeft = targetLeft;
      finalTop = newTop;
      foundSpace = true;
      break;
    }
  }
  
  // 第2优先级：向下偏移（保持水平居中）
  if (!foundSpace) {
    for (const offset of offsets) {
      const newTop = targetTop + offset;
      const groupBottom = newTop + groupHeight;
      if (groupBottom <= CANVAS_HEIGHT && !isOverlapping(targetLeft, newTop)) {
        finalLeft = targetLeft;
        finalTop = newTop;
        foundSpace = true;
        break;
      }
    }
  }
  
  // 第3优先级：向左偏移
  if (!foundSpace) {
    for (const offset of offsets) {
      const newLeft = targetLeft - offset;
      if (newLeft >= 0 && !isOverlapping(newLeft, targetTop)) {
        finalLeft = newLeft;
        finalTop = targetTop;
        foundSpace = true;
        break;
      }
    }
  }
  
  // 第4优先级：向右偏移
  if (!foundSpace) {
    for (const offset of offsets) {
      const newLeft = targetLeft + offset;
      const groupRight = newLeft + totalWidth;
      if (groupRight <= CANVAS_WIDTH && !isOverlapping(newLeft, targetTop)) {
        finalLeft = newLeft;
        finalTop = targetTop;
        foundSpace = true;
        break;
      }
    }
  }
}
```

### 偏移优先级（严格顺序）

| 优先级 | 方向 | 约束 |
|--------|------|------|
| 第1 | 上 | 保持水平居中，偏移量 [50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000] |
| 第2 | 下 | 保持水平居中，偏移量同上 |
| 第3 | 左 | 偏移量同上 |
| 第4 | 右 | 偏移量同上 |
| 兜底 | 原位置 | 所有方向无空白时使用原居中逻辑 |

### 关键约束

1. **原有水平居中逻辑 100% 保留**
2. **偏移保持水平排列方式不变**
3. **必须检测画布边界**
4. **偏移量必须足够大（最大5000）**
5. **禁止修改坐标计算公式**

---

## 上传后镜头自动切换（已锁定 - 禁止修改）

**状态**：✅ 已验证可用，2025年修复并确认
**位置**：src/app/canvas/page.tsx `handleFileImport` 函数

### 核心逻辑（100%保留，禁止改动）

```javascript
// ====== 镜头切换到新图片组 ======
// 计算新图片组的中心点
const groupCenterX = finalLeft + totalWidth / 2;
const groupCenterY = finalTop + groupHeight / 2;

// 计算合适的缩放级别（使图片组占屏幕约50%）
const targetRatio = 0.5;
const targetScreenX = viewportInfo.containerWidth / 2;
const targetScreenY = viewportInfo.containerHeight / 2;

// 根据图片组尺寸计算最佳缩放
const groupMaxSize = Math.max(totalWidth, groupHeight);
const fitZoom = Math.min(
  viewportInfo.containerWidth * targetRatio / groupMaxSize,
  viewportInfo.containerHeight * targetRatio / groupMaxSize,
  1 // 最大缩放不超过1
);
const finalPanZoom = Math.max(0.1, Math.min(fitZoom, 1));

// 计算新的 pan 值，使图片组中心对准屏幕中心
const newPanX = targetScreenX - groupCenterX * finalPanZoom;
const newPanY = targetScreenY - groupCenterY * finalPanZoom;

console.log('[上传] 切换镜头到新图片组:', Math.round(groupCenterX), Math.round(groupCenterY), '| zoom:', finalPanZoom.toFixed(2));

setZoom(finalPanZoom);
setPan({ x: newPanX, y: newPanY });
```

### 关键约束

1. **必须使用 `finalLeft`, `finalTop` 计算中心点**（已偏移后的位置）
2. **缩放比例固定为 50%**（targetRatio = 0.5）
3. **最大缩放不超过 1**（防止放大过度）
4. **最小缩放不低于 0.1**（防止缩小过度）
5. **使用 `setZoom` 和 `setPan` 更新镜头状态**

### 交互效果

- 用户上传新图片组后
- 镜头自动移动到图片组位置
- 图片组居中显示在屏幕中央
- 缩放到合适的比例（图片组占屏幕约50%）

---

## 分割图片自动添加到画布（已锁定 - 禁止修改）

**状态**：✅ 已验证可用，2025年修复并确认
**位置**：src/app/canvas/page.tsx `handleAddSplitImagesToCanvas` 函数

### 功能说明
- 分割完成后自动添加到画布（无需点击按钮）
- 复用上传逻辑的空白检测偏移
- 使用分割的2列网格排列方式
- 镜头自动切换到新图片组

### 核心逻辑（100%保留，禁止改动）

```javascript
const handleAddSplitImagesToCanvas = useCallback(async (splitImages: string[]) => {
  // 1. 获取画布信息和现有图片
  const existingImages = canvas.state.elements
    .filter(el => el.type === 'image')
    .map(el => ({ left: el.x, top: el.y, right: el.x + el.width, bottom: el.y + el.height }));

  // 2. 计算2列网格布局
  const cellWidth = 200;
  const cellHeight = 150;
  const gap = 20;
  const cols = 2;
  const rows = Math.ceil(splitImages.length / cols);
  const totalWidth = cols * cellWidth + (cols - 1) * gap;
  const totalHeight = rows * cellHeight + (rows - 1) * gap;

  // 3. 计算画布居中的目标坐标
  const targetLeft = canvasCenterX - totalWidth / 2;
  const targetTop = canvasCenterY - totalHeight / 2;

  // 4. 空白检测偏移（复用上传逻辑）
  // 优先级：上 → 下 → 左 → 右 → 兜底
  // 偏移量：[50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000]

  // 5. 添加分割图片（2列网格排列）
  splitImages.forEach((imgUrl, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const imgX = finalLeft + col * (cellWidth + gap);
    const imgY = finalTop + row * (cellHeight + gap);
    canvas.addElement({ type: 'image', name: `分割区域 ${i + 1}`, x: imgX, y: imgY, width: cellWidth, height: cellHeight, ... });
  });

  // 6. 镜头切换到新图片组
  setZoom(finalPanZoom);
  setPan({ x: newPanX, y: newPanY });

  // 7. 关闭弹窗并重置状态
  setShowGridModal(false);
  setGridLeftCollapsed(false);
  setGridGenerating(false);
  setGridUploadedImages([]);
  setGridSplitImages([]);
  setIsGridSelectMode(false);
}, [canvas, pan, zoom, CANVAS_WIDTH, CANVAS_HEIGHT]);
```

### 关键约束

1. **自动触发**：分割成功后自动调用，无需用户操作
2. **删除按钮**：原有的"添加到画布"按钮已删除
3. **排列方式**：2列网格（200x150像素每格，间距20px）
4. **空白检测**：复用上传逻辑的偏移算法
5. **镜头切换**：自动移动到新图片组位置

### 交互流程

1. 用户上传图片 → 点击"开始分割"
2. 分割成功 → 自动添加到画布（空白检测 + 网格排列）
3. 镜头自动切换 → 显示新图片组
4. 弹窗自动关闭 → 状态重置

---

## 裁剪框配置（CRITICAL - 勿修改）

### 触发区域配置
```javascript
// 北边 - 上边缘调整
left: cropRect.x - 10,
top: cropRect.y - 25,
width: cropRect.width + 20,
height: 50,
zIndex: 250,

// 南边 - 下边缘调整  
left: cropRect.x - 10,
top: cropRect.y + cropRect.height - 25,
width: cropRect.width + 20,
height: 50,
zIndex: 250,

// 西边 - 左边缘调整
left: cropRect.x - 25,
top: cropRect.y - 10,
width: 50,
height: cropRect.height + 20,
zIndex: 250,

// 东边 - 右边缘调整
left: cropRect.x + cropRect.width - 25,
top: cropRect.y - 10,
width: 50,
height: cropRect.height + 20,
zIndex: 250,

// 四角 - 角落调整
left: isLeft ? cropRect.x - 30 : cropRect.x + cropRect.width - 20,
top: isTop ? cropRect.y - 30 : cropRect.y + cropRect.height - 20,
width: 50,
height: 50,
zIndex: 260,

// 中间移动区域
left: cropRect.x + 30,
top: cropRect.y + 30,
width: cropRect.width - 60,
height: cropRect.height - 60,
zIndex: 240,
```

### 关键实现要点

1. **无长按机制**：直接在 `onMouseDown` 开始拖动，不需要等待
2. **高 z-index**：触发区域 z-index (240-260) 高于工具栏 (200)，确保不被遮挡
3. **触发区域延伸到图片外部**：不使用 `Math.max(0, ...)` 限制，允许裁剪框靠近边缘时仍可触发
4. **裁剪模式下隐藏文字信息区域**：避免遮挡触发区域

### 裁剪坐标转换（CRITICAL）

```javascript
// 计算从画布坐标到图片实际像素坐标的缩放比例
const scaleX = img.naturalWidth / selectedImageEl.width;
const scaleY = img.naturalHeight / selectedImageEl.height;

// 转换裁剪区域到图片实际像素坐标
const srcX = Math.round(cropRect.x * scaleX);
const srcY = Math.round(cropRect.y * scaleY);
const srcW = Math.round(cropRect.width * scaleX);
const srcH = Math.round(cropRect.height * scaleY);

// 绘制时使用转换后的坐标
ctx.drawImage(img, clampedX, clampedY, clampedW, clampedH, 0, 0, clampedW, clampedH);
```

### 拖动性能优化

使用 `requestAnimationFrame` 节流：
```javascript
if (!cropRafRef.current) {
  cropRafRef.current = requestAnimationFrame(() => {
    if (pendingRectRef.current) {
      setCropRect(pendingRectRef.current);
      pendingRectRef.current = null;
    }
    cropRafRef.current = null;
  });
}
```

### Ref 引用定义

```javascript
const cropDragRef = useRef<{
  isDragging: boolean;
  startX: number;
  startY: number;
  rectX: number;
  rectY: number;
  rectW: number;
  rectH: number;
  handle: string;
} | null>(null);

const cropRafRef = useRef<number | null>(null);
const pendingRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
```

## 构建命令
```bash
pnpm install        # 安装依赖
pnpm run dev        # 开发模式
pnpm run build      # 构建
pnpm run start      # 生产模式
pnpm run ts-check   # 类型检查（tsc --noEmit）
```

## ⛔⛔⛔ 生产环境一键黄金部署（CRITICAL）⛔⛔⛔

**在服务器执行以下命令，一键完成部署：**

```bash
cd /var/www/kiikii && git fetch origin && git reset --hard origin/main && npm run build && cp -r public .next/standalone/public && mkdir -p .next/standalone/.next && cp -r .next/static .next/standalone/.next/static && pm2 delete all && pm2 start ecosystem.config.js --env production && pm2 save
```

**命令解释**：
| 步骤 | 命令 | 说明 |
|------|------|------|
| 1 | `git fetch origin` | 获取远程最新代码 |
| 2 | `git reset --hard origin/main` | 强制重置到远程 main 分支（丢弃本地修改） |
| 3 | `npm run build` | 构建生产版本 |
| 4 | `cp -r public .next/standalone/public` | 复制 public 目录（standalone 模式必需） |
| 5 | `mkdir -p .next/standalone/.next` | 创建 .next 目录 |
| 6 | `cp -r .next/static .next/standalone/.next/static` | 复制静态资源（standalone 模式必需） |
| 7 | `pm2 delete all` | 删除所有 PM2 进程 |
| 8 | `pm2 start ecosystem.config.js --env production` | 以生产环境启动服务 |
| 9 | `pm2 save` | 保存 PM2 进程列表（重启后自动恢复） |

**⚠️ 注意**：`git reset --hard` 会丢弃服务器上所有未提交的修改！

**⚠️ 重要**：standalone 模式必须复制 `public` 和 `.next/static`，否则 UI 界面无法显示！

## ⛔⛔⛔ 部署前必检铁律（CRITICAL）⛔⛔⛔

**原因**：开发模式（`next dev`）跳过类型检查，所以本地跑得好好的，推到生产构建就炸。

### 防线一：自动安检门（husky + lint-staged）

**已配置**：每次 `git commit` 时自动执行 `tsc --noEmit`，有类型错误直接拒绝提交。

- 配置文件：`.husky/pre-commit` → 执行 `npx lint-staged`
- lint-staged 规则：`*.{ts,tsx}` → `tsc --noEmit --pretty`
- 位置：`package.json` → `lint-staged` 字段

### 防线二：手动构建验证（肌肉记忆）

**部署前必须执行**：
```bash
pnpm run build
```
- 本地 build 绿灯 → 推到服务器 99.9% 稳
- 本地 build 红灯 → 先修好再推

### 防线三：代码修改后的验证清单

每次代码修改后，按顺序执行：
1. `pnpm run ts-check` — 类型检查（快，几秒）
2. `pnpm run build` — 完整构建（慢，但最可靠）
3. 服务存活检查 — `curl -I http://localhost:5000`

### 历史教训

| 日期 | 问题 | 根因 | 损失 |
|------|------|------|------|
| 2025 | 生产构建失败 | `browser-image-compression` 未安装但被引用，dev模式不报错 | 生产环境不可用 |

## 端口配置
- 开发端口: 5000 (必须使用)
- 禁止使用 9000 端口

## 文件结构
```
src/
├── app/
│   ├── canvas/
│   │   └── page.tsx      # 主画布组件
│   └── api/
│       └── canvas/
│           ├── upload/route.ts       # 画布图片上传 API（S3）
│           └── image-url/route.ts    # 获取图片签名 URL API
├── contexts/
│   └── CanvasContext.tsx # 画布状态管理
├── hooks/
│   └── useCanvasCore.ts  # 画布核心 Hook
├── lib/
│   └── canvas-image-layout.ts  # 图片布局工具
├── types/
│   └── canvas.ts         # 类型定义
└── components/
    └── ui/               # shadcn/ui 组件
```

---

## 图片存储方案（CRITICAL）

### 问题背景
- 之前图片使用 base64 存储到 localStorage
- localStorage 有大小限制（约 5MB）
- 当图片太大或数量过多时存储失败，导致刷新后图片丢失

### 解决方案
- 图片上传到 S3 对象存储
- localStorage 只保存 `imageKey`（对象存储的 key）
- 显示图片时调用 API 获取签名 URL

### API 接口

#### 1. 上传图片
```
POST /api/canvas/upload
Content-Type: multipart/form-data

请求：file (图片文件)
返回：{ success: true, key: "canvas/xxx.png", url: "签名URL" }
```

#### 2. 获取签名 URL（批量）
```
POST /api/canvas/image-url
Content-Type: application/json

请求：{ keys: ["key1", "key2"] }
返回：{ success: true, urls: { "key1": "URL1", "key2": "URL2" } }
```

### 数据结构
```typescript
interface CanvasElement {
  // ...
  imageUrl?: string;    // 签名 URL（临时，不持久化）
  imageKey?: string;    // S3 key（持久化）
  // ...
}
```

### 注意事项
1. **签名 URL 有效期 30 天**
2. **页面刷新时自动恢复图片 URL**
3. **旧的 base64 图片不会持久化**（会提示用户）

---

## 生图页面逻辑与配置（CRITICAL）

**状态**：✅ 已验证可用，画布对话框与生图页面逻辑完全一致
**位置**：
- 生图页面：src/app/page.tsx
- 画布对话框：src/app/canvas/page.tsx `handleSend` 函数

### 参考图逻辑（三套数据 - CRITICAL）

**核心原则**：生图时参考图必须维护三套数据，确保兼容性和性能

```javascript
// ====== 三套数据结构 ======
const [chatImageBase64s, setChatImageBase64s] = useState<string[]>([]);  // Base64 数据（用于本地预览）
const [chatImageUrls, setChatImageUrls] = useState<string[]>([]);        // 签名 URL（用于发送给后端）
const [chatImageMd5s, setChatImageMd5s] = useState<string[]>([]);        // MD5 哈希（用于去重）

// ====== 添加参考图时的处理 ======
const handleAddReferenceImage = async (file: File) => {
  // 1. 生成 Base64（用于本地预览）
  const base64 = await fileToBase64(file);
  
  // 2. 计算 MD5（用于去重）
  const md5 = await calculateMD5(file);
  
  // 3. 上传到 S3 获取签名 URL（用于发送给后端）
  const formData = new FormData();
  formData.append('file', file);
  const uploadRes = await fetch('/api/canvas/upload', { method: 'POST', body: formData });
  const { url } = await uploadRes.json();
  
  // 4. 更新三套数据
  setChatImageBase64s(prev => [...prev, base64]);
  setChatImageUrls(prev => [...prev, url]);
  setChatImageMd5s(prev => [...prev, md5]);
};

// ====== 发送请求时的处理 ======
const sendRequest = async () => {
  const requestBody: any = {
    prompt,
    md5Hashes: chatImageMd5s,  // 始终发送 MD5 用于去重
  };
  
  if (chatImageBase64s.length > 0) {
    // 优先使用签名 URL，没有则使用 Base64
    const validUrls = chatImageUrls.filter(url => url && url.length > 0);
    const imagesToSend = validUrls.length > 0 ? validUrls : chatImageBase64s;
    const isUrls = validUrls.length > 0;
    
    requestBody.images = imagesToSend;
    requestBody.isUrls = isUrls;  // 告诉后端是 URL 还是 Base64
  }
};
```

### 三套数据对照表

| 数据 | 用途 | 来源 | 是否持久化 |
|------|------|------|------------|
| `chatImageBase64s` | 本地预览、兜底发送 | File → Base64 | ❌ 不持久化 |
| `chatImageUrls` | 发送给后端（优先） | S3 上传返回 | ✅ 签名 URL |
| `chatImageMd5s` | 后端去重 | File → MD5 | ✅ 用于去重 |

### 关键约束

1. **三套数据必须同步更新**：添加/删除图片时，三个数组同时操作
2. **发送时优先使用 URL**：减少请求体积，提高性能
3. **MD5 必须发送**：后端用于去重，避免重复上传
4. **URL 失效时回退到 Base64**：确保请求能成功发送

---

## 生图后画布展示逻辑（CRITICAL）

**状态**：✅ 已验证可用，与上传图片逻辑完全一致
**位置**：src/app/canvas/page.tsx `addImagesToCanvas` 函数

### 核心流程

```javascript
const addImagesToCanvas = async (imageUrls: string[], promptText: string) => {
  // ====== 1. 获取每张图片的实际尺寸 ======
  const getImageDimensions = (src: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = () => resolve({ width: 200, height: 150 }); // 默认尺寸
      img.src = src;
    });
  };
  
  const imageDimensions = await Promise.all(imageUrls.map(getImageDimensions));
  
  // ====== 2. 计算图片尺寸（与上传图片逻辑一致）======
  const visibleMinSize = Math.min(visibleWidth, visibleHeight);
  const minSize = visibleMinSize / 5;  // 图片最小边占可视区域 1/5
  const maxSize = visibleMinSize / 3;  // 图片最大边占可视区域 1/3
  
  const scaledDimensions = imageDimensions.map(dim => {
    let width = dim.width;
    let height = dim.height;
    const currentMinSize = Math.min(width, height);
    
    if (currentMinSize < minSize || currentMinSize > maxSize) {
      const targetSize = Math.min(Math.max(currentMinSize, minSize), maxSize);
      const scale = targetSize / currentMinSize;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    return { width, height };
  });
  
  // ====== 3. 计算水平排列布局 ======
  const GAP = 100;
  const imgPositions: number[] = [];
  let posX = 0;
  for (let i = 0; i < scaledDimensions.length; i++) {
    imgPositions.push(posX);
    posX += scaledDimensions[i].width + GAP;
  }
  const totalWidth = posX - GAP;
  const groupHeight = Math.max(...scaledDimensions.map(d => d.height));
  
  // ====== 4. 空白检测偏移（复用上传逻辑）======
  // 优先级：上 → 下 → 左 → 右 → 兜底
  // 偏移量：[50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000]
  
  // ====== 5. 添加图片到画布 ======
  imageUrls.forEach((imgUrl, i) => {
    const imgX = finalLeft + imgPositions[i];
    const imgY = finalTop + (groupHeight - scaledDimensions[i].height) / 2;
    
    canvas.addElement({
      type: 'image',
      name: `${promptText.substring(0, 15)}... #${i + 1}`,
      x: imgX,
      y: imgY,
      width: scaledDimensions[i].width,
      height: scaledDimensions[i].height,
      imageUrl: imgUrl,
      sourceType: 'generate',
      sourcePrompt: promptText,
      // ... 其他属性
    });
  });
  
  // ====== 6. 镜头切换到新图片组 ======
  const groupCenterX = finalLeft + totalWidth / 2;
  const groupCenterY = finalTop + groupHeight / 2;
  const fitZoom = Math.min(containerWidth * 0.5 / totalWidth, containerHeight * 0.5 / groupHeight, 1);
  
  setZoom(fitZoom);
  setPan({ x: containerWidth / 2 - groupCenterX * fitZoom, y: containerHeight / 2 - groupCenterY * fitZoom });
};
```

### 尺寸计算规则

| 规则 | 数值 | 说明 |
|------|------|------|
| 最小边下限 | 可视区域 1/5 | 防止图片太小看不清 |
| 最小边上限 | 可视区域 1/3 | 防止图片太大占满屏幕 |
| 排列方式 | 水平排列 | 间距 100px |
| 缩放限制 | 0.1 ~ 1 | 防止极端缩放 |

### 关键约束

1. **必须等待图片尺寸加载完成**：使用 `Promise.all` 确保所有图片尺寸已知
2. **水平排列，垂直居中对齐**：每张图片在垂直方向居中
3. **缩放后保持宽高比**：不拉伸变形
4. **镜头自动切换**：生图完成后镜头移动到新图片组

---

## SSE 流式响应处理（CRITICAL）

**状态**：✅ 已验证可用
**位置**：src/app/canvas/page.tsx `handleSend` 函数

### 事件类型

| 事件类型 | 说明 | 处理方式 |
|----------|------|----------|
| `waiting` | 等待生成 | 显示已等待时间 |
| `image` | 收到一张图片 | 收集 URL，更新进度 |
| `timeout` | 后端超时 | 开始轮询获取结果 |
| `complete` | 生成完成 | 使用最终图片列表 |
| `error` | 生成失败 | 显示错误信息 |

### 核心处理逻辑

```javascript
// ====== SSE 流式响应处理 ======
const reader = response.body?.getReader();
const decoder = new TextDecoder();
let buffer = '';
let generatedImageUrls: string[] = [];  // 收集所有生成的图片URL
let isCompleted = false;                 // 是否收到 complete 事件
let finalTaskId = taskId;               // 任务ID（可能被 timeout 更新）

while (reader) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));

      if (data.type === 'image' && data.url) {
        // 收集图片URL
        generatedImageUrls.push(data.url);
        // 更新进度：已生成 N/M 张图片
      } else if (data.type === 'waiting') {
        // 显示等待时间
      } else if (data.type === 'timeout') {
        // 后端超时，开始轮询
        pollForResult(data.taskId);
        return; // 跳出流处理
      } else if (data.type === 'complete') {
        isCompleted = true;
        // 使用 complete 事件中的最终图片列表（优先于已收集的）
        const finalUrls = data.imageUrls || generatedImageUrls;
        addImagesToCanvas(finalUrls);
      } else if (data.type === 'error') {
        // 显示错误
      }
    }
  }
}

// ====== SSE 流结束后，检查任务状态并恢复结果 ======
// 重要：必须检查，否则可能遗漏结果！
if (!isCompleted || generatedImageUrls.length < selectedCount) {
  const resultResponse = await fetch(`/api/image-to-image?taskId=${finalTaskId}`);
  const resultData = await resultResponse.json();
  
  if (resultData.status === 'completed') {
    addImagesToCanvas(resultData.imageUrls);
  }
}
```

### 关键约束

1. **必须收集 `generatedImageUrls`**：SSE 流中可能收到多张图片
2. **必须检查 `isCompleted`**：确保收到 complete 事件
3. **流结束后必须查询任务状态**：防止遗漏结果
4. **timeout 事件时开始轮询**：后端超时后前端接管

---

## 轮询超时和最终查询（CRITICAL）

**状态**：✅ 已验证可用
**位置**：src/app/canvas/page.tsx `handleSend` 函数

### 轮询配置

| 参数 | 数值 | 说明 |
|------|------|------|
| 最大轮询次数 | 60 次 | 约 3 分钟 |
| 轮询间隔 | 3000ms | 每 3 秒查询一次 |
| 查询接口 | `/api/image-to-image?taskId=xxx` | GET 请求 |

### 轮询逻辑

```javascript
const pollForResult = async (taskId: string) => {
  const maxPolls = 60;
  const pollInterval = 3000;
  
  for (let i = 0; i < maxPolls; i++) {
    const res = await fetch(`/api/image-to-image?taskId=${taskId}`);
    const result = await res.json();
    
    if (result.status === 'completed' && result.imageUrls?.length > 0) {
      // 成功获取结果
      addImagesToCanvas(result.imageUrls);
      return;
    } else if (result.status === 'failed') {
      // 任务失败
      showError(result.error);
      return;
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  // 轮询超时，最后查询一次确保不遗漏
  const finalRes = await fetch(`/api/image-to-image?taskId=${taskId}`);
  const finalResult = await finalRes.json();
  
  if (finalResult.status === 'completed' && finalResult.imageUrls?.length > 0) {
    addImagesToCanvas(finalResult.imageUrls);
    return;
  }
  
  // 真的超时了
  showWarning('获取结果超时，图片可能仍在生成中，请稍后刷新页面查看');
};
```

### 任务状态说明

| 状态 | 说明 | 前端处理 |
|------|------|----------|
| `generating` | 正在生成 | 继续等待/轮询 |
| `completed` | 生成完成 | 添加图片到画布 |
| `failed` | 生成失败 | 显示错误信息 |

### 关键约束

1. **轮询超时后必须最后查询一次**：确保不遗漏结果
2. **查询时使用 taskId**：确保查询的是正确的任务
3. **最大轮询时间约 3 分钟**：避免无限等待
4. **超时后提示用户刷新页面**：给用户明确的反馈

---

## 常见问题与解决方案

### 问题 1：终端出图但画布未展示

**原因**：缺少 SSE 流结束后检查任务状态的逻辑

**解决方案**：在 `while (reader)` 循环结束后，添加查询任务状态的代码

```javascript
// SSE 流结束后
if (!isCompleted || generatedImageUrls.length < selectedCount) {
  // 查询后端恢复结果
  const resultResponse = await fetch(`/api/image-to-image?taskId=${finalTaskId}`);
  // ...
}
```

### 问题 2：参考图发送失败

**原因**：签名 URL 过期或未正确生成

**解决方案**：使用三套数据，优先 URL，回退 Base64

```javascript
const validUrls = chatImageUrls.filter(url => url && url.length > 0);
const imagesToSend = validUrls.length > 0 ? validUrls : chatImageBase64s;
```

### 问题 3：图片尺寸不一致

**原因**：使用网格布局而非水平排列

**解决方案**：统一使用水平排列，尺寸按可视区域 1/5~1/3 自动缩放

### 问题 4：重复的函数定义导致语法错误

**原因**：在同一个作用域内声明了两个同名的 `const` 函数

**解决方案**：删除重复的函数定义，只保留一个

**示例**：
```javascript
// ❌ 错误：重复定义
const addImagesToCanvas = async (urls) => { ... };
// ... 其他代码 ...
const addImagesToCanvas = async (urls, prompt) => { ... };  // 语法错误！

// ✅ 正确：只保留一个
const addImagesToCanvas = async (urls) => { ... };
```
