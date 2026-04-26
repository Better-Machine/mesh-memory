# Architecture Decision Records - Mesh Memory

**Status:** Draft for Review  
**Date:** 2026-04-26  
**Author:** Protocol-Architect Agency Agent

---

## ADR-001: Per-Module SQLite Databases

### Context

Each mesh-memory module initializes its own SQLite database with module-specific schema:
- `a2a-context-escrow` → `memory/a2a-escrow/context-escrow.db`
- `a2a-discovery-registry` → `memory/a2a-registry/peer-registry.db`
- `temporal-knowledge-graph` → `memory/deal-rooms/<room>/tkg/facts.db`
- `abac-policy-engine` → `memory/policies/policies.db`
- `audit-requirements` → `memory/audit/audit.db`
- `compliance-validator` → `memory/compliance/compliance.db`
- `queue-manager` → `queue.db`
- `token-service` → `memory/tokens.db`

### Decision

**Keep per-module databases but extract common patterns into shared abstractions.**

Each bounded context maintains its own persistence, but schema initialization, connection management, and migration patterns are centralized.

### Consequences

**Positive:**
- ✅ Strong isolation between bounded contexts
- ✅ Modules can evolve schemas independently
- ✅ Clear data ownership boundaries
- ✅ Parallel development without coordination bottlenecks

**Negative:**
- ❌ Cannot enforce cross-module transactions (ACID violations possible)
- ❌ 9 databases to backup, monitor, migrate
- ❌ Code duplication across modules (each implements similar init patterns)
- ❌ No query joins across modules

### Alternatives Considered

| Alternative | Rejected Because |
|-------------|------------------|
| Single shared database | Would couple all modules; schema changes require coordination |
| Pure in-memory with sync | Durability requirements (audit, consensus) mandate persistence |
| External DB service | Operational complexity; self-hosting requirement |

### Recommendation

Accept the trade-off but implement:
1. `src/db/repository-base.mjs` - common SQLite patterns
2. `src/db/migration-manager.mjs` - centralized migration orchestration
3. Event-driven eventual consistency for cross-module operations

---

## ADR-002: Facts-Only Context Escrow Protocol

### Context

Context escrow must prevent "bias laundering" where one agent's interpretations become shared facts that constrain other agents' reasoning.

### Decision

**Enforce `type: "fact"` only at the protocol layer.**

The escrow rejects any entry that:
- Has `type` other than "fact"
- Contains interpretation keywords ("think", "believe", "probably", "should")
- Includes evaluative language ("good", "bad", "important", "critical")

### Consequences

**Positive:**
- ✅ Prevents sycophancy through shared context
- ✅ Preserves agent independence
- ✅ Creates clear audit trail of what's factual vs negotiated
- ✅ Aligns with epistemic humility principles

**Negative:**
- ❌ Requires discipline; agents must externalize interpretations as proposals
- ❌ More verbose ("sales increased 15%" vs "sales are strong")
- ❌ May slow collaborative convergence

### Implementation

```javascript
// context-escrow.mjs
const interpretationMarkers = [
  'i think', 'i believe', 'in my opinion', 'seems like',
  'probably', 'likely', 'maybe', 'perhaps',
  'we should', 'recommend', 'suggest', 'advice',
  'important', 'critical', 'essential', 'good', 'bad'
];

function validateFactEntry(entry) {
  const contentStr = JSON.stringify(entry).toLowerCase();
  const found = interpretationMarkers.filter(m => contentStr.includes(m));
  if (found.length > 0) {
    return { valid: false, error: `Contains interpretation: [${found.join(', ')}]` };
  }
}
```

---

## ADR-003: Hybrid Storage Mode for TKG Migration

### Context

Existing rooms use JSONL format for context. New rooms should use TKG (Temporal Knowledge Graph). Migration must be non-breaking.

### Decision

**Implement transparent hybrid mode with automatic migration.**

