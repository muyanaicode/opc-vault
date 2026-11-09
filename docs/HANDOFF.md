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
