/**
 * @module token-lifecycle.test
 * @description Integration tests for token-lifecycle.mjs
 * Phase 2: Token lifecycle with expiry, rotation, and audit
 *
 * Tests actual TokenLifecycle class behaviour: issue, validate, rotate, revoke,
 * grace period, expiry, middleware, and persistence.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = join(tmpdir(), "mesh-memory-token-lifecycle-" + randomUUID());

import { TokenLifecycle } from "../../src/token-lifecycle.mjs";

describe("Phase 2 - Token Lifecycle (integration)", () => {
  /** @type {TokenLifecycle} */
  let lifecycle;

  before(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(join(TEST_DIR, "data"), { recursive: true });
    await mkdir(join(TEST_DIR, "logs"), { recursive: true });
  });

  after(async () => {
    if (lifecycle) {
      await lifecycle.shutdown();
    }
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(async () => {
    // Fresh instance for each test
    if (lifecycle) {
      await lifecycle.shutdown();
    }
    lifecycle = new TokenLifecycle({
      ttlDays: 1, // Short TTL for testing
      gracePeriodDays: 0.01, // ~15 minutes grace period
      rotationIntervalDays: 0,
      auditLogPath: join(TEST_DIR, "logs", "token-audit.jsonl"),
      tokenStorePath: join(TEST_DIR, "data", "tokens.json"),
    });
    await lifecycle.initialize();
  });

  // === Token 1–6: Core lifecycle operations ===

  it("T1 - issueToken creates a valid token", async () => {
    const result = await lifecycle.issueToken({ label: "peer-ray" });

    assert.ok(result.token, "token should be returned");
    assert.strictEqual(result.token.length, 64, "token should be 64 hex chars");
    assert.ok(result.id.startsWith("tok_"), "id should be prefixed");
    assert.ok(result.expiresAt, "expiresAt should be set");

    // Validate the token
    const validation = await lifecycle.validateToken(result.token);
    assert.strictEqual(validation.valid, true, "freshly issued token is valid");
    assert.strictEqual(validation.label, "peer-ray", "label should match");
  });

  it("T2 - validateToken rejects unknown tokens", async () => {
    const result = await lifecycle.validateToken("not-a-real-token-1234567890abcdef1234567890abcdef");
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, "unknown_token");
  });

  it("T3 - validateToken rejects expired tokens", async () => {
    // Issue with very short TTL (negative means already expired)
    const lc = new TokenLifecycle({
      ttlDays: -1, // Effectively: tokens expire immediately
      gracePeriodDays: 0,
      rotationIntervalDays: 0,
      auditLogPath: join(TEST_DIR, "logs", "token-audit-neg-ttl.jsonl"),
      tokenStorePath: join(TEST_DIR, "data", "tokens-neg-ttl.json"),
    });
    await lc.initialize();

    const { token } = await lc.issueToken({ label: "test-expired" });

    const validation = await lc.validateToken(token);
    assert.strictEqual(validation.valid, false);
    assert.strictEqual(validation.reason, "expired");

    await lc.shutdown();
  });

  it("T4 - revokeToken invalidates a token", async () => {
    const { token } = await lifecycle.issueToken({ label: "peer-woodhouse" });

    // Token valid before revocation
    const before = await lifecycle.validateToken(token);
    assert.strictEqual(before.valid, true);

    // Revoke
    const revResult = await lifecycle.revokeToken(token);
    assert.strictEqual(revResult.ok, true);

    // Token invalid after revocation
    const after = await lifecycle.validateToken(token);
    assert.strictEqual(after.valid, false);
    assert.strictEqual(after.reason, "revoked");
  });

  it("T5 - rotateToken creates a new valid token and marks old for grace period", async () => {
    const { token: oldToken, id: oldId } = await lifecycle.issueToken({
      label: "peer-ray",
    });

    const result = await lifecycle.rotateToken(oldToken);

    assert.ok(result.token, "new token returned");
    assert.notStrictEqual(result.token, oldToken, "new token differs from old");
    assert.strictEqual(result.previousId, oldId, "previousId links to old token");

    // New token is valid
    const newValid = await lifecycle.validateToken(result.token);
    assert.strictEqual(newValid.valid, true);

    // Old token still valid during grace period (revokedAt is in the future)
    const oldStatus = await lifecycle.getTokenStatus(oldToken);
    assert.ok(oldStatus, "old token still exists");
    assert.strictEqual(oldStatus.isInGracePeriod, true, "old token is in grace period");
    assert.strictEqual(oldStatus.isRevoked, false, "old token not fully revoked yet");

    // Old token is still valid during grace period
    const oldValid = await lifecycle.validateToken(oldToken);
    assert.strictEqual(oldValid.valid, true, "old token valid during grace period");
  });

  it("T6 - grace period expiry makes old token invalid after rotation", async () => {
    // Use very short grace period (~2 seconds)
    const lc = new TokenLifecycle({
      ttlDays: 1,
      gracePeriodDays: 2 / 86400, // ~2 seconds grace period
      rotationIntervalDays: 0,
      auditLogPath: join(TEST_DIR, "logs", "token-audit-grace.jsonl"),
      tokenStorePath: join(TEST_DIR, "data", "tokens-grace.json"),
    });
    await lc.initialize();

    const { token: oldToken } = await lc.issueToken({ label: "test-grace" });
    const { token: newToken } = await lc.rotateToken(oldToken);

    // Old token still valid during grace period
    let oldValid = await lc.validateToken(oldToken);
    assert.strictEqual(oldValid.valid, true, "valid during grace period");

    // Wait for grace period to expire
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Old token now invalid
    oldValid = await lc.validateToken(oldToken);
    assert.strictEqual(oldValid.valid, false, "invalid after grace period");
    assert.strictEqual(oldValid.reason, "revoked");

    // New token still valid
    const newValid = await lc.validateToken(newToken);
    assert.strictEqual(newValid.valid, true);

    await lc.shutdown();
  });

  // === Token 7–9: Middleware ===

  it("T7 - middleware allows requests with valid tokens", async () => {
    const { token } = await lifecycle.issueToken({ label: "test-middleware" });

    const mw = lifecycle.middleware();

    const req = {
      path: "/mesh/some-resource",
      headers: { authorization: `Bearer ${token}` },
    };
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };

    await new Promise((resolve) => {
      mw(req, res, () => {
        assert.ok(req.tokenInfo, "tokenInfo attached to request");
        assert.strictEqual(req.tokenInfo.valid, true);
        assert.strictEqual(req.tokenInfo.label, "test-middleware");
        resolve();
      });
    });
  });

  it("T8 - middleware rejects requests with missing auth header", async () => {
    const mw = lifecycle.middleware();

    const req = {
      path: "/mesh/some-resource",
      headers: {},
    };
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };

    await new Promise((resolve) => {
      mw(req, res, () => {
        assert.fail("should not call next");
      });
      // Small delay to allow middleware to complete
      setTimeout(() => {
        assert.strictEqual(res.statusCode, 401);
        assert.ok(res.body.error.includes("Missing"));
        resolve();
      }, 50);
    });
  });

  it("T9 - middleware exempts configured paths", async () => {
    const { token } = await lifecycle.issueToken({ label: "test-path-exempt" });

    const mw = lifecycle.middleware({
      exemptPaths: ["/public", "/health"],
    });

    const req = {
      path: "/health",
      headers: { authorization: `Bearer invalid-token-should-not-matter` },
    };
    let called = false;
    await new Promise((resolve) => {
      mw(req, {}, () => {
        called = true;
        resolve();
      });
    });

    assert.strictEqual(called, true, "exempt paths skip validation");
  });

  // === Token 10–12: Persistence & audit ===

  it("T10 - tokens persist across instances (load from disk)", async () => {
    const storePath = join(TEST_DIR, "data", "tokens-persist.json");
    const auditPath = join(TEST_DIR, "logs", "token-audit-persist.jsonl");

    // First instance: issue a token
    const lc1 = new TokenLifecycle({
      ttlDays: 7,
      tokenStorePath: storePath,
      auditLogPath: auditPath,
    });
    await lc1.initialize();
    const { token, id } = await lc1.issueToken({ label: "persist-test" });
    await lc1.shutdown();

    // Second instance: should reload the token
    const lc2 = new TokenLifecycle({
      ttlDays: 7,
      tokenStorePath: storePath,
      auditLogPath: auditPath,
    });
    await lc2.initialize();

    const validation = await lc2.validateToken(token);
    assert.strictEqual(validation.valid, true, "token persists across instances");
    assert.strictEqual(validation.label, "persist-test");

    await lc2.shutdown();
  });

  it("T11 - audit log records token events", async () => {
    const auditPath = join(TEST_DIR, "logs", "token-audit-records.jsonl");
    const lc = new TokenLifecycle({
      ttlDays: 7,
      tokenStorePath: join(TEST_DIR, "data", "tokens-audit-records.json"),
      auditLogPath: auditPath,
    });
    await lc.initialize();

    await lc.issueToken({ label: "audit-peer" });

    const logContent = await readFile(auditPath, "utf-8");
    const lines = logContent.trim().split("\n");

    // Should have initialization + issuance events
    assert.ok(lines.length >= 2, `at least 2 audit entries, got ${lines.length}`);

    // First entry should be "initialized"
    const firstEntry = JSON.parse(lines[0]);
    assert.strictEqual(firstEntry.event, "initialized");

    // Second entry should be "issued"
    const secondEntry = JSON.parse(lines[1]);
    assert.strictEqual(secondEntry.event, "issued");

    // Audit entries never contain plaintext tokens
    for (const line of lines) {
      const entry = JSON.parse(line);
      assert.ok(
        !entry.detail?.includes("token"),
        "audit entry should not contain plaintext token in detail"
      );
    }

    await lc.shutdown();
  });

  it("T12 - getTokenStatus returns correct status", async () => {
    const { token } = await lifecycle.issueToken({ label: "status-test" });

    const status = await lifecycle.getTokenStatus(token);

    assert.ok(status, "status returned for valid token");
    assert.strictEqual(status.label, "status-test");
    assert.strictEqual(status.isExpired, false);
    assert.strictEqual(status.isRevoked, false);
    assert.ok(status.issuedAt);
    assert.ok(status.expiresAt);

    // Unknown token returns null
    const unknown = await lifecycle.getTokenStatus("unknown-token-1234567890abcdef1234567890abcdef");
    assert.strictEqual(unknown, null);
  });
});
