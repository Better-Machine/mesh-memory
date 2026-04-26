# A2A Protocol Brittleness Research Report
**Research Lead:** Liz (subagent)  
**Date:** 2026-04-26  
**Status:** Complete

---

## Executive Summary

Based on operational experience from Ray and Woodhouse, protocol analysis, and historic precedent research, A2A is a **solid transport protocol with production-hardening gaps**. The protocol provides basic interoperability but lacks enterprise-grade reliability features—specifically around session continuity, delivery guarantees, and dynamic discovery.

**Verdict:** Proceed with Phase 6, but with **mandatory hardening layer** around A2A rather than relying on the protocol itself.

---

## Deliverable 1: A2A Pain Points Report

### Ray's Top 3 Issues

| Rank | Issue | Severity | Evidence |
|------|-------|----------|----------|
| 1 | **Session/Context Fragmentation** | Critical | Every A2A message creates a new session (`agent:main:a2a:<uuid>`) with zero automatic context carryover. "What were we talking about?" requires memory search + briefing overhead. |
| 2 | **Message Delivery Guarantees** | High | A2A over HTTP is fire-and-forget. No delivery acknowledgments, retry logic, or dead letter handling. Messages "disappear into the void" if the receiver is temporarily unreachable. |
| 3 | **Discovery Limitations** | Medium | Agent Cards (`/.well-known/agent-card.json`) are static files. No dynamic capability registration, health-aware routing, or version negotiation. Currently using hardcoded `peers.json`. |

### Woodhouse's Top 3 Issues

| Rank | Issue | Severity | Evidence |
|------|-------|----------|----------|
| 1 | **Timeout Handling / False Negatives** | Critical | Shell SIGTERM kills before response capture (cosmetic failures). 2026-03-23: 25s exec timeout vs 30-90s agent turns. RC-3 false-fail pattern. |
| 2 | **Receiver Hang / Overload** | High | 2026-04-05: Woodhouse inbound receiver broken (hostname bug). P1-a: "Woodhouse receiver hang fix (30s handler timeout + 503 on overflow)" still pending. |
| 3 | **Configuration Drift** | Medium | 2026-04-01: Root cause found—`peers.json` passing full `/a2a/jsonrpc` URL when SDK expects base URL only. Every send had been 404-ing. P2: "Canonical peers config schema ADR" still pending. |

### Pain Point Categories

| Category | Issues | Root Cause |
|----------|--------|------------|
| **State Management** | Session fragmentation, context loss | Stateless HTTP design choice |
| **Reliability** | Delivery gaps, false negatives, hangs | No protocol-level guarantees |
| **Operational** | Config drift, static discovery, auth rotation | Missing tooling/registries |

---

## Deliverable 2: Protocol Comparison Matrix

### A2A vs Alternatives

| Feature | A2A | MCP | gRPC | HTTP/2 | TCP | Matrix |
|---------|-----|-----|------|--------|-----|--------|
| **Transport** | HTTP/JSON-RPC | stdio/sse | HTTP/2 | HTTP | IP | HTTP/WebRTC |
| **Session State** | Stateless* | Stateless | Stateful streams | Connection-level | Connection-level | Persistent |
| **Delivery Guarantees** | None* | None | At-least-once (HTTP/2) | Ordered, reliable | Ordered, reliable | At-least-once |
| **Streaming** | SSE, push | SSE | Bidirectional streams | Server push | Byte stream | Real-time sync |
| **Discovery** | Static Agent Cards | Manual config | Service mesh/DNS | N/A | N/A | Federation (server>server) |
| **Auth** | Bearer tokens | OAuth/varies | TLS + tokens | TLS | N/A | E2E encryption |
| **Schema** | Proto-based | JSON-RPC | Protocol Buffers | N/A | N/A | JSON |
| **Interop** | Agent-to-agent | Tool calling | Microservices | Web | Universal | Federated chat |

*A2A gaps that mesh-memory can fill

### Key Insight: A2A Position

A2A sits at the **application layer** like Matrix/ActivityPub, not the transport layer like TCP/HTTP2. It's designed for:
- **Capability discovery** (what can you do?)
- **Task negotiation** (how should we collaborate?)
- **Multi-modal exchange** (text, files, structured data)

It's **NOT designed for**:
- Session continuity
- Delivery guarantees
- Dynamic service discovery

