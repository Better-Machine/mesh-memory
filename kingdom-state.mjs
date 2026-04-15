/**
 * Kingdom State — Multi-Agent Coordination Layer
 * 
 * Extends Palace architecture (L0-L3) to Kingdom-level shared state
 * for multi-agent coordination and cross-organization federation.
 * 
 * @version 1.0.0
 * @module kingdom-state
 */

import { createHash, randomUUID } from 'crypto';

/**
 * Kingdom State Manager
 * Handles shared state for multi-agent coordination across mesh nodes
 */
export class KingdomState {
  constructor(options = {}) {
    this.nodeId = options.nodeId || process.env.NODE_ID || 'unknown';
    this.orgId = options.orgId || process.env.ORG_ID || 'default';
    this.peers = new Map(); // peerId -> PeerState
    this.sharedState = new Map(); // key -> StateEntry
    this.decisions = new Map(); // decisionId -> DecisionRecord
    this.syncVersion = 0;
    this.maxHistory = options.maxHistory || 1000;
    this.conflictStrategy = options.conflictStrategy || 'timestamp'; // timestamp | vector | manual
    
    // Federation support
    this.federatedOrgs = new Map(); // orgId -> OrgInfo
    this.trustAnchors = new Set(options.trustAnchors || []);
    
    // Event handlers
    this.handlers = new Map();
  }

  /**
   * Register a peer in the kingdom mesh
   */
  registerPeer(peerId, metadata = {}) {
    const peer = {
      id: peerId,
      orgId: metadata.orgId || this.orgId,
      lastSeen: Date.now(),
      stateVersion: 0,
      capabilities: metadata.capabilities || [],
      endpoint: metadata.endpoint,
      publicKey: metadata.publicKey,
      status: 'active'
    };
    this.peers.set(peerId, peer);
    this._emit('peer:registered', { peerId, peer });
    return peer;
  }

