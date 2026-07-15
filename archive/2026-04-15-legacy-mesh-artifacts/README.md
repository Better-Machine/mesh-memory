# Legacy mesh-memory artifacts

`email-audit.jsonl` was written by the v1 mesh-memory writer (pre-migration to HTTP API).
Last modified 2026-04-15 21:07 EDT. The v1→v2 migration moved mesh storage to the
HTTP API at `127.0.0.1:18805/mesh/shared-pool` (commit `e2959ceeb8`).

This file is kept as a forensic artifact. It is **not** consumed by the current
dream cycle. The dream cycle now reads:
- Live mesh facts from the HTTP API (fetchMeshFacts in dream-cycle.mjs)
- Recent daily logs from `~/.openclaw/workspace/memory/YYYY-MM-DD.md`

If you find yourself reading this directory, you're probably debugging
whether the dream cycle input is alive. Check the mesh daemon, not this file.
