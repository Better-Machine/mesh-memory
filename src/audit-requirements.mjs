/**
 * @module audit-requirements
 * @description WORM Audit Vault for Mesh Memory Protocol v2.0
 * 
 * Provides tamper-evident, write-once-read-many audit logging with:
 * - Cryptographic hash chain: each entry includes hash of previous
 * - Digital signatures: entries signed by agent identity
 * - Verification: verifyChain() detects tampering
 * - Retention: automatic archival after 90 days
 * - Export: compliance reports for auditors
 * 
 * @version 1.0.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash, createSign, createVerify, randomUUID, generateKeyPairSync } from 'crypto';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { loadConfig } from '../config.mjs';

// Config and paths
let config = null;
let AUDIT_DIR = 'memory/audit';

// SQLite database handle
let db = null;

// Audit entry types
export const AuditAction = {
  PROPOSE: 'propose',
  VOTE: 'vote',
  COMMIT: 'commit',
  ACCESS: 'access',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  POLICY_CHANGE: 'policy_change',
  CONSENT: 'consent',
  ROOM_STATE_CHANGE: 'room_state_change',
  AUDIT_VERIFICATION: 'audit_verification'
};

// Audit severity levels
export const AuditSeverity = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical'
};

/**
 * Initialize audit vault
 * @returns {Promise<void>}
 */
export async function initializeAuditVault() {
  config = loadConfig();
  
  const baseDir = config.memory?.baseDir || 'memory';
  AUDIT_DIR = join(baseDir, 'audit');
  
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.mkdir(join(AUDIT_DIR, 'vault'), { recursive: true });
  await fs.mkdir(join(AUDIT_DIR, 'archive'), { recursive: true });
  await fs.mkdir(join(AUDIT_DIR, 'exports'), { recursive: true });
  
  // Initialize SQLite database
  const dbPath = join(AUDIT_DIR, 'audit.db');
  db = new sqlite3.Database(dbPath);
  
  // Promisify database methods
  db.run = promisify(db.run.bind(db));
  db.get = promisify(db.get.bind(db));
  db.all = promisify(db.all.bind(db));
  
  await initializeSchema();
  
  console.log('[audit-requirements] Initialized');
}

/**
 * Initialize SQLite schema
 */
async function initializeSchema() {
  // Audit entries table
  await db.run(`
    CREATE TABLE IF NOT EXISTS audit_entries (
      entry_id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('propose', 'vote', 'commit', 'access', 'create', 'update', 'delete', 'policy_change', 'consent', 'room_state_change', 'audit_verification')),
      resource TEXT NOT NULL,
      resource_type TEXT DEFAULT 'room',
      details JSON,
      previous_hash TEXT NOT NULL,
      entry_hash TEXT NOT NULL UNIQUE,
      signature TEXT,
      severity TEXT DEFAULT 'info' CHECK(severity IN ('info', 'warning', 'error', 'critical')),
      room_id TEXT,
      session_id TEXT,
      chain_verified INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0
    )
  `);
  
  // Chain state table
  await db.run(`
    CREATE TABLE IF NOT EXISTS chain_state (
      chain_id TEXT PRIMARY KEY,
      last_entry_id TEXT,
      last_hash TEXT NOT NULL,
      entry_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  
  // Verification records
  await db.run(`
    CREATE TABLE IF NOT EXISTS verification_records (
      verification_id TEXT PRIMARY KEY,
      chain_id TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      verified_by TEXT,
      entries_checked INTEGER,
      entries_valid INTEGER,
      entries_invalid INTEGER,
      root_hash TEXT,
      status TEXT CHECK(status IN ('valid', 'invalid', 'partial'))
    )
  `);
  
  // Agent key registry
  await db.run(`
    CREATE TABLE IF NOT EXISTS agent_keys (
      agent_id TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      key_algorithm TEXT DEFAULT 'rsa-sha256',
      registered_at TEXT NOT NULL,
      last_used TEXT
    )
  `);
  
  // Indexes
  await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_entries(timestamp)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_entries(agent_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_entries(action)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_room ON audit_entries(room_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_chain ON audit_entries(previous_hash, entry_hash)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_entries(severity)`);
}

/**
 * Calculate SHA-256 hash of audit entry data
 * @param {Object} entry
 * @returns {string}
 */
