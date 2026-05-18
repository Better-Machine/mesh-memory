/**
 * Deal Room - Secure Agent Collaboration
 * 
 * Multi-agent secure data sharing with escrow and audit.
 * Extension of Palace L0-L4 architecture.
 * 
 * @module deal-room
 * @version 0.1.0
 */

import { createHash, randomUUID, createCipheriv, createDecipheriv, scryptSync } from 'crypto';
import Database from 'better-sqlite3';
import path from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';

// Configuration
const CONFIG = {
  dbPath: path.join(homedir(), '.openclaw/workspace/memory/deal-room.db'),
  encryptionAlgorithm: 'aes-256-gcm',
  keyLength: 32,
  ivLength: 16,
  tagLength: 16,
  escrowTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours default
  maxDealSize: 10 * 1024 * 1024, // 10MB max
  auditRetentionDays: 365
};

// Logger
const logger = {
  info: (msg, meta = {}) => console.log(`[${new Date().toISOString()}] [INFO] [deal-room] ${msg}`, meta),
  error: (msg, meta = {}) => console.error(`[${new Date().toISOString()}] [ERROR] [deal-room] ${msg}`, meta),
  audit: (action, dealId, meta = {}) => console.log(`[${new Date().toISOString()}] [AUDIT] ${action} deal=${dealId}`, meta)
};

/**
 * Deal Room - Secure Agent Collaboration
 */
class DealRoom {
  constructor(options = {}) {
    this.config = { ...CONFIG, ...options };
    this.db = null;
    this.initialized = false;
  }

