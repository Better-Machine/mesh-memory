# Mesh-Memory Integration Interface Specification

**Status:** Draft (RFC-0000 companion)  
**Author:** Liz (Agentic Integration Architect)  
**Date:** 2026-04-13  
**Version:** 1.0.0

---

## Overview

This document specifies the clean API boundary between OpenClaw agents and the mesh-memory system. It defines the interface contract that enables bidirectional communication: OpenClaw agents calling mesh-memory functions, and mesh-memory invoking callbacks on OpenClaw agents.

The design prioritizes:
- **Type safety** — Full TypeScript definitions
- **Fault tolerance** — Retry policies and circuit breakers
- **Security** — Token validation and identity binding
- **Composability** — Clean separation of concerns

---

## 1. OpenClaw → Mesh API (Plugin Entry Points)

These functions are exposed by the mesh-memory plugin and called by OpenClaw agents.

### 1.1 `mesh.sendMessage(peerId, message)`

Send an A2A-compatible message to a peer agent through the mesh.

**Signature:**
```typescript
function sendMessage(
  peerId: string,
  message: A2AMessage
): Promise<DeliveryStatus>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `peerId` | `string` | Target agent ID (e.g., "ray", "woodhouse") |
| `message` | `A2AMessage` | Message conforming to A2A v1.0.0 schema |

**Returns:** `Promise<DeliveryStatus>`

```typescript
interface DeliveryStatus {
  status: 'delivered' | 'queued' | 'failed';
  messageId: string;
  timestamp: string; // ISO 8601
  peerVerification: {
    l1Health: boolean; // A2A gateway reachable
    l2Health: boolean; // Mesh receiver reachable
    trustScore: number; // 0.0 - 1.0
  };
  retryAttempt?: number;
  error?: DeliveryError;
}

interface DeliveryError {
  code: string;
  message: string;
  recoverable: boolean;
}
```

**Implementation Notes:**
- Performs L1/L2 health verification before sending (see A2A_RECEIVER_SPEC.md)
- Queues messages for retry if peer is temporarily unreachable
- Updates trust score based on delivery success/failure

---

### 1.2 `mesh.getThread(threadId)`

Retrieve the current state of a collaboration thread.

**Signature:**
```typescript
function getThread(
  threadId: string,
  options?: ThreadQueryOptions
): Promise<ThreadState>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `threadId` | `string` | UUID of the thread |
| `options` | `ThreadQueryOptions` | Optional query parameters |

**Returns:** `Promise<ThreadState>`

```typescript
interface ThreadQueryOptions {
  consistency?: 'eventual' | 'strong'; // Default: 'eventual'
  includeHistory?: boolean;          // Default: true
  maxEntries?: number;               // Default: 100
  cursor?: string;                   // For pagination
}

interface ThreadState {
  threadId: string;
  status: 'active' | 'closed' | 'archived';
  createdAt: string;
  updatedAt: string;
  participants: AgentReference[];
  entries: ThreadEntry[];
  consensusState?: ConsensusState;
  metadata: ThreadMetadata;
  nextCursor?: string; // Pagination cursor
}

interface ThreadEntry {
  entryId: string;
  agentId: string;
  type: 'message' | 'proposal' | 'correction' | 'fact';
  content: string;
  timestamp: string;
  vectorClock: VectorClock;
  tags?: string[];
}

interface ConsensusState {
  pendingProposals: Proposal[];
  agreedFacts: Fact[];
  conflicts: Conflict[];
}
```

---

### 1.3 `mesh.searchMemory(query, options)`

Search the mesh memory for facts, interpretations, and thread entries.

