/**
 * Palace-Kingdom Bridge (L4 Multi-Agent Coordination)
 * 
 * Extends Palace L0-L3 to L4: Multi-agent shared state with consensus,
 * conflict resolution, and cross-node synchronization.
 * 
 * L0: Agent Passport (identity)
 * L1: Critical Facts (always loaded)
 * L2: Deep Memory (searchable)
 * L3: Temporal KG (time-travel, audit)
 * L4: Kingdom State (THIS) — multi-agent coordination, consensus
 * 
 * @version 1.0.0
 * @module palace-kingdom
 */

import { PalaceTKG } from './palace-tkg.mjs';
import { PalaceLogger, LogLevel } from './palace-logger.mjs';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { createHash, randomUUID } from 'crypto';
import Database from 'better-sqlite3';

// Configuration
const CONFIG = {
  dbPath: path.join(homedir(), '.openclaw/workspace/memory/palace/palace-kingdom.db'),
  logLevel: 'INFO',
  syncIntervalMs: 30000, // 30 seconds
  conflictStrategy: 'vector-clock' // vector-clock | timestamp | manual
};

// Logger
const logger = new PalaceLogger({
  minLevel: LogLevel[CONFIG.logLevel] || LogLevel.INFO,
  logDir: path.join(path.dirname(CONFIG.dbPath), 'logs'),
  logFile: 'palace-kingdom.log'
});

/**
 * SharedStateEntry - L4 shared state with vector clocks
 */
export class SharedStateEntry {
  constructor(data = {}) {
    this.id = data.id || randomUUID();
    this.key = data.key;
    this.value = data.value;
    this.version = data.version || 1;
    this.timestamp = data.timestamp || Date.now();
    this.nodeId = data.nodeId || 'unknown';
    this.orgId = data.orgId || 'default';
    
    // Vector clock for causality tracking
    this.vectorClock = data.vectorClock || { [this.nodeId]: 1 };
    
    // Consensus
    this.consensusStatus = data.consensusStatus || 'pending'; // pending | consensus | conflict
    this.consensusVotes = data.consensusVotes || [];
    
    // Signature for verification
    this.hash = data.hash || this._calculateHash();
    this.signature = data.signature || null;
    
    // Metadata
    this.ttl = data.ttl || null;
    this.createdAt = data.createdAt || new Date().toISOString();
  }
  
  _calculateHash() {
    const data = JSON.stringify({
      key: this.key,
      value: this.value,
      version: this.version,
      timestamp: this.timestamp,
      nodeId: this.nodeId,
      vectorClock: this.vectorClock
    });
    return createHash('sha256').update(data).digest('hex');
  }
  
  /**
   * Increment vector clock for this node
   */
  incrementClock(nodeId) {
    this.vectorClock[nodeId] = (this.vectorClock[nodeId] || 0) + 1;
    return this;
  }
  
  /**
   * Merge vector clocks with another entry
   */
  mergeClocks(otherEntry) {
    const merged = { ...this.vectorClock };
    for (const [node, count] of Object.entries(otherEntry.vectorClock)) {
      merged[node] = Math.max(merged[node] || 0, count);
    }
    this.vectorClock = merged;
    return this;
  }
  
  /**
   * Check if this entry happens-before another (causality)
   */
  happensBefore(otherEntry) {
    const otherClock = otherEntry.vectorClock;
    let allLessOrEqual = true;
    let atLeastOneLess = false;
    
    // Check all nodes in our clock
    for (const [node, count] of Object.entries(this.vectorClock)) {
      const otherCount = otherClock[node] || 0;
      if (count > otherCount) {
        allLessOrEqual = false;
        break;
      }
      if (count < otherCount) {
        atLeastOneLess = true;
      }
    }
    
    // Check nodes only in other clock
    for (const [node, count] of Object.entries(otherClock)) {
      if (!(node in this.vectorClock) && count > 0) {
        atLeastOneLess = true;
      }
    }
    
    return allLessOrEqual && atLeastOneLess;
  }
  
  /**
   * Check if entries are concurrent (neither happens-before)
   */
  isConcurrent(otherEntry) {
    return !this.happensBefore(otherEntry) && !otherEntry.happensBefore(this);
  }
}

/**
 * ConsensusProposal - Distributed consensus for decisions
 */
export class ConsensusProposal {
  constructor(data = {}) {
    this.id = data.id || randomUUID();
    this.topic = data.topic;
    this.description = data.description;
    this.proposedBy = data.proposedBy;
    this.proposedAt = data.proposedAt || new Date().toISOString();
    
    // Voting
    this.votes = data.votes || []; // { nodeId, vote, timestamp, signature }
    this.requiredVotes = data.requiredVotes || 2; // Minimum for consensus
    this.votingDeadline = data.votingDeadline;
    
    // Status
    this.status = data.status || 'open'; // open | consensus | rejected | expired
    this.result = data.result || null;
    
    // Tally
    this.voteTally = data.voteTally || { accept: 0, reject: 0, abstain: 0 };
  }
  
