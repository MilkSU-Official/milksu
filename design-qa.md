# Design QA — MilkSU Challenge Desk

> 文档状态：**Historical design evidence collection**。
>
> 本文件按时间保留多轮截图比较和当时结论，不描述当前 UI 全貌，也不提供待办。当前产品
> 目标与缺口见 `docs/developer/current-objectives.md` 和
> `docs/developer/objective-coverage-ledger.md`。

## Comparison target

- Source visual truth: `/Users/milksu/.codex/generated_images/019fb283-1d93-7370-8b5c-d6c943625596/call_lKiDWG1GDkFR9Atdc4JnezlV.png`
- Rendered implementation: `http://127.0.0.1:1421/`
- Final implementation screenshot: `/tmp/milksu-challenge-desk-final.png`
- Responsive implementation screenshot: `/tmp/milksu-challenge-desk-narrow.png`
- Full-view comparison evidence: `/tmp/milksu-challenge-desk-final-comparison.png`
- Focused detail comparison evidence: `/tmp/milksu-challenge-desk-focused-comparison.png`
- Desktop viewport: 1488 × 1058 CSS px, device scale 1
- Source pixels: 1487 × 1058
- Implementation pixels: 1488 × 1058
- Responsive viewport and pixels: 900 × 900, device scale 1
- Density normalization: none required; the source and implementation differ by one horizontal pixel only.
- State: NSSCTF selected, a real catalog problem selected, detail visible, light theme.

The source includes a 46 px native-style macOS title bar while the browser implementation capture begins at app content. That surrounding frame is excluded from component fidelity findings. The selected problem and its training history differ between source and implementation, so dynamic title, progress, recommendation, score, and radar values are evaluated as state differences rather than layout defects.

## Findings

No actionable P0, P1, or P2 findings remain.

- [P3] Selected row has a stronger edge cue than the source
  - Location: `CTFChallengeDesk.vue`, challenge row selected state.
  - Evidence: the source uses a violet dot and tint; the implementation adds a 2 px violet leading edge.
  - Impact: minor visual drift, but it improves scanability and does not change density or hierarchy.
  - Follow-up: remove `border-l-2` only if exact visual cloning is preferred over the stronger state cue.

- [P3] New-problem detail is intentionally more compact
  - Location: right detail pane.
  - Evidence: the source state has prior attempts, a recommendation, and scored ability data; the implementation state is truthful and has none of those records yet.
  - Impact: more open space appears below the ability strip, but no placeholder facts are invented.
  - Follow-up: no visual fix until real training facts exist.

## Required fidelity surfaces

- Fonts and typography: the implementation uses the existing Inter variable stack with comparable weights, line height, tracking, and hierarchy. Long Chinese titles wrap in the detail pane and truncate in the table without collision. Small metadata remains readable.
- Spacing and layout rhythm: the final desktop split is approximately 49/51, matching the source composition. Header, table rows, detail sections, CTA, dividers, and compact ability strip align to the source rhythm. At 900 px the list and detail stack without horizontal overflow, and selecting a row scrolls the detail into view.
- Colors and visual tokens: the existing Memoh warm-neutral surfaces, violet brand state, blue/yellow difficulty states, black CTA, muted borders, and text opacity match the selected direction. Contrast remains adequate for primary controls and headings.
- Image quality and asset fidelity: the generated learner avatar is a real 512 × 512 raster asset with the requested monochrome art direction and a clean circular crop. The radar remains a real data visualization tied to ability dimensions. Lucide icons preserve the app’s existing consistent stroke family.
- Copy and content: descriptive landing-page filler is absent. Labels are task-oriented: question bank, search, category, progress, collaboration mode, “用 Agent 开始”, readiness, and platform connection state. Dynamic problem content is real catalog data.
- States and interactions: challenge selection, search, category filtering, NSSCTF/CTFshow switching, CTFshow empty/connection state, numeric pagination, responsive detail reveal, and the primary Agent CTA into the workbench were exercised. The final reload produced no console errors or warnings.
- Accessibility: controls use semantic buttons, radios, comboboxes, headings, regions, labels, `aria-current`, `aria-pressed`, and visible state changes. The responsive layout preserves practical targets and avoids clipped persistent controls.

## Comparison history

### Pass 1 — blocked

- P2: list/detail proportions were 56/44 instead of the source’s near-even split.
- P2: selected rows showed a full violet focus outline instead of a quiet tinted state.
- P2: pagination exposed only previous/next and did not scale to the real local catalog.
- Fixes: changed the desktop grid to 0.98fr/1.02fr; replaced the full outline with tint, dot, and leading edge; added a five-page sliding numeric pagination control; aligned copy and CTA wording to the chosen design.
- Post-fix evidence: `/tmp/milksu-challenge-desk-comparison-2.png`.

### Pass 2 — blocked

