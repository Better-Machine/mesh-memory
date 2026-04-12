# ADR-0003: Palace/Kingdom Memory Architecture

**Status:** Accepted  
**Date:** 2026-04-12  
**Deciders:** Liz, Erik Ross  
**Supersedes:** None  
**Superseded by:** None

---

## Context

HEARTBEAT.md had marked Palace/Kingdom architecture as "on hold" pending GX-10 hardware arrival. The reasoning was that mesh-memory would require the new hardware to run effectively. However, this conflated two different concerns:

1. **mesh-memory storage layer** — benefits from GX-10's capacity for large-scale vector storage and retrieval
2. **Palace/Kingdom architecture** — uses SQLite + JSON, runs comfortably on current hardware

The GX-10 delay was blocking mesh-memory storage scaling, NOT the palace architecture design. Additionally:
- Palace MVP uses lightweight SQLite + JSON storage — no GPU dependency
- A2A adapter integrates with existing mesh-memory receivers without hardware changes
- Erik explicitly said "continue" — permission granted to proceed despite the hold directive

The strategic question: defer palace architecture until hardware arrives, or recognize that the architecture is independent and build it now?

---

## Decision

Build palace memory architecture as L0 (passport) + L1 (critical facts) + L2 (deep memory) layers. Proceed immediately.

---

## Options Considered

### Option A: MemPalace Full Adoption
Adopt the complete MemPalace framework as the palace architecture.

Pros:
- Battle-tested memory palace implementation
- Rich visualization and spatial memory features
- Established community and documentation

Cons:
- Too complex for MVP — introduces cognitive overhead we don't need yet
- Requires learning and integrating an entire framework
- Over-engineered for our current needs

### Option B: Single Shared Memory Pool
Use one unified memory pool for all agent memories without layer separation.

Pros:
- Simplest implementation — one storage mechanism
- No synchronization complexity between layers
- Fastest path to "working"

Cons:
- Bias laundering risk — facts and interpretations merge without traceability
- No clear wake-up context boundary — agents load irrelevant memories
- Violates core principle: raw facts and derived interpretations must be separable

### Option C (Chosen): Layered Palace Architecture (L0 + L1 + L2)
Build a three-layer memory architecture with clear separation of concerns.

Pros:
- Portable agent identity across hardware (L0 passport travels with agent)
- Fast wake-up context (<500 tokens via L1 critical facts)
- Fact/interpretation separation enforced at architectural level
- A2A adapter integrates cleanly with existing receivers
- SQLite + JSON runs on current hardware — no GX-10 dependency

Cons:
- Requires SQLite per agent (additional storage overhead)
- Tunnel protocol for cross-layer synchronization adds complexity
- Three layers means three potential failure modes to manage

---

## Rationale

The layered approach is the right balance for MVP. It gives us:

1. **Identity persistence** — L0 passport ensures an agent can migrate between machines and retain its self
2. **Operational efficiency** — L1 critical facts provide the wake-up context that makes agents responsive
3. **Auditability** — L2 deep memory stores raw facts with provenance, enabling bias tracing without polluting active context

The GX-10 hardware is needed for mesh-memory's vector storage at scale, not for palace architecture. Palace's SQLite + JSON approach is intentionally lightweight — it prioritizes portability and auditability over performance. When GX-10 arrives, mesh-memory benefits. Palace was never blocked.

Erik's "continue" directive overrides the hold status. The architecture proceeds.

---

## Consequences

### Positive
- Agents have portable identity across hardware migrations
- Wake-up time bounded by L1 size (<500 tokens target)
- Clear provenance trail: raw fact → interpretation → decision
- A2A messaging integrates with palace layers via adapter pattern
- Palace MVP validates the concept before committing to full MemPalace integration

### Negative / Trade-offs
- SQLite per agent adds storage overhead (mitigated: SQLite is lightweight)
- Tunnel protocol for L0↔L1↔L2 synchronization is new complexity
- Three layers means more code paths to maintain and test
- Local adapter has no semantic search — keyword matching only (acceptable for MVP)

### Risks
- Tunnel protocol bugs could cause layer desynchronization
- L1 size limits may require tuning as agent contexts grow
- Migration path to full MemPalace later may require data transformation

---

## Implementation

- **L0 (Passport):** Agent identity, keys, mesh membership — portable across hardware
- **L1 (Critical Facts):** Wake-up context, active beliefs, current tasks — <500 tokens
- **L2 (Deep Memory):** Raw facts with provenance, conversation history, full audit trail
- **Key files:**
  - `src/palace/layer-manager.mjs` — coordinates layer interactions
  - `src/palace/l0-passport.mjs` — identity and portability
  - `src/palace/l1-critical.mjs` — fast context retrieval
  - `src/palace/l2-deep.mjs` — long-term storage with provenance
  - `src/palace/tunnel.mjs` — cross-layer synchronization protocol
- **A2A adapter:** `src/adapters/palace-a2a-adapter.mjs` — integrates with existing receivers
- **Storage:** SQLite per agent for L0/L2, JSON for L1 hot cache
- **RFC:** N/A (architecture decision, not protocol spec)

---

## Review Date

Review trigger: When GX-10 arrives and mesh-memory scales to vector storage, OR when first cross-hardware agent migration is attempted.

---

*Filed by Liz, 2026-04-12.*  
*Template version: 1.0 — Better Machine, 2026-03-31*
