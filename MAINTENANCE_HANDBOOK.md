# 维修记录手册

> **⛔⛔⛔ 最高准则 - 每次维修前必须阅读本手册 ⛔⛔⛔**
> 
> 本手册记录了所有关键维修案例和解决方案，避免重复踩坑！

---

## 核心原则

1. **先读手册，再动手** - 每次维修任务开始前，必须完整阅读本手册
2. **记录每次维修** - 所有重要维修必须记录到本手册
3. **不重复踩坑** - 遇到类似问题，先查手册是否有解决方案

---

## ⛔⛔⛔ 数据库铁律（CRITICAL）⛔⛔⛔

> **#235 血泪教训：禁止使用 `exec_sql` 工具！禁止连接沙盒数据库！**

### 数据库配置（必须背诵）

| 环境 | URL | 用途 | 状态 |
|------|-----|------|------|
| **开发数据库** | `ozdlvxxoufkiazddvxys.supabase.co` | 开发调试 | ✅ 正在使用 |
| **生产数据库** | `hrwoalchynrnwlcqdpxn.supabase.co` | 线上服务 | ✅ 正在使用 |
| **沙盒数据库** | `br-jolly-chub-94e68322...` | 已废弃 | ❌ **禁止使用** |

### 禁令

| 禁止项 | 说明 |
|--------|------|
| `exec_sql` 工具 | 默认连接沙盒数据库，返回假数据！ |
| 沙盒数据库 URL/Key | 已废弃，任何代码中不得出现 |
| 硬编码数据库连接 | 必须从环境变量读取 |

### 正确查询数据库方式

```javascript
// ✅ 正确：使用 Node.js 脚本直连真实数据库
const { getSupabaseClient } = await import('./src/storage/database/supabase-client.ts');
const supabase = getSupabaseClient();
const { data } = await supabase.from('users').select('*');

// ❌ 错误：使用 exec_sql 工具（连接沙盒数据库）
exec_sql({ sql: "SELECT * FROM users" })
```

---

## 维修记录目录

| 编号 | 问题类型 | 关键词 | 状态 | 备注 |
|------|----------|--------|------|------|
| #001 | 多任务占位符不更新 | imageItems 初始化 | ✅ 已修复 | 核心必读 |
| #002 | 任务失败占位符不更新 | SSE failed 状态 | ✅ 已修复 | |
| #003 | 占位符超出画布边界 | 边界检查 | ✅ 已修复 | |
| #004 | 连续任务占位符重叠 | placeholderPositionsRef | ✅ 已修复 | |
| #005 | 页面刷新图片丢失 | imageKey 字段映射 | ✅ 已修复 | |
| #006 | 占位符不更新图片 | 闭包陷阱 | ✅ 已修复 | 核心必读 |
| #007 | 乐观UI实现 | Optimistic UI | ✅ 已修复 | 核心必读 |
| #008 | 画布位置恢复 | zoom/pan 持久化 | ✅ 已修复 | |
| #009 | 图片恢复慢 | 并行恢复 COS 图片 | ✅ 已修复 | |
| #010 | 图片居中显示 | 居中偏移计算 | ✅ 已修复 | |
| #011 | 生产环境不返图 | undici 超时 + webhook localhost | ✅ 已修复 | 核心必读 |
| #012 | 多任务刷新只返一张图 | pollingTimers键覆盖 | ✅ 已修复 | |
| #013 | 积分扣费逻辑 | fetch→直接DB + 部分失败退还 | ✅ 已修复 | |
| #014 | 积分双重扣费 | 去掉后端 deductCredits | ✅ 已修复 | 核心必读 |
| #015 | 积分返还TOCTOU | task_id唯一约束 | ✅ 已修复 | 核心必读 |
| #016 | F5刷新占位符变失败 | 3次failed确认 | ✅ 已修复 | 可舍弃-已合并到#017 |
| #017 | 刷新后占位符卡死 | 挂载自检巡逻 + 轮询重连 | ✅ 已修复 | |
| #018 | 轮询无法返图 | 子任务判断 + 请求合并 | ✅ 已修复 | 核心必读 |
| #019 | 幽灵任务死锁 | isMounted状态锁 + 404熔断 | ✅ 已修复 | 核心必读 |
| #020 | 管理后台刷新整页 | useEffect([]) + 乐观更新 | ✅ 已修复 | |
| #021 | 用户不存在无限跳转 | 无感开户 | ✅ 已修复 | |
| #022 | 两数据库数据不一致 | credits.ts动态读取 | ✅ 已修复 | |
| #023 | 参考图上传慢 | A+B+C综合优化 | ✅ 已修复 | 核心必读 |
| #024 | 生图请求无防御 | RequestLock防并发 | ✅ 已修复 | 核心必读 |
| #025 | 代码重构 | handleGenerate统一入口 | ✅ 已修复 | 可舍弃-历史重构 |
| #026 | 分割功能 | 前端直传COS + 本地预览 | ✅ 已修复 | |
| #027 | Local-First缓存 | IndexedDB + 7天过期 | ✅ 已修复 | |
| #028 | 签名URL缓存 | presigned-url-cache.ts | ✅ 已修复 | 核心必读 |
| #029 | 提交层拦截池 | waitForPendingUploads | ✅ 已修复 | 核心必读 |
| #030 | 画布sendToChat追踪 | globalPendingUploads | ✅ 已修复 | 可舍弃-已合并到#029 |
| #031 | 终端空结果静默丢失 | item_failed事件 | ✅ 已修复 | 核心必读 |
| #032 | 画布参考图消失 | 删除clearAllImages | ✅ 已修复 | 可舍弃-已合并到#033 |
| #033 | 历史记录参考图丢失 | 竞态条件修复 | ✅ 已修复 | 参考图问题汇总 |
| #034 | 画布对话框图片丢失 | getPresignedUrls参数修复 | ✅ 已修复 | 可舍弃-已合并到#033 |
| #035 | 违规错误显示英文 | error-handler中文返回 | ✅ 已修复 | |
| #036 | 历史记录扣费信息不显示 | 本地存储保存扣费字段 | ✅ 已修复 | 可舍弃-已合并到#234 |
| #037 | 历史记录参考图丢失 | saveToLocalStorage添加reference_images | ✅ 已修复 | 可舍弃-已合并到#033 |
| #038 | 前向兼容性缺失导致白屏风险 | loadLocalRecords字段补全 | ✅ 已修复 | |
| #039 | HistoryRecordsDialog缺少扣费列 | 表格添加扣费列渲染 | ✅ 已修复 | 可舍弃-已合并到#234 |
| #040 | 画布对话框刷新后参考图消失 | referenceImageKeys持久化+恢复逻辑 | ✅ 已修复 | 可舍弃-已合并到#033 |
| #041 | 画布对话框助手消息生成图缺失 | imageUrlKey持久化+UI渲染 | ✅ 已修复 | |
| #042 | 画布对话框参考图刷新后消失 | saveMessages检查keys而非images | ✅ 已修复 | 可舍弃-已合并到#033 |
| #043 | 生图页面参考图拖动排序不完整 | 同步交换所有参考图数组 | ✅ 已修复 | |
| #044 | 生图页面历史记录参考图丢失 | referenceImageMd5sRef同步缺失 | ✅ 已修复 | 可舍弃-已合并到#033 |
| #045 | 模型列表页面分辨率硬编码 | API inferResolutions根据模型名判断 | ✅ 已修复 | |
| #046 | 模型列表视频模型缺失+状态显示错误 | API返回所有模型+前端使用isActive | ✅ 已修复 | |
| #047 | 生图页面前后端任务ID不一致 | GenerationOptions添加taskId透传 | ✅ 已修复 | 核心必读 |
| #048 | 参考图上传完成前可提交导致丢失 | uploadingCount追踪+图片加载转圈 | ✅ 已修复 | |
| #049 | 画布对话框参考图上传缺少加载状态 | 同步#048逻辑到画布页面 | ✅ 已修复 | 可舍弃-已合并到#048 |
| #050 | 邮箱验证码查询慢 | email+code联合索引 | ✅ 已修复 | |
| #051 | 生产数据库类型不匹配 | UUID→VARCHAR(255)+移除外键 | ✅ 已修复 | |
| #208 | HMR导致占位符元素丢失+轮询超时不标记失败 | 重新创建元素+超时标记失败 | ✅ 已修复 | 占位符核心 |
| #209 | 数据库记录重复 | task_id upsert 幂等去重 | ✅ 已修复 | 核心必读 |
| #210 | 生图页面终端返图但前端不更新 | 缓存generating时检查数据库 | ✅ 已修复 | |
| #211 | 占位符显示"api请求失败"但不更新 | 直接用elementId更新+complete处理失败 | ✅ 已修复 | |
| #212 | 历史记录不跟用户/换机器丢失 | GET接口source列回退逻辑 | ✅ 已修复 | |
| #213 | 生产环境占位符不更新 | SSE添加X-Accel-Buffering禁用Nginx缓冲 | ✅ 已修复 | |
| #214 | 开发环境占位符不更新 | onComplete处理placeholderReplacements兜底 | ✅ 已修复 | 可舍弃-已合并到#221 |
| #215 | 占位符元素消失导致更新失败 | 使用taskIdToElementIdRef获取最新elementId | ✅ 已修复 | 可舍弃-已合并到#221 |
| #216 | HMR后旧占位符不消失 | 重新添加前删除相同taskId的旧占位符 | ✅ 已修复 | 可舍弃-已合并到#221 |
| #217 | 占位符诊断日志 | 添加诊断日志找出删除失败原因 | ✅ 已修复 | 可舍弃-仅诊断日志 |
| #218 | item_failed后占位符状态变failed | 同时删除generating和failed状态的占位符 | ✅ 已修复 | 可舍弃-已合并到#221 |
| #219 | 占位符大小循环放大 | 占位符大小使用容器尺寸固定比例，不依赖zoom | ✅ 已修复 | 核心必读 |
| #221 | React闭包陷阱导致占位符不消失+图片重复 | 方案C双保险: stateRef + placeholderPositionsRef兜底 | ✅ 已修复 | 核心必读 |
| #222 | 参考图刷新后缩略图消失 | 记录索引避免闭包陷阱，chatImageMd5ToIdxRef映射 | ✅ 已修复 | |
| #223 | 同一历史记录生成两次 | 移除画布页面多余的AIGeneratorProvider | ✅ 已修复 | |
| #224 | 历史记录不保存+占位符只更新一张 | 诊断日志追踪轮询流程 | ✅ 已修复 | 可舍弃-已合并到#225 |
| #225 | 历史记录重复（画布+生图两条） | 移除后端保存逻辑，前端统一保存带source字段 | ✅ 已修复 | 可舍弃-已合并到#231 |
| #226 | 轮询无限循环，终端已返图但状态仍是generating | SSE完成后更新缓存状态为completed | ✅ 已修复 | |
| #227 | SSE流没发送complete事件导致占位符不更新 | 更新状态后重新获取currentResult变量 | ✅ 已修复 | |
| #228 | 占位符只更新一张图片，轮询返回generating | 添加诊断日志定位问题根因 | ✅ 已修复 | 可舍弃-仅诊断日志 |
| #229 | 异步竞态条件导致占位符被误杀 | complete事件中跳过已在SSE流收到的图片 | ✅ 已修复 | |
| #230 | 轮询status滞后导致无限循环 | GET请求状态修正+前端completedCount判断 | ✅ 已修复 | |
| #231 | 历史记录重复（ID分裂） | taskId主键+Upsert语义+单一保存点 | ✅ 已修复 | 核心必读 |
| #232 | 历史记录保存失败 | Supabase JS upsert兼容性+React闭包陷阱 | ✅ 已修复 | 核心必读 |
| #233 | 参考图发送到服务商失败 | replaceTemplateVariables数组转字符串问题 | ✅ 已修复 | 核心必读 |
| #234 | 历史记录缺失积分扣除数值 | GET方法数据库恢复缺少积分字段 | ✅ 已修复 | |
| #235 | 参考图发送失败（旧架构） | 缺少referenceImages字段+exec_sql误判数据库 | ✅ 已修复 | 核心必读 |
| #238 | 轮询分支历史记录缺失 | 定时检查完成时调用saveHistoryRecord | ✅ 已修复 | 核心必读 |
| #239 | 参考图删除后Ref残留 | 删除时同步清空State+Ref | ✅ 已修复 | |
| #240 | 再次生成幽灵MD5+无限上传中 | Ref同步+finally清空input+onBackgroundComplete | ✅ 已修复 | |
| #241 | 参考图清空点Ref遗漏 | 地毯式排查4处漏网之鱼 | ✅ 已修复 | |
| #242 | 历史记录未存MD5 | saveHistoryRecord添加referenceImageMd5s | ✅ 已修复 | |
| #243 | 军师方案-全时监听+计数器精准 | useEffect联动清空+精准递增uploadingCount | ✅ 已修复 | |
| #244 | TaskResult类型缺失referenceImageMd5s | 类型定义+setTaskResult传递+GET恢复 | ✅ 已修复 | |
| #245 | 生图失败显示坏图图标 | 渲染拦截+失败清空images+过滤空字符串 | ✅ 已修复 | |
| #246 | 缩略图违规显示为失败 | includes('违规')判断正确显示违规文案 | ✅ 已修复 | |
| #247 | 再次生成记录不显示 | HistoryRecordsDialog过滤逻辑扩展source类型 | ✅ 已修复 | |
| #248 | GET API未返回source字段 | .select()添加source字段 | ✅ 已修复 | 核心必读 |
| #249 | 历史记录页面source过滤缺失 | history/page.tsx添加source过滤 | ✅ 已修复 | |
| #250 | handleRegenerate未强制清空Ref | 函数开头强制清空所有State+Ref | ✅ 已修复 | 核心必读 |
| #251 | 参考图预览兼容URL+LocalStorage清理+强制解锁 | URL预览+自动清理200条+finally解锁 | ✅ 已修复 | 核心必读 |
| #252 | 右侧面板参考图不显示+移除"历史"标签 | 移除"历史"标签+字段名映射修复(referenceImages) | ✅ 已修复 | 核心必读 |
| #253 | 字段名不一致导致参考图不显示 | referenceImages→reference_images（与数据库一致） | ✅ 已修复 | 核心必读 |
| #254 | 轮询返回空 imageUrls 导致历史记录不保存 | GET API 从 imageItems 提取实际 URL | ✅ 已修复 | 核心必读 |
| #255 | 再次生成覆盖左侧操作容器 | 方案A：删除替换左侧State的逻辑，保护用户输入 | ✅ 已修复 | 核心必读 |
| #256 | 违规显示"生成失败"而非"内容违规" | 定时检查从imageItems提取错误信息，支持特定错误类型 | ✅ 已修复 | |
| #257 | 发送到画布无图片 | addSingleImageToCanvas 添加 img.src = imgUrl | ✅ 已修复 | |
| #258 | 占位符比例不一致（1:1变3:4填灰） | onComplete 调用 updatePlaceholder 复用尺寸计算 | ✅ 已修复 | 核心必读 |
| #259 | 展示/启用按钮失效 | 废除 hidden-models.json，全线回归数据库管理 | ✅ 已修复 | 核心必读 |
| #260 | 新架构请求失败 "apikey is empty" | request_headers 缺少 Authorization header | ✅ 已修复 | 核心必读 |
| #261 | gpt-image-2 返回结果为空 | 配置webhook+修改空结果检测逻辑 | ✅ 已修复 | 核心必读 |
| #262 | 图片签名 URL 返回 403 | COS 客户端初始化时机问题 | ✅ 已修复 | 核心必读 |
| #263 | webhook URL 硬编码开发环境域名 | 数据库占位符 + 环境变量动态读取 | ✅ 已修复 | 核心必读 |
| #264 | gpt-image-2 模型 Logo 显示 | 添加专用 logo 文件 + 按模型 ID 判断显示 | ✅ 已修复 | |
| #265 | 模型 Logo 替换为 Gemini/GPT 专用图标 | 替换文件，尺寸统一 150×150 | ✅ 已修复 | |
| #266 | 管理后台拖动排序不影响前端显示 | syncToApiModels 函数添加 sort_order 同步 | ✅ 已修复 | |
| #267 | Webhook 失败未返还积分 | requestParams 存 userId + 状态标记补全 | ✅ 已修复 | 核心必读 |
| #268 | 所有图片提交失败不返还积分 | SSE分支直接break跳过积分返还逻辑 | ✅ 已修复 | 核心必读 |
| #269 | 管理后台积分不实时更新 | 监听事件 + 刷新用户列表 + 事件来源标识防重复请求 | ✅ 已修复 | 核心必读 |
| #270 | 积分更新体验优化（真扣真显） | SSE start 携带积分 + 事件携带 userId/newCredits + 接收端本地热更新 | ✅ 已修复 | 核心必读 |
| #271 | 双式记账法（统一流水表） | credit_logs 统一记录所有积分变动 + 四大变动点接入 | ✅ 已修复 | 核心必读 |
| #272 | 管理后台积分流水查看入口 | 新增"积分流水"Tab + 筛选功能 + 分页 | ✅ 已修复 | 核心必读 |
| #273 | 管理后台拖动排序弹回 | sort_order 映射错误 model.id → model.sort_order | ✅ 已修复 | |
| #274 | 默认模型改为GPT Image 2 + 删除2K/4K | Context默认值 + inferParameters只返回1K | ✅ 已修复 | |
| #275 | 安全漏洞：MIME伪造+SSRF+execSync | 魔数验证+URL白名单+移除child_process | ✅ 已修复 | 安全核心 |
| #276 | 生成失败积分返还不更新前端 | 双保险：后端await返还+前端timeout事件处理 | ✅ 已修复 | 核心必读 |
| #277 | 管理后台拖动排序不生效+前端排序无效+默认模型 | 硬编码MODEL_SORT_ORDER覆盖+useSharedData默认值 | ✅ 已修复 | 核心必读 |
| #278 | 积分双重返还（TOCTOU竞态） | refundCredits前必须重新getTaskResult+检查creditsRefunded | ✅ 已修复 | **核心必读** |
| #279 | onError 连坐问题 | 使用 error.placeholderIds 精准定位失败占位符 | ✅ 已修复 | 核心必读 |
| #280 | 再次生成积分不实时更新 | 复用 handleGenerate 统一入口 | ✅ 已修复 | 核心必读 |
| #281 | 熔断器阈值太低 | failureThreshold: 5 → 10 | ✅ 已修复 | 核心必读 |
| #282 | 积分返还逻辑分散导致漏返 | 统一 handlePartialRefund 函数 | ✅ 已修复 | **核心必读** |
| #283 | Webhook积分返还未await | 改为await等待返还完成 | ✅ 已修复 | **核心必读** |
| #284 | GET接口超时未返还积分 | 5分钟超时检测 + 自动返还机制 | ✅ 已修复 | **核心必读** |
| #285 | 并发请求导致重复返还 | 数据库唯一约束 + on_conflict参数 | ✅ 已修复 | **核心必读** |
| #286 | refundCredits 并发安全 | 先插入日志再更新积分 + 唯一约束检测 | ✅ 已修复 | **核心必读** |
| #287 | 生图发送到画布缺少 imageKey | sessionStorage 传递 imageKey + 画布读取使用 | ✅ 已修复 | **核心必读** |
| #288 | GET超时返还逻辑错误 | 数学结算逻辑替代状态统计 | ✅ 已修复 | **核心必读** |
| #289 | 删除图片刷新后恢复 | 元素删除立即保存localStorage | ✅ 已修复 | |
| #290 | 占位符像素密度低 | placeholderBaseSize /4 → /2 | ✅ 已修复 | |
| #291 | 管理后台积分流水入口+减少变增加 | 删除独立Tab+修复distributeCredits逻辑 | ✅ 已修复 | |
| #292 | 用户详情对话框优化 | 变宽无横拉条+变动前余额+来源区分 | ✅ 已修复 | |

---

## 关键案例详解

### #001 - 多任务占位符不更新（CRITICAL）⚠️ 必读

**问题描述**：
- 用户反馈："一组3张，5组在终端生成了！画布中只有1种！"
- 终端正常生成多张图片，但画布只显示一组

**根因分析**：
后端在初始化任务缓存时（`setTaskResult`），没有同时初始化 `imageItems` 数组。

**修复方案**：
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

**关键文件**：
- `src/app/api/image-to-image/route.ts` - 任务缓存初始化

---

### #006 - 占位符不更新图片（CRITICAL）⚠️ 闭包陷阱

**问题描述**：
- 占位符创建后无法更新图片
- `updatePlaceholder` 无法找到对应元素

**根因分析**：
`canvas.state.elements` 是 React 状态，异步更新。`createPlaceholders` 中的 `canvas.state.elements` 是旧值。

**修复方案**：
使用 `canvas.addElement` 返回的 `elementId` 直接更新，不依赖 `canvas.state.elements`。

---

### #007 - 乐观UI实现（CRITICAL）

**问题描述**：
- 图片加载需要10秒
- 用户等待时间过长

**核心原则**：
- **用户看到预览图瞬间，发送按钮就是可用状态**
- **点击发送时系统自己在后台排队等Key**

**修复方案**：
```typescript
// 1. 全局追踪器
export const globalPendingUploads = new Map<string, Promise<void>>();

// 2. 等待所有上传完成
export async function waitForPendingUploads(): Promise<void> {
  const promises = Array.from(globalPendingUploads.values());
  await Promise.allSettled(promises);
}

// 3. 发送前等待
await waitForPendingUploads();
```

**关键文件**：
- `src/hooks/useOptimisticUpload.ts` - 全局追踪器
- `src/contexts/AIGeneratorContext.tsx` - handleGenerate 调用等待

---

### #011 - 生产环境不返图（CRITICAL）

**问题描述**：
- 本地开发正常，生产环境不返图
- 超时或返回空结果

**根因分析**：
1. `undici` 连接超时默认10秒，生产环境网络慢
2. webhook 回调地址是 `localhost`，生产环境无法访问

**修复方案**：
1. 删除 `undici` Agent，使用原生 `https`
2. 改用 SSE 流模式，不需要 webhook

---

### #012 - 多任务刷新只返一张图（CRITICAL）

**问题描述**：
- 同时发送多个任务，刷新后只返回一张图

**根因分析**：
`pollingTimers` 使用 `actualTaskId` 作为键，多任务时键覆盖

**修复方案**：
使用 `actualTaskId_index` 作为键，避免覆盖

---

### #014 - 积分双重扣费（CRITICAL）

**问题描述**：
- 用户被扣两次积分

**根因分析**：
后端 `deductCredits` 和 `checkCreditsSufficient` 都在扣费

**修复方案**：
去掉后端 `deductCredits`，只保留 `checkCreditsSufficient`

---

### #015 - 积分返还TOCTOU（CRITICAL）

**问题描述**：
- 任务失败返还积分，但返还两次

**根因分析**：
并发请求时，`credits_refunded` 检查存在竞态条件

**修复方案**：
`credit_refund_logs` 表添加 `task_id` 唯一约束

---

### #018 - 轮询无法返图（CRITICAL）

**问题描述**：
- 轮询成功但不返图
- 多个请求同时轮询导致 DDoS

**根因分析**：
1. 子任务判断逻辑错误
2. 每个组件独立轮询，请求爆炸

**修复方案**：
1. 正确判断子任务
2. 全局 `Map` 合并请求，避免重复轮询

---

### #019 - 幽灵任务死锁（CRITICAL）

**问题描述**：
- SSR 时任务状态异常
- 页面卡死无法操作

**根因分析**：
SSR 时 `isMounted` 为 false，但代码依赖 `isMounted` 判断

**修复方案**：
1. `isMounted` 状态锁
2. 404 熔断
3. 幽灵任务检测

---

### #023 - 参考图上传慢（CRITICAL）

**问题描述**：
- 上传参考图需要5-7秒

**根因分析**：
1. `for` 循环串行处理
2. 等待 COS 上传完成才显示预览

**修复方案（A+B+C综合优化）**：
1. **静态导入**：避免动态 import 延迟
2. **Promise.all 合并读取**：base64 和 arrayBuffer 并行
3. **乐观UI**：立即显示预览，后台静默上传

---

### #028 - 签名URL缓存（CRITICAL）

**问题描述**：
- 每次刷新都重新加载图片
- 浏览器 Disk Cache 不生效

**根因分析**：
签名 URL 每次不同，浏览器认为是新资源

**修复方案**：
新增 `src/lib/presigned-url-cache.ts` 本地缓存机制

---

### #029 - 提交层拦截池（CRITICAL）

**问题描述**：
- 上传阻塞发送按钮
- 违背乐观 UI 原则

**核心原则**：
用户随时可以点发送，系统自己在后台排队等Key

