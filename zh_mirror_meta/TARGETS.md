# ECC 翻译目标清单(已锁定的 105 文件)

本目录是 Workflow 6 agent 阶段的输入文件。每个 agent 拿走一桶。

## 桶 1:根级 8 份(Agent A)

| # | 源文件 | 镜像路径 | 字节 |
|---|--------|----------|------|
| 1 | `AGENTS.md` | `AGENTS_zh.md` | 8626 |
| 2 | `CONTRIBUTING.md` | `CONTRIBUTING_zh.md` | 13445 |
| 3 | `SECURITY.md` | `SECURITY_zh.md` | 7187 |
| 4 | `TROUBLESHOOTING.md` | `TROUBLESHOOTING_zh.md` | 10107 |
| 5 | `the-longform-guide.md` | `the-longform-guide_zh.md` | 15186 |
| 6 | `the-shortform-guide.md` | `the-shortform-guide_zh.md` | 16326 |
| 7 | `the-security-guide.md` | `the-security-guide_zh.md` | 28837 |
| 8 | `COMMANDS-QUICK-REF.md` | `COMMANDS-QUICK-REF_zh.md` | 6193 |

## 桶 2:docs/ 顶层 32 份(Agent B)

| # | 源文件 | 镜像路径 |
|---|--------|----------|
| 1 | `docs/ANTIGRAVITY-GUIDE.md` | `docs/ANTIGRAVITY-GUIDE_zh.md` |
| 2 | `docs/ARCHITECTURE-IMPROVEMENTS.md` | `docs/ARCHITECTURE-IMPROVEMENTS_zh.md` |
| 3 | `docs/ATLAS-CLOUD-GUIDE.md` | `docs/ATLAS-CLOUD-GUIDE_zh.md` |
| 4 | `docs/capability-surface-selection.md` | `docs/capability-surface-selection_zh.md` |
| 5 | `docs/COMMAND-AGENT-MAP.md` | `docs/COMMAND-AGENT-MAP_zh.md` |
| 6 | `docs/continuous-learning-v2-spec.md` | `docs/continuous-learning-v2-spec_zh.md` |
| 7 | `docs/ECC-2.0-GA-ROADMAP.md` | `docs/ECC-2.0-GA-ROADMAP_zh.md` |
| 8 | `docs/ECC-2.0-REFERENCE-ARCHITECTURE.md` | `docs/ECC-2.0-REFERENCE-ARCHITECTURE_zh.md` |
| 9 | `docs/ECC-2.0-SESSION-ADAPTER-DISCOVERY.md` | `docs/ECC-2.0-SESSION-ADAPTER-DISCOVERY_zh.md` |
| 10 | `docs/ECC-PRO-SECURITY-ROADMAP.md` | `docs/ECC-PRO-SECURITY-ROADMAP_zh.md` |
| 11 | `docs/HERMES-OPENCLAW-MIGRATION.md` | `docs/HERMES-OPENCLAW-MIGRATION_zh.md` |
| 12 | `docs/HERMES-SETUP.md` | `docs/HERMES-SETUP_zh.md` |
| 13 | `docs/hook-bug-workarounds.md` | `docs/hook-bug-workarounds_zh.md` |
| 14 | `docs/JOYCODE-GUIDE.md` | `docs/JOYCODE-GUIDE_zh.md` |
| 15 | `docs/legacy-artifact-inventory.md` | `docs/legacy-artifact-inventory_zh.md` |
| 16 | `docs/MANUAL-ADAPTATION-GUIDE.md` | `docs/MANUAL-ADAPTATION-GUIDE_zh.md` |
| 17 | `docs/MCP-CONNECTOR-POLICY.md` | `docs/MCP-CONNECTOR-POLICY_zh.md` |
| 18 | `docs/MEGA-PLAN-REPO-PROMPTS-2026-03-12.md` | `docs/MEGA-PLAN-REPO-PROMPTS-2026-03-12_zh.md` |
| 19 | `docs/PHASE1-ISSUE-BUNDLE-2026-03-12.md` | `docs/PHASE1-ISSUE-BUNDLE-2026-03-12_zh.md` |
| 20 | `docs/PLAN-PRD-PATTERN.md` | `docs/PLAN-PRD-PATTERN_zh.md` |
| 21 | `docs/PR-399-REVIEW-2026-03-12.md` | `docs/PR-399-REVIEW-2026-03-12_zh.md` |
| 22 | `docs/PR-QUEUE-TRIAGE-2026-03-13.md` | `docs/PR-QUEUE-TRIAGE-2026-03-13_zh.md` |
| 23 | `docs/QWEN-GUIDE.md` | `docs/QWEN-GUIDE_zh.md` |
| 24 | `docs/SELECTIVE-INSTALL-ARCHITECTURE.md` | `docs/SELECTIVE-INSTALL-ARCHITECTURE_zh.md` |
| 25 | `docs/SELECTIVE-INSTALL-DESIGN.md` | `docs/SELECTIVE-INSTALL-DESIGN_zh.md` |
| 26 | `docs/SESSION-ADAPTER-CONTRACT.md` | `docs/SESSION-ADAPTER-CONTRACT_zh.md` |
| 27 | `docs/skill-adaptation-policy.md` | `docs/skill-adaptation-policy_zh.md` |
| 28 | `docs/SKILL-DEVELOPMENT-GUIDE.md` | `docs/SKILL-DEVELOPMENT-GUIDE_zh.md` |
| 29 | `docs/SKILL-PLACEMENT-POLICY.md` | `docs/SKILL-PLACEMENT-POLICY_zh.md` |
| 30 | `docs/stale-pr-salvage-ledger.md` | `docs/stale-pr-salvage-ledger_zh.md` |
| 31 | `docs/token-optimization.md` | `docs/token-optimization_zh.md` |
| 32 | `docs/TROUBLESHOOTING.md` | `docs/TROUBLESHOOTING_zh.md` |
| 33 | `README.md` | `README_zh.md`(特殊:第 1 行只保留 3 个语言链接) |

