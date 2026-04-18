/**
 * Token Store - Encrypted at-rest storage for mesh tokens
 * Phase 1: Foundation Hardening
 * 
 * Features:
 * - AES-256-GCM encryption for tokens at rest
 * - Active + rotating token tracking
 * - Hot-reload capability for rotation without restart
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Token store configuration
const TOKEN_STORE_PATH = process.env.MESH_TOKEN_STORE_PATH || 
  path.join(process.env.HOME, '.openclaw/workspace/projects/mesh-memory/.tokens');
const KEY_FILE = path.join(TOKEN_STORE_PATH, '.key');

/**
 * Token Store class for encrypted token storage
 */
export class TokenStore {
  constructor(options = {}) {
    this.storePath = options.storePath || TOKEN_STORE_PATH;
    this.tokens = new Map();
    this.activeToken = null;
    this.rotatingToken = null;
    this.masterKey = null;
    this.initialized = false;
  }

  /**
   * Initialize the token store
   */
  async initialize() {
    if (this.initialized) return;

    // Ensure store directory exists
    await fs.mkdir(this.storePath, { recursive: true });

    // Load or generate master encryption key
    this.masterKey = await this.#loadOrGenerateKey();

    // Load existing tokens from disk
    await this.#loadTokensFromDisk();

    // Run cleanup of expired tokens (non-blocking)
    this.#cleanupExpiredTokens().catch(() => {});

    this.initialized = true;
  }

  /**
   * Create a new token
   * @param {Object} options - Token options
   * @param {string} options.agentId - Agent identifier
   * @param {number} options.ttlHours - Token lifetime in hours (default: 24)
   * @returns {Object} Token data including the plaintext token (save this!)
   */
  async createToken(options = {}) {
    await this.initialize();

    const { agentId = 'unknown', ttlHours = 24 } = options;
    const tokenId = this.#generateId();
    const tokenPlaintext = this.#generateSecureToken();
    const tokenHash = this.#hashToken(tokenPlaintext);
    
    const now = Date.now();
    const expiresAt = now + (ttlHours * 60 * 60 * 1000);

    const tokenData = {
      id: tokenId,
      tokenHash,
      agentId,
      createdAt: now,
      expiresAt,
      rotatedAt: null,
      revokedAt: null,
      status: 'active'
    };

    // Store encrypted token
    await this.#saveTokenToDisk(tokenId, tokenPlaintext, tokenData);
    
    // Update memory cache
    this.tokens.set(tokenId, { ...tokenData, plaintext: tokenPlaintext });
    this.activeToken = tokenId;

    return {
      id: tokenId,
      token: tokenPlaintext,
      agentId,
      createdAt: now,
      expiresAt,
      status: 'active'
    };
  }

  /**
   * Rotate a token (create new, mark old as rotating)
   * @param {string} tokenId - Token ID to rotate
   * @returns {Object} New token data
   */
  async rotateToken(tokenId) {
    await this.initialize();

    const oldToken = this.tokens.get(tokenId);
    if (!oldToken) {
      throw new Error(`Token ${tokenId} not found`);
    }

    if (oldToken.status === 'revoked') {
      throw new Error(`Token ${tokenId} has been revoked and cannot be rotated`);
    }

    // Mark old token as rotating
    oldToken.status = 'rotating';
    oldToken.rotatedAt = Date.now();
    await this.#updateTokenOnDisk(tokenId, oldToken);

    // Create new token
    const newToken = await this.createToken({
      agentId: oldToken.agentId,
      ttlHours: 24
    });

    // Update rotating token reference
    this.rotatingToken = oldToken.id;
    this.activeToken = newToken.id;

    return newToken;
  }

  /**
   * Revoke a token
   * @param {string} tokenId - Token ID to revoke
   * @param {string} reason - Reason for revocation
   */
  async revokeToken(tokenId, reason = 'manual') {
    await this.initialize();

    const token = this.tokens.get(tokenId);
    if (!token) {
      throw new Error(`Token ${tokenId} not found`);
    }

    if (token.status === 'revoked') {
      return { alreadyRevoked: true };
    }

    token.status = 'revoked';
    token.revokedAt = Date.now();
    token.revokeReason = reason;

    await this.#updateTokenOnDisk(tokenId, token);

    // Clear from memory
    if (this.activeToken === tokenId) {
      this.activeToken = null;
    }
    if (this.rotatingToken === tokenId) {
      this.rotatingToken = null;
    }

    return { revoked: true, at: token.revokedAt };
  }

