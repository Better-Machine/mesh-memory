# Test Cases — Dream-Cycle v2 Rebuild

**Companion to:** `REQUIREMENTS-dream-cycle-v2-rebuild.md`
**Test file:** `tests/dream-cycle-v2.test.mjs`
**Runner:** `node --test tests/dream-cycle-v2.test.mjs`
**CI:** `npm test` (which includes this file)

---

## Test Case Index

| ID | Requirement | Test name | Type |
|---|---|---|---|
| TC-01 | FR-1.1, AC-7 | `reads_today_and_yesterday_daily_logs` | Unit |
| TC-02 | FR-1.1 | `ignores_files_outside_date_window` | Unit |
| TC-03 | FR-1.1 | `ignores_non_markdown_files_in_window` | Unit |
| TC-04 | FR-1.2, FR-1.3, AC-1 | `does_not_crash_on_missing_mesh_dir` | Unit |
| TC-05 | FR-2.1, AC-2 | `fetchMeshFacts_calls_mesh_daemon` | Unit |
| TC-06 | FR-2.2, FR-2.3, AC-5, AC-6 | `fetchMeshFacts_returns_empty_on_timeout` | Unit |
| TC-07 | FR-2.2, AC-6 | `fetchMeshFacts_returns_empty_on_404` | Unit |
| TC-08 | FR-2.2 | `fetchMeshFacts_returns_empty_on_malformed_json` | Unit |
| TC-09 | FR-2.2 | `fetchMeshFacts_returns_empty_on_empty_facts_array` | Unit |
| TC-10 | FR-2.2 | `fetchMeshFacts_warns_on_failure` | Unit (stderr capture) |
| TC-11 | FR-3.1, AC-4 | `no_entries_writes_no_entries_file` | Integration |
| TC-12 | FR-3.2 | `with_content_writes_full_file` | Integration |
| TC-13 | FR-3.3 | `output_path_uses_today_date` | Unit |
| TC-14 | NFR-4 | `reruns_overwrite_output_idempotently` | Integration |
| TC-15 | NFR-3 | `script_imports_no_npm_packages` | Static |
| TC-16 | FR-4.1, AC-8 | `cron_payload_no_entries_path_no_telegram_message` | Static |
| TC-17 | FR-4.1 | `cron_payload_success_path_short_message` | Static |
| TC-18 | FR-4.3 | `cron_payload_failure_path_error_message` | Static |
| TC-19 | AC-9 | `test_suite_passes_on_target_host` | Manual gate |

---

## Test Details

### TC-01: `reads_today_and_yesterday_daily_logs`

**Verifies:** FR-1.1, AC-7

**Setup:**
- Create temp dir `tests/.tmp-tc01/`
- Write `tests/.tmp-tc01/2026-07-24.md` with content "today's log"
- Write `tests/.tmp-tc01/2026-07-23.md` with content "yesterday's log"
- Write `tests/.tmp-tc01/2026-07-22.md` with content "should be ignored (2 days ago)"
- Mock `Date.now()` to return 2026-07-24 12:00 local

**Action:** Call `readRecentFiles(TC01_DIR)` with `MEMORY_BASE` overridden to `tests/.tmp-tc01/`

**Expected:**
- Returned array has exactly 2 entries
- Contains "today's log" and "yesterday's log"
- Does NOT contain "should be ignored"

**Cleanup:** `rm -rf tests/.tmp-tc01/`

---

### TC-02: `ignores_files_outside_date_window`

**Verifies:** FR-1.1

**Setup:**
- Create temp dir
- Write `2026-07-22.md` (2 days ago)
- Write `2026-07-25.md` (1 day in future — should be ignored; we only look back)

**Action:** Call `readRecentFiles()` with mocked today = 2026-07-24

**Expected:** Empty array

---

### TC-03: `ignores_non_markdown_files_in_window`

**Verifies:** FR-1.1

