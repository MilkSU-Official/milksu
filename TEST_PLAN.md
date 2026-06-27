# MilkSU UI Test Plan

Read-only functional test for the Tauri v2 desktop client. DO NOT modify source code.

## Prerequisites

```bash
cd ~/code/milksu/app && npx tauri dev
```

Wait for Vite (port 1420) + Rust compilation. A native window titled "MilkSU" appears.

If port 1420 is in use: `lsof -ti:1420 | xargs kill -9` first.

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

### 3. Settings Page

**Steps:**
1. Click "Settings" at bottom of sidebar
2. Settings page opens in the main area

**Expected:**
- Back arrow button (top left), "Settings" title, "Save" button (top right)
- "Active Model" section: Provider dropdown (default: DeepSeek) + Model dropdown (default: deepseek-chat)
- "API Keys" section: cards for DeepSeek, Anthropic, OpenAI, Google Gemini, Groq
- Each card: provider name, Enable checkbox, API key input (password type), Show/Hide toggle
- Anthropic and OpenAI cards have additional "Base URL" field
- Footer text about local storage

**Verify:**
- [ ] Provider dropdown lists all 5 providers
- [ ] Changing provider updates model dropdown
- [ ] API key input is masked by default, "Show" reveals it
- [ ] Enable checkbox toggles
- [ ] "Save" button changes to "Saved" after click
- [ ] Back arrow returns to chat view
- [ ] Settings persist after closing and reopening settings page

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
