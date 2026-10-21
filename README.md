# dsh-privacy-shield

Local-first privacy shield for DeepSeek Harness (DSH).

Keep plaintext on your machine. Send only placeholders to the model. See real values again
in your transcript.

**Version 1.0.0** · zero third-party runtime dependencies · pure ESM · Node.js 18+

---

## What it does

DSH keeps two different records of a conversation:

| Surface | What it is | Who reads it |
|---|---|---|
| **Model-visible surface** | the messages the request is built from | the model (outbound to the cloud) |
| **Human-record surface** | the original committed session events | the chat UI and local session logs |

`dsh-privacy-shield` replaces sensitive text **only in the model-visible copy**, with deterministic
placeholders of the form `<LABEL_8hexdigits>`. Your local session logs, the chat interface, and
tool execution keep the real values. When the model replies, the response stream is wrapped and
placeholders are restored — including placeholders split across stream chunks — so the assistant
message is persisted and displayed with real values.

```
What you type:      Call 张三 at 13800138000 about 京A12345.
What the model      Call <PERSON_1a2b3c4d> at <PHONE_9f8e7d6c> about <PLATE_0a1b2c3d>.
  sees:
What you see        Call 张三 at 13800138000 about 京A12345.
  in the UI:
```

## Features

- **Model-visible masking only** — a defensive patch over `Session.deriveEventMessage`
  rewrites the five surfaces (system, developer, user, assistant, tool result) as the
  model-visible copy is derived; the human-record surface is never rewritten.
- **HMAC placeholders (default)** — `<LABEL_8hex>` = first 4 bytes of
  HMAC-SHA256(label, value); the key lives in a local file (`$DSH_HOME/shield/.placeholder.key`)
  and cannot be enumerated. `placeholderHash: legacy` keeps the old FNV-1a format.
- **Response restoration** — wraps `llm/stream` and restores `text-delta`, `reasoning-delta`,
  `tool-call-delta`, and `block-end` chunks, with a carry-over buffer for split placeholders.
- **Three detection families** — 28 entity types of generic PII/credentials (including social
  insurance, housing fund, student ID, medical record, IMEI, MAC; bank cards pass Luhn), plus
  Chinese-entity rules (organization, project, system, ID number, address, person) and a user
  term list with literal and `re:` regex entries.
- **Smart vocabulary** — `/shield scan-doc <path>` extracts candidate proper nouns from local
  documents (txt/md/csv/json/code/docx); `/shield learn` mines frequent unmatched fragments from
  local session logs. Candidates enter the term list only after explicit confirmation
  (`terms adopt`). `termsFile` hot-reloads on change (fs.watch).
- **Rules-pack import/export** — `/shield export` / `/shield import` carry the term list and
  entity switches between machines (`schema: dsh-shield.rules/v1`); `--encrypt <passphrase>`
  protects a pack with AES-256-GCM + scrypt (`DSH-SHIELD-ENC/v1`), `--pass` decrypts on import.
  A pack never contains the restore table; import validation rejects `vault/values/secrets`-style
  fields outright.
- **Term file** — `termsFile` points at a line-based word list (`#`/`//` comments, `@category`
  tags); merged with inline `terms`.
- **In-memory vault** — the `placeholder → value` table never touches disk and is
  LRU-bounded; it can in principle be rebuilt by re-running the detectors over the local log.
- **Outbound audit** — per-request placeholder counts and label distribution, plus a
  detector re-run over the outbound text to flag plaintext leaks. JSONL sink on by default with
  retention cleanup; `/shield audit [days]` queries, `audit export` writes CSV.
  Counts and labels only — never plaintext.
- **Web UI** — a dock status bar plus an expandable panel (Settings / Terms / Test bench /
  Audit / Candidates). Settings groups the 28 entity types by sensitivity with a search box and
  shows an "enabled x/y" counter; Terms shows category chips and sorts entries by hit count;
  the Test bench can show an opt-in placeholder ↔ value table (off by default); the diagnostics
  badge is hidden unless enabled in Settings; an `⟳ host-version` pill plus a "restart DSH" hint
  appears when the loaded UI bundle is older than the host plugin. Sensitive actions need
  `confirm`. See `docs/CLIENT-RPC-NOTES.md` for the RPC contract (11 methods).
- **Ops commands** — `/shield pause <minutes>` temporarily passes plaintext and auto-resumes;
  `/shield doctor` runs a check-up with OK/warn lines.
- **`shield_scan` tool** — a model-callable tool that reports masking statistics (counts and
  labels only).
- **Zero runtime dependencies.** Toggleable via `/shield on|off` and `/shield enforce|observe`.

> **Image note.** This plugin does not inspect image content (no OCR); images pass through
> untouched — handle sensitive images yourself. Text-like file block contents are masked.

