# Refactoring Recommendations - Mesh Memory

**Priority:** P0 (Critical), P1 (High), P2 (Medium), P3 (Low)  
**Estimated Effort:** S (hours), M (days), L (weeks)  
**Risk:** Low, Medium, High

---

## P0 - Critical (Do Before Next Release)

### P0.1: Extract Shared Database Abstractions
**File:** `src/db/repository-base.mjs` (new)  
**Effort:** M  
**Risk:** Medium

**Problem:** 9 modules duplicate SQLite initialization, schema creation, and connection management patterns.

**Current State:**
```javascript
// Repeated in a2a-context-escrow.mjs, a2a-discovery-registry.mjs, etc.
await db.run(`
  CREATE TABLE IF NOT EXISTS context_mappings (...)
`);
await db.run(`
  CREATE INDEX IF NOT EXISTS idx_context_room ON context_mappings(room_id)
`);
```

**Recommendation:**
```javascript
// src/db/repository-base.mjs
export class SQLiteRepository {
  constructor(dbPath, schema) {
    this.dbPath = dbPath;
    this.schema = schema;
  }
  
  async initialize() {
    this.db = new sqlite3.Database(this.dbPath);
    // Promisify methods
    await this.applySchema();
  }
  
  async applySchema() {
    for (const [table, definition] of Object.entries(this.schema.tables)) {
      await this.db.run(`CREATE TABLE IF NOT EXISTS ${table} (${definition})`);
    }
    for (const [index, definition] of Object.entries(this.schema.indexes)) {
      await this.db.run(`CREATE INDEX IF NOT EXISTS ${index} ON ${definition}`);
    }
  }
  
  async transaction(callback) {
    await this.db.run('BEGIN TRANSACTION');
    try {
      const result = await callback(this.db);
      await this.db.run('COMMIT');
      return result;
    } catch (err) {
      await this.db.run('ROLLBACK');
      throw err;
    }
  }
}
```

**Migration Steps:**
1. Create repository-base.mjs with core abstractions
2. Migrate a2a-reliability-layer (cleanest implementation)
3. Migrate remaining modules one per PR
4. Delete duplicate code

**Benefit:** Reduces code duplication from ~500 lines to ~50 lines; centralizes migration logic.

---

### P0.2: Implement Workflow Engine OR Remove From Architecture
**Files:** `src/deal-room-workflow.mjs`, `ARCHITECTURE.md`  
**Effort:** L (if implementing) / S (if removing)  
**Risk:** High (if implementing) / Low (if removing)

**Problem:** Module is 100% stub implementation but documented as core feature.

**Current State:**
```javascript
export async function createWorkflow(templateId, config, creatorAgentId) {
  throw new Error('Not implemented: createWorkflow');
}
// All 20+ functions throw
```

**Options:**

**A. Remove from architecture (Recommended)**
- Update ARCHITECTURE.md to remove workflow references
- Delete deal-room-workflow.mjs
- Restore when Phase 8 is actually implemented

**B. Implement minimal viable version**
- Sequential stage progression
- Basic gate evaluation
- Context inheritance

**Decision:** Option A. The current stubs create false expectations and maintenance burden.

---

### P0.3: Extract Circuit Breaker to Shared Module
**File:** `src/circuit-breaker.mjs` (new)  
**Effort:** S  
**Risk:** Low

**Problem:** Circuit breaker logic duplicated in a2a-reliability-layer.mjs and a2a-discovery-registry.mjs.

**Current Duplication:**
- Identical `CircuitState` enum
- Similar `getCircuitBreaker()`, `updateCircuitState()`, `isCircuitClosed()` functions
- Different failure thresholds and cooldowns

**Recommendation:**
```javascript
// src/circuit-breaker.mjs
export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.cooldownMs = options.cooldownMs || 60000;
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }
  
  recordSuccess() { /* ... */ }
  recordFailure() { /* ... */ }
  canAttempt() { /* ... */ }
  getState() { /* ... */ }
}

export const circuitBreakerRegistry = new Map();

export function getCircuitBreaker(key, options) {
  if (!circuitBreakerRegistry.has(key)) {
    circuitBreakerRegistry.set(key, new CircuitBreaker(options));
  }
  return circuitBreakerRegistry.get(key);
}
```

