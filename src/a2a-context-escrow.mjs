/**
 * @module a2a-context-escrow
 * @description Session Continuity for A2A Integration
 * 
 * Bridges A2A sessions with mesh-memory Deal Rooms:
 * - Context ID mapping to Deal Rooms
 * - Automatic briefing injection
 * - Session persistence via TKG
 * 
 * @version 1.0.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID, createHash } from 'crypto';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { loadConfig } from '../config.mjs';
import { 
  createRoom, 
  getRoom, 
  RoomState, 
  ParticipantRole 
} from './deal-room.mjs';
import { 
  queryValidDuring,
  assertFact 
} from './temporal-knowledge-graph.mjs';

// Config and paths
let config = null;
let ESCROW_DIR = 'memory/a2a-escrow';

// SQLite database handle
let db = null;

// In-memory context cache
const contextCache = new Map();

// Event listeners
const contextListeners = new Set();

/**
 * Context escrow configuration
 */
export const EscrowConfig = {
  DEFAULT_BRIEFING_LENGTH: 10,  // Number of messages in briefing
  CONTEXT_TTL_HOURS: 24,        // Context expires after 24h of inactivity
  AUTO_CLOSE_HOURS: 168         // Auto-close after 7 days
};

/**
 * Initialize the context escrow system
 * @returns {Promise<void>}
 */
export async function initializeContextEscrow() {
  config = loadConfig();
  
  const baseDir = config.memory?.baseDir || 'memory';
  ESCROW_DIR = join(baseDir, 'a2a-escrow');
  
  // Ensure directory exists
  await fs.mkdir(ESCROW_DIR, { recursive: true });
  
  // Initialize database
  const dbPath = join(ESCROW_DIR, 'context-escrow.db');
  db = new sqlite3.Database(dbPath);
  
  // Promisify database methods
  db.run = promisify(db.run.bind(db));
  db.get = promisify(db.get.bind(db));
  db.all = promisify(db.all.bind(db));
  
  // Create tables
  await initializeSchema();
  
  console.log('[a2a-context-escrow] Initialized');
}

/**
 * Initialize SQLite schema
 */
async function initializeSchema() {
  // Context to room mapping
  await db.run(`
    CREATE TABLE IF NOT EXISTS context_mappings (
      context_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      peer_name TEXT NOT NULL,
      agent_session TEXT,
      created_at TEXT NOT NULL,
      last_activity TEXT NOT NULL,
      message_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active'
    )
  `);
  
  // Context message history for briefing
  await db.run(`
    CREATE TABLE IF NOT EXISTS context_messages (
      message_id INTEGER PRIMARY KEY AUTOINCREMENT,
      context_id TEXT NOT NULL,
      direction TEXT NOT NULL,  -- 'outbound' or 'inbound'
      sender TEXT,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      metadata TEXT
    )
  `);
  
  // Indexes
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_context_room ON context_mappings(room_id)
  `);
  
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_context_peer ON context_mappings(peer_name)
  `);
  
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_context ON context_messages(context_id)
  `);
  
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_time ON context_messages(timestamp)
  `);
}

/**
 * Generate a context ID
 * @returns {string} Context ID
 */
export function generateContextId() {
  const uuid = randomUUID().replace(/-/g, '').slice(0, 16);
  return `ctx_${uuid}`;
}

/**
 * Get or create a context (Deal Room)
 * 
 * @param {string} contextId - A2A context ID
 * @param {Object} options - Options
 * @param {string} options.peerName - Peer name
 * @param {string} options.purpose - Room purpose
 * @returns {Promise<Object>} Room info
 */
