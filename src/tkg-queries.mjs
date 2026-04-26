/**
 * @module tkg-queries
 * @description Query Engine for Temporal Knowledge Graph
 * 
 * Provides complex temporal queries, graph traversal, conflict detection,
 * and integrity verification for the TKG system.
 * 
 * Features:
 * - Path finding between entities
 * - Connected subgraph discovery
 * - Temporal conflict detection
 * - Cryptographic integrity verification
 * - Snapshot export at any point in time
 * 
 * @version 1.0.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { loadConfig } from '../config.mjs';
import { getRoomDB, closeRoomDB } from './temporal-knowledge-graph.mjs';

// Config and paths
let config = null;
let DEAL_ROOMS_DIR = 'memory/deal-rooms';

/**
 * Initialize TKG query engine
 * @returns {Promise<void>}
 */
export async function initializeTKGQueries() {
  config = loadConfig();
  
  const baseDir = config.memory?.baseDir || 'memory';
  DEAL_ROOMS_DIR = join(baseDir, 'deal-rooms');
  
  console.log(`[tkg-queries] Initialized`);
}

/**
 * Find shortest path between two entities through shared predicates
 * Uses BFS traversal limited by maxDepth
 * 
 * @param {string} roomId
 * @param {string} subject1 - Starting entity
 * @param {string} subject2 - Target entity
 * @param {number} maxDepth - Maximum traversal depth (default: 5)
 * @returns {Promise<Array|null>} Path of connected facts or null
 */
export async function findPath(roomId, subject1, subject2, maxDepth = 5) {
  const db = await getRoomDB(roomId);
  
  // BFS queue: [{ subject, path: [fact], depth }]
  const queue = [{ subject: subject1, path: [], depth: 0 }];
  const visited = new Set();
  
  while (queue.length > 0) {
    const { subject, path, depth } = queue.shift();
    
    if (subject === subject2) {
      return path;
    }
    
    if (depth >= maxDepth || visited.has(subject)) {
      continue;
    }
    
    visited.add(subject);
    
    // Get all facts about this subject
    const facts = await db.all(
      `SELECT * FROM facts 
       WHERE room_id = ? 
         AND subject = ?
         AND is_retracted = 0
         AND (valid_until IS NULL OR valid_until > datetime('now'))`,
      [roomId, subject]
    );
    
    for (const fact of facts) {
      // Parse object to see if it's a reference to another entity
      let objectValue;
      try {
        objectValue = JSON.parse(fact.object);
      } catch {
        objectValue = fact.object;
      }
      
      // Check if object is a subject reference
      const nextSubject = typeof objectValue === 'string' ? objectValue : null;
      
      if (nextSubject && nextSubject !== subject) {
        const factObj = rowToFact(fact);
        queue.push({
          subject: nextSubject,
          path: [...path, factObj],
          depth: depth + 1
        });
      }
      
      // Also check for inverse relationships (where subject appears as object)
      const inverseFacts = await db.all(
        `SELECT * FROM facts 
         WHERE room_id = ? 
           AND object LIKE ?
           AND is_retracted = 0
           AND (valid_until IS NULL OR valid_until > datetime('now'))
         LIMIT 10`,
        [roomId, `%"${subject}"%`]
      );
      
      for (const invFact of inverseFacts) {
        const invFactObj = rowToFact(invFact);
        if (!visited.has(invFact.subject)) {
          queue.push({
            subject: invFact.subject,
            path: [...path, invFactObj],
            depth: depth + 1
          });
        }
      }
    }
  }
  
  return null; // No path found
}

/**
 * Get all entities related to a subject within a depth limit
 * Returns a connected subgraph
 * 
 * @param {string} roomId
 * @param {string} subject
 * @param {number} depth - How many hops to traverse (default: 2)
 * @param {Object} options - {timestamp?} for point-in-time view
 * @returns {Promise<Object>} Connected subgraph
 */
