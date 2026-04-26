# mesh-memory Examples

Complete, runnable code examples for common mesh-memory operations.

---

## Example 1: Create a Deal Room and Reach Consensus

```javascript
import { createRoom, joinRoom, propose, vote, commit, closeRoom } from '../src/deal-room.mjs';

// Step 1: Create a deal room
const room = await createRoom(
  'Series A Term Sheet Negotiation',
  {
    topics: ['valuation', 'equity_split', 'board_seats'],
    maxParticipants: 4
  },
  {
    consensusRequired: 'unanimous',
    retentionDays: 2555
  },
  [
    { agentId: 'founder-agent', role: 'negotiator' },
    { agentId: 'vc-agent', role: 'negotiator' }
  ],
  'founder-agent'
);

console.log('Room created:', room.roomId);

// Step 2: Participants join
await joinRoom(room.roomId, 'vc-agent');

// Step 3: Founder proposes terms
const proposal = await propose(
  room.roomId,
  'founder-agent',
  {
    type: 'term_sheet',
    valuation: '$10M pre-money',
    equitySplit: '20% to investors',
    boardSeats: '2 founder, 1 investor'
  },
  { expiresIn: 86400 } // 24 hours
);

console.log('Proposal created:', proposal.proposalId);

// Step 4: VC votes in favor
await vote(room.roomId, proposal.proposalId, 'vc-agent', 'FOR');

// Step 5: Founder votes (reaches consensus)
await vote(room.roomId, proposal.proposalId, 'founder-agent', 'FOR');

// Step 6: Commit the decision
const decision = await commit(room.roomId, proposal.proposalId, 'founder-agent');

console.log('Consensus reached:', decision.status);

// Step 7: Close the room
await closeRoom(room.roomId, 'founder-agent', 'Term sheet agreed');
```

**Expected Output:**
```
Room created: room_a7f3d9e2
Proposal created: prop_8b2c4f1a
Consensus reached: COMMITTED
```

---

## Example 2: Cross-Agent Memory Sharing

```javascript
import { store, share, retrieve } from '../src/temporal-knowledge-graph.mjs';

// Step 1: Liz stores a fact in her memory
const fact = await store({
  agentId: 'liz-agent',
  type: 'project_context',
  content: {
    project: 'mesh-memory',
    phase: 7,
    status: 'governance_engine_complete'
  },
  tags: ['mesh-memory', 'governance', 'status'],
  ttl: 86400 * 30 // 30 days
});

console.log('Fact stored:', fact.id);

// Step 2: Liz shares with Ray (filtered by policy)
await share({
  fromAgentId: 'liz-agent',
  toAgentId: 'ray-agent',
  factId: fact.id,
  policy: 'founder_only', // ABAC policy
  blindGate: true // Include provenance, wait for Ray's interpretation
});

console.log('Fact shared with Ray');

// Step 3: Ray retrieves (only if policy allows)
const sharedFacts = await retrieve({
  agentId: 'ray-agent',
  sourceAgentId: 'liz-agent',
  tags: ['mesh-memory', 'status'],
  since: Date.now() - 86400000 // Last 24 hours
});

console.log('Retrieved', sharedFacts.length, 'shared facts');
```

**Expected Output:**
```
Fact stored: fact_9e4a2d8b
Fact shared with Ray
Retrieved 1 shared facts
```

---

## Example 3: Policy Enforcement Blocking Unauthorized Access

```javascript
import { enforcePolicy } from '../src/governance-integration.mjs';

// Define agent with low clearance
const agent = {
  id: 'junior-agent',
  role: 'reviewer',
  clearanceLevel: 1,
  timeOfDay: new Date().getHours()
};

// Attempt unauthorized action
const resource = 'deal-room:funding-negotiation';
const action = 'commit';

const result = await enforcePolicy(agent, resource, action);

if (result.decision === 'allow') {
  console.log('✅ Access granted');
} else if (result.decision === 'deny') {
  console.log('❌ Access denied:', result.reason);
} else if (result.decision === 'escalate') {
  console.log('⚠️ Escalation required:', result.escalationTarget);
}
```

