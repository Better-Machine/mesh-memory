/**
 * Consensus Protocol — Blind-Gate Style Multi-Agent Consensus
 * 
 * Implements decentralized consensus via HTTP (not chat) following Erik's
 * blind-gate pattern: proposals → votes → resolution.
 * 
 * @version 1.0.0
 * @module consensus-protocol
 */

import { randomUUID, createHash } from 'crypto';

/**
 * Proposal States
 */
export const ProposalState = {
  PENDING: 'pending',      // Proposal created, awaiting votes
  VOTING: 'voting',        // Voting in progress
  APPROVED: 'approved',    // Quorum reached, approved
  REJECTED: 'rejected',    // Quorum reached, rejected
  EXPIRED: 'expired',      // Voting period ended without quorum
  WITHDRAWN: 'withdrawn'   // Proposer withdrew
};

/**
 * Vote Types
 */
export const VoteType = {
  YES: 'yes',
  NO: 'no',
  ABSTAIN: 'abstain'
};

/**
 * Consensus Protocol
 * Blind-gate style: HTTP-based voting, not chat coordination
 */
export class ConsensusProtocol {
  constructor(options = {}) {
    this.nodeId = options.nodeId || process.env.NODE_ID || 'unknown';
    this.orgId = options.orgId || process.env.ORG_ID || 'default';
    
    // Consensus configuration
    this.quorumRatio = options.quorumRatio || 0.51; // 51% default
    this.votingPeriod = options.votingPeriod || 300000; // 5 minutes default
    this.minVoters = options.minVoters || 2; // Minimum distinct voters
    
    // Storage
    this.proposals = new Map();      // proposalId -> Proposal
    this.votes = new Map();          // proposalId -> Map(voterId -> Vote)
    this.myVotes = new Map();        // proposalId -> my vote
    
    // Peer coordination
    this.peers = new Map();          // peerId -> endpoint
    this.httpClient = options.httpClient || null; // HTTP client for voting
    
    // Event handlers
    this.handlers = new Map();
    
    // Statistics
    this.stats = {
      proposalsCreated: 0,
      proposalsApproved: 0,
      proposalsRejected: 0,
      votesCast: 0
    };
  }

  /**
   * Register a peer that can participate in consensus
   */
  registerPeer(peerId, endpoint, metadata = {}) {
    this.peers.set(peerId, {
      id: peerId,
      endpoint,
      orgId: metadata.orgId || this.orgId,
      weight: metadata.weight || 1,
      lastVote: null
    });
  }

  /**
   * Create a new proposal
   */
  createProposal(data) {
    const proposal = {
      id: randomUUID(),
      type: data.type || 'general',
      title: data.title,
      description: data.description,
      action: data.action, // The actual action to take if approved
      proposer: this.nodeId,
      orgId: this.orgId,
      state: ProposalState.PENDING,
      createdAt: Date.now(),
      votingStartedAt: null,
      votingEndsAt: null,
      resolvedAt: null,
      result: null,
      quorum: data.quorum || this._calculateQuorum(),
      requiredVoters: data.requiredVoters || this.minVoters,
      allowedVoters: data.allowedVoters || null, // null = all peers
      blockedPeers: new Set(data.blockedPeers || []),
      metadata: data.metadata || {}
    };

    // Calculate hash for integrity
    proposal.hash = this._hashProposal(proposal);
    
    this.proposals.set(proposal.id, proposal);
    this.votes.set(proposal.id, new Map());
    this.stats.proposalsCreated++;
    
    this._emit('proposal:created', { proposalId: proposal.id, proposal });
    
    return proposal;
  }

  /**
   * Start voting on a proposal
   */
  startVoting(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error('Proposal not found');
    if (proposal.state !== ProposalState.PENDING) {
      throw new Error(`Cannot start voting from state: ${proposal.state}`);
    }

    proposal.state = ProposalState.VOTING;
    proposal.votingStartedAt = Date.now();
    proposal.votingEndsAt = proposal.votingStartedAt + this.votingPeriod;

    this._emit('proposal:voting', { proposalId, proposal });
    
    // Schedule expiration check
    setTimeout(() => this._checkExpiration(proposalId), this.votingPeriod + 1000);
    
    return proposal;
  }

  /**
   * Cast a vote on a proposal (local)
   */
  castVote(proposalId, voteType, reason = '') {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error('Proposal not found');
    if (proposal.state !== ProposalState.VOTING) {
      throw new Error(`Cannot vote on proposal in state: ${proposal.state}`);
    }
    if (Date.now() > proposal.votingEndsAt) {
      throw new Error('Voting period has ended');
    }
    if (proposal.blockedPeers.has(this.nodeId)) {
      throw new Error('This node is blocked from voting on this proposal');
    }
    if (proposal.allowedVoters && !proposal.allowedVoters.includes(this.nodeId)) {
      throw new Error('This node is not in the allowed voters list');
    }

    const vote = {
      proposalId,
      voterId: this.nodeId,
      orgId: this.orgId,
      type: voteType,
      reason,
      timestamp: Date.now(),
      hash: null
    };

    vote.hash = this._hashVote(vote);
    
    const proposalVotes = this.votes.get(proposalId);
    proposalVotes.set(this.nodeId, vote);
    this.myVotes.set(proposalId, vote);
    this.stats.votesCast++;

    this._emit('vote:cast', { proposalId, vote });
    
    // Check if we've reached consensus
    this._evaluateConsensus(proposalId);
    
    // Propagate vote to other peers
    this._propagateVote(proposalId, vote);
    
    return vote;
  }