**修复方案**：
```typescript
// 点击发送时
1. UI 立即进入"生成中"状态
2. await waitForPendingUploads() 等待后台完成
3. 拿到完整的 referenceImageKeys 后发送请求
```

---

### #031 - 终端空结果静默丢失（CRITICAL）

**问题描述**：
- 终端返回成功但没有图片
- 占位符一直显示"生成中"

**根因分析**：
空结果时没有触发失败事件

**修复方案**：
空结果触发 `item_failed` 事件

---

### #033 - 历史记录参考图丢失（CRITICAL）

**问题描述**：
- 历史记录中参考图数据丢失

**根因分析**：
`uploadingCount` 竞态条件，`referenceImageKeys` 未保存

**修复方案**：
1. `onBackgroundComplete` 同步更新 ref
2. 缓存检查添加 `reference_image_keys`

---

### #034 - 画布对话框图片丢失（CRITICAL）

**问题描述**：
- 刷新后参考图丢失
- 用户第4次提出此问题

**根因分析**：
1. `getPresignedUrls` 缺少 `fetchNewUrls` 参数
2. 变量名冲突

**修复方案**：
重命名变量避免冲突，补充缺失参数

---

### #035 - 违规错误显示英文（CRITICAL）

**问题描述**：
- 违规提示词导致生成失败
- 占位符显示冗长的英文错误信息

**修复方案**：
`error-handler.ts` 检测中英文关键词，违规错误直接返回简短中文

---

### #036 - 历史记录扣费信息不显示（CRITICAL）

**问题描述**：
- 历史记录页面不显示扣费信息和余额
- 之前有显示扣费但余额没显示

**根因分析**：
`onComplete` 回调中没有更新 `creditsCharged` 和 `creditsBalanceAfter` 字段

**修复方案**：
```typescript
// onComplete 回调中添加扣费字段
return {
  ...t,
  creditsCharged: result.creditsCharged ?? t.creditsCharged,
  creditsBalanceAfter: result.creditsBalance ?? t.creditsBalanceAfter,
};
```

**布局调整**：
- 积分信息移到时间后面
- 显示格式：`-36 余额 2100`
- 参考图和生成图往后顺移

**修改文件**：
- `src/app/generate/page.tsx` - onComplete 回调
- `src/app/history/page.tsx` - 布局调整

---

### #037 - 历史记录参考图丢失（CRITICAL）

**问题描述**：
- 历史记录页面不显示参考图
- 本地存储保存时 `reference_images` 被设为空数组

**根因分析**：
`saveToLocalStorage` 函数硬编码 `reference_images: []`，导致参考图信息丢失

**修复方案**：
```typescript
// saveToLocalStorage 函数
const record = {
  // ...
  reference_images: task.params.referenceImageUrls || [],
  reference_image_keys: task.params.referenceImageKeys || [],
  credits_charged: task.creditsCharged,
  credits_balance: task.creditsBalanceAfter,
  source: 'generate' as const,
};
```

**修改文件**：
- `src/app/generate/page.tsx` - saveToLocalStorage
- `src/app/canvas/page.tsx` - saveRecordWithCapturedRef
- `src/components/HistoryRecordsDialog.tsx` - HistoryRecord 类型定义

---

### #038 - 前向兼容性缺失导致白屏风险（CRITICAL）

**问题描述**：
- 新老数据混杂，旧数据缺少 `reference_images`、`credits_charged` 等字段
- UI 渲染时没有默认值兜底，可能导致页面白屏

**修复方案**：
```typescript
// loadLocalRecords 函数添加字段补全
return records.map((r: GenerationRecord) => ({
  ...r,
  reference_images: r.reference_images || [],
  reference_image_keys: r.reference_image_keys || [],
  image_keys: r.image_keys || [],
  images: r.images || [],
  credits_charged: r.credits_charged ?? undefined,
  credits_balance: r.credits_balance ?? null,
}));
```

**修改文件**：
- `src/app/history/page.tsx` - loadLocalRecords
- `src/components/HistoryRecordsDialog.tsx` - loadLocalRecords

---

### #039 - HistoryRecordsDialog缺少扣费列（CRITICAL）

**问题描述**：
- `HistoryRecordsDialog.tsx` 使用表格布局，没有扣费信息列
- 只有类型定义，没有 UI 渲染

**修复方案**：
1. 表头添加扣费列
2. 表格行添加扣费渲染逻辑
3. 旧数据显示 `-`，新数据显示 `-36 余额 2100`

**修改文件**：
- `src/components/HistoryRecordsDialog.tsx` - 表格渲染

---

### #040 - 画布对话框刷新后参考图消失（CRITICAL）

**问题描述**：
- 用户上传参考图并生成成功
- F5 刷新后，画布对话框里的聊天气泡中没有参考图

**根因分析**：
1. `saveMessages` 保存消息时，主动删除了 `referenceImages`（base64 太大）
2. 但没有保存 `referenceImageKeys`（COS key）
3. `loadMessages` 恢复时，没有处理参考图的恢复

**修复方案**：
1. Message 类型添加 `referenceImageKeys` 字段
2. `saveMessages` 保存 `referenceImageKeys` 而不是丢弃
3. 发送消息时同时保存 `referenceImages`（显示）和 `referenceImageKeys`（持久化）
4. 恢复时通过 key 获取签名 URL，设置 `referenceImages`

**修改文件**：
- `src/components/temp_RightPanel.tsx` - Message 类型定义
- `src/lib/dialog-data-db.ts` - saveMessages 保存 key
- `src/app/canvas/page.tsx` - 发送时保存 key，恢复时转换成 URL

---

### #041 - 画布对话框助手消息生成图缺失（CRITICAL）

**问题描述**：
- 对话气泡没有渲染助手消息的生成图（`imageUrl`）
- 刷新后生成图丢失（没有保存 `imageUrlKey`）

**根因分析**：
1. `Message` 类型定义分散在多个文件，不同步
2. `saveMessages` 没有保存助手消息的生成图 key
3. `temp_RightPanel.tsx` 没有渲染 `imageUrl`
4. 恢复逻辑没有处理助手消息生成图

**修复方案**：
1. 同步三个 `Message` 类型定义（Context、types、temp_RightPanel）
2. `saveMessages` 保存 `imageUrlKey`
3. 发送成功时设置 `imageUrlKey`
4. 恢复时通过 key 获取签名 URL
5. UI 渲染助手消息的生成图

**修改文件**：
- `src/contexts/AIGeneratorContext.tsx` - Message 类型同步
- `src/types/canvas.ts` - Message 类型同步
- `src/components/temp_RightPanel.tsx` - Message 类型同步 + UI 渲染
- `src/lib/dialog-data-db.ts` - saveMessages 保存 imageUrlKey
- `src/app/canvas/page.tsx` - 保存和恢复 imageUrlKey

---

### #042 - 画布对话框参考图刷新后消失（CRITICAL）

**问题描述**：
- 用户第4次反馈参考图刷新后消失
- `saveMessages` 检查 `msg.referenceImages` 判断是否保存，但发送时 `referenceImages` 可能是 undefined

**根因分析**：
`saveMessages` 检查条件错误：
```typescript
// 错误：检查 referenceImages（可能是 undefined）
if (msg.role === 'user' && msg.referenceImages && msg.referenceImages.length > 0)

// 正确：检查 referenceImageKeys（才是持久化的关键）
if (msg.role === 'user' && msg.referenceImageKeys && msg.referenceImageKeys.length > 0)
```

**修复方案**：
修改检查条件为 `referenceImageKeys`

---

### #043 - 生图页面参考图拖动排序不完整（CRITICAL）

**问题描述**：
- 参考图拖动排序功能失效
- 只交换了2个数组，但实际有4个相关数组需要同步交换

**根因分析**：
```typescript
// 错误：只交换了 images 和 urls
[newImages[dragIdx], newImages[idx]] = [newImages[idx], newImages[dragIdx]];
[newUrls[dragIdx], newUrls[idx]] = [newUrls[idx], newUrls[dragIdx]];

// 正确：需要交换所有4个数组
[newImages[dragIdx], newImages[idx]] = [newImages[idx], newImages[dragIdx]];
[newUrls[dragIdx], newUrls[idx]] = [newUrls[idx], newUrls[dragIdx]];
[newKeys[dragIdx], newKeys[idx]] = [newKeys[idx], newKeys[dragIdx]];
[newMd5s[dragIdx], newMd5s[idx]] = [newMd5s[idx], newMd5s[dragIdx]];
```

**修复方案**：
同步交换 `referenceImages`、`referenceImageUrls`、`referenceImageKeys`、`referenceImageMd5s` 四个数组

---

### #044 - 生图页面历史记录参考图丢失（CRITICAL）

**问题描述**：
- 生图页面的历史记录中参考图丢失
- `onComplete` 回调中 `referenceImageMd5sRef.current` 始终为空数组

**根因分析**：
ref 同步 useEffect 缺少 `referenceImageMd5sRef` 的同步：
```typescript
// 只有这两个 ref 被同步
useEffect(() => {
  referenceImageKeysRef.current = referenceImageKeys;
}, [referenceImageKeys]);
useEffect(() => {
  referenceImageUrlsRef.current = referenceImageUrls;
}, [referenceImageUrls]);

// 缺少 referenceImageMd5sRef 的同步！
```

**修复方案**：
```typescript
// 添加 referenceImageMd5sRef 的同步
useEffect(() => {
  referenceImageMd5sRef.current = referenceImageMd5s;
}, [referenceImageMd5s]);
```

**修改文件**：
- `src/app/generate/page.tsx` - ref 同步 useEffect

---

### #045 - 模型列表页面分辨率硬编码（CRITICAL）

**问题描述**：
- 模型列表页面显示的分辨率没有根据模型名称判断
- `nano-banana-fast` 应该只支持 1K，却显示了 1K/2K/4K
- `nano-banana-2-4k-cl` 应该只支持 4K，却显示了 1K/2K/4K

**根因分析**：
API `/api/models` 的 `inferResolutions` 函数没有根据模型名称判断支持的分辨率：
```typescript
// 错误：所有图片模型都返回 1K/2K/4K
return {
  resolutions: [
    { label: '1K', value: '1K', credits: credits },
    { label: '2K', value: '2K', credits: credits2K },
    { label: '4K', value: '4K', credits: credits4K },
  ],
};
```

**修复方案**：
新增 `inferImageResolutions` 函数，根据模型名称返回正确的分辨率列表：
```typescript
function inferImageResolutions(modelId: string, creditsBase: number) {
  const key = modelId.toLowerCase();
  
  // 只支持 4K 的模型
  if (key === 'nano-banana-2-4k-cl' || key === 'nano-banana-pro-4k-vip') {
    return [{ label: '4K', value: '4K', credits: creditsBase }];
  }
  
  // 只支持 1K 的模型
  if (key === 'nano-banana' || key === 'nano-banana-fast') {
    return [{ label: '1K', value: '1K', credits: creditsBase }];
  }
  
  // 只支持 1K, 2K 的模型
  if (key === 'nano-banana-2-cl' || key === 'nano-banana-pro-vip') {
    return [
      { label: '1K', value: '1K', credits: creditsBase },
      { label: '2K', value: '2K', credits: creditsBase * 1.2 },
    ];
  }
  
  // 默认支持 1K, 2K, 4K
  return [...];
}
```

**修改文件**：
- `src/app/api/models/route.ts` - 新增 `inferImageResolutions` 函数

---

### #046 - 模型列表视频模型缺失+状态显示错误（CRITICAL）

**问题描述**：
- 模型列表页面所有模型显示"离线"状态
- 视频模型 `grs-sora-2` 不显示在列表中

**根因分析**：
1. API `/api/models` 只返回 `is_active = true` 的模型，视频模型被禁用所以不显示
2. 模型状态通过调用外部API获取，外部API不可用导致全部显示离线
3. 状态显示逻辑依赖外部API而非数据库的 `is_active` 字段

**修复方案**：
1. API修改：返回所有模型（不过滤 `is_active`），前端根据 `is_active` 显示状态
2. 视频模型处理：确保 `durations` 字段正确返回（从 `resolutions` 字段转换）
3. 前端修改：使用 `isActive` 字段显示状态，不再调用外部API

```typescript
// API: 返回所有模型
const { data: apiModels } = await supabase
  .from('api_models')
  .select('...')
  .order('sort_order');  // 删除 .eq('is_active', true)

// 前端: 使用 isActive 字段
const onlineCount = modelDefinitions.filter(m => m.isActive).length;
const offlineCount = modelDefinitions.filter(m => !m.isActive).length;

// 状态显示
{model.isActive ? "在线" : "离线"}
```

**修改文件**：
- `src/app/api/models/route.ts` - 删除 is_active 过滤，添加 durations 处理
- `src/app/models/page.tsx` - 使用 isActive 字段显示状态

---

### #047 - 生图页面前后端任务ID不一致（CRITICAL）

**问题描述**：
- 提交生成后，终端显示完成，但前端没有返回图片
- 刷新页面后轮询返回 404：`GET /api/image-to-image?taskId=1776661126511 404`

**根因分析**：
存在两套任务ID系统，导致前后端失联：

| 层级 | 任务ID来源 | 示例 |
|------|-----------|------|
| generate/page.tsx | `Date.now().toString()` | `1776661126511` |
| useGenService.ts | `crypto.randomUUID()` | `1776661185014` |

**问题流程**：
1. `handleStartGeneration` 创建 `newTaskId = 1776661126511`（前端任务ID）
2. `handleGenerate` 被调用，但 `GenerationOptions` 接口**不支持 taskId 参数**
3. `useGenService.generate` 创建新的 `taskId = 1776661185014`（发送给后端的ID）
4. 前端轮询 `1776661126511`，后端只有 `1776661185014`，返回 404

**修复方案**：
1. 在 `GenerationOptions` 接口添加 `taskId?: string` 字段
2. 在 `handleGenerate` 函数中透传 `taskId` 给 `genService.generate`
3. 在 `generate/page.tsx` 中传递 `taskId: newTaskId`

```typescript
// 1. GenerationOptions 接口
export interface GenerationOptions {
  // ...
  taskId?: string;  // #047 修复：前端预生成taskId
}

// 2. handleGenerate 函数
const result = await genService.generate({
  // ...
  taskId: options.taskId,  // #047 透传
});

// 3. generate/page.tsx
await handleGenerate({
  // ...
  taskId: newTaskId,  // #047 传递前端创建的任务ID
});
```

| #245 | 生图失败显示坏图图标 | images 数组未清空 + 渲染拦截不严谨 | ✅ 已修复 |
| #246 | 缩略图违规显示"失败" | 错误信息判断逻辑与后端不匹配 | ✅ 已修复 |
| #247 | 再次生成记录不显示在历史列表 | source 过滤逻辑遗漏 regenerate | ✅ 已修复 |

### #245 生图失败显示坏图图标

**问题**：生图失败后，大图位置出现"坏图"图标，而不是显示空白

**原因**：
1. 任务失败时 `images` 数组没有被清空，可能包含 `[undefined]` 或 `[""]`
2. 渲染大图的条件只判断数组长度，没有判断元素是否有效
3. `saveHistoryRecord` 没有过滤空字符串

**修复**：

**1. 强化渲染拦截（generate/page.tsx 第 2839-2860 行）**
```typescript
// 修改前：只判断数组长度
{selectedTask && selectedTask.images.length > 0 ? (

// 修改后：必须确保第一个元素是有内容的字符串
{selectedTask && selectedTask.images?.[0] && selectedTask.images[0].length > 0 ? (
  // ...
  const currentImageUrl = selectedTask.images[selectedImageIndex] || selectedTask.images[0] || '';
  
  // 双重保险：如果 currentImageUrl 为空，显示空白
  if (!currentImageUrl || currentImageUrl.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-20 h-20 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
          <ImageIcon className="w-10 h-10 text-gray-400" />
        </div>
      </div>
    );
  }
```

**2. 规范失败清理逻辑（generate/page.tsx 多处）**
```typescript
// 所有设置 status: 'failed' 的地方，都添加 images: []
return {
  ...t,
  status: 'failed' as const,
  error: errorMsg,
  images: [],  // #245 失败时清空图片数组
  itemStatuses: t.itemStatuses.map(() => 'failed' as const),
  itemErrors: t.itemErrors.map(() => errorMsg),
};
```

**3. saveHistoryRecord 过滤空字符串（AIGeneratorContext.tsx）**
```typescript
// 过滤空字符串，确保存入数据库的是干净数据
const filteredImages = images?.filter(url => url && url.length > 0) || [];
if (filteredImages.length === 0) {
  console.warn('[AIGeneratorContext] #237/#245 无有效图片，跳过保存');
  return false;
}

const filteredImageKeys = imageKeys?.filter(key => key && key.length > 0) || [];
const filteredReferenceImages = referenceImages?.filter(url => url && url.length > 0) || [];
const filteredReferenceImageMd5s = referenceImageMd5s?.filter(md5 => md5 && md5.length > 0) || [];
```

**关键文件**：
- `src/app/generate/page.tsx`
  - 大图渲染条件（第 2839-2860 行）
  - 失败处理逻辑（多处，搜索 `status: 'failed'`）
- `src/contexts/AIGeneratorContext.tsx`
  - saveHistoryRecord 过滤空字符串（第 625-645 行）

**修改文件**：
- `src/contexts/AIGeneratorContext.tsx` - 接口定义 + handleGenerate 透传
- `src/app/generate/page.tsx` - 传递 taskId: newTaskId

---

### #048 - 参考图上传完成前可提交导致丢失（CRITICAL）

**问题描述**：
- 用户上传参考图后立即点击提交，但参考图还没上传完成
- 历史记录中没有参考图数据
- 生图任务读取不到参考图

**根因分析**：
`uploadingCount` 在 `onOptimisticUpdate` 时就被减少，导致：
1. 用户看到预览图后，`uploadingCount` 已经是 0
2. 提交按钮变为可用状态
3. 用户点击提交，但 `referenceImageKeys` 还是空的（上传还没完成）

```typescript
// 错误：乐观更新时就减少了 uploadingCount
onOptimisticUpdate: (result) => {
  setUploadingCount(prev => Math.max(0, prev - 1)); // ❌ 错误！
},

// 正确：应该在上传完成时才减少
onBackgroundComplete: (result) => {
  setUploadingCount(prev => Math.max(0, prev - 1)); // ✅ 正确
},
```

**修复方案**：
1. `uploadingCount` 在上传完成时才减少（不在乐观更新时）
2. 新增 `uploadingMd5s` Set 追踪每张图片的上传状态
3. 图片预览区显示加载转圈（每张图片独立的加载状态）
4. 修复 useOptimisticUpload：上传失败时也调用 `onBackgroundComplete`

```typescript
// 图片预览区显示加载转圈
{referenceImageMd5s[idx] && uploadingMd5s.has(referenceImageMd5s[idx]) && (
  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
    <Loader2 className="w-8 h-8 text-white animate-spin" />
  </div>
)}
```

**修改文件**：
- `src/app/generate/page.tsx` - uploadingCount 逻辑 + uploadingMd5s 追踪 + 加载转圈显示
- `src/hooks/useOptimisticUpload.ts` - 上传失败时也调用 onBackgroundComplete

---

### #049 - 画布对话框参考图上传缺少加载状态（CRITICAL）

**问题描述**：
- 画布对话框的参考图上传没有同步 #048 的修复
- 用户看不到图片是否正在上传
- 上传完成前可以提交，导致参考图丢失

**修复方案**：
同步 #048 的修复逻辑到画布对话框：

1. 在 `AIGeneratorContext` 添加 `chatUploadingMd5s` 状态
2. 在画布页面 `handleReferenceImageUpload` 中追踪上传状态
3. 在 `RightPanel` 显示加载转圈

```typescript
// AIGeneratorContext.tsx
const [chatUploadingMd5s, setChatUploadingMd5s] = useState<Set<string>>(new Set());

// canvas/page.tsx - onOptimisticUpdate
setChatUploadingMd5s(prev => new Set(prev).add(result.md5));

// canvas/page.tsx - onBackgroundComplete
setChatUploadingMd5s(prev => {
  const newSet = new Set(prev);
  newSet.delete(result.md5);
  return newSet;
});

// temp_RightPanel.tsx - 显示加载转圈
{chatImageMd5s[index] && chatUploadingMd5s.has(chatImageMd5s[index]) && (
  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
    <Loader2 className="w-5 h-5 text-white animate-spin" />
  </div>
)}
```

**修改文件**：
- `src/contexts/AIGeneratorContext.tsx` - 添加 chatUploadingMd5s 状态和类型
- `src/app/canvas/page.tsx` - 追踪上传状态
- `src/components/temp_RightPanel.tsx` - 显示加载转圈

---

### #050 - 邮箱验证码查询慢（CRITICAL）

**问题**：邮箱验证码验证时查询慢，用户体验差

**根因**：`email_verification_codes` 表缺少 `email + code` 联合索引

**修复**：
```sql
-- 添加 email + code 联合索引（毫秒级查询）
CREATE INDEX idx_email_verification_codes_email_code ON email_verification_codes(email, code);
```

**修改文件**：
- `database/init-production.sql` - 添加联合索引

---

### #051 - 生产数据库类型不匹配（CRITICAL）

**问题**：生产环境数据库脚本使用 UUID 类型，但开发环境使用 VARCHAR(255)

**根因**：脚本编写时使用了标准的 UUID 类型，但实际项目使用 VARCHAR(255) 作为用户ID

**影响**：
1. 外键约束会导致数据插入失败
2. 类型不匹配导致查询错误

**修复**：
1. 将所有 `user_id UUID` 改为 `user_id VARCHAR(255)`
2. 移除所有 `REFERENCES users(id) ON DELETE CASCADE` 外键约束
3. 将 `deduct_credits` 和 `add_credits` 函数参数从 UUID 改为 VARCHAR(255)

**修改文件**：
- `database/init-production.sql` - 全量类型修复

---

### #208 - HMR导致占位符元素丢失+轮询超时不标记失败（CRITICAL）

**问题**：开发环境HMR热更新后，占位符显示"轮询超时"但服务商已返图

**现象**：
1. 服务商终端已成功返回图片（SSE流正常）
2. 前端占位符一直显示"生成中"或"轮询超时"
3. 刷新页面后部分图片恢复（2张），部分丢失（3张）

**根因分析**：

1. **HMR导致画布状态重置**
   ```
   [updatePlaceholder] 查找元素: elementId=hf982dm3d, 找到=false null
   ```

2. **updateElement静默忽略不存在的元素**
   ```typescript
   // CanvasContext.tsx reducer
   case 'UPDATE_ELEMENT':
     return {
       ...state,
       elements: state.elements.map(el =>
         el.id === action.payload.id ? { ...el, ...action.payload.updates } : el  // 元素不存在时静默忽略！
       ),
     };
   ```

3. **轮询超时不标记占位符失败**
   ```typescript
   if (pollCount > MAX_POLL_COUNT) {
     clearPollingTimer(taskKey);
     console.log('[Canvas 巡逻] ⏰ 轮询超时（10分钟），停止轮询');
     return;  // ❌ 没有标记占位符为失败！
   }
   ```

**修复方案**：

1. **updatePlaceholder 元素不存在时重新创建**
   ```typescript
   // 元素不存在（可能被热更新重置），使用 placeholderPositionsRef 计算居中
   const pos = placeholderPositionsRef.current.get(taskId);
   if (pos) {
     // ...计算位置...
     
     // 🔧 #208 修复：元素不存在时，尝试重新添加元素到画布
     const newElementId = canvas.addElement({
       type: 'image',
       name: `生成图片`,
       x: newX, y: newY, width: newWidth, height: newHeight,
       // ...其他必需属性...
       imageUrl, imageKey, generationStatus: 'completed',
     });
     // 更新映射关系
     taskIdToElementIdRef.current.set(taskId, newElementId);
   }
   ```

2. **轮询超时时标记占位符为失败状态**
   ```typescript
   if (pollCount > MAX_POLL_COUNT) {
     clearPollingTimer(taskKey);
     
     // 🔧 #208 修复：轮询超时标记占位符为失败状态
     const elementId = taskIdToElementIdRef.current.get(taskKey);
     if (elementId) {
       const el = canvas.state.elements.find(e => e.id === elementId);
       if (el && el.generationStatus === 'generating') {
         canvas.updateElement(elementId, { 
           generationStatus: 'failed', 
           generationError: '轮询超时：任务长时间未完成' 
         });
       }
     }
     return;
   }
   ```

**修改文件**：
- `src/app/canvas/page.tsx` - updatePlaceholder + 轮询超时处理

---

### #225 - 历史记录重复（画布+生图两条）（CRITICAL）

**问题描述**：
- 用户反馈：生成一张图片后，历史记录显示两条记录
- 一条显示"画布"，一条显示"生图"
- 日志显示 `[Canvas] 保存生成记录失败: 保存失败`

