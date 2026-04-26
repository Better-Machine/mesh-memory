/**
 * @module a2a-integration
 * @description Unified API for Hardened A2A Integration
 * 
 * Single interface for all A2A operations:
 * - Unified send with guarantees, context, and discovery
 * - Receive with auto-acknowledgment
 * - Health-aware peer discovery
 * - Thread history via TKG
 * 
 * @version 1.0.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { loadConfig } from '../config.mjs';

// Import sub-modules
import {
  initializeReliabilityLayer,
  sendWithGuarantee,
  getDeliveryStatus as _getDeliveryStatus,
  acknowledgeDelivery,
  markDelivered,
  recordAttemptFailure,
  recordSuccess,
  recordFailure,
  isCircuitClosed,
  retryFailed as _retryFailed,
  getPendingMessages,
  onDeliveryStatus,
  DeliveryStatus,
  CircuitState
} from './a2a-reliability-layer.mjs';

import {
  initializeContextEscrow,
  getOrCreateContext,
  autoContextSend,
  receiveWithContext,
  getThreadHistory as _getThreadHistory,
  closeContext as _closeContext,
  generateContextId,
  onContextChange
} from './a2a-context-escrow.mjs';

import {
  initializeDiscoveryRegistry,
  registerPeer as _registerPeer,
  getHealthyPeer,
  updatePeerHealth,
  listAvailablePeers,
  getPeer as _getPeer,
  unregisterPeer as _unregisterPeer,
  onPeerHealthChange,
  CircuitBreakerState
} from './a2a-discovery-registry.mjs';

// Event listeners
const eventListeners = {
  deliveryStatus: new Set(),
  peerHealthChange: new Set(),
  contextExpired: new Set()
};

// Send function provider (to be injected - A2A Gateway client)
let sendProvider = null;

/**
 * Initialize the A2A integration system
 * @param {Object} options - Initialization options
 * @param {Function} options.sendProvider - Function to send via A2A Gateway
 * @returns {Promise<void>}
 */
export async function initializeA2AIntegration(options = {}) {
  const { sendProvider: provider } = options;
  
  if (provider) {
    sendProvider = provider;
  }
  
  // Initialize all sub-modules
  await initializeReliabilityLayer();
  await initializeContextEscrow();
  await initializeDiscoveryRegistry();
  
  // Wire up event forwarding
  onDeliveryStatus((deliveryId, status, details) => {
    for (const listener of eventListeners.deliveryStatus) {
      try {
        listener(deliveryId, status, details);
      } catch (err) {
        console.error('[a2a-integration] Delivery status listener error:', err);
      }
    }
  });
  
  onPeerHealthChange((peerName, health) => {
    for (const listener of eventListeners.peerHealthChange) {
      try {
        listener(peerName, health);
      } catch (err) {
        console.error('[a2a-integration] Peer health listener error:', err);
      }
    }
  });
  
  onContextChange((contextId, event, details) => {
    if (event === 'expired') {
      for (const listener of eventListeners.contextExpired) {
        try {
          listener(contextId, details);
        } catch (err) {
          console.error('[a2a-integration] Context expired listener error:', err);
        }
      }
    }
  });
  
  console.log('[a2a-integration] Initialized');
}

/**
 * Send a message with full hardening
 * 
 * @param {string} peer - Peer name
 * @param {Object|string} message - Message to send
 * @param {Object} options - Send options
 * @param {boolean} options.guarantee - Enable delivery guarantees
 * @param {boolean} options.context - Enable context escrow
 * @param {string} options.contextId - Existing context ID
 * @param {number} options.timeout - Timeout in milliseconds
 * @param {string} options.agentSession - Agent session info
 * @returns {Promise<Object>} Send result with deliveryId, contextId, status
 */
