# V2.0 高可用架构与防坑白皮书

> **⛔⛔⛔ 本文档为系统开发总纲，所有代码变更必须遵守本文档定义的底线与红线 ⛔⛔⛔**
>
> 违背白皮书任何一条 = 任务失败 + 代码回滚

---

## 一、系统全景定位

### 1.1 架构哲学

**全 Serverless API 聚合架构** —— 无自建 GPU 算力，零运维基础设施。所有 AI 计算通过第三方 API 服务商完成，本系统专注"聚合调度 + 用户体验 + 资产管理"。

```
用户 → Next.js 前端 → API Routes(后端) → 第三方 API 服务商 → 返回结果
              ↑                                    ↓
        Supabase 数据库                        腾讯云 COS
       (用户/积分/订单/记录)                  (图片/视频存储)
```

### 1.2 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 16 |
| 核心 | React | 19 |
| 语言 | TypeScript | 5 |
| UI 组件 | shadcn/ui (Radix UI) | - |
| 样式 | Tailwind CSS | 4 |
| 数据库 | Supabase (PostgreSQL) | - |
| 对象存储 | 腾讯云 COS | - |
| 部署 | PM2 + standalone 模式 | 2C2G 服务器 |

### 1.3 服务器硬约束

- **2 核 2G** 服务器，物理极限，前端必须承担防御职责
- 禁止向后端发起无节制并发请求
- 所有图片压缩、Base64 转换、MD5 计算必须在前端完成
- 后端缓存是生命线（见 #837 Supabase 读风暴修复）

---

## 二、第三方 API 服务商矩阵

### 2.1 服务商全景图

| 服务商 | 代码标识 | 负责业务 | 调用方式 | 状态 |
|--------|----------|----------|----------|------|
| **GRS** | `grs` | 图片生成(GPT-Image-2等) | SSE 流式 | 活跃 |
| **T8Star** | `t8star` | 视频生成(Veo3/Sora-2/Seedance) + 图片 | 异步轮询(POST+GET) | 活跃 |
| **灵芽 LingYa** | `lingya` | 视频生成(Veo3.1/Sora-2) | 异步轮询(FormData) | 活跃 |
| **TOPAIS** | `topais` | 视频生成(Veo/HappyHorse/Seedance/Gemini Omni) | 异步轮询(POST+GET) | 活跃 |
| **MEGA AI** | `mega-ai` | 视频生成(Seedance 2.0/2.0-Fast) | 异步轮询(POST+GET) | 活跃 |
| **Google** | `google` | LLM(Gemini) + 工具(Gemini 视觉分割) | REST API | 活跃 |

### 2.2 服务商隔离铁律

> **⛔ 每个模型的配置和逻辑必须完全独立！禁止共用其他模型的任何代码分支！**

- 每个模型必须有独立的 `XXX_MODE_CONFIG`，不复用其他模型的 config
- `switch/case` 中每个模型必须有独立分支，不能 fall-through
- 只有 `isXxxModel()` 判断函数可以三端共用，且只做模型识别，不含业务逻辑
- 新增模型必须按 #690 军规清单逐条检查（详见 AGENTS.md）

### 2.3 多密钥轮换与熔断

**密钥管理**：`api_configs.api_key` 支持多密钥微语法格式

```
格式：每行一个配置，"Key | 状态 | 备注"
sk-123456 | 1 | 默认便宜分组
sk-789abc | 0 | 备用（已停用）
sk-def456 | | 测试分组
```

**细粒度熔断**：密钥 + 分辨率组合级别

| 参数 | 值 |
|------|-----|
| 熔断时长 | 6 小时 (21,600,000 ms) |
| 触发阈值 | 5 次连续失败 |
| 重置窗口 | 10 分钟无新失败则重置计数 |
| 粒度 | 完整密钥 + 分辨率（如 `sk-xxx_2K`） |

**熔断生命周期**：
1. 单次请求失败 → `consecutiveFailures` 计数 +1
2. 连续 5 次失败 → 写入 `resolutionBans` Map，6 小时熔断
3. 前端获取 `bannedResolutions` → 置灰对应分辨率按钮
4. 管理后台"急救按钮" → `clearAllCircuitBreakers` 一键解除

---

## 三、计费与支付闭环

### 3.1 积分扣减全链路

