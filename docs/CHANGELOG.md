# CHANGELOG

## 1.0.0（2026-10-21）

- **正名发布**：插件更名为 `dsh-privacy-shield`（GitHub 仓库、npm 包名、client 模块 id、构建产物同步改名）。原因：npm 上的 `dsh-shield@1.0.0` 与 awesome-dsh-plugin 列表中的 `x2802490130-prog/dsh-shield` 是另一个插件（删除安全网），同名会让用户装错插件。
- **兼容性保留**：规则包 schema（`dsh-shield.rules/v1`）、加密包文件头（`DSH-SHIELD-ENC/v1`）、数据目录（`$DSH_HOME/shield/`）、cordis 插件 id（`shield`）与 `/shield` 命令全部不变——旧规则包与旧数据可直接继续使用。
- **package.json 可发布化**：去掉 `private: true`，补 `repository` / `homepage` / `bugs` / `keywords` / `files` / `engines`。
- **文档纠偏**：README 两处"默认 observe"更正为"默认 enforce"（与 `lib/constants.js` 的 `DEFAULTS.MODE` 及随包 `cordis.patch.yml` 一致）；新增"与其他脱敏插件的区别"一节；新增从插件市场安装（`dsh plugin add github:...`）。
- **构建产物**：输出目录 `dist/` 更名 `release/`（发布物与源码同仓）。
- **注意**：浏览器侧 localStorage 偏好前缀随改名更换，升级后诊断徽标、真值对照等界面偏好需重新设置一次。
- 功能与 0.3.3 完全等价；测试 123/123 全绿。

## 0.3.3（2026-10-19）

- **文案单一来源**：新增 `locale/zh.json` / `locale/en.json`（文案、28 类实体名、敏感度、覆盖面、词表分类、候选来源）+ `tools/sync-client.mjs`，client.js 的 `@@GENERATED:SHIELD-UI@@` 标记区块由生成器产出；`lib/constants.js` 的中文名表改为读 `locale/zh.json`，host 与 client 同源；新增 `test/locale-sync.test.mjs` 防漂移（含中英 key 对齐、实体覆盖断言）。
- **设置页体验**：28 类实体从平铺改为按敏感度分组（高/中/低）+ 中文名搜索框 + "已启用 x/y" 计数；页签改为等宽分段控件（窄屏不换行），并补 `role="tablist"`/`aria-label`。
- **词表页**：显示分类 chips（公司/机构、项目…并与 host 同源命中文案）+ 按命中次数降序排序（引擎新增 `termHits` 进程内统计，`termsList` 返回 `categories`/`hits`）。
- **测试台真值对照**：新增"显示真值对照"开关（默认关闭，偏好存 localStorage）；`testMask` 只在 `reveal: true` 时返回 `pairs`（≤100 条，本机不回传真值默认路径）。
- **诊断徽标默认隐藏**：状态条右侧 `⇄通道` 徽标改为设置页开关控制（localStorage 偏好），普通用户不再看到排障噪音。
- **主题令牌彻底化**：状态点/模式色、审计柱状条、focus-visible 描边改用语义强调色 `--dsw-alias-brand-primary-new-colorprimary-new-color`（浅色 #4176e6 / 深色 #5686fe），不再依赖深色主题下近似白色的 `--dsw-alias-brand-primary`。
- **升级提示**：host `status.version` 改从 `package.json` 读取（新增 `HOST_VERSION`），与 client 编译期 `CLIENT_VERSION` 比对；不一致时状态条显示 `⟳ host` 徽标、设置页提示"请重启 DSH 后刷新页面"。
- **候选来源中文化**：候选页 `source` 经 `candidateSources` 映射（后缀词典/编号模式/会话学习），英文界面同步英译。
- 测试 123/123 全绿（新增 locale-sync 3 例、client-rpc 3 例、ui-render 5 例）。

## 0.3.2（2026-10-19）

- **修复：深色主题下选中页签/主按钮"白底白字"**。根因实锤：深色主题把 `--dsw-alias-brand-primary` 指向近白色（`var(--dsw-static-neutral-bluish-50)`；浅色主题才是近黑 `--dsw-static-neutral-bluish-1000`），而选中态文字写死 `#fff`。现文字改用与背景成对的反色令牌 `var(--dsw-alias-label-primary-inverted, #fff)`；选中页签另加 `fontWeight: 600`、`role="tab"`/`aria-selected`；复选框强调色改用 `--dsw-alias-brand-primary-new-colorprimary-new-color`。
- **实体识别类型中文化**：设置页 28 类实体显示中文名（手机号/身份证号/统一社会信用代码…），悬停 title 显示"中文名（协议 id）· 中文敏感度"；模式值（改写（enforce）/仅统计（observe））、占位符哈希（HMAC（不可反推））、覆盖面（系统、用户、助手）同步中文化；测试台命中摘要与候选页把 `PHONE` 等占位符标签还原为中文实体名；`/shield status` 的实体/覆盖面/分级列表也改为中文（新增 `ENTITY_NAMES_ZH` 等常量）。
- **语言表修复**：`copyOf()` 以前只认中文，`en` 表永远取不到；现按 `<html lang>` → 浏览器语言返回 zh/en（默认中文），并补 `uiLang()` / `displayName()` / `entityName()` 等取词 helper。
- 新增 `test/ui-render.test.mjs`（React 桩离线渲染状态条与面板）：断言中文实体名、选中页签反色令牌、英文界面切换，防止"白底白字"回归。
- 测试 112/112 全绿。

