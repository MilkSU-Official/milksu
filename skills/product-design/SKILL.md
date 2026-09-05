---
name: product-design
description: Set the visual goal for a major UI or flow change, then implement and verify the rendered result. Use for new pages, navigation, or redesigns. Do not use for tiny copy, spacing, or color fixes.
---

# Product Design

Turn an interface request into one clear visual target, a working implementation, and rendered evidence.

## Establish the product context

1. Read repository instructions and inspect the current route, neighboring screens, shared components, tokens, and existing user flow.
2. Capture the current rendered screen and every supplied reference before proposing a direction. If a required reference cannot be opened, stop before inventing a replacement.
3. State the user's primary task, the information that must remain visible, and the one primary action. Remove blocks that do not help that task.
4. Reuse the product's design language and real assets. Do not introduce a second component system, decorative dashboard cards, fake data, placeholder capability, handcrafted icons, or a new visual style without an explicit request.

## Select the visual target

For a new page, major redesign, or changed user journey, create a concrete visual mock before editing product code. Show hierarchy, layout, controls, expanded states, and realistic content. Ask for confirmation when the visual direction materially changes the product.

For a small visual defect that preserves the existing design, skip the mock and use the current rendered screen as the target.

When implementing from a screenshot, match the source rather than improving it from memory. Record only necessary differences caused by the host product, accessibility, or viewport behavior.

## Implement the confirmed flow

1. Inventory existing behaviors before replacing markup.
2. Compose shared components and tokens. Keep the information hierarchy shallow and the primary action obvious without explanatory paragraphs.
3. Make navigation, menus, forms, filters, toggles, loading, empty, disabled, and error states required by the main journey work with realistic data.
4. Preserve keyboard access, visible focus, labels, readable density, and supported narrow layouts.
5. Do not deploy or publish unless the user explicitly requests it.

## Verify the rendered result

Use the repository's canonical tests and a real preview or packaged App. For web surfaces, also follow `frontend-visual-qa` when available.

Compare the target and implementation at the same viewport and state. Check spacing, clipping, typography, borders, responsive behavior, interaction states, Console errors, and failed requests. A build or source review alone is not visual proof.

Report the confirmed target, implemented journey, tested states, rendered evidence, intentional differences, and any remaining uncertainty.