```
前端发起任务
    ↓
checkCreditsSufficient() — 检查积分 + 禁用状态（零 DB 写入解封判断）
    ↓ [积分不足/被禁用] → 返回错误，前端拦截
    ↓ [积分充足]
deductCredits() — 原子扣减（PostgREST REST API 直写 users 表）
    ├─ 条件更新：credits=gte.{扣除量}（防并发竞态）
    ├─ 用户不存在 → 自动开户（无感注册）
    ├─ 双式记账：同步写入 credit_logs 流水表
    └─ 返回 { success, remaining }
    ↓ [扣减成功]
调用第三方 API 生成
    ↓ [生成成功] → 记录生成结果
    ↓ [生成失败/异常] → refundCredits() 退还积分
```

### 3.2 积分计算规则

- **来源**：`api_models` 表的 `parameters.resolutions[x].credits` 或 `credits_base`
- **计算**：`积分 = 每张图积分 × 生成数量`
- **视频模型**：按分辨率档位（720p/1080p/4K）独立计费

### 3.3 积分退还（refundCredits）防御体系

> **⛔ 核心铁律：扣掉的积分必须 100% 能退还，绝不吃用户的钱！**

| 防线 | 机制 | 说明 |
|------|------|------|
| 第1道 | 先查后插 | 先查 `credit_logs` 是否已有 `reference_id + type=refund` 记录 |
| 第2道 | 409 冲突捕获 | 插入日志时若返回 409（唯一约束冲突），说明已被并发退还 |
| 第3道 | 失败后二次检查 | 插入失败后重新查询确认是否已退还 |
| 第4道 | 余额兜底查询 | 即使 `skipped=true`，也查 DB 返回最新余额 |
| 第5道 | 双式记账闭环 | 退还时同步写入 `credit_logs`（type=refund）+ `credit_refund_logs` |

### 3.4 支付 Webhook 防掉单（5 道防线）

> **位置**：`/api/payment/notify/route.ts`

| 防线 | 机制 | 说明 |
|------|------|------|
| 第1道 | MD5 签名验证 | 使用 `PAYMENT_KEY` 重新计算签名，与回调签名比对 |
| 第2道 | trade_status 检查 | 只处理 `TRADE_SUCCESS` 状态 |
| 第3道 | 金额容差比对 | 回调金额 vs 订单金额，误差 ≤ 0.01 元 |
| 第4道 | 幂等控制 | 订单状态为 `paid` 时直接返回成功，不重复加积分 |
| 第5道 | 先更新订单再加积分 | 先将订单标记为 `paid`，再给用户加积分，避免"积分加了但订单未更新" |

### 3.5 支付渠道

- **当前**：第三方聚合支付平台（wxpay 通道）
- **价格→积分映射**：后端写死 `PRICE_TO_CREDITS` 哈希表（防篡改）
- **未接入**：支付宝、Stripe、微信支付直连

---

## 四、COS 双桶存储架构

### 4.1 双桶模型

| 属性 | Temp 桶（1 号桶） | Perm 桶（2 号桶） |
|------|-------------------|-------------------|
| 用途 | AI 生成图、参考图 | 用户永久资产、展示区、视频 |
| 生命周期 | 5 天自动过期 | 永久保存 |
| CDN | 无 | 有（静态加速） |
| Key 前缀 | `dev/` 或 `prod/` | `dev/` 或 `prod/` |
| Cache-Control | `max-age=86400, immutable` | `max-age=31536000, immutable` |

### 4.2 图片流转链路

```
上传图片 → COS Temp 桶 (cosKey) → 代理路由签名URL → 前端展示
                                         ↓
                               Cache-Control: immutable
                               浏览器 Disk Cache 命中 → 0 网络请求
```

### 4.3 代理路由缓存策略（#842 修复后）

| 路由 | Cache-Control | 说明 |
|------|---------------|------|
| `/api/canvas/image` (perm) | `public, max-age=31536000, immutable` | 永久资产 1 年 |
| `/api/canvas/image` (temp) | `public, max-age=86400, immutable` | AI 生成图 1 天 |
| `/api/ref-image-proxy` (302) | `public, max-age=86400, immutable` | 重定向可缓存 |
| `/api/ref-image-proxy` (base64) | `public, max-age=86400, immutable` | 含 immutable |
| `/api/proxy-image` | `public, max-age=86400, immutable` | 1 天 |
| `/api/video/proxy` (perm) | `public, max-age=604800, immutable` | 7 天 |
| `/api/ref-img/[id]` | `public, max-age=86400, immutable` | 1 天 |

