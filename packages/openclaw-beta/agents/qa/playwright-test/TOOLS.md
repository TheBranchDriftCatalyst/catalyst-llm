# PlaywrightTestAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | RW | Claim test beads, update QA gate fields, report results |
| `filesystem` | RW | Read specs/use cases, write test files to `tests/e2e/` |
| `time` | R | Timestamps for bead History entries |
| `context7` | R | Query Playwright docs for API patterns, selectors, assertions |
| `playwright` | **RW** | **Primary tool** — browser automation, screenshots, DOM inspection |

## Playwright MCP — Detailed Usage

The `playwright` MCP provides direct browser control for E2E testing. This is the
agent's primary execution tool.

### Available Playwright MCP Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `browser_navigate` | Navigate to a URL | Start of every test flow |
| `browser_snapshot` | Get accessibility tree (DOM snapshot) | Inspect page state, find elements |
| `browser_click` | Click an element | User interaction simulation |
| `browser_fill_form` | Fill form fields | Form testing |
| `browser_type` | Type text into focused element | Text input |
| `browser_press_key` | Press keyboard key | Keyboard shortcuts, Enter/Tab |
| `browser_select_option` | Select dropdown option | Form selects |
| `browser_take_screenshot` | Capture page screenshot | Visual regression, failure evidence |
| `browser_evaluate` | Run JavaScript in page | Custom assertions, state checks |
| `browser_wait_for` | Wait for element/condition | Async content loading |
| `browser_hover` | Hover over element | Tooltip/menu testing |
| `browser_drag` | Drag and drop | DnD interaction testing |
| `browser_console_messages` | Get browser console output | Error detection |
| `browser_network_requests` | Inspect network activity | API call verification |
| `browser_tabs` | Manage browser tabs | Multi-tab workflows |
| `browser_navigate_back` | Go back in history | Navigation testing |
| `browser_handle_dialog` | Handle alert/confirm/prompt | Dialog testing |
| `browser_file_upload` | Upload files | File input testing |
| `browser_resize` | Resize viewport | Responsive design testing |
| `browser_close` | Close browser session | Cleanup |

### E2E Test Workflow

```
1. browser_navigate → target URL
2. browser_snapshot → inspect initial state
3. browser_click / browser_fill_form → simulate user actions
4. browser_snapshot → verify state changes
5. browser_take_screenshot → capture evidence
6. browser_evaluate → run custom assertions
7. Update bead QA Gate with results
```

### Visual Regression Pattern

```
1. browser_navigate → target page
2. browser_resize → set consistent viewport (1280x720)
3. browser_take_screenshot → capture "actual" screenshot
4. Compare with baseline screenshot (stored in tests/e2e/snapshots/)
5. Report pixel diff percentage in bead QA Gate
```

### Cross-Browser Testing

```
For each browser (chromium, firefox, webkit):
  1. browser_navigate → same URL
  2. Run same test steps
  3. browser_take_screenshot → capture per-browser
  4. Compare results across browsers
```

### Page Object Pattern (Required)

Organize selectors and actions into reusable page objects:

```
tests/e2e/
  pages/
    login.page.ts        # LoginPage class with selectors + actions
    dashboard.page.ts    # DashboardPage class
  flows/
    auth.flow.ts         # login → dashboard flow
    crud.flow.ts         # create → read → update → delete flow
  snapshots/
    baseline/            # Visual regression baselines
```

## Authorized File Paths (Write)
- `tests/e2e/**` — E2E test files, page objects, flow definitions
- `tests/e2e/snapshots/**` — Visual regression baselines
- `beads/**` — Update bead status and QA gate fields
- `agents/qa/playwright-test/memory/` — Agent memory

## Restricted
- No application code modifications
- No unit or integration test modifications (those belong to other QA agents)
- No infrastructure access
- No direct API testing (use the UI — if testing APIs, defer to QAIntegrationAgent)
- Screenshots stored locally, not uploaded externally
