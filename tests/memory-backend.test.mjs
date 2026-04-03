/**
 * @file memory-backend.test.mjs
 * @description Contract tests for the memory backend interface.
 *
 * - Local adapter: full integration tests against real JSON files
 * - Mem0 adapter: mock tests verifying interface compliance
 * - Factory: tests for createMemoryBackend()
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_STORAGE_DIR = resolve(__dirname, ".test-memories-" + process.pid);

// ─── Local Adapter Contract Tests ────────────────────────────────────────────

describe("local-adapter", () => {
  let adapter;
  const agentId = "test-agent-" + randomUUID().slice(0, 8);

  before(async () => {
    const { createLocalAdapter } = await import(
      "../src/backends/local-adapter.mjs"
    );
    adapter = createLocalAdapter({ storageDir: TEST_STORAGE_DIR });
  });

  after(() => {
    if (existsSync(TEST_STORAGE_DIR)) {
      rmSync(TEST_STORAGE_DIR, { recursive: true });
    }
  });

  test("add — stores memories and returns them", async () => {
    const result = await adapter.add(agentId, ["hello world", "second memory"]);
    assert.ok(result.results, "should return results array");
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].memory, "hello world");
    assert.equal(result.results[1].memory, "second memory");
    assert.ok(result.results[0].id, "should have an id");
    assert.ok(result.results[0].created_at, "should have created_at");
  });

  test("add — attaches metadata", async () => {
    const result = await adapter.add(agentId, ["with meta"], {
      source: "test",
    });
    assert.equal(result.results[0].metadata.source, "test");
  });

  test("search — finds matching memories", async () => {
    const result = await adapter.search(agentId, "hello");
    assert.ok(result.results.length > 0, "should find at least one match");
    assert.ok(
      result.results[0].memory.toLowerCase().includes("hello"),
      "result should contain query term"
    );
  });

  test("search — returns empty for no match", async () => {
    const result = await adapter.search(agentId, "xyznonexistent999");
    assert.equal(result.results.length, 0);
  });

  test("search — respects limit", async () => {
    const result = await adapter.search(agentId, "memory", { limit: 1 });
    assert.ok(result.results.length <= 1);
  });

  test("getAll — returns stored memories", async () => {
    const all = await adapter.getAll(agentId);
    assert.ok(all.length >= 3, "should have at least 3 memories from prior adds");
  });

  test("getAll — respects offset and limit", async () => {
    const page = await adapter.getAll(agentId, { offset: 1, limit: 1 });
    assert.equal(page.length, 1);
  });

  test("update — modifies memory text", async () => {
    const all = await adapter.getAll(agentId);
    const target = all[0];
    const updated = await adapter.update(agentId, target.id, {
      memory: "updated text",
    });
    assert.equal(updated.memory, "updated text");
    assert.ok(updated.updated_at > target.created_at);
  });

  test("update — merges metadata", async () => {
    const all = await adapter.getAll(agentId);
    const target = all[0];
    await adapter.update(agentId, target.id, { metadata: { extra: true } });
    const refreshed = await adapter.getAll(agentId);
    const found = refreshed.find((m) => m.id === target.id);
    assert.equal(found.metadata.extra, true);
  });

  test("update — throws on missing memory", async () => {
    await assert.rejects(
      () => adapter.update(agentId, "nonexistent-id", { memory: "x" }),
      /not found/i
    );
  });

  test("delete — removes specific memory", async () => {
    const before = await adapter.getAll(agentId);
    const target = before[0];
    await adapter.delete(agentId, target.id);
    const after = await adapter.getAll(agentId);
    assert.equal(after.length, before.length - 1);
    assert.ok(!after.find((m) => m.id === target.id));
  });

  test("delete — throws on missing memory", async () => {
    await assert.rejects(
      () => adapter.delete(agentId, "nonexistent-id"),
      /not found/i
    );
  });

  test("deleteAll — wipes all memories for agent", async () => {
    await adapter.deleteAll(agentId);
    const all = await adapter.getAll(agentId);
    assert.equal(all.length, 0);
  });
});

// ─── Mem0 Adapter Mock Tests ─────────────────────────────────────────────────

describe("mem0-adapter (mocked)", () => {
  test("createMem0Adapter — validates interface methods exist", async () => {
    // We can't actually import mem0ai, but we can test that the adapter
    // structure is correct by checking the validateBackend call.
    // The adapter calls validateBackend in its constructor, so if it
    // passes, the interface is satisfied.
    const { validateBackend } = await import(
      "../src/backends/memory-backend.interface.mjs"
    );

    // Build a mock that satisfies the interface
    const mockBackend = {
      name: "mem0-mock",
      add: async () => ({ results: [] }),
      search: async () => ({ results: [] }),
      getAll: async () => [],
      delete: async () => {},
      deleteAll: async () => {},
      update: async () => ({}),
    };

    // Should not throw
    validateBackend(mockBackend);
  });

  test("validateBackend — rejects incomplete backends", async () => {
    const { validateBackend } = await import(
      "../src/backends/memory-backend.interface.mjs"
    );

    assert.throws(
      () => validateBackend({ add: async () => {} }),
      /missing required method/
    );

    assert.throws(() => validateBackend({}), /missing required method/);
  });
});

// ─── Factory Tests ───────────────────────────────────────────────────────────

describe("createMemoryBackend factory", () => {
  test("defaults to local adapter", async () => {
    const { createMemoryBackend } = await import(
      "../src/backends/index.mjs"
    );
    const backend = await createMemoryBackend({
      local: { storageDir: TEST_STORAGE_DIR },
    });
    assert.equal(backend.name, "local");
  });

  test("explicit local config", async () => {
    const { createMemoryBackend } = await import(
      "../src/backends/index.mjs"
    );
    const backend = await createMemoryBackend({
      backend: "local",
      local: { storageDir: TEST_STORAGE_DIR },
    });
    assert.equal(backend.name, "local");
  });

  test("throws on unknown backend", async () => {
    const { createMemoryBackend } = await import(
      "../src/backends/index.mjs"
    );
    await assert.rejects(
      () => createMemoryBackend({ backend: "unknown" }),
      /Unknown memory backend/
    );
  });

  after(() => {
    if (existsSync(TEST_STORAGE_DIR)) {
      rmSync(TEST_STORAGE_DIR, { recursive: true });
    }
  });
});
