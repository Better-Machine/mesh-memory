/**
 * @file shared-pool.test.mjs
 * @description Tests for shared pool write, read, blind gate, and peer sync.
 * Uses Node built-in node:test and node:assert.
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const WORKSPACE = resolve(homedir(), ".openclaw/workspace");
const POOL_DIR = resolve(WORKSPACE, "memory/shared");
const POOL_FILE = resolve(POOL_DIR, "pool.json");
const GATES_DIR = resolve(POOL_DIR, "gates");
const AUDIT_FILE = resolve(POOL_DIR, "audit.jsonl");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Back up and clear the pool for test isolation */
let poolBackup = null;

async function clearPool() {
  poolBackup = existsSync(POOL_FILE)
    ? JSON.parse(readFileSync(POOL_FILE, "utf-8"))
    : null;
  await mkdir(POOL_DIR, { recursive: true });
  await writeFile(POOL_FILE, JSON.stringify({ version: "0.2", entries: [] }, null, 2));
}

async function restorePool() {
  if (poolBackup !== null) {
    await writeFile(POOL_FILE, JSON.stringify(poolBackup, null, 2));
  } else if (existsSync(POOL_FILE)) {
    await rm(POOL_FILE);
  }
}

/** Create a minimal valid entry */
function makeEntry(overrides = {}) {
  const ts = new Date().toISOString();
  return {
    type: "fact",
    category: "test",
    fact: `Test fact ${randomUUID()}`,
    tags: ["test"],
    provenance: {
      source_agent: "test-agent",
      timestamp: ts,
      basis: "observed",
      confidence: 0.9,
    },
    ...overrides,
  };
}

// ─── Write tests ──────────────────────────────────────────────────────────────

describe("shared-pool-write", () => {
  before(async () => {
    await clearPool();
  });

  after(async () => {
    await restorePool();
  });

  test("write success — returns normalized entry with id and decay_rate", async () => {
    const { writeEntry } = await import(`../shared-pool-write.mjs?t=${Date.now()}`);
    const entry = makeEntry({ type: "fact", category: "infra", fact: "The sky is blue" });
    const result = await writeEntry(entry);

    assert.ok(result.id, "should have an id");
    assert.equal(result.type, "fact");
    assert.equal(result.category, "infra");
    assert.equal(result.decay_rate, "slow");
    assert.deepEqual(result.challenges, []);
    assert.ok(result.provenance.review_by, "should have review_by");
  });

  test("write missing fact — throws validation error", async () => {
    const { writeEntry } = await import(`../shared-pool-write.mjs?t=${Date.now()}`);
    const entry = makeEntry();
    delete entry.fact;

    await assert.rejects(
      () => writeEntry(entry),
      /Missing required field: fact/
    );
  });

  test("write missing category — throws validation error", async () => {
    const { writeEntry } = await import(`../shared-pool-write.mjs?t=${Date.now()}`);
    const entry = makeEntry();
    delete entry.category;

    await assert.rejects(
      () => writeEntry(entry),
      /Missing required field: category/
    );
  });

  test("write missing provenance — throws validation error", async () => {
    const { writeEntry } = await import(`../shared-pool-write.mjs?t=${Date.now()}`);
    const entry = makeEntry();
    delete entry.provenance;

    await assert.rejects(
      () => writeEntry(entry),
      /Missing required field: provenance/
    );
  });

  test("write missing provenance.source_agent — throws", async () => {
    const { writeEntry } = await import(`../shared-pool-write.mjs?t=${Date.now()}`);
    const entry = makeEntry();
    delete entry.provenance.source_agent;

    await assert.rejects(
      () => writeEntry(entry),
      /provenance.source_agent/
    );
  });

  test("write missing type — defaults to 'interpretation' with warning", async () => {
    const { writeEntry } = await import(`../shared-pool-write.mjs?t=${Date.now()}`);
    const entry = makeEntry();
    delete entry.type;

    const result = await writeEntry(entry);
    assert.equal(result.type, "interpretation", "should default to interpretation");
    assert.equal(result.decay_rate, "fast", "interpretation has fast decay");
  });

  test("duplicate ID rejection — throws on second write", async () => {
    const { writeEntry } = await import(`../shared-pool-write.mjs?t=${Date.now()}`);
    const entry = makeEntry({ fact: "Duplicate test fact" });

    const first = await writeEntry(entry);

    // Second write with same ID
    await assert.rejects(
      () => writeEntry({ ...entry, id: first.id }),
      /Duplicate entry ID/
    );
  });

  test("role-assignment decay_rate is 'medium'", async () => {
    const { writeEntry } = await import(`../shared-pool-write.mjs?t=${Date.now()}`);
    const entry = makeEntry({ type: "role-assignment", fact: "Agent X handles infra" });
    const result = await writeEntry(entry);
    assert.equal(result.decay_rate, "medium");
  });

  test("prediction decay_rate is 'bounded' and requires review_by", async () => {
    const { writeEntry } = await import(`../shared-pool-write.mjs?t=${Date.now()}`);
    const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const entry = makeEntry({
      type: "prediction",
      fact: "Deployment by Q2",
      provenance: {
        source_agent: "test-agent",
        timestamp: new Date().toISOString(),
        basis: "inferred",
        confidence: 0.7,
        review_by: deadline,
      },
    });
    const result = await writeEntry(entry);
    assert.equal(result.decay_rate, "bounded");
    assert.equal(result.provenance.review_by, deadline);
  });
});

