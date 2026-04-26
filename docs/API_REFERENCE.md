# mesh-memory API Reference

Complete API documentation for the Mesh Memory Protocol v2.0.

---

## Table of Contents

- [Deal Room API](#deal-room-api)
- [Consensus Engine API](#consensus-engine-api)
- [Governance API](#governance-api)
- [A2A Client API](#a2a-client-api)
- [Memory API (TKG)](#memory-api-tkg)
- [Event System](#event-system)
- [Configuration](#configuration)

---

## Deal Room API

### Room States

```javascript
export const RoomState = {
  PENDING_CONSENT: 'PENDING_CONSENT',
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
  EXPIRED: 'EXPIRED'
};
```

### Participant Roles

```javascript
export const ParticipantRole = {
  NEGOTIATOR: 'negotiator',   // Can propose, vote, write to context
  REVIEWER: 'reviewer',         // Can vote, review context
  OBSERVER: 'observer'          // Read-only access
};
```

---

### `createRoom(purpose, scope, policy, proposedParticipants, creatorAgentId)`

Creates a new deal room with pending consent from all proposed participants.

**Signature:**
```javascript
async function createRoom(
  purpose: string,
  scope: Object,
  policy: Object,
  proposedParticipants: Array<{agentId: string, role: string}>,
  creatorAgentId: string
): Promise<Object>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `purpose` | `string` | Room purpose/description |
| `scope` | `Object` | `{topics: string[], documents: string[], maxParticipants: number}` |
| `policy` | `Object` | `{autoClose: string|null, consensusRequired: 'unanimous'|'majority', dataResidency: string, retentionDays: number}` |
| `proposedParticipants` | `Array` | List of `{agentId, role}` objects |
| `creatorAgentId` | `string` | Agent creating the room |

**Returns:** `Promise<Object>`
```javascript
{
  roomId: string,           // Unique room ID (e.g., "dr_abc123")
  status: string,           // "PENDING_CONSENT"
  expiresAt: string|null,
  manifest: Object          // Full room manifest
}
```

**Example:**
```javascript
import { createRoom } from './src/deal-room.mjs';

const result = await createRoom(
  'Discuss Q2 Roadmap',
  { topics: ['roadmap', 'priorities'], documents: [], maxParticipants: 5 },
  { consensusRequired: 'majority', retentionDays: 365 },
  [{ agentId: 'Ray', role: 'negotiator' }, { agentId: 'Woodhouse', role: 'reviewer' }],
  'Liz'
);
console.log('Created room:', result.roomId);  // "dr_a1b2c3d4..."
```

---

### `inviteParticipant(roomId, agentId, role, inviterAgentId)`

Invites an additional participant to an existing room.

**Signature:**
```javascript
async function inviteParticipant(
  roomId: string,
  agentId: string,
  role: string,           // 'negotiator' | 'reviewer' | 'observer'
  inviterAgentId: string
): Promise<Object>
```

**Returns:** `Promise<Object>` — Updated room manifest

**Example:**
```javascript
import { inviteParticipant } from './src/deal-room.mjs';

const manifest = await inviteParticipant('dr_abc123', 'Liz', 'negotiator', 'Ray');
```

---

### `processConsent(roomId, agentId, accepted)`

Processes a consent response from a proposed participant.

**Signature:**
```javascript
async function processConsent(
  roomId: string,
  agentId: string,
  accepted: boolean
): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  roomId: string,
  state: string,          // "PENDING_CONSENT" | "ACTIVE"
  accepted: boolean,
  manifest: Object
}
```

**Example:**
```javascript
import { processConsent } from './src/deal-room.mjs';

// Accept invitation
await processConsent('dr_abc123', 'Ray', true);

// Room becomes ACTIVE when all participants have accepted
```

---

### `closeRoom(roomId, reason, closerAgentId)`

Closes a deal room permanently.

**Signature:**
```javascript
async function closeRoom(
  roomId: string,
  reason: string,
  closerAgentId: string
): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  roomId: string,
  state: 'CLOSED',
  reason: string,
  notifiedParticipants: string[],
  manifest: Object
}
```

**Example:**
```javascript
import { closeRoom } from './src/deal-room.mjs';

await closeRoom('dr_abc123', 'Project completed', 'Liz');
```

---

### `getRoom(roomId)`

Retrieves a room's manifest.

**Signature:**
```javascript
async function getRoom(roomId: string): Promise<Object>
```

**Example:**
```javascript
const manifest = await getRoom('dr_abc123');
console.log('Room state:', manifest.state);
console.log('Participants:', manifest.participants);
```

---

### `listRooms(filters)`

Lists all rooms with optional filtering.

**Signature:**
```javascript
async function listRooms(filters?: {
  state?: string,
  agentId?: string
}): Promise<Array<Object>>
```

**Example:**
```javascript
// List all active rooms
const activeRooms = await listRooms({ state: 'ACTIVE' });

// List rooms where 'Liz' is a participant
const myRooms = await listRooms({ agentId: 'Liz' });
```

---

### `getAuditTrail(roomId, options)`

Retrieves the complete audit trail for a room.

**Signature:**
```javascript
async function getAuditTrail(
  roomId: string,
  options?: { startSequence?: number, limit?: number }
): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  entries: Array<{
    sequence: number,
    timestamp: string,
    event: string,
    actor: string,
    details: Object,
    hash: string,
    previousHash: string,
    chainVerified: boolean
  }>,
  verified: boolean,      // Chain integrity verified
  total: number
}
```

**Example:**
```javascript
const audit = await getAuditTrail('dr_abc123');
console.log('Chain verified:', audit.verified);
audit.entries.forEach(e => console.log(e.event, e.actor));
```

---

### `verifyRoomIntegrity(roomId)`

Verifies the cryptographic integrity of a room.

**Signature:**
```javascript
async function verifyRoomIntegrity(roomId: string): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  roomId: string,
  exists: boolean,
  manifestValid: boolean,
  auditChainVerified: boolean,
  auditEntryCount: number,
  state: string
}
```

---

## Consensus Engine API

### Decision States

```javascript
export const DecisionState = {
  PROPOSED: 'PROPOSED',
  VOTING: 'VOTING',
  APPROVED_UNANIMOUS: 'APPROVED_UNANIMOUS',
  APPROVED_MAJORITY: 'APPROVED_MAJORITY',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  WITHDRAWN: 'WITHDRAWN'
};

export const VoteType = {
  APPROVE: 'approve',
  REJECT: 'reject',
  ABSTAIN: 'abstain'
};
```

---

### `proposeDecision(roomId, proposal, rationale, proposerAgentId, options)`

Creates a new proposal in a room.

**Signature:**
```javascript
async function proposeDecision(
  roomId: string,
  proposal: Object,           // {type, terms, rationale}
  rationale: string,
  proposerAgentId: string,
  options?: { deadlineHours?: number, requiredVotes?: number, voteThreshold?: number }
): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  proposalId: string,       // e.g., "prop_abc123"
  state: 'VOTING',
  deadline: string,         // ISO8601
  consensusMode: 'unanimous' | 'majority',
  requiredVotes: number
}
```

**Example:**
```javascript
import { proposeDecision } from './src/consensus-engine.mjs';

const result = await proposeDecision(
  'dr_abc123',
  { type: 'deploy', terms: { environment: 'production' } },
  'Ready to deploy v2.0 to production',
  'Liz',
  { deadlineHours: 48 }
);
```

---

### `castVote(roomId, proposalId, agentId, vote, reason)`

Casts a vote on an open proposal.

**Signature:**
```javascript
async function castVote(
  roomId: string,
  proposalId: string,
  agentId: string,
  vote: 'approve' | 'reject' | 'abstain',
  reason?: string
): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  proposalId: string,
  voteRecorded: boolean,
  consensusReached: boolean,
  currentState: string,
  votesCast: number,
  totalRequired: number
}
```

**Example:**
```javascript
import { castVote, VoteType } from './src/consensus-engine.mjs';

await castVote('dr_abc123', 'prop_xyz789', 'Ray', VoteType.APPROVE, 'LGTM');
```

---

### `checkConsensus(roomId, proposalId, autoFinalize?)`

Checks if consensus has been reached on a proposal.

**Signature:**
```javascript
async function checkConsensus(
  roomId: string,
  proposalId: string,
  autoFinalize?: boolean
): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  reached: boolean,
  state: string,          // 'VOTING' | 'APPROVED_*' | 'REJECTED' | 'EXPIRED'
  proposalId: string,
  votes?: { approve: number, reject: number, abstain: number, total: number },
  needed?: number,
  reason?: string         // e.g., 'deadline_expired'
}
```

**Example:**
```javascript
const check = await checkConsensus('dr_abc123', 'prop_xyz789');
if (check.reached) {
  console.log('Consensus reached:', check.state);
}
```

---

### `commitDecision(roomId, proposalId)`

Finalizes a decision once consensus is reached.

**Signature:**
```javascript
async function commitDecision(
  roomId: string,
  proposalId: string
): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  proposalId: string,
  roomId: string,
  state: string,
  finalizedAt: string,
  votes: Array,
  proposal: Object,
  auditHash: string
}
```

---

### `withdrawProposal(roomId, proposalId, agentId)`

Withdraws a proposal (only by proposer, only if no votes cast).

**Signature:**
```javascript
async function withdrawProposal(
  roomId: string,
  proposalId: string,
  agentId: string
): Promise<Object>
```

---

### `getProposal(roomId, proposalId)`

Retrieves full proposal details.

**Signature:**
```javascript
async function getProposal(roomId: string, proposalId: string): Promise<Object>
```

---

### `listProposals(roomId, filters?)`

Lists proposals in a room.

**Signature:**
```javascript
async function listProposals(
  roomId: string,
  filters?: { state?: string, agentId?: string }
): Promise<Array<Object>>
```

**Example:**
```javascript
const proposals = await listProposals('dr_abc123', { state: 'VOTING' });
```

---

## Governance API

### Enums

```javascript
// Policy Decisions
export const PolicyDecision = {
  ALLOW: 'ALLOW',
  DENY: 'DENY',
  INDETERMINATE: 'INDETERMINATE'
};

