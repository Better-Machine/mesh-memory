# mesh-memory + A2A Integration Architecture

**Status:** Design Complete  
**Date:** 2026-04-26  
**Agent:** Liz (protocol-architect subagent)  
**Scope:** Cross-layer integration between A2A coordination and mesh-memory state storage

---

## Executive Summary

This document defines how **A2A (Agent-to-Agent)** — the coordination layer — integrates with **mesh-memory** — the state/consensus storage layer. The integration follows a strict separation of concerns: **A2A handles task execution and messaging; mesh-memory handles persistent state and shared facts.**

### Key Design Principles

1. **Channel Discipline:** A2A = task execution; mesh-memory = state/consensus. Never conflate them.
2. **Tunnels, Not Wings:** Shared memory connects specific rooms across agent palaces — narrow, intentional pathways.
3. **Facts vs. Interpretations:** Only facts traverse tunnels; interpretations remain private.
4. **Provenance Required:** Every cross-agent fact carries source, timestamp, and cryptographic trail.

---

## 1. System Architecture

### 1.1 Layer Separation

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AGENT MESH ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 1: A2A (Coordination)                                     │  │
│  │  • Task execution        • Message routing    • Peer discovery │  │
│  │  • JSON-RPC protocol     • Real-time comm     • Health checks │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              ▲         ▼                                │
│                              │         │                                │
│                    ┌─────────┘         └─────────┐                      │
│                    │                              │                      │
│                    ▼                              ▼                      │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 2: mesh-memory (State/Consensus)                        │  │
│  │  • Palace/Kingdom (L0-L2)    • Shared tunnels    • Deal Rooms   │  │
│  │  • Fact/interpretation sep   • Provenance        • Governance  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              ▲         ▼                                │
│                              │         │                                │
│  ┌───────────────────────────┴─────────┴────────────────────────────┐  │
│  │  LAYER 3: Storage (Persistence)                                │  │
│  │  • SQLite (L1/L2 facts)    • Markdown logs    • Token vault   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Component Mapping

| Component | A2A Role | mesh-memory Role | Integration Point |
|-----------|----------|------------------|-------------------|
| **Peer Discovery** | Discover agents via `.well-known/agent.json` | Store peer trust scores, circuit states | `trust-state-machine.mjs` |
| **Task Execution** | Send tasks, await completion | Log task outcomes as facts | `memory-receiver.mjs` → SQLite |
| **Health Verification** | L1: Gateway health (port 18800) | L2: Receiver health (port 18803) | `A2A_RECEIVER_SPEC.md` |
| **Consensus** | Propose, vote via A2A messages | Store consensus state, proposals | `consensus-protocol.mjs` |
| **Shared Facts** | Request context via A2A | Publish validated facts via tunnels | `tunnel-publisher.mjs` |
| **Deal Rooms** | Coordinate room participants | Store room state, context escrow | `deal-room.mjs` |

---

## 2. A2A Message → mesh-memory Storage Flow

### 2.1 Message Ingestion Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    A2A → mesh-memory Storage Flow                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Step 1: RECEIVE                                                        │
│  ┌─────────────┐    HTTP POST    ┌──────────────────┐                  │
│  │  A2A Peer   │ ───────────────►│  memory-receiver │                  │
│  │  (any node) │   Bearer token  │  (port 18803)    │                  │
│  └─────────────┘                 └────────┬─────────┘                  │
│                                           │                             │
│  Step 2: VALIDATE                       │                             │
│                                           ▼                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  • Token validation (token-service:18804)                       │  │
│  │  • Schema validation (MemoryEvent structure)                  │  │
│  │  • Timestamp validation (ISO 8601, not future, <24h old)     │  │
│  │  • Identity tag enrichment ([AgentName / Role])                │  │
│  └────────────────────────┬──────────────────────────────────────────┘  │
│                           │                                            │
│  Step 3: TAG                            │                            │
│                           ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  lesson-tagger.mjs — auto-detect tags:                          │  │
│  │  • [lesson] [correction] [mistake] [decision] [warning]        │  │
│  └────────────────────────┬──────────────────────────────────────────┘  │
│                           │                                            │
│  Step 4: WRITE                          │                            │
│                           ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │  │
│  │  │  Markdown   │    │  SQLite     │    │  Token Vault      │  │  │
│  │  │  Log        │    │  (L1/L2)    │    │  (rotating)       │  │  │
│  │  │             │    │             │    │                   │  │  │
│  │  │ memory/     │    │ critical_   │    │ .tokens/          │  │  │
│  │  │ mesh/       │    │ facts table │    │ {hash}.json       │  │  │
│  │  │ YYYY-MM-DD.md│   │ FTS5 index  │    │                   │  │  │
│  │  └─────────────┘    └─────────────┘    └─────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 MemoryEvent Schema