function calculateEntryHash(entry) {
  const canonical = {
    entryId: entry.entryId,
    timestamp: entry.timestamp,
    agentId: entry.agentId,
    action: entry.action,
    resource: entry.resource,
    resourceType: entry.resourceType,
    details: entry.details,
    previousHash: entry.previousHash
  };
  
  const data = JSON.stringify(canonical, Object.keys(canonical).sort());
  return createHash('sha256').update(data).digest('hex');
}

/**
 * AuditEntry class representing a single audit log entry
 */
export class AuditEntry {
  constructor(data = {}) {
    this.entryId = data.entryId || `audit_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    this.timestamp = data.timestamp || new Date().toISOString();
    this.agentId = data.agentId || 'unknown';
    this.action = data.action || AuditAction.ACCESS;
    this.resource = data.resource || 'unknown';
    this.resourceType = data.resourceType || 'room';
    this.details = data.details || {};
    this.previousHash = data.previousHash || '0';
    this.entryHash = data.entryHash || null;
    this.signature = data.signature || null;
    this.severity = data.severity || AuditSeverity.INFO;
    this.roomId = data.roomId || null;
    this.sessionId = data.sessionId || null;
    
    // Calculate hash if not provided
    if (!this.entryHash) {
      this.entryHash = calculateEntryHash(this);
    }
  }
  
  /**
   * Sign the entry with agent's private key
   * @param {string} privateKey - PEM encoded private key
   * @returns {string} Signature
   */
  sign(privateKey) {
    const sign = createSign('SHA256');
    sign.update(this.entryHash);
    sign.end();
    
    this.signature = sign.sign(privateKey, 'hex');
    return this.signature;
  }
  
  /**
   * Verify the entry's signature
   * @param {string} publicKey - PEM encoded public key
   * @returns {boolean}
   */
  verifySignature(publicKey) {
    if (!this.signature) return false;
    
    const verify = createVerify('SHA256');
    verify.update(this.entryHash);
    verify.end();
    
    return verify.verify(publicKey, this.signature, 'hex');
  }
  
  /**
   * Convert to database format
   */
  toDB() {
    return {
      entry_id: this.entryId,
      timestamp: this.timestamp,
      agent_id: this.agentId,
      action: this.action,
      resource: this.resource,
      resource_type: this.resourceType,
      details: JSON.stringify(this.details),
      previous_hash: this.previousHash,
      entry_hash: this.entryHash,
      signature: this.signature,
      severity: this.severity,
      room_id: this.roomId,
      session_id: this.sessionId
    };
  }
  
  /**
   * Convert to JSON
   */
  toJSON() {
    return {
      entryId: this.entryId,
      timestamp: this.timestamp,
      agentId: this.agentId,
      action: this.action,
      resource: this.resource,
      resourceType: this.resourceType,
      details: this.details,
      previousHash: this.previousHash,
      entryHash: this.entryHash,
      signature: this.signature,
      severity: this.severity,
      roomId: this.roomId,
      sessionId: this.sessionId
    };
  }
  
  /**
   * Create AuditEntry from database row
   */
  static fromDB(row) {
    return new AuditEntry({
      entryId: row.entry_id,
      timestamp: row.timestamp,
      agentId: row.agent_id,
      action: row.action,
      resource: row.resource,
      resourceType: row.resource_type,
      details: JSON.parse(row.details || '{}'),
      previousHash: row.previous_hash,
      entryHash: row.entry_hash,
      signature: row.signature,
      severity: row.severity,
      roomId: row.room_id,
      sessionId: row.session_id
    });
  }
}

/**
 * Log an audit event
 * @param {Object} event - Event data { agentId, action, resource, details?, severity?, roomId?, sessionId? }
 * @param {Object} options - { signWithKey?, chainId? }
 * @returns {Promise<AuditEntry>}
 */
export async function logAudit(event, options = {}) {
  if (!event.agentId || !event.action || !event.resource) {
    throw new Error('agentId, action, and resource are required for audit logging');
  }
  
  // Get previous hash from chain
  const chainId = options.chainId || event.roomId || 'global';
  const previousHash = await getLastHash(chainId);
  
  // Create entry
  const entry = new AuditEntry({
    agentId: event.agentId,
    action: event.action,
    resource: event.resource,
    resourceType: event.resourceType || 'room',
    details: event.details || {},
    previousHash,
    severity: event.severity || AuditSeverity.INFO,
    roomId: event.roomId,
    sessionId: event.sessionId
  });
  
  // Sign if key provided
  if (options.signWithKey) {
    entry.sign(options.signWithKey);
  }
  
  // Store entry
  const dbData = entry.toDB();
  
  await db.run(
    `INSERT INTO audit_entries (
      entry_id, timestamp, agent_id, action, resource, resource_type,
      details, previous_hash, entry_hash, signature, severity, room_id, session_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dbData.entry_id, dbData.timestamp, dbData.agent_id, dbData.action,
      dbData.resource, dbData.resource_type, dbData.details, dbData.previous_hash,
      dbData.entry_hash, dbData.signature, dbData.severity, dbData.room_id,
      dbData.session_id
    ]
  );
  
