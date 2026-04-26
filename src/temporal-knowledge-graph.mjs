/**
 * @module temporal-knowledge-graph
 * @description Temporal Knowledge Graph (TKG) for Mesh Memory Protocol v2.0
 * 
 * Stores facts with temporal validity, enabling time-travel queries and
 * cryptographic audit trails. Supports eternal facts, retractions, and
 * hash-chained provenance for tamper-evident history.
 * 
 * Architecture: SQLite-based with temporal indexing, following token-service.mjs patterns
 * Hash chain: Global chain per room for audit integrity
 * 
 * @version 1.0.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { loadConfig } from '../config.mjs';

// Config and paths
let config = null;
let DEAL_ROOMS_DIR = 'memory/deal-rooms';

// SQLite database handles per room
const dbHandles = new Map();

/**
 * Initialize TKG system
 * @returns {Promise<void>}
 */
export async function initializeTKG() {
  config = loadConfig();
  
  const baseDir = config.memory?.baseDir || 'memory';
  DEAL_ROOMS_DIR = join(baseDir, 'deal-rooms');
  
  console.log(`[temporal-knowledge-graph] Initialized`);
}

/**
 * Get TKG directory path for a room
 * @param {string} roomId
 * @returns {string}
 */
function getTKGDir(roomId) {
  return join(DEAL_ROOMS_DIR, roomId, 'tkg');
}

/**
 * Get database path for a room
 * @param {string} roomId
 * @returns {string}
 */
function getDBPath(roomId) {
  return join(getTKGDir(roomId), 'facts.db');
}

/**
 * Initialize or get existing database connection for a room
 * @param {string} roomId
 * @returns {Promise<sqlite3.Database>}
 */
async function getRoomDB(roomId) {
  if (dbHandles.has(roomId)) {
    return dbHandles.get(roomId);
  }
  
  // Ensure directory exists
  const tkgDir = getTKGDir(roomId);
  await fs.mkdir(tkgDir, { recursive: true });
  await fs.mkdir(join(tkgDir, 'provenance'), { recursive: true });
  
  const dbPath = getDBPath(roomId);
  
  // Initialize SQLite database
  const db = new sqlite3.Database(dbPath);
  
  // Promisify database methods
  db.run = promisify(db.run.bind(db));
  db.get = promisify(db.get.bind(db));
  db.all = promisify(db.all.bind(db));
  
  // Create tables and indexes if they don't exist
  await initializeSchema(db);
  
  dbHandles.set(roomId, db);
  return db;
}

/**
 * Initialize SQLite schema with temporal indexing
 * @param {sqlite3.Database} db
 */
