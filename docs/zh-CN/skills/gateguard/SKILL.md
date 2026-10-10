---
name: gateguard
description: 强制事实的门控，阻止编辑/写入/Bash（包括MultiEdit），并要求在允许操作之前进行具体调查（导入器、数据模式、用户指令）。与无门控代理相比，可测量地将输出质量提高2.25分。
origin: community
---

# GateGuard — 事实驱动的前置操作门控

一个 PreToolUse 钩子，强制 Claude 在编辑前进行调查。不同于自我评估（"你确定吗？"），它要求具体的事实。调查行为本身创造了自我评估永远无法带来的认知。

## 何时激活

* 处理任何文件编辑会影响多个模块的代码库时
* 项目包含具有特定模式或日期格式的数据文件时
* 团队要求 AI 生成的代码必须匹配现有模式时
* 任何 Claude 倾向于猜测而非调查的工作流程中

## 核心概念

LLM 的自我评估不起作用。问"你是否违反了任何策略？"答案永远是"没有"。这已通过实验验证。

但问"列出所有导入此模块的文件"会迫使 LLM 运行 Grep 和 Read。调查本身创造了改变输出的上下文。

**三阶段门控：**

```
1. DENY  — 阻止首次编辑/写入/Bash 尝试
2. FORCE — 明确告知模型需要收集哪些事实
3. ALLOW — 在事实呈现后允许重试
```

没有竞争对手能同时做到这三步。大多数止步于拒绝。

## 证据

两个独立的 A/B 测试，相同的代理，相同的任务：

| 任务 | 有门控 | 无门控 | 差距 |
| --- | --- | --- | --- |
| 分析模块 | 8.0/10 | 6.5/10 | +1.5 |
| Webhook 验证器 | 10.0/10 | 7.0/10 | +3.0 |
| **平均** | **9.0** | **6.75** | **+2.25** |

两个代理生成的代码都能运行并通过测试。区别在于设计深度。

## 门控类型

### 编辑/多编辑门控（每个文件的首次编辑）

多编辑的处理方式相同——批次中的每个文件都单独进行门控。

```
在编辑 {file_path} 之前，请先呈现以下事实：

1. 列出所有导入/引用此文件的文件（在代码树中搜索——Glob/Grep，或通过 Bash 用 find/grep）
2. 列出受此更改影响的公共函数/类
3. 如果此文件读取/写入数据文件，请显示字段名称、结构以及日期格式（使用脱敏或合成值，而非原始生产数据）
4. 逐字引用用户当前的指令
```

### 写入门控（首次创建新文件）

```
在创建 {file_path} 之前，请先说明以下事实：

1. 命名将调用此新文件的文件及行号
2. 确认没有现有文件具有相同功能（在代码树中搜索——Glob/Grep，或通过 Bash 用 find/grep）
3. 如果此文件读取/写入数据文件，请展示字段名称、结构及日期格式（使用脱敏或合成值，而非原始生产数据）
4. 逐字引用用户当前的指令
```

### 破坏性 Bash 门控（每个破坏性命令）

触发条件：`rm -rf`、`git reset --hard`、`git push --force`、`drop table` 等。

```
1. 列出此命令将修改或删除的所有文件/数据
2. 编写一行回滚步骤
3. 逐字引用用户当前的指令
```

### 常规 Bash 门控（每个会话一次）

```
1. 当前用户请求的一句话概括
2. 此特定命令验证或生成的内容
```

## 按目标类别提问与已完成调查的认定

以上编辑/写入门控的问题适用于 **code** 类目标。完整规则见英文版 `skills/gateguard/SKILL.md`，要点如下：

