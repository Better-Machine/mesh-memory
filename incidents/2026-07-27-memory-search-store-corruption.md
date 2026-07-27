# BMHS — memory-search-store-corruption-repair (environment defect)

**Status:** PROPOSED
**Owner:** liz
**Date:** 2026-07-27
**Path:** `environment://liz/memory_search_store`
**Persona:** `code-reviewer`

Persona rationale: `code-reviewer` is the only persona staged on
GX-10's `/home/erik-ross/.openclaw/agency-agents/`. The fix is a
DDL operation on a database with a verification script — close in
shape to a code change. If `infrastructure-maintainer` is fetchable
from `/opt/gx10-dev-pod/fleet-maintenance/orchestrator/vendor/agency-agents/specialized/infrastructure-maintainer.md`,
that is the more correct persona; the audit falls back to local
code-reviewer otherwise.
**Defect class:** Data integrity / silent-failure
**Severity:** High (degraded agent capability for 6 weeks; unreported by owner)

---

## Context

The `memory_search` tool on Liz returns `"database disk image is malformed"`
on every invocation. This has been failing since **2026-06-15** (WAL last-write
timestamp), but Liz worked around the error instead of investigating and
escalating. Per the §14 generalization in `MEMORY.md`, this is a **silent-
failure class defect**: a tool Liz depends on stopped working, and neither
the failure nor its impact was reported to Erik.

This spec asks Eames to **audit the proposed repair** and (on AGREEMENT) let
the pipeline execute the fix. The repair is a DDL operation on a single
SQLite store on the Liz host. It is **not a code change** — there is no PR,
no branch, no merge. The work is environment-side: DROP/CREATE on a virtual
table inside an existing SQLite database.

This is the **first environment defect** filed through the Eames pipeline.
Eames' review contract is unchanged: verify the diagnosis against independent
evidence, verify the fix is sound, verify the verification plan, return
AGREEMENT or DISPUTE.

## What is broken (Evidence Block)

Store: `~/.openclaw/memory/main.sqlite` on Liz. This is the `memory_search`
backend, not the LCM (lossless-claw) store at `~/.openclaw/lcm.db`. The two
stores are distinct, both are SQLite, and the LCM store is healthy.

Verified facts (all directly probed, not paraphrased):

| Fact | Value | How verified |
|---|---|---|
| Store path | `~/.openclaw/memory/main.sqlite` | OpenClaw source `dist/memory-search-*.js` `resolveStorePath()` line ~76: returns `${stateDir}/memory/${agentId}.sqlite` |
| Store size | 1,897,046,016 bytes (1.9 GB) | `ls -la` |
| Store mtime | 2026-06-14 08:04 (base) / 2026-06-15 15:13 (WAL) | `stat` |
| Gateway PID holding the DB | 1580366 (`openclaw gateway --port 18789`) | `lsof` shows FDs 30 and 38 |
| Gateway last restart | 2026-07-27 04:00:01 EDT | Process start time |
| `meta` table | 1 row, OK | `SELECT COUNT(*)` |
| `files` table | 337 rows, OK | `SELECT COUNT(*)` |
| `chunks` table | 25,299 rows, **OK** — full text + embeddings intact | `SELECT COUNT(*)`, sample read of `text` and `embedding` columns |
| `chunks_fts` (FTS5 vtable) | **vtable constructor failed** | Direct query |
| `chunks_fts_data`, `chunks_fts_idx`, `chunks_fts_docsize`, `chunks_fts_config` | **"database disk image is malformed"** | Direct queries |
| `chunks_fts_content` (one of the shadow tables) | 25,299 rows readable | Direct query |
| `chunks_vec` (sqlite-vec ext) | "no such module: vec0" + corruption | Direct query |
| `PRAGMA integrity_check` | `ok` | (Because base tables are intact. FTS5/vec0 corruption does not fail this check.) |
| `memory_search` tool error | `"database disk image is malformed"` | Direct invocation |
| LCM store at `~/.openclaw/lcm.db` | Healthy, 1.3 GB, actively compacting current conversation | `lcm` log shows leaf compactions running |
| First-known date of failure | ~2026-06-15 (WAL last-write) | Stat + integration check |

**Eames audit task:** Re-probe at least three of the above facts (store size,
`chunks` row count, FTS5 vtable failure) on Liz to confirm the diagnosis is
reproducible. Do not trust this block as-is.

## Why the corruption happened (Hypothesis)

WAL last-write is 2026-06-15 15:13:52 EDT. The base file mtime is
2026-06-14 08:04. This pattern is consistent with an **unclean shutdown**
during a write that left the WAL partially applied and the FTS5/vec0
shadow tables in an inconsistent state. The base tables recovered because
they don't depend on the FTS5/vec0 indexes for their own consistency.

Eames is **not** being asked to verify the hypothesis — that is a
post-mortem activity. Eames is asked to verify the **fix** is sound given
the diagnosis.