**Setup:**
- Temp dir with `2026-07-24.md` (valid)
- Same dir with `2026-07-24.txt` (wrong ext)
- Same dir with `2026-07-24.json` (wrong ext)

**Action:** Call `readRecentFiles()`

**Expected:** Only the `.md` file is read; `.txt` and `.json` are skipped

---

### TC-04: `does_not_crash_on_missing_mesh_dir`

**Verifies:** FR-1.2, FR-1.3, AC-1

**Setup:** No special setup. Just call the script with a non-existent `MEMORY_BASE`.

**Action:** Run `node dream-cycle.mjs` against a temp dir that has no `memory/mesh/` subdir.

**Expected:** Exit code 0. No throw. Empty array returned for mesh contents.

**Regression guard:** Ensures we never reintroduce `MESH_DIR = resolve(MEMORY_BASE, "mesh")` as a hard path. If someone re-adds it, the script will crash here.

---

### TC-05: `fetchMeshFacts_calls_mesh_daemon`

**Verifies:** FR-2.1, AC-2

**Setup:**
- Mock `fetch()` to expect a call to `http://127.0.0.1:18805/mesh/shared-pool`
- Mock returns `{ ok: true, json: async () => ({ facts: [{ id: 1, agent_id: "liz", content: "test" }] }) }`

**Action:** Call `fetchMeshFacts()`

**Expected:**
- Returned array has 1 element: `### Mesh [1] liz\n\ntest`
- `fetch` was called with the correct URL

---

### TC-06: `fetchMeshFacts_returns_empty_on_timeout`

**Verifies:** FR-2.2, FR-2.3, AC-5, AC-6

**Setup:**
- Mock `fetch()` to hang (never resolve)
- Test must complete in < 4 seconds (3s timeout + 1s buffer)

**Action:** Call `fetchMeshFacts()` with a 3500ms test timeout

**Expected:**
- Returned array is `[]`
- Stderr contains a warning about mesh timeout
- Test completes in < 4 seconds (proves 3s timeout is enforced)

---

### TC-07: `fetchMeshFacts_returns_empty_on_404`

**Verifies:** FR-2.2, AC-6

**Setup:** Mock `fetch()` to return `{ ok: false, status: 404 }`

**Action:** Call `fetchMeshFacts()`

**Expected:** Returns `[]`. Stderr warns.

---

### TC-08: `fetchMeshFacts_returns_empty_on_malformed_json`

**Verifies:** FR-2.2

**Setup:** Mock `fetch()` to return `{ ok: true, json: async () => { throw new Error("bad json") } }`

**Action:** Call `fetchMeshFacts()`

**Expected:** Returns `[]`. Stderr warns. No throw bubbles up.

---

### TC-09: `fetchMeshFacts_returns_empty_on_empty_facts_array`

**Verifies:** FR-2.2

**Setup:** Mock `fetch()` to return `{ ok: true, json: async () => ({ facts: [] }) }`

**Action:** Call `fetchMeshFacts()`

**Expected:** Returns `[]`. No warning (this is a successful empty response, not a failure).

---

### TC-10: `fetchMeshFacts_warns_on_failure`

**Verifies:** FR-2.2

**Setup:** Mock `fetch()` to throw `TypeError("fetch failed")`

**Action:** Call `fetchMeshFacts()`. Capture stderr.

**Expected:**
- Returns `[]`
- stderr contains a line starting with `[dream] mesh:`

---

### TC-11: `no_entries_writes_no_entries_file`

**Verifies:** FR-3.1, AC-4

**Setup:**
- Temp `memory/` dir with no files in date window
- Mock fetch to return empty
- Mock `MEMORY_BASE` to temp dir

**Action:** Run the script (or call `main()` directly)

**Expected:**
- Exit code 0
- File `memory/dream-cycle-2026-07-24.md` exists
- File starts with `# Dream Cycle — No Entries`
- File contains "No recent mesh or LCM entries found"

---

### TC-12: `with_content_writes_full_file`

**Verifies:** FR-3.2

