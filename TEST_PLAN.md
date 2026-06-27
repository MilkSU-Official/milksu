# MilkSU UI Test Plan

Read-only functional test for the Tauri v2 desktop client. DO NOT modify source code.

## Prerequisites

```bash
cd ~/code/milksu/app && npx tauri dev
```

Wait for Vite (port 1420) + Rust compilation. A native window titled "MilkSU" appears.

If port 1420 is in use: `lsof -ti:1420 | xargs kill -9` first.

### 0. Build Verification

**Steps:**
```bash
cd ~/code/milksu/app && npm run build
```

**Expected:**
- `tsc -b` passes with zero errors
- `vite build` produces dist/ with index.html, CSS, and JS bundle
- No TypeScript errors, no unused variable warnings

**Verify:**
- [ ] `npm run build` exits with code 0
- [ ] dist/index.html exists
- [ ] dist/assets/ contains .css and .js files

### 0a. Browser Preview Smoke

**Steps:**
```bash
cd ~/code/milksu/app && npm run dev -- --host 127.0.0.1
```
Open `http://127.0.0.1:1420/` in a browser.

**Expected:**
- Page renders without Tauri `invoke`/`listen` console errors
- Welcome page shows default model `deepseek-chat`
- Settings opens using browser-preview localStorage fallback data
- Sending a prompt may show a clear "Agent bridge requires the Tauri desktop runtime" error

**Verify:**
- [ ] No console errors after a clean page reload
- [ ] Welcome page renders, not a blank shell
- [ ] Settings opens and does not white-screen
- [ ] Browser preview never asks for real API keys

## Test Cases

### 1. Welcome Page

**Expected:**
- White/light theme, centered layout
- Heading: "What should we do?"
- Input box with placeholder "Type anything..."
- Below input: model selector (shows "deepseek-chat" with dropdown arrow) and send button (black circle with arrow)
- Four quick action buttons below: Scan a target / Connect browser / Start a CTF / Generate report
- No emoji anywhere in the UI

**Verify:**
- [ ] Heading text correct
- [ ] Input box has focus on load
- [ ] Model selector shows default model name
- [ ] Quick action buttons are plain text, no icons/emoji
- [ ] Send button is a black circle with up-arrow

### 2. Sidebar

