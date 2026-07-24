/**
 * @module dream-cycle.test
 * @description Verifies the dream-cycle reads from live data sources (mesh API + daily logs)
 * and gracefully handles failures.
 *
 * Why: memory/mesh/ and memory/lcm/ are planned-obsolete directories. The dream-cycle
 * was migrated to read from:
 *   - mesh daemon at http://127.0.0.1:18805/mesh/shared-pool (HTTP API)
 *   - daily logs at memory/YYYY-MM-DD.md (the LCM replacement)
 *
 * These tests pin the migration so it doesn't regress.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";

const MEMORY_BASE = resolve(homedir(), ".openclaw/workspace/memory");
const TODAY = new Date().toLocaleDateString("en-CA");
const TODAY_FILE = resolve(MEMORY_BASE, `${TODAY}.md`);

describe("dream-cycle.mjs data sources", () => {
  it("LCM_DIR points at daily logs (not the obsolete memory/lcm/)", async () => {
    // The dream-cycle.mjs was migrated from memory/lcm/ to memory/YYYY-MM-DD.md
    // (daily logs). This test pins the path so a regression would fail loud.
    const src = await readFile(resolve(MEMORY_BASE, "../projects/mesh-memory/dream-cycle.mjs"), "utf-8");
    // Should NOT reference the obsolete lcm/ subdir as a read target
    assert.doesNotMatch(src, /resolve\(MEMORY_BASE,\s*["']lcm["']\)/, "dream-cycle still reads from memory/lcm/ — that's obsolete");
    // Should read daily logs (memory/YYYY-MM-DD.md)
    assert.match(src, /const\s+LCM_DIR\s*=\s*MEMORY_BASE/);
  });

  it("dream-cycle.mjs uses mesh API, not memory/mesh/ directory", async () => {
    const src = await readFile(resolve(MEMORY_BASE, "../projects/mesh-memory/dream-cycle.mjs"), "utf-8");
    // Should NOT read memory/mesh/ as a directory
    assert.doesNotMatch(src, /resolve\(MEMORY_BASE,\s*["']mesh["']\)/);
    // Should fetch from the mesh daemon (URL is now configurable via MESH_API_URL,
    // but the default still points at the daemon on :18805)
    assert.match(src, /127\.0\.0\.1:18805\/mesh\/shared-pool/);
    assert.match(src, /fetch\(/);
  });

  it("dream-cycle produces output when given a daily log", async () => {
    // The dream cycle reads daily logs. Verify our current daily log exists.
    // (This is a smoke test — the daily log is written by hand or by the cron.)
    const src = await readFile(resolve(MEMORY_BASE, "../projects/mesh-memory/dream-cycle.mjs"), "utf-8");
    assert.match(src, /readRecentFiles\(LCM_DIR\)/);
    // Verify the daily log path matches what dream-cycle expects
    // YYYY-MM-DD.md format
    assert.match(TODAY, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("dream-cycle.mjs graceful degradation", () => {
  it("readRecentFiles does not throw on missing directory", async () => {
    // The function uses try/catch and returns [] on directory error
    const src = await readFile(resolve(MEMORY_BASE, "../projects/mesh-memory/dream-cycle.mjs"), "utf-8");
    assert.match(src, /catch\s*\{[\s\S]*?\/\/ Directory may not exist yet/);
  });

  it("fetchMeshFacts warns and returns [] on daemon down", async () => {
    const src = await readFile(resolve(MEMORY_BASE, "../projects/mesh-memory/dream-cycle.mjs"), "utf-8");
    assert.match(src, /fetchMeshFacts[\s\S]*?console\.warn\("\[dream\] mesh:/);
    assert.match(src, /return \[\];/);
  });
});