// Compliance Outcomes
export const ComplianceOutcome = {
  COMPLIANT: 'COMPLIANT',
  NON_COMPLIANT: 'NON_COMPLIANT',
  NEEDS_REVIEW: 'NEEDS_REVIEW'
};

// Compliance Severity
export const ComplianceSeverity = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  INFO: 'INFO'
};

// Audit Actions
export const AuditAction = {
  ACCESS: 'ACCESS',
  POLICY_CHANGE: 'POLICY_CHANGE',
  AUDIT_VERIFICATION: 'AUDIT_VERIFICATION',
  DATA_EXPORT: 'DATA_EXPORT',
  CONSENT_CHANGE: 'CONSENT_CHANGE',
  ROOM_CREATED: 'ROOM_CREATED',
  ROOM_CLOSED: 'ROOM_CLOSED'
};

// Audit Severity
export const AuditSeverity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL'
};
```

---

### `initializeGovernance(options?)`

Initializes the governance system.

**Signature:**
```javascript
async function initializeGovernance(options?: {
  autoBlockNonCompliant?: boolean,   // default: true
  escalateOnViolation?: boolean,       // default: true
  auditAllOperations?: boolean,        // default: true
  requireSignatures?: boolean,        // default: false
  defaultRetentionDays?: number,      // default: 90
  alertSeverityThreshold?: string       // default: 'HIGH'
}): Promise<void>
```

**Example:**
```javascript
import { initializeGovernance } from './src/governance-integration.mjs';