  /**
   * Validate a token
   * @param {string} tokenPlaintext - The token to validate
   * @returns {Object} Validation result
   */
  async validateToken(tokenPlaintext) {
    await this.initialize();

    const tokenHash = this.#hashToken(tokenPlaintext);
    const now = Date.now();

    for (const [id, token] of this.tokens) {
      if (token.tokenHash === tokenHash) {
        // Check if revoked
        if (token.status === 'revoked') {
          return { valid: false, reason: 'revoked', tokenId: id };
        }

        // Check if rotated
        if (token.status === 'rotating') {
          return { valid: false, reason: 'rotated', tokenId: id };
        }

        // Check if expired
        if (token.expiresAt < now) {
          token.status = 'expired';
          await this.#updateTokenOnDisk(id, token);
          return { valid: false, reason: 'expired', tokenId: id };
        }

        // Token is valid
        return { 
          valid: true, 
          tokenId: id,
          agentId: token.agentId,
          expiresAt: token.expiresAt
        };
      }
    }

    return { valid: false, reason: 'not_found' };
  }

  /**
   * Get active token
   * @returns {Object|null} Active token data
   */
  getActiveToken() {
    if (!this.activeToken) return null;
    const token = this.tokens.get(this.activeToken);
    if (!token) return null;
    
    return {
      id: token.id,
      agentId: token.agentId,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
      status: token.status
    };
  }

  /**
   * Get rotating token (if any)
   * @returns {Object|null} Rotating token data
   */
  getRotatingToken() {
    if (!this.rotatingToken) return null;
    const token = this.tokens.get(this.rotatingToken);
    if (!token) return null;
    
    return {
      id: token.id,
      agentId: token.agentId,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
      status: token.status
    };
  }

  /**
   * Get all tokens
   * @returns {Array} All tokens (without plaintext)
   */
  getAllTokens() {
    return Array.from(this.tokens.values()).map(t => ({
      id: t.id,
      agentId: t.agentId,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      rotatedAt: t.rotatedAt,
      revokedAt: t.revokedAt,
      status: t.status
    }));
  }

  /**
   * Clean up expired tokens
   * @param {number} maxAgeDays - Maximum age in days to keep expired tokens
   */
  async cleanupExpiredTokens(maxAgeDays = 7) {
    await this.initialize();

    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const toDelete = [];

    for (const [id, token] of this.tokens) {
      if ((token.status === 'expired' || token.status === 'revoked') && 
          token.expiresAt < cutoff) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.tokens.delete(id);
      await this.#deleteTokenFromDisk(id);
    }

    return { cleaned: toDelete.length };
  }

  /**
   * Hot-reload tokens from disk
   */
  async hotReload() {
    await this.initialize();
    await this.#loadTokensFromDisk();
  }

  /**
   * Get tokens needing rotation (expiring within threshold)
   * @param {number} thresholdHours - Hours before expiry to flag for rotation
   * @returns {Array} Tokens needing rotation
   */
  getTokensNeedingRotation(thresholdHours = 1) {
    const threshold = Date.now() + (thresholdHours * 60 * 60 * 1000);
    const needsRotation = [];

    for (const [id, token] of this.tokens) {
      if (token.status === 'active' && token.expiresAt < threshold) {
        needsRotation.push({
          id: token.id,
          agentId: token.agentId,
          expiresAt: token.expiresAt,
          hoursUntilExpiry: Math.round((token.expiresAt - Date.now()) / (60 * 60 * 1000) * 100) / 100
        });
      }
    }

    return needsRotation;
  }

  // Private methods

