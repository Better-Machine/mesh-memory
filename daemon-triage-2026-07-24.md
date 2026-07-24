# Daemon Triage — 2026-07-24 (B-Effort) — RESOLVED 2026-07-24 09:00 EDT

**Status:** ✅ **RESOLVED**. The "dead mesh daemon" was a misread — there is no single daemon, there is a federated mesh with one receiver per agent, and both Liz's and Ray's receivers are healthy. Originally filed for follow-up; turned out to be a misunderstanding of the architecture.

---

## TL;DR

The dream-cycle v2 PR's `MESH_API_URL` default of `http://127.0.0.1:18805/mesh/shared-pool` is **correct as-is**. Each agent (Liz, Ray) runs their own `memory-receiver.mjs` on `:18805`, and the dream-cycle script reads from the local receiver. Mesh memory is a federated P2P system, not a single daemon.

The v2-rebuild migration is correct. Merging the PR as-is will fix the cron noise.

The "fleet-wide dead daemon audit" is still worth doing — there are other daemons across the fleet (vigil-home on Jetson, a few disabled llama-server services, a stray `llama-nano.service` on Liz pointing at a deleted model) that should be inventoried. Filed for follow-up, not today.

---

## Architectural finding: mesh memory is a federated mesh, not a single daemon (2026-07-24 09:00 EDT)

**Original misunderstanding:** I treated the mesh memory as a single daemon living on one host, and reported "HTTP 000 on `:18805`" when the dream-cycle cron couldn't reach it on GX-10.

**Reality (verified 2026-07-24 09:00 EDT):**
- Each agent (Liz, Ray, possibly Woodhouse) runs their own `memory-receiver.mjs` on `0.0.0.0:18805`.
- The receivers sync facts with each other via `shared-pool-sync.mjs` (peer-to-peer).
- There is no central store. Each receiver has its own copy of the "shared pool" (which is a logical view, not a physical one).
- Confirmed healthy receivers:
  - **Liz** (PID 7332, started 2026-07-06 20:57, uptime 17d 12h) — agents in pool: {woodhouse, unknown, liz, ray}
  - **Ray** (PID 7418, started 2026-07-06 20:57, uptime 17d 12h) — agents in pool: {ray, liz, woodhouse}
- The "unknown" agent in Liz's pool is a real anomaly worth noting but not blocking.

**Implication for the v2 PR:** The default `MESH_API_URL = http://127.0.0.1:18805/mesh/shared-pool` is correct. The dream-cycle runs on Liz, reads Liz's receiver, which has the federated view of facts. No URL change needed.

**Implication if dream-cycle moves to another host:** The new `MESH_API_URL` env var handles that — point at the receiver on whatever host the cron runs on. Default behavior unchanged for Liz.

## Remaining items (filed for fleet-wide audit to-do, not today)

The "fleet-wide dead daemon audit" is still worth doing. Other daemons found during this triage that warrant a closer look:

| Daemon | Host | Status | Notes |
|--------|------|--------|-------|
| `llama-nano.service` | Liz | Disabled, references deleted model | systemd unit still on disk; benign but should be removed |
| `vigil-home` | Jetson Orin Nano (192.168.50.33) | Unknown — not checked this pass | Listed as MVP-complete 2026-05-27; integration testing still pending |
| Memory-receivers on Woodhouse | Woodhouse's MacBook | Unknown — not checked this pass | If Woodhouse also runs a receiver, it should be in the federation |
| BetterMachine private dashboard on .32 | .32 | Restart pending after PR #9 merge | Carryover from 2026-07-21 |

**This is the "fleet-wide dead daemon audit" Erik added to the to-do list 2026-07-24 08:53 EDT.** Owner: TBD. Not today.

---

## Out of scope for the v2 PR (not blocking)

1. `llama-nano.service` cleanup — `systemctl disable && rm /etc/systemd/system/llama-nano.service`. Out of scope for dream-cycle PR. Part of the fleet-wide audit.
2. Memory-receiver topology docs (the federated-mesh finding above) — belongs in `mesh-memory/docs/ARCHITECTURE.md` or a new doc. Out of scope for the dream-cycle PR.
3. Cron payload update — already filed in `cron-payload-suggested.json`. Erik's call.
4. "unknown" agent in Liz's pool — worth investigating separately (could be a test that didn't clean up its agent_id). Out of scope.

---

## References

- `REQUIREMENTS-dream-cycle-v2-rebuild.md` — the v2 PR's requirements doc
- `dream-cycle-diagnosis-2026-07-01.md` — the original (partially-wrong) diagnosis
- Commit `12117497eb` — the Option A migration on `v2-rebuild`
- MEMORY.md §14 — Memory Entries Are Not Audited (lesson on grounding)
- `projects/mesh-memory/memory-receiver.mjs` — the receiver implementation (one per agent)
- `projects/mesh-memory/shared-pool-sync.mjs` — the peer-to-peer sync layer
- `projects/mesh-memory/config.mjs` — `receiverPort` config (default 18805)
