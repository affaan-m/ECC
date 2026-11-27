---
name: data-scraper-agent
description: 构建一个全自动化的AI驱动数据收集代理，适用于任何公共来源——招聘网站、价格信息、新闻、GitHub、体育赛事等任何内容。按计划进行抓取，使用免费LLM（Gemini Flash）丰富数据，将结果存储在Notion/Sheets/Supabase中，并从用户反馈中学习。完全免费在GitHub Actions上运行。适用于用户希望自动监控、收集或跟踪任何公共数据的场景。
origin: community
---

# 数据抓取代理

构建一个生产就绪、AI驱动的数据收集代理，适用于任何公共数据源。
按计划运行，使用免费LLM丰富结果，存储到数据库，并随时间推移不断改进。

**技术栈：Python · Gemini Flash (免费) · GitHub Actions (免费) · Notion / Sheets / Supabase**

## 何时激活

* 用户想要抓取或监控任何公共网站或API
* 用户说"构建一个检查...的机器人"、"为我监控X"、"从...收集数据"
* 用户想要跟踪工作、价格、新闻、仓库、体育比分、事件、列表
* 用户询问如何自动化数据收集而无需支付托管费用
* 用户想要一个能根据他们的决策随时间推移变得更智能的代理

## 核心概念

### 三层架构

每个数据抓取代理都有三层：

```
COLLECT → ENRICH → STORE
  │           │        │
Scraper    AI (LLM)  Database
runs on    scores/   Notion /
schedule   summarises Sheets /
           & classifies Supabase
```

### 免费技术栈

| 层级 | 工具 | 原因 |
|---|---|---|
| **抓取** | `requests` + `BeautifulSoup` | 无成本，覆盖80%的公共网站 |
| **JS渲染的网站** | `playwright` (免费) | 当HTML抓取失败时使用 |
| **AI丰富** | 通过REST API的Gemini Flash | 500次请求/天，100万令牌/天 — 免费 |
| **存储** | Notion API | 免费层级，用于审查的优秀UI |
| **调度** | GitHub Actions cron | 对公共仓库免费 |
| **学习** | 仓库中的JSON反馈文件 | 零基础设施，在git中持久化 |

### AI模型后备链

构建代理以在配额耗尽时自动在Gemini模型间回退：

```
gemini-2.0-flash-lite (30 RPM) →
gemini-2.0-flash (15 RPM) →
gemini-2.5-flash (10 RPM) →
gemini-flash-lite-latest (fallback)
```

### 批量API调用以提高效率

切勿为每个项目单独调用LLM。始终批量处理：

```python
# BAD: 33 API calls for 33 items
for item in items:
    result = call_ai(item)  # 33 calls → hits rate limit

# GOOD: 7 API calls for 33 items (batch size 5)
for batch in chunks(items, size=5):
    results = call_ai(batch)  # 7 calls → stays within free tier
```

***

## 工作流程

### 步骤 1: 理解目标

询问用户：

1. **收集什么：** "数据源是什么？URL / API / RSS / 公共端点？"
2. **提取什么：** "哪些字段重要？标题、价格、URL、日期、分数？"
3. **如何存储：** "结果应该存储在哪里？Notion、Google Sheets、Supabase，还是本地文件？"
4. **如何丰富：** "您希望AI对每个项目进行评分、总结、分类或匹配吗？"
5. **频率：** "应该多久运行一次？每小时、每天、每周？"

常见的提示示例：

* 招聘网站 → 根据简历评分相关性
* 产品价格 → 降价时发出警报
* GitHub仓库 → 总结新版本
* 新闻源 → 按主题+情感分类
* 体育结果 → 提取统计数据到跟踪器
* 活动日历 → 按兴趣筛选

***

### 步骤 2: 设计代理架构

为用户生成以下目录结构：

