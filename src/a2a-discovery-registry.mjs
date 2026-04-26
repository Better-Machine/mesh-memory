/**
 * @module a2a-discovery-registry
 * @description Health-Aware Discovery for A2A Integration
 * 
 * Dynamic peer registry with health tracking:
 * - Peer registration with capability discovery
 * - Health metrics tracking
 * - Circuit breaker state management
 * - Capability-based peer filtering
 * 
 * @version 1.0.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { loadConfig } from '../config.mjs';
import { getCache } from './intelligent-cache.mjs';

// Config and paths
let config = null;
let REGISTRY_DIR = 'memory/a2a-registry';

// SQLite database handle
let db = null;

// In-memory cache
const peerCache = new Map();

// Event listeners
const healthListeners = new Set();

// Health check thresholds
export const HealthThresholds = {
  LAST_SEEN_MAX_MS: 5 * 60 * 1000,  // 5 minutes
  SUCCESS_RATE_MIN: 0.80,            // 80%
  LATENCY_P95_MAX_MS: 5000,          // 5 seconds
  CIRCUIT_BREAKER_GRACE_MS: 60000   // 60 seconds cooldown
};

// Circuit breaker states
export const CircuitBreakerState = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half-open'
};

/**
 * Get peer cache instance
 */
function getPeerCache() {
  try {
    return getCache('a2a-peers');
  } catch (e) {
    return null;
  }
}

/**
 * Initialize the discovery registry
 * @returns {Promise<void>}
 */
export async function initializeDiscoveryRegistry() {
  config = loadConfig();
  
  const baseDir = config.memory?.baseDir || 'memory';
  REGISTRY_DIR = join(baseDir, 'a2a-registry');
  
  // Ensure directory exists
  await fs.mkdir(REGISTRY_DIR, { recursive: true });
  
  // Initialize database
  const dbPath = join(REGISTRY_DIR, 'peer-registry.db');
  db = new sqlite3.Database(dbPath);
  
  // Promisify database methods
  db.run = promisify(db.run.bind(db));
  db.get = promisify(db.get.bind(db));
  db.all = promisify(db.all.bind(db));
  
  // Create tables
  await initializeSchema();
  
  // Load peers into cache
  await loadPeersToCache();
  
  console.log('[a2a-discovery-registry] Initialized');
}

/**
 * Initialize SQLite schema
 */