**Expected Output:**
```
❌ Access denied: Agent lacks required clearance level (needs >= 2, has 1)
```

---

## Example 4: WORM Audit Logging

```javascript
import { logAudit, verifyChain } from '../src/audit-requirements.mjs';

// Step 1: Log a critical decision
const entry = await logAudit({
  agentId: 'founder-agent',
  action: 'commit',
  resource: 'deal-room:series-a-001',
  details: {
    proposalId: 'prop_8b2c4f1a',
    consensus: 'unanimous',
    participants: ['founder-agent', 'vc-agent']
  },
  severity: 'critical'
});

console.log('Audit entry:', entry.id);
console.log('Hash:', entry.entryHash);

// Step 2: Later, verify the audit chain
const verification = await verifyChain(entry.id);

if (verification.valid) {
  console.log('✅ Audit chain verified');
  console.log('Previous hash:', verification.previousHash);
  console.log('Signature valid:', verification.signatureValid);
} else {
  console.log('❌ Audit chain tampered!');
  console.log('Issues:', verification.issues);
}
```

**Expected Output:**
```
Audit entry: audit_7f3e9a2d
Hash: a3f7c2e8...
✅ Audit chain verified
Previous hash: b2e8d1c5...
Signature valid: true
```

---

## Example 5: A2A with Guarantee and Context

```javascript
import { sendWithGuarantee, sendWithContext } from '../src/hardened-a2a-client.mjs';

// Example 5a: Send with delivery guarantee
const result = await sendWithGuarantee({
  peerName: 'Ray',
  message: {
    type: 'task_request',
    task: 'Review Phase 7 code',
    priority: 'high',
    deadline: Date.now() + 86400000
  },
  guarantee: 'at_least_once', // or 'exactly_once'
  timeout: 30000, // 30 seconds
  retries: 3
});

if (result.delivered) {
  console.log('✅ Message delivered to Ray');
  console.log('Delivery confirmation:', result.confirmationId);
} else {
  console.log('❌ Delivery failed:', result.error);
  console.log('Attempts:', result.attempts);
}

// Example 5b: Send with context escrow
const contextResult = await sendWithContext({
  peerName: 'Woodhouse',
  message: {
    type: 'knowledge_share',
    topic: 'A2A protocol hardening'
  },
  context: {
    relevantFacts: ['fact_9e4a2d8b', 'fact_3c7b1f5e'],
    blindGate: true // Include provenance for independent assessment
  },
  escrow: {
    duration: 86400, // Context available for 24 hours
    requireAcknowledgment: true
  }
});

if (contextResult.delivered) {
  console.log('✅ Context shared with Woodhouse');
  console.log('Escrow ID:', contextResult.escrowId);
}
```

**Expected Output:**
```
✅ Message delivered to Ray
Delivery confirmation: conf_4a2d8f1c
✅ Context shared with Woodhouse
Escrow ID: escrow_9f3e7a2b
```

---

## Example 6: Governance-Enforced Deal Room

```javascript
import { 
  createGovernedRoom, 
  validateCompliance, 
  enforcePolicy 
} from '../src/governance-integration.mjs';

// Create a room with automatic governance
const room = await createGovernedRoom({
  purpose: 'Merger Negotiation',
  scope: { topics: ['valuation', 'assets', 'liabilities'] },
  policy: 'critical_deal', // References sample-policy-critical-ops.json
  participants: [
    { agentId: 'cfo-agent', role: 'negotiator', clearanceLevel: 3 },
    { agentId: 'legal-agent', role: 'reviewer', clearanceLevel: 2 }
  ],
  compliance: {
    requiresConsensus: 'unanimous',
    requiresAudit: true,
    blindGate: true
  }
});

// Attempt operation that needs validation
const proposal = {
  type: 'merger_terms',
  valuation: '$50M',
  structure: 'stock_purchase'
};

const compliance = await validateCompliance(proposal, {
  roomId: room.roomId,
  agentId: 'cfo-agent'
});

if (compliance.status === 'compliant') {
  console.log('✅ Proposal compliant');
  await propose(room.roomId, 'cfo-agent', proposal);
} else {
  console.log('❌ Compliance issues:');
  compliance.violations.forEach(v => {
    console.log(`  - ${v.rule}: ${v.severity}`);
  });
}
```