export async function send(peer, message, options = {}) {
  const {
    guarantee = true,
    context = true,
    contextId: existingContextId,
    timeout = 30000,
    agentSession = {}
  } = options;
  
  // Validate peer
  const peerInfo = await getHealthyPeer(peer);
  if (!peerInfo) {
    const registered = await getPeer(peer);
    if (!registered) {
      throw new Error(`Unknown peer: ${peer}`);
    }
    
    // Check circuit breaker
    if (!isCircuitClosed(peer)) {
      return {
        success: false,
        error: `Circuit breaker open for peer: ${peer}`,
        deliveryId: null,
        contextId: null,
        status: 'rejected'
      };
    }
  }
  
  // Handle context
  let contextId = existingContextId;
  let briefing = '';
  let roomId = null;
  
  if (context) {
    const contextResult = await autoContextSend(peer, message, agentSession, { contextId });
    contextId = contextResult.contextId;
    briefing = contextResult.briefing;
    roomId = contextResult.roomId;
  }
  
  // Prepare message with briefing
  let finalMessage = message;
  if (typeof message === 'string' && briefing) {
    finalMessage = briefing + message;
  } else if (typeof message === 'object' && briefing) {
    finalMessage = {
      ...message,
      text: briefing + (message.text || message.message || JSON.stringify(message))
    };
  }
  
  // Queue for delivery
  let deliveryId = null;
  if (guarantee) {
    deliveryId = await sendWithGuarantee(peer, finalMessage, { guarantee, timeout });
  }
  
  // Try to send immediately if provider available
  let sendResult = null;
  let sendError = null;
  
  if (sendProvider) {
    const startTime = Date.now();
    try {
      sendResult = await sendProvider(peer, finalMessage, { timeout });
      
      // Update health metrics
      const latencyMs = Date.now() - startTime;
      await updatePeerHealth(peer, { success: true, latencyMs });
      await recordSuccess(peer);
      
      if (deliveryId) {
        await markDelivered(deliveryId);
      }
    } catch (err) {
      sendError = err;
      
      // Update health metrics
      await updatePeerHealth(peer, { success: false, latencyMs: Date.now() - startTime, errorCode: err.code || 'UNKNOWN' });
      await recordFailure(peer, err.message);
      
      if (deliveryId) {
        await recordAttemptFailure(deliveryId, err.message);
      }
    }
  }
  
  return {
    success: sendError ? false : true,
    error: sendError?.message || null,
    deliveryId,
    contextId,
    roomId,
    status: sendError ? 'queued' : 'sent',
    peer: peerInfo || await getPeer(peer)
  };
}

/**
 * Receive a message with auto-acknowledgment
 * 
 * @param {string} contextId - A2A context ID
 * @param {Function} handler - Message handler
 * @param {Object} options - Receive options
 * @param {boolean} options.autoAck - Auto-acknowledge receipt
 * @returns {Promise<Object>} Handler result
 */
export async function receive(contextId, handler, options = {}) {
  const { autoAck = true, peer } = options;
  
  return async (message, meta) => {
    const startTime = Date.now();
    
    try {
      // Process with context
      const contextInfo = await receiveWithContext(contextId, peer || meta?.peer, message);
      
      // Call handler
      const result = await handler(message, {
        ...meta,
        contextId,
        roomId: contextInfo.roomId,
        messageCount: contextInfo.messageCount
      });
      
      // Auto-acknowledge if enabled
      if (autoAck && message?.deliveryId) {
        await acknowledgeDelivery(message.deliveryId);
      }
      
      // Update health if peer known
      if (peer) {
        const latencyMs = Date.now() - startTime;
        await updatePeerHealth(peer, { success: true, latencyMs });
      }
      
      return result;
    } catch (err) {
      // Update health on error
      if (peer) {
        await updatePeerHealth(peer, { success: false, latencyMs: Date.now() - startTime, errorCode: 'HANDLER_ERROR' });
      }
      throw err;
    }
  };
}

/**
 * Discover peers with health filtering
 * 
 * @param {Object} filter - Discovery filter
 * @param {string} filter.capability - Required skill
 * @param {string} filter.version - Required version
 * @param {boolean} filter.healthyOnly - Only healthy peers
 * @param {number} filter.limit - Max results
 * @returns {Promise<Array>} Available peers
 */
export async function discoverPeers(filter = {}) {
  return await listAvailablePeers(filter);
}

/**
 * Get thread history for a context
 * 
 * @param {string} contextId - A2A context ID
 * @param {Object} options - Query options
 * @param {number} options.limit - Max messages
 * @param {string} options.before - Get before timestamp
 * @returns {Promise<Array>} Message history
 */
export async function getThreadHistory(contextId, options = {}) {
  return await _getThreadHistory(contextId, options);
}

/**
 * Register a peer
 * 
 * @param {Object} peerConfig - Peer configuration
 * @returns {Promise<Object>} Registered peer
 */
