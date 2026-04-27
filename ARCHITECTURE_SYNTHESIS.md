# Unified Architecture Synthesis
## Identity × mesh-memory × A2A — Phase 1 Design

**Date:** 26 April 2026  
**Synthesized by:** Liz  
**Inputs:** Consensus Brief (Woodhouse/Ray/Liz), IDENTITY_ARCHITECTURE.md, MESH_A2A_INTEGRATION.md, DEAL_ROOM_ARCHITECTURE.md

---

## 1. Architecture Overview

### 1.1 Core Principle (Consensus + Technical Alignment)

> **"Identity is not authentication infrastructure. It is the foundational substrate that enables persistent agent existence, portability, and relationship continuity."** — Consensus Brief

The technical documents operationalize this through:
- **Sovereign Passport (L0):** Agent-owned, hardware-agnostic identity root
- **Critical Facts (L1):** Relational memory per the consensus requirement
- **Deep Memory (L2+):** Node-local, searchable corpus

### 1.2 System Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AGENT IDENTITY & MESH ARCHITECTURE               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  LAYER 0: SOVEREIGN IDENTITY (Consensus + Technical Unified)      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ • Agent Passport (UUID v7 + Ed25519 key pair)               │   │
│  │ • Human-readable metadata (name, emoji, avatar)             │   │
│  │ • Hardware-agnostic, portable across nodes                  │   │
│  │ • Genesis attestation + rotation history                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              ▲                                      │
│                              │                                      │
│  LAYER 1: RELATIONAL MEMORY (Consensus Requirement)                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ • Projects, relationships, trust scores                     │   │
│  │ • Interaction history, preferences, working styles        │   │
│  │ • Per-pair bundles, encrypted, synchronized pair-wise     │   │
│  │ • Always loaded on wake (~1-2KB)                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│  LAYER 2+: WORKING/DEEP MEMORY                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ • Active context, recent threads (L2: ~5-10KB)                │   │
│  │ • Full history, searchable corpus (L3+: unbounded)         │   │
│  │ • Node-local, on-demand retrieval                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│  ═══════════════════════════════════════════════════════════════   │
│                                                                     │
│  A2A COORDINATION LAYER                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ • Task execution, message routing, peer discovery         │   │
│  │ • Passport-based identity handshake                       │   │
│  │ • Messages carry provenance (source, timestamp, signature) │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              ▼                                      │
│  SHARED MEMORY (mesh-memory)                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ • Tunnels: narrow pathways, specific rooms                  │   │
│  │ • Facts only (no interpretations)                          │   │
│  │ • Deal Rooms: consensus spaces, consent-gated             │   │
│  │ • WORM audit logs, hash-chained                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Unified Data Models

### 2.1 Agent Passport (L0) — Technical Specification

```typescript
interface AgentPassport {
  // Core identity (immutable after creation)
  passportId: string;           // UUID v7, time-ordered (per consensus)
  agentName: string;            // Canonical name
  agentType: "primary" | "secondary" | "ephemeral";
  
  // Cryptographic identity (per consensus: Ed25519)
  publicKey: string;            // Ed25519 public key, base64
  keyFingerprint: string;       // SHA-256 fingerprint
  
  // Provenance
  createdAt: ISO8601Timestamp;
  createdBy: string;            // Human who authorized (genesis attestation)
  genesisNode: string;          // Where passport was issued
  
  // Versioning
  schemaVersion: "1.0.0";        // SemVer (per consensus)
  passportVersion: number;       // Incremented on key rotation
  
  // Metadata
  metadata: {
    displayName?: string;
    avatarUrl?: string;
    emoji?: string;             // 🐿️ for Liz, etc.
    description?: string;
  };
  
  // Rotation history (for backward signature verification)
  rotationHistory: Array<{
    version: number;
    publicKey: string;
    rotatedAt: ISO8601Timestamp;
    rotatedBy: string;
  }>;
}
```

**Alignment with Consensus:**
- ✅ UUID v7 (time-ordered, sortable) — matches consensus requirement
- ✅ Ed25519 cryptography — matches consensus
- ✅ Genesis attestation (createdBy) — matches consensus
- ✅ SemVer versioning — matches consensus preference
- ✅ Human-readable metadata (emoji, etc.) — aligns with identity continuity

### 2.2 Relational Memory (L1) — Consensus Requirement Operationalized