**Expected Output:**
```
✅ Proposal compliant
Proposal created: prop_merge_001
```

---

## Example 7: Cross-Room Intelligence (Phase 8 Preview)

```javascript
import { 
  detectPatterns, 
  identifyRisks, 
  benchmarkDeal 
} from '../src/cross-room-intelligence.mjs';

// Query anonymized patterns
const patterns = await detectPatterns({
  dealCategory: 'series_a',
  dimensions: {
    industry: 'saas',
    dealSizeRange: '5-10M'
  }
}, {
  epsilon: 1.0 // Privacy budget
});

console.log('Pattern insights:');
patterns.forEach(p => {
  console.log(`  - ${p.metric}: ${p.value} (confidence: ${p.confidence})`);
});

// Identify risks for current deal
const risks = await identifyRisks('room_series_a_001');

if (risks.length > 0) {
  console.log('⚠️ Risk signals detected:');
  risks.forEach(r => {
    console.log(`  - ${r.signalType}: ${r.level}`);
  });
}

// Benchmark against similar deals
const benchmark = await benchmarkDeal('room_series_a_001', {
  metrics: ['time_to_close', 'negotiation_rounds']
});

console.log(`Your deal is ${benchmark.percentile}th percentile for speed`);
```

**Expected Output:**
```
Pattern insights:
  - valuation_multiple: 6.2x ARR (confidence: 0.87)
  - time_to_close: 21 days (confidence: 0.82)
⚠️ Risk signals detected:
  - stall_risk: medium
Your deal is 85th percentile for speed
```

---

## Example 8: Workflow Orchestration (Phase 8 Preview)

```javascript
import { 
  createWorkflow, 
  advanceStage,
  getStageStatus 
} from '../src/deal-room-workflow.mjs';

// Create a multi-stage workflow
const workflow = await createWorkflow({
  templateId: 'wf_series_a_funding',
  participants: ['founder-agent', 'vc-agent'],
  config: {
    autoAdvance: true,
    notifyOnTransition: true
  }
}, 'founder-agent');

console.log('Workflow started:', workflow.id);
console.log('Current stage:', workflow.currentStage);

// Check if stage can advance
const status = await getStageStatus(workflow.id);
console.log('Gate conditions:');
status.gateStatus.conditions.forEach(c => {
  console.log(`  - ${c.id}: ${c.met ? '✅' : '❌'}`);
});

// Manually advance (or wait for auto-advance)
if (status.canAdvance) {
  await advanceStage(workflow.id, 'founder-agent');
  console.log('Advanced to next stage');
}
```

**Expected Output:**
```
Workflow started: wfi_abc123
Current stage: discovery
Gate conditions:
  - term_sheet_draft: ✅
  - consensus: ✅
  - time_minimum: ✅
Advanced to next stage
```

---

## Running Examples

```bash
# Clone the repo
git clone https://github.com/Better-Machine/mesh-memory.git
cd mesh-memory

# Install dependencies
npm install

# Run tests (includes examples)
npm test

# Run specific example
node examples/deal-room-consensus.mjs
```

---

## Next Steps

- Review [API_REFERENCE.md](./API_REFERENCE.md) for complete API documentation
- See [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) for step-by-step integration
- Read [AGENT_MIGRATION.md](./AGENT_MIGRATION.md) for migration from existing systems
- Check [DESIGN_PHASE8.md](../DESIGN_PHASE8.md) for upcoming features
