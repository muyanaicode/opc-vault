# HANDOFF — OPC Vault（DSH 插件 + PWA）

- 目标：本地优先、端到端加密的企业资料与财税运营中枢（OPC Vault，原「企业资料管理器」）；公司主体⟷账套 **多对多**。bundle `@local/opc-vault`（entryId `include:opc-vault`，applied）。
- 形态：一份 `client.js` 核心 → DSH 插件（React 包装）+ PWA（`build.mjs` 生成 `app.js`，配 index.html/manifest/sw/server.mjs）。UI 已按 `frontend.md` 反 slop 红线重做（单字体/4 档字号/单主色/0.5px 分隔/去 emoji 图标/150ms 动效）；ego 实拍 1440+375，无 Console 错误、375 无横向溢出（截图 r2-*/d1-*）。
- 识别：`parseImport` 多级兜底——① 直接粘贴 JSON（喂本地 LLM 产出）② Excel/TSV 表格 ③ 「字段:值」分段 ④ 乱文按统一社会信用代码锚定拆多家（自测 2/3 家：名称/法人/电话/基本户 vs 一般户/地区均正确）。
- 营业执照识别：工具栏「营业执照识别」入口（概览快速开始也有），上传/拖入/粘贴执照图片（电子营业执照截图或实拍照片）→ Tesseract OCR(chi_sim+eng) →（在 DSH 面板里再经本地 LLM 结构化）→ 预览 → 建 1 主体 + 1 账套并把执照图存入「证照与印章·营业执照」。汉字间空格用 cjkSqueeze 压缩后标签才匹配；实拍 OCR 有字符误读属正常，可在主体里改。**不支持 PDF/OFD**，需先转图片。
- 本地 LLM 一键识别（DSH 原生）：Host `index.js` 注册认证路由 `POST /plugins/opc-vault/recognize`，内部用 `ctx.llm.stream` + `agentDefaultModel.currentSelection()` 把粘贴文本解析成中文键 JSON 返回；Client「AI 识别并创建（本地模型）」同源 fetch，任一步失败自动回退规则识别。模型提示固定「只输出 JSON 数组」。
- 验证：`node --check` index/client/app 全过；Host 路由已注册且鉴权生效（curl 未授权 401、未知路径 404 对照）；Client AI 路径在无 Host 的 PWA 下回退成功（ego，toast「规则 · 已创建 2 个…」、0 报错，截图 d3-ai-fallback.png）；营业执照识别端到端实测（截图 e4：上传→OCR→建主体，公司名/法人/注册资本/成立日期/公司类型/地址/经营范围/登记机关全对、0 报错）。**唯一未实测：已登录面板内的模型实调往返（ego 无 Harness 登录态），需用户点一次确认。**
- 下一步（用户主导）：Hard-refresh Harness（⌘⇧R）→ 打开 OPC Vault → 顶部「批量导入」→ 粘一段乱文 → 点「AI 识别并创建（本地模型）」；随后 GitHub 开源 + 上架 DSH 插件生态；云端 APP/小程序（libsodium/age+Argon2id 二开）为后续 TODO。
- 阻碍：Passkey 需以 `http://localhost` 或 HTTPS 打开 Harness（Chromium 拒绝 `127.0.0.1` IP 源做 WebAuthn）；已做可用性检测+置灰+提示，主密码不受影响。电子税务局子域可能随官方调整，字段可手动覆盖。

## 2026-11-08 · 第2轮（本轮）
- 收住范围：撤销未要求的 API Key/依赖功能页；仅保留「OPC 生态」引流入口（顶栏+概览行→弹窗三档），未改动核心金库逻辑。
- 核心闭环实跑：批量导入 2 家（字段:值）→ 2 主体 + 2 账套 + 2 关联，识别预览正确（截图 verify-r2-bulkimport.png）。注：ego 里 deleteDatabase 会污染该 origin 的 IndexedDB，换端口即可（5200 干净）。
- 发布：GitHub v0.1.0 Release + topics；docs/LAUNCH.md 出沐言 AI 发布文案（即刻/X、公众号、30s 口播）。
- 阻碍：boyue.ai 线上是另一套 SPA 构建（引用 /assets/app.js，/data.json 返回 HTML），与本仓 vibenavi（fetch data.json）不一致，发布链路未确认，暂不擅改线上；待用户给源码/部署入口。

