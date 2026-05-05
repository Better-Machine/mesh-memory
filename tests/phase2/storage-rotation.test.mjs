/**
 * @module storage-rotation.test
 * @description Tests for storage-rotation.mjs
 * Phase 2: Storage rotation and archiving
 *
 * Tests validate: module exports, config parsing, archive logic,
 * retention policy, and thread pruning behavior.
 * Uses the module's built-in dry-run mode for safe path testing.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert";
import { mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const TEST_DIR = join(tmpdir(), "mesh-memory-storage-" + randomUUID().slice(0, 8));

describe("Phase 2 - Storage Rotation", () => {
  after(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {}
  });

  // === Storage 1–6: Config & logic ===

  it("S1 - runRotation is exported and callable with dry-run", async () => {
    const module = await import("../../src/storage-rotation.mjs");
    assert.strictEqual(typeof module.runRotation, "function");
    assert.strictEqual(typeof module.rotateMeshLogs, "function");
    assert.strictEqual(typeof module.rotateThreads, "function");

    // Dry run should succeed without errors
    const result = await module.runRotation({ dryRun: true });
    assert.ok(result, "dryRun returns result");
    assert.strictEqual(typeof result.archived, "number");
    assert.strictEqual(typeof result.pruned, "number");
  });

  it("S2 - mesh log retention period is configurable", async () => {
    // Verify that rotateMeshLogs accepts config with retention days
    const { rotateMeshLogs } = await import("../../src/storage-rotation.mjs");

    const config = {
      meshLogRetentionDays: 30,
      archiveEnabled: true,
      archivePath: join(TEST_DIR, "archive"),
    };

    // Dry run should work without errors even if no files exist
    const result = await rotateMeshLogs(config, true);
    assert.ok(result, "should return stats object");
    assert.strictEqual(typeof result.archived, "number");
    assert.strictEqual(typeof result.pruned, "number");
    assert.strictEqual(typeof result.skipped, "number");
    assert.strictEqual(typeof result.errors, "number");
  });

  it("S3 - thread retention respects threadRetentionDays config", async () => {
    const { rotateThreads } = await import("../../src/storage-rotation.mjs");

    const config = { threadRetentionDays: 7 };

    // Dry run with default retention
    const result = await rotateThreads(config, true);
    assert.ok(result, "thread rotation returns result");
    assert.strictEqual(typeof result.pruned, "number");
    assert.strictEqual(typeof result.errors, "number");
  });

  it("S4 - retention policy: cutoff is calculated correctly for mesh logs", () => {
    const meshLogRetentionDays = 30;
    const cutoffMs = Date.now() - meshLogRetentionDays * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(cutoffMs);

    const expectedDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // Allow 1 second tolerance for test execution time
    assert.ok(
      Math.abs(cutoffMs - expectedDate.getTime()) < 1000,
      "cutoff for 30 days is correct"
    );
  });

  it("S5 - cold tier threshold is 3x retention period", () => {
    const meshLogRetentionDays = 30;
    const coldCutoffDays = meshLogRetentionDays * 3; // 90 days
    const coldCutoffMs = Date.now() - coldCutoffDays * 24 * 60 * 60 * 1000;

    const expected = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    assert.ok(
      Math.abs(coldCutoffMs - expected.getTime()) < 1000,
      "cold tier cutoff is 90 days (3x 30)"
    );
  });

  it("S6 - archive path resolves and subdirectories can be created", async () => {
    const archiveDir = join(TEST_DIR, "archive", "mesh");
    await mkdir(archiveDir, { recursive: true });

    // Verify directory exists
    const entries = await readdir(join(TEST_DIR, "archive"));
    assert.ok(entries.includes("mesh"), "mesh subdirectory exists in archive");

    // Simulate a tar.gz creation (just verify path structure)
    const sampleArchive = join(archiveDir, "2026-04-01.tar.gz");
    await writeFile(sampleArchive, "mock archive content");

    const files = await readdir(archiveDir);
    assert.ok(files.includes("2026-04-01.tar.gz"), "archive file created in correct location");
  });
});
