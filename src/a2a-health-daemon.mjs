/usr/bin/env node
/**
 * @file a2a-health-daemon.mjs
 * @description Background Health Check Daemon for A2A Integration
 * 
 * Runs as a cron-scheduled process:
 * - Checks health of all registered peers every 60s
 * - Updates health metrics
 * - Alerts on circuit breaker state changes
 * - Publishes health state to mesh-memory shared-pool
 * 
 * @version 1.0.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// Import modules
import { loadConfig } from './config.mjs';
import { initializeDiscoveryRegistry, listAvailablePeers, getPeer, updatePeerHealth } from './src/a2a-discovery-registry.mjs';
import { initializeReliabilityLayer, recordSuccess, recordFailure, getCircuitState, isCircuitClosed } from './src/a2a-reliability-layer.mjs';

// Config
let config = null;
const DAEMON_STATE_FILE = 'memory/a2a-health-daemon.state.json';

// Health check configuration
const HEALTH_CHECK = {
  INTERVAL_MS: 60000,      // 60 seconds
  TIMEOUT_MS: 5000,        // 5 second probe timeout
  ALERT_COOLDOWN_MS: 300000  // 5 minutes between alerts for same peer
};

// Track alert cooldowns
const alertCooldowns = new Map();

/**
 * Load daemon state
 */
