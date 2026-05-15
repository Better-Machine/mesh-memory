/**
 * Palace-TKG Integration (L3 Temporal Layer)
 * 
 * Connects Palace L1/L2 memory to Temporal Knowledge Graph for time-travel
 * queries, fact evolution tracking, and cryptographic audit trails.
 * 
 * L0: Agent Passport (identity-passport.mjs)
 * L1: Critical Facts (critical-facts-loader.mjs)
 * L2: Deep Memory Search (critical-facts-loader.mjs + FTS5)
 * L3: Temporal Knowledge Graph (THIS FILE) - time-travel, provenance, audit
 * 
 * @version 1.0.0
 * @module palace-tkg
 */

import { CriticalFactsLoader } from './critical-facts-loader.mjs';
import { PalaceLogger, LogLevel } from './palace-logger.mjs';
import { existsSync } from 'fs';
import { mkdirSync } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { createHash, randomUUID } from 'crypto';
import Database from 'better-sqlite3';

// Configuration
const CONFIG = {
  dbPath: path.join(homedir(), '.openclaw/workspace/memory/palace/palace-tkg.db'),
  logLevel: 'INFO'
};

// Logger
const logger = new PalaceLogger({
  minLevel: LogLevel[CONFIG.logLevel] || LogLevel.INFO,
  logDir: path.join(path.dirname(CONFIG.dbPath), 'logs'),
  logFile: 'palace-tkg.log'
});

/**
 * TemporalFact - L3 representation of a fact with time-travel support
 */
export class TemporalFact {
  constructor(data = {}) {
    this.id = data.id || randomUUID();
    this.factRef = data.factRef; // Reference to L1/L2 fact ID
    this.tier = data.tier || 'temporal'; // temporal, eternal, retracted
    
    // Temporal boundaries
    this.validFrom = data.validFrom || new Date().toISOString();
    this.validUntil = data.validUntil || null; // null = eternal
    
    // Content (snapshot at validFrom time)
    this.content = data.content || {};
    
    // Provenance chain
    this.previousVersion = data.previousVersion || null; // Hash of previous
    this.hash = data.hash || this._calculateHash();
    
    // Source
    this.sourceFactId = data.sourceFactId; // L1/L2 fact ID
    this.sourceTier = data.sourceTier; // 'L1' | 'L2'
    
    // Retraction (if applicable)
    this.retractedBy = data.retractedBy || null;
    this.retractionReason = data.retractionReason || null;
    
    // Audit
    this.createdAt = data.createdAt || new Date().toISOString();
    this.createdBy = data.createdBy || 'palace-tkg';
  }
  
  _calculateHash() {
    const data = JSON.stringify({
      id: this.id,
      factRef: this.factRef,
      validFrom: this.validFrom,
      content: this.content
    });
    return createHash('sha256').update(data).digest('hex');
  }
  
  /**
   * Check if fact is valid at a specific point in time
   */
  isValidAt(timestamp) {
    const checkTime = new Date(timestamp).getTime();
    const fromTime = new Date(this.validFrom).getTime();
    
    if (checkTime < fromTime) return false;
    
    if (this.validUntil) {
      const untilTime = new Date(this.validUntil).getTime();
      if (checkTime >= untilTime) return false;
    }
    
    if (this.retractedBy) return false;
    
    return true;
  }
  
  /**
   * Create retraction of this fact
   */
  retract(retractedBy, reason) {
    return new TemporalFact({
      ...this,
      id: randomUUID(),
      tier: 'retracted',
      validUntil: new Date().toISOString(),
      retractedBy,
      retractionReason: reason,
      previousVersion: this.hash
    });
  }
}

/**
 * PalaceTKG - Temporal Knowledge Graph for Palace L3
 */
export class PalaceTKG {
  constructor(options = {}) {
    this.dbPath = options.dbPath || CONFIG.dbPath;
    this.db = null;
    this.correlationId = options.correlationId || `tkg_${Date.now()}`;
  }
  
  /**
   * Initialize TKG database
   */
  async init() {
    // Ensure directory exists
    const dbDir = path.dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    
    // Open database
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    
    // Create tables
    this._createTables();
    
    logger.info('PalaceTKG initialized', { dbPath: this.dbPath });
    return this;
  }
  
