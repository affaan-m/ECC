---
description: 使用专门代理进行全面的PR审查
---

对拉取请求进行全面的多视角审查。

## 用法

`/review-pr [PR-number-or-URL] [--focus=comments|tests|errors|types|code|simplify]`

如果未指定 PR，则审查当前分支的 PR。如果未指定关注点，则运行完整的审查堆栈。

## 步骤

1. 识别 PR：
   * 使用 `gh pr view` 获取 PR 详情、变更文件及差异
2. 查找项目指南：
   * 寻找 `CLAUDE.md`、lint 配置、TypeScript 配置、仓库约定
3. 运行专项审查代理：
   * `code-reviewer`
   * `comment-analyzer`
   * `pr-test-analyzer`
   * `silent-failure-hunter`
   * `type-design-analyzer`
   * `code-simplifier`
4. 汇总结果：
   * 去重重叠发现
   * 按严重程度排序
5. 按严重程度分组报告发现

## 置信度规则

仅报告置信度 >= 80 的问题：

* 严重：错误、安全、数据丢失
* 重要：缺少测试、质量问题、风格违规
* 建议：仅在明确要求时提供建议
