/**
 * @module tkg-integration
 * @description Integration layer between Context Escrow and Temporal Knowledge Graph
 * 
 * Provides:
 * - Backward compatibility with JSONL-based context escrow
 * - Migration path from legacy rooms to TKG
 * - Unified API for fact storage (uses TKG for new rooms)
 * - TKG-aware query methods
 * 
 * @version 1.0.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { loadConfig } from '../config.mjs';
import * as tkg from './temporal-knowledge-graph.mjs';
import * as tkgQueries from './tkg-queries.mjs';

// Config and paths
let config = null;
let DEAL_ROOMS_DIR = 'memory/deal-rooms';

// Track which rooms use TKG vs legacy JSONL
const roomStorageMode = new Map();

/**
 * Storage mode for rooms
 */
export const StorageMode = {
  LEGACY_JSONL: 'legacy_jsonl',
  TKG: 'tkg',
  HYBRID: 'hybrid'  // Writing to both during migration
};

/**
 * Initialize TKG integration
 * @returns {Promise<void>}
 */
export async function initializeTKGIntegration() {
  config = loadConfig();
  
  const baseDir = config.memory?.baseDir || 'memory';
  DEAL_ROOMS_DIR = join(baseDir, 'deal-rooms');
  
  // Initialize TKG
  await tkg.initializeTKG();
  await tkgQueries.initializeTKGQueries();
  
  console.log(`[tkg-integration] Initialized`);
}

/**
 * Detect storage mode for a room
 * @param {string} roomId
 * @returns {Promise<string>} StorageMode value
 */
async function detectStorageMode(roomId) {
  if (roomStorageMode.has(roomId)) {
    return roomStorageMode.get(roomId);
  }
  
  const roomPath = join(DEAL_ROOMS_DIR, roomId);
  
  try {
    // Check for TKG directory
    const tkgDir = join(roomPath, 'tkg');
    const tkgExists = await fs.access(tkgDir).then(() => true).catch(() => false);
    
    if (tkgExists) {
      // Check if facts.db exists
      const dbPath = join(tkgDir, 'facts.db');
      const dbExists = await fs.access(dbPath).then(() => true).catch(() => false);
      
      if (dbExists) {
        roomStorageMode.set(roomId, StorageMode.TKG);
        return StorageMode.TKG;
      }
    }
    
    roomStorageMode.set(roomId, StorageMode.LEGACY_JSONL);
    return StorageMode.LEGACY_JSONL;
  } catch (err) {
    return StorageMode.LEGACY_JSONL;
  }
}

/**
 * Enable TKG for a room (idempotent)
 * Creates TKG structure and marks room for TKG storage
 * 
 * @param {string} roomId
 * @returns {Promise<boolean>} true if TKG was newly enabled
 */
export async function enableTKGForRoom(roomId) {
  // Ensure room directory exists - if not, it's ok (room might be new)
  const roomPath = join(DEAL_ROOMS_DIR, roomId);
  
  try {
    await fs.access(roomPath);
  } catch (err) {
    // Room doesn't exist in configured path, check test paths
    // This is needed for tests that create rooms outside standard structure
    console.log(`[tkg-integration] Room ${roomId} not in standard path, will create TKG structure in available location`);
  }
  
  // Create TKG structure
  const tkgDir = join(roomPath, 'tkg');
  await fs.mkdir(tkgDir, { recursive: true });
  await fs.mkdir(join(tkgDir, 'provenance'), { recursive: true });
  await fs.mkdir(join(tkgDir, 'indices'), { recursive: true });
  
  // Initialize database (will be created on first access)
  await tkg.getTKGStats(roomId).catch(() => ({}));
  
  roomStorageMode.set(roomId, StorageMode.TKG);
  
  console.log(`[tkg-integration] Enabled TKG for room ${roomId}`);
  return true;
}

/**
 * Unified fact escrow - uses TKG for TKG-enabled rooms, JSONL for legacy
 * 
 * @param {string} roomId
 * @param {Object} entry - Fact entry
 * @param {Object} accessPolicy
 * @param {string} agentId
 * @returns {Promise<Object>} Escrow result
 */
export async function escrowFactUnified(roomId, entry, accessPolicy, agentId) {
  const mode = await detectStorageMode(roomId);
  
  // Extract fact data from entry
  const { subject, predicate, object, provenance, timestamp } = entry;
  
  // Convert timestamp to validity period
  const validFrom = timestamp || new Date().toISOString();
  const validUntil = null; // Eternal by default in escrow
  
  // Convert provenance to TKG format
  const tkgProvenance = {
    extractedBy: provenance?.extractedBy || agentId,
    extractedAt: provenance?.extractedAt || validFrom,
    source: provenance?.source,
    confidence: provenance?.confidence || 1.0
  };
  
  if (mode === StorageMode.TKG || mode === StorageMode.HYBRID) {
    // Store in TKG
    const factId = await tkg.assertFact(
      roomId,
      subject,
      predicate,
      object,
      { validFrom, validUntil },
      tkgProvenance
    );
    
    // If hybrid mode, also write to JSONL (for migration safety)
    if (mode === StorageMode.HYBRID) {
      await writeToLegacyJSONL(roomId, entry, accessPolicy, agentId);
    }
    
    return {
      entryId: factId,
      roomId,
      storageMode: mode,
      timestamp: validFrom,
      status: 'VERIFIED'
    };
  } else {
    // Legacy JSONL mode
    return await writeToLegacyJSONL(roomId, entry, accessPolicy, agentId);
  }
}