## 0.3.1（2026-10-14）

- **Web UI 实机打通（端到端验证通过）**：修复浏览器半边与宿主之间的整条 RPC 链路，四层根因全部实锤修复：
  1. `package.json` 补 `dsh.client` 声明（`platform: "web"` 等）——缺失时宿主 `dsh-client-modules` 直接跳过浏览器半边（状态条从未加载的根因）。
  2. `apply(ctx)` 全部服务探测改防御式 try/catch——cordis 未知服务访问抛错曾导致 "web boot: entry did not activate" 拒绝启动。
  3. 讲官方 `client-request/server-response` 信封协议（`dsh-client-connection`）。
  4. **路由改挂官方 `/api` 共享通道**：`/shield` 根路径被 client-modules 的 `/plugins` 资源路由整体遮蔽（任何方法都回 400）；现注册 `connection.fetch.register({path:'/api/shield'})` 精确路由，客户端统一 POST 相对路径 `api/shield`（经 `dsh-app://` 转发器自动带鉴权 cookie）。
- **可观测性**：状态条右侧诊断徽标（`⇄<通道>+a/-a`）；新方法 `clientLog` 把浏览器侧日志落到 `$DSH_HOME/shield/debug-client.jsonl`（限长 1MB）；渲染错误由 `Guard` 错误边界兜住；host 连不上时 ▸ 面板显示具体原因而非无反应。
- 实机验证：26 类实体、审计落盘开启、状态条实时数据、五页签面板可展开、诊断日志确认 `status ok`。
- 契约文档 `docs/CLIENT-RPC-NOTES.md` 重写为最终架构（含全部证据与踩坑记录）。
- 测试 110/110 全绿；e2e 离线探针通过。

## 0.3.0（2026-10-13）

- **HMAC 占位符**：`placeholderHash: hmac`（默认）用 HMAC-SHA256 生成占位符，密钥存 `$DSH_HOME/shield/.placeholder.key`（32 字节 hex，600 权限尽力而为）；取不到密钥时降级内存密钥并在 status/doctor 告警。`legacy`（FNV-1a）保留兼容，doctor 会提示"可枚举反推，慎用"。同一真值在 hmac 模式下同时登记 legacy 占位符别名，旧会话缓存可还原。
- **词表增强**：`re:` 前缀支持正则词条（上限 500 条，`MAX_REGEX_TERMS`）；`terms label off|on LABEL` 按标签批量停用/恢复（`disabledLabels` 配置持久化）；scan-doc/learn 候选确认流（`setCandidates`/`adoptCandidates`，30 分钟 TTL）。
- **新实体 6 类**：社保号、公积金号、学号、病历号、IMEI、MAC 地址；实体分级（high/medium/low）与 `minLevel` 过滤；`addressLevel: street` 只脱敏到街道。
- **银行卡 Luhn 校验**、文件块（file）文本内容脱敏（文本类 attachment/content，二进制与图片放行，含 SVG）。
- **出境审计**：`audit.jsonl` 默认开启；`/shield audit [天数]` 与 `audit export <路径>`（CSV）；保留期清理（`audit.retentionDays`，默认 30 天）。敏感操作需 `confirm`（off/observe/import replace）。
- **智能词表**：`/shield scan-doc <路径>`（txt/md/csv/json/代码 + docx 迷你解压解析；PDF 给出明确提示）与 `/shield learn`（扫描本地会话日志的高频未命中片段，zstd 解码）；候选必须人工确认（`terms adopt <序号…|all>`）才入词表。
- **Web UI**：composer dock 状态条 + 可展开面板（设置/词表/测试台/审计/候选五页签）；host 侧 RPC 新增 `setEntities/termsList/termsAdd/termsRemove/testMask/scanDoc/learn/adopt/auditSummary`（`createRpcDispatcher` 纯函数可单测）。**图片内容不做隐私保护**（UI 与 status 均有明示）。
- **规则包加密**：`export [路径] --encrypt <口令>`（AES-256-GCM + scrypt，文件头 `DSH-SHIELD-ENC/v1`）；`import <路径> --pass <口令>` 自动识别，口令错误统一报"口令错误或文件损坏"；解密后仍走 vault 字段拒绝校验。
- **运维命令**：`/shield pause <分钟>`（临时明文放行，内存计时器到期自动恢复，审计标注 `paused`，status 显示剩余分钟）；`/shield doctor` 逐项体检（补丁/开关/模式/哈希/词表/审计/残留/错误，✅/⚠️）。
- **热重载**：`termsFile` 变化 fs.watch 防抖 300ms 后按配置源重建词表（日志明示会覆盖进程内新增）；配置（cordis.patch.yml）热更新不支持，仍需重启 profile。
- **渲染层探查结论**：assistant 消息正文无可注册插槽（bundle 里只有 `conversation.chat.turnTail`/`assistant-actions` 等 turn 级 slot，无 per-text-span hook），"还原可视化标记"降级为 status/settings 页的还原计数展示（记入 DESIGN-NOTES §9）。
- **测试**：全套 110 例全绿（新增 crypto/audit/scan-learn/client-rpc/m6-features/v3-features）；真实宿主 Session 集成探针 `_tmp/probe-e2e-offline.mjs` 通过（模型可见面无明文泄漏、本地事件未动）。
- 版本 0.3.0；文档同步（README×2、CONFIG、SECURITY、COMPLIANCE、DESIGN-NOTES）。