```
my-agent/
├── config.yaml              # 用户自定义此文件（关键词、过滤器、偏好设置）
├── profile/
│   └── context.md           # AI 使用的用户上下文（简历、兴趣、标准）
├── scraper/
│   ├── __init__.py
│   ├── main.py              # 协调器：抓取 → 丰富 → 存储
│   ├── filters.py           # 基于规则的预过滤器（快速，在 AI 处理之前）
│   └── sources/
│       ├── __init__.py
│       └── source_name.py   # 每个数据源一个文件
├── ai/
│   ├── __init__.py
│   ├── client.py            # Gemini REST 客户端，带模型回退
│   ├── pipeline.py          # 批量 AI 分析
│   ├── jd_fetcher.py        # 从 URL 获取完整内容（可选）
│   └── memory.py            # 从用户反馈中学习
├── storage/
│   ├── __init__.py
│   └── notion_sync.py       # 或 sheets_sync.py / supabase_sync.py
├── data/
│   └── feedback.json        # 用户决策历史（自动更新）
├── .env.example
├── setup.py                 # 一次性数据库/模式创建
├── enrich_existing.py       # 对旧行进行 AI 分数回填
├── requirements.txt
└── .github/
    └── workflows/
        └── scraper.yml      # GitHub Actions 计划任务
```

***

### 步骤 3: 构建抓取器源

适用于任何数据源的模板：

```python
# scraper/sources/my_source.py
"""
[Source Name] — scrapes [what] from [where].
Method: [REST API / HTML scraping / RSS feed]
"""
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone
from scraper.filters import is_relevant

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; research-bot/1.0)",
}


def fetch() -> list[dict]:
    """
    Returns a list of items with consistent schema.
    Each item must have at minimum: name, url, date_found.
    """
    results = []

    # ---- REST API source ----
    resp = requests.get("https://api.example.com/items", headers=HEADERS, timeout=15)
    if resp.status_code == 200:
        for item in resp.json().get("results", []):
            if not is_relevant(item.get("title", "")):
                continue
            results.append(_normalise(item))

    return results


def _normalise(raw: dict) -> dict:
    """Convert raw API/HTML data to the standard schema."""
    return {
        "name": raw.get("title", ""),
        "url": raw.get("link", ""),
        "source": "MySource",
        "date_found": datetime.now(timezone.utc).date().isoformat(),
        # add domain-specific fields here
    }
```

**HTML抓取模式：**

```python
soup = BeautifulSoup(resp.text, "lxml")
for card in soup.select("[class*='listing']"):
    title = card.select_one("h2, h3").get_text(strip=True)
    link = card.select_one("a")["href"]
    if not link.startswith("http"):
        link = f"https://example.com{link}"
```

**RSS源模式：**

```python
import xml.etree.ElementTree as ET
root = ET.fromstring(resp.text)
for item in root.findall(".//item"):
    title = item.findtext("title", "")
    link = item.findtext("link", "")
```

***

### 步骤 4: 构建Gemini AI客户端

````python
# ai/client.py
import os, json, time, requests

_last_call = 0.0

MODEL_FALLBACK = [
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-flash-lite-latest",
]


def generate(prompt: str, model: str = "", rate_limit: float = 7.0) -> dict:
    """Call Gemini with auto-fallback on 429. Returns parsed JSON or {}."""
    global _last_call

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        return {}

    elapsed = time.time() - _last_call
    if elapsed < rate_limit:
        time.sleep(rate_limit - elapsed)

    models = [model] + [m for m in MODEL_FALLBACK if m != model] if model else MODEL_FALLBACK
    _last_call = time.time()

    for m in models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.3,
                "maxOutputTokens": 2048,
            },
        }
        try:
            resp = requests.post(url, json=payload, timeout=30)
            if resp.status_code == 200:
                return _parse(resp)
            if resp.status_code in (429, 404):
                time.sleep(1)
                continue
            return {}
        except requests.RequestException:
            return {}

    return {}


