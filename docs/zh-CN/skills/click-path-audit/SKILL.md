---
name: click-path-audit
description: "追踪每个面向用户的按钮/触点的完整状态变化序列，以发现功能单独工作但相互抵消、产生错误最终状态或使UI处于不一致状态的错误。适用于：系统调试未发现错误但用户报告按钮失效，或在任何涉及共享状态存储的重大重构之后。"
origin: community
---

# /click-path-audit — 行为流审计

发现静态代码审查遗漏的缺陷：状态交互副作用、顺序调用间的竞态条件，以及相互静默撤销的处理程序。

## 解决的问题

传统调试检查：

* 函数是否存在？（缺少连接）
* 是否崩溃？（运行时错误）
* 是否返回正确类型？（数据流）

但未检查：

* **最终 UI 状态是否与按钮标签承诺一致？**
* **函数 B 是否静默撤销了函数 A 刚刚执行的操作？**
* **共享状态（Zustand/Redux/context）是否存在抵消预期操作的副作用？**

真实案例：一个"新邮件"按钮依次调用了 `setComposeMode(true)` 和 `selectThread(null)`。两者单独工作正常。但 `selectThread` 有一个副作用重置了 `composeMode: false`。按钮毫无反应。系统化调试发现了 54 个缺陷——这个被遗漏了。

***

## 工作原理

针对目标区域内的每个交互触点：

```
1. 识别处理函数（onClick、onSubmit、onChange 等）
2. 按顺序追踪处理函数中的每个函数调用
3. 对于每个函数调用：
   a. 它读取了哪些状态？
   b. 它写入了哪些状态？
   c. 它是否对共享状态产生了副作用？
   d. 它是否作为副作用重置/清除了任何状态？
4. 检查：后续调用是否会撤销前面调用的状态变更？
5. 检查：最终状态是否符合用户对按钮标签的预期？
6. 检查：是否存在竞态条件（异步调用以错误顺序解析）？
```

***

## 执行步骤

### 步骤 1：映射状态存储

在审计任何触点之前，构建每个状态存储操作的副作用映射：

```
对于作用域内的每个 Zustand 存储 / React 上下文：
  对于每个操作/设置器：
    - 它设置了哪些字段？
    - 它是否作为副作用重置了其他字段？
    - 文档：actionName → {sets: [...], resets: [...]}
```

这是关键参考。"新邮件"缺陷在不知道 `selectThread` 重置了 `composeMode` 的情况下是不可见的。

**输出格式：**

```
STORE: emailStore
  setComposeMode(bool) → 设置: {composeMode}
  selectThread(thread|null) → 设置: {selectedThread, selectedThreadId, messages, drafts, selectedDraft, summary} 重置: {composeMode: false, composeData: null, redraftOpen: false}
  setDraftGenerating(bool) → 设置: {draftGenerating}
  ...

危险的重置（清除不属于自身状态的操作）：
  selectThread → 重置 composeMode（由 setComposeMode 拥有）
  reset → 重置所有内容
```

### 步骤 2：审计每个触点

针对目标区域内的每个按钮/开关/表单提交：

```
TOUCHPOINT: [按钮标签] 在 [组件:行]
  HANDLER: onClick → {
    调用 1: functionA() → 设置 {X: true}
    调用 2: functionB() → 设置 {Y: null} 重置 {X: false}  ← 冲突
  }
  EXPECTED: 用户看到 [按钮标签所承诺的描述]
  ACTUAL: X 为 false，因为 functionB 重置了它
  VERDICT: BUG — [描述]
```

**检查以下每种缺陷模式：**

#### 模式 1：顺序撤销

```
handler() {
  setState_A(true)     // 设置 X = true
  setState_B(null)     // 副作用：重置 X = false
}
// 结果：X 为 false。第一次调用毫无意义。
```

#### 模式 2：异步竞态

```
handler() {
  fetchA().then(() => setState({ loading: false }))
  fetchB().then(() => setState({ loading: true }))
}
// 结果：最终的 loading 状态取决于哪个先完成
```

#### 模式 3：过期闭包

```
const [count, setCount] = useState(0)
const handler = useCallback(() => {
  setCount(count + 1)  // 捕获了过时的 count
  setCount(count + 1)  // 同样的过时 count — 只增加 1，而不是 2
}, [count])
```

