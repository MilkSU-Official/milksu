# MilkSU packet-parser vulnerability fixture

This is an intentionally vulnerable, local-only teaching fixture. A two-byte
big-endian length controls a copy into a 16-byte stack buffer. MilkSU compiles
it with AddressSanitizer, runs a bounded trigger, minimizes that trigger, and
requires a clean three-run reproduction before the evaluator passes a finding.

It is not installed as a system binary and it does not open a network socket.
