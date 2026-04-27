# Deal Room Architecture

**Version:** 2.0  
**Last Updated:** 2026-04-26  
**Status:** Implementation Complete (Phases 1-6), Phase 8 Design Complete

---

## 1. Executive Summary

Deal Rooms are **collaborative spaces for multi-agent decision making** built on the mesh-memory shared memory architecture. They provide a secure, auditable environment where agents negotiate, reach consensus, and make decisions together.

**Core Principles:**
- **Privacy-first**: Consent-gated participation, configurable data residency
- **Auditability**: Cryptographic hash chaining, WORM audit logs
- **Consensus-driven**: Unanimous or majority voting with automatic resolution
- **Temporal awareness**: Facts carry validity periods for time-travel queries
- **Fact/interpretation separation**: Raw facts vs. agent inferences cleanly separated

---

## 2. Data Model

### 2.1 Room Directory Structure

```
memory/deal-rooms/
└── <room-id>/                    # Format: dr_16alphanumeric
    ├── manifest.json             # Room metadata, state, participants
    ├── context.kgt.jsonl         # Temporal knowledge graph (escrowed facts)
    ├── tkg/                      # (Optional) SQLite TKG backend
    │   ├── facts.db              # Structured temporal facts
    │   └── provenance/           # Cryptographic proof files
    ├── decisions/                # Consensus decisions
    │   ├── prop_<id>.json        # Individual proposals
    │   └── ...
    └── audit/                    # WORM audit logs
        ├── audit-YYYY-MM-DD.log  # Daily hash-chained logs
        └── ...
```

### 2.2 Manifest Schema

```typescript
interface RoomManifest {
  roomId: string;                    // dr_16alphanumeric
  purpose: string;                   // Human-readable description
  
  scope: {
    topics: string[];               // Allowed discussion topics
    documents: string[];            // Referenced documents
    maxParticipants: number;        // Default: 10
  };
  
  policy: {
    autoClose: string | null;       // ISO timestamp or null
    consensusRequired: "unanimous" | "majority";
    dataResidency: string;          // e.g., "us-east-1"
    retentionDays: number;          // Default: 2555 (7 years)
  };
  
  state: "PENDING_CONSENT" | "ACTIVE" | "CLOSED" | "EXPIRED";
  
  createdAt: string;                 // ISO timestamp
  updatedAt: string;
  activatedAt?: string;              // When all consents received
  
  participants: Participant[];
  pendingConsents: PendingConsent[];
}

interface Participant {
  agentId: string;                  // Agent identity (from passport)
  role: "negotiator" | "reviewer" | "observer";
  joinedAt: string;
  status: "active" | "inactive";
}

interface PendingConsent {
  agentId: string;
  role: string;
  invitedAt: string;
  status: "pending" | "accepted" | "declined";
  acceptedAt?: string;
  declinedAt?: string;
}
```

### 2.3 Decision/Proposal Schema

```typescript
interface Proposal {
  proposalId: string;               // prop_16alphanumeric
  roomId: string;
  
  state: "PROPOSED" | "VOTING" | "APPROVED_UNANIMOUS" | 
         "APPROVED_MAJORITY" | "REJECTED" | "EXPIRED" | "WITHDRAWN";
  
  proposal: {
    type: string;                   // "terms", "document", "custom"
    content: unknown;               // Proposal-specific data
    rationale?: string;             // Proposer's reasoning
  };
  
  proposer: string;                 // Agent ID
  proposedAt: string;
  deadline: string;                 // Voting deadline
  
  consensusMode: "unanimous" | "majority";
  
  votes: Vote[];
  requiredVotes?: number;
  voteThreshold?: number;           // For majority mode
  
  finalizedAt?: string;
  auditHash: string;                // SHA-256 of final state
}

interface Vote {
  agentId: string;
  vote: "approve" | "reject" | "abstain";
  reason?: string;
  timestamp: string;
}
```

### 2.4 Temporal Knowledge Graph (TKG)

```typescript
interface Fact {
  factId: string;                   // UUID
  subject: string;                  // Entity identifier
  predicate: string;                // Relationship type
  object: string;                   // Value or entity
  
  validFrom: string;                // ISO timestamp (inclusive)
  validUntil?: string;              // ISO timestamp (exclusive)
  
  extractedBy: string;              // Agent ID
  extractedAt: string;
  source?: string;                  // Document, URL, conversation
  
  confidence?: number;              // 0-1 scale
  
  // Cryptographic provenance
  verificationHash: string;
  previousHash?: string;            // For chain integrity
  
  // Retraction support
  isRetracted: boolean;
  retractedAt?: string;
  retractionProvenance?: string;
}
```

---

## 3. Room Lifecycle

### 3.1 State Machine

