# Design QA — MilkSU Challenge Desk

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
