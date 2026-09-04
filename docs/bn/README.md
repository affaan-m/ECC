**ভাষা:** [English](../../README.md) | **বাংলা** | [Português (Brasil)](../pt-BR/README.md) | [简体中文](../../README.zh-CN.md) | [繁體中文](../zh-TW/README.md) | [日本語](../ja-JP/README.md) | [한국어](../ko-KR/README.md) | [Türkçe](../tr/README.md) | [Русский](../ru/README.md) | [Tiếng Việt](../vi-VN/README.md) | [ไทย](../th/README.md) | [Deutsch](../de-DE/README.md) | [Español](../es/README.md) | [Українська](../uk-UA/README.md)

# ECC

![ECC — AI agent harness-এর জন্য হার্নেস-নেটিভ অপারেটর সিস্টেম](../../assets/hero.png)

[![Stars](https://img.shields.io/endpoint?url=https%3A%2F%2Fapi.ecc.tools%2Fbadge%2Fstars&style=flat)](https://github.com/affaan-m/ECC/stargazers)
[![Forks](https://img.shields.io/endpoint?url=https%3A%2F%2Fapi.ecc.tools%2Fbadge%2Fforks&style=flat)](https://github.com/affaan-m/ECC/network/members)
[![Contributors](https://img.shields.io/github/contributors/affaan-m/ECC?style=flat)](https://github.com/affaan-m/ECC/graphs/contributors)
[![npm ecc-universal](https://img.shields.io/npm/dw/ecc-universal?label=ecc-universal%20weekly%20downloads&logo=npm)](https://www.npmjs.com/package/ecc-universal)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

> **182K+ স্টার** | **28K+ ফর্ক** | **170+ কন্ট্রিবিউটর** | **12+ ভাষার ইকোসিস্টেম** | **Anthropic Hackathon বিজয়ী**

---

<div align="center">

**ভাষা / Language / 语言 / 語言 / Dil / Язык / Ngôn ngữ**

[English](../../README.md) | **বাংলা** | [Português (Brasil)](../pt-BR/README.md) | [简体中文](../../README.zh-CN.md) | [繁體中文](../zh-TW/README.md) | [日本語](../ja-JP/README.md) | [한국어](../ko-KR/README.md) | [Türkçe](../tr/README.md) | [Русский](../ru/README.md) | [Tiếng Việt](../vi-VN/README.md) | [ไทย](../th/README.md) | [Deutsch](../de-DE/README.md) | [Español](../es/README.md) | [Українська](../uk-UA/README.md)

</div>

---

**ECC হলো AI agent harness-এর জন্য একটি সমন্বিত ইঞ্জিনিয়ারিং সিস্টেম।**

আপনার agent কোড লিখতে পারে, কিন্তু ECC তাকে একটি সমন্বিত টুলবক্স দেয়: বিল্ডের আগে প্ল্যান, টেস্ট দিয়ে যাচাই, নতুন context-এ রিভিউ, গুরুত্বপূর্ণ জিনিস মনে রাখা, এবং বারবার কাজে লাগা workflow-কে reusable skill-এ রূপান্তর।

```text
plan -> test -> implement -> review -> verify -> remember -> improve
```

> Context window অপ্টিমাইজ করুন। বাকি সবকিছু persist করুন।

ECC শুধু কনফিগ নয়। এতে **68 agents**, **286 skills**, **94 legacy command shim**, hooks, rules, memory, continuous learning, এবং AgentShield security scanning আছে। **Claude Code**, **Codex**, **Cursor**, **OpenCode**, **Gemini**, **Zed**, **GitHub Copilot** এবং অন্যান্য harness-এ কাজ করে।

এই বাংলা পৃষ্ঠাটি দ্রুত শুরু করার জন্য সংক্ষিপ্ত onboarding গাইড। সম্পূর্ণ ও সর্বশেষ তথ্যের জন্য [ইংরেজি README](../../README.md) মূল উৎস।

---

<table>
<tr>
<td width="25%" align="center">
  <a href="https://ecc.tools/pricing">
    <strong>ECC Pro</strong><br />
    <sub>Private repo · GitHub App · $19/seat/mo</sub>
  </a>
</td>
<td width="25%" align="center">
  <a href="https://github.com/sponsors/affaan-m">
    <strong>স্পন্সর</strong><br />
    <sub>OSS-কে ফান্ড করুন</sub>
  </a>
</td>
<td width="25%" align="center">
  <a href="https://discord.gg/36yGMHGFbR">
    <strong>কমিউনিটি</strong><br />
    <sub>Discord · Q&amp;A · Show &amp; Tell</sub>
  </a>
</td>
<td width="25%" align="center">
  <a href="https://github.com/apps/ecc-tools">
    <strong>GitHub App</strong><br />
    <sub>Install · PR audits · Free tier</sub>
  </a>
</td>
</tr>
</table>

<sub><strong>OSS বিনামূল্যে থাকবে।</strong> এই repo চিরকাল MIT লাইসেন্সে। ECC Pro private repo-র জন্য hosted GitHub App। <a href="https://github.com/sponsors/affaan-m">স্পন্সর</a> এবং <a href="https://ecc.tools/pricing">Pro সাবস্ক্রাইবার</a> কাজটি চালিয়ে যায়।</sub>

---

## দ্রুত শুরু

> [!WARNING]
> **শুধুমাত্র অফিসিয়াল উৎস থেকে ইনস্টল করুন:** [github.com/affaan-m/ECC](https://github.com/affaan-m/ECC), npm [`ecc-universal`](https://www.npmjs.com/package/ecc-universal) / [`ecc-agentshield`](https://www.npmjs.com/package/ecc-agentshield), plugin `ecc@ecc`, [GitHub App](https://github.com/apps/ecc-tools), এবং [ecc.tools](https://ecc.tools)।

### প্রস্তাবিত: universal guided setup

Node.js 18+, Git, এবং Claude Code 2.1+ প্রয়োজন:

```bash
npx ecc-universal setup
```

Claude Code, Codex, বা Kimi Code একসাথে কনফিগার করতে:

```bash
npx ecc-universal install --guided
```

### প্রতিটি harness-এ শুধু একটি পথ বেছে নিন

একই harness-এ একাধিক ইনস্টল পদ্ধতি **একসাথে চালাবেন না** — skill, hook, বা config duplicate হতে পারে।

| পথ | কখন ব্যবহার করবেন |
|---|---|
| **প্রস্তাবিত (ডিফল্ট)** | `npx ecc-universal setup` |
| **Claude Code native plugin** | `/plugin marketplace add` + `/plugin install ecc@ecc` |
| **এড়িয়ে চলুন** | Plugin ইনস্টল + `./install.sh --profile full` একসাথে |
| **এড়িয়ে চলুন** | Codex sync + Codex marketplace plugin একসাথে |

Duplicate দেখলে সরাসরি [Reset / Uninstall](#reset--uninstall-ecc) দেখুন।

### Claude Code plugin ইনস্টল

```bash
# Marketplace যোগ করুন
/plugin marketplace add https://github.com/affaan-m/ECC

# Plugin ইনস্টল করুন
/plugin install ecc@ecc
```

ECC-র তিনটি পাবলিক identifier আছে — এগুলো interchangeable নয়:

- GitHub repo: `affaan-m/ECC`
- Claude marketplace plugin: `ecc@ecc`
- npm package: `ecc-universal`

Plugin ইনস্টলের পর `/ecc:configure-ecc` দিয়ে পুনরায় কনফিগার করা যায়, তবে প্রথম ইনস্টলে Claude Code-র native `/plugin` command-ই ব্যবহার করুন।

### Rules ম্যানুয়ালি কপি করুন (প্রয়োজন হলে)

Claude Code plugin `rules/` স্বয়ংক্রিয়ভাবে বিতরণ করে না। Plugin দিয়ে ইনস্টল করলে **full installer চালাবেন না** — শুধু প্রয়োজনীয় rule pack কপি করুন:

```bash
git clone https://github.com/affaan-m/ECC.git
cd ECC

mkdir -p ~/.claude/rules/ecc
cp -R rules/common ~/.claude/rules/ecc/
cp -R rules/typescript ~/.claude/rules/ecc/   # আপনার stack অনুযায়ী
```

`rules/common` এবং আপনার ভাষা/framework pack দিয়ে শুরু করুন। পুরো `rules/` কপি করবেন না যদি না সব context চান।

### সম্পূর্ণ ম্যানুয়াল ইনস্টল (fallback)

Plugin পথ intentionally এড়াতে চাইলে:

```bash
git clone https://github.com/affaan-m/ECC.git
cd ECC
./install.sh --profile full
```

```powershell
git clone https://github.com/affaan-m/ECC.git
cd ECC
.\install.ps1 --profile full
# অথবা
npx ecc-universal install --profile full
```

এই পথ বেছে নিলে এখানেই থামুন। `/plugin install` চালাবেন না।

### Low-context / no-hooks পথ

Hooks ছাড়া rules, agents, commands, এবং core workflow চাইলে:

```bash
npx ecc-universal install --profile minimal --target claude
```

```powershell
.\install.ps1 --profile minimal --target claude
```

এই profile ইচ্ছাকৃতভাবে `hooks-runtime` বাদ দেয়।

---

## Reset / Uninstall ECC

ECC duplicate, intrusive, বা broken মনে হলে আর ইনস্টলের উপর ইনস্টল করবেন না।

- **Plugin পথ:** Claude Code থেকে plugin সরান, তারপর `~/.claude/rules/ecc/`-এ ম্যানুয়ালি কপি করা rule folder মুছুন।
- **Installer/CLI পথ:** repo root থেকে আগে preview:

```bash
npx ecc-universal list-installed
npx ecc-universal doctor
npx ecc-universal repair
npx ecc-universal uninstall --dry-run
npx ecc-universal uninstall
```

Source checkout থেকে:

```bash
node scripts/ecc.js list-installed
node scripts/ecc.js doctor
node scripts/ecc.js repair
node scripts/uninstall.js --dry-run
node scripts/uninstall.js
```

ECC শুধু install-state-এ recorded ফাইল সরায়। অন্য harness ফাইল স্পর্শ করে না।

---

## ব্যবহার শুরু করুন

| আপনি কী করছেন | এখান থেকে শুরু করুন |
|---|---|
| নতুন feature | `/ecc:plan "feature বর্ণনা"`, তারপর `tdd-workflow` |
| Bug fix | failing test দিয়ে reproduce, তারপর `tdd-workflow` |
| Code review | `/code-review` |
| Build repair | `/build-fix` |
| Security audit | `/security-scan` বা `npx -y ecc-agentshield scan --path .` |

```bash
# Plugin install namespace
/ecc:plan "ইউজার authentication যোগ করুন"

# ইনস্টল করা plugin দেখুন
/plugin list ecc@ecc
```

Skills হলো primary workflow surface; commands compatibility shim হিসেবে থাকে।

---

## অন্যান্য harness (সংক্ষিপ্ত)

| Harness | ইনস্টল |
|---|---|
| Cursor | `./install.sh --profile minimal --target cursor` |
| OpenCode | `npm install && npm run build:opencode && ./install.sh --profile full --target opencode` |
| Gemini CLI | `./install.sh --profile minimal --target gemini` |
| Zed | `./install.sh --profile minimal --target zed` |
| Kimi Code | `./install.sh --profile minimal --target kimi` |
| Codex | `codex plugin marketplace add affaan-m/ECC` তারপর `codex plugin add ecc@ecc` |

GitHub Copilot support repo-তে built-in: `.github/copilot-instructions.md` এবং `.github/prompts/`।

Feature parity matrix এবং বিস্তারিত adapter নোটের জন্য [ইংরেজি README — Platform Support](../../README.md#platform-support) দেখুন।

---

## অবদান রাখুন

ECC একটি community-driven open-source প্রজেক্ট। আপনি বিভিন্ন জায়গায় অবদান রাখতে পারেন:

| কোথায় | কী যোগ করতে পারেন |
|---|---|
| `agents/` | নতুন specialized agent (reviewer, planner, build-resolver ইত্যাদি) |
| `skills/` | workflow skill, domain knowledge, coding pattern |
| `hooks/` | automation, linting, security check, session hook |
| `rules/` | language/framework-specific coding standard |
| `commands/` | legacy slash-command compatibility shim |
| `docs/` | README অনুবাদ, গাইড, troubleshooting doc |
| `tests/` | regression test, install/doc validation |
| `.cursor/`, `.codex/`, `.opencode/` | cross-harness adapter update |

**বিশেষভাবে প্রয়োজন:**

- **Agents** — ভাষা-specific reviewer (Rust, C#, Kotlin), framework expert (Rails, FastAPI), DevOps (Kubernetes, Terraform), domain expert (ML, mobile)
- **Skills** — testing strategy, API design, deployment pattern, security checklist
- **Hooks** — formatting, typecheck, secret detection, session persistence
- **অনুবাদ** — `docs/<locale>/` (যেমন `docs/bn/`, `docs/ja-JP/`, `docs/zh-CN/`) — agents, skills, commands অনুবাদ বা README আপডেট
- **Security** — AgentShield rule, vulnerability fix ([SECURITY.md](../../SECURITY.md) দেখুন)

### দ্রুত শুরু

```bash
# 1. Fork ও clone
gh repo fork affaan-m/ECC --clone
cd ECC

# 2. Branch তৈরি
git checkout -b feat/my-contribution

# 3. আপনার অবদান যোগ করুন (নিচে দেখুন)

# 4. লোকালি টেস্ট
node tests/run-all.js
cp -r skills/my-skill ~/.claude/skills/   # skill হলে

# 5. PR পাঠান
git add . && git commit -m "feat(skills): add my-skill" && git push -u origin feat/my-contribution
```

**Skill যোগ করতে:** `skills/your-skill-name/SKILL.md` (YAML frontmatter সহ)

**Agent যোগ করতে:** `agents/your-agent.md` (name, description, tools, model frontmatter)

**বাংলা অনুবাদে অবদান:** `docs/bn/` — README, agents, skills, commands mirror; ইংরেজি README authoritative source হিসেবে রাখুন।

**গুরুত্বপূর্ণ সতর্কতা:** `.claude-plugin/plugin.json`-এ `"hooks"` field যোগ করবেন **না** — Claude Code v2.1+ plugin hooks স্বয়ংক্রিয়ভাবে load করে।

### আরও গাইড

- [Contributing guide](../../CONTRIBUTING.md) — সম্পূর্ণ PR process
- [Skill development guide](../SKILL-DEVELOPMENT-GUIDE.md)
- [Skill placement policy](../SKILL-PLACEMENT-POLICY.md)
- [GitHub Discussions](https://github.com/affaan-m/ECC/discussions) — প্রশ্ন, আইডিয়া, Show & Tell
- [GitHub Issues](https://github.com/affaan-m/ECC/issues) — bug report বা feature request

---

## গুরুত্বপূর্ণ ডকুমেন্ট

- [ইংরেজি README](../../README.md) — সম্পূর্ণ ও authoritative উৎস
- [Contributing guide](../../CONTRIBUTING.md)
- [Security policy](../../SECURITY.md)
- [Token optimization guide](../token-optimization.md)
- [Troubleshooting](../TROUBLESHOOTING.md)
- [Codex navigation guide](../CODEX-NAVIGATION-GUIDE.md)
- [Hermes setup guide](../HERMES-SETUP.md)

---

## লিঙ্ক

- **Shorthand Guide (এখান থেকে শুরু):** [The Shorthand Guide to ECC](https://x.com/affaanmustafa/status/2012378465664745795)
- **Longform Guide (advanced):** [The Longform Guide to ECC](https://x.com/affaanmustafa/status/2014040193557471352)
- **Security Guide:** [Security Guide](../../the-security-guide.md)
- **Follow:** [@affaanmustafa](https://x.com/affaanmustafa)

---

## লাইসেন্স

MIT — স্বাধীনভাবে ব্যবহার, customize, এবং সম্ভব হলে ফেরত দিন।

**যদি সাহায্য করে, repo-তে star দিন। গাইড পড়ুন। কিছু দারুণ বানান।**