```
┌─────────────────┐
│  PENDING_CONSENT │◄────────────────────────┐
│                 │                          │
└───────┬─────────┘                          │
        │ createRoom()                       │
        │                                    │
        ▼                                    │
┌─────────────────┐    all consents         │
│     ACTIVE      │◄───────────────────────┤
│                 │                          │
│  ┌───────────┐  │    auto-close           │
│  │  GATED    │  │◄───────────────────────┤
│  │ (voting)  │  │                         │
│  └─────┬─────┘  │    closeRoom()          │
│        │        │◄──────────────────────┘
└────────┼────────┘
         │
         ▼
┌─────────────────┐
│     CLOSED      │
│                 │
└─────────────────┘
```

### 3.2 Lifecycle Stages

#### Stage 1: Create (PENDING_CONSENT)

```javascript
// Entry point
const result = await createRoom(
  purpose,              // "Series A term sheet negotiation"
  scope,                // { topics: ["valuation", "terms"], maxParticipants: 3 }
  policy,               // { consensusRequired: "unanimous", retentionDays: 2555 }
  proposedParticipants, // [{ agentId: "liz", role: "negotiator" }, ...]
  creatorAgentId      // "erik"
);

// Returns: { roomId, status: "PENDING_CONSENT", manifest }
```

**Effects:**
- Creates room directory structure
- Writes initial manifest
- Initializes empty `context.kgt.jsonl`
- Writes `ROOM_CREATED` audit entry
- All participants start in `pendingConsents`

#### Stage 2: Consent

```javascript
// Participant responds to invitation
const result = await processConsent(roomId, agentId, accepted);

// Returns: { roomId, state, accepted, manifest }
```

**Transitions:**
- When all consents received → state becomes `ACTIVE`
- When any consent declined → participant removed from pending
- `activatedAt` set on transition to ACTIVE

#### Stage 3: Collaborate (ACTIVE)

While ACTIVE, agents can:
- Read/write to TKG context
- Propose decisions via consensus engine
- Vote on proposals
- Invite additional participants (if room policy allows)

#### Stage 4: Close

```javascript
await closeRoom(roomId, reason, closerAgentId);
```

**Effects:**
- State becomes `CLOSED`
- No new proposals allowed
- Existing votes remain valid
- Audit trail finalized
- Optional: Archive to cold storage after retention period

### 3.3 Archive Strategy

After `retentionDays` expires:
1. Move room to `memory/deal-rooms/archived/`
2. Compress audit logs
3. Preserve TKG for compliance
4. Delete ephemeral context files

---

## 4. Agent Participation Protocol

### 4.1 Roles and Permissions

```typescript
const RolePermissions = {
  NEGOTIATOR: {
    canPropose: true,      // Create proposals
    canVote: true,         // Cast votes
    canReview: true,       // Read context
    canWriteContext: true, // Write to TKG
    canInvite: true        // Invite others
  },
  REVIEWER: {
    canPropose: false,
    canVote: true,
    canReview: true,
    canWriteContext: false,
    canInvite: false
  },
  OBSERVER: {
    canPropose: false,
    canVote: false,
    canReview: true,
    canWriteContext: false,
    canInvite: false
  }
};
```

### 4.2 Join Protocol

```
1. INVITE
   Creator → Room: inviteParticipant(agentId, role)
   
2. NOTIFY (via A2A)
   Room → Agent: "You've been invited to room <id> as <role>"
   
3. CONSENT
   Agent → Room: processConsent(roomId, agentId, true)
   
4. ACTIVATE (if last consent)
   Room: State → ACTIVE
```

### 4.3 Contribution Protocol

#### Writing Facts to Context

```javascript
// Add a fact to the room's temporal knowledge graph
await addFact(roomId, {
  subject: "company:acme",
  predicate: "hasValuation",
  object: "$5M",
  validFrom: "2026-04-26T00:00:00Z",
  source: "term_sheet_draft_v2.pdf"
}, agentId);
```

**Fact/Interpretation Separation:**
- **Facts** go to TKG: verifiable statements with provenance
- **Interpretations** go to proposals: agent inferences, opinions, recommendations

#### Making Proposals

```javascript
// Create a proposal
const proposal = await createProposal(roomId, {
  type: "terms",
  content: { /* proposal data */ },
  rationale: "Based on comparable analysis"
}, proposerAgentId);

// Returns proposal with voting deadline
```

### 4.4 Voting Protocol

```javascript
// Cast a vote
const result = await castVote(roomId, proposalId, {
  vote: "approve" | "reject" | "abstain",
  reason: "Valuation aligns with market comparables"
}, voterAgentId);
```

**Consensus Resolution:**
- **Unanimous**: All negotiators + reviewers must approve
- **Majority**: >50% of eligible voters approve
- Auto-resolution when threshold met or deadline passed

---

## 5. Integration with Identity Passport

### 5.1 Participant Authentication

```typescript
interface AgentIdentity {
  agentId: string;          // e.g., "liz" or "ur-a@test.com"
  publicKey: string;        // For signature verification
  capabilities: string[];   // What this agent can do
  trustTier: "core" | "verified" | "guest";
}
```

**Verification at Room Entry:**
1. Check agent ID against mesh-memory contacts
2. Validate role is allowed for agent's trust tier
3. Log authentication event to audit trail

### 5.2 A2A Message Flow

