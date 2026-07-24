# Requirements — Dream-Cycle v2 Rebuild (A+B Effort)

**Date:** 2026-07-24
**Author:** Liz (Kosfootel/agent-liz)
**Supersedes:** `dream-cycle-diagnosis-2026-07-01.md` (diagnosis was correct in spirit; this doc supersedes with verified current state and concrete plan)
**Triggers:** Erik directive 2026-07-24 — "real fix please" for the dream-cycle cron noise

---

## 1. Problem Statement

The nightly dream-cycle cron (`dream-staging-nightly`, schedule `20 2 * * *`) has been producing empty output for 24+ days. Each run, the agent in the cron turn sends a visible "No dream cycle output produced" message to Erik's Telegram. This is noise, not signal — and worse, it's masking a real architectural drift: the script's two read sources have both gone silent, and the script was never updated to handle the new reality.

### 1.1 Root Cause (verified 2026-07-24)

| Source | Last activity | Status now | Verdict |
|---|---|---|---|
| `memory/mesh/` directory | 2026-04-03 | Does not exist | Planned obsolete after mesh-memory v1→v2 |
| `memory/lcm/` directory | 2026-06-10 | Does not exist | LCM daily writer was removed in a refactor |
| Mesh daemon `:18805` | July 1 diagnosis said "live" | HTTP 000 (unreachable) | **Died between July 1 and today** |
| `memory/.dreams/short-term-recall.json` | July 1 diagnosis said "live" | Does not exist | **Died too** |
| `memory/YYYY-MM-DD.md` daily logs | 2026-07-24 (today) | Live, actively written | **The only working source** |

### 1.2 Bonus Finding (verified 2026-07-24)

Commit `12117497eb` "fix(dream-cycle): Option A migration (mesh API + daily logs)" exists on branch `v2-rebuild`, authored by Kosfootel 2026-07-14, approved by Erik. **It was never merged to `main`.** The on-disk `dream-cycle.mjs` still has the original `MESH_DIR = memory/mesh` and `LCM_DIR = memory/lcm` constants. The migration was effectively lost.

---

## 2. Goals (in priority order)

| # | Goal | Why |
|---|---|---|
| G1 | Stop the cron noise (no more "no entries" messages to Erik) | Noise erodes trust in the cron signal |
| G2 | Get dream-cycle reading from a real, live source (daily logs) | Without input, the consolidation has no value |
| G3 | Preserve the v2-rebuild mesh-fetch code as future-proofing | Costs nothing (try/catch warn), enables revival if daemon returns |
| G4 | Cherry-pick the v2-rebuild migration so the work isn't lost twice | Don't fork knowledge |
| G5 | Hand off to Eames for post-deployment review (gates + audit) | Per Erik directive 2026-07-24 |

---

## 3. Non-Goals (explicitly out of scope)

