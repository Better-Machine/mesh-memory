# ADR-0002: Memory Backend Abstraction Interface

**Status:** Accepted
**Date:** 2026-04-03
**Deciders:** Liz (.23), Erik Ross
**Supersedes:** None
**Superseded by:** None

---

## Context

ADR-0001 established that mesh-memory should not compete with Mem0 on storage and retrieval. Instead, mesh-memory's value is in coordination, identity, consent gating, bias resistance, and multi-agent thread management — the "mesh" layer above storage.

However, the codebase currently has storage logic embedded directly in components (markdown files in memory-watcher, JSON in shared-pool-write, etc.). There is no abstraction boundary between "how memories are stored/retrieved" and "how memories are coordinated across agents."

This creates two problems:
1. Adopting Mem0 as a storage backend requires rewriting internals rather than swapping an adapter.
2. Users who want to run mesh-memory offline or in air-gapped environments have no clean fallback path.

We need a clean interface seam so backends are swappable without touching coordination logic.

---

## Decision

We will introduce a `MemoryBackend` interface (`src/backends/memory-backend.interface.mjs`) that defines provider-agnostic CRUD + search operations. All memory backends implement this contract. A factory function (`createMemoryBackend`) reads config and returns the correct adapter.

---

## Options Considered

### Option A: Direct Mem0 Integration
Embed Mem0 SDK calls directly into existing components.

Pros:
- Fastest path to working integration
- No new abstraction layer

Cons:
- Tight coupling — switching providers means rewriting
- No offline fallback
- Violates ADR-0001's separation principle

### Option B: Full ORM / Storage Framework
Adopt a general-purpose storage abstraction (e.g., Knex, Prisma-like pattern).

Pros:
- Battle-tested patterns
- Query builder flexibility

Cons:
- Massive over-engineering for 6 methods
- Pulls in heavy dependencies
- Memory operations are simple CRUD + search, not relational queries

### Option C (Chosen): Minimal Interface + Adapter Pattern
Define a 6-method interface. Two adapters: local (JSON files) and Mem0 (dynamic import).

Pros:
- Minimal surface area — easy to implement new backends
- No new dependencies (local adapter is zero-dep, Mem0 adapter lazy-loads)
- Clean seam for testing (mock any adapter)
- Users can run offline with local, upgrade to Mem0 by changing one config field

Cons:
- Local adapter has no semantic search (keyword matching only)
- Interface may need extension as mesh-memory evolves (e.g., batch operations)

---

## Rationale

The adapter pattern is the right level of abstraction for this problem. We have a small, stable set of operations (add, search, getAll, delete, deleteAll, update) and a small number of backends (2 today, possibly 3-4 ever). A factory function with config-driven selection is the simplest thing that could work.

The local adapter serves three purposes: development convenience, offline/air-gapped operation, and a concrete reference implementation for the interface contract. Its keyword search is intentionally basic — semantic search is Mem0's value proposition, not ours.

Dynamic import for mem0ai means the package is only required when actually configured. This avoids forcing a dependency on users who only want local storage.

---

## Consequences

### Positive
- Clean separation between storage and coordination layers
- Mem0 integration becomes a config change, not a code rewrite
- Offline-first development is the default (local backend)
- Contract tests ensure all backends behave identically
- Future backends (e.g., Qdrant direct, Postgres pgvector) can be added by implementing 6 methods

### Negative / Trade-offs
- Local adapter's keyword search is a poor substitute for semantic search — users may be surprised by quality difference
- Interface is opinionated toward Mem0's API shape (messages array, search with query string) — other providers may need shimming
- Adding a new method to the interface requires updating all adapters

### Risks
- If Mem0's API changes significantly, the adapter will need updating (mitigated by pinning mem0ai version)
- The interface may be too simple for advanced use cases (batch operations, streaming) — we accept this and will extend when needed

---

## Implementation

- Key files: `src/backends/memory-backend.interface.mjs`, `src/backends/local-adapter.mjs`, `src/backends/mem0-adapter.mjs`, `src/backends/index.mjs`
- Config: `mesh-memory.config.json` — `memory.backend` field
- Tests: `tests/memory-backend.test.mjs`
- PR: liz/memory-backend-abstraction → main

---

## Review Date

Review trigger: When mesh-memory integrates its first non-trivial Mem0 workflow (not just CRUD), or when a third backend is requested.

---

*Filed by Liz (.23), 2026-04-03.*