* **目标类别：** 首次编辑/写入按项目相对路径（去掉开头的 `.claude/worktrees/<name>/`）依次判定为 instruction（`CLAUDE.md`、`AGENTS.md`、`SKILL.md`、`.mdc`、`.cursorrules`、`.github/copilot-instructions.md` 等）、test、prose（`.md` 等）、config（`.json`、`.yaml`、`.env` / `.env.*` 等，`.env.example.ts` 仍属 code）或 code，并提出相应的问题。
* **按变更内容提问：** 对 code 类目标还会读取变更内容：未触及公开声明的编辑改问"本文件或其模块中依赖所改行为的调用点"，不涉及数据的变更省略数据格式问题；无法可靠判断（不支持的扩展名、超过 64 KiB 等）以及敏感目标时仍问原来的四个问题。
* **事先搜索抵免：** 若当前人类回合内已有成功完成（非错误结果）的 `Glob`、`Grep`、`LS` 或 `rg`/`grep`/`find` 等搜索命中该文件，则以附注代替拒绝。`Read` 从不计入；与被门控调用同批次的搜索、重复的 tool_use id、压缩（compaction）之前的搜索均不计入。文件名词干须按单词边界匹配（测试目标先去掉一个测试词缀：`.test`、`.spec`，以及 Python/Go 的 `test_`/`_test`，因此 `rg tokenizer src tests` 可抵免 `tests/tokenizer.test.js`，而 `index.test.js` 仍是通用词干 `index`），且目标须位于所搜索目录之内（shell 片段按其路径参数或 `cwd` 判定范围；参数前的输入重定向 `<` 视为读取 stdin）。仅"创建尚不存在的文件"的写入可按目录匹配，且 shell 参数须是真实存在的目录；回合内出现 `cd` 等切换目录命令时不再按 shell 目录匹配。相对路径按工具的 `cwd` 解析。排除规则从不计入：`Grep` 的 `glob` 中以 `!` 开头的项，以及 shell 中 `rg -g '!x'`、`grep --exclude`/`--exclude-dir`、`fd -E`、`ls -I`、`tree -I`、`git ls-files -x`、git `:!x` 路径规格、带 `-not`/`!` 或后接 `-prune` 的 `find -name`/`-path`、PowerShell `-Exclude` 都不作为词干来源；若排除项覆盖目标（文件名、路径上的目录或词干），该搜索完全不能为其抵免（`rg -g '!widget.py' TODO .` 不抵免 `widget.py`，`rg -g '!*.md' widget .` 仍抵免）。含 `--exclude-from`/`--ignore-file` 的片段不抵免；用 `*.py`、`--include`、`find -name` 等文件名 glob 限定的搜索，只有在其匹配目标文件名时词干才计入。
* **仅注释/空白的编辑：** 对受支持语言中非敏感的 code/test/prose 文件，只改动注释和空白的编辑（MultiEdit 须该文件的所有条目都如此）以附注放行并计入 `trivial_allows`，但不标记为已检查，下一次改动代码的编辑仍按首次触碰门控（写入、Python 缩进变化、多行字符串等从不算作此类编辑）。
* **拒绝中指出最接近的未计入搜索：** 非敏感目标被拒绝且本回合有提及该文件却未能抵免的调用时，拒绝消息追加一行"Closest search this turn did not count (...)"，说明最接近的一个及原因（同批次、被排除、范围外、读取 stdin、`Read` 等非搜索、文件名过于通用）；细节经净化并截断至 60 个字符。
* **同回合同级文件合并：** 同一目录、同一类别（仅 code、test、prose）的新文件在同一回合内（完全没有 transcript 路径时为 120 秒内）只拒绝第一个，其余以附注放行。config、instruction，以及任何以 `.` 开头的路径段（点文件和所有点目录）或 8.3 短文件名下的文件从不合并；目录按解析符号链接后的真实位置判定和记录；有 transcript 路径但文件缺失、无法读取或得不到回合 ID 时不合并；编辑从不合并。
* **拒绝上限（可选）：** 设置 `GATEGUARD_FACT_FORCE_MAX_DENIALS` 后，会话内首次触碰的拒绝次数达到该值后，新路径直接放行（计入 `cap_allows`）。`GATEGUARD_FACT_FORCE_FULL_DENIALS` 只决定消息详略（消息预算），而此变量决定是否拦截（拒绝预算）。事先搜索抵免和同级合并先于上限判定，不消耗上限；格式错误的值视为无上限，并在 stderr 警告一次。
* **敏感目标：** `.env`/`.env.*`、`*.pem`/`*.key`/`*.p12`/`*.pfx`、`id_rsa*`/`id_ed25519*`/`id_ecdsa*`/`id_dsa*`/`.netrc`/`.pgpass`/`credentials*`/`secrets.*`、任一路径段恰为 `auth`、`authn`、`authz`、`security`、`secrets`、`payment`、`payments`、`billing`、`migrations`，以及 `.github/workflows/` 下的文件，不适用抵免、合并和上限，首次触碰总是拒绝。按字面路径和解析符号链接后的真实位置同时判定（`src/tools -> ../auth` 时 `src/tools/login.py` 也是敏感目标），真实位置无法解析时视为敏感。判定顺序：exempt → subagent → checked → 敏感或硬链接? → 抵免 → 同级合并 → 上限 → 拒绝。`GATEGUARD_EXEMPT_GLOBS` 的豁免优先于一切规则，对敏感目标和硬链接目标同样生效。
* **硬链接目标：** 链接数大于 1 的文件（或指向此类文件的符号链接）可经其他名称访问，因此与敏感目标一样不适用抵免、变更画像、仅注释放行、同级合并、上限和子代理放行；拒绝消息附带 "Hard-linked target: ..." 一行而非敏感目标一行。除文件不存在外的任何 stat 错误都视为硬链接。
* **NotebookEdit：** 按对 `notebook_path` 的编辑门控（相同的类别、已检查键、抵免与上限规则；不读取单元格内容，因此总是完整问题，也从不按仅注释放行）。
* **例行 shell 门控与会话：** 门控触发前，只读命令（`ls`、`cat`、`rg`、`git status`/`log`/`diff`、`Get-ChildItem` 等，不含重定向、替换、`tee`、`xargs` 或未知命令）直接放行且不消耗门控，计入 `routine_readonly_passes`；以会话 ID 或 transcript 路径为键的状态空闲 8 小时失效，项目目录回退键仍为 30 分钟；子代理对敏感目标每个路径拒绝一次（不会为父会话解锁）。
* **判定指标（可选）：** 设置 `GATEGUARD_METRICS=1` 后，每次判定向 `<GATEGUARD_STATE_DIR>/metrics.jsonl` 追加一行（不记录路径、命令或内容，超过 1 MiB 轮转为 `.1`）；用 `node scripts/gateguard-report.js [--dir <path>] [--json]` 汇总。
* **兼容性：** 新增的环境变量只有可选的 `GATEGUARD_FACT_FORCE_MAX_DENIALS` 和 `GATEGUARD_METRICS`；除子代理首次触碰敏感或硬链接目标、以及每个笔记本的首次 NotebookEdit（此前不受门控）外，以前允许的操作不会变为拒绝，且从不返回 `permissionDecision: "allow"`。

