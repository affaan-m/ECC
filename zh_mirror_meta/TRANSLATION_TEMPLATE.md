# ECC 中文镜像翻译模板

所有翻译 agent 必须严格遵守本文档规定的翻译规则,产出格式必须 100% 一致。

## 通用规则

1. **镜像命名**:原位加 `_zh` 后缀
   - `docs/MANUAL-ADAPTATION-GUIDE.md` → `docs/MANUAL-ADAPTATION-GUIDE_zh.md`
   - `CONTRIBUTING.md` → `CONTRIBUTING_zh.md`
   - 例外:`README.zh-CN.md` 已是中文版,**不需要再翻译**,不动

2. **镜像内相对链接**:保留英文源链接
   - 原文 `[X](./X.md)` 翻译后仍是 `[X](./X.md)`(指向英文源)
   - 不改为 `_zh` 后缀
   - 不改为绝对 URL
   - 锚点 `#section` 保留

3. **图片 / 资源路径**:保留
   - `![Alt](./assets/x.png)` 翻译后仍指向 `./assets/x.png`
   - 资源文件**不复制**

4. **代码块**:整体保留英文不译
   - 包括 shell、JSON、YAML、TOML、TypeScript、Python、Go、Rust 等所有代码
   - 但**代码块内**的注释若为英文,**不译**(避免影响语法)
   - **代码块上方/下方**的说明段落可译

5. **行内代码反引号**:保留
   - `npm test` 在镜像中仍是 `npm test`
   - 命令名、文件名、变量名等一律保留

6. **翻译头(必填)**:在每个镜像文件第一行加入:
   ```
   <!-- 翻译镜像 · 源:<源文件相对路径> · 同步:<YYYY-MM-DD> · 方式:Workflow 多 agent -->
   ```
   占两行注释,空一行,然后是翻译内容。

7. **frontmatter(YAML)**:`description` 字段必须译
   - 译为中文,但保持单行(内联字符串)
   - 若 `description` 长度超过 200 字符,用 `>` 折叠,不用 `|` 字面块
   - 加 `description_en: <原文>` 镜像
   - 其他字段(name、origin、tools、model)保留英文

8. **章节标题**:用中文,但与原文章节一一对应(不增不减)

9. **翻译风格**:**中性贴近原文** —— 保留原文结构与措辞,不重写、不合并段落、不增删要点

## frontmatter 模板示例

### 原本有 frontmatter(原 description 较长)

原文:
```yaml
---
name: python-reviewer
description: Reviews Python code for quality, security, and idiomatic style
origin: ECC
tools: ["Read", "Grep", "Glob", "Bash"]
model: sonnet
---
```

译文(SKILL.md/agent frontmatter):
```yaml
<!-- 翻译镜像 · 源:agents/python-reviewer.md · 同步:2026-07-06 · 方式:Workflow 多 agent -->
---
name: python-reviewer
description: 审查 Python 代码,关注质量、安全和惯用风格
description_en: Reviews Python code for quality, security, and idiomatic style
origin: ECC
tools: ["Read", "Grep", "Glob", "Bash"]
model: sonnet
---
```

### description 长度超限,用 `>` 折叠

原文:
```yaml
description: This agent reviews TypeScript code for type safety, accessibility, performance, idiomatic React patterns, Next.js data fetching patterns, and security against injection, XSS, CSRF, and authentication bypass vectors
```

译文:
```yaml
description: >
  该智能体审查 TypeScript 代码,关注类型安全性、可访问性、性能、惯用的 React 模式,
  以及 Next.js 数据获取模式,并防范注入、XSS、CSRF 和认证绕过等安全漏洞。
description_en: This agent reviews TypeScript code for type safety, accessibility, performance, idiomatic React patterns, Next.js data fetching patterns, and security against injection, XSS, CSRF, and authentication bypass vectors
```

### 原本无 frontmatter

原文:
```markdown
# Some Doc

Content here.
```

译文:
```markdown
<!-- 翻译镜像 · 源:docs/SOMETHING.md · 同步:2026-07-06 · 方式:Workflow 多 agent -->
# Some Doc(这里是中文,比如"某些文档")

Content here.(这里是中文)
```

## 单链接保留的细节

| 原文形式 | 译文形式 | 说明 |
|----------|----------|------|
| `[X](./X.md)` | `[X](./X.md)` | 相对路径不变 |
| `[X](../X.md)` | `[X](../X.md)` | 相对路径不变 |
| `[X](https://...)` | `[X](https://...)` | URL 不动 |
| `[X][ref]` + `[ref]: ./X.md` | 保留 | 引用形式不动 |
| `<https://...>` | 保留 | 自动链接不动 |
| `<x@example.com>` | 保留 | 邮箱不动 |

## README 镜像特殊处理

`README_zh.md` 顶部语言链接**(只保留 3 个)**:

```markdown
**Language:** [English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](docs/zh-TW/README.md)
```

原 README.md 第 1 行 12 个语言链接会被改为只保留上述 3 个(原文也将被修改以避免死链)。

## 术语表

请严格使用 `GLOSSARY.md` 中的译法。术语漂移会破坏镜像一致性与可搜索性。

## 校验钩子

每次翻译后 `npm test` 必须继续通过。翻译 agent 不需要自己跑校验,但**必须严格遵守**以下硬约束,避免挂校验:

1. YAML frontmatter 必须能被 `validate-skills.js`、`validate-agents.js`、`validate-commands.js`、`validate-rules.js` 解析:
   - `description` 不能用 `|` / `|-` / `|+` 字面块
   - `description_en` 是新增字段,**默认情况下校验器会忽略未知字段**(已确认);但若严格模式会挂,改为 `description_en: "..."` 加引号形式
2. 文件名加 `_zh` 后缀后,**所有 `catalog:check` 不应误计** ——catalog 校验器只统计 `skills/`、`agents/`、`commands/`、`rules/` 的数量,不影响
3. 删除 `docs/{de-DE, es, ja-JP, ko-KR, pt-BR, ru, th, tr, vi-VN}` 后,修改 `package.json#files` 同步去掉这 7 项:
   - "docs/de-DE/"
   - "docs/ja-JP/"
   - "docs/ko-KR/"
   - "docs/pt-BR/"
   - "docs/ru/"
   - "docs/tr/"
   - "docs/vi-VN/"
4. README.md 第 1 行删除 9 个语种链接

## 完工后必报

每个翻译 agent 完工时,输出 markdown 表格:

```
| 源文件 | 镜像路径 | 字节数 | 行数 |
|--------|----------|--------|------|
| docs/Foo.md | docs/Foo_zh.md | NNN | NNN |
```