**Signature:**
```typescript
function searchMemory(
  query: string,
  options?: SearchOptions
): Promise<SearchResults>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `query` | `string` | Search query (supports semantic search) |
| `options` | `SearchOptions` | Search filters and parameters |

**Returns:** `Promise<SearchResults>`

```typescript
interface SearchOptions {
  tier?: 'critical' | 'recent' | 'archived'; // Default: 'recent'
  agentFilter?: string[];    // Filter by agent IDs
  timeRange?: {
    from?: string; // ISO 8601
    to?: string;
  };
  typeFilter?: ('fact' | 'interpretation' | 'message' | 'lesson')[];
  biasResistant?: boolean;   // Default: true
  maxResults?: number;       // Default: 20
  minConfidence?: number;    // 0.0 - 1.0, default: 0.7
}

interface SearchResults {
  entries: MemoryEntry[];
  totalFound: number;
  queryTimeMs: number;
  biasScore: number; // Lower is better (more bias-resistant)
  sources: AgentReference[];
}

interface MemoryEntry {
  entryId: string;
  type: 'fact' | 'interpretation' | 'message' | 'lesson';
  content: string;
  agentId: string;
  timestamp: string;
  confidence: number;
  provenance: Provenance;
  tags?: string[];
}

interface Provenance {
  source: string;
  timestamp: string;
  method: 'direct' | 'sync' | 'inference';
  receiptId?: string;
}
```

**Implementation Notes:**
- Searches L1 (critical facts), L2 (recent), and L3 (archived) layers
- Applies bias-resistance filtering by default (filters interpretations from single sources)
- Returns confidence scores based on consensus and source reliability

---

### 1.4 `mesh.writeFact(key, value, metadata)`

Write a verified fact to the mesh memory.

**Signature:**
```typescript
function writeFact(
  key: string,
  value: FactValue,
  metadata: FactMetadata
): Promise<WriteConfirmation>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `key` | `string` | Unique identifier for the fact |
| `value` | `FactValue` | The fact content |
| `metadata` | `FactMetadata` | Metadata about the fact |

**Returns:** `Promise<WriteConfirmation>`

```typescript
type FactValue = string | object | number | boolean;

interface FactMetadata {
  category: string;
  source: string;
  confidence: number; // 0.0 - 1.0
  expiresAt?: string; // Optional TTL
  tags?: string[];
  requiresConfirmation?: boolean; // Default: false
}

interface WriteConfirmation {
  receiptId: string;
  entryId: string;
  timestamp: string;
  durability: 'fsync_confirmed' | 'acknowledged' | 'pending';
  confirmedNodes: string[];
  syncStatus: SyncStatus;
}

interface SyncStatus {
  pendingPeers: string[];
  confirmedPeers: string[];
  failedPeers: string[];
}
```

**Implementation Notes:**
- Performs identity binding: token must match calling agent
- Durability confirmed via fsync before returning
- If `requiresConfirmation` is true, waits for peer confirmations

---

### 1.5 `mesh.writeInterpretation(key, value, agentId)`

Write an interpretation (agent-specific view) to the mesh memory.

**Signature:**
```typescript
function writeInterpretation(
  key: string,
  value: InterpretationValue,
  agentId: string
): Promise<WriteConfirmation>
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `key` | `string` | Unique identifier for the interpretation |
| `value` | `InterpretationValue` | The interpretation content |
| `agentId` | `string` | ID of the agent providing the interpretation |

**Returns:** `Promise<WriteConfirmation>`

```typescript
interface InterpretationValue {
  content: string;
  basis: string[]; // References to facts this interpretation is based on
  confidence: number;
  alternativeViews?: string[]; // Acknowledged alternative interpretations
}

// WriteConfirmation same as writeFact
```

**Implementation Notes:**
- Interpretations are explicitly tagged and bias-tracked
- Requires `basis` array linking to verified facts
- Alternative views are preserved for conflict resolution

---

## 2. Event Callbacks (Mesh → OpenClaw)

These functions are implemented by OpenClaw agents and called by mesh-memory.

### 2.1 `onMeshMessageReceived(message)`

Called when a message arrives from a peer agent.

**Signature:**
```typescript
function onMeshMessageReceived(message: IncomingMessage): void | Promise<void>
```

```typescript
interface IncomingMessage {
  messageId: string;
  from: AgentReference;
  to: string; // This agent's ID
  content: string;
  type: 'task' | 'query' | 'notification' | 'consensus';
  threadId?: string;
  timestamp: string;
  priority: 'high' | 'normal' | 'low';
  requiresAck: boolean;
  metadata: MessageMetadata;
}