await initializeGovernance({ autoBlockNonCompliant: true });
```

---

### `enforcePolicy(agent, resource, action, context?)`

Evaluates ABAC policy for an operation.

**Signature:**
```javascript
async function enforcePolicy(
  agent: Object,           // {agentId, roles, clearance, attributes}
  resource: string,
  action: string,
  context?: Object         // {roomId, timestamp, ...}
): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  allowed: boolean,
  decision: 'ALLOW' | 'DENY' | 'INDETERMINATE',
  reason: string,
  policy: Object,          // Matched policy
  matchedRules: Array      // Rules that matched
}
```

**Example:**
```javascript
import { enforcePolicy } from './src/governance-integration.mjs';

const result = await enforcePolicy(
  { agentId: 'Liz', roles: ['admin'], clearance: 'high' },
  'room://dr_abc123',
  'write',
  { roomId: 'dr_abc123' }
);

if (!result.allowed) {
  console.error('Access denied:', result.reason);
}
```

---

### `validateCompliance(decision, context?)`

Validates a decision against compliance rules.

**Signature:**
```javascript
async function validateCompliance(
  decision: Object,        // {type, agentId, resource, ...}
  context?: Object
): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  compliant: boolean,
  outcome: 'COMPLIANT' | 'NON_COMPLIANT' | 'NEEDS_REVIEW',
  results: Array<{
    ruleId: string,
    ruleName: string,
    outcome: string,
    severity: string,
    details: Object,
    remediation: string
  }>,
  summary: {
    total: number,
    compliant: number,
    nonCompliant: number,
    needsReview: number,
    criticalViolations: number
  }
}
```

**Example:**
```javascript
const compliance = await validateCompliance({
  type: 'data-export',
  agentId: 'Liz',
  resource: 'room://dr_abc123'
});