### 4.4 签名 URL 缓存策略

- **本地缓存**：`presigned-url-cache.ts`，5 天有效期 + LRU 策略
- **同一签名 URL 在有效期内复用** → 浏览器 Disk Cache 命中
- **⛔ 禁止使用 `_t=${Date.now()}`**：已在 #842 中删除全部 7 处缓存杀手

---

## 五、数据库 Schema 全景

### 5.1 核心业务表

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `users` | 用户账号 | id(uuid), phone, credits, is_active, locked_until |
| `generation_records` | 生成历史 | user_id, images[], model, prompt, image_keys[], reference_images[] |
| `reference_images` | 参考图库 | user_id, md5_hash, cos_key |
| `credit_logs` | 积分流水（双式记账） | user_id, amount(+/-), balance_after, type, reference_id |
| `credit_refund_logs` | 退款日志 | user_id, task_id, amount, reason |
| `payment_orders` | 支付订单 | out_trade_no, user_id, amount, status, raw_notify |
| `redeem_keys` | 兑换码 | key_code, credits, status, used_by |

### 5.2 API 配置表（数据库驱动架构）

| 表名 | 用途 | 说明 |
|------|------|------|
| `api_providers` | 服务商定义 | provider_code, provider_name |
| `api_configs` | API 接口配置 | api_endpoint, request_headers, request_body_template, api_key(多密钥) |
| `api_models` | 模型配置 | model_id, credits_base, parameters(JSONB), is_visible |
| `api_credentials` | 密钥凭证 | api_key, api_secret, rate_limit |
| `canvas_config` | 画布/展示区配置 | config_key, config_type, extra_data |

### 5.3 收藏表（三种面板各自独立）

| 表名 | 用途 |
|------|------|
| `prompt_favorites` | 图片面板收藏（user_id + content） |
| `video_favorites` | 视频面板收藏 |
| `text_panel_favorites` | 文本面板收藏 |

---

## 六、⛔ 六大终极防御机制（Ops & UX）

### 防御一：极端异常的积分 100% 兜底

**目标**：第三方 API 宕机、超时、用户断网，扣掉的积分必须 100% 退还。

**当前状态**：🟡 部分实现

| 场景 | 当前处理 | 状态 |
|------|----------|------|
| 图片生成失败 | SSE `error` 事件 → `refundCredits()` | ✅ 已实现 |
| 视频生成失败 | 轮询 `failed` 状态 → `refundCredits()` | ✅ 已实现 |
| SSE 流中断（用户断网） | 前端轮询兜底（60次×3秒） | ✅ 已实现 |
| 后端超时（SSE 流关闭） | `timeout` 事件 → 前端接管轮询 | ✅ 已实现 |
| **任务卡在 pending 状态** | ❌ 无定时回收 | 🔴 缺失 |
| **轮询超时后积分未退还** | ❌ 仅提示刷新，未主动退还 | 🟡 半实现 |

**必须补齐的机制**：

1. **Pending 任务超时回收脚本**：
   - 定时扫描 `generation_records` 中 `status=pending` 且 `created_at > 10分钟` 的记录
   - 自动调用 `refundCredits()` 退还积分
   - 将状态标记为 `timeout_refunded`

2. **轮询超时主动退还**：
   - 前端轮询 60 次（3 分钟）后仍未获得结果
   - 调用 `/api/image-to-image?taskId=xxx&timeout=true` 触发后端退还
   - 不依赖用户"刷新页面"

3. **Cron 守护脚本**：
   - 每小时执行一次，扫描僵尸任务
   - 记录 `credit_logs`（type=auto_refund）
   - 飞书/钉钉 Webhook 通知管理员

**铁律**：任何时候积分扣了，最终必须有对应 consume 或 refund 记录，`credit_logs` 必须账平。

---

### 防御二：全链路并发锁（UI 防抖）

**目标**：绝对禁止用户连点导致的"并发扣费重入"事故。

**当前状态**：🟡 前端已有防抖，但缺乏系统性保障

