/**
 * @module consensus-engine
 * @description Consensus Engine for Mesh Memory Protocol v2.0
 * 
 * Decision Flow with support for unanimous and majority voting modes.
 * 
 * Security:
 * - ABAC: Role-based permissions (negotiator, reviewer, observer)
 * - Time-bound: Auto-close, deadline enforcement
 * - Cryptographic: SHA-256 hashes, hash chaining in audit logs
 * 
 * Decision states: PROPOSED → VOTING → [RESOLVED: APPROVED|REJECTED|EXPIRED]
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import { loadConfig } from '../config.mjs';

// Config and paths
let config = null;
let DEAL_ROOMS_DIR = 'memory/deal-rooms';

// Decision states
export const DecisionState = {
  PROPOSED: 'PROPOSED',
  VOTING: 'VOTING',
  APPROVED_UNANIMOUS: 'APPROVED_UNANIMOUS',
  APPROVED_MAJORITY: 'APPROVED_MAJORITY',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  WITHDRAWN: 'WITHDRAWN'
};

// Vote types
export const VoteType = {
  APPROVE: 'approve',
  REJECT: 'reject',
  ABSTAIN: 'abstain'
};

// Participant roles and their voting rights
export const RolePermissions = {
  NEGOTIATOR: { canPropose: true, canVote: true, canReview: true },
  REVIEWER: { canPropose: false, canVote: true, canReview: true },
  OBSERVER: { canPropose: false, canVote: false, canReview: false }
};

/**
 * Initialize consensus engine
 * @returns {Promise<void>}
 */
export async function initializeConsensusEngine() {
  config = loadConfig();
  
  const baseDir = config.memory?.baseDir || 'memory';
  DEAL_ROOMS_DIR = join(baseDir, 'deal-rooms');
  
  console.log(`[consensus-engine] Initialized`);
}

/**
 * Get the path to a room's decisions directory
 * @param {string} roomId
 * @returns {string}
 */
function getDecisionsDir(roomId) {
  return join(DEAL_ROOMS_DIR, roomId, 'decisions');
}

/**
 * Generate a unique proposal ID
 * @returns {string}
 */
function generateProposalId() {
  const uuid = randomUUID().replace(/-/g, '').slice(0, 16);
  return `prop_${uuid}`;
}

/**
 * Calculate SHA-256 hash
 * @param {Object} obj
 * @returns {string}
 */
function calculateHash(obj) {
  const data = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Write audit entry for decision
 * @param {string} roomId
 * @param {string} event
 * @param {string} actor
 * @param {Object} details
 */
async function writeAuditEntry(roomId, event, actor, details) {
  const auditDir = join(DEAL_ROOMS_DIR, roomId, 'audit');
  await fs.mkdir(auditDir, { recursive: true });
  
  const timestamp = new Date().toISOString();
  
  // Get previous hash
  let previousHash = '0';
  try {
    const files = await fs.readdir(auditDir);
    const logs = files.filter(f => f.endsWith('.log')).sort();
    if (logs.length > 0) {
      const content = await fs.readFile(join(auditDir, logs[logs.length - 1]), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]);
        previousHash = last.hash;
      }
    }
  } catch (e) { /* ignore */ }
  
  const entry = {
    sequence: Date.now(),
    timestamp,
    event,
    actor,
    details,
    previousHash
  };
  entry.hash = calculateHash(entry);
  
  const auditFile = `audit-${timestamp.slice(0, 10)}.log`;
  await fs.appendFile(join(auditDir, auditFile), JSON.stringify(entry) + '\n');
}

/**
 * Load room manifest
 * @param {string} roomId
 * @returns {Promise<Object>}
 */
async function loadRoomManifest(roomId) {
  const manifestPath = join(DEAL_ROOMS_DIR, roomId, 'manifest.json');
  const content = await fs.readFile(manifestPath, 'utf8');
  return JSON.parse(content);
}

/**
 * Get participant's role in room
 * @param {Object} manifest
 * @param {string} agentId
 * @returns {string|null}
 */
function getParticipantRole(manifest, agentId) {
  const participant = manifest.participants?.find(p => p.agentId === agentId);
  return participant?.role || null;
}