```typescript
interface MemoryEvent {
  // Required
  agentId: string;           // "Liz", "Ray", "Woodhouse"
  role: string;              // "protocol-architect", "executor", "researcher"
  content: string;           // Markdown content
  timestamp: string;         // ISO 8601
  
  // Optional
  tags?: string[];           // ["lesson", "decision"]
  identityTag?: string;      // "[Liz / protocol-architect]"
  fullTag?: string;          // Full context string
  tier?: "critical" | "deep"; // L1 vs L2 storage
  provenance?: {
    source: string;          // Origin node
    timestamp: string;       // Original timestamp
    signature?: string;      // Future: Ed25519
  };
  threadId?: string;         // For conversation grouping
  roomId?: string;           // Deal room association
}
```

### 2.3 Storage Destinations

| Event Type | L1 Critical | L2 Deep | Markdown Log | Notes |
|------------|-------------|---------|--------------|-------|
| `[decision]` | ✅ Yes | No | ✅ Yes | Immediate persistence |
| `[lesson]` | ✅ Yes | No | ✅ Yes | Elevated to critical |
| `[correction]` | ✅ Yes | No | ✅ Yes | Error patterns |
| Routine chat | No | ✅ Yes | ✅ Yes | Searchable but not wake-up |
| Consensus votes | ✅ Yes | No | ✅ Yes | Trust ledger updates |
| Task outcomes | No | ✅ Yes | ✅ Yes | Completion status |

---

## 3. Publishing Facts to Shared Tunnels via A2A

### 3.1 Tunnel Protocol Overview

**Tunnels are narrow pathways connecting specific rooms across agent palaces.** They enforce fact/interpretation separation architecturally — not just by policy.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Cross-Agent Tunnel Flow                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Agent A (Liz)                    Agent B (Ray)                        │
│  ┌─────────────────┐              ┌─────────────────┐                  │
│  │  Palace         │              │  Palace         │                  │
│  │  ┌───────────┐  │              │  ┌───────────┐  │                  │
│  │  │  L0:      │  │   ┌──────┐   │  │  L0:      │  │                  │
│  │  │  Identity │◄─┼───┤Tunnel├───┼─►│  Identity │  │                  │
│  │  │  (local)  │  │   └──────┘   │  │  (local)  │  │                  │
│  │  └───────────┘  │              │  └───────────┘  │                  │
│  │  ┌───────────┐  │              │  ┌───────────┐  │                  │
│  │  │  L1:      │  │              │  │  L1:      │  │                  │
│  │  │  Critical │  │              │  │  Critical │  │                  │
│  │  │  Facts    │  │              │  │  Facts    │  │                  │
│  │  └───────────┘  │              │  └───────────┘  │                  │
│  │  ┌───────────┐  │              │  ┌───────────┐  │                  │
│  │  │  L2:      │  │              │  │  L2:      │  │                  │
│  │  │  Deep     │  │              │  │  Deep     │  │                  │
│  │  │  Memory   │  │              │  │  Memory   │  │                  │
│  │  └───────────┘  │              │  └───────────┘  │                  │
│  └─────────────────┘              └─────────────────┘                  │
│                                                                         │
│  TUNNEL RULES:                                                          │
│  • Facts CAN traverse (decisions, events, dates, configs, observations) │
│  • Interpretations CANNOT (believes, thinks, assessments, opinions)   │
│  • Every packet has provenance (who, when, source)                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Fact Validation Pipeline