async function initializeSchema() {
  // Peer registry
  await db.run(`
    CREATE TABLE IF NOT EXISTS peers (
      name TEXT PRIMARY KEY,
      agent_card_url TEXT NOT NULL,
      base_url TEXT,
      auth_type TEXT,
      auth_token TEXT,
      skills TEXT,
      versions TEXT,
      max_concurrent_tasks INTEGER DEFAULT 10,
      registered_at TEXT NOT NULL,
      last_updated TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    )
  `);
  
  // Health metrics
  await db.run(`
    CREATE TABLE IF NOT EXISTS peer_health (
      name TEXT PRIMARY KEY,
      last_seen TEXT NOT NULL,
      success_rate REAL NOT NULL DEFAULT 1.0,
      avg_latency_ms REAL NOT NULL DEFAULT 0,
      p95_latency_ms REAL NOT NULL DEFAULT 0,
      circuit_breaker_state TEXT DEFAULT 'closed',
      consecutive_failures INTEGER DEFAULT 0,
      last_failure_at TEXT,
      total_requests INTEGER DEFAULT 0,
      successful_requests INTEGER DEFAULT 0,
      failed_requests INTEGER DEFAULT 0,
      FOREIGN KEY (name) REFERENCES peers(name)
    )
  `);
  
  // Request history (sliding window for metrics)
  await db.run(`
    CREATE TABLE IF NOT EXISTS request_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peer_name TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      success INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      error_code TEXT
    )
  `);
  
  // Health state changes
  await db.run(`
    CREATE TABLE IF NOT EXISTS health_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peer_name TEXT NOT NULL,
      from_state TEXT,
      to_state TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      reason TEXT
    )
  `);
  
  // Indexes
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_health_last_seen ON peer_health(last_seen)
  `);
  
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_history_peer_time ON request_history(peer_name, timestamp)
  `);
  
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_changes_peer ON health_changes(peer_name)
  `);
  
  // NEW: Performance indexes
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_reqhist_peer_time ON request_history(peer_name, timestamp)
  `);
  
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_peerhealth_state ON peer_health(circuit_breaker_state)
  `);
}

/**
 * Load peers from database to cache
 */
async function loadPeersToCache() {
  const rows = await db.all(`
    SELECT p.*, h.* FROM peers p
    LEFT JOIN peer_health h ON p.name = h.name
    WHERE p.is_active = 1
  `);
  
  // PERFORMANCE FIX: Load into intelligent cache
  const cache = getPeerCache();
  for (const row of rows) {
    const peer = rowToPeer(row);
    if (cache) {
      cache.set(peer.name, peer, { category: 'peer', tags: ['peer', `peer:${peer.name}`] });
    }
  }
}

/**
 * Convert database row to peer object
 */
function rowToPeer(row) {
  return {
    name: row.name,
    agentCardUrl: row.agent_card_url,
    baseUrl: row.base_url,
    auth: row.auth_type ? {
      type: row.auth_type,
      token: row.auth_token
    } : undefined,
    skills: row.skills ? JSON.parse(row.skills) : [],
    versions: row.versions ? JSON.parse(row.versions) : [],
    maxConcurrentTasks: row.max_concurrent_tasks,
    health: {
      lastSeen: row.last_seen,
      successRate: row.success_rate ?? 1.0,
      avgLatencyMs: row.avg_latency_ms ?? 0,
      p95LatencyMs: row.p95_latency_ms ?? 0,
      circuitBreakerState: row.circuit_breaker_state ?? CircuitBreakerState.CLOSED,
      consecutiveFailures: row.consecutive_failures ?? 0,
      lastFailureAt: row.last_failure_at,
      totalRequests: row.total_requests ?? 0,
      successfulRequests: row.successful_requests ?? 0,
      failedRequests: row.failed_requests ?? 0
    },
    registeredAt: row.registered_at,
    lastUpdated: row.last_updated
  };
}

/**
 * Register a new peer
 * 
 * @param {Object} peerConfig - Peer configuration
 * @param {string} peerConfig.name - Peer name
 * @param {string} peerConfig.agentCardUrl - Agent Card URL
 * @param {string} peerConfig.baseUrl - Base URL (optional)
 * @param {Object} peerConfig.auth - Auth config {type, token}
 * @param {Array} peerConfig.skills - List of skill IDs
 * @param {Array} peerConfig.versions - Supported versions
 * @param {number} peerConfig.maxConcurrentTasks - Max concurrent tasks
 * @returns {Promise<Object>} Registered peer
 */
export async function registerPeer(peerConfig) {
  const {
    name,
    agentCardUrl,
    baseUrl = null,
    auth = null,
    skills = [],
    versions = [],
    maxConcurrentTasks = 10
  } = peerConfig;
  
  // Validate required fields
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid peer name: must be a non-empty string');
  }
  
  if (!agentCardUrl || typeof agentCardUrl !== 'string') {
    throw new Error('Invalid agentCardUrl: must be a non-empty string');
  }
  
  // Validate URL format
  try {
    new URL(agentCardUrl);
  } catch {
    throw new Error(`Invalid URL: ${agentCardUrl}`);
  }
  
  const now = new Date().toISOString();
  
  // Insert/update peer
  await db.run(
    `INSERT INTO peers 
     (name, agent_card_url, base_url, auth_type, auth_token, skills, versions, 
      max_concurrent_tasks, registered_at, last_updated, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       agent_card_url = excluded.agent_card_url,
       base_url = excluded.base_url,
       auth_type = excluded.auth_type,
       auth_token = excluded.auth_token,
       skills = excluded.skills,
       versions = excluded.versions,
       max_concurrent_tasks = excluded.max_concurrent_tasks,
       last_updated = excluded.last_updated,
       is_active = 1`,
    [
      name, agentCardUrl, baseUrl, auth?.type, auth?.token,
      JSON.stringify(skills), JSON.stringify(versions), maxConcurrentTasks,
      peerCache.has(name) ? peerCache.get(name).registeredAt : now, now, 1
    ]
  );
  
  // Initialize health record if new
  if (!peerCache.has(name)) {
    await db.run(
      `INSERT INTO peer_health 
       (name, last_seen, success_rate, circuit_breaker_state, total_requests, successful_requests)
       VALUES (?, ?, 1.0, 'closed', 0, 0)
       ON CONFLICT(name) DO NOTHING`,
      [name, now]
    );
  }
  
  // Build peer object
  const peer = {
    name,
    agentCardUrl,
    baseUrl,
    auth,
    skills,
    versions,
    maxConcurrentTasks,
    health: peerCache.has(name) ? peerCache.get(name).health : {
      lastSeen: now,
      successRate: 1.0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      circuitBreakerState: CircuitBreakerState.CLOSED,
      consecutiveFailures: 0
    },
    registeredAt: peerCache.has(name) ? peerCache.get(name).registeredAt : now,
    lastUpdated: now
  };
  
  // Update cache
  peerCache.set(name, peer);
  
  console.log(`[a2a-discovery-registry] Registered peer: ${name}`);
  return peer;
}

/**
 * Update peer health metrics
 * 
 * @param {string} name - Peer name
 * @param {Object} healthUpdate - Health update
 * @param {boolean} healthUpdate.success - Whether request succeeded
 * @param {number} healthUpdate.latencyMs - Request latency
 * @param {string} healthUpdate.errorCode - Error code if failed
 * @returns {Promise<Object>} Updated health
 */
export async function updatePeerHealth(name, healthUpdate) {
  const { success, latencyMs = 0, errorCode = null } = healthUpdate;
  
  const peer = peerCache.get(name);
  if (!peer) {
    throw new Error(`Peer not found: ${name}`);
  }
  
  const now = new Date().toISOString();
  
  // Record request in history
  await db.run(
    `INSERT INTO request_history (peer_name, timestamp, success, latency_ms, error_code)
     VALUES (?, ?, ?, ?, ?)`,
    [name, now, success ? 1 : 0, latencyMs, errorCode]
  );
  
  // Get current health
  const currentHealth = await db.get(
    `SELECT * FROM peer_health WHERE name = ?`,
    [name]
  );
  
  if (!currentHealth) {
    throw new Error(`Health record not found for peer: ${name}`);
  }
  
  // Calculate new metrics
  const totalRequests = currentHealth.total_requests + 1;
  const successfulRequests = currentHealth.successful_requests + (success ? 1 : 0);
  const failedRequests = currentHealth.failed_requests + (success ? 0 : 1);
  const successRate = successfulRequests / totalRequests;
  
  // Calculate rolling average latency (last 100 requests)
  const recentLatencies = await db.all(
    `SELECT latency_ms FROM request_history 
     WHERE peer_name = ? 
     ORDER BY timestamp DESC 
     LIMIT 100`,
    [name]
  );
  
  const latencies = recentLatencies.map(r => r.latency_ms);
  const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  
  // Calculate P95
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const p95Index = Math.ceil(sortedLatencies.length * 0.95) - 1;
  const p95LatencyMs = sortedLatencies[p95Index] || 0;
  
  // Circuit breaker logic
  let circuitState = currentHealth.circuit_breaker_state;
  let consecutiveFailures = currentHealth.consecutive_failures;
  let lastFailureAt = currentHealth.last_failure_at;
  let stateChanged = false;
  let stateReason = '';
  
  if (success) {
    if (circuitState === CircuitBreakerState.HALF_OPEN) {
      // Success in half-open -> close
      circuitState = CircuitBreakerState.CLOSED;
      consecutiveFailures = 0;
      stateChanged = true;
      stateReason = 'probe succeeded';
    } else if (circuitState === CircuitBreakerState.CLOSED) {
      consecutiveFailures = 0;
    }
  } else {
    consecutiveFailures++;
    lastFailureAt = now;
    
    if (consecutiveFailures >= 5 && circuitState === CircuitBreakerState.CLOSED) {
      circuitState = CircuitBreakerState.OPEN;
      stateChanged = true;
      stateReason = 'failure threshold reached';
    }
  }
  
  // Check if circuit should transition from open to half-open
  if (circuitState === CircuitBreakerState.OPEN && lastFailureAt) {
    const elapsed = Date.now() - new Date(lastFailureAt).getTime();
    if (elapsed >= HealthThresholds.CIRCUIT_BREAKER_GRACE_MS) {
      circuitState = CircuitBreakerState.HALF_OPEN;
      stateChanged = true;
      stateReason = 'cooldown elapsed';
    }
  }
  
  // Update health record
  await db.run(
    `UPDATE peer_health SET
       last_seen = ?,
       success_rate = ?,
       avg_latency_ms = ?,
       p95_latency_ms = ?,
       circuit_breaker_state = ?,
       consecutive_failures = ?,
       last_failure_at = ?,
       total_requests = ?,
       successful_requests = ?,
       failed_requests = ?
     WHERE name = ?`,
    [
      now, successRate, avgLatencyMs, p95LatencyMs,
      circuitState, consecutiveFailures, lastFailureAt,
      totalRequests, successfulRequests, failedRequests, name
    ]
  );
  
  // Record state change
  if (stateChanged) {
    await db.run(
      `INSERT INTO health_changes (peer_name, from_state, to_state, changed_at, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [name, currentHealth.circuit_breaker_state, circuitState, now, stateReason]
    );
    
    notifyHealthChange(name, {
      lastSeen: now,
      successRate,
      avgLatencyMs,
      p95LatencyMs,
      circuitBreakerState: circuitState,
      consecutiveFailures,
      lastFailureAt
    });
  }
  
  // Update cache
  peer.health = {
    lastSeen: now,
    successRate,
    avgLatencyMs,
    p95LatencyMs,
    circuitBreakerState: circuitState,
    consecutiveFailures,
    lastFailureAt,
    totalRequests,
    successfulRequests,
    failedRequests
  };
  
  return peer.health;
}