  /**
   * Receive a vote from another peer (HTTP endpoint handler)
   */
  receiveVote(proposalId, vote) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return { accepted: false, reason: 'proposal_not_found' };
    }
    if (proposal.state !== ProposalState.VOTING) {
      return { accepted: false, reason: 'not_voting', state: proposal.state };
    }
    if (Date.now() > proposal.votingEndsAt) {
      return { accepted: false, reason: 'voting_ended' };
    }
    if (proposal.blockedPeers.has(vote.voterId)) {
      return { accepted: false, reason: 'voter_blocked' };
    }
    if (proposal.allowedVoters && !proposal.allowedVoters.includes(vote.voterId)) {
      return { accepted: false, reason: 'voter_not_allowed' };
    }

    // Verify vote hash
    const expectedHash = this._hashVote(vote);
    if (vote.hash !== expectedHash) {
      return { accepted: false, reason: 'invalid_hash' };
    }

    const proposalVotes = this.votes.get(proposalId);
    proposalVotes.set(vote.voterId, vote);

    this._emit('vote:received', { proposalId, vote });
    
    // Check consensus
    this._evaluateConsensus(proposalId);
    
    return { accepted: true, proposalId };
  }

  /**
   * Get current voting status for a proposal
   */
  getVotingStatus(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return null;

    const proposalVotes = this.votes.get(proposalId) || new Map();
    const votes = Array.from(proposalVotes.values());
    
    // Calculate totals directly without recursive calls
    const yesVotes = votes.filter(v => v.type === VoteType.YES).length;
    const noVotes = votes.filter(v => v.type === VoteType.NO).length;
    const abstainVotes = votes.filter(v => v.type === VoteType.ABSTAIN).length;
    const totalVotes = yesVotes + noVotes;
    
    // Calculate quorum directly
    const quorumReached = totalVotes >= proposal.quorum;
    const canResolve = quorumReached || (Date.now() >= proposal.votingEndsAt && totalVotes >= proposal.requiredVoters);
    
    return {
      proposal,
      votes: {
        total: votes.length,
        yes: yesVotes,
        no: noVotes,
        abstain: abstainVotes,
        byVoter: votes.reduce((acc, v) => {
          acc[v.voterId] = v.type;
          return acc;
        }, {})
      },
      progress: {
        timeRemaining: Math.max(0, proposal.votingEndsAt - Date.now()),
        quorumReached,
        canResolve
      }
    };
  }

  /**
   * Force resolve a proposal (emergency override)
   */
  emergencyResolve(proposalId, result, reason) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error('Proposal not found');
    
    proposal.state = result ? ProposalState.APPROVED : ProposalState.REJECTED;
    proposal.resolvedAt = Date.now();
    proposal.result = {
      approved: result,
      reason,
      emergency: true,
      resolver: this.nodeId
    };

    this._emit('proposal:resolved', { 
      proposalId, 
      proposal,
      emergency: true 
    });
    
    return proposal;
  }

  /**
   * Withdraw a proposal (only proposer can do this)
   */
  withdrawProposal(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error('Proposal not found');
    if (proposal.proposer !== this.nodeId) {
      throw new Error('Only the proposer can withdraw');
    }
    if (proposal.state !== ProposalState.PENDING && proposal.state !== ProposalState.VOTING) {
      throw new Error(`Cannot withdraw proposal in state: ${proposal.state}`);
    }

    proposal.state = ProposalState.WITHDRAWN;
    proposal.resolvedAt = Date.now();
    
    this._emit('proposal:withdrawn', { proposalId, proposal });
    return proposal;
  }

  /**
   * List all proposals (with optional filter)
   */
  listProposals(filter = {}) {
    let results = Array.from(this.proposals.values());
    
    if (filter.state) {
      results = results.filter(p => p.state === filter.state);
    }
    if (filter.type) {
      results = results.filter(p => p.type === filter.type);
    }
    if (filter.proposer) {
      results = results.filter(p => p.proposer === filter.proposer);
    }
    if (filter.orgId) {
      results = results.filter(p => p.orgId === filter.orgId);
    }
    if (filter.active) {
      results = results.filter(p => 
        p.state === ProposalState.PENDING || p.state === ProposalState.VOTING
      );
    }
    
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get protocol statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeProposals: this.listProposals({ active: true }).length,
      pendingVotes: this.listProposals({ state: ProposalState.VOTING }).length,
      registeredPeers: this.peers.size
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

  _calculateQuorum() {
    const totalWeight = Array.from(this.peers.values())
      .reduce((sum, p) => sum + p.weight, 1); // +1 for self
    return Math.max(1, Math.ceil(totalWeight * this.quorumRatio));
  }

  _isQuorumReached(proposalId) {
    const proposalVotes = this.votes.get(proposalId) || new Map();
    const votes = Array.from(proposalVotes.values());
    const totalVotes = votes.filter(v => v.type === VoteType.YES || v.type === VoteType.NO).length;
    
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return false;
    
    return totalVotes >= proposal.quorum;
  }

  _canResolve(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.state !== ProposalState.VOTING) return false;
    
    const proposalVotes = this.votes.get(proposalId) || new Map();
    const votes = Array.from(proposalVotes.values());
    const totalVotes = votes.filter(v => v.type === VoteType.YES || v.type === VoteType.NO).length;
    
    // Can resolve if quorum reached or time expired
    return this._isQuorumReached(proposalId) || 
           (Date.now() > proposal.votingEndsAt && totalVotes >= proposal.requiredVoters);
  }

  _evaluateConsensus(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.state !== ProposalState.VOTING) return;

    const proposalVotes = this.votes.get(proposalId) || new Map();
    const votes = Array.from(proposalVotes.values());
    const totalVotes = votes.filter(v => v.type === VoteType.YES || v.type === VoteType.NO).length;
    
    // Check if we can resolve
    const quorumReached = this._isQuorumReached(proposalId);
    const canResolve = quorumReached || (Date.now() >= proposal.votingEndsAt && totalVotes >= proposal.requiredVoters);
    
    if (!canResolve) return;

    // Determine result
    const yesWeight = this._calculateWeightedVotes(proposalId, VoteType.YES);
    const noWeight = this._calculateWeightedVotes(proposalId, VoteType.NO);
    
    const approved = yesWeight > noWeight;
    
    proposal.state = approved ? ProposalState.APPROVED : ProposalState.REJECTED;
    proposal.resolvedAt = Date.now();
    proposal.result = {
      approved,
      yesVotes: votes.filter(v => v.type === VoteType.YES).length,
      noVotes: votes.filter(v => v.type === VoteType.NO).length,
      abstainVotes: votes.filter(v => v.type === VoteType.ABSTAIN).length,
      yesWeight,
      noWeight,
      totalVoters: votes.length
    };

    if (approved) {
      this.stats.proposalsApproved++;
    } else {
      this.stats.proposalsRejected++;
    }

    this._emit('proposal:resolved', { proposalId, proposal });
  }

  _calculateWeightedVotes(proposalId, voteType) {
    const proposalVotes = this.votes.get(proposalId) || new Map();
    let weight = 0;
    
    for (const [voterId, vote] of proposalVotes) {
      if (vote.type === voteType) {
        const peer = this.peers.get(voterId);
        weight += peer ? peer.weight : 1;
      }
    }
    
    return weight;
  }

  _checkExpiration(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.state !== ProposalState.VOTING) return;
    
    if (Date.now() >= proposal.votingEndsAt) {
      const status = this.getVotingStatus(proposalId);
      const totalVotes = status.votes.yes + status.votes.no + status.votes.abstain;
      
      if (totalVotes < proposal.requiredVoters) {
        proposal.state = ProposalState.EXPIRED;
        proposal.resolvedAt = Date.now();
        proposal.result = { expired: true, reason: 'insufficient_voters' };
        this._emit('proposal:expired', { proposalId, proposal });
      } else {
        // Enough voters, evaluate consensus
        this._evaluateConsensus(proposalId);
      }
    }
  }

  async _propagateVote(proposalId, vote) {
    if (!this.httpClient) return;
    
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return;

    // Send vote to all peers that should participate
    const promises = [];
    for (const [peerId, peer] of this.peers) {
      if (peerId === this.nodeId) continue;
      if (proposal.blockedPeers.has(peerId)) continue;
      if (proposal.allowedVoters && !proposal.allowedVoters.includes(peerId)) continue;
      
      promises.push(
        this._sendVoteToPeer(peer, proposalId, vote)
          .catch(err => {
            console.error(`Failed to send vote to ${peerId}:`, err.message);
          })
      );
    }
    
    await Promise.allSettled(promises);
  }

  async _sendVoteToPeer(peer, proposalId, vote) {
    if (!this.httpClient || !peer.endpoint) return;
    
    const url = `${peer.endpoint}/kingdom/consensus/vote`;
    return this.httpClient.post(url, {
      proposalId,
      vote
    });
  }

  _hashProposal(proposal) {
    const data = JSON.stringify({
      type: proposal.type,
      title: proposal.title,
      description: proposal.description,
      action: proposal.action,
      proposer: proposal.proposer,
      createdAt: proposal.createdAt,
      quorum: proposal.quorum
    });
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  _hashVote(vote) {
    const data = JSON.stringify({
      proposalId: vote.proposalId,
      voterId: vote.voterId,
      type: vote.type,
      timestamp: vote.timestamp
    });
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
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
 * Create a new Consensus Protocol instance
 */
export function createConsensusProtocol(options = {}) {
  return new ConsensusProtocol(options);
}

export default ConsensusProtocol;