  // Update chain state
  await updateChainState(chainId, entry.entryId, entry.entryHash);
  
  // Also write to WORM file (append-only)
  await appendToWORMFile(entry, chainId);
  
  return entry;
}

/**
 * Get the last hash in a chain
 * @param {string} chainId
 * @returns {Promise<string>}
 */
async function getLastHash(chainId) {
  const state = await db.get(
    'SELECT last_hash FROM chain_state WHERE chain_id = ?',
    [chainId]
  );
  
  return state?.last_hash || '0';
}

/**
 * Update chain state with new entry
 * @param {string} chainId
 * @param {string} entryId
 * @param {string} entryHash
 */
async function updateChainState(chainId, entryId, entryHash) {
  const now = new Date().toISOString();
  
  await db.run(
    `INSERT INTO chain_state (chain_id, last_entry_id, last_hash, entry_count, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(chain_id) DO UPDATE SET
       last_entry_id = excluded.last_entry_id,
       last_hash = excluded.last_hash,
       entry_count = entry_count + 1,
       updated_at = excluded.updated_at`,
    [chainId, entryId, entryHash, now, now]
  );
}

/**
 * Append entry to WORM file
 * @param {AuditEntry} entry
 * @param {string} chainId
 */
async function appendToWORMFile(entry, chainId) {
  const wormDir = join(AUDIT_DIR, 'vault');
  await fs.mkdir(wormDir, { recursive: true });
  
  const date = entry.timestamp.slice(0, 10); // YYYY-MM-DD
  const wormFile = join(wormDir, `${chainId}-${date}.worm`);
  
  const line = JSON.stringify(entry.toJSON()) + '\n';
  await fs.appendFile(wormFile, line, { flag: 'a' });
}

/**
 * Verify the integrity of an audit chain
 * @param {string} chainId - Chain to verify (roomId or 'global')
 * @param {Object} options - { startEntry?, endEntry? }
 * @returns {Promise<Object>} { valid: boolean, entriesChecked: number, invalidEntries: Array, rootHash: string }
 */
export async function verifyChain(chainId, options = {}) {
  const entries = await db.all(
    `SELECT * FROM audit_entries 
     WHERE room_id = ? OR entry_id IN (
       SELECT entry_id FROM audit_entries 
       WHERE room_id IS NULL AND ? = 'global'
     )
     ORDER BY timestamp ASC`,
    [chainId === 'global' ? '__none__' : chainId, chainId]
  );
  
  if (entries.length === 0) {
    return {
      valid: true,
      entriesChecked: 0,
      invalidEntries: [],
      rootHash: '0',
      message: 'No entries in chain'
    };
  }
  
  const invalidEntries = [];
  let previousHash = '0';
  let rootHash = null;
  
  for (let i = 0; i < entries.length; i++) {
    const entry = AuditEntry.fromDB(entries[i]);
    
    // Check chain integrity
    if (entry.previousHash !== previousHash) {
      invalidEntries.push({
        entryId: entry.entryId,
        error: 'Chain broken: previousHash mismatch',
        expectedPrevious: previousHash,
        actualPrevious: entry.previousHash,
        index: i
      });
    }
    
    // Verify entry hash
    const calculatedHash = calculateEntryHash(entry);
    if (calculatedHash !== entry.entryHash) {
      invalidEntries.push({
        entryId: entry.entryId,
        error: 'Hash mismatch: entry may have been tampered',
        expectedHash: calculatedHash,
        actualHash: entry.entryHash,
        index: i
      });
    }
    
    // Verify signature if present
    if (entry.signature) {
      const agentKey = await getAgentPublicKey(entry.agentId);
      if (agentKey && !entry.verifySignature(agentKey)) {
        invalidEntries.push({
          entryId: entry.entryId,
          error: 'Invalid signature',
          index: i
        });
      }
    }
    
    previousHash = entry.entryHash;
    if (i === 0) rootHash = entry.entryHash;
  }
  
  const valid = invalidEntries.length === 0;
  
  // Record verification
  await db.run(
    `INSERT INTO verification_records (
      verification_id, chain_id, verified_at, verified_by, entries_checked,
      entries_valid, entries_invalid, root_hash, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `verif_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      chainId,
      new Date().toISOString(),
      options.verifiedBy || 'system',
      entries.length,
      entries.length - invalidEntries.length,
      invalidEntries.length,
      rootHash,
      valid ? 'valid' : (invalidEntries.length < entries.length ? 'partial' : 'invalid')
    ]
  );
  
  return {
    valid,
    entriesChecked: entries.length,
    invalidEntries,
    rootHash,
    finalHash: previousHash,
    chainId
  };
}

