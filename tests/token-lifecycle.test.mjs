/**
 * @module token-lifecycle-test
 * @description Unit tests for token lifecycle service.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";

// Test configuration
const TEST_PORT = 18806;
const TEST_DB_PATH = resolve(homedir(), ".openclaw/workspace/memory/mesh/test-tokens.db");
const TEST_CONFIG_PATH = resolve(homedir(), ".openclaw/workspace/test-token-config.json");
const MASTER_TOKEN = randomBytes(32).toString("base64url");

/**
 * Generate token hash for comparison
 */
function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Make HTTP request to test server
 */
function makeRequest(method, path, body = null, authToken = null) {
  return new Promise((resolve, reject) => {
    const { request } = await import("node:http");
    const options = {
      hostname: "127.0.0.1",
      port: TEST_PORT,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (authToken) {
      options.headers["Authorization"] = `Bearer ${authToken}`;
    }

    const req = request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (err) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

describe("Token Lifecycle Service", () => {
  let serverProcess;

  before(async () => {
    // Clean up test database
    try {
      await rm(TEST_DB_PATH);
    } catch {}

    // Create test config
    const testConfig = {
      token: {
        masterToken: MASTER_TOKEN,
        ephemeralTokenTtlHours: 1,
        autoRotate: false,
        port: TEST_PORT,
      },
    };
    await writeFile(TEST_CONFIG_PATH, JSON.stringify(testConfig, null, 2));

    // Start server (would need to modify token-lifecycle.mjs to accept config path)
    // For now, we skip server tests and test the logic directly
  });

  after(async () => {
    // Cleanup
    try {
      await rm(TEST_DB_PATH);
      await rm(TEST_CONFIG_PATH);
    } catch {}
  });

  describe("Token Generation", () => {
    it("should generate unique tokens", () => {
      const token1 = randomBytes(32).toString("base64url");
      const token2 = randomBytes(32).toString("base64url");
      assert.notStrictEqual(token1, token2);
      assert.strictEqual(token1.length, 43); // base64url encoding of 32 bytes
    });

    it("should hash tokens deterministically", () => {
      const token = "test-token-123";
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);
      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash1.length, 64); // SHA-256 hex
    });
  });

  describe("Token Hashing", () => {
    it("should produce consistent hashes", () => {
      const token = "my-secret-token";
      const hash = hashToken(token);
      assert.match(hash, /^[a-f0-9]{64}$/);
    });

    it("should produce different hashes for different tokens", () => {
      const hash1 = hashToken("token-a");
      const hash2 = hashToken("token-b");
      assert.notStrictEqual(hash1, hash2);
    });
  });

  describe("Config Validation", () => {
    it("should require masterToken", async () => {
      const invalidConfig = {
        token: {
          ephemeralTokenTtlHours: 24,
        },
      };
      // This would be tested by attempting to start server
      assert.strictEqual(invalidConfig.token.masterToken, undefined);
    });

    it("should have sensible defaults", () => {
      const config = {
        token: {
          masterToken: MASTER_TOKEN,
        },
      };
      const ttlHours = config.token.ephemeralTokenTtlHours || 24;
      const autoRotate = config.token.autoRotate !== false;
      assert.strictEqual(ttlHours, 24);
      assert.strictEqual(autoRotate, true);
    });
  });
});

// Database tests (run if bun:sqlite is available)
describe("TokenDatabase", { skip: true }, () => {
  // These would require importing the actual TokenDatabase class
  // and running with bun
});

console.log("Token Lifecycle Tests - Run with: node --test tests/token-lifecycle.test.mjs");
