# Mesh-Memory Testing & QA Strategy

**Version:** 1.0.0  
**Last Updated:** 2026-04-13  
**Owner:** Liz (@LizSquirrelBot)  
**Status:** Draft → Implementation Ready

---

## Executive Summary

This document defines the comprehensive testing strategy for the mesh-memory system. It establishes testing philosophy, categorization, infrastructure, and execution patterns to ensure code quality, reliability, and confidence in every release.

### Key Principles

1. **Tests written WITH features, not after** — No PR without accompanying tests
2. **Every PR must pass full regression before merge** — No exceptions
3. **3-node integration tests are mandatory** — Mesh behavior must be validated
4. **Coverage target: 80%+** — Measured and enforced
5. **Automated CI/CD** — Zero manual testing gates

---

## Test Categories

### 1. Unit Tests (Jest/Vitest)

**Scope:** Individual functions, modules, and pure logic

| Component | Priority | Coverage Target |
|-----------|----------|-----------------|
| Message encoding/decoding | P0 | 100% |
| Authentication middleware | P0 | 100% |
| Memory pool operations | P0 | 90% |
| Sync conflict resolution | P0 | 90% |
| Privacy filter (privacy.mjs) | P0 | 95% |
| Lesson tagger | P1 | 80% |
| Config loader | P1 | 90% |
| Vector store operations | P1 | 75% |

**Key Test Patterns:**
- Pure function testing with edge cases
- Mock external dependencies (fs, network, DB)
- Property-based testing for validation functions
- Error condition coverage

### 2. Integration Tests

**Scope:** Component interactions, database operations, HTTP endpoints

| Scenario | Priority | Description |
|----------|----------|-------------|
| 2-node message relay | P0 | Verify relay → receiver pipeline |
| 3-node memory sync | P0 | Full mesh synchronization |
| Node failure recovery | P0 | Graceful degradation |
| Network partition handling | P1 | Split-brain detection |
| Auth token validation | P0 | Bearer token lifecycle |
| Thread lifecycle | P0 | Open → work → close |
| Shared pool read/write | P0 | Blind gate operations |

**Infrastructure:**
- Docker Compose for isolated environments
- Testcontainers for ephemeral services
- SQLite in-memory for DB tests

### 3. Regression Suite

**Scope:** Automated verification that changes don't break existing functionality

**Execution:**
- Runs on every PR via GitHub Actions
- Must pass before merge to `main`
- Full test matrix: Node 18, 20, 22

**Test Selection:**
```
- All unit tests
- All integration tests
- Critical path e2e tests
- Smoke tests for core flows
```

### 4. Stress Tests

**Scope:** Performance and stability under load

| Metric | Target | Tolerance |
|--------|--------|-----------|
| Message throughput | 1000 msg/sec | ±10% |
| Memory pool capacity | 10K entries | No OOM |
| Sync lag | <5s p95 | <10s p99 |
| CPU overhead | <5% at 10 msg/min | N/A |

**Existing Coverage:**
- `stress-test.mjs` — Burst write, sustained write, receiver delivery
- Malformed event rejection
- Unauthorized access rejection

**Planned Additions:**
- 3-node concurrent stress
- Memory leak detection
- Connection pool exhaustion
- Thread contention under load

### 5. End-to-End Tests

**Scope:** Full user journeys and cross-system flows

| Flow | Description |
|------|-------------|
| Agent A → Mesh → Agent B receives | Basic relay |
| Full mesh: All 3 nodes communicate | Complete mesh |
| Persistence: Restart node, memory intact | Durability |
| Thread collaboration: 3 agents, 1 thread | Shared context |
| Dream cycle: nightly consolidation | Automated workflow |

---

## Test Infrastructure

### Directory Structure

```
testing/
├── MESH_TEST_STRATEGY.md          # This document
├── MESH_TEST_FRAMEWORK/           # Test utilities
│   ├── jest.config.js             # Jest configuration
│   ├── vitest.config.js           # Vitest configuration (alternative)
│   ├── mocks/                     # Mock implementations
│   │   ├── fs.mock.mjs
│   │   ├── network.mock.mjs
│   │   ├── sqlite.mock.mjs
│   │   └── config.mock.mjs
│   ├── helpers/                   # Test utilities
│   │   ├── test-helpers.mjs
│   │   ├── fixtures.mjs
│   │   └── assertions.mjs
│   └── docker/                    # Docker Compose configs
│       ├── docker-compose.test.yml
│       └── Dockerfile.test
├── unit/                          # Unit tests (mirrors src structure)
│   ├── privacy.test.mjs
│   ├── lesson-tagger.test.mjs
│   ├── config.test.mjs
│   └── ...
├── integration/                   # Integration tests
│   ├── shared-pool.test.mjs
│   ├── thread-lifecycle.test.mjs
│   ├── relay-pipeline.test.mjs
│   └── ...
├── e2e/                          # End-to-end tests
│   ├── mesh-communication.test.mjs
│   ├── persistence.test.mjs
│   └── ...
└── stress/                       # Stress & load tests
    ├── throughput.test.mjs
    ├── memory-leak.test.mjs
    └── ...
```