## 2026-11-08 · 第3轮
- 新增零安装在线试用：GitHub Pages → https://muyanaicode.github.io/opc-vault/（.nojekyll，main / 根目录；README 加「在线试用」入口）。
- ego 实测线上：创建页正常、https 下 Passkey 可选、建库成功、顶栏「OPC 生态」按钮在（截图 verify-r3-pages.png）。
- 仍待：boyue.ai 导航收录（线上为另一套 SPA 构建，发布链路未确认）；需用户给源码/部署入口。

## 2026-11-08 · 第5轮
- 线上持久化验证（GitHub Pages demo）：刷新后进入「解锁 OPC Vault」，输入主密码解锁后数据仍在（公司主体 1 持久化）——证明本地加密 + 每次打开校验（截图 verify-r5-persist.png）。
- README / docs/LAUNCH.md 已并入「OPC 资源导航预览」链接（https://muyanaicode.github.io/vibenavi/，含 OPC Vault 条目）。
- boyue.ai 阻塞确认：muyanaicode 账号仅 5 个仓、无对应 SPA 源码（无 boyue.ai 引用），发布源不在本账号/本机；需用户提供源码仓或部署命令。

## 2026-11-08 · 第6轮
- 修 dogfood 发现的真 bug：新建「公司主体/账套」后顶部统计不即时刷新（原用局部 renderSubjects/renderAccounts）→ 改 renderApp()，现 0→主体1→账套1·关联1 即时更新（本地 5210 ego 验证，截图 verify-r6-header.png）。
- 已推送 main；GitHub Pages 演示会随构建更新。

## 2026-11-08 · 第7轮
- 导入格式实测（5213 干净环境）：无标签乱文 / TSV（Excel 粘贴）/ CSV 三种格式均正确识别 2 家（主体字段 4）。上一轮“TSV 失败”为测试串 \t 转义所致，非产品 bug，未改代码。
- 公开仓安全检查：tracked 文件无 .vault/.pem/.key/.env，无 gho_/PRIVATE KEY/AKIA/xox 等密钥特征；LICENSE=MIT；README 含「在线试用/开源与托管」。

## 2026-11-08 · 第8轮
- 推广物料：新增分享预览卡 assets/og.png（1200×630，沐言 AI 出品视觉）+ index.html og/twitter meta + README 首图；线上 /assets/og.png=200、index 含 og:image（X/即刻/群分享将显示专业卡片）。

## 2026-11-08 · 第9轮
- 安全/可靠性验证：导出加密备份（5214 实测）→ 702B、含 app/vault/meta.wrappedDEK，**无公司名明文（plaintextLeak=false）**。证明备份端到端加密、换设备需原主密码。
- 至此「做透」关键项已验：三格式导入、刷新重解锁+持久化、导出加密、公开仓无密钥、顶部统计即时刷新。

## 2026-11-08 · 第10轮（税务模块 · 对接本机 skill china-etax-wizard）
- 新增「税务」标签：按主体税务档案（省份/纳税人身份/征收方式/是否代扣个税/零申报/行业）自动生成报税日历（工资个税·增值税及附加·企业所得税季度预缴·财报·印花税/财产行为税·社保公积金·汇算清缴·工商年报），带倒计时/逾期/7天内状态与电子税务局、扣缴端入口。
- 提醒与清单：到期浏览器通知（逐主体≤15天/逾期）、复制本期清单；「办税向导」内嵌 china-etax-wizard 心智模型（三身份/两套系统/零申报/顺序/排障）。
- 整合点：复用 regionUrl 生成各省电子税务局入口；口径以官方「我的待办」为准，本工具仅提醒不代申报。
- 验证：ego 真机 5240，9 项任务日期正确（11/15 周日顺延 11/16），UI 与向导弹窗正常。
- 待办：真正实时需后台调度/推送；深度实操可把 china-etax-wizard 接成 MCP/CLI 供产品调用（登录/刷脸/提交仍本人）。