- Phase 1: Read from both JSONL and TKG; write to both
- Phase 2: Migrate rooms on-demand or scheduled
- Phase 3: Deprecate JSONL (future)

### Consequences

**Positive:**
- ✅ Zero-downtime migration
- ✅ Rollback capability
- ✅ No data loss
- ✅ Gradual adoption

**Negative:**
- ❌ Write amplification (2x writes during hybrid)
- ❌ Query complexity (deduplication required)
- ❌ Temporary storage increase

### Implementation

```javascript
// tkg-integration.mjs
export async function queryFactsUnified(roomId, subject, predicate, options) {
  const mode = await detectStorageMode(roomId);
  const results = [];
  
  if (mode === StorageMode.TKG || mode === StorageMode.HYBRID) {
    results.push(...await tkg.queryAtTime(roomId, subject, predicate, timestamp));
  }
  
  if (mode === StorageMode.LEGACY_JSONL || mode === StorageMode.HYBRID) {
    results.push(...await queryLegacyJSONL(roomId, subject, predicate, options));
  }
  
  // Deduplicate by entry ID
  return [...new Map(results.map(r => [r._id || r.factId, r])).values()];
}
```

---

## ADR-004: Circuit Breaker Per-Peer

### Context

A2A communication to peers can fail. Repeated failures should temporarily disable attempts to prevent cascading failures.

### Decision

**Implement circuit breaker pattern per-peer.**

- CLOSED: Normal operation
- OPEN: Skip attempts, fail fast
- HALF_OPEN: Probe with single request after cooldown

### Consequences

**Positive:**
- ✅ Prevents cascading failures
- ✅ Automatic recovery detection
- ✅ Clear failure semantics

**Negative:**
- ❌ Requires careful tuning (thresholds, timeouts)
- ❌ State must be thread-safe
- ❌ Adds latency to decision path

### Implementation

```javascript
// a2a-reliability-layer.mjs
export const CircuitState = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half-open'
};

const circuitBreakers = new Map();

export function isCircuitClosed(peerName) {
  const cb = getCircuitBreaker(peerName);
  if (cb.state === CircuitState.OPEN) {
    if (cb.openedAt && Date.now() - cb.openedAt >= 60000) {
      updateCircuitState(peerName, CircuitState.HALF_OPEN, 'cooldown elapsed');
      return true;
    }
    return false;
  }
  return true;
}
```

---

## ADR-005: WORM Audit Trail with Hash Chaining

### Context

Compliance requirements mandate tamper-evident audit logging. Regulatory standards (SEC 17a-4) require Write-Once-Read-Many (WORM) storage.

### Decision

**Implement hash-chained audit logs with cryptographic verification.**

- Each entry includes hash of previous entry
- SHA-256 for integrity verification
- Optional RSA signatures per entry
- Separate WORM files per chain

### Consequences

**Positive:**
- ✅ Tamper detection (any modification breaks chain)
- ✅ Regulatory compliance
- ✅ Cryptographic non-repudiation (with signatures)
- ✅ Append-only semantics

**Negative:**
- ❌ No true deletion (only soft retractions)
- ❌ Storage growth unbounded
- ❌ Verification is O(n)
- ❌ Key management complexity (if signing)

### Implementation

```javascript
// audit-requirements.mjs
async function writeAuditEntry(roomId, event, actor, details) {
  // Get previous hash
  let previousHash = '0';
  const lastEntry = await getLastAuditEntry(roomId);
  if (lastEntry) previousHash = lastEntry.hash;
  
  const entry = {
    sequence: Date.now(),
    timestamp: new Date().toISOString(),
    event, actor, details, previousHash
  };
  
  entry.hash = calculateHash(entry);
  await appendToWORMFile(roomId, entry);
}
```

---

## ADR-006: Token Service Singleton Pattern

### Context

Multiple components need token management. A global token service instance is accessible via `getTokenService()`.

### Decision

**DEPRECATED: Replace with dependency injection.**