if (!compliance.compliant) {
  console.error('Critical violations:', compliance.summary.criticalViolations);
}
```

---

### `logAudit(event, options?)`

Logs an audit event with WORM guarantees.

**Signature:**
```javascript
async function logAudit(
  event: {
    agentId: string,
    action: AuditAction,
    resource: string,
    details?: Object,
    severity?: AuditSeverity,
    roomId?: string
  },
  options?: { signWithKey?: boolean, roomId?: string }
): Promise<AuditEntry>
```

**Returns:** `Promise<AuditEntry>`
```javascript
{
  entryId: string,
  timestamp: string,
  agentId: string,
  action: string,
  resource: string,
  details: Object,
  severity: string,
  hash: string,            // Cryptographic hash
  previousHash: string,    // Chain link
  roomId?: string
}
```

**Example:**
```javascript
import { logAudit, AuditAction, AuditSeverity } from './src/governance-integration.mjs';

await logAudit({
  agentId: 'Liz',
  action: AuditAction.ACCESS,
  resource: 'room://dr_abc123',
  details: { operation: 'read', records: 10 },
  severity: AuditSeverity.INFO,
  roomId: 'dr_abc123'
});
```

---

### `checkGovernance(request)`

Performs full governance check: policy + compliance + audit.

**Signature:**
```javascript
async function checkGovernance(request: {
  agent: Object,
  resource: string,
  action: string,
  decision?: Object,
  context?: Object
}): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  allowed: boolean,       // Final permission
  policy: Object,          // Policy enforcement result
  compliance: Object,      // Compliance validation result
  blocked: boolean        // Whether operation was blocked
}
```

---

### `getGovernanceReport(filters?)`

Generates comprehensive governance status report.

**Signature:**
```javascript
async function getGovernanceReport(filters?: {
  period?: { start: string, end: string }
}): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  generatedAt: string,
  period: Object,
  policies: {
    total: number,
    active: number,
    deprecated: number
  },
  compliance: {
    totalValidations: number,
    compliant: number,
    nonCompliant: number,
    complianceRate: number,
    criticalViolations: number,
    violationsByRule: Object
  },
  audit: {
    totalEntries: number,
    entriesBySeverity: Object,
    chainStatus: Object,   // Per-room verification
    archivedCount: number
  },
  alerts: Array<{ severity, message, timestamp }>
}
```

---

## A2A Client API

### Circuit States

```javascript
export const CircuitState = {
  CLOSED: 'closed',      // Normal operation
  OPEN: 'open',          // Failing, requests blocked
  HALF_OPEN: 'half-open' // Testing recovery
};