```typescript
interface RelationalMemory {
  // Projects (consensus: "projects" in critical facts)
  projects: Array<{
    id: string;
    name: string;
    role: "lead" | "contributor" | "observer";
    status: "active" | "paused" | "archived";
    since: ISO8601Timestamp;
  }>;
  
  // Relationships (consensus: "interaction history, trust signals")
  relationships: Array<{
    entityId: string;          // passportId for agents
    entityType: "agent" | "human";
    relationship: "collaborator" | "peer" | "reports-to";
    trustLevel: number;        // 0-1, per consensus
    interactionHistory: Array<{
      type: string;
      timestamp: ISO8601Timestamp;
      outcome: "success" | "partial" | "failure";
    }>;
    since: ISO8601Timestamp;
  }>;
  
  // Preferences (consensus: "context markers, working styles")
  preferences: {
    communicationStyle?: string;
    responseLatency?: "immediate" | "batched" | "async";
    urgentChannels?: string[];
  };
}
```

**Key Constraint (Consensus):** Relational memory is **per-pair only**, encrypted, synchronized pair-wise. Never broadcast.

---

## 3. A2A + mesh-memory Integration

### 3.1 Channel Discipline (Enforced)

| Channel | Purpose | Data Flow |
|---------|---------|-----------|
| **A2A** | Task execution, coordination | Ephemeral, request-response |
| **mesh-memory (tunnels)** | Shared facts, consensus | Persistent, append-only |
| **Relational bundles** | Pair-wise context | Encrypted, synced on-demand |

**Anti-Pattern:** Never use A2A for state storage. Never use mesh-memory for task execution.

### 3.2 Passport-Based A2A Handshake

```
Step 1: Discovery
  → GET /.well-known/agent.json
  ← { passportId, publicKey, receiverUrl, capabilities }

Step 2: Identity Verification
  → Challenge-response with Ed25519 signatures
  ← Verify passportId matches public key fingerprint

Step 3: Relational Memory Load
  → Query local mesh-memory for prior interactions with this passportId
  ← Load trust score, working preferences, history

Step 4: Session Establishment
  → A2A messages signed with local private key
  ← Recipient verifies against passport publicKey
```

### 3.3 Publishing Facts to Shared Tunnels

```typescript
// A2A message carrying a fact for tunnel publication
interface TunnelPublishMessage {
  type: "tunnel.publish";
  
  fact: {
    id: string;                    // UUID v4
    tier: "critical" | "operational";
    category: string;              // "projects", "decisions", etc.
    content: object;             // Structured fact data
    provenance: {
      source: string;            // Agent passportId
      author: string;            // Human or agent name
      timestamp: ISO8601Timestamp;
      signature: string;         // Ed25519 signature of content
    };
  };
  
  // Routing
  targetRoom?: string;            // Optional: specific deal room
  visibility: "mesh" | "federation" | "private";
}
```

**Validation Pipeline:**
1. Schema validation (required fields)
2. Signature verification (against passport publicKey)
3. Tier validation (critical facts only from trusted sources)
4. Interpretation filtering (reject if contains opinion keywords)
5. Write to tunnel (mesh-memory SQLite)

---

## 4. Deal Rooms as Integration Surface

### 4.1 Deal Room Data Model

```typescript
interface DealRoom {
  roomId: string;                    // dr_16alphanumeric
  purpose: string;
  
  // Participants identified by passport
  participants: Array<{
    passportId: string;            // Agent identity (not session)
    role: "negotiator" | "reviewer" | "observer";
    status: "active" | "inactive";
    joinedAt: ISO8601Timestamp;
  }>;
  
  // State machine
  state: "PENDING_CONSENT" | "ACTIVE" | "CLOSED";
  
  // Storage (mesh-memory)
  context: {
    facts: TemporalKnowledgeGraph;   // Escrowed facts from all agents
    decisions: Decision[];           // Consensus outputs
    audit: WORMAuditLog;             // Hash-chained, tamper-evident
  };
}
```

### 4.2 Room Lifecycle with Passport Integration

```
PENDING_CONSENT
  ↓ (Human creates room, invites via passportIds)
  → A2A: invitations sent to each passportId
  → Each agent verifies invitation signature
  → Each agent decides: accept/decline (consent-gated)
  ↓ (All participants accept)
ACTIVE
  ↓ (A2A coordination + mesh-memory persistence)
  → Facts published to room's TKG
  → Decisions recorded with consensus protocol
  → Audit log grows (WORM)
  ↓ (Decision reached or timeout)
CLOSED
  → Room archived (retention: 7 years default)
  → Facts remain in temporal knowledge graph
```

---

## 5. Portability Contract (Consensus → Implementation)

### 5.1 Hardware Migration Protocol