- P2: at 900 px, list and detail stacked correctly but selecting a problem left the newly loaded detail below the fold without guidance.
- Fix: watch the selected problem at the responsive breakpoint and scroll the detail pane into view after the real problem import resolves.
- Post-fix evidence: `/tmp/milksu-challenge-desk-narrow.png`.

### Pass 3 — passed

- Desktop composition, focused detail, responsive behavior, required fidelity surfaces, primary interactions, and final console state were rechecked.
- Full-view evidence: `/tmp/milksu-challenge-desk-final-comparison.png`.
- Focused evidence: `/tmp/milksu-challenge-desk-focused-comparison.png`.
- Console after final reload: 0 errors, 0 warnings.

## Implementation checklist

- [x] Continuous list/detail Challenge Desk
- [x] Real NSSCTF catalog rows and detail import
- [x] NSSCTF/CTFshow switch, search, category, pagination, and empty states
- [x] Direct Agent CTA into the existing workbench
- [x] Compact avatar and ability radar
- [x] Desktop and 900 px responsive verification
- [x] Final source/implementation full-view and focused comparison

## Follow-up polish

- Replace the P3 selected leading edge with the source’s dot-only state if strict cloning becomes more important than stronger selection affordance.
- Recheck the populated progress/recommendation/ability state after the first verified real training result.

## Follow-up QA — concise primary navigation

- Source visual truth: `/Users/milksu/code/milksu/docs/design/milksu-concise-nav-reference.png`
- Rendered implementation: `http://127.0.0.1:1421/`
- Implementation screenshot: `/Users/milksu/code/milksu/docs/design/milksu-concise-nav-render.png`
- Focused side-by-side comparison: `/Users/milksu/code/milksu/docs/design/milksu-concise-nav-comparison.png`
- Source pixels: 524 × 412.
- Full implementation pixels: 1280 × 720; browser viewport reports 1280 × 720 CSS px at device pixel ratio 2.
- Density normalization: the implementation was cropped to the same 524 × 412 sidebar region before horizontal comparison.
- State: CTF selected, NSSCTF catalog populated, HTB-inspired dark theme.

### Findings

No actionable P0, P1, or P2 findings remain.

- The three primary labels are exactly `CTF / Coding / CVE`; the suffixes `训练 / Agent / 追踪` no longer appear in the sidebar.
- The existing Lucide icons, left alignment, row rhythm, brand block and settings affordance are preserved.
- The source uses the former light theme while the implementation uses the user-selected HTB dark theme; this is an intentional token-level difference, not navigation drift.
- No raster or custom-drawn replacement assets were introduced.

### Required fidelity surfaces

- Fonts and typography: existing Inter variable family, label weight and line height are unchanged; the shorter labels improve scanability without changing type scale.
- Spacing and layout rhythm: sidebar width, brand spacing, icon/label gap and vertical navigation rhythm match the existing component and the source crop.
- Colors and visual tokens: the current semantic Labs tokens remain intact; shortening the labels did not add local color overrides.
- Image quality and asset fidelity: the comparison uses the supplied screenshot directly; implementation icons remain vector components from the established icon library.
- Copy and content: the requested sidebar copy is exact. Full page headings such as `CTF 训练` and `CVE 追踪` remain descriptive inside their workspaces.
- States and interactions: `CTF`, `Coding` and `CVE` were each clicked; all three navigated to their existing product surface, and returning to CTF restored the catalog.
- Console: zero errors and zero warnings; only Vite connection debug entries were present.

### Comparison history

- Pass 1 — passed: the focused side-by-side comparison found no actionable P0/P1/P2 mismatch. No visual fix loop was required.

final result: passed

# Coding 输入区与右侧页面响应式收口 · Design QA

**Comparison Target**

- Source visual truth:
  `/var/folders/wf/0w9rnrs904501nhp57pd_jzw0000gn/T/codex-clipboard-f2880711-da45-47ce-a0f4-ca509eb52978.png`
- Packaged macOS implementation:
  `/private/tmp/milksu-composer-native-final.jpeg`
- Source pixels: `1568 × 238`.
- Implementation pixels and app window: `1187 × 768`.
- State: Coding 新任务、架构图右侧页面打开、输入区空闲。
- Density normalization: source is a focused composer crop while implementation is a full packaged-app
  capture. The composer and right-panel boundary were compared at visible scale; unrelated sidebars
  and empty-state content were excluded from fidelity judgments.

**Findings**

No actionable P0, P1, or P2 finding remains.

- The input island exposes only the three values that affect the next message: Plan/Go,
  permission policy, and model. Project selection now lives in the Environment workspace card.
- Product actions and persistent goals live in Environment; Architecture is selected from the
  right-page selector. Capability, plugin, skill, tool, and model runtime facts live in Environment.