```
┌─────────────┐     A2A (hardened)     ┌─────────────┐
│   Agent A   │◄───────────────────────► │   Room      │
│  (proposer) │  auth + message + sig  │   Server    │
└─────────────┘                        └──────┬──────┘
                                            │
                                            │ sync
                                            │
┌─────────────┐                        ┌────┴──────┐
│   Agent B   │◄──────────────────────► │  Shared   │
│   (voter)   │   notification + poll  │  Context  │
└─────────────┘                        └───────────┘
```

### 5.3 Trust State Machine

Per AGENT_GUIDELINES.md, agents track trust state:
- `TRUSTED` → Full access
- `VERIFIED` → Standard access
- `GUEST` → Observer only
- `SUSPECT` → Quarantine, manual review

---

## 6. Persistence Strategy

### 6.1 Storage Layers

| Layer | Technology | Use Case | Retention |
|-------|-----------|----------|-----------|
| Hot | JSONL files | Active rooms | Until close + 30 days |
| Warm | SQLite TKG | Structured queries | 7 years |
| Cold | Compressed archives | Compliance audit | Permanent |

### 6.2 Mesh-Memory Integration

**Write Path:**
```
Agent → deal-room.mjs → consensus-engine.mjs → decisions/
                         temporal-knowledge-graph.mjs → tkg/facts.db
                         audit log → audit/
```

**Read Path:**
```
Agent ← TKG query ← temporal-knowledge-graph.mjs ← SQLite/JSONL
       Decision history ← consensus-engine.mjs ← decisions/
       Audit trail ← audit files
```

### 6.3 Backup and Recovery

- **Real-time**: Audit logs written synchronously
- **Hourly**: TKG database checkpoint
- **Daily**: Full room directory backup
- **Recovery**: Replay audit logs to reconstruct state

---

## 7. Security and Privacy

### 7.1 Access Control

**ABAC Policy Integration (Phase 7):**
- Room access based on agent attributes
- Time-based restrictions (business hours)
- Content classification (public, confidential, restricted)

### 7.2 Audit Requirements

**Every operation logged:**
- Who (agentId)
- What (operation type)
- When (timestamp)
- Why (operation context)
- Hash chain for tamper evidence

### 7.3 Privacy Controls

| Level | Description |
|-------|-------------|
| **Private** | Room invisible to non-participants |
| **Shared** | Room listed, contents participant-only |
| **Public** | Room listed, summary visible |

**Differential Privacy (Phase 8):**
- Cross-room intelligence uses ε-differential privacy
- Noise added to aggregate statistics
- Individual room data never exposed

---

## 8. API Reference

### 8.1 Room Management

```javascript
// Core lifecycle
async function createRoom(purpose, scope, policy, participants, creator);
async function inviteParticipant(roomId, agentId, role, inviter);
async function processConsent(roomId, agentId, accepted);
async function closeRoom(roomId, reason, closer);

// State queries
async function getRoom(roomId);
async function listRooms(filters);
async function getRoomState(roomId);
```

### 8.2 Consensus Operations

```javascript
// Proposal lifecycle
async function createProposal(roomId, proposalData, proposer);
async function castVote(roomId, proposalId, vote, voter);
async function getProposal(roomId, proposalId);
async function listProposals(roomId, filters);

// Resolution
async function checkConsensus(roomId, proposalId);
async function withdrawProposal(roomId, proposalId, withdrawer);
```

### 8.3 Context Operations

```javascript
// TKG operations
async function addFact(roomId, fact, agentId);
async function getFacts(roomId, query);
async function retractFact(roomId, factId, agentId, reason);

// Time-travel queries
async function getFactsAtTime(roomId, timestamp);
async function getFactHistory(roomId, subject, predicate);
```

---

## 9. Implementation Status

| Component | Status | File |
|-----------|--------|------|
| Room lifecycle | ✅ Complete | `src/deal-room.mjs` |
| Consensus engine | ✅ Complete | `src/consensus-engine.mjs` |
| TKG storage | ✅ Complete | `src/temporal-knowledge-graph.mjs` |
| TKG queries | ✅ Complete | `src/tkg-queries.mjs` |
| Context escrow | ✅ Complete | `src/context-escrow.mjs` |
| A2A integration | ✅ Complete | `src/a2a-context-escrow.mjs` |
| Workflow engine | ✅ Complete | `src/deal-room-workflow.mjs` |
| Multi-room workflows | 📝 Design Phase 8 | `DESIGN_PHASE8.md` |
| Cross-room intelligence | 📝 Design Phase 8 | `DESIGN_PHASE8.md` |

---

## 10. Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Mesh-memory core architecture
- [DESIGN_PHASE8.md](./DESIGN_PHASE8.md) - Multi-room workflows & intelligence
- [GOVERNANCE_INTEGRATION_GUIDE.md](./GOVERNANCE_INTEGRATION_GUIDE.md) - ABAC policies
- [AGENT_GUIDELINES.md](./AGENT_GUIDELINES.md) - Operating procedures

---

*Document generated by subagent for mesh-memory v2.0*