async function initializeSchema(db) {
  // Facts table with temporal validity
  await db.run(`
    CREATE TABLE IF NOT EXISTS facts (
      fact_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_until TEXT,
      extracted_by TEXT NOT NULL,
      extracted_at TEXT NOT NULL,
      source TEXT,
      confidence REAL,
      verification_hash TEXT NOT NULL,
      previous_hash TEXT,
      room_id TEXT NOT NULL,
      is_retracted INTEGER DEFAULT 0,
      retracted_at TEXT,
      retraction_provenance TEXT
    )
  `);
  
  // Subject-predicate index for entity lookups
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_subject_predicate ON facts(subject, predicate)
  `);
  
  // Temporal index for time-range queries
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_temporal ON facts(valid_from, valid_until)
  `);
  
  // Room index for multi-tenant queries
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_room ON facts(room_id)
  `);
  
  // Index for retraction queries
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_retracted ON facts(is_retracted, retracted_at)
  `);
  
  // Hash chain index for integrity verification
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_hash_chain ON facts(previous_hash, verification_hash)
  `);
  
  // Hash registry for global chain root
  await db.run(`
    CREATE TABLE IF NOT EXISTS hash_registry (
      room_id TEXT PRIMARY KEY,
      last_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

/**
 * Calculate SHA-256 hash of a fact's canonical representation
 * @param {Object} fact
 * @returns {string}
 */
function calculateFactHash(fact) {
  // Canonical JSON representation (sorted keys for consistency)
  const canonical = {
    subject: fact.subject,
    predicate: fact.predicate,
    object: fact.object,
    validFrom: fact.validFrom,
    validUntil: fact.validUntil,
    extractedBy: fact.extractedBy,
    extractedAt: fact.extractedAt,
    source: fact.source,
    confidence: fact.confidence,
    roomId: fact.roomId,
    previousHash: fact.previousHash
  };
  
  const data = JSON.stringify(canonical, Object.keys(canonical).sort());
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Get the last hash in the room's chain for chaining
 * @param {sqlite3.Database} db
 * @param {string} roomId
 * @returns {Promise<string>}
 */
async function getLastHash(db, roomId) {
  // Check hash registry first
  const registryEntry = await db.get(
    'SELECT last_hash FROM hash_registry WHERE room_id = ?',
    [roomId]
  );
  
  if (registryEntry) {
    return registryEntry.last_hash;
  }
  
  // Fallback: get most recent fact's hash
  const lastFact = await db.get(
    'SELECT verification_hash FROM facts WHERE room_id = ? ORDER BY extracted_at DESC LIMIT 1',
    [roomId]
  );
  
  return lastFact?.verification_hash || '0';
}

/**
 * Update the hash registry with the new last hash
 * @param {sqlite3.Database} db
 * @param {string} roomId
 * @param {string} newHash
 */
async function updateHashRegistry(db, roomId, newHash) {
  const now = new Date().toISOString();
  
  await db.run(
    `INSERT INTO hash_registry (room_id, last_hash, updated_at) 
     VALUES (?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET 
       last_hash = excluded.last_hash,
       updated_at = excluded.updated_at`,
    [roomId, newHash, now]
  );
}

/**
 * Assert a new fact into the temporal knowledge graph
 * 
 * @param {string} roomId - Room ID
 * @param {string} subject - Entity identifier (e.g., "AcmeCorp")
 * @param {string} predicate - Attribute/relationship (e.g., "security_certification")
 * @param {any} object - Value (e.g., "SOC2 Type II")
 * @param {Object} validityPeriod - {validFrom: ISO8601, validUntil: ISO8601 | null}
 * @param {Object} provenance - {extractedBy, extractedAt, source?, confidence?}
 * @returns {Promise<string>} factId
 */
export async function assertFact(roomId, subject, predicate, object, validityPeriod, provenance) {
  if (!subject || typeof subject !== 'string') {
    throw new Error('Invalid subject: must be a non-empty string');
  }
  
  if (!predicate || typeof predicate !== 'string') {
    throw new Error('Invalid predicate: must be a non-empty string');
  }
  
  if (object === undefined) {
    throw new Error('Invalid object: must have a value');
  }
  
  const db = await getRoomDB(roomId);
  const factId = `fact_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  
  const validFrom = validityPeriod?.validFrom || new Date().toISOString();
  const validUntil = validityPeriod?.validUntil || null;
  
  const extractedBy = provenance.extractedBy;
  const extractedAt = provenance.extractedAt || new Date().toISOString();
  const source = provenance.source || null;
  const confidence = provenance.confidence || 1.0;
  
  if (!extractedBy) {
    throw new Error('provenance.extractedBy is required');
  }
  
  // Get previous hash for chaining (outside transaction to reduce lock time)
  const previousHash = await getLastHash(db, roomId);
  
  // Build fact object for hashing
  const fact = {
    subject,
    predicate,
    object: JSON.stringify(object),
    validFrom,
    validUntil,
    extractedBy,
    extractedAt,
    source,
    confidence,
    roomId,
    previousHash
  };
  
  // Calculate verification hash
  const verificationHash = calculateFactHash(fact);
  
  // Insert fact with retry logic for transaction conflicts
  let retries = 3;
  while (retries > 0) {
    try {
      await db.run('BEGIN TRANSACTION');
      
      await db.run(
        `INSERT INTO facts (
          fact_id, subject, predicate, object, valid_from, valid_until,
          extracted_by, extracted_at, source, confidence, verification_hash,
          previous_hash, room_id, is_retracted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          factId, subject, predicate, JSON.stringify(object), validFrom, validUntil,
          extractedBy, extractedAt, source, confidence, verificationHash,
          previousHash, roomId
        ]
      );
      
      // Update hash registry
      await updateHashRegistry(db, roomId, verificationHash);
      
      await db.run('COMMIT');
      break; // Success, exit retry loop
    } catch (error) {
      await db.run('ROLLBACK').catch(() => {}); // Ignore rollback errors
      
      if (error.message?.includes('BUSY') || error.message?.includes('cannot start a transaction')) {
        retries--;
        if (retries > 0) {
          await new Promise(r => setTimeout(r, 10 * (4 - retries))); // Exponential backoff
          continue;
        }
      }
      throw error;
    }
  }
  
  console.log(`[TKG] Asserted fact ${factId}: ${subject} ${predicate} [valid: ${validFrom} → ${validUntil || 'eternal'}]`);
  
  return factId;
}