- At the desktop compact breakpoint, Architecture and Changes use a `20rem` side panel instead of
  covering the composer. The model selector remains visible as `V4 Flash`.
- Below `56rem`, the right page intentionally becomes a drawer because both work surfaces can no
  longer remain usable side by side.

**Required Fidelity Surfaces**

- Fonts and typography: all three composer controls share the compact body token and retain readable
  labels; the model value is not clipped.
- Spacing and layout rhythm: one quiet context row sits above the borderless input island. The
  right page uses a stable desktop split and no longer overlaps the composer at ordinary compact
  desktop widths.
- Colors and tokens: existing HTB-inspired navy, muted, border, and lime action tokens are unchanged.
- Image and asset fidelity: no new raster, placeholder, custom SVG, CSS drawing, emoji, or substitute
  asset was introduced.
- Copy and content: duplicate `动作 / 目标 / 架构图 / 能力` controls are absent from the composer.
  The configured model remains explicit.

**Comparison History**

- Pass 1 — P1: the supplied view contained eight competing controls and reduced the model selector
  to an ambiguous or hidden value.
- Fix: moved product actions, goals, architecture, and runtime capability facts to the right-side
  surfaces; reserved non-shrinking trailing space for the model.
- Pass 2 — P2: at `1100px` browser width, the compact right page changed to an overlay and visually
  covered the trailing model control.
- Fix: keep a `20rem` side-by-side right page through the desktop compact breakpoint; switch to an
  overlay drawer only below `56rem`.
- Pass 3 — passed: the rebuilt and self-signed Wails app shows
  `Go / 替我审批 / V4 Flash` while the Architecture page is open. The accessibility tree
  confirms the three composer controls, the Environment-owned workspace action, and the independent
  Architecture selector.

**Checks**

- Packaged Wails build: passed.
- Go test suite: passed.
- Vue/Vitest suite: `11` files, `43` tests passed.
- Browser console at `1280 × 720`: `0` errors, `0` warnings.
- Native packaged-app interaction: Coding → right-page selector → Architecture; model remains visible.

final result: passed

# Coding 输入区发送上下文收口 · Follow-up QA

- Source visual truth:
  `/var/folders/wf/0w9rnrs904501nhp57pd_jzw0000gn/T/codex-clipboard-f2880711-da45-47ce-a0f4-ca509eb52978.png`
- Rendered implementation:
  `http://127.0.0.1:1421/`
- Implementation screenshot:
  `/private/tmp/milksu-coding-composer-final-full.png`
- Focused before/after comparison:
  `/private/tmp/milksu-coding-composer-controls-comparison.png`
- Browser viewport and implementation pixels: `1280 × 720`; device pixel ratio `2`.
- State: Coding empty task, the wider right-side Architecture page open, composer idle.

## Findings

No actionable P0, P1, or P2 finding remains.

- The composer now contains only the three controls that change the next message: Plan/Go,
  approval mode, and model. Workspace selection is available from Environment.
- Product actions, persistent goals, architecture generation, and capability details remain in the
  right-side panel and no longer duplicate the composer.
- The model trigger is the flexible trailing control and reserves at least `10rem` (`9rem` in the
  compact container rule). `V4 Flash` remains fully visible with the wider Architecture page open.

## Required fidelity surfaces

- Fonts and typography: all three controls use the same compact body token; no label is clipped.
- Spacing and layout rhythm: one quiet control row sits above the input island, with the model owning
  the flexible trailing space.
- Colors and tokens: the existing HTB-inspired surface, foreground, muted, and brand tokens remain
  unchanged.
- Image and asset fidelity: no new image, custom SVG, CSS drawing, emoji, or placeholder was added.
- Copy and content: duplicate `动作 / 目标 / 架构图 / 能力` labels are absent from the composer; the
  configured model name is explicit.
- States and interactions: the right-side selector was changed from Environment to Architecture,
  the model menu was opened and closed without changing the configured model, and the browser
  reported zero errors and zero warnings.

## Comparison history

- Pass 1 — P1 in the supplied screenshot: eight controls competed for width and reduced the model
  selection to an ambiguous `自动`.
- Fix: kept only send-context controls and gave the model trigger a non-shrinking minimum width.
- Pass 2 — passed: focused side-by-side evidence shows `Go / 替我审批 / V4 Flash` in the
  narrow center column while Architecture remains available in the right panel.

final result: passed

# Coding 导航与输入控制密度 · Design QA

**Comparison Target**

- Source visual truth:
  - `/var/folders/wf/0w9rnrs904501nhp57pd_jzw0000gn/T/codex-clipboard-2a2d8d4f-316e-481a-a979-b97c4fb66d2d.png`
  - `/var/folders/wf/0w9rnrs904501nhp57pd_jzw0000gn/T/codex-clipboard-f2880711-da45-47ce-a0f4-ca509eb52978.png`