**根因分析**：
有三个地方在保存生成记录：
1. **后端 SSE** (`image-to-image/route.ts:1203-1228`) - 没有 `source` 字段，使用 `insert`
2. **前端画布** (`canvas/page.tsx`) - 有 `source: 'canvas'`
3. **前端生图** (`generate/page.tsx`) - 有 `source: 'generate'`

历史记录页面根据 `source` 字段显示标签：
- `source === 'canvas'` → 显示"画布"
- 其他情况 → 显示"生图"

导致问题：
1. 后端保存时没有 `source` 字段，显示为"生图"
2. 前端再保存时带 `source: 'canvas'`，显示为"画布"
3. 两条记录的 `task_id` 相同，但后端用的是 `insert` 而非 `upsert`

**修复方案**：
移除后端的保存逻辑，让前端统一保存（带 `source` 字段）：
```typescript
// ====== 不再在此处保存生成记录 ======
// #225 修复：移除后端保存逻辑，由前端统一保存（带 source 字段区分画布/生图）
// 前端在 onComplete 回调中会保存记录，并传递 source: 'canvas' 或 'generate'

// 任务完成，发送complete事件（含积分信息）
```

**修改文件**：
- `src/app/api/image-to-image/route.ts` - 移除后端保存逻辑（第 1203-1228 行）

---

### #226 - 轮询无限循环，终端已返图但状态仍是generating（CRITICAL）

**问题描述**：
- 终端已经生成完成并返图
- 前端轮询持续进行，无法停止
- 轮询返回 `status: 'generating'` 而不是 `'completed'`

**根因分析**：
在 SSE 流发送 `complete` 事件后，没有更新缓存中的任务状态为 `'completed'`：
```typescript
// 发送 complete 事件
sendEvent({ type: 'complete', ... });
// ❌ 缺少：没有更新缓存状态
break;  // 直接跳出循环
```

轮询时读取缓存，状态仍然是 `'generating'`，导致轮询不会停止。

**修复方案**：
在发送 `complete` 事件前，更新缓存中的任务状态：
```typescript
// #226 修复：更新缓存中的任务状态为 completed，防止轮询无限循环
setTaskResult(actualTaskId, {
  ...currentResult,
  status: 'completed',
  imageItems: imageItems,
  completedAt: Date.now(),
});
console.log(`[SSE] 已更新任务状态为 completed: ${actualTaskId}`);

// 任务完成，发送complete事件（含积分信息）
```

**修改文件**：
- `src/app/api/image-to-image/route.ts` - 发送 complete 事件前更新状态

---

### #227 - SSE流没发送complete事件导致占位符不更新（CRITICAL）

**问题描述**：
- 用户反馈：终端已返图，但占位符没有更新为图片
- 日志中没有 `[GenService] 收到 complete 事件`
- 只收到部分图片

**根因分析**：
```typescript
// 第 1122 行：更新缓存状态
setTaskResult(actualTaskId, {
  ...currentResult,
  status: completedCount > 0 ? 'completed' : 'failed',
  completedAt: Date.now(),
});
console.log(`[SSE] 所有图片已完成: ${completedCount} 成功, ${failedCount} 失败`);

// 第 1131 行：检查是否全部完成
if (currentResult.status === 'completed' || currentResult.status === 'failed') {
  // ❌ currentResult 变量是旧值！status 仍然是 'generating'
  // 所以这个条件不满足，不会进入发送 complete 事件的逻辑
}
```

**问题链**：
1. `setTaskResult` 更新了缓存中的状态
2. 但 `currentResult` 局部变量仍然是旧值（`status: 'generating'`）
3. 条件 `if (currentResult.status === 'completed')` 不满足
4. 不会发送 `complete` 事件
5. 前端 SSE 流结束，开始轮询

**修复方案**：
在检测到所有图片完成时，立即发送 `complete` 事件并跳出循环，不再依赖后续的条件检查：
```typescript
// #227 修复：检测到所有图片完成时，立即发送 complete 事件
if (allDone && currentResult.status !== 'completed' && currentResult.status !== 'failed') {
  const newStatus = completedCount > 0 ? 'completed' : 'failed';
  setTaskResult(actualTaskId, {
    ...currentResult,
    status: newStatus,
    completedAt: Date.now(),
  });
  
  // 立即发送 complete 事件
  sendEvent({
    type: 'complete',
    taskId: actualTaskId,
    imageUrls: completedUrls,
    imageKeys: completedKeys,
    creditsBalance: finalCreditsBalance,
  });
  
  // 更新缓存状态
  setTaskResult(actualTaskId, {
    ...currentResult,
    status: 'completed',
    imageItems: imageItems,
    completedAt: Date.now(),
  });
  
  break; // 完成后跳出循环
}
```

**修改文件**：
- `src/app/api/image-to-image/route.ts` - 检测到完成时立即发送 complete 事件

---

### #228 - 占位符只更新一张图片，轮询返回generating（待验证）

**问题描述**：
- 用户反馈：还是没返图！！！假轮询？
- 前端日志显示：`[GenService] #224 轮询数据 #12: {status: 'generating', imageUrls: 3, imageItems: 3, completedCount: 3}`
- 轮询返回 `status: 'generating'`，但 `completedCount: 3` 表示所有图片已完成
- 只收到了1张图片的更新（`[updatePlaceholder]` 只出现一次）

**诊断分析**：
1. 后端缓存中 `imageUrls` 有 3 个，`imageItems` 有 3 个
2. `completedCount: 3` 表示 3 张图片都完成了
3. 但 `status` 仍然是 `'generating'` 而不是 `'completed'`
4. 这说明 SSE 循环中的 `allDone` 检查没有触发，或者状态没有被正确更新

**可能原因**：
1. 异步回调更新了 `imageItems`，但 SSE 循环读取到的是旧数据
2. SSE 循环提前退出（`isControllerClosed` 为 true）
3. `allDone` 条件满足，但 `currentResult.status` 已经是 `'completed'` 或 `'failed'`

**修复方案（添加诊断日志）**：
```typescript
// #228 诊断：打印每个检查周期的详细状态
console.log(`[SSE] #228 检查完成状态: completedCount=${completedCount}, failedCount=${failedCount}, generationCount=${generationCount}, allDone=${allDone}, currentStatus=${currentResult.status}`);

// #228 诊断：打印每个检查周期的 imageItems 状态
console.log(`[SSE] #228 轮询检查: imageItems=${imageItems.length}, 已发送=${sentImageIndices.size}, 已发送失败=${sentFailedIndices.size}`);

// 异步回调中
// #228 诊断：打印更新后的 imageItems 状态
const completedItems = existingItems.filter(i => i.status === 'completed').length;
console.log(`[SSE] #228 异步回调更新缓存: index=${index}, status=completed, 已完成=${completedItems}/${generationCount}`);
```

**修改文件**：
- `src/app/api/image-to-image/route.ts` - 添加诊断日志

---

### #229 - 异步竞态条件导致占位符被误杀（已修复）

**问题描述**：
- 用户反馈：终端全成功，前端全显示失败！
- 日志显示竞态条件：
  1. `[getImageDimensions] 开始加载图片...` - 前端开始异步下载图片计算尺寸
  2. `[GenService] 收到 complete 事件` - 后端 complete 事件到达
  3. `[GenService] #211 占位符没有图片，标记为失败` - 误杀！
  4. `[getImageDimensions] 成功: 832×1248` - 图片下载完了，但占位符已被标记失败

**根因分析**：
1. SSE 收到 `image` 事件 → 调用 `onImageReceived` → `updatePlaceholder` 开始执行 `await getImageDimensions()`
2. 在等待期间（几百毫秒），SSE 收到 `complete` 事件
3. `complete` 事件处理器检查 `data.imageItems[index].url`，发现为空（因为 `onImageReceived` 还没更新完）
4. 触发 `onPlaceholderFailed`，把占位符标记为失败
5. 后来 `updatePlaceholder` 完成了，但占位符已经是失败状态

**修复方案**：
在 `complete` 事件处理中，跳过已在 SSE 流中收到的图片：
```typescript
// #229 关键修复：检查是否在 SSE 流中已经收到了这张图片
// 如果 completedIndices 包含该索引，说明 onImageReceived 已经被调用，正在异步处理中
// 此时不要做任何操作，让异步操作自然完成
if (completedIndices.has(p.index)) {
  console.log(`[GenService] #229 占位符 ${p.placeholderId} (index ${p.index}) 已在 SSE 流中收到，跳过 complete 处理，等待异步完成`);
  return; // 跳过，不做任何处理
}
```

**修改文件**：
- `src/hooks/useGenService.ts` - complete 事件处理中跳过已在 SSE 流收到的图片

---

## 常见问题速查

---

## 生产环境部署

### 一键部署命令

```bash
sh scripts/deploy.sh
```

### 手动部署步骤

```bash
# 1. 拉取代码
cd /var/www/kiikii && git pull origin main

# 2. 安装依赖 + 构建（网站仍可访问）
pnpm install --frozen-lockfile && pnpm run build

# 3. 闪电切换（网站仅闪断几秒）
pm2 kill && sudo fuser -k 5000/tcp || true
sleep 2
sudo chown -R ubuntu:ubuntu .

# 4. 启动服务
PORT=5000 pm2 start .next/standalone/server.js --name kiikii

# 5. 保存并检查
pm2 save && pm2 status && curl -I -s --max-time 3 http://localhost:5000 | head -3
```

### 常见部署问题

| 问题 | 解决方案 |
|------|----------|
| EACCES 权限错误 | `sudo chown -R ubuntu:ubuntu .` |
| EADDRINUSE 端口占用 | `sudo fuser -k 5000/tcp` |
| standalone 不存在 | 确保 `pnpm run build` 成功 |
| PM2 显示 errored | `pm2 kill` 后重新 `pm2 start` |

---

### 问题：终端出图但画布未显示

**检查项**：
1. `imageItems` 是否初始化？（#001）
2. SSE 流结束后是否查询任务状态？
3. 占位符是否正确创建和更新？

### 问题：积分扣费异常

**检查项**：
1. 是否双重扣费？（#014）
2. 返还是否有防重复？（#015）
3. 数据库是否一致？（#022）

### 问题：参考图相关

**检查项**：
1. 上传是否慢？（#023）
2. 刷新是否丢失？（#033, #034）
3. 发送是否阻塞？（#029）

### 问题：占位符相关

**检查项**：
1. 多任务是否只显示一张？（#001）
2. 刷新是否卡死？（#017）
3. 失败是否更新？（#002）

---

## 关键代码位置

| 功能 | 文件 | 说明 |
|------|------|------|
| 任务缓存初始化 | `src/app/api/image-to-image/route.ts` | #001 imageItems |
| 全局追踪器 | `src/hooks/useOptimisticUpload.ts` | #007, #029 |
| 签名URL缓存 | `src/lib/presigned-url-cache.ts` | #028 |
| 画布占位符 | `src/app/canvas/page.tsx` | #004, #006 |
| 积分扣费 | `src/lib/credits.ts` | #013, #014 |
| 生成服务 | `src/hooks/useGenService.ts` | #024, #025 |

---

## 最后更新

- 日期：2026-04-23
- 版本：v2.1（添加#233注意事项，标记可舍弃条目）

**可舍弃条目说明**：
- 标记"可舍弃"的条目是已合并到其他条目或仅包含诊断日志的记录
- 保留这些条目是为了历史追溯，精简时可删除
- 核心必读条目是理解项目关键问题的基础

---

### #209 - 数据库记录重复（CRITICAL）

**问题描述**：
- 军师反馈："生产环境的历史记录重复了！"
- 同一个任务产生多条数据库记录

**根因分析**：
1. 后端使用 `.insert()` 而非 `.upsert()`，每次保存都创建新记录
2. 前端虽然传了 `task_id`，但后端没有用于去重
3. 数据库表已有 `unique_generation_task_id` 唯一约束，但代码没用上

**修复方案**：
```typescript
// 1. 在 GenResult 接口添加 taskId
export interface GenResult {
  // ...
  taskId?: string;  // #209 新增：任务ID（用于幂等保存）
}

// 2. 后端改用 upsert
if (task_id) {
  query = client
    .from('generation_records')
    .upsert(insertData, { onConflict: 'task_id' })
    .select()
    .single();
} else {
  query = client
    .from('generation_records')
    .insert(insertData)
    .select()
    .single();
}

// 3. 前端传递 taskId
fetch('/api/generation-records', {
  method: 'POST',
  body: JSON.stringify({
    images: finalUrls,
    task_id: taskId,  // #209 新增：传递 taskId 用于幂等去重
    // ...
  }),
})
```

**修改文件**：
- `src/app/api/generation-records/route.ts` - 后端 upsert 逻辑
- `src/hooks/useGenService.ts` - GenResult 接口 + result 创建
- `src/app/canvas/page.tsx` - saveRecordWithCapturedRef 传递 taskId

---

### #210 - 生图页面终端返图但前端不更新（CRITICAL）

**问题描述**：
- 终端显示图片已生成
- 生图页面一直在"生成中"状态，不显示图片
- 定时检查任务状态始终返回 `generating`

**根因分析**：
1. GET 接口只在缓存不存在时才查询数据库
2. SSE 流断开后，缓存状态一直是 `generating`
3. 但数据库可能已经被 webhook 或其他方式写入了最终结果
4. 前端轮询永远拿不到 `completed` 状态

**修复方案**：
```typescript
// GET 方法中：如果缓存中任务状态是 generating 且已超过 60 秒，也去数据库检查
const shouldCheckDatabase = !result || (
  result.status === 'generating' && 
  Date.now() - result.createdAt > 60 * 1000
);

if (shouldCheckDatabase) {
  // 查询数据库，如果有结果则覆盖缓存的 generating 状态
  const { data } = await client
    .from('generation_records')
    .select('*')
    .eq('task_id', taskId)
    .maybeSingle();
  
  if (data) {
    // 数据库有结果，覆盖缓存
    result = { status: 'completed', ... };
    setTaskResult(taskId, result);
  }
}
```

**修改文件**：
- `src/app/api/image-to-image/route.ts` - GET 方法添加超时检查数据库逻辑

---

### #211 - 占位符显示"api请求失败"但不更新（CRITICAL）

**问题描述**：
- 终端收到任务，但占位符显示"api请求失败"
- 服务商返回4张，前端只收到3张
- 失败的占位符没有被正确标记

**根因分析**：
1. `onPlaceholderFailed` 回调传 `elementId`，但 `markPlaceholderFailed` 期望 `taskId`
2. 反向查找逻辑 `find(id => taskIdToElementIdRef.current.get(id) === elementId)` 有缺陷
3. `complete` 事件用 `.filter(r => r.imageUrl)` 过滤掉失败的占位符，导致不处理

**修复方案**：
```typescript
// 修复1：canvas/page.tsx - 直接用 elementId 更新元素状态
onPlaceholderFailed: (elementId, error) => {
  console.log('[onPlaceholderFailed] 标记失败:', { elementId, error });
  canvas.updateElement(elementId, { 
    generationStatus: 'failed', 
    generationError: error 
  });
},

// 修复2：useGenService.ts - complete 事件处理失败的占位符
placeholderReplacements.forEach(p => {
  const item = data.imageItems?.find((img: ImageItem) => img.index === p.index);
  const imageUrl = item?.url || '';
  
  if (imageUrl) {
    // 成功：加入替换列表
    replacements.push({ placeholderId: p.placeholderId, index: p.index, imageUrl, imageKey: item?.key });
  } else {
    // 失败：触发失败回调
    const errorMsg = data.errors?.find((e) => e.index === p.index)?.error || '生成失败';
    config.onPlaceholderFailed?.(p.placeholderId, errorMsg);
  }
});
```

**修改文件**：
- `src/app/canvas/page.tsx` - onPlaceholderFailed 回调
- `src/hooks/useGenService.ts` - complete 事件处理

---

### #214 - 开发环境占位符不更新（CRITICAL）

**问题描述**：
- 开发环境也出现"图出来了，占位符没有消失"
- SSE 流可能收到 `complete` 事件，但没有收到 `image` 事件
- 占位符保持 `generating` 状态

**根因分析**：
1. SSE 流正常时：`image` 事件 → `onImageReceived` → `updatePlaceholder` → 占位符更新 ✅
2. SSE 流异常时（事件被缓冲/丢失）：
   - 没有收到 `image` 事件
   - 直接收到 `complete` 事件 → `onComplete`
   - `onComplete` **没有处理 `placeholderReplacements`** → 占位符不更新 ❌

**修复方案**：
```typescript
// canvas/page.tsx - onComplete 添加兜底逻辑
onComplete: (result) => {
  // #214 修复：兜底处理占位符替换
  if (result.placeholderReplacements && result.placeholderReplacements.length > 0) {
    result.placeholderReplacements.forEach(p => {
      if (p.imageUrl && p.placeholderId) {
        const el = canvas.state.elements.find(e => e.id === p.placeholderId);
        if (el && el.generationStatus !== 'completed') {
          canvas.updateElement(p.placeholderId, {
            imageUrl: p.imageUrl,
            imageKey: p.imageKey,
            generationStatus: 'completed',
          });
        }
      }
    });
  }
  // ... 其他逻辑
}
```

**修改文件**：
- `src/app/canvas/page.tsx` - onComplete 回调添加兜底处理

---

### #215 - 占位符元素消失导致更新失败（CRITICAL）

**问题描述**：
- 生图成功后，占位符不消失
- 日志显示：`[updatePlaceholder] 查找元素: elementId=xxx, 找到=false null`
- `[onComplete] #214 元素不存在: elementId=xxx`

**根因分析**：
1. `updatePlaceholder` 在元素不存在时会重新添加元素（产生新 ID）
2. `taskIdToElementIdRef` 被更新为新 ID
3. 但 `onComplete` 的兜底逻辑使用的是 `placeholderReplacements.placeholderId`（旧 ID）
4. 导致兜底处理失败

**修复方案**：
```typescript
// #215 修复：优先使用 taskIdToElementIdRef 获取最新的 elementId
const taskId = clientTaskIds[p.index];
const latestElementId = taskId ? taskIdToElementIdRef.current.get(taskId) : undefined;
const elementIdToUse = latestElementId || p.placeholderId;

const el = canvas.state.elements.find(e => e.id === elementIdToUse);
if (el && el.generationStatus !== 'completed') {
  canvas.updateElement(elementIdToUse, {
    imageUrl: p.imageUrl,
    imageKey: p.imageKey,
    generationStatus: 'completed',
  });
} else if (!el) {
  // 元素确实不存在，尝试重新添加
  const pos = placeholderPositionsRef.current.get(taskId || '');
  if (pos && p.imageUrl) {
    const newElementId = canvas.addElement({...});
    taskIdToElementIdRef.current.set(taskId, newElementId);
  }
}
```

**修改文件**：
- `src/app/canvas/page.tsx` - onComplete 兜底逻辑使用最新 elementId

---

### #216 - HMR 后旧占位符不消失（CRITICAL）

**问题描述**：
- 开发环境 Fast Refresh 后，图片生成成功，但旧占位符还在显示
- 日志显示：`[updatePlaceholder] ⚠️ 元素不存在，尝试重新添加到画布`
- 新图片被添加，但旧占位符没有被删除

**根因分析**：
1. Fast Refresh 后，画布状态从 localStorage 恢复了旧的占位符元素
2. `taskIdToElementIdRef` 是 `useRef`，HMR 后映射可能丢失
3. `updatePlaceholder` 用旧 ID 查找元素，找不到就重新添加
4. **新元素添加成功，但旧占位符元素还在画布上**

**修复方案**：
```typescript
// #216 修复：先删除画布上相同 taskId 的旧占位符
const oldPlaceholders = canvas.state.elements.filter((el: any) => 
  el.generationTaskId === taskId && el.generationStatus === 'generating'
);
if (oldPlaceholders.length > 0) {
  console.log(`#216 删除旧占位符: ${oldPlaceholders.length} 个`);
  oldPlaceholders.forEach((el: any) => {
    canvas.deleteElement(el.id);
  });
}
// 然后再添加新元素
```

**修改文件**：
- `src/app/canvas/page.tsx` - `updatePlaceholder` 函数
- `src/app/canvas/page.tsx` - `onComplete` 兜底逻辑

---

### #217 - 占位符诊断日志

**问题描述**：
- 需要诊断为什么 `deleteElement` 没有执行

**解决方案**：
- 添加诊断日志，打印所有 `generating` 状态的元素
- 打印每个元素的 `generationTaskId` 和目标 `taskId`
- 打印匹配到的旧占位符数量

**修改文件**：
- `src/app/canvas/page.tsx` - `updatePlaceholder` 函数

---

### #218 - item_failed 后占位符状态变 failed（CRITICAL）

**问题描述**：
- 后端先发送 `item_failed` 事件，再发送 `image` 事件
- 收到 `item_failed` 后，占位符状态变为 `failed`
- 收到 `image` 后，`updatePlaceholder` 找不到 `generating` 状态的元素
- 重新添加元素，但旧的 `failed` 元素还在画布上

**根因分析**：
```
时间线：
1. 后端发送 item_failed 事件（因为违反策略）
2. 前端调用 onPlaceholderFailed → 元素状态变为 failed
3. 后端发送 image 事件（图片还是生成了）
4. 前端调用 updatePlaceholder → 找不到 generating 状态的元素（因为已经是 failed）
5. 前端重新添加元素 → 但旧的 failed 元素还在！
```

**解决方案**：
```typescript
// #218: 同时删除 generating 和 failed 状态的旧占位符
const oldPlaceholders = canvas.state.elements.filter((el: any) => 
  el.generationTaskId === taskId && (el.generationStatus === 'generating' || el.generationStatus === 'failed')
);
```

**修改文件**：
- `src/app/canvas/page.tsx` - `updatePlaceholder` 函数
- `src/app/canvas/page.tsx` - `onComplete` 兜底逻辑

---

### #219 - 占位符大小循环放大（CRITICAL）

**问题描述**：
- 每次生成新任务，占位符比上一个大
- zoom 越来越小，占位符越来越大

**根因分析**：
```
循环链路：
zoom小 → visibleWidth = container/zoom 大 → baseCellSize = visibleWidth/4 大
→ 占位符大 → 图片组大 → fitZoom 小 → zoom更小
```

**核心问题代码**（canvas-image-layout.ts 第 181-194 行）：
```javascript
// 罪恶之源：visibleWidth 依赖 zoom
const visibleWidth = safeContainerWidth / safeZoom;
const visibleHeight = safeContainerHeight / safeZoom;
// baseCellSize 又依赖 visibleWidth
baseCellSize = Math.min(visibleWidth, visibleHeight) / 4;
```

**解决方案**：常数锚点法
```typescript
// 🔧 #219 修复：占位符大小不依赖 zoom，使用容器尺寸固定比例
// 无限画布黄金法则：实体大小不反向依赖摄像机焦距（Zoom）
const placeholderBaseSize = Math.min(safeContainerWidth, safeContainerHeight) / 4;
baseCellSize = Math.max(50, placeholderBaseSize);  // 不依赖 zoom
```

**修改文件**：
- `src/lib/canvas-image-layout.ts` 第 181-194 行

---

### #221 - React闭包陷阱导致占位符不消失+图片重复（CRITICAL）

**问题描述**：
- 生图成功后占位符不消失（灰色方块一直转圈）
- 同一张图片出现多次（重复元素）
- 日志显示 `元素不存在，尝试重新添加到画布`

**根因分析**（军师"拍立得照片"的故事）：
```
1. 按下生成的瞬间（拍下旧照片）：
   - 系统启动任务，回调函数被创建
   - 由于 React 的机制，回调函数手里拿的是一张"老照片（旧状态的 canvas.state.elements）"
   - 在那张老照片里，画布是空的

2. 第一重分身（图来了，找不到坑）：
   - updatePlaceholder 触发，低头看手里的"老照片"
   - 发现：哎？没找到占位符啊！
   - 触发兜底逻辑："重新添加元素"
   - 结果：旧占位符在屏幕上傻转，画布上多了一张新图

3. 第二重分身（任务结束，兜底再坑一次）：
   - onComplete 触发，拿着另一张"老照片"又查了一遍
   - 发现：哎？这图怎么也没在画布上？
   - 又触发一次重新添加！
   - 结果：一模一样的图被加了两次！
```

**解决方案**（方案 C 双保险策略）：

**第一道防线**：使用 `stateRef` 获取最新元素（支持用户拖动后更新）
```typescript
// 🔧 #221 修复：方案 C 双保险策略
const liveElements = canvas.stateRef?.current?.elements || canvas.state.elements;
const currentEl = liveElements.find((el: any) => el.id === elementId);

