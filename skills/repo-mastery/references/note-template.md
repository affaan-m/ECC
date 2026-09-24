# Note Template — Note Format

> **Read in**: Phase 3. After each section's discussion, the tutor **automatically consolidates** the conversation (key takeaways + your Q&A conclusions + cheatsheet + blockers + Feynman records) into `notes/<module>.md` — the **per-turn diary**, always fresh on substance (mechanical turns skip it; see `session-flow.md` §7). `/repo-mastery note ["<text>"]` is the **manual interval complement**: it consolidates **the discussion since the last note** (deduplicated against the auto diary) into a `### Interval synthesis (区间整理)` recap block + the relevant sections, updates `notes/.boundary.json`, and appends any `<text>` verbatim to "My notes". Notes are the context for later review and sessions (absorbed from DeepTutor's notebook idea).

## Note file organization

```text
<repo>/.learning/notes/
  ├── m01-run-build.md     # one per module; named <module_id>-<slug>.md
  ├── m02-architecture.md
  ├── .boundary.json       # /note interval boundary: {"module_id": "m01", "last_consolidated_at": <unix>}
  └── README.md            # note index: module → file + one-line status
```

## Per-module note structure

```md
# Module N — <title>

> Status: in-progress / mastered / has-blockers
> Mastery: <module-level average | qualitative result>
> Last updated: <ISO date> <UTC time>

## Key points (auto-accumulated)
> Appended after each explanation. Each = one self-checkable takeaway with a source reference (file:line).

- **Takeaway title** — one-sentence conclusion. `src/pipeline.py:120` `RAG main chain: …`
- …

## Command / config cheatsheet
> Verbatim, so the user can copy-and-use.

```bash
deeptutor kb create physics --doc ch1.pdf
```

## Interval consolidation (/repo-mastery note)
> Manual, on-demand synthesis of the discussion **since the last note** — the differentiator vs the per-turn auto diary above. **Deduplicated**: never re-write what auto already wrote (repetition is wasted tokens). Boundary tracked in `notes/.boundary.json` — read it for the interval start, update it after each note; absent → from session/module start. Cross-session / pre-compaction intervals are recovered from this note + `records/`; unrecoverable detail is marked 「需回顾」 ("needs review"), never invented.

### Interval synthesis (区间整理) — <ISO date> <UTC>, since last note <time> — <one-line recap>
- <2–4 distilled takeaways from this interval's discussion>
- <new Mission links, if any>
- <Q&A conclusions / new blockers / cheatsheet additions / Feynman records — landed in their sections above, deduplicated>

## My notes (/note text)
> User-appended content via `/repo-mastery note "<text>"`, kept verbatim; the tutor never rewrites the user's words.

- 2026-08-07: I don't get why message queue instead of RPC here —— <user text>
- …

## Blockers
> Diagnosed blockers (error type + attribution), mapped to review tasks.

| Knowledge point | Blocker | Error type | Status |
|---|---|---|---|
| kp01-01 | don't understand async prerequisite | structural | active |

## Feynman self-check
> When a qualitative point passes, record the distilled version of the user's recital (one line).

- kp01-02 (concept): user recital = "…"

## Resources / primary sources (absorbed from the teach skill)
> Recommend 1 high-quality primary source per module for going deeper — official docs / design docs / papers / maintainer talks. This is the "keep going on your own" entry point.

- Official docs: <link>
- Design doc / ADR: <link>
- Source file worth reading closely: `file:line`

## Due reviews
> Synced from `progress.json`'s `review_queue`, for quick entry into review in later sessions.
```

## Division of labor: auto vs manual

