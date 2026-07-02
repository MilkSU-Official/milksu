---
name: browser-connect
description: Connect to user's running Chrome browser via CDP for page inspection and interaction. Essential for penetration testing on authenticated sessions.
triggerKeywords: [browser, chrome, page, screenshot, click, navigate, pentest, web, dom, CDP]
---

# Browser Connect Skill

Connect to a user's already-running Chrome browser via Chrome DevTools Protocol (CDP). This is critical for penetration testing and web automation scenarios where the user has already authenticated to target systems.

## Prerequisites

User must start Chrome with remote debugging enabled:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

## Available Tools

- `browser_connect` — Connect to Chrome via CDP (default port 9222)
- `browser_list_tabs` — List all open tabs
- `browser_switch_tab` — Switch to a specific tab by index or URL pattern
- `browser_get_page` — Get current page URL, title, and text/DOM content
- `browser_screenshot` — Take a screenshot of the current page
- `browser_click` — Click an element by CSS selector or coordinates
- `browser_type` — Type text into an input field
- `browser_evaluate` — Execute JavaScript in the page context
- `browser_navigate` — Navigate to a URL
- `browser_analyze` -- Analyze page for security-relevant elements (forms, links, scripts, cookies, headers, storage)
- `browser_intercept` -- Intercept HTTP requests: log, block by pattern, modify headers
- `browser_network` -- Passive network monitor: capture request/response pairs with headers and timing

## Limitations

- Single-session only: `browser_intercept` and `browser_network` use module-level state. If multiple conversations use browser tools concurrently, intercepted requests and network logs will be shared across conversations. Run one browser-related conversation at a time until session isolation is implemented (tracked as architecture issue #4).

## Usage Patterns

For known DOM structure, use CSS selectors (`browser_click`, `browser_type`).
For unknown or complex pages, use `browser_screenshot` + Vision Loop for visual analysis.
Always use `browser_get_page` first to understand the current page state before interacting.

## Pentest Workflow

1. Connect with `browser_connect`
2. Run `browser_analyze` to map the page attack surface
3. Start `browser_network` to capture traffic
4. Interact with forms, click links, trigger AJAX calls
5. Read `browser_network` log to find API endpoints, auth tokens, CSRF tokens
6. Use `browser_intercept` to replay modified requests (header injection, parameter tampering)
7. Report findings via `panel_update` from the panel skill