export async function registerPeer(peerConfig) {
  return await _registerPeer(peerConfig);
}

/**
 * Unregister a peer
 * 
 * @param {string} name - Peer name
 * @returns {Promise<boolean>} Success
 */
export async function unregisterPeer(name) {
  return await _unregisterPeer(name);
}

/**
 * Get delivery status
 * 
 * @param {string} deliveryId - Delivery ID
 * @returns {Promise<Object>} Status
 */
export async function getDeliveryStatus(deliveryId) {
  return await _getDeliveryStatus(deliveryId);
}

/**
 * Retry failed deliveries
 * 
 * @param {Object} options - Retry options
 * @returns {Promise<Array>} Retried delivery IDs
 */
export async function retryFailed(options = {}) {
  return await _retryFailed(options);
}

/**
 * Acknowledge a delivery
 * 
 * @param {string} deliveryId - Delivery ID
 * @returns {Promise<boolean>} Success
 */
export async function acknowledge(deliveryId) {
  return await acknowledgeDelivery(deliveryId);
}

/**
 * Close a context
 * 
 * @param {string} contextId - Context ID
 * @param {string} reason - Reason for closure
 * @returns {Promise<boolean>} Success
 */
export async function closeContext(contextId, reason) {
  return await _closeContext(contextId, reason);
}

/**
 * Get system statistics
 * @returns {Promise<Object>} Stats
 */
export async function getStats() {
  const { getQueueStats } = await import('./a2a-reliability-layer.mjs');
  const { getEscrowStats } = await import('./a2a-context-escrow.mjs');
  const { getRegistryStats } = await import('./a2a-discovery-registry.mjs');
  
  const [queueStats, escrowStats, registryStats] = await Promise.all([
    getQueueStats(),
    getEscrowStats(),
    getRegistryStats()
  ]);
  
  return {
    queue: queueStats,
    escrow: escrowStats,
    registry: registryStats
  };
}

/**
 * Subscribe to events
 * 
 * @param {string} event - Event name
 * @param {Function} listener - Event listener
 * @returns {Function} Unsubscribe function
 */
export function on(event, listener) {
  if (!eventListeners[event]) {
    throw new Error(`Unknown event: ${event}. Valid: ${Object.keys(eventListeners).join(', ')}`);
  }
  
  eventListeners[event].add(listener);
  return () => eventListeners[event].delete(listener);
}

/**
 * Process pending messages (called by daemon)
 * @returns {Promise<number>} Number processed
 */
export async function processPendingMessages() {
  if (!sendProvider) {
    return 0;
  }
  
  const pending = await getPendingMessages(100);
  let processed = 0;
  
  for (const msg of pending) {
    try {
      const peerInfo = await getHealthyPeer(msg.peer);
      if (!peerInfo) {
        continue;
      }
      
      const startTime = Date.now();
      await sendProvider(msg.peer, msg.message, { timeout: 30000 });
      
      const latencyMs = Date.now() - startTime;
      await updatePeerHealth(msg.peer, { success: true, latencyMs });
      await recordSuccess(msg.peer);
      await markDelivered(msg.deliveryId);
      
      processed++;
    } catch (err) {
      await updatePeerHealth(msg.peer, { success: false, latencyMs: 0, errorCode: 'SEND_ERROR' });
      await recordFailure(msg.peer, err.message);
      await recordAttemptFailure(msg.deliveryId, err.message);
    }
  }
  
  return processed;
}

/**
 * Close the A2A integration system
 */
export async function closeA2AIntegration() {
  const { closeReliabilityLayer } = await import('./a2a-reliability-layer.mjs');
  const { closeContextEscrow } = await import('./a2a-context-escrow.mjs');
  const { closeDiscoveryRegistry } = await import('./a2a-discovery-registry.mjs');
  
  await closeReliabilityLayer();
  await closeContextEscrow();
  await closeDiscoveryRegistry();
  
  console.log('[a2a-integration] Closed');
}

// Export all functions
export default {
  initializeA2AIntegration,
  send,
  receive,
  discoverPeers,
  getThreadHistory,
  registerPeer,
  unregisterPeer,
  getDeliveryStatus,
  retryFailed,
  acknowledge,
  closeContext,
  getStats,
  on,
  processPendingMessages,
  closeA2AIntegration
};