  async #loadOrGenerateKey() {
    try {
      const keyData = await fs.readFile(KEY_FILE);
      return keyData;
    } catch (err) {
      // Generate new key
      const key = crypto.randomBytes(32);
      await fs.writeFile(KEY_FILE, key, { mode: 0o600 });
      return key;
    }
  }

  async #loadTokensFromDisk() {
    try {
      const files = await fs.readdir(this.storePath);
      const tokenFiles = files.filter(f => f.endsWith('.enc') && !f.startsWith('.'));

      for (const file of tokenFiles) {
        const tokenId = file.replace('.enc', '');
        const filePath = path.join(this.storePath, file);
        
        try {
          const encrypted = await fs.readFile(filePath);
          const decrypted = this.#decrypt(encrypted);
          const tokenData = JSON.parse(decrypted);
          this.tokens.set(tokenId, tokenData);
          
          // Restore active/rotating references
          if (tokenData.status === 'active') {
            this.activeToken = tokenId;
          } else if (tokenData.status === 'rotating') {
            this.rotatingToken = tokenId;
          }
        } catch (err) {
          console.error(`Failed to load token ${tokenId}:`, err.message);
        }
      }
    } catch (err) {
      // Directory might be empty or not exist yet
    }
  }

  async #saveTokenToDisk(tokenId, plaintext, tokenData) {
    const dataToStore = { ...tokenData, plaintext };
    const encrypted = this.#encrypt(JSON.stringify(dataToStore));
    const filePath = path.join(this.storePath, `${tokenId}.enc`);
    await fs.writeFile(filePath, encrypted, { mode: 0o600 });
  }

  async #updateTokenOnDisk(tokenId, tokenData) {
    const filePath = path.join(this.storePath, `${tokenId}.enc`);
    try {
      const encrypted = this.#encrypt(JSON.stringify(tokenData));
      await fs.writeFile(filePath, encrypted, { mode: 0o600 });
    } catch (err) {
      console.error(`Failed to update token ${tokenId}:`, err.message);
    }
  }

  async #deleteTokenFromDisk(tokenId) {
    const filePath = path.join(this.storePath, `${tokenId}.enc`);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      // File might not exist
    }
  }

  #encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    
    return JSON.stringify({
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted
    });
  }

  #decrypt(encryptedJson) {
    const { iv, authTag, data } = JSON.parse(encryptedJson.toString());
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.masterKey,
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  #hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  #generateId() {
    return crypto.randomUUID();
  }

  #generateSecureToken() {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Cleanup expired tokens older than retention period
   * Retention: 7 days for expired tokens
   * Called automatically on initialization (non-blocking)
   */
  async #cleanupExpiredTokens() {
    const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    const now = Date.now();
    let deleted = 0;

    try {
      const files = await fs.readdir(this.storePath);
      const tokenFiles = files.filter(f => f.endsWith('.enc') && !f.startsWith('.'));

      for (const file of tokenFiles) {
        const filePath = path.join(this.storePath, file);
        
        try {
          const stats = await fs.stat(filePath);
          const age = now - stats.mtime.getTime();
          
          // Check if token is expired by reading it
          let isExpired = false;
          try {
            const encrypted = await fs.readFile(filePath);
            const decrypted = this.#decrypt(encrypted);
            const tokenData = JSON.parse(decrypted);
            if (tokenData.expiresAt && tokenData.expiresAt < now) {
              isExpired = true;
            }
          } catch (err) {
            // Corrupt file - treat as expired
            isExpired = true;
          }
          
          // Delete if expired AND older than retention
          if (isExpired && age > RETENTION_MS) {
            await fs.unlink(filePath);
            deleted++;
            
            // Also remove from memory cache
            const tokenId = file.replace('.enc', '');
            this.tokens.delete(tokenId);
          }
        } catch (err) {
          // Skip files we can't process
        }
      }

      if (deleted > 0) {
        console.log(`[TokenStore] Cleaned up ${deleted} expired tokens`);
      }
    } catch (err) {
      // Ignore cleanup errors - don't block initialization
    }
  }
}
}

// Singleton instance
let tokenStoreInstance = null;

export async function getTokenStore(options = {}) {
  if (!tokenStoreInstance) {
    tokenStoreInstance = new TokenStore(options);
    await tokenStoreInstance.initialize();
  }
  return tokenStoreInstance;
}

export function resetTokenStore() {
  tokenStoreInstance = null;
}

export default TokenStore;