### Docker Compose Configuration

**File:** `testing/MESH_TEST_FRAMEWORK/docker/docker-compose.test.yml`

```yaml
version: '3.8'
services:
  # Agent A (Alice)
  agent-a:
    build:
      context: ../../..
      dockerfile: testing/MESH_TEST_FRAMEWORK/docker/Dockerfile.test
    environment:
      - AGENT_ID=alice
      - RECEIVER_PORT=18801
      - PEERS=bob,charlie
    networks:
      - mesh-test
    volumes:
      - agent-a-data:/data

  # Agent B (Bob)
  agent-b:
    build:
      context: ../../..
      dockerfile: testing/MESH_TEST_FRAMEWORK/docker/Dockerfile.test
    environment:
      - AGENT_ID=bob
      - RECEIVER_PORT=18801
      - PEERS=alice,charlie
    networks:
      - mesh-test
    volumes:
      - agent-b-data:/data

  # Agent C (Charlie)
  agent-c:
    build:
      context: ../../..
      dockerfile: testing/MESH_TEST_FRAMEWORK/docker/Dockerfile.test
    environment:
      - AGENT_ID=charlie
      - RECEIVER_PORT=18801
      - PEERS=alice,bob
    networks:
      - mesh-test
    volumes:
      - agent-c-data:/data

  # Test Runner
  test-runner:
    build:
      context: ../../..
      dockerfile: testing/MESH_TEST_FRAMEWORK/docker/Dockerfile.test
    depends_on:
      - agent-a
      - agent-b
      - agent-c
    command: npm run test:integration
    networks:
      - mesh-test

networks:
  mesh-test:
    driver: bridge

volumes:
  agent-a-data:
  agent-b-data:
  agent-c-data:
```

---

## GitHub Actions CI Pipeline

**File:** `.github/workflows/test.yml`

```yaml
name: Test Suite

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  unit-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm run test:unit
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run integration tests
        run: |
          docker-compose -f testing/MESH_TEST_FRAMEWORK/docker/docker-compose.test.yml up --abort-on-container-exit

  stress-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:stress

  coverage-report:
    runs-on: ubuntu-latest
    needs: [unit-tests, integration-tests]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:coverage
      - name: Check coverage threshold
        run: |
          npx nyc check-coverage --lines 80 --functions 80 --branches 70
```

---

## Test Utilities & Mock Framework

### Core Mock Modules

**Mock File System (`mocks/fs.mock.mjs`):**
```javascript
import { mock, fn } from 'jest-mock';

export function createMockFs() {
  const files = new Map();
  
  return {
    readFile: fn((path) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return Promise.resolve(files.get(path));
    }),
    writeFile: fn((path, data) => {
      files.set(path, data);
      return Promise.resolve();
    }),
    existsSync: fn((path) => files.has(path)),
    mkdir: fn(() => Promise.resolve()),
    __getFiles: () => files,
    __reset: () => files.clear(),
  };
}
```

**Mock SQLite (`mocks/sqlite.mock.mjs`):**
```javascript
export function createMockSQLite() {
  const db = new Map();
  let idCounter = 1;
  
  return {
    prepare: (sql) => ({
      run: (params) => {
        const id = idCounter++;
        db.set(id, { ...params, id });
        return { lastInsertRowid: id };
      },
      get: (params) => {
        // Query implementation
      },
      all: () => Array.from(db.values()),
    }),
    exec: () => {},
    close: () => {},
    __getDb: () => db,
    __reset: () => db.clear(),
  };
}
```

### Test Helpers

**Test Data Factory (`helpers/fixtures.mjs`):**
```javascript
import { randomUUID } from 'node:crypto';

export function createMemoryEvent(overrides = {}) {
  return {
    agentId: `agent-${randomUUID().slice(0, 8)}`,
    role: 'test',
    content: 'Test content',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

export function createThreadContext(overrides = {}) {
  return {
    id: randomUUID(),
    purpose: 'Test thread',
    scope: ['test-data'],
    participants: ['alice', 'bob'],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createPoolEntry(overrides = {}) {
  return {
    id: randomUUID(),
    type: 'fact',
    category: 'test',
    fact: 'Test fact',
    tags: ['test'],
    provenance: {
      source_agent: 'test-agent',
      timestamp: new Date().toISOString(),
      basis: 'observed',
      confidence: 0.9,
    },
    ...overrides,
  };
}
```

---

## Coverage Targets

### By Component

| Component | Lines | Functions | Branches |
|-----------|-------|-----------|----------|
| Authentication | 100% | 100% | 100% |
| Privacy Filter | 95% | 95% | 90% |
| Shared Pool | 90% | 90% | 85% |
| Thread Manager | 85% | 85% | 80% |
| Memory Relay | 85% | 85% | 80% |
| Memory Receiver | 85% | 85% | 80% |
| Config | 90% | 90% | 85% |
| **Overall** | **80%** | **80%** | **70%** |

### Coverage Exclusions

