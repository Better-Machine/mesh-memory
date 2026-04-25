/**
 * @module token-lifecycle
 * @description Ephemeral token issuance, rotation, and revocation service.
 * Provides HTTP endpoints for token management with SQLite persistence.
 * 
 * CHANGES: Ported from bun:sqlite to better-sqlite3 (Node.js compatible)
 *
 * @author Liz (Better Machine)
 * @version 1.1.0
 */

import { createServer } from "node:http";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { mkdir, readFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import Database from "better-sqlite3";

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
    this.db.pragma("journal_mode = WAL");
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
        token_type TEXT NOT NULL DEFAULT 'ephemeral'
      );

      CREATE INDEX IF NOT EXISTS idx_token_hash ON tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_expires_at ON tokens(expires_at);
      CREATE INDEX IF NOT EXISTS idx_revoked ON tokens(revoked);
      CREATE INDEX IF NOT EXISTS idx_peer_name ON tokens(peer_name);
    `);
  }

  loadRevokedCache() {
    const stmt = this.db.prepare("SELECT token_hash FROM tokens WHERE revoked = 1");
    const rows = stmt.all();
    for (const row of rows) {
      this.revokedCache.add(row.token_hash);
    }
  }

  storeToken({ peerName, tokenHash, expiresAt, tokenType = "ephemeral" }) {
    const insertStmt = this.db.prepare(`
      INSERT INTO tokens (peer_name, token_hash, expires_at, token_type)
      VALUES (?, ?, ?, ?)
    `);
    const info = insertStmt.run(peerName, tokenHash, expiresAt, tokenType);

    const fetchStmt = this.db.prepare(`
      SELECT id, peer_name, issued_at, expires_at, token_type
      FROM tokens WHERE rowid = ?
    `);
    return fetchStmt.get(info.lastInsertRowid);
  }

  validateToken(tokenHash) {
    if (this.revokedCache.has(tokenHash)) return null;

    const stmt = this.db.prepare(`
      SELECT id, peer_name, issued_at, expires_at, revoked, token_type
      FROM tokens WHERE token_hash = ?
    `);
    const row = stmt.get(tokenHash);

    if (!row || row.revoked) return null;

    const now = new Date().toISOString();
    if (row.expires_at < now) return null;

    return row;
  }

  revokeToken(tokenHash) {
    const stmt = this.db.prepare(`
      UPDATE tokens
      SET revoked = 1, revoked_at = datetime('now')
      WHERE token_hash = ? AND revoked = 0
    `);
    const info = stmt.run(tokenHash);

    if (info.changes > 0) {
      this.revokedCache.add(tokenHash);
      return true;
    }
    return false;
  }

  findTokensForRotation(hoursBeforeExpiry = 12) {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() + hoursBeforeExpiry);

    const stmt = this.db.prepare(`
      SELECT id, peer_name, token_hash, expires_at
      FROM tokens
      WHERE revoked = 0 AND expires_at <= ? AND token_type = 'ephemeral'
    `);
    return stmt.all(cutoff.toISOString());
  }

  purgeExpiredTokens(retentionDays = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const stmt = this.db.prepare(`
      DELETE FROM tokens
      WHERE expires_at < ? AND (revoked = 1 OR expires_at < datetime('now', '-1 day'))
    `);
    const info = stmt.run(cutoff.toISOString());
    return info.changes;
  }

  getStats() {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN revoked = 1 THEN 1 ELSE 0 END) as revoked,
        SUM(CASE WHEN expires_at > datetime('now') AND revoked = 0 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN expires_at <= datetime('now') AND revoked = 0 THEN 1 ELSE 0 END) as expired
      FROM tokens
    `);
    return stmt.get();
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
    process.exit(1);
  }
}

// ============================================================================
// HTTP Server
// ============================================================================

function createTokenServer(config, db) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${config.port}`);
    res.setHeader("Content-Type", "application/json");

    console.log(`[token-lifecycle] ${req.method} ${url.pathname}`);

    try {
      let body = {};
      if (req.method === "POST") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bodyText = Buffer.concat(chunks).toString();
        if (bodyText) {
          try { body = JSON.parse(bodyText); }
          catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
            return;
          }
        }
      }

      const authHeader = req.headers.authorization || "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

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
  });

  return server;
}

// ============================================================================
// Route Handlers
// ============================================================================

async function handleIssueToken(req, res, body, bearerToken, config, db) {
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

  const record = db.storeToken({ peerName, tokenHash, expiresAt, tokenType: "ephemeral" });

  console.log(`[token-lifecycle] Issued token for peer=${peerName}, expires=${expiresAt}`);

  res.statusCode = 200;
  res.end(JSON.stringify({ token, expiresAt, peerName: record.peer_name, issuedAt: record.issued_at }));
}

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

  db.revokeToken(oldTokenHash);
  console.log(`[token-lifecycle] Rotated token for peer=${oldTokenRecord.peer_name}`);

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
  res.end(JSON.stringify({ token: newToken, expiresAt, peerName: record.peer_name, issuedAt: record.issued_at }));
}

async function handleRevokeToken(req, res, body, bearerToken, config, db) {
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
    res.end(JSON.stringify({ valid: true, peerName: record.peer_name, expiresAt: record.expires_at, tokenType: record.token_type }));
  } else {
    res.statusCode = 200;
    res.end(JSON.stringify({ valid: false }));
  }
}

async function handleStats(req, res, bearerToken, config, db) {
  if (!bearerToken || hashToken(bearerToken) !== hashToken(config.masterToken)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const stats = db.getStats();
  res.statusCode = 200;
  res.end(JSON.stringify({ ...stats, retentionDays: 30, autoRotate: config.autoRotate, rotationIntervalHours: config.rotationIntervalHours }));
}

// ============================================================================
// Auto-Rotation
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
          db.revokeToken(token.token_hash);
          console.log(`[token-lifecycle] Rotated token for peer=${token.peer_name}`);
        }
      }

      const purged = db.purgeExpiredTokens();
      if (purged > 0) console.log(`[token-lifecycle] Purged ${purged} expired tokens`);
    } catch (err) {
      console.error("[token-lifecycle] Rotation task error:", err);
    }
  }

  rotationTask();
  setInterval(rotationTask, intervalMs);
  console.log(`[token-lifecycle] Auto-rotation enabled (interval: ${config.rotationIntervalHours}h)`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("[token-lifecycle] Starting token lifecycle service v1.1.0...");

  await mkdir(dirname(TOKEN_DB_PATH), { recursive: true });
  const config = await loadConfig();

  if (!config.masterToken) {
    console.error("[token-lifecycle] ERROR: token.masterToken not configured");
    console.error('[token-lifecycle] Add to mesh-memory.config.local.json: { "token": { "masterToken": "..." } }');
    process.exit(1);
  }

  const db = new TokenDatabase(TOKEN_DB_PATH);
  console.log("[token-lifecycle] Database initialized at", TOKEN_DB_PATH);

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

  startAutoRotation(config, db);

  process.on("SIGINT", () => {
    console.log("\n[token-lifecycle] Shutting down...");
    server.close(() => { db.close(); process.exit(0); });
  });

  process.on("SIGTERM", () => {
    console.log("\n[token-lifecycle] Shutting down...");
    server.close(() => { db.close(); process.exit(0); });
  });
}

main().catch((err) => {
  console.error("[token-lifecycle] Fatal error:", err);
  process.exit(1);
});