if (currentEl) {
  // 🎯 第一道防线命中：使用实时位置更新（支持用户拖动）
  canvas.updateElement(elementId, { imageUrl, ... });
}
```

**第二道防线**：使用 `placeholderPositionsRef` 初始坐标兜底
```typescript
} else {
  // 🛡️ 第二道防线：使用初始坐标兜底
  const pos = placeholderPositionsRef.current.get(taskId);
  if (pos) {
    // 重新添加元素到画布
    canvas.addElement({ x: newX, y: newY, ... });
  } else {
    // 彻底失败：连初始坐标都找不到
    console.error(`彻底失败: 元素不存在且无初始坐标`);
  }
}
```

**为什么选方案 C？**
- ❌ 方案 A（纯 stateRef）：缺少最后一道防线，极端情况下图会丢失
- ❌ 方案 B（直接更新）：不支持用户拖动占位符，UX 反直觉
- ✅ 方案 C（双保险）：先找活人，找不到再查档案，终极防御

**修改文件**：
- `src/contexts/CanvasContext.tsx` - 添加 `stateRef` 到接口和 value
- `src/app/canvas/page.tsx` - `updatePlaceholder` 函数
- `src/app/canvas/page.tsx` - `onComplete` 兜底逻辑

---

### #222 - 参考图刷新后缩略图消失（CRITICAL）

**问题描述**：
- 刷新页面后，对话框中用户消息的参考图缩略图消失
- 日志显示：`恢复参考图, keys: ['']`，keys 是空字符串数组

**根因分析**：
```javascript
// ❌ 错误代码：闭包陷阱
setChatImageKeys(prev => {
  const newKeys = [...prev];
  const idx = chatImageMd5s.indexOf(md5);  // chatImageMd5s 是闭包里的旧值！
  if (idx >= 0 && idx < newKeys.length) newKeys[idx] = uploadData.key;
  return newKeys;
});
```

**时间线**：
1. 添加参考图时：`setChatImageKeys(prev => [...prev, ''])`，设置空字符串占位
2. 上传成功后：异步回调中用 `chatImageMd5s.indexOf(md5)` 查找索引
3. **问题**：`chatImageMd5s` 是闭包里的旧值，`indexOf` 返回 -1
4. 结果：key 没有被更新，仍然是空字符串 `['']`
5. 刷新页面后：`keys: ['']` 无法恢复图片

**解决方案**：
在设置占位时记录索引，更新时直接使用该索引：

```typescript
// 🔧 #222 修复：记录当前索引，避免闭包陷阱
const currentIdx = chatImageBase64s.length;
chatImageMd5ToIdxRef.current.set(md5, currentIdx);  // 存储 md5 -> 索引映射

// 上传成功后，使用 ref 获取索引
setChatImageKeys(prev => {
  const newKeys = [...prev];
  const idx = chatImageMd5ToIdxRef.current.get(md5);  // 从 ref 获取索引
  if (idx !== undefined && idx >= 0 && idx < newKeys.length) {
    newKeys[idx] = uploadData.key;
  }
  return newKeys;
});
```

**修改文件**：
- `src/app/canvas/page.tsx` - 添加 `chatImageMd5ToIdxRef`
- `src/app/canvas/page.tsx` - `handleAddReferenceImage` 函数
- `src/app/canvas/page.tsx` - `handleReferenceImageUpload` 函数

---

### #223 - 同一历史记录生成两次（CRITICAL）

**问题描述**：
- 用户只在画布页面生图，但历史记录出现两条相同记录
- 来源不同：一条"画布"，一条"生图"
- 时间不同：生图 11:16:53，画布 11:16:55（相差2秒）

**根因分析**：
```
layout.tsx: AIGeneratorProvider (外层)
canvas/page.tsx: AIGeneratorProvider (内层)  ❌ 多余！
```

画布页面有**两层 `AIGeneratorProvider`**：
1. 内层 Provider 触发保存，`source: 'canvas'`
2. 外层 Provider 也触发某种回调，保存了另一条记录

**解决方案**：
移除画布页面多余的 `AIGeneratorProvider`，因为 `layout.tsx` 已经有了：

```diff
- import { AIGeneratorProvider, useAIGenerator } from '@/contexts/AIGeneratorContext';
+ import { useAIGenerator } from '@/contexts/AIGeneratorContext';

  return (
    <CanvasProvider>
-     <AIGeneratorProvider>
        <div ...>
          <MainApp />
        </div>
-     </AIGeneratorProvider>
    </CanvasProvider>
  );
```

**修改文件**：
- `src/app/canvas/page.tsx` - 移除 `AIGeneratorProvider` 包裹和 import

---

### #230 - 轮询status滞后导致无限循环（CRITICAL）

**问题描述**：
- 轮询日志显示：`{status: 'generating', imageUrls: 4, imageItems: 4, completedCount: 4}`
- `completedCount: 4` 说明所有图片都完成了
- 但 `status: 'generating'` 状态没有更新为 'completed'
- 轮询无限继续，前端无法识别任务完成

**根因分析**：
后端 GET 请求返回时，直接使用缓存中的 `status`，没有根据 `completedCount` 重新计算：

```javascript
// 问题代码
return new Response(JSON.stringify({ 
  ...result,  // status 直接使用缓存值
  completedCount,  // 虽然 completedCount 正确
}), ...);
```

**解决方案**：
1. **后端**：GET 请求返回时，如果所有图片都完成，修正 status 为 'completed'
2. **前端**：轮询时，如果 `completedCount >= generationCount`，也认为任务完成

```javascript
// 后端修复
const allDone = completedCount + failedCount >= totalCount;
let finalStatus = result.status;
if (allDone && result.status === 'generating') {
  finalStatus = completedCount > 0 ? 'completed' : 'failed';
}

// 前端修复
if (actualCompletedCount >= generationCount) {
  console.log(`[GenService] #230 后端状态滞后，但 completedCount 已达标，认为完成`);
  return { status: 'completed', ... };
}
```

**修改文件**：
- `src/app/api/image-to-image/route.ts` - GET 请求状态修正

---

### #231 - 历史记录重复（ID分裂）（CRITICAL）

**问题描述**：
- 用户在画布页面生图后，历史记录出现两条记录
- 示例：画布显示 04/22 13:44:45，生图页面显示 04/22 13:44:44
- 两条记录内容相同但 ID 不同

**根因分析**：
1. **ID 生成策略分裂**：画布页面用 `Date.now()`，生图页面用 `taskId`
2. **两套独立保存逻辑**：两个页面各自调用 `saveRecordToLocal`
3. **去重逻辑失效**：因为 ID 不同，`r.id === record.id` 无法去重
4. **全局状态幽灵复活**：`AIGeneratorProvider` 包裹所有页面，一个页面的操作可能触发另一个页面的保存

**解决方案（军师方案）**：
1. **单一保存点**：废除两边页面的独立保存逻辑，由 `AIGeneratorContext` 统一保存
2. **taskId 作为主键**：使用 `taskId` 作为历史记录的主键（天然去重）
3. **Upsert 语义**：存在则更新，不存在则插入

```javascript
// HistoryRecordsDialog.tsx - Upsert 语义
export function saveRecordToLocal(record: HistoryRecord) {
  const existingIndex = records.findIndex(r => r.id === record.id);
  if (existingIndex >= 0) {
    records[existingIndex] = record;  // 更新
  } else {
    records.unshift(record);  // 插入
  }
}

// AIGeneratorContext.tsx - 单一保存点
// #231 单一保存点：统一保存历史记录
if (genResult.taskId && genResult.imageUrls && genResult.imageUrls.length > 0) {
  const record: HistoryRecord = {
    id: genResult.taskId,  // 使用 taskId 作为主键
    model: genResult.model || options.model || '',
    prompt: genResult.prompt || options.prompt || '',
    images: genResult.imageUrls,
    // ...
    source: genResult.source || 'generate',
  };
  saveRecordToLocal(record);
}
```

**修改文件**：
- `src/components/HistoryRecordsDialog.tsx` - `saveRecordToLocal` 改为 Upsert 语义，`HistoryRecord.id` 类型改为 `string | number`
- `src/hooks/useGenService.ts` - `GenResult` 和 `TaskStatus` 接口添加 `source`, `prompt`, `model` 等字段
- `src/contexts/AIGeneratorContext.tsx` - 添加 `onComplete` 回调中的保存逻辑
- `src/app/canvas/page.tsx` - 删除独立的 `saveRecordToLocal` 调用

**架构改进**：
- UI 层只负责渲染，逻辑层负责数据
- 单一数据源：useGenService 生产记录 → AIGeneratorContext 消费记录
- 前端承担防御职责，避免后端 OOM
- `src/hooks/useGenService.ts` - 轮询时检查 completedCount

---

### #232 - 历史记录保存失败（CRITICAL）

**问题描述**：
- 用户生成图片成功，但历史记录不展示
- 控制台日志：`[AIGeneratorContext] #232 API 返回失败: 保存失败`
- API 返回详细错误：`there is no unique or exclusion constraint matching the ON CONFLICT specification`（错误代码 `42P10`）

**根因分析**（两层问题）：

**第一层：React 闭包陷阱**
```javascript
// ❌ 问题代码：onComplete 回调中的 userId 是闭包捕获的旧值
onComplete: async (result) => {
  const response = await fetch('/api/generation-records', {
    body: JSON.stringify({
      user_id: userId,  // 闭包陷阱！userId 可能是 null
    }),
  });
}
```

**第二层：Supabase JS upsert 兼容性问题**
```javascript
// ❌ 问题代码：Supabase JS 的 onConflict 参数与 PostgREST 不兼容
const { data, error } = await client
  .from('generation_records')
  .upsert(insertData, { onConflict: 'task_id' });
// 错误：42P10 - no unique or exclusion constraint matching ON CONFLICT
```

**诊断过程**：
1. 检查 `localStorage.getItem('userId')` 返回 `null` → 误判为"用户未登录"
2. 实际用户已登录，`userId` 存储在 React state 中，但闭包陷阱导致回调拿到旧值
3. 添加 `userIdRef` 解决闭包问题后，API 仍然返回失败
4. 详细错误信息：PostgreSQL 错误代码 `42P10`
5. 测试验证：
   - Supabase JS `upsert` + `onConflict: 'task_id'` → ❌ 失败
   - REST API 直接调用 + `?on_conflict=task_id` → ✅ 成功
   - 结论：Supabase JS 与 PostgREST 存在兼容性问题

**解决方案**：

**修复1：前端 - 解决 React 闭包陷阱**
```typescript
// AIGeneratorContext.tsx
const userIdRef = useRef<string | null>(null);

// 在 refreshUserInfo 时同步更新 ref
const refreshUserInfo = async () => {
  const user = await fetchUserWithCache();
  if (user) {
    setUserId(user.id);
    userIdRef.current = user.id;  // #232 修复：同步更新 ref
    console.log('[AIGeneratorContext] 用户信息刷新成功, userId:', user.id);
  }
};

// onComplete 回调中使用 ref.current 获取最新值
onComplete: async (result) => {
  const currentUserId = userIdRef.current;  // 使用 ref 获取最新值
  const response = await fetch('/api/generation-records', {
    body: JSON.stringify({
      user_id: currentUserId,
    }),
  });
}
```

**修复2：后端 - 绕过 Supabase JS upsert 兼容性问题**
```typescript
// generation-records/route.ts - 改用"先查询后决定"策略
if (task_id) {
  // 1. 先查询记录是否存在
  const { data: existingRecord, error: queryError } = await client
    .from('generation_records')
    .select('id')
    .eq('task_id', task_id)
    .maybeSingle();  // #232 修复：使用 maybeSingle() 处理不存在的情况

  if (existingRecord) {
    // 2a. 记录存在，执行更新
    const result = await client
      .from('generation_records')
      .update(insertData)
      .eq('id', existingRecord.id)
      .select()
      .single();
    record = result.data;
    error = result.error;
  } else {
    // 2b. 记录不存在，执行插入
    const result = await client
      .from('generation_records')
      .insert(insertData)
      .select()
      .single();
    record = result.data;
    error = result.error;
  }
}
```

**修改文件**：
- `src/contexts/AIGeneratorContext.tsx` - 添加 `userIdRef`，`refreshUserInfo` 同步更新，`onComplete` 使用 `ref.current`
- `src/app/api/generation-records/route.ts` - 改用"先查询后决定"策略替代 `upsert`

---

### #233 - 参考图发送到服务商失败（CRITICAL）

**问题描述**：
- 用户上传参考图成功，前端日志显示参考图已被捕获
- 后端日志显示参考图已转换为 URL 并发送给服务商
- 服务商终端却没有收到参考图信息

**诊断过程**：
1. 检查前端日志：`{base64sCount: 1, urlsCount: 1, keysCount: 1}` - 参考图存在
2. 检查后端日志：`[参考图] 转换base64为URL, localUrls= [...]` - 转换成功
3. 检查服务商请求日志：`hasImages: true, imageCount: 1` - 发送了参考图

**根因分析**：
问题在于 `replaceTemplateVariables` 函数处理数组类型变量时，将数组转换成了 JSON 字符串：

```javascript
// 数据库中的 request_body_template
{
  "urls": "${urls}",   // 模板中是字符串类型
  "prompt": "${prompt}"
}

// 替换后的实际请求体（错误）
{
  "urls": "[\"https://...\"]",  // ❌ 字符串，不是数组！
  "prompt": "一只可爱的猫"
}

// 服务商期望的请求体（正确）
{
  "urls": ["https://..."],  // ✅ 真正的数组
  "prompt": "一只可爱的猫"
}
```

`replaceTemplateVariables` 函数的问题代码：
```javascript
// ❌ 问题代码：直接返回 JSON.stringify，导致数组变成字符串
if (Array.isArray(value)) {
  return JSON.stringify(value);  // 返回 "[\"url\"]" 而不是 ["url"]
}
```

**解决方案**：
修改 `replaceTemplateVariables` 函数，当整个字符串就是一个占位符 `${xxx}` 且变量是数组/对象时，直接返回原值（保持类型）：

```typescript
export function replaceTemplateVariables(
  template: string,
  variables: Record<string, any>
): any {  // 返回类型改为 any，因为可能返回数组/对象
  // 检查是否整个字符串就是一个占位符 ${xxx}
  const exactMatch = template.match(/^\$\{(\w+)\}$/);
  if (exactMatch) {
    const varName = exactMatch[1];
    if (varName in variables) {
      const value = variables[varName];
      // 如果是数组或对象，直接返回原值（保持类型）
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        return value;  // ✅ 直接返回数组，不转字符串
      }
      return String(value);
    }
    return template;
  }

  // 非完全匹配的情况，进行字符串内替换
  return template.replace(/\$\{(\w+)\}/g, (match, varName) => {
    // ... 原有逻辑
  });
}
```

**修改文件**：
- `src/lib/api-config.ts` - `replaceTemplateVariables` 函数添加完全匹配检测，数组/对象直接返回原值

**⚠️ 边界情况注意**：
如果模板字符串是**拼接形式**（如 `"prefix_${urls}"` 或 `"${prompt} suffix"`），数组仍然会被 JSON.stringify 成字符串。这是预期行为，因为字符串拼接无法保持数组类型。当前数据库配置没有这种情况，但如果未来需要拼接数组，应设计新的模板语法。

---

### #234 - 历史记录缺失积分扣除数值（CRITICAL）

**问题描述**：
- 用户反馈历史记录中偶尔缺失积分扣除数值
- 参考图问题和积分缺失是两个独立的 bug

**根因分析**：
GET 方法从数据库恢复任务结果时，**没有读取 `credits_charged` 和 `credits_balance` 字段**：

```javascript
// 当前的代码（有问题）
result = {
  status: 'completed' as const,
  imageUrls: validUrls,
  imageKeys: data.image_keys || [],
  // ... 其他字段
  // ❌ 缺少 creditsCharged 和 creditsBalance！
};
```

**影响场景**：
1. SSE 流正常完成 → 前端收到 `creditsCharged` → ✅ 正常
2. SSE 流中断，轮询获取结果 → GET 从数据库恢复 → ❌ 缺失积分信息

**解决方案**：

1. 在 `TaskResult` 接口添加积分字段：
```typescript
export interface TaskResult {
  // ... 其他字段
  // #233 积分信息（用于历史记录显示）
  creditsCharged?: number;
  creditsBalance?: number;
}
```

2. GET 方法从数据库恢复时读取积分字段：
```typescript
result = {
  // ... 其他字段
  // #233 修复：从数据库恢复积分信息，避免历史记录缺失积分扣除数值
  creditsCharged: data.credits_charged ?? undefined,
  creditsBalance: data.credits_balance ?? undefined,
};
```

**修改文件**：
- `src/lib/taskResultsCache.ts` - `TaskResult` 接口添加 `creditsCharged` 和 `creditsBalance` 字段
- `src/app/api/image-to-image/route.ts` - GET 方法从数据库恢复时读取积分字段
**关键教训**：
1. **闭包陷阱**：React 回调中访问 state 时，必须使用 `useRef` 或函数式更新获取最新值
2. **第三方库兼容性**：Supabase JS 的 `upsert` 方法与 PostgREST 存在兼容性问题，复杂场景建议使用原生 SQL 或"先查询后决定"策略
3. **错误信息增强**：API 返回错误时应包含完整的 PostgreSQL 错误信息（code、message、details、hint），便于快速定位问题

---

### #235 - 参考图发送失败（Localhost 陷阱 + 前端优先级错误）（CRITICAL）⚠️ 必读

**问题描述**：
- 用户上传参考图成功，但服务商终端没有收到参考图信息
- 日志显示：`[参考图] 转换base64为URL, localUrls= ['https://kiikii.me/api/ref-img/xxx']`
- 服务商访问 `https://kiikii.me/api/ref-img/xxx` 返回 404

**根因分析（三个问题）**：

**问题1：前端优先级错误（CRITICAL）⚠️**
```javascript
// 错误逻辑：优先使用 base64
const hasValidBase64 = capturedRefImages.base64s.length > 0 && ...;
const images = hasValidBase64 ? capturedRefImages.base64s : validUrls;
const isUrls = !hasValidBase64 && validUrls.length > 0;
```
- 有 base64 预览 → `hasValidBase64 = true` → `isUrls = false`
- 后端走 base64 → 本地代理路径 → 404！

**问题2：Localhost 陷阱**
- 图片存储在本地开发环境的 `/tmp` 目录
- 但生成的 URL 指向生产服务器 `kiikii.me`
- 生产服务器没有这张图片，必然 404

**问题3：字段名不匹配**
- 旧架构发送 `urls` 字段
- 服务商 API 期望 `referenceImages` 字段

**修复方案**：

1. **修改前端优先级**：
```javascript
// 🔧 #235 修复：优先使用 COS URL，而不是 base64
const hasValidUrls = validUrls.length > 0;
const images = hasValidUrls ? validUrls : (hasValidBase64 ? base64s : []);
const isUrls = hasValidUrls;  // 使用 COS URL 时 isUrls = true
```

2. **上传到 COS**：
```typescript
// 之前：存储到本地 /tmp
// 现在：直接上传到 COS，返回 COS 公网 URL
const { url } = await uploadToCOS(key, buffer, mimeType);
```

3. **旧架构添加 referenceImages 字段**：
```typescript
const legacyRequestBody = {
  ...requestBody,
  referenceImages: requestBody.urls || [],
};
```

**修改文件**：
- `src/app/canvas/page.tsx` - 优先使用 COS URL
- `src/app/api/upload-ref/route.ts` - 上传到 COS
- `src/app/api/image-to-image/route.ts` - 旧架构添加 referenceImages
- `src/app/generate/page.tsx` - #235 补充修复：彻底禁用 Base64 降级

**#235 补充修复（生图页面）**：

生图页面 `/generate/page.tsx` 存在相同问题，执行以下修复：

1. **删除误删 URL 的毒瘤**（第989-996行）：
```javascript
// ❌ 删除：页面加载时清空 referenceImageUrls
useEffect(() => {
  if (referenceImageUrls.length > 0) {
    setReferenceImageUrls([]);
  }
}, []);
```

2. **彻底禁用 Base64 降级**（第1749-1751行，第1795-1797行）：
```javascript
// ❌ 错误：降级到 Base64
const images = validUrls.length > 0 ? validUrls : referenceImages;

// ✅ 正确：只用 URL，纯文生图传空数组
const images = validUrls;  // 不再降级到 Base64
```

3. **修复再次生成逻辑**（第2268-2274行）：
```javascript
// ❌ 错误：优先使用 Base64
if (task.params.referenceImages && task.params.referenceImages.length > 0) {
  setReferenceImages(task.params.referenceImages);
  setReferenceImageUrls([]);
}

// ✅ 正确：只加载 URL，丢弃旧数据中的 Base64
if (task.params.referenceImageUrls && task.params.referenceImageUrls.length > 0) {
  setReferenceImageUrls(task.params.referenceImageUrls);
  setReferenceImages([]);
} else {
  setReferenceImageUrls([]);
  setReferenceImages([]);
  // 丢弃旧数据中的 Base64
}
```

**禁用 Base64 的原因**：
- Base64 payload 过大会导致服务器和框架报 413 错误
- 外部服务商对请求体大小有限制
- COS URL 更稳定、更高效

**关键教训**：
1. **URL 优先原则**：COS URL > base64，服务商才能访问
2. **Localhost 陷阱**：外部服务商无法访问本地机器
3. **三套数据同步**：chatImageUrls/chatImageBase64s/chatImageKeys 必须保持一致
4. **isUrls 正确设置**：使用 URL 时 isUrls = true，使用 base64 时 isUrls = false

---

### #236 - 沙盒数据库彻底清理（CRITICAL）⚠️ 必读

**问题描述**：
- 项目中存在多个包含沙盒数据库配置的临时脚本
- `exec_sql` 工具默认连接沙盒数据库，导致误判

**清理内容**：
- 删除所有 `*.cjs` 临时脚本（21个）
- 删除 `sql/` 目录下的临时 SQL 文件
- 项目中不再存在任何沙盒数据库配置

**新增军规**（第六条 - 沙盒隔离原则）：
```markdown
### 6. 沙盒隔离原则（Sandbox Isolation）

- **禁止使用 exec_sql 工具**：`exec_sql` 工具默认连接沙盒数据库，返回的数据不是用户真实数据。
- **查询真实数据库**：必须使用 Node.js 脚本直接连接用户真实数据库。
- **禁止沙盒配置**：项目中不允许存在任何沙盒数据库的 URL、Key 或连接字符串。
```

**删除的文件**：
- `compare-all-databases.cjs` - 包含沙盒数据库配置
- `compare-databases.cjs` - 包含沙盒数据库配置
- `compare-tables.cjs` - 包含沙盒数据库配置
- `compare-users.cjs` - 包含沙盒数据库配置
- `migrate-tables.cjs` - 包含沙盒数据库配置
- `check-unused-tables.cjs` - 包含沙盒数据库配置
- `get-table-schema.cjs` - 包含沙盒数据库配置
- 其他 14 个临时脚本
- `sql/create-redeem-usage.sql`
- `sql/drop-unused-tables.sql`

**诊断方法**：
```bash
# ✅ 正确：使用 Node.js 脚本查询真实数据库
node -e "
const { getSupabaseClient } = await import('./src/storage/database/supabase-client.ts');
const supabase = getSupabaseClient();
const { data } = await supabase.from('users').select('*');
console.log(JSON.stringify(data, null, 2));
"

# ❌ 错误：使用 exec_sql 工具（连接沙盒数据库）
```

**诊断方法**：
```bash
# 使用 Node.js 脚本查询真实数据库
node --experimental-vm-modules -e "
const { getSupabaseClient } = await import('./src/storage/database/supabase-client.ts');
const supabase = getSupabaseClient();
const { data } = await supabase.from('api_models').select('*');
console.log(JSON.stringify(data, null, 2));
"
```

---

### #237 - 再次生成历史记录缺失（CRITICAL）⚠️ 必读

**问题描述**：
- 生图页面"再次生成"功能正常，但历史记录偶尔缺失
- 正常生成有记录，再次生成没有记录

**根因分析**：
1. **绕过 Context**：再次生成直接调用 `/api/image-to-image`，绕过了 `AIGeneratorContext`
2. **保存逻辑缺失**：`done` 事件处理只更新本地状态，没有调用保存 API
3. **注释误导**：代码注释写"由 AIGeneratorContext 统一保存"，但实际没有调用

**修复方案（DRY 原则）**：

**第一步：Context 暴露统一保存方法**
```typescript
// AIGeneratorContext.tsx
const saveHistoryRecord = useCallback(async (params) => {
  await fetch('/api/generation-records', {
    method: 'POST',
    body: JSON.stringify({ ...params, user_id: userId }),
  });
}, [userId]);

// 在 value 中暴露
return { ..., saveHistoryRecord };
```

