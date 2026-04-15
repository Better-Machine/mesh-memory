/**
 * Token Manager - Token lifecycle management with auto-rotation
 * Phase 1: Foundation Hardening
 * 
 * Features:
 * - Token lifecycle: create, rotate, revoke, audit
 * - 24h automatic rotation window
 * - Token revocation endpoint
 * - Token audit log (who, what, when)
 * - Token validation middleware
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTokenStore } from './token-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const AUDIT_LOG_PATH = process.env.MESH_TOKEN_AUDIT_PATH || 
  path.join(process.env.HOME, '.openclaw/workspace/projects/mesh-memory/logs/token-audit.jsonl');
const ROTATION_CHECK_INTERVAL = process.env.MESH_TOKEN_ROTATION_INTERVAL || 5 * 60 * 1000; // 5 minutes
const ROTATION_THRESHOLD_HOURS = 24; // Rotate 24h before expiry

/**
 * Token Manager class
 */
export class TokenManager {
  constructor(options = {}) {
    this.tokenStore = null;
    this.auditLogPath = options.auditLogPath || AUDIT_LOG_PATH;
    this.rotationInterval = options.rotationInterval || ROTATION_CHECK_INTERVAL;
    this.rotationTimer = null;
    this.initialized = false;
    this.agentId = options.agentId || process.env.MESH_AGENT_ID || 'unknown';
  }

  /**
   * Initialize the token manager
   */
  async initialize() {
    if (this.initialized) return;

    // Get or create token store
    this.tokenStore = await getTokenStore();

    // Ensure audit log directory exists
    const auditDir = path.dirname(this.auditLogPath);
    await fs.mkdir(auditDir, { recursive: true });

    // Start rotation timer
    this.startRotationTimer();

    this.initialized = true;
  }

  /**
   * Start automatic rotation check timer
   */
  startRotationTimer() {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
    }

