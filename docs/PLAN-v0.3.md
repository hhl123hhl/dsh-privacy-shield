# dsh-privacy-shield v0.3.0 实施规划

> 状态：已获用户确认（2026-10-13），开工。范围：三梯队全做，图片 OCR 不做（改为明确提示）。

## 总目标

从"脱敏工具"进化为"隐私防线系统"。版本号 0.3.0。基于已验证的 derive 补丁架构（v0.2.1）演进，
不动 `lib/derive-patch.js` 的核心机制。

## 里程碑

### M1 引擎与词表增强（基础层）
- **HMAC 占位符**：`lib/crypto.js`（node:crypto，AES/SM 不可用就用 HMAC-SHA256）；密钥存
  `$DSH_HOME/shield/placeholder.key`（首用生成，chmod 600 尽力而为）；读不到则用进程内存随机密钥（重启后
  占位符变化，记入警告）。配置 `placeholderHash: 'hmac'|'legacy'`（默认 hmac，可回退）。
  兼容：vault 记录真值时同时登记 legacy(FNV) 占位符别名，跨版本还原旧消息占位符。
- **正则词表项**：词表行 `re:<正则> @标签`；编译期校验、数量上限、在归一化检索文本上跑 matchAll。
- **词表治理**：`termsVersion`（每次 replaceTerms +1，status/rules 可见）；导入合并输出
  added/duplicates 预览；`/shield terms label <off|on> <LABEL>` 按标签批量启停（引擎编译期过滤）。
- **新实体**：社保号(social-insurance)、公积金号(housing-fund)、学号(student-id)、病历号(medical-record)、
  IMEI(imei)、MAC 地址(mac-address)；银行卡加 Luhn 校验；`addressLevel: 'full'|'street'`
  （cn-address 保留到街道/路，抹掉门牌）。
- **敏感度分级**：实体分 high/medium/low；`minLevel` 配置（默认 low=全检）。

验收：M1 单测全绿；旧占位符别名还原通过；61 项旧测试保持绿（除刻意变更外）。

### M2 审计持久化与查询
- 审计 JSONL 默认落盘（`audit.jsonl` 默认改 true；新增 `audit.retentionDays` 清理策略）。
- 审计行扩展：模式、实体数、词表版本、handBuilt 标记、sessionId（已有）。
- `/shield audit [天数]`：按天聚合的占位符/请求/残留趋势；`/shield audit export <路径>` 出 CSV。
- `/shield report`：体检摘要（模式/词表覆盖度/残留趋势/配置打分）。
- 敏感操作确认：enforce 切换、import replace、export --encrypt 要求 `confirm` 尾参。
- 旁路通道探查：验证 compaction/embedding/title 请求是否过 llm/stream（grep 宿主源码），
  结论写进 DESIGN-NOTES。

### M3 文件内容脱敏 + 手搓请求诚实化
- **文本文件块脱敏**：`file` 块携带文本内容（txt/md/csv/json/log/code 等）时用引擎改写后再出境；
  二进制/未知类型放行；mediaPolicy 语义不变（仍无 strip）。
- **图片提示**：status/文档/UI 明确"本插件不负责图片内容的隐私保护"。
- **queue 模式结论**：冻结 options 无法在发送前改写（v0.2.1 已证），queue 不可行 → 不实现，
  在 DESIGN-NOTES 记录验证过程与理由；onUnmaskable 保持 warn/block。

### M4 智能词表
- `lib/scan-doc.js`：`/shield scan-doc <路径>` 本地抽取候选专名。
  - 支持：txt/md/csv/tsv/json/log/xml/html/yaml/常见代码扩展名；docx 用迷你 unzip（node:zlib
    手写中央目录解析）+ XML 标签剥离；pdf 提示先转文本。
  - 抽取：已知后缀词典（公司/集团/项目/系统/平台/工程/中心/实验室/医院/大学/银行…）+
    编号模式 + 词频统计；现有引擎跑一遍剔除已覆盖项。
  - 输出候选表（序号/候选词/频次/建议标签/来源），不落词表。
- 确认流：`/shield terms adopt <序号…>` 或 `adopt all`；scan 结果存内存候选池（30 分钟过期）。
- `lib/learn.js`：`/shield learn [天数]` 扫描本地会话日志（zstd 帧解码复用 decode 逻辑），
  找高频未命中片段推荐入候选池；全程本地。
- Web UI 确认界面（M5 复用候选池 RPC）。

### M5 可交互 Web UI
- client-rpc 新方法：`setEntities`、`termsAdd/termsRemove/termsList`、`testMask`、`scanDoc/adopt`、
  `auditSummary`、`pause`。
- client.js：设置页（模式/实体/surfaces/分级）、词表管理页、测试台（本地即时脱敏预览）、
  审计小图（近 14 天计数）、scan-doc 确认列表。
- 还原可视化标记：先探 DSH 渲染层（assistant 消息能否加内联标记），不可行则在 DESIGN-NOTES
  记录并改为"回复脚注计数"（status 里显示上轮还原次数）。

### M6 规则包加密 + 运维命令
- export `--encrypt <口令>`：AES-256-GCM + scrypt 派生；文件头 `DSH-SHIELD-ENC/v1`；
  import 自动识别、口令错误给明确提示；加密包同样拒绝 vault 字段（解密后校验）。
- `/shield pause <分钟>`：临时放行定时自动恢复（内存计时器 + status 显示剩余）。
- `/shield doctor`：逐项检查（补丁已装/模式/词表为空警告/审计落盘/密钥可用/版本），输出 ✅/⚠️。

### M7 热更新与收尾
- termsFile/词表热重载：fs.watch 变化 → replaceTerms + 提示；配置热更新探查（cordis 是否支持
  re-apply），不支持则文档说明 + 保持重启要求。
- 版本升 0.3.0；全套测试；文档同步（README×2、CONFIG、SECURITY、COMPLIANCE、DESIGN-NOTES、CHANGELOG）；
  打包 dist（zip/tgz）+ 校验；同步已装副本；端到端实机验证；清理临时文件。

## 硬约束

- 零外部依赖（node: 内置模块 only），dist 自包含。
- 所有新命令/功能遵守"渲染层不回显明文"。
- 每里程碑跑 `node --test "test/*.test.mjs"`；改 derive 语义必须跑 `_tmp/probe-e2e-offline.mjs`。
- 不动 `lib/derive-patch.js` 的宿主契约封装，除非里程碑内明确列出。
