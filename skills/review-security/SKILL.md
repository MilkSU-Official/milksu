---
name: review-security
description: Review a repository, change set, authentication flow, integration, or product boundary for concrete security risks involving credentials, authorization, untrusted input, filesystem or network scope, external effects, and vulnerable data flows. Use for security reviews, pre-release checks, auth and quota changes, and suspicious code. Do not use to conduct attacks against external targets.
---

# Review Security

Find reachable security failures and explain their real impact without inflating theoretical concerns.

## Establish scope

1. Read repository security guidance and the exact code or diff in scope.
2. Identify assets, trust boundaries, entry points, privileged operations, external systems, and the attacker capabilities relevant to this product.
3. Preserve authorization boundaries. Do not scan, exploit, spray, evade, or interact with an external target unless the user provides visible and exact authorization.

## Trace findings

Inspect untrusted input through validation, authorization, state changes, storage, logs, and external effects. Prioritize:

- provider keys, session tokens, passwords, personal data, and diagnostic leakage;
- authentication, invitation, role, object-level authorization, and quota enforcement;
- path traversal, command execution, unsafe deserialization, injection, and SSRF;
- browser, MCP, Computer Use, filesystem, network, and workspace scope expansion;
- webhook replay, OAuth state, redirect handling, and idempotency;
- dependency or supply-chain behavior that actually reaches production.

Validate each candidate against surrounding controls and call paths. A suspicious pattern without a reachable source, sink, or security consequence is not a reportable finding.

## Report

For each valid finding, provide severity, affected asset, preconditions, source-to-sink path, concrete impact, code evidence, and the smallest credible remediation. Distinguish confirmed findings, defense-in-depth improvements, and unresolved questions.

If asked to fix findings, make scoped changes and add security regression tests. Do not weaken checks to make a test pass, expose secrets as evidence, or claim safety from a scanner exit code alone.
