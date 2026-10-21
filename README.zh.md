# dsh-privacy-shield 隐私护盾

面向 DeepSeek Harness（DSH）的本地优先隐私脱敏插件。

明文留在本机；送给模型的只有占位符；在展示层看到真实值。

**版本 1.0.0** · 零第三方运行时依赖 · 纯 ESM · Node.js 18+

---

## 功能定位

DSH 对同一段对话保留两份记录：

| 面 | 内容 | 读者 |
|---|---|---|
| **模型可见面** | 构造请求所用的消息（derive 时被补丁脱敏） | 模型（出境到云端） |
| **人类记录面** | 原始提交的会话事件 | 聊天 UI 与本地会话日志 |

`dsh-privacy-shield` **只改写模型可见面**：敏感文本被替换成确定性占位符 `<LABEL_8位hex>`，
本地日志、聊天界面、工具执行全部保留真值。模型回复时插件包装响应流，把占位符
还原成真值（含跨 chunk 被切开的占位符），因此 assistant 消息以真值落盘和展示。

```
你输入的：      请联系张三 13800138000，车牌京A12345。
模型看到的：    请联系 <PERSON_1a2b3c4d> <PHONE_9f8e7d6c>，车牌 <PLATE_0a1b2c3d>。
你在 UI 看到的：请联系张三 13800138000，车牌京A12345。
```

## 功能特性

- **只脱敏模型可见面**：对 `Session.deriveEventMessage` 打防御性补丁（system / developer / user / assistant / tool result 五类），人类记录面永不改写。
- **HMAC 占位符**（默认）：`<LABEL_8hex>` = HMAC-SHA256(label, value) 前 4 字节，密钥存本地文件，不可枚举反推；`placeholderHash: legacy` 兼容旧格式。
- **响应流还原**：包装 `llm/stream`，还原 `text-delta` / `reasoning-delta` / `tool-call-delta` / `block-end`，跨 chunk 缓冲。
- **三类检测**：通用 PII/凭据正则（28 类实体，含社保/公积金/学号/病历号/IMEI/MAC，银行卡过 Luhn）+ 中文实体规则（机构名、项目名、系统名、编号、地址、人名）+ 用户词表（字面 + `re:` 正则词条）。
- **智能词表**：`/shield scan-doc <路径>` 扫描本地文档（txt/md/csv/json/代码/docx）、`/shield learn` 从本地会话历史学习高频片段，候选必须人工确认（`terms adopt`）才入词表；`termsFile` 支持 fs.watch 热重载。
- **规则包导入导出**：`/shield export` / `/shield import` 把词表与实体开关打包搬到另一台机器（schema `dsh-shield.rules/v1`）；`--encrypt <口令>` 用 AES-256-GCM 加密规则包，`--pass <口令>` 导入。规则包绝不含还原表，导入校验直接拒绝 `vault/values/secrets` 类字段。
- **出境审计**：每次请求统计占位符数量与标签分布，并用同一套检测器复核出境文本、标记明文残留；JSONL 落盘默认开启，保留期自动清理，`/shield audit [天数]` 查询、`audit export` 导出 CSV。只记计数与标签，绝不含明文。
- **Web UI**：composer 停靠栏状态条 + 可展开面板（设置/词表/测试台/审计/候选五页签，含本地即时脱敏预览与候选确认）。设置页把 28 类实体按敏感度分组并支持搜索、显示"已启用 x/y"；词表页显示分类标签与按命中次数降序；测试台可开启"占位符 ↔ 真值"对照（默认关闭）；诊断徽标默认隐藏、需在设置页开启；界面 bundle 落后于 host 时状态条出现 `⟳ 版本` 徽标并提示重启 DSH。契约见 `docs/CLIENT-RPC-NOTES.md`。
- **运维命令**：`/shield pause <分钟>` 临时放行到期自动恢复；`/shield doctor` 逐项体检；`off`/`observe`/`import replace` 等敏感操作需 `confirm`。
- **内存还原表（vault）**：`placeholder → value` 不落盘、有 LRU 上限；真值可由本地日志重跑检测器重建。
- **`shield_scan` 工具**：模型可调用的扫描统计工具（只输出计数与标签）。
- **零运行时依赖**。`/shield on|off`、`/shield enforce|observe` 运行时开关。

> **明文提示**：本地日志保留真值是刻意设计——这是"展示真值"的前提。磁盘加密、备份管控、访问控制是您自己的责任，见 [docs/SECURITY.md](docs/SECURITY.md)。
> **图片提示**：本插件不做图片内容识别（OCR），含敏感信息的图片请自行处理；文本类文件块内容会脱敏，二进制与图片放行。

## 与其他脱敏插件的区别

DSH 上已有多个"送模型前脱敏"的插件，本插件的设计取舍：

