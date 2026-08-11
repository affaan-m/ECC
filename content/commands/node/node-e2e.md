---
description: Test critical user flows end-to-end using Chrome DevTools MCP. Navigates pages, interacts with elements, captures screenshots, and validates user journeys.
---

# E2E Command

This command invokes the **e2e-runner** agent to test user flows via Chrome DevTools MCP browser automation.

## What This Command Does

1. **Test User Journeys** - Navigate pages, interact with elements, verify state
2. **Capture Evidence** - Screenshots at critical checkpoints
3. **Monitor Network** - Verify API calls and responses
4. **Detect Errors** - Check console for JavaScript errors
5. **Performance Analysis** - Run performance traces with Core Web Vitals

## When to Use

Use `/e2e` when:

- Testing critical user journeys (login, trading, payments)
- Verifying multi-step flows work end-to-end
- Testing UI interactions and navigation
- Validating integration between frontend and backend
- Preparing for production deployment

## How It Works

The e2e-runner agent uses Chrome DevTools MCP to:

1. **Navigate** to the target page
2. **Take snapshot** to identify interactive elements (each gets a uid)
3. **Interact** with elements (click, fill, press keys)
4. **Wait for** expected content to appear
5. **Verify** page state via accessibility tree snapshot
6. **Capture** screenshots and monitor network/console

## Example Usage

```text
User: /e2e Test the market search and view flow

Agent (e2e-runner):
# E2E Test: Market Search and View Flow

## Test Scenario

**User Journey:** Market Search -> View Results -> Click Market -> View Details

## Execution

### Step 1: Navigate to markets page
navigate_page(url: "http://localhost:3000/markets")
wait_for(text: ["Markets"])

### Step 2: Verify page loaded
take_snapshot()
# Found: heading "Markets", 12 market cards, search input [uid="e1"]

take_screenshot(filePath: "artifacts/markets-page.png")

### Step 3: Perform search
fill(uid: "e1", value: "election")
wait_for(text: ["results"])

### Step 4: Verify search results
take_snapshot()
# Found: 3 market cards with election-related titles

list_network_requests(resourceTypes: ["fetch"])
# GET /api/markets/search?q=election -> 200 OK

take_screenshot(filePath: "artifacts/search-results.png")

### Step 5: Click first result
click(uid: "e5")  # First market card
wait_for(text: ["Price", "Volume"])

### Step 6: Verify market details
take_snapshot()
# Found: market name, price chart, trading info

take_screenshot(filePath: "artifacts/market-details.png")

## Results

| Step | Status | Duration |
|------|--------|----------|
| Navigate to markets | PASS | 0.8s |
| Verify page loaded | PASS | 0.3s |
| Perform search | PASS | 1.2s |
| Verify search results | PASS | 0.4s |
| Click first result | PASS | 0.9s |
| Verify market details | PASS | 0.5s |

**Total: 6/6 PASSED (4.1s)**

## Console Errors: None
## Network Failures: None

Artifacts:
- artifacts/markets-page.png
- artifacts/search-results.png
- artifacts/market-details.png
```

## Chrome DevTools MCP Tools Reference

**Navigation:**

- `navigate_page` - Go to URL, back, forward, reload
- `new_page` - Open new tab
- `list_pages` / `select_page` - Manage tabs

**Inspection:**

- `take_snapshot` - Get accessibility tree with element uids
- `take_screenshot` - Capture page or element image
- `evaluate_script` - Execute JavaScript in page

**Interaction:**

- `click` - Click element by uid
- `fill` - Fill input/select by uid
- `fill_form` - Fill multiple fields at once
- `press_key` - Press key or combo (Enter, Tab, etc.)
- `type_text` - Type into focused input
- `hover` - Hover over element
- `drag` - Drag and drop

**Waiting:**

- `wait_for` - Wait for text to appear on page

**Monitoring:**

- `list_network_requests` - View API calls
- `get_network_request` - Inspect request/response details
- `list_console_messages` - View console output
- `get_console_message` - Get specific message

**Device Emulation:**

- `emulate` - Set viewport, dark mode, geolocation, network throttling
- `resize_page` - Change window size

**Performance:**

- `performance_start_trace` - Start recording
- `performance_stop_trace` - Stop and analyze

**Other:**

- `handle_dialog` - Accept/dismiss browser dialogs
- `upload_file` - Upload file through input

## Best Practices

**DO:**

- Take snapshots before every interaction to get fresh uids
- Use `wait_for` instead of arbitrary delays
- Capture screenshots at critical checkpoints
- Monitor console for errors after each action
- Verify network requests completed successfully

**DON'T:**

- Reuse stale uids from old snapshots
- Skip verification after interactions
- Ignore console errors or warnings
- Test against production environments

## Integration with Other Commands

- Use `/plan` to identify critical journeys to test
- Use `/tdd` for unit tests (faster, more granular)
- Use `/e2e` for integration and user journey tests
- Use `/code-review` to verify test quality

## Related Agents

This command invokes the `e2e-runner` agent located at:
`~/.claude/agents/e2e-runner.md`