> **Plaintext note.** Real values in your local logs are a deliberate design choice — they are
> what makes restoration possible. Disk encryption, backup handling, and access control remain
> your responsibility. See [docs/SECURITY.md](docs/SECURITY.md).

## How it differs from other masking plugins

Several DSH plugins mask PII before it reaches the model. The design choices here:

- **Only the model-visible copy is rewritten.** Local session logs, the chat transcript, and
  tool execution keep real values — which is what makes display-layer restoration possible.
  (Plugins that also rewrite the human-record surface trade away local readability.)
- **Placeholders are HMAC-derived** with a local key file (`$DSH_HOME/shield/.placeholder.key`),
  so they are stable across sessions but cannot be enumerated or reversed by someone who only
  sees the masked text.
- **Rules packs move between machines** — term lists and entity switches export/import as JSON,
  optionally AES-256-GCM encrypted, and a pack never contains the restore table.
- **Vocabulary mining** — `scan-doc` extracts candidate proper nouns from local documents and
  `learn` mines session history; candidates take effect only after explicit confirmation.
- **Outbound audit with plaintext re-check** — every request is re-scanned for leaks; the audit
  records counts and labels only, never plaintext.

## Quick start

1. **Install** the bundle (absolute path to this directory):
   `plugin_manager action=install_bundle target=<absolute path to dsh-privacy-shield>`
2. **Restart the DSH profile** — mandatory after install, upgrade, or uninstall
   (see *Known limitations*).
3. **Configure** in your profile's `cordis.patch.yml` (the shipped `cordis.patch.yml` is a
   working example; it already defaults to `mode: enforce`).
4. **Verify**:
   - `/shield status` — mode, surfaces, counts, derive-patch status.
   - `/shield verify 张三的手机号是13800138000` — trial masking (prints masked output only).

## Rules packs (import / export)

```
/shield export [path] [--encrypt <passphrase>]   # write terms + entity switches to a pack
/shield import <path> [--pass <passphrase>] [replace confirm]
                                                 # auto-detects encrypted packs; merge (default)
                                                 # or replace the term list
/shield rules                                    # show current pack summary (counts only)
```

- Pack schema: `dsh-shield.rules/v1` — `{ schema, exportedAt, plugin, entities, terms, notes }`.
- Packs contain **terms and entity switches only** — never the restore table. Still, a term
  list is itself sensitive; handle packs at the same classification level as your word list.
- Alternatively, set `rulesPack: "<path>"` in `cordis.patch.yml` to load a pack at startup,
  or `termsFile` for a line-based word list.

## Configuration

Full reference: [docs/CONFIG.md](docs/CONFIG.md). Summary:

| Field | Default | Purpose |
|---|---|---|
| `enabled` | `true` | Master switch; `false` registers nothing. |
| `mode` | `enforce` | `enforce` rewrites the model-visible surface; `observe` counts only. |
| `entities` | 26 types | Enabled entity types (see *Entity types*). |
| `placeholderHash` | `hmac` | Placeholder hash: `hmac` (HMAC-SHA256, local key file) / `legacy` (FNV-1a, enumerable). |
| `minLevel` | `low` | Entity sensitivity floor (high/medium/low) when `entities` is not set explicitly. |
| `addressLevel` | `full` | Chinese address granularity: `full` to door number / `street` to street only. |
| `terms` | `[]` | Inline term list (`term`, `term @category`, `re:regex @category`). |
| `termsFile` | `null` | Line-based word list file (relative → `$DSH_HOME/shield/`); hot-reloads on change. |
| `disabledLabels` | `[]` | Disabled term labels (mirrors `terms label off`). |
| `rulesPack` | `null` | Rules-pack file loaded at startup. |
| `surfaces` | all `true` | Per-surface toggles: system / developer / user / assistant / tool. |
| `mediaPolicy` | `pass` | Media blocks pass; text-like file contents are still masked; no image OCR. |
| `audit.jsonl` / `audit.jsonlPath` | `true` / default | JSONL audit sink (counts only). |
| `audit.retentionDays` | `30` | Audit retention; older lines are purged at startup. |
| `audit.verifyOutbound` | `full` | Plaintext re-check over outbound text: `full`/`sample`/`off`. |
| `audit.maxVerifyChars` | 2000000 | Skip the re-check above this size. |
| `onUnmaskable` | `warn` | `block` throws instead of sending a frozen request with plaintext. |
| `registerProjections` | `true` | Core masking switch (the derive patch); `false` = audit only. |
| `registerCommand` / `registerTools` | `true` | `/shield` command / `shield_scan` tool. |
| `maxVaultEntries` | 5000 | Vault cap (100–200000), oldest evicted first. |

**Removed in 0.2.0:** `sessionFilter` — DSH's masking hooks are session-agnostic, so the
shield can only operate globally; a configured `sessionFilter` degrades to a notice. Use
`/shield off` for temporary exemption.

## Commands