    this.rotationTimer = setInterval(async () => {
      await this.checkAndRotateTokens();
    }, this.rotationInterval);
  }

  /**
   * Stop rotation timer
   */
  stopRotationTimer() {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
  }

  /**
   * Create a new token
   * @param {Object} options - Token options
   * @returns {Object} Token creation result
   */
  async createToken(options = {}) {
    await this.initialize();

    const token = await this.tokenStore.createToken({
      agentId: options.agentId || this.agentId,
      ttlHours: options.ttlHours || 48 // Default 48h for rotation buffer
    });

    // Audit log
    await this.#logAudit({
      action: 'created',
      tokenId: token.id,
      actor: options.actor || this.agentId,
      details: { agentId: token.agentId, expiresAt: token.expiresAt },
      ipAddress: options.ipAddress
    });

    return {
      success: true,
      token: token.token,
      tokenId: token.id,
      expiresAt: token.expiresAt
    };
  }

  /**
   * Rotate a token (create new, mark old for deprecation)
   * @param {string} tokenId - Token ID to rotate
   * @param {Object} options - Rotation options
   */
  async rotateToken(tokenId, options = {}) {
    await this.initialize();

    try {
      const newToken = await this.tokenStore.rotateToken(tokenId);

      // Audit log
      await this.#logAudit({
        action: 'rotated',
        tokenId: newToken.id,
        actor: options.actor || this.agentId,
        details: { previousTokenId: tokenId, agentId: newToken.agentId },
        ipAddress: options.ipAddress
      });

      return {
        success: true,
        token: newToken.token,
        tokenId: newToken.id,
        previousTokenId: tokenId,
        expiresAt: newToken.expiresAt
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Revoke a token (immediate invalidation)
   * @param {string} tokenId - Token ID to revoke
   * @param {Object} options - Revocation options
   */
  async revokeToken(tokenId, options = {}) {
    await this.initialize();

    const result = await this.tokenStore.revokeToken(tokenId, options.reason);

    if (result.alreadyRevoked) {
      return {
        success: true,
        alreadyRevoked: true,
        message: 'Token was already revoked'
      };
    }

    // Audit log
    await this.#logAudit({
      action: 'revoked',
      tokenId,
      actor: options.actor || this.agentId,
      details: { reason: options.reason || 'manual' },
      ipAddress: options.ipAddress
    });

    return {
      success: true,
      revokedAt: result.at
    };
  }

  /**
   * Validate a token
   * @param {string} token - Token plaintext to validate
   * @param {Object} options - Validation options
   */
  async validateToken(token, options = {}) {
    await this.initialize();

    const result = await this.tokenStore.validateToken(token);

    // Audit log (only log denials or if explicitly requested)
    if (!result.valid || options.logSuccess) {
      await this.#logAudit({
        action: result.valid ? 'access_granted' : 'access_denied',
        tokenId: result.tokenId || 'unknown',
        actor: options.actor || this.agentId,
        details: result.valid 
          ? { agentId: result.agentId }
          : { reason: result.reason },
        ipAddress: options.ipAddress
      });
    }

    return result;
  }

  /**
   * Check and rotate tokens that are approaching expiry
   */
  async checkAndRotateTokens() {
    await this.initialize();

    const tokensToRotate = this.tokenStore.getTokensNeedingRotation(ROTATION_THRESHOLD_HOURS);
    const rotated = [];

    for (const tokenInfo of tokensToRotate) {
      try {
        const result = await this.rotateToken(tokenInfo.id, {
          actor: 'auto-rotation-service',
          reason: 'approaching_expiry'
        });
        if (result.success) {
          rotated.push({
            previousTokenId: tokenInfo.id,
            newTokenId: result.tokenId,
            agentId: tokenInfo.agentId
          });
        }
      } catch (err) {
        console.error(`Failed to auto-rotate token ${tokenInfo.id}:`, err.message);
      }
    }

    if (rotated.length > 0) {
      console.log(`Auto-rotated ${rotated.length} token(s):`, rotated.map(r => r.previousTokenId));
    }

    return { rotated, count: rotated.length };
  }

  /**
   * Get token status
   * @param {string} tokenId - Token ID
   */
  async getTokenStatus(tokenId) {
    await this.initialize();

    const allTokens = this.tokenStore.getAllTokens();
    const token = allTokens.find(t => t.id === tokenId);

    if (!token) {
      return { found: false };
    }

    return {
      found: true,
      ...token,
      isActive: token.status === 'active',
      isExpired: token.expiresAt < Date.now(),
      timeUntilExpiry: token.expiresAt - Date.now()
    };
  }

  /**
   * Get all tokens summary
   */
  async getAllTokens() {
    await this.initialize();
    return this.tokenStore.getAllTokens();
  }

  /**
   * Get active token for this agent
   */
  async getActiveToken() {
    await this.initialize();
    return this.tokenStore.getActiveToken();
  }

  /**
   * Cleanup expired tokens
   * @param {number} maxAgeDays - Maximum age to keep
   */
  async cleanupExpiredTokens(maxAgeDays = 7) {
    await this.initialize();
    return await this.tokenStore.cleanupExpiredTokens(maxAgeDays);
  }

  /**
   * Force hot reload from disk
   */
  async hotReload() {
    await this.initialize();
    await this.tokenStore.hotReload();
  }

  /**
   * Express middleware for token validation
   * @param {Object} options - Middleware options
   */
  middleware(options = {}) {
    const { 
      headerName = 'authorization',
      tokenPrefix = 'Bearer ',
      exemptPaths = ['/mesh/health'],
      logAccess = false
    } = options;

    return async (req, res, next) => {
      // Check if path is exempt
      if (exemptPaths.some(path => req.path.startsWith(path))) {
        return next();
      }

      await this.initialize();

      // Get token from header
      const authHeader = req.headers[headerName.toLowerCase()];
      if (!authHeader) {
        await this.#logAudit({
          action: 'access_denied',
          tokenId: 'none',
          actor: 'anonymous',
          details: { reason: 'missing_token', path: req.path },
          ipAddress: req.ip || req.connection?.remoteAddress
        });
        return res.status(401).json({ error: 'Missing authorization token' });
      }

      // Extract token
      let token = authHeader;
      if (authHeader.startsWith(tokenPrefix)) {
        token = authHeader.slice(tokenPrefix.length);
      }

      // Validate
      const validation = await this.validateToken(token, {
        logSuccess: logAccess,
        ipAddress: req.ip || req.connection?.remoteAddress
      });

      if (!validation.valid) {
        return res.status(401).json({ 
          error: 'Invalid token', 
          reason: validation.reason 
        });
      }

      // Attach token info to request
      req.tokenInfo = validation;
      next();
    };
  }

  /**
   * Create Express router for token management endpoints
   */
  createRouter() {
    return async (req, res, next) => {
      const path = req.path;
      const method = req.method;

      try {
        await this.initialize();

        // POST /tokens - Create new token
        if (path === '/tokens' && method === 'POST') {
          const result = await this.createToken({
            agentId: req.body?.agentId,
            ttlHours: req.body?.ttlHours,
            actor: req.tokenInfo?.agentId || 'admin',
            ipAddress: req.ip
          });
          return res.status(result.success ? 201 : 400).json(result);
        }

        // POST /tokens/:id/rotate - Rotate token
        const rotateMatch = path.match(/^\/tokens\/([^/]+)\/rotate$/);
        if (rotateMatch && method === 'POST') {
          const tokenId = rotateMatch[1];
          const result = await this.rotateToken(tokenId, {
            actor: req.tokenInfo?.agentId || 'admin',
            ipAddress: req.ip
          });
          return res.status(result.success ? 200 : 400).json(result);
        }

        // POST /tokens/:id/revoke - Revoke token
        const revokeMatch = path.match(/^\/tokens\/([^/]+)\/revoke$/);
        if (revokeMatch && method === 'POST') {
          const tokenId = revokeMatch[1];
          const result = await this.revokeToken(tokenId, {
            actor: req.tokenInfo?.agentId || 'admin',
            reason: req.body?.reason || 'manual',
            ipAddress: req.ip
          });
          return res.status(result.success ? 200 : 404).json(result);
        }

        // GET /tokens/:id - Get token status
        const statusMatch = path.match(/^\/tokens\/([^/]+)$/);
        if (statusMatch && method === 'GET') {
          const tokenId = statusMatch[1];
          const result = await this.getTokenStatus(tokenId);
          return res.status(result.found ? 200 : 404).json(result);
        }

        // GET /tokens - List all tokens
        if (path === '/tokens' && method === 'GET') {
          const tokens = await this.getAllTokens();
          return res.json({ tokens, count: tokens.length });
        }

        // POST /tokens/check-rotation - Trigger rotation check
        if (path === '/tokens/check-rotation' && method === 'POST') {
          const result = await this.checkAndRotateTokens();
          return res.json(result);
        }

        // Not a token endpoint
        next();
      } catch (err) {
        next(err);
      }
    };
  }

  // Private methods

  async #logAudit(entry) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      ...entry
    };

    try {
      await fs.appendFile(
        this.auditLogPath,
        JSON.stringify(auditEntry) + '\n'
      );
    } catch (err) {
      console.error('Failed to write audit log:', err.message);
    }
  }
}

// Singleton instance
let tokenManagerInstance = null;

export async function getTokenManager(options = {}) {
  if (!tokenManagerInstance) {
    tokenManagerInstance = new TokenManager(options);
    await tokenManagerInstance.initialize();
  }
  return tokenManagerInstance;
}

export function resetTokenManager() {
  if (tokenManagerInstance) {
    tokenManagerInstance.stopRotationTimer();
    tokenManagerInstance = null;
  }
}

export default TokenManager;