/**
 * Query what was true about a subject/predicate at a specific time
 * 
 * @param {string} roomId
 * @param {string} subject
 * @param {string} predicate
 * @param {string} timestamp - ISO8601 timestamp
 * @returns {Promise<Object|null>} Fact state at that time
 */
export async function queryAtTime(roomId, subject, predicate, timestamp) {
  const db = await getRoomDB(roomId);
  
  const row = await db.get(
    `SELECT * FROM facts 
     WHERE room_id = ? 
       AND subject = ? 
       AND predicate = ?
       AND valid_from <= ?
       AND (valid_until IS NULL OR valid_until > ?)
       AND is_retracted = 0
     ORDER BY valid_from DESC
     LIMIT 1`,
    [roomId, subject, predicate, timestamp, timestamp]
  );
  
  if (!row) {
    return null;
  }
  
  return rowToFact(row);
}

/**
 * Query complete history of a subject/predicate over time
 * 
 * @param {string} roomId
 * @param {string} subject
 * @param {string} predicate
 * @returns {Promise<Array>} All states of the fact over time
 */
export async function queryHistory(roomId, subject, predicate) {
  const db = await getRoomDB(roomId);
  
  const rows = await db.all(
    `SELECT * FROM facts 
     WHERE room_id = ? 
       AND subject = ? 
       AND predicate = ?
     ORDER BY valid_from ASC, extracted_at ASC`,
    [roomId, subject, predicate]
  );
  
  return rows.map(rowToFact);
}

/**
 * Query all facts valid during a specific time window
 * 
 * @param {string} roomId
 * @param {string} startTime - ISO8601
 * @param {string} endTime - ISO8601
 * @param {Object} options - {subject?, limit?}
 * @returns {Promise<Array>} Facts valid during the window
 */
export async function queryValidDuring(roomId, startTime, endTime, options = {}) {
  const db = await getRoomDB(roomId);
  
  let sql = `
    SELECT * FROM facts 
    WHERE room_id = ?
      AND valid_from < ?
      AND (valid_until IS NULL OR valid_until > ?)
      AND is_retracted = 0
  `;
  
  const params = [roomId, endTime, startTime];
  
  if (options.subject) {
    sql += ` AND subject = ?`;
    params.push(options.subject);
  }
  
  sql += ` ORDER BY valid_from DESC`;
  
  if (options.limit) {
    sql += ` LIMIT ?`;
    params.push(options.limit);
  }
  
  const rows = await db.all(sql, params);
  return rows.map(rowToFact);
}

/**
 * Retract a fact (soft delete with audit trail)
 * Sets validUntil to retraction time and marks as retracted
 * 
 * @param {string} roomId
 * @param {string} factId
 * @param {Object} retractionProvenance - {retractedBy, reason}
 * @returns {Promise<Object>} Retraction result
 */
