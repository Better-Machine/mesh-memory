# Daemon Triage — 2026-07-24 (B-Effort)

**Status:** Filed for follow-up. **Not blocking the dream-cycle v2 PR.**
**Source:** Out-of-scope findings during dream-cycle diagnosis. See `REQUIREMENTS-dream-cycle-v2-rebuild.md` §1 and `dream-cycle-diagnosis-2026-07-01.md` for the original (partially-wrong) diagnosis that triggered this triage.

---

## TL;DR

My initial diagnosis (HTTP 000 on `:18805`) was **wrong about the host**. The mesh daemon IS alive — it's on `127.0.0.1:18805` (Liz), not on `192.168.50.30:18805` (GX-10). The v2-rebuild migration is fully correct; the dream-cycle fix is just "merge the migration that's been sitting on `v2-rebuild` for 10 days." That's done in PR `eames/liz-dream-cycle-v2-rebuild`.

This document tracks the **remaining** daemon/infrastructure questions that came up during the diagnosis and that the v2 PR doesn't address.

---

## What I checked, and what I found wrong

### Wrong claim #1: "Mesh daemon is dead"

**My original finding (04:54 EDT 2026-07-24):** "Mesh daemon `:18805` — HTTP 000 (unreachable). Died or moved. Need to re-find."

**Correct finding (05:01 EDT 2026-07-24):**
- `curl http://127.0.0.1:18805/mesh/shared-pool` → HTTP 200 in 1.3ms
- `curl http://192.168.50.30:18805/mesh/shared-pool` → HTTP 000
- `ss -tlnp` on Liz shows `node` process listening on `0.0.0.0:18805` (PID 7332)

**Conclusion:** Mesh daemon is alive on Liz. My initial test used the wrong host. The v2-rebuild migration (which uses `127.0.0.1:18805`) was correct all along.

**Lesson (per §14 — Memory Entries Are Not Audited):** When verifying a service, check the host the script actually runs on, not the host the service "should" be on. The dream-cycle cron runs on Liz; the daemon is on Liz; the URL `127.0.0.1:18805` resolves correctly. I had the right URL but tested the wrong host.

### Wrong claim #2: "memory/.dreams/short-term-recall.json is dead"

**My original finding (04:54 EDT 2026-07-24):** "`memory/.dreams/short-term-recall.json` — Does not exist. Died too."

**Verified (05:01 EDT 2026-07-24):** The directory `~/.openclaw/workspace/memory/.dreams/` does not exist. This was correct. **However**, the LCM recall tool (which is what writes to it) is still operational — the v2-rebuild migration just doesn't read from `.dreams/`, it reads from the daily logs. So `.dreams/` is dormant by design, not by failure.

**Conclusion:** Not dead — just not used by dream-cycle anymore. The July 1 diagnosis's claim that "the index lives at `memory/.dreams/short-term-recall.json`" was wrong; the index doesn't exist, and that's fine for the dream-cycle use case.

---

## What's actually dead / unclear

| Item | Status | Need to investigate? |
|---|---|---|
| `~/.openclaw/workspace/memory/mesh/` directory | Does not exist | **No** — planned obsolete (mesh v1→v2 migration) |
| `~/.openclaw/workspace/memory/lcm/` directory | Does not exist | **No** — daily logs cover the use case |
| `~/.openclaw/workspace/memory/.dreams/short-term-recall.json` | Does not exist | **No** — see above |
| Mesh daemon on `192.168.50.30:18805` (GX-10) | HTTP 000 (was 200 in July 1 diagnosis) | **Maybe** — see "Open question" below |
| Mesh daemon on `127.0.0.1:18805` (Liz) | Healthy, 50 facts in shared pool | **No** — confirmed working |
| A2A gateway on `127.0.0.1:18801` (Liz) | Healthy (per `ss -tlnp`) | **No** — confirmed working |

## Open question (worth a follow-up)

**Did the mesh daemon used to run on GX-10 and migrate to Liz?** The July 1 diagnosis assumed the daemon was on GX-10. The MEMORY.md entry "GX-10 Architecture — Current State" (2026-06-23) says mesh-memory was deployed at `/opt/gx10-dev-pod/fleet-maintenance/` on GX-10, but doesn't say where the *daemon* listens. The `127.0.0.1:18805` URL is hardcoded in `dream-cycle.mjs` — if the script and the daemon are on the same host (Liz), that works. If the script runs on GX-10 and the daemon is on Liz, it would fail.

**The dream-cycle cron runs on Liz** (per the cron job's session target — `agent:main:a2a:8018dc21-...` and the gateway running on Liz). So `127.0.0.1:18805` resolves to Liz's daemon, which is up. No bug today.

**But if we ever move the dream-cycle to run on a different host** (GX-10, or a future Mac Studio, or any new node), the URL needs to be `192.168.50.30:18805` (GX-10) or wherever the daemon actually lives, not `127.0.0.1`. The new `MESH_API_URL` env var added in this PR makes that change one env-var flip, not a code change.

**Recommendation:** Document the daemon's actual host somewhere authoritative (TOOLS.md, ARCHITECTURE.md, or a new `mesh-daemon-host.md`). Currently this knowledge is implicit in the URL string. Future Liz-self (or future Ray/Woodhouse) reading MEMORY.md should be able to find the answer without running `curl` from every host.

---

## What the v2 PR does NOT address

The v2 PR fixes the dream-cycle cron. It does NOT:

1. **Restart the GX-10 mesh daemon** (if it ever ran there). Out of scope.
2. **Restore `memory/mesh/` as a write target.** Planned obsolete. Documented in commit `6eee36f105` ("archive stale memory/mesh/ artifact").
3. **Re-enable the LCM v1 daily writer.** Daily logs cover the use case.
4. **Update the cron payload** (FR-4 in the requirements doc). The suggested payload is in `cron-payload-suggested.json` in the PR branch. Erik approves cron changes per agent rules; this is a separate ask.
5. **Document the mesh daemon's actual host.** See "Open question" above.

## Suggested next steps (Erik's call)

- [ ] **Open the PR for review.** Branch: `eames/liz-dream-cycle-v2-rebuild` on `Better-Machine/mesh-memory`. PR description has the full context. Direct PR link: `https://github.com/Better-Machine/mesh-memory/pull/new/eames/liz-dream-cycle-v2-rebuild`
- [ ] **Decide on the cron payload update** (apply `cron-payload-suggested.json` or not). I do not auto-apply.
- [ ] **(Optional) Document the mesh daemon's host** in TOOLS.md or mesh-memory ARCHITECTURE.md, so this triage doesn't repeat.
- [ ] **(Optional) Audit other daemons** that were assumed-on-GX-10 and might be on Liz or vice versa. The fleet audit on 2026-07-07 caught the SSH topology finding; a similar audit for HTTP daemons would be useful.

---

## References

- `REQUIREMENTS-dream-cycle-v2-rebuild.md` — the v2 PR's requirements doc
- `dream-cycle-diagnosis-2026-07-01.md` — the original (partially-wrong) diagnosis
- Commit `12117497eb` — the Option A migration on `v2-rebuild`
- MEMORY.md §14 — Memory Entries Are Not Audited (lesson on grounding)
- MEMORY.md "GX-10 Architecture — Current State" — assumed-on-GX-10 entries