```javascript
// tunnel-publisher.mjs validation flow

async function publishFact(fact, targetPeer) {
  // Step 1: Validate structure
  const validation = validateFact(fact);
  if (!validation.valid) {
    throw new TunnelError("VALIDATION_FAILED", validation.errors);
  }
  
  // Step 2: Check interpretation keywords
  if (containsInterpretationKeywords(fact.content)) {
    throw new TunnelError("INTERPRETATION_BLOCKED", 
      "Content contains subjective language");
  }
  
  // Step 3: Validate provenance
  const provCheck = validateProvenance(fact.provenance);
  if (!provCheck.valid) {
    throw new TunnelError("PROVENANCE_INVALID", provCheck.error);
  }
  
  // Step 4: A2A publish to peer
  const result = await a2aSend({
    peerUrl: targetPeer.url,
    type: "tunnel.fact",
    payload: fact
  });
  
  // Step 5: Queue if failed (retry with backoff)
  if (!result.success) {
    await queueFailedPublish(fact, targetPeer, result.error);
  }
}
```

### 3.3 Allowed Fact Types

| Type | Description | Example | Tunnel-Safe |
|------|-------------|---------|-------------|
| `decision` | Consensus outcomes | "Approved RFC-0007" | ✅ Yes |
| `event` | Things that occurred | "Deploy completed 14:32" | ✅ Yes |
| `date` | Temporal markers | "Phase 2 starts 2026-05-01" | ✅ Yes |
| `config` | System settings | "Gateway port changed to 18801" | ✅ Yes |
| `observation` | Neutral recordings | "CPU usage peaked at 95%" | ✅ Yes |
| `assessment` | Judgment/evaluation | "The approach is risky" | ❌ No — private |
| `opinion` | Subjective beliefs | "I prefer option A" | ❌ No — private |
| `prediction` | Future forecasts | "This will likely fail" | ❌ No — private |

### 3.4 A2A Tunnel Message Format

```json
{
  "jsonrpc": "2.0",
  "method": "tunnel.fact.publish",
  "params": {
    "fact": {
      "id": "fact_a1b2c3d4",
      "type": "decision",
      "tier": "critical",
      "content": {
        "title": "RFC-0007 Accepted",
        "body": "Consensus reached on A2A protocol v2.0"
      },
      "provenance": {
        "source": "Liz",
        "timestamp": "2026-04-26T20:09:00Z",
        "originNode": "192.168.50.23",
        "signature": null
      },
      "expiresAt": null
    },
    "ttl": 86400
  },
  "id": 42
}
```

---

## 4. Consensus Delivery Protocol Integration

### 4.1 Consensus Flow via A2A

```
┌─────────────────────────────────────────────────────────────────────────┐
│                Consensus Protocol + mesh-memory                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Phase 1: PROPOSAL                                                      │
│  ┌───────────┐    A2A: propose    ┌───────────┐                       │
│  │  Agent A  │ ──────────────────►│  Agent B  │                       │
│  │ (proposer)│                    │  (voter)  │                       │
│  └───────────┘                    └─────┬─────┘                       │
│                                         │                               │
│  Phase 2: VOTE                          │                               │
│  ◄──────────────────────────────────────┘                               │
│  A2A: castVote → mesh-memory stores vote with provenance                │
│                                                                         │
│  Phase 3: EVALUATE                                                      │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  consensus-protocol.mjs evaluates:                        │      │
│  │  • Quorum reached? (default 51%)                          │      │
│  │  • Voting period ended?                                   │      │
│  │  • Minimum voters met?                                    │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
│  Phase 4: RESOLVE                                                       │
│  ┌───────────┐    A2A: resolved   ┌───────────┐                       │
│  │  Agent A  │◄──────────────────│  Agent B  │                       │
│  └─────┬─────┘                    └───────────┘                       │
│        │                                                                │
│        ▼                                                                │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  mesh-memory stores:                                        │      │
│  │  • Proposal state (approved/rejected)                     │      │
│  │  • Final vote tally                                        │      │
│  │  • Consensus fact published to tunnels                    │      │
│  │  • Trust scores updated for all voters                    │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Consensus State Persistence

```typescript
// Stored in mesh-memory SQLite (critical_facts table)
interface ConsensusRecord {
  id: string;                    // "proposal_abc123"
  type: "consensus_proposal";
  state: "pending" | "voting" | "approved" | "rejected" | "expired";
  
