---
name: network-recon
description: Network reconnaissance tools for penetration testing — port scanning, service detection, host discovery. Use when the user needs to scan targets, discover services, or map network topology.
triggerKeywords: [nmap, scan, port, recon, network, host, service, target, pentest, reconnaissance]
---

# Network Recon Skill

Provides network reconnaissance tools for penetration testing engagements.

## Available Tools

- `nmap_scan` — Run nmap with structured output parsing
- `target_manage` — Register and track penetration test targets
- `recon_report` — Generate a structured reconnaissance report

## Usage Flow

1. Register targets with `target_manage`
2. Run `nmap_scan` against registered targets
3. Generate reports with `recon_report`

## Authorization

These tools execute real network scanning commands. Only use against authorized targets with explicit written permission.