def _parse(resp) -> dict:
    try:
        text = (
            resp.json()
            .get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
            .strip()
        )
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0]
        return json.loads(text)
    except (json.JSONDecodeError, KeyError):
        return {}
````

***

### 步骤 5: 构建AI管道（批量）

```python
# ai/pipeline.py
import json
import yaml
from pathlib import Path
from ai.client import generate

def analyse_batch(items: list[dict], context: str = "", preference_prompt: str = "") -> list[dict]:
    """Analyse items in batches. Returns items enriched with AI fields."""
    config = yaml.safe_load((Path(__file__).parent.parent / "config.yaml").read_text())
    model = config.get("ai", {}).get("model", "gemini-2.5-flash")
    rate_limit = config.get("ai", {}).get("rate_limit_seconds", 7.0)
    min_score = config.get("ai", {}).get("min_score", 0)
    batch_size = config.get("ai", {}).get("batch_size", 5)

    batches = [items[i:i + batch_size] for i in range(0, len(items), batch_size)]
    print(f"  [AI] {len(items)} items → {len(batches)} API calls")

    enriched = []
    for i, batch in enumerate(batches):
        print(f"  [AI] Batch {i + 1}/{len(batches)}...")
        prompt = _build_prompt(batch, context, preference_prompt, config)
        result = generate(prompt, model=model, rate_limit=rate_limit)

        analyses = result.get("analyses", [])
        for j, item in enumerate(batch):
            ai = analyses[j] if j < len(analyses) else {}
            if ai:
                score = max(0, min(100, int(ai.get("score", 0))))
                if min_score and score < min_score:
                    continue
                enriched.append({**item, "ai_score": score, "ai_summary": ai.get("summary", ""), "ai_notes": ai.get("notes", "")})
            else:
                enriched.append(item)

    return enriched


def _build_prompt(batch, context, preference_prompt, config):
    priorities = config.get("priorities", [])
    items_text = "\n\n".join(
        f"Item {i+1}: {json.dumps({k: v for k, v in item.items() if not k.startswith('_')})}"
        for i, item in enumerate(batch)
    )

    return f"""Analyse these {len(batch)} items and return a JSON object.

# Items
{items_text}

# User Context
{context[:800] if context else "Not provided"}

# User Priorities
{chr(10).join(f"- {p}" for p in priorities)}

{preference_prompt}

# Instructions
Return: {{"analyses": [{{"score": <0-100>, "summary": "<2 sentences>", "notes": "<why this matches or doesn't>"}} for each item in order]}}
Be concise. Score 90+=excellent match, 70-89=good, 50-69=ok, <50=weak."""
```

***

### 步骤 6: 构建反馈学习系统

```python
# ai/memory.py
"""Learn from user decisions to improve future scoring."""
import json
from pathlib import Path

FEEDBACK_PATH = Path(__file__).parent.parent / "data" / "feedback.json"


def load_feedback() -> dict:
    if FEEDBACK_PATH.exists():
        try:
            return json.loads(FEEDBACK_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"positive": [], "negative": []}


def save_feedback(fb: dict):
    FEEDBACK_PATH.parent.mkdir(parents=True, exist_ok=True)
    FEEDBACK_PATH.write_text(json.dumps(fb, indent=2))


def build_preference_prompt(feedback: dict, max_examples: int = 15) -> str:
    """Convert feedback history into a prompt bias section."""
    lines = []
    if feedback.get("positive"):
        lines.append("# Items the user LIKED (positive signal):")
        for e in feedback["positive"][-max_examples:]:
            lines.append(f"- {e}")
    if feedback.get("negative"):
        lines.append("\n# Items the user SKIPPED/REJECTED (negative signal):")
        for e in feedback["negative"][-max_examples:]:
            lines.append(f"- {e}")
    if lines:
        lines.append("\nUse these patterns to bias scoring on new items.")
    return "\n".join(lines)
```