---

## P1 - High Priority (Do Within 2 Sprints)

### P1.1: Standardize Error Handling
**Files:** All modules  
**Effort:** M  
**Risk:** Medium

**Problem:** Inconsistent error handling patterns:
- Some functions throw
- Some return `{success, error}`
- Some return null
- Some log and swallow errors

**Recommendation:**

```javascript
// src/errors.mjs
export class MeshError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends MeshError {
  constructor(message, details) {
    super('VALIDATION_ERROR', message, details);
  }
}

export class NotFoundError extends MeshError {
  constructor(resource, id) {
    super('NOT_FOUND', `${resource} not found: ${id}`);
  }
}

// Result type for operations that can fail
export class Result {
  constructor(ok, value, error) {
    this.ok = ok;
    this.value = value;
    this.error = error;
  }
  
  static success(value) {
    return new Result(true, value, null);
  }
  
  static failure(error) {
    return new Result(false, null, error);
  }
  
  map(fn) {
    return this.ok ? Result.success(fn(this.value)) : this;
  }
  
  unwrap() {
    if (!this.ok) throw this.error;
    return this.value;
  }
}
```

**Migration:**
```javascript
// Before
async function getRoom(roomId) {
  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Room not found: ${roomId}`);  // throws
  }
}

// After
async function getRoom(roomId) {
  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    return Result.success(JSON.parse(content));
  } catch (err) {
    return Result.failure(new NotFoundError('room', roomId));
  }
}
```

---

### P1.2: Replace Singletons with Dependency Injection
**Files:** `src/token-manager.mjs`, `src/token-store.mjs`, `src/queue-manager.mjs`  
**Effort:** M  
**Risk:** Medium

**Problem:** Singleton pattern complicates testing and hides dependencies.

**Current Pattern:**
```javascript
let tokenManagerInstance = null;
export async function getTokenManager(options) {
  if (!tokenManagerInstance) {
    tokenManagerInstance = new TokenManager(options);
  }
  return tokenManagerInstance;
}
```

**Recommendation:**

```javascript
// src/composition-root.mjs (new)
export async function createApp(config) {
  const tokenStore = await createTokenStore(config.tokenStore);
  const tokenManager = new TokenManager({ tokenStore, ...config });
  const queueManager = new QueueManager({ ...config });
  
  const dealRoomService = new DealRoomService({
    tokenManager,
    auditLog,
    config
  });
  
  const plugin = new MeshMemoryPlugin({
    dealRoomService,
    tokenManager,
    queueManager
  });
  
  return { plugin, services: { dealRoomService, tokenManager } };
}
```

**Benefits:**
- Clear dependency graph
- Easy mocking for tests
- No hidden state
- Explicit lifecycle management

---

### P1.3: Centralize Configuration
**File:** `config.mjs`  
**Effort:** S  
**Risk:** Low

**Problem:** Configuration scattered across files with hardcoded defaults.

**Current Issues:**
```javascript
// token-service.mjs
const ROTATION_CHECK_INTERVAL = process.env.MESH_TOKEN_ROTATION_INTERVAL || 5 * 60 * 1000;

// queue-manager.mjs
const DB_PATH = process.env.MESH_QUEUE_DB_PATH || path.join(process.env.HOME, '...');

// Various files
const DEAL_ROOMS_DIR = 'memory/deal-rooms';  // hardcoded
```

**Recommendation:**

```javascript
// config.mjs - enhanced
export const configSchema = {
  persistence: {
    baseDir: { env: 'MESH_BASE_DIR', default: 'memory' },
    dealRoomsDir: { default: '${baseDir}/deal-rooms' },
    auditDir: { default: '${baseDir}/audit' },
    policiesDir: { default: '${baseDir}/policies' }
  },
  tokenService: {
    rotationIntervalMs: { env: 'MESH_TOKEN_ROTATION_INTERVAL', default: 300000 },
    ttlHours: { env: 'MESH_TOKEN_TTL_HOURS', default: 24 }
  },
  queueManager: {
    dbPath: { env: 'MESH_QUEUE_DB_PATH', default: '${baseDir}/queue.db' },
    maxRetries: { default: 5 }
  }
};