## 桶 3:docs/ 子目录 65 份 + 删除 9 个语种目录(Agent C)

删除清单(在 translate 之前先做):
- `docs/de-DE/`(2 文件)
- `docs/es/`(141 文件)
- `docs/ja-JP/`(522 文件)
- `docs/ko-KR/`(63 文件)
- `docs/pt-BR/`(47 文件)
- `docs/ru/`(1 文件)
- `docs/th/`(141 文件)
- `docs/tr/`(141 文件)
- `docs/vi-VN/`(1 文件)

随后修改 `package.json#files` 去掉 7 个发布镜像项(de-DE, ja-JP, ko-KR, pt-BR, ru, tr, vi-VN)。

随后翻译 docs/ 子目录 65 份:
- `docs/design/`(2)
- `docs/drafts/`(1)
- `docs/fixes/`(4)
- `docs/releases/`(43)← 这一桶最大
- `docs/security/`(1)
- `docs/architecture/`(9)
- `docs/business/`(3)
- `docs/examples/`(2)

总 65 份,但 Agent C 还要先做删除 — 工作量比 A/B/D 略大,但仍可控。

## 桶 4:验证(Agent D)

- 读 `zh_mirror_meta/GLOSSARY.md`、`zh_mirror_meta/TRANSLATION_TEMPLATE.md` 校对翻译一致性
- 抽样 30 个文件,验证:
  - 翻译头格式正确
  - frontmatter 合规(若适用)
  - description_en 镜像存在
  - 链接策略(指向英文源)
- 输出验证报告到 `zh_mirror_meta/VERIFY_REPORT.md`

## 桶 5:CI 校验与修复(Agent E)

- 在所有 agent 完工后跑 `npm test`
- 把失败项归类
- 输出修复建议到 `zh_mirror_meta/CI_FIXES.md`(不实际修复 —— 由主会话评估后动手)

## 排除(不翻译)

- `CLAUDE.md`:已是我刚写的中文版,不动
- `README.zh-CN.md`:已是中文,不动
- `docs/zh-CN/`(416 文件):已有中文,不动
- `docs/zh-TW/`(58 文件):已有中文,不动
- `docs/ur/`(1 文件,乌尔都语):你的删除清单没列,保留不动
- `skills/`、`agents/`、`commands/`、`rules/`:本轮不译
- 所有 harness 适配器目录(.codex/、.cursor/、.opencode/ 等)
- 所有 CHANGELOG 类大列表(CHANGELOG.md、WORKING-CONTEXT.md 等 — 本轮不译)
