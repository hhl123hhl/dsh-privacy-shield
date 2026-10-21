# Configuration, Commands, and Rules Reference / 配置、命令与规则参考

Bilingual reference for `dsh-privacy-shield` 0.2.0.

`dsh-privacy-shield` 0.2.0 的中英对照参考。

**Ground rule / 铁律：** every field name, default, and accepted value below is taken verbatim
from `lib/config.js` and `lib/constants.js`. Where a documented field has **no effect**, that is
stated explicitly rather than omitted.

**铁律：** 下列每个字段名、默认值与可选取值都逐字取自 `lib/config.js` 与 `lib/constants.js`。
凡**无实际效果**的字段，均显式标注，而不是略去。

---

## Contents / 目录

1. [Where configuration lives / 配置写在哪](#1-where-configuration-lives--配置写在哪)
2. [Field reference / 字段参考](#2-field-reference--字段参考)
3. [Term list reference / 词表参考](#3-term-list-reference--词表参考)
4. [Session filter / 会话过滤](#4-session-filter--会话过滤)
5. [Placeholder and label reference / 占位符与标签参考](#5-placeholder-and-label-reference--占位符与标签参考)
6. [Commands / 命令](#6-commands--命令)
7. [Not implemented / 未实现的特性](#7-not-implemented--未实现的特性)
8. [Complete worked example / 完整示例](#8-complete-worked-example--完整示例)

---

## 1. Where configuration lives / 配置写在哪

Configuration is the `config` block of the `shield` row in your profile's `cordis.patch.yml`.
The plugin reads it at mount time; changing it requires restarting the DSH profile.

配置写在 profile 的 `cordis.patch.yml` 里 `shield` 行的 `config` 块。插件在挂载时读取；改动后
需要重启 DSH profile。

```yaml
- insert:
    - id: shield
      name: dsh-privacy-shield
      config:
        enabled: true
        mode: enforce
        # ... see below / 见下文
```

Two behaviours of the normalizer are worth knowing / 归一化器有两点行为值得了解：

- **Invalid values degrade rather than throw.** 非法值会降级，不会抛错。
  `mode` falls back to `'observe'` unless the value is exactly `'enforce'`; `mediaPolicy` falls
  back to `'pass'` unless exactly `'strip'`; `onUnmaskable` falls back to `'warn'` unless exactly
  `'block'`; booleans are coerced with `'true'`/`'false'` strings honoured; numbers
  are truncated and clamped.
- **Unknown entity names are silently dropped.** 未知实体名被静默丢弃。
  `entities` is filtered against the 22 known names. If the filtered list is empty, the 20
  defaults are restored.

---

## 2. Field reference / 字段参考

### `enabled`

| | |
|---|---|
| Type / 类型 | boolean |
| Default / 默认 | `true` |
| Effect / 作用 | Master switch. `false` makes `apply()` return immediately: **no derive patch, no `llm/stream` listener, no command, no tools, no logging.** |

总开关。为 `false` 时 `apply()` 立即返回：**不打 derive 补丁、不挂 `llm/stream`、不注册命令与工具、
不打印日志。**

### `mode`

| | |
|---|---|
| Type / 类型 | `'enforce'` \| `'observe'` |
| Default / 默认 | `'observe'` |
| Effect / 作用 | `'enforce'` rewrites the model-visible surface. `'observe'` computes detections but leaves derived messages untouched, so **nothing is rewritten**. |

`'enforce'` 改写模型可见面；`'observe'` 仍会计算检测，但派生消息保持原样，因此**不改写任何东西**。

> Any value other than the exact string `'enforce'` resolves to `'observe'`.
> 除精确字符串 `'enforce'` 外的任何取值都会归为 `'observe'`。

**Important / 重要：** observe mode is not "dry-run masking of the outbound request". The
outbound request is untouched and leaves with plaintext. See `/shield verify` behaviour in §6.

observe 模式不是"对出境请求做空跑脱敏"。出境请求原样发出，带明文。见 §6 的 `/shield verify`。

### `entities`

| | |
|---|---|
| Type / 类型 | string[] |
| Default / 默认 | the 26 names in `DEFAULT_ENTITIES` (filtered by `minLevel`) |
| Effect / 作用 | Selects which detectors run. Names not in `ENTITY_LABELS` are dropped. An empty result falls back to the defaults. |

选择运行哪些检测器。不在 `ENTITY_LABELS` 里的名称被丢弃。结果为空时回退到默认集合。

Accepted names (28) / 可接受名称（28 个）:

```
phone-cn  landline-cn  email  id-card-cn  bank-card  uscc  case-no
plate-cn  passport-cn  wechat  qq  api-key  jwt
social-insurance  housing-fund  student-id  medical-record  imei  mac-address
cn-org  cn-project  cn-system  cn-id  cn-address  cn-person  term
ipv4  ipv6
```

Enabled by default (26) / 默认启用（26 个）: all of the above **except `ipv4` and `ipv6`**.

Opt-in only / 仅 opt-in: **`ipv4`, `ipv6`.**

Sensitivity tiers / 敏感度分级（`ENTITY_SENSITIVITY`）: high = id-card-cn, bank-card, uscc,
passport-cn, social-insurance, housing-fund, medical-record, api-key, jwt; medium = phone-cn,
landline-cn, email, case-no, plate-cn, wechat, qq, student-id, imei, mac-address; low = the rest.
Used by `minLevel` when `entities` is not set explicitly.
高 = 身份证、银行卡、统一社会信用代码、护照、社保号、公积金号、病历号、API Key、JWT；
中 = 手机、固话、邮箱、案号、车牌、微信、QQ、学号、IMEI、MAC；低 = 其余。仅在未显式配置
`entities` 时由 `minLevel` 过滤默认集合。

```yaml
entities:
  - phone-cn
  - email
  - cn-org
  - term
  # ipv4 and ipv6 omitted: they are off by default
```

> **Specifying `entities` replaces the default set.** It does not merge with it. If you list only
> three names, only three detectors run.
>
> **指定 `entities` 是整体替换默认集合**，不是合并。只列三个名称，就只有三个检测器运行。

### `placeholderHash`

| | |
|---|---|
| Type / 类型 | `'hmac'` \| `'legacy'` |
| Default / 默认 | `'hmac'` |
| Effect / 作用 | How the 8-hex placeholder suffix is computed. |

占位符 8 位十六进制后缀的生成方式（见 §5 Hash）。

- `hmac`（默认）：HMAC-SHA256(label, value) 取前 4 字节。密钥读 `$DSH_HOME/shield/.placeholder.key`
  （32 字节 hex；不存在则生成并尽力设 600 权限）；读不到文件时降级为进程内存密钥，并在
  status/doctor 给出警告——**进程重启后同一真值的占位符会变化**。
- `legacy`：FNV-1a 32 位（v0.2.x 格式）。无密钥也可算，因此**可被枚举反推**，仅建议过渡期使用。

hmac 模式下 vault 会同时登记 legacy 占位符别名，旧缓存的占位符仍能还原。

### `minLevel`

| | |
|---|---|
| Type / 类型 | `'high'` \| `'medium'` \| `'low'` |
| Default / 默认 | `'low'`（全部级别） |
| Effect / 作用 | Sensitivity floor for the **default** entity set. |

实体敏感度下限。**仅在未显式配置 `entities` 时**过滤默认集合（显式配置 `entities` 则完全以
配置为准）。例如 `minLevel: medium` 会把护照/社保号等 high 级与手机/邮箱等 medium 级留在默认
集合，去掉 cn-org/cn-project 等 low 级实体。

### `addressLevel`

| | |
|---|---|
| Type / 类型 | `'full'` \| `'street'` |
| Default / 默认 | `'full'` |
| Effect / 作用 | Chinese address masking granularity. |

中文地址（`cn-address`）脱敏粒度。`full` = 脱敏到门牌号；`street` = 只脱敏到街道（保留省市区），
用于"只需要模糊化"的场景。

### `terms`

| | |
|---|---|
| Type / 类型 | string[] |
| Default / 默认 | `[]` |
| Effect / 作用 | Inline term list. Each array element is one entry. Only effective when `term` is in `entities`. |

内联词表。每个数组元素是一条词目。仅在 `entities` 含 `term` 时生效。

A single string is also accepted and treated as a one-element list. Empty strings are dropped.

也接受单个字符串，视为只含一个元素的列表。空字符串被丢弃。

Entries may be literal (`词 @分类`) or regex (`re:正则 @分类`, up to `MAX_REGEX_TERMS = 500`).
Format / 格式: see [§3](#3-term-list-reference--词表参考).

### `termsFile`

| | |
|---|---|
| Type / 类型 | string \| null |
| Default / 默认 | `null` |
| Effect / 作用 | Line-based term list file loaded at startup and merged into `terms`. |

启动时载入并按行书写的词表文件，与内联 `terms` 合并（归一化去重，新增条目数记入启动日志）。

Relative paths resolve under `$DSH_HOME/shield/` (see `lib/rules.js: resolveRulesPath`).
The file uses the same line format as `terms` (see [§3](#3-term-list-reference--词表参考)):
`#`/`//` comments, blank lines, and `@category` tags are all accepted. Unparseable or
over-length lines are counted as skipped and logged — a bad file degrades to a warning and
never blocks profile startup.

相对路径落在 `$DSH_HOME/shield/` 下（见 `lib/rules.js: resolveRulesPath`）。文件使用与 `terms`
相同的行格式（见 §3）：支持 `#`/`//` 注释、空行与 `@分类` 标签。无法解析或超长行计入 skipped 并
记入日志——文件有问题只会降级为警告，绝不会让 profile 起不来。

Load order at startup / 启动载入顺序: `rulesPack` first, then `termsFile`, then inline `terms`
(last wins on duplicates by first occurrence / 去重时先到先得).

The file is watched (`fs.watch`, 300 ms debounce): edits rebuild the vocabulary from all config
sources. In-process additions (UI / `terms adopt`) are overwritten — the reload log line says so.

文件被 fs.watch 监听（300ms 防抖）：编辑后按全部配置源重建词表，进程内新增（UI / `terms adopt`）
会被覆盖，重载日志里有明示。

### `disabledLabels`

| | |
|---|---|
| Type / 类型 | string[] |
| Default / 默认 | `[]` |
| Effect / 作用 | Term labels whose entries are compiled out. |

按标签停用的词表条目（对应运行时命令 `/shield terms label off <LABEL>`）。停用后这些词条不再参与
匹配与统计；恢复用 `label on` 或从本配置移除。条目仍在词表里，只是不生效。

### `rulesPack`

| | |
|---|---|
| Type / 类型 | string \| null |
| Default / 默认 | `null` |
| Effect / 作用 | Rules pack (`/shield export` output, schema `dsh-shield.rules/v1`) loaded at startup. |

启动时载入的规则包文件（`/shield export` 的产物，schema `dsh-shield.rules/v1`）。

If the pack specifies `entities`, they **replace** the configured set. Relative paths resolve
under `$DSH_HOME/shield/`. A pack that fails validation degrades to a startup warning.
See [README §Rules packs](../README.md#rules-packs-import--export).

若规则包声明了 `entities`，则**整体替换**配置里的实体集合。相对路径落在 `$DSH_HOME/shield/`
下。校验失败的规则包只降级为启动警告。用法见
[README §规则包](../README.zh.md#规则包导入--导出)。

### `termsAutoReload`

**Removed in 0.2.0 / 0.2.0 已移除** — and superseded in 0.3.0: `termsFile` now hot-reloads on
change (fs.watch, 300 ms debounce), no flag needed. Other config fields still require a profile
restart.

该字段已随 0.2.0 移除——0.3.0 起 `termsFile` 变更自动热重载（fs.watch，300ms 防抖），无需开关。
其余配置项仍需重启 profile。

### `surfaces`

| | |
|---|---|
| Type / 类型 | object of booleans |
| Default / 默认 | every key `true` |
| Effect / 作用 | Chooses which of the five message surfaces are masked by the derive patch. |

选择 derive 补丁对 5 个消息面中的哪些做脱敏。

| Key / 键 | Event type / 事件类型 |
|---|---|
| `system` | `system/message` |
| `developer` | `developer/message` |
| `user` | `user/message` |
| `assistant` | `assistant/message` |
| `tool` | `tool/result` |

A missing key defaults to `true`. The normalizer also writes the event-type keys
(`'system/message'` etc.) onto the same object, so both spellings resolve.

缺失的键默认为 `true`。归一化器还会把事件类型键（`'system/message'` 等）写进同一对象，因此两种
写法都能生效。

```yaml
surfaces:
  system: true
  developer: true
  user: true
  assistant: true
  tool: true
```

> The derive patch gates masking by surface at derive time, so **changing `surfaces` changes what
> gets masked** — and, since config is only read at plugin load, it triggers the restart requirement
> described in [README §Known limitations](README.md#known-limitations).
>
> derive 补丁在派生时按 surface 门控脱敏，因此**改动 `surfaces` 会改变哪些面被改写**；又因配置
> 只在插件加载时读取，所以同样触发 README「已知限制」中的重启要求。

### `mediaPolicy`

| | |
|---|---|
| Type / 类型 | `'pass'` \| `'strip'` |
| Default / 默认 | `'pass'` |
| Effect / 作用 | **`'pass'` always applies, including when you set `'strip'`.** |

**实际永远是 `'pass'`，即使你设成 `'strip'`。**

`runtime.maskBlock()` returns `image`, `file`, `tool-addition`, and `tool-removal` blocks
unchanged, with the comment "按 mediaPolicy=pass 放行". The only other appearance of
`mediaPolicy` is in the `/shield status` output line, which echoes the configured value.

`runtime.maskBlock()` 对 `image`、`file`、`tool-addition`、`tool-removal` 块一律原样返回，注释为
"按 mediaPolicy=pass 放行"。`mediaPolicy` 的另一处出现只是 `/shield status` 输出行，它会回显
配置的取值。

> **Do not rely on `strip`.** Setting `strip` changes the status line and nothing else; media
> blocks still leave your machine as-is.
>
> **请勿依赖 `strip`。** 设为 `strip` 只改变状态行，别的什么也不做；媒体块仍原样出境。

### `sessionFilter`

**Removed in 0.2.0 / 0.2.0 已移除。** The derive patch applies to all sessions in the profile
(it patches `Session.prototype.deriveEventMessage`, which carries no per-session exemption
hook — see `dsh-session-index.js:214`), so the shield can only operate globally. If
`sessionFilter` is still present in the config, the normalizer emits a notice and ignores it.
Use `/shield off` for temporary exemption.
See [§4](#4-session-filter--会话过滤) for the historical behaviour.

derive 补丁对 profile 内所有会话统一生效（它补丁的是 `Session.prototype.deriveEventMessage`，
该层没有逐会话豁免钩子——`dsh-session-index.js:214`），因此护盾只能全局生效。配置里若还留着
`sessionFilter`，归一化器会给出提示并忽略它。临时豁免请用 `/shield off`。历史行为见
[§4](#4-session-filter--会话过滤)。

### `audit.sessionEvent`

**Removed in 0.2.0 / 0.2.0 已移除。** The field no longer exists in `lib/config.js`. No session
events are emitted by this plugin; use `audit.jsonl` for a persistent audit trail.

该字段已不在 `lib/config.js` 中。本插件不发出任何会话事件；需要持久审计轨迹请用
`audit.jsonl`。

### `audit.jsonl`

| | |
|---|---|
| Type / 类型 | boolean |
| Default / 默认 | `true` |
| Effect / 作用 | Appends one JSON line per audited outbound request. |

每次审计过的出境请求追加一行 JSON。**每行只有计数与标签**（占位符数量、标签分布、违规计数、
会话 id、时间戳、插件版本），绝不含明文。写入失败只告警一次，不影响模型通路。

### `audit.jsonlPath`

| | |
|---|---|
| Type / 类型 | string \| null |
| Default / 默认 | `null`（即 `<$DSH_HOME/shield>/audit.jsonl`） |
| Effect / 作用 | JSONL audit file path. Relative paths resolve under `$DSH_HOME/shield/`. |

审计文件路径。相对路径落在 `$DSH_HOME/shield/` 下。

### `audit.retentionDays`

| | |
|---|---|
| Type / 类型 | number |
| Default / 默认 | `30` |
| Effect / 作用 | Audit retention window; older lines are purged at startup. |

审计保留天数。启动时对超出行数的旧记录做清理；文件超过 20MB 时跳过清理（避免大文件重写开销），
查询接口也只读尾部。设为 `0` 表示不清理。

### `audit.verifyOutbound`

| | |
|---|---|
| Type / 类型 | `'off'` \| `'sample'` \| `'full'` |
| Default / 默认 | `'full'` |
| Effect / 作用 | Re-runs the detectors over the outbound request text to detect plaintext that escaped masking. |

在出境请求文本上重跑检测器，以发现漏检外发的明文。

What it actually does / 实际行为：only two states exist in the code.

```js
if (this.enforcing && this.config.audit.verifyOutbound !== 'off'
  && joined.length <= this.config.audit.maxVerifyChars) { /* re-detect */ }
```

So `'off'` disables the check; **`'sample'` behaves exactly like `'full'`** (the condition is
`!== 'off'`, not `=== 'full'`). Any unrecognized value resolves to `'full'`.

因此 `'off'` 关闭复核；**`'sample'` 的行为与 `'full'` 完全相同**（判断条件是 `!== 'off'`，而不是
`=== 'full'`）。任何无法识别的取值都归为 `'full'`。

The check runs **only when `runtime.enforcing` is true**, so an `observe`-mode deployment never
records violations.

该复核**仅在 `runtime.enforcing` 为真时运行**，因此 `observe` 模式的部署永远不会记录残留。

Detected plaintext is counted into `stats.violations` and the most recent occurrence is stored in
`stats.lastViolation` as `{ at, sessionId, labels (first 20 label names only), count, handBuilt }`.
**Label names and counts only — never the matched text.**

检出的明文计入 `stats.violations`，最近一次记录在 `stats.lastViolation`，内容为
`{ at, sessionId, labels（仅前 20 个标签名）, count, handBuilt }`。**只有标签名与计数，绝不含
命中文本。**

### `audit.maxVerifyChars`

| | |
|---|---|
| Type / 类型 | integer |
| Default / 默认 | `2000000` |
| Range / 取值范围 | clamped to `10000` … `20000000` |
| Effect / 作用 | Outbound requests whose combined text is longer than this skip the re-check. |

出境请求合并文本超过该长度则跳过复核。

`joined` is `options.system` plus every `text`/`reasoning` block's text and every `tool-call`
block's `arguments`, joined with `\n`.

`joined` 由 `options.system` 加上所有 `text`/`reasoning` 块的文本与所有 `tool-call` 块的
`arguments`，以 `\n` 连接而成。

Fractional values are truncated with `Math.trunc`. Non-numeric values fall back to the default.

小数会被 `Math.trunc` 截断。非数值回退到默认值。

### `onUnmaskable`

| | |
|---|---|
| Type / 类型 | `'warn'` \| `'block'` |
| Default / 默认 | `'warn'` |
| Effect / 作用 | What happens when a **frozen** outbound request still contains detected plaintext. |

当**冻结的**出境请求仍含被检出明文时如何处理。

- `'warn'` (default): the violation is counted and recorded; the request proceeds.
- `'block'`: the plugin **throws**, aborting the request:

```
dsh-privacy-shield: 出境请求里仍有 <n> 处未脱敏内容，已按 onUnmaskable=block 阻断
```

This only applies to frozen options objects (the agent-loop-built requests). Hand-built unfrozen
requests are masked in place beforehand, so they are not in scope. `'block'` requires
`runtime.enforcing` to be true.

这只对冻结的 options 对象（agent loop 构造的请求）适用。手搓的非冻结请求会先被就地脱敏，因此不在
此范围内。`'block'` 需要 `runtime.enforcing` 为真。

> **Caveat / 注意：** the check keys off `audit.verifyOutbound !== 'off'`. Setting
> `verifyOutbound: 'off'` therefore also disables `onUnmaskable: 'block'`.
>
> 该检查依赖 `audit.verifyOutbound !== 'off'`。因此设 `verifyOutbound: 'off'` 也会同时让
> `onUnmaskable: 'block'` 失效。

Any value other than `'block'` resolves to `'warn'`.

除 `'block'` 外的任何取值都归为 `'warn'`。

### `registerCommand`

| | |
|---|---|
| Type / 类型 | boolean |
| Default / 默认 | `true` |
| Effect / 作用 | Registers the `/shield` command. Requires the `commands` service; the plugin injects it optionally, so a profile without `commands` simply has no command. |

注册 `/shield` 命令。需要 `commands` 服务；插件以可选方式注入，因此没有 `commands` 的 profile
就是没有该命令。

### `registerTools`

| | |
|---|---|
| Type / 类型 | boolean |
| Default / 默认 | `true` |
| Effect / 作用 | Registers the `shield_scan` model-callable tool. |

注册模型可调用的 `shield_scan` 工具（见 [§6](#6-commands--命令)）。工具只报告脱敏统计
（计数与标签），不需要时设为 `false`。

### `maxVaultEntries`

| | |
|---|---|
| Type / 类型 | integer |
| Default / 默认 | `5000` |
| Range / 取值范围 | clamped to `100` … `200000` |
| Effect / 作用 | Cap on the in-memory restore table. Oldest entries are evicted first. |

内存还原表的上限。最旧的条目先被逐出。

Actual floor is `Math.max(16, value)`, so values below 16 behave as 16 even though the config
clamp is 100.

实际下限是 `Math.max(16, value)`，因此即使配置收敛到 100，低于 16 的值在还原表层面等同于 16。

Eviction is silent. A placeholder whose mapping was evicted stays a placeholder in restored
output.

逐出是静默的。映射已被逐出的占位符在还原输出中保持为占位符。

### `debug`

**Removed in 0.2.0 / 0.2.0 已移除。** The field no longer exists in `lib/config.js`. Operational
messages go through the host logger and `/shield status` warnings.

该字段已不在 `lib/config.js` 中。运行信息走宿主日志与 `/shield status` 的警告区。

---

## 3. Term list reference / 词表参考

The term list is the intended way to cover proper nouns the heuristic detectors miss (your own
organizations, projects, systems, document numbers).

词表是覆盖启发式检测器漏检专有名词（你自己的机构、项目、系统、文号）的推荐手段。

**Only active when `term` is in `entities`.** If you remove `term` from `entities`, `compileTerms`
still runs but `detectTerms` is never called, so no term is ever matched.

**仅在 `entities` 含 `term` 时生效。** 若从 `entities` 去掉 `term`，`compileTerms` 仍会运行，
但 `detectTerms` 永不被调用，因此不会有任何词条被命中。

### Line format / 行格式

```
[whitespace] term [whitespace @category] [whitespace # trailing comment]
```

Parsing rules, in order / 解析规则（按顺序）：

1. The line is trimmed.
2. A line that is empty, starts with `#`, or starts with `//` is skipped.
3. The first occurrence of ` #` starts a trailing comment; everything from there is discarded.
4. A trailing ` @category` at the end of the line is extracted. The category must match
   `[A-Za-z][A-Za-z0-9_-]{0,15}`.
5. A `term | @category` form is also accepted: a `|` whose right side is exactly `@category` or
   `category`.
6. If the remaining term is empty or longer than 200 characters, the entry is dropped.

1. 去除行首尾空白。
2. 空行、以 `#` 开头、以 `//` 开头的行跳过。
3. 第一个 ` #` 起行尾注释，其后内容全部丢弃。
4. 提取行尾的 ` @分类`。分类须匹配 `[A-Za-z][A-Za-z0-9_-]{0,15}`。
5. 也接受 `词条 | @分类` 形式：`|` 的右侧恰为 `@分类` 或 `分类`。
6. 剩余词条为空、或超过 200 字符，则丢弃该条目。

Because the category is parsed from the **end of the line**, terms may contain spaces (useful for
English project names).

由于分类从**行尾**解析，词条可以含空格（适用于英文项目名）。

A term starting with `re:` is a **regex entry** (v0.3.0): the remainder (before the trailing
category) is compiled with the `u` flag and matched with `String.matchAll`. Up to
`MAX_REGEX_TERMS = 500` regex entries are compiled; extras are counted as skipped. A broken regex
degrades to a warning and never blocks startup.

以 `re:` 开头的词条是**正则条目**（v0.3.0）：`re:` 之后（行尾分类之前）的内容按 `u` 标志编译并用
`String.matchAll` 匹配。最多编译 `MAX_REGEX_TERMS = 500` 条，超出计入 skipped。正则写错只降级为
警告，绝不让 profile 起不来。

### Categories / 分类

| Category / 分类 | Label / 标签 |
|---|---|
| `company`, `org` | `ORG` |
| `project` | `PROJ` |
| `system` | `SYS` |
| `id` | `IDNO` |
| `address` | `ADDR` |
| `person` | `PERSON` |
| `other` | `TERM` |
| *(omitted / 省略)* | `TERM` |

Category matching is **case-insensitive** (the parsed category is lowercased first).

分类匹配**大小写不敏感**（解析出的分类先转为小写）。

An unrecognized category that is still a valid label shape (`^[A-Z][A-Z0-9]{0,15}$` after
uppercasing and stripping non-alphanumerics) is used as the label directly. So `@ORG`, `@proj`,
`@IDNO` all work. Anything else falls back to `TERM`.

未能识别、但形态合法（转大写并剥离非字母数字后匹配 `^[A-Z][A-Z0-9]{0,15}$`）的分类会直接用作
标签。因此 `@ORG`、`@proj`、`@IDNO` 都可用。其余回退到 `TERM`。

### Matching semantics / 匹配语义

- Terms are normalized with NFKC + lowercase, exactly like the search text, so matching is
  case-insensitive and full-width/half-width insensitive.
- **Longest first.** Compiled terms are sorted by descending length, and matching tries longer
  terms before shorter ones at the same position. So a term `某某科技有限公司` wins over a
  hypothetical `某某科技`.
- Matching never overlaps within the term detector itself (the scan index advances past a match).
- Duplicate terms (after normalization) are collapsed; the first occurrence's label wins.
- Matching runs **before** the final overlap resolution, competing with the regex and Chinese
  detectors on start position, score, and length. Terms are given score `1` (the maximum), so at
  the **same start position a term beats any regex or Chinese-entity match**.
- Up to 20,000 literal terms are compiled; entries beyond that are ignored (regex entries: 500).
- The same term always yields the same placeholder, by the deterministic hash.
- Entries whose label is in `disabledLabels` are compiled out entirely (see `disabledLabels`).

- 词条与检索文本一样做 NFKC + 小写归一化，因此匹配大小写不敏感、全角半角不敏感。
- **最长优先。** 编译后的词表按长度降序排序，同一起点先试长词条。因此 `某某科技有限公司` 会胜过
  假想的 `某某科技`。
- 词表检测器内部不产生重叠（命中后扫描下标前移）。
- 归一化后重复的词条被折叠，保留首次出现的标签。
- 匹配发生在最终重叠消解**之前**，与正则及中文检测器按起点、置信度、长度竞争。词条的置信度为 `1`
  （最高），因此**同一起点上词条胜过任何正则或中文实体命中**。
- 最多编译 20,000 条词条，超出部分被忽略。
- 同一词条因确定性哈希永远得到同一占位符。

### Examples / 示例

```yaml
entities:
  - phone-cn
  - email
  - term        # term must be present for the list to be used
terms:
  - "# 机构 / organizations"
  - 某某科技有限公司 @company
  - 某某科技（北京）有限公司 @company
  - "# 项目 / projects"
  - 蓝鸟计划 @project
  - Project Bluebird @project
  - "# 系统 / systems"
  - 天枢核心交易系统 @system
  - "# 编号 / identifiers"
  - HT-2024-001 @id
  - 保密协议 2024-017 @id
  - "# 其他 / other"
  - 某内部代号 @other
  - "# 无分类，使用 TERM 标签 / no category, uses TERM"
  - 未分类代号
  - "# 行尾注释 / trailing comment"
  - 内部系统A @system   # 这一段的注释会被丢弃
```

---

## 4. Session filter / 会话过滤

> **Removed in 0.2.0 / 0.2.0 已移除。** `sessionFilter` no longer exists. The shield is global:
> use `/shield off` for a temporary exemption. The text below documents the 0.1.0 behaviour and is
> kept for reference only.
>
> `sessionFilter` 已不存在。护盾是全局的：临时豁免请用 `/shield off`。下文描述的是 0.1.0 的行为，
> 仅作存档。

| Field / 字段 | Type / 类型 | Default / 默认 | Meaning / 含义 |
|---|---|---|---|
| `sessionFilter.include` | string[] | `[]` | Sessions to cover. Empty means all. |
| `sessionFilter.exclude` | string[] | `[]` | Sessions to skip. **Takes precedence.** |

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `sessionFilter.include` | string[] | `[]` | 要覆盖的会话。空表示全部。 |
| `sessionFilter.exclude` | string[] | `[]` | 要跳过的会话。**优先。** |

### Matching order / 匹配顺序

```js
if (typeof sessionId !== 'string' || sessionId === '') return true   // 1
if (filter.exclude.some(pattern => globMatch(pattern, sessionId))) return false  // 2
if (filter.include.length > 0 && !filter.include.some(...)) return false         // 3
return true                                                                       // 4
```

1. An empty or non-string session id is **always covered**.
2. `exclude` wins over `include`.
3. `include` only restricts when it is non-empty — an empty `include` means "everything not
   excluded".
4. Otherwise the session is covered.

1. 空或非字符串的会话 id **总是被覆盖**。
2. `exclude` 优先于 `include`。
3. `include` 只在非空时才起限制作用——空的 `include` 等于"除排除项之外的全部"。
4. 否则该会话被覆盖。

### Glob support / glob 支持

Only `*` is supported. A pattern with no `*` is compared literally. With `*`, the pattern is
escaped, `*` becomes `.*`, and the whole value must match (`^...$`).

只支持 `*`。不含 `*` 的模式按字面比较。含 `*` 时，模式先转义，`*` 变成 `.*`，并要求整体匹配
（`^...$`）。

```yaml
sessionFilter:
  include:
    - "session-*"          # every session whose id starts with "session-"
  exclude:
    - "session-dev-*"      # except developer sessions
    - "session-7f2544cf-97fb-47c0-b19e-9010a8f77706"
```

> **0.1.0 only / 仅 0.1.0：** session coverage was evaluated per request, not per session at startup.
> `runtime.active` (the `/shield on|off` flag) and `runtime.enforcing` (the
> `/shield enforce|observe` flag) both fed into `sessionAllowed()` at `llm/stream` time.
>
> 0.1.0 中，会话覆盖是按请求求值的，不是启动时按会话固化。`runtime.active`（`/shield on|off`
> 标志）与 `runtime.enforcing`（`/shield enforce|observe` 标志）都在 `llm/stream` 时参与
> `sessionAllowed()` 判断。

---

## 5. Placeholder and label reference / 占位符与标签参考

### Shape / 形态

```
<LABEL_8hexdigits>
```

| Part / 部分 | Rule / 规则 |
|---|---|
| `<` `>` | literal delimiters / 字面定界符 |
| `LABEL` | 1–16 uppercase letters/digits, first must be a letter / 1–16 个大写字母或数字，首位须为字母 |
| `_` | literal separator / 字面分隔符 |
| hash | exactly 8 lowercase hex digits, zero-padded / 恰 8 位小写十六进制，左侧补零 |

Recognition regex / 识别正则:

```js
/<([A-Z][A-Z0-9]{0,15})_([0-9a-f]{8})>/g
```

Partial-tail regex (streaming carry-over) / 尾部残留正则（流式扣留）:

```js
/^<[A-Z][A-Z0-9]{0,15}(?:_[0-9a-f]{0,8})?$/
```

Maximum possible placeholder length is 27 characters (`<` + 16 + `_` + 8 + `>`); the stream
restorer withholds a trailing candidate only while it is at most that long.

占位符最大可能长度为 27 字符（`<` + 16 + `_` + 8 + `>`）；流式还原器只在尾部候选不超过该长度时
扣留它。

### Hash / 哈希

Two modes, selected by `placeholderHash` (v0.3.0):

两种模式，由 `placeholderHash` 选择（v0.3.0）：

- **`hmac`（默认）** — first 4 bytes of HMAC-SHA256(key, `LABEL + "\u0000" + value`), hex-encoded.
  The key is a 32-byte hex string in `$DSH_HOME/shield/.placeholder.key` (created on demand, chmod
  600 best-effort); if the key file is unreadable an in-memory key is used and a warning is raised.
  **Not enumerable without the key** — an attacker cannot confirm guesses by recomputing.
  前 4 字节 HMAC-SHA256(key, `LABEL + "\u0000" + value`)，十六进制编码。密钥是
  `$DSH_HOME/shield/.placeholder.key` 里的 32 字节 hex（按需生成，尽力 chmod 600）；读不到文件
  时用进程内存密钥并告警。**没有密钥无法枚举反推**——攻击者不能通过重算哈希确认猜测。
  注意：内存密钥模式下进程重启会使同一真值的占位符变化。
- **`legacy`** — FNV-1a 32-bit over the UTF-16 code units of `LABEL + "\u0000" + value`, rendered
  as `toString(16).padStart(8, '0')` (the v0.2.x format). Stateless and stable, but **not a
  cryptographic hash and not a secret**: an attacker who can guess the value can confirm it by
  recomputing. Prefer `hmac`.
  FNV-1a 32 位（v0.2.x 格式）。无状态、稳定，但**不是密码学哈希也不是秘密**：能猜到值的攻击者
  可通过重算哈希确认。建议用 `hmac`。

Both modes are deterministic and stateless — needed so cached per-message mask results stay
consistent across re-derivation (cold restore, fork, replay).

两种模式都确定且无状态——使按消息缓存的掩码结果在重派生（cold restore、fork、重放）时保持一致。

### Label table / 标签表

| Entity / 实体 | Label / 标签 |
|---|---|
| `phone-cn` | `PHONE` |
| `landline-cn` | `TEL` |
| `email` | `EMAIL` |
| `id-card-cn` | `IDCARD` |
| `bank-card` | `BANKCARD` |
| `uscc` | `USCC` |
| `case-no` | `CASENO` |
| `plate-cn` | `PLATE` |
| `passport-cn` | `PASSPORT` |
| `wechat` | `WECHAT` |
| `qq` | `QQ` |
| `ipv4` | `IP` |
| `ipv6` | `IPV6` |
| `api-key` | `KEY` |
| `jwt` | `JWT` |
| `social-insurance` | `SOCIAL` |
| `housing-fund` | `HOUSING` |
| `student-id` | `STUDENT` |
| `medical-record` | `MEDICAL` |
| `imei` | `IMEI` |
| `mac-address` | `MAC` |
| `cn-org` | `ORG` |
| `cn-project` | `PROJ` |
| `cn-system` | `SYS` |
| `cn-address` | `ADDR` |
| `cn-person` | `PERSON` |
| `cn-id` | `IDNO` |
| `term` | `TERM`, or the label from the term's category / 或词条分类对应的标签 |

---

## 6. Commands / 命令

Every command is a subcommand of `/shield`. The dispatcher splits `rawInput` on whitespace; the
first token selects the subcommand and the remainder is joined back as the argument.

所有命令都是 `/shield` 的子命令。分发器按空白切分 `rawInput`，第一个 token 选择子命令，其余重新
拼接为参数。

| Command / 命令 | Result / 结果 |
|---|---|
| `/shield` | Same as `/shield status`. / 等同于 `/shield status`。 |
| `/shield status` | Status overview. / 状态总览。 |
| `/shield on` | `runtime.active = true`. Text: `隐私护盾已开启：模型可见面使用脱敏副本（enforce），本地日志与界面仍是真值。` |
| `/shield off confirm` | `runtime.active = false`. Requires `confirm`. / 关闭护盾，需要 `confirm`。 |
| `/shield enforce` | `runtime.setEnforcing(true)`. Text: `已切换到 enforce：模型可见面使用脱敏副本。` |
| `/shield observe confirm` | `runtime.setEnforcing(false)`. Requires `confirm`. / 切到 observe，需要 `confirm`。 |
| `/shield pause <minutes>` | Temporarily passes plaintext (audit still records, flagged `paused`); auto-resumes. / 临时放行，审计照记并标注 paused；到期自动恢复。 |
| `/shield doctor` | ✅/⚠️ health check: patch, mode, hash, terms, audit, violations, errors. / 逐项体检。 |
| `/shield verify [text]` | Without text: outbound audit summary. With text: masked trial output. / 无参：出境审计摘要。带文本：脱敏试跑输出。 |
| `/shield terms` | Term-list statistics. / 词表统计。 |
| `/shield terms label off\|on <LABEL>` | Disable/restore term entries by label (v0.3.0). / 按标签停用/恢复词条。 |
| `/shield terms adopt <序号…\|all>` | Adopt scan-doc/learn candidates (30-min TTL). / 采纳候选（30 分钟有效）。 |
| `/shield scan-doc <路径>` | Extract candidate proper nouns from a local document. / 扫描本地文档抽候选。 |
| `/shield learn` | Mine frequent unmatched fragments from local session logs. / 从会话历史学习候选。 |
| `/shield audit [天数]` | Outbound audit aggregation (counts only). / 出境审计聚合。 |
| `/shield audit export <路径>` | Export audit aggregation as CSV. / 导出审计 CSV。 |
| `/shield vault` | Restore-table statistics. / 还原表统计。 |
| `/shield rules` | Current rules summary (counts only). / 当前规则摘要（只有计数）。 |
| `/shield export [路径] [--encrypt 口令]` | Writes terms + entity switches to a rules pack; `--encrypt` adds AES-256-GCM (header `DSH-SHIELD-ENC/v1`). / 导出规则包；`--encrypt` 加密。 |
| `/shield import <路径> [--pass 口令] [replace confirm]` | Loads a pack (auto-detects encrypted); `replace` overwrites the term list instead of merging (requires `confirm`). / 载入规则包（自动识别加密包）；`replace` 覆盖词表（需 confirm）。 |
| `/shield help` | Usage text. Also the fallback for any unknown subcommand. / 用法说明，也是任何未知子命令的回退。 |

### `/shield status` output / 输出

```
【隐私护盾 dsh-privacy-shield】模式=<mode> 护盾=<开|关>　生效范围=所有会话（全局）
当前会话：<sessionId>（仅用于审计标注）
实体：<n> 类（<names>）
覆盖 surface：<keys>
模型可见面脱敏（derive 补丁）：已装（模型只见占位符）｜未装 或（未改写，只审计）
词表：<n> 条　还原表：<n> 条
词表标签分布：
  <LABEL>: <n>
媒体策略：<mediaPolicy>
未脱敏兜底：<warn|block>　出境复核：<off|sample|full>
审计落盘：<path|关闭>

—— 统计（只含计数，不含明文）——
改写文本片段：<n>
按类型分布：
  <LABEL>: <n>
模型调用拦截：<n> 次　出境请求审计：<n> 次
出境占位符合计：<n>
  <LABEL>: <n>
响应还原次数：<n>
明文残留告警：<n>
```

Plus, conditionally / 另在以下情况追加：

- `最近一次残留：…` when a violation was recorded.
- `提示：当前 /shield off，模型可见面未脱敏。` when inactive.
- A `—— 警告 ——` block with up to the last 5 runtime warnings.
- A `—— 最近错误 ——` block with up to the last 5 errors (`[where] message`).
- A fixed operational reminder that config and code changes require a profile restart.

### `/shield verify` output / 输出

Without text / 无参: audited request count, total placeholders, label distribution, and a
violation verdict (`0 处 ✅` or `n 处 ⚠️`). In observe mode it appends a warning that the
model-visible surface is **not** masked and plaintext is still leaving.

无参：已审计请求数、占位符合计、标签分布、残留结论（`0 处 ✅` 或 `n 处 ⚠️`）。observe 模式下追加
警告：模型可见面**并未**被改写，出境请求里仍会有明文。

With text / 带文本:

```
【试跑脱敏】命中 <n> 处，生成占位符 <n> 个。
  <LABEL>: <n>

脱敏结果（原文不会显示）：
<masked text>
```

> The trial run uses a **fresh one-shot engine** (`runtime.engine.mask` on the live engine) and
> prints only the masked result. Your original text is never echoed. Note that this trial **does
> record entries into the vault**, because it uses the same engine instance whose `onEntry` writes
> to the vault.
>
> 试跑使用**现用引擎**（`runtime.engine.mask`），只打印脱敏结果，绝不回显你的原文。注意该试跑
> **会向还原表写入条目**，因为它用的是同一个 `onEntry` 写入还原表的引擎实例。

### Runtime flag semantics / 运行时标志语义

Two independent flags:

两个相互独立的标志：

| Flag / 标志 | Set by / 由何设置 | Effect / 作用 |
|---|---|---|
| `active` | `/shield on` / `/shield off` | Global master toggle. When false, `protecting` is false: the derive patch leaves derived messages untouched, and the `llm/stream` handler calls `next()` unchanged. / 全局开关。为 false 时 `protecting` 为 false：derive 补丁原样放行派生消息，`llm/stream` 也原样放行。 |
| `enforcing` | `/shield enforce` / `/shield observe` | When false, the derive patch returns original messages: nothing is rewritten, but detections still run for statistics. / 为 false 时 derive 补丁原样返回：不改写，但检测照跑以维持统计。 |

`protecting = active && enforcing`. Session coverage is global: `sessionAllowed()` ignores the
session id and returns `active` (kept for the browser-half contract).

`protecting = active && enforcing`。会话覆盖是全局的：`sessionAllowed()` 忽略会话 id，直接返回
`active`（为浏览器半边契约保留）。

Both are in-memory, process-local, and lost on restart. Neither writes to
`cordis.patch.yml`.

两者都是内存态、进程内，重启即失效。都不会改写 `cordis.patch.yml`。

> **`on`/`off`/`enforce`/`observe` only flip in-memory runtime flags** read by the derive patch
> and the stream wrapper at call time — they never touch the session log or the patched class.
> So toggling them is safe for live sessions; only unloading the plugin or changing
> `surfaces`/`enabled` in config triggers a restart requirement.
>
> **`on`/`off`/`enforce`/`observe` 只翻内存里的运行时标志**，derive 补丁与流包装在调用时读取——
> 它们不触碰会话日志，也不改动被补丁的类。因此运行中切换对 live 会话是安全的；只有卸载插件，
> 或改动配置里的 `surfaces`/`enabled`，才会触发重启要求。

### `shield_scan` model tool / 模型工具

`registerTools: true` registers `shield_scan`: one required string argument `text`. It runs the
text through the live masker and returns `{ ok, mode, masked, replaced, distribution, error }` —
placeholder-rewritten text plus per-label counts, **never the original values**.

`registerTools: true` 时注册 `shield_scan`：必填字符串参数 `text`。它用现用引擎跑一遍脱敏，
返回 `{ ok, mode, masked, replaced, distribution, error }`——占位符化文本加分类计数，
**绝不回真值**。

---

## 7. Not implemented / 未实现的特性

The following are **not present** in 0.2.0. They are listed so you do not configure them expecting
an effect. Everything else documented in §2–§6 works as described.

以下特性在 0.2.0 中**不存在**。列出以免你配置后误以为会生效。§2–§6 文档化的其余特性均按描述工作。

| Feature / 特性 | Status / 状态 |
|---|---|
| `mediaPolicy: 'strip'` | **Not implemented.** Media blocks always pass through. / **未实现。** 媒体块始终放行。 |
| `lib/rebuild.js` (vault rebuild from log) | **Does not exist.** Referenced in a comment in `lib/vault.js` as a plan. Rebuilding works by re-running the detectors over the local log, not via a shipped module. / **不存在。** 重建=对本地日志重跑检测器，不依赖独立模块。 |
| Hot reload of `termsFile` | **Not implemented.** Term sources load once at startup; restart the profile (or `/shield import`) to pick up changes. / **未实现。** 词表只在启动时载入一次。 |
| Per-session filtering | **Removed in 0.2.0** (the derive patch applies to `Session.prototype`, which has no per-session hook). / **0.2.0 已移除**（derive 补丁作用于 `Session.prototype`，无逐会话钩子）。 |
| `audit.sessionEvent` / `termsAutoReload` / `debug` | **Removed in 0.2.0** — no longer parsed. / **0.2.0 已移除**——不再被解析。 |

### Sharing rules between machines / 机器之间共享规则

Use rules packs (`/shield export` → send the file → `/shield import`, or ship it via
`rulesPack` in `cordis.patch.yml`). A snippet works too:

机器之间用规则包（`/shield export` → 发文件 → `/shield import`，或在 `cordis.patch.yml` 里配
`rulesPack`）。发配置片段也可以：

```yaml
# snippet to send to a colleague / 发给同事的片段
terms:
  - 某某科技有限公司 @company
  - 蓝鸟计划 @project
  - HT-2024-001 @id
```

> **A term list can itself be sensitive.** It contains the very proper nouns you are trying to
> protect. Handle the pack or snippet accordingly and do not commit it to a shared repository.
>
> **词表本身可能就是敏感数据。** 它包含你正试图保护的专有名词。请妥善保管规则包或片段，不要
> 提交到共享仓库。

---

## 8. Complete worked example / 完整示例

A full `cordis.patch.yml` shaped for production use.

一份面向正式使用的完整 `cordis.patch.yml`。

```yaml
# dsh-privacy-shield — production-oriented example / 面向正式使用的示例
- insert:
    - id: shield
      name: dsh-privacy-shield
      config:
        # Master switch / 总开关
        enabled: true

        # Actually rewrite the model-visible surface.
        # 真正改写模型可见面。
        mode: enforce

        # Explicit entity set (replaces the default set).
        # 显式实体集合（整体替换默认集合）。
        entities:
          - phone-cn
          - landline-cn
          - email
          - id-card-cn
          - bank-card
          - uscc
          - case-no
          - plate-cn
          - passport-cn
          - wechat
          - qq
          - api-key
          - jwt
          - cn-org
          - cn-project
          - cn-system
          - cn-id
          - cn-address
          - cn-person
          - term
          # ipv4 / ipv6 intentionally omitted (opt-in).
          # 故意省略 ipv4 / ipv6（opt-in）。

        # Your own proper nouns. `term` must be in `entities` above.
        # 你自己的专有名词。上面的 `entities` 必须含 `term`。
        terms:
          - "# 机构 / organizations"
          - 某某科技有限公司 @company
          - "# 项目 / projects"
          - 蓝鸟计划 @project
          - "# 系统 / systems"
          - 天枢核心交易系统 @system
          - "# 编号 / identifiers"
          - HT-2024-001 @id

        # Optional external word list and/or rules pack (relative paths land
        # under $DSH_HOME/shield/). Loaded at startup; no hot reload.
        # 可选的外部词表文件和/或规则包（相对路径落在 $DSH_HOME/shield/ 下）。
        # 启动时载入一次；没有热重载。
        termsFile: ""
        rulesPack: ""

        # All five model-visible surfaces. / 全部 5 类模型可见面。
        surfaces:
          system: true
          developer: true
          user: true
          assistant: true
          tool: true

        # Keep media blocks in place (the only implemented behaviour).
        # 媒体块原样放行（唯一已实现的行为）。
        mediaPolicy: pass

        # Outbound self-check. / 出境自检。
        audit:
          jsonl: false
          jsonlPath: ""
          verifyOutbound: full
          maxVerifyChars: 2000000

        # Strict: refuse to send a frozen request that still has plaintext.
        # 严格档：冻结请求仍含明文时拒绝发送。
        onUnmaskable: warn

        registerCommand: true
        registerTools: true
        maxVaultEntries: 5000
```

### Post-install checklist / 安装后检查清单

1. Install with `plugin_manager action=install_bundle target=<absolute path>`.
   用 `plugin_manager action=install_bundle target=<绝对路径>` 安装。
2. **Restart the DSH profile.** / **重启 DSH profile。**
3. Run `/shield status`. Confirm / 运行 `/shield status`，确认：
   - `模式=enforce` and `护盾=开`;
   - `生效范围=所有会话（全局）`;
   - `实体：<expected count> 类`;
   - `覆盖 surface` lists all five keys you enabled;
   - `模型可见面脱敏（derive 补丁）` shows `已装`.
4. Run `/shield verify <a fake sensitive string>`. Confirm the output contains placeholders and
   not your input.
   运行 `/shield verify <一段假的敏感字符串>`，确认输出含占位符而不含你的输入。
5. Send a real message containing a value you expect to be masked. Re-check `/shield status`:
   `出境占位符合计` should be greater than `0` and `明文残留告警` should stay `0`.
   发一条含待脱敏值的真实消息，再查 `/shield status`：`出境占位符合计` 应大于 `0`，
   `明文残留告警` 应保持 `0`。

---

*See also / 另见: [README.md](README.md) · [README.zh.md](../README.zh.md) ·
[COMPLIANCE.md](COMPLIANCE.md) · [SECURITY.md](SECURITY.md) · [DESIGN-NOTES.md](DESIGN-NOTES.md)*
