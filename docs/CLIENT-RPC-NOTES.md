# CLIENT-RPC-NOTES — 浏览器半边 RPC 契约（已核实结论与证据）

> 本文是 `client.js`（浏览器半边）与 `lib/client-rpc.js`（宿主半边）之间的契约说明，
> 记录**已查证的 DSH 机制**与实机验证结论。改这两个文件之前先读本文。
>
> 最后更新：2026-10-14（实机端到端验证通过，DSH 0.2.0-rc.2 / Electron 44）。

## 0. 最终架构（TL;DR）

```
client.js（dsh-app://app 页面内）
   │  POST 相对路径 'api/shield'（client-request 信封）
   │  → Electron protocol.handle 转发器（自动附带鉴权 cookie）
   ▼
宿主 webserver（127.0.0.1:19387）
   /api 共享通道（connection 服务挂载，自带 Host/Origin 围栏 + 浏览器鉴权）
   → 精确 Fetch 路由 /api/shield（dsh-privacy-shield 注册，按信封 method 分发）
   ▼
dispatch(method, payload) → 纯 JSON 结果（绝不含明文）
```

诊断通道：`clientLog` 方法把浏览器侧日志经同一条 RPC 落到
`$DSH_HOME/shield/debug-client.jsonl`（限长 1MB），状态条右侧徽标 `⇄<通道>+a/-a` 实时
显示传输通道与 apply 状态。

## 1. 已查证的机制（源码证据，全部经实机验证）

### 1.1 浏览器半边要加载，package.json 必须有 `dsh.client` 声明

- 宿主 `dsh-client-modules` 扫描每个 bundle 的 `package.json`；`dsh.client` 缺失或
  `platform !== "web"` 时**整个浏览器半边被跳过**（`resolveMeta()` 直接返回 null）。
- 官方声明形状（`@local/my-decoration` 模板）：
  ```json
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true,
                "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
  }
  ```
- `inject` 的值是**包名**（其 client bundle 需先于本包到达），不是服务名。
- `exports` 必须含 `"./client"` 子路径。

### 1.2 页面运行在 `dsh-app://app` 自定义协议下

- 桌面端用 Electron `protocol.handle("dsh-app", …)` 服务页面；非静态资源路径
  （非 `/`、非 `/assets/*`）经 `forwardWebRequest` 转发到宿主 webserver，
  **自动附带浏览器鉴权 cookie**（`dsh-desktop` main.js）。
- 因此**裸 `fetch` 相对路径就能到达宿主并过鉴权**；不需要平台 transport 里的
  rpc/fetch（实际上 `__DSH_TRANSPORT__ = { ownsHost, streamBaseUrl }`，两者皆无）。

### 1.3 信封协议（dsh-client-connection）

- 请求体必须是 client-request 信封：
  `{ type: "client-request", rpcId: string, method: string, payload: unknown }`
  （`clientRequestSchema`；缺字段/格式错会被网关拒）。
- 响应是 server-response 信封：
  `{ type: "server-response", rpcId, result: { ok: true, value } | { ok: false, error: { code, message, details } } }`。
- 我们自己的 `dispatch()` 返回 `{ok:true, …}` / `{ok:false, error: string}` 裸格式，
  由路由层包成上面的 result。

### 1.4 唯一可用的挂载点：`/api` 共享通道的精确 Fetch 路由

- connection 服务把 `/api` 挂成共享通道（admission：Host/Origin 围栏 + cookie 鉴权），
  并提供 `connection.fetch.register(route)` 注册**精确路径** Fetch 路由
  （`registerFetchRoute` / `createSharedFetchHandler`，见 dsh-client-connection/lib/index.js）。
- **踩过的坑（勿重蹈）**：
  - 根路径 `/shield` 被 client-modules 的 Web carrier（`/plugins` 前缀资源路由）**整体遮蔽**：
    任何方法、任何 body 都回 400 空响应。实证：GET/POST/坏包全是 400，而 `/api/*` 回 401。
  - `ctx.connection.rpc.handle('/shield', …)` 注册的 prefix 路由同样落在被遮蔽路径上，桌面端不可用。
  - `apply(ctx)` 里直接访问 `ctx.connection` 探测服务会在激活期抛错（cordis 未知服务访问），
    导致 "web boot: entry did not activate" 拒绝启动——探测必须包 try/catch。
- 结论：`POST /api/shield` 单端点 + 信封内 `method` 分发，是当前桌面端唯一可靠的挂载方式。

