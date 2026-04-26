/**
 * @module a2a-reliability-layer
 * @description Delivery Guarantees for A2A Integration
 * 
 * Provides at-least-once delivery with:
 * - WAL (Write-Ahead Log) queue persistence
 * - Exponential backoff with jitter
 * - Circuit breaker pattern
 * - Dead letter queue for failed messages
 * 
 * @version 1.0.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID, createHash } from 'crypto';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { loadConfig } from '../config.mjs';

// Config and paths
let config = null;
let QUEUE_DIR = 'memory/a2a-queue';

// SQLite database handle
let db = null;

// Circuit breaker states
export const CircuitState = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half-open'
};

// Delivery status enum
export const DeliveryStatus = {
  PENDING: 'pending',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  DEAD_LETTER: 'dead_letter'
};

// Circuit breaker state per peer
const circuitBreakers = new Map();

// Event listeners
const statusListeners = new Set();

/**
 * Initialize the reliability layer
 * @returns {Promise<void>}
 */
export async function initializeReliabilityLayer() {
  config = loadConfig();
  
  const baseDir = config.memory?.baseDir || 'memory';
  QUEUE_DIR = join(baseDir, 'a2a-queue');
  
  // Ensure directory exists
  await fs.mkdir(QUEUE_DIR, { recursive: true });
  await fs.mkdir(join(QUEUE_DIR, 'dead-letter'), { recursive: true });
  
  // Initialize database
  const dbPath = join(QUEUE_DIR, 'outbound-queue.db');
  db = new sqlite3.Database(dbPath);
  
  // Promisify database methods
  db.run = promisify(db.run.bind(db));
  db.get = promisify(db.get.bind(db));
  db.all = promisify(db.all.bind(db));
  
  // Create tables
  await initializeSchema();
  
  console.log('[a2a-reliability-layer] Initialized');
}

/**
 * Initialize SQLite schema
 */
