/**
 * @module deal-room-core-v2.test
 * @description Fixed comprehensive test suite for Deal Room Core v2.0
 * Tests all three modules: deal-room, context-escrow, consensus-engine
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import assert from 'assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// Import modules under test
import {
  initializeDealRooms,
  createRoom,
  inviteParticipant,
  processConsent,
  closeRoom,
  getRoom,
  listRooms,
  getAuditTrail,
  verifyRoomIntegrity,
  RoomState,
  ParticipantRole
} from '../src/deal-room.mjs';

import {
  initializeContextEscrow,
  escrowFact,
  queryFacts,
  getSubjectKnowledgeGraph,
  verifyEntryIntegrity,
  getAllFacts,
  getEscrowStats,
  EntryType,
  VerificationStatus
} from '../src/context-escrow.mjs';

import {
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
} from '../src/consensus-engine.mjs';

// Test configuration
const TEST_BASE_DIR = join(PROJECT_ROOT, 'memory', 'test-deal-rooms');

// Test utilities
let testResults = { passed: 0, failed: 0, errors: [] };

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    testResults.passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    testResults.failed++;
    testResults.errors.push({ name, error: err.message, stack: err.stack });
  }
}

async function setup() {
  try {
    await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
  } catch (e) {}
  
  await fs.mkdir(TEST_BASE_DIR, { recursive: true });
  
  await initializeDealRooms();
  await initializeContextEscrow();
  await initializeConsensusEngine();
}

async function cleanup() {
  try {
    await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
  } catch (e) {}
}

// ==================== DEAL ROOM TESTS ====================

async function runDealRoomTests() {
  console.log('\n📦 Deal Room Tests');
  console.log('==================');
  
  await test('createRoom: should create a room with PENDING_CONSENT state', async () => {
    const result = await createRoom(
      'Test negotiation',
      { topics: ['pricing', 'terms'], maxParticipants: 4 },
      { consensusRequired: 'unanimous', retentionDays: 30 },
      [
        { agentId: 'agent-a@test.com', role: ParticipantRole.NEGOTIATOR },
        { agentId: 'agent-b@test.com', role: ParticipantRole.REVIEWER }
      ],
      'creator-agent'
    );
    
    assert.ok(result.roomId.startsWith('dr_'));
    assert.strictEqual(result.status, RoomState.PENDING_CONSENT);
  });
  
  await test('createRoom: should reject invalid purpose', async () => {
    try {
      await createRoom(null, {}, {}, [], 'creator');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('Invalid purpose'));
    }
  });
  
  await test('createRoom: should reject empty participants', async () => {
    try {
      await createRoom('Test', {}, {}, [], 'creator');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('proposedParticipants'));
    }
  });
  
  let roomId = null;
  
  await test('createRoom: create room for further tests', async () => {
    const result = await createRoom(
      'Test room',
      { maxParticipants: 4 },
      {},
      [
        { agentId: 'test-a@test.com', role: ParticipantRole.NEGOTIATOR },
        { agentId: 'test-b@test.com', role: ParticipantRole.REVIEWER },
        { agentId: 'test-c@test.com', role: ParticipantRole.OBSERVER }
      ],
      'creator'
    );
    roomId = result.roomId;
  });
  
  await test('getRoom: should retrieve room manifest', async () => {
    const manifest = await getRoom(roomId);
    assert.strictEqual(manifest.roomId, roomId);
    assert.strictEqual(manifest.state, RoomState.PENDING_CONSENT);
  });
  
  await test('getRoom: should throw for non-existent room', async () => {
    try {
      await getRoom('dr_nonexistent');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('Room not found'));
    }
  });
  
  await test('inviteParticipant: should add pending consent', async () => {
    const manifest = await inviteParticipant(roomId, 'test-d@test.com', ParticipantRole.NEGOTIATOR, 'creator');
    assert.ok(manifest.pendingConsents.some(p => p.agentId === 'test-d@test.com'));
  });
  
  await test('inviteParticipant: should reject duplicate invitations', async () => {
    try {
      await inviteParticipant(roomId, 'test-d@test.com', ParticipantRole.NEGOTIATOR, 'creator');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('already has a pending'));
    }
  });
  
  await test('processConsent: should accept invitation', async () => {
    const result = await processConsent(roomId, 'test-a@test.com', true);
    assert.strictEqual(result.accepted, true);
  });
  
  await test('processConsent: should decline invitation', async () => {
    await processConsent(roomId, 'test-d@test.com', false);
    const manifest = await getRoom(roomId);
    assert.ok(!manifest.pendingConsents.some(p => p.agentId === 'test-d@test.com'));
  });
  
  await test('processConsent: should transition to ACTIVE when all consents received', async () => {
    await processConsent(roomId, 'test-b@test.com', true);
    await processConsent(roomId, 'test-c@test.com', true);
    const manifest = await getRoom(roomId);
    assert.strictEqual(manifest.state, RoomState.ACTIVE);
  });
  
  await test('processConsent: should throw for non-pending agent', async () => {
    try {
      await processConsent(roomId, 'unknown-agent', true);
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('No pending invitation'));
    }
  });
  
  await test('listRooms: should list rooms', async () => {
    const rooms = await listRooms();
    assert.ok(rooms.length >= 1);
  });
  
  await test('listRooms: should filter by state', async () => {
    const activeRooms = await listRooms({ state: RoomState.ACTIVE });
    assert.ok(activeRooms.some(r => r.roomId === roomId));
  });
  
  await test('getAuditTrail: should return audit entries', async () => {
    const audit = await getAuditTrail(roomId);
    assert.ok(Array.isArray(audit.entries));
    assert.ok(audit.entries.length >= 4);
    assert.strictEqual(audit.verified, true);
  });
  
  await test('verifyRoomIntegrity: should verify room integrity', async () => {
    const result = await verifyRoomIntegrity(roomId);
    assert.strictEqual(result.exists, true);
    assert.strictEqual(result.manifestValid, true);
    assert.strictEqual(result.auditChainVerified, true);
  });
  
  await test('closeRoom: should close an active room', async () => {
    const result = await closeRoom(roomId, 'Test complete', 'creator');
    assert.strictEqual(result.state, RoomState.CLOSED);
    
    const manifest = await getRoom(roomId);
    assert.ok(manifest.closedAt);
  });
  
  await test('closeRoom: should throw for already closed room', async () => {
    try {
      await closeRoom(roomId, 'Test', 'creator');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('already closed'));
    }
  });
}

// ==================== CONTEXT ESCROW TESTS ====================

async function runContextEscrowTests() {
  console.log('\n📦 Context Escrow Tests');
  console.log('=======================');
  
  let escrowRoomId = null;
  
  await test('setup: create room for escrow tests', async () => {
    const result = await createRoom(
      'Escrow test room',
      { maxParticipants: 2 },
      {},
      [
        { agentId: 'escrow-a@test.com', role: ParticipantRole.NEGOTIATOR },
        { agentId: 'escrow-b@test.com', role: ParticipantRole.REVIEWER }
      ],
      'test-creator'
    );
    
    escrowRoomId = result.roomId;
    await processConsent(escrowRoomId, 'escrow-a@test.com', true);
    await processConsent(escrowRoomId, 'escrow-b@test.com', true);
  });
  
  await test('escrowFact: should escrow a valid fact', async () => {
    const entry = {
      type: 'fact',
      subject: 'AcmeCorp',
      predicate: 'security_certification',
      object: 'SOC2 Type II',
      provenance: {
        source: 'document:security_review.pdf',
        extractedBy: 'escrow-a@test.com',
        extractedAt: new Date().toISOString(),
        confidence: 0.98
      }
    };
    
    const result = await escrowFact(escrowRoomId, entry, { readableBy: null }, 'escrow-a@test.com');
    assert.ok(result.entryId);
    assert.ok(result.verification.startsWith('sha256:'));
    assert.strictEqual(result.status, VerificationStatus.VERIFIED);
  });
  
  await test('escrowFact: should reject non-fact entries', async () => {
    const entry = {
      type: 'interpretation',
      subject: 'AcmeCorp',
      predicate: 'risk_level',
      object: 'low',
      provenance: {
        source: 'analysis',
        extractedBy: 'escrow-a@test.com',
        extractedAt: new Date().toISOString(),
        confidence: 0.8
      }
    };
    
    try {
      await escrowFact(escrowRoomId, entry, {}, 'escrow-a@test.com');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.strictEqual(err.code, 'INVALID_ENTRY_TYPE');
    }
  });
  
  await test('escrowFact: should reject entries with interpretation markers', async () => {
    const entry = {
      type: 'fact',
      subject: 'AcmeCorp',
      predicate: 'assessment',
      object: 'This is probably the best option',
      provenance: {
        source: 'document',
        extractedBy: 'escrow-a@test.com',
        extractedAt: new Date().toISOString(),
        confidence: 0.9
      }
    };
    
    try {
      await escrowFact(escrowRoomId, entry, {}, 'escrow-a@test.com');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('interpretation markers'));
    }
  });
  
  await test('escrowFact: should reject missing provenance', async () => {
    const entry = {
      type: 'fact',
      subject: 'Test',
      predicate: 'test',
      object: 'value'
    };
    
    try {
      await escrowFact(escrowRoomId, entry, {}, 'escrow-a@test.com');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('provenance'));
    }
  });
  
  await test('escrowFact: should escrow multiple facts', async () => {
    const facts = [
      { subject: 'CompanyA', predicate: 'revenue', object: 1000000 },
      { subject: 'CompanyB', predicate: 'employees', object: 500 },
      { subject: 'CompanyA', predicate: 'founded', object: '2010-01-15' }
    ];
    
    for (const fact of facts) {
      const entry = {
        type: 'fact',
        ...fact,
        provenance: {
          source: 'test-data',
          extractedBy: 'escrow-a@test.com',
          extractedAt: new Date().toISOString(),
          confidence: 0.95
        }
      };
      await escrowFact(escrowRoomId, entry, {}, 'escrow-a@test.com');
    }
  });
  
  await test('queryFacts: should query facts by subject', async () => {
    const facts = await queryFacts(escrowRoomId, 'CompanyA');
    assert.strictEqual(facts.length, 2);
    assert.ok(facts.every(f => f.subject === 'CompanyA'));
  });
  
  await test('queryFacts: should query facts by subject and predicate', async () => {
    const facts = await queryFacts(escrowRoomId, 'CompanyA', 'revenue');
    assert.strictEqual(facts.length, 1);
    assert.strictEqual(facts[0].object, 1000000);
  });
  
  await test('getSubjectKnowledgeGraph: should build knowledge graph', async () => {
    const kg = await getSubjectKnowledgeGraph(escrowRoomId, 'CompanyA');
    assert.strictEqual(kg.subject, 'CompanyA');
    assert.strictEqual(kg.factCount, 2);
    assert.ok(kg.predicates.revenue);
    assert.ok(kg.predicates.founded);
  });
  
  await test('verifyEntryIntegrity: should verify hash', async () => {
    const facts = await queryFacts(escrowRoomId, 'CompanyA', 'revenue');
    assert.strictEqual(facts.length, 1);
    const isValid = verifyEntryIntegrity(facts[0]);
    assert.strictEqual(isValid, true);
  });
  
  await test('getEscrowStats: should return statistics', async () => {
    const stats = await getEscrowStats(escrowRoomId);
    assert.ok(stats.totalFacts >= 4);
    assert.strictEqual(stats.integrity, 1.0);
  });
}

// ==================== CONSENSUS ENGINE TESTS ====================

async function runConsensusEngineTests() {
  console.log('\n📦 Consensus Engine Tests');
  console.log('==========================');
  
  await test('proposeDecision: should create a proposal', async () => {
    const room = await createRoom(
      'Consensus test room',
      { maxParticipants: 3 },
      { consensusRequired: 'unanimous' },
      [
        { agentId: 'c-a@test.com', role: ParticipantRole.NEGOTIATOR },
        { agentId: 'c-b@test.com', role: ParticipantRole.NEGOTIATOR },
        { agentId: 'c-c@test.com', role: ParticipantRole.REVIEWER }
      ],
      'creator'
    );
    await processConsent(room.roomId, 'c-a@test.com', true);
    await processConsent(room.roomId, 'c-b@test.com', true);
    await processConsent(room.roomId, 'c-c@test.com', true);
    
    const result = await proposeDecision(
      room.roomId,
      { type: 'contract_terms', terms: { price: 50000 } },
      'Test proposal',
      'c-a@test.com',
      { deadlineHours: 24 }
    );
    
    assert.ok(result.proposalId.startsWith('prop_'));
    assert.strictEqual(result.state, DecisionState.VOTING);
    assert.strictEqual(result.consensusMode, 'unanimous');
  });
  
  await test('proposeDecision: should reject unauthorized proposers', async () => {
    const room = await createRoom(
      'Reviewer room',
      { maxParticipants: 2 },
      {},
      [
        { agentId: 'rev-a@test.com', role: ParticipantRole.REVIEWER },
        { agentId: 'rev-b@test.com', role: ParticipantRole.REVIEWER }
      ],
      'creator'
    );
    await processConsent(room.roomId, 'rev-a@test.com', true);
    await processConsent(room.roomId, 'rev-b@test.com', true);
    
    try {
      await proposeDecision(room.roomId, { type: 'test' }, 'Test', 'rev-a@test.com', {});
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('permission'));
    }
  });
  
  await test('castVote: unanimous approval flow', async () => {
    const room = await createRoom(
      'Unanimous vote room',
      { maxParticipants: 3 },
      { consensusRequired: 'unanimous' },
      [
        { agentId: 'uni-a@test.com', role: ParticipantRole.NEGOTIATOR },
        { agentId: 'uni-b@test.com', role: ParticipantRole.NEGOTIATOR },
        { agentId: 'uni-c@test.com', role: ParticipantRole.REVIEWER }
      ],
      'creator'
    );
    await processConsent(room.roomId, 'uni-a@test.com', true);
    await processConsent(room.roomId, 'uni-b@test.com', true);
    await processConsent(room.roomId, 'uni-c@test.com', true);
    
    const prop = await proposeDecision(
      room.roomId,
      { type: 'terms' },
      'Test',
      'uni-a@test.com',
      {}
    );
    
    // First vote
    const result1 = await castVote(room.roomId, prop.proposalId, 'uni-a@test.com', VoteType.APPROVE, '');
    assert.strictEqual(result1.consensusReached, false);
    
    // Second vote
    const result2 = await castVote(room.roomId, prop.proposalId, 'uni-b@test.com', VoteType.APPROVE, '');
    assert.strictEqual(result2.consensusReached, false);
    
    // Third vote completes unanimous
    const result3 = await castVote(room.roomId, prop.proposalId, 'uni-c@test.com', VoteType.APPROVE, '');
    assert.strictEqual(result3.consensusReached, true);
    assert.strictEqual(result3.currentState, DecisionState.APPROVED_UNANIMOUS);
  });
  
  await test('castVote: unanimous rejection flow', async () => {
    const room = await createRoom(
      'Unanimous reject room',
      { maxParticipants: 3 },
      { consensusRequired: 'unanimous' },
      [
        { agentId: 'ur-a@test.com', role: ParticipantRole.NEGOTIATOR },
        { agentId: 'ur-b@test.com', role: ParticipantRole.NEGOTIATOR },
        { agentId: 'ur-c@test.com', role: ParticipantRole.REVIEWER }
      ],
      'creator'
    );
    await processConsent(room.roomId, 'ur-a@test.com', true);
    await processConsent(room.roomId, 'ur-b@test.com', true);
    await processConsent(room.roomId, 'ur-c@test.com', true);
    
    const prop = await proposeDecision(
      room.roomId,
      { type: 'terms' },
      'Test',
      'ur-a@test.com',
      {}
    );
    
    // One reject in unanimous mode rejects immediately
    const result = await castVote(room.roomId, prop.proposalId, 'ur-a@test.com', VoteType.APPROVE, '');
    const result2 = await castVote(room.roomId, prop.proposalId, 'ur-b@test.com', VoteType.REJECT, '');
    
    assert.strictEqual(result2.consensusReached, true);
    assert.strictEqual(result2.currentState, DecisionState.REJECTED);
  });
  
  await test('castVote: should reject duplicate votes', async () => {
    const room = await createRoom(
      'Duplicate vote room',
      { maxParticipants: 2 },
      {},
      [
        { agentId: 'dup-a@test.com', role: ParticipantRole.NEGOTIATOR },
        { agentId: 'dup-b@test.com', role: ParticipantRole.NEGOTIATOR }
      ],
      'creator'
    );
    await processConsent(room.roomId, 'dup-a@test.com', true);
    await processConsent(room.roomId, 'dup-b@test.com', true);
    
    const prop = await proposeDecision(room.roomId, { type: 'test' }, 'Test', 'dup-a@test.com', {});
    await castVote(room.roomId, prop.proposalId, 'dup-a@test.com', VoteType.APPROVE, '');
    
    try {
      await castVote(room.roomId, prop.proposalId, 'dup-a@test.com', VoteType.APPROVE, '');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('already voted'));
    }
  });
  
  await test('castVote: majority approval flow', async () => {
    const room = await createRoom(
      'Majority vote room',
      { maxParticipants: 4 },
      { consensusRequired: 'majority' },
      [
        { agentId: 'maj-a@test.com', role: ParticipantRole.NEGOTIATOR },
        { agentId: 'maj-b@test.com', role: ParticipantRole.NEGOTIATOR },
        { agentId: 'maj-c@test.com', role: ParticipantRole.REVIEWER },
        { agentId: 'maj-d@test.com', role: ParticipantRole.REVIEWER }
      ],
      'creator'
    );
    await processConsent(room.roomId, 'maj-a@test.com', true);
    await processConsent(room.roomId, 'maj-b@test.com', true);
    await processConsent(room.roomId, 'maj-c@test.com', true);
    await processConsent(room.roomId, 'maj-d@test.com', true);
    
    const prop = await proposeDecision(
      room.roomId,
      { type: 'terms' },
      'Test',
      'maj-a@test.com',
      {}
    );
    
    // With 4 participants, majority needs ceil(4/2) = 2 votes
    // First vote - not yet majority
    const result1 = await castVote(room.roomId, prop.proposalId, 'maj-a@test.com', VoteType.APPROVE, '');
    assert.strictEqual(result1.consensusReached, false);
    
    // Second vote reaches majority (2 votes, both approve)
    const result2 = await castVote(room.roomId, prop.proposalId, 'maj-b@test.com', VoteType.APPROVE, '');
    assert.strictEqual(result2.consensusReached, true);
    assert.strictEqual(result2.currentState, DecisionState.APPROVED_MAJORITY);
    
    // Try to cast a third vote - should fail since proposal is already resolved
    try {
      await castVote(room.roomId, prop.proposalId, 'maj-c@test.com', VoteType.APPROVE, '');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('not open for voting'));
    }
  });
  
  await test('withdrawProposal: should allow proposer to withdraw', async () => {
    const room = await createRoom(
      'Withdraw room',
      { maxParticipants: 2 },
      {},
      [
        { agentId: 'wd-a@test.com', role: ParticipantRole.NEGOTIATOR },
        { agentId: 'wd-b@test.com', role: ParticipantRole.NEGOTIATOR }
      ],
      'creator'
    );
    await processConsent(room.roomId, 'wd-a@test.com', true);
    await processConsent(room.roomId, 'wd-b@test.com', true);
    
    const prop = await proposeDecision(room.roomId, { type: 'test' }, 'Test', 'wd-a@test.com', {});
    const result = await withdrawProposal(room.roomId, prop.proposalId, 'wd-a@test.com');
    
    assert.strictEqual(result.state, DecisionState.WITHDRAWN);
  });
  
  await test('withdrawProposal: should reject non-proposer withdrawal', async () => {
    const room = await createRoom(
      'Non-withdraw room',
      { maxParticipants: 2 },
      {},
      [
        { agentId: 'nw-a@test.com', role: ParticipantRole.NEGOTIATOR },
        { agentId: 'nw-b@test.com', role: ParticipantRole.NEGOTIATOR }
      ],
      'creator'
    );
    await processConsent(room.roomId, 'nw-a@test.com', true);
    await processConsent(room.roomId, 'nw-b@test.com', true);
    
    const prop = await proposeDecision(room.roomId, { type: 'test' }, 'Test', 'nw-a@test.com', {});
    
    try {
      await withdrawProposal(room.roomId, prop.proposalId, 'nw-b@test.com');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('Only the proposer'));
    }
  });
}

// ==================== MAIN ====================

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   Deal Room Core v2.0 Test Suite                     ║');
  console.log('║   Mesh Memory Protocol (MMP)                         ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  try {
    await setup();
    
    await runDealRoomTests();
    await runContextEscrowTests();
    await runConsensusEngineTests();
    
    // Print summary
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║   Test Summary                                         ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║   ✓ Passed: ${testResults.passed.toString().padEnd(40)} ║`);
    console.log(`║   ✗ Failed: ${testResults.failed.toString().padEnd(40)} ║`);
    console.log(`║   Total:   ${(testResults.passed + testResults.failed).toString().padEnd(40)} ║`);
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    if (testResults.failed > 0) {
      console.log('\nFailed tests:');
      for (const err of testResults.errors) {
        console.log(`  - ${err.name}: ${err.error}`);
      }
    }
    
  } finally {
    await cleanup();
  }
  
  process.exit(testResults.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