**与存储层集成：** 每次运行后，从数据库中查询具有正面/负面状态的项，并使用提取的模式调用 `save_feedback()`。

***

### 步骤 7: 构建存储（Notion示例）

```python
# storage/notion_sync.py
import os
from notion_client import Client
from notion_client.errors import APIResponseError

_client = None

def get_client():
    global _client
    if _client is None:
        _client = Client(auth=os.environ["NOTION_TOKEN"])
    return _client

def get_existing_urls(db_id: str) -> set[str]:
    """Fetch all URLs already stored — used for deduplication."""
    client, seen, cursor = get_client(), set(), None
    while True:
        resp = client.databases.query(database_id=db_id, page_size=100, **{"start_cursor": cursor} if cursor else {})
        for page in resp["results"]:
            url = page["properties"].get("URL", {}).get("url", "")
            if url: seen.add(url)
        if not resp["has_more"]: break
        cursor = resp["next_cursor"]
    return seen

def push_item(db_id: str, item: dict) -> bool:
    """Push one item to Notion. Returns True on success."""
    props = {
        "Name": {"title": [{"text": {"content": item.get("name", "")[:100]}}]},
        "URL": {"url": item.get("url")},
        "Source": {"select": {"name": item.get("source", "Unknown")}},
        "Date Found": {"date": {"start": item.get("date_found")}},
        "Status": {"select": {"name": "New"}},
    }
    # AI fields
    if item.get("ai_score") is not None:
        props["AI Score"] = {"number": item["ai_score"]}
    if item.get("ai_summary"):
        props["Summary"] = {"rich_text": [{"text": {"content": item["ai_summary"][:2000]}}]}
    if item.get("ai_notes"):
        props["Notes"] = {"rich_text": [{"text": {"content": item["ai_notes"][:2000]}}]}

    try:
        get_client().pages.create(parent={"database_id": db_id}, properties=props)
        return True
    except APIResponseError as e:
        print(f"[notion] Push failed: {e}")
        return False

def sync(db_id: str, items: list[dict]) -> tuple[int, int]:
    existing = get_existing_urls(db_id)
    added = skipped = 0
    for item in items:
        if item.get("url") in existing:
            skipped += 1; continue
        if push_item(db_id, item):
            added += 1; existing.add(item["url"])
        else:
            skipped += 1
    return added, skipped
```

***

### 步骤 8: 在 main.py 中编排

```python
# scraper/main.py
import os, sys, yaml
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

from scraper.sources import my_source          # add your sources

# NOTE: This example uses Notion. If storage.provider is "sheets" or "supabase",
# replace this import with storage.sheets_sync or storage.supabase_sync and update
# the env var and sync() call accordingly.
from storage.notion_sync import sync

SOURCES = [
    ("My Source", my_source.fetch),
]

def ai_enabled():
    return bool(os.environ.get("GEMINI_API_KEY"))

def main():
    config = yaml.safe_load((Path(__file__).parent.parent / "config.yaml").read_text())
    provider = config.get("storage", {}).get("provider", "notion")

    # Resolve the storage target identifier from env based on provider
    if provider == "notion":
        db_id = os.environ.get("NOTION_DATABASE_ID")
        if not db_id:
            print("ERROR: NOTION_DATABASE_ID not set"); sys.exit(1)
    else:
        # Extend here for sheets (SHEET_ID) or supabase (SUPABASE_TABLE) etc.
        print(f"ERROR: provider '{provider}' not yet wired in main.py"); sys.exit(1)

    config = yaml.safe_load((Path(__file__).parent.parent / "config.yaml").read_text())
    all_items = []

    for name, fetch_fn in SOURCES:
        try:
            items = fetch_fn()
            print(f"[{name}] {len(items)} items")
            all_items.extend(items)
        except Exception as e:
            print(f"[{name}] FAILED: {e}")

    # Deduplicate by URL
    seen, deduped = set(), []
    for item in all_items:
        if (url := item.get("url", "")) and url not in seen:
            seen.add(url); deduped.append(item)

    print(f"Unique items: {len(deduped)}")

    if ai_enabled() and deduped:
        from ai.memory import load_feedback, build_preference_prompt
        from ai.pipeline import analyse_batch

        # load_feedback() reads data/feedback.json written by your feedback sync script.
        # To keep it current, implement a separate feedback_sync.py that queries your
        # storage provider for items with positive/negative statuses and calls save_feedback().
        feedback = load_feedback()
        preference = build_preference_prompt(feedback)
        context_path = Path(__file__).parent.parent / "profile" / "context.md"
        context = context_path.read_text() if context_path.exists() else ""
        deduped = analyse_batch(deduped, context=context, preference_prompt=preference)
    else:
        print("[AI] Skipped — GEMINI_API_KEY not set")

    added, skipped = sync(db_id, deduped)
    print(f"Done — {added} new, {skipped} existing")

if __name__ == "__main__":
    main()
```

