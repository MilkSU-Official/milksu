# CTF onboarding flow audit

Date: 2026-07-31

## Scope

The first-run path from opening CTF, selecting a real problem, connecting the
platform Judge, and starting an Agent-backed training workspace. The current
NSSCTF P3879 state was used because it exposes the real attachment and Judge
requirements that a beginner must understand.

## User goal

Choose a suitable real CTF problem and begin a recoverable, platform-verified
training run without first learning MilkSU's internal architecture.

## Captured steps

1. `01-ctf-start.png` — selected NSSCTF problem and its preparation state.
2. `02-platform-picker.png` — platform switcher with available, planned, and
   local sources.
3. `03-training-history.png` — local training history and resume entry points.
4. `04-ability-profile.png` — compact sidebar profile and evidence-derived
   ability view.
5. `05-ctf-start-improved.png` — contextual primary action pinned into the
   selected-problem viewport.
6. `06-p3879-improved.png` — the same attachment-bearing problem after the
   guided Judge pass.
7. `07-ability-profile-improved.png` — widened ability profile with a readable
   radar and labels.

## Strengths

- The product opens directly on a real problem instead of an empty dashboard.
- Platform selection, history, browser connection, search, and settings are
  distinct controls with useful accessible labels.
- The problem list follows the platform's familiar table model.
- The selected problem preserves source, difficulty, solve count, collaboration
  mode, attachment state, and authoritative Judge readiness.
- History entries expose status, problem, experiments, and time without
  creating a separate page.

## High-impact risks

1. The primary `用 Agent 开始` action sits below the initial detail viewport.
   The only always-visible action is `检测连接`, so a ready user cannot see the
   product's main promise without scrolling.
2. First-time Judge setup is presented as an explanation followed by three
   equal buttons, then repeated again in the attachment warning. The required
   order is visually weak.
3. The sticky preparation footer reports three technical facts but does not own
   the next action. This makes it status chrome rather than a guide.
4. The local-material escape hatch competes with the main platform path. It is
   useful, but should be visually secondary and explained as a fallback.
5. The ability profile's radar is compressed by a two-column layout. The labels
   are technically present but too small at the actual rendered size.
6. Several secondary labels use low-contrast, very small caption text. The
   screenshots support a legibility risk, but keyboard order, screen-reader
   announcements, and contrast ratios still require implementation-level
   testing.

## Decisions for the next pass

- Make the sticky footer own one contextual primary action at all times.
- Turn initial Judge setup into a numbered, left-to-right sequence.
- Hide local materials behind a clearly named fallback disclosure.
- Keep the current black/green system, table layout, and Memoh components.
- Give the ability radar enough width to keep labels readable.

## Implemented result

- The sticky preparation footer now owns the contextual next action:
  configure the model, open and connect the selected platform page, start the
  Agent, or resume active training.
- A no-attachment problem can begin solving before Judge pairing, while an
  attachment-bearing problem routes the user through connection first.
- First-time NSSCTF Judge setup is a numbered `安装 → 配对 → 连接` sequence.
- Platform attachments are imported after connection; manual files are behind
  a collapsed `使用本地附件` fallback.
- The CTF ability popover is wider and the radar uses the full first column.

The before/after screenshots were captured at the same 1188×768 app viewport.
The selected P3879 comparison confirms that the primary action is no longer
below the fold and the fallback no longer competes with the main platform path.

## Evidence limits

The screenshots prove hierarchy, density, clipping, and visible affordances at
1188×768. They do not prove keyboard traversal, screen-reader output, dynamic
contrast ratios, network failure recovery, or a successful external Judge
receipt. Those remain separate implementation and live-platform gates.
