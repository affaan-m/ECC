---
description: 使用 Playwright 生成并运行端到端测试。创建测试旅程、运行测试、捕获截图/视频/跟踪，并上传工件。
---

# E2E 命令

此命令调用 **e2e-runner** 代理来使用 Playwright 生成、维护和执行端到端测试。

## 此命令的作用

1. **生成测试旅程** - 为用户流程创建 Playwright 测试
2. **运行 E2E 测试** - 跨浏览器执行测试
3. **捕获工件** - 失败时的截图、视频、跟踪
4. **上传结果** - HTML 报告和 JUnit XML
5. **识别不稳定测试** - 隔离不稳定的测试

## 何时使用

在以下情况使用 `/e2e`：

* 测试关键用户旅程（登录、交易、支付）
* 验证多步骤流程端到端工作
* 测试 UI 交互和导航
* 验证前端和后端之间的集成
* 为生产部署做准备

## 工作原理

e2e-runner 代理将：

1. **分析用户流程**并识别测试场景
2. **使用页面对象模型模式生成 Playwright 测试**
3. **跨多个浏览器（Chrome、Firefox、Safari）运行测试**
4. **捕获失败**，包括截图、视频和跟踪
5. **生成包含结果和工件的报告**
6. **识别不稳定测试**并推荐修复方法

## 使用示例

````
用户：/e2e 测试市场搜索和查看流程

代理（e2e-runner）：
# E2E 测试生成：市场搜索和查看流程

## 已识别测试场景

**用户旅程：** 市场搜索 → 查看结果 → 点击市场 → 查看详情

**测试覆盖范围：**
1. 导航至市场页面
2. 执行语义搜索
3. 验证搜索结果
4. 点击第一个结果
5. 验证市场详情页面加载
6. 验证图表渲染

## 生成的测试代码

```typescript
// tests/e2e/markets/search-and-view.spec.ts
import { test, expect } from '@playwright/test'
import { MarketsPage } from '../../pages/MarketsPage'
import { MarketDetailsPage } from '../../pages/MarketDetailsPage'

test.describe('Market Search and View Flow', () => {
  test('user can search markets and view details', async ({ page }) => {
    // 1. Navigate to markets page
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // Verify page loaded
    await expect(page).toHaveTitle(/Markets/)
    await expect(page.locator('h1')).toContainText('Markets')

    // 2. Perform semantic search
    await marketsPage.searchMarkets('election')

    // Wait for API response
    await page.waitForResponse(resp =>
      resp.url().includes('/api/markets/search') && resp.status() === 200
    )

    // 3. Verify search results
    const marketCards = marketsPage.marketCards
    await expect(marketCards.first()).toBeVisible()
    const resultCount = await marketCards.count()
    expect(resultCount).toBeGreaterThan(0)

    // Take screenshot of search results
    await page.screenshot({ path: 'artifacts/search-results.png' })

    // 4. Click on first result
    const firstMarketTitle = await marketCards.first().textContent()
    await marketCards.first().click()

    // 5. Verify market details page loads
    await expect(page).toHaveURL(/\/markets\/[a-z0-9-]+/)

    const detailsPage = new MarketDetailsPage(page)
    await expect(detailsPage.marketName).toBeVisible()
    await expect(detailsPage.marketDescription).toBeVisible()

    // 6. Verify chart renders
    await expect(detailsPage.priceChart).toBeVisible()

    // Verify market name matches
    const detailsTitle = await detailsPage.marketName.textContent()
    expect(detailsTitle?.toLowerCase()).toContain(
      firstMarketTitle?.toLowerCase().substring(0, 20) || ''
    )

    // Take screenshot of market details
    await page.screenshot({ path: 'artifacts/market-details.png' })
  })

  test('search with no results shows empty state', async ({ page }) => {
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // Search for non-existent market
    await marketsPage.searchMarkets('xyznonexistentmarket123456')

    // Verify empty state
    await expect(page.locator('[data-testid="no-results"]')).toBeVisible()
    await expect(page.locator('[data-testid="no-results"]')).toContainText(
      /no.*results|no.*markets/i
    )

    const marketCount = await marketsPage.marketCards.count()
    expect(marketCount).toBe(0)
  })

  test('can clear search and see all markets again', async ({ page }) => {
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // Initial market count
    const initialCount = await marketsPage.marketCards.count()

    // Perform search
    await marketsPage.searchMarkets('trump')
    await page.waitForLoadState('networkidle')

    // Verify filtered results
    const filteredCount = await marketsPage.marketCards.count()
    expect(filteredCount).toBeLessThan(initialCount)

    // Clear search
    await marketsPage.searchInput.clear()
    await page.waitForLoadState('networkidle')

    // Verify all markets shown again
    const finalCount = await marketsPage.marketCards.count()
    expect(finalCount).toBe(initialCount)
  })
})

````

## 运行测试

```bash
# Run the generated test
npx playwright test tests/e2e/markets/search-and-view.spec.ts

Running 3 tests using 3 workers

  ✓  [chromium] › search-and-view.spec.ts:5:3 › user can search markets and view details (4.2s)
  ✓  [chromium] › search-and-view.spec.ts:52:3 › search with no results shows empty state (1.8s)
  ✓  [chromium] › search-and-view.spec.ts:67:3 › can clear search and see all markets again (2.9s)

  3 passed (9.1s)