export const DeliveryStatus = {
  PENDING: 'pending',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  DEAD_LETTER: 'dead_letter'
};
```

---

### `initializeA2AIntegration(options)`

Initializes the hardened A2A integration layer.

**Signature:**
```javascript
async function initializeA2AIntegration(options: {
  sendProvider: (peer: string, message: Object, opts: Object) => Promise<Object>
}): Promise<void>
```

**Example:**
```javascript
import { initializeA2AIntegration } from './src/a2a-integration.mjs';
import { A2AClient } from '~/.openclaw/extensions/a2a-gateway/src/client.ts';

const a2aClient = new A2AClient();
await initializeA2AIntegration({
  sendProvider: (peer, msg, opts) => a2aClient.sendMessage(peer, msg, opts)
});
```

---

### `send(peer, message, options?)`

Sends a message with delivery guarantees and optional context.

**Signature:**
```javascript
async function send(
  peer: string,
  message: Object | string,
  options?: {
    guarantee?: boolean,      // Enable WAL queue (default: true)
    context?: boolean,        // Enable context escrow (default: true)
    contextId?: string,        // Reuse existing context
    timeout?: number,         // Timeout in ms (default: 30000)
    agentSession?: Object
  }
): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  success: boolean,
  error: string | null,
  deliveryId: string | null,
  contextId: string | null,
  roomId: string | null,
  status: 'sent' | 'queued' | 'rejected',
  peer: Object
}
```

**Example:**
```javascript
import { send } from './src/a2a-integration.mjs';

const result = await send('Ray', {
  kind: 'message',
  text: 'Hello from Liz!'
}, { guarantee: true, context: true });

console.log('Delivery ID:', result.deliveryId);
console.log('Context ID:', result.contextId);
```

---

### `sendWithGuarantee(peer, message, options?)`

Low-level function for guaranteed delivery (via a2a-reliability-layer).

**Signature:**
```javascript
async function sendWithGuarantee(
  peer: string,
  message: Object,
  options?: { guarantee?: boolean, timeout?: number }
): Promise<string>  // Returns deliveryId
```

---

### `getDeliveryStatus(deliveryId)`

Checks the status of a delivery.

**Signature:**
```javascript
async function getDeliveryStatus(deliveryId: string): Promise<Object | null>
```

**Returns:** `Promise<Object>`
```javascript
{
  deliveryId: string,
  status: 'pending' | 'delivered' | 'failed' | 'dead_letter',
  peer: string,
  attempts: number,
  maxAttempts: number,
  nextRetry: string | null,
  createdAt: string,
  deliveredAt: string | null,
  ackReceivedAt: string | null,
  lastError: string | null
}
```

**Example:**
```javascript
import { getDeliveryStatus } from './src/a2a-integration.mjs';

const status = await getDeliveryStatus('dlv_abc123');
console.log(`Status: ${status.status} (${status.attempts}/${status.maxAttempts} attempts)`);
```

---

### `retryFailed(options?)`

Retries failed messages from the dead letter queue.

**Signature:**
```javascript
async function retryFailed(options?: {
  peer?: string,
  limit?: number
}): Promise<Array<string>>  // Returns retried delivery IDs
```

**Example:**
```javascript
const retried = await retryFailed({ limit: 10 });
console.log(`Retried ${retried.length} messages`);
```

---

### `registerPeer(peerConfig)`

Registers a peer for discovery.

**Signature:**
```javascript
async function registerPeer(peerConfig: {
  name: string,
  agentCardUrl: string,
  baseUrl: string,
  auth: { type: 'bearer', token: string },
  skills: string[],
  versions: string[],
  maxConcurrentTasks: number
}): Promise<Object>
```

**Example:**
```javascript
import { registerPeer } from './src/a2a-integration.mjs';

