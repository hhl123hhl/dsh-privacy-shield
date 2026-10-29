# dsh-privacy-shield v1.0.1 发布说明

日期：2026-10-21　｜　上一版：v1.0.0

本版是**修复版**，无新功能、无破坏性变更；规则包（`dsh-shield.rules/v1`）、加密包文件头（`DSH-SHIELD-ENC/v1`）、数据目录（`$DSH_HOME/shield/`）、插件 id（`shield`）与 `/shield` 命令全部不变。

## 修了什么

### 1. 流式输出把占位符切成两半（真值丢失）

模型有时把占位符开头的 `<` 单独作为一个 chunk 吐出来（DeepSeek 线上实况）。旧实现的"半截占位符"判定只认 `<` 后面已经跟了大写字母的尾串，裸 `<` 被判为普通尖括号文本**立即放行**——占位符从此被切成两段，后续 chunk 再也拼不回来，展示层就少了一段真值。

现把裸 `<` 也纳入扣留；普通尖括号文本（如 `<world`）仍即时放行，不引入额外延迟。

复现：KTest 平台按 1/3/7/16 字符粒度切片，P0 探针稳定复现。

### 2. 模型改写占位符形态后不还原

模型偶发改写占位符（`<phone_ab12cd34>`、`<PHONE …>`、分隔符变 `-` 或空格）。精确正则漏匹配 → 用户看到的是占位符而不是真值。

`restoreText` 与 `StreamRestorer.restore` 改为两遍：先精确匹配，再把 label 归一为大写、hash 归一为小写后查表；查不到就原样保留。不同真值的 HMAC 哈希不同，归一化只折叠大小写与分隔符，**不会串还原到别的实体**。

### 3. 构建脚本在 Node v25.4.0（Windows）上崩溃

`fs.cpSync(..., { recursive: true })` 复制本仓库 `lib/` 时会以 `0xC0000409` 直接崩溃（不抛异常、不可 catch）。改为手写遍历 + `copyFileSync`，行为可预测。

### 4. 版本号变更后 client.js 未重生成

`client.js` 的 `CLIENT_VERSION` 由 `tools/sync-client.mjs` 从 `package.json` 生成。1.0.1 只改了版本号未重跑生成器，界面版本比对会误报"需重启"。`npm run dist` 现在先跑生成器，再打包；随包测试会拦截此类漂移。

## 验证

- 单测：134/134 通过（源码目录与随包副本各跑一遍）。
- 分发包：`release/dsh-privacy-shield/`（51 个文件）、`dsh-privacy-shield-1.0.1.zip`、`dsh-privacy-shield-1.0.1.tgz`。
- 已装副本：`~/.dsh/profiles/desktop/node_modules/dsh-privacy-shield` 与构建产物 51/51 文件 SHA256 全等，版本 1.0.1。

## 升级方式

- 本机：已同步到 desktop profile，**重启 DeepSeek Harness 后生效**（插件在 profile 启动时注册，不支持热更）。
- 他人：`dsh plugin add github:hhl123hhl/dsh-privacy-shield`，或把 `.tgz` / `.zip` 解压后交给插件页安装（target 指向目录或 tarball）。
