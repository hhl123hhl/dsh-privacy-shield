# 把 dsh-privacy-shield 给别人用（安装 / 升级 / 卸载）

> English version: see the "For recipients (English)" section at the bottom of this file.

这是一个 **DSH bundle 插件**：零第三方运行时依赖、无构建步骤。任何人拿到发布包后，
按下面任一方式装进自己的 DSH，重启一次即可使用。

## 前置条件

- 已安装并登录 DSH 桌面版，能正常和助手对话。
- 会用解压软件（方式 A）或能粘贴一个下载链接（方式 B）。
- 不需要自己装 Node.js / pnpm / git（DSH 自带运行时；只有方式 C 需要系统里有 git）。

## 包里有什么

- `dsh-privacy-shield-1.0.0.zip`：解压得到 `dsh-privacy-shield/` 目录，用于**方式 A**（离线最简单）。
- `dsh-privacy-shield-1.0.0.tgz`：标准 npm tarball（根目录 `package/`），用于**方式 B**（URL 安装）
  或方式 D（npm 发布）。已用 `npm install` 实测可安装。
- `SHA256SUMS.txt`：两个归档的 SHA-256，收到后建议核对（Windows: `certutil -hashfile <文件> SHA256`；
  macOS/Linux: `shasum -a 256 <文件>`）。
- `安装说明.md` / `INSTALL.en.md` / `分享文案.md`：本说明的中英文版与可直接转发的文案。

## 方式 A：本地文件夹安装（离线，推荐）

1. 解压 `dsh-privacy-shield-1.0.0.zip`，得到 `dsh-privacy-shield` 文件夹
   （例如 `C:\Users\你的用户名\Downloads\dsh-privacy-shield`，里面有 `package.json`、`index.js`、`client.js`）。
2. 打开 DSH，在对话里对助手说：

   ```
   帮我安装这个 DSH 插件：用 plugin_manager，action=install_bundle，
   target=C:\Users\你的用户名\Downloads\dsh-privacy-shield
   ```

   `target` 必须是**绝对路径**，并指向包含 `package.json` 的那一层（不是它的上一级，也不是 .zip）。
3. 助手会完成包安装与 bundle 选择。**之后重启一次 DSH 桌面端**（关闭重开），刷新页面。
4. 验证：输入框上方状态条出现「隐私护盾」；在会话里输入 `/shield status`；
   点状态条右侧 ▸ 能看到 设置 / 词表 / 测试台 / 审计 / 候选 五个页签。

## 方式 B：用下载链接安装（适合发到群里）

1. 把 `dsh-privacy-shield-1.0.0.tgz` 上传到任何能**直链下载**的地方（GitHub / Gitee Release、
   对象存储、内网 HTTP 服务器、企业网盘直链等），拿到 `https://...` 链接。
2. 在 DSH 的**插件页**（设置 → 插件）用「安装」输入框粘贴该链接；或者在对话里说：

   ```
   用 plugin_manager 安装插件，action=install_bundle，target=<上面那个 tgz 的直链>
   ```

3. 重启 DSH，按方式 A 第 4 步验证。

> 注意：必须是直链（点开就是文件下载），不能是网页预览页；链接需要对方能访问。

## 方式 C：Git 仓库安装

把插件目录推成仓库（根目录就是 `package.json` / `cordis.patch.yml` 所在的这一层），然后：

```
plugin_manager action=install_bundle target=https://github.com/<you>/dsh-privacy-shield.git
```

需要对方机器有 git 且能访问该仓库；私有仓库还需可用的凭据。装完重启 DSH。

## 方式 D：从插件市场安装（推荐）

本插件已收录进 awesome-dsh-plugin 列表，可直接按仓库名安装（profile 名按实际，桌面版一般是 desktop）：

```
dsh plugin --profile desktop add github:hhl123hhl/dsh-privacy-shield
```

装完重启 DSH，按方式 A 第 4 步验证。

## 方式 E：发布到 npm 后按包名安装（可选，需要你操作）

`dsh-privacy-shield` 这个名字在 npm 上未被占用，需要发布时：

1. `package.json`：确认 `version` 已是待发版本。
2. `npm publish --access public`。
3. 对方安装：

   ```
   plugin_manager action=install_bundle target=dsh-privacy-shield
   ```