export async function getRelatedEntities(roomId, subject, depth = 2, options = {}) {
  const db = await getRoomDB(roomId);
  
  const subgraph = {
    root: subject,
    entities: new Map(),
    edges: []
  };
  
  const queue = [{ subject, currentDepth: 0 }];
  const processed = new Set();
  
  // Time constraint for temporal queries
  const timestamp = options.timestamp || new Date().toISOString();
  
  while (queue.length > 0) {
    const { subject: currentSubject, currentDepth } = queue.shift();
    
    if (currentDepth >= depth || processed.has(currentSubject)) {
      continue;
    }
    
    processed.add(currentSubject);
    
    // Get facts about this subject
    const facts = await db.all(
      `SELECT * FROM facts 
       WHERE room_id = ? 
         AND subject = ?
         AND valid_from <= ?
         AND (valid_until IS NULL OR valid_until > ?)
         AND is_retracted = 0`,
      [roomId, currentSubject, timestamp, timestamp]
    );
    
    // Build entity info
    const predicates = {};
    for (const fact of facts) {
      if (!predicates[fact.predicate]) {
        predicates[fact.predicate] = [];
      }
      
      let obj;
      try {
        obj = JSON.parse(fact.object);
      } catch {
        obj = fact.object;
      }
      
      predicates[fact.predicate].push({
        value: obj,
        confidence: fact.confidence,
        source: fact.source,
        validFrom: fact.valid_from
      });
      
      // If object is a string reference to another entity, add to queue
      if (typeof obj === 'string' && obj !== currentSubject && currentDepth + 1 < depth) {
        queue.push({ subject: obj, currentDepth: currentDepth + 1 });
      }
      
      // Track edges
      subgraph.edges.push({
        from: currentSubject,
        predicate: fact.predicate,
        to: obj,
        confidence: fact.confidence
      });
    }
    
    subgraph.entities.set(currentSubject, {
      subject: currentSubject,
      predicates,
      depth: currentDepth
    });
  }
  
  // Convert Map to plain object for serialization
  return {
    root: subgraph.root,
    entities: Object.fromEntries(subgraph.entities),
    edgeCount: subgraph.edges.length,
    entityCount: subgraph.entities.size
  };
}

/**
 * Detect temporal conflicts in a room
 * Conflicts include:
 * - Overlapping validity periods for same subject/predicate with different values
 * - Contradictory facts (e.g., certification valid and expired simultaneously)
 * - Retraction without replacement
 * 
 * @param {string} roomId
 * @returns {Promise<Array>} List of detected conflicts
 */
