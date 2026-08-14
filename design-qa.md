# Design QA

**Source Visual Truth**

- Night palette and dense workspace target: `/Users/milksu/.codex/generated_images/01a00087-0866-7670-8edc-314c3bbdb0d8/exec-7430da5c-5f67-482f-b1c1-d60aaed74e02.png`
- Accepted profile layout target: `/Users/milksu/.codex/generated_images/01a00087-0866-7670-8edc-314c3bbdb0d8/exec-19c4711b-6ebd-4524-8b4a-e7ed673005d0.png`

**Implementation Evidence**

- CTF: `/Users/milksu/.codex/visualizations/2026/08/14/01a00087-0866-7670-8edc-314c3bbdb0d8/night-graphite-ctf.jpg`
- CVE: `/Users/milksu/.codex/visualizations/2026/08/14/01a00087-0866-7670-8edc-314c3bbdb0d8/night-graphite-cve.jpg`
- Coding: `/Users/milksu/.codex/visualizations/2026/08/14/01a00087-0866-7670-8edc-314c3bbdb0d8/night-graphite-coding.jpg`
- Settings: `/Users/milksu/.codex/visualizations/2026/08/14/01a00087-0866-7670-8edc-314c3bbdb0d8/night-graphite-settings.jpg`
- Profile Coding: `/Users/milksu/.codex/visualizations/2026/08/14/01a00087-0866-7670-8edc-314c3bbdb0d8/night-graphite-profile.jpg`
- Profile CTF: `/Users/milksu/.codex/visualizations/2026/08/14/01a00087-0866-7670-8edc-314c3bbdb0d8/night-graphite-profile-ctf.jpg`
- Profile CVE: `/Users/milksu/.codex/visualizations/2026/08/14/01a00087-0866-7670-8edc-314c3bbdb0d8/night-graphite-profile-cve.jpg`

**Viewport and Normalization**

- State: native Electron Stable development runtime, night mode, authenticated local profile, real local activity and usage data.
- Implementation screenshots: `1227 x 768` native pixels at the effective `1227 x 768` app viewport. The native capture path does not expose a browser `deviceScaleFactor`; the saved artifact is treated as the 1:1 comparison surface.
- Night palette source: `1584 x 993`; normalized to `1228 x 768`. Its aspect ratio differs by less than one percent from the implementation.
- Profile source: `1545 x 1018`; scaled to `1228` pixels wide while preserving aspect ratio, then top-cropped to `1228 x 768` because the approved source used a taller viewport.
- Implementation captures were scaled by one pixel from `1227` to `1228` only inside the combined comparison images.

**Full-view Comparison Evidence**

- Night workspace: `/Users/milksu/.codex/visualizations/2026/08/14/01a00087-0866-7670-8edc-314c3bbdb0d8/compare-night-graphite-ctf-full.png`
- Profile usage: `/Users/milksu/.codex/visualizations/2026/08/14/01a00087-0866-7670-8edc-314c3bbdb0d8/compare-night-graphite-profile-full.png`

**Focused Comparison Evidence**

- CTF navigation, filter bar, selected row and expanded detail: `/Users/milksu/.codex/visualizations/2026/08/14/01a00087-0866-7670-8edc-314c3bbdb0d8/compare-night-graphite-ctf-focus.png`
- Profile tabs, heatmap, daily model/tool detail and confirmed-growth rail: `/Users/milksu/.codex/visualizations/2026/08/14/01a00087-0866-7670-8edc-314c3bbdb0d8/compare-night-graphite-profile-focus.png`

**Findings**

- No actionable P0, P1 or P2 issue remains.
- Fonts and typography: the implementation retains the product's Inter body hierarchy and condensed display treatment. Dense table text, metadata and the profile's model/tool rows remain legible at the smaller implementation viewport without unexpected wrapping or truncation.
- Spacing and layout rhythm: the fixed rail, command header, filters, dense table and profile two-column layout preserve the source proportions. The `1227 x 768` viewport does not hide persistent navigation, pagination, the model/tool detail region or the confirmed-growth rail.
- Colors and tokens: CTF, CVE, Coding, Settings and Profile now share neutral warm graphite surfaces without the retired blue-black cast. Acid green is limited to active navigation, primary actions, selected details and activity intensity; blue remains on links and explicit execution or diagnostic semantics.
- Image quality and asset fidelity: the existing carbon texture, archive paper, avatar and Lucide icon family remain sharp and consistently masked. No visible source asset was replaced by CSS art, an emoji, a text glyph or an inline custom illustration.
- Copy and content: the implementation uses actual local values. The Coding panel shows `2.10万 Token`, one real usage day, Grok 4.5 and one recorded `bash` call; CTF and CVE show their real local records and honest zero states instead of copying mock counts.
- States and interactions: CTF, CVE, Coding and Settings navigation, the CTF/CVE expanded detail state, and all three Profile tabs were exercised through the native accessibility surface. The resulting screenshots show selected, disabled, empty and populated states without layout breakage.
- Accessibility: the native accessibility tree exposes named buttons, tabs, headings, selects, the heatmap cells and disabled states. Foreground contrast and selected-state borders remain visible against every graphite layer.

**Comparison History**

- Iteration 1 finding: the prior night UI relied on blue-black component literals and inconsistent local borders. Fix: introduced one shared neutral warm graphite token ladder and moved workspace rail, context sidebar, top bar, terminal, settings, profile and tactical panels onto it. Post-fix evidence: `compare-night-graphite-ctf-full.png` and `compare-night-graphite-profile-full.png`.
- Iteration 2 finding: the first native CVE capture still applied the day-mode pale acid detail surface inside night mode. Fix: scoped the paper-specific acid panel override to `:root[data-theme='light']` and added a regression assertion. Post-fix evidence: `night-graphite-cve.jpg`.

**Open Questions**

- None for this approved desktop slice. A separate minimum-window keyboard and zoom sweep remains a future resilience check, not a mismatch in the accepted desktop viewport.

**Implementation Checklist**

- [x] Centralize the accepted night palette.
- [x] Remove residual blue-black component literals from product surfaces.
- [x] Keep blue limited to links and explicit execution or diagnostic states.
- [x] Render CTF, CVE, Coding, Settings and all Profile tabs with real local state.
- [x] Compare full and focused regions against the selected source visuals.
- [x] Re-run visual capture after the CVE night-detail correction.
- [x] Check native runtime output for renderer errors; none were emitted during the tested navigation.

**Follow-up Polish**

- No P3 refinement is required for this handoff.

final result: passed
