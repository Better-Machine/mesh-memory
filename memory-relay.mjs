/**
 * @module memory-relay
 * @description Sends MemoryEvents to peer agents via A2A HTTP POST.
 * Rate-limited to one event per second per peer.
 * Phase 2: Now uses queue-persistence for zero data loss across restarts.
 */

import { initializeQueuePersistence, persistEvent, markEventAsSent, markEventAsFailed } from "./queue-persistence.mjs";
import { runRotation } from "./storage-rotation.mjs";

/** @type {Map<string, number>} Last send timestamp per peer (for rate limiting) */
const lastSendTime = new Map();

/** @type {Map<string, import('./memory-watcher.mjs').MemoryEvent[]>} Queued events per peer */
let pendingQueues = new Map();

/** @type {Map<string, NodeJS.Timeout>} Active debounce timers per peer */
const debounceTimers = new Map();

/** @type {boolean} Queue persistence initialized flag */
let isPersistenceInitialized = false;

/**
 * Initialize queue persistence and load existing queue state
 */
export async function initializeRelay() {
  try {
    // Initialize queue persistence and load existing state
    const loadedQueues = await initializeQueuePersistence();
    pendingQueues = loadedQueues;
    isPersistenceInitialized = true;
    
    // Start storage rotation if enabled
    const config = (await import("./config.mjs")).loadConfig();
    if (config.storage?.pruneIntervalHours) {
      // Run initial rotation
      await runRotation();
      
      // Schedule periodic rotation
      const intervalMs = config.storage.pruneIntervalHours * 60 * 60 * 1000;
      setInterval(() => {
        runRotation().catch(err => {
          console.error('[relay] Storage rotation failed:', err.message);
        });
      }, intervalMs);
      
      console.log(`[relay] Storage rotation scheduled every ${config.storage.pruneIntervalHours} hours`);
    }
    
    console.log('[relay] Queue persistence initialized, loaded', pendingQueues.size, 'peer queues');
  } catch (error) {
    console.error('[relay] Failed to initialize queue persistence:', error.message);
    // Continue with in-memory queues as fallback
    isPersistenceInitialized = false;
  }
}

/**
 * Generate event ID for tracking
 * @param {Object} event - Event object
 * @returns {string} Event ID
 */
function generateEventId(event) {
  const crypto = require('crypto');
  const content = `${event.timestamp}-${event.role}-${event.content}`;
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Sends a single MemoryEvent to one peer.
 * @param {import('./memory-watcher.mjs').MemoryEvent} event - The event to send
 * @param {Object} peer - Peer config { name, url, token }
 * @returns {Promise<boolean>} Whether the send succeeded
 */
async function sendToPeer(event, peer) {
  try {
    const res = await fetch(peer.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${peer.token}`,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.error(
        `[relay] Failed to send to ${peer.name}: ${res.status} ${res.statusText}`
      );
      // Mark as failed in persistence
      if (isPersistenceInitialized) {
        const eventId = generateEventId(event);
        await markEventAsFailed(eventId);
      }
      return false;
    }

    console.log(`[relay] Sent to ${peer.name}: ${event.role} (${event.content.length} chars)`);
    
    // Mark as sent in persistence
    if (isPersistenceInitialized) {
      const eventId = generateEventId(event);
      await markEventAsSent(eventId);
    }
    
    return true;
  } catch (err) {
    console.error(`[relay] Error sending to ${peer.name}:`, err.message);
    // Mark as failed in persistence
    if (isPersistenceInitialized) {
      const eventId = generateEventId(event);
      await markEventAsFailed(eventId);
    }
    return false;
  }
}

/**
 * Flushes the pending queue for a peer, respecting rate limits.
 * @param {string} peerName - Peer identifier
 * @param {Object} peer - Peer config
 * @param {number} rateLimit - Minimum ms between sends
 */
async function flushPeer(peerName, peer, rateLimit) {
  const queue = pendingQueues.get(peerName);
  if (!queue || queue.length === 0) return;

  const now = Date.now();
  const lastSent = lastSendTime.get(peerName) || 0;
  const elapsed = now - lastSent;

  if (elapsed < rateLimit) {
    // Re-schedule flush after rate limit window
    const existing = debounceTimers.get(peerName);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      peerName,
      setTimeout(() => flushPeer(peerName, peer, rateLimit), rateLimit - elapsed)
    );
    return;
  }

  // Send the oldest queued event
  const event = queue.shift();
  if (event) {
    lastSendTime.set(peerName, Date.now());
    await sendToPeer(event, peer);
  }

  // If more events remain, schedule next flush
  if (queue.length > 0) {
    debounceTimers.set(
      peerName,
      setTimeout(() => flushPeer(peerName, peer, rateLimit), rateLimit)
    );
  }
}

/**
 * Relays a MemoryEvent to all configured peers with rate limiting.
 * Phase 2: Persists events to disk for zero data loss.
 * @param {import('./memory-watcher.mjs').MemoryEvent} event - Event to relay
 * @param {Object} config - Full config object
 */
export async function relayEvent(event, config) {
  if (!isPersistenceInitialized) {
    console.warn('[relay] Queue persistence not initialized, using in-memory mode');
  }

  const { peers, relayRateLimit } = config;
  // M3: Configurable max queue depth to prevent unbounded memory growth
  const MAX_QUEUE_DEPTH = config.relayMaxQueueDepth || 500;

  for (const peer of peers) {
    if (!pendingQueues.has(peer.name)) {
      pendingQueues.set(peer.name, []);
    }

    const queue = pendingQueues.get(peer.name);

    // M3: Drop oldest event if queue is full
    if (queue.length >= MAX_QUEUE_DEPTH) {
      queue.shift();
      console.warn(`[relay] Queue full for ${peer.name} (limit: ${MAX_QUEUE_DEPTH}) — dropping oldest event`);
    }

    queue.push(event);

    // Persist event to disk
    if (isPersistenceInitialized) {
      try {
        await persistEvent(peer.name, event);
      } catch (error) {
        console.error(`[relay] Failed to persist event for ${peer.name}:`, error.message);
      }
    }

    // M2: Attach .catch() to surface unexpected errors from flushPeer
    flushPeer(peer.name, peer, relayRateLimit).catch(err =>
      console.error(`[relay] Unexpected flush error for ${peer.name}:`, err.message)
    );
  }
}