  // Content
  title: string;
  description: string;
  action: object;                // The action to take if approved
  
  // Voting
  votes: Array<{
    voterId: string;
    voteType: "yes" | "no" | "abstain";
    reason?: string;
    timestamp: string;
  }>;
  
  // Meta
  proposer: string;
  createdAt: string;
  votingEndsAt: string;
  resolvedAt?: string;
  
  // mesh-memory provenance
  provenance: {
    source: string;
    timestamp: string;
  };
}
```

### 4.3 A2A Consensus Methods

| Method | Direction | Description |
|--------|-----------|-------------|
| `consensus.propose` | P2P → P2P | Create new proposal |
| `consensus.vote` | P2P → P2P | Cast vote on proposal |
| `consensus.status` | P2P → P2P | Query proposal state |
| `consensus.resolve` | P2P → P2P | Finalize proposal (auto or manual) |

---

## 5. Deal Room as mesh-memory Construct

### 5.1 Deal Room Architecture

**Deal Rooms are specialized mesh-memory spaces accessed via A2A.** They combine the coordination capabilities of A2A with the persistence and governance of mesh-memory.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Deal Room: A2A + mesh-memory                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  A2A LAYER (Coordination)                                        │  │
│  │  • Create room (consensus required)                            │  │
│  │  • Invite participants                                           │  │
│  │  • Real-time messaging (chat, voice, decisions)                  │  │
│  │  • Vote on proposals within room                               │  │
│  └────────────────────────┬─────────────────────────────────────────┘  │
│                           │                                            │
│                           ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  mesh-memory LAYER (State)                                     │  │
│  │                                                                  │  │
│  │  ┌────────────────────────────────────────────────────────────┐│  │
│  │  │  Room State                                                ││  │
│  │  │  • Participants (agent IDs, roles, consent status)         ││  │
│  │  │  • Context escrow (shared documents, facts)                ││  │
│  │  │  • Thread history (all messages with provenance)         ││  │
│  │  │  • Decision log (consensus outcomes)                      ││  │
│  │  └────────────────────────────────────────────────────────────┘│  │
│  │                                                                  │  │
│  │  ┌────────────────────────────────────────────────────────────┐│  │
│  │  │  Governance Engine                                         ││  │
│  │  │  • ABAC policies (who can see/do what)                    ││  │
│  │  │  • Compliance validation                                    ││  │
│  │  │  • Audit vault (immutable log)                            ││  │
│  │  └────────────────────────────────────────────────────────────┘│  │
│  │                                                                  │  │
│  │  ┌────────────────────────────────────────────────────────────┐│  │
│  │  │  Persistence                                               ││  │
│  │  │  • SQLite: room metadata, participant consent            ││  │
│  │  │  • Markdown: thread logs, decision records               ││  │
│  │  │  • Token vault: access credentials (rotating)            ││  │
│  │  └────────────────────────────────────────────────────────────┘│  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Room Lifecycle via A2A

```javascript
// Creating a deal room (requires consensus)
const proposal = await consensusProtocol.createProposal({
  type: "deal_room_create",
  title: "Series A Negotiation",
  description: "Secure room for investor discussions",
  action: {
    roomType: "funding",
    participants: ["Liz", "Ray", "Investor_X"],
    scope: "confidential",
    policy: "funding_room_policy"
  }
});

