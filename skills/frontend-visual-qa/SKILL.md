---
name: frontend-visual-qa
description: Implement, debug, redesign, or review Web frontend changes with evidence from the project test runner, a real preview server, and MilkSU's isolated Coding Browser. Use for HTML, CSS, Vue, React, responsive layout, accessibility, interaction, Console or Network failures, screenshot comparison, and visual regression tasks. Do not use for native-app-only validation that requires Computer Use instead of a browser.
---

# Frontend Visual QA

Deliver working frontend behavior and reviewable browser evidence. A rendered page is the
fact source; source inspection or a passing build alone does not prove visual correctness.

## Establish the contract

1. Read the repository instructions and canonical scripts before editing.
2. Inventory the behavior, states, routes, supported sizes, design tokens, and shared
   components affected by the request.
3. Preserve existing behavior unless the user explicitly asks to remove it.
4. Reuse the project's components and tokens. Do not invent parallel controls, raw visual
   values, or a second design system to make one screenshot pass.
5. When the task includes a reference image or a new design direction, extract the intended
   hierarchy, layout, typography, spacing, color, interaction states, and responsive behavior.
   Implement those properties with the project's system, then compare the rendered page at the
   matching viewport and record intentional differences. A reference is not proof of fidelity.

## Implement and verify

1. Make the smallest coherent change that owns the requested behavior.
2. Add or update focused automated tests for logic and interaction regressions.
3. Run the focused tests, typecheck or lint when present, and the production build.
4. Start the canonical preview or development server with `bg_task`, unless the task supplies
   an existing active preview URL. Never replace it with `nohup`, raw `&`, or another detached
   process. Keep the task, port, and URL visible so another turn can resume the validation.
5. When an isolated Coding Browser is active:
   - connect the `milksu-playwright` MCP server and inspect a tool schema when its arguments are
     uncertain;
   - navigate to the real preview URL and use an accessibility snapshot before clicking;
   - exercise the changed happy path and one relevant empty, error, disabled, or loading state;
   - resize to the project's minimum supported viewport and one wider viewport;
   - inspect Console messages and failed Network requests after the interaction;
   - save a final screenshot plus Console and Network evidence under the exact browser-evidence
     directory provided by the active session guidance; pass that full workspace-relative path
     as each tool's `filename`, because a bare filename is outside the reviewed evidence scope;
   - use semantic Browser actions only; never use an unsafe arbitrary-code browser tool.
6. Preview generated Markdown, HTML, or image artifacts through MilkSU's artifact preview when
   they are part of the task.

If the isolated Browser is not active, finish the code and automated checks that do not depend
on it, but state that visual verification is pending. Never substitute a DOM dump, generated
HTML, or model judgment for a real Browser result.

## Review the result

Check these explicitly when relevant:

- one clear primary action and progressive disclosure of secondary state;
- keyboard reachability, visible focus, labels, roles, names, and useful error text;
- no clipping, overlap, accidental horizontal scrolling, or unreadable density at supported
  sizes;
- loading and empty states retain enough structure to avoid layout jumps;
- destructive or external actions remain distinguishable from routine local interactions;
- no new Console error, unhandled rejection, failed asset, or unexpected request.

Report the tested route and viewport, commands run, Browser interactions, evidence paths,
Console and Network result, remaining uncertainty, and any manual takeover. Do not call the
task visually verified unless the Browser evidence exists.
