# CONTEXT.md - Coze 会话记忆文件

> **目的**：每次新会话开始时，Coze 必须第一时间读取此文件，快速恢复项目上下文，避免重复踩坑。
> **更新规则**：每次会话结束时，更新「最近会话记录」和「待办事项」部分。

---

## 1. 项目基本信息

| 项 | 值 |
|---|---|
| 项目名 | Kiikii-AI-Web（AI 图像/视频生成平台） |
| 技术栈 | Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui |
| 仓库地址 | https://github.com/695043662-eng/kiikii-ai-web.git |
| 工作目录 | `/workspace/projects`（直接在此目录，无子目录嵌套） |
| 端口 | 5000（主仓预览常驻，无需手动启动） |
| 包管理器 | pnpm（禁止 npm/yarn） |

## 2. 环境初始化清单（每次新会话必做）

### 2.1 第一步：重建 GitHub 授权
```bash
cd /workspace/projects
source .env.isolated
git remote add origin "https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/kiikii-ai-web.git" 2>/dev/null \
  || git remote set-url origin "https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/kiikii-ai-web.git"
```

### 2.2 第二步：确认环境
- `.env.isolated` 包含 GitHub Token、Supabase 双数据库密钥、支付配置（**禁止推送**，已在 .gitignore）
- `.env.local` 包含运行时环境变量（**禁止推送**，已在 .gitignore）
- `node_modules` 通常已存在，如缺失执行 `pnpm install`
- 端口 5000 主仓预览常驻运行，无需手动启动 dev server
- 如需验证服务存活：`curl -I -s --max-time 3 http://localhost:5000`

### 2.3 第三步：读取核心文档
必须按顺序读取以下文件：
1. **AGENTS.md** — 项目军规、架构约束、维修记录摘要（最高优先级）
2. **MAINTENANCE_HANDBOOK.md** — 完整维修记录手册（每次维修前必读）
3. **CONTEXT.md**（本文件）— 会话记忆

### 2.4 第四步：完成任务后推送 GitHub
```bash
cd /workspace/projects
git add -A
git commit -m "fix: 简要描述"
git push origin main
```

## 3. 项目架构关键约束（军规摘要）

1. **隔离文件原则**：`.env.isolated` 含敏感密钥，禁止推送、禁止在代码/日志中输出
2. **架构封层原则**：page.tsx（~10000+行）是已封层底座，禁止以"代码整洁"为由重构
3. **视觉刚性原则**：外层绝对定位→内层填满→核心交互的 DOM 嵌套模型
4. **2C2G 服务器**：前端承担防御职责，请求锁、本地压缩、并行处理
5. **状态纯洁原则**：单一数据源，禁止字符串拼接传递复合状态
6. **沙盒隔离原则**：禁止使用 exec_sql 工具（连沙盒库），必须用 Node.js 脚本连真实库
7. **离线异步状态机**：视频生成超 3 分钟走数据库状态机+后台定时查表
8. **禁止 read_image 工具**：使用后端 API 调用 LLM Vision 模型
9. **严格限制修改范围**：只改用户指定的内容，禁止连带修改
10. **真人模拟验证**：每次任务完成前必须执行完整验证清单

## 4. 核心文件索引

| 文件 | 行数 | 说明 |
|------|------|------|
| `src/app/canvas/page.tsx` | ~13500 | 画布主页面（核心逻辑） |
| `src/components/InteractiveImageStackNode.tsx` | ~760 | 扑克牌/多图堆叠组件 |
| `src/components/GeneratePanelNode.tsx` | ~5800 | 画布生成面板组件 |
| `src/components/temp_RightPanel.tsx` | ~1500 | 右侧面板 |
| `src/contexts/AIGeneratorContext.tsx` | ~400 | AI 生成器状态管理 |
| `src/hooks/useGenService.ts` | ~740 | 统一生成服务 |
| `src/app/records/page.tsx` | - | 充值页面 |
| `next.config.ts` | - | Next.js 配置（图片域名白名单等） |

## 5. 常见坑点速查

| 问题 | 根因 | 解决 |
|------|------|------|
| GitHub push 失败 | 新环境无 remote 配置 | 从 .env.isolated 读取 token，配置 remote |
| pnpm install 卡住 | canvas 原生模块编译慢 | 使用 `pnpm install --ignore-scripts` 跳过 |
| dev server 无法探活 | 缺少 --hostname 0.0.0.0 | dev.sh 已修复，添加 --hostname 0.0.0.0 |
| 扑克牌展开后工具栏不消失 | 单选工具栏条件缺少 isStackExpanded 检查 | #858 已修复 |
| 副图设为首图后主图不更新 | onUpdateData 传 undefined 覆盖已有数据 | #858 已修复：过滤 undefined |
| 扑克牌背景图与首图重复 | slice(1,4) 硬编码未排除 activeIndex | #858 已修复：filter 排除 activeIndex |
| Next.js 生产环境数据缓存 | force-dynamic 不够，fetch 默认 force-cache | 加 revalidate = 0 |
| 支付回调崩溃 | order_no 字段不存在，应为 out_trade_no | #856 已修复 |
| 生成面板 Loading 卡死 | onStillProcessing 回调缺失 | #856 已修复 |

## 6. 最近会话记录

### #858 (2025-08-06) - 扑克牌3项Bug修复 + 会话记忆文件创建
**修复内容**：
1. **Bug1**：画布扑克牌展开后顶部工具栏不收起
   - 文件：`src/app/canvas/page.tsx` 第12994行
   - 修复：单选工具栏条件增加 `!((selectedImageEl as any).isStackExpanded && (selectedImageEl as any).imageUrls?.length > 1)` 判断
2. **Bug2**：副图"设为首图"后主图位置偶尔不更新
   - 文件：`src/app/canvas/page.tsx` 第9430-9444行
   - 根因：`onUpdateData` 回调总是传全量字段（含 undefined），`canvas.updateElement` 展开合并时 undefined 覆盖已有数据
   - 修复：只传定义过的字段，imageUrl/imageKey 仅在 imageUrls/imageKeys 存在时才同步更新
3. **Bug3**：扑克牌收起态背景图与首图重叠
   - 文件：`src/components/InteractiveImageStackNode.tsx` 第426行
   - 修复：`imageUrls.slice(1, 4)` → `imageUrls.filter((_, i) => i !== activeIndex).slice(0, 3)`
4. **工程修复**：`scripts/dev.sh` 添加 `--hostname 0.0.0.0`
5. **创建本文件**：CONTEXT.md 会话记忆文件

### #856 (2025-08-06) - 生产环境5项严重问题修复
1. 支付回调 API：order_no → out_trade_no + CAS 锁 'pending'→'unpaid'
2. 支付按钮 Loading：isPaymentLoading 状态 + 按钮禁用 + 动画
3. next/image 重构：AssetCard + HeroCarousel + remotePatterns
4. 图片比例：Image fill + object-cover
5. Next.js 缓存：force-dynamic + revalidate=0（4个API路由）
6. 生成面板 Loading 卡死：onStillProcessing 回调补齐

## 7. 待办事项 / 已知问题

- [ ] 生产服务器需执行 `./deploy.sh` 部署最新代码
- [ ] Cloudflare CDN 需 Purge Everything
- [ ] 确认生产服务器 `.env.local` 中 Supabase URL/Key 指向生产库
- [ ] 持续观察支付回调是否正常到账

---

> **最后更新**：2025-08-06 #858
> **维护者**：Coze + 总监