***

### 步骤 9: GitHub Actions工作流

```yaml
# .github/workflows/scraper.yml
name: Data Scraper Agent

on:
  schedule:
    - cron: "0 */3 * * *"  # every 3 hours — adjust to your needs
  workflow_dispatch:        # allow manual trigger

permissions:
  contents: write   # required for the feedback-history commit step

jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
          cache: "pip"

      - run: pip install -r requirements.txt

      # Uncomment if Playwright is enabled in requirements.txt
      # - name: Install Playwright browsers
      #   run: python -m playwright install chromium --with-deps

      - name: Run agent
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          NOTION_DATABASE_ID: ${{ secrets.NOTION_DATABASE_ID }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        run: python -m scraper.main

      - name: Commit feedback history
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/feedback.json || true
          git diff --cached --quiet || git commit -m "chore: update feedback history"
          git push
```

***

### 步骤 10: config.yaml 模板

```yaml
# Customise this file — no code changes needed

# What to collect (pre-filter before AI)
filters:
  required_keywords: []      # item must contain at least one
  blocked_keywords: []       # item must not contain any

# Your priorities — AI uses these for scoring
priorities:
  - "example priority 1"
  - "example priority 2"

# Storage
storage:
  provider: "notion"         # notion | sheets | supabase | sqlite

# Feedback learning
feedback:
  positive_statuses: ["Saved", "Applied", "Interested"]
  negative_statuses: ["Skip", "Rejected", "Not relevant"]

# AI settings
ai:
  enabled: true
  model: "gemini-2.5-flash"
  min_score: 0               # filter out items below this score
  rate_limit_seconds: 7      # seconds between API calls
  batch_size: 5              # items per API call
```

***

## 常见抓取模式

### 模式 1: REST API（最简单）

```python
resp = requests.get(url, params={"q": query}, headers=HEADERS, timeout=15)
items = resp.json().get("results", [])
```

### 模式 2: HTML抓取

```python
soup = BeautifulSoup(resp.text, "lxml")
for card in soup.select(".listing-card"):
    title = card.select_one("h2").get_text(strip=True)
    href = card.select_one("a")["href"]
```

### 模式 3: RSS源

```python
import xml.etree.ElementTree as ET
root = ET.fromstring(resp.text)
for item in root.findall(".//item"):
    title = item.findtext("title", "")
    link = item.findtext("link", "")
    pub_date = item.findtext("pubDate", "")
```

### 模式 4: 分页API

```python
page = 1
while True:
    resp = requests.get(url, params={"page": page, "limit": 50}, timeout=15)
    data = resp.json()
    items = data.get("results", [])
    if not items:
        break
    for item in items:
        results.append(_normalise(item))
    if not data.get("has_more"):
        break
    page += 1
```

### 模式 5: JS渲染页面（Playwright）

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto(url)
    page.wait_for_selector(".listing")
    html = page.content()
    browser.close()