**Setup:**
- Temp `memory/` with `2026-07-24.md` containing "test content"
- Mock fetch to return 1 fact

**Action:** Run the script

**Expected:**
- File `memory/dream-cycle-2026-07-24.md` exists
- File contains "Manual Review Required"
- File contains the daily log content
- File contains the mesh fact formatted as `### Mesh [...]`

---

### TC-13: `output_path_uses_today_date`

**Verifies:** FR-3.3

**Setup:** Mock Date to 2026-07-24

**Action:** Capture the output path from `main()`

**Expected:** Path matches `memory/dream-cycle-2026-07-24.md`

---

### TC-14: `reruns_overwrite_output_idempotently`

**Verifies:** NFR-4

**Setup:** Existing `memory/dream-cycle-2026-07-24.md` with old content

**Action:** Run main() twice

**Expected:** After 2nd run, file content is from the 2nd run, not concatenated. Same file path.

---

### TC-15: `script_imports_no_npm_packages`

**Verifies:** NFR-3

**Action:** `grep -E "from ['\"](?!node:)[^'\"]+['\"]|^import .* from ['\"][^'\"]+['\"]" dream-cycle.mjs`

**Expected:** Zero matches (only `node:fs/promises`, `node:path`, `node:os`, `./config.mjs` should be present)

---

### TC-16: `cron_payload_no_entries_path_no_telegram_message`

**Verifies:** FR-4.1, AC-8

**Setup:** Read the cron job payload from `openclaw cron get 169f92fa-1b75-4d28-9c43-d257bc42a7c8`

**Action:** Static check: the payload's `message` field MUST include a guard like:
- "If the dream-cycle output is `# Dream Cycle — No Entries`, do not send any Telegram message"
- Or equivalent: explicit instruction to skip announce when no entries

**Expected:** The phrase "No Entries" appears in the payload, paired with "do not send" or "skip" or "no message"

---

### TC-17: `cron_payload_success_path_short_message`

**Verifies:** FR-4.2

**Setup:** Same payload as TC-16

**Action:** Static check: payload MUST include "brief" or "one-line" or "short" for the success message

**Expected:** Such word is present in the success-path instructions

---

### TC-18: `cron_payload_failure_path_error_message`

**Verifies:** FR-4.3

**Setup:** Same payload

**Action:** Static check: payload MUST include "if the staging file write fails" or equivalent error path

**Expected:** Failure handling instructions are present

---

### TC-19: `test_suite_passes_on_target_host` (manual gate)

**Verifies:** AC-9

**Setup:** None

**Action:** Run `npm test` on Liz. Then SCP the repo to GX-10 and run `npm test` there. (Or run on GX-10's existing clone if present.)

**Expected:** Both hosts return exit code 0 with all tests passing.

**Documented in:** PR description + Eames audit notes.

---

## Notes for Implementer

1. **Mocking `fetch`:** Use Node's `node:test` test context with `t.mock.method(globalThis, 'fetch', ...)`. Or import `fetch` from a wrapper module for cleaner mocking. Either is fine; pick what fits the existing test style in the repo.

2. **Mocking `Date`:** Use `t.mock.timers.enable()` and `t.mock.timers.setTime(...)` if available. Or just call internal functions with explicit date params if we refactor `readRecentFiles` to accept a date arg (cleaner).

3. **Temp dir cleanup:** Every test that creates temp dirs MUST clean up in a `finally` block. The existing tests in this repo follow this pattern (see `tests/a2a-integration.test.mjs`).

4. **No test that depends on a real mesh daemon.** Every mesh test MUST mock `fetch`. If the daemon is up at test time, the test would still pass, but we don't want flakes.

5. **The "no-entries" output format is a contract.** Changing it is a breaking change. TC-11 enforces the exact header text.

6. **Static checks (TC-15, TC-16, TC-17, TC-18) are run by the test suite**, not by hand. They use `readFileSync` to inspect the source files at test time.