await registerPeer({
  name: 'Ray',
  agentCardUrl: 'http://<LAN_IP_RAY>:18800/.well-known/agent.json',
  baseUrl: 'http://<LAN_IP_RAY>:18800',
  auth: { type: 'bearer', token: process.env.RAY_TOKEN },
  skills: ['mesh-memory', 'a2a-messaging'],
  versions: ['1.0', '2.0'],
  maxConcurrentTasks: 10
});
```

---

### `discoverPeers(filter?)`

Discovers healthy peers with optional capability filtering.

**Signature:**
```javascript
async function discoverPeers(filter?: {
  capability?: string,
  version?: string,
  healthyOnly?: boolean,
  limit?: number
}): Promise<Array<Object>>
```

**Example:**
```javascript
const healthyPeers = await discoverPeers({
  capability: 'mesh-memory',
  healthyOnly: true
});
```

---

### `getThreadHistory(contextId, options?)`

Retrieves conversation history for a context.

**Signature:**
```javascript
async function getThreadHistory(
  contextId: string,
  options?: { limit?: number, before?: string }
): Promise<Array<Object>>
```

**Returns:** `Promise<Array<Object>>`
```javascript
[
  {
    timestamp: string,
    agent: string,
    message: Object,
    roomId: string
  }
]
```

**Example:**
```javascript
const history = await getThreadHistory('ctx_xyz789', { limit: 20 });
history.forEach(h => console.log(`${h.agent}: ${h.message.text}`));
```

---

### `getCircuitState(peerName)`

Gets circuit breaker state for a peer.

**Signature:**
```javascript
function getCircuitState(peerName: string): Object
```

**Returns:** `Object`
```javascript
{
  peer: string,
  state: 'closed' | 'open' | 'half-open',
  consecutiveFailures: number,
  lastFailureAt: string | null,
  openedAt: string | null
}
```

---

### `getDeadLetterQueue(options?)`

Retrieves messages in the dead letter queue.

**Signature:**
```javascript
async function getDeadLetterQueue(options?: {
  peer?: string,
  limit?: number
}): Promise<Array<Object>>
```

---

## Memory API (TKG)

### Storage Modes

```javascript
export const StorageMode = {
  LEGACY_JSONL: 'legacy_jsonl',
  TKG: 'tkg',
  HYBRID: 'hybrid'
};
```

---

### `initializeTKGIntegration()`

Initializes the Temporal Knowledge Graph.

**Signature:**
```javascript
async function initializeTKGIntegration(): Promise<void>
```

---

### `escrowFactUnified(roomId, entry, accessPolicy, agentId)`

Stores a fact using the appropriate storage mode (TKG or legacy).

**Signature:**
```javascript
async function escrowFactUnified(
  roomId: string,
  entry: {
    subject: string,
    predicate: string,
    object: any,
    provenance?: Object,
    timestamp?: string
  },
  accessPolicy: Object,
  agentId: string
): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  entryId: string,
  roomId: string,
  storageMode: 'tkg' | 'legacy_jsonl',
  timestamp: string,
  status: 'VERIFIED'
}
```

**Example:**
```javascript
import { escrowFactUnified } from './src/tkg-integration.mjs';

const result = await escrowFactUnified(
  'dr_abc123',
  {
    subject: 'deployment-plan',
    predicate: 'status',
    object: 'approved',
    provenance: { source: 'consensus', confidence: 1.0 }
  },
  { readableBy: ['Liz', 'Ray', 'Woodhouse'] },
  'Liz'
);
```

---

### `queryFactsUnified(roomId, subject?, predicate?, options?)`

Queries facts across TKG and legacy storage.

**Signature:**
```javascript
async function queryFactsUnified(
  roomId: string,
  subject?: string | null,
  predicate?: string | null,
  options?: {
    after?: string,
    before?: string,
    limit?: number,
    includeRedacted?: boolean
  }
): Promise<Array<Object>>
```

**Example:**
```javascript
// Get all facts about a subject
const facts = await queryFactsUnified('dr_abc123', 'deployment-plan');