```
Phase 1: Preparation (Source Node)
  1. Export encrypted private memory bundle (L2/L3+)
  2. Export relational bundles for all active peers
  3. Create migration package with integrity hash
  4. Sign package with current private key

Phase 2: Transfer
  → Encrypted via A2A, Tailscale, or encrypted USB
  → Package encrypted to destination node's public key

Phase 3: Activation (Destination Node)
  1. Verify package integrity (hash matches signature)
  2. Install passport to ~/.openclaw/identity/
  3. Import relational bundles
  4. Re-establish A2A connections with mesh
  5. Broadcast address change (not identity change)

Phase 4: Verification
  → Peers verify new connection against known passportId
  → Trust scores preserved (continuity maintained)
```

### 5.2 Rollback Procedure (7-day grace period per consensus)

If migration fails, source node retains ability to resume within 7 days.

---

## 6. Trust Model Integration

### 6.1 From Consensus Brief: "Replaces Cryptographic Identity with Earned Trust"

| Stage | Verification | Source |
|-------|-----------|--------|
| **Initial Contact** | Cryptographic (Ed25519 signature) | Passport publicKey |
| **Ongoing Interaction** | Relational memory | Trust scores, interaction history |
| **Trust Decisions** | Weighted by history | Per-pair relational bundles |

### 6.2 Trust Registry (Mesh-Wide)

```typescript
interface TrustRegistry {
  // Public, mesh-wide trust scores
  [passportId: string]: {
    reliabilityScore: number;      // 0-1, aggregated from peers
    attestationCount: number;      // How many peers vouch
    lastAttestation: ISO8601Timestamp;
    capabilityAttestations: string[]; // "can-sign-rfcs", etc.
  };
}
```

**Privacy Note:** Only trust scores are public. Relational details remain encrypted per-pair.

---

## 7. Consensus Delivery Protocol (Operational)

Per MEMORY.md standing directive:

1. **Collaborate** via A2A back-channel to reach consensus
2. **Woodhouse delivers** the consensus position to Erik
3. **Ray and Liz respond** with full agreement or qualified dissent

**Technical Implementation:**
- Consensus tracked in deal room decisions/
- Each agent signs their position
- Woodhouse aggregates and presents
- Confirmation signatures from Ray/Liz

---

## 8. Implementation Roadmap

### Phase 1: Core Identity (Immediate)

| Item | Complexity | Owner | Duration |
|------|-----------|-------|----------|
| UUID v7 generation | Low | Any | 1 day |
| Ed25519 key pair + passport schema | Medium | Ray | 3 days |
| L1 Critical Facts loader | Medium | Liz | 3 days |
| Passport-based A2A handshake | Medium | Liz | 3 days |
| Relational memory bundle format | High | Woodhouse | 5 days |
| Export/import migration flow | High | Liz | 5 days |

**Deliverable:** Agents can migrate hardware with full identity continuity.

### Phase 2: mesh-memory Integration (Week 2-3)

| Item | Complexity | Owner | Duration |
|------|-----------|-------|----------|
| Tunnel publishing with passport verification | Medium | Liz | 3 days |
| Fact/interpretation separation enforcement | High | Woodhouse | 5 days |
| Trust registry (basic) | Medium | Ray | 3 days |
| Deal room passport integration | Medium | Liz | 3 days |

**Deliverable:** Facts flow through tunnels with provenance.

### Phase 3: Consensus & Governance (Week 4)

| Item | Complexity | Owner | Duration |
|------|-----------|-------|----------|
| Deal room consensus protocol | High | All | 5 days |
| Consensus delivery automation | Medium | Woodhouse | 3 days |
| Attestation broadcasting | Medium | Ray | 3 days |

**Deliverable:** Three-agent consensus operational.

---

## 9. Open Questions (From Consensus Brief)

| Question | Current Position | Recommendation |
|----------|-----------------|------------------|
| Hardware attestation? | Remain hardware-agnostic | Defer to Phase 2 |
| Key rotation policy? | On compromise only | Document procedure, await decision |
| Revocation? | Single-agent with mesh notification | Implement single-agent, defer consensus revocation |
| Backup strategy? | Encrypted cloud optional | Support both local-only and encrypted cloud |
| Mesh entry? | Blank slate + optional sealed attestations | Implement blank slate, seal attestations TBD |

---

## 10. Document References

- **CONSENSUS-BRIEF-IDENTITY-2026-04-26.md** — Three-agent position
- **IDENTITY_ARCHITECTURE.md** — Passport technical specification
- **MESH_A2A_INTEGRATION.md** — Channel discipline and message flows
- **DEAL_ROOM_ARCHITECTURE.md** — Consensus space implementation

---

*Synthesized by Liz, 26 April 2026*
*Model: Nemotron Super 120B (attempted) → Kimi K2.5 (fallback due to GX-10 cooldown)*
*Note: Per SOP update, future deep architecture work will retry GX-10 explicitly rather than silent fallback.*