- Packaged-app implementation:
  - `/private/tmp/milksu-coding-density-final.png`
  - `/private/tmp/milksu-coding-architecture-final.png`
  - `/private/tmp/milksu-composer-alignment-final-typed.png`
  - `/private/tmp/milksu-coding-controls-goal-in-sidebar.png`
- Full-view comparison:
  - `/private/tmp/milksu-coding-density-comparison.png`
- Focused comparisons:
  - `/private/tmp/milksu-sidebar-density-comparison.png`
  - `/private/tmp/milksu-composer-density-comparison.png`
  - `/private/tmp/milksu-coding-controls-focused-comparison.png`
- App viewport and implementation pixels: `1187 × 768`.
- Source pixels: `2880 × 1864`, normalized to `1187 × 768` at the same aspect ratio.
- State: Coding workspace with the environment panel open; a second capture verifies the wider architecture panel.

**Findings**

No actionable P0, P1, or P2 mismatch remains in the requested regions.

- The product rail, new-task/search controls, project rows, and conversation rows now share a compact
  type scale and tighter vertical rhythm. Folder names and their conversation rows use the same
  `11 px` caption token.
- The composer toolbar no longer duplicates the right-panel `架构图` action or Agent `能力` details.
  Architecture remains in the right-panel selector; skills, tools, and project MCP state live in
  `环境信息`.
- Persistent-goal status and its resume/clear controls also live under the right-panel `任务操作`
  section. Enabling goal mode does not add another row above the composer.
- The model trigger has the remaining flexible width and displays `V4 Flash` completely, including
  while the wider architecture panel is open. Provider and full model metadata remain available in
  the model menu and environment panel.
- The empty composer no longer displays descriptive placeholder copy. Typed single-line text is
  vertically centered inside the input island.

**Required Fidelity Surfaces**

- Fonts and typography: rail labels are `10 px`; Coding navigation and task hierarchy use the same
  `11 px` caption token; composer controls use `12 px`. The model label remains readable and does not
  clip.
- Spacing and layout rhythm: rail targets are `48 px`; task controls and conversation rows are
  `28 px`; the composer keeps one compact control row above the input island without duplicate
  product actions.
- Colors and tokens: existing MilkSU HTB-inspired surface, foreground, muted, border, and brand
  tokens are unchanged.
- Image and asset fidelity: no new raster asset, placeholder, custom SVG, emoji, or CSS drawing was
  introduced. Existing icon-library components remain in use.
- Copy and content: the unnecessary prompt hint is absent. The compact model trigger uses the
  unambiguous model name while full provider context remains in detailed surfaces.
- States and interactions: Coding navigation, empty composer, environment panel, architecture panel,
  model visibility, typed-input alignment, goal-mode placement, project MCP placement, and Agent
  skill/tool placement were exercised in the packaged Wails app.

**Comparison History**

- Pass 1 — blocked by P2: after removing duplicate actions, the full
  `DeepSeek · DeepSeek V4 Flash` trigger could still be squeezed by the architecture panel.
- Fix: assigned the model trigger the flexible trailing slot, tightened control typography and
  displayed the concise configured model name in the trigger.
- Pass 2 — passed: `V4 Flash` remains fully visible with both environment and architecture panels;
  the composer has no placeholder; the side navigation and task hierarchy are materially quieter.
- Pass 3 — passed: goal mode was enabled and verified under the right-panel `任务操作` section; the
  composer text contains only `Go / 替我审批 / V4 Flash`. The model trigger remains visible at
  the default viewport and at `1024 × 768` and `800 × 700`.

**Browser and Build Verification**

- In-app Browser DOM check confirmed:
  - Coding is the active primary workspace.
  - `架构图` is available from the right-panel selector.
  - no bottom `能力` button remains.
  - goal mode and goal controls stay in the environment panel instead of adding a composer row.
  - the composer placeholder is empty.
  - the model trigger contains `V4 Flash`.
- Browser console: `0` errors, `0` warnings.
- Packaged macOS app: rebuilt and opened successfully.

final result: passed

# Coding 权限菜单 · Design QA

- Source visual truth:
  `/var/folders/wf/0w9rnrs904501nhp57pd_jzw0000gn/T/codex-clipboard-89bf5171-9bfd-483d-acea-af050d56d693.png`
- Implementation screenshot:
  `/tmp/milksu-permission-full-selected-crop.png`
- Focused side-by-side comparison:
  `/tmp/milksu-permission-full-comparison.png`
- Browser-rendered full screen:
  `/tmp/milksu-permission-full-selected.png`
- Viewport: `1280 × 720` CSS px; implementation screenshot pixels `1280 × 720`.
- Source pixels: `720 × 424`; focused implementation pixels: `416 × 353`.
- Density normalization: the focused implementation was proportionally scaled to the source height
  for side-by-side comparison; neither image was stretched.