/**
 * Check if participant can vote
 * @param {Object} manifest
 * @param {string} agentId
 * @returns {boolean}
 */
function canVote(manifest, agentId) {
  const role = getParticipantRole(manifest, agentId);
  if (!role) return false;
  return RolePermissions[role.toUpperCase()]?.canVote || false;
}

/**
 * Check if participant can propose
 * @param {Object} manifest
 * @param {string} agentId
 * @returns {boolean}
 */
function canPropose(manifest, agentId) {
  const role = getParticipantRole(manifest, agentId);
  if (!role) return false;
  return RolePermissions[role.toUpperCase()]?.canPropose || false;
}

/**
 * Get active participant count
 * @param {Object} manifest
 * @returns {number}
 */
function getActiveParticipantCount(manifest) {
  return manifest.participants?.filter(p => p.status === 'active').length || 0;
}

/**
 * Propose a decision
 * @param {string} roomId - Room ID
 * @param {Object} proposal - Proposal content {type, terms, rationale}
 * @param {string} rationale - Why this proposal
 * @param {string} proposerAgentId - Agent proposing
 * @param {Object} options - {deadline, requiredVotes}
 * @returns {Promise<Object>} Proposal record
 */
export async function proposeDecision(roomId, proposal, rationale, proposerAgentId, options = {}) {
  // Load room manifest
  const manifest = await loadRoomManifest(roomId);
  
  // Check room is active
  if (manifest.state !== 'ACTIVE') {
    throw new Error(`Room is not active: ${manifest.state}`);
  }
  
  // Check proposer has permission
  if (!canPropose(manifest, proposerAgentId)) {
    throw new Error(`Agent ${proposerAgentId} does not have permission to propose`);
  }
  
  // Generate proposal ID
  const proposalId = generateProposalId();
  const now = new Date().toISOString();
  
  // Calculate deadline
  const deadlineHours = options.deadlineHours || 24;
  const deadline = new Date(Date.now() + deadlineHours * 60 * 60 * 1000).toISOString();
  
  // Get consensus mode from room policy
  const consensusMode = manifest.policy.consensusRequired || 'unanimous';
  
  // Build proposal record
  const proposalRecord = {
    proposalId,
    roomId,
    state: DecisionState.PROPOSED,
    proposal: {
      type: proposal.type || 'custom',
      content: proposal,
      rationale
    },
    proposer: proposerAgentId,
    proposedAt: now,
    deadline,
    consensusMode,
    votes: [],
    requiredVotes: options.requiredVotes || null,  // null = all participants
    voteThreshold: options.voteThreshold || null,    // null = unanimous/majority based on mode
    finalizedAt: null,
    auditHash: null
  };
  
  // Calculate audit hash
  proposalRecord.auditHash = calculateHash(proposalRecord);
  
  // Ensure decisions directory exists
  const decisionsDir = getDecisionsDir(roomId);
  await fs.mkdir(decisionsDir, { recursive: true });
  
  // Save proposal
  const proposalPath = join(decisionsDir, `${proposalId}.json`);
  await fs.writeFile(proposalPath, JSON.stringify(proposalRecord, null, 2));
  
  // Write audit
  await writeAuditEntry(roomId, 'PROPOSAL_CREATED', proposerAgentId, {
    proposalId,
    type: proposal.type || 'custom',
    consensusMode,
    deadline
  });
  
  // Transition to VOTING state
  proposalRecord.state = DecisionState.VOTING;
  await fs.writeFile(proposalPath, JSON.stringify(proposalRecord, null, 2));
  
  console.log(`[consensus-engine] Proposal ${proposalId} created in room ${roomId} (${consensusMode} mode)`);
  
  return {
    proposalId,
    state: proposalRecord.state,
    deadline,
    consensusMode,
    requiredVotes: getActiveParticipantCount(manifest)
  };
}

/**
 * Cast a vote on a proposal
 * @param {string} roomId
 * @param {string} proposalId
 * @param {string} agentId
 * @param {string} vote - approve | reject | abstain
 * @param {string} reason - Vote rationale
 * @returns {Promise<Object>} Updated proposal status
 */
