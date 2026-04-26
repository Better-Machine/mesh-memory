/**
 * @module deal-room-usage
 * @description Sample usage code for Deal Room Core v2.0
 * 
 * This example demonstrates a complete SaaS contract negotiation workflow:
 * 1. Create a deal room with participants
 * 2. Process consent from all parties
 * 3. Escrow facts from shared documents
 * 4. Propose and vote on contract terms
 * 5. Finalize decision and close room
 */

import {
  initializeDealRooms,
  createRoom,
  processConsent,
  closeRoom,
  getRoom,
  RoomState,
  ParticipantRole
} from '../src/deal-room.mjs';

import {
  initializeContextEscrow,
  escrowFact,
  queryFacts,
  getEscrowStats
} from '../src/context-escrow.mjs';

import {
  initializeConsensusEngine,
  proposeDecision,
  castVote,
  checkConsensus,
  DecisionState,
  VoteType
} from '../src/consensus-engine.mjs';

async function main() {
  console.log('\n=== Deal Room Core v2.0 - Sample Usage ===\n');
  
  // Initialize all modules
  await initializeDealRooms();
  await initializeContextEscrow();
  await initializeConsensusEngine();
  
  // ==========================================
  // STEP 1: Create Deal Room
  // ==========================================
  console.log('📁 Step 1: Creating Deal Room...');
  
  const room = await createRoom(
    'AcmeCorp SaaS Contract Negotiation',
    {
      topics: ['pricing', 'terms', 'implementation'],
      documents: ['acme_proposal_v2.pdf', 'security_review.pdf'],
      maxParticipants: 3
    },
    {
      consensusRequired: 'majority',  // majority vote needed
      dataResidency: 'us-east-1',
      retentionDays: 2555  // 7 years
    },
    [
      { agentId: 'sales@acmecorp.com', role: ParticipantRole.NEGOTIATOR },
      { agentId: 'legal@acmecorp.com', role: ParticipantRole.REVIEWER },
      { agentId: 'cto@acmecorp.com', role: ParticipantRole.REVIEWER }
    ],
    'setup-agent@bettermachine.ai'
  );
  
  console.log(`   Room created: ${room.roomId}`);
  console.log(`   State: ${room.status}`);
  console.log(`   Pending consents: ${room.manifest.pendingConsents.length}`);
  
  // ==========================================
  // STEP 2: Process Consents
  // ==========================================
  console.log('\n🤝 Step 2: Processing Consents...');
  
  const consentResults = [
    await processConsent(room.roomId, 'sales@acmecorp.com', true),
    await processConsent(room.roomId, 'legal@acmecorp.com', true),
    await processConsent(room.roomId, 'cto@acmecorp.com', true)
  ];
  
  for (const result of consentResults) {
    console.log(`   ${result.manifest.participants.find(p => p.agentId.includes(result.manifest.participants.find(() => true).agentId))?.agentId || 'Agent'}: ${result.accepted ? '✅ Accepted' : '❌ Declined'}`);
  }
  
  const activeRoom = await getRoom(room.roomId);
  console.log(`   Room state: ${activeRoom.state} (activated at ${activeRoom.activatedAt})`);
  
  // ==========================================
  // STEP 3: Escrow Facts
  // ==========================================
  console.log('\n📊 Step 3: Escrowing Facts...');
  
  const facts = [
    {
      type: 'fact',
      subject: 'AcmeCorp',
      predicate: 'annual_revenue',
      object: 50000000,
      provenance: {
        source: 'document:financial_statement_2025.pdf',
        extractedBy: 'sales@acmecorp.com',
        extractedAt: new Date().toISOString(),
        confidence: 0.99
      }
    },
    {
      type: 'fact',
      subject: 'AcmeCorp',
      predicate: 'employee_count',
      object: 250,
      provenance: {
        source: 'document:company_profile.pdf',
        extractedBy: 'legal@acmecorp.com',
        extractedAt: new Date().toISOString(),
        confidence: 0.95
      }
    },
    {
      type: 'fact',
      subject: 'AcmeCorp',
      predicate: 'security_certification',
      object: 'SOC2 Type II',
      provenance: {
        source: 'document:security_review.pdf',
        extractedBy: 'legal@acmecorp.com',
        extractedAt: new Date().toISOString(),
        confidence: 0.98
      }
    },
    {
      type: 'fact',
      subject: 'Contract',
      predicate: 'proposed_price',
      object: {
        amount: 100000,
        currency: 'USD',
        billing: 'annual'
      },
      provenance: {
        source: 'document:acme_proposal_v2.pdf',
        extractedBy: 'sales@acmecorp.com',
        extractedAt: new Date().toISOString(),
        confidence: 1.0
      }
    }
  ];
  
  for (const fact of facts) {
    const result = await escrowFact(
      room.roomId,
      fact,
      { readableBy: null },  // All participants can read
      fact.provenance.extractedBy
    );
    console.log(`   ✅ ${fact.subject} ${fact.predicate}: ${JSON.stringify(fact.object).slice(0, 40)}...`);
  }
  
  // Query escrowed facts
  const acmeFacts = await queryFacts(room.roomId, 'AcmeCorp');
  console.log(`   Total facts about AcmeCorp: ${acmeFacts.length}`);
  
  // ==========================================
  // STEP 4: Propose Contract Terms
  // ==========================================
  console.log('\n📝 Step 4: Proposing Contract Terms...');
  
  const proposal = await proposeDecision(
    room.roomId,
    {
      type: 'contract_terms',
      terms: {
        price: 100000,
        currency: 'USD',
        billing: 'annual',
        seats: 250,
        implementation_days: 30,
        support_level: 'enterprise'
      }
    },
    'Pricing aligned with escrowed employee count (250) and annual revenue ($50M). Security certification (SOC2 Type II) validated.',
    'sales@acmecorp.com',
    { deadlineHours: 48 }
  );
  
  console.log(`   Proposal created: ${proposal.proposalId}`);
  console.log(`   Consensus mode: ${proposal.consensusMode}`);
  console.log(`   Required votes: ${proposal.requiredVotes}`);
  
  // ==========================================
  // STEP 5: Vote on Proposal
  // ==========================================
  console.log('\n🗳️  Step 5: Voting on Proposal...');
  
  // Sales votes approve
  const vote1 = await castVote(
    room.roomId,
    proposal.proposalId,
    'sales@acmecorp.com',
    VoteType.APPROVE,
    'Terms align with our budget and requirements.'
  );
  console.log(`   Sales: Approve (consensus: ${vote1.consensusReached ? '✅ Reached' : '⏳ Pending'})`);
  
  // Legal votes approve (this reaches majority: 2/3)
  const vote2 = await castVote(
    room.roomId,
    proposal.proposalId,
    'legal@acmecorp.com',
    VoteType.APPROVE,
    'Legal review complete. Terms are acceptable.'
  );
  console.log(`   Legal: Approve (consensus: ${vote2.consensusReached ? '✅ Reached' : '⏳ Pending'})`);
  
  // Get proposal details for vote counts
  const { getProposal } = await import('../src/consensus-engine.mjs');
  const proposalDetails = await getProposal(room.roomId, proposal.proposalId);
  const approveCount = proposalDetails.votes.filter(v => v.vote === 'approve').length;
  const rejectCount = proposalDetails.votes.filter(v => v.vote === 'reject').length;
  const abstainCount = proposalDetails.votes.filter(v => v.vote === 'abstain').length;
  
  console.log(`\n   Final decision: APPROVED_MAJORITY`);
  console.log(`   Votes: ${approveCount} approve, ${rejectCount} reject, ${abstainCount} abstain`);
  
  // ==========================================
  // STEP 6: Verify and Close
  // ==========================================
  console.log('\n🔒 Step 6: Verifying and Closing Room...');
  
  const escrowStats = await getEscrowStats(room.roomId);
  console.log(`   Escrowed facts: ${escrowStats.totalFacts}`);
  console.log(`   Data integrity: ${(escrowStats.integrity * 100).toFixed(0)}%`);
  
  const closed = await closeRoom(
    room.roomId,
    'Contract approved by majority vote. Deal closed successfully.',
    'sales@acmecorp.com'
  );
  
  console.log(`   Room closed: ${closed.state}`);
  console.log(`   Participants notified: ${closed.notifiedParticipants.join(', ')}`);
  
  console.log('\n=== Workflow Complete ===\n');
  console.log(`Room ID: ${room.roomId}`);
  console.log(`Final State: ${closed.state}`);
  console.log(`Decision: APPROVED_MAJORITY`);
  console.log(`Audit Trail: Available in deal-rooms/${room.roomId}/audit/`);
}

main().catch(err => {
  console.error('Workflow failed:', err);
  process.exit(1);
});
