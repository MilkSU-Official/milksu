---
name: panel-update
description: Update the task panel UI with structured security data. Always available. Use this to populate panel fields as you discover targets, ports, vulnerabilities, flags, and other findings during security tasks.
triggerKeywords: [panel, update, target, finding, result]
---

# Panel Update Skill

Provides the `panel_update` tool for pushing structured data to the task panel sidebar.

## When to use

Call `panel_update` whenever you discover actionable information during a security task:
- Set the target when the user specifies one
- Append ports after a port scan
- Append vulnerabilities after discovering one
- Update the phase as work progresses
- Add flags in CTF challenges

## Field reference by task type

### pentest
- `target` (string): the target IP/hostname
- `phase` (number 0-5): current workflow phase index
- `vulnerabilities` (array): `{ severity, title, detail? }`
- `ports` (array): `{ port, service, state }`
- `tools_used` (array of strings)

### ctf
- `challenge` (string): challenge name
- `category` (string): challenge category
- `points` (number | null)
- `flags` (array of strings)
- `hints` (array of strings)
- `solved` (boolean)

### recon
- `scope` (array of strings)
- `hosts` (array): `{ ip, hostname?, os? }`
- `ports` (array): `{ host, port, service, version? }`
- `findings` (array of strings)

### reverse
- `binary` (string): binary file path
- `arch` (string): architecture
- `protections` (object): `{ nx, canary, pie, relro }`
- `functions` (array): `{ name, address, note? }`
- `findings` (array of strings)
