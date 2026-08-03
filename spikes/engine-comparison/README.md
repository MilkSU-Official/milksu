# M0 Agent Engine comparison

> Historical spike. Pi is the current default engine. This directory is retained only for the original
> comparison protocol and must not be used as a second product runtime or current task list.

Both spikes receive the same read-only micro CTF and emit MilkSU-shaped JSONL events. They are comparison code, not two product runtimes.

Safe protocol checks, which do not call a model:

```bash
npm run spike:pi:protocol
npm run spike:codex:protocol
```

Live Pi run (uses Pi login or provider environment credentials):

```bash
npm run spike:pi
```

Optionally select a Pi model explicitly:

```bash
MILKSU_SPIKE_PROVIDER=openai MILKSU_SPIKE_MODEL=gpt-5.4 npm run spike:pi
```

Live Codex app-server run (uses the local Codex login):

```bash
npm run spike:codex
```

The Codex spike starts app-server over stdio, creates an ephemeral read-only thread, refuses approval escalation, and does not enable app-server analytics.
