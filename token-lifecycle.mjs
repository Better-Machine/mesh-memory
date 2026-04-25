/**
 * @module token-lifecycle
 * @description Ephemeral token issuance, rotation, and revocation service.
 * Provides HTTP endpoints for token management with SQLite persistence.
 * 
 * CHANGES v1.1.0: Ported from bun:sqlite to better-sqlite3 (Node.js compatible)
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

function generateToken() {
  return randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function calculateExpiry(ttlHours) {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + ttlHours);
  return expiry.toISOString();
}

// ============================================================================
// Database Layer (better-sqlite3 API)
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
    const insert = this.db.prepare(`
      INSERT INTO tokens (peer_name, token_hash, expires_at, token_type)
      VALUES (?, ?, ?, ?)
    `);
    const info = insert.run(peerName, tokenHash, expiresAt, tokenType);
    
    const fetch = this.db.prepare(`
      SELECT id, peer_name, issued_at, expires_at, token_type
      FROM tokens WHERE rowid = ?
    `);
    return fetch.get(info.lastInsertRowid);
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
      UPDATE tokens SET revoked = 1, revoked_at = datetime('now')
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
      FROM tokens WHERE revoked = 0 AND expires_at <= ? AND token_type = 'ephemeral'
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
// Config Loader
// ============================================================================

async function loadConfig() {
  try {
    const text = await readFile(CONFIG_PATH, "utf-8");
    const config = JSON.parse(text);
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
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${config.port}`);
    res.setHeader("Content-Type", "application/json");
    console.log(`[token-lifecycle] ${req.method} ${url.pathname}`);

    try {
      let body = {};
      if (req.method === "POST") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const text = Buffer.concat(chunks).toString();
        if (text) {
          try { body = JSON.parse(text); }
          catch { 
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }
        }
      }

      const auth = req.headers.authorization || "";
      const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;

      switch (url.pathname) {
        case "/mesh/token/issue":
          await handleIssue(req, res, body, bearer, config, db);
          break;
        case "/mesh/token/rotate":
          await handleRotate(req, res, body, bearer, config, db);
          break;
        case "/mesh/token/revoke":
          await handleRevoke(req, res, body, bearer, config, db);
          break;
        case "/mesh/token/validate":
          await handleValidate(req, res, body, db);
          break;
        case "/mesh/token/stats":
          await handleStats(req, res, bearer, config, db);
          break;
        case "/health":
          res.statusCode = 200;
          res.end(JSON.stringify({ status: "ok" }));
          break;
        default:
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Not found" }));
      }
    } catch (err) {
      console.error("[token-lifecycle] Error:", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "Internal error" }));
    }
  });
}

// ============================================================================
// Route Handlers
// ============================================================================

async function handleIssue(req, res, body, bearer, config, db) {
  if (!bearer || hashToken(bearer) !== hashToken(config.masterToken)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const peerName = body.peerName;
  if (!peerName || typeof peerName !== "string") {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "peerName required" }));
    return;
  }

  const ttl = body.ttlHours || config.ephemeralTokenTtlHours;
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = calculateExpiry(ttl);

  const record = db.storeToken({ peerName, tokenHash, expiresAt, tokenType: "ephemeral" });
  console.log(`[token-lifecycle] Issued token for peer=${peerName}`);

  res.statusCode = 200;
  res.end(JSON.stringify({ token, expiresAt, peerName: record.peer_name, issuedAt: record.issued_at }));
}

async function handleRotate(req, res, body, bearer, config, db) {
  if (!bearer) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Token required" }));
    return;
  }

  const oldHash = hashToken(bearer);
  const oldRecord = db.validateToken(oldHash);
  
  if (!oldRecord) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Invalid or expired token" }));
    return;
  }

  db.revokeToken(oldHash);
  console.log(`[token-lifecycle] Rotated token for peer=${oldRecord.peer_name}`);

  const newToken = generateToken();
  const newHash = hashToken(newToken);
  const expiresAt = calculateExpiry(config.ephemeralTokenTtlHours);
  
  const record = db.storeToken({
    peerName: oldRecord.peer_name,
    tokenHash: newHash,
    expiresAt,
    tokenType: "ephemeral"
  });

  res.statusCode = 200;
  res.end(JSON.stringify({ token: newToken, expiresAt, peerName: record.peer_name, issuedAt: record.issued_at }));
}

async function handleRevoke(req, res, body, bearer, config, db) {
  if (!bearer || hashToken(bearer) !== hashToken(config.masterToken)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const tokenToRevoke = body.token;
  if (!tokenToRevoke || typeof tokenToRevoke !== "string") {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "token required" }));
    return;
  }

  const tokenHash = hashToken(tokenToRevoke);
  const success = db.revokeToken(tokenHash);

  if (success) {
    console.log("[token-lifecycle] Revoked token");
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, revoked: true }));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Token not found or already revoked" }));
  }
}

async function handleValidate(req, res, body, db) {
  const token = body.token;
  if (!token || typeof token !== "string") {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "token required" }));
    return;
  }

  const tokenHash = hashToken(token);
  const record = db.validateToken(tokenHash);

  if (record) {
    res.statusCode = 200;
    res.end(JSON.stringify({ valid: true, peerName: record.peer_name, expiresAt: record.expires_at }));
  } else {
    res.statusCode = 200;
    res.end(JSON.stringify({ valid: false }));
  }
}

async function handleStats(req, res, bearer, config, db) {
  if (!bearer || hashToken(bearer) !== hashToken(config.masterToken)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const stats = db.getStats();
  res.statusCode = 200;
  res.end(JSON.stringify({ ...stats, autoRotate: config.autoRotate }));
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

  async function task() {
    const tokens = db.findTokensForRotation(config.rotationIntervalHours);
    if (tokens.length > 0) {
      console.log(`[token-lifecycle] Auto-rotating ${tokens.length} tokens`);
      for (const t of tokens) {
        db.revokeToken(t.token_hash);
        console.log(`[token-lifecycle] Rotated for peer=${t.peer_name}`);
      }
    }
    const purged = db.purgeExpiredTokens();
    if (purged > 0) console.log(`[token-lifecycle] Purged ${purged} expired tokens`);
  }

  task();
  setInterval(task, intervalMs);
  console.log(`[token-lifecycle] Auto-rotation enabled (${config.rotationIntervalHours}h interval)`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("[token-lifecycle] Starting v1.1.0...");

  await mkdir(dirname(TOKEN_DB_PATH), { recursive: true });
  const config = await loadConfig();

  if (!config.masterToken) {
    console.error("[token-lifecycle] ERROR: token.masterToken not configured");
    process.exit(1);
  }

  const db = new TokenDatabase(TOKEN_DB_PATH);
  console.log("[token-lifecycle] Database ready at", TOKEN_DB_PATH);

  const server = createTokenServer(config, db);

  server.listen(config.port, "127.0.0.1", () => {
    console.log(`[token-lifecycle] Listening on http://127.0.0.1:${config.port}`);
    console.log("  POST /mesh/token/issue    (master auth)");
    console.log("  POST /mesh/token/rotate   (ephemeral auth)");
    console.log("  POST /mesh/token/revoke   (master auth)");
    console.log("  POST /mesh/token/validate (public)");
    console.log("  GET  /mesh/token/stats    (master auth)");
    console.log("  GET  /health");
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

main().catch(err => {
  console.error("[token-lifecycle] Fatal:", err);
  process.exit(1);
});