#### 模式 4：缺失状态转换

```
// 按钮显示"保存"，但处理程序仅验证，从未实际保存
// 按钮显示"删除"，但处理程序设置了一个标志而未调用API
// 按钮显示"发送"，但API端点已被移除/损坏
```

#### 模式 5：条件死路径

```
handler() {
  if (someState) {        // 此时 someState 始终为 false
    doTheActualThing()    // 永远不会执行到
  }
}
```

#### 模式 6：useEffect 干扰

```
// Button 设置 stateX = true
// useEffect 监听 stateX 并将其重置为 false
// 用户看不到任何变化
```

### 步骤 3：报告

针对发现的每个缺陷：

```
CLICK-PATH-NNN: [严重性: 严重/高/中/低]
  触点: [按钮标签] 位于 [文件:行号]
  模式: [顺序撤销 / 异步竞态 / 过期闭包 / 缺失过渡 / 死路径 / useEffect 干扰]
  处理函数: [函数名或内联]
  追踪:
    1. [调用] → 设置 {字段: 值}
    2. [调用] → 重置 {字段: 值}  ← 冲突
  预期: [用户期望的结果]
  实际: [实际发生的结果]
  修复: [具体修复方案]
```

***

## 范围控制

此审计成本较高。请适当限定范围：

* **全应用审计：** 在发布或重大重构后使用。按页面启动并行代理。
* **单页面审计：** 在构建新页面或用户报告按钮失效后使用。
* **存储聚焦审计：** 在修改 Zustand 存储后使用——审计所有使用已更改操作的消费者。

### 全应用推荐的代理拆分：

```
Agent 1：映射所有状态存储（步骤 1）——这是所有其他代理的共享上下文
Agent 2：仪表盘（任务、笔记、日志、想法）
Agent 3：聊天（DanteChatColumn、JustChatPage）
Agent 4：邮件（ThreadList、DraftArea、EmailsPage）
Agent 5：项目（ProjectsPage、ProjectOverviewTab、NewProjectWizard）
Agent 6：CRM（所有子标签页）
Agent 7：个人资料、设置、保险库、通知
Agent 8：管理套件（所有页面）
```

代理 1 必须首先完成。其输出是所有其他代理的输入。

***

## 何时使用

* 系统化调试发现"无缺陷"但用户报告 UI 失效后
* 修改任何 Zustand 存储操作后（检查所有调用者）
* 任何涉及共享状态的重构后
* 发布前，针对关键用户流程
* 当按钮"无反应"时——这是解决该问题的工具

## 何时不使用

* 针对 API 级别缺陷（错误的响应结构、缺失端点）——使用系统化调试
* 针对样式/布局问题——视觉检查
* 针对性能问题——性能分析工具

***

## 与其他技能的集成

* 在 `/superpowers:systematic-debugging`（发现其他 54 种缺陷类型）之后运行
* 在 `/superpowers:verification-before-completion`（验证修复是否有效）之前运行
* 反馈至 `/superpowers:test-driven-development`——此处发现的每个缺陷都应添加测试

***

## 示例：启发此技能的缺陷

**ThreadList.tsx "新邮件"按钮：**

```
onClick={() => {
  useEmailStore.getState().setComposeMode(true)   // ✓ 设置 composeMode = true
  useEmailStore.getState().selectThread(null)      // ✗ 重置 composeMode = false
}}
```

存储定义：

```
selectThread: (thread) => set({
  selectedThread: thread,
  selectedThreadId: thread?.id ?? null,
  messages: [],
  drafts: [],
  selectedDraft: null,
  summary: null,
  composeMode: false,     // ← 这个静默重置导致按钮失效
  composeData: null,
  redraftOpen: false,
})
```

**系统化调试遗漏了它**，因为：

* 按钮有 onClick 处理程序（未失效）
* 两个函数都存在（无缺失连接）
* 两个函数均未崩溃（无运行时错误）
* 数据类型正确（无类型不匹配）

**点击路径审计捕获了它**，因为：

* 步骤 1 映射出 `selectThread` 重置了 `composeMode`
* 步骤 2 追踪处理程序：调用 1 设置为 true，调用 2 重置为 false
* 判定：顺序撤销——最终状态与按钮意图矛盾