## 2026-11-09 · 第11轮（API 密钥模块 + 本地 Agent 桥）
- 新增「密钥」标签：大模型/网站服务/其他分类；名称·服务商·环境变量名·备注·Key；掩码显示、一键复制、编辑/删除、搜索、复制为 .env、导入 .env（浏览器本地解析、不联网）。
- 预留本地 Agent 接口：agent/vault-bridge.mjs 解密「导出」的加密备份；list 只列名称/环境变量（无明文），run --key 把指定 Key 注入子进程 env（不落日志/不进模型）；主密码走 OPC_VAULT_PASSWORD。
- 验证：ego 5241 新增测试 Key（sk-••••••1234）并导出；桥 list 正常、run 注入成功(len12/tail1234)、错误口令解密失败。
- 凭据红线：模型不读取/回显明文 Key；真值只在本地 UI 或本地桥进程内。

## 2026-11-09 · 第12轮（密钥全能力：MCP / 连通测试 / 到期提醒 / 授权子集）
- 密钥字段扩展：到期日（行内“剩N天/已过期”徽标 + 30天汇总 + 通知提醒）、标签、关联主体、授权 Agent（子集权限）。
- 新增「测试」按钮：浏览器 fetch 各服务 /v1/models（跨域受限时提示用本地桥）；本地桥 `test` 实测 OpenAI 返回 401（真实发出、不打印 Key）。
- 新增 agent/vault-mcp.mjs（MCP stdio）：vault_list_keys / vault_run_with_key / vault_test_key；返回元数据不含明文，未授权 Agent 被拒。
- 验证：bridge list --tag 生产=1；run --agent agentB 被拒(exit4)、agentA 注入成功(12/1234)；MCP tools/list、list_keys、run_with_key 正常。
- 安全：明文 Key 只在本地解密内存/子进程 env；主密码走 OPC_VAULT_PASSWORD，不进 argv/配置/日志。

## 2026-11-09 · 第13轮（钥匙串启动器 + 注册 DSH MCP）
- 主密码不落地：agent/install-keychain.sh 存入 macOS 钥匙串(service=opc-vault-mcp)；agent/vault-mcp-launch.sh 启动时从钥匙串读取并注入，绝不进配置/argv/日志。
- agent/setup.sh：把最近一次「导出」复制到 ~/.opc-vault/agent-vault.json 并存钥匙串，一键就绪。
- 注册：~/.dsh/cordis.patch.yml 追加 mcp-opc-vault（stdio，command=/bin/bash vault-mcp-launch.sh，env OPC_VAULT_FILE=~/.opc-vault/agent-vault.json）；已备份 .bak-opc-vault-<ts>，PyYAML+Ruby 双校验通过。
- 验证：用测试 service 走钥匙串启动器 → MCP initialize/list_keys 正常；测试钥匙串项已删除。
- 生效：需重启 DSH 才会加载 opc-vault MCP（当前会话未重启）。

## 2026-11-09 · 第14轮（按状态机审计修复 Top 隐患）
- 保存管线重写：dirty/saving/saved/failed 四态 + 串行化（saveChain）；lock()/卸载前 flush。修复“编辑后 600ms 内锁定丢数据”“header 恒显示已保存”。
- 启动读取失败进入 error 模式（不再误落 create 覆盖旧库），提供「重试 / 从备份文件恢复」。
- 导入原子化：meta+vault 单事务写入；导入前自动备份旧库（meta_backup/vault_backup + 下载 preimport 文件）。
- 税务任务新增持久状态：待办→已申报→已验证 / 撤销（taxFiled：主体|任务|截止）；提醒/清单只统计未申报。
- 模态框 AbortController：关闭即 abort；批量/执照/OCR/改密/密钥保存 await 后检查 signal，防关闭后越界写。
- Passkey 增加「移除」；PRF 失败时提示（浏览器无法删除已建凭证）。
- 验证：ego 5243 指示器 未保存…→已保存；编辑后立即锁定、解锁值保留（测试主体B）；税务已申报跨锁持久；5244 模拟 IDB 失败→error 页（重试/从备份恢复）。

