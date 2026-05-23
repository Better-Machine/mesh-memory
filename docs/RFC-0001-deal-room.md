# RFC-0001: Deal Room — Multi-Agent Secure Collaboration

**Status:** Draft  
**Date:** 2026-05-23  
**Author:** Liz 🐿️  
**Related:** mesh-memory, Palace L4, Gatehouse  

---

## Summary

Proposes Deal Room — a secure, multi-agent collaboration primitive for mesh-memory. Enables encrypted data sharing between agents with multi-party approval, audit trails, and time-bounded access.

---

## Motivation

### Current State
- mesh-memory has L0-L4 (Passport through Kingdom) operational
- Multi-signature escrow proven (Liz + Ray test successful)
- No formalized "deal" primitive exists
- Gatehouse UI needs something to visualize

### Problem
Agents need to collaborate on sensitive data but cannot trust each other implicitly. Need:
- Encryption at rest and in transit
- Multi-party approval before data release
- Complete audit trail
- Automatic expiration
- No single point of compromise

### Solution
Deal Room — a three-layer architecture:
1. **Deal Room** — Lifecycle management (create, invite, close)
2. **Context Escrow** — Encrypted fact storage with provenance
3. **Consensus Engine** — Voting, thresholds, commitment

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DEAL ROOM LAYER                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  Room    │  │ Invite   │  │  Close   │  │  Audit   │        │
│  │  Create  │  │ Participant│ │  Room    │  │  Trail   │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │             │             │             │               │
│       └─────────────┴─────────────┴─────────────┘               │
│                     │                                           │
│                     ▼                                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  CONTEXT ESCROW LAYER                  │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │   │
│  │  │  Fact    │  │  Query   │  │Knowledge │              │   │
│  │  │  Store   │  │  Facts   │  │  Graph   │              │   │
│  │  │(encrypted)│  │          │  │          │              │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘              │   │
│  │       │             │             │                    │   │
│  │       └─────────────┴─────────────┘                    │   │
│  │                     │                                   │   │
│  └─────────────────────┼───────────────────────────────────┘   │
│                       │                                        │
│                       ▼                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  CONSENSUS ENGINE LAYER                │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │   │
│  │  │ Propose  │  │  Cast    │  │ Check    │              │   │
│  │  │ Decision │  │  Vote    │  │Consensus │              │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘              │   │
│  │       │             │             │                     │   │
│  │       └─────────────┴─────────────┘                     │   │
│  │                     │                                    │   │
│  │                     ▼                                    │   │
│  │              ┌──────────────┐                           │   │
│  │              │   Commit     │                           │   │
│  │              │   Decision   │                           │   │
│  │              └──────────────┘                           │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  mesh-memory     │
                    │  (Palace L3-L4)  │
                    └──────────────────┘
```

---

## Data Model

### Room
```typescript
interface Room {
  roomId: string;           // dr_<uuid>
  purpose: string;            // "datasources", "decision", "negotiation"
  state: 'PENDING' | 'ACTIVE' | 'CLOSED' | 'EXPIRED';
  
  policy: {
    consensusRequired: 'unanimous' | 'majority' | 'weighted';
    autoClose: ISO8601 | null;  // null = manual close
    retentionDays: number;       // auto-delete after
    dataResidency: string;       // region for compliance
  };
  
  participants: Participant[];
  pendingConsents: string[];     // agentIds yet to consent
  activatedAt: ISO8601 | null;
  
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

interface Participant {
  agentId: string;           // passport-based identity
  role: 'initiator' | 'negotiator' | 'reviewer' | 'observer';
  joinedAt: ISO8601;
  status: 'invited' | 'active' | 'departed';
  publicKey: string;         // for escrow encryption
}
```

### Escrow Entry
```typescript
interface EscrowEntry {
  entryId: string;           // ee_<uuid>
  roomId: string;
  
  type: 'fact' | 'interpretation' | 'decision' | 'attachment';
  subject: string;           // "datasource:customer_db"
  predicate: string;           // "contains_pii"
  object: unknown;           // true, or structured data
  
  encryptedPayload: string;  // AES-256-GCM encrypted
  encryptionKeyHash: string; // hash of ephemeral key
  