  /**
   * Cast a vote
   */
  vote(nodeId, vote, signature = null) {
    // Check if already voted
    const existing = this.votes.find(v => v.nodeId === nodeId);
    if (existing) {
      // Update vote
      this.voteTally[existing.vote]--;
      existing.vote = vote;
      existing.timestamp = Date.now();
      existing.signature = signature;
    } else {
      // New vote
      this.votes.push({
        nodeId,
        vote,
        timestamp: Date.now(),
        signature
      });
    }
    
    this.voteTally[vote]++;
    this._checkConsensus();
    return this;
  }
  
  /**
   * Check if consensus reached
   */
  _checkConsensus() {
    if (this.status !== 'open') return;
    
    // Check deadline
    if (this.votingDeadline && Date.now() > this.votingDeadline) {
      this.status = 'expired';
      return;
    }
    
    // Check for majority
    const totalVotes = this.votes.length;
    if (totalVotes >= this.requiredVotes) {
      if (this.voteTally.accept > this.voteTally.reject) {
        this.status = 'consensus';
        this.result = 'accepted';
      } else if (this.voteTally.reject > this.voteTally.accept) {
        this.status = 'rejected';
        this.result = 'rejected';
      }
      // If tie, keep open
    }
  }
  
  /**
   * Get vote summary
   */
  getSummary() {
    return {
      id: this.id,
      topic: this.topic,
      status: this.status,
      votes: this.voteTally,
      totalVotes: this.votes.length,
      requiredVotes: this.requiredVotes
    };
  }
}

/**
 * PalaceKingdom - L4 Multi-Agent Coordination Layer
 */
export class PalaceKingdom {
  constructor(options = {}) {
    this.nodeId = options.nodeId || process.env.NODE_ID || 'liz';
    this.orgId = options.orgId || process.env.ORG_ID || 'bettermachine';
    this.dbPath = options.dbPath || CONFIG.dbPath;
    this.db = null;
    
    this.peers = new Map(); // nodeId -> peer info
    this.syncInterval = options.syncIntervalMs || CONFIG.syncIntervalMs;
    this.conflictStrategy = options.conflictStrategy || CONFIG.conflictStrategy;
    
    this.correlationId = options.correlationId || `kingdom_${Date.now()}`;
    this.syncTimer = null;
  }
  
  /**
   * Initialize Kingdom database
   */
  async init() {
    // Ensure directory exists
    const dbDir = path.dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    
    // Open database
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    
    // Create tables
    this._createTables();
    
    // Start sync scheduler
    this._startSyncScheduler();
    
    logger.info('PalaceKingdom initialized', { 
      nodeId: this.nodeId, 
      orgId: this.orgId,
      dbPath: this.dbPath 
    });
    return this;
  }
  