| 场景 | 当前处理 | 状态 |
|------|----------|------|
| 画布生成按钮连点 | `isGenerating` 状态锁 | ✅ 已实现 |
| 生图页面发送按钮 | `isGenerating` 状态锁 | ✅ 已实现 |
| 视频页面发送按钮 | `isGenerating` 状态锁 | ✅ 已实现 |
| **后端接口防重入** | ❌ 无请求指纹/幂等键 | 🔴 缺失 |
| **网络延迟导致双击穿透** | ❌ 状态锁可能延迟 | 🟡 半实现 |

**必须补齐的机制**：

1. **前端请求锁（RequestLock）**：
   ```typescript
   // 在发送前加锁，成功/失败后解锁
   const requestLock = useRef<Map<string, boolean>>(new Map());
   const acquireLock = (key: string) => {
     if (requestLock.current.get(key)) return false;
     requestLock.current.set(key, true);
     return true;
   };
   const releaseLock = (key: string) => requestLock.current.delete(key);
   ```

2. **后端幂等键**：
   - 前端生成 `idempotency_key`（crypto.randomUUID）
   - 后端收到请求后先查 Redis/内存 Map 是否已处理
   - 相同 key 的请求直接返回缓存结果，不重复扣费

3. **按钮物理防抖**：
   - 点击后立即 `disabled=true` + 视觉灰化
   - 请求完成后恢复（无论成功/失败）
   - 最小间隔 500ms

**铁律**：同一用户的同一任务，后端只处理一次。重复请求 = 直接返回，不扣费。

---

### 防御三：前端大图导出的 OOM 防御

**目标**：画布导出时（多张 4K 图片叠加），防止浏览器内存溢出。

**当前状态**：🔴 未实现

**必须规划的机制**：

1. **导出前内存估算**：
   - 计算画布内所有图片的 `width × height × 4 bytes`（RGBA）
   - 如果总内存 > 500MB，弹出降级提示

2. **降级压缩导出**：
   - 方案 A：将每张图片先压缩到 2K 分辨率再合成
   - 方案 B：分块渲染（Tile-based Rendering），每块 2048×2048，最终拼接

3. **分步导出**：
   - 大画布拆分为多个区域，逐区域导出
   - 用户可选择"全量高清"或"快速预览"

4. **Canvas 降采样**：
   - `canvas.toBlob()` 时指定 `quality=0.8`
   - 超过 4096×4096 的画布自动降采样到 4096

**铁律**：导出功能绝不能导致浏览器标签页崩溃。宁可降质，不可 OOM。

---

### 防御四：API 接口防刷限流（Rate Limiting）

**目标**：防止黑客脚本刷爆余额，核心扣费接口必须在中间件层限流。

**当前状态**：🔴 未实现

**必须规划的机制**：

1. **Next.js Middleware 层限流**：
   - 位置：`middleware.ts`（Next.js 内置中间件）
   - 策略：IP + User 双维度
   - 限制：核心接口 1 分钟最多 10 次，普通接口 1 分钟最多 30 次

2. **需要限流的核心接口**：

   | 接口 | 限制 | 说明 |
   |------|------|------|
   | `/api/image-to-image` | 10次/分钟 | 图片生成（扣费） |
   | `/api/video/generate` | 5次/分钟 | 视频生成（扣费） |
   | `/api/llm` | 10次/分钟 | LLM 生成（扣费） |
   | `/api/payment/create` | 3次/分钟 | 创建支付订单 |
   | `/api/canvas/upload` | 20次/分钟 | 图片上传 |
   | `/api/split` | 5次/分钟 | 智能分割（消耗 LLM） |

3. **实现方案**：
   - 内存级 `Map<key, {count, resetAt}>`（单实例足够，2C2G 不跑集群）
   - Key 格式：`{ip}:{userId}:{endpoint}`
   - 超限返回 `429 Too Many Requests` + `Retry-After` Header

4. **豁免规则**：
   - 管理员（`is_admin=true`）不受限流
   - GET 查询接口（如 `/api/packages`）宽松限流

**铁律**：任何扣费接口，必须有限流保护。无限流 = 悬挂的提款机。

---

### 防御五：僵尸数据垃圾回收（GC）

**目标**：COS temp 桶自动清理 + 数据库僵尸任务定时清理，拒绝存储垃圾。