async function loadDaemonState() {
  try {
    const content = await fs.readFile(DAEMON_STATE_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return {
      lastRun: null,
      peerStates: {},
      alertHistory: []
    };
  }
}

/**
 * Save daemon state
 */
async function saveDaemonState(state) {
  const dir = join(process.cwd(), 'memory');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(DAEMON_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Health probe function
 * Attempts to fetch agent card from peer
 */
async function healthProbe(peer) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK.TIMEOUT_MS);
  
  try {
    const url = peer.agentCardUrl;
    const headers = {};
    
    if (peer.auth?.token) {
      if (peer.auth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${peer.auth.token}`;
      } else {
        headers['X-API-Key'] = peer.auth.token;
      }
    }
    
    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;
    
    if (response.ok) {
      return { success: true, latencyMs };
    } else {
      return { success: false, latencyMs, error: `HTTP ${response.status}` };
    }
  } catch (err) {
    clearTimeout(timeout);
    return { success: false, latencyMs: HEALTH_CHECK.TIMEOUT_MS, error: err.message };
  }
}

/**
 * Check health of a single peer
 */
async function checkPeerHealth(peer, state) {
  const peerName = peer.name;
  const previousState = state.peerStates[peerName] || {
    circuitState: 'closed',
    lastCheck: null,
    consecutiveErrors: 0
  };
  
  // Run health probe
  const probe = await healthProbe(peer);
  
  // Update health metrics
  await updatePeerHealth(peerName, {
    success: probe.success,
    latencyMs: probe.latencyMs,
    errorCode: probe.success ? null : probe.error
  });
  
  // Get current circuit state
  const circuitState = getCircuitState(peerName);
  
  // Check for state changes that need alerting
  if (circuitState.state !== previousState.circuitState) {
    await alertCircuitChange(peerName, previousState.circuitState, circuitState.state, probe);
  }
  
  // Update state
  state.peerStates[peerName] = {
    circuitState: circuitState.state,
    lastCheck: new Date().toISOString(),
    consecutiveErrors: probe.success ? 0 : (previousState.consecutiveErrors + 1),
    lastError: probe.success ? null : probe.error
  };
  
  return probe.success;
}

/**
 * Send alert on circuit breaker state change
 */
async function alertCircuitChange(peerName, fromState, toState, probe) {
  const now = Date.now();
  
  // Check cooldown
  const lastAlert = alertCooldowns.get(peerName);
  if (lastAlert && (now - lastAlert) < HEALTH_CHECK.ALERT_COOLDOWN_MS) {
    return;
  }
  
  alertCooldowns.set(peerName, now);
  
  const timestamp = new Date().toISOString();
  const severity = toState === 'open' ? 'ERROR' : toState === 'half-open' ? 'WARN' : 'INFO';
  
  const alert = {
    timestamp,
    severity,
    type: 'CIRCUIT_BREAKER_CHANGE',
    peer: peerName,
    fromState,
    toState,
    latencyMs: probe.latencyMs,
    error: probe.error || null
  };
  
  // Log to console
  console.log(`[a2a-health-daemon] ALERT [${severity}] Peer ${peerName}: circuit ${fromState} → ${toState}`);
  
  // Publish to shared-pool (if available)
  try {
    const sharedPoolPath = join(process.cwd(), 'memory/shared-pool.json');
    let sharedPool = { a2a_health: { alerts: [], lastUpdate: timestamp } };
    
    try {
      const content = await fs.readFile(sharedPoolPath, 'utf8');
      sharedPool = JSON.parse(content);
      if (!sharedPool.a2a_health) {
        sharedPool.a2a_health = { alerts: [], lastUpdate: timestamp };
      }
    } catch {
      // File doesn't exist, use default
    }
    
    // Add alert
    sharedPool.a2a_health.alerts.push(alert);
    
    // Keep only last 100 alerts
    if (sharedPool.a2a_health.alerts.length > 100) {
      sharedPool.a2a_health.alerts = sharedPool.a2a_health.alerts.slice(-100);
    }
    
    sharedPool.a2a_health.lastUpdate = timestamp;
    
    await fs.writeFile(sharedPoolPath, JSON.stringify(sharedPool, null, 2));
  } catch (err) {
    console.error('[a2a-health-daemon] Failed to write shared-pool:', err.message);
  }
  
  // Write to dedicated alert log
  try {
    const alertLogPath = join(process.cwd(), 'memory/a2a-health-alerts.jsonl');
    await fs.appendFile(alertLogPath, JSON.stringify(alert) + '\n');
  } catch (err) {
    console.error('[a2a-health-daemon] Failed to write alert log:', err.message);
  }
}

/**
 * Publish health summary to shared-pool
 */
async function publishHealthSummary(peers, state) {
  const timestamp = new Date().toISOString();
  
  const summary = {
    timestamp,
    totalPeers: peers.length,
    healthyPeers: peers.filter(p => {
      const s = state.peerStates[p.name];
      return s && s.circuitState === 'closed';
    }).length,
    circuitOpen: peers.filter(p => {
      const s = state.peerStates[p.name];
      return s && s.circuitState === 'open';
    }).length,
    circuitHalfOpen: peers.filter(p => {
      const s = state.peerStates[p.name];
      return s && s.circuitState === 'half-open';
    }).length,
    peers: peers.map(p => ({
      name: p.name,
      state: state.peerStates[p.name]?.circuitState || 'unknown',
      lastCheck: state.peerStates[p.name]?.lastCheck || null
    }))
  };
  
  try {
    const sharedPoolPath = join(process.cwd(), 'memory/shared-pool.json');
    let sharedPool = {};
    
    try {
      const content = await fs.readFile(sharedPoolPath, 'utf8');
      sharedPool = JSON.parse(content);
    } catch {
      // File doesn't exist
    }
    
    sharedPool.a2a_health_summary = summary;
    
    await fs.writeFile(sharedPoolPath, JSON.stringify(sharedPool, null, 2));
    console.log('[a2a-health-daemon] Published health summary to shared-pool');
  } catch (err) {
    console.error('[a2a-health-daemon] Failed to publish summary:', err.message);
  }
}

/**
 * Main health check run
 */
async function runHealthChecks() {
  console.log('[a2a-health-daemon] Starting health check run...');
  
  const startTime = Date.now();
  const state = await loadDaemonState();
  
  // Get all registered peers (including unhealthy ones)
  const peers = await listAvailablePeers({ healthyOnly: false, limit: 1000 });
  
  if (peers.length === 0) {
    console.log('[a2a-health-daemon] No peers registered');
    return;
  }
  
  console.log(`[a2a-health-daemon] Checking ${peers.length} peers...`);
  
  // Check each peer
  let checked = 0;
  let healthy = 0;
  
  for (const peer of peers) {
    try {
      const isHealthy = await checkPeerHealth(peer, state);
      checked++;
      if (isHealthy) healthy++;
    } catch (err) {
      console.error(`[a2a-health-daemon] Error checking ${peer.name}:`, err.message);
    }
  }
  
  // Publish summary
  await publishHealthSummary(peers, state);
  
  // Update state
  state.lastRun = new Date().toISOString();
  await saveDaemonState(state);
  
  const duration = Date.now() - startTime;
  console.log(`[a2a-health-daemon] Completed: ${checked} checked, ${healthy} healthy (${duration}ms)`);
}

/**
 * Main entry point
 */
async function main() {
  console.log('[a2a-health-daemon] Starting...');
  
  // Load config
  config = loadConfig();
  
  // Initialize modules
  await initializeDiscoveryRegistry();
  await initializeReliabilityLayer();
  
  // Run health checks
  await runHealthChecks();
  
  console.log('[a2a-health-daemon] Finished');
  process.exit(0);
}

// Handle errors
process.on('unhandledRejection', (err) => {
  console.error('[a2a-health-daemon] Unhandled rejection:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('[a2a-health-daemon] Uncaught exception:', err);
  process.exit(1);
});

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('[a2a-health-daemon] Fatal error:', err);
    process.exit(1);
  });
}

export { runHealthChecks, healthProbe };
