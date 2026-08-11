---
name: create-technical-deliverables
description: Create or update a human-readable technical deliverable such as a README, runbook, implementation note, CTF write-up, CVE research report, reproduction guide, script package, or evidence summary. Use when the user needs a durable document or reproducible handoff rather than only a chat answer. Do not use for internal progress logs with no reader.
---

# Create Technical Deliverables

Produce an artifact that its intended reader can understand, verify, and reuse without reconstructing the conversation.

## Define the deliverable

Identify the audience, purpose, format, source material, required sections, and what establishes correctness. Reuse an existing repository template when present. Keep the document proportional to the task and remove implementation chatter that does not help the reader.

Separate verified facts, model inference, commands, outputs, and open questions. Cite authoritative sources near claims that depend on external information. Never include provider credentials, private tokens, unredacted sensitive data, or irrelevant local paths.

## Build the artifact

For a README or runbook, include prerequisites, the shortest working path, meaningful failure recovery, and verification. For scripts, include safe defaults, bounded inputs, deterministic output, and a dry-run or test fixture when useful.

For CTF work, include the reasoning, reproducible script or commands, candidate answer, and Judge or human validation status. A model-proposed flag is not success.

For CVE work, include affected product and versions, source evidence, impact reasoning, authorized reproduction status, and remediation or mitigation. Do not turn public vulnerability research into an unapproved external attack plan.

## Verify

Run scripts and examples in a safe local fixture. Open or render the final Markdown, HTML, image, PDF, or other artifact through the available preview. Check links, code blocks, filenames, formatting, and instructions against the actual repository state.

Report the artifact path, intended reader, verification performed, authoritative sources used, and any result that remains unconfirmed.