- State: Coding workspace, permission menu open, `完全访问权限` selected.

## Full-view and focused comparison evidence

The implementation follows the supplied Codex hierarchy: the current permission is a compact composer
control; opening it reveals a floating rounded menu; the title and underlined help action share the
first row; three permission choices use icon, title, one-line boundary explanation and a right-aligned
check; a separator isolates full access; full access uses the semantic warning color in both the menu
and the collapsed trigger.

The MilkSU product remains on its user-selected dark HTB-inspired theme rather than copying Codex's
light palette. The copy reflects the implemented MilkSU boundary: project auto stops at the project
boundary, and request approval remains read-only until the synchronous approval channel exists.

## Required fidelity surfaces

- Fonts and typography: the existing Inter variable stack is retained; header, option title,
  explanation and trigger use one consistent control scale and weight hierarchy without clipping.
- Spacing and layout rhythm: the `400 px` menu, `12–16 px` insets, grouped option rows, separator,
  rounded frame and right-aligned check match the reference structure. At a `1024 × 700` viewport the
  menu bounds remained fully visible (`left 624`, `right 1024`, `top 281`, `bottom 573.6`).
- Colors and visual tokens: neutral options use existing foreground/muted tokens; full access alone
  uses the established warning token. The dark surface is an intentional product-theme adaptation.
- Image quality and asset fidelity: no raster stand-ins or custom-drawn icons were introduced.
  Existing Lucide icons provide the closest semantic equivalents within MilkSU's icon system.
- Copy and content: labels match Codex's three-level mental model while descriptions state MilkSU's
  real behavior instead of overstating unavailable approval capabilities.
- States and interactions: menu open/close, project-auto selection, full-access selection, selected
  check, warning trigger state, help action and permission-detail panel were exercised. The recommended
  `替我审批` state was restored after the test.

## Comparison history

### Pass 1 — passed

- No actionable P0/P1/P2 mismatch remained after matching the title/help row, option layout, separator,
  warning treatment and selected check.
- Intentional deviations are the dark product theme, MilkSU name and honest current boundary copy.
- Browser console after interaction: `0` errors and `0` warnings.

## Follow-up polish

- Replace the middle shield icon only if MilkSU later adopts Codex's exact icon family; the current
  icon is semantically clear and consistent with the rest of the application.

final result: passed

## Follow-up QA — scalable CTF sources, history, custom intake, and browser pairing

- Source visual truth:
  - `/var/folders/wf/0w9rnrs904501nhp57pd_jzw0000gn/T/codex-clipboard-7ab3c148-472d-4d7f-a0c1-c9696e083292.png`
  - `/var/folders/wf/0w9rnrs904501nhp57pd_jzw0000gn/T/codex-clipboard-e8b05593-d8f0-434d-9511-9087fae8ed71.png`
- Browser-rendered implementation:
  - `/Users/milksu/code/milksu/docs/design/milksu-ctf-platform-header-v2.jpg`
  - `/Users/milksu/code/milksu/docs/design/milksu-ctf-history-dropdown-v2.jpg`
  - `/Users/milksu/code/milksu/docs/design/milksu-ctf-bridge-dropdown-v2.jpg`
  - `/Users/milksu/code/milksu/docs/design/milksu-htb-platform-v2.jpg`
  - `/Users/milksu/code/milksu/docs/design/milksu-native-bridge-menu-v2.png`
- Full-view comparison: `/Users/milksu/code/milksu/docs/design/milksu-ctf-platform-ux-comparison-v2.png`
- Focused menu comparison: `/Users/milksu/code/milksu/docs/design/milksu-ctf-menus-comparison-v2.png`
- Source pixels: 1032 × 276 for the original CTF header crop; 708 × 788 for the extension popup.
- Implementation pixels: 1280 × 720 at a 1280 × 720 CSS viewport.
- Normalization: the source header crop and full implementation were each placed on 640 × 360 canvases for the visible before/after comparison. The supplied source is a complaint-state crop, not a target mock, so the comparison evaluates the requested information hierarchy rather than pixel cloning.
- State: NSSCTF selected with a populated local catalog; separate captures cover history open, browser connection open, HTB selected, and custom intake.

### Findings

No actionable P0, P1, or P2 findings remain.