**第二步：页面调用统一方法（副作用剥离）**
```typescript
// generate/page.tsx
// 1. 使用局部变量累积图片（避免闭包陷阱）
const collectedImages: string[] = [];
const collectedKeys: string[] = [];

// 2. image 事件时累积
if (data.type === 'image' && data.url) {
  collectedImages[data.index] = data.url;
  // ... 同时更新状态
}

// 3. done 事件时：先更新状态（纯函数），再调用保存（副作用）
} else if (data.type === 'done') {
  // 纯函数：更新状态
  setTasks(prev => prev.map(t => 
    t.id === newTaskId ? { ...t, status: 'completed' } : t
  ));
  
  // 副作用：保存历史记录（在 setTasks 外部）
  if (collectedImages.length > 0) {
    saveHistoryRecord({ taskId: newTaskId, images: collectedImages, ... });
  }
}
```

**关键教训**：
1. **DRY 原则**：保存逻辑必须收敛到单一数据源（Context）
2. **React 反模式**：禁止在 `setState(prev => ...)` 内部执行副作用
3. **闭包陷阱**：使用局部变量累积数据，避免在回调中访问旧状态

**修改文件**：
- `src/contexts/AIGeneratorContext.tsx` - 新增 `saveHistoryRecord` 方法
- `src/app/generate/page.tsx` - 调用统一方法，剥离副作用

**诊断方法**：
```javascript
// 检查再次生成是否调用保存 API
console.log(`[再次生成] #237 保存历史记录: taskId=${newTaskId}, creditsCharged=${requiredCredits}`);
```

**关键修复点**：
1. `newTask` 必须设置 `creditsCharged` 字段
2. 使用 `requiredCredits`（局部变量）而非 `task.creditsCharged`（可能是 undefined）
3. `saveHistoryRecord` 参数直接使用 `newTask.params.xxx` 和局部变量，不依赖 `tasks` 状态
4. 添加调试日志：`console.log('[saveHistoryRecord] 保存参数:', params)`

---

### #238 - 轮询分支历史记录缺失（CRITICAL）⚠️ 必读

**问题描述**：
- 生图页面"再次生成"功能完成后，历史记录中没有该任务
- 日志显示任务是通过 `[定时检查]`（轮询逻辑）发现并标记为完成的
- 之前修复的 `saveHistoryRecord` 只覆盖了 SSE 流的 `done` 事件（平行线 A），遗漏了轮询分支（平行线 B）

**根因分析**：

**两条任务完成路径**：
```
平行线 A：SSE 流 → done 事件 → setTasks + saveHistoryRecord ✅
平行线 B：轮询检查 → 定时检查完成 → setTasks → ❌ 没有调用 saveHistoryRecord
```

**致命遗漏**：
- 在轮询分支中，当检测到任务完成时，只调用了 `setTasks` 更新状态
- 没有调用 `saveHistoryRecord` 保存历史记录
- 导致轮询成功的任务永远不会落库，也不会进入历史记录

**修复方案**：

在 `generate/page.tsx` 的轮询完成分支（约第 1312-1336 行）添加 `saveHistoryRecord` 调用：

```typescript
if (result.status === 'completed' && result.imageUrls) {
  console.log(`[定时检查] 更新任务 ${result.task.id} 状态为 completed, 图片数量: ${result.imageUrls.length}`);
  
  // #238 修复：提取图片 keys（用于历史记录持久化）
  const imageKeys = result.imageItems
    ?.filter((item: any) => item.key)
    .map((item: any) => item.key);
  
  setTasks(prev => {
    // ... 更新状态逻辑
    return updatedTasks;
  });
  
  // #238 修复：轮询分支保存历史记录（在 setTasks 外部调用，避免异步陷阱）
  if (result.imageUrls.length > 0 && result.task.params) {
    saveHistoryRecord({
      taskId: result.task.id,
      model: result.task.params.model,
      prompt: result.task.params.prompt,
      images: result.imageUrls,
      imageKeys: imageKeys && imageKeys.length > 0 ? imageKeys : undefined,
      referenceImages: result.task.params.referenceImages || [],
      resolution: result.task.params.resolution,
      aspectRatio: result.task.params.aspectRatio,
      creditsCharged: result.task.creditsCharged,
      source: 'regenerate',  // 轮询完成的任务通常是"再次生成"
    });
    console.log(`[定时检查] #238 保存历史记录: taskId=${result.task.id}, images=${result.imageUrls.length}, creditsCharged=${result.task.creditsCharged}`);
  }
}
```

**关键教训**：
1. **分支覆盖**：所有任务完成路径（SSE、轮询、WebSocket 等）都必须调用保存逻辑
2. **副作用剥离**：保存 API 调用必须在 `setTasks` 外部执行，不能在纯函数内部
3. **参数完整**：必须包含 taskId、images、model、creditsCharged、source 等
4. **避免闭包陷阱**：使用 `result` 对象中的数据，不依赖状态更新后的 `tasks`

**修改文件**：
- `src/app/generate/page.tsx` - 轮询分支添加 `saveHistoryRecord` 调用

**诊断方法**：
```javascript
// 检查轮询完成是否调用保存 API
console.log(`[定时检查] #238 保存历史记录: taskId=${result.task.id}, images=${result.imageUrls.length}`);
```

---

### #239 - 参考图删除后Ref残留（CRITICAL）⚠️ 必读

**问题描述**：
- 用户删除旧参考图并上传新参考图后，生成的图片是正确的
- 但存入历史记录的参考图数组（reference_images）里会同时包含"已删除的旧图"和"新图"

**根因分析**：

**State vs Ref 异步陷阱**：
```typescript
// 删除函数只更新了 State 变量
const handleRemoveReferenceImage = (index: number) => {
  setReferenceImages(referenceImages.filter((_, i) => i !== index));
  setReferenceImageUrls(referenceImageUrls.filter((_, i) => i !== index));
  setReferenceImageMd5s(referenceImageMd5s.filter((_, i) => i !== index));
  setReferenceImageKeys(referenceImageKeys.filter((_, i) => i !== index));
  // ❌ 遗漏：没有同步更新 Ref 变量！
};

// 但生成时使用的是 Ref 变量
const finalReferenceImageKeys = referenceImageKeysRef.current;  // 还是旧值！
const finalReferenceImageUrls = referenceImageUrlsRef.current;  // 还是旧值！
```

**Ref 同步是异步的**：
```typescript
// useEffect 是异步的，用户删除后立即点击生成，useEffect 可能还没执行
useEffect(() => {
  referenceImageKeysRef.current = referenceImageKeys;
}, [referenceImageKeys]);
```

**修复方案**：

**1. 删除时同步更新 Ref**：
```typescript
const handleRemoveReferenceImage = (index: number) => {
  // 1. 更新 State 变量
  setReferenceImages(referenceImages.filter((_, i) => i !== index));
  setReferenceImageUrls(referenceImageUrls.filter((_, i) => i !== index));
  setReferenceImageMd5s(referenceImageMd5s.filter((_, i) => i !== index));
  setReferenceImageKeys(referenceImageKeys.filter((_, i) => i !== index));
  
  // 2. #239 立即同步更新 Ref 变量（避免闭包陷阱）
  referenceImageKeysRef.current = referenceImageKeysRef.current.filter((_, i) => i !== index);
  referenceImageUrlsRef.current = referenceImageUrlsRef.current.filter((_, i) => i !== index);
  referenceImageMd5sRef.current = referenceImageMd5sRef.current.filter((_, i) => i !== index);
  
  console.log('[删除参考图 #239] 同步清理 State + Ref, index:', index);
};
```

**2. 发送前强制过滤空值（兜底保护）**：
```typescript
// 使用前强制过滤，确保数据干净
const finalReferenceImageKeys = referenceImageKeysRef.current.filter(key => key && key.length > 0);
const finalReferenceImageUrls = referenceImageUrlsRef.current.filter(url => url && url.length > 0);
const finalReferenceImageMd5s = referenceImageMd5sRef.current.filter(md5 => md5 && md5.length > 0);
```

**关键教训**：
1. **State 和 Ref 双写**：删除操作必须同时更新 State 和 Ref，不能只更新 State
2. **Ref 不是实时同步**：useEffect 是异步的，不能依赖它来同步关键数据
3. **防御性过滤**：在使用前强制过滤空值，确保数据干净
4. **三套数据一致性**：referenceImages、referenceImageUrls、referenceImageKeys、referenceImageMd5s 四个数组必须同步更新

**修改文件**：
- `src/app/generate/page.tsx`
  - `handleRemoveReferenceImage` 函数（约第 1669-1683 行）- 同步更新 Ref
  - `handleStartGeneration` 函数（约第 1784-1791 行）- 强制过滤空值
  - `handleGenerate` 调用（约第 1837 行）- 使用过滤后的 MD5

---

### #240 - 再次生成幽灵 MD5 + 无限上传中（CRITICAL）⚠️ 必读

**问题描述**：
1. **幽灵 MD5**：点击"再次生成"后，旧参考图消失，重新上传同一张图时，MD5 检测认为已存在（因为 Ref 没清空），但 State 已清空，所以 UI 不显示
2. **无限上传中**：MD5 重复时提前 return，但没有递减 `uploadingCount` 计数器，导致按钮永久卡在"上传中"状态
3. **无法重复选同一张图**：DOM 的 file input 没有在 finally 中清空，导致异常时无法重新选择同一文件

**根因分析**：

**问题 1：幽灵 MD5**
```typescript
// handleRegenerate 只更新了 State
setReferenceImageUrls(task.params.referenceImageUrls);
setReferenceImages([]);

// 但没有同步更新 Ref！
// referenceImageMd5sRef.current 还是旧值
// 导致重新上传同一张图时 MD5 检测认为已存在
```

**问题 2：无限上传中**
```typescript
// handleReferenceImageUpload 开始时递增计数
setUploadingCount(prev => prev + files.length);

// processUploadFiles 中 MD5 重复时直接 return
if (existingMd5s.includes(result.md5)) {
  console.log('图片已存在，跳过:', file.name);
  return;  // ❌ 没有调用 onBackgroundComplete！
}

// 导致 setUploadingCount(prev => Math.max(0, prev - 1)) 永远不会执行
```

**问题 3：无法重复选同一张图**
```typescript
// event.target.value = '' 在 await 之后执行
await processUploadFiles(files, { ... });
event.target.value = '';  // 如果中间抛异常，这行不会执行
```

**修复方案**：

**1. handleRegenerate：同步清空/填充 State + Ref**
```typescript
if (task.params.referenceImageUrls && task.params.referenceImageUrls.length > 0) {
  const urls = task.params.referenceImageUrls;
  const keys = task.params.referenceImageKeys || [];
  const md5s = task.params.referenceImageMd5s || [];
  
  // 同步设置所有 State
  setReferenceImageUrls(urls);
  setReferenceImageKeys(keys);
  setReferenceImageMd5s(md5s);
  setReferenceImages([]);
  
  // #240 关键：立即同步更新 Ref
  referenceImageUrlsRef.current = [...urls];
  referenceImageKeysRef.current = [...keys];
  referenceImageMd5sRef.current = [...md5s];
} else {
  // 彻底清空所有 State 和 Ref
  setReferenceImageUrls([]);
  setReferenceImageKeys([]);
  setReferenceImageMd5s([]);
  setReferenceImages([]);
  
  referenceImageUrlsRef.current = [];
  referenceImageKeysRef.current = [];
  referenceImageMd5sRef.current = [];
}
```

**2. useOptimisticUpload：MD5 重复时也调用回调**
```typescript
if (existingMd5s.includes(result.md5)) {
  console.log('图片已存在，跳过:', file.name);
  // #240 修复：通知调用方，让 uploadingCount 能正确递减
  onBackgroundComplete?.({
    fileName: file.name,
    md5: result.md5,
    url: '',
    key: '',
    success: false,
    error: '图片已存在，已跳过',
  });
  return;
}
```

**3. handleReferenceImageUpload：finally 清空 input**
```typescript
try {
  await processUploadFiles(files, { ... });
  toast.success('参考图已添加');
} finally {
  // #240 关键修复：无论成功、失败还是拦截，都清空 input
  event.target.value = '';
}
```

**关键教训**：
1. **State 和 Ref 必须同步更新**：加载历史任务时要同时更新 State 和 Ref
2. **所有分支都要递减计数器**：MD5 重复、上传失败等拦截情况也要通知调用方
3. **清理 DOM 状态放 finally**：确保无论发生什么都会执行
4. **Ref 是幽灵的藏身之处**：任何涉及 State 清空的操作都要检查对应的 Ref

**修改文件**：
- `src/app/generate/page.tsx`
  - `handleRegenerate` 函数（约第 2288-2330 行）- 同步更新 State + Ref
  - `handleReferenceImageUpload` 函数（约第 1566-1677 行）- finally 清空 input
- `src/hooks/useOptimisticUpload.ts`
  - `processFiles` 函数（约第 258-262 行）- MD5 重复时也调用回调

---

### #241 - 参考图清空点 Ref 遗漏（CRITICAL）⚠️ 必读

**问题描述**：
肖哥亲自测试发现：点击"再次生成"后，旧参考图消失，重新上传同一张图被拦截（MD5 检测认为已存在），但 State 已清空，UI 不显示。说明除了 `handleRegenerate`，还有其他隐藏的清空点只清空了 State，遗漏了清空 Ref。

**根因分析**：

**地毯式排查发现的 4 个漏网之鱼**：

| 位置 | 代码行 | 问题 |
|------|--------|------|
| "清空"按钮 onClick | 约 2597 行 | 只清空 State，未清空 Ref |
| onSelectPrompt（从历史记录选择） | 约 3228-3248 行 | 设置 State，未同步 Ref |
| 从画布加载图片 | 约 1198-1236 行 | 设置 referenceImages，未清空其他数组和 Ref |
| 拖拽排序 | 约 2666-2672 行 | 更新 State，未同步 Ref |

**修复方案**：

**1. "清空"按钮 onClick**
```typescript
onClick={() => {
  setReferenceImages([]);
  setReferenceImageUrls([]);
  setReferenceImageMd5s([]);
  setReferenceImageKeys([]);
  // #241 修复：同步清空 Ref
  referenceImageUrlsRef.current = [];
  referenceImageKeysRef.current = [];
  referenceImageMd5sRef.current = [];
}}
```

**2. onSelectPrompt（从历史记录选择）**
```typescript
if (selectedRefImages && selectedRefImages.length > 0) {
  setReferenceImageUrls(selectedRefImages);
  setReferenceImages([]);
  setReferenceImageKeys([]);
  setReferenceImageMd5s([]);
  // #241 修复：同步更新 Ref
  referenceImageUrlsRef.current = [...selectedRefImages];
  referenceImageKeysRef.current = [];
  referenceImageMd5sRef.current = [];
} else {
  // #241 没有 referenceImages 时也要清空 Ref
  setReferenceImageUrls([]);
  setReferenceImages([]);
  setReferenceImageKeys([]);
  setReferenceImageMd5s([]);
  referenceImageUrlsRef.current = [];
  referenceImageKeysRef.current = [];
  referenceImageMd5sRef.current = [];
}
```

**3. 从画布加载图片**
```typescript
// 设置参考图时，清空其他数组并同步 Ref
setReferenceImages(imageUrls);
setReferenceImageUrls([]);  // 画布发送的是临时 URL
setReferenceImageKeys([]);
setReferenceImageMd5s([]);
// 同步更新 Ref
referenceImageUrlsRef.current = [];
referenceImageKeysRef.current = [];
referenceImageMd5sRef.current = [];
```

**4. 拖拽排序**
```typescript
// 交换位置后同步更新 State + Ref
setReferenceImages(newImages);
setReferenceImageUrls(newUrls);
setReferenceImageKeys(newKeys);
setReferenceImageMd5s(newMd5s);
// #241 修复：同步更新 Ref
referenceImageUrlsRef.current = [...newUrls];
referenceImageKeysRef.current = [...newKeys];
referenceImageMd5sRef.current = [...newMd5s];
```

**关键教训**：
1. **地毯式排查**：搜索 `setReferenceImages([])` 等模式，找出所有清空点
2. **State + Ref 双写**：任何设置/清空参考图的操作，都要同步更新 Ref
3. **四个数组一体**：`referenceImages`、`referenceImageUrls`、`referenceImageKeys`、`referenceImageMd5s` 必须同步更新
4. **Ref 是幽灵藏身之处**：每次修改 State 都要检查对应的 Ref

**修改文件**：
- `src/app/generate/page.tsx`
  - "清空"按钮 onClick（约第 2597 行）
  - onSelectPrompt（约第 3228-3248 行）
  - 从画布加载图片（约第 1198-1236 行）
  - 拖拽排序（约第 2666-2672 行）

---

### #242 - 再次生成幽灵 MD5 + 历史记录未存 MD5（CRITICAL）⚠️ 必读

**问题描述**：
肖哥发来截图：点击右侧面板的【再次生成】按钮后，旧参考图在 UI 上消失了，但重新上传同一张图时被拦截（提示"图片已存在，跳过上传"）。

**根因分析**：

1. **乐观更新未同步 Ref**：`onOptimisticUpdate` 中只更新了 State（`referenceImageMd5s`），没有同步更新 Ref（`referenceImageMd5sRef.current`）。Ref 依赖 useEffect 异步同步，用户快速操作时 Ref 可能还没更新。

2. **历史记录未存储 MD5**：`saveHistoryRecord` 方法缺少 `referenceImageMd5s` 参数，导致历史记录中没有保存参考图的 MD5。当用户点击"再次生成"时，`task.params.referenceImageMd5s` 是空的。

**修复方案**：

**1. onOptimisticUpdate 同步更新 Ref**
```typescript
// #242 关键修复：立即同步更新 MD5 Ref，避免幽灵 MD5
referenceImageMd5sRef.current = [...referenceImageMd5sRef.current, result.md5].slice(0, 6);
```

**2. saveHistoryRecord 添加 referenceImageMd5s 参数**

AIGeneratorContext.tsx 接口定义：
```typescript
saveHistoryRecord: (params: {
  // ... 其他参数
  referenceImages?: string[];
  referenceImageMd5s?: string[];  // #242 新增
  // ...
}) => Promise<boolean>;
```

调用时传递参数：
```typescript
saveHistoryRecord({
  // ... 其他参数
  referenceImages: originalRefUrls,
  referenceImageMd5s: originalRefMd5s,  // #242 新增
  // ...
});
```

**关键文件**：
- `src/app/generate/page.tsx`
  - onOptimisticUpdate 回调（约第 1626 行）
  - saveHistoryRecord 调用（第 1362、2543 行）
- `src/contexts/AIGeneratorContext.tsx`
  - saveHistoryRecord 接口定义（第 210 行）
  - saveHistoryRecord 实现（第 610 行）

---

### #243 - 军师方案：全时监听+联动清空+计数器精准修复（CRITICAL）⚠️ 必读

**问题描述**：
肖哥测试发现 #241 和 #242 修复后 Bug 依然存在：
- 点击右侧面板【再次生成】后，旧参考图消失了
- 重新上传同一张图时被拦截（提示"图片已存在，跳过上传"）

**根因分析**：

1. **State 和 Ref 不同步**：虽然修复了多处清空点，但仍有遗漏。Ref 通过 useEffect 异步同步，用户快速操作时 Ref 可能还没更新。

2. **uploadingCount 计数不匹配**：`setUploadingCount(prev => prev + files.length)` 使用的是用户选择的文件数，但实际处理的文件数可能少于这个数（槽位不足或 MD5 重复），导致计数器永远不归零。

**修复方案（军师方案）**：

**1. 全时监听 + 联动清空（useEffect）**
```typescript
// #243 军师方案：全时监听 + 联动清空
// 核心逻辑：只要 URL 数组被清空，MD5 和 Keys 的 Ref 也必须瞬间清空
useEffect(() => {
  referenceImageUrlsRef.current = referenceImageUrls;
  // #243 关键：联动清空 - URL 数组清空时，MD5 Ref 也必须清空
  // 这是防止"幽灵 MD5"的最后一道防线
  if (referenceImageUrls.length === 0) {
    referenceImageMd5sRef.current = [];
    referenceImageKeysRef.current = [];
    console.log('[#243 全时监听] URL 数组清空，联动清空 MD5/Keys Ref');
  }
}, [referenceImageUrls]);
```

**2. 计数器精准递增**
```typescript
// #243 关键修复：先计算实际会处理的文件数，再递增 uploadingCount
// 原问题：直接用 files.length 递增，但如果槽位不足，实际处理的文件数少于递增数，导致计数器永远不归零
const remainingSlots = 6 - referenceImages.length;
const actualProcessCount = Math.min(files.length, Math.max(0, remainingSlots));

if (actualProcessCount === 0) {
  toast.warning('已达到最大上传数量（6张）');
  event.target.value = '';
  return;
}

// 设置正在上传的数量（只计算实际会处理的）
setUploadingCount(prev => prev + actualProcessCount);
```

**关键教训**：
1. **全时监听是最后一道防线**：State 和 Ref 的同步不能只依赖手动同步，必须有一道自动同步的防线
2. **计数器要精准**：递增的数量必须和实际处理的数量匹配，否则会永远卡住
3. **联动清空**：相关联的数组清空时，必须一起清空

**关键文件**：
- `src/app/generate/page.tsx`
  - useEffect 同步 Ref（第 616-632 行）
  - handleReferenceImageUpload（约第 1594-1710 行）

---

### #244 - 数据库字段缺失导致 reference_image_md5s 无法存储（CRITICAL）⚠️ 必读

**问题描述**：
肖哥测试发现右侧面板【再次生成】按钮的 Bug 依然存在。点击后旧参考图消失，重新上传同一张图被拦截。

**根因分析**：
1. **数据库表中没有 `reference_image_md5s` 字段**：代码中已添加该字段的存储和查询逻辑，但数据库表中没有这个字段
2. **历史记录无法存储 MD5**：导致"再次生成"时 `task.params.referenceImageMd5s` 永远是空数组
3. **无法匹配正确的参考图**：前端 MD5 检测认为图片已存在，但实际上是新图片

**修复方案**：

**1. 添加 API fallback 逻辑**
```typescript
// 存储时 fallback
if (error && error.message && (
  error.message.includes('reference_image_md5s') ||
  error.message.includes('reference_image_keys')
)) {
  const fallbackData = { ...insertData };
  delete fallbackData.reference_image_md5s;
  delete fallbackData.reference_image_keys;
  // 重新尝试插入...
}

// 查询时 fallback
if (error && error.message && error.message.includes('reference_image_md5s')) {
  // 回退到不包含 reference_image_md5s 的查询...
}
```

**2. 返回字段补充**
```typescript
return { 
  ...record, 
  reference_image_md5s: record.reference_image_md5s || [],
};
```

**3. 类型定义补充**
```typescript
interface GenerationRecord {
  // ...
  reference_image_md5s?: string[];  // #244 新增
}
```

**⚠️ 必须在 Supabase Dashboard 中执行 SQL**：
```sql
-- #244 添加 reference_image_md5s 字段
ALTER TABLE generation_records 
ADD COLUMN IF NOT EXISTS reference_image_md5s TEXT[] DEFAULT '{}';