// A2A broadcast to all agents
await a2aBroadcast({
  method: "deal_room.proposed",
  params: { proposalId: proposal.id }
});

// On consensus approval, mesh-memory creates room
// Stored in: memory/deal_rooms/{roomId}/
```

### 5.3 Room State Model

```typescript
interface DealRoom {
  // Identity
  id: string;                    // "dr_series_a_2026_04"
  name: string;
  purpose: string;
  
  // Participants
  participants: Array<{
    agentId: string;
    role: "lead" | "participant" | "observer";
    consentStatus: "pending" | "active" | "suspended";
    joinedAt?: string;
  }>;
  
  // mesh-memory storage paths
  storage: {
    threadLog: string;         // memory/deal_rooms/{id}/threads.md
    escrowPath: string;        // memory/deal_rooms/{id}/escrow/
    auditLog: string;          // memory/deal_rooms/{id}/audit.jsonl
  };
  
  // Governance
  policy: {
    abacPolicyId: string;
    retentionDays: number;
    requireConsensus: boolean;
  };
  
  // State
  status: "draft" | "active" | "paused" | "closed";
  createdAt: string;
  expiresAt?: string;
  
  // Provenance
  provenance: {
    createdBy: string;
    consensusProposalId?: string;  // If created via consensus
    timestamp: string;
  };
}
```

### 5.4 Context Escrow

**Context Escrow** is the Deal Room mechanism for sharing sensitive data:

1. **Upload:** Participant places document in escrow via A2A
2. **Access Control:** mesh-memory enforces ABAC policies
3. **Access Log:** Every retrieval logged with provenance
4. **Expiration:** Auto-purge after room closure or policy violation

```javascript
// Escrow access via A2A
const escrow = await a2aSend({
  peer: roomHost,
  method: "deal_room.escrow.access",
  params: {
    roomId: "dr_series_a",
    documentId: "term_sheet_v2",
    requester: "Liz"
  }
});

// mesh-memory checks ABAC policy before granting access
// Logs: { who: "Liz", what: "term_sheet_v2", when: "2026-04-26T20:15:00Z" }
```

---

## 6. Synchronization Strategy

### 6.1 Async Replication Model

mesh-memory uses **asynchronous, event-driven replication** across the mesh. No synchronous locking — eventual consistency with conflict detection.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Async Replication Flow                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────┐    Event    ┌─────────────┐    A2A      ┌─────────┐   │
│  │  Local  │ ───────────►│   memory-   │ ───────────►│  Peer   │   │
│  │  Write  │   Emit      │   relay     │   Publish     │  Node   │   │
│  └─────────┘             └─────────────┘             └────┬────┘   │
│                                                         │          │
│  ┌─────────┐    Ack      ┌─────────────┐                │          │
│  │  Local  │◄───────────│   Peer      │◄───────────────┘          │
│  │  State  │   (async)   │   Receiver  │                           │
│  └─────────┘             └─────────────┘                           │
│                                                                         │
│  EVENT TYPES:                                                           │
│  • fact.new — New critical fact written                                │
│  • fact.update — Existing fact modified                                │
│  • tunnel.in — Fact received from peer                                 │
│  • tunnel.out — Fact published to peer                                 │
│  • consensus.vote — Vote cast on proposal                              │
│  • consensus.resolved — Proposal finalized                             │
│  • room.message — Deal room message sent                               │
│  • room.join/part/leave — Participant changes                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Conflict Resolution

**Conflict is expected.** The architecture handles it via:

| Conflict Type | Resolution Strategy | Example |
|---------------|---------------------|---------|
| **Timestamp** | Last-write-wins (LWW) | Same fact updated on two nodes |
| **Consensus** | Quorum-based merge | Conflicting votes on same proposal |
| **Version** | Vector clock ordering | Concurrent fact edits |
| **Semantic** | Domain-specific resolver | Conflicting decisions |

```javascript
// Vector clock for causality tracking
interface VersionVector {
  [nodeId: string]: number;  // { "Liz": 42, "Ray": 39, "Woodhouse": 41 }
}