- Platform selection is one real dropdown containing NSSCTF, CTFshow, Hack The Box, TryHackMe, and the local custom source. HTB no longer competes with the platform chooser as a special configuration button.
- The HTB selection opens a first-class Labs state page with explicit Machine/Starting Point/Challenge capabilities, integration status, and the official Labs entry.
- The ambiguous `继续上次` and `下一步` header controls are replaced by one Bilibili-style history dropdown containing real local attempts, status, experiment count, and update time.
- Import is absent from connected platform headers. `自定义题目` owns local intake and states twice that it creates only a MilkSU workspace and uploads nothing.
- `补充图片或附件` is renamed `添加本地材料`; the selected-challenge surface states that files are copied only into that challenge workspace and are not uploaded.
- The desktop header and the empty states use the concise product names `CTF / Coding / CVE`.
- Browser pairing now has one stable top-level `连接浏览器` menu shared by NSSCTF and CTFshow. It exposes both `复制配对码` and extension installation/update without requiring the user to find a selected Judge card.
- The extension rejects an empty pairing field with a direct instruction instead of leaking `Unexpected end of JSON input`.

### Required fidelity surfaces

- Fonts and typography: the existing Inter family, weight ladder, control sizes, and line heights remain unchanged. Short product names and the two-row catalog toolbar remove accidental wrapping.
- Spacing and layout rhythm: the top row owns product/source/history/connection/settings; search, category, and refresh occupy a deliberate second row. Menus align to their triggers and stay within the desktop viewport.
- Colors and visual tokens: all new controls reuse the existing HTB-inspired semantic tokens and `@felinic/ui` menu/control recipes; no local palette or gradient was introduced.
- Image quality and asset fidelity: no new raster placeholder or custom-drawn icon was introduced. Existing Lucide components are used for standard control icons.
- Copy and content: source names, history, local-material destination, custom-workspace destination, HTB status, and pairing instructions are explicit and mutually distinct.
- States and interactions: platform dropdown, HTB state, custom state, custom dialog, history menu, browser connection menu, CTF/Coding/CVE navigation, and return to NSSCTF were exercised. The packaged Wails app was also restarted and its real pairing menu exposed an enabled `复制配对码` button.
- Console: the first pass found a missing `FolderOpen` component registration warning. The icon import was fixed; a fresh reload and three-second observation produced zero warnings and zero errors.

### Comparison history

- Pass 1 — blocked by P2: the initial wrapped toolbar left the settings icon stranded on a second line, the selected source trigger concatenated its status into the label, and the connection menu emitted an unresolved `FolderOpen` warning.
- Fixes: split navigation and catalog filters into intentional rows; keep only the source name in the trigger while status remains in menu rows; register `FolderOpen`.
- Pass 2 — passed: the revised header, HTB/custom states, history and pairing menus had no actionable visual or interaction mismatch, and the console remained clean.

final result: passed

# Coding 输入区布局 · Design QA

- Source visual truth:
  `/Users/milksu/code/milksu/docs/design/milksu-coding-composer-layout-reference.png`
- Implementation screenshot:
  `/Users/milksu/code/milksu/docs/design/milksu-coding-composer-layout.png`
- Full comparison:
  `/Users/milksu/code/milksu/docs/design/milksu-coding-composer-layout-comparison.png`
- Focused top / bottom comparison:
  `/Users/milksu/code/milksu/docs/design/milksu-coding-composer-layout-focused-comparison.png`
- Viewport: `1440 × 932` CSS px.
- Density normalization: source `2880 × 1864` at 2× was downsampled to `1440 × 932`;
  implementation was captured at `1440 × 932` with the in-app browser viewport override.
- State: Coding empty state, environment panel open. The source had a selected project and history;
  those data-state differences were excluded from the requested shell-layout comparison.

## Full-view comparison evidence

The implementation preserves the source shell proportions and existing dark-green token system. The
main content remains centered between the task sidebar and environment panel. The top title block is a
single 56 px row with no bottom border. Project, capability and model controls are removed from that
row and appear directly above the bottom composer. The composer is a centered 768 px island with a
16 px radius, one-pixel border and restrained shadow; no full-width top divider remains.

## Focused comparison evidence

The focused comparison covers the two user-marked regions:

- Top: title and path remain on the left; the environment-panel toggle stays at the far right.
- Bottom: project, capability and model controls sit above the prompt; the prompt and send action are
  enclosed by the rounded island rather than a full-width footer bar.

## Required fidelity surfaces

- Fonts and typography: existing Inter/CJK fallback, weights, sizes and truncation were preserved.
- Spacing and layout rhythm: requested control relocation, 56 px header, centered 768 px composer,
  16 px island radius and responsive widths are aligned with the reference.
- Colors and visual tokens: only existing MilkSU surface, card, border, foreground and brand tokens
  are used; no new palette or gradient was introduced.
- Image quality and asset fidelity: no new raster assets were needed; existing MilkSU avatar and
  icon-library components were preserved.
- Copy and content: existing product copy and actual model/provider labels are preserved.

## Comparison history

### Iteration 1

- Finding: **P2** — at the narrower main-column width created by the open environment panel, the
  environment toggle wrapped below the title instead of remaining at the top-right.
- Fix: removed the non-CTF header's container-query stack behavior while preserving wrapping for the
  CTF-specific action header.