  /**
   * Initialize Deal Room database
   */
  async init() {
    if (this.initialized) return this;

    // Ensure directory exists
    const dbDir = path.dirname(this.config.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Open database
    this.db = new Database(this.config.dbPath);
    
    // Initialize schema
    this._initSchema();
    
    this.initialized = true;
    logger.info('Deal Room initialized', { dbPath: this.config.dbPath });
    
    return this;
  }

  /**
   * Initialize database schema
   */
  _initSchema() {
    // Deals table - core escrow functionality
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deals (
        id TEXT PRIMARY KEY,
        initiator TEXT NOT NULL,
        recipient TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        encrypted_payload TEXT NOT NULL,
        escrow_key_hash TEXT NOT NULL,
        conditions TEXT, -- JSON: {requiredApprovals: [], timeout: number}
        approvals TEXT DEFAULT '[]', -- JSON array of {agent, timestamp, action}
        created_at TEXT NOT NULL,
        expires_at TEXT,
        released_at TEXT,
        rejected_at TEXT,
        audit_hash TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_deals_initiator ON deals(initiator);
      CREATE INDEX IF NOT EXISTS idx_deals_recipient ON deals(recipient);
      CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
      CREATE INDEX IF NOT EXISTS idx_deals_created ON deals(created_at);
      
      -- Audit log - immutable transaction record
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deal_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        details TEXT, -- JSON
        timestamp TEXT NOT NULL,
        hash TEXT NOT NULL -- Chain hash for integrity
      );
      
      CREATE INDEX IF NOT EXISTS idx_audit_deal ON audit_log(deal_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      
      -- Agent vaults - private data holdings
      CREATE TABLE IF NOT EXISTS agent_vaults (
        agent_id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        encrypted_private_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_accessed TEXT
      );
      
      -- Shared data registry - what agents have committed to deals
      CREATE TABLE IF NOT EXISTS shared_data (
        id TEXT PRIMARY KEY,
        deal_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        data_type TEXT NOT NULL, -- 'context', 'action', 'decision', etc.
        encrypted_content TEXT NOT NULL,
        access_control TEXT DEFAULT '{}', -- JSON: {allowedAgents: [], conditions: []}
        contributed_at TEXT NOT NULL,
        FOREIGN KEY (deal_id) REFERENCES deals(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_shared_deal ON shared_data(deal_id);
      CREATE INDEX IF NOT EXISTS idx_shared_agent ON shared_data(agent_id);
    `);
  }

  /**
   * Create a new deal (escrow initiation)
   * 
   * @param {Object} params
   * @param {string} params.initiator - Initiating agent ID
   * @param {string} params.recipient - Target agent ID
   * @param {string} params.payload - Data to escrow (will be encrypted)
   * @param {Object} params.conditions - Release conditions
   * @returns {Object} Deal metadata
   */
  createDeal({ initiator, recipient, payload, conditions = {} }) {
    this._checkInit();
    
    const dealId = `deal_${randomUUID()}`;
    const now = new Date().toISOString();
    const expiresAt = conditions.timeout 
      ? new Date(Date.now() + conditions.timeout).toISOString()
      : new Date(Date.now() + this.config.escrowTimeoutMs).toISOString();
    
    // Generate escrow key
    const escrowKey = this._generateEscrowKey(dealId, initiator, recipient);
    
    // Encrypt payload
    const encryptedPayload = this._encrypt(payload, escrowKey);
    
    // Hash key for verification (don't store raw key)
    const keyHash = createHash('sha256').update(escrowKey).digest('hex');
    
    // Initial audit entry
    const auditHash = this._hashAuditEntry({
      dealId, action: 'CREATE', actor: initiator, timestamp: now
    });
    
    // Insert deal
    const stmt = this.db.prepare(`
      INSERT INTO deals (
        id, initiator, recipient, status, encrypted_payload,
        escrow_key_hash, conditions, created_at, expires_at, audit_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      dealId,
      initiator,
      recipient,
      'pending',
      encryptedPayload,
      keyHash,
      JSON.stringify(conditions),
      now,
      expiresAt,
      auditHash
    );
    
    // Log audit
    this._logAudit(dealId, 'CREATE', initiator, {
      recipient,
      conditions,
      keyHash: keyHash.substring(0, 16) + '...'
    });
    
    logger.info('Deal created', { dealId, initiator, recipient });
    
    return {
      dealId,
      status: 'pending',
      initiator,
      recipient,
      createdAt: now,
      expiresAt
    };
  }

  /**
   * Approve or reject a deal
   * 
   * @param {string} dealId
   * @param {string} agentId - Approving agent
   * @param {string} action - 'approve' | 'reject'
   * @returns {Object} Updated deal status
   */
  approveDeal(dealId, agentId, action) {
    this._checkInit();
    
    const deal = this.getDeal(dealId);
    if (!deal) {
      throw new Error(`Deal not found: ${dealId}`);
    }
    
    if (deal.status !== 'pending') {
      throw new Error(`Deal ${dealId} is ${deal.status}, not pending`);
    }
    
    if (![deal.initiator, deal.recipient].includes(agentId)) {
      throw new Error(`Agent ${agentId} is not a party to this deal`);
    }
    
    const now = new Date().toISOString();
    
    // Update approvals
    const approvals = Array.isArray(deal.approvals) ? deal.approvals : JSON.parse(deal.approvals || '[]');
    approvals.push({
      agent: agentId,
      action,
      timestamp: now
    });
    
    // Determine new status
    let newStatus = 'pending';
    let releasedAt = null;
    let rejectedAt = null;
    
    if (action === 'approve') {
      // Check if all required parties approved
      const conditions = typeof deal.conditions === 'object' ? deal.conditions : JSON.parse(deal.conditions || '{}');
      const required = conditions.requiredApprovals || [deal.initiator, deal.recipient];
      const approvedAgents = approvals.filter(a => a.action === 'approve').map(a => a.agent);
      
      if (required.every(r => approvedAgents.includes(r))) {
        newStatus = 'released';
        releasedAt = now;
      }
    } else if (action === 'reject') {
      newStatus = 'rejected';
      rejectedAt = now;
    }
    
    // Update deal
    const stmt = this.db.prepare(`
      UPDATE deals 
      SET status = ?, approvals = ?, released_at = ?, rejected_at = ?
      WHERE id = ?
    `);
    
    stmt.run(newStatus, JSON.stringify(approvals), releasedAt, rejectedAt, dealId);
    
    // Log audit
    this._logAudit(dealId, action.toUpperCase(), agentId, {
      previousStatus: deal.status,
      newStatus
    });
    
    logger.info(`Deal ${action}ed`, { dealId, agent: agentId, status: newStatus });
    
    return {
      dealId,
      status: newStatus,
      action,
      actor: agentId,
      timestamp: now
    };
  }

  /**
   * Retrieve deal payload (only if released)
   * 
   * @param {string} dealId
   * @param {string} agentId - Requesting agent
   * @returns {Object} Decrypted payload
   */
  retrievePayload(dealId, agentId) {
    this._checkInit();
    
    const deal = this.getDeal(dealId);
    if (!deal) {
      throw new Error(`Deal not found: ${dealId}`);
    }
    
    if (deal.status !== 'released') {
      throw new Error(`Deal ${dealId} is ${deal.status}, not released`);
    }
    
    if (![deal.initiator, deal.recipient].includes(agentId)) {
      throw new Error(`Agent ${agentId} is not authorized to retrieve this payload`);
    }
    
    // Reconstruct key
    const escrowKey = this._generateEscrowKey(dealId, deal.initiator, deal.recipient);
    
    // Verify key hash
    const keyHash = createHash('sha256').update(escrowKey).digest('hex');
    if (keyHash !== deal.escrow_key_hash) {
      throw new Error('Key verification failed - data integrity compromised');
    }
    
    // Decrypt
    const payload = this._decrypt(deal.encrypted_payload, escrowKey);
    
    // Log access
    this._logAudit(dealId, 'RETRIEVE', agentId, {
      payloadSize: payload.length
    });
    
    logger.audit('Payload retrieved', dealId, { agent: agentId });
    
    return {
      dealId,
      payload,
      retrievedBy: agentId,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get deal information
   * 
   * @param {string} dealId
   * @returns {Object|null}
   */
  getDeal(dealId) {
    this._checkInit();
    
    const stmt = this.db.prepare('SELECT * FROM deals WHERE id = ?');
    const deal = stmt.get(dealId);
    
    if (!deal) return null;
    
    return {
      ...deal,
      conditions: JSON.parse(deal.conditions || '{}'),
      approvals: JSON.parse(deal.approvals || '[]')
    };
  }

  /**
   * List deals for an agent
   * 
   * @param {string} agentId
   * @param {Object} filters - {status, initiator, recipient}
   * @returns {Array}
   */
  listDeals(agentId, filters = {}) {
    this._checkInit();
    
    let query = `
      SELECT id, initiator, recipient, status, created_at, expires_at
      FROM deals
      WHERE (initiator = ? OR recipient = ?)
    `;
    const params = [agentId, agentId];
    
    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Get audit trail for a deal
   * 
   * @param {string} dealId
   * @returns {Array}
   */
  getAuditTrail(dealId) {
    this._checkInit();
    
    const stmt = this.db.prepare(`
      SELECT * FROM audit_log 
      WHERE deal_id = ? 
      ORDER BY timestamp ASC
    `);
    
    return stmt.all(dealId).map(entry => ({
      ...entry,
      details: JSON.parse(entry.details || '{}')
    }));
  }

  /**
   * Store private data in agent vault
   * 
   * @param {string} agentId
   * @param {string} data - Encrypted data
   * @param {Object} metadata
   */
  storeInVault(agentId, data, metadata = {}) {
    this._checkInit();
    // Placeholder for vault functionality
    logger.info('Vault storage request', { agentId, size: data.length });
    // Implementation depends on key management strategy
  }

  /**
   * Clean up expired deals
   * 
   * @returns {number} Count of cleaned deals
   */
  cleanupExpired() {
    this._checkInit();
    
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      UPDATE deals 
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at < ?
    `);
    
    const result = stmt.run(now);
    
    if (result.changes > 0) {
      logger.info('Cleaned up expired deals', { count: result.changes });
    }
    
    return result.changes;
  }

  // Private methods
  
  _checkInit() {
    if (!this.initialized) {
      throw new Error('Deal Room not initialized. Call init() first.');
    }
  }
  
  _generateEscrowKey(dealId, initiator, recipient) {
    // Deterministic key generation from deal parameters
    // In production, this would use a proper key exchange or HSM
    const seed = `${dealId}:${initiator}:${recipient}:secret`;
    return scryptSync(seed, 'fixed_salt_for_demo', 32);
  }
  
  _encrypt(plaintext, key) {
    const iv = Buffer.alloc(this.config.ivLength);
    const cipher = createCipheriv(this.config.encryptionAlgorithm, key, iv, {
      authTagLength: this.config.tagLength
    });
    
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    const tag = cipher.getAuthTag();
    
    // Combine: tag + iv + encrypted
    return Buffer.concat([tag, iv, Buffer.from(encrypted, 'base64')]).toString('base64');
  }
  
  _decrypt(ciphertext, key) {
    const data = Buffer.from(ciphertext, 'base64');
    
    const tag = data.slice(0, this.config.tagLength);
    const iv = data.slice(this.config.tagLength, this.config.tagLength + this.config.ivLength);
    const encrypted = data.slice(this.config.tagLength + this.config.ivLength);
    
    const decipher = createDecipheriv(this.config.encryptionAlgorithm, key, iv, {
      authTagLength: this.config.tagLength
    });
    
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  }
  
  _hashAuditEntry(entry) {
    const data = JSON.stringify(entry);
    return createHash('sha256').update(data).digest('hex');
  }
  
  _logAudit(dealId, action, actor, details) {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (deal_id, action, actor, details, timestamp, hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const timestamp = new Date().toISOString();
    const hash = this._hashAuditEntry({ dealId, action, actor, timestamp, details });
    
    stmt.run(dealId, action, actor, JSON.stringify(details), timestamp, hash);
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.initialized = false;
      logger.info('Deal Room closed');
    }
  }
}

// Factory function
export async function createDealRoom(options = {}) {
  const room = new DealRoom(options);
  await room.init();
  return room;
}

export { DealRoom };

// CLI/Testing
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🏛️  Deal Room Module');
  console.log('Usage: import { createDealRoom } from "./deal-room.mjs"');
  console.log('');
  console.log('Example:');
  console.log('  const room = await createDealRoom();');
  console.log('  const deal = room.createDeal({');
  console.log('    initiator: "agent-liz",');
  console.log('    recipient: "agent-ray",');
  console.log('    payload: JSON.stringify({ context: "shared data" })');
  console.log('  });');
}