- **只改写模型可见面**：本地会话日志、对话记录、工具执行全部保留真值——这正是"展示层还原"的前提。（把人类记录面也脱敏的插件，牺牲的是本机可读性。）
- **占位符由 HMAC 派生**：密钥在本地文件（`$DSH_HOME/shield/.placeholder.key`），占位符跨会话稳定，但只看脱敏文本的人无法枚举或反推。
- **规则包可跨机搬运**：词表与实体开关可导出/导入为 JSON，支持 AES-256-GCM 加密，且规则包绝不含还原表。
- **词表挖掘**：`scan-doc` 从本地文档提取专有名词候选、`learn` 从会话历史学习，候选必须人工确认才生效。
- **出境审计 + 明文复核**：每次请求复核出境文本是否残留明文；审计只有计数与标签，绝不落明文。

## 快速开始

1. **安装** bundle（指向本目录的绝对路径）：
   `plugin_manager action=install_bundle target=<dsh-privacy-shield 目录绝对路径>`
2. **重启 DSH profile**——安装、升级、卸载后都必须重启（原因见"已知限制"）。
3. **配置**：写进 profile 的 `cordis.patch.yml`（仓库里的 `cordis.patch.yml` 是可用示例，默认即为 `mode: enforce`）。
4. **验证**：
   - `/shield status`——模式、覆盖面、计数、derive 补丁状态；
   - `/shield verify 张三的手机号是13800138000`——试跑脱敏（只输出脱敏结果）。

## 规则包（导入 / 导出）

```
/shield export [路径] [--encrypt <口令>]   # 把当前词表 + 实体开关写成规则包（可选加密）
/shield import <路径> [--pass <口令>] [replace confirm]
                                          # 载入规则包（自动识别加密包；默认合并词表，replace 覆盖）
/shield rules                             # 当前规则摘要（只有计数）
```

- 规则包 schema：`dsh-shield.rules/v1`——`{ schema, exportedAt, plugin, entities, terms, notes }`。
- 规则包**只含词表与实体开关，绝不含还原表**；但词表本身就是敏感清单，请按同等密级保管。
- 也可以在 `cordis.patch.yml` 里配置 `rulesPack: "<路径>"` 启动时载入，或用 `termsFile` 指向按行词表。

## 配置摘要

完整参考见 [docs/CONFIG.md](docs/CONFIG.md)。

| 字段 | 默认值 | 作用 |
|---|---|---|
| `enabled` | `true` | 总开关；`false` 时不注册任何东西。 |
| `mode` | `enforce` | `enforce` 真正改写模型可见面；`observe` 只统计。 |
| `entities` | 26 类 | 启用的实体类型（见 CONFIG.md 实体表）。 |
| `placeholderHash` | `hmac` | 占位符哈希：`hmac`（HMAC-SHA256，密钥本地文件）/ `legacy`（FNV-1a，可枚举反推）。 |
| `minLevel` | `low` | 实体分级下限（high/medium/low），未显式配置 entities 时过滤默认集合。 |
| `addressLevel` | `full` | 中文地址粒度：`full` 到门牌 / `street` 只到街道。 |
| `terms` | `[]` | 内联词表（`词条`、`词条 @分类`、`re:正则 @分类`）。 |
| `termsFile` | `null` | 按行词表文件（相对路径落在 `$DSH_HOME/shield/`）；变化时热重载。 |
| `disabledLabels` | `[]` | 停用的词表标签（对应 `terms label off`）。 |
| `rulesPack` | `null` | 启动时载入的规则包文件。 |
| `surfaces` | 全 `true` | 分面开关：system / developer / user / assistant / tool。 |
| `mediaPolicy` | `pass` | 媒体块放行；文本类文件块内容仍脱敏，图片不做内容识别。 |
| `audit.jsonl` / `audit.jsonlPath` | `true` / 默认 | 审计 JSONL 落盘（只有计数）。 |
| `audit.retentionDays` | `30` | 审计保留天数，超限启动时清理。 |
| `audit.verifyOutbound` | `full` | 出境明文复核：`full`/`sample`/`off`。 |
| `audit.maxVerifyChars` | 2000000 | 超过该长度跳过复核。 |
| `onUnmaskable` | `warn` | `block` 时冻结请求检出明文直接抛错阻断。 |
| `registerProjections` | `true` | 核心脱敏开关（derive 补丁）；`false` = 只审计。 |
| `registerCommand` / `registerTools` | `true` | `/shield` 命令 / `shield_scan` 工具。 |
| `maxVaultEntries` | 5000 | 还原表上限（100–200000），超出逐出最旧。 |

**0.2.0 已移除 `sessionFilter`**：DSH 的脱敏挂点不区分会话，护盾只能全局生效；配置里出现 `sessionFilter` 会降级为提示。临时豁免请用 `/shield off`。

## 命令

