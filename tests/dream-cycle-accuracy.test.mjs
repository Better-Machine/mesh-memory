/**
 * @module dream-cycle-accuracy.test
 * @description Behavioral tests for Phase 2.5 — the dream-cycle accuracy fix.
 *
 * Companion to REQUIREMENTS-dream-cycle-accuracy.md.
 *
 * The accuracy fix moves fact verification from a text-only synthesis
 * (Stage 2 of PR #23) to a deterministic verification step. The verification
 * produces facts with explicit verification results: ok, partial, stale,
 * unverifiable, or resolved.
 *
 * The tests below verify that the verification+staging module:
 *   - Detects stale facts (TC-1)
 *   - Detects partial facts (TC-2)
 *   - Detects resolved items (TC-3)
 *   - Detects unverifiable facts (TC-4)
 *   - Respects the recency window (TC-5)
 *   - Produces a confirmation message with a verification summary (TC-6)
 *   - Preserves the no-entries silent-exit contract (TC-7)
 *   - Preserves the existing regression suite (TC-8, see other test files)
 *   - Rewrites F-02 from the 2026-07-25 staging file (TC-9)
 *   - Encodes the new cron instruction (TC-10)
 *   - Produces a staging file that passes review (TC-11)
 *
 * Tests are written BEFORE implementation. The test file imports the module
 * to be implemented (lib/dream-cycle-accuracy.mjs). If the module doesn't
 * exist, all tests will fail with MODULE_NOT_FOUND. This is the red baseline.
 *
 * Module API (contract, TBD until implementation):
 *
 *   import { buildStagingFile, verifyFact, runVerification } from "./lib/dream-cycle-accuracy.mjs";
 *
 *   buildStagingFile({
 *     todayLog: string | null,           // content of memory/YYYY-MM-DD.md, or null if not created
 *     yesterdayLog: string | null,       // content of memory/YYYY-MM-DD-1.md, or null if not created
 *     dreamCycleOutput: string,          // content of memory/dream-cycle-YYYY-MM-DD.md
 *     meshFacts: Array<{id, agent_id, content, source: string}>, // from /mesh/shared-pool
 *     date: string,                      // YYYY-MM-DD
 *   }) => {
 *     sourceCoverage: {...},
 *     tier1Facts: Array<{id, summary, body, verification}>,
 *     tier2Observations: Array<{id, summary, body, verification}>,
 *     resolved: Array<{id, summary, body, resolvedAt}>,
 *     contradictions: Array<{id, description, resolution}>,
 *     summary: { ok, stale, partial, unverifiable, resolved }
 *   }
 *
 *   verifyFact({type, claim, ...}, liveSystem) => {
 *     status: "ok" | "partial" | "stale" | "unverifiable",
 *     verification: {command, result, timestamp},
 *     correctedBody?: string
 *   }
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

let accuracyModule;
try {
  accuracyModule = await import("../lib/dream-cycle-accuracy.mjs");
} catch (e) {
  // Module doesn't exist yet. Tests will fail with a clear message below.
  accuracyModule = null;
}

// ============================================================
// TC-1: Stale fact gets `stale` flag
// ============================================================
describe("TC-1: stale fact detection", () => {
  it("marks a fact as stale when the live system contradicts it", async () => {
    if (!accuracyModule) {
      assert.fail("lib/dream-cycle-accuracy.mjs not yet implemented. Write the module first.");
    }
    const result = await accuracyModule.verifyFact({
      type: "process",
      claim: "PID 99999 is the mesh-receiver",
      verification: { command: "ps -p 99999" },
    }, { liveSystem: {} });
    assert.equal(result.status, "stale", `expected stale, got ${result.status}`);
    // The correction should mention PID 99999 is not running (case-insensitive
    // substring check; the message includes punctuation)
    assert.match(result.correction, /PID 99999/i);
    assert.match(result.correction, /not running/i);
  });
});

// ============================================================
// TC-2: Partial fact gets `partial` flag
// ============================================================
describe("TC-2: partial fact detection", () => {
  it("marks a fact as partial when the claim has both true and false parts", async () => {
    if (!accuracyModule) {
      assert.fail("lib/dream-cycle-accuracy.mjs not yet implemented. Write the module first.");
    }
    const result = await accuracyModule.verifyFact({
      type: "gh_cli_pr_creation",
      claim: "gh CLI can open PRs",
      verification: {
        commands: [
          { cmd: "gh pr create ... (uses liz-kosfootel-token)", expect: 403 },
          { cmd: "curl with liz-better-machine-token", expect: 200 },
        ],
      },
    }, { liveSystem: {} });
    assert.equal(result.status, "partial", `expected partial, got ${result.status}`);
    assert.match(result.correction, /403/);
    assert.match(result.correction, /200/);
  });
});

// ============================================================
// TC-3: Resolved item moves to Resolved section
// ============================================================
describe("TC-3: resolved item reconciliation", () => {
  it("moves a previously-unresolved item to Resolved when verified", async () => {
    if (!accuracyModule) {
      assert.fail("lib/dream-cycle-accuracy.mjs not yet implemented. Write the module first.");
    }
    const result = await accuracyModule.verifyFact({
      type: "mesh_pool_state",
      claim: "'unknown' agent unresolved",
      verification: {
        command: "curl -s http://127.0.0.1:18805/mesh/shared-pool",
        // Mocked: pool has 0 facts with agent_id='unknown'
        result: { facts: [] },
      },
    }, { liveSystem: {} });
    assert.equal(result.status, "resolved", `expected resolved, got ${result.status}`);
    assert.match(result.correction, /lossless-claw test entries/);
  });
});

// ============================================================
// TC-4: Unverifiable fact gets `unverifiable` flag
// ============================================================
describe("TC-4: unverifiable fact detection", () => {
  it("marks a fact as unverifiable when the verification tool isn't available", async () => {
    if (!accuracyModule) {
      assert.fail("lib/dream-cycle-accuracy.mjs not yet implemented. Write the module first.");
    }
    const result = await accuracyModule.verifyFact({
      type: "network_reachability",
      claim: "Mac Studio is reachable at 100.101.203.97:8080",
      verification: { command: "curl -m 3 http://100.101.203.97:8080" },
    }, { liveSystem: { reachableFrom: "liz" } });
    assert.equal(result.status, "unverifiable", `expected unverifiable, got ${result.status}`);
    assert.match(result.correction, /not in Tailscale ACL/);
  });
});

// ============================================================
// TC-5: Recency window is respected
// ============================================================
describe("TC-5: recency window", () => {
  it("flags facts sourced from a non-today file", async () => {
    if (!accuracyModule) {
      assert.fail("lib/dream-cycle-accuracy.mjs not yet implemented. Write the module first.");
    }
    const result = await accuracyModule.buildStagingFile({
      todayLog: null,
      yesterdayLog: "this is yesterday's log",
      dreamCycleOutput: "this is the dream cycle output",
      meshFacts: [],
      date: "2026-07-25",
    });
    assert.equal(result.sourceCoverage.todayDaily, "not-yet-created");
    // Every fact sourced from yesterday's log must have a source marker
    const allFacts = [
      ...result.tier1Facts,
      ...result.tier2Observations,
      ...result.resolved,
    ];
    for (const f of allFacts) {
      if (f.source === "yesterday") {
        assert.match(f.body, /\(source: yesterday\)/,
          `fact ${f.id} sourced from yesterday should be marked as such`);
      }
    }
  });
});

// ============================================================
// TC-6: Confirmation message includes verification summary
// ============================================================
describe("TC-6: confirmation message", () => {
  it("includes the verification summary counts", async () => {
    if (!accuracyModule) {
      assert.fail("lib/dream-cycle-accuracy.mjs not yet implemented. Write the module first.");
    }
    const message = await accuracyModule.buildConfirmationMessage({
      date: "2026-07-25",
      counts: { ok: 7, stale: 1, partial: 0, unverifiable: 0 },
      staleHighlights: ["F-02 mesh PID"],
    });
    assert.match(message, /Dream staging 2026-07-25 done/);
    assert.match(message, /7 ok, 1 stale/);
    assert.match(message, /Stale: F-02 mesh PID/);
  });

  it("omits the stale hint when there are no stale/partial/unverifiable", async () => {
    if (!accuracyModule) {
      assert.fail("lib/dream-cycle-accuracy.mjs not yet implemented. Write the module first.");
    }
    const message = await accuracyModule.buildConfirmationMessage({
      date: "2026-07-25",
      counts: { ok: 7, stale: 0, partial: 0, unverifiable: 0 },
      staleHighlights: [],
    });
    assert.match(message, /Dream staging 2026-07-25 done/);
    assert.match(message, /7 ok, 0 stale, 0 partial, 0 unverifiable/);
    assert.doesNotMatch(message, /Stale:/);
  });
});

// ============================================================
// TC-7: No-entries path still works (PR #23 contract preserved)
// ============================================================
describe("TC-7: no-entries silent exit (regression)", () => {
  it("buildStagingFile returns a no-entries marker when all sources are empty", async () => {
    if (!accuracyModule) {
      assert.fail("lib/dream-cycle-accuracy.mjs not yet implemented. Write the module first.");
    }
    const result = await accuracyModule.buildStagingFile({
      todayLog: null,
      yesterdayLog: null,
      dreamCycleOutput: "# Dream Cycle — No Entries\n\nNo recent mesh or LCM entries found for consolidation.\n",
      meshFacts: [],
      date: "2026-07-25",
    });
    assert.equal(result.noEntries, true);
    assert.equal(result.tier1Facts.length, 0);
    assert.equal(result.tier2Observations.length, 0);
    // No confirmation message should be sent for no-entries
    assert.equal(result.shouldSendTelegram, false);
  });
});

// ============================================================
// TC-8: Existing regression suite still passes
// ============================================================
describe("TC-8: existing regression suite (delegates to other test files)", () => {
  it("the other test files exist and were not deleted", () => {
    const paths = [
      "tests/dream-cycle-v2.test.mjs",
      "tests/dream-cycle.test.mjs",
      "tests/shared-pool.test.mjs",
      "tests/receiver-get-shared-pool.test.mjs",
      "tests/token-lifecycle.test.mjs",
    ];
    for (const p of paths) {
      assert.ok(existsSync(resolve(REPO_ROOT, p)), `${p} should exist`);
    }
  });
});

// ============================================================
// TC-9: F-02 from the 2026-07-25 staging file is rewritten
// ============================================================
describe("TC-9: F-02 rewrite", () => {
  it("rewrites F-02 to flag the dead PID and current state", async () => {
    if (!accuracyModule) {
      assert.fail("lib/dream-cycle-accuracy.mjs not yet implemented. Write the module first.");
    }
    const yesterdayLog = `
## [HIGH] Phase 2.4 v0.2 receiver migration (18:50 EDT)
- Killed PID 7332 (stale v1 daemon, 18-day uptime)
- New v0.2 receiver on PID 4169961 (systemd-supervised)
- GET /mesh/shared-pool endpoint now works
`;
    const result = await accuracyModule.buildStagingFile({
      todayLog: null,
      yesterdayLog,
      dreamCycleOutput: "(no mesh entries in last 24h)",
      meshFacts: [],
      date: "2026-07-25",
    });

    // F-02 is the "Mesh memory receiver on Liz: healthy" fact.
    // After the fix, it should NOT be in tier1 (because it's stale),
    // and the staging file's source coverage or contradictions section
    // should mention the receiver state.
    const f02 = result.tier1Facts.find(f => f.id === "F-02");
    assert.equal(f02, undefined, "F-02 should not be in tier1 (it's stale)");

    // There should be a stale flag somewhere — either in tier2 (as an observation
    // that needs Erik's attention) or as a contradiction.
    const hasStale = [...result.tier1Facts, ...result.tier2Observations]
      .some(f => f.verification && f.verification.status === "stale");
    assert.ok(hasStale, "staging file should have at least one stale fact");
  });
});

// ============================================================
// TC-10: The new cron instruction update is itself a change
// ============================================================
describe("TC-10: cron instruction contains the new procedure", () => {
  it("the suggested payload includes verification steps", async () => {
    const path = resolve(REPO_ROOT, "cron-payload-accuracy.json");
    if (!existsSync(path)) {
      assert.fail("cron-payload-accuracy.json not yet written. The new procedure must be encoded as a file.");
    }
    const { readFile } = await import("node:fs/promises");
    const payload = JSON.parse(await readFile(path, "utf-8"));
    const msg = payload.payload.message;
    assert.match(msg, /verification/i, "instruction should mention verification");
    assert.match(msg, /stale|partial|unverifiable/, "instruction should list verification result values");
    assert.match(msg, /600|timeout/i, "instruction should preserve the 600s timeout contract");
    assert.match(msg, /20 2 \* \* \*|02:20/, "instruction should reference the cron schedule");
  });
});

// ============================================================
// TC-11: The new staging file passes review
// ============================================================
describe("TC-11: staging file review", () => {
  it("every fact has a verification result", async () => {
    if (!accuracyModule) {
      assert.fail("lib/dream-cycle-accuracy.mjs not yet implemented. Write the module first.");
    }
    const yesterdayLog = `
## [HIGH] Eames v0.3.1 subagent pool (2026-07-21)
- 173 tests pass
- 6 systemd timers on GX-10

## [HIGH] v0.2 receiver migration (2026-07-24 18:30)
- Killed PID 7332
- New v0.2 receiver on PID 4169961

## [HIGH] Token scope (2026-07-24)
- liz-kosfootel-token: contents:write, no PR write
- liz-better-machine-token: PR write works
`;
    const result = await accuracyModule.buildStagingFile({
      todayLog: null,
      yesterdayLog,
      dreamCycleOutput: "(no mesh entries in last 24h)",
      meshFacts: [],
      date: "2026-07-25",
    });
    const allFacts = [
      ...result.tier1Facts,
      ...result.tier2Observations,
    ];
    for (const f of allFacts) {
      assert.ok(f.verification, `fact ${f.id} must have a verification result`);
      assert.ok(
        ["ok", "partial", "stale", "unverifiable"].includes(f.verification.status),
        `fact ${f.id} verification status must be one of ok|partial|stale|unverifiable, got: ${f.verification.status}`
      );
    }
  });

  it("the Resolved section captures items that became resolved", async () => {
    if (!accuracyModule) {
      assert.fail("lib/dream-cycle-accuracy.mjs not yet implemented. Write the module first.");
    }
    const yesterdayLog = `
## [HIGH] Unknown agent in mesh pool (2026-07-24)
- 11 facts with agent_id='unknown'
- Investigation ongoing
`;
    const result = await accuracyModule.buildStagingFile({
      todayLog: null,
      yesterdayLog,
      dreamCycleOutput: "(no mesh entries)",
      meshFacts: [],
      date: "2026-07-25",
      // Provide a way to indicate that the "unknown" agent issue was resolved.
      // The verification module should detect this from the live system state.
      liveSystem: {
        meshPoolEmpty: true,
        knownAgents: ["liz", "ray", "woodhouse"],
      },
    });
    const resolved = result.resolved.find(r =>
      r.summary.toLowerCase().includes("unknown")
    );
    assert.ok(resolved, "'unknown' agent should appear in the Resolved section");
  });
});
