/**
 * @module context-escrow
 * @description Context Escrow (Shared-Pool Write) for Mesh Memory Protocol v2.0
 * 
 * CRITICAL RULE: type: "fact" ONLY. Interpretations are rejected at protocol layer.
 * This prevents bias laundering by ensuring only verifiable facts enter shared context.
 * 
 * Entry schema:
 * {
 *   type: "fact",
 *   subject: "entity identifier",
 *   predicate: "relationship/attribute",
 *   object: "value",
 *   timestamp: "ISO8601",
 *   provenance: {
 *     source: "where this came from",
 *     extractedBy: "agent that extracted it",
 *     extractedAt: "ISO8601",
 *     confidence: 0.0-1.0
 *   },
 *   verification: "sha256:abc123..."
 * }
 * 
 * Temporal knowledge graph stored as JSONL for append-only semantics.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { loadConfig } from '../config.mjs';

// Config and paths
let config = null;
let DEAL_ROOMS_DIR = 'memory/deal-rooms';

// Entry types - ONLY fact is allowed for escrow
export const EntryType = {
  FACT: 'fact'
};

// Verification status
export const VerificationStatus = {
  VERIFIED: 'verified',
  PENDING: 'pending',
  FAILED: 'failed'
};

/**
 * Initialize context escrow system
 * @returns {Promise<void>}
 */
export async function initializeContextEscrow() {
  config = loadConfig();
  
  const baseDir = config.memory?.baseDir || 'memory';
  DEAL_ROOMS_DIR = join(baseDir, 'deal-rooms');
  
  console.log(`[context-escrow] Initialized`);
}

/**
 * Get the path to a room's context file
 * @param {string} roomId
 * @returns {string} Full path to context.kgt.jsonl
 */
function getContextPath(roomId) {
  return join(DEAL_ROOMS_DIR, roomId, 'context.kgt.jsonl');
}

/**
 * Calculate SHA-256 hash of an entry (for verification)
 * @param {Object} entry
 * @returns {string} SHA-256 hex hash
 */