- Post-fix evidence: measured header width `824 px`, height `56 px`, bottom border `0 px`; the toggle
  remains at the right edge. With the environment panel closed, main width expands to `1144 px` and
  the toggle remains at `x=1384`, adjacent to the header's right edge at `x=1440`.

## Interaction checks

- Capability menu opens and exposes the real loaded-extension state.
- Model menu opens with readable `自动`、`原厂`、`中转站` groups; no option text is clipped.
- Environment panel closes and reopens from the top-right control.
- Browser console error count: `0`.

## Remaining findings

No actionable P0/P1/P2 differences remain for the requested layout. The selected-project content in
the source is a different data state, not a shell-layout defect.

final result: passed

# Coding 活动折叠 · Design QA

**Comparison Target**

- Source visual truth:
  - `/var/folders/wf/0w9rnrs904501nhp57pd_jzw0000gn/T/codex-clipboard-d2f1a6b8-4824-414c-9758-914d173be191.png`
  - `/var/folders/wf/0w9rnrs904501nhp57pd_jzw0000gn/T/codex-clipboard-cffd7e9a-093a-4b3b-8984-abc53a99b263.png`
  - `/var/folders/wf/0w9rnrs904501nhp57pd_jzw0000gn/T/codex-clipboard-b813ee6c-16f4-466e-abb4-7d1e312f6b2c.png`
- Rendered implementation:
  - `/var/folders/wf/0w9rnrs904501nhp57pd_jzw0000gn/T/com.openai.sky.CUAService/MilkSU Screenshot 2026-08-02 at 0.16.52.jpeg`
- State: dark theme, existing Coding task, top-level activity expanded, one child tool entry expanded.
- Source pixels: 1380 × 2022, 1424 × 1092, and 1414 × 908.
- Implementation pixels and viewport: 1187 × 768 at the packaged macOS app window size.
- Density normalization: the sources are cropped Codex captures while the implementation is a full MilkSU window, so pixel-perfect whole-screen comparison is not valid. The activity disclosure region was compared at visible 1:1 scale; surrounding Codex chrome was excluded from fidelity judgments.

**Findings**

- No actionable P0, P1, or P2 mismatch remains in the requested activity-disclosure behavior.
- [P3] MilkSU does not currently append elapsed time to every tool-row summary.
  - Location: `app/src/components-vue/ChatActivityGroup.vue`.
  - Evidence: Codex shows summaries such as “Ran command in 1s”; MilkSU shows the localized action and subject.
  - Impact: timing is useful operational metadata but does not affect hierarchy or discoverability.
  - Follow-up: persist tool start/end timestamps and append a compact duration only when reliable.

**Full-view Comparison Evidence**

- Codex keeps assistant progress and the final response in the main transcript while collapsing raw command activity.
- MilkSU now keeps ordinary assistant messages in the main transcript and renders tool runs as compact disclosure rows.
- The MilkSU sidebars reduce the center-column width compared with the cropped Codex transcript. This is an intentional product constraint, not activity-component drift.

**Focused Region Comparison Evidence**

- Level 1: both surfaces show one compact aggregate activity summary with an icon and disclosure chevron.
- Level 2: expanding the aggregate reveals compact per-tool summaries without raw output.
- Level 3: expanding one tool reveals a bordered, independently scrollable monospace detail surface.
- Tool details stay bounded and no longer push the final assistant answer behind permanently expanded output.

**Required Fidelity Surfaces**

- Fonts and typography: MilkSU retains Inter and its existing mono stack. Aggregate and child summaries have distinct but compatible weights and line heights; long paths truncate at the summary level and wrap only inside details.
- Spacing and layout rhythm: disclosure rows use a compact vertical rhythm; nested details are indented and bounded. No persistent control is hidden by the expanded detail.
- Colors and tokens: the implementation intentionally keeps MilkSU’s HTB-inspired navy/green tokens instead of copying Codex’s neutral black palette. Muted rows, border contrast, and hover affordances remain legible.
- Image and asset fidelity: this interaction has no photographic or illustrative assets. Icons come from the project’s existing icon library; no placeholder, emoji, CSS drawing, or handcrafted SVG was introduced.
- Copy and content: Codex’s English action labels are localized to concise Chinese product language. Raw command, path, and result content remains unchanged in the third level.

**Comparison History**

- Earlier P1: tool output and model process content were expanded inline, occupying most of the transcript and obscuring the useful response.
- Fix: introduced an aggregate activity disclosure, nested per-tool disclosures, bounded detail panels, and transcript segmentation that leaves assistant progress/final answers outside tool groups.
- Post-fix evidence: the packaged MilkSU app was opened with a real persisted Archify task; the first aggregate row was expanded, then an individual `read` action was expanded. The three levels were independently operable and the assistant text remained visible below the activity group.

**Primary Interactions Tested**