```
/shield [status|on|off confirm|enforce|observe confirm|pause <minutes>|doctor
        |verify [text]|terms [label off|on LABEL|adopt <indices…|all>]
        |scan-doc <path>|learn|audit [days]|audit export <path>
        |vault|rules|export [path] [--encrypt <passphrase>]|import <path> [--pass <passphrase>] [replace confirm]|help]
```

All status output is counts and labels only — never your text. `on`/`off`,
`enforce`/`observe`, and `pause` are process-local and lost on restart.

## Entity types

28 entity names; 26 on by default, `ipv4`/`ipv6` opt-in. Full table and the Chinese-rule
heuristics: [docs/CONFIG.md](docs/CONFIG.md); rationale and DSH source evidence:
[docs/DESIGN-NOTES.md](docs/DESIGN-NOTES.md). Detection is rule- and list-driven (no NER
model): it will miss unusual names and over-match some technical text — use `terms`,
`scan-doc`, or `learn` for your own organizations, projects, systems, and codes.

## Known limitations

1. **Restart the profile after any install/upgrade/unload.** Masking rides on a defensive
   patch over `Session.deriveEventMessage`; unloading the plugin restores plain derivation,
   and sessions/logs are unaffected either way. (`termsFile` word-list changes hot-reload
   without a restart; every other config change still needs one.)
2. **No OCR** — images pass through untouched; avoid sending sensitive images or redact them
   first. Text-like file block contents are masked.
3. **Heuristic detection** — unmatched sensitive values leave in plaintext; watch the
   outbound-audit violation counter and extend `terms`.
4. **`observe` masks nothing** — it sends plaintext and reports `0` outbound placeholders.
5. **Label changes alter placeholders** — a value matched under a different label after a
   config change yields a different placeholder.
6. **Vault eviction is silent** — evicted mappings stay as placeholders in restored output.
7. **Runtime toggles do not persist** across restarts; edit `cordis.patch.yml` for durability.
8. **`mediaPolicy: 'strip'` is not implemented** — accepted by the config schema, no code
   removes media blocks.
9. **Hot reload overwrites in-process terms** — a `termsFile` change rebuilds the vocabulary
   from config sources, dropping terms added via the UI or commands (logged).

## Development and testing

```bash
node --test "test/*.test.mjs"     # 123 unit tests (engine, crypto, audit, RPC, runtime, UI render, locale sync)
node tools/build-dist.mjs         # release/ directory + .zip + .tgz
```

No dependencies to install. The browser half has an additional offline smoke harness
(React stub + loader stub); see `docs/CLIENT-RPC-NOTES.md`.

## Distribution

`dsh-privacy-shield` is a DSH bundle (`package.json` declares `dsh.bundle.patch`); there is no build
step and no third-party dependency. Build the artifacts with `node tools/build-dist.mjs`, then
hand them to someone else in whichever of these ways fits:

1. **Local folder (offline, simplest).** Send `.zip`; the recipient unpacks it and asks their DSH
   agent to install the unpacked folder (absolute path, the directory that contains `package.json`):

   ```
   plugin_manager action=install_bundle target=<absolute path to the unpacked dsh-privacy-shield directory>
   ```

2. **Tarball URL.** Send `.tgz` (standard npm tarball, `package/` root; verified installable by
   npm/pnpm) or host it anywhere with a direct download link, then install by URL — either in the
   Plugins page install field or via the agent:

   ```
   plugin_manager action=install_bundle target=https://example.com/dsh-privacy-shield-1.0.0.tgz
   ```

3. **Git repository.** Push this directory as a repository and install by URL:

   ```
   plugin_manager action=install_bundle target=https://github.com/<you>/dsh-privacy-shield.git
   ```

4. **npm package (optional).** The unscoped name `dsh-privacy-shield` is available if you
   ever want `npm publish`; GitHub installs (above) do not need it.

After installing, the recipient restarts their DSH profile and reloads the page. Config is not part
of the package — send a config snippet (`cordis.patch.yml` keys), not your whole profile.

The recipient-facing walkthrough (Chinese and English) lives in `docs/DISTRIBUTE.md` and is also
copied into the release kit by `tools/build-dist.mjs`.

## Documentation

- [docs/DESIGN-NOTES.md](docs/DESIGN-NOTES.md) — why the implementation works this way, with DSH source evidence (Chinese).
- [docs/CLIENT-RPC-NOTES.md](docs/CLIENT-RPC-NOTES.md) — browser-half RPC contract and verified DSH mechanics.
- [docs/CONFIG.md](docs/CONFIG.md) — every config field, entity type, and heuristic.
- [docs/SECURITY.md](docs/SECURITY.md) — threat model and boundaries.
- [docs/COMPLIANCE.md](docs/COMPLIANCE.md) — feature-to-principle mapping (not legal advice).
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — release notes.

## License

MIT. See [LICENSE](LICENSE).