function calculateEntryHash(entry) {
  // Exclude verification field from hash calculation
  const { verification, ...entryWithoutVerification } = entry;
  const data = JSON.stringify(entryWithoutVerification);
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Validate that an entry is a fact (not interpretation)
 * @param {Object} entry
 * @returns {Object} Validation result
 */
function validateFactEntry(entry) {
  // CRITICAL: Only facts allowed
  if (entry.type !== 'fact') {
    return {
      valid: false,
      error: `Entry type "${entry.type}" is not allowed. Only type: "fact" is permitted in context escrow. Interpretations and opinions must be handled through consensus decisions.`
    };
  }
  
  // Required fields
  if (!entry.subject || typeof entry.subject !== 'string') {
    return {
      valid: false,
      error: 'Missing or invalid subject: must be a non-empty string identifying the entity'
    };
  }
  
  if (!entry.predicate || typeof entry.predicate !== 'string') {
    return {
      valid: false,
      error: 'Missing or invalid predicate: must be a non-empty string describing the relationship'
    };
  }
  
  if (entry.object === undefined) {
    return {
      valid: false,
      error: 'Missing object: must have a value (can be null, boolean, string, number, or array)'
    };
  }
  
  // Provenance validation
  if (!entry.provenance || typeof entry.provenance !== 'object') {
    return {
      valid: false,
      error: 'Missing provenance: must include source, extractedBy, extractedAt, and confidence'
    };
  }
  
  const { provenance } = entry;
  
  if (!provenance.source || typeof provenance.source !== 'string') {
    return {
      valid: false,
      error: 'Invalid provenance.source: must indicate where the fact originated'
    };
  }
  
  if (!provenance.extractedBy || typeof provenance.extractedBy !== 'string') {
    return {
      valid: false,
      error: 'Invalid provenance.extractedBy: must identify the agent that extracted this fact'
    };
  }
  
  if (!provenance.extractedAt || typeof provenance.extractedAt !== 'string') {
    return {
      valid: false,
      error: 'Invalid provenance.extractedAt: must be ISO8601 timestamp'
    };
  }
  
  if (typeof provenance.confidence !== 'number' || provenance.confidence < 0 || provenance.confidence > 1) {
    return {
      valid: false,
      error: 'Invalid provenance.confidence: must be a number between 0.0 and 1.0'
    };
  }
  
  // Check for interpretation markers in content
  const contentStr = JSON.stringify(entry).toLowerCase();
  const interpretationMarkers = [
    'i think', 'i believe', 'in my opinion', 'seems like', 'appears to be',
    'probably', 'likely', 'maybe', 'perhaps', 'possibly',
    'we should', 'recommend', 'suggest', 'advice', 'better to',
    'important', 'critical', 'essential', 'necessary',
    'good', 'bad', 'best', 'worst', 'better', 'worse'
  ];
  
  const foundMarkers = interpretationMarkers.filter(marker => contentStr.includes(marker));
  if (foundMarkers.length > 0) {
    return {
      valid: false,
      error: `Entry contains interpretation markers: [${foundMarkers.join(', ')}]. Facts must be objective statements without evaluative language.`,
      markers: foundMarkers
    };
  }
  
  return { valid: true };
}

/**
 * Escrow a fact entry to the shared pool
 * CRITICAL: Only type: "fact" entries are accepted
 * 
 * @param {string} roomId - Room ID
 * @param {Object} entry - Fact entry
 * @param {Object} accessPolicy - {readableBy: string[], redactAfter: ISO8601}
 * @param {string} agentId - Agent writing the entry
 * @returns {Promise<Object>} Escrowed entry with verification
 */
export async function escrowFact(roomId, entry, accessPolicy, agentId) {
  // Ensure room exists
  const roomPath = join(DEAL_ROOMS_DIR, roomId);
  try {
    await fs.access(roomPath);
  } catch (err) {
    throw new Error(`Room not found: ${roomId}`);
  }
  
  // Validate entry is a fact
  const validation = validateFactEntry(entry);
  if (!validation.valid) {
    const error = new Error(validation.error);
    error.code = 'INVALID_ENTRY_TYPE';
    if (validation.markers) {
      error.markers = validation.markers;
    }
    throw error;
  }
  
  // Add timestamp if not present
  const timestamp = entry.timestamp || new Date().toISOString();
  
  // Build complete entry
  const fullEntry = {
    ...entry,
    _id: `${roomId}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    timestamp,
    _escrowedBy: agentId,
    _escrowedAt: new Date().toISOString(),
    _accessPolicy: accessPolicy || { readableBy: null }  // null = all participants
  };
  
  // Calculate verification hash
  fullEntry.verification = `sha256:${calculateEntryHash(fullEntry)}`;
  
  // Verify the hash (self-check)
  const calculatedHash = calculateEntryHash(fullEntry);
  if (fullEntry.verification !== `sha256:${calculatedHash}`) {
    throw new Error('Verification hash calculation failed');
  }
  
  // Append to context file (JSONL - append only)
  const contextPath = getContextPath(roomId);
  const line = JSON.stringify(fullEntry) + '\n';
  await fs.appendFile(contextPath, line);
  
  console.log(`[context-escrow] Escrowed fact for room ${roomId}: ${entry.subject} ${entry.predicate} ${JSON.stringify(entry.object).slice(0, 50)}`);
  
  return {
    entryId: fullEntry._id,
    roomId,
    verification: fullEntry.verification,
    timestamp: fullEntry.timestamp,
    status: VerificationStatus.VERIFIED
  };
}

/**
 * Query facts from the escrow
 * @param {string} roomId - Room ID
 * @param {string} subject - Subject to query (optional, null for all)
 * @param {string} predicate - Predicate to query (optional)
 * @param {Object} options - {after, before, limit, includeRedacted}
 * @returns {Promise<Array>} Matching facts
 */
export async function queryFacts(roomId, subject = null, predicate = null, options = {}) {
  const contextPath = getContextPath(roomId);
  
  let content;
  try {
    content = await fs.readFile(contextPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];  // No context file yet
    }
    throw err;
  }
  
  const lines = content.trim().split('\n').filter(l => l);
  const entries = [];
  const now = new Date();
  
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      
      // Skip non-fact entries (shouldn't happen, but defensive)
      if (entry.type !== 'fact') {
        continue;
      }
      
      // Check redaction policy
      if (!options.includeRedacted && entry._accessPolicy?.redactAfter) {
        const redactTime = new Date(entry._accessPolicy.redactAfter);
        if (now > redactTime) {
          continue;  // Redacted
        }
      }
      
      // Apply filters
      if (subject !== null && entry.subject !== subject) {
        continue;
      }
      
      if (predicate !== null && entry.predicate !== predicate) {
        continue;
      }
      
      // Temporal filters
      if (options.after && new Date(entry.timestamp) <= new Date(options.after)) {
        continue;
      }
      
      if (options.before && new Date(entry.timestamp) >= new Date(options.before)) {
        continue;
      }
      
      entries.push(entry);
    } catch (err) {
      // Skip malformed entries
    }
  }
  
  // Sort by timestamp (temporal ordering)
  entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  // Apply limit
  if (options.limit && options.limit > 0) {
    return entries.slice(-options.limit);  // Most recent N
  }
  
  return entries;
}

/**
 * Get facts about a specific subject (temporal knowledge graph traversal)
 * @param {string} roomId
 * @param {string} subject
 * @param {Object} options
 * @returns {Promise<Object>} Subject knowledge graph
 */
export async function getSubjectKnowledgeGraph(roomId, subject, options = {}) {
  const facts = await queryFacts(roomId, subject, null, options);
  
  // Group by predicate
  const predicates = {};
  for (const fact of facts) {
    if (!predicates[fact.predicate]) {
      predicates[fact.predicate] = [];
    }
    predicates[fact.predicate].push({
      object: fact.object,
      timestamp: fact.timestamp,
      provenance: fact.provenance,
      confidence: fact.provenance?.confidence,
      verification: fact.verification
    });
  }
  
  return {
    subject,
    factCount: facts.length,
    predicates,
    temporal: facts.map(f => ({
      predicate: f.predicate,
      object: f.object,
      timestamp: f.timestamp,
      confidence: f.provenance?.confidence
    }))
  };
}

/**
 * Verify entry integrity
 * @param {Object} entry
 * @returns {boolean} Whether verification hash matches
 */
export function verifyEntryIntegrity(entry) {
  if (!entry.verification || !entry.verification.startsWith('sha256:')) {
    return false;
  }
  
  const expectedHash = calculateEntryHash(entry);
  return entry.verification === `sha256:${expectedHash}`;
}

/**
 * Get all facts in a room (for export/backup)
 * @param {string} roomId
 * @returns {Promise<Array>} All facts
 */
export async function getAllFacts(roomId) {
  const contextPath = getContextPath(roomId);
  
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
  
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'fact') {
        entries.push(entry);
      }
    } catch (err) {
      // Skip malformed
    }
  }
  
  return entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Get escrow statistics
 * @param {string} roomId
 * @returns {Promise<Object>} Stats
 */
export async function getEscrowStats(roomId) {
  const facts = await getAllFacts(roomId);
  
  const subjects = new Set();
  const predicates = new Set();
  const sources = new Set();
  let verifiedCount = 0;
  
  for (const fact of facts) {
    subjects.add(fact.subject);
    predicates.add(fact.predicate);
    sources.add(fact.provenance?.source);
    
    if (verifyEntryIntegrity(fact)) {
      verifiedCount++;
    }
  }
  
  return {
    totalFacts: facts.length,
    uniqueSubjects: subjects.size,
    uniquePredicates: predicates.size,
    uniqueSources: sources.size,
    verifiedFacts: verifiedCount,
    integrity: facts.length > 0 ? verifiedCount / facts.length : 1.0,
    timeRange: facts.length > 0 ? {
      first: facts[0]?.timestamp,
      last: facts[facts.length - 1]?.timestamp
    } : null
  };
}

/**
 * Export facts to JSON (for integration with other systems)
 * @param {string} roomId
 * @param {Object} options - {format: 'n-quads' | 'json-ld' | 'raw'}
 * @returns {Promise<Object>} Exported data
 */
export async function exportFacts(roomId, options = {}) {
  const facts = await getAllFacts(roomId);
  const format = options.format || 'raw';
  
  if (format === 'raw') {
    return {
      roomId,
      exportedAt: new Date().toISOString(),
      count: facts.length,
      facts
    };
  }
  
  if (format === 'n-quads') {
    // Simple N-Quads format for RDF compatibility
    const quads = facts.map(f => {
      const subject = `<${f.subject}>`;
      const predicate = `<${f.predicate}>`;
      const object = typeof f.object === 'string' 
        ? `"${f.object.replace(/"/g, '\\"')}"`
        : `"${JSON.stringify(f.object)}"^^<http://www.w3.org/2001/XMLSchema#string>`;
      const graph = `<${roomId}>`;
      return `${subject} ${predicate} ${object} ${graph} .`;
    });
    
    return {
      roomId,
      exportedAt: new Date().toISOString(),
      format: 'n-quads',
      count: quads.length,
      data: quads.join('\n')
    };
  }
  
  throw new Error(`Unsupported export format: ${format}`);
}

// Export all functions
export default {
  initializeContextEscrow,
  escrowFact,
  queryFacts,
  getSubjectKnowledgeGraph,
  verifyEntryIntegrity,
  getAllFacts,
  getEscrowStats,
  exportFacts,
  EntryType,
  VerificationStatus
};
