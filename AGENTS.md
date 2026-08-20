# Canvas 画布编辑器

---

## 🛡️🛡️🛡️ 最高架构军规（第一位 - 必须遵守）🛡️🛡️🛡️

**无论执行任何开发任务，必须严格遵守以下六大原则。违背任何一条即视为任务失败！**

### 0. 隔离文件原则（Isolation File）⛔ 最高优先级

- **隔离文件名**：`.env.isolated`（项目根目录）
- **内容**：GitHub 地址/Token、双数据库（开发/生产）地址和密钥等敏感信息
- **禁止推送**：此文件已在 `.gitignore` 中排除，严禁以任何方式推送到 GitHub
- **禁止泄露**：严禁在代码、日志、控制台中输出此文件的任何内容
- **引用规范**：需要使用敏感信息时，从 `.env.isolated` 或 `.env.local` 读取，禁止硬编码

### 0.1 环境文件原则（Env File）⛔ #756 血泪教训

- **只使用 `.env.local`**：开发和生产环境统一使用 `.env.local`，**禁止使用 `.env.production`**
- **原因**：`.env.production` 容易导致环境混淆、数据库连接错误、部署失败等问题
- **ecosystem.config.js**：只读取 `.env.local`，不读取 `.env.production`
- **切换环境方式**：通过修改 `.env.local` 中的 `NODE_ENV` 和数据库地址来切换环境
- **禁止**：在代码中硬编码数据库地址、API密钥等敏感信息

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

### 6.5 真·离线异步状态机（Offline Async State Machine）⛔ #852 血泪教训

**视频生成时间超过3分钟，必须走"数据库状态机+后台定时查表"的离线工作流！**

#### 架构原则
- **禁止HTTP死等**：Nginx/网关不可能允许一个HTTP请求挂起90分钟，连接必断
- **短轮询窗口**：后端轮询窗口仅 2-3 分钟（maxPolls=36, pollInterval=5000），超时后返回 `still_processing` 并切断HTTP
- **离线巡检接管**：`/api/cron/sync-video-status` 每分钟扫描 `video_generation_tasks` 表中 status=processing 且未超90分钟的任务，向服务商发起状态查询
- **断连不退款**：视频任务SSE断连时，仅停止HTTP写入（`closed=true`），绝不修改任务状态、绝不退款。任务继续保持 processing 状态等待离线巡检

#### 关键表 video_generation_tasks
| 字段 | 类型 | 说明 |
|------|------|------|
| task_id | TEXT PK | 前端生成的唯一任务ID |
| user_id | TEXT | 用户ID |
| model | TEXT | 模型ID |
| prompt | TEXT | 提示词 |
| status | TEXT | processing/completed/failed |
| video_url | TEXT | 最终视频URL |
| provider_task_id | TEXT | 服务商返回的任务ID |
| poll_url | TEXT | **完整的服务商轮询URL（含endpoint+path）** |
| credits_used | INTEGER | 已扣积分 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |
| completed_at | TIMESTAMPTZ | 完成时间 |
| error_message | TEXT | 错误信息 |

#### 新增视频模型时必须
- [ ] 在 handler 提交阶段调用 `registerVideoTask()`（传入 `providerTaskId` + `pollUrl`）
- [ ] 在 handler 完成阶段调用 `markVideoTaskCompleted()`
- [ ] 在 handler 失败阶段调用 `markVideoTaskFailed()`
- [ ] 确保 `pollUrl` 包含完整的服务商轮询URL（baseEndpoint + path + taskId）
- [ ] 离线巡检Cron的 `extractStatus()` 和 `extractVideoUrl()` 能正确解析该服务商的响应格式

### 7. 新增视频模型军规（New Video Model Checklist）⛔ #690 血泪教训

**每次新增视频模型，必须逐条检查以下清单。漏一条即为任务失败！**

**核心铁律：每个模型的配置和逻辑必须完全独立！禁止共用其他模型的任何代码分支！只有模型映射判断函数（如 `isXxxModel`）可以三端共用。**

#### 7.0 独立性铁律（最高优先级）

- **⛔ 禁止共用配置**：每个模型必须有自己独立的 `XXX_MODE_CONFIG`，不能复用其他模型的 config
- **⛔ 禁止共用分支**：`switch/case` 或 `if/else` 中每个模型必须有独立分支，不能 fall-through 到其他模型
- **⛔ 禁止共用判断**：`isXxxModel` 判断函数只做模型识别（三端共用），不包含任何业务逻辑
- **✅ 可共用**：`ModelDetector.getFamily()` 识别函数（纯判断，无逻辑）

#### 7.1 模型识别层（model-utils.ts）

- [ ] `ModelDetector.getFamily()` 添加新模型识别（注意：判断条件必须匹配数据库中的实际 model_id，不能假设前缀）
- [ ] `MODEL_MODE_CONSTRAINTS` 添加新模型支持的模式列表（如 `['t2v', 'i2v', 'r2v']`）

#### 7.2 素材限制层（effective-sources.ts）

- [ ] `getModeConstraint()` 添加新模型独立分支，返回正确的 image/video/audio 限制
- [ ] `getModelSupportedTypes()` 确保新模型的上传入口正确

#### 7.3 模式切换组件（ModelModeSwitcher.tsx）

- [ ] `ModelType` 类型添加新模型标识（如 `'topais'`）
- [ ] 新增 `XXX_MODE_CONFIG` 独立配置（模式名、标签、图标、描述）
- [ ] 新增 `isXxxModel()` 判断函数
- [ ] 新增 `getXxxModeParams()` 参数显示配置（时长/分辨率/比例是否显示）
- [ ] 新增 `getXxxSlotStatus()` 素材槽位配置（每种模式最多几张图/视频/音频）
- [ ] `useModeLogic` 添加新模型独立分支
- [ ] `ModeDropdownContent` 添加新模型独立渲染

#### 7.4 三端页面（必须全部修改！漏一个就是 BUG！）

| 页面 | 文件 | 必须修改的项 |
|------|------|-------------|
| 视频页 | `src/app/video/page.tsx` | `isXxxModel` 变量 + `isModeSwitchModel` 包含 + `hhCurrentMode` 推断 + `ModelModeSwitcher` 的 `modelType` + 发送参数 `hhMode` + Logo 判断 + `hhParams` |
| 画布面板 | `src/components/GeneratePanelNode.tsx` | `isXxxModel` 变量 + `isModeSwitchVideoModel` 包含 + `hhCurrentMode` 推断 + `ModelModeSwitcher` 的 `modelType` + 发送参数 `hhMode` + Logo 判断 + `hhParams` |
| 对话框 | `src/components/temp_RightPanel.tsx` | `isXxxModel` 变量 + `isModeSwitchModel` 包含 + `hhParams` + `ModelModeSwitcher` 的 `modelType` + Logo 判断 |

#### 7.5 共享状态层（AIGeneratorContext.tsx）

- [ ] `hhCurrentMode` useMemo 推断逻辑添加新模型独立分支（根据参考图数量推断模式）

#### 7.6 后端路由（route.ts）