/**
 * Get agent's public key from registry
 * @param {string} agentId
 * @returns {Promise<string|null>}
 */
async function getAgentPublicKey(agentId) {
  const row = await db.get(
    'SELECT public_key FROM agent_keys WHERE agent_id = ?',
    [agentId]
  );
  
  return row?.public_key || null;
}

/**
 * Register an agent's public key
 * @param {string} agentId
 * @param {string} publicKey - PEM encoded public key
 * @returns {Promise<void>}
 */
export async function registerAgentKey(agentId, publicKey) {
  const now = new Date().toISOString();
  
  await db.run(
    `INSERT INTO agent_keys (agent_id, public_key, registered_at, last_used)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       public_key = excluded.public_key,
       last_used = excluded.last_used`,
    [agentId, publicKey, now, now]
  );
  
  console.log(`[Audit] Registered key for agent: ${agentId}`);
}

/**
 * Generate a key pair for an agent
 * @param {string} agentId
 * @returns {Promise<Object>} { publicKey, privateKey }
 */
export async function generateAgentKeyPair(agentId) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  
  await registerAgentKey(agentId, publicKey);
  
  return { publicKey, privateKey };
}

/**
 * Query audit entries
 * @param {Object} filters - { agentId, action, resource, roomId, startTime, endTime, severity }
 * @returns {Promise<Array>}
 */
export async function queryAudit(filters = {}) {
  let sql = 'SELECT * FROM audit_entries WHERE 1=1';
  const params = [];
  
  if (filters.agentId) {
    sql += ' AND agent_id = ?';
    params.push(filters.agentId);
  }
  
  if (filters.action) {
    sql += ' AND action = ?';
    params.push(filters.action);
  }
  
  if (filters.resource) {
    sql += ' AND resource = ?';
    params.push(filters.resource);
  }
  
  if (filters.roomId) {
    sql += ' AND room_id = ?';
    params.push(filters.roomId);
  }
  
  if (filters.startTime) {
    sql += ' AND timestamp >= ?';
    params.push(filters.startTime);
  }
  
  if (filters.endTime) {
    sql += ' AND timestamp <= ?';
    params.push(filters.endTime);
  }
  
  if (filters.severity) {
    sql += ' AND severity = ?';
    params.push(filters.severity);
  }
  
  sql += ' ORDER BY timestamp DESC';
  
  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(filters.limit);
  }
  
  const rows = await db.all(sql, params);
  return rows.map(row => AuditEntry.fromDB(row));
}

/**
 * Archive entries older than retention period
 * @param {number} retentionDays - Days to keep (default: 90)
 * @returns {Promise<Object>} { archived: number }
 */
export async function archiveOldEntries(retentionDays = 90) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffStr = cutoff.toISOString();
  
  // Get entries to archive
  const entries = await db.all(
    'SELECT * FROM audit_entries WHERE timestamp < ? AND archived = 0',
    [cutoffStr]
  );
  
  if (entries.length === 0) {
    return { archived: 0 };
  }
  
  // Write to archive file
  const archiveDate = cutoff.toISOString().slice(0, 10);
  const archivePath = join(AUDIT_DIR, 'archive', `audit-${archiveDate}.jsonl`);
  
  const lines = entries.map(e => JSON.stringify(AuditEntry.fromDB(e).toJSON()));
  await fs.appendFile(archivePath, lines.join('\n') + '\n');
  
  // Mark as archived
  await db.run(
    'UPDATE audit_entries SET archived = 1 WHERE timestamp < ? AND archived = 0',
    [cutoffStr]
  );
  
  console.log(`[Audit] Archived ${entries.length} entries older than ${retentionDays} days`);
  
  return { archived: entries.length, archivePath };
}