### 1.5 插槽组件实际收到的 props

- 组件收到 `{…kit, …injected, …slotInjected.props, …ownerProps}`：`kit` 是标准 hooks
  （`use<Name>` 选择器）与可选 `t`（仅当注册声明了 `locale` 命名空间）、`renderSlot` 等。
- **不会**收到 `connection` 服务。取数只能走本文的 RPC，或未来平台把服务注入 props。

### 1.6 宿主侧注册（lib/client-rpc.js）

1. `ctx.inject(['connection'], …)` → `connection.rpc.handle('/shield', dispatch)`
   （保留：web 部署形态下可用；桌面端被遮蔽但无害）。
2. `ctx.inject(['connection'], …)` → `connection.fetch.register({ path: '/api/shield', methods: ['POST'], requestBody: 'buffered', fetch })`
   ——**桌面端生产通道**。
3. 全部不可用 → 返回 undefined，client 显示"状态不可用"，**不影响脱敏主链路**。

## 2. 方法契约

客户端统一 POST `/api/shield`，信封 `method` 取值如下（`RPC_METHODS`）：

| 方法 | payload | 返回 |
|---|---|---|
| `status` | 无 | 状态对象（见下） |
| `setMode` | `{ mode: 'enforce' \| 'observe' }` | 切换后的状态对象 |
| `setEntities` | `{ entities: string[] }` | `{ ok, entities, snapshot }` |
| `termsList` | 无 | `{ ok, terms: string[] }` |
| `termsAdd` / `termsRemove` | `{ lines }` / `{ values }` | `{ ok, terms }` |
| `testMask` | `{ text }` | 本地即时脱敏预览（纯占位符，不含明文） |
| `scanDoc` / `learn` | `{ path }` / 无 | 候选专名池 |
| `adopt` | `{ ids }` | 候选采纳进词表 |
| `auditSummary` | `{ days }` | 近 N 天审计聚合（只有计数） |
| `clientLog` | `{ level, message }` | `{ ok: true }`（诊断落盘 debug-client.jsonl） |

**硬规则**：返回的任何字段都不得包含真实敏感值——只有计数、标签、布尔值与版本号。

状态对象字段（`buildStatus()`）：`ok / version / plugin / enabled / mode / active /
registerProjections（值取自 derivePatchInstalled）/ entities / surfaces /
terms{count,byCategory} / counts{maskedTexts,streamCalls,restoredValues,outboundRequests,
outboundPlaceholders,outboundByLabel,violations,errors} / sessions / session{id,allowed}`。

## 3. client.js 的传输通道（按优先级）

1. `globalThis.__DSH_TRANSPORT__.rpc.call(CHANNEL, …)`——若平台未来提供官方 RPC 客户端则优先。
2. `fetch('api/shield', { method: 'POST', body: client-request 信封 })`——**当前生产通道**
   （`__DSH_TRANSPORT__` 无 fetch 时用裸 fetch，行为相同：相对路径 → dsh-app:// 转发器）。

- 所有通道统一过 `withTimeout`（6s，AbortController）；响应统一按 server-response 信封解析。
- 全断 → 状态条显示"host 状态不可用： <原因>"，▸ 仍可点开查看原因，**绝不抛错**。
- 渲染错误由 `Guard` 错误边界兜住（显示错误文本而不是卸掉整个注册）。
- 文案：插槽上下文给了 `t` 就用 `t`；否则用内联中英文案表（与 `locale/*.json` 同源）。

## 4. 实机验证记录（2026-10-14）

- `/shield status`：26 类实体、审计落盘开启、引擎 HMAC-SHA256 ✓
- 状态条实时数据 + ▸ 展开五页签面板（设置/词表/测试台/审计/候选）✓
- `debug-client.jsonl`：`apply() called; connection=yes`、`status ok via 通道 raw` ✓
- e2e 离线探针：模型可见面无明文泄漏、本地事件未动、还原表工作 ✓

## 5. 不确定处（改这里之前先复查 DSH 版本）

1. `ctx.slots.register` 选项里的 `locale: NS` / `inject()` 消费方在 renderer dist 里
   （dsh-privacy-shield 不依赖，内联文案表兜底）。
2. web 部署形态（非桌面端）下 `/shield` prefix 路由可能可用；桌面端一定走 `/api/shield`。
3. `setMode` 只切进程内状态（易失）；持久化改动仍应写 `cordis.patch.yml` 后重启 profile。