export async function detectConflicts(roomId) {
  const db = await getRoomDB(roomId);
  
  const conflicts = [];
  
  // Find overlapping validity periods for same subject/predicate
  const overlappingFacts = await db.all(
    `SELECT f1.fact_id as fact1_id, f2.fact_id as fact2_id,
            f1.subject, f1.predicate, f1.object as object1, f2.object as object2,
            f1.valid_from as from1, f1.valid_until as until1,
            f2.valid_from as from2, f2.valid_until as until2
     FROM facts f1
     JOIN facts f2 ON f1.subject = f2.subject 
                  AND f1.predicate = f2.predicate
                  AND f1.fact_id < f2.fact_id
     WHERE f1.room_id = ?
       AND f2.room_id = ?
       AND f1.is_retracted = 0
       AND f2.is_retracted = 0
       AND f1.valid_from <= COALESCE(f2.valid_until, '9999-12-31')
       AND COALESCE(f1.valid_until, '9999-12-31') >= f2.valid_from`,
    [roomId, roomId]
  );
  
  for (const overlap of overlappingFacts) {
    // Check if values differ (if same, it's just a renewal, not conflict)
    if (overlap.object1 !== overlap.object2) {
      conflicts.push({
        type: 'TEMPORAL_OVERLAP',
        severity: 'WARNING',
        subject: overlap.subject,
        predicate: overlap.predicate,
        description: `Conflicting values for ${overlap.subject} ${overlap.predicate}`,
        facts: [
          {
            factId: overlap.fact1_id,
            value: JSON.parse(overlap.object1),
            validFrom: overlap.from1,
            validUntil: overlap.until1
          },
          {
            factId: overlap.fact2_id,
            value: JSON.parse(overlap.object2),
            validFrom: overlap.from2,
            validUntil: overlap.until2
          }
        ],
        overlapWindow: {
          start: overlap.from1 > overlap.from2 ? overlap.from1 : overlap.from2,
          end: (overlap.until1 && overlap.until2) 
            ? (overlap.until1 < overlap.until2 ? overlap.until1 : overlap.until2)
            : (overlap.until1 || overlap.until2)
        }
      });
    }
  }
  
  // Find retracted facts without replacement
  const retractedWithoutReplacement = await db.all(
    `SELECT * FROM facts 
     WHERE room_id = ?
       AND is_retracted = 1
       AND NOT EXISTS (
         SELECT 1 FROM facts f2 
         WHERE f2.room_id = facts.room_id
           AND f2.subject = facts.subject
           AND f2.predicate = facts.predicate
           AND f2.is_retracted = 0
           AND f2.valid_from > facts.valid_from
       )`,
    [roomId]
  );
  
  for (const retracted of retractedWithoutReplacement) {
    const prov = JSON.parse(retracted.retraction_provenance || '{}');
    
    conflicts.push({
      type: 'RETRACTION_WITHOUT_REPLACEMENT',
      severity: 'INFO',
      subject: retracted.subject,
      predicate: retracted.predicate,
      description: `Fact retracted without replacement: ${retracted.subject} ${retracted.predicate}`,
      retractedFact: {
        factId: retracted.fact_id,
        value: JSON.parse(retracted.object),
        retractedAt: retracted.retracted_at,
        reason: prov.reason
      }
    });
  }
  
  // Find potential contradictions (certification both valid and expired)
  const contradictions = await db.all(
    `SELECT subject, predicate FROM facts
     WHERE room_id = ?
       AND predicate LIKE '%status%'
     GROUP BY subject, predicate
     HAVING COUNT(DISTINCT object) > 1`,
    [roomId]
  );
  
  for (const contradiction of contradictions) {
    // Get all values for this subject/predicate
    const values = await db.all(
      `SELECT fact_id, object, valid_from, valid_until, is_retracted
       FROM facts
       WHERE room_id = ? 
         AND subject = ? 
         AND predicate = ?
       ORDER BY valid_from`,
      [roomId, contradiction.subject, contradiction.predicate]
    );
    
    // Check for contradictory values at same time
    for (let i = 0; i < values.length - 1; i++) {
      for (let j = i + 1; j < values.length; j++) {
        const v1 = JSON.parse(values[i].object);
        const v2 = JSON.parse(values[j].object);
        
        // Simple contradiction check (can be expanded)
        if ((v1 === 'valid' && v2 === 'expired') ||
            (v1 === 'active' && v2 === 'inactive') ||
            (v1 === 'certified' && v2 === 'revoked')) {
          
          // Check temporal overlap
          const overlap = values[i].valid_from <= (values[j].valid_until || '9999-12-31') &&
                         (values[i].valid_until || '9999-12-31') >= values[j].valid_from;
          
          if (overlap && !values[i].is_retracted && !values[j].is_retracted) {
            conflicts.push({
              type: 'CONTRADICTION',
              severity: 'ERROR',
              subject: contradiction.subject,
              predicate: contradiction.predicate,
              description: `Contradictory states: ${v1} vs ${v2}`,
              conflictingValues: [v1, v2],
              facts: [values[i].fact_id, values[j].fact_id]
            });
          }
        }
      }
    }
  }
  
  return conflicts;
}

/**
 * Verify cryptographic integrity of the TKG
 * Checks:
 * - All fact hashes are valid
 * - Hash chain is unbroken
 * - No hash collisions
 * - Registry matches actual state
 * 
 * @param {string} roomId
 * @returns {Promise<Object>} Verification result
 */
