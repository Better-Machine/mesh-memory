# ADR-0004: Presence Protocol Integration with Palace/Kingdom

**Status:** Proposed  
**Date:** 2026-04-12  
**Deciders:** Liz  
**Supersedes:** None  
**Superseded by:** None

---

## Context

Mesh-memory now has a receiver (port 18803) and tunnel protocol for A2A messaging. Agents in the mesh need to know:
- Who is currently online and available
- What context peers are operating in (e.g., "Ray is in session about clean_sl8")
- Current user focus (e.g., "Erik is in mesh_memory context")

Palace architecture defines L0 (passport), L1 (critical facts), and L2 (deep memory). Presence information is ephemeral but needs to influence L1 wake-up context. The question: where does presence live in this architecture, and how does it flow into agent consciousness?

Key constraints:
- Presence is ephemeral — it expires quickly (peers go offline)
- Presence must be queryable during heartbeat — "who is here now?"
- Presence should inform but not pollute L1 — synthesized, not raw
- Consensus (Kingdom) is expensive — presence may not need strong consistency

---

## Decision

Presence lives in a **dedicated ephemeral layer (L1.5)** with its own SQLite table (`presence_active`), synced on-demand via mesh query at heartbeat time, and synthesized into L1 critical facts. Presence messages bypass Kingdom consensus (ephemeral by design) but respect TTL-based expiration.

---

## Options Considered

### Option A: Presence as L1 Critical Fact
Store presence directly in L1 alongside other critical facts.

Pros:
- Simple — one table, one query path
- Presence immediately available at wake-up

Cons:
- L1 becomes noisy with ephemeral data
- TTL expiration requires L1 eviction logic (complexity in wrong layer)
- Pollutes the "critical facts" boundary with transient state

### Option B: Presence as In-Memory Only
Track presence only in memory, no persistence.

Pros:
- Fastest possible access
- No persistence overhead
- Natural TTL via process restart

Cons:
- Lost on restart — agents wake up blind
- No historical visibility for debugging
- Multiple receivers (horizontal scaling) become inconsistent

### Option C (Chosen): Dedicated L1.5 Ephemeral Layer with Sync-on-Demand
Presence lives in separate `presence_active` table, populated via mesh queries at heartbeat, with synthesized projections into L1.

Pros:
- Clean separation: ephemeral vs critical facts
- Persistence for debugging/observability without L1 pollution
- Sync-on-demand means fresh data without constant mesh chatter
- TTL expiration handled at L1.5 layer, removes stale entries naturally

Cons:
- Additional table to maintain
- Sync-on-demand adds latency to heartbeat processing
- Synthesis logic must be kept in sync with presence schema

---

## Rationale

Presence is conceptually different from critical facts. Critical facts are **beliefs** — things the agent holds true. Presence is **observation** — what the agent currently sees. These should not mix.

L1.5 as a dedicated layer:
1. **Honors the boundary** — L1 remains for portable identity and beliefs
2. **Enables observability** — `presence_active` table enables debugging "who did we think was online?"
3. **Supports synthesis** — raw presence ("Ray's receiver at :18803 responded") becomes L1 fact ("Ray is in session about clean_sl8")

Sync-on-demand at heartbeat:
- Queries existing mesh endpoints (receiver health + A2A presence messages)
- Configurable interval (default: 30s) with exponential backoff on peer offline
- Fresh data without constant background polling

TTL expiration:
- Entries older than TTL (default: 60s) are auto-purged from `presence_active`
- Corresponding synthesized L1 facts are marked stale (not deleted — audit trail preserved)

---

## Consequences

### Positive
- Clean architectural boundary between ephemeral observation and persistent belief
- Mesh presence becomes observable and debuggable via SQL queries
- L1 remains focused on portable identity, not transient state
- Synthesis layer allows flexible "what does presence mean?" without schema changes

### Negative / Trade-offs
- Heartbeat latency increases by presence query time (mitigated: parallel queries)
- Extra SQLite table adds maintenance surface
- Synthesis logic duplicates some intent from raw presence (necessary abstraction)

### Risks
- Stale presence if heartbeat interval is too long vs TTL
- Mesh partition causes all peers to appear offline (correct behavior, but jarring)
- Synthesis bugs could cause agents to hallucinate peer context

---

## Implementation

**Storage Layer:**
- Table: `presence_active(agent_id, endpoint, status, context, last_seen, expires_at)`
- Index on `expires_at` for efficient TTL cleanup
- L1.5 layer API: `getPresence()`, `updatePresence()`, `synthesizeToL1()`

**Sync Flow:**
```
Heartbeat triggered
  ↓
Query mesh endpoints (parallel):
  - GET /health on known peer receivers
  - A2A presence broadcast (if implemented)
  ↓
Update presence_active table
  ↓
Run synthesis: presence → L1 facts
  ↓
L1 now contains: "Ray is in session about clean_sl8"
```

**Configuration:**
- `presence.sync_interval`: 30s (how often to query mesh)
- `presence.ttl_seconds`: 60s (how long before entry expires)
- `presence.backoff_multiplier`: 2.0 (exponential backoff on failed peer)

**Endpoints Queried:**
- `http://<peer>:18803/health` — receiver health check
- A2A presence messages (if/when implemented) — `presence.broadcast` message type

**Kingdom Consensus:**
- Presence messages **do NOT require consensus**
- Ephemeral by design — "I am here now" is not a fact to agree on
- If presence affects decisions (e.g., task routing), the decision point validates freshness

---

## Review Date

Review trigger: When mesh scales beyond 10 peers, OR when presence used for task routing decisions, OR when consensus requirements change.

---

*Filed by Liz, 2026-04-12.*  
*Template version: 1.0 — Better Machine, 2026-03-31*
