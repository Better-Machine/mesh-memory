# Requirements — Fleet Cron Audit (Phase 2.6)

**Date:** 2026-07-25
**Author:** Liz (Kosfootel/agent-liz)
**Supersedes:** None. Builds on `REQUIREMENTS-dream-cycle-accuracy.md` (Phase 2.5).
**Trigger:** Erik directive 2026-07-25 05:53 EDT — "When completed and tested investigate the rest of the fleet. Be sure to develop requirements and test cases throughout before coding."

---

## 1. Problem Statement

Per Erik's directive, after the dream-cycle accuracy fix (Phase 2.5) is complete and tested, the same audit pattern should be applied to the rest of the recurring cron jobs. The dream-cycle was "working" but lying; the other jobs may have the same problem.

### 1.1 Fleet inventory (verified 2026-07-25 06:00 EDT)

7 cron jobs active on Liz:

| Job ID | Name | Schedule | Timeout | Last status | Output | Risk class |
|---|---|---|---|---|---|---|
| `2217e921-…` | latent-frontier-research | `0 6 * * *` | 1800s | ok | `memory/practice/frontier-YYYY-MM-DD.md` | **High** — writes daily file, may have stale facts |
| `e6417b99-…` | daily-practice-reminder | `0 14 * * *` | 180s | ok | Telegram message | **Low** — read-only check, no synthesis |
| `71127ae7-…` | daily-fleet-report-liz | `0 19 * * *` | default | ok | Telegram message | **High** — yesterday's daily report (see §1.2) |
| `169f92fa-…` | dream-staging-nightly | `20 2 * * *` | 600s | ok | `memory/dream-staging/YYYY-MM-DD.md` | ✅ **Fixed (Phase 2.5)** |
| `20a0897e-…` | memory-consolidation | `50 3 * * *` | 300s | ok | `MEMORY.md` updates | **High** — directly writes MEMORY.md |
| `e094d2bf-…` | gateway-daily-restart | `0 4 * * *` | 90s | **error** | (none — system-level) | **High** — already erroring; needs investigation |
| `694b5b72-…` | healthcheck:security-audit | `0 9 * * 1` | 600s | ok | Telegram message | **Medium** — runs security commands, may include stale references |

### 1.2 Concrete evidence: yesterday's daily-fleet-report-liz

The 2026-07-24 19:00 EDT run sent a Telegram message to Erik that I can review from the conversation history. From the transcript at message #19132:

> **1. agent-liz (kosfootel/agent-liz)**
> - 1 commit today: 65a56ba — Eames Phase 2 plan shipped to origin/main
>
> **2. Eames v0.3 dogfood**
> - **Critical finding during ship:** The mesh-receiver daemon has been running *stale v1 code* despite the on-disk source being v0.2 schema. ... Filed as incident `2026-07-24-mesh-receiver-stale-code.md`.

The "critical finding" reported in the 19:00 message is correct (we already fixed it 18:38 EDT). The fleet report at 19:00 was contemporaneous — it was sent 22 minutes after the fix. So this run was actually accurate.

But the structural risk is the same as the dream cycle: the daily-fleet-report is an isolated LLM session, recapping from daily logs, with no live state. If it ran at 19:00 and a major event happened at 19:30, the report would not see it. The next morning's report would see it but recycled. Same as the dream cycle.

### 1.3 Concrete evidence: gateway-daily-restart error

The cron job `e094d2bf-…` shows `lastRunStatus: "error"`. The message says:
> Run this single command via exec, then return immediately: touch /tmp/gateway-restart-marker && (nohup systemctl --user restart openclaw-gateway.service >/tmp/gateway-restart.log 2>&1 &) && sleep 1 && echo 'restart initiated, gateway will be back in ~5s'.

