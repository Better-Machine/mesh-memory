#!/usr/bin/env node

/**
 * @module token-lifecycle
 * @description Token lifecycle management for mesh-memory Phase 2.
 *
 * Provides:
 * - Token issuance with configurable TTL (default 7 days)
 * - Token expiry check middleware (Express-compatible)
 * - Key rotation with grace period (old key valid during rotation window)
 * - Audit log of all token events (issuance, rotation, revocation, validation)
 * - In-memory cache for fast validation
 *
 * Security:
 * - Tokens are never logged in audit entries
 * - Revoked tokens cached in-memory for immediate rejection
 * - Rotation grace period allows seamless key transitions
 */

import crypto from "node:crypto";
import { appendFile, mkdir, access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { loadConfig } from "../config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// === Configuration defaults ===
const DEFAULT_TTL_DAYS = 7;
const DEFAULT_GRACE_PERIOD_DAYS = 1;
const DEFAULT_ROTATION_INTERVAL_DAYS = 6;
const AUDIT_LOG_PATH = join(homedir(), ".openclaw/workspace/projects/mesh-memory/logs/token-audit.jsonl");

// Token storage location
const TOKEN_STORE_PATH = join(homedir(), ".openclaw/workspace/projects/mesh-memory/data/tokens.json");

// === Token Lifecycle Manager ===

/**
 * @typedef {Object} TokenEntry
 * @property {string} id - Unique token identifier
 * @property {string} tokenHash - SHA-256 hash of the token
 * @property {string} issuedAt - ISO timestamp of issuance
 * @property {string} expiresAt - ISO timestamp of expiry
 * @property {string} revokedAt - ISO timestamp of revocation (null if active)
 * @property {string} rotatedFrom - Previous token ID this replaced
 * @property {string} label - Human-readable label (e.g. peer name)
 */

/**
 * @typedef {Object} AuditEntry
 * @property {string} timestamp - ISO timestamp
 * @property {string} event - Event type (issued|rotated|revoked|validated|rotationFailed)
 * @property {string} tokenId - Token ID (first 8 chars only for security)
 * @property {string} label - Token label
 * @property {string} detail - Additional detail
 */

class TokenLifecycle {
  constructor(options = {}) {
    this.ttlDays = options.ttlDays ?? DEFAULT_TTL_DAYS;
    this.gracePeriodDays = options.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS;
    this.rotationIntervalDays = options.rotationIntervalDays ?? DEFAULT_ROTATION_INTERVAL_DAYS;
    this.auditLogPath = options.auditLogPath ?? AUDIT_LOG_PATH;
    this.tokenStorePath = options.tokenStorePath ?? TOKEN_STORE_PATH;

    /** @type {Map<string, TokenEntry>} */
    this.tokens = new Map();

    /** @type {Set<string>} In-memory cache of revoked token hashes */
    this.revokedCache = new Set();

    /** @type {Map<string, string>} tokenHash → plaintext token mapping (only kept briefly) */
    this._pendingTokens = new Map();

    this._initialized = false;
    this._rotationTimer = null;
  }

  /**
   * Initialize: load persisted tokens and start rotation scheduler.
   */
  async initialize() {
    if (this._initialized) return;

    // Ensure directories exist
    await mkdir(dirname(this.auditLogPath), { recursive: true });
    await mkdir(dirname(this.tokenStorePath), { recursive: true });

    // Load persisted tokens
    await this._loadTokens();

    // Build revoked cache
    for (const [id, entry] of this.tokens) {
      if (entry.revokedAt) {
        this.revokedCache.add(entry.tokenHash);
      }
    }

    // Start rotation timer if configured
    if (this.rotationIntervalDays > 0) {
      const intervalMs = this.rotationIntervalDays * 24 * 60 * 60 * 1000;
      this._rotationTimer = setInterval(() => this._checkRotations(), intervalMs);
    }

    this._initialized = true;
    await this._logAudit({
      event: "initialized",
      tokenId: "system",
      label: "system",
      detail: `TL=${this.ttlDays}d GP=${this.gracePeriodDays}d RI=${this.rotationIntervalDays}d`,
    });
  }

  /**
   * Issue a new token.
   * @param {Object} params
   * @param {string} params.label - Human-readable label (e.g., peer name)
   * @param {number} [params.ttlDays] - Override default TTL
   * @returns {Promise<{token: string, id: string, expiresAt: string}>}
   */
  async issueToken({ label, ttlDays } = {}) {
    if (!label || typeof label !== "string") {
      throw new Error("label is required for token issuance");
    }

    await this._ensureInit();

    const ttl = ttlDays ?? this.ttlDays;
    const plaintext = crypto.randomBytes(32).toString("hex"); // 64 hex chars
    const tokenHash = this._hash(plaintext);
    const id = this._generateId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 24 * 60 * 60 * 1000);

    const entry = {
      id,
      tokenHash,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      rotatedFrom: null,
      label,
    };

    this.tokens.set(id, entry);
    await this._persistTokens();

    await this._logAudit({
      event: "issued",
      tokenId: this._safeId(id),
      label,
      detail: `expires=${expiresAt.toISOString()} ttl=${ttl}d`,
    });

    return {
      token: plaintext,
      id,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Rotate a token: issue new, mark old as revoked after grace period.
   * During the grace period, both old and new tokens are valid.
   * @param {string} oldToken - Plaintext of the token to rotate
   * @returns {Promise<{token: string, id: string, expiresAt: string, previousId: string}>}
   */
  async rotateToken(oldToken) {
    if (!oldToken || typeof oldToken !== "string") {
      throw new Error("oldToken is required for rotation");
    }

    await this._ensureInit();

    const oldHash = this._hash(oldToken);
    const oldEntry = this._findByHash(oldHash);

    if (!oldEntry) {
      throw new Error("Token not found");
    }

    if (oldEntry.revokedAt) {
      throw new Error("Token already revoked");
    }

    if (new Date(oldEntry.expiresAt) < new Date()) {
      throw new Error("Token has expired");
    }

    // Issue new token
    const { token, id, expiresAt } = await this.issueToken({
      label: oldEntry.label,
      ttlDays: this.ttlDays,
    });

    // Link rotation
    const newEntry = this.tokens.get(id);
    newEntry.rotatedFrom = oldEntry.id;

    // Grace period: revoke old token after grace period
    const graceExpiry = new Date(Date.now() + this.gracePeriodDays * 24 * 60 * 60 * 1000);
    oldEntry.revokedAt = graceExpiry.toISOString();
    // Don't add to revoked cache yet — still valid during grace period

    await this._persistTokens();

    await this._logAudit({
      event: "rotated",
      tokenId: this._safeId(id),
      label: oldEntry.label,
      detail: `previous=${this._safeId(oldEntry.id)} grace=${graceExpiry.toISOString()}`,
    });

    return {
      token,
      id,
      expiresAt,
      previousId: oldEntry.id,
    };
  }

  /**
   * Revoke a token immediately.
   * @param {string} token - Plaintext of the token to revoke
   * @returns {Promise<{ok: boolean, alreadyRevoked?: boolean}>}
   */
  async revokeToken(token) {
    if (!token || typeof token !== "string") {
      throw new Error("token is required for revocation");
    }

    await this._ensureInit();

    const tokenHash = this._hash(token);
    const entry = this._findByHash(tokenHash);

    if (!entry) {
      return { ok: false, error: "Token not found" };
    }

    if (entry.revokedAt && new Date(entry.revokedAt) <= new Date()) {
      return { ok: true, alreadyRevoked: true };
    }

    entry.revokedAt = new Date().toISOString();
    this.revokedCache.add(tokenHash);

    await this._persistTokens();

    await this._logAudit({
      event: "revoked",
      tokenId: this._safeId(entry.id),
      label: entry.label,
      detail: "manual revocation",
    });

    return { ok: true };
  }

  /**
   * Validate a token (check it's not expired, revoked, or unknown).
   * Respects grace period for recently rotated tokens.
   * @param {string} token - Plaintext token
   * @returns {Promise<{valid: boolean, reason?: string, label?: string}>}
   */
  async validateToken(token) {
    if (!token || typeof token !== "string") {
      return { valid: false, reason: "missing_token" };
    }

    await this._ensureInit();

    const tokenHash = this._hash(token);

    // Fast path: check revocation cache
    if (this.revokedCache.has(tokenHash)) {
      await this._logAudit({
        event: "validated",
        tokenId: "cached",
        label: "revoked",
        detail: "rejected (revoked in cache)",
      });
      return { valid: false, reason: "revoked" };
    }

    const entry = this._findByHash(tokenHash);
    if (!entry) {
      await this._logAudit({
        event: "validated",
        tokenId: "unknown",
        label: "unknown",
        detail: "rejected (not found)",
      });
      return { valid: false, reason: "unknown_token" };
    }

    // Check revocation with grace period
    if (entry.revokedAt) {
      const revokedTime = new Date(entry.revokedAt);
      const now = new Date();
      if (revokedTime <= now) {
        // Past grace period → rejected
        this.revokedCache.add(tokenHash); // Cache for faster future rejection
        await this._logAudit({
          event: "validated",
          tokenId: this._safeId(entry.id),
          label: entry.label,
          detail: "rejected (grace period expired)",
        });
        return { valid: false, reason: "revoked" };
      }
      // Still within grace period → treat as valid
    }

    // Check expiry
    if (new Date(entry.expiresAt) < new Date()) {
      await this._logAudit({
        event: "validated",
        tokenId: this._safeId(entry.id),
        label: entry.label,
        detail: "rejected (expired)",
      });
      return { valid: false, reason: "expired" };
    }

    // Valid
    return { valid: true, label: entry.label };
  }

  /**
   * Express/HTTP middleware for token validation.
   * Usage: app.use(tokenLifecycle.middleware())
   *
   * @param {Object} [options]
   * @param {string} [options.headerName="authorization"] - Header to check
   * @param {string} [options.tokenPrefix="Bearer "] - Prefix to strip
   * @param {string[]} [options.exemptPaths=[]] - Paths to skip validation
   * @returns {Function} Express middleware
   */
  middleware(options = {}) {
    const {
      headerName = "authorization",
      tokenPrefix = "Bearer ",
      exemptPaths = ["/mesh/health"],
    } = options;

    return async (req, res, next) => {
      // Skip exempt paths
      if (exemptPaths.some((p) => req.path.startsWith(p))) {
        return next();
      }

      const authHeader = req.headers[headerName.toLowerCase()];
      if (!authHeader) {
        return res.status(401).json({ error: "Missing authorization header" });
      }

      let token = authHeader;
      if (authHeader.startsWith(tokenPrefix)) {
        token = authHeader.slice(tokenPrefix.length);
      }

      const result = await this.validateToken(token);

      if (!result.valid) {
        return res.status(401).json({
          error: "Invalid token",
          reason: result.reason,
        });
      }

      // Attach token info for downstream handlers
      req.tokenInfo = result;
      next();
    };
  }

  /**
   * Get all active (non-revoked, non-expired) tokens.
   * @returns {TokenEntry[]}
   */
  getActiveTokens() {
    const now = new Date();
    return [...this.tokens.values()].filter((e) => {
      if (e.revokedAt && new Date(e.revokedAt) <= now) return false;
      if (new Date(e.expiresAt) < now) return false;
      return true;
    });
  }

  /**
   * Get token status by plaintext token.
   * @param {string} token - Plaintext token
   * @returns {Object|null}
   */
  async getTokenStatus(token) {
    if (!token) return null;

    await this._ensureInit();

    const tokenHash = this._hash(token);
    const entry = this._findByHash(tokenHash);

    if (!entry) return null;

    const now = new Date();
    return {
      id: this._safeId(entry.id),
      label: entry.label,
      issuedAt: entry.issuedAt,
      expiresAt: entry.expiresAt,
      revokedAt: entry.revokedAt,
      rotatedFrom: entry.rotatedFrom,
      isExpired: new Date(entry.expiresAt) < now,
      isRevoked: !!(entry.revokedAt && new Date(entry.revokedAt) <= now),
      isInGracePeriod: !!(entry.revokedAt && new Date(entry.revokedAt) > now),
    };
  }

  /**
   * Stop the lifecycle manager (cleanup timers).
   */
  async shutdown() {
    if (this._rotationTimer) {
      clearInterval(this._rotationTimer);
      this._rotationTimer = null;
    }
    this._initialized = false;
    await this._logAudit({
      event: "shutdown",
      tokenId: "system",
      label: "system",
      detail: "lifecycle manager stopped",
    });
  }

  // === Internal methods ===

  async _ensureInit() {
    if (!this._initialized) await this.initialize();
  }

  _hash(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  _generateId() {
    return `tok_${crypto.randomUUID()}`;
  }

  _safeId(id) {
    return id.slice(0, 12);
  }

  _findByHash(tokenHash) {
    for (const entry of this.tokens.values()) {
      if (entry.tokenHash === tokenHash) return entry;
    }
    return null;
  }

  async _checkRotations() {
    try {
      const now = new Date();
      const rotatedTokens = [];

      for (const [id, entry] of this.tokens) {
        if (entry.revokedAt && new Date(entry.revokedAt) <= now) continue;
        if (new Date(entry.expiresAt) < now) continue;

        // Rotate tokens that will expire within rotationIntervalDays
        const timeUntilExpiry = new Date(entry.expiresAt).getTime() - now.getTime();
        const rotationThreshold = this.rotationIntervalDays * 24 * 60 * 60 * 1000;

        if (timeUntilExpiry <= rotationThreshold && !entry.rotatedFrom) {
          // Only auto-rotate tokens that haven't been rotated yet
          // Find the plaintext from pending tokens or skip
          const plaintext = this._findPlaintextByHash(entry.tokenHash);
          if (plaintext) {
            try {
              const result = await this.rotateToken(plaintext);
              rotatedTokens.push(result);
            } catch (err) {
              await this._logAudit({
                event: "rotationFailed",
                tokenId: this._safeId(id),
                label: entry.label,
                detail: err.message,
              });
            }
          }
        }
      }

      if (rotatedTokens.length > 0) {
        console.log(`[token-lifecycle] Auto-rotated ${rotatedTokens.length} token(s)`);
      }
    } catch (err) {
      console.error("[token-lifecycle] Rotation check failed:", err.message);
    }
  }

  _findPlaintextByHash(hash) {
    for (const [plaintext, h] of this._pendingTokens) {
      if (h === hash) return plaintext;
    }
    return null;
  }

  async _logAudit(entry) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    try {
      await appendFile(this.auditLogPath, JSON.stringify(auditEntry) + "\n");
    } catch (err) {
      console.error("[token-lifecycle] Failed to write audit log:", err.message);
    }
  }

  async _loadTokens() {
    try {
      const data = await readFile(this.tokenStorePath, "utf-8");
      const parsed = JSON.parse(data);
      this.tokens = new Map(parsed.tokens || []);
      // Rebuild revoked cache
      this.revokedCache.clear();
      const now = new Date();
      for (const [, entry] of this.tokens) {
        if (entry.revokedAt && new Date(entry.revokedAt) <= now) {
          this.revokedCache.add(entry.tokenHash);
        }
      }
    } catch (err) {
      if (err.code === "ENOENT") {
        // No tokens file yet — fresh start
        this.tokens = new Map();
      } else {
        console.error("[token-lifecycle] Failed to load tokens:", err.message);
        this.tokens = new Map();
      }
    }
  }

  async _persistTokens() {
    try {
      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        tokens: [...this.tokens.entries()],
      };
      await writeFile(this.tokenStorePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("[token-lifecycle] Failed to persist tokens:", err.message);
      throw err;
    }
  }
}

// === Singleton ===

let _instance = null;

/**
 * Get or create the singleton TokenLifecycle instance.
 * @param {Object} [options]
 * @returns {Promise<TokenLifecycle>}
 */
export async function getTokenLifecycle(options = {}) {
  if (!_instance) {
    _instance = new TokenLifecycle(options);
    await _instance.initialize();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetTokenLifecycle() {
  if (_instance) {
    _instance.shutdown().catch(() => {});
    _instance = null;
  }
}

export { TokenLifecycle };
export default TokenLifecycle;