// ─── Read tests ───────────────────────────────────────────────────────────────

describe("shared-pool-read", () => {
  let writtenId = null;

  before(async () => {
    await clearPool();
    // Write a known entry for read tests
    const { writeEntry } = await import(`../shared-pool-write.mjs?t=${Date.now()}`);
    const entry = await writeEntry(makeEntry({
      type: "fact",
      category: "infra",
      fact: "Read test fact",
      tags: ["read-test"],
      provenance: {
        source_agent: "liz",
        timestamp: new Date().toISOString(),
        basis: "observed",
        confidence: 0.9,
      },
    }));
    writtenId = entry.id;
  });

  after(async () => {
    await restorePool();
  });

  test("readAll returns entries without source_agent", async () => {
    const { readAll } = await import(`../shared-pool-read.mjs?t=${Date.now()}`);
    const entries = await readAll({ includeStale: true });
    assert.ok(entries.length > 0);
    for (const e of entries) {
      assert.ok(!e.provenance.source_agent, "source_agent should be stripped");
      assert.ok(e.provenance.source, "should have anonymized source role");
    }
  });

  test("readOne returns single entry by id", async () => {
    const { readOne } = await import(`../shared-pool-read.mjs?t=${Date.now()}`);
    const entry = await readOne(writtenId, "test-reader");
    assert.ok(entry, "should find entry");
    assert.equal(entry.id, writtenId);
  });

  test("readOne returns null for unknown id", async () => {
    const { readOne } = await import(`../shared-pool-read.mjs?t=${Date.now()}`);
    const result = await readOne("nonexistent-id");
    assert.equal(result, null);
  });

  test("search finds entries by fact content", async () => {
    const { search } = await import(`../shared-pool-read.mjs?t=${Date.now()}`);
    const results = await search("Read test fact", { includeStale: true });
    assert.ok(results.some(e => e.id === writtenId));
  });

  test("read anonymization — source_agent replaced with role", async () => {
    const { readOne } = await import(`../shared-pool-read.mjs?t=${Date.now()}`);
    const entry = await readOne(writtenId);
    assert.ok(!entry.provenance.source_agent, "source_agent must be stripped");
    // 'liz' maps to 'agent' role in contacts or defaults to 'agent'
    assert.ok(typeof entry.provenance.source === "string");
  });

  test("decay calculation — fresh entry has high effective_confidence", async () => {
    const { readOne } = await import(`../shared-pool-read.mjs?t=${Date.now()}`);
    const entry = await readOne(writtenId, "test-reader");
    // Fresh entry (seconds old) should have ~original confidence
    assert.ok(entry.effective_confidence > 0.8, `expected > 0.8, got ${entry.effective_confidence}`);
    assert.equal(entry.stale, false);
  });

  test("stale flag — entry with very old timestamp and fast decay", async () => {
    await clearPool();
    const { writeEntry } = await import(`../shared-pool-write.mjs?t=${Date.now()}`);
    const { readOne } = await import(`../shared-pool-read.mjs?t=${Date.now()}`);

    // Write with old timestamp (200 days ago)
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    const entry = await writeEntry(makeEntry({
      type: "interpretation", // fast decay: 0.97^200 ≈ 0.0026 — very stale
      fact: "Stale interpretation fact",
      provenance: {
        source_agent: "test-agent",
        timestamp: oldDate.toISOString(),
        basis: "inferred",
        confidence: 0.9,
      },
    }));

    const read = await readOne(entry.id, "test-reader");
    assert.equal(read.stale, true, "should be stale after 200 days with fast decay");
  });

  test("challenge warning prepended when challenges exist", async () => {
    await clearPool();
    // Manually inject an entry with challenges
    const pool = { version: "0.2", entries: [] };
    const challengeEntry = {
      id: "challenge-test-001",
      type: "fact",
      category: "test",
      fact: "Contested fact",
      tags: [],
      provenance: {
        source_agent: "agent-x",
        timestamp: new Date().toISOString(),
        basis: "observed",
        confidence: 0.8,
        review_by: "2027-01-01",
      },
      confirmed_by: null,
      decay_rate: "slow",
      challenges: [{ source: "agent-y", reason: "I observed differently" }],
    };
    pool.entries.push(challengeEntry);
    await writeFile(POOL_FILE, JSON.stringify(pool, null, 2));

    const { readOne } = await import(`../shared-pool-read.mjs?t=${Date.now()}`);
    const entry = await readOne("challenge-test-001");
    assert.ok(entry._warning, "should have challenge warning");
    assert.ok(entry._warning.includes("[CHALLENGE]"));
  });
});