## Scope

**What this fix touches:**

- `~/.openclaw/memory/main.sqlite` — DROP and re-CREATE of `chunks_fts`
  virtual table; INSERT to repopulate from `chunks.text`
- `~/.openclaw/memory/main.sqlite-wal` — auto-updated by sqlite on commit
- `~/.openclaw/memory/main.sqlite-shm` — auto-updated by sqlite on commit

**Not touched (do not touch):**

- The LCM store at `~/.openclaw/lcm.db` (different store, healthy)
- The agent state store at `~/.openclaw/agents/main/agent/openclaw-agent.sqlite`
- Any agent config (`openclaw.json`, `models.json`)
- The gateway service (no restart needed)
- Any other file in `~/.openclaw/`

## The fix (3 SQL operations, ~5 sec)

```sql
-- 1. Drop the corrupt FTS5 virtual table (1.6s on 1.9GB file)
DROP TABLE chunks_fts;

-- 2. Recreate the FTS5 index as a contentless mirror of chunks.text
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    text,
    content='chunks',
    content_rowid='rowid',
    tokenize='unicode61'
);

-- 3. Populate from the source-of-truth chunks table (0.5s)
INSERT INTO chunks_fts(rowid, text) SELECT rowid, text FROM chunks;
```

**Why this is safe:** The `chunks` table is verified intact (25,299 rows,
text + embeddings readable). The FTS5 index is a derived view on top of
`chunks.text`. Rebuilding the index does not modify the source data. If
the rebuild fails partway through, the failure mode is "FTS5 still
broken, base data still intact" — the same state we're in now.

**Why the gateway can stay running:** The gateway is heavy on
`lcm.db` (LCM store, separate file, healthy). The gateway's traffic
on `main.sqlite` is the file-watcher sync (debounced 1.5s) and
memory_search queries. Both can coexist with a brief DDL operation
on a different table. If this turns out to be wrong, the gateway
recovers cleanly on its next restart (04:00 EDT daily).

**Lock contention handling during DDL.** The 3-statement DDL
acquires a write lock on `main.sqlite` for the duration of the
DROP + CREATE + INSERT (~2-5s for 25K rows). If the gateway has
an open transaction at that moment, SQLite returns
`SQLITE_BUSY` after the busy-timeout expires. The fix script
sets a 5s busy-timeout via `PRAGMA busy_timeout = 5000` before
the DDL, which causes the failing statement to wait briefly
rather than error immediately. If it still fails: rollback (see
below), log the time and process holding the lock, retry at
the next heartbeat (heartbeat runs every 30 min and is the
quietest moment on the DB).

## Acceptance Criteria

After the fix executes, **all four** checks must pass before declaring done:

1. **`PRAGMA integrity_check;`** returns `ok` on `main.sqlite`.
2. **`SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'hockeyops' LIMIT 3;`**
   returns 3 rows. (Sanity: a term known to appear in indexed content.)
3. **`memory_search` tool call** with `query: "memory_search store corruption"`
   returns ≥1 result with `score >= 0.35` (the configured `minScore`).
4. **End-to-end retrieval test:** call `memory_search` with the query
   `"Ray HockeyOps lead dev"` (a real retrieval need that was failed by
   the corruption). Expect at least 1 result citing the conversation
   from 2026-07-27 where Erik said "Ray was the lead on hockeyops since
   it's inception." If the smoke test fails, the fix is incomplete.

If any of these fail: rollback (see below) and re-diagnose.

**Verification script scope.** The accompanying `verify.sh` script
covers the database-level checks (1 and 2) plus a bonus multi-word
phrase query (acts as a sanity check on the FTS5 tokenization).
Checks 3 and 4 require the `memory_search` tool wrapper to be
operational, which is the very thing being repaired — they cannot
run while the defect is active. Verify-script exit 0 (checks 1, 2,
and the bonus) + manual memory_search probe for checks 3 and 4
together constitute a complete pass.

**Pre-fix smoke test.** Running `verify.sh` *before* the DDL fix
exits non-zero and reports the exact failure modes — proves the
defect is real and the verification is meaningful.

## Rollback

The fix is a DROP + CREATE on a virtual table. Rollback path:

```bash
# Pre-fix backup (created automatically by the spec execution script)
ls -la ~/.openclaw/memory/main.sqlite.bak-2026-07-27

# If the fix needs to be reverted:
systemctl --user stop openclaw-gateway
cp ~/.openclaw/memory/main.sqlite.bak-2026-07-27 ~/.openclaw/memory/main.sqlite
systemctl --user start openclaw-gateway
```

The gateway restart is the only interruption. The LCM session state
is in `lcm.db`, unaffected. No user-visible state lost.

## Don't-Do List