```json
{
  "coveragePathIgnorePatterns": [
    "/node_modules/",
    "/tests/",
    "/testing/",
    ".test.mjs$",
    ".spec.mjs$"
  ],
  "coverageThreshold": {
    "global": {
      "lines": 80,
      "functions": 80,
      "branches": 70
    }
  }
}
```

---

## Test Execution Commands

```bash
# Run all tests
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run e2e tests
npm run test:e2e

# Run stress tests
npm run test:stress

# Run with coverage
npm run test:coverage

# Run specific test file
node --test testing/unit/privacy.test.mjs

# Run tests matching pattern
node --test --test-name-pattern="privacy"

# Docker-based integration tests
npm run test:docker

# Watch mode (for development)
npm run test:watch
```

---

## Testing Checklist for PRs

Before submitting a PR:

- [ ] New feature has accompanying unit tests
- [ ] Integration tests updated for new interactions
- [ ] All existing tests pass (`npm test`)
- [ ] Coverage remains above 80%
- [ ] Stress tests pass if performance-sensitive
- [ ] No hardcoded secrets or IPs in tests
- [ ] Test data is isolated (no shared state)
- [ ] Mock implementations don't leak between tests
- [ ] Docker compose tests pass (for mesh changes)

---

## Migration Plan from Current State

### Current State Assessment

**Existing Tests:**
- `tests/shared-pool.test.mjs` — Comprehensive shared pool tests ✅
- `tests/memory-backend.test.mjs` — Backend adapter tests ✅
- `tests/palace-mvp-final.test.mjs` — 21 tests, all passing ✅
- `tests/bug-fixes.test.mjs` — 82 regression tests ✅
- `stress-test.mjs` — Basic stress tests ✅

**Gap Analysis:**
1. ❌ No centralized Jest/Vitest configuration
2. ❌ No mock framework for isolated unit tests
3. ❌ No Docker Compose for 3-node integration
4. ❌ No CI/CD pipeline definition
5. ❌ No coverage reporting automation
6. ❌ Test directory structure mixed with src

### Migration Steps

**Phase 1: Framework Setup (Week 1)**
1. Create `testing/` directory structure
2. Set up Jest/Vitest configuration
3. Create mock framework modules
4. Migrate existing tests to new structure

**Phase 2: Test Expansion (Week 2-3)**
1. Write missing unit tests for core modules
2. Create Docker Compose 3-node setup
3. Expand integration test coverage
4. Add e2e test suite

**Phase 3: CI/CD Integration (Week 4)**
1. Create GitHub Actions workflow
2. Set up coverage reporting
3. Configure branch protection rules
4. Document test execution procedures

---

## Appendix A: Current Test Inventory

| Test File | Count | Status | Notes |
|-----------|-------|--------|-------|
| `shared-pool.test.mjs` | ~50 | ✅ PASS | Shared pool read/write/gate/sync |
| `memory-backend.test.mjs` | 15 | ✅ PASS | Local adapter, Mem0 adapter |
| `palace-mvp-final.test.mjs` | 21 | ✅ PASS | CriticalFactsLoader, TunnelPublisher |
| `bug-fixes.test.mjs` | 82 | ✅ PASS | Regression suite |
| `tunnel-publisher.test.mjs` | 8 | ✅ PASS | Validation functions |
| `tunnel-publisher.integration.test.mjs` | 12 | ✅ PASS | Integration scenarios |
| `a2a-palace-adapter.test.mjs` | 6 | ✅ PASS | Adapter tests |
| `a2a-palace-adapter.e2e.test.mjs` | 10 | ✅ PASS | E2E flows |
| `kingdom-consensus.test.mjs` | 15 | ✅ PASS | Consensus protocol |
| `palace-mvp.test.mjs` | 18 | ✅ PASS | MVP validation |
| `critical-facts-loader.test.mjs` | 22 | ✅ PASS | Loader unit tests |

**Total Existing Tests:** ~259

---

## Appendix B: Key Testing Patterns

### Pattern 1: Module Reload for Isolation

```javascript
// Force re-import to avoid module caching issues
const { writeEntry } = await import(`../shared-pool-write.mjs?t=${Date.now()}`);
```

### Pattern 2: Test Directory Isolation

```javascript
const TEST_DIR = path.join(__dirname, '.test-data-' + process.pid);

before(async () => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

after(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});
```

### Pattern 3: Config Injection for Tests

```javascript
const configPath = resolve(ROOT, "mesh-memory.config.local.json");
const origConfig = existsSync(configPath) ? readFileSync(configPath, "utf-8") : null;

writeFileSync(configPath, JSON.stringify(testConfig));
const { resetConfig } = await import("../config.mjs");
resetConfig();

// ... run tests ...

// Restore original config
if (origConfig !== null) {
  writeFileSync(configPath, origConfig);
} else if (existsSync(configPath)) {
  rmSync(configPath);
}
resetConfig();
```

---

## Appendix C: Resources

- [Node.js Test Runner Documentation](https://nodejs.org/api/test.html)
- [Jest Documentation](https://jestjs.io/)
- [Vitest Documentation](https://vitest.dev/)
- [Testcontainers for Node.js](https://node.testcontainers.org/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

---

*This document is a living specification. Update it as testing practices evolve.*
