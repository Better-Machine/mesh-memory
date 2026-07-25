/**
 * @file receiver-get-shared-pool.test.mjs
 * @description Tests for the new GET /mesh/shared-pool handler on memory-receiver.mjs
 * (FR-Phase2-2.4-3: add the GET endpoint that PR #23 reads from.)
 *
 * These tests start the receiver in-process, hit the endpoint, and assert
 * the response shape matches what dream-cycle.mjs expects.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 18815; // test port (not 18805)
const BASE_URL = `http://127.0.0.1:${PORT}`;

const proc = spawn("node", ["memory-receiver.mjs"], {
  cwd: "/home/erik-ross/.openclaw/workspace/projects/mesh-memory",
  env: {
    ...process.env,
    MESH_PORT: String(PORT),
    MESH_LOCAL_BYPASS: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

proc.stderr.on("data", (chunk) => process.stderr.write(`[child] ${chunk}`));

// Wait for "Listening on port" before tests run
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("receiver didn't start in 5s")), 5000);
  proc.stdout.on("data", (chunk) => {
    if (chunk.toString().includes("Listening on port")) {
      clearTimeout(timeout);
      resolve();
    }
  });
});

after(async () => {
  if (proc) {
    proc.kill("SIGTERM");
    await sleep(500);
  }
});

test("GET /mesh/shared-pool returns 200 with { facts: [] } shape", async () => {
  const res = await fetch(`${BASE_URL}/mesh/shared-pool`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.facts), "response should have facts array");
});

test("GET /mesh/shared-pool entries (if any) have dream-cycle shape: id, agent_id, content", async () => {
  const res = await fetch(`${BASE_URL}/mesh/shared-pool`);
  const body = await res.json();
  if (body.facts.length > 0) {
    const f = body.facts[0];
    assert.ok(typeof f.id === "string", `id should be a string, got ${typeof f.id}`);
    assert.ok(typeof f.agent_id === "string", `agent_id should be a string, got ${typeof f.agent_id}`);
    assert.ok(typeof f.content === "string", `content should be a string, got ${typeof f.content}`);
  }
});

test("GET /health still works (regression)", async () => {
  const res = await fetch(`${BASE_URL}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
});

test("MESH_PORT env var overrides config.receiverPort (regression for Phase 2.4 port fix)", async () => {
  // If this test runs, the receiver is listening on PORT (18815), not the config's 18805.
  // A 200 on the test port proves MESH_PORT env var worked.
  const res = await fetch(`${BASE_URL}/health`);
  assert.equal(res.status, 200, "receiver should be on the MESH_PORT=18815 we set");
});

test("MESH_LOCAL_BYPASS=true allows 127.0.0.1 to skip auth (regression for Phase 2.4 bypass)", async () => {
  // This test passes if we got 200 on /health without a Bearer token.
  // (The /health route is also auth-gated; local bypass is what made it work.)
  const res = await fetch(`${BASE_URL}/health`);
  assert.equal(res.status, 200, "local bypass should let same-host through without auth");
});