  _createTables() {
    // Shared state table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kingdom_shared_state (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        version INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        node_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        vector_clock TEXT NOT NULL,
        consensus_status TEXT CHECK(consensus_status IN ('pending', 'consensus', 'conflict')),
        consensus_votes TEXT,
        hash TEXT NOT NULL,
        signature TEXT,
        ttl INTEGER,
        created_at TEXT NOT NULL
      )
    `);
    
    // Indexes
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_state_key ON kingdom_shared_state(key)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_state_node ON kingdom_shared_state(node_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_state_consensus ON kingdom_shared_state(consensus_status)`);
    
    // Consensus proposals table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kingdom_consensus (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        description TEXT,
        proposed_by TEXT NOT NULL,
        proposed_at TEXT NOT NULL,
        votes TEXT NOT NULL,
        required_votes INTEGER NOT NULL,
        voting_deadline INTEGER,
        status TEXT CHECK(status IN ('open', 'consensus', 'rejected', 'expired')),
        result TEXT,
        vote_tally TEXT NOT NULL
      )
    `);
    
    // Peer registry
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kingdom_peers (
        node_id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        endpoint TEXT,
        public_key TEXT,
        capabilities TEXT,
        last_seen INTEGER,
        status TEXT CHECK(status IN ('active', 'inactive')),
        registered_at TEXT NOT NULL
      )
    `);
    
    // Sync log
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kingdom_sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        direction TEXT CHECK(direction IN ('push', 'pull')),
        peer_id TEXT,
        entries_synced INTEGER,
        conflicts INTEGER,
        timestamp TEXT NOT NULL,
        correlation_id TEXT
      )
    `);
  }
  
  /**
   * Register a peer
   */
  registerPeer(nodeId, metadata = {}) {
    const peer = {
      nodeId,
      orgId: metadata.orgId || this.orgId,
      endpoint: metadata.endpoint,
      publicKey: metadata.publicKey,
      capabilities: metadata.capabilities || [],
      lastSeen: Date.now(),
      status: 'active',
      registeredAt: new Date().toISOString()
    };
    
    const sql = `
      INSERT OR REPLACE INTO kingdom_peers 
      (node_id, org_id, endpoint, public_key, capabilities, last_seen, status, registered_at)
      VALUES (@nodeId, @orgId, @endpoint, @publicKey, @capabilities, @lastSeen, @status, @registeredAt)
    `;
    
    this.db.prepare(sql).run({
      nodeId: peer.nodeId,
      orgId: peer.orgId,
      endpoint: peer.endpoint,
      publicKey: peer.publicKey,
      capabilities: JSON.stringify(peer.capabilities),
      lastSeen: peer.lastSeen,
      status: peer.status,
      registeredAt: peer.registeredAt
    });
    
    this.peers.set(nodeId, peer);
    logger.debug('Peer registered', { nodeId, orgId: peer.orgId });
    return peer;
  }
  
  /**
   * Store shared state
   */
  setSharedState(key, value, options = {}) {
    const entry = new SharedStateEntry({
      key,
      value,
      nodeId: this.nodeId,
      orgId: this.orgId,
      ttl: options.ttl,
      vectorClock: { [this.nodeId]: 1 }
    });
    
    // Check for existing
    const existing = this.getSharedState(key);
    if (existing) {
      // Resolve conflict
      const resolution = this._resolveConflict(existing, entry);
      if (resolution.winner === 'existing') {
        logger.debug('Conflict lost', { key, winner: existing.nodeId });
        return { success: false, conflict: true, existing };
      }
      
      // We won, increment version
      entry.version = existing.version + 1;
      entry.mergeClocks(existing).incrementClock(this.nodeId);
    }
    
    const sql = `
      INSERT OR REPLACE INTO kingdom_shared_state
      (id, key, value, version, timestamp, node_id, org_id, vector_clock, 
       consensus_status, consensus_votes, hash, signature, ttl, created_at)
      VALUES (@id, @key, @value, @version, @timestamp, @nodeId, @orgId, @vectorClock,
              @consensusStatus, @consensusVotes, @hash, @signature, @ttl, @createdAt)
    `;
    
    this.db.prepare(sql).run({
      id: entry.id,
      key: entry.key,
      value: JSON.stringify(entry.value),
      version: entry.version,
      timestamp: entry.timestamp,
      nodeId: entry.nodeId,
      orgId: entry.orgId,
      vectorClock: JSON.stringify(entry.vectorClock),
      consensusStatus: entry.consensusStatus,
      consensusVotes: JSON.stringify(entry.consensusVotes),
      hash: entry.hash,
      signature: entry.signature,
      ttl: entry.ttl,
      createdAt: entry.createdAt
    });
    
    logger.debug('Shared state set', { key, version: entry.version, nodeId: this.nodeId });
    return { success: true, entry };
  }
  
  /**
   * Get shared state
   */
  getSharedState(key) {
    const sql = `SELECT * FROM kingdom_shared_state WHERE key = @key`;
    const row = this.db.prepare(sql).get({ key });
    
    if (!row) return null;
    return this._rowToStateEntry(row);
  }
  
  /**
   * Resolve conflicts using configured strategy
   */
  _resolveConflict(existing, incoming) {
    switch (this.conflictStrategy) {
      case 'timestamp':
        return { winner: existing.timestamp > incoming.timestamp ? 'existing' : 'incoming' };
        
      case 'vector-clock':
        if (existing.happensBefore(incoming)) {
          return { winner: 'incoming' };
        } else if (incoming.happensBefore(existing)) {
          return { winner: 'existing' };
        } else {
          // Concurrent - use timestamp as tiebreaker
          return { winner: existing.timestamp > incoming.timestamp ? 'existing' : 'incoming', concurrent: true };
        }
        
      case 'manual':
        return { winner: 'conflict', requiresResolution: true };
        
      default:
        return { winner: 'incoming' };
    }
  }
  
  /**
   * Create consensus proposal
   */
  proposeConsensus(topic, description, options = {}) {
    const proposal = new ConsensusProposal({
      topic,
      description,
      proposedBy: this.nodeId,
      requiredVotes: options.requiredVotes || Math.ceil(this.peers.size / 2) + 1,
      votingDeadline: options.votingDeadline
    });
    
    const sql = `
      INSERT INTO kingdom_consensus
      (id, topic, description, proposed_by, proposed_at, votes, required_votes,
       voting_deadline, status, result, vote_tally)
      VALUES (@id, @topic, @description, @proposedBy, @proposedAt, @votes,
              @requiredVotes, @votingDeadline, @status, @result, @voteTally)
    `;
    
    this.db.prepare(sql).run({
      id: proposal.id,
      topic: proposal.topic,
      description: proposal.description,
      proposedBy: proposal.proposedBy,
      proposedAt: proposal.proposedAt,
      votes: JSON.stringify(proposal.votes),
      requiredVotes: proposal.requiredVotes,
      votingDeadline: proposal.votingDeadline,
      status: proposal.status,
      result: proposal.result,
      voteTally: JSON.stringify(proposal.voteTally)
    });
    
    logger.info('Consensus proposed', { proposalId: proposal.id, topic });
    return proposal;
  }
  
  /**
   * Vote on proposal
   */
  voteOnConsensus(proposalId, vote, signature = null) {
    // Load proposal
    const sql = `SELECT * FROM kingdom_consensus WHERE id = @proposalId`;
    const row = this.db.prepare(sql).get({ proposalId });
    
    if (!row) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    
    const proposal = new ConsensusProposal({
      ...row,
      votes: JSON.parse(row.votes),
      voteTally: JSON.parse(row.vote_tally)
    });
    
    // Cast vote
    proposal.vote(this.nodeId, vote, signature);
    
    // Update database
    const updateSql = `
      UPDATE kingdom_consensus
      SET votes = @votes, status = @status, result = @result, vote_tally = @voteTally
      WHERE id = @proposalId
    `;
    
    this.db.prepare(updateSql).run({
      proposalId,
      votes: JSON.stringify(proposal.votes),
      status: proposal.status,
      result: proposal.result,
      voteTally: JSON.stringify(proposal.voteTally)
    });
    
    logger.info('Vote cast', { proposalId, nodeId: this.nodeId, vote, status: proposal.status });
    return proposal.getSummary();
  }
  
  /**
   * Get all shared state keys
   */
  getAllKeys(options = {}) {
    const { consensusStatus } = options;
    
    let sql = 'SELECT key FROM kingdom_shared_state';
    if (consensusStatus) {
      sql += ' WHERE consensus_status = @consensusStatus';
    }
    
    const stmt = consensusStatus 
      ? this.db.prepare(sql).all({ consensusStatus })
      : this.db.prepare(sql).all();
    
    return stmt.map(row => row.key);
  }
  
  /**
   * Get peers
   */
  getPeers(options = {}) {
    const { status } = options;
    
    let sql = 'SELECT * FROM kingdom_peers';
    if (status) sql += ' WHERE status = @status';
    
    const rows = status
      ? this.db.prepare(sql).all({ status })
      : this.db.prepare(sql).all();
    
    return rows.map(row => ({
      nodeId: row.node_id,
      orgId: row.org_id,
      endpoint: row.endpoint,
      publicKey: row.public_key,
      capabilities: JSON.parse(row.capabilities || '[]'),
      lastSeen: row.last_seen,
      status: row.status
    }));
  }
  
  /**
   * Start sync scheduler
   */
  _startSyncScheduler() {
    this.syncTimer = setInterval(() => {
      this._syncWithPeers();
    }, this.syncInterval);
    
    logger.info('Sync scheduler started', { intervalMs: this.syncInterval });
  }
  
  /**
   * Sync with peers (placeholder for actual sync)
   */
  async _syncWithPeers() {
    // This would connect to peers and exchange state
    // For now, just log
    logger.debug('Sync cycle', { peers: this.peers.size });
  }
  
  /**
   * Convert DB row to SharedStateEntry
   */
  _rowToStateEntry(row) {
    return new SharedStateEntry({
      id: row.id,
      key: row.key,
      value: JSON.parse(row.value),
      version: row.version,
      timestamp: row.timestamp,
      nodeId: row.node_id,
      orgId: row.org_id,
      vectorClock: JSON.parse(row.vector_clock),
      consensusStatus: row.consensus_status,
      consensusVotes: JSON.parse(row.consensus_votes || '[]'),
      hash: row.hash,
      signature: row.signature,
      ttl: row.ttl,
      createdAt: row.created_at
    });
  }
  
  /**
   * Close database
   */
  close() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('PalaceKingdom closed');
    }
  }
}

/**
 * Factory function
 */
export async function createPalaceKingdom(options = {}) {
  const kingdom = new PalaceKingdom(options);
  await kingdom.init();
  return kingdom;
}

export default { PalaceKingdom, SharedStateEntry, ConsensusProposal, createPalaceKingdom };