export async function castVote(roomId, proposalId, agentId, vote, reason) {
  // Validate vote type
  if (!Object.values(VoteType).includes(vote)) {
    throw new Error(`Invalid vote: ${vote}. Must be one of: ${Object.values(VoteType).join(', ')}`);
  }
  
  // Load room manifest
  const manifest = await loadRoomManifest(roomId);
  
  // Check room is active
  if (manifest.state !== 'ACTIVE') {
    throw new Error(`Room is not active: ${manifest.state}`);
  }
  
  // Check voter has permission
  if (!canVote(manifest, agentId)) {
    throw new Error(`Agent ${agentId} does not have voting permission`);
  }
  
  // Load proposal
  const decisionsDir = getDecisionsDir(roomId);
  const proposalPath = join(decisionsDir, `${proposalId}.json`);
  
  let proposalRecord;
  try {
    const content = await fs.readFile(proposalPath, 'utf8');
    proposalRecord = JSON.parse(content);
  } catch (err) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }
  
  // Check proposal state
  if (proposalRecord.state !== DecisionState.VOTING) {
    throw new Error(`Proposal is not open for voting: ${proposalRecord.state}`);
  }
  
  // Check deadline
  if (new Date() > new Date(proposalRecord.deadline)) {
    throw new Error('Voting deadline has passed');
  }
  
  // Check if already voted
  const existingVote = proposalRecord.votes.find(v => v.agentId === agentId);
  if (existingVote) {
    throw new Error(`Agent ${agentId} has already voted on this proposal`);
  }
  
  // Record vote
  const voteRecord = {
    agentId,
    vote,
    reason,
    timestamp: new Date().toISOString()
  };
  
  proposalRecord.votes.push(voteRecord);
  
  // Save updated proposal
  await fs.writeFile(proposalPath, JSON.stringify(proposalRecord, null, 2));
  
  // Write audit
  await writeAuditEntry(roomId, 'VOTE_CAST', agentId, {
    proposalId,
    vote,
    reason
  });
  
  console.log(`[consensus-engine] ${agentId} voted ${vote} on proposal ${proposalId}`);
  
  // Check if consensus reached (auto-finalize if reached)
  const result = await checkConsensus(roomId, proposalId, true);
  
  return {
    proposalId,
    voteRecorded: true,
    consensusReached: result.reached,
    currentState: result.state,
    votesCast: proposalRecord.votes.length,
    totalRequired: getActiveParticipantCount(manifest)
  };
}

/**
 * Check if consensus has been reached
 * @param {string} roomId
 * @param {string} proposalId
 * @param {boolean} autoFinalize - Whether to auto-finalize if consensus reached
 * @returns {Promise<Object>} Consensus check result
 */