export async function getOrCreateContext(contextId, options = {}) {
  const { peerName = 'unknown', purpose = 'A2A Session' } = options;
  
  // Check cache first
  if (contextCache.has(contextId)) {
    const cached = contextCache.get(contextId);
    cached.isNew = false;
    return cached;
  }
  
  // Check database
  const mapping = await db.get(
    `SELECT * FROM context_mappings WHERE context_id = ? AND status = 'active'`,
    [contextId]
  );
  
  if (mapping) {
    // Update last activity
    const now = new Date().toISOString();
    await db.run(
      `UPDATE context_mappings SET last_activity = ? WHERE context_id = ?`,
      [now, contextId]
    );
    
    // Get room
    const room = await getRoom(mapping.room_id);
    const result = {
      contextId,
      roomId: mapping.room_id,
      room,
      peerName: mapping.peer_name,
      messageCount: mapping.message_count,
      isNew: false
    };
    
    contextCache.set(contextId, result);
    return result;
  }
  
  // Create new ephemeral Deal Room
  const roomPurpose = `${purpose} [A2A Context: ${contextId}]`;
  const scope = {
    topics: ['a2a-session', 'agent-communication'],
    maxParticipants: 2
  };
  const policy = {
    autoClose: null,  // Managed by escrow
    consensusRequired: 'majority',
    retentionDays: 30
  };
  const participants = [
    { agentId: 'self', role: ParticipantRole.NEGOTIATOR },
    { agentId: peerName, role: ParticipantRole.NEGOTIATOR }
  ];
  
  const roomResult = await createRoom(roomPurpose, scope, policy, participants, 'a2a-context-escrow');
  const roomId = roomResult.roomId;
  
  // Store mapping
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO context_mappings 
     (context_id, room_id, peer_name, created_at, last_activity, message_count, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [contextId, roomId, peerName, now, now, 0, 'active']
  );
  
  const result = {
    contextId,
    roomId,
    room: roomResult.manifest,
    peerName,
    messageCount: 0,
    isNew: true
  };
  
  contextCache.set(contextId, result);
  
  notifyContextChange(contextId, 'created', { roomId, peerName });
  
  console.log(`[a2a-context-escrow] Created context ${contextId} → room ${roomId}`);
  return result;
}

/**
 * Inject briefing into message
 * 
 * @param {string} contextId - A2A context ID
 * @param {Object} agentSession - Agent session info
 * @param {Object} options - Options
 * @param {number} options.messageCount - Number of messages to include
 * @returns {Promise<string>} Briefing string
 */
export async function injectBriefing(contextId, agentSession, options = {}) {
  const { messageCount = EscrowConfig.DEFAULT_BRIEFING_LENGTH } = options;
  
  // Get recent messages
  const messages = await db.all(
    `SELECT * FROM context_messages 
     WHERE context_id = ?
     ORDER BY timestamp DESC
     LIMIT ?`,
    [contextId, messageCount]
  );
  
  if (messages.length === 0) {
    return '';  // No context yet
  }
  
  // Reverse to get chronological order
  messages.reverse();
  
  // Format briefing
  const lines = ['=== A2A Session Context ===', ''];
  
  for (const msg of messages) {
    const direction = msg.direction === 'outbound' ? '→' : '←';
    const sender = msg.sender || 'unknown';
    const time = new Date(msg.timestamp).toLocaleTimeString();
    lines.push(`[${time}] ${direction} ${sender}: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`);
  }
  
  lines.push('', '=== Current Message ===', '');
  
  return lines.join('\n');
}

/**
 * Store a message in context history
 * 
 * @param {string} contextId - A2A context ID
 * @param {string} direction - 'outbound' or 'inbound'
 * @param {string} sender - Sender identifier
 * @param {string} content - Message content
 * @param {Object} metadata - Optional metadata
 */