/**
 * Write to legacy JSONL (for backward compatibility)
 * @param {string} roomId
 * @param {Object} entry
 * @param {Object} accessPolicy
 * @param {string} agentId
 * @returns {Promise<Object>}
 */
async function writeToLegacyJSONL(roomId, entry, accessPolicy, agentId) {
  const { promises: fs } = await import('fs');
  const { createHash } = await import('crypto');
  
  const contextPath = join(DEAL_ROOMS_DIR, roomId, 'context.kgt.jsonl');
  
  const fullEntry = {
    ...entry,
    _id: `${roomId}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    _escrowedBy: agentId,
    _escrowedAt: new Date().toISOString(),
    _accessPolicy: accessPolicy || { readableBy: null }
  };
  
  // Calculate verification hash
  const { verification, ...entryWithoutVerification } = fullEntry;
  const data = JSON.stringify(entryWithoutVerification);
  const hash = createHash('sha256').update(data).digest('hex');
  fullEntry.verification = `sha256:${hash}`;
  
  await fs.appendFile(contextPath, JSON.stringify(fullEntry) + '\n');
  
  return {
    entryId: fullEntry._id,
    roomId,
    verification: fullEntry.verification,
    timestamp: fullEntry.timestamp,
    status: 'VERIFIED',
    storageMode: StorageMode.LEGACY_JSONL
  };
}

/**
 * Unified query - queries both TKG and legacy JSONL
 * 
 * @param {string} roomId
 * @param {string} subject
 * @param {string} predicate
 * @param {Object} options
 * @returns {Promise<Array>}
 */
export async function queryFactsUnified(roomId, subject = null, predicate = null, options = {}) {
  const mode = await detectStorageMode(roomId);
  const results = [];
  
  // Query TKG if available
  if (mode === StorageMode.TKG || mode === StorageMode.HYBRID) {
    try {
      if (subject && predicate) {
        // Specific query
        const fact = await tkg.queryAtTime(
          roomId,
          subject,
          predicate,
          options.atTime || new Date().toISOString()
        );
        if (fact) {
          results.push(tkgToEscrowFormat(fact));
        }
      } else if (subject) {
        // Get all predicates for subject
        const history = await tkg.queryHistory(roomId, subject, predicate || '%');
        results.push(...history.map(tkgToEscrowFormat));
      } else {
        // Get all facts valid now
        const facts = await tkg.queryValidDuring(
          roomId,
          options.after || '1970-01-01T00:00:00Z',
          options.before || '9999-12-31T23:59:59Z',
          { limit: options.limit }
        );
        results.push(...facts.map(tkgToEscrowFormat));
      }
    } catch (err) {
      console.warn(`[tkg-integration] TKG query failed for ${roomId}:`, err.message);
    }
  }
  
  // Query legacy if needed
  if (mode === StorageMode.LEGACY_JSONL || mode === StorageMode.HYBRID || results.length === 0) {
    const legacyResults = await queryLegacyJSONL(roomId, subject, predicate, options);
    results.push(...legacyResults);
  }
  
  // Deduplicate by entry ID
  const seen = new Set();
  const unique = [];
  for (const r of results) {
    const key = r._id || r.factId;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }
  
  return unique.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Query legacy JSONL
 * @param {string} roomId
 * @param {string} subject
 * @param {string} predicate
 * @param {Object} options
 * @returns {Promise<Array>}
 */
async function queryLegacyJSONL(roomId, subject, predicate, options) {
  const { promises: fs } = await import('fs');
  const contextPath = join(DEAL_ROOMS_DIR, roomId, 'context.kgt.jsonl');
  
  let content;
  try {
    content = await fs.readFile(contextPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
  
  const lines = content.trim().split('\n').filter(l => l);
  const entries = [];
  const now = new Date();
  
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      
      if (entry.type !== 'fact') {
        continue;
      }
      
      // Check redaction
      if (!options.includeRedacted && entry._accessPolicy?.redactAfter) {
        if (now > new Date(entry._accessPolicy.redactAfter)) {
          continue;
        }
      }
      
      // Apply filters
      if (subject && entry.subject !== subject) {
        continue;
      }
      
      if (predicate && entry.predicate !== predicate) {
        continue;
      }
      
      if (options.after && new Date(entry.timestamp) <= new Date(options.after)) {
        continue;
      }
      
      if (options.before && new Date(entry.timestamp) >= new Date(options.before)) {
        continue;
      }
      
      entries.push(entry);
    } catch {
      // Skip malformed
    }
  }
  
  return entries;
}

/**
 * Convert TKG fact to escrow format
 * @param {Object} fact
 * @returns {Object}
 */
function tkgToEscrowFormat(fact) {
  return {
    _id: fact.factId,
    type: 'fact',
    subject: fact.subject,
    predicate: fact.predicate,
    object: fact.object,
    timestamp: fact.validFrom,
    provenance: {
      source: fact.source,
      extractedBy: fact.extractedBy,
      extractedAt: fact.extractedAt,
      confidence: fact.confidence
    },
    verification: `sha256:${fact.verificationHash}`,
    _tkgData: {
      validUntil: fact.validUntil,
      isRetracted: fact.isRetracted,
      retractedAt: fact.retractedAt
    }
  };
}

/**
 * Migrate a legacy room to TKG
 * Reads all facts from JSONL and imports to TKG
 * 
 * @param {string} roomId
 * @param {Object} options - {preserveOriginal?, dryRun?}
 * @returns {Promise<Object>} Migration result
 */
export async function migrateRoomToTKG(roomId, options = {}) {
  const dryRun = options.dryRun || false;
  const preserveOriginal = options.preserveOriginal !== false;
  
  const mode = await detectStorageMode(roomId);
  
  if (mode === StorageMode.TKG) {
    return {
      roomId,
      status: 'ALREADY_TKG',
      factsMigrated: 0
    };
  }
  
  // Read all legacy facts
  const legacyFacts = await queryLegacyJSONL(roomId, null, null, { includeRedacted: true });
  
  if (dryRun) {
    return {
      roomId,
      status: 'DRY_RUN',
      wouldMigrate: legacyFacts.length,
      facts: legacyFacts.slice(0, 5) // Sample
    };
  }
  
  // Enable TKG
  await enableTKGForRoom(roomId);
  
  // Import facts
  let migrated = 0;
  let errors = [];
  
  for (const entry of legacyFacts) {
    try {
      const provenance = {
        extractedBy: entry.provenance?.extractedBy || entry._escrowedBy || 'unknown',
        extractedAt: entry.provenance?.extractedAt || entry._escrowedAt || entry.timestamp,
        source: entry.provenance?.source,
        confidence: entry.provenance?.confidence || 1.0
      };
      
      await tkg.assertFact(
        roomId,
        entry.subject,
        entry.predicate,
        entry.object,
        { 
          validFrom: entry.timestamp,
          validUntil: entry._tkgData?.validUntil || null
        },
        provenance
      );
      
      migrated++;
    } catch (err) {
      errors.push({
        entryId: entry._id,
        error: err.message
      });
    }
  }
  
  // If not preserving original, rename JSONL
  if (!preserveOriginal) {
    const jsonlPath = join(DEAL_ROOMS_DIR, roomId, 'context.kgt.jsonl');
    const backupPath = join(DEAL_ROOMS_DIR, roomId, 'context.kgt.jsonl.backup');
    await fs.rename(jsonlPath, backupPath);
  }
  
  // Set room to TKG mode
  roomStorageMode.set(roomId, StorageMode.TKG);
  
  return {
    roomId,
    status: 'MIGRATED',
    factsMigrated: migrated,
    errors: errors.length > 0 ? errors : undefined,
    originalPreserved: preserveOriginal
  };
}

/**
 * Get TKG-enhanced stats for a room
 * Includes both TKG and legacy stats
 * 
 * @param {string} roomId
 * @returns {Promise<Object>}
 */
export async function getUnifiedStats(roomId) {
  const mode = await detectStorageMode(roomId);
  
  const stats = {
    roomId,
    storageMode: mode,
    tkg: null,
    legacy: null
  };
  
  if (mode === StorageMode.TKG || mode === StorageMode.HYBRID) {
    try {
      stats.tkg = await tkg.getTKGStats(roomId);
    } catch (err) {
      stats.tkg = { error: err.message };
    }
  }
  
  if (mode === StorageMode.LEGACY_JSONL || mode === StorageMode.HYBRID) {
    try {
      const legacyFacts = await queryLegacyJSONL(roomId, null, null, {});
      const subjects = new Set(legacyFacts.map(f => f.subject));
      const predicates = new Set(legacyFacts.map(f => f.predicate));
      
      stats.legacy = {
        totalFacts: legacyFacts.length,
        uniqueSubjects: subjects.size,
        uniquePredicates: predicates.size
      };
    } catch (err) {
      stats.legacy = { error: err.message };
    }
  }
  
  return stats;
}

/**
 * Batch migrate multiple rooms
 * @param {Array<string>} roomIds
 * @param {Object} options
 * @returns {Promise<Array>} Results for each room
 */
export async function batchMigrateRooms(roomIds, options = {}) {
  const results = [];
  
  for (const roomId of roomIds) {
    try {
      const result = await migrateRoomToTKG(roomId, options);
      results.push(result);
    } catch (err) {
      results.push({
        roomId,
        status: 'ERROR',
        error: err.message
      });
    }
  }
  
  return results;
}

// Re-export TKG and TKG-Queries functions for unified access
export { tkg, tkgQueries };

// Export all integration functions
export default {
  initializeTKGIntegration,
  enableTKGForRoom,
  escrowFactUnified,
  queryFactsUnified,
  migrateRoomToTKG,
  batchMigrateRooms,
  getUnifiedStats,
  StorageMode,
  tkg,
  tkgQueries
};