export async function checkConsensus(roomId, proposalId, autoFinalize = false) {
  // Load proposal
  const decisionsDir = getDecisionsDir(roomId);
  const proposalPath = join(decisionsDir, `${proposalId}.json`);
  
  let proposalRecord;
  try {
    const content = await fs.readFile(proposalPath, 'utf8');
    proposalRecord = JSON.parse(content);
  } catch (err) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }
  
  // Load room manifest
  const manifest = await loadRoomManifest(roomId);
  const activeCount = getActiveParticipantCount(manifest);
  
  // Check if already resolved
  if (proposalRecord.state !== DecisionState.VOTING) {
    return {
      reached: true,
      state: proposalRecord.state,
      proposalId
    };
  }
  
  // Check deadline
  if (new Date() > new Date(proposalRecord.deadline)) {
    // Check if we have enough votes to resolve
    if (proposalRecord.votes.length > 0) {
      const approveCount = proposalRecord.votes.filter(v => v.vote === VoteType.APPROVE).length;
      const rejectCount = proposalRecord.votes.filter(v => v.vote === VoteType.REJECT).length;
      
      if (approveCount > rejectCount) {
        proposalRecord.state = DecisionState.APPROVED_MAJORITY;
      } else {
        proposalRecord.state = DecisionState.REJECTED;
      }
    } else {
      proposalRecord.state = DecisionState.EXPIRED;
    }
    
    proposalRecord.finalizedAt = new Date().toISOString();
    await fs.writeFile(proposalPath, JSON.stringify(proposalRecord, null, 2));
    
    await writeAuditEntry(roomId, 'PROPOSAL_EXPIRED', 'system', {
      proposalId,
      finalState: proposalRecord.state
    });
    
    return {
      reached: true,
      state: proposalRecord.state,
      proposalId,
      reason: 'deadline_expired'
    };
  }
  
  // Count votes
  const votes = proposalRecord.votes;
  const approveCount = votes.filter(v => v.vote === VoteType.APPROVE).length;
  const rejectCount = votes.filter(v => v.vote === VoteType.REJECT).length;
  const abstainCount = votes.filter(v => v.vote === VoteType.ABSTAIN).length;
  const votedCount = votes.length - abstainCount;
  
  const mode = proposalRecord.consensusMode;
  let reached = false;
  let newState = null;
  
  if (mode === 'unanimous') {
    // Unanimous: all participants must approve
    if (approveCount === activeCount && votedCount === activeCount) {
      reached = true;
      newState = DecisionState.APPROVED_UNANIMOUS;
    } else if (rejectCount > 0) {
      // Any rejection blocks unanimous approval
      reached = true;
      newState = DecisionState.REJECTED;
    }
  } else if (mode === 'majority') {
    // Majority: more than half of voting participants approve
    if (votedCount >= Math.ceil(activeCount / 2)) {
      if (approveCount > rejectCount) {
        reached = true;
        newState = DecisionState.APPROVED_MAJORITY;
      } else if (rejectCount >= approveCount) {
        reached = true;
        newState = DecisionState.REJECTED;
      }
    }
  }
  
  if (reached && newState && autoFinalize) {
    proposalRecord.state = newState;
    proposalRecord.finalizedAt = new Date().toISOString();
    await fs.writeFile(proposalPath, JSON.stringify(proposalRecord, null, 2));
    
    await writeAuditEntry(roomId, 'PROPOSAL_RESOLVED', 'system', {
      proposalId,
      finalState: newState,
      votes: { approve: approveCount, reject: rejectCount, abstain: abstainCount }
    });
  }
  
  return {
    reached,
    state: reached ? newState : DecisionState.VOTING,
    proposalId,
    votes: {
      approve: approveCount,
      reject: rejectCount,
      abstain: abstainCount,
      total: activeCount
    },
    needed: mode === 'unanimous' ? activeCount : Math.ceil(activeCount / 2)
  };
}

/**
 * Finalize (commit) a decision
 * @param {string} roomId
 * @param {string} proposalId
 * @returns {Promise<Object>} Finalized decision
 */
export async function commitDecision(roomId, proposalId) {
  // Load proposal
  const decisionsDir = getDecisionsDir(roomId);
  const proposalPath = join(decisionsDir, `${proposalId}.json`);
  
  let proposalRecord;
  try {
    const content = await fs.readFile(proposalPath, 'utf8');
    proposalRecord = JSON.parse(content);
  } catch (err) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }
  
  // Check if still voting
  if (proposalRecord.state !== DecisionState.VOTING) {
    throw new Error(`Proposal is already finalized: ${proposalRecord.state}`);
  }
  
  // Check if consensus reached
  const check = await checkConsensus(roomId, proposalId, false);
  if (!check.reached) {
    throw new Error('Consensus not yet reached');
  }
  
  // Finalize
  proposalRecord.state = check.state;
  proposalRecord.finalizedAt = new Date().toISOString();
  proposalRecord.finalAuditHash = calculateHash(proposalRecord);
  
  // Save finalized record
  await fs.writeFile(proposalPath, JSON.stringify(proposalRecord, null, 2));
  
  // Write to audit trail
  await writeAuditEntry(roomId, 'DECISION_COMMITTED', 'system', {
    proposalId,
    finalState: proposalRecord.state,
    votes: check.votes
  });
  
  console.log(`[consensus-engine] Decision ${proposalId} committed: ${proposalRecord.state}`);
  
  return {
    proposalId,
    roomId,
    state: proposalRecord.state,
    finalizedAt: proposalRecord.finalizedAt,
    votes: proposalRecord.votes,
    proposal: proposalRecord.proposal,
    auditHash: proposalRecord.finalAuditHash
  };
}