// ─── Blind gate tests ─────────────────────────────────────────────────────────

describe("blind-gate", () => {
  before(async () => {
    await clearPool();
    // Write a test entry
    const { writeEntry } = await import(`../shared-pool-write.mjs?t=${Date.now()}`);
    await writeEntry(makeEntry({ fact: "Gate test fact" }));
    // Clear any old gates
    if (existsSync(GATES_DIR)) {
      await rm(GATES_DIR, { recursive: true });
    }
  });

  after(async () => {
    await restorePool();
  });

  test("readWithGate without token — throws with protocol explanation", async () => {
    const { readWithGate } = await import(`../blind-gate.mjs?t=${Date.now()}`);
    await assert.rejects(
      () => readWithGate(null, {}),
      /No gate token provided/
    );
  });

  test("readWithGate with invalid token — throws", async () => {
    const { readWithGate } = await import(`../blind-gate.mjs?t=${Date.now()}`);
    // May say "gate not found" or "gates directory not found" depending on state
    await assert.rejects(
      () => readWithGate("invalid-token-xyz"),
      /Gate token not found|No gates directory found/
    );
  });

  test("openGate returns a token", async () => {
    const { openGate } = await import(`../blind-gate.mjs?t=${Date.now()}`);
    const token = await openGate("test-topic", "test-agent", "My independent position");
    assert.ok(typeof token === "string" && token.length > 0);
  });

  test("valid gate — readWithGate succeeds and returns entries", async () => {
    const { openGate, readWithGate } = await import(`../blind-gate.mjs?t=${Date.now()}`);
    const token = await openGate("deployment", "agent-a", "I think deployment is ready");
    const entries = await readWithGate(token, { includeStale: true });
    assert.ok(Array.isArray(entries));
  });

  test("valid gate — marked used after read", async () => {
    const { openGate, readWithGate } = await import(`../blind-gate.mjs?t=${Date.now()}`);
    const token = await openGate("used-gate-topic", "agent-b", "My position here");
    await readWithGate(token, { includeStale: true });

    // Second read with same token should fail
    await assert.rejects(
      () => readWithGate(token, {}),
      /already used/
    );
  });

  test("expired gate — throws with expiry message", async () => {
    const { openGate } = await import(`../blind-gate.mjs?t=${Date.now()}`);
    const { readWithGate } = await import(`../blind-gate.mjs?t=${Date.now()}`);

    const token = await openGate("expiry-test", "agent-c", "My position");

    // Manually backdate the gate file to simulate expiry
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(GATES_DIR);
    for (const file of files) {
      const path = resolve(GATES_DIR, file);
      const data = JSON.parse(readFileSync(path, "utf-8"));
      if (data.token === token) {
        data.openedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString(); // 11 min ago
        writeFileSync(path, JSON.stringify(data, null, 2));
      }
    }

    await assert.rejects(
      () => readWithGate(token, {}),
      /expired/
    );
  });

  test("hasActiveGate returns true when gate is open", async () => {
    const { openGate, hasActiveGate } = await import(`../blind-gate.mjs?t=${Date.now()}`);
    await openGate("active-test", "agent-d", "My position");
    const active = await hasActiveGate("agent-d");
    assert.equal(active, true);
  });

  test("hasActiveGate returns false when no gate", async () => {
    const { hasActiveGate } = await import(`../blind-gate.mjs?t=${Date.now()}`);
    const active = await hasActiveGate("agent-nonexistent-xyz");
    assert.equal(active, false);
  });
});