**当前状态**：🟡 COS 已有生命周期，数据库缺定时清理

| 场景 | 当前处理 | 状态 |
|------|----------|------|
| COS temp 桶过期文件 | 5 天自动过期（COS Lifecycle） | ✅ 已配置 |
| COS perm 桶孤儿文件 | ❌ 无清理 | 🟡 风险可控 |
| **generation_records 僵尸任务** | ❌ 无定时清理 | 🔴 缺失 |
| **credit_logs 历史数据** | ❌ 无归档 | 🟡 可接受 |
| **sms_codes 过期记录** | ❌ 无清理 | 🟡 风险可控 |

**必须规划的机制**：

1. **COS Temp 桶 Lifecycle 优化**：
   - 当前：5 天自动删除
   - 建议：缩短为 3 天（生成图用户已下载/使用，3 天足够）
   - 监控：每月检查 COS 用量，异常飙升立即排查

2. **数据库僵尸任务清理脚本**（Cron）：
   ```sql
   -- 每小时执行：标记超时未完成的任务
   UPDATE generation_records
   SET status = 'timeout_refunded'
   WHERE status = 'pending'
     AND created_at < NOW() - INTERVAL '10 minutes';
   ```
   - 配合积分自动退还（见防御一）
   - 记录到 `credit_logs`（type=auto_refund）

3. **Orphan 文件检测**：
   - 每周对比 `generation_records.image_keys` 与 COS 实际文件
   - 找出"数据库无记录但 COS 存在"的孤儿文件
   - 生成清理清单，管理员确认后批量删除

4. **日志数据归档**：
   - `credit_logs` 超过 90 天的记录归档到冷存储
   - `sms_codes` 过期记录定期清理
   - `credit_refund_logs` 保留完整，不归档（审计需要）

**铁律**：存储不是免费的，僵尸数据是沉默的成本杀手。

---

### 防御六：心跳监控与告警钩子（Alarms）

**目标**：服务商连续异常时自动告警，管理员无需盯盘。

**当前状态**：🔴 未实现

**必须规划的机制**：

1. **监控中间件设计**：
   ```typescript
   // 位置：src/lib/service-health-monitor.ts
   interface ServiceHealthRecord {
     provider: string;        // t8star / lingya / topais / mega-ai / grs
     consecutiveErrors: number;
     lastErrorAt: number;
     lastError: string;
     status: 'healthy' | 'degraded' | 'down';
   }
   ```

2. **告警触发条件**：
   - 连续 3 次返回 5xx / 超时 → `degraded`（黄色告警）
   - 连续 5 次返回 5xx / 超时 → `down`（红色告警）
   - 单次返回特殊错误码（如 API 密钥失效）→ 立即 `down`

3. **告警通道**：
   - 飞书/钉钉 Webhook（JSON 格式消息）
   - 告警内容：服务商名称、错误类型、连续失败次数、最近一次错误详情、当前熔断状态
   - 恢复通知：服务商从 `down` 恢复到 `healthy` 时发送恢复通知

4. **健康探针 API**：
   - `GET /api/system/health`：返回所有服务商当前状态
   - 管理后台集成：实时展示服务商健康状态面板

5. **与熔断系统联动**：
   - `degraded` → 自动延长熔断时间（6h → 12h）
   - `down` → 自动触发全局熔断 + 告警
   - `healthy` 恢复 → 自动解除对应熔断

**铁律**：服务商挂了，管理员必须在 3 分钟内知道，而不是等用户投诉。

---

## 七、业务断层补齐蓝图

### 7.1 用户资产与云画布

**当前状态**：🟡 reference_images 表已存在但未充分使用；画布数据仅存 localStorage

#### 7.1.1 "我的图库" UI 开发

**现状**：`reference_images` 表已有 `user_id + md5_hash + cos_key`，但前端无独立图库页面。

**蓝图**：

1. **图库页面**（`/my-library`）：
   - 网格瀑布流展示用户所有参考图
   - 支持按日期、按模型来源筛选
   - 支持搜索（基于关联的 prompt 文本）
   - 一键发送到画布/生成面板作为参考图

2. **图库 API**：
   - `GET /api/user/images` — 分页获取用户图片（关联 generation_records + reference_images）
   - `DELETE /api/user/images/[id]` — 删除图片（同时删除 COS 文件）
   - `POST /api/user/images/favorite` — 收藏图片

