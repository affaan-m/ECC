**ভাষা:** [English](../../README.md) | [Português (Brasil)](../pt-BR/README.md) | [简体中文](../../README.zh-CN.md) | [繁體中文](../zh-TW/README.md) | [日本語](../ja-JP/README.md) | [한국어](../ko-KR/README.md) | [Türkçe](../tr/README.md) | [Русский](../ru/README.md) | [Tiếng Việt](../vi-VN/README.md) | [ไทย](../th/README.md) | [Deutsch](../de-DE/README.md) | বাংলা

# Everything Claude Code

[![Stars](https://img.shields.io/github/stars/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/stargazers)
[![Forks](https://img.shields.io/github/forks/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/network/members)
[![Contributors](https://img.shields.io/github/contributors/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/graphs/contributors)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

> **140K+ স্টার** | **21K+ ফর্ক** | **170+ অবদানকারী** | **12+ ভাষা ইকোসিস্টেম** | **Anthropic হ্যাকাথন বিজয়ী**

---

<div align="center">

**Language / ভাষা / 语言 / 語言 / 언어 / Dil / Язык / Ngôn ngữ**

[**English**](../../README.md) | [Português (Brasil)](../pt-BR/README.md) | [简体中文](../../README.zh-CN.md) | [繁體中文](../zh-TW/README.md) | [日本語](../ja-JP/README.md) | [한국어](../ko-KR/README.md) | [Türkçe](../tr/README.md) | [Русский](../ru/README.md) | [Tiếng Việt](../vi-VN/README.md) | [ไทย](../th/README.md) | [Deutsch](../de-DE/README.md) | [বাংলা](README.md)

</div>

---

**AI এজেন্ট হার্নেসের জন্য পারফরম্যান্স অপ্টিমাইজেশন সিস্টেম। Anthropic হ্যাকাথন বিজয়ীর তৈরি।**

এটি শুধু কনফিগারেশন ফাইলের সংকলন নয়। এটি একটি সম্পূর্ণ সিস্টেম: স্কিল, ইনস্টিংক্ট, মেমোরি অপ্টিমাইজেশন, ক্রমাগত শেখা, সিকিউরিটি স্ক্যানিং, এবং রিসার্চ-ফার্স্ট ডেভেলপমেন্ট। ১০ মাসেরও বেশি সময় ধরে প্রতিদিন নিবিড়ভাবে ব্যবহার ও বাস্তব পণ্য তৈরির মধ্য দিয়ে উন্নত করা প্রোডাকশন-লেভেল এজেন্ট, হুক, কমান্ড, রুল ও MCP কনফিগারেশন অন্তর্ভুক্ত।

**Claude Code**, **Codex**, **Cursor**, **OpenCode**, **Gemini** এবং অন্যান্য AI এজেন্ট হার্নেসে ব্যবহারযোগ্য।

---

## গাইড

এই রিপোজিটরিতে শুধু কোড আছে। গাইডে সবকিছু ব্যাখ্যা করা হয়েছে।

<table>
<tr>
<td width="50%">
<a href="https://x.com/affaanmustafa/status/2012378465664745795">
<img src="https://github.com/user-attachments/assets/1a471488-59cc-425b-8345-5245c7efbcef" alt="The Shorthand Guide to Everything Claude Code" />
</a>
</td>
<td width="50%">
<a href="https://x.com/affaanmustafa/status/2014040193557471352">
<img src="https://github.com/user-attachments/assets/c9ca43bc-b149-427f-b551-af6840c368f0" alt="The Longform Guide to Everything Claude Code" />
</a>
</td>
</tr>
<tr>
<td align="center"><b>সংক্ষিপ্ত গাইড</b><br/>সেটআপ, মৌলিক বিষয়, দর্শন। <b>এটি আগে পড়ুন।</b></td>
<td align="center"><b>বিস্তারিত গাইড</b><br/>টোকেন অপ্টিমাইজেশন, মেমোরি পার্সিস্টেন্স, মূল্যায়ন, প্যারালেল প্রসেসিং।</td>
</tr>
</table>

| বিষয় | যা শিখবেন |
|-------|-----------|
| টোকেন অপ্টিমাইজেশন | মডেল নির্বাচন, সিস্টেম প্রম্পট অপ্টিমাইজেশন, ব্যাকগ্রাউন্ড প্রসেস |
| মেমোরি পার্সিস্টেন্স | সেশনের মধ্যে কনটেক্সট স্বয়ংক্রিয়ভাবে সংরক্ষণ/লোড করার হুক |
| ক্রমাগত শেখা | সেশন থেকে প্যাটার্ন স্বয়ংক্রিয়ভাবে বের করে পুনঃব্যবহারযোগ্য স্কিলে রূপান্তর |
| যাচাই লুপ | চেকপয়েন্ট বনাম ক্রমাগত মূল্যায়ন, গ্রেডিং ধরন, pass@k মেট্রিক |
| প্যারালেল প্রসেসিং | Git worktree, ক্যাসকেড পদ্ধতি, ইনস্ট্যান্স স্কেলিং |
| সাবএজেন্ট অর্কেস্ট্রেশন | কনটেক্সট সমস্যা, পুনরাবৃত্তি অনুসন্ধান প্যাটার্ন |

---

## নতুন কী আছে

### v2.1 — Plan Canvas, Kimi হার্নেস (২০২৬ জুলাই)

- **Plan Canvas** — আপনার এজেন্ট একটি প্ল্যান লেখে, তারপর একটি ব্রাউজার ক্যানভাসে খোলে। ক্লিক করুন, টীকা যোগ করুন, সাইড রেইল থেকে চ্যাট করুন।
- **Kimi Code ইনস্টল টার্গেট** (`--target kimi`) — ECC সরাসরি Moonshot AI-এর Kimi Code CLI-তে ইনস্টল হয়।
- **GPU-তে সেলফ-হোস্ট** — Itô কম্পিউট স্পনসরের সাথে যাচাইকৃত পথ।
- **Hermes + OpenClaw ইনস্টল টার্গেট**, Codex নেভিগেশন গাইড।

### v2.0 — এজেন্ট হার্নেস অপারেটিং সিস্টেম (২০২৬ জুন)

- **কন্ট্রোল-প্লেন সাবস্ট্রেট** — সেশন অ্যাডাপ্টার + MCP ইনভেন্টরি।
- **`orch-*` অর্কেস্ট্রেটর পরিবার** — ক্রস-হার্নেস অর্কেস্ট্রেশন।
- **ECC Discord কমিউনিটি** চালু।

সম্পূর্ণ পরিবর্তনের তালিকা [Releases](https://github.com/affaan-m/ECC/releases)-এ দেখুন।

---

## দ্রুত শুরু

২ মিনিটে সেটআপ সম্পন্ন করুন:

### ১ম ধাপ: প্লাগইন ইনস্টল

```bash
# মার্কেটপ্লেস যোগ করুন
/plugin marketplace add https://github.com/affaan-m/ECC

# প্লাগইন ইনস্টল করুন
/plugin install ecc@ecc
```

### ২য় ধাপ: রুল ইনস্টল (আবশ্যক)

> **গুরুত্বপূর্ণ:** Claude Code প্লাগইন `rules` স্বয়ংক্রিয়ভাবে ডেপ্লয় করতে পারে না। ম্যানুয়ালি ইনস্টল করতে হবে:

```bash
git clone https://github.com/affaan-m/ECC.git
cd ECC
./install.sh typescript    # অথবা python, golang
```

### ৩য় ধাপ: ব্যবহার শুরু করুন

```bash
/ecc:plan "ব্যবহারকারী অথেনটিকেশন যোগ করুন"
/plugin list ecc@ecc
```

**হয়ে গেছে!** এখন আপনি 67+ এজেন্ট, 281+ স্কিল এবং 94+ কমান্ড ব্যবহার করতে পারবেন।

---

## ক্রস-প্ল্যাটফর্ম সমর্থন

এই প্লাগইন **Windows, macOS, Linux** সম্পূর্ণভাবে সমর্থন করে। সর্বোচ্চ সামঞ্জস্যের জন্য সমস্ত হুক ও স্ক্রিপ্ট Node.js-এ লেখা।

### প্যাকেজ ম্যানেজার সনাক্তকরণ

প্লাগইন আপনার পছন্দের প্যাকেজ ম্যানেজার (npm, pnpm, yarn, bun) স্বয়ংক্রিয়ভাবে সনাক্ত করে:

1. **এনভায়রনমেন্ট ভেরিয়েবল**: `CLAUDE_PACKAGE_MANAGER`
2. **প্রজেক্ট কনফিগ**: `.claude/package-manager.json`
3. **package.json**: `packageManager` ফিল্ড
4. **লক ফাইল**: package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb
5. **গ্লোবাল কনফিগ**: `~/.claude/package-manager.json`
6. **ফলব্যাক**: `npm`

---

## উপাদানসমূহ

এই রিপোজিটরি একটি **Claude Code প্লাগইন** — সরাসরি ইনস্টল করুন অথবা কম্পোনেন্ট ম্যানুয়ালি কপি করুন।

```text
ECC/
|-- agents/           # বিশেষায়িত সাবএজেন্ট (67+)
|   |-- planner.md           # ফিচার বাস্তবায়ন পরিকল্পনা
|   |-- code-reviewer.md     # মান ও নিরাপত্তা পর্যালোচনা
|   |-- bengali-reviewer.md  # বাংলা টেক্সট হ্যান্ডলিং রিভিউ
|
|-- skills/           # ওয়ার্কফ্লো ও ডোমেইন জ্ঞান (281+)
|   |-- bengali-nlp/         # বাংলা টেক্সট প্রসেসিং প্যাটার্ন
|   |-- tdd-workflow/        # TDD পদ্ধতি
|   |-- security-review/     # নিরাপত্তা চেকলিস্ট
|
|-- commands/         # স্ল্যাশ কমান্ড (94+)
|-- rules/            # কোডিং নির্দেশনা
|   |-- common/       # ভাষা-নিরপেক্ষ নীতি
|   |-- typescript/   # TypeScript নির্দিষ্ট
|   |-- python/       # Python নির্দিষ্ট
|
|-- hooks/            # ট্রিগার-ভিত্তিক অটোমেশন
|-- scripts/          # ক্রস-প্ল্যাটফর্ম Node.js স্ক্রিপ্ট
```

---

## কোন এজেন্ট ব্যবহার করবেন?

| যা করতে চান | কমান্ড | এজেন্ট |
|-------------|--------|--------|
| নতুন ফিচার পরিকল্পনা | `/ecc:plan "ফিচার বর্ণনা"` | planner |
| টেস্ট আগে লিখে কোডিং | `tdd-workflow` স্কিল | tdd-guide |
| কোড রিভিউ | `/code-review` | code-reviewer |
| বিল্ড ব্যর্থতা সমাধান | `/build-fix` | build-error-resolver |
| নিরাপত্তা দুর্বলতা খোঁজা | `/security-scan` | security-reviewer |
| বাংলা টেক্সট কোড রিভিউ | bengali-reviewer এজেন্ট | bengali-reviewer |

### সাধারণ ওয়ার্কফ্লো

**নতুন ফিচার:**

```text
/ecc:plan "OAuth দিয়ে অথেনটিকেশন যোগ"  -> পরিকল্পনা তৈরি
tdd-workflow স্কিল                       -> টেস্ট-ফার্স্ট ডেভেলপমেন্ট
/code-review                             -> কোড পর্যালোচনা
```

**বাগ সমাধান:**

```text
tdd-workflow স্কিল  -> বাগ পুনরুৎপাদনকারী ব্যর্থ টেস্ট লেখা
                    -> সমাধান বাস্তবায়ন, টেস্ট পাস নিশ্চিত
/code-review        -> রিগ্রেশন পরীক্ষা
```

---

## প্রায়শই জিজ্ঞাসিত প্রশ্ন

<details>
<summary><b>ইনস্টল করা এজেন্ট/কমান্ড কীভাবে দেখব?</b></summary>

```bash
/plugin list ecc@ecc
```

</details>

<details>
<summary><b>Cursor / OpenCode / Codex-এও কাজ করে?</b></summary>

হ্যাঁ। ECC ক্রস-প্ল্যাটফর্ম — Claude Code, Cursor, OpenCode, Codex, Antigravity এবং আরও অনেক হার্নেসে কাজ করে।
</details>

<details>
<summary><b>নতুন স্কিল বা এজেন্ট অবদান রাখতে চাই</b></summary>

[CONTRIBUTING.md](../../CONTRIBUTING.md) দেখুন। সংক্ষেপে: ফর্ক করুন, ব্রাঞ্চ তৈরি করুন, স্কিল/এজেন্ট তৈরি করুন, PR জমা দিন।
</details>

---

## অবদান রাখুন

**অবদান স্বাগত।** নির্দেশনার জন্য [CONTRIBUTING.md](../../CONTRIBUTING.md) দেখুন।

---

## স্পনসর

এই প্রজেক্ট বিনামূল্যে ওপেন সোর্স। স্পনসরদের সহায়তায় রক্ষণাবেক্ষণ ও উন্নয়ন চলে।

[**স্পনসর হন**](https://github.com/sponsors/affaan-m) | [স্পনসর টায়ার](../../SPONSORS.md)

---

## লাইসেন্স

MIT - স্বাধীনভাবে ব্যবহার করুন, প্রয়োজনমতো পরিবর্তন করুন, এবং সম্ভব হলে অবদান রাখুন।

---

**এই রিপোজিটরি সহায়ক হলে Star দিন। দারুণ কিছু তৈরি করুন।**