/**
 * Get a healthy peer
 * 
 * @param {string} name - Peer name
 * @returns {Promise<Object|null>} Peer if healthy, null otherwise
 */
export async function getHealthyPeer(name) {
  const peer = peerCache.get(name);
  if (!peer) {
    return null;
  }
  
  const now = Date.now();
  const lastSeenMs = now - new Date(peer.health.lastSeen).getTime();
  
  // Health check criteria
  const isHealthy = 
    lastSeenMs < HealthThresholds.LAST_SEEN_MAX_MS &&
    peer.health.successRate >= HealthThresholds.SUCCESS_RATE_MIN &&
    peer.health.circuitBreakerState === CircuitBreakerState.CLOSED;
  
  return isHealthy ? peer : null;
}

/**
 * List available peers filtered by capability
 * 
 * @param {Object} filter - Filter criteria
 * @param {string} filter.capability - Required skill/capability
 * @param {string} filter.version - Required version
 * @param {boolean} filter.healthyOnly - Only return healthy peers
 * @param {number} filter.limit - Max results
 * @returns {Promise<Array>} Filtered peers
 */
export async function listAvailablePeers(filter = {}) {
  const { capability, version, healthyOnly = true, limit = 100 } = filter;
  
  const results = [];
  
  for (const [name, peer] of peerCache) {
    // Filter by capability
    if (capability && !peer.skills.includes(capability)) {
      continue;
    }
    
    // Filter by version
    if (version && !peer.versions.includes(version)) {
      continue;
    }
    
    // Filter by health
    if (healthyOnly) {
      const healthy = await getHealthyPeer(name);
      if (!healthy) {
        continue;
      }
    }
    
    results.push(peer);
    
    if (results.length >= limit) {
      break;
    }
  }
  
  // Sort by success rate (descending)
  results.sort((a, b) => b.health.successRate - a.health.successRate);
  
  return results;
}

