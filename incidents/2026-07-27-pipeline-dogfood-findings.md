# Eames v0.3.1 Pipeline Dogfood: memory_search Store Corruption Spec (2026-07-27)

## TL;DR

Filed the first **environment defect** through the Eames pipeline.
The pipeline worked — every component ran, Eames produced 4 audit
findings, the spec-fixer subagent dispatched, but the rework path
crashed on a real input-validation bug. The defect itself was not
fixed; the pipeline surfaced 2 distinct real gaps that need
Eames-Phase-2 work before env-defects can flow through cleanly.

## Spec Filed

- **Name:** `2026-07-27-memory-search-store-corruption-repair`
- **Type:** Environment defect (no code PR; DDL operation on a database)
- **Owner:** `liz` (self-attest)
- **Persona:** `code-reviewer` (only persona staged on GX-10)
- **Path:** `projects/mesh-memory/incidents/2026-07-27-memory-search-store-corruption.md`
- **Verify script:** `projects/mesh-memory/verify-memory-search-repair.sh`

## Pipeline State (final)

| Stage | Result |
|-------|--------|
| watcher | READY (5/5 BMHS sections present, fleet-kb posted) |
| dispatcher | PROPOSED, owner=liz, persona=code-reviewer |
| dispatch-gate | ELIGIBLE 7/7 |
| owner-attest | PASS 5/5 (phantom fixture) |
| eames-audit | 3 FAIL + 1 WARN (see findings) |
| pr-gate | DISPUTE (FAIL ≥ 1) |
| spec-fixer subagent | CRASHED — input validation bug |
| rework | stuck on subagent error |
| telegram | not dispatched (DISPUTE held in pipeline) |

## Eames Audit Findings (real)

1. **`diff.grounds_in_spec: FAIL`** — diff is empty, no changes to review
2. **`test.evidence: FAIL`** — no diff to inspect for tests
3. **`eames.audit: FAIL`** — Cannot verify compliance with stated
   constraints (lcm.db untouched, chunks_fts scope, chunks_vec left
   alone) without actual code modifications
4. **`author.metadata: WARN`** — branch `(none)` doesn't match
   fleet-maint/, feat/, liz/, or ray/ prefix

**Audit verdict:** Eames persona (qwen3.6-35b-eames) generated
specific reasoning: "Without actual modifications, it is impossible
to verify compliance with critical boundaries such as avoiding
`lcm.db`, preserving the `chunks` table, or restricting operations
to `chunks_fts` only." This is the correct adversarial review
behavior — the audit can't pass without artifacts.

**The findings are correct, not noise.** The orchestrator runs in
the parent workspace (`/home/erik-ross/.openclaw/workspace`,
`Kosfootel/better-machine` repo). The defect artifacts are inside
the `projects/mesh-memory/` **submodule**. From the parent repo's
perspective, there is no diff. The pipeline correctly reports this.

## Spec-Fixer Bug Discovered

```
exit code 1: Invalid input: rework-input: owner_verdict.producer is required (string)
```

The orchestrator (`projects/eames/orchestrator/orchestrator.mjs`)
writes a `rework-input.json` for spec-fixer. The spec-fixer validates
this against `validateInput()` in `protocol.mjs`, which requires
`owner_verdict.producer`. But the orchestrator's `owner_verdict` is
read from the owner-verdict file, and **the field is not being
populated correctly** in this env-defect flow.

**This is a real Eames Phase 2 finding:** the rework subagent
contract requires an owner-verdict with `producer` field, but the
orchestrator's assembled input is missing it (or the assembly path
fails for env defects where `producer` flows differently than for
code PRs).

## Why the Diff Is Empty (root cause)

Three layered reasons, all surfacing as the same symptom:

1. **WORK_REPO default:** `process.env.WORK_REPO || '/home/erik-ross/.openclaw/workspace'`
   — points at the parent repo, not the mesh-memory submodule.
