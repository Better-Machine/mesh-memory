/**
 * Kingdom A2A Bridge — Multi-Agent Coordination Protocol
 * 
 * Bridges Kingdom-level operations with A2A messaging layer.
 * Handles distributed state sync and consensus over A2A.
 * 
 * @version 1.0.0
 * @module kingdom-a2a
 */

import { randomUUID } from 'crypto';

/**
 * Kingdom A2A Bridge
 * Connects Kingdom state/consensus to A2A message bus
 */
export class KingdomA2A {
  constructor(options = {}) {
    this.nodeId = options.nodeId || process.env.NODE_ID || 'unknown';
    this.orgId = options.orgId || process.env.ORG_ID || 'default';
    this.kingdomState = options.kingdomState || null;
    this.consensusProtocol = options.consensusProtocol || null;
    
    // A2A Gateway connection
    this.gatewayEndpoint = options.gatewayEndpoint || process.env.A2A_GATEWAY_URL;
    this.authToken = options.authToken || process.env.A2A_AUTH_TOKEN;
    
    // HTTP client
    this.httpClient = options.httpClient || null;
    
    // Message handlers
    this.handlers = new Map();
    
    // Sync configuration
    this.syncInterval = options.syncInterval || 30000; // 30 seconds
    this.syncTimer = null;
    this.isRunning = false;
    
    // Peer discovery
    this.discoveryEnabled = options.discoveryEnabled !== false;
    this.discoveryInterval = options.discoveryInterval || 60000; // 1 minute
    this.discoveryTimer = null;
    
    // Message sequence tracking
    this.seenMessages = new Set();
    this.maxSeenMessages = options.maxSeenMessages || 10000;
    
    // Statistics
    this.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      syncOperations: 0,
      consensusProposals: 0
    };
  }

  /**
   * Start the Kingdom A2A bridge
   */
  async start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    
    // Register message handlers with A2A gateway
    this._registerHandlers();
    
    // Start periodic sync
    if (this.syncInterval > 0) {
      this.syncTimer = setInterval(() => this._periodicSync(), this.syncInterval);
    }
    
    // Start peer discovery
    if (this.discoveryEnabled) {
      this.discoveryTimer = setInterval(() => this._discoverPeers(), this.discoveryInterval);
    }
    
    // Announce presence
    await this._announcePresence();
    
    console.log(`[KingdomA2A] Bridge started for node ${this.nodeId}`);
    return { started: true, nodeId: this.nodeId };
  }

  /**
   * Stop the Kingdom A2A bridge
   */
  async stop() {
    this.isRunning = false;
    
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
    
    // Announce departure
    await this._announceDeparture();
    
    console.log(`[KingdomA2A] Bridge stopped for node ${this.nodeId}`);
    return { stopped: true };
  }

  /**
   * Send a state update to all peers
   */
  async broadcastStateUpdate(key, value, options = {}) {
    const message = {
      id: randomUUID(),
      type: 'kingdom:state:update',
      timestamp: Date.now(),
      source: {
        nodeId: this.nodeId,
        orgId: this.orgId
      },
      payload: {
        key,
        value,
        version: options.version || Date.now(),
        ttl: options.ttl || null
      },
      signature: null // Optional: sign if configured
    };

    return this._sendMessage(message, { broadcast: true });
  }

  /**
   * Send a consensus proposal to peers
   */
  async broadcastProposal(proposal, options = {}) {
    const message = {
      id: randomUUID(),
      type: 'kingdom:consensus:proposal',
      timestamp: Date.now(),
      source: {
        nodeId: this.nodeId,
        orgId: this.orgId
      },
      payload: {
        proposal,
        action: 'start_voting'
      },
      priority: 'high'
    };

    this.stats.consensusProposals++;
    return this._sendMessage(message, { 
      broadcast: true,
      requireAck: options.requireAck !== false
    });
  }

  /**
   * Send a vote to specific peers
   */
  async sendVote(proposalId, vote, targetPeers) {
    const message = {
      id: randomUUID(),
      type: 'kingdom:consensus:vote',
      timestamp: Date.now(),
      source: {
        nodeId: this.nodeId,
        orgId: this.orgId
      },
      payload: {
        proposalId,
        vote
      }
    };

    return this._sendMessage(message, { targets: targetPeers });
  }

  /**
   * Request state sync from a peer
   */
  async requestSync(peerId, peerEndpoint, options = {}) {
    const message = {
      id: randomUUID(),
      type: 'kingdom:sync:request',
      timestamp: Date.now(),
      source: {
        nodeId: this.nodeId,
        orgId: this.orgId
      },
      payload: {
        sinceVersion: options.sinceVersion || 0,
        filter: options.filter || null
      }
    };

    return this._sendMessage(message, { 
      targets: [peerId],
      endpoint: peerEndpoint
    });
  }

  /**
   * Respond to a sync request
   */
  async respondSync(requestId, requesterId, syncData) {
    const message = {
      id: randomUUID(),
      type: 'kingdom:sync:response',
      timestamp: Date.now(),
      source: {
        nodeId: this.nodeId,
        orgId: this.orgId
      },
      inReplyTo: requestId,
      payload: {
        syncData,
        complete: true
      }
    };

    return this._sendMessage(message, { targets: [requesterId] });
  }

  /**
   * Send mesh health status
   */
  async broadcastHealth() {
    if (!this.kingdomState) return;

    const health = this.kingdomState.getMeshHealth();
    const message = {
      id: randomUUID(),
      type: 'kingdom:mesh:health',
      timestamp: Date.now(),
      source: {
        nodeId: this.nodeId,
        orgId: this.orgId
      },
      payload: health
    };

    return this._sendMessage(message, { broadcast: true });
  }

  /**
   * Handle incoming A2A message
   */
  async handleMessage(message, metadata = {}) {
    // Deduplicate
    if (this.seenMessages.has(message.id)) {
      return { handled: false, reason: 'duplicate' };
    }
    this.seenMessages.add(message.id);
    this._pruneSeenMessages();
    
    this.stats.messagesReceived++;
    
    // Route by message type
    switch (message.type) {
      case 'kingdom:state:update':
        return this._handleStateUpdate(message);
      
      case 'kingdom:consensus:proposal':
        return this._handleConsensusProposal(message);
      
      case 'kingdom:consensus:vote':
        return this._handleConsensusVote(message);
      
      case 'kingdom:sync:request':
        return this._handleSyncRequest(message);
      
      case 'kingdom:sync:response':
        return this._handleSyncResponse(message);
      
      case 'kingdom:mesh:health':
        return this._handleHealthUpdate(message);
      
      case 'kingdom:presence:announce':
        return this._handlePresence(message);
      
      case 'kingdom:presence:depart':
        return this._handleDeparture(message);
      
      default:
        // Try custom handlers
        const handler = this.handlers.get(message.type);
        if (handler) {
          return handler(message, metadata);
        }
        return { handled: false, reason: 'unknown_type' };
    }
  }

  /**
   * Register a custom message handler
   */
  onMessageType(messageType, handler) {
    this.handlers.set(messageType, handler);
  }

  /**
   * Get bridge statistics
   */
  getStats() {
    return {
      ...this.stats,
      seenMessages: this.seenMessages.size,
      isRunning: this.isRunning,
      nodeId: this.nodeId,
      orgId: this.orgId
    };
  }

  // Private methods

  async _sendMessage(message, options = {}) {
    if (!this.httpClient) {
      throw new Error('HTTP client not configured');
    }

    const results = [];

    if (options.broadcast) {
      // Send to all known peers
      const peers = this.kingdomState ? 
        Array.from(this.kingdomState.peers.values()) : [];
      
      for (const peer of peers) {
        if (peer.endpoint) {
          try {
            await this._sendToEndpoint(peer.endpoint, message);
            results.push({ peerId: peer.id, success: true });
          } catch (err) {
            results.push({ peerId: peer.id, success: false, error: err.message });
          }
        }
      }
    } else if (options.targets) {
      // Send to specific peers
      for (const peerId of options.targets) {
        const peer = this.kingdomState?.peers.get(peerId);
        const endpoint = options.endpoint || peer?.endpoint;
        
        if (endpoint) {
          try {
            await this._sendToEndpoint(endpoint, message);
            results.push({ peerId, success: true });
          } catch (err) {
            results.push({ peerId, success: false, error: err.message });
          }
        } else {
          results.push({ peerId, success: false, error: 'no_endpoint' });
        }
      }
    } else if (options.endpoint) {
      // Send to specific endpoint
      try {
        await this._sendToEndpoint(options.endpoint, message);
        results.push({ success: true });
      } catch (err) {
        results.push({ success: false, error: err.message });
      }
    }

    this.stats.messagesSent += results.filter(r => r.success).length;
    return { messageId: message.id, results };
  }

  async _sendToEndpoint(endpoint, message) {
    const url = `${endpoint}/kingdom/message`;
    const headers = {};
    
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return this.httpClient.post(url, message, { headers });
  }

  _handleStateUpdate(message) {
    if (!this.kingdomState) return { handled: false, reason: 'no_state' };
    
    const { key, value, version } = message.payload;
    const result = this.kingdomState.set(key, value, {
      version,
      sourceNode: message.source.nodeId
    });
    
    return { handled: true, type: 'state_update', result };
  }

  _handleConsensusProposal(message) {
    if (!this.consensusProtocol) return { handled: false, reason: 'no_consensus' };
    
    const { proposal, action } = message.payload;
    
    // Register the proposal if we don't have it
    const existing = this.consensusProtocol.proposals.get(proposal.id);
    if (!existing) {
      this.consensusProtocol.proposals.set(proposal.id, proposal);
      this.consensusProtocol.votes.set(proposal.id, new Map());
      
      if (action === 'start_voting') {
        this.consensusProtocol.startVoting(proposal.id);
      }
    }
    
    return { handled: true, type: 'consensus_proposal', proposalId: proposal.id };
  }

  _handleConsensusVote(message) {
    if (!this.consensusProtocol) return { handled: false, reason: 'no_consensus' };
    
    const { proposalId, vote } = message.payload;
    const result = this.consensusProtocol.receiveVote(proposalId, vote);
    
    return { handled: true, type: 'consensus_vote', result };
  }

  _handleSyncRequest(message) {
    if (!this.kingdomState) return { handled: false, reason: 'no_state' };
    
    const { sinceVersion, filter } = message.payload;
    const syncData = this.kingdomState.getSyncState(sinceVersion);
    
    // Send response
    this.respondSync(message.id, message.source.nodeId, syncData);
    
    return { handled: true, type: 'sync_request', syncData };
  }

  _handleSyncResponse(message) {
    if (!this.kingdomState) return { handled: false, reason: 'no_state' };
    
    const { syncData } = message.payload;
    const result = this.kingdomState.applySync(syncData, {
      source: message.source.nodeId
    });
    
    return { handled: true, type: 'sync_response', result };
  }

  _handleHealthUpdate(message) {
    if (!this.kingdomState) return { handled: false, reason: 'no_state' };
    
    const health = message.payload;
    const peerId = message.source.nodeId;
    
    // Update peer info
    const peer = this.kingdomState.peers.get(peerId);
    if (peer) {
      peer.lastSeen = Date.now();
      peer.health = health;
    }
    
    return { handled: true, type: 'health_update', peerId };
  }

  _handlePresence(message) {
    if (!this.kingdomState) return { handled: false, reason: 'no_state' };
    
    const { capabilities, endpoint } = message.payload;
    const peerId = message.source.nodeId;
    const orgId = message.source.orgId;
    
    this.kingdomState.registerPeer(peerId, {
      orgId,
      capabilities,
      endpoint
    });
    
    return { handled: true, type: 'presence', peerId };
  }

  _handleDeparture(message) {
    if (!this.kingdomState) return { handled: false, reason: 'no_state' };
    
    const peerId = message.source.nodeId;
    this.kingdomState.unregisterPeer(peerId);
    
    return { handled: true, type: 'departure', peerId };
  }

  async _announcePresence() {
    const message = {
      id: randomUUID(),
      type: 'kingdom:presence:announce',
      timestamp: Date.now(),
      source: {
        nodeId: this.nodeId,
        orgId: this.orgId
      },
      payload: {
        endpoint: this.gatewayEndpoint,
        capabilities: ['state_sync', 'consensus', 'federation']
      }
    };

    return this._sendMessage(message, { broadcast: true });
  }

  async _announceDeparture() {
    const message = {
      id: randomUUID(),
      type: 'kingdom:presence:depart',
      timestamp: Date.now(),
      source: {
        nodeId: this.nodeId,
        orgId: this.orgId
      },
      payload: {
        timestamp: Date.now()
      }
    };

    return this._sendMessage(message, { broadcast: true });
  }

  async _periodicSync() {
    if (!this.kingdomState || !this.isRunning) return;
    
    this.stats.syncOperations++;
    
    // Request sync from random peer
    const peers = Array.from(this.kingdomState.peers.values())
      .filter(p => p.endpoint);
    
    if (peers.length > 0) {
      const peer = peers[Math.floor(Math.random() * peers.length)];
      await this.requestSync(peer.id, peer.endpoint);
    }
    
    // Also broadcast our health
    await this.broadcastHealth();
  }

  async _discoverPeers() {
    if (!this.isRunning) return;
    
    // Re-announce presence for discovery
    await this._announcePresence();
  }

  _registerHandlers() {
    // Handlers are registered via the handleMessage method
    // which should be called by the A2A gateway when receiving kingdom messages
  }

  _pruneSeenMessages() {
    if (this.seenMessages.size > this.maxSeenMessages) {
      const toRemove = this.seenMessages.size - this.maxSeenMessages;
      const iter = this.seenMessages.values();
      for (let i = 0; i < toRemove; i++) {
        const value = iter.next().value;
        this.seenMessages.delete(value);
      }
    }
  }
}

/**
 * Create a new Kingdom A2A Bridge instance
 */
export function createKingdomA2A(options = {}) {
  return new KingdomA2A(options);
}

export default KingdomA2A;