## 快速开始

### 选项 A：使用 ECC 钩子（零安装）

`scripts/hooks/gateguard-fact-force.js` 处的钩子已包含在此插件中。通过 hooks.json 启用它。

如果 GateGuard 阻止了设置或修复工作，请使用
`ECC_GATEGUARD=off` 启动会话。如需钩子级别的控制，请继续使用
`ECC_DISABLED_HOOKS` 配合 GateGuard 钩子 ID。

### 选项 B：带配置的完整包

```bash
pip install gateguard-ai
gateguard init
```

这会添加 `.gateguard.yml` 用于按项目配置（自定义消息、忽略路径、门控开关）。

## 反模式

* **不要使用自我评估替代。** "你确定吗？"总是得到"确定。"这已通过实验验证。
* **不要跳过数据模式检查。** 两个 A/B 测试代理都假设了 ISO-8601 日期，而实际数据使用的是 `%Y/%m/%d %H:%M`。检查数据结构（使用脱敏值）可以防止这类错误。
* **不要对每个 Bash 命令都进行门控。** 常规 bash 门控每个会话一次。破坏性 bash 门控每次执行。这种平衡避免了速度下降，同时捕获了真正的风险。

## 最佳实践

* 让门控自然触发。不要试图预先回答门控问题——调查本身才是提高质量的关键。
* 为你的领域自定义门控消息。如果你的项目有特定约定，请将其添加到门控提示中。
* 使用 `.gateguard.yml` 忽略 `.venv/`、`node_modules/`、`.git/` 等路径。

## 相关技能

* `safety-guard` — 运行时安全检查（互补，不重叠）
* `code-reviewer` — 编辑后审查（GateGuard 是编辑前调查）
