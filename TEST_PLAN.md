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
- Welcome page shows task type selector and default model `deepseek-chat`
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
- Task type selector: 5 color-coded pills (Chat, Pentest, CTF, Recon, Reverse)
  - Chat: neutral/gray, Pentest: red, CTF: purple, Recon: blue, Reverse: amber
  - Each pill has a lucide icon (MessageSquare, Shield, Flag, Network, Binary)
  - Active pill has ring + darker background
- Input box with placeholder changes by task type:
  - Chat: "Type anything..."
  - Pentest: "Describe target or paste scope..."
  - CTF: "Paste challenge description..."
  - Recon: "Enter target domain or IP range..."
  - Reverse: "Provide binary path or paste disassembly..."
- Non-chat task types show description text below selector
- Below input: model selector (shows "deepseek-chat") and send button (black circle with arrow)
- No emoji anywhere in the UI

**Verify:**
- [ ] Heading text correct
- [ ] 5 task type pills render with correct colors and icons
- [ ] Clicking a pill highlights it (ring + darker bg)
- [ ] Input placeholder changes when switching task type
- [ ] Description text appears for non-chat types
- [ ] Model selector shows default model name
- [ ] Send button is a black circle with up-arrow

### 2. Sidebar

**Expected:**
- Left sidebar (240px) with bg-[#fafafa]
- Top: "+ New conversation" button, Search button (SVG magnifier icon)
- Bottom: Settings button (SVG gear icon)
- Conversation items show task type icon (colored lucide icon) before title
  - Pentest: red Shield, CTF: purple Flag, Recon: blue Network, Reverse: amber Binary
  - Chat conversations have no icon prefix
- No emoji in any button

**Verify:**
- [ ] New conversation button uses "+" character
- [ ] Search button uses SVG icon
- [ ] Settings button uses SVG gear icon
- [ ] Task type icons appear on non-chat conversations
- [ ] Task icons use correct colors
- [ ] All buttons have hover highlight

### 3. Settings Page Layout

**Steps:**
1. Click "Settings" at bottom of sidebar
2. Settings page opens as full-page view

**Expected:**
- Conversation sidebar is HIDDEN, replaced by settings category sidebar
- Left sidebar shows: Back button (ChevronLeft icon), then categories: General, API Keys, Usage, About
- Each category has a lucide icon (Settings, KeyRound, BarChart3, Info)
- Bottom of sidebar shows "MilkSU v0.1.0"
- Main content area shows the selected category content
- Top header shows category title + "Save changes" button (for General/API Keys)
- All using shadcn/ui components (Button, Card, Input, Switch, Badge, Separator, Label)

**Verify:**
- [ ] Conversation sidebar disappears when settings opens
- [ ] Settings sidebar shows 4 categories with lucide icons
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
- shadcn Cards for each provider with:
  - Initial letter icon, provider name, env var name in CardHeader
  - CardAction slot contains the Switch (top-right via CSS grid)
  - CardContent: password Input field, Show/Hide toggle
  - Configured + enabled providers have green-tinted card border
- Anthropic and OpenAI have Base URL field

**Verify:**
- [ ] Switch (not checkbox) in CardAction position (top-right corner)
- [ ] API key input is masked by default
- [ ] Card border color changes when enabled + has key
- [ ] "Save changes" persists across settings close/reopen
- [ ] Show/Hide button reveals/hides the API key

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

### 5. Task Type Selection + Send

**Steps:**
1. On welcome page, click "Pentest" task type pill
2. Type text in input box, press Enter

**Expected:**
- "Pentest" pill highlighted with red ring
- Placeholder changes to "Describe target or paste scope..."
- Description text: "Penetration testing workflow"
- New conversation appears in sidebar with red Shield icon
- Chat header shows "Pentest" badge with Shield icon
- Task panel auto-opens on the right (overlays chat area)

**Verify:**
- [ ] Task type pill highlights correctly
- [ ] Placeholder updates for pentest type
- [ ] Sidebar item shows Shield icon in red
- [ ] Chat header badge displays correct task type
- [ ] Task panel opens automatically
- [ ] Panel overlays chat (does NOT squeeze/shrink chat width)

### 6. Task Panel

**Steps:**
1. Create a pentest conversation (see test 5)
2. Observe the task panel on the right

**Expected:**
- Panel is 320px wide, overlays chat area from the right
- Has shadow-xl for visual separation
- Close button (X) in top-right of panel header
- Panel header shows task type label
- For pentest: Target card, Phase tracker (6 phases), Vulnerabilities list, Open Ports table, Tools Used badges
- Phase tracker: phases shown as vertical list with CheckCircle2 (done), ChevronRight (active, animated), Circle (pending)
- All fields empty/placeholder since no agent has run tools yet
- Clicking header "Panel" button toggles the panel

**Verify:**
- [ ] Panel overlays chat, does not squeeze layout
- [ ] Close button (X) closes the panel
- [ ] "Panel" button in chat header re-opens it
- [ ] Phase tracker shows first phase as active
- [ ] Empty state displayed for all data fields

### 6a. Task Panel - CTF Type

**Steps:**
1. Create a CTF conversation

**Expected:**
- CTF panel shows: Challenge card (name, category, points), Progress tracker (4 phases), Flags list, Solved badge

**Verify:**
- [ ] CTF panel renders with correct layout
- [ ] Solved badge shows "Unsolved" initially

### 6b. Task Panel - Recon Type

**Steps:**
1. Create a Recon conversation

**Expected:**
- Recon panel shows: Scope list, Phase tracker (4 phases), Hosts table, Services table, Findings list

**Verify:**
- [ ] Recon panel renders with correct layout
- [ ] Tables show empty/placeholder state

### 6c. Task Panel - Reverse Type

**Steps:**
1. Create a Reverse conversation

**Expected:**
- Reverse panel shows: Binary card (name, arch), Phase tracker (4 phases), Protections grid (NX, Canary, PIE, RELRO), Functions table, Findings list

**Verify:**
- [ ] Reverse panel renders with correct layout
- [ ] Protections grid shows all items as disabled/off initially

### 7. Send Message (IPC)

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

### 8. Conversation Persistence

**Steps:**
1. Create 2-3 conversations with different task types and messages
2. Close the app window
3. Relaunch with `npx tauri dev`

**Expected:**
- All conversations reload in sidebar with correct task type icons
- Selecting each shows its full message history
- Task type and task state preserved

**Verify:**
- [ ] Conversations survive app restart
- [ ] Task type icons correct after reload
- [ ] Message content preserved
- [ ] Timestamps preserved
- [ ] Order preserved (newest first)
- [ ] Selecting a security-type conversation auto-opens task panel

### 9. Conversation Delete

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

### 10. Sidebar Search

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

### 11. Chat View Header

**Steps:**
1. Enter a conversation with messages

**Expected:**
- Header shows conversation title
- For chat-type: "Output" button toggles OutputPanel
- For security-type: task type badge (icon + label) + "Panel" button toggles TaskPanel

**Verify:**
- [ ] Header shows correct title
- [ ] Chat-type: "Output" button works, toggles OutputPanel
- [ ] Security-type: badge displays with correct icon/color
- [ ] Security-type: "Panel" button toggles TaskPanel

### 12. Tool Result Cards

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

### 13. Model Selector in Chat View

**Steps:**
1. In an active conversation, check the input bar at the bottom

**Expected:**
- Same model selector as welcome page, positioned left of send button
- Selecting a different model updates it globally

**Verify:**
- [ ] Model selector present in chat view input bar
- [ ] Same dropdown behavior as welcome page
- [ ] Model change persists when switching conversations

### 14. New Conversation Reset

**Steps:**
1. Open a conversation, open Task Panel or Output panel
2. Click "New conversation" in sidebar

**Expected:**
- Returns to welcome page with task type selector
- Task panel and Output panel close
- Task type resets to "Chat"
- Input box gets focus

**Verify:**
- [ ] Welcome page displayed with task type selector
- [ ] Task panel hidden
- [ ] Output panel hidden
- [ ] Task type reset to Chat (neutral pill selected)
- [ ] Input ready for typing

## Environment Notes

- macOS: IMKCFRunLoopWakeUpReliable warning is harmless (macOS input method)
- Dev mode: Dock shows "milksu" (lowercase) -- this is the cargo binary name, correct in production build
- Port conflict: kill existing process on 1420 before starting
- shadcn/ui: components use oklch color variables and CSS grid for CardAction layout
- Task panel uses absolute positioning (overlay), not flex layout -- avoids squeezing chat on narrow viewports