```
/shield [status|on|off confirm|enforce|observe confirm|pause <分钟>|doctor
        |verify [文本]|terms [label off|on LABEL|adopt <序号…|all>]
        |scan-doc <路径>|learn|audit [天数]|audit export <路径>
        |vault|rules|export [路径] [--encrypt 口令]|import <路径> [--pass 口令] [replace confirm]|help]
```

所有状态输出只有计数与标签，绝不回显您的文本。`on`/`off`、`enforce`/`observe`、`pause` 仅本进程有效，重启即失效。

## 实体类型

28 类实体名，默认启用 26 类，`ipv4`/`ipv6` 需显式开启。完整表格与中文规则启发式见 [docs/CONFIG.md](docs/CONFIG.md)。检测是**规则 + 词表驱动，没有 NER 模型**：生僻名称可能漏检、技术文本可能误报——用 `terms`/`scan-doc`/`learn` 补全自己的机构名、项目名、系统名与编号。

## 已知限制

1. **安装/升级/卸载后必须重启 profile**：脱敏挂在 `Session.deriveEventMessage` 的防御性补丁上；卸载插件只是摘掉补丁、模型可见面恢复明文，会话与日志不受影响。（`termsFile` 词表文件变化无需重启，自动热重载；其他配置仍需重启。）
2. **无 OCR**：图片不做内容识别，含敏感信息的图片会原样出境——请自行避免发送或先脱敏。
3. **检测是启发式**：漏检的敏感值会以明文出境——关注出境审计的违规计数，并用 `terms`/`scan-doc`/`learn` 补词。
4. **`observe` 不改写任何东西**：明文照发，出境占位符计数为 0。
5. **标签变化会改变占位符**：配置变化使同一值落到不同标签下时，占位符随之变化。
6. **vault 逐出是静默的**：被逐出的映射在还原时保持占位符形态。
7. **运行时开关不持久**：重启后回到配置文件的状态。
8. **`mediaPolicy: 'strip'` 未实现**：配置能解析，但没有任何代码路径会剥离媒体块。
9. **热重载会覆盖进程内词表**：`termsFile` 变化按配置源重建词表，UI/命令新增的词条会被覆盖（日志有提示）。

## 开发与测试

```bash
node --test "test/*.test.mjs"     # 123 个单元测试（引擎/加密/审计/词表/运行时/RPC/UI 渲染/locale 同步）
node tools/build-dist.mjs         # 产出 release/ 目录 + .zip + .tgz
```

无需安装任何依赖。浏览器半边另有离线冒烟测试（React 桩 + loader 桩），说明见 `docs/CLIENT-RPC-NOTES.md`。

## 分发

`dsh-privacy-shield` 是 DSH bundle（`package.json` 声明了 `dsh.bundle.patch`），零第三方依赖、无构建步骤。
运行 `node tools/build-dist.mjs` 产出归档后，按场景任选一种方式给别人：

1. **本地文件夹（离线，最简单）**：发 `.zip`，对方解压后让 DSH 助手安装解压出的目录（绝对路径，
   指向包含 `package.json` 的那一层）：

   ```
   plugin_manager action=install_bundle target=<解压后的 dsh-privacy-shield 目录绝对路径>
   ```

2. **tarball URL**：发 `.tgz`（标准 npm tarball，根目录 `package/`，已验证可被 npm/pnpm 安装），
   或把它放到任意可直链下载的位置，然后用 URL 安装（插件页「安装」输入框，或让助手执行）：

   ```
   plugin_manager action=install_bundle target=https://example.com/dsh-privacy-shield-1.0.0.tgz
   ```

3. **Git 仓库**：把本目录推成仓库，用仓库地址安装：

   ```
   plugin_manager action=install_bundle target=https://github.com/<you>/dsh-privacy-shield.git
   ```

4. **npm 包（可选）**：`dsh-privacy-shield` 这个名字未被占用，需要时可直接
   `npm publish`；走 GitHub 安装（上面三种方式）不需要发 npm。

装完对方需重启 DSH profile 并刷新页面。配置不随包走——请发配置片段（`cordis.patch.yml` 的键），
不要发整个 profile。面向接收方的图文步骤见 `docs/DISTRIBUTE.md`（中英），
`tools/build-dist.mjs` 会把它一并放进发布工具包。

## 文档

- [docs/DESIGN-NOTES.md](docs/DESIGN-NOTES.md)——设计决策与 DSH 源码证据。
- [docs/CLIENT-RPC-NOTES.md](docs/CLIENT-RPC-NOTES.md)——浏览器半边 RPC 契约与已核实机制。
- [docs/CONFIG.md](docs/CONFIG.md)——配置全参考。
- [docs/SECURITY.md](docs/SECURITY.md)——威胁模型与边界。
- [docs/COMPLIANCE.md](docs/COMPLIANCE.md)——合规映射（非法律意见）。
- [docs/CHANGELOG.md](docs/CHANGELOG.md)——版本记录。

## 许可

MIT，见 [LICENSE](LICENSE)。
