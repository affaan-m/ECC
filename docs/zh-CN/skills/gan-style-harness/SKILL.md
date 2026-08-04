---
name: gan-style-harness
description: "受GAN启发的生成器-评估器代理框架，用于自主构建高质量应用。基于Anthropic 2026年3月的框架设计论文。"
origin: ECC-community
tools: Read, Write, Edit, Bash, Grep, Glob, Task
---

# GAN 风格编排技能

> 灵感来源于 [Anthropic 的长时间运行应用开发编排设计](https://www.anthropic.com/engineering/harness-design-long-running-apps)（2026年3月24日）

一种多智能体编排，将**生成**与**评估**分离，形成对抗性反馈循环，推动质量远超单个智能体所能达到的水平。

## 核心洞察

> 当要求评估自身工作时，智能体是病态的乐观主义者——它们会赞美平庸的输出，并说服自己忽略真正的问题。但设计一个**独立的评估器**并使其极度严格，远比教会生成器自我批评要容易得多。

这与 GAN（生成对抗网络）的机制相同：生成器负责产出，评估器负责批评，这种反馈驱动下一轮迭代。

## 适用场景

* 根据一行提示构建完整应用
* 需要高视觉质量的前端设计任务
* 需要工作功能而不仅仅是代码的全栈项目
* 任何"AI 垃圾"美学不可接受的任务
* 愿意投入 50-200 美元以获得生产级质量输出的项目

## 不适用场景

* 快速单文件修复（使用标准 `claude -p`）
* 预算紧张的任务（<10 美元）
* 简单重构（改用去垃圾化模式）
* 已有完善测试规范的任务（使用 TDD 工作流）

## 架构

```
                    ┌─────────────┐
                    │   规划器    │
                    │  (Opus 4.6) │
                    └──────┬──────┘
                           │ 产品规格
                           │ (功能、冲刺、设计方向)
                           ▼
              ┌────────────────────────┐
              │                        │
              │   生成器-评估器        │
              │     反馈循环           │
              │                        │
              │  ┌──────────┐          │
              │  │ 生成器   │--构建-->│──┐
              │  │(Opus 4.6)│          │  │
              │  └────▲─────┘          │  │
              │       │                │  │ 实时应用
              │    反馈               │  │
              │       │                │  │
              │  ┌────┴─────┐          │  │
              │  │ 评估器   │<-测试---│──┘
              │  │(Opus 4.6)│          │
              │  │+Playwright│         │
              │  └──────────┘          │
              │                        │
              │   5-15 次迭代         │
              └────────────────────────┘
```

## 三个智能体

### 1. 规划器智能体

**角色：** 产品经理——将简短的提示扩展为完整的产品规格。

**关键行为：**

* 接收一行提示，生成包含 16 个功能、多个冲刺的规格
* 定义用户故事、技术需求和视觉设计方向
* 故意**雄心勃勃**——保守规划会导致结果平庸
* 生成评估器后续使用的评估标准

**模型：** Opus 4.6（需要深度推理进行规格扩展）

### 2. 生成器智能体

**角色：** 开发者——根据规格实现功能。

**关键行为：**

* 按结构化冲刺工作（或使用较新模型的连续模式）
* 在编写代码前与评估器协商"冲刺合约"
* 使用全栈工具：React、FastAPI/Express、数据库、CSS
* 管理 git 进行迭代间的版本控制
* 读取评估器反馈并在下一轮迭代中采纳

**模型：** Opus 4.6（需要强大的编码能力）

### 3. 评估器智能体

**角色：** QA 工程师——测试实时运行的应用，而不仅仅是代码。

**关键行为：**

* 使用 **Playwright MCP** 与实时应用交互
* 点击功能、填写表单、测试 API 端点
* 根据四个标准评分（可配置）：
  1. **设计质量**——是否感觉像一个连贯的整体？
  2. **原创性**——自定义决策 vs. 模板/AI 模式？
  3. **工艺**——排版、间距、动画、微交互？
  4. **功能性**——所有功能是否真正工作？
* 返回结构化反馈，包含分数和具体问题
* 设计为**极度严格**——从不赞美平庸的工作

**模型：** Opus 4.6（需要强大的判断力 + 工具使用能力）

## 评估标准

默认四个标准，每个评分 1-10：

```markdown
## 评估标准

### 设计质量（权重：0.3）
- 1-3分：模板化、千篇一律的"AI生成"美学
- 4-6分：合格但平庸，遵循常规设计
- 7-8分：独特且连贯的视觉识别
- 9-10分：可媲美专业设计师作品

### 原创性（权重：0.2）
- 1-3分：默认配色、模板布局，缺乏个性
- 4-6分：部分自定义选择，整体仍属常规模式
- 7-8分：清晰的创意构思，独特的设计手法
- 9-10分：令人惊喜、愉悦，真正新颖

### 工艺水平（权重：0.3）
- 1-3分：布局错乱，状态缺失，无动画效果
- 4-6分：功能可用但粗糙，间距不统一
- 7-8分：精致流畅，过渡平滑，响应式设计
- 9-10分：像素级完美，令人愉悦的微交互

### 功能性（权重：0.2）
- 1-3分：核心功能损坏或缺失
- 4-6分：主流程可用，边缘情况处理失败
- 7-8分：所有功能正常，错误处理良好
- 9-10分：无懈可击，覆盖所有边缘情况
```

### 评分

* **加权分数** = 总和（标准\_分数 \* 权重）
* **通过阈值** = 7.0（可配置）
* **最大迭代次数** = 15（可配置，通常 5-15 次足够）

## 使用方法

### 通过命令行

```bash
# Full three-agent harness
/project:gan-build "Build a project management app with Kanban boards, team collaboration, and dark mode"

# With custom config
/project:gan-build "Build a recipe sharing platform" --max-iterations 10 --pass-threshold 7.5

# Frontend design mode (generator + evaluator only, no planner)
/project:gan-design "Create a landing page for a crypto portfolio tracker"
```

### 通过 Shell 脚本

```bash
# Basic usage
./scripts/gan-harness.sh "Build a music streaming dashboard"

# With options
GAN_MAX_ITERATIONS=10 \
GAN_PASS_THRESHOLD=7.5 \
GAN_EVAL_CRITERIA="functionality,performance,security" \
./scripts/gan-harness.sh "Build a REST API for task management"
```

### 通过 Claude Code（手动）

```bash
# Step 1: Plan
claude -p --model opus "You are a Product Planner. Read PLANNER_PROMPT.md. Expand this brief into a full product spec: 'Build a Kanban board app'. Write spec to spec.md"

# Step 2: Generate (iteration 1)
claude -p --model opus "You are a Generator. Read spec.md. Implement Sprint 1. Start the dev server on port 3000."

# Step 3: Evaluate (iteration 1)
claude -p --model opus --allowedTools "Read,Bash,mcp__playwright__*" "You are an Evaluator. Read EVALUATOR_PROMPT.md. Test the live app at http://localhost:3000. Score against the rubric. Write feedback to feedback-001.md"

# Step 4: Generate (iteration 2 — reads feedback)
claude -p --model opus "You are a Generator. Read spec.md and feedback-001.md. Address all issues. Improve the scores."

# Repeat steps 3-4 until pass threshold met
```

## 随模型能力的演进

编排应随模型改进而简化。遵循 Anthropic 的演进路径：

### 阶段 1 — 较弱模型（Sonnet 级别）

* 需要完整的冲刺分解
* 冲刺间重置上下文（避免上下文焦虑）
* 最少 2 个智能体：初始化器 + 编码智能体
* 大量脚手架弥补模型限制

### 阶段 2 — 能力型模型（Opus 4.5 级别）

* 完整的 3 智能体编排：规划器 + 生成器 + 评估器
* 每个实现阶段前有冲刺合约
* 复杂应用分解为 10 个冲刺
* 上下文重置仍有帮助但不再关键

### 阶段 3 — 前沿模型（Opus 4.6 级别）

* 简化编排：单次规划，连续生成
* 评估简化为单次最终评估（模型更智能）
* 无需冲刺结构
* 自动压缩处理上下文增长

> **关键原则：** 编排的每个组件都编码了一个关于模型无法独立完成什么的假设。当模型改进时，重新测试这些假设。剥离不再需要的部分。

## 配置

### 环境变量

| 变量 | 默认值 | 描述 |
|----------|---------|-------------|
| `GAN_MAX_ITERATIONS` | `15` | 最大生成器-评估器循环次数 |
| `GAN_PASS_THRESHOLD` | `7.0` | 通过所需的加权分数（1-10） |
| `GAN_PLANNER_MODEL` | `opus` | 规划智能体的模型 |
| `GAN_GENERATOR_MODEL` | `opus` | 生成器智能体的模型 |
| `GAN_EVALUATOR_MODEL` | `opus` | 评估器智能体的模型 |
| `GAN_EVAL_CRITERIA` | `design,originality,craft,functionality` | 逗号分隔的标准 |
| `GAN_DEV_SERVER_PORT` | `3000` | 实时应用的端口 |
| `GAN_DEV_SERVER_CMD` | `npm run dev` | 启动开发服务器的命令 |
| `GAN_PROJECT_DIR` | `.` | 项目工作目录 |
| `GAN_SKIP_PLANNER` | `false` | 跳过规划器，直接使用规格 |
| `GAN_EVAL_MODE` | `playwright` | `playwright`、`screenshot` 或 `code-only` |

### 评估模式

| 模式 | 工具 | 最适合 |
|------|-------|----------|
| `playwright` | 浏览器 MCP + 实时交互 | 带 UI 的全栈应用 |
| `screenshot` | 截图 + 视觉分析 | 静态网站、纯设计 |
| `code-only` | 测试 + 代码检查 + 构建 | API、库、CLI 工具 |

## 反模式

1. **评估器过于宽松**——如果评估器在第一次迭代就通过所有内容，你的评分标准过于慷慨。收紧评分标准，并为常见的 AI 模式添加明确惩罚。

2. **生成器忽略反馈**——确保反馈以文件形式传递，而非内联。生成器应在每次迭代开始时读取 `feedback-NNN.md`。

3. **无限循环**——始终设置 `GAN_MAX_ITERATIONS`。如果生成器在 3 次迭代后无法突破分数平台，停止并标记为人工审查。

4. **评估器测试流于表面**——评估器必须使用 Playwright **交互**实时应用，而不仅仅是截图。点击按钮、填写表单、测试错误状态。

5. **评估器赞美自己的修复**——绝不允许评估器建议修复后再评估这些修复。评估器只负责批评；生成器负责修复。

6. **上下文耗尽**——对于长时间会话，使用 Claude Agent SDK 的自动压缩或在主要阶段之间重置上下文。

## 结果：预期效果

基于 Anthropic 已发布的结果：

| 指标 | 单智能体 | GAN 编排 | 改进 |
|--------|-----------|-------------|-------------|
| 时间 | 20 分钟 | 4-6 小时 | 12-18 倍更长 |
| 成本 | 9 美元 | 125-200 美元 | 14-22 倍更多 |
| 质量 | 勉强可用 | 生产就绪 | 质变 |
| 核心功能 | 有缺陷 | 全部工作 | 不适用 |
| 设计 | 通用 AI 垃圾 | 独特、精致 | 不适用 |

**权衡很明确：** 约 20 倍的时间和成本，换来输出质量的质的飞跃。这适用于质量至关重要的项目。

## 参考

* [Anthropic：长时间运行应用的编排设计](https://www.anthropic.com/engineering/harness-design-long-running-apps) — Prithvi Rajasekaran 的原始论文
* [Epsilla：GAN 风格智能体循环](https://www.epsilla.com/blogs/anthropic-harness-engineering-multi-agent-gan-architecture) — 架构解构
* [Martin Fowler：编排工程](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html) — 更广泛的行业背景
* [OpenAI：编排工程](https://openai.com/index/harness-engineering/) — OpenAI 的并行工作
