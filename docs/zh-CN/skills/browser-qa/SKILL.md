---
name: browser-qa
description: Automate visual testing and UI interaction verification using browser automation after deployment.
metadata:
  origin: ECC
---

# Browser QA — 自动化视觉测试与交互验证

## When to use

- 功能部署到 staging / preview 之后
- 需要验证跨页面的 UI 行为时
- 发布前确认布局、表单和交互是否真的可用
- 审查涉及前端改动的 PR 时
- 做可访问性审计和响应式测试时

## How it works

使用浏览器自动化 MCP（claude-in-chrome、Playwright 或 Puppeteer），像真实用户一样与线上页面交互。

### 阶段 1：冒烟测试
```
1. 打开目标 URL
2. 检查控制台错误（过滤噪声：分析脚本、第三方库）
3. 验证网络请求中没有 4xx / 5xx
4. 在桌面和移动端视口截图首屏内容
5. 检查 Core Web Vitals：LCP < 2.5s，CLS < 0.1，INP < 200ms
```

### 阶段 2：交互测试
```
1. 点击所有导航链接，验证没有死链
2. 使用有效数据提交表单，验证成功态
3. 使用无效数据提交表单，验证错误态
4. 测试认证流程：登录 → 受保护页面 → 登出
5. 测试关键用户路径（结账、引导、搜索）
```

### 阶段 3：视觉回归
```
1. 在 3 个断点（375px、768px、1440px）对关键页面截图
2. 与基线截图对比（如果已保存）
3. 标记 > 5px 的布局偏移、缺失元素、内容溢出
4. 如适用，检查暗色模式
```

### 阶段 4：可访问性
```
1. 在每个页面运行 axe-core 或等价工具
2. 标记 WCAG AA 违规（对比度、标签、焦点顺序）
3. 验证键盘导航可以端到端工作
4. 检查屏幕阅读器地标
```

## Examples

```markdown
## QA 报告 — [URL] — [timestamp]

### 冒烟测试
- 控制台错误：0 个严重错误，2 个警告（分析脚本噪声）
- 网络：全部 200/304，无失败请求
- Core Web Vitals：LCP 1.2s，CLS 0.02，INP 89ms

### 交互
- [done] 导航链接：12/12 正常
- [issue] 联系表单：无效邮箱缺少错误态
- [done] 认证流程：登录 / 登出正常

### 视觉
- [issue] Hero 区域在 375px 视口下溢出
- [done] 暗色模式：所有页面一致

### 可访问性
- 2 个 AA 级违规：Hero 图片缺少 alt 文本，页脚链接对比度过低

### 结论：修复后可发布（2 个问题，0 个阻塞项）
```

## 集成

可与任意浏览器 MCP 配合：
- `mChild__claude-in-chrome__*` 工具（推荐，直接使用你的真实 Chrome）
- 通过 `mcp__browserbase__*` 使用 Playwright
- 直接运行 Puppeteer 脚本

可与 `/canary-watch` 搭配用于发布后的持续监控。
