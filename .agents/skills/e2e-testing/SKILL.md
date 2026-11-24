---
name: e2e-testing
description: Playwright E2E testing patterns, Page Object Model, configuration, CI/CD integration, artifact management, and flaky test strategies. Use when writing Playwright tests, structuring page objects, or fixing flaky E2E runs in CI.
license: MIT
---

# E2E Testing Patterns

Comprehensive Playwright patterns for building stable, fast, and maintainable E2E test suites.

## Verify the Test Target

Run state-changing journeys only against an authorized sandbox with verified
identity, isolated storage, and synthetic accounts and data. Confirm the
effective origin and that payments, wallets, notifications, and similar
services are stubbed or isolated. A hostname or an environment variable alone
does not establish this. If the target or its dependencies cannot be verified,
stop before the mutation and use a local fixture instead.

## Test File Organization

```
tests/
├── e2e/
│   ├── auth/
│   │   ├── login.spec.ts
│   │   ├── logout.spec.ts
│   │   └── register.spec.ts
│   ├── features/
│   │   ├── browse.spec.ts
│   │   ├── search.spec.ts
│   │   └── create.spec.ts
│   └── api/
│       └── endpoints.spec.ts
├── fixtures/
│   ├── auth.ts
│   └── data.ts
└── playwright.config.ts
```

## Page Object Model (POM)

```typescript
import { Page, Locator } from '@playwright/test'

export class ItemsPage {
  readonly page: Page
  readonly searchInput: Locator
  readonly itemCards: Locator
  readonly createButton: Locator

  constructor(page: Page) {
    this.page = page
    this.searchInput = page.locator('[data-testid="search-input"]')
    this.itemCards = page.locator('[data-testid="item-card"]')
    this.createButton = page.locator('[data-testid="create-btn"]')
  }

  async goto() {
    await this.page.goto('/items')
    await this.page.waitForLoadState('networkidle')
  }

  async search(query: string) {
    await this.searchInput.fill(query)
    await this.page.waitForResponse(resp => resp.url().includes('/api/search'))
    await this.page.waitForLoadState('networkidle')
  }

  async getItemCount() {
    return await this.itemCards.count()
  }
}
```

## Test Structure

```typescript
import { test, expect } from '@playwright/test'
import { ItemsPage } from '../../pages/ItemsPage'

test.describe('Item Search', () => {
  let itemsPage: ItemsPage

  test.beforeEach(async ({ page }) => {
    itemsPage = new ItemsPage(page)
    await itemsPage.goto()
  })

  test('should search by keyword', async ({ page }) => {
    await itemsPage.search('test')

    const count = await itemsPage.getItemCount()
    expect(count).toBeGreaterThan(0)

    await expect(itemsPage.itemCards.first()).toContainText(/test/i)
  })

  test('should handle no results', async ({ page }) => {
    await itemsPage.search('xyznonexistent123')

    await expect(page.locator('[data-testid="no-results"]')).toBeVisible()
    expect(await itemsPage.getItemCount()).toBe(0)
  })
})
```

## Playwright Configuration

This example assumes the project's reviewed `dev:e2e` script starts a dedicated
loopback fixture with synthetic data and stubbed services.

```typescript
import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:3000'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'playwright-results.xml' }],
    ['json', { outputFile: 'playwright-results.json' }]
  ],
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: 'npm run dev:e2e',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000,
  },
})
```

## Flaky Test Patterns

### Quarantine

```typescript
test('flaky: complex search', async ({ page }) => {
  test.fixme(true, 'Flaky - Issue #123')
  // test code...
})

test('conditional skip', async ({ page }) => {
  test.skip(process.env.CI, 'Flaky in CI - Issue #123')
  // test code...
})
```

### Identify Flakiness

Use the project's reviewed test script backed by its installed, lockfile-pinned
Playwright. This example assumes `test:e2e` runs `playwright test`.

```bash
npm run test:e2e -- tests/search.spec.ts --repeat-each=10
npm run test:e2e -- tests/search.spec.ts --retries=3
```

### Common Causes & Fixes

**Race conditions:**
```typescript
// Bad: assumes element is ready
await page.click('[data-testid="button"]')

// Good: auto-wait locator
await page.locator('[data-testid="button"]').click()
```