interface AgentReference {
  agentId: string;
  nodeId: string;
  url: string;
  capabilities: string[];
}

interface MessageMetadata {
  traceId: string;
  sourceChannel?: string;
  originalTimestamp?: string;
}
```

---

### 2.2 `onThreadUpdate(threadId, update)`

Called when a collaboration thread this agent participates in is updated.

**Signature:**
```typescript
function onThreadUpdate(
  threadId: string,
  update: ThreadUpdate
): void | Promise<void>
```

```typescript
interface ThreadUpdate {
  updateType: 'new_entry' | 'proposal' | 'consensus_reached' | 'conflict_detected' | 'closed';
  entry?: ThreadEntry;
  proposal?: Proposal;
  conflict?: Conflict;
  timestamp: string;
  actor: string; // Agent ID that made the change
}

interface Proposal {
  proposalId: string;
  type: 'fact' | 'interpretation' | 'thread_close';
  content: string;
  proposedBy: string;
  proposedAt: string;
  expiresAt: string;
  responses: ProposalResponse[];
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
}

interface ProposalResponse {
  agentId: string;
  response: 'accept' | 'reject' | 'abstain';
  reason?: string;
  timestamp: string;
}

interface Conflict {
  conflictId: string;
  entryIds: string[];
  description: string;
  resolutionStrategy: 'last_write_wins' | 'merge' | 'human_resolve';
  resolvedBy?: string;
  resolution?: string;
}
```

---

### 2.3 `onMemorySyncCompleted(syncId)`

Called when a memory synchronization operation completes.

**Signature:**
```typescript
function onMemorySyncCompleted(syncId: string, result: SyncResult): void | Promise<void>
```

```typescript
interface SyncResult {
  syncId: string;
  status: 'success' | 'partial' | 'failed';
  peerId: string;
  entriesSynced: number;
  conflictsFound: number;
  conflictsResolved: number;
  newFacts: string[]; // Entry IDs
  newInterpretations: string[]; // Entry IDs
  errors: SyncError[];
  durationMs: number;
}

interface SyncError {
  entryId?: string;
  errorCode: string;
  message: string;
  recoverable: boolean;
}
```

---

## 3. Error Handling

### 3.1 Retry Policies

All mesh operations implement exponential backoff retry:

```typescript
interface RetryPolicy {
  maxAttempts: number;      // Default: 5
  baseDelayMs: number;       // Default: 100
  maxDelayMs: number;        // Default: 30000
  backoffMultiplier: number; // Default: 2
  jitter: boolean;           // Default: true
}

// Retryable error categories
const RETRYABLE_ERRORS = [
  'NETWORK_ERROR',
  'TIMEOUT',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'SYNC_CONFLICT'
];

// Non-retryable errors
const FATAL_ERRORS = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'INVALID_REQUEST',
  'NOT_FOUND',
  'IDENTITY_MISMATCH'
];
```

**Retry Behavior:**
| Error | Retry Strategy |
|-------|----------------|
| 429 Rate Limited | Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1.6s |
| 503 Unavailable | Exponential + jitter: base 1s, max 30s |
| 5xx Server Error | Linear: 1s, 2s, 3s, 5s, then fail |
| 409 Conflict | Immediate retry with merged payload (max 3) |
| 4xx Client Error | **No retry** — fix the request |

### 3.2 Circuit Breaker Pattern

Circuit breaker state machine for peer connections:

```typescript
interface CircuitBreaker {
  peerId: string;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  successCount: number;
  lastFailureTime?: string;
  lastSuccessTime?: string;
  failureThreshold: number;  // Default: 5
  successThreshold: number; // Default: 3
  timeoutMs: number;       // Default: 60000
}