/**
 * Get peer by name
 * 
 * @param {string} name - Peer name
 * @returns {Promise<Object|null>} Peer or null
 */
export async function getPeer(name) {
  return peerCache.get(name) || null;
}

/**
 * Unregister a peer (mark as inactive)
 * 
 * @param {string} name - Peer name
 * @returns {Promise<boolean>} Success
 */
export async function unregisterPeer(name) {
  const peer = peerCache.get(name);
  if (!peer) {
    return false;
  }
  
  const now = new Date().toISOString();
  
  await db.run(
    `UPDATE peers SET is_active = 0, last_updated = ? WHERE name = ?`,
    [now, name]
  );
  
  // PERFORMANCE FIX: Invalidate peer cache
  const cache = getPeerCache();
  if (cache) {
    cache.invalidateTag('peer');
  }
  
  console.log(`[a2a-discovery-registry] Unregistered peer: ${name}`);
  return true;
}

/**
 * Get health history for a peer
 * 
 * @param {string} name - Peer name
 * @param {number} limit - Max entries
 * @returns {Promise<Array>} Health changes
 */
export async function getPeerHealthHistory(name, limit = 100) {
  const rows = await db.all(
    `SELECT * FROM health_changes 
     WHERE peer_name = ? 
     ORDER BY changed_at DESC 
     LIMIT ?`,
    [name, limit]
  );
  
  return rows.map(row => ({
    fromState: row.from_state,
    toState: row.to_state,
    changedAt: row.changed_at,
    reason: row.reason
  }));
}

/**
 * Get request history for a peer
 * 
 * @param {string} name - Peer name
 * @param {Object} options - Query options
 * @param {number} options.hours - Hours of history
 * @param {number} options.limit - Max entries
 * @returns {Promise<Array>} Request history
 */