  _createTables() {
    // Temporal facts table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS temporal_facts (
        id TEXT PRIMARY KEY,
        fact_ref TEXT NOT NULL,
        tier TEXT NOT NULL CHECK(tier IN ('temporal', 'eternal', 'retracted')),
        valid_from TEXT NOT NULL,
        valid_until TEXT,
        content TEXT NOT NULL, -- JSON
        previous_version TEXT,
        hash TEXT NOT NULL,
        source_fact_id TEXT,
        source_tier TEXT CHECK(source_tier IN ('L1', 'L2')),
        retracted_by TEXT,
        retraction_reason TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      )
    `);
    
    // Indexes
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_fact_ref ON temporal_facts(fact_ref)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_valid_from ON temporal_facts(valid_from)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_valid_until ON temporal_facts(valid_until)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_tier ON temporal_facts(tier)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_source ON temporal_facts(source_fact_id, source_tier)`);
    
    // Audit log table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tkg_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        fact_id TEXT NOT NULL,
        details TEXT, -- JSON
        timestamp TEXT NOT NULL,
        correlation_id TEXT
      )
    `);
  }
  
  /**
   * Store a fact in temporal layer
   */
  storeTemporalFact(factData) {
    const fact = new TemporalFact(factData);
    
    const sql = `
      INSERT INTO temporal_facts (
        id, fact_ref, tier, valid_from, valid_until, content,
        previous_version, hash, source_fact_id, source_tier,
        retracted_by, retraction_reason, created_at, created_by
      ) VALUES (
        @id, @factRef, @tier, @validFrom, @validUntil, @content,
        @previousVersion, @hash, @sourceFactId, @sourceTier,
        @retractedBy, @retractionReason, @createdAt, @createdBy
      )
    `;
    
    const stmt = this.db.prepare(sql);
    stmt.run({
      id: fact.id,
      factRef: fact.factRef,
      tier: fact.tier,
      validFrom: fact.validFrom,
      validUntil: fact.validUntil,
      content: JSON.stringify(fact.content),
      previousVersion: fact.previousVersion,
      hash: fact.hash,
      sourceFactId: fact.sourceFactId,
      sourceTier: fact.sourceTier,
      retractedBy: fact.retractedBy,
      retractionReason: fact.retractionReason,
      createdAt: fact.createdAt,
      createdBy: fact.createdBy
    });
    
    // Audit log
    this._auditLog('STORE', fact.id, { factRef: fact.factRef });
    
    logger.debug('Temporal fact stored', { factId: fact.id, factRef: fact.factRef });
    return fact;
  }
  
  /**
   * Get fact as it existed at a specific point in time
   */
  getFactAtTime(factRef, timestamp) {
    const sql = `
      SELECT * FROM temporal_facts
      WHERE fact_ref = @factRef
        AND valid_from <= @timestamp
        AND (valid_until IS NULL OR valid_until > @timestamp)
        AND retracted_by IS NULL
      ORDER BY valid_from DESC
      LIMIT 1
    `;
    
    const stmt = this.db.prepare(sql);
    const row = stmt.get({ factRef, timestamp });
    
    if (!row) return null;
    
    return this._rowToTemporalFact(row);
  }
  
  /**
   * Get all versions of a fact
   */
  getFactHistory(factRef) {
    const sql = `
      SELECT * FROM temporal_facts
      WHERE fact_ref = @factRef
      ORDER BY valid_from ASC
    `;
    
    const stmt = this.db.prepare(sql);
    const rows = stmt.all({ factRef });
    
    return rows.map(row => this._rowToTemporalFact(row));
  }
  
  /**
   * Retract a fact
   */
  retractFact(factRef, retractedBy, reason) {
    // Get current version
    const current = this.getFactAtTime(factRef, new Date().toISOString());
    if (!current) {
      throw new Error(`Fact ${factRef} not found or already retracted`);
    }
    
    // Create retraction
    const retraction = current.retract(retractedBy, reason);
    
    // Update current version's valid_until
    this.db.prepare(`
      UPDATE temporal_facts
      SET valid_until = @now
      WHERE fact_ref = @factRef AND valid_until IS NULL
    `).run({ now: new Date().toISOString(), factRef });
    
    // Store retraction
    this.storeTemporalFact(retraction);
    
    // Audit log
    this._auditLog('RETRACT', retraction.id, { originalFact: factRef, reason });
    
    logger.info('Fact retracted', { factRef, retractedBy, reason });
    return retraction;
  }
  
  /**
   * Sync L1/L2 facts to temporal layer
   */
  syncFromPalace(loader) {
    logger.info('Syncing Palace facts to TKG...');
    
    // Get current L1 facts
    const l1Result = loader.getCriticalFacts();
    if (!l1Result.success) {
      throw new Error(`Failed to get L1 facts: ${l1Result.error?.message}`);
    }
    
    let syncCount = 0;
    
    for (const fact of l1Result.data) {
      // Check if already synced
      const existing = this.db.prepare(`
        SELECT COUNT(*) as count FROM temporal_facts
        WHERE source_fact_id = @id AND source_tier = 'L1'
      `).get({ id: fact.id });
      
      if (existing.count === 0) {
        // Store as temporal fact
        this.storeTemporalFact({
          factRef: `l1-${fact.id}`,
          tier: fact.tier === 'critical' ? 'eternal' : 'temporal',
          content: fact.content,
          sourceFactId: fact.id,
          sourceTier: 'L1',
          validFrom: fact.provenance?.timestamp || new Date().toISOString()
        });
        syncCount++;
      }
    }
    
    logger.info('Palace sync complete', { synced: syncCount, totalL1: l1Result.data.length });
    return { synced: syncCount, total: l1Result.data.length };
  }
  
  /**
   * Query facts valid at specific time
   */
  queryFactsAtTime(timestamp, options = {}) {
    const { category, limit = 100 } = options;
    
    let sql = `
      SELECT * FROM temporal_facts
      WHERE valid_from <= @timestamp
        AND (valid_until IS NULL OR valid_until > @timestamp)
        AND retracted_by IS NULL
    `;
    
    if (category) {
      sql += ` AND json_extract(content, '$.category') = @category`;
    }
    
    sql += ` ORDER BY valid_from DESC LIMIT @limit`;
    
    const stmt = this.db.prepare(sql);
    const rows = stmt.all({ timestamp, category, limit });
    
    return rows.map(row => this._rowToTemporalFact(row));
  }
  
  /**
   * Verify hash chain integrity
   */
  verifyChain(factRef) {
    const history = this.getFactHistory(factRef);
    
    for (let i = 1; i < history.length; i++) {
      const current = history[i];
      const previous = history[i - 1];
      
      if (current.previousVersion !== previous.hash) {
        return {
          valid: false,
          brokenAt: current.id,
          expected: previous.hash,
          actual: current.previousVersion
        };
      }
    }
    
    return { valid: true, chainLength: history.length };
  }
  
  /**
   * Get audit log
   */
  getAuditLog(options = {}) {
    const { limit = 100, action } = options;
    
    let sql = 'SELECT * FROM tkg_audit_log';
    if (action) sql += ' WHERE action = @action';
    sql += ' ORDER BY timestamp DESC LIMIT @limit';
    
    const stmt = this.db.prepare(sql);
    return action 
      ? stmt.all({ action, limit })
      : stmt.all({ limit });
  }
  
  /**
   * Audit logging
   */
  _auditLog(action, factId, details = {}) {
    const sql = `
      INSERT INTO tkg_audit_log (action, fact_id, details, timestamp, correlation_id)
      VALUES (@action, @factId, @details, @timestamp, @correlationId)
    `;
    
    this.db.prepare(sql).run({
      action,
      factId,
      details: JSON.stringify(details),
      timestamp: new Date().toISOString(),
      correlationId: this.correlationId
    });
  }
  
  /**
   * Convert DB row to TemporalFact
   */
  _rowToTemporalFact(row) {
    return new TemporalFact({
      id: row.id,
      factRef: row.fact_ref,
      tier: row.tier,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      content: JSON.parse(row.content),
      previousVersion: row.previous_version,
      hash: row.hash,
      sourceFactId: row.source_fact_id,
      sourceTier: row.source_tier,
      retractedBy: row.retracted_by,
      retractionReason: row.retraction_reason,
      createdAt: row.created_at,
      createdBy: row.created_by
    });
  }
  
  /**
   * Close database
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('PalaceTKG closed');
    }
  }
}

/**
 * Factory function
 */
export async function createPalaceTKG(options = {}) {
  const tkg = new PalaceTKG(options);
  await tkg.init();
  return tkg;
}

export default { PalaceTKG, TemporalFact, createPalaceTKG };
