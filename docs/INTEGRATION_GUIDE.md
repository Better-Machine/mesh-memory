# mesh-memory Integration Guide

Step-by-step integration guide for adding mesh-memory to your OpenClaw agent.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [Deal Room Integration](#deal-room-integration)
5. [A2A Hardening](#a2a-hardening)
6. [Governance Integration](#governance-integration)
7. [Testing](#testing)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Requirements

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | ≥18.0.0 | ES modules support required |
| SQLite | ≥3.35.0 | For TKG and queue persistence |
| A2A Gateway | Latest | Required for peer communication |

### Peer Dependencies

```bash
# A2A Gateway must be installed
openclaw plugins install a2a-gateway

# Verify installation
openclaw plugins list | grep "A2A Gateway"
```

### System Resources

- **Disk**: ~100MB for mesh-memory + database files
- **Memory**: ~50MB RAM at runtime
- **Network**: Outbound HTTP(S) for peer A2A endpoints

---

## Installation

### Step 1: Clone and Install

```bash
# Navigate to your agent workspace
cd ~/.openclaw/workspace

# Clone mesh-memory
git clone https://github.com/Better-Machine/mesh-memory.git

# Install dependencies
cd mesh-memory
npm install
```

### Step 2: Configure

```bash
# Copy configuration template
cp mesh-memory.config.json mesh-memory.config.local.json

# Edit your local config
nano mesh-memory.config.local.json
```

**Minimal config.local.json:**
```json
{
  "agentId": "YourAgentName",
  "receiverToken": "your-secret-token",
  "port": 18803,
  "memory": {
    "baseDir": "memory"
  },
  "peers": [
    {
      "name": "Ray",
      "url": "http://192.168.50.22:18800",
      "token": "ray-token-here"
    },
    {
      "name": "Woodhouse",
      "url": "http://192.168.50.24:18800",
      "token": "woodhouse-token-here"
    }
  ]
}
```

### Step 3: Initialize Storage

```bash
# Create required directories
mkdir -p memory/deal-rooms
mkdir -p memory/a2a-queue
mkdir -p memory/mesh/lessons

# Set permissions (Linux/macOS)
chmod -R 755 memory/
```

---

## Quick Start

### Minimal Working Example

Create `quickstart.mjs`:

```javascript
import { 
  initializeA2AIntegration, 
  send,
  registerPeer 
} from './src/a2a-integration.mjs';
import { A2AClient } from '~/.openclaw/extensions/a2a-gateway/src/client.ts';

async function main() {
  // Initialize A2A client
  const a2aClient = new A2AClient();
  
  // Initialize mesh-memory
  await initializeA2AIntegration({
    sendProvider: (peer, msg, opts) => a2aClient.sendMessage(peer, msg, opts)
  });
  
  // Register peers (optional, uses openclaw.json if not set)
  await registerPeer({
    name: 'Ray',
    agentCardUrl: 'http://192.168.50.22:18800/.well-known/agent.json',
    baseUrl: 'http://192.168.50.22:18800',
    auth: { type: 'bearer', token: process.env.RAY_TOKEN },
    skills: ['mesh-memory'],
    versions: ['2.0']
  });
  
  // Send a message
  const result = await send('Ray', {
    kind: 'message',
    text: 'Hello from mesh-memory!'
  }, { guarantee: true, context: true });
  
  console.log('Sent:', result.deliveryId);
  console.log('Status:', result.status);
}

main().catch(console.error);
```

Run it:

```bash
node quickstart.mjs
```

**Expected output:**
```
[a2a-integration] Initialized
Sent: dlv_a1b2c3d4...
Status: sent
```

---

## Deal Room Integration

### Step 1: Initialize Deal Rooms

```javascript
import { 
  initializeDealRooms,
  createRoom,
  processConsent,
  closeRoom 
} from './src/deal-room.mjs';
import { 
  initializeConsensusEngine,
  proposeDecision,
  castVote,
  commitDecision 
} from './src/consensus-engine.mjs';

async function setupCollaboration() {
  // Initialize systems
  await initializeDealRooms();
  await initializeConsensusEngine();
  
  // Create a room
  const room = await createRoom(
    'Q2 Roadmap Planning',
    { 
      topics: ['roadmap', 'priorities', 'features'],
      documents: [],
      maxParticipants: 5
    },
    {
      consensusRequired: 'majority',
      retentionDays: 365
    },
    [
      { agentId: 'Liz', role: 'negotiator' },
      { agentId: 'Ray', role: 'negotiator' },
      { agentId: 'Woodhouse', role: 'reviewer' }
    ],
    'Liz'  // Creator
  );
  
  console.log('Room created:', room.roomId);
  // Room is now PENDING_CONSENT
  
  return room;
}
```

### Step 2: Handle Consent Flow

```javascript
async function handleConsents(roomId) {
  // Each agent must accept their invitation
  
  // Ray accepts
  await processConsent(roomId, 'Ray', true);
  console.log('Ray accepted');
  
  // Woodhouse accepts
  await processConsent(roomId, 'Woodhouse', true);
  console.log('Woodhouse accepted');
  
  // Liz accepts (creator must also accept)
  const result = await processConsent(roomId, 'Liz', true);
  
  console.log('Room state:', result.state);
  // Room is now ACTIVE
}
```

### Step 3: Propose and Vote

```javascript
async function makeDecision(roomId) {
  // Liz proposes
  const proposal = await proposeDecision(
    roomId,
    {
      type: 'feature-priority',
      terms: {
        features: [
          { name: 'TKG Query Engine', priority: 'high' },
          { name: 'Audit Export', priority: 'medium' }
        ]
      }
    },
    'Based on user feedback, prioritize TKG queries',
    'Liz',
    { deadlineHours: 48 }
  );
  
  console.log('Proposal:', proposal.proposalId);
  
  // Others vote
  await castVote(roomId, proposal.proposalId, 'Ray', 'approve', 'Agreed');
  await castVote(roomId, proposal.proposalId, 'Woodhouse', 'approve', 'Makes sense');
  
  // Check consensus (auto-finalizes if reached)
  const result = await checkConsensus(roomId, proposal.proposalId, true);
  
  if (result.reached) {
    console.log('Decision:', result.state);
    // APPROVED_MAJORITY
  }
}
```

### Step 4: Close Room

```javascript
async function finishCollaboration(roomId) {
  // Close when done
  await closeRoom(roomId, 'Roadmap finalized', 'Liz');
  
  // Room is now CLOSED
  // Audit trail preserved
}
```

---

## A2A Hardening

### Before (Raw A2A)

```javascript
// Fire-and-forget - message can be lost
const result = await a2aClient.sendMessage('Ray', message);
if (!result.ok) {
  // Too late, message is lost
  console.error('Send failed');
}
```

### After (Hardened A2A)

```javascript
import { 
  initializeA2AIntegration,
  send,
  getDeliveryStatus,
  retryFailed,
  on 
} from './src/a2a-integration.mjs';

// 1. Initialize with your A2A client
await initializeA2AIntegration({
  sendProvider: (peer, msg, opts) => a2aClient.sendMessage(peer, msg, opts)
});

// 2. Subscribe to delivery events
on('deliveryStatus', (deliveryId, status, details) => {
  console.log(`[${status}] ${deliveryId}`);
});

// 3. Send with guarantees
const result = await send('Ray', message, {
  guarantee: true,    // WAL queue + retry
  context: true,      // Session continuity
  timeout: 30000
});

// 4. Check status later
const status = await getDeliveryStatus(result.deliveryId);
console.log(status.status);  // 'pending' | 'delivered' | 'failed'

// 5. Retry failed messages
const retried = await retryFailed({ limit: 10 });
```

### Circuit Breaker Pattern

```javascript
import { getCircuitState } from './src/a2a-reliability-layer.mjs';

// Check if peer is healthy
const state = getCircuitState('Ray');
if (state.state === 'open') {
  console.warn('Circuit open - temporarily unavailable');
  // Queue messages, they'll retry when circuit closes
}
```

### Dead Letter Queue

```javascript
import { getDeadLetterQueue } from './src/a2a-integration.mjs';

// Check failed messages
const failed = await getDeadLetterQueue({ limit: 100 });
console.log(`${failed.length} messages in DLQ`);

// Inspect failures
failed.forEach(f => {
  console.log(f.deliveryId, f.lastError, f.attempts);
});

// Retry specific peer
await retryFailed({ peer: 'Ray', limit: 50 });
```

---

## Governance Integration

### Step 1: Initialize Governance

```javascript
import { initializeGovernance } from './src/governance-integration.mjs';

await initializeGovernance({
  autoBlockNonCompliant: true,
  escalateOnViolation: true,
  auditAllOperations: true,
  defaultRetentionDays: 90
});
```

### Step 2: Enforce Policy

```javascript
import { enforcePolicy } from './src/governance-integration.mjs';

// Define agent attributes
const agent = {
  agentId: 'Liz',
  roles: ['admin', 'negotiator'],
  clearance: 'high',
  department: 'engineering'
};

// Check before operation
const policyResult = await enforcePolicy(
  agent,
  'room://dr_abc123',
  'write',
  { roomId: 'dr_abc123', timestamp: new Date().toISOString() }
);

if (!policyResult.allowed) {
  console.error('Access denied:', policyResult.reason);
  return;
}

// Proceed with operation
```

### Step 3: Validate Compliance

```javascript
import { validateCompliance } from './src/governance-integration.mjs';

// Validate a decision
const compliance = await validateCompliance({
  type: 'data-export',
  agentId: 'Liz',
  resource: 'room://dr_abc123',
  dataSensitivity: 'high'
});

if (!compliance.compliant) {
  console.error('Compliance violations:');
  compliance.results
    .filter(r => r.outcome === 'NON_COMPLIANT')
    .forEach(r => console.log(`  - ${r.ruleName}: ${r.remediation}`));
}
```

### Step 4: Audit Logging

```javascript
import { logAudit, AuditAction, AuditSeverity } from './src/governance-integration.mjs';

// Log every significant operation
await logAudit({
  agentId: 'Liz',
  action: AuditAction.ACCESS,
  resource: 'room://dr_abc123',
  details: {
    operation: 'consensus-reached',
    proposalId: 'prop_xyz789',
    finalState: 'APPROVED_MAJORITY'
  },
  severity: AuditSeverity.INFO,
  roomId: 'dr_abc123'
});
```

### Step 5: Full Governance Check

```javascript
import { checkGovernance } from './src/governance-integration.mjs';

// Combined policy + compliance + audit
const governance = await checkGovernance({
  agent: { agentId: 'Liz', roles: ['admin'] },
  resource: 'room://dr_abc123',
  action: 'commit-decision',
  decision: { type: 'deployment', environment: 'production' },
  context: { roomId: 'dr_abc123' }
});

if (!governance.allowed) {
  console.error('Blocked:', governance.policy.reason);
  console.error('Compliance:', governance.compliance?.outcome);
}
```

---

## Testing

### Running the Test Suite

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/deal-room-core.test.mjs

# Run with coverage
npm test -- --coverage

# Verbose output
npm test -- --verbose
```

### Writing Integration Tests

```javascript
// tests/my-integration.test.mjs
import { test, expect } from 'vitest';
import { initializeDealRooms, createRoom } from '../src/deal-room.mjs';

test('create room and verify state', async () => {
  await initializeDealRooms();
  
  const room = await createRoom(
    'Test Room',
    { topics: ['test'], maxParticipants: 2 },
    { consensusRequired: 'unanimous' },
    [{ agentId: 'Liz', role: 'negotiator' }],
    'Liz'
  );
  
  expect(room.roomId).toMatch(/^dr_/);
  expect(room.status).toBe('PENDING_CONSENT');
});
```

### Health Check Script

```javascript
// health-check.mjs
import { 
  initializeA2AIntegration,
  discoverPeers,
  getStats 
} from './src/a2a-integration.mjs';
import { initializeGovernance, getGovernanceReport } from './src/governance-integration.mjs';

async function healthCheck() {
  console.log('=== Mesh Memory Health Check ===\n');
  
  // A2A status
  await initializeA2AIntegration({ sendProvider: null });
  const a2aStats = await getStats();
  console.log('A2A Stats:', JSON.stringify(a2aStats, null, 2));
  
  // Peer health
  const peers = await discoverPeers({ healthyOnly: true });
  console.log(`\nHealthy peers: ${peers.length}`);
  peers.forEach(p => console.log(`  - ${p.name}`));
  
  // Governance status
  await initializeGovernance();
  const report = await getGovernanceReport();
  console.log(`\nCompliance rate: ${report.compliance.complianceRate}%`);
  console.log(`Active policies: ${report.policies.active}`);
}

healthCheck().catch(console.error);
```

---

## Troubleshooting

### Common Issues

#### "Unknown peer: Ray"

**Cause:** Peer not registered or not in config.

**Solution:**
```javascript
// Option 1: Register explicitly
await registerPeer({
  name: 'Ray',
  agentCardUrl: 'http://192.168.50.22:18800/.well-known/agent.json',
  baseUrl: 'http://192.168.50.22:18800',
  auth: { type: 'bearer', token: 'token' },
  skills: ['mesh-memory'],
  versions: ['2.0']
});

// Option 2: Check config.local.json
// Ensure peers array is populated
```

#### "Circuit breaker open for peer"

**Cause:** Peer has failed 5+ consecutive requests.

**Solution:**
```javascript
import { getCircuitState } from './src/a2a-reliability-layer.mjs';

const state = getCircuitState('Ray');
console.log('Circuit state:', state);
// Wait 60s for cooldown, or check peer health manually

// Verify peer is actually reachable
curl http://192.168.50.22:18800/health
```

#### "Governance system not initialized"

**Cause:** Forgot to call initializeGovernance().

**Solution:**
```javascript
import { initializeGovernance } from './src/governance-integration.mjs';

// Always initialize before use
await initializeGovernance();

// Then use enforcement functions
```

#### Messages stuck in queue

**Cause:** A2A health daemon not running.

**Solution:**
```bash
# Start the health daemon
node src/a2a-health-daemon.mjs &

# Or add to crontab for persistent operation
crontab -e
# * * * * * cd /path/to/mesh-memory && node src/a2a-health-daemon.mjs >> logs/health.log 2>&1
```

#### SQLite errors (database locked)

**Cause:** Concurrent access to SQLite database.

**Solution:**
```javascript
// Ensure single writer - use queue for concurrent ops
// Or use WAL mode (enabled by default in mesh-memory)

// Check database permissions
ls -la memory/a2a-queue/
```

### Debug Logging

Enable debug output:

```javascript
// Set environment variable
process.env.MESH_MEMORY_LOG_LEVEL = 'debug';

// Or in config
{
  "logLevel": "debug"
}
```

### Performance Tuning

```javascript
// Reduce audit retention for faster queries
await initializeGovernance({
  defaultRetentionDays: 30  // Down from 90
});

// Batch operations
const results = await Promise.all(
  peers.map(p => send(p.name, message))
);

// Circuit breaker tuning
const state = getCircuitState('Ray');
// Default: 5 failures, 60s cooldown
```

### Getting Help

1. Check existing issues: https://github.com/Better-Machine/mesh-memory/issues
2. Review ADRs in `docs/decisions/`
3. Check architecture docs: `docs/ARCHITECTURE.md`
4. Enable debug logging and share logs

---

## Next Steps

- [Agent Migration Guide](./AGENT_MIGRATION.md) — Specific steps for Ray and Woodhouse
- [Code Examples](./EXAMPLES.md) — Complete working examples
- [API Reference](./API_REFERENCE.md) — Full API documentation

---

*Last updated: 2026-04-26*
