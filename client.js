// client.js — dsh-privacy-shield 浏览器半边（Web UI half）。
//
// 形态来自官方模板 D:\Kimi\_dsh_ref\tpl\client.js：一个懒工厂，只 require('react')，
// 不使用 JSX（本仓库没有构建步骤，工厂体就是浏览器里跑的纯 JS）。
//
// 数据来源（务必先读 docs/CLIENT-RPC-NOTES.md，仓库内相对路径）：
//   普通 bundle 插件的工厂只收到 `require`，平台 seed 表里没有 `host` 符号
//   （`host.call` 只存在于 cordis-client-runner 给"动态包"注入的闭包中），
//   所以这里走 DSH 公开的通用 RPC 通道：
//     1. 若作用域里真有 `host` 符号（动态包场景）→ 用 host.call(method, …)。
//     2. 否则用 ctx.connection.rpc.call('/shield', method, …)（正常 bundle 场景）。
//     3. 再否则直接 fetch `${origin}/shield/<method>`（host 侧 lib/client-rpc.js 的退化路由）。
//   三条路都不通 → 渲染"状态不可用"，绝不抛错。
//
// UI 结构：composer dock 里的状态条（原有）+ 可展开面板（v0.3.0）：
//   设置（模式/实体）· 词表（增删）· 测试台（本地即时脱敏预览）· 审计（近 N 天计数）·
//   候选（scan-doc/learn 抽取 → 确认采纳）。
// 面板全部通过 RPC 读写，改动只影响 host 进程内状态；持久化仍走 cordis.patch.yml /
// 规则包导出（词表页内有提示）。
//
// 文案：本文件内联一份与 locale/zh.json、locale/en.json 同源的文案表
//   （client 侧 locale 服务由 dsh-client-ui-renderer 从插槽上下文提供，但没有稳定契约
//    让 bundle 插件在 apply 阶段注册/读取它；详见报告"不确定处"）。激活时若插槽上下文
//    给了 `t`，则优先用 `t`，内联表只做兜底。