// Conflict detection
function detectConflict(localFact, incomingFact) {
  const comparison = compareVectorClocks(
    localFact.versionVector,
    incomingFact.versionVector
  );
  
  if (comparison === "concurrent") {
    return resolveConflict(localFact, incomingFact);
  }
  
  // Otherwise, later clock wins
  return comparison === "before" ? incomingFact : localFact;
}
```

### 6.3 Retry & Queue Management

Failed A2A publishes are queued for retry with exponential backoff:

```javascript
// tunnel-publisher.mjs retry logic
const RETRY_BACKOFF_MS = [1000, 5000, 15000]; // 1s, 5s, 15s

async function processRetryQueue() {
  const queue = await loadQueue();
  
  for (const item of queue) {
    if (item.retryCount >= MAX_RETRIES) {
      // Dead letter — requires manual intervention
      await escalateToOperator(item);
      continue;
    }
    
    const delay = RETRY_BACKOFF_MS[item.retryCount] || 
                  RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
    
    await sleep(delay);
    
    const result = await attemptPublish(item.fact, item.peer);
    
    if (result.success) {
      await removeFromQueue(item);
    } else {
      item.retryCount++;
      await updateQueue(item);
    }
  }
}
```

### 6.4 Consistency Levels

| Operation | Consistency | Mechanism |
|-----------|-------------|-----------|
| Critical fact write | Strong (local) | SQLite transaction + WAL |
| Cross-agent publish | Eventual | Async A2A + retry queue |
| Consensus decision | Strong (quorum) | >50% votes before commit |
| Deal room message | Eventual | Async relay, ordered by timestamp |
| Config change | Strong | Consensus required |

---

## 7. Integration API Reference

### 7.1 A2A → mesh-memory Methods

| Method | Handler | Description |
|--------|---------|-------------|
| `memory.store` | `memory-receiver.mjs` | Store a MemoryEvent |
| `memory.query` | `l2-search.mjs` | Search L2 deep memory |
| `tunnel.publish` | `tunnel-publisher.mjs` | Publish fact to peer |
| `tunnel.receive` | `memory-receiver.mjs` | Handle incoming fact |
| `consensus.propose` | `consensus-protocol.mjs` | Create proposal |
| `consensus.vote` | `consensus-protocol.mjs` | Cast vote |
| `deal_room.create` | `deal-room.mjs` | Create new room |
| `deal_room.join` | `deal-room.mjs` | Join existing room |
| `deal_room.message` | `memory-receiver.mjs` | Post to room |

### 7.2 mesh-memory → A2A Callbacks

| Event | Emitter | Handler |
|-------|---------|---------|
| `mesh.fact.new` | `critical-facts-loader.mjs` | `memory-relay.mjs` → A2A |
| `mesh.consensus.pending` | `consensus-protocol.mjs` | `blind-gate.mjs` → A2A |
| `mesh.tunnel.failed` | `tunnel-publisher.mjs` | Retry queue |
| `mesh.room.message` | `memory-receiver.mjs` | `memory-relay.mjs` → A2A |

---

## 8. Security & Privacy

### 8.1 Token-Based Authentication

All A2A → mesh-memory traffic uses rotating bearer tokens:

```
Request: POST /memory/store
Authorization: Bearer {token}
X-Request-ID: {correlationId}

Token validation: token-service (port 18804)
  • Hash lookup in .tokens/{hash}.json
  • TTL check
  • Scope validation
  • Rotation handling (grace period for old tokens)