export function loadConfig() {
  // Validate all required values present
  // Substitute ${variable} references
  // Return frozen config object
}
```

---

## P2 - Medium Priority (Do Within Quarter)

### P2.1: Extract Health/Metrics to Shared Module
**File:** `src/health-metrics.mjs` (new)  
**Effort:** M  
**Risk:** Low

**Problem:** Each service implements its own health checks and metrics collection.

**Recommendation:**

```javascript
// src/health-metrics.mjs
export class HealthCheckRegistry {
  constructor() {
    this.checks = new Map();
  }
  
  register(name, checkFn) {
    this.checks.set(name, checkFn);
  }
  
  async checkAll() {
    const results = {};
    for (const [name, fn] of this.checks) {
      try {
        const start = Date.now();
        const result = await fn();
        results[name] = { status: 'ok', latency: Date.now() - start, ...result };
      } catch (err) {
        results[name] = { status: 'error', error: err.message };
      }
    }
    return results;
  }
}

export class MetricsCollector {
  constructor(intervalMs = 60000) {
    this.metrics = [];
    this.intervalMs = intervalMs;
  }
  
  record(name, value, labels = {}) {
    this.metrics.push({
      timestamp: Date.now(),
      name,
      value,
      labels
    });
  }
  
  query(name, timeRange, aggregation = 'avg') {
    // Prometheus-style queries
  }
}
```

---

### P2.2: Create Repository Layer for Deal Rooms
**File:** `src/repositories/deal-room-repository.mjs` (new)  
**Effort:** M  
**Risk:** Medium

**Problem:** deal-room.mjs mixes domain logic (room lifecycle) with persistence (file operations, JSON serialization).

**Current State:**
```javascript
// deal-room.mjs
export async function getRoom(roomId) {
  const manifestPath = join(getRoomPath(roomId), 'manifest.json');
  const content = await fs.readFile(manifestPath, 'utf8');
  return JSON.parse(content);  // persistence leaking
}
```

**Recommendation:**

```javascript
// src/repositories/deal-room-repository.mjs
export class DealRoomRepository {
  constructor(storage) {
    this.storage = storage;  // Abstract: could be files, SQLite, S3
  }
  
  async findById(roomId) {
    return this.storage.get(`deal-rooms/${roomId}/manifest.json`);
  }
  
  async save(manifest) {
    await this.storage.put(`deal-rooms/${manifest.roomId}/manifest.json`, manifest);
  }
  
  async list(filters = {}) {
    const roomIds = await this.storage.list('deal-rooms/');
    const rooms = await Promise.all(
      roomIds.map(id => this.findById(id).catch(() => null))
    );
    return rooms.filter(r => r && this.matchesFilters(r, filters));
  }
}

// src/deal-room.mjs - domain logic only
export class DealRoomService {
  constructor(repository, auditLog, tokenService) {
    this.repository = repository;
    this.auditLog = auditLog;
    this.tokenService = tokenService;
  }
  
  async createRoom(purpose, scope, policy, participants, creatorId) {
    // Domain validation
    if (!purpose || typeof purpose !== 'string') {
      throw new ValidationError('Purpose required');
    }
    
    // Create domain object
    const room = new DealRoom({
      roomId: generateRoomId(),
      purpose,
      scope,
      policy,
      state: RoomState.PENDING_CONSENT,
      participants: [],
      pendingConsents: participants.map(p => ({...p, status: 'pending'}))
    });
    
    // Persist via repository
    await this.repository.save(room);
    
    // Audit
    await this.auditLog.record('ROOM_CREATED', creatorId, { roomId: room.roomId });
    
    return room;
  }
}
```

---

### P2.3: Add Integration Tests for Cross-Module Operations
**Directory:** `tests/integration/`  
**Effort:** L  
**Risk:** Low

**Problem:** No tests verify that modules work together (e.g., Deal Room + Consensus + Audit).

**Recommended Tests:**

```javascript
// tests/integration/deal-room-consensus.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { createTestApp } from '../helpers/test-app.js';