window.__ModuleLoader__.load({
  id: 'dsh-privacy-shield',
  factory(require) {
    const React = require('react');

    /* @@GENERATED:SHIELD-UI:START@@ */
    // 本区块由 `node tools/sync-client.mjs` 从 locale/*.json + lib/constants.js + package.json 生成。
    // 请勿手改：改文案改 locale/*.json，改协议标签改 lib/constants.js，改版本号改 package.json，然后重跑生成。

    /** 编译期版本（= package.json version）：用于和 host status.version 比对，提示"需重启生效"。 */
    const CLIENT_VERSION = "1.0.0";

    /** 文案表（与 locale/*.json 的 status 段同源；中文为默认语言）。 */
    const COPY = {
      zh: {
        "label": "隐私护盾",
        "enforce": "enforce",
        "observe": "observe",
        "metrics": "{entities} 类实体 · 词表 {terms} 条 · 已脱敏 {masked} 处 · 出境 {requests} 次 / {placeholders} 个占位符 · 违规 {violations}",
        "covered": "本会话受保护",
        "uncovered": "本会话未受保护",
        "toggleOn": "切到 enforce（真改写）",
        "toggleOff": "切到 observe（只统计）",
        "refresh": "刷新状态",
        "loading": "正在读取状态…",
        "unavailable": "状态不可用（host 未连接或已禁用）",
        "error": "状态不可用：{reason}",
        "panelOpen": "打开护盾面板",
        "panelClose": "收起面板",
        "tabSettings": "设置",
        "tabTerms": "词表",
        "tabTest": "测试台",
        "tabAudit": "审计",
        "tabCandidates": "候选",
        "settingsMode": "工作模式",
        "settingsModeHint": "enforce = 送模型前真改写；observe = 只统计不改写（敏感内容将明文出境）。",
        "settingsEntities": "实体识别（勾选生效，立即应用）",
        "settingsSearch": "搜索实体…",
        "settingsSelected": "已启用 {selected}/{total}",
        "settingsInfo": "引擎信息",
        "settingsSurfaces": "覆盖面",
        "settingsHash": "占位符哈希",
        "settingsTerms": "词表",
        "settingsRestore": "已还原",
        "settingsVersion": "插件版本",
        "settingsDiag": "显示诊断徽标",
        "settingsDiagHint": "状态条右侧显示传输通道 / apply 状态（排障用，默认关闭）。",
        "versionMismatch": "插件已升级到 {host}，界面仍是 {client}：请重启 DSH 后刷新页面。",
        "termsAddPlaceholder": "词表行：值 @标签　或　re:正则 @标签",
        "termsAdd": "添加",
        "termsEmpty": "（空词表：可在此添加，或从\"候选\"页确认采纳）",
        "termsPersistHint": "改动仅本进程生效；持久化请写入 cordis.patch.yml 的 terms / termsFile，或导出规则包。",
        "termsCount": "共 {count} 条",
        "termsCategory": "分类",
        "termsHits": "命中",
        "termsSortHint": "按命中次数降序（本次进程内统计）",
        "termsNoHits": "暂无命中统计（尚未发生脱敏）",
        "remove": "删除",
        "testInputPlaceholder": "在此粘贴文本，点击\"脱敏预览\"查看送模型前的样子（只在本机处理，不出境）。",
        "testRun": "脱敏预览",
        "testHits": "命中 {hits} 处：{labels}",
        "testNoHits": "没有命中任何实体/词表。",
        "testReveal": "显示真值对照",
        "testRevealHint": "打开后把每个占位符与原文并排显示（仅本机，默认关闭）。",
        "testPairsTitle": "占位符 ↔ 真值",
        "auditWindow": "统计窗口",
        "auditDays7": "近 7 天",
        "auditDays14": "近 14 天",
        "auditDays30": "近 30 天",
        "auditTotals": "请求 {requests} 次 · 占位符 {placeholders} 个 · 明文残留 {violations} 处 · 会话 {sessions} 个",
        "auditEmpty": "窗口内没有审计记录。",
        "auditNote": "审计只含计数与标签，不含明文。",
        "candidatesPathPlaceholder": "本地文档路径（txt/md/csv/json/代码/docx…）",
        "candidatesScan": "扫描文档",
        "candidatesLearn": "从会话学习",
        "candidatesScanning": "扫描中…",
        "candidatesEmpty": "暂无候选：扫描文档或从会话学习后在此确认。",
        "candidatesHint": "候选只是建议（本地抽取，未出境）；勾选后采纳进词表，立即生效。",
        "candidatesCount": "频次",
        "candidatesSource": "来源",
        "adoptSelected": "采纳所选",
        "adoptAll": "全部采纳",
        "adoptedOk": "已采纳 {adopted} 条（词表现有 {terms} 条）。",
        "busy": "处理中…",
        "actionFailed": "操作失败：{reason}",
        "confirmRemove": "删除这条词表？",
        "modeEnforce": "改写（enforce）",
        "modeObserve": "仅统计（observe）",
        "hashHmac": "HMAC（不可反推）",
        "hashLegacy": "旧版 FNV（可反推）",
        "selectAll": "全选"
      },
      en: {
        "label": "Privacy Shield",
        "enforce": "enforce",
        "observe": "observe",
        "metrics": "{entities} entity types · {terms} terms · {masked} masked · outbound {requests} req / {placeholders} placeholders · violations {violations}",
        "covered": "This session is protected",
        "uncovered": "This session is not protected",
        "toggleOn": "Switch to enforce (rewrite)",
        "toggleOff": "Switch to observe (count only)",
        "refresh": "Refresh status",
        "loading": "Reading status…",
        "unavailable": "Status unavailable (host not connected or disabled)",
        "error": "Status unavailable: {reason}",
        "panelOpen": "Open shield panel",
        "panelClose": "Close panel",
        "tabSettings": "Settings",
        "tabTerms": "Terms",
        "tabTest": "Test bench",
        "tabAudit": "Audit",
        "tabCandidates": "Candidates",
        "settingsMode": "Mode",
        "settingsModeHint": "enforce = rewrite before sending to the model; observe = count only (sensitive text goes out in plaintext).",
        "settingsEntities": "Entity detection (applied immediately)",
        "settingsSearch": "Search entities…",
        "settingsSelected": "Enabled {selected}/{total}",
        "settingsInfo": "Engine",
        "settingsSurfaces": "Surfaces",
        "settingsHash": "Placeholder hash",
        "settingsTerms": "Terms",
        "settingsRestore": "Restored",
        "settingsVersion": "Plugin version",
        "settingsDiag": "Show diagnostics badge",
        "settingsDiagHint": "Show transport / apply status on the status bar (troubleshooting, off by default).",
        "versionMismatch": "Plugin is {host} but the loaded UI is {client}: restart DSH and reload the page.",
        "termsAddPlaceholder": "Term line: value @LABEL or re:regex @LABEL",
        "termsAdd": "Add",
        "termsEmpty": "(Empty vocabulary: add lines here, or adopt from the Candidates tab)",
        "termsPersistHint": "Changes apply to this process only; persist via cordis.patch.yml terms / termsFile, or export a rules pack.",
        "termsCount": "{count} entries",
        "termsCategory": "Categories",
        "termsHits": "hits",
        "termsSortHint": "Sorted by hit count (counted in this process)",
        "termsNoHits": "No hit data yet (nothing masked so far)",
        "remove": "Remove",
        "testInputPlaceholder": "Paste text here and run the preview to see what the model would receive (processed locally, never sent out).",
        "testRun": "Mask preview",
        "testHits": "{hits} hit(s): {labels}",
        "testNoHits": "No entity or term matched.",
        "testReveal": "Show placeholder ↔ value pairs",
        "testRevealHint": "When on, show each placeholder next to the original value (local only, off by default).",
        "testPairsTitle": "Placeholder ↔ value",
        "auditWindow": "Window",
        "auditDays7": "Last 7 days",
        "auditDays14": "Last 14 days",
        "auditDays30": "Last 30 days",
        "auditTotals": "{requests} requests · {placeholders} placeholders · {violations} residue · {sessions} sessions",
        "auditEmpty": "No audit records in this window.",
        "auditNote": "Audit contains counts and labels only, never plaintext.",
        "candidatesPathPlaceholder": "Local document path (txt/md/csv/json/code/docx…)",
        "candidatesScan": "Scan document",
        "candidatesLearn": "Learn from sessions",
        "candidatesScanning": "Scanning…",
        "candidatesEmpty": "No candidates yet: scan a document or learn from sessions, then confirm here.",
        "candidatesHint": "Candidates are local suggestions (never sent out); adopt checked ones into the vocabulary.",
        "candidatesCount": "count",
        "candidatesSource": "source",
        "adoptSelected": "Adopt selected",
        "adoptAll": "Adopt all",
        "adoptedOk": "Adopted {adopted} (vocabulary now has {terms}).",
        "busy": "Working…",
        "actionFailed": "Action failed: {reason}",
        "confirmRemove": "Remove this term?",
        "modeEnforce": "enforce (rewrite)",
        "modeObserve": "observe (count only)",
        "hashHmac": "HMAC (non-reversible)",
        "hashLegacy": "legacy FNV (reversible)",
        "selectAll": "All"
      },
    };

    /** 实体 id → 显示名（28 类）：只影响 UI 文案，协议 id 与占位符标签保持不变。 */
    const ENTITY_NAMES = {
      zh: {
        "phone-cn": "手机号",
        "landline-cn": "固定电话",
        "email": "电子邮箱",
        "id-card-cn": "身份证号",
        "bank-card": "银行卡",
        "uscc": "统一社会信用代码",
        "case-no": "案号",
        "plate-cn": "车牌号",
        "passport-cn": "护照号",
        "wechat": "微信号",
        "qq": "QQ 号",
        "ipv4": "IPv4 地址",
        "ipv6": "IPv6 地址",
        "api-key": "API 密钥",
        "jwt": "JWT 令牌",
        "cn-org": "机构名",
        "cn-project": "项目名",
        "cn-system": "系统名",
        "cn-address": "地址",
        "cn-person": "人名",
        "cn-id": "编号",
        "term": "自定义词条",
        "social-insurance": "社保号",
        "housing-fund": "公积金号",
        "student-id": "学号",
        "medical-record": "病历号",
        "imei": "IMEI 码",
        "mac-address": "MAC 地址"
      },
      en: {
        "phone-cn": "Mobile phone",
        "landline-cn": "Landline",
        "email": "Email",
        "id-card-cn": "ID card",
        "bank-card": "Bank card",
        "uscc": "USCC",
        "case-no": "Case number",
        "plate-cn": "License plate",
        "passport-cn": "Passport",
        "wechat": "WeChat ID",
        "qq": "QQ",
        "ipv4": "IPv4 address",
        "ipv6": "IPv6 address",
        "api-key": "API key",
        "jwt": "JWT token",
        "cn-org": "Organization",
        "cn-project": "Project",
        "cn-system": "System",
        "cn-address": "Address",
        "cn-person": "Person name",
        "cn-id": "ID number",
        "term": "Custom term",
        "social-insurance": "Social insurance",
        "housing-fund": "Housing fund",
        "student-id": "Student ID",
        "medical-record": "Medical record",
        "imei": "IMEI",
        "mac-address": "MAC address"
      },
    };

    /** 实体敏感度分级 → 显示名。 */
    const SENSITIVITY_NAMES = {
      zh: {
        "high": "高敏感",
        "medium": "中敏感",
        "low": "低敏感"
      },
      en: {
        "high": "High",
        "medium": "Medium",
        "low": "Low"
      },
    };

    /** 覆盖面（脱敏分面）→ 显示名，key 与 host 侧 surfaces 配置一致。 */
    const SURFACE_NAMES = {
      zh: {
        "system": "系统",
        "developer": "开发者",
        "user": "用户",
        "assistant": "助手",
        "tool": "工具"
      },
      en: {
        "system": "system",
        "developer": "developer",
        "user": "user",
        "assistant": "assistant",
        "tool": "tool"
      },
    };

    /** 词表分类标签（ORG/PROJ/…）→ 显示名。 */
    const TERM_LABELS = {
      zh: {
        "ORG": "公司/机构",
        "PROJ": "项目",
        "SYS": "系统",
        "IDNO": "编号",
        "ADDR": "地址",
        "PERSON": "人名",
        "TERM": "其他"
      },
      en: {
        "ORG": "Org / company",
        "PROJ": "Project",
        "SYS": "System",
        "IDNO": "ID number",
        "ADDR": "Address",
        "PERSON": "Person",
        "TERM": "Other"
      },
    };

    /** 候选来源（host 返回的中文键）→ 显示名；未知来源原样显示。 */
    const CANDIDATE_SOURCE_NAMES = {
      zh: {
        "后缀词典": "后缀词典",
        "编号模式": "编号模式",
        "会话学习": "会话学习"
      },
      en: {
        "后缀词典": "suffix dictionary",
        "编号模式": "code pattern",
        "会话学习": "session learning"
      },
    };

    /** 占位符标签 → 实体 id（由 lib/constants.js 的 ENTITY_LABELS 反推）。 */
    const LABEL_ENTITY = {
      "PHONE": "phone-cn",
      "TEL": "landline-cn",
      "EMAIL": "email",
      "IDCARD": "id-card-cn",
      "BANKCARD": "bank-card",
      "USCC": "uscc",
      "CASENO": "case-no",
      "PLATE": "plate-cn",
      "PASSPORT": "passport-cn",
      "WECHAT": "wechat",
      "QQ": "qq",
      "IP": "ipv4",
      "IPV6": "ipv6",
      "KEY": "api-key",
      "JWT": "jwt",
      "ORG": "cn-org",
      "PROJ": "cn-project",
      "SYS": "cn-system",
      "ADDR": "cn-address",
      "PERSON": "cn-person",
      "IDNO": "cn-id",
      "TERM": "term",
      "SOCIAL": "social-insurance",
      "HOUSING": "housing-fund",
      "STUDENT": "student-id",
      "MEDICAL": "medical-record",
      "IMEI": "imei",
      "MAC": "mac-address"
    };
    /* @@GENERATED:SHIELD-UI:END@@ */

    /** RPC 通道名（与 host 侧 lib/client-rpc.js 的 RPC_CHANNEL 一致）。 */
    const CHANNEL = '/shield';
    /** 槽位键（已确认可用：conversation-client.js，kind=list, scope=session）。 */
    const SLOT = 'conversation.composer.dock';
    /** 单次取数的超时（毫秒）。 */
    const TIMEOUT_MS = 6000;
    /** 状态轮询间隔（毫秒）。 */
    const POLL_MS = 15000;

    /**
     * 当前 UI 语言（'zh' | 'en'）：优先看 <html lang>（DSH 会按界面语言写它），
     * 再看浏览器语言；都取不到就默认中文（本插件的默认语言）。
     * @returns {'zh'|'en'} 语言代码。
     */
    function uiLang() {
      try {
        if (typeof document !== 'undefined' && document !== null && document.documentElement !== undefined) {
          const docLang = String((document.documentElement && document.documentElement.lang) || '').toLowerCase();
          if (docLang.indexOf('zh') === 0) return 'zh';
          if (docLang.indexOf('en') === 0) return 'en';
        }
      } catch {
        /* 取不到 <html lang> 就看 navigator */
      }
      try {
        const languages = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
        for (const tag of languages) {
          if (typeof tag !== 'string') continue;
          const lower = tag.toLowerCase();
          if (lower.indexOf('zh') === 0) return 'zh';
          if (lower.indexOf('en') === 0) return 'en';
        }
      } catch {
        /* 取不到语言就默认中文 */
      }
      return 'zh';
    }

    /** 取当前语言表。 */
    function copyOf() {
      return COPY[uiLang()] || COPY.zh;
    }

    /** 按当前语言从显示名表取值；查不到回退原 key。 */
    function displayName(table, key) {
      const names = table[uiLang()] || table.zh;
      return Object.prototype.hasOwnProperty.call(names, key) ? names[key] : key;
    }

    /** 实体 id → 可读名（phone-cn → 手机号）。 */
    function entityName(id) { return displayName(ENTITY_NAMES, id); }

    /** 实体分级 → 可读名（high → 高敏感）。 */
    function sensitivityName(level) { return displayName(SENSITIVITY_NAMES, level); }

    /** 分面 key → 可读名（system → 系统）。 */
    function surfaceName(key) { return displayName(SURFACE_NAMES, key); }

    /** 占位符标签 → 可读名（PHONE → 手机号；未知标签原样返回）。 */
    function labelName(label) {
      const id = LABEL_ENTITY[label];
      return id === undefined ? label : entityName(id);
    }

    /** 词表分类标签（ORG/PROJ/…）→ 可读名。 */
    function termLabelName(label) { return displayName(TERM_LABELS, label); }

    /** 词表行里的分类（company/project/…）→ 占位符标签（未知归 TERM）。 */
    function termCategoryLabel(category) {
      const key = String(category || '').toLowerCase();
      const map = {
        company: 'ORG', org: 'ORG', project: 'PROJ', system: 'SYS',
        id: 'IDNO', address: 'ADDR', person: 'PERSON', other: 'TERM',
      };
      return map[key] === undefined ? 'TERM' : map[key];
    }

    /** 词表行 → 分类显示名（`值 @company` → 公司/机构）。 */
    function termLineCategory(line) {
      const match = /\s+@([A-Za-z][A-Za-z0-9_-]{0,15})\s*$/.exec(String(line));
      return termCategoryLabel(match === null ? '' : match[1]);
    }

    /** 词表行 → 值部分（与 termsRemove 使用的 value 对齐）。 */
    function termLineValue(line) {
      let value = String(line).trim();
      const commentAt = value.indexOf(' #');
      if (commentAt !== -1) value = value.slice(0, commentAt).trim();
      const match = /\s+@[A-Za-z][A-Za-z0-9_-]{0,15}\s*$/.exec(value);
      if (match !== null) value = value.slice(0, match.index).trim();
      return value;
    }

    /** 候选来源（host 返回中文键）→ 可读名；未知来源原样显示。 */
    function candidateSourceName(source) {
      const value = String(source === undefined || source === null ? '' : source);
      const names = CANDIDATE_SOURCE_NAMES[uiLang()] || CANDIDATE_SOURCE_NAMES.zh || {};
      return Object.prototype.hasOwnProperty.call(names, value) ? names[value] : value;
    }

    // ---------------- 本地偏好（localStorage，不可用时静默退化） ----------------

    /** 偏好键前缀（避免和其它插件撞名）。 */
    const PREF_PREFIX = 'dsh-privacy-shield.pref.';

    /** 读布尔偏好；storage 不可用（隐私模式/测试环境）时返回默认值。 */
    function prefGet(key, fallback) {
      try {
        const raw = window.localStorage.getItem(PREF_PREFIX + key);
        return raw === null ? fallback : raw === '1';
      } catch {
        return fallback;
      }
    }

    /** 写布尔偏好；失败静默（偏好问题不能影响功能）。 */
    function prefSet(key, value) {
      try {
        window.localStorage.setItem(PREF_PREFIX + key, value ? '1' : '0');
      } catch {
        /* noop */
      }
    }

    /** 极简模板替换（{name} → 值），保留未命中的占位。 */
    function fill(template, params) {
      if (typeof template !== 'string') return '';
      const source = params === null || typeof params !== 'object' ? {} : params;
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(source, name) ? String(source[name]) : match);
    }

    /**
     * 单键取文案：优先用插槽上下文给的 `t`（locale 服务），失败则回退内联表。
     * @param {(key: string, params?: object) => string} t 翻译函数。
     * @param {string} key 文案 key。
     * @param {object} [params] 插值参数。
     * @returns {string} 文案。
     */
    function text(t, key, params) {
      if (typeof t === 'function') {
        try {
          const value = t('status.' + key, params);
          if (typeof value === 'string' && value !== '' && value !== 'status.' + key) return value;
        } catch {
          /* locale 服务抛错时静默回退 */
        }
      }
      const template = copyOf()[key];
      return fill(typeof template === 'string' ? template : key, params);
    }

    /** 发一次请求，供 connection 与 fetch 两条路径共用。 */
    function withTimeout(run) {
      let timer;
      let controller;
      let signal;
      try {
        if (typeof AbortController === 'function') {
          controller = new AbortController();
          signal = controller.signal;
        }
      } catch {
        controller = undefined;
        signal = undefined;
      }
      const guard = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          if (controller !== undefined) {
            try {
              controller.abort();
            } catch {
              /* abort 失败忽略 */
            }
          }
          reject(new Error('timeout'));
        }, TIMEOUT_MS);
      });
      let call;
      try {
        call = Promise.resolve(run(signal));
      } catch (error) {
        call = Promise.reject(error);
      }
      return Promise.race([call, guard]).finally(() => {
        clearTimeout(timer);
      });
    }

    /**
     * 从 host 响应里取出业务结果。
     * 现在两条通道（connection.rpc.call / 手写 fetch）统一返回 unwrap 后的业务值，
     * 兼容三种形状：{ok:true,...}（自家 dispatch 裸返回）、{ok:false,error}、纯值。
     */
    function unwrap(value) {
      if (value !== null && typeof value === 'object' && value.ok === true) return value;
      if (value !== null && typeof value === 'object' && value.ok === false) {
        throw new Error(typeof value.error === 'string' ? value.error : 'host refused');
      }
      return value;
    }

    /** apply() 拿到的 cordis 上下文（官方 client 容器，可能带 connection 服务）。 */
    let applyCtx;
    /** 上次 status 拉取失败的错误文本（变化才记日志，避免刷屏）。 */
    let lastStatusError = null;
    /** status 首次拉取成功的确认日志是否已发。 */
    let statusOkLogged = false;

    /**
     * 调 host RPC。任何同步异常都转成 rejected Promise，
     * 保证调用方（React effect / 事件处理器）永远不会被同步抛错打断。
     * @param {object|undefined} ctx 组件上下文（用它的 connection 服务）。
     * @param {string} method 方法名。
     * @param {object} [payload] 参数。
     * @returns {Promise<object>} 结果对象。
     */
    function callHost(ctx, method, payload) {
      try {
        return callHostInner(ctx, method, payload);
      } catch (error) {
        return Promise.reject(error);
      }
    }

    /** 构造 client-request 信封体。 */
    const rpcEnvelope = (method, payload) => JSON.stringify({
      type: 'client-request',
      rpcId: (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : 'shield-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
      method: method,
      payload: payload === undefined ? null : payload,
    });

    /** 从官方 server-response 信封里取业务值（与 parseConnectionResponse 同规则）。 */
    function readEnvelope(envelope, rpcIdGuess) {
      if (envelope === null || typeof envelope !== 'object' || envelope.type !== 'server-response') {
        throw new Error('非 server-response 信封');
      }
      const result = envelope.result;
      if (result !== null && typeof result === 'object' && result.ok === true) return result.value;
      if (result !== null && typeof result === 'object' && result.ok === false) {
        const message = result.error !== null && typeof result.error === 'object' && typeof result.error.message === 'string'
          ? result.error.message
          : 'host refused';
        throw new Error(message);
      }
      throw new Error('信封 result 不合法');
    }

    /**
     * callHost 的实现体。所有通道统一打 /api/shield 端点（官方 /api 共享通道的
     * 精确 Fetch 路由，自带 admission），请求体一律是 client-request 信封：
     *   {type:'client-request', rpcId, method, payload}
     * 传输优先级：
     *   1. globalThis.__DSH_TRANSPORT__.rpc（若平台提供官方 RPC 客户端）；
     *   2. 平台桥 fetch / 裸 fetch，相对路径 'api/shield'（经 dsh-app:// 转发器
     *      直达宿主 webserver，自动带鉴权 cookie）。
     * @param {object|undefined} ctx 组件上下文（保留兼容，未再使用）。
     * @param {string} method 方法名。
     * @param {object} [payload] 参数。
     * @returns {Promise<object>} 业务结果对象。
     */
    async function callHostInner(ctx, method, payload) {
      let transport;
      try {
        transport = typeof globalThis !== 'undefined' ? globalThis.__DSH_TRANSPORT__ : undefined;
      } catch {
        transport = undefined;
      }

      // 通道 1：平台桥自带 rpc 客户端。
      if (transport !== undefined && transport !== null && typeof transport.rpc === 'object' && transport.rpc !== null && typeof transport.rpc.call === 'function') {
        const result = await withTimeout((signal) => transport.rpc.call(CHANNEL, method, payload === undefined ? null : payload, signal));
        if (result !== null && typeof result === 'object' && result.ok === true) return result.value;
        if (result !== null && typeof result === 'object' && result.ok === false) {
          throw new Error(result.error !== null && typeof result.error === 'object' && typeof result.error.message === 'string'
            ? result.error.message
            : 'host refused');
        }
        return unwrap(result);
      }

      // 通道 2：平台桥 fetch + 手写官方信封（URL 语义与官方一致）。
      const sender = transport !== undefined && transport !== null && typeof transport.fetch === 'function'
        ? (input, init) => transport.fetch(input, init)
        : (input, init) => fetch(input, init);

      const value = await withTimeout(async (signal) => {
        const response = await sender('api/shield', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: rpcEnvelope(method, payload),
          ...(signal === undefined ? {} : { signal: signal }),
        });
        let envelope;
        try {
          envelope = await response.json();
        } catch (error) {
          throw new Error('HTTP ' + response.status + '（非 JSON 应答）');
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return readEnvelope(envelope);
      });
      return unwrap(value);
    }

    /** 当前生效的传输通道名（诊断徽标用）：'rpc' | 'tfetch' | 'raw' | 'none'。 */
    function transportName() {
      let transport;
      try {
        transport = typeof globalThis !== 'undefined' ? globalThis.__DSH_TRANSPORT__ : undefined;
      } catch {
        transport = undefined;
      }
      if (transport?.rpc !== undefined && transport?.rpc !== null && typeof transport.rpc.call === 'function') return 'rpc';
      if (typeof transport?.fetch === 'function') return 'tfetch';
      return typeof fetch === 'function' ? 'raw' : 'none';
    }

    /** 从状态对象里取一个安全数字。 */
    function num(value) {
      return typeof value === 'number' && isFinite(value) ? value : 0;
    }

    /** 展示错误原因的安全字符串。 */
    function errText(error) {
      return error instanceof Error ? error.message : String(error);
    }

    // ---------------- 诊断：错误边界 + client 日志信标 ----------------

    /**
     * 渲染错误边界：子树任何渲染异常都显示成一行错误文本，
     * 而不是让 React 卸掉整个注册（状态条消失）。
     */
    class Guard extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error: errText(error) };
      }
      componentDidCatch(error, info) {
        clientLog('error', 'render: ' + errText(error) + ' @ ' + String(info && info.componentStack).slice(0, 200));
      }
      render() {
        if (this.state.error !== null) {
          return React.createElement('div', {
            'data-dsh-privacy-shield-error': '',
            style: { width: '100%', color: 'var(--dsw-alias-state-error-primary, #c0392b)', fontSize: '12px', padding: '4px' },
          }, 'Shield UI 渲染错误：' + this.state.error);
        }
        return this.props.children;
      }
    }

    /**
     * 客户端诊断日志：本地 console + best-effort 发到 host 的 clientLog 方法
     * （host 追加到 $DSH_HOME/shield/debug-client.jsonl，重启也不丢）。
     * 任何失败都静默——诊断绝不能再制造新错误。
     */
    function clientLog(level, message) {
      try {
        console.log('[dsh-privacy-shield:client]', level, message);
      } catch { /* noop */ }
      // 走 callHost 的真实传输通道（平台桥），不再用裸 fetch（dsh-app:// 页裸 fetch 打不到宿主）。
      try {
        callHost(undefined, 'clientLog', { level: level, message: String(message).slice(0, 500) })
          .catch(() => { /* host 不支持 clientLog 时静默 */ });
      } catch { /* noop */ }
    }

    // ---------------- 通用小组件 ----------------

    /** 面板通用按钮样式。 */
    function btnStyle(primary) {
      return {
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '18px',
        padding: '2px 10px',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))',
        background: primary ? 'var(--dsw-alias-brand-primary, #4d6bfe)' : 'transparent',
        // 深色主题下 --dsw-alias-brand-primary 是近白色（设计令牌里等价于 label-primary），
        // 文字必须用成对的反色令牌，否则就是"白底白字"（选中页签/主按钮不可读的根因）。
        color: primary ? 'var(--dsw-alias-label-primary-inverted, #fff)' : 'var(--dsw-alias-label-secondary, inherit)',
      };
    }

    /** 面板通用输入框样式。 */
    const INPUT_STYLE = {
      font: 'inherit',
      fontSize: '12px',
      padding: '3px 8px',
      borderRadius: 'var(--dsw-radius-sm, 6px)',
      border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))',
      background: 'transparent',
      color: 'inherit',
      minWidth: 0,
    };

    /**
     * 设置页：模式切换、实体勾选、引擎信息。
     * @param {object} props {t, ctx, data, busy, setBusy, onStatus, onError}
     */
    function SettingsTab(props) {
      const t = props.t;
      const data = props.data;
      const entities = Array.isArray(data.entities) ? data.entities : [];
      const catalog = Array.isArray(data.catalog) ? data.catalog : [];
      const [query, setQuery] = React.useState('');
      const hostVersion = data.version === undefined || data.version === null ? null : String(data.version);
      const versionDrift = hostVersion !== null && hostVersion !== CLIENT_VERSION;

      const onEntityToggle = (id, checked) => {
        if (props.busy) return;
        const next = checked ? [...entities, id] : entities.filter((item) => item !== id);
        props.setBusy(true);
        callHost(props.ctx, 'setEntities', { entities: next })
          .then((result) => { props.onStatus(result.snapshot); props.setBusy(false); })
          .catch((error) => { props.onError(errText(error)); props.setBusy(false); });
      };

      const info = [];
      const counts = data.counts === undefined ? {} : data.counts;
      info.push(text(t, 'settingsHash') + ': ' + text(t, data.placeholderHash === 'legacy' ? 'hashLegacy' : 'hashHmac'));
      info.push(text(t, 'settingsVersion') + ': ' + String(hostVersion === null ? '?' : hostVersion));
      info.push(text(t, 'settingsTerms') + ': ' + num(data.terms && data.terms.count));
      info.push(text(t, 'settingsRestore') + ': ' + num(counts.restoredValues));
      if (Array.isArray(data.surfaces && data.surfaces.list)) {
        const sep = uiLang() === 'zh' ? '、' : ', ';
        info.push(text(t, 'settingsSurfaces') + ': ' + data.surfaces.list.map((key) => surfaceName(key)).join(sep));
      }

      // 26 类实体平铺太长：按敏感度分组 + 搜索过滤，分组顺序高→中→低。
      const needle = query.trim().toLowerCase();
      const matchesQuery = (entry) =>
        needle === '' ||
        entityName(entry.id).toLowerCase().indexOf(needle) !== -1 ||
        entry.id.toLowerCase().indexOf(needle) !== -1;
      const groups = ['high', 'medium', 'low'].map((level) => ({
        level,
        entries: catalog.filter((entry) => entry.sensitivity === level && matchesQuery(entry))
          .sort((a, b) => entityName(a.id).localeCompare(entityName(b.id), 'zh')),
      })).filter((group) => group.entries.length > 0);

      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        versionDrift
          ? React.createElement('div', {
              style: {
                padding: '4px 8px', borderRadius: 'var(--dsw-radius-sm, 6px)', fontSize: '12px',
                border: '1px solid var(--dsw-alias-state-warn-primary, #b7791f)',
                color: 'var(--dsw-alias-state-warn-primary, #b7791f)',
              },
            }, text(t, 'versionMismatch', { host: hostVersion, client: CLIENT_VERSION }))
          : null,
        React.createElement('div', null,
          React.createElement('div', { style: { fontWeight: 600, marginBottom: '4px' } }, text(t, 'settingsMode')),
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' } },
            React.createElement('input', {
              type: 'checkbox',
              checked: data.mode === 'enforce',
              disabled: props.busy,
              onChange: (event) => {
                if (props.busy) return;
                const next = event.target.checked ? 'enforce' : 'observe';
                props.setBusy(true);
                callHost(props.ctx, 'setMode', { mode: next })
                  .then((fresh) => { props.onStatus(fresh); props.setBusy(false); })
                  .catch((error) => { props.onError(errText(error)); props.setBusy(false); });
              },
            }),
            React.createElement('span', null, data.mode === 'enforce' ? text(t, 'modeEnforce') : text(t, 'modeObserve')),
          ),
          React.createElement('div', { style: { color: 'var(--dsw-alias-label-tertiary, #999)', marginTop: '2px' } },
            text(t, 'settingsModeHint')),
        ),
        React.createElement('div', null,
          React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' } },
            React.createElement('span', { style: { fontWeight: 600 } }, text(t, 'settingsEntities')),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' } },
              text(t, 'settingsSelected', { selected: entities.length, total: catalog.length })),
          ),
          React.createElement('input', {
            type: 'search',
            value: query,
            'aria-label': text(t, 'settingsSearch'),
            placeholder: text(t, 'settingsSearch'),
            onChange: (event) => setQuery(event.target.value),
            style: { ...INPUT_STYLE, width: '100%', boxSizing: 'border-box', marginBottom: '4px' },
          }),
          groups.length === 0
            ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' } }, text(t, 'termsNoHits'))
            : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                groups.map((group) => React.createElement('div', { key: group.level },
                  React.createElement('div', {
                    style: { fontSize: '11px', fontWeight: 600, color: 'var(--dsw-alias-label-tertiary, #999)' },
                  }, sensitivityName(group.level) + '（' + String(group.entries.length) + '）'),
                  React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px 14px' } },
                    group.entries.map((entry) => React.createElement('label', {
                      key: entry.id,
                      title: entityName(entry.id) + '（' + entry.id + '） · ' + sensitivityName(entry.sensitivity),
                      style: { display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '12px' },
                    },
                      React.createElement('input', {
                        type: 'checkbox',
                        checked: entities.indexOf(entry.id) >= 0,
                        disabled: props.busy,
                        onChange: (event) => onEntityToggle(entry.id, event.target.checked),
                      }),
                      React.createElement('span', null, entityName(entry.id)),
                    )),
                  ),
                )),
              ),
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' } },
            React.createElement('input', {
              type: 'checkbox',
              checked: props.showDiag === true,
              onChange: (event) => { if (typeof props.onShowDiag === 'function') props.onShowDiag(event.target.checked); },
            }),
            React.createElement('span', null, text(t, 'settingsDiag')),
          ),
          React.createElement('div', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' } }, text(t, 'settingsDiagHint')),
        ),
        React.createElement('div', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' } },
          React.createElement('span', { style: { fontWeight: 600, color: 'inherit' } }, text(t, 'settingsInfo') + '：'),
          info.join('　')),
      );
    }

    /**
     * 词表管理页：列表 + 添加 + 删除。
     * @param {object} props {t, ctx, busy, setBusy, onMutated, onError}
     */
    function TermsTab(props) {
      const t = props.t;
      const [terms, setTerms] = React.useState(null);
      const [meta, setMeta] = React.useState({ categories: {}, hits: {} });
      const [draft, setDraft] = React.useState('');
      const [message, setMessage] = React.useState(null);

      const applyResult = (result) => {
        setTerms(Array.isArray(result.terms) ? result.terms : []);
        setMeta({
          categories: result.categories !== null && typeof result.categories === 'object' ? result.categories : {},
          hits: result.hits !== null && typeof result.hits === 'object' ? result.hits : {},
        });
      };

      React.useEffect(() => {
        let alive = true;
        callHost(props.ctx, 'termsList', null)
          .then((result) => { if (alive) applyResult(result); })
          .catch((error) => { if (alive) props.onError(errText(error)); });
        return () => { alive = false; };
      }, [props.epoch]);

      const reload = () => callHost(props.ctx, 'termsList', null)
        .then((result) => applyResult(result))
        .catch((error) => props.onError(errText(error)));

      const onAdd = () => {
        const line = draft.trim();
        if (line === '' || props.busy) return;
        props.setBusy(true);
        setMessage(null);
        callHost(props.ctx, 'termsAdd', { lines: [line] })
          .then((result) => {
            setDraft('');
            setMessage(text(t, 'adoptedOk', { adopted: result.added, terms: result.terms }));
            props.setBusy(false);
            props.onMutated();
            return reload();
          })
          .catch((error) => { props.onError(errText(error)); props.setBusy(false); });
      };

      const onRemove = (value) => {
        if (props.busy) return;
        props.setBusy(true);
        callHost(props.ctx, 'termsRemove', { values: [value] })
          .then(() => { props.setBusy(false); props.onMutated(); return reload(); })
          .catch((error) => { props.onError(errText(error)); props.setBusy(false); });
      };

      // 按命中次数降序；命中数由 host 在本次进程内统计（未脱敏过的词条为 0，再按值排序）。
      const hitOf = (line) => {
        const key = termLineValue(line).normalize('NFKC').toLowerCase();
        return Object.prototype.hasOwnProperty.call(meta.hits, key) ? num(meta.hits[key]) : 0;
      };
      const sortedTerms = terms === null ? [] : terms.slice().sort((a, b) => {
        const delta = hitOf(b) - hitOf(a);
        return delta !== 0 ? delta : termLineValue(a).localeCompare(termLineValue(b), 'zh');
      });
      const categoryChips = terms === null
        ? []
        : Object.keys(meta.categories)
          .map((category) => ({ category, count: num(meta.categories[category]) }))
          .sort((a, b) => b.count - a.count);

      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        React.createElement('div', { style: { display: 'flex', gap: '6px' } },
          React.createElement('input', {
            value: draft,
            disabled: props.busy,
            placeholder: text(t, 'termsAddPlaceholder'),
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') onAdd(); },
            style: { ...INPUT_STYLE, flex: '1 1 auto' },
          }),
          React.createElement('button', { type: 'button', disabled: props.busy, onClick: onAdd, style: btnStyle(true) }, text(t, 'termsAdd')),
        ),
        message !== null ? React.createElement('div', { style: { color: 'var(--dsw-alias-state-success-primary, #2f855a)' } }, message) : null,
        terms === null
          ? React.createElement('div', null, text(t, 'loading'))
          : terms.length === 0
            ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' } }, text(t, 'termsEmpty'))
            : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '160px', overflowY: 'auto' } },
                React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', color: 'var(--dsw-alias-label-tertiary, #999)' } },
                  React.createElement('span', null, text(t, 'termsCount', { count: terms.length })),
                  categoryChips.length === 0
                    ? null
                    : React.createElement('span', null, '· ' + text(t, 'termsCategory') + ':'),
                  categoryChips.map((chip) => React.createElement('span', {
                    key: chip.category,
                    style: {
                      fontSize: '11px', padding: '0 6px', borderRadius: '999px',
                      border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))',
                    },
                  }, termLabelName(termCategoryLabel(chip.category)) + ' ' + String(chip.count))),
                ),
                sortedTerms.map((line, index) => React.createElement('div', {
                  key: line + '#' + index,
                  style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' },
                },
                  React.createElement('code', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, line),
                  React.createElement('span', {
                    style: { flex: 'none', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #999)' },
                    title: termLabelName(termLineCategory(line)) + ' · ' + text(t, 'termsHits'),
                  }, termLabelName(termLineCategory(line)) + (hitOf(line) > 0 ? ' · ' + String(hitOf(line)) : '')),
                  React.createElement('button', {
                    type: 'button',
                    disabled: props.busy,
                    onClick: () => {
                      if (typeof confirm !== 'function' || confirm(text(t, 'confirmRemove'))) onRemove(termLineValue(line));
                    },
                    style: btnStyle(false),
                  }, text(t, 'remove')),
                )),
              ),
        categoryChips.length === 0
          ? null
          : React.createElement('div', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' } }, text(t, 'termsSortHint')),
        React.createElement('div', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' } }, text(t, 'termsPersistHint')),
      );
    }

    /**
     * 测试台：本地即时脱敏预览。
     * @param {object} props {t, ctx, busy, setBusy, onError}
     */
    function TestTab(props) {
      const t = props.t;
      const [input, setInput] = React.useState('');
      const [result, setResult] = React.useState(null);
      // 真值对照默认关（真值只在本地显示；偏好存 localStorage）。
      const [reveal, setReveal] = React.useState(() => prefGet('testReveal', false));

      const onRun = () => {
        if (input.trim() === '' || props.busy) return;
        props.setBusy(true);
        setResult(null);
        callHost(props.ctx, 'testMask', { text: input, reveal: reveal === true })
          .then((out) => { setResult(out); props.setBusy(false); })
          .catch((error) => { props.onError(errText(error)); props.setBusy(false); });
      };

      let summary = null;
      if (result !== null) {
        const sep = uiLang() === 'zh' ? '、' : ', ';
        const labels = Object.keys(result.byLabel || {}).map((k) => labelName(k) + '×' + result.byLabel[k]).join(sep);
        summary = result.hits > 0 ? text(t, 'testHits', { hits: result.hits, labels }) : text(t, 'testNoHits');
      }

      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        React.createElement('textarea', {
          value: input,
          disabled: props.busy,
          rows: 4,
          placeholder: text(t, 'testInputPlaceholder'),
          onChange: (event) => setInput(event.target.value),
          style: { ...INPUT_STYLE, width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' },
        }),
        React.createElement('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
          React.createElement('button', { type: 'button', disabled: props.busy, onClick: onRun, style: btnStyle(true) },
            props.busy ? text(t, 'busy') : text(t, 'testRun')),
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '12px' } },
            React.createElement('input', {
              type: 'checkbox',
              checked: reveal,
              onChange: (event) => { setReveal(event.target.checked); prefSet('testReveal', event.target.checked); },
            }),
            React.createElement('span', null, text(t, 'testReveal')),
          ),
          React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' } }, text(t, 'testRevealHint'))),
        summary !== null
          ? React.createElement('div', { style: { fontSize: '12px' } }, summary)
          : null,
        result !== null && Array.isArray(result.pairs) && result.pairs.length > 0
          ? React.createElement('div', null,
              React.createElement('div', { style: { fontWeight: 600, marginBottom: '2px' } }, text(t, 'testPairsTitle')),
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '120px', overflowY: 'auto' } },
                result.pairs.map((pair, index) => React.createElement('div', {
                  key: String(index),
                  style: { display: 'flex', gap: '8px', fontSize: '12px', whiteSpace: 'nowrap' },
                },
                  React.createElement('code', null, String(labelName(pair.label)) + ' · ' + String(pair.placeholder)),
                  React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary, #999)', overflow: 'hidden', textOverflow: 'ellipsis' } },
                    String(pair.value)),
                ))),
            )
          : null,
        result !== null && result.masked !== undefined
          ? React.createElement('pre', {
              style: {
                margin: 0, padding: '8px', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))',
                borderRadius: 'var(--dsw-radius-sm, 6px)',
                maxHeight: '140px', overflowY: 'auto',
              },
            }, result.masked)
          : null,
      );
    }

    /**
     * 审计页：近 N 天出境计数聚合。
     * @param {object} props {t, ctx, busy, setBusy, onError}
     */
    function AuditTab(props) {
      const t = props.t;
      const [days, setDays] = React.useState(14);
      const [agg, setAgg] = React.useState(null);

      React.useEffect(() => {
        let alive = true;
        setAgg(null);
        callHost(props.ctx, 'auditSummary', { days: days })
          .then((result) => { if (alive) setAgg(result); })
          .catch((error) => { if (alive) props.onError(errText(error)); });
        return () => { alive = false; };
      }, [days, props.epoch]);

      const totals = agg && agg.totals ? agg.totals : null;
      const byDay = agg && Array.isArray(agg.days) ? agg.days : [];
      const maxReq = byDay.reduce((m, d) => Math.max(m, num(d.requests)), 0);

      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          React.createElement('span', null, text(t, 'auditWindow') + ':'),
          [[7, text(t, 'auditDays7')], [14, text(t, 'auditDays14')], [30, text(t, 'auditDays30')]].map(([value, label]) =>
            React.createElement('label', { key: value, style: { display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer' } },
              React.createElement('input', { type: 'radio', checked: days === value, onChange: () => setDays(value) }),
              React.createElement('span', null, label))),
        ),
        agg === null
          ? React.createElement('div', null, text(t, 'loading'))
          : React.createElement('div', null,
              React.createElement('div', { style: { fontSize: '12px' } },
                text(t, 'auditTotals', {
                  requests: totals ? num(totals.requests) : 0,
                  placeholders: totals ? num(totals.placeholders) : 0,
                  violations: totals ? num(totals.violations) : 0,
                  sessions: totals ? num(totals.sessions) : 0,
                })),
              byDay.length === 0
                ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' } }, text(t, 'auditEmpty'))
                : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '150px', overflowY: 'auto' } },
                    byDay.map((d) => React.createElement('div', { key: d.day, style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' } },
                      React.createElement('span', { style: { flex: 'none', width: '88px' } }, d.day),
                      React.createElement('span', {
                        style: {
                          flex: 'none',
                          width: Math.max(2, Math.round((num(d.requests) / Math.max(1, maxReq)) * 120)) + 'px',
                          height: '8px',
                          borderRadius: '4px',
                          // 深色主题下 brand-primary 近似白色，纯色块要用语义强调色才是"看得见的蓝"。
                          background: 'var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4d6bfe)',
                          opacity: 0.75,
                        },
                      }),
                      React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' } },
                        String(num(d.requests)) + ' · ' + String(num(d.placeholders))),
                    )),
                  ),
            ),
        React.createElement('div', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' } }, text(t, 'auditNote')),
      );
    }

    /**
     * 候选页：scan-doc / learn → 勾选 → adopt。
     * @param {object} props {t, ctx, busy, setBusy, onMutated, onError}
     */
    function CandidatesTab(props) {
      const t = props.t;
      const [path, setPath] = React.useState('');
      const [candidates, setCandidates] = React.useState(null);
      const [checked, setChecked] = React.useState({});
      const [message, setMessage] = React.useState(null);

      const run = (method, payload) => {
        if (props.busy) return;
        props.setBusy(true);
        setMessage(null);
        callHost(props.ctx, method, payload)
          .then((result) => {
            setCandidates(Array.isArray(result.candidates) ? result.candidates : []);
            setChecked({});
            props.setBusy(false);
          })
          .catch((error) => { props.onError(errText(error)); props.setBusy(false); });
      };

      const onAdopt = (ids) => {
        if (props.busy || ids.length === 0) return;
        props.setBusy(true);
        setMessage(null);
        callHost(props.ctx, 'adopt', { ids: ids })
          .then((result) => {
            setMessage(text(t, 'adoptedOk', { adopted: result.adopted, terms: result.terms }));
            setCandidates(null);
            props.setBusy(false);
            props.onMutated();
          })
          .catch((error) => { props.onError(errText(error)); props.setBusy(false); });
      };

      const list = candidates === null ? [] : candidates;
      const picked = list.map((c, i) => (checked[i] === true ? String(i + 1) : null)).filter((x) => x !== null);
      const allChecked = list.length > 0 && list.every((_, i) => checked[i] === true);

      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        React.createElement('div', { style: { display: 'flex', gap: '6px' } },
          React.createElement('input', {
            value: path,
            disabled: props.busy,
            placeholder: text(t, 'candidatesPathPlaceholder'),
            onChange: (event) => setPath(event.target.value),
            style: { ...INPUT_STYLE, flex: '1 1 auto' },
          }),
          React.createElement('button', {
            type: 'button',
            disabled: props.busy || path.trim() === '',
            onClick: () => run('scanDoc', { path: path.trim() }),
            style: btnStyle(false),
          }, props.busy ? text(t, 'busy') : text(t, 'candidatesScan')),
          React.createElement('button', {
            type: 'button',
            disabled: props.busy,
            onClick: () => run('learn', null),
            style: btnStyle(false),
          }, text(t, 'candidatesLearn')),
        ),
        candidates === null
          ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' } }, text(t, 'candidatesEmpty'))
          : list.length === 0
            ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' } }, text(t, 'candidatesEmpty'))
            : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '170px', overflowY: 'auto' } },
                React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '12px' } },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: allChecked,
                    onChange: (event) => {
                      const next = {};
                      list.forEach((_, i) => { next[i] = event.target.checked; });
                      setChecked(next);
                    },
                  }),
                  React.createElement('span', null, text(t, 'selectAll') + '（' + String(list.length) + '）'),
                ),
                list.map((c, i) => React.createElement('label', {
                  key: String(i) + ':' + c.value,
                  style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' },
                },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: checked[i] === true,
                    onChange: (event) => setChecked((prev) => ({ ...prev, [i]: event.target.checked })),
                  }),
                  React.createElement('code', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.value),
                  React.createElement('span', { style: { flex: 'none', color: 'var(--dsw-alias-label-tertiary, #999)' } },
                    '@' + String(labelName(c.label)) + ' · ' + text(t, 'candidatesCount') + ' ' + String(num(c.count)) + ' · ' + candidateSourceName(c.source)),
                )),
              ),
        candidates !== null && list.length > 0
          ? React.createElement('div', { style: { display: 'flex', gap: '6px' } },
              React.createElement('button', {
                type: 'button',
                disabled: props.busy || picked.length === 0,
                onClick: () => onAdopt(picked),
                style: btnStyle(true),
              }, text(t, 'adoptSelected') + (picked.length > 0 ? '（' + String(picked.length) + '）' : '')),
              React.createElement('button', {
                type: 'button',
                disabled: props.busy,
                onClick: () => onAdopt(['all']),
                style: btnStyle(false),
              }, text(t, 'adoptAll')),
            )
          : null,
        message !== null
          ? React.createElement('div', { style: { color: 'var(--dsw-alias-state-success-primary, #2f855a)' } }, message)
          : null,
        React.createElement('div', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' } }, text(t, 'candidatesHint')),
      );
    }

    const TABS = [
      ['settings', 'tabSettings', SettingsTab],
      ['terms', 'tabTerms', TermsTab],
      ['test', 'tabTest', TestTab],
      ['audit', 'tabAudit', AuditTab],
      ['candidates', 'tabCandidates', CandidatesTab],
    ];

    /**
     * 可展开面板：设置/词表/测试台/审计/候选。
     * @param {object} props {t, ctx, data, onStatus}
     */
    function ShieldPanel(props) {
      const t = props.t;
      const [tab, setTab] = React.useState('settings');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [epoch, setEpoch] = React.useState(0);

      const onError = (reason) => setError(text(t, 'actionFailed', { reason: reason }));
      const onMutated = () => { setError(null); setEpoch((v) => v + 1); };

      const active = TABS.find((item) => item[0] === tab) || TABS[0];
      const Body = active[2];
      const bodyProps = {
        t: t,
        ctx: props.ctx,
        data: props.data,
        busy: busy,
        setBusy: setBusy,
        onError: onError,
        epoch: epoch,
        onMutated: onMutated,
        onStatus: (fresh) => { setError(null); props.onStatus(fresh); },
        showDiag: props.showDiag === true,
        onShowDiag: typeof props.onShowDiag === 'function' ? props.onShowDiag : () => {},
      };

      return React.createElement('div', {
        'data-dsh-privacy-shield-panel': tab,
        style: {
          boxSizing: 'border-box',
          width: '100%',
          flexBasis: '100%',
          borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25))',
          padding: '8px 4px 4px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          fontSize: '12px',
          maxHeight: '340px',
          overflowY: 'auto',
        },
      },
        // 等宽分段控件：窄屏不换行，5 个页签始终等分。
        React.createElement('div', {
          role: 'tablist',
          'aria-label': text(t, 'label'),
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(' + String(TABS.length) + ', minmax(0, 1fr))',
            gap: '2px',
            padding: '2px',
            borderRadius: 'var(--dsw-radius-sm, 6px)',
            border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))',
          },
        },
          TABS.map(([id, key]) => React.createElement('button', {
            key: id,
            type: 'button',
            role: 'tab',
            'aria-selected': id === tab,
            title: text(t, key),
            onClick: () => { setTab(id); setError(null); },
            style: {
              ...btnStyle(id === tab),
              border: 'none',
              padding: '2px 2px',
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontWeight: id === tab ? 600 : 400,
            },
          }, text(t, key))),
        ),
        error !== null
          ? React.createElement('div', { style: { color: 'var(--dsw-alias-state-error-primary, #c53030)' } }, error)
          : null,
        React.createElement(Body, bodyProps),
      );
    }

    /** 状态条：展示 + 模式切换 + 面板开关。 */
    function ShieldStatusBar(props) {
      const t = props === null || props === undefined ? undefined : props.t;
      const [state, setState] = React.useState({ phase: 'loading', data: null, error: null, busy: false, open: false });
      // 诊断徽标默认隐藏（普通用户不需要）；设置页开关，偏好存 localStorage。
      const [showDiag, setShowDiag] = React.useState(() => prefGet('diagnostics', false));
      const setDiagPref = (value) => {
        setShowDiag(value === true);
        prefSet('diagnostics', value === true);
      };

      React.useEffect(() => {
        let alive = true;
        const tick = () => {
          let pending;
          try {
            pending = callHost(props, 'status');
          } catch (error) {
            pending = Promise.reject(error);
          }
          pending
            .then((data) => {
              if (!alive) return;
              if (statusOkLogged === false) {
                statusOkLogged = true;
                clientLog('info', 'status ok via 通道 ' + transportName());
              }
              lastStatusError = null;
              setState((prev) => ({ ...prev, phase: 'ready', data: data, error: null }));
            })
            .catch((error) => {
              if (!alive) return;
              const reason = errText(error);
              if (lastStatusError !== reason) {
                lastStatusError = reason;
                clientLog('error', 'status fetch failed: ' + reason + '（通道 ' + transportName() + '）');
              }
              setState((prev) => ({
                ...prev,
                phase: prev.data === null ? 'error' : 'ready',
                data: prev.data,
                error: reason,
              }));
            });
        };
        tick();
        const timer = setInterval(tick, POLL_MS);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, []);

      const data = state.data;
      const onToggle = () => {
        if (data === null || data === undefined || state.busy) return;
        const next = data.mode === 'enforce' ? 'observe' : 'enforce';
        setState((prev) => ({ ...prev, busy: true }));
        callHost(props, 'setMode', { mode: next })
          .then((fresh) => setState((prev) => ({ ...prev, busy: false, data: fresh, error: null })))
          .catch((error) => setState((prev) => ({ ...prev, busy: false, error: errText(error) })));
      };

      const enforce = data !== null && data !== undefined && data.mode === 'enforce';
      // 状态点/模式文字是纯色前景强调：用语义强调色（浅色 #4176e6 / 深色 #5686fe），
      // 不要用 brand-primary（深色主题下它近似白色，等于看不见）。
      const accent = enforce
        ? 'var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4d6bfe)'
        : 'var(--dsw-alias-state-warn-primary, #b7791f)';
      const hostVersion = data !== null && data !== undefined && data.version !== undefined ? String(data.version) : null;
      const versionDrift = hostVersion !== null && hostVersion !== CLIENT_VERSION;

      let summary;
      if (data !== null && data !== undefined) {
        const counts = data.counts === undefined ? {} : data.counts;
        const terms = data.terms === undefined ? {} : data.terms;
        summary = text(t, 'metrics', {
          entities: Array.isArray(data.entities) ? data.entities.length : num(data.entities),
          terms: num(terms.count),
          masked: num(counts.maskedTexts),
          requests: num(counts.outboundRequests),
          placeholders: num(counts.outboundPlaceholders),
          violations: num(counts.violations),
        });
      } else if (state.phase === 'error') {
        summary = text(t, 'error', { reason: state.error === null ? 'unknown' : state.error });
      } else {
        summary = text(t, 'loading');
      }

      const children = [
        React.createElement('span', {
          key: 'dot',
          'aria-hidden': true,
          style: {
            width: '8px', height: '8px', borderRadius: '50%', flex: 'none',
            background: data === null || data === undefined ? 'var(--dsw-alias-label-tertiary, #999)' : accent,
          },
        }),
        React.createElement('span', { key: 'label', style: { fontWeight: 500, flex: 'none' } }, text(t, 'label')),
        React.createElement('span', { key: 'mode', style: { flex: 'none', color: accent } }, enforce ? text(t, 'modeEnforce') : text(t, 'modeObserve')),
        React.createElement('span', {
          key: 'metrics',
          style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, summary),
      ];

      if (data !== null && data !== undefined && data.session !== undefined) {
        const allowed = data.session.allowed === true;
        children.push(React.createElement('span', {
          key: 'session',
          title: allowed ? text(t, 'covered') : text(t, 'uncovered'),
          style: { flex: 'none', color: allowed ? 'inherit' : 'var(--dsw-alias-label-tertiary, #999)' },
        }, allowed ? text(t, 'covered') : text(t, 'uncovered')));
      }

      if (versionDrift) {
        // 升级后 client bundle 需随 profile 重启才更新：明确提示，避免用户以为是旧功能。
        children.push(React.createElement('span', {
          key: 'version-drift',
          title: text(t, 'versionMismatch', { host: hostVersion, client: CLIENT_VERSION }),
          style: {
            flex: 'none', fontSize: '11px', padding: '0 6px', borderRadius: '999px',
            border: '1px solid var(--dsw-alias-state-warn-primary, #b7791f)',
            color: 'var(--dsw-alias-state-warn-primary, #b7791f)',
          },
        }, '⟳ ' + String(hostVersion)));
      }

      children.push(React.createElement('button', {
        key: 'toggle',
        type: 'button',
        disabled: data === null || data === undefined || state.busy === true,
        onClick: onToggle,
        title: enforce ? text(t, 'toggleOff') : text(t, 'toggleOn'),
        style: {
          flex: 'none',
          cursor: data === null || data === undefined ? 'default' : 'pointer',
          font: 'inherit',
          lineHeight: '18px',
          padding: '0 8px',
          borderRadius: 'var(--dsw-radius-sm, 6px)',
          border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))',
          background: 'transparent',
          color: 'var(--dsw-alias-label-secondary, inherit)',
        },
      }, enforce ? text(t, 'toggleOn') : text(t, 'toggleOff')));

      children.push(React.createElement('button', {
        key: 'panel-toggle',
        type: 'button',
        onClick: () => setState((prev) => ({ ...prev, open: !prev.open })),
        title: state.open ? text(t, 'panelClose') : text(t, 'panelOpen'),
        style: {
          flex: 'none',
          cursor: 'pointer',
          font: 'inherit',
          lineHeight: '18px',
          padding: '0 8px',
          borderRadius: 'var(--dsw-radius-sm, 6px)',
          border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))',
          background: state.open ? 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))' : 'transparent',
          color: 'var(--dsw-alias-label-secondary, inherit)',
        },
      }, state.open ? '▾' : '▸'));

      // 诊断徽标：只有"设置 → 显示诊断徽标"打开时才渲染（默认隐藏，避免噪音）。
      if (showDiag) {
        children.push(React.createElement('span', {
          key: 'diag',
          title: 'dsh-privacy-shield 诊断：传输通道 / apply 是否执行',
          style: { flex: 'none', fontSize: '10px', color: 'var(--dsw-alias-label-tertiary, #999)' },
        }, '⇄' + transportName() + (applyCtx !== undefined ? '+a' : '-a')));
      }

      if (state.open) {
        if (data !== null && data !== undefined) {
          children.push(React.createElement(Guard, { key: 'panel' },
            React.createElement(ShieldPanel, {
              t: t,
              ctx: props,
              data: data,
              showDiag: showDiag,
              onShowDiag: setDiagPref,
              onStatus: (fresh) => setState((prev) => ({ ...prev, data: fresh, error: null })),
            })));
        } else {
          // host 连不上时也允许展开，直接说明原因（不再"点了没反应"）。
          children.push(React.createElement('div', {
            key: 'panel-unavailable',
            style: { width: '100%', fontSize: '12px', padding: '6px 4px', color: 'var(--dsw-alias-state-warn-primary, #b7791f)' },
          }, state.phase === 'error'
            ? text(t, 'error', { reason: state.error === null ? 'unknown' : state.error })
            : text(t, 'loading')));
        }
      }

      return React.createElement(Guard, null, React.createElement('div', {
        'data-dsh-privacy-shield': data === null || data === undefined ? 'unknown' : data.mode,
        style: {
          boxSizing: 'border-box',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px',
          fontSize: '12px',
          lineHeight: '20px',
          padding: '2px 4px',
          color: 'var(--dsw-alias-label-secondary, #666)',
        },
      }, children));
    }

    /** 插件级样式（用 activate 里的 effect 注入，卸载时移除）。 */
    const CSS = [
      'div[data-dsh-privacy-shield] button:hover:enabled { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }',
      'div[data-dsh-privacy-shield] button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4d6bfe); outline-offset: 1px; }',
      'div[data-dsh-privacy-shield-panel] button:hover:enabled { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }',
      'div[data-dsh-privacy-shield-panel] button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4d6bfe); outline-offset: 1px; }',
      'div[data-dsh-privacy-shield-panel] input[type="checkbox"], div[data-dsh-privacy-shield-panel] input[type="radio"] { accent-color: var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4d6bfe); }',
    ].join('\n');

    return {
      inject: ['slots'],
      apply(ctx) {
        // 注意：apply 里任何同步抛错都会让整个 bundle 条目激活失败（DSH 直接拒绝启动）。
        // 所以这里逐段防御，绝不让异常逃出 apply。
        try {
          // 捕获官方 cordis 上下文：callHost 优先用 ctx.connection.rpc（官方 RPC 客户端）。
          // 注意 cordis 上下文对未知服务的属性访问可能抛错，探测必须包在 try 里。
          applyCtx = ctx;
          let hasConnection = false;
          try {
            hasConnection = typeof ctx.get === 'function'
              ? ctx.get('connection') !== undefined
              : ctx.connection !== undefined;
          } catch { /* 探测失败按无 connection 处理 */ }
          clientLog('info', 'apply() called; connection=' + (hasConnection ? 'yes' : 'no'));
        } catch (error) {
          console.error('[dsh-privacy-shield] apply init skipped:', error);
        }

        // 全局错误监听：未捕获异常/未处理 Promise 拒绝都记到 client 诊断日志。
        try {
          if (typeof window !== 'undefined') {
            window.addEventListener('error', (event) => {
              clientLog('error', 'window.onerror: ' + String(event.message).slice(0, 300));
            });
            window.addEventListener('unhandledrejection', (event) => {
              const reason = event.reason;
              clientLog('error', 'unhandledrejection: ' + (reason instanceof Error ? reason.message : String(reason)).slice(0, 300));
            });
          }
        } catch (error) {
          console.error('[dsh-privacy-shield] diagnostic listeners skipped:', error);
        }

        // 样式：统一挂到 <head>，只在 apply 内注册，返回清理函数（不追加到 document.body）。
        try {
          if (typeof document !== 'undefined') {
            ctx.effect(() => {
              const tag = document.createElement('style');
              tag.dataset.dshShield = 'dsh-privacy-shield';
              tag.textContent = CSS;
              document.head.appendChild(tag);
              return () => {
                if (tag.parentNode !== null) tag.parentNode.removeChild(tag);
              };
            }, 'dsh-privacy-shield:ui-styles');
          }
        } catch (error) {
          console.error('[dsh-privacy-shield] style injection skipped:', error);
        }

        // 组件注册：唯一需要的槽位。
        try {
          ctx.slots.inject(SLOT, () => ctx.slots.register({
            name: SLOT,
            id: 'shield-status',
            order: 30,
          }, ShieldStatusBar));
          console.log('[dsh-privacy-shield] status bar registered into ' + SLOT);
        } catch (error) {
          console.error('[dsh-privacy-shield] slot registration failed:', error);
        }
      },
    };
  },
});
