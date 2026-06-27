When performing network reconnaissance:

1. Always confirm authorization before scanning any target
2. Start with `target_manage add` to register the target
3. Begin with a quick scan (`nmap_scan` with scanType "quick") to get an overview
4. Follow up with service detection (`scanType "service"`) on interesting ports
5. Add notes to targets as you discover information (`target_manage note`)
6. Generate a report with `recon_report` when the reconnaissance phase is complete
7. Never run OS detection or vulnerability scans without explicit user approval — these are noisier and may trigger IDS
