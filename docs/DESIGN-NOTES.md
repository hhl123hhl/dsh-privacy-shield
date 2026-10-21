# dsh-privacy-shield 设计笔记（内部依据，随实现更新）

> 这份文件记录"为什么这样写"，以及支撑它的 DSH 源码证据。避免后续实现或压缩上下文后丢失判断依据。

## 1. 需求（来自用户）

1. 本地数据本地使用。
2. 送 DeepSeek 之前，对本地敏感数据（文件中的、对话中的、图片中的等）做匿名化/去标识化，用假信息替代。
3. DeepSeek 响应之后、展示给用户之前，在本地替换回真实敏感数据，让用户看到真实结果。
4. 尽量对齐民法典、网络安全法、个人信息保护法、数据安全法、GB/T 35273、GB/T 41391 等。
5. 整合成一个插件：功能全面、审计机制清晰，**公司名/项目名称/系统名称/各种编号/专有名词都要替换**。
6. 插件要能**导入导出**，别人的 DSH 也能用。
7. 流程要求：先规划 → 经确认 → 再开工。

## 2. 用户已确认的四项决策

| 决策 | 选择 |
|---|---|
| 明文策略 | **本地会话日志保留明文**，云端只发占位符（UI 直接看到真值） |
| 覆盖范围 | 文本全覆盖；**图片/文件块放行**（不剥离、不做 OCR） |
| 专有名词识别 | **词表驱动 + 中文规则兜底**，不引入 NER 模型 |
| 交付程度 | **完整交付**：内核 + Web UI + 导入导出 + 分发包 + 文档测试 |

## 3. 关键结论：现有插件没做到要求 3

`dsh-mask@0.2.20`（PerryLink，Apache-2.0）在 `agent/pre-step` 里把消息脱敏后再返回给循环，
**脱敏文本既落盘又送模型**，因此聊天界面显示的也是占位符；它的 ARCHITECTURE.md 明确写着：
在 UI 里自动还原真值的"浏览器半边" **does not ship**，只提供 `/mask restore <text>` 手动还原。
→ 用户的第 3 条要求（展示真值）目前无人满足，是本插件的核心价值点。

## 4. 技术基石：DSH 的"双面机制"

| 面 | 来源 | 用途 |
|---|---|---|
| 模型可见面 | `Session.deriveMessages()`（受 surface 替换 + **derive 补丁**影响，见 §4） | 送给模型 |
| 人类记录面 | append-origin（`surfaceOp === 'append'`）的原始事件 | 聊天 UI 与本地日志 |