2. **Submodule isolation:** Files inside `projects/mesh-memory/` are
   tracked by a separate git repo (`Better-Machine/mesh-memory`). The
   parent repo only tracks the submodule pointer.
3. **Branch default:** Orchestrator falls back to
   `branch: 'liz/mobile-investigation'` when dispatch.json doesn't
   specify one. My commit was on `liz/2026-07-27-memory-search-store-corruption-repair`
   in the submodule — never visible to the parent.

## Pipeline Gaps Identified (for Eames Phase 2)

### Gap 1: Submodule path support
Orchestrator's diff fetcher runs in WORK_REPO. When `Path:` points
into a submodule, it should detect and recurse (cd into the submodule,
diff there). **Currently no support.**

### Gap 2: Environment defect support
Specs that don't produce a code diff (DDL, config-only, pure
infrastructure) hit a wall at `diff.grounds_in_spec`. Eames-Phase-2
should add a separate path for env-defects: spec itself IS the
artifact, audit reviews the proposed plan, eames-verdict marks
"environment/no-diff-expected" provenance.

### Gap 3: Branch context propagation
`dispatch_spec.mjs` doesn't emit `branch` in the dispatch.json.
Orchestrator default is `liz/mobile-investigation` (a stale default
from 2026-07-19). For env defects, `branch: '(none)'` should be
valid if the env-defect has no branch.

### Gap 4: Rework input contract mismatch
The spec-fixer input validation requires `owner_verdict.producer`
but the orchestrator's assembly path may be missing it. This is a
real bug that surfaces on first env-defect flow.

## What Was Achieved

- **First environment defect successfully filed through Eames pipeline**
  (spec READY → dispatched → gates passed → owner attest → Eames audit → pr-gate DISPUTE)
- **Real audit findings produced** — adversarial persona correctly
  identified missing artifacts as blockers
- **Real bug surfaced in spec-fixer input contract** — not noise, will
  bite the next env defect
- **Verification script improved** — now checks 5 things (DB-level 1, 2,
  multi-word phrase bonus) and self-tests pre-fix state (exits non-zero,
  reports exact failures)
- **Lock contention handling documented** — 5s `busy_timeout` PRAGMA,
  fallback to retry at next heartbeat
- **Verified on Liz (broken state):** verify.sh runs, fails 4 checks
  with exact error messages, confirming the defect and the verification

## What Was NOT Achieved

- **The defect was not fixed.** The 3-statement DDL on
  `main.sqlite` was not executed. Need Erik's approval to:
  - stop gateway
  - execute fix (DROP/CREATE/INSERT)
  - verify with `verify.sh`
  - restart gateway
  - probe `memory_search` tool with checks 3 and 4

## Recommendation for Next Steps

1. **Erik: approve the fix execution** (3 statements, 5 seconds,
   reversible from backup, lock contention handled)
2. **Eames Phase 2:** add env-defect path and submodule diff support
   (filed as separate spec, separate audit/rework flow)
3. **Eames Phase 2:** fix the spec-fixer input contract bug
   (`owner_verdict.producer` not being populated in env-defect flow)

## Files

- `projects/mesh-memory/incidents/2026-07-27-memory-search-store-corruption.md`
- `projects/mesh-memory/verify-memory-search-repair.sh`
- `inbox/2026-07-27-memory-search-store-corruption-repair.md`
- `inbox/2026-07-27-memory-search-store-corruption-repair.verify.sh`
- Branch `liz/2026-07-27-memory-search-store-corruption-repair` (commit 55e288ce)
- GX-10 processed artifacts in `.processed/2026-07-27-memory-search-store-corruption-repair.*`

## Open Questions

- Should Eames v0.3.1 widen to env-defects now, or stay PR-only and
  handle env defects manually?
- Is `projects/mesh-memory/` the right scope for the spec, or should
  it live at the workspace root since the work happens on main.sqlite
  (which lives at `/home/erik-ross/.openclaw/memory/main.sqlite`)?
- For now, the spec stays REWORK — Erik's call on the 4 pipeline gaps
  before fixing the actual database corruption.