## 升级

替换已安装的包必须重启才能加载新的 JavaScript 模块：

1. 先卸载旧版：插件页「已安装」里卸载，或让助手执行 `plugin_manager action=remove_bundle target=dsh-privacy-shield`。
2. 用同一方式安装新版（方式 A/B/C/D 任选）。
3. 重启 DSH，刷新页面。

安装新版后如果状态条右侧出现 `⟳ <版本号>` 徽标，说明 host 已是新版、但浏览器里还是旧界面包，按提示重启 DSH 即可。

## 卸载

- DSH 插件页「已安装」→ 找到 dsh-privacy-shield → 卸载；或让助手执行
  `plugin_manager action=remove_bundle target=dsh-privacy-shield`。
- 无法运行 HMR 的场景：停止 DSH 后执行
  `dsh plugin --profile <profile> remove dsh-privacy-shield`（profile 名一般是 `desktop`）。

## 配置（可选）

默认配置即可用（`enforce` 真改写、HMAC 占位符、全 surface 覆盖）。要加自己公司的专有名词，
在 profile 的 `cordis.patch.yml` 里给 shield 条目加 `terms`，例如：

```yaml
- insert:
    - id: shield
      name: dsh-privacy-shield
      config:
        mode: enforce
        terms:
          - "天枢计划 @project"
          - "昆仑数据库 @company"
```

改完重启 DSH 生效；也可在面板「词表」页临时添加（仅本进程生效）。完整字段见包内 `docs/CONFIG.md`。

## 隐私边界（转发时请一并说明）

- 检测、替换、还原全部在**本机**完成；模型只看到占位符（`<PHONE_xxx>` 这类）。
- 还原表（占位符 ↔ 真值）只在**内存**里，不落盘；审计文件只有计数与标签，不含明文。
- 占位符哈希默认 HMAC-SHA256，密钥文件在本机；`legacy` 模式可被枚举反推，不建议。
- 插件不处理图片内容（无 OCR），图片原样通过；请自行注意截图隐私。
- 插件本身需要读会话文本才能脱敏——请只安装**来源可信**的包，并核对 SHA-256。
- `mode: observe` 只统计不改写（敏感内容仍会明文出境），排障时才用。

## 兼容性

- 零第三方运行时依赖，纯 ESM；DSH 自带 Node 18+ 运行时即可。
- 1.0.0 在 0.3.3 之上开发（123 个测试全绿）；0.3.x 已在 DSH 桌面版实际安装验证，1.0.0 为改名重打包、功能等价。

---

## For recipients (English)

`dsh-privacy-shield` is a DSH bundle plugin (zero runtime dependencies, no build step).

**Option A — local folder (offline):** unzip `dsh-privacy-shield-1.0.0.zip`, then ask your DSH agent:

```
Install this DSH plugin: plugin_manager, action=install_bundle,
target=<absolute path to the unpacked dsh-privacy-shield directory>
```

`target` must be absolute and point at the directory that contains `package.json`. Restart DSH
afterwards, then reload the page.

**Option B — tarball URL:** host `dsh-privacy-shield-1.0.0.tgz` somewhere with a direct download link
and install by URL in the Plugins page, or:

```
plugin_manager action=install_bundle target=https://example.com/dsh-privacy-shield-1.0.0.tgz
```

**Option C — git repository:**

```
plugin_manager action=install_bundle target=https://github.com/<you>/dsh-privacy-shield.git
```

**Option D — plugin market:** `dsh plugin --profile desktop add github:hhl123hhl/dsh-privacy-shield`,
then restart DSH.

**Verify:** a "Privacy Shield" status bar appears above the composer; run `/shield status`; click ▸
for the Settings / Terms / Test bench / Audit / Candidates tabs. Paste a phone number into the Test
bench to see the masked preview.

**Upgrade:** remove the bundle first, install the new version, restart DSH. If a `⟳ <version>`
pill shows up, the host is updated but the browser bundle is stale — restart DSH.

**Privacy:** masking and restoring happen locally; only placeholders reach the model. The restore
table stays in memory. Audit files contain counts and labels only. Images are not inspected.
Only install packages from a trusted source, and verify the SHA-256 in `SHA256SUMS.txt`.