## 2026-11-09 · 第15轮（审计剩余小项 + 上线）
- view 分发补 relations 显式分支；未知 view 归位 overview（不再静默落关系）。
- 解锁迁移(v1→v2)后立即 saveNow 持久。
- OCR 引擎加载失败清空 _tessP 可重试（不再永久失败）。
- 通知不可用/被拒/异常 → 页内提醒弹窗 showDueModal（税务/密钥共用）。
- 全量 renderApp 时清空 armedImage（防跨页残留粘贴目标）。
- SW 缓存 v4→v5。
- 验证：ego 5245 建主体→税务「开启到期提醒」在 Notification 失败时弹「报税到期提醒（页内）」；应用/密钥/税务正常。
- 上线：push origin main。

## 2026-11-09 · 第16轮（商业化 P0：法务 + 税务规则配置，上线）
- Beta 标；页脚「用户协议/隐私政策/免责声明」→ openLegal 弹窗；新增独立 legal.html（/legal.html）。
- 法务文案：用户协议（服务说明/数据本地/MIT/限制）；隐私（无服务器无遥测/本地加密/第三方说明/权利）；免责（非税务意见/密钥明文复制/电子章非法律效力/无担保）。
- 税务规则配置化：TAX_RULES（版本/申报日/年度期限/regionOverrides）替代硬编码；税务页展示规则版本 + 免责；可按年份/地区维护。
- SW v5→v6。
- 验证：ego 5246 Beta/页脚/协议弹窗/税务规则版本正常；legal.html 200。
- 上线：push origin main。

## 2026-11-10 · 第17轮（定价页 + Waitlist，上线）
- client.js 新增 PRICING/WAITLIST 配置（唯一事实源）与 openPricing/openWaitlist；页脚「定价与托管」入口。
- 三档：开源自托管(免费) / 托管 Managed(内测预约) / 团队企业(定制)；Waitlist 表单（邮箱必填+同意隐私）→ endpoint(POST) / contactEmail(mailto) / 缺省 GitHub Issue 回退 + 本地记录。
- 新增独立营销页 pricing.html（含同款预约表单）。
- 验证：ego 5247 定价弹窗三档、预约表单、无效邮箱提示、提交写入 localStorage(1 条)；pricing.html 200。
- 上线：push origin main。

## 2026-11-10 · 第18轮（对公账户一键复制发客户）
- 账套详情新增「复制对公账户（发客户）」：按 基本户/一般户 自动择优，生成【收款账户信息】(户名/开户行/账号/联行号) + 【开票信息】(公司名/统一社会信用代码/地址/电话/开户行及账号) 可直接发送文本。
- 弹窗可编辑后「复制 / 复制并关闭」；字段缺省自动跳过，无账户时提示。
- 验证：ego 5248 建主体+账套填银行/开票字段→文本含 6 项账户 + 5 项开票信息，内容正确。
- 上线：push origin main（SW v8）。

## 2026-11-10 · 第19轮（账套列表行内一键复制）
- 账套列表每行新增「复制」按钮（无需进详情）：直接复制该账套对公账户信息；剪贴板不可用时自动打开文本弹窗供手动复制。
- 验证：ego 5249/5250 行内复制按钮出现；headless 剪贴板失败→自动弹「对公账户信息·发给客户」且含收款/开票文本。
- 上线：push origin main（SW v9）。

## 2026-11-10 · 第20轮（DSH 插件更新机制排查）
- 现象：GitHub Pages 已更新，但 DSH 面板仍旧版。查明插件以 link 指向本仓库（client.js 即插件客户端），但本地 bundle 修改后不会自动重建。
- 处理：按 cordis-plugin-development，用 plugin_manager 先 remove_bundle @local/opc-vault 再 install_bundle 本目录（application=applied），版本 0.1.0→0.2.0；touch client.js 触发 client-hmr，cordis Slots 已显示 sidebar.panellist / main 均注册 opc-vault(active)。
- 后续：每次改 client.js 需重装 bundle（或让 agent 执行）；Web UI 仍旧时 ⌘R 重载页面即可，无需重启整个 App。Pages 线上不受影响。