证据（提取自 `app.asar`，已解到 `D:\Kimi\_dsh_src\`）：

- `dsh-agent-loop-index.js:1262` — `const boundaryMessages = session.deriveMessages();` ⇒ 请求 messages 就是派生结果。
- `dsh-session-index.js:189` — `isAppendSurfaceEvent()`，注释：模型可见 surface 会遮蔽替换区间，是"wrong source for a human transcript"，append-origin 才是人类记录来源。
- `apisession-index.js:1666` — 客户端分页只统计 `isAppendSurfaceEvent(event)`。
- `uichat-client.js:7633 / 9980 / 10059` — 客户端节点匹配要求 `event.surfaceOp === 'append'` ⇒ 替换副本不进 UI。

### 4b. 0.2.0 投影路线的死局（v0.2.1 的根因）

- `dsh-session`（0.2.0-rc.2，`planSurfaceEvent`）— 事件类型一旦注册 `registerMessageProjection`，`kind` 即被定为 `"project"`；
  `applySurfacePlan` 的 `project` 分支**只写 `projectedMessages`、不把事件加入 surface 节点** ⇒ `deriveMessages()` 遍历 surface 节点返回空数组
  ⇒ 发给模型的请求 `messages` 为空 ⇒ 400 `INVALID_REQUEST: at least one message is required`（用户截图实证，离线复现于 `_tmp/probe-e2e-offline.mjs`）。
- 全库唯一的消息投影是 `image/offload`（日志型事件），证明投影只给插件自有日志事件用，**不适合改写既有会话事件**。
- `dsh-agent-loop-index.js` 的 `llm/stream` 瀑布里 agent-loop 请求 `options` 深冻结、监听器换不了 options ⇒ 流包装路线也不可行。
- 结论：投影与流改参两条路都废，v0.2.0 起改走 **derive 补丁**（见 §5）。

### 4c. derive 补丁的宿主契约（v0.2.1 在用）

- `dsh-session-index.js:214` — `deriveEventMessage(event)` 是 `deriveMessages()` 逐事件的唯一出口，包它的原型即可改写模型可见面。
- `dsh-session-index.js:1452` — append 期间禁止重入 ⇒ **不能在 `session/event` 里追加替换副本**（此路已否决）。
- `Session.create(...)` 以 `new` 构造 ⇒ 必须在 `Session.prototype` 上打补丁，且要对**存量会话类**与新建会话分别覆盖（`sessionCtx.sessions?.store` 遍历 + `session/created` 事件）。
- 会话日志与 surface 节点均不被触碰 ⇒ 热卸载补丁只是恢复明文派生，无"投影被移除"故障。
- `llm/stream` 的 `options`（GenerateOptions）**deep-frozen**，只能读不能改；但返回流可以用自己的 chunk 包装（响应还原路线不受影响）。

## 5. 本插件架构（设计 J）

1. **本地全真值**：会话日志、聊天 UI、工具执行都不改写。
2. **模型可见面脱敏**：对 `Session.prototype.deriveEventMessage` 打**防御性补丁**（`lib/derive-patch.js`）：
   按消息身份（WeakMap 缓存 epoch+掩码结果）在派生阶段返回"脱敏副本"（保留 `id/role/source`，只改 `content`），
   surface 事件与本地日志均不动。补丁按会话类安装（存量会话 + `session/created` 新建会话），
   宿主结构不符时安静降级。
3. **响应还原**：`ctx.on('llm/stream', (options, next) => wrap(next()))` 包装响应流，
   把 `text-delta` / `reasoning-delta` / `tool-call-delta` / `block-end` 里的占位符还原成真值
   （带跨 chunk 缓冲，处理占位符被切开的场景），使 assistant 消息以真值落盘并展示。
4. **确定性占位符**：`<LABEL_8位hex>`，`hash8(label + '\0' + value)`。
   理由：derive 补丁的掩码结果按消息身份缓存，重派生（cold restore/fork）必须稳定一致；
   自增计数会漂移；哈希则跨轮次/fork/重启稳定，且不会搅乱提示词前缀缓存。
5. **还原表可重建**：真值就在本地日志里，重跑同一检测器即可重建 `placeholder → value`，
   因此不强制额外保存一份明文副本。
6. **出境审计**：`llm/stream` 处统计出境请求里的占位符数量与类型分布（只记计数，绝不含明文）。

## 6. 覆盖范围

- 通用 PII：手机、固话、邮箱、身份证、银行卡（Luhn 校验）、统一社会信用代码、案号、车牌、护照、微信/QQ、
  社保号、公积金号、学号、病历号、IMEI、MAC 地址、IPv4/IPv6（默认关）、API Key/私钥/JWT。
- 中文实体：机构名（后缀键控 + 前缀回溯 + 右向延展）、项目名/系统名（引导词/句式/书名号）、
  编号（引导词 + 前缀式编码）、地址（省市区街道门牌；`addressLevel: street` 只到街道）、人名（引导词 + 称谓）。
- 词表：内联 `terms`、外部 `termsFile`（支持 fs.watch 热重载）、`re:` 正则词条、`@company/@project/@system/@id`
  分类标签、`terms label off|on` 按标签停用、scan-doc/learn 候选确认流，最长优先。
- 文件块：文本类 attachment/content 脱敏（v0.3.0），二进制 data 与**图片放行（不做内容识别/OCR，
  本插件不负责图片内容的隐私保护——UI 与 status 均有明示）**。

## 7. 已知风险与运维约束

1. 安装/升级/卸载插件需重启 profile 才能加载新代码；derive 补丁本身可安全摘除（会话派生只是恢复明文，不会拒绝派生）。
2. 默认模式下本地日志保留明文（这是"看见真值"的前提）；受保护的是"不外发"。
3. 同一真值若被不同检测器命中（配置中途变化），占位符标签可能不同 → 文档说明。
4. 手搓请求（标题生成、压缩等）若对象被冻结无法改写，按 `warn`（默认）/`block`（严格）处理。
5. 图片不做 OCR（用户已确认放行）。

## 8. 开发环境注意

- `mode: observe` 是开发安全档：只统计与自检，不改写模型可见面。
- 安装（0.2.0 实证）：bundle 复制到 `<profile>/node_modules/dsh-privacy-shield/`，并在 profile 的
  `package.json` 里登记 `dependencies["dsh-privacy-shield"]` 与 `dsh.profile.bundles[]`；
  profile 启动时按 bundle 栈合并各包自带的 `cordis.patch.yml`（即 `dsh.bundle.patch`）。
  应用内 `plugin_manager action=install_bundle target=…` 是同一机制的封装。
- 已安装副本到 desktop profile（`C:\Users\Huohl\.dsh\profiles\desktop\`），
  其 `cordis.patch.yml` 为 `mode: enforce`（正式启用档）；改动代码或配置后需重启 profile。
  profile 原 `package.json` 备份为 `package.json.bak-before-dsh-privacy-shield`。
- 会话日志：`C:\Users\Huohl\.dsh\sessions\--D-Kimi--\<session-id>\session.v4.jsonl.zstd`（Node 25 可用 `zlib.zstdDecompressSync` 离线复算模型可见面）。
- 0.1.0 的 `sessionFilter.exclude`（排除开发会话）已随 `sessionFilter` 整体移除：derive 补丁对全 profile
  会话统一生效，调试期请用 `/shield off`。

## 9. v0.3.0 探查结论（M2–M6 记录）

### 9a. 出境口与旁路（M2）

- 宿主 llm 服务唯一出境口是 `stream(options)`（`llm-index.js` 的 `llm/stream` waterfall，约 :2371）：
  全部模型请求都经过本插件的监听器，出境审计无旁路。
- 手搓请求（未冻结的 options，如标题生成/压缩）在发前就地脱敏（`maskHandBuiltRequest`）；
  options 被冻结时无法改写，按 `onUnmaskable: warn`（默认）告警或 `block` 阻断。
- **queue 模式不可行**：冻结的 options 发出后队列代理改不了已入队请求，且请求由 `next()` 直接发出，
  不存在可插队的缝隙。不实现，仅记录。

### 9b. 响应还原的渲染层探查（M5，Tier 3 降级依据）

目标：在 assistant 消息正文里给"已还原片段"加可视化标记（如高亮/脚注）。
对 `app.asar` 内 dsh-web-frontend bundle 的槽位字符串枚举结论：

- 消息正文渲染**没有**可注册的 per-text-span 插槽；相关字符串只有 turn 级 slot：
  `conversation.chat.turnTail`（参数 `{turn, seq, openFile}`，renderSlot 于回合尾部）与
  `conversation.chat.assistant-actions`（参数 `{messageId}`）。
- 还原发生在 host 侧流包装层（文本已还原后落盘），client 侧拿不到"哪些片段被还原"的映射，
  turnTail 脚注无法与还原计数对齐到回合。
- **降级决定**：不做正文内联标记；还原可视化 = status 统计行"响应还原次数" + Web UI 设置页
  "已还原"计数。未来若 DSH 开放 message 级 slot 或暴露还原映射，可再评估 turnTail 脚注。

### 9c. 浏览器半边取数通道（M5 复用 0.2.0 结论）

- 普通 bundle 插件工厂只有 `require`，无 `host` 符号；取数三路：动态包 `host.call` →
  `ctx.connection.rpc.call('/shield', …)` → 同源 `fetch /shield/<method>`（webServer 直连路由）。
- RPC 方法表见 `lib/client-rpc.js` 的 `RPC_METHODS`（11 个）；分发表 `createRpcDispatcher`
  为纯函数，测试直接覆盖。

## 10. v0.3.0 新增模块

| 模块 | 职责 |
|---|---|
| `lib/crypto.js` | HMAC-SHA256 占位符、密钥文件管理、legacy FNV-1a 兼容 |
| `lib/audit.js` | 审计 JSONL 路径/保留期/读取/按天聚合/CSV |
| `lib/scan-doc.js` | 本地文档候选专名抽取（后缀词典 + 编号模式；docx 迷你解压；PDF 明确提示） |
| `lib/learn.js` | 本地会话日志高频未命中片段学习（zstd 帧解码） |
| `lib/pack-crypto.js` | 规则包 AES-256-GCM 加密（scrypt 派生，`DSH-SHIELD-ENC/v1`） |
| runtime | `setEntities/addTermLines/removeTermValues/pause/resume/isPaused`、候选池、`termsVersion` |
| client.js | dock 状态条 + 五页签面板（设置/词表/测试台/审计/候选） |