export async function storeMessage(contextId, direction, sender, content, metadata = {}) {
  const now = new Date().toISOString();
  
  // Store in database
  await db.run(
    `INSERT INTO context_messages 
     (context_id, direction, sender, content, timestamp, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [contextId, direction, sender, content, now, JSON.stringify(metadata)]
  );
  
  // Update message count
  await db.run(
    `UPDATE context_mappings 
     SET message_count = message_count + 1, last_activity = ?
     WHERE context_id = ?`,
    [now, contextId]
  );
  
  // Also store in TKG for temporal queries
  const context = await db.get(
    `SELECT room_id FROM context_mappings WHERE context_id = ?`,
    [contextId]
  );
  
  if (context) {
    try {
      await assertFact(
        context.room_id,
        `a2a:${contextId}`,
        direction === 'outbound' ? 'sent_message' : 'received_message',
        {
          sender,
          content: content.substring(0, 500),  // Truncate for storage
          timestamp: now
        },
        { validFrom: now, validUntil: null },
        { extractedBy: 'a2a-context-escrow', extractedAt: now, source: 'a2a' }
      );
    } catch (err) {
      // Don't fail if TKG storage fails
      console.warn('[a2a-context-escrow] TKG store failed:', err.message);
    }
  }
}

/**
 * Auto-context send - manages context ID and stores message
 * 
 * @param {string} peer - Peer name
 * @param {Object} message - Message object
 * @param {Object} agentSession - Agent session info
 * @param {Object} options - Send options
 * @returns {Promise<Object>} Result with contextId and briefing
 */
export async function autoContextSend(peer, message, agentSession, options = {}) {
  // Get existing context or create new
  let contextId = options.contextId;
  
  if (!contextId) {
    // Try to find existing context for this peer
    const existing = await db.get(
      `SELECT context_id FROM context_mappings 
       WHERE peer_name = ? AND status = 'active'
       ORDER BY last_activity DESC
       LIMIT 1`,
      [peer]
    );
    
    if (existing) {
      contextId = existing.context_id;
    } else {
      contextId = generateContextId();
    }
  }
  
  // Get or create context
  const context = await getOrCreateContext(contextId, { peerName: peer });
  
  // Generate briefing
  const briefing = await injectBriefing(contextId, agentSession);
  
  // Store outgoing message
  const content = typeof message === 'string' ? message : JSON.stringify(message);
  await storeMessage(contextId, 'outbound', 'self', content);
  
  return {
    contextId,
    roomId: context.roomId,
    briefing,
    messageCount: context.messageCount + 1,
    isNew: context.isNew
  };
}

/**
 * Process received message with context
 * 
 * @param {string} contextId - A2A context ID
 * @param {string} peer - Peer name
 * @param {Object} message - Received message
 * @returns {Promise<Object>} Context info
 */
export async function receiveWithContext(contextId, peer, message) {
  // Get or create context
  const context = await getOrCreateContext(contextId, { peerName: peer });
  
  // Store incoming message
  const content = typeof message === 'string' ? message : JSON.stringify(message);
  await storeMessage(contextId, 'inbound', peer, content);
  
  return {
    contextId,
    roomId: context.roomId,
    messageCount: context.messageCount + 1
  };
}

/**
 * Get thread history for a context
 * 
 * @param {string} contextId - A2A context ID
 * @param {Object} options - Query options
 * @param {number} options.limit - Max messages to return
 * @param {string} options.before - Get messages before this timestamp
 * @returns {Promise<Array>} Message history
 */
export async function getThreadHistory(contextId, options = {}) {
  const { limit = 100, before } = options;
  
  let query = `SELECT * FROM context_messages WHERE context_id = ?`;
  const params = [contextId];
  
  if (before) {
    query += ` AND timestamp < ?`;
    params.push(before);
  }
  
  query += ` ORDER BY timestamp DESC LIMIT ?`;
  params.push(limit);
  
  const rows = await db.all(query, params);
  
  return rows.map(row => ({
    messageId: row.message_id,
    direction: row.direction,
    sender: row.sender,
    content: row.content,
    timestamp: row.timestamp,
    metadata: row.metadata ? JSON.parse(row.metadata) : null
  })).reverse();  // Return in chronological order
}

/**
 * Close a context (mark as inactive)
 * 
 * @param {string} contextId - A2A context ID
 * @param {string} reason - Reason for closure
 * @returns {Promise<boolean>} Success
 */
export async function closeContext(contextId, reason = 'manual') {
  const context = await db.get(
    `SELECT * FROM context_mappings WHERE context_id = ?`,
    [contextId]
  );
  
  if (!context) {
    return false;
  }
  
  const now = new Date().toISOString();
  
  await db.run(
    `UPDATE context_mappings SET status = ?, last_activity = ? WHERE context_id = ?`,
    ['closed', now, contextId]
  );
  
  // Remove from cache
  contextCache.delete(contextId);
  
  notifyContextChange(contextId, 'closed', { reason, roomId: context.room_id });
  
  console.log(`[a2a-context-escrow] Closed context ${contextId}: ${reason}`);
  return true;
}

/**
 * Expire old contexts (cleanup)
 * 
 * @param {number} maxInactiveHours - Hours of inactivity before expiry
 * @returns {Promise<number>} Number expired
 */
export async function expireOldContexts(maxInactiveHours = EscrowConfig.CONTEXT_TTL_HOURS) {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - maxInactiveHours);
  const cutoffStr = cutoff.toISOString();
  
  const result = await db.run(
    `UPDATE context_mappings 
     SET status = 'expired' 
     WHERE status = 'active' AND last_activity < ?`,
    [cutoffStr]
  );
  
  const expired = result.changes || 0;
  
  if (expired > 0) {
    console.log(`[a2a-context-escrow] Expired ${expired} inactive contexts`);
    
    // Notify listeners
    notifyContextChange('system', 'expired', { count: expired });
  }
  
  return expired;
}

/**
 * List active contexts
 * 
 * @param {Object} options - Filter options
 * @param {string} options.peer - Filter by peer
 * @param {number} options.limit - Max results
 * @returns {Promise<Array>} Active contexts
 */
export async function listActiveContexts(options = {}) {
  const { peer, limit = 100 } = options;
  
  let query = `SELECT * FROM context_mappings WHERE status = 'active'`;
  const params = [];
  
  if (peer) {
    query += ` AND peer_name = ?`;
    params.push(peer);
  }
  
  query += ` ORDER BY last_activity DESC LIMIT ?`;
  params.push(limit);
  
  const rows = await db.all(query, params);
  
  return rows.map(row => ({
    contextId: row.context_id,
    roomId: row.room_id,
    peerName: row.peer_name,
    messageCount: row.message_count,
    createdAt: row.created_at,
    lastActivity: row.last_activity
  }));
}

/**
 * Get context statistics
 * @returns {Promise<Object>} Stats
 */
export async function getEscrowStats() {
  const contextStats = await db.get(`
    SELECT 
      COUNT(*) as total_contexts,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_contexts,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_contexts,
      SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired_contexts
    FROM context_mappings
  `);
  
  const messageStats = await db.get(`
    SELECT COUNT(*) as total_messages FROM context_messages
  `);
  
  return {
    contexts: contextStats,
    messages: messageStats.total_messages
  };
}

/**
 * Subscribe to context lifecycle events
 * @param {Function} listener
 * @returns {Function} Unsubscribe function
 */
export function onContextChange(listener) {
  contextListeners.add(listener);
  return () => contextListeners.delete(listener);
}

/**
 * Notify context listeners
 * @param {string} contextId
 * @param {string} event
 * @param {Object} details
 */
function notifyContextChange(contextId, event, details = {}) {
  for (const listener of contextListeners) {
    try {
      listener(contextId, event, details);
    } catch (err) {
      console.error('[a2a-context-escrow] Context listener error:', err);
    }
  }
}

/**
 * Close database connection
 */
export async function closeContextEscrow() {
  // Clear cache
  contextCache.clear();
  
  if (db) {
    await new Promise((resolve) => db.close(resolve));
    db = null;
  }
}

// Export all functions
export default {
  initializeContextEscrow,
  getOrCreateContext,
  injectBriefing,
  storeMessage,
  autoContextSend,
  receiveWithContext,
  getThreadHistory,
  closeContext,
  expireOldContexts,
  listActiveContexts,
  generateContextId,
  getEscrowStats,
  onContextChange,
  closeContextEscrow,
  EscrowConfig
};