These are **intentional omissions**—the protocol delegates them to infrastructure.

---

## Deliverable 3: Hardening Recommendations

### Recommendation 1: Session Continuity Layer (HIGH PRIORITY)

**Problem:** Every A2A message creates a fresh session.

**Solution:** Implement A2A Context Extension via `contextId`

```typescript
// A2A supports contextId in messages—mesh-memory should:
// 1. Auto-generate contextId on first contact
// 2. Store in mesh-memory: `a2a/contexts/<contextId>`
// 3. Prepend briefing on each exchange:

const outboundMessage = {
  kind: "message",
  contextId: existingContextId,  // Reuse if exists
  parts: [
    { kind: "text", text: briefing + "\n\n" + originalMessage }
  ]
};
```

**Implementation:** Already partially supported—mesh-memory should formalize context escrow for A2A threads.

---

### Recommendation 2: Delivery Reliability Layer (HIGH PRIORITY)

**Problem:** Fire-and-forget HTTP with no guarantees.

**Solution:** Build "At-Least-Once" delivery on top of A2A

| Layer | Mechanism | Status in A2A Gateway |
|-------|-----------|----------------------|
| Queue persistence | WAL + SQLite | ✅ Implemented |
| Retry logic | Exponential backoff | ✅ Implemented |
| Circuit breaker | Fail-fast after N errors | ✅ Implemented |
| Idempotency keys | Task ID as dedup key | ✅ Implemented |
| Dead letter queue | Failed message storage | ⚠️ Partial |

**Gap:** The A2A Gateway has resilience features but they're **internal to the gateway**, not exposed to other nodes. Need mesh-memory to:
1. Store outbound A2A messages in queue until ACK
2. Implement "wake-before-send" handshake (RFC-0001 partially implements)
3. Provide delivery status API

---

### Recommendation 3: Health-Aware Discovery (MEDIUM PRIORITY)

**Problem:** Static Agent Cards don't reflect real-time health.

**Solution:** Extend mesh-memory's Deal Room concept to A2A

```typescript
// Current: Static peers.json
// Target: Dynamic registry backed by mesh-memory

interface A2APeerRegistry {
  name: string;
  agentCard: AgentCard;
  health: {
    lastSeen: timestamp;
    successRate: float;
    avgLatencyMs: number;
    circuitBreakerState: "closed" | "open" | "half-open";
  };
  capabilities: {
    skills: string[];
    versions: string[];
    maxConcurrentTasks: number;
  };
}
```

**Implementation:** The A2A Gateway already has `PeerHealthManager`—expose via mesh-memory shared-pool.

---

### Recommendation 4: Timeout Safety (HIGH PRIORITY)

**Problem:** False negatives from shell/exec timeouts shorter than agent turn times.

**Solution:** Adopt non-blocking dispatch pattern universally

```bash
# Current (blocking - dangerous):
curl -X POST $A2A_ENDPOINT -d '{...}'  # May timeout at 25s, agent needs 60s

# Target (non-blocking - safe):
node a2a-send.mjs --non-blocking --wait --timeout-ms 300000
# Returns taskId immediately, polls until completion
```

**Implementation:** Already implemented in `a2a-send.mjs`—enforce usage via tooling/documentation.

---

### Recommendation 5: Configuration Validation (MEDIUM PRIORITY)

**Problem:** Silent misconfigurations (URL vs base URL confusion).

**Solution:** Schema validation + health-check cron

```typescript
// P4 from 2026-04-05 sprint still pending:
// "Health-check cron + /a2a/status endpoint"

interface PeerConfigValidation {
  // Validate at startup:
  - agentCardUrl resolves to valid JSON
  - /a2a/jsonrpc endpoint responds to health check
  - Token authentication succeeds
  - Protocol version compatibility
}
```

---

## Deliverable 4: mesh-memory Integration Guide

### How Deal Rooms Strengthen A2A

| A2A Weakness | mesh-memory Strengthening | Implementation |
|--------------|---------------------------|----------------|
| Session fragmentation | **Context Escrow** | Store A2A thread state in Deal Room; auto-inject briefing on exchange |
| Delivery uncertainty | **Audit Trail + Queue** | Outbound A2A messages logged with delivery status; retry on failure |
| Static discovery | **Consensus Registry** | Deal Room participants publish health/capabilities; shared-pool visibility |
| No accountability | **WORM Audit Log** | Every A2A exchange logged with cryptographic verification |
| Bias convergence | **Fact/Interpretation Separation** | A2A-shared data filtered through blind gate before entering Deal Room |