## 2026-11-10 · 第21轮（对公账户归属修正：主体级）
- 数据模型：对公账户从「账套」移到「公司主体」（SUBJECT_GROUPS 新增 bank，ACCOUNT_GROUPS 移除 bank）；同一主体的多个账套共用一套基本户/一般户。
- 迁移：解锁时 migrateBankToSubjects 把旧账套里的基本户/一般户搬到关联主体（主体无值才写），并清理账套内银行字段；导入旧 JSON 同规则（doCreate → moveBankToSubject）。
- 复制：主体详情/列表新增「复制对公账户」；账套行复制改读关联主体；无账户时提示去主体填写。
- 验证：ego 5252 主体甲有基本户/一般户、主体乙空、复制甲含银行；5253 旧账套 bank 导入→迁到迁移甲，迁移乙为空。

## 2026-11-10 · 第22轮（修正：对公账户保持在账套；主体自动建账套）
- 按用户澄清：一人多公司 = 多主体、多账套；对公账户仍在「账套」内，一个账套一套基本户/一般户。
- 回滚上一轮 subject-level bank；新增 addSubject 自动创建同名账套（同名可改）；解锁 migrateBankToAccounts 为无账套主体补建账套，并把上一版误存到主体的银行字段迁回首个账套（兼容）。
- 导入 JSON 同时兼容「账套字段」和「主体字段」（moveBankToAccount）。
- 验证：ego 5254 新建主体自动出现账套、账套内有对公账户、行内复制可用；主体详情指向账套维护。

## 2026-11-10 · 第23轮（导入关联修复）
- 修复 coerceRecords：旧 JSON 导入时，主体匹配不到账套不再按下标硬抓一个账套（会把多个主体塞进同一账套）；仅当账套无 subjectIds 且数量与主体一致才按下标配对，否则按主体新建同名账套。
- 验证：ego 5257 两个主体→两个独立账套；主体旧存 bank 落到自己的账套，主体账户版保留原账套/银行。

## 2026-11-10 · 第24轮（解锁体验：主密码错误排查）
- 解锁页新增密码显示/隐藏、「从备份文件恢复」入口、明确提示：DSH 插件与网页 Demo 是两套独立本地库，主密码不通用。
- 验证：ego 5258 当前代码锁定/解锁正常；5259 解锁页提示与备份恢复按钮正常。
- SW v12→v13。

## 2026-11-10 · 第25轮（单一库架构：DSH 与网页共用）
- 根因：浏览器同源隔离，DSH 插件（dsh-app）与网页（github/localhost）各自一个 IndexedDB，造成“两套库、密码不通用”。
- 新增单库服务：server.mjs 增 /api/state，持久化 ~/.opc-vault/vault.json（仅密文 0600），固定 127.0.0.1:5240，LaunchAgent com.opcvault.vaultd 常驻。
- DSH host 新增 /plugins/opc-vault/state（读写同一文件）；client 存储适配：DSH 走 host 路由、5240 网页走 /api/state，其它来源回退 IndexedDB；DSH 首次打开会把现有 IndexedDB 密文自动搬到单库文件（无需密码），页面显示「共用库/本机库」。
- 验证：临时目录服务+网页创建库→vault.json 落盘；正式 5240 首页 200、state 404（空库）。

## 2026-11-12 · 第26轮（忘记主密码：备份+重建）
- 解锁页新增「忘记主密码 · 导出备份并重置」：先自动下载当前加密 .vault.json，再清空单库文件与本地 IndexedDB，回到创建页；设置 opcv_skip_migrate 防止旧库再次自动迁入。
- 归档：已将 DSH 旧 IndexedDB 与 vault.json 备份到 ~/.opc-vault/archive/（20261112-142937）。
- 验证：隔离远程库测试重置→API 变 {}、回到创建页；旧备份保留。

## 2026-11-12 · 第27轮（忘记密码 / Passkey）
- 当前单库 createdAt=2026-11-08 06:07（插件初装时库，非近期主库）；旧 IndexedDB 与 vault.json 已归档到 ~/.opc-vault/archive/。
- 解锁页新增「忘记主密码 · 导出备份并重置」；Passkey 指引改为必须用 Chrome/Edge 打开 http://localhost:5240（127/IP 与 DSH 内嵌窗口不支持 WebAuthn）。
- 验证：localhost:5262 isSecureContext=true、Passkey 按钮可用；重置隔离测试回到创建页。