async function initializeSchema() {
  // Main outbound queue table
  await db.run(`
    CREATE TABLE IF NOT EXISTS outbound_queue (
      delivery_id TEXT PRIMARY KEY,
      peer_name TEXT NOT NULL,
      message_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      next_retry TEXT,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      ack_received_at TEXT,
      last_error TEXT,
      circuit_state TEXT DEFAULT 'closed'
    )
  `);
  
  // Indexes for efficient queries
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_status ON outbound_queue(status)
  `);
  
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_peer_status ON outbound_queue(peer_name, status)
  `);
  
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_next_retry ON outbound_queue(next_retry)
  `);
  
  // Dead letter queue
  await db.run(`
    CREATE TABLE IF NOT EXISTS dead_letter (
      delivery_id TEXT PRIMARY KEY,
      peer_name TEXT NOT NULL,
      message_json TEXT NOT NULL,
      failed_at TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL
    )
  `);
  
  // Circuit breaker history
  await db.run(`
    CREATE TABLE IF NOT EXISTS circuit_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peer_name TEXT NOT NULL,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      reason TEXT
    )
  `);
}

/**
 * Calculate exponential backoff with jitter
 * @param {number} attempt - Current attempt number (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function calculateBackoff(attempt) {
  // Base delays: 1s, 2s, 4s, 8s, 16s
  const baseDelay = Math.min(1000 * Math.pow(2, attempt), 16000);
  
  // Add ±20% jitter to prevent thundering herd
  const jitter = (Math.random() * 0.4 - 0.2) * baseDelay;
  
  return Math.floor(baseDelay + jitter);
}

/**
 * Get or create circuit breaker for a peer
 * @param {string} peerName
 * @returns {Object} Circuit breaker state
 */
function getCircuitBreaker(peerName) {
  if (!circuitBreakers.has(peerName)) {
    circuitBreakers.set(peerName, {
      state: CircuitState.CLOSED,
      consecutiveFailures: 0,
      lastFailureAt: null,
      openedAt: null
    });
  }
  return circuitBreakers.get(peerName);
}

/**
 * Update circuit breaker state
 * @param {string} peerName
 * @param {string} newState
 * @param {string} reason
 */
async function updateCircuitState(peerName, newState, reason) {
  const cb = getCircuitBreaker(peerName);
  const oldState = cb.state;
  
  if (oldState === newState) return;
  
  cb.state = newState;
  
  if (newState === CircuitState.OPEN) {
    cb.openedAt = Date.now();
    cb.consecutiveFailures = 0;
  } else if (newState === CircuitState.CLOSED) {
    cb.consecutiveFailures = 0;
    cb.openedAt = null;
  }
  
  // Log state change
  await db.run(
    `INSERT INTO circuit_history (peer_name, from_state, to_state, changed_at, reason)
     VALUES (?, ?, ?, ?, ?)`,
    [peerName, oldState, newState, new Date().toISOString(), reason]
  );
  
  console.log(`[a2a-reliability] Circuit ${peerName}: ${oldState} → ${newState} (${reason})`);
}

/**
 * Check if circuit breaker allows the request
 * @param {string} peerName
 * @returns {boolean}
 */
export function isCircuitClosed(peerName) {
  const cb = getCircuitBreaker(peerName);
  
  if (cb.state === CircuitState.CLOSED) {
    return true;
  }
  
  if (cb.state === CircuitState.OPEN) {
    // Check if cooldown period (60s) has elapsed
    if (cb.openedAt && Date.now() - cb.openedAt >= 60000) {
      // Transition to half-open
      updateCircuitState(peerName, CircuitState.HALF_OPEN, 'cooldown elapsed');
      return true;
    }
    return false;
  }
  
  // HALF_OPEN - allow one probe
  return true;
}

/**
 * Record success for circuit breaker
 * @param {string} peerName
 */
export async function recordSuccess(peerName) {
  const cb = getCircuitBreaker(peerName);
  
  if (cb.state === CircuitState.HALF_OPEN) {
    await updateCircuitState(peerName, CircuitState.CLOSED, 'probe succeeded');
  } else if (cb.state === CircuitState.OPEN) {
    // Direct success while open - close immediately
    await updateCircuitState(peerName, CircuitState.CLOSED, 'direct recovery');
  } else {
    cb.consecutiveFailures = 0;
  }
}

/**
 * Record failure for circuit breaker
 * @param {string} peerName
 * @param {string} error
 */
export async function recordFailure(peerName, error) {
  const cb = getCircuitBreaker(peerName);
  cb.consecutiveFailures++;
  cb.lastFailureAt = Date.now();
  
  // Open circuit after 5 consecutive failures
  if (cb.consecutiveFailures >= 5 && cb.state === CircuitState.CLOSED) {
    await updateCircuitState(peerName, CircuitState.OPEN, `failure threshold reached: ${error}`);
  }
}

/**
 * Send message with delivery guarantee
 * 
 * @param {string} peer - Peer name
 * @param {Object} message - Message to send
 * @param {Object} options - Send options
 * @param {boolean} options.guarantee - Enable delivery guarantees
 * @param {number} options.timeout - Timeout in milliseconds
 * @returns {Promise<string>} deliveryId
 */
export async function sendWithGuarantee(peer, message, options = {}) {
  const { guarantee = true, timeout = 30000 } = options;
  
  const deliveryId = `dlv_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = new Date().toISOString();
  
  if (guarantee) {
    // Write to WAL queue first
    await db.run(
      `INSERT INTO outbound_queue 
       (delivery_id, peer_name, message_json, status, attempts, max_attempts, next_retry, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [deliveryId, peer, JSON.stringify(message), DeliveryStatus.PENDING, 0, 5, now, now]
    );
    
    console.log(`[a2a-reliability] Queued ${deliveryId} to ${peer}`);
  }
  
  // Notify listeners
  notifyStatusChange(deliveryId, DeliveryStatus.PENDING, { peer });
  
  return deliveryId;
}

/**
 * Get delivery status
 * @param {string} deliveryId
 * @returns {Promise<Object>} Status object
 */
export async function getDeliveryStatus(deliveryId) {
  const row = await db.get(
    `SELECT * FROM outbound_queue WHERE delivery_id = ?`,
    [deliveryId]
  );
  
  if (!row) {
    // Check dead letter queue
    const dlqRow = await db.get(
      `SELECT * FROM dead_letter WHERE delivery_id = ?`,
      [deliveryId]
    );
    
    if (dlqRow) {
      return {
        deliveryId,
        status: DeliveryStatus.DEAD_LETTER,
        peer: dlqRow.peer_name,
        failedAt: dlqRow.failed_at,
        attempts: dlqRow.attempts,
        lastError: dlqRow.last_error
      };
    }
    
    return null;
  }
  
  return {
    deliveryId: row.delivery_id,
    status: row.status,
    peer: row.peer_name,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextRetry: row.next_retry,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    ackReceivedAt: row.ack_received_at,
    lastError: row.last_error
  };
}

/**
 * Acknowledge delivery (called by receiver)
 * @param {string} deliveryId
 * @returns {Promise<boolean>} Success
 */
export async function acknowledgeDelivery(deliveryId) {
  const now = new Date().toISOString();
  
  await db.run(
    `UPDATE outbound_queue 
     SET status = ?, ack_received_at = ?
     WHERE delivery_id = ? AND status = ?`,
    [DeliveryStatus.DELIVERED, now, deliveryId, DeliveryStatus.PENDING]
  );
  
  // Verify the update
  const row = await db.get(
    `SELECT status FROM outbound_queue WHERE delivery_id = ?`,
    [deliveryId]
  );
  
  if (row && row.status === DeliveryStatus.DELIVERED) {
    notifyStatusChange(deliveryId, DeliveryStatus.DELIVERED, { ackReceivedAt: now });
    console.log(`[a2a-reliability] Acknowledged ${deliveryId}`);
    return true;
  }
  
  return false;
}

/**
 * Mark delivery as successfully sent (transport layer confirmation)
 * @param {string} deliveryId
 */
export async function markDelivered(deliveryId) {
  const now = new Date().toISOString();
  
  await db.run(
    `UPDATE outbound_queue 
     SET status = ?, delivered_at = ?
     WHERE delivery_id = ?`,
    [DeliveryStatus.DELIVERED, now, deliveryId]
  );
  
  notifyStatusChange(deliveryId, DeliveryStatus.DELIVERED, { deliveredAt: now });
}

/**
 * Record failed attempt and schedule retry or move to dead letter
 * @param {string} deliveryId
 * @param {string} error
 * @returns {Promise<Object>} Result with shouldRetry
 */
export async function recordAttemptFailure(deliveryId, error) {
  const row = await db.get(
    `SELECT * FROM outbound_queue WHERE delivery_id = ?`,
    [deliveryId]
  );
  
  if (!row) return { shouldRetry: false };
  
  const attempts = row.attempts + 1;
  const maxAttempts = row.max_attempts;
  
  if (attempts >= maxAttempts) {
    // Move to dead letter queue
    await moveToDeadLetter(deliveryId, error, attempts);
    return { shouldRetry: false, deadLetter: true };
  }
  
  // Schedule retry
  const backoff = calculateBackoff(attempts);
  const nextRetry = new Date(Date.now() + backoff).toISOString();
  
  await db.run(
    `UPDATE outbound_queue 
     SET attempts = ?, next_retry = ?, last_error = ?
     WHERE delivery_id = ?`,
    [attempts, nextRetry, error, deliveryId]
  );
  
  notifyStatusChange(deliveryId, DeliveryStatus.PENDING, { 
    attempts, 
    nextRetry,
    lastError: error 
  });
  
  return { shouldRetry: true, nextRetry, attempts };
}

/**
 * Move a delivery to dead letter queue
 * @param {string} deliveryId
 * @param {string} error
 * @param {number} attempts
 */
async function moveToDeadLetter(deliveryId, error, attempts) {
  const row = await db.get(
    `SELECT * FROM outbound_queue WHERE delivery_id = ?`,
    [deliveryId]
  );
  
  if (!row) return;
  
  const now = new Date().toISOString();
  
  // Insert into dead letter
  await db.run(
    `INSERT INTO dead_letter 
     (delivery_id, peer_name, message_json, failed_at, attempts, last_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [deliveryId, row.peer_name, row.message_json, now, attempts, error, row.created_at]
  );
  
  // Remove from outbound queue
  await db.run(
    `DELETE FROM outbound_queue WHERE delivery_id = ?`,
    [deliveryId]
  );
  
  notifyStatusChange(deliveryId, DeliveryStatus.DEAD_LETTER, { 
    failedAt: now,
    attempts,
    lastError: error 
  });
  
  console.log(`[a2a-reliability] Moved ${deliveryId} to dead letter queue`);
}

/**
 * Retry failed messages from dead letter queue
 * @param {Object} options - Retry options
 * @param {string} options.peer - Specific peer to retry (optional)
 * @param {number} options.limit - Max messages to retry
 * @returns {Promise<Array>} Retried delivery IDs
 */
export async function retryFailed(options = {}) {
  const { peer, limit = 10 } = options;
  
  let query = `SELECT * FROM dead_letter`;
  const params = [];
  
  if (peer) {
    query += ` WHERE peer_name = ?`;
    params.push(peer);
  }
  
  query += ` LIMIT ?`;
  params.push(limit);
  
  const rows = await db.all(query, params);
  const retried = [];
  
  for (const row of rows) {
    const deliveryId = row.delivery_id;
    const now = new Date().toISOString();
    
    // Re-queue with fresh state
    await db.run(
      `INSERT INTO outbound_queue 
       (delivery_id, peer_name, message_json, status, attempts, max_attempts, next_retry, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [deliveryId, row.peer_name, row.message_json, DeliveryStatus.PENDING, 0, 5, now, row.created_at]
    );
    
    // Remove from dead letter
    await db.run(
      `DELETE FROM dead_letter WHERE delivery_id = ?`,
      [deliveryId]
    );
    
    retried.push(deliveryId);
    notifyStatusChange(deliveryId, DeliveryStatus.PENDING, { retried: true });
  }
  
  console.log(`[a2a-reliability] Retried ${retried.length} messages from dead letter`);
  return retried;
}

/**
 * Get pending messages ready for retry
 * @param {number} limit
 * @returns {Promise<Array>} Pending messages
 */
export async function getPendingMessages(limit = 100) {
  const now = new Date().toISOString();
  
  const rows = await db.all(
    `SELECT * FROM outbound_queue 
     WHERE status = ? 
       AND (next_retry IS NULL OR next_retry <= ?)
     ORDER BY next_retry ASC
     LIMIT ?`,
    [DeliveryStatus.PENDING, now, limit]
  );
  
  return rows.map(row => ({
    deliveryId: row.delivery_id,
    peer: row.peer_name,
    message: JSON.parse(row.message_json),
    attempts: row.attempts,
    createdAt: row.created_at
  }));
}

/**
 * Get dead letter queue contents
 * @param {Object} options
 * @param {string} options.peer - Filter by peer
 * @param {number} options.limit
 * @returns {Promise<Array>} Dead letter messages
 */
export async function getDeadLetterQueue(options = {}) {
  const { peer, limit = 100 } = options;
  
  let query = `SELECT * FROM dead_letter`;
  const params = [];
  
  if (peer) {
    query += ` WHERE peer_name = ?`;
    params.push(peer);
  }
  
  query += ` ORDER BY failed_at DESC LIMIT ?`;
  params.push(limit);
  
  const rows = await db.all(query, params);
  
  return rows.map(row => ({
    deliveryId: row.delivery_id,
    peer: row.peer_name,
    message: JSON.parse(row.message_json),
    failedAt: row.failed_at,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at
  }));
}

/**
 * Get circuit breaker state for a peer
 * @param {string} peerName
 * @returns {Object} Circuit state
 */
export function getCircuitState(peerName) {
  const cb = getCircuitBreaker(peerName);
  return {
    peer: peerName,
    state: cb.state,
    consecutiveFailures: cb.consecutiveFailures,
    lastFailureAt: cb.lastFailureAt,
    openedAt: cb.openedAt
  };
}

/**
 * Subscribe to delivery status changes
 * @param {Function} listener
 * @returns {Function} Unsubscribe function
 */
export function onDeliveryStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/**
 * Notify status listeners
 * @param {string} deliveryId
 * @param {string} status
 * @param {Object} details
 */
function notifyStatusChange(deliveryId, status, details = {}) {
  for (const listener of statusListeners) {
    try {
      listener(deliveryId, status, details);
    } catch (err) {
      console.error('[a2a-reliability] Status listener error:', err);
    }
  }
}

/**
 * Get queue statistics
 * @returns {Promise<Object>} Stats
 */
export async function getQueueStats() {
  const stats = await db.get(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM outbound_queue
  `);
  
  const dlqStats = await db.get(`
    SELECT COUNT(*) as dead_letter_count FROM dead_letter
  `);
  
  return {
    total: stats.total,
    pending: stats.pending,
    delivered: stats.delivered,
    failed: stats.failed,
    deadLetter: dlqStats.dead_letter_count
  };
}

/**
 * Clean up old delivered messages
 * @param {number} maxAgeDays
 * @returns {Promise<number>} Number cleaned
 */
export async function cleanupOldMessages(maxAgeDays = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const cutoffStr = cutoff.toISOString();
  
  const result = await db.run(
    `DELETE FROM outbound_queue 
     WHERE status = ? AND delivered_at < ?`,
    [DeliveryStatus.DELIVERED, cutoffStr]
  );
  
  // Get count of deleted rows
  const countResult = await db.get(`SELECT changes() as changes`);
  const deletedCount = countResult ? countResult.changes : 0;
  
  console.log(`[a2a-reliability] Cleaned up ${deletedCount} old messages`);
  return deletedCount;
}

/**
 * Close database connection
 */
export async function closeReliabilityLayer() {
  if (db) {
    await new Promise((resolve) => db.close(resolve));
    db = null;
  }
}

// Export all functions
export default {
  initializeReliabilityLayer,
  sendWithGuarantee,
  getDeliveryStatus,
  acknowledgeDelivery,
  markDelivered,
  recordAttemptFailure,
  retryFailed,
  getPendingMessages,
  getDeadLetterQueue,
  getCircuitState,
  recordSuccess,
  recordFailure,
  isCircuitClosed,
  onDeliveryStatus,
  getQueueStats,
  cleanupOldMessages,
  closeReliabilityLayer,
  CircuitState,
  DeliveryStatus
};