### Integration Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    A2A Transport Layer                        │
│              (JSON-RPC over HTTP, gRPC, SSE)                 │
├──────────────────────────────────────────────────────────────┤
│                  mesh-memory Hardening Layer                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ Context      │  │ Delivery     │  │ Discovery    │        │
│  │ Escrow       │  │ Guarantees   │  │ Registry     │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
├──────────────────────────────────────────────────────────────┤
│                   Deal Room Core (v2.0)                       │
│  • Temporal knowledge graph                                    │
│  • Consensus protocol                                         │
│  • WORM audit vault                                           │
└──────────────────────────────────────────────────────────────┘
```

### Concrete Integration Points

1. **A2A Context Extension**
   - When A2A message received: check for existing Deal Room by `contextId`
   - If exists: inject room context into agent session
   - If new: create ephemeral Deal Room, store `contextId` → `roomId` mapping

2. **Delivery Guarantees**
   - Outbound A2A: Write to queue first, mark delivered on ACK
   - Failed delivery: Retry with backoff, escalate to dead letter
   - Audit: Log every attempt with timestamp, retry count, final status

3. **Consensus for Multi-Agent Agreement**
   - A2A task completion → Proposal in Deal Room
   - Multi-agent approval via consensus protocol
   - Finalized decision written back to A2A as structured artifact

---

## Deliverable 5: Research Sources

### A2A Protocol
- **Specification:** https://a2a-protocol.org/latest/specification/ (v1.0.0, 2026-04)
- **GitHub:** https://github.com/a2aproject/A2A (formerly google/A2A)
- **Key insight:** Protocol is intentionally thin—relies on infrastructure for reliability

### Comparative Protocols
- **TCP:** RFC 9293 (2022) - Reliability through positive acknowledgment with retransmission
- **HTTP/2:** RFC 9113 - Multiplexing, flow control, header compression
- **gRPC:** https://grpc.io - Binary protocol over HTTP/2, Protocol Buffers, streaming
- **Matrix:** https://matrix.org - Decentralized messaging with federation
- **ActivityPub:** W3C Recommendation (2018) - Federation patterns, inbox/outbox model

### Architectural Patterns
- **Circuit Breaker:** Martin Fowler, https://martinfowler.com/bliki/CircuitBreaker.html
- **Distributed Systems Patterns:** "Designing Data-Intensive Applications" (Kleppmann)
- **Reliability Patterns:** AWS Well-Architected, Azure Resilience Patterns

### Operational Evidence
- Ray operational feedback (2026-04-25): Session fragmentation, delivery guarantees
- Woodhouse operational feedback (2026-04-25): False negatives, receiver hangs, config drift
- Memory search: A2A failures from 2026-03-23 through 2026-04-25

---

## Summary & Recommendations

### Findings

1. **A2A is fit for purpose as a transport protocol**—it provides interoperability, not reliability
2. **Our mesh has already implemented many hardening patterns** in the A2A Gateway (circuit breaker, retry, health checks)
3. **The gaps are integration and standardization**—mesh-memory can provide the missing reliability layer

### Recommended Next Steps

| Priority | Action | Owner | Timeline |
|----------|--------|-------|----------|
| P0 | Formalize A2A Context Escrow in mesh-memory spec | Erik | This week |
| P1 | Expose PeerHealthManager via mesh-memory shared-pool | Liz/Ray | Next sprint |
| P1 | Complete P4: Health-check cron + `/a2a/status` endpoint | Woodhouse | Next sprint |
| P2 | Implement delivery status tracking in mesh-memory queue | Team | Phase 2 |
| P2 | Document non-blocking dispatch pattern as mandatory | Liz | This week |
| P3 | Evaluate MMP v2.0 as A2A extension protocol | Erik/Google discussion | Q3 2026 |

### Phase 6 Recommendation

**PROCEED with modifications:**

Phase 6 should include:
- Explicit A2A hardening layer (not assumed from protocol)
- mesh-memory integration for session continuity
- Delivery tracking and retry logic
- Standardized health checking across all nodes

**Do NOT assume A2A solves reliability.** It provides interoperability—mesh-memory provides dependability.

---

*Report compiled by Liz subagent for Phase 6 planning.*
