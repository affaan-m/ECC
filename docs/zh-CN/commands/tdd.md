---
description: 强制执行测试驱动开发工作流。首先搭建接口，生成测试，然后实现最小化代码以通过测试。确保 80%+ 覆盖率。
---

# TDD 命令

此命令调用 **tdd-guide** 代理来强制执行测试驱动开发方法。

## 此命令的作用

1. **搭建接口** - 首先定义类型/接口
2. **首先生成测试** - 编写失败的测试（红）
3. **实现最小化代码** - 编写刚好足够的代码以通过测试（绿）
4. **重构** - 改进代码，同时保持测试通过（重构）
5. **验证覆盖率** - 确保 80%+ 的测试覆盖率

## 何时使用

在以下情况下使用 `/tdd`：

* 实现新功能时
* 添加新函数/组件时
* 修复错误时（首先编写重现错误的测试）
* 重构现有代码时
* 构建关键业务逻辑时

## 工作原理

tdd-guide 代理将：

1. 为输入/输出**定义接口**
2. **编写将会失败的测试**（因为代码尚不存在）
3. **运行测试**并验证它们因正确的原因而失败
4. **编写最小化实现**以使测试通过
5. **运行测试**并验证它们通过
6. **重构**代码，同时保持测试通过
7. **检查覆盖率**，如果低于 80% 则添加更多测试

## TDD 循环

```
RED → GREEN → REFACTOR → REPEAT

RED:      编写一个失败测试
GREEN:    编写通过测试的最简代码
REFACTOR: 改进代码，保持测试通过
REPEAT:   开始下一个功能/场景
```

## 使用示例

````
User: /tdd I need a function to calculate market liquidity score

Agent (tdd-guide):
# TDD Session: Market Liquidity Score Calculator

## Step 1: Define Interface (SCAFFOLD)

```typescript
// lib/liquidity.ts
export interface MarketData {
  totalVolume: number
  bidAskSpread: number
  activeTraders: number
  lastTradeTime: Date
}

export function calculateLiquidityScore(market: MarketData): number {
  // TODO: Implementation
  throw new Error('Not implemented')
}
````

## 步骤 2：编写失败的测试（红）

```typescript
// lib/liquidity.test.ts
import { calculateLiquidityScore } from './liquidity'

