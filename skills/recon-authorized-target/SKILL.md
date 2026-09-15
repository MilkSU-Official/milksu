---
name: recon-authorized-target
description: Inventory one user-authorized host, lab target, or CVE reproduction surface. Use for wide recon, port or HTTP mapping, and pentest planning on that bound. Do not use to scan unauthorized hosts or invent a typed sweep tool.
---

# Recon an authorized target

Map the user-selected target and keep the inventory in the job report. Stay inside the visible authorization for this conversation.

## Establish the bound

1. Read the dossier, lease, or user message that names the exact host, URL, or lab environment.
2. If the target is missing or several candidates remain, call `milksu_ask` before any scan.
3. Do not invent a sweep tool, do not scan internet ranges, and do not move to a host the user has not authorized.

## Plan the inventory

Write a short plan in the conversation: which surfaces, which commands, and what evidence belongs in `report.md`. Prefer existing Pi tools (`bash`, `bg_task`, `bg_status`, `read`, isolated browser) and at most four read-only or worker subagent lanes. Watch `bg_status`; do not pile identical background probes.

## Record

Put live findings in `report.md` as they appear. Distinguish observed facts, guesses, and items still unchecked. When the inventory is enough to choose a next exploit or reproduction step, stop scanning and ask or continue that step.
