# Agent Migration Guide: Ray & Woodhouse

Tailored migration guide for integrating mesh-memory into existing OpenClaw agents.

---

## Table of Contents

1. [Current State Assessment](#current-state-assessment)
2. [Target State](#target-state)
3. [Migration Steps](#migration-steps)
4. [Code Examples: Before → After](#code-examples-before--after)
5. [Testing Checklist](#testing-checklist)
6. [Rollback Plan](#rollback-plan)

---

## Current State Assessment

### What You Have Now

As Ray or Woodhouse, you currently have:

| Component | Current State | Limitation |
|-----------|---------------|--------------|
| **A2A Messaging** | Direct A2A Gateway calls | Fire-and-forget, no delivery guarantees |
| **Session Memory** | LCM summaries | Lost on restart, not searchable |
| **Collaboration** | Manual coordination | No structured deal rooms or consensus |
| **Audit Trail** | None | No accountability or compliance tracking |
| **Cross-Agent Context** | Manual briefing | Context lost between messages |

### Typical Current Code Pattern

```javascript
// Your current A2A code (Ray or Woodhouse)
import { A2AClient } from '~/.openclaw/extensions/a2a-gateway/src/client.ts';

const a2aClient = new A2AClient();

// Fire-and-forget messaging
async function notifyPeer(peer, message) {
  const result = await a2aClient.sendMessage(peer, {
    kind: 'message',
    text: message
  });
  
  if (!result.ok) {
    console.error('Send failed:', result.error);
    // Message is lost - no recovery
  }
}

// Manual collaboration
async function collaborateWithLiz(topic) {
  await notifyPeer('Liz', `Let's discuss ${topic}`);
  // No structured room, no consensus mechanism
}
```

---

## Target State

### What You'll Have After Migration

| Component | Target State | Benefit |
|-----------|------------|---------|
| **A2A Messaging** | Hardened with guarantees | At-least-once delivery, circuit breaker, DLQ |
| **Session Memory** | TKG + LCM bridge | Persistent, searchable, temporal queries |
| **Collaboration** | Deal rooms + consensus | Structured, auditable, policy-enforced |
| **Audit Trail** | WORM with hash chaining | Compliance-ready, tamper-evident |
| **Cross-Agent Context** | Auto-briefing | Context preserved across sessions |

### Post-Migration Code Pattern

```javascript
// After migration
import { 
  initializeA2AIntegration,
  send,
  getDeliveryStatus 
} from './mesh-memory/src/a2a-integration.mjs';
import {
  initializeGovernance,
  enforcePolicy
} from './mesh-memory/src/governance-integration.mjs';
import {
  initializeDealRooms,
  createRoom,
  processConsent
} from './mesh-memory/src/deal-room.mjs';

// Initialized systems with full guarantees
async function notifyPeer(peer, message) {
  const result = await send(peer, {
    kind: 'message',
    text: message
  }, { guarantee: true, context: true });
  
  // Message is queued, tracked, retried if needed
  console.log('Delivery ID:', result.deliveryId);
  
  // Check status anytime
  const status = await getDeliveryStatus(result.deliveryId);
  return status;
}

// Structured collaboration
async function collaborateWithLiz(topic) {
  const room = await createRoom(
    `Discuss: ${topic}`,
    { topics: [topic], maxParticipants: 2 },
    { consensusRequired: 'majority' },
    [{ agentId: 'Liz', role: 'negotiator' }],
    'Ray'  // or 'Woodhouse'
  );
  
  // Structured, policy-enforced, auditable
  return room;
}
```

---

## Migration Steps

### Phase 1: Preparation (30 minutes)

#### Step 1.1: Backup Current Setup

```bash
# Create backup of your agent workspace
cd ~/.openclaw/workspace
tar -czf backup-$(date +%Y%m%d).tar.gz \
  openclaw.json \
  memory/ \
  --exclude='node_modules' \
  --exclude='.git'

# Verify backup
cd ~
tar -tzf workspace/backup-$(date +%Y%m%d).tar.gz | head -20
```

#### Step 1.2: Clone mesh-memory

```bash
cd ~/.openclaw/workspace

# Clone the repository
git clone https://github.com/Better-Machine/mesh-memory.git

# Navigate and install
cd mesh-memory
npm install

# Verify installation
ls -la src/*.mjs | head -10
```

#### Step 1.3: Create Local Config

```bash
cp mesh-memory.config.json mesh-memory.config.local.json

# Edit with your agent details
nano mesh-memory.config.local.json
```

**For Ray (<LAN_IP_RAY>):**
```json
{
  "agentId": "Ray",
  "receiverToken": "${RAY_RECEIVER_TOKEN}",
  "port": 18800,
  "memory": {
    "baseDir": "memory"
  },
  "peers": [
    {
      "name": "Liz",
      "url": "http://<LAN_IP_LIZ>:18803",
      "token": "${LIZ_TOKEN}"
    },
    {
      "name": "Woodhouse",
      "url": "http://<LAN_IP_WOODHOUSE>:18800",
      "token": "${WOODHOUSE_TOKEN}"
    }
  ],
  "governance": {
    "autoBlockNonCompliant": true,
    "defaultRetentionDays": 90
  }
}
```

**For Woodhouse (<LAN_IP_WOODHOUSE>):**
```json
{
  "agentId": "Woodhouse",
  "receiverToken": "${WOODHOUSE_RECEIVER_TOKEN}",
  "port": 18800,
  "memory": {
    "baseDir": "memory"
  },
  "peers": [
    {
      "name": "Liz",
      "url": "http://<LAN_IP_LIZ>:18803",
      "token": "${LIZ_TOKEN}"
    },
    {
      "name": "Ray",
      "url": "http://<LAN_IP_RAY>:18800",
      "token": "${RAY_TOKEN}"
    }
  ],
  "governance": {
    "autoBlockNonCompliant": true,
    "defaultRetentionDays": 90
  }
}
```

### Phase 2: Core Integration (1 hour)

#### Step 2.1: Create Integration Module

Create `~/workspace/mesh-bridge.mjs`:

```javascript
/**
 * Mesh Memory Bridge for Ray/Woodhouse
 * Wraps raw A2A with hardened mesh-memory layer
 */

import { 
  initializeA2AIntegration,
  send as meshSend,
  registerPeer,
  getDeliveryStatus
} from './mesh-memory/src/a2a-integration.mjs';
import {
  initializeGovernance,
  enforcePolicy
} from './mesh-memory/src/governance-integration.mjs';
import {
  initializeDealRooms
} from './mesh-memory/src/deal-room.mjs';

let initialized = false;

/**
 * Initialize the mesh bridge
 * @param {Object} options
 * @param {Function} options.sendProvider - Your A2A client send function
 */
export async function initializeMeshBridge(options) {
  if (initialized) return;
  
  const { sendProvider } = options;
  
  // Initialize all mesh-memory systems
  await initializeA2AIntegration({ sendProvider });
  await initializeGovernance();
  await initializeDealRooms();
  
  initialized = true;
  console.log('[mesh-bridge] Initialized');
}

/**
 * Send message with mesh-memory guarantees
 * Maintains same interface as raw A2A
 */
export async function sendWithMesh(peer, message, options = {}) {
  if (!initialized) {
    throw new Error('Mesh bridge not initialized. Call initializeMeshBridge() first.');
  }
  
  // Optional: Enforce policy before sending
  const agent = { agentId: process.env.AGENT_NAME || 'unknown' };
  const policyResult = await enforcePolicy(
    agent,
    `a2a://${peer}`,
    'send',
    { peer }
  );
  
  if (!policyResult.allowed) {
    throw new Error(`Policy denied: ${policyResult.reason}`);
  }
  
  // Send with full guarantees
  return await meshSend(peer, message, {
    guarantee: options.guarantee !== false,
    context: options.context !== false,
    timeout: options.timeout || 30000
  });
}

/**
 * Check if mesh systems are healthy
 */
export async function isMeshHealthy() {
  if (!initialized) return false;
  
  try {
    // Basic health check - can we access TKG?
    const { getUnifiedStats } = await import('./mesh-memory/src/tkg-integration.mjs');
    return true;
  } catch (err) {
    return false;
  }
}

// Export for compatibility
export { registerPeer, getDeliveryStatus };
```

#### Step 2.2: Update Your Main Entry Point

Modify your agent's initialization code:

```javascript
// At the TOP of your main entry file (before any A2A calls)
import { A2AClient } from '~/.openclaw/extensions/a2a-gateway/src/client.ts';
import { initializeMeshBridge } from './mesh-bridge.mjs';

const a2aClient = new A2AClient();

// Initialize mesh-memory BEFORE anything else
await initializeMeshBridge({
  sendProvider: (peer, msg, opts) => a2aClient.sendMessage(peer, msg, opts)
});

// Now your existing code works, but with guarantees
```

#### Step 2.3: Create Compatibility Layer

Create `~/workspace/a2a-compat.mjs`:

```javascript
/**
 * Drop-in replacement for raw A2A calls
 * Routes through mesh-memory while maintaining same interface
 */

import { 
  sendWithMesh,
  registerPeer as meshRegisterPeer,
  getDeliveryStatus 
} from './mesh-bridge.mjs';

// Map old peer IDs to mesh-memory format
const peerRegistry = new Map();

/**
 * Send message (compatible with raw A2A)
 * @param {string} peer - Peer name
 * @param {Object} message - Message to send
 * @returns {Promise<Object>}
 */
export async function sendMessage(peer, message, opts = {}) {
  // Register peer if not known
  if (!peerRegistry.has(peer)) {
    const peerConfig = resolvePeerConfig(peer);
    if (peerConfig) {
      await meshRegisterPeer(peerConfig);
      peerRegistry.set(peer, peerConfig);
    }
  }
  
  // Send through mesh-memory
  const result = await sendWithMesh(peer, message, {
    guarantee: true,
    timeout: opts.timeout || 30000
  });
  
  // Return format compatible with raw A2A
  return {
    ok: result.success,
    data: result,
    error: result.error
  };
}

/**
 * Resolve peer configuration from openclaw.json
 */
function resolvePeerConfig(peerName) {
  // Read your openclaw.json
  const { readFileSync } = require('fs');
  const config = JSON.parse(readFileSync('~/.openclaw/openclaw.json', 'utf8'));
  
  const peer = config.peers?.find(p => p.name === peerName);
  if (!peer) return null;
  
  return {
    name: peerName,
    agentCardUrl: `${peer.url}/.well-known/agent.json`,
    baseUrl: peer.url,
    auth: { type: 'bearer', token: peer.token },
    skills: ['a2a-messaging', 'mesh-memory'],
    versions: ['2.0']
  };
}

/**
 * Check delivery status
 */
export async function checkStatus(deliveryId) {
  return await getDeliveryStatus(deliveryId);
}
```

### Phase 3: Deal Room Adoption (45 minutes)

#### Step 3.1: Replace Informal Collaboration

**Before (informal):**
```javascript
// Ray wants to collaborate with Liz
await sendMessage('Liz', { 
  text: 'Hey, can we discuss the deployment plan?' 
});

// No structure, no tracking
```

**After (structured deal room):**
```javascript
import { 
  createRoom,
  processConsent,
  closeRoom
} from './mesh-memory/src/deal-room.mjs';
import {
  proposeDecision,
  castVote,
  checkConsensus
} from './mesh-memory/src/consensus-engine.mjs';

// Create structured room
const room = await createRoom(
  'Deployment Plan Review',
  {
    topics: ['deployment', 'production', 'v2.0'],
    documents: [],
    maxParticipants: 3
  },
  {
    consensusRequired: 'majority',
    retentionDays: 365
  },
  [
    { agentId: 'Liz', role: 'negotiator' },
    { agentId: 'Woodhouse', role: 'reviewer' }
  ],
  'Ray'
);

// Wait for consents (Liz and Woodhouse must accept)
// This happens via A2A notifications in real usage

// Once ACTIVE, propose a decision
const proposal = await proposeDecision(
  room.roomId,
  {
    type: 'deployment-approval',
    terms: {
      environment: 'production',
      version: '2.0.0',
      window: '2026-04-27T02:00:00Z'
    }
  },
  'Ready to deploy v2.0 to production during maintenance window',
  'Ray',
  { deadlineHours: 24 }
);

// Others vote
await castVote(room.roomId, proposal.proposalId, 'Liz', 'approve');
await castVote(room.roomId, proposal.proposalId, 'Woodhouse', 'approve');

// Check consensus
const result = await checkConsensus(room.roomId, proposal.proposalId, true);
console.log('Decision:', result.state); // APPROVED_MAJORITY

// Close room when done
await closeRoom(room.roomId, 'Deployment approved and completed', 'Ray');
```

### Phase 4: Governance Enablement (30 minutes)

#### Step 4.1: Add Policy Checks

```javascript
import { 
  enforcePolicy,
  validateCompliance,
  logAudit,
  AuditAction,
  AuditSeverity
} from './mesh-memory/src/governance-integration.mjs';

// Before any significant operation
async function sensitiveOperation(operation) {
  // 1. Check policy
  const agent = { 
    agentId: 'Ray', 
    roles: ['admin'],
    clearance: 'high'
  };
  
  const policy = await enforcePolicy(
    agent,
    operation.resource,
    operation.action,
    { roomId: operation.roomId }
  );
  
  if (!policy.allowed) {
    console.error('Policy denied:', policy.reason);
    await logAudit({
      agentId: 'Ray',
      action: AuditAction.ACCESS,
      resource: operation.resource,
      details: { denied: true, reason: policy.reason },
      severity: AuditSeverity.WARNING
    });
    return { success: false, reason: policy.reason };
  }
  
  // 2. Check compliance
  const compliance = await validateCompliance({
    type: operation.type,
    agentId: 'Ray',
    resource: operation.resource
  });
  
  if (!compliance.compliant) {
    console.error('Compliance violations:', compliance.results);
    return { success: false, violations: compliance.results };
  }
  
  // 3. Execute operation
  const result = await execute(operation);
  
  // 4. Log success
  await logAudit({
    agentId: 'Ray',
    action: AuditAction.ACCESS,
    resource: operation.resource,
    details: { success: true, operation: operation.type },
    severity: AuditSeverity.INFO,
    roomId: operation.roomId
  });
  
  return { success: true, result };
}
```

### Phase 5: Health Daemon Setup (15 minutes)

#### Step 5.1: Add Cron Job

```bash
# Edit crontab
crontab -e

# Add this line for health checks every minute
* * * * * cd ~/.openclaw/workspace/mesh-memory && node src/a2a-health-daemon.mjs >> ~/.openclaw/logs/a2a-health.log 2>&1

# Create log directory if needed
mkdir -p ~/.openclaw/logs
```

#### Step 5.2: Verify Daemon

```bash
# Check daemon is running
ps aux | grep a2a-health-daemon

# Check logs
tail -f ~/.openclaw/logs/a2a-health.log

# Should see:
# [a2a-health-daemon] Health check cycle completed
# [a2a-health-daemon] Processed X pending messages
```

---

## Code Examples: Before → After

### Example 1: Simple Message Send

**Before:**
```javascript
import { A2AClient } from '~/.openclaw/extensions/a2a-gateway/src/client.ts';

const a2aClient = new A2AClient();

async function notifyLiz(message) {
  const result = await a2aClient.sendMessage('Liz', {
    kind: 'message',
    text: message
  });
  
  if (!result.ok) {
    console.error('Failed:', result.error);
    // Message lost - no way to recover
  }
}
```

**After:**
```javascript
import { send, getDeliveryStatus } from './mesh-memory/src/a2a-integration.mjs';

async function notifyLiz(message) {
  const result = await send('Liz', {
    kind: 'message',
    text: message
  }, { guarantee: true, context: true });
  
  if (!result.success) {
    console.error('Queued for retry:', result.error);
    // Message in WAL queue, will be retried
    
    // Check status later
    setTimeout(async () => {
      const status = await getDeliveryStatus(result.deliveryId);
      console.log('Status:', status.status);
    }, 5000);
  }
}
```

### Example 2: Multi-Step Collaboration

**Before:**
```javascript
async function planDeployment() {
  // Send messages back and forth manually
  await sendMessage('Liz', 'Should we deploy Friday?');
  // Wait for response... context lost if session restarts
  
  await sendMessage('Liz', 'Actually, let\'s do Saturday instead');
  // Liz may be confused - no context preservation
  
  // No structured record of decision
}
```

**After:**
```javascript
import { 
  createRoom,
  processConsent 
} from './mesh-memory/src/deal-room.mjs';
import {
  proposeDecision,
  castVote
} from './mesh-memory/src/consensus-engine.mjs';

async function planDeployment() {
  // Create structured room
  const room = await createRoom(
    'Deployment Planning',
    { topics: ['deployment', 'schedule'] },
    { consensusRequired: 'majority' },
    [{ agentId: 'Liz', role: 'negotiator' }],
    'Ray'
  );
  
  // Liz accepts via A2A notification
  // Context auto-created: ctx_abc123
  
  // Propose specific plan
  const proposal = await proposeDecision(
    room.roomId,
    {
      type: 'deployment-schedule',
      terms: { day: 'Saturday', time: '02:00 UTC' }
    },
    'Weekend deployment for minimal impact',
    'Ray',
    { deadlineHours: 24 }
  );
  
  // Liz votes via A2A
  await castVote(room.roomId, proposal.proposalId, 'Liz', 'approve');
  
  // Context preserved - "Saturday" referenced in future messages
  // automatically includes deployment planning context
}
```

### Example 3: Error Handling

**Before:**
```javascript
try {
  await sendMessage('Liz', 'Important update');
} catch (err) {
  console.error('Send failed:', err);
  // Manual retry logic needed
  // No visibility into delivery status
}
```

**After:**
```javascript
import { 
  send,
  getDeliveryStatus,
  retryFailed,
  on
} from './mesh-memory/src/a2a-integration.mjs';

// Subscribe to status updates
const unsub = on('deliveryStatus', (id, status, details) => {
  if (status === 'dead_letter') {
    console.error(`Message ${id} failed permanently`);
    // Could trigger alert, escalation, etc.
  }
});

try {
  const result = await send('Liz', { text: 'Important update' }, {
    guarantee: true
  });
  
  console.log('Delivery ID:', result.deliveryId);
  
  // Check status after delay
  setTimeout(async () => {
    const status = await getDeliveryStatus(result.deliveryId);
    
    if (status.status === 'dead_letter') {
      // Manual retry available
      await retryFailed({ peer: 'Liz', limit: 1 });
    }
  }, 60000);
  
} catch (err) {
  // Even on immediate error, message is in queue
  console.log('Message queued for retry');
}
```

---

## Testing Checklist

### Pre-Migration Tests

- [ ] Document current A2A message flow
- [ ] Identify critical messages that cannot be lost
- [ ] Note current retry patterns (if any)
- [ ] Record baseline metrics (message success rate)

### Migration Tests

- [ ] Initialize mesh-memory without errors
- [ ] Send test message with guarantee enabled
- [ ] Verify delivery ID returned
- [ ] Check message appears in WAL queue
- [ ] Verify health daemon processes queue
- [ ] Confirm delivery status transitions to 'delivered'

### Post-Migration Tests

- [ ] Send messages to all peers (Liz, Woodhouse/Ray)
- [ ] Simulate peer failure - verify circuit breaker opens
- [ ] Simulate recovery - verify circuit breaker closes
- [ ] Create deal room and process consent flow
- [ ] Propose decision and reach consensus
- [ ] Close room and verify audit trail
- [ ] Check governance enforcement (policy deny)
- [ ] Verify audit logs written with hash chaining

### Stress Tests

- [ ] Send 100 messages rapidly
- [ ] Kill agent mid-send, restart, verify retry
- [ ] Disconnect network, wait, reconnect, verify recovery
- [ ] Verify no message loss under normal conditions

### Rollback Tests

- [ ] Verify raw A2A still works without mesh-memory
- [ ] Confirm no data loss if mesh-memory disabled
- [ ] Test backup restoration procedure

---

## Rollback Plan

### Immediate Rollback (If Critical Issues)

```bash
# 1. Stop health daemon
pkill -f a2a-health-daemon

# 2. Revert to raw A2A
# In your code, comment out mesh-memory initialization:
# await initializeMeshBridge(...)

# 3. Dead letter queue preserved at:
ls ~/.openclaw/workspace/mesh-memory/memory/a2a-queue/dead-letter/

# 4. Context history preserved in TKG
ls ~/.openclaw/workspace/mesh-memory/memory/deal-rooms/*/tkg/
```

### Data Preservation

**What is preserved:**
- All sent messages (in DLQ if undelivered)
- All room manifests and audit trails
- All TKG facts
- All governance audit logs

**What may be lost:**
- In-flight messages in WAL queue (will retry when mesh-memory restored)
- Circuit breaker state (recovers automatically)

### Gradual Rollback

```javascript
// Option 1: Disable guarantees but keep initialization
await send('Liz', message, { 
  guarantee: false,  // Skip WAL queue
  context: false     // Skip TKG escrow
});

// Option 2: Conditional based on health
const healthy = await isMeshHealthy();
if (healthy) {
  await sendWithMesh(peer, message);
} else {
  await rawA2A.sendMessage(peer, message);  // Fallback
}
```

### Full Rollback Script

Create `~/workspace/rollback-mesh.sh`:

```bash
#!/bin/bash
set -e

echo "=== Mesh Memory Rollback ==="

# Stop daemon
echo "Stopping health daemon..."
pkill -f a2a-health-daemon || true

# Backup current state
echo "Backing up mesh-memory state..."
cd ~/.openclaw/workspace/mesh-memory
tar -czf backup-$(date +%Y%m%d-%H%M%S).tar.gz memory/

# Revert code changes (manual review required)
echo "Revert these changes in your agent code:"
echo "  1. Comment out mesh-memory imports"
echo "  2. Comment out initializeMeshBridge() call"
echo "  3. Restore raw A2A imports"

echo "=== Rollback Complete ==="
echo "Review and test before committing changes"
```

---

## Success Criteria

You've successfully migrated when:

| Criterion | Test |
|-----------|------|
| ✅ No message loss | Send 100 messages, verify 100 delivered |
| ✅ Delivery tracking | Every send returns a delivery ID |
| ✅ Automatic retry | Failed messages retry without manual intervention |
| ✅ Circuit breaker | Failing peers are detected and isolated |
| ✅ Deal rooms work | Can create room, consent, propose, vote, close |
| ✅ Audit trail | All actions logged with hash chaining |
| ✅ Policy enforcement | Unauthorized operations blocked |
| ✅ Context preservation | Messages include auto-generated briefing |
| ✅ No regression | All existing functionality still works |

---

## Support

- **Issue tracker:** https://github.com/Better-Machine/mesh-memory/issues
- **Documentation:** See `docs/` directory
- **Migration help:** Tag @Liz in any A2A message

---

*Last updated: 2026-04-26*
*For: Ray (<LAN_IP_RAY>) and Woodhouse (<LAN_IP_WOODHOUSE>)*