soup = BeautifulSoup(html, "lxml")
```

***

## 需要避免的反模式

| 反模式 | 问题 | 修复方法 |
|---|---|---|
| 每个项目调用一次LLM | 立即达到速率限制 | 每次调用批量处理5个项目 |
| 代码中硬编码关键字 | 不可重用 | 将所有配置移动到 `config.yaml` |
| 没有速率限制的抓取 | IP被禁止 | 在请求之间添加 `time.sleep(1)` |
| 在代码中存储密钥 | 安全风险 | 始终使用 `.env` + GitHub Secrets |
| 没有去重 | 重复行堆积 | 在推送前始终检查URL |
| 忽略 `robots.txt` | 法律/道德风险 | 遵守爬虫规则；尽可能使用公共API |
| 使用 `requests` 处理JS渲染的网站 | 空响应 | 使用Playwright或查找底层API |
| `maxOutputTokens` 太低 | JSON截断，解析错误 | 对批量响应使用2048+ |

***

## 免费层级限制参考

| 服务 | 免费限制 | 典型用法 |
|---|---|---|
| Gemini Flash Lite | 30 RPM, 1500 RPD | 以3小时间隔约56次请求/天 |
| Gemini 2.0 Flash | 15 RPM, 1500 RPD | 良好的后备选项 |
| Gemini 2.5 Flash | 10 RPM, 500 RPD | 谨慎使用 |
| GitHub Actions | 无限（公共仓库） | 约20分钟/天 |
| Notion API | 无限 | 约200次写入/天 |
| Supabase | 500MB DB, 2GB传输 | 适用于大多数代理 |
| Google Sheets API | 300次请求/分钟 | 适用于小型代理 |

***

## 需求模板

```
requests==2.31.0
beautifulsoup4==4.12.3
lxml==5.1.0
python-dotenv==1.0.1
pyyaml==6.0.2
notion-client==2.2.1   # 如需使用 Notion
# playwright==1.40.0   # 针对 JS 渲染的站点，请取消注释
```

***

## 质量检查清单

在将代理标记为完成之前：

* \[ ] `config.yaml` 控制所有面向用户的设置 — 没有硬编码的值
* \[ ] `profile/context.md` 保存用于AI匹配的用户特定上下文
* \[ ] 在每次存储推送前通过URL进行去重
* \[ ] Gemini客户端具有模型后备链（4个模型）
* \[ ] 批量大小 ≤ 每个API调用5个项目
* \[ ] `maxOutputTokens` ≥ 2048
* \[ ] `.env` 在 `.gitignore` 中
* \[ ] 提供了用于入门的 `.env.example`
* \[ ] `setup.py` 在首次运行时创建数据库模式
* \[ ] `enrich_existing.py` 回填旧行的AI分数
* \[ ] GitHub Actions工作流在每次运行后提交 `feedback.json`
* \[ ] README涵盖：在<5分钟内设置，所需的密钥，自定义

***

## 真实世界示例

```
"为我构建一个监控 Hacker News 上 AI 初创公司融资新闻的智能体"
"从 3 家电商网站抓取产品价格并在降价时发出提醒"
"追踪标记有 'llm' 或 'agents' 的新 GitHub 仓库——并为每个仓库生成摘要"
"将 LinkedIn 和 Cutshort 上的首席运营官职位列表收集到 Notion 中"
"监控一个提到我公司的 subreddit 帖子——并进行情感分类"
"每日从 arXiv 抓取我关注主题的新学术论文"
"追踪体育赛事结果并在 Google Sheets 中维护动态更新的表格"
"构建一个房地产房源监控器——在新房源价格低于 1 千万卢比时发出提醒"
```

***

## 参考实现

一个使用此确切架构构建的完整工作代理将抓取4+个数据源，
批量处理Gemini调用，从存储在Notion中的"已应用"/"已拒绝"决策中学习，并且
在GitHub Actions上100%免费运行。按照上述步骤1-9构建您自己的代理。
