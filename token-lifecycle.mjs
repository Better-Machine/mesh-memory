/**
 * @module token-lifecycle
 * @description Ephemeral token issuance, rotation, and revocation service.
 * Provides HTTP endpoints for token management with SQLite persistence.
 *
 * @author Liz (Better Machine)
 * @version 1.0.0
 */

import { createServer } from "node:http";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { mkdir, readFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { Database } from "bun:sqlite";

// ============================================================================
// Configuration
// ============================================================================

const CONFIG_PATH = resolve(homedir(), ".openclaw/workspace/mesh-memory.config.local.json");
const TOKEN_DB_PATH = resolve(homedir(), ".openclaw/workspace/memory/mesh/tokens.db");
const DEFAULT_PORT = 18805;
const DEFAULT_TTL_HOURS = 24;
const DEFAULT_ROTATION_INTERVAL_HOURS = 12;

// ============================================================================
// Token Utilities
// ============================================================================

/**
 * Generate a cryptographically secure random token.
 * @returns {string} Base64url-encoded 32-byte token
 */
function generateToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * Hash a token for storage (constant-time comparison).
 * @param {string} token
 * @returns {string} SHA-256 hash
 */
function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Calculate expiration timestamp.
 * @param {number} ttlHours
 * @returns {string} ISO 8601 timestamp
 */
function calculateExpiry(ttlHours) {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + ttlHours);
  return expiry.toISOString();
}

// ============================================================================
// Database Layer
// ============================================================================

class TokenDatabase {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.initSchema();
    this.revokedCache = new Set();
    this.loadRevokedCache();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        peer_name TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        issued_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0,
        revoked_at TEXT,
        token_type TEXT NOT NULL DEFAULT 'ephemeral' -- 'master' or 'ephemeral'
      );

      CREATE INDEX IF NOT EXISTS idx_token_hash ON tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_expires_at ON tokens(expires_at);
      CREATE INDEX IF NOT EXISTS idx_revoked ON tokens(revoked);
      CREATE INDEX IF NOT EXISTS idx_peer_name ON tokens(peer_name);
    `);
  }

  loadRevokedCache() {
    const rows = this.db.query("SELECT token_hash FROM tokens WHERE revoked = 1").all();
    for (const row of rows) {
      this.revokedCache.add(row.token_hash);
    }
  }

  /**
   * Store a new token.
   * @param {Object} params
   * @returns {Object} Stored token record
   */
  storeToken({ peerName, tokenHash, expiresAt, tokenType = "ephemeral" }) {
    const result = this.db.query(`
      INSERT INTO tokens (peer_name, token_hash, expires_at, token_type)
      VALUES (?, ?, ?, ?)
      RETURNING id, peer_name, issued_at, expires_at, token_type
    `).get(peerName, tokenHash, expiresAt, tokenType);

    return result;
  }

  /**
   * Validate a token (check exists, not expired, not revoked).
   * @param {string} tokenHash
   * @returns {Object|null} Token record if valid, null otherwise
   */
  validateToken(tokenHash) {
    // Fast-path: check revoked cache
    if (this.revokedCache.has(tokenHash)) {
      return null;
    }

    const row = this.db.query(`
      SELECT id, peer_name, issued_at, expires_at, revoked, token_type
      FROM tokens
      WHERE token_hash = ?
    `).get(tokenHash);

    if (!row) return null;
    if (row.revoked) return null;

    const now = new Date().toISOString();
    if (row.expires_at < now) return null;

    return row;
  }

  /**
   * Revoke a token.
   * @param {string} tokenHash
   * @returns {boolean} Success
   */
  revokeToken(tokenHash) {
    const result = this.db.query(`
      UPDATE tokens
      SET revoked = 1, revoked_at = datetime('now')
      WHERE token_hash = ? AND revoked = 0
    `).run(tokenHash);

    if (result.changes > 0) {
      this.revokedCache.add(tokenHash);
      return true;
    }
    return false;
  }

  /**
   * Find tokens nearing expiry for auto-rotation.
   * @param {number} hoursBeforeExpiry
   * @returns {Array} Tokens to rotate
   */
  findTokensForRotation(hoursBeforeExpiry = 12) {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() + hoursBeforeExpiry);

    return this.db.query(`
      SELECT id, peer_name, token_hash, expires_at
      FROM tokens
      WHERE revoked = 0
        AND expires_at <= ?
        AND token_type = 'ephemeral'
    `).all(cutoff.toISOString());
  }

  /**
   * Clean up expired tokens older than retention period.
   * @param {number} retentionDays
   * @returns {number} Number of tokens purged
   */
  purgeExpiredTokens(retentionDays = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const result = this.db.query(`
      DELETE FROM tokens
      WHERE expires_at < ?
        AND (revoked = 1 OR expires_at < datetime('now', '-1 day'))
    `).run(cutoff.toISOString());

    return result.changes;
  }

  /**
   * Get token stats for monitoring.
   * @returns {Object} Token statistics
   */
  getStats() {
    const stats = this.db.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN revoked = 1 THEN 1 ELSE 0 END) as revoked,
        SUM(CASE WHEN expires_at > datetime('now') AND revoked = 0 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN expires_at <= datetime('now') AND revoked = 0 THEN 1 ELSE 0 END) as expired
      FROM tokens
    `).get();

    return stats;
  }

  close() {
    this.db.close();
  }
}