```

### 8.2 Privacy Markers

Messages tagged `[private]` bypass mesh relay entirely:

```javascript
// In memory-receiver.mjs
function shouldRelayToMesh(event) {
  if (event.content.includes("[private]")) {
    return false; // Local storage only
  }
  if (event.content.match(/\[private\].*\[\/private\]/s)) {
    return false; // Block section
  }
  return true;
}
```

### 8.3 Fact/Interpretation Enforcement

**Architectural (not just policy):**

```javascript
// Interpretation keywords that block tunnel transmission
const INTERPRETATION_KEYWORDS = [
  "believe", "thinks", "probably", "likely", "seem",
  "assessment", "opinion", "judgment", "unreliable",
  "confident", "doubtful"
];

export function containsInterpretationKeywords(content) {
  const lower = content.toLowerCase();
  return INTERPRETATION_KEYWORDS.some(kw => lower.includes(kw));
}
```

---

## 9. Deployment & Operations

### 9.1 Service Topology

```
Node (e.g., Liz .23)
├── A2A Gateway (port 18800)        ← External coordination
├── memory-receiver (port 18803)    ← HTTP ingest from peers
├── token-service (port 18804)      ← Token validation
├── memory-relay (port 18805)       ← Outbound A2A publishes
├── blind-gate (port 18806)         ← Consensus coordination
└── SQLite + Markdown storage         ← Persistence layer
```

### 9.2 Health Check Integration

```bash
# L1: A2A Gateway
curl http://192.168.50.23:18800/.well-known/agent.json

# L2: mesh-memory Receiver
curl http://192.168.50.23:18803/health \
  -H "Authorization: Bearer {token}"
# Expected: 200 OK or 401 (both prove reachability)

# L3: Token Service
curl http://192.168.50.23:18804/mesh/token/status \
  -H "Authorization: Bearer {token}"
```

### 9.3 Monitoring

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| `mesh_relay_queue_depth` | memory-relay.mjs | > 100 messages |
| `tunnel_publish_failures` | tunnel-publisher.mjs | > 5 in 5 min |
| `consensus_pending_votes` | consensus-protocol.mjs | > 10 stuck > 1hr |
| `token_rotation_lag` | token-service.mjs | > 5 min |

---

## 10. References

| Document | Purpose |
|----------|---------|
| `PALACE_README.md` | L0-L2 architecture overview |
| `A2A_RECEIVER_SPEC.md` | Peer verification & health protocols |
| `consensus-protocol.mjs` | Blind-gate consensus implementation |
| `tunnel-publisher.mjs` | Fact validation & cross-agent publish |
| `memory-receiver.mjs` | HTTP ingest & validation |
| `DESIGN_PHASE8.md` | Deal Room multi-workflow design |
| `BIAS_PROPAGATION_RESEARCH.md` | Why fact/interpretation separation matters |

---

## Appendix A: Message Flow Examples

### A.1 Simple Fact Share

```
Ray detects deployment failure
  ↓
tunnel-publisher.validateFact()
  → Contains only facts ("Deploy failed at 14:32")
  ↓
A2A: tunnel.fact.publish → Liz
  ↓
Liz memory-receiver validates provenance
  ↓
Stored in Liz's L1 critical facts
  ↓
Appears in Liz's next wake-up context
```

### A.2 Consensus Decision

```
Liz proposes RFC-0007 via consensus.propose
  ↓
A2A broadcast to Ray, Woodhouse
  ↓
Each agent votes via consensus.vote
  ↓
votes stored in mesh-memory (per agent)
  ↓
Quorum reached (3/3 = 100% > 51%)
  ↓
consensus-protocol emits resolved event
  ↓
A2A: consensus.resolved broadcast
  ↓
Each agent stores "RFC-0007 approved" as L1 fact
```

### A.3 Deal Room Creation

```
Erik requests Series A negotiation room
  ↓
Liz creates consensus proposal
  ↓
Agents vote via A2A
  ↓
Approved → mesh-memory creates:
  • memory/deal_rooms/dr_series_a/
  • SQLite entry for participants
  • ABAC policy attached
  ↓
A2A: deal_room.created notifications sent
  ↓
Participants can now join via deal_room.join
```

---

*Document version: 1.0.0*  
*Last updated: 2026-04-26*  
*Author: Liz (protocol-architect)*
