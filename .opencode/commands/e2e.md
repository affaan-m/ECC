---
description: Generate and run E2E tests with Playwright
agent: e2e-runner
subtask: true
---

# E2E Command

Generate and run end-to-end tests using Playwright: $ARGUMENTS

## Your Task

1. **Analyze user flow** to test
2. **Create test journey** with Playwright
3. **Run tests** and capture artifacts
4. **Report results** with screenshots/videos

## Test Structure

```typescript
import { test, expect } from '@playwright/test'

test.describe('Feature: [Name]', () => {
  test.beforeEach(async ({ page }) => {
    // Setup: Navigate, authenticate, prepare state
  })

  test('should [expected behavior]', async ({ page }) => {
    // Arrange: Set up test data

    // Act: Perform user actions
    await page.click('[data-testid="button"]')
    await page.fill('[data-testid="input"]', 'value')

    // Assert: Verify results
    await expect(page.locator('[data-testid="result"]')).toBeVisible()
  })

  test.afterEach(async ({ page }, testInfo) => {
    // Capture screenshot on failure
    if (testInfo.status !== 'passed') {
      await page.screenshot({ path: `test-results/${testInfo.title}.png` })
    }
  })
})
```

## Best Practices

### Selectors
- Prefer `data-testid` attributes
- Avoid CSS classes (they change)
- Use semantic selectors (roles, labels)

### Waits
- Use Playwright's auto-waiting
- Avoid `page.waitForTimeout()`
- Use `expect().toBeVisible()` for assertions

### Test Isolation
- Each test should be independent
- Clean up test data after
- Don't rely on test order

## Artifacts to Capture

- Screenshots on failure
- Videos for debugging
- Trace files for detailed analysis
- Network logs if relevant

## Test Categories

1. **Critical User Flows**
   - Authentication (login, logout, signup)
   - Core feature happy paths
   - Payment/checkout flows

2. **Edge Cases**
   - Network failures
   - Invalid inputs
   - Session expiry

3. **Cross-Browser**
   - Chrome, Firefox, Safari
   - Mobile viewports

## Report Format

```
E2E Test Results
================
PASS: Passed: X
FAIL: Failed: Y
SKIPPED: Skipped: Z

Failed Tests:
- test-name: Error message
  Screenshot: path/to/screenshot.png
  Video: path/to/video.webm
```

---

**TIP**: Run with `--headed` flag for debugging: `npx playwright test --headed`