// ─── Sync / receiveFromPeer tests ─────────────────────────────────────────────

describe("shared-pool-sync", () => {
  before(async () => {
    await clearPool();
  });

  after(async () => {
    await restorePool();
  });

  test("receiveFromPeer forces basis to 'peer-relayed'", async () => {
    const { receiveFromPeer } = await import(`../shared-pool-sync.mjs?t=${Date.now()}`);
    const ts = new Date().toISOString();
    const entry = {
      id: `peer-relay-${randomUUID().slice(0, 8)}`,
      type: "fact",
      category: "test",
      fact: `Peer relay test fact ${randomUUID()}`,
      tags: ["peer-test"],
      provenance: {
        source_agent: "remote-agent",
        timestamp: ts,
        basis: "observed", // will be overridden to "peer-relayed"
        confidence: 0.85,
        review_by: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      },
      decay_rate: "slow",
      challenges: [],
    };

    const result = await receiveFromPeer(entry);
    assert.equal(result.provenance.basis, "peer-relayed", "basis must be forced to peer-relayed");
  });

  test("receiveFromPeer duplicate ID — throws with DUPLICATE code", async () => {
    const { receiveFromPeer } = await import(`../shared-pool-sync.mjs?t=${Date.now()}`);
    const ts = new Date().toISOString();
    const fixedId = `dup-peer-${randomUUID().slice(0, 8)}`;
    const entry = {
      id: fixedId,
      type: "fact",
      category: "test",
      fact: `Duplicate peer fact ${randomUUID()}`,
      tags: [],
      provenance: {
        source_agent: "remote-agent",
        timestamp: ts,
        basis: "observed",
        confidence: 0.85,
        review_by: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      },
      decay_rate: "slow",
      challenges: [],
    };

    await receiveFromPeer(entry);

    const err = await receiveFromPeer({ ...entry, fact: "Modified fact" }).catch(e => e);
    assert.ok(err instanceof Error);
    assert.equal(err.code, "DUPLICATE");
  });

  test("receiveFromPeer invalid entry — throws with INVALID code", async () => {
    const { receiveFromPeer } = await import(`../shared-pool-sync.mjs?t=${Date.now()}`);
    const err = await receiveFromPeer({ fact: "missing required fields" }).catch(e => e);
    assert.ok(err instanceof Error);
    assert.equal(err.code, "INVALID");
  });

  test("receiveFromPeer missing fact — throws INVALID", async () => {
    const { receiveFromPeer } = await import(`../shared-pool-sync.mjs?t=${Date.now()}`);
    const entry = makeEntry();
    delete entry.fact;
    const err = await receiveFromPeer(entry).catch(e => e);
    assert.equal(err.code, "INVALID");
  });
});

// ─── Gate HTTP endpoint tests ────────────────────────────────────────────────