// Get specific predicate
const status = await queryFactsUnified('dr_abc123', 'deployment-plan', 'status');

// Time-bounded query
const recent = await queryFactsUnified('dr_abc123', null, null, {
  after: '2026-04-01T00:00:00Z'
});
```

---

### `migrateRoomToTKG(roomId, options?)`

Migrates a legacy room to TKG.

**Signature:**
```javascript
async function migrateRoomToTKG(
  roomId: string,
  options?: { preserveOriginal?: boolean, dryRun?: boolean }
): Promise<Object>
```

**Returns:** `Promise<Object>`
```javascript
{
  roomId: string,
  status: 'MIGRATED' | 'ALREADY_TKG' | 'DRY_RUN',
  factsMigrated: number,
  errors?: Array,
  originalPreserved: boolean
}
```

---

### TKG Query Functions

```javascript
import { tkgQueries } from './src/tkg-integration.mjs';

// Find path between entities
const path = await tkgQueries.findPath(roomId, 'Liz', 'Ray', maxDepth = 5);

// Get related entities (subgraph)
const subgraph = await tkgQueries.getRelatedEntities(roomId, 'deployment-plan', depth = 2);

// Detect temporal conflicts
const conflicts = await tkgQueries.detectConflicts(roomId);

// Verify cryptographic integrity
const integrity = await tkgQueries.verifyIntegrity(roomId);

// Export snapshot at point in time
const snapshot = await tkgQueries.exportSnapshot(roomId, '2026-04-01T00:00:00Z');

// Query by pattern
const matches = await tkgQueries.queryByPattern(roomId, {
  predicate: 'status',
  source: 'consensus'
});
```

---

## Event System

### `onGovernanceEvent(event, handler)`

Subscribes to governance events.

**Signature:**
```javascript
function onGovernanceEvent(event: string, handler: Function): void
```

**Events:**
- `policyViolation` — Policy enforcement denied access
- `complianceFailure` — Compliance validation failed

**Example:**
```javascript
import { onGovernanceEvent } from './src/governance-integration.mjs';

onGovernanceEvent('policyViolation', (event) => {
  console.error('Policy violation:', event);
  // { policy, agent, action, resource, reason, timestamp }
});

onGovernanceEvent('complianceFailure', (event) => {
  console.error('Compliance failure:', event);
  // { rule, ruleName, severity, decision, remediation, timestamp }
});
```

---

### A2A Event Subscription

```javascript
import { on } from './src/a2a-integration.mjs';

// Subscribe to delivery status changes
const unsubDelivery = on('deliveryStatus', (deliveryId, status, details) => {
  console.log(`Delivery ${deliveryId}: ${status}`);
  // status: 'pending' | 'delivered' | 'failed' | 'dead_letter'
});

// Subscribe to peer health changes
const unsubHealth = on('peerHealthChange', (peerName, health) => {
  console.log(`Peer ${peerName}: ${health.circuitBreakerState}`);
  // health: { circuitBreakerState, consecutiveFailures, latencyP50, ... }
});

// Subscribe to context expiration
const unsubContext = on('contextExpired', (contextId, details) => {
  console.log(`Context ${contextId} expired`);
});

// Unsubscribe when done
unsubDelivery();
unsubHealth();
unsubContext();
```

---

### A2A Reliability Events

```javascript
import { onDeliveryStatus } from './src/a2a-reliability-layer.mjs';

onDeliveryStatus((deliveryId, status, details) => {
  console.log(`[${status}] ${deliveryId}`, details);
});
```

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MESH_MEMORY_BASE_DIR` | Base directory for memory storage | `memory` |
| `MESH_MEMORY_LOG_LEVEL` | Logging verbosity | `info` |
| `A2A_HEALTH_CHECK_INTERVAL` | Health check interval (ms) | `60000` |
| `A2A_CIRCUIT_BREAKER_THRESHOLD` | Failures before circuit opens | `5` |
| `A2A_CIRCUIT_BREAKER_COOLDOWN` | Cooldown before half-open (ms) | `60000` |
| `GOVERNANCE_AUTO_BLOCK` | Auto-block non-compliant ops | `true` |
| `GOVERNANCE_RETENTION_DAYS` | Default audit retention | `90` |