// ============================================================================
// Configuration Loader
// ============================================================================

async function loadConfig() {
  try {
    const configText = await readFile(CONFIG_PATH, "utf-8");
    const config = JSON.parse(configText);
    return {
      port: config.token?.port || DEFAULT_PORT,
      masterToken: config.token?.masterToken || null,
      ephemeralTokenTtlHours: config.token?.ephemeralTokenTtlHours || DEFAULT_TTL_HOURS,
      autoRotate: config.token?.autoRotate !== false,
      rotationIntervalHours: config.token?.rotationIntervalHours || DEFAULT_ROTATION_INTERVAL_HOURS,
    };
  } catch (err) {
    console.error("[token-lifecycle] Failed to load config:", err.message);
    console.error("[token-lifecycle] Please ensure mesh-memory.config.local.json exists with token.masterToken");
    process.exit(1);
  }
}

// ============================================================================
// HTTP Server
// ============================================================================

function createTokenServer(config, db) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${config.port}`);
    const startTime = Date.now();

    // Set common headers
    res.setHeader("Content-Type", "application/json");

    // Log request (without sensitive data)
    console.log(`[token-lifecycle] ${req.method} ${url.pathname}`);

    try {
      // Parse request body for POST requests
      let body = {};
      if (req.method === "POST") {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const bodyText = Buffer.concat(chunks).toString();
        if (bodyText) {
          try {
            body = JSON.parse(bodyText);
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
            return;
          }
        }
      }

      // Extract authorization header
      const authHeader = req.headers.authorization || "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

      // Route handlers
      switch (url.pathname) {
        case "/mesh/token/issue":
          await handleIssueToken(req, res, body, bearerToken, config, db);
          break;

        case "/mesh/token/rotate":
          await handleRotateToken(req, res, body, bearerToken, config, db);
          break;

        case "/mesh/token/revoke":
          await handleRevokeToken(req, res, body, bearerToken, config, db);
          break;

        case "/mesh/token/validate":
          await handleValidateToken(req, res, body, db);
          break;

        case "/mesh/token/stats":
          await handleStats(req, res, bearerToken, config, db);
          break;

        case "/health":
          res.statusCode = 200;
          res.end(JSON.stringify({ status: "ok", service: "token-lifecycle" }));
          break;

        default:
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Not found" }));
      }
    } catch (err) {
      console.error("[token-lifecycle] Request error:", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "Internal server error" }));
    }

    const duration = Date.now() - startTime;
    console.log(`[token-lifecycle] Response time: ${duration}ms`);
  });

  return server;
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * POST /mesh/token/issue
 * Issue a new ephemeral token (requires master token).
 */
async function handleIssueToken(req, res, body, bearerToken, config, db) {
  // Verify master token
  if (!bearerToken || hashToken(bearerToken) !== hashToken(config.masterToken)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Unauthorized: invalid master token" }));
    return;
  }

  const peerName = body.peerName;
  if (!peerName || typeof peerName !== "string") {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Bad request: peerName is required" }));
    return;
  }

  const ttlHours = body.ttlHours || config.ephemeralTokenTtlHours;
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = calculateExpiry(ttlHours);

  const record = db.storeToken({
    peerName,
    tokenHash,
    expiresAt,
    tokenType: "ephemeral",
  });

  // Log issuance (token value itself is NOT logged)
  console.log(`[token-lifecycle] Issued ephemeral token for peer=${peerName}, expires=${expiresAt}`);

  res.statusCode = 200;
  res.end(JSON.stringify({
    token,
    expiresAt,
    peerName: record.peer_name,
    issuedAt: record.issued_at,
  }));
}

/**
 * POST /mesh/token/rotate
 * Rotate an ephemeral token (requires valid ephemeral token).
 */
async function handleRotateToken(req, res, body, bearerToken, config, db) {
  if (!bearerToken) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Unauthorized: token required" }));
    return;
  }

  const oldTokenHash = hashToken(bearerToken);
  const oldTokenRecord = db.validateToken(oldTokenHash);

  if (!oldTokenRecord) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Unauthorized: invalid or expired token" }));
    return;
  }

  // Revoke old token
  db.revokeToken(oldTokenHash);
  console.log(`[token-lifecycle] Rotated token for peer=${oldTokenRecord.peer_name}`);

  // Issue new token
  const newToken = generateToken();
  const newTokenHash = hashToken(newToken);
  const expiresAt = calculateExpiry(config.ephemeralTokenTtlHours);

  const record = db.storeToken({
    peerName: oldTokenRecord.peer_name,
    tokenHash: newTokenHash,
    expiresAt,
    tokenType: "ephemeral",
  });

  res.statusCode = 200;
  res.end(JSON.stringify({
    token: newToken,
    expiresAt,
    peerName: record.peer_name,
    issuedAt: record.issued_at,
  }));
}

/**
 * POST /mesh/token/revoke
 * Revoke a token (requires master token).
 */
async function handleRevokeToken(req, res, body, bearerToken, config, db) {
  // Verify master token
  if (!bearerToken || hashToken(bearerToken) !== hashToken(config.masterToken)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Unauthorized: invalid master token" }));
    return;
  }

  const tokenToRevoke = body.token;
  if (!tokenToRevoke || typeof tokenToRevoke !== "string") {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Bad request: token is required" }));
    return;
  }

  const tokenHash = hashToken(tokenToRevoke);
  const success = db.revokeToken(tokenHash);

  if (success) {
    console.log(`[token-lifecycle] Revoked token`);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, revoked: true }));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Token not found or already revoked" }));
  }
}

/**
 * POST /mesh/token/validate
 * Validate a token (public endpoint, no auth required).
 */
async function handleValidateToken(req, res, body, db) {
  const token = body.token;
  if (!token || typeof token !== "string") {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Bad request: token is required" }));
    return;
  }

  const tokenHash = hashToken(token);
  const record = db.validateToken(tokenHash);

  if (record) {
    res.statusCode = 200;
    res.end(JSON.stringify({
      valid: true,
      peerName: record.peer_name,
      expiresAt: record.expires_at,
      tokenType: record.token_type,
    }));
  } else {
    res.statusCode = 200;
    res.end(JSON.stringify({ valid: false }));
  }
}

/**
 * GET /mesh/token/stats
 * Get token statistics (requires master token).
 */
async function handleStats(req, res, bearerToken, config, db) {
  // Verify master token
  if (!bearerToken || hashToken(bearerToken) !== hashToken(config.masterToken)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const stats = db.getStats();
  res.statusCode = 200;
  res.end(JSON.stringify({
    ...stats,
    retentionDays: 30,
    autoRotate: config.autoRotate,
    rotationIntervalHours: config.rotationIntervalHours,
  }));
}

// ============================================================================
// Auto-Rotation Background Task
// ============================================================================

function startAutoRotation(config, db) {
  if (!config.autoRotate) {
    console.log("[token-lifecycle] Auto-rotation disabled");
    return;
  }

  const intervalMs = config.rotationIntervalHours * 60 * 60 * 1000;

  async function rotationTask() {
    try {
      const tokensToRotate = db.findTokensForRotation(config.rotationIntervalHours);

      if (tokensToRotate.length > 0) {
        console.log(`[token-lifecycle] Auto-rotating ${tokensToRotate.length} tokens`);

        for (const token of tokensToRotate) {
          // Revoke old token
          db.revokeToken(token.token_hash);

          // Issue new token (note: we can't auto-distribute the new token,
          // this would require A2A notification to the peer)
          console.log(`[token-lifecycle] Auto-rotated token for peer=${token.peer_name}`);
        }
      }

      // Cleanup expired tokens
      const purged = db.purgeExpiredTokens();
      if (purged > 0) {
        console.log(`[token-lifecycle] Purged ${purged} expired tokens`);
      }
    } catch (err) {
      console.error("[token-lifecycle] Rotation task error:", err);
    }
  }

  // Run immediately, then on interval
  rotationTask();
  setInterval(rotationTask, intervalMs);

  console.log(`[token-lifecycle] Auto-rotation enabled (interval: ${config.rotationIntervalHours}h)`);
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  console.log("[token-lifecycle] Starting token lifecycle service...");

  // Ensure directories exist
  await mkdir(dirname(TOKEN_DB_PATH), { recursive: true });

  // Load configuration
  const config = await loadConfig();

  if (!config.masterToken) {
    console.error("[token-lifecycle] ERROR: token.masterToken not configured");
    console.error("[token-lifecycle] Add to mesh-memory.config.local.json:");
    console.error('  "token": { "masterToken": "' + generateToken() + '" }');
    process.exit(1);
  }

  // Initialize database
  const db = new TokenDatabase(TOKEN_DB_PATH);
  console.log("[token-lifecycle] Database initialized at", TOKEN_DB_PATH);

  // Create HTTP server
  const server = createTokenServer(config, db);

  server.listen(config.port, "127.0.0.1", () => {
    console.log(`[token-lifecycle] Server listening on http://127.0.0.1:${config.port}`);
    console.log("[token-lifecycle] Endpoints:");
    console.log("  POST /mesh/token/issue   - Issue new token (master auth)");
    console.log("  POST /mesh/token/rotate  - Rotate token (ephemeral auth)");
    console.log("  POST /mesh/token/revoke  - Revoke token (master auth)");
    console.log("  POST /mesh/token/validate - Validate token (public)");
    console.log("  GET  /mesh/token/stats   - Token statistics (master auth)");
    console.log("  GET  /health             - Health check");
  });

  // Start auto-rotation background task
  startAutoRotation(config, db);

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[token-lifecycle] Shutting down...");
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });

  process.on("SIGTERM", () => {
    console.log("\n[token-lifecycle] Shutting down...");
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}

main().catch((err) => {
  console.error("[token-lifecycle] Fatal error:", err);
  process.exit(1);
});
