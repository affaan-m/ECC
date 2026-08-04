---
name: html-print-optimizer
description: >-
  依据简历（PDF/MD/文本/HTML）生成定制化 HTML 简历：专业 A4 排版、可直接
  浏览器打开与打印成 PDF、模块不跨页拆分。可选按目标岗位定制内容（重排项目
  优先级、聚焦技能栈、重写个人总结、高亮量化成果）。当用户想把简历转成美观
  可打印的 HTML、或按某岗位定制一份打印版 HTML 简历时使用。

  典型触发：把这份简历 @xx.pdf 生成一个更美观可打印的 HTML 版本 /
  按 XX 岗位定制一份打印版简历 / 简历转打印 HTML。
origin: ECC
---

# HTML 简历生成与打印优化（html-print-optimizer）

输入：**简历** + 可选**目标岗位方向**，产出：**定制化 HTML 简历**（A4 可打印、模块不跨页）。

## 工作流

### 步骤 1：解析输入

- 简历路径：`.pdf` / `.md` / `.txt` / `.html`
- 可选定制方向：目标岗位（如"数据平台开发""AI 解决方案工程师"）或仅"更美观可打印"
- 若用户只要求排版优化 → 不做内容删减，仅重排格式；若指定岗位 → 按岗位定制内容

### 步骤 2：提取简历文本

- `.pdf`：`python3 ../job-greeting/scripts/extract_resume.py <简历>`（自动处理 PyMuPDF → pdftotext → pypdf）
- `.md` / `.txt`：直接读取
- `.html`：读取已有 HTML，保留其内容结构

### 步骤 3：定制化调整（仅当指定目标岗位）

参考 `resume-tune` 的策略做**重排、聚焦、删减、措辞优化**，不虚构：

1. **个人总结**：重写为"核心定位 + 1-3 个最强亮点"，量化成果加 `.highlight`
2. **技能栈**：按岗位重排，岗位强相关技术提前
3. **项目经验**：按相关度排序，弱相关项目压缩或省略，量化成果（性能/成本/规模）高亮
4. **只做真实内容的取舍**，JD 要求的短板不在简历中虚构

### 步骤 4：生成 HTML

- 基于 `templates/resume-template.html` 模板填充
- 按模板 CSS 类名逐块填充：`.header` / `.summary` / `.skills-grid` / `.work-item` / `.project-item` / `.edu-item`
- 关键量化成果（如"XX 提升至 YY%""规模达 ZZ"）用 `<span class="highlight">` 高亮
- 技术词用 `<span class="skill-tag">` 标签

### 步骤 5：分页优化（打印就绪，强制）

- **模块不跨页**：每个工作/项目/教育条目容器加 `page-break-inside: avoid`
- **标题不分离**：小节标题加 `page-break-after: avoid`
- summary 高亮框避免落在页尾拆分
- 目标准则：**2-4 页**、每个项目块整体完整、标题不与正文断开

### 步骤 6：验证与交付

- 输出到用户指定路径或当前目录 `简历_{岗位方向}_print.html`
- 提示用户浏览器打开验证，打印方式：**Ctrl+P / Cmd+P → 目标 A4 → 边距默认 → 另存 PDF**
- 若内容过长导致项目块跨页，优先压缩弱相关内容而非删减高价值项目

## 排版规范（模板已内置）

| 元素 | 规范 |
|---|---|
| 页面 | A4，边距 14/16/12/16mm，首页无页码，其余页右下角"第 N 页" |
| 字体 | `"PingFang SC", "Microsoft YaHei", sans-serif`，正文 10pt |
| 主色 | 蓝色 `#1a73e8`，正文 `#2c3e50`，次要 `#5f6368` |
| 头部 | 姓名 24pt 蓝色 + 副标题（岗位·年限）\| 右侧联系信息 |
| 个人总结 | 浅蓝底高亮框 `.summary`，页面不跨 |
| 技能 | 两列网格 `.skills-grid`，关键技术词 `.skill-tag` 标签 |
| 工作经历 | 时间轴布局（左时间 100px 右内容） |
| 项目经验 | 名称+时间头部、技术标签行、描述、核心贡献圆点列表、量化成果 `.highlight` |

## 脱敏（强制）

- 生成示例、模板、演示内容**不得**使用真实姓名、电话、邮箱及具体项目数据，一律用占位符（如 `{{NAME}}`、`{{PHONE}}`、`{{EMAIL}}`）
- 产出给用户的定制简历可含真实信息（基于用户提供的简历）
- 写入仓库的任何文件须再次校验保证严格脱敏

## 参考

- HTML 模板：`templates/resume-template.html`
- 简历文本提取：`../job-greeting/scripts/extract_resume.py`
- 内容定制策略：`../resume-tune/SKILL.md`
- 完整版简历示例：`../resume-tune/examples/master-resume.md`