**Expected:**
- Left sidebar (240px) with bg-[#fafafa]
- Top: "+ New conversation" button, Search button (SVG magnifier icon)
- Bottom: Settings button (SVG gear icon)
- No emoji in any button

**Verify:**
- [ ] New conversation button uses "+" character
- [ ] Search button uses SVG icon
- [ ] Settings button uses SVG gear icon
- [ ] All buttons have hover highlight

### 3. Settings Page Layout

**Steps:**
1. Click "Settings" at bottom of sidebar
2. Settings page opens as full-page view

**Expected:**
- Conversation sidebar is HIDDEN, replaced by settings category sidebar
- Left sidebar shows: Back button, then categories: General, API Keys, Usage, About
- Each category has an SVG icon
- Bottom of sidebar shows "MilkSU v0.1.0"
- Main content area shows the selected category content
- Top header shows category title + "Save changes" button (for General/API Keys)

**Verify:**
- [ ] Conversation sidebar disappears when settings opens
- [ ] Settings sidebar shows 4 categories with icons
- [ ] Clicking categories switches content
- [ ] "Back" button returns to chat view with conversation sidebar restored
- [ ] Active category is visually highlighted
- [ ] Narrow window (~390px wide) stacks settings navigation above content without overlapping text
- [ ] Narrow window may horizontally scroll setting tabs, but content cards and buttons remain readable

### 3a. Settings - General

**Steps:**
1. Open Settings, click "General" (default)

**Expected:**
- "Default Provider" section: Provider + Model dropdowns
- "Available Providers" section: list of all providers with green/gray dot status
- Configured providers show green dot + model count
- Unconfigured show gray dot + "Not configured"

**Verify:**
- [ ] Provider dropdown lists all 5 providers
- [ ] Changing provider updates model dropdown
- [ ] Provider status dots reflect API key configuration
- [ ] "Save changes" button works, shows "Saved" briefly

### 3b. Settings - API Keys

**Steps:**
1. Click "API Keys" category

**Expected:**
- Privacy notice at top about local storage
- Cards for each provider with: initial letter icon, name, env var name, toggle switch, password input
- Configured + enabled providers have green-tinted card border
- Toggle switch (not checkbox) for enable/disable
- Show/Hide button on API key input
- Anthropic and OpenAI have Base URL field

**Verify:**
- [ ] Toggle switches work (slide animation)
- [ ] API key input is masked by default
- [ ] Card border color changes when enabled + has key
- [ ] "Save changes" persists across settings close/reopen

### 3c. Settings - Usage

**Steps:**
1. Click "Usage" category

**Expected:**
- Session Overview: 3 stat cards (Conversations, Messages, Tool Calls) -- counted from local data
- Token Usage (Estimated): clearly labeled "Estimated Tokens" with "~" prefix and "character-based estimate" sub-label
- Description text explicitly states: "Rough estimate based on message character count (~4 chars per token). Real token counts from provider API are not yet available."
- Usage bars: User Messages, Assistant Messages (with color coding)
- Real-time Metrics section: 8 rows (Input Tokens, Output Tokens, Cache Read Tokens, Total Tokens (real), Context Window Limit, Cost (USD), Latency, Session Duration) all showing "unavailable" in italic
- Description text for Real-time Metrics states they require provider API usage data
- Provider Status: list of configured providers with active badge

**Verify:**
- [ ] Stat cards show correct counts matching sidebar conversation list
- [ ] Token estimate card shows "~" prefix (never presents as exact)
- [ ] Token estimate sub-label says "character-based estimate" (not implying real data)
- [ ] Description text for Token Usage says "Rough estimate" and mentions real data not available
- [ ] Real-time Metrics section exists with 8 unavailable rows
- [ ] Each unavailable row shows italic "unavailable" text (not 0, not blank)
- [ ] Usage bars have proportional fill
- [ ] Active provider shows "Active" badge
- [ ] types.ts has UsageData interface with: input_tokens, output_tokens, cache_read_tokens, total_tokens, context_limit, cost_usd, latency_ms, model, provider, tool_call_count, session_start, session_duration_ms (all nullable except tool_call_count)

### 3d. Settings - About

**Steps:**
1. Click "About" category

**Expected:**
- App info: Version 0.1.0, Runtime Tauri v2, Agent Engine Pi, Frontend React + Vite, Backend Rust
- Architecture: data flow diagram in monospace
- Storage: paths to settings.json and conversations directory

**Verify:**
- [ ] All info rows display correctly
- [ ] Architecture flow is readable
- [ ] Storage paths are shown

### 4. Model Selector (Input Bar)

**Steps:**
1. Return to welcome page (click New conversation)
2. Click the model name near the send button

**Expected:**
- Dropdown pops UP from the button (above input area)
- Shows all providers as section headers
- Models listed under each provider
- Providers without API key show "No key" and models are grayed out
- Bottom: "Configure API keys..." link

**Verify:**
- [ ] Dropdown appears above the input
- [ ] Provider sections are labeled
- [ ] Unconfigured providers show "No key"
- [ ] Clicking a model updates the selector label
- [ ] "Configure API keys..." opens Settings page
- [ ] Clicking outside closes dropdown

### 5. Send Message (IPC)

**Steps:**
1. Type text in input box, press Enter (or click send)

**Expected:**
- New conversation appears in sidebar (title = first ~40 chars of message)
- User message appears as right-aligned bubble
- If no API key configured: error message appears from assistant
- If API key configured: streaming assistant response appears character by character

**Verify:**
- [ ] Conversation created in sidebar with correct title
- [ ] User message renders as right-aligned bubble
- [ ] Response appears (error or real depending on API key)
- [ ] Input box clears after send

### 6. Quick Actions

**Steps:**
1. On welcome page, click any quick action button

**Expected:**
- Same as sending that text: creates conversation, sends to backend

**Verify:**
- [ ] Click "Scan a target" creates conversation titled "Scan a target"
- [ ] Backend responds (mock or real depending on bridge status)

### 7. Conversation Persistence

**Steps:**
1. Create 2-3 conversations with messages
2. Close the app window
3. Relaunch with `npx tauri dev`

**Expected:**
- All conversations reload in sidebar
- Selecting each shows its full message history

**Verify:**
- [ ] Conversations survive app restart
- [ ] Message content preserved
- [ ] Timestamps preserved
- [ ] Order preserved (newest first)

### 8. Conversation Delete

**Steps:**
1. Hover over a conversation in sidebar
2. Click the X button that appears

**Expected:**
- Conversation removed from sidebar
- If it was active, view returns to welcome page
- Deleted conversation does not reappear on restart

**Verify:**
- [ ] X button visible on hover
- [ ] Conversation removed from list
- [ ] Active conversation deletion returns to welcome
- [ ] Deletion persists across restart

### 9. Sidebar Search

**Steps:**
1. Create conversations with distinct titles
2. Click "Search" in sidebar
3. Type a filter term

**Expected:**
- Search input appears below the Search button
- Conversations filtered by title match (case insensitive)
- Also matches message content

**Verify:**
- [ ] Search input appears on click
- [ ] Typing filters conversation list in real-time
- [ ] Clearing search restores full list
- [ ] Partial match works

### 10. Chat View Header + Output Panel

**Steps:**
1. Enter a conversation with messages
2. Click "Output" button in header

**Expected:**
- Header shows conversation title + "Output" button
- Output panel opens on the right (272px wide)
- Panel shows tool messages or "No output yet"

**Verify:**
- [ ] Header shows correct title
- [ ] Output panel toggles open/close
- [ ] Panel displays tool messages if any exist

### 11. Tool Result Cards

**Note:** Requires agent to make tool calls (needs API key). If not available, skip.

**Expected:**
- Tool calls render as collapsible cards
- Card shows: spinner (running) or checkmark (done), tool name, expand arrow
- Collapsed: shows truncated preview of output
- Expanded: full output in monospace font

**Verify:**
- [ ] Running tool shows spinner
- [ ] Completed tool shows green checkmark
- [ ] Click expands/collapses
- [ ] Long output truncated in collapsed state

### 12. Model Selector in Chat View

**Steps:**
1. In an active conversation, check the input bar at the bottom

**Expected:**
- Same model selector as welcome page, positioned left of send button
- Selecting a different model updates it globally

**Verify:**
- [ ] Model selector present in chat view input bar
- [ ] Same dropdown behavior as welcome page
- [ ] Model change persists when switching conversations

### 13. New Conversation Reset

**Steps:**
1. Open a conversation, open Output panel
2. Click "New conversation" in sidebar

**Expected:**
- Returns to welcome page
- Output panel closes
- Input box gets focus

**Verify:**
- [ ] Welcome page displayed
- [ ] Output panel hidden
- [ ] Input ready for typing

## Environment Notes

- macOS: IMKCFRunLoopWakeUpReliable warning is harmless (macOS input method)
- Dev mode: Dock shows "milksu" (lowercase) -- this is the cargo binary name, correct in production build
- Port conflict: kill existing process on 1420 before starting