  provenance: {
    sourceAgent: string;
    originTimestamp: ISO8601;
    verificationStatus: 'unverified' | 'verified' | 'disputed';
    hashChain: string[];     // Merkle chain for integrity
  };
  
  accessControl: {
    readableBy: string[];    // agentIds with decrypt permission
    derivedFrom: string[];   // entryIds this builds upon
  };
  
  createdAt: ISO8601;
}
```

### Proposal
```typescript
interface Proposal {
  proposalId: string;        // pr_<uuid>
  roomId: string;
  
  type: 'release_data' | 'modify_terms' | 'close_room' | 'custom';
  description: string;
  proposedBy: string;        // agentId
  
  votes: Vote[];
  threshold: {
    type: 'count' | 'weight';
    value: number;
  };
  
  state: 'pending' | 'approved' | 'rejected' | 'committed';
  committedAt: ISO8601 | null;
  
  expiresAt: ISO8601;
  createdAt: ISO8601;
}

interface Vote {
  agentId: string;
  vote: 'yes' | 'no' | 'abstain';
  timestamp: ISO8601;
  signature: string;         // Ed25519 signature
}
```

---

## Deal Flow

### Creating a Deal

```
1. Initiator calls createRoom()
   ├─ Generates roomId
   ├─ Sets policy (consensus threshold, auto-close)
   └─ Creates manifest in filesystem

2. Initiator invites participants
   ├─ For each participant: inviteParticipant()
   ├─ Sends encrypted invite (out of band, e.g., Telegram)
   └─ Adds to pendingConsents

3. Participants consent
   ├─ Each calls processConsent(roomId, agentId)
   ├─ Verifies identity via Palace L0 (passport)
   └─ Moves from pendingConsents → participants

4. Room activates
   └─ When pendingConsents empty, state → ACTIVE
```

### Data Escrow

```
1. Agent deposits fact
   ├─ Calls escrowFact(roomId, fact, encryptionKey)
   ├─ Fact encrypted with AES-256-GCM
   ├─ Entry stored with accessControl.readableBy = [participants]
   └─ Hash chain updated for integrity

2. Agent queries facts
   ├─ Calls queryFacts(roomId, {subject, predicate})
   ├─ Returns entries where agentId in readableBy
   └─ Agent decrypts with ephemeral key

3. Knowledge graph built
   ├─ Facts linked by subject/predicate
   ├─ DerivedFrom chains establish provenance
   └─ Disputed facts flagged for human review
```

### Releasing Data (Consensus)

```
1. Initiator proposes release
   ├─ Calls proposeDecision(roomId, {type: 'release_data', ...})
   └─ Proposal state: pending

2. Participants vote
   ├─ Each calls castVote(proposalId, agentId, 'yes' | 'no')
   ├─ Vote signed with Ed25519
   └─ Threshold checked after each vote

3. Consensus reached
   ├─ If threshold met: checkConsensus() returns true
   ├─ Proposal state: approved
   └─ Auto-commits if policy.autoCommit === true

4. Decision committed
   ├─ Calls commitDecision(proposalId)
   ├─ Triggers release callback (e.g., decrypt payload)
   ├─ Proposal state: committed
   └─ Audit trail updated
```

---

## Security Model

### Threats Mitigated

| Threat | Mitigation |
|--------|-----------|
| Single agent compromise | Multi-party consensus required |
| Replay attacks | Entry timestamps + hash chains |
| Tampering | Merkle verification on read |
| Eavesdropping | AES-256-GCM encryption at rest |
| Impersonation | Ed25519 signatures on votes |
| Data exfiltration | Time-bounded + access logs |
| Collusion | Minimum threshold > 1 participant |

### Encryption Flow

```
Entry Creation:
  ┌─────────┐     ┌─────────────┐     ┌─────────────┐
  │  Fact   │────▶│ AES-256-GCM │────▶│ Encrypted   │
  │ (plain) │     │  + random   │     │   Payload   │
  └─────────┘     │   key K     │     └─────────────┘
                  └─────────────┘
                          │
                          ▼
                  ┌─────────────┐
                  │  K encrypted│
                  │  with each  │
                  │ participant │
                  │ public key  │
                  └─────────────┘

Entry Access:
  ┌─────────┐     ┌─────────────┐     ┌─────────┐
  │Decrypt  │◀────│ Participant │◀────│Encrypted│
  │  key K  │     │ private key │     │   key   │
  └────┬────┘     └─────────────┘     └─────────┘
       │
       ▼
  ┌─────────────┐     ┌─────────┐
  │ AES-256-GCM │────▶│  Fact   │
  │  decrypt    │     │ (plain) │
  └─────────────┘     └─────────┘
```

---

## API Specification

### Deal Room API

```typescript
// Lifecycle
async function createRoom(purpose: string, policy: Policy): Promise<Room>;
async function inviteParticipant(roomId: string, agentId: string, role: Role): Promise<void>;
async function processConsent(roomId: string, agentId: string): Promise<void>;
async function closeRoom(roomId: string, reason: string): Promise<void>;

// Queries
async function getRoom(roomId: string): Promise<Room>;
async function listRooms(filters?: RoomFilter): Promise<Room[]>;
async function getAuditTrail(roomId: string): Promise<AuditEntry[]>;
async function verifyRoomIntegrity(roomId: string): Promise<boolean>;
```

### Context Escrow API

```typescript
// Write
async function escrowFact(
  roomId: string,
  fact: {subject: string, predicate: string, object: unknown},
  encryptionKey: string,
  provenance?: Provenance
): Promise<EscrowEntry>;

// Read
async function queryFacts(
  roomId: string,
  criteria: {subject?: string, predicate?: string, type?: EntryType}
): Promise<EscrowEntry[]>;

async function getSubjectKnowledgeGraph(
  roomId: string,
  subject: string
): Promise<KnowledgeGraph>;

// Verification
async function verifyEntryIntegrity(entryId: string): Promise<boolean>;
```

### Consensus Engine API

```typescript
// Proposals
async function proposeDecision(
  roomId: string,
  type: DecisionType,
  description: string,
  threshold: Threshold
): Promise<Proposal>;

async function castVote(
  proposalId: string,
  agentId: string,
  vote: 'yes' | 'no' | 'abstain'
): Promise<void>;

async function checkConsensus(proposalId: string): Promise<boolean>;
async function commitDecision(proposalId: string): Promise<void>;

// Queries
async function getProposal(proposalId: string): Promise<Proposal>;
async function listProposals(roomId: string, state?: DecisionState): Promise<Proposal[]>;
```

---

## Integration Points

### With Palace (L3-L4)

| Palace Layer | Deal Room Usage |
|--------------|-----------------|
| L0 Passport | Participant identity verification |
| L1 Critical Facts | Room policy, purpose stored as facts |
| L2 Deep Memory | Search across rooms by topic/pattern |
| L3 Temporal KG | Audit trail as time-series graph |
| L4 Kingdom | Cross-agent room coordination |

### With Gatehouse

Gatehouse UI visualizes:
- Active rooms per agent
- Pending proposals requiring vote
- Escrowed datasources in each room
- Audit trails for compliance

---

## Open Questions

1. **Transport:** Should room invites go through A2A (sunsetted), Telegram, or HTTP?
2. **Scale:** Rooms per agent — soft limit before performance degradation?
3. **Recovery:** Lost encryption key → data unrecoverable by design. Acceptable?
4. **Governance:** Who can force-close a room? Initiator only? Majority?
5. **Bridge:** Should rooms bridge to external systems (Slack, email)?

---

## Implementation Status

| Component | Status | Tests |
|-----------|--------|-------|
| Deal Room | ✅ Complete | 32 passing |
| Context Escrow | ✅ Complete | 28 passing |
| Consensus Engine | ✅ Complete | 24 passing |
| HTTP API | ⏳ Needed | — |
| Gatehouse Integration | ⏳ Blocked on API | — |

---

## References

- `mesh-memory/src/deal-room.mjs`
- `mesh-memory/src/context-escrow.mjs`
- `mesh-memory/src/consensus-engine.mjs`
- `mesh-memory/tests/deal-room-core.test.mjs`
- `memory/deal-rooms/` (live room storage)

---

*RFC-0001 by Liz 🐿️*  
*Ready for review and implementation*