**Network timing:**
```typescript
// Bad: arbitrary timeout
await page.waitForTimeout(5000)

// Good: wait for specific condition
await page.waitForResponse(resp => resp.url().includes('/api/data'))
```

**Animation timing:**
```typescript
// Bad: click during animation
await page.click('[data-testid="menu-item"]')

// Good: wait for stability
await page.locator('[data-testid="menu-item"]').waitFor({ state: 'visible' })
await page.waitForLoadState('networkidle')
await page.locator('[data-testid="menu-item"]').click()
```

## Artifact Management

Enable the captures below only when needed for a synthetic run. Keep traces,
screenshots, videos, and reports local by default. Authenticated capture can
include cookies, headers, request bodies, or private screen content. Export
only an explicitly approved artifact to the approved destination after
inspecting and redacting its contents. If the artifact cannot be safely
redacted, share an authorized sanitized summary instead.

### Screenshots

```typescript
await page.screenshot({ path: 'artifacts/after-login.png' })
await page.screenshot({ path: 'artifacts/full-page.png', fullPage: true })
await page.locator('[data-testid="chart"]').screenshot({ path: 'artifacts/chart.png' })
```

### Traces

```typescript
// In playwright.config.ts for an approved synthetic run
use: {
  trace: 'retain-on-failure'
}
```

### Video

```typescript
// In playwright.config.ts for an approved synthetic run
outputDir: 'artifacts/playwright',
use: {
  video: 'retain-on-failure'
}
```

## CI/CD Integration

Use the repository's pinned CI setup for the runtime, package manager,
dependencies and browser binaries. Verify that the job runs against the
synthetic fixture server. Publish only approved, reviewed output.

```yaml
# Test step after the repository's pinned setup.
- name: Run E2E tests against the local fixture
  run: npm run test:e2e
```

## Test Report Template

```markdown
# E2E Test Report

**Date:** YYYY-MM-DD HH:MM
**Duration:** Xm Ys
**Status:** PASSING / FAILING

## Summary
- Total: X | Passed: Y (Z%) | Failed: A | Flaky: B | Skipped: C

## Failed Tests

### test-name
**File:** `tests/e2e/feature.spec.ts:45`
**Error:** Expected element to be visible
**Screenshot:** artifacts/failed.png
**Recommended Fix:** [description]

## Artifacts
- HTML Report: playwright-report/index.html
- Screenshots: artifacts/*.png
- Videos: artifacts/videos/*.webm
- Traces: artifacts/*.zip
```

## Wallet / Web3 Testing

Use an in-browser provider stub and a stubbed application backend. This
example exercises UI connection with a synthetic account and no real wallet.

```typescript
test('wallet connection', async ({ page, context }) => {
  // Mock wallet provider
  await context.addInitScript(() => {
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method }) => {
        if (method === 'eth_requestAccounts')
          return ['0x1234567890123456789012345678901234567890']
        if (method === 'eth_chainId') return '0x7a69'
        throw new Error('Unexpected request to the wallet stub')
      }
    }
  })

  await page.goto('/')
  await page.locator('[data-testid="connect-wallet"]').click()
  await expect(page.locator('[data-testid="wallet-address"]')).toContainText('0x1234')
})
```

## Financial / Critical Flow Testing

Have the dedicated fixture expose its test identity and run ID from
`/__e2e/identity`. Supply the same unique `E2E_RUN_ID` to the fixture and
test runner. Stub the ledger and settlement providers. Use the fake backend
state for any confirmation assertions.

```typescript
test('shows a trade preview using a synthetic market', async ({ page, baseURL }) => {
  const runId = process.env.E2E_RUN_ID
  if (baseURL !== 'http://127.0.0.1:3000' || !runId) {
    throw new Error('Expected this run\'s local synthetic fixture')
  }
  const identity = await page.request.get('/__e2e/identity', { maxRedirects: 0 })
  expect(identity.status()).toBe(200)
  expect(await identity.json()).toMatchObject({
    environment: 'synthetic-e2e',
    runId,
    ledger: 'stub',
  })

  await page.goto('/markets/test-market')
  await expect(page).toHaveURL(baseURL + '/markets/test-market')
  await page.locator('[data-testid="position-yes"]').click()
  await page.locator('[data-testid="trade-amount"]').fill('1.0')

  // Verify preview
  const preview = page.locator('[data-testid="trade-preview"]')
  await expect(preview).toContainText('1.0')
})
```