/**
 * Export audit trail for compliance
 * @param {Object} options - { startTime, endTime, roomId, format }
 * @returns {Promise<Object>} { exportPath, entryCount, hash }
 */
export async function exportAudit(options = {}) {
  const entries = await queryAudit({
    roomId: options.roomId,
    startTime: options.startTime,
    endTime: options.endTime
  });
  
  if (entries.length === 0) {
    return { exportPath: null, entryCount: 0 };
  }
  
  const exportId = `export_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const format = options.format || 'jsonl';
  
  let content;
  let ext;
  
  switch (format) {
    case 'jsonl':
      content = entries.map(e => JSON.stringify(e.toJSON())).join('\n');
      ext = 'jsonl';
      break;
    case 'json':
      content = JSON.stringify(entries.map(e => e.toJSON()), null, 2);
      ext = 'json';
      break;
    case 'csv':
      // Simple CSV export
      const headers = 'entryId,timestamp,agentId,action,resource,severity,entryHash';
      const rows = entries.map(e => 
        `${e.entryId},${e.timestamp},${e.agentId},${e.action},${e.resource},${e.severity},${e.entryHash}`
      );
      content = [headers, ...rows].join('\n');
      ext = 'csv';
      break;
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
  
  const exportPath = join(AUDIT_DIR, 'exports', `${exportId}.${ext}`);
  await fs.writeFile(exportPath, content);
  
  // Calculate export hash
  const exportHash = createHash('sha256').update(content).digest('hex');
  
  console.log(`[Audit] Exported ${entries.length} entries to ${exportPath}`);
  
  return {
    exportId,
    exportPath,
    entryCount: entries.length,
    format,
    hash: exportHash,
    period: {
      start: options.startTime,
      end: options.endTime
    }
  };
}

/**
 * Get audit statistics
 * @param {Object} filters
 * @returns {Promise<Object>}
 */
export async function getAuditStats(filters = {}) {
  let sql = `
    SELECT 
      COUNT(*) as total_entries,
      COUNT(DISTINCT agent_id) as unique_agents,
      COUNT(DISTINCT room_id) as unique_rooms,
      MIN(timestamp) as earliest_entry,
      MAX(timestamp) as latest_entry,
      SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
      SUM(CASE WHEN severity = 'error' THEN 1 ELSE 0 END) as error_count,
      SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END) as archived_count
    FROM audit_entries
    WHERE 1=1
  `;
  const params = [];
  
  if (filters.roomId) {
    sql += ' AND room_id = ?';
    params.push(filters.roomId);
  }
  
  if (filters.startTime) {
    sql += ' AND timestamp >= ?';
    params.push(filters.startTime);
  }
  
  if (filters.endTime) {
    sql += ' AND timestamp <= ?';
    params.push(filters.endTime);
  }
  
  const stats = await db.get(sql, params);
  
  // Get action breakdown
  const actionBreakdown = await db.all(
    `SELECT action, COUNT(*) as count FROM audit_entries 
     WHERE 1=1 ${filters.roomId ? 'AND room_id = ?' : ''}
     GROUP BY action`,
    filters.roomId ? [filters.roomId] : []
  );
  
  return {
    totalEntries: stats.total_entries,
    uniqueAgents: stats.unique_agents,
    uniqueRooms: stats.unique_rooms,
    earliestEntry: stats.earliest_entry,
    latestEntry: stats.latest_entry,
    criticalCount: stats.critical_count,
    errorCount: stats.error_count,
    archivedCount: stats.archived_count,
    actionBreakdown: actionBreakdown.reduce((acc, row) => {
      acc[row.action] = row.count;
      return acc;
    }, {})
  };
}

/**
 * Get verification history
 * @param {string} chainId
 * @returns {Promise<Array>}
 */
export async function getVerificationHistory(chainId) {
  return await db.all(
    `SELECT * FROM verification_records 
     WHERE chain_id = ? 
     ORDER BY verified_at DESC`,
    [chainId]
  );
}

/**
 * Close database connection
 */
export async function closeAuditVault() {
  if (db) {
    await new Promise((resolve) => {
      db.close(() => resolve());
    });
    db = null;
  }
}

// Export all functions
export default {
  initializeAuditVault,
  logAudit,
  verifyChain,
  registerAgentKey,
  generateAgentKeyPair,
  queryAudit,
  archiveOldEntries,
  exportAudit,
  getAuditStats,
  getVerificationHistory,
  closeAuditVault,
  AuditEntry,
  AuditAction,
  AuditSeverity
};