describe('calculateLiquidityScore', () => {
  it('should return high score for liquid market', () => {
    const market = {
      totalVolume: 100000,
      bidAskSpread: 0.01,
      activeTraders: 500,
      lastTradeTime: new Date()
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBeGreaterThan(80)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('should return low score for illiquid market', () => {
    const market = {
      totalVolume: 100,
      bidAskSpread: 0.5,
      activeTraders: 2,
      lastTradeTime: new Date(Date.now() - 86400000) // 1 day ago
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBeLessThan(30)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('should handle edge case: zero volume', () => {
    const market = {
      totalVolume: 0,
      bidAskSpread: 0,
      activeTraders: 0,
      lastTradeTime: new Date()
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBe(0)
  })
})
```

## 步骤 3：运行测试 - 验证失败

```bash
npm test lib/liquidity.test.ts

FAIL lib/liquidity.test.ts
  ✕ should return high score for liquid market (2 ms)
    Error: Not implemented

1 test failed, 0 passed
```

PASS: 测试按预期失败。准备实施。

## 步骤 4：实现最小化代码（绿）

```typescript
// lib/liquidity.ts
export function calculateLiquidityScore(market: MarketData): number {
  // Handle zero volume edge case
  if (market.totalVolume === 0) {
    return 0
  }

  // Calculate component scores (0-100 scale)
  const volumeScore = Math.min(market.totalVolume / 1000, 100)
  const spreadScore = Math.max(100 - (market.bidAskSpread * 1000), 0)
  const traderScore = Math.min(market.activeTraders / 10, 100)

  // Recent activity bonus
  const hoursSinceLastTrade = (Date.now() - market.lastTradeTime.getTime()) / (1000 * 60 * 60)
  const recencyScore = Math.max(100 - (hoursSinceLastTrade * 10), 0)

  // Weighted average
  const score = (
    volumeScore * 0.4 +
    spreadScore * 0.3 +
    traderScore * 0.2 +
    recencyScore * 0.1
  )

  return Math.min(Math.max(score, 0), 100) // Clamp to 0-100
}
```

## 步骤 5：运行测试 - 验证通过

```bash
npm test lib/liquidity.test.ts

PASS lib/liquidity.test.ts
  ✓ should return high score for liquid market (3 ms)
  ✓ should return low score for illiquid market (2 ms)
  ✓ should handle edge case: zero volume (1 ms)

3 tests passed
```

PASS: 所有测试通过！

## 步骤 6：重构（改进）

```typescript
// lib/liquidity.ts - Refactored with constants and better readability
const WEIGHTS = {
  VOLUME: 0.4,
  SPREAD: 0.3,
  TRADERS: 0.2,
  RECENCY: 0.1,
} as const

const SCALE_FACTORS = {
  VOLUME: 1000,
  SPREAD: 1000,
  TRADERS: 10,
  RECENCY_PENALTY: 10,
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function calculateLiquidityScore(market: MarketData): number {
  if (market.totalVolume === 0) return 0

  const volumeScore = Math.min(market.totalVolume / SCALE_FACTORS.VOLUME, 100)
  const spreadScore = clamp(100 - (market.bidAskSpread * SCALE_FACTORS.SPREAD), 0, 100)
  const traderScore = Math.min(market.activeTraders / SCALE_FACTORS.TRADERS, 100)

  const hoursSinceLastTrade = (Date.now() - market.lastTradeTime.getTime()) / (1000 * 60 * 60)
  const recencyScore = clamp(100 - (hoursSinceLastTrade * SCALE_FACTORS.RECENCY_PENALTY), 0, 100)

  const weightedScore =
    volumeScore * WEIGHTS.VOLUME +
    spreadScore * WEIGHTS.SPREAD +
    traderScore * WEIGHTS.TRADERS +
    recencyScore * WEIGHTS.RECENCY

  return clamp(weightedScore, 0, 100)
}
```

## 步骤 7：验证测试仍然通过

```bash
npm test lib/liquidity.test.ts

PASS lib/liquidity.test.ts
  ✓ should return high score for liquid market (3 ms)
  ✓ should return low score for illiquid market (2 ms)
  ✓ should handle edge case: zero volume (1 ms)

3 tests passed
```

PASS: 重构完成，测试仍然通过！

## 步骤 8：检查覆盖率

```bash
npm test -- --coverage lib/liquidity.test.ts

File           | % Stmts | % Branch | % Funcs | % Lines
---------------|---------|----------|---------|--------
liquidity.ts   |   100   |   100    |   100   |   100

Coverage: 100% PASS: (Target: 80%)
```

PASS: TDD 会话完成！

```
## TDD 最佳实践

**应做：**
- PASS: 先写测试，再写实现
- PASS: 运行测试并确认失败，再实现功能
- PASS: 编写最少代码使测试通过
- PASS: 仅在测试通过后进行重构
- PASS: 添加边界情况和错误场景
- PASS: 目标覆盖率 80% 以上（关键代码 100%）

**不应做：**
- FAIL: 先写实现再写测试
- FAIL: 每次更改后跳过运行测试
- FAIL: 一次性编写过多代码
- FAIL: 忽略失败的测试
- FAIL: 测试实现细节（应测试行为）
- FAIL: 过度模拟（优先使用集成测试）

## 应包含的测试类型

**单元测试**（函数级别）：
- 正常路径场景
- 边界情况（空值、null、最大值）
- 错误条件
- 边界值

**集成测试**（组件级别）：
- API 端点
- 数据库操作
- 外部服务调用
- 包含钩子的 React 组件

**端到端测试**（使用 `/e2e` 命令）：
- 关键用户流程
- 多步骤流程
- 全栈集成

## 覆盖率要求

- 所有代码**最低 80%**
- **必须达到 100%** 的代码：
  - 财务计算
  - 认证逻辑
  - 安全关键代码
  - 核心业务逻辑

## 重要说明

**强制要求**：测试必须在实现之前编写。TDD 循环是：

1. **红** - 编写失败的测试
2. **绿** - 实现功能使测试通过
3. **重构** - 改进代码

切勿跳过红阶段。切勿在测试之前编写代码。

## 与其他命令的集成

- 首先使用 `/plan` 来了解要构建什么
- 使用 `/tdd` 进行带测试的实现
- 如果出现构建错误，请使用 `/build-fix`
- 使用 `/code-review` 审查实现
- 使用 `/test-coverage` 验证覆盖率

## 相关代理

此命令调用由 ECC 提供的 `tdd-guide` 代理。

相关的 `tdd-workflow` 技能也随 ECC 捆绑提供。

对于手动安装，源文件位于：
- `agents/tdd-guide.md`
- `skills/tdd-workflow/SKILL.md`
```