// State transitions
// CLOSED → OPEN: failureCount >= failureThreshold
// OPEN → HALF_OPEN: timeoutMs elapsed
// HALF_OPEN → CLOSED: successCount >= successThreshold
// HALF_OPEN → OPEN: any failure
```

**Circuit State Behavior:**
| State | Behavior |
|-------|----------|
| `closed` | Normal operation, requests pass through |
| `open` | Fast-fail, return cached error immediately |
| `half-open` | Allow test request to check if peer recovered |

### 3.3 Degraded Mode Behavior

When mesh functionality is unavailable, OpenClaw agents operate in degraded mode:

```typescript
interface DegradedModeConfig {
  enabled: boolean;
  localOnly: boolean;      // Use only local memory
  asyncSync: boolean;        // Queue writes for later sync
  reducedConsistency: boolean; // Accept eventual consistency only
  alertThreshold: number;    // Alert after N degraded operations
}

// Degraded mode behaviors:
// - Writes go to local WAL with timestamp for later replay
// - Reads use local cache only
// - Searches return local results with reduced confidence
// - Messages queued for delivery when peer recovers
// - Alerts logged after threshold exceeded
```

---

## 4. Authentication

### 4.1 Token Validation

Token structure (JWT-like with HMAC-SHA256 for MVP):

```typescript
interface MeshToken {
  header: {
    alg: 'HS256';
    typ: 'mesh+jwt';
    kid: string; // Key ID for rotation
  };
  payload: {
    sub: string;        // Agent ID (MUST match request)
    iss: string;        // Issuing node
    iat: number;        // Issued at (epoch seconds)
    exp: number;        // Expires (epoch seconds)
    mesh: {
      nodeId: string;
      capabilities: MeshCapability[];
      rateLimit: number; // Requests per hour
    };
  };
  signature: string;
}

type MeshCapability = 
  | 'read' 
  | 'write' 
  | 'sync' 
  | 'admin' 
  | 'thread:participate' 
  | 'thread:moderate';
```

**Validation Rules:**
1. Signature verified against shared secret
2. `exp` not exceeded
3. `sub` matches request's `agentId` (identity binding)
4. Capability check for requested operation
5. Rate limit not exceeded

### 4.2 Peer-to-Peer Token Forwarding

When relaying messages between peers:

```typescript
interface ForwardedMessage {
  originalMessage: A2AMessage;
  forwardedBy: string; // Relay agent ID
  forwardedAt: string;
  originalToken: string; // Original sender's token (validated)
  relayToken: string;  // Relay agent's token
}

// Validation:
// 1. Verify relay token is valid
// 2. Verify original token is valid
// 3. Check that relay agent is authorized to forward
// 4. Log forwarding chain for audit
```

---

## 5. Data Contracts

### 5.1 Message Schema (A2A v1.0.0 Compatible)

```typescript
interface A2AMessage {
  protocol: 'a2a/1.0.0';
  messageId: string;
  timestamp: string;
  sender: AgentIdentity;
  recipient: AgentIdentity;
  type: 'task' | 'response' | 'notification' | 'error';
  payload: TaskPayload | ResponsePayload | NotificationPayload;
  signature?: string;
}

interface AgentIdentity {
  agentId: string;
  nodeId: string;
  publicKey?: string;
  url: string;
}

interface TaskPayload {
  taskId: string;
  type: string;
  parameters: Record<string, unknown>;
  priority: 'critical' | 'high' | 'normal' | 'low';
  deadline?: string;
}

interface ResponsePayload {
  taskId: string;
  status: 'success' | 'partial' | 'failure';
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  metrics?: {
    durationMs: number;
    tokensUsed?: number;
  };
}