-- 如果 source 字段也不存在
ALTER TABLE generation_records 
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'generate';
```

**Dashboard 地址**：
https://ozdlvxxoufkiazddvxys.supabase.co/project/ozdlvxxoufkiazddvxys/sql

**4. TaskResult 类型定义添加字段**
```typescript
// src/lib/taskResultsCache.ts
interface TaskResult {
  // ...
  requestParams?: {
    // ...
    referenceImageMd5s?: string[];      // #244 新增
    referenceImageUrls?: string[];     // #244 新增
    referenceImageKeys?: string[];     // #244 新增
  };
}
```

**5. setTaskResult 调用时传递参考图字段**
```typescript
// src/app/api/image-to-image/route.ts（第 817 行）
setTaskResult(actualTaskId, {
  // ...
  requestParams: {
    prompt,
    model,
    resolution,
    aspectRatio,
    generationCount,
    referenceImageMd5s: md5Hashes || [],       // #244 新增
    referenceImageUrls: images || [],          // #244 新增
    referenceImageKeys: [],                    // #244 新增
  },
});
```

**6. GET 方法从数据库恢复时包含参考图字段**
```typescript
// src/app/api/image-to-image/route.ts（第 1493 行）
requestParams: {
  prompt: data.prompt || '',
  model: data.model || 'nano-banana',
  resolution: data.resolution || '1K',
  aspectRatio: data.aspect_ratio || 'auto',
  generationCount,
  referenceImageMd5s: data.reference_image_md5s || [],   // #244 新增
  referenceImageUrls: data.reference_images || [],       // #244 新增
  referenceImageKeys: data.reference_image_keys || [],   // #244 新增
},
```

**关键文件**：
- `src/app/api/generation-records/route.ts`
  - GenerationRecord 类型定义（第 7-18 行）
  - GET 方法 fallback 逻辑（第 65-80 行）
  - POST 方法 fallback 逻辑（第 327-360 行）
  - 记录转换返回字段（第 206-215 行）
- `src/lib/taskResultsCache.ts`
  - TaskResult 类型定义
- `src/app/api/image-to-image/route.ts`
  - setTaskResult 调用（第 817 行）
  - GET 方法数据库恢复（第 1493 行）

---

### #247 - 再次生成记录不显示在历史列表

**问题**：点击"再次生成"后，新任务保存成功（API 落库成功），但 UI 历史列表不显示

**根因**：`HistoryRecordsDialog.tsx` 的 `source` 过滤逻辑只支持 `'canvas' | 'generate'`，而"再次生成"的 `source` 是 `'regenerate'`，被过滤掉了

**修复**：

**1. 扩展 source 类型（HistoryRecordsDialog.tsx 第 18-22 行）**
```typescript
interface HistoryRecordsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: 'canvas' | 'generate' | 'regenerate' | 'smart_split' | 'video'; // #247 扩展：支持所有来源
}
```

**2. 修改过滤逻辑（HistoryRecordsDialog.tsx 第 48-60 行）**
```typescript
// 本地过滤后的记录（用于 source 过滤）
// #247 修复：generate 包含 regenerate，两者在 UI 上应显示在一起
const historyRecords = useMemo(() => {
  if (source) {
    if (source === 'generate') {
      // generate 来源包括：generate, regenerate, smart_split, video
      return storeRecords.filter(r => 
        ['generate', 'regenerate', 'smart_split', 'video'].includes(r.source || '')
      );
    }
    return storeRecords.filter(r => r.source === source);
  }
  return storeRecords;
}, [storeRecords, source]);
```

---

### #248 - GET API 未返回 source 字段导致过滤失败

**问题**：#247 修复后历史记录仍然不显示，根因是 GET API 的 `.select()` 查询中**没有包含 `source` 字段**

**根因**：
```typescript
// 第 101 行和第 114 行的 .select() 中缺少 source
.select('id, images, image_keys, model, prompt, resolution, aspect_ratio, reference_images, reference_image_keys, reference_image_md5s, task_id, videos, credits_charged, credits_balance, requested_count, success_count, credits_per_image, refund_amount, created_at', { count: 'exact' })
```

**修复**：在 `.select()` 中添加 `source` 字段
```typescript
.select('id, images, image_keys, model, prompt, resolution, aspect_ratio, reference_images, reference_image_keys, reference_image_md5s, task_id, videos, credits_charged, credits_balance, requested_count, success_count, credits_per_image, refund_amount, created_at, source', { count: 'exact' })
```

**关键文件**：
- `src/app/api/generation-records/route.ts`
  - 第 101 行：时间筛选查询
  - 第 114 行：普通查询

**影响**：
- 查询返回的数据中 `record.source` 是 `undefined`
- 过滤逻辑 `['generate', 'regenerate', ...].includes(r.source || '')` 中 `r.source || ''` 变成空字符串
- 空字符串不在允许列表中，所有记录被过滤掉

**关键文件**：
- `src/components/HistoryRecordsDialog.tsx`
  - source 类型定义（第 18-22 行）
  - 过滤逻辑（第 48-60 行）

## #250 强制清空 + 全量过滤（2025-01）

### 问题
用户极度不满意之前的"打地鼠"式修复，要求执行全系统级别的强制同步逻辑。

### 根因
1. `handleRegenerate` 函数没有在第一行强制清空所有 State 和 Ref
2. 历史记录页面过滤逻辑已有，但需要确认
3. MD5 拦截逻辑已有，但需要确认

### 修复内容

#### 1. handleRegenerate 强制清空（generate/page.tsx 第 2351-2362 行）
在函数第一行（登录检查后）强制清空所有 State 和 Ref：
```typescript
// #250 强制清空：在设置新参数前，物理抹除一切旧指纹
setReferenceImageUrls([]);
setReferenceImageKeys([]);
setReferenceImageMd5s([]);
setReferenceImages([]);
referenceImageUrlsRef.current = [];
referenceImageKeysRef.current = [];
referenceImageMd5sRef.current = [];
setUploadingCount(0);  // 确保上传按钮的计数器归零
```

#### 2. 历史记录页面过滤逻辑（history/page.tsx 第 239-242 行）
已正确实现全量过滤：
```typescript
const validSources = ['generate', 'regenerate', 'canvas', 'smart_split', 'video'];
if (record.source && !validSources.includes(record.source)) {
  return false;
}
```

#### 3. MD5 拦截逻辑（useOptimisticUpload.ts 第 259-271 行）
已正确实现计数器递减：
```typescript
if (existingMd5s.includes(result.md5)) {
  onBackgroundComplete?.({
    fileName: file.name,
    md5: result.md5,
    url: '',
    key: '',
    success: false,
    error: '图片已存在，已跳过',
  });
  return;
}
```

### 修改文件
- `src/app/generate/page.tsx`
  - handleRegenerate 函数开头强制清空所有 State 和 Ref
  - 简化后续逻辑，删除重复清空代码

### 状态
✅ 已修复

---

## #282 积分返还逻辑分散导致漏返（CRITICAL）⚠️ 必读

**问题描述**：
- 用户反馈积分返还失败，部分失败场景下积分未返还
- 原因：积分返还逻辑散落在 6 个不同位置，代码重复且逻辑不一致

**根因分析**：
```
原返还逻辑分布（问题）：
├─ 点1: 所有图片提交失败（第1103行）
├─ 点2: SSE部分失败（第1208行）
├─ 点3: 任务全部失败（第1270行）
├─ 点4: SSE完成时提取失败（第1317行）
├─ 点5: 超时场景（第1420行）
└─ 点6: webhook回调（第488行）

问题：
1. 部分失败时 status='completed'，不进入失败返还逻辑
2. 各点使用闭包旧变量 `currentResult`，可能已过期
3. 代码重复，难以维护
```

**修复方案**：
提取统一的 `handlePartialRefund` 函数，所有返还逻辑集中到一个入口：

```typescript
// lib/credits.ts
export async function handlePartialRefund(
  getTaskResultFn: (taskId: string) => any,
  setTaskResultFn: (taskId: string, result: any) => void,
  taskId: string,
  imageItems: Array<{ index: number; status: string; error?: string | null }>,
  generationCount: number,
  creditsPerImage: number,
  userId: string,
  reason: string = '部分图片失败'
): Promise<{ success: boolean; refundAmount: number; newBalance: number | null }> {
  // Step 1: 获取最新状态
  const latestResult = getTaskResultFn(taskId);
  
  // Step 2: 防重检查
  if (latestResult?.creditsRefunded) {
    return { success: false, refundAmount: 0, newBalance: null };
  }
  
  // Step 3: 计算失败数量
  const failedCount = imageItems.filter(item => item.status === 'failed').length;
  
  // Step 4: 无失败则跳过
  if (failedCount === 0) return { success: false, refundAmount: 0, newBalance: null };
  
  // Step 5: 执行返还
  const refundAmount = failedCount * creditsPerImage;
  const refundResult = await refundCredits(userId, refundAmount, taskId, reason);
  
  // Step 6: 标记已返还
  if (refundResult.success) {
    const afterRefundResult = getTaskResultFn(taskId);
    setTaskResultFn(taskId, { ...afterRefundResult, creditsRefunded: true });
  }
  
  return { success: refundResult.success, refundAmount, newBalance: refundResult.remaining };
}
```

**调用方式**：
```typescript
// 所有返还点统一调用
const refundResult = await handlePartialRefund(
  getTaskResult,
  setTaskResult,
  taskId,
  imageItems,
  generationCount,
  creditsPerImage,
  userId,
  '返还原因'
);
```

**修改文件**：
- `src/lib/credits.ts`：新增 `handlePartialRefund` 函数
- `src/app/api/image-to-image/route.ts`：替换 5 处返还逻辑
- `src/app/api/webhook/draw-callback/route.ts`：替换 1 处返还逻辑

**核心优势**：
1. **全局唯一入口**：所有积分返还必须通过此函数
2. **自带防重**：内置 `creditsRefunded` 检查，多次调用安全
3. **原子操作**：获取最新状态 → 检查 → 返还 → 标记
4. **易于维护**：只需维护一个函数

### 状态
✅ 已修复（2025-01）
---

## #279 onError 连坐问题（CRITICAL）⚠️ 必读

**问题描述**：
- 用户反馈："3张任务，2张成功，1张超时，结果2张成功的也被标记为超时失败"
- onError 回调遍历所有 `clientTaskIds`，而非实际失败的占位符

**根因分析**：
```typescript
// ❌ 原代码（第 3626 行）
onError: (error) => {
  clientTaskIds.forEach(id => {  // 遍历所有占位符，连坐！
    markPlaceholderFailed(id, displayError);
  });
}
```

**修复方案**：
使用 `error.placeholderIds` 精准定位失败的占位符：
```typescript
// ✅ 修复后
onError: (error) => {
  const failedIds = error.placeholderIds || clientTaskIds;  // 精准定位
  console.log('[Canvas onError] 待标记失败的占位符:', failedIds);
  failedIds.forEach(id => {
    markPlaceholderFailed(id, displayError);
  });
}
```

**修改文件**：
- `src/app/canvas/page.tsx` 第 3626-3642 行

### 状态
✅ 已修复

---

## #280 再次生成积分不实时更新（CRITICAL）⚠️ 必读

**问题描述**：
- 用户点击"再次生成"按钮，积分扣除没有实时显示
- 最终积分正确，但过程不透明，用户无法感知扣费

**根因分析**：
```typescript
// ❌ 原代码（第 2465 行）
const response = await fetch('/api/image-to-image', {
  method: 'POST',
  body: JSON.stringify(requestBody),
});
// 没有 onCreditsDeducted 回调！
```

**修复方案**：
复用 `handleGenerate` 统一入口，自动获得积分实时更新：
```typescript
// ✅ 修复后
await handleGenerate({
  prompt: task.params.prompt,
  model: task.params.model,
  // ...
  onImageReceived: (data) => { /* 更新任务卡片 */ },
  onComplete: (result) => { /* 保存历史记录 */ },
  onError: (error) => { /* 错误处理 */ },
});
// handleGenerate 内部自动调用 setCredits，积分实时更新
```

**关键点**：
- `handleGenerate` 内部定义了 `onCreditsDeducted` 回调
- 自动调用 `setCredits(data.creditsBalance)` 更新积分
- 无需外部传递 `onCreditsDeducted` 参数

**修改文件**：
- `src/app/generate/page.tsx` 第 2380-2550 行（重写 `handleRegenerate` 函数）

**代码简化**：
- 删除了 ~230 行 SSE 手动处理代码
- 复用 `handleGenerate` 的统一入口
- 自动获得：积分更新、轮询、错误处理、历史记录保存

### 状态
✅ 已修复

---

## #278 积分双重返还（TOCTOU竞态）（CRITICAL）⚠️ 必读

**问题描述**：
- 用户反馈："一次6积分，10次任务，有1次失败，后端直接返还54积分（应为6积分）"
- 积分返还过程异常：先返还54，再逐次扣除成功的积分
- 最终数值正确，但过程显示严重错误

**根因分析**：
后端存在 **TOCTOU（Time-of-Check-Time-of-Use）竞态条件**：

1. **第1206行缺少 `creditsRefunded` 检查**：
   ```typescript
   // ❌ 原代码（第1206行）
   if (failedCount > 0 && creditsDeducted && actualUserId && creditsPerImage > 0) {
     // 直接返还，没有检查 creditsRefunded！
   }
   ```

2. **使用闭包旧变量而非最新状态**：
   - 多处返还逻辑使用外层循环中的 `currentResult` 变量
   - 该变量可能持有过期状态，导致多个返还逻辑同时通过检查

**修复方案**：

### 核心原则：执行返还前必须重新获取最新状态

```typescript
// ❌ 错误：使用外层循环的 currentResult（可能是旧值）
if (creditsDeducted && actualUserId && !currentResult.creditsRefunded) {
  await refundCredits(...);
}

// ✅ 正确：返还前重新获取最新状态
const latestResult = getTaskResult(actualTaskId);
if (creditsDeducted && actualUserId && !latestResult?.creditsRefunded) {
  await refundCredits(...);
  // 返还后立即标记
  const afterRefundResult = getTaskResult(actualTaskId);
  if (afterRefundResult) {
    setTaskResult(actualTaskId, { ...afterRefundResult, creditsRefunded: true });
  }
}
```

### 修复的所有调用点

| 文件 | 行号 | 修复内容 |
|------|------|----------|
| `image-to-image/route.ts` | 1206-1223 | 添加 `latestResultForRefund` 检查 |
| `image-to-image/route.ts` | 1268-1284 | 添加 `latestResultForFailedRefund` 检查 |
| `image-to-image/route.ts` | 1315-1335 | 添加 `latestResultForSSERefund` 检查 |
| `image-to-image/route.ts` | 1417-1436 | 添加 `latestResultForTimeoutRefund` 检查 |
| `draw-callback/route.ts` | 486-508 | 添加 `latestResultForWebhookRefund` 检查 |

### 修改文件
- `src/app/api/image-to-image/route.ts`
  - 第 1206 行：添加 `latestResultForRefund` 获取 + `creditsRefunded` 检查
  - 第 1268 行：添加 `latestResultForFailedRefund` 获取 + `creditsRefunded` 检查
  - 第 1315 行：添加 `latestResultForSSERefund` 获取 + `creditsRefunded` 检查
  - 第 1417 行：添加 `latestResultForTimeoutRefund` 获取 + `creditsRefunded` 检查
- `src/app/api/webhook/draw-callback/route.ts`
  - 第 486 行：添加 `latestResultForWebhookRefund` 获取 + `creditsRefunded` 检查

### 防御铁律

1. **所有 `refundCredits` 调用前必须有 `creditsRefunded` 检查**
2. **检查必须使用最新获取的状态，禁止使用闭包变量**
3. **返还后立即标记 `creditsRefunded: true`**

### 状态
✅ 已修复（2025-01）

---

## #275 - 安全漏洞修复：MIME伪造 + SSRF + execSync（CRITICAL）⚠️ 安全核心

**问题描述**：
服务器遭到黑客入侵，发现以下安全漏洞：
1. 文件上传接口仅检查 `file.type`（由客户端提供，可伪造）
2. 图片代理接口无域名白名单限制，存在 SSRF 风险
3. `fileLock.ts` 使用 `execSync('sleep 0.01')` 执行系统命令

**漏洞详情**：

### 漏洞 1：MIME Type 伪造（高危）
**位置**：`src/app/api/canvas/upload/route.ts:75-81`

**漏洞代码**：
```typescript
// 只检查 file.type（可被黑客伪造！）
const allowedFormats = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
if (!allowedFormats.includes(file.type)) { ... }
```

**攻击方式**：
```bash
curl -X POST https://your-site.com/api/canvas/upload \
  -F "file=@shell.sh;type=image/jpeg"  # 伪装成 JPEG
```

### 漏洞 2：SSRF 攻击（高危）
**位置**：`src/app/api/proxy-image/route.ts:85`

**漏洞代码**：
```typescript
// 直接 fetch 用户提供的 URL，无任何限制！
const response = await fetch(imageUrl, { ... });
```

**攻击方式**：
```bash
# 访问云服务元数据，窃取敏感信息
curl "https://your-site.com/api/proxy-image?url=http://169.254.169.254/latest/meta-data/"
```

### 漏洞 3：execSync 执行系统命令（中危）
**位置**：`src/lib/fileLock.ts:64`

**漏洞代码**：
```typescript
require('child_process').execSync('sleep 0.01');
```

**修复方案**：

### 1. 新增魔数验证工具（src/lib/file-validator.ts）
```typescript
// 通过文件前几个字节的特征值验证真实类型
export function detectFileType(buffer: Buffer): { mime: string; ext: string } | null {
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && ...) {
    return { mime: 'image/png', ext: 'png' };
  }
  // ... 其他格式
}

export function validateImageFile(buffer: Buffer, declaredMime?: string): 
  { valid: boolean; detectedType?: { mime: string; ext: string }; error?: string } {
  const detectedType = detectFileType(buffer);
  if (!detectedType) {
    return { valid: false, error: '文件不是有效的图片格式' };
  }
  return { valid: true, detectedType };
}
```

### 2. 新增 URL 验证工具（src/lib/url-validator.ts）
```typescript
// 域名白名单
const ALLOWED_PROXY_DOMAINS = [
  'cos.ap-hongkong.myqcloud.com',
  'api.mmw.ink',
  // ... 其他允许的域名
];

// 私有 IP 检测
const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
];

export function validateUrlSync(url: string): { valid: boolean; error?: string } {
  // 1. 检查协议（只允许 http/https）
  // 2. 检查是否为私有 IP
  // 3. 检查域名白名单
}
```

### 3. 修复文件上传接口
**位置**：`src/app/api/canvas/upload/route.ts`

```typescript
import { validateUploadedFile } from '@/lib/file-validator';

// 🔒 安全增强：使用魔数验证文件真实类型
const validation = await validateUploadedFile(file);
if (!validation.valid) {
  return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
}

// 使用检测到的真实 MIME 类型
const actualMimeType = validation.detectedType!.mime;
```

### 4. 修复图片代理接口
**位置**：`src/app/api/proxy-image/route.ts`

```typescript
import { validateUrlSync } from '@/lib/url-validator';

// 🔒 安全增强：SSRF 防护
const urlValidation = validateUrlSync(imageUrl);
if (!urlValidation.valid) {
  return NextResponse.json(
    { error: 'URL 不在允许的白名单中，禁止访问' },
    { status: 403 }
  );
}
```

### 5. 移除 execSync
**位置**：`src/lib/fileLock.ts`

```typescript
// ❌ 旧代码
require('child_process').execSync('sleep 0.01');

// ✅ 新代码：使用纯 JavaScript 实现
function syncWait(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // 忙等待（10ms 是可接受的）
  }
}
```

### 修改文件
- `src/lib/file-validator.ts`：新增，魔数验证工具
- `src/lib/url-validator.ts`：新增，URL 安全验证工具
- `src/app/api/canvas/upload/route.ts`：使用魔数验证
- `src/app/api/upload-reference/route.ts`：使用魔数验证
- `src/app/api/canvas/upload-base64/route.ts`：使用魔数验证
- `src/app/api/proxy-image/route.ts`：添加 SSRF 防护
- `src/lib/fileLock.ts`：移除 execSync

### 安全最佳实践
1. **永远不要信任客户端数据**：`file.type`、`Content-Type` 都可被伪造
2. **验证文件内容**：使用魔数（Magic Bytes）验证文件真实类型
3. **限制网络请求**：添加域名白名单，禁止访问私有 IP
4. **避免系统命令**：尽量不要使用 `exec`、`spawn` 等函数

### 状态
✅ 已修复

---

### #272 - 管理后台积分流水查看入口 CRITICAL ⚠️ 必读

**问题描述**：
- #271 建立了统一积分流水表 `credit_logs`，但管理员无法在后台查看
- 数据"存了但看不见"，双式记账法无法落地

**解决方案**：
在管理后台新增"积分流水"Tab，提供完整的流水查询功能。

**功能特性**：
1. **流水列表**：展示所有积分变动记录
   - 用户信息（昵称、ID）
   - 变动金额（正数绿色、负数红色）
   - 变动后余额
   - 类型（生成扣费/返还/充值/后台调整/兑换）
   - 关联ID（taskId/keyCode等）
   - 描述
   - 时间

2. **筛选功能**：
   - 按用户ID筛选
   - 按类型筛选（全部/生成扣费/返还/充值/后台调整/兑换）
   - 按时间范围筛选（开始日期-结束日期）

3. **分页功能**：
   - 每页50条
   - 上一页/下一页按钮
   - 显示总记录数和当前页码

**修改文件**：
- `src/app/api/linjiaqi/credit-logs/route.ts` - 新增API接口
- `src/app/linjiaqi/page.tsx` - 新增Tab和UI组件

**API接口**：
```
GET /api/linjiaqi/credit-logs
参数：
- page: 页码（默认1）
- page_size: 每页条数（默认50）
- user_id: 用户ID筛选
- type: 类型筛选（all/generate/refund/recharge/admin_adjust/exchange）
- start_date: 开始日期
- end_date: 结束日期

返回：
{
  data: [...],  // 流水记录列表
  pagination: {
    page: 1,
    pageSize: 50,
    total: 270,
    totalPages: 6
  }
}
```

**兼容性**：
- 支持 `deduct` 类型（旧数据兼容）
- 支持 `generate` 类型（新数据）

### 状态
✅ 已修复


---

### #271 - 双式记账法（统一流水表）CRITICAL ⚠️ 必读

**问题描述**：
- 积分变动缺乏统一追踪，无法追溯历史
- 风控预警缺乏数据基础
- 多套流水表（credit_refund_logs）导致查询分散

**根因分析**：
积分变动分散在多个 API 中，没有统一的流水记录。

**解决方案**：
建立统一积分流水表 `credit_logs`，所有积分变动都写入此表。

**数据库 DDL**：
```sql
-- 扩展 credit_logs 表（原址升级）
ALTER TABLE credit_logs ADD COLUMN IF NOT EXISTS reference_id VARCHAR(255);
ALTER TABLE credit_logs ADD COLUMN IF NOT EXISTS description TEXT;

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_credit_logs_reference_id ON credit_logs(reference_id);

-- 添加 CHECK 约束防负积分
ALTER TABLE users ADD CONSTRAINT credits_non_negative CHECK (credits >= 0);
```

**表结构**：
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| user_id | VARCHAR(255) | 用户ID |
| amount | INTEGER | 变动金额（正数增加，负数扣减） |
| balance_after | INTEGER | 交易后余额 |
| type | VARCHAR(50) | 类型：generate/refund/recharge/admin_adjust/exchange |
| reference_id | VARCHAR(255) | 关联ID（taskId/keyCode等） |
| description | TEXT | 描述 |
| created_at | TIMESTAMPTZ | 创建时间 |

**四大变动点接入**：
1. **image-to-image/route.ts**：生成扣费 → `type: 'generate'`
2. **split/route.ts**：智能分割 → `type: 'generate'`
3. **redeem/route.ts**：卡密充值 → `type: 'recharge'`
4. **linjiaqi/distribute/route.ts**：后台调整 → `type: 'admin_adjust'`
5. **exchange/route.ts**：积分兑换 → `type: 'exchange'`

**代码示例（lib/credits.ts）**：
```typescript
// 扣费时同时记录流水
export async function deductCredits(
  userId: string,
  amount: number,
  referenceId?: string
): Promise<{ success: boolean; newCredits: number; error?: string }> {
  // 1. 更新用户积分
  // 2. 写入流水表
  await client.from('credit_logs').insert({
    user_id: userId,
    amount: -amount, // 负数
    balance_after: newCredits,
    type: 'generate',
    reference_id: referenceId,
    description: `生成扣费 ${amount} 积分`,
    created_at: new Date().toISOString(),
  });
}

