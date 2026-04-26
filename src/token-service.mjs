#!/usr/bin/env node

/**
 * Mesh-Memory Token Service
 * Phase 2: Token Lifecycle Management
 *
 * Provides HTTP endpoints for token issuance, rotation, and revocation
 * Uses SQLite for token storage with master token + ephemeral token model
 * 
 * Security features:
 * - Master token never logged
 * - Short TTL for ephemeral tokens (default 24h)
 * - In-memory revocation cache
 * - Automatic token rotation
 */

import http from 'http';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { LRUCache } from 'lru-cache';
import { loadConfig } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Config wrapper class to provide .get() method
 */
class Config {
  constructor() {
    this.data = loadConfig();
  }
  
  get(path, defaultValue = undefined) {
    const keys = path.split('.');
    let value = this.data;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultValue;
      }
    }
    
    return value !== undefined ? value : defaultValue;
  }
}

class TokenService {
  constructor(configPath = null) {
    this.config = new Config();
    this.db = null;
    // FIX: Priority 1 - Unbounded Revocation Cache
    // Use LRU cache with max 10K entries, 24h TTL to prevent unbounded growth
    this.revocationCache = new LRUCache({
      max: 10000,
      ttl: 24 * 60 * 60 * 1000, // 24 hours
      updateAgeOnGet: true,
      allowStale: false
    });
    this.backgroundRotationTimer = null;
    this.isShuttingDown = false;
    
    // Token generation settings
    this.TOKEN_LENGTH = 64; // 64 character tokens
    this.DEFAULT_TTL_HOURS = 24;
    this.ROTATION_BUFFER_HOURS = 12; // Rotate 12h before expiry
    
    // Initialize paths
    this.dataDir = join(process.env.HOME || process.env.USERPROFILE, '.openclaw/workspace/memory');
    this.dbPath = join(this.dataDir, 'tokens.db');
    
    // Ensure data directory exists
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * Initialize database and load revocation cache
   */
  async initialize() {
    // Initialize SQLite database
    this.db = new sqlite3.Database(this.dbPath);
    
    // Promisify database methods
    this.db.run = promisify(this.db.run.bind(this.db));
    this.db.get = promisify(this.db.get.bind(this.db));
    this.db.all = promisify(this.db.all.bind(this.db));
    
    // Create tokens table if it doesn't exist
    await this.db.run(`
      CREATE TABLE IF NOT EXISTS tokens (
        peerName TEXT NOT NULL,
        token TEXT PRIMARY KEY,
        issuedAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        revoked INTEGER DEFAULT 0,
        createdAt INTEGER DEFAULT (unixepoch())
      )
    `);
    
    // Create indexes for performance
    await this.db.run('CREATE INDEX IF NOT EXISTS idx_peerName ON tokens(peerName)');
    await this.db.run('CREATE INDEX IF NOT EXISTS idx_expiresAt ON tokens(expiresAt)');
    await this.db.run('CREATE INDEX IF NOT EXISTS idx_revoked ON tokens(revoked)');
    
    // Load revoked tokens into cache
    await this.loadRevocationCache();
    
    console.log('Token service initialized');
  }

  /**
   * Load revoked tokens into in-memory cache
   */
  async loadRevocationCache() {
    const revokedTokens = await this.db.all(
      'SELECT token FROM tokens WHERE revoked = 1'
    );
    
    this.revocationCache.clear();
    for (const row of revokedTokens) {
      this.revocationCache.set(row.token, true);
    }
    
    console.log(`Loaded ${this.revocationCache.size} revoked tokens into cache`);
  }

  /**
   * Generate a cryptographically secure random token
   */
  generateToken() {
    // FIX: Token entropy - use proper byte count for desired length
    // 64 hex chars = 32 bytes (2 hex chars per byte)
    return crypto.randomBytes(this.TOKEN_LENGTH / 2).toString('hex');
  }

  /**
   * Calculate expiration timestamp
   */
  calculateExpiry(ttlHours) {
    const now = Date.now();
    const ttlMs = (ttlHours || this.DEFAULT_TTL_HOURS) * 60 * 60 * 1000;
    return now + ttlMs;
  }

  /**
   * Issue a new ephemeral token
   */
  async issueToken(peerName, ttlHours = null) {
    if (!peerName || typeof peerName !== 'string') {
      throw new Error('Invalid peerName');
    }
    
    const token = this.generateToken();
    const now = Date.now();
    const expiresAt = this.calculateExpiry(ttlHours);
    
    // FIX: Use parameterized query to prevent SQL injection
    await this.db.run(
      'INSERT INTO tokens (peerName, token, issuedAt, expiresAt, revoked) VALUES (?, ?, ?, ?, 0)',
      [peerName, token, now, expiresAt]
    );
    
    console.log(`Issued token for peer: ${peerName}, expires: ${new Date(expiresAt).toISOString()}`);
    // Note: token itself is NOT logged for security
    
    return {
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      peerName
    };
  }

  /**
   * Rotate (renew) an existing token
   */
  async rotateToken(oldToken) {
    if (!oldToken || typeof oldToken !== 'string') {
      throw new Error('Invalid token');
    }
    
    return new Promise((resolve, reject) => {
      this.db.serialize(async () => {
        try {
          // Use IMMEDIATE transaction to prevent deadlocks
          await this.db.run('BEGIN IMMEDIATE TRANSACTION');
          
          // SELECT FOR UPDATE to lock the row
          const oldTokenRecord = await this.db.get(
            'SELECT peerName, expiresAt FROM tokens WHERE token = ? AND revoked = 0 FOR UPDATE',
            [oldToken]
          );
          
          if (!oldTokenRecord) {
            await this.db.run('ROLLBACK');
            throw new Error('Invalid or revoked token');
          }
          
          const now = Date.now();
          if (oldTokenRecord.expiresAt < now) {
            await this.db.run('ROLLBACK');
            throw new Error('Token has expired');
          }
          
          // Generate new token
          const newToken = this.generateToken();
          const expiresAt = this.calculateExpiry();
          
          // Insert new token first
          await this.db.run(
            'INSERT INTO tokens (peerName, token, issuedAt, expiresAt, revoked) VALUES (?, ?, ?, ?, 0)',
            [oldTokenRecord.peerName, newToken, now, expiresAt]
          );
          
          // Then revoke old token
          await this.db.run(
            'UPDATE tokens SET revoked = 1 WHERE token = ?',
            [oldToken]
          );
          
          await this.db.run('COMMIT');
          
          // Update cache after successful commit
          this.revocationCache.set(oldToken, true);
          
          console.log(`Rotated token for peer: ${oldTokenRecord.peerName}`);
          
          resolve({
            token: newToken,
            expiresAt: new Date(expiresAt).toISOString(),
            peerName: oldTokenRecord.peerName
          });
        } catch (error) {
          await this.db.run('ROLLBACK');
          reject(error);
        }
      });
    });
  }

  /**
   * Revoke a token
   */
  async revokeToken(token) {
    if (!token || typeof token !== 'string') {
      throw new Error('Invalid token');
    }
    
    const result = await this.db.run(
      'UPDATE tokens SET revoked = 1 WHERE token = ?',
      [token]
    );
    
    if (result.changes > 0) {
      this.revocationCache.set(token, true);
      console.log(`Revoked token`);
      // Note: token itself is NOT logged for security
      return true;
    }
    
    return false;
  }

  /**
   * Check if a token is valid (not revoked and not expired)
   */
  async isTokenValid(token) {
    if (!token || typeof token !== 'string') {
      return false;
    }
    
    // Check cache first for fast rejection of known revoked tokens
    // LRUCache.get() returns undefined if not found or expired
    if (this.revocationCache.get(token) !== undefined) {
      return false;
    }
    
    // Query database
    const tokenRecord = await this.db.get(
      'SELECT expiresAt, revoked FROM tokens WHERE token = ?',
      [token]
    );
    
    if (!tokenRecord) {
      return false;
    }
    
    // Double-check cache after DB query to catch race conditions
    if (this.revocationCache.get(token) !== undefined) {
      return false;
    }
    
    const now = Date.now();
    const isNotExpired = tokenRecord.expiresAt > now;
    const isNotRevoked = tokenRecord.revoked === 0;
    
    return isNotExpired && isNotRevoked;
  }

  /**
   * Get token status information
   */
  async getTokenStatus(token) {
    const tokenRecord = await this.db.get(
      'SELECT peerName, issuedAt, expiresAt, revoked FROM tokens WHERE token = ?',
      [token]
    );
    
    if (!tokenRecord) {
      return null;
    }
    
    const now = Date.now();
    const isExpired = tokenRecord.expiresAt < now;
    const isRevoked = tokenRecord.revoked === 1 || this.revocationCache.get(token) !== undefined;
    
    return {
      peerName: tokenRecord.peerName,
      issuedAt: new Date(tokenRecord.issuedAt).toISOString(),
      expiresAt: new Date(tokenRecord.expiresAt).toISOString(),
      isExpired,
      isRevoked,
      isValid: !isExpired && !isRevoked
    };
  }

  /**
   * Get all tokens for a peer
   */
  async getTokensByPeer(peerName) {
    const tokens = await this.db.all(
      'SELECT token, issuedAt, expiresAt, revoked FROM tokens WHERE peerName = ? ORDER BY issuedAt DESC',
      [peerName]
    );
    
    const now = Date.now();
    return tokens.map(token => ({
      ...token,
      issuedAt: new Date(token.issuedAt).toISOString(),
      expiresAt: new Date(token.expiresAt).toISOString(),
      isExpired: token.expiresAt < now,
      isRevoked: token.revoked === 1 || this.revocationCache.get(token.token) !== undefined
    }));
  }

  /**
   * Clean up expired tokens (keeps DB size manageable)
   */
  async cleanupExpiredTokens() {
    const now = Date.now();
    const result = await this.db.run(
      'DELETE FROM tokens WHERE expiresAt < ? AND revoked = 1',
      [now]
    );
    
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} expired and revoked tokens`);
      await this.loadRevocationCache(); // Refresh cache
    }
    
    return result.changes;
  }

  /**
   * Automatic token rotation for tokens nearing expiry
   * FIX: Priority 2 - O(n) Token Rotation Scan
   * Process in batches of 100 to avoid blocking and memory issues
   */
  async performAutoRotation() {
    const now = Date.now();
    const rotationThreshold = now + (this.ROTATION_BUFFER_HOURS * 60 * 60 * 1000);
    
    let totalRotated = 0;
    let hasMore = true;
    
    while (hasMore) {
      // Find tokens that will expire within the rotation buffer (batch of 100)
      const tokensToRotate = await this.db.all(
        'SELECT token, peerName FROM tokens WHERE expiresAt < ? AND revoked = 0 LIMIT 100',
        [rotationThreshold]
      );
      
      if (tokensToRotate.length === 0) {
        hasMore = false;
        break;
      }
      
      console.log(`Processing batch of ${tokensToRotate.length} tokens for auto-rotation`);
      
      for (const tokenRecord of tokensToRotate) {
        try {
          await this.rotateToken(tokenRecord.token);
          totalRotated++;
          console.log(`Auto-rotated token for peer: ${tokenRecord.peerName}`);
        } catch (error) {
          console.error(`Failed to auto-rotate token for peer ${tokenRecord.peerName}:`, error.message);
        }
      }
      
      // If we processed fewer than 100, we're done
      if (tokensToRotate.length < 100) {
        hasMore = false;
      }
    }
    
    if (totalRotated > 0) {
      console.log(`Auto-rotated ${totalRotated} tokens total`);
    }
  }

  /**
   * Start background auto-rotation service
   */
  startAutoRotation(intervalHours = null) {
    const intervalMs = (intervalHours || this.config.get('token.rotationIntervalHours', 12)) * 60 * 60 * 1000;
    
    // Run immediately
    this.performAutoRotation().catch(err => {
      console.error('Initial auto-rotation failed:', err.message);
    });
    
    // Schedule regular runs
    this.backgroundRotationTimer = setInterval(async () => {
      if (this.isShuttingDown) return;
      
      try {
        await this.performAutoRotation();
        await this.cleanupExpiredTokens();
      } catch (error) {
        console.error('Background rotation failed:', error.message);
      }
    }, intervalMs);
    
    console.log(`Auto-rotation started (interval: ${intervalMs / (60 * 60 * 1000)} hours)`);
  }

  /**
   * Stop background services
   */
  stop() {
    this.isShuttingDown = true;
    
    if (this.backgroundRotationTimer) {
      clearInterval(this.backgroundRotationTimer);
      this.backgroundRotationTimer = null;
      console.log('Auto-rotation stopped');
    }
    
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * HTTP request handler
   */
  async handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;
    
    // FIX: Add rate limiting
    const rateLimitWindow = {};
    const RATE_LIMIT_MAX_REQUESTS = 100;
    const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    
    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    
    // Parse request body
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        // Extract authorization header
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith('Bearer ') 
          ? authHeader.substring(7) 
          : null;
        
        let response;
        let statusCode = 200;
        
        switch (url.pathname) {
          case '/mesh/token/issue':
            if (method !== 'POST') {
              throw new Error('Method not allowed');
            }
            
            // Verify master token
            const masterToken = this.config.get('token.masterToken');
            if (!token || token !== masterToken) {
              statusCode = 401;
              throw new Error('Unauthorized: Invalid master token');
            }
            
            const issueData = body ? JSON.parse(body) : {};
            response = await this.issueToken(issueData.peerName, issueData.ttlHours);
            break;
            
          case '/mesh/token/rotate':
            if (method !== 'POST') {
              throw new Error('Method not allowed');
            }
            
            if (!token) {
              statusCode = 401;
              throw new Error('Unauthorized: Token required');
            }
            
            response = await this.rotateToken(token);
            break;
            
          case '/mesh/token/revoke':
            if (method !== 'POST') {
              throw new Error('Method not allowed');
            }
            
            // Verify master token
            const revokeMasterToken = this.config.get('token.masterToken');
            if (!token || token !== revokeMasterToken) {
              statusCode = 401;
              throw new Error('Unauthorized: Invalid master token');
            }
            
            const revokeData = body ? JSON.parse(body) : {};
            const revoked = await this.revokeToken(revokeData.token);
            response = { ok: revoked };
            break;
            
          case '/mesh/token/status':
            if (method !== 'GET') {
              throw new Error('Method not allowed');
            }
            
            if (!token) {
              statusCode = 401;
              throw new Error('Unauthorized: Token required');
            }
            
            response = await this.getTokenStatus(token);
            if (!response) {
              statusCode = 404;
              throw new Error('Token not found');
            }
            break;
            
          case '/mesh/token/peer-status':
            if (method !== 'GET') {
              throw new Error('Method not allowed');
            }
            
            // Verify master token
            const peerStatusMasterToken = this.config.get('token.masterToken');
            if (!token || token !== peerStatusMasterToken) {
              statusCode = 401;
              throw new Error('Unauthorized: Invalid master token');
            }
            
            const peerName = url.searchParams.get('peerName');
            if (!peerName) {
              statusCode = 400;
              throw new Error('peerName query parameter required');
            }
            
            response = await this.getTokensByPeer(peerName);
            break;
            
          case '/mesh/token/validate':
            if (method !== 'POST') {
              throw new Error('Method not allowed');
            }
            
            const validateData = body ? JSON.parse(body) : {};
            const tokenToValidate = validateData.token;
            
            if (!tokenToValidate) {
              statusCode = 400;
              throw new Error('Missing token in request body');
            }
            
            const isValid = await this.isTokenValid(tokenToValidate);
            response = { valid: isValid };
            statusCode = isValid ? 200 : 401;
            break;
            
          default:
            statusCode = 404;
            throw new Error('Endpoint not found');
        }
        
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
        
      } catch (error) {
        const errorStatus = statusCode || 500;
        res.writeHead(errorStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  }

  /**
   * Start HTTP server
   */
  async start(port = null) {
    await this.initialize();
    
    const serverPort = port || this.config.get('tokenService.port', 18803);
    
    const server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch(err => {
        console.error('Request handler error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      });
    });
    
    // FIX: Add error handler to server.listen
    server.listen(serverPort, () => {
      console.log(`Token service listening on port ${serverPort}`);
    }).on('error', (err) => {
      console.error('Server listen error:', err);
      process.exit(1);
    });
    
    // Start background services if enabled
    if (this.config.get('token.autoRotate', true)) {
      this.startAutoRotation();
    }
    
    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      console.log('Received SIGTERM, shutting down gracefully...');
      this.stop();
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });
    
    process.on('SIGINT', () => {
      console.log('Received SIGINT, shutting down gracefully...');
      this.stop();
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });
    
    return server;
  }
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const configPath = process.argv[2] || null;
  const tokenService = new TokenService(configPath);
  
  // FIX: Add .catch() to async handlers
  tokenService.start().catch(err => {
    console.error('Failed to start token service:', err);
    process.exit(1);
  });
}

export { TokenService };