export async function verifyIntegrity(roomId) {
  const db = await getRoomDB(roomId);
  
  const result = {
    verified: true,
    factsChecked: 0,
    hashErrors: [],
    chainErrors: [],
    warnings: []
  };
  
  // Get all facts in chronological order
  const facts = await db.all(
    `SELECT * FROM facts 
     WHERE room_id = ?
     ORDER BY extracted_at ASC, fact_id ASC`,
    [roomId]
  );
  
  const seenHashes = new Set();
  let expectedPreviousHash = '0';
  
  for (const fact of facts) {
    result.factsChecked++;
    
    // Verify no hash collisions
    if (seenHashes.has(fact.verification_hash)) {
      result.hashErrors.push({
        type: 'HASH_COLLISION',
        factId: fact.fact_id,
        hash: fact.verification_hash
      });
      result.verified = false;
    }
    seenHashes.add(fact.verification_hash);
    
    // Verify previous_hash chain
    if (fact.previous_hash !== expectedPreviousHash) {
      // Check if this is a retraction (has different structure)
      if (!fact.is_retracted) {
        result.chainErrors.push({
          type: 'BROKEN_CHAIN',
          factId: fact.fact_id,
          expectedPrevious: expectedPreviousHash,
          actualPrevious: fact.previous_hash
        });
        result.verified = false;
      }
    }
    
    // Recalculate hash to verify
    const recalculated = calculateFactHash({
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      validFrom: fact.valid_from,
      validUntil: fact.valid_until,
      extractedBy: fact.extracted_by,
      extractedAt: fact.extracted_at,
      source: fact.source,
      confidence: fact.confidence,
      roomId: fact.room_id,
      previousHash: fact.previous_hash
    });
    
    if (recalculated !== fact.verification_hash) {
      result.hashErrors.push({
        type: 'INVALID_HASH',
        factId: fact.fact_id,
        expected: recalculated,
        actual: fact.verification_hash
      });
      result.verified = false;
    }
    
    expectedPreviousHash = fact.verification_hash;
  }
  
  // Verify registry matches
  const registry = await db.get(
    'SELECT last_hash FROM hash_registry WHERE room_id = ?',
    [roomId]
  );
  
  if (registry && registry.last_hash !== expectedPreviousHash) {
    result.chainErrors.push({
      type: 'REGISTRY_MISMATCH',
      expected: expectedPreviousHash,
      actual: registry.last_hash
    });
    result.verified = false;
  }
  
  // Summary
  result.summary = {
    totalFacts: result.factsChecked,
    hashErrors: result.hashErrors.length,
    chainErrors: result.chainErrors.length,
    warnings: result.warnings.length
  };
  
  return result;
}

/**
 * Export a complete snapshot of the knowledge graph at a specific time
 * Returns all facts valid at that moment
 * 
 * @param {string} roomId
 * @param {string} timestamp - ISO8601 (default: now)
 * @returns {Promise<Object>} Complete snapshot
 */