### Config File

**mesh-memory.config.json:**
```json
{
  "agentId": "Liz",
  "receiverToken": "token-here",
  "port": 18803,
  "memory": {
    "baseDir": "memory",
    "lcmExportPath": "memory/mesh/lcm",
    "lessonsPath": "memory/mesh/lessons"
  },
  "governance": {
    "autoBlockNonCompliant": true,
    "escalateOnViolation": true,
    "auditAllOperations": true,
    "defaultRetentionDays": 90,
    "alertSeverityThreshold": "HIGH"
  },
  "a2a": {
    "guaranteeDelivery": true,
    "maxRetries": 5,
    "circuitBreaker": {
      "failureThreshold": 5,
      "cooldownMs": 60000
    }
  },
  "peers": [
    {
      "name": "Ray",
      "url": "http://<LAN_IP_RAY>:18800",
      "token": "${RAY_TOKEN}"
    },
    {
      "name": "Woodhouse",
      "url": "http://<LAN_IP_WOODHOUSE>:18800",
      "token": "${WOODHOUSE_TOKEN}"
    }
  ]
}
```

### Local Config Override

Create `mesh-memory.config.local.json` (gitignored) for sensitive values:

```json
{
  "receiverToken": "actual-secret-token",
  "peers": [
    {
      "name": "Ray",
      "token": "ray-actual-token"
    }
  ]
}
```

---

## TypeScript Type Definitions

```typescript
// Core types for reference

interface RoomManifest {
  roomId: string;
  purpose: string;
  scope: {
    topics: string[];
    documents: string[];
    maxParticipants: number;
  };
  policy: {
    autoClose: string | null;
    consensusRequired: 'unanimous' | 'majority';
    dataResidency: string;
    retentionDays: number;
  };
  state: RoomState;
  createdAt: string;
  updatedAt: string;
  participants: Participant[];
  pendingConsents: PendingConsent[];
}

interface Participant {
  agentId: string;
  role: 'negotiator' | 'reviewer' | 'observer';
  joinedAt: string;
  status: 'active' | 'inactive';
}

interface Proposal {
  proposalId: string;
  roomId: string;
  state: DecisionState;
  proposal: {
    type: string;
    content: any;
    rationale: string;
  };
  proposer: string;
  proposedAt: string;
  deadline: string;
  consensusMode: 'unanimous' | 'majority';
  votes: Vote[];
  finalizedAt: string | null;
  auditHash: string;
}

interface Vote {
  agentId: string;
  vote: 'approve' | 'reject' | 'abstain';
  reason: string;
  timestamp: string;
}

interface DeliveryRecord {
  deliveryId: string;
  peer: string;
  message: any;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextRetry: string | null;
  createdAt: string;
  deliveredAt: string | null;
  ackReceivedAt: string | null;
  lastError: string | null;
}

interface AuditEntry {
  entryId: string;
  timestamp: string;
  agentId: string;
  action: AuditAction;
  resource: string;
  details: any;
  severity: AuditSeverity;
  hash: string;
  previousHash: string;
  roomId?: string;
}
```

---

## Error Handling

All async functions may throw errors. Common error types:

```javascript
// Room errors
try {
  await createRoom(...);
} catch (err) {
  if (err.message.includes('Invalid purpose')) {
    // Handle validation error
  }
}

// Policy errors
const result = await enforcePolicy(...);
if (!result.allowed) {
  console.error('Denied:', result.reason);
}

// Circuit breaker
const status = await send('Ray', message);
if (status.status === 'rejected') {
  console.error('Circuit open - peer unavailable');
}
```

---

*Last updated: 2026-04-26*