export async function retractFact(roomId, factId, retractionProvenance) {
  const db = await getRoomDB(roomId);
  
  const retractedBy = retractionProvenance?.retractedBy;
  const reason = retractionProvenance?.reason || 'unspecified';
  
  if (!retractedBy) {
    throw new Error('retractionProvenance.retractedBy is required');
  }
  
  const retractedAt = new Date().toISOString();
  
  // Get the fact to verify it exists
  const fact = await db.get(
    'SELECT * FROM facts WHERE fact_id = ? AND room_id = ?',
    [factId, roomId]
  );
  
  if (!fact) {
    throw new Error(`Fact not found: ${factId}`);
  }
  
  if (fact.is_retracted) {
    throw new Error(`Fact ${factId} is already retracted`);
  }
  
  const provenanceJson = JSON.stringify({
    retractedBy,
    reason,
    retractedAt
  });
  
  // Use serialized transaction handling - no nested transactions
  try {
    // Mark as retracted - update the fact in place
    // The fact's verification_hash stays the same (it's immutable)
    await db.run(
      `UPDATE facts 
       SET is_retracted = 1,
           retracted_at = ?,
           retraction_provenance = ?,
           valid_until = ?
       WHERE fact_id = ?`,
      [retractedAt, provenanceJson, retractedAt, factId]
    );
    
    // Note: We don't add a separate hash chain entry for retraction
    // The retraction is recorded in the fact's retraction_provenance field
    // and the valid_until is updated to the retraction time
    
    console.log(`[TKG] Retracted fact ${factId}: ${reason}`);
    
    return {
      factId,
      retractedAt,
      retractedBy,
      reason,
      previousValidity: {
        validFrom: fact.valid_from,
        validUntil: fact.valid_until
      }
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Get the provenance chain for a fact
 * Traverses previous_hash links to show derivation
 * 
 * @param {string} roomId
 * @param {string} factId
 * @returns {Promise<Array>} Chain of facts from root to this fact
 */
export async function getFactChain(roomId, factId) {
  const db = await getRoomDB(roomId);
  
  const chain = [];
  let currentId = factId;
  const visited = new Set(); // Prevent infinite loops
  
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    
    // Try to find as a fact
    const fact = await db.get(
      'SELECT * FROM facts WHERE fact_id = ? AND room_id = ?',
      [currentId, roomId]
    );
    
    if (fact) {
      chain.unshift(rowToFact(fact));
      currentId = null; // Facts don't link to previous in the same way
    } else {
      break;
    }
  }
  
  // Also get the global hash chain context
  const hashChain = await db.all(
    `SELECT fact_id, verification_hash, previous_hash, extracted_at, extracted_by
     FROM facts 
     WHERE room_id = ?
       AND extracted_at <= (SELECT extracted_at FROM facts WHERE fact_id = ?)
     ORDER BY extracted_at ASC
     LIMIT 50`,
    [roomId, factId]
  );
  
  return {
    factChain: chain,
    hashChainContext: hashChain.map(row => ({
      factId: row.fact_id,
      hash: row.verification_hash,
      previousHash: row.previous_hash,
      extractedAt: row.extracted_at,
      extractedBy: row.extracted_by
    }))
  };
}

/**
 * Convert database row to fact object
 * @param {Object} row
 * @returns {Object}
 */
function rowToFact(row) {
  return {
    factId: row.fact_id,
    subject: row.subject,
    predicate: row.predicate,
    object: JSON.parse(row.object),
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    extractedBy: row.extracted_by,
    extractedAt: row.extracted_at,
    source: row.source,
    confidence: row.confidence,
    verificationHash: row.verification_hash,
    previousHash: row.previous_hash,
    roomId: row.room_id,
    isRetracted: row.is_retracted === 1,
    retractedAt: row.retracted_at,
    retractionProvenance: row.retraction_provenance ? JSON.parse(row.retraction_provenance) : null
  };
}

/**
 * Get TKG statistics for a room
 * @param {string} roomId
 * @returns {Promise<Object>}
 */
export async function getTKGStats(roomId) {
  const db = await getRoomDB(roomId);
  
  const stats = await db.get(
    `SELECT 
      COUNT(*) as total_facts,
      SUM(CASE WHEN is_retracted = 1 THEN 1 ELSE 0 END) as retracted_facts,
      SUM(CASE WHEN valid_until IS NULL AND is_retracted = 0 THEN 1 ELSE 0 END) as eternal_facts,
      COUNT(DISTINCT subject) as unique_subjects,
      COUNT(DISTINCT predicate) as unique_predicates,
      MIN(extracted_at) as first_fact_at,
      MAX(extracted_at) as last_fact_at
     FROM facts 
     WHERE room_id = ?`,
    [roomId]
  );
  
  // Get last hash for integrity check
  const lastHash = await getLastHash(db, roomId);
  
  return {
    totalFacts: stats.total_facts,
    retractedFacts: stats.retracted_facts,
    eternalFacts: stats.eternal_facts,
    uniqueSubjects: stats.unique_subjects,
    uniquePredicates: stats.unique_predicates,
    firstFactAt: stats.first_fact_at,
    lastFactAt: stats.last_fact_at,
    currentChainHash: lastHash === '0' ? null : lastHash
  };
}

/**
 * Close database connection for a room
 * @param {string} roomId
 */
export async function closeRoomDB(roomId) {
  const db = dbHandles.get(roomId);
  if (db) {
    await new Promise((resolve) => {
      db.close(() => resolve());
    });
    dbHandles.delete(roomId);
  }
}

/**
 * Close all database connections
 */
export async function closeAllDBs() {
  for (const [roomId, db] of dbHandles) {
    await new Promise((resolve) => {
      db.close(() => resolve());
    });
  }
  dbHandles.clear();
}

// Export all functions (already exported individually above)
export { getRoomDB };

export default {
  initializeTKG,
  assertFact,
  queryAtTime,
  queryHistory,
  queryValidDuring,
  retractFact,
  getFactChain,
  getTKGStats,
  closeRoomDB,
  closeAllDBs
};