export async function getPeerRequestHistory(name, options = {}) {
  const { hours = 24, limit = 100 } = options;
  
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hours);
  const cutoffStr = cutoff.toISOString();
  
  const rows = await db.all(
    `SELECT * FROM request_history 
     WHERE peer_name = ? AND timestamp >= ?
     ORDER BY timestamp DESC
     LIMIT ?`,
    [name, cutoffStr, limit]
  );
  
  return rows.map(row => ({
    timestamp: row.timestamp,
    success: row.success === 1,
    latencyMs: row.latency_ms,
    errorCode: row.error_code
  }));
}

/**
 * Clean up old request history
 * 
 * @param {number} maxAgeDays - Days to keep
 * @returns {Promise<number>} Number cleaned
 */
export async function cleanupRequestHistory(maxAgeDays = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const cutoffStr = cutoff.toISOString();
  
  const result = await db.run(
    `DELETE FROM request_history WHERE timestamp < ?`,
    [cutoffStr]
  );
  
  console.log(`[a2a-discovery-registry] Cleaned up ${result.changes} old history entries`);
  return result.changes;
}

/**
 * Get registry statistics
 * @returns {Promise<Object>} Stats
 */
export async function getRegistryStats() {
  const peerStats = await db.get(`
    SELECT 
      COUNT(*) as total_peers,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_peers
    FROM peers
  `);
  
  const healthStats = await db.get(`
    SELECT 
      COUNT(*) as total_health_records,
      SUM(CASE WHEN circuit_breaker_state = 'closed' THEN 1 ELSE 0 END) as healthy_circuits,
      SUM(CASE WHEN circuit_breaker_state = 'open' THEN 1 ELSE 0 END) as open_circuits,
      SUM(CASE WHEN circuit_breaker_state = 'half-open' THEN 1 ELSE 0 END) as half_open_circuits
    FROM peer_health
  `);
  
  const historyCount = await db.get(`
    SELECT COUNT(*) as total_history FROM request_history
  `);
  
  return {
    peers: peerStats,
    health: healthStats,
    history: historyCount.total_history
  };
}

/**
 * Sync with A2A Gateway's PeerHealthManager
 * 
 * @param {Object} gatewayHealth - Health data from gateway
 * @returns {Promise<number>} Number synced
 */
export async function syncWithGatewayHealth(gatewayHealth) {
  let synced = 0;
  
  for (const [name, healthData] of Object.entries(gatewayHealth)) {
    const peer = peerCache.get(name);
    if (!peer) {
      continue;
    }
    
    // Update from gateway data
    await db.run(
      `UPDATE peer_health SET
         circuit_breaker_state = ?,
         consecutive_failures = ?,
         last_failure_at = ?
       WHERE name = ?`,
      [
        healthData.circuit || CircuitBreakerState.CLOSED,
        healthData.consecutiveFailures || 0,
        healthData.lastFailureAt,
        name
      ]
    );
    
    // Update cache
    peer.health.circuitBreakerState = healthData.circuit || peer.health.circuitBreakerState;
    peer.health.consecutiveFailures = healthData.consecutiveFailures || 0;
    if (healthData.lastFailureAt) {
      peer.health.lastFailureAt = healthData.lastFailureAt;
    }
    
    synced++;
  }
  
  if (synced > 0) {
    console.log(`[a2a-discovery-registry] Synced ${synced} peers from gateway`);
  }
  
  return synced;
}

/**
 * Subscribe to peer health changes
 * @param {Function} listener
 * @returns {Function} Unsubscribe function
 */
export function onPeerHealthChange(listener) {
  healthListeners.add(listener);
  return () => healthListeners.delete(listener);
}

/**
 * Notify health listeners
 * @param {string} peerName
 * @param {Object} health
 */
function notifyHealthChange(peerName, health) {
  for (const listener of healthListeners) {
    try {
      listener(peerName, health);
    } catch (err) {
      console.error('[a2a-discovery-registry] Health listener error:', err);
    }
  }
}

/**
 * Close database connection
 */
export async function closeDiscoveryRegistry() {
  // PERFORMANCE FIX: Clear intelligent cache
  const cache = getPeerCache();
  if (cache) {
    cache.invalidateTag('peer');
  }
  
  if (db) {
    await new Promise((resolve) => db.close(resolve));
    db = null;
  }
}

// Export all functions
export default {
  initializeDiscoveryRegistry,
  registerPeer,
  getHealthyPeer,
  updatePeerHealth,
  listAvailablePeers,
  getPeer,
  unregisterPeer,
  getPeerHealthHistory,
  getPeerRequestHistory,
  cleanupRequestHistory,
  syncWithGatewayHealth,
  getRegistryStats,
  onPeerHealthChange,
  closeDiscoveryRegistry,
  CircuitBreakerState,
  HealthThresholds
};