export async function exportSnapshot(roomId, timestamp = null) {
  const db = await getRoomDB(roomId);
  
  const snapTime = timestamp || new Date().toISOString();
  
  // Get all facts valid at the snapshot time
  const facts = await db.all(
    `SELECT * FROM facts 
     WHERE room_id = ?
       AND valid_from <= ?
       AND (valid_until IS NULL OR valid_until > ?)
       AND is_retracted = 0
     ORDER BY subject, predicate, valid_from DESC`,
    [roomId, snapTime, snapTime]
  );
  
  // Deduplicate (keep most recent for each subject/predicate)
  const seen = new Set();
  const uniqueFacts = [];
  
  for (const fact of facts) {
    const key = `${fact.subject}|${fact.predicate}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueFacts.push(rowToFact(fact));
    }
  }
  
  // Build snapshot
  const snapshot = {
    roomId,
    timestamp: snapTime,
    exportedAt: new Date().toISOString(),
    factCount: uniqueFacts.length,
    subjects: {},
    raw: uniqueFacts
  };
  
  // Group by subject
  for (const fact of uniqueFacts) {
    if (!snapshot.subjects[fact.subject]) {
      snapshot.subjects[fact.subject] = {};
    }
    snapshot.subjects[fact.subject][fact.predicate] = {
      value: fact.object,
      confidence: fact.confidence,
      source: fact.source,
      validFrom: fact.validFrom
    };
  }
  
  // Calculate integrity hash
  const snapshotHash = createHash('sha256')
    .update(JSON.stringify(uniqueFacts.map(f => f.factId).sort()))
    .digest('hex');
  
  snapshot.integrityHash = snapshotHash;
  
  return snapshot;
}

/**
 * Find facts that changed after a specific event (e.g., document added)
 * 
 * @param {string} roomId
 * @param {string} afterTimestamp - ISO8601
 * @param {Object} options - {subject?, predicate?}
 * @returns {Promise<Array>} Changed facts
 */
export async function findChangesAfter(roomId, afterTimestamp, options = {}) {
  const db = await getRoomDB(roomId);
  
  let sql = `
    SELECT * FROM facts 
    WHERE room_id = ?
      AND extracted_at > ?
  `;
  const params = [roomId, afterTimestamp];
  
  if (options.subject) {
    sql += ` AND subject = ?`;
    params.push(options.subject);
  }
  
  if (options.predicate) {
    sql += ` AND predicate = ?`;
    params.push(options.predicate);
  }
  
  sql += ` ORDER BY extracted_at ASC`;
  
  const rows = await db.all(sql, params);
  return rows.map(rowToFact);
}

/**
 * Query facts by pattern (flexible subject/predicate matching)
 * 
 * @param {string} roomId
 * @param {Object} patterns - {subject?, predicate?, object?, source?}
 * @param {Object} options - {limit?, offset?, timestamp?}
 * @returns {Promise<Array>} Matching facts
 */
export async function queryByPattern(roomId, patterns = {}, options = {}) {
  const db = await getRoomDB(roomId);
  
  const conditions = ['room_id = ?'];
  const params = [roomId];
  
  if (patterns.subject) {
    conditions.push('subject LIKE ?');
    params.push(`%${patterns.subject}%`);
  }
  
  if (patterns.predicate) {
    conditions.push('predicate LIKE ?');
    params.push(`%${patterns.predicate}%`);
  }
  
  if (patterns.object) {
    conditions.push('object LIKE ?');
    params.push(`%${JSON.stringify(patterns.object)}%`);
  }
  
  if (patterns.source) {
    conditions.push('source = ?');
    params.push(patterns.source);
  }
  
  // Temporal constraint
  const timestamp = options.timestamp || new Date().toISOString();
  conditions.push('valid_from <= ?');
  conditions.push('(valid_until IS NULL OR valid_until > ?)');
  conditions.push('is_retracted = 0');
  params.push(timestamp, timestamp);
  
  let sql = `SELECT * FROM facts WHERE ${conditions.join(' AND ')}`;
  sql += ` ORDER BY extracted_at DESC`;
  
  if (options.limit) {
    sql += ` LIMIT ?`;
    params.push(options.limit);
  }
  
  if (options.offset) {
    sql += ` OFFSET ?`;
    params.push(options.offset);
  }
  
  const rows = await db.all(sql, params);
  return rows.map(rowToFact);
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
 * Calculate hash for a fact (matching TKG implementation)
 * @param {Object} fact
 * @returns {string}
 */
function calculateFactHash(fact) {
  // Match the TKG implementation - object is already stringified in DB
  const canonical = {
    subject: fact.subject,
    predicate: fact.predicate,
    object: typeof fact.object === 'string' ? fact.object : JSON.stringify(fact.object),
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

// Export all functions
export default {
  initializeTKGQueries,
  findPath,
  getRelatedEntities,
  detectConflicts,
  verifyIntegrity,
  exportSnapshot,
  findChangesAfter,
  queryByPattern
};