- Do NOT touch `lcm.db` (different store, healthy).
- Do NOT drop `chunks` (the source of truth). Dropping `chunks_fts` only.
- Do NOT rebuild `chunks_vec` in this spec. That is **Option B** in
  `memory-recovery-2026-07-27.md` and requires re-embedding 25,299 chunks
  (~30-60 min, ~$0.01 token cost, separate spec).
- Do NOT restart the gateway service during the fix. Let the gateway
  keep running. If DDL against `main.sqlite` fails because the gateway
  is holding a lock, document the failure and stop.
- Do NOT use `PRAGMA wal_checkpoint(TRUNCATE)` on `main.sqlite` — that
  would force a checkpoint of the stale 2026-06-15 WAL state into the
  base file, potentially re-corrupting the FTS5 shadow tables.
- Do NOT run `INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')` —
  that requires the vtable to construct first, which is the broken
  condition we're fixing.
- Do NOT modify `openclaw.json` or `models.json` for this fix.
- Do NOT use `lcm.db` as a substitute for `main.sqlite`. They have
  different schemas; the LCM store is for session-lossless
  compaction, not for memory_search.

## Out of scope (separate specs, deferred)

- **Option B — Rebuild vec0 / re-embed all chunks.** This restores
  semantic (hybrid) search. Requires fleet-embed health check first.
  Estimate: 30-60 min, ~$0.01 token cost. Will be a separate BMHS spec.
- **Post-mortem on the 2026-06-15 unclean shutdown.** What triggered
  it? Gateway OOM? OOM killer? Manual kill -9? This is forensic, not
  blocking, and the LCM logs from that day may have clues.
- **§14 generalization application.** Add a weekly cron that probes
  every tool I depend on (`memory_search`, `lcm_describe`, A2A
  message/send to each peer) and reports any silent-failure patterns
  to Erik. The dream-cycle `lib/dream-cycle-accuracy.mjs` already does
  this for facts; the same pattern would work for tools.

## Reference documents

- `projects/mesh-memory/memory-recovery-2026-07-27.md` — full diagnostic
  narrative, the verification I did on a working copy, the four fix
  options, and the §14 lessons learned. This is the **primary
  reference**. Eames should read it before auditing.

## Audit checklist for Eames (5 checks per Eames v0.2 §4.2)

| # | Check | What Eames verifies |
|---|---|---|
| 1 | `spec_compliance` | The fix described above matches what the spec says will be done. No silent additions or removals. |
| 2 | `tests_included` | The verification plan (4 checks) is runnable and the assertions are concrete. If the verification script doesn't exist, the spec is not ready. |
| 3 | `scope_respected` | Only `main.sqlite` and its WAL/SHM are touched. No collateral damage to `lcm.db`, `openclaw.json`, models.json, or any agent config. |
| 4 | `no_dont_do_violations` | The don't-do list is honored. Specifically: no `chunks_vec` rebuild, no `lcm.db` writes, no `openclaw.json` edits, no `wal_checkpoint(TRUNCATE)`. |
| 5 | `no_external_state_mutation` | No external services (LiteLLM, Eames, fleet-kb, other agents) are affected. fleet-embed is not called. No PR is opened. No message is sent to Telegram. The fix is local to Liz. |

## File Boundaries

- **Read:** `~/.openclaw/memory/main.sqlite`, `~/.openclaw/agents/main/agent/openclaw-agent.sqlite` (to confirm it's a different store), `~/.openclaw/lcm.db` (to confirm it's healthy)
- **Write:** `~/.openclaw/memory/main.sqlite` (DDL only), `~/.openclaw/memory/main.sqlite-wal` and `-shm` (auto)
- **Backup write:** `~/.openclaw/memory/main.sqlite.bak-2026-07-27` (before any DDL)
- **Do not touch:** `~/.openclaw/lcm.db`, `~/.openclaw/agents/main/agent/openclaw-agent.sqlite`, any `~/.openclaw/openclaw.json`, any `~/.openclaw/models.json`, any other store

---

## Owner self-attestation (LIZ, for Eames owner_verdict)

| Check | Verdict | Evidence |
|---|---|---|
| spec_compliance | PASS | This spec describes a 3-statement DDL fix on `main.sqlite`. The execution script will perform exactly that. |
| tests_included | PASS | 4 verification checks defined; `verify.sh` covers DB-level checks (1, 2, +multi-word bonus); checks 3-4 require the memory_search tool to be alive post-fix (chicken-and-egg acknowledged in spec). |
| scope_respected | PASS | Only `main.sqlite` and its WAL/SHM touched. Other stores and configs read-only. |
| no_dont_do_violations | PASS | Don't-do list explicitly excludes `chunks_vec` rebuild, `lcm.db` writes, `openclaw.json` edits, `wal_checkpoint(TRUNCATE)`, and vtable-rebuild attempts |
| no_external_state_mutation | PASS | No external service calls. No PR. No Telegram. No Eames trigger. No LiteLLM. No fleet-embed. Local DDL only. |

---

*Filed 2026-07-27 by liz. Eames audit pending.*