- **Auto-consolidated** (tutor's job): after each section's discussion — and every other **substantive** turn — consolidate key points + Q&A conclusions + command cheatsheet + blocker table + Feynman self-checks + due reviews into the module note. Updated after each explanation and judgment; mechanical turns (review drain, simple confirmation) skip it and defer to the next substantive turn (see `session-flow.md` §7).
- **Manual trigger** (user's job): `/repo-mastery note ["<text>"]` consolidates **the discussion since the last note** — read `notes/.boundary.json` for the interval start (absent → session/module start), extract that interval's Q&A conclusions / new blockers / cheatsheet additions / Feynman records **deduplicated against the auto diary**, write a `### Interval synthesis (区间整理)` recap block, then update `notes/.boundary.json`. Any `<text>` goes verbatim into "My notes". **The tutor never rewrites the user's words** — but may register it as a blocker/review point in the Blockers section.

## Chapter material (textbook-mode) template — `chapters/<module>.md`

The textbook-mode deliverable (the default on entering each new module): a **complete chapter**
written up front, then taught section by section. It is the *material the tutor
teaches from* — distinct from the module note above (which stays a fragmented,
auto-consolidated diary of the discussion). One file per module, generated on
entering the module (large repos: pre-extract snippets via
`module-brief-template.md` into `briefs/` first).

```md
# Chapter N — <module title>（教材式）

> 学习方式：跟随材料逐节学习 → 课后答疑 → 课后检验 → 章节完成（模块级闸门）
> 材料生成: <ISO date> | 章节状态: teaching → qna → verifying → complete

## 0. 章节导言
> 为什么学这一章（价值 brief 里的一句话）→ 这一章解决什么问题 → 与前/后章的衔接。
> 一张全景图：模块在整体架构中的位置、模块内部结构、核心数据流。

## 1. <Section 标题 — 对应知识点>
> 每节 = 一个知识点。以下子结构逐节循环：

### 1.1 学习目标
> 本节学完你能回答什么问题（1-2 条，可检验）。

### 1.2 讲解 + 源码走读
> 讲解（概念 + 一个比喻 + 为什么这样设计）。源码走读用三段式：`file:line` 定位 →
> **关键片段**（教学核心）→ `<details>` 折叠的完整源码。逐节循环：

**Source walk** — `src/pipeline.py:120-125`

```python
# Key fragment (teaching core, 3-15 lines) — 教学核心，短而美
def build_chain(self):
    return rag_chain  # 检索 + 生成 串成一条链
```

<details><summary>Full source · `src/pipeline.py:120-125` (click to expand)</summary>

```python
# Full implementation — 完整实现，折叠展示
def build_chain(self):
    retriever = self._make_retriever(top_k=5)
    prompt = hub.pull("rag/prompt")
    llm = self._model
    return rag_chain
```
</details>

> Source-walk format notes（三段式格式说明）：
> - `file:line` stays as a locator — 仅作定位，学习者可回 IDE 看更广的上下文。
> - The key fragment is the teaching core — 教学核心，短而美（3-15 行）。It is cut
>   from the full source below (a subset of it) — 从下方完整源码中剪出的教学核心（子集）。
> - The full source lives in a `<details>` block（Markdown-compatible）：Claude Code
>   终端与 GitHub 上均可折叠，HTML 课程渲染同样折叠。
> - The code-fence language follows the source file's extension (py/c/ts/go/rs…) —
>   代码围栏语言跟随文件扩展名（py/c/ts/go/rs…）。Otherwise the HTML course
>   highlighting breaks — 否则 HTML 课程语法高亮失效。

### 1.3 小结
> 3-4 条 takeaways，可自查。

### 1.4 课后思考题
> 1-2 题深度题（trace / why / tradeoff，非记忆题）。
> **kp_id 标注**：必须对应 course-map 的 knowledge_point_id——
> 课后检验时 tutor 用这些题走引擎判定（concept/design → set-qualitative，
> procedure → record-attempt）。

## 2. 章节总结
> 一张「本章学到了什么」的收束：模块心智模型 + 关键 file:line 索引 + 与整体架构的钩子。

## 3. Cheatsheet
> 命令/参数/API 拼写 verbatim（memory 型内容，参考性，不进闸门）。

## 4. 课后检验记录
> （课后阶段追加）关键节点检验结果：kp_id → 判定 passed/failed →
> 引擎返回（qualitative_mastery / mastery）→ 未检验点初始化的复习计划。
```

Key differences vs the per-module note: written **up front, complete**; sections
map 1:1 to knowledge points **with kp_id on the after-class reflection questions (课后思考题)**; it is a teaching
carrier (the tutor walks it), not a discussion diary.

## Iron rules

- Source references in notes carry `file:line` for traceability.
- Commands/config must be verbatim (the user will copy them).
- Notes update **incrementally**: append new content, don't rewrite the whole file (token economy).
- Review sessions read notes first rather than re-reading source — notes are your long-term memory.
- Chapter after-class reflection questions (课后思考题) must carry the course-map `kp_id` — without it after-class checking cannot go through the engine gate.
- `/repo-mastery note` consolidates the **interval since the last note**, deduplicated against the auto diary — never re-write what auto already wrote; pre-compaction interval content is recovered from notes/`records/`, never invented.
