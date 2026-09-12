# Interactive Elements

> **When to read this:** Phase 3, when writing module HTML. Use only the HTML patterns below — all CSS lives in `styles.css` and all behavior in `main.js`, which auto-initialize by scanning class names and `data-*` attributes. Never inline `<style>`/`<script>` for these.

Every course must include, somewhere: a **flow animation**, a **group chat**, **glossary tooltips**, a **quiz per module**, and a **command↔plain-English** block per module that has commands. Objectives + recap cards are required per module too.

## Learning objectives (after the header, once per module)
```html
<div class="objectives animate-in">
  <span class="objectives-eyebrow">🎯 学完本模块，你将能够</span>
  <ul class="objectives-list">
    <li>用动词开头、可检验的能力一</li>
    <li>能力二</li>
    <li>能力三</li>
  </ul>
</div>
```
3–4 items, each a concrete capability. Mirror the quiz.

## Recap (its own screen, right before the quiz)
```html
<div class="screen">
  <div class="recap animate-in">
    <span class="recap-eyebrow">✅ 本模块小结</span>
    <ul class="recap-list">
      <li>要点一</li><li>要点二</li><li>要点三</li>
    </ul>
  </div>
</div>
```
Each takeaway maps back to an objective. The card is green to signal "you've arrived".

## Command ↔ plain-English translation
Left = exact command/config from the docs; right = line-by-line plain English (the "why", not just the "what").
```html
<div class="translation-block animate-in">
  <div class="translation-code"><span class="translation-label">命令</span>
    <pre><code><span class="code-line">codex -m gpt-5.5</span></code></pre>
  </div>
  <div class="translation-english"><span class="translation-label">大白话</span>
    <div class="translation-lines"><p class="tl">…</p></div>
  </div>
</div>
```
Use `white-space` wrapping (built in) — never horizontal scroll. Use commands verbatim.

## Quiz (one per module, at the end)
`main.js` exposes `selectOption(btn)`, `checkQuiz(id)`, `resetQuiz(id)`. Per-question answer + explanations live on `.quiz-question-block` via `data-correct`, `data-explanation-right`, `data-explanation-wrong`.
```html
<div class="quiz-container" id="quiz-mN">
  <div class="scenario-block">
    <div class="scenario-context"><span class="scenario-label">场景</span><p>…situation…</p></div>
    <div class="quiz-question-block" data-correct="b"
         data-explanation-right="对，因为…" data-explanation-wrong="再想想：…">
      <div class="quiz-options">
        <button class="quiz-option" data-value="a" onclick="selectOption(this)"><div class="quiz-option-radio"></div><span>选项 A</span></button>
        <button class="quiz-option" data-value="b" onclick="selectOption(this)"><div class="quiz-option-radio"></div><span>选项 B</span></button>
      </div>
      <div class="quiz-feedback"></div>
    </div>
  </div>
  <button class="quiz-check-btn" onclick="checkQuiz('quiz-mN')">提交答案</button>
  <button class="quiz-reset-btn" onclick="resetQuiz('quiz-mN')">再试一次</button>
</div>
```
Drop the `.scenario-block` wrapper for a plain multiple-choice question. Quiz application, not memory: scenarios, "which surface/command", troubleshooting — never definitions.

## Group chat (≥1 per course)
`main.js` auto-inits each `.chat-window`. Messages start hidden; buttons reveal them with a typing indicator.
```html
<div class="chat-window animate-in" id="chat-mN">
  <div class="chat-messages">
    <div class="chat-message" data-msg="0" data-sender="you" style="display:none">
      <div class="chat-avatar" style="background: var(--color-actor-1)">你</div>
      <div class="chat-bubble"><span class="chat-sender" style="color: var(--color-actor-1)">你</span><p>…</p></div>
    </div>
    <!-- more .chat-message, incrementing data-msg -->
  </div>
  <div class="chat-typing" id="chat-mN-typing" style="display:none">
    <div class="chat-avatar">C</div>
    <div class="chat-typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>
  </div>
  <div class="chat-controls"><button class="btn chat-next-btn">下一条</button><button class="btn chat-all-btn">全部播放</button><button class="btn chat-reset-btn">重播</button><span class="chat-progress"></span></div>
</div>
```

## Flow / data animation (≥1 per course)
`main.js` auto-inits each `.flow-animation`. Steps are JSON in `data-steps`; actor element ids are `flow-actor-1`, `2`, … and `from`/`to` reference the numeric suffix.
```html
<div class="flow-animation" data-steps='[
  {"highlight":"flow-actor-1","label":"第一步"},
  {"highlight":"flow-actor-2","label":"传给下一个","packet":true,"from":"1","to":"2"}
]'>
  <div class="flow-actors">
    <div class="flow-actor" id="flow-actor-1"><div class="flow-actor-icon">🧑</div><span>你</span></div>
    <div class="flow-actor" id="flow-actor-2"><div class="flow-actor-icon">🧠</div><span>模型</span></div>
  </div>
  <div class="flow-packet" id="flow-packet"></div>
  <div class="flow-step-label" id="flow-label">点“下一步”开始</div>
  <div class="flow-controls"><button class="btn flow-next-btn">下一步</button><button class="btn flow-reset-btn">重来</button><span class="flow-progress"></span></div>
</div>
```
⚠️ No apostrophes inside labels — the attribute is single-quote delimited and they break `JSON.parse`.

## Glossary tooltips (every term, first use per module)
```html
<span class="term" data-definition="一句话、可带比喻的大白话定义。">沙箱</span>
```
`main.js` builds a fixed-position tooltip appended to `<body>` (never clipped). Be aggressive: acronyms and tool-specific nouns all get one.

## Callouts (1–2 per module)
```html
<div class="callout callout-accent">
  <div class="callout-icon">💡</div>
  <div class="callout-content"><strong class="callout-title">标题</strong><p>…</p></div>
</div>
```
Variants: `callout-accent` (insight), `callout-info` (good to know), `callout-warning` (common mistake).

## Cards & lists (replace prose lists)
- **Pattern cards** — `.pattern-cards > .pattern-card` with `.pattern-icon`, `.pattern-title`, `.pattern-desc`. For comparisons / "如果…就用…".
- **Icon rows** — `.icon-rows > .icon-row` with `.icon-circle` + `<strong>` + `<p>`. For labeled lists.
- **Step cards** — `.step-cards > .step-card` with `.step-num` + `.step-body`. For sequences and try-it checklists (put the expected result in the `<p>`).
- **Badge list** — `.badge-list > .badge-item` with `.badge-code` + `.badge-desc`. For annotating config keys / modes.
- **File tree** — `.file-tree` with `.ft-folder`/`.ft-file` (`.ft-name` + `.ft-desc`). For showing where files live.
