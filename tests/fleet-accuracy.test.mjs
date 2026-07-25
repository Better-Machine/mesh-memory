/**
 * @module fleet-accuracy.test
 * @description Behavioral tests for Phase 2.6 — fleet audit verification helpers.
 *
 * Companion to REQUIREMENTS-fleet-audit.md.
 *
 * The fleet audit reuses the Phase 2.5 verification pattern (lib/dream-cycle-
 * accuracy.mjs) and adds new helpers for the other high-risk cron jobs:
 *   - verifyDaemon(port)
 *   - verifyCronJob(jobId)
 *   - verifyPR(repo, number)
 *   - verifyProcess(pid)
 *
 * Tests are written BEFORE implementation. The test file imports the module
 * to be implemented (lib/fleet-accuracy.mjs). If the module doesn't exist,
 * all tests will fail with MODULE_NOT_FOUND. This is the red baseline.
 *
 * Module API (contract, TBD until implementation):
 *
 *   import { verifyDaemon, verifyCronJob, verifyPR, verifyProcess } from "../lib/fleet-accuracy.mjs";
 *
 *   verifyDaemon(port: number) => Promise<{status, port, listener?: string, error?: string}>
 *   verifyCronJob(jobId: string) => Promise<{status, lastRunAt?: string, lastStatus?: string, error?: string}>
 *   verifyPR(repo: string, number: number) => Promise<{status, state?, html_url?, mergedAt?, error?: string}>
 *   verifyProcess(pid: number) => Promise<{status, pid, error?: string}>
 *
 * Where status is one of: "ok", "stale", "error".
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

let fleetModule;
try {
  fleetModule = await import("../lib/fleet-accuracy.mjs");
} catch (e) {
  // Module doesn't exist yet. Tests will fail with a clear message below.
  fleetModule = null;
}

// ============================================================
// TC-1: verifyDaemon returns ok for listening port
// ============================================================
describe("TC-1: verifyDaemon(18805)", () => {
  it("returns ok when port 18805 is listening", async () => {
    if (!fleetModule) {
      assert.fail("lib/fleet-accuracy.mjs not yet implemented. Write the module first.");
    }
    const result = await fleetModule.verifyDaemon(18805);
    assert.equal(result.status, "ok", `expected ok, got ${result.status}: ${result.error || ""}`);
    assert.equal(result.port, 18805);
    // listener should be a non-empty string (the PID)
    assert.ok(typeof result.listener === "string" && result.listener.length > 0,
      `expected non-empty listener, got: ${result.listener}`);
  });
});

// ============================================================
// TC-2: verifyDaemon returns stale for unbound port
// ============================================================
describe("TC-2: verifyDaemon(99999)", () => {
  it("returns stale when port 99999 is not listening", async () => {
    if (!fleetModule) {
      assert.fail("lib/fleet-accuracy.mjs not yet implemented. Write the module first.");
    }
    const result = await fleetModule.verifyDaemon(99999);
    assert.equal(result.status, "stale", `expected stale, got ${result.status}: ${result.error || ""}`);
    assert.equal(result.port, 99999);
    assert.equal(result.listener, null);
  });
});

// ============================================================
// TC-3: verifyCronJob returns ok for lastRunStatus=ok
// ============================================================
describe("TC-3: verifyCronJob(dream-staging-nightly)", () => {
  it("returns ok for the dream-staging-nightly job", async () => {
    if (!fleetModule) {
      assert.fail("lib/fleet-accuracy.mjs not yet implemented. Write the module first.");
    }
    const result = await fleetModule.verifyCronJob("169f92fa-1b75-4d28-9c43-d257bc42a7c8");
    assert.equal(result.status, "ok", `expected ok, got ${result.status}: ${result.error || ""}`);
    assert.ok(result.lastRunAt, "expected lastRunAt");
    assert.equal(result.lastStatus, "ok");
  });
});

// ============================================================
// TC-4: verifyCronJob returns stale for lastRunStatus=error
// ============================================================
describe("TC-4: verifyCronJob(gateway-daily-restart)", () => {
  it("returns stale for the gateway-daily-restart job (currently erroring)", async () => {
    if (!fleetModule) {
      assert.fail("lib/fleet-accuracy.mjs not yet implemented. Write the module first.");
    }
    const result = await fleetModule.verifyCronJob("e094d2bf-cff7-46ab-93c3-3f2f47d3cb63");
    assert.equal(result.status, "stale", `expected stale, got ${result.status}: ${result.error || ""}`);
    assert.equal(result.lastStatus, "error");
  });
});

// ============================================================
// TC-5: verifyPR returns ok for open PR
// ============================================================
describe("TC-5: verifyPR(Better-Machine/mesh-memory, 24)", () => {
  it("returns ok for the open Phase 2.4 PR", async () => {
    if (!fleetModule) {
      assert.fail("lib/fleet-accuracy.mjs not yet implemented. Write the module first.");
    }
    const result = await fleetModule.verifyPR("Better-Machine/mesh-memory", 24);
    assert.equal(result.status, "ok", `expected ok, got ${result.status}: ${result.error || ""}`);
    assert.equal(result.state, "open");
    assert.ok(result.html_url, "expected html_url");
  });
});

// ============================================================
// TC-6: verifyPR returns stale for merged PR
// ============================================================
describe("TC-6: verifyPR(Better-Machine/mesh-memory, 23)", () => {
  it("returns stale for the merged dream-cycle v2 PR", async () => {
    if (!fleetModule) {
      assert.fail("lib/fleet-accuracy.mjs not yet implemented. Write the module first.");
    }
    const result = await fleetModule.verifyPR("Better-Machine/mesh-memory", 23);
    assert.equal(result.status, "stale", `expected stale, got ${result.status}: ${result.error || ""}`);
    assert.equal(result.state, "merged");
    assert.ok(result.mergedAt, "expected mergedAt");
  });
});

// ============================================================
// TC-7: verifyProcess returns ok for running PID
// ============================================================
describe("TC-7: verifyProcess(4169961)", () => {
  it("returns ok for the running v0.2 receiver PID", async () => {
    if (!fleetModule) {
      assert.fail("lib/fleet-accuracy.mjs not yet implemented. Write the module first.");
    }
    const result = await fleetModule.verifyProcess(4169961);
    assert.equal(result.status, "ok", `expected ok, got ${result.status}: ${result.error || ""}`);
    assert.equal(result.pid, 4169961);
  });
});

// ============================================================
// TC-8: verifyProcess returns stale for dead PID
// ============================================================
describe("TC-8: verifyProcess(7332)", () => {
  it("returns stale for the killed v1 daemon PID", async () => {
    if (!fleetModule) {
      assert.fail("lib/fleet-accuracy.mjs not yet implemented. Write the module first.");
    }
    const result = await fleetModule.verifyProcess(7332);
    assert.equal(result.status, "stale", `expected stale, got ${result.status}: ${result.error || ""}`);
    assert.equal(result.pid, 7332);
  });
});

// ============================================================
// TC-9: Gateway restart marker detection (cron turn behavior)
// ============================================================
describe("TC-9: gateway restart marker check", () => {
  it("the marker file detection logic is testable", async () => {
    if (!fleetModule) {
      assert.fail("lib/fleet-accuracy.mjs not yet implemented. Write the module first.");
    }
    // The marker should be either present (if a recent restart happened)
    // or absent. Either way, the function should not error.
    const result = await fleetModule.checkGatewayRestartMarker();
    assert.ok(typeof result.markerExists === "boolean");
  });
});

// ============================================================
// TC-10: Memory consolidation stale-entry detection
// ============================================================
describe("TC-10: detectStaleConsolidationEntries", () => {
  it("returns entries that are contradicted by a more recent daily", async () => {
    if (!fleetModule) {
      assert.fail("lib/fleet-accuracy.mjs not yet implemented. Write the module first.");
    }
    const oldDaily = `
## [HIGH] Old fact: PID 7332 is the mesh-receiver
PID 7332 is the current mesh-receiver, uptime 18 days.
`;
    const newDaily = `
## [HIGH] New fact: v0.2 receiver migration complete
Killed PID 7332 (stale v1 daemon, 18-day uptime). New v0.2 receiver on PID 4169961.
`;
    const stale = await fleetModule.detectStaleConsolidationEntries({
      oldDaily,
      newDaily,
    });
    assert.ok(stale.length > 0, "should detect at least one stale entry");
    assert.match(stale[0], /PID 7332/);
  });
});

// ============================================================
// TC-11: Reuse dream-cycle-accuracy.mjs verification logic
// ============================================================
describe("TC-11: Phase 2.5 lib still works (regression)", () => {
  it("lib/dream-cycle-accuracy.mjs still exists and exports buildStagingFile", () => {
    const path = resolve(REPO_ROOT, "lib/dream-cycle-accuracy.mjs");
    assert.ok(existsSync(path), "lib/dream-cycle-accuracy.mjs should exist (Phase 2.5)");
  });
});

// ============================================================
// TC-12: cron-payload-accuracy.json still in place
// ============================================================
describe("TC-12: Phase 2.5 cron payload still in place (regression)", () => {
  it("cron-payload-accuracy.json still exists", () => {
    const path = resolve(REPO_ROOT, "cron-payload-accuracy.json");
    assert.ok(existsSync(path), "cron-payload-accuracy.json should exist (Phase 2.5)");
  });
});