test('deal room proposal triggers consensus', async () => {
  const { services } = await createTestApp();
  
  // Create room
  const room = await services.dealRoom.createRoom(
    'Test', { topics: ['test'] }, { consensusRequired: 'majority' },
    [{ agentId: 'agent-a', role: 'negotiator' }],
    'creator'
  );
  
  // Create proposal
  const proposal = await services.consensus.proposeDecision(
    room.roomId,
    { type: 'test', content: 'value' },
    'rationale',
    'agent-a'
  );
  
  // Verify audit log
  const audit = await services.audit.query({ roomId: room.roomId });
  assert.ok(audit.some(e => e.event === 'PROPOSAL_CREATED'));
});
```

---

## P3 - Low Priority (Nice to Have)

### P3.1: Consider Event Sourcing for Audit Trail
**File:** `src/event-sourcing/` (new module)  
**Effort:** L  
**Risk:** High

**Problem:** Current hash-chained logs are good but don't support temporal queries well.

**Recommendation:** Evaluate migrating to event sourcing pattern where:
- All state changes are events
- Events are append-only
- Projections for read models
- Event handlers for cross-module communication

**Benefits:**
- Complete history of all changes
- Temporal queries ("what was true at time T")
- Replay for debugging
- Natural audit trail

**Costs:**
- Significant refactoring
- Learning curve
- Event schema versioning complexity

---

### P3.2: Add OpenAPI/Swagger Documentation
**File:** `docs/api/openapi.yaml`  
**Effort:** M  
**Risk:** Low

Generate API documentation from code annotations or separate spec.

---

### P3.3: Implement Plugin API Contract
**File:** `src/plugin-contract.mjs`  
**Effort:** S  
**Risk:** Low

Formalize plugin interface with explicit lifecycle hooks.

---

## Summary Table

| Priority | Item | Effort | Risk | Benefit |
|----------|------|--------|------|---------|
| P0.1 | DB Abstractions | M | Medium | -500 LOC, central migrations |
| P0.2 | Workflow Engine | L/S | High/Low | Honest architecture |
| P0.3 | Circuit Breaker | S | Low | -200 LOC, single implementation |
| P1.1 | Error Handling | M | Medium | Consistent patterns, easier debugging |
| P1.2 | Dependency Injection | M | Medium | Testable, clear dependencies |
| P1.3 | Centralized Config | S | Low | Easier deployment, validation |
| P2.1 | Health/Metrics | M | Low | Observable, maintainable |
| P2.2 | Repository Layer | M | Medium | Clean Architecture compliance |
| P2.3 | Integration Tests | L | Low | Confidence in system behavior |
| P3.1 | Event Sourcing | L | High | Temporal queries, complete history |

---

## Implementation Order

**Phase 1 (Week 1-2): Foundations**
1. P0.3: Circuit Breaker extraction (quick win)
2. P1.3: Centralized config (enables other changes)
3. P0.2: Workflow decision (remove or commit)

**Phase 2 (Week 3-4): Abstractions**
4. P0.1: DB abstractions (start with one module)
5. P1.1: Error handling (standardize as you go)

**Phase 3 (Week 5-6): Architecture**
6. P1.2: Dependency injection (composition root)
7. P2.2: Repository layer (per module)

**Phase 4 (Ongoing): Quality**
8. P2.1: Health/Metrics
9. P2.3: Integration tests

---

*Recommendations based on Clean Architecture, DDD, and 12-Factor App principles. Prioritized by impact on maintainability and correctness.*