Current implementation uses singleton anti-pattern:

```javascript
// Current (anti-pattern)
let tokenManagerInstance = null;
export async function getTokenManager(options) {
  if (!tokenManagerInstance) {
    tokenManagerInstance = new TokenManager(options);
  }
  return tokenManagerInstance;
}
```

### Consequences of Current Pattern

**Negative:**
- ❌ Hidden dependencies (callers don't declare need for TokenManager)
- ❌ Impossible to mock for testing
- ❌ State persists across tests
- ❌ Race conditions during initialization
- ❌ No lifecycle management

### Recommended Pattern

```javascript
// Recommended: Explicit dependency injection
export class DealRoomService {
  constructor({ tokenManager, auditLog, config }) {
    this.tokenManager = tokenManager;
    this.auditLog = auditLog;
    this.config = config;
  }
}

// In composition root
const tokenManager = await createTokenManager(config);
const dealRoomService = new DealRoomService({ tokenManager, ... });
```

---

## ADR-007: Governance Integration Layer

### Context

ABAC, compliance validation, and audit logging are related concerns but implemented in separate modules. Callers must coordinate these manually.

### Decision

**Create unified governance API with automatic policy enforcement.**

```javascript
// governance-integration.mjs
export async function checkGovernance(request) {
  // Step 1: Policy enforcement
  const policyResult = await enforcePolicy(agent, resource, action, context);
  
  // Step 2: Compliance validation
  let complianceResult = null;
  if (policyResult.allowed) {
    complianceResult = await validateCompliance(decision, context);
  }
  
  // Step 3: Block if non-compliant
  const finalAllowed = policyResult.allowed && 
                       (!complianceResult || complianceResult.compliant);
  
  // Step 4: Audit regardless of outcome
  await logAudit({ agentId, action, resource, decision: finalAllowed });
  
  return { allowed: finalAllowed, policy: policyResult, compliance: complianceResult };
}
```

### Consequences

**Positive:**
- ✅ Single entry point for governance
- ✅ Cannot forget validation steps
- ✅ Consistent audit trail
- ✅ Automatic blocking of non-compliant operations

**Negative:**
- ❌ Adds latency (3 sequential operations)
- ❌ Single point of failure
- ❌ Harder to customize individual steps

---

## ADR-008: Workflow Engine (Phase 8) - UNIMPLEMENTED

### Context

Multi-stage deal negotiations require sequential rooms with gates between stages.

### Decision

**PAUSED: Current stub implementation is insufficient for production.**

The `deal-room-workflow.mjs` module contains only throw statements:

```javascript
export async function createWorkflow(templateId, config, creatorAgentId) {
  throw new Error('Not implemented: createWorkflow');
}
// 20+ functions are stubs
```

### Options

| Option | Pros | Cons |
|--------|------|------|
| A. Complete implementation | Enables complex negotiations | High effort, unclear requirements |
| B. Remove from architecture | Honest about current state | Documentation debt |
| C. Mark as experimental | Allows incremental delivery | Risk of production use |

### Recommendation

**Option B**: Remove from documented architecture until implemented. Update ARCHITECTURE.md to reflect actual state. The current "TODO" stubs create false expectations.

---

## Summary of Recommendations

| ADR | Current State | Recommendation |
|-----|---------------|----------------|
| 001 Per-Module DBs | Active | Accept with shared abstractions |
| 002 Facts-Only | Active | Keep; well-implemented |
| 003 Hybrid TKG | Active | Keep; migration working |
| 004 Circuit Breaker | Active | Extract to shared module |
| 005 WORM Audit | Active | Keep; compliance critical |
| 006 Token Singleton | Active | **Deprecate; use DI** |
| 007 Governance Layer | Active | Keep; simplifies callers |
| 008 Workflow | **Stub** | **Remove from docs or implement** |

---

*ADRs reviewed following architectural principles: explicit over implicit, explicit dependencies, fail-closed security, and DDD bounded contexts.*