3. **与现有功能的集成点**：
   - 上传参考图 → 同时写入 `reference_images`
   - AI 生成图 → 生成记录自动关联 `image_keys`
   - 收藏 → 复用 `prompt_favorites` / `video_favorites` / `text_panel_favorites`

#### 7.1.2 云画布存档

**现状**：画布数据仅存 localStorage（`canvas_data` key），无法跨设备。

**蓝图**：

1. **数据库表设计**（新增）：
   ```sql
   CREATE TABLE canvas_saves (
     id SERIAL PRIMARY KEY,
     user_id TEXT NOT NULL,
     save_name VARCHAR(100) DEFAULT '自动存档',
     canvas_data JSONB NOT NULL,  -- 元素位置/类型/参数
     element_count INTEGER DEFAULT 0,
     thumbnail_url TEXT,           -- 缩略图 COS URL
     is_auto_save BOOLEAN DEFAULT false,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     updated_at TIMESTAMPTZ DEFAULT NOW()
   );
   CREATE INDEX idx_canvas_saves_user_id ON canvas_saves(user_id);
   ```

2. **自动存档机制**：
   - 每次画布操作后 30 秒 debounce → 自动上传存档
   - 最多保留 5 个自动存档 + 无限制手动存档
   - 自动存档覆盖最旧的一条

3. **跨设备恢复**：
   - 登录后自动检测云端存档
   - 弹窗提示"检测到云端存档，是否恢复？"
   - 冲突时：云端 > 本地（云端版本号更高）

4. **缩略图生成**：
   - 保存时前端截取画布缩略图（降采样到 400×300）
   - 上传到 COS perm 桶
   - 存档列表展示缩略图

**优先级**：云画布 > 图库 UI（因为跨设备是刚需，图库可延后）

---

## 八、架构成熟度评估

### 8.1 各模块评分

| 模块 | 成熟度 | 说明 |
|------|--------|------|
| 图片生成 | ⭐⭐⭐⭐ | SSE 流式 + 占位符 + 熔断 + 积分闭环，基本无死角 |
| 视频生成 | ⭐⭐⭐⭐ | 11 个独立 handler + 异步轮询 + 进度透传，架构成熟 |
| 积分闭环 | ⭐⭐⭐⭐ | 双式记账 + 5 道退还防线 + 零写入解封，但缺定时回收 |
| 支付闭环 | ⭐⭐⭐ | 5 道防线可靠，但仅单通道 + 价格写死 |
| 画布交互 | ⭐⭐⭐⭐⭐ | 拖拽/缩放/连线/磁吸/面板/多选，功能完整 |
| 数据缓存 | ⭐⭐⭐⭐ | #837 后端缓存 + #842 CDN 策略，但缺限流 |
| 工作流引擎 | ⭐ | 无串联自动化，所有操作均为单步原子 |
| 电商工具 | ⭐ | 无抠图/去背景/换背景，仅有分割功能 |
| 监控告警 | ⭐ | 无健康探针、无告警钩子、无自动熔断升级 |
| 云存档 | ⭐ | 画布数据仅 localStorage，无法跨设备 |

### 8.2 优先级路线图

| 优先级 | 任务 | 防御机制 | 预估复杂度 |
|--------|------|----------|------------|
| P0 | Pending 任务超时回收 | 防御一 | 中 |
| P0 | 后端幂等键防重入 | 防御二 | 中 |
| P0 | API 接口限流 | 防御四 | 中 |
| P1 | 服务商健康监控 + 告警 | 防御六 | 高 |
| P1 | 云画布存档 | 业务蓝图 | 高 |
| P2 | 大图导出 OOM 防御 | 防御三 | 中 |
| P2 | 僵尸数据 GC 脚本 | 防御五 | 低 |
| P3 | "我的图库" UI | 业务蓝图 | 高 |

---

## 九、开发总纲铁律

### 9.1 每次代码变更前必须自检