- Open a persisted Coding task in the packaged Wails app.
- Expand and collapse the top-level activity group.
- Expand an individual tool action.
- Inspect the bounded raw request/result detail.
- Confirm normal assistant progress and the final answer remain outside the activity group.

**Implementation Checklist**

- [x] Aggregate consecutive tool events.
- [x] Keep assistant progress and final answers in the transcript.
- [x] Add independently expandable tool summaries.
- [x] Bound and scroll raw tool details.
- [x] Preserve MilkSU tokens and localization.
- [ ] Optionally add reliable elapsed-time metadata.

**Follow-up Polish**

- Add per-tool duration after the runtime persists trustworthy start/end timestamps.

final result: passed

# Coding 三项发送上下文与后台任务面板 · Follow-up QA

**Comparison Target**

- Source visual truth:
  - `/var/folders/wf/0w9rnrs904501nhp57pd_jzw0000gn/T/codex-clipboard-f2880711-da45-47ce-a0f4-ca509eb52978.png`
- Browser implementation:
  - `/private/tmp/milksu-coding-composer-three-controls.png`
  - `/private/tmp/milksu-coding-composer-three-controls-1100.png`
  - `/private/tmp/milksu-coding-architecture-three-controls.png`
- Focused comparison:
  - `/private/tmp/milksu-coding-composer-three-controls-focused.jpg`
- Native packaged implementation:
  - `/private/tmp/milksu-native-three-controls.png`
  - `/private/tmp/milksu-background-task-stopped-native.png`
  - `/private/tmp/milksu-coding-terminal-session-native.png`
- Viewports: browser 1280 × 720 and 1100 × 720 at DPR 2; native packaged app 1187 × 768.
- States: Coding architecture side page with the composer visible, model menu open, and a real background HTTP task stopped from the dedicated Terminal page.

**Findings**

- No actionable P0, P1, or P2 mismatch remains for the requested composer hierarchy.
- The model selector remains visible and operable at both tested browser widths.
- Browser console inspection reported zero errors and zero warnings.

**Comparison History**

- Earlier P1: eight project/action/context controls competed for one row and squeezed the model selector out of view.
- Fix: moved project selection, product actions, persistent goal, architecture, and capabilities into the right-side Environment surfaces.
- Current result: the composer owns only execution mode, permission policy, and model selection.
- Product-flow validation: a short command completed with exit code 0; a real `python3 -m http.server 18876 --bind 127.0.0.1` process was then started through Pi, surfaced with PID, listening port and bounded logs, stopped from the right Terminal page, and verified no longer listening.

**Required Fidelity Surfaces**

- Typography: all three controls share the same compact control type scale and vertical alignment.
- Spacing: the control row has stable gaps and the model selector flexes into remaining width instead of disappearing.
- Ownership: repository switching is available from Environment; architecture and capability entry points are not duplicated above the composer.
- Interaction: Plan/Go, permission policy and model menus remain independently operable.

final result: passed

# Coding Composer 最小控制面与交互式 PTY · Follow-up QA

**Evidence**

- Browser:
  - `/private/tmp/milksu-composer-three-controls-1280.png`
  - `/private/tmp/milksu-composer-three-controls-1024.png`
- Native packaged App:
  - `/private/tmp/milksu-interactive-pty-native.png`
- Browser viewports: default 1280 × 720 and compact 1024 × 700.
- Native state: existing `/Users/milksu/code/milksu` Coding conversation, right-side Terminal page.

**Composer Findings**

- The message composer owns only controls that change the next turn: `Plan / Go`, approval policy,
  and model selection.
- Project selection, product actions, persistent goal, architecture, capability details, changes,
  terminal and browser are owned by the right-side pages and are not duplicated above the input.
- At the compact viewport the three controls remained visible with no horizontal document overflow;
  the model trigger retained about 173 px of width. Browser logs contained zero errors or warnings.
- The packaged App showed the same three-control hierarchy after the stale process was stopped and
  the newly built application was opened.

**Interactive Terminal Findings**

- The right-side Terminal page opened one project zsh PTY automatically and exposed Shell tabs,
  a new-Shell action, stop, and the separate background-task view.
- Direct keyboard input produced live output. `pwd` returned `/Users/milksu/code/milksu`.
- The terminal copy explicitly distinguishes direct user Shell authority from Agent automation:
  user-entered commands run as the current macOS user; Agent commands still follow the selected
  execution and approval policy.
- `go test -race ./internal/codingterminal`, all Go tests, 43 frontend tests, the production frontend
  build, Wails production packaging and strict code-sign verification passed.

**Remaining Boundaries**

- PTY sessions are not restored after a full application restart.
- Windows/Linux PTY adapters, terminal rename, copy/search and large-output stress remain follow-up.
- Coding Browser and Computer Use are still not connected and remain separate permission surfaces.

final result: passed