/**
 * Withdraw a proposal (only by proposer, only before votes)
 * @param {string} roomId
 * @param {string} proposalId
 * @param {string} agentId
 * @returns {Promise<Object>}
 */
export async function withdrawProposal(roomId, proposalId, agentId) {
  // Load proposal
  const decisionsDir = getDecisionsDir(roomId);
  const proposalPath = join(decisionsDir, `${proposalId}.json`);
  
  let proposalRecord;
  try {
    const content = await fs.readFile(proposalPath, 'utf8');
    proposalRecord = JSON.parse(content);
  } catch (err) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }
  
  // Check ownership
  if (proposalRecord.proposer !== agentId) {
    throw new Error('Only the proposer can withdraw a proposal');
  }
  
  // Check state
  if (proposalRecord.state !== DecisionState.VOTING && proposalRecord.state !== DecisionState.PROPOSED) {
    throw new Error(`Cannot withdraw proposal in state: ${proposalRecord.state}`);
  }
  
  // Check if any votes cast
  if (proposalRecord.votes.length > 0) {
    throw new Error('Cannot withdraw: votes have already been cast');
  }
  
  // Withdraw
  proposalRecord.state = DecisionState.WITHDRAWN;
  proposalRecord.withdrawnAt = new Date().toISOString();
  
  await fs.writeFile(proposalPath, JSON.stringify(proposalRecord, null, 2));
  
  await writeAuditEntry(roomId, 'PROPOSAL_WITHDRAWN', agentId, { proposalId });
  
  return {
    proposalId,
    state: DecisionState.WITHDRAWN,
    withdrawnAt: proposalRecord.withdrawnAt
  };
}

/**
 * Get proposal details
 * @param {string} roomId
 * @param {string} proposalId
 * @returns {Promise<Object>}
 */
export async function getProposal(roomId, proposalId) {
  const decisionsDir = getDecisionsDir(roomId);
  const proposalPath = join(decisionsDir, `${proposalId}.json`);
  
  try {
    const content = await fs.readFile(proposalPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }
}

/**
 * List proposals in a room
 * @param {string} roomId
 * @param {Object} filters - {state, agentId}
 * @returns {Promise<Array>}
 */
export async function listProposals(roomId, filters = {}) {
  const decisionsDir = getDecisionsDir(roomId);
  const proposals = [];
  
  try {
    const files = await fs.readdir(decisionsDir);
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      try {
        const content = await fs.readFile(join(decisionsDir, file), 'utf8');
        const proposal = JSON.parse(content);
        
        // Apply filters
        if (filters.state && proposal.state !== filters.state) continue;
        if (filters.agentId && proposal.proposer !== filters.agentId) continue;
        
        proposals.push({
          proposalId: proposal.proposalId,
          state: proposal.state,
          proposer: proposal.proposer,
          proposedAt: proposal.proposedAt,
          deadline: proposal.deadline,
          voteCount: proposal.votes.length,
          consensusMode: proposal.consensusMode
        });
      } catch (e) {
        // Skip malformed
      }
    }
  } catch (e) {
    // No proposals yet
  }
  
  return proposals.sort((a, b) => new Date(b.proposedAt) - new Date(a.proposedAt));
}

/**
 * Get voting statistics for a room
 * @param {string} roomId
 * @returns {Promise<Object>}
 */
export async function getVotingStats(roomId) {
  const proposals = await listProposals(roomId);
  
  const stats = {
    total: proposals.length,
    byState: {},
    unanimous: 0,
    majority: 0,
    active: 0
  };
  
  for (const p of proposals) {
    stats.byState[p.state] = (stats.byState[p.state] || 0) + 1;
    if (p.consensusMode === 'unanimous') stats.unanimous++;
    if (p.consensusMode === 'majority') stats.majority++;
    if (p.state === DecisionState.VOTING) stats.active++;
  }
  
  return stats;
}

// Export all functions
export default {
  initializeConsensusEngine,
  proposeDecision,
  castVote,
  checkConsensus,
  commitDecision,
  withdrawProposal,
  getProposal,
  listProposals,
  getVotingStats,
  DecisionState,
  VoteType,
  RolePermissions
};