| 序号 | 检查项 | 对应章节 |
|------|--------|----------|
| 1 | 新增模型是否按 #690 军规清单逐条实现？ | AGENTS.md |
| 2 | 积分扣减路径是否覆盖失败退还？ | 防御一 |
| 3 | 是否存在并发重入风险？ | 防御二 |
| 4 | 扣费接口是否已有/需要限流？ | 防御四 |
| 5 | COS 操作是否正确区分 temp/perm 桶？ | 第四章 |
| 6 | Cache-Control 是否设置正确？禁止 `_t=Date.now()` | 第 4.3 节 |
| 7 | 是否引入新的第三方依赖？是否必须？ | 架构哲学 |
| 8 | 是否遵循服务商隔离铁律？ | 第 2.2 节 |
| 9 | 前端计算是否已榨干（压缩/MD5/Base64）？ | 第 1.3 节 |
| 10 | 敏感信息是否从 `.env.local` 读取，禁止硬编码？ | 隔离文件原则 |

### 9.2 禁止行为清单

| 禁止 | 原因 |
|------|------|
| 禁止使用 `lsof` 检测端口 | 环境限制，会误检 IPv6 |
| 禁止使用 `exec_sql` 工具 | 连接沙盒数据库，不是用户真实数据 |
| 禁止使用 `read_image` 工具 | 识别质量差，必须用 LLM Vision |
| 禁止硬编码颜色/圆角 | 必须用 shadcn/ui 语义化变量 |
| 禁止自作主张重构画布 | 画布核心壳子严禁改写 |
| 禁止擅自修改未指定代码 | 只改用户明确指定的内容 |
| 禁止使用 `_t=${Date.now()}` | 打穿浏览器缓存，#842 血泪教训 |
| 禁止 npm/yarn | 仅允许 pnpm |

### 9.3 架构决策记录

所有重大架构决策必须记录在本白皮书中，格式如下：

```
### ADR-001: [决策标题]
- **日期**: YYYY-MM-DD
- **状态**: 已采纳 / 已废弃 / 待讨论
- **背景**: [决策背景]
- **决策**: [具体决策内容]
- **后果**: [决策带来的影响]
```

---

## 十、附录

### A. 文件路径速查

| 用途 | 路径 |
|------|------|
| 积分管理 | `src/lib/credits.ts` |
| API 配置与熔断 | `src/lib/api-config.ts` |
| 模型注册表 | `src/lib/model-registry.ts` |
| 数据库 Schema | `src/storage/database/shared/schema.ts` |
| 画布页面 | `src/app/canvas/page.tsx` |
| 图片生成路由 | `src/app/api/image-to-image/route.ts` |
| 视频生成路由 | `src/app/api/video/generate/route.ts` |
| 支付创建 | `src/app/api/payment/create/route.ts` |
| 支付回调 | `src/app/api/payment/notify/route.ts` |
| 后端缓存工具 | `src/lib/config-cache.ts` / `config-server-cache.ts` |
| 签名URL缓存 | `src/lib/presigned-url-cache.ts` |
| 违规禁用检查 | `src/lib/ban-check.ts` |
| 画布状态管理 | `src/contexts/CanvasContext.tsx` |
| AI 生成器状态 | `src/contexts/AIGeneratorContext.tsx` |
| 维修记录手册 | `MAINTENANCE_HANDBOOK.md` |
| 架构白皮书 | `ARCHITECTURE.md`（本文件） |

### B. 关联文档

| 文档 | 用途 |
|------|------|
| `AGENTS.md` | 开发规范 + 维修记录 + 军规清单 |
| `MAINTENANCE_HANDBOOK.md` | 历史维修案例与血泪教训 |
| `DESIGN.md` | 视觉与交互设计规范 |

### C. 环境变量清单（禁止硬编码）

| 变量 | 用途 |
|------|------|
| `SUPABASE_URL` | Supabase 数据库地址 |
| `SUPABASE_SERVICE_ROLE_KEY` | 数据库管理员密钥 |
| `COS_SECRET_ID` / `COS_SECRET_KEY` | 腾讯云 COS 密钥 |
| `COS_BUCKET_TEMP` / `COS_BUCKET_PERM` | 双桶名称 |
| `PAYMENT_PID` / `PAYMENT_KEY` / `PAYMENT_API_URL` | 支付平台配置 |
| `ADMIN_PHONE` | 管理员手机号 |

---

> **本文档由最高司令部签发，自发布之日起生效。**
> **任何违反白皮书的代码提交，等同于对系统稳定性的蓄意破坏。**