Artifacts generated:
- artifacts/search-results.png
- artifacts/market-details.png
- playwright-report/index.html
```

## 测试报告

```
╔══════════════════════════════════════════════════════════════╗
║                    E2E 测试结果                          ║
╠══════════════════════════════════════════════════════════════╣
║ 状态：     PASS: 所有测试通过                              ║
║ 总计：      3 项测试                                          ║
║ 通过：     3 (100%)                                         ║
║ 失败：     0                                                ║
║ 不稳定：    0                                                ║
║ 耗时：   9.1s                                             ║
╚══════════════════════════════════════════════════════════════╝

产物：
 截图： 2 个文件
 视频： 0 个文件（仅在失败时生成）
 追踪文件： 0 个文件（仅在失败时生成）
 HTML 报告： playwright-report/index.html

查看报告： npx playwright show-report
```

PASS: E2E 测试套件已准备好进行 CI/CD 集成！

````
## 测试产物

当测试运行时，会捕获以下产物：

**所有测试：**
- 包含时间线和结果的 HTML 报告
- 用于 CI 集成的 JUnit XML 文件

**仅在失败时：**
- 失败状态的截图
- 测试的视频录制
- 用于调试的追踪文件（逐步重放）
- 网络日志
- 控制台日志

## 查看产物

```bash
# 在浏览器中查看 HTML 报告
npx playwright show-report

# 查看特定的追踪文件
npx playwright show-trace artifacts/trace-abc123.zip

# 截图保存在 artifacts/ 目录中
open artifacts/search-results.png

````

## 不稳定测试检测

如果测试间歇性失败：

```
WARNING:  FLAKY TEST DETECTED: tests/e2e/markets/trade.spec.ts

测试通过了 7/10 次运行 (70% 通过率)

常见失败原因:
"等待元素 '[data-testid="confirm-btn"]' 超时"

推荐修复方法:
1. 添加显式等待: await page.waitForSelector('[data-testid="confirm-btn"]')
2. 增加超时时间: { timeout: 10000 }
3. 检查组件中的竞争条件
4. 确认元素未被动画遮挡

隔离建议: 在修复前标记为 test.fixme()
```

## 浏览器配置

默认情况下，测试在多个浏览器上运行：

* PASS: Chromium（桌面版 Chrome）
* PASS: Firefox（桌面版）
* PASS: WebKit（桌面版 Safari）
* PASS: 移动版 Chrome（可选）

在 `playwright.config.ts` 中配置以调整浏览器。

## CI/CD 集成

添加到您的 CI 流水线：

```yaml
# .github/workflows/e2e.yml
- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: npx playwright test

- name: Upload artifacts
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```

## PMX 特定的关键流程

对于 PMX，请优先考虑以下 E2E 测试：

**关键（必须始终通过）：**

1. 用户可以连接钱包
2. 用户可以浏览市场
3. 用户可以搜索市场（语义搜索）
4. 用户可以查看市场详情
5. 用户可以下交易单（使用测试资金）
6. 市场正确结算
7. 用户可以提取资金

**重要：**

1. 市场创建流程
2. 用户资料更新
3. 实时价格更新
4. 图表渲染
5. 过滤和排序市场
6. 移动端响应式布局

## 最佳实践

**应该：**

* PASS: 使用页面对象模型以提高可维护性
* PASS: 使用 data-testid 属性作为选择器
* PASS: 等待 API 响应，而不是使用任意超时
* PASS: 测试关键用户旅程的端到端
* PASS: 在合并到主分支前运行测试
* PASS: 在测试失败时审查工件

**不应该：**

* FAIL: 使用不稳定的选择器（CSS 类可能会改变）
* FAIL: 测试实现细节
* FAIL: 针对生产环境运行测试
* FAIL: 忽略不稳定测试
* FAIL: 在失败时跳过工件审查
* FAIL: 使用 E2E 测试每个边缘情况（使用单元测试）

## 重要注意事项

**对 PMX 至关重要：**

* 涉及真实资金的 E2E 测试**必须**仅在测试网/暂存环境中运行
* 切勿针对生产环境运行交易测试
* 为金融测试设置 `test.skip(process.env.NODE_ENV === 'production')`
* 仅使用带有少量测试资金的测试钱包

## 与其他命令的集成

* 使用 `/plan` 来识别要测试的关键旅程
* 使用 `/tdd` 进行单元测试（更快、更细粒度）
* 使用 `/e2e` 进行集成和用户旅程测试
* 使用 `/code-review` 来验证测试质量

## 相关代理

此命令调用由 ECC 提供的 `e2e-runner` 代理。

对于手动安装，源文件位于：
`agents/e2e-runner.md`

## 快速命令

```bash
# Run all E2E tests
npx playwright test

# Run specific test file
npx playwright test tests/e2e/markets/search.spec.ts

# Run in headed mode (see browser)
npx playwright test --headed

# Debug test
npx playwright test --debug

# Generate test code
npx playwright codegen http://localhost:3000

# View report
npx playwright show-report
```