describe("gate HTTP endpoints", () => {
  let app;
  let server;
  let baseUrl;
  const TEST_TOKEN = "test-bearer-token-for-gates";
  const TEST_GATES_DIR = resolve(POOL_DIR, "gates");

  before(async () => {
    const express = (await import("express")).default;
    const { readFile: rf, writeFile: wf, mkdir: mkd, readdir: rd } = await import("node:fs/promises");

    app = express();
    app.use(express.json());

    // Auth middleware matching receiver pattern
    app.use("/", (req, res, next) => {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${TEST_TOKEN}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      next();
    });

    // POST /mesh/shared/gates
    app.post("/mesh/shared/gates", async (req, res) => {
      const { topic, agentId, positionHash, token, expiresAt } = req.body || {};
      if (!topic || !agentId || !positionHash || !token) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const safeTopic = topic.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      const safeAgent = agentId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      const topicDir = resolve(TEST_GATES_DIR, safeTopic);
      await mkd(topicDir, { recursive: true });
      const gatePath = resolve(topicDir, `${safeAgent}.json`);
      if (existsSync(gatePath)) {
        return res.status(409).json({ error: "Gate already exists" });
      }
      const gateData = {
        agentId, positionHash, token,
        expiresAt: expiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        committed: true, committedAt: new Date().toISOString(),
      };
      await wf(gatePath, JSON.stringify(gateData, null, 2), "utf-8");
      return res.status(201).json({ ok: true });
    });

    // GET /mesh/shared/gates/:topic
    app.get("/mesh/shared/gates/:topic", async (req, res) => {
      const safeTopic = req.params.topic.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      const topicDir = resolve(TEST_GATES_DIR, safeTopic);
      if (!existsSync(topicDir)) return res.json([]);
      const files = await rd(topicDir);
      const now = Date.now();
      const gates = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const data = JSON.parse(await rf(resolve(topicDir, file), "utf-8"));
          if (data.expiresAt && new Date(data.expiresAt).getTime() < now) continue;
          gates.push({
            agentId: data.agentId, positionHash: data.positionHash,
            token: data.token, expiresAt: data.expiresAt, committed: true,
          });
        } catch { continue; }
      }
      return res.json(gates);
    });

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    // Clean test gate dirs
    if (existsSync(TEST_GATES_DIR)) {
      await rm(TEST_GATES_DIR, { recursive: true });
    }
  });

  after(async () => {
    if (server) server.close();
    if (existsSync(TEST_GATES_DIR)) {
      await rm(TEST_GATES_DIR, { recursive: true });
    }
  });

  test("POST /mesh/shared/gates — 201 on first publish", async () => {
    const res = await fetch(`${baseUrl}/mesh/shared/gates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({
        topic: "test-topic",
        agentId: "agent-a",
        positionHash: "abc123hash",
        token: "gate-token-001",
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.ok, true);
  });

  test("POST /mesh/shared/gates — 409 on duplicate agent+topic", async () => {
    const res = await fetch(`${baseUrl}/mesh/shared/gates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({
        topic: "test-topic",
        agentId: "agent-a",
        positionHash: "abc123hash",
        token: "gate-token-002",
      }),
    });
    assert.equal(res.status, 409);
  });

  test("GET /mesh/shared/gates/:topic — returns committed gates", async () => {
    // Add another agent's gate
    await fetch(`${baseUrl}/mesh/shared/gates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({
        topic: "test-topic",
        agentId: "agent-b",
        positionHash: "def456hash",
        token: "gate-token-003",
      }),
    });

    const res = await fetch(`${baseUrl}/mesh/shared/gates/test-topic`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    assert.equal(res.status, 200);
    const gates = await res.json();
    assert.ok(Array.isArray(gates));
    assert.equal(gates.length, 2);
    assert.ok(gates.every(g => g.committed === true));
    assert.ok(gates.some(g => g.agentId === "agent-a"));
    assert.ok(gates.some(g => g.agentId === "agent-b"));
  });

  test("GET /mesh/shared/gates/:topic — filters expired gates", async () => {
    // Publish a gate with expiry in the past
    const topicDir = resolve(TEST_GATES_DIR, "expire-topic");
    await mkdir(topicDir, { recursive: true });
    const expiredGate = {
      agentId: "agent-expired",
      positionHash: "expired-hash",
      token: "expired-token",
      expiresAt: new Date(Date.now() - 60000).toISOString(), // 1 min ago
      committed: true,
    };
    const { writeFile: wf2 } = await import("node:fs/promises");
    await wf2(resolve(topicDir, "agent-expired.json"), JSON.stringify(expiredGate, null, 2));

    const res = await fetch(`${baseUrl}/mesh/shared/gates/expire-topic`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    const gates = await res.json();
    assert.equal(gates.length, 0, "expired gates should be filtered out");
  });

  test("GET /mesh/shared/gates/:topic — empty array for unknown topic", async () => {
    const res = await fetch(`${baseUrl}/mesh/shared/gates/nonexistent-topic-xyz`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    const gates = await res.json();
    assert.deepEqual(gates, []);
  });
});

// ─── Social engineering guard test ──────────────────────────────────────────

describe("social-engineering guard", () => {
  before(async () => {
    await clearPool();
    const { writeEntry } = await import(`../shared-pool-write.mjs?t=${Date.now()}`);
    await writeEntry(makeEntry({ fact: "Guard test fact" }));
    if (existsSync(GATES_DIR)) {
      await rm(GATES_DIR, { recursive: true });
    }
  });

  after(async () => {
    await restorePool();
  });

  test("readWithGate rejects HTTP-obtained token — local gate required", async () => {
    const { readWithGate } = await import(`../blind-gate.mjs?t=${Date.now()}`);

    // Simulate a token obtained from the HTTP gate list (not from openGate).
    // Without a matching local gate file, this must fail.
    const fakeHttpToken = "token-from-http-list-not-local-gate";

    await assert.rejects(
      () => readWithGate(fakeHttpToken),
      /Gate token not found|No gates directory found/,
      "HTTP gate list token alone must NOT be sufficient to read the pool"
    );
  });
});

// ─── waitForPeerGates tests ─────────────────────────────────────────────────

describe("waitForPeerGates", () => {
  let gateServer;
  let gateBaseUrl;
  const GATE_SERVER_TOKEN = "test-gate-poll-token";

  before(async () => {
    const express = (await import("express")).default;
    const gateApp = express();
    gateApp.use(express.json());
    gateApp.use("/", (req, res, next) => {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${GATE_SERVER_TOKEN}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      next();
    });

    // Simulated peer gate endpoint — agent-b commits immediately
    gateApp.get("/mesh/shared/gates/:topic", (_req, res) => {
      res.json([
        { agentId: "agent-b", positionHash: "hash-b", token: "tok-b", expiresAt: new Date(Date.now() + 600000).toISOString(), committed: true },
      ]);
    });

    gateServer = await new Promise((resolve) => {
      const s = gateApp.listen(0, () => resolve(s));
    });
    gateBaseUrl = `http://127.0.0.1:${gateServer.address().port}`;
  });

  after(() => {
    if (gateServer) gateServer.close();
  });

  test("resolves when all peers publish", async () => {
    // Reset the shared config cache so blind-gate picks up local overrides
    const { resetConfig } = await import("../config.mjs");

    const configPath = resolve(ROOT, "mesh-memory.config.local.json");
    const origConfig = existsSync(configPath)
      ? readFileSync(configPath, "utf-8")
      : null;

    writeFileSync(configPath, JSON.stringify({
      agentId: "agent-a",
      receiverPort: 19999,
      receiverToken: GATE_SERVER_TOKEN,
      peers: [
        { agentId: "agent-b", receiverUrl: gateBaseUrl, token: GATE_SERVER_TOKEN },
      ],
    }));
    resetConfig();

    try {
      const { waitForPeerGates } = await import("../blind-gate.mjs");
      const gates = await waitForPeerGates("poll-test", "agent-a", ["agent-b"], 10000);
      assert.ok(Array.isArray(gates));
      assert.ok(gates.some(g => g.agentId === "agent-b"));
    } finally {
      if (origConfig !== null) {
        writeFileSync(configPath, origConfig);
      } else if (existsSync(configPath)) {
        rmSync(configPath);
      }
      resetConfig();
    }
  });
});

console.log("\n shared-pool.test.mjs loaded — running tests...\n");