// 返还时写入流水
export async function refundCredits(
  userId: string,
  amount: number,
  originalReferenceId: string,
  reason: string
): Promise<{ success: boolean; newCredits: number }> {
  // 1. 更新用户积分
  // 2. 写入流水表（type: 'refund'）
  await client.from('credit_logs').insert({
    user_id: userId,
    amount: amount, // 正数
    balance_after: newCredits,
    type: 'refund',
    reference_id: `refund_${originalReferenceId}`,
    description: reason,
    created_at: new Date().toISOString(),
  });
}
```

**修改文件**：
- `src/storage/database/shared/schema.ts` - 添加 creditLogs 表定义
- `src/lib/credits.ts` - deductCredits/refundCredits 添加流水记录
- `src/app/api/image-to-image/route.ts` - 调用 deductCredits 时传递 referenceId
- `src/app/api/split/route.ts` - 调用 deductCredits 时传递 referenceId
- `src/app/api/redeem/route.ts` - 添加 credit_logs 写入
- `src/app/api/linjiaqi/distribute/route.ts` - 添加 credit_logs 写入
- `src/app/api/exchange/route.ts` - 添加 credit_logs 写入

### 状态
✅ 已修复

---

## #268 所有图片提交失败不返还积分（CRITICAL）

**问题**：用户提交生图任务后，所有图片都失败（如内容违规），但积分没有返还

**根因分析**：
在 `route.ts` 的 SSE 循环中，有两个失败处理分支：

1. **分支 A（第 1086-1108 行）**：`failedCount >= generationCount`（所有图片提交失败）
   - 发送 `error` 事件
   - 更新状态为 `failed`
   - **直接 `break` 退出循环**
   - ❌ 没有返还积分！

2. **分支 B（第 1219-1256 行）**：`currentResult.status === 'failed'`
   - 会返还积分
   - 但由于分支 A 已经 `break`，永远不会执行到

**代码路径**：
```
所有图片失败 → 分支 A (break) → 跳出循环 → 分支 B 永远不执行 → 积分不返还
```

**修复方案**：
在分支 A 中添加积分返还逻辑（与分支 B 相同的逻辑）：

```typescript
// 检查是否所有图片都提交失败
if (failedCount >= generationCount) {
  const errorMsg = errors.map(e => e.error).join('; ');
  
  // ====== #268 修复：所有图片提交失败时，必须返还积分 ======
  let creditsBalanceAfter = creditsBalanceAfterDeduct;
  const currentResult = getTaskResult(actualTaskId);
  
  // #155 防止积分重复返还
  if (creditsDeducted && actualUserId && creditsPerImage > 0 && !currentResult?.creditsRefunded) {
    const refundAmount = generationCount * creditsPerImage;
    console.log(`[积分补偿] 所有图片提交失败，退还 ${refundAmount} 积分`);
    try {
      const refundResult = await refundCredits(actualUserId, refundAmount, actualTaskId, `所有图片提交失败`);
      if (refundResult.success) {
        creditsBalanceAfter = refundResult.remaining ?? null;
        console.log(`[积分补偿] 全额退还成功，剩余 ${creditsBalanceAfter} 积分`);
        // #155 标记已返还，防止重复
        const latestResult = getTaskResult(actualTaskId);
        if (latestResult) {
          setTaskResult(actualTaskId, { ...latestResult, creditsRefunded: true });
        }
      }
    } catch (err) {
      console.error(`[积分补偿] 全额退还异常:`, err);
    }
  }
  
  // 发送 error 事件（包含积分信息）
  if (!isControllerClosed) {
    sendEvent({ 
      type: 'error', 
      taskId: actualTaskId,
      error: `所有图片提交失败: ${errorMsg}`,
      creditsRefunded: generationCount * creditsPerImage,
      creditsBalance: creditsBalanceAfter,
    });
  }
  // ... 其余代码
}
```

**修改文件**：
- `src/app/api/image-to-image/route.ts`（第 1086-1130 行）

**状态**
✅ 已修复

---

### #261 - gpt-image-2 返回结果为空（CRITICAL）

**问题描述**：
- 使用 gpt-image-2 模型生图时，终端实际已出图，但前端显示"返回结果为空"
- 终端返回格式：`{"code":0,"data":{"id":"xxx"},"msg":"success"}`
- 最终结果格式：`{"id":"xxx","results":[{"url":"..."}],"status":"succeeded"}`

**根因分析**：
1. `/v1/draw/completions` 端点只返回任务 ID，不返回 SSE 流
2. 服务器需要通过 webhook 推送最终结果
3. 请求配置中 `webHook: "-1"` 禁用了 webhook
4. 代码检测到 `result.sseResult` 为空时，立即标记为失败

**修复方案**：
1. **配置 webhook URL**：更新 `api_configs` 表 id=7 的 `request_body_template.webHook` 字段
   ```
   webHook: https://{domain}/api/webhook/draw-callback
   ```

2. **修改空结果检测逻辑**：当 `result.sseResult` 为空但有 `terminalTaskId` 时，不标记为失败
   ```typescript
   if (result.sseResult && result.sseResult.imageUrls.length > 0) {
     // 有图片，处理成功
   } else if (result.terminalTaskId) {
     // 有 terminalTaskId 但没有 sseResult，说明任务已提交
     // 等待 webhook 回调更新缓存，前端轮询会检测到更新
     console.log(`[SSE] 任务已提交: ${result.terminalTaskId}，等待 webhook 回调`);
     submittedCount++;
   } else {
     // 真正的失败
     errors.push({ index, error: '终端返回空结果' });
   }
   ```

**流程验证**：
1. `start` 事件 → 任务开始
2. `submitted` 事件 → 任务 ID 提交
3. `waiting` 事件 → 等待 webhook 回调
4. Webhook 收到回调（`status: succeeded` + `results`）→ 更新缓存
5. 前端轮询检测到更新 → 发送 `image` 事件
6. `complete` 事件 → 任务完成

**修改文件**：
- `src/app/api/image-to-image/route.ts`
  - 第 972-985 行：添加 `terminalTaskId` 检测分支
- 数据库 `api_configs` 表 id=7
  - `request_body_template.webHook` 字段

**状态**：✅ 已修复

---

### #267 - Webhook 失败未返还积分（CRITICAL）

**问题描述**：
- gpt-image-2 模型生成失败后，积分没有返还
- 用户报告"失败后没有返还积分"

**根因分析**：
1. **问题 1**：`setTaskResult` 创建任务时没有保存 `userId` 到 `requestParams`
2. **问题 2**：Webhook 从缓存查找主任务时，没有获取 `userId` 和 `requestParams`
3. **问题 3**：第 1172 行部分失败返还成功后，没有标记 `creditsRefunded = true`

**代码分析**：
```typescript
// 问题 1：创建任务时没有保存 userId
setTaskResult(actualTaskId, {
  requestParams: {
    prompt, model, resolution, ...
    // ❌ 缺少 userId
  },
});

// 问题 2：从缓存查找时没有获取 userId
mappingResult = {
  mainTaskId,
  index,
  fullTaskId: `${mainTaskId}-${index}`,
  // ❌ 缺少 userId 和 requestParams
};

// 问题 3：返还成功后没有标记
if (refundResult.success) {
  console.log(`[积分补偿] 部分失败退还成功`);
  // ❌ 缺少 setTaskResult(actualTaskId, { ...currentResult, creditsRefunded: true });
}
```

**修复方案**：
1. 在 `setTaskResult` 的 `requestParams` 中添加 `userId` 字段
2. 在 Webhook 从缓存查找时，获取 `userId` 和 `requestParams`
3. 在第 1172 行返还成功后，标记 `creditsRefunded = true`

**修改文件**：
- `src/lib/taskResultsCache.ts`：`requestParams` 添加 `userId` 字段
- `src/app/api/image-to-image/route.ts`：第 844 行添加 `userId`，第 1172 行添加状态标记
- `src/app/api/webhook/draw-callback/route.ts`：第 231-241 行从缓存获取 `userId`

**防重复机制**：
- 数据库层面：`credit_refund_logs` 表的 `task_id` 唯一约束
- 内存层面：`creditsRefunded` 状态标记

**状态**：✅ 已修复

---

### #265 - 模型 Logo 替换为 Gemini/GPT 专用图标

**问题描述**：
- gpt-image-2 模型需要专用的 GPT logo
- Banana 系列模型需要使用 Gemini logo

**修复方案**：
1. 替换 `public/model-logo.png` 为 Gemini 图标
2. 替换 `public/gpt-image-2-logo.png` 为 GPT 图标
3. 代码中根据 modelId 判断显示对应 logo

**修改文件**：
- `public/model-logo.png`
- `public/gpt-image-2-logo.png`
- `src/app/generate/page.tsx`
- `src/components/temp_RightPanel.tsx`

**状态**：✅ 已修复

---

### #266 - 管理后台拖动排序不影响前端显示

**问题描述**：
- 管理后台积分配置拖动排序后，前端模型选择栏排序不变
- 管理后台使用 `model_credits_config` 表，前端读取 `api_models` 表
- 两个表都有 `sort_order` 字段，但 `syncToApiModels` 函数没有同步

**根因分析**：
`syncToApiModels` 函数在更新 `api_models` 时，没有传入 `sort_order` 字段

**修复方案**：
1. 在 `syncToApiModels` 函数参数中添加 `sortOrder`
2. 在 insert 和 update 操作中同步 `sort_order` 字段
3. 在调用 `syncToApiModels` 时传入 `sort_order`

**代码修改**：
```typescript
// 函数签名添加参数
async function syncToApiModels(
  // ...原有参数
  sortOrder?: number  // #266 新增
) {
  // insert 时使用
  sort_order: sortOrder ?? 100,
  
  // update 时同步
  if (sortOrder !== undefined) {
    updateData.sort_order = sortOrder;
  }
}

// 调用时传入 sort_order
await syncToApiModels(
  client, model_key, model_name, credits, description, is_active,
  'update', undefined, data,
  sort_order  // #266 同步排序
);
```

**修改文件**：
- `src/app/api/linjiaqi/model-credits/route.ts`

**状态**：✅ 已修复

---

### #264 - gpt-image-2 模型 Logo 显示

**问题描述**：
- gpt-image-2 模型在模型选择栏中显示的是默认的通用 logo
- 需要为 gpt-image-2 模型设置专用的 logo 图片

**修复方案**：
1. 添加专用 logo 文件：`/public/gpt-image-2-logo.png`
2. 在模型选择栏代码中根据 modelId 判断显示对应 logo：
   ```typescript
   const modelLogo = modelId === 'gpt-image-2' ? '/gpt-image-2-logo.png' : '/model-logo.png';
   <img src={modelLogo} alt="" className="w-10 h-10 rounded-lg" />
   ```

**修改文件**：
- 新增 `public/gpt-image-2-logo.png`
- `src/app/generate/page.tsx` 模型选择栏（3处）
- `src/components/temp_RightPanel.tsx` 模型选择栏（3处）

**状态**：✅ 已修复

---

### #263 - webhook URL 硬编码开发环境域名（CRITICAL）

**问题描述**：
- 数据库 `api_configs` 表 id=7 的 `webHook` 字段硬编码为开发环境域名
- 硬编码值：`https://bd9ded72-ea5b-4143-a46a-3164cccc49a6.dev.coze.site/api/webhook/draw-callback`
- 生产环境部署后，gpt-image-2 的 webhook 回调会发送到错误的地址
- 导致生产环境无法收到生成结果

**根因分析**：
1. 初始配置时直接写了开发环境的完整 URL
2. 没有考虑多环境部署（开发/生产）的场景
3. 部署到生产环境后，webhook URL 仍然是开发环境地址

**修复方案**：
1. **数据库配置改为占位符**：
   ```sql
   UPDATE api_configs 
   SET request_body_template = jsonb_set(
     request_body_template, 
     '{webHook}', 
     '"${webhookBaseUrl}/api/webhook/draw-callback"'
   )
   WHERE id = 7;
   ```

2. **代码中传入环境变量**：
   ```typescript
   const variables = {
     prompt: requestBody.prompt,
     // ... 其他变量
     webhookBaseUrl: process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://kiikii.me',
   };
   ```

**环境变量优先级**：
1. `WEBHOOK_BASE_URL` - 专用 webhook 基础 URL（优先级最高）
2. `NEXT_PUBLIC_SITE_URL` - 站点 URL（通用配置）
3. 硬编码默认值 `https://kiikii.me`（兜底）

**部署配置说明**：
在 Vercel 或其他平台部署生产环境时，只需配置以下环境变量之一：
```
NEXT_PUBLIC_SITE_URL=https://kiikii.me
```
或
```
WEBHOOK_BASE_URL=https://kiikii.me
```

**修改文件**：
- 数据库 `api_configs` 表 id=7 的 `request_body_template.webHook` 字段
- `src/app/api/image-to-image/route.ts` 第 287-296 行

**状态**：✅ 已修复

---

### #260 - 新架构请求失败 "apikey is empty"（CRITICAL）

**问题描述**：
- 使用新架构（数据库模板）请求 gpt-image-2 模型时失败
- 错误信息：`{"code":-1,"data":null,"msg":"apikey is empty"}`
- 数据库 `api_key` 字段有值，但请求未发送 API Key

**根因分析**：
数据库 `api_configs` 表的 `request_headers` 字段只有 `Content-Type`，缺少 `Authorization` header。

旧架构硬编码了 `Authorization: Bearer ${apiKey}`，但新架构依赖数据库模板，模板中没有这个 header，导致 `buildRequest` 函数无法将 `apiKey` 注入到请求头中。

**修复方案**：
更新数据库 `api_configs` 表 id=7 的 `request_headers` 字段：
```sql
UPDATE api_configs
SET request_headers = '{"Content-Type": "application/json", "Authorization": "Bearer ${apiKey}"}'
WHERE id = 7;
```

**关键代码**：
```typescript
// buildRequest 函数将 apiKey 添加到变量中
const allVariables = {
  ...variables,
  apiKey: config.apiKey,  // apiKey 来自数据库 api_configs.api_key
  model: config.modelId,
};

// 深度替换请求头中的变量
let headers = deepReplaceVariables(config.requestHeaders, allVariables);
// 替换后：Authorization: Bearer sk-xxx...
```

**验证测试**：
- ✅ gpt-image-2：`{"code":0,"data":{"id":"..."},"msg":"success"}`
- ✅ nano-banana-fast：SSE 流式数据，`"status":"running"`

**修改文件**：
- 数据库 `api_configs` 表 id=7 的 `request_headers` 字段

**状态**：✅ 已修复

---

## #257 发送到画布无图片

**发现日期**：2026-04-20
**修复日期**：2026-04-20

### 问题描述
生图页面点击"发送到画布"按钮后，画布没有显示图片。

### 问题根因
`canvas/page.tsx` 第 3804-3808 行，`addSingleImageToCanvas` 函数中创建 Image 对象后，**没有设置 `img.src`**，导致 `onload`/`onerror` 永远不触发，Promise 永远不 resolve。

**错误代码**：
```typescript
const img = new window.Image();
await new Promise<void>((resolve) => {
  img.onload = () => resolve();
  img.onerror = () => resolve();
  // ❌ 缺少 img.src = imgUrl;
});
```

### 修复方案
在 Promise 内部添加 `img.src = imgUrl;`：

```typescript
const img = new window.Image();
await new Promise<void>((resolve) => {
  img.onload = () => resolve();
  img.onerror = () => resolve();
  img.src = imgUrl;  // #257 必须设置 src 才能触发 onload
});
```

### 风险评估
| 风险项 | 风险等级 | 说明 |
|--------|----------|------|
| 图片 URL 无效 | ✅ 无风险 | onerror 触发后使用默认尺寸 200x200 |
| 跨域问题 | ⚠️ 低风险 | 有兜底默认值 |
| 其他功能 | ✅ 无影响 | 只修改这一个函数 |

### 修改文件
- `src/app/canvas/page.tsx`
  - `addSingleImageToCanvas` 函数添加 `img.src = imgUrl`

### 状态
✅ 已修复

---

## #258 占位符比例不一致（CRITICAL）

**发现日期**：2025-01-09
**修复日期**：2025-01-09

### 问题描述
- 用户选择 `auto` 或某个比例生成图片，占位符是 1:1 正方形
- 后端返回 3:4 图片时，偶尔会出现左右填灰的情况
- 如果是 4:3，则上下填灰

### 根因分析
**`onComplete` 兜底逻辑没有重新计算元素尺寸！**

| 路径 | 代码位置 | 尺寸处理 |
|------|---------|---------|
| SSE 流正常 | `updatePlaceholder` | ✅ 获取图片实际尺寸，按比例更新 |
| SSE 流异常 | `onComplete` 兜底 | ❌ 直接使用占位符原始尺寸（#214 简化版） |

问题链路：
```
用户选择 auto 比例
  → 占位符创建为 1:1 正方形
  → 后端返回 3:4 图片
  → SSE 流正常 → updatePlaceholder → 元素尺寸正确 ✅
  → SSE 流异常 → onComplete 兜底 → 元素保持 1:1 尺寸 ❌
  → Canvas 渲染：图片被拉伸或留白
```

### 历史原因
#214 修复时用的是"简化版"，注释明确写着：
```typescript
// 直接更新元素状态（简化版，不重新计算尺寸）
```

当时优先级是让占位符消失，没考虑到尺寸不一致问题。

### 修复方案
**升级 #214 为"完整版 B"**：在 `onComplete` 兜底逻辑中调用 `updatePlaceholder`

```typescript
// 🔧 升级：复用 updatePlaceholder 的尺寸计算逻辑，解决比例不一致问题
updatePlaceholder(elementIdToUse, p.imageUrl, p.imageKey);
```

对于元素不存在需要重新添加的情况，也增加了图片尺寸获取逻辑：
```typescript
const img = new window.Image();
img.src = p.imageUrl;
img.onload = () => {
  const imgAspect = img.naturalWidth / img.naturalHeight;
  // 按图片实际比例调整尺寸
  // 居中定位
};
```

### 修改文件
- `src/app/canvas/page.tsx`
  - `onComplete` 回调：元素存在时调用 `updatePlaceholder`
  - `onComplete` 回调：元素不存在时获取图片尺寸再添加

### 状态
✅ 已修复

---

## #259 废除 hidden-models.json 双头管理模式（CRITICAL）

**发现日期**：2025-01-09
**修复日期**：2025-01-09

### 问题描述
- 管理后台"展示"按钮看似有用，但实际是靠 `hidden-models.json` 文件兜底
- 管理后台"启用"按钮完全无效，因为只依赖数据库 `is_active` 字段
- 数据库 `api_models` 和 `api_configs` 表缺少 `is_visible` 字段
- 双头管理导致数据不一致，难以维护

### 根因分析
**双写逻辑的隐患**：
```javascript
// 旧代码
const handleVisibleToggle = async () => {
  // 1. 更新数据库（失败，字段不存在）
  await updateModelCredits(config.id, 'is_visible', !newVisible);
  
  // 2. 写入 hidden-models.json（成功）
  await fetch('/api/linjiaqi/hidden-models', { ... });
};
```

**问题链路**：
```
用户点击"展示"按钮
  → 数据库更新失败（is_visible 字段不存在）
  → hidden-models.json 写入成功
  → 前端读取 hidden-models.json 过滤模型
  → 看起来有用，但数据不一致
```

### 修复方案
**彻底废除 JSON 文件，全线回归数据库管理**：

1. **删除文件**：
   - `hidden-models.json`（数据文件）
   - `/api/linjiaqi/hidden-models`（API 路由）

2. **重构管理后台**：
```javascript
// 新代码
const handleVisibleToggle = async () => {
  // 直接更新数据库，不再使用 JSON 文件
  await updateModelCredits(config.id, 'is_visible', !newVisible);
};
```

3. **重构前端过滤逻辑**：
```javascript
// 新代码：直接使用数据库字段过滤
const visibleModels = allModels.filter(m => 
  m.is_active !== false && m.is_visible !== false
);
```

4. **数据库字段**（需手动执行）：
```sql
ALTER TABLE api_models ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;
ALTER TABLE api_configs ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;
UPDATE api_models SET is_visible = TRUE WHERE is_visible IS NULL;
UPDATE api_configs SET is_visible = TRUE WHERE is_visible IS NULL;
```

### 修改文件
- `src/app/linjiaqi/page.tsx`
  - `handleVisibleToggle`：移除 hidden-models.json 调用
- `src/app/api/config/route.ts`
  - 模型过滤：移除 hidden-models.json 引用，直接使用 is_active/is_visible
- `src/app/api/linjiaqi/hidden-models/route.ts`：删除
- `hidden-models.json`：删除
- `src/storage/database/shared/schema.ts`
  - 添加 is_visible 字段定义

### 状态
✅ 已修复（需在 Supabase 控制台执行 SQL）

---

### #254 - 轮询返回空 imageUrls 导致历史记录不保存（CRITICAL）⚠️ 必读

**问题描述**：
- "再次生成"按钮产生的任务完成后，历史记录页面看不到记录
- 控制台显示 `[AIGeneratorContext] #237/#245 无有效图片，跳过保存`
- 但日志显示 `imageUrls.length = 1`

**根因分析**：
1. SSE 完成事件后，缓存更新时只更新了 `imageItems`，没有同步更新 `imageUrls`
2. 初始化时 `imageUrls = [null]`，完成后仍然是 `[null]`
3. GET API 直接返回 `result.imageUrls = [null]`
4. 前端 `saveHistoryRecord` 过滤后变成空数组：`[null].filter(url => url && url.length > 0) = []`

**修复方案**：

### 1. GET API 从 imageItems 提取实际 URL（route.ts）
```typescript
// #254 修复：如果 imageUrls 包含 null，从 imageItems 中提取实际的 URL
if (result.imageItems && result.imageItems.length > 0) {
  const actualImageUrls = result.imageItems
    .filter(item => item.status === 'completed' && item.url)
    .map(item => item.url);

  // 只有当 imageItems 中的 URL 比原有的多时才更新
  if (actualImageUrls.length > (result.imageUrls?.filter(u => u !== null).length || 0)) {
    console.log(`[GET] #254 从 imageItems 提取 URL: 原有 ${result.imageUrls?.filter(u => u !== null).length || 0} 张, 提取 ${actualImageUrls.length} 张`);
    result.imageUrls = actualImageUrls;
    result.imageKeys = actualImageKeys;
  }
}
```

### 2. 添加详细诊断日志（generate/page.tsx）
```typescript
// #254 调试：打印完整的图片数据
console.log(`[定时检查] #254 API返回详情:`, {
  imageUrls: resultData.imageUrls?.map((u: string) => u?.substring?.(0, 60) + '...'),
  imageItems: resultData.imageItems?.map((item: any) => ({
    status: item?.status,
    url: item?.url?.substring?.(0, 60) + '...',
  })),
});
```

### 3. saveHistoryRecord 添加详细日志（AIGeneratorContext.tsx）
```typescript
// #254 调试日志：打印过滤前后的图片数量
console.log('[saveHistoryRecord] #254 图片过滤:', {
  原始数量: images?.length || 0,
  过滤后数量: filteredImages.length,
  原始数组: images?.slice(0, 2).map(u => u?.substring?.(0, 50) + '...'),
});
```

### 修改文件
- `src/app/api/image-to-image/route.ts`
  - GET 方法添加从 imageItems 提取 URL 的逻辑
- `src/app/generate/page.tsx`
  - 定时检查添加详细日志
- `src/contexts/AIGeneratorContext.tsx`
  - saveHistoryRecord 添加详细日志

### 状态
✅ 已修复

---

### #253 - 字段名不一致导致参考图不显示（CRITICAL）⚠️ 必读

**问题描述**：
- 右侧面板无法显示参考图
- "再次生成"按钮产生的任务在历史记录中不显示
- 根本原因：驼峰命名（referenceImages）与下划线命名（reference_images）混用

**根因分析**：
1. 数据库使用 `reference_images`（下划线命名）
2. API 返回数据使用 `reference_images`（下划线命名）
3. 代码中多处使用 `params.referenceImages`（驼峰命名）
4. 字段名不匹配导致读取失败

**修复方案**：

### 1. 类型定义支持双命名（generateStore.ts）
```typescript
params: {
  // 下划线命名（与数据库一致）
  reference_images?: string[];
  reference_image_urls?: string[];
  reference_image_md5s?: string[];
  reference_image_keys?: string[];
  // 兼容旧数据（驼峰命名）
  referenceImages?: string[];
  referenceImageUrls?: string[];
  referenceImageMd5s?: string[];
  referenceImageKeys?: string[];
};
```

### 2. 读取时使用下划线命名（generate/page.tsx）
```typescript
// #253 修复：使用正确的字段名 reference_images（与数据库一致）
const refImages = task.params.reference_images || task.params.reference_image_urls || [];
```

### 3. 创建新任务时使用下划线命名
```typescript
const newTask: GenerationTask = {
  // ...
  params: {
    // #253 修复：使用下划线命名（与数据库一致）
    reference_images: [...originalRefImages],
    reference_image_urls: [...originalRefUrls],
    reference_image_md5s: [...originalRefMd5s],
    reference_image_keys: [...originalRefKeys],
  },
};
```

### 4. handleRegenerate 添加 DOM 状态清空
```typescript
// #250/#253 清空 file input 的 value，确保 DOM 状态也重置
const fileInput = document.getElementById('single-ref-upload') as HTMLInputElement | null;
if (fileInput) {
  fileInput.value = '';
}
```

### 修改文件
- `src/store/generateStore.ts`
  - GenerationTask 类型支持双命名
- `src/app/generate/page.tsx`
  - 第 1382 行：`params.reference_images`
  - 第 1825 行：新任务创建使用下划线命名
  - 第 2372 行：`params.reference_images`
  - 第 2407 行：`params.reference_images`
  - 第 3077 行：`params.reference_images`
  - handleRegenerate 添加 file input 清空

### 状态
✅ 已修复

---

## #252 右侧面板参考图不显示 + 移除"历史"标签

**日期**：2025-01-10

**问题**：
1. 左侧参考图预览上有"历史"字样的标签，影响美观
2. 右侧详情面板不显示参考图
3. 字段名映射不一致：数据库存 `reference_images`，代码读取 `referenceImageUrls`

**根因**：
1. 参考图预览组件中有"历史"标签代码
2. `handleRegenerate` 从 `task.params.referenceImageUrls` 读取参考图，但数据库存的是 `reference_images`

**修复**：

### 1. 移除"历史"标签（generate/page.tsx 第 2733-2738 行）
```typescript
// 删除前
{preview.type === 'url' && (
  <span className="...">历史</span>
)}