## 0.2.1（2026-10-13）

- **架构修复（重要）**：弃用 `registerMessageProjection`，改用 `Session.prototype.deriveEventMessage` 防御性补丁实现"模型可见面脱敏"。根因：DSH 0.2.0-rc.2 的会话折叠里，事件类型一旦注册投影就走 `kind:"project"` 分支——该分支只写 `projectedMessages`、不把事件加入 surface 节点（`applySurfacePlan`），`deriveMessages()` 因此返回空数组，发给模型的请求 `messages` 为空（400 `INVALID_REQUEST: at least one message is required`）。已用宿主真实 `dsh-session` 模块离线复现并验证修复（节点保留、内容脱敏、本地日志不动）。
- **derive 补丁语义**：按消息身份（WeakMap）缓存派生结果，避免每次请求全量重算刷爆统计与还原表；`replaceTerms`/`applyRules` 重建引擎时 `maskEpoch+1` 使缓存失效；observe 模式下掩码照跑（统计有信号）但返回原文；宿主结构不符时安静降级为"不脱敏"。
- **状态输出**：`已挂载投影：…` 改为 `模型可见面脱敏（derive 补丁）：已装/未装`；快照字段 `registeredProjections` 更名 `derivePatchInstalled`。
- **测试**：`test/runtime.test.mjs` 投影门控用例改写为 derive 补丁用例（缓存/代际失效/幂等重装/异常降级/surface 门控），全套 61 例全绿；真实宿主 Session 集成验证通过。
- 热关插件不再触发"projection was removed"会话故障（补丁摘除即恢复明文，会话与日志不受影响）。

## 0.2.0（2026-10-13）

- **规则包导入导出**：`/shield export [路径]` 与 `/shield import <路径> [replace]`；规则包 schema `dsh-shield.rules/v1`（词表 + 实体开关，绝不含还原表）；启动时可用 `rulesPack` 配置直接载入；导入校验拒绝 `vault/values/secrets/plaintext/restore` 字段。
- **词表文件**：`termsFile` 配置（相对路径落在 `$DSH_HOME/shield/`），`parseTermsFileText` / `mergeTermLines` 支持注释、行尾分类与归一化去重。
- **出境审计 JSONL 落盘**：`audit.jsonl` / `audit.jsonlPath` 配置生效，每行一条审计记录（只有计数与标签）。
- **浏览器半边**：`client.js` 状态条注入 `conversation.composer.dock`（模式指示、指标、enforce/observe 切换），三条取数通道（动态包 `host` 符号 → `props.connection.rpc` → 同源 fetch），全部不可用时优雅降级；宿主侧 `lib/client-rpc.js` 提供 `connection.rpc.handle('/shield', …)` 通道与同路径 webServer 直连路由双通道。
- **`shield_scan` 工具**：`registerTools` 配置生效，注册模型可调用的扫描工具。
- **配置收敛**：`sessionFilter` 被移除（DSH 投影 API 不区分会话，源码证据 `dsh-session-index.js:426-436`），配置中出现时降级为提示；`mediaPolicy` 仅保留 `pass`。
- **测试**：新增 `test/rules.test.mjs`（规则包/词表 IO）与 `test/runtime.test.mjs`（运行时/审计/投影门控），全套 `node --test` 57 例全绿；`client.js` 离线冒烟（`_tmp/ui-smoke.mjs` 同款桩法）全绿。
- **文档与打包**：补齐 `LICENSE`（MIT，与 package.json 一致）、`docs/SECURITY.md`、`docs/CLIENT-RPC-NOTES.md`；`icon.svg`；`tools/build-dist.mjs` 产出可分发目录 + `.zip` + `.tgz`。
- 版本号与文档对齐：README 中英文重写至实际状态。

## 0.1.0（2026-10-13）

- 初始版本：检测引擎（通用 PII + 中文实体 + 词表）、5 类消息投影、响应流占位符还原（跨 chunk 缓冲）、确定性占位符、内存 vault、`/shield` 命令（status/on/off/enforce/observe/verify/terms/vault/help）、出境计数审计。
- 已知不一致（0.2.0 已全部解决）：`package.json` license 声明与 LICENSE 文件不符；README 描述滞后于实现；`client.js`/`locale`/`icon.svg` 在 exports 中声明但缺失。