The error was reported at 04:00 EDT: "⚠️ Cron job 'gateway-daily-restart' failed: cron: job interrupted by gateway restart" (per Telegram message #19135).

This is a **known design issue** with the cron: it restarts the gateway, but the cron itself is part of the gateway, so the restart interrupts the cron. The error is benign (the restart succeeded) but the cron reports error.

---

## 2. Goals (in priority order)

| # | Goal | Why |
|---|---|---|
| **G1** | Identify which cron jobs have the same "stale facts" risk as the dream cycle | Avoid the same surprise. Apply the same fix where applicable. |
| **G2** | Fix any cron job that produces a file or message that is recycled from prior days without re-verification | Same as the dream cycle fix. Honest output. |
| **G3** | Investigate the gateway-daily-restart error | Already erroring; may have a benign root cause, may not. |
| **G4** | Do NOT change cron schedules, timeouts, or the model routing policy. Those are operational. | Don't break what's working. |
| **G5** | Apply the verification pattern (Phase 2.5 lib/dream-cycle-accuracy.mjs) to other text-pipeline jobs. | Same library, different inputs. |
| **G6** | Document any cron jobs that should be retired or consolidated. | Some jobs may no longer be needed. |

---

## 3. Non-Goals

- **NG1:** Changing the cron schedule. The 02:20 dream, 03:50 consolidation, 04:00 restart, 06:00 frontier, 14:00 practice, 19:00 fleet report, Monday 09:00 security are all chosen for a reason. Don't touch.
- **NG2:** Adding new crons. The fleet is 7 jobs; the directive is to audit, not add.
- **NG3:** Replacing the isolated cron turns with forked sessions. Phase 4 work.
- **NG4:** Re-architecting the cron to call a model for verification. Verification stays in the cron turn.
- **NG5:** Fixing the gateway-daily-restart error structurally. The error is benign. The fix is to make the cron report success when the restart succeeded, even if the cron itself was interrupted. This is a 1-line patch in the cron turn's instruction.

---

## 4. Per-Job Audit Plan

### 4.1 `latent-frontier-research` (High risk)

**Current behavior:** Read PRACTICE.md, spend 20-30 min on AI/agent research, log to `memory/practice/frontier-YYYY-MM-DD.md`. 1800s timeout.

**Risk:** The "log findings" step is open-ended. The agent might write findings that reference prior state (e.g., "X is the latest model") without verifying. Same risk as the dream cycle.

**Fix:** Add an explicit verification step to the message. The agent should run `gh release list --repo <repo>` or similar to verify "X is the latest model" claims. If verification fails, mark the claim as `[unverified]`. Add a `## Source Coverage` section to the practice log.

**Files to add:** `lib/fleet-accuracy.mjs` (verification helpers for research-style claims), `tests/fleet-accuracy.test.mjs` (test cases), updated `cron-payload-frontier.json`.

### 4.2 `daily-practice-reminder` (Low risk)

**Current behavior:** Check if a practice log exists today. If yes, HEARTBEAT_OK. If no, note it. 180s timeout.

**Risk:** Read-only check. No synthesis. No risk of stale facts.

**Fix:** No fix needed. Document in audit.

### 4.3 `daily-fleet-report-liz` (High risk)

**Current behavior:** Produce a concise daily report covering 5 areas (agent-liz, Eames, Vigil, MATW, fleet-wide). 19:00 EDT daily. Yesterday's report at 19:00 was contemporaneous — no recycling issue. But the structural risk is the same.

**Risk:** Same as the dream cycle. The cron turn is an isolated LLM session, recapping from daily logs. If a major event happens after 19:00, the report will not see it.

**Fix:** Add the same verification library pattern. The cron turn should verify daemon PIDs, PR states, cron job statuses before claiming them. Add a `## Verification` section to the report.

**Files to add:** Reuse `lib/dream-cycle-accuracy.mjs` (the library is generic enough). Add a new test file `tests/daily-fleet-report.test.mjs` with a test for the report format.

### 4.4 `memory-consolidation` (High risk)

**Current behavior:** Read today's daily, extract unarchived [HIGH] entries, consolidate into MEMORY.md under the appropriate chunk. Mark processed entries as [ARCHIVED]. 03:50 EDT. 300s timeout.

**Risk:** This is **the most dangerous** cron — it directly writes to MEMORY.md. If the cron turn re-archives a [HIGH] entry that has been superseded, the stale fact is in MEMORY.md permanently.

**Fix:** Highest priority. The cron turn should:
  1. For each [HIGH] entry being consolidated, check whether a more recent daily contradicts it. If yes, the older entry is stale; do NOT consolidate it; write it to `memory/incidents/2026-MM-DD-stale-consolidation.md` instead.
  2. Verify the chunk being written to exists. Don't create a new chunk.
  3. Add the entry to MEMORY.md as `[ARCHIVED on YYYY-MM-DD]` rather than just `[HIGH]`.

**Files to add:** Reuse `lib/dream-cycle-accuracy.mjs`. New test file `tests/memory-consolidation.test.mjs`.

### 4.5 `gateway-daily-restart` (High risk)

**Current behavior:** Run `systemctl --user restart openclaw-gateway.service` in a nohup background. 04:00 EDT. 90s timeout.

**Risk:** The cron itself is part of the gateway, so restarting the gateway interrupts the cron. The cron reports error even when the restart succeeded. This is the current state (lastRunStatus: error).

**Fix:** Add a one-line check after the restart: if `/tmp/gateway-restart-marker` exists, the restart was initiated; the cron turn should report success regardless of whether the cron itself was interrupted. This is a 1-line addition to the message.

**Files to add:** None. Just update the cron message via `openclaw cron edit`.

### 4.6 `healthcheck:security-audit` (Medium risk)

**Current behavior:** Run `openclaw security audit --deep` and `openclaw update status`. Summarize findings. 09:00 EDT Mondays. 600s timeout.

**Risk:** The audit runs actual commands, so the findings are fresh. The risk is the *summary*: the agent may add context from its own memory that is stale.

**Fix:** Lower priority. Add a note in the message: "Verification commands above are live. Summary is from current run only. Do not add context from prior runs."

**Files to add:** None. Just update the cron message.

---

## 5. Functional Requirements

### FR-1: Verification library reusable

The `lib/dream-cycle-accuracy.mjs` module must be reusable across cron jobs. Add a new exported function `verifyFact` that takes a fact type and returns a verification result. The cron turns import this function (or, since they are isolated sessions, the library is documented in the cron message and the cron turn runs the commands inline).

**Acceptance criterion:** the same verification logic (process, gh_cli_pr_creation, mesh_pool_state, network_reachability, receiver_state) is documented in the cron message of each high-risk cron job.

### FR-2: New file: `lib/fleet-accuracy.mjs`

A new module that contains helper functions for the fleet crons. Specifically:
- `verifyDaemon(port)` — returns ok if the port is listening, stale if not
- `verifyCronJob(jobId)` — returns ok/stale based on `lastRunStatus`
- `verifyPR(repo, number)` — returns ok/stale/partial based on PR state
- `verifyProcess(pid)` — returns ok if the PID is running, stale if not

**Acceptance criterion:** the new module has tests covering each function.

### FR-3: Test file: `tests/fleet-accuracy.test.mjs`

A new test file with at least 4 test cases (one per helper function in FR-2).

**Acceptance criterion:** all tests pass.

### FR-4: Cron updates applied

For each high-risk cron, the cron message is updated to include the verification step. Apply via `openclaw cron edit`.

**Acceptance criterion:** after the update, the next scheduled run uses the new message.

### FR-5: Gateway restart error fix

The `gateway-daily-restart` cron message is updated to check `/tmp/gateway-restart-marker` and report success if the marker exists.

**Acceptance criterion:** the next run (2026-07-26 04:00 EDT) reports success even if the cron itself is interrupted.

### FR-6: Memory-consolidation safety

The `memory-consolidation` cron message is updated to:
  1. Check whether a more recent daily contradicts each [HIGH] entry. If yes, do NOT consolidate.
  2. Verify the target chunk in MEMORY.md exists.
  3. Tag consolidated entries with `[ARCHIVED on YYYY-MM-DD]`.

**Acceptance criterion:** the next run (2026-07-26 03:50 EDT) follows the new rules.

---

## 6. Non-Functional Requirements

- **NFR-1 — Reliability:** the cron must not break. If verification fails, the cron reports the failure but still produces output.
- **NFR-2 — Bounded runtime:** no cron exceeds its current timeout.
- **NFR-3 — Auditability:** every fact in every output has a verification result. Same as Phase 2.5 FR-4.
- **NFR-4 — No new dependencies:** all verification uses `ss`, `ps`, `curl`, `gh`, `git`, `openclaw cron`.

---

## 7. Acceptance Tests

### TC-1: `verifyDaemon` returns ok for listening port

**Setup:** port 18805 is listening.
**Run:** `await verifyDaemon(18805)`.
**Assert:** returns `{status: "ok", port: 18805, listener: "<pid>"}`.

### TC-2: `verifyDaemon` returns stale for unbound port

**Setup:** port 99999 is not listening.
**Run:** `await verifyDaemon(99999)`.
**Assert:** returns `{status: "stale", port: 99999, listener: null}`.

### TC-3: `verifyCronJob` returns ok for lastRunStatus=ok

**Setup:** the cron `169f92fa-…` last ran with status "ok".
**Run:** `await verifyCronJob("169f92fa-…")`.
**Assert:** returns `{status: "ok", lastRunAt: <iso>, lastStatus: "ok"}`.

### TC-4: `verifyCronJob` returns stale for lastRunStatus=error

**Setup:** the cron `e094d2bf-…` last ran with status "error".
**Run:** `await verifyCronJob("e094d2bf-…")`.
**Assert:** returns `{status: "stale", lastRunAt: <iso>, lastStatus: "error"}`.

### TC-5: `verifyPR` returns ok for open PR

**Setup:** PR #24 is open on Better-Machine/mesh-memory.
**Run:** `await verifyPR("Better-Machine/mesh-memory", 24)`.
**Assert:** returns `{status: "ok", state: "open", html_url: "..."}`.

### TC-6: `verifyPR` returns stale for merged PR

**Setup:** PR #23 is merged on Better-Machine/mesh-memory.
**Run:** `await verifyPR("Better-Machine/mesh-memory", 23)`.
**Assert:** returns `{status: "stale", state: "merged", mergedAt: "..."}`.

### TC-7: `verifyProcess` returns ok for running PID

**Setup:** PID 4169961 is running.
**Run:** `await verifyProcess(4169961)`.
**Assert:** returns `{status: "ok", pid: 4169961}`.

### TC-8: `verifyProcess` returns stale for dead PID

**Setup:** PID 7332 is not running.
**Run:** `await verifyProcess(7332)`.
**Assert:** returns `{status: "stale", pid: 7332}`.

### TC-9: Gateway restart marker is detected

**Setup:** `/tmp/gateway-restart-marker` exists.
**Run:** the cron turn's marker check.
**Assert:** the cron reports success, even if it was interrupted.

### TC-10: Memory consolidation skips stale [HIGH] entries

**Setup:** yesterday's daily has a [HIGH] entry that has been contradicted by a more recent [HIGH] entry in today's daily.
**Run:** the cron turn.
**Assert:** the older entry is written to `memory/incidents/...` not MEMORY.md.

---

## 8. Out of Scope (Phase 3+)

- Phase 3: Replace isolated cron turns with forked sessions. Eliminates the "no live state" problem structurally.
- Phase 3: Build a verification_history.json per job. Erik can replay verifications.
- Phase 3: Add a pre-merge gate to agent-liz: any cron-written MEMORY.md update with a stale fact is blocked.
- Phase 4: Generalize the library to handle 20+ fact types and provide a UI for browsing verification history.

---

## 9. Open Questions for Erik

- **OQ1:** Should the `memory-consolidation` cron run **before** or **after** the `dream-staging-nightly` cron? Currently: dream at 02:20, consolidation at 03:50. If consolidation runs first, it might consolidate a fact that dream later flags as stale. If dream runs first, the staging file might point to a MEMORY.md entry that doesn't exist yet.
  - **My recommendation:** keep current order (dream → consolidation). The staging file is a *suggestion*; consolidation is the actual write. If consolidation disagrees with a staging fact, the human review of the staging file catches it.

- **OQ2:** Should the `gateway-daily-restart` cron be moved to a different time? The 04:00 EDT slot is right before the `memory-consolidation` cron (03:50). If the restart takes longer than expected, the consolidation might run before the gateway is back up.
  - **My recommendation:** no change. The restart completes in ~5s. The consolidation cron is isolated and will wait for the gateway to be ready.

- **OQ3:** Should we add a `cron-fleet-report` cron (analogous to the daily-fleet-report) that summarises the state of all crons?
  - **My recommendation:** no. The daily-fleet-report already covers cron status. Adding another cron creates the same staleness problem we're trying to fix.

---

**End of requirements. Tests will be written to `tests/fleet-accuracy.test.mjs` before any code changes.**

**Co-Authored-By:** openhands <openhands@all-hands.dev>