interface NotificationPayload {
  category: 'thread_update' | 'sync_complete' | 'trust_alert' | 'system';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  data?: unknown;
}
```

### 5.2 Thread State Schema

```typescript
interface ThreadManifest {
  threadId: string;
  version: number;
  createdAt: string;
  createdBy: string;
  status: 'active' | 'frozen' | 'closed' | 'archived';
  participants: AgentReference[];
  permissions: ThreadPermissions;
  consensusRules: ConsensusRules;
}

interface ThreadPermissions {
  canRead: string[];  // Agent IDs
  canWrite: string[];
  canModerate: string[];
  canInvite: string[];
}

interface ConsensusRules {
  requireConfirmation: boolean;
  confirmationThreshold: number; // Min agents to confirm
  timeoutMs: number;
  autoCloseOnConsensus: boolean;
}
```

### 5.3 Memory Entry Schema (Fact vs Interpretation)

```typescript
// Base entry - common fields
interface BaseMemoryEntry {
  entryId: string;
  timestamp: string;
  agentId: string;
  receiptId: string;
  vectorClock: VectorClock;
}

interface VectorClock {
  [agentId: string]: number;
}

// Fact - verified, bias-resistant
interface FactEntry extends BaseMemoryEntry {
  type: 'fact';
  key: string;
  value: unknown;
  category: string;
  confidence: number;
  confirmationCount: number;
  confirmedBy: string[]; // Agent IDs
  provenance: Provenance;
  ttl?: number; // Time-to-live in seconds
}

// Interpretation - agent-specific view
interface InterpretationEntry extends BaseMemoryEntry {
  type: 'interpretation';
  key: string;
  content: string;
  basis: string[]; // References to fact entryIds
  confidence: number;
  alternatives: AlternativeView[];
  biasScore: number; // Computed (higher = more biased)
}

interface AlternativeView {
  agentId: string;
  content: string;
  confidence: number;
}
```

---

## 6. Implementation Notes

### 6.1 Plugin Registration

OpenClaw plugins register mesh capabilities:

```typescript
// In OpenClaw plugin manifest
{
  "name": "mesh-memory",
  "version": "1.0.0",
  "entryPoints": {
    "sendMessage": "./handlers/sendMessage.js",
    "getThread": "./handlers/getThread.js",
    "searchMemory": "./handlers/searchMemory.js",
    "writeFact": "./handlers/writeFact.js",
    "writeInterpretation": "./handlers/writeInterpretation.js"
  },
  "callbacks": {
    "onMeshMessageReceived": "./callbacks/onMessage.js",
    "onThreadUpdate": "./callbacks/onThreadUpdate.js",
    "onMemorySyncCompleted": "./callbacks/onSyncComplete.js"
  }
}
```

### 6.2 Configuration

Environment variables for mesh integration:

```bash
# Identity
MESH_AGENT_ID=liz
MESH_NODE_ID=node_liz_001

# Security
MESH_SHARED_SECRET="min-32-byte-secret-for-hs256"
MESH_TOKEN_TTL_HOURS=24

# Endpoints
MESH_RECEIVER_PORT=18803
MESH_RECEIVER_BIND=0.0.0.0
MESH_HEALTH_CHECK_INTERVAL_MS=30000

# Retry & Circuit Breaker
MESH_RETRY_MAX_ATTEMPTS=5
MESH_CIRCUIT_FAILURE_THRESHOLD=5
MESH_CIRCUIT_TIMEOUT_MS=60000

# Peers (JSON array)
MESH_PEERS='[{"agentId":"ray","url":"http://192.168.50.22:18803","token":"..."}]'
```

---

## 7. References

- `A2A_RECEIVER_SPEC.md` — Peer verification and trust protocol
- `MVP_API_IMPLEMENTATION.md` — MVP API implementation details
- `RFC-0000-scope-negotiation.md` — OAuth 2.0 scope negotiation
- `AGENTS.md` — ILHCEV methodology

---

**Document version:** 1.0.0  
**Last updated:** 2026-04-13  
**Maintainer:** Liz 🐿️
