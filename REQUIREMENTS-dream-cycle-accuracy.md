# Requirements — Dream-Cycle Accuracy Fix (Phase 2.5)

**Date:** 2026-07-25
**Author:** Liz (Kosfootel/agent-liz)
**Supersedes:** None. Builds on `REQUIREMENTS-dream-cycle-v2-rebuild.md` (PR #23) and `REQUIREMENTS-dream-cycle-v2-rebuild.md` §5 "future work."
**Trigger:** Erik directive 2026-07-25 05:53 EDT — "Please assess and properly fix your dream cycle issues. ... Be sure to develop requirements and test cases throughout before coding."

---

## 1. Problem Statement

The dream-cycle cron (`dream-staging-nightly`, schedule `20 2 * * *`) and the staging-file generator (the agent turn that runs after the script) both report "OK" every night. But the staging file contains **stale, recycled facts** that have been superseded by events from later in the day or from the next morning.

### 1.1 Concrete evidence (2026-07-25 02:20 EDT run, verified 05:53 EDT)

The staging file at `memory/dream-staging/2026-07-25.md` contains these claims, all of which are **wrong as of 05:53 EDT**:

| Claim | Stated status | Actual status (verified) |
|---|---|---|
| **F-02:** Mesh memory receiver on Liz: healthy, PID 7332 | PID 7332 healthy | **PID 7332 was killed 2026-07-24 18:30 EDT during Phase 2.4 migration.** Current receiver is PID 4169961 (systemd-supervised v0.2). |
| **U-01:** "unknown" agent in Liz's federated pool — unresolved | Unresolved | **Solved 2026-07-24 18:30 EDT.** The 11 "unknown" facts were lossless-claw test entries from 2026-06-13 (schema validation test, no agent name set). Not a real agent. |
| **F-01:** Dream cycle v2-rebuild PR merged (PR #23) | Merged | True as of 14:13 UTC 2026-07-24, but **superseded by PR #24** (Phase 2.4 v0.2 receiver migration) which is currently awaiting Erik review. |
| **F-07:** gh CLI PAT scope limitation | Cannot open PRs | Partially true. `liz-kosfootel-token` (gh CLI default) has `contents:write` but **NOT** `pull_requests:write`. `liz-better-machine-token` (new 2026-07-24) has `pull_requests:write` and was used to open PR #24 via REST API. |
| **F-04:** §14 lesson about testing on the correct host | Verified 2026-07-24 | True, but **the underlying cause (v0.2 receiver) is now fixed.** The lesson applies but the symptom is gone. |

### 1.2 Root cause analysis (per §14: ground in the deployed source)

The dream-cycle cron is a **two-stage text pipeline**, not a verification pipeline:

**Stage 1 (script, `dream-cycle.mjs`):**
- Reads files from `memory/YYYY-MM-DD.md` (LCM) and `http://127.0.0.1:18805/mesh/shared-pool` (mesh)
- Writes a "consolidation prompt" to `memory/dream-cycle-YYYY-MM-DD.md`
- Output is a Markdown blob of raw source content
- **Does not verify any claim against the live system.**

**Stage 2 (cron turn, isolated session, sessionKey: `agent:main:a2a:8018dc21-…`):**
- Receives a multi-step instruction in its message payload
- Runs `node dream-cycle.mjs` (Stage 1)
- Reads the resulting `dream-cycle-YYYY-MM-DD.md`
- **Reads `memory/2026-07-24.md` (yesterday's daily)** as its "current state" reference
- Synthesizes a "fact-tier" staging file at `memory/dream-staging/YYYY-MM-DD.md`
- Commits the staging file to `agent-liz`
- Sends "Dream staging YYYY-MM-DD done" to Erik's Telegram

**The problem:**
- Stage 2's session has no live context (it's `isolated`, started fresh, no `fork` from main)
- Its only sources of "facts" are the daily logs (yesterday + today) and the dream-cycle output (LCM + mesh)
- It cannot verify any claim against the actual live system
- It applies **a generous interpretation** of "recent" — meaning yesterday's facts get reformulated as today's facts
- The §14 lesson says "ground in the deployed source." Stage 2 has no way to do that.

### 1.3 Three classes of bug, in increasing severity

| Class | Description | Example |
|---|---|---|
| **Stale-fact bug** | A fact was true when the source log was written, but events later in the day (or the next morning) superseded it. The staging file presents the older fact. | F-02: PID 7332 was healthy when the daily log was written, but was killed 4h later. |
| **Half-true-fact bug** | A fact is partially true and partially wrong. The staging file presents the whole thing as true. | F-07: PR creation is blocked via `gh pr create`, but works via `curl` with `liz-better-machine-token`. |
| **Recycled-context bug** | The "unresolved" or "needs action" labels from a prior day's staging get carried over without re-verification. | U-01: was unresolved yesterday, solved today, still labeled unresolved. |

### 1.4 Why this matters

The staging file is a *suggestion* for MEMORY.md updates, intended to be reviewed by the agent and merged in. If the suggestions are wrong, MEMORY.md gets polluted with stale facts. The §14 lesson (memory entries are not audited) is relevant here: the staging file IS a memory entry, and it's not being audited against the live system before being written.

---

## 2. Goals (in priority order)

| # | Goal | Why |
|---|---|---|
| **G1** | Every fact in the staging file must be **verifiable against a live source** (system state, file content, API response) at the time the file is written. | Stale facts pollute MEMORY.md. The staging file is the path of least resistance into MEMORY.md, so it must be accurate. |
| **G2** | When a fact is **superseded by a later event**, the staging file should reflect the **most recent verified state**, not the older state. | F-02 (PID 7332 dead, 4169961 alive) is the canonical case. |
| **G3** | When a fact is **partially true**, the staging file should mark it as such (e.g., "true via X, blocked via Y") rather than presenting the whole claim as true or false. | F-07 (PR creation works via REST, blocked via gh CLI) is the canonical case. |
| **G4** | When a fact is **resolved** (an "unresolved" or "needs action" item that has since been closed), the staging file should not re-flag it as open. | U-01 ("unknown" agent) is the canonical case. |
| **G5** | The fix should be **applicable to the rest of the fleet** (the other recurring cron jobs that produce similar text-pipeline outputs). | Erik's directive explicitly asks for this. "Investigate the rest of the fleet" after the dream cycle is fixed. |
| **G6** | The fix should not break the existing PR #23 contract (no-entries silent exit, single confirmation message, 600s timeout). | The cron has been running reliably for one night. Don't regress what works. |

---

## 3. Non-Goals (explicitly out of scope)

- **NG1:** Restoring the daily log file at 02:20 EDT. The cron is supposed to handle the "no today file yet" case. The problem is not the missing file; the problem is that the staging process treats yesterday's log as today's source.
- **NG2:** Calling an inference model from inside `dream-cycle.mjs` to verify facts. The script is text-only by design (per PR #23 G3-NG5). Verification happens at Stage 2.
- **NG3:** Rewriting the cron schedule or merging the cron into a different job. Schedule stays `20 2 * * *`.
- **NG4:** Building a real-time fact-verification service. The cron is the only consumer; build for the cron.
- **NG5:** Changing the dream-cycle output format (`dream-cycle-YYYY-MM-DD.md`). The script is working as designed at the format level. The format is the issue's symptom, not the issue's cause.
- **NG6:** Replacing the isolated cron turn with a forked session from main. Out of scope for Phase 2.5; would be a structural change to cron architecture. Possible Phase 3 work.

---

## 4. Architecture Decision: Where Does Verification Happen?

The fix has three options for where to verify facts:

| Option | Where | Pros | Cons |
|---|---|---|---|
| **A** | In `dream-cycle.mjs` (the script) | Single source of truth; the staging agent just reads the file | Script becomes a verification engine, not a text aggregator. Increases complexity. |
| **B** | In the cron turn (Stage 2) | Most flexible; can use shell, curl, gh, any tool. Matches the agent's strengths. | The cron turn is an isolated session with no live state. The verification must be done by the agent itself. |
| **C** | In a new pre-cron job (Stage 1.5) | Decoupled. Can be tested independently. Can run anytime. | Adds another cron job. More moving parts. |

**Decision: Option B (verify in the cron turn).**

Rationale:
- The cron turn already has access to `exec`, `curl`, `gh`, and the file system. No new tooling.
- The cron turn already knows the staging file's structure (it's the one writing it).
- The Stage 2 cron turn's instruction can be updated to include explicit verification steps.
- A failed verification becomes a "Stale" flag in the staging file rather than a hard failure.
- The other recurring cron jobs (memory-consolidation, daily-practice-reminder, etc.) can adopt the same verification pattern.

---

## 5. Functional Requirements

### FR-1: Verification command library

The cron turn's instruction must include a **library of shell commands** the agent can use to verify candidate facts against the live system. The library is keyed by fact type:

| Fact type | Verification command (example) |
|---|---|
| Daemon running | `ss -tlnp \| grep ':<port>'` |
| Process exists | `ps -p <pid>` |
| Git status | `git log --oneline -1 -- <branch>` |
| PR open | `gh pr view <number> --json state,mergedAt` (or REST equivalent) |
| File exists | `[ -f <path> ] && echo exists` |
| API reachable | `curl -sS -m 3 -o /dev/null -w '%{http_code}' <url>` |
| Cron job state | `openclaw cron get <id> \| jq .state.lastStatus` |

**Acceptance criterion:** the cron turn can verify at least the 7 fact types above without inventing new tools.

### FR-2: Stale flagging

When the cron turn writes a fact to the staging file, it must also write a **verification result** next to the fact. The format is:

```
**[F-NN] <fact summary>** (verified: <YYYY-MM-DD HH:MM EDT>, <source>)
- <fact body>
- <verification command used>
- <verification result: ok|partial|stale|unverifiable>
- <correction if applicable>
```

**Acceptance criterion:** every fact in the staging file has a verification result. No exception.

### FR-3: Verification result values

- **ok** — the fact was verified against the live system and matches.
- **partial** — the fact has both a true and a false part. The staging file must state both. Example: F-07 today = `partial: gh CLI 403 (no pull_requests:write), REST API works (liz-better-machine-token used for PR #24)`.
- **stale** — the fact was true at some point but is no longer the current state. The staging file must state the current state. Example: F-02 today = `stale: PID 7332 dead since 18:30 EDT; current is PID 4169961 (systemd)`.
- **unverifiable** — the fact cannot be verified with the available tools. The staging file must mark it as unverifiable and explain why. The fact is NOT promoted to Tier 1 (merge-ready) in this case.

**Acceptance criterion:** staging file reviewer (Liz, in main session) can identify the verification state of every fact at a glance.

### FR-4: Recency window for "today"

A fact is "today" if it is sourced from a file dated today (e.g., `memory/2026-07-25.md` exists and the fact appears in it). If the today file does not exist (cron runs at 02:20, before the agent has written today's log), the fact must be sourced from **yesterday's file** AND must be marked `(source: yesterday)`.

**Acceptance criterion:** the staging file has a `## Source Coverage` section that explicitly states what date range was used, and any fact sourced from a non-today file is flagged.

### FR-5: Resolved-item reconciliation

Before writing a "Tier 2 — Unshared Observations" entry, the cron turn must check whether the observation is still unresolved. The check uses the same verification library as FR-1. If the observation is now resolved, the cron turn writes it to a new section: `## Resolved (since last staging file)` rather than `## Unshared Observations`.

**Acceptance criterion:** the 2026-07-25 staging file would have written "unknown" agent to Resolved, not Unshared. This is the test case.

### FR-6: Confirmation message includes verification summary

The cron turn's one-line confirmation message (per PR #23 FR-4.2) must include the count of stale/partial/unverifiable facts so Erik can scan it:

```
Dream staging 2026-07-25 done (7 ok, 1 stale, 0 partial, 0 unverifiable)
```

If any fact is stale/partial/unverifiable, the message must include a short hint:

```
Dream staging 2026-07-25 done (6 ok, 1 stale, 0 partial, 0 unverifiable). Stale: F-02 mesh PID. See staging file.
```

**Acceptance criterion:** Erik can read the one-line confirmation and know if anything needs his attention.

### FR-7: Staging file format

The staging file format is updated from PR #23's contract:

```markdown
# Dream Staging — YYYY-MM-DD

_Auto-generated by dream-staging-nightly cron job._

## Source Coverage

- **Today daily** (`memory/YYYY-MM-DD.md`): exists | not-yet-created
- **Yesterday daily** (`memory/YYYY-MM-DD-1.md`): exists | not-yet-created
- **Mesh shared-pool** (curl): <count> facts
- **Dream cycle output** (`memory/dream-cycle-YYYY-MM-DD.md`): <count> sources

## Fact Tiers

### Tier 1 — Confirmed Facts (verified against live system)

**[F-NN] <summary>** (verified: <timestamp>)
- <body>
- *Verification:* <command> → <result>

### Tier 2 — Unshared Observations (flagged but not merged)

**[U-NN] <summary>** (verified: <timestamp>)
- <body>
- *Verification:* <command> → <result>

### Tier 3 — Resolved (since last staging)

**[R-NN] <summary>** (resolved: <timestamp>)
- <body>

## Contradictions

| # | Contradiction | Resolution |
|---|--------------|-----------|
| C-NN | <description> | <resolution> |

## Summary

- **Confirmed facts:** <count>
- **Unshared observations:** <count>
- **Resolved (since last):** <count>
- **Contradictions:** <count>
- **Verification state:** <count> ok, <count> stale, <count> partial, <count> unverifiable
```

**Acceptance criterion:** the staging file has all the listed sections, in order, with the correct counts.

### FR-8: Existing PR #23 contract preserved

The following behaviors from PR #23 are NOT changed:
- No-entries path: silent exit, no Telegram message (FR-4.1)
- One-line confirmation message on success (FR-4.2)
- One-line failure message on commit failure (FR-4.3)
- 600s timeout
- Cron schedule `20 2 * * *` EDT
- Files: `memory/dream-cycle-YYYY-MM-DD.md` (Stage 1) and `memory/dream-staging/YYYY-MM-DD.md` (Stage 2)

**Acceptance criterion:** the cron still runs at 02:20, still produces both files, still sends one Telegram message. The content of the staging file is what's new.

---

## 6. Non-Functional Requirements

- **NFR-1 — Reliability:** the cron must not break. If verification fails for any reason, the staging file must still be written, and the verification failure must be reported (not silently dropped).
- **NFR-2 — Bounded runtime:** the cron must complete within 600s. The verification commands must be cheap (no model calls, no large file scans). Budget: 60s for Stage 1, 540s for Stage 2 (including verification).
- **NFR-3 — Idempotency:** running the cron twice on the same day must not produce a different staging file (unless the underlying data changed). The staging file is named with the date, so re-runs overwrite.
- **NFR-4 — Auditability:** every fact in the staging file must have a verification command and result. The reviewer (Liz) must be able to re-run any verification command and get the same result.
- **NFR-5 — No external dependencies:** the verification library uses only tools already on the system (`ss`, `ps`, `curl`, `gh`, `git`, `openclaw cron`, `jq`, `node`). No new packages, no new services.

---

## 7. Acceptance Tests

These tests will be written to `tests/dream-cycle-v2-rebuild.test.mjs` (extending the existing test file) and to a new test file `tests/dream-cycle-accuracy.test.mjs`.

### TC-1: Stale fact gets `stale` flag

**Setup:** Insert a fake fact into a daily log claiming "PID 99999 is the mesh-receiver." The current PID is 4169961.
**Run:** the cron turn's verification logic.
**Assert:** the fact is rewritten as `stale: PID 99999 not running (ps returns no row); current is PID 4169961`.

### TC-2: Partial fact gets `partial` flag

**Setup:** Insert a fact claiming "gh CLI can open PRs."
**Run:** the verification logic.
**Assert:** the fact is rewritten as `partial: gh pr create returns 403 (liz-kosfootel-token lacks pull_requests:write); curl with liz-better-machine-token returns 200 (PR #24 opened this way)`.

### TC-3: Resolved item moves to Resolved section

**Setup:** Insert a fact in yesterday's log as "unknown agent unresolved." The 11 "unknown" facts have been removed from the pool.
**Run:** the verification logic.
**Assert:** the fact is rewritten as `Resolved: 11 'unknown' facts identified as lossless-claw test entries from 2026-06-13; pool now has 0 such facts`.

### TC-4: Unverifiable fact gets `unverifiable` flag

**Setup:** Insert a fact claiming "the Mac Studio is reachable at 100.101.203.97:8080."
**Run:** the verification logic.
**Assert:** the fact is rewritten as `unverifiable: 100.101.203.97 not in Tailscale ACL for Liz; cannot reach from Liz`.

### TC-5: Recency window is respected

**Setup:** the today daily file (`memory/2026-07-25.md`) does not exist. Yesterday's file (`memory/2026-07-24.md`) does.
**Run:** the cron turn.
**Assert:** the staging file's `## Source Coverage` section states `Today daily: not-yet-created`. Any fact sourced from yesterday's file is marked `(source: yesterday)`.

### TC-6: Confirmation message includes verification summary

**Setup:** the staging file has 7 ok, 1 stale, 0 partial, 0 unverifiable.
**Run:** the cron turn.
**Assert:** the Telegram message is `Dream staging 2026-07-25 done (7 ok, 1 stale, 0 partial, 0 unverifiable). Stale: F-02 mesh PID. See staging file.`

### TC-7: No-entries path still works

**Setup:** the dream-cycle.mjs writes a no-entries marker.
**Run:** the cron turn.
**Assert:** the cron exits silently. No Telegram message is sent. (PR #23 FR-4.1 preserved.)

### TC-8: Existing regression tests still pass

**Setup:** none.
**Run:** `node --test tests/dream-cycle-v2-rebuild.test.mjs tests/dream-cycle.test.mjs tests/shared-pool.test.mjs tests/receiver-get-shared-pool.test.mjs tests/token-lifecycle.test.mjs tests/critical-facts-loader.test.mjs`.
**Assert:** all tests pass.

### TC-9: F-02 from the 2026-07-25 staging file is rewritten

**Setup:** today's staging file is regenerated using the new logic.
**Run:** the cron turn with a fresh `memory/2026-07-25.md` that doesn't exist (cron-time scenario).
**Assert:** the rewritten F-02 says `stale: PID 7332 not running (last seen 2026-07-24 18:30 EDT, killed during Phase 2.4); current is PID 4169961 (systemd v0.2 receiver)`.

### TC-10: The cron instruction update is itself a change

**Setup:** the new cron instruction is a multi-step procedure that includes verification.
**Run:** `openclaw cron get 169f92fa-1b75-4d28-9c43-d257bc42a7c8`.
**Assert:** the `payload.message` is the new procedure. The 600s timeout is unchanged. The schedule is unchanged.

### TC-11: The new staging file passes review

**Setup:** the staging file is generated by the new logic on a future date (use a phantom date for the test).
**Run:** Liz (in main session) reads the staging file.
**Assert:** every fact has a verification result. No Tier 1 fact is `stale`, `partial`, or `unverifiable`. The Resolved section has any items that became resolved.

---

## 8. Out-of-Scope (Phase 3+)

- **Phase 3:** Add a `verification_history.json` that records every verification command + result. The reviewer can replay verifications to see how a fact's state has changed over time.
- **Phase 3:** Add a "pre-merge" gate to the agent-liz repo: staging files with any `stale` or `unverifiable` facts in Tier 1 are blocked from auto-merge.
- **Phase 3:** Apply the same pattern to `memory-consolidation` (cron job `20a0897e-16f0-4b6d-8bb2-5cb316099f39`).
- **Phase 3:** Apply the same pattern to `daily-fleet-report-liz` (cron job `71127ae7-28a7-44a6-85b5-e43403a719d3`).
- **Phase 4:** Replace the isolated cron turn with a forked session that inherits the main session's context. Eliminates the "no live state" problem structurally.

---

## 9. Risks

- **R1:** A verification command takes too long (>10s) and the cron times out. Mitigation: bound each verification command with `timeout 3` or `-m 3`. If a verification fails, the fact is marked `unverifiable` not `failed`.
- **R2:** The verification library doesn't cover a fact type the cron encounters. Mitigation: when the agent cannot find a verification command, it marks the fact `unverifiable` with a one-line explanation. The fact is NOT promoted to Tier 1.
- **R3:** The cron turn's instruction becomes too long (>4096 chars), exceeding payload limits. Mitigation: keep the instruction focused on procedure, not data. The fact content comes from the dream-cycle output and the daily log, not from the instruction.
- **R4:** The change to the cron instruction breaks the existing cron behavior (silent exit, one-line message, etc.). Mitigation: TC-7 and TC-8 explicitly test for regression. Apply the change via `openclaw cron update` and verify the next scheduled run.

---

## 10. Open Questions for Erik

- **OQ1:** Is the verification library's fact type coverage (FR-1) sufficient? Specifically: should the cron verify *every* fact, or only facts that reference a specific system (daemon, process, file, API, cron job, git branch)? My recommendation: every fact, because the staging file is the path of least resistance into MEMORY.md.
- **OQ2:** Should `partial` facts be allowed in Tier 1 (with the partial nature stated), or must they be moved to Tier 2? My recommendation: `partial` facts go to Tier 2. The merge to MEMORY.md is for clean facts; partial facts need human judgment.
- **OQ3:** Should the cron turn also be responsible for *resolving* stale facts (e.g., updating MEMORY.md to remove the dead PID 7332 reference)? My recommendation: no. The cron turn writes the staging file; Liz (main session) reads it and updates MEMORY.md. This keeps the cron turn's responsibility narrow.

---

**End of requirements. Tests will be written to `tests/dream-cycle-accuracy.test.mjs` before any code changes.**

**Co-Authored-By:** openhands <openhands@all-hands.dev>