  /**
   * Unregister a peer
   */
  unregisterPeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.status = 'inactive';
      this.peers.delete(peerId);
      this._emit('peer:unregistered', { peerId });
      return true;
    }
    return false;
  }

  /**
   * Set a value in shared state
   */
  set(key, value, options = {}) {
    const entry = {
      key,
      value,
      version: this.syncVersion + 1,
      timestamp: Date.now(),
      nodeId: this.nodeId,
      orgId: this.orgId,
      ttl: options.ttl || null,
      signature: null,
      vectorClock: this._getVectorClock()
    };

    // Sign if we have a signing function
    if (options.sign) {
      entry.signature = options.sign(this._serializeForSign(entry));
    }

    const existing = this.sharedState.get(key);
    if (existing) {
      const resolution = this._resolveConflict(existing, entry);
      if (resolution === 'existing') {
        return { success: false, reason: 'conflict_lost', existing };
      }
    }

    this.sharedState.set(key, entry);
    this.syncVersion = entry.version;
    
    this._emit('state:changed', { key, entry, previous: existing });
    this._pruneHistory();
    
    return { success: true, entry };
  }

  /**
   * Get a value from shared state
   */
  get(key, options = {}) {
    const entry = this.sharedState.get(key);
    if (!entry) return null;
    
    // Check TTL
    if (entry.ttl && Date.now() > entry.timestamp + entry.ttl) {
      this.sharedState.delete(key);
      return null;
    }

    // Verify signature if required
    if (options.verify && entry.signature && !options.verify(entry)) {
      throw new Error('Signature verification failed');
    }

    return options.meta ? entry : entry.value;
  }

  /**
   * Delete a value from shared state
   */
  delete(key, options = {}) {
    const existing = this.sharedState.get(key);
    if (!existing) return { success: false, reason: 'not_found' };

    const tombstone = {
      key,
      value: null,
      version: this.syncVersion + 1,
      timestamp: Date.now(),
      nodeId: this.nodeId,
      orgId: this.orgId,
      deleted: true,
      vectorClock: this._getVectorClock()
    };

    this.sharedState.set(key, tombstone);
    this.syncVersion = tombstone.version;
    
    this._emit('state:deleted', { key, tombstone });
    return { success: true, tombstone };
  }

  /**
   * Record a kingdom-level decision
   */
  recordDecision(decision) {
    const record = {
      id: decision.id || randomUUID(),
      type: decision.type, // 'consensus' | 'delegated' | 'emergency'
      proposal: decision.proposal,
      votes: decision.votes || [],
      result: decision.result,
      timestamp: Date.now(),
      proposer: decision.proposer || this.nodeId,
      participants: decision.participants || [],
      orgId: decision.orgId || this.orgId,
      expiresAt: decision.expiresAt || null,
      provenance: decision.provenance || [],
      hash: null
    };

    // Calculate decision hash for verification
    record.hash = this._hashDecision(record);
    
    this.decisions.set(record.id, record);
    this._emit('decision:recorded', { decisionId: record.id, record });
    
    return record;
  }

  /**
   * Get a decision record
   */
  getDecision(decisionId) {
    return this.decisions.get(decisionId);
  }

  /**
   * List all decisions (with optional filter)
   */
  listDecisions(filter = {}) {
    let results = Array.from(this.decisions.values());
    
    if (filter.type) {
      results = results.filter(d => d.type === filter.type);
    }
    if (filter.orgId) {
      results = results.filter(d => d.orgId === filter.orgId);
    }
    if (filter.since) {
      results = results.filter(d => d.timestamp >= filter.since);
    }
    if (filter.activeOnly) {
      const now = Date.now();
      results = results.filter(d => !d.expiresAt || d.expiresAt > now);
    }
    
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Register a federated organization
   */
  registerFederation(orgId, config = {}) {
    const org = {
      id: orgId,
      trusted: config.trusted || false,
      peers: new Set(config.peers || []),
      policies: config.policies || {},
      registeredAt: Date.now()
    };
    this.federatedOrgs.set(orgId, org);
    
    if (org.trusted) {
      this.trustAnchors.add(orgId);
    }
    
    this._emit('federation:registered', { orgId, org });
    return org;
  }

  /**
   * Check if an org is trusted
   */
  isTrusted(orgId) {
    if (orgId === this.orgId) return true;
    return this.trustAnchors.has(orgId);
  }

  /**
   * Get current sync state for a delta sync
   */
  getSyncState(peerVersion = 0) {
    const changes = [];
    for (const [key, entry] of this.sharedState) {
      if (entry.version > peerVersion) {
        changes.push(entry);
      }
    }
    
    return {
      version: this.syncVersion,
      changes,
      decisions: Array.from(this.decisions.values())
        .filter(d => d.timestamp > (peerVersion * 1000)) // Approximate
    };
  }

  /**
   * Apply sync from another node
   */
  applySync(syncData, options = {}) {
    const applied = [];
    const conflicts = [];
    
    for (const entry of syncData.changes || []) {
      // Skip if from untrusted org and strict mode
      if (options.strictFederation && !this.isTrusted(entry.orgId)) {
        continue;
      }
      
      const existing = this.sharedState.get(entry.key);
      if (existing) {
        const resolution = this._resolveConflict(existing, entry);
        if (resolution === 'existing') {
          conflicts.push({ key: entry.key, local: existing, remote: entry });
          continue;
        }
      }
      
      this.sharedState.set(entry.key, entry);
      applied.push(entry.key);
    }
    
    // Update sync version
    if (syncData.version > this.syncVersion) {
      this.syncVersion = syncData.version;
    }
    
    this._emit('state:synced', { applied, conflicts, source: options.source });
    return { applied, conflicts, version: this.syncVersion };
  }

  /**
   * Get mesh health status
   */
  getMeshHealth() {
    const now = Date.now();
    const activePeers = [];
    const stalePeers = [];
    
    for (const [peerId, peer] of this.peers) {
      const age = now - peer.lastSeen;
      if (age < 60000) { // 1 minute
        activePeers.push({ peerId, age, ...peer });
      } else if (age < 300000) { // 5 minutes
        stalePeers.push({ peerId, age, ...peer });
      }
    }
    
    return {
      nodeId: this.nodeId,
      orgId: this.orgId,
      timestamp: now,
      syncVersion: this.syncVersion,
      stateKeys: this.sharedState.size,
      decisions: this.decisions.size,
      peers: {
        total: this.peers.size,
        active: activePeers.length,
        stale: stalePeers.length,
        activeList: activePeers.map(p => p.peerId),
        staleList: stalePeers.map(p => p.peerId)
      },
      federation: {
        orgs: this.federatedOrgs.size,
        trusted: this.trustAnchors.size
      }
    };
  }

  /**
   * Subscribe to events
   */
  on(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(handler);
    return () => this.off(event, handler);
  }

  /**
   * Unsubscribe from events
   */
  off(event, handler) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    }
  }

  // Private methods

  _getVectorClock() {
    const clock = { [this.nodeId]: this.syncVersion };
    // Include known peer versions
    for (const [peerId, peer] of this.peers) {
      clock[peerId] = peer.stateVersion;
    }
    return clock;
  }

  _resolveConflict(existing, incoming) {
    switch (this.conflictStrategy) {
      case 'timestamp':
        return incoming.timestamp > existing.timestamp ? 'incoming' : 'existing';
      case 'version':
        return incoming.version > existing.version ? 'incoming' : 'existing';
      case 'node':
        // Prefer our own node
        return incoming.nodeId === this.nodeId ? 'incoming' : 'existing';
      default:
        return 'incoming';
    }
  }

  _serializeForSign(entry) {
    return JSON.stringify({
      key: entry.key,
      value: entry.value,
      version: entry.version,
      timestamp: entry.timestamp,
      nodeId: entry.nodeId,
      orgId: entry.orgId
    });
  }

  _hashDecision(record) {
    const data = JSON.stringify({
      type: record.type,
      proposal: record.proposal,
      votes: record.votes,
      result: record.result,
      timestamp: record.timestamp,
      proposer: record.proposer
    });
    return createHash('sha256').update(data).digest('hex');
  }

  _pruneHistory() {
    if (this.decisions.size > this.maxHistory) {
      const sorted = Array.from(this.decisions.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = sorted.slice(0, sorted.length - this.maxHistory);
      for (const [id] of toRemove) {
        this.decisions.delete(id);
      }
    }
  }

  _emit(event, data) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`Event handler error for ${event}:`, err);
        }
      }
    }
  }
}

/**
 * Create a new Kingdom State instance
 */
export function createKingdomState(options = {}) {
  return new KingdomState(options);
}

export default KingdomState;