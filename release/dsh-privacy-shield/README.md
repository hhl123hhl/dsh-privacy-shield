# dsh-privacy-shield

**In one sentence**: while you chat with the AI in DeepSeek Harness (DSH), this plugin swaps private content in your messages (phone numbers, ID numbers, company names, addresses …) for untraceable placeholders **on your own machine** before they are sent to the cloud model — then swaps them back so you see the real values in the UI.

**v1.1.0** · MIT licensed · works out of the box · zero third-party dependencies

---

## How it works

```
What you type:      Call 张三 at 13800138000, plate 京A12345.
Sent to the model:  Call <PERSON_1a2b3c4d> at <PHONE_9f8e7d6c>, plate <PLATE_0a1b2c3d>.
What you see:       Call 张三 at 13800138000, plate 京A12345.
```

A placeholder is a category label plus a random id derived with a key that never leaves your machine — nobody can guess or enumerate the original value from it.

Your local chat history, the UI, and file exports **always keep the real values** — only the outbound copy is rewritten.

## What it does for you

- **Detects sensitive text automatically**: phone numbers, ID cards, bank cards, emails, license plates, passports, plus Chinese-oriented types (organization and project names, system names, serial numbers, addresses, person names) — 28 types in total. Everything is masked before it leaves your machine; you don't have to do anything.
- **Understands tables**: when you paste spreadsheet-like content, column headers decide which columns hold person names or organizations, and the whole column is masked. Amount columns are left alone by default so the AI can still do the math.
- **Understands JSON tool results**: what an agent prints after reading a spreadsheet — even a truncated, line-numbered pretty-print dump that no longer parses as JSON — is still read column by column; key/value pairs (`"sales": "…"`), aggregation maps (`{"paid_by_sales": {"…": 6}}`), and sheet names are masked too.
- **Catches bare identifiers**: contract and project numbers like `cstb-pmc-2020245` or `京分-CSTM-PME(PMC)-2020230` are recognised structurally, without a prefix or a cue word; plain dates stay untouched.
- **Remembers what it saw**: a value learned from a table cell or a key/value pair is masked wherever it turns up later in prose, even glued to Chinese text — with boundary checks so ordinary words are not hit.
- **Learns your proper nouns**: scan local documents (`/shield scan-doc`) or learn from chat history (`/shield learn`) to add your own people, projects, and systems to the vocabulary — candidates take effect only after you confirm them. Candidates come from multiple routes (column headers, same-sentence context, name suffixes, quoted titles, repetition), and each one shows the evidence that nominated it; a name with no cue word in front of it still gets proposed.
- **Portable rules**: export and import the vocabulary and switches as a pack (optional passphrase encryption). Handy for a new machine or a colleague. A pack never contains the original-value mapping.
- **Double-checks every request**: before each message is sent, the plugin re-scans the outbound text for anything that leaked through unmasked. The audit log holds counts and type labels only — never the content itself.
- **Has a UI**: a status bar next to the input box opens a panel for settings, vocabulary, a masking test bench, and audit records.

> **Two boundaries**: ① images are not inspected (no OCR) — please don't send sensitive images; ② keeping plaintext in local logs is by design — it's what makes restoration possible. Use disk encryption and access control on your own machine.

## Installation

**Option 1: from the Git repository** (recommended, updateable)

Tell the DSH assistant:

```
plugin_manager action=install_bundle target=https://github.com/hhl123hhl/dsh-privacy-shield.git
```

**Option 2: offline bundle**

Unzip the `.zip` from Releases, then:

```
plugin_manager action=install_bundle target=<absolute path to the unzipped folder>
```

Restart DSH after either option. Defaults work out of the box; advanced options in [docs/CONFIG.md](docs/CONFIG.md).

Verify:

- `/shield status` — mode, entity types, statistics
- `/shield verify 张三的手机号是13800138000` — try masking once (output only, no side effects)

## Common commands

| Command | What it does |
|---|---|
| `/shield status` | Show mode, types, statistics |
| `/shield verify <text>` | Try masking, output only |
| `/shield scan-doc <path>` | Extract proper-noun candidates from a document |
| `/shield learn` | Learn frequent terms from chat history |
| `/shield export` / `import` | Export / import a rules pack (encryptable) |
| `/shield audit` | Show the outbound re-check log (statistics only) |
| `/shield doctor` | Self-check |
| `/shield off` / `on` | Pause / resume (reverts to config after restart) |

## How it differs from other masking plugins

1. **Only the outbound copy is rewritten** — local records stay original so you can always audit what was masked.
2. **Placeholders are derived with a local key** — outsiders cannot enumerate or reverse them.
3. **Rules packs never contain the restore table** — even a lost config file leaks nothing.

## Documentation

- [docs/CONFIG.md](docs/CONFIG.md) — full configuration reference
- [docs/DISTRIBUTE.md](docs/DISTRIBUTE.md) — illustrated hand-off steps (Chinese & English)
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — release history
- [docs/SECURITY.md](docs/SECURITY.md) — security notes and boundaries

## License

MIT, see [LICENSE](LICENSE).