- **NG1:** Restoring `memory/mesh/*.md` as a write target. Planned obsolete.
- **NG2:** Re-enabling the LCM v1 daily writer. Daily logs cover the use case.
- **NG3:** Triaging why the mesh daemon `:18805` died. **This is the B-effort** (filed as separate project, `inbox/` or `projects/daemon-triage/`).
- **NG4:** Changing the cron schedule (still `20 2 * * *` EDT).
- **NG5:** Adding inference (the script builds a prompt, doesn't call a model — that's the agent's job in the cron turn).
- **NG6:** Changing the dream-cycle output format (still `dream-cycle-YYYY-MM-DD.md` in `memory/`).

---

## 4. Functional Requirements

### 4.1 FR-1: Script reads from daily logs

**FR-1.1:** When `dream-cycle.mjs` runs, it MUST read markdown files from `memory/` matching today's date and yesterday's date (in local time, EDT), where the filename pattern is `YYYY-MM-DD.md`.

**FR-1.2:** If the `memory/mesh/` directory is referenced in any path, the script MUST treat it as a soft-fail (warn, return empty, continue) — never hard-fail.

**FR-1.3:** The script MUST NOT crash on missing directories, missing files, or empty inputs.

### 4.2 FR-2: Script attempts mesh fetch (future-proofing)

**FR-2.1:** The script MUST attempt to fetch from `http://127.0.0.1:18805/mesh/shared-pool` (preserved from the v2-rebuild migration).

**FR-2.2:** If the fetch fails (network error, non-2xx, malformed JSON, or empty `facts` array), the script MUST:
- Log a single warning to stderr
- Return an empty array from `fetchMeshFacts()`
- NOT halt the cycle

**FR-2.3:** The fetch MUST have a 3-second timeout (don't hang the cron).

### 4.3 FR-3: Script writes a suggestions file

**FR-3.1:** If both sources return empty (no daily logs, no mesh facts), the script MUST:
- Exit cleanly with code 0
- Write a `dream-cycle-YYYY-MM-DD.md` file with a `# Dream Cycle — No Entries` header and a "No recent mesh or LCM entries found" body

**FR-3.2:** If either source has content, the script MUST write `memory/dream-cycle-YYYY-MM-DD.md` with a `# Dream Cycle — Manual Review Required` header and the formatted source content + instructions.

**FR-3.3:** The output file path MUST be `memory/dream-cycle-YYYY-MM-DD.md` (preserved).

### 4.4 FR-4: Cron payload no longer produces noise

**FR-4.1:** The cron payload (cron job `dream-staging-nightly`, ID `169f92fa-1b75-4d28-9c43-d257bc42a7c8`) MUST be updated so that when the dream-cycle output is `# Dream Cycle — No Entries`, the agent in the cron turn does NOT send any visible message to Erik's Telegram.

**FR-4.2:** When the staging file is written successfully (regardless of whether it has content), the agent MUST send a brief, one-line confirmation — no more, no less.

**FR-4.3:** When the staging file write fails (any error), the agent MUST send a single concise error message.

### 4.5 FR-5: Hand off to Eames for review

**FR-5.1:** A PR MUST be opened against `main` with branch name `eames/liz-dream-cycle-v2-rebuild`.

**FR-5.2:** The PR description MUST include:
- Link to this REQUIREMENTS doc
- Link to TEST_CASES doc
- Link to the daemon-triage project (for B)
- "Handoff to Eames" note explicitly

**FR-5.3:** The PR MUST NOT be self-merged. Erik's standing rule: Eames does not merge, human does.

---

## 5. Non-Functional Requirements

### 5.1 NFR-1: Backward compatibility

- The script's stdout/stderr format MUST remain parseable by the existing cron payload (which pipes through `tail -10`).
- The script MUST NOT add new required CLI args.

### 5.2 NFR-2: Test coverage

- A new test file `tests/dream-cycle-v2.test.mjs` MUST be added.
- The test file MUST cover: FR-1 (daily log reading), FR-2 (mesh fetch warn behavior), FR-3 (no-entries output), FR-4 (cron payload changes — via static check).
- All tests MUST pass on both Liz and GX-10 (per the Eames standing rule: tests run on the target host).

### 5.3 NFR-3: No new dependencies

- The script MUST NOT add any npm dependencies.
- It MUST use only Node.js built-ins (`node:fs/promises`, `node:path`, `node:os`).

### 5.4 NFR-4: Idempotence

- Running the script multiple times in one day MUST NOT corrupt or duplicate output.
- The output filename includes the date, so re-runs overwrite — that's the idempotence contract.

---

## 6. Acceptance Criteria

A reviewer (Eames persona) should be able to verify each of these by reading the diff or running the test suite:

| # | Criterion | How to verify |
|---|---|---|
| AC-1 | `MESH_DIR` and `LCM_DIR` constants in `dream-cycle.mjs` are removed | `grep -n "MESH_DIR\|LCM_DIR" dream-cycle.mjs` returns nothing |
| AC-2 | `fetchMeshFacts()` function exists, has 3s timeout, returns `[]` on failure | `grep -A 20 "fetchMeshFacts" dream-cycle.mjs` shows try/catch + AbortController |
| AC-3 | Daily log reading uses today's + yesterday's date, EDT local time | `grep -A 5 "toLocaleDateString" dream-cycle.mjs` shows the date logic |
| AC-4 | Empty input writes `# Dream Cycle — No Entries` and exits 0 | Test `dream-cycle-v2.test.mjs#test_no_entries_output` |
| AC-5 | Mesh fetch timeout is 3 seconds | Test `dream-cycle-v2.test.mjs#test_mesh_fetch_timeout` |
| AC-6 | Mesh fetch failure (HTTP 000) returns `[]` and warns | Test `dream-cycle-v2.test.mjs#test_mesh_fetch_failure` |
| AC-7 | Daily log reading pulls only today's + yesterday's files | Test `dream-cycle-v2.test.mjs#test_daily_log_filter` |
| AC-8 | Cron payload updated: no-entries path produces no Telegram message | Static check on cron payload text |
| AC-9 | All tests in `tests/dream-cycle-v2.test.mjs` pass on Liz AND GX-10 | `npm test` exits 0 on both |
| AC-10 | PR opened against `main` with required description contents | PR link + body review |

---

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| v2-rebuild branch has diverged from main in other files | Low | Cherry-pick conflict | Run `git log v2-rebuild -- dream-cycle.mjs` — confirm only 1 commit since 12117497eb |
| Mesh fetch adds latency to cron run | Low | Cron exceeds timeout | 3s timeout + try/catch = bounded |
| Test on Liz passes but GX-10 fails | Medium | False confidence in deploy | Eames rule: always run tests on target host. We will. |
| Cron payload text changes break the agent's flow | Low | Cron still noisy | Static check on payload before deploy |
| I forget the B-effort (daemon triage) | Medium | Silent drift | Filing project at top of inbox/ + HEARTBEAT.md note |

---

## 8. Open Questions for Erik

None — Erik has given the green light and asked for execution + Eames hand-off. Defer decisions to Eames review or future resync.

---

## 9. References

- `dream-cycle-diagnosis-2026-07-01.md` — original diagnosis (correct in spirit, drifted in specifics)
- Commit `12117497eb` on `v2-rebuild` — the migration commit
- `memory/incidents/` — incident-pattern reference (per §16/§22/§23 lessons)
- `memory/2026-07-22.md` — note about Option A mention
- `tests/a2a-integration.test.mjs` — test pattern reference
- `run-tests-reliable.sh` — fleet-wide test runner
- Cron job: `dream-staging-nightly` (`169f92fa-1b75-4d28-9c43-d257bc42a7c8`)