- [ ] `hhMode` 映射逻辑添加新模型独立分支（前端模式 → 后端 generation_type）
- [ ] 异步轮询逻辑（如需要）
- [ ] 进度透传（progress 0-100）
- [ ] 积分计算和返还

#### 7.7 验证清单（每个新模型必须逐项验证）

| 序号 | 验证项 | 验证方法 |
|------|--------|----------|
| 1 | 模式切换按钮三端可见 | 视频页/画布面板/对话框分别切换到该模型 |
| 2 | 模式切换功能正确 | 切换 t2v/i2v/r2v 后素材限制变化正确 |
| 3 | 参考图不灰色 | 上传参考图后 opacity 为 1，不灰化 |
| 4 | 发送参数正确 | 控制台检查 hhMode / generation_type 映射 |
| 5 | 进度显示正常 | 生成时 progress 百分比正确显示 |
| 6 | Logo 显示正确 | 三端 Logo 图标正确 |
| 7 | 积分计算正确 | 扣费和返还逻辑正确 |
| 8 | **提交响应字段名** (#836 血泪) | **curl 提交接口确认任务ID字段名（task_id? id? request_id?），代码提取路径必须一致！** |
| 9 | **轮询成功状态词匹配** (#836 血泪) | **curl 轮询接口确认服务商返回的成功 status 值（completed? succeeded? done?），代码必须覆盖所有可能！** |
| 10 | **轮询失败状态词匹配** (#836 补充) | **curl 轮询接口确认服务商返回的失败 status 值（failed? error? rejected?），代码必须覆盖，否则失败时卡死不退还积分！** |
| 11 | **视频URL提取路径正确** (#836 血泪) | **curl 轮询接口确认视频URL在响应JSON的哪个字段（result.url? result.data[0].url? videos[0]?），代码提取路径必须一致！** |
| 12 | **URL是否为相对路径** (#836 血泪) | **curl 检查返回的URL是否以http开头，如果是/开头则必须用baseEndpoint动态拼接（禁止硬编码域名）！** |
| 13 | **进度字段名与取值范围** (#836 补充) | **curl 确认进度字段名（progress? percent?）和取值范围（0-100? 0-1?），代码必须正确映射！** |

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
| #890 | 终极全面清扫：全站鉴权/缓存隔离/UI弹窗/多标签页同步 | **clearSensitiveLocalStorage集中24个敏感Key+alert()全灭→toast+跨Tab auth_signal+storage事件监听+5个API路由加requireAuth+video/generate userId从JWT非body+账号切换原子性reset(prevUserIdRef)+CanvasContext SET_ELEMENTS清空+video清prompt** | ✅ 已修复 |
| #887 | 画布云端存储升级：localStorage→云端账号绑定 | **autosave路由requireAuth替代Authorization header+useAutoSave添加credentials:include+CanvasContext传入真实userId/isLoggedIn+登录后自动云端加载+localStorage数据自动上传云端+sendBeacon→fetch keepalive+FK约束移除+dev-sandbox用户创建+lz-string压缩+防抖5s+最大等待10s强制保存+CAS乐观锁(updated_at校验+409冲突弹窗让用户决定绝不静默覆盖)+解压三层防爆(decompress→JSON.parse降级→localStorage回退)+云端加载全区域遮罩锁定交互防抢占** | ✅ 已修复 |
| #886 | 视频面板双进度条+右键菜单不消失+浏览器右键范围过宽 | **删除SVG圆形进度环+CanvasRoseCurve传externalProgress显示真实进度+进度文本条件化+关闭监听增加mousedown/pointerdown/wheel/contextmenu+data-panel-context-menu属性排除+onContextMenu白名单收紧移除isEditing/getSelection** | ✅ 已修复 |
| #856 | P0 生产5项严重问题修复+数据缓存根除+Loading卡死 | **支付回调order_no→out_trade_no+CAS锁status=pending→unpaid+isPaymentLoading按钮禁用+AssetCard/HeroCarousel img→Image fill+next.config.ts remotePatterns(COS域名)+layout.tsx/api/config dynamic=force-dynamic+revalidate=0(4个路由)+GeneratePanelNode/canvas/page.tsx onStillProcessing回调补齐+超时分支isLocalGenerating兜底** | ✅ 已修复 |
| #878 | 代码层超时扩容+熔断精细化重构 | **6个路由maxDuration 300→1900+轮询/请求超时300s→1800s+circuit-breaker 6h→24h+useGenService 600s→1800s+3s→5s+bannedResolutions从string[]改为Record<modelId,Record<resolution,expiry>>+fetchCircuitBreakers按modelId维度构建+currentModelBannedResolutions useMemo+isResolutionBanned()+1秒自动解锁定时器+三端倒计时文案** | ✅ 已修复 |
| #866 | MiniMax-H3模式切换比例残留+TypeError toLowerCase崩溃 | **r.size→(r.size\|\|r.value)兼容MiniMax分辨率格式+三端模式切换比例自动跳转(video页handleModeChangeFromSwitcher+画布setOverrideMode+对话框useEffect prevMinimaxModeRef)+null守卫** | ✅ 已修复 |
| #865 | 新增Kling v3 Omni视频模型(ToAPIs) | **7层架构完整集成+topais-kling-omni family+4模式(t2v/i2v/r2v/audio)+Omni引用语法(<<<image_N>>>)+mode映射(std=720P/pro=1080P)+audio/video_list互斥+6种计费规格+POST提交+GET轮询+registerVideoTask离线巡检+数据库seed脚本** | ✅ 已完成 |
| #864 | MiniMax-H3分辨率+比例按模式精准适配 | **768p分辨率添加+showResolution启用+t2v过滤adaptive/i2v隐藏比例/r2v保留adaptive+getTopaisMinimaxAvailableRatios按模式过滤+768p半价计费(10积分/秒)+数据库迁移** | ✅ 已修复 |
| #853 | P0 前端MiniMax-H3模型UI配置补齐+画布上传竞态漏洞 | **数据库api_models缺topais-minimax-h3+defaultModels fallback缺+SourceImageEl扩展isLoading+缩略图Spinner叠加+handleGenerateClick上传拦截(blob:URL/isLoading)+生成按钮disabled** | ✅ 已修复 |
| #852 | P0 废除HTTP死等，重构真·离线异步状态机 | **#851异步放手vs#848断连退费致命冲突+HTTP不可能挂90分钟+abort guard视频任务仅停止写入不退款+离线巡检Cron(/api/cron/sync-video-status)+video_generation_tasks表扩展(provider_task_id/poll_url)+14个handler落库registerVideoTask+后端轮询窗口540→36(90min→2min)+前端绝对超时5400→600(90min→10min)** | ✅ 已修复 |
| #851 | P0 视频生成50分钟超长等待导致系统灾难修复 | **Cron斩杀线30min→90min+前端Fire-and-Forget异步放手(超时不再退款改为still_processing)+后端轮询超时不再退款改为后台异步+所有handler提交阶段黑洞防护(body-level错误检查)+VideoTask/TaskResult/GenServiceResult类型扩展processing状态** | ✅ 已修复 |
| #850 | P1 新增MiniMax-H3+画布拉线弹窗消失+Seedance model映射缺失 | **7层架构完整集成(topais-minimax)+#841修复副作用onPlusPointerUp提前清除draftLineRef致弹窗消失+handleTopaisSeedanceGeneration缺model.replace(/^topais-/, '')致服务商后台无记录** | ✅ 已完成 |
| #845 | P0 根除积分脏读漏洞(CAS乐观锁) | **deductCredits先读-再算-后写脏读漏洞→CAS(Compare-And-Swap)乐观锁循环(PATCH WHERE credits=eq.C精确匹配)+3处脏写路径全收口(credits.ts+credits/deduct+user/deduct-credits)+RPC注入脚本备用** | ✅ 已完成 |
| #844 | P0 僵尸任务定时清理(Cron Job) | **credit_logs交叉比对(扣费+未退费+未完成→退费)+video_generation_tasks状态扫描(pending/processing→timeout_failed+退费)+CRON_SECRET安全校验+幂等退费** | ✅ 已完成 |
| #843 | P0 轮询绝对超时斩断与退费兜底 | **图片5分钟/视频15分钟绝对超时+每Tick检查Date.now()-startTime+超时→clearInterval→/api/generation/timeout-refund退费+timeout_failed防诈尸** | ✅ 已修复 |
| #842 | COS计费风暴止血：Cache-Control缺失+_t=Date.now()缓存杀手 | **6个代理路由Cache-Control升级(perm→1年/temp→1天/immutable)+7处_t=${Date.now()}缓存杀手删除+302重定向加缓存头** | ✅ 已修复 |
| #839 | 裁剪后图片未持久化COS+参考图索引闭包陷阱 | **裁剪确认后base64未上传COS(刷新丢失)+chatImageBase64s.length闭包陷阱(并行上传索引冲突→部分URL空→参考图丢失)+handleSend逐项回退base64兜底+uploadFile异步上传** | ✅ 已修复 |
| #841 | 历史记录清空+日期筛选+画布+号长按BUG | **清空改造(保留最近N条/全清/日期范围清空)+日期范围日历筛选+画布+号onPointerUp/Cancel缺draftLineRef.current.active=false清除+clearInteractionCanvas+军师靶向拦截补#magnet-btn-multi-select** | ✅ 已修复 |
| #838 | 前端请求风暴根治 | **useEffect依赖地狱(creditsChanged监听器credits/user重注册)+canvas/page.tsx三重config fetch+fetchConfig去重工具+Navbar ref替代state+删除重复modelCreditsUpdated监听+TS2344路由类型修复** | ✅ 已修复 |
| #837 | Supabase读风暴后端缓存 | **6个高频API路由零缓存+getSupabaseClient无单例+config-cache/canvas-config-cache/circuit-breakers-cache/user-info-cache/credits-cache+管理后台缓存失效** | ✅ 已修复 |
| #836 | MEGA AI Seedance 视频轮询三连暴击 | **status="succeeded"不认(只认completed)+result.url路径错误(写result.data[0].url)+相对路径/outputs/未拼接域名→轮询120轮超时→用户被扣积分但没收到视频** | ✅ 已修复 |
| #821 | 展示区+轮播图数据为空 | **生产数据库canvas_config种子数据缺失+auto-seed-showcase.ts幂等脚本+instrumentation.ts启动检查+19条展示卡+3条轮播图直接灌入生产库** | ✅ 已修复 |
| #758 | 登录后又显示未登录 | **Cookie secure属性错误(HTTPS环境需secure=true)+前端fetch缺credentials:include+登录/注册/用户信息接口全部修复** | ✅ 已修复 |
| #810 | 生图任务服务器未收到实际参考图 | **前端发送代理URL(/api/canvas/image?key=xxx)给后端→服务商无法访问→后端检测代理URL并转换为COS签名URL(image-to-image+video/generate双路由修复)** | ✅ 已修复 |
| #819 | 展示区动态参数+用户提交审核+管理员审核流 | **model_spec_mapping字典表+AddCardModal模型级联清洗+COS跨桶Copy+404兜底expired状态+防重复提交is_submitted+4.8天过期置灰+SubmitToShowcaseModal+ShowcaseReviewPanel** | ✅ 已完成 |
| #819-1 | 筛选栏白色矩形残留修复 | **bg-white/80在bg-[#F8F9FA]上仍可见→默认去掉背景+只在scrolled吸顶时才加毛玻璃** | ✅ 已修复 |
| #818 | 骨架屏植入+拖拽修复+筛选栏白色矩形 | **SkeletonCard骨架屏消除白屏塌陷+setPointerCapture改document级监听修复拖拽+Header全宽背景消除白色矩形+useMemo条件调用修复** | ✅ 已修复 |
| #817 | 展示区/轮播区加载失败+ID33硬编码+上传路由assetType Bug | **生产服务器502+ID33硬编码本地路径→COS代理URL+upload route.ts assetType只读FormData不支持query params→双源读取** | ✅ 已修复 |
| #807 | 展示区/轮播图生产环境加载失败 | **route.ts key前缀验证过严：perm资产dev/前缀在生产环境被拒绝返回400+perm资产允许dev/prod双前缀跨环境访问** | ✅ 已修复 |
| #757 | 生成记录页面加载慢+破图+视频参考图缺失 | **默认limit 100→20+去掉count双重查询+图片onError代理回退+9处视频insert缺reference_images/reference_image_keys+7个接口加uploadedRefKeys** | ✅ 已修复 |
| #301 | TOPAIS Veo 模式映射错误+视频URL提取失败+进度不同步 | **画布handleSend缺TOPAIS/LingYa分支(hhMode不传→后端兜底frame)+metadata.url提取缺失+假进度!msg.videoProgress卡1%+假进度不同步占位符** | ✅ 已修复 |
| #724 | 视频轮询间隔+错误中文翻译+占位符样式统一 | **轮询1秒改3秒+translateErrorMessage翻译英文错误+CanvasVideo用CanvasRoseCurve替换SVG进度环+渐变背景+真实进度** | ✅ 已修复 |
| #755 | 画布auto占位符出图不收缩+生图页面模型名称显示原始ID | **updatePlaceholder getImageDimensionsWithRetryCore失败→元素保持1:1→onImageLoad安全网自动修复+selectedTask.params.model未映射modelDisplayNames** | ✅ 已修复 |
| #SSE | SSE进度事件不实时(sendEvent缺yield+TS1308编译错误) | **9个同步sendEvent缺async+setTimeout(0)yield导致enqueue后不flush TCP缓冲+start()非async中await无效(TS1308)+所有进度事件积压到流关闭时一次性发送** | ✅ 已修复 |
| #682 | 新增 TOPAIS 供应商+Veo3.1-fast | **topais模型家族+isTopaisVeoModel+handleTopaisVeoGeneration(POST/GET异步轮询)+metadata.generation_type自动判断+固定8秒+720p/1080p/4k+前端独立配置+数据库独立api_configs/api_models记录** | ✅ 已完成 |
| #7xx | TOPAIS HappyHorse 1.0 新增 | **topais-happyhorse模型家族+isTopaisHhModel+handleTopaisHhGeneration(action参数映射)+POST提交+GET轮询+进度透传+3-15秒+720p/1080p+5种比例+r2v最多9张参考图+独立数据库记录** | ✅ 已完成 |
| #736 | TOPAIS Seedance 2.0 / 2.0-Fast 新增 | **topais-seedance模型家族+isTopaisSeedanceModel+handleTopaisSeedanceGeneration(image_with_roles角色映射)+POST提交+GET轮询+进度透传+4-15秒(标准)/4-12秒(快速)+720p/1080p+6种比例+t2v/i2v-first-frame/i2v-first-last-frame/r2v四模式+独立数据库记录** | ✅ 已完成 |
| #690 | TOPAIS Veo 真实进度被 progress=0 误杀 | **progress=0不是真实进度+typeof 0===number误判+三端onVideoProgress加>0守卫+后端TOPAIS Veo不发送progress=0事件+假进度引擎不被误杀** | ✅ 已修复 |
| #690补充 | CanvasVideo占位符误判失败+假进度字段映射错误 | **isVideoFailed误判generating为failed(!videoSrc&&!isLoading)+假进度更新progress字段但CanvasVideo读generationProgress字段+修复字段对齐+排除generating中间态** | ✅ 已修复 |
| #7xx | 假进度引擎物理切除过度：对话框进度环永远0% | **假进度onProgress回调恢复setMessages+saveMessages stableSnapshot已排除videoProgress不会死循环+画布占位符canvas.updateElement+对话框进度环msg.videoProgress** | ✅ 已修复 |
| #690 | TOPAIS画布面板缺模式切换+参考图灰色+进度不显示+视频未收到 | **GeneratePanelNode完全缺失TOPAIS支持+AIGeneratorContext hhCurrentMode缺TOPAIS分支+ModelDetector.getFamily修正+后端进度透传(video_url/video/videos兼容)+模拟进度兜底+SSE流关闭(controller.close+return)** | ✅ 已修复 |
| #681 | 视频参数全盘断层修复 | **防丢参数映射+safeAspectRatio/safeDuration/safeResolution+handleSeedance2Generation去除回退默认值+buildHappyHorseRequestBody去除回退默认值+原始请求体诊断日志** | ✅ 已修复 |
| #679 | 支付维护开关功能 | **app_config配置项+maintenance API+管理后台开关UI+充值页面维护提示** | ✅ 已完成 |
| #678 | 支付订单表缺失字段修复 | **raw_notify JSONB字段+user_id NOT NULL约束+PAYMENT_PID/KEY/API_URL配置** | ✅ 已修复 |
| #662 | 三端视频上传按钮图标+缩略图播放logo+生成音频开关统一 | **Video摄像机图标+播放三角形居中+ModelModeSwitcher弹窗底部生成音频开关+三端统一逻辑** | ✅ 已修复 |
| #677 | 幽灵状态污染+模式死锁+双黄蛋+多选恢复 | **hhCurrentMode幽灵污染Sora/Veo导致getMaterialTypeLimits('t2v','sora')返回image:0+条件分流isModeSwitchModel?getMaterialTypeLimits:getModelMaxLimits+互斥解除hhOverrideMode==='t2v'时清除+删重复Loading+恢复multiple** | ✅ 已修复 |
| #676 | 视频页面素材UI重构+画布静默预加载 | **彻底隐藏"不支持素材"文案+Grid 1行4个自适应正方形+右下角"禁用"+title悬浮提示+禁用多选上传+3按钮独立呈现(图片/视频/音频基于模型能力显示)+模式解耦+fileInputRef纯净化+视频上传分发(HappyHorse→inputVideoUrl/Seedance→refVideoUrls)+画布blobUrl→cloudUrl静默预加载消除闪烁** | ✅ 已修复 |
| #647 | 三端素材上传逻辑重构+视频面板黑膜修复 | **getModelSupportedTypes模型能力判断上传入口+getMaterialTypeLimits模式限制判断生效+视频缩略图黑膜移除+三端统一逻辑** | ✅ 已修复 |
| #646 | 三端音频按钮正方形化+视频按钮合并+拖拽抖动+死循环修复 | **音频按钮改正方形放在视频按钮后+灰化不可用按钮点击toast提示+对话框合并两个视频按钮+拖拽onDragLeave判断relatedTarget防抖动+t2v上传区域条件改为video||audio** | ✅ 已修复 |
| #645 | 素材类型区分计数+Seedance音频上传三端统一+t2v上传按钮 | **getMaterialTypeLimits按类型(image/video/audio)分别计数+AudioUploader三端所有模式+generateAudio所有模式+limits.image替代maxRef** | ✅ 已修复 |
| #641 | HappyHorse 素材限制+Sora-2 VIP 2合1 | **视频元素误计参考图+connectedImageUrls过滤视频+t2v上传按钮+对话框参考图限制+Sora-2 VIP前端2合1+统一入口sora-2-all-vip+时长选择器+动态积分** | ✅ 已修复 |
| #638 | Lingya Veo3.1 双模型收口 | **灵芽API+OpenAI兼容格式+FormData+URL直传参考图+固定8秒+双模型收口+mapToRealLingyaModel+固定一口价计费+剔除1:1/1080p** | ✅ 已完成 |
| #637 | 视频轮询结果丢失修复 | **pollTaskStatus缺videos+setTaskResult缺videoKeys+onVideoReceived未调用+轮询complete无视频处理** | ✅ 已修复 |
| #623 | 面板视频缩略图+悬停视频预览弹窗+视频链接传递 | **SourceImageEl扩展+sourceImageEls视频分支+video缩略图渲染+createPortal视频预览+videoKey映射imageKey+getLatestElement视频支持** | ✅ 已修复 |
| #622 | 视频加号和视频面板拉线不生效 | **contain:strict裁剪+x/y传0+磁吸缺video+面板禁止输出+sourceElementType** | ✅ 已修复 |
| #621 | 视频加号连线+右键上传定位 | **视频加号+连线菜单禁图视仅文本+sourceElementType+右键上传不偏移不居中+contextMenuUploadTargetRef+CanvasContent props传递** | ✅ 已修复 |
| #620 | 多选右键菜单+闭包陷阱+视频空白检测 | **闭包陷阱+memoizedOnContextMenu空依赖+stateRef+canvas.state.selectedIds过时+视频全屏加大+空白检测加video** | ✅ 已修复 |
| #614 | 多选拉线与面板创建四项修复 | **多选加号大小+多选面板尺寸+连线目标过滤+视频播放控制** | ✅ 已修复 |
| #609 | 雷霆四连刀：根除混合合成陷阱残毒 | **CSS GPU毒药+translateZ残留+数组重排核爆+40000px显存黑洞+zIndex替代重排+DOM静止原则+flushSync移除** | ✅ 已修复 |
| #608 | 混合合成陷阱修复：全面降维手术 | **混合合成陷阱+Mixed Compositing Bug+全面降维+纯2D渲染+CPU图层+GPU图层冲突+删除willChange** | ✅ 已修复 |
| #607 | 玻璃覆盖层架构：图片层与 UI 层物理隔离 | **玻璃覆盖层+Overlay+GPU图层隔离+Figma同款架构+图片层独立** | ✅ 已修复 |
| #606 | 军师核级别隔离舱：给 GeneratePanelNode 打上 React.memo 思想钢印 | **React.memo+隔离舱+未隔离的核弹+全屏重绘污染+5815行巨型组件+严格props比对** | ✅ 已修复 |
| #602 | 消除物理置顶延迟感：去掉requestAnimationFrame+同步化面板响应+军师方案职责分离 | **forceBringToFront同步DOM+handleDragStart立即选中+onPointerDown只选中置顶+onPointerUp弹窗切换+isDragging判断+关闭已激活面板** | ✅ 已修复 |
| #592 | 编组功能删除 | **删除编组渲染代码+移除group类型+删除groupChildIds/groupId字段** | ✅ 已删除 |
| #591 | DOM物理隔离：彻底斩断insertBefore死锁+use-sidecar依赖修复 | **canvas-elements-layer隔离div+display:contents稳定DOM壳+React.Fragment key包裹+占位div替代null返回值+use-sidecar缺失ESM文件** | ✅ 已修复 |
| #590 | 互斥锁修复：多选与单选工具栏同时出现 | **互斥锁+if-else if+逻辑穿透+多选单选同时出现+重构连环案** | ✅ 已修复 |
| #589 | 消除早期return后的可选链防御补全 | **可选链+Optional Chaining+空数据访问+undefined.x+坐标计算+selectedImageEl存在性检查** | ✅ 已修复 |
| #588 | React 19 insertBefore 错误彻底根除（架构级重构） | **结构全闭环+单一return出口+带稳定key的Fragment+isVisible变量** | ✅ 已修复 |
| #586 | React 19 insertBefore 错误终极修复（推翻#585部分假设） | **条件包裹层撕裂+变量赋值法+统一Fragment返回+crypto.randomUUID替代Math.random** | ✅ 已修复 |
| #585 | React 19 insertBefore 错误真正修复（推翻#584） | **移除startTransition（加剧问题）+selectElement不再重排数组+flushSync包裹必要重排+ADD_ELEMENTS批量+updateElementsBatch** | ✅ 已修复 |
| #583 | React 19 insertBefore 错误完整修复 | 拉伸+拖拽RAF批量更新+resizeRafRef+dragRafRef+cancelAnimationFrame+updateElementsBatch替代循环调用 | ✅ 已修复 |
| #582 | React 19 insertBefore 错误：编组移动 | groupDragRef._rafId+requestAnimationFrame批量更新+onPointerUp清理RAF | ✅ 已修复 |
| #578 | 多选加号样式+夜间模式+多选框圆点+编组边框 | buttonSize上限32px+CSS变量夜间模式+圆点隐藏保留拉伸+编组浅灰背景+四角拉伸+残留线条清除+四角光标nwse-resize | ✅ 已修复 |
| #575 | 多选加号拖拽磁吸视觉效果修复 | setSnapHighlightId无条件调用+onMouseDown阻止冒泡到handleMouseDown | ✅ 已修复 |
| #577 | 多选加号磁吸视觉完整修复+Y轴跟随 | handleMouseDown免死金牌+磁吸跟随逻辑(distX*0.8*zoom坐标空间修正)+连线起点动态计算 | ✅ 已修复 |
| #576 | 多选加号磁吸渲染风暴+SVG类型封锁解除 | setSnapHighlightId函数式更新防渲染风暴+validSnapTypes显式包含multi-select+端口高亮data-node-id兜底 | ✅ 已修复 |
| #574 | 多选加号磁吸连接修复（真正根因） | setPointerCapture阻止事件冒泡+局部onPointerUp直接处理磁吸连接 | ✅ 已修复 |
| #573 | 全局handleMouseUp添加multi-select磁吸连接处理 | sourceType==='multi-select'时更新目标sourceIds+过滤元素类型+去重 | ✅ 已修复 |
| #572 | 多选加号磁吸检测补全+编组按钮显示条件修复 | onPointerMove磁吸检测逻辑补全+selectedImages过滤条件放宽 | ✅ 已修复 |
| #569 | 视频模型Logo+参考图缩略图交互+多选加号修正+模型弹窗优化+多选右键菜单 | Seedance/Veo/Sora2专属Logo+暗色模式白色+缩略图排序数值/悬浮删除/悬浮大图+加号avgSize*0.05上限32px+模型名不换行+已选模型Logo+多选右键删除菜单 | ✅ 已修复 |
| #571 | 多选加号磁吸恢复+样式修正+多选内图片隐藏加号+Seedance Logo | 全局handleMouseMove添加multi-select磁吸+多选加号改用draft-line-main/glow+onPointerUp磁吸连接+多选时隐藏单图加号+替换seedance-logo.png | ✅ 已修复 |
| #570 | 多选加号缩放+缩略图交互修复+多选右键+删除合并图层+视频上传 | 多选加号0.05比例+32px上限+拖线连接+缩略图删除无色+悬浮完整图70%+多选右键不取消+删除合并图层+画布视频上传 | ✅ 已修复 |
| #568 | 多选右键菜单+图层删除+编组修复+文字缩放+多选连线+右键菜单复刻 | 多选右键删除+LayerPanel移除+编组边框/发送+文字外部拉伸+多选磁吸加号__multi_select__+深色右键菜单 | ✅ 已修复 |
| #633 | HappyHorse 1.0 视频模型集成（灵芽API） | t2v/i2v/r2v/video-edit四模式+ModelModeSwitcher组件+后端自动判断子模型+三端统一交互+异步轮询+对话框集成 | ✅ 已完成 |
| #634 | HappyHorse 进度条接入+模式推断修复+三端UI重设计 | hhCurrentMode useMemo补video-edit/r2v推断+chatVideoUrl状态+后端progress透传+localProgress局部状态防渲染风暴+ModelModeSwitcher三端variant重设计+SVG进度环 | ✅ 已完成 |
| #567 | 历史记录视频标注/预览+模型弹窗+画布视频计费+宫格标签 | video source字段+视频预览弹窗+下载按钮+弹窗440px+计费统一+宫格标签改免费 | ✅ 已修复 |
| #564 | 全局重构第二阶段：全面鉴权+收藏工厂+签名URL批量 | requireAuth/requireAdmin全覆盖+favorites-factory+batchGetSignedUrls+3个无认证接口补盾 | ✅ 已修复 |
| #563 | 全局重构：COS重复调用+认证中间件收口 | 公共武器库+requireAuth+requireAdmin+代码瘦身 | ✅ 已修复 |
| #554 | 熔断未触发+错误显示"生成失败" | classifyError服务商关键词+formatErrorMessage错误提取 | ✅ 已修复 |
| #555 | 视频播放CORS跨域与防盗链 | 视频流代理路由/api/video/proxy+动态降级包装URL | ✅ 已修复 |
| #556 | 视频参考图传输COS签名URL不可达+预览未铺满 | imageUrlToBase64后端强转换+video标签object-contain | ✅ 已修复 |
| #557 | COS签名URL路径前缀丢失导致参考图404 | uploadToCOS返回值+ENV_PREFIX环境前缀+getSignedUrl重复调用 | ✅ 已修复 |
| #558 | Veo分辨率选择改造+管理后台480p+任务详情参考图+切换模型清空 | showResolution动态分辨率+1080p自动降级+参考图保留裁剪 | ✅ 已修复 |
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
| #307 | generate-panel多源连接 | sourceId改为sourceIds数组，支持多图连接一个面板 | ✅ 已修复 |
| #308 | ComfyUI风格长按拉线+磁吸 | 拖拽阈值检测+磁吸吸附+空放弹窗+端口高亮 | ✅ 已修复 |
| #309 | 连接断开/被顶替 | 创建generate-panel使用sourceId而非sourceIds | ✅ 已修复 |
| #310 | pointerdown中preventDefault阻止后续鼠标事件 | 移除preventDefault调用 | ✅ 已修复 |
| #311 | 空放弹窗时线条消失 | 分离磁吸成功和空放弹窗的处理逻辑 | ✅ 已修复 |
| #312 | 线条样式简化+双向连线 | 移除pending状态，统一拖拽/永久线样式 | ✅ 已修复 |
| #313 | 工作流核心组件赋能 | 缩略图UI复刻+底部控制台移植+生成引擎接驳 | ✅ 已修复 |
| #314 | generate-panel组件化重构 | 完全组件化，内部状态隔离，弹窗局部化，参数存储元素自身 | ✅ 已修复 |
| #320.1 | 右键菜单偏移 | createPortal渲染到body避免transform影响 | ✅ 已修复 |
| #321.4 | Logo拉伸模糊 | 放弃transform scale，改用CSS百分比+SVG viewBox | ✅ 已修复 |
| #322 | 面板初始尺寸太小 | 获取首图尺寸作为面板初始尺寸（auto模式） | ✅ 已修复 |
| #323 | 圆角拉伸后变化 | 改用百分比borderRadius: '5%'替代固定像素 | ✅ 已修复 |
| #324 | 连接线与图片端口不贴合 | 统一startX为+44，endX为面板左边+1 | ✅ 已修复 |
| #325 | 弹窗被选中框遮盖+点击其他不收起 | 弹窗zIndex改为30+点击其他元素关闭弹窗 | ✅ 已修复 |
| #326 | 连接线端口坐标全面修正 | 图片+44/面板+1，区分源/目标节点类型 | ✅ 已修复 |
| #327 | 面板比例调整不超过初始高度 | 添加originalHeight字段，超过时调整宽度而非高度 | ✅ 已修复 |
| #328 | 面板拉伸后比例变回原比例 | 拉伸时设置panelRatio为'auto'，显示为"自动" | ✅ 已修复 |
| #329 | 连接线贴合图片边界 | 连接线从图片/面板边缘中心开始，不计算加号位置 | ✅ 已修复 |
| #330 | 面板右键菜单 | 创建副本（复制面板和连接）、删除面板 | ✅ 已修复 |
| #331 | 比例调整优化 | 始终使用初始高度计算宽度，保持一致性 | ✅ 已修复 |
| #332 | 副本自动排在原面板下方 | 计算最下方面板位置，左对齐不重叠 | ✅ 已修复 |
| #333 | 多选框时关闭面板弹窗 | setIsSelecting(true)时调用setActiveInputNodeId(null) | ✅ 已修复 |
| #334 | 面板创建位置不正确 | generateMenu存储画布坐标canvasX/canvasY | ✅ 已修复 |
| #335 | Delete键偶尔失效 | 检查面板弹窗焦点+data-panel-popup标记 | ✅ 已修复 |
| #336 | 比例调整取最长边约束 | 取初始宽高最大值为基准，比例调整不超过最长边 | ✅ 已修复 |
| #337 | 面板选择弹窗点击外部不关闭 | 全局点击监听+data-picker-popup/button标记 | ✅ 已修复 |
| #338 | 面板创建位置不对齐连线终点 | 接收端口(左边缘中心)对齐连线终点+增大磁吸半径80px | ✅ 已修复 |
| #343 | 面板拖拽无对齐线 | 全局视野架构：子组件上报坐标→父组件计算对齐线 | ✅ 已修复 |
| #344 | 面板拖拽无物理吸附 | 双向磁吸拦截：返回吸附坐标+面板使用吸附坐标 | ✅ 已修复 |
| #345 | 面板拖拽对齐线不显示 | 添加 isPanelDragging 状态+修改渲染条件 | ✅ 已修复 |
| #346 | 连线菜单样式优化+LLM连接 | 彩色Logo+文案按钮+文本类型连接语言大模型 | ✅ 已修复 |
| #352 | 文本面板比例固定+左上角标签 | 16:9比例(320x180)+面板类型标签 | ✅ 已修复 |
| #353 | 收藏数据库表分离 | 三种面板类型各自独立收藏表 | ✅ 已修复 |
| #354 | 收藏按钮与弹窗优化 | 图片/视频显示"收藏"+弹窗居中面板+文本面板默认提示词 | ✅ 已修复 |
| #355 | 安全审计清除外部CDN | 删除测试文件+Font Awesome本地化 | ✅ 已修复 |
| #356 | 新增GPT-Image-2模型 | T8Star供应商+b64_json响应解析+size参数小写化 | ✅ 已修复 |
| #357 | 生产环境配置错误 | .env.production指向开发数据库→修正为生产数据库 | ✅ 已修复 |
| #358 | 文本面板硬编码模型 | 添加llmModelOptions+模型选择弹窗+使用用户选择的模型 | ✅ 已修复 |
| #359 | LLM API使用SDK而非数据库配置 | 重写/api/llm/route.ts从数据库读取配置调用Gemini API | ✅ 已修复 |
| #364 | SSE complete事件缺少imageItems | 后端complete事件添加imageItems字段供前端查找图片 | ✅ 已修复 |
| #365 | 面板参考图使用blob URL | 方案B源头治理：上传时立即上传S3获取imageKey+签名URL | ✅ 已修复 |
| #366 | 单线蓄水池架构重构+面板横向串联 | 面板生成独立image-stack+覆盖确认弹窗+向上展开画廊+面板级联查找 | ✅ 已完成 |
| #367 | 数据隔离修正+Handle样式对齐 | 删除sourceTextContent+左侧蓝色/右侧绿色端口样式 | ✅ 已完成 |
| #383 | 点击加号取消选中面板 | setActiveInputNodeId(null)+canvas.clearSelection() | ✅ 已修复 |
| #384 | 点击加号取消拉线和菜单 | 清除generateMenu+draftLineRef+SVG线条 | ✅ 已修复 |
| #385 | 刷新页面丢失画布图片+面板破图 | CanvasContext添加image-stack类型的保存/恢复逻辑 | ✅ 已修复 |
| #386 | 图片上传后imageKey/dbId未设置 | React闭包陷阱：state.elements→stateRef.current.elements | ✅ 已修复 |
| #388 | 面板生成图片刷新后丢失 | 恢复 #364 原地进化逻辑，面板直接变图片 | ✅ 已修复 |
| #408 | 图片上传大小固定+最小缩放显示80px | FIXED_MAX_SIZE=1000px+MIN_ZOOM=0.08+废除screenRatio缩放 | ✅ 已修复 |
| #456 | COS上传串行阻塞优化 | Promise.all并行下载上传 | ✅ 已修复 |
| #457 | gpt-image-2/VIP删除AUTO比例 | 数据库aspectRatios移除auto | ✅ 已修复 |
| #458 | SSE/Base64分支并行化重构 | Promise.all并行+临时URL→COS签名URL | ✅ 已修复 |
| #459 | 占位符比例参数未传递 | createPlaceholdersWithClientIds添加ratio参数 | ✅ 已修复 |
| #460 | 面板图片黑边问题 | 移除5%阈值，始终调整面板尺寸 | ✅ 已修复 |
| #492 | 参考图隔夜消失（静默发送漏洞） | sourceIds与sourceImageEls一致性检查+阻断熔断 | ✅ 已修复 |
| #493 | SSE事件字段名不匹配导致imageKey丢失 | data.key→data.imageKey\|\|data.key兼容读取（8处） | ✅ 已修复 | **核心必读** |
| #494 | 模型比例选择错误：GPT默认auto/Banana发送1:1 | auto映射1:1+首次加载/切换模型正确选择比例+fallback列表移除auto | ✅ 已修复 |
| #500 | 积分返还监控日志 | credits.ts/route.ts 全链路监控日志 | ✅ 已添加 |
| #501 | 积分未返还+违规显示变失败 | refundCredits skipped时查DB返回最新余额+onError保留详细错误 | ✅ 已修复(部分) |
| #502 | 积分永远不返还(PostgREST on_conflict 400致命Bug) | 删除on_conflict改用先查后插+所有null路径查DB兜底+7项擦边测试全通过 | ✅ 已修复 |
| #504 | 违规禁用机制未生效 | incrementFailedAttempts添加禁用逻辑(30分钟)+checkCreditsSufficient检查禁用+弹窗改用ref触发(不用sessionStorage)+管理后台联动 | ✅ 已修复 |
| #505 | 违规禁用三大优化 | 零写入自动解封(只设locked_until不改is_active)+统一ban-check.ts+useViolationGuard Hook+前置熔断403 | ✅ 已修复 |
| #506 | LLM模型扣费修复 | 默认积分1→5+失败/异常时退还积分(refundCredits) | ✅ 已修复 |
| #507 | LLM文本生成三大修复 | 登录检查+SSE缓冲(防JSON解析失败)+错误不覆盖已有内容+生图进度badge | ✅ 已修复 |
| #508 | 六项修复：AUTO比例/提示词合并/违规弹窗/Logo/配置按钮/登录框样式 | auto不映射1:1+多文本面板提示词合并+后端warning事件+画布违规弹窗+Logo 54px+按钮14px+画布弹窗登录 | ✅ 已修复 |
| #509 | 四项修复：禁止base64/再次生成/生图违规弹窗/画布发送到对话 | 再次生成用imageKey换URL+生图页面useViolationGuard+画布传imageKey+后端base64告警 | ✅ 已修复 |
| #522 | T8Star GPT品质功能深度修复 | 品质弹窗描述对齐+关闭弹窗+3:1/1:3比例+quality参数传递+弹窗位置 | ✅ 已修复 |
| #523 | 面板图片刷新后完全丢失 | URL格式上传COS+imageKeys无效时保留imageUrls+恢复过滤无效key | ✅ 已修复 |
| #524 | 浏览器直连COS超时导致刷新后图片全部丢失 | 后端图片代理端点/api/canvas/image+恢复/愈合改用代理URL | ✅ 已修复 |
| #525 | 全量代理导致2C2G服务器带宽打满 | 服务商URL优先+代理URL兜底混合架构+IndexedDB缓存协同 | ✅ 已修复 |
| #526 | 面板生成图片后面板大于图片 | 所有比例模式（不仅auto）都根据实际图片尺寸微调面板 | ✅ 已修复 |
| #527 | 面板分辨率拉伸变化+比例变自动+长条溢出 | actualWidth/actualHeight始终记录+拉伸不改panelRatio+补齐originalWidth | ✅ 已修复 |
| #528 | 3:1/1:3比例生图实际为2:1+面板溢出误报 | quality强制high+清理诊断代码 | ✅ 已修复 |
| #529 | 1:3面板圆角溢出+SSE超时面板不显示 | borderRadius基于最短边+processImageItems新增providerUrls+onComplete降级链 | ✅ 已修复 |
| #530 | SSE活跃时GET超时结算误杀 | hasCompletedItems检测，活跃SSE不触发超时结算 | ✅ 已修复 |
| #531 | 面板尺寸超过图片（多头马车基准不一致） | 砍掉同步猜测调整，img.onload真实裁决，maxEdge锁定规模 | ✅ 已修复 |
| #537 | 接入T8 Veo3视频模型 | 异步轮询流程+首尾帧/元素参考分组+积分管理+前端适配 | ✅ 已完成 |
| #538 | Sora-2 GRS→T8迁移+角色客串 | 删除GRS代码+T8异步流程+character_url/timestamps+屏蔽hd/25s+使用提示 | ✅ 已完成 |
| #539 | 视频模型配置恢复（Veo/Sora被错改+Seedance durations修复） | Veo移除durations+Sora恢复5s/10s+Seedance 4-15秒每整数+画布4-15+resolutions格式统一 | ✅ 已修复 |
| #540 | 三端视频模型配置不一致+@角色客串功能缺失 | durations/比例/分辨率三端动态化+CharacterModal三端集成+仅Seedance支持@+后端characterId透传 | ✅ 已修复 |
| #542 | 视频页面时长不显示+发送无进度+任务无反馈 | Sora showDuration改true+VideoTask全生命周期+onVideoProgress进度更新+模型切换默认时长 | ✅ 已修复 |
| #543 | T8 Sora-2 API 400 upstream_error | 极简请求体(只发model/prompt/aspect_ratio/images)+保留upstream_message解析 | ✅ 已修复(回滚重写) |
| #545 | T8Star API域名迁移导致视频生成1001错误 | api_configs的api_endpoint从ai.t8star.cn改为ai.t8star.org(302重定向POST→GET) | ✅ 已修复 |
| #545 | T8Star域名迁移导致Sora/Veo全部报system error(1001) | ai.t8star.cn→ai.t8star.org+302重定向POST变GET+数据库api_configs更新 | ✅ 已修复 |
| #546 | T8Star视频通道不可用（服务商通道问题） | default分组Veo已恢复+Sora-2仍不可用 | ✅ Veo已恢复 |
| #547 | Veo系列多项修复 | enable_upsample去限制+高清模式开关+固定积分+角色库删除 | ✅ 已修复 |
| #548 | Sora-2时长选择+比例修正+@移除+固定计费 | 动态时长过滤+比例去掉1:1/auto+videoPricing.mode | ✅ 已修复 |
| #549 | 三端视频一致性+积分返还规则 | Sora-2时长过滤三端统一+积分动态计算+@提示隐藏+视频API积分返还全量补全 | ✅ 已修复 |
| #550 | 管理后台API密钥多密钥管理 | api_keys JSONB字段+添加/切换/备注/删除API+明文展示+密钥切换同步api_key | ✅ 已修复 |
| #551 | 细粒度熔断系统（密钥+分辨率级） | 微语法轮询+resolutionBans全局Map+429 RESOLUTION_BANNED+探针API+前端置灰联动 | ✅ 已完成 |
| #552 | SSE流中熔断错误未传递到前端(4轮修复) | 连续失败计数器+recordServiceProviderError+ImageGeneratorPanel获取bannedResolutions+生成页面置灰+分辨率格式统一(大写)+6小时熔断+阈值1(测试) | ✅ 已修复 |
| #553 | 全局一键解除熔断+失败阈值调整+熔断详情展示 | clearAllCircuitBreakers+getAllActiveBans+POST /api/system/circuit-breakers+管理后台急救按钮+熔断详情列表(接口/Key/分辨率/倒计时)+BAN_THRESHOLD改为5 | ✅ 已修复 |
| #554 | 批量测试Payload扣费事故 | testVariables畸形参数(prompt空+INVALID_RATIO)+_skipPixelMapping跳过像素映射+buildRequest测试模式+fallback同步更新 | ✅ 已修复 |
| #555 | 模型列表页面(/models)无数据 | 缺少/api/models路由导致返回HTML而非JSON | ✅ 已修复 |
| #556 | 画布熔断后仍可发送 | 发送按钮添加熔断检查+当前分辨率是否被禁用 | ✅ 已修复 |
| #557 | 模型列表视频扣费区分 | 视频模型积分显示改为720p/1080p分辨率区分 | ✅ 已修复 |
| #558 | 管理后台分辨率多选测试 | TestCenter添加分辨率多选功能+测试结果分分辨率显示 | ✅ 已完成 |
| #559 | 测试页面原因不显示+Veo/GPT误判 | 多分辨率结果添加展开详情+HTTP500含参数错误关键词判畅通 | ✅ 已修复 |
| #565 | 管理后台积分配置与模型列表多项修复 | 分辨率列删除+排序修复+Sora2固定计费+列位置调整 | ✅ 已修复 |
| #566 | 宫格切分内置+模型列表列对齐 | 图片工具栏宫格切分下拉+删除右侧弹窗和左侧按钮+视频/生图列对齐 | ✅ 已修复 |
| #633 | HappyHorse 1.0 视频模型集成（灵芽API） | t2v/i2v/r2v/video-edit四模式+ModelModeSwitcher组件+后端自动判断子模型+三端统一交互+异步轮询+对话框集成 | ✅ 已完成 |
| #634 | HappyHorse 进度条接入+模式推断修复+三端UI重设计 | hhCurrentMode useMemo补video-edit/r2v推断+chatVideoUrl状态+后端progress透传+localProgress局部状态防渲染风暴+ModelModeSwitcher三端variant重设计+SVG进度环 | ✅ 已完成 |
| #567 | 历史记录视频标注/预览+计费统一+弹窗修复 | video source字段+视频预览弹窗+下载按钮+模型弹窗440px+三端视频计费统一+宫格标签改免费 | ✅ 已修复 |

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
| #836 | MEGA AI Seedance 视频轮询三连暴击 | **status="succeeded"不认+result.url路径错误+相对路径未拼接→120轮超时→积分扣了没视频** | ✅ 已修复 |
| #839 | 裁剪后图片未持久化COS+参考图索引闭包陷阱 | **裁剪确认后base64未上传COS(刷新丢失)+chatImageBase64s.length闭包陷阱(并行上传索引冲突→部分URL空→参考图丢失)+handleSend逐项回退base64兜底** | ✅ 已修复 |
| #841 | 历史记录清空+日期筛选+画布+号长按BUG | **清空改造(保留最近N条/全清/日期范围清空)+日期范围日历筛选+画布+号onPointerUp/Cancel缺draftLineRef.current.active=false清除+clearInteractionCanvas+军师靶向拦截补#magnet-btn-multi-select** | ✅ 已修复 |
| #838 | 前端请求风暴根治 | **useEffect依赖地狱+fetchConfig去重+Navbar ref替代state+删除重复modelCreditsUpdated监听** | ✅ 已修复 || #837 | Supabase读风暴后端缓存 | **6个高频API路由零缓存+getSupabaseClient单例+5个缓存工具文件** | ✅ 已修复 |
| #641 | HappyHorse 素材限制+Sora-2 VIP 2合1 | **视频元素误计参考图+connectedImageUrls过滤视频+t2v上传按钮+对话框参考图限制+Sora-2 VIP前端2合1+统一入口sora-2-all-vip+时长选择器+动态积分** | ✅ 已修复 |
| #001 | 多任务占位符不更新 | **imageItems 初始化** | `route.ts:543` |
| #002 | 任务失败占位符不更新 | SSE failed 状态 | `route.ts` SSE循环 |
| #003 | 占位符超出画布边界 | 边界检查 | `page.tsx` createPlaceholders |
| #004 | 占位符样式问题 | 彩色渐变 | `page.tsx:8045` |
| #360 | 文本面板双击编辑 | isEditing状态+禁止拖动 | `GeneratePanelNode.tsx` |
| #361 | 文本面板流式生成显示 | isLlmGenerating+闪烁光标 | `GeneratePanelNode.tsx` |
| #362 | 滚轮缩放取消连线 | handleWheel检查连线状态 | `page.tsx` |
| #363 | 文本面板滚轮滚动文本 | onWheel stopPropagation | `GeneratePanelNode.tsx` |

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
│   ├── useGenService.ts              # 统一生成服务（740行，含占位符支持）
│   └── useViolationGuard.ts          # #505 违规弹窗状态管理 Hook
├── lib/
│   ├── canvas-image-layout.ts       # 图片布局工具（统一尺寸规则、网格布局）
│   ├── canvas-image-db.ts           # 画布图片 IndexedDB 存储
│   ├── cos.ts                       # 对象存储工具
│   ├── credits.ts                   # 积分工具
│   ├── ban-check.ts                 # #505 统一禁用检查函数
│   ├── model-registry.ts           # #554 模型静态配置注册表（含testPayload）
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
- 管理后台: `/admin-panel-placeholder`
- 管理员手机号: `{ADMIN_PHONE}`（请在环境变量中配置）

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
| #839 | 裁剪后图片未持久化COS+参考图索引闭包陷阱 | **裁剪确认后base64未上传COS(刷新丢失)+chatImageNextIdxRef原子索引+handleSend逐项回退base64** | `canvas/page.tsx` |
| #841 | 历史记录清空+日期筛选+画布+号长按BUG | **清空改造+日期筛选+draftLineRef.active未清除导致松手后仍拖拽** | `history/page.tsx` `clear/route.ts` `canvas/page.tsx` |
| #838 | 前端请求风暴根治 | **useEffect依赖地狱+fetchConfig去重+Navbar ref替代state+删除重复modelCreditsUpdated监听** | `AIGeneratorContext.tsx` `Navbar.tsx` `canvas/page.tsx` |
| #837 | Supabase读风暴后端缓存 | **6个高频API路由零缓存+getSupabaseClient单例+5个缓存工具文件** | `config-server-cache.ts` `config-cache.ts` 等 |
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
cd /var/www/kiikii-ai-web && ./deploy.sh
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