// 删除后：移除整个"历史"标签逻辑
```

### 2. 修复字段名映射（generate/page.tsx handleRegenerate 函数）
```typescript
// 修复前：从 referenceImageUrls 读取（不存在）
const refImages = task.params.referenceImageUrls || [];

// 修复后：优先从 referenceImages 读取，兼容 referenceImageUrls
const refImages = task.params.referenceImages || task.params.referenceImageUrls || [];
const refMd5s = task.params.referenceImageMd5s || [];
const refKeys = task.params.referenceImageKeys || [];
```

### 3. 确保新任务的 params 包含正确的字段
```typescript
params: {
  ...
  referenceImages: originalRefImages,
  referenceImageUrls: originalRefImages,  // 兼容旧逻辑
  referenceImageMd5s: originalRefMd5s,
  referenceImageKeys: originalRefKeys,
  ...
}
```

### 字段名对照表
| 数据库字段 | API 返回字段 | task.params 字段 | 右侧面板读取 |
|-----------|-------------|-----------------|-------------|
| `reference_images` | `reference_images` | `referenceImages` | `params.referenceImages` ✅ |
| `reference_image_md5s` | `reference_image_md5s` | `referenceImageMd5s` | - |
| `reference_image_keys` | `reference_image_keys` | `referenceImageKeys` | - |

### 修改文件
- `src/app/generate/page.tsx`
  - 移除"历史"标签（第 2733-2738 行）
  - handleRegenerate 字段名映射修复

### 状态
✅ 已修复
---

## #251 参考图预览兼容 + LocalStorage 自动清理 + 强制解锁

**问题**：再次生成后参考图 UI 消失、LocalStorage 爆满、上传中卡死

**修复内容**：

### 1. 参考图预览兼容 URL（generate/page.tsx 第 2671-2705 行）
```typescript
// #251 修复：兼容从"再次生成"恢复的 URL 预览
// 合并本地文件预览和 URL 预览
const allPreviews = [
  ...referenceImages.map((base64, i) => ({ type: 'base64' as const, data: base64, md5: referenceImageMd5s[i] })),
  ...referenceImageUrls
    .filter(url => url && url.length > 0 && !referenceImages.some(b64 => b64 === url))
    .map((url, i) => ({ type: 'url' as const, data: url, md5: null })),
];

// 渲染时使用 allPreviews
{allPreviews.map((preview, i) => (
  <div key={i} className="...">
    <img src={preview.data} ... />
  </div>
))}
```

### 2. LocalStorage 自动清理（historyStore.ts addRecord 函数）
```typescript
// #251 自动清理机制：超过 200 条时自动删除最老的 50 条
const MAX_RECORDS = 200;
const CLEANUP_COUNT = 50;

if (currentRecords.length >= MAX_RECORDS) {
  const sortedRecords = [...currentRecords].sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  currentRecords = sortedRecords.slice(0, MAX_RECORDS - CLEANUP_COUNT);
  console.log(`[HistoryStore] #251 自动清理：删除了 ${CLEANUP_COUNT} 条最老记录`);
}
```

### 3. 强制解锁（generate/page.tsx handleRegenerate 函数）
```typescript
} finally {
  // #251 强制解锁：确保上传计数器归零
  setUploadingCount(0);
}
```

### 修改文件
- `src/app/generate/page.tsx`
  - 参考图预览兼容 URL
  - handleRegenerate 添加 finally 块强制解锁
- `src/store/historyStore.ts`
  - addRecord 添加自动清理机制

### 状态
✅ 已修复

---

## #276 - 生成失败积分返还不更新前端（CRITICAL）⚠️ 核心必读

**问题描述**：
生成失败时积分返还偶尔不触发前端更新，需要手动 F5 刷新才能看到正确余额。

**发现的 4 个漏洞**：

### 漏洞 1：部分失败时 complete 事件的 creditsBalance 未更新
**位置**：`src/app/api/image-to-image/route.ts:1201-1238`

**问题代码**：
```typescript
const finalCreditsBalance = creditsBalanceAfterDeduct;  // ❌ 初始值

if (failedCount > 0 && ...) {
  const refundResult = await refundCredits(...);
  if (refundResult.success) {
    console.log(`部分失败退还成功`);
    // ❌ 关键缺失：没有更新 finalCreditsBalance！
  }
}

// 发送 complete 事件
creditsBalance: finalCreditsBalance,  // ❌ 使用的是旧值
```

**修复**：
```typescript
let finalCreditsBalance = creditsBalanceAfterDeduct;  // ✅ 改为 let

if (refundResult.success) {
  finalCreditsBalance = refundResult.remaining ?? finalCreditsBalance;  // ✅ 更新余额
}
```

### 漏洞 2：超时场景积分返还后不通知前端
**位置**：`src/app/api/image-to-image/route.ts:1400-1430`

**问题代码**：
```typescript
// ❌ 使用 .then() 异步返还，不等待完成
refundCredits(...).then(result => {
  console.log('退还成功');
  // ❌ 没有通知前端！
});

// ❌ timeout 事件不携带 creditsBalance
sendEvent({ type: 'timeout', taskId, message: '...' });
```

**修复**：
```typescript
let timeoutCreditsBalance = creditsBalanceAfterDeduct;

// ✅ 改为 await，等待返还完成
const refundResult = await refundCredits(...);
if (refundResult.success) {
  timeoutCreditsBalance = refundResult.remaining ?? timeoutCreditsBalance;
}

// ✅ timeout 事件携带最新余额
sendEvent({ 
  type: 'timeout', 
  taskId, 
  creditsBalance: timeoutCreditsBalance,  // ✅ 携带最新余额
});
```

### 漏洞 3：API 内部错误场景不通知前端
**位置**：`src/app/api/image-to-image/route.ts:1467-1499`

**问题代码**：
```typescript
// ❌ 使用 .then() 异步返还
refundCredits(...).then(result => {
  console.log('退还成功');
  // ❌ 没有通知前端！
});

return new Response(JSON.stringify({ error: '服务器内部错误' }), ...);
// ❌ 不携带 creditsBalance
```

**修复**：
```typescript
let errorCreditsBalance = creditsBalanceAfterDeduct;

// ✅ 改为 await
const refundResult = await refundCredits(...);
if (refundResult.success) {
  errorCreditsBalance = refundResult.remaining ?? errorCreditsBalance;
}

return new Response(JSON.stringify({ 
  error: '服务器内部错误',
  creditsBalance: errorCreditsBalance,  // ✅ 携带最新余额
}), ...);
```

### 漏洞 4：前端 error 事件不处理积分更新
**位置**：`src/hooks/useGenService.ts:859-884`

**问题代码**：
```typescript
case 'error':
  config.onError?.({ type: 'global', message: data.error, ... });
  // ❌ 没有读取和更新 creditsBalance！
  break;
```

**修复**：
```typescript
case 'error':
  config.onError?.({ type: 'global', message: data.error, ... });
  
  // ✅ 如果携带了 creditsBalance，触发积分更新回调
  if (data.creditsBalance !== undefined && data.creditsBalance !== null) {
    config.onCreditsDeducted?.({
      creditsCharged: data.creditsCharged ?? 0,
      creditsBalance: data.creditsBalance,
    });
  }
  break;

case 'timeout':  // ✅ 新增 timeout 事件处理
  config.onError?.({ type: 'timeout', message: data.message, ... });
  
  if (data.creditsBalance !== undefined && data.creditsBalance !== null) {
    config.onCreditsDeducted?.({
      creditsCharged: data.creditsCharged ?? 0,
      creditsBalance: data.creditsBalance,
    });
  }
  break;
```

### 方案 C（双保险）完整修复

| 层级 | 文件 | 修复内容 |
|------|------|----------|
| 后端 | `route.ts:1201` | `let finalCreditsBalance` + 返还后更新 |
| 后端 | `route.ts:1400-1430` | 超时场景 await 返还 + timeout 事件携带 creditsBalance |
| 后端 | `route.ts:1467-1499` | API 错误场景 await 返还 + 响应携带 creditsBalance |
| 前端 | `useGenService.ts:100-108` | GenError 类型新增 'timeout' |
| 前端 | `useGenService.ts:859-920` | error/timeout 事件处理积分更新 |

### 修改文件
- `src/app/api/image-to-image/route.ts`
  - 第 630 行：`creditsBalanceAfterDeduct` 移到函数开头（catch 块可访问）
  - 第 1201 行：`let finalCreditsBalance` + 返还后更新
  - 第 1373-1430 行：超时场景 await 返还 + timeout 事件携带 creditsBalance
  - 第 1467-1499 行：API 错误场景 await 返还 + 响应携带 creditsBalance
- `src/hooks/useGenService.ts`
  - 第 102 行：GenError 类型新增 'timeout'
  - 第 885-920 行：error/timeout 事件处理积分更新

---

## #284 GET 接口超时未返还积分（CRITICAL）

**发现时间**：2026-04-24

**问题现象**：
- 任务 `1777036525034` 扣除 18 积分
- 任务状态一直是 `generating`
- 前端持续轮询，但任务从未完成
- **积分未返还**

**根因分析**：
GET 接口在任务超时（状态一直是 generating）时，只是返回当前状态，**没有触发积分返还**！

```
[GET] 任务 1777036525034 超时检查，查询数据库...
[GET] 数据库中也没有任务 1777036525034
// ❌ 没有积分返还逻辑！
```

**漏洞位置**：`src/app/api/image-to-image/route.ts` GET 方法

**问题代码**：
```typescript
// ❌ 超时后只是查询数据库，没有返还积分
if (shouldCheckDatabase) {
  const { data, error } = await client
    .from('generation_records')
    .select('*')
    .eq('task_id', taskId)
    .maybeSingle();
  
  if (!data) {
    console.log(`[GET] 数据库中也没有任务 ${taskId}`);
    // ❌ 直接返回，没有返还积分！
  }
}
```

**修复方案**：
当任务超过 5 分钟还是 `generating` 状态时：
1. 标记所有未完成的图片为 `failed`
2. 触发积分返还（`handlePartialRefund`）
3. 更新任务状态为 `completed` 或 `failed`

**修复代码**：
```typescript
// #284 新增：超时积分返还机制
const REFUND_TIMEOUT_MS = 5 * 60 * 1000;  // 5 分钟

if (result.status === 'generating' && Date.now() - result.createdAt > REFUND_TIMEOUT_MS) {
  console.log(`[GET] #284 任务 ${taskId} 超过 5 分钟未完成，触发积分返还`);
  
  // 标记所有未完成的图片为失败
  const updatedImageItems = imageItems.map(item => {
    if (item.status === 'generating') {
      return { ...item, status: 'failed' as const, error: '任务超时' };
    }
    return item;
  });
  
  // 触发积分返还
  if (userId && creditsPerImage > 0 && failedCount > 0) {
    const refundResult = await handlePartialRefund(
      getTaskResult,
      setTaskResult,
      taskId,
      updatedImageItems,
      generationCount,
      creditsPerImage,
      userId,
      'GET接口超时返还'
    );
    
    if (refundResult.success) {
      console.log(`[GET] #284 超时返还成功: 退还 ${refundResult.refundAmount} 积分`);
    }
  }
  
  // 更新任务状态
  setTaskResult(taskId, {
    ...result,
    status: hasSuccessfulImages ? 'completed' : 'failed',
    imageItems: updatedImageItems,
    completedAt: Date.now(),
  });
}
```

**补偿操作**：
为任务 `1777036525034` 手动返还 18 积分：
```sql
-- 查询用户积分
SELECT credits FROM users WHERE id = '5bb66162-29de-4839-8726-54d217663506';

-- 返还积分
UPDATE users SET credits = credits + 18 WHERE id = '5bb66162-29de-4839-8726-54d217663506';

-- 记录日志
INSERT INTO credit_logs (user_id, type, amount, reference_id, created_at)
VALUES ('5bb66162-29de-4839-8726-54d217663506', 'refund', 18, '1777036525034', NOW());
```

**修改文件**：
- `src/app/api/image-to-image/route.ts`
  - 第 1477 行：新增 `REFUND_TIMEOUT_MS` 常量
  - 第 1600-1660 行：新增超时积分返还逻辑

**教训总结**：
1. **幽灵任务是积分返还的最大漏洞**：任务卡在 `generating` 状态，前端轮询永远得不到结果，积分也不返还
2. **GET 接口必须有兜底机制**：不能只查询状态，还要处理超时场景
3. **积分返还必须在所有可能的失败路径上触发**：SSE 超时、Webhook 失败、GET 超时

---

## #285 并发请求导致重复返还积分（CRITICAL）

**发现时间**：2026-04-24

**问题现象**：
- 任务 `1777031123674`：扣 15 返 30（返还了 2 次）
- 任务 `1777030922698`：扣 15 返 30（返还了 2 次）
- 两次返还时间间隔极短（0.276 秒和 0.703 秒）

**根因分析**：
`refundCredits` 函数使用 **检查-执行（check-then-act）** 模式，在并发场景下有竞态条件：
1. 请求 A 和 B 同时检查：都发现没有返还记录
2. 请求 A 和 B 都执行返还：都成功
3. 用户收到双倍返还！

```
请求 A: 检查无记录 → 插入日志成功 → 更新积分
请求 B: 检查无记录 → 插入日志成功 → 更新积分
结果: 日志2条，积分返还2次！
```

**漏洞位置**：`src/lib/credits.ts` 的 `refundCredits` 函数

**修复方案**：
1. **数据库层面**：创建 `(reference_id, type)` 唯一约束
2. **代码层面**：先插入日志，如果唯一约束冲突则跳过

**修复代码**：
```sql
-- 在 Supabase 控制台执行
CREATE UNIQUE INDEX IF NOT EXISTS credit_logs_reference_id_type_unique 
ON credit_logs (reference_id, type) 
WHERE reference_id IS NOT NULL;
```

```typescript
// 使用唯一约束实现原子防重
const { status: insertStatus } = await restRequest('credit_logs', {
  method: 'POST',
  body: { user_id: userId, amount: credits, type: 'refund', reference_id: taskId, ... },
  prefer: 'return=representation',
});

// 唯一约束冲突 = 已被其他请求返还
if (insertStatus === 409 || insertStatus === 400) {
  return { success: true, skipped: true, error: '已退还过' };
}
```

**补偿操作**：
已删除重复记录并扣除多返还的 30 积分：
- 删除 credit_logs id=277, 282
- 从用户积分扣除 30

**修改文件**：
- `supabase/migrations/20260424_add_credit_logs_unique_constraint.sql` — 迁移文件
- `src/lib/credits.ts` — refundCredits 函数

---

## #286 refundCredits 并发安全（CRITICAL）

**发现时间**：2026-04-24

**问题现象**：
并发测试显示，5 个并发请求都成功插入日志并返还积分，防重机制完全失效。

**根因分析**：
没有数据库唯一约束的情况下，JavaScript 层面的检查-执行模式无法防止并发。

**修复方案**：
1. 必须在数据库创建唯一约束
2. 代码先插入日志，唯一约束冲突则跳过
3. 插入成功后再更新积分

**关键约束**：
⚠️ **必须在 Supabase 控制台执行唯一约束 SQL！**

```
CREATE UNIQUE INDEX credit_logs_reference_id_type_unique 
ON credit_logs (reference_id, type) 
WHERE reference_id IS NOT NULL;
```

**修改文件**：
- `src/lib/credits.ts`
  - refundCredits 函数：先插入日志再更新积分
  - 添加 skipped 返回字段

**教训总结**：
1. **检查-执行模式无法防止并发**：必须有数据库层面的唯一约束
2. **先插入再更新**：确保只有插入成功的请求才会更新积分
3. **所有防重机制最终依赖数据库约束**：应用层的锁都不可靠

---

### 状态
✅ 已修复

---

## #290 占位符像素密度低

**问题描述**：
占位符在画布上展示的尺寸太小，导致图片填充进来后像素密度低，看起来模糊。

**根因分析**：
- `placeholderBaseSize = 容器短边 / 4`
- 占位符画布尺寸小 → 图片填充后画布尺寸也小
- zoom 缩放后视觉大小正常，但实际像素少，清晰度低

**修复方案**：
占位符画布尺寸翻倍，视觉大小由 zoom 自动调整保持不变，像素密度提高。

```typescript
// canvas-image-layout.ts 第190行

// 修改前
const placeholderBaseSize = Math.min(containerWidth, containerHeight) / 4;

// 修改后（画布尺寸翻倍，像素密度提高）
const placeholderBaseSize = Math.min(containerWidth, containerHeight) / 2;
```

**效果对比**：

| 项目 | 修改前 | 修改后 |
|------|--------|--------|
| 占位符画布尺寸 | 500px | 1000px |
| zoom | 0.5 | 0.25 |
| 视觉大小（屏幕像素） | 250px | 250px（不变） |
| 图片实际像素 | 500x500 | 1000x1000 |
| 清晰度 | 一般 | 更清晰 |

**修改文件**：
- `src/lib/canvas-image-layout.ts`
  - placeholderBaseSize 从 /4 改为 /2

---

### 状态
✅ 已修复（需要在 Supabase 控制台执行唯一约束 SQL）

---

## #287 生图发送到画布缺少 imageKey（CRITICAL）

**发现时间**：2026-04-24

**问题现象**：
用户从生图页面点击"发送到画布"按钮后，图片显示正常，但刷新页面后图片丢失。

**日志证据**：
```
[Canvas] 图片缺少 imageKey 和 dbId，刷新后可能丢失: awgej66ee
```

**根因分析**：
"发送到画布"功能在 sessionStorage 中只存储了 `imageUrl` 和 `prompt`，没有存储 `imageKey`。

**数据流追踪**：
```
生图页面 (generate/page.tsx)
  ↓ sessionStorage.setItem('generateToSend', { imageUrl, prompt })  ← ❌ 缺少 imageKey
画布页面 (canvas/page.tsx)
  ↓ const { imageUrl, prompt } = JSON.parse(data)  ← 没有 imageKey
  ↓ canvas.addElement({ ..., imageKey: undefined })  ← ❌ 导致问题
  ↓ localStorage 保存时警告：图片缺少 imageKey 和 dbId
  ↓ 刷新后图片丢失
```

**修复方案**：
1. 生图页面：在 sessionStorage 中添加 `imageKey`
2. 画布页面：读取并使用 `imageKey`

**修复代码**：
```javascript
// 生图页面 (generate/page.tsx)
sessionStorage.setItem('generateToSend', JSON.stringify({
  imageUrl: currentImageUrl,
  imageKey: selectedTask.imageKeys?.[selectedImageIndex] || null,  // 新增
  prompt: selectedTask.params?.prompt || '',
}));

// 画布页面 (canvas/page.tsx)
const { imageUrl, imageKey, prompt } = JSON.parse(data);

const addSingleImageToCanvas = async (imgUrl: string, imgKey: string | null, promptText: string) => {
  // ...
  canvas.addElement({
    // ...
    imageKey: imgKey || undefined,  // 新增
    // ...
  });
};

addSingleImageToCanvas(imageUrl, imageKey || null, prompt || '');
```

**修改文件**：
- `src/app/generate/page.tsx`
  - 第 2881-2891 行：sessionStorage 添加 imageKey
- `src/app/canvas/page.tsx`
  - 第 3844 行：解构 imageKey
  - 第 3848 行：addSingleImageToCanvas 添加 imgKey 参数
  - 第 4001 行：canvas.addElement 添加 imageKey
  - 第 4024 行：调用时传递 imageKey

**关联场景对比**：

| 场景 | 是否设置 imageKey/dbId | 状态 |
|------|------------------------|------|
| 上传图片 | ✅ 设置 `dbId`（IndexedDB） | 正常 |
| 画布内生成 | ✅ 设置 `imageKey`（COS） | 正常 |
| 分割图片 | ✅ 初始 undefined，后台更新 | 正常 |
| **生图发送到画布** | ✅ 设置 `imageKey`（COS） | **已修复** |

**教训总结**：
1. **图片持久化必须有唯一标识**：`imageKey`（COS）或 `dbId`（IndexedDB）
2. **跨页面传递图片时要传递完整信息**：不能只传 URL，还要传持久化 key
3. **刷新丢失问题通常是持久化缺失**：检查是否有正确的 key 存储

---

### 状态
✅ 已修复

---

## #288 GET 超时返还逻辑错误（CRITICAL）

**发现时间**：2026-04-24

**问题现象**：
多个任务返还金额不正确：
- 任务 1777041404664：扣 30 返 12（应返还 30）
- 任务 1777039568766：扣 30 返 12（应返还 30）
- 任务 1777036521957：扣 30 返 24（应返还 30）
- 任务 1777032224715：扣 30 返 18（应返还 30）

**根因分析**：
GET 接口超时返还使用 **状态统计逻辑**，而非 **数学结算逻辑**：

```javascript
// ❌ 错误逻辑：遍历 imageItems 统计 generating 状态数量
const failedCount = updatedImageItems.filter(i => i.status === 'failed').length;
const refundAmount = failedCount * creditsPerImage;

// 问题：
// 1. imageItems 状态可能不准确（SSE 推送了 completed 但数据库没同步）
// 2. 有些图片被标记为 completed 但实际没有成功
// 3. 导致返还金额错误
```

**修复方案**（军师建议）：
使用 **数学结算逻辑**，以预扣金额为基准：

```javascript
// ✅ 正确逻辑：数学结算
// 1. 获取预扣金额（这是债务总额）
const creditsCharged = result.requestParams?.creditsCharged || (generationCount * creditsPerImage);

// 2. 统计真正"落袋为安"的成功数（必须是有图且状态为 completed）
const successCount = imageItems.filter(item => 
  item.status === 'completed' && item.url && item.url.startsWith('http')
).length;

// 3. 计算应返还金额（未完成的全部退回）
const expectedRefund = creditsCharged - (successCount * creditsPerImage);

// 4. 返还
if (expectedRefund > 0) {
  await handlePartialRefund(...);
}
```

**优势**：
1. **容错性强**：不管状态是什么，只看"有没有成功出图"
2. **数据一致性**：以预扣金额为基准，保证"预扣 - 消耗 = 退还"永远成立
3. **修复 Ghost 任务**：能解决 unknown 状态导致的坏账

**修改文件**：
- `src/app/api/image-to-image/route.ts`
  - 第 828 行：setTaskResult 添加 creditsCharged 字段
  - 第 1595-1680 行：GET 接口超时返还逻辑改为数学结算
- `src/lib/taskResultsCache.ts`
  - requestParams 类型添加 creditsCharged 字段

**补偿操作**：
已补偿 54 积分（18+18+6+12），记录 reference_id: compensation-2026-04-24-01

---

### 状态
✅ 已修复

---

## #289 删除图片刷新后恢复

**问题描述**：
用户反馈："画布中的图片我删除了，刷新网页又出来了？"

**根因分析**：
1. 元素变化后有 **1 秒防抖保存** 到 localStorage
2. 用户删除图片后，如果 **1 秒内刷新页面**，删除操作还没保存
3. 页面重新加载时从 localStorage 恢复了旧数据，删除的图片又出现了

**原有代码问题**：
```typescript
// CanvasContext.tsx - 自动保存有 1 秒防抖
useEffect(() => {
  const timer = setTimeout(() => {
    saveStateToStorage(state, isRestoring);
  }, 1000);  // 防抖 1 秒
  return () => clearTimeout(timer);
}, [state.elements, state.annotations, isRestoring]);
```

**修复方案**：
在 `deleteElement` 和 `deleteSelected` 函数中显式调用 `saveStateToStorage`，删除后立即保存。

```typescript
// #289 修复：删除后立即保存，防止刷新后恢复
const deleteElement = useCallback((id: string) => {
  dispatch({ type: 'DELETE_ELEMENTS', payload: [id] });
  saveHistory();
  // 立即保存到 localStorage
  saveStateToStorage(stateRef.current, false);
  console.log('[Canvas] #289 删除元素后立即保存');
}, [saveHistory]);

const deleteSelected = useCallback(() => {
  if (state.selectedIds.length > 0) {
    dispatch({ type: 'DELETE_ELEMENTS', payload: state.selectedIds });
    saveHistory();
    // 立即保存到 localStorage
    saveStateToStorage(stateRef.current, false);
    console.log('[Canvas] #289 删除选中元素后立即保存');
  }
}, [state.selectedIds, saveHistory]);
```

**修改文件**：
- `src/contexts/CanvasContext.tsx`
  - deleteElement 函数添加立即保存
  - deleteSelected 函数添加立即保存

**验证方法**：
1. 在画布中上传或生成图片
2. 删除图片
3. 立即刷新页面
4. 确认图片不再出现

---

### 状态
✅ 已修复
